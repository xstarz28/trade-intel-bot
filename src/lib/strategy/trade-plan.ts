/**
 * Phase 312 addendum — the ADAPTIVE trade-plan layer.
 *
 * Consumes a FINISHED AnalysisResult (never a second engine, never a score):
 *   · ENTRY comes from a setup that was actually DETECTED on the same candles
 *     (supply/demand zone proximal edge, validated order-block bound, or
 *     same-direction FVG bound) — never random, never "current price" when
 *     setup evidence exists. With no setup evidence the engine's published
 *     entry reference is used VERBATIM with its own basis string.
 *   · STOP comes from invalidation structure (the setup object's distal/far
 *     edge, or the engine's structural stop with its provenance). Never a bare
 *     "2%" / "1 ATR" number without an evidence basis.
 *   · TP1 is the engine's structural target (basis verbatim). TP2 exists ONLY
 *     when a second real structural object (opposing zone or still-resting
 *     liquidity pool) actually lies beyond TP1.
 *   · Actionability NEVER upgrades the engine: engine NO_TRADE stays NO_TRADE.
 *     A negative recorded-outcome expectancy forces NO_TRADE; undefined
 *     expectancy (no valid history) or an R:R below the user's configured
 *     minimum forces WAIT — the plan is never dressed up to look better.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { OhlcvCandle } from "../data/market-types";
import type { NormalizedRiskPolicy } from "./policy";
import type { ProbabilityAssessment } from "./probability";

export interface AdaptiveTradePlan {
  available: boolean;
  unavailableReason?: string;
  direction?: "long" | "short";
  entry?: number;
  entryBasis?: string;
  /** The detected setup the entry came from, with its causal knowledge time. */
  entrySetup?: { kind: string; label: string; knownAt: number; source: string };
  stop?: number;
  stopBasis?: string;
  invalidationSetup?: { kind: string; label: string; knownAt: number; source: string };
  tp1?: number;
  tp1Basis?: string;
  tp2?: number;
  tp2Basis?: string;
  tp2Setup?: { kind: string; label: string; knownAt: number; source: string };
  riskDistance?: number;
  rewardDistance?: number;
  /** rewardDistance / riskDistance measured to TP1, in R units. */
  rMultipleToTp1?: number;
  riskReward?: number;
  /** VALIDATED | WAIT | NO_TRADE — with the exact deterministic reason. */
  actionability: "VALIDATED" | "WAIT" | "NO_TRADE";
  actionabilityReason: string;
  /** Reasons recorded verbatim when the engine itself rejected the trade. */
  engineNoTradeReasons?: string[];
  limitations: string[];
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseLevel(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

interface SetupRef {
  kind: string;
  label: string;
  knownAt: number;
  source: string;
  entry: number;
  stop: number;
  stopBasis: string;
}

/**
 * Pick the setup-based entry/stop from ACTUALLY detected objects, nearest to
 * the engine's market reference. Deterministic: zones (proximal edge) rank
 * first, then validated order blocks, then fresh same-direction FVGs.
 */
function pickSetupEntry(result: AnalysisResult, direction: "long" | "short"): SetupRef | undefined {
  const td = result.technicalData;
  const strategy = td?.strategy;
  const refPrice = parseLevel(result.tradePlan?.entry);
  const byDistance = (a: number, b: number): number => {
    if (!finite(refPrice)) return 0;
    return Math.abs(a - refPrice) - Math.abs(b - refPrice);
  };

  const zones = (strategy?.zones ?? [])
    .filter((z) => z.side === (direction === "long" ? "demand" : "supply"))
    .filter((z) => z.lifecycle !== "broken" && finite(z.proximal) && finite(z.distal))
    .filter((z) => (direction === "long" ? z.proximal <= refPrice! || z.priceLocation === "inside" : z.proximal >= refPrice! || z.priceLocation === "inside"))
    .sort((a, b) => byDistance(a.proximal, b.proximal));
  if (zones.length > 0) {
    const z = zones[0];
    return {
      kind: "supply_demand_zone",
      label: `${z.side} ${z.kind} zone ${z.distal}–${z.proximal} (${z.lifecycle}, ${z.timeframe})`,
      knownAt: z.baseEndTime,
      source: "strategy/zones — proximal edge entry, distal edge invalidation",
      entry: z.proximal,
      stop: z.distal,
      stopBasis: `distal edge of the detected ${z.side} ${z.kind} zone (${z.distal}) — the level at which the zone itself fails`,
    };
  }
  const obs = (td?.smc?.orderBlocks ?? [])
    .filter((ob) => ob.direction === (direction === "long" ? "bullish" : "bearish") && ob.status !== "invalidated" && finite(ob.upper) && finite(ob.lower))
    .sort((a, b) => byDistance(direction === "long" ? a.upper : a.lower, direction === "long" ? b.upper : b.lower));
  if (obs.length > 0) {
    const ob = obs[0];
    const entry = direction === "long" ? ob.upper : ob.lower;
    const stop = direction === "long" ? ob.lower : ob.upper;
    return {
      kind: "order_block",
      label: `${ob.direction} order block ${ob.lower}–${ob.upper} (${ob.status}, ${ob.timeframe})`,
      knownAt: ob.displacementTime,
      source: "data/smc order block — block boundary entry, opposite boundary invalidation",
      entry,
      stop,
      stopBasis: `far boundary of the detected ${ob.direction} order block (${stop}) — the block is void beyond it`,
    };
  }
  const fvgs = (td?.smc?.fvgs ?? [])
    .filter((f) => f.direction === (direction === "long" ? "bullish" : "bearish") && f.status !== "invalidated" && finite(f.upper) && finite(f.lower))
    .sort((a, b) => byDistance(direction === "long" ? a.upper : a.lower, direction === "long" ? b.upper : b.lower));
  if (fvgs.length > 0) {
    const f = fvgs[0];
    const entry = direction === "long" ? f.upper : f.lower;
    const stop = direction === "long" ? f.lower : f.upper;
    return {
      kind: "fair_value_gap",
      label: `${f.direction} FVG ${f.lower}–${f.upper} (${f.status}, ${f.timeframe})`,
      knownAt: f.createdAt,
      source: "data/smc fair value gap — near bound entry, far bound invalidation",
      entry,
      stop,
      stopBasis: `far bound of the detected ${f.direction} fair value gap (${stop}) — the gap is void beyond it`,
    };
  }
  return undefined;
}

/** Second REAL structural target strictly beyond TP1 in the plan direction. */
function pickTp2(result: AnalysisResult, direction: "long" | "short", tp1: number | undefined) {
  const td = result.technicalData;
  const beyond = (v: number): boolean =>
    finite(tp1) ? (direction === "long" ? v > tp1! : v < tp1!) : true;
  const byProximity = (a: number, b: number): number => (direction === "long" ? a - b : b - a);
  if (finite(tp1)) {
    const zones = (td?.strategy?.zones ?? [])
      .filter((z) => z.side === (direction === "long" ? "supply" : "demand"))
      .filter((z) => z.lifecycle !== "broken" && finite(z.proximal) && beyond(z.proximal))
      .sort((a, b) => byProximity(a.proximal, b.proximal));
    if (zones.length > 0) {
      const z = zones[0];
      return {
        tp2: z.proximal,
        basis: `proximal edge of the detected opposing ${z.side} ${z.kind} zone (${z.proximal}, ${z.lifecycle})`,
        setup: {
          kind: "supply_demand_zone",
          label: `opposing ${z.side} ${z.kind} zone ${z.distal}–${z.proximal}`,
          knownAt: z.baseEndTime,
          source: "strategy/zones",
        } as const,
      };
    }
    const pools = (td?.smc?.liquidityPools ?? [])
      .filter((p) => !p.broken && !p.swept && finite(p.level) && beyond(p.level))
      .filter((p) => (direction === "long" ? p.side === "buy_side" : p.side === "sell_side"))
      .sort((a, b) => byProximity(a.level, b.level));
    if (pools.length > 0) {
      const p = pools[0];
      const side = p.side === "buy_side" ? "BSL" : "SSL";
      return {
        tp2: p.level,
        basis: `resting ${side} liquidity at ${p.level} (${p.touches} touch swing level, not yet swept)`,
        setup: {
          kind: "liquidity_pool",
          label: `resting ${side} liquidity ${p.level}`,
          knownAt: p.formedAtTime,
          source: "data/smc liquidity pools",
        } as const,
      };
    }
  }
  return undefined;
}

export function buildAdaptiveTradePlan(
  result: AnalysisResult,
  opts: {
    policy?: NormalizedRiskPolicy;
    expectancy?: ProbabilityAssessment;
    candles?: OhlcvCandle[];
  } = {},
): AdaptiveTradePlan {
  const enginePlan = result.tradePlan;
  if (!enginePlan) {
    return {
      available: false,
      unavailableReason:
        "the engine published no trade plan for this analysis (NO_TRADE) — no entry, stop or target is invented",
      actionability: "NO_TRADE",
      actionabilityReason:
        result.noTradeReasons.length > 0
          ? result.noTradeReasons.join(" ")
          : "engine decision is NO_TRADE without a plan",
      engineNoTradeReasons: [...result.noTradeReasons],
      limitations: [],
    };
  }
  const direction = enginePlan.direction;
  const limitations: string[] = [];
  const engineEntry = parseLevel(enginePlan.entry);
  const engineStop = finite(enginePlan.stopProvenance?.publishedStop)
    ? enginePlan.stopProvenance!.publishedStop
    : parseLevel(enginePlan.stopLoss);
  const tp1 = parseLevel(enginePlan.takeProfit);
  const tp1Basis = enginePlan.targetProvenance?.note ?? enginePlan.tpBasis;

  const setup = pickSetupEntry(result, direction);
  const entry = setup ? setup.entry : engineEntry;
  const entryBasis = setup
    ? `${setup.label} — ${setup.source}`
    : enginePlan.entryBasis;
  const stop = setup ? setup.stop : engineStop;
  const stopBasis = setup
    ? setup.stopBasis
    : (enginePlan.stopProvenance?.note ?? enginePlan.slBasis);
  const invalidationSetup = setup
    ? { kind: setup.kind, label: setup.label, knownAt: setup.knownAt, source: setup.source }
    : undefined;
  if (!setup) {
    limitations.push(
      "no detected zone/order-block/FVG supplied a setup-based entry — the engine's market reference entry and its structural stop are used verbatim",
    );
  }

  const tp2Pick = pickTp2(result, direction, tp1);
  if (!tp2Pick) {
    limitations.push("no second structural target beyond TP1 was actually detected — TP2 is absent rather than invented");
  }

  const riskDistance = finite(entry) && finite(stop) ? Math.abs(entry - stop) : undefined;
  const rewardDistance = finite(entry) && finite(tp1) ? Math.abs(tp1 - entry) : undefined;
  const rMultipleToTp1 =
    riskDistance !== undefined && riskDistance > 0 && rewardDistance !== undefined
      ? rewardDistance / riskDistance
      : undefined;

  // ── Actionability: never upgrades the engine; expectancy-aware ────────
  let actionability: AdaptiveTradePlan["actionability"] = "VALIDATED";
  let actionabilityReason = "engine plan present; recorded-outcome expectancy is positive";
  const exp = opts.expectancy;
  if (result.recommendation === "NO_TRADE") {
    actionability = "NO_TRADE";
    actionabilityReason = "the engine decision is NO_TRADE — the plan layer never upgrades it";
  } else if (exp && exp.status === "historically_estimated" && finite(exp.expectedR) && exp.expectedR! < 0) {
    actionability = "NO_TRADE";
    actionabilityReason = `recorded-outcome expectancy for this context is negative (expectedR ${exp.expectedR!.toFixed(3)} over ${exp.sampleSize} trades) — actionability falls instead of forcing a prettier R:R`;
  } else if (exp && exp.status === "historically_estimated" && finite(exp.expectedR) && exp.expectedR! === 0) {
    actionability = "WAIT";
    actionabilityReason = "recorded-outcome expectancy for this context is exactly zero — waiting";
  } else if (!exp || exp.status !== "historically_estimated") {
    actionability = "WAIT";
    actionabilityReason =
      exp?.status === "limited_sample"
        ? `history exists but the sample is too small to validate expectancy (${exp.sampleSize} recorded outcome(s)) — actionability falls to WAIT`
        : "no valid recorded-outcome distribution exists for this context — expectancy is undefined, so actionability falls to WAIT without assuming any success rate";
  } else if (opts.policy?.minAcceptableRR !== undefined && finite(rMultipleToTp1) && rMultipleToTp1! < opts.policy.minAcceptableRR) {
    actionability = "WAIT";
    actionabilityReason = `plan R:R ${rMultipleToTp1!.toFixed(2)} is below the configured minimum acceptable R:R of ${opts.policy.minAcceptableRR}`;
  }

  return {
    available: true,
    direction,
    ...(finite(entry) ? { entry, entryBasis } : {}),
    ...(setup ? { entrySetup: invalidationSetup } : {}),
    ...(finite(stop) ? { stop, stopBasis } : {}),
    tp1: finite(tp1) ? tp1 : undefined,
    tp1Basis,
    ...(tp2Pick ? { tp2: tp2Pick.tp2, tp2Basis: tp2Pick.basis, tp2Setup: { ...tp2Pick.setup } } : {}),
    ...(riskDistance !== undefined ? { riskDistance } : {}),
    ...(rewardDistance !== undefined ? { rewardDistance } : {}),
    ...(rMultipleToTp1 !== undefined ? { rMultipleToTp1, riskReward: rMultipleToTp1 } : {}),
    actionability,
    actionabilityReason,
    limitations,
  };
}
