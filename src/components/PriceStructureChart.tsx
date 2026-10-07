import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { KeyLevels, TradePlan } from "@/types/analysis";

interface PriceChartProps {
  candles: OhlcvCandle[];
  keyLevels: KeyLevels;
  tradePlan?: TradePlan;
  projectedTradePlan?: TradePlan;
  technicalData?: TechnicalData;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(5);
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Price-first market chart.
 *
 * The chart intentionally follows a TradingView-like hierarchy:
 * candles and axes first, trade plan second, only the most relevant structural
 * levels as overlays. SMC/VWAP/profile data remains available as compact context
 * instead of painting every available object over the price action.
 */
export function PriceStructureChart({
  candles,
  keyLevels,
  tradePlan,
  projectedTradePlan,
  technicalData,
}: PriceChartProps) {
  const data = candles
    .filter((c) => [c.open, c.high, c.low, c.close, c.timestamp].every(Number.isFinite))
    .slice(-90);

  if (data.length < 5) return null;

  const smc = technicalData?.smc;
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const spanRaw = Math.max(max - min, Number.EPSILON);
  const pad = spanRaw * 0.07;
  const topPrice = max + pad;
  const bottomPrice = Math.max(0, min - pad);
  const priceSpan = Math.max(topPrice - bottomPrice, Number.EPSILON);

  const width = 1000;
  const height = 480;
  const left = 18;
  const right = 82;
  const top = 18;
  const bottom = 58;
  const volumeHeight = 72;
  const gap = 12;
  const priceHeight = height - top - bottom - volumeHeight - gap;
  const plotWidth = width - left - right;
  const volumeTop = top + priceHeight + gap;
  const x = (i: number) => left + (i / Math.max(data.length - 1, 1)) * plotWidth;
  const y = (price: number) => top + ((topPrice - price) / priceSpan) * priceHeight;
  const visible = (price: number) => price >= bottomPrice && price <= topPrice;

  const volumes = data.map((c) => Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0);
  const maxVolume = Math.max(...volumes, 0);
  const hasVolume = maxVolume > 0;
  const candleWidth = Math.max(3, Math.min(10, (plotWidth / data.length) * 0.62));
  const volumeY = (v: number) =>
    volumeTop + volumeHeight - (v / Math.max(maxVolume, 1)) * volumeHeight;

  const levelY = (value: number | undefined): number | null =>
    value !== undefined && Number.isFinite(value) && visible(value) ? y(value) : null;

  const support = Number(keyLevels.support);
  const resistance = Number(keyLevels.resistance);
  const invalidation = Number(keyLevels.invalidation);
  const plan = tradePlan ?? projectedTradePlan;
  const projected = !tradePlan && !!projectedTradePlan;

  const planLevels = plan
    ? [
        { key: "entry", label: projected ? "P-ENTRY" : "ENTRY", value: Number(plan.entry), cls: "text-sky-300", dash: "7 4" },
        { key: "sl", label: projected ? "P-SL" : "SL", value: Number(plan.stopLoss), cls: "text-red-300", dash: "5 4" },
        { key: "tp", label: projected ? "P-TP" : "TP", value: Number(plan.takeProfit), cls: "text-emerald-300", dash: "5 4" },
      ]
    : [];

  const last = data[data.length - 1];
  const currentY = y(last.close);
  const risk = plan ? Math.abs(Number(plan.entry) - Number(plan.stopLoss)) : NaN;
  const reward = plan ? Math.abs(Number(plan.takeProfit) - Number(plan.entry)) : NaN;
  const rr = risk > 0 && Number.isFinite(reward) ? reward / risk : undefined;

  // Only the nearest fresh zones are shown. The full SMC payload remains in
  // the analysis data; the chart should not become an indicator dump.
  const relevantZones = [
    ...(smc?.fvgs ?? [])
      .filter((f) => f.status === "fresh" && visible((f.lower + f.upper) / 2))
      .slice(0, 1)
      .map((f) => ({ lower: f.lower, upper: f.upper, label: "FVG", positive: f.direction === "bullish" })),
    ...(smc?.orderBlocks ?? [])
      .filter((o) => o.status === "fresh" && visible((o.lower + o.upper) / 2))
      .slice(0, 1)
      .map((o) => ({ lower: o.lower, upper: o.upper, label: "OB", positive: o.direction === "bullish" })),
  ];

  const compactContext = [
    smc?.vwap.available ? `VWAP ${fmt(smc.vwap.sessionVwap ?? NaN)}` : null,
    smc?.volumeProfile.available ? `POC ${fmt(smc.volumeProfile.poc ?? NaN)}` : null,
    smc?.recentSweep ? `SWEEP ${smc.recentSweep.side.replace("_", "-")}` : null,
  ].filter(Boolean);

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-mono">$ market-structure · provider OHLCV</CardTitle>
          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
            <span>{data.length} candles</span>
            <span>·</span>
            <span className="text-foreground">LIVE {fmt(last.close)}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
          <span>STRUCTURE <b className="text-foreground">{smc?.internalExternal.external.structure ?? technicalData?.structure ?? "unknown"}</b></span>
          {smc?.internalExternal.external.bosDirection && smc.internalExternal.external.bosDirection !== "none" && (
            <span>BOS {smc.internalExternal.external.bosDirection}</span>
          )}
          {smc?.internalExternal.external.chochDirection && smc.internalExternal.external.chochDirection !== "none" && (
            <span>CHoCH {smc.internalExternal.external.chochDirection}</span>
          )}
          {compactContext.map((item) => <span key={item}>{item}</span>)}
        </div>
        {plan && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className={projected ? "text-amber-300" : "text-sky-300"}>
              {projected ? "PROJECTED SETUP · NOT EXECUTABLE" : "ANALYTICAL PLAN · VERIFY EXECUTABLE PRICE"}
            </span>
            <span>ENTRY {fmt(Number(plan.entry))}</span>
            <span>SL {fmt(Number(plan.stopLoss))}</span>
            <span>TP {fmt(Number(plan.takeProfit))}</span>
            {rr !== undefined && <span className={rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr.toFixed(2)}R</span>}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-2 sm:px-3 pb-3">
        <div className="w-full">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto min-h-[300px]"
            role="img"
            aria-label="Provider OHLCV candlestick chart with key market levels"
          >
            {/* TradingView-like grid: deliberately subtle. */}
            {[0, 1, 2, 3, 4].map((i) => {
              const gy = top + (i / 4) * priceHeight;
              const value = topPrice - (i / 4) * priceSpan;
              return (
                <g key={`h-${i}`}>
                  <line x1={left} x2={width - right} y1={gy} y2={gy} className="stroke-border/30" />
                  <text x={width - right + 7} y={gy + 3} className="fill-muted-foreground text-[10px] font-mono">{fmt(value)}</text>
                </g>
              );
            })}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const gx = left + (i / 5) * plotWidth;
              const candle = data[Math.min(data.length - 1, Math.round((i / 5) * (data.length - 1)))];
              return (
                <g key={`v-${i}`}>
                  <line x1={gx} x2={gx} y1={top} y2={volumeTop + volumeHeight} className="stroke-border/15" />
                  <text x={gx} y={height - 16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">
                    {timeLabel(candle.timestamp)}
                  </text>
                </g>
              );
            })}

