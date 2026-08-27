/**
 * Phase 51 — Autonomous Market Radar Engine
 *
 * Discovery, lifecycle management, diff detection, quality tiering,
 * correlation control, and horizon-specific ranking.
 *
 * INFORMATIONAL_ONLY — never modifies the decision engine.
 * Provider availability NEVER becomes directional evidence.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type {
  TradingMode,
  InvestorHorizon,
} from "@/lib/recommendation-engine";
import { generateRecommendation } from "@/lib/recommendation-engine";
import type {
  RadarOpportunity,
  RadarScanConfig,
  RadarScanResult,
  OpportunityDiff,
  OpportunityLifecycle,
  QualityTier,
  FreshnessLevel,
  CorrelationCluster,
  UniverseEntry,
} from "./types";

// Re-export types for consumers
export type { RadarScanResult, RadarScanConfig, RadarOpportunity } from "./types";
import {
  HORIZON_FRESHNESS_GATES,
  meetsFreshness,
  HORIZON_REFRESH_PRIORITY,
} from "./types";
import { DEFAULT_UNIVERSE, CORRELATION_CLUSTERS } from "./universe";
import { buildRadarCandidate, type RadarCandidateSource } from "./candidate-builder";
import {
  checkFreshnessEligibility,
  shouldTransitionLifecycle,
  assessFreshness,
  summarizeFreshness,
} from "./freshness";

// ═══════════════════════════════════════════════════════════════
// QUALITY TIER ASSIGNMENT
// ═══════════════════════════════════════════════════════════════

function assignQualityTier(
  score: number,
  confidence: number,
  dataCompleteness: string,
  conflictingEvidence: number,
  freshness: FreshnessLevel,
): QualityTier {
  // X — Insufficient Data
  if (dataCompleteness === "NONE" || freshness === "UNAVAILABLE") return "X";

  // A — Strong Evidence: high score, high confidence, minimal conflict, fresh
  if (score >= 75 && confidence >= 70 && conflictingEvidence <= 1 && freshness === "FRESH") return "A";

  // B — Good Evidence: decent score, reasonable confidence
  if (score >= 60 && confidence >= 55 && conflictingEvidence <= 2) return "B";

  // C — Mixed Evidence: moderate score or significant conflicts
  if (score >= 40 && dataCompleteness !== "MINIMAL") return "C";

  // D — Weak Evidence
  if (dataCompleteness === "MINIMAL" || score < 40) return "D";

  return "D";
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY SCORING
// ═══════════════════════════════════════════════════════════════

function scoreOpportunity(
  source: RadarCandidateSource,
  horizon: TradingMode | InvestorHorizon,
): { score: number; confidence: number; supporting: string[]; conflicting: string[]; missing: string[]; reasons: string[] } {
  const snapshot = source.snapshot;
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];
  const reasons: string[] = [];
  let score = 50; // baseline
  let confidence = 50;

  // ── Data Quality (affects both score and confidence) ──
  const freshness = snapshot ? assessFreshness(snapshot.observedAt, Date.now()) : "UNAVAILABLE";
  if (freshness === "FRESH") { score += 10; confidence += 15; supporting.push("fresh market data"); }
  else if (freshness === "DELAYED") { score += 5; confidence += 5; supporting.push("delayed data available"); }
  else if (freshness === "STALE") { score -= 10; confidence -= 15; conflicting.push("stale data"); }
  else { score -= 30; confidence -= 30; missing.push("market data unavailable"); }

  // ── Market Structure ──
  if (snapshot?.htfBias && snapshot.htfBias !== "unknown") {
    score += 5;
    supporting.push(`HTF bias: ${snapshot.htfBias}`);
  } else {
    missing.push("HTF structure");
  }
  if (snapshot?.mtfAlignment) {
    if (snapshot.mtfAlignment.includes("ALIGNED")) {
      score += 8;
      supporting.push(`MTF aligned: ${snapshot.mtfAlignment}`);
    } else if (snapshot.mtfAlignment === "MIXED") {
      score -= 3;
      conflicting.push("MTF mixed signals");
    }
  } else {
    missing.push("MTF alignment");
  }
  if (snapshot?.marketRegime && snapshot.marketRegime !== "UNKNOWN") {
    score += 3;
    supporting.push(`regime: ${snapshot.marketRegime}`);
  }

  // ── Execution Quality ──
  if (snapshot?.spreadBps !== undefined) {
    if (snapshot.spreadBps < 5) { score += 3; supporting.push("tight spread"); }
    else if (snapshot.spreadBps > 20) { score -= 5; conflicting.push("wide spread"); }
  }

  // ── Asset-class-specific scoring ──
  switch (source.universe.assetClass) {
    case "crypto":
      if (source.derivatives?.fundingRate !== undefined) {
        score += 3;
        supporting.push("funding rate available");
      } else { missing.push("funding rate"); }
      if (source.derivatives?.openInterest !== undefined) {
        score += 2;
        supporting.push("open interest available");
      }
      break;
    case "forex":
      if (source.cot?.netNonCommercial !== undefined) {
        score += 3;
        supporting.push("COT positioning available");
      } else { missing.push("COT positioning"); }
      if (source.treasury?.dxyTrend) {
        score += 2;
        supporting.push(`DXY trend: ${source.treasury.dxyTrend}`);
      } else { missing.push("DXY context"); }
      break;
    case "equity":
      if (source.fundamentals?.peRatio !== undefined) {
        score += 3;
        supporting.push(`P/E: ${source.fundamentals.peRatio.toFixed(1)}`);
      } else { missing.push("P/E valuation"); }
      if (source.fundamentals?.revenueGrowth !== undefined) {
        score += 2;
        supporting.push(`revenue growth: ${(source.fundamentals.revenueGrowth * 100).toFixed(1)}%`);
      }
      break;
    case "commodity":
      if (source.eia?.inventory !== undefined) {
        score += 3;
        supporting.push("inventory data available");
      } else { missing.push("inventory data"); }
      if (source.cot?.netNonCommercial !== undefined) {
        score += 2;
        supporting.push("COT available");
      }
      break;
    case "indices":
      if (source.treasury?.riskRegime) {
        score += 3;
        supporting.push(`risk regime: ${source.treasury.riskRegime}`);
      } else { missing.push("risk regime"); }
      break;
    case "macro":
      if (source.treasury?.tenYearYield !== undefined) {
        score += 5;
        supporting.push("yield data available");
      } else { missing.push("yield data"); }
      if (source.treasury?.dxyTrend) {
        score += 3;
        supporting.push(`DXY: ${source.treasury.dxyTrend}`);
      }
      break;
  }

  // ── Horizon-specific adjustments ──
  const isInvesting = horizon.includes("MONTHS") || horizon.includes("YEARS") || horizon === "1-4_WEEKS";
  if (isInvesting && source.fundamentals) {
    score += 5;
    supporting.push("fundamental data for investment horizon");
  }
  if (!isInvesting && snapshot?.volatility && snapshot.volatility > 0) {
    score += 3;
    supporting.push("volatility context available");
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));
  confidence = Math.max(0, Math.min(100, confidence));

  // Conflict adjustment
  if (conflicting.length > 2) {
    confidence = Math.max(0, confidence - conflicting.length * 5);
  }

  // ── Phase 55: Analytical Depth (informational only, small weight) ──
  if (source.analyticalDepth) {
    const ad = source.analyticalDepth;
    if (ad.regime && ad.regime !== "UNKNOWN") {
      score += 2;
      supporting.push(`analytical regime: ${ad.regime}`);
    }
    if (ad.dimensionsAvailable && ad.dimensionsAvailable >= 4) {
      score += 3;
      supporting.push(`deep analytical context (${ad.dimensionsAvailable} dimensions)`);
    } else if (ad.dimensionsAvailable !== undefined && ad.dimensionsAvailable < 2) {
      missing.push("deep analytical context");
    }
    if (ad.relativeValue) {
      score += 1;
      supporting.push(`relative value: ${ad.relativeValue}`);
    }
  }

  // Build primary reasons from top supporting evidence
  const topReasons = supporting.slice(0, 3);

  return { score, confidence, supporting, conflicting, missing, reasons: topReasons };
}

// ═══════════════════════════════════════════════════════════════
// INVALIDATION CONDITIONS
// ═══════════════════════════════════════════════════════════════

function buildInvalidationConditions(
  source: RadarCandidateSource,
  freshness: FreshnessLevel,
): string[] {
  const conditions: string[] = [];
  conditions.push(`price structure invalidation`);
  if (freshness !== "FRESH") {
    conditions.push(`freshness expiration at current level`);
  }
  if (source.snapshot?.spreadBps && source.snapshot.spreadBps > 20) {
    conditions.push(`spread deterioration beyond ${source.snapshot.spreadBps} bps`);
  }
  if (source.universe.assetClass === "crypto" && source.derivatives) {
    conditions.push(`derivatives data becomes unavailable`);
  }
  conditions.push(`provider failure for critical data`);
  conditions.push(`evidence conflict increase`);
  return conditions;
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION CLUSTER FILTERING
// ═══════════════════════════════════════════════════════════════

function filterByCorrelation(
  opportunities: RadarOpportunity[],
): RadarOpportunity[] {
  const clusterDisplayCounts = new Map<string, number>();
  const filtered: RadarOpportunity[] = [];

  // Sort by score descending
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);

  for (const opp of sorted) {
    const cluster = CORRELATION_CLUSTERS.find(c => c.instruments.includes(opp.instrument));
    if (!cluster) {
      filtered.push(opp);
      continue;
    }
    const count = clusterDisplayCounts.get(cluster.id) ?? 0;
    if (count < cluster.maxDisplay) {
      clusterDisplayCounts.set(cluster.id, count + 1);
      filtered.push(opp);
    }
  }

  return filtered;
}

// ═══════════════════════════════════════════════════════════════
// RADAR ENGINE
// ═══════════════════════════════════════════════════════════════

export interface RadarState {
  /** Previous scan opportunities keyed by instrument. */
  previous: Map<string, RadarOpportunity>;
  /** Timestamp of last scan. */
  lastScanAt: number;
}

