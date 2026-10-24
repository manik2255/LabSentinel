import { memo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquipmentRead, SensorReadingRead } from "../api/types";
import { EmptyState } from "./QueryState";
import { TELEMETRY_GAP_MS } from "../config";

export interface ChartPoint {
  t: number;
  temperature: number | null;
  outOfRange: boolean;
}

/**
 * Chronological chart points. A gap longer than TELEMETRY_GAP_MS gets a null
 * point so the line breaks instead of interpolating across missing data.
 */
export function toChartPoints(
  history: SensorReadingRead[],
  min: number,
  max: number,
  gapMs = TELEMETRY_GAP_MS,
): ChartPoint[] {
  const sorted = history
    .map((r) => ({ t: Date.parse(r.timestamp), temperature: r.temperature }))
    .filter((p) => !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);
  const points: ChartPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev && p.t - prev.t > gapMs) {
      points.push({ t: prev.t + 1, temperature: null, outOfRange: false });
    }
    points.push({ ...p, outOfRange: p.temperature > max || p.temperature < min });
  }
  return points;
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString();
}

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartPoint;
}

function ExcursionDot({ cx, cy, index, payload }: DotProps) {
  if (cx == null || cy == null || !payload?.outOfRange) return <g key={`d-${index}`} />;
  return (
    <circle
      key={`d-${index}`}
      cx={cx}
      cy={cy}
      r={3.5}
      fill="var(--critical)"
      stroke="var(--bg-surface)"
      strokeWidth={1}
    />
  );
}

/**
 * Temperature over real time with the allowed range shaded. Readings outside
 * the range are marked; gaps in telemetry are shown as breaks.
 */
export const TelemetryChart = memo(function TelemetryChart({
  equipment,
  history,
}: {
  equipment: EquipmentRead;
  history: SensorReadingRead[];
}) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No telemetry yet"
        hint="Start the simulator to begin recording temperature readings."
      />
    );
  }

  const { min_temperature: min, max_temperature: max } = equipment;
  const data = toChartPoints(history, min, max);
  const temps = data.flatMap((d) => (d.temperature == null ? [] : [d.temperature]));
  const dataMin = Math.min(...temps, min);
  const dataMax = Math.max(...temps, max);
  const pad = Math.max((dataMax - dataMin) * 0.15, 2);
  const excursions = data.filter((d) => d.outOfRange).length;
  const gaps = data.filter((d) => d.temperature == null).length;
  const first = data[0]!.t;
  const last = data[data.length - 1]!.t;

  return (
    <>
      <p className="muted chart-caption">
        Shaded band: allowed range {min} to {max} °C. {temps.length} readings from {clock(first)} to{" "}
        {clock(last)}.{" "}
        {excursions > 0 ? `${excursions} out-of-range reading(s) marked in red. ` : ""}
        {gaps > 0 ? `${gaps} gap(s) longer than ${TELEMETRY_GAP_MS / 1000} s shown as breaks.` : ""}
      </p>
      <div
        style={{ width: "100%", height: 320 }}
        role="img"
        aria-label={`Temperature chart for ${equipment.name}: ${temps.length} readings, ${excursions} outside the allowed range of ${min} to ${max} °C.`}
      >
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={clock}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              minTickGap={48}
            >
              <Label
                value="Time (local)"
                position="insideBottom"
                offset={-12}
                style={{ fill: "var(--text-muted)", fontSize: 11 }}
              />
            </XAxis>
            <YAxis
              domain={[Math.floor(dataMin - pad), Math.ceil(dataMax + pad)]}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              width={56}
              unit="°"
            >
              <Label
                value="Temperature (°C)"
                angle={-90}
                position="insideLeft"
                style={{ fill: "var(--text-muted)", fontSize: 11, textAnchor: "middle" }}
              />
            </YAxis>
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                color: "var(--text-primary)",
              }}
              labelFormatter={(t: number) => clock(t)}
              formatter={(v) => [v == null ? "no data" : `${String(v)} °C`, "Temperature"]}
            />
            <ReferenceArea
              y1={min}
              y2={max}
              fill="var(--ok)"
              fillOpacity={0.08}
              stroke="var(--ok)"
              strokeOpacity={0.35}
              strokeDasharray="4 4"
            />
            <Line
              type="linear"
              dataKey="temperature"
              stroke="var(--brand)"
              strokeWidth={2}
              connectNulls={false}
              dot={<ExcursionDot />}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
});
