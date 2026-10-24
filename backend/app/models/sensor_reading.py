"""SensorReading ORM model.

Represents a single temperature reading recorded for a piece of equipment
at a point in time.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.equipment import Equipment


def _utcnow() -> datetime:
    """Return the current timezone-aware UTC time."""
    return datetime.now(timezone.utc)


class SensorReading(Base):
    """A temperature reading from a piece of equipment."""

    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.id"), nullable=False, index=True
    )

    # Measured temperature (in degrees Celsius).
    temperature: Mapped[float] = mapped_column(Float, nullable=False)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )

    # Relationships
    equipment: Mapped["Equipment"] = relationship(
        "Equipment",
        back_populates="sensor_readings",
    )

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return (
            f"<SensorReading id={self.id} equipment_id={self.equipment_id} "
            f"temperature={self.temperature}>"
        )
