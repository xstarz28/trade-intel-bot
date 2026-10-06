import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OhlcvCandle } from "@/lib/data/market-types";
import type { KeyLevels, TradePlan } from "@/types/analysis";

interface PriceChartProps {
  candles: OhlcvCandle[];
  keyLevels: KeyLevels;
  tradePlan?: TradePlan;
}

function fmt(value: number): string {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export function PriceStructureChart({ candles, keyLevels, tradePlan }: PriceChartProps) {
  const data = candles.filter((c) =>
    [c.open, c.high, c.low, c.close].every(Number.isFinite),
  ).slice(-80);
  if (data.length < 5) return null;

  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = Math.max(max - min, Number.EPSILON);
  const width = 920;
  const height = 300;
  const padX = 18;
  const padY = 18;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const candleW = Math.max(3, Math.min(9, (plotW / data.length) * 0.62));
  const x = (i: number) => padX + (i / Math.max(data.length - 1, 1)) * plotW;
  const y = (price: number) => padY + ((max - price) / span) * plotH;
  const levelY = (price: string) => {
    const n = Number(price);
    return Number.isFinite(n) && n >= min - span * 0.08 && n <= max + span * 0.08 ? y(n) : null;
  };

  const levels = [
    { label: "R", value: keyLevels.resistance, cls: "text-red-400" },
    { label: "S", value: keyLevels.support, cls: "text-emerald-400" },
    { label: "INV", value: keyLevels.invalidation, cls: "text-amber-400" },
  ];

  const tradeLevels = tradePlan
    ? [
        { label: "ENTRY", value: tradePlan.entry, cls: "text-sky-400" },
        { label: "SL", value: tradePlan.stopLoss, cls: "text-red-400" },
        { label: "TP", value: tradePlan.takeProfit, cls: "text-emerald-400" },
      ]
    : [];

  return (
    <Card className="border-border/50">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-xs font-mono">$ price-structure · provider OHLCV</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[680px] h-[280px]" role="img" aria-label="Provider OHLCV price structure chart">
            <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} className="stroke-border" strokeWidth="1" />
            {data.map((c, i) => {
              const cx = x(i);
              const bullish = c.close >= c.open;
              const top = y(Math.max(c.open, c.close));
              const bottom = y(Math.min(c.open, c.close));
              return (
                <g key={`${c.timestamp}-${i}`}>
                  <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} className={bullish ? "stroke-emerald-400" : "stroke-red-400"} strokeWidth="1" />
                  <rect
                    x={cx - candleW / 2}
                    y={Math.min(top, bottom)}
                    width={candleW}
                    height={Math.max(1, Math.abs(bottom - top))}
                    className={bullish ? "fill-emerald-400/70" : "fill-red-400/70"}
                    rx="1"
                  />
                </g>
              );
            })}
            {[...levels, ...tradeLevels].map((l) => {
              const ly = levelY(l.value);
              if (ly === null) return null;
              return (
                <g key={l.label}>
                  <line x1={padX} x2={width - padX} y1={ly} y2={ly} className={`stroke-current ${l.cls} opacity-50`} strokeDasharray="5 4" />
                  <text x={width - padX - 4} y={ly - 4} textAnchor="end" className={`fill-current ${l.cls} text-[10px] font-mono`}>{l.label} {fmt(Number(l.value))}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-muted-foreground">
          <span>● {data.length} candles</span>
          <span>R {fmt(Number(keyLevels.resistance))}</span>
          <span>S {fmt(Number(keyLevels.support))}</span>
          <span>INV {fmt(Number(keyLevels.invalidation))}</span>
          {tradePlan && <span>RR {tradePlan.riskReward.toFixed(2)}R</span>}
        </div>
      </CardContent>
    </Card>
  );
}
