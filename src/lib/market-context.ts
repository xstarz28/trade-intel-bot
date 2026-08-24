/**
 * Phase 5 — Market context layer (pure functions).
 *
 * Regime detection, setup classification and cross-layer contradiction
 * detection. All inputs come from ALREADY-COMPUTED evidence (Phase 2 SMC,
 * Phase 3A MTF, Phase 1 core scores). No new indicators, no fabricated
 * data — insufficient evidence yields UNKNOWN, never a guess.
 */
import type { MtfContext, TechnicalData } from "./data/market-types";

/** Structural subset of the core bias breakdown (keeps this module free
 *  of app-alias imports so BOTH the Convex bundler and Vite can use it). */
interface CoreBreakdownSubset {
  fundamental: number;
  sentiment: number;
}

// ── Regime ─────────────────────────────────────────────────────────

export type MarketRegime =
  | "TRENDING"
  | "RANGING"
  | "VOLATILITY_EXPANSION"
  | "VOLATILITY_COMPRESSION"
  | "UNKNOWN";

export interface MarketRegimeInfo {
  regime: MarketRegime;
  /** Every evidence actually used, for transparency. */
  evidences: string[];
}

type VolEvidence = "EXPANSION" | "COMPRESSION" | "NONE";

/** Mean true range ratio of the recent half vs the prior half of a series. */
export function volatilityRatio(candles: { high: number; low: number; close: number }[]): number | null {
  if (candles.length < 40) return null;
  const tr = (c: { high: number; low: number; close: number }, prevClose: number) =>
    Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) trs.push(tr(candles[i], candles[i - 1].close));
  const half = Math.floor(trs.length / 2);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const recent = mean(trs.slice(half));
  const prior = mean(trs.slice(0, half));
  if (!(prior > 0)) return null;
  return recent / prior;
}

/**
 * Multi-evidence regime detection. Requires at least TWO independent
 * evidences before leaving UNKNOWN — a single signal never decides.
 */
export function detectMarketRegime(input: {
  technicalData?: TechnicalData;
  candles?: { high: number; low: number; close: number }[];
}): MarketRegimeInfo {
  const evidences: string[] = [];
  let trendVotes = 0;
  let rangeVotes = 0;
  const tech = input.technicalData;

  // Evidence 1: external structure direction.
  const extStructure =
    tech?.smc?.internalExternal.external.structure ?? tech?.structure ?? undefined;
  if (extStructure === "HH/HL" || extStructure === "LH/LL") {
    trendVotes++;
    evidences.push(`external structure ${extStructure} → trending`);
  } else if (extStructure === "range") {
    rangeVotes++;
    evidences.push("external structure range → ranging");
  }

  // Evidence 2: VWAP location behavior.
  const vwap = tech?.smc?.vwap;
  if (vwap?.available && vwap.priceLocation !== "unavailable") {
    if (vwap.priceLocation === "at_vwap") {
      rangeVotes++;
      evidences.push("price at session VWAP → balance/ranging");
    } else {
      trendVotes++;
      evidences.push(`price ${vwap.priceLocation.replace("_", " ")} VWAP → directional`);
    }
  }

  // Evidence 3: value area containment (only when the profile is real).
  const vp = tech?.smc?.volumeProfile;
  if (vp?.available && vp.vah !== undefined && vp.val !== undefined && vp.poc !== undefined) {
    const last = input.candles?.[input.candles.length - 1]?.close;
    if (last !== undefined) {
      if (last >= vp.val && last <= vp.vah) {
        rangeVotes++;
        evidences.push("price inside value area → ranging");
      } else {
        trendVotes++;
        evidences.push("price outside value area → directional/exploration");
      }
    }
  }

  // Evidence 4: volume behavior confirms direction, never creates it.
  if (tech?.volumeTrend === "increasing" && extStructure !== "range") {
    trendVotes++;
    evidences.push("increasing volume with directional structure");
  } else if (tech?.volumeTrend === "decreasing" && extStructure === "range") {
    rangeVotes++;
    evidences.push("declining volume in range");
  }

  // Evidence 5: realized volatility shift (requires actual candle history).
  let volEvidence: VolEvidence = "NONE";
  if (input.candles) {
    const ratio = volatilityRatio(input.candles);
    if (ratio !== null) {
      if (ratio >= 1.4) {
        volEvidence = "EXPANSION";
        evidences.push(`recent volatility ${ratio.toFixed(2)}× prior half → expansion`);
      } else if (ratio <= 0.7) {
        volEvidence = "COMPRESSION";
        evidences.push(`recent volatility ${ratio.toFixed(2)}× prior half → compression`);
      }
    }
  }

  // Multi-evidence requirement.
  const totalEvidences = trendVotes + rangeVotes + (volEvidence !== "NONE" ? 1 : 0);
  if (totalEvidences < 2 || (!tech || tech.dataPoints < 50)) {
    return {
      regime: "UNKNOWN",
      evidences: [...evidences, "insufficient independent evidence → UNKNOWN (never forced)"],
    };
  }

  // Volatility state dominates when actually observed; structure must not
  // contradict it for the label to stand, otherwise fall through.
  if (volEvidence === "COMPRESSION") return { regime: "VOLATILITY_COMPRESSION", evidences };
  if (volEvidence === "EXPANSION" && rangeVotes > trendVotes)
    return { regime: "RANGING", evidences };
  if (volEvidence === "EXPANSION") return { regime: "VOLATILITY_EXPANSION", evidences };

  if (trendVotes > rangeVotes) return { regime: "TRENDING", evidences };
  if (rangeVotes > trendVotes) return { regime: "RANGING", evidences };
  return { regime: "UNKNOWN", evidences };
}

