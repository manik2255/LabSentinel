"""Phase 5D: recovery verification + incident closure.

Covers recording recovery outcomes (completed / partial / unresolved), the rule
that transfer success is not assumed to mean viability, closure preconditions
(execution + recovery + explicit confirm + unrescued acknowledgment), invalid
closure attempts, duplicate requests, and the audit trail. Isolated DB.
"""

from __future__ import annotations

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _executed_incident(client, db):
    """Build an incident whose feasible plan is fully executed. Returns ids."""
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    backup = make_equipment(client, name="Backup", min_temperature=-80,
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
    assert plan["feasible"] is True
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 201
    return {"incident": iid, "primary": primary["id"],
            "backup": backup["id"], "sample": sample["id"]}


def _executed_partial_incident(client, db):
    """Build an incident whose executed plan is PARTIAL (one sample unrescued)."""
    primary = make_equipment(client, name="P", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    make_equipment(client, name="B", min_temperature=-80,
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
    assert client.post(f"/api/incidents/{iid}/plan/execute").status_code == 201
    return {"incident": iid, "primary": primary["id"],
            "fits": fits["id"], "toobig": toobig["id"]}


# ----------------------------------------------------------------------
# Successful (completed) recovery + close
# ----------------------------------------------------------------------
def test_completed_recovery_then_close(client, db, clean_db):
    ids = _executed_incident(client, db)
    iid = ids["incident"]

    # recovery_recorded flag starts False
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["recovery_status"] == "pending"
    assert inc["recovery_recorded"] is False
    assert inc["closed"] is False

    r = client.post(f"/api/incidents/{iid}/recovery",
                    json={"outcome": "completed", "notes": "all samples cold"})
    assert r.status_code == 200
    body = r.json()
    assert body["recovery_status"] == "completed"
    assert body["recovery_recorded"] is True
    assert body["recovery_recorded_at"] is not None

    # close requires explicit confirmation
    assert client.post(f"/api/incidents/{iid}/close", json={}).status_code == 422
    r = client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "closed" and body["closed"] is True
    assert body["closed_at"] is not None


# ----------------------------------------------------------------------
# Partial recovery requires acknowledging unrescued samples before closing
# ----------------------------------------------------------------------
def test_partial_recovery_requires_ack_before_close(client, db, clean_db):
    ids = _executed_partial_incident(client, db)
    iid = ids["incident"]

    # 'completed' is contradictory when samples were left unrescued
    r = client.post(f"/api/incidents/{iid}/recovery", json={"outcome": "completed"})
    assert r.status_code == 422

    # record partial WITHOUT acknowledging -> cannot close
    client.post(f"/api/incidents/{iid}/recovery", json={"outcome": "partial"})
    r = client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    assert r.status_code == 409
    assert "unrescued" in r.json()["detail"].lower()

    # re-record partial WITH acknowledgment -> close succeeds
    r = client.post(f"/api/incidents/{iid}/recovery",
                    json={"outcome": "partial", "unrescued_acknowledged": True,
                          "notes": "reagent left behind, flagged for review"})
    assert r.status_code == 200
    r = client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    assert r.status_code == 200 and r.json()["status"] == "closed"

    # the unrescued sample genuinely stayed on the primary
    assert client.get(
        f"/api/samples/{ids['toobig']}"
    ).json()["equipment_id"] == ids["primary"]


# ----------------------------------------------------------------------
# Unresolved recovery
# ----------------------------------------------------------------------
def test_unresolved_recovery_can_close_with_ack(client, db, clean_db):
    ids = _executed_partial_incident(client, db)
    iid = ids["incident"]
    r = client.post(f"/api/incidents/{iid}/recovery",
                    json={"outcome": "unresolved",
                          "unrescued_acknowledged": True,
                          "notes": "backup temp unstable; monitoring"})
    assert r.status_code == 200 and r.json()["recovery_status"] == "unresolved"
    r = client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    assert r.status_code == 200 and r.json()["status"] == "closed"


def test_invalid_recovery_outcome_rejected(client, db, clean_db):
    ids = _executed_incident(client, db)
    r = client.post(f"/api/incidents/{ids['incident']}/recovery",
                    json={"outcome": "totally-fine"})
    assert r.status_code == 422


# ----------------------------------------------------------------------
# Closure preconditions / invalid attempts
# ----------------------------------------------------------------------
def test_cannot_record_recovery_before_execution(client, db, clean_db):
    # build an incident with an approved (but NOT executed) plan
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
    client.post(f"/api/incidents/{iid}/plan")
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    # no execution yet -> recovery and close both refused (409)
    assert client.post(f"/api/incidents/{iid}/recovery",
                       json={"outcome": "completed"}).status_code == 409
    assert client.post(f"/api/incidents/{iid}/close",
                       json={"confirm": True}).status_code == 409


def test_cannot_close_before_recovery(client, db, clean_db):
    ids = _executed_incident(client, db)
    # executed but no recovery recorded -> close refused
    r = client.post(f"/api/incidents/{ids['incident']}/close",
                    json={"confirm": True})
    assert r.status_code == 409
    assert "recovery" in r.json()["detail"].lower()


def test_duplicate_close_rejected(client, db, clean_db):
    ids = _executed_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/recovery", json={"outcome": "completed"})
    assert client.post(f"/api/incidents/{iid}/close",
                       json={"confirm": True}).status_code == 200
    # second close -> 409
    r = client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    assert r.status_code == 409 and "already closed" in r.json()["detail"].lower()


def test_closed_incident_is_terminal(client, db, clean_db):
    ids = _executed_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/recovery", json={"outcome": "completed"})
    client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    # no further lifecycle actions on a closed incident
    assert client.post(f"/api/incidents/{iid}/acknowledge").status_code == 409
    assert client.post(f"/api/incidents/{iid}/escalate").status_code == 409
    assert client.post(f"/api/incidents/{iid}/plan").status_code == 409
    # recovery cannot be changed after closure
    assert client.post(f"/api/incidents/{iid}/recovery",
                       json={"outcome": "unresolved"}).status_code == 409


def test_recovery_can_be_updated_before_close(client, db, clean_db):
    ids = _executed_partial_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/recovery", json={"outcome": "partial"})
    # operator revises the outcome before closing
    r = client.post(f"/api/incidents/{iid}/recovery",
                    json={"outcome": "unresolved", "unrescued_acknowledged": True})
    assert r.status_code == 200 and r.json()["recovery_status"] == "unresolved"


def test_recovery_and_close_missing_incident_404(client):
    assert client.post("/api/incidents/999999/recovery",
                       json={"outcome": "completed"}).status_code == 404
    assert client.post("/api/incidents/999999/close",
                       json={"confirm": True}).status_code == 404


# ----------------------------------------------------------------------
# Audit trail
# ----------------------------------------------------------------------
def test_recovery_and_closure_in_audit_trail(client, db, clean_db):
    ids = _executed_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/recovery",
                json={"outcome": "completed", "notes": "verified"})
    client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    events = client.get(f"/api/incidents/{iid}/events").json()
    types = [e["event_type"] for e in events]
    assert "recovery_recorded" in types
    assert "incident_closed" in types
    # ordering: recovery before closure; all have timestamps + explanations
    assert types.index("recovery_recorded") < types.index("incident_closed")
    assert all(e["timestamp"] and e["explanation"] for e in events)
    closed_ev = [e for e in events if e["event_type"] == "incident_closed"][-1]
    assert closed_ev["detail"]["recovery_status"] == "completed"
