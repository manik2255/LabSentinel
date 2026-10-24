import { useId } from "react";
import { Link } from "react-router-dom";
import { useLatestReading } from "../hooks/queries";
import type { EquipmentRead } from "../api/types";
import { NO_READINGS_YET } from "../api/client";
import { classifyEquipment, type Health } from "../domain/detection";
import { isDemoEquipment } from "../domain/demoScope";
import { HealthBadge } from "./SeverityBadge";
import { CapacityBar } from "./CapacityBar";
import { ArrowRightIcon, ThermometerIcon } from "./Icons";
import { formatRange, formatRelativeTime, formatTemp } from "../lib/format";
import { useNow } from "../lib/clock";

const HEALTH_BORDER: Record<Health, string> = {
  ok: "var(--border)",
  warning: "var(--warn)",
  critical: "var(--critical)",
  unknown: "var(--border)",
};

const HEALTH_ICON_COLOR: Record<Health, string> = {
  ok: "var(--ok)",
  warning: "var(--warn)",
  critical: "var(--critical)",
  unknown: "var(--unknown)",
};

export function EquipmentCard({ equipment }: { equipment: EquipmentRead }) {
  const nameId = useId();
  const latest = useLatestReading(equipment.id);
  const now = useNow();
  const reading = latest.data ?? null;
  const classification = classifyEquipment({ equipment, latestReading: reading, now });
  const { health, isStale } = classification;

  const hasTemp = reading != null && reading !== NO_READINGS_YET;
  const temp = hasTemp ? reading.temperature : null;
  const primaryReason = health !== "ok" ? classification.reasons[0] : undefined;

  return (
    <article
      className="card equipment-card"
      aria-labelledby={nameId}
      style={{ borderColor: HEALTH_BORDER[health] }}
    >
      <header className="row" style={{ justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div style={{ minWidth: 0 }}>
          <h2 id={nameId} className="equipment-name">
            {equipment.name}
          </h2>
          <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {equipment.type} · {equipment.location}
          </div>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
          <HealthBadge health={health} isStale={isStale} />
          {isDemoEquipment(equipment) ? <span className="derived-tag">demo unit</span> : null}
        </div>
      </header>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="row" style={{ gap: 8 }}>
          <ThermometerIcon size={22} style={{ color: HEALTH_ICON_COLOR[health] }} />
          <div>
            <div
              className="reading-value"
              style={{ opacity: isStale ? 0.6 : 1 }}
              aria-label={temp != null ? `Latest reading ${formatTemp(temp)}` : "No reading"}
            >
              {temp != null ? formatTemp(temp) : "—"}
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              allowed {formatRange(equipment.min_temperature, equipment.max_temperature)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "var(--fs-xs)" }}>
          <div className="muted">status</div>
          <div style={{ fontWeight: 600 }}>{equipment.status}</div>
          <div className="muted" style={{ marginTop: 4 }}>
            {latest.data === NO_READINGS_YET
              ? "awaiting first reading"
              : hasTemp
                ? `updated ${formatRelativeTime(reading.timestamp, now)}`
                : latest.isError
                  ? "reading unavailable"
                  : "loading…"}
          </div>
        </div>
      </div>

      {primaryReason ? (
        <p
          className="card-reason"
          style={{ color: health === "critical" ? "var(--critical)" : "var(--warn)" }}
        >
          {primaryReason.message}
        </p>
      ) : null}

      <div className="stack" style={{ gap: "var(--space-3)" }}>
        <CapacityBar
          label="Storage"
          used={equipment.used_storage}
          total={equipment.storage_capacity}
        />
        <CapacityBar label="Slots" used={equipment.used_slots} total={equipment.sample_limit} />
      </div>

      <Link to={`/equipment/${equipment.id}`} className="btn" style={{ justifyContent: "center" }}>
        Telemetry &amp; controls
        <span className="visually-hidden"> for {equipment.name}</span>
        <ArrowRightIcon size={14} />
      </Link>
    </article>
  );
}
