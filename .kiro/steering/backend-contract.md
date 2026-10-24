---
inclusion: fileMatch
fileMatchPattern: 'frontend/src/api/**'
---

# Verified Backend Contract

Verified against the live OpenAPI schema on 2026-10-24 (snapshot:
`.kiro/specs/labsentinel-frontend/backend-openapi.snapshot.json`). All paths are
prefixed by the API base URL. Error responses are `{ "detail": string }` with
status `404` (not found), `409` (capacity / in-use conflict), or `422`
(validation / temperature mismatch).

## Equipment

- `GET /api/equipment` → `EquipmentRead[]`
- `POST /api/equipment` (`EquipmentCreate`) → `EquipmentRead` (201)
- `GET /api/equipment/{id}` → `EquipmentRead`
- `PATCH /api/equipment/{id}` (`EquipmentUpdate`) → `EquipmentRead`
- `DELETE /api/equipment/{id}` → 204 (409 if it still holds samples)

`EquipmentRead`:
```
id: number
name: string
type: string
location: string
min_temperature: number
max_temperature: number
storage_capacity: number        // >= 0
sample_limit: number | null     // null = unlimited slots
status: string                  // operational | maintenance | offline | ...
used_storage: number            // derived
available_storage: number       // derived
used_slots: number              // derived
available_slots: number | null  // derived; null when sample_limit is null
```

## Samples

- `GET /api/samples?equipment_id=` → `SampleRead[]`
- `POST /api/samples` (`SampleCreate`) → `SampleRead` (201)
- `GET /api/samples/{id}` → `SampleRead`
- `PATCH /api/samples/{id}` (`SampleUpdate`) → `SampleRead` (re-checks placement)
- `DELETE /api/samples/{id}` → 204

`SampleRead`:
```
id: number
name: string
equipment_id: number
min_temperature: number
max_temperature: number
storage_space: number    // >= 1; also consumes exactly one slot
priority: string         // low | medium | high | critical
```

Placement rule (enforced by backend on create/move): the target equipment's
range must fully cover the sample's `[min_temperature, max_temperature]`, there
must be enough `available_storage`, and a free slot when `sample_limit` is set.

## Simulation & Monitoring

- `POST /api/simulation/start` (`{ interval_seconds?: number }`, 0 < x ≤ 3600,
  default 5) → `SimulationStatus` (idempotent)
- `POST /api/simulation/stop` → `SimulationStatus`
- `GET /api/simulation/status` → `SimulationStatus`
- `POST /api/simulation/equipment/{id}/abnormal` (`{ enabled: boolean }`) →
  `SimulationStatus` (404 if equipment missing)
- `POST /api/simulation/equipment/{id}/fail` (`{ enabled: boolean }`) →
  `SimulationStatus` (sets equipment `offline`, emits extreme readings)
- `GET /api/simulation/equipment/{id}/latest` → `SensorReadingRead` (404 if no
  readings yet)
- `GET /api/simulation/equipment/{id}/history?limit=` (1–1000, default 100) →
  `SensorReadingRead[]` (newest first)

`SimulationStatus`:
```
running: boolean
interval_seconds: number | null
ticks: number
abnormal_equipment_ids: number[]
failed_equipment_ids: number[]
```

`SensorReadingRead`:
```
id: number
equipment_id: number
temperature: number
timestamp: string   // ISO 8601, timezone-aware (UTC)
```

## Not available (do NOT call — these 404)

No AI assessment, rescue planning, incident lifecycle, or alert endpoints
exist. Any such behaviour in the frontend is client-side domain logic and must
be labeled as locally derived.
