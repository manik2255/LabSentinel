/**
 * Property-based tests for the pure rescue planner (`planRescue`).
 *
 * These tests are SEEDED and deterministic: every random scenario is derived
 * from a mulberry32 PRNG keyed off an integer seed, so any failure can be
 * reproduced by re-seeding. We do NOT modify rescue.ts — this file treats the
 * planner as a black box and checks two things:
 *
 *   1. SOUNDNESS — every allocation the planner emits is actually legal
 *      (right destination, temperature covered, capacity/slot limits honored,
 *      exact partition of the input samples). This must hold ALWAYS.
 *
 *   2. OPTIMALITY GAP — the planner is a greedy heuristic, not an optimizer.
 *      We compare its priority-weighted placed score against an exhaustive
 *      brute-force optimum and report how often greedy falls short. Greedy is
 *      never allowed to BEAT the optimum (that would mean the reference or an
 *      invariant is wrong), but it is allowed to tie or trail it.
 */

import { describe, expect, it } from "vitest";
import { planRescue } from "./rescue";
import type { EquipmentRead, SampleRead } from "../api/types";

// ---------------------------------------------------------------------------
// PART A: seeded deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------

/** Returns a deterministic generator of floats in [0, 1) from an integer seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

/** Integer in [lo, hi] inclusive. */
function randInt(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Pick one element of arr. */
function pick<T>(rand: Rand, arr: readonly T[]): T {
  return arr[randInt(rand, 0, arr.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Builders: full EquipmentRead / SampleRead objects with sane defaults.
// `available_storage` / `available_slots` are the fields the planner reads;
// the rest are filled consistently so the objects are valid API shapes.
// ---------------------------------------------------------------------------

function makeEquipment(partial: Partial<EquipmentRead> & { id: number }): EquipmentRead {
  const min = partial.min_temperature ?? -20;
  const max = partial.max_temperature ?? 10;
  const storageCapacity = partial.storage_capacity ?? 20;
  const availableStorage = partial.available_storage ?? storageCapacity;
  const sampleLimit = partial.sample_limit ?? null;
  const availableSlots =
    partial.available_slots !== undefined ? partial.available_slots : sampleLimit;
  return {
    id: partial.id,
    name: partial.name ?? `Equipment ${partial.id}`,
    type: partial.type ?? "freezer",
    location: partial.location ?? "Lab A",
    min_temperature: min,
    max_temperature: max,
    storage_capacity: storageCapacity,
    sample_limit: sampleLimit,
    status: partial.status ?? "operational",
    used_storage: partial.used_storage ?? 0,
    available_storage: availableStorage,
    used_slots: partial.used_slots ?? 0,
    available_slots: availableSlots,
  };
}

function makeSample(partial: Partial<SampleRead> & { id: number }): SampleRead {
  const min = partial.min_temperature ?? -10;
  const max = partial.max_temperature ?? 0;
  return {
    id: partial.id,
    name: partial.name ?? `Sample ${partial.id}`,
    equipment_id: partial.equipment_id ?? 1,
    min_temperature: min,
    max_temperature: max,
    storage_space: partial.storage_space ?? 1,
    priority: partial.priority ?? "medium",
  };
}

// ---------------------------------------------------------------------------
// PART B: scenario generator
// ---------------------------------------------------------------------------

interface Scenario {
  source: EquipmentRead;
  samples: SampleRead[];
  candidates: EquipmentRead[];
}

/** Two sorted draws in [lo, hi] with a span in [minSpan, maxSpan]. */
function randRange(
  rand: Rand,
  lo: number,
  hi: number,
  minSpan: number,
  maxSpan: number,
): { min: number; max: number } {
  const span = randInt(rand, minSpan, maxSpan);
  const min = randInt(rand, lo, Math.max(lo, hi - span));
  return { min, max: min + span };
}

const PRIORITIES: ReadonlyArray<SampleRead["priority"]> = [
  "low",
  "medium",
  "high",
  "critical",
];

function makeScenario(rand: Rand): Scenario {
  // Source is the failing unit (offline, id 1). The planner must never use it.
  const source = makeEquipment({
    id: 1,
    name: "Source Freezer",
    status: "offline",
    min_temperature: -80,
    max_temperature: -60,
    storage_capacity: 30,
    available_storage: 0,
  });

  // 2–4 candidate destinations, ids 2..
  const candidateCount = randInt(rand, 2, 4);
  const candidates: EquipmentRead[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const { min, max } = randRange(rand, -90, 40, 2, 30);
    const storageCapacity = randInt(rand, 0, 20);
    const availableStorage = randInt(rand, 0, storageCapacity);
    const hasSlotLimit = rand() < 0.5;
    const sampleLimit = hasSlotLimit ? randInt(rand, 0, 5) : null;
    const status = rand() < 0.15 ? "offline" : "operational";
    candidates.push(
      makeEquipment({
        id: 2 + i,
        name: `Backup ${2 + i}`,
        min_temperature: min,
        max_temperature: max,
        storage_capacity: storageCapacity,
        available_storage: availableStorage,
        sample_limit: sampleLimit,
        available_slots: sampleLimit,
        status,
      }),
    );
  }

  // 1–5 samples currently on the source.
  const sampleCount = randInt(rand, 1, 5);
  const samples: SampleRead[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const { min, max } = randRange(rand, -90, 40, 1, 15);
    samples.push(
      makeSample({
        id: 100 + i,
        name: `Sample ${100 + i}`,
        equipment_id: source.id,
        min_temperature: min,
        max_temperature: max,
        storage_space: randInt(rand, 1, 6),
        priority: pick(rand, PRIORITIES),
      }),
    );
  }

  return { source, samples, candidates };
}

// ---------------------------------------------------------------------------
// PART C: exhaustive reference optimum
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function weightOf(sample: SampleRead): number {
  return PRIORITY_WEIGHT[sample.priority] ?? 0;
}

function usable(dest: EquipmentRead, sourceId: number): boolean {
  return dest.id !== sourceId && dest.status !== "offline";
}

function covers(dest: EquipmentRead, sample: SampleRead): boolean {
  return (
    dest.min_temperature <= sample.min_temperature &&
    dest.max_temperature >= sample.max_temperature
  );
}

interface RefLedger {
  storageRemaining: number;
  slotsRemaining: number | null;
}

/**
 * Brute force over every way to assign each sample to a usable+covering
 * destination (or leave it unplaced). Among all assignments that respect
 * cumulative storage and slot limits, return the maximum priority-weighted
 * sum of PLACED samples. Search space is at most (candidates + 1)^samples,
 * bounded by 5^5 = 3125 by construction, so this is cheap.
 */
function bestAssignment(
  source: EquipmentRead,
  samples: SampleRead[],
  candidates: EquipmentRead[],
): number {
  const dests = candidates.filter((c) => usable(c, source.id));

  // Per-destination running ledger, cloned down each recursion branch.
  const initialLedgers: RefLedger[] = dests.map((d) => ({
    storageRemaining: Math.max(0, d.available_storage),
    slotsRemaining: d.available_slots == null ? null : Math.max(0, d.available_slots),
  }));

  let best = 0;

  function recurse(index: number, ledgers: RefLedger[], score: number): void {
    if (index === samples.length) {
      if (score > best) best = score;
      return;
    }
    const sample = samples[index]!;

    // Option 1: leave this sample unplaced.
    recurse(index + 1, ledgers, score);

    // Option 2: try each feasible destination.
    for (let d = 0; d < dests.length; d++) {
      const dest = dests[d]!;
      if (!covers(dest, sample)) continue;
      const led = ledgers[d]!;
      if (led.storageRemaining < sample.storage_space) continue;
      if (led.slotsRemaining != null && led.slotsRemaining < 1) continue;

      const nextLedgers = ledgers.map((l) => ({ ...l }));
      nextLedgers[d]!.storageRemaining -= sample.storage_space;
      if (nextLedgers[d]!.slotsRemaining != null) {
        nextLedgers[d]!.slotsRemaining! -= 1;
      }
      recurse(index + 1, nextLedgers, score + weightOf(sample));
    }
  }

  recurse(0, initialLedgers, 0);
  return best;
}

/** Greedy weighted-placed score, read straight off a planRescue result. */
function greedyScore(allocations: { sample: SampleRead }[]): number {
  return allocations.reduce((sum, a) => sum + weightOf(a.sample), 0);
}

// ---------------------------------------------------------------------------
// PART D: tests
// ---------------------------------------------------------------------------

const SEED_COUNT = 300;

describe("planRescue — soundness (property)", () => {
  it("emits only legal allocations and an exact sample partition", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const rand = mulberry32(seed);
      const { source, samples, candidates } = makeScenario(rand);
      const plan = planRescue({ source, samples, candidates });

      const ctx = `seed=${seed}`;

      // Per-destination running tallies for capacity checks.
      const storageUsed = new Map<number, number>();
      const slotCount = new Map<number, number>();
      const seenSampleIds = new Set<number>();

      for (const alloc of plan.allocations) {
        const { sample, destination } = alloc;

        // destination must not be the source and must not be offline.
        expect(destination.id, `${ctx}: allocation used source as destination`).not.toBe(
          source.id,
        );
        expect(
          destination.status,
          `${ctx}: allocation used an offline destination (sample ${sample.id})`,
        ).not.toBe("offline");

        // destination must cover the sample's temperature range.
        expect(
          destination.min_temperature <= sample.min_temperature &&
            destination.max_temperature >= sample.max_temperature,
          `${ctx}: destination ${destination.id} [${destination.min_temperature},${destination.max_temperature}] does not cover sample ${sample.id} [${sample.min_temperature},${sample.max_temperature}]`,
        ).toBe(true);

        // each sample assigned at most once.
        expect(
          seenSampleIds.has(sample.id),
          `${ctx}: sample ${sample.id} appears in more than one allocation`,
        ).toBe(false);
        seenSampleIds.add(sample.id);

        storageUsed.set(
          destination.id,
          (storageUsed.get(destination.id) ?? 0) + sample.storage_space,
        );
        slotCount.set(destination.id, (slotCount.get(destination.id) ?? 0) + 1);
      }

      // cumulative storage / slot limits per destination.
      for (const dest of candidates) {
        const used = storageUsed.get(dest.id) ?? 0;
        const maxStorage = Math.max(0, dest.available_storage);
        expect(
          used <= maxStorage,
          `${ctx}: destination ${dest.id} over storage: used ${used} > available ${maxStorage}`,
        ).toBe(true);

        if (dest.available_slots != null) {
          const slots = slotCount.get(dest.id) ?? 0;
          const maxSlots = Math.max(0, dest.available_slots);
          expect(
            slots <= maxSlots,
            `${ctx}: destination ${dest.id} over slots: used ${slots} > available ${maxSlots}`,
          ).toBe(true);
        }
      }

      // allocations + unplaceable partition the input samples exactly:
      // no overlap, full coverage.
      const allocIds = plan.allocations.map((a) => a.sample.id);
      const unplaceableIds = plan.unplaceable.map((u) => u.sample.id);
      const allIds = [...allocIds, ...unplaceableIds].sort((a, b) => a - b);
      const inputIds = samples.map((s) => s.id).sort((a, b) => a - b);

      expect(allIds.length, `${ctx}: sample count mismatch after planning`).toBe(
        inputIds.length,
      );
      expect(allIds, `${ctx}: planned sample set != input sample set`).toEqual(inputIds);

      // no sample in both buckets.
      for (const id of allocIds) {
        expect(
          unplaceableIds.includes(id),
          `${ctx}: sample ${id} is both allocated and unplaceable`,
        ).toBe(false);
      }
    }
  });
});

describe("planRescue — optimality gap (property)", () => {
  it("never beats the optimum and matches it in most scenarios", () => {
    let shortfalls = 0;
    let worst: { seed: number; greedy: number; optimal: number } | null = null;

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const rand = mulberry32(seed);
      const { source, samples, candidates } = makeScenario(rand);
      const plan = planRescue({ source, samples, candidates });

      const greedy = greedyScore(plan.allocations);
      const optimal = bestAssignment(source, samples, candidates);

      // Sanity: a sound greedy can never exceed the exhaustive optimum.
      expect(
        greedy <= optimal,
        `seed=${seed}: greedy ${greedy} exceeded optimal ${optimal} — reference or invariant is wrong`,
      ).toBe(true);

      if (greedy < optimal) {
        shortfalls++;
        const gap = optimal - greedy;
        const worstGap = worst ? worst.optimal - worst.greedy : -1;
        if (gap > worstGap) worst = { seed, greedy, optimal };
      }
    }

    const shortfallRate = shortfalls / SEED_COUNT;
    // eslint-disable-next-line no-console
    console.log(
      `[optimality] shortfall rate = ${(shortfallRate * 100).toFixed(1)}% ` +
        `(${shortfalls}/${SEED_COUNT} scenarios where greedy < optimal)`,
    );
    if (worst) {
      // eslint-disable-next-line no-console
      console.log(
        `[optimality] worst case: seed=${worst.seed} greedy=${worst.greedy} optimal=${worst.optimal}`,
      );
    }

    // Greedy is a heuristic, not an optimizer, so some shortfall is expected
    // and acceptable. The threshold below is a regression guard, not a claim of
    // optimality. Measured shortfall over 300 seeds was 0.0% — this generator
    // rarely produces the priority-vs-capacity contention shape that trips a
    // greedy planner (the hand-crafted test constructs that shape explicitly).
    // Threshold set to 0.05 (5%): comfortably above the observed 0% so normal
    // variation won't flake, but low enough to catch a real degradation if a
    // future change makes greedy systematically worse.
    const THRESHOLD = 0.05;
    expect(
      shortfallRate <= THRESHOLD,
      `optimality shortfall ${(shortfallRate * 100).toFixed(1)}% exceeded threshold ${(THRESHOLD * 100).toFixed(0)}%`,
    ).toBe(true);
  });
});

describe("planRescue — hand-crafted deterministic cases", () => {
  it("exact-fit storage places one sample and rejects a second identical one", () => {
    const source = makeEquipment({
      id: 1,
      status: "offline",
      min_temperature: -80,
      max_temperature: -60,
      available_storage: 0,
    });
    // Destination covers [-20, 0] and has exactly 3 storage free, no slot cap.
    const dest = makeEquipment({
      id: 2,
      name: "Exact Fit",
      min_temperature: -30,
      max_temperature: 10,
      storage_capacity: 3,
      available_storage: 3,
      sample_limit: null,
      available_slots: null,
      status: "operational",
    });
    const s1 = makeSample({
      id: 100,
      equipment_id: 1,
      min_temperature: -20,
      max_temperature: 0,
      storage_space: 3,
      priority: "high",
    });
    const s2 = makeSample({
      id: 101,
      equipment_id: 1,
      min_temperature: -20,
      max_temperature: 0,
      storage_space: 3,
      priority: "high",
    });

    const plan = planRescue({ source, samples: [s1, s2], candidates: [dest] });

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]!.destination.id).toBe(2);
    expect(plan.unplaceable).toHaveLength(1);
    // The first sample fills the destination exactly; the second has nowhere to go.
    expect(plan.allocations[0]!.sample.storage_space).toBe(3);
    expect(plan.unplaceable[0]!.reason).toMatch(/full|storage/i);
  });

  it("offline destination is never used even when it would otherwise fit", () => {
    const source = makeEquipment({ id: 1, status: "offline", available_storage: 0 });
    const offlineDest = makeEquipment({
      id: 2,
      name: "Offline Backup",
      min_temperature: -30,
      max_temperature: 10,
      storage_capacity: 10,
      available_storage: 10,
      status: "offline",
    });
    const sample = makeSample({
      id: 100,
      equipment_id: 1,
      min_temperature: -20,
      max_temperature: 0,
      storage_space: 1,
      priority: "critical",
    });

    const plan = planRescue({
      source,
      samples: [sample],
      candidates: [offlineDest],
    });

    expect(plan.allocations).toHaveLength(0);
    expect(plan.unplaceable).toHaveLength(1);
  });

  it("greedy-suboptimal shape: priority ordering vs capacity contention", () => {
    // Two destinations, two samples. Dest A is the ONLY one that can hold the
    // low-priority bulky sample (B is too small / slot-capped), while both A
    // and B can hold the critical small sample. Priority-first greedy places
    // the critical sample into A (best fit), consuming A's only slot, leaving
    // the low-priority bulky sample unplaceable — whereas the optimum puts the
    // critical sample in B and the bulky one in A, placing BOTH.
    const source = makeEquipment({ id: 1, status: "offline", available_storage: 0 });

    // Dest A: slot-limited to 1, large storage, wide range. Only A fits the bulky sample.
    const destA = makeEquipment({
      id: 2,
      name: "A (1 slot, roomy)",
      min_temperature: -30,
      max_temperature: 10,
      storage_capacity: 10,
      available_storage: 10,
      sample_limit: 1,
      available_slots: 1,
      status: "operational",
    });
    // Dest B: tiny storage (only the small sample fits), no slot cap, same range.
    const destB = makeEquipment({
      id: 3,
      name: "B (tiny)",
      min_temperature: -30,
      max_temperature: 10,
      storage_capacity: 1,
      available_storage: 1,
      sample_limit: null,
      available_slots: null,
      status: "operational",
    });

    const critical = makeSample({
      id: 100,
      equipment_id: 1,
      min_temperature: -20,
      max_temperature: 0,
      storage_space: 1,
      priority: "critical",
    });
    const bulkyLow = makeSample({
      id: 101,
      equipment_id: 1,
      min_temperature: -20,
      max_temperature: 0,
      storage_space: 6,
      priority: "low",
    });

    const plan = planRescue({
      source,
      samples: [critical, bulkyLow],
      candidates: [destA, destB],
    });

    const greedy = greedyScore(plan.allocations);
    const optimal = bestAssignment(source, [critical, bulkyLow], [destA, destB]);

    // Greedy must never exceed optimal.
    expect(greedy).toBeLessThanOrEqual(optimal);

    // The optimum here places both samples: critical(4) + low(1) = 5.
    expect(optimal).toBe(5);

    // Document the observed greedy behavior for this shape. The planner scores
    // destinations by tightest temperature fit then most free storage; both A
    // and B have identical ranges, so the critical sample goes to whichever has
    // more free storage (A, 10 > 1). That consumes A's single slot and strands
    // the bulky low-priority sample — a genuine greedy shortfall (greedy=4).
    // If a future change to the scoring makes greedy optimal for this shape,
    // this expectation will flag it for review.
    expect(greedy).toBe(4);
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]!.sample.id).toBe(100); // critical placed
    expect(plan.unplaceable).toHaveLength(1);
    expect(plan.unplaceable[0]!.sample.id).toBe(101); // bulky low stranded
  });
});
