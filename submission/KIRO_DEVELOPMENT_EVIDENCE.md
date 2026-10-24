# How Kiro Built LabSentinel: Evidence

Every claim below points to a file or commit in the repository. Times are Eastern on 2026-10-24, taken from file times and `git log`. They show order and pace; they are not a tamper-proof record.

## Summary

The console was built spec-first in Kiro. Kiro captured the live backend API schema, wrote steering rules that kept the console from claiming capabilities the backend lacked, wrote requirements with numbered acceptance criteria, then a design and a task list, and implemented the tasks in order. Three further passes followed:

- An independent review agent and a property-based test harness checked the work.
- Real-browser tests ran the main journeys in Chromium.
- When the backend's model, optimizer, and incident API arrived, Kiro connected the console to them and resolved a merge conflict with a teammate's parallel change.

Each pass found real defects, and the fixes are recorded with their tests.

The backend (FastAPI, SQLite, scikit-learn, SciPy) was written by a teammate. Its detection, optimizer, incident API, and tests arrived between 17:11 and 18:02. The repository holds no Kiro spec for it, so this document makes no claim about how it was built.

## Kiro features used

| Feature | Evidence | What it did |
| --- | --- | --- |
| Spec: requirements | `.kiro/specs/labsentinel-frontend/requirements.md` | 8 requirements with 40 numbered acceptance criteria in WHEN/THEN/SHALL form, plus non-functional requirements |
| Spec: design | `.kiro/specs/labsentinel-frontend/design.md` | Stack choice with reasons, layering, API client contract, the algorithm for each domain module, state model, testing strategy |
| Spec: tasks | `.kiro/specs/labsentinel-frontend/tasks.md` | 25 completed tasks in three passes, mapped to requirements, with dated verification records that list the commands run and what was NOT verified |
| Spec: sprint plan | `.kiro/specs/labsentinel-frontend/pass3-plan.md` | Confirmed defects for the final sprint, in priority order |
| Contract snapshot | `.kiro/specs/labsentinel-frontend/backend-openapi.snapshot.json` | The live OpenAPI schema (12 paths) saved before any console code was written |
| Steering, always included | `.kiro/steering/project.md` | Hard boundaries (never edit the backend, never change the API contract alone) and the rule that every result says where it came from. Updated at 18:21 to describe backend mode. |
| Steering, file match | `.kiro/steering/backend-contract.md` (`fileMatchPattern: 'frontend/src/api/**'`) | The verified contract, loaded whenever the API layer is edited. Updated at 18:21 and 18:24 to the 32-path backend. |
| Steering, manual | `.kiro/steering/architecture-decisions.md` | Five architecture decision records written at 16:36. ADR-1 records the decision to compute locally while the backend lacked these APIs, and was not rewritten afterwards. |
| Review sub-agent | `tasks.md`, Pass 2 section | An independent behavioral review at 16:29 returned NEEDS_CHANGES with six issues; the confirmed ones were fixed with tests. Its report file was deleted before the first commit because it described code that later changed, so it is not in the repository. |

Not used: agent hooks (no `.kiro/hooks/`) and MCP servers.

## Timeline

