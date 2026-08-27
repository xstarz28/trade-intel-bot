/**
 * Phase 49 — Market Opportunities Panel
 *
 * Displays ranked instrument recommendations across trading horizons
 * and investment horizons. Pure presentation — no decision logic.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateRecommendation,
  discoverCandidates,
  type CandidateInput,
  type TradingMode,
  type InvestorHorizon,
  type UniversalRecommendationResult,
  type RankedInstrument,
} from "@/lib/recommendation-engine";
import { TrendingUp, Target, Clock, Filter, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";

const SUITABILITY_COLORS: Record<string, string> = {
  TOP_OPPORTUNITY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  WATCHLIST: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  NEUTRAL: "bg-muted/30 text-muted-foreground border-border/50",
  EXCLUDED: "bg-red-500/10 text-red-400/60 border-red-500/20",
  INSUFFICIENT_DATA: "bg-amber-500/10 text-amber-400/60 border-amber-500/20",
};

const ASSET_COLORS: Record<string, string> = {
  crypto: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  forex: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  equity: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  commodity: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  indices: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  macro: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

const TRADING_HORIZONS: { key: TradingMode; label: string }[] = [
  { key: "SCALPING", label: "Scalping" },
  { key: "INTRADAY", label: "Intraday" },
  { key: "SWING", label: "Swing" },
];

const INVESTOR_HORIZONS: { key: InvestorHorizon; label: string }[] = [
  { key: "1-4_WEEKS", label: "1–4 Weeks" },
  { key: "1-3_MONTHS", label: "1–3 Months" },
  { key: "3-6_MONTHS", label: "3–6 Months" },
  { key: "6-12_MONTHS", label: "6–12 Months" },
  { key: "1-3_YEARS", label: "1–3 Years" },
  { key: "3+_YEARS", label: "3+ Years" },
];

interface MarketOpportunitiesProps {
  /** Pre-computed candidates from current market state. */
  candidates: CandidateInput[];
}

function RankedCard({ item }: { item: RankedInstrument }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono font-bold">{item.instrument}</span>
        <Badge variant="outline" className={cn("text-[9px] font-mono", ASSET_COLORS[item.assetClass] ?? "border-border/50")}>
          {item.assetClass}
        </Badge>
        <Badge variant="outline" className={cn("text-[9px] font-mono", SUITABILITY_COLORS[item.suitability])}>
          {item.suitability.replace(/_/g, " ")}
        </Badge>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">
          #{item.rank}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-2">
        <div className="text-center">
          <p className="text-[9px] font-mono text-muted-foreground">score</p>
          <p className={cn(
            "text-sm font-bold font-mono tabular-nums",
            item.analyticalScore >= 70 ? "text-emerald-400" :
            item.analyticalScore >= 50 ? "text-amber-400" : "text-muted-foreground"
          )}>
            {item.analyticalScore}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[9px] font-mono text-muted-foreground">confidence</p>
          <p className="text-sm font-bold font-mono tabular-nums text-foreground">{item.confidence}</p>
        </div>
        {item.executionQuality !== undefined && (
          <div className="text-center">
            <p className="text-[9px] font-mono text-muted-foreground">spread</p>
            <p className="text-sm font-bold font-mono tabular-nums text-foreground">{item.executionQuality}bps</p>
          </div>
        )}
        <Badge variant="outline" className="text-[9px] font-mono ml-auto border-border/50">
          {item.dataCompleteness} · {item.freshness}
        </Badge>
      </div>

      {item.primaryReasons.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {item.primaryReasons.slice(0, 3).map((r, i) => (
            <p key={i} className="text-[9px] font-mono text-muted-foreground/70">• {r}</p>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
          {item.conflictingEvidence.length > 0 && (
            <div>
              <p className="text-[9px] font-mono font-semibold text-amber-400/80 mb-0.5">conflicts</p>
              {item.conflictingEvidence.map((c, i) => (
                <p key={i} className="text-[9px] font-mono text-amber-300/60">⚠ {c}</p>
              ))}
            </div>
          )}
          {item.risks.length > 0 && (
            <div>
              <p className="text-[9px] font-mono font-semibold text-red-400/80 mb-0.5">risks</p>
              {item.risks.map((r, i) => (
                <p key={i} className="text-[9px] font-mono text-red-300/60">• {r}</p>
              ))}
            </div>
          )}
          <div className="text-[9px] font-mono text-muted-foreground/60">
            <span>analysis: {item.recommendedAnalysisType}</span>
            <span className="mx-1">·</span>
            <span>coverage: {item.providerCoverage}</span>
          </div>
        </div>
      )}

      <button
        className="mt-1.5 text-[9px] font-mono text-muted-foreground/50 hover:text-muted-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3 inline" /> : <ChevronRight className="size-3 inline" />}
        {" "}{expanded ? "less" : "more"}
      </button>
    </div>
  );
}

