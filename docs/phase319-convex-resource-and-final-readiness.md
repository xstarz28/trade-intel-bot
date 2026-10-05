# Phase 319 — Convex Resource & Final Production-Readiness Closure

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 318 tip `ce7d5e4`.
Code tip: `53c26aa`. No credentials invented, no plan upgrade, no semantics weakened, no stale-as-live.

## 1. The Convex resource issue (§1) — root cause and observability

**Telemetry: UNOBSERVABLE from the agent environment.** `*.convex.dev` (control plane AND
`dashboard.convex.dev` usage pages) is unreachable from the sandbox — the standing TLS-interception
egress block documented since Phase 199/200 (`scripts/verify-convex-access.mjs` exists precisely to
diagnose it, and there is no deployment admin credential in the sandbox by rule). The exact exceeded
metric therefore cannot be read from here; per the mission this limitation is documented and the
audit targeted **code-side waste**, which is real and measurable from the repository itself.

**Code-side findings (high-frequency paths traced):**

| Path | Finding | Disposition |
|---|---|---|
| Dashboard mount → discovery | EVERY mount walked EVERY provider catalog (Twelve Data full catalog walk ≈ the run's biggest TD-credit + action-compute + staging-write item, plus okx/ccxt/dex/geckoterminal/idx/coinglass/AV-index discovery) + one 20-instrument live acquisition batch — and the SPA remounts Dashboard on EVERY route change, re-issuing the whole walk for an identical universe | **FIXED** — session-scoped single-flight + 10-min request-planning window (force preserved); request planning, not a data cache: the walk itself still reads live providers |
| Acceptance smoke runs | The harness unconditionally walked every generic domain's catalog EVEN WHEN the run's evidence was exactly the EXACT specs — every one of the 13+ acceptance runs in phases 317/318 paid catalog credits + action compute + staging writes + discovery-ranked analyses that produced ZERO annotations | **FIXED** — `--domains none|exact` resource mode; pinned by a 6-test artifact suite; all acceptance runs from this phase on are exact-only (measured below: the run wall-time dropped from minutes to <60s) |
| Analysis path | Setup 210 + MTF + comparator + quote all single-flight cached (Phase 178b, key = provider+dataset+instrument+TF+bar-count); primary failure aborts before MTF/comparator spend | already correct (verified) |
| Fundamentals | One cached action per dataset (news/fundamentals with per-dataset TTLs, single-flight, observedAt preservation) | already correct (verified) |
| Auth/session | 2 reactive queries total on Dashboard (entitlement, history-list bounded `.take(20)`); no polling (`setInterval` absent); no repeated auth queries | already correct (verified) |
| CoinGlass (§6) | ONE cached derivatives leg, CREDENTIAL_REQUIRED refusal when the key is absent, no duplicate calls, no polling, no frontend exposure, family cap ±2 active (`evidence-groups.ts`), no key echoed anywhere | already correct (verified) |
| Convex query/mutation design (§4) | Staging writes already chunked (Phase 289G), stages superseded/pruned, catalog reads chunked with bounded cursors (Phase 289J), history list bounded | already correct (verified) |
| Smoke/CI orchestration (§3) | Relay is globally serialized (cancel-in-progress false); cancelled runs do not continue backend work; deploys are per-tip, not per-commit | already correct (verified) |

**A second root-cause candidate was found and closed:** between phases, the sandbox `.git` rewind
erased the untracked `dist/` while eight older suites assert a build exists — they failed en masse
once (process order, not product), resolved by running the build before the full suite (the standing
validation order). No test was weakened.

## 2. Ten-ref governance reconciliation (forced by a NEW remote fact)

The operator pushed `heads/hotfix/convex-resource-efficiency` **pointing at the accepted arena tip
`ce7d5e4`** (the Phase-318 final commit) — a clean alias carrying no new commits. The governance
suites correctly refused an unmeasured ref (`LIVE_REF_NOT_MEASURED`). It was measured like every
ref: **0 carrier commits, tip clean**, and the fresh-full-clone fingerprint scanner returned
**exit 0 (PASS)** over the full ten-ref remote including `refs/pull/*`. The ref was added to
`docs/secret-remediation-refs.json`, the runbook (both tables + a Phase-319 section), the manifest
expectations, and every governance suite (9 → 10 pins). Scope growth, not exposure growth. Rotation
stays **ROTATION_EXTERNAL**; `refs/pull/1/head` stays GitHub-managed; A2 stays UNVERIFIED.

## 3. Credential states (§5) — live-verified, none invented

| Credential | State | Evidence |
|---|---|---|
| `COINGLASS_API_KEY` | **NOT_CONFIGURED** | derivatives leg refuses `CoinGlass not configured: COINGLASS_API_KEY is missing`; crypto analysis fully functional without it |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `SITE_URL` / `CONVEX_SITE_URL` | **NOT_CONFIGURED** | auth-verify at the phase tip: `GOOGLE_AUTH_NOT_CONFIGURED · missing=… · invalid=none · callback=none` (fail-closed, exact) |
| Twelve Data / Alpha Vantage keys | **AVAILABLE (consumed server-side only)** | live runs prove both; no key ever reaches the client; no value printed anywhere |

## 4. Provider quota efficiency (§8) — confirmed standing rules

429 → verbatim refusal, zero automatic retry; timeout → bounded (per-request deadlines; now its own
TIMEOUT class); auth → never masked (failover forbidden); unsupported timeframe → refused, never
retried uselessly; fallback → at most one attempt per engagement (sticky per run); single-flight →
duplicate concurrent acquisitions collapse to one (test-proven); rate-limit fallback matrix as
codified in `docs/phase318-runtime-resilience-and-quota.md` §3. The new smoke resource mode and the
discovery-cycle window directly reduce provider-quota burn (fewer catalog credits per acceptance run
and per user session).

## 5. Live acceptance (§11) — exact-only resource mode, backend at the phase tip

| Run | Evidence |
|---|---|
| 37281354509 | **First exact-only run**: annotation `EXACT-ONLY RUN (Phase 319 resource mode) — the Twelve Data catalog walk, OKX discovery and domain analyses are skipped` · `twelve-data · XAU/USD · tf=D1/D1 · price=4163.61787` PASS (CFTC + US Treasury) · `twelve-data · EUR/USD · tf=H4/H4 · price=1.11986` — market + technical + unified real, macro honestly unavailable (`technical_only`) |
| 37281520782 | `okx · BTC-USDT · tf=M30/M30 · price=86408.9` PASS (DeFiLlama + okx; CoinGlass honestly absent) · `twelve-data · AAPL · tf=W1/W1 · price=333.69` PASS |
| deploy 37281179377 | backend redeployed at the phase tip before the smokes — SUCCESS |
| auth-verify @ tip | GOOGLE_AUTH_NOT_CONFIGURED (exact external dependency) |
| CI 37281158904 | SUCCESS — tests + typecheck + build + lint + **history secret scan** |
| publish 37281639351 | SUCCESS first try — artifact `53c26aa…` same-run verified, provenance `a1544441…` |

**Fallback live-status (honest):** the FX failover stays dormant while Twelve Data is healthy — a
live trigger would require deliberately breaking or lying to the primary (forbidden). Its evidence
remains the deterministic phase-317/318 suites (semantics A–G + identity verification + cadence
rejection); it is never claimed LIVE.

## 6. Regression (§13)

Full Vitest: **489 files / 15,283 passed | 0 failed | 13 skipped** · `tsc -b` 0 errors ·
`npm run build` ✓ · deployment suites 1,526/1,526 · CI green at the phase tip.

## 7. Remaining external blockers (exact)

1. **Convex plan limits** — the usage dashboard/telemetry is owner-side; if the exceeded metric
   keeps binding after these reductions, the choices are owner-side (usage review at
   dashboard.convex.dev, or a plan decision). The code-side waste this phase removed is the
   repository's full share.
2. Issuer-side secret rotation — owner access (ROTATION_EXTERNAL).
3. Google OAuth credentials + the four env vars.
4. `COINGLASS_API_KEY` via `bunx convex env set`.
5. Provider plan caps (TD 8 credits/min, AV 25/day) — refused honestly, never masked.
