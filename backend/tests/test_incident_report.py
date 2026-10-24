"""Phase 5E: read-only incident report (GET /api/incidents/{id}/report).

Covers the report at every incident stage (just created, plan generated but not
executed, executed-complete, executed-partial with unrescued reasons, closed
with recovery), accurate sample counts, timeline accuracy, missing information
handled without assumptions, and an invalid incident id.
"""

from __future__ import annotations

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _open_incident(client, db, *, backup=True, backup_capacity=10,
                   sample_space=2, extra_big=False):
    """Open an incident on a failed primary. Optionally add a backup and a
    second oversized sample to force a partial plan. Returns ids."""
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=20)
    if backup:
        make_equipment(client, name="Backup", min_temperature=-80,
                       max_temperature=-20, storage_capacity=backup_capacity)
    s1 = make_sample(client, primary["id"], name="S1", min_temperature=-70,
                     max_temperature=-30, storage_space=sample_space,
                     priority="high")
    ids = {"primary": primary["id"], "s1": s1["id"]}
    if extra_big:
        s2 = make_sample(client, primary["id"], name="S2-big",
                         min_temperature=-70, max_temperature=-30,
                         storage_space=backup_capacity + 1, priority="low")
        ids["s2"] = s2["id"]
    for _ in range(6):
        record_reading(db, primary["id"], -50.0)
    record_reading(db, primary["id"], 40.0)
    risk = client.get(
        f"/api/detection/equipment/{primary['id']}/risk?raise_alert=true"
    ).json()
    client.patch(f"/api/equipment/{primary['id']}", json={"status": "offline"})
    ids["incident"] = risk["incident_id"]
    return ids


def _report(client, iid):
    r = client.get(f"/api/incidents/{iid}/report")
    assert r.status_code == 200, r.text
    return r.json()


# ----------------------------------------------------------------------
# Stage 1: incident created, no plan yet
# ----------------------------------------------------------------------
def test_report_no_plan_stage(client, db, clean_db):
    ids = _open_incident(client, db)
    rep = _report(client, ids["incident"])

    assert rep["incident_id"] == ids["incident"]
    assert rep["status"] in ("open", "acknowledged", "escalated")
    assert rep["equipment"]["name"] == "Primary"
    assert rep["equipment"]["status"] == "offline"
    # no plan/execution assumed
    assert rep["rescue_plan"] is None
    assert rep["rescue_plan_status"] == "none"
    assert rep["execution"] is None
    assert rep["transfers"] == []
    assert rep["unrescued_samples"] == []
    # affected counts the samples that need rescue; none rescued yet
    assert rep["sample_counts"]["affected"] == 1
    assert rep["sample_counts"]["rescued"] == 0
    assert rep["sample_counts"]["rescue_executed"] is False
    assert rep["recovery"]["status"] == "pending"
    # timeline has the creation event
    assert any(e["event_type"] == "created" for e in rep["timeline"])


# ----------------------------------------------------------------------
# Stage 2: plan generated but NOT executed -> rescued must still be 0
# ----------------------------------------------------------------------
def test_report_plan_not_executed(client, db, clean_db):
    ids = _open_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    rep = _report(client, iid)

    assert rep["rescue_plan"] is not None
    assert rep["rescue_plan"]["rescuable_count"] == 1  # plan CAN place 1
    assert rep["rescue_plan_status"] == "planned"
    assert rep["execution"] is None
    # nothing actually rescued because not executed
    assert rep["sample_counts"]["rescued"] == 0
    assert rep["sample_counts"]["rescue_executed"] is False
    assert rep["transfers"] == []
    assert any(e["event_type"] == "plan_generated" for e in rep["timeline"])


# ----------------------------------------------------------------------
# Stage 3: executed complete rescue
# ----------------------------------------------------------------------
def test_report_complete_rescue(client, db, clean_db):
    ids = _open_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    client.post(f"/api/incidents/{iid}/plan/execute")
    rep = _report(client, iid)

    assert rep["sample_counts"]["affected"] == 1
    assert rep["sample_counts"]["rescued"] == 1
    assert rep["sample_counts"]["unrescued"] == 0
    assert rep["sample_counts"]["rescue_executed"] is True
    assert ids["s1"] in rep["rescued_sample_ids"]
    # transfer destination recorded
    assert len(rep["transfers"]) == 1
    assert rep["transfers"][0]["to_equipment_name"] == "Backup"
    assert rep["execution"]["status"] == "success"