export function MarketOpportunities({ candidates }: MarketOpportunitiesProps) {
  const [tab, setTab] = useState<"trading" | "investing">("trading");
  const [horizonIdx, setHorizonIdx] = useState(1); // default: Intraday / 1-3 Months
  const [showExcluded, setShowExcluded] = useState(false);

  const horizons = tab === "trading" ? TRADING_HORIZONS : INVESTOR_HORIZONS;
  const currentHorizon = horizons[horizonIdx]?.key ?? "INTRADAY";
  const result: UniversalRecommendationResult = generateRecommendation(candidates, currentHorizon, { maxResults: 10 });

  return (
    <Card className="border border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-mono font-semibold text-muted-foreground">
            <span className="text-primary/60">$</span> market-opportunities
          </h4>
          <Badge variant="outline" className="text-[9px] font-mono border-border/50">
            {result.rankedInstruments.length} ranked
          </Badge>
          {result.excludedInstruments.length > 0 && (
            <Badge variant="outline" className="text-[9px] font-mono border-border/50 text-muted-foreground/60">
              {result.excludedInstruments.length} excluded
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Tab switcher */}
        <div className="flex gap-1">
          <Button
            variant={tab === "trading" ? "default" : "ghost"}
            size="sm"
            className="text-[10px] font-mono h-7"
            onClick={() => { setTab("trading"); setHorizonIdx(1); }}
          >
            <TrendingUp className="size-3 mr-1" /> Trading
          </Button>
          <Button
            variant={tab === "investing" ? "default" : "ghost"}
            size="sm"
            className="text-[10px] font-mono h-7"
            onClick={() => { setTab("investing"); setHorizonIdx(1); }}
          >
            <ShieldCheck className="size-3 mr-1" /> Investing
          </Button>
        </div>

        {/* Horizon selector */}
        <div className="flex flex-wrap gap-1">
          {horizons.map((h, i) => (
            <button
              key={h.key}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[9px] font-mono transition-colors",
                i === horizonIdx
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted/20 text-muted-foreground border-border/50 hover:bg-muted/40"
              )}
              onClick={() => setHorizonIdx(i)}
            >
              {h.label}
            </button>
          ))}
        </div>

        {/* Market overview */}
        <p className="text-[10px] font-mono text-muted-foreground/70">{result.marketOverview}</p>

        {/* Ranked instruments */}
        {result.rankedInstruments.length > 0 ? (
          <div className="space-y-2">
            {result.rankedInstruments.map((item) => (
              <RankedCard key={item.instrument} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-muted/20 border border-border/30 p-4 text-center">
            <Filter className="size-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs font-mono text-muted-foreground">
              No suitable instruments found for {horizons[horizonIdx]?.label ?? currentHorizon}.
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/50 mt-1">
              Consider broadening data sources or adjusting the horizon.
            </p>
          </div>
        )}

        {/* Excluded instruments toggle */}
        {result.excludedInstruments.length > 0 && (
          <div>
            <button
              className="text-[9px] font-mono text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1"
              onClick={() => setShowExcluded(!showExcluded)}
            >
              <AlertTriangle className="size-3" />
              {showExcluded ? "Hide" : "Show"} excluded ({result.excludedInstruments.length})
            </button>
            {showExcluded && (
              <div className="mt-1 space-y-0.5">
                {result.excludedInstruments.map((e, i) => (
                  <p key={i} className="text-[9px] font-mono text-red-400/60">
                    {e.instrument}: {e.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[9px] font-mono text-muted-foreground/40 italic border-t border-border/30 pt-2">
          Recommendations are analytical rankings based on available evidence and are not guaranteed profit predictions.
          Confidence reflects analytical coherence, NOT probability of profit.
        </p>
      </CardContent>
    </Card>
  );
}
