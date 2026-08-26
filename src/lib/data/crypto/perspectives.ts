/**
 * Phase 42 — INVESTOR vs FUTURES PERSPECTIVES
 *
 * Produces two clearly separated analytical perspectives from the SAME
 * underlying crypto intelligence facts.
 *
 * CRITICAL DESIGN:
 *   1. Same underlying facts — different emphasis and horizons
 *   2. Never contradict the factual data
 *   3. Never fabricate missing data
 *   4. Provider availability is NEVER directional evidence
 *   5. Unlocks are CONTEXT, never automatic bearish
 *   6. Funding is CONTEXT, never automatic directional signal
 *   7. TVL is CONTEXT, never guaranteed price direction
 *   8. INFORMATIONAL_ONLY — does not modify decision engine
 */

import type {
  CryptoIntelligenceContext,
  DerivativesIntelligence,
  DeFiIntelligence,
  TokenomicsIntelligence,
} from "./types";

// ── Types ────────────────────────────────────────────────────────

export interface AnalyticalPerspective {
  /** Perspective label */
  perspective: "FUTURES_TRADER" | "SPOT_INVESTOR";
  /** Whether this perspective applies to the instrument */
  applicable: boolean;
  /** Primary analytical focus areas, ordered by priority */
  focusAreas: string[];
  /** Derivatives context summary */
  derivativesContext: string;
  /** Fundamentals context summary */
  fundamentalsContext: string;
  /** Tokenomics context summary */
  tokenomicsContext: string;
  /** Overall intelligence summary */
  intelligenceSummary: string;
  /** Missing information relevant to this perspective */
  missingInformation: string[];
  /** Key considerations */
  keyConsiderations: string[];
}

// ── Helpers ──────────────────────────────────────────────────────

function freshnessLabel(freshness?: string): string {
  if (!freshness) return "unknown freshness";
  if (freshness === "FRESH") return "fresh data";
  if (freshness === "DELAYED") return "delayed data";
  if (freshness === "STALE") return "stale data — interpret with caution";
  return "unavailable data";
}

function qualityLabel(quality?: string): string {
  if (!quality) return "unknown quality";
  if (quality === "VERIFIED") return "verified quality";
  if (quality === "DEGRADED") return "degraded quality — limited confidence";
  return "unavailable quality";
}

function fundingContext(fr?: DerivativesIntelligence["fundingRate"]): string {
  if (!fr) return "Funding rate data unavailable.";
  const parts: string[] = [];
  parts.push(`Current funding rate: ${(fr.currentRate * 100).toFixed(4)}%.`);
  if (fr.isExtreme) {
    parts.push("Funding is at extreme levels — derivatives positioning is stretched.");
  }
  if (fr.annualizedRate !== undefined) {
    parts.push(`Annualized: ${(fr.annualizedRate * 100).toFixed(2)}%.`);
  }
  if (!fr.reliable) {
    parts.push("Data reliability flagged — interpret with caution.");
  }
  return parts.join(" ");
}

function oiContext(oi?: DerivativesIntelligence["openInterest"]): string {
  if (!oi) return "Open interest data unavailable.";
  const parts: string[] = [];
  parts.push(`Current OI: ${oi.current.toLocaleString()}.`);
  if (oi.change1h !== undefined) {
    const direction = oi.change1h > 0 ? "increasing" : oi.change1h < 0 ? "decreasing" : "flat";
    parts.push(`1h change: ${oi.change1h > 0 ? "+" : ""}${oi.change1h.toFixed(1)}% (${direction}).`);
  }
  if (oi.change24h !== undefined) {
    const direction = oi.change24h > 0 ? "increasing" : oi.change24h < 0 ? "decreasing" : "flat";
    parts.push(`24h change: ${oi.change24h > 0 ? "+" : ""}${oi.change24h.toFixed(1)}% (${direction}).`);
  }
  if (!oi.reliable) {
    parts.push("Data reliability flagged.");
  }
  return parts.join(" ");
}

function liquidationContext(liq?: DerivativesIntelligence["liquidation"]): string {
  if (!liq) return "Liquidation data unavailable.";
  const parts: string[] = [];
  if (liq.totalVolume !== undefined) {
    parts.push(`Total liquidation volume: ${liq.totalVolume.toLocaleString()}.`);
  }
  if (liq.dominantSide) {
    const label = liq.dominantSide === "longs" ? "long-side" : liq.dominantSide === "shorts" ? "short-side" : "balanced";
    parts.push(`Dominant liquidation side: ${label}.`);
  }
  return parts.join(" ");
}

