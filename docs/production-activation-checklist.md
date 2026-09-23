# Phase 260 — Production Activation Handoff & Final Runtime Status

**Code freeze:** 3205 passed / 0 skipped / 0 failed (Phase259 baseline).  
**Build:** `src/lib/deployment/production-config.ts` + `production-deploy-guard.ts` + `production-url-validation.ts` deterministic, no I/O, no secrets.

This document is the exact, machine-verifiable production activation checklist. No secret values are included. Every item that needs external configuration is marked BLOCKED, not VERIFIED, until a real production request succeeds.

---

## 1. Production Configuration Checklist — names only, no values

### Core Convex

| Variable | Scope | Required in prod | Shape | Status in sandbox |
|---|---|---|---|---|
| `CONVEX_DEPLOYMENT` | convex-cli | Yes | `prod:<team>:<project>` | MISSING → PRODUCTION_DEPLOYMENT_NOT_CONFIGURED |
| `CONVEX_SITE_URL` | convex-production | Yes | https-url `*.convex.site` | PRESENT localhost dev only → not prod-ready |
| `VITE_CONVEX_URL` | app-build (public) | Yes | https-url `*.convex.cloud` | PRESENT placeholder dev |
| `XSTARZ_DEPLOYMENT_ENV` | convex-production | No (fail-closed absent=>production) | `production`\|`preview`\|`development` | MISSING defaults production |

### Email OTP

| Variable | Scope | Required | Shape | Sandbox |
|---|---|---|---|---|
| `XSTARZ_EMAIL_TRANSPORT` | convex-production | Yes in prod | `resend`\|`smtp2go` (console forbidden in prod) | `console` → DEV_CONSOLE_ONLY |
| `XSTARZ_EMAIL_API_KEY` | convex-production secret | Yes unless console | secret | MISSING → EMAIL_AUTH_CONFIG_REQUIRED |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | convex-production | Yes | email, must be Xstarz-owned, no `resend.dev` in prod | MISSING |

Production readiness = delivering transport + API key + Xstarz-owned sender + DNS SPF/DKIM/DMARC verified. Console transport reports success while delivering nothing — forbidden in production.

### Google OAuth

| Variable | Scope | Required | Sandbox |
|---|---|---|---|
| `AUTH_GOOGLE_ID` | convex-production secret | Yes for Google | MISSING |
| `AUTH_GOOGLE_SECRET` | convex-production secret | Yes for Google | MISSING |
| `CONVEX_SITE_URL` | convex-production | Yes | Must be https production origin for callback |

Required callback: `<production-site>/api/auth/callback/google` where origin == `CONVEX_SITE_URL` origin. Example: `https://myproject-123.convex.site/api/auth/callback/google`.

### Provider Credentials — server-only, never VITE_

| Variable | Provider | Capability | Sandbox |
|---|---|---|---|
| `TWELVE_DATA_API_KEY` | Twelve Data | DISCOVERY/LIVE/OHLCV/QUOTE XAU/USD EUR/USD AAPL + crypto/forex/commodity/equity | MISSING → CREDENTIAL_REQUIRED |
| `COINGLASS_API_KEY` | CoinGlass | DERIVATIVES funding/OI/long-short/liquidations | MISSING → CREDENTIAL_REQUIRED |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage | FUNDAMENTALS/NEWS/OHLCV fallback | MISSING → CREDENTIAL_REQUIRED |
| `EIA_API_KEY` | EIA | MACRO energy inventory | MISSING → CREDENTIAL_REQUIRED |
| `TICKATLAS_API_KEY` | TickAtlas | CALENDAR economic | MISSING → CREDENTIAL_REQUIRED |

Keyless public: OKX, CCXT, GeckoTerminal, DEXScreener, CoinGecko, Treasury, CFTC, DefiLlama, Tokenomist, TradingEconomics (optional).

### License Requirements — external, not credential

| Provider | Capability | Status | Required |
|---|---|---|---|
| IDX | DISCOVERY/LIVE realtime Indonesia | LICENSE_REQUIRED | Licensed datafeed contract |
| Stockbit | DISCOVERY/LIVE | NOT_IMPLEMENTED + LICENSE_REQUIRED | Paid Live Datafeed license |
| Ajaib | DISCOVERY/LIVE | NOT_IMPLEMENTED + LICENSE_REQUIRED | Authorized access |