// ── Setup classification ───────────────────────────────────────────

export type SetupClass =
  | "TREND_CONTINUATION"
  | "PULLBACK"
  | "COUNTER_TREND"
  | "REVERSAL"
  | "RANGE"
  | "UNKNOWN";

export interface SetupClassificationInfo {
  setupClass: SetupClass;
  rationale: string;
}

/**
 * Classify the setup from MTF alignment, structure, CHoCH, sweeps and
 * regime. An LTF CHoCH alone is NEVER a reversal — only a genuine HTF
 * external BOS/CHoCH (mtf.htfReversal) earns that label.
 */
export function classifySetup(input: {
  mtf?: MtfContext;
  technicalData?: TechnicalData;
  regime?: MarketRegime;
  /** Optional thesis direction — lets COUNTER_TREND be distinguished
   *  from PULLBACK when lower TFs oppose the HTF. */
  biasDir?: "long" | "short";
}): SetupClassificationInfo {
  const { mtf, technicalData: tech, regime } = input;

  if (regime === "RANGING") {
    return { setupClass: "RANGE", rationale: "Market regime is RANGING — directional continuation setups are unreliable inside balance." };
  }

  // Genuine HTF reversal: external BOS/CHoCH on the HTF itself.
  if (mtf?.htfReversal) {
    return {
      setupClass: "REVERSAL",
      rationale: `Genuine HTF reversal: external ${mtf.htfReversal.kind} ${mtf.htfReversal.direction} on ${mtf.htfReversal.timeframe}. LTF signals alone cannot produce this classification.`,
    };
  }

  if (!mtf) {
    // Without MTF context we can still recognize a range.
    const ext = tech?.smc?.internalExternal.external.structure ?? tech?.structure;
    if (ext === "range") return { setupClass: "RANGE", rationale: "Primary timeframe structure is ranging." };
    return { setupClass: "UNKNOWN", rationale: "No multi-timeframe context available for classification." };
  }

  if (mtf.alignment === "INSUFFICIENT_DATA") {
    return { setupClass: "UNKNOWN", rationale: "MTF data insufficient for classification." };
  }

  if (mtf.alignment === "COUNTER_TREND") {
    // Trading WITH the dominant HTF while lower TFs pull back = pullback;
    // trading AGAINST it = counter-trend (needs the Phase 3A chain).
    if (input.biasDir && input.biasDir !== mtf.htfBias) {
      return {
        setupClass: "COUNTER_TREND",
        rationale: `Thesis trades AGAINST ${mtf.htfTimeframe} ${mtf.htfBias === "long" ? "bullish" : "bearish"} HTF context without an HTF structural break — valid only with the full counter-trend confirmation chain, otherwise NO_TRADE.`,
      };
    }
    return {
      setupClass: "PULLBACK",
      rationale: `Lower-timeframes pull back against ${mtf.htfTimeframe} ${mtf.htfBias === "long" ? "bullish" : "bearish"} HTF context without an HTF structural break — retracement within trend, not a reversal.`,
    };
  }

  if (mtf.alignment === "MIXED") {
    return {
      setupClass: "UNKNOWN",
      rationale: "MTF alignment MIXED — timeframes disagree without a decisive hierarchy.",
    };
  }

  // ALIGNED_* — but a fresh opposing sweep warns of a trap.
  const smc = tech?.smc;
  const sweepAgainst =
    smc?.recentSweep &&
    ((mtf.htfBias === "long" && smc.recentSweep.side === "buy_side") ||
      (mtf.htfBias === "short" && smc.recentSweep.side === "sell_side"));
  if (sweepAgainst) {
    return {
      setupClass: "PULLBACK",
      rationale: `Aligned trend context, but a recent ${smc!.recentSweep!.side} sweep warns of short-term distribution/accumulation — treat as pullback risk within trend.`,
    };
  }

  return {
    setupClass: "TREND_CONTINUATION",
    rationale: `All readable timeframes aligned (${mtf.alignment}) with no genuine HTF reversal and no opposing liquidity event.`,
  };
}

