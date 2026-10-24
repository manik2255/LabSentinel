"""Equipment ORM model.

Represents a piece of laboratory equipment (e.g. a freezer, fridge, or
incubator) that stores samples and is monitored by sensors.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.alert import Alert
    from app.models.sample import Sample
    from app.models.sensor_reading import SensorReading


class Equipment(Base):
    """A monitored piece of lab equipment."""

    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)

    # Acceptable operating temperature range (in degrees Celsius).
    min_temperature: Mapped[float] = mapped_column(Float, nullable=False)
    max_temperature: Mapped[float] = mapped_column(Float, nullable=False)

    # Total storage capacity (number of storage units/slots).
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Operational status, e.g. "operational", "maintenance", "offline".
    status: Mapped[str] = mapped_column(String, nullable=False, default="operational")

    # Relationships
    samples: Mapped[list["Sample"]] = relationship(
        "Sample",
        back_populates="equipment",
        cascade="all, delete-orphan",
    )
    sensor_readings: Mapped[list["SensorReading"]] = relationship(
        "SensorReading",
        back_populates="equipment",
        cascade="all, delete-orphan",
    )
    alerts: Mapped[list["Alert"]] = relationship(
        "Alert",
        back_populates="equipment",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return f"<Equipment id={self.id} name={self.name!r} status={self.status!r}>"
