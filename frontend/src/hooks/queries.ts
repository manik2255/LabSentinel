/**
 * React Query hooks wrapping the typed API. All server-state access in the UI
 * goes through these so caching, polling, and invalidation are consistent.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { POLL, HISTORY_LIMIT } from "../config";
import * as api from "../api/endpoints";
import type {
  EquipmentModeRequest,
  EquipmentRead,
  SampleRead,
  SampleUpdate,
  SensorReadingRead,
  SimulationStatus,
} from "../api/types";
import type { NoReadingsYet } from "../api/client";

export const queryKeys = {
  health: ["health"] as const,
  equipment: ["equipment"] as const,
  samples: (equipmentId?: number) =>
    equipmentId == null ? (["samples"] as const) : (["samples", equipmentId] as const),
  latest: (id: number) => ["latest", id] as const,
  history: (id: number, limit: number) => ["history", id, limit] as const,
  simStatus: ["simStatus"] as const,
};

export function useHealth(): UseQueryResult<{ status: string; service: string }> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    refetchInterval: POLL.simulationStatus,
    retry: false,
  });
}

export function useEquipmentList(): UseQueryResult<EquipmentRead[]> {
  return useQuery({
    queryKey: queryKeys.equipment,
    queryFn: api.listEquipment,
    refetchInterval: POLL.equipmentList,
  });
}

export function useSamples(
  equipmentId?: number,
): UseQueryResult<SampleRead[]> {
  return useQuery({
    queryKey: queryKeys.samples(equipmentId),
    queryFn: () => api.listSamples(equipmentId),
    refetchInterval: POLL.equipmentList,
  });
}

/** Shared options so cards, the overview, and detectors dedupe one request. */
export function latestReadingQuery(id: number) {
  return {
    queryKey: queryKeys.latest(id),
    queryFn: () => api.getLatestReading(id),
    refetchInterval: POLL.latestReading,
  };
}

export function useLatestReading(
  id: number | null,
): UseQueryResult<SensorReadingRead | NoReadingsYet> {
  return useQuery({
    ...latestReadingQuery(id ?? -1),
    enabled: id != null,
  });
}

/** Restore a unit's status to "operational" (used for demo units only). */
export function useRestoreOperational() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.updateEquipment(id, { status: "operational" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.equipment }),
  });
}

export function useReadingHistory(
  id: number | null,
  limit: number = HISTORY_LIMIT,
): UseQueryResult<SensorReadingRead[]> {
  return useQuery({
    queryKey: queryKeys.history(id ?? -1, limit),
    queryFn: () => api.getReadingHistory(id as number, limit),
    enabled: id != null,
    refetchInterval: POLL.history,
  });
}

export function useSimulationStatus(): UseQueryResult<SimulationStatus> {
  return useQuery({
    queryKey: queryKeys.simStatus,
    queryFn: api.getSimulationStatus,
    refetchInterval: POLL.simulationStatus,
  });
}

// --- Mutations ---

export function useSimulationControls() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.simStatus });
  };

  const start = useMutation({
    mutationFn: (interval?: number) =>
      api.startSimulation(interval != null ? { interval_seconds: interval } : {}),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.simStatus, data);
      invalidate();
    },
  });
  const stop = useMutation({
    mutationFn: () => api.stopSimulation(),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.simStatus, data);
      invalidate();
    },
  });
  const abnormal = useMutation({
    mutationFn: (args: { id: number } & EquipmentModeRequest) =>
      api.setAbnormal(args.id, { enabled: args.enabled }),
    onSuccess: (data) => qc.setQueryData(queryKeys.simStatus, data),
  });
  const fail = useMutation({
    mutationFn: (args: { id: number } & EquipmentModeRequest) =>
      api.setFailed(args.id, { enabled: args.enabled }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.simStatus, data);
      void qc.invalidateQueries({ queryKey: queryKeys.equipment });
    },
  });

  return { start, stop, abnormal, fail };
}

export function useSampleMove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; patch: SampleUpdate }) =>
      api.updateSample(args.id, args.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.equipment });
      void qc.invalidateQueries({ queryKey: ["samples"] });
    },
  });
}

// --- Backend detection and incident lifecycle ---

export const backendKeys = {
  capabilities: ["capabilities"] as const,
  risk: (id: number) => ["risk", id] as const,
  incidents: ["backendIncidents"] as const,
  incident: (id: number) => ["backendIncident", id] as const,
  events: (id: number) => ["backendIncidentEvents", id] as const,
  plan: (id: number, planId: number | null) => ["backendIncidentPlan", id, planId] as const,
  execution: (id: number, execId: number | null) =>
    ["backendIncidentExecution", id, execId] as const,
};

/** Which backend features exist, read once from the live OpenAPI document. */
export function useCapabilities() {
  return useQuery({
    queryKey: backendKeys.capabilities,
    queryFn: api.getCapabilities,
    staleTime: Infinity,
    retry: 2,
  });
}

export function useRisk(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: backendKeys.risk(id ?? -1),
    queryFn: () => api.getRisk(id as number),
    enabled: enabled && id != null,
    refetchInterval: POLL.latestReading,
  });
}

export function useBackendIncidents(enabled: boolean) {
  return useQuery({
    queryKey: backendKeys.incidents,
    queryFn: () => api.listIncidents(200),
    enabled,
    refetchInterval: POLL.latestReading,
  });
}

export function useBackendIncident(id: number) {
  return useQuery({
    queryKey: backendKeys.incident(id),
    queryFn: () => api.getIncident(id),
    refetchInterval: (q) => (q.state.data?.closed ? false : POLL.latestReading),
  });
}

export function useIncidentEvents(id: number, live: boolean) {
  return useQuery({
    queryKey: backendKeys.events(id),
    queryFn: () => api.listIncidentEvents(id),
    refetchInterval: live ? POLL.history : false,
  });
}

/** A stored plan is immutable per plan id, so it is fetched once. */
export function useIncidentPlan(id: number, planId: number | null) {
  return useQuery({
    queryKey: backendKeys.plan(id, planId),
    queryFn: () => api.getIncidentPlan(id),
    enabled: planId != null,
    staleTime: Infinity,
  });
}

export function useIncidentExecution(id: number, execId: number | null) {
  return useQuery({
    queryKey: backendKeys.execution(id, execId),
    queryFn: () => api.getIncidentExecution(id),
    enabled: execId != null,
    staleTime: Infinity,
  });
}