---

## 2. Production URL Validation — deterministic cases

Implemented in `src/lib/deployment/production-url-validation.ts`, pure, no I/O.

| Case | Input | Expected Outcome | Reason |
|---|---|---|---|
| valid production | `prod:myteam:myproject`, `https://proj.convex.site`, `https://proj.convex.cloud`, callback `https://proj.convex.site/api/auth/callback/google` | VALID_PRODUCTION | https + *.convex.site + *.convex.cloud + prod shape + callback origin matches |
| invalid localhost | `http://localhost:5173` site + vite | INVALID_LOCALHOST + HTTP_SITE_URL | loopback cannot be production |
| wrong deployment identity | `dev:myteam:myproject` | WRONG_DEPLOYMENT_IDENTITY | dev/preview/local/anonymous not production |
| missing deployment identity | null | MISSING_DEPLOYMENT_IDENTITY | absent |
| HTTP site URL | `http://proj.convex.site` | HTTP_SITE_URL | must be https |
| mismatched callback domain | site `https://proj.convex.site` callback `https://other.convex.site/api/auth/callback/google` | MISMATCHED_CALLBACK_DOMAIN | callback origin != site origin |

Additional checks: `INVALID_CONVEX_URL` (not *.convex.site/cloud), `INVALID_CALLBACK_PATH` (path != `/api/auth/callback/google`), `NOT_HTTPS`.

---

## 3. Email Auth Activation

**DEV_CONSOLE_ONLY:**
- Transport `console` logs code to server logs, delivers nothing.
- Requires no API key, no sender.
- Forbidden in production — `emailDelivery.ts` throws, `production-config.ts` reports FORBIDDEN_FALLBACK.
- Sandbox state: DEV_CONSOLE_ONLY.

**PRODUCTION_READY:**
- `XSTARZ_EMAIL_TRANSPORT` = `resend` or `smtp2go`
- `XSTARZ_EMAIL_API_KEY` present (server-only secret, never printed)
- `XSTARZ_EMAIL_SENDER_ADDRESS` Xstarz-owned domain (not `resend.dev`)
- DNS: SPF, DKIM, DMARC verified via provider dashboard
- `XSTARZ_EMAIL_SENDER_NAME` optional defaults to `Xstarz Analysis`
- Must not log OTP value, must not expose API key, wrong/expired code fails, resend allowed, logout clears session.

No fake delivery claim until actual email received and OTP consumed.

---

## 4. Google Activation

Exact requirements:
- Google Cloud OAuth client created
- Client ID → `AUTH_GOOGLE_ID` (server-only secret)
- Client secret → `AUTH_GOOGLE_SECRET` (server-only secret)
- `CONVEX_SITE_URL` = production https origin, e.g. `https://myproject-123.convex.site`
- Authorized redirect URI in Google console: `<CONVEX_SITE_URL>/api/auth/callback/google`
- Example: `https://myproject-123.convex.site/api/auth/callback/google`
- PKCE + state required (implemented in `src/convex/auth.ts`)
- `email_verified` must be true
- `allowDangerousEmailAccountLinking` = false (safe linking)
- No OTP prompt after successful Google OAuth
- No duplicate account on linking, logout works, refresh works.

Sandbox: GOOGLE_OAUTH_PRODUCTION_CONFIG_REQUIRED, no fake login.

---

## 5. Provider Activation Matrix

