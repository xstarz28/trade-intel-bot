/**
 * Phase 28 — FUNDAMENTAL THESIS.
 *
 * Pure derivation from existing engine output fields. This module evaluates
 * fundamental, macro, catalyst, and cross-asset context — and determines
 * whether they align with, contradict, or are neutral to the technical thesis.
 *
 * Unavailable fundamentals = NEUTRAL (never bearish/bullish by absence).
 * This module does NOT fabricate fundamental data.
 * This module does NOT modify the decision engine.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { EconomicEvent } from "@/lib/data/calendar-types";
import { buildInvestorFundamentalOutlook } from "@/lib/investor-fundamental-outlook";

// ── Types ────────────────────────────────────────────────────────

export type FundamentalAlignment =
  | "STRONGLY_ALIGNED"
  | "ALIGNED"
  | "MIXED"
  | "CONFLICTING"
  | "NEUTRAL"
  | "FUNDAMENTAL_UNAVAILABLE"
  | "TECHNICAL_UNAVAILABLE";

export type FundamentalDirection = "supportive" | "conflicting" | "neutral" | "unavailable";

export type EventRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "UNKNOWN";

export interface FundamentalEvidence {
  source: string;
  direction: FundamentalDirection;
  explanation: string;
  quality?: "verified" | "degraded" | "insufficient" | "stale" | "unavailable";
}

export interface CatalystInfo {
  description: string;
  relevance: "high" | "moderate" | "low";
  direction: "potentially_bullish" | "potentially_bearish" | "neutral" | "unknown";
  volatilityImpact: "high" | "moderate" | "low" | "unknown";
}

export interface FundamentalThesis {
  /** Technical direction from the engine. */
  technicalDirection: "bullish" | "bearish" | "neutral";
  /** Overall fundamental/macro alignment with technicals. */
  alignment: FundamentalAlignment;
  /** Fundamental evidence items. */
  fundamentalEvidence: FundamentalEvidence[];
  /** Macro/cross-asset evidence items. */
  macroEvidence: FundamentalEvidence[];
  /** Positioning evidence. */
  positioningEvidence: FundamentalEvidence[];
  /** Upcoming/recent catalysts. */
  catalysts: CatalystInfo[];
  /** Event risk level. */
  eventRisk: EventRiskLevel;
  /** Why alignment is what it is. */
  alignmentReason: string;
  /** Missing fundamental information. */
  missingInformation: string[];
  /** Summary for analyst. */
  analystSummary: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

type InvestorEvidence = ReturnType<typeof buildInvestorFundamentalOutlook>["evidence"][number];

function mapInvestorEvidence(item: InvestorEvidence): FundamentalEvidence {
  const direction: FundamentalDirection = item.direction === "SUPPORTING"
    ? "supportive"
    : item.direction === "CONFLICTING"
      ? "conflicting"
      : item.direction === "NEUTRAL"
        ? "neutral"
        : "unavailable";
  const quality: FundamentalEvidence["quality"] =
    item.quality === "VERIFIED" && item.freshness === "FRESH"
      ? "verified"
      : item.quality === "VERIFIED" || item.quality === "DEGRADED"
        ? "degraded"
        : item.freshness === "STALE"
          ? "stale"
          : "unavailable";
  return {
    source: item.source,
    direction,
    explanation: item.explanation,
    quality,
  };
}

function evidenceBucket(category: string): "fundamental" | "macro" | "positioning" {
  const key = category.toUpperCase();
  if (/(POSITION|COT|DERIVATIVE|FUNDING|OPEN_INTEREST|LONG_SHORT)/.test(key)) return "positioning";
  if (/(MACRO|TREASURY|RATES|CARRY|MONETARY|CROSS_ASSET|RISK_REGIME|SENTIMENT)/.test(key)) return "macro";
  return "fundamental";
}

function unavailableEvidence(source: string, explanation: string): FundamentalEvidence {
  return { source, direction: "unavailable", explanation, quality: "unavailable" };
}

