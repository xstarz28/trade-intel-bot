import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import type { AnalysisResult as AnalysisResultType, InstrumentType } from "@/types/analysis";
import { cn, getTimeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { mapTrendLabel, mapConfidence, mapFreshness } from "@/lib/i18n/enum-mapping";
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
  full: { color: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle2 },
  partial: { color: "bg-amber-500/15 text-amber-400", icon: Info },
  limited: { color: "bg-red-500/15 text-red-400", icon: AlertTriangle },
} as const;

const COMPLETENESS_LABEL_KEYS = {
  full: "analysisResult.dataFull",
  partial: "analysisResult.dataPartial",
  limited: "analysisResult.dataLimited",
} as const;

/** Phase 276 — deterministic fundamental assessment display maps. */
const FA_STATE_LABEL_KEYS = {
  improving: "analysisResult.fundamentalAssessment.improving",
  weakening: "analysisResult.fundamentalAssessment.weakening",
  mixed: "analysisResult.fundamentalAssessment.mixed",
  insufficient: "analysisResult.fundamentalAssessment.insufficient",
} as const;

/** Interpretation chip colours — derived state only, never a claim. */
const FA_STATE_STYLE = {
  improving: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  weakening: "bg-red-500/15 text-red-400 border-red-500/25",
  mixed: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  insufficient: "bg-muted/30 text-muted-foreground border-border/50",
} as const;

/** Evidence-dot colours per dimension status. */
const FA_DIM_DOT = {
  positive: "bg-emerald-400",
  negative: "bg-red-400",
  neutral: "bg-muted-foreground/50",
  unavailable: "bg-border",
} as const;

/** Phase 276 — unified intelligence display maps (state → label key + style). */
const UI_STATE_LABEL_KEYS = {
  aligned_bullish: "analysisResult.unifiedIntelligence.alignedBullish",
  aligned_bearish: "analysisResult.unifiedIntelligence.alignedBearish",
  conflicting: "analysisResult.unifiedIntelligence.conflicting",
  mixed: "analysisResult.unifiedIntelligence.mixed",
  technical_only: "analysisResult.unifiedIntelligence.technicalOnly",
  fundamental_only: "analysisResult.unifiedIntelligence.fundamentalOnly",
  insufficient: "analysisResult.unifiedIntelligence.insufficient",
} as const;

const UI_STATE_STYLE = {
  aligned_bullish: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  aligned_bearish: "bg-red-500/15 text-red-400 border-red-500/25",
  conflicting: "bg-red-500/15 text-red-300 border-red-500/25",
  mixed: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  technical_only: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  fundamental_only: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  insufficient: "bg-muted/30 text-muted-foreground border-border/50",
} as const;

/** Qualitative conviction level — replaces accuracy claims. Reflects actual
 *  confluence strength: High only when evidence aligns without major conflict. */
