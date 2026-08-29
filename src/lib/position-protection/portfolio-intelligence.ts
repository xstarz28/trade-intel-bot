/**
 * Phase 92 — Portfolio Intelligence Engine
 *
 * Aggregates position-level intelligence into portfolio-level analysis.
 * Pure functions — no side effects, no network calls.
 * No fabrication, no probability, no auto-execution.
 */

import type { PositionIntelligence } from "./market-intelligence-analyzer";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ThesisState =
  | "HEALTHY"
  | "STABLE"
  | "CAUTION"
  | "DETERIORATING"
  | "SEVERELY_DETERIORATING"
  | "INVALIDATED"
  | "INSUFFICIENT_DATA"
  | "UNKNOWN";

export type RiskContext = "LOW_CONCERN" | "MIXED" | "ELEVATED_CONCERN" | "INSUFFICIENT_DATA";
export type DataAvailabilityState = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "INSUFFICIENT";
export type AlignmentStrength = "STRONG" | "MODERATE" | "WEAK";
export type ConflictStrength = "STRONG" | "MODERATE" | "WEAK";
export type ExposureCategory = "ALIGNED_SUPPORTING" | "ALIGNED_CONFLICTING" | "MIXED" | "ISOLATED";
export type WatchPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PortfolioExposure {
  instrument: string;
  side: string;
  thesisState: ThesisState;
  regime: string;
  evidenceQuality: string;
  exposureCategory: ExposureCategory;
  portfolioImpact: string;
}

export interface PortfolioAlignment {
  instruments: string[];
  alignmentType: string;
  description: string;
  strength: AlignmentStrength;
}

export interface PortfolioConflict {
  positionA: string;
  positionB: string;
  conflictType: string;
  description: string;
  strength: ConflictStrength;
}

export interface PortfolioWatchItem {
  priority: WatchPriority;
  instrument: string;
  reason: string;
  category: string;
  strength: AlignmentStrength;
}

export interface PortfolioSummary {
  totalPositions: number;
  healthyPositions: number;
  cautionPositions: number;
  deterioratingPositions: number;
  invalidatedPositions: number;
  unavailablePositions: number;
  dominantPortfolioState: ThesisState;
  portfolioEvidenceQuality: string;
}

export interface PortfolioDataAvailability {
  technical: DataAvailabilityState;
  macro: DataAvailabilityState;
  news: DataAvailabilityState;
  derivatives: DataAvailabilityState;
  fundamentals: DataAvailabilityState;
}