// ── Cross-asset context ───────────────────────────────────────────

/** Pearson correlation of RETURNS (never raw prices) over the overlap. */
export function pearsonCorrelation(a: number[], b: number[]): { correlation: number; n: number } | null {
  const n = Math.min(a.length, b.length) - 1;
  if (n < 20) return null; // too few returns to say anything honestly
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = a.length - n; i < a.length; i++) ra.push((a[i] - a[i - 1]) / a[i - 1]);
  for (let i = b.length - n; i < b.length; i++) rb.push((b[i] - b[i - 1]) / b[i - 1]);
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  if (!(va > 0 && vb > 0)) return null;
  return { correlation: cov / Math.sqrt(va * vb), n };
}

/** Which comparator is RELEVANT per asset class — one extra fetch max. */
export function crossAssetComparator(instrumentType: string, instrument: string): string | null {
  const sym = instrument.toUpperCase();
  if (instrumentType === "forex" && sym !== "DXY") return "DXY";
  if (instrumentType === "commodity" && !sym.startsWith("DXY")) return "DXY";
  if (instrumentType === "crypto" && /BTC|ETH|SOL|XRP/.test(sym.replace(/\/(USD(T)?)?$/, ""))) return "NDX";
  return null;
}

// ── Contradictions ─────────────────────────────────────────────────

export type ContradictionSeverity = "MINOR" | "MATERIAL" | "DECISIVE";

export interface ContradictionItem {
  description: string;
  severity: ContradictionSeverity;
}

/**
 * Explicit cross-layer contradictions. DECISIVE is assigned by the decision
 * gates (a gate that NO_TRADEs marks its reason DECISIVE); this function
 * classifies MINOR/MATERIAL observations so they can be explained.
 */
export function detectContradictions(input: {
  mtf?: MtfContext;
  technicalData?: TechnicalData;
  breakdown?: CoreBreakdownSubset;
  bias?: "Bullish" | "Bearish" | "Neutral";
  regime?: MarketRegime;
}): ContradictionItem[] {
  const items: ContradictionItem[] = [];
  const { mtf, technicalData: tech, breakdown, bias, regime } = input;
  const biasSign = bias === "Bullish" ? 1 : bias === "Bearish" ? -1 : 0;

  // HTF vs LTF directional conflict.
  if (mtf && mtf.alignment !== "ALIGNED_BULLISH" && mtf.alignment !== "ALIGNED_BEARISH" && mtf.alignment !== "INSUFFICIENT_DATA") {
    items.push({
      description: `${mtf.htfTimeframe ?? "HTF"} ${mtf.htfBias} context vs lower-timeframe disagreement (${mtf.alignment})`,
      severity: mtf.alignment === "COUNTER_TREND" ? "MATERIAL" : "MINOR",
    });
  }

  // Structure vs liquidity sweep.
  const smc = tech?.smc;
  if (smc?.recentSweep && biasSign !== 0) {
    const sweepAgainstBias =
      (biasSign === 1 && smc.recentSweep.side === "buy_side") ||
      (biasSign === -1 && smc.recentSweep.side === "sell_side");
    if (sweepAgainstBias) {
      items.push({
        description: `${bias!.toLowerCase()} thesis vs recent ${smc.recentSweep.side} liquidity sweep`,
        severity: "MINOR",
      });
    }
  }

  // Structure vs fundamental / positioning.
  if (breakdown && biasSign !== 0) {
    if (Math.sign(breakdown.fundamental) === -biasSign && breakdown.fundamental !== 0) {
      items.push({
        description: `technical ${bias!.toLowerCase()} bias vs fundamental disagreement`,
        severity: Math.abs(breakdown.fundamental) >= 2 ? "DECISIVE" : "MATERIAL",
      });
    }
    if (Math.sign(breakdown.sentiment) === -biasSign && breakdown.sentiment !== 0) {
      items.push({
        description: `technical ${bias!.toLowerCase()} bias vs positioning/sentiment disagreement`,
        severity: Math.abs(breakdown.sentiment) >= 2 ? "DECISIVE" : "MINOR",
      });
    }
  }

  // Trending thesis inside a ranging regime.
  if (regime === "RANGING" && biasSign !== 0) {
    items.push({
      description: `directional ${bias!.toLowerCase()} thesis inside RANGING market regime`,
      severity: "MINOR",
    });
  }

  // Internal vs external structure conflict.
  if (smc?.internalExternal.internalConflict) {
    items.push({
      description: "internal (minor) structure opposes external (major) structure",
      severity: "MINOR",
    });
  }

  return items;
}
