import { describe, expect, it } from "vitest";
import { planRescue } from "./rescue";
import type { EquipmentRead, SampleRead } from "../api/types";

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

function sample(o: Partial<SampleRead> & { id: number }): SampleRead {
  return {
    name: `S${o.id}`,
    equipment_id: 1,
    min_temperature: -80,
    max_temperature: -70,
    storage_space: 1,
    priority: "medium",
    ...o,
  };
}

describe("planRescue", () => {
  it("places compatible samples into a compatible destination", () => {
    const source = eq({ id: 1, status: "offline" });
    const dest = eq({ id: 2, available_storage: 40, available_slots: 20 });
    const samples = [sample({ id: 10, storage_space: 5 })];
    const plan = planRescue({ source, samples, candidates: [source, dest] });
    expect(plan.complete).toBe(true);
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]!.destination.id).toBe(2);
  });

  it("excludes the source and offline units as destinations", () => {
    const source = eq({ id: 1, status: "offline" });
    const offline = eq({ id: 2, status: "offline" });
    const samples = [sample({ id: 10 })];
    const plan = planRescue({ source, samples, candidates: [source, offline] });
    expect(plan.allocations).toHaveLength(0);
    expect(plan.unplaceable).toHaveLength(1);
  });

  it("marks a sample unplaceable when no range covers it", () => {
    const source = eq({ id: 1 });
    // dest is a fridge (2..8), sample needs -80..-70
    const dest = eq({ id: 2, min_temperature: 2, max_temperature: 8 });
    const samples = [sample({ id: 10 })];
    const plan = planRescue({ source, samples, candidates: [dest] });
    expect(plan.unplaceable).toHaveLength(1);
    expect(plan.unplaceable[0]!.reason).toMatch(/covers the required range|No backup unit covers/);
  });

  it("never exceeds a destination's cumulative storage", () => {
    const source = eq({ id: 1 });
    const dest = eq({
      id: 2,
      storage_capacity: 10,
      available_storage: 10,
      sample_limit: null,
      available_slots: null,
    });
    const samples = [
      sample({ id: 10, storage_space: 6, priority: "high" }),
      sample({ id: 11, storage_space: 6, priority: "high" }),
    ];
    const plan = planRescue({ source, samples, candidates: [dest] });
    // Only one 6-unit sample fits into 10 units of storage.
    expect(plan.allocations).toHaveLength(1);
    expect(plan.unplaceable).toHaveLength(1);
    expect(plan.partial).toBe(true);
    const impact = plan.impacts.find((i) => i.destination.id === 2)!;
    expect(impact.storageRemainingAfter).toBe(4);
  });

  it("respects slot limits cumulatively", () => {
    const source = eq({ id: 1 });
    const dest = eq({
      id: 2,
      storage_capacity: 100,
      available_storage: 100,
      sample_limit: 1,
      available_slots: 1,
    });
    const samples = [
      sample({ id: 10, storage_space: 1 }),
      sample({ id: 11, storage_space: 1 }),
    ];
    const plan = planRescue({ source, samples, candidates: [dest] });
    expect(plan.allocations).toHaveLength(1);
    expect(plan.unplaceable).toHaveLength(1);
  });

  it("processes higher-priority samples first", () => {
    const source = eq({ id: 1 });
    // Only room for one sample.
    const dest = eq({
      id: 2,
      storage_capacity: 5,
      available_storage: 5,
      sample_limit: null,
      available_slots: null,
    });
    const samples = [
      sample({ id: 10, storage_space: 5, priority: "low" }),
      sample({ id: 11, storage_space: 5, priority: "critical" }),
    ];
    const plan = planRescue({ source, samples, candidates: [dest] });
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]!.sample.id).toBe(11); // critical wins
  });

  it("prefers a tighter-fitting compatible range", () => {
    const source = eq({ id: 1 });
    const loose = eq({ id: 2, min_temperature: -120, max_temperature: -60 });
    const tight = eq({ id: 3, min_temperature: -82, max_temperature: -70 });
    const samples = [sample({ id: 10, min_temperature: -80, max_temperature: -70 })];
    const plan = planRescue({ source, samples, candidates: [loose, tight] });
    expect(plan.allocations[0]!.destination.id).toBe(3);
  });

  it("produces a fully infeasible plan when nothing fits", () => {
    const source = eq({ id: 1 });
    const full = eq({ id: 2, available_storage: 0, available_slots: 0 });
    const samples = [sample({ id: 10, storage_space: 3 })];
    const plan = planRescue({ source, samples, candidates: [full] });
    expect(plan.complete).toBe(false);
    expect(plan.partial).toBe(false);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.unplaceable).toHaveLength(1);
  });

  it("clamps negative available capacity for display safety", () => {
    const source = eq({ id: 1 });
    const weird = eq({ id: 2, available_storage: -5, available_slots: -1 });
    const samples = [sample({ id: 10, storage_space: 1 })];
    const plan = planRescue({ source, samples, candidates: [weird] });
    expect(plan.unplaceable).toHaveLength(1); // clamped to 0, nothing fits
  });

  it("is deterministic", () => {
    const source = eq({ id: 1 });
    const d1 = eq({ id: 2 });
    const d2 = eq({ id: 3 });
    const samples = [sample({ id: 10 }), sample({ id: 11 })];
    const a = planRescue({ source, samples, candidates: [d1, d2] });
    const b = planRescue({ source, samples, candidates: [d1, d2] });
    expect(a).toEqual(b);
  });
});

describe("planRescue — explainable capacity", () => {
  it("records the capacity each allocation was checked against", () => {
    const source = eq({ id: 1, status: "offline" });
    const dest = eq({ id: 2, available_storage: 10, available_slots: 3 });
    const plan = planRescue({
      source,
      samples: [
        sample({ id: 10, storage_space: 6, priority: "critical" }),
        sample({ id: 11, storage_space: 4, priority: "high" }),
      ],
      candidates: [dest],
    });
    expect(plan.allocations.map((a) => [a.storageFreeBefore, a.slotsFreeBefore])).toEqual([
      [10, 3],
      [4, 2],
    ]);
    expect(plan.impacts[0]!.storageRemainingAfter).toBe(0);
  });
});
