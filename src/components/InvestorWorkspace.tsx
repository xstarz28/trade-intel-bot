/**
 * Phase 121 — Investor Workspace
 *
 * Dedicated long-horizon portfolio intelligence view.
 * Complementary to TraderWorkspace (active trading, position-level).
 *
 * Focuses on:
 * - Portfolio-level thesis health across all positions
 * - Macro/inflation context from fundamental data
 * - Investment-grade opportunities (1–3 year emphasis)
 * - Risk attribution and data quality
 *
 * Phase 139 — per-position thesis intelligence.
 * InvestorWorkspace now consumes the SAME per-position intelligence map the
 * protection dashboard derives (usePositionIntelligence → the single
 * derivation path). Each position card shows ONLY its own intelligence
 * record (strict positionId association) — never a sibling's.
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */
import React, { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import {
  mapSeverity,
  mapRiskLevel,
  mapHorizon,
  mapThesisHealth,
  mapConfidence,
  mapMarketState,
  mapAvailability,
  mapDecisionState,
  mapCoverage,
  mapMonitorState,
  mapFreshness,
} from "@/lib/i18n/enum-mapping";
import {
  Briefcase,
  Shield,
  AlertTriangle,
  Eye,
  BarChart3,
  Activity,
  Layers,
  Brain,
  Globe,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge,
} from "lucide-react";
import { usePositionProtection } from "@/lib/position-protection/use-position-protection";
import { usePositionIntelligence } from "@/lib/position-protection/use-position-intelligence";
import { useMacroContextData } from "@/lib/position-protection/use-macro-context-data";
import {
  associateInvestorIntelligence,
  classifyIntelAvailability,
  type InvestorIntelRow,
} from "@/lib/position-protection/investor-intelligence-view";
import {
  buildInvestorMacroContext,
  type InvestorMacroContext,
  type MacroQuoteView,
} from "@/lib/position-protection/investor-macro-context";
import {
  buildInvestorDecisionSynthesis,
  type InvestorDecisionSynthesis,
} from "@/lib/position-protection/investor-decision-synthesis";
import {
  buildInvestorPortfolioSummary,
  type InvestorPortfolioSummary,
} from "@/lib/position-protection/investor-portfolio-summary";
import {
  buildInvestorMonitorState,
  type InvestorMonitorState,
  type MonitorReasonCode,
} from "@/lib/position-protection/investor-portfolio-monitor";
import {
  formatInstrumentPrice,
  getInstrumentInfo,
} from "@/lib/position-protection/instrument-registry";

// ═══════════════════════════════════════════════════════════════
// SECTION COMPONENT
// ═══════════════════════════════════════════════════════════════

function Section({
  title,
  icon,
  children,
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/50 bg-card/50 p-3 ${className}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-[10px] font-mono font-semibold text-foreground tracking-wide">
          {title}
        </h4>
      </div>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATE COLORS
// ═══════════════════════════════════════════════════════════════

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  STABLE: "text-emerald-400",
  CAUTION: "text-amber-400",
  DETERIORATING: "text-orange-400",
  SEVERELY_DETERIORATING: "text-red-400",
  INVALIDATED: "text-red-400",
  INSUFFICIENT_DATA: "text-muted-foreground",
  UNKNOWN: "text-muted-foreground",
};

const SEVERITY_COLORS: Record<string, string> = {
  NONE: "text-emerald-400 bg-emerald-500/10",
  WATCH: "text-blue-400 bg-blue-500/10",
  CAUTION: "text-amber-400 bg-amber-500/10",
  HIGH_RISK: "text-orange-400 bg-orange-500/10",
  INVALIDATED: "text-red-400 bg-red-500/10",
};

const THESIS_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400 bg-emerald-500/10",
  STABLE: "text-blue-400 bg-blue-500/10",
  CAUTION: "text-amber-400 bg-amber-500/10",
  DETERIORATING: "text-orange-400 bg-orange-500/10",
  SEVERELY_DETERIORATING: "text-red-400 bg-red-500/10",
  INVALIDATED: "text-red-400 bg-red-500/15 border border-red-500/30",
  INSUFFICIENT_DATA: "text-muted-foreground bg-muted/30",
  UNKNOWN: "text-muted-foreground bg-muted/30",
};

const DATA_STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "text-emerald-400 bg-emerald-500/10",
  LIMITED: "text-amber-400 bg-amber-500/10",
  INSUFFICIENT: "text-red-400 bg-red-500/10",
  UNAVAILABLE: "text-muted-foreground bg-muted/30",
};

const TREASURY_FRESH_COLORS: Record<string, string> = {
  FRESH: "text-emerald-400 bg-emerald-500/10",
  DELAYED: "text-amber-400 bg-amber-500/10",
  STALE: "text-red-400 bg-red-500/10",
};

