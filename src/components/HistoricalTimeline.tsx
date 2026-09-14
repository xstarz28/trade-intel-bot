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
import {
  mapTimelineEventType,
  mapStrength,
  mapThesisHealth,
  mapTrendLabel,
  mapMarketState,
  mapMomentumValue,
  mapVolatilityValue,
  mapStructureValue,
  mapAvailability,
  mapConfidence,
  mapSide,
  mapSupportingCount,
  mapConflictingCount,
} from "@/lib/i18n/enum-mapping";
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
  IntelligenceSnapshot,
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
      {summary && <SummaryView summary={summary} events={events} snapshot={latestSnapshot} />}

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
              <TimelineEventCard key={i} event={event} snapshot={latestSnapshot} />
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
  // Phase 197: labels are translated prose; values are canonical enums routed
  // through the shared enum-mapping authority. `changed` is still computed from
  // the RAW enum values so translation can never alter change detection.
  const fields: ComparisonField[] = [
    { label: t.trader.thesisLabel, previous: mapThesisHealth(previous.thesisState, t), current: mapThesisHealth(current.thesisState, t), changed: previous.thesisState !== current.thesisState },
    { label: "H1", previous: mapTrendLabel(previous.h1Trend, t), current: mapTrendLabel(current.h1Trend, t), changed: previous.h1Trend !== current.h1Trend },
    { label: "M15", previous: mapTrendLabel(previous.m15Trend, t), current: mapTrendLabel(current.m15Trend, t), changed: previous.m15Trend !== current.m15Trend },
    { label: "M5", previous: mapTrendLabel(previous.m5Trend, t), current: mapTrendLabel(current.m5Trend, t), changed: previous.m5Trend !== current.m5Trend },
    { label: t.portfolio.conflictRegime, previous: mapMarketState(previous.marketRegime, t), current: mapMarketState(current.marketRegime, t), changed: previous.marketRegime !== current.marketRegime },
    { label: t.intelligence.momentumLabel, previous: mapMomentumValue(previous.momentum, t), current: mapMomentumValue(current.momentum, t), changed: previous.momentum !== current.momentum },
    { label: t.intelligence.volatilityLabel, previous: mapVolatilityValue(previous.volatility, t), current: mapVolatilityValue(current.volatility, t), changed: previous.volatility !== current.volatility },
    { label: t.intelligence.factorStructure, previous: mapStructureValue(previous.structure, t), current: mapStructureValue(current.structure, t), changed: previous.structure !== current.structure },
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
            {field.changed && <span className="text-amber-400 text-[7px]">{t.protection.changedLabel}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY VIEW
// ═══════════════════════════════════════════════════════════════

/**
 * Phase 197 — render a timeline event description in the active locale.
 *
 * The `description` field on a HistoricalEvent is an English string baked in at
 * capture time and PERSISTED (asserted byte-for-byte by the Phase 90/91
 * persistence tests), so it must not be changed at the source. Instead the UI
 * reconstructs the same sentence from the event's structured fields —
 * `category`, `previousState`, `currentState` — which carry the identical
 * information in canonical enum form.
 *
 * Returns null when the event cannot be reconstructed faithfully, in which case
 * the caller falls back to the stored description rather than inventing copy.
 */
function localizeEventDescription(
  event: HistoricalEvent,
  t: ReturnType<typeof useI18n>["t"],
  snapshot: IntelligenceSnapshot | null,
): string | null {
  const mapValue = (value: string): string => {
    switch (event.category) {
      case "THESIS": return mapThesisHealth(value, t);
      case "REGIME": return mapMarketState(value, t);
      case "H1":
      case "M15":
      case "M5": return mapTrendLabel(value, t);
      case "MOMENTUM": return mapMomentumValue(value, t);
      case "VOLATILITY": return mapVolatilityValue(value, t);
      case "STRUCTURE": return mapStructureValue(value, t);
      case "DATA": return mapAvailability(value, t);
      case "EVIDENCE": return mapConfidence(value, t);
      default: return value;
    }
  };

  // Categories that name themselves with untranslated timeframe notation (§3).
  const label = ((): string | null => {
    switch (event.category) {
      case "THESIS": return t.trader.thesisLabel;
      case "REGIME": return t.portfolio.conflictRegime;
      case "H1": return "H1";
      case "M15": return "M15";
      case "M5": return "M5";
      case "MOMENTUM": return t.intelligence.momentumLabel;
      case "VOLATILITY": return t.intelligence.volatilityLabel;
      case "STRUCTURE": return t.intelligence.factorStructure;
      case "EVIDENCE": return t.intelligence.evidenceLabel;
      case "DATA": return t.journal.snapshotData;
      default: return null;
    }
  })();

  // INITIAL_ANALYSIS names the instrument and side rather than a transition.
  // Instrument symbols stay untranslated (§3); the side is a canonical enum.
  if (event.category === "ANALYSIS") {
    if (!snapshot) return null;
    return `${t.timeline.initialAnalysis}: ${snapshot.instrument} ${mapSide(snapshot.side, t)} — ${mapThesisHealth(event.currentState, t)}`;
  }

  if (label === null) return null;

  // The evidence-shift event encodes counts ("3S/1C"), not enum values; its
  // stored sentence has no structured equivalent, so decline to localize.
  if (event.category === "EVIDENCE" && /\d+S\/\d+C/.test(event.currentState)) {
    return null;
  }

  return `${label}: ${mapValue(event.previousState)} → ${mapValue(event.currentState)}`;
}

function SummaryView({
  summary,
  events,
  snapshot,
}: {
  summary: HistoricalSummary;
  events: HistoricalEvent[];
  snapshot: IntelligenceSnapshot | null;
}) {
  const { t, txi } = useI18n();
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
          <span className="text-muted-foreground/60 w-16 shrink-0">{t.timeline.currentLabel}:</span>
          <span className={`font-semibold ${thesisColor}`}>{mapThesisHealth(summary.currentThesis, t)}</span>
        </div>
        {/* Previous thesis */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">{t.timeline.previousLabel}:</span>
          <span className="text-foreground/70">{summary.previousThesis === "—" ? "—" : mapThesisHealth(summary.previousThesis, t)}</span>
        </div>
        {/* Primary change */}
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">{t.protection.changedLabel}:</span>
          <span className="text-foreground/70">{localizeStoredDescription(summary.primaryChange, events, t, snapshot)}</span>
        </div>
        {/* Secondary change */}
        {summary.secondaryChange !== "—" && (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground/60 w-16 shrink-0">{t.timeline.alsoLabel}:</span>
            <span className="text-foreground/70">{localizeStoredDescription(summary.secondaryChange, events, t, snapshot)}</span>
          </div>
        )}
        {/* Evidence */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60 w-16 shrink-0">{t.intelligence.evidenceLabel}:</span>
          <span className="text-emerald-400/60">{mapSupportingCount(summary.supportingCount, t)}</span>
          <span className="text-red-400/60">{mapConflictingCount(summary.conflictingCount, t)}</span>
        </div>
        {/* Interpretation */}
        <div className="mt-1 text-foreground/60 leading-relaxed">
          {localizeInterpretation(summary, t, txi)}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE EVENT CARD
// ═══════════════════════════════════════════════════════════════

/**
 * Phase 197 — localize a STORED description string by finding the event it came
 * from and re-rendering it from structured fields.
 *
 * `summary.primaryChange` / `secondaryChange` are verbatim copies of an event's
 * `description`, so the stored string is matched by identity against the event
 * list. When no event matches (e.g. the "No significant change." sentinel) the
 * stored string is returned unchanged rather than guessed at.
 */
/**
 * Phase 197 — render the engine's interpretation in the active locale.
 *
 * `summary.interpretation` is an English sentence retained for logs and non-UI
 * consumers. The UI renders `interpretationParts` instead, so every fact is
 * translated while the underlying analysis is untouched. Falls back to the
 * stored sentence if an older persisted summary carries no structured parts.
 */
function localizeInterpretation(
  summary: HistoricalSummary,
  t: ReturnType<typeof useI18n>["t"],
  txi: ReturnType<typeof useI18n>["txi"],
): string {
  const parts = summary.interpretationParts;
  if (!parts || parts.length === 0) return summary.interpretation;

  const sentences = parts.map((part) => {
    switch (part.kind) {
      case "TIMEFRAME_SHIFT":
        return txi("timeline.interpTimeframeShift", {
          timeframe: part.timeframe,
          from: mapTrendLabel(part.from, t),
          to: mapTrendLabel(part.to, t),
        });
      case "REGIME_SHIFT":
        return txi("timeline.interpRegimeShift", {
          from: mapMarketState(part.from, t),
          to: mapMarketState(part.to, t),
        });
      case "EVIDENCE_SUPPORTING_LEADS":
        return t.timeline.interpSupportingLeads;
      case "EVIDENCE_CONFLICTING_LEADS":
        return t.timeline.interpConflictingLeads;
      case "EVIDENCE_BALANCED":
        return t.timeline.interpEvidenceBalanced;
      case "THESIS_STABLE":
        return txi("timeline.interpThesisStable", {
          thesis: mapThesisHealth(part.thesis, t),
        });
      case "FIRST_ANALYSIS":
        return txi("timeline.interpFirstAnalysis", {
          instrument: part.instrument,
          side: mapSide(part.side, t),
          thesis: mapThesisHealth(part.thesis, t),
        });
      default:
        return "";
    }
  }).filter((sentence) => sentence.length > 0);

  return sentences.join(" ");
}

function localizeStoredDescription(
  stored: string,
  events: HistoricalEvent[],
  t: ReturnType<typeof useI18n>["t"],
  snapshot: IntelligenceSnapshot | null,
): string {
  if (stored === "—") return stored;
  const source = events.find((e) => e.description === stored);
  if (!source) return stored;
  return localizeEventDescription(source, t, snapshot) ?? stored;
}

function TimelineEventCard({ event, snapshot }: { event: HistoricalEvent; snapshot: IntelligenceSnapshot | null }) {
  const { t, locale } = useI18n();
  const time = new Date(event.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

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
        <div className="text-foreground/70 mt-0.5">{localizeEventDescription(event, t, snapshot) ?? event.description}</div>
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
