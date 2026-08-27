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
    const { eligible, excluded } = applyFreshnessGates(candidates, horizon);
    allExcluded.push(...excluded);

    const result = generateRecommendation(eligible, horizon, {
      maxResults: config.maxResults ?? 10,
    });

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

// ═══════════════════════════════════════════════════════════════
// DEFAULT SCAN UNIVERSE
// ═══════════════════════════════════════════════════════════════

export interface ScanUniverseEntry {
  instrument: string;
  assetClass: AssetClass;
}

/** Default instruments to scan — covers all asset classes with key representatives. */
export const DEFAULT_SCAN_UNIVERSE: ScanUniverseEntry[] = [
  // Crypto
  { instrument: "BTC/USD", assetClass: "crypto" },
  { instrument: "ETH/USD", assetClass: "crypto" },
  { instrument: "SOL/USD", assetClass: "crypto" },
  { instrument: "DOGE/USD", assetClass: "crypto" },
  // Forex
  { instrument: "EUR/USD", assetClass: "forex" },
  { instrument: "GBP/USD", assetClass: "forex" },
  { instrument: "USD/JPY", assetClass: "forex" },
  { instrument: "USD/IDR", assetClass: "forex" },
  // Equities — US
  { instrument: "AAPL", assetClass: "equity" },
  { instrument: "MSFT", assetClass: "equity" },
  { instrument: "NVDA", assetClass: "equity" },
  { instrument: "TSLA", assetClass: "equity" },
  // Equities — IDX
  { instrument: "BBCA", assetClass: "equity" },
  { instrument: "BBRI", assetClass: "equity" },
  { instrument: "TLKM", assetClass: "equity" },
  { instrument: "BMRI", assetClass: "equity" },
  // Commodities
  { instrument: "XAU/USD", assetClass: "commodity" },
  { instrument: "XAG/USD", assetClass: "commodity" },
  { instrument: "WTI", assetClass: "commodity" },
  { instrument: "BRENT", assetClass: "commodity" },
  // Indices
  { instrument: "SPX", assetClass: "indices" },
  { instrument: "NDX", assetClass: "indices" },
  { instrument: "DJI", assetClass: "indices" },
  { instrument: "IHSG", assetClass: "indices" },
  // Macro
  { instrument: "DXY", assetClass: "macro" },
];

/**
 * Create a scan universe filtered by asset classes.
 */
export function getScanUniverse(assetClasses?: AssetClass[]): ScanUniverseEntry[] {
  if (!assetClasses || assetClasses.length === 0) return DEFAULT_SCAN_UNIVERSE;
  return DEFAULT_SCAN_UNIVERSE.filter(e => assetClasses.includes(e.assetClass));
}
