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
import { generateRecommendation } from "./recommendation-engine";
import { buildCandidateFromSource, type LiveCandidateSource } from "./liveCandidateBuilder";
import { limitByCorrelationGroup } from "./discovery/correlation";

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
  /**
   * Phase 158 — max instruments per derived correlation group in the
   * ranked output (e.g. BTC spot + BTC perp + BTC future are one group).
   *
   * Applies only to candidates carrying a `correlationKey`. Undefined or 0
   * disables the cap, preserving pre-Phase-158 behaviour.
   */
  maxPerCorrelationGroup?: number;
  /**
   * Phase 161 — provider/acquisition failures observed while assembling
   * `sources` for this scan.
   *
   * The scanner cannot see upstream failures on its own: a provider outage
   * simply yields fewer sources, which is indistinguishable from a market
   * with fewer opportunities. Passing them in keeps a degraded scan
   * visibly degraded.
   */
  providerErrors?: string[];
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
  /**
   * Phase 161 — true when this scan ran with known provider failures.
   *
   * A degraded scan is still a real scan of real data; it simply covers
   * less of the market than usual. Callers must be able to distinguish
   * "few opportunities exist" from "we could not look properly".
   */
  degraded: boolean;
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
  // Upstream acquisition/discovery failures are carried through verbatim so
  // the caller can see WHY a scan is thin.
  const providerErrors: string[] = [...(config.providerErrors ?? [])];

  // Filter by asset class
  let filtered = sources;
  if (config.assetClasses && config.assetClasses.length > 0) {
    filtered = sources.filter(s => config.assetClasses!.includes(s.assetClass));
  }

  // Build candidates from sources
  // Pass the scan timestamp so freshness gating is deterministic and
  // consistent across every candidate in this scan.
  const candidates = filtered.map(s => buildCandidateFromSource(s, now));

  // Scan each horizon
  const results = new Map<TradingMode | InvestorHorizon, UniversalRecommendationResult>();
  const allExcluded: { instrument: string; reason: string }[] = [];

  for (const horizon of config.horizons) {
    const { eligible, excluded } = applyFreshnessGates(candidates, horizon);
    allExcluded.push(...excluded);

    const result = generateRecommendation(eligible, horizon, {
      maxResults: config.maxResults ?? 10,
    });

    // Phase 158 — cap correlated exposure in the ranked output.
    // Ranking order is preserved; only surplus correlated entries are
    // removed, and each removal is reported explicitly.
    if (config.maxPerCorrelationGroup && config.maxPerCorrelationGroup > 0) {
      const keyByInstrument = new Map(
        eligible
          .filter((c) => c.correlationKey)
          .map((c) => [c.instrument, c.correlationKey!] as const),
      );

      const kept = limitByCorrelationGroup(
        result.rankedInstruments,
        (ranked) => keyByInstrument.get(ranked.instrument),
        config.maxPerCorrelationGroup,
      );

      if (kept.length !== result.rankedInstruments.length) {
        const keptSet = new Set(kept.map((r) => r.instrument));
        for (const ranked of result.rankedInstruments) {
          if (keptSet.has(ranked.instrument)) continue;
          allExcluded.push({
            instrument: ranked.instrument,
            reason: `correlated exposure limit reached for group ${
              keyByInstrument.get(ranked.instrument) ?? "unknown"
            }`,
          });
          result.excludedInstruments.push({
            instrument: ranked.instrument,
            reason: `correlated exposure limit reached for group ${
              keyByInstrument.get(ranked.instrument) ?? "unknown"
            }`,
          });
        }
        // Re-rank so positions stay contiguous (1..n).
        result.rankedInstruments = kept.map((ranked, index) => ({
          ...ranked,
          rank: index + 1,
        }));
      }
    }

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
    degraded: providerErrors.length > 0,
  };
}