function evaluateFundamentals(evidence: InvestorEvidence[]): FundamentalEvidence[] {
  const mapped = evidence
    .filter((item) => evidenceBucket(item.category) === "fundamental")
    .map(mapInvestorEvidence);
  return mapped.length > 0
    ? mapped
    : [unavailableEvidence("Asset-class fundamentals", "No fresh, verified asset-specific fundamental evidence is available.")];
}

function evaluateMacro(
  result: AnalysisResult,
  evidence: InvestorEvidence[],
): FundamentalEvidence[] {
  const mapped = evidence
    .filter((item) => evidenceBucket(item.category) === "macro")
    .map(mapInvestorEvidence);
  if (mapped.length > 0) return mapped;

  const fallback: FundamentalEvidence[] = [];
  if (result.macroData && (result.macroData as { confidence?: string }).confidence !== "unavailable") {
    fallback.push({
      source: "Macro intelligence",
      direction: "neutral",
      explanation: "Macro context is available but does not independently establish a directional thesis.",
      quality: "degraded",
    });
  }
  if (result.sentimentData) {
    fallback.push({
      source: "Sentiment intelligence",
      direction: "neutral",
      explanation: "Sentiment is contextual evidence, not a standalone fundamental direction.",
      quality: "degraded",
    });
  }
  return fallback.length > 0
    ? fallback
    : [unavailableEvidence("Macro/cross-asset", "No fresh macro or cross-asset evidence is available.")];
}

function evaluatePositioning(evidence: InvestorEvidence[]): FundamentalEvidence[] {
  const mapped = evidence
    .filter((item) => evidenceBucket(item.category) === "positioning")
    .map(mapInvestorEvidence);
  return mapped.length > 0
    ? mapped
    : [unavailableEvidence("COT/derivatives positioning", "No fresh, instrument-relevant positioning evidence is available.")];
}

function upcomingCalendarEvents(result: AnalysisResult): EconomicEvent[] {
  const events = result.calendarData?.events;
  if (!Array.isArray(events) || !Number.isFinite(result.timestamp)) return [];
  const windowEnd = result.timestamp + 72 * 60 * 60 * 1000;
  return events.filter((event): event is EconomicEvent =>
    !!event &&
    typeof event === "object" &&
    event.status === "upcoming" &&
    Number.isFinite(event.datetime) &&
    event.datetime > result.timestamp &&
    event.datetime <= windowEnd &&
    typeof event.event === "string" &&
    typeof event.currency === "string" &&
    (event.importance === 1 || event.importance === 2 || event.importance === 3),
  );
}

function detectCatalysts(result: AnalysisResult): CatalystInfo[] {
  const calendar = result.calendarData;
  if (!calendar || (calendar.freshness !== "realtime" && calendar.freshness !== "recent")) return [];
  const now = result.timestamp;
  return upcomingCalendarEvents(result)
    .sort((a, b) => a.datetime - b.datetime)
    .slice(0, 3)
    .map((event) => {
      const hoursUntil = Math.max(0, Math.round((event.datetime - now) / (60 * 60 * 1000)));
      const impact = event.importance === 3 ? "high" : event.importance === 2 ? "moderate" : "low";
      return {
        description: event.event + " (" + event.currency + ") in " + hoursUntil + "h — " + event.category,
        relevance: impact,
        direction: "unknown" as const,
        volatilityImpact: impact,
      };
    });
}

function assessEventRisk(result: AnalysisResult): EventRiskLevel {
  const calendar = result.calendarData;
  if (
    !calendar ||
    (calendar.freshness !== "realtime" && calendar.freshness !== "recent") ||
    (calendar.confidence !== "high" && calendar.confidence !== "medium" && calendar.confidence !== "low") ||
    !Array.isArray(calendar.events)
  ) return "UNKNOWN";
  const now = result.timestamp;
  const in24h = now + 24 * 60 * 60 * 1000;
  const in72h = now + 72 * 60 * 60 * 1000;
  const upcoming = upcomingCalendarEvents(result);
  const high24h = upcoming.filter((event) => event.importance === 3 && event.datetime <= in24h).length;
  const high72h = upcoming.filter((event) => event.importance === 3 && event.datetime <= in72h).length;
  const moderate24h = upcoming.filter((event) => event.importance === 2 && event.datetime <= in24h).length;
  if (high24h > 0) return "HIGH";
  if (high72h > 0) return "ELEVATED";
  if (moderate24h > 0) return "MODERATE";
  if (calendar.confidence === "low") return "UNKNOWN";
  return "LOW";
}