const DECISION_STATE_COLORS: Record<string, string> = {
  ALIGNED: "text-emerald-400 bg-emerald-500/10",
  CONFLICT: "text-red-400 bg-red-500/10",
  CAUTION: "text-amber-400 bg-amber-500/10",
  INSUFFICIENT_DATA: "text-muted-foreground bg-muted/30",
  UNAVAILABLE: "text-muted-foreground bg-muted/30",
};

const MACRO_STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "text-emerald-400 bg-emerald-500/10",
  LIMITED: "text-blue-400 bg-blue-500/10",
  STALE: "text-amber-400 bg-amber-500/10",
  UNAVAILABLE: "text-muted-foreground bg-muted/30",
};

const MONITOR_STATE_COLORS: Record<string, string> = {
  IDLE: "text-muted-foreground bg-muted/30",
  STABLE: "text-emerald-400 bg-emerald-500/10",
  WATCH: "text-amber-400 bg-amber-500/10",
  ELEVATED: "text-orange-400 bg-orange-500/10",
  SEVERE: "text-red-400 bg-red-500/10",
};

// ═══════════════════════════════════════════════════════════════
// INVESTOR DECISION CONTEXT (Phase 141)
// ═══════════════════════════════════════════════════════════════
// Deterministic categorical summary of THIS position's evidence picture.
// The synthesis never computes new market metrics — chips below simply
// surface its state + the domain states it was derived from.

function DecisionChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="flex items-center gap-1 text-[8px] font-mono text-muted-foreground/60">
      {label}:{" "}
      <span className={`px-1.5 py-0.5 rounded font-semibold ${color ?? "text-muted-foreground bg-muted/30"}`}>
        {value}
      </span>
    </span>
  );
}

function SynthesisRow({ row, synthesis }: { row: InvestorIntelRow; synthesis: InvestorDecisionSynthesis }) {
  const { t } = useI18n();
  const info = getInstrumentInfo(row.instrument);
  const macroOutOfAlignment =
    synthesis.macro.status !== "AVAILABLE" || synthesis.macro.globalCaution;

  return (
    <div className="border border-border/30 rounded-lg p-3 space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-mono font-bold text-foreground">
          {info?.displayName ?? row.instrument}
        </span>
        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
          row.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {row.side}
        </span>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
          {mapHorizon(row.horizon, t)}
        </span>
        {/* Overall deterministic state — visually dominant chip */}
        <span className={`ml-auto text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
          DECISION_STATE_COLORS[synthesis.state] ?? "text-muted-foreground bg-muted/30"
        }`}>
          {mapDecisionState(synthesis.state, t).replace(/_/g, " ")}
        </span>
      </div>

      {/* Domain decomposition (existing states — never merged away) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DecisionChip
          label={t.decision.thesisHealth}
          value={mapThesisHealth(synthesis.thesis.health, t).replace(/_/g, " ")}
          color={THESIS_COLORS[synthesis.thesis.health] ?? "text-muted-foreground bg-muted/30"}
        />
        <DecisionChip
          label={t.intelligence.riskProtectionLabel}
          value={mapSeverity(synthesis.protection.severity, t).replace(/_/g, " ")}
          color={SEVERITY_COLORS[synthesis.protection.severity] ?? "text-muted-foreground bg-muted/30"}
        />
        {/* Global macro chip only when it affects the picture (avoids noise) */}
        {macroOutOfAlignment && (
          <DecisionChip
            label={t.intelligence.macroContextLabel}
            value={
              synthesis.macro.globalCaution
                ? mapDecisionState("CAUTION", t)
                : mapAvailability(synthesis.macro.status, t)
            }
            color={
              synthesis.macro.globalCaution
                ? MACRO_STATUS_COLORS.STALE
                : MACRO_STATUS_COLORS[synthesis.macro.status] ?? "text-muted-foreground bg-muted/30"
            }
          />
        )}
        {row.intel && (
          <DecisionChip
            label={t.intelligence.dataQualityLabel}
            value={mapAvailability(classifyIntelAvailability(row.intel), t)}
            color={
              DATA_STATUS_COLORS[classifyIntelAvailability(row.intel)] ?? "text-muted-foreground bg-muted/30"
            }
          />
        )}
      </div>

      {/* Deterministic conflict cue — strictly from the decision table */}
      {synthesis.state === "CONFLICT" && (
        <div className="flex items-center gap-1.5 text-[8px] font-mono">
          <AlertTriangle className="size-3 text-red-400/80" />
          <span className="text-red-400/90">
            {t.investor.decisionStateConflict}: {mapThesisHealth(synthesis.thesis.health, t).replace(/_/g, " ")} / {mapSeverity(synthesis.protection.severity, t).replace(/_/g, " ")}
          </span>
        </div>
      )}
    </div>
  );
}

