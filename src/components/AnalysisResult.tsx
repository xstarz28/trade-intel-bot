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

/** Qualitative conviction level — replaces accuracy claims. Reflects actual
 *  confluence strength: High only when evidence aligns without major conflict. */
function getConviction(confidence: number): { label: "High" | "Medium" | "Low"; color: string } {
  if (confidence >= 70) return { label: "High", color: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" };
  if (confidence >= 50) return { label: "Medium", color: "bg-amber-500/15 text-amber-400 border border-amber-500/30" };
  return { label: "Low", color: "bg-muted/40 text-muted-foreground border border-border/50" };
}

const ASSET_CLASS_LABEL: Record<string, string> = {
  forex: "Forex",
  crypto: "Crypto",
  stock: "Stock",
  commodity: "Commodity",
  index: "Index Futures",
};

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
  const conviction = getConviction(result.confidence);

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
                {/* Institutional output header: INSTRUMENT | Asset Class | Timeframe */}
                <p className="text-sm font-bold tracking-tight font-mono">
                  {result.instrument}
                  <span className="text-muted-foreground"> | </span>
                  <span className="text-xs font-medium text-muted-foreground">{ASSET_CLASS_LABEL[result.instrumentType] || result.instrumentType}</span>
                  <span className="text-muted-foreground"> | </span>
                  <span className="text-xs font-medium text-muted-foreground">{result.timeframe}</span>
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={cn("text-sm font-semibold font-mono", biasConfig.color)}>
                    BIAS: {result.bias}
                  </span>
                  {result.recommendation === "NO_TRADE" ? (
                    <Badge className="text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/30">
                      ⛔ NO TRADE
                    </Badge>
                  ) : (
                    <Badge
                      className={cn(
                        "text-[10px] font-mono border",
                        result.recommendation === "LONG"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30",
                      )}
                    >
                      {result.recommendation === "LONG" ? "▲ LONG" : "▼ SHORT"}
                    </Badge>
                  )}
                  {result.conviction && (
                    <Badge variant="outline" className={cn("text-[10px] font-mono", conviction.color)}>
                      Conviction: {result.conviction}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tracking-tight tabular-nums font-mono">
                {result.confidence}
                <span className="text-sm font-medium text-muted-foreground">%</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">confluence score</p>
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

      {/* Phase 3A — Multi-Timeframe transparency (only what the engine computed) */}
      {result.mtfSummary && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> multi-timeframe
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  result.mtfSummary.alignment === "ALIGNED_BULLISH" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  result.mtfSummary.alignment === "ALIGNED_BEARISH" && "bg-red-500/10 text-red-400 border-red-500/30",
                  (result.mtfSummary.alignment === "MIXED" || result.mtfSummary.alignment === "COUNTER_TREND") && "bg-amber-500/10 text-amber-400 border-amber-500/30",
                  result.mtfSummary.alignment === "INSUFFICIENT_DATA" && "bg-muted/30 text-muted-foreground border-border/50",
                )}
              >
                {result.mtfSummary.alignment}
              </Badge>
              <span className="text-[10px] font-mono text-muted-foreground">
                chain: {result.mtfSummary.chainUsed.length > 0 ? result.mtfSummary.chainUsed.join(" → ") : "none available"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
              <div>
                HTF bias: <span className="text-foreground">{result.mtfSummary.htfBias}</span>
                {result.mtfSummary.htfBias !== "none" && result.technicalData?.mtf?.htfTimeframe && (
                  <> ({result.technicalData.mtf.htfTimeframe})</>
                )}
              </div>
              <div>Setup: <span className="text-foreground">{result.mtfSummary.setupTimeframe}</span></div>
              <div>
                Trigger: <span className="text-foreground">{result.mtfSummary.triggerTimeframe ?? "—"}</span>
              </div>
            </div>
            {result.mtfSummary.unavailable.length > 0 && (
              <p className="mt-2 pt-2 border-t border-border/30 text-[10px] font-mono text-amber-400/90">
                ⚠ unavailable (not synthesized): {result.mtfSummary.unavailable.map((u) => u.timeframe).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* NO TRADE — explicit rejection reasons */}
      {result.recommendation === "NO_TRADE" && result.noTradeReasons.length > 0 && (
        <Card className="border-red-500/25 bg-red-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-red-400">⛔ no-trade — setup rejected</h4>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1.5">
              {result.noTradeReasons.map((reason, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-red-300/80 font-mono flex gap-1.5">
                  <span className="shrink-0">—</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Trade Plan — market-derived levels only; NEVER rendered for NO_TRADE */}
      {result.tradePlan && result.recommendation !== "NO_TRADE" && (
        <Card className={cn("border", biasConfig.border)}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> trade-plan
              </h4>
              <Badge variant="outline" className="text-[10px] font-mono ml-auto border-border/50">
                R:R {result.tradePlan.riskReward.toFixed(2)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/20 border border-border/50 px-3 py-2.5">
                <p className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  entry
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.entry}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">market price</p>
              </div>
              <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
                <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-1">
                  stop loss
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.stopLoss}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 break-words">{result.tradePlan.slBasis}</p>
              </div>
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
                <p className="text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-wider mb-1">
                  take profit
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.takeProfit}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 break-words">{result.tradePlan.tpBasis}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 3B — Position sizing: shown ONLY when fully computable from
          real user inputs + complete instrument spec. Never fabricated. */}
      {result.positionSizing?.available && result.recommendation !== "NO_TRADE" && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> position-sizing{" "}
              <span className="text-muted-foreground/50">(from your inputs — not advice)</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-[10px] font-mono text-muted-foreground">quantity</p>
                <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                  {result.positionSizing.quantity}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground/60">{result.positionSizing.quantityUnit}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-mono text-muted-foreground">risk amount</p>
                <p className="text-sm font-bold font-mono tabular-nums text-red-400">
                  ≈{result.positionSizing.riskAmount?.toFixed(2)}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground/60">
                  at {((result.positionSizing.appliedRiskPercent ?? 0) * 100).toFixed(2)}% risk
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-mono text-muted-foreground">risk / unit</p>
                <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                  {result.positionSizing.riskPerUnit?.toFixed(4)}
                </p>
              </div>
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

      {/* News Sentiment (Alpha Vantage) */}
      {result.sentimentData && result.sentimentData.confidence !== "unavailable" && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> news-sentiment
              </h4>
              <Badge
                className={cn(
                  "text-[10px] font-mono",
                  result.sentimentData.label === "bullish" ? "bg-emerald-500/15 text-emerald-400" :
                  result.sentimentData.label === "bearish" ? "bg-red-500/15 text-red-400" :
                  "bg-muted/30 text-muted-foreground"
                )}
              >
                {result.sentimentData.label}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {result.sentimentData.articleCount} articles
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-4 mb-3">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">avg score</p>
                <p className={cn(
                  "text-sm font-bold font-mono tabular-nums",
                  result.sentimentData.averageScore > 0 ? "text-emerald-400" : result.sentimentData.averageScore < 0 ? "text-red-400" : "text-foreground"
                )}>
                  {result.sentimentData.averageScore > 0 ? "+" : ""}{result.sentimentData.averageScore.toFixed(3)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">positive</p>
                <p className="text-sm font-bold font-mono text-emerald-400 tabular-nums">{result.sentimentData.breakdown.positive}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">negative</p>
                <p className="text-sm font-bold font-mono text-red-400 tabular-nums">{result.sentimentData.breakdown.negative}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">neutral</p>
                <p className="text-sm font-bold font-mono text-muted-foreground tabular-nums">{result.sentimentData.breakdown.neutral}</p>
              </div>
            </div>
            {result.sentimentData.articles.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono font-medium text-muted-foreground">top headlines</p>
                {result.sentimentData.articles.slice(0, 3).map((article, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md bg-muted/20 px-2.5 py-2">
                    <span className={cn(
                      "mt-1 size-1.5 rounded-full shrink-0",
                      article.sentimentScore !== undefined ? (article.sentimentScore > 0.1 ? "bg-emerald-400" : article.sentimentScore < -0.1 ? "bg-red-400" : "bg-muted-foreground") : "bg-muted-foreground"
                    )} />
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-foreground truncate">{article.title}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{article.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Macro Context (Alpha Vantage) */}
      {result.macroData && result.macroData.confidence !== "unavailable" && result.macroData.indicators.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> macro-context
              </h4>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {result.macroData.confidence}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm leading-relaxed text-muted-foreground font-mono mb-3">{result.macroData.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {result.macroData.indicators.slice(0, 6).map((ind, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono",
                    ind.sentiment === "positive" ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/5" :
                    ind.sentiment === "negative" ? "border-red-500/20 text-red-400 bg-red-500/5" :
                    "border-border/50 text-muted-foreground bg-muted/10"
                  )}
                >
                  {ind.name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock Fundamentals (Alpha Vantage) */}
      {result.fundamentalData && result.fundamentalData.available && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> fundamentals
              </h4>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {result.fundamentalData.sector || result.fundamentalData.industry || "stock"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {result.fundamentalData.peRatio !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">P/E</p>
                  <p className="text-sm font-bold font-mono tabular-nums">{result.fundamentalData.peRatio.toFixed(1)}</p>
                </div>
              )}
              {result.fundamentalData.earningsPerShare !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">EPS</p>
                  <p className="text-sm font-bold font-mono tabular-nums">${result.fundamentalData.earningsPerShare.toFixed(2)}</p>
                </div>
              )}
              {result.fundamentalData.profitMargin !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">Margin</p>
                  <p className="text-sm font-bold font-mono tabular-nums">{(result.fundamentalData.profitMargin * 100).toFixed(1)}%</p>
                </div>
              )}
              {result.fundamentalData.marketCap !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">Mkt Cap</p>
                  <p className="text-sm font-bold font-mono tabular-nums">${(result.fundamentalData.marketCap / 1e9).toFixed(1)}B</p>
                </div>
              )}
              {result.fundamentalData.dividendYield !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">Div Yield</p>
                  <p className="text-sm font-bold font-mono tabular-nums">{(result.fundamentalData.dividendYield * 100).toFixed(2)}%</p>
                </div>
              )}
              {result.fundamentalData.fiftyTwoWeekHigh !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">52W High</p>
                  <p className="text-sm font-bold font-mono tabular-nums">{formatPrice(result.fundamentalData.fiftyTwoWeekHigh)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.support || "—"}</p>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-1">
                resistance
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.resistance || "—"}</p>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-amber-400 uppercase tracking-wider mb-1">
                invalidation
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels.invalidation || "—"}</p>
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

      {/* Derivatives / Positioning (crypto only) */}
      {result.derivativesData && result.derivativesData.confidence !== "unavailable" && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> derivatives-positioning
              </h4>
              <Badge
                className={cn(
                  "text-[10px] font-mono",
                  result.derivativesData.confidence === "high" ? "bg-emerald-500/15 text-emerald-400" :
                  result.derivativesData.confidence === "medium" ? "bg-amber-500/15 text-amber-400" :
                  "bg-red-500/15 text-red-400"
                )}
              >
                {result.derivativesData.confidence} confidence
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {result.derivativesData.fundingRate && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">funding rate</p>
                  <p className={cn(
                    "text-sm font-bold font-mono tabular-nums",
                    result.derivativesData.fundingRate.currentRate > 0.001 ? "text-red-400" :
                    result.derivativesData.fundingRate.currentRate < -0.001 ? "text-emerald-400" :
                    "text-foreground"
                  )}>
                    {(result.derivativesData.fundingRate.currentRate * 100).toFixed(4)}%
                  </p>
                  {result.derivativesData.fundingRate.annualizedRate !== undefined && (
                    <p className="text-[10px] font-mono text-muted-foreground">
                      ~{(result.derivativesData.fundingRate.annualizedRate * 100).toFixed(1)}% ann.
                    </p>
                  )}
                </div>
              )}
              {result.derivativesData.openInterest && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">open interest</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {result.derivativesData.openInterest.current > 1e9
                      ? `$${(result.derivativesData.openInterest.current / 1e9).toFixed(2)}B`
                      : result.derivativesData.openInterest.current > 1e6
                        ? `$${(result.derivativesData.openInterest.current / 1e6).toFixed(1)}M`
                        : `$${result.derivativesData.openInterest.current.toFixed(0)}`}
                  </p>
                  {result.derivativesData.openInterest.change1h !== undefined && (
                    <p className={cn(
                      "text-[10px] font-mono",
                      result.derivativesData.openInterest.change1h! > 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {result.derivativesData.openInterest.change1h! > 0 ? "+" : ""}{result.derivativesData.openInterest.change1h!.toFixed(1)}% (1h)
                    </p>
                  )}
                </div>
              )}
              {result.derivativesData.longShort && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">L/S ratio</p>
                  {result.derivativesData.longShort.accountRatio !== undefined && (
                    <p className={cn(
                      "text-sm font-bold font-mono tabular-nums",
                      result.derivativesData.longShort.accountRatio > 1.5 ? "text-red-400" :
                      result.derivativesData.longShort.accountRatio < 0.67 ? "text-emerald-400" :
                      "text-foreground"
                    )}>
                      {result.derivativesData.longShort.accountRatio.toFixed(2)}
                    </p>
                  )}
                  {result.derivativesData.longShort.topTraderRatio !== undefined && (
                    <p className="text-[10px] font-mono text-muted-foreground">
                      top: {result.derivativesData.longShort.topTraderRatio.toFixed(2)}
                    </p>
                  )}
                </div>
              )}
              {result.derivativesData.liquidations && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">liquidations</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {result.derivativesData.liquidations.totalVolume !== undefined
                      ? `$${(result.derivativesData.liquidations.totalVolume / 1e6).toFixed(1)}M`
                      : "—"}
                  </p>
                  {result.derivativesData.liquidations.dominantSide && (
                    <p className={cn(
                      "text-[10px] font-mono",
                      result.derivativesData.liquidations.dominantSide === "longs" ? "text-red-400" :
                      result.derivativesData.liquidations.dominantSide === "shorts" ? "text-emerald-400" :
                      "text-muted-foreground"
                    )}>
                      {result.derivativesData.liquidations.dominantSide} liquidated
                    </p>
                  )}
                </div>
              )}
            </div>
            {result.derivativesData.interpretation && (
              <div className="pt-2 border-t border-border/30">
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">interpretation</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground font-mono">
                  {result.derivativesData.interpretation}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Economic Calendar / Macro Risk */}
      {result.calendarData && result.calendarData.confidence !== "unavailable" && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> economic-calendar
              </h4>
              <Badge variant="outline" className={cn(
                "text-[10px] font-mono",
                result.calendarData.macroRisk.level === "high" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                result.calendarData.macroRisk.level === "medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              )}>
                macro risk: {result.calendarData.macroRisk.level}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Macro Risk Explanation */}
            <div className="mb-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground font-mono">
                {result.calendarData.macroRisk.explanation}
              </p>
            </div>

            {/* Upcoming High-Impact Events */}
            {result.calendarData.events.filter((e) => e.status === "upcoming" && e.importance === 3).length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">upcoming high-impact</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {result.calendarData.events
                    .filter((e) => e.status === "upcoming" && e.importance === 3)
                    .slice(0, 4)
                    .map((evt) => {
                      const hrs = Math.round((evt.datetime - Date.now()) / (1000 * 60 * 60));
                      return (
                        <div key={evt.id} className="bg-red-500/5 border border-red-500/20 rounded p-2">
                          <p className="text-[11px] font-mono font-medium text-foreground">{evt.event}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">
                            {evt.currency} · in {hrs}h
                          </p>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Recently Released Events with Surprises */}
            {result.calendarData.events.filter((e) => e.status === "released" && e.importance === 3 && e.actual !== undefined).length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">recent high-impact releases</p>
                <div className="space-y-1">
                  {result.calendarData.events
                    .filter((e) => e.status === "released" && e.importance === 3 && e.actual !== undefined)
                    .slice(0, 3)
                    .map((evt) => {
                      const actualNum = typeof evt.actual === "number" ? evt.actual : parseFloat(String(evt.actual));
                      const forecastNum = typeof evt.forecast === "number" ? evt.forecast : parseFloat(String(evt.forecast));
                      const surprise = !isNaN(actualNum) && !isNaN(forecastNum) ? actualNum - forecastNum : null;
                      return (
                        <div key={evt.id} className="flex items-center gap-2 text-[10px] font-mono">
                          <span className="text-muted-foreground truncate">{evt.event}</span>
                          <span className="text-foreground">{String(evt.actual)}</span>
                          <span className="text-muted-foreground">vs</span>
                          <span className="text-foreground">{String(evt.forecast)}</span>
                          {surprise !== null && (
                            <span className={cn(
                              "font-medium",
                              surprise > 0 ? "text-emerald-400" : "text-red-400"
                            )}>
                              {surprise > 0 ? "+" : ""}{surprise.toFixed(2)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
