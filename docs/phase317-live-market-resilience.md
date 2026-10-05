# Phase 317 — Live Market Resilience + Final External-Blocker Elimination

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 316 tip `62433aa`.
Final tip: `7777c16`. No new providers added, no strategy-engine changes, no second engine.

## 1. The Twelve Data "404" — actual root cause (§2), and a phase-316 correction

Phase 316 recorded EUR/USD and XAU/USD as failing with `404 Unsupported symbol` and classified
it as an external provider-side change. **That classification was wrong.** Phase 317's trace of
the exact request chain shows:

| Run | Native id dispatched | Wire request | Provider response | Classification |
|---|---|---|---|---|
| 315 (2026-10-03) | `EUR/USD` (slash, catalog form) | `GET /time_series?symbol=EUR%2FUSD&interval=…` | `200` values[] | PASS 8/8 |
| 316 (2026-10-05) | `EUR-USD` / `XAU-USD` (dash — **operator dispatch error**) | `GET /time_series?symbol=EUR-USD…` | `404` `**symbol** or **figi** parameter is missing or invalid` | SYMBOL_UNSUPPORTED — a *correct* refusal of an invalid symbol FORMAT |
| 317 probe (37265659534) | `EUR/USD`, `XAU/USD` (slash) | same endpoint, same credential, same code path | `200` values[] | **PASS** — `XAU/USD D1 4131.16935`, `EUR/USD H4 1.11787` |

- Failure mode: symbol-format, not auth (AAPL passed on the same key), not quota, not endpoint
  availability. Twelve Data is healthy for FX/metals on this credential.
- The `docs/phase316-final-production-blocker-closure.md` row "NEW — Twelve Data FX-pair 404
  (external provider change)" is **corrected by this document**: the provider did not change; the
  exact-mode dispatch used dash-form ids where the catalog-declared native ids are slash-form.
- Runtime behaviour in 316 was nevertheless CORRECT: an invalid symbol was refused explicitly, no
  substitution, no fake PASS.

## 2. Provider capability audit (§1) — what can actually serve FX/gold OHLCV

| Provider | Registry claim | Actual runtime consumption (traced) | Usable as FX/gold failover? |
|---|---|---|---|
| twelve-data | ohlcv FULL forex/commodity/equity/crypto/indices | THE analysis OHLCV leg for all non-provider-native assets | primary (healthy) |
| alpha-vantage | ohlcv FULL forex+equity; `credentialsAvailable: true` | news/sentiment/fundamentals only — the universal client's FX endpoint existed but was NEVER consumed by the analysis path | **YES for 13 catalog-mapped FX majors** (now wired); equity intraday is premium — not wired |
| tickatlas | economic_calendar ONLY; `credentialsAvailable: false` | calendar legs only | NO — no OHLCV capability, no credential |
| FX-rate/frankfurter | not integrated | nothing consumes it | NO — daily fixings, no OHLC bars (would have to fabricate bars — forbidden) |
| CCXT family | crypto OHLCV (okx native + ccxt:<id>) | crypto analysis legs | NO — crypto exchanges have no EUR/USD or XAU/USD spot; a tokenized proxy would be symbol substitution (forbidden) |

## 3. What was built (§3, §6, §12, §13) — catalog-driven FX OHLCV failover

New pure module `src/lib/data/universal/fx-failover.ts` + wiring in `src/convex/marketData.ts`:

