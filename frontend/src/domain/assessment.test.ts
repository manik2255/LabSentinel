import { describe, expect, it } from "vitest";
import { assessIncident } from "./assessment";
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

describe("assessIncident", () => {
  it("reports normal operation at low severity with high confidence", () => {
    const a = assessIncident({ equipment: eq(), latestReading: reading(-75), now: NOW });
    expect(a.severity).toBe("none");
    expect(a.confidence).toBeGreaterThanOrEqual(0.85);
    expect(a.source).toBe("derived");
  });

  it("explains a too-warm excursion with traceable evidence", () => {
    const a = assessIncident({ equipment: eq(), latestReading: reading(-60), now: NOW });
    expect(a.severity).toBe("critical");
    expect(a.cause).toMatch(/exceeds/);
    expect(a.evidence.some((e) => e.label === "Latest reading")).toBe(true);
    expect(a.evidence.some((e) => e.label === "Allowed range")).toBe(true);
  });

  it("raises confidence on a sustained excursion", () => {
    const hist = [reading(-60, 1000), reading(-61, 6000), reading(-62, 11000)];
    const single = assessIncident({ equipment: eq(), latestReading: reading(-60), now: NOW });
    const sustained = assessIncident({
      equipment: eq(),
      latestReading: reading(-60),
      history: hist,
      now: NOW,
    });
    expect(sustained.confidence).toBeGreaterThan(single.confidence);
    const run = sustained.derived.find((e) => e.label === "Consecutive out-of-range readings");
    expect(run?.detail).toBe("3 of last 3");
  });

  it("is explicit and low-confidence when there is no data", () => {
    const a = assessIncident({ equipment: eq(), latestReading: NO_READINGS_YET, now: NOW });
    expect(a.cause).toMatch(/Insufficient data/);
    expect(a.confidence).toBeLessThan(0.3);
  });

  it("treats offline-with-no-data as critical", () => {
    const a = assessIncident({
      equipment: eq({ status: "offline" }),
      latestReading: NO_READINGS_YET,
      now: NOW,
    });
    expect(a.severity).toBe("critical");
  });

  it("flags stale in-range data as a warning with reduced evidence strength", () => {
    const a = assessIncident({
      equipment: eq(),
      latestReading: reading(-75, 60_000),
      now: NOW,
    });
    expect(a.severity).toBe("warning");
    expect(a.cause).toMatch(/stale/);
    expect(a.confidence).toBeLessThanOrEqual(0.6);
    expect(a.strength).toBe("limited");
    expect(a.unknowns.some((u) => /No reading for 60 s/.test(u))).toBe(true);
  });

  it("separates observed evidence from derived values", () => {
    const a = assessIncident({ equipment: eq(), latestReading: reading(-60), now: NOW });
    expect(a.evidence.map((e) => e.label)).toEqual([
      "Latest reading",
      "Recorded at",
      "Allowed range",
      "Reported status",
    ]);
    expect(a.derived.find((e) => e.label === "Above upper limit by")?.detail).toBe("10 °C");
  });

  it("never asserts a physical failure cause and states the method honestly", () => {
    const a = assessIncident({
      equipment: eq({ status: "offline" }),
      latestReading: reading(-20),
      now: NOW,
    });
    expect(a.severity).toBe("critical");
    expect(a.cause).not.toMatch(/hardware failure|compressor|power/i);
    expect(a.unknowns.some((u) => /physical cause/.test(u))).toBe(true);
    expect(a.method).toMatch(/No machine-learning anomaly model/);
  });

  it("is deterministic", () => {
    const a = assessIncident({ equipment: eq(), latestReading: reading(-60), now: NOW });
    const b = assessIncident({ equipment: eq(), latestReading: reading(-60), now: NOW });
    expect(a).toEqual(b);
  });
});
