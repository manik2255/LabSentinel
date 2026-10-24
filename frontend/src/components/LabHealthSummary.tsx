import type { EquipmentRead } from "../api/types";
import type { Classification } from "../domain/detection";
import { clampNonNegative } from "../lib/format";

export interface UnitHealth {
  equipment: EquipmentRead;
  classification: Classification;
}

export function summarize(units: UnitHealth[]) {
  let critical = 0;
  let attention = 0;
  let healthy = 0;
  let noData = 0;
  for (const u of units) {
    const h = u.classification.health;
    if (h === "critical") critical += 1;
    else if (h === "warning") attention += 1;
    else if (h === "ok") healthy += 1;
    else noData += 1;
  }
  return { critical, attention, healthy, noData };
}

/** Lab-wide counts from live classifications, each labeled in text. */
export function LabHealthSummary({ units }: { units: UnitHealth[] }) {
  const { critical, attention, healthy, noData } = summarize(units);
  const total = units.reduce((s, u) => s + clampNonNegative(u.equipment.storage_capacity), 0);
  const used = units.reduce((s, u) => s + clampNonNegative(u.equipment.used_storage), 0);
  const storagePct = total === 0 ? 0 : Math.round((used / total) * 100);

  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Units", value: String(units.length) },
    { label: "Critical", value: String(critical), tone: critical ? "var(--critical)" : undefined },
    {
      label: "Needs attention",
      value: String(attention),
      tone: attention ? "var(--warn)" : undefined,
    },
    { label: "Healthy", value: String(healthy), tone: healthy ? "var(--ok)" : undefined },
    { label: "No data yet", value: String(noData) },
    { label: "Storage used", value: `${storagePct}%` },
  ];

  return (
    <dl className="card summary-grid" aria-label="Laboratory status summary">
      {stats.map((s) => (
        <div key={s.label}>
          <dt className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {s.label}
          </dt>
          <dd className="summary-value" style={{ color: s.tone ?? "var(--text-primary)" }}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
