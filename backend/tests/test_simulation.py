"""Phase 2: temperature simulation lifecycle, telemetry (latest/history),
fault injection, duplicate-process prevention, and clean stop."""

from __future__ import annotations

import threading
import time

from tests.conftest import make_equipment


def _sim_threads():
    return [t for t in threading.enumerate() if t.name == "temperature-simulator"]


def test_simulation_lifecycle_and_no_duplicate(client, clean_db):
    make_equipment(client, name="SimFZ", min_temperature=-80, max_temperature=-20)

    assert client.get("/api/simulation/status").json()["running"] is False

    # invalid interval
    assert client.post("/api/simulation/start",
                       json={"interval_seconds": 0}).status_code == 422

    r = client.post("/api/simulation/start", json={"interval_seconds": 0.3})
    assert r.status_code == 200 and r.json()["running"] is True
    try:
        # duplicate start keeps a single thread
        client.post("/api/simulation/start", json={"interval_seconds": 0.3})
        assert len(_sim_threads()) == 1
        time.sleep(1.0)
        assert client.get("/api/simulation/status").json()["ticks"] >= 1
    finally:
        assert client.post("/api/simulation/stop").status_code == 200
    time.sleep(0.4)
    assert len(_sim_threads()) == 0
    # fault flags cleared on stop
    st = client.get("/api/simulation/status").json()
    assert st["abnormal_equipment_ids"] == [] and st["failed_equipment_ids"] == []


def test_telemetry_latest_and_history(client, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    # 404 before any readings
    assert client.get(f"/api/simulation/equipment/{eid}/latest").status_code == 404

    client.post("/api/simulation/start", json={"interval_seconds": 0.25})
    try:
        time.sleep(1.3)
        latest = client.get(f"/api/simulation/equipment/{eid}/latest").json()
        assert -80 <= latest["temperature"] <= -20  # normal stays in range
        hist = client.get(f"/api/simulation/equipment/{eid}/history").json()
        assert len(hist) >= 2
        ts = [h["timestamp"] for h in hist]
        assert ts == sorted(ts, reverse=True)  # newest first
        # limit validation
        assert client.get(f"/api/simulation/equipment/{eid}/history",
                          params={"limit": 0}).status_code == 422
    finally:
        client.post("/api/simulation/stop")


def test_abnormal_and_failure_modes(client, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    eid = eq["id"]
    client.post("/api/simulation/start", json={"interval_seconds": 0.25})
    try:
        # abnormal -> out of range
        client.post(f"/api/simulation/equipment/{eid}/abnormal",
                    json={"enabled": True})
        time.sleep(1.0)
        t = client.get(f"/api/simulation/equipment/{eid}/latest").json()["temperature"]
        assert t < -80 or t > -20
        client.post(f"/api/simulation/equipment/{eid}/abnormal",
                    json={"enabled": False})
        # failure -> offline + extreme
        client.post(f"/api/simulation/equipment/{eid}/fail", json={"enabled": True})
        time.sleep(1.0)
        t = client.get(f"/api/simulation/equipment/{eid}/latest").json()["temperature"]
        assert t > -20
        assert client.get(f"/api/equipment/{eid}").json()["status"] == "offline"
    finally:
        client.post("/api/simulation/stop")


def test_fault_injection_on_missing_equipment_404(client):
    assert client.post("/api/simulation/equipment/999999/abnormal",
                       json={"enabled": True}).status_code == 404
    assert client.post("/api/simulation/equipment/999999/fail",
                       json={"enabled": True}).status_code == 404
    assert client.get("/api/simulation/equipment/999999/latest").status_code == 404
