/**
 * Pure incident-lifecycle logic.
 *
 * An incident progresses through a small state machine. Illegal transitions
 * throw so the UI can rely on correctness. Execution side-effects (real sample
 * PATCH moves) live in a hook, not here — this module stays pure and testable.
 *
 * Frontend-derived: the backend has no incident endpoints yet. Incidents live
 * in client state. The adapter boundary is the single place to swap to a real
 * backend later.
 */

import type { EquipmentRead, SampleRead } from "../api/types";
import type { Assessment } from "./assessment";
import type { RescuePlan } from "./rescue";

export type IncidentState =
  | "detected"
  | "acknowledged"
  | "executing"
  | "executed"
  | "resolved";

export interface TimelineEntry {
  state: IncidentState;
  at: number;
  note?: string;
}

export interface Incident {
  id: string;
  equipmentId: number;
  equipmentName: string;
  state: IncidentState;
  assessment: Assessment;
  plan: RescuePlan | null;
  acknowledgedBy: string | null;
  timeline: TimelineEntry[];
  /** Set when recovery verification has run after execution. */
  recovery: RecoveryResult | null;
}

export type IncidentAction =
  | { type: "acknowledge"; by: string; at: number }
  | { type: "attachPlan"; plan: RescuePlan; at: number }
  | { type: "beginExecution"; at: number }
  | { type: "executed"; at: number; note?: string }
  | { type: "abortExecution"; at: number; note?: string }
  | { type: "recordRecovery"; at: number; recovery: RecoveryResult }
  | { type: "resolve"; at: number; recovery: RecoveryResult }
  | { type: "reopen"; at: number; note?: string };

const ALLOWED: Record<IncidentState, IncidentState[]> = {
  detected: ["acknowledged"],
  // Resolving from "acknowledged" covers units with nothing to relocate and
  // re-verification after a failed check; resolve always needs a passing
  // recovery verification.
  acknowledged: ["executing", "resolved"],
  executing: ["executed", "acknowledged"], // abort when nothing moved
  executed: ["resolved", "acknowledged"], // re-plan if recovery failed
  resolved: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: IncidentState, to: IncidentState) {
    super(`Invalid incident transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

function assertTransition(from: IncidentState, to: IncidentState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Actions that share a target state must also come from a specific state. */
function assertFrom(
  current: IncidentState,
  required: IncidentState,
  to: IncidentState,
): void {
  if (current !== required) throw new InvalidTransitionError(current, to);
}

export function createIncident(args: {
  id: string;
  equipment: EquipmentRead;
  assessment: Assessment;
  at: number;
}): Incident {
  return {
    id: args.id,
    equipmentId: args.equipment.id,
    equipmentName: args.equipment.name,
    state: "detected",
    assessment: args.assessment,
    plan: null,
    acknowledgedBy: null,
    recovery: null,
    timeline: [{ state: "detected", at: args.at }],
  };
}

export function incidentReducer(
  incident: Incident,
  action: IncidentAction,
): Incident {
  switch (action.type) {
    case "acknowledge": {
      assertFrom(incident.state, "detected", "acknowledged");
      return {
        ...incident,
        state: "acknowledged",
        acknowledgedBy: action.by,
        timeline: [
          ...incident.timeline,
          { state: "acknowledged", at: action.at, note: `by ${action.by}` },
        ],
      };
    }
    case "attachPlan": {
      // Attaching/refreshing a plan does not change state.
      return { ...incident, plan: action.plan };
    }
    case "beginExecution": {
      assertTransition(incident.state, "executing");
      return {
        ...incident,
        state: "executing",
        timeline: [...incident.timeline, { state: "executing", at: action.at }],
      };
    }
    case "executed": {
      assertTransition(incident.state, "executed");
      return {
        ...incident,
        state: "executed",
        timeline: [
          ...incident.timeline,
          { state: "executed", at: action.at, note: action.note },
        ],
      };
    }
    case "abortExecution": {
      // Nothing was moved (all moves rejected or execution blocked): return
      // to "acknowledged" instead of recording a rescue that did not happen.
      assertFrom(incident.state, "executing", "acknowledged");
      return {
        ...incident,
        state: "acknowledged",
        timeline: [
          ...incident.timeline,
          {
            state: "acknowledged",
            at: action.at,
            note: action.note ?? "execution aborted",
          },
        ],
      };
    }
    case "recordRecovery": {
      // Persist a recovery result without changing state. Keeps a failed
      // verification visible and leaves "executed" intact so the operator can
      // move more samples and re-verify.
      return {
        ...incident,
        recovery: action.recovery,
      };
    }
    case "resolve": {
      assertTransition(incident.state, "resolved");
      if (!action.recovery.ok) {
        // Guard: do not allow resolving when recovery checks fail.
        throw new Error("Cannot resolve: recovery verification failed.");
      }
      return {
        ...incident,
        state: "resolved",
        recovery: action.recovery,
        timeline: [...incident.timeline, { state: "resolved", at: action.at }],
      };
    }
    case "reopen": {
      // Executed -> acknowledged: re-open for re-planning.
      assertFrom(incident.state, "executed", "acknowledged");
      return {
        ...incident,
        state: "acknowledged",
        timeline: [
          ...incident.timeline,
          {
            state: "acknowledged",
            at: action.at,
            note: action.note ?? "re-opened for re-planning",
          },
        ],
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Recovery verification
// ---------------------------------------------------------------------------
export interface RecoveryCheck {
  sampleId: number;
  sampleName: string;
  ok: boolean;
  detail: string;
}

export interface RecoveryResult {
  ok: boolean;
  checks: RecoveryCheck[];
}

/**
 * Operational recovery check: every listed sample must now sit in compatible,
 * non-offline equipment other than the failed unit. Callers pass both the
 * planned samples AND every sample still stored in the failed unit, so a
 * partial rescue cannot pass. An empty list means nothing needed relocating.
 *
 * This checks locations and storage ranges only. It does not establish that a
 * sample is still scientifically viable.
 */
export function verifyRecovery(
  plannedSampleIds: number[],
  samples: SampleRead[],
  equipmentById: Map<number, EquipmentRead>,
  failedEquipmentId: number,
): RecoveryResult {
  const checks: RecoveryCheck[] = plannedSampleIds.map((id) => {
    const s = samples.find((x) => x.id === id);
    if (!s) {
      return {
        sampleId: id,
        sampleName: `#${id}`,
        ok: false,
        detail: "Sample no longer exists.",
      };
    }
    if (s.equipment_id === failedEquipmentId) {
      return {
        sampleId: id,
        sampleName: s.name,
        ok: false,
        detail: "Still located in the failed equipment.",
      };
    }
    const dest = equipmentById.get(s.equipment_id);
    if (!dest) {
      return {
        sampleId: id,
        sampleName: s.name,
        ok: false,
        detail: "Destination equipment not found.",
      };
    }
    if (dest.status === "offline") {
      return {
        sampleId: id,
        sampleName: s.name,
        ok: false,
        detail: `Now in ${dest.name}, which is offline.`,
      };
    }
    const compatible =
      dest.min_temperature <= s.min_temperature &&
      dest.max_temperature >= s.max_temperature;
    return {
      sampleId: id,
      sampleName: s.name,
      ok: compatible,
      detail: compatible
        ? `Safely relocated to ${dest.name}.`
        : `In ${dest.name}, whose range does not cover the sample.`,
    };
  });

  return { ok: checks.every((c) => c.ok), checks };
}
