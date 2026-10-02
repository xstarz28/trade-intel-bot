/**
 * Phase 312 — BTC ↔ altcoin relationship from REAL return series.
 *
 * The source document describes the Bitcoin/altcoin relationship as market
 * foundation context. This module computes it ONLY from actual overlapping
 * close-to-close returns of two real candle series (never from symbol names,
 * never from raw prices). Where no verified comparator series exists the
 * answer is explicitly unavailable. The relationship is context — never an
 * automatic directional proof, and it contributes no score.
 */

import type { OhlcvCandle } from "../data/market-types";
import { pearsonCorrelation } from "../market-context";

export interface BtcAltcoinContext {
  available: boolean;
  unavailableReason?: string;
  /** Number of aligned return observations actually used. */
  sampleSize: number;
  /** Observation timeframe of the input series (metadata passthrough). */
  observationTimeframe: string;
  /** Provider of the alt series (provenance). */
  provider?: string;
  /** The alt series' last candle timestamp (verbatim provenance). */
  observedAt?: number;
  /** Pearson correlation over the aligned returns, in [-1, 1]. */
  correlation?: number;
  /**
   * Fixed contextual reading — the relationship NEVER upgrades into a
   * directional claim by itself.
   */
  relationship: "context_only";
}

/**
 * Compute the BTC↔alt context from two real candle series. Deterministic.
 * Requires ≥20 aligned return observations (the correlation helper's own
 * honesty floor); fewer returns `available: false`.
 */
export function btcAltcoinContext(input: {
  alt: OhlcvCandle[];
  btc?: OhlcvCandle[];
  altTimeframe: string;
  altProvider?: string;
}): BtcAltcoinContext {
  const { alt, btc, altTimeframe, altProvider } = input;
  const base: BtcAltcoinContext = {
    available: false,
    sampleSize: 0,
    observationTimeframe: altTimeframe,
    relationship: "context_only",
    ...(altProvider ? { provider: altProvider } : {}),
    ...(alt.length > 0 ? { observedAt: alt[alt.length - 1].timestamp } : {}),
  };
  if (!btc || btc.length === 0) {
    return { ...base, unavailableReason: "no verified BTC comparator series available" };
  }
  if (alt.length < 2) {
    return { ...base, unavailableReason: "alt series too short to form returns" };
  }

  // Align by timestamp intersection, then compute close-to-close returns on
  // each aligned series.
  const btcByTime = new Map<number, number>();
  for (const c of btc) btcByTime.set(c.timestamp, c.close);
  const common = alt.map((c) => c.timestamp).filter((t) => btcByTime.has(t));
  if (common.length < 3) {
    return { ...base, unavailableReason: "no overlapping observation window with the BTC series" };
  }
  const commonSet = new Set(common);
  const altAligned = alt.filter((c) => commonSet.has(c.timestamp));
  const btcAligned = common.map((t) => btcByTime.get(t) as number);

  const altReturns: number[] = [];
  for (let i = 1; i < altAligned.length; i++) {
    const prev = altAligned[i - 1].close;
    if (prev > 0) altReturns.push((altAligned[i].close - prev) / prev);
  }
  const btcReturns: number[] = [];
  for (let i = 1; i < btcAligned.length; i++) {
    const prev = btcAligned[i - 1];
    if (prev > 0) btcReturns.push((btcAligned[i] - prev) / prev);
  }
  if (altReturns.length !== btcReturns.length || altReturns.length === 0) {
    return { ...base, unavailableReason: "aligned return series could not be formed" };
  }

  const pearson = pearsonCorrelation(altReturns, btcReturns);
  if (!pearson) {
    return {
      ...base,
      unavailableReason: `insufficient overlapping returns: ${altReturns.length} available, 20 required`,
    };
  }
  return {
    ...base,
    available: true,
    sampleSize: pearson.n,
    correlation: pearson.correlation,
  };
}
