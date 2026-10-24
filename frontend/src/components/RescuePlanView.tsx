import type { Allocation, DestinationImpact, RescuePlan } from "../domain/rescue";
import { SeverityBadge } from "./SeverityBadge";
import { ArrowRightIcon, CheckIcon } from "./Icons";
import { clampNonNegative } from "../lib/format";

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

function PriorityTag({ priority }: { priority: string }) {
  return <span className={`priority priority-${priority}`}>{priority}</span>;
}

function range(min: number, max: number): string {
  return `${min} to ${max} °C`;
}

/**
 * Visualizes a rescue proposal: the samples at risk, where each one would go
 * and why that destination is valid, the capacity left afterwards, and the
 * samples that cannot be placed. It is a proposal only; nothing moves until a
 * responder executes it.
 */
export function RescuePlanView({
  plan,
  scopeNote,
}: {
  plan: RescuePlan;
  scopeNote?: string | null;
}) {
  const placedCount = plan.allocations.length;
  const atRisk = plan.unplaceable.length;
  const total = placedCount + atRisk;

  const statusLabel =
    total === 0
      ? "Nothing to relocate"
      : plan.complete
        ? "Full plan"
        : plan.partial
          ? "Partial plan"
          : "No feasible allocation";

  const actionSummary =
    total === 0
      ? `${plan.source.name} holds no samples, so nothing needs to be relocated.`
      : placedCount === 0
        ? `No sample from ${plan.source.name} can be automatically relocated. Manual intervention required.`
        : atRisk === 0
          ? `Proposes moving ${placedCount} sample(s) from ${plan.source.name}. Review and execute to apply.`
          : `Can relocate ${placedCount} of ${total} sample(s) from ${plan.source.name}; ${atRisk} need manual intervention (free capacity or add compatible storage).`;

  const byPriority = new Map<string, number>();
  for (const s of [...plan.allocations.map((a) => a.sample), ...plan.unplaceable.map((u) => u.sample)]) {
    byPriority.set(s.priority, (byPriority.get(s.priority) ?? 0) + 1);
  }
  const prioritySummary = [...byPriority.entries()]
    .sort((a, b) => PRIORITY_ORDER.indexOf(a[0]) - PRIORITY_ORDER.indexOf(b[0]))
    .map(([p, n]) => `${n} ${p}`)
    .join(", ");

  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong>{statusLabel}</strong>
        <span
          className="derived-tag"
          title="Deterministic priority-first greedy allocation computed in the browser. A proposal, not a provably optimal or backend-verified plan."
        >
          greedy heuristic
        </span>
        {total === 0 ? null : atRisk > 0 ? (
          <SeverityBadge level="warning" label={`${atRisk} not placed`} />
        ) : (
          <SeverityBadge level="ok" label="all placed" />
        )}
      </div>

      {total > 0 ? (
        <p className="plan-risk">
          <strong>{total}</strong> sample(s) at risk in {plan.source.name}
          {prioritySummary ? <span className="muted"> ({prioritySummary})</span> : null}
        </p>
      ) : null}

      <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
        {actionSummary}
      </p>
      {scopeNote ? (
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
          {scopeNote}
        </p>
      ) : null}

      {placedCount > 0 ? (
        <ol className="allocation-list" aria-label="Proposed moves">
          {plan.allocations.map((a) => (
            <AllocationRow key={a.sample.id} allocation={a} />
          ))}
        </ol>
      ) : null}

      {atRisk > 0 ? (
        <div className="card notice-critical-card">
          <div style={{ fontWeight: 600, color: "var(--critical)" }}>Unplaceable samples</div>
          <ul style={{ margin: "var(--space-2) 0 0", paddingLeft: "var(--space-5)" }}>
            {plan.unplaceable.map((u) => (
              <li key={u.sample.id} style={{ fontSize: "var(--fs-sm)" }}>
                <strong>{u.sample.name}</strong> <PriorityTag priority={u.sample.priority} /> needs{" "}
                {range(u.sample.min_temperature, u.sample.max_temperature)}, {u.sample.storage_space}{" "}
                units — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.impacts.length > 0 ? (
        <div>
          <h5 className="subheading">Destination capacity after the plan</h5>
          <div className="stack" style={{ gap: "var(--space-3)" }}>
            {plan.impacts.map((i) => (
              <ImpactRow key={i.destination.id} impact={i} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AllocationRow({ allocation: a }: { allocation: Allocation }) {
  const s = a.sample;
  const d = a.destination;
  return (
    <li className="card allocation-row" title={a.rationale}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{s.name}</div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          <PriorityTag priority={s.priority} /> needs {range(s.min_temperature, s.max_temperature)} ·{" "}
          {s.storage_space} units
        </div>
      </div>
      <ArrowRightIcon size={18} style={{ color: "var(--brand)", flexShrink: 0 }} title="moves to" />
      <div style={{ minWidth: 0, textAlign: "right" }}>
        <div style={{ fontWeight: 600 }}>{d.name}</div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          holds {range(d.min_temperature, d.max_temperature)}
        </div>
      </div>
      <ul className="why-list" aria-label={`Why ${d.name} is valid for ${s.name}`}>
        <li>
          <CheckIcon size={12} /> range covers the requirement
        </li>
        <li>
          <CheckIcon size={12} /> {s.storage_space} of {a.storageFreeBefore} units free
        </li>
        <li>
          <CheckIcon size={12} />{" "}
          {a.slotsFreeBefore == null ? "no slot limit" : `${a.slotsFreeBefore} slot(s) free`}
        </li>
      </ul>
    </li>
  );
}

function ImpactRow({ impact: i }: { impact: DestinationImpact }) {
  const capacity = clampNonNegative(i.destination.storage_capacity);
  const usedNow = clampNonNegative(i.destination.used_storage);
  const after = usedNow + i.storageUsedByPlan;
  const scale = Math.max(capacity, after, 1);
  const slotLimit = i.destination.sample_limit;
  const slotsNow = clampNonNegative(i.destination.used_slots);
  return (
    <div>
      <div
        className="row"
        style={{ justifyContent: "space-between", fontSize: "var(--fs-sm)", gap: "var(--space-2)" }}
      >
        <span style={{ fontWeight: 600 }}>{i.destination.name}</span>
        <span className="mono muted" style={{ fontSize: "var(--fs-xs)" }}>
          storage {usedNow} → {after} of {capacity} · slots {slotsNow} → {slotsNow + i.slotsUsedByPlan}
          {slotLimit == null ? " (no limit)" : ` of ${slotLimit}`}
        </span>
      </div>
      <div
        className="impact-bar"
        role="img"
        aria-label={`${i.destination.name}: ${usedNow} units used now, ${i.storageUsedByPlan} added by the plan, ${i.storageRemainingAfter} free afterwards, of ${capacity}.`}
      >
        <span className="impact-used" style={{ width: `${(usedNow / scale) * 100}%` }} />
        <span className="impact-added" style={{ width: `${(i.storageUsedByPlan / scale) * 100}%` }} />
      </div>
      <div className="impact-legend muted">
        <span>
          <i className="swatch swatch-used" /> in use
        </span>
        <span>
          <i className="swatch swatch-added" /> added by plan (+{i.storageUsedByPlan})
        </span>
        <span>{i.storageRemainingAfter} free after</span>
      </div>
    </div>
  );
}
