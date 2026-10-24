import { useEquipmentList, useSamples } from "../hooks/queries";
import { EmptyState, ErrorState, QueryBoundary } from "../components/QueryState";
import { IncidentCard } from "../components/IncidentCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { useIncidentStore } from "../store/incidentStore";
import type { Incident } from "../domain/incident";
import type { EquipmentRead, SampleRead } from "../api/types";
import { formatClock } from "../lib/format";
import { useDocumentTitle } from "../lib/useDocumentTitle";

function durationText(incident: Incident): string {
  const start = incident.timeline[0]?.at;
  const end = incident.timeline[incident.timeline.length - 1]?.at;
  if (start == null || end == null) return "";
  const s = Math.max(0, Math.round((end - start) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function clockOf(at: number | undefined): string {
  return at == null ? "—" : formatClock(new Date(at).toISOString());
}

export function IncidentsPage() {
  useDocumentTitle("Incident Response");
  const equipment = useEquipmentList();
  const samples = useSamples();
  const store = useIncidentStore();

  const equipmentList = equipment.data ?? [];
  const sampleList = samples.data ?? [];
  const byId = new Map(equipmentList.map((e) => [e.id, e]));
  const active = store.incidents.filter((i) => i.state !== "resolved");
  const resolved = store.incidents.filter((i) => i.state === "resolved");

  const card = (incident: Incident, eq: EquipmentRead | undefined, list: SampleRead[]) => (
    <IncidentCard
      key={incident.id}
      incident={incident}
      equipment={eq}
      samplesBySource={list.filter((s) => s.equipment_id === incident.equipmentId)}
      allEquipment={equipmentList}
      allSamples={list}
    />
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Incident Response</h1>
          <p className="page-subtitle">
            Detection, assessment, rescue planning, responder actions, and recovery checks.
            Incident records are kept in this browser only; the backend has no incident API.
          </p>
        </div>
      </div>

      {samples.isError && !samples.data ? (
        <ErrorState error={samples.error} onRetry={() => void samples.refetch()} />
      ) : null}

      <QueryBoundary query={equipment}>
        {() => (
          <div className="stack" style={{ gap: "var(--space-5)" }}>
            <section aria-labelledby="active-heading">
              <h2 id="active-heading" style={{ fontSize: "var(--fs-lg)" }}>
                Active incidents ({active.length})
              </h2>
              {active.length === 0 ? (
                <EmptyState
                  title="No active incidents"
                  hint="Open a demo unit's telemetry page and switch on Hardware failure or Abnormal temperature. Detection runs on every page."
                />
              ) : (
                <div className="stack" style={{ gap: "var(--space-4)" }}>
                  {active.map((i) => card(i, byId.get(i.equipmentId), sampleList))}
                </div>
              )}
            </section>

            <section aria-labelledby="history-heading">
              <h2 id="history-heading" style={{ fontSize: "var(--fs-lg)" }}>
                Incident history ({resolved.length})
              </h2>
              {resolved.length === 0 ? (
                <p className="muted">Resolved incidents appear here with their full record.</p>
              ) : (
                <ul className="history-list">
                  {resolved.map((i) => {
                    const executed = i.timeline.find((t) => t.state === "executed");
                    return (
                      <li key={i.id} className="card history-item">
                        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
                          <strong>{i.equipmentName}</strong>
                          <SeverityBadge level="ok" label="Resolved" />
                          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                            detected {clockOf(i.timeline[0]?.at)} · resolved{" "}
                            {clockOf(i.timeline[i.timeline.length - 1]?.at)} · {durationText(i)}
                          </span>
                        </div>
                        <p style={{ margin: "var(--space-2) 0", fontSize: "var(--fs-sm)" }}>
                          {i.assessment.cause}
                        </p>
                        <p className="muted" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
                          Action: {executed?.note ?? "no relocation needed"} · Recovery check:{" "}
                          {i.recovery?.checks.filter((c) => c.ok).length ?? 0} of{" "}
                          {i.recovery?.checks.length ?? 0} sample location(s) verified · Sample
                          viability not assessed.
                        </p>
                        <details className="timeline-details">
                          <summary>Full incident record</summary>
                          {card(i, byId.get(i.equipmentId), sampleList)}
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
