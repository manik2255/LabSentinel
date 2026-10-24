"""Rescue planning service.

Loads the current equipment/sample inventory, runs the optimiser, and builds a
structured plan. Optionally persists the plan for later retrieval.

This layer is strictly read-only with respect to inventory: it never moves a
sample or changes equipment/sample rows. The only write it performs is
inserting a ``RescuePlan`` record (a proposal), which is separate from
executing the plan.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crud.exceptions import NotFoundError, ValidationError
from app.models.equipment import Equipment
from app.models.rescue_plan import RescuePlan
from app.rescue.optimizer import (
    CandidateEquipment,
    RescueItem,
    RescuePlanResult,
    optimize_rescue,
)

# Static description of the constraints the optimiser enforces, surfaced to the
# frontend so users understand how a plan was produced.
CONSTRAINTS_EXPLAINED = [
    "Backup equipment must be operational.",
    "Backup temperature range must fully cover each sample's required range.",
    "A sample is never reassigned to its own failing/unsafe equipment.",
    "Total storage used in a backup cannot exceed its free storage capacity.",
    "A backup with a sample-slot limit cannot exceed its free slots.",
    "Higher-priority samples are preferred; the plan maximises samples rescued.",
    "Planning is read-only: generating a plan does not move samples.",
]


def _unsafe(equipment: Equipment) -> bool:
    """An equipment is unsafe/failing if it is not operational."""
    return equipment.status.lower() != "operational"


def _resolve_sources(
    db: Session, source_ids: Optional[list[int]]
) -> list[Equipment]:
    """Resolve which equipment to evacuate."""
    if source_ids is None:
        # Auto-detect: any non-operational equipment.
        stmt = select(Equipment).where(Equipment.status != "operational")
        return list(db.scalars(stmt).all())

    sources: list[Equipment] = []
    for eid in source_ids:
        eq = db.get(Equipment, eid)
        if eq is None:
            raise NotFoundError(f"Equipment {eid} not found")
        sources.append(eq)
    return sources


def _resolve_backups(
    db: Session,
    backup_ids: Optional[list[int]],
    source_ids: set[int],
) -> list[Equipment]:
    """Resolve candidate backup equipment, excluding the sources."""
    if backup_ids is None:
        stmt = select(Equipment).where(Equipment.status == "operational")
        backups = list(db.scalars(stmt).all())
    else:
        backups = []
        for eid in backup_ids:
            eq = db.get(Equipment, eid)
            if eq is None:
                raise NotFoundError(f"Equipment {eid} not found")
            backups.append(eq)
    # Never use a source as its own backup.
    return [e for e in backups if e.id not in source_ids]


def generate_plan(
    db: Session,
    *,
    source_equipment_ids: Optional[list[int]] = None,
    backup_equipment_ids: Optional[list[int]] = None,
    persist: bool = True,
) -> tuple[RescuePlanResult, Optional[RescuePlan]]:
    """Generate a rescue plan. Returns (result, persisted_plan_or_None)."""
    sources = _resolve_sources(db, source_equipment_ids)
    source_ids = {e.id for e in sources}

    if source_equipment_ids is not None and not sources:
        raise ValidationError("No source equipment resolved from the request")

    # Gather affected samples from the source equipment.
    items: list[RescueItem] = []
    for eq in sources:
        for s in eq.samples:
            items.append(
                RescueItem(
                    sample_id=s.id,
                    name=s.name,
                    min_temperature=s.min_temperature,
                    max_temperature=s.max_temperature,
                    storage_space=s.storage_space,
                    priority=s.priority,
                    source_equipment_id=eq.id,
                )
            )

    backups = _resolve_backups(db, backup_equipment_ids, source_ids)
    candidates = [
        CandidateEquipment(
            equipment_id=e.id,
            name=e.name,
            min_temperature=e.min_temperature,
            max_temperature=e.max_temperature,
            free_storage=e.available_storage,
            free_slots=e.available_slots,
            status=e.status,
        )
        for e in backups
    ]

    result = optimize_rescue(items, candidates)

    persisted: Optional[RescuePlan] = None
    if persist:
        persisted = _persist(db, result)

    return result, persisted


def _persist(db: Session, result: RescuePlanResult) -> RescuePlan:
    """Store a plan result as a RescuePlan row (a proposal, not execution)."""
    from app.rescue.serialize import result_to_dict

    plan = RescuePlan(
        feasible=result.feasible,
        partial=result.partial,
        rescued_count=result.rescued_count,
        total_count=result.total_count,
        method=result.method,
        plan=result_to_dict(result),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def revalidate_plan_assignments(
    db: Session, plan: RescuePlan
) -> tuple[bool, list[str]]:
    """Check whether a stored plan's assignments are still valid *right now*.

    Re-reads current inventory and verifies, for every assignment in the stored
    plan, that:
      * the sample still exists and still lives on a non-operational (source)
        unit (i.e. it still needs rescuing),
      * the target backup still exists and is operational,
      * the target's temperature range still covers the sample,
      * the target still has enough free storage and a free slot for the
        collective set of samples the plan assigns to it.

    Returns ``(ok, problems)``. ``ok`` is True only if nothing has changed in a
    way that invalidates the plan. This never mutates anything.
    """
    from app.models.sample import Sample

    assignments = plan.plan.get("assignments", [])
    problems: list[str] = []

    # Aggregate, per target equipment, the storage/slots this plan would use
    # and re-check against *current* free capacity.
    per_target: dict[int, list[dict]] = {}
    for a in assignments:
        per_target.setdefault(a["equipment_id"], []).append(a)

    for a in assignments:
        sample = db.get(Sample, a["sample_id"])
        if sample is None:
            problems.append(
                f"sample {a['sample_id']} ('{a['sample_name']}') no longer exists"
            )
            continue
        src = db.get(Equipment, sample.equipment_id)
        if src is not None and not _unsafe(src):
            problems.append(
                f"sample '{sample.name}' is no longer on a failing unit "
                f"(now on operational '{src.name}'); it may not need rescue"
            )

        target = db.get(Equipment, a["equipment_id"])
        if target is None:
            problems.append(
                f"target equipment {a['equipment_id']} "
                f"('{a['equipment_name']}') no longer exists"
            )
            continue
        if _unsafe(target):
            problems.append(
                f"target '{target.name}' is no longer operational "
                f"(status '{target.status}')"
            )
        if (
            sample.min_temperature < target.min_temperature
            or sample.max_temperature > target.max_temperature
        ):
            problems.append(
                f"target '{target.name}' range "
                f"[{target.min_temperature}, {target.max_temperature}] no longer "
                f"covers sample '{sample.name}' range "
                f"[{sample.min_temperature}, {sample.max_temperature}]"
            )

    # Capacity / slot re-check per target against current free capacity.
    for eq_id, group in per_target.items():
        target = db.get(Equipment, eq_id)
        if target is None:
            continue
        needed_storage = sum(g["storage_space"] for g in group)
        if needed_storage > target.available_storage:
            problems.append(
                f"target '{target.name}' now has {target.available_storage} free "
                f"storage but the plan needs {needed_storage}"
            )
        if target.available_slots is not None and len(group) > target.available_slots:
            problems.append(
                f"target '{target.name}' now has {target.available_slots} free "
                f"slot(s) but the plan needs {len(group)}"
            )

    return (len(problems) == 0), problems


def get_plan(db: Session, plan_id: int) -> RescuePlan:
    """Retrieve a stored plan by id."""
    plan = db.get(RescuePlan, plan_id)
    if plan is None:
        raise NotFoundError(f"Rescue plan {plan_id} not found")
    return plan


def list_plans(db: Session, limit: int = 50) -> list[RescuePlan]:
    """List stored plans, newest first."""
    stmt = (
        select(RescuePlan)
        .order_by(RescuePlan.created_at.desc(), RescuePlan.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
