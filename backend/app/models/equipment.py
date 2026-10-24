"""Equipment ORM model.

Represents a piece of laboratory equipment (e.g. a freezer, fridge, or
incubator) that stores samples and is monitored by sensors.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.alert import Alert
    from app.models.sample import Sample
    from app.models.sensor_reading import SensorReading


class Equipment(Base):
    """A monitored piece of lab equipment.

    Capacity is tracked along two independent dimensions:

    * ``storage_capacity`` - total storage space available. Each sample
      consumes ``storage_space`` units of this.
    * ``sample_limit`` - optional cap on the *number* of samples. Each
      sample takes exactly one slot. ``None`` means unlimited slots.
    """

    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    location: Mapped[str] = mapped_column(String, nullable=False)

    # Acceptable operating temperature range (in degrees Celsius).
    min_temperature: Mapped[float] = mapped_column(Float, nullable=False)
    max_temperature: Mapped[float] = mapped_column(Float, nullable=False)

    # Total storage space available (abstract storage units).
    storage_capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Optional maximum number of samples (slots). None => unlimited.
    sample_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

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

    # ------------------------------------------------------------------
    # Derived capacity helpers
    # ------------------------------------------------------------------
    @property
    def used_storage(self) -> int:
        """Total storage space consumed by currently assigned samples."""
        return sum(s.storage_space for s in self.samples)

    @property
    def available_storage(self) -> int:
        """Remaining storage space."""
        return self.storage_capacity - self.used_storage

    @property
    def used_slots(self) -> int:
        """Number of samples currently assigned (one slot each)."""
        return len(self.samples)

    @property
    def available_slots(self) -> Optional[int]:
        """Remaining sample slots, or ``None`` when ``sample_limit`` is unset."""
        if self.sample_limit is None:
            return None
        return self.sample_limit - self.used_slots

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return f"<Equipment id={self.id} name={self.name!r} status={self.status!r}>"
