"""Pydantic schemas for rescue planning request/response."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class RescuePlanRequest(BaseModel):
    """Request to generate a rescue plan.

    All fields are optional so the common case ("rescue everything affected by
    unsafe equipment, using all other healthy equipment as backups") needs no
    body. Explicit lists let a caller scope the plan.
    """

    # Equipment whose samples must be evacuated. If omitted, auto-detect any
    # equipment that is not operational (e.g. offline/maintenance).
    source_equipment_ids: Optional[list[int]] = Field(
        default=None,
        description="Equipment to evacuate. Omit to auto-detect unsafe equipment.",
    )
    # Restrict which equipment may receive samples. If omitted, any other
    # operational equipment is a candidate backup.
    backup_equipment_ids: Optional[list[int]] = Field(
        default=None,
        description="Allowed backup equipment. Omit to use all operational equipment.",
    )
    # Persist the generated plan for later retrieval (default True).
    persist: bool = True


class AssignmentOut(BaseModel):
    sample_id: int
    sample_name: str
    equipment_id: int
    equipment_name: str
    storage_space: int
    priority: str


class UnassignedOut(BaseModel):
    sample_id: int
    sample_name: str
    priority: str
    reason: str
    candidate_notes: list[str] = []


class EquipmentCapacityOut(BaseModel):
    equipment_id: int
    equipment_name: str
    storage_capacity_before: int
    storage_used_by_plan: int
    storage_remaining: int
    slots_before: Optional[int] = None
    slots_used_by_plan: int
    slots_remaining: Optional[int] = None


class RescuePlanResponse(BaseModel):
    """Structured rescue plan returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    plan_id: Optional[int] = None
    created_at: Optional[datetime] = None

    feasible: bool
    partial: bool
    rescued_count: int
    total_count: int
    method: str
    explanation: str
    objective_value: Optional[float] = None

    assignments: list[AssignmentOut]
    unassigned: list[UnassignedOut]
    remaining_capacity: list[EquipmentCapacityOut]

    # Human-readable description of the constraints the optimiser enforced,
    # so the frontend can show *why* the plan looks the way it does.
    constraints: list[str] = []


class RescuePlanSummary(BaseModel):
    """Compact row for listing stored plans."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    feasible: bool
    partial: bool
    rescued_count: int
    total_count: int
    method: str
