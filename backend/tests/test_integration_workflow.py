"""Cross-phase integration: the complete LabSentinel workflow end to end.

Equipment + samples (P1) -> simulation drives a failure (P2) -> detection
raises an alert and reports critical risk (P3) -> rescue planner evacuates the
endangered samples to healthy backups (P4). Verifies the phases interlock and
that rescue planning never mutates inventory.
"""

from __future__ import annotations

import time

from tests.conftest import make_equipment, make_sample


def test_failure_to_rescue_workflow(client, clean_db):
    # P1: a primary freezer with two samples, plus a healthy backup freezer.
    primary = make_equipment(client, name="Primary", min_temperature=-80,
                             max_temperature=-20, storage_capacity=10)
    backup = make_equipment(client, name="Backup", min_temperature=-80,
                            max_temperature=-20, storage_capacity=10)
    make_sample(client, primary["id"], name="A", min_temperature=-70,
                max_temperature=-30, storage_space=2, priority="high")
    make_sample(client, primary["id"], name="B", min_temperature=-70,
                max_temperature=-30, storage_space=3, priority="critical")

    # P2 + P3: simulate a hardware failure on the primary -> telemetry,
    # offline status, and an automatic alert.
    client.post("/api/simulation/start", json={"interval_seconds": 0.25})
    try:
        client.post(f"/api/simulation/equipment/{primary['id']}/fail",
                    json={"enabled": True})
        time.sleep(1.5)
        # telemetry recorded
        assert client.get(
            f"/api/simulation/equipment/{primary['id']}/latest"
        ).status_code == 200
        # risk is critical and explained
        risk = client.get(
            f"/api/detection/equipment/{primary['id']}/risk"
        ).json()
        assert risk["risk_level"] == "critical"
        assert len(risk["reasons"]) >= 2
        # alert raised automatically
        active = client.get("/api/detection/alerts").json()
        assert any(a["equipment_id"] == primary["id"] for a in active)
        # equipment marked offline
        assert client.get(
            f"/api/equipment/{primary['id']}"
        ).json()["status"] == "offline"
    finally:
        client.post("/api/simulation/stop")

    # P4: generate a rescue plan. Auto-detects the offline primary as source,
    # uses the healthy backup.
    plan = client.post("/api/rescue/plan", json={}).json()
    # both samples (2 + 3 = 5) fit in the backup's 10 capacity
    assert plan["rescued_count"] == 2 and plan["feasible"] is True
    moved = {a["sample_name"]: a["equipment_name"] for a in plan["assignments"]}
    assert moved == {"A": "Backup", "B": "Backup"}

    # Inventory unchanged by planning: samples still in the (failed) primary.
    still = client.get("/api/samples",
                       params={"equipment_id": primary["id"]}).json()
    assert len(still) == 2
    assert client.get(f"/api/equipment/{backup['id']}").json()["used_storage"] == 0


def test_openapi_exposes_all_phase_routes(client):
    """Frontend-integration guard: all expected routes are present in the schema."""
    paths = set(client.get("/openapi.json").json()["paths"].keys())
    expected = {
        "/api/health",
        "/api/equipment", "/api/equipment/{equipment_id}",
        "/api/samples", "/api/samples/{sample_id}",
        "/api/simulation/start", "/api/simulation/stop", "/api/simulation/status",
        "/api/simulation/equipment/{equipment_id}/latest",
        "/api/simulation/equipment/{equipment_id}/history",
        "/api/detection/equipment/{equipment_id}/risk",
        "/api/detection/alerts", "/api/detection/alerts/history",
        "/api/detection/alerts/{alert_id}/resolve",
        "/api/rescue/plan", "/api/rescue/plans", "/api/rescue/plans/{plan_id}",
    }
    missing = expected - paths
    assert not missing, f"missing routes: {missing}"