| Provider | Capability | Current Code Status | Required Config | Actual Smoke (sandbox) | User-Facing Status |
|---|---|---|---|---|---|
| OKX | DISCOVERY SPOT/SWAP/FUTURES | CODE_READY (public, no cred) | none | NETWORK_ERROR fetch failed (sandbox egress blocked) | RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED |
| CCXT | DISCOVERY/LIVE dynamic 105 exchanges | CODE_READY (needs `ccxt` dep if not installed) | none / npm dep | NETWORK_ERROR if attempted | RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED |
| GeckoTerminal | DISCOVERY/QUOTE/OHLCV on-chain pools | CODE_READY | none | NETWORK_ERROR | RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED |
| DEXScreener | DISCOVERY (bounded) / QUOTE | CODE_READY BOUNDED_DISCOVERY | none | NETWORK_ERROR | BOUNDED_DISCOVERY |
| CoinGecko | QUOTE current-at-response | CODE_READY | none | NETWORK_ERROR | RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED |
| Twelve Data | DISCOVERY/LIVE/OHLCV/QUOTE | CODE_READY | TWELVE_DATA_API_KEY | BLOCKED missing credential | CREDENTIAL_REQUIRED |
| CoinGlass | DERIVATIVES funding/OI/LS/liquidations | CODE_READY | COINGLASS_API_KEY | BLOCKED missing credential | CREDENTIAL_REQUIRED |
| Alpha Vantage | FUNDAMENTALS/NEWS/OHLCV | CODE_READY | ALPHA_VANTAGE_API_KEY | BLOCKED missing credential | CREDENTIAL_REQUIRED |
| EIA | MACRO energy | CODE_READY HISTORICAL_ONLY semantics | EIA_API_KEY | BLOCKED missing credential | CREDENTIAL_REQUIRED |
| TickAtlas | CALENDAR | CODE_READY | TICKATLAS_API_KEY | BLOCKED missing credential | CREDENTIAL_REQUIRED |
| Treasury | MACRO yield_curves | CODE_READY HISTORICAL_ONLY | none (public) | CODE_READY but delayed | HISTORICAL_ONLY |
| CFTC | MACRO COT positioning | CODE_READY HISTORICAL_ONLY | none (public) | CODE_READY but delayed | HISTORICAL_ONLY |
| IDX | DISCOVERY/LIVE realtime | CODE_READY license-gated | LICENSE + TWELVE_DATA_API_KEY | BLOCKED | LICENSE_REQUIRED |
| Stockbit | DISCOVERY/LIVE | NOT_IMPLEMENTED | LICENSE_REQUIRED | BLOCKED | NOT_IMPLEMENTED + LICENSE_REQUIRED |
| Ajaib | DISCOVERY/LIVE | NOT_IMPLEMENTED | LICENSE_REQUIRED | BLOCKED | NOT_IMPLEMENTED + LICENSE_REQUIRED |

---

## 6. Final Runtime Status Correction

Previous report incorrectly used phrasing that combined PRODUCTION_RUNTIME_VERIFIED with a note about code capability. Honest terminology per Phase260:

- **CODE_READY:** implementation complete, unit tests green, no external request yet. Example: Twelve Data paths, CoinGlass parser, Alpha Vantage fundamentals — code exists, credential missing.
- **RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED:** code ready + public endpoint, but sandbox network egress blocks fetch. Example: OKX `https://www.okx.com/api/v5/public/instruments?instType=SPOT` fetch failed, CoinGecko ping failed. Not fabricated, observed NETWORK_ERROR.
- **PRODUCTION_RUNTIME_VERIFIED:** ONLY after actual production environment + actual external request/session + valid response + correct timestamp/provenance + correct UI result. Unit tests alone insufficient.
- **CREDENTIAL_REQUIRED:** auth required, env var missing.
- **LICENSE_REQUIRED:** realtime requires license.
- **HISTORICAL_ONLY:** not realtime, labeled delayed/stale.
- **BOUNDED_DISCOVERY:** provider API only supports bounded queries (DEXScreener search), cannot guarantee complete enumeration.
- **NOT_IMPLEMENTED:** no adapter.
- **UNAVAILABLE:** configured but endpoint failed / network / malformed / provider error.

No feature in this repo is PRODUCTION_RUNTIME_VERIFIED in sandbox. All public provider claims are CODE_READY or RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED until real production smoke.

---

## 7. Final User-Facing Status

Application shows (no raw env values):

