import { clampNonNegative } from "../lib/format";

/**
 * A labelled capacity bar. Clamps to non-negative and flags anomalies (used >
 * capacity) rather than drawing a nonsensical bar (Req 5.2).
 */
export function CapacityBar({
  label,
  used,
  total,
}: {
  label: string;
  used: number;
  total: number | null;
}) {
  const safeUsed = clampNonNegative(used);
  const unlimited = total == null;
  const safeTotal = unlimited ? null : clampNonNegative(total);
  const anomaly = safeTotal != null && safeUsed > safeTotal;
  const pct =
    safeTotal == null || safeTotal === 0
      ? 0
      : Math.min(100, (safeUsed / safeTotal) * 100);
  const color =
    pct >= 90 ? "var(--critical)" : pct >= 70 ? "var(--warn)" : "var(--ok)";

  return (
    <div>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          fontSize: "var(--fs-xs)",
          color: "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span className="mono">
          {safeUsed}
          {unlimited ? " / ∞" : ` / ${safeTotal}`}
          {anomaly ? " ⚠" : ""}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--bg-elevated)",
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={safeUsed}
        aria-valuemin={0}
        aria-valuemax={safeTotal ?? undefined}
        aria-label={label}
      >
        <div
          style={{
            width: `${unlimited ? 8 : pct}%`,
            height: "100%",
            background: anomaly ? "var(--critical)" : color,
            transition: "width 300ms ease",
          }}
        />
      </div>
      {anomaly ? (
        <div style={{ color: "var(--critical)", fontSize: "var(--fs-xs)", marginTop: 2 }}>
          Reported usage exceeds capacity.
        </div>
      ) : null}
    </div>
  );
}
