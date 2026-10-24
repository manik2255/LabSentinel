"""Alert ORM model.

Represents an alert raised against a piece of equipment, with a severity
level, a human-readable message, a timestamp, and a resolution flag.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.equipment import Equipment


def _utcnow() -> datetime:
    """Return the current timezone-aware UTC time."""
    return datetime.now(timezone.utc)


class Alert(Base):
    """An alert raised for a piece of equipment."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.id"), nullable=False, index=True
    )

    # Severity level, e.g. "info", "warning", "critical".
    severity: Mapped[str] = mapped_column(String, nullable=False, default="warning")

    message: Mapped[str] = mapped_column(String, nullable=False)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    # Whether the alert has been resolved.
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relationships
    equipment: Mapped["Equipment"] = relationship(
        "Equipment",
        back_populates="alerts",
    )

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return (
            f"<Alert id={self.id} equipment_id={self.equipment_id} "
            f"severity={self.severity!r} resolved={self.resolved}>"
        )
