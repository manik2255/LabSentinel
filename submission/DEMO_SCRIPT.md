# LabSentinel Demo Video Script (3:00)

Matches the application on `main` at commit `857d5b8` (2026-10-24, 19:09 ET), with the console in **backend mode**: ML risk, incidents, rescue plans, approval, execution, recovery, and closure all come from the FastAPI backend. Telemetry is simulated.

## What a judge should remember

1. A freezer fails. The backend's Isolation Forest model and explicit rules flag it, and the console shows the reasons and numbers behind the risk.
2. The backend optimizer proposes where each sample can go, within temperature range, storage, slots, and priority, and it lists what it cannot place instead of inventing a destination.
3. A person acknowledges, approves, and confirms. The backend moves the samples in one transaction, records the recovery outcome, and keeps an audit trail. Kiro specs, steering, reviews, and tests are how we built and checked it in one day.

## Scenario facts

Created by the console's **Set up demo** (`frontend/src/config.ts`):

| Unit | Allowed range | Storage | Slots | Samples at start |
| --- | --- | --- | --- | --- |
| Ultra-Low Freezer A | −86 to −70 °C | 40 | 20 | Patient Plasma Lot P-101 (critical, 8 units), Cell Line CL-22 (high, 6), RNA Extract R-7 (medium, 4) |
| Ultra-Low Freezer B | −86 to −65 °C | 60 | 30 | none |
| Vaccine Fridge | 2 to 8 °C | 50 | no limit | Vaccine Vials V-900 (critical, 10) |
| Incubator 37C | 36 to 38 °C | 30 | 15 | Culture Flask CF-3 (high, 5) |

Expected backend plan when Freezer A fails: all three samples to Ultra-Low Freezer B, method `milp`. Freezer B's free storage goes from 60 to 42 units and its free slots from 30 to 27. The fridge and incubator cannot hold −80 °C, so they stay unused.

## Pre-flight (10 minutes before recording)

1. Start the backend on a **new** database file for each clean take, with its own model file. Both files land in `backend/`, where git ignores `*.db` and `*.joblib`. On the recording machine port 8000 is taken, and `frontend/.env` points at 8077:

   ```powershell
   cd backend
   $env:DATABASE_URL = 'sqlite:///./labsentinel-demo-take1.db'
   $env:ANOMALY_MODEL_PATH = '.\anomaly_model_demo.joblib'
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8077
   ```

   ```powershell
   cd frontend
   npm run dev        # http://127.0.0.1:5173
   ```

   Check `http://127.0.0.1:8077/api/health` returns `ok`. The backend trains its model on first start if the model file does not exist yet, which takes a few seconds.
2. Use the console's **Set up demo**, not the backend's `scripts/demo_seed.py`. The backend seed creates units outside the console's "Demo Lab", and the console will not inject faults into them or approve plans for them.
3. Open `http://127.0.0.1:5173` in a fresh browser window. The Overview notice must end with "ML risk assessment, incident tracking, rescue planning, and rescue execution are handled by the backend." If it says the work runs in the browser, the console is talking to an old backend: stop and restart step 1.
4. Window at 1440×900 or 1280×800, zoom 100 to 110%, notifications off.
5. Rehearse once. For the real take, restart the backend on a new database file (for example `…-take2.db`) and reload the page. **Remove demo data** is refused once backend incident records exist, and **Reset demo** keeps the earlier incident in the history.
6. In Kiro, open `.kiro/specs/labsentinel-frontend/requirements.md`, `tasks.md`, and `.kiro/steering/backend-contract.md` for the Kiro clip.

## Waits to plan for

| After | Wait | What you see |
| --- | --- | --- |
| **Set up demo** | about 10 s | The ML risk panel says "Not enough readings yet" until 3 readings exist |
| **Hardware failure** On | 3 to 7 s | The next simulator reading flips the risk; the incident appears on the next poll |
| **Clear simulated fault** | about 30 s | "Unit risk now" stays high until the model's 10-reading window holds only normal readings. Cut this wait in editing and say so. |

## UI label check

