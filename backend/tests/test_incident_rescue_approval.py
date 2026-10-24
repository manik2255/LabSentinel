"""Phase 5B: incident rescue planning + human approval.

Covers plan generation/association via the incident API, approval of feasible
plans, explicit partial-plan acknowledgment, rejection, stale-plan refusal,
duplicate approvals, invalid transitions, escalation not blocking planning, and
the guarantee that approval never moves samples or modifies inventory.
"""

from __future__ import annotations

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _open_incident_for_failed_equipment(client, db, *, with_backup=True,
                                        sample_space=2, backup_capacity=10):
    """Create a primary with a sample + (optional) backup, fail the primary via
    the detection path so an incident opens, and return ids."""
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    backup = None
    if with_backup:
        backup = make_equipment(client, name="Backup", min_temperature=-80,
                                max_temperature=-20,
                                storage_capacity=backup_capacity)
    sample = make_sample(client, primary["id"], name="S", min_temperature=-70,
                         max_temperature=-30, storage_space=sample_space,
                         priority="high")
    # drive a critical out-of-range reading and open an incident
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    # also mark offline so revalidation sees the sample on a failing unit
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    return {
        "primary": primary["id"],
        "backup": backup["id"] if backup else None,
        "sample": sample["id"],
        "incident": risk["incident_id"],
    }


# ----------------------------------------------------------------------
# Plan generation + association
# ----------------------------------------------------------------------
def test_generate_and_get_incident_plan(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]

    r = client.post(f"/api/incidents/{iid}/plan")
    assert r.status_code == 201
    plan = r.json()
    assert plan["method"] == "milp"
    assert plan["feasible"] is True and plan["rescued_count"] == 1
    assert plan["assignments"][0]["equipment_name"] == "Backup"
    assert len(plan["constraints"]) >= 5

    # plan accessible via GET and reflected on the incident
    got = client.get(f"/api/incidents/{iid}/plan").json()
    assert got["plan_id"] == plan["plan_id"]
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["rescue_plan_id"] == plan["plan_id"]
    assert inc["rescue_plan_status"] == "planned"


