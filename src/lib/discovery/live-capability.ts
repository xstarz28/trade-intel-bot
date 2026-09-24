/**
 * Phase 268 — Complete Live-Capability Vocabulary & Global Enforcement Audit
 *
 * Canonical inventory of ALL actual capability strings used in repository
 * and classification into LIVE_EVIDENCE vs HISTORICAL/SUPPORTING vs DISCOVERY_ONLY vs NON_MARKET.
 *
 * This file is the SINGLE source of truth for live eligibility — no adapter may have local ad-hoc live list.
 *
 * Actual capability vocabulary found via grep across repo (provider-contract, universal/types, adapters, registry, readiness):
 *
 * From provider-contract (21):
 *   discovery, ohlcv, quote, order_book, trades, derivatives, funding, open_interest, liquidations,
 *   news, fundamentals, corporate_actions, on_chain, macro, tvl, economic_calendar, yield_curve, inventory,
 *   eod, delayed, realtime
 *
 * From universal/types DataCapability (31):
 *   ohlcv, quote, order_book, tick_data, open_interest, funding_rate, liquidations, long_short_positioning,
 *   options_data, earnings, financial_statements, valuation, dividends, corporate_actions, analyst_estimates,
 *   macroeconomic_data, interest_rates, yield_curves, cot_positioning, economic_calendar, news, sentiment,
 *   inventory, supply_demand, futures_structure, tvl, defi_fees, on_chain_analytics, tokenomics, dxy, correlation, risk_regime
 *
 * From adapters:
 *   FUTURES_CAPS: open_interest, funding_rate, liquidations, long_short_positioning, ohlcv
 *   SPOT_CAPS: quote, ohlcv
 *   OKX: ohlcv, quote, order_book
 *   Twelve Data: ohlcv, quote
 *   IDX: eod, delayed, realtime, fundamentals, corporate_actions
 *   Stockbit: realtime, delayed, eod, fundamentals
 *   Ajaib: realtime, delayed, eod
 *   CoinGecko: quote, fundamentals
 *   CoinGlass registry: discovery, derivatives, funding, open_interest, liquidations
 *   DexScreener: on_chain, quote
 *   GeckoTerminal: on_chain, quote, ohlcv
 *   Alpha Vantage registry: discovery, delayed, eod, quote, news, fundamentals
 *
 * Union canonical (actual present):
 *   discovery, ohlcv, quote, order_book, trades, tick_data,
 *   derivatives, funding, funding_rate, open_interest, liquidations, long_short_positioning,
 *   news, fundamentals, corporate_actions, on_chain, on_chain_analytics, macro, macroeconomic_data,
 *   tvl, defi_fees, tokenomics, economic_calendar, yield_curve, yield_curves, interest_rates,
 *   inventory, supply_demand, futures_structure, eod, delayed, realtime,
 *   earnings, financial_statements, valuation, dividends, analyst_estimates, cot_positioning,
 *   sentiment, dxy, correlation, risk_regime, options_data
 *
 * NOT_PRESENT (mentioned in prompt but not found in repo):
 *   basis, mark_price, index_price, markPrice, indexPrice, long_short_ratio, ticker (as capability), orderbook variants beyond order_book, etc.
 */

export type ActualCapability =
  | "discovery"
  | "ohlcv"
  | "quote"
  | "order_book"
  | "trades"
  | "tick_data"
  | "derivatives"
  | "funding"
  | "funding_rate"
  | "open_interest"
  | "liquidations"
  | "long_short_positioning"
  | "news"
  | "fundamentals"
  | "corporate_actions"
  | "on_chain"
  | "on_chain_analytics"
  | "macro"
  | "macroeconomic_data"
  | "tvl"
  | "defi_fees"
  | "tokenomics"
  | "economic_calendar"
  | "yield_curve"
  | "yield_curves"
  | "interest_rates"
  | "inventory"
  | "supply_demand"
  | "futures_structure"
  | "eod"
  | "delayed"
  | "realtime"
  | "earnings"
  | "financial_statements"
  | "valuation"
  | "dividends"
  | "analyst_estimates"
  | "cot_positioning"
  | "sentiment"
  | "dxy"
  | "correlation"
  | "risk_regime"
  | "options_data";

