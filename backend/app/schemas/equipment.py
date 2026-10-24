"""Pydantic schemas for the Equipment resource."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EquipmentBase(BaseModel):
    """Fields shared between create and update payloads."""

    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field(..., min_length=1, max_length=100)
    location: str = Field(..., min_length=1, max_length=200)

    min_temperature: float
    max_temperature: float

    # Total storage space. Must be non-negative.
    storage_capacity: int = Field(..., ge=0)

    # Optional cap on number of samples. None => unlimited.
    sample_limit: Optional[int] = Field(default=None, ge=0)

    status: str = Field(default="operational", min_length=1, max_length=50)

    @model_validator(mode="after")
    def _check_temperature_range(self) -> "EquipmentBase":
        if self.min_temperature > self.max_temperature:
            raise ValueError(
                "min_temperature must be less than or equal to max_temperature"
            )
        return self


class EquipmentCreate(EquipmentBase):
    """Payload for creating equipment."""


class EquipmentUpdate(BaseModel):
    """Payload for updating equipment. All fields optional (partial update)."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    type: Optional[str] = Field(default=None, min_length=1, max_length=100)
    location: Optional[str] = Field(default=None, min_length=1, max_length=200)

    min_temperature: Optional[float] = None
    max_temperature: Optional[float] = None

    storage_capacity: Optional[int] = Field(default=None, ge=0)
    sample_limit: Optional[int] = Field(default=None, ge=0)

    status: Optional[str] = Field(default=None, min_length=1, max_length=50)


class EquipmentRead(EquipmentBase):
    """Equipment representation returned to clients, including derived capacity."""

    model_config = ConfigDict(from_attributes=True)

    id: int

    # Derived capacity fields (computed from assigned samples).
    used_storage: int
    available_storage: int
    used_slots: int
    available_slots: Optional[int]
