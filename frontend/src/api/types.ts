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
