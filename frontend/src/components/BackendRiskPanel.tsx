import { useId } from "react";
import { useRisk } from "../hooks/queries";
import type { RiskResponse } from "../api/types";
import { SeverityBadge } from "./SeverityBadge";
import { ErrorState, Spinner } from "./QueryState";

type Level = "ok" | "warning" | "critical" | "unknown";

export const RISK_BADGE: Record<string, Level> = {
  low: "ok",
  medium: "warning",
  high: "critical",
  critical: "critical",
};

/**
 * Backend risk assessment: Isolation Forest anomaly score plus the backend's
 * range, status, and sample rules. Read-only (never raises alerts).
 */
export function BackendRiskPanel({ equipmentId }: { equipmentId: number }) {
  const headingId = useId();
  const risk = useRisk(equipmentId, true);
  return (
    <section className="card section" aria-labelledby={headingId}>
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}
      >
        <h2 id={headingId} className="section-title" style={{ margin: 0 }}>
          ML Risk Assessment
        </h2>
        <span
          className="derived-tag"
          title="Computed by the backend: Isolation Forest anomaly model plus range, status, and sample rules."
        >
          backend · Isolation Forest
        </span>
      </div>
      {risk.data ? (
        <RiskBody risk={risk.data} />
      ) : risk.isError ? (
        <ErrorState error={risk.error} onRetry={() => void risk.refetch()} />
      ) : (
        <Spinner label="Loading risk…" />
      )}
    </section>
  );
}

function RiskBody({ risk }: { risk: RiskResponse }) {
  return (
    <div aria-live="polite">
      <p className="row" style={{ gap: "var(--space-3)", flexWrap: "wrap", margin: "var(--space-3) 0 var(--space-1)" }}>
        <SeverityBadge level={RISK_BADGE[risk.risk_level] ?? "unknown"} label={`Risk: ${risk.risk_level}`} />
        <span className="mono">anomaly score {risk.anomaly_score.toFixed(2)}</span>
      </p>
      <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
        Anomaly score: 0 = typical of normal readings, 1 = highly unusual. It is a relative outlier
        score from the model, not a probability of failure.
      </p>
      {risk.insufficient_data ? (
        <p className="notice notice-info" style={{ marginTop: "var(--space-2)" }}>
          Not enough readings yet ({risk.reading_count}); the model needs at least 3.
        </p>
      ) : null}
      <h3 className="subheading">Backend reasons</h3>
      <ul className="unknowns">
        {risk.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {risk.endangered_samples.length > 0 ? (
        <>
          <h3 className="subheading">Samples outside their safe range</h3>
          <ul className="unknowns">
            {risk.endangered_samples.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted method-note">
        Based on the last {risk.reading_count} reading(s). Viewing this check never creates alerts
        or incidents; the backend raises those from simulator readings.
      </p>
    </div>
  );
}