function computeAlignment(
  fundamentalEvidence: FundamentalEvidence[],
  macroEvidence: FundamentalEvidence[],
  techDir: "bullish" | "bearish" | "neutral",
): { alignment: FundamentalAlignment; reason: string } {
  if (techDir === "neutral") {
    return { alignment: "TECHNICAL_UNAVAILABLE", reason: "No directional technical thesis to align with" };
  }

  const allEvidence = [...fundamentalEvidence, ...macroEvidence];
  const available = allEvidence.filter((e) =>
    e.direction !== "unavailable" && e.quality !== "stale" && e.quality !== "unavailable",
  );
  if (available.length === 0) {
    return { alignment: "FUNDAMENTAL_UNAVAILABLE", reason: "No fresh, usable fundamental or macro evidence is available" };
  }

  const neutral = available.filter((e) => e.direction === "neutral");
  const supportive = available.filter((e) => e.direction === "supportive");
  const conflicting = available.filter((e) => e.direction === "conflicting");

  if (conflicting.length > 0 && supportive.length === 0) {
    return { alignment: "CONFLICTING", reason: "Verified fundamental evidence conflicts with the technical thesis" };
  }
  if (conflicting.length > 0 && supportive.length > 0) {
    return { alignment: "MIXED", reason: "Mixed fundamental evidence — supportive and conflicting sources are both present" };
  }
  if (supportive.length > 0 && neutral.length === 0) {
    return { alignment: "STRONGLY_ALIGNED", reason: "Fresh fundamental evidence supports the technical thesis" };
  }
  if (supportive.length > 0) {
    return { alignment: "ALIGNED", reason: "Fundamental evidence supports the thesis alongside neutral context" };
  }
  return { alignment: "NEUTRAL", reason: "Fundamental context is available but directionally neutral; it neither confirms nor opposes the technical thesis" };
}

// ── Main builder ─────────────────────────────────────────────────

export function buildFundamentalThesis(result: AnalysisResult): FundamentalThesis {
  const techDir = dirBias(result);
  const investorOutlook = buildInvestorFundamentalOutlook(
    result,
    result.priceSnapshot?.price ?? 0,
  );
  const investorEvidence = investorOutlook.evidence;
  const fundamentalEvidence = evaluateFundamentals(investorEvidence);
  const macroEvidence = evaluateMacro(result, investorEvidence);
  const positioningEvidence = evaluatePositioning(investorEvidence);
  const catalysts = detectCatalysts(result);
  const eventRisk = assessEventRisk(result);
  const { alignment, reason } = computeAlignment(fundamentalEvidence, macroEvidence, techDir);

  const missingInfo = [...new Set([
    ...investorOutlook.limitations,
    ...(!result.calendarData || result.calendarData.freshness === "unavailable" || result.calendarData.freshness === "stale"
      ? ["Fresh economic-calendar coverage is unavailable."]
      : []),
  ])].slice(0, 10);

  const summary = alignment === "FUNDAMENTAL_UNAVAILABLE"
    ? "Fresh asset-class fundamental evidence is unavailable — technical context remains separate."
    : alignment === "STRONGLY_ALIGNED"
      ? "Verified fundamentals support the technical thesis."
      : alignment === "ALIGNED"
        ? "Fundamentals support the technical thesis alongside neutral context."
        : alignment === "MIXED"
          ? "Fundamental evidence is mixed — supportive and conflicting sources require caution."
          : alignment === "CONFLICTING"
            ? "Verified fundamentals conflict with the technical thesis — caution warranted."
            : alignment === "NEUTRAL"
              ? "Fundamental context is available but directionally neutral; no fundamental confirmation is claimed."
              : "No directional technical thesis is available for alignment.";

  return {
    technicalDirection: techDir,
    alignment,
    fundamentalEvidence,
    macroEvidence,
    positioningEvidence,
    catalysts,
    eventRisk,
    alignmentReason: reason,
    missingInformation: missingInfo,
    analystSummary: summary,
  };
}
