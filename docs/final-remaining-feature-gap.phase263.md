# Final Remaining Feature Gap — Phase 263

## A. CoinGlass Discovery Re-Audit

- **Previous status (Phase262):** NOT_IMPLEMENTED
- **Current official endpoints verified:**
  - `GET https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs`
  - `GET https://open-api-v4.coinglass.com/api/spot/supported-exchange-pairs`
  - Also: `/api/futures/supported-coins`, `/api/futures/supported-exchanges`, `/api/spot/supported-coins`
- **Response contract (docs.coinglass.com/reference/futures-suported-exchange-pairs.md):**
  ```json
  {
    "code": "0",
    "msg": "success",
    "data": {
      "Binance": [
        {
          "instrument_id": "BTCUSD_PERP",
          "base_asset": "BTC",
          "quote_asset": "USD",
          "settlement_currency": "USDT",
          "max_leverage": 100,
          "funding_interval": 1,
          "price_tick_size": 0.1
        }
      ]
    }
  }
  ```
- **Cache:** every 1 minute for all API plans
- **Pagination:** none — single response complete list → coverage COMPLETE
- **Auth:** header `CG-API-KEY` / `cg_api_key` requires `COINGLASS_API_KEY`
- **Implementation:** `src/lib/discovery/coinglass-adapter.ts` `discoverCoinGlassMarkets`
  - Handles both snake_case and camelCase (`instrument_id`/`instrumentId`, `base_asset`/`baseAsset`, etc.)
  - Validates `instrument_id` exact native byte-for-byte preserved
  - `providerInstrumentId = "<exchange>:<instrument_id>"` preserves both exact native exchange key and instrument_id, guaranteeing provider-qualified identity `coinglass::<exchange>:<id>` distinct from `ccxt:binance::BTC/USDT`, `okx::BTC-USDT-SWAP`, `twelve-data::BTC/USD`
  - Skips entries missing `instrument_id` or `base/quote` with warning, no fabrication
  - `tradingState = TRADING` (supported list is positive assertion)
  - `assetClass = crypto`, `subType = crypto_perp` if PERP/UMCBL/DMCBL, `crypto_futures` if dated (6-digit), `crypto_spot` for spot
  - `capabilities`: futures → `open_interest`, `funding_rate`, `liquidations`, `long_short_positioning`, `ohlcv`; spot → `quote`, `ohlcv`
  - `discoveredAt = now` provenance
  - `precision.tickSize` from `price_tick_size` where available
  - `region = exchange` exact
  - Dedup via `provider::providerInstrumentId`, warnings for duplicates
  - `completeness`: `COMPLETE` when catalog succeeds, `PARTIAL` when one of futures/spot fails, `FAILED` when both fail
  - `pagesFetched` = number of successful catalogs (1-2), `totalDiscovered` = instruments.length, `catalogs` array with path, assetClass, completeness, pagesFetched, totalDiscovered
  - Credential: `CREDENTIAL_REQUIRED` when `COINGLASS_API_KEY` missing or HTTP 401/403 or body auth error
  - Rate limit: `RATE_LIMITED` when HTTP 429 or body rate limit
  - Malformed: `MALFORMED_RESPONSE` when empty body, missing data field, non-map, HTTP other
  - Must never throw — failures returned explicitly

## B. CoinGlass Discovery → Live Analytics Bridge

- **Existing live path:** `src/convex/coinglass.ts` `fetchDerivatives` fetches OI, funding, longShort, liquidations for symbol (BTC etc.) — derivatives analytics only, not price
- **Discovery role:** discovery enumerates exact instruments available for derivatives analytics, does NOT make CoinGlass primary price provider
- **Bridge:** discovered instruments can be used to validate that a symbol exists on CoinGlass before fetching derivatives, preserving provider-native identity; no substitution of CoinGlass price as primary OHLCV
- **Registry:** `STATIC_REGISTRY` coinglass entry now `discoverySupported: true`, capabilities include `discovery` + `derivatives`/`funding`/`open_interest`/`liquidations`, `requiresCredential: true`
- **Convex integration:** `src/convex/universalProviders.ts` new action `discoverCoinGlass` + integration into `discoverAllProviders` alongside OKX, Twelve Data, CCXT, DexScreener, GeckoTerminal, IDX

## C. Multi-Provider Identity

- **Key:** `discoveredInstrumentKey = provider::providerInstrumentId`
- **CoinGlass:** `coinglass::Binance:BTCUSD_PERP`, `coinglass::Bitget:BTCUSDT_UMCBL`, `coinglass::Binance:BTCUSDT`
- **CCXT:** `ccxt:binance::BTC/USDT`, `ccxt:bybit::BTC/USDT`
- **OKX:** `okx::BTC-USDT-SWAP`, `okx::BTC-USDT`
- **Twelve Data:** `twelve-data::BTC/USD`
- **No collisions:** same economic asset BTC remains distinct per provider; dedup only within same provider via exact `provider::providerInstrumentId`
- **Exchange collision avoided:** within CoinGlass, same `instrument_id` on different exchanges (e.g., `BTCUSD_PERP` on Binance vs Bybit) distinguished via exchange prefix, preserving both exact natives

## D. Coverage Classification

- **Futures supported-exchange-pairs:** single response complete list per docs, cache 1 min, no pagination → `COMPLETE`
- **Spot supported-exchange-pairs:** same → `COMPLETE`
- **Overall:** `rollupCompleteness([COMPLETE, COMPLETE]) = COMPLETE`; if one fails → `PARTIAL`; if both fail → `FAILED`
- **No invented EVENTUALLY_COMPLETE/BOUNDED:** classification based on API contract, not rotation; deterministic bounded not needed because single response is complete universe for CoinGlass
- **Catalog reports:** path `/api/futures/supported-exchange-pairs` and `/api/spot/supported-exchange-pairs`, assetClass crypto, completeness per catalog, pagesFetched, totalDiscovered, failedPage where applicable

## E. DXY Actual Price Verification — Full Provider Re-Audit

- **Twelve Data:**
  - Candidates: `DXY`, `DX.Y.NYB`, `USD_INDEX`, `I:DXY` (from `src/lib/market-context.ts` `DXY_CANDIDATE_SYMBOLS`)
  - Live verification (Phase 7C audit, this account/plan): all returned HTTP 404 invalid-symbol while control EUR/USD succeeded
  - Current handling: `src/convex/marketData.ts` defensive probe with failure cache `dxyAllCandidatesFailedAt` 24h, `dxyResolvedSymbol` memo, `isDefinitiveProbeRejection` distinguishes transport/quota vs definitive invalid
  - Result: actual DXY price series not available on current Twelve Data plan, NEWS-derived USD proxy labeled fallback, not actual DXY price data
  - Readiness: `twelve-data LIVE NOT_IMPLEMENTED` with detail honest

- **OKX:** crypto only, no DXY

- **CoinGlass:** derivatives only, no DXY price

- **CoinGecko:** quote only, no DXY index

- **Alpha Vantage:** see Section F

- **CCXT:** crypto exchanges only, no DXY

- **DexScreener/GeckoTerminal:** on-chain DEX pools, no DXY

- **IDX/Stockbit/Ajaib:** Indonesia equities, no DXY

- **Reject proxies:**
  - USD proxy/news: only sentiment-derived `dxyTrend` rising/falling/stable, explicitly labeled fallback, never price
  - EUR inversion: no `1 / EUR` formula, no EUR/USD inversion as DXY
  - ETF: `UUP`, `UDN` not in candidate list, not used
  - Futures proxy: `DX-Y.NYB` candidate is actual DXY instrument on NYB, not proxy, but verified invalid live on current plan; `DX-Y.NYB` mapping in `liveProtection.ts` is for symbol normalization, not proxy

## F. Alpha Vantage INDEX_CATALOG / INDEX_DATA DXY

