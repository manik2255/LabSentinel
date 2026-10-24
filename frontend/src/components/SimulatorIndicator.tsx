import { useSimulationControls, useSimulationStatus } from "../hooks/queries";
import { BoltIcon } from "./Icons";

export function SimulatorIndicator() {
  const status = useSimulationStatus();
  const { start, stop } = useSimulationControls();
  const running = status.data?.running ?? false;
  const busy = start.isPending || stop.isPending;

  return (
    <div className="row" style={{ gap: 10, fontSize: "var(--fs-sm)" }}>
      <span
        className="row"
        style={{ gap: 6, color: running ? "var(--ok)" : "var(--text-muted)" }}
      >
        <BoltIcon size={14} />
        Simulator {running ? "running" : "stopped"}
        {status.data ? (
          <span className="muted mono" style={{ marginLeft: 4 }}>
            ({status.data.ticks} ticks)
          </span>
        ) : null}
      </span>
      <button
        className="btn"
        disabled={busy}
        onClick={() => (running ? stop.mutate() : start.mutate(undefined))}
      >
        {running ? "Stop" : "Start"}
      </button>
    </div>
  );
}
