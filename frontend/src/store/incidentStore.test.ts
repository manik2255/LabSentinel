import { describe, expect, it, vi } from "vitest";
import { incidentStoreReducer, type StoreState } from "./incidentStore";
import type { Assessment } from "../domain/assessment";
import type { EquipmentRead } from "../api/types";

const assessment: Assessment = {
  source: "derived",
  method: "rules",
  severity: "critical",
  cause: "too warm",
  evidence: [],
  derived: [],
  unknowns: [],
  confidence: 0.8,
  strength: "moderate",
  recommendation: "move",
};

function eq(id: number): EquipmentRead {
  return {
    id,
    name: `Eq${id}`,
    type: "freezer",
    location: "lab",
    min_temperature: -80,
    max_temperature: -70,
    storage_capacity: 10,
    sample_limit: null,
    status: "offline",
    used_storage: 0,
    available_storage: 10,
    used_slots: 0,
    available_slots: null,
  };
}

const EMPTY: StoreState = { byId: {}, order: [], latched: [] };

function detect(state: StoreState, id: number, at: number): StoreState {
  return incidentStoreReducer(state, { type: "detect", equipment: eq(id), assessment, at });
}

describe("incidentStoreReducer", () => {
  it("keeps a single active incident per equipment", () => {
    const s = detect(detect(EMPTY, 1, 100), 1, 200);
    expect(s.order).toHaveLength(1);
  });

  it("latches a resolved unit and opens a new incident only after it re-arms", () => {
    let s = detect(EMPTY, 1, 100);
    const first = s.order[0]!;
    for (const action of [
      { type: "acknowledge" as const, by: "A", at: 101 },
      { type: "resolve" as const, at: 102, recovery: { ok: true, checks: [] } },
    ]) {
      s = incidentStoreReducer(s, { type: "dispatch", id: first, action });
    }
    expect(s.byId[first]!.state).toBe("resolved");
    expect(s.latched).toEqual([1]);

    // Still critical (e.g. after a page reload): no duplicate incident.
    expect(detect(s, 1, 200).order).toHaveLength(1);

    // Observed healthy -> re-armed -> a new failure opens a new incident.
    s = incidentStoreReducer(s, { type: "rearm", equipmentId: 1 });
    expect(s.latched).toEqual([]);
    s = detect(s, 1, 300);
    expect(s.order).toHaveLength(2);
    expect(s.byId[s.order[0]!]!.state).toBe("detected");
  });

  it("forgets the latch when the unit's records are removed", () => {
    const latched: StoreState = { ...EMPTY, latched: [1, 2] };
    const kept = incidentStoreReducer(latched, { type: "clearEquipment", equipmentIds: [1], keepResolved: true });
    expect(kept.latched).toEqual([1, 2]);
    const removed = incidentStoreReducer(latched, { type: "clearEquipment", equipmentIds: [1], keepResolved: false });
    expect(removed.latched).toEqual([2]);
  });

  it("rejects an illegal transition without changing state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = detect(EMPTY, 1, 100);
    const id = s.order[0]!;
    const next = incidentStoreReducer(s, {
      type: "dispatch",
      id,
      action: { type: "resolve", at: 1, recovery: { ok: true, checks: [] } },
    });
    expect(next).toBe(s);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("clearEquipment removes only the given units and can keep resolved history", () => {
    let s = detect(detect(EMPTY, 1, 100), 2, 100);
    const eq1 = s.order.find((id) => s.byId[id]!.equipmentId === 1)!;
    s = incidentStoreReducer(s, {
      type: "dispatch",
      id: eq1,
      action: { type: "acknowledge", by: "A", at: 101 },
    });
    s = incidentStoreReducer(s, {
      type: "dispatch",
      id: eq1,
      action: { type: "resolve", at: 102, recovery: { ok: true, checks: [] } },
    });
    s = detect(s, 1, 200); // new active incident on unit 1

    const kept = incidentStoreReducer(s, { type: "clearEquipment", equipmentIds: [1], keepResolved: true });
    expect(kept.order.map((id) => kept.byId[id]!.state).sort()).toEqual(["detected", "resolved"]);
    expect(kept.order.some((id) => kept.byId[id]!.equipmentId === 2)).toBe(true);

    const all = incidentStoreReducer(s, { type: "clearEquipment", equipmentIds: [1], keepResolved: false });
    expect(all.order.every((id) => all.byId[id]!.equipmentId === 2)).toBe(true);
  });
});
