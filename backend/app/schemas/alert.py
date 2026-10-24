"""Pydantic schemas for Alert."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AlertRead(BaseModel):
    """An alert returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    equipment_id: int
    alert_type: str
    severity: str
    risk_level: str
    message: str
    timestamp: datetime
    resolved: bool
    resolved_at: Optional[datetime] = None
