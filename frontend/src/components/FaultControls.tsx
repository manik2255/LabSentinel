import { useId } from "react";
import {
  useRestoreOperational,
  useSimulationControls,
  useSimulationStatus,
} from "../hooks/queries";
import type { EquipmentRead } from "../api/types";
import { isDemoEquipment } from "../domain/demoScope";

/**
 * Simulator fault injection for one unit.
 *
 * - Restricted to demo units: a simulated hardware failure marks a unit
 *   "offline" in the backend database, so it must not touch other inventory.
 * - Switches are disabled while a request is in flight, and their state comes
 *   from the returned SimulationStatus, never from optimistic local flags.
 */
export function FaultControls({ equipment }: { equipment: EquipmentRead }) {
  const headingId = useId();
  const status = useSimulationStatus();
  const { abnormal, fail } = useSimulationControls();
  const restore = useRestoreOperational();

  const demo = isDemoEquipment(equipment);
  const running = status.data?.running ?? false;
  const isAbnormal = status.data?.abnormal_equipment_ids.includes(equipment.id) ?? false;
  const isFailed = status.data?.failed_equipment_ids.includes(equipment.id) ?? false;
  const stuckOffline = demo && !isFailed && equipment.status === "offline";
  const error = abnormal.error ?? fail.error ?? restore.error;

  return (
    <section className="card section" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">
        Fault Injection
      </h2>
      <p className="muted section-hint">
        Simulator controls. They change the backend simulator, not physical equipment.
      </p>

      {!demo ? (
        <p className="notice notice-info">
          Fault injection is limited to demo units. A simulated hardware failure marks a unit
          offline in the backend, so it is disabled for equipment outside the demo lab.
        </p>
      ) : !running ? (
        <p className="notice notice-info">
          The simulator is stopped. Faults take effect on its next reading; start it from the
          header.
        </p>
      ) : null}

      <div className="stack" style={{ gap: "var(--space-3)" }}>
        <Switch
          label="Abnormal temperature"
          description="Pushes readings outside the allowed range."
          on={isAbnormal}
          busy={abnormal.isPending}
          disabled={!demo || status.data == null}
          onToggle={() => abnormal.mutate({ id: equipment.id, enabled: !isAbnormal })}
        />
        <Switch
          label="Hardware failure"
          description="Marks the unit offline and emits extreme readings."
          on={isFailed}
          busy={fail.isPending}
          danger
          disabled={!demo || status.data == null}
          onToggle={() => fail.mutate({ id: equipment.id, enabled: !isFailed })}
        />
      </div>

      {stuckOffline ? (
        <div className="notice notice-warn" style={{ marginTop: "var(--space-3)" }}>
          <p style={{ margin: 0 }}>
            The failure is switched off, but the backend still reports this unit as offline.
          </p>
          <button
            className="btn"
            style={{ marginTop: "var(--space-2)" }}
            disabled={restore.isPending}
            onClick={() => restore.mutate(equipment.id)}
          >
            {restore.isPending ? "Restoring…" : "Restore to operational"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="notice notice-critical" style={{ marginTop: "var(--space-3)" }}>
          Simulator request failed: {error.message}
        </p>
      ) : null}
    </section>
  );
}

function Switch({
  label,
  description,
  on,
  busy,
  disabled,
  danger,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
  onToggle: () => void;
}) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: "var(--space-3)" }}>
      <div>
        <div id={labelId} style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>
          {label}
        </div>
        <div id={descId} className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
        className={`btn switch ${on && danger ? "btn-danger" : on ? "btn-primary" : ""}`}
        disabled={disabled || busy}
        onClick={onToggle}
      >
        {busy ? "…" : on ? "On" : "Off"}
      </button>
    </div>
  );
}
