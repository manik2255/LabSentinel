"""API routes for incident management and the audit trail."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.models.incident import ACTIVE_STATES
from app.rescue.service import CONSTRAINTS_EXPLAINED
from app.schemas.incident import (
    IncidentActionRequest,
    IncidentCloseRequest,
    IncidentDetail,
    IncidentEventRead,
    IncidentReport,
    IncidentSummary,
    PlanApprovalRequest,
    PlanRejectionRequest,
    RecoveryRequest,
    RescueExecutionResponse,
)
from app.schemas.rescue import RescuePlanResponse

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

# Statuses a client may filter by (the lifecycle states this phase supports).
_VALID_STATUSES = set(ACTIVE_STATES)


@router.get("", response_model=list[IncidentSummary])
def list_incidents(
    equipment_id: Optional[int] = Query(default=None, ge=1),
    status: Optional[str] = Query(
        default=None, description="Filter by lifecycle state."
    ),
    active_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[IncidentSummary]:
    """List incidents, newest first, with optional filters."""
    return crud.incident.list_incidents(
        db,
        equipment_id=equipment_id,
        status=status if status in _VALID_STATUSES else None,
        active_only=active_only,
        limit=limit,
    )


@router.get("/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: int, db: Session = Depends(get_db)) -> IncidentDetail:
    """Retrieve full incident detail."""
    return crud.incident.get_incident(db, incident_id)


@router.get("/{incident_id}/events", response_model=list[IncidentEventRead])
def incident_events(
    incident_id: int, db: Session = Depends(get_db)
) -> list[IncidentEventRead]:
    """Retrieve an incident's audit trail (oldest first)."""
    return crud.incident.list_events(db, incident_id)


@router.get("/{incident_id}/report", response_model=IncidentReport)
def incident_report(
    incident_id: int, db: Session = Depends(get_db)
) -> IncidentReport:
    """Read-only incident report aggregated from existing data.

    Summarises what happened: the failed equipment, sample counts (affected /
    rescued / unrescued), where samples were transferred, why some could not be
    rescued, the rescue-plan status, the final recovery outcome, and a timeline
    of audit events. Works at any incident stage and never modifies data.
    """
    from app.reporting import build_incident_report

    return build_incident_report(db, incident_id)