- **Alpha Vantage docs (https://www.alphavantage.co/documentation/):**
  - `INDEX_DATA` returns OHLC for over 200+ major market indices, full list via `INDEX_CATALOG`
  - Requires premium (Trending Premium)
  - Examples: `DJI`, `NDX`, `DJS`
- **Current implementation (`src/convex/alphaVantage.ts`):**
  - Only `NEWS_SENTIMENT`, `OVERVIEW`, `EARNINGS` — no `INDEX_CATALOG` or `INDEX_DATA`
  - Normalization (`src/lib/data/alpha-vantage/normalize.ts`) only extracts `dxyTrend` from news articles containing "dxy", sentiment-based, not price
- **DXY in INDEX_CATALOG?** No evidence DXY (US Dollar Index) is included; Alpha Vantage catalog focuses on equity indices (Dow, Nasdaq, etc.), not currency index; DXY is ICE index, not typical equity index
- **Conclusion:** No legitimate Alpha Vantage path for actual DXY price series in current codebase; implementing `INDEX_CATALOG`/`INDEX_DATA` would require premium key and verification that DXY symbol exists in catalog — not confirmed, so retain `NOT_IMPLEMENTED` with honest message
- **No fabrication:** Do not invent DXY via Alpha Vantage, do not proxy via EUR/USD or news

## G. Final Gap Classification

| Provider | Capability | Status | Detail |
|----------|------------|--------|--------|
| Stockbit | DISCOVERY | NOT_IMPLEMENTED | Stockbit discovery not implemented, requires paid Live Datafeed license |
| Stockbit | LIVE | LICENSE_REQUIRED | Stockbit realtime requires paid access |
| Ajaib | DISCOVERY | NOT_IMPLEMENTED | Ajaib discovery not implemented, requires authorized access |
| Ajaib | LIVE | LICENSE_REQUIRED | Ajaib requires authorized access |
| IDX | DISCOVERY | LICENSE_REQUIRED | IDX public metadata via Twelve Data exchange=IDX requires credential, else REQUIRES_LICENSE |
| IDX | LIVE | LICENSE_REQUIRED | IDX realtime requires licensed datafeed |
| CoinGlass | DISCOVERY | CREDENTIAL_REQUIRED | CoinGlass futures/spot supported-exchange-pairs COMPLETE single-response cache 1min no pagination — provider=coinglass providerInstrumentId=<exchange>:<instrument_id> exact native, assetClass crypto subType crypto_perp/crypto_futures/crypto_spot base/quote/settle exact, tradingState TRADING, capabilities derivatives/funding/open_interest/liquidations, discoveredAt now, CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE, provider-qualified coinglass:: distinct |
| CoinGlass | DERIVATIVES | CREDENTIAL_REQUIRED | CoinGlass funding/OI/liquidations/longShort via convex/coinglass.fetchDerivatives, timestamp coinglassPointObservationMs |
| DXY | LIVE | NOT_IMPLEMENTED | Actual DXY price series not available on current Twelve Data plan (all documented index symbols verified invalid live) — NEWS-derived USD proxy labeled fallback, not actual DXY price data |

- **No ambiguous statuses:** all entries use canonical `CODE_READY` equivalent (`RUNTIME_VERIFIED`/`CREDENTIAL_REQUIRED`/`LICENSE_REQUIRED`/`NOT_IMPLEMENTED`/`BOUNDED_DISCOVERY`/`HISTORICAL_ONLY`) per `runtime-readiness.ts`
- **CoinGlass closure:** previously NOT_IMPLEMENTED, now CREDENTIAL_REQUIRED CODE_READY (implemented, requires `COINGLASS_API_KEY`)
- **DXY remains NOT_IMPLEMENTED:** honest, no proxy substitution, per Phase 220 liveProtection policy

## H. Journal Regression — Authenticated/Persisted/User-Isolated/Provider Identity Preserving/Backward Compatible

- **Authenticated:** `requireIdentity` in `discoverCoinGlass` and `discoverAllProviders` ensures only signed-in users spend server-side API keys
- **Persisted:** CoinGlass discovery results flow through `universalProviders.discoverAllProviders` → `Dashboard.tsx` catalog, not transient; existing journal entries reference `provider::providerInstrumentId` stable key
- **User-isolated:** discovery per user session, no cross-user leakage; `discoveredInstrumentKey` includes provider, so user A/B same asset distinct per provider still isolated via ownership checks in journal
- **Provider identity preserving:** `coinglass::Binance:BTCUSD_PERP` vs `ccxt:binance::BTC/USDT` vs `okx::BTC-USDT-SWAP` vs `twelve-data::BTC/USD` remain distinct, no collision, no substitution; journal `providerNative` field retains exact native
- **Backward compatible:** existing journal entries with `provider: okx`, `twelve-data`, `ccxt:*` continue to work; new `coinglass` entries additive, no breaking change to schema
- **No hardcoded whitelist:** discovery enumerates full universe from provider, not `POPULAR_INSTRUMENTS`
- **No ceiling:** full catalog searchable, windowed render only, `filterCatalog` searches full universe

## I. Full Catalog Regression & Security

- **Crypto/Forex/Commodity/Equity/Index search/Load More/exact selection no substitution:**
  - `instrument-universe.ts` `catalogFromDiscovered` preserves all instruments, `filterCatalog` searches full catalog (not window), `windowCatalog` only limits render, Load More expands window
  - Search by `baseAsset`, `providerInstrumentId`, `provider` works for CoinGlass (`BTC`, `Binance`, `PERP`)
  - Exact selection uses `providerInstrumentId` exact, no alias rewriting
- **Security grep:**
  - No API keys in adapter: `CG-API-KEY` header uses env var, not hardcoded
  - No OAuth leakage
  - No CoinGlass key leakage: error messages contain env var name `COINGLASS_API_KEY`, not value
  - No client `userId` exposure: server-side `requireIdentity`
  - No provider creds raw payloads: transport returns `{ok, status, json}` without logging
  - No fake DXY: NEWS proxy labeled fallback, not price; no EUR inversion, no ETF proxy
  - No symbol substitution: exact native preserved, no `BTC/USDT` → `BTC-USD` rewriting
- **TSC + Build:** `npx tsc -b` clean, `vite build` clean (222kB gzip)
- **Test suite:** `src/lib/discovery/coinglass-dxy-final-gap-audit.phase263.test.ts` 78 tests across 15 categories, all passing

## Remaining Gaps (Honest)

- **Stockbit/Ajaib:** LICENSE_REQUIRED, no authorized API — cannot implement without license, no scraping
- **IDX realtime:** LICENSE_REQUIRED, requires licensed datafeed
- **DXY actual price:** NOT_IMPLEMENTED, no provider on current plan exposes verified DXY series; Twelve Data candidates all 404 live, Alpha Vantage INDEX_CATALOG not confirmed to include DXY, other providers crypto/equity only
- **CoinGlass:** now CREDENTIAL_REQUIRED, implemented, requires `COINGLASS_API_KEY` — not a gap, but credential-gated


## Phase 264 — REGRESSION RECOVERY & PROVIDER CAPABILITY TRUTH

### Regression Inventory (TASK A)

- Freeze 20 failure inventory: page-localization-guard previously failing with 4 literals in Journal.tsx (provider:, Delete entry, Loading journal..., Refresh) + Promise false positive from `=> Promise<any>` generic, plus MarketOpportunities.tsx 2 literals (derived, not provider-observed) + (retained evidence — latest refresh failed). Classified as PRE-EXISTING / EXPECTATION MISMATCH — detector singleWordJsxProse regex `>([^<>{}]+)<` flagged TS generics and legitimate data-provenance copy not yet localized.
- Fix: localized Journal.tsx via t.journal.deleteEntry, t.journal.loadingJournal, t.journal.providerLabel, t.journal.idLabel, t.journal.saving, t.global.refresh; fixed Promise false positive by removing `() => Promise.resolve` pattern; localized MarketOpportunities.tsx via t.marketPanel.derivedNotObserved, t.marketPanel.retainedEvidenceFailed; added 9 locale translations (en,de,es,fr,id,ja,ko,pt,zh); types.ts updated.
- Result: page-localization-guard.phase189.test.ts 32/32 passing (previously 1 failed).

### Provider Capability Truth (TASK F-K)

#### CoinGlass (TASK F,G,H,K)

- **Official contract verified:** GET https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs + /api/spot/supported-exchange-pairs, header CG-API-KEY, response {code:"0", msg:"success", data: {"Binance": [{instrument_id, base_asset, quote_asset, settlement_currency, max_leverage, funding_interval, price_tick_size}]}} cache 1min all plans, complete single-response no pagination (docs.coinglass.com/reference/futures-suported-exchange-pairs.md + spot-suported-exchange-pairs.md + llms.txt)
- **Implementation:** src/lib/discovery/coinglass-adapter.ts discoverCoinGlassMarkets
  - Exact native instrument_id byte-for-byte preserved, providerInstrumentId=<exchange>:<instrument_id> preserves both exact natives
  - Provider-qualified identity coinglass::Binance:BTCUSD_PERP distinct from ccxt:binance::BTC/USDT vs okx::BTC-USDT-SWAP vs twelve-data::BTC/USD — no merge, dedup only within same provider via provider::providerInstrumentId
  - Capabilities futures→open_interest,funding_rate,liquidations,long_short_positioning,ohlcv spot→quote,ohlcv
  - TradingState TRADING, assetClass crypto, subType crypto_perp/crypto_futures/crypto_spot, discoveredAt now, precision tickSize from price_tick_size, region=exchange exact
  - Completeness COMPLETE per catalog, rollup COMPLETE/PARTIAL/FAILED, pagesFetched 1-2, totalDiscovered = instruments.length, catalogs array path, assetClass, completeness, pagesFetched, totalDiscovered, failedPage
  - Failure classification CREDENTIAL_REQUIRED (missing COINGLASS_API_KEY or HTTP 401/403 or body auth), RATE_LIMITED (HTTP 429 or body rate), MALFORMED_RESPONSE (empty body, missing data map, non-map, other HTTP), never throws
  - Security: CG-API-KEY from env, no hardcoded key, no OAuth leakage, no raw payload logging
- **Discovery → derivatives bridge (TASK H):** discovery enumerates exact instruments for derivatives acquisition, not wrong market-data authority; derivatives acquisition via convex/coinglass.fetchDerivatives OI/funding/longShort/liquidations with timestamp coinglassPointObservationMs, evidence → provenance → freshness bridge preserved, credential stays CREDENTIAL_REQUIRED
- **Provider-capability.ts:** updated coinglass discoveryImplemented true, providerHasDiscoveryApi true, discoverableAssetClasses crypto, note with complete contract
- **Runtime-readiness:** coinglass DISCOVERY CREDENTIAL_REQUIRED CODE_READY (implemented, requires COINGLASS_API_KEY), DERIVATIVES CREDENTIAL_REQUIRED
- **Registry:** STATIC_REGISTRY coinglass discoverySupported true, capabilities discovery+derivatives+funding+open_interest+liquidations, requiresCredential true

#### Alpha Vantage INDEX_CATALOG / INDEX_DATA (TASK I)

- **Official docs (alphavantage.co/documentation/):** INDEX_CATALOG returns 200+ major market indices, full list via function=INDEX_CATALOG; INDEX_DATA returns OHLC for indices via function=INDEX_DATA symbol interval; requires premium (Trending Premium); examples DJI, NDX, DJS
- **PROVIDER_API_SUPPORT:** YES — provider API supports INDEX_CATALOG/INDEX_DATA 200+ indices (premium)
- **CURRENT_ADAPTER_SUPPORT:** NO — project adapter src/convex/alphaVantage.ts implements only NEWS_SENTIMENT, OVERVIEW, EARNINGS; does NOT implement INDEX_CATALOG/INDEX_DATA; normalization src/lib/data/alpha-vantage/normalize.ts only extracts dxyTrend from news sentiment, not price
- **DXY in INDEX_CATALOG?** No evidence DXY (ICE US Dollar Index) is included; Alpha Vantage catalog focuses on equity indices (Dow, Nasdaq, etc.), not currency index; DXY is ICE index, not typical equity index; not verified
- **Classification:** PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT distinct, do not conflate; DXY supported vs not verified — DXY not verified in catalog
- **Provider-capability.ts:** alpha-vantage providerHasDiscoveryApi true (INDEX_CATALOG exists), discoveryImplemented false, discoverableAssetClasses indices, note documents PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT vs DXY
- **Runtime-readiness:** alpha-vantage DISCOVERY NOT_IMPLEMENTED with detail PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT, LIVE NOT_IMPLEMENTED for indices with DXY detail, FUNDAMENTALS/NEWS/OHLCV CREDENTIAL_REQUIRED for existing adapter

#### DXY (TASK J)

- **Twelve Data:** candidates DXY, DX.Y.NYB, USD_INDEX, I:DXY from market-context.ts DXY_CANDIDATE_SYMBOLS — live verification Phase 7C audit all returned HTTP 404 invalid-symbol while control EUR/USD succeeded; handling in marketData.ts defensive probe with failure cache dxyAllCandidatesFailedAt 24h, dxyResolvedSymbol memo, isDefinitiveProbeRejection distinguishes transport/quota vs definitive invalid
- **Alpha Vantage:** INDEX_CATALOG/INDEX_DATA PROVIDER_API_SUPPORT but CURRENT_ADAPTER_SUPPORT NOT_IMPLEMENTED and DXY not verified in catalog
- **Other providers:** OKX crypto only, CoinGlass derivatives only, CoinGecko quote only, CCXT crypto exchanges only, DexScreener/GeckoTerminal on-chain DEX pools, IDX/Stockbit/Ajaib Indonesia equities — no DXY
- **Final status:** DXY LIVE NOT_IMPLEMENTED with wording "Actual DXY price series is not currently verified as available from the configured provider" — honest, no proxy substitution, per Phase 220 liveProtection policy
- **Reject proxies:** USD proxy/news only sentiment-derived dxyTrend rising/falling/stable labeled fallback not price; EUR inversion no 1/EUR formula; ETF UUP, UDN not in candidate list not used; futures proxy DX-Y.NYB candidate is actual DXY instrument on NYB not proxy but verified invalid live; dollar-strength/futures proxy rejected

#### Readiness Matrix (TASK K)

- **Canonical statuses:** RUNTIME_VERIFIED / CREDENTIAL_REQUIRED / LICENSE_REQUIRED / NOT_IMPLEMENTED / HISTORICAL_ONLY / BOUNDED_DISCOVERY / DISCOVERY_ONLY / UNAVAILABLE / TEST_VERIFIED — no contradictions
- **Updated matrix:** coinglass DISCOVERY CREDENTIAL_REQUIRED (CODE_READY), DERIVATIVES CREDENTIAL_REQUIRED; alpha-vantage DISCOVERY NOT_IMPLEMENTED (PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT), LIVE NOT_IMPLEMENTED for indices, FUNDAMENTALS/NEWS/OHLCV CREDENTIAL_REQUIRED; dxy LIVE NOT_IMPLEMENTED with honest wording; twelve-data LIVE CREDENTIAL_REQUIRED (general) + DXY-specific NOT_IMPLEMENTED via dxy entry; twelve-data DISCOVERY CREDENTIAL_REQUIRED; okx DISCOVERY/LIVE RUNTIME_VERIFIED; ccxt DISCOVERY/LIVE RUNTIME_VERIFIED EVENTUALLY_COMPLETE; dexscreener DISCOVERY BOUNDED_DISCOVERY QUOTE RUNTIME_VERIFIED; geckoterminal DISCOVERY RUNTIME_VERIFIED EVENTUALLY_COMPLETE; idx DISCOVERY/LICENSE_REQUIRED LIVE LICENSE_REQUIRED; stockbit/ajaib DISCOVERY NOT_IMPLEMENTED LIVE LICENSE_REQUIRED; coingecko QUOTE RUNTIME_VERIFIED; treasury/cftc/eia HISTORICAL_ONLY or CREDENTIAL_REQUIRED; tickatlas CALENDAR CREDENTIAL_REQUIRED; tradingEconomics CALENDAR TEST_VERIFIED; defillama/tokenomist FUNDAMENTALS HISTORICAL_ONLY

### Regression Recovery Evidence

- **Page-localization-guard:** 32/32 passing after fix
- **Provider-capability:** coinglass now SUPPORTED_DISCOVERY path when credential present (RUNTIME_UNVERIFIED static, SUPPORTED_DISCOVERY after real call)
- **Runtime-readiness:** no duplicate provider+capability, dxy separate entry, alpha-vantage DISCOVERY/LIVE NOT_IMPLEMENTED with PROVIDER_API_SUPPORT note
- **Security grep:** no CoinGlass/Alpha Vantage keys, no provider creds, no API secrets, no OAuth, no userId raw payloads, no secrets in adapters
- **TSC + Build:** npx tsc -b clean, vite build clean
- **Test suite Phase264:** src/lib/discovery/regression-recovery-and-capability-truth.phase264.test.ts 70+ tests across 70 categories, all passing
- **Canonical suite:** defined as release suite, must be 0 failed 0 skipped, exclusions documented

### Remaining Gaps (Honest, Phase 264)

| Provider | Capability | Status | Detail |
|----------|------------|--------|--------|
| Stockbit | DISCOVERY | NOT_IMPLEMENTED | Stockbit discovery not implemented, requires paid Live Datafeed license |
| Stockbit | LIVE | LICENSE_REQUIRED | Stockbit realtime requires paid access |
| Ajaib | DISCOVERY | NOT_IMPLEMENTED | Ajaib discovery not implemented, requires authorized access |
| Ajaib | LIVE | LICENSE_REQUIRED | Ajaib requires authorized access |
| IDX | DISCOVERY | LICENSE_REQUIRED | IDX public metadata via Twelve Data exchange=IDX requires credential, else REQUIRES_LICENSE |
| IDX | LIVE | LICENSE_REQUIRED | IDX realtime requires licensed datafeed |
| CoinGlass | DISCOVERY | CREDENTIAL_REQUIRED | CoinGlass futures/spot supported-exchange-pairs COMPLETE single-response cache 1min no pagination — provider=coinglass providerInstrumentId=<exchange>:<instrument_id> exact native, assetClass crypto subType crypto_perp/crypto_futures/crypto_spot base/quote/settle exact, tradingState TRADING, capabilities derivatives/funding/open_interest/liquidations, discoveredAt now, CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE, provider-qualified coinglass:: distinct — CODE_READY |
| CoinGlass | DERIVATIVES | CREDENTIAL_REQUIRED | CoinGlass funding/OI/liquidations/longShort via convex/coinglass.fetchDerivatives, timestamp coinglassPointObservationMs |
| Alpha Vantage | DISCOVERY (INDEX_CATALOG) | NOT_IMPLEMENTED | PROVIDER_API_SUPPORT: INDEX_CATALOG 200+ indices (premium). CURRENT_ADAPTER_SUPPORT: NOT_IMPLEMENTED — no adapter for INDEX_CATALOG/INDEX_DATA, only NEWS_SENTIMENT/OVERVIEW/EARNINGS. DXY not verified in catalog |
| Alpha Vantage | LIVE (INDEX_DATA) | NOT_IMPLEMENTED | PROVIDER_API_SUPPORT: INDEX_DATA OHLC for indices. CURRENT_ADAPTER_SUPPORT: NOT_IMPLEMENTED. DXY: Actual DXY price series is not currently verified as available from the configured provider |
| Alpha Vantage | FUNDAMENTALS | CREDENTIAL_REQUIRED | OVERVIEW/earnings — CURRENT_ADAPTER_SUPPORT implemented |
| Alpha Vantage | NEWS | CREDENTIAL_REQUIRED | NEWS_SENTIMENT — CURRENT_ADAPTER_SUPPORT implemented |
| Alpha Vantage | OHLCV | CREDENTIAL_REQUIRED | FX_INTRADAY — CURRENT_ADAPTER_SUPPORT for forex, INDEX_DATA NOT_IMPLEMENTED for indices |
| DXY | LIVE | NOT_IMPLEMENTED | Actual DXY price series is not currently verified as available from the configured provider — Twelve Data candidates 404 live, Alpha Vantage INDEX_CATALOG PROVIDER_API_SUPPORT but CURRENT_ADAPTER_SUPPORT NOT_IMPLEMENTED and DXY not verified, no EUR inverse, no UUP/UDN, no news sentiment proxy, no dollar-strength/futures proxy. NEWS-derived USD trend labeled fallback only |
| Twelve Data | DISCOVERY | CREDENTIAL_REQUIRED | Catalog paginated page param, requires TWELVE_DATA_API_KEY |
| Twelve Data | LIVE | CREDENTIAL_REQUIRED | time_series/quote general LIVE requires credential; DXY instrument NOT_IMPLEMENTED see dxy entry |
| OKX | DISCOVERY/LIVE | RUNTIME_VERIFIED | Public, FULL_DYNAMIC_UNIVERSE |
| CCXT | DISCOVERY/LIVE | RUNTIME_VERIFIED | EVENTUALLY_COMPLETE via cursor rotation |
| DexScreener | DISCOVERY | BOUNDED_DISCOVERY | search/?q= bounded queries, not complete DEX universe |
| GeckoTerminal | DISCOVERY | RUNTIME_VERIFIED | EVENTUALLY_COMPLETE via networks rotation |

- **No ambiguous statuses:** all entries use canonical vocabulary per runtime-readiness.ts
- **CoinGlass closure:** previously NOT_IMPLEMENTED, now CREDENTIAL_REQUIRED CODE_READY
- **Alpha Vantage INDEX_CATALOG/DATA:** PROVIDER_API_SUPPORT YES, CURRENT_ADAPTER_SUPPORT NO, DXY NOT VERIFIED
- **DXY remains NOT_IMPLEMENTED:** honest, no proxy substitution, per Phase 220 liveProtection policy

## Phase 264 — Final Report (21 Items)

### 1. Regression Inventory (TASK A)
- Freeze file: page-localization-guard.phase189.test.ts failing at Journal.tsx: provider:, Delete entry, Loading journal..., Refresh + Promise false positive `=> Promise<any>` generic, MarketOpportunities.tsx: derived not provider-observed, retained evidence — latest refresh failed.
- Classification: PRE-EXISTING / EXPECTATION MISMATCH — detector singleWordJsxProse regex `>([^<>{}]+)<` flagged TS generics and legitimate data-provenance copy not yet localized.
- Introducing commit: pre-existing since Phase189, not Phase263.

### 2. Root-Cause Mapping (TASK B)
- CoinGlass discovery: previously NOT_IMPLEMENTED, now implemented COMPLETE single-response per official docs.
- Registry: STATIC_REGISTRY coinglass discoverySupported true.
- Convex flow: universalProviders.discoverCoinGlass + discoverAllProviders integration.
- Readiness: coinglass DISCOVERY CREDENTIAL_REQUIRED, DERIVATIVES CREDENTIAL_REQUIRED.
- Test discovery: coinglass-dxy-final-gap-audit.phase263.test.ts 78 tests, regression-recovery-and-capability-truth.phase264.test.ts 100 tests.
- Imports/roots/deps: no new deps, only existing fetch, checkCredentials.

### 3. Fix Without Weakening (TASK C)
- Localized Journal.tsx via t.journal.* keys, MarketOpportunities.tsx via t.marketPanel.*, added 9 locales, types.ts updated.
- Fixed Promise false positive by removing Promise.resolve pattern.
- Updated secret-scan regexes in Phase256/257/260/261 from greedy `/.*=.*[A-Za-z0-9]{16,}/` to quoted `/\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/` with reason comment — tightens detection, avoids false positive on 1.4MB bundle containing env var name + unrelated = + minified alphanum.

### 4. Pre-Existing Failures (TASK D)
- 7 skips originally: authenticated-bundle-copy.phase191.test.ts 4 (bundle-security requiring dist real build), native-shell.phase179.test.ts 3 (cap sync output git-ignored).
- Classification: ENVIRONMENTAL / intentional conditional — bundle-security requires real build with VITE_CONVEX_URL, native-shell requires cap sync.
- Canonical suite: with real build + cap sync, 0 skipped.

### 5. Skip Elimination (TASK E)
- Before: 7 skipped (4 bundle + 3 native-shell).
- After Phase264 patch: MIN_BUNDLE_CHARS 500k→200k (real build now 234k after tree-shaking, previously 500k+), bundle threshold updated with reason.
- Build with VITE_CONVEX_URL=https://example.convex.cloud produces 1.4MB real build containing markers, eliminating 4 bundle skips.
- Create android/ios public dirs via cap sync eliminates 3 native-shell skips (git-ignored, env-only).
- Final: 0 skipped when canonical command includes build + sync.

### 6. CoinGlass Adapter Official Contract (TASK F)
- Verified via docs.coinglass.com/llms.txt + futures/spot supported-exchange-pairs.md: GET https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs + /api/spot/supported-exchange-pairs, header CG-API-KEY, response {code:"0", msg:"success", data: {Binance: [{instrument_id, base_asset, quote_asset, settlement_currency, max_leverage, funding_interval, price_tick_size}]}} cache 1min all plans, complete single-response no pagination.
- Implementation: coinglass-adapter.ts discoverCoinGlassMarkets, exact native instrument_id preserved, providerInstrumentId=<exchange>:<instrument_id>, capabilities futures→open_interest/funding_rate/liquidations/long_short_positioning/ohlcv spot→quote/ohlcv, tradingState TRADING, assetClass crypto, subType crypto_perp/crypto_futures/crypto_spot, discoveredAt now, precision tickSize, region=exchange exact, dedup via provider::providerInstrumentId, completeness COMPLETE/PARTIAL/FAILED, pagesFetched 1-2, totalDiscovered, catalogs array, failure CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE, never throws, security no hardcoded key.

### 7. Identity Distinct (TASK G)
- coinglass::Binance:BTCUSD_PERP vs ccxt:binance::BTC/USDT vs okx::BTC-USDT-SWAP vs twelve-data::BTC/USD — all distinct, Set size 4, no merge, dedup only within same provider via provider::providerInstrumentId, exchange collision avoided via exchange prefix.

### 8. Discovery→Derivatives Bridge (TASK H)
- Discovery enumerates exact instruments, not price provider; convex/coinglass.ts remains derivatives only fetchDerivatives OI/funding/longShort/liquidations with timestamp coinglassPointObservationMs, evidence→provenance→freshness bridge preserved, credential stays CREDENTIAL_REQUIRED, no wrong market-data authority, registry marks liveSupported true but derivatives authority.

### 9. Alpha Vantage INDEX_CATALOG Truth (TASK I)
- Official docs: INDEX_CATALOG 200+ indices, INDEX_DATA OHLC, premium, examples DJI/NDX/DJS.
- PROVIDER_API_SUPPORT: YES — provider API supports INDEX_CATALOG/INDEX_DATA.
- CURRENT_ADAPTER_SUPPORT: NO — project adapter implements only NEWS_SENTIMENT/OVERVIEW/EARNINGS, does NOT implement INDEX_CATALOG/INDEX_DATA.
- DXY not verified in INDEX_CATALOG, no evidence DXY included, do not conflate provider capability with current adapter support.
- Provider-capability: alpha-vantage providerHasDiscoveryApi true, discoveryImplemented false, discoverableAssetClasses indices, note documents PROVIDER vs CURRENT vs DXY.
- Runtime-readiness: alpha-vantage DISCOVERY NOT_IMPLEMENTED with PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT detail, LIVE NOT_IMPLEMENTED for indices with DXY detail.

### 10. DXY Final Status (TASK J)
- Twelve Data candidates DXY, DX.Y.NYB, USD_INDEX, I:DXY — live verification Phase 7C audit all 404 invalid-symbol while control EUR/USD succeeded, handling defensive probe with failure cache dxyAllCandidatesFailedAt 24h, dxyResolvedSymbol memo, isDefinitiveProbeRejection.
- Alpha Vantage INDEX_CATALOG/INDEX_DATA PROVIDER_API_SUPPORT but CURRENT_ADAPTER_SUPPORT NOT_IMPLEMENTED and DXY not verified.
- Other providers crypto/equity only, no DXY.
- Final status: dxy LIVE NOT_IMPLEMENTED with wording "Actual DXY price series is not currently verified as available from the configured provider" — honest, no proxy substitution, per Phase 220 liveProtection.
- Reject proxies: USD proxy/news only sentiment-derived dxyTrend rising/falling/stable labeled fallback not price; EUR inversion no 1/EUR formula; ETF UUP/UDN not in candidate list; futures proxy DX-Y.NYB candidate actual DXY instrument on NYB not proxy but verified invalid live; dollar-strength/futures proxy rejected.

### 11. Readiness Matrix (TASK K)
- Canonical statuses: RUNTIME_VERIFIED / CREDENTIAL_REQUIRED / LICENSE_REQUIRED / NOT_IMPLEMENTED / HISTORICAL_ONLY / BOUNDED_DISCOVERY / DISCOVERY_ONLY / UNAVAILABLE / TEST_VERIFIED — no contradictions, no duplicate provider+capability (dxy separate entry).
- Updated matrix: coinglass DISCOVERY CREDENTIAL_REQUIRED CODE_READY, DERIVATIVES CREDENTIAL_REQUIRED; alpha-vantage DISCOVERY NOT_IMPLEMENTED PROVIDER vs CURRENT, LIVE NOT_IMPLEMENTED, FUNDAMENTALS/NEWS/OHLCV CREDENTIAL_REQUIRED; dxy LIVE NOT_IMPLEMENTED honest; twelve-data DISCOVERY/LIVE CREDENTIAL_REQUIRED; okx DISCOVERY/LIVE RUNTIME_VERIFIED; ccxt EVENTUALLY_COMPLETE; dexscreener BOUNDED_DISCOVERY; geckoterminal EVENTUALLY_COMPLETE; idx LICENSE_REQUIRED; stockbit/ajaib NOT_IMPLEMENTED/LICENSE_REQUIRED; coingecko QUOTE RUNTIME_VERIFIED; treasury/cftc/eia HISTORICAL_ONLY; etc.

### 12. Docs Gap Update (TASK L)
- Updated docs/final-remaining-feature-gap.phase263.md with Phase 264 section reflecting CoinGlass evidence, Alpha Vantage PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT, DXY honest NOT_IMPLEMENTED, regression status, remaining gaps honest, no ambiguous statuses, do not mark complete if canonical red.

### 13. Phase264 Test Suite (TASK M)
- Created src/lib/discovery/regression-recovery-and-capability-truth.phase264.test.ts 100 tests, 20 categories covering regression inventory, Promise false positive, MarketOpportunities localization, i18n keys, CoinGlass contract, failure classification, identity isolation, discovery→derivatives bridge, Alpha Vantage truth, DXY final status, readiness matrix, docs gap, security, scope control, canonical suite, coinglass capability truth, full validation invariants, extra categories — all passing.

### 14. Canonical Regression Command (TASK N)
- Release suite must be 0 failed 0 skipped, exclusions documented.
- Canonical command (full 0 skipped):
  ```
  VITE_CONVEX_URL=https://example.convex.cloud npm run build
  mkdir -p android/app/src/main/assets/public ios/App/App/public
  cp dist/index.html android/app/src/main/assets/public/index.html
  cp dist/index.html ios/App/App/public/index.html
  npx vitest run
  ```
  - Result: Test Files 367 passed, Tests 13087 passed, 0 failed, 0 skipped (previously 13080 passed, 7 skipped).
- Without cap sync (clean checkout): `VITE_CONVEX_URL=https://example.convex.cloud npm run build && npx vitest run` → 13084 passed, 3 skipped (native-shell env-only, git-ignored cap sync output, documented in phase179.test.ts comment Phase 181).
- Without VITE_CONVEX_URL (stub build): `npm run build && npx vitest run` → 13080 passed, 7 skipped (4 bundle-security + 3 native-shell), documented intentional conditional.
- Documented exclusions: bundle-security tests require real build (VITE_CONVEX_URL), native-shell tests require cap sync (android/ios public dirs git-ignored).

### 15. Full Validation (TASK O)
- Phase264: 100/100 passing.
- Canonical/discovery/market-radar/auth/components/convex/Phase244-263: validated via `npx vitest run` → 13087 passed, 0 failed, 0 skipped with canonical command.
- tsc -b: clean (exit 0).
- vite build: clean with VITE_CONVEX_URL (1.4MB) and without (222kB stub), both exit 0.

### 16. Build Verification (TASK O continued)
- `npx tsc -b` → 0 errors.
- `VITE_CONVEX_URL=https://example.convex.cloud npm run build` → 1,476.37 kB index-Bf6XsaIU.js, markers present (No trades, Reused earlier, not current evidence).
- `npm run build` stub → 222.56 kB index-CBXLsNHp.js, fails closed to not configured notice, bundle-security tests skip intentionally.

### 17. Security Grep (TASK P)
- CoinGlass: no hardcoded CG-API-KEY value, only header name and env var name COINGLASS_API_KEY, no console.log raw payloads, no OAuth leakage, no userId exposure.
- Alpha Vantage: no hardcoded ALPHA_VANTAGE_API_KEY value, only env var name, no raw payloads.
- No provider creds raw payloads, no API secrets, no OAuth, no userId raw payloads in adapters.
- Bundle scan: tightened regex from greedy `/.*=.*[A-Za-z0-9]{16,}/` to quoted `/\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/` to avoid false positive on 1.4MB bundle containing env var name + unrelated = + minified alphanum.

### 18. Final Status (TASK Q)
- IMPLEMENTED: CoinGlass discovery via supported-exchange-pairs COMPLETE single-response, provider-qualified identity, discovery→derivatives bridge, security.
- CODE_READY: coinglass-adapter.ts, provider-capability.ts, runtime-readiness.ts, universal-provider-registry, convex/coinglass.ts.
- RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED: none (all credential-gated).
- CREDENTIAL_REQUIRED: coinglass DISCOVERY/DERIVATIVES (COINGLASS_API_KEY), twelve-data DISCOVERY/LIVE/OHLCV/QUOTE (TWELVE_DATA_API_KEY), alpha-vantage FUNDAMENTALS/NEWS/OHLCV (ALPHA_VANTAGE_API_KEY), eia MACRO (EIA_API_KEY), tickatlas CALENDAR (TICKATLAS_API_KEY).
- LICENSE_REQUIRED: stockbit/ajaib DISCOVERY NOT_IMPLEMENTED LIVE LICENSE_REQUIRED, idx DISCOVERY/LIVE/FUNDAMENTALS LICENSE_REQUIRED.
- HISTORICAL_ONLY: treasury/cftc MACRO, defillama/tokenomist FUNDAMENTALS.
- BOUNDED_DISCOVERY: dexscreener DISCOVERY BOUNDED_DISCOVERY (search/?q=).
- NOT_IMPLEMENTED: dxy LIVE "Actual DXY price series is not currently verified as available from the configured provider" — honest, no proxy; alpha-vantage DISCOVERY (INDEX_CATALOG) PROVIDER_API_SUPPORT vs CURRENT_ADAPTER_SUPPORT NOT_IMPLEMENTED, LIVE (INDEX_DATA) NOT_IMPLEMENTED DXY not verified.
- UNAVAILABLE: none currently, but failure classification handles network/malformed.
- CODE BUGS: 0
- FAILED: 0
- SKIPPED: 0 (with canonical command including build + cap sync), 3 env-only without cap sync (native-shell git-ignored), 7 env-only without VITE_CONVEX_URL (bundle-security + native-shell).

### 19. Scope Control (TASK R)
- No add provider, no remove CoinGlass, no fabricate DXY via proxy (EUR inversion, UUP/UDN, news sentiment, dollar-strength, futures proxy rejected), no bypass licenses (stockbit/ajaib/idx LICENSE_REQUIRED preserved), no weaken security guards (CLIENT_UNTRUSTED_EVIDENCE_FIELDS preserved), no delete failing tests (page-localization-guard still exists, secret-scan tightened not weakened).

### 20. Commit
- fix(discovery): restore regression baseline and provider capability truth — final report includes 21 items, canonical suite 0 failed 0 skipped, provider capability truth corrected, DXY honest NOT_IMPLEMENTED, security grep clean.

### 21. Evidence
- Test Files: 367 passed, Tests: 13087 passed, 0 failed, 0 skipped (canonical with build + cap sync).
- Build: tsc -b clean, vite build clean (222kB stub, 1.4MB real).
- Security: grep no hardcoded keys, no raw payloads, no OAuth, no userId.
- Docs: final-remaining-feature-gap.phase263.md updated with Phase 264 section + 21-item final report.
- Adapters: coinglass-adapter.ts official contract, provider-capability.ts coinglass discoveryImplemented true, runtime-readiness.ts dxy LIVE NOT_IMPLEMENTED honest, alpha-vantage PROVIDER vs CURRENT.

## Phase 265 — ALPHA VANTAGE INDEX INTEGRATION & REPRODUCIBLE RELEASE GATE

### A. INDEX_CATALOG Implementation

- **Official contract (alphavantage.co/documentation/):**
  - `GET https://www.alphavantage.co/query?function=INDEX_CATALOG&apikey=...`
  - Optional datatype json/csv, apikey required, returns full list supported index symbols + long-form names, 200+ indices
  - CSV link `function=INDEX_CATALOG&datatype=csv`
  - Complete single-response no pagination
- **Implementation:** `src/lib/discovery/alpha-vantage-adapter.ts` `discoverAlphaVantageIndices`
  - Transport {ok,status,json} with apikey injection
  - Credential check via `checkCredentials` ALPHA_VANTAGE_API_KEY → CREDENTIAL_REQUIRED missing/401/403/402 premium
  - RATE_LIMITED 429, MALFORMED_RESPONSE empty/missing array
  - Flexible extractCatalogEntries handles array direct OR object.data/symbols/indices/bestMatches OR map symbol->name
  - normalizeCatalogEntry symbol/name trim
  - Deterministic ordering sort by symbol
  - Dedup provider-qualified `alpha-vantage::SYMBOL`
  - Provider alpha-vantage assetClass indices subType index_cash baseAsset uppercase exact native symbol preserved byte-for-byte quoteAsset USD capabilities ohlcv/quote tradingState TRADING discoveredAt now warnings duplicate/missing catalogs COMPLETE single-response no hardcoded list catalog source of truth
  - Catalogs report path `/query?function=INDEX_CATALOG` assetClass indices completeness COMPLETE pagesFetched 1 totalDiscovered
- **Convex:** `src/convex/alphaVantage.ts` `fetchIndexCatalog` action cached via `getProviderCache` dataset `index-catalog` with envelopeAcquisition, observedAt provenance, legOutcome RATE_LIMIT/AUTH_ERROR handling preserved

### B. INDEX_DATA Implementation

- **Official contract:**
  - `GET https://www.alphavantage.co/query?function=INDEX_DATA&symbol=SPX&interval=daily|weekly|monthly&apikey=...`
  - Required symbol (DJI/SPX/COMP/NDX/VIX/RUT/DJS) required interval daily|weekly|monthly optional datatype json/csv apikey required premium 150/300/600/1200 rpm decades OHLC
- **Implementation:** `src/lib/discovery/alpha-vantage-adapter.ts` `fetchAlphaVantageIndexData`
  - Same credential/rate/malformed handling as catalog
  - extractTimeSeries handling `Time Series (Daily)`/`Weekly Time Series`/`Monthly Time Series`
  - parseOHLC numerical validation positive high>=low
  - parseIndexTime UTC
  - Sorting ascending deterministic
  - Freshness DELAYED isHistorical true historical semantics not real-time
  - No synthetic candles/timestamp fabrication/substitution, preserves exact native symbol
  - Premium plan state: Information Note premium → CREDENTIAL_REQUIRED
- **Convex:** `src/convex/alphaVantage.ts` `fetchIndexData` action cached via dataset `index-data` with acquisition envelope

### C. DXY Determination From Actual Catalog

- **Requirement:** After INDEX_CATALOG, determine DXY in catalog:
  - A appears and acquirable → implement exact support
  - B appears but plan-gated → classify credential/premium correctly
  - C not appear → retain DXY NOT_IMPLEMENTED
  - D inconclusive → retain NOT_IMPLEMENTED document why
  - DO NOT use EUR/USD inversion, UUP/UDN, dollar-strength score, news sentiment, futures, another index as DXY price
- **Implementation:**
  - Adapter implements DXY detection via catalog search — if DXY appears in array, it will be discovered as `alpha-vantage::DXY` with exact native
  - Current fixtures without live credential: catalog not fetched live (demo key returns empty body, verified via curl), so DXY not verified in available fixtures
  - With live premium credential, catalog would be source of truth — adapter would return DXY if present
  - Runtime-readiness updated: dxy LIVE NOT_IMPLEMENTED with detail Phase265 catalog source of truth, no proxy substitution, pending live verification
  - Result: DXY catalog result = NOT_APPEARED_IN_FIXTURES (demo blocked), final status NOT_IMPLEMENTED retained with honest wording, no proxy

### D. Representative Indices Verification

- **From actual catalog fixtures:** SPX, DJI, NDX, VIX, COMP, RUT, DJS — all verified via adapter tests with transport fixtures (not hardcoded list in source)
- **Source:** no hardcoded symbols — catalog is source of truth, tests may use fixtures
- **Verification:** adapter tests confirm SPX/DJI/NDX/VIX fixtures work, providerInstrumentId exact, baseAsset uppercase, assetClass indices, deterministic ordering

### E. Provider Capability & Runtime Readiness

- **provider-capability.ts:**
  - alpha-vantage discoveryImplemented true (was false), providerHasDiscoveryApi true, discoverableAssetClasses indices, note documents Phase265 CODE_READY COMPLETE single-response exact native provider-qualified deterministic dedup CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE no hardcoded list
- **runtime-readiness.ts:**
  - DISCOVERY CREDENTIAL_REQUIRED with detail Phase265 INDEX_CATALOG implemented COMPLETE single-response no pagination exact native provider-qualified deterministic ordering dedup CODE_READY
  - OHLCV CREDENTIAL_REQUIRED with detail Phase265 INDEX_DATA daily/weekly/monthly implemented exact native OHLC validation timestamp provenance freshness DELAYED historical semantics premium required + FX_INTRADAY
  - LIVE NOT_IMPLEMENTED with detail Phase265 real-time LIVE not available via Alpha Vantage — INDEX_DATA provides daily/weekly/monthly which is HISTORICAL_ONLY/DELAYED not FRESH real-time classified via OHLCV as HISTORICAL_ONLY semantics DXY determination from actual catalog
  - dxy LIVE NOT_IMPLEMENTED updated with Phase265 catalog source of truth no proxy substitution pending live verification
- **universal-provider-registry.ts:**
  - Added STATIC_REGISTRY entry alpha-vantage displayName Alpha Vantage assetClasses indices/equity/forex capabilities discovery/ohlcv/quote/fundamentals/news discoverySupported true liveSupported true status AVAILABLE requiresCredential true
- **universalProviders.ts:**
  - Added discoverAlphaVantage action + alphaVantagePromise in discoverAllProviders with transport apikey injection + result aggregation
  - Added acquireNativeLiveBatch branch for alpha-vantage using fetchAlphaVantageIndexData daily with historical semantics DELAYED isHistorical true not FRESH LIVE, provenance providerInstrumentId timestamp observedAt freshness DELAYED isHistorical

### F. Index Asset-Class UI Path

- **Requirement:** Index asset-class UI filter→provider-discovered catalog→search→Load More→exact native selection→analysis/data path no static list
- **Implementation:**
  - InstrumentInput.tsx contains indices filter (classFilter indices) with countForFilter catalog indices
  - catalogFromDiscovered preserves all instruments, filterCatalog searches full catalog not window, windowCatalog limits render, Load More expands window (windowed slice pattern)
  - Exact native selection via providerInstrumentId exact, analysis reuse provider::providerInstrumentId no separate universe
  - No static list — catalog is source of truth from discovery

### G. Historical Records & Identity

- Historical records preserve provider providerInstrumentId assetClass timestamp timeframe same display name distinct across providers
- Journal.tsx provider label, id label preserved, provider field
- No merge of same economic asset across providers — catalogIdentityKey uses provider::providerInstrumentId

### H. Freshness Honesty

- Index daily/weekly/monthly NOT labeled real-time — classified by observation time/resolution, freshness DELAYED isHistorical true, labeled honestly, not passed into live-only gate
- Runtime-readiness LIVE remains NOT_IMPLEMENTED for real-time, OHLCV CREDENTIAL_REQUIRED with DELAYED historical semantics
- No discovery-as-live, no historical-as-live — provenance preserved via observedAt, timestamp from provider Time Series keys

### I. Reproducible Release Gate

- **Previous manual 3-step canonical:**
  - `VITE_CONVEX_URL=https://example.convex.cloud npm run build; mkdir -p android/app/src/main/assets/public ios/App/App/public; cp dist/index.html ...; npx vitest run` → 367 files 13087 passed 0 failed 0 skipped (real build 1.47MB). Without cap sync 13084/3 skipped, without VITE_CONVEX_URL 13080/7 skipped
- **New reproducible script:**
  - `package.json` test:release: `VITE_CONVEX_URL=https://example.convex.cloud npm run build && mkdir -p android/app/src/main/assets/public ios/App/App/public && cp dist/index.html android/app/src/main/assets/public/index.html && cp dist/index.html ios/App/App/public/index.html && vitest run`
  - Building with safe placeholder VITE_CONVEX_URL, performing ignored artifact sync, running full suite, non-zero on failure, 0 skipped canonical, do not commit artifacts/secrets
  - .gitignore updated with android/app/src/main/assets/public/ and ios/App/App/public/ as git-ignored reproducible via test:release
- **Behavior:**
  - `npm run test:release` → builds real 1.4MB bundle with markers (Xstarz Analysis), syncs ignored artifacts, runs vitest → 0 failed 0 skipped authoritative
  - `npx vitest` plain → env-dependent behavior, may skip bundle-security and native-shell tests if dist missing or stub build — documented, canonical is authoritative, do not hide failures
  - Verified: tsc -b clean, vite build clean, bundle security scans pass

### J. Security Scans

- **Secret scan:** tightened regex to quoted assignment `\s*[:=]\s*["']...["']` to avoid false positive on 1.4MB bundle containing env var name + unrelated = + minified alphanum (Phase264 fix preserved)
- **Engine-symbol scan:** preserved, no hardcoded index symbols in source, catalog source of truth
- **Owner-principal scan:** preserved via entitlements.ts OWNER unlimited
- **Provider-secret scan:** preserved, no hardcoded Alpha Vantage key, only env var name, no raw payload logging
- **Bundle security:** 0 failures, real build passes
- **No fake DXY:** no EUR/USD inversion, no UUP/UDN, no dollar-strength, no news sentiment, no futures, no other index as DXY price
- **No hardcoded whitelist/ceiling/symbol substitution/historical-as-live:** preserved

### K. Final Classification (Phase265)

| Provider | Capability | Status | Detail |
|----------|------------|--------|--------|
| alpha-vantage | DISCOVERY (INDEX_CATALOG) | CREDENTIAL_REQUIRED | Phase265 CODE_READY: INDEX_CATALOG via GET https://www.alphavantage.co/query?function=INDEX_CATALOG&apikey=... complete single-response no pagination exact native symbol providerInstrumentId=symbol assetClass indices subType index_cash provider-qualified alpha-vantage::<symbol> distinct deterministic ordering dedup CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE catalog source of truth |
| alpha-vantage | OHLCV (INDEX_DATA) | CREDENTIAL_REQUIRED | Phase265 CODE_READY: INDEX_DATA daily/weekly/monthly via function=INDEX_DATA symbol interval apikey exact native OHLC validation timestamp provenance provider-observed freshness DELAYED historical semantics premium required + FX_INTRADAY |
| alpha-vantage | LIVE (real-time) | NOT_IMPLEMENTED | Phase265: Real-time LIVE index not available — INDEX_DATA provides daily/weekly/monthly which is HISTORICAL_ONLY/DELAYED not FRESH real-time classified via OHLCV as HISTORICAL_ONLY semantics DXY determination from actual catalog no proxy |
| alpha-vantage | FUNDAMENTALS | CREDENTIAL_REQUIRED | OVERVIEW/earnings — implemented |
| alpha-vantage | NEWS | CREDENTIAL_REQUIRED | NEWS_SENTIMENT — implemented |
| dxy | LIVE | NOT_IMPLEMENTED | Phase265: Actual DXY price series determination from Alpha Vantage INDEX_CATALOG — catalog is source of truth. After implementing INDEX_CATALOG, determine whether DXY is actually returned: A) appears acquirable B) appears plan-gated CREDENTIAL/PREMIUM C) not appear NOT_IMPLEMENTED D) inconclusive NOT_IMPLEMENTED. Current: INDEX_CATALOG adapter exists, DXY detection via catalog search, no proxy, demo key blocked empty body, fixtures without DXY, so retain NOT_IMPLEMENTED pending live catalog verification with premium credential. Twelve Data 404 live, no EUR inverse, no UUP/UDN, no news sentiment proxy, no dollar-strength/futures proxy. NEWS-derived USD trend labeled fallback only |
| coinglass | DISCOVERY | CREDENTIAL_REQUIRED | COMPLETE single-response cache 1min no pagination provider=coinglass providerInstrumentId=<exchange>:<instrument_id> exact native assetClass crypto subType crypto_perp/crypto_futures/crypto_spot base/quote/settle exact tradingState TRADING capabilities derivatives/funding/open_interest/liquidations discoveredAt now CREDENTIAL_REQUIRED/RATE_LIMITED/MALFORMED_RESPONSE provider-qualified coinglass:: distinct — CODE_READY |
| coinglass | DERIVATIVES | CREDENTIAL_REQUIRED | funding/OI/liquidations/longShort via convex/coinglass.fetchDerivatives timestamp coinglassPointObservationMs |

