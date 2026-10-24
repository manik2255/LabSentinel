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

// ---------------------------------------------------------------------------
// Backend detection / incident / rescue API (backend/openapi.json, 2026-10-24)
// ---------------------------------------------------------------------------

export interface BackendCapabilities {
  /** GET /api/detection/equipment/{id}/risk (Isolation Forest + rules). */
  risk: boolean;
  /** Persistent incidents with plan approval, execution, recovery, closure. */
  incidents: boolean;
}

export interface RiskResponse {
  equipment_id: number;
  temperature: number | null;
  risk_level: string;
  anomaly_score: number;
  is_anomaly: boolean;
  reasons: string[];
  endangered_samples: string[];
  reading_count: number;
  insufficient_data: boolean;
  alert_id: number | null;
  alert_created: boolean;
  incident_id: number | null;
  incident_created: boolean;
}

export interface IncidentSummary {
  id: number;
  equipment_id: number;
  alert_id: number | null;
  trigger: string;
  risk_severity: string;
  status: string;
  summary: string;
  rescue_plan_id: number | null;
  rescue_plan_status: string;
  rescue_execution_id: number | null;
  recovery_status: string;
  created_at: string;
  updated_at: string;
}

export interface IncidentDetail extends IncidentSummary {
  affected_samples: Array<Record<string, unknown>>;
  evidence: Record<string, unknown>;
  acknowledged_at: string | null;
  escalated_at: string | null;
  plan_reviewed_at: string | null;
  executed_at: string | null;
  unrescued_acknowledged: boolean;
  recovery_notes: string | null;
  recovery_recorded_at: string | null;
  closed_at: string | null;
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

export interface PlanAssignment {
  sample_id: number;
  sample_name: string;
  equipment_id: number;
  equipment_name: string;
  storage_space: number;
  priority: string;
}

export interface PlanUnassigned {
  sample_id: number;
  sample_name: string;
  priority: string;
  reason: string;
  candidate_notes: string[];
}

export interface PlanCapacity {
  equipment_id: number;
  equipment_name: string;
  /** Free storage on this unit before the plan. */
  storage_capacity_before: number;
  storage_used_by_plan: number;
  storage_remaining: number;
  slots_before: number | null;
  slots_used_by_plan: number;
  slots_remaining: number | null;
}

export interface BackendRescuePlan {
  plan_id: number | null;
  created_at: string | null;
  feasible: boolean;
  partial: boolean;
  rescued_count: number;
  total_count: number;
  method: string;
  explanation: string;
  objective_value: number | null;
  assignments: PlanAssignment[];
  unassigned: PlanUnassigned[];
  remaining_capacity: PlanCapacity[];
  constraints: string[];
}

export interface TransferOut {
  sample_id: number;
  sample_name: string;
  from_equipment_id: number | null;
  from_equipment_name: string | null;
  to_equipment_id: number;
  to_equipment_name: string;
  storage_space: number;
}

export interface RescueExecution {
  id: number;
  incident_id: number;
  plan_id: number;
  status: string;
  transferred_sample_ids: number[];
  transfers: TransferOut[];
  explanation: string;
  problems: string[] | null;
  created_at: string;
}

export type RecoveryOutcome = "completed" | "partial" | "unresolved";
