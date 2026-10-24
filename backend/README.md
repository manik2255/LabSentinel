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
│   │   ├── sample.py
│   │   ├── sensor_reading.py
│   │   ├── simulation.py
│   │   ├── alert.py
│   │   └── detection.py
│   ├── crud/                # Business logic + capacity/temperature rules
│   │   ├── equipment.py
│   │   ├── sample.py
│   │   ├── sensor_reading.py
│   │   ├── alert.py         # Alert CRUD + active-alert dedupe
│   │   └── exceptions.py    # DomainError hierarchy (mapped to HTTP status)
│   ├── simulation/          # Background temperature simulator (singleton)
│   │   └── simulator.py
│   ├── detection/           # Phase 3 anomaly detection
│   │   ├── features.py      # Feature engineering
│   │   ├── model.py         # Isolation Forest detector (train/score/save/load)
│   │   ├── risk.py          # Explainable low/medium/high/critical risk
│   │   └── service.py       # Assess readings -> risk -> alerts
│   ├── rescue/              # Phase 4 rescue planning
│   │   ├── optimizer.py     # MILP allocation optimiser (pure, read-only)
│   │   ├── service.py       # Load inventory -> optimise -> structured plan
│   │   └── serialize.py     # Dataclass result -> JSON dict
│   └── routers/             # FastAPI route handlers
│       ├── equipment.py
│       ├── sample.py
│       ├── simulation.py
│       ├── detection.py
│       ├── rescue.py
│       └── incident.py      # Phase 5 incidents + audit trail
├── tests/                   # pytest regression suite (isolated DB)
├── pytest.ini
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
- **Alert** — `equipment_id`, `alert_type`, `severity`, `risk_level`,
  `message`, `timestamp`, `resolved`, and `resolved_at`.
- **RescuePlan** — a stored, read-only rescue-plan proposal: `created_at`,
  `feasible`, `partial`, `rescued_count`, `total_count`, `method`, and the full
  structured `plan` (JSON).
- **RescueExecution** — a record of one execution attempt of an approved plan:
  `incident_id`, `plan_id`, `status` (success/failed), `transferred_sample_ids`,
  per-transfer `transfers`, `explanation`, `problems`, and `created_at`.
- **Incident** — a durable case record linked to equipment and (optionally) an
  alert: `trigger`, `risk_severity`, `status`, `summary`, `affected_samples`,
  `evidence`, and lifecycle timestamps. Kept separate from alerts.
- **IncidentEvent** — one audit-trail entry: `event_type`, `explanation`,
  optional `detail`, and `timestamp` (cascades with its incident).

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

Anomaly detection, risk & alerts (Phase 3):

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/detection/equipment/{id}/risk` | Current risk assessment (add `?raise_alert=true` to also create/refresh an alert) |
| GET    | `/api/detection/alerts` | Active (unresolved) alerts (optional `?equipment_id=`) |
| GET    | `/api/detection/alerts/history` | Alert history, newest first (`?limit=` 1–1000) |
| POST   | `/api/detection/alerts/{id}/resolve` | Resolve an active alert |

Sample rescue planning (Phase 4):

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST   | `/api/rescue/plan` | Generate a rescue plan (body optional). Read-only: never moves samples |
| GET    | `/api/rescue/plans` | List stored plans, newest first (`?limit=`) |
| GET    | `/api/rescue/plans/{id}` | Retrieve a stored plan |

Incident management & audit trail (Phase 5):

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/api/incidents` | List incidents (`?equipment_id=`, `?status=`, `?active_only=`, `?limit=`) |
| GET    | `/api/incidents/{id}` | Full incident detail (severity, affected samples, evidence, timestamps) |
| GET    | `/api/incidents/{id}/events` | Audit trail for an incident (oldest first) |
| GET    | `/api/incidents/{id}/report` | Read-only aggregated incident report (works at any stage) |
| POST   | `/api/incidents/{id}/acknowledge` | Acknowledge an open incident (optional `{"note": ...}`) |
| POST   | `/api/incidents/{id}/escalate` | Escalate an open/acknowledged incident |
| POST   | `/api/incidents/{id}/plan` | Generate/regenerate a rescue plan for the incident (read-only) |
| GET    | `/api/incidents/{id}/plan` | Retrieve the incident's associated rescue plan |
| POST   | `/api/incidents/{id}/plan/approve` | Approve the plan after revalidation (`{"acknowledge_unrescued": bool, "note": ...}`) |
| POST   | `/api/incidents/{id}/plan/reject` | Reject the plan; a new one must be generated |
| POST   | `/api/incidents/{id}/plan/execute` | Execute an approved plan (simulated transfer); revalidates then moves samples atomically |
| GET    | `/api/incidents/{id}/plan/execution` | Retrieve the execution result (success or failure) |
| POST   | `/api/incidents/{id}/recovery` | Record the operator-confirmed recovery outcome (`{"outcome": "completed\|partial\|unresolved", "notes": ..., "unrescued_acknowledged": bool}`) |
| POST   | `/api/incidents/{id}/close` | Close the incident after recovery is recorded (`{"confirm": true, "note": ...}`) |

