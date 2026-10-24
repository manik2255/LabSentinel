import type { Assessment, EvidenceItem, EvidenceStrength } from "../domain/assessment";
import { SeverityBadge } from "./SeverityBadge";

const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: "Strong",
  moderate: "Moderate",
  limited: "Limited",
  insufficient: "Insufficient",
};

type Level = 2 | 3 | 4;

function Heading({ level, children, id }: { level: Level; children: string; id?: string }) {
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag id={id} className="section-title" style={{ margin: 0 }}>
      {children}
    </Tag>
  );
}

function SubHeading({ level, children }: { level: Level; children: string }) {
  const Tag = `h${Math.min(level + 1, 5)}` as "h3" | "h4" | "h5";
  return <Tag className="subheading">{children}</Tag>;
}

function KeyValues({ items }: { items: EvidenceItem[] }) {
  return (
    <dl className="kv">
      {items.map((e) => (
        <div key={e.label} className="kv-row">
          <dt>{e.label}</dt>
          <dd className="mono">{e.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Explainable assessment. Separates what the backend data shows, what this
 * browser computed from it, and what the data cannot tell us, then states
 * the decision recommended to the responder. Rule-based; not an ML verdict.
 */
export function AssessmentPanel({
  assessment,
  headingLevel = 3,
  title = "Incident Assessment",
}: {
  assessment: Assessment;
  headingLevel?: Level;
  title?: string;
}) {
  return (
    <section className="card section" aria-label={title}>
      <div
        className="row"
        style={{ justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}
      >
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <Heading level={headingLevel}>{title}</Heading>
          <SeverityBadge level={assessment.severity} />
        </div>
        <span className="derived-tag" title={assessment.method}>
          rule-based · derived locally
        </span>
      </div>

      <p className="assessment-summary">{assessment.cause}</p>

      <p className="evidence-strength">
        <span className={`strength strength-${assessment.strength}`}>
          Evidence: {STRENGTH_LABEL[assessment.strength]}
        </span>
        <span className="muted"> Qualitative rating from fixed rules. It is not a probability of failure.</span>
      </p>

      <SubHeading level={headingLevel}>Observed (backend data)</SubHeading>
      <KeyValues items={assessment.evidence} />

      {assessment.derived.length > 0 ? (
        <>
          <SubHeading level={headingLevel}>Derived (computed in browser)</SubHeading>
          <KeyValues items={assessment.derived} />
        </>
      ) : null}

      {assessment.unknowns.length > 0 ? (
        <>
          <SubHeading level={headingLevel}>Not known from this data</SubHeading>
          <ul className="unknowns">
            {assessment.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="recommendation">
        <strong>Recommended decision:</strong> {assessment.recommendation}
      </div>
      <p className="muted method-note">{assessment.method}</p>
    </section>
  );
}
