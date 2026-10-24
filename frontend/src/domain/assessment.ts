/**
 * Pure, explainable incident assessment.
 *
 * Deterministic and rule-based, computed in the browser from backend
 * telemetry. It is NOT a backend AI verdict and NOT an ML model output: the
 * backend exposes no anomaly-detection endpoint. The result separates
 *   - evidence:  values observed in backend data,
 *   - derived:   values computed here from that data,
 *   - unknowns:  what this data cannot tell us,
 * and never asserts a physical failure cause the data cannot support.
 */

import type { EquipmentRead, SensorReadingRead } from "../api/types";
import { NO_READINGS_YET, type NoReadingsYet } from "../api/client";
import { classifyEquipment, type Health } from "./detection";

export type AssessmentSeverity = "none" | "info" | "warning" | "critical";

/** Qualitative rating of how much the data supports the assessment. */
export type EvidenceStrength = "strong" | "moderate" | "limited" | "insufficient";

export interface EvidenceItem {
  label: string;
  /** Human-readable, exact formatted value (traceable). */
  detail: string;
  facts?: Record<string, number>;
}

export interface Assessment {
  source: "derived";
  /** How the assessment was produced, in plain language. */
  method: string;
  severity: AssessmentSeverity;
  /** Plain-language summary of what the data shows. */
  cause: string;
  /** Values observed in backend data. */
  evidence: EvidenceItem[];
  /** Values computed in the browser from the observed data. */
  derived: EvidenceItem[];
  /** Missing evidence and limits of this assessment. */
  unknowns: string[];
  /** Internal heuristic score in [0, 1]. Not a probability. */
  confidence: number;
  /** Qualitative label shown to users instead of the score. */
  strength: EvidenceStrength;
  /** The decision recommended to the human responder. */
  recommendation: string;
}

export interface AssessmentInput {
  equipment: EquipmentRead;
  latestReading: SensorReadingRead | NoReadingsYet | null;
  history?: SensorReadingRead[];
  now: number;
}

export const ASSESSMENT_METHOD =
  "Deterministic threshold rules on backend telemetry (latest reading, allowed range, reported status, recent history). No machine-learning anomaly model is available from the backend.";

const PHYSICAL_CAUSE_UNKNOWN =
  "The physical cause (compressor, door, power, or sensor fault) cannot be determined from temperature data alone.";

const HEALTH_TO_SEVERITY: Record<Health, AssessmentSeverity> = {
  ok: "none",
  warning: "warning",
  critical: "critical",
  unknown: "info",
};

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function strengthFor(confidence: number): EvidenceStrength {
  if (confidence >= 0.9) return "strong";
  if (confidence >= 0.7) return "moderate";
  if (confidence >= 0.4) return "limited";
  return "insufficient";
}

/**
 * Count of the most recent consecutive out-of-range readings in `history`
 * (newest first per the backend contract).
 */
function consecutiveExcursions(
  history: SensorReadingRead[],
  min: number,
  max: number,
): number {
  let count = 0;
  for (const r of history) {
    if (r.temperature > max || r.temperature < min) count += 1;
    else break;
  }
  return count;
}