### Incident behaviour

Incidents are durable case records, kept **separate from alerts**. During
detection, a qualifying assessment automatically creates an incident when the
risk is **high/critical** or the equipment is in a **failure** (non-operational)
state. Dedupe guarantees **at most one active incident per equipment**: repeated
qualifying readings refresh the existing incident's evidence (and raise its
severity to critical if warranted) and append an audit event, rather than
creating duplicates.

Each incident links to its equipment and the triggering alert (the link is
preserved even after that alert is resolved), and records the risk severity,
affected samples, a telemetry evidence snapshot, and timestamps.

Lifecycle states implemented so far: `open` -> `acknowledged` -> `escalated`
(open may also go straight to escalated). Invalid transitions return `409`.
Every important change (creation, evidence refresh, acknowledgment, escalation)
is recorded in the audit trail with a timestamp and explanation.

### Incident rescue planning & human approval (Phase 5B)

An incident can generate a rescue plan via the existing MILP optimiser (source
= the incident's equipment; backups = other operational equipment). The plan is
persisted, associated with the incident, and exposed via the incident API with
assignments, unassigned samples, feasibility, optimisation method, and
explanations.

Plan review is tracked on an **orthogonal** `rescue_plan_status` dimension
(`none` -> `planned` -> `approved`/`rejected`) that does **not** change the
incident's lifecycle `status`. Escalation is auditable and never blocks
planning or approval.

Approval rules: only feasible plans qualify for full approval; a partial plan
requires `acknowledge_unrescued=true` (explicit acknowledgment of samples left
behind); an infeasible plan cannot be approved. Before approval the plan is
**revalidated against current inventory** (equipment status, sample locations,
temperature compatibility, storage, slots) - if anything changed, approval is
refused with an explanation and a new plan is required; assignments are never
silently modified. A rejected plan cannot be approved until a new one is
generated. Plan generation, approval, rejection, and revalidation failures are
all recorded in the audit trail.

**Approval never moves samples or modifies inventory.**

### Safe rescue execution (Phase 5C)

Executing an approved plan performs a **simulated transfer**: it updates each
approved sample's `equipment_id` to its destination backup in the database (no
real physical move). Execution is the first operation that mutates inventory
and is written defensively:

- Only the currently-associated, **approved** plan may execute; unapproved,
  rejected, superseded, and already-executed plans are refused (`409`).
- The approved assignments are **revalidated** against live inventory (sample
  locations, equipment status, temperature, storage, slots) first. Optimization
  is never re-run and assignments are never silently changed.
- An atomic **compare-and-set** on the plan status (`approved` -> `executed`)
  claims the execution, so a concurrent request cannot double-execute.
- All sample moves run in **one transaction**; if any move or final check
  fails, every movement is rolled back - inventory is never left partially
  updated - and the plan status is reverted to `approved`.
- **Partial plans**: only the approved (rescued) samples move; unrescued
  samples stay in place.
- Every attempt (success or failure) persists a **RescueExecution** record
  (incident, plan, transferred sample ids, per-transfer source/destination,
  timestamps, result, explanation, problems) and an audit event
  (`execution_succeeded` / `execution_failed`). Failures are durably recorded
  even though the API returns an error.

