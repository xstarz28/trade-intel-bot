import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnalysisResult } from "@/types/analysis";
import { cn, getTimeAgo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { mapConfidence, mapTrendLabel } from "@/lib/i18n/enum-mapping";
import { History, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";

interface AnalysisHistoryProps {
  analyses: AnalysisResult[];
  onSelect: (analysis: AnalysisResult) => void;
  selectedId?: string;
  /**
   * Phase 189 — true while the history query has not resolved.
   *
   * Without this, an unresolved query and a genuinely empty account are
   * indistinguishable, so a first-run user is told "No history yet" before
   * anything has been loaded. That is the UI inventing state.
   */
  isLoading?: boolean;
}

const BIAS_ICONS = {
  Bullish: TrendingUp,
  Bearish: TrendingDown,
  Neutral: Minus,
} as const;

/**
 * Ordinal conviction band for legacy records.
 *
 * Stored analyses predating the `conviction` field carry only the numeric
 * score. The thresholds mirror `getConviction` in AnalysisResult.tsx so the
 * two surfaces can never disagree about the same record.
 */
function deriveConvictionBand(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 70) return "High";
  if (confidence >= 50) return "Medium";
  return "Low";
}

const BIAS_COLORS = {
  Bullish: "text-emerald-400",
  Bearish: "text-red-400",
  Neutral: "text-muted-foreground",
} as const;

// Phase 255 — past snapshots only; provenance retained but never current.
// This panel shows historical analyses only.
// Freshness shown as observation date, not as a real-time tick.
// No LIVE badge for past data.



export function AnalysisHistory({
  analyses,
  onSelect,
  selectedId,
  isLoading = false,
}: AnalysisHistoryProps) {
  const { t, tx } = useI18n();

  // Loading is NOT emptiness. Announce it politely and say nothing about
  // whether any history exists.
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent
          className="flex flex-col items-center justify-center py-10 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/30 mb-3">
            <History className="size-5 text-muted-foreground/50 animate-pulse" />
          </div>
          <p className="text-xs font-mono font-medium text-muted-foreground">
            {tx("global.loading")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (analyses.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/30 mb-3">
            <History className="size-5 text-muted-foreground/50" />
          </div>
          <p className="text-xs font-mono font-medium text-muted-foreground">{tx("emptyStates.noHistory")}</p>
          <p className="text-[11px] text-muted-foreground/50 mt-1 font-mono">
            {tx("analysisHistory.emptyHint")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-muted-foreground" />
          <CardTitle className="text-[11px] font-mono font-semibold text-muted-foreground">
            {"$ "}
            {tx("analysisHistory.title")}
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono ml-auto border-border/50">
            {analyses.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-1">
            {analyses.map((a) => {
              const BiasIcon = BIAS_ICONS[a.bias];
              const isSelected = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-all",
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/30 border border-transparent"
                  )}
                >
                  <BiasIcon className={cn("size-3.5 shrink-0", BIAS_COLORS[a.bias])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-mono font-semibold">{a.instrument}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{a.timeframe}</span>
                      {/* Phase 253 — provider/native identity disambiguation: BTC/USDT from Binance vs OKX vs Twelve Data BTC/USD
                          Phase 256 — typed optional fields, backward-compatible: old rows without provider render safely */}
                      {a.provider ? (
                        <span className="text-[9px] font-mono px-1 py-0 rounded border border-border/40 bg-muted/20 text-muted-foreground">
                          {a.provider}
                          {a.providerInstrumentId && a.providerInstrumentId !== a.instrument
                            ? `:${a.providerInstrumentId}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-[11px] font-mono font-medium", BIAS_COLORS[a.bias])}>
                        {mapTrendLabel(a.bias, t)}
                      </span>
                      {/*
                        Phase 191 — conviction label, not a bare percentage.

                        This rendered `{a.confidence}%` next to a directional
                        bias, which reads as "72% chance this is right".
                        `confidence` is a clamped 20-88 confluence heuristic
                        (analysis-engine.ts), never a probability or win rate.
                        The result panel already shows the ordinal conviction
                        band, so history now agrees with it instead of
                        implying a statistic the engine does not compute.
                      */}
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {mapConfidence(a.conviction ?? deriveConvictionBand(a.confidence), t)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
                    <Clock className="size-3" />
                    {getTimeAgo(a.timestamp)}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
