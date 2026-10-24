"""Serialisation helpers converting optimiser dataclasses to plain dicts."""

from __future__ import annotations

from app.rescue.optimizer import RescuePlanResult


def result_to_dict(result: RescuePlanResult) -> dict:
    """Convert a RescuePlanResult into a JSON-serialisable dict.

    The shape matches the API's RescuePlanResponse (minus plan_id/created_at,
    which are added by the router from the stored row).
    """
    return {
        "feasible": result.feasible,
        "partial": result.partial,
        "rescued_count": result.rescued_count,
        "total_count": result.total_count,
        "method": result.method,
        "explanation": result.explanation,
        "objective_value": result.objective_value,
        "assignments": [
            {
                "sample_id": a.sample_id,
                "sample_name": a.sample_name,
                "equipment_id": a.equipment_id,
                "equipment_name": a.equipment_name,
                "storage_space": a.storage_space,
                "priority": a.priority,
            }
            for a in result.assignments
        ],
        "unassigned": [
            {
                "sample_id": u.sample_id,
                "sample_name": u.sample_name,
                "priority": u.priority,
                "reason": u.reason,
                "candidate_notes": list(u.candidate_notes),
            }
            for u in result.unassigned
        ],
        "remaining_capacity": [
            {
                "equipment_id": c.equipment_id,
                "equipment_name": c.equipment_name,
                "storage_capacity_before": c.storage_capacity_before,
                "storage_used_by_plan": c.storage_used_by_plan,
                "storage_remaining": c.storage_remaining,
                "slots_before": c.slots_before,
                "slots_used_by_plan": c.slots_used_by_plan,
                "slots_remaining": c.slots_remaining,
            }
            for c in result.remaining_capacity
        ],
    }