### Recovery verification & incident closure (Phase 5D)

After a rescue plan has been **executed**, an operator records the real-world
recovery outcome via `POST /api/incidents/{id}/recovery`:

- `outcome` is one of **completed**, **partial**, or **unresolved**. This
  records only what the operator confirmed - a successful *transfer* is never
  assumed to mean a sample is safe or viable.
- `completed` is rejected if the execution left any sample unrescued (use
  `partial` or `unresolved` instead).
- `notes` capture problems/observations; `unrescued_acknowledged` records that
  the operator accepts the samples left behind. Recovery may be re-recorded
  (updated) until the incident is closed.

An incident is then closed via `POST /api/incidents/{id}/close`, which is
terminal (`status` becomes `closed`). Closure is refused unless:

1. a rescue execution has been recorded,
2. a recovery outcome has been recorded (not `pending`),
3. the operator explicitly confirms (`confirm=true`), and
4. any unrescued samples have been acknowledged.

A closed incident accepts no further lifecycle, planning, or recovery actions.
`GET /api/incidents/{id}` exposes backend-authoritative `recovery_recorded` and
`closed` flags, and `recovery_status` / `closed_at` / `recovery_recorded_at`,
so the frontend relies on backend state rather than optimistic UI state. Every
recovery recording and closure is written to the incident audit trail
(`recovery_recorded`, `incident_closed`).

This completes the end-to-end workflow: equipment failure detection -> alert ->
incident -> rescue plan -> approval -> execution -> recovery verification ->
closure.

### Incident report (Phase 5E)

`GET /api/incidents/{id}/report` returns a **read-only** JSON report aggregated
entirely from existing data (the incident row, its rescue plan, the execution
record, and the audit events) - it never writes or modifies anything, and adds
no new tables. It works at **any** incident stage and makes no assumptions: if
no plan has been generated or executed, those sections are `null`/empty rather
than fabricated.

The report includes: the failed equipment, honest sample counts (`affected` /
`rescued` / `unrescued`, where `rescued` counts only samples actually moved by
a successful execution - never inferred from a plan), where samples were
transferred, the optimiser-recorded reasons some samples could not be rescued
(capacity / temperature / status), the rescue-plan status, the execution
outcome, the final recovery outcome (if recorded), and a chronological
`timeline` built from the audit trail.

### Rescue planning behaviour

Identifies samples endangered by failed/unsafe equipment and allocates them to
suitable backup equipment using a **Mixed-Integer Linear Program** (SciPy
`milp`), not a first-fit greedy — so it finds a globally optimal allocation
(e.g. it packs samples to rescue more than a naive largest-first approach
would). A priority-ordered greedy is kept only as a fallback if the solver is
unavailable.

Enforced constraints: backup must be operational, its temperature range must
fully cover the sample's range, a sample is never sent back to its own failing
unit, storage capacity and sample-slot limits are respected. The objective
prefers higher-priority samples and then maximises the number rescued.

The request may name `source_equipment_ids` (else unsafe equipment is
auto-detected) and `backup_equipment_ids` (else all operational equipment).
The response is a structured plan: `assignments`, `remaining_capacity`,
`unassigned` (each with a `reason` and per-candidate `candidate_notes`),
`feasible` / `partial` flags, an `explanation`, and the `constraints` that were
applied (for the frontend to display). Plans are persisted for retrieval.

**Planning is separate from execution:** generating or storing a plan does not
move samples or modify inventory.

### Detection behaviour

An **Isolation Forest** model (scikit-learn) is trained on synthetic realistic
*normal* temperature patterns. Each reading is turned into engineered features
— temperature **deviation** from range centre, **rate of change**, **rolling
mean deviation**, and **rolling variability** — all normalised by the
equipment's half-range so one model generalises across equipment.

The model's anomaly score is combined with deterministic, explainable signals
into one of four risk levels — **low / medium / high / critical**:

- out-of-range reading → at least `high`; far excursions → `critical`;
- equipment not `operational` (e.g. `offline`) → at least `high`;
- a stored sample's own safe range violated → `high`, or `critical` for
  high/critical-priority samples.

