/**
 * Phase 281 — EQUITY domain configuration + explanation builder.
 *
 * The equity adapter itself still lives in `fundamental-engine.ts` (Phase 276/279
 * body, unchanged), because it is the framework's original adapter. What lives
 * here is the CONFIGURATION that makes the equity domain hierarchy-aware, and
 * the deterministic explanation builder — config and wording only, never a
 * second assessment engine:
 *
 * EVIDENCE HIERARCHY (documented, not per symbol)
 *     primary    revenue growth, EPS trend, profitability, cash flow
 *                — the reported operating performance of the business;
 *     secondary  earnings quality (estimate consistency / surprise),
 *                balance sheet, valuation
 *                — how those results were achieved, how they are financed and
 *                what the market pays for them. Valuation is deliberately
 *                secondary: a multiple is the market's priced view OF the
 *                primary evidence, so it can never lead the assessment. It
 *                still counts as evidence — a stretched multiple against
 *                measured growth is recorded as a contradiction — but it does
 *                not by itself establish the direction.
 *
 *   INDEPENDENT EVIDENCE GROUPS
 *     The configured equity provider exposes exactly two independent datasets
 *     behind the scored dimensions: the OVERVIEW reported levels and the
 *     EARNINGS multi-quarter history. Multiple fields from one dataset are not
 *     multiple sources — a domain with five usable dimensions is NOT five
 *     times more confident than one with two.
 *
 *   NO OTHER DOMAIN'S METRICS
 *     Every field named below is an equity field. Balance-sheet and cash-flow
 *     line items are not supplied by the configured endpoints, so those
 *     dimensions stay unavailable with a reason rather than being estimated.
 *
 * PURE: no clock, no provider access, no randomness.
 */

import type { FundamentalDimension } from "@/lib/data/fundamental-contract";
import type { DimensionHierarchyEntry } from "./framework";

/** The exact dimension space the equity adapter reports (Phase 276, unchanged). */
export const EQUITY_DIMENSIONS: FundamentalDimension["name"][] = [
  "revenue-growth",
  "eps-trend",
  "profitability",
  "earnings-quality",
  "valuation",
  "balance-sheet",
  "cash-flow",
];

/** Documented roles — see the module header for why valuation is secondary. */
export const EQUITY_HIERARCHY: DimensionHierarchyEntry[] = [
  { name: "revenue-growth", role: "primary" },
  { name: "eps-trend", role: "primary" },
  { name: "profitability", role: "primary" },
  { name: "cash-flow", role: "primary" },
  { name: "earnings-quality", role: "secondary" },
  { name: "balance-sheet", role: "secondary" },
  { name: "valuation", role: "secondary" },
];

/**
 * Phase 281 — documented equity interpretation parameters. Every directional
 * valuation reading cites one of these; none is a per-symbol constant.
 */
export const EQUITY_PARAMETERS = {
  /** P/E ÷ measured q/q-4 EPS growth ≤ this → the multiple is growth-supported. */
  growthSupportedPeToGrowth: 1,
  /** The same ratio above this → the multiple is stretched against measured growth. */
  stretchedPeToGrowth: 2.5,
  /** Provider-reported PEG at or below this → the multiple is growth-supported. */
  growthSupportedPeg: 1,
  /** Provider-reported PEG above this → the multiple is stretched. */
  stretchedPeg: 2.5,
} as const;

/** Independent provider datasets behind the scored equity dimensions. */
export const EQUITY_INDEPENDENT_GROUPS = 2;

/** Human label for those datasets (used in the confidence explanation). */
export const EQUITY_GROUP_LABEL =
  "provider datasets (OVERVIEW reported levels + EARNINGS multi-quarter history)";

/** A quarterly row, as the equity payload carries it (provider periods verbatim). */
export interface EquityQuarter {
  fiscalDateEnding?: string;
  reportedEps?: number;
  estimatedEps?: number;
  revenue?: number;
}

/**
 * Scored dimensions whose evidence spans MORE THAN ONE reported provider
 * period. Depth matters to confidence: a revenue trend across eight quarters
 * is a different class of evidence from one reported level, and the framework
 * treats the difference explicitly instead of counting fields.
 */
