"""CRUD + lifecycle logic for Incidents and their audit trail.

Enforces the Phase-5 state machine (open -> acknowledged -> escalated),
deduplicates active incidents per equipment, and records an IncidentEvent for
every important change. Incident history is preserved independently of alerts.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.equipment import get_equipment
from app.crud.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.incident import (
    ACTIVE_STATES,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_CLOSED,
    INCIDENT_ESCALATED,
    INCIDENT_OPEN,
    PLAN_STATUS_APPROVED,
    PLAN_STATUS_EXECUTED,
    PLAN_STATUS_NONE,
    PLAN_STATUS_PLANNED,
    PLAN_STATUS_REJECTED,
    RECOVERY_COMPLETED,
    RECOVERY_OUTCOMES,
    RECOVERY_PARTIAL,
    RECOVERY_PENDING,
    Incident,
    IncidentEvent,
)

# Allowed state transitions for this phase. Map of state -> set of next states.
# Closure / rescue / recovery states are deliberately absent.
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    INCIDENT_OPEN: {INCIDENT_ACKNOWLEDGED, INCIDENT_ESCALATED},
    INCIDENT_ACKNOWLEDGED: {INCIDENT_ESCALATED},
    INCIDENT_ESCALATED: set(),
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _record_event(
    db: Session,
    incident: Incident,
    *,
    event_type: str,
    explanation: str,
    detail: Optional[dict] = None,
    commit: bool = True,
) -> IncidentEvent:
    """Append an audit-trail event to an incident."""
    event = IncidentEvent(
        incident_id=incident.id,
        event_type=event_type,
        explanation=explanation,
        detail=detail,
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


# ----------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------
def get_incident(db: Session, incident_id: int) -> Incident:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise NotFoundError(f"Incident {incident_id} not found")
    return incident


def get_active_incident(db: Session, equipment_id: int) -> Optional[Incident]:
    """Return the single active incident for an equipment, if any."""
    stmt = (
        select(Incident)
        .where(
            Incident.equipment_id == equipment_id,
            Incident.status.in_(ACTIVE_STATES),
        )
        .order_by(Incident.id.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def list_incidents(
    db: Session,
    *,
    equipment_id: Optional[int] = None,
    status: Optional[str] = None,
    active_only: bool = False,
    limit: int = 100,
) -> list[Incident]:
    stmt = select(Incident)
    if equipment_id is not None:
        stmt = stmt.where(Incident.equipment_id == equipment_id)
    if status is not None:
        stmt = stmt.where(Incident.status == status)
    if active_only:
        stmt = stmt.where(Incident.status.in_(ACTIVE_STATES))
    stmt = stmt.order_by(Incident.created_at.desc(), Incident.id.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def list_events(db: Session, incident_id: int) -> list[IncidentEvent]:
    """Return an incident's audit trail (oldest first). 404 if incident missing."""
    get_incident(db, incident_id)
    stmt = (
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.timestamp, IncidentEvent.id)
    )
    return list(db.scalars(stmt).all())


