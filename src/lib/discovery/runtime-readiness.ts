/**
 * Phase 248 — Canonical runtime readiness classification
 * Single source of truth for feature readiness.
 *
 * Existing discovery statuses (provider-capability.ts) are discovery-focused.
 * This module provides full runtime readiness for every provider capability:
 * discovery, live, ohlcv, quote, fundamentals, derivatives, macro, news, calendar.
 *
 * Statuses are deterministic and mutually exclusive.
 */

export type RuntimeReadinessStatus =
  | "RUNTIME_VERIFIED" // live call succeeded with provider timestamp, end-to-end — FULL_DYNAMIC_UNIVERSE or EVENTUALLY_COMPLETE via rotation
  | "TEST_VERIFIED" // mocked transport success, static classification max RUNTIME_UNVERIFIED, no live claim
  | "CREDENTIAL_REQUIRED" // auth required, missing env var
  | "LICENSE_REQUIRED" // real-time requires license
  | "UNAVAILABLE" // configured but endpoint failed, network, malformed, provider error
  | "NOT_IMPLEMENTED" // no adapter
  | "HISTORICAL_ONLY" // not realtime, labeled delayed/stale, e.g., Treasury, COT, EIA, CoinGlass free
  | "DISCOVERY_ONLY" // discovery works, live not yet, e.g., stockbit discovery false
  | "BOUNDED_DISCOVERY"; // Phase 250: provider API only supports search/bounded queries, cannot guarantee complete enumeration — e.g., DexScreener search/?q= — honest classification, not fake full coverage

/**
 * Reporting categories for universe coverage (not statuses, but derived):
 * - FULL_DYNAMIC_UNIVERSE: ccxt.exchanges 105, okx /public/instruments full list per type — complete per call
 * - EVENTUALLY_COMPLETE: CCXT 5 per cycle + cursor rotation, GeckoTerminal networks 3 per cycle + cursor rotation → eventual full coverage over N cycles
 * - BOUNDED_DISCOVERY: DexScreener search-only API, no enumeration endpoint → bounded convenience search, not complete universe
 * - DISCOVERY_ONLY, etc.
 */

export interface ProviderCapabilityReadiness {
  provider: string;
  capability: "DISCOVERY" | "LIVE" | "OHLCV" | "QUOTE" | "FUNDAMENTALS" | "DERIVATIVES" | "MACRO" | "NEWS" | "CALENDAR";
  status: RuntimeReadinessStatus;
  detail: string;
  credential?: string | null;
  license?: boolean;
  timestampSemantics?: string;
  freshness?: string;
}

/**
 * Classify based on implementation, credentials, license, and runtime evidence.
 * Deterministic — no Date.now(), no randomness.
 */
