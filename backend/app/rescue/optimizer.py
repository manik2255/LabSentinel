"""Rescue allocation optimizer.

Formulates sample-to-backup-equipment reassignment as a Mixed-Integer Linear
Program (MILP) and solves it with SciPy. This finds a *globally* optimal
allocation under the capacity/slot/compatibility constraints, which a greedy
"first available freezer" assignment cannot guarantee.

The module is pure: it operates on plain dataclasses, performs no database
access, and never mutates anything. The service layer is responsible for
loading data and persisting the resulting plan.

Decision model
--------------
Binary variable ``x[s, e] = 1`` iff sample ``s`` is placed in backup
equipment ``e``. Variables are created only for *compatible* (s, e) pairs.

Constraints
    * each sample is placed at most once:         sum_e x[s, e] <= 1
    * storage capacity per equipment:             sum_s space[s] * x[s, e] <= free_storage[e]
    * slot limit per equipment (if any):          sum_s x[s, e] <= free_slots[e]

Objective (maximised)
    sum over placements of  (PRIORITY_WEIGHT[priority] + RESCUE_BONUS)

``PRIORITY_WEIGHT`` is scaled so that rescuing one higher-priority sample is
always preferred over rescuing any realistic number of lower-priority ones,
while ``RESCUE_BONUS`` breaks ties by maximising the total count rescued.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Priority ordering and weights. Gaps are large so a single higher-priority
# rescue dominates many lower-priority ones (prevents a bulky low-priority
# sample from crowding out a high-priority one).
PRIORITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
PRIORITY_WEIGHT = {
    "low": 1.0,
    "medium": 10.0,
    "high": 100.0,
    "critical": 1000.0,
}
# Small constant added per rescued sample so, among equally-weighted optima,
# the solver maximises the number of samples rescued.
RESCUE_BONUS = 0.1


@dataclass(frozen=True)
class RescueItem:
    """A sample that needs rescuing."""

    sample_id: int
    name: str
    min_temperature: float
    max_temperature: float
    storage_space: int
    priority: str = "medium"
    source_equipment_id: Optional[int] = None

    @property
    def priority_weight(self) -> float:
        return PRIORITY_WEIGHT.get(self.priority.lower(), PRIORITY_WEIGHT["medium"])


@dataclass(frozen=True)
class CandidateEquipment:
    """A piece of backup equipment available to receive samples."""

    equipment_id: int
    name: str
    min_temperature: float
    max_temperature: float
    free_storage: int
    # None => unlimited slots.
    free_slots: Optional[int]
    status: str = "operational"


@dataclass
class Assignment:
    """One sample placed into one backup equipment."""

    sample_id: int
    sample_name: str
    equipment_id: int
    equipment_name: str
    storage_space: int
    priority: str


@dataclass
class Unassigned:
    """A sample that could not be rescued, with an explanation."""

    sample_id: int
    sample_name: str
    priority: str
    reason: str
    # Per-equipment detail of why each candidate was rejected (for the UI).
    candidate_notes: list[str] = field(default_factory=list)


@dataclass
class EquipmentCapacity:
    """Remaining capacity of an equipment after the plan is applied."""

    equipment_id: int
    equipment_name: str
    storage_capacity_before: int
    storage_used_by_plan: int
    storage_remaining: int
    slots_before: Optional[int]
    slots_used_by_plan: int
    slots_remaining: Optional[int]


@dataclass
class RescuePlanResult:
    """Structured outcome of a rescue optimisation."""

    assignments: list[Assignment]
    unassigned: list[Unassigned]
    remaining_capacity: list[EquipmentCapacity]
    feasible: bool          # True iff every sample was rescued
    partial: bool           # True iff some but not all were rescued
    rescued_count: int
    total_count: int
    method: str             # "milp" or "greedy-fallback"
    explanation: str
    objective_value: Optional[float] = None


# ----------------------------------------------------------------------
# Compatibility helpers
# ----------------------------------------------------------------------
def _compatible(item: RescueItem, eq: CandidateEquipment) -> tuple[bool, str]:
    """Return (is_compatible, reason_if_not) for a single (sample, equipment)."""
    if eq.status.lower() != "operational":
        return False, f"'{eq.name}' is not operational (status '{eq.status}')"
    if eq.equipment_id == item.source_equipment_id:
        return False, f"'{eq.name}' is the sample's own (failing) equipment"
    if (
        item.min_temperature < eq.min_temperature
        or item.max_temperature > eq.max_temperature
    ):
        return False, (
            f"'{eq.name}' range [{eq.min_temperature}, {eq.max_temperature}] "
            f"does not cover sample range "
            f"[{item.min_temperature}, {item.max_temperature}]"
        )
    if item.storage_space > eq.free_storage:
        return False, (
            f"'{eq.name}' has {eq.free_storage} free storage; sample needs "
            f"{item.storage_space}"
        )
    if eq.free_slots is not None and eq.free_slots < 1:
        return False, f"'{eq.name}' has no free slots"
    return True, ""


def _no_candidate_reason(
    item: RescueItem, equipment: list[CandidateEquipment]
) -> tuple[str, list[str]]:
    """Explain why a sample has no feasible candidate at all."""
    notes: list[str] = []
    for eq in equipment:
        ok, why = _compatible(item, eq)
        if not ok:
            notes.append(why)
    if not equipment:
        return "no backup equipment available", notes
    return "no compatible backup equipment (see details)", notes


# ----------------------------------------------------------------------
# MILP optimiser
# ----------------------------------------------------------------------
def optimize_rescue(
    items: list[RescueItem],
    equipment: list[CandidateEquipment],
) -> RescuePlanResult:
    """Compute an optimal rescue allocation.

    Uses a MILP when SciPy is available, otherwise a priority-ordered greedy
    fallback. Pure and read-only.
    """
    if not items:
        return RescuePlanResult(
            assignments=[],
            unassigned=[],
            remaining_capacity=_capacity_snapshot(equipment, {}),
            feasible=True,
            partial=False,
            rescued_count=0,
            total_count=0,
            method="milp",
            explanation="No samples required rescue.",
            objective_value=0.0,
        )

    # Build the list of feasible (sample, equipment) pairs.
    eq_by_id = {e.equipment_id: e for e in equipment}
    pair_index: list[tuple[int, int]] = []  # (item_idx, eq_idx)
    for si, item in enumerate(items):
        for ei, eq in enumerate(equipment):
            ok, _ = _compatible(item, eq)
            if ok:
                pair_index.append((si, ei))

    try:
        result = _solve_milp(items, equipment, pair_index)
        if result is not None:
            return result
    except Exception:  # noqa: BLE001 - fall back if the solver errors
        pass

    return _solve_greedy(items, equipment, pair_index)


def _solve_milp(
    items: list[RescueItem],
    equipment: list[CandidateEquipment],
    pair_index: list[tuple[int, int]],
) -> Optional[RescuePlanResult]:
    """Solve the allocation as a MILP via scipy.optimize.milp."""
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp

    n_vars = len(pair_index)
    if n_vars == 0:
        # No feasible placement for anyone.
        return _assemble_result(items, equipment, {}, method="milp",
                                 objective_value=0.0)

    # Objective: maximise -> minimise the negative.
    c = np.zeros(n_vars)
    for k, (si, _ei) in enumerate(pair_index):
        c[k] = -(items[si].priority_weight + RESCUE_BONUS)

    constraints = []

    # (1) each sample assigned at most once.
    for si in range(len(items)):
        row = np.zeros(n_vars)
        for k, (s, _e) in enumerate(pair_index):
            if s == si:
                row[k] = 1.0
        if row.any():
            constraints.append(LinearConstraint(row, lb=0, ub=1))

    # (2) storage capacity per equipment; (3) slot limit per equipment.
    for ei, eq in enumerate(equipment):
        storage_row = np.zeros(n_vars)
        slot_row = np.zeros(n_vars)
        for k, (s, e) in enumerate(pair_index):
            if e == ei:
                storage_row[k] = items[s].storage_space
                slot_row[k] = 1.0
        if storage_row.any():
            constraints.append(
                LinearConstraint(storage_row, lb=0, ub=eq.free_storage)
            )
            if eq.free_slots is not None:
                constraints.append(
                    LinearConstraint(slot_row, lb=0, ub=eq.free_slots)
                )

    integrality = np.ones(n_vars)  # all binary
    bounds = Bounds(lb=0, ub=1)

    res = milp(
        c=c,
        constraints=constraints,
        integrality=integrality,
        bounds=bounds,
    )
    if not res.success or res.x is None:
        return None

    chosen: dict[int, int] = {}  # item_idx -> eq_idx
    for k, (si, ei) in enumerate(pair_index):
        if res.x[k] > 0.5:
            chosen[si] = ei

    objective = -float(res.fun) if res.fun is not None else None
    return _assemble_result(items, equipment, chosen, method="milp",
                            objective_value=objective)


def _solve_greedy(
    items: list[RescueItem],
    equipment: list[CandidateEquipment],
    pair_index: list[tuple[int, int]],
) -> RescuePlanResult:
    """Greedy fallback: assign highest-priority first to the tightest fit.

    Only used if the MILP solver is unavailable. Not guaranteed optimal.
    """
    free_storage = {i: e.free_storage for i, e in enumerate(equipment)}
    free_slots = {
        i: e.free_slots for i, e in enumerate(equipment)
    }
    order = sorted(
        range(len(items)),
        key=lambda i: (-items[i].priority_weight, items[i].storage_space),
    )
    feasible_eqs: dict[int, list[int]] = {}
    for si, ei in pair_index:
        feasible_eqs.setdefault(si, []).append(ei)

    chosen: dict[int, int] = {}
    for si in order:
        candidates = feasible_eqs.get(si, [])
        # Best-fit: smallest remaining storage that still fits.
        best = None
        for ei in candidates:
            if free_storage[ei] >= items[si].storage_space and (
                free_slots[ei] is None or free_slots[ei] >= 1
            ):
                if best is None or free_storage[ei] < free_storage[best]:
                    best = ei
        if best is not None:
            chosen[si] = best
            free_storage[best] -= items[si].storage_space
            if free_slots[best] is not None:
                free_slots[best] -= 1

    return _assemble_result(items, equipment, chosen, method="greedy-fallback",
                            objective_value=None)


# ----------------------------------------------------------------------
# Result assembly
# ----------------------------------------------------------------------
def _capacity_snapshot(
    equipment: list[CandidateEquipment], chosen: dict[int, int],
    items: Optional[list[RescueItem]] = None,
) -> list[EquipmentCapacity]:
    """Build remaining-capacity rows given the chosen assignments."""
    used_storage: dict[int, int] = {i: 0 for i in range(len(equipment))}
    used_slots: dict[int, int] = {i: 0 for i in range(len(equipment))}
    if items is not None:
        for si, ei in chosen.items():
            used_storage[ei] += items[si].storage_space
            used_slots[ei] += 1

    rows: list[EquipmentCapacity] = []
    for ei, eq in enumerate(equipment):
        slots_remaining = (
            None if eq.free_slots is None else eq.free_slots - used_slots[ei]
        )
        rows.append(
            EquipmentCapacity(
                equipment_id=eq.equipment_id,
                equipment_name=eq.name,
                storage_capacity_before=eq.free_storage,
                storage_used_by_plan=used_storage[ei],
                storage_remaining=eq.free_storage - used_storage[ei],
                slots_before=eq.free_slots,
                slots_used_by_plan=used_slots[ei],
                slots_remaining=slots_remaining,
            )
        )
    return rows


def _assemble_result(
    items: list[RescueItem],
    equipment: list[CandidateEquipment],
    chosen: dict[int, int],
    *,
    method: str,
    objective_value: Optional[float],
) -> RescuePlanResult:
    assignments: list[Assignment] = []
    for si, ei in chosen.items():
        item = items[si]
        eq = equipment[ei]
        assignments.append(
            Assignment(
                sample_id=item.sample_id,
                sample_name=item.name,
                equipment_id=eq.equipment_id,
                equipment_name=eq.name,
                storage_space=item.storage_space,
                priority=item.priority,
            )
        )

    unassigned: list[Unassigned] = []
    for si, item in enumerate(items):
        if si in chosen:
            continue
        # Distinguish "no compatible equipment at all" from "compatible but
        # could not fit given competition for capacity".
        any_compatible = any(
            _compatible(item, eq)[0] for eq in equipment
        )
        if any_compatible:
            reason = (
                "compatible backup exists but capacity was allocated to "
                "higher-priority or better-fitting samples"
            )
            notes = []
        else:
            reason, notes = _no_candidate_reason(item, equipment)
        unassigned.append(
            Unassigned(
                sample_id=item.sample_id,
                sample_name=item.name,
                priority=item.priority,
                reason=reason,
                candidate_notes=notes,
            )
        )

    rescued = len(assignments)
    total = len(items)
    feasible = rescued == total
    partial = 0 < rescued < total

    if total == 0:
        explanation = "No samples required rescue."
    elif feasible:
        explanation = (
            f"All {total} sample(s) were allocated to compatible backup "
            f"equipment within capacity and slot limits."
        )
    elif rescued == 0:
        explanation = (
            "No samples could be rescued. No backup equipment satisfied the "
            "temperature, operational-status, storage, and slot constraints."
        )
    else:
        explanation = (
            f"Partial plan: {rescued} of {total} sample(s) rescued. Remaining "
            f"samples could not be placed without violating capacity, slot, or "
            f"temperature constraints; higher-priority samples were preferred."
        )

    return RescuePlanResult(
        assignments=sorted(assignments, key=lambda a: a.sample_id),
        unassigned=sorted(unassigned, key=lambda u: u.sample_id),
        remaining_capacity=_capacity_snapshot(equipment, chosen, items),
        feasible=feasible,
        partial=partial,
        rescued_count=rescued,
        total_count=total,
        method=method,
        explanation=explanation,
        objective_value=objective_value,
    )
