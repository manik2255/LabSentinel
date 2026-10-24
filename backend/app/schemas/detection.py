"""Pydantic schemas for detection / risk responses."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RiskResponse(BaseModel):
    """The current risk assessment for a piece of equipment."""

    equipment_id: int
    temperature: Optional[float] = None
    risk_level: str
    anomaly_score: float
    is_anomaly: bool
    reasons: list[str] = []
    endangered_samples: list[str] = []
    reading_count: int
    insufficient_data: bool
    # Set when this assessment raised or refreshed an alert.
    alert_id: Optional[int] = None
    alert_created: bool = False
    # Set when this assessment created or refreshed an incident (raise_alert
    # path only). Additive fields; default to null/false for read-only risk.
    incident_id: Optional[int] = None
    incident_created: bool = False
