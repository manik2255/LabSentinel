# LabSentinel Frontend

Operator console for LabSentinel: laboratory cold-storage monitoring and
emergency sample rescue. React 18 + TypeScript (strict) + Vite + TanStack Query
+ Recharts.

## What is real and what is simulated

The console reads the backend's `/openapi.json` at startup and picks a mode.

**Backend mode** (current backend):

| Capability | Source |
| --- | --- |
| Equipment, samples, capacity | Backend API |
| Temperature telemetry, fault injection | Backend **simulator** (no physical sensors) |
| ML risk on the telemetry page | `GET /api/detection/equipment/{id}/risk` (Isolation Forest + rules, read-only) |
| Incidents, evidence, audit trail | `/api/incidents…` (persistent, opened by backend detection) |
| Rescue plan | `POST /api/incidents/{id}/plan` (backend MILP optimizer) |
| Approval, execution, recovery, closure | Backend endpoints; execution is one atomic transaction |

Browser-side incident detection is switched off in this mode, so there is never
a duplicate browser incident. The rule-based check stays on the telemetry page,
labeled as computed in the browser. Approval and execution are disabled when a
backend plan would move samples into equipment outside the demo lab.

**Fallback mode** (backend without incident API): rule-based assessment, a
greedy browser rescue planner, and incidents stored in this browser's
localStorage, all labeled as browser-derived.

## Pages

- **Overview** — lab status banner, live counts, equipment cards with
  freshness, capacity, and the main reason for any warning.
- **Equipment telemetry** — time-scaled chart with the allowed range, marked
  excursions, breaks across missing data, fault injection, and the
  assessment (observed / derived / not known / recommended decision).
- **Incident response** — step tracker with the next action and who acts,
  rescue proposal (who is at risk, where each sample goes and why it is valid,
  capacity before and after, what cannot be placed), confirmed execution,
  recovery verification, and incident history with an audit trail.

## Demo safety

The backend has no ownership or authorization model, so the console only
modifies records it created: equipment named like the seed set **and** located
in `Demo Lab - …`, plus seed-named samples inside them (`src/domain/demoScope.ts`).

- **Set up demo** creates the demo lab if missing and starts the simulator.
- **Reset demo** clears demo fault flags, returns demo samples to their seeded
  storage, restores demo units to `operational`. It deletes nothing.
- **Remove demo data…** deletes demo records only, after a confirmation that
  states exactly what is deleted and what is untouched.
- Fault injection and rescue execution are disabled for non-demo equipment;
  plans for other equipment are shown as advisory only.

This prevents accidental changes to other inventory. It is not a security
control; real deployments need backend authorization.

## Run

```bash
npm install
cp .env.example .env    # VITE_API_BASE_URL, default http://127.0.0.1:8000
npm run dev             # http://127.0.0.1:5173
```

Start the backend first (`../backend/README.md`). Open the console and click
**Set up demo**.

## Test

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript strict |
| `npm test` | Vitest unit and component tests (`src/**`) |
| `npm run build` | Typecheck + production build |
| `npm run e2e` | Playwright (Chromium) against its own backend on port 8078 with a fresh, disposable SQLite database; frontend on port 3000 |
| `node ../scripts/verify-e2e.mjs` | HTTP workflow against its own backend on port 8079 with a disposable database |

First-time Playwright setup: `npx playwright install chromium`. Both browser
and integration checks require Python with `backend/requirements.txt`
installed. Neither touches `backend/labsentinel.db`.

## Configuration

`src/config.ts`: API base URL, staleness window (20 s), warning margin, poll
intervals, telemetry gap threshold, demo seed dataset, and the demo marker.
