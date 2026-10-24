"""Incident and IncidentEvent ORM models (Phase 5).

An **Incident** is a persistent record of a significant equipment problem
(qualifying high/critical risk or an equipment failure). Incidents are kept
separate from alerts: an alert is a transient "something is wrong right now"
signal that can be resolved, whereas an incident is a durable case record with
its own lifecycle and a full audit trail that survives alert resolution.

An **IncidentEvent** is one entry in that audit trail - every important thing
that happens to an incident (creation, evidence refresh, acknowledgment,
escalation) is recorded with a timestamp and a human-readable explanation.

Lifecycle states implemented in this phase only:
    open -> acknowledged -> escalated
(open may also go straight to escalated). Closure / rescue / recovery states
are intentionally deferred to later phases.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.equipment import Equipment


# Lifecycle states.
INCIDENT_OPEN = "open"
INCIDENT_ACKNOWLEDGED = "acknowledged"
INCIDENT_ESCALATED = "escalated"
INCIDENT_CLOSED = "closed"  # terminal (Phase 5D: after recovery is confirmed)

# States in which an incident is considered "active" (not terminal). ``closed``
# is the only terminal state.
ACTIVE_STATES = (INCIDENT_OPEN, INCIDENT_ACKNOWLEDGED, INCIDENT_ESCALATED)

# --- Recovery outcome (Phase 5D) -------------------------------------
# An operator-confirmed verdict on the rescue, recorded only after an execution
# exists. Transfer success is NOT assumed to mean the sample is safe/viable -
# the operator records what was actually confirmed.
RECOVERY_PENDING = "pending"        # no recovery outcome recorded yet
RECOVERY_COMPLETED = "completed"    # operator confirms the rescue fully succeeded
RECOVERY_PARTIAL = "partial"        # some samples rescued, some not
RECOVERY_UNRESOLVED = "unresolved"  # problems remain / outcome not confirmed good
RECOVERY_OUTCOMES = (RECOVERY_COMPLETED, RECOVERY_PARTIAL, RECOVERY_UNRESOLVED)

# Rescue-plan approval status (Phase 5B). This is an *orthogonal* dimension to
# the incident lifecycle above: an incident may be open/acknowledged/escalated
# independently of whether a rescue plan has been proposed and reviewed. This
# keeps escalation non-blocking for rescue planning and leaves the existing
# open/acknowledged/escalated state machine untouched.
PLAN_STATUS_NONE = "none"          # no plan associated yet
PLAN_STATUS_PLANNED = "planned"    # a plan is attached, awaiting human review
PLAN_STATUS_APPROVED = "approved"  # a plan was reviewed and approved
PLAN_STATUS_REJECTED = "rejected"  # a plan was reviewed and rejected
PLAN_STATUS_EXECUTED = "executed"  # an approved plan was executed (Phase 5C)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Incident(Base):
    """A durable incident case record linked to equipment and (optionally) an alert."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.id"), nullable=False, index=True
    )

    # Link to the alert that triggered/represents this incident. Nullable and
    # NOT a cascade target: the incident must survive alert resolution/deletion
    # conceptually, so we only store the id reference.
    alert_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("alerts.id"), nullable=True, index=True
    )

    # Why the incident exists: "high_risk", "critical_risk", "equipment_failure".
    trigger: Mapped[str] = mapped_column(String, nullable=False)

    # Risk severity at creation / last refresh: "high" or "critical".
    risk_severity: Mapped[str] = mapped_column(String, nullable=False)

    # Lifecycle state (see constants above).
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=INCIDENT_OPEN, index=True
    )

    # Short human-readable summary.
    summary: Mapped[str] = mapped_column(String, nullable=False)

    # Snapshot of affected samples at detection time (list of dicts).
    affected_samples: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Supporting telemetry evidence (recent readings, score, reasons).
    evidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    escalated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- Rescue-plan review (Phase 5B) ---------------------------------
    # The currently associated rescue plan (a stored proposal) and its review
    # status. Orthogonal to ``status`` above. A plan link is never cascade;
    # we keep only the id reference so plan history survives.
    rescue_plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rescue_plans.id"), nullable=True, index=True
    )
    rescue_plan_status: Mapped[str] = mapped_column(
        String, nullable=False, default=PLAN_STATUS_NONE
    )
    plan_reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- Rescue-plan execution (Phase 5C) ------------------------------
    # The execution record for the approved plan, once executed. Id reference
    # only (no cascade) so the execution history survives. ``use_alter=True``
    # breaks the incidents<->rescue_executions FK cycle for DDL ordering
    # (create_all/drop_all) - without it SQLAlchemy warns it cannot sort.
    rescue_execution_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rescue_executions.id", use_alter=True, name="fk_incident_rescue_execution"),
        nullable=True, index=True,
    )
    executed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- Recovery verification & closure (Phase 5D) --------------------
    # Operator-confirmed recovery outcome. Orthogonal to the lifecycle
    # ``status`` until closure. Defaults to "pending" (nothing confirmed yet).
    recovery_status: Mapped[str] = mapped_column(
        String, nullable=False, default=RECOVERY_PENDING
    )
    # Count of samples the operator acknowledged as NOT rescued (if any).
    unrescued_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    recovery_notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    recovery_recorded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    equipment: Mapped["Equipment"] = relationship("Equipment")
    events: Mapped[list["IncidentEvent"]] = relationship(
        "IncidentEvent",
        back_populates="incident",
        cascade="all, delete-orphan",
        order_by="IncidentEvent.timestamp",
    )

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_STATES

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<Incident id={self.id} equipment_id={self.equipment_id} "
            f"status={self.status!r} severity={self.risk_severity!r}>"
        )


class IncidentEvent(Base):
    """One entry in an incident's audit trail."""

    __tablename__ = "incident_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id"), nullable=False, index=True
    )

    # e.g. "created", "evidence_updated", "acknowledged", "escalated".
    event_type: Mapped[str] = mapped_column(String, nullable=False)

    # Human-readable explanation of what happened and why.
    explanation: Mapped[str] = mapped_column(String, nullable=False)

    # Optional structured detail (e.g. from_state/to_state, score).
    detail: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    incident: Mapped["Incident"] = relationship("Incident", back_populates="events")

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<IncidentEvent id={self.id} incident_id={self.incident_id} "
            f"type={self.event_type!r}>"
        )