Each assessment returns the contributing `reasons` and any `endangered_samples`.

The model is loaded from `anomaly_model.joblib` on startup, or trained and
saved if absent (`ANOMALY_MODEL_PATH` overrides the location). With too few
readings, assessment degrades gracefully to range-only risk flagged
`insufficient_data`.

The simulator runs detection automatically after each new reading. Alerts are
**deduplicated**: at most one active alert per equipment of a given type — an
existing active alert is refreshed in place rather than duplicated. Resolving
an alert sets `resolved_at`; a later excursion can then raise a fresh one.

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

The backend implements the **complete workflow**: equipment & sample
management, temperature simulation & monitoring, Isolation-Forest anomaly
detection with explainable risk and alerting (Phase 3), MILP-based rescue
planning (Phase 4), incident management with a full audit trail (Phase 5),
human rescue-plan approval (Phase 5B), safe simulated rescue execution
(Phase 5C), and operator recovery verification + incident closure (Phase 5D).

Execution performs a *simulated* transfer (it moves samples in the database);
there is no physical hardware actuation, and recovery outcomes reflect only
what the operator confirms - a successful transfer is never assumed to mean a
sample is safe or viable.

## Tests

From `backend/`, with the virtualenv active:

```bash
pytest
```

The suite runs against an isolated temporary database and model file, so the
real `labsentinel.db` is never touched.

## API contract (OpenAPI)

The committed `backend/openapi.json` is the full OpenAPI 3.1 contract for the
frontend team. Regenerate it after any API change:

```bash
python -m scripts.export_openapi
```

Interactive docs are also available at `/docs` when the server runs.

### Frontend-authoritative approval/execution flags

`GET /api/incidents/{id}` includes two read-only, backend-authoritative
booleans the frontend should rely on instead of local UI state:

- `approval_recorded` - true only when the backend has a recorded approval
  (`rescue_plan_status` is `approved`/`executed` with a review timestamp). A
  frontend-only "optimistic" approval leaves this `false`.
- `execution_recorded` - true only when a successful execution is recorded
  (samples actually moved). Execution is refused unless the backend approval
  exists, so a UI-only approval can never trigger a transfer.

## Demo seed / reset (separate database)

A reproducible demo uses a **separate** `demo.db` (never the real
`labsentinel.db`). From `backend/`:

```bash
# reset + seed the demo scenario (healthy + backup freezers, a warm/incompatible
# fridge, and a primary freezer with mixed-priority samples to rescue)
python -m scripts.demo_seed

# wipe the demo database back to empty
python -m scripts.demo_seed --reset

# seed, then run the API against the demo DB on http://127.0.0.1:8000
python -m scripts.demo_seed --serve
```

To run the server manually against the demo database:

```bash
# PowerShell
$env:DATABASE_URL = "sqlite:///./demo.db"
$env:ANOMALY_MODEL_PATH = "./demo_anomaly_model.joblib"
uvicorn app.main:app
```

The seeded demo flow runs the **complete** workflow:

1. `POST /api/simulation/start` `{"interval_seconds": 1}`
2. `POST /api/simulation/equipment/{primary}/fail` `{"enabled": true}` — telemetry
   + anomaly detection raise a critical alert and open an incident
3. `GET /api/incidents` — find the incident id
4. `POST /api/incidents/{id}/plan` — MILP rescue plan
5. `POST /api/incidents/{id}/plan/approve` `{"acknowledge_unrescued": true}`
6. `POST /api/incidents/{id}/plan/execute` — simulated transfer
7. `POST /api/incidents/{id}/recovery` `{"outcome": "partial", "unrescued_acknowledged": true}`
8. `POST /api/incidents/{id}/close` `{"confirm": true}`
9. `GET /api/incidents/{id}/report` — read-only summary of the whole incident

With the seeded capacities the plan is a priority-aware **partial** rescue (the
low-priority sample is left behind), which demonstrates complete, partial, and
incompatible-placement handling in one run. Re-run `python -m scripts.demo_seed`
(or `--reset`) to repeat the demonstration from a clean state — the demo is
fully repeatable and never touches `labsentinel.db`.
