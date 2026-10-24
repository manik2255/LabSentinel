/**
 * API types, hand-written from the verified backend OpenAPI snapshot
 * (.kiro/specs/labsentinel-frontend/backend-openapi.snapshot.json).
 * Keep these in sync with the backend contract in steering.
 */

export type EquipmentStatus =
  | "operational"
  | "maintenance"
  | "offline"
  | (string & {});

export type Priority = "low" | "medium" | "high" | "critical" | (string & {});

export interface EquipmentRead {
  id: number;
  name: string;
  type: string;
  location: string;
  min_temperature: number;
  max_temperature: number;
  storage_capacity: number;
  sample_limit: number | null;
  status: EquipmentStatus;
  used_storage: number;
  available_storage: number;
  used_slots: number;
  available_slots: number | null;
}

export interface EquipmentCreate {
  name: string;
  type: string;
  location: string;
  min_temperature: number;
  max_temperature: number;
  storage_capacity: number;
  sample_limit?: number | null;
  status?: string;
}

export type EquipmentUpdate = Partial<EquipmentCreate>;

export interface SampleRead {
  id: number;
  name: string;
  equipment_id: number;
  min_temperature: number;
  max_temperature: number;
  storage_space: number;
  priority: Priority;
}

export interface SampleCreate {
  name: string;
  equipment_id: number;
  min_temperature: number;
  max_temperature: number;
  storage_space?: number;
  priority?: string;
}

export type SampleUpdate = Partial<Omit<SampleCreate, "name">> & {
  name?: string;
};

export interface SensorReadingRead {
  id: number;
  equipment_id: number;
  temperature: number;
  /** ISO-8601, timezone-aware (UTC). */
  timestamp: string;
}

export interface SimulationStatus {
  running: boolean;
  interval_seconds: number | null;
  ticks: number;
  abnormal_equipment_ids: number[];
  failed_equipment_ids: number[];
}

export interface SimulationStartRequest {
  interval_seconds?: number;
}

export interface EquipmentModeRequest {
  enabled: boolean;
}

// ===========================================================================
// Detection / risk, alerts, rescue, and incidents.
//
// These mirror the current backend OpenAPI contract (detection, rescue, and
// incident routers added after the original snapshot). They are hand-written
// to match `backend/openapi.json` exactly. The detection types back the live
// risk integration; the rescue and incident types are prepared for a later
// phase and are not yet wired into those features.
// ===========================================================================

// --- Detection / risk ------------------------------------------------------

/** `GET /api/detection/equipment/{id}/risk` → RiskResponse. */
export interface RiskResponse {
  equipment_id: number;
  /** Latest temperature the assessment was computed from; null if none yet. */
  temperature: number | null;
  /** Backend risk level: low | medium | high | critical (open union). */
  risk_level: RiskLevel;
  /** Isolation-Forest anomaly score (higher = more anomalous). */
  anomaly_score: number;
  is_anomaly: boolean;
  /** Human-readable reasons the backend produced for this risk level. */
  reasons: string[];
  /** Names of samples endangered by the current condition. */
  endangered_samples: string[];
  reading_count: number;
  /** True when there were too few readings to score anomalies (range-only). */
  insufficient_data: boolean;
  // Set only on the raise_alert path; null/false for read-only risk reads.
  alert_id: number | null;
  alert_created: boolean;
  incident_id: number | null;
  incident_created: boolean;
}

export type RiskLevel = "low" | "medium" | "high" | "critical" | (string & {});

// --- Alerts ----------------------------------------------------------------

/** `GET /api/detection/alerts` / `.../history` → AlertRead. */
export interface AlertRead {
  id: number;
  equipment_id: number;
  alert_type: string;
  severity: string;
  risk_level: string;
  message: string;
  /** ISO-8601 (naive UTC from SQLite; normalise like sensor readings). */
  timestamp: string;
  resolved: boolean;
  resolved_at: string | null;
}

// --- Rescue planning (prepared; not yet wired into the rescue feature) -----

export interface RescuePlanRequest {
  source_equipment_ids?: number[] | null;
  backup_equipment_ids?: number[] | null;
  persist?: boolean;
}

export interface RescueAssignment {
  sample_id: number;
  sample_name: string;
  equipment_id: number;
  equipment_name: string;
  storage_space: number;
  priority: string;
}

export interface RescueUnassigned {
  sample_id: number;
  sample_name: string;
  priority: string;
  reason: string;
  candidate_notes: string[];
}

export interface RescueEquipmentCapacity {
  equipment_id: number;
  equipment_name: string;
  storage_capacity_before: number;
  storage_used_by_plan: number;
  storage_remaining: number;
  slots_before: number | null;
  slots_used_by_plan: number;
  slots_remaining: number | null;
}