| Time (ET) | Event | Evidence |
| --- | --- | --- |
| 11:46 to 13:36 | Backend set up: equipment and sample APIs, temperature simulation | 4 commits by the backend teammate |
| 15:28 | Live OpenAPI schema saved | `backend-openapi.snapshot.json` |
| 15:29 | Steering written | `project.md`, `backend-contract.md` |
| 15:30 to 15:32 | Requirements, design, task list | `requirements.md`, `design.md`, `tasks.md` |
| 15:32 to 15:51 | Implementation in task order, then the first quality gate | `frontend/src/**` creation times; `tasks.md` Pass 1 record |
| 16:08 to 16:36 | Pass 2: audit, property tests, browser test, review agent, fixes, decision records | `rescue.property.test.ts`, `demo-journey.spec.ts`, `IncidentCard.deadend.test.tsx`, `architecture-decisions.md` |
| 17:03 to 17:34 | Pass 3: demo safety, test isolation, timestamp fix, lifecycle fixes, accessibility; first commit | `pass3-plan.md`, `demoScope.ts`; commit `afc03f6` (17:34) |
| 17:11 to 18:02 | Backend teammate pushes detection, optimizer, incidents, execution, recovery, the report endpoint, tests | Commits `42cb19b`, `9a0e595`, `1678442`, `6448445` |
| 17:40 | Console merged into `main` (PR #1) | Commit `9387caa` |
| 17:50 to 18:21 | Backend integration: capability detection, ML risk panel, backend incident workflow, demo-scope check for backend plans, Playwright journey rewritten for the backend | Commit `f918885` (18:21) adds `BackendRiskPanel.tsx` and `BackendIncidentCard.tsx` |
| 18:21 to 18:43 | Merged the latest backend; docs synced; Overview notice corrected to describe the active mode | `641b123`, `7dbb647`, `d318ba7` |
| 18:47 | Conflict with a teammate's parallel risk display (`8b5f925`) reviewed and resolved | `2b49a00`; its commit message lists what was kept and dropped |
| 19:09 | PR #2 merged; `main` holds the complete project | `857d5b8` |

## From requirement to code

| Requirement | Tests | Code (backend mode) | Code (fallback) |
| --- | --- | --- | --- |
| R1 Overview and monitoring | `detection.test.ts`, `CapacityBar.test.tsx`, Playwright | `OverviewPage.tsx`, `EquipmentCard.tsx` | same |
| R2 Telemetry and fault simulation | `client.test.ts`, `TelemetryChart.test.ts` | `TelemetryChart.tsx`, `FaultControls.tsx`, `api/endpoints.ts` | same |
| R3 Explainable assessment | `assessment.test.ts`, Playwright | `BackendRiskPanel.tsx` (backend risk), `AssessmentPanel.tsx` (labeled rule-based check) | `domain/assessment.ts` |
| R4, R5 Rescue planning and capacity | `demoScope.test.ts` (backend plan scope), Playwright | `BackendIncidentCard.tsx` plan view | `domain/rescue.ts`, `rescue.property.test.ts` |
| R6 Acknowledgment and execution | Playwright, `IncidentCard.deadend.test.tsx` | `BackendIncidentCard.tsx` | `domain/incident.ts`, `useRescueExecution.ts` |
| R7 Recovery and history | Playwright (recovery, closure, audit trail) | `BackendIncidentCard.tsx`, `IncidentsPage.tsx` | `domain/incident.ts` |
| R8 Demo set-up and reset | `demoScope.test.ts`, Playwright | `useDemoControls.ts`, `domain/demoScope.ts` | same |

## Steering kept the product honest

`project.md` required every locally computed result to carry a visible label, and the console still follows it. Backend results are tagged "backend · Isolation Forest" and "backend · MILP optimizer". The browser check is tagged "rule-based · derived locally". The top bar shows "Demo · simulated telemetry". When the backend APIs arrived, the steering was updated before the integration was committed, so the contract the API layer loads matches the 32-path backend. The update also records that backend timestamps arrive without a zone marker.

## Defects found by Kiro's own checks

| Defect | Found by | Fix | Regression evidence |
| --- | --- | --- | --- |
| A failed recovery check left an incident with every button disabled | Review agent (critical) | Re-open path and Verify kept available | `IncidentCard.deadend.test.tsx` |
| A percentage "confidence" read like a calibrated probability | Pass 2 audit | Qualitative evidence rating with a "not a probability" note | `assessment.test.ts` |
| Timestamps parsed as local time: four-hour skew, stale data never detected | Pass 3 audit | Unmarked timestamps treated as UTC in the API layer | `client.test.ts` |
| A partial rescue could pass recovery verification | Pass 3 audit | Verification checks every sample still in the failed unit | `incident.test.ts` |
| Demo controls could change or delete any record in a shared database | Pass 3 audit | Demo-owned records only, checked again inside each operation | `demoScope.test.ts`, Playwright |
| Browser tests and the integration script used the working database | Pass 3 audit | Each starts its own backend on a throwaway database | `playwright.config.ts`, `scripts/verify-e2e.mjs` |
| Browser and backend would both open incidents | Integration | Browser detection off when the backend has the incident API | Playwright: exactly one incident card |
| A backend plan could move demo samples into unrelated equipment | Integration | Approval and execution disabled for such plans | `demoScope.test.ts` (`checkBackendPlanScope`) |
| Removing demo units could orphan backend incident records | Integration | Removal refused while records reference demo units | Playwright |
| Pending step labels failed axe's contrast check | Playwright axe run | Dashed border instead of reduced opacity | Playwright |
| Overview notice said the work ran in the browser in backend mode | Final text review | Notice describes the active mode | Playwright |

## Verification on the final code

| Check | Result | What it proves | What it does not prove |
| --- | --- | --- | --- |
| `npx tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | Clean | Type safety across the console | Runtime behavior |
| Vitest | 96 passed in 13 files | Demo scope, timestamp parsing, API error handling, detection display, fallback planner and state machine, components | The rendered layout |
| `rescue.property.test.ts` | Passes | The fallback planner never breaks a temperature, storage, or slot limit over 300 random labs; a hand-built case shows greedy scoring 4 where the optimum scores 5 | Anything about the backend optimizer |
| Playwright `e2e/demo-journey.spec.ts` (Chromium, throwaway database) | 3 passed | In a real browser against the real backend: setup, ML risk, a simulated failure, one backend incident, acknowledge, MILP plan, approval, confirmed execution, recovery, fault cleared, risk back to low, closure, audit trail, no new incident after closure, non-demo inventory untouched, removal refused while incident records exist, axe and mobile checks | Browsers other than Chromium; screen readers |
| `node scripts/verify-e2e.mjs` | 20 of 20 passed | Over HTTP, against its own throwaway backend: placement rules (422, 409), simulated failure, rescue moves, final locations | The console |
| Backend `python -m pytest` | 95 passed | Validation, detection, optimization, incidents, approval, execution with rollback, recovery, reporting | Real sensor data |

## How a judge can check

```bash
# From backend/
pip install -r requirements.txt
python -m pytest                                 # 95 tests, throwaway database

# From frontend/
npm install
npx tsc --noEmit
npm test                                         # 96 Vitest tests
npx playwright install chromium
npx playwright test                              # starts its own backend and console; throwaway database

# Read the spec trail
.kiro/specs/labsentinel-frontend/requirements.md
.kiro/specs/labsentinel-frontend/design.md
.kiro/specs/labsentinel-frontend/tasks.md
.kiro/steering/*.md
```

## Gaps in the Kiro story

- No hooks or MCP servers were configured.
- No Kiro artifacts cover the backend.
- Chat transcripts are not in the repository. The spec files, steering, commit messages, and verification records are the evidence.
- ADR-1 in `architecture-decisions.md` still describes the 16:36 decision to compute locally; `project.md` describes the current backend mode.