export function assessIncident(input: AssessmentInput): Assessment {
  const { equipment, latestReading, history, now } = input;
  const classification = classifyEquipment({ equipment, latestReading, now });
  const offline = equipment.status === "offline";
  const severity = HEALTH_TO_SEVERITY[classification.health];

  if (latestReading == null || latestReading === NO_READINGS_YET) {
    const confidence = offline ? 0.5 : 0.1;
    return {
      source: "derived",
      method: ASSESSMENT_METHOD,
      severity: offline ? "critical" : "info",
      cause: offline
        ? `${equipment.name} is reported offline and has no temperature readings.`
        : "Insufficient data: no temperature readings have been recorded yet.",
      evidence: [
        { label: "Reported status", detail: equipment.status },
        { label: "Readings available", detail: "none" },
      ],
      derived: [],
      unknowns: [
        "The current temperature is unknown because no reading has been recorded.",
        ...(offline ? ["The backend reports 'offline' without failure details."] : []),
      ],
      confidence,
      strength: strengthFor(confidence),
      recommendation: offline
        ? "Acknowledge the incident and check the unit; plan a rescue if its contents are at risk."
        : "Start monitoring (the simulator in this demo) to gather readings before assessing.",
    };
  }

  const reading = latestReading;
  const temp = reading.temperature;
  const { min_temperature: min, max_temperature: max } = equipment;
  const ageS =
    classification.ageMs != null ? Math.round(classification.ageMs / 1000) : null;

  const evidence: EvidenceItem[] = [
    {
      label: "Latest reading",
      detail: `${round(temp)} °C`,
      facts: { temperature: temp },
    },
    {
      label: "Recorded at",
      detail: new Date(reading.timestamp).toLocaleTimeString(),
    },
    { label: "Allowed range", detail: `${round(min)} to ${round(max)} °C`, facts: { min, max } },
    { label: "Reported status", detail: equipment.status },
  ];

  const derived: EvidenceItem[] = [];
  if (ageS != null) {
    derived.push({ label: "Reading age", detail: `${ageS} s`, facts: { ageS } });
  }
  if (temp > max) {
    derived.push({ label: "Above upper limit by", detail: `${round(temp - max)} °C` });
  } else if (temp < min) {
    derived.push({ label: "Below lower limit by", detail: `${round(min - temp)} °C` });
  } else {
    derived.push({
      label: "Headroom to nearest limit",
      detail: `${round(Math.min(max - temp, temp - min))} °C`,
    });
  }

  const unknowns: string[] = [PHYSICAL_CAUSE_UNKNOWN];
  let sustained = 0;
  if (history && history.length > 0) {
    sustained = consecutiveExcursions(history, min, max);
    derived.push({
      label: "Consecutive out-of-range readings",
      detail: `${sustained} of last ${history.length}`,
      facts: { consecutive: sustained, window: history.length },
    });
    if (history.length < 3) {
      unknowns.push("Fewer than 3 readings are available, so the trend cannot be assessed.");
    }
  } else {
    unknowns.push("Recent history was not evaluated; this assessment uses the latest reading only.");
  }
  if (classification.isStale && ageS != null) {
    unknowns.push(`No reading for ${ageS} s; the current temperature may differ from the last value.`);
  }
  if (offline) {
    unknowns.push("The backend reports 'offline' without failure details.");
  }

  const corroborated = sustained > 1;
  let cause: string;
  let recommendation: string;
  let confidence: number;

  if (offline) {
    const outside = temp > max || temp < min;
    cause = `${equipment.name} is reported offline; its latest reading is ${round(temp)} °C${
      outside ? `, outside the allowed ${round(min)} to ${round(max)} °C range` : ""
    }.`;
    recommendation =
      "Acknowledge the incident, review the rescue plan, and relocate samples to compatible storage.";
    confidence = corroborated ? 0.95 : 0.85;
  } else if (temp > max) {
    cause = `${equipment.name} is too warm: ${round(temp)} °C exceeds the ${round(
      max,
    )} °C limit by ${round(temp - max)} °C.`;
    recommendation =
      "Acknowledge the incident, review the rescue plan, and relocate at-risk samples to compatible storage.";
    confidence = corroborated ? 0.95 : 0.8;
  } else if (temp < min) {
    cause = `${equipment.name} is too cold: ${round(temp)} °C is ${round(
      min - temp,
    )} °C below the ${round(min)} °C limit.`;
    recommendation =
      "Check the unit's set point; relocate samples if the excursion persists.";
    confidence = corroborated ? 0.95 : 0.8;
  } else if (classification.isStale) {
    cause = `Telemetry from ${equipment.name} is stale: the last reading (${round(
      temp,
    )} °C) is ${ageS ?? "?"} s old, so the current temperature is unknown.`;
    recommendation =
      "Check the sensor and network link. If readings do not resume, treat the contents as at risk.";
    confidence = 0.5;
  } else if (severity === "warning") {
    cause = `${equipment.name} is within range but close to a limit (${round(temp)} °C).`;
    recommendation = "Monitor closely; no relocation is needed yet.";
    confidence = 0.75;
  } else {
    cause = `${equipment.name} is operating within its allowed range (${round(temp)} °C).`;
    recommendation = "No action needed.";
    confidence = 0.9;
  }

  return {
    source: "derived",
    method: ASSESSMENT_METHOD,
    severity,
    cause,
    evidence,
    derived,
    unknowns,
    confidence: round(confidence, 2),
    strength: strengthFor(confidence),
    recommendation,
  };
}
