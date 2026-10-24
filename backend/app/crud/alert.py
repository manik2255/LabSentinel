"""CRUD operations and dedupe logic for Alert."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.equipment import get_equipment
from app.crud.exceptions import ConflictError, NotFoundError
from app.models.alert import Alert


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_alert(db: Session, alert_id: int) -> Alert:
    """Return an alert by id or raise NotFoundError."""
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise NotFoundError(f"Alert {alert_id} not found")
    return alert


def list_active_alerts(
    db: Session, equipment_id: Optional[int] = None
) -> list[Alert]:
    """Return unresolved alerts (optionally filtered by equipment), newest first."""
    stmt = select(Alert).where(Alert.resolved.is_(False))
    if equipment_id is not None:
        stmt = stmt.where(Alert.equipment_id == equipment_id)
    stmt = stmt.order_by(Alert.timestamp.desc(), Alert.id.desc())
    return list(db.scalars(stmt).all())


def list_alert_history(
    db: Session, equipment_id: Optional[int] = None, limit: int = 100
) -> list[Alert]:
    """Return all alerts (resolved and active), newest first."""
    stmt = select(Alert)
    if equipment_id is not None:
        stmt = stmt.where(Alert.equipment_id == equipment_id)
    stmt = stmt.order_by(Alert.timestamp.desc(), Alert.id.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def get_active_alert(
    db: Session, equipment_id: int, alert_type: str
) -> Optional[Alert]:
    """Return the active alert of a given type for an equipment, if any."""
    stmt = (
        select(Alert)
        .where(
            Alert.equipment_id == equipment_id,
            Alert.alert_type == alert_type,
            Alert.resolved.is_(False),
        )
        .order_by(Alert.id.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def create_or_update_alert(
    db: Session,
    *,
    equipment_id: int,
    alert_type: str,
    severity: str,
    risk_level: str,
    message: str,
) -> tuple[Alert, bool]:
    """Create an alert, or refresh the existing active one of the same type.

    Prevents duplicate *active* alerts: if an unresolved alert of the same
    ``(equipment_id, alert_type)`` already exists, its severity/risk/message
    and timestamp are updated in place instead of inserting a new row.

    Returns ``(alert, created)`` where ``created`` is True for a brand-new row.
    """
    existing = get_active_alert(db, equipment_id, alert_type)
    if existing is not None:
        existing.severity = severity
        existing.risk_level = risk_level
        existing.message = message
        existing.timestamp = _utcnow()
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing, False

    alert = Alert(
        equipment_id=equipment_id,
        alert_type=alert_type,
        severity=severity,
        risk_level=risk_level,
        message=message,
        resolved=False,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert, True


def resolve_alert(db: Session, alert_id: int) -> Alert:
    """Mark an alert resolved. Raises if already resolved or missing."""
    alert = get_alert(db, alert_id)
    if alert.resolved:
        raise ConflictError(f"Alert {alert_id} is already resolved")
    alert.resolved = True
    alert.resolved_at = _utcnow()
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert
