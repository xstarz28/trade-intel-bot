/**
 * Phase 313 — semantic EVIDENCE DEPENDENCY FAMILIES.
 *
 * Several providers observe the SAME underlying market state. When multiple
 * observations of one state point in the same direction, they are not that
 * many independent confirmations: the engine must not inflate confidence
 * because correlated readings agree. This module is the single, auditable
 * declaration of which evidence streams belong to one semantic family and
 * what the family's bounded contribution is.
 *
 * Families are NOT new scoring paths — they are caps/groupings applied where
 * the engine already consumes that evidence. Caps are ENGINE-DEFINED policy
 * (documented, deterministic), never provider counts, never arbitrary
 * confidence percentages. Historical probability stays exclusively
 * journal-derived (strategy/probability.ts) and is untouched here.
 */

/** A semantic family of correlated evidence streams. */
export interface EvidenceDependencyFamily {
  id: string;
  /** What single underlying state the members are manifestations of. */
  underlyingState: string;
  /** The concrete evidence streams that observe this state. */
  members: string[];
  /**
   * The maximum absolute TOTAL the family may contribute where it is
   * consumed additively. `null` = not additively consumed anywhere (the
   * family is bounded by the core weighted-average breakdown instead).
   */
  cap: number | null;
  /** The exact, stable policy sentence rendered with the family. */
  note: string;
}

/**
 * Crypto derivatives positioning state: funding, open-interest change,
 * long/short ratio and liquidation dominance all describe ONE positioning
 * regime (crowding and its stress). They are consumed additively inside the
 * sentiment factor, so the family total is capped: all members agreeing
 * count no more than the cap, never the sum.
 */
export const DERIVATIVES_STATE_FAMILY_CAP = 2;

/** The canonical dependency families (complete; tests lock this registry). */
export const EVIDENCE_DEPENDENCY_FAMILIES: EvidenceDependencyFamily[] = [
  {
    id: "derivatives_state",
    underlyingState: "crypto derivatives positioning (crowding and its stress)",
    members: [
      "funding_rate (CoinGlass / manual fallback)",
      "open_interest_change (CoinGlass)",
      "long_short_ratio (CoinGlass)",
      "liquidation_dominance (CoinGlass)",
    ],
    cap: DERIVATIVES_STATE_FAMILY_CAP,
    note: "OI, funding, long/short and liquidations are correlated manifestations of one derivatives positioning state — the family contributes at most ±2 to the sentiment factor regardless of how many members agree.",
  },
  {
    id: "technical_trend",
    underlyingState: "price trend",
    members: ["trend factor", "moving averages", "market structure (HH/HL, BOS)"],
    cap: null,
    note: "Trend, MAs and structure are consumed inside the core weighted-average breakdown whose total is bounded by the breakdown weights — never summed as independent layers elsewhere.",
  },
  {
    id: "usd_regime",
    underlyingState: "USD strength regime",
    members: ["news-derived DXY proxy", "actual DXY cross-asset comparator", "Treasury yield context"],
    cap: null,
    note: "When actual DXY price data is available, the news-derived proxy contributes nothing (one underlying factor = one evidence); the Treasury curve is context inside the fundamental assessment, never a second directional layer on the same state.",
  },
  {
    id: "news_sentiment",
    underlyingState: "news/media sentiment",
    members: ["average article score", "positive/negative article breakdown"],
    cap: null,
    note: "Both members are the SAME Alpha Vantage payload read twice — they live inside the single sentiment factor and never add a second layer.",
  },
  {
    id: "oil_supply_state",
    underlyingState: "petroleum supply/demand balance",
    members: ["EIA WPSR inventory change"],
    cap: null,
    note: "One provider, one release, one layer (EIA Inventory) — oil-only by design; non-oil commodities state the layer as not applicable instead of borrowing it.",
  },
];

/** Clamp a family's additive delta to the family cap. */
export function clampFamilyDelta(delta: number, cap: number): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-cap, Math.min(cap, delta));
}
