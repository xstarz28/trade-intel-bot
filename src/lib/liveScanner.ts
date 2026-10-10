/**
 * Phase 50 — Live Universal Opportunity Scanner
 *
 * Orchestrates batch scanning of instruments across all asset classes
 * using the latest available market data and intelligence contexts.
 *
 * CRITICAL INVARIANTS:
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data → lower suitability or exclusion.
 *   - Stale data is only used where the horizon permits.
 *   - No fabricated data, prices, or evidence.
 *   - Same input + same timestamp → same output (deterministic).
 */

import type { AssetClass } from "./data/universal/types";
import type { CandidateInput, TradingMode, InvestorHorizon, UniversalRecommendationResult } from "./recommendation-engine";
import { generateRecommendation, discoverCandidates } from "./recommendation-engine";
import { buildCandidateFromSource, type LiveCandidateSource } from "./liveCandidateBuilder";

// ═══════════════════════════════════════════════════════════════
// SCANNER TYPES
// ═══════════════════════════════════════════════════════════════

export interface ScanConfig {
  /** Horizons to scan for. */
  horizons: (TradingMode | InvestorHorizon)[];
  /** Asset class filter (empty = all). */
  assetClasses?: AssetClass[];
  /** Region filter (empty = all). */
  regions?: string[];
  /** Maximum results per horizon. */
  maxResults?: number;
  /** Current timestamp override for determinism. */
  now?: number;
}

/**
 * Every horizon surfaced by Market Opportunities. Keeping this set centralized
 * prevents a background scan from silently omitting investing horizons.
 */
export const ALL_SCAN_HORIZONS: ScanConfig["horizons"] = [
  "SCALPING",
  "INTRADAY",
  "SWING",
  "1-4_WEEKS",
  "1-3_MONTHS",
  "3-6_MONTHS",
  "6-12_MONTHS",
  "1-3_YEARS",
  "3+_YEARS",
];

const TIMEFRAME_ALIASES: Record<string, string> = {
  "1M": "M1", "1MIN": "M1", "1MINUTE": "M1",
  "5M": "M5", "5MIN": "M5", "5MINUTE": "M5",
  "15M": "M15", "15MIN": "M15", "15MINUTE": "M15",
  "1H": "H1", "1HR": "H1", "4H": "H4", "4HR": "H4",
  "1D": "D1", "1DAY": "D1", "1W": "W1", "1WEEK": "W1",
};

export function normalizeScanTimeframe(value?: string): string | undefined {
  if (!value) return undefined;
  const tf = value.trim().toUpperCase().replace(/\s+/g, "");
  return TIMEFRAME_ALIASES[tf] ?? tf;
}

export function liveSourceCacheKey(instrument: string, timeframe?: string): string {
  return instrument.trim().toUpperCase() + "|" + (normalizeScanTimeframe(timeframe) ?? "UNKNOWN");
}

export function timeframeForHorizon(horizon: TradingMode | InvestorHorizon): string {
  switch (horizon) {
    case "SCALPING": return "M5";
    case "INTRADAY": return "H1";
    case "SWING":
    case "1-4_WEEKS": return "H4";
    case "1-3_MONTHS":
    case "3-6_MONTHS": return "D1";
    case "6-12_MONTHS":
    case "1-3_YEARS":
    case "3+_YEARS": return "W1";
  }
}

const HORIZON_TIMEFRAME_PREFERENCE: Record<TradingMode | InvestorHorizon, string[]> = {
  SCALPING: ["M5", "M1", "M15"],
  INTRADAY: ["H1", "M15", "H4"],
  SWING: ["H4", "D1", "W1"],
  "1-4_WEEKS": ["H4", "D1", "W1"],
  "1-3_MONTHS": ["D1", "W1", "H4"],
  "3-6_MONTHS": ["D1", "W1"],
  "6-12_MONTHS": ["W1", "D1"],
  "1-3_YEARS": ["W1", "D1"],
  "3+_YEARS": ["W1", "D1"],
};

