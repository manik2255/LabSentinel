# LabSentinel — Project Steering

LabSentinel is an AI-assisted laboratory equipment monitoring and emergency
sample-rescue planning system, built for Hackachusetts 2026.

## Architecture

- `backend/` — FastAPI + SQLAlchemy + SQLite. **Backend-owned. Do not modify
  without explicit coordination.**
- `frontend/` — React + TypeScript + Vite single-page app. This is the active
  area of frontend work.

## Hard boundaries

- Never edit files under `backend/` as part of frontend tasks.
- Never change a shared API contract unilaterally.
- Never push commits, merge branches, or run destructive git commands without
  explicit approval.
- The backend runs on `http://127.0.0.1:8000` by default. During local
  verification it may be run on another port; the frontend reads the base URL
  from `VITE_API_BASE_URL` (default `http://127.0.0.1:8000`).

## What the backend provides (verified 2026-10-24, backend/openapi.json)

Inventory, simulation, Isolation Forest risk detection, alerts, MILP rescue
planning, and persistent incidents with approval, atomic execution, recovery,
closure, and an audit trail. See `backend-contract.md`. There is no
authentication and no WebSocket/SSE (polling only).

## Frontend modes

The frontend reads `/openapi.json` (`getCapabilities`) and:

- **Backend mode**: shows backend risk, incidents, plans, and actions. All
  incident state comes from backend responses. Browser-side incident detection
  is off, so there are no duplicate incidents.
- **Fallback mode** (no incident API): browser rule-based assessment, greedy
  planner, and localStorage incidents, each labeled "derived locally".

Rules: never show an action as done before the backend confirms it; label the
anomaly score as a relative outlier score, not a probability; recovery is an
operational confirmation, not sample viability; approve/execute only plans
whose source and destinations are demo units (`src/domain/demoScope.ts`).

## Engineering standards

- TypeScript strict mode; no `any` in app code without justification.
- All network access goes through the typed API client in `src/api/`.
- Components handle loading, error, empty, and stale-data states explicitly.
- Prefer composition and small reusable components over large monoliths.
- Tests (Vitest + Testing Library) accompany domain logic and key components.
- Accessible by default: semantic HTML, labelled controls, sufficient contrast,
  keyboard operability.