export interface RescuePlanResponse {
  plan_id: number | null;
  created_at: string | null;
  feasible: boolean;
  partial: boolean;
  rescued_count: number;
  total_count: number;
  method: string;
  explanation: string;
  objective_value: number | null;
  assignments: RescueAssignment[];
  unassigned: RescueUnassigned[];
  remaining_capacity: RescueEquipmentCapacity[];
  constraints: string[];
}

export interface RescuePlanSummary {
  id: number;
  created_at: string;
  feasible: boolean;
  partial: boolean;
  rescued_count: number;
  total_count: number;
  method: string;
}

// --- Incidents (prepared; not yet wired into incident management) ----------

export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "escalated"
  | "closed"
  | (string & {});

export type RescuePlanStatus =
  | "none"
  | "planned"
  | "approved"
  | "rejected"
  | "executed"
  | (string & {});

export type RecoveryStatus =
  | "pending"
  | "completed"
  | "partial"
  | "unresolved"
  | (string & {});

export interface IncidentSummary {
  id: number;
  equipment_id: number;
  alert_id: number | null;
  trigger: string;
  risk_severity: string;
  status: IncidentStatus;
  summary: string;
  rescue_plan_id: number | null;
  rescue_plan_status: RescuePlanStatus;
  rescue_execution_id: number | null;
  recovery_status: RecoveryStatus;
  created_at: string;
  updated_at: string;
}

export interface IncidentDetail {
  id: number;
  equipment_id: number;
  alert_id: number | null;
  trigger: string;
  risk_severity: string;
  status: IncidentStatus;
  summary: string;
  affected_samples: Array<Record<string, unknown>>;
  evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  escalated_at: string | null;
  rescue_plan_id: number | null;
  rescue_plan_status: RescuePlanStatus;
  plan_reviewed_at: string | null;
  rescue_execution_id: number | null;
  executed_at: string | null;
  recovery_status: RecoveryStatus;
  unrescued_acknowledged: boolean;
  recovery_notes: string | null;
  recovery_recorded_at: string | null;
  closed_at: string | null;
  // Backend-authoritative computed flags.
  recovery_recorded: boolean;
  closed: boolean;
  approval_recorded: boolean;
  execution_recorded: boolean;
}

export interface IncidentEventRead {
  id: number;
  incident_id: number;
  event_type: string;
  explanation: string;
  detail: Record<string, unknown> | null;
  timestamp: string;
}

export interface TimelineEvent {
  event_type: string;
  explanation: string;
  timestamp: string | null;
}

export interface ReportEquipment {
  equipment_id: number;
  name: string | null;
  type: string | null;
  location: string | null;
  status: string | null;
}

export interface ReportSampleCounts {
  affected: number;
  rescued: number;
  unrescued: number;
  rescue_executed: boolean;
}

export interface IncidentReport {
  incident_id: number;
  status: IncidentStatus;
  summary: string;
  trigger: string;
  risk_severity: string;
  generated_from: string;
  equipment: ReportEquipment;
  sample_counts: ReportSampleCounts;
  transfers: Array<Record<string, unknown>>;
  rescued_sample_ids: number[];
  unrescued_samples: Array<Record<string, unknown>>;
  rescue_plan_status: RescuePlanStatus;
  rescue_plan: Record<string, unknown> | null;
  execution: Record<string, unknown> | null;
  recovery: Record<string, unknown>;
  timestamps: Record<string, unknown>;
  timeline: TimelineEvent[];
}

export interface RescueExecutionTransfer {
  sample_id: number;
  sample_name: string;
  from_equipment_id: number | null;
  from_equipment_name: string | null;
  to_equipment_id: number;
  to_equipment_name: string;
  storage_space: number;
}

export interface RescueExecutionResponse {
  id: number;
  incident_id: number;
  plan_id: number;
  status: string;
  transferred_sample_ids: number[];
  transfers: RescueExecutionTransfer[];
  explanation: string;
  problems: string[] | null;
  created_at: string;
}

// Request bodies for incident lifecycle actions.
export interface IncidentActionRequest {
  note?: string | null;
}

export interface PlanApprovalRequest {
  acknowledge_unrescued?: boolean;
  note?: string | null;
}

export interface PlanRejectionRequest {
  note?: string | null;
}

export interface RecoveryRequest {
  outcome: string;
  notes?: string | null;
  unrescued_acknowledged?: boolean;
}

export interface IncidentCloseRequest {
  confirm?: boolean;
  note?: string | null;
}