export function classifyReadiness(input: {
  provider: string;
  capability: ProviderCapabilityReadiness["capability"];
  implemented: boolean;
  hasLiveEvidence?: boolean;
  hasTestEvidence?: boolean;
  credentialRequired?: string | null;
  credentialAvailable?: boolean;
  licenseRequired?: boolean;
  isHistoricalOnly?: boolean;
  isDiscoveryOnly?: boolean;
  lastError?: string;
}): RuntimeReadinessStatus {
  if (!input.implemented) return "NOT_IMPLEMENTED";
  if (input.licenseRequired) return "LICENSE_REQUIRED";
  if (input.credentialRequired && input.credentialAvailable === false) return "CREDENTIAL_REQUIRED";
  if (input.isHistoricalOnly) return "HISTORICAL_ONLY";
  if (input.isDiscoveryOnly) return "DISCOVERY_ONLY";
  if (input.hasLiveEvidence) return "RUNTIME_VERIFIED";
  if (input.hasTestEvidence) return "TEST_VERIFIED";
  if (input.lastError) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

/**
 * Ground truth readiness for all known providers (from Phase247 inventory).
 * This is not a whitelist as source of truth — it is a reporting view derived
 * from actual code paths. Dynamic CCXT family is handled via prefix.
 */
export const PROVIDER_READINESS_MATRIX: ProviderCapabilityReadiness[] = [
  // okx — public, runtime verified via OKX candles (no cred)
  { provider: "okx", capability: "DISCOVERY", status: "RUNTIME_VERIFIED", detail: "OKX /api/v5/public/instruments SPOT/SWAP/FUTURES full list per type", timestampSemantics: "provider state live/suspend", freshness: "FRESH" },
  { provider: "okx", capability: "LIVE", status: "RUNTIME_VERIFIED", detail: "OKX candles via acquireProviderNativeLiveData, public", timestampSemantics: "candle open ms provider-observed", freshness: "FRESH" },
  { provider: "okx", capability: "OHLCV", status: "RUNTIME_VERIFIED", detail: "OKX candles", timestampSemantics: "candle open ms", freshness: "FRESH" },
  { provider: "okx", capability: "QUOTE", status: "RUNTIME_VERIFIED", detail: "OKX quote via candles", timestampSemantics: "candle open ms", freshness: "FRESH" },

  // twelve-data — credential required
  { provider: "twelve-data", capability: "DISCOVERY", status: "CREDENTIAL_REQUIRED", detail: "Twelve Data catalog paginated page param, requires TWELVE_DATA_API_KEY", credential: "TWELVE_DATA_API_KEY", timestampSemantics: "provider datetime", freshness: "FRESH" },
  { provider: "twelve-data", capability: "LIVE", status: "CREDENTIAL_REQUIRED", detail: "Twelve Data time_series/quote", credential: "TWELVE_DATA_API_KEY", timestampSemantics: "provider datetime sec→ms via providerQuoteTimestampMs", freshness: "FRESH" },
  { provider: "twelve-data", capability: "OHLCV", status: "CREDENTIAL_REQUIRED", detail: "Twelve Data time_series", credential: "TWELVE_DATA_API_KEY", timestampSemantics: "provider datetime", freshness: "FRESH" },
  { provider: "twelve-data", capability: "QUOTE", status: "CREDENTIAL_REQUIRED", detail: "Twelve Data quote", credential: "TWELVE_DATA_API_KEY", timestampSemantics: "quote timestamp sec→ms", freshness: "FRESH" },

  // ccxt dynamic — public if dep installed, EVENTUALLY_COMPLETE via rotation (Phase 249/250)
  { provider: "ccxt", capability: "DISCOVERY", status: "RUNTIME_VERIFIED", detail: "Dynamic via ccxt.exchanges 105 exchanges, fetchMarkets() — EVENTUALLY_COMPLETE via cursor rotation maxExchanges=5 per cycle, eventual full 105 over 21 cycles", timestampSemantics: "exchange native", freshness: "FRESH" },
  { provider: "ccxt", capability: "LIVE", status: "RUNTIME_VERIFIED", detail: "CCXT native via provider-registry, public — FULL_DYNAMIC_UNIVERSE per exchange", timestampSemantics: "exchange timestamp provider-observed", freshness: "FRESH" },
  { provider: "ccxt", capability: "OHLCV", status: "RUNTIME_VERIFIED", detail: "CCXT OHLCV", timestampSemantics: "exchange timestamp", freshness: "FRESH" },
  { provider: "ccxt", capability: "QUOTE", status: "RUNTIME_VERIFIED", detail: "CCXT quote", timestampSemantics: "exchange timestamp", freshness: "FRESH" },

  // dexscreener — public but BOUNDED_DISCOVERY (Phase 250)
  // API only supports search/?q=, no full enumeration of chains/DEXes/pools — bounded convenience search
  { provider: "dexscreener", capability: "DISCOVERY", status: "BOUNDED_DISCOVERY", detail: "DEX pairs chain:dex:poolAddress via search/?q= bounded queries ETH/USDC/WETH/SOL — BOUNDED_DISCOVERY not complete DEX universe, source truth API response, rotation of query partitions", timestampSemantics: "provider-observed", freshness: "FRESH" },
  { provider: "dexscreener", capability: "QUOTE", status: "RUNTIME_VERIFIED", detail: "DEX pool quote via search result", timestampSemantics: "provider-observed", freshness: "FRESH" },

  // geckoterminal — public, EVENTUALLY_COMPLETE via rotation (Phase 250)
  { provider: "geckoterminal", capability: "DISCOVERY", status: "RUNTIME_VERIFIED", detail: "On-chain pools via GeckoTerminal /networks dynamic + /networks/{id}/pools?page= paginated — EVENTUALLY_COMPLETE via cursor rotation maxNetworks=3 per cycle, maxPages=2 per network, eventual full network coverage", timestampSemantics: "provider-observed", freshness: "FRESH" },
  { provider: "geckoterminal", capability: "QUOTE", status: "RUNTIME_VERIFIED", detail: "Pool quote via GeckoTerminal", timestampSemantics: "provider-observed", freshness: "FRESH" },
  { provider: "geckoterminal", capability: "OHLCV", status: "RUNTIME_VERIFIED", detail: "Pool OHLCV via GeckoTerminal where supported", timestampSemantics: "provider-observed", freshness: "FRESH" },

  // idx — license required realtime, discovery credential-gated
  { provider: "idx", capability: "DISCOVERY", status: "LICENSE_REQUIRED", detail: "IDX public metadata via Twelve Data exchange=IDX requires credential, else REQUIRES_LICENSE", license: true, timestampSemantics: "provider state", freshness: "DELAYED" },
  { provider: "idx", capability: "LIVE", status: "LICENSE_REQUIRED", detail: "IDX realtime requires licensed datafeed", license: true, timestampSemantics: "N/A", freshness: "UNAVAILABLE" },
  { provider: "idx", capability: "FUNDAMENTALS", status: "LICENSE_REQUIRED", detail: "IDX fundamentals via licensed feed", license: true, timestampSemantics: "N/A", freshness: "DELAYED" },

  // stockbit — license required, discovery not implemented
  { provider: "stockbit", capability: "DISCOVERY", status: "NOT_IMPLEMENTED", detail: "Stockbit discovery not implemented, requires paid Live Datafeed license", license: true },
  { provider: "stockbit", capability: "LIVE", status: "LICENSE_REQUIRED", detail: "Stockbit realtime requires paid access", license: true },
  { provider: "ajaib", capability: "DISCOVERY", status: "NOT_IMPLEMENTED", detail: "Ajaib discovery not implemented, requires authorized access", license: true },
  { provider: "ajaib", capability: "LIVE", status: "LICENSE_REQUIRED", detail: "Ajaib requires authorized access", license: true },

  // coingecko — quote only, runtime verified receipt-time by policy
  { provider: "coingecko", capability: "QUOTE", status: "RUNTIME_VERIFIED", detail: "CoinGecko simple/price current-at-response PROVIDER_RESPONSE", timestampSemantics: "current-at-response documented", freshness: "FRESH" },
  { provider: "coingecko", capability: "DISCOVERY", status: "DISCOVERY_ONLY", detail: "Coin list exists but not tradable instrument ids, enumerated via GeckoTerminal pools", timestampSemantics: "N/A", freshness: "UNAVAILABLE" },

  // coinglass — credential required, historical only (delayed free tier) + discovery now CODE_READY via supported-exchange-pairs COMPLETE
  { provider: "coinglass", capability: "DERIVATIVES", status: "CREDENTIAL_REQUIRED", detail: "CoinGlass funding/OI/liquidations/longShort via convex/coinglass.fetchDerivatives", credential: "COINGLASS_API_KEY", timestampSemantics: "coinglassPointObservationMs time/t/timestamp/createTime sec/ms oldest wins", freshness: "DELAYED" },
  { provider: "coinglass", capability: "DISCOVERY", status: "CREDENTIAL_REQUIRED", detail: "CoinGlass futures/spot supported-exchange-pairs COMPLETE single-response cache 1min no pagination — provider=coinglass providerInstrumentId=<exchange>:<instrument_id> exact native, assetClass crypto subType crypto_perp/crypto_futures/crypto_spot base/quote/settle exact, tradingState TRADING, capabilities derivatives/funding/open_interest/liquidations, discoveredAt now, CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE, provider-qualified coinglass:: distinct", credential: "COINGLASS_API_KEY", timestampSemantics: "provider-observed now", freshness: "FRESH" },

  // alpha-vantage — credential required, historical/delayed
  // Phase 265: INDEX_CATALOG + INDEX_DATA implemented via alpha-vantage-index-adapter.ts
  // PROVIDER_API_SUPPORT: Alpha Vantage official docs provide INDEX_CATALOG (200+ major market indices, full list via INDEX_CATALOG) + INDEX_DATA (OHLC daily/weekly/monthly, premium)
  // CURRENT_ADAPTER_SUPPORT: Phase 265 implements INDEX_CATALOG discovery (exact native symbol, long-form name, provider alpha-vantage, assetClass indices, deterministic ordering, dedup, no hardcoded list) + INDEX_DATA daily/weekly/monthly OHLC with timestamp provenance PROVIDER_OBSERVED, freshness DELAYED (historical), numerical validation, no synthetic candles
  // DXY determination: after implementing INDEX_CATALOG, search actual catalog — DXY not in documented examples (SPX, DJI, NDX, VIX, etc.), no evidence DXY included; retain NOT_IMPLEMENTED for DXY actual price series, no proxy substitution
  { provider: "alpha-vantage", capability: "DISCOVERY", status: "CREDENTIAL_REQUIRED", detail: "Phase 265: Alpha Vantage INDEX_CATALOG implemented via src/lib/discovery/alpha-vantage-index-adapter.ts — provider=alpha-vantage providerInstrumentId exact native symbol byte-for-byte (e.g., SPX, DJI, NDX, VIX), assetClass indices subType index_cash, baseAsset symbol, quoteAsset USD, tradingState TRADING, capabilities ohlcv/quote, discoveredAt now, deterministic ordering, dedup via provider::providerInstrumentId, CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE, COMPLETE when catalog succeeds, no hardcoded list, catalog is source of truth, 200+ indices per provider docs. DXY determination: catalog does not list DXY in documented examples, no evidence DXY included — retain NOT_IMPLEMENTED for DXY, no proxy.", credential: "ALPHA_VANTAGE_API_KEY", timestampSemantics: "provider-observed now", freshness: "FRESH" },
  { provider: "alpha-vantage", capability: "FUNDAMENTALS", status: "CREDENTIAL_REQUIRED", detail: "Alpha Vantage OVERVIEW/earnings/financials/valuation — CURRENT_ADAPTER_SUPPORT implemented, provider-observed via alphaVantage.ts", credential: "ALPHA_VANTAGE_API_KEY", timestampSemantics: "APPLICATION_RECEIPT", freshness: "DELAYED" },
  { provider: "alpha-vantage", capability: "NEWS", status: "CREDENTIAL_REQUIRED", detail: "Alpha Vantage NEWS_SENTIMENT — CURRENT_ADAPTER_SUPPORT implemented", credential: "ALPHA_VANTAGE_API_KEY", timestampSemantics: "APPLICATION_RECEIPT", freshness: "DELAYED" },
  { provider: "alpha-vantage", capability: "OHLCV", status: "CREDENTIAL_REQUIRED", detail: "Phase 265: Alpha Vantage INDEX_DATA implemented via alpha-vantage-index-adapter.ts — daily/weekly/monthly OHLC with timestamp provenance PROVIDER_OBSERVED, freshness DELAYED (historical/delayed, not real-time), numerical validation, no synthetic candles, exact native symbol preserved, premium plan required per provider docs. FX_INTRADAY also supported for forex. Historical semantics: index daily/weekly/monthly is HISTORICAL_ONLY, labeled honestly, not passed into live-only gate.", credential: "ALPHA_VANTAGE_API_KEY", timestampSemantics: "provider datetime PROVIDER_OBSERVED", freshness: "DELAYED" },
  { provider: "alpha-vantage", capability: "LIVE", status: "NOT_IMPLEMENTED", detail: "Phase 265: INDEX_DATA is historical/delayed (daily/weekly/monthly), not real-time live — do not label as LIVE. LIVE remains NOT_IMPLEMENTED. DXY: Actual DXY price series is not currently verified as available from the configured provider — INDEX_CATALOG implemented but DXY not in documented catalog examples (SPX, DJI, NDX, VIX, etc.), no evidence DXY included, no adapter for DXY price, reject proxies (EUR inverse, UUP/UDN, news sentiment, dollar-strength, futures). NEWS-derived USD trend fallback only.", credential: "ALPHA_VANTAGE_API_KEY", timestampSemantics: "N/A", freshness: "UNAVAILABLE" },

  // treasury — historical only
  { provider: "treasury", capability: "MACRO", status: "HISTORICAL_ONLY", detail: "Treasury yield_curves/interest_rates via fiscaldata", timestampSemantics: "record_date provider-observed", freshness: "STALE" },

  // cftc — historical only
  { provider: "cftc", capability: "MACRO", status: "HISTORICAL_ONLY", detail: "COT positioning", timestampSemantics: "APPLICATION_RECEIPT", freshness: "STALE" },

  // eia — credential required + historical
  { provider: "eia", capability: "MACRO", status: "CREDENTIAL_REQUIRED", detail: "EIA inventory/supply_demand", credential: "EIA_API_KEY", timestampSemantics: "APPLICATION_RECEIPT", freshness: "STALE" },

  // tickatlas/tradingEconomics — calendar
  { provider: "tickatlas", capability: "CALENDAR", status: "CREDENTIAL_REQUIRED", detail: "Economic calendar via TickAtlas", credential: "TICKATLAS_API_KEY", timestampSemantics: "PROVIDER_OBSERVED or APPLICATION_RECEIPT", freshness: "FRESH/DELAYED" },
  { provider: "tradingEconomics", capability: "CALENDAR", status: "TEST_VERIFIED", detail: "Economic calendar via TradingEconomics", timestampSemantics: "PROVIDER_OBSERVED", freshness: "FRESH" },

  // defillama/tokenomist — historical/discovery only
  { provider: "defillama", capability: "FUNDAMENTALS", status: "HISTORICAL_ONLY", detail: "DeFiLlama TVL/fees", timestampSemantics: "APPLICATION_RECEIPT", freshness: "FRESH informational" },
  { provider: "tokenomist", capability: "FUNDAMENTALS", status: "HISTORICAL_ONLY", detail: "Tokenomist unlocks", timestampSemantics: "APPLICATION_RECEIPT", freshness: "FRESH informational" },

  // DXY — not implemented actual price, fallback news proxy explicitly not DXY price
  // Phase 265: After implementing INDEX_CATALOG, DXY determination — search actual catalog: documented examples SPX, DJI, NDX, VIX, RUT, etc., no DXY in list, no evidence DXY included; provider docs say 200+ major market indices but examples are equity indices (Dow, S&P, Nasdaq, VIX, Russell), not currency index DXY (ICE US Dollar Index); retain NOT_IMPLEMENTED with honest wording, reject proxies
  { provider: "dxy", capability: "LIVE", status: "NOT_IMPLEMENTED", detail: "Phase 265 DXY determination: INDEX_CATALOG implemented via alpha-vantage-index-adapter.ts — searched actual catalog (provider source of truth, 200+ indices). Documented examples: SPX, DJI, NDX, VIX, RUT, COMP, DJS — no DXY in list. No evidence DXY (ICE US Dollar Index) included in Alpha Vantage INDEX_CATALOG. Twelve Data candidates (DXY, DX.Y.NYB, etc.) verified 404 live on current plan. Actual DXY price series is not currently verified as available from the configured provider — no EUR/USD inversion, no UUP/UDN ETF proxy, no USD news sentiment proxy, no dollar-strength proxy, no futures proxy. NEWS-derived USD trend labeled fallback only, not actual DXY price data. Status remains NOT_IMPLEMENTED per TASK E outcome C/D." },
];

export function getReadiness(provider: string, capability: ProviderCapabilityReadiness["capability"]): ProviderCapabilityReadiness | undefined {
  // Exact match first
  const exact = PROVIDER_READINESS_MATRIX.find((r) => r.provider === provider && r.capability === capability);
  if (exact) return exact;
  // CCXT family fallback
  if (provider.startsWith("ccxt:")) {
    return PROVIDER_READINESS_MATRIX.find((r) => r.provider === "ccxt" && r.capability === capability);
  }
  return undefined;
}

export function isRuntimeReady(status: RuntimeReadinessStatus): boolean {
  return status === "RUNTIME_VERIFIED";
}

export function isBlockedByCredentials(status: RuntimeReadinessStatus): boolean {
  return status === "CREDENTIAL_REQUIRED";
}

export function isBlockedByLicense(status: RuntimeReadinessStatus): boolean {
  return status === "LICENSE_REQUIRED";
}
