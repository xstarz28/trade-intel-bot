/**
 * Phase 279 — Common fundamental intelligence contract.
 *
 * ONE contract serves all four core domains (crypto, forex, equity,
 * commodity). The Phase 276 stock engine and the Phase 279 crypto / forex /
 * commodity adapters all produce this object, so the engine, the unified
 * intelligence layer, the opportunity scanner and the UI have exactly one
 * shape to read.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * Types only (plus documentation). No computation, no provider access, no
 * clock. The deterministic machinery lives in `fundamental/framework.ts`, and
 * the domain adapters live in `fundamental/{equity,crypto,forex,commodity}.ts`.
 *
 * NON-NEGOTIABLE RULES (enforced by the adapters, stated here once)
 * ----------------------------------------------------------------
 *   1. A metric is computed ONLY when the supplied evidence supports it.
 *      Otherwise the dimension is `unavailable` WITH a reason.
 *   2. Missing values are never zero, never a default and never inferred.
 *   3. Every evidence item keeps provider, native instrument identity,
 *      source/dataset, observation instant, reporting/measurement period,
 *      unit and — where derived — the exact inputs it was derived from.
 *   4. Reported/macro/historical evidence is never labelled as a live quote.
 *   5. Evidence another engine layer already scores is marked `informational`
 *      and is NOT scored again here (no double counting).
 */

// ── States ──────────────────────────────────────────────────────

/** Interpretation states. Only ever derived from actual metrics. */
export type FundamentalState =
  | "improving"
  | "weakening"
  | "mixed"
  | "insufficient";

export type DimensionStatus =
  | "positive" // evidence points to strengthening
  | "negative" // evidence points to weakening
  | "neutral"  // evidence present but directionally balanced/none
  | "unavailable"; // provider did not supply usable evidence

/** Which domain adapter produced the assessment. Never guessed. */
export type FundamentalDomain =
  | "equity"
  | "crypto"
  | "forex"
  | "commodity"
  /** A routing domain this framework does not assess — explicit, never guessed. */
  | "insufficient";

/** The direction the FUNDAMENTAL evidence itself justifies, when it does. */
export type FundamentalDirection = "bullish" | "bearish" | "none";

// ── Dimensions ──────────────────────────────────────────────────

/**
 * Dimension names are domain-specific by construction: an equity card can
 * never show a supply-structure dimension and a crypto card can never show EPS.
 */
export type FundamentalDimensionName =
  // equity (Phase 276 — unchanged names)
  | "revenue-growth"
  | "eps-trend"
  | "profitability"
  | "earnings-quality"
  | "valuation"
  | "balance-sheet"
  | "cash-flow"
  // crypto (Phase 279)
  | "supply-structure"
  | "unlock-dilution"
  | "protocol-economics"
  | "valuation-context"
  | "network-activity"
  | "on-chain-valuation"
  | "market-positioning"
  | "options-etf-flows"
  // forex (Phase 279)
  | "policy-rates"
  | "inflation"
  | "labor"
  | "growth"
  | "rates-yields"
  | "positioning"
  | "event-risk"
  | "external-balance"
  // commodity (Phase 279)
  | "supply-demand"
  | "inventories"
  | "term-structure"
  | "futures-positioning"
  | "macro-drivers";

export interface FundamentalDimension {
  name: FundamentalDimensionName;
  status: DimensionStatus;
  /**
   * Human-readable evidence derived ONLY from provider numbers, e.g.
   * "Revenue rose in 4 of the last 4 quarters (periods 2024-12-31→2024-09-30)".
   * Undefined when unavailable (a limitation line explains instead).
   */
  evidence?: string;
  /**
   * Phase 279 — TRUE when this dimension's evidence is already scored by
   * another engine layer (COX positioning layer, derivatives factor, calendar
   * gate…). Such a dimension is still REPORTED (traceable context) but it
   * never contributes to the fundamental state, so one provider field can
   * never count twice.
   */
  informational?: boolean;
  /** Which existing layer consumes it — only set together with `informational`. */
  consumedBy?: string;
}

// ── Evidence items ──────────────────────────────────────────────

/**
 * One traceable piece of evidence behind the assessment. Every field is
 * carried verbatim from the provider payload or from the derivation that
 * consumed it — `Date.now()` never appears here.
 */
