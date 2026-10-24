"""API routes for anomaly detection, equipment risk, and alerts."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.detection import detector
from app.detection.service import evaluate_and_alert
from app.schemas.alert import AlertRead
from app.schemas.detection import RiskResponse

router = APIRouter(prefix="/api/detection", tags=["detection"])


@router.get("/equipment/{equipment_id}/risk", response_model=RiskResponse)
def equipment_risk(
    equipment_id: int,
    raise_alert: bool = Query(
        default=False,
        description="If true, create/update an alert when risk is elevated.",
    ),
    db: Session = Depends(get_db),
) -> RiskResponse:
    """Compute the current anomaly risk for a piece of equipment.

    By default this is a read-only assessment. Pass ``raise_alert=true`` to
    also create or refresh an alert when risk is medium or above.
    """
    from app.detection.service import assess_equipment

    if raise_alert:
        result = evaluate_and_alert(db, equipment_id, model=detector)
    else:
        result = assess_equipment(db, equipment_id, model=detector)

    a = result.assessment
    return RiskResponse(
        equipment_id=result.equipment_id,
        temperature=result.temperature,
        risk_level=a.risk_level if a else "low",
        anomaly_score=a.anomaly_score if a else 0.0,
        is_anomaly=a.is_anomaly if a else False,
        reasons=a.reasons if a else ["no readings recorded yet"],
        endangered_samples=a.endangered_samples if a else [],
        reading_count=result.reading_count,
        insufficient_data=result.insufficient_data,
        alert_id=result.alert_id,
        alert_created=result.alert_created,
        incident_id=result.incident_id,
        incident_created=result.incident_created,
    )


@router.get("/alerts", response_model=list[AlertRead], tags=["alerts"])
def active_alerts(
    equipment_id: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[AlertRead]:
    """List active (unresolved) alerts, optionally filtered by equipment."""
    return crud.alert.list_active_alerts(db, equipment_id=equipment_id)


@router.get("/alerts/history", response_model=list[AlertRead], tags=["alerts"])
def alert_history(
    equipment_id: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[AlertRead]:
    """List alert history (resolved and active), newest first."""
    return crud.alert.list_alert_history(db, equipment_id=equipment_id, limit=limit)


@router.post("/alerts/{alert_id}/resolve", response_model=AlertRead, tags=["alerts"])
def resolve_alert(alert_id: int, db: Session = Depends(get_db)) -> AlertRead:
    """Resolve an active alert."""
    return crud.alert.resolve_alert(db, alert_id)
