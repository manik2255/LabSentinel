---
inclusion: manual
---

# LabSentinel Frontend — Architecture Decision Records

A record of the significant architecture decisions behind the LabSentinel
frontend, each with its context, the decision taken, and the consequences.

## ADR-1 — Frontend-derived AI / rescue / incident logic

**Context:** The backend exposes only equipment, samples, simulation, and
monitoring endpoints. There are no AI, rescue, incident, or alert endpoints.

**Decision:** Implement assessment, rescue planning, and incident lifecycle as
clearly-labeled client-side logic behind an adapter boundary. Never present
these as backend-verified.

**Consequences:** An honest demo. A future backend can take over at the adapter
boundary without reworking the UI. Incident state is NOT persisted server-side —
it lives in client memory and is lost on reload.

## ADR-2 — Rescue planner is a greedy heuristic

**Context:** Optimal multi-constraint assignment is a bin-packing-like problem.

**Decision:** Use a priority-first greedy algorithm with a cumulative capacity
ledger and tightest-fit scoring. Mirror the backend's real placement rule so
executed moves pass server validation.

**Consequences:** Always sound (property-tested across 300 seeds) but not
globally optimal (there is a documented shortfall case). The UI labels it
"greedy heuristic". Executed moves are re-validated by the backend.

## ADR-3 — Rescue execution is a labeled demo action

**Context:** Executing moves issues real `PATCH /api/samples` requests against
the demo DB, and no backend authorization exists.

**Decision:** Require a deliberate confirmation dialog, label it "simulated
execution", and restrict it to synthetic demo inventory.

**Consequences:** Safe for the hackathon. A real deployment must add
backend-authoritative validation and authorization before any live inventory
change. Do NOT rely on disabled buttons as a security control.

## ADR-4 — Assessment confidence is a heuristic score

**Context:** The number is a rule-based evidence strength, not a trained
probability.

**Decision:** Label it "Evidence strength" with a "not a calibrated
probability" note.

**Consequences:** No misleading ML / probability claim.

## ADR-5 — Polling over streaming

**Context:** Backend monitoring is poll-only — no WebSocket or SSE.

**Decision:** Use React Query `refetchInterval` for all live data.

**Consequences:** Simple, with no manual timers to leak. Latency is bounded by
the poll interval.