function positioningContext(pos?: DerivativesIntelligence["positioning"]): string {
  if (!pos) return "Positioning data unavailable.";
  const parts: string[] = [];
  if (pos.accountRatio !== undefined) {
    parts.push(`Long/short account ratio: ${pos.accountRatio.toFixed(2)}.`);
  }
  if (pos.takerRatio !== undefined) {
    parts.push(`Taker buy/sell ratio: ${pos.takerRatio.toFixed(2)}.`);
  }
  return parts.join(" ");
}

function tvlContext(tvl?: DeFiIntelligence["tvl"]): string {
  if (!tvl) return "TVL data unavailable.";
  const parts: string[] = [];
  parts.push(`Current TVL: $${(tvl.current / 1e9).toFixed(2)}B.`);
  if (tvl.change7d !== undefined) {
    const direction = tvl.change7d > 0 ? "expanding" : tvl.change7d < 0 ? "contracting" : "stable";
    parts.push(`7d change: ${tvl.change7d > 0 ? "+" : ""}${tvl.change7d.toFixed(1)}% (${direction}).`);
  }
  if (tvl.change30d !== undefined) {
    const direction = tvl.change30d > 0 ? "expanding" : tvl.change30d < 0 ? "contracting" : "stable";
    parts.push(`30d change: ${tvl.change30d > 0 ? "+" : ""}${tvl.change30d.toFixed(1)}% (${direction}).`);
  }
  if (!tvl.reliable) {
    parts.push("Data reliability flagged.");
  }
  return parts.join(" ");
}

function feesContext(fees?: DeFiIntelligence["fees"]): string {
  if (!fees) return "Fee/revenue data unavailable.";
  const parts: string[] = [];
  if (fees.dailyFees !== undefined) {
    parts.push(`Daily fees: $${fees.dailyFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`);
  }
  if (fees.dailyRevenue !== undefined) {
    parts.push(`Estimated daily protocol revenue: $${fees.dailyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`);
  }
  return parts.join(" ");
}

function tokenomicsContext(tm?: TokenomicsIntelligence): string {
  if (!tm) return "Tokenomics data unavailable.";
  const parts: string[] = [];

  if (tm.supply) {
    if (tm.supply.circulatingSupply !== undefined) {
      parts.push(`Circulating supply: ${tm.supply.circulatingSupply.toLocaleString()}.`);
    }
    if (tm.supply.totalSupply !== undefined) {
      parts.push(`Total supply: ${tm.supply.totalSupply.toLocaleString()}.`);
    }
    if (tm.supply.circulatingPercent !== undefined) {
      parts.push(`Percent unlocked: ${tm.supply.circulatingPercent.toFixed(1)}%.`);
    }
  }

  if (tm.unlocks) {
    if (tm.unlocks.upcomingCount30d > 0) {
      parts.push(`${tm.unlocks.upcomingCount30d} unlock event(s) scheduled within 30 days.`);
      if (tm.unlocks.summary) {
        parts.push(tm.unlocks.summary);
      }
      if (tm.unlocks.unlockPercentOfCirculating !== undefined) {
        parts.push(`Unlock represents ${tm.unlocks.unlockPercentOfCirculating.toFixed(2)}% of circulating supply.`);
      }
    } else {
      parts.push("No significant unlock events within 30 days.");
    }
  }

  return parts.join(" ") || "Tokenomics data available but no significant context to report.";
}

// ── Futures / Trader View ────────────────────────────────────────