@router.post("/{incident_id}/acknowledge", response_model=IncidentDetail)
def acknowledge_incident(
    incident_id: int,
    payload: IncidentActionRequest | None = None,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Acknowledge an open incident (open -> acknowledged)."""
    note = payload.note if payload else None
    return crud.incident.acknowledge_incident(db, incident_id, note=note)


@router.post("/{incident_id}/escalate", response_model=IncidentDetail)
def escalate_incident(
    incident_id: int,
    payload: IncidentActionRequest | None = None,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Escalate an open or acknowledged incident (-> escalated).

    Escalation is an auditable action and does NOT block rescue planning.
    """
    note = payload.note if payload else None
    return crud.incident.escalate_incident(db, incident_id, note=note)


# ----------------------------------------------------------------------
# Rescue-plan review (Phase 5B)
# ----------------------------------------------------------------------
def _plan_response(plan) -> RescuePlanResponse:
    """Build a RescuePlanResponse from a stored RescuePlan row."""
    d = plan.plan
    return RescuePlanResponse(
        plan_id=plan.id,
        created_at=plan.created_at,
        feasible=d["feasible"],
        partial=d["partial"],
        rescued_count=d["rescued_count"],
        total_count=d["total_count"],
        method=d["method"],
        explanation=d["explanation"],
        objective_value=d.get("objective_value"),
        assignments=d["assignments"],
        unassigned=d["unassigned"],
        remaining_capacity=d["remaining_capacity"],
        constraints=CONSTRAINTS_EXPLAINED,
    )


@router.post("/{incident_id}/plan", response_model=RescuePlanResponse,
             status_code=201)
def generate_incident_plan(
    incident_id: int, db: Session = Depends(get_db)
) -> RescuePlanResponse:
    """Generate (or regenerate) a rescue plan for an incident.

    Read-only with respect to inventory. Associates the plan with the incident
    and sets its review status to 'planned'. Regenerating supersedes any prior
    plan and resets review status.
    """
    _incident, plan = crud.incident.generate_incident_plan(db, incident_id)
    return _plan_response(plan)


@router.get("/{incident_id}/plan", response_model=RescuePlanResponse)
def get_incident_plan(
    incident_id: int, db: Session = Depends(get_db)
) -> RescuePlanResponse:
    """Retrieve the rescue plan currently associated with an incident."""
    plan = crud.incident.get_incident_plan(db, incident_id)
    return _plan_response(plan)


@router.post("/{incident_id}/plan/approve", response_model=IncidentDetail)
def approve_incident_plan(
    incident_id: int,
    payload: PlanApprovalRequest | None = None,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Approve the incident's rescue plan after revalidation.

    Full approval requires a feasible plan; partial plans require
    ``acknowledge_unrescued=true``. The plan is revalidated against current
    inventory and approval is refused if anything changed. Approval never moves
    samples or modifies inventory.
    """
    req = payload or PlanApprovalRequest()
    return crud.incident.approve_incident_plan(
        db, incident_id,
        acknowledge_unrescued=req.acknowledge_unrescued,
        note=req.note,
    )


@router.post("/{incident_id}/plan/reject", response_model=IncidentDetail)
def reject_incident_plan(
    incident_id: int,
    payload: PlanRejectionRequest | None = None,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Reject the incident's rescue plan. A new plan must then be generated."""
    note = payload.note if payload else None
    return crud.incident.reject_incident_plan(db, incident_id, note=note)


# ----------------------------------------------------------------------
# Rescue-plan execution (Phase 5C)
# ----------------------------------------------------------------------
@router.post("/{incident_id}/plan/execute", response_model=RescueExecutionResponse,
             status_code=201)
def execute_incident_plan(
    incident_id: int, db: Session = Depends(get_db)
) -> RescueExecutionResponse:
    """Execute an incident's APPROVED rescue plan (simulated sample transfer).

    Revalidates the approved assignments against current inventory, then moves
    the approved samples atomically in one transaction. On any problem nothing
    is moved and a clear error is returned. Does not perform recovery
    verification or close the incident.
    """
    _incident, execution = crud.incident.execute_incident_plan(db, incident_id)
    return execution


@router.get("/{incident_id}/plan/execution", response_model=RescueExecutionResponse)
def get_incident_execution(
    incident_id: int, db: Session = Depends(get_db)
) -> RescueExecutionResponse:
    """Retrieve the execution result for an incident's rescue plan."""
    return crud.incident.get_incident_execution(db, incident_id)


# ----------------------------------------------------------------------
# Recovery verification & incident closure (Phase 5D)
# ----------------------------------------------------------------------
@router.post("/{incident_id}/recovery", response_model=IncidentDetail)
def record_recovery(
    incident_id: int,
    payload: RecoveryRequest,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Record the operator-confirmed recovery outcome after a rescue execution.

    ``outcome`` must be completed / partial / unresolved. This records only
    what the operator confirms and makes no assumption about sample viability.
    Requires a recorded execution first.
    """
    return crud.incident.record_recovery(
        db, incident_id,
        outcome=payload.outcome,
        notes=payload.notes,
        unrescued_acknowledged=payload.unrescued_acknowledged,
    )


@router.post("/{incident_id}/close", response_model=IncidentDetail)
def close_incident(
    incident_id: int,
    payload: IncidentCloseRequest | None = None,
    db: Session = Depends(get_db),
) -> IncidentDetail:
    """Close an incident after a recovery outcome has been recorded.

    Requires explicit confirmation (`confirm=true`); any unrescued samples must
    have been acknowledged during the recovery step. Closure is terminal.
    """
    req = payload or IncidentCloseRequest()
    return crud.incident.close_incident(
        db, incident_id, confirm=req.confirm, note=req.note
    )
