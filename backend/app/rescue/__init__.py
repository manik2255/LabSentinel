"""Sample rescue planning (Phase 4).

Given samples endangered by failed/unsafe equipment and a pool of candidate
backup equipment, computes an optimal reassignment plan that respects
temperature compatibility, operational status, storage capacity and sample
slot limits, while prioritising high-priority samples and maximising the
number rescued.

Planning is strictly read-only: generating a plan never moves samples or
mutates inventory.
"""

from app.rescue.optimizer import (
    CandidateEquipment,
    RescueItem,
    RescuePlanResult,
    optimize_rescue,
)

__all__ = [
    "CandidateEquipment",
    "RescueItem",
    "RescuePlanResult",
    "optimize_rescue",
]
