"""Phase 5: incident management + audit trail.

Covers automatic incident triggers from the detection workflow, deduplication
of active incidents, acknowledge/escalate transitions, invalid transitions,
the audit-trail event history, and integration with detection and simulation.
"""

from __future__ import annotations

import time

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _drive_high_risk(db, client, eid):
    """Record readings that produce a high/critical risk (out-of-range)."""
    for _ in range(6):
        record_reading(db, eid, -50.0)
    record_reading(db, eid, 30.0)  # far above max -> critical
    return client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()


# ----------------------------------------------------------------------
# Trigger policy + dedupe
# ----------------------------------------------------------------------
def test_incident_created_on_high_risk(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    risk = _drive_high_risk(db, client, eid)
    assert risk["risk_level"] in ("high", "critical")
    assert risk["incident_created"] is True
    assert risk["incident_id"] is not None

    inc = client.get(f"/api/incidents/{risk['incident_id']}").json()
    assert inc["equipment_id"] == eid
    assert inc["status"] == "open"
    assert inc["risk_severity"] in ("high", "critical")
    assert inc["alert_id"] is not None          # linked to the alert
    assert "recent_readings" in inc["evidence"]  # telemetry evidence captured


def test_no_incident_on_low_risk(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    for _ in range(12):
        record_reading(db, eid, -50.0)  # perfectly normal
    risk = client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()
    assert risk["risk_level"] == "low"
    assert risk["incident_created"] is False
    assert risk["incident_id"] is None
    assert client.get("/api/incidents").json() == []


def test_incident_dedupe_no_duplicate_active(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    r1 = _drive_high_risk(db, client, eid)
    iid = r1["incident_id"]
    # another qualifying reading must refresh, not duplicate
    record_reading(db, eid, 35.0)
    r2 = client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()
    assert r2["incident_created"] is False
    assert r2["incident_id"] == iid
    # only one active incident for the equipment
    active = client.get("/api/incidents", params={"active_only": True}).json()
    assert len([i for i in active if i["equipment_id"] == eid]) == 1
    # the refresh is recorded in the audit trail
    events = client.get(f"/api/incidents/{iid}/events").json()
    assert any(e["event_type"] == "evidence_updated" for e in events)


def test_affected_samples_captured(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20,
                        storage_capacity=10)
    eid = eq["id"]
    make_sample(client, eid, name="HP", min_temperature=-80,
                max_temperature=-60, storage_space=1, priority="high")
    for _ in range(6):
        record_reading(db, eid, -50.0)
    record_reading(db, eid, -45.0)  # violates sample's -60 max -> critical
    risk = client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()
    inc = client.get(f"/api/incidents/{risk['incident_id']}").json()
    assert any(s.get("name") == "HP" for s in inc["affected_samples"])


# ----------------------------------------------------------------------
# Lifecycle transitions
# ----------------------------------------------------------------------
def test_acknowledge_then_escalate(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    iid = _drive_high_risk(db, client, eid)["incident_id"]

    r = client.post(f"/api/incidents/{iid}/acknowledge",
                    json={"note": "on it"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "acknowledged" and body["acknowledged_at"] is not None

    r = client.post(f"/api/incidents/{iid}/escalate")
    assert r.status_code == 200
    assert r.json()["status"] == "escalated" and r.json()["escalated_at"] is not None


def test_escalate_directly_from_open(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    iid = _drive_high_risk(db, client, eid)["incident_id"]
    r = client.post(f"/api/incidents/{iid}/escalate")
    assert r.status_code == 200 and r.json()["status"] == "escalated"


def test_invalid_transitions(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    iid = _drive_high_risk(db, client, eid)["incident_id"]
    # escalate first
    client.post(f"/api/incidents/{iid}/escalate")
    # cannot acknowledge after escalated -> 409
    r = client.post(f"/api/incidents/{iid}/acknowledge")
    assert r.status_code == 409 and "detail" in r.json()
    # cannot escalate again (escalated is terminal in this phase) -> 409
    r = client.post(f"/api/incidents/{iid}/escalate")
    assert r.status_code == 409

    # acknowledge twice is invalid
    eq2 = make_equipment(client, name="E2", min_temperature=-80, max_temperature=-20)
    iid2 = _drive_high_risk(db, client, eq2["id"])["incident_id"]
    assert client.post(f"/api/incidents/{iid2}/acknowledge").status_code == 200
    assert client.post(f"/api/incidents/{iid2}/acknowledge").status_code == 409


def test_transitions_on_missing_incident_404(client):
    assert client.post("/api/incidents/999999/acknowledge").status_code == 404
    assert client.post("/api/incidents/999999/escalate").status_code == 404
    assert client.get("/api/incidents/999999").status_code == 404
    assert client.get("/api/incidents/999999/events").status_code == 404


# ----------------------------------------------------------------------
# Audit trail + alert independence
# ----------------------------------------------------------------------
def test_audit_trail_records_all_events(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    iid = _drive_high_risk(db, client, eid)["incident_id"]
    client.post(f"/api/incidents/{iid}/acknowledge", json={"note": "ack note"})
    client.post(f"/api/incidents/{iid}/escalate", json={"note": "esc note"})

    events = client.get(f"/api/incidents/{iid}/events").json()
    types = [e["event_type"] for e in events]
    assert types[0] == "created"
    assert "acknowledged" in types and "escalated" in types
    # every event has a timestamp + explanation
    assert all(e["timestamp"] and e["explanation"] for e in events)
    # oldest-first ordering
    ts = [e["timestamp"] for e in events]
    assert ts == sorted(ts)


def test_incident_survives_alert_resolution(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    risk = _drive_high_risk(db, client, eid)
    iid, aid = risk["incident_id"], risk["alert_id"]
    # resolve the underlying alert
    assert client.post(f"/api/detection/alerts/{aid}/resolve").status_code == 200
    # incident still exists, unchanged lifecycle, history intact
    inc = client.get(f"/api/incidents/{iid}").json()
    assert inc["status"] == "open"
    assert inc["alert_id"] == aid  # link preserved
    assert len(client.get(f"/api/incidents/{iid}/events").json()) >= 1


# ----------------------------------------------------------------------
# Integration with the live simulator
# ----------------------------------------------------------------------
def test_simulator_failure_creates_incident(client, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    client.post("/api/simulation/start", json={"interval_seconds": 0.25})
    try:
        client.post(f"/api/simulation/equipment/{eid}/fail", json={"enabled": True})
        time.sleep(1.5)
        incidents = client.get("/api/incidents",
                               params={"equipment_id": eid}).json()
        assert len(incidents) >= 1
        inc = incidents[0]
        assert inc["trigger"] in ("equipment_failure", "critical_risk", "high_risk")
        assert inc["status"] == "open"
    finally:
        client.post("/api/simulation/stop")
    # dedupe held across many simulator ticks: still a single active incident
    active = client.get("/api/incidents",
                        params={"equipment_id": eid, "active_only": True}).json()
    assert len(active) == 1
