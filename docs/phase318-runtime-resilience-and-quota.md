# Phase 318 — Runtime Resilience, Provider Quota Intelligence, Release Polish

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 317 tip `4c2c897`.
Code tip: `0933c72`. No second engine, no new providers, no invented credentials, no weakened gates.

## 1. Blocker re-audit (§1) — re-checked against live state, prior classifications corrected where wrong

| Class | Item | Re-check result |
|---|---|---|
| A. ROTATION_EXTERNAL | OTP-mailer issuer key (phase-316 incident) | Unchanged. Reachable history CLEAN (CI scan green at every phase commit); no self-service revocation at the issuer — still external |
| B. GOOGLE_AUTH_EXTERNAL | 4 env vars absent | Re-verified live at the phase tip: `GOOGLE_AUTH_NOT_CONFIGURED · missing=AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, SITE_URL, CONVEX_SITE_URL · invalid=none` — still external |
| C. COINGLASS_EXTERNAL | `COINGLASS_API_KEY` absent | Unchanged; crypto fully analyzable without it (live proof below) |
| D. PROVIDER_QUOTA | TD 8 credits/minute; AV 25/day | Live-observed both (317 runs). Semantics: explicit refusal, zero retry storm, honest UNAVAILABLE — now documented as the quota matrix below |
| E. PROVIDER_CAPABILITY | AV FX has no H4; TickAtlas calendar-only + no credential; CCXT crypto-only; FX-rate daily fixings only | Confirmed by registry trace — none may serve XAU/USD or FX H4 bars; the failover scope stays catalog-exact |
| F. PRODUCT BUG | **TIMEOUT was collapsed into NETWORK_ERROR** | FIXED this phase — a provider deadline is now its own class (§5) |
| F. PRODUCT BUG | Failover provenance stopped at the envelope — the UI's limitations never named the switch | FIXED this phase — the flag flows into `signal.limitations` (§12) |
| G. NO LONGER A GAP | "Twelve Data FX 404" (316); OKX M30 unsupported (pre-316) | 316's finding was operator spec error (corrected in 317 docs); M30 native since 316 — both live-proven again this phase |

## 2. Provider failure taxonomy (§5) — normalized, never collapsed

`RATE_LIMIT` · `AUTH_ERROR` · `TIMEOUT` (new) · `PROVIDER_ERROR` · `INVALID_SYMBOL` (SYMBOL_UNSUPPORTED) ·
`UNSUPPORTED_TIMEFRAME` (TIMEFRAME_UNAVAILABLE) · `MALFORMED_RESPONSE` · `NO_LIVE_DATA` (answered-empty,
a data state) · `NETWORK_ERROR` (transport) · freshness labels `delayed|stale|unavailable` (a stale series is
never re-labeled) · `CREDENTIAL_REQUIRED` / `EXTERNAL_DATA_GAP` (leg layer). Routing reads these classes:
UNSUPPORTED_TIMEFRAME on the fallback is a permanent refusal (no aggregation), TIMEOUT/NETWORK are
provider-side transients (failover legal), RATE_LIMIT/AUTH_ERROR are primary credential states (failover
forbidden — surfaced verbatim).

## 3. Rate-limit / fallback matrix (§2/§3) — the explicit policy

| Provider | Instrument class | Failure | Fallback | Allowed? | Reason |
|---|---|---|---|---|---|
| Twelve Data | FX majors (13 catalog-mapped) | 404 invalid symbol / provider outage / network / timeout / malformed | alpha-vantage (catalog native id, e.g. EURUSD) | **YES** | provider-side failure; catalog declares the fallback; identity+TF+cadence verified |
| Twelve Data | FX majors | **429 per-minute quota** | — | **NO — verbatim refusal** | quota isolation: burning the fallback's 25/day budget to mask a ≤60s blip creates fake availability; the state is explicit and self-heals next minute |
| Twelve Data | FX majors | 401/403 | — | **NO — verbatim refusal** | a primary credential state must never be masked by another provider's credential |
| Twelve Data | FX majors | answered-empty series | — | NO (data state, §227) | an empty but answered series is not an outage |
| Twelve Data | XAU/USD (metals) | any provider-side failure | — | **NO — none exists** | no catalog-declared native metals OHLCV provider anywhere in the registry; a tokenized/exchange proxy would be symbol substitution |
| Alpha Vantage | stocks (OHLCV not wired) | 25/day quota | twelve-data (the actual stock OHLCV path) | n/a — AV is fundamentals/news only | the stock market-data path is twelve-data and stays usable (live: AAPL D1 333.69) |
| Alpha Vantage | FX failover leg | QUOTA/PLAN notes | — | NO | the primary failure resurfaces annotated with the fallback's own class |
| OKX | crypto | outage/429 | other ccxt exchanges | NO (not wired for a single-instrument failover) | identity-first: an instrument's exact exchange is not substitutable |
| CoinGlass | crypto derivatives | credential absent | — | n/a — optional enrichment | CREDENTIAL_REQUIRED; crypto remains fully analyzable (OHLCV+SMC+MTF+DeFiLlama+okx) |
| DeFiLlama / Treasury / CFTC / EIA | fundamentals | outage/quota | — | NO | evidence-layer unavailability is explicit; no replacement, no inference |

No retry storms anywhere: the runtime issues NO automatic retries on 429 (Phase-303 standing rule),
the failover attempts the fallback at most once per engagement, and the sticky policy (§6) prevents
per-leg re-probing.

## 4. Sticky routing (§6) — deterministic, no oscillation

Per analysis run: the primary is decision-probed exactly once; a trigger-class failure engages the
fallback for the REST of the run (even if the primary would answer again mid-run — one decision, no
flip-flop); a fresh run starts on the primary again. Proven by tests including the explicit
"primary recovers mid-run → fallback keeps serving" case. The same fallback snapshot feeds technical,
SMC, MTF, chart, trade-plan and the published price (one `candles` array, one `price` snapshot).

## 5. Freshness budget (§7)

Both providers are graded by the SAME rule (`providerSeriesFreshness`: the provider's own newest bar
+ the series' own median cadence; stale/unavailable labels only — it can never claim a live-sounding
label). A fallback series cannot escape freshness rules: stale-in → labeled stale → the engine's
freshness gate decides actionability. A fresh primary is never re-probed mid-run (no quota-wasting
races).

## 6. Request planning audit (§8)

Per analysis: setup 210 + MTF slots + optional comparator + one quote — all keyed by
(provider, dataset, instrument, timeframe, bar-count) in the single-flight authoritative cache
(Phase 178b): concurrent identical reads collapse to ONE acquisition (test-proven), distinct shapes
stay distinct. The primary-leg failure aborts the analysis before MTF/comparator spend. No duplicate
fundamentals fetch (separate cached actions). No chart re-acquisition (the chart renders the analysis
snapshot, provenance-hashed). No cross-freshness-window cache reuse.

## 7. Degraded-state truth (§4/§12/§13)

- The failover switch is now VISIBLE end-to-end: `MarketData.primaryProviderFailure` → data flag
  (`Market data served by "alpha-vantage" after the primary provider "twelve-data" failed
  (SYMBOL_UNSUPPORTED) — primary failure preserved, provider identity exact`) → `signal.limitations`
  → the existing `signal-limitations` UI section (render path proven by the phase-312 suite).
- Degraded-but-usable is preserved: macro calendar absent → analysis remains (`technical_only`),
  CoinGlass absent → crypto remains analyzable, stock fundamentals absent → analysis remains — each
  with its explicit flag; none of these is "analysis unavailable" (test-covered; live-proven by the
  317/318 runs where `technical_only` verdicts carried full live technicals).
- Evidence semantics untouched: no arbitrary confidence subtraction, no replacement data, no
  historical-as-live, no double-counting, no promotion of unavailable fundamentals.

## 8. Crypto optional enrichment (§9)

CoinGlass stays optional (CREDENTIAL_REQUIRED when absent). Live proof this phase: BTC/USDT M30
86249.9 PASS with fundamentals = DeFiLlama + okx only. No old derivatives data reused, no liquidation
inferred from price, no funding inferred from trend; derivatives family cap ±2 active
(`evidence-groups.ts`, guarded by the 313/314 suites).

## 9. Auth (§10) & security (§11)

- Auth verifier re-run at the phase tip: `GOOGLE_AUTH_NOT_CONFIGURED · missing=AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET, SITE_URL, CONVEX_SITE_URL · invalid=none` — exact external blocker; Google
  provider wired, guest path + no-OTP hardening unchanged; no simulated PASS.
- History scan GREEN at the phase commit (CI 37273014938); no credential in tree, dist, or frontend;
  rotation stays **ROTATION_EXTERNAL** (no self-service at the issuer). Nothing rewritten.

## 10. Live acceptance (§15/§16) — slash-form native IDs, exact-mode, backend at the phase tip

| Run | Result |
|---|---|
| 37273656448 | `twelve-data · EUR/USD · tf=M30/M30 · price=1.11772` PASS · `tf=D1/D1 · price=1.11772` PASS (210c windows verbatim) |
| 37274144234 | `twelve-data · XAU/USD · tf=H4/H4 · price=4150.92434` PASS · `tf=W1/W1 · price=4152.04619` PASS — CFTC + US Treasury fundamentals intact |
| 37274713894 | `okx · BTC-USDT · tf=M30/M30 · price=86249.9` PASS (native M30, DeFiLlama+okx) · `twelve-data · AAPL · tf=D1/D1 · price=333.69` PASS |
| auth-verify @ tip | GOOGLE_AUTH_NOT_CONFIGURED (exact, fail-closed) |
| CI 37273014938 | SUCCESS — tests + typecheck + build + lint + history scan |

Full 8-TF matrices for EUR/USD and XAU/USD were live-proven in phase 317 (runs 37266277801,
37266907933, 37267220906, 37267567949, 37267912822, 37268335965, 37268779118 — 8/8 each) and the
provider/state has not changed since; this phase re-proved representative TFs per class. Real quota
behaviour was live-observed (317: honest 429 refusals at 9–10/8 credits — no retry, no fake PASS).

## 11. Regression (§19)

Full Vitest: **488 files / 15,277 passed | 0 failed | 13 skipped** · `tsc -b` 0 errors · build ✓ ·
CI SUCCESS at the code tip. No test weakened; two suites strengthened (317 trigger list + TIMEOUT).

## 12. Remaining external dependencies (exact)

1. Issuer-side secret rotation — owner access (ROTATION_EXTERNAL).
2. Google OAuth credentials + the four env vars (then real authenticated acceptance).
3. `COINGLASS_API_KEY` via `bunx convex env set`.
4. Provider plan limits: TD 8 credits/min, AV 25/day — handled by explicit refusal + pacing.