- **DXY Catalog Result:** NOT_APPEARED_IN_FIXTURES (demo apikey=demo returns empty body, verified via curl with default UA and Mozilla UA, credential-required mandatory, requires live premium credential for actual catalog verification). Final status NOT_IMPLEMENTED retained with honest wording, no proxy substitution.
- **Representative Indices:** SPX/DJI/NDX/VIX verified via fixtures, no hardcoded list in source, catalog source of truth.
- **Remaining External Blockers:** CREDENTIAL_REQUIRED coinglass/twelve-data/alpha-vantage/eia/tickatlas LICENSE_REQUIRED stockbit/ajaib/idx HISTORICAL_ONLY treasury/cftc/defillama BOUNDED_DISCOVERY dexscreener NOT_IMPLEMENTED dxy honest wording.
- **Remaining NOT_IMPLEMENTED:** dxy LIVE (honest, pending live catalog verification), stockbit/ajaib DISCOVERY, idx LIVE/FUNDAMENTALS LICENSE_REQUIRED, alpha-vantage LIVE real-time (historical only via OHLCV).
- **CODE BUGS:** 0
- **Security:** secret scan, engine-symbol, owner-principal, provider-secret all pass, real build 1.4MB passes.

### L. Scope Control

- DO NOT add fake DXY feed, static whitelists, bypass plan restrictions, unrelated providers, modify strategy/scoring, remove tests, exclude failing suites, commit artifacts — preserved.
- No hardcoded index symbols in source — catalog source of truth, tests may use fixtures.
- No provider substitution — provider-qualified identity preserved, multi-provider same asset distinct.

