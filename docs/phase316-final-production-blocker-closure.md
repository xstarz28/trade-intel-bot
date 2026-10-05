# Phase 316 — Final Production Blocker Closure

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 315 tip `0081961`.

Every blocker from the phase-315 handoff was re-verified against live state before acting.
"Fixed" below always means proven real runtime state, never "code no longer crashes".

## Blocker table

| BLOCKER | STATUS | ROOT CAUSE | ACTION TAKEN | LIVE VERIFIED? | REMAINING DEPENDENCY |
|---|---|---|---|---|---|
| A — secret in git history (`src/convex/auth/emailOtp.ts`) | **CLOSED** (history clean; rotation external) | A phase-222-era OTP-mailer API key stayed reachable through `heads/arena/01a0b293-trade-intel-bot`, which had re-grown the pre-rewrite lineage again (fingerprint-verified 261 carrier commits by 2026-10-05) despite its phase-249 artifact row recording 0 after the Sep-21 writable rewrite | The branch was proven unnecessary (superseded phase-248-era session, tip `c4fe1cf5`, no open PR, ancestor of no active branch) and REMOVED from the remote — the rewrite's outcome (blob unreachable from every advertised ref) achieved by removal, no force-push, no active history touched; all governance artifacts (runbook, refs inventory, remediation manifest, phase 221/233/244/245/248/249/255 suites) reconciled to the measured nine-ref set | **YES** — fresh full clone `verify-history-clean.mjs`: 573 commits, 0 occurrences, exit 0 PASS; CI "Reachable-history secret scan" SUCCESS on runs 37262162376 and 37262308794 (first green since the incident) | Rotation at the issuer has no self-service path (phase-222 finding) — external; `refs/pull/1/head` carries 269 GitHub-managed carriers outside repository control (recorded in runbook + manifest) |
| B — Google OAuth unconfigured | **UNCHANGED — EXTERNAL BLOCKER** | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL`, `CONVEX_SITE_URL` absent from the deployment env | Re-verified through the existing auth-verify relay (no credentials invented, no simulation): verifier answers fail-closed | **YES** — auth-verify run 37262175753: `GOOGLE_AUTH_NOT_CONFIGURED · missing=AUTH_GOOGLE_ID,AUTH_GOOGLE_SECRET,SITE_URL,CONVEX_SITE_URL · invalid=none` | Create Google OAuth credentials and set the four env vars in the connected Convex deployment (user-side, outside the sandbox) |
| C — CoinGlass credential | **UNCHANGED — EXTERNAL BLOCKER** (reuse-only audit) | `COINGLASS_API_KEY` absent from the deployment env | Audit only: existing CoinGlass leg refuses explicitly ("CoinGlass not configured: COINGLASS_API_KEY is missing"); derivatives family cap ±2 in `src/lib/strategy/evidence-groups.ts`; ETF/options stay explicit-unavailable; no key fabricated; live crypto smoke shows derivatives honestly absent from fundamentals | **YES** — crypto smoke run 37262459581: fundamental leg = DeFiLlama + okx only, no CoinGlass claim | Provide `COINGLASS_API_KEY` via `bunx convex env set` |
| D — Alpha Vantage free-tier caps | **NOT A BUG — DOCUMENTED** | AV free tier = 25 req/day; intraday stock candles deliberately never requested (no fake M1/M5, no silent switch, no daily-as-intraday) | Stock smoke: W1 + D1 full PASS via twelve-data; today's AV fundamentals report `unavailable (insufficient)` (daily quota consumed) — refused honestly, never fabricated | **YES** — stock run 37263259469 (`twelve-data · AAPL · tf=W1/W1 · price=333.69`) | Paid AV key for fundamentals beyond the daily cap |
| E — OKX M30 unsupported | **CLOSED — PROVIDER-NATIVE** | `OKX_BAR` in `src/lib/data/universal/live/twelve-data-protocol.ts` lacked the `30m` entry although OKX's own bar matrix serves "30m" natively — a natively-supported timeframe reported as unsupported | Added the verbatim mapping (M30→"30m", both directions) + protocol test lock; provider's own bars, never resampled or relabelled | **YES** — crypto run 37262459581: `okx · BTC-USDT · tf=M30/M30 · price=85979.8`, chart window 210c tf=M30, plan=none, unified=aligned_bullish/actionable=false | None |
| Stock intraday (M1–W1) | **ALREADY COVERED — twelve-data native** | Equity candles route to twelve-data (native M1..W1); Alpha Vantage is fundamentals/news only | Audit confirmed routing; live W1 + D1 verified (price 333.69, full 210c windows). Coverage beyond that is not the goal — zero silent substitution is | **YES** — stock run 37263259469 | None for OHLCV |
| F — deployment drift | **VERIFIED SAME-COMMIT** | n/a (chain check) | Publish flow re-run at the phase tip; artifact → Vercel → URL → runtime provenance verified in the same run (see RUN-316) | **YES** — publish run recorded in RUN-316 | None |
| NEW — Twelve Data FX-pair 404 (found this phase) | **EXTERNAL PROVIDER CHANGE** | On 2026-10-05 the provider returns `404 Unsupported symbol: **symbol** or **figi** parameter is missing or invalid` for forex-style pairs (EUR/USD H4/D1, XAU/USD H4/D1) on the same credential and through the same unchanged code path that passed 8/8 in phase 315 (2026-10-03); stock symbols still pass | No substitution performed (hard rule); runtime refuses explicitly (`price=none`, `unified=insufficient` / `fundamental_only`); classified PROVIDER_FAILURE/PLAN_RESTRICTED with live evidence | **YES** — forex run 37262853207 + commodity run 37263670619 (404) vs stock run 37263259469 (PASS, same endpoint/key) — isolates the failure to the provider's FX-pair service | Twelve Data restoring forex access on this credential (or a plan that includes it) |

## CI determinism fix (found this phase)

`parallel-fetch.phase15.test.ts` "identical provider responses collected concurrently vs
sequentially → byte-identical decision" failed on CI. Root cause: the benchmark fixtures stamp
`Date.now()` per construction (`treasury.fetchedAt`, `makeMarket().price.timestamp`), so the two
parity paths consumed DIFFERENT observations — any millisecond boundary between the two
constructions changed `fetchedAt` / the entry-context note ("market reference … observed …") and
failed the comparison by construction on slow runners. Fix: both paths now consume the same single
response objects (one shared treasury instance; inputB adopts inputA's marketData verbatim).
Reproduced 1-in-6 locally before the fix; 12/12 stable after; full suite green.

## Regression state (§13)

- Full Vitest: **486 files / 15,239 passed | 9 skipped | 0 failed**
- `tsc -b`: 0 errors
- `npm run build`: ✓ 7.33s
- Secret scans: history PASS (fresh full clone, 573 commits, exit 0) · tree: only governance
  markers (retired-issuer policy, historical comments, incident tests) — no credential value ·
  built artifacts (`dist/`): 0 marker files · config surface (`.env*`, `vercel.json`): clean
- Deployment suites: 1,520/1,520 green (incl. reconciled phase 221/233/244/245/248/249/255)