| Label | Where |
| --- | --- |
| Set up demo, Reset demo, Remove demo data… | Overview header |
| Demo · simulated telemetry | Top bar |
| Telemetry & controls | Each unit card |
| Temperature Telemetry, Fault Injection, Hardware failure (Off / On) | Unit telemetry page |
| ML Risk Assessment, "backend · Isolation Forest", Risk: low, anomaly score | Unit telemetry page, right column |
| Rule-based Check, "rule-based · derived locally" | Unit telemetry page, below the ML panel |
| Incidents (count badge) | Left navigation |
| backend record #N, Next step, Acknowledge, Generate rescue plan | Incident card |
| Full plan, "backend · MILP optimizer", "3 of 3 sample(s) can be relocated." | Incident card, Rescue Plan |
| Approve plan, "I confirm this simulated transfer of 3 demo sample(s)", Execute rescue | Incident card |
| Execution success, Record recovery, Clear simulated fault, Unit risk now, Close incident | Incident card |
| Incident history, Closed, Audit trail | Incidents page after closing |

## Clips

| Clip | Covers | How |
| --- | --- | --- |
| A | 0:00 to 2:20 | One take from a fresh database, with one cut during the 30 s recovery wait |
| C | 2:20 to 2:45 | Kiro IDE and a terminal, any time |
| D | 2:45 to 3:00 | Overview right after clip A: Freezer B now holds the samples (storage 18 / 60) |

## Script

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00 to 0:15 | Overview, all four cards OK. Optional title: "LabSentinel · Hackachusetts 2026". | "In 2012, a freezer at a Massachusetts brain bank lost power for days before anyone noticed. A third of the world's largest autism brain collection was damaged. When cold storage fails, someone has to decide, fast, where every sample can go." |
| 0:15 to 0:28 | Point at the "Demo · simulated telemetry" pill and the notice, then the Freezer A card (storage 18 / 40) and Freezer B (0 / 60). | "This is a demo lab of four units. Readings come from our backend's simulator every three seconds. No real sensors are connected. Freezer A holds three samples, including a critical plasma lot." |
| 0:28 to 0:55 | Click **Telemetry & controls** on Freezer A. Point at the shaded band and the **ML Risk Assessment** panel: "Risk: low", the anomaly score. Switch **Hardware failure** On. When the risk changes, point at the new level and the backend reasons. | "Our backend scores every reading with an Isolation Forest model trained on synthetic normal data, and combines it with explicit rules. Now I'll simulate a hardware failure. The reading jumps far outside the allowed band, and the backend raises the risk and says why: out of range, unit offline, samples outside their safe range. The score shows how unusual the readings are. It is not a probability of failure." |
| 0:55 to 1:10 | Click **Incidents**. Point at "backend record #1", the step row, and the Evidence panel. Click **Acknowledge**. | "The backend has already opened an incident and stored it, with the evidence it used. A responder acknowledges it. The backend timestamps that in the audit trail. There are no user accounts yet, so it doesn't record who." |
| 1:10 to 1:40 | Click **Generate rescue plan**. Point at "Full plan", the "backend · MILP optimizer" tag, "3 of 3 sample(s) can be relocated.", the three moves to Freezer B, and the capacity line "60 → 42 units". Expand **Constraints enforced by the backend**. Click **Approve plan**. | "The backend plans the rescue as a mixed-integer linear program. It only uses operational units whose range covers each sample's full requirement, stays within storage and slot limits, and maximizes the priority-weighted samples rescued. The fridge and incubator can't hold minus 80, so all three go to Freezer B. Planning moves nothing. I approve, and the backend first re-checks the plan against current inventory." |
| 1:40 to 2:00 | Tick "I confirm this simulated transfer of 3 demo sample(s)". Click **Execute rescue**. Point at "Execution success" and the three transfer lines. | "Execution needs a deliberate confirmation. The backend re-validates again and moves every approved sample in one transaction, or none at all. A second click can't run it twice." |
| 2:00 to 2:20 | Click **Record recovery** (Completed). Click **Clear simulated fault**. *Cut the wait.* Point at "Unit risk now: low", tick the close confirmation, click **Close incident**. Show **Incident history** and open the audit trail. | "The responder records what actually happened. This confirms where the samples are, not that they are still viable. I clear the simulated fault. Once the readings are back to normal, I close the incident. Every step is in the backend's audit trail." |
| 2:20 to 2:45 | Clip C. Kiro: `requirements.md` (Requirement 4), `tasks.md` verification record, `backend-contract.md`. Cut to a terminal in `frontend/` showing `npm test` passing. | "We built the console with Kiro. A spec with numbered acceptance criteria drove the design, steering files pinned the backend contract to the live API, and Kiro's review agent caught real defects, each fixed with a regression test. 96 frontend tests, 95 backend tests, and browser tests run the whole incident flow on a throwaway database." |
| 2:45 to 3:00 | Clip D. Overview: Freezer B holds the rescued samples. | "Biobanks, hospital labs, and vaccine clinics all depend on cold storage. Next: real sensor feeds, paging, and user accounts. LabSentinel: see the failure, know where every sample goes." |

