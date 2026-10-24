import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Incident, RecoveryResult } from "../domain/incident";
import { verifyRecovery } from "../domain/incident";
import { planRescue, type RescuePlan } from "../domain/rescue";
import { checkPlanScope, isDemoEquipment, type ExecutionScope } from "../domain/demoScope";
import type { EquipmentRead, SampleRead } from "../api/types";
import { useIncidentStore } from "../store/incidentStore";
import { useRescueExecution } from "../hooks/useRescueExecution";
import { AssessmentPanel } from "./AssessmentPanel";
import { RescuePlanView } from "./RescuePlanView";
import { IncidentTimeline } from "./IncidentTimeline";
import { SeverityBadge } from "./SeverityBadge";

/** Local demo identity. There is no authentication in this build. */
const RESPONDER = "On-call responder";

type StepStatus = "done" | "current" | "pending" | "failed" | "skipped";

interface Step {
  label: string;
  actor: string;
  status: StepStatus;
}

const STEP_STATUS_TEXT: Record<StepStatus, string> = {
  done: "done",
  current: "next",
  pending: "pending",
  failed: "failed",
  skipped: "not needed",
};

const STEP_ICON: Record<StepStatus, string> = {
  done: "✓",
  current: "●",
  pending: "○",
  failed: "!",
  skipped: "–",
};

function buildSteps(incident: Incident, nothingToMove: boolean): Step[] {
  const failedRecovery = incident.recovery != null && !incident.recovery.ok;
  const s = incident.state;
  const status = (
    detected: StepStatus,
    ack: StepStatus,
    exec: StepStatus,
    verify: StepStatus,
  ): StepStatus[] => [detected, ack, exec, verify];
  const map: StepStatus[] =
    s === "detected"
      ? status("done", "current", "pending", "pending")
      : s === "acknowledged"
        ? failedRecovery
          ? status("done", "done", "current", "failed")
          : nothingToMove
            ? status("done", "done", "skipped", "current")
            : status("done", "done", "current", "pending")
        : s === "executing"
          ? status("done", "done", "current", "pending")
          : s === "executed"
            ? status("done", "done", "done", "current")
            : status("done", "done", nothingToMove ? "skipped" : "done", "done");
  return [
    { label: "Detected", actor: "LabSentinel, automatic", status: map[0]! },
    { label: "Acknowledged", actor: "Responder", status: map[1]! },
    { label: "Rescue executed", actor: "Responder; backend confirms each move", status: map[2]! },
    { label: "Recovery verified", actor: "Responder; operational check", status: map[3]! },
  ];
}

function nextStepText(
  incident: Incident,
  plan: RescuePlan | null,
  scope: ExecutionScope | null,
  nothingToMove: boolean,
  running: boolean,
): string {
  const failedRecovery = incident.recovery != null && !incident.recovery.ok;
  switch (incident.state) {
    case "detected":
      return "Acknowledge to take ownership. Rescue execution stays locked until a responder acknowledges.";
    case "acknowledged":
      if (failedRecovery)
        return "The recovery check failed. Resolve the listed problems, then verify again or execute the updated plan.";
      if (nothingToMove) return "No samples are stored in this unit. Verify to close the incident.";
      if (!plan || plan.allocations.length === 0)
        return "No sample can be relocated automatically. Free capacity or add compatible storage, then re-plan.";
      if (scope && !scope.executable) return scope.reason ?? "This plan is advisory only.";
      return "Review the proposed moves, then execute. You will be asked to confirm.";
    case "executing":
      return running
        ? "Moving samples. Each move is confirmed by the backend before it counts."
        : "Waiting for the move results.";
    case "executed":
      return "Verify recovery: checks that every sample from this unit now sits in compatible, online storage.";
    case "resolved":
      return "Resolved. Locations are verified; sample viability still needs laboratory confirmation.";
    default:
      return "";
  }
}

