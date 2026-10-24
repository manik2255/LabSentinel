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
  RiskResponse,
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
  risk: (id: number) => ["risk", id] as const,
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

/**
 * Backend anomaly-risk assessment for one equipment (Isolation Forest +
 * explainable rules). Read-only: never passes raise_alert, so displaying risk
 * cannot create alerts or incidents server-side. Polls with the latest reading
 * so the shown risk tracks fresh telemetry.
 */
export function useEquipmentRisk(
  id: number | null,
): UseQueryResult<RiskResponse> {
  return useQuery({
    queryKey: queryKeys.risk(id ?? -1),
    queryFn: () => api.getEquipmentRisk(id as number),
    enabled: id != null,
    refetchInterval: POLL.latestReading,
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