export interface FundamentalEvidenceItem {
  /** Canonical metric key (stable, machine-readable). */
  metric: string;
  /** Human label used in the rendered evidence strings. */
  label: string;
  /** The exact value as supplied/derived. Absent when unavailable. */
  value?: number | string;
  /** Unit/scale of `value` ("%", "USD", "tokens", "ratio", "pp"). */
  unit?: string;
  /** Provider that supplied the underlying evidence, verbatim. */
  provider: string;
  /**
   * Exact provider/native identity the evidence belongs to (e.g. "BTC-USDT",
   * "EUR/USD", "AAPL"). Never substituted, never re-derived from a list.
   */
  providerInstrumentId?: string;
  /** Endpoint/dataset the value came from (e.g. "OVERVIEW", "chain TVL"). */
  source: string;
  /** Provider observation/acquisition instant (ms). 0 = none recorded. */
  observedAt: number;
  /**
   * Phase 279 — HOW that instant was established. Absent means provider
   * observation (the default for payloads that stamp their own time).
   *   provider-observation — the provider stamped this value's instant
   *   acquisition-receipt  — the provider supplied no instant; the value was
   *                          recorded when the response arrived
   *   period-end           — the instant IS the reporting period end
   */
  observedAtSemantics?: "provider-observation" | "acquisition-receipt" | "period-end";
  /** Reporting/measurement period the value describes, verbatim. */
  period?: string;
  /** Provider freshness classification, when it stated one. */
  freshness?: string;
  /** TRUE when WE derived the value from the inputs named in `basis`. */
  derived?: boolean;
  /** For derived values: the exact provider inputs combined. */
  basis?: string;
  /** Why a metric the domain requires is absent. */
  unavailableReason?: string;
  /** Another layer already scores this evidence — named explicitly. */
  consumedElsewhere?: string;
}

// ── Assessment ──────────────────────────────────────────────────

export interface FundamentalEvidenceCoverage {
  /** Dimensions that produced usable evidence (scored or informational). */
  dimensionsAvailable: number;
  /** Dimensions that contributed to `state` (informational ones excluded). */
  dimensionsScored: number;
  /** Every dimension the domain defines. */
  dimensionsTotal: number;
  /** Distinct PROVENANCE classes present (provider names, "derived" is not one). */
  evidenceClasses: string[];
}

export interface FundamentalAssessment {
  /** Whether ANY usable evidence existed at all. */
  available: boolean;
  /** Phase 279 — which domain adapter produced this. */
  domain: FundamentalDomain;
  /** Provider that supplied the primary evidence (verbatim from the payload). */
  provider: string;
  /**
   * Phase 275 — the exact provider/native instrument identity the evidence
   * belongs to, preserved verbatim from the payload. Never re-derived from a
   * symbol list and never substituted for another instrument.
   */
  instrumentId?: string;
  /** Observation timestamp stamped at provider acquisition (NOT re-dated). */
  observedAt: number;
  /** Latest reporting/measurement period in the evidence, if any ("2025-06-30"). */
  reportingPeriod?: string;
  /**
   * Payload-only freshness: days between the latest period end and the
   * provider observation stamp. Both come from the evidence itself, so this
   * number is stable for identical evidence. Undefined when either instant is
   * absent (a limitation line says so).
   */
  reportAgeDaysAtObservation?: number;
  /** Domain-period-level evidence, newest first. */
  periodsCount: number;
  /** Interpretation + dimensions. */
  state: FundamentalState;
  /** Evidence-based confidence: usable dimensions + agreement, then capped. */
  confidence: "high" | "medium" | "low" | "insufficient";
  confidenceEvidence: string;
  /**
   * Phase 279 — the direction the FUNDAMENTAL evidence alone justifies, with
   * the rule that produced it. `none` (and the undefined evidence line) when
   * the evidence is non-directional — a direction is never forced.
   */
  directionalBias: FundamentalDirection;
  directionalBiasEvidence?: string;
  /** Dimensions, in domain order. */
  dimensions: FundamentalDimension[];
  /**
   * Phase 279 — forex only: the two-sided comparisons the domain adapter made
   * (base vs quote), each citing the provider evidence it used.
   */
  comparisons?: string[];
  /** Derived metrics (undefined where not computable — never fabricated). */
  metrics: FundamentalMetrics;
  /** Phase 279 — crypto-domain numeric metrics (never mixed into `metrics`). */
  cryptoMetrics?: CryptoFundamentalMetrics;
  /** Phase 279 — forex-domain numeric metrics (never mixed into `metrics`). */
  forexMetrics?: ForexFundamentalMetrics;
  /** Phase 279 — commodity-domain numeric metrics (never mixed into `metrics`). */
  commodityMetrics?: CommodityFundamentalMetrics;
  /** Evidence that conflicts with other evidence in the SAME payload. */
  contradictions: string[];
  /** Dimensions the domain requires but the evidence cannot support. */
  unavailableDimensions: string[];
  /** How much of the domain's evidence space is actually covered. */
  evidenceCoverage: FundamentalEvidenceCoverage;
  /** Per-item provenance for every value used. */
  evidence: FundamentalEvidenceItem[];
  /** Explicit missing-data / provenance limitations — always disclosed. */
  limitations: string[];
}