def test_get_plan_before_generation_404(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    assert client.get(f"/api/incidents/{ids['incident']}/plan").status_code == 404


# ----------------------------------------------------------------------
# Approval of feasible plans
# ----------------------------------------------------------------------
def test_approve_feasible_plan(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")

    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 200
    inc = r.json()
    assert inc["rescue_plan_status"] == "approved"
    assert inc["plan_reviewed_at"] is not None
    # lifecycle status is untouched by approval
    assert inc["status"] == "open"

    # READ-ONLY: approval moved nothing. Sample still on the failed primary.
    still = client.get("/api/samples",
                       params={"equipment_id": ids["primary"]}).json()
    assert len(still) == 1
    assert client.get(
        f"/api/equipment/{ids['backup']}"
    ).json()["used_storage"] == 0


def test_duplicate_approval_rejected(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    assert client.post(f"/api/incidents/{iid}/plan/approve", json={}).status_code == 200
    # approving again -> 409
    assert client.post(f"/api/incidents/{iid}/plan/approve", json={}).status_code == 409


def test_approve_without_plan_409(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    assert client.post(
        f"/api/incidents/{ids['incident']}/plan/approve", json={}
    ).status_code == 409


# ----------------------------------------------------------------------
# Partial plans
# ----------------------------------------------------------------------
def test_partial_plan_requires_acknowledgment(client, db, clean_db):
    # sample needs 8 storage; backup only has 5 -> partial (0 rescuable here is
    # actually infeasible, so size it so one fits and one doesn't).
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    backup = make_equipment(client, name="B", min_temperature=-80,
                            max_temperature=-20, storage_capacity=5)
    make_sample(client, primary["id"], name="fits", min_temperature=-70,
                max_temperature=-30, storage_space=5, priority="high")
    make_sample(client, primary["id"], name="toobig", min_temperature=-70,
                max_temperature=-30, storage_space=5, priority="low")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]

    plan = client.post(f"/api/incidents/{iid}/plan").json()
    assert plan["partial"] is True and plan["rescued_count"] == 1

    # approving a partial plan without acknowledgment -> 422
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 422
    assert "partial" in r.json()["detail"].lower()

    # with acknowledgment -> 200
    r = client.post(f"/api/incidents/{iid}/plan/approve",
                    json={"acknowledge_unrescued": True})
    assert r.status_code == 200 and r.json()["rescue_plan_status"] == "approved"


def test_infeasible_plan_cannot_be_approved(client, db, clean_db):
    # only an incompatible (warm) backup -> nothing rescuable
    primary = make_equipment(client, name="ColdP", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    make_equipment(client, name="WarmB", min_temperature=0,
                   max_temperature=8, storage_capacity=100)
    make_sample(client, primary["id"], name="frozen", min_temperature=-70,
                max_temperature=-30, storage_space=1, priority="critical")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]
    plan = client.post(f"/api/incidents/{iid}/plan").json()
    assert plan["rescued_count"] == 0
    r = client.post(f"/api/incidents/{iid}/plan/approve",
                    json={"acknowledge_unrescued": True})
    assert r.status_code == 409  # infeasible cannot be approved


# ----------------------------------------------------------------------
# Rejection
# ----------------------------------------------------------------------
def test_reject_plan_then_requires_new_plan(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")

    r = client.post(f"/api/incidents/{iid}/plan/reject",
                    json={"note": "prefer different backup"})
    assert r.status_code == 200 and r.json()["rescue_plan_status"] == "rejected"

    # approving a rejected plan -> 409
    assert client.post(f"/api/incidents/{iid}/plan/approve",
                       json={}).status_code == 409
    # rejecting again -> 409
    assert client.post(f"/api/incidents/{iid}/plan/reject",
                       json={}).status_code == 409

    # regenerate -> back to 'planned', now approvable
    client.post(f"/api/incidents/{iid}/plan")
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["rescue_plan_status"] == "planned"
    assert client.post(f"/api/incidents/{iid}/plan/approve",
                       json={}).status_code == 200


# ----------------------------------------------------------------------
# Stale plans (revalidation)
# ----------------------------------------------------------------------
def test_stale_plan_refused_when_backup_goes_offline(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    # the backup goes offline AFTER the plan was generated
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "offline"})
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 409
    assert "stale" in r.json()["detail"].lower() or "changed" in r.json()["detail"].lower()
    # a failure event is recorded in the audit trail
    events = client.get(f"/api/incidents/{iid}/events").json()
    assert any(e["event_type"] == "plan_approval_failed" for e in events)


def test_stale_plan_refused_when_capacity_shrinks(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db, sample_space=5,
                                              backup_capacity=10)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    # shrink the backup's capacity below what the plan needs (sample needs 5)
    client.patch(f"/api/equipment/{ids['backup']}", json={"storage_capacity": 4})
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 409


# ----------------------------------------------------------------------
# Escalation does not block planning
# ----------------------------------------------------------------------
def test_escalation_does_not_block_plan_or_approval(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    # escalate first (terminal in the lifecycle dimension)
    assert client.post(f"/api/incidents/{iid}/escalate").status_code == 200
    # planning still works while escalated
    assert client.post(f"/api/incidents/{iid}/plan").status_code == 201
    # approval still works while escalated; lifecycle stays 'escalated'
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "escalated"
    assert r.json()["rescue_plan_status"] == "approved"


# ----------------------------------------------------------------------
# Missing incident + audit trail
# ----------------------------------------------------------------------
def test_plan_endpoints_missing_incident_404(client):
    assert client.post("/api/incidents/999999/plan").status_code == 404
    assert client.get("/api/incidents/999999/plan").status_code == 404
    assert client.post("/api/incidents/999999/plan/approve",
                       json={}).status_code == 404
    assert client.post("/api/incidents/999999/plan/reject",
                       json={}).status_code == 404


def test_audit_trail_records_plan_events(client, db, clean_db):
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    events = client.get(f"/api/incidents/{iid}/events").json()
    types = [e["event_type"] for e in events]
    assert "plan_generated" in types
    assert "plan_approved" in types
    assert all(e["timestamp"] and e["explanation"] for e in events)


# ======================================================================
# Phase 5B verification: revalidation semantics, durable failure audit,
# approval invalidation, partial-approval recording, and read-only on the
# failed path. (Added as permanent regression tests.)
# ======================================================================
def test_revalidation_does_not_require_identical_reoptimization(client, db, clean_db):
    """A still-valid stored plan approves even if a *fresh* optimisation would
    now choose different assignments.

    After the plan is generated, we add a second, emptier backup that a new
    optimisation could prefer. The stored assignment to the original backup is
    still valid (operational, compatible, capacity holds), so approval must
    succeed WITHOUT requiring the plan to match a re-optimised result.
    """
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    backup1 = make_equipment(client, name="Backup-1", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    sample = make_sample(client, primary["id"], name="S", min_temperature=-70,
                         max_temperature=-30, storage_space=2, priority="high")
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    iid = risk["incident_id"]

    plan = client.post(f"/api/incidents/{iid}/plan").json()
    assert plan["assignments"][0]["equipment_name"] == "Backup-1"

    # Inventory change that a fresh optimiser might act on, but that does NOT
    # invalidate the stored assignment: add a brand-new empty backup.
    make_equipment(client, name="Backup-2-roomier", min_temperature=-90,
                   max_temperature=-10, storage_capacity=100)

    # The stored plan (sample -> Backup-1) is still perfectly valid, so
    # approval succeeds; we do not demand identical re-optimisation.
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 200, r.text
    assert r.json()["rescue_plan_status"] == "approved"
    # the approved plan still references the ORIGINAL backup (never silently
    # swapped to Backup-2)
    got = client.get(f"/api/incidents/{iid}/plan").json()
    assert got["assignments"][0]["equipment_name"] == "Backup-1"
    assert got["assignments"][0]["sample_id"] == sample["id"]


def test_failed_stale_approval_event_is_durable(client, db, clean_db):
    """A failed approval must persist an audit event even though the API
    returns an error. Verified by querying event history AFTER the error."""
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")

    # invalidate: the chosen backup goes offline after planning
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "offline"})

    events_before = client.get(f"/api/incidents/{iid}/events").json()
    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 409  # API returns an error

    # ...yet the failure is durably recorded in the audit trail.
    events_after = client.get(f"/api/incidents/{iid}/events").json()
    assert len(events_after) == len(events_before) + 1
    failure = events_after[-1]
    assert failure["event_type"] == "plan_approval_failed"
    assert failure["detail"] and failure["detail"].get("problems")
    assert failure["timestamp"] and failure["explanation"]
    # the incident was NOT approved by the failed attempt
    assert client.get(f"/api/incidents/{iid}").json()["rescue_plan_status"] == "planned"


def test_failed_approval_does_not_modify_inventory(client, db, clean_db):
    """The stale/failed approval path must not move samples or change capacity."""
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "offline"})
    client.patch(f"/api/equipment/{ids['backup']}", json={"status": "operational"})
    # shrink capacity to force staleness while keeping backup operational
    client.patch(f"/api/equipment/{ids['backup']}", json={"storage_capacity": 0})

    r = client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert r.status_code == 409
    # sample still on the (failed) primary; backup unchanged in occupancy
    still = client.get("/api/samples",
                       params={"equipment_id": ids["primary"]}).json()
    assert len(still) == 1
    assert client.get(
        f"/api/equipment/{ids['backup']}"
    ).json()["used_storage"] == 0


def test_regenerating_plan_invalidates_previous_approval(client, db, clean_db):
    """Approve a plan, then regenerate: the approval is invalidated and the new
    plan returns to 'planned' (must be re-reviewed)."""
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]
    first = client.post(f"/api/incidents/{iid}/plan").json()
    assert client.post(f"/api/incidents/{iid}/plan/approve",
                       json={}).status_code == 200
    assert client.get(f"/api/incidents/{iid}").json()["rescue_plan_status"] == "approved"

    # regenerate -> prior approval invalidated
    second = client.post(f"/api/incidents/{iid}/plan").json()
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["rescue_plan_status"] == "planned"
    assert inc["rescue_plan_id"] == second["plan_id"]
    # audit records that the previous plan was superseded
    gen_events = [e for e in client.get(f"/api/incidents/{iid}/events").json()
                  if e["event_type"] == "plan_generated"]
    assert gen_events[-1]["detail"]["superseded_plan_id"] == first["plan_id"]


