"""Pydantic schemas for incidents and their audit trail."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field


class IncidentEventRead(BaseModel):
    """One audit-trail entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    incident_id: int
    event_type: str
    explanation: str
    detail: Optional[dict[str, Any]] = None
    timestamp: datetime


class IncidentSummary(BaseModel):
    """Compact incident row for listing."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    equipment_id: int
    alert_id: Optional[int] = None
    trigger: str
    risk_severity: str
    status: str
    summary: str
    rescue_plan_id: Optional[int] = None
    rescue_plan_status: str = "none"
    rescue_execution_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class IncidentDetail(BaseModel):
    """Full incident detail, including affected samples and evidence."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    equipment_id: int
    alert_id: Optional[int] = None
    trigger: str
    risk_severity: str
    status: str
    summary: str
    affected_samples: list[dict[str, Any]] = []
    evidence: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime
    acknowledged_at: Optional[datetime] = None
    escalated_at: Optional[datetime] = None

    # Rescue-plan review (Phase 5B). Orthogonal to ``status``.
    rescue_plan_id: Optional[int] = None
    rescue_plan_status: str = "none"
    plan_reviewed_at: Optional[datetime] = None

    # Rescue-plan execution (Phase 5C).
    rescue_execution_id: Optional[int] = None
    executed_at: Optional[datetime] = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def approval_recorded(self) -> bool:
        """Backend-authoritative flag: True only when this incident's rescue
        plan has a *real, backend-recorded* approval (approved or already
        executed, with a recorded review timestamp).

        The frontend must use this - not a local/optimistic UI state - to
        decide whether an approval actually exists. A frontend-only "simulated
        approval" that never reached the backend will leave this False, and the
        execute endpoint likewise refuses to run without this backend state.
        """
        return (
            self.rescue_plan_status in ("approved", "executed")
            and self.plan_reviewed_at is not None
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def execution_recorded(self) -> bool:
        """Backend-authoritative flag: True only when a successful execution is
        recorded for this incident (samples actually moved in the database)."""
        return self.rescue_plan_status == "executed" and self.executed_at is not None


class IncidentActionRequest(BaseModel):
    """Optional note supplied when acknowledging or escalating an incident."""

    note: Optional[str] = Field(default=None, max_length=1000)


class PlanApprovalRequest(BaseModel):
    """Options for approving an incident's rescue plan."""

    # Required to approve a *partial* plan: explicit acknowledgment that the
    # unrescued samples will be left behind.
    acknowledge_unrescued: bool = False
    note: Optional[str] = Field(default=None, max_length=1000)


class PlanRejectionRequest(BaseModel):
    """Options for rejecting an incident's rescue plan."""

    note: Optional[str] = Field(default=None, max_length=1000)


class TransferOut(BaseModel):
    """One simulated sample transfer within an execution."""

    sample_id: int
    sample_name: str
    from_equipment_id: Optional[int] = None
    from_equipment_name: Optional[str] = None
    to_equipment_id: int
    to_equipment_name: str
    storage_space: int


class RescueExecutionResponse(BaseModel):
    """The result of executing an approved rescue plan."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    incident_id: int
    plan_id: int
    status: str
    transferred_sample_ids: list[int] = []
    transfers: list[TransferOut] = []
    explanation: str
    problems: Optional[list[str]] = None
    created_at: datetime
