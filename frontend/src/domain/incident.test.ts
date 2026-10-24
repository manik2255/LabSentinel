import { describe, expect, it } from "vitest";
import {
  createIncident,
  incidentReducer,
  InvalidTransitionError,
  verifyRecovery,
  type Incident,
} from "./incident";
import type { Assessment } from "./assessment";
import type { EquipmentRead, SampleRead } from "../api/types";

const assessment: Assessment = {
  source: "derived",
  method: "rules",
  severity: "critical",
  cause: "too warm",
  evidence: [],
  derived: [],
  unknowns: [],
  confidence: 0.9,
  strength: "strong",
  recommendation: "move",
};

function eq(o: Partial<EquipmentRead> & { id: number }): EquipmentRead {
  return {
    name: `Eq${o.id}`,
    type: "freezer",
    location: "lab",
    min_temperature: -80,
    max_temperature: -70,
    storage_capacity: 40,
    sample_limit: 20,
    status: "operational",
    used_storage: 0,
    available_storage: 40,
    used_slots: 0,
    available_slots: 20,
    ...o,
  };
}

function base(): Incident {
  return createIncident({ id: "i1", equipment: eq({ id: 1 }), assessment, at: 0 });
}

const okRecovery = { ok: true, checks: [{ sampleId: 1, sampleName: "s", ok: true, detail: "" }] };

describe("incidentReducer transitions", () => {
  it("follows the happy path detected->acknowledged->executing->executed->resolved", () => {
    let inc = base();
    inc = incidentReducer(inc, { type: "acknowledge", by: "Alex", at: 1 });
    expect(inc.state).toBe("acknowledged");
    expect(inc.acknowledgedBy).toBe("Alex");
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    expect(inc.state).toBe("executing");
    inc = incidentReducer(inc, { type: "executed", at: 3 });
    expect(inc.state).toBe("executed");
    inc = incidentReducer(inc, { type: "resolve", at: 4, recovery: okRecovery });
    expect(inc.state).toBe("resolved");
    expect(inc.timeline.map((t) => t.state)).toEqual([
      "detected",
      "acknowledged",
      "executing",
      "executed",
      "resolved",
    ]);
  });

  it("rejects resolving an un-acknowledged incident", () => {
    const inc = base();
    expect(() => incidentReducer(inc, { type: "resolve", at: 1, recovery: okRecovery })).toThrow(
      InvalidTransitionError,
    );
  });

  it("rejects acknowledging twice (executing not allowed from acknowledged via acknowledge)", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    expect(() => incidentReducer(inc, { type: "acknowledge", by: "B", at: 2 })).toThrow(
      InvalidTransitionError,
    );
  });

  it("refuses to resolve when recovery failed", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    inc = incidentReducer(inc, { type: "executed", at: 3 });
    expect(() =>
      incidentReducer(inc, {
        type: "resolve",
        at: 4,
        recovery: { ok: false, checks: [] },
      }),
    ).toThrow(/recovery verification failed/);
  });

  it("re-opens to acknowledged after a failed recovery so the operator can re-plan", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    inc = incidentReducer(inc, { type: "executed", at: 3 });
    inc = incidentReducer(inc, { type: "reopen", at: 4 });
    expect(inc.state).toBe("acknowledged");
    // The operator can proceed again — the dead-end is gone.
    inc = incidentReducer(inc, { type: "beginExecution", at: 5 });
    expect(inc.state).toBe("executing");
  });

  it("recordRecovery stores a failed recovery without changing state", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    inc = incidentReducer(inc, { type: "executed", at: 3 });
    inc = incidentReducer(inc, {
      type: "recordRecovery",
      at: 5,
      recovery: {
        ok: false,
        checks: [{ sampleId: 1, sampleName: "s", ok: false, detail: "nope" }],
      },
    });
    expect(inc.state).toBe("executed");
    expect(inc.recovery?.ok).toBe(false);
    expect(inc.recovery?.checks[0]!.detail).toBe("nope");
  });

  it("full re-plan loop: executed -> recordRecovery(fail) -> reopen -> acknowledged -> executing -> executed -> resolve", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    inc = incidentReducer(inc, { type: "executed", at: 3 });
    inc = incidentReducer(inc, {
      type: "recordRecovery",
      at: 4,
      recovery: {
        ok: false,
        checks: [{ sampleId: 1, sampleName: "s", ok: false, detail: "nope" }],
      },
    });
    inc = incidentReducer(inc, { type: "reopen", at: 5 });
    expect(inc.state).toBe("acknowledged");
    inc = incidentReducer(inc, { type: "beginExecution", at: 6 });
    inc = incidentReducer(inc, { type: "executed", at: 7 });
    inc = incidentReducer(inc, {
      type: "resolve",
      at: 8,
      recovery: { ok: true, checks: [{ sampleId: 1, sampleName: "s", ok: true, detail: "ok" }] },
    });
    expect(inc.state).toBe("resolved");
    const acknowledgedCount = inc.timeline.filter((t) => t.state === "acknowledged").length;
    expect(acknowledgedCount).toBeGreaterThanOrEqual(2);
  });
});