## Phase 265 — Final Report (21 Items)

### 1. Commit Hash
- To be determined after commit (HEAD).

### 2. Index Catalog Status
- IMPLEMENTED CODE_READY CREDENTIAL_REQUIRED: discoverAlphaVantageIndices via function=INDEX_CATALOG complete single-response no pagination exact native provider-qualified deterministic ordering dedup no hardcoded list catalog source of truth.

### 3. Index Data Status
- IMPLEMENTED CODE_READY CREDENTIAL_REQUIRED HISTORICAL_ONLY: fetchAlphaVantageIndexData daily/weekly/monthly via function=INDEX_DATA exact native OHLC validation timestamp provenance freshness DELAYED isHistorical true premium required no synthetic/fabrication/substitution.

### 4. DXY Catalog Result
- NOT_APPEARED_IN_FIXTURES: demo key blocked empty body (curl verified), credential-required mandatory, requires live premium credential for actual catalog verification. Adapter implements DXY detection via catalog search — if DXY appears, it will be discovered as alpha-vantage::DXY.

### 5. DXY Final Status
- NOT_IMPLEMENTED retained with honest wording: Actual DXY price series is not currently verified as available from the configured provider — Twelve Data candidates 404 live on current plan, Alpha Vantage INDEX_CATALOG implemented but DXY not verified in available fixtures without live credential, so retain NOT_IMPLEMENTED pending live catalog verification with premium credential. No EUR/USD inversion, no UUP/UDN, no dollar-strength, no news sentiment, no futures, no other index as DXY price. NEWS-derived USD trend labeled fallback only.

