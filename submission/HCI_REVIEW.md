# LabSentinel HCI Review

Independent review for the Hackachusetts 2026 submission. This document does not change the application.

## Scope and evidence

| Source | What it covers | Limits |
| --- | --- | --- |
| Frontend source on `main` at `857d5b8` (19:09 ET), console in backend mode | Component structure, copy, ARIA, state logic, design tokens | Earlier findings came from reading the code between 17:00 and 17:40 ET. Their statuses below were updated against the final code. |
| Playwright runs on throwaway databases: 16:34 and 17:31 ET (browser-only workflow), 18:18 ET and later (backend workflow) | Screens and behavior in Chromium | Full-page captures draw the sticky header mid-page; that is a capture artifact. |
| Automated axe checks inside the Playwright suite (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA tags) | Overview and Incident Response pages | The run fails on serious or critical violations and found none. Axe does not check hover or focus states, and it is not a full conformance audit. |
| Contrast ratios computed from `frontend/src/styles/tokens.css` (WCAG 2.x formula) | Text and button color pairs | Alpha backgrounds were blended over the card surface. |

Not done: usability testing with lab staff, screen-reader testing, or a complete keyboard-only walkthrough.

## Summary

The console is honest about where each result comes from: the backend model, the backend optimizer, the simulator, or the browser. It shows the reasons behind every risk and keeps a person in control of every step that changes inventory or closes the record. The move to the backend incident workflow resolved the highest-severity finding (outdated incident evidence) and the action-placement finding. It also resolved part of the closure finding. The largest remaining gaps are triage across several incidents and closing an incident whose plan places no sample.

## Top five improvements, by severity

### 1. Critical: incident evidence was a one-time snapshot that could be outdated

Status: **resolved in backend mode** (the current configuration). It remains in the browser-only fallback.

What was wrong: in the browser-only workflow, an incident kept the assessment from the moment of detection. A 17:31 run showed "Reported status: operational" for a unit the backend had already marked offline. At 16:34, a cached reading from a deleted unit opened a phantom incident. SQLite had reused the unit's id, and the browser's cache still held the old reading.

What changed:

- Incidents now come from backend detection. The backend refreshes an open incident's evidence on every qualifying reading and records an `evidence_updated` audit event. The card shows the backend's latest temperature, anomaly score, reasons, and "Evidence updated" time, and it refetches every 4 seconds.
- Browser-side detection is off in backend mode, so a cached reading can no longer open an incident.
- Set up, reset, and removal now reset cached readings, history, risk, and incident data instead of only invalidating them.
- The Playwright test waits 8 seconds after closing and confirms no new incident opens for the unit.

### 2. High: an incident with an unplaceable sample could not be closed

Status: **partly resolved.**

- **Now possible:** for a partial plan, the responder approves with "I accept that N sample(s) will be left behind", executes, and records the outcome as partial or unresolved. The unrescued samples are acknowledged, and the incident closes on the record.
- **Still blocked:** if the plan places no sample at all, it cannot be approved. The backend requires an execution before recovery and closure, so that incident stays open. The card says why.

Recommendation: let the responder record a manual disposition for unplaceable samples (where each went, a note, a time), written to the audit trail and shown as "recorded by responder, not verified by the system". This needs a backend endpoint.

### 3. High: no triage across several incidents

Status: **open.**

Every active incident renders as a full card, newest first. Nothing ranks incidents by critical samples at risk, and each plan is generated for one incident. Approval and execution revalidate against current inventory, so a plan that no longer fits is refused with the backend's reason, but the operator gets no warning before trying.

Recommendation: a compact queue at the top (unit, severity, samples at risk by priority, step, next action), sorted by critical samples, with one card expanded at a time. The backend's `POST /api/rescue/plan` can already plan several failed units in one optimization.

### 4. High: the action buttons sat far below the "Next step" guidance

Status: **resolved in backend mode.**

The primary action for the current step now sits inside the "Next step" box, together with any confirmation it needs: the partial-plan acceptance, the execution tick, the recovery outcome, and the close confirmation. Errors appear in the same box. The browser-only fallback card keeps the older layout.

### 5. Medium: remaining accessibility gaps

Status: **partly fixed.**

Fixed in Pass 3:

- Switches have `role="switch"` and accessible names.
- Dialogs take focus and close on Escape.
- A skip link and per-page titles.
- A text summary above the telemetry chart.
- Passing contrast: muted text `#8794bb` is 5.74:1 on cards and 4.53:1 on raised surfaces. The primary hover `#2a64cc` is 5.54:1 with white.
- The incident step tracker shows pending steps with a dashed border instead of reduced opacity, which had failed axe's contrast check.
- The backend workflow uses inline checkboxes for confirmations, so it adds no dialogs.

