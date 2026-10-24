/**
 * Pure rescue-planning logic.
 *
 * Given a source equipment at risk, its samples, and candidate destinations,
 * computes a proposal that relocates samples to compatible backup storage.
 *
 * Placement rules intentionally mirror the backend's `_check_placement`
 * (backend/app/crud/sample.py): a destination's temperature range must FULLY
 * cover the sample's required range, there must be enough available storage,
 * and a free slot when the destination is slot-limited. Allocations are
 * cumulative — a mutable per-destination ledger ensures the whole plan never
 * exceeds real remaining capacity.
 *
 * Frontend-derived: the backend has no rescue endpoint. Executing the plan
 * issues real `PATCH /api/samples/{id}` moves, each re-validated server-side.
 */

import type { EquipmentRead, Priority, SampleRead } from "../api/types";

export type { Priority };

const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function priorityRank(p: string): number {
  return PRIORITY_RANK[p] ?? 0;
}

export interface Allocation {
  sample: SampleRead;
  destination: EquipmentRead;
  /** Destination storage still free when this sample was assigned. */
  storageFreeBefore: number;
  /** Destination slots still free when assigned; null = unlimited. */
  slotsFreeBefore: number | null;
  /** Why this destination was chosen, for the explainable UI. */
  rationale: string;
}

export interface Unplaceable {
  sample: SampleRead;
  reason: string;
}

export interface DestinationImpact {
  destination: EquipmentRead;
  assignedSampleIds: number[];
  storageUsedByPlan: number;
  storageRemainingAfter: number;
  slotsUsedByPlan: number;
  slotsRemainingAfter: number | null;
}

export interface RescuePlan {
  source: EquipmentRead;
  allocations: Allocation[];
  unplaceable: Unplaceable[];
  impacts: DestinationImpact[];
  /** True when every sample found a home. */
  complete: boolean;
  /** True when at least one, but not all, samples were placed. */
  partial: boolean;
}

interface Ledger {
  equipment: EquipmentRead;
  storageRemaining: number;
  slotsRemaining: number | null;
  assigned: number[];
}

function isUsableDestination(
  candidate: EquipmentRead,
  sourceId: number,
): boolean {
  if (candidate.id === sourceId) return false;
  // Exclude offline/failed units as destinations (Req 5.3).
  if (candidate.status === "offline") return false;
  return true;
}

function covers(dest: EquipmentRead, sample: SampleRead): boolean {
  return (
    dest.min_temperature <= sample.min_temperature &&
    dest.max_temperature >= sample.max_temperature
  );
}

/**
 * Lower is better. Prefer a tighter temperature fit (less wasted headroom),
 * then more free storage (so we spread load and keep options open).
 */
function scoreDestination(ledger: Ledger, sample: SampleRead): number {
  const dest = ledger.equipment;
  const rangeSlack =
    sample.min_temperature -
    dest.min_temperature +
    (dest.max_temperature - sample.max_temperature);
  // Tie-break toward more remaining storage (negative => lower score).
  return rangeSlack * 1000 - ledger.storageRemaining;
}

export interface PlanRescueInput {
  source: EquipmentRead;
  samples: SampleRead[];
  candidates: EquipmentRead[];
}

export function planRescue(input: PlanRescueInput): RescuePlan {
  const { source, samples, candidates } = input;

  // Build mutable ledgers from real, clamped remaining capacity.
  const ledgers: Ledger[] = candidates
    .filter((c) => isUsableDestination(c, source.id))
    .map((c) => ({
      equipment: c,
      storageRemaining: Math.max(0, c.available_storage),
      slotsRemaining:
        c.available_slots == null ? null : Math.max(0, c.available_slots),
      assigned: [],
    }));

  // Process higher-priority samples first; stable tiebreak by larger storage
  // (harder to place) then id for determinism.
  const ordered = [...samples].sort((a, b) => {
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    if (b.storage_space !== a.storage_space)
      return b.storage_space - a.storage_space;
    return a.id - b.id;
  });

  const allocations: Allocation[] = [];
  const unplaceable: Unplaceable[] = [];

  for (const sample of ordered) {
    // Find all currently-feasible destinations given the running ledger.
    const feasible = ledgers.filter((l) => {
      if (!covers(l.equipment, sample)) return false;
      if (l.storageRemaining < sample.storage_space) return false;
      if (l.slotsRemaining != null && l.slotsRemaining < 1) return false;
      return true;
    });

    if (feasible.length === 0) {
      unplaceable.push({
        sample,
        reason: diagnoseInfeasible(ledgers, sample, source),
      });
      continue;
    }

    feasible.sort((a, b) => scoreDestination(a, sample) - scoreDestination(b, sample));
    const chosen = feasible[0]!;
    const storageFreeBefore = chosen.storageRemaining;
    const slotsFreeBefore = chosen.slotsRemaining;

    chosen.storageRemaining -= sample.storage_space;
    if (chosen.slotsRemaining != null) chosen.slotsRemaining -= 1;
    chosen.assigned.push(sample.id);

    allocations.push({
      sample,
      destination: chosen.equipment,
      storageFreeBefore,
      slotsFreeBefore,
      rationale: `Range ${chosen.equipment.min_temperature} to ${chosen.equipment.max_temperature} °C covers the required ${sample.min_temperature} to ${sample.max_temperature} °C; ${sample.storage_space} of ${storageFreeBefore} storage units free; ${slotsFreeBefore == null ? "no slot limit" : `${slotsFreeBefore} slot(s) free`}.`,
    });
  }

  const impacts: DestinationImpact[] = ledgers
    .filter((l) => l.assigned.length > 0)
    .map((l) => {
      const storageUsedByPlan = l.assigned.reduce((sum, id) => {
        const s = samples.find((x) => x.id === id);
        return sum + (s?.storage_space ?? 0);
      }, 0);
      return {
        destination: l.equipment,
        assignedSampleIds: l.assigned,
        storageUsedByPlan,
        storageRemainingAfter: l.storageRemaining,
        slotsUsedByPlan: l.assigned.length,
        slotsRemainingAfter: l.slotsRemaining,
      };
    });

  const complete = unplaceable.length === 0 && samples.length > 0;
  const partial = allocations.length > 0 && unplaceable.length > 0;

  return { source, allocations, unplaceable, impacts, complete, partial };
}

/** Human-readable reason a sample could not be placed anywhere. */
function diagnoseInfeasible(
  ledgers: Ledger[],
  sample: SampleRead,
  source: EquipmentRead,
): string {
  if (ledgers.length === 0) {
    return "No eligible backup equipment is available (all offline or the source itself).";
  }
  const tempCompatible = ledgers.filter((l) => covers(l.equipment, sample));
  if (tempCompatible.length === 0) {
    return `No backup unit covers the required range [${sample.min_temperature}, ${sample.max_temperature}]°C.`;
  }
  const withStorage = tempCompatible.filter(
    (l) => l.storageRemaining >= sample.storage_space,
  );
  if (withStorage.length === 0) {
    const best = Math.max(...tempCompatible.map((l) => l.storageRemaining));
    return `Compatible units are full: needs ${sample.storage_space} storage but at most ${best} is free (freeing space in ${source.name} or elsewhere may help).`;
  }
  return "Compatible units have no free slot remaining.";
}
