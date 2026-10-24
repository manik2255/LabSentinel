"""API routes for Equipment management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.schemas.equipment import EquipmentCreate, EquipmentRead, EquipmentUpdate

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


@router.get("", response_model=list[EquipmentRead])
def list_equipment(db: Session = Depends(get_db)) -> list[EquipmentRead]:
    """List all equipment."""
    return crud.equipment.list_equipment(db)


@router.post("", response_model=EquipmentRead, status_code=status.HTTP_201_CREATED)
def create_equipment(
    payload: EquipmentCreate, db: Session = Depends(get_db)
) -> EquipmentRead:
    """Create a new piece of equipment."""
    return crud.equipment.create_equipment(db, payload)


@router.get("/{equipment_id}", response_model=EquipmentRead)
def get_equipment(equipment_id: int, db: Session = Depends(get_db)) -> EquipmentRead:
    """Retrieve a single piece of equipment, including derived capacity."""
    return crud.equipment.get_equipment(db, equipment_id)


@router.patch("/{equipment_id}", response_model=EquipmentRead)
def update_equipment(
    equipment_id: int, payload: EquipmentUpdate, db: Session = Depends(get_db)
) -> EquipmentRead:
    """Partially update a piece of equipment."""
    return crud.equipment.update_equipment(db, equipment_id, payload)


@router.delete("/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(equipment_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a piece of equipment (only if it holds no samples)."""
    crud.equipment.delete_equipment(db, equipment_id)
