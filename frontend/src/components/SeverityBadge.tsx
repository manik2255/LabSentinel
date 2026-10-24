import type { Health } from "../domain/detection";
import type { AssessmentSeverity } from "../domain/assessment";
import {
  CheckIcon,
  CriticalIcon,
  InfoIcon,
  UnknownIcon,
  WarnIcon,
} from "./Icons";

type Level = Health | AssessmentSeverity;

const MAP: Record<
  string,
  { cls: string; label: string; Icon: typeof CheckIcon }
> = {
  ok: { cls: "badge-ok", label: "OK", Icon: CheckIcon },
  none: { cls: "badge-ok", label: "Normal", Icon: CheckIcon },
  warning: { cls: "badge-warning", label: "Warning", Icon: WarnIcon },
  critical: { cls: "badge-critical", label: "Critical", Icon: CriticalIcon },
  info: { cls: "badge-info", label: "Info", Icon: InfoIcon },
  unknown: { cls: "badge-unknown", label: "Unknown", Icon: UnknownIcon },
};

/** Health badge that names stale telemetry explicitly instead of "Warning". */
export function HealthBadge({
  health,
  isStale,
}: {
  health: Health;
  isStale: boolean;
}) {
  if (isStale && health === "warning") return <SeverityBadge level="warning" label="Stale" />;
  if (health === "unknown") return <SeverityBadge level="unknown" label="No data" />;
  return <SeverityBadge level={health} />;
}

export function SeverityBadge({
  level,
  label,
}: {
  level: Level;
  label?: string;
}) {
  const entry = MAP[level] ?? MAP.unknown!;
  const { cls, Icon } = entry;
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} />
      {label ?? entry.label}
    </span>
  );
}
