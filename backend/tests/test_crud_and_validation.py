"""Phase 1-2: equipment & sample CRUD, storage/slot/temperature validation,
and error-response contracts (for frontend integration)."""

from __future__ import annotations

from tests.conftest import make_equipment, make_sample


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "labsentinel-backend"}


def test_equipment_crud_lifecycle(client, clean_db):
    eq = make_equipment(client, name="CRUD-FZ", storage_capacity=10, sample_limit=3)
    eid = eq["id"]
    # derived capacity on create
    assert eq["available_storage"] == 10 and eq["available_slots"] == 3
    assert eq["used_storage"] == 0 and eq["used_slots"] == 0

    # read
    assert client.get(f"/api/equipment/{eid}").status_code == 200
    # list
    assert any(e["id"] == eid for e in client.get("/api/equipment").json())
    # update
    r = client.patch(f"/api/equipment/{eid}", json={"name": "CRUD-FZ2",
                                                    "storage_capacity": 12})
    assert r.status_code == 200 and r.json()["storage_capacity"] == 12
    # delete (no samples)
    assert client.delete(f"/api/equipment/{eid}").status_code == 204
    assert client.get(f"/api/equipment/{eid}").status_code == 404


def test_equipment_validation_errors(client):
    # temp order invalid -> 422 with pydantic detail list
    r = client.post("/api/equipment", json={
        "name": "bad", "type": "f", "location": "L",
        "min_temperature": 10, "max_temperature": -10, "storage_capacity": 5})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)

    # negative capacity -> 422
    r = client.post("/api/equipment", json={
        "name": "bad", "type": "f", "location": "L",
        "min_temperature": -80, "max_temperature": -20, "storage_capacity": -1})
    assert r.status_code == 422

    # missing required fields -> 422
    r = client.post("/api/equipment", json={"name": "x"})
    assert r.status_code == 422


def test_sample_crud_and_capacity_accounting(client, clean_db):
    eq = make_equipment(client, storage_capacity=10, sample_limit=3)
    eid = eq["id"]
    s = make_sample(client, eid, name="S1", storage_space=4)
    # capacity reflects usage
    eq2 = client.get(f"/api/equipment/{eid}").json()
    assert eq2["used_storage"] == 4 and eq2["available_storage"] == 6
    assert eq2["used_slots"] == 1 and eq2["available_slots"] == 2
    # read / list / filter
    assert client.get(f"/api/samples/{s['id']}").status_code == 200
    assert len(client.get("/api/samples", params={"equipment_id": eid}).json()) == 1
    # delete frees capacity
    assert client.delete(f"/api/samples/{s['id']}").status_code == 204
    assert client.get(f"/api/equipment/{eid}").json()["used_storage"] == 0


def test_sample_storage_and_slot_limits(client, clean_db):
    eq = make_equipment(client, storage_capacity=6, sample_limit=3)
    eid = eq["id"]
    # too-big storage -> 409
    r = client.post("/api/samples", json={
        "name": "big", "equipment_id": eid,
        "min_temperature": -70, "max_temperature": -30,
        "storage_space": 7, "priority": "medium"})
    assert r.status_code == 409 and "detail" in r.json()

    # fill slots to the limit
    for i in range(3):
        make_sample(client, eid, name=f"s{i}", storage_space=1)
    # 4th exceeds slot limit -> 409
    r = client.post("/api/samples", json={
        "name": "s4", "equipment_id": eid,
        "min_temperature": -70, "max_temperature": -30,
        "storage_space": 1, "priority": "medium"})
    assert r.status_code == 409


def test_sample_temperature_compatibility(client, clean_db):
    eq = make_equipment(client, min_temperature=-80, max_temperature=-20)
    r = client.post("/api/samples", json={
        "name": "cold", "equipment_id": eq["id"],
        "min_temperature": -90, "max_temperature": -30,  # below equip min
        "storage_space": 1, "priority": "high"})
    assert r.status_code == 422
    assert "does not cover" in r.json()["detail"]


def test_capacity_reduction_and_delete_guards(client, clean_db):
    eq = make_equipment(client, storage_capacity=10, sample_limit=3)
    eid = eq["id"]
    make_sample(client, eid, storage_space=4)
    # cannot reduce capacity below used -> 409
    assert client.patch(f"/api/equipment/{eid}",
                        json={"storage_capacity": 3}).status_code == 409
    # cannot reduce slot limit below count -> 409 (1 sample so set 0)
    assert client.patch(f"/api/equipment/{eid}",
                        json={"sample_limit": 0}).status_code == 409
    # cannot delete equipment holding samples -> 409
    assert client.delete(f"/api/equipment/{eid}").status_code == 409


def test_sample_move_between_equipment(client, clean_db):
    a = make_equipment(client, name="A", storage_capacity=10)
    b = make_equipment(client, name="B", storage_capacity=2)
    s = make_sample(client, a["id"], storage_space=2)
    # move to B (fits exactly)
    r = client.patch(f"/api/samples/{s['id']}", json={"equipment_id": b["id"]})
    assert r.status_code == 200 and r.json()["equipment_id"] == b["id"]
    assert client.get(f"/api/equipment/{a['id']}").json()["used_storage"] == 0
    assert client.get(f"/api/equipment/{b['id']}").json()["used_storage"] == 2


def test_not_found_contracts(client):
    for path in ("/api/equipment/999999", "/api/samples/999999"):
        r = client.get(path)
        assert r.status_code == 404
        assert "detail" in r.json() and isinstance(r.json()["detail"], str)
