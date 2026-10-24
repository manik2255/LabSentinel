"""Shared pytest fixtures for the LabSentinel backend test suite.

Every test runs against an ISOLATED, throwaway SQLite database and an isolated
anomaly-model file, set via environment variables BEFORE the app is imported.
The real ``labsentinel.db`` and ``app/anomaly_model.joblib`` are never touched.
"""

from __future__ import annotations

import os
import tempfile
import uuid

import pytest

# --- isolate the database + model BEFORE importing the app ---------------
_TMP = tempfile.gettempdir()
_DB_PATH = os.path.join(_TMP, f"labsentinel_test_{uuid.uuid4().hex}.db")
_MODEL_PATH = os.path.join(_TMP, f"labsentinel_test_model_{uuid.uuid4().hex}.joblib")
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH.replace(os.sep, '/')}"
os.environ["ANOMALY_MODEL_PATH"] = _MODEL_PATH

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.detection import detector  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _prepare_schema_and_model():
    """Create all tables once and train the anomaly model for the session."""
    Base.metadata.create_all(bind=engine)
    detector.ensure_ready(_MODEL_PATH)
    yield
    engine.dispose()
    for p in (_DB_PATH, _MODEL_PATH):
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError:
            pass


@pytest.fixture()
def client():
    """A TestClient bound to the app (runs lifespan startup/shutdown)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db():
    """A raw DB session for direct inserts (e.g. seeding sensor readings)."""
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def clean_db():
    """Delete all rows from every table so a test starts from empty state.

    Returns nothing; use as a dependency to guarantee isolation between tests
    that assert on global listings (e.g. active alerts, rescue plans).
    """
    s = SessionLocal()
    try:
        # Order respects FK dependencies (children before parents).
        for table in (
            "incident_events",
            "rescue_executions",
            "incidents",
            "sensor_readings",
            "alerts",
            "rescue_plans",
            "samples",
            "equipment",
        ):
            s.execute(__import__("sqlalchemy").text(f"DELETE FROM {table}"))
        s.commit()
    finally:
        s.close()
    yield


def make_equipment(client, **overrides):
    """Helper: create equipment via the API and return the JSON body."""
    payload = {
        "name": "Freezer",
        "type": "freezer",
        "location": "Lab",
        "min_temperature": -80.0,
        "max_temperature": -20.0,
        "storage_capacity": 20,
        "sample_limit": None,
    }
    payload.update(overrides)
    r = client.post("/api/equipment", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def make_sample(client, equipment_id, **overrides):
    """Helper: create a sample via the API and return the JSON body."""
    payload = {
        "name": "Sample",
        "equipment_id": equipment_id,
        "min_temperature": -70.0,
        "max_temperature": -30.0,
        "storage_space": 1,
        "priority": "medium",
    }
    payload.update(overrides)
    r = client.post("/api/samples", json=payload)
    assert r.status_code == 201, r.text
    return r.json()
