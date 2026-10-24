"""RescuePlan ORM model.

Persists a generated rescue plan so it can be retrieved later. Storing the
plan is purely a record of a *proposal*; it never moves samples or changes
inventory (planning is separate from execution).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RescuePlan(Base):
    """A stored, read-only rescue plan proposal."""

    __tablename__ = "rescue_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    # Overall feasibility summary (denormalised for quick listing/filtering).
    feasible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    partial: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rescued_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    method: Mapped[str] = mapped_column(String, nullable=False, default="milp")

    # Full structured plan payload (assignments, unassigned, capacity, etc.).
    plan: Mapped[dict] = mapped_column(JSON, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return (
            f"<RescuePlan id={self.id} feasible={self.feasible} "
            f"rescued={self.rescued_count}/{self.total_count}>"
        )
