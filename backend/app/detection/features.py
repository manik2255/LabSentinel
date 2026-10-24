"""Feature engineering for temperature anomaly detection.

Given a time-ordered window of recent temperatures for one piece of equipment
(oldest first) plus that equipment's acceptable range, we derive features that
describe *behaviour*, not just the raw value:

* ``deviation``       - how far the latest reading sits from the range centre,
                        normalised by the half-range (0 = centre, 1 = at an
                        edge, >1 = outside the range).
* ``rate_of_change``  - normalised difference between the latest reading and
                        the previous one (captures sudden jumps).
* ``rolling_mean_dev``- deviation of the window's rolling mean from the centre
                        (captures sustained drift).
* ``rolling_std``     - normalised variability across the window (captures
                        instability / noise).

All features are normalised by the equipment's half-range so the model and the
risk logic behave consistently across equipment with very different ranges.

The same WINDOW size and feature order are used for both training and
inference, so a model trained on synthetic data lines up with live features.
"""

from __future__ import annotations

from dataclasses import dataclass

# Number of most-recent readings used to compute a feature vector.
WINDOW = 10

# Stable feature order shared by training and inference.
FEATURE_NAMES = ["deviation", "rate_of_change", "rolling_mean_dev", "rolling_std"]


@dataclass(frozen=True)
class RangeContext:
    """The acceptable temperature range for a piece of equipment."""

    min_temperature: float
    max_temperature: float

    @property
    def centre(self) -> float:
        return (self.min_temperature + self.max_temperature) / 2.0

    @property
    def half_range(self) -> float:
        # Guard against a zero/near-zero range so normalisation never divides
        # by zero.
        return max((self.max_temperature - self.min_temperature) / 2.0, 0.5)


def compute_features(temps: list[float], ctx: RangeContext) -> list[float]:
    """Compute the feature vector for the most recent reading in ``temps``.

    ``temps`` must be time-ordered oldest-first and contain at least one value.
    Shorter-than-WINDOW windows are handled gracefully (rate of change and
    variability degrade to 0 when there is not enough history).
    """
    if not temps:
        raise ValueError("temps must contain at least one value")

    window = temps[-WINDOW:]
    centre = ctx.centre
    half = ctx.half_range

    latest = window[-1]
    deviation = (latest - centre) / half

    if len(window) >= 2:
        rate_of_change = (window[-1] - window[-2]) / half
    else:
        rate_of_change = 0.0

    mean = sum(window) / len(window)
    rolling_mean_dev = (mean - centre) / half

    if len(window) >= 2:
        variance = sum((t - mean) ** 2 for t in window) / len(window)
        rolling_std = (variance**0.5) / half
    else:
        rolling_std = 0.0

    return [deviation, rate_of_change, rolling_mean_dev, rolling_std]
