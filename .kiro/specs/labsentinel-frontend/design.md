# LabSentinel Frontend — Technical Design

## 1. Stack & rationale

- **React 18 + TypeScript (strict) + Vite** — fast dev server, first-class TS,
  matches the CORS origins the backend already allows (`:5173`).
- **TanStack Query** — declarative server-state with caching, polling
  (`refetchInterval`), and built-in loading/error/stale semantics that map
  directly onto Requirement 1/2 acceptance criteria.
- **Recharts** — declarative, accessible-ish SVG charts for telemetry.
- **Vitest + Testing Library + jsdom** — unit/component tests; pure domain
  logic is tested without the DOM.
- No heavy component framework; a small design-token CSS layer keeps the bundle
  lean and the look cohesive and controllable.

## 2. Layering

```
UI (pages, components)
  → hooks (React Query wrappers: useEquipment, useReadingHistory, ...)
    → api client (typed fetch wrapper over the verified contract)
  → domain (pure TS: detection, assessment, rescue planner, lifecycle)
```

- **api/** is the ONLY place that knows URLs and HTTP. It throws a typed
  `ApiError { status, detail }` parsed from `{ detail }`.
- **domain/** is pure and backend-agnostic. It takes plain data (equipment,
  samples, readings) and returns assessments / plans. No fetch, no React.
- A `backendCapabilities` map marks which domain features are backend-backed
  vs. locally derived, so the "derived locally" labels are driven by one source
  of truth. When a real endpoint lands, we flip the flag and add an adapter.

## 3. API client

`src/api/client.ts`

- `apiFetch<T>(path, init)` — prefixes `VITE_API_BASE_URL`
  (default `http://127.0.0.1:8000`), sets JSON headers, parses JSON, and on
  non-2xx throws `ApiError(status, detail)` using the `{ detail }` body.
- 204 responses resolve to `undefined`.
- A 404 from `/latest` is surfaced as a typed `NoReadingsYet` sentinel the
  monitoring hook treats as "awaiting data", per Req 2.6.

`src/api/*.ts` — typed functions per resource mirroring the contract exactly
(`listEquipment`, `createEquipment`, `patchSample`, `getHistory`, `startSim`,
`setAbnormal`, ...). Request/response types live in `src/api/types.ts`,
hand-written from the verified OpenAPI snapshot.

## 4. Domain logic (pure, deterministic, tested)

### 4.1 Detection — `domain/detection.ts`

`classifyEquipment({ equipment, latestReading, now, stalenessMs })` →
`{ health: 'ok'|'warning'|'critical', reasons: Reason[] }`

- `critical` if status is `offline`/failed, or reading outside
  `[min,max]`, or reading stale.
- `warning` if within range but within a margin (configurable fraction of
  span, default 10%) of a bound.
- `ok` otherwise.
- Pure function of inputs; `now` injected for testability (Req 3.5).

### 4.2 Assessment — `domain/assessment.ts`

`assessIncident({ equipment, latestReading, history, now })` → `Assessment`
with `severity`, `cause`, `evidence: EvidenceItem[]`, `confidence`. Evidence
items carry raw numbers and a formatted human string so the UI renders exact,
traceable values (Req 3.3). Insufficient data lowers confidence and states so
explicitly (Req 3.4). Marked `source: 'derived'`.

### 4.3 Rescue planner — `domain/rescue.ts`

`planRescue({ source, samples, candidates })` → `RescuePlan`:

- Candidate filter: exclude the source and any offline/failed equipment
  (Req 5.3); keep only temperature-compatible destinations
  (`dest.min <= sample.min && dest.max >= sample.max`), mirroring the backend's
  `_check_placement`.
- Order samples by priority (critical→high→medium→low), then by storage desc.
- Greedy allocation with a **mutable capacity ledger** per destination so the
  plan never exceeds real remaining storage/slots cumulatively (Req 4.6).
- Score feasible destinations: tighter range fit first, then more free storage;
  pick the best.
- Unplaceable samples are returned with a reason (Req 4.3); partial plans are
  first-class (Req 4.4).
- Pure and fully unit-tested, including no-feasible and partial cases.

### 4.4 Incident lifecycle — `domain/incident.ts`

A pure reducer `incidentReducer(state, action)` over states
`DETECTED → ACKNOWLEDGED → EXECUTING → EXECUTED → (RESOLVED | OPEN)`.
Illegal transitions throw (Req 6.5). Recovery verification
`verifyRecovery(incident, equipmentById, samples)` returns passing/failing
checks (Req 7.1–7.2). Lifecycle is held in a React context store; execution
side-effects (sample PATCHes) live in a hook, not the reducer.

## 5. Hooks

- `useEquipmentList()` — polled list.
- `useLatestReading(id)` — polled, maps 404→awaiting.
- `useReadingHistory(id, limit)` — polled.
- `useSimulationStatus()` / mutations for start/stop/abnormal/fail.
- `useSampleMutations()` — create/patch/delete with optimistic-safe
  invalidation.
- `useIncidents()` — lifecycle store + execution.

Polling default: 4 s for status/latest (below the simulator's 5 s tick is
fine; React Query dedupes). Intervals are centralized in `config.ts`.

## 6. Pages / IA

- **Overview** (`/`) — equipment grid, lab health summary, seed/reset bar.
- **Equipment detail / Telemetry** (`/equipment/:id`) — live chart + range
  band, simulator & fault controls, assessment panel.
- **Incidents** (`/incidents`) — active incidents, rescue planner, execution,
  recovery, and history timeline.

Shared layout: left nav, header with backend-connection indicator and global
simulator status.

## 7. State & error model

- Server state: React Query. Client state (incidents, UI): React context +
  `useReducer`.
- Every data surface renders one of: loading skeleton, error-with-retry, empty,
  stale banner, or data. A small `<AsyncBoundary>` + `<QueryState>` helper
  standardizes this so no screen forgets a state (Req 1.5–1.7, 2.5–2.6).
- Capacity display is clamped to ≥0 and anomalies flagged (Req 5.2).

## 8. Design tokens & accessibility

- `styles/tokens.css` — color scale (slate/graphite surfaces, semantic
  ok/warn/critical with AA contrast on dark), spacing scale, radii, typography
  scale, elevation. Severity always pairs color with an icon + text label (no
  color-only encoding).
- Focus-visible outlines, labelled controls, `aria-live` on the connection and
  incident banners, keyboard-operable toggles and dialogs.

## 9. Testing strategy

- **Domain unit tests** (highest value): detection thresholds, assessment
  evidence/confidence, rescue planner (happy, partial, infeasible, cumulative
  capacity, priority ordering), lifecycle legal/illegal transitions, recovery
  verification.
- **Component tests**: equipment card states (ok/warn/critical/stale/error),
  async boundary states, rescue plan rendering (placed/unplaceable), telemetry
  empty state.
- **API client tests**: error parsing (`detail`), 204, 404→sentinel.
- Build + `tsc --noEmit` + `vitest run` are the quality gate.

## 10. Config

- `VITE_API_BASE_URL` (default `http://127.0.0.1:8000`).
- Staleness window, warning margin, poll intervals, and seed dataset all live in
  `src/config.ts` so behaviour is tunable and tests pin exact values.
