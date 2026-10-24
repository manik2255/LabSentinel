/**
 * Backend-authoritative incident workflow. Every state shown here comes from
 * the backend; every action is a backend request whose response decides the
 * next state. Nothing is marked done before the backend confirms it.
 */
import { useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints";
import { ApiError } from "../api/client";
import type {
  BackendRescuePlan,
  EquipmentRead,
  IncidentDetail,
  IncidentEventRead,
  RecoveryOutcome,
  SampleRead,
} from "../api/types";
import {
  useBackendIncident,
  useIncidentEvents,
  useIncidentExecution,
  useIncidentPlan,
  useRisk,
  useSimulationStatus,
} from "../hooks/queries";
import { checkBackendPlanScope, isDemoEquipment } from "../domain/demoScope";
import { SeverityBadge } from "./SeverityBadge";
import { RISK_BADGE } from "./BackendRiskPanel";
import { ErrorState, Spinner } from "./QueryState";
import { formatBackendTime } from "../lib/format";

type Stage = "acknowledge" | "plan" | "review" | "execute" | "recovery" | "close" | "closed";

function stageOf(inc: IncidentDetail): Stage {
  if (inc.closed) return "closed";
  if (inc.status === "open" && inc.acknowledged_at == null) return "acknowledge";
  if (inc.rescue_plan_id == null || inc.rescue_plan_status === "none" || inc.rescue_plan_status === "rejected") {
    return "plan";
  }
  if (inc.rescue_plan_status === "planned") return "review";
  if (inc.rescue_plan_status === "approved") return "execute";
  if (!inc.recovery_recorded) return "recovery";
  return "close";
}

const TRIGGER_LABEL: Record<string, string> = {
  equipment_failure: "Equipment failure",
  critical_risk: "Critical risk",
  high_risk: "High risk",
};

function steps(inc: IncidentDetail) {
  const list = [
    { label: "Detected", actor: "Backend detection", done: true },
    { label: "Acknowledged", actor: "Responder", done: inc.acknowledged_at != null || inc.status !== "open" },
    {
      label: "Plan generated",
      actor: "Backend optimizer",
      done: inc.rescue_plan_id != null && !["none", "rejected"].includes(inc.rescue_plan_status),
    },
    { label: "Plan approved", actor: "Responder", done: inc.approval_recorded },
    { label: "Rescue executed", actor: "Backend, one transaction", done: inc.execution_recorded },
    { label: "Recovery recorded", actor: "Responder", done: inc.recovery_recorded },
    { label: "Closed", actor: "Responder", done: inc.closed },
  ];
  const current = list.findIndex((s) => !s.done);
  return list.map((s, i) => ({
    ...s,
    status: s.done ? "done" : i === current ? "current" : "pending",
  }));
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.status === 0 ? "Cannot reach the backend." : err.detail;
  return err instanceof Error ? err.message : String(err);
}

export function BackendIncidentCard({
  incidentId,
  equipmentById,
  samplesById,
}: {
  incidentId: number;
  equipmentById: ReadonlyMap<number, EquipmentRead>;
  samplesById: ReadonlyMap<number, SampleRead>;
}) {
  const query = useBackendIncident(incidentId);
  if (query.data) {
    return (
      <IncidentBody incident={query.data} equipmentById={equipmentById} samplesById={samplesById} />
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <Spinner label={`Loading incident #${incidentId}…`} />;
}

function IncidentBody({
  incident,
  equipmentById,
  samplesById,
}: {
  incident: IncidentDetail;
  equipmentById: ReadonlyMap<number, EquipmentRead>;
  samplesById: ReadonlyMap<number, SampleRead>;
}) {
  const titleId = useId();
  const qc = useQueryClient();
  const id = incident.id;
  const equipment = equipmentById.get(incident.equipment_id);
  const name = equipment?.name ?? `Equipment #${incident.equipment_id} (removed)`;
  const stage = stageOf(incident);
  const demoUnit = isDemoEquipment(equipment);

  const plan = useIncidentPlan(id, incident.rescue_plan_id);
  const execution = useIncidentExecution(id, incident.rescue_execution_id);
  const events = useIncidentEvents(id, !incident.closed);
  const sim = useSimulationStatus();
  const risk = useRisk(incident.equipment_id, stage === "recovery" || stage === "close");

  const [partialAck, setPartialAck] = useState(false);
  const [execConfirm, setExecConfirm] = useState(false);
  const [outcome, setOutcome] = useState<RecoveryOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [unrescuedAck, setUnrescuedAck] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: (data) => {
      if (data && typeof data === "object" && "rescue_plan_status" in data && "evidence" in data) {
        qc.setQueryData(["backendIncident", id], data);
      }
    },
    onSettled: () => {
      for (const key of [
        ["backendIncidents"],
        ["backendIncident", id],
        ["backendIncidentEvents", id],
        ["equipment"],
        ["samples"],
        ["risk"],
        ["simStatus"],
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
  const run = (fn: () => Promise<unknown>) => {
    if (action.isPending) return;
    action.mutate(fn);
  };
  const busy = action.isPending;

  const planData = plan.data ?? null;
  const unrescued = planData?.unassigned.length ?? 0;
  const scope = planData
    ? checkBackendPlanScope(equipment, planData.assignments.map((a) => a.equipment_id), equipmentById)
    : null;
  const faultActive =
    demoUnit &&
    ((sim.data?.failed_equipment_ids.includes(incident.equipment_id) ?? false) ||
      (sim.data?.abnormal_equipment_ids.includes(incident.equipment_id) ?? false) ||
      equipment?.status !== "operational");
  const effectiveOutcome: RecoveryOutcome = outcome ?? (unrescued > 0 ? "partial" : "completed");

  let guidance: ReactNode = null;
  let controls: ReactNode = null;
  switch (stage) {
    case "acknowledge":
      guidance = "Acknowledge to take ownership. The backend records who acted and when.";
      controls = (
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.acknowledgeIncident(id))}>
          Acknowledge
        </button>
      );
      break;
    case "plan":
      guidance =
        incident.rescue_plan_status === "rejected"
          ? "The last plan was rejected. Generate a new plan from current inventory."
          : "Generate a rescue plan with the backend optimizer. Planning is read-only; nothing moves.";
      controls = (
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.generateIncidentPlan(id))}>
          Generate rescue plan
        </button>
      );
      break;
    case "review": {
      const infeasible = planData != null && planData.rescued_count === 0;
      guidance = infeasible
        ? "No sample can be relocated, so this plan cannot be approved. Free capacity or add compatible storage, then regenerate."
        : scope && !scope.executable
          ? scope.reason
          : "Review the proposed moves, then approve or reject. Approval records your decision; it does not move samples.";
      controls = (
        <>
          {planData?.partial && !infeasible ? (
            <label className="check">
              <input type="checkbox" checked={partialAck} onChange={(e) => setPartialAck(e.target.checked)} />{" "}
              I accept that {unrescued} sample(s) will be left behind
            </label>
          ) : null}
          <div className="row action-row">
            <button
              className="btn btn-primary"
              disabled={
                busy || !planData || infeasible || !scope?.executable || (planData.partial && !partialAck)
              }
              onClick={() => run(() => api.approveIncidentPlan(id, planData?.partial === true && partialAck))}
            >
              Approve plan
            </button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.rejectIncidentPlan(id))}>
              Reject plan
            </button>
            <button className="btn" disabled={busy} onClick={() => run(() => api.generateIncidentPlan(id))}>
              Regenerate
            </button>
          </div>
        </>
      );
      break;
    }
    case "execute":
      guidance =
        scope && !scope.executable
          ? scope.reason
          : "Execute the approved plan. The backend revalidates inventory and moves every approved sample in one transaction, or none.";
      controls = (
        <>
          <label className="check">
            <input type="checkbox" checked={execConfirm} onChange={(e) => setExecConfirm(e.target.checked)} />{" "}
            I confirm this simulated transfer of {planData?.assignments.length ?? 0} demo sample(s)
          </label>
          <div className="row action-row">
            <button
              className="btn btn-primary"
              disabled={busy || !execConfirm || !scope?.executable}
              onClick={() => run(() => api.executeIncidentPlan(id))}
            >
              {busy ? "Executing…" : "Execute rescue"}
            </button>
          </div>
        </>
      );
      break;
    case "recovery":
    case "close":
      guidance =
        stage === "recovery"
          ? "Record the outcome you observed. This records your confirmation; it does not assert that samples are viable."
          : "Close the incident. Closure is final and is written to the audit trail.";
      controls = (
        <>
          {faultActive ? (
            <div className="notice notice-warn">
              The simulated fault is still active on {name}. Clear it so the backend does not open a
              new incident after closure.{" "}
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.setFailed(incident.equipment_id, { enabled: false });
                    await api.setAbnormal(incident.equipment_id, { enabled: false });
                    await api.updateEquipment(incident.equipment_id, { status: "operational" });
                  })
                }
              >
                Clear simulated fault
              </button>
            </div>
          ) : null}
          {risk.data ? (
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
              Unit risk now: <SeverityBadge level={RISK_BADGE[risk.data.risk_level] ?? "unknown"} label={risk.data.risk_level} />
              {risk.data.risk_level !== "low"
                ? " — recent readings are still abnormal; closing now may let the backend open a new incident."
                : ""}
            </p>
          ) : null}
          <fieldset className="outcome">
            <legend>Recovery outcome</legend>
            {(["completed", "partial", "unresolved"] as const).map((o) => (
              <label key={o} className="check">
                <input
                  type="radio"
                  name={`outcome-${id}`}
                  value={o}
                  checked={effectiveOutcome === o}
                  disabled={o === "completed" && unrescued > 0}
                  onChange={() => setOutcome(o)}
                />{" "}
                {o === "completed" ? "Completed" : o === "partial" ? "Partial" : "Unresolved"}
              </label>
            ))}
            {unrescued > 0 ? (
              <label className="check">
                <input type="checkbox" checked={unrescuedAck} onChange={(e) => setUnrescuedAck(e.target.checked)} />{" "}
                I acknowledge {unrescued} unrescued sample(s) (required to close)
              </label>
            ) : null}
            <label className="field">
              Notes (optional)
              <input value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button
              className={stage === "recovery" ? "btn btn-primary" : "btn"}
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.recordIncidentRecovery(id, {
                    outcome: effectiveOutcome,
                    notes: notes || undefined,
                    unrescued_acknowledged: unrescuedAck,
                  }),
                )
              }
            >
              {stage === "recovery" ? "Record recovery" : "Update recovery"}
            </button>
          </fieldset>
          {stage === "close" ? (
            <>
              <label className="check">
                <input type="checkbox" checked={closeConfirm} onChange={(e) => setCloseConfirm(e.target.checked)} />{" "}
                I confirm closing this incident (recovery: {incident.recovery_status})
              </label>
              <div className="row action-row">
                <button
                  className="btn btn-primary"
                  disabled={busy || !closeConfirm || (unrescued > 0 && !incident.unrescued_acknowledged)}
                  onClick={() => run(() => api.closeIncident(id))}
                >
                  Close incident
                </button>
              </div>
            </>
          ) : null}
        </>
      );
      break;
    case "closed":
      guidance = `Closed at ${formatBackendTime(incident.closed_at)} with recovery outcome "${incident.recovery_status}". Sample viability was not assessed.`;
      break;
  }

  const ev = incident.evidence;
  const score = typeof ev.anomaly_score === "number" ? ev.anomaly_score : null;
  const latest = typeof ev.latest_temperature === "number" ? ev.latest_temperature : null;
  const reasons = Array.isArray(ev.reasons) ? ev.reasons.filter((r): r is string => typeof r === "string") : [];
  const windowSize = Array.isArray(ev.recent_readings) ? ev.recent_readings.length : 0;
  const affected = incident.affected_samples
    .map((s) => (typeof s.name === "string" ? s.name : null))
    .filter((s): s is string => s != null);

  return (
    <article
      className="card incident-card"
      aria-labelledby={titleId}
      style={{ borderColor: incident.closed ? "var(--ok)" : "var(--critical)" }}
    >
      <header className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
          <h3 id={titleId} style={{ margin: 0 }}>
            {name}
          </h3>
          <SeverityBadge level={incident.risk_severity === "critical" ? "critical" : "warning"} label={incident.risk_severity} />
          <span className="badge badge-info">{incident.status}</span>
          {demoUnit ? <span className="derived-tag">demo unit</span> : null}
        </div>
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          backend record #{incident.id} · {TRIGGER_LABEL[incident.trigger] ?? incident.trigger} · detected{" "}
          {formatBackendTime(incident.created_at)}
        </span>
      </header>

      <ol className="stepper" aria-label="Incident progress">
        {steps(incident).map((s) => (
          <li key={s.label} className={`step step-${s.status}`} aria-current={s.status === "current" ? "step" : undefined}>
            <span className="step-icon" aria-hidden>
              {s.status === "done" ? "✓" : s.status === "current" ? "●" : "○"}
            </span>
            <span>
              <span className="step-label">{s.label}</span>
              <span className="step-meta">
                {s.status === "done" ? "done" : s.status === "current" ? "next" : "pending"} · {s.actor}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="next-step">
        <p style={{ margin: 0 }} role="status" aria-live="polite">
          <strong>{stage === "closed" ? "Outcome:" : "Next step:"}</strong> {guidance}
        </p>
        {controls ? <div className="stack" style={{ gap: "var(--space-2)", marginTop: "var(--space-3)" }}>{controls}</div> : null}
        {action.isError ? (
          <p role="alert" className="notice notice-critical" style={{ margin: "var(--space-2) 0 0" }}>
            Backend rejected the action: {errorText(action.error)}
          </p>
        ) : null}
      </div>

      <div className="split split-even">
        <section className="card section" aria-label="Backend evidence">
          <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
            <h4 className="section-title" style={{ margin: 0 }}>Evidence</h4>
            <span className="derived-tag">backend · Isolation Forest + rules</span>
          </div>
          <dl className="kv" style={{ marginTop: "var(--space-2)" }}>
            <div className="kv-row"><dt>Latest temperature</dt><dd className="mono">{latest != null ? `${latest} °C` : "—"}</dd></div>
            <div className="kv-row"><dt>Anomaly score (0–1)</dt><dd className="mono">{score != null ? score.toFixed(2) : "—"}</dd></div>
            <div className="kv-row"><dt>Readings in evidence window</dt><dd className="mono">{windowSize}</dd></div>
            <div className="kv-row"><dt>Evidence updated</dt><dd className="mono">{formatBackendTime(incident.updated_at)}</dd></div>
          </dl>
          <h5 className="subheading">Backend reasons</h5>
          <ul className="unknowns">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {affected.length ? (
            <>
              <h5 className="subheading">Samples at risk ({affected.length})</h5>
              <ul className="unknowns">
                {affected.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted method-note">
            The anomaly score is a relative outlier score, not a probability of failure. “Possible
            failure” is the backend’s inference from temperature data; the physical cause is not
            confirmed.
          </p>
        </section>

        <section className="card section" aria-label="Rescue plan">
          <h4 className="section-title" style={{ margin: 0 }}>Rescue Plan</h4>
          {incident.rescue_plan_id == null ? (
            <p className="muted">No plan yet.</p>
          ) : planData ? (
            <BackendPlanView plan={planData} equipmentById={equipmentById} samplesById={samplesById} />
          ) : plan.isError ? (
            <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
          ) : (
            <Spinner label="Loading plan…" />
          )}
          {incident.rescue_plan_status !== "none" ? (
            <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "var(--space-2) 0 0" }}>
              Review status: {incident.rescue_plan_status}
              {incident.plan_reviewed_at ? ` at ${formatBackendTime(incident.plan_reviewed_at)}` : ""}
            </p>
          ) : null}
        </section>
      </div>

      {execution.data ? (
        <div
          className={`card result ${execution.data.status === "success" ? "result-ok" : "result-critical"}`}
          role="status"
        >
          <strong>Execution {execution.data.status}:</strong> {execution.data.explanation}
          <ul className="result-list">
            {execution.data.transfers.map((t) => (
              <li key={t.sample_id}>
                {t.sample_name}: {t.from_equipment_name ?? "?"} → {t.to_equipment_name}
              </li>
            ))}
            {(execution.data.problems ?? []).map((p) => (
              <li key={p} className="text-critical">{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="timeline-details">
        <summary>Audit trail ({events.data?.length ?? 0} backend events)</summary>
        {events.data ? <EventList events={events.data} /> : null}
      </details>
    </article>
  );
}

function BackendPlanView({
  plan,
  equipmentById,
  samplesById,
}: {
  plan: BackendRescuePlan;
  equipmentById: ReadonlyMap<number, EquipmentRead>;
  samplesById: ReadonlyMap<number, SampleRead>;
}) {
  const label = plan.feasible ? "Full plan" : plan.partial ? "Partial plan" : "No feasible allocation";
  const milp = plan.method === "milp";
  return (
    <div className="stack" style={{ gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
      <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong>{label}</strong>
        <span
          className="derived-tag"
          title={
            milp
              ? "Mixed-integer linear program solved by the backend: maximizes priority-weighted samples rescued under the constraints listed below."
              : "Backend fallback heuristic: not guaranteed optimal."
          }
        >
          {milp ? "backend · MILP optimizer" : `backend · ${plan.method}`}
        </span>
      </div>
      <p className="plan-risk">
        <strong>
          {plan.rescued_count} of {plan.total_count} sample(s) can be relocated.
        </strong>{" "}
        <span className="muted">{plan.explanation}</span>
      </p>

      {plan.assignments.length ? (
        <ol className="allocation-list" aria-label="Proposed moves">
          {plan.assignments.map((a) => {
            const s = samplesById.get(a.sample_id);
            const d = equipmentById.get(a.equipment_id);
            const demo = isDemoEquipment(d);
            return (
              <li key={a.sample_id} className="card allocation-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.sample_name}</div>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    <span className={`priority priority-${a.priority}`}>{a.priority}</span>
                    {s ? ` needs ${s.min_temperature} to ${s.max_temperature} °C` : ""} · {a.storage_space} units
                  </div>
                </div>
                <span aria-hidden style={{ color: "var(--brand)" }}>→</span>
                <div style={{ minWidth: 0, textAlign: "right" }}>
                  <div style={{ fontWeight: 600 }}>{a.equipment_name}</div>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {d ? `holds ${d.min_temperature} to ${d.max_temperature} °C` : ""}{" "}
                    {demo ? "" : <span className="text-critical">· outside demo lab</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {plan.unassigned.length ? (
        <div className="card notice-critical-card">
          <div style={{ fontWeight: 600, color: "var(--critical)" }}>Not relocated ({plan.unassigned.length})</div>
          <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: "var(--space-5)" }}>
            {plan.unassigned.map((u) => (
              <li key={u.sample_id} style={{ fontSize: "var(--fs-sm)" }}>
                <strong>{u.sample_name}</strong> <span className={`priority priority-${u.priority}`}>{u.priority}</span> — {u.reason}
                {u.candidate_notes.length ? (
                  <ul className="unknowns">
                    {u.candidate_notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.remaining_capacity.length ? (
        <div>
          <h5 className="subheading">Backup capacity (free storage before → after)</h5>
          <ul className="unknowns">
            {plan.remaining_capacity.map((c) => (
              <li key={c.equipment_id}>
                {c.equipment_name}: {c.storage_capacity_before} → {c.storage_remaining} units
                {c.storage_used_by_plan ? ` (+${c.storage_used_by_plan})` : " (unused)"}; slots{" "}
                {c.slots_before ?? "no limit"}
                {c.slots_before != null ? ` → ${c.slots_remaining}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="timeline-details">
        <summary>Constraints enforced by the backend ({plan.constraints.length})</summary>
        <ul className="unknowns">
          {plan.constraints.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function EventList({ events }: { events: IncidentEventRead[] }) {
  // Collapse runs of evidence refreshes (one per simulator reading).
  const rows: Array<{ e: IncidentEventRead; repeat: number }> = [];
  for (const e of events) {
    const last = rows[rows.length - 1];
    if (last && e.event_type === "evidence_updated" && last.e.event_type === "evidence_updated") last.repeat += 1;
    else rows.push({ e, repeat: 1 });
  }
  return (
    <ol className="result-list">
      {rows.map(({ e, repeat }) => (
        <li key={e.id} style={{ fontSize: "var(--fs-sm)" }}>
          <span className="mono muted">{formatBackendTime(e.timestamp)}</span> <strong>{e.event_type.replace(/_/g, " ")}</strong>
          {repeat > 1 ? ` ×${repeat}` : ""} — {e.explanation}
        </li>
      ))}
    </ol>
  );
}
