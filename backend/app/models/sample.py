"""Sample ORM model.

Represents a biological or chemical sample stored inside a piece of
equipment, with its own temperature requirements and priority.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.equipment import Equipment


class Sample(Base):
    """A stored sample assigned to a piece of equipment."""

    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # Assigned equipment (foreign key + relationship).
    equipment_id: Mapped[int] = mapped_column(
        ForeignKey("equipment.id"), nullable=False, index=True
    )

    # Required storage temperature range (in degrees Celsius).
    min_temperature: Mapped[float] = mapped_column(Float, nullable=False)
    max_temperature: Mapped[float] = mapped_column(Float, nullable=False)

    # Amount of storage space this sample occupies (in storage units/slots).
    storage_space: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Priority ranking, e.g. "low", "medium", "high", "critical".
    priority: Mapped[str] = mapped_column(String, nullable=False, default="medium")

    # Relationships
    equipment: Mapped["Equipment"] = relationship(
        "Equipment",
        back_populates="samples",
    )

    def __repr__(self) -> str:  # pragma: no cover - convenience only
        return f"<Sample id={self.id} name={self.name!r} priority={self.priority!r}>"