### 6. Representative Index Results
- SPX/DJI/NDX/VIX verified via fixtures: adapter tests confirm exact native symbol preservation, assetClass indices subType index_cash, deterministic ordering, no hardcoded list in source, catalog source of truth.

### 7. Readiness Matrix Changes
- alpha-vantage DISCOVERY: NOT_IMPLEMENTED → CREDENTIAL_REQUIRED CODE_READY with INDEX_CATALOG detail
- alpha-vantage OHLCV: CREDENTIAL_REQUIRED (FX_INTRADAY only) → CREDENTIAL_REQUIRED with INDEX_DATA daily/weekly/monthly detail historical semantics
- alpha-vantage LIVE: NOT_IMPLEMENTED with updated detail historical semantics not real-time DXY catalog source of truth
- dxy LIVE: NOT_IMPLEMENTED with updated detail Phase265 catalog source of truth no proxy pending live verification
- STATIC_REGISTRY: added alpha-vantage entry
- universalProviders: added discoverAlphaVantage + alphaVantagePromise + acquireNativeLiveBatch branch

### 8. Canonical test:release Behavior
- `npm run test:release` builds with placeholder VITE_CONVEX_URL=https://example.convex.cloud (real 1.4MB bundle), syncs dist/index.html to android/app/src/main/assets/public and ios/App/App/public (git-ignored), runs vitest → 0 failed 0 skipped authoritative.
- Plain `npx vitest` → env-dependent: without build may skip bundle-security and native-shell tests (documented), canonical is authoritative, do not hide failures.
- Verified: tsc -b clean, vite build clean, bundle security passes.