Narration is about 440 words, roughly 150 words per minute. If a rehearsal runs long, cut the second sentence of the 0:15 segment, then "Planning moves nothing."

## Optional harder case (record last)

Replace 2:20 to 2:45 with this if you prefer showing an infeasible plan over the Kiro clip. Switch on **Hardware failure** for the Vaccine Fridge, open its incident, **Acknowledge**, then **Generate rescue plan**. Expect "No feasible allocation", "0 of 1 sample(s) can be relocated.", the Vaccine Vials V-900 under "Not relocated" with the backend's reason, and a disabled **Approve plan**.

Narration: "A harder case: the vaccine fridge fails. No other unit holds 2 to 8 degrees, so the optimizer doesn't invent a destination. It lists the critical vials as not relocated and says why, and approval stays locked for a person to handle."

Record it last. The backend cannot close this incident: closing requires a recorded execution, and an infeasible plan cannot be approved or executed.

## Live-variation notes

- **Risk level.** A failed unit normally reads "critical" because its readings are far outside the range and its samples are high priority. Read the level on screen. Do not claim a level that isn't shown.
- **Method tag.** If the plan says "backend · greedy-fallback" instead of "backend · MILP optimizer", the solver was unavailable. Say "fallback heuristic", not "optimizer".
- **Action rejected.** If the card shows "Backend rejected the action", leave it on screen and say: "The backend refused this step and shows why." Then retake.
- **An incident appears before the fault.** Stop. Restart the backend on a new database file and reload.
- **Approve plan stays disabled.** Read the "Next step" text. The plan may move samples outside the demo lab, or nothing can be placed.

## Accuracy guardrails

| Do not say | Say instead | Why |
| --- | --- | --- |
| "a 96% chance of failure" or any probability | "the anomaly score is high" | The score is a relative outlier score from 0 to 1, not a probability. |
| "trained on real lab data" | "trained on synthetic normal data" | The model is trained on generated normal readings. |
| "optimal" without the tag | "solved as a mixed-integer linear program that maximizes priority-weighted samples rescued" | Only say it when the tag reads "backend · MILP optimizer". |
| "real sensors", "live freezer data" | "simulated readings from our backend" | All readings come from the simulator. |
| "Dr. X approved this" | "a responder approved it" | There is no authentication, so the backend records times, not identities. |
| "it pages the on-call team" | "it opens an incident" | Nothing sends notifications. |
| "the samples are safe" | "the samples are in compatible, online storage" | Recovery records locations and the operator's outcome, not viability. |
| "every backend feature is in the UI" | nothing | Escalation, alerts, the incident report, and standalone rescue plans are API-only. |
| "would have saved the McLean brains" | nothing | That freezer's display still read −79 °C; LabSentinel works on the response after detection. |
| "tested with labs" or user numbers | nothing | No user validation was done. |

## Sources for the hook

- Boston Globe, 2012-12-03: staff found that Freezer U, one of 24 in the McLean brain bank, had lost power days earlier; its display still read −79 °C and a backup monitoring system had also failed. <https://www.bostonglobe.com/metro/massachusetts/2012/12/03/independent-analysis-faults-freezer-control-for-defrosted-brain-samples/YiFK5P3cEifUq0UgPSyo6H/story.html>
- CBS News / AP, 2012-06-11: the malfunction damaged about one-third of the world's largest collection of autism brain samples. <https://www.cbsnews.com/news/freezer-malfunction-thaws-150-brains-at-harvard-research-hospital/>

Content from these sources was rephrased for compliance with licensing restrictions.
