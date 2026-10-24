/**
 * Typed resource functions mirroring the verified backend contract exactly.
 * UI code must go through these rather than calling apiFetch directly.
 */

import { apiFetch, ApiError, NO_READINGS_YET, type NoReadingsYet } from "./client";
import type {
  BackendCapabilities,
  BackendRescuePlan,
  EquipmentCreate,
  EquipmentModeRequest,
  EquipmentRead,
  EquipmentUpdate,
  IncidentDetail,
  IncidentEventRead,
  IncidentSummary,
  RecoveryOutcome,
  RescueExecution,
  RiskResponse,
  SampleCreate,
  SampleRead,
  SampleUpdate,
  SensorReadingRead,
  SimulationStartRequest,
  SimulationStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export function getHealth(): Promise<{ status: string; service: string }> {
  return apiFetch("/api/health");
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
export function listEquipment(): Promise<EquipmentRead[]> {
  return apiFetch("/api/equipment");
}

export function getEquipment(id: number): Promise<EquipmentRead> {
  return apiFetch(`/api/equipment/${id}`);
}

export function createEquipment(
  payload: EquipmentCreate,
): Promise<EquipmentRead> {
  return apiFetch("/api/equipment", { method: "POST", body: payload });
}

export function updateEquipment(
  id: number,
  payload: EquipmentUpdate,
): Promise<EquipmentRead> {
  return apiFetch(`/api/equipment/${id}`, { method: "PATCH", body: payload });
}

export function deleteEquipment(id: number): Promise<void> {
  return apiFetch(`/api/equipment/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------
export function listSamples(equipmentId?: number): Promise<SampleRead[]> {
  const q = equipmentId != null ? `?equipment_id=${equipmentId}` : "";
  return apiFetch(`/api/samples${q}`);
}

export function createSample(payload: SampleCreate): Promise<SampleRead> {
  return apiFetch("/api/samples", { method: "POST", body: payload });
}

export function getSample(id: number): Promise<SampleRead> {
  return apiFetch(`/api/samples/${id}`);
}

export function updateSample(
  id: number,
  payload: SampleUpdate,
): Promise<SampleRead> {
  return apiFetch(`/api/samples/${id}`, { method: "PATCH", body: payload });
}

export function deleteSample(id: number): Promise<void> {
  return apiFetch(`/api/samples/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
export function startSimulation(
  payload?: SimulationStartRequest,
): Promise<SimulationStatus> {
  return apiFetch("/api/simulation/start", {
    method: "POST",
    body: payload ?? {},
  });
}

export function stopSimulation(): Promise<SimulationStatus> {
  return apiFetch("/api/simulation/stop", { method: "POST" });
}

export function getSimulationStatus(): Promise<SimulationStatus> {
  return apiFetch("/api/simulation/status");
}

export function setAbnormal(
  equipmentId: number,
  payload: EquipmentModeRequest,
): Promise<SimulationStatus> {
  return apiFetch(`/api/simulation/equipment/${equipmentId}/abnormal`, {
    method: "POST",
    body: payload,
  });
}

export function setFailed(
  equipmentId: number,
  payload: EquipmentModeRequest,
): Promise<SimulationStatus> {
  return apiFetch(`/api/simulation/equipment/${equipmentId}/fail`, {
    method: "POST",
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

const TZ_SUFFIX = /(?:z|[+-]\d{2}:?\d{2})$/i;

/**
 * The backend stores timestamps in SQLite, which drops timezone information,
 * so readings arrive as naive ISO strings (e.g. "2026-10-24T20:34:26.819569")
 * even though they were recorded in UTC. JavaScript parses a naive date-time
 * as LOCAL time, which shifts every age and chart time by the viewer's UTC
 * offset. Treat naive values as UTC and trim sub-millisecond digits so all
 * browsers parse them the same way.
 */
export function normalizeUtcTimestamp(ts: string): string {
  const trimmed = ts.trim().replace(/(\.\d{3})\d+/, "$1");
  return TZ_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`;
}

function isReading(value: unknown): value is SensorReadingRead {
  if (value == null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "number" &&
    typeof r.equipment_id === "number" &&
    typeof r.temperature === "number" &&
    Number.isFinite(r.temperature) &&
    typeof r.timestamp === "string" &&
    !Number.isNaN(Date.parse(normalizeUtcTimestamp(r.timestamp)))
  );
}

function normalizeReading(r: SensorReadingRead): SensorReadingRead {
  return { ...r, timestamp: normalizeUtcTimestamp(r.timestamp) };
}

/**
 * Latest reading for an equipment. A 404 means "no readings yet"; we return a
 * sentinel instead of throwing so callers can show an awaiting-data state.
 */
export async function getLatestReading(
  equipmentId: number,
): Promise<SensorReadingRead | NoReadingsYet> {
  let raw: unknown;
  try {
    raw = await apiFetch<unknown>(
      `/api/simulation/equipment/${equipmentId}/latest`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return NO_READINGS_YET;
    }
    throw err;
  }
  if (!isReading(raw)) {
    throw new ApiError(502, "The backend returned a malformed temperature reading.");
  }
  return normalizeReading(raw);
}

/** Recent readings, newest first. Malformed rows are dropped, not plotted. */
export async function getReadingHistory(
  equipmentId: number,
  limit = 100,
): Promise<SensorReadingRead[]> {
  const raw = await apiFetch<unknown>(
    `/api/simulation/equipment/${equipmentId}/history?limit=${limit}`,
  );
  if (!Array.isArray(raw)) {
    throw new ApiError(502, "The backend returned malformed reading history.");
  }
  return raw.filter(isReading).map(normalizeReading);
}

// ---------------------------------------------------------------------------
// Backend capabilities, ML risk, and incident lifecycle
// ---------------------------------------------------------------------------

const RISK_PATH = "/api/detection/equipment/{equipment_id}/risk";
const INCIDENT_PATHS = [
  "/api/incidents",
  "/api/incidents/{incident_id}/plan/approve",
  "/api/incidents/{incident_id}/plan/execute",
  "/api/incidents/{incident_id}/recovery",
  "/api/incidents/{incident_id}/close",
];

/**
 * Reads the backend's live OpenAPI document to decide which features exist,
 * so the console uses backend-authoritative incidents when they are available
 * and falls back to its labeled browser-only workflow when they are not.
 */
export async function getCapabilities(): Promise<BackendCapabilities> {
  const doc = await apiFetch<{ paths?: Record<string, unknown> } | undefined>("/openapi.json");
  const paths = doc?.paths ?? {};
  const has = (p: string) => Object.prototype.hasOwnProperty.call(paths, p);
  return { risk: has(RISK_PATH), incidents: INCIDENT_PATHS.every(has) };
}

/** Read-only risk assessment (raise_alert=false): never creates alerts or incidents. */
export function getRisk(equipmentId: number): Promise<RiskResponse> {
  return apiFetch(`/api/detection/equipment/${equipmentId}/risk`);
}

export function listIncidents(limit = 200): Promise<IncidentSummary[]> {
  return apiFetch(`/api/incidents?limit=${limit}`);
}

export function getIncident(id: number): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}`);
}

export function listIncidentEvents(id: number): Promise<IncidentEventRead[]> {
  return apiFetch(`/api/incidents/${id}/events`);
}

export function acknowledgeIncident(id: number): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}/acknowledge`, { method: "POST", body: {} });
}

/** Runs the backend MILP optimizer. Read-only with respect to inventory. */
export function generateIncidentPlan(id: number): Promise<BackendRescuePlan> {
  return apiFetch(`/api/incidents/${id}/plan`, { method: "POST" });
}

export function getIncidentPlan(id: number): Promise<BackendRescuePlan> {
  return apiFetch(`/api/incidents/${id}/plan`);
}

export function approveIncidentPlan(
  id: number,
  acknowledgeUnrescued: boolean,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}/plan/approve`, {
    method: "POST",
    body: { acknowledge_unrescued: acknowledgeUnrescued },
  });
}

export function rejectIncidentPlan(id: number): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}/plan/reject`, { method: "POST", body: {} });
}

/** Backend revalidates and moves all approved samples in one transaction, or none. */
export function executeIncidentPlan(id: number): Promise<RescueExecution> {
  return apiFetch(`/api/incidents/${id}/plan/execute`, { method: "POST" });
}

export function getIncidentExecution(id: number): Promise<RescueExecution> {
  return apiFetch(`/api/incidents/${id}/plan/execution`);
}

export function recordIncidentRecovery(
  id: number,
  body: { outcome: RecoveryOutcome; notes?: string; unrescued_acknowledged: boolean },
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}/recovery`, { method: "POST", body });
}

export function closeIncident(id: number): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${id}/close`, { method: "POST", body: { confirm: true } });
}