Remaining:

| Issue | Where |
| --- | --- |
| The Remove demo data confirmation is not modal: Tab can leave it | `OverviewPage.tsx` |
| A new incident updates the nav badge, which is not a live region, so a screen-reader user on another page is not told | `App.tsx` `IncidentNavBadge` |

## Evaluation by dimension

| Dimension | What works | What needs work |
| --- | --- | --- |
| Information hierarchy | The Overview opens with a lab-wide banner, live counts, then unit cards led by the reading, range, and status. The incident card puts the step tracker and the next action first, then the evidence and plan side by side. | The Overview does not show samples at risk; that count appears in the incident's plan. |
| Task clarity | Seven steps, each naming who acts ("Backend optimizer", "Responder", "Backend, one transaction"), and a "Next step" sentence for every state. Copy says exactly what each action does, for example "Planning is read-only; nothing moves". | Waits are not explained on screen: the first effect of a fault arrives on the next simulator reading, and risk takes about 30 seconds to return to low after a fault is cleared. |
| Trust and provenance | Each panel is tagged with its source: "backend · Isolation Forest", "backend · MILP optimizer" (or the fallback method actually used), "rule-based · derived locally", "Demo · simulated telemetry". The anomaly score is explained as a relative outlier score, not a probability. The acknowledgment text says identities are not recorded. | Several tags on one screen. Each is accurate; a single legend would reduce noise. |
| Accessibility | Severity always pairs color with an icon and text. Focus-visible outlines, reduced-motion support, live status regions, named controls, passing contrast, and no serious or critical axe violations on the checked pages. | Finding 5. |
| Error prevention | Removal needs a confirmation with exact counts and is refused while backend incident records reference demo units. Reset deletes nothing. Approval needs an explicit acceptance for partial plans. Execution needs a confirmation tick, and the backend refuses a second concurrent execution. Approval and execution are disabled for plans that would move samples outside the demo lab. | No warning before two incidents compete for the same space (finding 3). |
| Incident-response usability | The plan answers the operator's question: which sample goes where, the ranges involved, what cannot be placed and why, and the capacity before and after. Closed incidents keep their full record and audit trail. | Finding 2's infeasible case. Beyond the UI there is no paging, so someone must have the console open. |

## Fixed since the 16:34 screenshots

| Problem | Change |
| --- | --- |
| Times four hours ahead, reading age stuck at 0 s, staleness never triggered | Unmarked backend timestamps treated as UTC; shared 1 s clock; stale-only readings are a warning |
| Outdated or phantom incident evidence | Backend incidents with refreshed evidence; browser detection off in backend mode; caches reset on demo changes |
| Incident actions far below the guidance | Action and confirmation inside the "Next step" box |
| Partial rescues could not be closed | Backend partial and unresolved outcomes, with acknowledgment of unrescued samples |
| "Clear all" deleted every record with one click | "Remove demo data…" with a confirmation, limited to demo records |
| Fault toggles announced only "On" or "Off" | Named switches with descriptions |
| Overview notice said the work ran in the browser even in backend mode | Notice now describes the active mode |
| Muted text 3.57:1 on raised surfaces; primary hover 3.22:1 | New token values |

## Other findings

| Finding | Severity | Status |
| --- | --- | --- |
| Overview card badges come from browser rules, while the telemetry page also shows the backend risk level. They usually agree but can differ for a few seconds. | Low | Open, both labeled |
| Temperature formatting differs between views: "−74.7°C" on cards, "−86 to −70 °C" in plans | Low | Open |
| "(N ticks)" in the header is developer vocabulary | Low | Open |
| Incidents are now stored by the backend, so every responder sees the same record. Only the browser-only fallback keeps them in localStorage. | — | Resolved in backend mode |
| The Overview is checked for horizontal overflow at 390 px. No check covers the incident card at that width, although its two columns stack below 960 px. | Medium | Verify |

## Five-minute validation before recording

1. Keyboard only: Tab from the skip link to "Set up demo", open a unit, switch on "Hardware failure", then go through the incident to acknowledge, plan, approve, confirm, execute, record recovery, and close. Note where focus is lost.
2. Check every time on screen against the wall clock.
3. Confirm no incident opens before a fault is injected, on a fresh backend database.
4. At 390 px width, open an incident and confirm the evidence and plan stack vertically.
5. Check button hover and focus colors by eye; axe does not evaluate them.
