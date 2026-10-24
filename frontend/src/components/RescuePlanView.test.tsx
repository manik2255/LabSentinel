import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RescuePlanView } from "./RescuePlanView";
import { planRescue } from "../domain/rescue";
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
    priority: "high",
    ...o,
  };
}

describe("RescuePlanView", () => {
  it("renders a full plan with an allocation and the derived-locally tag", () => {
    const source = eq({ id: 1, status: "offline" });
    const dest = eq({ id: 2 });
    const plan = planRescue({
      source,
      samples: [sample({ id: 10, name: "Plasma" })],
      candidates: [source, dest],
    });
    render(<RescuePlanView plan={plan} />);
    expect(screen.getByText("Full plan")).toBeInTheDocument();
    expect(screen.getByText("Plasma")).toBeInTheDocument();
    // "Eq2" appears both as the allocation destination and in the capacity
    // impact summary, which is expected.
    expect(screen.getAllByText("Eq2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("greedy heuristic")).toBeInTheDocument();
  });

  it("lists unplaceable samples with reasons", () => {
    const source = eq({ id: 1 });
    const fridge = eq({ id: 2, min_temperature: 2, max_temperature: 8 });
    const plan = planRescue({
      source,
      samples: [sample({ id: 10, name: "Frozen" })],
      candidates: [fridge],
    });
    render(<RescuePlanView plan={plan} />);
    expect(screen.getByText("Unplaceable samples")).toBeInTheDocument();
    expect(screen.getByText(/Frozen/)).toBeInTheDocument();
  });
});
