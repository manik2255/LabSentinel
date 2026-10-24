"""Phase 4: MILP rescue optimizer correctness, priority conflicts, constraints,
infeasible plans, read-only guarantee, persistence and stale-plan retrieval."""

from __future__ import annotations

from app.rescue.optimizer import (
    CandidateEquipment,
    RescueItem,
    optimize_rescue,
)
from tests.conftest import make_equipment, make_sample

RANGE = dict(min_temperature=-80.0, max_temperature=-20.0)


def _naive_first_fit(items, equipment):
    free = {i: e.free_storage for i, e in enumerate(equipment)}
    slots = {i: e.free_slots for i, e in enumerate(equipment)}
    placed = 0
    for it in items:
        for i, e in enumerate(equipment):
            temp_ok = (it.min_temperature >= e.min_temperature
                       and it.max_temperature <= e.max_temperature)
            if (temp_ok and e.status == "operational"
                    and free[i] >= it.storage_space
                    and (slots[i] is None or slots[i] >= 1)):
                free[i] -= it.storage_space
                if slots[i] is not None:
                    slots[i] -= 1
                placed += 1
                break
    return placed


# ---- unit-level optimizer tests -----------------------------------------
def test_optimizer_beats_greedy_on_packing():
    eqs = [
        CandidateEquipment(equipment_id=1, name="A", free_storage=10,
                           free_slots=None, status="operational", **RANGE),
        CandidateEquipment(equipment_id=2, name="B", free_storage=10,
                           free_slots=None, status="operational", **RANGE),
    ]
    items = [
        RescueItem(sample_id=1, name="s6a", storage_space=6, priority="medium",
                   **RANGE),
        RescueItem(sample_id=2, name="s6b", storage_space=6, priority="medium",
                   **RANGE),
        RescueItem(sample_id=3, name="s5a", storage_space=5, priority="medium",
                   **RANGE),
        RescueItem(sample_id=4, name="s5b", storage_space=5, priority="medium",
                   **RANGE),
    ]
    opt = optimize_rescue(items, eqs)
    naive = _naive_first_fit(items, eqs)
    assert opt.method == "milp"
    assert opt.rescued_count == 3
    assert naive == 2
    assert opt.rescued_count > naive
    for cap in opt.remaining_capacity:
        assert cap.storage_remaining >= 0


def test_optimizer_prioritises_high_over_bulky_low():
    eqs = [CandidateEquipment(equipment_id=1, name="Solo", free_storage=10,
                              free_slots=None, status="operational", **RANGE)]
    items = [
        RescueItem(sample_id=1, name="bulky-low", storage_space=10,
                   priority="low", **RANGE),
        RescueItem(sample_id=2, name="hi-1", storage_space=5, priority="high",
                   **RANGE),
        RescueItem(sample_id=3, name="hi-2", storage_space=5, priority="high",
                   **RANGE),
    ]
    opt = optimize_rescue(items, eqs)
    rescued = {a.sample_name for a in opt.assignments}
    assert rescued == {"hi-1", "hi-2"}
    assert opt.partial is True


def test_optimizer_constraint_enforcement():
    # temperature incompatible
    warm = CandidateEquipment(equipment_id=9, name="Warm", min_temperature=0,
                              max_temperature=10, free_storage=100,
                              free_slots=None, status="operational")
    cold = RescueItem(sample_id=1, name="c", storage_space=1, priority="high",
                      **RANGE)
    r = optimize_rescue([cold], [warm])
    assert r.rescued_count == 0
    assert any("does not cover" in n for u in r.unassigned
               for n in u.candidate_notes)
    # offline backup
    down = CandidateEquipment(equipment_id=9, name="Down", free_storage=100,
                              free_slots=None, status="offline", **RANGE)
    r = optimize_rescue([RescueItem(sample_id=1, name="x", storage_space=1,
                                    priority="high", **RANGE)], [down])
    assert r.rescued_count == 0
    # slot limit
    slot = CandidateEquipment(equipment_id=9, name="One", free_storage=100,
                              free_slots=1, status="operational", **RANGE)
    two = [RescueItem(sample_id=1, name="a", storage_space=1, priority="high",
                      **RANGE),
           RescueItem(sample_id=2, name="b", storage_space=1, priority="high",
                      **RANGE)]
    assert optimize_rescue(two, [slot]).rescued_count == 1