# ----------------------------------------------------------------------
# Creation / dedupe (called by the detection workflow)
# ----------------------------------------------------------------------
def create_or_refresh_incident(
    db: Session,
    *,
    equipment_id: int,
    trigger: str,
    risk_severity: str,
    summary: str,
    affected_samples: list,
    evidence: dict,
    alert_id: Optional[int] = None,
) -> tuple[Incident, bool]:
    """Create a new incident, or refresh the equipment's existing active one.

    Deduplicates so repeated qualifying readings never spawn duplicate active
    incidents: if an active incident already exists for the equipment, its
    severity/summary/evidence are updated in place and an ``evidence_updated``
    audit event is recorded. Returns ``(incident, created)``.
    """
    get_equipment(db, equipment_id)  # 404 if equipment missing

    existing = get_active_incident(db, equipment_id)
    if existing is not None:
        # Refresh in place. Only escalate severity upward in the record; never
        # silently downgrade an active incident's recorded severity.
        changed_severity = (
            risk_severity == "critical" and existing.risk_severity != "critical"
        )
        if changed_severity:
            existing.risk_severity = "critical"
        existing.summary = summary
        existing.affected_samples = affected_samples
        existing.evidence = evidence
        if alert_id is not None:
            existing.alert_id = alert_id
        existing.updated_at = _utcnow()
        db.add(existing)
        db.flush()
        _record_event(
            db,
            existing,
            event_type="evidence_updated",
            explanation=(
                "Qualifying reading observed again; incident evidence refreshed"
                + (" and severity raised to critical" if changed_severity else "")
                + "."
            ),
            detail={"trigger": trigger, "risk_severity": risk_severity},
            commit=False,
        )
        db.commit()
        db.refresh(existing)
        return existing, False

    incident = Incident(
        equipment_id=equipment_id,
        alert_id=alert_id,
        trigger=trigger,
        risk_severity=risk_severity,
        status=INCIDENT_OPEN,
        summary=summary,
        affected_samples=affected_samples,
        evidence=evidence,
    )
    db.add(incident)
    db.flush()  # assign incident.id for the event FK
    _record_event(
        db,
        incident,
        event_type="created",
        explanation=f"Incident opened automatically: {summary}",
        detail={
            "trigger": trigger,
            "risk_severity": risk_severity,
            "alert_id": alert_id,
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident, True


# ----------------------------------------------------------------------
# Lifecycle transitions
# ----------------------------------------------------------------------
def _validate_transition(incident: Incident, target: str) -> None:
    allowed = _ALLOWED_TRANSITIONS.get(incident.status, set())
    if target not in allowed:
        raise ConflictError(
            f"Cannot transition incident {incident.id} from "
            f"'{incident.status}' to '{target}'. Allowed from "
            f"'{incident.status}': {sorted(allowed) or 'none'}."
        )


def acknowledge_incident(
    db: Session, incident_id: int, *, note: Optional[str] = None
) -> Incident:
    """Acknowledge an open incident -> 'acknowledged'."""
    incident = get_incident(db, incident_id)
    _validate_transition(incident, INCIDENT_ACKNOWLEDGED)

    now = _utcnow()
    incident.status = INCIDENT_ACKNOWLEDGED
    incident.acknowledged_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    _record_event(
        db,
        incident,
        event_type="acknowledged",
        explanation=note or "Incident acknowledged by an operator.",
        detail={"from_state": INCIDENT_OPEN, "to_state": INCIDENT_ACKNOWLEDGED},
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident


def escalate_incident(
    db: Session, incident_id: int, *, note: Optional[str] = None
) -> Incident:
    """Escalate an open/acknowledged incident -> 'escalated'."""
    incident = get_incident(db, incident_id)
    from_state = incident.status
    _validate_transition(incident, INCIDENT_ESCALATED)

    now = _utcnow()
    incident.status = INCIDENT_ESCALATED
    incident.escalated_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    _record_event(
        db,
        incident,
        event_type="escalated",
        explanation=note or "Incident escalated for urgent attention.",
        detail={"from_state": from_state, "to_state": INCIDENT_ESCALATED},
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident


# ----------------------------------------------------------------------
# Rescue-plan review (Phase 5B)
#
# Plan review is an orthogonal dimension to the open/acknowledged/escalated
# lifecycle: generating or approving a plan does not change ``incident.status``
# and is never blocked by escalation. Approval NEVER moves samples or modifies
# inventory - execution belongs to a later phase.
# ----------------------------------------------------------------------
def generate_incident_plan(db: Session, incident_id: int) -> tuple[Incident, "object"]:
    """Generate a rescue plan for an incident's equipment and associate it.

    Uses the existing MILP rescue optimiser with the incident's equipment as
    the evacuation source and all other operational equipment as backups.
    Persists the plan, links it to the incident, sets plan status to
    'planned', and records an audit event. Returns (incident, rescue_plan).

    Re-generating replaces the association with a fresh plan and resets review
    status to 'planned' (a previously approved/rejected plan is superseded).
    """
    from app.rescue import service as rescue_service

    incident = get_incident(db, incident_id)
    if incident.status == INCIDENT_CLOSED:
        raise ConflictError(
            f"Incident {incident_id} is closed; no further rescue planning."
        )

    # Source = the incident's equipment; backups = all other operational units.
    result, plan = rescue_service.generate_plan(
        db,
        source_equipment_ids=[incident.equipment_id],
        backup_equipment_ids=None,
        persist=True,
    )

    superseded = incident.rescue_plan_id
    incident.rescue_plan_id = plan.id
    incident.rescue_plan_status = PLAN_STATUS_PLANNED
    incident.plan_reviewed_at = None
    incident.updated_at = _utcnow()
    db.add(incident)
    db.flush()
    _record_event(
        db,
        incident,
        event_type="plan_generated",
        explanation=(
            f"Rescue plan #{plan.id} generated "
            f"({result.rescued_count}/{result.total_count} samples rescuable; "
            f"{'feasible' if result.feasible else 'partial' if result.partial else 'infeasible'})."
        ),
        detail={
            "plan_id": plan.id,
            "feasible": result.feasible,
            "partial": result.partial,
            "rescued_count": result.rescued_count,
            "total_count": result.total_count,
            "method": result.method,
            "superseded_plan_id": superseded,
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident, plan


def approve_incident_plan(
    db: Session,
    incident_id: int,
    *,
    acknowledge_unrescued: bool = False,
    note: Optional[str] = None,
) -> Incident:
    """Approve the incident's associated rescue plan after revalidation.

    Rules:
      * There must be a plan in 'planned' status (not already approved/rejected).
      * An infeasible plan (nothing rescuable) cannot be approved.
      * A partial plan can only be approved when ``acknowledge_unrescued`` is
        True (explicit acknowledgment of the samples left behind).
      * The plan is revalidated against *current* inventory; if anything has
        changed, approval is refused (ConflictError) and a new plan is required.
        Assignments are never silently modified.

    Approval records an audit event and sets plan status to 'approved'. It does
    NOT move samples or change inventory.
    """
    from app.rescue import service as rescue_service

    incident = get_incident(db, incident_id)

    if incident.rescue_plan_id is None or incident.rescue_plan_status == PLAN_STATUS_NONE:
        raise ConflictError(
            f"Incident {incident_id} has no rescue plan to approve; "
            f"generate a plan first."
        )
    if incident.rescue_plan_status == PLAN_STATUS_APPROVED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is already approved."
        )
    if incident.rescue_plan_status == PLAN_STATUS_REJECTED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan was rejected; "
            f"generate a new plan before approving."
        )

    plan = rescue_service.get_plan(db, incident.rescue_plan_id)

    # Infeasible plan: nothing to approve.
    if plan.rescued_count == 0:
        raise ConflictError(
            "Plan is infeasible (no samples can be rescued); it cannot be "
            "approved. Resolve the capacity/compatibility problem and "
            "regenerate a plan."
        )

    # Partial plan requires explicit acknowledgment of unrescued samples.
    if plan.partial and not acknowledge_unrescued:
        unresc = [u["sample_name"] for u in plan.plan.get("unassigned", [])]
        raise ValidationError(
            "This is a partial plan: "
            f"{plan.rescued_count}/{plan.total_count} samples can be rescued. "
            f"Unrescued: {unresc}. Re-submit with acknowledge_unrescued=true to "
            f"approve and explicitly accept the samples left behind."
        )

    # Revalidate against current inventory; never silently modify assignments.
    ok, problems = rescue_service.revalidate_plan_assignments(db, plan)
    if not ok:
        _record_event(
            db,
            incident,
            event_type="plan_approval_failed",
            explanation=(
                "Approval refused: the plan is stale - inventory changed since "
                "it was generated. " + " ".join(problems)
            ),
            detail={"plan_id": plan.id, "problems": problems},
            commit=True,
        )
        raise ConflictError(
            "Rescue plan is stale and cannot be approved because inventory "
            "changed since it was generated: " + "; ".join(problems)
            + ". Generate a new plan and review it."
        )

    # For a partial approval, capture exactly which samples are being left
    # behind so the audit trail durably records what was acknowledged.
    unrescued = [
        {"sample_id": u.get("sample_id"), "sample_name": u.get("sample_name"),
         "priority": u.get("priority"), "reason": u.get("reason")}
        for u in plan.plan.get("unassigned", [])
    ]

    now = _utcnow()
    incident.rescue_plan_status = PLAN_STATUS_APPROVED
    incident.plan_reviewed_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    unrescued_names = [u["sample_name"] for u in unrescued]
    _record_event(
        db,
        incident,
        event_type="plan_approved",
        explanation=(
            note
            or (
                f"Rescue plan #{plan.id} approved "
                f"({plan.rescued_count}/{plan.total_count} samples)."
                + (
                    " Unrescued samples explicitly acknowledged: "
                    + ", ".join(unrescued_names) + "."
                    if plan.partial else ""
                )
            )
        ),
        detail={
            "plan_id": plan.id,
            "feasible": plan.feasible,
            "partial": plan.partial,
            "acknowledge_unrescued": acknowledge_unrescued,
            "rescued_count": plan.rescued_count,
            "total_count": plan.total_count,
            "unrescued_samples": unrescued,
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident


def reject_incident_plan(
    db: Session, incident_id: int, *, note: Optional[str] = None
) -> Incident:
    """Reject the incident's associated rescue plan.

    A rejected plan is no longer approvable; a new plan must be generated.
    Records an audit event. Does not move samples or change inventory.
    """
    incident = get_incident(db, incident_id)

    if incident.rescue_plan_id is None or incident.rescue_plan_status == PLAN_STATUS_NONE:
        raise ConflictError(
            f"Incident {incident_id} has no rescue plan to reject."
        )
    if incident.rescue_plan_status == PLAN_STATUS_APPROVED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is already approved and "
            f"cannot be rejected."
        )
    if incident.rescue_plan_status == PLAN_STATUS_REJECTED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is already rejected."
        )

    now = _utcnow()
    incident.rescue_plan_status = PLAN_STATUS_REJECTED
    incident.plan_reviewed_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    _record_event(
        db,
        incident,
        event_type="plan_rejected",
        explanation=note or f"Rescue plan #{incident.rescue_plan_id} rejected.",
        detail={"plan_id": incident.rescue_plan_id},
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident


def get_incident_plan(db: Session, incident_id: int):
    """Return the RescuePlan associated with an incident, or raise NotFound."""
    from app.rescue import service as rescue_service

    incident = get_incident(db, incident_id)
    if incident.rescue_plan_id is None:
        raise NotFoundError(
            f"Incident {incident_id} has no associated rescue plan yet."
        )
    return rescue_service.get_plan(db, incident.rescue_plan_id)


# ----------------------------------------------------------------------
# Rescue-plan execution (Phase 5C)
#
# Execution performs the *simulated* transfer of samples recorded in an
# approved plan: it updates each approved sample's ``equipment_id`` to its
# destination backup. It is the first operation that mutates inventory, so it
# is written defensively:
#   * only an approved, currently-associated plan may execute,
#   * the plan is revalidated against live inventory first (no re-optimisation,
#     no silent assignment changes),
#   * an atomic compare-and-set on the plan status claims the execution so a
#     second concurrent request cannot double-execute,
#   * all moves run in one transaction and roll back together on any failure,
#   * the outcome (success or failure) is persisted and audited.
# Recovery verification and incident closure are NOT done here.
# ----------------------------------------------------------------------
def _persist_execution(
    db: Session,
    *,
    incident_id: int,
    plan_id: int,
    status: str,
    transferred_sample_ids: list,
    transfers: list,
    explanation: str,
    problems: Optional[list] = None,
    link_to_incident: bool = True,
):
    """Insert a RescueExecution row and (by default) link it to the incident.

    Linking ``rescue_execution_id`` to the latest attempt - success OR failure -
    means the execution result is always retrievable via the incident, so a
    failed attempt is auditable too. ``executed_at`` is left untouched here; it
    is set only on success by the caller.
    """
    from app.models.rescue_execution import RescueExecution

    execution = RescueExecution(
        incident_id=incident_id,
        plan_id=plan_id,
        status=status,
        transferred_sample_ids=transferred_sample_ids,
        transfers=transfers,
        explanation=explanation,
        problems=problems,
    )
    db.add(execution)
    db.flush()
    if link_to_incident:
        incident = db.get(Incident, incident_id)
        if incident is not None:
            incident.rescue_execution_id = execution.id
            db.add(incident)
    db.commit()
    db.refresh(execution)
    return execution


def _claim_execution(db: Session, incident_id: int) -> bool:
    """Atomically claim the right to execute this incident's approved plan.

    Performs a conditional UPDATE that flips rescue_plan_status from 'approved'
    to 'executed' only if it is currently 'approved'. Returns True if this
    caller won the claim. This compare-and-set is the concurrency guard: a
    second concurrent executor will see rowcount 0 and must abort.

    The flip is committed immediately so the claim is visible to other
    sessions; if the subsequent execution fails, the caller reverts the status.
    """
    from sqlalchemy import text

    res = db.execute(
        text(
            "UPDATE incidents SET rescue_plan_status = :executed "
            "WHERE id = :iid AND rescue_plan_status = :approved"
        ),
        {
            "executed": PLAN_STATUS_EXECUTED,
            "approved": PLAN_STATUS_APPROVED,
            "iid": incident_id,
        },
    )
    db.commit()
    return res.rowcount == 1


def _revert_execution_claim(db: Session, incident_id: int) -> None:
    """Revert a claim back to 'approved' after a failed execution attempt."""
    from sqlalchemy import text

    db.execute(
        text(
            "UPDATE incidents SET rescue_plan_status = :approved "
            "WHERE id = :iid AND rescue_plan_status = :executed "
            "AND executed_at IS NULL"
        ),
        {
            "approved": PLAN_STATUS_APPROVED,
            "executed": PLAN_STATUS_EXECUTED,
            "iid": incident_id,
        },
    )
    db.commit()


def execute_incident_plan(db: Session, incident_id: int) -> tuple[Incident, "object"]:
    """Execute an approved incident rescue plan as a simulated transfer.

    Returns (incident, rescue_execution). Raises ConflictError/ValidationError
    with a clear message on any guard failure, leaving inventory untouched.
    """
    from app.models.equipment import Equipment
    from app.models.rescue_execution import EXECUTION_FAILED, EXECUTION_SUCCESS
    from app.models.sample import Sample
    from app.rescue import service as rescue_service

    incident = get_incident(db, incident_id)

    # --- Pre-claim guards (clear errors, no mutation) ------------------
    if incident.rescue_plan_id is None or incident.rescue_plan_status == PLAN_STATUS_NONE:
        raise ConflictError(
            f"Incident {incident_id} has no rescue plan to execute."
        )
    if incident.rescue_plan_status == PLAN_STATUS_EXECUTED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan has already been executed."
        )
    if incident.rescue_plan_status == PLAN_STATUS_PLANNED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is not approved yet; "
            f"approve it before executing."
        )
    if incident.rescue_plan_status == PLAN_STATUS_REJECTED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan was rejected; generate and "
            f"approve a new plan before executing."
        )
    if incident.rescue_plan_status != PLAN_STATUS_APPROVED:
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is not in an executable "
            f"state ('{incident.rescue_plan_status}')."
        )

    plan = rescue_service.get_plan(db, incident.rescue_plan_id)

    # --- Revalidate BEFORE claiming/moving anything --------------------
    ok, problems = rescue_service.revalidate_plan_assignments(db, plan)
    if not ok:
        _record_event(
            db, incident,
            event_type="execution_failed",
            explanation=(
                "Execution refused: plan is stale - inventory changed since "
                "approval. " + " ".join(problems)
            ),
            detail={"plan_id": plan.id, "problems": problems},
            commit=True,
        )
        _persist_execution(
            db,
            incident_id=incident.id, plan_id=plan.id, status=EXECUTION_FAILED,
            transferred_sample_ids=[], transfers=[],
            explanation="Execution refused: plan is stale (inventory changed "
                        "since approval).",
            problems=problems,
        )
        raise ConflictError(
            "Rescue plan is stale and cannot be executed because inventory "
            "changed since approval: " + "; ".join(problems)
            + ". Generate a new plan, review and approve it."
        )

    # --- Atomic concurrency claim (compare-and-set) --------------------
    if not _claim_execution(db, incident.id):
        # Another request executed (or the status is no longer 'approved').
        raise ConflictError(
            f"Incident {incident_id}'s rescue plan is already being executed "
            f"or is no longer approved; execution was not performed."
        )

    # From here we hold the claim (status == 'executed'). Any failure must
    # revert the claim and leave inventory untouched.
    assignments = plan.plan.get("assignments", [])
    transfers: list[dict] = []
    try:
        # Build the transfer list and apply all moves in ONE transaction.
        for a in assignments:
            sample = db.get(Sample, a["sample_id"])
            if sample is None:
                raise ConflictError(
                    f"sample {a['sample_id']} no longer exists at execution time"
                )
            source = db.get(Equipment, sample.equipment_id)
            target = db.get(Equipment, a["equipment_id"])
            if target is None:
                raise ConflictError(
                    f"target equipment {a['equipment_id']} no longer exists"
                )
            # Final guard: target still operational + temperature covers.
            if target.status.lower() != "operational":
                raise ConflictError(
                    f"target '{target.name}' is not operational at execution time"
                )
            if (
                sample.min_temperature < target.min_temperature
                or sample.max_temperature > target.max_temperature
            ):
                raise ConflictError(
                    f"target '{target.name}' no longer covers sample "
                    f"'{sample.name}' temperature range"
                )
            transfers.append({
                "sample_id": sample.id,
                "sample_name": sample.name,
                "from_equipment_id": source.id if source else None,
                "from_equipment_name": source.name if source else None,
                "to_equipment_id": target.id,
                "to_equipment_name": target.name,
                "storage_space": sample.storage_space,
            })

        # Cumulative capacity re-check per destination against *live* free
        # capacity, excluding samples this execution is moving INTO it from
        # elsewhere (so a target is not penalised twice).
        moving_ids = {t["sample_id"] for t in transfers}
        per_target: dict[int, list[dict]] = {}
        for t in transfers:
            per_target.setdefault(t["to_equipment_id"], []).append(t)
        for eq_id, group in per_target.items():
            target = db.get(Equipment, eq_id)
            # Current occupants that are NOT being moved away by this execution.
            existing_storage = sum(
                s.storage_space for s in target.samples
                if s.id not in moving_ids
            )
            existing_slots = sum(
                1 for s in target.samples if s.id not in moving_ids
            )
            needed_storage = sum(t["storage_space"] for t in group)
            if existing_storage + needed_storage > target.storage_capacity:
                raise ConflictError(
                    f"target '{target.name}' cannot hold the transfer: "
                    f"needs {needed_storage} + existing {existing_storage} > "
                    f"capacity {target.storage_capacity}"
                )
            if (
                target.sample_limit is not None
                and existing_slots + len(group) > target.sample_limit
            ):
                raise ConflictError(
                    f"target '{target.name}' has too few slots for the transfer"
                )

        # Apply the moves (the simulated transfer).
        for t in transfers:
            sample = db.get(Sample, t["sample_id"])
            sample.equipment_id = t["to_equipment_id"]
            db.add(sample)

        db.flush()  # surface any integrity error before we commit the batch
        db.commit()
    except Exception as exc:  # noqa: BLE001 - roll back ALL moves atomically
        db.rollback()
        _revert_execution_claim(db, incident.id)
        problem = str(getattr(exc, "message", exc))
        _record_event(
            db, incident,
            event_type="execution_failed",
            explanation=(
                "Execution failed and was rolled back; no samples were moved. "
                + problem
            ),
            detail={"plan_id": plan.id, "error": problem},
            commit=True,
        )
        _persist_execution(
            db,
            incident_id=incident.id, plan_id=plan.id, status=EXECUTION_FAILED,
            transferred_sample_ids=[], transfers=transfers,
            explanation="Execution failed and was rolled back; inventory "
                        "unchanged.",
            problems=[problem],
        )
        raise ConflictError(
            "Rescue execution failed and all sample movements were rolled "
            "back; inventory is unchanged. " + problem
        )

    # --- Success: persist execution record + link + audit --------------
    execution = _persist_execution(
        db,
        incident_id=incident.id, plan_id=plan.id, status=EXECUTION_SUCCESS,
        transferred_sample_ids=[t["sample_id"] for t in transfers],
        transfers=transfers,
        explanation=(
            f"Executed rescue plan #{plan.id}: moved "
            f"{len(transfers)} sample(s) to backup equipment."
            + (" Unrescued samples left in place."
               if plan.plan.get("partial") else "")
        ),
    )

    now = _utcnow()
    incident.rescue_execution_id = execution.id
    incident.executed_at = now
    incident.updated_at = now
    # status already 'executed' from the claim; keep it.
    db.add(incident)
    db.flush()
    _record_event(
        db, incident,
        event_type="execution_succeeded",
        explanation=(
            f"Rescue plan #{plan.id} executed: "
            f"{len(transfers)} sample(s) transferred."
        ),
        detail={
            "plan_id": plan.id,
            "execution_id": execution.id,
            "transferred_sample_ids": [t["sample_id"] for t in transfers],
            "transfers": transfers,
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident, execution


def get_incident_execution(db: Session, incident_id: int):
    """Return the execution record associated with an incident, or 404."""
    from app.models.rescue_execution import RescueExecution

    incident = get_incident(db, incident_id)
    if incident.rescue_execution_id is None:
        raise NotFoundError(
            f"Incident {incident_id} has no rescue execution yet."
        )
    execution = db.get(RescueExecution, incident.rescue_execution_id)
    if execution is None:
        raise NotFoundError(
            f"Execution {incident.rescue_execution_id} not found."
        )
    return execution


# ----------------------------------------------------------------------
# Recovery verification & incident closure (Phase 5D)
#
# Recovery is the operator's confirmation of what actually happened after a
# rescue execution. A successful *transfer* is NOT assumed to mean a sample is
# safe or viable: the operator records the real outcome (completed / partial /
# unresolved) plus any notes. An incident can only be closed after a recovery
# outcome is recorded and the operator explicitly confirms it; if any samples
# were left unrescued, the operator must acknowledge them first.
# ----------------------------------------------------------------------
def _execution_unrescued(db: Session, incident: Incident) -> list[dict]:
    """Return the samples that were NOT transferred by the incident's execution.

    Derived from the executed plan's ``unassigned`` list (samples the optimiser
    could not place). Returns [] when there is no execution or nothing was left
    behind. This is purely informational - it never asserts viability.
    """
    from app.models.rescue_execution import RescueExecution
    from app.models.rescue_plan import RescuePlan

    if incident.rescue_execution_id is None:
        return []
    execution = db.get(RescueExecution, incident.rescue_execution_id)
    if execution is None:
        return []
    plan = db.get(RescuePlan, execution.plan_id)
    if plan is None:
        return []
    return list(plan.plan.get("unassigned", []))


def record_recovery(
    db: Session,
    incident_id: int,
    *,
    outcome: str,
    notes: Optional[str] = None,
    unrescued_acknowledged: bool = False,
) -> Incident:
    """Record the operator-confirmed recovery outcome for an incident.

    Requires a recorded execution first. ``outcome`` must be one of
    completed / partial / unresolved. This records only what the operator
    confirms; it makes no assumption about sample viability. Re-recording is
    allowed (the operator may update the outcome) up until the incident is
    closed, and each recording is audited.
    """
    incident = get_incident(db, incident_id)

    if incident.status == INCIDENT_CLOSED:
        raise ConflictError(
            f"Incident {incident_id} is closed; its recovery outcome is final."
        )
    if incident.rescue_execution_id is None or incident.executed_at is None:
        raise ConflictError(
            f"Incident {incident_id} has no recorded rescue execution; record "
            f"recovery only after the rescue plan has been executed."
        )
    if outcome not in RECOVERY_OUTCOMES:
        raise ValidationError(
            f"Invalid recovery outcome '{outcome}'. Must be one of: "
            f"{', '.join(RECOVERY_OUTCOMES)}."
        )

    unrescued = _execution_unrescued(db, incident)
    # If the operator reports a full completion but samples were left behind,
    # that is contradictory - guide them to 'partial' instead of silently
    # accepting an over-optimistic outcome.
    if outcome == RECOVERY_COMPLETED and unrescued:
        raise ValidationError(
            f"Cannot record 'completed': {len(unrescued)} sample(s) were not "
            f"rescued by the execution. Use 'partial' (and acknowledge the "
            f"unrescued samples) or 'unresolved'."
        )

    now = _utcnow()
    incident.recovery_status = outcome
    incident.recovery_notes = notes
    incident.unrescued_acknowledged = bool(unrescued_acknowledged)
    incident.recovery_recorded_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    _record_event(
        db, incident,
        event_type="recovery_recorded",
        explanation=(
            f"Operator recorded recovery outcome '{outcome}'"
            + (f": {notes}" if notes else ".")
        ),
        detail={
            "outcome": outcome,
            "notes": notes,
            "unrescued_count": len(unrescued),
            "unrescued_samples": unrescued,
            "unrescued_acknowledged": bool(unrescued_acknowledged),
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident


def close_incident(
    db: Session,
    incident_id: int,
    *,
    confirm: bool = False,
    note: Optional[str] = None,
) -> Incident:
    """Close an incident after recovery has been recorded and confirmed.

    Preconditions (each returns a clear error if unmet):
      * the incident is not already closed (duplicate close -> 409),
      * a rescue execution has been recorded,
      * a recovery outcome has been recorded (not 'pending'),
      * the operator explicitly confirms closure (``confirm=True``),
      * if any samples were left unrescued, the operator must have
        acknowledged them (via the recovery step's ``unrescued_acknowledged``).
    """
    incident = get_incident(db, incident_id)

    if incident.status == INCIDENT_CLOSED:
        raise ConflictError(f"Incident {incident_id} is already closed.")
    if incident.rescue_execution_id is None or incident.executed_at is None:
        raise ConflictError(
            f"Incident {incident_id} cannot be closed before a rescue "
            f"execution has been recorded."
        )
    if incident.recovery_status == RECOVERY_PENDING:
        raise ConflictError(
            f"Incident {incident_id} cannot be closed before a recovery "
            f"outcome has been recorded."
        )
    if not confirm:
        raise ValidationError(
            "Closing an incident requires explicit confirmation "
            "(confirm=true)."
        )

    unrescued = _execution_unrescued(db, incident)
    if unrescued and not incident.unrescued_acknowledged:
        raise ConflictError(
            f"Incident {incident_id} has {len(unrescued)} unrescued sample(s) "
            f"that must be acknowledged before closing. Re-record recovery "
            f"with unrescued_acknowledged=true."
        )

    from_state = incident.status
    now = _utcnow()
    incident.status = INCIDENT_CLOSED
    incident.closed_at = now
    incident.updated_at = now
    db.add(incident)
    db.flush()
    _record_event(
        db, incident,
        event_type="incident_closed",
        explanation=(
            note
            or (
                f"Incident closed by operator with recovery outcome "
                f"'{incident.recovery_status}'"
                + (f"; {len(unrescued)} unrescued sample(s) acknowledged."
                   if unrescued else ".")
            )
        ),
        detail={
            "from_state": from_state,
            "to_state": INCIDENT_CLOSED,
            "recovery_status": incident.recovery_status,
            "unrescued_count": len(unrescued),
            "unrescued_acknowledged": incident.unrescued_acknowledged,
        },
        commit=False,
    )
    db.commit()
    db.refresh(incident)
    return incident
