# LabSentinel Frontend — Requirements

## Introduction

LabSentinel monitors laboratory cold-storage equipment (freezers, fridges,
incubators), detects dangerous temperature excursions and hardware failures,
and helps a lab operator rescue at-risk samples by reallocating them to
compatible equipment before they are lost. The frontend is the operator's
console: it must make the state of the lab obvious at a glance, surface
incidents with trustworthy evidence, and guide a fast, confident response.

The backend (FastAPI) exposes equipment, samples, a temperature simulator with
fault injection, and sensor-reading monitoring (polling). It does **not** yet
provide AI assessment, rescue planning, or incident-lifecycle endpoints; the
frontend implements those as clearly-labeled client-side domain logic over the
real primitives, behind an adapter so a future backend can take over.

Terminology: "excursion" = a reading outside an equipment's allowed range;
"stale" = no fresh reading within the staleness window; "incident" = a detected
fault (excursion, failure, or staleness) tracked through a response lifecycle.

---

## Requirement 1 — Laboratory overview & equipment monitoring

**User story:** As a lab operator, I want a live overview of all equipment and
its health, so that I can see the state of the lab at a glance.

### Acceptance criteria

1. WHEN the overview loads THEN the system SHALL fetch all equipment via
   `GET /api/equipment` and render one status card per equipment.
2. WHEN each equipment is rendered THEN the system SHALL show its name, type,
   location, allowed temperature range, current status, and capacity usage
   (storage and slots) from the backend's derived fields.
3. WHEN a latest reading exists THEN the card SHALL show the current
   temperature and classify health as OK, WARNING (approaching a bound), or
   CRITICAL (outside range / failed / stale).
4. WHILE the overview is open THE system SHALL poll latest readings on a fixed
   interval and update cards without a full reload.
5. IF a request fails THEN the system SHALL show an actionable error with a
   retry affordance and SHALL NOT blank out previously loaded data.
6. IF there is no equipment THEN the system SHALL show an empty state that
   explains how to seed the demo.
7. IF a reading is older than the staleness window THEN the card SHALL mark the
   value stale and SHALL NOT present stale data as current.

## Requirement 2 — Interactive telemetry & fault simulation

**User story:** As a demo presenter, I want to drive the simulator and watch
telemetry respond, so that I can show detection working end to end.

### Acceptance criteria

1. WHEN the telemetry view opens for an equipment THEN the system SHALL load
   reading history via `GET /api/simulation/equipment/{id}/history` and plot a
   time-series with the allowed range band overlaid.
2. WHEN the user starts/stops the simulator THEN the system SHALL call
   `POST /api/simulation/start|stop` and reflect the returned status.
3. WHEN the user toggles an abnormal or failure condition THEN the system SHALL
   call the matching endpoint and reflect that the equipment is now flagged.
4. WHILE the simulator runs THE chart and cards SHALL update on each poll.
5. IF history is empty THEN the chart area SHALL show an empty state, not a
   broken axis.
6. IF the latest-reading endpoint returns 404 (no readings yet) THEN the UI
   SHALL treat it as "awaiting data", not as an error.
7. WHEN the user toggles rapidly THEN the system SHALL debounce/guard so it does
   not issue conflicting overlapping requests or desync the toggle state.

## Requirement 3 — Explainable incident assessment

**User story:** As an operator, I want each incident explained with evidence,
so that I trust the system before acting.

### Acceptance criteria

1. WHEN an incident is detected THEN the system SHALL produce an assessment with
   a severity, a plain-language cause, and the concrete evidence used (the
   reading, the breached bound, the equipment status, staleness).
2. WHERE assessment is shown THE system SHALL label it as derived locally, not
   as a backend AI verdict.
3. WHEN evidence is listed THEN each item SHALL be traceable to a real value
   (e.g. "−12.4 °C exceeds max −20 °C by 7.6 °C at 14:02").
4. IF data is insufficient (no readings, stale only) THEN the assessment SHALL
   state that explicitly and lower its confidence rather than inventing a cause.
5. The assessment SHALL be deterministic: the same inputs always produce the
   same output.

## Requirement 4 — Intelligent rescue-plan visualization

