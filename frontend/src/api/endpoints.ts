/**
 * Typed resource functions mirroring the verified backend contract exactly.
 * UI code must go through these rather than calling apiFetch directly.
 */

import { apiFetch, ApiError, NO_READINGS_YET, type NoReadingsYet } from "./client";
import type {
  AlertRead,
  EquipmentCreate,
  EquipmentModeRequest,
  EquipmentRead,
  EquipmentUpdate,
  IncidentActionRequest,
  IncidentCloseRequest,
  IncidentDetail,
  IncidentEventRead,
  IncidentReport,
  IncidentSummary,
  PlanApprovalRequest,
  PlanRejectionRequest,
  RecoveryRequest,
  RescueExecutionResponse,
  RescuePlanRequest,
  RescuePlanResponse,
  RescuePlanSummary,
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
// Detection / risk
// ---------------------------------------------------------------------------

/**
 * Current anomaly-risk assessment for a piece of equipment, computed by the
 * backend (Isolation Forest + explainable rules).
 *
 * Read-only by default. `raiseAlert` maps to the backend `?raise_alert=` query
 * flag, which additionally creates/refreshes an alert and may open an incident
 * server-side — the risk display must NOT set this, so it defaults to false.
 */
export function getEquipmentRisk(
  equipmentId: number,
  options: { raiseAlert?: boolean } = {},
): Promise<RiskResponse> {
  const q = options.raiseAlert ? "?raise_alert=true" : "";
  return apiFetch(`/api/detection/equipment/${equipmentId}/risk${q}`);
}

// ---------------------------------------------------------------------------
// Alerts (prepared; no UI consumes these yet)
// ---------------------------------------------------------------------------
export function listActiveAlerts(equipmentId?: number): Promise<AlertRead[]> {
  const q = equipmentId != null ? `?equipment_id=${equipmentId}` : "";
  return apiFetch(`/api/detection/alerts${q}`);
}

export function listAlertHistory(
  equipmentId?: number,
  limit = 100,
): Promise<AlertRead[]> {
  const params = new URLSearchParams();
  if (equipmentId != null) params.set("equipment_id", String(equipmentId));
  params.set("limit", String(limit));
  return apiFetch(`/api/detection/alerts/history?${params.toString()}`);
}

export function resolveAlert(alertId: number): Promise<AlertRead> {
  return apiFetch(`/api/detection/alerts/${alertId}/resolve`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Rescue planning (prepared; the rescue feature still uses local domain logic)
// ---------------------------------------------------------------------------
export function generateRescuePlan(
  payload?: RescuePlanRequest,
): Promise<RescuePlanResponse> {
  return apiFetch("/api/rescue/plan", { method: "POST", body: payload ?? {} });
}

export function listRescuePlans(limit = 50): Promise<RescuePlanSummary[]> {
  return apiFetch(`/api/rescue/plans?limit=${limit}`);
}

export function getRescuePlan(planId: number): Promise<RescuePlanResponse> {
  return apiFetch(`/api/rescue/plans/${planId}`);
}

// ---------------------------------------------------------------------------
// Incidents (prepared; incident management still uses the local store)
// ---------------------------------------------------------------------------
export function listIncidents(params: {
  equipmentId?: number;
  status?: string;
  activeOnly?: boolean;
  limit?: number;
} = {}): Promise<IncidentSummary[]> {
  const q = new URLSearchParams();
  if (params.equipmentId != null) q.set("equipment_id", String(params.equipmentId));
  if (params.status != null) q.set("status", params.status);
  if (params.activeOnly) q.set("active_only", "true");
  if (params.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiFetch(`/api/incidents${qs ? `?${qs}` : ""}`);
}

export function getIncident(incidentId: number): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}`);
}

export function getIncidentEvents(
  incidentId: number,
): Promise<IncidentEventRead[]> {
  return apiFetch(`/api/incidents/${incidentId}/events`);
}

export function getIncidentReport(incidentId: number): Promise<IncidentReport> {
  return apiFetch(`/api/incidents/${incidentId}/report`);
}

export function acknowledgeIncident(
  incidentId: number,
  payload?: IncidentActionRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/acknowledge`, {
    method: "POST",
    body: payload ?? {},
  });
}

export function escalateIncident(
  incidentId: number,
  payload?: IncidentActionRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/escalate`, {
    method: "POST",
    body: payload ?? {},
  });
}

export function generateIncidentPlan(
  incidentId: number,
): Promise<RescuePlanResponse> {
  return apiFetch(`/api/incidents/${incidentId}/plan`, { method: "POST" });
}

export function getIncidentPlan(
  incidentId: number,
): Promise<RescuePlanResponse> {
  return apiFetch(`/api/incidents/${incidentId}/plan`);
}

export function approveIncidentPlan(
  incidentId: number,
  payload?: PlanApprovalRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/plan/approve`, {
    method: "POST",
    body: payload ?? {},
  });
}

export function rejectIncidentPlan(
  incidentId: number,
  payload?: PlanRejectionRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/plan/reject`, {
    method: "POST",
    body: payload ?? {},
  });
}

export function executeIncidentPlan(
  incidentId: number,
): Promise<RescueExecutionResponse> {
  return apiFetch(`/api/incidents/${incidentId}/plan/execute`, {
    method: "POST",
  });
}

export function getIncidentExecution(
  incidentId: number,
): Promise<RescueExecutionResponse> {
  return apiFetch(`/api/incidents/${incidentId}/plan/execution`);
}

export function recordIncidentRecovery(
  incidentId: number,
  payload: RecoveryRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/recovery`, {
    method: "POST",
    body: payload,
  });
}

export function closeIncident(
  incidentId: number,
  payload?: IncidentCloseRequest,
): Promise<IncidentDetail> {
  return apiFetch(`/api/incidents/${incidentId}/close`, {
    method: "POST",
    body: payload ?? {},
  });
}