            {/* One or two nearest fresh structural zones, not the entire SMC set. */}
            {relevantZones.map((z, i) => {
              const y1 = y(z.upper);
              const y2 = y(z.lower);
              return (
                <g key={`${z.label}-${i}`} opacity="0.35">
                  <rect
                    x={left}
                    y={Math.min(y1, y2)}
                    width={plotWidth}
                    height={Math.max(2, Math.abs(y2 - y1))}
                    className={z.positive ? "fill-emerald-400" : "fill-red-400"}
                  />
                  <text x={left + 6} y={Math.min(y1, y2) + 12} className="fill-foreground text-[9px] font-mono">
                    {z.label}
                  </text>
                </g>
              );
            })}

            {/* Candles are the dominant visual layer. */}
            {data.map((c, i) => {
              const cx = x(i);
              const bullish = c.close >= c.open;
              const bodyTop = y(Math.max(c.open, c.close));
              const bodyBottom = y(Math.min(c.open, c.close));
              return (
                <g key={`${c.timestamp}-${i}`}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(c.high)}
                    y2={y(c.low)}
                    className={bullish ? "stroke-emerald-400" : "stroke-red-400"}
                    strokeWidth="1.2"
                  />
                  <rect
                    x={cx - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={Math.max(1.5, bodyBottom - bodyTop)}
                    className={bullish ? "fill-emerald-400/80" : "fill-red-400/80"}
                    rx="0.5"
                  />
                </g>
              );
            })}