function DecisionContextSection({ rows }: { rows: { row: InvestorIntelRow; synthesis: InvestorDecisionSynthesis }[] }) {
  const { t } = useI18n();
  const anyGlobalCaution = rows.some((r) => r.synthesis.macro.globalCaution);
  return (
    <Section title={t.investor.decisionContext} icon={<Gauge className="size-3" />}>
      {anyGlobalCaution && (
        <div className="flex items-center gap-1.5 text-[8px] font-mono text-amber-400/90 mb-2">
          <Globe className="size-3" />
          {t.investor.macroScopeNote}
        </div>
      )}
      <div className="space-y-2">
        {rows.map(({ row, synthesis }) => (
          <SynthesisRow key={row.positionId} row={row} synthesis={synthesis} />
        ))}
      </div>
      <p className="text-[8px] font-mono text-muted-foreground/40 mt-2">
        {t.investor.decisionInfo}
      </p>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO MONITOR (Phase 144)
// ═══════════════════════════════════════════════════════════════
// Deterministic categorical watch state over the Phase 143 summary + the
// Phase 141 syntheses. Reads existing aggregated states only — never
// recalculates, never recommends, never touches the alert pipeline.

const MONITOR_REASON_COLORS: Record<MonitorReasonCode, string> = {
  NO_POSITIONS: "text-muted-foreground bg-muted/30",
  INVALIDATED: "text-red-400 bg-red-500/10",
  PORTFOLIO_CONFLICT: "text-red-400 bg-red-500/10",
  HIGH_RISK_PROTECTION: "text-orange-400 bg-orange-500/10",
  CAUTION_POSITIONS: "text-amber-400 bg-amber-500/10",
  INSUFFICIENT_DATA: "text-muted-foreground bg-muted/30",
  UNAVAILABLE_INTEL: "text-muted-foreground bg-muted/30",
  PARTIAL_COVERAGE: "text-amber-400 bg-amber-500/10",
  GLOBAL_MACRO_CAUTION: "text-amber-400 bg-amber-500/10",
  MACRO_STALE: "text-amber-400 bg-amber-500/10",
  MACRO_LIMITED: "text-blue-400 bg-blue-500/10",
  MACRO_UNAVAILABLE: "text-muted-foreground bg-muted/30",
  CONCENTRATION: "text-sky-400 bg-sky-500/10",
};

function monitorReasonLabel(code: MonitorReasonCode, t: ReturnType<typeof useI18n>["t"]): string {
  switch (code) {
    case "NO_POSITIONS": return t.investor.monitorReasonNoPositions;
    case "INVALIDATED": return t.investor.monitorReasonInvalidated;
    case "PORTFOLIO_CONFLICT": return t.investor.monitorReasonConflict;
    case "HIGH_RISK_PROTECTION": return t.investor.monitorReasonHighRisk;
    case "CAUTION_POSITIONS": return t.investor.monitorReasonCaution;
    case "INSUFFICIENT_DATA": return t.investor.monitorReasonInsufficientData;
    case "UNAVAILABLE_INTEL": return t.investor.monitorReasonUnavailable;
    case "PARTIAL_COVERAGE": return t.investor.monitorReasonPartialCoverage;
    case "GLOBAL_MACRO_CAUTION": return t.investor.monitorReasonMacroCaution;
    case "MACRO_STALE": return t.investor.monitorReasonMacroStale;
    case "MACRO_LIMITED": return t.investor.monitorReasonMacroLimited;
    case "MACRO_UNAVAILABLE": return t.investor.monitorReasonMacroUnavailable;
    case "CONCENTRATION": return t.investor.monitorReasonConcentration;
    default: return String(code).replace(/_/g, " ");
  }
}

function PortfolioMonitorStrip({ monitor }: { monitor: InvestorMonitorState }) {
  const { t } = useI18n();
  const stateLabel = mapMonitorState(monitor.state, t);

  return (
    <Section title={t.investor.monitorSummary} icon={<Eye className="size-3" />}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <span className="text-[8px] font-mono text-muted-foreground/60">
          {t.investor.monitorStateLabel}:
        </span>
        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
          MONITOR_STATE_COLORS[monitor.state] ?? "text-muted-foreground bg-muted/30"
        }`}>
          {stateLabel}
        </span>
      </div>

      {/* Deterministic reasons — each grounded in an existing aggregated field */}
      <div className="flex flex-wrap items-center gap-1.5">
        {monitor.reasons.map((r) => (
          <span
            key={r.code}
            className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
              MONITOR_REASON_COLORS[r.code] ?? "text-muted-foreground bg-muted/30"
            }`}
          >
            {monitorReasonLabel(r.code, t)}
            {r.count > 0 ? ` · ${r.count}` : ""}
          </span>
        ))}
      </div>

      <p className="text-[8px] font-mono text-muted-foreground/40 mt-2">
        {t.investor.monitorInfo}
      </p>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO-LEVEL SUMMARY (Phase 143)
// ═══════════════════════════════════════════════════════════════
// Deterministic categorical aggregation of the EXISTING per-position
// decision syntheses. Counts only — no percentages, no new analysis.

