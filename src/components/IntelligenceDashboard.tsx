/**
 * Phase 86 — Intelligence Dashboard
 *
 * Trader-facing display for multi-dimensional intelligence:
 * - News Intelligence
 * - Fundamental Intelligence
 * - Economic Events / Catalysts
 * - Evidence Hierarchy (PRIMARY / SECONDARY / CONTEXT)
 * - Scenarios (BASE / ALTERNATIVE / INVALIDATION / CATALYST)
 * - What Changed
 * - Analytical Summary
 *
 * Consumes structured intelligence from Phase 83-85 engines.
 * All data must come from real intelligence pipeline — no fabricated content.
 */

import React, { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { mapStance, mapPositionImpact, mapDirection, mapRelevance, mapAvailability, mapThesisHealth, mapConfidence, mapDimension, mapSensitivity, mapMarketState } from "@/lib/i18n/enum-mapping";
import {
  Newspaper,
  TrendingUp,
  Calendar,
  Layers,
  GitBranch,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  Shield,
  Zap,
  Info,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

import type { NewsSynthesis, NewsRelevance } from "@/lib/position-protection/news-intelligence";
import type { FundamentalSynthesis, CatalystAnalysis, FundamentalInterpretation } from "@/lib/position-protection/fundamental-intelligence";
import type { HierarchicalEvidence, ScenarioSynthesis, DimensionStatus, MultiDimensionalSynthesis } from "@/lib/position-protection/multi-dimensional-intelligence";
import type { PositionIntelligence } from "@/lib/position-protection/market-intelligence-analyzer";
import { HistoricalTimelineView } from "./HistoricalTimeline";
import type { HistoricalTimeline } from "@/lib/position-protection/historical-intelligence";

interface IntelligenceDashboardProps {
  /** Position intelligence from the pipeline. */
  intelligence?: PositionIntelligence | null;
  /** Multi-dimensional synthesis (news, fundamentals, scenarios, evidence). */
  multiDimensional?: MultiDimensionalSynthesis | null;
  /** Market context narrative. */
  marketContext?: { narrative?: string; regime?: string } | null;
  /** Analytical summary. */
  analyticalSummary?: string | null;
  /** What changed since last analysis. */
  whatChanged?: string[] | null | undefined;
  /** Position side for impact interpretation. */
  positionSide: "LONG" | "SHORT";
  /** Instrument. */
  instrument: string;
  /** Historical timeline. */
  historicalTimeline?: HistoricalTimeline | null;
}

// ═══════════════════════════════════════════════════════════════
// SECTION COMPONENTS
// ═══════════════════════════════════════════════════════════════

/** Collapsible section wrapper. */
function IntelSection({
  title,
  icon,
  children,
  available = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  available?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
        <span className="text-primary">{icon}</span>
        <span className="text-[10px] font-mono font-semibold text-foreground">{title}</span>
        {!available && (
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
            {t.intelligence.unavailableBadge}
          </span>
        )}
      </div>
      <div className="px-3 py-2 space-y-1">
        {available ? children : (
          <p className="text-[9px] font-mono text-muted-foreground/60">
            {t.intelligence.dataUnavailableMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NEWS INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

function NewsIntelligenceSection({ news }: { news: NewsSynthesis | null }) {
  const { t } = useI18n();
  const available = news !== null && news.availability !== "UNAVAILABLE";

  return (
    <IntelSection title={t.intelligence.newsIntelligence} icon={<Newspaper className="size-3" />} available={available}>
      {!available ? null : (
        <>
          {/* News stance */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
              news!.newsStance === "SUPPORTING" ? "text-emerald-400 bg-emerald-500/10" :
              news!.newsStance === "CONFLICTING" ? "text-red-400 bg-red-500/10" :
              news!.newsStance === "MIXED" ? "text-amber-400 bg-amber-500/10" :
              "text-muted-foreground bg-muted/30"
            }`}>
              {mapStance(news!.newsStance, t)}
            </span>
            <span className="text-[8px] font-mono text-muted-foreground/60">
              {news!.supportingCount} {t.intelligence.supporting} · {news!.conflictingCount} {t.intelligence.conflicting}
            </span>
          </div>
          <p className="text-[9px] font-mono text-muted-foreground/80 leading-relaxed">
            {news!.description}
          </p>
          {/* Relevant items */}
          {news!.relevantItems.length > 0 && (
            <div className="space-y-1 mt-1.5">
              {news!.relevantItems.slice(0, 5).map((item, i) => (
                <NewsItemCard key={i} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </IntelSection>
  );
}

function NewsItemCard({ item }: { item: NewsRelevance }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 bg-muted/20 rounded text-[8px] font-mono">
      <span className={`mt-0.5 size-1.5 rounded-full shrink-0 ${
        item.positionImpact === "SUPPORTING" ? "bg-emerald-400" :
        item.positionImpact === "CONFLICTING" ? "bg-red-400" :
        "bg-muted-foreground/40"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-foreground/80 truncate">{item.reason}</div>
        <div className="text-muted-foreground/60 mt-0.5">
          {t.intelligence.relevanceLabel} {mapRelevance(item.relevance, t)} · {t.intelligence.impactLabel} {mapPositionImpact(item.positionImpact, t)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

function FundamentalIntelligenceSection({ fundamentals }: { fundamentals: FundamentalSynthesis | null }) {
  const { t } = useI18n();
  const available = fundamentals !== null && fundamentals.availability !== "UNAVAILABLE";

  return (
    <IntelSection title={t.intelligence.fundamentals} icon={<TrendingUp className="size-3" />} available={available}>
      {!available ? null : (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
              fundamentals!.fundamentalStance === "SUPPORTING" ? "text-emerald-400 bg-emerald-500/10" :
              fundamentals!.fundamentalStance === "CONFLICTING" ? "text-red-400 bg-red-500/10" :
              fundamentals!.fundamentalStance === "MIXED" ? "text-amber-400 bg-amber-500/10" :
              "text-muted-foreground bg-muted/30"
            }`}>
              {mapStance(fundamentals!.fundamentalStance, t)}
            </span>
            <span className="text-[8px] font-mono text-muted-foreground/60">
              {fundamentals!.supportingCount} {t.intelligence.supporting} · {fundamentals!.conflictingCount} {t.intelligence.conflicting}
            </span>
          </div>
          <p className="text-[9px] font-mono text-muted-foreground/80 leading-relaxed">
            {fundamentals!.description}
          </p>
          {/* Fundamental data points */}
          {fundamentals!.interpretations.length > 0 && (
            <div className="space-y-1 mt-1.5">
              {fundamentals!.interpretations.slice(0, 5).map((interp, i) => (
                <FundamentalCard key={i} interp={interp} />
              ))}
            </div>
          )}
          {/* Catalyst */}
          {fundamentals!.catalyst && fundamentals!.catalyst.status !== "NO_MATERIAL_CATALYST" && (
            <div className="mt-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/20 rounded">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Zap className="size-2.5 text-amber-400" />
                <span className="text-[9px] font-mono font-semibold text-amber-400">{t.intelligence.catalyst}</span>
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                  fundamentals!.catalyst.positionSensitivity === "HIGH" ? "bg-amber-500/20 text-amber-400" :
                  "bg-muted/30 text-muted-foreground"
                }`}>
                  {mapSensitivity(fundamentals!.catalyst.positionSensitivity, t)} {t.intelligence.sensitivity}
                </span>
              </div>
              <p className="text-[8px] font-mono text-muted-foreground/80">
                {fundamentals!.catalyst.description}
              </p>
            </div>
          )}
        </>
      )}
    </IntelSection>
  );
}

function FundamentalCard({ interp }: { interp: FundamentalInterpretation }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 bg-muted/20 rounded text-[8px] font-mono">
      <span className={`mt-0.5 size-1.5 rounded-full shrink-0 ${
        interp.positionImpact === "SUPPORTING" ? "bg-emerald-400" :
        interp.positionImpact === "CONFLICTING" ? "bg-red-400" :
        "bg-muted-foreground/40"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-foreground/80">{interp.dataPoint.metric}: {String(interp.dataPoint.value)}</div>
        <div className="text-muted-foreground/60 mt-0.5">{interp.interpretation}</div>
      </div>
      <span className={`text-[7px] font-mono px-1 py-0.5 rounded ${
        interp.positionImpact === "SUPPORTING" ? "text-emerald-400 bg-emerald-500/10" :
        interp.positionImpact === "CONFLICTING" ? "text-red-400 bg-red-500/10" :
        "text-muted-foreground bg-muted/30"
      }`}>
        {mapPositionImpact(interp.positionImpact, t)}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE HIERARCHY
// ═══════════════════════════════════════════════════════════════

function EvidenceHierarchySection({ evidence }: { evidence: HierarchicalEvidence[] }) {
  const { t } = useI18n();
  const primary = evidence.filter(e => e.tier === t.intelligence.primary);
  const secondary = evidence.filter(e => e.tier === t.intelligence.secondary);
  const context = evidence.filter(e => e.tier === t.intelligence.contextLabel);

  const hasEvidence = primary.length > 0 || secondary.length > 0 || context.length > 0;
  const totalSupporting = evidence.filter(e => e.direction === "SUPPORTING").length;
  const totalConflicting = evidence.filter(e => e.direction === "CONFLICTING").length;

  return (
    <IntelSection title={t.intelligence.evidenceHierarchy} icon={<Layers className="size-3" />} available={hasEvidence}>
      {!hasEvidence ? (
        <p className="text-[9px] font-mono text-muted-foreground/60">{t.intelligence.noEvidence}</p>
      ) : (
        <>
        {/* Evidence Summary Bar */}
        {(totalSupporting > 0 || totalConflicting > 0) && (
          <div className="flex items-center gap-2 text-[8px] font-mono mb-1.5">
            <span className="text-emerald-400/80">{totalSupporting} {t.intelligence.supporting}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-red-400/80">{totalConflicting} {t.intelligence.conflicting}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/60">{evidence.length} total</span>
          </div>
        )}
        <div className="space-y-2">
          {primary.length > 0 && (
            <EvidenceTier label={t.intelligence.primary} items={primary} color="text-amber-400" />
          )}
          {secondary.length > 0 && (
            <EvidenceTier label={t.intelligence.secondary} items={secondary} color="text-blue-400" />
          )}
          {context.length > 0 && (
            <EvidenceTier label={t.intelligence.contextLabel} items={context} color="text-muted-foreground" />
          )}
        </div>
        </>
      )}
    </IntelSection>
  );
}

function EvidenceTier({
  label,
  items,
  color,
}: {
  label: string;
  items: HierarchicalEvidence[];
  color: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className={`text-[8px] font-mono font-semibold ${color} mb-0.5`}>{label}</div>
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[8px] font-mono px-1.5 py-0.5">
            <span className={`size-1 rounded-full shrink-0 ${
              item.direction === "SUPPORTING" ? "bg-emerald-400" :
              item.direction === "CONFLICTING" ? "bg-red-400" :
              "bg-muted-foreground/40"
            }`} />
            <span className="text-foreground/70">{item.description}</span>
            <span className={`text-[7px] ml-auto ${
              item.direction === "SUPPORTING" ? "text-emerald-400/60" :
              item.direction === "CONFLICTING" ? "text-red-400/60" :
              "text-muted-foreground/40"
            }`}>
              {mapDirection(item.direction, t)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════════

function ScenariosSection({ scenarios }: { scenarios: ScenarioSynthesis }) {
  const { t } = useI18n();
  return (
    <IntelSection title={t.intelligence.scenarios} icon={<GitBranch className="size-3" />}>
      <div className="space-y-2">
        <ScenarioCard
          label={t.intelligence.baseCase}
          scenario={scenarios.baseCase}
          color="text-emerald-400"
          bgColor="bg-emerald-500/5 border-emerald-500/20"
        />
        <ScenarioCard
          label={t.intelligence.alternative}
          scenario={scenarios.alternativeCase}
          color="text-amber-400"
          bgColor="bg-amber-500/5 border-amber-500/20"
        />
        <ScenarioCard
          label={t.intelligence.invalidationScenario}
          scenario={scenarios.invalidationCase}
          color="text-red-400"
          bgColor="bg-red-500/5 border-red-500/20"
        />
      </div>
    </IntelSection>
  );
}

function ScenarioCard({
  label,
  scenario,
  color,
  bgColor,
}: {
  label: string;
  scenario: { label: string; description: string; conditions: string[] };
  color: string;
  bgColor: string;
}) {
  return (
    <div className={`px-2 py-1.5 border rounded ${bgColor}`}>
      <div className={`text-[9px] font-mono font-semibold ${color} mb-0.5`}>{label}</div>
      <p className="text-[8px] font-mono text-foreground/70 leading-relaxed">{scenario.description}</p>
      {scenario.conditions.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {scenario.conditions.map((c, i) => (
            <div key={i} className="text-[7px] font-mono text-muted-foreground/60 flex items-start gap-1">
              <span className="text-muted-foreground/40 mt-px">•</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WHAT CHANGED
// ═══════════════════════════════════════════════════════════════

function WhatChangedSection({ changes }: { changes: string[] | null | undefined }) {
  const { t } = useI18n();
  const hasChanges = changes != null && changes.length > 0;

  return (
    <IntelSection title={t.intelligence.whatChanged} icon={<RefreshCw className="size-3" />} available={hasChanges || changes === null}>
      {changes === null ? (
        <p className="text-[9px] font-mono text-muted-foreground/60">{t.intelligence.awaitingFirstAnalysis}</p>
      ) : !hasChanges ? (
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-emerald-400/70">
          <CheckCircle className="size-2.5" />
          {t.intelligence.noMaterialChange}
        </div>
      ) : (
        <div className="space-y-1">
          {changes.map((change, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[8px] font-mono px-1.5 py-0.5 bg-amber-500/5 rounded">
              <span className="text-amber-400 mt-px shrink-0">↻</span>
              <span className="text-foreground/70">{change}</span>
            </div>
          ))}
        </div>
      )}
    </IntelSection>
  );
}

// ═══════════════════════════════════════════════════════════════
// MULTI-DIMENSIONAL STATUS
// ═══════════════════════════════════════════════════════════════

function DimensionStatusPanel({ dimensions }: { dimensions: DimensionStatus[] }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {dimensions.map((dim, i) => (
        <span
          key={i}
          className={`text-[7px] font-mono px-1.5 py-0.5 rounded ${
            dim.availability === "AVAILABLE" ? "text-emerald-400 bg-emerald-500/10" :
            dim.availability === "LIMITED" ? "text-amber-400 bg-amber-500/10" :
            dim.availability === "INSUFFICIENT" ? "text-orange-400 bg-orange-500/10" :
            "text-muted-foreground bg-muted/30"
          }`}
          title={dim.description}
        >
          {mapDimension(dim.dimension, t)}: {mapAvailability(dim.availability, t)}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICAL SUMMARY
// ═══════════════════════════════════════════════════════════════

function AnalyticalSummarySection({
  intelligence,
  instrument,
  side,
}: {
  intelligence?: PositionIntelligence | null;
  instrument: string;
  side: "LONG" | "SHORT";
}) {
  if (!intelligence) return null;

  const { t } = useI18n();
  const thesisLabel = intelligence.thesisHealth ?? "UNKNOWN";
  const thesisColor =
    thesisLabel === "HEALTHY" || thesisLabel === "STABLE" ? "text-emerald-400" :
    thesisLabel === "DETERIORATING" ? "text-amber-400" :
    thesisLabel === "SEVERELY_DETERIORATING" ? "text-orange-400" :
    thesisLabel === "INVALIDATED" ? "text-red-400" :
    "text-muted-foreground";

  const actionColor =
    intelligence.actionRecommendation.includes("NO_TRADE") || intelligence.actionRecommendation.includes("WAIT") ? "text-amber-400" :
    intelligence.actionRecommendation.includes("WATCH") ? "text-blue-400" :
    "text-emerald-400";

  return (
    <IntelSection title={t.intelligence.analyticalSummary} icon={<Target className="size-3" />}>
      <div className="space-y-1.5">
        {/* Market */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.marketLabel}</span>
          <span className="text-foreground/80">{mapMarketState(intelligence.marketState, t)}</span>
        </div>
        {/* Position */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.positionLabel}</span>
          <span className="text-foreground/80">{side} {instrument}</span>
        </div>
        {/* Thesis */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.thesisLabel}</span>
          <span className={`font-semibold ${thesisColor}`}>{mapThesisHealth(thesisLabel, t)}</span>
        </div>
        {/* Action Recommendation */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.actionLabel}: </span>
          <span className={`font-semibold ${actionColor}`}>{intelligence.actionRecommendation.replace(/_/g, " ")}</span>
        </div>
        {/* Why */}
        <div className="text-[9px] font-mono leading-relaxed">
          <span className="text-muted-foreground/60">{t.intelligence.whyLabel}</span>
          <span className="text-foreground/70">{intelligence.shortTermContext}</span>
        </div>
        {/* Confidence */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.confidenceLabel}</span>
          <span className="text-foreground/70">
            {mapConfidence(intelligence.confidence, t)}
          </span>
        </div>
        {/* Evidence Summary */}
        {intelligence.evidence.length > 0 && (
          <div className="text-[9px] font-mono">
            <span className="text-muted-foreground/60">{t.intelligence.evidenceSummaryLabel}: </span>
            <span className="text-emerald-400/80">{intelligence.evidence.filter(e => e.direction === "supporting").length} {t.intelligence.supporting}</span>
            <span className="text-muted-foreground/40"> · </span>
            <span className="text-red-400/80">{intelligence.evidence.filter(e => e.direction === "conflicting").length} {t.intelligence.conflicting}</span>
          </div>
        )}
        {/* Data Quality */}
        <div className="text-[9px] font-mono">
          <span className="text-muted-foreground/60">{t.intelligence.dataQualityLabel}: </span>
          <span className="text-foreground/70">{intelligence.observationCount} {t.intelligence.observationCount}</span>
        </div>
        {/* Pullback Classification */}
        {intelligence.pullbackClassification !== "NORMAL_PULLBACK" && intelligence.pullbackClassification !== "INSUFFICIENT_DATA" && (
          <div className="text-[9px] font-mono">
            <span className="text-muted-foreground/60">{t.intelligence.pullbackLabel}: </span>
            <span className="text-amber-400/80">{
              intelligence.pullbackClassification === "EARLY_CORRECTION" ? t.intelligence.pullbackEarlyCorrection :
              intelligence.pullbackClassification === "MEANINGFUL_DETERIORATION" ? t.intelligence.pullbackDeterioration :
              intelligence.pullbackClassification === "STRUCTURAL_REVERSAL" ? t.intelligence.pullbackStructuralReversal :
              intelligence.pullbackClassification === "SHOCK_REVERSAL" ? t.intelligence.pullbackShockReversal :
              String(intelligence.pullbackClassification).replace(/_/g, " ")
            }</span>
          </div>
        )}
        {/* Invalidation (all) */}
        {intelligence.invalidationConditions.length > 0 && (
          <div className="text-[9px] font-mono space-y-0.5">
            <span className="text-red-400/60">{t.intelligence.invalidationLabel}</span>
            {intelligence.invalidationConditions.map((cond, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-red-400/40 mt-px">•</span>
                <span className="text-foreground/70">{cond.description}</span>
                {cond.approaching && <span className="text-red-400/60">⚠</span>}
              </div>
            ))}
          </div>
        )}
        {/* Watch Next (all) */}
        {intelligence.nextMonitor.length > 0 && (
          <div className="text-[9px] font-mono space-y-0.5">
            <span className="text-blue-400/60">{t.intelligence.watchLabel}</span>
            {intelligence.nextMonitor.map((item, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-blue-400/40 mt-px">•</span>
                <span className="text-foreground/70">{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </IntelSection>
  );
}

// ═══════════════════════════════════════════════════════════════
// KEY LEVELS (from intelligence)
// ═══════════════════════════════════════════════════════════════

function KeyLevelsSection({ intelligence, side, instrument }: { intelligence?: PositionIntelligence | null; side: "LONG" | "SHORT"; instrument: string }) {
  const { t } = useI18n();
  if (!intelligence) return null;

  const isLong = intelligence.side === "LONG";
  return (
    <IntelSection title={t.intelligence.keyLevelsLabel} icon={<Shield className="size-3" />}>
      <div className="space-y-1 text-[8px] font-mono">
        {/* Position Metrics */}
        <div className="flex justify-between">
          <span className="text-muted-foreground/60">{t.intelligence.positionMetricsLabel}</span>
          <span className="text-foreground/70">{side} {instrument}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/60">{t.trader.entry}</span>
          <span className="text-foreground/70">{intelligence.entryPrice}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground/60">{t.trader.current}</span>
          <span className="text-foreground/70">{intelligence.currentPrice}</span>
        </div>
        {intelligence.pnlPct !== 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">{t.trader.pnl}</span>
            <span className={intelligence.pnlPct > 0 ? "text-emerald-400" : "text-red-400"}>{intelligence.pnlPct > 0 ? "+" : ""}{intelligence.pnlPct.toFixed(2)}%</span>
          </div>
        )}
        {intelligence.stopLoss !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">{t.trader.sl}</span>
            <span className="text-red-400/80">{intelligence.stopLoss}</span>
          </div>
        )}
        {intelligence.takeProfit !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">{t.trader.tp}</span>
            <span className="text-emerald-400/80">{intelligence.takeProfit}</span>
          </div>
        )}
        {intelligence.rMultiple !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">R-Multiple</span>
            <span className="text-foreground/70">{intelligence.rMultiple.toFixed(2)}R</span>
          </div>
        )}
        {/* Invalidation conditions */}
        {intelligence.invalidationConditions.length > 0 && (
          <>
            <div className="border-t border-border/30 my-1" />
            {intelligence.invalidationConditions.map((cond, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-red-400/60">{t.intelligence.invalidation}</span>
                <span className="text-foreground/70">{cond.description}</span>
              </div>
            ))}
          </>
        )}
        {/* Watch items */}
        {intelligence.nextMonitor.length > 0 && (
          <>
            <div className="border-t border-border/30 my-1" />
            {intelligence.nextMonitor.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-blue-400/60">{t.intelligence.nextLevel}</span>
                <span className="text-foreground/70">{item}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </IntelSection>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════

export function IntelligenceDashboard({
  intelligence,
  multiDimensional,
  marketContext,
  analyticalSummary,
  whatChanged,
  positionSide,
  instrument,
  historicalTimeline,
}: IntelligenceDashboardProps) {
  return (
    <div className="space-y-2">
      {/* Dimension Status Bar */}
      {multiDimensional && (
        <DimensionStatusPanel dimensions={multiDimensional.dimensions} />
      )}

      {/* Analytical Summary — most prominent */}
      <AnalyticalSummarySection
        intelligence={intelligence}
        instrument={instrument}
        side={positionSide}
      />

      {/* What Changed */}
      <WhatChangedSection changes={whatChanged} />

      {/* Evidence Hierarchy */}
      {multiDimensional && (
        <EvidenceHierarchySection evidence={multiDimensional.evidence} />
      )}

      {/* Scenarios */}
      {multiDimensional && (
        <ScenariosSection scenarios={multiDimensional.scenarios} />
      )}

      {/* News Intelligence */}
      <NewsIntelligenceSection news={multiDimensional?.news ?? null} />

      {/* Fundamental Intelligence */}
      <FundamentalIntelligenceSection fundamentals={multiDimensional?.fundamentals ?? null} />

      {/* Key Levels */}
      <KeyLevelsSection intelligence={intelligence} side={positionSide} instrument={instrument} />

      {/* Historical Intelligence Timeline */}
      {historicalTimeline && (
        <HistoricalTimelineView timeline={historicalTimeline} />
      )}
    </div>
  );
}
