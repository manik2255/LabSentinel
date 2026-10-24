# Final Submission Checklist

Submissions lock at **20:00 ET on Saturday, October 24, 2026** ([Sundai event page](https://www.sundai.club/events/boston/hackachusetts-with-kiro)). Aim to submit by 19:50.

State checked at 19:15 ET with `git`, `gh`, and a logged-out request to GitHub.

| Fact | Value |
| --- | --- |
| Repository | <https://github.com/manik2255/LabSentinel>, **public** |
| `main` | `857d5b8`: backend, console, `.kiro/`, `scripts/`, root `README.md`. PR #2 merged at 19:09 ET. |
| `feature/frontend-console` | Same files as `main` |
| Console mode | Backend mode: ML risk, incidents, rescue plans, approval, execution, recovery, and closure come from the backend |
| `submission/` | These six documents, committed to `main` after this update |

## P0: required before 20:00

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Repository viewable by judges | Repository owner | Done: public, checked logged out |
| 2 | Complete project on `main` | Team | Done: PR #2 merged |
| 3 | Present one consistent story: the console uses the backend's model, optimizer, and incident API | Team | Done in the README and these documents; keep the video consistent |
| 4 | Record the video with `DEMO_SCRIPT.md`, at most 3:00 | Team | Open |
| 5 | Upload the video so it plays without signing in | Team | Open |
| 6 | Replace `<video URL>` and `<names>` in `PROJECT_DESCRIPTION.md`, fill in the form, submit | Team | Open |

## P1: worth doing if time allows

| # | Item | Notes |
| --- | --- | --- |
| 7 | Add the video link and two or three screenshots to the root `README.md` | Capture at window size from the running demo. `frontend/e2e/artifacts/` is gitignored. |
| 8 | Fresh-clone test: clone `main` into a new folder and follow the README | The backend trains its model on first start; allow a few seconds. |
| 9 | Add a LICENSE if the team agrees | Whether the event requires one was not confirmed. |

## Verified results to quote (final code)

| Check | Result |
| --- | --- |
| Backend `python -m pytest` | 95 passed |
| Console `npm test` (Vitest) | 96 passed in 13 files |
| `npx tsc --noEmit` and `npm run build` | Clean, succeeds |
| Playwright (Chromium, throwaway database) | 3 passed, including the full backend incident flow from setup to closure |
| `node scripts/verify-e2e.mjs` | 20 of 20 passed against its own throwaway backend |

## Facts to keep identical in the README, description, video, and spoken answers

1. Telemetry is simulated by the backend. No physical sensors are connected.
2. The backend scores readings with an Isolation Forest trained on synthetic normal data and combines the score with explicit rules. The score is a relative outlier score, not a probability.
3. The console shows the backend's risk, incidents, and audit trail, and drives acknowledgment, approval, execution, recovery, and closure through the backend.
4. The rescue plan comes from the backend's mixed-integer linear program, with a greedy fallback if the solver is unavailable. The console shows which method ran.
5. Execution moves all approved samples in one transaction or none, and a duplicate request is refused.
6. There is no authentication. The backend records times, not identities.
7. Recovery records locations and the operator's outcome. Nothing confirms sample viability.
8. Escalation, alerts, the incident report, and standalone rescue plans are API only.
9. No notifications or paging yet.

## Remaining timeline

| ET | Step |
| --- | --- |
| 19:20 to 19:40 | Rehearse once, record, cut the 30-second recovery wait |
| 19:40 to 19:48 | Upload the video, fill in the placeholders |
| 19:48 to 19:55 | Submit the form from `PROJECT_DESCRIPTION.md` and `KIRO_DEVELOPMENT_EVIDENCE.md` |
| 20:00 | Submissions lock |

## Not confirmed

The exact form fields, the maximum video length, whether a license is required, and whether a separate Kiro write-up is required. Check the Sundai Discord or event page. Earlier Kiro hackathons asked for a video under three minutes and a write-up of how Kiro was used ([summary of the Kiroween rules](https://dev.to/brian_mk/decoding-kiroween-4nm)).
