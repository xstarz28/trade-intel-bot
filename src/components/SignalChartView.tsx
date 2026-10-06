/**
 * Phase 312 addendum — the SIGNAL CHART renderer.
 *
 * Renders a SignalChartSpec as inline SVG. The spec is produced by
 * `buildSignalChart` from the SAME OHLCV snapshot the analysis engine read —
 * this component draws exactly what the spec carries, adds no object of its
 * own, and never fabricates a candle, zone or level. No image-generation AI,
 * no screenshots. Insufficient OHLCV renders the explicit unavailable state.
 * All copy goes through the i18n layer (phase-189 ratchet).
 */

import type { SignalChartSpec, ChartOverlay } from "@/lib/strategy/chart";
import { useI18n } from "@/lib/i18n";

const W = 860;
const H = 380;
const PAD = { top: 14, right: 96, bottom: 22, left: 12 };

const TONE_FILL: Record<ChartOverlay["tone"], string> = {
  demand: "rgba(16,185,129,0.14)",
  supply: "rgba(239,68,68,0.14)",
  bull: "rgba(16,185,129,0.9)",
  bear: "rgba(239,68,68,0.9)",
  neutral: "rgba(148,163,184,0.9)",
};
const TONE_STROKE: Record<ChartOverlay["tone"], string> = {
  demand: "#10b981",
  supply: "#ef4444",
  bull: "#10b981",
  bear: "#ef4444",
  neutral: "#94a3b8",
};

function priceExtent(spec: SignalChartSpec): { min: number; max: number } {
  const candles = spec.candles!;
  let min = Math.min(...candles.map((c) => c.low));
  let max = Math.max(...candles.map((c) => c.high));
  for (const o of spec.overlays ?? []) {
    if (Number.isFinite(o.price)) {
      min = Math.min(min, o.price);
      max = Math.max(max, o.price);
    }
    if (o.price2 !== undefined && Number.isFinite(o.price2)) {
      min = Math.min(min, o.price2);
      max = Math.max(max, o.price2);
    }
  }
  const pad = (max - min) * 0.04 || 1;
  return { min: min - pad, max: max + pad };
}

export function SignalChartView({ spec }: { spec: SignalChartSpec }) {
  const { t } = useI18n();
  if (!spec.available || !spec.candles || spec.candles.length === 0 || !spec.meta) {
    return (
      <div
        data-testid="signal-chart-unavailable"
        className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground"
      >
        {spec.unavailableReason ?? t.signal.chartUnavailableFallback}
      </div>
    );
  }
  const candles = spec.candles;
  const { min, max } = priceExtent(spec);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number): number => PAD.left + (i + 0.5) * (innerW / candles.length);
  const y = (p: number): number => PAD.top + innerH - ((p - min) / (max - min)) * innerH;
  const bodyW = Math.max(1.5, (innerW / candles.length) * 0.6);
  const timeIndex = new Map<number, number>(candles.map((c, i) => [c.timestamp, i]));
  const xOfTime = (tm: number | undefined, fallback: number): number =>
    tm !== undefined && timeIndex.has(tm) ? x(timeIndex.get(tm)!) : fallback;
  const grid = [min + (max - min) * 0.1, min + (max - min) * 0.5, min + (max - min) * 0.9];
  const m = spec.meta;

  return (
    <figure data-testid="signal-chart" className="chart-shell space-y-1 p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-border/60 bg-background"
        role="img"
        aria-label={`${m.instrument} ${m.timeframe} — ${t.signal.chartRoleLabel}`}
      >
        {grid.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(g)} y2={y(g)} stroke="rgba(148,163,184,0.18)" strokeWidth={1} />
            <text x={PAD.left + innerW + 6} y={y(g) + 3} fontSize={10} fill="#94a3b8">
              {g.toFixed(g > 500 ? 0 : 2)}
            </text>
          </g>
        ))}
        {candles.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? "#10b981" : "#ef4444";
          const bodyTop = y(Math.max(c.open, c.close));
          const bodyBottom = y(Math.min(c.open, c.close));
          return (
            <g key={c.timestamp}>
              <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} />
              <rect
                x={x(i) - bodyW / 2}
                y={bodyTop}
                width={bodyW}
                height={Math.max(1, bodyBottom - bodyTop)}
                fill={color}
              >
                <title>{`O ${c.open} H ${c.high} L ${c.low} C ${c.close} @ ${new Date(c.timestamp).toISOString()}`}</title>
              </rect>
            </g>
          );
        })}
        {(spec.overlays ?? []).map((o, idx) => {
          if (o.markerTime !== undefined) {
            const i = timeIndex.get(o.markerTime);
            if (i === undefined) return null;
            const mx = x(i);
            const my = y(o.price);
            return (
              <g key={`mk-${idx}`}>
                <rect
                  x={mx - 4}
                  y={my - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${mx} ${my})`}
                  fill="none"
                  stroke={TONE_STROKE[o.tone]}
                  strokeWidth={2}
                >
                  <title>{`${o.label} — ${o.provenance.source}`}</title>
                </rect>
              </g>
            );
          }
          const isBand = o.price2 !== undefined && Number.isFinite(o.price2);
          const y1 = isBand ? y(Math.max(o.price, o.price2!)) : y(o.price);
          const y2 = isBand ? y(Math.min(o.price, o.price2!)) : y(o.price);
          const x0 = xOfTime(o.fromTime, PAD.left);
          const x1 = xOfTime(o.toTime, PAD.left + innerW);
          const dashed = o.kind === "liquidity" || o.kind === "invalidation" || o.kind === "structure";
          return (
            <g key={`ov-${idx}`}>
              {isBand ? (
                <rect x={x0} y={y1} width={Math.max(2, x1 - x0)} height={Math.max(2, y2 - y1)} fill={TONE_FILL[o.tone]} stroke={TONE_STROKE[o.tone]} strokeWidth={0.75}>
                  <title>{`${o.label} — ${o.provenance.source}`}</title>
                </rect>
              ) : (
                <line x1={x0} x2={x1} y1={y1} y2={y1} stroke={TONE_STROKE[o.tone]} strokeWidth={1.25} strokeDasharray={dashed ? "5 4" : undefined}>
                  <title>{`${o.label} — ${o.provenance.source}`}</title>
                </line>
              )}
              <text x={PAD.left + innerW + 4} y={(isBand ? (y1 + y2) / 2 : y1) + 3} fontSize={9.5} fill={TONE_STROKE[o.tone]}>
                {o.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption
        data-testid="signal-chart-provenance"
        className="text-[11px] leading-snug text-muted-foreground"
      >
        {`${m.instrument}${m.providerInstrumentId ? ` · ${m.providerInstrumentId}` : ""}${m.provider ? ` · ${m.provider}` : ""} · ${m.timeframe} · ${t.signal.chartObserved} ${new Date(m.observedAt).toISOString()} · ${m.candlesRendered}/${m.provenance.candleCountFull} ${t.signal.chartSnapshotCandles} · ${t.signal.chartInputHash} ${m.provenance.inputHash} · ${t.signal.chartOverlayNote}`}
      </figcaption>
    </figure>
  );
}
