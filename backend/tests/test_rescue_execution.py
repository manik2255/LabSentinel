"""Phase 5C: safe rescue execution + action tracking.

Covers successful execution (simulated transfer), partial plans, stale/approval
guards, changed capacity, equipment going offline, duplicate execution,
transaction rollback, the concurrency compare-and-set guard, and the audit
trail / execution record. Runs against an isolated DB.
"""

from __future__ import annotations

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _approved_incident(client, db, *, sample_space=2, backup_capacity=10,
                       backup_slots=None):
    """Open an incident on a failed primary with one sample + a backup, generate
    and approve a feasible plan, and return the key ids."""
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    backup = make_equipment(client, name="Backup", min_temperature=-80,
                            max_temperature=-20,
                            storage_capacity=backup_capacity,
                            sample_limit=backup_slots)
    sample = make_sample(client, primary["id"], name="S", min_temperature=-70,
                         max_temperature=-30, storage_space=sample_space,
                         priority="high")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]
    client.post(f"/api/incidents/{iid}/plan")
    assert client.post(f"/api/incidents/{iid}/plan/approve",
                       json={}).status_code == 200
    return {"incident": iid, "primary": primary["id"],
            "backup": backup["id"], "sample": sample["id"]}


# ----------------------------------------------------------------------
# Successful execution
# ----------------------------------------------------------------------
def test_successful_execution_moves_samples(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]

    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 201, r.text
    ex = r.json()
    assert ex["status"] == "success"
    assert ex["transferred_sample_ids"] == [ids["sample"]]
    assert ex["transfers"][0]["from_equipment_id"] == ids["primary"]
    assert ex["transfers"][0]["to_equipment_id"] == ids["backup"]

    # the sample actually moved to the backup
    sample = client.get(f"/api/samples/{ids['sample']}").json()
    assert sample["equipment_id"] == ids["backup"]
    assert client.get(f"/api/equipment/{ids['backup']}").json()["used_storage"] == 2
    assert client.get(f"/api/equipment/{ids['primary']}").json()["used_storage"] == 0

    # incident reflects executed status + link
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["rescue_plan_status"] == "executed"
    assert inc["rescue_execution_id"] == ex["id"]
    assert inc["executed_at"] is not None


def test_execution_result_retrievable(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    ex = client.post(f"/api/incidents/{iid}/plan/execute").json()
    got = client.get(f"/api/incidents/{iid}/plan/execution").json()
    assert got["id"] == ex["id"] and got["status"] == "success"


def test_execution_records_audit_event(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan/execute")
    events = client.get(f"/api/incidents/{iid}/events").json()
    succeeded = [e for e in events if e["event_type"] == "execution_succeeded"]
    assert succeeded, [e["event_type"] for e in events]
    assert succeeded[-1]["detail"]["transferred_sample_ids"] == [ids["sample"]]


# ----------------------------------------------------------------------
# Partial plans: only approved assignments move
# ----------------------------------------------------------------------
def test_partial_plan_execution_moves_only_rescued(client, db, clean_db):
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    backup = make_equipment(client, name="B", min_temperature=-80,
                            max_temperature=-20, storage_capacity=5)
    fits = make_sample(client, primary["id"], name="fits", min_temperature=-70,
                       max_temperature=-30, storage_space=5, priority="high")
    toobig = make_sample(client, primary["id"], name="toobig",
                         min_temperature=-70, max_temperature=-30,
                         storage_space=5, priority="low")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]
    plan = client.post(f"/api/incidents/{iid}/plan").json()
    assert plan["partial"] is True
    client.post(f"/api/incidents/{iid}/plan/approve",
                json={"acknowledge_unrescued": True})

    ex = client.post(f"/api/incidents/{iid}/plan/execute").json()
    assert ex["status"] == "success"
    assert ex["transferred_sample_ids"] == [fits["id"]]
    # the rescued one moved; the unrescued one stayed in place
    assert client.get(f"/api/samples/{fits['id']}").json()["equipment_id"] == backup["id"]
    assert client.get(f"/api/samples/{toobig['id']}").json()["equipment_id"] == primary["id"]


# ----------------------------------------------------------------------
# Guards: unapproved / rejected / superseded / duplicate
# ----------------------------------------------------------------------
def test_cannot_execute_unapproved_plan(client, db, clean_db):
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    make_equipment(client, name="B", min_temperature=-80, max_temperature=-20,
                   storage_capacity=10)
    make_sample(client, primary["id"], name="S", min_temperature=-70,
                max_temperature=-30, storage_space=2, priority="high")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]
    # no plan yet
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 409
    # planned but not approved
    client.post(f"/api/incidents/{iid}/plan")
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 409