- `Credential required` — TWELVE_DATA_API_KEY, COINGLASS_API_KEY, ALPHA_VANTAGE_API_KEY, EIA_API_KEY, TICKATLAS_API_KEY, AUTH_GOOGLE_ID/SECRET, XSTARZ_EMAIL_API_KEY/SENDER
- `License required` — IDX realtime, Stockbit, Ajaib
- `Unavailable` — endpoint failed, network, malformed
- `Historical-only` — Treasury, CFTC, DefiLlama, Tokenomist, EIA delayed semantics
- `Bounded discovery` — DEXScreener search-only, not full DEX universe
- `Not implemented` — Journal, DXY actual price, Stockbit discovery, Ajaib discovery, CoinGlass discovery, IDX realtime without license

No fabricated live data, no historical-as-live, no symbol substitution.

---

## 8. Real Runtime Verification Rule

A feature becomes `PRODUCTION_RUNTIME_VERIFIED` ONLY after ALL:

1. actual production environment (CONVEX_DEPLOYMENT prod shape, CONVEX_SITE_URL https *.convex.site, VITE_CONVEX_URL https *.convex.cloud, XSTARZ_DEPLOYMENT_ENV=production)
2. actual external request/session (not mock)
3. valid response (schema + numeric validation)
4. correct timestamp/provenance (provider-observed, not receipt-time unless contract says current-at-response)
5. correct UI result (analysis, opportunity, radar, portfolio, protection, history show live timestamp)

Unit tests alone are insufficient. `LIVE_VERIFIED` in `src/lib/data/universal/live/types.ts` is only assigned after real parsed validated response — never from mocks.

---

## 9. Final Feature Matrix

### RELEASE-READY CODE

- Technical engine, dataQuality, market context, MTF, decision trace/fingerprint, analyst thesis, market scenario, professional thesis, forward path, long horizon, evidence challenge, trade plan market-derived, position sizing (when complete), score breakdown, key levels/SR zones, risk note, crypto/universal intelligence, calendar, entitlement server authoritative FREE limit 2 analyses and OWNER unlimited, workspace, portfolio, protection, history provider chip backward-compatible, locale, InstrumentInput windowed catalog (Load More), search full catalog, provider badge, freshness/provenance/failure classification, retry/race/refresh/switching, protected analysis, readiness matrix, diagnostics safe, provider/native identity typed, no substitution/fake data/timestamp, UI truth, auth PKCE/state/safe linking/no OTP after Google, email OTP console vs prod distinction, deployment config validator.

Entitlement: FREE tier limited to 2 profit signals, OWNER unlimited via server-only XSTARZ_OWNER_PRINCIPALS principal match, fail-closed malformed config, valid session required, client cannot unlock.

### BLOCKED BY CONFIGURATION

- Convex deployment (CONVEX_DEPLOYMENT missing → PRODUCTION_DEPLOYMENT_NOT_CONFIGURED)
- CONVEX_SITE_URL https required (localhost present)
- Email transport (console → DEV_CONSOLE_ONLY, needs resend|smtp2go)
- Email API key/sender missing → EMAIL_AUTH_CONFIG_REQUIRED
- Google OAuth ID/SECRET missing → GOOGLE_OAUTH_PRODUCTION_CONFIG_REQUIRED
- Twelve Data, CoinGlass, Alpha Vantage, EIA, TickAtlas → CREDENTIAL_REQUIRED

### BLOCKED BY LICENSE

- IDX realtime → LICENSE_REQUIRED
- Stockbit → NOT_IMPLEMENTED + LICENSE_REQUIRED
- Ajaib → NOT_IMPLEMENTED + LICENSE_REQUIRED

### HISTORICAL/DELAYED

- Treasury yield_curves (record_date provider-observed) → HISTORICAL_ONLY STALE
- CFTC COT positioning → HISTORICAL_ONLY STALE
- EIA inventory (when credential present, still delayed) → HISTORICAL_ONLY
- DefiLlama TVL/fees → HISTORICAL_ONLY informational
- Tokenomist unlocks → HISTORICAL_ONLY informational
- CoinGlass free tier delayed → HISTORICAL_ONLY when credential present but free tier
- Trading Economics calendar → TEST_VERIFIED historical proxy

### BOUNDED

- DEXScreener discovery via `search/?q=` — bounded queries ETH/USDC/WETH/SOL, not complete DEX universe → BOUNDED_DISCOVERY

### NOT IMPLEMENTED

