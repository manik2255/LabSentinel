"""Detection service: turn readings into risk assessments and alerts.

Ties together feature engineering, the anomaly model, and risk scoring, then
persists alerts with dedupe. Designed to be called both from API endpoints
(on demand) and from the simulator (after each new reading).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.crud import alert as alert_crud
from app.crud import sensor_reading as reading_crud
from app.crud.equipment import get_equipment
from app.detection.features import WINDOW, RangeContext, compute_features
from app.detection.model import AnomalyDetector, ModelNotTrainedError, detector
from app.detection.risk import RiskAssessment, SampleRequirement, assess_risk

# Minimum number of readings before anomaly scoring is meaningful. Below this
# we fall back to range-only risk so a cold start never crashes or spams.
MIN_READINGS_FOR_SCORING = 3

# Map risk level -> alert severity.
_SEVERITY_BY_RISK = {
    "low": "info",
    "medium": "warning",
    "high": "warning",
    "critical": "critical",
}


# Risk levels that qualify for automatic incident creation.
_INCIDENT_RISK_LEVELS = {"high", "critical"}


@dataclass
class DetectionResult:
    """Full detection outcome for one equipment."""

    equipment_id: int
    temperature: Optional[float]
    assessment: Optional[RiskAssessment]
    reading_count: int
    insufficient_data: bool
    alert_id: Optional[int] = None
    alert_created: bool = False
    incident_id: Optional[int] = None
    incident_created: bool = False


def assess_equipment(
    db: Session,
    equipment_id: int,
    *,
    model: AnomalyDetector = detector,
) -> DetectionResult:
    """Compute the current risk assessment for an equipment.

    Reads recent temperatures, engineers features, scores anomaly, and blends
    with range/status/sample signals. Handles the no-/low-data case by
    returning a low-risk result flagged ``insufficient_data`` (when there are
    not even enough readings for range-based judgement).
    """
    equipment = get_equipment(db, equipment_id)

    history = reading_crud.get_reading_history(db, equipment_id, limit=WINDOW)
    # history is newest-first; features need oldest-first.
    temps = [r.temperature for r in reversed(history)]
    reading_count = len(temps)

    if reading_count == 0:
        return DetectionResult(
            equipment_id=equipment_id,
            temperature=None,
            assessment=None,
            reading_count=0,
            insufficient_data=True,
        )

    latest_temp = temps[-1]
    ctx = RangeContext(equipment.min_temperature, equipment.max_temperature)
    features = compute_features(temps, ctx)

    # Anomaly scoring. If the model is not trained or we have too little
    # history, degrade gracefully to range-only risk (score 0, no hard flag).
    anomaly_score = 0.0
    hard_anomaly = False
    scored = False
    # Captures an honest explanation of any model limitation so the API can
    # report it transparently rather than silently returning a 0 score.
    limitation: Optional[str] = None
    if reading_count >= MIN_READINGS_FOR_SCORING:
        try:
            anomaly_score = model.anomaly_score(features)
            hard_anomaly = model.is_anomaly(features)
            scored = True
        except ModelNotTrainedError:
            scored = False
            limitation = (
                "anomaly model not trained; showing range/status-based risk only"
            )
    else:
        limitation = (
            f"only {reading_count} reading(s) available; anomaly scoring needs "
            f"at least {MIN_READINGS_FOR_SCORING} - showing range/status-based "
            f"risk only"
        )

    sample_reqs = [
        SampleRequirement(
            name=s.name,
            min_temperature=s.min_temperature,
            max_temperature=s.max_temperature,
            priority=s.priority,
        )
        for s in equipment.samples
    ]

    assessment = assess_risk(
        temperature=latest_temp,
        anomaly_score=anomaly_score,
        hard_anomaly=hard_anomaly,
        equipment_min=equipment.min_temperature,
        equipment_max=equipment.max_temperature,
        equipment_status=equipment.status,
        samples=sample_reqs,
    )

    # Surface any model limitation transparently in the explanation so the
    # risk is never presented as model-backed when it is not.
    if limitation is not None:
        assessment.reasons.append(f"model limitation: {limitation}")

    return DetectionResult(
        equipment_id=equipment_id,
        temperature=latest_temp,
        assessment=assessment,
        reading_count=reading_count,
        # "insufficient_data" means we couldn't score anomalies yet, but
        # range-based risk is still reported.
        insufficient_data=not scored,
    )


def _choose_alert_type(assessment: RiskAssessment, temperature: float,
                       eq_min: float, eq_max: float) -> str:
    """Pick an alert category for dedupe grouping."""
    # A single active alert per equipment captures its current worst condition.
    # Using one logical type keeps dedupe simple and avoids alert spam.
    return "temperature_anomaly"


def evaluate_and_alert(
    db: Session,
    equipment_id: int,
    *,
    model: AnomalyDetector = detector,
) -> DetectionResult:
    """Assess an equipment and raise/update an alert when risk is elevated.

    Creates an alert only for medium risk and above. Deduplicates so there is
    at most one active alert per equipment of the anomaly type; an existing
    active alert is refreshed in place. When risk returns to low, any existing
    active alert is left for explicit resolution (we never auto-resolve here).
    """
    result = assess_equipment(db, equipment_id, model=model)

    if result.assessment is None:
        return result

    assessment = result.assessment
    equipment = get_equipment(db, equipment_id)

    if assessment.risk_level == "low":
        # Nothing worth alerting on.
        return result

    alert_type = _choose_alert_type(
        assessment, result.temperature or 0.0,
        equipment.min_temperature, equipment.max_temperature,
    )
    severity = _SEVERITY_BY_RISK.get(assessment.risk_level, "warning")
    message = (
        f"{assessment.risk_level.upper()} risk on '{equipment.name}': "
        + "; ".join(assessment.reasons[:4])
    )

    alert, created = alert_crud.create_or_update_alert(
        db,
        equipment_id=equipment_id,
        alert_type=alert_type,
        severity=severity,
        risk_level=assessment.risk_level,
        message=message,
    )
    result.alert_id = alert.id
    result.alert_created = created

    # Incident trigger policy (Phase 5):
    #   Create/refresh an incident when the assessed risk is high/critical, OR
    #   when the equipment is in a failure state (non-operational). Dedupe is
    #   handled by the CRUD layer: at most one active incident per equipment.
    equipment_failure = equipment.status.lower() != "operational"
    if assessment.risk_level in _INCIDENT_RISK_LEVELS or equipment_failure:
        _create_incident_for(
            db,
            equipment_id=equipment_id,
            equipment_name=equipment.name,
            equipment_status=equipment.status,
            assessment=assessment,
            temperature=result.temperature,
            alert_id=alert.id,
            result=result,
        )

    return result


def _build_evidence(
    db: Session, equipment_id: int, assessment: RiskAssessment,
    temperature: Optional[float],
) -> dict:
    """Assemble a telemetry evidence snapshot for an incident."""
    recent = reading_crud.get_reading_history(db, equipment_id, limit=WINDOW)
    return {
        "latest_temperature": temperature,
        "anomaly_score": assessment.anomaly_score,
        "is_anomaly": assessment.is_anomaly,
        "risk_level": assessment.risk_level,
        "reasons": list(assessment.reasons),
        "recent_readings": [
            {"temperature": r.temperature, "timestamp": r.timestamp.isoformat()}
            for r in recent
        ],
    }


def _create_incident_for(
    db: Session,
    *,
    equipment_id: int,
    equipment_name: str,
    equipment_status: str,
    assessment: RiskAssessment,
    temperature: Optional[float],
    alert_id: Optional[int],
    result: DetectionResult,
) -> None:
    """Create/refresh an incident from a qualifying assessment and record it."""
    # Imported here to avoid any import cycle at module load.
    from app.crud import incident as incident_crud

    equipment_failure = equipment_status.lower() != "operational"
    if equipment_failure:
        trigger = "equipment_failure"
    elif assessment.risk_level == "critical":
        trigger = "critical_risk"
    else:
        trigger = "high_risk"

    # Severity recorded on the incident is always high or critical.
    risk_severity = "critical" if assessment.risk_level == "critical" else "high"

    summary = (
        f"{trigger.replace('_', ' ').title()} on '{equipment_name}': "
        + "; ".join(assessment.reasons[:3])
    )
    affected = [
        {"name": n} for n in assessment.endangered_samples
    ]
    evidence = _build_evidence(db, equipment_id, assessment, temperature)

    incident, inc_created = incident_crud.create_or_refresh_incident(
        db,
        equipment_id=equipment_id,
        trigger=trigger,
        risk_severity=risk_severity,
        summary=summary,
        affected_samples=affected,
        evidence=evidence,
        alert_id=alert_id,
    )
    result.incident_id = incident.id
    result.incident_created = inc_created
