/**
 * Client-side incident store. The backend has no incident endpoints, so
 * incidents live here and are saved to this browser's localStorage only
 * (they are not shared and not stored on the server). This module is the
 * single adapter boundary to replace when a backend incident API exists.
 *
 * Wraps the pure `incidentReducer`. Execution side effects (real sample
 * moves) are performed by callers through the API and then recorded here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import {
  createIncident,
  incidentReducer,
  type Incident,
  type IncidentAction,
  type RecoveryResult,
} from "../domain/incident";
import type { Assessment } from "../domain/assessment";
import type { RescuePlan } from "../domain/rescue";
import type { EquipmentRead } from "../api/types";

export const INCIDENT_STORAGE_KEY = "labsentinel.incidents.v1";

export interface StoreState {
  byId: Record<string, Incident>;
  order: string[];
  /**
   * Units whose last incident was resolved. A latched unit cannot open a new
   * incident until it has been observed non-critical again ("re-armed"), so
   * resolving an incident on a unit that is still failed (or reloading the
   * page) does not immediately open a duplicate.
   */
  latched: number[];
}

const EMPTY: StoreState = { byId: {}, order: [], latched: [] };

export type StoreAction =
  | {
      type: "detect";
      equipment: EquipmentRead;
      assessment: Assessment;
      at: number;
    }
  | { type: "dispatch"; id: string; action: IncidentAction }
  | { type: "rearm"; equipmentId: number }
  | { type: "clearEquipment"; equipmentIds: number[]; keepResolved: boolean }
  | { type: "clear" };

function isActive(i: Incident | undefined): i is Incident {
  return i != null && i.state !== "resolved";
}

export function incidentStoreReducer(
  state: StoreState,
  action: StoreAction,
): StoreState {
  switch (action.type) {
    case "detect": {
      // One ACTIVE incident per equipment. A resolved incident stays in the
      // history and does not block a new incident on the same unit.
      const hasActive = state.order.some((id) => {
        const inc = state.byId[id];
        return isActive(inc) && inc.equipmentId === action.equipment.id;
      });
      if (hasActive || state.latched.includes(action.equipment.id)) return state;
      let id = `eq-${action.equipment.id}-${action.at}`;
      while (state.byId[id]) id = `${id}-1`;
      const incident = createIncident({
        id,
        equipment: action.equipment,
        assessment: action.assessment,
        at: action.at,
      });
      return {
        ...state,
        byId: { ...state.byId, [id]: incident },
        order: [id, ...state.order],
      };
    }
    case "dispatch": {
      const current = state.byId[action.id];
      if (!current) return state;
      try {
        const next = incidentReducer(current, action.action);
        const justResolved = next.state === "resolved" && current.state !== "resolved";
        return {
          ...state,
          byId: { ...state.byId, [action.id]: next },
          latched:
            justResolved && !state.latched.includes(next.equipmentId)
              ? [...state.latched, next.equipmentId]
              : state.latched,
        };
      } catch (err) {
        // Illegal transitions are rejected, not applied. The UI disables the
        // matching controls, so reaching this indicates a bug worth seeing.
        console.error("Rejected incident action:", action.action.type, err);
        return state;
      }
    }
    case "rearm": {
      if (!state.latched.includes(action.equipmentId)) return state;
      return { ...state, latched: state.latched.filter((id) => id !== action.equipmentId) };
    }
    case "clearEquipment": {
      const ids = new Set(action.equipmentIds);
      const order = state.order.filter((id) => {
        const inc = state.byId[id];
        if (!inc) return false;
        if (!ids.has(inc.equipmentId)) return true;
        return action.keepResolved && inc.state === "resolved";
      });
      const byId: Record<string, Incident> = {};
      for (const id of order) byId[id] = state.byId[id]!;
      // Removed equipment ids can be reused by new records, so forget their
      // latch; a reset keeps it and lets the next healthy reading re-arm.
      const latched = action.keepResolved
        ? state.latched
        : state.latched.filter((id) => !ids.has(id));
      return { byId, order, latched };
    }
    case "clear":
      return EMPTY;
    default:
      return state;
  }
}