export function selectCandidatesForHorizon(
  candidates: CandidateInput[],
  horizon: TradingMode | InvestorHorizon,
): CandidateInput[] {
  const preference = HORIZON_TIMEFRAME_PREFERENCE[horizon];
  const knownTimeframes = ["M1", "M5", "M15", "H1", "H4", "D1", "W1"];
  const groups = new Map<string, CandidateInput[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.instrument) ?? [];
    group.push(candidate);
    groups.set(candidate.instrument, group);
  }

  return Array.from(groups.values()).map((group) => [...group].sort((a, b) => {
    const aTf = normalizeScanTimeframe(a.marketTimeframe);
    const bTf = normalizeScanTimeframe(b.marketTimeframe);
    const rank = (tf?: string) => {
      if (!tf) return 1000;
      const preferred = preference.indexOf(tf);
      if (preferred >= 0) return preferred;
      const known = knownTimeframes.indexOf(tf);
      return 100 + (known >= 0 ? known : knownTimeframes.length);
    };
    const diff = rank(aTf) - rank(bTf);
    if (diff !== 0) return diff;
    const freshnessRank = (value: CandidateInput["freshness"]) => value === "FRESH" ? 0 : value === "DELAYED" ? 1 : value === "STALE" ? 2 : 3;
    if (freshnessRank(a.freshness) !== freshnessRank(b.freshness)) return freshnessRank(a.freshness) - freshnessRank(b.freshness);
    return Number(b.hasLiveData) - Number(a.hasLiveData);
  })[0]).filter(Boolean);
}

