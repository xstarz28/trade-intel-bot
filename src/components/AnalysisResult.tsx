import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import type { AnalysisResult as AnalysisResultType } from "@/types/analysis";
import { cn, getTimeAgo } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Info,
  Activity,
} from "lucide-react";

const BIAS_CONFIG = {
  Bullish: {
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
    badge: "bg-emerald-500/15 text-emerald-400",
  },
  Bearish: {
    icon: TrendingDown,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/25",
    badge: "bg-red-500/15 text-red-400",
  },
  Neutral: {
    icon: Minus,
    color: "text-muted-foreground",
    bg: "bg-muted/30",
    border: "border-border/50",
    badge: "bg-muted/30 text-muted-foreground",
  },
} as const;

const COMPLETENESS_CONFIG = {
  full: { label: "full data", color: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle2 },
  partial: { label: "partial data", color: "bg-amber-500/15 text-amber-400", icon: Info },
  limited: { label: "limited data", color: "bg-red-500/15 text-red-400", icon: AlertTriangle },
} as const;

interface AnalysisResultProps {
  result: AnalysisResultType;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function AnalysisResultDisplay({ result }: AnalysisResultProps) {
  const biasConfig = BIAS_CONFIG[result.bias];
  const BiasIcon = biasConfig.icon;
  const completenessConfig = COMPLETENESS_CONFIG[result.dataCompleteness];
  const CompletenessIcon = completenessConfig.icon;
  const timeAgo = getTimeAgo(result.timestamp);

  const tech = result.technicalData;
  const priceSnap = result.priceSnapshot;

  return (
    <div className="space-y-4">
      {/* Header — Bias + Confidence */}
      <Card className={cn("border", biasConfig.border, "overflow-hidden")}>
        <div className={cn("px-5 py-4", biasConfig.bg)}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn("flex size-10 items-center justify-center rounded-xl border", biasConfig.border, biasConfig.bg)}>
                <BiasIcon className={cn("size-5", biasConfig.color)} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold tracking-tight font-mono">{result.instrument}</h3>
                  <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                    {result.timeframe}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn("text-sm font-semibold font-mono", biasConfig.color)}>
                    {result.bias}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">bias</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tracking-tight tabular-nums font-mono">
                {result.confidence}
                <span className="text-sm font-medium text-muted-foreground">%</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">confidence</p>
            </div>
          </div>

          {/* Price Snapshot */}
          {priceSnap && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Price:</span>
                <span className="text-sm font-bold font-mono tabular-nums">{formatPrice(priceSnap.price)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground">{formatTime(priceSnap.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">Source:</span>
                <span className="text-[10px] font-mono text-primary">{result.dataSource || priceSnap.source}</span>
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <Clock className="size-3" />
              {timeAgo}
            </div>
            <Badge className={cn("text-[10px] font-mono", completenessConfig.color)}>
              <CompletenessIcon className="size-3 mr-1" />
              {completenessConfig.label}
            </Badge>
            {tech && tech.dataPoints > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                <Activity className="size-3 mr-1" />
                {tech.dataPoints} candles
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Technical Indicators Quick View */}
      {tech && tech.dataPoints > 0 && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> indicators
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {tech.rsi14 !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">RSI(14)</p>
                  <p className={cn(
                    "text-sm font-bold font-mono tabular-nums",
                    tech.rsi14 > 70 ? "text-red-400" : tech.rsi14 < 30 ? "text-emerald-400" : "text-foreground"
                  )}>
                    {tech.rsi14.toFixed(1)}
                  </p>
                </div>
              )}
              {tech.macdHistogram !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">MACD Hist</p>
                  <p className={cn(
                    "text-sm font-bold font-mono tabular-nums",
                    tech.macdHistogram > 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {tech.macdHistogram > 0 ? "+" : ""}{tech.macdHistogram.toFixed(4)}
                  </p>
                </div>
              )}
              {tech.sma50 !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">SMA(50)</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {formatPrice(tech.sma50)}
                  </p>
                </div>
              )}
              {tech.atr14 !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">ATR(14)</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {tech.atr14.toFixed(4)}
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
              {tech.structure !== "unknown" && (
                <span className={cn(
                  "text-[10px] font-mono px-1.5 py-0.5 rounded",
                  tech.structure === "HH/HL" ? "bg-emerald-500/10 text-emerald-400" :
                  tech.structure === "LH/LL" ? "bg-red-500/10 text-red-400" :
                  "bg-muted/30 text-muted-foreground"
                )}>
                  {tech.structure}
                </span>
              )}
              {tech.bosDirection && tech.bosDirection !== "none" && (
                <span className="text-[10px] font-mono text-amber-400">
                  BOS {tech.bosDirection}
                </span>
              )}
              {tech.chochDirection && tech.chochDirection !== "none" && (
                <span className="text-[10px] font-mono text-amber-400">
                  CHoCH {tech.chochDirection}
                </span>
              )}
              {tech.volumeTrend !== "unknown" && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  Vol: {tech.volumeTrend}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Flags */}
      {result.dataFlags.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] font-mono font-semibold text-amber-400 mb-1">
                  $ warnings
                </p>
                <ul className="space-y-0.5">
                  {result.dataFlags.map((flag, i) => (
                    <li key={i} className="text-[11px] text-amber-300/70 font-mono">
                      ⚠ {flag}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Technical Summary */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> technical
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-muted-foreground font-mono">{result.technicalSummary}</p>
        </CardContent>
      </Card>

      {/* Fundamental Summary */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> fundamental
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-muted-foreground font-mono">{result.fundamentalSummary}</p>
        </CardContent>
      </Card>

      {/* Score Breakdown */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> score-breakdown
            </h4>
            <Badge variant="outline" className="text-[10px] font-mono ml-auto border-border/50">
              {result.breakdown.trend > 0 ? "+" : ""}{result.breakdown.trend} |{" "}
              {result.breakdown.indicator > 0 ? "+" : ""}{result.breakdown.indicator} |{" "}
              {result.breakdown.fundamental > 0 ? "+" : ""}{result.breakdown.fundamental} |{" "}
              {result.breakdown.sentiment > 0 ? "+" : ""}{result.breakdown.sentiment}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ScoreBreakdown breakdown={result.breakdown} />
        </CardContent>
      </Card>

      {/* Key Levels */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> key-levels
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-wider mb-1">
                support
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.support}</p>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-1">
                resistance
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.resistance}</p>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-amber-400 uppercase tracking-wider mb-1">
                invalidation
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.invalidation}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Note */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-amber-400">
              <span className="text-amber-400/60">$</span> risk-note
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-amber-200/70 font-mono">
            {result.riskNote}
          </p>
          <Separator className="my-3 bg-amber-500/10" />
          <p className="text-[11px] text-amber-300/50 font-mono italic">
            This is a decision-support tool, not financial advice. Verify independently before taking any action.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
