/**
 * Demo-scope rules.
 *
 * The backend has no ownership, tagging, or authorization model, so the
 * frontend identifies the records it created itself: equipment whose name is
 * a seed name AND whose location carries DEMO_LOCATION_PREFIX, and seed-named
 * samples that sit inside such equipment.
 *
 * Every state-changing demo operation (fault injection, rescue execution,
 * reset, removal) checks these rules first. This prevents the demo from
 * accidentally modifying unrelated inventory. It is NOT a security control:
 * the backend accepts any request, so real protection needs backend
 * authorization.
 */

import { DEMO_LOCATION_PREFIX, SEED_EQUIPMENT, SEED_SAMPLES } from "../config";
import type { EquipmentRead, SampleRead } from "../api/types";
import type { RescuePlan } from "./rescue";

const DEMO_EQUIPMENT_NAMES: ReadonlySet<string> = new Set(
  SEED_EQUIPMENT.map((e) => e.name),
);
const DEMO_SAMPLE_NAMES: ReadonlySet<string> = new Set(
  SEED_SAMPLES.map((s) => s.name),
);

export function isDemoEquipment(
  e: Pick<EquipmentRead, "name" | "location"> | null | undefined,
): boolean {
  return (
    e != null &&
    e.location.startsWith(DEMO_LOCATION_PREFIX) &&
    DEMO_EQUIPMENT_NAMES.has(e.name)
  );
}

export function isDemoSample(
  s: Pick<SampleRead, "name" | "equipment_id">,
  equipmentById: ReadonlyMap<number, EquipmentRead>,
): boolean {
  return (
    DEMO_SAMPLE_NAMES.has(s.name) &&
    isDemoEquipment(equipmentById.get(s.equipment_id))
  );
}

export interface ExecutionScope {
  executable: boolean;
  /** Why execution is not allowed, when it is not. */
  reason: string | null;
}

/**
 * A rescue plan may be executed only when its source, every destination, and
 * every moved sample belong to the demo lab.
 */
export function checkPlanScope(plan: RescuePlan): ExecutionScope {
  if (!isDemoEquipment(plan.source)) {
    return {
      executable: false,
      reason: `${plan.source.name} is outside the demo lab. Moving real inventory needs backend-authorized execution, which the backend does not provide, so this plan is advisory only.`,
    };
  }
  for (const a of plan.allocations) {
    if (!isDemoEquipment(a.destination)) {
      return {
        executable: false,
        reason: `Destination ${a.destination.name} is outside the demo lab.`,
      };
    }
    if (
      !DEMO_SAMPLE_NAMES.has(a.sample.name) ||
      a.sample.equipment_id !== plan.source.id
    ) {
      return {
        executable: false,
        reason: `${a.sample.name} is not a demo sample stored in ${plan.source.name}.`,
      };
    }
  }
  return { executable: true, reason: null };
}

/** Name of the equipment a demo sample is seeded into, or null. */
export function demoHomeEquipmentName(sampleName: string): string | null {
  const seed = SEED_SAMPLES.find((s) => s.name === sampleName);
  if (!seed) return null;
  return SEED_EQUIPMENT[seed.equipmentIndex]?.name ?? null;
}

export interface DemoInventory {
  equipment: EquipmentRead[];
  samples: SampleRead[];
  /** Records the demo does not own; never modified by demo operations. */
  otherEquipmentCount: number;
  otherSampleCount: number;
}

export function demoInventory(
  equipment: EquipmentRead[],
  samples: SampleRead[],
): DemoInventory {
  const byId = new Map(equipment.map((e) => [e.id, e]));
  const demoEquipment = equipment.filter(isDemoEquipment);
  const demoSamples = samples.filter((s) => isDemoSample(s, byId));
  return {
    equipment: demoEquipment,
    samples: demoSamples,
    otherEquipmentCount: equipment.length - demoEquipment.length,
    otherSampleCount: samples.length - demoSamples.length,
  };
}

/**
 * Scope check for a backend-generated plan. The backend optimizer considers
 * every operational unit as a backup, so in a shared database a plan could
 * move demo samples into unrelated equipment. This console only approves or
 * executes plans whose source and every destination are demo units.
 */
export function checkBackendPlanScope(
  source: EquipmentRead | undefined,
  destinationIds: number[],
  equipmentById: ReadonlyMap<number, EquipmentRead>,
): ExecutionScope {
  if (!isDemoEquipment(source)) {
    return {
      executable: false,
      reason: `${source?.name ?? "This unit"} is outside the demo lab, so this console will not approve or execute its rescue.`,
    };
  }
  const outside = Array.from(new Set(destinationIds))
    .filter((id) => !isDemoEquipment(equipmentById.get(id)))
    .map((id) => equipmentById.get(id)?.name ?? `equipment #${id}`);
  if (outside.length > 0) {
    return {
      executable: false,
      reason: `The plan moves samples into equipment outside the demo lab (${outside.join(", ")}). Approval is disabled here to protect that inventory; run the demo on an isolated database.`,
    };
  }
  return { executable: true, reason: null };
}