describe("verifyRecovery", () => {
  const failedId = 1;

  it("passes when samples are in compatible non-offline equipment", () => {
    const dest = eq({ id: 2 });
    const samples: SampleRead[] = [
      { id: 10, name: "s10", equipment_id: 2, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "high" },
    ];
    const r = verifyRecovery([10], samples, new Map([[2, dest]]), failedId);
    expect(r.ok).toBe(true);
  });

  it("fails when a sample is still in the failed equipment", () => {
    const samples: SampleRead[] = [
      { id: 10, name: "s10", equipment_id: 1, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "high" },
    ];
    const r = verifyRecovery([10], samples, new Map([[1, eq({ id: 1, status: "offline" })]]), failedId);
    expect(r.ok).toBe(false);
    expect(r.checks[0]!.detail).toMatch(/failed equipment/);
  });

  it("fails when destination range does not cover the sample", () => {
    const dest = eq({ id: 2, min_temperature: 2, max_temperature: 8 });
    const samples: SampleRead[] = [
      { id: 10, name: "s10", equipment_id: 2, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "high" },
    ];
    const r = verifyRecovery([10], samples, new Map([[2, dest]]), failedId);
    expect(r.ok).toBe(false);
  });

  it("fails when destination is offline", () => {
    const dest = eq({ id: 2, status: "offline" });
    const samples: SampleRead[] = [
      { id: 10, name: "s10", equipment_id: 2, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "high" },
    ];
    const r = verifyRecovery([10], samples, new Map([[2, dest]]), failedId);
    expect(r.ok).toBe(false);
    expect(r.checks[0]!.detail).toMatch(/offline/);
  });
});

describe("incidentReducer — pass 3 guards", () => {
  function executed(): Incident {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    return incidentReducer(inc, { type: "executed", at: 3 });
  }

  it("acknowledge is only allowed from detected", () => {
    expect(() => incidentReducer(executed(), { type: "acknowledge", by: "B", at: 4 })).toThrow(
      InvalidTransitionError,
    );
  });

  it("abortExecution returns executing to acknowledged without recording a rescue", () => {
    let inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    inc = incidentReducer(inc, { type: "beginExecution", at: 2 });
    inc = incidentReducer(inc, { type: "abortExecution", at: 3, note: "no samples moved" });
    expect(inc.state).toBe("acknowledged");
    expect(inc.timeline.some((t) => t.state === "executed")).toBe(false);
    expect(() => incidentReducer(inc, { type: "abortExecution", at: 4 })).toThrow(
      InvalidTransitionError,
    );
  });

  it("reopen is only allowed from executed", () => {
    const inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    expect(() => incidentReducer(inc, { type: "reopen", at: 2 })).toThrow(InvalidTransitionError);
  });

  it("resolves from acknowledged when the recovery check passes (nothing to relocate)", () => {
    const inc = incidentReducer(base(), { type: "acknowledge", by: "A", at: 1 });
    const resolved = incidentReducer(inc, {
      type: "resolve",
      at: 2,
      recovery: { ok: true, checks: [] },
    });
    expect(resolved.state).toBe("resolved");
  });

  it("still refuses to resolve from detected", () => {
    expect(() =>
      incidentReducer(base(), { type: "resolve", at: 1, recovery: { ok: true, checks: [] } }),
    ).toThrow(InvalidTransitionError);
  });
});

describe("verifyRecovery — partial rescues and empty units", () => {
  it("fails while an unplanned sample is still in the failed unit", () => {
    const dest = eq({ id: 2 });
    const failed = eq({ id: 1, status: "offline" });
    const samples: SampleRead[] = [
      { id: 10, name: "moved", equipment_id: 2, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "high" },
      { id: 11, name: "stranded", equipment_id: 1, min_temperature: -80, max_temperature: -70, storage_space: 1, priority: "low" },
    ];
    // Caller includes the planned sample (10) and every sample still in the source (11).
    const r = verifyRecovery([10, 11], samples, new Map([[1, failed], [2, dest]]), 1);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.sampleId === 11)?.detail).toMatch(/failed equipment/);
  });

  it("passes when there was nothing to relocate", () => {
    const r = verifyRecovery([], [], new Map(), 1);
    expect(r).toEqual({ ok: true, checks: [] });
  });
});
