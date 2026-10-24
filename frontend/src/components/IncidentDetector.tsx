import { useEffect } from "react";
import { useEquipmentList, useLatestReading } from "../hooks/queries";
import type { EquipmentRead } from "../api/types";
import { classifyEquipment, isIncident } from "../domain/detection";
import { assessIncident } from "../domain/assessment";
import { useIncidentStore } from "../store/incidentStore";
import { useNow } from "../lib/clock";

/**
 * Headless per-unit detector. When a unit becomes critical it opens an
 * incident (the store keeps one active incident per unit). The assessment is
 * captured at detection time; the incident page shows the live plan.
 *
 * NOTE: As of the backend risk-detection integration, this is intentionally
 * NOT mounted anywhere. The backend now owns incident creation (detection
 * raises incidents server-side), so creating incidents locally as a side
 * effect of displaying risk would cause duplicates once incident management is
 * connected. This component is kept only as a reference for that later phase.
 */
export function IncidentDetector({ equipment }: { equipment: EquipmentRead }) {
  const latest = useLatestReading(equipment.id);
  const { detect, rearm, latched } = useIncidentStore();
  const now = useNow();
  const isLatched = latched.has(equipment.id);

  const critical = isIncident(
    classifyEquipment({ equipment, latestReading: latest.data ?? null, now }),
  );

  // A resolved unit re-arms once it is observed non-critical again.
  useEffect(() => {
    if (!critical && isLatched) rearm(equipment.id);
  }, [critical, isLatched, rearm, equipment.id]);

  useEffect(() => {
    if (!critical) return;
    detect(
      equipment,
      assessIncident({ equipment, latestReading: latest.data ?? null, now: Date.now() }),
    );
    // Fire on the transition into "critical" only; the values read inside are
    // the ones current at that moment, and later detections are deduplicated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment.id, critical, detect]);

  return null;
}

/** Runs detection for every unit, regardless of which page is open. */
export function LabWideDetection() {
  const equipment = useEquipmentList();
  return (
    <>
      {(equipment.data ?? []).map((e) => (
        <IncidentDetector key={e.id} equipment={e} />
      ))}
    </>
  );
}
