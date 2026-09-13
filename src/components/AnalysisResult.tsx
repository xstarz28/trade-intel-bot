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
                      actual DXY unavailable on current provider plan — no fabricated series
                    </span>
                  )}
                </p>
              );
            })()}
            {(result.keyContradictions?.filter((c) => c.severity !== "MINOR").length ?? 0) > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2">
                <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">key contradictions</p>
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
                <span className="text-muted-foreground/60">real yield: unavailable</span>
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
              <span>mapped: <span className="text-foreground">{result.cotContext.mappedAsset}</span></span>
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
              <span>spread: <span className="text-foreground">{result.executionContext.spreadBps.toFixed(2)} bps</span></span>
              <span>depth L/R: <span className="text-foreground">{result.executionContext.bidDepth.toFixed(2)} / {result.executionContext.askDepth.toFixed(2)}</span> contracts</span>
              <span>imbalance: <span className="text-foreground">{(result.executionContext.imbalance * 100).toFixed(0)}%</span></span>
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
                    Evidence hierarchy: Structure → MTF → Liquidity → Location → Fundamental → Sentiment → Execution → Indicators
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
                  <span className="text-muted-foreground">continuation:</span>{" "}
                  <span className={sc.continuationStatus === "confirmed" ? "text-emerald-400" : sc.continuationStatus === "developing" ? "text-amber-400" : "text-muted-foreground"}>
                    {sc.continuationStatus}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">reversal:</span>{" "}
                  <span className={sc.reversalStatus === "confirmed" ? "text-red-400" : sc.reversalStatus === "developing" ? "text-amber-400" : "text-muted-foreground"}>
                    {sc.reversalStatus}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">confirmation:</span>{" "}
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
                  <p className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider mb-0.5">primary</p>
                  <p className="text-[11px] font-mono text-foreground/80 leading-relaxed">{sc.primaryScenario}</p>
                </div>
                <div className="rounded-lg bg-muted/10 border border-border/30 px-3 py-2">
                  <p className="text-[10px] font-mono font-medium text-muted-foreground/60 uppercase tracking-wider mb-0.5">alternate</p>
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
                Scenario analysis is informational — it does not override the structural hierarchy, gates, or conviction.
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
                  <span className="text-muted-foreground">direction:</span>{" "}
                  <span>{regime.currentDirection}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">transition:</span>{" "}
                  <span>{regime.trendTransition.transitionType.replace(/_/g, " ").toLowerCase()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">fundamental:</span>{" "}
                  <span>{ft.alignment.replace(/_/g, " ").toLowerCase()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.analysisResult.eventRisk}</span>{" "}
                  <span>{ft.eventRisk.toLowerCase()}</span>
                </div>
              </div>
              <div className="text-[10px] font-mono space-y-1">
                <div>
                  <span className="text-muted-foreground">primary:</span>{" "}
                  <span>{pt.primaryScenario}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">alternate:</span>{" "}
                  <span className="text-muted-foreground">{pt.alternateScenario}</span>
                </div>
              </div>
              {regime.exhaustionSignals.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">exhaustion:</span>{" "}
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
                <div><span className="text-muted-foreground">primary:</span> <span>{fp.pathStatus}</span></div>
                <div><span className="text-muted-foreground">alternate:</span> <span className="text-muted-foreground">{fp.alternatePath.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.fields.structuralConfidence}</span> <span className={CONF_COLORS[fp.structuralConfidence]}>{fp.structuralConfidence.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">{t.analysisResult.fields.dataReliability}</span> <span>{fp.dataReliability}</span></div>
              </div>

              {/* Confirmation + Invalidation */}
              {fp.confirmationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">confirm:</span>{" "}
                  {fp.confirmationConditions.map((c, i) => <span key={i} className="block text-emerald-400/80">• {c}</span>)}
                </div>
              )}
              {fp.invalidationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">invalidate:</span>{" "}
                  {fp.invalidationConditions.map((c, i) => <span key={i} className="block text-red-400/80">• {c}</span>)}
                </div>
              )}

              {/* Path Risks */}
              {fp.pathRisks.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">risks:</span>{" "}
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
                <span className="text-muted-foreground">next:</span> <span className="text-primary/80">{fp.nextBestAction}</span>
              </div>

              {/* Trader + Investor View */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">trader:</span> <span>{fp.traderView}</span>
                </div>
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">investor:</span> <span>{fp.investorView}</span>
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
                  <span className="text-muted-foreground">supporting:</span>
                  {lh.supportingEvidence.map((e, i) => (
                    <span key={i} className="block text-emerald-400/80">• [{e.source}] {e.explanation}</span>
                  ))}
                </div>
              )}
              {lh.conflictingEvidence.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">conflicting:</span>
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
                  <span className="text-muted-foreground">confirm:</span>
                  {lh.confirmationConditions.map((c, i) => <span key={i} className="block text-emerald-400/80">• {c}</span>)}
                </div>
              )}
              {lh.invalidationConditions.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">invalidate:</span>
                  {lh.invalidationConditions.map((c, i) => <span key={i} className="block text-red-400/80">• {c}</span>)}
                </div>
              )}

              {lh.thesisRisks.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">risks:</span>
                  {lh.thesisRisks.map((r, i) => <span key={i} className="block text-amber-400/80">• {r}</span>)}
                </div>
              )}
              {lh.missingInformation.length > 0 && (
                <div className="text-[10px] font-mono">
                  <span className="text-muted-foreground">missing:</span>
                  {lh.missingInformation.map((m, i) => <span key={i} className="block text-orange-300/60">• {m}</span>)}
                </div>
              )}

              <div className="text-[10px] font-mono space-y-1">
                <div><span className="text-muted-foreground">fundamental:</span> <span>{lh.fundamentalContext}</span></div>
                <div><span className="text-muted-foreground">macro:</span> <span className="text-muted-foreground/80">{lh.macroContext}</span></div>
                <div><span className="text-muted-foreground">valuation:</span> <span className="text-muted-foreground/80">{lh.valuationContext}</span></div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">investor:</span> <span>{lh.investorImplication}</span>
                </div>
                <div className="rounded border border-border/30 p-2">
                  <span className="text-muted-foreground">trader:</span> <span>{lh.traderImplication}</span>
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
                      <span className="font-medium">order block</span>
                      {' '}{o.direction} {formatPrice(o.lower)}–{formatPrice(o.upper)}
                      <span className="text-muted-foreground/50"> · {o.status}</span>
                    </div>
                  ))}
                  {fvgs.slice(0, 2).map((f, i) => (
                    <div key={`fvg-${i}`} className="rounded border bg-amber-500/5 border-amber-500/15 px-2.5 py-1.5 text-[10px] font-mono text-amber-400/80">
                      <span className="font-medium">fair value gap</span>
                      {' '}{f.direction} {formatPrice(f.lower)}–{formatPrice(f.upper)}
                      <span className="text-muted-foreground/50"> · fresh</span>
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
                        <p className="text-[10px] font-mono text-muted-foreground">open interest</p>
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
                        <p className="text-[10px] font-mono text-muted-foreground">funding rate</p>
                        <p className={cn("text-sm font-bold font-mono tabular-nums", ci.derivatives.fundingRate.isExtreme ? "text-amber-400" : "text-foreground")}>
                          {(ci.derivatives.fundingRate.currentRate * 100).toFixed(4)}%
                        </p>
                        {ci.derivatives.fundingRate.annualizedRate !== undefined && (
                          <p className="text-[10px] font-mono text-muted-foreground">
                            ~{(ci.derivatives.fundingRate.annualizedRate * 100).toFixed(1)}% ann.
                          </p>
                        )}
                        {ci.derivatives.fundingRate.isExtreme && (
                          <p className="text-[10px] font-mono text-amber-400">extreme</p>
                        )}
                      </div>
                    )}
                    {ci.derivatives.liquidation && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">liquidations</p>
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
                        <p className="text-[10px] font-mono text-muted-foreground">positioning</p>
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
                    Fundamental activity does not independently establish future price direction. TVL expansion is supportive context, not guaranteed bullish.
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
                        <p className="text-[10px] font-mono text-muted-foreground">supply</p>
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
                    Unlocks are context, not automatic bearish signals. Impact depends on size, recipient behavior, liquidity, and market absorption.
                  </p>
                </div>
              )}
              {/* Evidence Summary */}
              {ci.evidence.length > 0 && (
                <div className="border-t border-border/30 pt-3">
                  <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-2">evidence</p>
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
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">missing intelligence</p>
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
                    <span className="text-sky-400/80">{"●"}</span> forex intelligence
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono mb-2">
                    {ui.forex.rates && (
                      <div>
                        <span className="text-muted-foreground">rates:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.rates.freshness]}>{ui.forex.rates.freshness}</span>
                        {ui.forex.rates.rateDifferential !== undefined && (
                          <span className="ml-1">· diff: <span className="text-foreground">{ui.forex.rates.rateDifferential.toFixed(1)}bp</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.yields && (
                      <div>
                        <span className="text-muted-foreground">yields:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.yields.freshness]}>{ui.forex.yields.freshness}</span>
                        {ui.forex.yields.yieldDifferential !== undefined && (
                          <span className="ml-1">· spread: <span className="text-foreground">{ui.forex.yields.yieldDifferential.toFixed(1)}bp</span></span>
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
                        <span className="text-muted-foreground">calendar:</span>{" "}
                        <span className={FRESH_COLORS[ui.forex.macro.freshness]}>{ui.forex.macro.freshness}</span>
                        {ui.forex.macro.upcomingEvents && (
                          <span className="ml-1">· <span className="text-foreground">{ui.forex.macro.upcomingEvents.length} events</span></span>
                        )}
                      </div>
                    )}
                    {ui.forex.crossAsset && (
                      <div>
                        <span className="text-muted-foreground">cross-asset:</span>{" "}
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
                    <span className="text-purple-400/80">{"●"}</span> equity intelligence
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
                        <p className="text-[10px] font-mono text-muted-foreground">rev growth</p>
                        <p className={cn("text-sm font-bold font-mono tabular-nums", ui.equity.fundamentals.revenueGrowth! > 0 ? "text-emerald-400" : "text-red-400")}>
                          {(ui.equity.fundamentals.revenueGrowth! * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
                    {ui.equity.fundamentals?.profitMargin !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">margin</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">{(ui.equity.fundamentals.profitMargin! * 100).toFixed(1)}%</p>
                      </div>
                    )}
                    {ui.equity.fundamentals?.marketCap !== undefined && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground">mkt cap</p>
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
                      valuation: <span className="text-foreground">{ui.equity.valuation.relativeValuation}</span>
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
                    <span className="text-amber-400/80">{"●"}</span> commodity intelligence
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] font-mono mb-2">
                    {ui.commodity.inventory && (
                      <div>
                        <span className="text-muted-foreground">inventory:</span>{" "}
                        <span className={FRESH_COLORS[ui.commodity.inventory.freshness]}>{ui.commodity.inventory.freshness}</span>
                        {ui.commodity.inventory.changeWeekly !== undefined && (
                          <span className="ml-1">· <span className="text-foreground">{ui.commodity.inventory.changeWeekly! > 0 ? "+" : ""}{ui.commodity.inventory.changeWeekly!.toLocaleString()}</span>/wk</span>
                        )}
                      </div>
                    )}
                    {ui.commodity.futuresStructure && (
                      <div>
                        <span className="text-muted-foreground">structure:</span>{" "}
                        <span className="text-foreground">{ui.commodity.futuresStructure.structure ?? "—"}</span>
                        {ui.commodity.futuresStructure.rollYield !== undefined && (
                          <span className="ml-1">· roll: <span className="text-foreground">{ui.commodity.futuresStructure.rollYield!.toFixed(2)}%</span></span>
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
                    <span className="text-sky-400/80">{"●"}</span> cross-asset macro
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
                        <span className="text-muted-foreground">risk:</span>{" "}
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
                  <span className="text-amber-400">double-counting:</span>{" "}
                  {ui.dataFlags.filter((f) => f.startsWith("DOUBLE_COUNTING")).map((f, i) => (
                    <span key={i} className="text-amber-400/80">• {f.replace("DOUBLE_COUNTING:", "")} </span>
                  ))}
                </div>
              )}
              {/* Missing Information */}
              {ui.missingInformation.length > 0 && (
                <div className="border-t border-border/30 pt-2">
                  <p className="text-[10px] font-mono font-semibold text-amber-400 mb-1">missing intelligence</p>
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
