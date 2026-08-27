/**
 * Phase 51 — Radar Candidate Builder
 *
 * Builds CandidateInput objects directly from market snapshots and
 * provider data, WITHOUT requiring analysis history.
 *
 * Analysis history is ONE source of evidence, not the primary source.
 * Missing components remain missing — never fabricated.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { CandidateInput, DataCompletenessLevel } from "@/lib/recommendation-engine";
import type { MarketSnapshot, FreshnessLevel } from "./types";
import type { UniverseEntry } from "./types";
import { assessFreshness } from "./freshness";

// ═══════════════════════════════════════════════════════════════
// RADAR CANDIDATE SOURCE
// ═══════════════════════════════════════════════════════════════

export interface RadarCandidateSource {
  /** Instrument universe entry. */
  universe: UniverseEntry;
  /** Market snapshot from provider (if available). */
  snapshot?: MarketSnapshot | null;
  /** Optional additional intelligence. */
  derivatives?: {
    fundingRate?: number;
    openInterest?: number;
    liquidationVolume?: number;
  };
  /** Optional fundamentals (equity). */
  fundamentals?: {
    peRatio?: number;
    profitMargin?: number;
    marketCap?: number;
    revenueGrowth?: number;
  };
  /** Optional COT data (forex/commodity). */
  cot?: {
    netNonCommercial?: number;
  };
  /** Optional EIA data (commodity). */
  eia?: {
    inventory?: number;
    inventoryChange?: number;
    futuresStructure?: string;
  };
  /** Optional treasury/macro data. */
  treasury?: {
    tenYearYield?: number;
    dxyTrend?: "rising" | "falling" | "stable";
    riskRegime?: string;
  };
  /** Analysis result if available (optional, not required). */
  analysisResult?: {
    confidence?: string;
    bias?: string;
    recommendation?: string;
    technicalData?: {
      htfBias?: string;
      mtfAlignment?: string;
      marketRegime?: string;
      atr?: number;
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA COMPLETENESS ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessDataCompleteness(source: RadarCandidateSource): DataCompletenessLevel {
  let count = 0;
  if (source.snapshot?.price && source.snapshot.price > 0) count++;
  if (source.snapshot?.ohlcvAvailable) count++;
  if (source.snapshot?.htfBias && source.snapshot.htfBias !== "unknown") count++;
  if (source.snapshot?.mtfAlignment) count++;
  if (source.snapshot?.marketRegime) count++;
  if (source.derivatives?.fundingRate !== undefined) count++;
  if (source.derivatives?.openInterest !== undefined) count++;
  if (source.fundamentals?.peRatio !== undefined) count++;
  if (source.cot?.netNonCommercial !== undefined) count++;
  if (source.eia?.inventory !== undefined) count++;
  if (source.treasury?.tenYearYield !== undefined) count++;
  if (source.analysisResult) count++;

  if (count >= 6) return "FULL";
  if (count >= 4) return "PARTIAL";
  if (count >= 2) return "MINIMAL";
  if (count >= 1) return "MINIMAL";
  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER COVERAGE ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessProviderCoverage(source: RadarCandidateSource): CandidateInput["providerCoverage"] {
  let total = source.universe.requiredCapabilities.length;
  if (total === 0) return "FULL";
  let available = 0;
  if (source.snapshot?.price && source.snapshot.price > 0) available++;
  if (source.snapshot?.ohlcvAvailable) available++;
  if (source.derivatives) available++;
  if (source.fundamentals) available++;
  if (source.cot) available++;
  if (source.eia) available++;
  if (source.treasury) available++;

  const ratio = available / total;
  if (ratio >= 0.8) return "FULL";
  if (ratio >= 0.5) return "PARTIAL";
  if (ratio >= 0.2) return "MINIMAL";
  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// CANDIDATE BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildRadarCandidate(
  source: RadarCandidateSource,
  now?: number,
): CandidateInput {
  const timestamp = now ?? Date.now();
  const snapshot = source.snapshot;
  const freshness: FreshnessLevel = snapshot
    ? assessFreshness(snapshot.observedAt, timestamp)
    : "UNAVAILABLE";

  const dataCompleteness = assessDataCompleteness(source);
  const providerCoverage = assessProviderCoverage(source);

  const price = snapshot?.price ?? 0;
  const hasLiveData = freshness === "FRESH" || freshness === "DELAYED";

  // Build candidate from available data — never fabricate
  const candidate: CandidateInput = {
    instrument: source.universe.instrument,
    assetClass: source.universe.assetClass,
    currentPrice: price,
    dataCompleteness,
    dataPoints: snapshot?.ohlcvAvailable ? 50 : 0, // estimated when OHLCV is available
    hasLiveData,
    freshness,
    providerCoverage,
  };

  // Market structure (only from real data)
  if (snapshot?.htfBias) {
    candidate.htfBias = snapshot.htfBias as CandidateInput["htfBias"];
  }
  if (snapshot?.marketRegime) {
    candidate.marketRegime = snapshot.marketRegime;
  }
  if (snapshot?.mtfAlignment) {
    candidate.mtfAlignment = snapshot.mtfAlignment;
  }
  if (snapshot?.volatility) {
    candidate.atr = snapshot.volatility;
  }
  if (snapshot?.spreadBps) {
    candidate.spreadBps = snapshot.spreadBps;
  }

  // Analysis-derived structure (if available, additive only)
  if (source.analysisResult?.technicalData) {
    const tech = source.analysisResult.technicalData;
    if (tech.htfBias && !candidate.htfBias) {
      candidate.htfBias = tech.htfBias as CandidateInput["htfBias"];
    }
    if (tech.mtfAlignment && !candidate.mtfAlignment) {
      candidate.mtfAlignment = tech.mtfAlignment;
    }
    if (tech.marketRegime && !candidate.marketRegime) {
      candidate.marketRegime = tech.marketRegime;
    }
    if (tech.atr && !candidate.atr) {
      candidate.atr = tech.atr;
    }
  }

  // ── Asset-class-specific data ──

  // Crypto
  if (source.derivatives) {
    candidate.hasDerivatives = true;
    candidate.fundingRate = source.derivatives.fundingRate;
    candidate.openInterest = source.derivatives.openInterest;
  }

  // Equity
  if (source.fundamentals) {
    candidate.hasFundamentals = true;
    candidate.peRatio = source.fundamentals.peRatio;
    candidate.profitMargin = source.fundamentals.profitMargin;
    candidate.marketCap = source.fundamentals.marketCap;
    candidate.revenueGrowth = source.fundamentals.revenueGrowth;
  }

  // Forex / Commodity — COT
  if (source.cot) {
    candidate.hasCOT = true;
    candidate.cotNet = source.cot.netNonCommercial;
  }

  // Commodity — EIA
  if (source.eia) {
    candidate.inventory = source.eia.inventory;
    candidate.inventoryChange = source.eia.inventoryChange;
    candidate.futuresStructure = source.eia.futuresStructure;
  }

  // Macro
  if (source.treasury) {
    candidate.hasMacro = true;
    candidate.dxyTrend = source.treasury.dxyTrend;
    candidate.riskRegime = source.treasury.riskRegime;
  }

  // Analysis metadata (additive)
  if (source.analysisResult) {
    candidate.hasAnalysis = true;
    const confStr = source.analysisResult.confidence;
    if (confStr) {
      const num = parseInt(confStr, 10);
      if (!isNaN(num)) candidate.analysisConfidence = num;
    }
  }

  return candidate;
}
