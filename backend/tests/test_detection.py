"""Phase 3: anomaly detection, explainable risk, gradual-drift early warning,
automatic alerts via the simulator, dedupe, resolution, and honest limitations."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from app.crud.sensor_reading import record_reading
from tests.conftest import make_equipment, make_sample


def _insert_series(db, eid, temps):
    for t in temps:
        record_reading(db, eid, t)


def test_risk_no_data_and_limitations(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    body = client.get(f"/api/detection/equipment/{eid}/risk").json()
    assert body["insufficient_data"] is True
    assert body["risk_level"] == "low"
    assert len(body["reasons"]) >= 1

    # one reading -> still insufficient, and the limitation is explained
    record_reading(db, eid, -50.0)
    body = client.get(f"/api/detection/equipment/{eid}/risk").json()
    assert body["insufficient_data"] is True
    assert any("limitation" in r.lower() or "reading(s) available" in r.lower()
               for r in body["reasons"])


def test_risk_missing_equipment_404(client):
    assert client.get("/api/detection/equipment/999999/risk").status_code == 404


def test_normal_is_low_risk(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    _insert_series(db, eid, [-50.0] * 12)
    body = client.get(f"/api/detection/equipment/{eid}/risk").json()
    assert body["insufficient_data"] is False
    assert body["risk_level"] == "low"
    assert body["anomaly_score"] < 0.5


def test_range_violation_escalates_and_evidence(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    _insert_series(db, eid, [-50.0] * 10 + [25.0])  # last reading out of range
    body = client.get(f"/api/detection/equipment/{eid}/risk").json()
    assert body["risk_level"] in ("high", "critical")
    assert len(body["reasons"]) >= 2  # explainable evidence


def test_gradual_drift_detected_before_limit(client, db, clean_db):
    """Drift must be flagged by the model before the safe limit is crossed."""
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    _insert_series(db, eid, [-50.0] * 10)  # stable baseline
    max_temp = -20.0
    flagged_temp = None
    breach_temp = None
    for t in [round(-50 + 2.0 * i, 2) for i in range(1, 20)]:
        record_reading(db, eid, t)
        body = client.get(f"/api/detection/equipment/{eid}/risk").json()
        if flagged_temp is None and body["anomaly_score"] >= 0.75:
            flagged_temp = t
        if breach_temp is None and t > max_temp:
            breach_temp = t
    assert flagged_temp is not None, "model never flagged the drift"
    assert flagged_temp <= max_temp, (
        f"flagged at {flagged_temp} only after breach {max_temp}")


def test_high_priority_sample_escalates_to_critical(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20,
                        storage_capacity=10)
    eid = eq["id"]
    make_sample(client, eid, name="HP", min_temperature=-80,
                max_temperature=-60, storage_space=1, priority="high")
    _insert_series(db, eid, [-50.0] * 10 + [-45.0])  # violates sample's -60 max
    body = client.get(f"/api/detection/equipment/{eid}/risk").json()
    assert body["risk_level"] == "critical"
    assert "HP" in body["endangered_samples"]


def test_automatic_alert_dedupe_and_resolution(client, db, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    # drive an out-of-range condition and raise an alert via the endpoint
    _insert_series(db, eid, [-50.0] * 5 + [30.0])
    r = client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()
    assert r["alert_created"] is True and r["alert_id"] is not None
    # dedupe: second raise does not create a new alert
    r2 = client.get(f"/api/detection/equipment/{eid}/risk?raise_alert=true").json()
    assert r2["alert_created"] is False
    active = client.get("/api/detection/alerts").json()
    assert len([a for a in active if a["equipment_id"] == eid]) == 1
    aid = active[0]["id"]
    # resolve
    rr = client.post(f"/api/detection/alerts/{aid}/resolve")
    assert rr.status_code == 200 and rr.json()["resolved"] is True
    assert rr.json()["resolved_at"] is not None
    # double resolve -> 409
    assert client.post(f"/api/detection/alerts/{aid}/resolve").status_code == 409
    # resolve missing -> 404
    assert client.post("/api/detection/alerts/999999/resolve").status_code == 404
    # history retains it
    hist = client.get("/api/detection/alerts/history").json()
    assert any(h["id"] == aid and h["resolved"] for h in hist)


def test_simulator_raises_alerts_automatically(client, clean_db):
    """Integration: running the simulator in failure mode auto-creates alerts."""
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    client.post("/api/simulation/start", json={"interval_seconds": 0.25})
    try:
        client.post(f"/api/simulation/equipment/{eid}/fail", json={"enabled": True})
        time.sleep(1.5)
        active = client.get("/api/detection/alerts").json()
        assert any(a["equipment_id"] == eid for a in active)
    finally:
        client.post("/api/simulation/stop")
