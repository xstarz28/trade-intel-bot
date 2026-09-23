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