export function IncidentCard({
  incident,
  equipment,
  samplesBySource,
  allEquipment,
  allSamples,
}: {
  incident: Incident;
  equipment: EquipmentRead | undefined;
  samplesBySource: SampleRead[];
  allEquipment: EquipmentRead[];
  allSamples: SampleRead[];
}) {
  const titleId = useId();
  const dialogTitleId = useId();
  const store = useIncidentStore();
  const execution = useRescueExecution();
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const executeRef = useRef<HTMLButtonElement>(null);
  const recovery: RecoveryResult | null = incident.recovery;

  useEffect(() => {
    if (confirming) dialogRef.current?.focus();
  }, [confirming]);

  const demoSource = isDemoEquipment(equipment);
  // In the demo sandbox only demo units are candidate destinations, so an
  // executable plan never moves samples into equipment the demo does not own.
  const candidates = useMemo(
    () => (demoSource ? allEquipment.filter((e) => isDemoEquipment(e)) : allEquipment),
    [demoSource, allEquipment],
  );
  const plan = useMemo(
    () =>
      equipment
        ? planRescue({ source: equipment, samples: samplesBySource, candidates })
        : null,
    [equipment, samplesBySource, candidates],
  );
  const scope = plan ? checkPlanScope(plan) : null;
  const nothingToMove = samplesBySource.length === 0;
  const failedRecovery = recovery != null && !recovery.ok;

  const canAcknowledge = incident.state === "detected";
  const canExecute =
    incident.state === "acknowledged" &&
    plan != null &&
    plan.allocations.length > 0 &&
    scope?.executable === true &&
    !execution.running;
  const canVerify =
    equipment != null &&
    (incident.state === "executed" ||
      (incident.state === "acknowledged" && (failedRecovery || nothingToMove)));

  const closeDialog = () => {
    setConfirming(false);
    executeRef.current?.focus();
  };

  const doExecute = async () => {
    if (!plan || !scope?.executable) return;
    store.attachPlan(incident.id, plan);
    store.beginExecution(incident.id);
    const res = await execution.execute(plan);
    if (!res) return; // another execution is in flight and owns the transition
    if (res.blockedReason) {
      store.abortExecution(incident.id, "blocked: outside the demo lab");
    } else if (res.movedCount === 0) {
      store.abortExecution(incident.id, `no samples moved (${res.moves.length} rejected)`);
    } else {
      store.markExecuted(
        incident.id,
        res.allSucceeded ? `${res.movedCount} moved` : `${res.movedCount}/${res.moves.length} moved`,
      );
    }
  };

  const handleVerify = () => {
    if (!equipment) return;
    // Check every planned sample AND every sample still in the failed unit,
    // so a partial rescue cannot pass.
    const stillInSource = allSamples.filter((s) => s.equipment_id === equipment.id).map((s) => s.id);
    const planned = incident.plan?.allocations.map((a) => a.sample.id) ?? [];
    const ids = Array.from(new Set([...planned, ...stillInSource]));
    const result = verifyRecovery(
      ids,
      allSamples,
      new Map(allEquipment.map((e) => [e.id, e])),
      equipment.id,
    );
    store.recordRecovery(incident.id, result);
    if (result.ok) store.resolve(incident.id, result);
    else if (incident.state === "executed") store.reopen(incident.id);
  };

  const steps = buildSteps(incident, nothingToMove);
  const resolved = incident.state === "resolved";

  return (
    <article
      className="card incident-card"
      aria-labelledby={titleId}
      style={{ borderColor: resolved ? "var(--ok)" : "var(--critical)" }}
    >
      <header className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
          <h3 id={titleId} style={{ margin: 0 }}>
            {incident.equipmentName}
          </h3>
          <SeverityBadge level={incident.assessment.severity} />
          {demoSource ? <span className="derived-tag">demo unit</span> : null}
        </div>
        {incident.acknowledgedBy ? (
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            Acknowledged by {incident.acknowledgedBy} (local demo identity, not server-authorized)
          </span>
        ) : null}
      </header>

      <ol className="stepper" aria-label="Incident progress">
        {steps.map((step) => (
          <li
            key={step.label}
            className={`step step-${step.status}`}
            aria-current={step.status === "current" ? "step" : undefined}
          >
            <span className="step-icon" aria-hidden>
              {STEP_ICON[step.status]}
            </span>
            <span>
              <span className="step-label">{step.label}</span>
              <span className="step-meta">
                {STEP_STATUS_TEXT[step.status]} · {step.actor}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="next-step" role="status" aria-live="polite">
        <strong>Next step:</strong> {nextStepText(incident, plan, scope, nothingToMove, execution.running)}
      </div>

      <div className="split split-even">
        <AssessmentPanel assessment={incident.assessment} headingLevel={4} />
        <section className="card section" aria-label="Rescue plan">
          <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
            <h4 className="section-title" style={{ margin: 0 }}>
              Rescue Plan
            </h4>
            <span className="derived-tag">
              {demoSource ? "simulated execution" : "advisory only"}
            </span>
          </div>
          {!equipment ? (
            <p className="muted">Source equipment is no longer available.</p>
          ) : resolved && incident.plan ? (
            <RescuePlanView plan={incident.plan} scopeNote="Plan as executed." />
          ) : plan ? (
            <RescuePlanView
              plan={plan}
              scopeNote={
                demoSource
                  ? "Demo sandbox: only demo units are considered as destinations."
                  : "This unit is outside the demo lab. The plan is a proposal and cannot be executed from this console."
              }
            />
          ) : null}
        </section>
      </div>

      {execution.result ? (
        <div
          className={`card result ${execution.result.allSucceeded ? "result-ok" : "result-warn"}`}
          role="status"
          aria-live="polite"
        >
          <strong>Execution result:</strong>{" "}
          {execution.result.blockedReason
            ? `blocked before any request was sent — ${execution.result.blockedReason}`
            : `${execution.result.movedCount} of ${execution.result.moves.length} move(s) confirmed by the backend.`}
          {execution.result.moves.length > 0 ? (
            <ul className="result-list">
              {execution.result.moves.map((m) => (
                <li key={m.sampleId} className={m.ok ? undefined : "text-critical"}>
                  {m.sampleName} → {m.destinationName}: {m.ok ? "moved" : `failed — ${m.detail}`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {recovery ? (
        <div
          className={`card result ${recovery.ok ? "result-ok" : "result-critical"}`}
          role="status"
          aria-live="polite"
        >
          <strong>Recovery verification: {recovery.ok ? "passed" : "failed"}</strong>
          {recovery.checks.length > 0 ? (
            <ul className="result-list">
              {recovery.checks.map((c) => (
                <li key={c.sampleId} className={c.ok ? undefined : "text-critical"}>
                  {c.ok ? "✓" : "✗"} {c.sampleName}: {c.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>
              No samples needed relocation.
            </p>
          )}
          <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: "var(--fs-xs)" }}>
            Operational check only: sample locations and storage ranges from backend data. It does
            not confirm sample viability, which needs laboratory QA.
          </p>
        </div>
      ) : null}

      {confirming && plan ? (
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="card confirm-dialog"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={dialogTitleId}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeDialog();
          }}
        >
          <h4 id={dialogTitleId} style={{ marginTop: 0 }}>
            Execute rescue in the demo environment?
          </h4>
          <p style={{ fontSize: "var(--fs-sm)" }}>
            This sends {plan.allocations.length} move request(s) to the backend for demo samples
            in {plan.source.name}. Each move counts only after the backend accepts it. This is a
            simulated rescue on demo data, not an authorized laboratory action.
          </p>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                setConfirming(false);
                void doExecute();
              }}
            >
              Confirm &amp; execute
            </button>
            <button className="btn" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {resolved ? null : (
        <div className="row action-row">
          <button
            className="btn btn-primary"
            disabled={!canAcknowledge}
            onClick={() => store.acknowledge(incident.id, RESPONDER)}
          >
            Acknowledge
          </button>
          <button
            ref={executeRef}
            className="btn btn-primary"
            disabled={!canExecute}
            title={scope && !scope.executable ? scope.reason ?? undefined : "Simulated rescue against the demo backend"}
            onClick={() => {
              if (canExecute) setConfirming(true);
            }}
          >
            {execution.running ? "Executing…" : "Execute rescue"}
          </button>
          <button className="btn" disabled={!canVerify} onClick={handleVerify}>
            Verify recovery
          </button>
        </div>
      )}

      <details className="timeline-details">
        <summary>Audit trail ({incident.timeline.length} events, stored in this browser)</summary>
        <IncidentTimeline incident={incident} />
      </details>
    </article>
  );
}