function getConviction(confidence: number): { label: "High" | "Medium" | "Low"; color: string } {
  if (confidence >= 70) return { label: "High", color: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" };
  if (confidence >= 50) return { label: "Medium", color: "bg-amber-500/15 text-amber-400 border border-amber-500/30" };
  return { label: "Low", color: "bg-muted/40 text-muted-foreground border border-border/50" };
}

/**
 * Phase 190 — keyed by `InstrumentType`, not `string`.
 *
 * This map previously had an `index` key while the union member is `indices`,
 * so the entry was unreachable and an indices analysis fell through to the
 * raw union value. Typing the record makes the compiler reject that drift.
 */
const ASSET_CLASS_LABEL: Record<InstrumentType, string> = {
  forex: "Forex",
  crypto: "Crypto",
  stock: "Stock",
  commodity: "Commodity",
  indices: "Indices",
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
  const { t, tx, txi } = useI18n();
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
                {/* Institutional output header: INSTRUMENT | Asset Class | Timeframe + provider identity chip (Phase255) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold tracking-tight font-mono">
                    {result.instrument}
                    <span className="text-muted-foreground"> | </span>
                    <span className="text-xs font-medium text-muted-foreground">{ASSET_CLASS_LABEL[result.instrumentType] || result.instrumentType}</span>
                    <span className="text-muted-foreground"> | </span>
                    <span className="text-xs font-medium text-muted-foreground">{result.timeframe}</span>
                  </p>
                  {result.provider && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/30 border border-border/50 text-muted-foreground/70">
                      {result.provider}
                      {result.providerInstrumentId && result.providerInstrumentId !== result.instrument
                        ? `:${result.providerInstrumentId}`
                        : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={cn("text-sm font-semibold font-mono", biasConfig.color)}>
                    BIAS: {mapTrendLabel(result.bias, t)}
                  </span>
                  {result.recommendation === "NO_TRADE" ? (
                    <Badge className="text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/30">
                      ⛔ {tx("analysis.noTrade")}
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
                      {result.recommendation === "LONG"
                        ? `▲ ${tx("analysis.long")}`
                        : `▼ ${tx("analysis.short")}`}
                    </Badge>
                  )}
                  {result.conviction && (
                    <Badge variant="outline" className={cn("text-[10px] font-mono", conviction.color)}>
                      {tx("analysisResult.convictionPrefix")} {mapConfidence(result.conviction, t)}
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
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{tx("analysisResult.confluenceScore")}</p>
            </div>
          </div>

          {/* Price Snapshot */}
          {priceSnap && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.inline.priceLabel}</span>
                <span className="text-sm font-bold font-mono tabular-nums">{formatPrice(priceSnap.price)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground">{formatTime(priceSnap.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.sourceLabel}</span>
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
              {tx(COMPLETENESS_LABEL_KEYS[result.dataCompleteness])}
            </Badge>
            {tech && tech.dataPoints > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                <Activity className="size-3 mr-1" />
                {txi("analysisResult.candlesCount", { count: tech.dataPoints })}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Technical Indicators Quick View */}
      {/* Phase 25 — Data Quality transparency panel. Informational only — never directional. */}
      {result.dataQualityContext && (() => {
        const dq = result.dataQualityContext;
        const primaryStatus = dq.primaryData.status;
        const STATUS_COLORS: Record<string, string> = {
          GOOD: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          DEGRADED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          INSUFFICIENT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          STALE: "bg-red-500/15 text-red-400 border-red-500/30",
          UNAVAILABLE: "bg-red-500/15 text-red-400 border-red-500/30",
          INVALID: "bg-red-500/15 text-red-400 border-red-500/30",
        };
        const IND_COLORS: Record<string, string> = {
          AVAILABLE: "text-emerald-400",
          INSUFFICIENT_DATA: "text-amber-400",
          UNAVAILABLE: "text-red-400",
        };
        return (
          <Card className="border-border/50">
            <CardContent className="px-4 py-3">
              <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                <span className="text-primary/60">$</span> {t.analysisResult.sections.dataQuality}
                <span className="text-muted-foreground/50">{" · "}{tx("analysisResult.informationalNotDirectional")}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge className={cn("text-[10px] font-mono", STATUS_COLORS[primaryStatus] ?? "bg-muted/30 text-muted-foreground border-border/50")}>
                  primary: {primaryStatus}
                </Badge>
                {dq.primaryData.validCount !== undefined && dq.primaryData.expectedCount !== undefined && (
                  <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                    {dq.primaryData.validCount}/{dq.primaryData.expectedCount} candles
                  </Badge>
                )}
                {dq.primaryData.provider && (
                  <span className="text-[10px] font-mono text-muted-foreground/60">provider: {dq.primaryData.provider}</span>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/60 mb-2">{dq.primaryData.reason}</p>
              {/* Indicator availability */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono mb-2">
                {(["sma", "rsi", "macd", "atr", "smc"] as const).map((key) => {
                  const item = dq.indicators[key];
                  return (
                    <span key={key} className={IND_COLORS[item.status]}>
                      {key.toUpperCase()}: {item.status === "AVAILABLE" ? "✓" : item.status === "INSUFFICIENT_DATA" ? "⚠" : "✗"}
                    </span>
                  );
                })}
              </div>
              {/* MTF quality */}
              <div className="flex items-center gap-2 mb-2 text-[10px] font-mono">
                <span className={IND_COLORS[dq.mtf.status === "GOOD" ? "AVAILABLE" : dq.mtf.status === "UNAVAILABLE" ? "UNAVAILABLE" : "INSUFFICIENT_DATA"]}>
                  MTF: {dq.mtf.status}
                </span>
                <span className="text-muted-foreground/50">{dq.mtf.reason}</span>
              </div>
              {/* Provider availability summary */}
              {(() => {
                const entries = Object.entries(dq.providers).filter(([, v]) => v !== undefined) as [string, { status: string; reason: string; provider?: string }][];
                if (entries.length === 0) return null;
                return (
                  <div className="border-t border-border/30 pt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
                    {entries.map(([name, item]) => (
                      <span key={name} className={IND_COLORS[item.status] ?? "text-muted-foreground"}>
                        {name}: {item.status === "GOOD" ? "✓" : item.status === "UNAVAILABLE" ? "✗" : "⚠"}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        );
      })()}
      {tech && tech.dataPoints > 0 && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.indicators}
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
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.macdHist}</p>
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
              {tech.ema20 !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">EMA(20)</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {formatPrice(tech.ema20)}
                  </p>
                </div>
              )}
              {tech.ema50 !== undefined && (
                <div className="text-center">
                  <p className="text-[10px] font-mono text-muted-foreground">EMA(50)</p>
                  <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                    {formatPrice(tech.ema50)}
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
              {/* Phase 273 — volatility regime as computed by the engine from
                  this exact candle series (ATR vs its own preceding baseline).
                  Never a UI-side re-derivation: the displayed state is the
                  same field the narrative and decision consumed. */}
              {tech.volatilityState === "expanded" && (
                <span className="text-[10px] font-mono text-amber-400">
                  {t.intelligence.volatilityExpanded}{tech.atrRatio !== undefined ? ` ${tech.atrRatio.toFixed(2)}×` : ""}
                </span>
              )}
              {tech.volatilityState === "compressed" && (
                <span className="text-[10px] font-mono text-sky-400">
                  {t.intelligence.volatilityCompressed}{tech.atrRatio !== undefined ? ` ${tech.atrRatio.toFixed(2)}×` : ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 5 — Market context: regime, setup class, key contradictions.
          Only what the engine actually computed — no invented labels. */}
      {(result.marketRegime || result.setupClassification) && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.marketContext}{" "}
              <span className="text-muted-foreground/50">· style: {result.tradingStyle}</span>
              {result.styleInfo?.fallbackApplied && (
                <span className="text-amber-400/80"> · TF fallback: {result.styleInfo.requestedTimeframe}→{result.styleInfo.setupTimeframeUsed}</span>
              )}
            </p>
            {(result.styleInfo?.notes.length ?? 0) > 0 && (
              <div className="mb-2">
                {result.styleInfo!.notes.map((n, i) => (
                  <p key={i} className="text-[10px] font-mono text-amber-400/80 leading-relaxed">{n}</p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-2">
              {result.marketRegime && (
                <span
                  className={`rounded border px-2 py-0.5 text-[9px] font-mono ${
                    result.marketRegime.regime === "TRENDING"
                      ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                      : result.marketRegime.regime === "RANGING"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : result.marketRegime.regime === "UNKNOWN"
                          ? "bg-muted/30 text-muted-foreground border-border/50"
                          : "bg-violet-500/10 text-violet-400 border-violet-500/30"
                  }`}
                >
                  regime: {result.marketRegime.regime}
                </span>
              )}
              {result.setupClassification && (
                <span className="rounded border bg-muted/30 px-2 py-0.5 text-[9px] font-mono text-muted-foreground">
                  setup: {result.setupClassification.setupClass}
                </span>
              )}
            </div>
            {result.setupClassification?.rationale && (
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">{result.setupClassification.rationale}</p>
            )}
            {/* Phase 7C — cross-asset provenance: actual price vs NEWS-derived proxy. */}
            {(() => {
              const xa = result.technicalData?.crossAsset;
              const dxyProxy =
                !xa?.available &&
                (result.instrumentType === "forex" || result.instrumentType === "commodity");
              if (!xa && !dxyProxy) return null;
              return (
                <p className="mt-2 border-t border-border/40 pt-2 text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                  {xa?.available ? (
                    <>
                      <span className="text-sky-300">{xa.comparatorSymbol} — Actual Price Data</span>{" "}
                      (source: {xa.provider ?? "provider"} · corr{" "}
                      {xa.correlation !== undefined ? xa.correlation.toFixed(2) : "n/a"} ·{" "}
                      {xa.directionalContext ?? "unknown"} · momentum {xa.comparatorMomentum ?? "unknown"})
                    </>
                  ) : (
                    <span className="text-amber-400/90">
                      USD proxy — NEWS-derived, not actual DXY price data
                      {xa?.unavailableReason ? ` (${xa.unavailableReason})` : ""}
                    </span>
                  )}
                  {!xa?.available && dxyProxy && (
                    <span className="block text-[9px] text-muted-foreground/50">
                      {t.analysisResult.labels.dxyUnavailable}
                    </span>
                  )}
                </p>
              );
            })()}
            {(result.keyContradictions?.filter((c) => c.severity !== "MINOR").length ?? 0) > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2">
                <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">{t.analysisResult.inline.keyContradictions}</p>
                {result.keyContradictions!
                  .filter((c) => c.severity !== "MINOR")
                  .map((c, i) => (
                    <p key={i} className="text-[10px] font-mono leading-relaxed">
                      <span
                        className={
                          c.severity === "DECISIVE"
                            ? "text-red-400"
                            : "text-amber-400"
                        }
                      >
                        [{c.severity}]
                      </span>{" "}
                      <span className="text-muted-foreground/80">{c.description}</span>
                    </p>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase 7B-1 — Treasury yield / real-yield provenance. Shown ONLY when
          the provider returned actual data; every number carries its
          observation date. Nominal and real are labeled separately. */}
      {result.treasuryContext && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.treasuryYields}{" "}
              <span
                className={cn(
                  "ml-1",
                  result.treasuryContext.freshness === "FRESH"
                    ? "text-emerald-400"
                    : result.treasuryContext.freshness === "DELAYED"
                      ? "text-amber-400"
                      : "text-red-400",
                )}
              >
                {mapFreshness(result.treasuryContext.freshness, t)}
              </span>
              <span className="text-muted-foreground/50"> · obs: {result.treasuryContext.latest.nominal.observationDate}</span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono">
              {(["2Y", "10Y", "30Y"] as const).map((t) =>
                result.treasuryContext!.latest.nominal.nominal[t] !== undefined ? (
                  <span key={t} className="text-muted-foreground/80">
                    nominal {t}:{" "}
                    <span className="text-foreground">{result.treasuryContext!.latest.nominal.nominal[t].toFixed(2)}%</span>
                  </span>
                ) : null,
              )}
              {result.treasuryContext.latest.real ? (
                (["5Y", "10Y", "30Y"] as const).map((t) =>
                  result.treasuryContext!.latest.real!.real[t] !== undefined ? (
                    <span key={`r-${t}`} className="text-muted-foreground/80">
                      real {t}:{" "}
                      <span className="text-sky-300">{result.treasuryContext!.latest.real!.real[t].toFixed(2)}%</span>
                    </span>
                  ) : null,
                )
              ) : (
                <span className="text-muted-foreground/60">{t.analysisResult.labels.realYieldUnavailable}</span>
              )}
            </div>
            <p className="mt-1.5 text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
              {result.treasuryContext.source} · nominal obs {result.treasuryContext.latest.nominal.observationDate}
              {result.treasuryContext.latest.real && ` · real obs ${result.treasuryContext.latest.real.observationDate}`} · fetched{" "}
              {new Date(result.treasuryContext.fetchedAt).toISOString().slice(0, 16).replace("T", " ")}Z · slow-moving macro context, never an entry trigger
            </p>
          </CardContent>
        </Card>
      )}

      {/* Phase 7B-2 — CFTC futures positioning provenance. Weekly slow data:
          always labeled as regulated futures positioning with its report date. */}
      {result.cotContext && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.cftcFuturesPositioning}{" "}
              <span
                className={cn(
                  "ml-1",
                  result.cotContext.freshness === "FRESH"
                    ? "text-emerald-400"
                    : result.cotContext.freshness === "DELAYED"
                      ? "text-amber-400"
                      : "text-red-400",
                )}
              >
                {mapFreshness(result.cotContext.freshness, t)}
              </span>
              <span className="text-muted-foreground/50"> · report: {result.cotContext.latest.reportDate}</span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
              <span>{t.analysisResult.labels.mapped}: <span className="text-foreground">{result.cotContext.mappedAsset}</span></span>
              <span>net non-commercial:{" "}
                <span className="text-foreground">{result.cotContext.netNonCommercial.toLocaleString()}</span>
              </span>
              {result.cotContext.changeFromPreviousReport !== undefined && (
                <span>
                  change:{" "}
                  <span className={result.cotContext.changeFromPreviousReport >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {result.cotContext.changeFromPreviousReport > 0 ? "+" : ""}
                    {result.cotContext.changeFromPreviousReport.toLocaleString()}
                  </span>
                </span>
              )}
              <span>non-comm L/S: {result.cotContext.latest.nonCommercialLong.toLocaleString()} / {result.cotContext.latest.nonCommercialShort.toLocaleString()}</span>
            </div>
            <p className="mt-1.5 text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
              {result.cotContext.source} · source contract: {result.cotContext.sourceInstrument} · weekly regulated
              futures positioning — never live/exchange data; level alone is not directional evidence
            </p>
          </CardContent>
        </Card>
      )}

      {/* Phase 7D — EIA WPSR inventory provenance. Weekly slow fundamental
          data: observation date always shown, never presented as live data. */}
      {result.eiaContext && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.eiaInventory}{" "}
              <span
                className={cn(
                  "ml-1",
                  result.eiaContext.freshness === "FRESH"
                    ? "text-emerald-400"
                    : result.eiaContext.freshness === "DELAYED"
                      ? "text-amber-400"
                      : "text-red-400",
                )}
              >
                {mapFreshness(result.eiaContext.freshness, t)}
              </span>
              <span className="text-muted-foreground/50">
                {" "}
                · obs: {result.eiaContext.series[0].observationDate}
              </span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
              {result.eiaContext.series.map((x) => (
                <span key={x.productId}>
                  {x.productId}:{" "}
                  <span className="text-foreground">
                    {x.latestValue.toLocaleString()} {x.unit ?? ""}
                  </span>
                  {x.change !== undefined && (
                    <span
                      className={
                        x.change >= 0
                          ? "text-red-400" // build = bearish for oil
                          : "text-emerald-400" // draw = bullish for oil
                      }
                    >
                      {" "}
                      ({x.change > 0 ? "+" : ""}
                      {x.change.toFixed(1)})
                    </span>
                  )}
                </span>
              ))}
              {result.eiaContext.failedLegs.length > 0 && (
                <span className="text-amber-400/80">
                  unavailable legs: {result.eiaContext.failedLegs.map((f) => f.productId).join(", ")}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
              {result.eiaContext.source} · weekly petroleum status report — contextual supply-demand evidence,
              not an entry trigger; availability alone contributes nothing
            </p>
          </CardContent>
        </Card>
      )}

      {/* Phase 7E — Execution quality provenance (crypto order book only). */}
      {result.executionContext && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.executionQuality}{" "}
              <span
                className={cn(
                  "ml-1",
                  result.executionContext.regime === "LIQUID" ? "text-emerald-400" : "text-amber-400",
                )}
              >
                {result.executionContext.regime}
              </span>
              <span
                className={cn(
                  "ml-1",
                  result.executionContext.freshness === "FRESH" ? "text-emerald-400" : "text-red-400",
                )}
              >
                {mapFreshness(result.executionContext.freshness, t)}
              </span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
              <span>bid/ask: <span className="text-foreground">{result.executionContext.bid} / {result.executionContext.ask}</span></span>
              <span>{t.analysisResult.labels.spread}: <span className="text-foreground">{result.executionContext.spreadBps.toFixed(2)} bps</span></span>
              <span>{t.analysisResult.labels.depthLR}: <span className="text-foreground">{result.executionContext.bidDepth.toFixed(2)} / {result.executionContext.askDepth.toFixed(2)}</span> {t.analysisResult.inline.contracts}</span>
              <span>{t.analysisResult.labels.imbalance}: <span className="text-foreground">{(result.executionContext.imbalance * 100).toFixed(0)}%</span></span>
              {result.slippageEstimate?.slippageBps !== undefined && (
                <span>est. impact: <span className="text-foreground">~{result.slippageEstimate.slippageBps.toFixed(1)} bps</span> (estimate)</span>
              )}
              {result.slippageEstimate?.unavailableReason && (
                <span className="text-amber-400/80">slippage: unavailable — {result.slippageEstimate.unavailableReason}</span>
              )}
            </div>
            {(result.executionWarnings?.length ?? 0) > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {result.executionWarnings!.map((w) => (
                  <li key={w} className="text-[9px] font-mono text-amber-400/80 leading-relaxed">⚠ {w}</li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
              {result.executionContext.provider} · snapshot ts {new Date(result.executionContext.snapshotTs).toISOString()} · refines
              executability of a valid thesis — never the thesis itself; not a probability or win-rate
            </p>
          </CardContent>
        </Card>
      )}

      {/* Phase 3A — Multi-Timeframe transparency (only what the engine computed) */}
      {result.mtfSummary && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.multiTimeframe}
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
              <div>{t.analysisResult.labels.setup}: <span className="text-foreground">{result.mtfSummary.setupTimeframe}</span></div>
              <div>
                {t.analysisResult.labels.trigger}: <span className="text-foreground">{result.mtfSummary.triggerTimeframe ?? "—"}</span>
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
              <h4 className="text-xs font-mono font-semibold text-red-400">⛔ {tx("analysisResult.noTradeRejected")}</h4>
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

      {/* Phase 11 — decision explainability: rendered FROM the engine trace.
          Pure presentation — no decision logic lives in the UI. */}
      {result.decisionTrace && (
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> {t.analysisResult.sections.whyThisDecision}{" "}
              </h4>
              <Badge variant="outline" className="text-[10px] font-mono ml-auto border-border/50">
                fp:{result.decisionFingerprint}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* WHY — structural thesis */}
            <div className="text-[11px] font-mono leading-relaxed text-muted-foreground">
              Structure:{" "}
              <span className="text-foreground">{result.decisionTrace.structuralDirection}</span>
              {result.decisionTrace.biasCalculation.vetoApplied && (
                <span className="text-amber-400"> · vetoed to Neutral ({result.decisionTrace.biasCalculation.vetoReason})</span>
              )}
              {result.decisionTrace.biasCalculation.vetoApplied === false &&
                result.decisionTrace.structuralDirection !== "none" && (
                  <span className="text-emerald-400/80"> · {t.analysisResult.fields.structuralAgreement}</span>
                )}
            </div>

            {/* CONVICTION breakdown — actual engine contributions */}
            {result.decisionTrace.convictionBreakdown.layers.length > 0 && (
              <div className="space-y-1">
                {result.decisionTrace.convictionBreakdown.layers
                  .filter((l) => l.contribution !== 0)
                  .map((l) => (
                    <div key={l.layer} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={cn("w-4 text-right tabular-nums", l.contribution > 0 ? "text-emerald-400" : "text-red-400")}>
                        {l.contribution > 0 ? `+${l.contribution}` : l.contribution}
                      </span>
                      <span className="text-muted-foreground w-36 truncate">{l.layer}</span>
                      <span className="text-muted-foreground/50 truncate flex-1">{l.reason}</span>
                    </div>
                  ))}
                <div className="pt-1 text-[10px] font-mono text-muted-foreground">
                  conviction {result.decisionTrace.convictionBreakdown.final} · {result.decisionTrace.convictionBreakdown.band ?? "informational"}{" "}
                  <span className="text-muted-foreground/50">{tx("analysisResult.evidenceNotProbability")}</span>
                </div>
              </div>
            )}

            {/* BLOCKERS — blocking gate for NO_TRADE */}
            {result.decisionTrace.failedGates.length > 0 && (
              <div className="text-[10px] font-mono text-red-400/90">
                blocking gate: {result.decisionTrace.failedGates.join(", ")}
              </div>
            )}

            {/* CONTEXT UNAVAILABLE — informational, never a directional signal */}
            {result.decisionTrace.informationalFlags.length > 0 && (
              <div className="rounded-lg bg-muted/20 border border-border/50 px-3 py-2">
                {result.decisionTrace.informationalFlags.map((f, i) => (
                  <p key={i} className="text-[10px] font-mono text-muted-foreground/80">
                    ⓘ {f} — decision not penalized
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Phase 26 — Structured Analyst Thesis: decision snapshot + evidence context */}
      {result.analystThesis && (() => {
        const thesis = result.analystThesis;
        return (
          <>
            {/* Decision Snapshot */}
            <Card className="border-border/50">
              <CardContent className="px-4 py-3">
                <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.decisionSnapshot}
                </p>
                <p className="text-sm font-mono font-bold text-foreground leading-relaxed">
                  {thesis.decisionSnapshot}
                </p>
                <p className="text-[11px] font-mono text-muted-foreground/80 mt-1">
                  {thesis.structuralThesis}
                </p>
              </CardContent>
            </Card>

            {/* Supporting + Conflicting Evidence */}
            {(thesis.supportingEvidence.length > 0 || thesis.conflictingEvidence.length > 0) && (
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                      <span className="text-primary/60">$</span> {t.analysisResult.sections.evidenceContext}
                    </h4>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {thesis.supportingEvidence.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono font-semibold text-emerald-400 mb-1">{t.analysisResult.fields.supporting}</p>
                      {thesis.supportingEvidence.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-1">
                          <span className="text-emerald-400 shrink-0">+</span>
                          <span className="text-muted-foreground w-28 shrink-0">{e.category}</span>
                          <span className="text-muted-foreground/80 flex-1">{e.explanation}</span>
                          {e.contribution !== undefined && (
                            <span className="text-emerald-400/60 shrink-0 tabular-nums">
                              {e.contribution > 0 ? "+" : ""}{e.contribution}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {thesis.conflictingEvidence.length > 0 && (
                    <div className="border-t border-border/30 pt-2">
                      <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">{t.analysisResult.fields.conflicting}</p>
                      {thesis.conflictingEvidence.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-1">
                          <span className="text-amber-400 shrink-0">−</span>
                          <span className="text-muted-foreground w-28 shrink-0">{e.category}</span>
                          <span className="text-muted-foreground/80 flex-1">{e.explanation}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[9px] font-mono text-muted-foreground/40 italic">
                    {t.analysisResult.labels.evidenceHierarchy}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Confirmation + Invalidation */}
            <Card className="border-border/50">
              <CardContent className="px-4 py-3 space-y-2">
                <p className="text-[10px] font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.thesisValidity}
                </p>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-wider mb-0.5">{t.analysisResult.fields.confirmation}</p>
                  <p className="text-[11px] font-mono text-muted-foreground/80 leading-relaxed">{thesis.confirmationCondition}</p>
                </div>
                <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-0.5">{t.analysisResult.fields.invalidationLabel}</p>
                  <p className="text-[11px] font-mono text-muted-foreground/80 leading-relaxed">{thesis.invalidationCondition}</p>
                </div>
              </CardContent>
            </Card>

            {/* Missing Information */}
            {thesis.missingInformation.length > 0 && (
              <Card className="border-amber-500/20 bg-amber-500/5">
                <CardContent className="px-4 py-3">
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">
                    <span className="text-amber-400/60">$</span> {t.analysisResult.fields.missingContext}
                  </p>
                  <ul className="space-y-0.5">
                    {thesis.missingInformation.map((m, i) => (
                      <li key={i} className="text-[10px] font-mono text-amber-300/70">
                        ⚠ {m}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* NO_TRADE Path */}
            {result.recommendation === "NO_TRADE" && thesis.noTradePath && (
              <Card className="border-border/50">
                <CardContent className="px-4 py-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                    <span className="text-primary/60">$</span> {t.analysisResult.sections.whatWouldChange}
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground/80 leading-relaxed">
                    {thesis.noTradePath}
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        );
      })()}
      {/* Phase 27 — Continuation vs Reversal Scenario */}
      {result.marketScenario && (() => {
        const sc = result.marketScenario;
        const SCENARIO_COLORS: Record<string, string> = {
          CONFIRMED_CONTINUATION: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          CONTINUATION_DEVELOPING: "bg-sky-500/15 text-sky-400 border-sky-500/30",
          PULLBACK_OR_CONSOLIDATION: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          REVERSAL_DEVELOPING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          REVERSAL_CONFIRMED: "bg-red-500/15 text-red-400 border-red-500/30",
          UNCONFIRMED: "bg-muted/30 text-muted-foreground border-border/50",
          WAIT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        };
        const RISK_COLORS: Record<string, string> = {
          low: "text-emerald-400",
          moderate: "text-amber-400",
          elevated: "text-red-400",
          high: "text-red-400",
        };
        return (
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.continuationVsReversal}
                </h4>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Current Structure + Scenario */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  structure: {sc.currentDirection}
                </Badge>
                <Badge className={cn("text-[10px] font-mono", SCENARIO_COLORS[sc.scenario])}>
                  {sc.scenario.replace(/_/g, " ")}
                </Badge>
              </div>

              {/* Status Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.labels.continuation}:</span>{" "}
                  <span className={sc.continuationStatus === "confirmed" ? "text-emerald-400" : sc.continuationStatus === "developing" ? "text-amber-400" : "text-muted-foreground"}>
                    {sc.continuationStatus}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.labels.reversalLabel}:</span>{" "}
                  <span className={sc.reversalStatus === "confirmed" ? "text-red-400" : sc.reversalStatus === "developing" ? "text-amber-400" : "text-muted-foreground"}>
                    {sc.reversalStatus}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.fields.confirmation}:</span>{" "}
                  <span className={sc.confirmationState === "confirmed" ? "text-emerald-400" : sc.confirmationState === "developing" ? "text-amber-400" : "text-muted-foreground"}>
                    {sc.confirmationState}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.structuralRisk}</span>{" "}
                  <span className={RISK_COLORS[sc.structuralRisk]}>{sc.structuralRisk}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.extensionRisk}</span>{" "}
                  <span className={RISK_COLORS[sc.extensionRisk]}>{sc.extensionRisk}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.liquidityRisk}</span>{" "}
                  <span className={RISK_COLORS[sc.liquidityRisk]}>{sc.liquidityRisk}</span>
                </div>
              </div>

              {/* Primary + Alternate */}
              <div className="space-y-1.5">
                <div className="rounded-lg bg-muted/20 border border-border/50 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{t.analysisResult.labels.primary}</p>
                  <p className="text-[11px] font-mono text-foreground/80 leading-relaxed">{sc.primaryScenario}</p>
                </div>
                <div className="rounded-lg bg-muted/10 border border-border/30 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-muted-foreground/60 uppercase tracking-wider mb-0.5">{t.analysisResult.labels.alternate}</p>
                  <p className="text-[11px] font-mono text-muted-foreground/70 leading-relaxed">{sc.alternateScenario}</p>
                </div>
              </div>

              {/* WAIT reason */}
              {sc.waitReason && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-amber-400 uppercase tracking-wider mb-0.5">{t.analysisResult.whyWait}</p>
                  <p className="text-[11px] font-mono text-amber-300/80 leading-relaxed">{sc.waitReason}</p>
                </div>
              )}

              {/* Continuation Evidence */}
              {sc.continuationEvidence.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono font-semibold text-emerald-400 mb-1">{t.analysisResult.continuationEvidence}</p>
                  {sc.continuationEvidence.slice(0, 4).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-0.5">
                      <span className="text-emerald-400 shrink-0">+</span>
                      <span className="text-muted-foreground/80">{e.explanation}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Reversal Evidence */}
              {sc.reversalEvidence.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">{t.analysisResult.reversalRisk}</p>
                  {sc.reversalEvidence.slice(0, 4).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-0.5">
                      <span className="text-amber-400 shrink-0">−</span>
                      <span className="text-muted-foreground/80">{e.explanation}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Confirmation Conditions */}
              {sc.confirmationConditions.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">{t.analysisResult.whatConfirms}</p>
                  {sc.confirmationConditions.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-0.5">
                      <span className="text-muted-foreground/40 shrink-0">→</span>
                      <span className="text-muted-foreground/80">{c}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Invalidation */}
              {sc.invalidationConditions.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-red-400/80 mb-1">{t.analysisResult.whatInvalidates}</p>
                  {sc.invalidationConditions.map((inv, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] font-mono mb-0.5">
                      <span className="text-red-400/60 shrink-0">✕</span>
                      <span className="text-muted-foreground/80">{inv}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[9px] font-mono text-muted-foreground/40 italic">
                {t.analysisResult.labels.scenarioDisclaimer}
              </p>
            </CardContent>
          </Card>
        );
      })()}

            {/* Phase 28 — Professional Market Regime & Fundamental Thesis */}
      {result.professionalThesis && (() => {
        const pt = result.professionalThesis;
        const regime = pt.marketRegime;
        const ft = pt.fundamentalThesis;
        const ACTION_COLORS: Record<string, string> = {
          LONG: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          SHORT: "bg-red-500/20 text-red-400 border-red-500/30",
          WAIT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
          NO_TRADE: "bg-muted text-muted-foreground border-border/50",
        };
        const PHASE_COLORS: Record<string, string> = {
          EARLY_TREND: "text-emerald-400",
          TREND_MATURE: "text-emerald-300",
          LATE_TREND: "text-amber-400",
          CORRECTION: "text-amber-500",
          RANGE_BALANCE: "text-muted-foreground",
          BREAKOUT_ATTEMPT: "text-blue-400",
          BREAKDOWN_ATTEMPT: "text-red-400",
          REVERSAL_ATTEMPT: "text-red-500",
          UNKNOWN: "text-muted-foreground",
        };
        const QUALITY_COLORS: Record<string, string> = {
          STRONG: "text-emerald-400",
          HEALTHY: "text-emerald-300",
          DEVELOPING: "text-amber-400",
          WEAK: "text-amber-500",
          EXHAUSTED: "text-red-400",
          INVALIDATED: "text-red-500",
          UNKNOWN: "text-muted-foreground",
        };
        return (
          <Card className={cn("border", biasConfig.border)}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.professionalMarketReading}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", ACTION_COLORS[pt.actionability])}>
                  {pt.actionability}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  regime: {regime.regime.replace(/_/g, " ").toLowerCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono border-border/50", PHASE_COLORS[regime.marketPhase])}>
                  phase: {regime.marketPhase.replace(/_/g, " ").toLowerCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono border-border/50", QUALITY_COLORS[regime.continuationQuality])}>
                  continuation: {regime.continuationQuality.toLowerCase()}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.inline.directionLabel}:</span>{" "}
                  <span>{regime.currentDirection}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.labels.transition}:</span>{" "}
                  <span>{regime.trendTransition.transitionType.replace(/_/g, " ").toLowerCase()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.inline.fundamentalLabel}:</span>{" "}
                  <span>{ft.alignment.replace(/_/g, " ").toLowerCase()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.eventRisk}</span>{" "}
                  <span>{ft.eventRisk.toLowerCase()}</span>
                </div>
              </div>
              <div className="text-[10px] font-mono space-y-1">
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.inline.primaryLabel}:</span>{" "}
                  <span>{pt.primaryScenario}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.inline.alternateLabel}:</span>{" "}
                  <span className="text-muted-foreground">{pt.alternateScenario}</span>
                </div>
              </div>
              {regime.exhaustionSignals.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.exhaustion}:</span>{" "}
                  {regime.exhaustionSignals.map((s, i) => (
                    <span key={i} className={cn("mr-2", s.severity === "strong" ? "text-red-400" : s.severity === "moderate" ? "text-amber-400" : "text-muted-foreground")}>
                      {s.signal} ({s.severity})
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[10px] font-mono text-muted-foreground">
                <span>why: </span>
                <span>{pt.actionabilityReason}</span>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                {pt.analystSummary}
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Phase 29 — Forward Market Path */}
      {result.forwardMarketPath && (() => {
        const fp = result.forwardMarketPath;
        const PATH_COLORS: Record<string, string> = {
          CONTINUATION_FAVORED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          CONTINUATION_POSSIBLE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
          CORRECTION_FAVORED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
          REVERSAL_ATTEMPT: "bg-red-500/20 text-red-400 border-red-500/30",
          REVERSAL_FAVORED: "bg-red-500/30 text-red-300 border-red-500/40",
          RANGE_CONTINUATION: "bg-muted text-muted-foreground border-border/50",
          BREAKOUT_ATTEMPT: "bg-blue-500/20 text-blue-400 border-blue-500/30",
          BREAKOUT_CONFIRMED: "bg-blue-500/30 text-blue-300 border-blue-500/40",
          BREAKOUT_FAILURE: "bg-red-500/10 text-red-400 border-red-500/20",
          UNCONFIRMED: "bg-muted text-muted-foreground border-border/50",
        };
        const CONF_COLORS: Record<string, string> = { high: "text-emerald-400", moderate: "text-amber-400", low: "text-red-400", insufficient_data: "text-muted-foreground" };
        return (
          <Card className={cn("border", biasConfig.border)}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.forwardMarketPath}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", PATH_COLORS[fp.primaryPath])}>
                  {fp.primaryPath.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  {fp.horizon.replace(/_/g, " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Current State */}
              <p className="text-[10px] font-mono text-muted-foreground/80">{fp.currentState}</p>

              {/* Primary + Alternate + Path Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div><span className="text-muted-foreground">{t.analysisResult.inline.primaryLabel}:</span> <span>{fp.pathStatus}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.inline.alternateLabel}:</span> <span className="text-muted-foreground">{fp.alternatePath.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.fields.structuralConfidence}</span> <span className={CONF_COLORS[fp.structuralConfidence]}>{fp.structuralConfidence.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.fields.dataReliability}</span> <span>{fp.dataReliability}</span></div>
              </div>

              {/* Confirmation + Invalidation */}
              {fp.confirmationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.confirmLabel}:</span>{" "}
                  {fp.confirmationConditions.map((c, i) => <span key={i} className="block text-emerald-400/80">• {c}</span>)}
                </div>
              )}
              {fp.invalidationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.labels.invalidateLabel}:</span>{" "}
                  {fp.invalidationConditions.map((c, i) => <span key={i} className="block text-red-400/80">• {c}</span>)}
                </div>
              )}

              {/* Path Risks */}
              {fp.pathRisks.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.labels.risksLabel}:</span>{" "}
                  {fp.pathRisks.map((r, i) => <span key={i} className="block text-amber-400/80">• {r}</span>)}
                </div>
              )}

              {/* Trigger Levels */}
              {fp.triggerLevels.length > 0 && (
                <div className="text-[10px] font-mono flex flex-wrap gap-2">
                  {fp.triggerLevels.map((t, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] font-mono border-border/50">
                      {t.type}: {t.level}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Scenario Tree */}
              {fp.scenarioTree.length > 0 && (
                <div className="text-[10px] font-mono space-y-1">
                  {fp.scenarioTree.map((node, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-primary/80 shrink-0">{node.label}:</span>
                      <span className="text-muted-foreground">{node.condition} → {node.outcome}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Next Best Action */}
              <div className="text-[10px] font-mono">
                <span className="text-muted-foreground">{t.analysisResult.labels.nextLabel}:</span> <span className="text-primary/80">{fp.nextBestAction}</span>
              </div>

              {/* Trader + Investor View */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">{t.analysisResult.labels.traderLabel}:</span> <span>{fp.traderView}</span>
                </div>
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">{t.analysisResult.labels.investorLabel}:</span> <span>{fp.investorView}</span>
                </div>
              </div>

              {/* Rationale */}
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">{fp.rationale}</p>
            </CardContent>
          </Card>
        );
      })()}

{/* Long-Horizon Thesis */}
      {result.longHorizonThesis && (() => {
        const lh = result.longHorizonThesis!;
        const CYCLE_COLORS: Record<string, string> = {
          TREND_EXPANSION: "text-emerald-400 border-emerald-500/30",
          EARLY_EXPANSION: "text-emerald-300 border-emerald-500/20",
          MATURE_TREND: "text-amber-400 border-amber-500/30",
          LATE_TREND: "text-red-400 border-red-500/30",
          DISTRIBUTION_CONTEXT: "text-red-400 border-red-500/30",
          CORRECTION: "text-amber-300 border-amber-500/20",
          RANGE: "text-muted-foreground border-border/50",
          TRANSITION: "text-orange-400 border-orange-500/30",
          ACCUMULATION_CONTEXT: "text-blue-400 border-blue-500/20",
          UNCONFIRMED: "text-muted-foreground border-border/50",
        };
        const STATUS_COLORS: Record<string, string> = {
          STRONGLY_SUPPORTED: "text-emerald-400 border-emerald-500/30",
          SUPPORTED: "text-emerald-300 border-emerald-500/20",
          MIXED: "text-amber-400 border-amber-500/30",
          CONFLICTED: "text-red-400 border-red-500/30",
          VALUATION_UNAVAILABLE: "text-muted-foreground border-border/50",
          INSUFFICIENT_DATA: "text-orange-400 border-orange-500/20",
        };
        return (
          <Card className="border border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.longHorizonThesis}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", CYCLE_COLORS[lh.marketCycle] ?? "border-border/50")}>
                  {lh.marketCycle.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono", STATUS_COLORS[lh.thesisStatus] ?? "border-border/50")}>
                  {lh.thesisStatus.replace(/_/g, " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="text-[10px] font-mono space-y-1">
                <p className="text-muted-foreground/80">{lh.marketCycleContext}</p>
                <p className="text-muted-foreground/60">{lh.structuralSummary}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded border border-emerald-500/15 p-2">
                  <span className="text-emerald-400 font-semibold">{t.analysisResult.fields.primaryThesis}</span>
                  <p className="mt-1 text-muted-foreground/80 leading-relaxed">{lh.primaryThesis}</p>
                </div>
                <div className="rounded border border-red-500/15 p-2">
                  <span className="text-red-400 font-semibold">{t.analysisResult.fields.counterThesis}</span>
                  <p className="mt-1 text-muted-foreground/80 leading-relaxed">{lh.counterThesis}</p>
                </div>
              </div>

              {lh.supportingEvidence.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.supportingLabel}:</span>
                  {lh.supportingEvidence.map((e, i) => (
                    <span key={i} className="block text-emerald-400/80">• [{e.source}] {e.explanation}</span>
                  ))}
                </div>
              )}
              {lh.conflictingEvidence.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.conflictingLabel}:</span>
                  {lh.conflictingEvidence.map((e, i) => (
                    <span key={i} className="block text-red-400/80">• [{e.source}] {e.explanation}</span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div><span className="text-muted-foreground">{t.analysisResult.fields.primaryScenario}</span> <span>{lh.primaryScenario}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.fields.alternateScenario}</span> <span className="text-muted-foreground">{lh.alternateScenario}</span></div>
              </div>

              {lh.confirmationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.confirmLabel}:</span>
                  {lh.confirmationConditions.map((c, i) => <span key={i} className="block text-emerald-400/80">• {c}</span>)}
                </div>
              )}
              {lh.invalidationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.labels.invalidateLabel}:</span>
                  {lh.invalidationConditions.map((c, i) => <span key={i} className="block text-red-400/80">• {c}</span>)}
                </div>
              )}

              {lh.thesisRisks.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.labels.risksLabel}:</span>
                  {lh.thesisRisks.map((r, i) => <span key={i} className="block text-amber-400/80">• {r}</span>)}
                </div>
              )}
              {lh.missingInformation.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.inline.missingLabel}:</span>
                  {lh.missingInformation.map((m, i) => <span key={i} className="block text-orange-300/60">• {m}</span>)}
                </div>
              )}

              <div className="text-[10px] font-mono space-y-1">
                <div><span className="text-muted-foreground">{t.analysisResult.inline.fundamentalLabel}:</span> <span>{lh.fundamentalContext}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.inline.macroLabel}:</span> <span className="text-muted-foreground/80">{lh.macroContext}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.labels.valuation}:</span> <span className="text-muted-foreground/80">{lh.valuationContext}</span></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">{t.analysisResult.labels.investorLabel}:</span> <span>{lh.investorImplication}</span>
                </div>
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">{t.analysisResult.labels.traderLabel}:</span> <span>{lh.traderImplication}</span>
                </div>
              </div>

              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">{lh.rationale}</p>
            </CardContent>
          </Card>
        );
      })()}

{/* Evidence & Thesis Challenge — informational audit */}
      {result.evidenceChallenge && (() => {
        const ec = result.evidenceChallenge!;
        const FRAGILITY_COLORS: Record<string, string> = {
          LOW: "text-emerald-400 border-emerald-500/30",
          MODERATE: "text-amber-400 border-amber-500/30",
          ELEVATED: "text-orange-400 border-orange-500/30",
          HIGH: "text-red-400 border-red-500/30",
          UNKNOWN: "text-muted-foreground border-border/50",
        };
        const SUPPORT_COLORS: Record<string, string> = {
          WELL_SUPPORTED: "text-emerald-400 border-emerald-500/30",
          SUPPORTED: "text-emerald-300 border-emerald-500/20",
          MIXED_SUPPORT: "text-amber-400 border-amber-500/30",
          WEAK_SUPPORT: "text-orange-400 border-orange-500/30",
          INSUFFICIENT_SUPPORT: "text-red-400 border-red-500/30",
          CONFLICTED: "text-red-400 border-red-500/30",
          NO_ACTIVE_THESIS: "text-muted-foreground border-border/50",
        };
        return (
          <Card className="border border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.evidenceChallenge}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", SUPPORT_COLORS[ec.thesisSupportStatus] ?? "border-border/50")}>
                  {ec.thesisSupportStatus.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono", FRAGILITY_COLORS[ec.thesisFragility] ?? "border-border/50")}>
                  fragility: {ec.thesisFragility.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <p className="text-[10px] font-mono text-muted-foreground/80">{ec.thesisSupportExplanation}</p>

              {ec.strongestSupportingEvidence && (
                <div className="text-[10px] font-mono rounded border border-emerald-500/15 p-2">
                  <span className="text-emerald-400 font-semibold">{t.analysisResult.fields.strongestSupport}</span>
                  <span className="ml-1">[{ec.strongestSupportingEvidence.source}] {ec.strongestSupportingEvidence.explanation}</span>
                </div>
              )}
              {ec.strongestConflictingEvidence && (
                <div className="text-[10px] font-mono rounded border border-red-500/15 p-2">
                  <span className="text-red-400 font-semibold">{t.analysisResult.fields.strongestConflict}</span>
                  <span className="ml-1">[{ec.strongestConflictingEvidence.source}] {ec.strongestConflictingEvidence.explanation}</span>
                </div>
              )}

              <div className="text-[10px] font-mono rounded border border-border/30 p-2">
                <span className="text-muted-foreground">{t.analysisResult.fields.counterThesisTag}:</span>
                <span className="ml-1">{ec.counterThesis}</span>
              </div>

              {ec.doubleCountingWarnings.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-amber-400 font-semibold">{t.analysisResult.fields.doubleCountingWarnings}</span>
                  {ec.doubleCountingWarnings.map((w, i) => (
                    <span key={i} className="block text-amber-400/80">• {w.description}</span>
                  ))}
                </div>
              )}

              {ec.missingEvidence.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">{t.analysisResult.fields.missingEvidence}</span>
                  {ec.missingEvidence.map((m, i) => (
                    <span key={i} className="block text-orange-300/60">• {m}</span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-emerald-400">{t.analysisResult.fields.strengthens}:</span>
                  {ec.thesisStrengtheners.slice(0, 3).map((s, i) => <span key={i} className="block text-emerald-400/70">• {s}</span>)}
                </div>
                <div>
                  <span className="text-red-400">{t.analysisResult.fields.invalidatesTag}:</span>
                  {ec.thesisInvalidators.slice(0, 3).map((v, i) => <span key={i} className="block text-red-400/70">• {v}</span>)}
                </div>
              </div>

              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">{ec.auditSummary}</p>
            </CardContent>
          </Card>
        );
      })()}

{/* Trade Plan — market-derived levels only; NEVER rendered for NO_TRADE */}
      {result.tradePlan && result.recommendation !== "NO_TRADE" && (
        <Card className={cn("border", biasConfig.border)}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> {t.analysisResult.tradePlanHeading}
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
                  {t.protection.entryPriceLabel}
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.entry}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">{t.analysisResult.marketPriceNote}</p>
              </div>
              <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
                <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-1">
                  {t.protection.stopLossLabel}
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.stopLoss}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 break-words">{result.tradePlan.slBasis}</p>
              </div>
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
                <p className="text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-wider mb-1">
                  {t.protection.takeProfitLabel}
                </p>
                <p className="text-sm font-bold font-mono tabular-nums">{result.tradePlan.takeProfit}</p>
                <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 break-words">{result.tradePlan.tpBasis}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 3B/4 — Position sizing: shown ONLY when fully computable from
          real user inputs + complete instrument spec (+ live FX conversion
          when the account currency differs). Never fabricated. */}
      {result.recommendation !== "NO_TRADE" && result.positionSizing?.available && (
        <Card className="border-border/50">
          <CardContent className="px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.positionSizing}{" "}
              <span className="text-muted-foreground/50">{tx("analysisResult.fromYourInputs")}</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.fields.quantity}</p>
                <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                  {result.positionSizing.quantity}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground/60">{result.positionSizing.quantityUnit}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-mono text-muted-foreground">
                  risk amount{result.positionSizing.denominationCurrency ? ` (${result.positionSizing.denominationCurrency})` : ""}
                </p>
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
            {/* Phase 4 — currency & specification provenance transparency. */}
            {(result.positionSizing.conversion || result.positionSizing.specificationSource) && (
              <p className="mt-2 text-[9px] font-mono text-muted-foreground/70 border-t border-border/40 pt-2">
                {result.positionSizing.conversion && result.positionSizing.conversion.direction !== "same" && (
                  <>
                    FX: {result.positionSizing.conversion.from}→{result.positionSizing.conversion.to}{" "}
                    via {result.positionSizing.conversion.direction} rate{" "}
                    {result.positionSizing.conversion.rate.toFixed(5)} ({result.positionSizing.conversion.source}) ·{" "}
                  </>
                )}
                spec source: {result.positionSizing.specificationSource}
              </p>
            )}
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
                  $ {t.analysisResult.fields.warnings}
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
              <span className="text-primary/60">$</span> {t.analysisResult.sections.technical}
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
              <span className="text-primary/60">$</span> {t.analysisResult.sections.fundamental}
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
                <span className="text-primary/60">$</span> {t.analysisResult.sections.newsSentiment}
              </h4>
              <Badge
                className={cn(
                  "text-[10px] font-mono",
                  result.sentimentData.label === "bullish" ? "bg-emerald-500/15 text-emerald-400" :
                  result.sentimentData.label === "bearish" ? "bg-red-500/15 text-red-400" :
                  "bg-muted/30 text-muted-foreground"
                )}
              >
                {mapTrendLabel(result.sentimentData.label, t)}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {result.sentimentData.articleCount} articles
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-4 mb-3">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.avgScore}</p>
                <p className={cn(
                  "text-sm font-bold font-mono tabular-nums",
                  result.sentimentData.averageScore > 0 ? "text-emerald-400" : result.sentimentData.averageScore < 0 ? "text-red-400" : "text-foreground"
                )}>
                  {result.sentimentData.averageScore > 0 ? "+" : ""}{result.sentimentData.averageScore.toFixed(3)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.positive}</p>
                <p className="text-sm font-bold font-mono text-emerald-400 tabular-nums">{result.sentimentData.breakdown.positive}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.negative}</p>
                <p className="text-sm font-bold font-mono text-red-400 tabular-nums">{result.sentimentData.breakdown.negative}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.neutral}</p>
                <p className="text-sm font-bold font-mono text-muted-foreground tabular-nums">{result.sentimentData.breakdown.neutral}</p>
              </div>
            </div>
            {result.sentimentData.articles.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono font-medium text-muted-foreground">{t.analysisResult.labels.topHeadlines}</p>
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
                <span className="text-primary/60">$</span> {t.analysisResult.sections.macroContext}
              </h4>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {mapConfidence(result.macroData.confidence, t)}
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
                <span className="text-primary/60">$</span> {t.analysisResult.sections.fundamentals}
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
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.marginLabel}</p>
                  <p className="text-sm font-bold font-mono tabular-nums">{(result.fundamentalData.profitMargin * 100).toFixed(1)}%</p>
                </div>
              )}
              {result.fundamentalData.marketCap !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.mktCapShort}</p>
                  <p className="text-sm font-bold font-mono tabular-nums">${(result.fundamentalData.marketCap / 1e9).toFixed(1)}B</p>
                </div>
              )}
              {result.fundamentalData.dividendYield !== undefined && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.divYield}</p>
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

      {/* Phase 276 — Deterministic fundamental assessment.
          Rendered from the SAME result object the engine produced. It shows
          only metrics the provider actually supplied, preserves the
          reporting period and observation instants, and never presents
          reported statements as live market data. */}
      {result.fundamentalAssessment &&
        (result.fundamentalAssessment.available || result.instrumentType === "stock") && (
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span>{" "}
                  {t.analysisResult.fundamentalAssessment.title}
                </h4>
                {result.fundamentalAssessment.available && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono",
                      FA_STATE_STYLE[result.fundamentalAssessment.state],
                    )}
                  >
                    {tx(FA_STATE_LABEL_KEYS[result.fundamentalAssessment.state])}
                  </Badge>
                )}
                {result.fundamentalAssessment.available && (
                  <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                    {t.analysisResult.fundamentalAssessment.confidenceLabel}:{" "}
                    {result.fundamentalAssessment.confidence}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {!result.fundamentalAssessment.available ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                    {t.analysisResult.fundamentalAssessment.unavailableBody}
                  </p>
                  {result.fundamentalAssessment.limitations.map((limitation, i) => (
                    <p key={i} className="text-[10px] font-mono text-muted-foreground/80">
                      {limitation}
                    </p>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
                    <span>
                      {t.analysisResult.fundamentalAssessment.providerLabel}:{" "}
                      {result.fundamentalAssessment.provider}
                      {result.fundamentalAssessment.instrumentId
                        ? ` · ${result.fundamentalAssessment.instrumentId}`
                        : ""}
                    </span>
                    {result.fundamentalAssessment.reportingPeriod && (
                      <span>
                        {t.analysisResult.fundamentalAssessment.reportingPeriodLabel}:{" "}
                        {result.fundamentalAssessment.reportingPeriod}
                      </span>
                    )}
                    {result.fundamentalAssessment.observedAt > 0 && (
                      <span>
                        {t.analysisResult.fundamentalAssessment.observedLabel}:{" "}
                        {new Date(result.fundamentalAssessment.observedAt).toISOString()}
                      </span>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground mb-1">
                      {t.analysisResult.fundamentalAssessment.dimensionsLabel}
                    </p>
                    <ul className="space-y-1">
                      {result.fundamentalAssessment.dimensions
                        .filter((d) => d.status !== "unavailable" && d.evidence)
                        .map((d) => (
                          <li key={d.name} className="flex items-start gap-2">
                            <span
                              className={cn(
                                "mt-1.5 size-1.5 rounded-full shrink-0",
                                FA_DIM_DOT[d.status],
                              )}
                            />
                            <span className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                              {d.evidence}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>

                  <p className="text-[10px] font-mono text-muted-foreground/80">
                    {result.fundamentalAssessment.confidenceEvidence}
                  </p>

                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground mb-1">
                      {t.analysisResult.fundamentalAssessment.limitationsLabel}
                    </p>
                    <ul className="space-y-0.5">
                      {result.fundamentalAssessment.limitations.map((limitation, i) => (
                        <li
                          key={i}
                          className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed"
                        >
                          {limitation}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

      {/* Phase 278 — Advanced modern technical intelligence.
          Everything below is read VERBATIM from the engine's own
          `technicalData.advanced` object: no VWAP, volume profile, relative
          volume, volatility measure or microstructure metric is recalculated
          in React. Evidence the configured feeds do not supply is rendered as
          an explicit "not supplied" entry, never as a zero and never as a
          value derived from unrelated data. */}
      {result.technicalData?.advanced && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span>{" "}
                {t.analysisResult.advancedTechnical.title}
              </h4>
              {result.technicalData.advanced.provenance.timeframe && (
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  {result.technicalData.advanced.provenance.timeframe}
                </Badge>
              )}
              {result.technicalData.advanced.provenance.provider && (
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  {result.technicalData.advanced.provenance.provider}
                  {result.technicalData.advanced.provenance.providerInstrumentId
                    ? ` · ${result.technicalData.advanced.provenance.providerInstrumentId}`
                    : ""}
                </Badge>
              )}
              {result.technicalData.advanced.provenance.observedAt !== undefined && (
                <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                  {t.analysisResult.advancedTechnical.observedAtLabel}:{" "}
                  {new Date(result.technicalData.advanced.provenance.observedAt).toISOString()}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {result.technicalData.advanced.provenance.dataPoints} {t.analysisResult.candlesCount}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {(() => {
              const adv = result.technicalData!.advanced!;
              const fmt = (v: number | undefined, digits = 2) =>
                v === undefined ? t.analysisResult.advancedTechnical.unavailableLabel : v.toFixed(digits);
              return (
                <>
                  {/* ── Location / auction ── */}
                  <div data-testid="advanced-location">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.locationTitle}
                    </p>
                    {adv.location.available ? (
                      <ul className="space-y-0.5">
                        {adv.location.sessionVwap !== undefined && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.sessionVwapLabel}: {fmt(adv.location.sessionVwap)}
                            {adv.location.sessionCandles !== undefined
                              ? ` · ${adv.location.sessionCandles} ${t.analysisResult.advancedTechnical.barsLabel}`
                              : ""}
                          </li>
                        )}
                        {adv.location.bands && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.bandsLabel}: {fmt(adv.location.bands.minus1)} /{" "}
                            {fmt(adv.location.bands.plus1)} · {fmt(adv.location.bands.minus2)} / {fmt(adv.location.bands.plus2)}
                          </li>
                        )}
                        {adv.location.anchoredVwaps.map((a) => (
                          <li key={`${a.anchor}-${a.anchorAt}`} className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.anchoredVwapLabel} ({a.anchor}): {fmt(a.value)}
                            {" · "}
                            {new Date(a.anchorAt).toISOString()}
                            {` · ${a.candles} ${t.analysisResult.advancedTechnical.barsLabel}`}
                          </li>
                        ))}
                        {adv.location.anchorUnavailable.map((a) => (
                          <li key={a.anchor} className="text-[10px] font-mono text-muted-foreground/50">
                            {t.analysisResult.advancedTechnical.anchoredVwapLabel} ({a.anchor}):{" "}
                            {t.analysisResult.advancedTechnical.unavailableLabel} — {a.reason}
                          </li>
                        ))}
                        {adv.location.distances.map((d) => (
                          <li key={`${d.anchor}-${d.anchorAt ?? 0}`} className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.distanceLabel} ({d.anchor}): {fmt(d.absolute)}{" "}
                            ({fmt(d.percent)}%{d.atrMultiple !== undefined ? ` · ${fmt(d.atrMultiple)} ATR` : ""})
                          </li>
                        ))}
                        {(["day", "week", "month"] as const).map((period) => {
                          const range = adv.location.previousPeriods[period];
                          if (!range) return null;
                          return (
                            <li key={period} className="text-[10px] font-mono text-muted-foreground/80">
                              {t.analysisResult.advancedTechnical.previousPeriodLabel} ({period}): {fmt(range.high)} /{" "}
                              {fmt(range.low)} · {range.candles} {t.analysisResult.advancedTechnical.barsLabel}
                            </li>
                          );
                        })}
                        {adv.location.previousPeriods.unavailable.map((u) => (
                          <li key={u.period} className="text-[10px] font-mono text-muted-foreground/50">
                            {t.analysisResult.advancedTechnical.previousPeriodLabel} ({u.period}):{" "}
                            {t.analysisResult.advancedTechnical.unavailableLabel} — {u.reason}
                          </li>
                        ))}
                        {adv.location.openingRange && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.openingRangeLabel}: {fmt(adv.location.openingRange.high)} /{" "}
                            {fmt(adv.location.openingRange.low)}
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.location.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Volume structure ── */}
                  <div data-testid="advanced-volume">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.volumeTitle}
                    </p>
                    {adv.volumeStructure.available ? (
                      <ul className="space-y-0.5">
                        {adv.volumeStructure.profile && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.pocLabel}: {fmt(adv.volumeStructure.profile.poc)} ·{" "}
                            {t.analysisResult.advancedTechnical.vahLabel}: {fmt(adv.volumeStructure.profile.vah)} ·{" "}
                            {t.analysisResult.advancedTechnical.valLabel}: {fmt(adv.volumeStructure.profile.val)}
                            {` · ${adv.volumeStructure.profile.bins.length} bins`}
                          </li>
                        )}
                        {adv.volumeStructure.profile && adv.volumeStructure.profile.hvn.length > 0 && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.hvnLabel}:{" "}
                            {adv.volumeStructure.profile.hvn.map((v) => v.toFixed(2)).join(", ")}
                          </li>
                        )}
                        {adv.volumeStructure.profile && adv.volumeStructure.profile.lvn.length > 0 && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.lvnLabel}:{" "}
                            {adv.volumeStructure.profile.lvn.map((v) => v.toFixed(2)).join(", ")}
                          </li>
                        )}
                        {adv.volumeStructure.relativeVolume && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.relativeVolumeLabel}:{" "}
                            {fmt(adv.volumeStructure.relativeVolume.value)}× ({adv.volumeStructure.relativeVolume.state})
                            {` · ${adv.volumeStructure.relativeVolume.lookback} ${t.analysisResult.advancedTechnical.barsLabel}`}
                          </li>
                        )}
                        {adv.volumeStructure.expansion && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.participationLabel}: {adv.volumeStructure.expansion.state}{" "}
                            ({fmt(adv.volumeStructure.expansion.ratio)}×)
                          </li>
                        )}
                        {adv.volumeStructure.confirmation && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.priceVolumeLabel}:{" "}
                            {adv.volumeStructure.confirmation.state} ({fmt(adv.volumeStructure.confirmation.priceChangePercent)}%{" "}
                            price, {fmt(adv.volumeStructure.confirmation.volumeChangePercent)}% volume)
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.volumeStructure.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Liquidity / structure events ── */}
                  <div data-testid="advanced-liquidity">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.liquidityTitle}
                    </p>
                    <ul className="space-y-0.5">
                      {adv.liquidityStructure.lastSweep && (
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.sweepLabel}: {adv.liquidityStructure.lastSweep.side} @{" "}
                          {fmt(adv.liquidityStructure.lastSweep.level)}
                        </li>
                      )}
                      {adv.liquidityStructure.levelInteractions.slice(0, 4).map((li) => (
                        <li key={`${li.levelSource}-${li.breakTime}`} className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.levelInteractionLabel}: {li.state} @ {fmt(li.level)} ({li.levelSource})
                        </li>
                      ))}
                      {adv.liquidityStructure.displacement && (
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.displacementLabel}:{" "}
                          {adv.liquidityStructure.displacement.direction} (range{" "}
                          {fmt(adv.liquidityStructure.displacement.rangeAtrMultiple)}× ATR)
                        </li>
                      )}
                      {adv.liquidityStructure.fvgs.length > 0 && (
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.fvgLabel}:{" "}
                          {adv.liquidityStructure.fvgs
                            .slice(0, 3)
                            .map((f) => `${f.direction} ${f.lower.toFixed(2)}–${f.upper.toFixed(2)} (${f.status})`)
                            .join(", ")}
                        </li>
                      )}
                      {adv.liquidityStructure.zones.length > 0 && (
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.zonesLabel}:{" "}
                          {adv.liquidityStructure.zones
                            .slice(0, 3)
                            .map((z) => `${z.direction} ${z.lower.toFixed(2)}–${z.upper.toFixed(2)} (${z.status})`)
                            .join(", ")}
                        </li>
                      )}
                      {adv.liquidityStructure.sessionAuction?.available && adv.liquidityStructure.sessionAuction.location && (
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.sessionAuctionLabel}:{" "}
                          {adv.liquidityStructure.sessionAuction.location}
                        </li>
                      )}
                      {adv.liquidityStructure.sessionAuction && !adv.liquidityStructure.sessionAuction.available && (
                        <li className="text-[10px] font-mono text-muted-foreground/50">
                          {t.analysisResult.advancedTechnical.sessionAuctionLabel}:{" "}
                          {t.analysisResult.advancedTechnical.unavailableLabel} —{" "}
                          {adv.liquidityStructure.sessionAuction.unavailableReason}
                        </li>
                      )}
                    </ul>
                  </div>

                  {/* ── Volatility / statistical regime ── */}
                  <div data-testid="advanced-volatility">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.volatilityTitle}
                    </p>
                    {adv.volatility.available ? (
                      <ul className="space-y-0.5">
                        {adv.volatility.realizedVolPercentPerBar !== undefined && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.realizedVolLabel}:{" "}
                            {fmt(adv.volatility.realizedVolPercentPerBar, 4)}% per bar
                            {adv.volatility.realizedVolAnnualizedPercent !== undefined
                              ? ` · ${fmt(adv.volatility.realizedVolAnnualizedPercent)}% ${t.analysisResult.advancedTechnical.annualizedLabel}`
                              : ""}
                          </li>
                        )}
                        {adv.volatility.realizedVolPercentile !== undefined && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.percentileLabel}: RV {fmt(adv.volatility.realizedVolPercentile, 1)}
                            {adv.volatility.atrPercentile !== undefined ? ` · ATR ${fmt(adv.volatility.atrPercentile, 1)}` : ""}
                          </li>
                        )}
                        {adv.volatility.zScore !== undefined && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.zScoreLabel}: {fmt(adv.volatility.zScore, 3)}
                            {adv.volatility.stdevPercent !== undefined ? ` · σ ${fmt(adv.volatility.stdevPercent)}%` : ""}
                          </li>
                        )}
                        {adv.volatility.compression && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.compressionLabel}: {adv.volatility.compression.state}
                            {adv.volatility.compression.atrRatio !== undefined
                              ? ` (${fmt(adv.volatility.compression.atrRatio)}×)`
                              : ""}
                          </li>
                        )}
                        {adv.volatility.regime && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.regimeLabel}: {adv.volatility.regime.state}
                            {adv.volatility.regime.efficiencyRatio !== undefined
                              ? ` (ER ${fmt(adv.volatility.regime.efficiencyRatio, 3)})`
                              : ""}
                          </li>
                        )}
                        {adv.volatility.clustering && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.clusteringLabel}: {adv.volatility.clustering.state}
                            {adv.volatility.clustering.autocorrelation !== undefined
                              ? ` (ρ ${fmt(adv.volatility.clustering.autocorrelation, 3)})`
                              : ""}
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.volatility.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Cross-market ── */}
                  <div data-testid="advanced-crossmarket">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.crossMarketTitle}
                    </p>
                    {adv.crossMarket.available ? (
                      <ul className="space-y-0.5">
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.correlationLabel}: {fmt(adv.crossMarket.correlation, 3)} vs{" "}
                          {adv.crossMarket.comparatorSymbol} ({adv.crossMarket.sampleSize}{" "}
                          {t.analysisResult.advancedTechnical.barsLabel}, {adv.crossMarket.comparatorProvider})
                        </li>
                        {adv.crossMarket.relativeStrengthPercent !== undefined && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.relativeStrengthLabel}:{" "}
                            {fmt(adv.crossMarket.relativeStrengthPercent)}pp
                          </li>
                        )}
                        {adv.crossMarket.intermarketConfirmation && (
                          <li className="text-[10px] font-mono text-muted-foreground/80">
                            {t.analysisResult.advancedTechnical.intermarketLabel}: {adv.crossMarket.intermarketConfirmation}
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.crossMarket.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Order flow / microstructure ── */}
                  <div data-testid="advanced-orderflow">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.orderFlowTitle}
                    </p>
                    {adv.orderFlow.available ? (
                      <ul className="space-y-0.5">
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.bidAskLabel}: {fmt(adv.orderFlow.bid)} / {fmt(adv.orderFlow.ask)} ·{" "}
                          {t.analysisResult.advancedTechnical.spreadLabel}: {fmt(adv.orderFlow.spreadBps)} bps
                        </li>
                        <li className="text-[10px] font-mono text-muted-foreground/80">
                          {t.analysisResult.advancedTechnical.depthLabel}: {fmt(adv.orderFlow.bidVolume)} /{" "}
                          {fmt(adv.orderFlow.askVolume)} · {t.analysisResult.advancedTechnical.depthImbalanceLabel}:{" "}
                          {fmt(adv.orderFlow.depthImbalance, 4)}
                        </li>
                        <li className="text-[10px] font-mono text-muted-foreground/50">
                          {adv.orderFlow.provider}
                          {adv.orderFlow.instrumentId ? ` · ${adv.orderFlow.instrumentId}` : ""}
                          {adv.orderFlow.freshness ? ` · ${adv.orderFlow.freshness}` : ""}
                        </li>
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.orderFlow.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Derivatives context ── */}
                  <div data-testid="advanced-derivatives">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.derivativesTitle}
                    </p>
                    {adv.derivatives.available ? (
                      <ul className="space-y-0.5">
                        {adv.derivatives.entries.map((e) => (
                          <li key={e.metric} className="text-[10px] font-mono text-muted-foreground/80">
                            {e.metric}: {e.value} · {e.provider} · {e.instrument}
                            {e.freshness ? ` · ${e.freshness}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        {t.analysisResult.advancedTechnical.unavailableLabel} — {adv.derivatives.unavailableReason}
                      </p>
                    )}
                  </div>

                  {/* ── Metrics the configured feeds genuinely do not supply ── */}
                  {result.advancedTechnicalEvidence &&
                    result.advancedTechnicalEvidence.unavailableMetrics.length > 0 && (
                      <div data-testid="advanced-unavailable-metrics">
                        <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                          {t.analysisResult.advancedTechnical.unavailableMetricsLabel}
                        </p>
                        <ul className="space-y-0.5">
                          {result.advancedTechnicalEvidence.unavailableMetrics.map((m) => (
                            <li key={m.metric} className="text-[10px] font-mono text-muted-foreground/60">
                              {m.metric} — {m.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* ── Evidence hierarchy (momentum is explicitly secondary) ── */}
                  <div data-testid="advanced-hierarchy">
                    <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">
                      {t.analysisResult.advancedTechnical.hierarchyTitle}
                    </p>
                    <ul className="space-y-0.5">
                      {adv.evidenceHierarchy.map((tier) => (
                        <li key={tier.tier} className="text-[10px] font-mono text-muted-foreground/80">
                          {tier.tier}. {tier.name}: {tier.available ? tier.items.join(" · ") || "—" : t.analysisResult.advancedTechnical.unavailableLabel}
                          {tier.note ? ` · ${tier.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ── What the decision actually read from this evidence ── */}
                  {result.advancedTechnicalEvidence &&
                    (result.advancedTechnicalEvidence.confluence.length > 0 ||
                      result.advancedTechnicalEvidence.conflicts.length > 0) && (
                      <div data-testid="advanced-decision-evidence">
                        {result.advancedTechnicalEvidence.confluence.map((c, i) => (
                          <p key={`c${i}`} className="text-[10px] font-mono text-emerald-300/70">
                            ✓ {c}
                          </p>
                        ))}
                        {result.advancedTechnicalEvidence.conflicts.map((c, i) => (
                          <p key={`x${i}`} className="text-[10px] font-mono text-amber-300/70">
                            ⚠ {c}
                          </p>
                        ))}
                      </div>
                    )}

                  <p className="text-[9px] font-mono text-muted-foreground/50">
                    {t.analysisResult.advancedTechnical.parametersLabel}:{" "}
                    {Object.entries(adv.provenance.parameters)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                  </p>
                  <p className="text-[9px] font-mono text-muted-foreground/50">
                    {t.analysisResult.advancedTechnical.evidenceClassesLabel}:{" "}
                    {adv.provenance.evidenceClasses.join(", ")}
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Phase 276 — Unified Intelligence.
          Rendered from the SAME `unifiedIntelligence` object the engine derived:
          no indicator, ratio or confidence is recomputed here. Technical and
          fundamental evidence stay separate sections above; this card states
          whether they agree, whether a combined conclusion is even possible,
          and why. A combined directional conclusion is shown ONLY when the
          layer marked it actionable — never for single-class evidence. */}
      {result.unifiedIntelligence && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span>{" "}
                {t.analysisResult.unifiedIntelligence.title}
              </h4>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  UI_STATE_STYLE[result.unifiedIntelligence.state],
                )}
              >
                {tx(UI_STATE_LABEL_KEYS[result.unifiedIntelligence.state])}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-border/50">
                {t.analysisResult.unifiedIntelligence.confidenceLabel}:{" "}
                {result.unifiedIntelligence.confidence}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  result.unifiedIntelligence.actionable
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                    : "bg-muted/30 text-muted-foreground border-border/50",
                )}
              >
                {t.analysisResult.unifiedIntelligence.actionabilityLabel}:{" "}
                {result.unifiedIntelligence.actionable
                  ? t.analysisResult.unifiedIntelligence.actionable
                  : t.analysisResult.unifiedIntelligence.notActionable}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {t.analysisResult.unifiedIntelligence.technicalBiasLabel}
                </p>
                <p className="text-sm font-bold font-mono">
                  {result.unifiedIntelligence.technical.bias}
                  {result.unifiedIntelligence.technical.instrumentId
                    ? ` · ${result.unifiedIntelligence.technical.instrumentId}`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {t.analysisResult.unifiedIntelligence.fundamentalStateLabel}
                </p>
                <p className="text-sm font-bold font-mono">
                  {result.unifiedIntelligence.fundamental.state}
                  {result.unifiedIntelligence.fundamental.instrumentId
                    ? ` · ${result.unifiedIntelligence.fundamental.instrumentId}`
                    : ""}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.agreementLabel}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                {result.unifiedIntelligence.confluence.agreement} — {result.unifiedIntelligence.confluence.reason}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.actionabilityLabel}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                {result.unifiedIntelligence.actionabilityReason}
              </p>
            </div>

            {/* A combined directional conclusion is rendered ONLY when the
                unified layer marked this result actionable — i.e. both
                evidence classes are present, directional and aligned. */}
            {result.unifiedIntelligence.actionable &&
              result.unifiedIntelligence.directionalConclusion && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground mb-1">
                    {t.analysisResult.inline.directionLabel}
                  </p>
                  <p className="text-sm font-bold font-mono">
                    {result.unifiedIntelligence.directionalConclusion === "long"
                      ? t.analysis.long
                      : t.analysis.short}
                  </p>
                </div>
              )}

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.invalidationLabel}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                {result.unifiedIntelligence.technical.invalidation ??
                  t.analysisResult.unifiedIntelligence.notApplicable}
                {result.unifiedIntelligence.fundamental.reportingPeriod
                  ? ` · ${t.analysisResult.fundamentalAssessment.reportingPeriodLabel}: ${result.unifiedIntelligence.fundamental.reportingPeriod}`
                  : ""}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.provenanceLabel}
              </p>
              <ul className="space-y-0.5">
                {/* The instants are formatted HERE from the object's own
                    provenance fields — the engine keeps them machine-readable
                    and never re-dates the evidence. */}
                {result.unifiedIntelligence.technical.available && (
                  <li className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                    {result.unifiedIntelligence.technical.provider ?? "—"}
                    {result.unifiedIntelligence.technical.instrumentId
                      ? ` · ${result.unifiedIntelligence.technical.instrumentId}`
                      : ""}
                    {result.unifiedIntelligence.technical.observedAt !== undefined
                      ? ` · ${t.analysisResult.fundamentalAssessment.observedLabel}: ${new Date(
                          result.unifiedIntelligence.technical.observedAt,
                        ).toISOString()}`
                      : ""}
                    {result.unifiedIntelligence.technical.dataPoints !== undefined
                      ? ` · ${result.unifiedIntelligence.technical.dataPoints} ${t.analysisResult.candlesCount}`
                      : ""}
                  </li>
                )}
                {result.unifiedIntelligence.fundamental.present && (
                  <li className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed">
                    {result.unifiedIntelligence.fundamental.provider ?? "—"}
                    {result.unifiedIntelligence.fundamental.instrumentId
                      ? ` · ${result.unifiedIntelligence.fundamental.instrumentId}`
                      : ""}
                    {result.unifiedIntelligence.fundamental.reportingPeriod
                      ? ` · ${t.analysisResult.fundamentalAssessment.reportingPeriodLabel}: ${result.unifiedIntelligence.fundamental.reportingPeriod}`
                      : ""}
                    {result.unifiedIntelligence.fundamental.observedAt !== undefined
                      ? ` · ${t.analysisResult.fundamentalAssessment.observedLabel}: ${new Date(
                          result.unifiedIntelligence.fundamental.observedAt,
                        ).toISOString()}`
                      : ""}
                  </li>
                )}
                {result.unifiedIntelligence.limitations
                  .filter((l) => /^(Technical evidence:|Fundamental evidence:)/.test(l))
                  .map((limitation, i) => (
                    <li
                      key={i}
                      className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed"
                    >
                      {limitation}
                    </li>
                  ))}
              </ul>
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.explanationLabel}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                {result.unifiedIntelligence.explanation}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">
                {t.analysisResult.unifiedIntelligence.limitationsLabel}
              </p>
              <ul className="space-y-0.5">
                {result.unifiedIntelligence.limitations
                  .filter((l) => !/^(Technical evidence:|Fundamental evidence:)/.test(l))
                  .map((limitation, i) => (
                    <li
                      key={i}
                      className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed"
                    >
                      {limitation}
                    </li>
                  ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Score Breakdown */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.scoreBreakdown}
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

      {/* Phase 19 — Key Levels + S/R Zones (informational only, no decision logic) */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-muted-foreground">
              <span className="text-primary/60">$</span> {t.analysisResult.sections.keyLevels}
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-emerald-400 uppercase tracking-wider mb-1">
                {t.analysisResult.labels.support}
              </p>
              {/* Phase 239 — a producer may hand over a result without key
                  levels (an unreadable legacy row is dropped upstream, but a
                  partial live result must not crash the panel either). The
                  absent value renders as the existing "—" placeholder; no
                  level is ever invented. */}
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels?.support || "—"}</p>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-red-400 uppercase tracking-wider mb-1">
                {t.analysisResult.labels.resistance}
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels?.resistance || "—"}</p>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5">
              <p className="text-[10px] font-mono font-medium text-amber-400 uppercase tracking-wider mb-1">
                {t.analysisResult.fields.invalidationLabel}
              </p>
              <p className="text-sm font-bold font-mono tabular-nums">{result.keyLevels?.invalidation || "—"}</p>
            </div>
          </div>
          {/* Phase 19 — S/R Zones: liquidity pools, OBs, FVGs already present in typed data.
              Informational context only — these levels do NOT change direction, conviction,
              or decision. Structural hierarchy remains supreme. */}
          {(() => {
            const smc = result.technicalData?.smc;
            const pools = smc?.liquidityPools?.filter((p) => !p.swept && !p.broken) ?? [];
            const obs = smc?.orderBlocks?.filter((o) => o.status !== "invalidated") ?? [];
            const fvgs = smc?.fvgs?.filter((f) => f.status === "fresh") ?? [];
            const vwap = smc?.vwap?.available ? smc.vwap : undefined;
            const vp = smc?.volumeProfile?.available ? smc.volumeProfile : undefined;
            const tf = smc?.timeframe ?? result.timeframe;
            if (pools.length === 0 && obs.length === 0 && fvgs.length === 0 && !vwap && !vp) return null;
            return (
              <div className="border-t border-border/30 pt-3">
                <p className="text-[10px] font-mono text-muted-foreground/50 mb-2">
                  sr zones · {tf} · informational context — structural hierarchy is supreme
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pools.slice(0, 4).map((p, i) => (
                    <div key={`pool-${i}`} className={cn(
                      "rounded border px-2.5 py-1.5 text-[10px] font-mono",
                      p.side === "buy_side"
                        ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-400/80"
                        : "bg-red-500/5 border-red-500/15 text-red-400/80"
                    )}>
                      <span className="font-medium">{p.side === "buy_side" ? "buy-side" : "sell-side"}</span>
                      {' '}{formatPrice(p.level)}
                      <span className="text-muted-foreground/50"> · {p.source} · {p.touches} touch{p.touches > 1 ? "es" : ""}</span>
                    </div>
                  ))}
                  {obs.slice(0, 2).map((o, i) => (
                    <div key={`ob-${i}`} className="rounded border bg-violet-500/5 border-violet-500/15 px-2.5 py-1.5 text-[10px] font-mono text-violet-400/80">
                      <span className="font-medium">{t.analysisResult.labels.orderBlock}</span>
                      {' '}{o.direction} {formatPrice(o.lower)}–{formatPrice(o.upper)}
                      <span className="text-muted-foreground/50"> · {o.status}</span>
                    </div>
                  ))}
                  {fvgs.slice(0, 2).map((f, i) => (
                    <div key={`fvg-${i}`} className="rounded border bg-amber-500/5 border-amber-500/15 px-2.5 py-1.5 text-[10px] font-mono text-amber-400/80">
                      <span className="font-medium">{t.analysisResult.labels.fairValueGap}</span>
                      {' '}{f.direction} {formatPrice(f.lower)}–{formatPrice(f.upper)}
                      <span className="text-muted-foreground/50"> · {t.analysisResult.inline.freshSuffix}</span>
                    </div>
                  ))}
                </div>
                {(vwap || vp) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] font-mono text-muted-foreground/60">
                    {vwap && <span>vwap: {vwap.sessionVwap?.toFixed(4)} ({vwap.priceLocation.replace("_", " ")})</span>}
                    {vp && <span>vp poc: {vp.poc?.toFixed(4)} · vah: {vp.vah?.toFixed(4)} · val: {vp.val?.toFixed(4)}</span>}
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Risk Note */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-mono font-semibold text-amber-400">
              <span className="text-amber-400/60">$</span> {t.analysisResult.fields.riskNote}
            </h4>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm leading-relaxed text-amber-200/70 font-mono">
            {result.riskNote}
          </p>
          <Separator className="my-3 bg-amber-500/10" />
          <p className="text-[11px] text-amber-300/50 font-mono italic">
            {tx("analysisResult.riskNoteDisclaimer")}
          </p>
        </CardContent>
      </Card>

      {/* Derivatives / Positioning (crypto only) */}
      {result.derivativesData && result.derivativesData.confidence !== "unavailable" && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> {t.analysisResult.sections.derivativesPositioning}
              </h4>
              <Badge
                className={cn(
                  "text-[10px] font-mono",
                  result.derivativesData.confidence === "high" ? "bg-emerald-500/15 text-emerald-400" :
                  result.derivativesData.confidence === "medium" ? "bg-amber-500/15 text-amber-400" :
                  "bg-red-500/15 text-red-400"
                )}
              >
                {mapConfidence(result.derivativesData.confidence, t)} {t.analysis.confidence}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {result.derivativesData.fundingRate && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.fundingRate}</p>
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
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.openInterest}</p>
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
                  <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.liquidations}</p>
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
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">{t.analysisResult.labels.interpretation}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground font-mono">
                  {result.derivativesData.interpretation}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase 41–43 — Crypto Intelligence Panel (crypto instruments only).
          INFORMATIONAL ONLY — presentation of existing intelligence context.
          Does NOT calculate bias, conviction, gates, trade plan, or recommendation. */}
      {result.cryptoIntelligenceContext && result.instrumentType === "crypto" && (() => {
        const ci = result.cryptoIntelligenceContext!;
        const AVAIL_COLORS: Record<string, string> = {
          FULL: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          PARTIAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          MINIMAL: "bg-red-500/15 text-red-400 border-red-500/30",
          UNAVAILABLE: "bg-muted/30 text-muted-foreground border-border/50",
        };
        const FRESH_COLORS: Record<string, string> = {
          FRESH: "text-emerald-400",
          DELAYED: "text-amber-400",
          STALE: "text-red-400",
          UNAVAILABLE: "text-muted-foreground",
        };
        const Q_COLORS: Record<string, string> = {
          VERIFIED: "text-emerald-400",
          DEGRADED: "text-amber-400",
          STALE: "text-red-400",
          INSUFFICIENT: "text-orange-400",
          UNAVAILABLE: "text-muted-foreground",
        };
        const DIR_COLORS: Record<string, string> = {
          SUPPORTING: "text-emerald-400",
          CONFLICTING: "text-red-400",
          NEUTRAL: "text-muted-foreground",
          UNAVAILABLE: "text-muted-foreground/50",
        };
        const STR_COLORS: Record<string, string> = {
          STRONG: "text-emerald-400",
          MODERATE: "text-amber-400",
          WEAK: "text-orange-400",
          UNKNOWN: "text-muted-foreground",
        };
        return (
          <Card className="border border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.derivativesIntelligence}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", AVAIL_COLORS[ci.overallAvailability] ?? "border-border/50")}>
                  {ci.overallAvailability.toLowerCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono", Q_COLORS[ci.overallQuality] ?? "border-border/50")}>
                  {ci.overallQuality.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {/* Derivatives Intelligence */}
              {ci.derivatives && (
                <div>
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-sky-400/80">{"●"}</span> derivatives {"·"} {ci.derivatives.provider}
                    <span className={cn("ml-2", FRESH_COLORS[ci.derivatives.freshness])}> {ci.derivatives.freshness}</span>
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                    {ci.derivatives.openInterest && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.openInterest}</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                          {ci.derivatives.openInterest.current > 1e9
                            ? `$${(ci.derivatives.openInterest.current / 1e9).toFixed(2)}B`
                            : ci.derivatives.openInterest.current > 1e6
                              ? `$${(ci.derivatives.openInterest.current / 1e6).toFixed(1)}M`
                              : `$${ci.derivatives.openInterest.current.toLocaleString()}`}
                        </p>
                        {ci.derivatives.openInterest.change1h !== undefined && (
                          <p className={cn("text-[10px] font-mono", ci.derivatives.openInterest.change1h! > 0 ? "text-emerald-400" : "text-red-400")}>
                            {ci.derivatives.openInterest.change1h! > 0 ? "+" : ""}{ci.derivatives.openInterest.change1h!.toFixed(1)}% (1h)
                          </p>
                        )}
                        {ci.derivatives.openInterest.change24h !== undefined && (
                          <p className={cn("text-[10px] font-mono", ci.derivatives.openInterest.change24h! > 0 ? "text-emerald-400" : "text-red-400")}>
                            {ci.derivatives.openInterest.change24h! > 0 ? "+" : ""}{ci.derivatives.openInterest.change24h!.toFixed(1)}% (24h)
                          </p>
                        )}
                      </div>
                    )}
                    {ci.derivatives.fundingRate && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.fundingRate}</p>
                        <p className={cn("text-sm font-bold font-mono tabular-nums", ci.derivatives.fundingRate.isExtreme ? "text-amber-400" : "text-foreground")}>
                          {(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%
                        </p>
                        {ci.derivatives.fundingRate.annualizedRate !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            ~{(ci.derivatives.fundingRate.annualizedRate * 100).toFixed(1)}% ann.
                          </p>
                        )}
                        {ci.derivatives.fundingRate.isExtreme && (
                          <p className="text-[10px] font-mono text-amber-400">{t.analysisResult.labels.extreme}</p>
                        )}
                      </div>
                    )}
                    {ci.derivatives.liquidation && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.liquidations}</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                          {ci.derivatives.liquidation.totalVolume !== undefined
                            ? `$${(ci.derivatives.liquidation.totalVolume / 1e6).toFixed(1)}M`
                            : "—"}
                        </p>
                        {ci.derivatives.liquidation.dominantSide && (
                          <p className={cn("text-[10px] font-mono",
                            ci.derivatives.liquidation.dominantSide === "longs" ? "text-red-400" :
                            ci.derivatives.liquidation.dominantSide === "shorts" ? "text-emerald-400" : "text-muted-foreground")}>
                            {ci.derivatives.liquidation.dominantSide} liquidated
                          </p>
                        )}
                      </div>
                    )}
                    {ci.derivatives.positioning && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.positioningLabel}</p>
                        {ci.derivatives.positioning.accountRatio !== undefined && (
                          <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                            L/S: {ci.derivatives.positioning.accountRatio.toFixed(2)}
                          </p>
                        )}
                        {ci.derivatives.positioning.topTraderRatio !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            top: {ci.derivatives.positioning.topTraderRatio.toFixed(2)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
                    Derivatives data is contextual {"—"} funding is not an automatic LONG/SHORT signal, OI is not inherently bullish/bearish, liquidations do not automatically imply reversal.
                  </p>
                </div>
              )}
              {/* DeFi Fundamentals */}
              {ci.defi && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-purple-400/80">{"●"}</span> defi fundamentals {"·"} {ci.defi.provider}
                    <span className={cn("ml-2", FRESH_COLORS[ci.defi.freshness])}> {ci.defi.freshness}</span>
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                    {ci.defi.tvl && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">TVL</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                          ${(ci.defi.tvl.current / 1e9).toFixed(2)}B
                        </p>
                        {ci.defi.tvl.change7d !== undefined && (
                          <p className={cn("text-[10px] font-mono", ci.defi.tvl.change7d! > 0 ? "text-emerald-400" : "text-red-400")}>
                            {ci.defi.tvl.change7d! > 0 ? "+" : ""}{ci.defi.tvl.change7d!.toFixed(1)}% (7d)
                          </p>
                        )}
                        {ci.defi.tvl.change30d !== undefined && (
                          <p className={cn("text-[10px] font-mono", ci.defi.tvl.change30d! > 0 ? "text-emerald-400" : "text-red-400")}>
                            {ci.defi.tvl.change30d! > 0 ? "+" : ""}{ci.defi.tvl.change30d!.toFixed(1)}% (30d)
                          </p>
                        )}
                      </div>
                    )}
                    {ci.defi.fees && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">fees / revenue</p>
                        {ci.defi.fees.dailyFees !== undefined && (
                          <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                            ${ci.defi.fees.dailyFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}/d
                          </p>
                        )}
                        {ci.defi.fees.dailyRevenue !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            rev: ${ci.defi.fees.dailyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}/d
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
                    {t.analysisResult.labels.tvlDisclaimer}
                  </p>
                </div>
              )}
              {/* Tokenomics */}
              {ci.tokenomics && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-orange-400/80">{"●"}</span> tokenomics {"·"} {ci.tokenomics.provider}
                    <span className={cn("ml-2", FRESH_COLORS[ci.tokenomics.freshness])}> {ci.tokenomics.freshness}</span>
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                    {ci.tokenomics.supply && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.supplyLabel}</p>
                        {ci.tokenomics.supply.circulatingSupply !== undefined && (
                          <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                            circ: {ci.tokenomics.supply.circulatingSupply.toLocaleString()}
                          </p>
                        )}
                        {ci.tokenomics.supply.totalSupply !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            total: {ci.tokenomics.supply.totalSupply.toLocaleString()}
                          </p>
                        )}
                        {ci.tokenomics.supply.circulatingPercent !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            unlocked: {ci.tokenomics.supply.circulatingPercent.toFixed(1)}%
                          </p>
                        )}
                      </div>
                    )}
                    {ci.tokenomics.unlocks && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">unlocks (30d)</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">
                          {ci.tokenomics.unlocks.upcomingCount30d} event(s)
                        </p>
                        {ci.tokenomics.unlocks.unlockPercentOfCirculating !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            ~{ci.tokenomics.unlocks.unlockPercentOfCirculating.toFixed(2)}% of circ.
                          </p>
                        )}
                        {ci.tokenomics.unlocks.summary && (
                          <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 leading-relaxed">
                            {ci.tokenomics.unlocks.summary}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
                    {t.analysisResult.labels.unlocksDisclaimer}
                  </p>
                </div>
              )}
              {/* Evidence Summary */}
              {ci.evidence.length > 0 && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">{t.analysisResult.labels.evidenceLabel}</p>
                  <div className="space-y-1">
                    {ci.evidence.slice(0, 8).map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                        <span className={cn("shrink-0", DIR_COLORS[e.direction])}>
                          {e.direction === "SUPPORTING" ? "+" : e.direction === "CONFLICTING" ? "−" : e.direction === "NEUTRAL" ? "·" : "?"}
                        </span>
                        <span className="text-muted-foreground/60 w-24 shrink-0">{e.category}</span>
                        <span className="text-muted-foreground/80 flex-1">{e.explanation}</span>
                        <span className={cn("shrink-0", STR_COLORS[e.strength])}>{e.strength}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Missing Information */}
              {ci.missingInformation.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">{t.analysisResult.labels.missingIntelligence}</p>
                  {ci.missingInformation.map((m, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-300/70">{"⚠"} {m}</p>
                  ))}
                </div>
              )}
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed border-t border-border/30 pt-2">
                {ci.analystSummary}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/40 italic">
                Crypto intelligence is informational {"—"} it does not modify bias, conviction, gates, trade plan, or recommendation.
              </p>
            </CardContent>
          </Card>
        );
      })()}



      {/* Phase 44-45 — Universal Intelligence Panel (forex, equity, commodity, cross-asset).
          INFORMATIONAL ONLY — presentation of existing intelligence context.
          Does NOT calculate bias, conviction, gates, trade plan, or recommendation.
          Does NOT render for crypto instruments (crypto has its own panel above). */}
      {result.universalIntelligenceContext && result.instrumentType !== "crypto" && (() => {
        const ui = result.universalIntelligenceContext!;
        const AVAIL_COLORS: Record<string, string> = {
          FULL: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          PARTIAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          MINIMAL: "bg-red-500/15 text-red-400 border-red-500/30",
          UNAVAILABLE: "bg-muted/30 text-muted-foreground border-border/50",
        };
        const Q_COLORS: Record<string, string> = {
          VERIFIED: "text-emerald-400",
          DEGRADED: "text-amber-400",
          STALE: "text-red-400",
          INSUFFICIENT: "text-orange-400",
          UNAVAILABLE: "text-muted-foreground",
        };
        const FRESH_COLORS: Record<string, string> = {
          FRESH: "text-emerald-400",
          DELAYED: "text-amber-400",
          STALE: "text-red-400",
          UNAVAILABLE: "text-muted-foreground",
        };
        const DIR_COLORS: Record<string, string> = {
          SUPPORTING: "text-emerald-400",
          CONFLICTING: "text-red-400",
          NEUTRAL: "text-muted-foreground",
          UNAVAILABLE: "text-muted-foreground/50",
        };
        const STR_COLORS: Record<string, string> = {
          STRONG: "text-emerald-400",
          MODERATE: "text-amber-400",
          WEAK: "text-orange-400",
          UNKNOWN: "text-muted-foreground",
        };
        const ASSET_LABELS: Record<string, string> = {
          forex: "forex",
          equity: "equity",
          commodity: "commodity",
          indices: "indices",
          macro: "macro",
        };
        return (
          <Card className="border border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                  <span className="text-primary/60">$</span> {t.analysisResult.sections.universalIntelligence}
                </h4>
                <Badge variant="outline" className={cn("text-[10px] font-mono", AVAIL_COLORS[ui.overallAvailability] ?? "border-border/50")}>
                  {ASSET_LABELS[ui.assetClass] ?? ui.assetClass} · {ui.overallAvailability.toLowerCase()}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-mono", Q_COLORS[ui.overallQuality] ?? "border-border/50")}>
                  {ui.overallQuality.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {/* Forex Intelligence */}
              {ui.forex && (
                <div>
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-sky-400/80">{"●"}</span> {t.analysisResult.labels.forexIntelligence}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono mb-2">
                    {ui.forex.rates && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.ratesLabel}:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.rates.freshness]}>{ui.forex.rates.freshness}</span>
                        {ui.forex.rates.rateDifferential !== undefined && (
                          <span className="ml-1">· {t.analysisResult.inline.diff}: <span className="text-foreground">{ui.forex.rates.rateDifferential.toFixed(1)}bp</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.yields && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.yieldsLabel}:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.yields.freshness]}>{ui.forex.yields.freshness}</span>
                        {ui.forex.yields.yieldDifferential !== undefined && (
                          <span className="ml-1">· {t.analysisResult.inline.spreadLabel2}: <span className="text-foreground">{ui.forex.yields.yieldDifferential.toFixed(1)}bp</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.positioning && (
                      <div>
                        <span className="text-muted-foreground">COT:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.positioning.freshness]}>{ui.forex.positioning.freshness}</span>
                        {ui.forex.positioning.nonCommercialNet !== undefined && (
                          <span className="ml-1">· net: <span className="text-foreground">{ui.forex.positioning.nonCommercialNet.toLocaleString()}</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.macro && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.labels.calendarLabel}:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.macro.freshness]}>{ui.forex.macro.freshness}</span>
                        {ui.forex.macro.upcomingEvents && (
                          <span className="ml-1">· <span className="text-foreground">{ui.forex.macro.upcomingEvents.length} events</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.crossAsset && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.crossAssetLabel}:</span>{" "}
                        <span className="text-foreground">DXY {ui.forex.crossAsset.dxyTrend ?? "—"} · {ui.forex.crossAsset.riskRegime ?? "—"}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed">
                    {tx("analysisResult.forexContextNote")}
                  </p>
                </div>
              )}
              {/* Equity Intelligence */}
              {ui.equity && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-purple-400/80">{"●"}</span> {t.analysisResult.labels.equityIntelligence}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                    {ui.equity.fundamentals?.peRatio !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">P/E</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">{ui.equity.fundamentals.peRatio!.toFixed(1)}</p>
                      </div>
                    )}
                    {ui.equity.fundamentals?.revenueGrowth !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.revGrowth}</p>
                        <p className={cn("text-sm font-bold font-mono tabular-nums", ui.equity.fundamentals.revenueGrowth! > 0 ? "text-emerald-400" : "text-red-400")}>
                          {(ui.equity.fundamentals.revenueGrowth! * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
                    {ui.equity.fundamentals?.profitMargin !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.marginShort}</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">{(ui.equity.fundamentals.profitMargin! * 100).toFixed(1)}%</p>
                      </div>
                    )}
                    {ui.equity.fundamentals?.marketCap !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">{t.analysisResult.labels.mktCapLower}</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">${(ui.equity.fundamentals.marketCap! / 1e9).toFixed(1)}B</p>
                      </div>
                    )}
                  </div>
                  {ui.equity.sector && (
                    <p className="text-[10px] font-mono text-muted-foreground/80 mb-1">
                      sector: {ui.equity.sector.sector}{ui.equity.sector.industry ? ` · ${ui.equity.sector.industry}` : ""}
                    </p>
                  )}
                  {ui.equity.valuation?.relativeValuation && (
                    <p className="text-[10px] font-mono">
                      {t.analysisResult.labels.valuation}: <span className="text-foreground">{ui.equity.valuation.relativeValuation}</span>
                    </p>
                  )}
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed mt-1">
                    {tx("analysisResult.fundamentalContextNote")}
                  </p>
                </div>
              )}
              {/* Commodity Intelligence */}
              {ui.commodity && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-amber-400/80">{"●"}</span> {t.analysisResult.labels.commodityIntelligence}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono mb-2">
                    {ui.commodity.inventory && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.inventoryLabel}:</span>{" "}
                        <span className={FRESH_COLORS[ui.commodity.inventory.freshness]}>{ui.commodity.inventory.freshness}</span>
                        {ui.commodity.inventory.changeWeekly !== undefined && (
                          <span className="ml-1">· <span className="text-foreground">{ui.commodity.inventory.changeWeekly! > 0 ? "+" : ""}{ui.commodity.inventory.changeWeekly!.toLocaleString()}</span>/wk</span>
                        )}
                      </div>
                    )}
                    {ui.commodity.futuresStructure && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.structureLabel}:</span>{" "}
                        <span className="text-foreground">{ui.commodity.futuresStructure.structure ?? "—"}</span>
                        {ui.commodity.futuresStructure.rollYield !== undefined && (
                          <span className="ml-1">· {t.analysisResult.inline.rollLabel}: <span className="text-foreground">{ui.commodity.futuresStructure.rollYield!.toFixed(2)}%</span></span>
                        )}
                      </div>
                    )}
                    {ui.commodity.positioning && (
                      <div>
                        <span className="text-muted-foreground">COT:</span>{" "}
                        <span className={FRESH_COLORS[ui.commodity.positioning.freshness]}>{ui.commodity.positioning.freshness}</span>
                        {ui.commodity.positioning.managedMoneyNet !== undefined && (
                          <span className="ml-1">· MM net: <span className="text-foreground">{ui.commodity.positioning.managedMoneyNet!.toLocaleString()}</span></span>
                        )}
                      </div>
                    )}
                  </div>
                  {ui.commodity.seasonality?.seasonalPattern && (
                    <p className="text-[10px] font-mono text-muted-foreground/80 mb-1">
                      seasonality: {ui.commodity.seasonality.seasonalPattern}
                    </p>
                  )}
                  {ui.commodity.macroInfluence?.dollarContext && (
                    <p className="text-[10px] font-mono text-muted-foreground/80 mb-1">
                      dollar: {ui.commodity.macroInfluence.dollarContext}
                    </p>
                  )}
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed mt-1">
                    {tx("analysisResult.derivativesContextNote")}
                  </p>
                </div>
              )}
              {/* Cross-Asset / Macro Intelligence */}
              {ui.crossAsset && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">
                    <span className="text-sky-400/80">{"●"}</span> {t.analysisResult.labels.crossAssetMacro}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono mb-2">
                    {ui.crossAsset.dxy && (
                      <div>
                        <span className="text-muted-foreground">DXY:</span>{" "}
                        <span className="text-foreground">{ui.crossAsset.dxy.value?.toFixed(1) ?? "—"}</span>
                        {ui.crossAsset.dxy.trend && (
                          <span className={cn("ml-1", ui.crossAsset.dxy.trend === "rising" ? "text-amber-400" : ui.crossAsset.dxy.trend === "falling" ? "text-emerald-400" : "text-muted-foreground")}>
                            ({ui.crossAsset.dxy.trend})
                          </span>
                        )}
                      </div>
                    )}
                    {ui.crossAsset.treasury && (
                      <div>
                        <span className="text-muted-foreground">10Y:</span>{" "}
                        <span className="text-foreground">{ui.crossAsset.treasury.tenYear?.toFixed(2) ?? "—"}%</span>
                        {ui.crossAsset.treasury.yieldCurve && (
                          <span className="ml-1">· {ui.crossAsset.treasury.yieldCurve}</span>
                        )}
                      </div>
                    )}
                    {ui.crossAsset.riskRegime && (
                      <div>
                        <span className="text-muted-foreground">{t.analysisResult.inline.riskLabel}:</span>{" "}
                        <span className={cn(
                          "text-foreground",
                          ui.crossAsset.riskRegime.regime === "risk_on" ? "text-emerald-400" :
                          ui.crossAsset.riskRegime.regime === "risk_off" ? "text-red-400" : "text-foreground"
                        )}>{ui.crossAsset.riskRegime.regime ?? "—"}</span>
                      </div>
                    )}
                  </div>
                  {ui.crossAsset.centralBanks?.fedContext && (
                    <p className="text-[10px] font-mono text-muted-foreground/80 mb-1">
                      fed: {ui.crossAsset.centralBanks.fedContext}
                    </p>
                  )}
                  {ui.crossAsset.globalLiquidity?.m2Trend && (
                    <p className="text-[10px] font-mono text-muted-foreground/80 mb-1">
                      M2: {ui.crossAsset.globalLiquidity.m2Trend}
                    </p>
                  )}
                  <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed mt-1">
                    {tx("analysisResult.crossAssetRegimeNote")}
                  </p>
                </div>
              )}
              {/* Evidence Summary */}
              {ui.evidence.length > 0 && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">evidence ({ui.evidence.length})</p>
                  <div className="space-y-1">
                    {ui.evidence.slice(0, 6).map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                        <span className={cn("shrink-0", DIR_COLORS[e.direction])}>
                          {e.direction === "SUPPORTING" ? "+" : e.direction === "CONFLICTING" ? "−" : e.direction === "NEUTRAL" ? "·" : "?"}
                        </span>
                        <span className="text-muted-foreground/60 w-24 shrink-0">{e.category}</span>
                        <span className="text-muted-foreground/80 flex-1 truncate">{e.explanation}</span>
                        <span className={cn("shrink-0", STR_COLORS[e.strength])}>{e.strength}</span>
                      </div>
                    ))}
                    {ui.evidence.length > 6 && (
                      <p className="text-[9px] font-mono text-muted-foreground/50">+{ui.evidence.length - 6} more</p>
                    )}
                  </div>
                </div>
              )}
              {/* Double-counting warnings */}
              {ui.dataFlags.filter((f) => f.startsWith("DOUBLE_COUNTING")).length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-amber-400">{t.analysisResult.labels.doubleCounting}:</span>{" "}
                  {ui.dataFlags.filter((f) => f.startsWith("DOUBLE_COUNTING")).map((f, i) => (
                    <span key={i} className="text-amber-400/80">• {f.replace("DOUBLE_COUNTING:", "")} </span>
                  ))}
                </div>
              )}
              {/* Missing Information */}
              {ui.missingInformation.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">{t.analysisResult.labels.missingIntelligence}</p>
                  {ui.missingInformation.slice(0, 5).map((m, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-300/70">{"⚠"} {m}</p>
                  ))}
                  {ui.missingInformation.length > 5 && (
                    <p className="text-[9px] font-mono text-muted-foreground/50">+{ui.missingInformation.length - 5} more</p>
                  )}
                </div>
              )}
              <p className="text-[10px] font-mono text-muted-foreground/80 leading-relaxed border-t border-border/30 pt-2">
                {ui.analystSummary}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/40 italic">
                Universal intelligence is informational {"—"} it does not modify bias, conviction, gates, trade plan, or recommendation.
              </p>
            </CardContent>
          </Card>
        );
      })()}
      {/* Economic Calendar / Macro Risk */}
      {result.calendarData && result.calendarData.confidence !== "unavailable" && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-mono font-semibold text-muted-foreground">
                <span className="text-primary/60">$</span> {t.analysisResult.sections.economicCalendar}
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
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">{t.analysisResult.labels.upcomingHighImpact}</p>
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
                <p className="text-[10px] font-mono font-medium text-muted-foreground mb-1">{t.analysisResult.labels.recentHighImpactReleases}</p>
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
      {/* Phase 32 — Journal This Analysis */}
      <Card className="border border-border/30 mt-2">
        <CardContent className="py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground">
              {tx("analysisResult.saveJournalCta")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