export type CapabilityClass =
  | "LIVE_EVIDENCE"
  | "HISTORICAL_OR_SUPPORTING"
  | "DISCOVERY_ONLY"
  | "NON_MARKET";

// ── Canonical classification based on actual adapter behavior + timestamp/provenance semantics ──

const LIVE_EVIDENCE_CAPABILITIES: Set<string> = new Set([
  // Price / market live
  "ohlcv",
  "quote",
  "order_book",
  "trades",
  "tick_data",
  "realtime",
  // Derivatives live (credential-gated, provider-observed timestamp, not receipt-time fabrication)
  "derivatives",
  "funding",
  "funding_rate",
  "open_interest",
  "liquidations",
  "long_short_positioning",
]);

const HISTORICAL_OR_SUPPORTING_CAPABILITIES: Set<string> = new Set([
  "eod",
  "delayed",
  "yield_curve",
  "yield_curves",
  "interest_rates",
  "cot_positioning",
  "inventory",
  "supply_demand",
  "futures_structure",
  "tvl",
  "defi_fees",
  "tokenomics",
  "macro",
  "macroeconomic_data",
]);

const DISCOVERY_ONLY_CAPABILITIES: Set<string> = new Set([
  "discovery",
  "on_chain",
  "on_chain_analytics",
]);

const NON_MARKET_CAPABILITIES: Set<string> = new Set([
  "news",
  "sentiment",
  "fundamentals",
  "earnings",
  "financial_statements",
  "valuation",
  "dividends",
  "corporate_actions",
  "analyst_estimates",
  "economic_calendar",
  "dxy",
  "correlation",
  "risk_regime",
  "options_data",
]);

// ── Canonical predicate ──

export function classifyCapability(cap: string): CapabilityClass {
  if (LIVE_EVIDENCE_CAPABILITIES.has(cap)) return "LIVE_EVIDENCE";
  if (HISTORICAL_OR_SUPPORTING_CAPABILITIES.has(cap)) return "HISTORICAL_OR_SUPPORTING";
  if (DISCOVERY_ONLY_CAPABILITIES.has(cap)) return "DISCOVERY_ONLY";
  if (NON_MARKET_CAPABILITIES.has(cap)) return "NON_MARKET";
  // Unknown capability — default to NON_MARKET to prevent accidental live promotion (fail-closed)
  return "NON_MARKET";
}

export function isLiveEvidenceCapability(cap: string): boolean {
  return LIVE_EVIDENCE_CAPABILITIES.has(cap);
}

export function isHistoricalOrSupportingCapability(cap: string): boolean {
  return HISTORICAL_OR_SUPPORTING_CAPABILITIES.has(cap);
}

export function isDiscoveryOnlyCapability(cap: string): boolean {
  return DISCOVERY_ONLY_CAPABILITIES.has(cap);
}

export function isNonMarketCapability(cap: string): boolean {
  return NON_MARKET_CAPABILITIES.has(cap);
}

// ── Inventory helpers for tests ──

export function getAllActualCapabilities(): string[] {
  return [
    ...LIVE_EVIDENCE_CAPABILITIES,
    ...HISTORICAL_OR_SUPPORTING_CAPABILITIES,
    ...DISCOVERY_ONLY_CAPABILITIES,
    ...NON_MARKET_CAPABILITIES,
  ].sort();
}

export function getLiveEvidenceCapabilities(): string[] {
  return [...LIVE_EVIDENCE_CAPABILITIES].sort();
}

export function getHistoricalOrSupportingCapabilities(): string[] {
  return [...HISTORICAL_OR_SUPPORTING_CAPABILITIES].sort();
}

export function getDiscoveryOnlyCapabilities(): string[] {
  return [...DISCOVERY_ONLY_CAPABILITIES].sort();
}

export function getNonMarketCapabilities(): string[] {
  return [...NON_MARKET_CAPABILITIES].sort();
}

// ── NOT_PRESENT capabilities mentioned in prompt but not found in repo ──

export const NOT_PRESENT_CAPABILITIES = [
  "basis",
  "mark_price",
  "index_price",
  "markPrice",
  "indexPrice",
  "long_short_ratio",
  "ticker",
  "orderbook",
  "trades_variants",
] as const;
