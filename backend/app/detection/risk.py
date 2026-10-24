"""Explainable risk-level scoring.

Combines the model's anomaly score with deterministic domain signals - whether
the latest reading violates the equipment's range, the equipment's operational
status, and the requirements of any stored samples - into one of four risk
levels with human-readable reasons.

Keeping this logic separate from the model keeps the output *explainable*: the
anomaly score contributes, but range violations, an offline unit, or at-risk
high-priority samples can escalate the level on their own, and each contributing
factor is reported back to the caller.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Ordered risk levels, lowest to highest.
RISK_LEVELS = ["low", "medium", "high", "critical"]


def _max_level(a: str, b: str) -> str:
    """Return the higher of two risk levels."""
    return a if RISK_LEVELS.index(a) >= RISK_LEVELS.index(b) else b


@dataclass
class SampleRequirement:
    """Minimal view of a stored sample needed for risk assessment."""

    name: str
    min_temperature: float
    max_temperature: float
    priority: str = "medium"


@dataclass
class RiskAssessment:
    """The outcome of a risk evaluation."""

    risk_level: str
    anomaly_score: float
    is_anomaly: bool
    reasons: list[str] = field(default_factory=list)
    # Highest-priority sample currently endangered, if any.
    endangered_samples: list[str] = field(default_factory=list)


def _level_from_score(score: float, hard_anomaly: bool) -> tuple[str, str]:
    """Base risk level derived from the anomaly score alone.

    The calibrated soft score is the sole model signal here. The forest's hard
    ``predict`` flag is deliberately NOT used to raise the level on its own:
    near the decision boundary it flips on transient, still-in-range jitter,
    which produced false alarms. Genuine problems either push the soft score
    clearly up (>=0.75) or trip the deterministic range/status/sample rules in
    ``assess_risk``. The ``hard_anomaly`` flag is still reported to callers via
    ``is_anomaly`` for transparency.
    """
    if score >= 0.9:
        return "high", f"anomaly score very high ({score:.2f})"
    if score >= 0.75:
        return "medium", f"anomaly score elevated ({score:.2f})"
    if score >= 0.6:
        return "low", f"anomaly score slightly elevated ({score:.2f})"
    return "low", f"behaviour within normal bounds ({score:.2f})"


def assess_risk(
    *,
    temperature: float,
    anomaly_score: float,
    hard_anomaly: bool,
    equipment_min: float,
    equipment_max: float,
    equipment_status: str,
    samples: Optional[list[SampleRequirement]] = None,
) -> RiskAssessment:
    """Produce an explainable risk assessment for an equipment reading.

    Escalation rules (each can only raise the level):

    * Base level comes from the anomaly score.
    * Reading outside the equipment range -> at least ``high``.
    * Reading far outside the range (>50% of half-range beyond an edge) ->
      ``critical`` (consistent with sensor/hardware failure).
    * Equipment not ``operational`` (e.g. ``offline``) -> at least ``high``.
    * A stored sample's own safe range is violated -> at least ``high``;
      ``critical`` if that sample is high/critical priority.
    """
    samples = samples or []
    reasons: list[str] = []

    level, base_reason = _level_from_score(anomaly_score, hard_anomaly)
    reasons.append(base_reason)

    half_range = max((equipment_max - equipment_min) / 2.0, 0.5)

    # Range violation on the equipment itself.
    if temperature < equipment_min or temperature > equipment_max:
        if temperature < equipment_min:
            overshoot = equipment_min - temperature
            side = f"below minimum ({equipment_min})"
        else:
            overshoot = temperature - equipment_max
            side = f"above maximum ({equipment_max})"
        reasons.append(f"temperature {temperature} is {side}")
        level = _max_level(level, "high")
        if overshoot > 0.5 * half_range:
            reasons.append("excursion far outside range (possible failure)")
            level = _max_level(level, "critical")

    # Equipment operational status.
    if equipment_status and equipment_status.lower() != "operational":
        reasons.append(f"equipment status is '{equipment_status}'")
        level = _max_level(level, "high")

    # Stored sample requirements.
    endangered: list[str] = []
    for s in samples:
        if temperature < s.min_temperature or temperature > s.max_temperature:
            endangered.append(s.name)
            reasons.append(
                f"sample '{s.name}' safe range "
                f"[{s.min_temperature}, {s.max_temperature}] violated"
            )
            if s.priority.lower() in ("high", "critical"):
                reasons.append(f"sample '{s.name}' is {s.priority} priority")
                level = _max_level(level, "critical")
            else:
                level = _max_level(level, "high")

    return RiskAssessment(
        risk_level=level,
        anomaly_score=anomaly_score,
        is_anomaly=hard_anomaly or level != "low",
        reasons=reasons,
        endangered_samples=endangered,
    )
