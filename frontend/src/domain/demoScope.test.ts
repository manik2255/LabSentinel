import { describe, expect, it } from "vitest";
import {
  checkPlanScope,
  demoHomeEquipmentName,
  demoInventory,
  isDemoEquipment,
  isDemoSample,
} from "./demoScope";
import { planRescue } from "./rescue";
import { DEMO_LOCATION_PREFIX } from "../config";
import type { EquipmentRead, SampleRead } from "../api/types";

function eq(o: Partial<EquipmentRead> & { id: number }): EquipmentRead {
  return {
    name: "Ultra-Low Freezer A",
    type: "freezer",
    location: `${DEMO_LOCATION_PREFIX}Cold Room 1`,
    min_temperature: -86,
    max_temperature: -65,
    storage_capacity: 60,
    sample_limit: 30,
    status: "operational",
    used_storage: 0,
    available_storage: 60,
    used_slots: 0,
    available_slots: 30,
    ...o,
  };
}

function sample(o: Partial<SampleRead> & { id: number }): SampleRead {
  return {
    name: "Patient Plasma Lot P-101",
    equipment_id: 1,
    min_temperature: -86,
    max_temperature: -70,
    storage_space: 8,
    priority: "critical",
    ...o,
  };
}

describe("isDemoEquipment", () => {
  it("requires both the demo location prefix and a seed name", () => {
    expect(isDemoEquipment(eq({ id: 1 }))).toBe(true);
    expect(isDemoEquipment(eq({ id: 1, location: "Cold Room 1" }))).toBe(false);
    expect(isDemoEquipment(eq({ id: 1, name: "Teammate Freezer" }))).toBe(false);
    expect(isDemoEquipment(undefined)).toBe(false);
  });
});

describe("isDemoSample", () => {
  it("requires a seed name inside demo equipment", () => {
    const demo = eq({ id: 1 });
    const real = eq({ id: 2, location: "Building 4" });
    const byId = new Map([
      [1, demo],
      [2, real],
    ]);
    expect(isDemoSample(sample({ id: 10 }), byId)).toBe(true);
    expect(isDemoSample(sample({ id: 11, equipment_id: 2 }), byId)).toBe(false);
    expect(isDemoSample(sample({ id: 12, name: "Real biopsy" }), byId)).toBe(false);
  });
});

describe("checkPlanScope", () => {
  const source = eq({ id: 1, status: "offline" });
  const demoDest = eq({ id: 2, name: "Ultra-Low Freezer B" });
  const realDest = eq({ id: 3, name: "Ultra-Low Freezer B", location: "Building 4" });

  it("allows a plan that stays inside the demo lab", () => {
    const plan = planRescue({
      source,
      samples: [sample({ id: 10 })],
      candidates: [demoDest],
    });
    expect(checkPlanScope(plan)).toEqual({ executable: true, reason: null });
  });

  it("blocks a plan whose destination is outside the demo lab", () => {
    const plan = planRescue({
      source,
      samples: [sample({ id: 10 })],
      candidates: [realDest],
    });
    const scope = checkPlanScope(plan);
    expect(scope.executable).toBe(false);
    expect(scope.reason).toMatch(/outside the demo lab/);
  });

  it("blocks a plan for a non-demo source as advisory only", () => {
    const realSource = eq({ id: 4, location: "Building 4", status: "offline" });
    const plan = planRescue({
      source: realSource,
      samples: [sample({ id: 10, equipment_id: 4 })],
      candidates: [demoDest],
    });
    const scope = checkPlanScope(plan);
    expect(scope.executable).toBe(false);
    expect(scope.reason).toMatch(/advisory only/);
  });

  it("blocks a plan that would move a non-demo sample", () => {
    const plan = planRescue({
      source,
      samples: [sample({ id: 10, name: "Real biopsy" })],
      candidates: [demoDest],
    });
    expect(checkPlanScope(plan).executable).toBe(false);
  });
});

describe("demoInventory", () => {
  it("separates demo records from other inventory", () => {
    const demo = eq({ id: 1 });
    const real = eq({ id: 2, name: "Teammate Freezer", location: "Building 4" });
    const inv = demoInventory(
      [demo, real],
      [sample({ id: 10 }), sample({ id: 11, name: "Real biopsy", equipment_id: 2 })],
    );
    expect(inv.equipment.map((e) => e.id)).toEqual([1]);
    expect(inv.samples.map((s) => s.id)).toEqual([10]);
    expect(inv.otherEquipmentCount).toBe(1);
    expect(inv.otherSampleCount).toBe(1);
  });
});

describe("demoHomeEquipmentName", () => {
  it("maps a seed sample to its seeded equipment", () => {
    expect(demoHomeEquipmentName("Patient Plasma Lot P-101")).toBe("Ultra-Low Freezer A");
    expect(demoHomeEquipmentName("Unknown")).toBeNull();
  });
});
