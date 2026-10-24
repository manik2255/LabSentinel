"""CRUD operations and business rules for Equipment."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.equipment import Equipment
from app.schemas.equipment import EquipmentCreate, EquipmentUpdate


def get_equipment(db: Session, equipment_id: int) -> Equipment:
    """Return equipment by id or raise NotFoundError."""
    equipment = db.get(Equipment, equipment_id)
    if equipment is None:
        raise NotFoundError(f"Equipment {equipment_id} not found")
    return equipment


def list_equipment(db: Session) -> list[Equipment]:
    """Return all equipment ordered by id."""
    return list(db.scalars(select(Equipment).order_by(Equipment.id)).all())


def create_equipment(db: Session, data: EquipmentCreate) -> Equipment:
    """Create a new piece of equipment."""
    equipment = Equipment(
        name=data.name,
        type=data.type,
        location=data.location,
        min_temperature=data.min_temperature,
        max_temperature=data.max_temperature,
        storage_capacity=data.storage_capacity,
        sample_limit=data.sample_limit,
        status=data.status,
    )
    db.add(equipment)
    db.commit()
    db.refresh(equipment)
    return equipment


def update_equipment(
    db: Session, equipment_id: int, data: EquipmentUpdate
) -> Equipment:
    """Apply a partial update to equipment, enforcing capacity invariants.

    Rules:
    * A temperature range must stay ordered (min <= max).
    * ``storage_capacity`` cannot be reduced below the storage already used.
    * ``sample_limit`` cannot be set below the number of samples already held.
    """
    equipment = get_equipment(db, equipment_id)

    update_fields = data.model_dump(exclude_unset=True)

    # Resolve the effective temperature range after the update for validation.
    new_min = update_fields.get("min_temperature", equipment.min_temperature)
    new_max = update_fields.get("max_temperature", equipment.max_temperature)
    if new_min > new_max:
        raise ValidationError(
            "min_temperature must be less than or equal to max_temperature"
        )

    # Guard storage_capacity against the currently used storage.
    if "storage_capacity" in update_fields:
        new_capacity = update_fields["storage_capacity"]
        used = equipment.used_storage
        if new_capacity < used:
            raise ConflictError(
                f"Cannot set storage_capacity to {new_capacity}: "
                f"{used} unit(s) are already in use"
            )

    # Guard sample_limit against the current number of samples.
    if "sample_limit" in update_fields:
        new_limit = update_fields["sample_limit"]
        used_slots = equipment.used_slots
        if new_limit is not None and new_limit < used_slots:
            raise ConflictError(
                f"Cannot set sample_limit to {new_limit}: "
                f"{used_slots} sample(s) are already stored"
            )

    for field, value in update_fields.items():
        setattr(equipment, field, value)

    db.commit()
    db.refresh(equipment)
    return equipment


def delete_equipment(db: Session, equipment_id: int) -> None:
    """Delete equipment, refusing if it still contains samples."""
    equipment = get_equipment(db, equipment_id)
    if equipment.samples:
        raise ConflictError(
            f"Cannot delete equipment {equipment_id}: it still contains "
            f"{len(equipment.samples)} sample(s)"
        )
    db.delete(equipment)
    db.commit()
