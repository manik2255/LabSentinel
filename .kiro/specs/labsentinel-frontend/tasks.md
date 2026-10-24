# LabSentinel Frontend — Implementation Tasks

- [x] 1. Scaffold the Vite + React + TypeScript project and tooling
  - Created `frontend/` with Vite React-TS, strict tsconfig, Vitest, Testing
    Library, jsdom, and npm scripts (dev/build/test/typecheck).
  - _Requirements: NFRs, 8_

- [x] 2. API layer: typed client and resource functions
  - `src/api/types.ts`, `src/api/client.ts` (ApiError, 204, 404 sentinel),
    `src/api/endpoints.ts`. Unit-tested error parsing, 204, 404→sentinel.
  - _Requirements: 1.1, 2.1-2.3, 6.2-6.3_

- [x] 3. Config and design tokens
  - `src/config.ts` and `src/styles/tokens.css` + `global.css`.
  - _Requirements: 1.4, 1.7, NFR accessibility_

- [x] 4. Domain: detection + assessment (pure, tested)
  - `domain/detection.ts`, `domain/assessment.ts`; 17 unit tests.
  - _Requirements: 1.3, 1.7, 3.1-3.5_

- [x] 5. Domain: rescue planner (pure, tested)
  - `domain/rescue.ts` with cumulative capacity ledger, priority ordering,
    scoring, partial + infeasible handling; 10 unit tests.
  - _Requirements: 4.1-4.7, 5.1-5.3_

- [x] 6. Domain: incident lifecycle + recovery (pure, tested)
  - `domain/incident.ts` reducer + recovery; 9 unit tests.
  - _Requirements: 6.1, 6.4-6.5, 7.1-7.3_

- [x] 7. Query hooks and app shell
  - React Query provider, hooks, router, layout with connection + simulator
    indicators, AsyncBoundary (`QueryBoundary`).
  - _Requirements: 1.4, 1.5, 2.4, 2.6_

- [x] 8. Overview page + equipment cards
  - Equipment grid, health classification, capacity bars, lab health summary,
    loading/error/empty/stale states. Component tests for CapacityBar.
  - _Requirements: 1.1-1.7, 5.2_

- [x] 9. Telemetry / equipment detail page
  - History chart with range band, simulator + fault toggles (guarded),
    assessment panel, awaiting-data + empty states.
  - _Requirements: 2.1-2.7, 3.1-3.5_

- [x] 10. Incidents page: detection surfacing, rescue planner UI, execution
  - Lab-wide headless detectors, rescue plan visualization, acknowledge +
    execute (real PATCH moves), recovery verification, duplicate-execution
    guard, history timeline. Component tests for RescuePlanView.
  - _Requirements: 4.5, 6.1-6.5, 7.1-7.3_

- [x] 11. Demo seed & reset workflow
  - Idempotent seed + reset via real endpoints; reports actions taken.
  - _Requirements: 8.1-8.3_

- [x] 12. Final quality gate
  - `tsc --noEmit` clean, `vitest run` 50/50 passing, `vite build` succeeds,
    dev server boots and serves, and `scripts/verify-e2e.mjs` passes 18/18
    against the live backend (full seed→fail→rescue→recover→reset workflow).
  - _Requirements: all; NFRs_

## Verification record (2026-10-24)

Commands run from `frontend/` unless noted:
- `npm install` — 218 packages installed.
- `npx tsc --noEmit` — exit 0, no type errors (strict mode).
- `npm test` — 7 files, 50 tests passed.
- `npm run build` — built in ~2.2s; bundle 658 kB (189 kB gzip). Recharts is
  the dominant dependency; acceptable for the demo, could be code-split later.
- `npm run dev` — Vite serves on :5173; `/` and `/src/main.tsx` return 200 and
  the entry transforms (createRoot present).
- `node scripts/verify-e2e.mjs` (backend on :8077) — 18/18 checks passed,
  including backend enforcement of 422 (temperature) and 409 (capacity) that
  the client planner mirrors.

NOT VERIFIED (no tooling available in this environment):
- Cross-browser rendering and real screen-reader passes (manual testing
  required for full WCAG validation).

## Pass 2 — Independent audit, correctness, UI & browser verification (2026-10-24)

Added tasks (all complete):

