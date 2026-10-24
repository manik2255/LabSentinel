"""CRUD operations and business rules for Sample."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.equipment import get_equipment
from app.crud.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.equipment import Equipment
from app.models.sample import Sample
from app.schemas.sample import SampleCreate, SampleUpdate


def get_sample(db: Session, sample_id: int) -> Sample:
    """Return a sample by id or raise NotFoundError."""
    sample = db.get(Sample, sample_id)
    if sample is None:
        raise NotFoundError(f"Sample {sample_id} not found")
    return sample


def list_samples(db: Session, equipment_id: Optional[int] = None) -> list[Sample]:
    """Return all samples, optionally filtered by equipment."""
    stmt = select(Sample).order_by(Sample.id)
    if equipment_id is not None:
        stmt = stmt.where(Sample.equipment_id == equipment_id)
    return list(db.scalars(stmt).all())


def _check_placement(
    equipment: Equipment,
    *,
    storage_space: int,
    min_temperature: float,
    max_temperature: float,
    exclude_sample_id: Optional[int] = None,
) -> None:
    """Validate that a sample can be placed in ``equipment``.

    Checks the equipment's temperature range covers the sample's required
    range, and that there is enough free storage and (if limited) a free slot.

    ``exclude_sample_id`` ignores one existing sample when computing current
    usage - used when moving or resizing that sample so it does not count
    against itself.
    """
    # Temperature compatibility: the equipment must be able to hold the sample
    # across its entire required range.
    if (
        min_temperature < equipment.min_temperature
        or max_temperature > equipment.max_temperature
    ):
        raise ValidationError(
            f"Equipment {equipment.id} temperature range "
            f"[{equipment.min_temperature}, {equipment.max_temperature}] does not "
            f"cover the sample's required range "
            f"[{min_temperature}, {max_temperature}]"
        )

    # Compute current usage, excluding the sample being moved/resized.
    existing = [s for s in equipment.samples if s.id != exclude_sample_id]
    used_storage = sum(s.storage_space for s in existing)
    used_slots = len(existing)

    # Storage capacity check.
    available_storage = equipment.storage_capacity - used_storage
    if storage_space > available_storage:
        raise ConflictError(
            f"Equipment {equipment.id} has {available_storage} storage unit(s) "
            f"free; sample requires {storage_space}"
        )

    # Slot (sample-count) check, only when a limit is configured.
    if equipment.sample_limit is not None:
        available_slots = equipment.sample_limit - used_slots
        if available_slots < 1:
            raise ConflictError(
                f"Equipment {equipment.id} has reached its sample limit of "
                f"{equipment.sample_limit}"
            )


def create_sample(db: Session, data: SampleCreate) -> Sample:
    """Create a sample, validating placement against its target equipment."""
    equipment = get_equipment(db, data.equipment_id)

    _check_placement(
        equipment,
        storage_space=data.storage_space,
        min_temperature=data.min_temperature,
        max_temperature=data.max_temperature,
    )

    sample = Sample(
        name=data.name,
        equipment_id=data.equipment_id,
        min_temperature=data.min_temperature,
        max_temperature=data.max_temperature,
        storage_space=data.storage_space,
        priority=data.priority,
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return sample


def update_sample(db: Session, sample_id: int, data: SampleUpdate) -> Sample:
    """Update a sample, re-validating placement if space/temp/equipment change.

    Supports moving the sample to different equipment via ``equipment_id``.
    """
    sample = get_sample(db, sample_id)
    update_fields = data.model_dump(exclude_unset=True)

    # Resolve effective values after the update.
    new_equipment_id = update_fields.get("equipment_id", sample.equipment_id)
    new_storage = update_fields.get("storage_space", sample.storage_space)
    new_min = update_fields.get("min_temperature", sample.min_temperature)
    new_max = update_fields.get("max_temperature", sample.max_temperature)

    if new_min > new_max:
        raise ValidationError(
            "min_temperature must be less than or equal to max_temperature"
        )

    # Re-check placement only when something capacity/temperature relevant
    # changed (target equipment, storage, or temperature range).
    placement_relevant = {
        "equipment_id",
        "storage_space",
        "min_temperature",
        "max_temperature",
    }
    if placement_relevant & update_fields.keys():
        target = get_equipment(db, new_equipment_id)
        _check_placement(
            target,
            storage_space=new_storage,
            min_temperature=new_min,
            max_temperature=new_max,
            # Exclude this sample from usage when it stays on the same
            # equipment; when moving, it is not part of the target anyway.
            exclude_sample_id=sample.id,
        )

    for field, value in update_fields.items():
        setattr(sample, field, value)

    db.commit()
    db.refresh(sample)
    return sample


def delete_sample(db: Session, sample_id: int) -> None:
    """Delete a sample."""
    sample = get_sample(db, sample_id)
    db.delete(sample)
    db.commit()
