"""Pydantic schemas for temperature simulation control and status."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SimulationStartRequest(BaseModel):
    """Options for starting the temperature simulator."""

    # Seconds between simulation ticks. Bounded to keep the loop sane.
    interval_seconds: float = Field(default=5.0, gt=0, le=3600)


class SimulationStatus(BaseModel):
    """Current state of the background simulator."""

    running: bool
    interval_seconds: Optional[float] = None
    ticks: int = 0
    # equipment_ids currently flagged as abnormal or failed.
    abnormal_equipment_ids: list[int] = Field(default_factory=list)
    failed_equipment_ids: list[int] = Field(default_factory=list)


class EquipmentModeRequest(BaseModel):
    """Toggle an abnormal-temperature or failure condition for an equipment.

    ``enabled`` turns the condition on (True) or off (False).
    """

    enabled: bool = True
