/**
 * Phase 312 — the strategy context: one descriptive block that rides on the
 * SAME real candles the classical stack read. Pure derivation, no scoring:
 * zones / patterns / candle formations / Unicorn composition are CONTEXT and
 * provably feed no score anywhere (the recommendation engine never reads this
 * block — locked by test).
 */

import type { OhlcvCandle, SmcContext } from "../data/market-types";
import { computeSmcContext } from "../data/smc";
import {
  detectSupplyDemandZones,
  type SupplyDemandZone,
} from "./zones";
import { detectChartPatterns, type DetectedPattern } from "./patterns";
import { detectCandleFormations, type CandleFormation } from "./candles";
import { evaluateUnicornModel, type UnicornEvaluation } from "./unicorn";

export interface StrategyContext {
  timeframe: string;
  zones: SupplyDemandZone[];
  patterns: DetectedPattern[];
  formations: CandleFormation[];
  unicorn: UnicornEvaluation;
  /** Provenance of the candle window everything above was derived from. */
  provenance: {
    candleCount: number;
    firstTimestamp: number;
    lastTimestamp: number;
  };
}

/**
 * Build the strategy context from real candles. Deterministic. An existing
 * SmcContext may be supplied to avoid recomputation; otherwise one is computed
 * from the same candles (never from different data).
 */
export function buildStrategyContext(
  candles: OhlcvCandle[],
  timeframe: string,
  smc?: SmcContext,
): StrategyContext {
  const smcCtx = smc ?? computeSmcContext(candles, timeframe);
  return {
    timeframe,
    zones: detectSupplyDemandZones(candles, timeframe),
    patterns: detectChartPatterns(candles, timeframe),
    formations: detectCandleFormations(candles, timeframe),
    unicorn: evaluateUnicornModel(smcCtx),
    provenance: {
      candleCount: candles.length,
      firstTimestamp: candles[0]?.timestamp ?? 0,
      lastTimestamp: candles[candles.length - 1]?.timestamp ?? 0,
    },
  };
}
