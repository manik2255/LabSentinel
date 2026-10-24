import { describe, expect, it } from "vitest";
import { classifyEquipment, isIncident } from "./detection";
import { NO_READINGS_YET } from "../api/client";
import type { EquipmentRead, SensorReadingRead } from "../api/types";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function eq(overrides: Partial<EquipmentRead> = {}): EquipmentRead {
  return {
    id: 1,
    name: "Freezer A",
    type: "freezer",
    location: "Cold Room",
    min_temperature: -80,
    max_temperature: -70,
    storage_capacity: 40,
    sample_limit: 20,
    status: "operational",
    used_storage: 0,
    available_storage: 40,
    used_slots: 0,
    available_slots: 20,
    ...overrides,
  };
}

function reading(temp: number, ageMs = 1000): SensorReadingRead {
  return {
    id: 1,
    equipment_id: 1,
    temperature: temp,
    timestamp: new Date(NOW - ageMs).toISOString(),
  };
}

describe("classifyEquipment", () => {
  it("is ok for a mid-range fresh reading", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-75), now: NOW });
    expect(c.health).toBe("ok");
    expect(c.isStale).toBe(false);
  });

  it("is critical when above max", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-60), now: NOW });
    expect(c.health).toBe("critical");
    expect(c.reasons.some((r) => r.code === "above_max")).toBe(true);
    expect(isIncident(c)).toBe(true);
  });

  it("is critical when below min", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-90), now: NOW });
    expect(c.health).toBe("critical");
    expect(c.reasons.some((r) => r.code === "below_min")).toBe(true);
  });

  it("is warning when near the upper bound", () => {
    // span 10, margin 1 -> within [-71,-70] warns
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-70.5), now: NOW });
    expect(c.health).toBe("warning");
    expect(c.reasons.some((r) => r.code === "near_max")).toBe(true);
  });

  it("is warning when near the lower bound", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-79.5), now: NOW });
    expect(c.health).toBe("warning");
    expect(c.reasons.some((r) => r.code === "near_min")).toBe(true);
  });

  it("marks a stale in-range reading as a warning, not an incident", () => {
    const c = classifyEquipment({
      equipment: eq(),
      latestReading: reading(-75, 60_000),
      now: NOW,
    });
    expect(c.isStale).toBe(true);
    expect(c.health).toBe("warning");
    expect(c.reasons[0]?.code).toBe("stale");
    expect(isIncident(c)).toBe(false);
  });

  it("keeps a stale out-of-range reading critical and lists the excursion first", () => {
    const c = classifyEquipment({
      equipment: eq(),
      latestReading: reading(-60, 60_000),
      now: NOW,
    });
    expect(c.health).toBe("critical");
    expect(c.reasons.map((r) => r.code)).toEqual(["above_max", "stale"]);
  });

  it("is critical when offline regardless of reading", () => {
    const c = classifyEquipment({
      equipment: eq({ status: "offline" }),
      latestReading: reading(-75),
      now: NOW,
    });
    expect(c.health).toBe("critical");
    expect(c.reasons.some((r) => r.code === "offline")).toBe(true);
  });

  it("is unknown with no readings (and not offline)", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: NO_READINGS_YET, now: NOW });
    expect(c.health).toBe("unknown");
    expect(c.reasons.some((r) => r.code === "no_data")).toBe(true);
    expect(c.ageMs).toBeNull();
  });

  it("is deterministic for identical inputs", () => {
    const a = classifyEquipment({ equipment: eq(), latestReading: reading(-60), now: NOW });
    const b = classifyEquipment({ equipment: eq(), latestReading: reading(-60), now: NOW });
    expect(a).toEqual(b);
  });

  it("attaches exact numeric facts to an excursion", () => {
    const c = classifyEquipment({ equipment: eq(), latestReading: reading(-60), now: NOW });
    const r = c.reasons.find((x) => x.code === "above_max");
    expect(r?.facts?.exceedBy).toBeCloseTo(10, 5);
  });
});