export interface PortfolioIntelligence {
  summary: PortfolioSummary;
  exposure: PortfolioExposure[];
  alignments: PortfolioAlignment[];
  conflicts: PortfolioConflict[];
  watchItems: PortfolioWatchItem[];
  marketContext: string;
  riskContext: RiskContext;
  dataAvailability: PortfolioDataAvailability;
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// THESIS STATE HIERARCHY (for dominant state)
// ═══════════════════════════════════════════════════════════════

const THESIS_SEVERITY: Record<string, number> = {
  INSUFFICIENT_DATA: 0,
  HEALTHY: 1,
  STABLE: 2,
  CAUTION: 3,
  DETERIORATING: 4,
  SEVERELY_DETERIORATING: 5,
  INVALIDATED: 6,
  UNKNOWN: 0,
};

const THESIS_STATES_ORDER: ThesisState[] = [
  "INVALIDATED",
  "SEVERELY_DETERIORATING",
  "DETERIORATING",
  "CAUTION",
  "STABLE",
  "HEALTHY",
  "INSUFFICIENT_DATA",
  "UNKNOWN",
];

// ═══════════════════════════════════════════════════════════════
// MAX BOUNDS
// ═══════════════════════════════════════════════════════════════

const MAX_ALIGNMENTS = 10;
const MAX_CONFLICTS = 10;
const MAX_WATCH_ITEMS = 10;

// ═══════════════════════════════════════════════════════════════
// POSITION THESIS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyThesisState(health: string): ThesisState {
  const upper = health.toUpperCase().replace(/\s+/g, "_");
  if (upper.includes("INVALIDAT")) return "INVALIDATED";
  if (upper.includes("SEVERE")) return "SEVERELY_DETERIORATING";
  if (upper.includes("DETERIORAT")) return "DETERIORATING";
  if (upper.includes("CAUTION")) return "CAUTION";
  if (upper.includes("WATCH")) return "CAUTION";
  if (upper.includes("STABLE")) return "STABLE";
  if (upper.includes("HEALTHY")) return "HEALTHY";
  if (upper.includes("INSUFFICIENT") || upper.includes("UNAVAILABLE")) return "INSUFFICIENT_DATA";
  return "UNKNOWN";
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATE THESIS DISTRIBUTION
// ═══════════════════════════════════════════════════════════════

function aggregateThesisDistribution(positions: PositionIntelligence[]): PortfolioSummary {
  const total = positions.length;
  let healthy = 0;
  let caution = 0;
  let deteriorating = 0;
  let invalidated = 0;
  let unavailable = 0;

  for (const pos of positions) {
    const state = classifyThesisState(pos.thesisHealth);
    switch (state) {
      case "HEALTHY":
      case "STABLE":
        healthy++;
        break;
      case "CAUTION":
        caution++;
        break;
      case "DETERIORATING":
      case "SEVERELY_DETERIORATING":
        deteriorating++;
        break;
      case "INVALIDATED":
        invalidated++;
        break;
      case "INSUFFICIENT_DATA":
      case "UNKNOWN":
        unavailable++;
        break;
    }
  }

  // Determine dominant state: highest-severity group with count > 0.
  const stateCounts: Array<{ state: ThesisState; count: number; sev: number }> = [
    { state: "INVALIDATED", count: invalidated, sev: 6 },
    { state: "DETERIORATING", count: deteriorating, sev: 4 },
    { state: "CAUTION", count: caution, sev: 3 },
    { state: "HEALTHY", count: healthy, sev: 1 },
  ];

  let dominant: ThesisState = "HEALTHY";
  let dominantSev = 0;
  for (const { state, count, sev } of stateCounts) {
    if (count > 0 && sev > dominantSev) {
      dominant = state;
      dominantSev = sev;
    }
  }

  // Determine evidence quality
  const qualities = positions.map(p => p.confidence);
  const strongCount = qualities.filter(q => q === "STRONG_EVIDENCE").length;
  const moderateCount = qualities.filter(q => q === "MODERATE_EVIDENCE").length;
  const portfolioQuality = strongCount > positions.length / 2
    ? "STRONG_EVIDENCE"
    : moderateCount > positions.length / 3
      ? "MODERATE_EVIDENCE"
      : "WEAK_EVIDENCE";

  return {
    totalPositions: total,
    healthyPositions: healthy,
    cautionPositions: caution,
    deterioratingPositions: deteriorating,
    invalidatedPositions: invalidated,
    unavailablePositions: unavailable,
    dominantPortfolioState: dominant,
    portfolioEvidenceQuality: portfolioQuality,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPOSURE ANALYSIS
// ═══════════════════════════════════════════════════════════════

function buildExposure(positions: PositionIntelligence[]): PortfolioExposure[] {
  return positions.map(pos => {
    const thesisState = classifyThesisState(pos.thesisHealth);
    const regime = pos.ohlcvRegime ?? pos.marketState;

    // Determine exposure category
    const sameDirectionPositions = positions.filter(
      p => p.instrument !== pos.instrument && p.side === pos.side
    );

    let exposureCategory: ExposureCategory = "ISOLATED";
    if (sameDirectionPositions.length > 0) {
      const sameRegime = sameDirectionPositions.filter(
        p => (p.ohlcvRegime ?? p.marketState) === regime
      );
      if (sameRegime.length > 0) {
        exposureCategory = pos.side === "LONG" ? "ALIGNED_SUPPORTING" : "ALIGNED_SUPPORTING";
      } else {
        exposureCategory = "MIXED";
      }
    }

    // Portfolio impact description
    const impactParts: string[] = [];
    if (thesisState === "INVALIDATED") impactParts.push("position invalidated");
    if (thesisState === "SEVERELY_DETERIORATING" || thesisState === "DETERIORATING") {
      impactParts.push("thesis weakening");
    }
    if (sameDirectionPositions.length > 0) {
      impactParts.push(`${sameDirectionPositions.length} position(s) share ${pos.side} direction`);
    }
    if (impactParts.length === 0) impactParts.push("neutral");

    return {
      instrument: pos.instrument,
      side: pos.side,
      thesisState,
      regime,
      evidenceQuality: pos.confidence,
      exposureCategory,
      portfolioImpact: impactParts.join("; "),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT DETECTION
// ═══════════════════════════════════════════════════════════════

function detectAlignments(positions: PositionIntelligence[]): PortfolioAlignment[] {
  if (positions.length < 2) return [];

  const alignments: PortfolioAlignment[] = [];

  // Group by same side + same thesis direction
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];

      if (a.side !== b.side) continue;

      const regimeA = a.ohlcvRegime ?? a.marketState;
      const regimeB = b.ohlcvRegime ?? b.marketState;

      if (regimeA === regimeB && regimeA !== "UNKNOWN" && regimeA !== "INSUFFICIENT_DATA") {
        const h1Match = a.h1Analysis?.trend === b.h1Analysis?.trend && a.h1Analysis?.trend !== "UNKNOWN";
        const strength: AlignmentStrength = h1Match ? "STRONG" : "MODERATE";

        alignments.push({
          instruments: [a.instrument, b.instrument],
          alignmentType: "REGIME_MATCH",
          description: `${a.instrument} ${a.side} and ${b.instrument} ${b.side} share ${regimeA.replace(/_/g, " ").toLowerCase()} regime${h1Match ? ` with aligned H1 structure` : ""}.`,
          strength,
        });
      }

      // H1 trend alignment (even if regime differs)
      if (regimeA !== regimeB && a.h1Analysis?.trend === b.h1Analysis?.trend && a.h1Analysis?.trend !== "UNKNOWN") {
        alignments.push({
          instruments: [a.instrument, b.instrument],
          alignmentType: "HTF_ALIGNMENT",
          description: `${a.instrument} ${a.side} and ${b.instrument} ${b.side} share ${a.h1Analysis!.trend} H1 trend.`,
          strength: "MODERATE",
        });
      }
    }
  }

  // Concentration detection
  const bySide = new Map<string, string[]>();
  for (const pos of positions) {
    const key = pos.side;
    if (!bySide.has(key)) bySide.set(key, []);
    bySide.get(key)!.push(pos.instrument);
  }

  for (const [side, instruments] of bySide) {
    if (instruments.length >= 3) {
      // Check if asset classes are the same
      const assetClasses = new Set(instruments.map(inst => {
        const pos = positions.find(p => p.instrument === inst);
        return pos?.assetClass ?? "unknown";
      }));

      if (assetClasses.size === 1) {
        alignments.push({
          instruments,
          alignmentType: "CONCENTRATION",
          description: `${assetClasses.values().next().value} ${side} exposure concentrated across ${instruments.length} positions.`,
          strength: "STRONG",
        });
      } else {
        alignments.push({
          instruments,
          alignmentType: "DIRECTIONAL_CONCENTRATION",
          description: `${side} directional exposure across ${instruments.length} positions.`,
          strength: "MODERATE",
        });
      }
    }
  }

  return alignments.slice(0, MAX_ALIGNMENTS);
}

// ═══════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════

function detectConflicts(positions: PositionIntelligence[]): PortfolioConflict[] {
  if (positions.length < 2) return [];

  const conflicts: PortfolioConflict[] = [];

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];

      // Same instrument, opposite sides = direct conflict
      if (a.instrument === b.instrument && a.side !== b.side) {
        conflicts.push({
          positionA: `${a.instrument} ${a.side}`,
          positionB: `${b.instrument} ${b.side}`,
          conflictType: "DIRECT_DIRECTIONAL",
          description: `Direct directional conflict: ${a.instrument} held both LONG and SHORT.`,
          strength: "STRONG",
        });
        continue;
      }

      // Same instrument, same side but different thesis
      if (a.instrument === b.instrument && a.side === b.side) {
        const thesisA = classifyThesisState(a.thesisHealth);
        const thesisB = classifyThesisState(b.thesisHealth);
        if (THESIS_SEVERITY[thesisA] !== THESIS_SEVERITY[thesisB]) {
          conflicts.push({
            positionA: `${a.instrument} ${a.side}`,
            positionB: `${b.instrument} ${b.side}`,
            conflictType: "EVIDENCE_CONFLICT",
            description: `Multiple positions on ${a.instrument} have divergent thesis states.`,
            strength: "WEAK",
          });
        }
        continue;
      }

      // Opposite sides on different instruments: check if regimes conflict
      if (a.side !== b.side) {
        const regimeA = a.ohlcvRegime ?? a.marketState;
        const regimeB = b.ohlcvRegime ?? b.marketState;

        if (regimeA === regimeB && regimeA !== "UNKNOWN" && regimeA !== "INSUFFICIENT_DATA") {
          conflicts.push({
            positionA: `${a.instrument} ${a.side}`,
            positionB: `${b.instrument} ${b.side}`,
            conflictType: "REGIME",
            description: `${a.instrument} ${a.side} and ${b.instrument} ${b.side} face the same ${regimeA.replace(/_/g, " ").toLowerCase()} regime with opposite positioning.`,
            strength: "MODERATE",
          });
        }
      }

      // H1 trend conflicts
      if (a.side !== b.side && a.h1Analysis?.trend && b.h1Analysis?.trend
        && a.h1Analysis.trend !== "UNKNOWN" && b.h1Analysis.trend !== "UNKNOWN"
        && a.h1Analysis.trend === b.h1Analysis.trend) {
        conflicts.push({
          positionA: `${a.instrument} ${a.side}`,
          positionB: `${b.instrument} ${b.side}`,
          conflictType: "EVIDENCE_CONFLICT",
          description: `${a.instrument} ${a.side} and ${b.instrument} ${b.side} face ${a.h1Analysis.trend} H1 trend with opposite positioning.`,
          strength: "MODERATE",
        });
      }
    }
  }

  return conflicts.slice(0, MAX_CONFLICTS);
}

// ═══════════════════════════════════════════════════════════════
// WATCH LIST
// ═══════════════════════════════════════════════════════════════

function buildWatchList(
  positions: PositionIntelligence[],
  conflicts: PortfolioConflict[],
): PortfolioWatchItem[] {
  const items: PortfolioWatchItem[] = [];

  // 1. Invalidated positions (CRITICAL)
  for (const pos of positions) {
    if (pos.thesisHealth.toUpperCase().includes("INVALIDAT")) {
      items.push({
        priority: "CRITICAL",
        instrument: pos.instrument,
        reason: `${pos.instrument} ${pos.side} thesis invalidated`,
        category: "THESIS",
        strength: "STRONG",
      });
    }
  }

  // 2. Severely deteriorating (HIGH)
  for (const pos of positions) {
    if (pos.thesisHealth.toUpperCase().includes("SEVERE") || pos.thesisHealth.toUpperCase().includes("DETERIORAT")) {
      items.push({
        priority: "HIGH",
        instrument: pos.instrument,
        reason: `${pos.instrument} ${pos.side} thesis deteriorating — ${pos.actionRecommendation}`,
        category: "THESIS",
        strength: "STRONG",
      });
    }
  }

  // 3. Strong conflicts (HIGH)
  for (const conflict of conflicts.filter(c => c.strength === "STRONG")) {
    items.push({
      priority: "HIGH",
      instrument: conflict.positionA,
      reason: conflict.description,
      category: "CONFLICT",
      strength: "STRONG",
    });
  }

  // 4. Caution positions (MEDIUM)
  for (const pos of positions) {
    if (pos.thesisHealth.toUpperCase().includes("CAUTION") || pos.thesisHealth.toUpperCase().includes("WATCH")) {
      items.push({
        priority: "MEDIUM",
        instrument: pos.instrument,
        reason: `${pos.instrument} ${pos.side} thesis in caution`,
        category: "THESIS",
        strength: "MODERATE",
      });
    }
  }

  // 5. Moderate conflicts (MEDIUM)
  for (const conflict of conflicts.filter(c => c.strength === "MODERATE")) {
    items.push({
      priority: "MEDIUM",
      instrument: conflict.positionA,
      reason: conflict.description,
      category: "CONFLICT",
      strength: "MODERATE",
    });
  }

  // 6. Degraded data availability (LOW)
  for (const pos of positions) {
    if (pos.dataQuality === "UNAVAILABLE" || pos.dataQuality === "INSUFFICIENT") {
      items.push({
        priority: "LOW",
        instrument: pos.instrument,
        reason: `${pos.instrument} data quality: ${pos.dataQuality}`,
        category: "DATA",
        strength: "WEAK",
      });
    }
  }

  // Deduplicate by instrument + reason
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.instrument}|${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_WATCH_ITEMS);
}

