# LabSentinel Backend

Backend foundation for the LabSentinel laboratory equipment monitoring and
emergency sample rescue planning system.

Built with **Python**, **FastAPI**, **SQLite**, and **SQLAlchemy**.

## Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, CORS, startup table creation, routers, /api/health
│   ├── database.py          # Engine, session factory, declarative Base, get_db
│   ├── models/              # SQLAlchemy ORM models
│   │   ├── __init__.py      # Registers all models on the shared Base
│   │   ├── equipment.py     # Equipment model (+ derived capacity properties)
│   │   ├── sample.py        # Sample model
│   │   ├── sensor_reading.py# SensorReading model
│   │   └── alert.py         # Alert model
│   ├── schemas/             # Pydantic request/response models
│   │   ├── equipment.py
│   │   └── sample.py
│   ├── crud/                # Business logic + capacity/temperature rules
│   │   ├── equipment.py
│   │   ├── sample.py
│   │   └── exceptions.py    # DomainError hierarchy (mapped to HTTP status)
│   └── routers/             # FastAPI route handlers
│       ├── equipment.py
│       └── sample.py
├── requirements.txt
└── README.md
```

## Data model

- **Equipment** — name, type, location, temperature range (`min_temperature`,
  `max_temperature`), `storage_capacity` (total storage space), optional
  `sample_limit` (max number of samples; `null` = unlimited), and `status`.
  Derived (read-only) fields: `used_storage`, `available_storage`,
  `used_slots`, `available_slots`.
- **Sample** — assigned equipment (`equipment_id`), required temperature range
  (`min_temperature`, `max_temperature`), `storage_space` (each sample also
  takes one slot), and `priority`.
- **SensorReading** — `equipment_id`, `temperature`, and `timestamp`.
- **Alert** — `equipment_id`, `severity`, `message`, `timestamp`, and
  `resolved` status.

Relationships: one `Equipment` has many `Sample`, `SensorReading`, and `Alert`
records (each child cascades on delete).

## API

Equipment:

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/equipment` | List all equipment |
| POST   | `/api/equipment` | Create equipment |
| GET    | `/api/equipment/{id}` | Get one (includes derived capacity) |
| PATCH  | `/api/equipment/{id}` | Partial update |
| DELETE | `/api/equipment/{id}` | Delete (only if it holds no samples) |

Samples:

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/samples` | List samples (optional `?equipment_id=`) |
| POST   | `/api/samples` | Create sample |
| GET    | `/api/samples/{id}` | Get one |
| PATCH  | `/api/samples/{id}` | Update / move (re-checks capacity + temperature) |
| DELETE | `/api/samples/{id}` | Delete |

Temperature simulation & monitoring:

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST   | `/api/simulation/start` | Start the simulator (body `{"interval_seconds": 5}`). Idempotent — never starts a duplicate loop |
| POST   | `/api/simulation/stop` | Stop the simulator (safe when already stopped) |
| GET    | `/api/simulation/status` | Running state, interval, tick count, active fault flags |
| POST   | `/api/simulation/equipment/{id}/abnormal` | Toggle out-of-range readings (body `{"enabled": true}`) |
| POST   | `/api/simulation/equipment/{id}/fail` | Toggle a simulated hardware failure (marks equipment `offline`, emits extreme readings) |
| GET    | `/api/simulation/equipment/{id}/latest` | Most recent reading for an equipment |
| GET    | `/api/simulation/equipment/{id}/history` | Recent readings, newest first (`?limit=` 1–1000, default 100) |

### Simulation behaviour

A single background daemon thread (a process-wide singleton) writes one
`SensorReading` per equipment on each tick:

- **normal** — a value near the middle of the equipment's range with small
  drift, clamped to stay inside `[min_temperature, max_temperature]`.
- **abnormal** — a value pushed above `max_temperature` or below
  `min_temperature` to mimic a dangerous excursion.
- **failed** — an extreme, clearly-broken value; the equipment is set to
  `offline`.

Starting twice does not spawn a second loop. The simulator is stopped
automatically on application shutdown.

### Business rules

- Available capacity (storage and slots) is computed automatically from the
  samples currently assigned.
- Creating or moving a sample requires the target equipment to have enough
  free storage, a free slot (when `sample_limit` is set), and a temperature
  range that fully covers the sample's required range.
- `storage_capacity` cannot be reduced below storage already in use, and
  `sample_limit` cannot be set below the current sample count.
- Equipment that still contains samples cannot be deleted.

Error responses use `{"detail": "..."}`: `404` not found, `409` capacity /
in-use conflicts, `422` invalid input (Pydantic) or temperature mismatch.

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
