"""Pydantic schemas for SensorReading (temperature readings)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SensorReadingRead(BaseModel):
    """A temperature reading returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    equipment_id: int
    temperature: float
    timestamp: datetime