// ═══════════════════════════════════════════════════════════════
// MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

function buildMarketContext(
  positions: PositionIntelligence[],
  summary: PortfolioSummary,
): string {
  if (positions.length === 0) return "No positions registered.";

  const parts: string[] = [];

  // Thesis distribution narrative
  if (summary.invalidatedPositions > 0) {
    parts.push(`${summary.invalidatedPositions} position(s) invalidated`);
  }
  if (summary.deterioratingPositions > 0) {
    parts.push(`${summary.deterioratingPositions} position(s) deteriorating`);
  }
  if (summary.cautionPositions > 0) {
    parts.push(`${summary.cautionPositions} position(s) in caution`);
  }
  if (summary.healthyPositions > 0) {
    parts.push(`${summary.healthyPositions} position(s) healthy`);
  }

  // Regime alignment
  const regimes = new Set(positions.map(p => p.ohlcvRegime ?? p.marketState).filter(r => r !== "UNKNOWN" && r !== "INSUFFICIENT_DATA"));
  if (regimes.size === 1) {
    parts.push(`All positions face ${regimes.values().next().value!.replace(/_/g, " ").toLowerCase()} regime`);
  } else if (regimes.size > 1) {
    parts.push(`Positions face mixed market regimes`);
  }

  // Side distribution
  const longs = positions.filter(p => p.side === "LONG").length;
  const shorts = positions.filter(p => p.side === "SHORT").length;
  if (longs > 0 && shorts > 0) {
    parts.push(`Mixed directional exposure: ${longs} LONG, ${shorts} SHORT`);
  } else if (longs > 0) {
    parts.push(`Predominantly LONG directional exposure`);
  } else if (shorts > 0) {
    parts.push(`Predominantly SHORT directional exposure`);
  }

  return parts.join(". ") + ".";
}

