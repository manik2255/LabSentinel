"""Build a read-only incident report from existing data.

Aggregates what is already stored - the incident row, its associated rescue
plan, the rescue execution record, and the audit-trail events - into a single
JSON-friendly summary. It performs **no** writes and makes **no** assumptions:
if a stage has not happened yet (no plan generated, nothing executed, no
recovery recorded), the report reflects exactly that.

Sample counts are reported honestly and separately:
  * ``affected``   - samples known to need rescue (from the plan when one
                     exists, otherwise the detection-time snapshot / current
                     occupants of the failed equipment),
  * ``rescued``    - samples ACTUALLY moved, taken from a successful execution
                     record only (never inferred from a plan),
  * ``unrescued``  - samples a plan could not place, with the optimiser's
                     recorded reason (capacity / temperature / status).
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.crud.incident import get_incident, list_events
from app.models.rescue_execution import EXECUTION_SUCCESS, RescueExecution
from app.models.rescue_plan import RescuePlan
from app.models.sample import Sample


def _plan_section(plan: Optional[RescuePlan]) -> Optional[dict]:
    if plan is None:
        return None
    p = plan.plan
    return {
        "plan_id": plan.id,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "method": p.get("method"),
        "feasible": p.get("feasible"),
        "partial": p.get("partial"),
        "rescuable_count": p.get("rescued_count"),   # what the plan *could* place
        "total_count": p.get("total_count"),
        "explanation": p.get("explanation"),
        "assignments": p.get("assignments", []),
        "unassigned": p.get("unassigned", []),
    }


def _unrescued_reasons(plan: Optional[RescuePlan]) -> list[dict]:
    """Extract per-sample reasons the optimiser could not rescue a sample."""
    if plan is None:
        return []
    reasons = []
    for u in plan.plan.get("unassigned", []):
        reasons.append({
            "sample_id": u.get("sample_id"),
            "sample_name": u.get("sample_name"),
            "priority": u.get("priority"),
            "reason": u.get("reason"),
            "candidate_notes": u.get("candidate_notes", []),
        })
    return reasons


def _transfers(execution: Optional[RescueExecution]) -> list[dict]:
    """Where samples were transferred - only from a successful execution."""
    if execution is None or execution.status != EXECUTION_SUCCESS:
        return []
    return list(execution.transfers or [])


def _timeline(events) -> list[dict]:
    """Chronological timeline from the incident's audit events."""
    return [
        {
            "event_type": e.event_type,
            "explanation": e.explanation,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in events
    ]


def build_incident_report(db: Session, incident_id: int) -> dict:
    """Assemble the incident report dict. Raises NotFoundError for a bad id.

    Read-only: issues only SELECTs.
    """
    incident = get_incident(db, incident_id)  # 404 if missing

    # Associated plan / execution (either may be absent at this stage).
    plan: Optional[RescuePlan] = None
    if incident.rescue_plan_id is not None:
        plan = db.get(RescuePlan, incident.rescue_plan_id)
    execution: Optional[RescueExecution] = None
    if incident.rescue_execution_id is not None:
        execution = db.get(RescueExecution, incident.rescue_execution_id)

    events = list_events(db, incident_id)

    # --- sample counts (honest, stage-aware) --------------------------
    # "affected": prefer the plan's total (authoritative set that needed
    # rescue); fall back to the detection snapshot; finally to the samples
    # currently on the equipment.
    if plan is not None:
        affected_count = plan.plan.get("total_count", 0)
    elif incident.affected_samples:
        affected_count = len(incident.affected_samples)
    else:
        affected_count = (
            db.query(Sample).filter(Sample.equipment_id == incident.equipment_id)
            .count()
        )

    # "rescued": ONLY from a successful execution (never inferred from a plan).
    if execution is not None and execution.status == EXECUTION_SUCCESS:
        rescued_ids = list(execution.transferred_sample_ids or [])
        rescued_count = len(rescued_ids)
    else:
        rescued_ids = []
        rescued_count = 0

    # "unrescued": samples the plan could not place (reasons recorded).
    unrescued = _unrescued_reasons(plan)
    unrescued_count = len(unrescued)

    equipment = incident.equipment

    return {
        "incident_id": incident.id,
        "status": incident.status,
        "summary": incident.summary,
        "trigger": incident.trigger,
        "risk_severity": incident.risk_severity,
        "generated_from": "stored-data",  # read-only aggregation marker

        "equipment": {
            "equipment_id": incident.equipment_id,
            "name": equipment.name if equipment else None,
            "type": equipment.type if equipment else None,
            "location": equipment.location if equipment else None,
            "status": equipment.status if equipment else None,
        },

        "sample_counts": {
            "affected": affected_count,
            "rescued": rescued_count,
            "unrescued": unrescued_count,
            # True once we have an execution; before that, rescued is 0 and this
            # flag makes clear the rescue has not been carried out yet.
            "rescue_executed": execution is not None
            and execution.status == EXECUTION_SUCCESS,
        },

        # Where samples were transferred (empty until a successful execution).
        "transfers": _transfers(execution),
        "rescued_sample_ids": rescued_ids,

        # Why some samples could not be rescued (optimiser-recorded reasons).
        "unrescued_samples": unrescued,

        # Rescue plan status + the plan itself (null if none generated yet).
        "rescue_plan_status": incident.rescue_plan_status,
        "rescue_plan": _plan_section(plan),

        # Execution outcome (null if not executed).
        "execution": None if execution is None else {
            "execution_id": execution.id,
            "status": execution.status,
            "explanation": execution.explanation,
            "problems": execution.problems,
            "created_at": execution.created_at.isoformat()
            if execution.created_at else None,
        },

        # Final recovery outcome (null/"pending" until recorded).
        "recovery": {
            "status": incident.recovery_status,
            "notes": incident.recovery_notes,
            "unrescued_acknowledged": incident.unrescued_acknowledged,
            "recorded_at": incident.recovery_recorded_at.isoformat()
            if incident.recovery_recorded_at else None,
        },

        "timestamps": {
            "created_at": incident.created_at.isoformat()
            if incident.created_at else None,
            "acknowledged_at": incident.acknowledged_at.isoformat()
            if incident.acknowledged_at else None,
            "escalated_at": incident.escalated_at.isoformat()
            if incident.escalated_at else None,
            "executed_at": incident.executed_at.isoformat()
            if incident.executed_at else None,
            "recovery_recorded_at": incident.recovery_recorded_at.isoformat()
            if incident.recovery_recorded_at else None,
            "closed_at": incident.closed_at.isoformat()
            if incident.closed_at else None,
        },

        # Chronological event timeline from the audit trail.
        "timeline": _timeline(events),
    }
