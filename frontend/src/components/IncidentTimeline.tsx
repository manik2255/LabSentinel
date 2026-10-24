import type { Incident } from "../domain/incident";
import { formatClock } from "../lib/format";

const LABEL: Record<string, string> = {
  detected: "Detected",
  acknowledged: "Acknowledged",
  executing: "Executing rescue",
  executed: "Rescue executed",
  resolved: "Resolved",
};

export function IncidentTimeline({ incident }: { incident: Incident }) {
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-3)",
      }}
    >
      {incident.timeline.map((entry, i) => (
        <li key={i} className="row" style={{ gap: "var(--space-2)" }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background:
                entry.state === "resolved" ? "var(--ok)" : "var(--brand)",
            }}
          />
          <span style={{ fontSize: "var(--fs-xs)" }}>
            <strong>{LABEL[entry.state] ?? entry.state}</strong>{" "}
            <span className="muted mono">
              {formatClock(new Date(entry.at).toISOString())}
            </span>
            {entry.note ? <span className="muted"> · {entry.note}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
