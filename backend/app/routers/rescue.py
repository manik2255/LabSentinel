"""API routes for sample rescue planning."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.rescue import service
from app.rescue.service import CONSTRAINTS_EXPLAINED
from app.schemas.rescue import (
    RescuePlanRequest,
    RescuePlanResponse,
    RescuePlanSummary,
)

router = APIRouter(prefix="/api/rescue", tags=["rescue"])


def _response_from_dict(plan_dict: dict, *, plan_id=None, created_at=None
                        ) -> RescuePlanResponse:
    """Build the API response from a stored/generated plan dict."""
    return RescuePlanResponse(
        plan_id=plan_id,
        created_at=created_at,
        feasible=plan_dict["feasible"],
        partial=plan_dict["partial"],
        rescued_count=plan_dict["rescued_count"],
        total_count=plan_dict["total_count"],
        method=plan_dict["method"],
        explanation=plan_dict["explanation"],
        objective_value=plan_dict.get("objective_value"),
        assignments=plan_dict["assignments"],
        unassigned=plan_dict["unassigned"],
        remaining_capacity=plan_dict["remaining_capacity"],
        constraints=CONSTRAINTS_EXPLAINED,
    )


@router.post("/plan", response_model=RescuePlanResponse,
             status_code=status.HTTP_201_CREATED)
def generate_rescue_plan(
    payload: RescuePlanRequest | None = None,
    db: Session = Depends(get_db),
) -> RescuePlanResponse:
    """Generate a rescue plan.

    Read-only with respect to inventory: this computes and (by default) stores
    a *proposal*; it never moves samples. Omit the body to auto-detect unsafe
    equipment and use all operational equipment as backups.
    """
    from app.rescue.serialize import result_to_dict

    req = payload or RescuePlanRequest()
    result, persisted = service.generate_plan(
        db,
        source_equipment_ids=req.source_equipment_ids,
        backup_equipment_ids=req.backup_equipment_ids,
        persist=req.persist,
    )
    plan_dict = result_to_dict(result)
    return _response_from_dict(
        plan_dict,
        plan_id=persisted.id if persisted else None,
        created_at=persisted.created_at if persisted else None,
    )


@router.get("/plans", response_model=list[RescuePlanSummary])
def list_rescue_plans(
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[RescuePlanSummary]:
    """List stored rescue plans, newest first."""
    return service.list_plans(db, limit=limit)


@router.get("/plans/{plan_id}", response_model=RescuePlanResponse)
def get_rescue_plan(plan_id: int, db: Session = Depends(get_db)
                    ) -> RescuePlanResponse:
    """Retrieve a stored rescue plan by id."""
    plan = service.get_plan(db, plan_id)
    return _response_from_dict(
        plan.plan, plan_id=plan.id, created_at=plan.created_at
    )
