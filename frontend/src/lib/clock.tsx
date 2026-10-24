/**
 * A shared ticking clock. Freshness (reading age, staleness) depends on the
 * current time, but React Query does not re-render when polled data is
 * unchanged, so without a clock a stopped sensor would look fresh forever.
 * One provider ticks for the whole app so every age on screen agrees.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NowContext = createContext<number | null>(null);

export function ClockProvider({
  intervalMs = 1000,
  children,
}: {
  intervalMs?: number;
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

/** Current time in ms; ticks when rendered inside ClockProvider. */
export function useNow(): number {
  return useContext(NowContext) ?? Date.now();
}