- Journal persistence
- DXY actual price series (Twelve Data plan no DXY symbol, NEWS proxy labeled fallback not actual price)
- Stockbit discovery
- Ajaib discovery
- CoinGlass discovery (derivatives analytics for instruments discovered elsewhere)
- IDX realtime without license

### ACTUALLY LIVE VERIFIED

- **None in sandbox.** All public endpoints return NETWORK_ERROR due to sandbox egress block. Code paths exist, no fabricated values. Real verification requires production deployment with network access and credentials. See `runtime-readiness.ts` — RUNTIME_VERIFIED there means code has live evidence capability when network allows, not that sandbox performed live request.

---

## 10. No False Claims

Search performed:

```
grep -R "PRODUCTION_RUNTIME_VERIFIED" src/ docs/
grep -R "RUNTIME_VERIFIED" src/lib/discovery/runtime-readiness.ts
```

- `PRODUCTION_RUNTIME_VERIFIED` appears only in test title "PRODUCTION_RUNTIME_VERIFIED vs TEST_VERIFIED" describing semantics, not claiming live success.
- `RUNTIME_VERIFIED` in `runtime-readiness.ts` is capability matrix with detail "public, no cred" — not a claim that sandbox performed request. Actual runtime verification requires network success, which is BLOCKED in sandbox.
- `LIVE_VERIFIED` in `src/lib/data/universal/live/types.ts` is only assigned after real response, never from mocks — enforced by `client.ts`.
- This checklist uses honest statuses: CODE_READY, RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED, CREDENTIAL_REQUIRED, LICENSE_REQUIRED, HISTORICAL_ONLY, BOUNDED_DISCOVERY, NOT_IMPLEMENTED, UNAVAILABLE. Never PRODUCTION_RUNTIME_VERIFIED for code-only.

---

## 11. Security

- No API keys, OAuth secrets, email API keys, private keys, tokens, VITE secrets, deployment credentials committed.
- `XSTARZ_EMAIL_API_KEY`, `TWELVE_DATA_API_KEY`, `COINGLASS_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `EIA_API_KEY`, `TICKATLAS_API_KEY`, `AUTH_GOOGLE_ID/SECRET`, `CONVEX_DEPLOY_KEY`, `XSTARZ_OWNER_PRINCIPALS` are server-only, presence-only checks, redacted via `redactSecrets`.
- Bundle scan: `dist/assets/*.js` contains no live provider secret values — only names for operator messages. Scan checks for patterns like Stripe live keys, Resend live keys, SendGrid keys, Google API keys, and raw `*_API_KEY` values.
- VITE_ exposure: only `VITE_CONVEX_URL` (public endpoint) is inlined, no secrets.
- Owner principals: server-only, fail-closed malformed config, valid session required, not forgeable client-side.
- Email OTP: OTP value never in logs, API key never exposed.

---

## Activation Steps (operator)

1. Create Convex project: `npx convex dev --once` → sets `CONVEX_DEPLOYMENT` prod shape
2. Set `CONVEX_SITE_URL` = `https://<deployment>.convex.site`
3. Set `VITE_CONVEX_URL` = `https://<deployment>.convex.cloud` and rebuild `dist/`
4. Set `XSTARZ_DEPLOYMENT_ENV=production`
5. Set email: `XSTARZ_EMAIL_TRANSPORT=resend`, `XSTARZ_EMAIL_API_KEY`, `XSTARZ_EMAIL_SENDER_ADDRESS` Xstarz-owned + DNS SPF/DKIM/DMARC
6. Set Google: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, authorized redirect `<site>/api/auth/callback/google`
7. Set providers: `TWELVE_DATA_API_KEY`, `COINGLASS_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `EIA_API_KEY`, `TICKATLAS_API_KEY` (optional per capability)
8. Deploy: `npx convex deploy`
9. Verify: `XSTARZ_DEPLOYMENT_ENV=production npm run convex:preflight` — 11 checks PASS
10. Run Evidence D harness for auth, run `node scripts/verify-live.mjs` for providers, verify UI shows live timestamps not fabricated.
11. Only after step 10 succeeds may status be upgraded to PRODUCTION_RUNTIME_VERIFIED for that capability.