def test_partial_approval_records_unrescued_samples(client, db, clean_db):
    """A partial approval must durably record which samples were left behind."""
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    make_equipment(client, name="B", min_temperature=-80,
                   max_temperature=-20, storage_capacity=5)
    make_sample(client, primary["id"], name="fits", min_temperature=-70,
                max_temperature=-30, storage_space=5, priority="high")
    make_sample(client, primary["id"], name="toobig", min_temperature=-70,
                max_temperature=-30, storage_space=5, priority="low")
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
    r = client.post(f"/api/incidents/{iid}/plan/approve",
                    json={"acknowledge_unrescued": True})
    assert r.status_code == 200

    events = client.get(f"/api/incidents/{iid}/events").json()
    approved = [e for e in events if e["event_type"] == "plan_approved"][-1]
    # the unrescued sample(s) are explicitly recorded in the audit detail
    recorded = approved["detail"]["unrescued_samples"]
    names = {u["sample_name"] for u in recorded}
    assert "toobig" in names
    # and the human-readable explanation names them too
    assert "toobig" in approved["explanation"]


# ======================================================================
# Backend-authoritative approval/execution flags (frontend-integration guard).
# ======================================================================
def test_backend_authoritative_approval_flags(client, db, clean_db):
    """`approval_recorded` / `execution_recorded` reflect ONLY real backend
    state, so a frontend-only optimistic approval cannot be confused with a
    genuine, backend-recorded one."""
    ids = _open_incident_for_failed_equipment(client, db)
    iid = ids["incident"]

    # Before any approval: both flags are False even though a plan exists.
    client.post(f"/api/incidents/{iid}/plan")
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["approval_recorded"] is False
    assert inc["execution_recorded"] is False

    # After a real backend approval: approval_recorded True, execution False.
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["approval_recorded"] is True
    assert inc["execution_recorded"] is False

    # After execution: both True.
    client.post(f"/api/incidents/{iid}/plan/execute")
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["approval_recorded"] is True
    assert inc["execution_recorded"] is True
