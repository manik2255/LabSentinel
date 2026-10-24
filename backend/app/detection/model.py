"""Isolation Forest anomaly detector for temperature behaviour.

The detector is trained on *synthetic but realistic* normal temperature
patterns (small drift around the centre of a range, mild noise, gentle
oscillations) expressed through the same engineered features used at
inference time. Because the features are normalised by each equipment's
half-range, a single model generalises across equipment with different
absolute ranges.

Responsibilities:

* ``train`` - fit an IsolationForest on generated normal feature vectors.
* ``score`` - return a normalised anomaly score in [0, 1] for a feature
  vector (0 = very normal, 1 = highly anomalous).
* ``save`` / ``load`` - persist and restore the fitted model with joblib.
* graceful handling of the not-yet-trained state.

The module exposes a process-wide ``detector`` singleton.
"""

from __future__ import annotations

import os
import random
import threading
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest

from app.detection.features import FEATURE_NAMES

# Default on-disk location for the persisted model.
DEFAULT_MODEL_PATH = os.getenv(
    "ANOMALY_MODEL_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "anomaly_model.joblib"),
)

# Minimum feature rows required before we will train.
MIN_TRAINING_SAMPLES = 50


class ModelNotTrainedError(RuntimeError):
    """Raised when scoring is attempted before the model is trained/loaded."""


