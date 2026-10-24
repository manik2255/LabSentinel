"""RescueExecution ORM model (Phase 5C).

Persists the record of an attempt to *execute* an approved incident rescue
plan. Execution is a simulated transfer: it updates sample ``equipment_id``
values in the database to reflect samples being moved to their approved backup
equipment. It never performs a real physical transfer.

One row is written per execution attempt (success or failure), linked to the
incident and the plan it executed, so the outcome is auditable and
retrievable. A failed attempt must never leave inventory partially changed -
the service layer runs all moves in a single transaction and rolls back on any
error, recording the failure here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Execution result states.
EXECUTION_SUCCESS = "success"
EXECUTION_FAILED = "failed"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RescueExecution(Base):
    """A record of one attempt to execute an approved rescue plan."""

    __tablename__ = "rescue_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id"), nullable=False, index=True
    )
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("rescue_plans.id"), nullable=False, index=True
    )

    # "success" or "failed".
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Sample ids that were actually moved (empty on failure after rollback).
    transferred_sample_ids: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list
    )

    # Full per-transfer detail: [{sample_id, sample_name, from_equipment_id,
    # from_equipment_name, to_equipment_id, to_equipment_name}]. On failure this
    # records what was *attempted* (not applied, since the tx rolled back).
    transfers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Human-readable outcome explanation.
    explanation: Mapped[str] = mapped_column(String, nullable=False)

    # Structured problems when status == "failed".
    problems: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return (
            f"<RescueExecution id={self.id} incident_id={self.incident_id} "
            f"plan_id={self.plan_id} status={self.status!r}>"
        )