export function scanRadar(
  sources: RadarCandidateSource[],
  config: RadarScanConfig,
  previousState?: RadarState,
  now?: number,
): RadarScanResult {
  const startTime = Date.now();
  const timestamp = now ?? Date.now();
  const maxResults = config.maxResults ?? 10;

  // Filter by asset class if configured
  let filteredSources = sources;
  if (config.assetClasses && config.assetClasses.length > 0) {
    filteredSources = sources.filter(s => config.assetClasses!.includes(s.universe.assetClass));
  }

  // Build candidates from sources
  const candidates = filteredSources.map(s => buildRadarCandidate(s, timestamp));

  // Score each candidate per horizon
  const allHorizonOpps = new Map<TradingMode | InvestorHorizon, RadarOpportunity[]>();
  const freshnessLevels: FreshnessLevel[] = [];
  let totalWithLiveData = 0;
  let totalInsufficient = 0;
  const providerErrors: string[] = [];

  // Initialize empty horizon arrays for all requested horizons
  for (const horizon of config.horizons) {
    if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
  }

  for (const source of filteredSources) {
    const freshness = source.snapshot
      ? assessFreshness(source.snapshot.observedAt, timestamp)
      : "UNAVAILABLE";
    freshnessLevels.push(freshness);
    if (freshness === "FRESH" || freshness === "DELAYED") totalWithLiveData++;
    const completeness = candidates.find(c => c.instrument === source.universe.instrument)?.dataCompleteness;
    if (completeness === "NONE" || completeness === "MINIMAL") totalInsufficient++;

    for (const horizon of config.horizons) {
      // Freshness gate check
      const eligibility = checkFreshnessEligibility(freshness, freshness === "FRESH" || freshness === "DELAYED", horizon);

      if (!eligibility.eligible) {
        // Still record as opportunity with EXPIRED/INVALIDATED lifecycle
        const opp: RadarOpportunity = {
          instrument: source.universe.instrument,
          assetClass: source.universe.assetClass,
          region: source.universe.region,
          lifecycle: "EXPIRED",
          qualityTier: "X",
          score: 0,
          confidence: 0,
          dataCompleteness: candidates.find(c => c.instrument === source.universe.instrument)?.dataCompleteness ?? "NONE",
          freshness,
          supportingEvidence: [],
          conflictingEvidence: [eligibility.reason],
          missingInformation: ["data freshness insufficient for this horizon"],
          invalidationConditions: [],
          primaryReasons: [],
          providerCoverage: "NONE",
          lastUpdated: timestamp,
          candidateInstrument: source.universe.instrument,
          dependencyGroups: [],
        };

        if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
        allHorizonOpps.get(horizon)!.push(opp);
        continue;
      }

      // Score the opportunity
      const scored = scoreOpportunity(source, horizon);
      const candidate = candidates.find(c => c.instrument === source.universe.instrument);

      const lifecycle: OpportunityLifecycle = scored.score >= 50 ? "ACTIVE" : scored.score >= 30 ? "QUALIFIED" : "DISCOVERED";
      const qualityTier = assignQualityTier(
        scored.score,
        scored.confidence,
        candidate?.dataCompleteness ?? "NONE",
        scored.conflicting.length,
        freshness,
      );

      // Phase 55: Build analytical context summary for the opportunity
      const ad = source.analyticalDepth;
      const analyticalContext = ad ? {
        regime: ad.regime,
        primarySupport: ad.supportingEvidence?.[0],
        primaryConflict: ad.conflictingEvidence?.[0],
        keyRisk: ad.missingInformation?.[0],
        missingCritical: ad.missingInformation?.slice(0, 2).join('; '),
        relativeValue: ad.relativeValue,
        dimensionsAvailable: ad.dimensionsAvailable,
        dimensionsTotal: ad.dimensionsTotal,
      } : undefined;

      const opp: RadarOpportunity = {
        instrument: source.universe.instrument,
        assetClass: source.universe.assetClass,
        region: source.universe.region,
        lifecycle,
        qualityTier,
        score: scored.score,
        confidence: scored.confidence,
        dataCompleteness: candidate?.dataCompleteness ?? "NONE",
        freshness,
        supportingEvidence: scored.supporting,
        conflictingEvidence: scored.conflicting,
        missingInformation: scored.missing,
        invalidationConditions: buildInvalidationConditions(source, freshness),
        primaryReasons: scored.reasons,
        providerCoverage: candidate?.providerCoverage ?? "NONE",
        lastUpdated: timestamp,
        candidateInstrument: source.universe.instrument,
        dependencyGroups: [],
        analyticalContext,
      };

      if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
      allHorizonOpps.get(horizon)!.push(opp);
    }
  }

  // For each horizon: sort, filter by correlation, limit
  const results = new Map<TradingMode | InvestorHorizon, RadarOpportunity[]>();
  const allOpps: RadarOpportunity[] = [];

  for (const [horizon, opps] of allHorizonOpps) {
    const sorted = [...opps].sort((a, b) => b.score - a.score);
    const filtered = filterByCorrelation(sorted);
    const limited = filtered.slice(0, maxResults);
    results.set(horizon, limited);
    allOpps.push(...limited);
  }

  // Detect diffs from previous state
  const diffs: OpportunityDiff[] = [];
  if (previousState) {
    const currentMap = new Map<string, RadarOpportunity>();
    for (const opp of allOpps) {
      if (!currentMap.has(opp.instrument)) currentMap.set(opp.instrument, opp);
    }

    // Check appeared/disappeared/changed
    const allInstruments = new Set([
      ...previousState.previous.keys(),
      ...currentMap.keys(),
    ]);

    for (const instrument of allInstruments) {
      const prev = previousState.previous.get(instrument);
      const curr = currentMap.get(instrument);
      const changes: string[] = [];

      if (!prev && curr) {
        diffs.push({ instrument, changes: ["opportunity appeared"], appeared: true, disappeared: false });
      } else if (prev && !curr) {
        diffs.push({ instrument, changes: ["opportunity disappeared"], appeared: false, disappeared: true });
      } else if (prev && curr) {
        const scoreDelta = curr.score - prev.score;
        const confDelta = curr.confidence - prev.confidence;
        if (Math.abs(scoreDelta) > 5) changes.push(`score ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`);
        if (Math.abs(confDelta) > 5) changes.push(`confidence ${confDelta > 0 ? "+" : ""}${confDelta}`);
        if (prev.lifecycle !== curr.lifecycle) changes.push(`lifecycle ${prev.lifecycle} → ${curr.lifecycle}`);
        if (prev.qualityTier !== curr.qualityTier) changes.push(`tier ${prev.qualityTier} → ${curr.qualityTier}`);
        if (changes.length > 0) {
          diffs.push({
            instrument,
            changes,
            scoreDelta,
            confidenceDelta: confDelta,
            lifecycleChanged: prev.lifecycle !== curr.lifecycle,
            qualityTierChanged: prev.qualityTier !== curr.qualityTier,
            appeared: false,
            disappeared: false,
          });
        }
      }
    }
  }

  const fs = summarizeFreshness(freshnessLevels);

  return {
    results,
    diffs,
    totalScanned: filteredSources.length,
    totalWithLiveData,
    totalInsufficient,
    freshCount: fs.fresh,
    delayedCount: fs.delayed,
    staleCount: fs.stale,
    unavailableCount: fs.unavailable,
    timestamp,
    durationMs: Date.now() - startTime,
    providerErrors,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build state from result for next diff
// ═══════════════════════════════════════════════════════════════

export function buildRadarState(result: RadarScanResult): RadarState {
  const previous = new Map<string, RadarOpportunity>();
  for (const [, opps] of result.results) {
    for (const opp of opps) {
      if (!previous.has(opp.instrument)) {
        previous.set(opp.instrument, opp);
      }
    }
  }
  return { previous, lastScanAt: result.timestamp };
}
