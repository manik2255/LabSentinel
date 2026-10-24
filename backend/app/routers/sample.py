"""API routes for Sample management."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.schemas.sample import SampleCreate, SampleRead, SampleUpdate

router = APIRouter(prefix="/api/samples", tags=["samples"])


@router.get("", response_model=list[SampleRead])
def list_samples(
    equipment_id: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[SampleRead]:
    """List all samples, optionally filtered by equipment."""
    return crud.sample.list_samples(db, equipment_id=equipment_id)


@router.post("", response_model=SampleRead, status_code=status.HTTP_201_CREATED)
def create_sample(payload: SampleCreate, db: Session = Depends(get_db)) -> SampleRead:
    """Create a new sample, validating capacity and temperature compatibility."""
    return crud.sample.create_sample(db, payload)


@router.get("/{sample_id}", response_model=SampleRead)
def get_sample(sample_id: int, db: Session = Depends(get_db)) -> SampleRead:
    """Retrieve a single sample."""
    return crud.sample.get_sample(db, sample_id)


@router.patch("/{sample_id}", response_model=SampleRead)
def update_sample(
    sample_id: int, payload: SampleUpdate, db: Session = Depends(get_db)
) -> SampleRead:
    """Update or move a sample, re-validating capacity and temperature."""
    return crud.sample.update_sample(db, sample_id, payload)


@router.delete("/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sample(sample_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a sample."""
    crud.sample.delete_sample(db, sample_id)
