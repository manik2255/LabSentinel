/**
 * Centralized runtime configuration and tunable domain constants.
 *
 * Keeping these in one place means tests can import the exact same values the
 * app uses, and behaviour (polling cadence, staleness, warning margins) is
 * adjustable without hunting through components.
 */

export const API_BASE_URL: string =
  import.meta.env?.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000";

/** How long before a reading is considered stale (no fresh data). */
export const STALENESS_MS = 20_000;

/**
 * Fraction of an equipment's temperature span, measured inward from each
 * bound, within which a reading is considered a WARNING (approaching a limit).
 */
export const WARNING_MARGIN_FRACTION = 0.1;

/** Polling cadences (ms). The backend simulator ticks every ~5s by default. */
export const POLL = {
  equipmentList: 5_000,
  latestReading: 4_000,
  history: 5_000,
  simulationStatus: 4_000,
} as const;

/** Default number of history points to request/plot. */
export const HISTORY_LIMIT = 120;

/** A gap between consecutive readings longer than this is drawn as a break. */
export const TELEMETRY_GAP_MS = 15_000;

/** Simulator interval requested by "Set up demo". */
export const DEMO_SIM_INTERVAL_SECONDS = 3;

/**
 * Marker for records the demo creates. Seeded equipment gets this prefix in
 * its `location`; together with the seed names it identifies demo-owned data.
 * Every state-changing demo operation (fault injection, rescue execution,
 * reset, removal) is restricted to demo-owned records, so it cannot modify
 * unrelated inventory in a shared backend database.
 */
export const DEMO_LOCATION_PREFIX = "Demo Lab - ";

/**
 * Deterministic demo dataset. Seeded only when the lab is empty. Temperatures
 * in degrees Celsius. These mirror realistic cold-storage classes.
 */
export const SEED_EQUIPMENT = [
  {
    name: "Ultra-Low Freezer A",
    type: "Ultra-low freezer",
    location: `${DEMO_LOCATION_PREFIX}Cold Room 1`,
    min_temperature: -86,
    max_temperature: -70,
    storage_capacity: 40,
    sample_limit: 20,
    status: "operational",
  },
  {
    name: "Ultra-Low Freezer B",
    type: "Ultra-low freezer",
    location: `${DEMO_LOCATION_PREFIX}Cold Room 1`,
    min_temperature: -86,
    max_temperature: -65,
    storage_capacity: 60,
    sample_limit: 30,
    status: "operational",
  },
  {
    name: "Vaccine Fridge",
    type: "Pharmaceutical fridge",
    location: `${DEMO_LOCATION_PREFIX}Lab 2`,
    min_temperature: 2,
    max_temperature: 8,
    storage_capacity: 50,
    sample_limit: null,
    status: "operational",
  },
  {
    name: "Incubator 37C",
    type: "CO2 incubator",
    location: `${DEMO_LOCATION_PREFIX}Lab 3`,
    min_temperature: 36,
    max_temperature: 38,
    storage_capacity: 30,
    sample_limit: 15,
    status: "operational",
  },
] as const;

/**
 * Seed samples, keyed by the index of their home equipment in SEED_EQUIPMENT.
 * Ranges are chosen so most are rescuable into at least one sibling unit, with
 * one deliberately hard-to-place sample for the infeasible-case demo.
 */
export const SEED_SAMPLES: Array<{
  equipmentIndex: number;
  name: string;
  min_temperature: number;
  max_temperature: number;
  storage_space: number;
  priority: string;
}> = [
  {
    equipmentIndex: 0,
    name: "Patient Plasma Lot P-101",
    min_temperature: -86,
    max_temperature: -70,
    storage_space: 8,
    priority: "critical",
  },
  {
    equipmentIndex: 0,
    name: "Cell Line CL-22",
    min_temperature: -80,
    max_temperature: -70,
    storage_space: 6,
    priority: "high",
  },
  {
    equipmentIndex: 0,
    name: "RNA Extract R-7",
    min_temperature: -80,
    max_temperature: -72,
    storage_space: 4,
    priority: "medium",
  },
  {
    equipmentIndex: 2,
    name: "Vaccine Vials V-900",
    min_temperature: 2,
    max_temperature: 8,
    storage_space: 10,
    priority: "critical",
  },
  {
    equipmentIndex: 3,
    name: "Culture Flask CF-3",
    min_temperature: 36,
    max_temperature: 38,
    storage_space: 5,
    priority: "high",
  },
];
