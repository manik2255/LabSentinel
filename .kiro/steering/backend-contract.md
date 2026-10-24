---
inclusion: fileMatch
fileMatchPattern: 'frontend/src/api/**'
---

# Backend Contract (verified 2026-10-24 against backend/openapi.json, 32 paths)

Errors are `{ "detail": string }` (404 not found, 409 conflict/state, 422
validation). Timestamps are naive ISO strings recorded in UTC (SQLite drops the
offset); the frontend normalizes them in `src/api/endpoints.ts`.

## Inventory
- `GET/POST /api/equipment`, `GET/PATCH/DELETE /api/equipment/{id}`
- `GET/POST /api/samples` (`?equipment_id=`), `GET/PATCH/DELETE /api/samples/{id}`
- Placement rule: destination range covers the sample range; enough free storage;
  a free slot when `sample_limit` is set.

## Simulation and telemetry
- `POST /api/simulation/start|stop`, `GET /api/simulation/status`
- `POST /api/simulation/equipment/{id}/abnormal|fail` (`{ enabled }`)
- `GET /api/simulation/equipment/{id}/latest|history`
- Each simulator tick runs detection and may create or refresh an incident.
- Clearing the failure flag does not restore `status`; PATCH it to `operational`.

## Detection (used by the UI)
- `GET /api/detection/equipment/{id}/risk` → `risk_level` (low/medium/high/critical),
  `anomaly_score` (0–1 logistic mapping of Isolation Forest output; not a
  probability), `reasons[]`, `endangered_samples[]`, `reading_count` (window 10),
  `insufficient_data` (< 3 readings). Read-only unless `raise_alert=true`.
- Alerts: `GET /api/detection/alerts`, `/alerts/history`, `POST /alerts/{id}/resolve`
  (not used by the UI).

## Incidents (used by the UI)
- `GET /api/incidents`, `GET /api/incidents/{id}`, `GET /api/incidents/{id}/events`
- `POST /acknowledge` (open → acknowledged), `POST /escalate` (not in UI)
- `POST /plan` (MILP, read-only), `GET /plan`, `POST /plan/approve`
  (`acknowledge_unrescued` required for partial plans; refused if stale or
  infeasible), `POST /plan/reject`
- `POST /plan/execute` (approved plans only; atomic; concurrent duplicates get 409),
  `GET /plan/execution`
- `POST /recovery` (`outcome`: completed/partial/unresolved; `completed` refused
  when samples were left unrescued; requires a recorded execution)
- `POST /close` (`confirm: true`; requires recovery; unrescued samples must be acknowledged)
- `GET /api/incidents/{id}/report` — read-only aggregated report (not used by the UI)
- Flags on `IncidentDetail`: `approval_recorded`, `execution_recorded`,
  `recovery_recorded`, `closed` — the UI derives every step from these.
- One active incident per equipment. After closure, a still-abnormal unit gets a
  new incident on its next reading.