- [x] 13. Independent implementation audit — traced backend→display, reading→incident, inventory→plan, plan→execution, ack→recovery, and demo reset. Found and fixed real defects (see below).
- [x] 14. Correctness & safety boundaries — relabeled assessment "Confidence" as "Evidence strength" with a "not a calibrated probability" disclaimer; added a deliberate confirmation dialog before rescue execution, labeled "simulated execution" / "simulated rescue against the demo backend"; the rescue plan is tagged "greedy heuristic" (not optimal, not backend-verified).
- [x] 15. Rescue-planner correctness — added a seeded property-based harness (`src/domain/rescue.property.test.ts`) with an exhaustive reference optimum. Soundness held across 300 random seeds (every allocation legal: non-source, non-offline, temperature-covered, unique, within cumulative storage/slots; allocations+unplaceable exactly partition the input). Greedy never exceeded the optimum; a hand-crafted priority-vs-capacity case documents a genuine heuristic shortfall (greedy places weight 4 where optimal places 5). The planner is a greedy heuristic, NOT provably globally optimal.
- [x] 16. Incident lifecycle fixes — reopen now transitions executed→acknowledged (was a dead-end to "executing"); added a `recordRecovery` action that persists a failed verification without a state change; "Verify recovery" stays available after a failed-recovery reopen so an incident with an empty re-plan is never stranded.
- [x] 17. Professional UI pass — telemetry chart gained axis titles ("Temperature (°C)", "Time"), a caption describing the allowed-range band and reading count, and an active-dot for the latest point; rescue plan gained a one-line required-action summary.
- [x] 18. Real browser E2E (Playwright/Chromium) — `e2e/demo-journey.spec.ts` drives the full journey in a real browser (overview → clear → seed → inject hardware failure → incident detected → acknowledge → execute with confirmation → execution result → verify recovery → reset) plus a mobile-viewport render. Screenshots captured under `e2e/artifacts/`.
- [x] 19. Reproducible demo — added a full-baseline "Clear all" control (deletes samples then equipment, restores offline units, clears faults/sim/local incidents) so the demo replays from empty.

Confirmed defects found & fixed in Pass 2:
1. Incident reopen dead-end: a failed recovery left the incident unactionable (no enabled button). Fixed via executed→acknowledged reopen + Verify available in that reopened state. Regression test: `src/components/IncidentCard.deadend.test.tsx`.
2. Demo not reproducible from reset: "Reset" never cleared equipment/samples, so the idempotent seed skipped and left stale data. Fixed with "Clear all".
3. Vitest collected the Playwright e2e spec after e2e was added: scoped Vitest `include` to `src/**` and `exclude` e2e.
4. Confidence metric presented like a calibrated probability: relabeled + disclaimer.
5. Rescue execution had no deliberate confirmation: added a demo-labeled alertdialog with focus-on-open.

Reviewed and found SOUND (no change needed), per independent behavioral review:
- Rescue execution never fabricates a backend success; 409/422 `detail` surfaces verbatim; `allSucceeded` requires every move ok.
- Duplicate-execution guard (`useRef` inflight in the hook) holds across the confirm dialog.
- API resilience: network failures normalize to `ApiError` and propagate; no fabricated-data fallback; polling is React Query `refetchInterval` only (no manual-timer leaks).

Known residual (documented, low impact): an incident keeps the assessment snapshot from first detection (dedup by equipment id), so displayed severity can lag a worsening excursion while the incident is open. Acceptable for the demo; a future refresh-on-existing-incident path is noted.

## Pass 2 verification record (2026-10-24)

Commands run from `frontend/`:
- `npx tsc --noEmit` — exit 0.
- `npm test` (Vitest) — 10 files, 61 tests passed (e2e excluded).
- `npm run build` — succeeds (~2-3s; ~660 kB bundle, Recharts-dominated).
- `npx playwright test` — 2/2 browser tests passed (full demo journey + mobile), real Chromium, both servers auto-booted; screenshots in `e2e/artifacts/`.
- `node scripts/verify-e2e.mjs` (prior pass) — 18/18 live-backend API checks.

NOT VERIFIED:
- Full WCAG conformance (needs manual AT testing); the confirm dialog has focus-on-open but not a full focus-trap.
- Cross-browser beyond Chromium (only Chromium installed).