export function equityHistoryDepth(quarters: EquityQuarter[]): number {
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const revenue = quarters.filter((q) => finite(q.revenue)).length;
  const eps = quarters.filter((q) => finite(q.reportedEps)).length;
  const pairs = quarters.filter((q) => finite(q.reportedEps) && finite(q.estimatedEps)).length;
  let depth = 0;
  if (revenue >= 2) depth += 1;
  if (eps >= 2) depth += 1;
  if (pairs >= 2) depth += 1;
  return depth;
}

export interface EquityExplanationInput {
  /** Exact provider/native identity the assessment belongs to. */
  instrumentId: string;
  /** The engine's own dimension records — the explanation cites them, never re-derives. */
  dimension: (name: FundamentalDimension["name"]) => FundamentalDimension | undefined;
  state: string;
  confidence: string;
  /** Latest reported fiscal period end, verbatim from the payload. */
  reportingPeriod?: string;
  /** Provider observation instant (0 when the payload carried none). */
  observedAt: number;
  /** Contradiction statements the engine already recorded. */
  contradictions: string[];
  /** Dimensions the domain defines but this payload could not supply. */
  unavailableDimensions?: string[];
  /** Dimensions the payload actually scored (evidence present). */
  scoredDimensions?: number;
  /** Total dimensions in the equity domain. */
  totalDimensions?: number;
}

const say = (
  dimension: FundamentalDimension | undefined,
  fallback: string,
): string => (dimension?.status === "unavailable" ? fallback : (dimension?.evidence ?? fallback));

/**
 * Deterministic equity explanation, in the required order:
 * growth → profitability → cash flow → balance sheet → valuation →
 * earnings quality → assessment → risk → periods. Every sentence is built from
 * the engine's own dimension records, so no value appears here that the
 * assessment does not already carry.
 */
export function equityExplanation(input: EquityExplanationInput): string {
  const dim = input.dimension;
  const growth = `Growth: ${say(dim("revenue-growth"), "unavailable — no revenue series or reported growth figure was supplied")} ${
    dim("eps-trend")?.status === "unavailable" ? "" : say(dim("eps-trend"), "")
  }`.trim();
  const profitabilityTrend =
    dim("profitability")?.status === "unavailable"
      ? ""
      : "Margins and returns are reported TTM levels (single period), and the payload carries no margin series, so no margin TREND is claimed.";
  const profitability = `Profitability: ${say(dim("profitability"), "unavailable — no margin/return metric was supplied")} ${profitabilityTrend}`;
  const cashFlow = `Cash flow: ${say(
    dim("cash-flow"),
    "unavailable — the configured provider endpoints expose no cash-flow line items, so no free cash flow is estimated",
  )}`;
  const balanceSheet = `Balance sheet: ${say(
    dim("balance-sheet"),
    "unavailable — the configured provider endpoints expose no balance-sheet line items, so leverage is never derived",
  )}`;
  const valuation = `Valuation: ${say(dim("valuation"), "unavailable — no reported multiple was supplied")}`;
  const quality = `Earnings quality: ${say(
    dim("earnings-quality"),
    "unavailable — fewer than two quarters carry both a reported and an estimated EPS",
  )}`;
  const risk =
    input.contradictions.length > 0
      ? `Risk: ${input.contradictions.join(" ")}`
      : "Risk: no conflicting reported evidence was found in this payload.";
  const periods = `Periods: reported fiscal periods up to ${input.reportingPeriod ?? "not supplied"}, observed ${
    input.observedAt > 0 ? new Date(input.observedAt).toISOString() : "not supplied"
  } — reported statements, never live market data.`;
  const coverage =
    input.unavailableDimensions && input.unavailableDimensions.length > 0
      ? `Coverage: ${input.scoredDimensions ?? 0} of ${input.totalDimensions ?? EQUITY_DIMENSIONS.length} equity dimensions carry reported evidence; ${input.unavailableDimensions.join(", ")} are UNAVAILABLE for this payload and reduce completeness only — the state above is never lowered to "insufficient" because a family is missing.`
      : `Coverage: all ${input.totalDimensions ?? EQUITY_DIMENSIONS.length} equity dimensions carry reported evidence.`;
  return `${growth} ${profitability} ${cashFlow} ${balanceSheet} ${valuation} ${quality} ` +
    `${coverage} ` +
    `Assessment: ${input.state} · confidence ${input.confidence} for ${input.instrumentId}. ${risk} ${periods}`;
}
