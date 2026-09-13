/**
 * Phase 89 — Historical Intelligence Timeline Component
 *
 * Displays position-specific intelligence history:
 * - Current vs Previous comparison
 * - Historical summary
 * - Timeline of meaningful changes
 */

import React from "react";
import { useI18n } from "@/lib/i18n";
import { mapTimelineEventType, mapStrength } from "@/lib/i18n/enum-mapping";
import {
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Layers,
  Zap,
  BarChart3,
  Wind,
} from "lucide-react";
import type {
  HistoricalTimeline,
  HistoricalEvent,
  ComparisonField,
  HistoricalSummary,
} from "@/lib/position-protection/historical-intelligence";

// ═══════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════

interface HistoricalTimelineProps {
  timeline: HistoricalTimeline | null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function HistoricalTimelineView({ timeline }: HistoricalTimelineProps) {
  const { t, txi } = useI18n();
  if (!timeline || !timeline.latestSnapshot) {
    return (
      <div className="border border-border/30 rounded-lg p-4 text-center">
        <p className="text-[10px] font-mono text-muted-foreground/60">
          {t.system.noHealthData}. {t.system.healthMetricsHint}.
        </p>
      </div>
    );
  }

  const { summary, events, latestSnapshot, previousSnapshot } = timeline;

  return (
    <div className="space-y-3">
      {/* Current vs Previous */}
      {previousSnapshot && (
        <ComparisonView
          previous={previousSnapshot}
          current={latestSnapshot}
        />
      )}

      {/* Summary */}
      {summary && <SummaryView summary={summary} />}

      {/* Timeline */}
      {events.length > 0 && (
        <div className="border border-border/30 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
            <Clock className="size-3 text-primary" />
            <span className="text-[10px] font-mono font-semibold text-foreground">{t.intelligence.historicalTimeline}</span>
            <span className="text-[8px] font-mono text-muted-foreground/60 ml-auto">
              {txi("protection.eventsCount", { count: events.length })}
            </span>
          </div>
          <div className="px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto">
            {events.map((event, i) => (
              <TimelineEventCard key={i} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPARISON VIEW
// ═══════════════════════════════════════════════════════════════

function ComparisonView({
  previous,
  current,
}: {
  previous: import("@/lib/position-protection/historical-intelligence").IntelligenceSnapshot;
  current: import("@/lib/position-protection/historical-intelligence").IntelligenceSnapshot;
}) {
  const { t } = useI18n();
  const fields: ComparisonField[] = [
    { label: "Thesis", previous: previous.thesisState, current: current.thesisState, changed: previous.thesisState !== current.thesisState },
    { label: "H1", previous: previous.h1Trend, current: current.h1Trend, changed: previous.h1Trend !== current.h1Trend },
    { label: "M15", previous: previous.m15Trend, current: current.m15Trend, changed: previous.m15Trend !== current.m15Trend },
    { label: "M5", previous: previous.m5Trend, current: current.m5Trend, changed: previous.m5Trend !== current.m5Trend },
    { label: "Regime", previous: previous.marketRegime, current: current.marketRegime, changed: previous.marketRegime !== current.marketRegime },
    { label: "Momentum", previous: previous.momentum, current: current.momentum, changed: previous.momentum !== current.momentum },
    { label: "Volatility", previous: previous.volatility, current: current.volatility, changed: previous.volatility !== current.volatility },
    { label: "Structure", previous: previous.structure, current: current.structure, changed: previous.structure !== current.structure },
  ];

  const changedFields = fields.filter(f => f.changed);
  if (changedFields.length === 0) return null;

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
        <ArrowRight className="size-3 text-primary" />
        <span className="text-[10px] font-mono font-semibold text-foreground">{t.timeline.currentVsPrevious}</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        {fields.map((field) => (
          <div key={field.label} className={`flex items-center gap-2 text-[9px] font-mono px-1.5 py-0.5 rounded ${field.changed ? "bg-amber-500/5" : ""}`}>
            <span className="w-16 text-muted-foreground/60 shrink-0">{field.label}</span>
            <span className={`${field.changed ? "text-muted-foreground/40 line-through" : "text-muted-foreground/60"}`}>
              {field.previous}
            </span>
            <ArrowRight className="size-2 text-muted-foreground/30" />
            <span className={`${field.changed ? "text-foreground font-semibold" : "text-muted-foreground/60"}`}>
              {field.current}
            </span>
            {field.changed && <span className="text-amber-400 text-[7px]">changed</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY VIEW
// ═══════════════════════════════════════════════════════════════

function SummaryView({ summary }: { summary: HistoricalSummary }) {
  const { t } = useI18n();
  const thesisColor =
    summary.currentThesis === "HEALTHY" || summary.currentThesis === "STABLE" ? "text-emerald-400" :
    summary.currentThesis === "CAUTION" || summary.currentThesis === "WATCH" ? "text-amber-400" :
    summary.currentThesis === "DETERIORATING" || summary.currentThesis === "SEVERELY_DETERIORATING" ? "text-orange-400" :
    summary.currentThesis === "INVALIDATED" ? "text-red-400" :
    "text-muted-foreground";

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
        <BarChart3 className="size-3 text-primary" />
        <span className="text-[10px] font-mono font-semibold text-foreground">{t.timeline.historySummary}</span>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-[9px] font-mono">
        {/* Current thesis */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">Current:</span>
          <span className={`font-semibold ${thesisColor}`}>{summary.currentThesis}</span>
        </div>
        {/* Previous thesis */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">Previous:</span>
          <span className="text-foreground/70">{summary.previousThesis}</span>
        </div>
        {/* Primary change */}
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">Changed:</span>
          <span className="text-foreground/70">{summary.primaryChange}</span>
        </div>
        {/* Secondary change */}
        {summary.secondaryChange !== "—" && (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground/60 w-16 shrink-0">Also:</span>
            <span className="text-foreground/70">{summary.secondaryChange}</span>
          </div>
        )}
        {/* Evidence */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">Evidence:</span>
          <span className="text-emerald-400/60">{summary.supportingCount} supporting</span>
          <span className="text-red-400/60">{summary.conflictingCount} conflicting</span>
        </div>
        {/* Interpretation */}
        <div className="mt-1 text-foreground/60 leading-relaxed">
          {summary.interpretation}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE EVENT CARD
// ═══════════════════════════════════════════════════════════════

function TimelineEventCard({ event }: { event: HistoricalEvent }) {
  const { t } = useI18n();
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const icon = getEventIcon(event.eventType);
  const color = getEventColor(event.eventType);

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 bg-muted/10 rounded text-[8px] font-mono">
      <span className="text-muted-foreground/40 w-10 shrink-0 mt-0.5">{time}</span>
      <span className={`${color} mt-0.5 shrink-0`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={`font-semibold ${color}`}>{mapTimelineEventType(event.eventType, t)}</span>
          <span className={`text-[7px] px-1 py-0.5 rounded ${
            event.strength === "STRONG" ? "bg-amber-500/10 text-amber-400" :
            event.strength === "MODERATE" ? "bg-blue-500/10 text-blue-400" :
            "bg-muted/30 text-muted-foreground"
          }`}>
            {mapStrength(event.strength, t)}
          </span>
        </div>
        <div className="text-foreground/70 mt-0.5">{event.description}</div>
      </div>
    </div>
  );
}

function getEventIcon(type: string): React.ReactNode {
  switch (type) {
    case "INITIAL_ANALYSIS": return <CheckCircle className="size-2.5" />;
    case "THESIS_CHANGE": return <AlertTriangle className="size-2.5" />;
    case "REGIME_CHANGE": return <TrendingUp className="size-2.5" />;
    case "TIMEFRAME_CHANGE": return <Layers className="size-2.5" />;
    case "STRUCTURE_CHANGE": return <Zap className="size-2.5" />;
    case "MOMENTUM_CHANGE": return <TrendingDown className="size-2.5" />;
    case "VOLATILITY_CHANGE": return <Wind className="size-2.5" />;
    default: return <Clock className="size-2.5" />;
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case "INITIAL_ANALYSIS": return "text-emerald-400";
    case "THESIS_CHANGE": return "text-amber-400";
    case "REGIME_CHANGE": return "text-blue-400";
    case "TIMEFRAME_CHANGE": return "text-primary";
    case "STRUCTURE_CHANGE": return "text-orange-400";
    case "MOMENTUM_CHANGE": return "text-cyan-400";
    case "VOLATILITY_CHANGE": return "text-purple-400";
    default: return "text-muted-foreground";
  }
}
