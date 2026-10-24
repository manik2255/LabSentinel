"""API routes for temperature simulation and monitoring."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.schemas.sensor_reading import SensorReadingRead
from app.schemas.simulation import (
    EquipmentModeRequest,
    SimulationStartRequest,
    SimulationStatus,
)
from app.simulation import simulator

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


# ----------------------------------------------------------------------
# Simulation control
# ----------------------------------------------------------------------
@router.post("/start", response_model=SimulationStatus)
def start_simulation(payload: SimulationStartRequest | None = None) -> SimulationStatus:
    """Start the temperature simulator.

    Idempotent: if the simulator is already running, the existing loop is kept
    (no duplicate process is created) and its current status is returned.
    """
    opts = payload or SimulationStartRequest()
    simulator.start(interval_seconds=opts.interval_seconds)
    return SimulationStatus(**simulator.status())


@router.post("/stop", response_model=SimulationStatus)
def stop_simulation() -> SimulationStatus:
    """Stop the temperature simulator. Safe to call when already stopped."""
    simulator.stop()
    return SimulationStatus(**simulator.status())


@router.get("/status", response_model=SimulationStatus)
def simulation_status() -> SimulationStatus:
    """Return the current simulator status."""
    return SimulationStatus(**simulator.status())


# ----------------------------------------------------------------------
# Fault injection (abnormal temperatures / equipment failure)
# ----------------------------------------------------------------------
@router.post("/equipment/{equipment_id}/abnormal", response_model=SimulationStatus)
def set_abnormal(
    equipment_id: int,
    payload: EquipmentModeRequest | None = None,
    db: Session = Depends(get_db),
) -> SimulationStatus:
    """Enable/disable abnormal (out-of-range) temperatures for an equipment."""
    crud.equipment.get_equipment(db, equipment_id)  # 404 if missing
    opts = payload or EquipmentModeRequest()
    simulator.set_abnormal(equipment_id, opts.enabled)
    return SimulationStatus(**simulator.status())


@router.post("/equipment/{equipment_id}/fail", response_model=SimulationStatus)
def set_failed(
    equipment_id: int,
    payload: EquipmentModeRequest | None = None,
    db: Session = Depends(get_db),
) -> SimulationStatus:
    """Enable/disable a simulated hardware failure for an equipment."""
    crud.equipment.get_equipment(db, equipment_id)  # 404 if missing
    opts = payload or EquipmentModeRequest()
    simulator.set_failed(equipment_id, opts.enabled)
    return SimulationStatus(**simulator.status())


# ----------------------------------------------------------------------
# Monitoring (latest reading + history)
# ----------------------------------------------------------------------
@router.get(
    "/equipment/{equipment_id}/latest",
    response_model=SensorReadingRead,
    tags=["monitoring"],
)
def latest_reading(
    equipment_id: int, db: Session = Depends(get_db)
) -> SensorReadingRead:
    """Return the most recent temperature reading for an equipment."""
    return crud.sensor_reading.get_latest_reading(db, equipment_id)


@router.get(
    "/equipment/{equipment_id}/history",
    response_model=list[SensorReadingRead],
    tags=["monitoring"],
)
def reading_history(
    equipment_id: int,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[SensorReadingRead]:
    """Return recent temperature readings for an equipment (newest first)."""
    return crud.sensor_reading.get_reading_history(db, equipment_id, limit=limit)
