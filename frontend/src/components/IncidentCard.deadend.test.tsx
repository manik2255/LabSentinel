import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncidentCard } from "./IncidentCard";
import { IncidentProvider } from "../store/incidentStore";
import type { Incident } from "../domain/incident";
import type { Assessment } from "../domain/assessment";
import type { EquipmentRead, SampleRead } from "../api/types";
import { DEMO_LOCATION_PREFIX } from "../config";

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

function assessment(): Assessment {
  return {
    source: "derived",
    method: "Deterministic threshold rules.",
    severity: "critical",
    cause: "Eq1 is reported offline; its latest reading is -20 °C.",
    evidence: [{ label: "Reported status", detail: "offline" }],
    derived: [],
    unknowns: ["The physical cause cannot be determined from temperature data alone."],
    confidence: 0.85,
    strength: "moderate",
    recommendation: "Review the rescue plan and relocate samples to compatible storage.",
  };
}

/** Demo-owned equipment and samples (seed names + demo location prefix). */
function demoEq(o: Partial<EquipmentRead> & { id: number; name: string }): EquipmentRead {
  return eq({ location: `${DEMO_LOCATION_PREFIX}Cold Room 1`, ...o });
}

function renderCard(props: {
  incident: Incident;
  equipment: EquipmentRead | undefined;
  samplesBySource: SampleRead[];
  allEquipment: EquipmentRead[];
  allSamples: SampleRead[];
}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <IncidentProvider>
        <IncidentCard
          incident={props.incident}
          equipment={props.equipment}
          samplesBySource={props.samplesBySource}
          allEquipment={props.allEquipment}
          allSamples={props.allSamples}
        />
      </IncidentProvider>
    </QueryClientProvider>,
  );
}

describe("IncidentCard reopen dead-end", () => {
  it("keeps Verify actionable when a failed-recovery incident reopened to acknowledged with an empty re-plan", () => {
    // The failed (offline) source. samplesBySource is empty because the
    // samples have already been moved out, so planRescue yields no allocations
    // and canExecute is false.
    const equipment = eq({ id: 1, status: "offline" });

    const incident: Incident = {
      id: "eq-1",
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      state: "acknowledged",
      assessment: assessment(),
      plan: null,
      acknowledgedBy: "test",
      recovery: {
        ok: false,
        checks: [
          {
            sampleId: 10,
            sampleName: "Plasma",
            ok: false,
            detail: "destination offline",
          },
        ],
      },
      timeline: [
        { state: "detected", at: 0 },
        { state: "acknowledged", at: 1 },
      ],
    };

    renderCard({
      incident,
      equipment,
      samplesBySource: [],
      // One operational candidate present; with no samples the plan is still empty.
      allEquipment: [equipment, eq({ id: 2 })],
      allSamples: [],
    });

    // 1. Verify recovery is available — the operator is NOT stranded.
    const verify = screen.getByRole("button", { name: "Verify recovery" });
    expect(verify).toBeEnabled();

    // 2. Execute rescue is disabled because the re-plan has no allocations.
    expect(
      screen.getByRole("button", { name: /Execute rescue/ }),
    ).toBeDisabled();

    // 3. Acknowledge is disabled because we are not in "detected".
    expect(
      screen.getByRole("button", { name: "Acknowledge" }),
    ).toBeDisabled();
  });

  it("disables Verify for a normal acknowledged incident (no recovery) while Execute is enabled with a non-empty plan", async () => {
    const user = userEvent.setup();

    // Execution is only possible inside the demo lab, so use demo-owned
    // records: seed names plus the demo location prefix.
    const source = demoEq({ id: 1, name: "Ultra-Low Freezer A", status: "offline" });
    const candidate = demoEq({ id: 2, name: "Ultra-Low Freezer B" });
    // A sample still sitting in the failed source; candidate id 2 covers its
    // range and has capacity, so planRescue produces a non-empty plan.
    const strandedSample = sample({
      id: 10,
      name: "Patient Plasma Lot P-101",
      equipment_id: 1,
    });

    const incident: Incident = {
      id: "eq-1",
      equipmentId: source.id,
      equipmentName: source.name,
      state: "acknowledged",
      assessment: assessment(),
      plan: null,
      acknowledgedBy: "test",
      recovery: null,
      timeline: [
        { state: "detected", at: 0 },
        { state: "acknowledged", at: 1 },
      ],
    };

    renderCard({
      incident,
      equipment: source,
      samplesBySource: [strandedSample],
      allEquipment: [source, candidate],
      allSamples: [strandedSample],
    });

    // Verify is only for executed or reopened-failed incidents — disabled here.
    const verify = screen.getByRole("button", { name: "Verify recovery" });
    expect(verify).toBeDisabled();

    // Execute rescue is enabled: non-empty plan + acknowledged state.
    const execute = screen.getByRole("button", { name: /Execute rescue/ });
    expect(execute).toBeEnabled();

    // A disabled Verify button does not respond to interaction.
    await user.click(verify);
    expect(
      screen.queryByText(/Recovery verification/),
    ).not.toBeInTheDocument();
  });
});

describe("IncidentCard safety and human confirmation", () => {
  function acknowledged(source: EquipmentRead): Incident {
    return {
      id: "eq-1",
      equipmentId: source.id,
      equipmentName: source.name,
      state: "acknowledged",
      assessment: assessment(),
      plan: null,
      acknowledgedBy: "test",
      recovery: null,
      timeline: [
        { state: "detected", at: 0 },
        { state: "acknowledged", at: 1 },
      ],
    };
  }

  it("keeps a plan for equipment outside the demo lab advisory only", () => {
    const source = eq({ id: 1, name: "Teammate Freezer", status: "offline" });
    const candidate = eq({ id: 2, name: "Teammate Backup" });
    const s = sample({ id: 10, name: "Real biopsy", equipment_id: 1 });
    renderCard({
      incident: acknowledged(source),
      equipment: source,
      samplesBySource: [s],
      allEquipment: [source, candidate],
      allSamples: [s],
    });
    // The proposal is shown, but it cannot be executed from this console.
    expect(screen.getByText("advisory only")).toBeInTheDocument();
    expect(screen.getByText("Real biopsy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Execute rescue/ })).toBeDisabled();
  });

  it("asks for confirmation, and Escape cancels without sending any move", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = demoEq({ id: 1, name: "Ultra-Low Freezer A", status: "offline" });
    const candidate = demoEq({ id: 2, name: "Ultra-Low Freezer B" });
    const s = sample({ id: 10, name: "Patient Plasma Lot P-101", equipment_id: 1 });
    renderCard({
      incident: acknowledged(source),
      equipment: source,
      samplesBySource: [s],
      allEquipment: [source, candidate],
      allSamples: [s],
    });

    const execute = screen.getByRole("button", { name: /Execute rescue/ });
    await user.click(execute);
    const dialog = screen.getByRole("alertdialog", { name: /Execute rescue in the demo environment/ });
    expect(dialog).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(execute).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
