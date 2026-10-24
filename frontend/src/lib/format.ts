/** Small presentation helpers shared across components. */
import { normalizeUtcTimestamp } from "../api/endpoints";

export function formatTemp(n: number): string {
  return `${n.toFixed(1)}°C`;
}

export function formatRange(min: number, max: number): string {
  return `${min.toFixed(0)} to ${max.toFixed(0)}°C`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function formatClock(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleTimeString();
}

/** Clock time for a backend timestamp (naive values are UTC). */
export function formatBackendTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return formatClock(normalizeUtcTimestamp(ts));
}

/** Clamp a possibly-inconsistent capacity value to a safe, non-negative view. */
export function clampNonNegative(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.max(0, n);
}
