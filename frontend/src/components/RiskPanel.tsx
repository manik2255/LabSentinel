/**
 * Backend-sourced equipment risk panel.
 *
 * Shows the anomaly-risk assessment produced by the BACKEND (Isolation Forest
 * + explainable rules) via GET /api/detection/equipment/{id}/risk. It reuses
 * the same card/section/badge styling as the local AssessmentPanel so the
 * screen layout is unchanged.
 *
 * Honesty rules (by design):
 *  - When the backend risk is available, it is shown and clearly labelled as
 *    the backend AI result.
 *  - When the backend risk request FAILS, we do NOT silently present the
 *    browser's own rule-based estimate as if it were the backend verdict. We
 *    surface the error and offer the local calculation only as an explicitly
 *    labelled "local estimate" fallback.
 *  - Loading and "insufficient data" states are shown explicitly.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import type { RiskResponse } from "../api/types";
import type { Assessment } from "../domain/assessment";
import { ApiError } from "../api/client";
import { SeverityBadge } from "./SeverityBadge";
import { AssessmentPanel } from "./AssessmentPanel";
import { Spinner } from "./QueryState";
import { RetryIcon } from "./Icons";

type Level = 2 | 3 | 4;

const BACKEND_METHOD =
  "Computed by the backend: an Isolation Forest anomaly model combined with explainable range/status rules over recent telemetry.";

/** Map a backend risk level to the shared SeverityBadge level + label. */
function badgeFor(riskLevel: string): { level: "ok" | "info" | "warning" | "critical"; label: string } {
  switch (riskLevel) {
    case "low":
      return { level: "ok", label: "Low risk" };
    case "medium":
      return { level: "warning", label: "Medium risk" };
    case "high":
      return { level: "warning", label: "High risk" };
    case "critical":
      return { level: "critical", label: "Critical risk" };
    default:
      return { level: "info", label: `${riskLevel} risk` };
  }
}

function Heading({ level, children }: { level: Level; children: string }) {
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag className="section-title" style={{ margin: 0 }}>
      {children}
    </Tag>
  );
}

function BackendRisk({ risk, headingLevel }: { risk: RiskResponse; headingLevel: Level }) {
  const badge = badgeFor(risk.risk_level);
  return (
    <section className="card section" aria-label="Equipment risk assessment">
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}
      >
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <Heading level={headingLevel}>Risk Assessment</Heading>
          <SeverityBadge level={badge.level} label={badge.label} />
        </div>
        <span className="derived-tag" title={BACKEND_METHOD}>
          backend AI · Isolation Forest
        </span>
      </div>

      {risk.insufficient_data ? (
        <p className="assessment-summary">
          Not enough readings yet for anomaly scoring; the backend is reporting
          range and status based risk only.
        </p>
      ) : null}

      <dl className="kv">
        <div className="kv-row">
          <dt>Risk level</dt>
          <dd className="mono">{risk.risk_level}</dd>
        </div>
        <div className="kv-row">
          <dt>Latest temperature</dt>
          <dd className="mono">
            {risk.temperature == null ? "no reading yet" : `${risk.temperature} °C`}
          </dd>
        </div>
        <div className="kv-row">
          <dt>Anomaly score</dt>
          <dd className="mono">
            {risk.anomaly_score.toFixed(3)} {risk.is_anomaly ? "(anomaly)" : ""}
          </dd>
        </div>
        <div className="kv-row">
          <dt>Readings analysed</dt>
          <dd className="mono">{risk.reading_count}</dd>
        </div>
      </dl>

      {risk.reasons.length > 0 ? (
        <>
          <h4 className="subheading">Why (backend reasons)</h4>
          <ul className="unknowns">
            {risk.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      {risk.endangered_samples.length > 0 ? (
        <>
          <h4 className="subheading">Endangered samples</h4>
          <ul className="unknowns">
            {risk.endangered_samples.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="muted method-note">{BACKEND_METHOD}</p>
    </section>
  );
}

/**
 * Renders the backend risk, with loading/error handling. `localFallback` is the
 * browser's own rule-based assessment, shown ONLY if the backend request fails,
 * clearly labelled as a local estimate (never passed off as the backend AI).
 */
export function RiskPanel({
  query,
  localFallback,
  headingLevel = 2,
}: {
  query: UseQueryResult<RiskResponse>;
  localFallback: Assessment;
  headingLevel?: Level;
}) {
  if (query.data !== undefined) {
    return <BackendRisk risk={query.data} headingLevel={headingLevel} />;
  }

  if (query.isLoading) {
    return (
      <section className="card section" aria-label="Equipment risk assessment">
        <Heading level={headingLevel}>Risk Assessment</Heading>
        <p style={{ marginTop: "var(--space-3)" }}>
          <Spinner label="Assessing risk with the backend model…" />
        </p>
      </section>
    );
  }

  // Error: be explicit that the backend risk is unavailable, then offer the
  // local estimate as a clearly-labelled fallback (not the backend verdict).
  const message =
    query.error instanceof ApiError
      ? query.error.status === 0
        ? "Cannot reach the backend, so the AI risk assessment is unavailable."
        : `The backend risk assessment is unavailable (${query.error.detail}).`
      : "The backend risk assessment is unavailable.";

  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      <div
        role="alert"
        className="card"
        style={{
          padding: "var(--space-4)",
          borderColor: "var(--warn)",
          background: "var(--warn-bg)",
        }}
      >
        <div style={{ color: "var(--warn)", fontWeight: 600 }}>{message}</div>
        <p className="muted" style={{ margin: "var(--space-2) 0 0" }}>
          Showing a local estimate below instead. It is computed in this browser
          and is not the backend AI result.
        </p>
        <button
          className="btn"
          style={{ marginTop: "var(--space-3)" }}
          onClick={() => void query.refetch()}
        >
          <RetryIcon size={14} /> Retry backend assessment
        </button>
      </div>
      <LocalEstimate assessment={localFallback} headingLevel={headingLevel} />
    </div>
  );
}

/** The local rule-based assessment, visibly marked as a local estimate. */
function LocalEstimate({
  assessment,
  headingLevel,
}: {
  assessment: Assessment;
  headingLevel: Level;
}) {
  return (
    <div className="stack" style={{ gap: "var(--space-2)" }}>
      <span className="derived-tag" title={assessment.method}>
        local estimate · not the backend AI
      </span>
      <AssessmentPanel assessment={assessment} headingLevel={headingLevel} />
    </div>
  );
}