**User story:** As an operator facing a failing freezer, I want a rescue plan
that moves at-risk samples to compatible equipment, so that I can act fast.

### Acceptance criteria

1. WHEN the user requests a rescue plan for a failing/at-risk equipment THEN the
   system SHALL compute, per sample, a recommended destination that satisfies
   the backend's real placement rules (destination range fully covers the
   sample range; enough available storage; a free slot if slot-limited).
2. WHEN ranking destinations THEN the planner SHALL prefer tighter-fitting
   compatible ranges and more free capacity, and SHALL process higher-priority
   samples first (critical → high → medium → low).
3. WHERE no feasible destination exists for a sample THE plan SHALL mark it
   UNPLACEABLE with the reason, rather than silently dropping it.
4. WHEN capacity is partially sufficient THEN the plan SHALL produce a partial
   allocation and clearly report which samples were placed and which were not.
5. WHEN the plan is shown THEN the system SHALL visualize source → destination
   allocations with the capacity impact on each destination.
6. The planner SHALL NOT exceed any destination's capacity across the whole
   plan (allocations are cumulative, not evaluated in isolation).
7. The plan SHALL be presented as a proposal; nothing is moved until the user
   executes it (see Requirement 6).

## Requirement 5 — Backup-storage compatibility & capacity

**User story:** As an operator, I want to see which equipment can serve as
backup storage and how much room it has, so that rescue decisions are grounded.

### Acceptance criteria

1. WHEN viewing candidates THE system SHALL compute temperature compatibility
   and remaining capacity for each candidate equipment.
2. IF capacity data looks inconsistent (e.g. used > capacity from a race) THEN
   the UI SHALL clamp display to non-negative and flag the anomaly rather than
   render negative capacity.
3. Offline/failed equipment SHALL be excluded as rescue destinations.

## Requirement 6 — Incident acknowledgment & responder actions

**User story:** As a responder, I want to acknowledge an incident and execute
the rescue plan, so that the response is tracked and real moves happen.

### Acceptance criteria

1. WHEN a responder acknowledges an incident THEN the system SHALL record the
   acknowledgment (who/when) and move the incident to ACKNOWLEDGED.
2. WHEN a responder executes a rescue plan THEN the system SHALL move each
   placed sample via `PATCH /api/samples/{id}` to its destination equipment.
3. IF a move is rejected by the backend (409/422) THEN the system SHALL surface
   the backend's `detail`, keep the rest of the plan consistent, and not claim a
   failed move succeeded.
4. WHEN the same incident is acted on twice quickly THEN the system SHALL guard
   against duplicate execution.
5. Invalid lifecycle transitions (e.g. resolving an un-acknowledged incident)
   SHALL be rejected.

## Requirement 7 — Recovery verification & incident history

**User story:** As an operator, I want to confirm recovery and review past
incidents, so that I can close the loop and learn.

### Acceptance criteria

1. WHEN a rescue has executed THEN the system SHALL verify recovery by checking
   that at-risk samples now sit in compatible, in-range equipment.
2. IF recovery verification fails THEN the incident SHALL remain open with the
   failing checks listed, not be auto-closed.
3. WHEN an incident is resolved THEN it SHALL appear in an incident history with
   its timeline (detected → acknowledged → executed → resolved).

## Requirement 8 — Reliable demonstration & reset workflow

**User story:** As a presenter, I want one-click seed and reset, so that the
demo is repeatable.

### Acceptance criteria

1. WHEN the user seeds the demo THEN the system SHALL create a known set of
   equipment and samples via the real endpoints if none exist.
2. WHEN the user resets THEN the system SHALL stop the simulator, clear local
   incident state, and clear injected faults, returning to a known baseline.
3. The seed/reset SHALL be idempotent and SHALL report exactly what it did.

## Non-functional requirements

- Accessibility: keyboard operable, labelled controls, WCAG-AA-oriented
  contrast, no color-only severity encoding.
- Resilience: no uncaught promise rejections; every async path has loading,
  error, empty, and stale handling.
- Determinism: domain logic (assessment, planner) is pure and unit-tested.
- Performance: polling intervals are bounded; charts handle up to 1000 points.
