# Judging Readiness: LabSentinel

## About the criteria

The official Hackachusetts rubric text was not available online when this was written. The [Sundai event page](https://www.sundai.club/events/boston/hackachusetts-with-kiro) confirms submissions lock at 20:00 ET on October 24 and judging runs 20:00 to 23:00. This checklist uses the three dimensions the team was given: Potential Value, Implementation, and Quality and Design. Earlier Kiro-run hackathons judged implementation largely on how well a project used Kiro ([Kiroween](https://kiroween.devpost.com/): potential value, implementation of Kiro, creativity), so the Implementation section covers both the engineering and the Kiro use.

Ratings are a candid self-assessment on a 1 to 5 scale, based on `main` at `857d5b8` (19:09 ET).

## Status of the earlier blockers

| Blocker at 17:50 ET | Status |
| --- | --- |
| Repository private; console only on a branch | Resolved: public, and PR #2 merged into `main` |
| Console and backend did not talk | Resolved: the console shows the backend's ML risk and incidents, and drives the backend's plan, approval, execution, recovery, and closure. Browser-side detection is off in this mode, so there are no duplicate incidents. |
| Steering said the backend had no incident, rescue, or alert API | Resolved in `project.md` and `backend-contract.md`. ADR-1 in `architecture-decisions.md` still records the 16:36 decision and was not rewritten. |

## 1. Potential Value

Rating: 4.

| Strongest evidence | Where to show it |
| --- | --- |
| A Massachusetts precedent: the 2012 McLean brain bank freezer failure damaged about a third of the world's largest autism brain collection | Video 0:00 |
| The plan answers the operator's real question with real constraints: full temperature-range coverage, storage, slots, and priority | Video 1:10 |
| The optimizer lists samples it cannot place, with reasons, instead of inventing a destination | Optional harder case in `DEMO_SCRIPT.md` |
| A person approves, the backend revalidates and moves samples in one transaction, and recovery and closure are on the record | Video 1:40 to 2:20 |

| Weakness | How to handle it |
| --- | --- |
| No lab staff were interviewed and nothing was measured with users | Do not imply validation. Name the likely users: lab managers, on-call responders, biobank staff. |
| No paging or notifications. The McLean failure went unnoticed for days. | Say it plainly. Paging is first in "what's next". |
| Readings are simulated and the model was trained on synthetic data | Say both every time. |
| Lab temperature-monitoring products already exist | Position LabSentinel on the decision after the alarm: where each sample goes. Do not make claims about competitors you have not checked. |

## 2. Implementation

Rating: 4.5 for the engineering, 4 for Kiro use.

| Strongest evidence | Where |
| --- | --- |
| Backend: 95 pytest tests, including atomic-claim and rollback tests for execution | `backend/tests/` |
| Backend: Isolation Forest with four range-normalized features plus rules that return reasons; MILP allocation with a reported greedy fallback | `backend/app/detection/`, `backend/app/rescue/optimizer.py` |
| Console in backend mode: capability detection from the live OpenAPI document, every incident state read from backend responses, approval and execution limited to demo-lab plans | `frontend/src/api/endpoints.ts`, `frontend/src/components/BackendIncidentCard.tsx`, `frontend/src/domain/demoScope.ts` |
| Console: 96 unit and component tests; property tests of the fallback planner over 300 random labs | `frontend/src/**/*.test.ts(x)` |
| Browser tests: the full backend incident flow on a throwaway database, demo-only safety limits, no reopened incident after closure, axe checks | `frontend/e2e/demo-journey.spec.ts` |
| Spec-first trail with timestamps, and Kiro audits that found real defects fixed with regression tests | `KIRO_DEVELOPMENT_EVIDENCE.md`, `.kiro/specs/` |
| Steering in three inclusion modes: always, file match on the API layer, manual | `.kiro/steering/` |

| Weakness | How to handle it |
| --- | --- |
| No Kiro artifacts cover the backend | Do not claim Kiro built the backend unless it did. |
| No hooks or MCP | Say so if asked. |
| Two teammates built overlapping risk displays; one was dropped in the merge | Explain the parallel build and the documented resolution in PR #2. |

## 3. Quality and Design

Rating: 4.

| Strongest evidence | Where to show it |
| --- | --- |
| The risk shows its reasons, and the score is explained as a relative outlier score, not a probability | Video 0:28 |
| Every result says where it came from: backend, simulator, or browser | Any screen |
| A seven-step tracker, a "Next step" sentence with its action next to it, and confirmations on every step that changes inventory or closes the record | Video 0:55 to 2:20 |
| Each plan shows the method used, every move, every unplaced sample with its reason, and capacity before and after | Video 1:10 |
| Loading, error, empty, and stale states on every data view; skip link, page titles, named switches, passing contrast | Any screen |

| Weakness (details in `HCI_REVIEW.md`) | Effort |
| --- | --- |
| No triage queue across several incidents | Medium |
| An incident whose plan places no sample cannot be closed (backend rule) | Medium, needs a backend change |
| Remove-demo confirmation is not modal; the incident badge is not announced to screen readers | Small |

## Questions judges are likely to ask

| Question | Truthful answer |
| --- | --- |
| Where is the AI? | In the backend: an Isolation Forest scores readings, and explicit rules turn the score and range checks into a risk level with reasons. The console shows both. Kiro also built and reviewed the console. |
| Is the score a probability? | No. It is a relative outlier score from 0 to 1, mapped from the model's output. |
| What data trained the model? | Synthetic normal temperature patterns. Real telemetry is a next step. |
| Is the plan optimal? | When the console shows "backend · MILP optimizer", the plan is the solution of a mixed-integer linear program that maximizes priority-weighted samples rescued under the listed constraints. If the solver is unavailable, a greedy fallback runs and the console says so. |
| What stops a double execution? | The backend claims the plan atomically; a second request gets a conflict and moves nothing. The button is also disabled while a request is in flight. |
| Who approved this? | The backend records when, not who. There are no user accounts yet. |
| What if no unit fits a sample? | The plan lists it as not relocated, with the backend's reason. A partial plan can be approved only after acknowledging the samples left behind. A plan that places nothing cannot be approved. |
| What if two incidents need the same freezer? | Plans are made per incident. Approval and execution revalidate against current inventory, so a plan that no longer fits is refused with the reason. There is no shared triage yet. |
| Are these real sensors? | No. A backend thread simulates readings and faults. |
| What happens at 2 a.m.? | Today nothing pages anyone; the console must be open. Paging is the first roadmap item. |
| Where is incident data stored? | In the backend's SQLite database, with an audit trail. |
| What did Kiro do, and what did you do? | See `KIRO_DEVELOPMENT_EVIDENCE.md`. A teammate wrote the backend. The console, its spec, tests, reviews, and backend integration came from Kiro sessions directed by the team. |

## Final check by criterion (before 20:00 ET)

- [x] Implementation: the repository is public and `main` contains `frontend/`, `.kiro/`, `backend/`, and `scripts/`.
- [x] Implementation: the final gate passed (95 backend, 96 frontend, 3 Playwright, 20 integration checks), and these documents quote the same numbers.
- [x] Implementation: the README and description say plainly which part does what.
- [ ] Potential Value: the video opens with the problem and states that telemetry is simulated.
- [ ] Quality and Design: any screenshots in the README come from the final build.
- [ ] The video, form, and description use the facts in `FINAL_SUBMISSION_CHECKLIST.md`.
