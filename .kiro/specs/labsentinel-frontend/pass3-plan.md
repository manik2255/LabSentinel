# Pass 3 — Final sprint plan (2026-10-24, deadline 20:00 ET)

## Verified facts (this pass)
- Branch `main` == `origin/main` (0403348). No teammate commits, no other remote branches.
- Live OpenAPI == snapshot: 12 paths, 12 schemas. No ML, alert, rescue, incident, approval, or report endpoints.
- Backend has no scikit-learn / Isolation Forest code. `Alert` model exists with no router.

## Confirmed defects to fix
1. SAFETY (P0): "Clear all" deletes every sample and equipment in whatever backend the UI points at.
   `scripts/verify-e2e.mjs` also deletes all records. Playwright reuses the working backend/DB.
2. SAFETY (P0): rescue execution and hardware-failure injection can mutate any equipment, not only demo data.
3. CORRECTNESS (P0): backend returns naive timestamps (`2026-10-24T20:34:26.819569`, no `Z`) because SQLite
   drops tzinfo. JS parses them as local time -> 4 h skew in Eastern. Chart/evidence times are wrong and
   reading age is clamped to 0, so staleness never triggers.
4. CORRECTNESS: once staleness works, stale = critical would raise incidents for every unit when the simulator
   stops. Reclassify stale-only as a warning ("Stale"); excursions/offline stay critical.
5. CORRECTNESS: nothing re-renders when polled data is unchanged, so ages/staleness freeze. Add a 1 s clock.
6. CORRECTNESS: incident id is `eq-<id>`; a resolved incident blocks any new incident on the same unit.
7. CORRECTNESS: recovery verification only checks planned samples, so a partial plan can "pass" while samples
   remain in the failed unit. Also an empty failed unit dead-ends (no plan, no verify).
8. ARCHITECTURE: detection runs only on the Incidents page (and duplicated on the detail page); nav badge is
   wrong elsewhere. Move to one lab-wide detector in App.
9. HCI/a11y: toggles announce only "On/Off"; dialog lacks Escape/focus return; two-column grids do not collapse
   on mobile; muted text ~4.5:1 (borderline); primary hover ~3.2:1; no per-page titles; no skip link.

## Order of work
1. Safety scoping + E2E isolation (disposable DB, port 8078/3000) + scoped verify script.
2. Timestamp normalization, stale reclassification, clock, incident id/recovery fixes, lab-wide detection.
3. Gate (tsc, vitest, build, Playwright) -> commit on `feature/frontend-console` -> push -> verify remote.
4. HCI: incident stepper/next step, rescue plan clarity, assessment structure, a11y fixes, axe check.
5. README, demo walkthrough, Kiro summary -> commit -> push.