class AnomalyDetector:
    """Wraps an IsolationForest with training data generation and persistence."""

    def __init__(self, model_path: str = DEFAULT_MODEL_PATH) -> None:
        self._lock = threading.RLock()
        self._model: Optional[IsolationForest] = None
        self._model_path = model_path
        # Captured at train time so scores can be normalised to [0, 1].
        self._score_offset: float = 0.0
        self._score_scale: float = 1.0

    @property
    def is_trained(self) -> bool:
        return self._model is not None

    # ------------------------------------------------------------------
    # Training data generation (realistic normal patterns)
    # ------------------------------------------------------------------
    @staticmethod
    def generate_normal_features(n: int = 600, seed: Optional[int] = 42) -> np.ndarray:
        """Generate feature vectors representing realistic *normal* behaviour.

        Normal equipment hovers near the centre of its range with small drift,
        mild sensor noise, and occasional gentle oscillation - never sustained
        excursions or large jumps. Values are expressed directly in normalised
        feature space (matching ``features.compute_features``).
        """
        rng = random.Random(seed)
        rows: list[list[float]] = []
        for _ in range(n):
            # Deviation: normal units drift around the centre but routinely
            # reach well into the range. Allow up to the range edge (+/-1) so
            # ordinary in-range readings are never treated as anomalies.
            deviation = rng.gauss(0.0, 0.33)
            deviation = max(-0.95, min(0.95, deviation))

            # Rate of change: tick-to-tick movement from drift + mild sensor
            # noise. Real normal readings can jump a fair fraction of the
            # half-range between samples, so keep this generous.
            rate_of_change = rng.gauss(0.0, 0.22)
            rate_of_change = max(-0.6, min(0.6, rate_of_change))

            # Rolling mean deviation: sustained position, usually nearer the
            # centre than instantaneous deviation.
            rolling_mean_dev = rng.gauss(0.0, 0.22)
            rolling_mean_dev = max(-0.8, min(0.8, rolling_mean_dev))

            # Rolling std: healthy variability for an in-range unit. Centred on
            # mild noise but explicitly includes near-zero values so a perfectly
            # steady (flat) reading is recognised as normal, not anomalous.
            rolling_std = abs(rng.gauss(0.12, 0.10))
            rolling_std = min(0.5, rolling_std)

            rows.append(
                [deviation, rate_of_change, rolling_mean_dev, rolling_std]
            )
        return np.array(rows, dtype=float)

    # ------------------------------------------------------------------
    # Train / score
    # ------------------------------------------------------------------
    def train(
        self,
        features: Optional[np.ndarray] = None,
        *,
        contamination: float = 0.02,
        random_state: int = 42,
    ) -> int:
        """Fit the IsolationForest.

        If ``features`` is None, synthetic normal data is generated. Raises
        ValueError when too few samples are supplied to train reliably.
        Returns the number of training rows used.
        """
        if features is None:
            features = self.generate_normal_features()

        features = np.asarray(features, dtype=float)
        if features.ndim != 2 or features.shape[1] != len(FEATURE_NAMES):
            raise ValueError(
                f"features must have shape (n, {len(FEATURE_NAMES)})"
            )
        if features.shape[0] < MIN_TRAINING_SAMPLES:
            raise ValueError(
                f"need at least {MIN_TRAINING_SAMPLES} samples to train, "
                f"got {features.shape[0]}"
            )

        model = IsolationForest(
            n_estimators=200,
            contamination=contamination,
            random_state=random_state,
        )
        model.fit(features)

        # Calibrate the score mapping from the training distribution.
        #
        # IsolationForest.decision_function is positive for inliers and
        # negative for outliers, with the contamination boundary at ~0. We map
        # raw -> anomaly score in [0, 1] with a logistic anchored so that:
        #   * typical NORMAL training points (high positive raw) score LOW,
        #   * the decision boundary (raw ~ 0) scores ~0.75 (our alert line),
        #   * clear outliers (negative raw) score near 1.
        #
        # We anchor the midpoint near the low end of the normal distribution
        # (a low percentile of training raw), so ordinary normal variation
        # stays well below the alert threshold instead of hovering at 0.5.
        raw = model.decision_function(features)
        # 5th percentile of inlier scores: the edge of "clearly normal".
        anchor = float(np.percentile(raw, 5))
        spread = float(np.std(raw)) or 1.0
        with self._lock:
            self._model = model
            self._score_offset = anchor
            self._score_scale = spread
        return int(features.shape[0])

    def anomaly_score(self, feature_vector: list[float]) -> float:
        """Return a normalised anomaly score in [0, 1] for one feature vector.

        0 ~ very normal, 1 ~ highly anomalous. Raises ModelNotTrainedError if
        the model has not been trained or loaded.
        """
        with self._lock:
            model = self._model
            offset = self._score_offset
            scale = self._score_scale
        if model is None:
            raise ModelNotTrainedError("anomaly model is not trained")

        x = np.asarray(feature_vector, dtype=float).reshape(1, -1)
        raw = float(model.decision_function(x)[0])

        # Map to [0, 1] via a logistic anchored at the low-percentile of the
        # normal distribution (``offset``). Points more normal than that anchor
        # (raw > offset) score below 0.5; points below it climb toward 1.
        # Scaling by the training spread keeps the transition calibrated.
        z = (offset - raw) / scale  # positive when more anomalous than anchor
        score = 1.0 / (1.0 + np.exp(-z))
        return float(round(score, 4))

    def is_anomaly(self, feature_vector: list[float]) -> bool:
        """Hard anomaly decision from the underlying IsolationForest."""
        with self._lock:
            model = self._model
        if model is None:
            raise ModelNotTrainedError("anomaly model is not trained")
        x = np.asarray(feature_vector, dtype=float).reshape(1, -1)
        return int(model.predict(x)[0]) == -1

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save(self, path: Optional[str] = None) -> str:
        """Persist the fitted model (and score calibration) to disk."""
        import joblib

        with self._lock:
            if self._model is None:
                raise ModelNotTrainedError("cannot save an untrained model")
            target = path or self._model_path
            payload = {
                "model": self._model,
                "score_offset": self._score_offset,
                "score_scale": self._score_scale,
                "feature_names": FEATURE_NAMES,
            }
        joblib.dump(payload, target)
        return target

    def load(self, path: Optional[str] = None) -> bool:
        """Load a persisted model if it exists. Returns True on success."""
        import joblib

        target = path or self._model_path
        if not os.path.exists(target):
            return False
        payload = joblib.load(target)
        with self._lock:
            self._model = payload["model"]
            self._score_offset = payload.get("score_offset", 0.0)
            self._score_scale = payload.get("score_scale", 1.0) or 1.0
        return True

    def ensure_ready(self, path: Optional[str] = None) -> None:
        """Load an existing model, or train a fresh one and save it.

        Used at startup so the detector is always usable.
        """
        with self._lock:
            already = self._model is not None
        if already:
            return
        if not self.load(path):
            self.train()
            try:
                self.save(path)
            except OSError:
                # Persisting is best-effort; an in-memory model still works.
                pass


# Process-wide singleton.
detector = AnomalyDetector()
