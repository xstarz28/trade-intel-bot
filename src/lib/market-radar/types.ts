/**
 * Phase 51 — Autonomous Market Radar Types
 *
 * Core type system for the autonomous multi-asset market radar.
 * INFORMATIONAL_ONLY — never modifies decision engine.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { CandidateInput, TradingMode, InvestorHorizon } from "@/lib/recommendation-engine";

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export type OpportunityLifecycle =
  | "DISCOVERED"
  | "QUALIFIED"
  | "ACTIVE"
  | "DEGRADED"
  | "INVALIDATED"
  | "EXPIRED";

// ═══════════════════════════════════════════════════════════════
// QUALITY TIERS
// ═══════════════════════════════════════════════════════════════

export type QualityTier =
  | "A"  // Strong Evidence
  | "B"  // Good Evidence
  | "C"  // Mixed Evidence
  | "D"  // Weak Evidence
  | "X"; // Insufficient Data

// ═══════════════════════════════════════════════════════════════
// FRESHNESS
// ═══════════════════════════════════════════════════════════════

export type FreshnessLevel = "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";

export const FRESHNESS_ORDER: FreshnessLevel[] = ["FRESH", "DELAYED", "STALE", "UNAVAILABLE"];

export function freshnessRank(f: FreshnessLevel): number {
  return FRESHNESS_ORDER.indexOf(f);
}

export function meetsFreshness(actual: FreshnessLevel, maxAllowed: FreshnessLevel): boolean {
  return freshnessRank(actual) <= freshnessRank(maxAllowed);
}

// ═══════════════════════════════════════════════════════════════
// HORIZON REFRESH PRIORITY
// ═══════════════════════════════════════════════════════════════

export type RefreshPriority = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

export const HORIZON_REFRESH_PRIORITY: Record<TradingMode | InvestorHorizon, RefreshPriority> = {
  SCALPING: "CRITICAL",
  INTRADAY: "HIGH",
  SWING: "MODERATE",
  "1-4_WEEKS": "MODERATE",
  "1-3_MONTHS": "LOW",
  "3-6_MONTHS": "LOW",
  "6-12_MONTHS": "LOW",
  "1-3_YEARS": "LOW",
  "3+_YEARS": "LOW",
};

// ═══════════════════════════════════════════════════════════════
// FRESHNESS GATES PER HORIZON
// ═══════════════════════════════════════════════════════════════

export interface FreshnessGate {
  maxFreshness: FreshnessLevel;
  requireLiveData: boolean;
  description: string;
}

export const HORIZON_FRESHNESS_GATES: Record<TradingMode | InvestorHorizon, FreshnessGate> = {
  SCALPING: { maxFreshness: "FRESH", requireLiveData: true, description: "Requires live, fresh data" },
  INTRADAY: { maxFreshness: "DELAYED", requireLiveData: false, description: "Delayed acceptable" },
  SWING: { maxFreshness: "STALE", requireLiveData: false, description: "Stale acceptable for slow-moving" },
  "1-4_WEEKS": { maxFreshness: "STALE", requireLiveData: false, description: "Stale acceptable" },
  "1-3_MONTHS": { maxFreshness: "STALE", requireLiveData: false, description: "Fundamental freshness tolerant" },
  "3-6_MONTHS": { maxFreshness: "STALE", requireLiveData: false, description: "Long-horizon tolerant" },
  "6-12_MONTHS": { maxFreshness: "STALE", requireLiveData: false, description: "Long-horizon tolerant" },
  "1-3_YEARS": { maxFreshness: "STALE", requireLiveData: false, description: "Long-horizon tolerant" },
  "3+_YEARS": { maxFreshness: "STALE", requireLiveData: false, description: "Long-horizon tolerant" },
};

// ═══════════════════════════════════════════════════════════════
// PROVIDER RATE LIMIT
// ═══════════════════════════════════════════════════════════════

export interface ProviderRateLimitState {
  provider: string;
  /** Requests made in current window. */
  requestCount: number;
  /** Max requests per window. */
  maxRequests: number;
  /** Window start timestamp. */
  windowStart: number;
  /** Cooldown until timestamp (set after 429). */
  cooldownUntil: number;
  /** Exponential backoff factor. */
  backoffFactor: number;
  /** Total requests ever made. */
  totalRequests: number;
  /** Total failures. */
  totalFailures: number;
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

