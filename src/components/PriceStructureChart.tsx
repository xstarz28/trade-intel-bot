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
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Trading-terminal style structural chart.
 *
 * Everything drawn here comes from provider OHLCV / the shared SMC engine:
 * candles, liquidity, FVG, OB, VWAP and profile levels. No visual object is
 * synthesized from arbitrary percentages.
 */
export function PriceStructureChart({
  candles,
  keyLevels,
  tradePlan,
  projectedTradePlan,
  technicalData,
}: PriceChartProps) {
  const data = candles
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .slice(-120);
  if (data.length < 5) return null;

  const smc = technicalData?.smc;
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const rawSpan = Math.max(max - min, Number.EPSILON);
  const padRange = rawSpan * 0.08;
  const topPrice = max + padRange;
  const bottomPrice = Math.max(0, min - padRange);
  const span = Math.max(topPrice - bottomPrice, Number.EPSILON);

  const width = 1120;
  const height = 430;
  const padX = 48;
  const padTop = 24;
  const padBottom = 46;
  const mainH = 330;
  const volumeTop = padTop + mainH + 12;
  const volumeH = height - volumeTop - padBottom;
  const plotW = width - padX * 2;
  const candleW = Math.max(2.5, Math.min(8, (plotW / data.length) * 0.64));
  const x = (i: number) => padX + (i / Math.max(data.length - 1, 1)) * plotW;
  const y = (price: number) => padTop + ((topPrice - price) / span) * mainH;
  const inView = (price: number) => price >= bottomPrice && price <= topPrice;

  const volumes = data.map((c) => Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0);
  const maxVolume = Math.max(...volumes, 0);
  const hasVolume = maxVolume > 0;
  const volumeY = (v: number) => volumeTop + volumeH - (v / Math.max(maxVolume, 1)) * volumeH;

  const lineLevel = (value?: number) =>
    value !== undefined && Number.isFinite(value) && inView(value) ? y(value) : null;

  const zones = [
    ...(smc?.fvgs.slice(0, 6).map((f, i) => ({
      key: `fvg-${i}`,
      lower: f.lower,
      upper: f.upper,
      label: `FVG ${f.direction.toUpperCase()}`,
      className: f.direction === "bullish" ? "fill-emerald-400/10 stroke-emerald-400/35" : "fill-red-400/10 stroke-red-400/35",
    })) ?? []),
    ...(smc?.orderBlocks.slice(0, 5).map((o, i) => ({
      key: `ob-${i}`,
      lower: o.lower,
      upper: o.upper,
      label: `OB ${o.direction.toUpperCase()}`,
      className: o.direction === "bullish" ? "fill-sky-400/10 stroke-sky-400/35" : "fill-orange-400/10 stroke-orange-400/35",
    })) ?? []),
  ];

  const liquidity = smc?.liquidityPools
    .filter((p) => !p.broken && inView(p.level))
    .slice(0, 8) ?? [];

  const levels = [
    { label: "R", value: Number(keyLevels.resistance), cls: "text-red-400" },
    { label: "S", value: Number(keyLevels.support), cls: "text-emerald-400" },
    { label: "INV", value: Number(keyLevels.invalidation), cls: "text-amber-400" },
  ];

  const displayPlan = tradePlan ?? projectedTradePlan;
  const planIsProjected = !tradePlan && !!projectedTradePlan;
  const tradeLevels = displayPlan
    ? [
        { label: planIsProjected ? "P-ENTRY" : "ENTRY", value: Number(displayPlan.entry), cls: "text-sky-400" },
        { label: planIsProjected ? "P-SL" : "SL", value: Number(displayPlan.stopLoss), cls: "text-red-400" },
        { label: planIsProjected ? "P-TP" : "TP", value: Number(displayPlan.takeProfit), cls: "text-emerald-400" },
      ]
    : [];

  const vwapLevels = smc?.vwap.available
    ? [
        { label: "VWAP", value: smc.vwap.sessionVwap, cls: "text-violet-300" },
        { label: "VWAP +1σ", value: smc.vwap.bands?.plus1, cls: "text-violet-300" },
        { label: "VWAP -1σ", value: smc.vwap.bands?.minus1, cls: "text-violet-300" },
      ]
    : [];

  const profileLevels = smc?.volumeProfile.available
    ? [
        { label: "POC", value: smc.volumeProfile.poc, cls: "text-cyan-300" },
        { label: "VAH", value: smc.volumeProfile.vah, cls: "text-cyan-300" },
        { label: "VAL", value: smc.volumeProfile.val, cls: "text-cyan-300" },
      ]
    : [];

  const lastClose = data[data.length - 1]?.close;
  const currentY = lineLevel(lastClose);
  const ext = smc?.internalExternal.external;
  const int = smc?.internalExternal.internal;
  const rr = displayPlan?.riskReward;
  const structureLabel = ext?.structure ?? technicalData?.structure ?? "unknown";

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-mono">$ market-structure · provider OHLCV</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2 text-[9px] font-mono">
            <span className="text-muted-foreground">STRUCTURE <b className="text-foreground">{structureLabel}</b></span>
            {ext?.bosDirection && ext.bosDirection !== "none" && <span className="text-amber-300">BOS {ext.bosDirection}</span>}
            {ext?.chochDirection && ext.chochDirection !== "none" && <span className="text-violet-300">CHoCH {ext.chochDirection}</span>}
            {smc?.recentSweep && <span className="text-sky-300">SWEEP {smc.recentSweep.side.replace("_", "-")}</span>}
            {smc?.vwap.available && <span className="text-violet-300">VWAP {smc.vwap.priceLocation.replace("_", " ")}</span>}
            {smc?.volumeProfile.available && <span className="text-cyan-300">VP POC {fmt(smc.volumeProfile.poc ?? NaN)}</span>}
          </div>
        </div>
        {displayPlan && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] font-mono">
            <span className={planIsProjected ? "text-amber-300" : "text-sky-300"}>
              {planIsProjected ? "PROJECTED SETUP · NOT EXECUTABLE" : "EXECUTABLE PLAN"}
            </span>
            <span>ENTRY {fmt(Number(displayPlan.entry))}</span>
            <span>SL {fmt(Number(displayPlan.stopLoss))}</span>
            <span>TP {fmt(Number(displayPlan.takeProfit))}</span>
            <span className={rr !== undefined && rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr?.toFixed(2)}R</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="px-2 sm:px-3 pb-3">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[760px] h-[390px]" role="img" aria-label="Provider OHLCV market structure chart with liquidity and trade levels">
            {[0,1,2,3,4].map((g) => {
              const gy = padTop + (g / 4) * mainH;
              return <line key={`hg-${g}`} x1={padX} x2={width - padX} y1={gy} y2={gy} className="stroke-border/40" strokeWidth="1" />;
            })}
            {[0,1,2,3,4,5].map((g) => {
              const gx = padX + (g / 5) * plotW;
              return <line key={`vg-${g}`} x1={gx} x2={gx} y1={padTop} y2={volumeTop + volumeH} className="stroke-border/25" strokeWidth="1" />;
            })}

            {zones.map((z) => {
              const upper = lineLevel(z.upper);
              const lower = lineLevel(z.lower);
              if (upper === null && lower === null) return null;
              const y1 = upper ?? padTop;
              const y2 = lower ?? padTop + mainH;
              return (
                <g key={z.key}>
                  <rect x={padX} y={Math.min(y1, y2)} width={plotW} height={Math.max(3, Math.abs(y2 - y1))} className={`${z.className} stroke-dasharray-[4_4]`} />
                  <text x={padX + 5} y={Math.min(y1, y2) + 11} className="fill-current text-[8px] font-mono text-muted-foreground">{z.label}</text>
                </g>
              );
            })}

            {data.map((c, i) => {
              const cx = x(i);
              const bullish = c.close >= c.open;
              const top = y(Math.max(c.open, c.close));
              const bottom = y(Math.min(c.open, c.close));
              return (
                <g key={`${c.timestamp}-${i}`}>
                  <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} className={bullish ? "stroke-emerald-400" : "stroke-red-400"} strokeWidth="1" />
                  <rect x={cx - candleW / 2} y={Math.min(top, bottom)} width={candleW} height={Math.max(1.2, Math.abs(bottom - top))} className={bullish ? "fill-emerald-400/75" : "fill-red-400/75"} rx="0.8" />
                  {hasVolume && <rect x={cx - candleW / 2} y={volumeY(c.volume)} width={candleW} height={Math.max(1, volumeTop + volumeH - volumeY(c.volume))} className={bullish ? "fill-emerald-400/25" : "fill-red-400/25"} />}
                </g>
              );
            })}

            {liquidity.map((p, i) => {
              const ly = lineLevel(p.level);
              if (ly === null) return null;
              return <g key={`liq-${i}`}><line x1={padX} x2={width - padX} y1={ly} y2={ly} className={p.side === "buy_side" ? "stroke-red-300/60" : "stroke-emerald-300/60"} strokeDasharray="2 5" /><text x={padX + 6} y={ly - 3} className="fill-current text-[7px] font-mono text-muted-foreground">{p.source.replace("_", " ")} · {p.touches}T</text></g>;
            })}

            {[...vwapLevels, ...profileLevels, ...levels, ...tradeLevels].map((l, i) => {
              const ly = lineLevel(l.value);
              if (ly === null) return null;
              return <g key={`${l.label}-${i}`}><line x1={padX} x2={width - padX} y1={ly} y2={ly} className={`stroke-current ${l.cls} opacity-60`} strokeDasharray={l.label.includes("ENTRY") || l.label.includes("P-") ? "7 4" : "5 4"} /><text x={width - padX - 4} y={ly - 4} textAnchor="end" className={`fill-current ${l.cls} text-[8px] font-mono`}>{l.label} {fmt(l.value ?? NaN)}</text></g>;
            })}

            {currentY !== null && <line x1={padX} x2={width - padX} y1={currentY} y2={currentY} className="stroke-foreground/50" strokeDasharray="1 4" />}

            <line x1={padX} x2={width - padX} y1={volumeTop - 6} y2={volumeTop - 6} className="stroke-border/50" />
            <text x={padX} y={volumeTop + 12} className="fill-current text-[8px] font-mono text-muted-foreground">
              {hasVolume ? "VOLUME · provider" : "VOLUME · unavailable / zero-representative"}
            </text>
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-muted-foreground">
          <span>● {data.length} candles</span>
          <span>LIVE {fmt(Number(lastClose))}</span>
          {smc?.vwap.available ? <span className="text-violet-300">VWAP {fmt(smc.vwap.sessionVwap ?? NaN)}</span> : <span>VWAP unavailable</span>}
          {smc?.volumeProfile.available ? <span className="text-cyan-300">POC {fmt(smc.volumeProfile.poc ?? NaN)} · VAH {fmt(smc.volumeProfile.vah ?? NaN)} · VAL {fmt(smc.volumeProfile.val ?? NaN)}</span> : <span>Volume Profile unavailable</span>}
          {int && <span>INT {int.structure}</span>}
          {ext && <span>EXT {ext.structure}</span>}
          {rr !== undefined ? <span className={rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr.toFixed(2)}R</span> : <span>R:R unavailable — no directional thesis</span>}
        </div>
      </CardContent>
    </Card>
  );
}
