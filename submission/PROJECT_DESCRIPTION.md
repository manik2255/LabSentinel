# LabSentinel

**When a lab freezer fails, LabSentinel flags it with evidence, proposes where every sample can safely go, and moves them only after a person approves.**

Track: Healthtech/Biotech (confirm the track the team registered for).

Repository: <https://github.com/manik2255/LabSentinel> · Video: `<video URL>` · Team: `<names>`

## The problem

Research and clinical labs keep irreplaceable material in cold storage: patient plasma and cell lines in ultra-low freezers near −80 °C, vaccines in refrigerators held at 2 to 8 °C (the range in the [CDC Vaccine Storage and Handling Toolkit](https://www.cdc.gov/vaccines/hcp/downloads/vaccine-storage-troubleshooting-worksheet.pdf)), and cultures in incubators at 37 °C.

When a unit fails, someone has to work out under time pressure where each sample can go. The destination must hold the sample's whole temperature range, have enough free storage, and have a free slot, and the most important samples should move first. Working that out by hand, in the middle of the night, invites mistakes.

This happens close to home. In 2012 a freezer at the McLean Hospital brain bank in Belmont, Massachusetts lost power days before staff noticed. Its display still read −79 °C and a backup monitoring system had also failed ([Boston Globe](https://www.bostonglobe.com/metro/massachusetts/2012/12/03/independent-analysis-faults-freezer-control-for-defrosted-brain-samples/YiFK5P3cEifUq0UgPSyo6H/story.html)). About a third of the world's largest collection of autism brain tissue was damaged ([CBS News/AP](https://www.cbsnews.com/news/freezer-malfunction-thaws-150-brains-at-harvard-research-hospital/)).

LabSentinel does not replace certified alarm systems, and it would not have fixed a display that reported the wrong temperature. It works on what comes after detection: turning a failure into a checked relocation plan that a person approves, executes, and closes on the record.

## What it does

The React console runs in **backend mode** whenever the backend offers the incident API, which the current backend does. It reads the backend's live `/openapi.json` to decide this.

1. **Lab overview.** One card per unit with the latest temperature, allowed range, reported status, freshness, and storage and slot use. A banner names any critical unit. The card badges (OK, Warning, Stale, Critical) come from fixed range, status, and freshness rules computed in the browser, and always pair color with an icon and text.
2. **Telemetry and fault injection.** A time-scaled chart shades the allowed range, marks out-of-range readings in red, and breaks the line across gaps instead of drawing through missing data. For the demo, the presenter tells the backend simulator to produce abnormal temperatures or a hardware failure, on demo units only.
3. **Backend ML risk.** Each unit's page shows the backend's risk level, its Isolation Forest anomaly score, the backend's reasons, and the samples outside their safe range. The console explains that the score is a relative outlier score from 0 to 1, not a probability of failure. A separate, labeled rule-based check computed in the browser lists what was observed, what was derived, and what the data cannot tell.
4. **Persistent incidents.** Backend detection opens one incident per failing unit and keeps its evidence current. The incident card shows a seven-step tracker (detected, acknowledged, plan generated, plan approved, executed, recovery recorded, closed), and each step names who acts. The next action sits next to the "Next step" text that explains it.
5. **Rescue planning.** The console asks the backend for a plan and shows the method the backend actually used: "backend · MILP optimizer", or the greedy fallback if the solver is unavailable. It lists each proposed move with the sample's priority and required range and the destination's range, every sample that cannot be placed with the backend's reason, free storage and slots before and after for each backup, and the constraints the optimizer enforced.
6. **Human approval and execution.** A responder acknowledges, then approves. A partial plan needs an explicit "I accept that N sample(s) will be left behind". Execution needs a confirmation tick, and the backend moves every approved sample in one transaction or none. The responder then records the outcome (completed, partial, or unresolved, with unrescued samples acknowledged) and confirms closure. Every step comes from a backend response, and rejections are shown with the server's reason. The full audit trail and a history of closed incidents are on the same page.
7. **Safe, repeatable demo.** Demo controls only touch records the demo created. Reset demo deletes nothing. Remove demo data asks for confirmation and is refused while backend incident records reference demo units. The console will not approve or execute a plan that would move samples into equipment outside the demo lab.

If the backend has no incident API, the console falls back to its own browser workflow (rule-based assessment, a greedy planner, and incidents kept in the browser), and labels every result as browser-derived.

### Backend (FastAPI)

1. **Anomaly detection.** An Isolation Forest (scikit-learn, 200 trees) trained on synthetic normal temperature patterns scores readings with four features normalized by the unit's range: deviation from the range center, rate of change, rolling mean deviation, and rolling variability, over the last 10 readings. The score sets a base risk level, and deterministic rules can raise it: any out-of-range reading is at least high, far excursions are critical, a unit that is not operational is at least high, and a violated sample range escalates by sample priority. Each assessment returns its reasons and the endangered samples.
2. **Alerts and incidents.** The simulator runs detection after every reading. Elevated risk raises a deduplicated alert. High or critical risk, or a failed unit, opens a persistent incident with an audit trail, and repeated readings refresh its evidence instead of creating duplicates.
3. **Rescue optimization.** A mixed-integer linear program (SciPy `milp`) assigns endangered samples to operational backups whose range covers each sample, within storage and slot limits. The objective weights critical 1000, high 100, medium 10, and low 1, plus 0.1 per rescued sample. A priority-ordered greedy planner is the fallback if the solver is unavailable, and the plan reports which method ran.
4. **Approval, execution, recovery, closure.** Approval revalidates the plan against current inventory. Execution revalidates again, claims the plan atomically so a duplicate request is refused, and rolls back on any failure. Closure requires a recorded execution, a recorded recovery outcome, explicit confirmation, and acknowledgment of any unrescued samples.

## How we built it

- **Backend:** Python, FastAPI, SQLAlchemy, SQLite, scikit-learn, SciPy. 32 REST paths. 95 pytest tests run against a throwaway database and model file.
- **Console:** React 18, TypeScript in strict mode, Vite, TanStack Query, Recharts. `api/` is the only module that makes HTTP calls and normalizes backend data. `domain/` holds pure, tested functions (demo scope, detection display, the fallback planner and incident state machine). Live data comes from polling every 4 to 5 seconds.
- **Kiro:** the console was built spec-first in Kiro: requirements with numbered acceptance criteria, a design, and a tracked task list. Steering files held the project rules, the backend contract verified against the live OpenAPI schema, and architecture decisions. Kiro's review agent and audit passes found real defects that were fixed with regression tests. Details are in `KIRO_DEVELOPMENT_EVIDENCE.md`.

The two halves were built in parallel. When the console was specified at 15:30 ET, the backend offered only equipment, samples, simulation, and monitoring, so the console first implemented assessment, planning, and incidents itself behind one adapter. The backend's detection, optimizer, and incident API landed at 17:11 and 17:29 ET. The console switched to them between 17:50 and 18:21 ET, and the combined code was merged into `main` at 19:09 ET.

## What is real, simulated, and computed where

| Capability | Where it runs | Status |
| --- | --- | --- |
| Equipment, samples, capacity accounting, placement rules | Backend | Real |
| Temperature readings and faults | Backend simulator thread | **Simulated.** No physical sensors. |
| Isolation Forest anomaly score and risk level, with reasons | Backend, shown in the console | Real model, trained on synthetic normal data |
| Alerts | Backend | Real. Not shown in the console. |
| Incidents, evidence refresh, audit trail | Backend, shown in the console | Real, persistent in SQLite |
| Rescue plan | Backend MILP, or greedy fallback; the console shows which | Real |
| Approval, atomic execution, recovery outcome, closure | Backend, driven from the console | Real. Transfers move database records, not physical samples. |
| Escalation, incident report, standalone rescue plans | Backend | Real, API only. Not in the console. |
| Overview health badges and the "Rule-based Check" panel | Console, fixed rules | Computed in the browser, labeled |
| Notifications, authentication, authorization | none | Not implemented |

### About "AI"

The backend runs a trained anomaly-detection model on every reading and combines its score with explicit rules, so each risk level arrives with its reasons, and the console shows those reasons next to the score. The rescue plan comes from an exact optimizer, not a language model. AI also built the system: Kiro's agents turned the console's spec into code and tests, checked the backend contract, and reviewed the work.

## Challenges

- **Time zones.** The backend stores UTC times in SQLite, which drops the zone marker, and browsers read the bare timestamps as local time. In Eastern time every reading looked four hours in the future, so its age stayed at 0 seconds and stale data was never detected. An audit found it, and the console's API layer now treats unmarked timestamps as UTC.
- **Two implementations, one product.** Building in parallel left the console with its own assessment, planner, and incidents while the backend grew real ones. The console now detects backend capabilities at startup, uses the backend's records whenever they exist, and turns its own detection off so incidents are never duplicated. A teammate built a second risk panel at the same time, and the overlap was resolved in one documented merge.
- **Demo data in a shared database.** The first reset button could delete every record. Demo operations are now limited to demo-owned records, browser tests run on a throwaway database, and the console refuses to approve backend plans that would move samples into unrelated equipment.
- **Dead ends in the incident flow.** Kiro's review agent found an incident state where every button was disabled. Kiro fixed it and added a regression test.

## Accomplishments

- **Backend:** 95 pytest tests covering validation, detection, rescue optimization, incidents, approval, execution with rollback, recovery, reporting, and an end-to-end workflow.
- **Console:** 96 unit and component tests, including property tests of the fallback planner.
- **Browser tests:** three Playwright tests in Chromium on a throwaway database. They run the full backend incident flow from setup to closure and check that no new incident opens after closure. They also confirm that non-demo inventory is never changed, find no serious or critical axe violations, and show no horizontal overflow at 390 px.
- **API check:** an HTTP integration check (`scripts/verify-e2e.mjs`) passes 20 of 20 against its own throwaway backend.
- Every result shown on screen says where it came from: backend, simulator, or browser.

## Limitations

- Readings are simulated, and the anomaly model was trained on synthetic data, not real lab telemetry.
- No authentication or authorization. The backend timestamps acknowledgment and approval but records no identity. Limiting console actions to demo records is not a security control.
- No paging or notifications, so someone has to have the console open.
- Not every backend endpoint is in the console: escalation, alerts, the incident report, and standalone rescue plans are API only.
- An incident whose plan places no sample cannot be closed, because the backend requires an execution before recovery and closure.
- If an incident is closed while the unit's recent readings are still abnormal, the backend opens a new one on the next reading. The console warns about this and offers to clear the simulated fault first.
- Plans are generated per incident. There is no queue that ranks several incidents or shares capacity between their plans, although approval and execution revalidate against current inventory.
- Recovery records sample locations and the operator's stated outcome. Nothing confirms a sample is still viable.
- Polling adds up to about 5 seconds of delay.

## What's next

- Paging and escalation (SMS or on-call tools).
- Real sensor feeds, and retraining the model on real telemetry.
- User accounts, authorization, and per-user audit.
- A triage queue across incidents, and expose escalation and the incident report in the console.
- A way to record a manual disposition for samples no unit can hold.

## Try it

```bash
# Backend (from backend/)
pip install -r requirements.txt
DATABASE_URL=sqlite:///./labsentinel-demo.db python -m uvicorn app.main:app --port 8000
#   PowerShell: $env:DATABASE_URL="sqlite:///./labsentinel-demo.db"; python -m uvicorn app.main:app --port 8000
python -m pytest            # optional: 95 tests on a throwaway database

# Console (from frontend/)
npm install
npm run dev                 # http://127.0.0.1:5173, talks to http://127.0.0.1:8000 by default
```

Open the console and click **Set up demo**. API docs are at `http://127.0.0.1:8000/docs`. If port 8000 is taken, run the backend on another port and set `VITE_API_BASE_URL` in `frontend/.env`.
