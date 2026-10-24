import { useHealth } from "../hooks/queries";

export function ConnectionIndicator() {
  const health = useHealth();
  const connected = health.isSuccess && health.data?.status === "ok";
  const label = connected
    ? "Backend online"
    : health.isLoading
      ? "Connecting…"
      : "Backend offline";
  const color = connected
    ? "var(--ok)"
    : health.isLoading
      ? "var(--warn)"
      : "var(--critical)";
  return (
    <div
      className="row"
      style={{ gap: 8, fontSize: "var(--fs-sm)" }}
      aria-live="polite"
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
        }}
      />
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}
