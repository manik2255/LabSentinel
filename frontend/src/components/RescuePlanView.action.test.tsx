import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RescuePlanView } from "./RescuePlanView";
import { planRescue } from "../domain/rescue";
import type { EquipmentRead, SampleRead } from "../api/types";

function makeEquipment(
  o: Partial<EquipmentRead> & { id: number },
): EquipmentRead {
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

function makeSample(o: Partial<SampleRead> & { id: number }): SampleRead {
  return {
    name: `S${o.id}`,
    equipment_id: 1,
    min_temperature: -80,
    max_temperature: -70,
    storage_space: 1,
    priority: "high",
    ...o,
  };
}

describe("RescuePlanView action summary", () => {
  it("labels the plan as a greedy heuristic", () => {
    const source = makeEquipment({ id: 1, name: "Freezer A", status: "offline" });
    const dest = makeEquipment({ id: 2, name: "Freezer B" });
    const plan = planRescue({
      source,
      samples: [makeSample({ id: 10, name: "Plasma" })],
      candidates: [source, dest],
    });
    render(<RescuePlanView plan={plan} />);
    expect(screen.getByText("greedy heuristic")).toBeInTheDocument();
  });

  it("summarizes manual intervention for a partial plan", () => {
    const source = makeEquipment({ id: 1, name: "Freezer A", status: "offline" });
    // Covers the freezer sample but not the fridge-range sample.
    const dest = makeEquipment({ id: 2, name: "Freezer B" });
    const plan = planRescue({
      source,
      samples: [
        makeSample({ id: 10, name: "Plasma" }),
        makeSample({
          id: 11,
          name: "Vaccine",
          min_temperature: 2,
          max_temperature: 8,
        }),
      ],
      candidates: [source, dest],
    });
    render(<RescuePlanView plan={plan} />);
    expect(plan.partial).toBe(true);
    expect(
      screen.getByText(/Freezer A.*need manual intervention/i),
    ).toBeInTheDocument();
  });
});