def test_cannot_execute_rejected_plan(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    # approved, but reject requires regenerate; force reject by regenerating
    # then rejecting the fresh (planned) plan.
    client.post(f"/api/incidents/{iid}/plan")  # supersede -> planned
    client.post(f"/api/incidents/{iid}/plan/reject")
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 409


def test_superseded_plan_blocks_execution_until_reapproved(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    # regenerate -> back to 'planned', approval invalidated
    client.post(f"/api/incidents/{iid}/plan")
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 409
    # re-approve the new plan, then execution works
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 201


def test_duplicate_execution_rejected(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 201
    # second execution -> 409, and the sample is not moved again / duplicated
    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 409
    assert "already" in r.json()["detail"].lower()


# ----------------------------------------------------------------------
# Stale approval / changed inventory
# ----------------------------------------------------------------------
def test_stale_backup_offline_blocks_execution(client, db, clean_db):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    # backup goes offline AFTER approval
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "offline"})
    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 409
    # inventory untouched: sample still on primary
    assert client.get(
        f"/api/samples/{ids['sample']}"
    ).json()["equipment_id"] == ids["primary"]
    # a failed execution record + audit event exist
    events = client.get(f"/api/incidents/{iid}/events").json()
    assert any(e["event_type"] == "execution_failed" for e in events)
    # the plan is NOT marked executed (claim reverted / never taken)
    assert client.get(f"/api/incidents/{iid}").json()["rescue_plan_status"] == "approved"


def test_stale_capacity_shrink_blocks_execution(client, db, clean_db):
    ids = _approved_incident(client, db, sample_space=5, backup_capacity=10)
    iid = ids["incident"]
    # shrink backup capacity below the sample's need, after approval
    client.patch(f"/api/equipment/{ids['backup']}", json={"storage_capacity": 4})
    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 409
    assert client.get(
        f"/api/samples/{ids['sample']}"
    ).json()["equipment_id"] == ids["primary"]


def test_sample_already_moved_blocks_execution(client, db, clean_db):
    """If the sample is no longer on a failing unit, execution is refused."""
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    # bring the primary back operational -> sample no longer "needs rescue"
    client.patch(f"/api/equipment/{ids['primary']}", json={"status": "operational"})
    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 409


# ----------------------------------------------------------------------
# Failed-execution record + no partial inventory
# ----------------------------------------------------------------------
def test_failed_execution_persists_record_and_no_partial_inventory(
    client, db, clean_db
):
    ids = _approved_incident(client, db)
    iid = ids["incident"]
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "offline"})
    client.post(f"/api/incidents/{iid}/plan/execute")  # fails (409)
    # a failed execution record is retrievable
    ex = client.get(f"/api/incidents/{iid}/plan/execution").json()
    assert ex["status"] == "failed"
    assert ex["transferred_sample_ids"] == []
    assert ex["problems"]
    # no inventory change
    assert client.get(
        f"/api/samples/{ids['sample']}"
    ).json()["equipment_id"] == ids["primary"]


# ----------------------------------------------------------------------
# Concurrency: compare-and-set claim prevents double execution
# ----------------------------------------------------------------------
def test_concurrency_claim_is_atomic(client, db, clean_db):
    """The low-level claim allows exactly one winner; a second claim fails."""
    from app.crud import incident as incident_crud

    ids = _approved_incident(client, db)
    iid = ids["incident"]
    # first claim wins, second loses (simulates a race on the approved plan)
    first = incident_crud._claim_execution(db, iid)
    second = incident_crud._claim_execution(db, iid)
    assert first is True and second is False
    # revert so we don't leave the incident wedged for other assertions
    incident_crud._revert_execution_claim(db, iid)


def test_transaction_rollback_leaves_no_partial_state(client, db, clean_db):
    """Force a mid-batch failure and confirm NO sample moved (atomic rollback).

    Two samples are approved to move to a backup that can hold the first but not
    both after capacity is secretly shrunk below the pair's total; execution
    must roll back entirely, leaving both samples on the primary.
    """
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    backup = make_equipment(client, name="B", min_temperature=-80,
                            max_temperature=-20, storage_capacity=10)
    s1 = make_sample(client, primary["id"], name="s1", min_temperature=-70,
                     max_temperature=-30, storage_space=5, priority="high")
    s2 = make_sample(client, primary["id"], name="s2", min_temperature=-70,
                     max_temperature=-30, storage_space=5, priority="high")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]
    plan = client.post(f"/api/incidents/{iid}/plan").json()
    assert plan["rescued_count"] == 2  # both fit at approval time (10 capacity)
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    # shrink capacity so the pair no longer fits -> execution must roll back
    client.patch(f"/api/equipment/{backup['id']}", json={"storage_capacity": 6})
    r = client.post(f"/api/incidents/{iid}/plan/execute")
    assert r.status_code == 409
    # NEITHER sample moved
    assert client.get(f"/api/samples/{s1['id']}").json()["equipment_id"] == primary["id"]
    assert client.get(f"/api/samples/{s2['id']}").json()["equipment_id"] == primary["id"]
    assert client.get(f"/api/equipment/{backup['id']}").json()["used_storage"] == 0


def test_execute_missing_incident_404(client):
    assert client.post("/api/incidents/999999/plan/execute").status_code == 404
    assert client.get("/api/incidents/999999/plan/execution").status_code == 404
