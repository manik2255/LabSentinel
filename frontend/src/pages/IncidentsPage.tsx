import { useState } from "react";
import {
  useBackendIncidents,
  useCapabilities,
  useEquipmentList,
  useSamples,
} from "../hooks/queries";
import { EmptyState, ErrorState, QueryBoundary, Spinner } from "../components/QueryState";
import { IncidentCard } from "../components/IncidentCard";
import { BackendIncidentCard } from "../components/BackendIncidentCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { useIncidentStore } from "../store/incidentStore";
import type { Incident } from "../domain/incident";
import type { EquipmentRead, IncidentSummary, SampleRead } from "../api/types";
import { formatBackendTime, formatClock } from "../lib/format";
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
  const caps = useCapabilities();
  if (caps.isLoading) return <Spinner label="Checking backend capabilities…" />;
  if (caps.data?.incidents) return <BackendIncidentsPage />;
  return <LocalIncidentsPage />;
}

/** Backend-authoritative incidents (persistent, audited). */
function BackendIncidentsPage() {
  const incidents = useBackendIncidents(true);
  const equipment = useEquipmentList();
  const samples = useSamples();
  const equipmentById = new Map((equipment.data ?? []).map((e) => [e.id, e]));
  const samplesById = new Map((samples.data ?? []).map((s) => [s.id, s]));
  const list = incidents.data ?? [];
  const active = list.filter((i) => i.status !== "closed");
  const closed = list.filter((i) => i.status === "closed");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Incident Response</h1>
          <p className="page-subtitle">
            Incidents are opened by backend detection and stored by the backend with a full audit
            trail. Planning uses the backend optimizer; approval, execution, recovery, and closure
            are backend actions.
          </p>
        </div>
      </div>
      <QueryBoundary query={incidents}>
        {() => (
          <div className="stack" style={{ gap: "var(--space-5)" }}>
            <section aria-labelledby="active-heading">
              <h2 id="active-heading" style={{ fontSize: "var(--fs-lg)" }}>
                Active incidents ({active.length})
              </h2>
              {active.length === 0 ? (
                <EmptyState
                  title="No active incidents"
                  hint="Open a demo unit's telemetry page and switch on Hardware failure. The backend opens an incident from the next simulator reading."
                />
              ) : (
                <div className="stack" style={{ gap: "var(--space-4)" }}>
                  {active.map((i) => (
                    <BackendIncidentCard
                      key={i.id}
                      incidentId={i.id}
                      equipmentById={equipmentById}
                      samplesById={samplesById}
                    />
                  ))}
                </div>
              )}
            </section>
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" style={{ fontSize: "var(--fs-lg)" }}>
                Incident history ({closed.length})
              </h2>
              {closed.length === 0 ? (
                <p className="muted">Closed incidents appear here with their backend audit trail.</p>
              ) : (
                <ul className="history-list">
                  {closed.map((i) => (
                    <BackendHistoryItem
                      key={i.id}
                      incident={i}
                      name={equipmentById.get(i.equipment_id)?.name ?? `Equipment #${i.equipment_id}`}
                      equipmentById={equipmentById}
                      samplesById={samplesById}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

function BackendHistoryItem({
  incident,
  name,
  equipmentById,
  samplesById,
}: {
  incident: IncidentSummary;
  name: string;
  equipmentById: ReadonlyMap<number, EquipmentRead>;
  samplesById: ReadonlyMap<number, SampleRead>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card history-item">
      <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong>{name}</strong>
        <SeverityBadge level="ok" label="Closed" />
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          backend record #{incident.id} · detected {formatBackendTime(incident.created_at)} · closed{" "}
          {formatBackendTime(incident.updated_at)} · recovery {incident.recovery_status}
        </span>
      </div>
      <p style={{ margin: "var(--space-2) 0", fontSize: "var(--fs-sm)" }}>{incident.summary}</p>
      <details className="timeline-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Full incident record</summary>
        {open ? (
          <BackendIncidentCard incidentId={incident.id} equipmentById={equipmentById} samplesById={samplesById} />
        ) : null}
      </details>
    </li>
  );
}

/** Browser-only workflow, used when the backend has no incident API. */
function LocalIncidentsPage() {
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