def test_optimizer_edge_cases():
    eqs = [CandidateEquipment(equipment_id=1, name="A", free_storage=10,
                              free_slots=None, status="operational", **RANGE)]
    empty = optimize_rescue([], eqs)
    assert empty.feasible and empty.rescued_count == 0
    none = optimize_rescue([RescueItem(sample_id=1, name="a", storage_space=1,
                                       priority="high", **RANGE)], [])
    assert none.rescued_count == 0
    assert all(u.reason for u in none.unassigned)


# ---- API integration ----------------------------------------------------
def test_rescue_api_full_workflow(client, clean_db):
    src = make_equipment(client, name="FailFZ", storage_capacity=30)
    make_equipment(client, name="B1", storage_capacity=10)
    make_equipment(client, name="B2", storage_capacity=10)
    for nm, sz, pr in [("s6a", 6, "medium"), ("s6b", 6, "medium"),
                       ("s5a", 5, "high"), ("s5b", 5, "high")]:
        make_sample(client, src["id"], name=nm, storage_space=sz, priority=pr)
    client.patch(f"/api/equipment/{src['id']}", json={"status": "offline"})

    r = client.post("/api/rescue/plan", json={})
    assert r.status_code == 201
    plan = r.json()
    assert plan["method"] == "milp"
    assert plan["rescued_count"] == 3 and plan["partial"] is True
    assert {a["sample_name"] for a in plan["assignments"]} >= {"s5a", "s5b"}
    assert len(plan["constraints"]) >= 5
    assert all(u["reason"] for u in plan["unassigned"])
    assert all(c["storage_remaining"] >= 0 for c in plan["remaining_capacity"])
    pid = plan["plan_id"]
    assert pid is not None

    # READ-ONLY: planning must not move samples
    still = client.get("/api/samples", params={"equipment_id": src["id"]}).json()
    assert len(still) == 4

    # retrieve + list + stale retrieval returns the same stored plan
    got = client.get(f"/api/rescue/plans/{pid}").json()
    assert got["rescued_count"] == 3
    assert any(p["id"] == pid for p in client.get("/api/rescue/plans").json())
    # retrieving again yields identical content (stale plan is a snapshot)
    again = client.get(f"/api/rescue/plans/{pid}").json()
    assert again["assignments"] == got["assignments"]

    assert client.get("/api/rescue/plans/999999").status_code == 404
    assert client.post("/api/rescue/plan",
                       json={"source_equipment_ids": [999999]}).status_code == 404


def test_rescue_api_infeasible_with_explanation(client, clean_db):
    warm = make_equipment(client, name="WarmOnly", min_temperature=0,
                          max_temperature=8, storage_capacity=100)
    src = make_equipment(client, name="ColdFail", storage_capacity=10)
    make_sample(client, src["id"], name="frozen", priority="critical")
    client.patch(f"/api/equipment/{src['id']}", json={"status": "offline"})
    r = client.post("/api/rescue/plan", json={
        "source_equipment_ids": [src["id"]],
        "backup_equipment_ids": [warm["id"]]})
    body = r.json()
    assert body["rescued_count"] == 0 and body["feasible"] is False
    assert "No samples could be rescued" in body["explanation"]
    assert any(u["candidate_notes"] for u in body["unassigned"])


def test_rescue_api_nothing_to_rescue(client, clean_db):
    make_equipment(client, name="Healthy", storage_capacity=10)
    body = client.post("/api/rescue/plan", json={}).json()
    assert body["feasible"] is True and body["total_count"] == 0


def test_rescue_plan_does_not_modify_inventory_stale(client, clean_db):
    """A stored plan stays valid to retrieve even after inventory changes,
    and retrieving/generating never mutates equipment or samples."""
    src = make_equipment(client, name="FZ", storage_capacity=10)
    b = make_equipment(client, name="BK", storage_capacity=10)
    s = make_sample(client, src["id"], name="s1", storage_space=2)
    client.patch(f"/api/equipment/{src['id']}", json={"status": "offline"})
    plan = client.post("/api/rescue/plan",
                       json={"source_equipment_ids": [src["id"]],
                             "backup_equipment_ids": [b["id"]]}).json()
    pid = plan["plan_id"]
    assert plan["rescued_count"] == 1

    # Mutate inventory AFTER planning: delete the sample.
    client.delete(f"/api/samples/{s['id']}")
    # The stored (now stale) plan is still retrievable unchanged.
    stale = client.get(f"/api/rescue/plans/{pid}").json()
    assert stale["rescued_count"] == 1
    assert stale["assignments"][0]["sample_id"] == s["id"]
    # And the backup was never actually loaded with the sample.
    assert client.get(f"/api/equipment/{b['id']}").json()["used_storage"] == 0