// ═══════════════════════════════════════════════════════════════
// RISK CONTEXT
// ═══════════════════════════════════════════════════════════════

function assessRiskContext(
  positions: PositionIntelligence[],
  conflicts: PortfolioConflict[],
  summary: PortfolioSummary,
): RiskContext {
  if (positions.length === 0) return "INSUFFICIENT_DATA";

  const hasInvalidated = summary.invalidatedPositions > 0;
  const hasDeteriorating = summary.deterioratingPositions > 0;
  const strongConflicts = conflicts.filter(c => c.strength === "STRONG").length;

  if (hasInvalidated || strongConflicts > 0) return "ELEVATED_CONCERN";
  if (hasDeteriorating || conflicts.length > 0) return "MIXED";
  return "LOW_CONCERN";
}

// ═══════════════════════════════════════════════════════════════
// DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

function assessDataAvailability(positions: PositionIntelligence[]): PortfolioDataAvailability {
  if (positions.length === 0) {
    return { technical: "UNAVAILABLE", macro: "UNAVAILABLE", news: "UNAVAILABLE", derivatives: "UNAVAILABLE", fundamentals: "UNAVAILABLE" };
  }

  const hasOHLCV = positions.some(p => p.h1Analysis || p.ohlcvRegime);
  const hasVix = positions.some(p => p.marketState !== "UNKNOWN");
  const hasNews = positions.some(p => p.dataQuality !== "UNAVAILABLE");

  return {
    technical: hasOHLCV ? "AVAILABLE" : "LIMITED",
    macro: hasVix ? "AVAILABLE" : "UNAVAILABLE",
    news: hasNews ? "AVAILABLE" : "UNAVAILABLE",
    derivatives: "UNAVAILABLE",
    fundamentals: "UNAVAILABLE",
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════

/**
 * Generate portfolio-level intelligence from position-level data.
 * All outputs are deterministic and evidence-based.
 * No probability claims. No auto-execution. No fabrication.
 */
export function generatePortfolioIntelligence(
  positions: PositionIntelligence[],
): PortfolioIntelligence {
  const summary = aggregateThesisDistribution(positions);
  const exposure = buildExposure(positions);
  const alignments = detectAlignments(positions);
  const conflicts = detectConflicts(positions);
  const watchItems = buildWatchList(positions, conflicts);
  const marketContext = buildMarketContext(positions, summary);
  const riskContext = assessRiskContext(positions, conflicts, summary);
  const dataAvailability = assessDataAvailability(positions);

  return {
    summary,
    exposure,
    alignments,
    conflicts,
    watchItems,
    marketContext,
    riskContext,
    dataAvailability,
    generatedAt: Date.now(),
  };
}