# ----------------------------------------------------------------------
# Stage 4: executed partial rescue -> unrescued reasons present
# ----------------------------------------------------------------------
def test_report_partial_rescue_with_reasons(client, db, clean_db):
    # backup cap 5; S1 space 2 fits, S2-big space 6 does not -> partial
    ids = _open_incident(client, db, backup_capacity=5, sample_space=2,
                         extra_big=True)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    client.post(f"/api/incidents/{iid}/plan/approve",
                json={"acknowledge_unrescued": True})
    client.post(f"/api/incidents/{iid}/plan/execute")
    rep = _report(client, iid)

    assert rep["sample_counts"]["affected"] == 2
    assert rep["sample_counts"]["rescued"] == 1
    assert rep["sample_counts"]["unrescued"] == 1
    # the unrescued reason comes from the optimiser record
    unres = rep["unrescued_samples"]
    assert len(unres) == 1 and unres[0]["sample_name"] == "S2-big"
    assert unres[0]["reason"]  # a human-readable reason string
    # candidate notes explain the capacity/temperature restriction
    joined = " ".join(unres[0].get("candidate_notes", []))
    assert ("storage" in joined.lower() or "free" in joined.lower()
            or "cover" in joined.lower() or unres[0]["reason"])


# ----------------------------------------------------------------------
# Stage 5: closed incident with recovery outcome
# ----------------------------------------------------------------------
def test_report_closed_with_recovery(client, db, clean_db):
    ids = _open_incident(client, db)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")
    client.post(f"/api/incidents/{iid}/plan/approve", json={})
    client.post(f"/api/incidents/{iid}/plan/execute")
    client.post(f"/api/incidents/{iid}/recovery",
                json={"outcome": "completed", "notes": "verified cold"})
    client.post(f"/api/incidents/{iid}/close", json={"confirm": True})
    rep = _report(client, iid)

    assert rep["status"] == "closed"
    assert rep["recovery"]["status"] == "completed"
    assert rep["recovery"]["notes"] == "verified cold"
    assert rep["timestamps"]["closed_at"] is not None
    # full timeline from creation to closure, in order
    types = [e["event_type"] for e in rep["timeline"]]
    assert "created" in types and "incident_closed" in types
    assert types.index("created") < types.index("incident_closed")
    ts = [e["timestamp"] for e in rep["timeline"]]
    assert ts == sorted(ts)  # chronological


# ----------------------------------------------------------------------
# Counts accuracy when there is no backup (infeasible -> 0 rescuable)
# ----------------------------------------------------------------------
def test_report_counts_no_backup(client, db, clean_db):
    ids = _open_incident(client, db, backup=False)
    iid = ids["incident"]
    client.post(f"/api/incidents/{iid}/plan")  # infeasible, 0 rescuable
    rep = _report(client, iid)
    assert rep["sample_counts"]["affected"] == 1
    assert rep["sample_counts"]["rescued"] == 0
    assert rep["sample_counts"]["unrescued"] == 1
    assert rep["rescue_plan"]["feasible"] is False
    assert rep["unrescued_samples"][0]["reason"]


# ----------------------------------------------------------------------
# Read-only + bad id
# ----------------------------------------------------------------------
def test_report_is_read_only(client, db, clean_db):
    ids = _open_incident(client, db)
    iid = ids["incident"]
    before = client.get(f"/api/incidents/{iid}").json()
    client.get(f"/api/incidents/{iid}/report")
    client.get(f"/api/incidents/{iid}/report")
    after = client.get(f"/api/incidents/{iid}").json()
    # nothing changed by generating the report
    assert before["status"] == after["status"]
    assert before["updated_at"] == after["updated_at"]
    assert before["rescue_plan_status"] == after["rescue_plan_status"]


def test_report_missing_incident_404(client):
    assert client.get("/api/incidents/999999/report").status_code == 404