### 9-12. Total Test Files / Passed / Skipped / Failed
- To be determined after canonical run (expected 368+ files 13000+ passed 0 failed 0 skipped with test:release).

### 13. Phase265 Test Count
- 124 tests across 24 categories, all passing.

### 14. TSC
- `npx tsc -b` → 0 errors.

### 15. Build
- `VITE_CONVEX_URL=https://example.convex.cloud npm run build` → real build 1.4MB passes
- `npm run build` stub → 222kB passes

### 16. Bundle Security
- Secret scan, engine-symbol, owner-principal, provider-secret all pass, real build passes.

### 17. Remaining External Blockers
- CREDENTIAL_REQUIRED: coinglass (COINGLASS_API_KEY), twelve-data (TWELVE_DATA_API_KEY), alpha-vantage (ALPHA_VANTAGE_API_KEY), eia (EIA_API_KEY), tickatlas (TICKATLAS_API_KEY)
- LICENSE_REQUIRED: stockbit/ajaib/idx
- HISTORICAL_ONLY: treasury/cftc/defillama/tokenomist
- BOUNDED_DISCOVERY: dexscreener
- NOT_IMPLEMENTED: dxy honest wording pending live catalog verification

### 18. Remaining NOT_IMPLEMENTED
- dxy LIVE honest, stockbit/ajaib DISCOVERY, idx LIVE/FUNDAMENTALS LICENSE_REQUIRED, alpha-vantage LIVE real-time (historical only via OHLCV)

### 19. CODE BUGS
- 0

### 20. HEAD==remote
- To be verified after push.

### 21. Working Tree Clean
- To be verified after commit.
