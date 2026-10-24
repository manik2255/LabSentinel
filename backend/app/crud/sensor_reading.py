"""CRUD operations for SensorReading (temperature readings)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.equipment import get_equipment
from app.crud.exceptions import NotFoundError
from app.models.sensor_reading import SensorReading


def record_reading(
    db: Session,
    equipment_id: int,
    temperature: float,
    timestamp: Optional[datetime] = None,
) -> SensorReading:
    """Persist a single temperature reading for an equipment.

    Raises NotFoundError if the equipment does not exist.
    """
    # Ensure the equipment exists (keeps FK integrity meaningful on SQLite).
    get_equipment(db, equipment_id)

    reading = SensorReading(equipment_id=equipment_id, temperature=temperature)
    if timestamp is not None:
        reading.timestamp = timestamp
    db.add(reading)
    db.commit()
    db.refresh(reading)
    return reading


def get_latest_reading(db: Session, equipment_id: int) -> SensorReading:
    """Return the most recent reading for an equipment.

    Raises NotFoundError if the equipment does not exist or has no readings.
    """
    get_equipment(db, equipment_id)

    stmt = (
        select(SensorReading)
        .where(SensorReading.equipment_id == equipment_id)
        .order_by(SensorReading.timestamp.desc(), SensorReading.id.desc())
        .limit(1)
    )
    reading = db.scalars(stmt).first()
    if reading is None:
        raise NotFoundError(
            f"No temperature readings recorded for equipment {equipment_id}"
        )
    return reading


def get_reading_history(
    db: Session, equipment_id: int, limit: int = 100
) -> list[SensorReading]:
    """Return recent readings for an equipment, newest first.

    Raises NotFoundError if the equipment does not exist.
    """
    get_equipment(db, equipment_id)

    stmt = (
        select(SensorReading)
        .where(SensorReading.equipment_id == equipment_id)
        .order_by(SensorReading.timestamp.desc(), SensorReading.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