export interface ScanResult {
  /** Results keyed by horizon. */
  results: Map<TradingMode | InvestorHorizon, UniversalRecommendationResult>;
  /** Total instruments scanned. */
  totalScanned: number;
  /** Total with live data. */
  totalWithLiveData: number;
  /** Total with insufficient data. */
  totalInsufficient: number;
  /** Scan timestamp. */
  timestamp: number;
  /** Scan duration in ms. */
  durationMs: number;
  /** Provider errors encountered. */
  providerErrors: string[];
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS GATES PER HORIZON
// ═══════════════════════════════════════════════════════════════

const FRESHNESS_GATES: Record<string, { maxFreshness: string; requireLiveData: boolean }> = {
  SCALPING: { maxFreshness: "FRESH", requireLiveData: true },
  INTRADAY: { maxFreshness: "DELAYED", requireLiveData: false },
  SWING: { maxFreshness: "STALE", requireLiveData: false },
  "1-4_WEEKS": { maxFreshness: "STALE", requireLiveData: false },
  "1-3_MONTHS": { maxFreshness: "STALE", requireLiveData: false },
  "3-6_MONTHS": { maxFreshness: "STALE", requireLiveData: false },
  "6-12_MONTHS": { maxFreshness: "STALE", requireLiveData: false },
  "1-3_YEARS": { maxFreshness: "STALE", requireLiveData: false },
  "3+_YEARS": { maxFreshness: "STALE", requireLiveData: false },
};

const FRESHNESS_ORDER = ["FRESH", "DELAYED", "STALE", "UNAVAILABLE"];

function meetsFreshness(freshness: string, maxAllowed: string): boolean {
  const fi = FRESHNESS_ORDER.indexOf(freshness);
  const mi = FRESHNESS_ORDER.indexOf(maxAllowed);
  if (fi === -1 || mi === -1) return false;
  return fi <= mi;
}

// ═══════════════════════════════════════════════════════════════
// ROTATING DISCOVERY ACQUISITION
// ═══════════════════════════════════════════════════════════════

/**
 * Select a deterministic rotating batch from a discovered universe.
 *
 * This is NOT a whitelist and does not rank instruments. Every discovered
 * instrument remains eligible; the cursor only controls which instruments
 * receive acquisition work in the current cycle.
 */
export function selectRotatingDiscoveryBatch<T>(
  discovered: readonly T[],
  cursor: number,
  budget: number,
): { batch: T[]; nextCursor: number } {
  if (discovered.length === 0 || budget <= 0) {
    return { batch: [], nextCursor: 0 };
  }

  const normalizedCursor =
    ((cursor % discovered.length) + discovered.length) % discovered.length;

  const count = Math.min(Math.floor(budget), discovered.length);
  const batch = Array.from(
    { length: count },
    (_, index) => discovered[(normalizedCursor + index) % discovered.length],
  );

  return {
    batch,
    nextCursor: (normalizedCursor + count) % discovered.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// CANDIDATE PRE-PROCESSING
// ═══════════════════════════════════════════════════════════════

function applyFreshnessGates(
  candidates: CandidateInput[],
  horizon: TradingMode | InvestorHorizon,
): { eligible: CandidateInput[]; excluded: { instrument: string; reason: string }[] } {
  const gate = FRESHNESS_GATES[horizon] ?? FRESHNESS_GATES["INTRADAY"];
  const eligible: CandidateInput[] = [];
  const excluded: { instrument: string; reason: string }[] = [];

  for (const c of candidates) {
    // Freshness gate
    if (!meetsFreshness(c.freshness, gate.maxFreshness)) {
      excluded.push({
        instrument: c.instrument,
        reason: `freshness ${c.freshness} exceeds ${horizon} gate (${gate.maxFreshness} max)`,
      });
      continue;
    }

    // Live data gate for scalping
    if (gate.requireLiveData && !c.hasLiveData) {
      excluded.push({
        instrument: c.instrument,
        reason: `${horizon} requires live data`,
      });
      continue;
    }

    eligible.push(c);
  }

  return { eligible, excluded };
}

// ═══════════════════════════════════════════════════════════════
// LIVE SCANNER
// ═══════════════════════════════════════════════════════════════

export function scanInstruments(
  sources: LiveCandidateSource[],
  config: ScanConfig,
): ScanResult {
  const startTime = Date.now();
  const now = config.now ?? Date.now();
  const providerErrors: string[] = [];

  // Filter by asset class
  let filtered = sources;
  if (config.assetClasses && config.assetClasses.length > 0) {
    filtered = sources.filter(s => config.assetClasses!.includes(s.assetClass));
  }

  // Build candidates from sources
  const candidates = filtered.map(s => buildCandidateFromSource(s));

  // Scan each horizon
  const results = new Map<TradingMode | InvestorHorizon, UniversalRecommendationResult>();
  const allExcluded: { instrument: string; reason: string }[] = [];

  for (const horizon of config.horizons) {
    const horizonCandidates = selectCandidatesForHorizon(candidates, horizon);
    const { eligible, excluded } = applyFreshnessGates(horizonCandidates, horizon);
    allExcluded.push(...excluded);

    const result = generateRecommendation(eligible, horizon, {
      // Rank all observed eligible data first, then show only qualified results.
      maxResults: eligible.length,
    });

    // Preserve the full scored result for diagnostics and regression tests.
    // The trader-facing MarketOpportunities view separately shows only qualifying
    // TOP_OPPORTUNITY/WATCHLIST setups; do not destroy the scanner result here.

    // Merge excluded instruments from freshness gates
    result.excludedInstruments = [
      ...result.excludedInstruments,
      ...excluded.filter(e => !result.excludedInstruments.some(ri => ri.instrument === e.instrument)),
    ];

    results.set(horizon, result);
  }

  const totalWithLiveData = candidates.filter(c => c.hasLiveData).length;
  const totalInsufficient = candidates.filter(c => c.dataCompleteness === "NONE" || c.dataCompleteness === "MINIMAL").length;

  return {
    results,
    totalScanned: candidates.length,
    totalWithLiveData,
    totalInsufficient,
    timestamp: now,
    durationMs: Date.now() - startTime,
    providerErrors,
  };
}