function PortfolioSummarySection({ summary }: { summary: InvestorPortfolioSummary }) {
  const { t } = useI18n();

  const stateChips: Array<{ label: string; count: number; color?: string }> = [
    { label: mapDecisionState("ALIGNED", t), count: summary.stateCounts.aligned, color: DECISION_STATE_COLORS.ALIGNED },
    { label: mapDecisionState("CONFLICT", t), count: summary.stateCounts.conflict, color: DECISION_STATE_COLORS.CONFLICT },
    { label: mapDecisionState("CAUTION", t), count: summary.stateCounts.caution, color: DECISION_STATE_COLORS.CAUTION },
    { label: mapDecisionState("INSUFFICIENT_DATA", t), count: summary.stateCounts.insufficientData, color: DECISION_STATE_COLORS.INSUFFICIENT_DATA },
    { label: mapDecisionState("UNAVAILABLE", t), count: summary.stateCounts.unavailable, color: DECISION_STATE_COLORS.UNAVAILABLE },
  ].filter((c) => c.count > 0);

  const severityChips: Array<{ label: string; count: number; color?: string }> = [
    { label: mapSeverity("NONE", t), count: summary.protectionCounts.none, color: SEVERITY_COLORS.NONE },
    { label: mapSeverity("WATCH", t), count: summary.protectionCounts.watch, color: SEVERITY_COLORS.WATCH },
    { label: mapSeverity("CAUTION", t), count: summary.protectionCounts.caution, color: SEVERITY_COLORS.CAUTION },
    { label: mapSeverity("HIGH_RISK", t), count: summary.protectionCounts.highRisk, color: SEVERITY_COLORS.HIGH_RISK },
    { label: mapSeverity("INVALIDATED", t), count: summary.protectionCounts.invalidated, color: SEVERITY_COLORS.INVALIDATED },
  ].filter((c) => c.count > 0);

  return (
    <Section title={t.investor.portfolioSummary} icon={<Layers className="size-3" />}>
      {/* Dominant categorical portfolio state */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[8px] font-mono text-muted-foreground/60">
          {t.investor.portfolioState}:
        </span>
        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
          DECISION_STATE_COLORS[summary.state] ?? "text-muted-foreground bg-muted/30"
        }`}>
          {mapDecisionState(summary.state, t).replace(/_/g, " ")}
        </span>
        {/* Coverage — derived only from usable-intelligence share */}
        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
          summary.coverage === "FULL"
            ? DATA_STATUS_COLORS.AVAILABLE
            : summary.coverage === "PARTIAL"
              ? DATA_STATUS_COLORS.LIMITED
              : DATA_STATUS_COLORS.UNAVAILABLE
        }`}>
          {mapCoverage(summary.coverage, t)}
        </span>
        {summary.globalMacroCaution && (
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded text-amber-400 bg-amber-500/10">
            <Globe className="size-3 inline mr-1" />
            {t.investor.globalMacroCaution}
          </span>
        )}
      </div>

      {/* Decision-state counts (direct aggregation — never percentages) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {stateChips.map((c) => (
          <span key={c.label} className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${c.color ?? "text-muted-foreground bg-muted/30"}`}>
            {c.label} · {c.count}
          </span>
        ))}
      </div>

      {/* Protection-risk counts (existing severities, verbatim) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[8px] font-mono text-muted-foreground/60">
        <span>{t.intelligence.riskProtectionLabel}:</span>
        {severityChips.map((c) => (
          <span key={c.label} className={`px-1.5 py-0.5 rounded font-semibold ${c.color ?? "text-muted-foreground bg-muted/30"}`}>
            {c.label} · {c.count}
          </span>
        ))}
        {summary.invalidatedCount > 0 && (
          <span className="px-1.5 py-0.5 rounded font-semibold text-red-400 bg-red-500/10">
            {t.investor.invalidated} · {summary.invalidatedCount}
          </span>
        )}
      </div>

      {/* Coverage / data-quality line (structural counts only) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[8px] font-mono text-muted-foreground/60">
        <span>{t.investor.usableIntel}: {summary.usableIntelCount}/{summary.totalMonitored}</span>
        <span>·</span>
        <span>{t.investor.insufficientIntel}: {summary.insufficientIntelCount}</span>
        <span>·</span>
        <span>{t.investor.unavailableIntel}: {summary.unavailableCount}</span>
      </div>

      {/* Instrument concentration (only instruments with 2+ positions) */}
      {summary.concentration.entries.length > 0 && (
        <div className="mt-2">
          <div className="text-[8px] font-mono font-semibold text-muted-foreground/70 uppercase tracking-wide">
            {t.investor.concentration}
          </div>
          <div className="text-[8px] font-mono text-muted-foreground/60 mt-0.5">
            {t.investor.multiplePositions}:{" "}
            {summary.concentration.entries
              .map((e) => `${e.instrument} (${e.positionCount})`)
              .join(", ")}
          </div>
        </div>
      )}

      <p className="text-[8px] font-mono text-muted-foreground/40 mt-2">
        {t.investor.portfolioInfo}
      </p>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL MACRO / CROSS-ASSET CONTEXT (Phase 140)
// ═══════════════════════════════════════════════════════════════
// Portfolio-level context assembled ONLY from already-fetched shared state
// (live macro quotes, US Treasury curve, economic calendar). No fetch, no
// calculation, no per-position keying — macro context is global by design.

function QuoteChip({ quote }: { quote: MacroQuoteView }) {
  const { t } = useI18n();
  if (quote.status === "UNAVAILABLE") return null;

  const labels = {
    VIX: t.market.vix,
    DXY: t.market.dxy,
    US10Y: t.market.us10y,
    WTI: t.market.wti,
  } as const;

  const isLive = quote.status === "LIVE";
  const chg = quote.change24h;

  return (
    <div className="flex items-center gap-1.5 rounded border border-border/30 bg-card/30 px-2 py-1.5 text-[9px] font-mono">
      <span className="font-semibold text-foreground">{labels[quote.symbol]}</span>
      <span className="text-muted-foreground">
        {quote.value !== null ? formatInstrumentPrice(quote.symbol, quote.value) : "—"}
      </span>
      {quote.value !== null && chg !== null && chg !== undefined && (
        <span className={chg > 0 ? "text-emerald-400" : chg < 0 ? "text-red-400" : "text-muted-foreground"}>
          {chg > 0 ? <TrendingUp className="size-3 inline" /> : chg < 0 ? <TrendingDown className="size-3 inline" /> : <Minus className="size-3 inline" />}
          {Math.abs(chg).toFixed(1)}%
        </span>
      )}
      <span className={`px-1 py-0.5 rounded text-[7px] font-semibold ${
        isLive
          ? "text-emerald-400 bg-emerald-500/10"
          : "text-amber-400 bg-amber-500/10"
      }`}>
        {isLive ? t.market.live : mapAvailability(quote.status, t)}
      </span>
    </div>
  );
}

function MacroContextSection({ ctx }: { ctx: InvestorMacroContext }) {
  const { t } = useI18n();

  return (
    <Section title={t.investor.macroContext} icon={<Globe className="size-3" />}>
      <p className="text-[8px] font-mono text-muted-foreground/50 mb-2">
        {t.investor.macroScopeNote}
      </p>

      {!ctx.hasAnyData ? (
        <div className="flex items-center gap-1.5 text-[8px] font-mono text-muted-foreground/70 py-1">
          <Eye className="size-3" />
          {t.investor.macroUnavailable}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Live macro quotes (verbatim provider values) */}
          <div className="flex flex-wrap gap-1.5">
            {ctx.quotes.map((q) => (
              <QuoteChip key={q.symbol} quote={q} />
            ))}
          </div>

          {/* Official US Treasury curve (only tenors actually reported) */}
          {ctx.rates.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
              {ctx.rates.rows.map((row) => (
                <span key={row.tenor}>
                  <span className="text-muted-foreground/60">
                    {row.tenor === "REAL_10Y" ? t.fundamental.realYields : row.tenor}
                  </span>{" "}
                  <span className={row.tenor === "REAL_10Y" ? "text-sky-300" : "text-foreground"}>
                    {row.value.toFixed(2)}%
                  </span>
                </span>
              ))}
              {ctx.rates.freshness && (
                <span className={`px-1 py-0.5 rounded text-[7px] font-semibold ${
                  TREASURY_FRESH_COLORS[ctx.rates.freshness] ?? "text-muted-foreground bg-muted/30"
                }`}>
                  {mapFreshness(ctx.rates.freshness, t)}
                </span>
              )}
            </div>
          )}

          {/* Nearest upcoming macro events (schedule data only) */}
          {ctx.events.length > 0 && (
            <div className="space-y-1">
              <div className="text-[8px] font-mono font-semibold text-muted-foreground/70 uppercase tracking-wide">
                {t.macro.economicEvents}
              </div>
              {ctx.events.map((e, i) => (
                <div key={`${e.event}-${e.datetime}-${i}`} className="flex items-center gap-1.5 text-[8px] font-mono">
                  <span className="text-muted-foreground/50">·</span>
                  <span className="text-foreground/90 font-medium">{e.event}</span>
                  <span className="text-muted-foreground/60">
                    {e.currency}{e.country ? ` · ${e.country}` : ""}
                  </span>
                  <span className="text-muted-foreground/40 ml-auto">
                    {new Date(e.datetime).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PER-POSITION THESIS CARD
// ═══════════════════════════════════════════════════════════════
// Shows ONLY the intelligence record associated with this exact positionId.
// Thesis (intelligence engine) and protection severity stay visually and
// semantically separate — HIGH_RISK protection never reads as a bearish thesis.

function PositionThesisCard({ row }: { row: InvestorIntelRow }) {
  const { t } = useI18n();
  const intel = row.intel;
  const info = getInstrumentInfo(row.instrument);
  const dataStatus = classifyIntelAvailability(intel);

  const supporting = intel?.evidence.filter((e) => e.direction === "supporting") ?? [];
  const conflicting = intel?.evidence.filter((e) => e.direction === "conflicting") ?? [];
  const neutralCount = intel?.evidence.filter((e) => e.direction === "neutral").length ?? 0;

  return (
    <div className="border border-border/30 rounded-lg p-3 space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-mono font-bold text-foreground">
          {info?.displayName ?? row.instrument}
        </span>
        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
          row.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {row.side}
        </span>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground">
          {mapHorizon(row.horizon, t)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {intel && intel.sourceMode !== "LIVE" && (
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
              intel.sourceMode === "STALE"
                ? "text-amber-400 bg-amber-500/10"
                : intel.sourceMode === "UNAVAILABLE"
                  ? "text-red-400 bg-red-500/10"
                  : "text-muted-foreground bg-muted/30"
            }`}>
              {mapAvailability(intel.sourceMode, t)}
            </span>
          )}
          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
            DATA_STATUS_COLORS[dataStatus] ?? "text-muted-foreground bg-muted/30"
          }`}>
            {mapAvailability(dataStatus, t)}
          </span>
        </span>
      </div>

      {intel ? (
        <>
          {/* Thesis health (engine) vs Protection severity — separate fields */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className="text-muted-foreground/60">{t.decision.thesisHealth}:</span>
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
              THESIS_COLORS[row.thesisHealth] ?? "text-muted-foreground bg-muted/30"
            }`}>
              {mapThesisHealth(row.thesisHealth, t).replace(/_/g, " ")}
            </span>
            <span className="text-muted-foreground/50">({row.thesisHealthScore}/100)</span>
            <span className="text-muted-foreground/60 ml-1">{t.intelligence.riskProtectionLabel}:</span>
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
              SEVERITY_COLORS[row.severity] ?? "text-muted-foreground bg-muted/30"
            }`}>
              {mapSeverity(row.severity, t).replace(/_/g, " ")}
            </span>
          </div>

          {/* Market state + confidence + observation count */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono text-muted-foreground">
            <span>{t.intelligence.marketLabel}{mapMarketState(intel.marketState, t)}</span>
            <span>{t.intelligence.confidenceLabel}{mapConfidence(intel.confidence, t)}</span>
            <span>{t.intelligence.observationCount}: {intel.observationCount}</span>
          </div>

          {/* Evidence summary (existing structured evidence only) */}
          <div className="flex flex-wrap items-center gap-x-3 text-[9px] font-mono">
            <span className="text-emerald-400">✓ {t.intelligence.supportingCountLabel}: {supporting.length}</span>
            <span className="text-red-400">✗ {t.intelligence.conflictingCountLabel}: {conflicting.length}</span>
            <span className="text-muted-foreground">{t.intelligence.neutralCountLabel}: {neutralCount}</span>
          </div>

          {/* Evidence items (engine prose, unchanged) */}
          {(supporting.length > 0 || conflicting.length > 0) && (
            <div className="space-y-0.5">
              {supporting.slice(0, 2).map((e, i) => (
                <div key={`s-${i}`} className="flex items-start gap-1.5">
                  <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>
                  <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                </div>
              ))}
              {conflicting.slice(0, 2).map((e, i) => (
                <div key={`c-${i}`} className="flex items-start gap-1.5">
                  <span className="text-[8px] text-red-400 mt-0.5">✗</span>
                  <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                </div>
              ))}
            </div>
          )}

          {/* Invalidation (existing conditions only — never invented) */}
          {intel.invalidationConditions.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[8px] font-mono font-semibold text-muted-foreground/70 uppercase tracking-wide">
                {t.decision.invalidation}
              </div>
              {intel.invalidationConditions.slice(0, 3).map((cond, i) => (
                <div key={`inv-${i}`} className="flex items-start gap-1.5">
                  <span className={`text-[8px] mt-0.5 ${cond.approaching ? "text-amber-400" : "text-muted-foreground/50"}`}>
                    {cond.approaching ? "▲" : "·"}
                  </span>
                  <span className={`text-[8px] font-mono leading-relaxed ${
                    cond.approaching ? "text-amber-400/90" : "text-muted-foreground"
                  }`}>
                    {cond.description}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Watch / what-to-monitor (engine output, unchanged) */}
          {intel.nextMonitor.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[8px] font-mono font-semibold text-muted-foreground/70 uppercase tracking-wide">
                {t.decision.whatToMonitor}
              </div>
              {intel.nextMonitor.slice(0, 3).map((item, i) => (
                <div key={`mon-${i}`} className="flex items-start gap-1.5">
                  <span className="text-[8px] text-muted-foreground/50 mt-0.5">·</span>
                  <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Explicit insuffiency state — never converted to neutral/bullish */}
          {dataStatus === "INSUFFICIENT" && (
            <div className="flex items-center gap-1.5 text-[8px] font-mono text-muted-foreground/70">
              <AlertTriangle className="size-3 text-amber-400/80" />
              {t.intelligence.insufficientEvidence}
            </div>
          )}
        </>
      ) : (
        /* No intelligence record exists for THIS position — explicit state. */
        <div className="flex items-center gap-1.5 text-[8px] font-mono text-muted-foreground/70 py-1">
          <Eye className="size-3" />
          {t.investor.intelUnavailable}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN INVESTOR WORKSPACE
// ═══════════════════════════════════════════════════════════════

export function InvestorWorkspace() {
  const { t } = useI18n();
  // Fetch positions from Convex (protection state)
  const {
    positions: registeredPositions,
    ingestEvent,
  } = usePositionProtection();

  // Same per-position intelligence derivation used by the protection
  // dashboard — the single intelligence source of truth. Strict positionId
  // association happens in associateInvestorIntelligence below.
  const { intelligenceMap, livePrices } = usePositionIntelligence(registeredPositions, {
    // Feed live quotes into the protection pipeline so the protection state
    // shown here stays fresh — identical to the protection dashboard wiring.
    onLiveEvent: (events) => {
      for (const event of events) {
        ingestEvent(event);
      }
    },
  });

  // Shared macro context inputs (treasury + calendar) — same single fetch
  // path the protection dashboard uses; surfaces are mutually exclusive tabs.
  const { treasuryData, calendarData } = useMacroContextData(registeredPositions);

  // Build portfolio summary from raw registered positions
  const portfolio = useMemo(() => {
    if (registeredPositions.length === 0) return null;

    const total = registeredPositions.length;
    const healthy = registeredPositions.filter(
      (p) => p.alert === null || p.alert?.severity === "NONE" || p.alert?.severity === "WATCH",
    ).length;
    const caution = registeredPositions.filter(
      (p) => p.alert?.severity === "CAUTION",
    ).length;
    const highRisk = registeredPositions.filter(
      (p) => p.alert?.severity === "HIGH_RISK",
    ).length;
    const invalidated = registeredPositions.filter(
      (p) => p.alert?.severity === "INVALIDATED",
    ).length;

    return {
      total,
      healthy,
      caution,
      highRisk,
      invalidated,
      positions: registeredPositions.map((p) => ({
        positionId: p.position.positionId,
        instrument: p.position.instrument,
        side: p.position.side,
        severity: p.alert?.severity ?? "NONE",
        lifecycle: p.position.lifecycle,
        entryPrice: p.position.entryPrice,
        stopLoss: p.position.stopLoss,
        takeProfit: p.position.takeProfit,
        horizon: p.position.horizon,
        openedAt: p.position.openedAt,
      })),
    };
  }, [registeredPositions]);

  // Strict per-position join: each row carries ONLY its own intelligence.
  const thesisRows = useMemo(
    () => associateInvestorIntelligence(registeredPositions, intelligenceMap),
    [registeredPositions, intelligenceMap],
  );

  // Global macro context — pure selection from the shared macro state. It is
  // intentionally NOT keyed to any position (portfolio-level context).
  const macroCtx = useMemo(
    () => buildInvestorMacroContext(livePrices, treasuryData, calendarData),
    [livePrices, treasuryData, calendarData],
  );

  // Investor decision synthesis — pure categorical layer over the SAME
  // position-specific rows + the SAME global macro context. Deterministic;
  // computes no new market metrics.
  const synthesisRows = useMemo(
    () => thesisRows.map((row) => ({ row, synthesis: buildInvestorDecisionSynthesis(row, macroCtx) })),
    [thesisRows, macroCtx],
  );

  // Portfolio-level aggregation (Phase 143) — deterministic categorical
  // summary of the ALREADY-CREATED per-position syntheses. Counts only.
  const portfolioSummary = useMemo(
    () => buildInvestorPortfolioSummary(synthesisRows.map((r) => r.synthesis), macroCtx),
    [synthesisRows, macroCtx],
  );

  // Portfolio monitor (Phase 144) — deterministic watch state over the
  // SAME summary + syntheses. Reads existing states only; no recalculation.
  const monitorState = useMemo(
    () => buildInvestorMonitorState(portfolioSummary, synthesisRows.map((r) => r.synthesis)),
    [portfolioSummary, synthesisRows],
  );

  return (
    <div className="space-y-4">
      {/* Investor Header */}
      <div className="flex items-center gap-2 text-[11px] font-mono font-semibold text-foreground">
        <Briefcase className="size-4 text-primary" />
        {t.workspace.investorWorkspaceTitle}
        <span className="text-[8px] text-muted-foreground font-normal ml-2">
          {t.workspace.investorWorkspaceSubtitle}
        </span>
      </div>

      {portfolio === null ? (
        <Section title={t.investor.portfolio} icon={<Briefcase className="size-3" />}>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
              <Briefcase className="size-5 text-muted-foreground/40" />
            </div>
            <h3 className="text-sm font-semibold text-foreground font-mono">
              {t.investor.noPositions}
            </h3>
            <p className="mt-1.5 text-[10px] text-muted-foreground max-w-xs font-mono">
              {t.investor.noPositionsHint}
            </p>
          </div>
        </Section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Portfolio Overview */}
          <div className="lg:col-span-5 space-y-3">
            {/* Portfolio Health */}
            <Section title={t.investor.portfolioHealth} icon={<Briefcase className="size-3" />}>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-foreground">
                    {portfolio.total}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">{t.investor.positions}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-emerald-400">
                    {portfolio.healthy}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">{t.investor.healthy}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-amber-400">
                    {portfolio.caution + portfolio.highRisk}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">{t.investor.atRisk}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold font-mono text-red-400">
                    {portfolio.invalidated}
                  </div>
                  <div className="text-[8px] text-muted-foreground font-mono">{t.investor.invalidated}</div>
                </div>
              </div>
            </Section>

            {/* Position List */}
            <Section title={t.investor.positions} icon={<Layers className="size-3" />}>
              <div className="space-y-1.5">
                {portfolio.positions.map((pos) => (
                  <div
                    key={pos.positionId}
                    className="flex items-center gap-2 p-2 rounded border border-border/30 hover:bg-muted/50 text-[9px] font-mono transition-colors"
                  >
                    <span className="w-16 shrink-0 font-semibold text-foreground">{pos.instrument}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] ${pos.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                      {pos.side}
                    </span>
                    <span className={`text-[8px] ${HEALTH_COLORS[pos.severity] ?? "text-muted-foreground"}`}>
                      {mapSeverity(pos.severity, t).replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-muted-foreground text-[8px]">{mapHorizon(pos.horizon, t)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Right: Risk + Context */}
          <div className="lg:col-span-7 space-y-3">
            {/* Risk Summary */}
            <Section title={t.investor.riskSummary} icon={<Shield className="size-3" />}>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className={`text-sm font-bold font-mono ${
                    portfolio.caution + portfolio.highRisk > 0 ? "text-amber-400" : "text-emerald-400"
                  }`}>
                    {mapRiskLevel(
                      portfolio.caution + portfolio.highRisk === 0 ? "LOW" : portfolio.highRisk > 0 ? "ELEVATED" : "MODERATE",
                      t,
                    )}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">{t.investor.riskLevel}</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className="text-sm font-bold font-mono text-foreground">
                    {portfolio.positions.filter((p) => p.stopLoss).length}/{portfolio.total}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">{t.investor.withSL}</div>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <div className="text-sm font-bold font-mono text-foreground">
                    {portfolio.positions.filter((p) => p.takeProfit).length}/{portfolio.total}
                  </div>
                  <div className="text-[7px] text-muted-foreground font-mono mt-0.5">{t.investor.withTP}</div>
                </div>
              </div>
            </Section>

            {/* Horizon Distribution */}
            <Section title={t.investor.horizonDistribution} icon={<BarChart3 className="size-3" />}>
              <div className="space-y-1">
                {(["SCALPING", "INTRADAY", "SWING", "INVESTING"] as const).map((h) => {
                  const count = portfolio.positions.filter((p) => p.horizon === h).length;
                  if (count === 0) return null;
                  return (
                    <div key={h} className="flex items-center gap-2 text-[8px] font-mono">
                      <span className="w-16 text-muted-foreground">{mapHorizon(h, t)}</span>
                      <div className="flex-1 h-1.5 bg-muted/30 rounded overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded"
                          style={{ width: `${(count / portfolio.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* Data Quality */}
            <Section title={t.investor.dataQuality} icon={<Activity className="size-3" />}>
              <div className="flex items-center gap-1.5 text-[8px] font-mono text-muted-foreground">
                <span>{t.investor.positionsRegistered}: {portfolio.total}</span>
                <span>·</span>
                <span>{t.investor.withStopLoss}: {portfolio.positions.filter((p) => p.stopLoss).length}</span>
                <span>·</span>
                <span>{t.investor.withTakeProfit}: {portfolio.positions.filter((p) => p.takeProfit).length}</span>
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* Portfolio monitor — only when positions exist */}
      {registeredPositions.length > 0 && (
        <PortfolioMonitorStrip monitor={monitorState} />
      )}

      {/* Portfolio-level summary — only when positions exist */}
      {registeredPositions.length > 0 && (
        <PortfolioSummarySection summary={portfolioSummary} />
      )}

      {/* Global Macro / Cross-Asset Context — only when positions exist */}
      {registeredPositions.length > 0 && (
        <MacroContextSection ctx={macroCtx} />
      )}

      {/* Investor Decision Context — only when positions exist */}
      {synthesisRows.length > 0 && (
        <DecisionContextSection rows={synthesisRows} />
      )}

      {/* Per-Position Thesis Intelligence — only when positions exist */}
      {thesisRows.length > 0 && (
        <Section title={t.investor.positionThesis} icon={<Brain className="size-3" />}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {thesisRows.map((row) => (
              <PositionThesisCard key={row.positionId} row={row} />
            ))}
          </div>
        </Section>
      )}

      {/* Footer disclaimer */}
      <div className="text-[8px] font-mono text-muted-foreground/40 pt-1 border-t border-border/20">
        {t.investor.investmentIntelligence} · {t.investor.noExecution} · {t.investor.manualAction}
      </div>
    </div>
  );
}
