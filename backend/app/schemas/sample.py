"""Pydantic schemas for the Sample resource."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SampleBase(BaseModel):
    """Fields shared between create and update payloads."""

    name: str = Field(..., min_length=1, max_length=200)
    equipment_id: int = Field(..., ge=1)

    min_temperature: float
    max_temperature: float

    # Storage space consumed. Each sample also takes exactly one slot.
    storage_space: int = Field(default=1, ge=1)

    priority: str = Field(default="medium", min_length=1, max_length=50)

    @model_validator(mode="after")
    def _check_temperature_range(self) -> "SampleBase":
        if self.min_temperature > self.max_temperature:
            raise ValueError(
                "min_temperature must be less than or equal to max_temperature"
            )
        return self


class SampleCreate(SampleBase):
    """Payload for creating a sample."""


class SampleUpdate(BaseModel):
    """Payload for updating a sample. All fields optional (partial update).

    Setting ``equipment_id`` moves the sample to a different piece of
    equipment (subject to capacity and temperature checks).
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    equipment_id: Optional[int] = Field(default=None, ge=1)

    min_temperature: Optional[float] = None
    max_temperature: Optional[float] = None

    storage_space: Optional[int] = Field(default=None, ge=1)
    priority: Optional[str] = Field(default=None, min_length=1, max_length=50)


class SampleRead(SampleBase):
    """Sample representation returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
