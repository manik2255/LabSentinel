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

## What the backend actually provides (verified via live OpenAPI)

Equipment, Sample, Simulation, and Monitoring only. See
`backend-contract.md` for the exact, verified contract.

The backend has **no** endpoints for:

- AI incident assessment
- Rescue planning / sample reallocation
- Incident lifecycle (acknowledge / resolve / recovery verification)
- Alerts (an `Alert` ORM model exists but has no router)
- WebSocket / SSE streaming (monitoring is polling-only)

## Frontend-derived domain logic (explicitly labeled)

Because those capabilities are not in the backend yet, the frontend implements
them as **clearly labeled client-side domain logic** over the real primitives
the backend does expose (equipment temperature ranges, derived capacity, sample
priority, and sensor-reading history):

- Fault detection — derived from latest readings vs. equipment range + status.
- Explainable assessment — rule-based evidence panels (no black-box ML).
- Rescue planning — a client-side allocator that honours the same temperature
  and capacity rules the backend enforces on `POST/PATCH /api/samples`.
- Incident lifecycle — tracked in client state (and optionally persisted) until
  a backend owns it.

Every such feature must carry a visible "derived locally" indicator so a
reviewer is never misled about where the logic lives. When a real backend
endpoint arrives, the adapter layer is the single place to switch over.

## Engineering standards

- TypeScript strict mode; no `any` in app code without justification.
- All network access goes through the typed API client in `src/api/`.
- Components handle loading, error, empty, and stale-data states explicitly.
- Prefer composition and small reusable components over large monoliths.
- Tests (Vitest + Testing Library) accompany domain logic and key components.
- Accessible by default: semantic HTML, labelled controls, sufficient contrast,
  keyboard operability.
