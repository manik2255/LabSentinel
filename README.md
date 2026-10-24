# LabSentinel

Laboratory cold-storage monitoring and emergency sample rescue. When a freezer
fails, LabSentinel detects the anomaly, explains the evidence, proposes where
each at-risk sample can go, and walks a responder through approval, transfer,
recovery, and an auditable incident record.

Built for Hackachusetts 2026 with Kiro.

## What is real and what is simulated

| Capability | Where it runs | Status |
| --- | --- | --- |
| Equipment, samples, capacity, placement rules | Backend (FastAPI + SQLite) | Real API |
| Temperature telemetry and faults | Backend simulator | **Simulated** (no physical sensors) |
| Anomaly detection and risk | Backend: Isolation Forest score + range, status, and sample rules | Real, shown in the UI |
| Incidents and audit trail | Backend, persistent | Real, shown in the UI |
| Rescue plan | Backend mixed-integer linear program (SciPy MILP); greedy fallback if the solver is unavailable | Real, shown in the UI |
| Approval, execution, recovery, closure | Backend; execution moves samples in one transaction | Real, shown in the UI. Transfers are simulated moves of database records |
| Responder identity | None (no authentication) | Not implemented |

The anomaly score is a relative outlier score (0 = typical, 1 = highly unusual),
not a probability of failure. Recovery records the operator's confirmation of
sample locations; it does not assert sample viability.

The frontend reads the backend's live OpenAPI document. If the incident API is
absent (older backend), it falls back to a labeled browser-only workflow.

## Run the demo (isolated database)

Use a dedicated demo database so the demo never touches other data:

```bash
# Backend (from backend/)
pip install -r requirements.txt
DATABASE_URL=sqlite:///./labsentinel-demo.db uvicorn app.main:app --port 8000
#   PowerShell: $env:DATABASE_URL="sqlite:///./labsentinel-demo.db"; uvicorn app.main:app --port 8000

# Frontend (from frontend/)
npm install
npm run dev        # http://127.0.0.1:5173 (VITE_API_BASE_URL defaults to :8000)
```

In the console: **Set up demo** → open *Ultra-Low Freezer A* → switch on
**Hardware failure** → **Incidents** → Acknowledge → Generate rescue plan →
Approve → Execute → Record recovery → Clear simulated fault → Close.

Demo controls only modify demo records (units in `Demo Lab - …` locations).
**Reset demo** deletes nothing. **Remove demo data** is refused while backend
incident records reference demo units.

## Tests

```bash
cd backend && python -m pytest            # backend unit + integration tests
cd frontend && npm run typecheck && npm test && npm run build
cd frontend && npm run e2e                # Playwright; own backend on :8078 with a disposable DB
node scripts/verify-e2e.mjs               # HTTP workflow; own backend on :8079 with a disposable DB
```

## Repository

- `backend/` — FastAPI service (see `backend/README.md`).
- `frontend/` — React + TypeScript console (see `frontend/README.md`).
- `.kiro/` — Kiro specs (requirements, design, tasks) and steering.
- `scripts/` — isolated integration check.

## Known limitations

- No authentication or authorization; anyone with network access can call the API.
- Telemetry is simulated; no sensor integration.
- Closing an incident while a unit's recent readings are still abnormal lets the
  backend open a new incident on the next reading. The console warns about this.
- Escalation and alert resolution exist in the API but are not exposed in the UI.