            {/* Key levels: only the levels a trader actually needs immediately. */}
            {[
              { label: "RES", value: resistance, cls: "text-red-300", dash: "6 4" },
              { label: "SUP", value: support, cls: "text-emerald-300", dash: "6 4" },
              { label: "INV", value: invalidation, cls: "text-amber-300", dash: "2 5" },
            ].map((l) => {
              const ly = levelY(l.value);
              if (ly === null) return null;
              return (
                <g key={l.label}>
                  <line x1={left} x2={width - right} y1={ly} y2={ly} className={`stroke-current ${l.cls}`} strokeOpacity="0.5" strokeDasharray={l.dash} />
                  <rect x={width - right - 67} y={ly - 10} width="63" height="18" rx="3" className="fill-background/85" />
                  <text x={width - right - 6} y={ly + 3} textAnchor="end" className={`fill-current ${l.cls} text-[9px] font-mono`}>{l.label} {fmt(l.value)}</text>
                </g>
              );
            })}

            {/* Trade plan is a single coherent visual block. */}
            {planLevels.map((l) => {
              const ly = levelY(l.value);
              if (ly === null) return null;
              return (
                <g key={l.key}>
                  <line x1={left} x2={width - right} y1={ly} y2={ly} className={`stroke-current ${l.cls}`} strokeOpacity="0.75" strokeDasharray={l.dash} />
                  <rect x={left + 6} y={ly - 10} width={l.label.length > 5 ? 76 : 50} height="18" rx="3" className="fill-background/90" />
                  <text x={left + 11} y={ly + 3} className={`fill-current ${l.cls} text-[9px] font-mono`}>{l.label}</text>
                </g>
              );
            })}

            {plan && rr !== undefined && (() => {
              const entryY = levelY(Number(plan.entry));
              const slY = levelY(Number(plan.stopLoss));
              const tpY = levelY(Number(plan.takeProfit));
              if (entryY === null || slY === null || tpY === null) return null;
              const boxX = left + plotWidth * 0.72;
              const boxW = plotWidth * 0.22;
              const riskTop = Math.min(entryY, slY);
              const riskBottom = Math.max(entryY, slY);
              const rewardTop = Math.min(entryY, tpY);
              const rewardBottom = Math.max(entryY, tpY);
              return (
                <g opacity="0.18">
                  <rect x={boxX} y={riskTop} width={boxW} height={Math.max(2, riskBottom - riskTop)} className="fill-red-500" />
                  <rect x={boxX} y={rewardTop} width={boxW} height={Math.max(2, rewardBottom - rewardTop)} className="fill-emerald-500" />
                </g>
              );
            })()}

            {/* Current-price line. */}
            <line x1={left} x2={width - right} y1={currentY} y2={currentY} className="stroke-foreground/50" strokeDasharray="2 5" />
            <rect x={width - right - 70} y={currentY - 10} width="66" height="18" rx="3" className="fill-foreground" />
            <text x={width - right - 6} y={currentY + 3} textAnchor="end" className="fill-background text-[9px] font-mono">{fmt(last.close)}</text>

            {/* Volume is a separate lower pane, never painted through candles. */}
            <line x1={left} x2={width - right} y1={volumeTop - 6} y2={volumeTop - 6} className="stroke-border/30" />
            {hasVolume && data.map((c, i) => {
              const cx = x(i);
              const bullish = c.close >= c.open;
              const vy = volumeY(c.volume);
              return (
                <rect
                  key={`vol-${c.timestamp}-${i}`}
                  x={cx - candleWidth / 2}
                  y={vy}
                  width={candleWidth}
                  height={Math.max(1, volumeTop + volumeHeight - vy)}
                  className={bullish ? "fill-emerald-400/25" : "fill-red-400/25"}
                />
              );
            })}
            <text x={left} y={volumeTop + 12} className="fill-muted-foreground text-[9px] font-mono">
              {hasVolume ? "VOLUME · provider" : "VOLUME · unavailable"}
            </text>
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-muted-foreground">
          <span>Price action first</span>
          {smc?.vwap.available ? <span>VWAP {fmt(smc.vwap.sessionVwap ?? NaN)}</span> : <span>VWAP unavailable</span>}
          {smc?.volumeProfile.available ? <span>POC {fmt(smc.volumeProfile.poc ?? NaN)}</span> : <span>Volume Profile unavailable</span>}
          {smc?.recentSweep && <span>SWEEP {smc.recentSweep.side.replace("_", "-")}</span>}
          {rr !== undefined ? <span className={rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr.toFixed(2)}R</span> : <span>R:R unavailable</span>}
        </div>
      </CardContent>
    </Card>
  );
}
