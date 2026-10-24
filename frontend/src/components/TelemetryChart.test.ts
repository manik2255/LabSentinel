import { describe, expect, it } from "vitest";
import { toChartPoints } from "./TelemetryChart";
import type { SensorReadingRead } from "../api/types";

function r(id: number, t: string, temperature: number): SensorReadingRead {
  return { id, equipment_id: 1, temperature, timestamp: t };
}

describe("toChartPoints", () => {
  it("orders newest-first history chronologically and flags excursions", () => {
    const pts = toChartPoints(
      [r(2, "2026-10-24T20:00:03Z", -60), r(1, "2026-10-24T20:00:00Z", -75)],
      -80,
      -70,
    );
    expect(pts.map((p) => p.temperature)).toEqual([-75, -60]);
    expect(pts.map((p) => p.outOfRange)).toEqual([false, true]);
  });

  it("inserts a break instead of interpolating across a long gap", () => {
    const pts = toChartPoints(
      [r(2, "2026-10-24T20:05:00Z", -75), r(1, "2026-10-24T20:00:00Z", -75)],
      -80,
      -70,
      15_000,
    );
    expect(pts).toHaveLength(3);
    expect(pts[1]!.temperature).toBeNull();
  });
});
