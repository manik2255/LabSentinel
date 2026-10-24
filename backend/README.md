# LabSentinel Backend

Backend foundation for the LabSentinel laboratory equipment monitoring and
emergency sample rescue planning system.

Built with **Python**, **FastAPI**, **SQLite**, and **SQLAlchemy**.

## Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, CORS, startup table creation, /api/health
│   ├── database.py          # Engine, session factory, declarative Base
│   └── models/
│       ├── __init__.py      # Registers all models on the shared Base
│       ├── equipment.py     # Equipment model
│       ├── sample.py        # Sample model
│       ├── sensor_reading.py# SensorReading model
│       └── alert.py         # Alert model
├── requirements.txt
└── README.md
```

## Data model

- **Equipment** — name, type, location, temperature range (`min_temperature`,
  `max_temperature`), `capacity`, and `status`.
- **Sample** — assigned equipment (`equipment_id`), required temperature range
  (`min_temperature`, `max_temperature`), `storage_space`, and `priority`.
- **SensorReading** — `equipment_id`, `temperature`, and `timestamp`.
- **Alert** — `equipment_id`, `severity`, `message`, `timestamp`, and
  `resolved` status.

Relationships: one `Equipment` has many `Sample`, `SensorReading`, and `Alert`
records (each child cascades on delete).

## Setup

From the `backend/` directory:

```bash
# 1. (Recommended) create and activate a virtual environment
python -m venv .venv
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt
```

## Run

From the `backend/` directory:

```bash
uvicorn app.main:app --reload
```

The server starts on http://127.0.0.1:8000. On startup it automatically creates
the SQLite database (`labsentinel.db`) and all tables.

## Verify

- Health check: http://127.0.0.1:8000/api/health → `{"status":"ok","service":"labsentinel-backend"}`
- Interactive API docs: http://127.0.0.1:8000/docs

## Scope

This is the backend **foundation** only: database models, connection,
automatic table creation, CORS, and the health endpoint. Monitoring,
detection, and rescue planning are not implemented yet.