export function buildFuturesPerspective(
  ctx: CryptoIntelligenceContext | undefined,
): AnalyticalPerspective {
  if (!ctx) {
    return {
      perspective: "FUTURES_TRADER",
      applicable: false,
      focusAreas: [],
      derivativesContext: "No crypto intelligence available.",
      fundamentalsContext: "No crypto intelligence available.",
      tokenomicsContext: "No crypto intelligence available.",
      intelligenceSummary: "Crypto intelligence unavailable for this instrument.",
      missingInformation: ["All crypto intelligence data"],
      keyConsiderations: [],
    };
  }

  const focusAreas = [
    "HTF market structure",
    "MTF structure alignment",
    "Market regime",
    "Derivatives context",
    "Liquidity zones",
    "Funding conditions",
    "Open interest dynamics",
    "Liquidation levels",
    "Confirmation / invalidation",
    "Execution considerations",
  ];

  // Derivatives-focused summary for futures
  const derivParts: string[] = [];
  if (ctx.derivatives) {
    derivParts.push(oiContext(ctx.derivatives.openInterest));
    derivParts.push(fundingContext(ctx.derivatives.fundingRate));
    derivParts.push(liquidationContext(ctx.derivatives.liquidation));
    derivParts.push(positioningContext(ctx.derivatives.positioning));
    derivParts.push(`${freshnessLabel(ctx.derivatives.freshness)} — ${qualityLabel(ctx.derivatives.quality)}.`);
  } else {
    derivParts.push("Derivatives intelligence unavailable.");
  }

  // Fundamentals — present but lower priority for futures
  const fundParts: string[] = [];
  if (ctx.defi) {
    fundParts.push(tvlContext(ctx.defi.tvl));
    fundParts.push(feesContext(ctx.defi.fees));
    fundParts.push(`${freshnessLabel(ctx.defi.freshness)} — ${qualityLabel(ctx.defi.quality)}.`);
    fundParts.push("DeFi fundamental context is informational — structural and derivatives context takes priority for futures execution.");
  } else {
    fundParts.push("DeFi fundamental data unavailable — not primary for futures context.");
  }

  // Tokenomics — low priority for futures
  const tokenParts: string[] = [];
  if (ctx.tokenomics) {
    tokenParts.push(tokenomicsContext(ctx.tokenomics));
    tokenParts.push("Tokenomics context is low-priority for futures execution — primarily relevant for longer-horizon assessment.");
  } else {
    tokenParts.push("Tokenomics data unavailable — not relevant for short-horizon futures execution.");
  }

  // Missing
  const missing: string[] = [];
  if (!ctx.derivatives || ctx.derivatives.quality === "UNAVAILABLE") missing.push("Derivatives data (OI, funding, liquidations)");
  if (ctx.derivatives?.fundingRate && !ctx.derivatives.fundingRate.reliable) missing.push("Reliable funding rate data");
  if (ctx.derivatives?.openInterest && !ctx.derivatives.openInterest.reliable) missing.push("Reliable open interest data");

  // Key considerations
  const considerations: string[] = [];
  if (ctx.derivatives?.fundingRate?.isExtreme) {
    considerations.push("Extreme funding detected — potential for forced deleveraging. Avoid chasing with leverage.");
  }
  if (ctx.derivatives?.liquidation?.dominantSide === "longs") {
    considerations.push("Long-side liquidations dominant — potential cascade risk for long positions.");
  }
  if (ctx.derivatives?.liquidation?.dominantSide === "shorts") {
    considerations.push("Short-side liquidations dominant — potential squeeze risk for short positions.");
  }
  if (ctx.derivatives?.openInterest?.change24h !== undefined && Math.abs(ctx.derivatives.openInterest.change24h) > 10) {
    considerations.push(`Significant OI change (${ctx.derivatives.openInterest.change24h > 0 ? "+" : ""}${ctx.derivatives.openInterest.change24h.toFixed(1)}% in 24h) — market positioning is shifting rapidly.`);
  }
  if (missing.length > 0) {
    considerations.push("Missing derivatives data reduces execution confidence — wait for confirmation or reduce position size.");
  }

  return {
    perspective: "FUTURES_TRADER",
    applicable: true,
    focusAreas,
    derivativesContext: derivParts.join(" "),
    fundamentalsContext: fundParts.join(" "),
    tokenomicsContext: tokenParts.join(" "),
    intelligenceSummary: `Futures perspective prioritizes derivatives context (${ctx.derivatives ? "available" : "unavailable"}), structural confirmation, and execution conditions. DeFi fundamentals and tokenomics are informational only.`,
    missingInformation: missing,
    keyConsiderations: considerations,
  };
}

// ── Spot / Investor View ─────────────────────────────────────────

