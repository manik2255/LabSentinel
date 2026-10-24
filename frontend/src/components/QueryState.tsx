/**
 * Standardized async-state rendering so every data surface handles loading,
 * error (with retry), and empty consistently. Keeps stale data visible while
 * refetching rather than blanking the screen.
 */
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { RetryIcon, SpinnerIcon } from "./Icons";

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8, color: "var(--text-muted)" }}>
      <SpinnerIcon className="spin" size={16} />
      {label ?? "Loading…"}
    </span>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.status === 0
        ? "Cannot reach the backend. Is it running?"
        : `${error.detail}`
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
  return (
    <div
      role="alert"
      className="card"
      style={{
        padding: "var(--space-4)",
        borderColor: "var(--critical)",
        background: "var(--critical-bg)",
      }}
    >
      <div style={{ color: "var(--critical)", fontWeight: 600 }}>
        {message}
      </div>
      {onRetry ? (
        <button
          className="btn"
          style={{ marginTop: "var(--space-3)" }}
          onClick={onRetry}
        >
          <RetryIcon size={14} /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "var(--space-6)",
        textAlign: "center",
        color: "var(--text-secondary)",
      }}
    >
      <div style={{ fontSize: "var(--fs-lg)", marginBottom: "var(--space-2)" }}>
        {title}
      </div>
      {hint ? <div className="muted">{hint}</div> : null}
      {action ? <div style={{ marginTop: "var(--space-4)" }}>{action}</div> : null}
    </div>
  );
}

interface QueryBoundaryProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  empty?: (data: T) => boolean;
  emptyNode?: ReactNode;
  loadingLabel?: string;
}

export function QueryBoundary<T>({
  query,
  children,
  empty,
  emptyNode,
  loadingLabel,
}: QueryBoundaryProps<T>) {
  if (query.isLoading && query.data === undefined) {
    return <Spinner label={loadingLabel} />;
  }
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data !== undefined) {
    if (empty?.(query.data)) {
      return <>{emptyNode ?? <EmptyState title="Nothing here yet." />}</>;
    }
    return <>{children(query.data)}</>;
  }
  return <Spinner label={loadingLabel} />;
}