- **Trigger classes** (only provider-side primary failures): SYMBOL_UNSUPPORTED,
  API_UNAVAILABLE, NETWORK_ERROR, MALFORMED_RESPONSE, TIMEFRAME_UNAVAILABLE. Primary
  RATE_LIMIT/AUTH_ERROR surface verbatim (a credential state must not be masked, and the
  fallback's tiny budget must not be burned by a masked outage). NO_LIVE_DATA stays a definitive
  data state (§227).
- **Catalog scope**: an instrument fails over only if the Phase-44 catalog declares an
  alpha-vantage native id (13 FX majors, e.g. `EUR/USD → EURUSD`). XAU/USD has no declared AV
  mapping → never fails over → honest primary-fate. Nothing is guessed from string surgery.
- **Timeframe preserved exactly**: M1/M5/M15/M30/H1 → `FX_INTRADAY` 1min/5min/15min/30min/60min;
  D1 → `FX_DAILY`; W1 → `FX_WEEKLY`; **H4 refused deterministically** (AV has no FX 4-hour
  series) — no aggregation, no relabelling, no silent re-timing.
- **Routing policy (6G)**: sticky within one analysis run — the primary is decision-probed
  exactly once; after a failover engages, the fallback serves the rest of the run; a fresh run
  starts on the primary again. No cross-run memory, no arbitrary timing, no oscillation.
- **Acceptance contract**: AV series parsed strictly (timezone pinned UTC), per-candle validation
  identical to the ccxt leg, delivered-cadence check rejects a wrong-timeframe series outright
  (0.5×–2× median-spacing window absorbs FX session gaps).
- **Provenance (no-silent-failover, §13)**: the envelope names the provider that ACTUALLY served
  (`alpha-vantage` + catalog native id `EURUSD`), carries `primaryProviderFailure {provider,
  errorCode, reason, engagedTimeframe}`, and the price derives from the SAME fallback snapshot
  (the Twelve Data quote leg is skipped when the fallback serves). Chart, trade-plan, technical
  and strategy all consume that one snapshot (§12).
- **Fundamentals untouched (§5)**: calendar/Treasury/CFTC/EIA legs are independent of the OHLCV
  provider switch; no evidence can be promoted or double-counted by a failover.

Deterministic tests: `src/lib/data/universal/fx-failover.phase317.test.ts` — 21 tests covering
the phase's required semantics A–G plus mapping/parsing/cadence contracts.

**Live-proof honesty**: Twelve Data is currently healthy, so the failover path stays dormant and
is NOT claimed LIVE. Its evidence is deterministic (A–G) + the AV response shapes; the fallback
legs themselves remain unproven live until a real primary failure engages them.

## 4. Timeframe matrix — live (§4), exact-mode GitHub Actions runs, backend at the phase tip

**EUR/USD (twelve-data, price = provider's own)** — 8/8 PASS:

| TF | Run | Price | Chart window |
|---|---|---|---|
| M1 | 37266277801 | 1.11799 | 210c tf=M1 |
| M5 | 37266277801 | 1.11799 | 210c tf=M5 |
| M15 | 37266277801 | 1.11827 | 210c tf=M15 |
| M30 | 37266277801 | 1.11833 | 210c tf=M30 |
| H1 | 37266277801 | 1.1184 | 210c tf=H1 |
| H4 | 37266907933 | 1.11848 | 210c tf=H4 |
| D1 | 37267220906 (solo re-run; the batch attempt hit the documented per-minute quota, refused honestly) | 1.11849 | 210c tf=D1 |
| W1 | 37266907933 | 1.11852 | 210c tf=W1 |

**XAU/USD (twelve-data)** — 8/8 PASS, fundamental = CFTC + US Treasury intact on every TF:

| TF | Run | Price |
|---|---|---|
| M1 | 37267912822 | 4138.06492 |
| M5 | 37267567949 | 4139.68269 |
| M15 | 37267567949 | 4140.02218 |
| M30 | 37267912822 | 4138.06492 |
| H1 | 37268335965 | 4134.92393 |
| H4 | 37268335965 | 4134.1569 |
| D1 | 37268779118 | 4138.38779 |
| W1 | 37268779118 | 4137.38928 |

**BTC/USDT (okx)** — run 37269195683: `tf=M30/M30 · price=85778.3` (native M30, Phase-316 fix
holding), fundamental = DeFiLlama + okx (CoinGlass honestly absent — no credential).

**AAPL (twelve-data)** — run 37269195683: `tf=W1/W1 · price=333.69`; fundamentals
`unavailable (insufficient)` = the documented AV daily-quota cap, refused honestly.

Honest UNAVAILABLE states observed during matrix runs (all correct behaviour, none hidden):
- `429 … 10 API credits used, limit 8` per-minute quota on batched runs — refused explicitly, no
  retry, resolved by pacing/solo runs (the free per-minute limit, not a defect).
- AV news leg on XAU/USD: `Invalid ticker format: XAU/USD` — honest provider limitation of the
  news leg for metals symbols (pre-existing, unchanged).

## 5. CoinGlass (§8), Google OAuth (§9), security rotation (§10)

- **CoinGlass**: audit-only (reuse rule). No key exists → the derivatives leg refuses as
  EXTERNAL_DATA_GAP/CREDENTIAL_REQUIRED; crypto analysis is fully functional without it (every
  crypto smoke PASSes with OHLCV + SMC + DeFiLlama + okx evidence); the derivatives semantic
  family cap ±2 remains active (`evidence-groups.ts` cap: 2, guarded by the phase-313/314
  suites). No key fabricated.
- **Google OAuth**: auth-verify re-run at the phase tip →
  `state=GOOGLE_AUTH_NOT_CONFIGURED · missing=AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, SITE_URL,
  CONVEX_SITE_URL · invalid=none` — fail-closed, exact missing dependency, no simulation.
  Guest path and the no-OTP hardening remain wired (phase-311 closure unchanged).
- **Security rotation**: reachable history remains CLEAN (CI "Reachable-history secret scan"
  SUCCESS at both phase commits; fresh full-clone scanner exit 0 at phase 316, nothing re-added
  since — the phase moved forward only). The issuer offers no self-service revocation (phase-222
  finding): **ROTATION_EXTERNAL**. Tree clean; no secret in `dist/`; no current code reference.

## 6. Regression (§14)

- Full Vitest: **487 files / 15,256 passed | 0 failed | 13 skipped**
- `tsc -b`: 0 errors · `npm run build`: ✓ (the env-less build is the documented operator shell;
  the published artifact is built with VITE_CONVEX_URL and verified same-commit in CI)
- CI at the final tip: run 37270956776 SUCCESS — tests + typecheck + build + lint + **history
  secret scan** all green
- Two stale contract guards fixed (see commit `7777c16`): the phase-299 artifact check now knows
  both legitimate artifact kinds (operator shell vs full app), and the phase-257 fabrication
  guard judges code, not comments, and requires the no-silent-failover provenance field.

## 7. Remaining external blockers (unchanged in kind)

1. Secret rotation at the issuer — owner access required (ROTATION_EXTERNAL).
2. Google OAuth credentials — create + set 4 env vars (then a real authenticated acceptance can
   run).
3. CoinGlass credential — `COINGLASS_API_KEY` via `bunx convex env set`.
4. Twelve Data free-tier per-minute (8 credits) and Alpha Vantage per-day (25) caps — provider
   plan limits, handled by honest refusal + pacing, not by masking.
