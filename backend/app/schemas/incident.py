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
    recovery_status: str = "pending"
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

    # Recovery verification & closure (Phase 5D).
    recovery_status: str = "pending"
    unrescued_acknowledged: bool = False
    recovery_notes: Optional[str] = None
    recovery_recorded_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def recovery_recorded(self) -> bool:
        """Backend-authoritative flag: True only when the operator has recorded
        a recovery outcome (not 'pending'). Transfer success alone never sets
        this - it reflects an explicit operator confirmation."""
        return self.recovery_status != "pending"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def closed(self) -> bool:
        """Backend-authoritative flag: True only when the incident is closed."""
        return self.status == "closed"

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


class RecoveryRequest(BaseModel):
    """Operator-confirmed recovery outcome for an executed rescue."""

    # One of: "completed", "partial", "unresolved". Records what the operator
    # actually confirmed; it is NOT an assertion that samples are viable.
    outcome: str
    notes: Optional[str] = Field(default=None, max_length=2000)
    # Must be True to close later when samples were left unrescued.
    unrescued_acknowledged: bool = False


class IncidentCloseRequest(BaseModel):
    """Explicit confirmation required to close an incident."""

    confirm: bool = False
    note: Optional[str] = Field(default=None, max_length=1000)


class TimelineEvent(BaseModel):
    """One entry in the incident report timeline (from the audit trail)."""

    event_type: str
    explanation: str
    timestamp: Optional[datetime] = None


class ReportEquipment(BaseModel):
    equipment_id: int
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None


class ReportSampleCounts(BaseModel):
    affected: int
    rescued: int
    unrescued: int
    rescue_executed: bool


class IncidentReport(BaseModel):
    """Read-only aggregated report for a single incident.

    Built entirely from stored data (incident, rescue plan, execution, audit
    events). Sections that have not happened yet are null/empty rather than
    assumed.
    """

    incident_id: int
    status: str
    summary: str
    trigger: str
    risk_severity: str
    generated_from: str

    equipment: ReportEquipment
    sample_counts: ReportSampleCounts

    transfers: list[dict[str, Any]] = []
    rescued_sample_ids: list[int] = []
    unrescued_samples: list[dict[str, Any]] = []

    rescue_plan_status: str
    rescue_plan: Optional[dict[str, Any]] = None
    execution: Optional[dict[str, Any]] = None
    recovery: dict[str, Any]
    timestamps: dict[str, Any]
    timeline: list[TimelineEvent] = []


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