export interface FundamentalMetrics {
  /** Sequential EPS moves across quarterly history, newest→oldest pairs. */
  epsRises?: number;
  epsFalls?: number;
  /** Sequential revenue moves across quarterly history. */
  revenueRises?: number;
  revenueFalls?: number;
  /** EPS of latest quarter vs 4 quarters back, when both are real numbers. */
  epsYoY?: number;
  /** Revenue of latest quarter vs 4 quarters back, when both are real numbers. */
  revenueYoY?: number;
  /** Provider-reported YoY growth figures when present (as-reported). */
  revenueGrowthReported?: number;
  epsGrowthReported?: number;
  /** Estimate beat/miss across quarters that carry BOTH eps values. */
  estimateBeats?: number;
  estimateMisses?: number;
  // ── Phase 279 equity depth (all as-reported; absent when not supplied) ──
  /** Annual-vs-annual reported EPS change, when two annual periods exist. */
  annualEpsYoY?: number;
  /** Latest quarterly revenue vs the same quarter a year earlier. */
  revenueQoQ4?: number;
  /** Revenue growth acceleration: latest YoY minus the prior YoY. */
  revenueYoYAcceleration?: number;
  /** EPS growth acceleration: latest YoY minus the prior YoY. */
  epsYoYAcceleration?: number;
  /** Latest quarter's reported EPS vs its own estimate (surprise, %). */
  latestEpsSurprisePercent?: number;
  /** PEG ratio as reported by the provider (never derived from peers). */
  pegReported?: number;
  /** Dividend yield as reported by the provider. */
  dividendYield?: number;
  /** Market capitalisation as reported by the provider. */
  marketCapReported?: number;
  /** Revenue per share as reported by the provider. */
  revenuePerShare?: number;
}

export interface CryptoFundamentalMetrics {
  circulatingSupply?: number;
  totalSupply?: number;
  /** circulating / total × 100, as derived from the two real supplies. */
  circulatingPercent?: number;
  /** 100 − circulatingPercent: the share of supply still to be released. */
  dilutionPressurePercent?: number;
  /** Upcoming unlock events inside the provider's 30-day window. */
  upcomingUnlocks30d?: number;
  /** Total unlocked token amount inside that window. */
  upcomingUnlockAmount30d?: number;
  /** Unlock amount as a share of circulating supply (%). */
  unlockPercentOfCirculating?: number;
  /** TVL in USD as reported by the provider. */
  tvlCurrent?: number;
  tvlChange7dPercent?: number;
  tvlChange30dPercent?: number;
  /** Daily protocol fees in USD as reported by the provider. */
  dailyFees?: number;
  /** Price × circulating supply — derived, cite `basis`. */
  marketCapDerived?: number;
  /** Price × total supply — derived, cite `basis`. */
  fdvDerived?: number;
}

export interface ForexFundamentalMetrics {
  /** Policy rate of the base currency (%), from a released rate event. */
  basePolicyRate?: number;
  /** Policy rate of the quote currency (%). */
  quotePolicyRate?: number;
  /** base − quote, in percentage points. */
  policyRateDifferentialPp?: number;
  /** Mean released surprise (actual − forecast) for each side, natural units. */
  baseSurpriseAvg?: number;
  quoteSurpriseAvg?: number;
  /** Nominal 10Y yield differential when BOTH sides have real yields. */
  yieldDifferential10yPp?: number;
  /** Real 10Y yield differential when BOTH sides have real yields. */
  realYieldDifferential10yPp?: number;
}

/**
 * Phase 279 — commodity-domain numeric metrics. Every field is a real
 * provider observation (or the direct change between two consecutive real
 * observations); absent when the provider did not supply it. Commodity
 * fundamentals never reuse`FundamentalMetrics` (a barrel of crude has no EPS)
 * and never mix into the forex/crypto/metrics objects.
 */
export interface CommodityFundamentalMetrics {
  /** Headline EIA WPSR stock level, in the provider's own unit. */
  inventoryLatest?: number;
  /** Its week-over-week change (provider units), when two observations exist. */
  inventoryChangeWoW?: number;
  /** The same change as a percentage of the previous stock level. */
  inventoryChangePercentWoW?: number;
  /** Number of WPSR product legs that returned valid dated observations. */
  inventoryLegsAvailable?: number;
  /** CFTC non-commercial net position (long − short) on the latest report. */
  futuresPositioningNet?: number;
  /** Change in that net versus the previous consecutive report. */
  futuresPositioningChange?: number;
  /** Nominal 10Y Treasury yield from the Treasury's own nominal feed (%). */
  nominal10yYieldPercent?: number;
  /** Real 10Y yield from the Treasury's own real-yield feed (%). */
  real10yYieldPercent?: number;
  /** Change in the nominal 10Y versus the previous observation (pp). */
  nominal10yChangePp?: number;
}