function loadState(): StoreState {
  try {
    const raw = window.localStorage.getItem(INCIDENT_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoreState> | null;
    if (
      !parsed ||
      typeof parsed.byId !== "object" ||
      parsed.byId === null ||
      !Array.isArray(parsed.order)
    ) {
      return EMPTY;
    }
    const byId = parsed.byId as Record<string, Incident>;
    const order = parsed.order.filter(
      (id): id is string => typeof id === "string" && byId[id] != null,
    );
    const latched = Array.isArray(parsed.latched)
      ? parsed.latched.filter((id): id is number => typeof id === "number")
      : [];
    return { byId, order, latched };
  } catch {
    return EMPTY;
  }
}

export interface IncidentStore {
  incidents: Incident[];
  activeByEquipment: Map<number, Incident>;
  latched: ReadonlySet<number>;
  detect: (equipment: EquipmentRead, assessment: Assessment, at?: number) => void;
  rearm: (equipmentId: number) => void;
  acknowledge: (id: string, by: string) => void;
  attachPlan: (id: string, plan: RescuePlan) => void;
  beginExecution: (id: string) => void;
  markExecuted: (id: string, note?: string) => void;
  abortExecution: (id: string, note?: string) => void;
  recordRecovery: (id: string, recovery: RecoveryResult) => void;
  resolve: (id: string, recovery: RecoveryResult) => void;
  reopen: (id: string) => void;
  clearEquipment: (equipmentIds: number[], options: { keepResolved: boolean }) => void;
  clear: () => void;
}

const Ctx = createContext<IncidentStore | null>(null);

export function IncidentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(incidentStoreReducer, undefined, loadState);

  useEffect(() => {
    try {
      window.localStorage.setItem(INCIDENT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable: incidents still work for this session.
    }
  }, [state]);

  const detect = useCallback(
    (equipment: EquipmentRead, assessment: Assessment, at = Date.now()) => {
      dispatch({ type: "detect", equipment, assessment, at });
    },
    [],
  );

  const run = useCallback((id: string, action: IncidentAction) => {
    dispatch({ type: "dispatch", id, action });
  }, []);

  const rearm = useCallback((equipmentId: number) => {
    dispatch({ type: "rearm", equipmentId });
  }, []);

  const store = useMemo<IncidentStore>(() => {
    const incidents = state.order
      .map((id) => state.byId[id])
      .filter((i): i is Incident => i != null);
    const activeByEquipment = new Map<number, Incident>();
    for (const inc of incidents) {
      if (inc.state !== "resolved") activeByEquipment.set(inc.equipmentId, inc);
    }
    return {
      incidents,
      activeByEquipment,
      latched: new Set(state.latched),
      detect,
      rearm,
      acknowledge: (id, by) => run(id, { type: "acknowledge", by, at: Date.now() }),
      attachPlan: (id, plan) => run(id, { type: "attachPlan", plan, at: Date.now() }),
      beginExecution: (id) => run(id, { type: "beginExecution", at: Date.now() }),
      markExecuted: (id, note) => run(id, { type: "executed", at: Date.now(), note }),
      abortExecution: (id, note) =>
        run(id, { type: "abortExecution", at: Date.now(), note }),
      recordRecovery: (id, recovery) =>
        run(id, { type: "recordRecovery", at: Date.now(), recovery }),
      resolve: (id, recovery) => run(id, { type: "resolve", at: Date.now(), recovery }),
      reopen: (id) => run(id, { type: "reopen", at: Date.now() }),
      clearEquipment: (equipmentIds, { keepResolved }) =>
        dispatch({ type: "clearEquipment", equipmentIds, keepResolved }),
      clear: () => dispatch({ type: "clear" }),
    };
  }, [state, detect, rearm, run]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useIncidentStore(): IncidentStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIncidentStore must be used within IncidentProvider");
  return ctx;
}