export interface CacheEntry<T = unknown> {
  key: string;
  provider: string;
  instrument: string;
  capability: string;
  timeframe?: string;
  data: T;
  timestamp: number;
  ttlMs: number;
  stale: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  evictions: number;
  size: number;
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA ACQUISITION
// ═══════════════════════════════════════════════════════════════

export interface MarketSnapshot {
  instrument: string;
  assetClass: AssetClass;
  region?: string;
  /** Current price. */
  price: number;
  /** 24h change %. */
  change24h?: number;
  /** 24h volume. */
  volume24h?: number;
  /** Bid-ask spread in bps. */
  spreadBps?: number;
  /** Volatility measure (ATR or implied). */
  volatility?: number;
  /** Available OHLCV data. */
  ohlcvAvailable: boolean;
  /** Available timeframes. */
  availableTimeframes: string[];
  /** HTF bias if computable. */
  htfBias?: "long" | "short" | "neutral" | "unknown";
  /** Market regime. */
  marketRegime?: string;
  /** MTF alignment. */
  mtfAlignment?: string;
  /** Provider that supplied this data. */
  provider: string;
  /** Observation timestamp. */
  observedAt: number;
  /** Data freshness. */
  freshness: FreshnessLevel;
  /** Data quality. */
  quality: "VERIFIED" | "DEGRADED" | "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY
// ═══════════════════════════════════════════════════════════════

export interface RadarOpportunity {
  /** Canonical instrument. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Region. */
  region?: string;
  /** Lifecycle state. */
  lifecycle: OpportunityLifecycle;
  /** Quality tier. */
  qualityTier: QualityTier;
  /** Opportunity score (0-100). */
  score: number;
  /** Evidence confidence (0-100). NOT probability of profit. */
  confidence: number;
  /** Data completeness. */
  dataCompleteness: "FULL" | "PARTIAL" | "MINIMAL" | "NONE";
  /** Data freshness. */
  freshness: FreshnessLevel;
  /** Supporting evidence. */
  supportingEvidence: string[];
  /** Conflicting evidence. */
  conflictingEvidence: string[];
  /** Missing information. */
  missingInformation: string[];
  /** Invalidation conditions. */
  invalidationConditions: string[];
  /** Primary reasons for this ranking. */
  primaryReasons: string[];
  /** Provider coverage. */
  providerCoverage: string;
  /** Last update timestamp. */
  lastUpdated: number;
  /** Source candidate for building this opportunity. */
  candidateInstrument: string;
  /** Dependency groups tracked. */
  dependencyGroups: string[];
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY SNAPSHOT / DIFF
// ═══════════════════════════════════════════════════════════════

export interface OpportunityDiff {
  instrument: string;
  changes: string[];
  scoreDelta?: number;
  confidenceDelta?: number;
  lifecycleChanged?: boolean;
  qualityTierChanged?: boolean;
  appeared: boolean;
  disappeared: boolean;
}

// ═══════════════════════════════════════════════════════════════
// RADAR RESULT
// ═══════════════════════════════════════════════════════════════

export interface RadarScanConfig {
  /** Horizons to evaluate. */
  horizons: (TradingMode | InvestorHorizon)[];
  /** Asset class filter (empty = all). */
  assetClasses?: AssetClass[];
  /** Region filter (empty = all). */
  regions?: string[];
  /** Maximum results per horizon. */
  maxResults?: number;
  /** Current timestamp override for determinism. */
  now?: number;
  /** User-selected instrument for priority refresh. */
  userFocusInstrument?: string;
}

export interface RadarScanResult {
  /** Opportunities keyed by horizon. */
  results: Map<TradingMode | InvestorHorizon, RadarOpportunity[]>;
  /** Diffs from previous scan. */
  diffs: OpportunityDiff[];
  /** Total instruments scanned. */
  totalScanned: number;
  /** Total with live data. */
  totalWithLiveData: number;
  /** Total with insufficient data. */
  totalInsufficient: number;
  /** Fresh count. */
  freshCount: number;
  /** Delayed count. */
  delayedCount: number;
  /** Stale count. */
  staleCount: number;
  /** Unavailable count. */
  unavailableCount: number;
  /** Scan timestamp. */
  timestamp: number;
  /** Scan duration in ms. */
  durationMs: number;
  /** Provider errors. */
  providerErrors: string[];
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION / DEPENDENCY CLUSTERS
// ═══════════════════════════════════════════════════════════════

export interface CorrelationCluster {
  /** Cluster ID. */
  id: string;
  /** Instruments in this cluster. */
  instruments: string[];
  /** Description of the cluster relationship. */
  relationship: string;
  /** Maximum instruments from this cluster to display. */
  maxDisplay: number;
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSE ENTRY
// ═══════════════════════════════════════════════════════════════

export interface UniverseEntry {
  instrument: string;
  assetClass: AssetClass;
  region?: string;
  /** Required capabilities for full evaluation. */
  requiredCapabilities: string[];
  /** Priority (lower = higher priority). */
  priority: number;
  /** Refresh interval ms for primary scanning. */
  refreshIntervalMs: number;
}
