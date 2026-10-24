/**
 * Pure fault-detection logic.
 *
 * Classifies a single piece of equipment's health from its allowed range, its
 * reported status, and its latest reading. Deterministic and side-effect free
 * (the clock is injected) so it can be unit-tested exactly.
 *
 * This is frontend-derived domain logic: the backend exposes readings and
 * status, but does not classify health itself.
 */

import { STALENESS_MS, WARNING_MARGIN_FRACTION } from "../config";
import type { EquipmentRead, SensorReadingRead } from "../api/types";
import { NO_READINGS_YET, type NoReadingsYet } from "../api/client";

export type Health = "ok" | "warning" | "critical" | "unknown";

export type ReasonCode =
  | "offline"
  | "above_max"
  | "below_min"
  | "stale"
  | "near_max"
  | "near_min"
  | "no_data"
  | "in_range";

export interface Reason {
  code: ReasonCode;
  message: string;
  /** Raw numeric facts backing this reason, when applicable. */
  facts?: Record<string, number>;
}

export interface ClassificationInput {
  equipment: EquipmentRead;
  latestReading: SensorReadingRead | NoReadingsYet | null;
  now: number;
  stalenessMs?: number;
  warningMarginFraction?: number;
}

export interface Classification {
  health: Health;
  reasons: Reason[];
  /** The reading age in ms, when a reading exists. */
  ageMs: number | null;
  isStale: boolean;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Severity ordering used to pick the dominant reason / escalate health. */
const SEVERITY_RANK: Record<Health, number> = {
  unknown: 0,
  ok: 1,
  warning: 2,
  critical: 3,
};

export function classifyEquipment(input: ClassificationInput): Classification {
  const {
    equipment,
    latestReading,
    now,
    stalenessMs = STALENESS_MS,
    warningMarginFraction = WARNING_MARGIN_FRACTION,
  } = input;

  const reasons: Reason[] = [];
  let health: Health = "ok";
  const escalate = (h: Health) => {
    if (SEVERITY_RANK[h] > SEVERITY_RANK[health]) health = h;
  };

  // Equipment reported offline is always critical, independent of readings.
  const offline = equipment.status === "offline";
  if (offline) {
    escalate("critical");
    reasons.push({
      code: "offline",
      message: `${equipment.name} is reported offline by the backend.`,
    });
  }

  // No reading available yet.
  if (latestReading == null || latestReading === NO_READINGS_YET) {
    reasons.push({
      code: "no_data",
      message: "No temperature readings have been recorded yet.",
    });
    // Without data we cannot assert OK; if not already offline, it's unknown.
    if (!offline) health = "unknown";
    return { health, reasons, ageMs: null, isStale: false };
  }

  const reading = latestReading as SensorReadingRead;
  const temp = reading.temperature;
  const readTime = Date.parse(reading.timestamp);
  const ageMs = Number.isNaN(readTime) ? null : Math.max(0, now - readTime);
  const isStale = ageMs != null && ageMs > stalenessMs;

  const { min_temperature: min, max_temperature: max } = equipment;

  if (temp > max) {
    escalate("critical");
    reasons.push({
      code: "above_max",
      message: `${round(temp)}°C exceeds max ${round(max)}°C by ${round(
        temp - max,
      )}°C.`,
      facts: { temperature: temp, max, exceedBy: round(temp - max) },
    });
  } else if (temp < min) {
    escalate("critical");
    reasons.push({
      code: "below_min",
      message: `${round(temp)}°C is below min ${round(min)}°C by ${round(
        min - temp,
      )}°C.`,
      facts: { temperature: temp, min, belowBy: round(min - temp) },
    });
  }

  // Stale telemetry means the current value is unknown. On its own that is a
  // warning (check the sensor/link), not an emergency; a stale value that is
  // still out of range stays critical through the checks above. Reasons are
  // ordered by importance: offline, excursion, stale, near-limit.
  if (isStale) {
    escalate("warning");
    reasons.push({
      code: "stale",
      message: `No fresh reading for ${Math.round(
        (ageMs as number) / 1000,
      )}s — telemetry is stale.`,
      facts: { ageMs: ageMs as number, stalenessMs },
    });
  }

  if (temp <= max && temp >= min) {
    // In range: check proximity to a bound for a WARNING.
    const span = Math.max(max - min, 1e-9);
    const margin = span * warningMarginFraction;
    const nearMax = temp >= max - margin;
    const nearMin = temp <= min + margin;
    if (nearMax) {
      escalate("warning");
      reasons.push({
        code: "near_max",
        message: `${round(temp)}°C is within ${round(
          max - temp,
        )}°C of the upper limit ${round(max)}°C.`,
        facts: { temperature: temp, max, headroom: round(max - temp) },
      });
    } else if (nearMin) {
      escalate("warning");
      reasons.push({
        code: "near_min",
        message: `${round(temp)}°C is within ${round(
          temp - min,
        )}°C of the lower limit ${round(min)}°C.`,
        facts: { temperature: temp, min, headroom: round(temp - min) },
      });
    } else if (!offline && !isStale) {
      reasons.push({
        code: "in_range",
        message: `${round(temp)}°C is within the allowed range [${round(
          min,
        )}, ${round(max)}]°C.`,
        facts: { temperature: temp, min, max },
      });
    }
  }

  return { health, reasons, ageMs, isStale };
}

/** Whether a classification represents an active incident worth responding to. */
export function isIncident(classification: Classification): boolean {
  return classification.health === "critical";
}