export function buildInvestorPerspective(
  ctx: CryptoIntelligenceContext | undefined,
): AnalyticalPerspective {
  if (!ctx) {
    return {
      perspective: "SPOT_INVESTOR",
      applicable: false,
      focusAreas: [],
      derivativesContext: "No crypto intelligence available.",
      fundamentalsContext: "No crypto intelligence available.",
      tokenomicsContext: "No crypto intelligence available.",
      intelligenceSummary: "Crypto intelligence unavailable for this instrument.",
      missingInformation: ["All crypto intelligence data"],
      keyConsiderations: [],
    };
  }

  const focusAreas = [
    "HTF market structure",
    "Market cycle context",
    "Long-horizon thesis",
    "DeFi fundamentals",
    "Tokenomics",
    "Supply dynamics",
    "Macro / event risk",
    "Structural confirmation",
    "Thesis invalidation",
    "Missing information",
  ];

  // Derivatives — present but lower priority for investor
  const derivParts: string[] = [];
  if (ctx.derivatives) {
    derivParts.push(fundingContext(ctx.derivatives.fundingRate));
    derivParts.push(oiContext(ctx.derivatives.openInterest));
    derivParts.push("Derivatives context is informational for investors — provides market positioning context but is not primary investment analysis.");
  } else {
    derivParts.push("Derivatives data unavailable — not primary for spot investment analysis.");
  }

  // Fundamentals — high priority for investor
  const fundParts: string[] = [];
  if (ctx.defi) {
    fundParts.push(tvlContext(ctx.defi.tvl));
    fundParts.push(feesContext(ctx.defi.fees));
    fundParts.push(`${freshnessLabel(ctx.defi.freshness)} — ${qualityLabel(ctx.defi.quality)}.`);
    fundParts.push("TVL expansion provides supportive fundamental context, but does not independently establish future price direction. Fee and revenue trends indicate protocol activity levels.");
  } else {
    fundParts.push("DeFi fundamental data unavailable — investment thesis is primarily structural-led. Missing fundamental context may affect long-horizon conviction.");
  }

  // Tokenomics — high priority for investor
  const tokenParts: string[] = [];
  if (ctx.tokenomics) {
    tokenParts.push(tokenomicsContext(ctx.tokenomics));
    // Unlocks are context, never automatic bearish
    if (ctx.tokenomics.unlocks?.upcomingCount30d && ctx.tokenomics.unlocks.upcomingCount30d > 0) {
      tokenParts.push("Potential supply pressure from upcoming unlocks depends on unlock size, recipient behavior, liquidity, and market absorption capacity. This is a supply-side consideration, not an automatic directional signal.");
    }
    if (ctx.tokenomics.supply?.circulatingPercent !== undefined && ctx.tokenomics.supply.circulatingPercent < 30) {
      tokenParts.push("Low circulating percentage — significant future supply expansion is structurally possible. This is a consideration, not a guaranteed headwind.");
    }
  } else {
    tokenParts.push("Tokenomics data unavailable — supply dynamics context is missing from the investment thesis.");
  }

  // Missing
  const missing: string[] = [];
  if (!ctx.defi || ctx.defi.quality === "UNAVAILABLE") missing.push("DeFi fundamentals (TVL, fees, revenue)");
  if (!ctx.tokenomics || ctx.tokenomics.quality === "UNAVAILABLE") missing.push("Tokenomics data (supply, unlocks)");
  if (!ctx.derivatives || ctx.derivatives.quality === "UNAVAILABLE") missing.push("Derivatives context");

  // Key considerations
  const considerations: string[] = [];
  if (ctx.defi?.tvl?.change7d !== undefined && ctx.defi.tvl.change7d > 10) {
    considerations.push("Strong TVL expansion suggests growing ecosystem activity — fundamentally constructive context.");
  }
  if (ctx.defi?.tvl?.change7d !== undefined && ctx.defi.tvl.change7d < -10) {
    considerations.push("Significant TVL contraction suggests declining ecosystem activity — fundamentally concerning context.");
  }
  if (ctx.tokenomics?.unlocks?.upcomingCount30d !== undefined && ctx.tokenomics.unlocks.upcomingCount30d > 0) {
    considerations.push(`Upcoming token unlock(s) — monitor recipient behavior and market absorption capacity.`);
  }
  if (ctx.tokenomics?.supply?.circulatingPercent !== undefined && ctx.tokenomics.supply.circulatingPercent < 20) {
    considerations.push("Very low float — future supply expansion is structurally significant. Assess absorption capacity.");
  }
  if (missing.length > 0) {
    considerations.push("Missing fundamental/tokenomics data reduces investment thesis confidence.");
  }

  return {
    perspective: "SPOT_INVESTOR",
    applicable: true,
    focusAreas,
    derivativesContext: derivParts.join(" "),
    fundamentalsContext: fundParts.join(" "),
    tokenomicsContext: tokenParts.join(" "),
    intelligenceSummary: `Investor perspective prioritizes DeFi fundamentals (${ctx.defi ? "available" : "unavailable"}), tokenomics (${ctx.tokenomics ? "available" : "unavailable"}), and long-horizon structural context. Derivatives provide positioning context only.`,
    missingInformation: missing,
    keyConsiderations: considerations,
  };
}
