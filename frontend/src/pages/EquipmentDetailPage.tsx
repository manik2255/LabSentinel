import { Link, useParams } from "react-router-dom";
import {
  useEquipmentList,
  useEquipmentRisk,
  useLatestReading,
  useReadingHistory,
} from "../hooks/queries";
import { ErrorState, QueryBoundary, Spinner } from "../components/QueryState";
import { TelemetryChart } from "../components/TelemetryChart";
import { RiskPanel } from "../components/RiskPanel";
import { FaultControls } from "../components/FaultControls";
import { HealthBadge, SeverityBadge } from "../components/SeverityBadge";
import { classifyEquipment } from "../domain/detection";
import { assessIncident } from "../domain/assessment";
import { isDemoEquipment } from "../domain/demoScope";
import { NO_READINGS_YET } from "../api/client";
import { formatClock, formatRange, formatRelativeTime, formatTemp } from "../lib/format";
import { ArrowRightIcon } from "../components/Icons";
import { useNow } from "../lib/clock";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function EquipmentDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const equipmentList = useEquipmentList();
  const equipment = equipmentList.data?.find((e) => e.id === id) ?? null;
  const latest = useLatestReading(validId ? id : null);
  const history = useReadingHistory(validId ? id : null);
  const risk = useEquipmentRisk(validId ? id : null);
  const now = useNow();
  useDocumentTitle(equipment ? equipment.name : "Equipment");

  if (equipmentList.isError && !equipmentList.data) {
    return (
      <ErrorState error={equipmentList.error} onRetry={() => void equipmentList.refetch()} />
    );
  }
  if (equipmentList.isLoading && !equipment) return <Spinner label="Loading equipment…" />;
  if (!equipment) {
    return (
      <div className="stack" style={{ gap: "var(--space-3)", alignItems: "flex-start" }}>
        <h1 className="page-title">Equipment not found</h1>
        <p className="muted">It may have been removed. Return to the overview to pick a unit.</p>
        <Link to="/" className="btn">
          Back to overview
        </Link>
      </div>
    );
  }

  const reading = latest.data ?? null;
  const classification = classifyEquipment({ equipment, latestReading: reading, now });
  const assessment = assessIncident({
    equipment,
    latestReading: reading,
    history: history.data,
    now,
  });
  const hasReading = reading != null && reading !== NO_READINGS_YET;
  // Header badge prefers the backend risk level; it falls back to the local
  // health classification only until the backend risk has loaded (or if it
  // fails), and that fallback is never presented as the backend result.
  const backendRisk = risk.data ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
            <h1 className="page-title">{equipment.name}</h1>
            {backendRisk ? (
              <SeverityBadge
                level={riskBadgeLevel(backendRisk.risk_level)}
                label={`${riskBadgeLabel(backendRisk.risk_level)} (backend)`}
              />
            ) : (
              <HealthBadge health={classification.health} isStale={classification.isStale} />
            )}
            {isDemoEquipment(equipment) ? <span className="derived-tag">demo unit</span> : null}
          </div>
          <p className="page-subtitle">
            {equipment.type} · {equipment.location} · allowed{" "}
            {formatRange(equipment.min_temperature, equipment.max_temperature)} · status{" "}
            {equipment.status}
          </p>
        </div>
        <Link to="/incidents" className="btn">
          Incident response <ArrowRightIcon size={14} />
        </Link>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: "var(--space-4)" }}>
          <section className="card section" aria-labelledby="telemetry-heading">
            <h2 id="telemetry-heading" className="section-title">
              Temperature Telemetry
            </h2>
            <p className="freshness" aria-live="polite">
              {latest.data === NO_READINGS_YET
                ? "Awaiting the first reading."
                : hasReading
                  ? `Latest ${formatTemp(reading.temperature)} at ${formatClock(reading.timestamp)} (${formatRelativeTime(reading.timestamp, now)})${classification.isStale ? " — stale" : ""}.`
                  : latest.isError
                    ? "Latest reading unavailable."
                    : "Loading latest reading…"}
            </p>
            <QueryBoundary query={history} loadingLabel="Loading history…">
              {(h) => <TelemetryChart equipment={equipment} history={h} />}
            </QueryBoundary>
          </section>
          <FaultControls equipment={equipment} />
        </div>
        <RiskPanel query={risk} localFallback={assessment} headingLevel={2} />
      </div>
    </div>
  );
}

/** Map a backend risk level to a shared SeverityBadge level. */
function riskBadgeLevel(
  riskLevel: string,
): "ok" | "info" | "warning" | "critical" {
  switch (riskLevel) {
    case "low":
      return "ok";
    case "medium":
    case "high":
      return "warning";
    case "critical":
      return "critical";
    default:
      return "info";
  }
}

function riskBadgeLabel(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
    case "critical":
      return "Critical risk";
    default:
      return `${riskLevel} risk`;
  }
}
