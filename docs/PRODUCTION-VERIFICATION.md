# Production Verification — Xstarz Analysis

This document records what has been **verified**, what is **unverified**, and
what **cannot be verified** by automated agent runs. It is deliberately
conservative: anything not actually executed and observed is not marked PASS.

Last updated: Phase 177 (2026-09-11).

---

## 1. Verification status summary

| Area | Status | Evidence |
| --- | --- | --- |
| Unit + integration test suite | **PASS** | 8,173 tests / 221 files, 0 failures (Phase 177) |
| Component (jsdom) render suites | **PASS** | Collected for the first time in Phase 166 — see below |
| TypeScript compile | **PASS** | `tsc -b` exit 0, fully clean |
| Production build | **PASS** | `npm run build` (`tsc -b && vite build`) exit 0 |
| Lint | **PASS (no new)** | Error count unchanged from baseline on every touched file |
| Live provider calls | **NOT VERIFIED** | Outbound market-data hosts are blocked in the agent sandbox |
| Credentialed providers | **NOT VERIFIED** | No API keys present in this environment |
| Convex deployment runtime | **NOT VERIFIED** | No deployment URL configured here |
| Browser / manual E2E | **CANNOT BE DONE BY AGENT** | Requires a human clicking through the UI — matrix in [`UAT-MATRIX.md`](./UAT-MATRIX.md) |
| Manual UAT execution | **NOT VERIFIED** | Matrix authored in Phase 173; **zero rows executed** so far |
| Entitlement enforcement boundary | **PASS (static + unit + bundle)** | Engine moved server-side; 148 entitlement tests; client bundle no longer contains decision logic |
| Entitlement runtime on a deployment | **BLOCKED BY ENVIRONMENT** | Convex control plane unreachable from the sandbox — see Phase 175 |
| Convex codegen (authoritative) | **BLOCKED BY ENVIRONMENT** | `npx convex dev/codegen` needs the control plane; TLS blocked |
| Evidence provenance (client tampering) | **PASS (code-level + mocked)** | ALL provider evidence stripped; server re-acquires — see Phase 176 |
| Secondary providers behind server provenance | **PASS (mocked only)** | 9 provider actions wired server-side; live endpoints unverified |
| Provider fan-out bounded (timeouts/deadline) | **PASS (code-level + mocked)** | Per-leg budgets + overall deadline + real AbortSignal — see Phase 177 |
| Provider latency against LIVE endpoints | **BLOCKED BY ENVIRONMENT** | All provider hosts firewalled; real latency unmeasured (UAT 9.21) |
| Light/dark theme follows system | **NOT IMPLEMENTED** | Dark is hardcoded — see Phase 173 findings |
| Convex authorization boundary | **PASS (static + unit)** | All 65 exported fns audited; 8 credentialed actions now guarded |

> **Nothing in the "NOT VERIFIED" rows should be reported as working.**
> They are not known-broken either — they are simply untested here.

---

## 2. What the sandbox can and cannot reach

Measured directly:

```
https://api.github.com            -> HTTP 200   (reachable)
https://www.okx.com/api/v5/...    -> no response (blocked)
https://api.coingecko.com/...     -> no response (blocked)
```

So provider behaviour is proven only against **recorded contracts and
injected transports** in the test suite, never against the live venue from
inside the agent environment. The test suite is deterministic by design and
makes no network calls.

---

## 3. Running the live verification harness

`scripts/verify-live.mjs` performs real network calls and reports honestly.
Run it from a machine with normal internet access:

```bash
node scripts/verify-live.mjs

# with credentials, to include the credentialed providers
TWELVE_DATA_API_KEY=xxx VITE_CONVEX_URL=https://xxx.convex.cloud \
  node scripts/verify-live.mjs
```

Exit code `0` means every **required** check passed; `1` means at least one
required check failed, so it is safe to use as a deploy gate.

### What it actually proves

The harness is written to avoid the classic false positive of "endpoint
returned 200, therefore live data works":

1. **`okx / discovery`** — the instrument catalog is non-empty and contains
   instruments genuinely in `live` state.
2. **`okx / acquisition matches discovered id`** — takes an instrument that
   *discovery actually returned*, requests candles for that exact
   `instId`, and asserts the newest candle is recent. This is the
   discovery → acquisition contract, and it fails if the venue serves only
   historical data.
3. **`okx / rejects a non-existent instrument`** — requests a fake id and
   asserts the provider returns nothing. If a provider ever returns data
   for an instrument that does not exist, silent substitution becomes
   possible, so this is checked explicitly.
4. **Twelve Data catalogs** — one check per asset class (forex, equity,
   commodity, indices, crypto), each asserting a non-empty catalog.
5. **Convex** — deployment responds.

Checks are marked `SKIP` when their credential is absent. **A skip is not a
pass** and the summary says so explicitly.

---

## 4. Manual browser E2E — see the UAT matrix

This portion **must** be done by a human; the agent cannot drive a browser.
Nothing here may be reported as PASS on the strength of automated tests alone.

The former short checklist has been replaced by a full executable matrix:

> **[`docs/UAT-MATRIX.md`](./UAT-MATRIX.md)** — 13 sections, ~90 numbered tests.

Each row carries a prerequisite, an exact browser action, an expected result,
an explicit failure condition, and a PASS / FAIL / BLOCKED field. Rows are
tagged `AUTO` (asserted by the automated suite, still to be confirmed in a
browser), `HUMAN` (needs a person), or `EXT-BLOCKED` (needs a live provider or
a deployed Convex backend, neither of which exists in the agent sandbox).

Prerequisites are listed in section 0 of that document. In the agent sandbox
P1–P4 are **not satisfied** (no `VITE_CONVEX_URL`, OKX/CoinGecko firewalled),
so every provider- and backend-dependent row is `EXT-BLOCKED` here.

**Current execution status: 0 of ~90 rows executed.** Until a human runs it,
browser behaviour is NOT VERIFIED.

### Phase 173 — defects found while grounding the matrix

Writing each step against real observable behaviour surfaced four defects.
Three were fixed with regression tests; one is documented and deferred because
it is a design decision rather than a bug.

| # | Finding | Status |
| --- | --- | --- |
| F1 | The refresh control was gated on `liveSources.length > 0`, so the empty state left by a failed first discovery cycle had **no retry affordance**. With no polling interval and no other caller of the discovery cycle, the only escape was a manual page reload — and the screen read as "no opportunities" rather than "retry available". | **Fixed** — handler always passed (6 regression tests). |
| F2 | `<html lang>` never followed the active locale: `index.html` hardcodes `lang="en"`, so all 9 locales were announced to screen readers and indexed as English. WCAG 3.1.1 (Language of Page). | **Fixed** — the i18n provider syncs `documentElement.lang` (11 regression tests). |
| F3 | **Light mode does not exist.** `index.html` hardcodes `class="dark"`, the `.dark` CSS block is empty, and `:root` carries the dark palette, so "light/dark follows system" is unimplemented. | **OPEN — NOT IMPLEMENTED.** Requires authoring and reviewing a second full palette; tracked as a product decision. |
| F4 | The 404 page used `text-gray-900` / `text-gray-600` against the dark background (`oklch(0.1)`) — near-black on near-black, effectively invisible. | **Fixed** — now uses `text-foreground` / `text-muted-foreground`. |

### Phase 177 — provider fan-out resilience

#### The defect

Phase 176 put nine provider acquisitions in front of the decision engine.
An audit of the transport layer found that **none of the eight provider modules
set a fetch deadline**. Convex actions may run up to 30 minutes on the Convex
runtime, so a single hung provider socket could stall a user's analysis
effectively indefinitely, with no bound and no diagnostic.

#### Timeout architecture (two independent layers)

| Layer | Mechanism | Purpose |
| --- | --- | --- |
| **Transport** | `AbortSignal.timeout(...)` on every provider `fetch` | Genuinely cancels the socket. The work does not outlive the wait. |
| **Leg** | `runProviderLeg()` per-provider budget | Bounds how long *this analysis* waits, and classifies the failure. |
| **Wave** | `runFanOut()` overall deadline | Backstop if several legs misbehave at once. |

The transport deadline is deliberately set **below** its leg budget so the
socket dies before the leg gives up — otherwise aborting would be cosmetic.
This is asserted by test, not assumed.

#### Latency budgets and their rationale

Budgets are derived from the observed shape of each provider action, not chosen
to make tests convenient:

| Provider | Leg budget | HTTP deadline | Why |
| --- | --- | --- | --- |
| `market-data` | 12s | 6s / 5s | Slowest by construction: a multi-timeframe `allSettled` batch **plus** a bounded sequential DXY probe and a comparison fetch. Also the only leg whose absence forces `NO_TRADE`. |
| `treasury` | 10s | 8s | Four `fetchFeed` legs in one `Promise.all` against a slow government host. |
| `eia` | 10s | 8s | Three product legs in one `Promise.all`, government host. |
| `alpha-vantage` | 8s | 7s | Documented ~5 req/min budget; a request can queue before responding. |
| `tickatlas` | 8s | 7s | Calendar assembly across the relevant currencies. |
| `coinglass` | 8s | 7s | Parallel derivative datasets. |
| `cftc` | 8s | 7s | Single Socrata query, historically slow to first byte. |
| `okx-order-book` | 6s | 5s | Single low-latency exchange endpoint. |
| `okx-instrument-spec` | 6s | 5s | Single low-latency exchange endpoint. |
| `fx-rate` | 6s | 5s | One quote lookup. |
| **Overall wave** | **15s** | — | Slowest leg (12s) + ~3s headroom for dispatch across ten `ctx.runAction` boundaries. |

The overall deadline is a **backstop, not the primary mechanism**: per-leg
budgets should always fire first. The sum of all budgets is ~82s; the wave is
bounded at 15s **because it is parallel**, and that gap is exactly the property
under test.

#### Failure taxonomy

Every leg yields an outcome recording provider, start, duration, budget,
attempts, and one of: `timeout`, `network`, `rate-limit`, `invalid-response`,
`unavailable`, `deadline-exceeded`, `skipped`.

`skipped` (conditional policy declined to run the leg) is **structurally
distinct** from `failed`, and a provider that returns an empty-but-valid
dataset stays a **success** — so "nothing happened" is never confused with
"we never heard back".

#### Rate limiting

Providers already classify their own rate-limit responses (Alpha Vantage
`Note`/`Information`, CoinGlass code 429, TickAtlas HTTP 429, Twelve Data
`[429]`). Phase 177 maps those into the `rate-limit` category and **never
retries a rate-limited provider within one analysis**, even when retries are
otherwise permitted. Retries default to **zero**; the fan-out providers contain
no retry loops, so there is no infinite-retry path. A rate limit contributes no
data and is never directional.

#### Evidence semantics under failure

A failed leg carries **no `data` property at all** — not an empty object, not a
zero, not `available: true`. Asserted directly: the serialized outcome of a
timeout contains no `"available":true`, `"quality":"VERIFIED"` or
`"fresh":true`. A timeout also cannot alter another provider's freshness or
provenance, and no outcome is ever attributed to a different provider.

#### Observability

Each leg records provider, start time, duration, budget, status, category,
rate-limit flag, attempt count, and **whether the engine actually consumed it**
(`usedByEngine`) — so "acquired" and "used" stay distinguishable. Diagnostics
pass through `redactDiagnostic()`, which strips `apikey`/`token`/`secret` query
parameters and long opaque tokens before anything is logged.

#### What is proven, and what is not

**Code-level / mocked verified** — 50 resilience tests + 22 integration tests,
using REAL timers and REAL elapsed wall-clock time for the bounding assertions
(a fake-timer test can prove logic but cannot prove boundedness). Includes:
three hung providers do not triple the wait; four hung legs stay under one
slowest-budget; completed results survive the overall deadline.

**NOT verified** — real provider latency. Every provider host is firewalled in
this environment, so the budgets are *derived and bounded*, not *measured
against live endpoints*. First deployment should compare observed durations
against the table above and re-tune. UAT 9.21 covers this.

---

### Phase 176 — complete evidence provenance + secondary provider acquisition

#### Verification categories used below

| Category | Meaning |
| --- | --- |
| **Code-level verified** | Proven by executing real code paths in this repo |
| **Mocked provider verified** | Provider contract modelled with injected thunks; live endpoint NOT contacted |
| **Deployed runtime verified** | Executed against a real Convex deployment — **none of this phase is** |
| **Blocked by environment** | Cannot be attempted here at all |

#### A. The loophole Phase 175 left open

Phase 175 classified `newsContext` and `economicEvents` as "user intent" on the
reasoning that they are the user's own narrative. **That was wrong**, and the
Phase 175 documentation asserted it without testing it.

`analysis-engine.ts` keyword-scores both strings as *directional fallback
evidence* whenever provider intelligence/calendar data is absent — across the
trend score (line ~318), the fundamental score (~459), the sentiment score
(~599), evidence naming (~179), data-completeness flags (~625/~629) and the
SWING fundamental-context gate (~1015).

Measured against the repo's proven LONG fixture with **server-acquired** market
data, varying only the client string:

| Client string | Decision |
| --- | --- |
| `"Fed signals hawkish stance, rate hike"` | `LONG`, conf 45 |
| `"dovish, rate cut, easing"` | **`NO_TRADE`** |
| `"weak gdp, recession"` | **`NO_TRADE`** |
| `"fear panic capitulation"` | `LONG`, conf **57** |
| `"greed euphoria fomo"` | `LONG`, conf **37** |
| both weaponised | **`NO_TRADE`**, bias **Neutral**, conf **31** |

A 26-point confidence swing, a bias flip and outright trade cancellation from
unverifiable client text. `instrumentSpec` was equally mis-classified:
`resolveInstrumentSpec()` lets an explicit spec override verified OKX metadata
field-by-field, and a forged `contractSize: 1 / quantityStep: 1e-8` changed
computed position quantity from **0 to 20** on an identical trade plan.

#### B. Field classification (authoritative)

| Category | Fields | Trusted from client? |
| --- | --- | --- |
| **1. User intent** | `instrument`, `instrumentType`, `timeframe`, `tradingStyle`, `requestedTimeframe`, `styleNotes` | **Yes** |
| **1b. User-owned risk parameters** | `accountEquity`, `riskPercent`, `accountCurrency` | **Yes** — scale sizing arithmetic; cannot create a market fact |
| **2. Provider-backed evidence** | `marketData`, `technicalData`, `sentimentData`, `fundamentalData`, `macroData`, `derivativesData`, `calendarData`, `treasuryData`, `cotData`, `eiaData`, `executionData`, `cryptoIntelligenceContext`, `universalIntelligenceContext`, `fxRates`, **`newsContext`**, **`economicEvents`** | **No** |
| **3. Derived/manual overrides** | `currentPrice`, `recentHigh`, `recentLow`, `fundingRate`, `openInterest` | **No** |
| **4. Provider/broker specification** | `okxSpecData`, **`instrumentSpec`** | **No** |

`requestedTimeframe` and `styleNotes` are display-only provenance (they feed
`styleInfo` for the UI's "TF fallback" label) and are safe as intent.
A contract test asserts **every** optional field on `AnalysisInput` appears in
exactly one list, so an unclassified future field fails the build.

#### C. Secondary providers now behind server provenance

All nine are invoked through their **existing** Convex actions — no business
logic, symbol mapping or key handling was duplicated:

| Provider | Action | Condition |
| --- | --- | --- |
| Alpha Vantage | `api.alphaVantage.fetchIntelligence` | always |
| Trading Economics / TickAtlas | `api.tradingEconomics.fetchCalendar` | always |
| CoinGlass | `api.coinglass.fetchDerivatives` | crypto |
| CFTC COT | `api.cot.fetchCotPositioning` | forex/commodity, non-scalping |
| US Treasury | `api.treasury.fetchTreasuryYields` | forex/commodity, non-scalping |
| EIA | `api.eia.fetchEiaInventory` | oil commodities, non-scalping |
| OKX order book | `api.okx.fetchOkxOrderBook` | crypto, non-swing |
| OKX instrument spec | `api.okx.fetchOkxInstrumentSpec` | crypto |
| Twelve Data FX | `api.marketData.fetchFxRate` | account ccy ≠ quote ccy |

The conditional policy reuses the Phase 15 pure module
`fetchOptionalSlowData`, so per-asset/per-style rules, at-most-once invocation
and non-fatal semantics are provably identical to the client path they replace.

Invariants held: provider failure → field simply absent (never a default, never
directional); provider-native ids forwarded byte-for-byte (`BTC-USDT-SWAP`
unchanged); no whitelist or instrument ceiling; FX quote currency now derived
from the symbol rather than a client-supplied spec.

#### D. What is proven, and what is not

**Code-level verified**
- 46 provenance tests: all 11 required proofs, including per-field attacks on
  every field claimed trusted.
- **Mutation-tested**: reverting only the classification makes **12** of them
  fail, so they genuinely detect the Phase 175 bug rather than merely passing.
- 9 Phase 175 tamper tests still pass, realigned so the fundamental context
  arrives from the server instead of the client.

**Mocked provider verified**
- 27 secondary-acquisition tests: wiring, conditional policy, at-most-once
  invocation, thrown-error / `success:false` / missing-key handling, identity
  preservation, no-duplicate-logic and no-whitelist checks.

**NOT verified (deployed runtime)**
- No live provider endpoint was contacted (all firewalled here).
- No authenticated end-to-end call was made.
- Real provider latency/rate-limit behaviour under the new server-side fan-out
  is **unmeasured**. The server now issues up to 9 provider calls per analysis
  where the client previously did. They are issued in a **single parallel
  wave** (asserted by test), so the shape matches the client's former
  concurrency rather than serializing — but wall-clock latency and provider
  rate-limit headroom still need observation on a real deployment (UAT 9.21).

**Blocked by environment**
- Convex codegen. Per instruction, `src/convex/_generated/*` was **not**
  hand-edited in this phase (verified: zero diff since `af4d346`).

---

### Phase 175 — deployed-runtime attempt + evidence provenance

#### A. Deployed-runtime verification: **BLOCKED BY ENVIRONMENT — NOT PASS**

Goal A could not be executed. This is reported as blocked, not as a pass, and
nothing in this document claims a deployed check succeeded.

What was attempted, and the literal outcome:

| Step | Result |
| --- | --- |
| Locate deployment config | No `.env.local`; no `CONVEX_DEPLOYMENT` / `VITE_CONVEX_URL` in the environment; no `~/.convex` credentials |
| `npx convex codegen` | `✖ No CONVEX_DEPLOYMENT set` |
| `npx convex dev --once` | `✖ Failed to fetch latest backend version` → `Client network socket disconnected before secure TLS connection was established` |
| Reach control plane | `api.convex.dev`, `dashboard.convex.dev`, `provision.convex.dev` all return HTTP `000` (connection refused/blocked) |

The sandbox has no outbound TLS to Convex, and no deployment credentials are
present. Consequently **all** of the following remain unverified and must be
executed by a human against a real deployment:

- authenticated end-to-end entitlement calls
- unauthenticated request returning before engine execution
- allowance consumption / WAIT / NO_TRADE accounting at runtime
- exhausted-guest LOCKED response over the wire
- Premium and expired-Premium behaviour at runtime
- concurrency against the real database
- **UAT row 9.8 — inspecting the actual browser Network payload**

No artifacts were left behind by the attempt (no `.env.local`, no partial
config, clean `git status`).

> **Generated-code caveat.** Because codegen requires the control plane,
> `src/convex/_generated/api.d.ts` still carries the Phase 174 hand-added
> entries. It was **not** further hand-edited in this phase. A new guard suite
> (`generated-api-integrity.phase175.test.ts`, 9 tests) now asserts the
> declared module set matches the modules on disk exactly, so drift fails
> loudly. Note that `api.js` exports `anyApi` — a runtime proxy — so runtime
> function resolution never depended on the hand edit; only TypeScript types
> did. **Still run `npx convex dev` once before release to regenerate
> authoritatively.**

#### B. Evidence provenance: a real integrity defect, found and fixed

Phase 174 closed the *entitlement* hole. It left an *integrity* hole:
`runProtectedAnalysis` accepted the entire `AnalysisInput` from the client —
including provider-backed evidence — via `input: v.any()`.

**Demonstrated against the real engine, using this repo's own proven LONG
fixture, before the fix:**

| Tamper | Observed result |
| --- | --- |
| Honest provider data | `LONG`, entry 100, SL 95, TP 110, `dataSource: twelve-data` |
| Flip structure `HH/HL` → `LH/LL` | Verdict reverses (bias `Bullish` → `Bearish`) |
| Invent price `99999` the provider never returned | `LONG` **with entry 99999** |
| Relabel `provider` as `"okx"` | Result reports `dataSource: "okx"` |
| Back-date candles 30 days, keep `dataFreshness: "realtime"` | `dataCompleteness: "full"`, **no staleness flag** |

That violates live-data integrity on three counts at once: fabricated evidence,
historical data presented as live, and forged provider identity — while
entitlement was still correctly enforced. Entitlement and integrity are
independent boundaries, and only the first had been closed.

**Fix — provenance, not a checksum.** The server now:

1. strips every provider-backed field from the client input
   (`stripClientEvidence`, built from an allowlist so a field added later is
   untrusted **by default**), then
2. re-acquires the decisive evidence itself via `api.marketData.fetchMarketData`
   using only the instrument identifiers, and
3. runs the engine over that trusted payload.

Client-supplied `marketData`, `technicalData`, sentiment, fundamentals, macro,
derivatives, calendar, treasury, COT, EIA, execution, OKX spec, crypto/universal
intelligence, FX rates and the manual price/high/low/funding/OI overrides are
therefore **inert on the trusted decision path**.

The client still controls *intent* — instrument, instrument type, timeframe,
trading style, and the user's own risk inputs (account equity, risk percent,
account currency, instrument spec). None of that is provider evidence.

Invariants preserved and asserted:

- **Provider-native identity** passes through byte-for-byte; no canonicalisation,
  no substitution (`BTC-USDT-SWAP` stays `BTC-USDT-SWAP`).
- **No fabrication.** When acquisition fails, nothing is attached and the engine
  degrades explicitly — verified to yield `NO_TRADE` with no trade plan and
  non-`full` completeness, never a synthetic price or empty-candle fallback.
- **No hardcoded whitelist** was introduced; routing is unchanged.
- **Entitlement ordering unchanged**: unauthenticated guard → strip → acquire →
  engine → chargeability → atomic consume → gate.

**Evidence:** 38 provenance-contract tests + 9 counterfactual tamper tests that
re-run all five attacks against the fix and assert the tampered result is
byte-identical to the honest one.

**Residual gap — CONCRETE, measured, not silently ignored.**

Only `fetchMarketData` (price, candles, derived technicals) is re-acquired
server-side today. The remaining secondary providers — Alpha Vantage
intelligence, CoinGlass derivatives, Trading Economics calendar, Treasury, COT,
EIA, OKX order book and instrument spec — are currently **stripped and not
re-supplied**. They therefore cannot be forged, which is the correct fail-closed
posture, but they are also unavailable to the server engine.

This is not cosmetic. Measured on the standard fixture, secondary context can
flip the verdict outright:

| Input | Result |
| --- | --- |
| Price + technicals only | `NO_TRADE`, confidence 48, 4 data flags |
| Same, plus event context | `LONG`, confidence 45, 3 data flags |

So the current state is **integrity-safe but context-reduced**: decisions are
honest and un-forgeable, yet the engine sees less evidence than the
pre-Phase-175 client-assembled path provided. Position sizing that depends on
`instrumentSpec`/`fxRates` is likewise affected — those stay client-supplied as
user/account parameters, and remain flagged for review.

Note `newsContext` / `economicEvents` are deliberately still client-trusted:
they are the *user's own* narrative input, not a provider assertion, and the
engine treats them as such. They must never be relabelled as provider evidence.

Closing this gap — server-side acquisition for every secondary provider, with
the same provenance guarantees — is the subject of the next phase.

---

### Phase 174 — entitlement is now a real delivery boundary

The Phase 173 note below is superseded: entitlements are wired to the UI **and**
to a server-side enforcement boundary.

#### The vulnerability that was found and closed

Phase 169 made the entitlement *counter* server-authoritative. It did not make
the *decision* server-authoritative, and that gap was fully bypassable:

1. `runAnalysis()` ran **in the browser**, so the directional decision existed
   client-side the instant it was computed — before any mutation ran.
2. `consumeProfitSignal({ recommendation })` asked the **client** to report what
   the engine had produced.

So a caller could report `"WAIT"`, receive `NOT_CHARGEABLE`, spend nothing, and
still hold the LONG — or skip the mutation entirely. Neither required special
tooling: the mutation is callable from the devtools console and the engine
shipped in the bundle. Any UI-only lock would have been decoration over an
already-delivered payload.

Adding another client-side check would not have fixed this. The fix is
architectural:

```
client sends INPUTS
  -> server runs the engine            (src/convex/protectedAnalysis.ts)
  -> server derives chargeability from the ENGINE's own output
  -> server reads its own entitlement row
  -> internal mutation consumes atomically (serializable OCC)
  -> gate returns either the full result or a locked stub
```

For an exhausted guest the directional recommendation, trade plan and sizing
are **never serialized to that client at all**. There is nothing to un-hide in
devtools and nothing to intercept on the wire.

#### Evidence

| Claim | How it was verified |
| --- | --- |
| Engine no longer ships to the client | `npm run build`, then grep the bundle: `structural stop is hit`, `calculateBias`, `assessDataCompleteness`, `computePositionSizing`, `buildAnalystThesis`, `VETO` all **0 occurrences**. Main chunk fell 1,406,946 → 1,253,374 bytes (≈154 KB of decision logic removed). |
| Locked payload leaks nothing | 19 protected fields asserted absent; the serialized payload is checked to contain no direction, level, or bias token. |
| A lying client cannot get a free signal | Claiming `WAIT` while the engine returned `LONG` still yields `LOCKED` when exhausted, and is still **charged** when allowed. |
| A locked signal is never a WAIT | Asserted the payload contains neither `WAIT` nor `NO_TRADE`, and that `recommendation` is absent rather than replaced. |
| Redaction fails safe | The locked payload is **built from an allowlist**, not stripped. A newly added upstream field is withheld by default; this is covered by a test that adds an unknown directional field. |
| Reload / storage reset cannot restore quota | Counter is a DB row keyed by userId; no client value is read. |
| Concurrency | Serializable OCC modelled; a deliberately non-transactional control test proves the assertions are not vacuous. |
| UI never invents state | Renders nothing until the server query resolves; does not clamp or recompute the server's numbers. |

Total entitlement coverage: **148 tests** across 7 files.

#### What is NOT proven

- **No deployed runtime verification.** There is no Convex deployment in this
  environment, so the boundary is verified by unit + static + bundle evidence,
  not by an authenticated end-to-end call. UAT §9 must still be executed.
- **`_generated/api.d.ts` was hand-extended.** `npx convex codegen` requires a
  deployment. The entries for `entitlements` and `protectedAnalysis` were added
  manually in the generated file's own format. **Run `npx convex dev` once
  before release** to regenerate it authoritatively.
- **`src/convex/tsconfig.json` gained a `@/*` path mapping** so server functions
  can import the shared engine. Verified to bundle cleanly with esbuild
  (`platform=neutral`, 0 unresolved imports), but not yet executed on a real
  Convex deployment.
- `consumeProfitSignal` is retained and **marked DEPRECATED**. It is no longer
  on any delivery path, but it still exists and still trusts its argument; it
  must not be re-wired into one.

#### Deliberately not built

No pricing, currency, plan tiers, payment provider, or billing webhooks. The
upgrade button is inert and labelled as unavailable. `grantPremium` remains
admin-only and is intentionally not client-callable — a client-callable grant
would make Premium free.

---

### Entitlement surface — Phase 173 scope note (SUPERSEDED by Phase 174)

---

### Phase 178 — provider cache, quota and freshness integrity

Phase 177 bounded the fan-out in time. Phase 178 bounds it in **provider
quota**, without letting a cache turn old data into fresh evidence.

The governing rule: **a cache hit reduces provider load; it is never evidence
of a new observation.** "Cached", "fresh", "live" and "provider-observed" are
kept as four separate properties.

#### Cache inventory (as integrated in Phase 178b)

Phase 178 shipped `ProviderCache` **beside** the runtime: the Convex actions
kept private `Map` caches, so none of the provenance guarantees were on the
path `runProtectedAnalysis` actually executes. Phase 178b removed that split.
Every provider cache on the protected path is now the same object.

| # | Location | Scope | Datasets | Cache authority | Dedup |
|---|---|---|---|---|---|
| 1 | `src/convex/alphaVantage.ts` | per action instance | news-sentiment, fundamentals | **`ProviderCache`** (legacy Map removed) | yes |
| 2 | `src/convex/coinglass.ts` | per action instance | derivatives (OI, funding, L/S, liquidations) | **`ProviderCache`** (legacy Map removed) | yes |
| 3 | `src/convex/tradingEconomics.ts` | per action instance | economic calendar | **`ProviderCache`** (legacy Map removed) | yes |
| 4 | `src/convex/marketData.ts` | per action instance | OHLCV (all call sites), FX rate | **`ProviderCache`** (newly cached) | yes |
| 5 | `src/convex/marketData.ts` | per action instance | DXY comparator symbol resolution | module memo + 24 h negative marker | n/a |
| 6 | `src/lib/market-radar/cache.ts` | radar engine (not the protected path) | provider capabilities | `RadarCache` | yes |
| 7 | `src/lib/data/universal/cache.ts` | universal layer (not the protected path) | per-capability | separate store | no |
| 8 | `src/lib/data/provider-cache-registry.ts` | **the authority** | all 13 datasets | single shared `ProviderCache` | yes |

`treasury.ts`, `eia.ts`, `cot.ts` and `okx.ts` have **no** cache — deliberate
and test-pinned. Treasury/EIA/COT are low-frequency government datasets
already bounded by the fan-out, and OKX order-book depth must never be reused
across analyses.

Items 6 and 7 are retained because they serve the **radar/universal engines,
not `runProtectedAnalysis`**. They cannot disagree with the authority on the
protected path because they are not on it. That separation is asserted by
tests rather than assumed.

#### Measured provider-load reduction (Phase 178b)

Counted as real outbound `fetch` calls made by the actual
`runProtectedAnalysis` handler against a deterministic mocked transport:

| Scenario | Provider calls | Result |
|---|---|---|
| First analysis (cold cache) | 10 | baseline |
| Same analysis repeated | 1 | **90% reduction** |
| Same analysis, different user | 1 | public evidence shared |
| 3 concurrent identical analyses (cold) | 11 | vs 30 uncached |

The recommendation is byte-identical across cached and uncached runs, so the
saving does not come from degrading the decision.

`treasury.ts`, `eia.ts`, `cot.ts` and `okx.ts` have **no** module cache. That
is deliberate and now test-pinned: Treasury/EIA/COT are low-frequency
government datasets already bounded by the fan-out, and OKX order-book depth
must never be reused across analyses.

**All caches are per-process.** They live in the module scope of a Convex
action instance. They cut load within an instance and across concurrent
callers on that instance; there is **no cross-instance or distributed cache**,
and none is claimed. A cold instance always re-acquires.

#### Evidence levels — what is and is not proven

| Level | Claim | Status |
|---|---|---|
| **A** | `ProviderCache` behaves correctly in isolation | **Verified** — 47 unit tests |
| **B** | Production provider handlers use it | **Verified** — real `_handler` invocations, 26 tests, outbound calls counted |
| **C** | `runProtectedAnalysis` benefits from it | **Verified** — real handler, 10 provider calls → 1 on repeat |
| **D** | Deployed runtime verified | **NOT VERIFIED** — no Convex deployment or credentials here |

B and C are proven by invoking the **real exported handlers** and counting the
HTTP calls they make, not by constructing a cache in a test. The suites are
mutation-tested: disabling cache reads fails 7 tests, and disabling
single-flight fails exactly the three 20-concurrent-request tests.

#### Cache-key defects found and fixed

Three real collisions were proven by exercising the actual key expressions,
not by reading them:

- **CoinGlass — quote-currency collision.** `deriv:${symbol}` truncated the
  instrument to its base symbol, so `BTC/USDT` and `BTC/USD` shared one entry.
  A USDT-margined funding rate could be served for a USD-quoted request. Now
  keyed on the full instrument identity.
- **Alpha Vantage — asset-class collision.** `news:${ticker}` omitted the
  instrument type, so a crypto symbol and an identically named equity ticker
  shared an entry. Now qualified by `instrumentType`.
- **TickAtlas — case duplication.** `cal:` keys were case-sensitive, so
  `EUR/USD` and `eur/usd` produced two entries and two calls for identical
  data — pure waste against a rate-limited provider. Now normalised.

Instrument identity is never canonicalised into a lossy generic symbol.
`BTC-USDT-SWAP` stays byte-exact in the key; only genuinely case-insensitive
dimensions (`instrumentType`, `timeframe`) are normalised.

#### TTL rationale

TTLs are per-dataset, derived from real update cadence — there is no global
TTL, because a funding rate and a COT report do not age at the same speed.

| Dataset | TTL | Fresh window | Why |
|---|---|---|---|
| order-book | 5 s | 10 s | changes continuously; a stale book would misfire the scalping veto |
| quote | 20 s | 60 s | must stay close to live |
| ohlcv | 60 s | 5 min | candle granularity |
| derivatives | 60 s | 5 min | exchange funding/OI cadence |
| fx-rate | 5 min | 15 min | affects sizing arithmetic only |
| news-sentiment | 10 min | 30 min | matches existing Alpha Vantage behaviour |
| calendar | 20 min | 1 h | scheduled events; matches existing TickAtlas TTL |
| macro | 1 h | 3 h | macro series update slowly |
| treasury | 6 h | 24 h | daily yield-curve publication |
| eia | 6 h | 24 h | **weekly** petroleum status report |
| cot | 12 h | 7 d | **weekly** CFTC report, published Fridays |
| fundamentals | 24 h | 7 d | quarterly filings; static intraday |
| instrument-spec | 24 h | 7 d | contract metadata rarely changes |

Long TTLs are safe **only because freshness is recomputed from `observedAt` on
every read**. A long TTL means "we may reuse this", never "this is current".
The fresh window is always ≥ the TTL: TTL governs *reuse*, the fresh window
governs *labelling*.

#### Freshness and provenance

Every cache entry stores `observedAt` — when the **provider** observed the
data — separately from `cachedAt` and the read time. Evidence age is always
`readAt − observedAt`. A cache hit never rewrites `observedAt`.

Consequences, all test-pinned:

- An entry observed at T0 and read at T1 reports age T1−T0, **not** T1−cachedAt.
- The same entry decays FRESH → DELAYED → STALE → HISTORICAL purely because
  time passed, with no refetch.
- Data observed 30 days ago is labelled HISTORICAL even on a cache hit; it
  cannot become realtime by being read from memory.
- Provider identity and exact OKX native identity survive a hit unchanged.

The three shipping Convex caches return the stored payload **verbatim**, so
the `timestamp` each provider embedded at fetch time is preserved. They do not
rebuild the object on a hit, which is what would reset the clock.

One residual nuance, recorded honestly: the calendar and derivatives payloads
carry a `freshness` **string label computed at fetch time**. That label is
frozen and does not decay on a cache hit. It is currently **not** read by any
decision path — the analysis engine derives price staleness from
`md.price.timestamp`, order-book freshness from the exchange timestamp, and
event risk from absolute `datetime > now` comparisons re-evaluated on every
run. So no frozen label can currently promote stale data. Any future consumer
of `calendarData.freshness` **must** recompute from `timestamp` instead.

#### Single-flight and quota

`ProviderCache` deduplicates concurrent misses on the same key: 20 simultaneous
identical requests produce **one** provider call, verified with real promises
and real scheduling. Distinct keys are never merged. A single-flight join is
explicitly *not* reported as a cache hit — the provider was called; the caller
merely shared the result.

Phase 178b proves this on the production handlers, not just the class. Driving
the real exported actions with a counting transport:

| Handler | 20 concurrent identical requests | Upstream calls |
|---|---|---|
| `alphaVantage.fetchIntelligence` | 1 acquisition | 1 |
| `coinglass.fetchDerivatives` | 1 acquisition wave | ≤ 4 (OI, funding, L/S, liquidations) |
| `tradingEconomics.fetchCalendar` | 1 acquisition wave | ≤ 4 |
| `marketData.fetchFxRate` | 1 acquisition | ≤ 2 (direct + inverse) |

Every OHLCV request in `marketData.ts` funnels through one `fetchCandles`
chokepoint, which is cached on provider + symbol + timeframe + bar count. A
210-bar setup series and a 100-bar HTF series are therefore distinct entries —
reusing one for the other would silently corrupt higher-timeframe context.

Rate-limit interaction:

- A cache hit consumes **no** provider quota.
- A 429 is never stored, so it can never become valid evidence.
- A failed in-flight request does not poison unrelated keys.
- A failure is never cached: the next permitted attempt retries cleanly.
- Concurrent misses do not multiply exposure — that is the point of
  single-flight, and it directly protects the low-budget providers.

#### Negative caching

The only negative cache is the DXY comparator probe in `marketData.ts`. It is
bounded to 24 h, stores a **timestamp only** (it cannot express a direction),
and on a cached failure it *skips probing* — the comparator becomes `null` and
the correlation block is omitted. It never fabricates a comparator series.
Every other failure path stores nothing at all.

#### Cross-user isolation

No user-owned value may enter a shared provider cache. `assertNoUserData()`
walks a payload before it is stored and **throws** on `accountEquity`,
`riskPercent`, `accountCurrency`, `userId`, `email` or `instrumentSpec`,
including nested occurrences. Cache keys are built only from public provider
dimensions, so two users analysing the same instrument share public evidence
and nothing else. This complements Phase 176: those three account fields are
client-trusted *inputs*, never cacheable *evidence*.

### Phase 178c — remaining protected-path providers

Phase 178b integrated the cache for Alpha Vantage, CoinGlass, the calendar and
market data. Phase 178c decides the remaining legs **provider by provider**.
The goal was never "cache everything": each decision follows from how that
dataset's freshness is computed and how the engine consumes it.

#### The deciding question

There is exactly one structural difference between the providers that are safe
to cache and the one that is not:

> Is the freshness label **re-derived from the provider's observation date at
> read time**, or **computed once and stored in the payload**?

Treasury, EIA and COT re-derive: `classifyMacroFreshness(observationDate, now)`,
`classifyCotFreshness(reportDate, now)` and `classifyEiaFreshness(...)` all take
the current clock as an argument. A cached payload therefore decays honestly —
measured: a report dated 3 days ago classifies `FRESH` today and `STALE` when
evaluated 60 days later, with no refetch.

The OKX order book does the opposite: `buildExecutionData` classifies the
snapshot against `EXECUTION_STALE_MS` (30 s) **at build time** and writes
`"FRESH"` or `"STALE"` into the payload. Measured: the same snapshot built 60 s
later classifies `STALE`. A cache hit would replay the earlier frozen label.

#### Final decision table

| Provider | Dataset | Cache? | TTL | Freshness window | Key | Rationale |
|---|---|---|---|---|---|---|
| Twelve Data | ohlcv | **Yes** | 60 s | 5 min | provider+symbol+timeframe+bar count | candle granularity; bar count is part of identity |
| Twelve Data | fx-rate | **Yes** | 5 min | 15 min | provider+dataset+`FROM>TO` | conversion direction is part of identity |
| Alpha Vantage | news-sentiment | **Yes** | 10 min | 30 min | provider+dataset+instrument+asset class | headlines do not change per second |
| Alpha Vantage | fundamentals | **Yes** | 24 h | 7 d | provider+dataset+instrument+asset class | quarterly filings; static intraday |
| TickAtlas | calendar | **Yes** | 20 min | 1 h | provider+dataset+INSTRUMENT+type | scheduled events; case-normalised |
| CoinGlass | derivatives | **Yes** | 60 s | 5 min | provider+dataset+full instrument | exchange funding/OI cadence |
| US Treasury | treasury | **Yes** (178c) | 6 h | 24 h | provider+dataset+month partitions | **published once per business day** |
| EIA | eia | **Yes** (178c) | 6 h | 24 h | provider+dataset+product ids | **WPSR published weekly (Wed)** |
| CFTC | cot | **Yes** (178c) | 12 h | 7 d | provider+dataset+**CFTC contract** | **published weekly (Fri)**; aliases share a contract |
| OKX | instrument-spec | **Yes** (178c) | 24 h | 7 d | provider+dataset+exact `instId` | contract metadata, not a market observation |
| OKX | order-book | **UNCACHED BY DESIGN** | — | 30 s (exchange ts) | — | see below |

No TTL was chosen to reduce API calls. Each equals the dataset's real
publication cadence, and each is shorter than its freshness window so reuse can
never outlive labelling.

#### OKX order book — UNCACHED BY DESIGN (mandatory decision)

**Outcome A: always fresh.** The order book is never cached and never
single-flighted. The decision is recorded in `src/convex/okx.ts` directly above
the action so it cannot be "optimised" away by a future reader, and it is
enforced by tests.

Why:

1. **Its freshness label is stored, not derived.** A cache hit would replay a
   frozen `FRESH`, asserting microstructure that no longer exists. This is the
   single disqualifying property, and it is proven by measurement rather than
   argued.
2. **That label gates real decisions**, not cosmetics:
   - the SCALPING hard veto on extreme spread / `THIN` depth
     (`analysis-engine.ts` ~1037, gated on `ed.freshness === "FRESH"`)
   - the crypto execution confidence layer (~1527, same gate)
   - slippage estimation, which walks the actual book levels
   - the user-facing "Execution snapshot is stale" warning
   A replayed label could veto a valid setup, or let a dead book add
   confidence.
3. **The budget is 30 s** from the exchange timestamp. Any TTL long enough to
   save meaningful quota would exceed the window in which the data is true.
4. **There is nothing to save.** The endpoint needs no API key and has no
   per-user quota — one request per crypto analysis.

**Single-flight is also deliberately not applied.** Two concurrent analyses of
the same instrument must each observe the book at their own instant; sharing
one snapshot would make the second act on the first's microstructure.

#### Why raw payloads are cached, never built contexts

Treasury, EIA and COT cache the **raw provider payloads** (XML feeds, product
legs, Socrata rows) rather than the built context object. The context — and
with it the freshness label — is rebuilt on every read against `Date.now()`.

This is what makes a long TTL safe. A 12-hour COT entry is reused for 12 hours,
but the report it contains is re-classified `FRESH`/`DELAYED`/`STALE` on every
single read. A long TTL therefore means "we may reuse this", never "this is
current" — the distinction the order book cannot make.

#### Measured provider load, full protected path

| Analysis | Cold | Warm | Reduction |
|---|---|---|---|
| Forex swing (EUR/USD H4) | 15 calls | 1 | **93%** |
| Crypto scalping (BTC/USDT M5) | 12 calls | 2 | **83%** |

The crypto residual is the order book being correctly re-observed. That is the
intended cost of the design, not a gap.

#### Acquisition provenance

`src/lib/data/acquisition-provenance.ts` records **how** a leg's data was
obtained, which the Phase 177 failure taxonomy cannot express:
`observed-now`, `observed-shared` (single-flight join), `cache-reused`,
`uncached-by-design`, `unavailable`, `timed-out`, `rate-limited`, `skipped`.

`usedAt` is recorded separately from `observedAt` and is **never** substituted
for it — a missing observation time stays missing rather than being back-filled
with the time of use, which would fabricate an observation. A reuse is always
described as "reused earlier observation … provider NOT contacted", never as a
fresh one.

---

### Phase 178d — acquisition provenance and diagnostic wiring

Phase 178c decided *what* to cache. Phase 178d makes those decisions
**observable**: an operator can read one protected analysis and tell, per
provider, whether the evidence was freshly observed, shared from a concurrent
provider call, reused from cache, deliberately uncached, skipped, or
unavailable — with no mode falsely implying a new observation.

**Modes are reported, never inferred.** A successful leg's mode comes from
`ProviderCache.acquisition`, surfaced by the provider action and passed
through `runProviderLeg` verbatim. A failed leg's mode comes from its Phase
177 failure category. Latency is never used as evidence of a cache hit.

#### Diagnostic schema

Per leg (`LegDiagnostic`):

| Field | Meaning |
|---|---|
| `provider`, `dataset` | identity, verbatim |
| `instrument` | provider-native identity where applicable |
| `mode` | one of the eight acquisition modes |
| `observedAt` | provider observation time; **absent** when nothing was observed |
| `usedAt` | when this analysis used the value |
| `evidenceAgeMs` | `usedAt − observedAt`; absent without an observation |
| `providerContacted` | the provider was reached, directly or via a shared call |
| `quotaChargeAttributableToCaller` | **this** caller caused a provider request |
| `sharedWithConcurrentCallers` | joined another caller's in-flight request |
| `acquired` / `attached` / `usedByEngine` | three separate facts, never conflated |

Plus a totals line: requests caused, cache reuses, shared, uncached-by-design,
unavailable — all derived from the runtime.

#### `observed-shared` and quota semantics (resolved)

`consumedQuota()` was ambiguous: "this caller caused a request" and "this
result came from a quota-consuming request" differ for exactly one mode —
`observed-shared` — which is the mode single-flight creates. The ambiguity was
load-bearing, so the function was **replaced** by two precise predicates:

- **`quotaChargeAttributableToCaller`** — definition (A). True only when this
  caller initiated the HTTP call. A single-flight join is **false**: the
  request already existed, and charging it would double-count one call across
  N callers, overstating provider load.
- **`originatedFromProviderRequest`** / **`providerContacted`** — definition
  (B). True for a join too, because the bytes were paid for by some request.
  Use it to ask "is this evidence backed by a real provider call?", never to
  count load.

Both are test-pinned so the distinction cannot silently regress.

#### Provider-by-provider provenance (measured on the real fan-out)

| Provider | Dataset | Cold | Warm | Concurrent | Cache | TTL | Freshness source | Contacted? | Used by engine? |
|---|---|---|---|---|---|---|---|---|---|
| market-data | ohlcv + quote | `observed-now` | `cache-reused` | `observed-shared` | yes | 60 s / 20 s | candle + quote timestamps | when not reused | yes |
| alpha-vantage | news-sentiment | `observed-now` | `cache-reused` | `observed-shared` | yes | 10 min | article timestamps | when not reused | yes |
| tickatlas | calendar | `observed-now` | `cache-reused` | `observed-shared` | yes | 20 min | event datetimes (live) | when not reused | yes |
| coinglass | derivatives | `observed-now` | `cache-reused` | `observed-shared` | yes | 60 s | payload timestamp | when not reused | crypto only |
| cftc | cot | `observed-now` | `cache-reused` | `observed-shared` | yes | 12 h | report date, re-derived | when not reused | fx/commodity |
| treasury | treasury | `observed-now` | `cache-reused` | `observed-shared` | yes | 6 h | observation date, re-derived | when not reused | fx/commodity |
| eia | eia | `observed-now` | `cache-reused` | `observed-shared` | yes | 6 h | observation date, re-derived | when not reused | oil only |
| okx-instrument-spec | instrument-spec | `observed-now` | `cache-reused` | `observed-shared` | yes | 24 h | acquisition time (static) | when not reused | crypto sizing |
| fx-rate | fx-rate | `observed-now` | `cache-reused` | `observed-shared` | yes | 5 min | quote timestamp | when not reused | cross-currency |
| **okx-order-book** | order-book | `uncached-by-design` | `uncached-by-design` | `uncached-by-design` | **never** | — | exchange `ts`, 30 s | **always** | crypto scalping |

Sample output, derived from a real warm crypto run (values come from the
runtime, not hardcoded):

```
market-data/ohlcv = cache-reused(age 34ms, used)
alpha-vantage/news-sentiment = cache-reused(age 35ms, used)
tickatlas/calendar = cache-reused(age 33ms, used)
coinglass/derivatives = cache-reused(age 34ms, used)
okx-instrument-spec/instrument-spec = cache-reused(age 36ms, used)
okx-order-book/order-book = uncached-by-design(age 8ms, used)
totals: 1 provider request(s) caused, 5 reused from cache, 0 shared, 1 uncached-by-design, 0 unavailable
```

#### Composite legs

`fetchMarketData` and `fetchIntelligence` perform several cache reads each.
They report **one** mode via `combineAcquisitions`, which fails safe:
`cache-reused` only when *every* read was reused, `observed-now` when any read
caused a request. The age uses `oldestObservation`, so one fresh read cannot
mask an older component. The bias is deliberate — over-reporting provider
contact understates the cache's benefit, while under-reporting it would
fabricate freshness.

A defect this surfaced: before the composite handling, three legs reported
`observed-now` on warm runs because they never surfaced a mode and silently
took the fallback. It was found by reading real runtime output, not by reading
code.

#### Integrity fix — an empty composite cannot imply provider contact

`combineAcquisitions([])` originally returned `observed-now`. An empty list
means **no cache read completed**, which is no evidence any provider was
contacted, so that value fabricated contact and violated the phase invariant.

It was **reachable in production**, not merely a defensive branch. Measured
against the real `fetchIntelligence` handler with a dead transport: news is
non-critical, so the handler swallows the error and still returns
`success: true` — carrying `acquisition: "observed-now"` with
`observedAt: undefined`. A claimed fresh observation backed by nothing.

Because the state is legitimate, the fix does **not** throw (that would turn a
survivable degradation into a hard failure). Resolution, at three layers:

1. `combineAcquisitions([])` → **`unavailable`**, which already exists in
   `AcquisitionMode` as "provider returned no usable data". No mode was
   invented; the return type widens only to a member the model already defines.
2. `envelopeAcquisition()` → **`undefined`** for action envelopes, which can
   structurally carry only the three success modes. An absent field is the
   honest representation of "this action makes no claim".
3. The fan-out reports a cached leg with **neither** a mode **nor** an
   `observedAt` as `unavailable` rather than defaulting to `observed-now`,
   closing the same fabrication one level up.

`unavailable` is excluded from `NEW_OBSERVATION` and from every quota
predicate, so a degraded leg can no longer imply contact or consume quota.
Pinned by 21 tests; reintroducing the original return value fails 7.

#### Order book — provenance confirms the 178c decision

Every use reports `uncached-by-design` and the leg is test-pinned to **never**
report `cache-reused`, across repeated runs. Marking it cacheable in the
dataset map fails the suite.

#### Safety

Diagnostics are credential-free (`looksLikeCredential` guards the output) and
carry no user identifier, account equity, risk percent or account currency.
Verified by running a real analysis with those values set and asserting they
never appear in any emitted line.

**Scope:** these diagnostics describe ONE action instance. They do not imply
distributed or global cache behaviour — see the scope note below.

---

### Phase 178e — protected-path default/fallback integrity sweep

A final audit of every `??` / `||` / empty-value fallback on the protected
decision path: client input → `protectedAnalysis` → provider acquisition →
cache/provenance → evidence attachment → engine → entitlement gate → response.

**142 fallback sites audited across 4,809 lines. 2 dangerous, both fixed.**
Each site was traced to its semantic consumer; pattern-matching alone decides
nothing, and most `?? 0` sites are mathematically neutral.

#### Defect 1 — malformed OHLC became a believable market structure

`parseFloat` on a malformed field yields `NaN`, which was returned inside a
`success: true` envelope. Measured before the fix: a provider returning
`"n/a"` for every OHLC field produced `success=true` with `close=NaN` — an
invalid market structure presented as valid evidence, which indicators then
propagate silently.

Fixed in `fetchCandles`: rows without finite `timestamp/open/high/low/close`
are **dropped**, and if *no* row survives the action fails with "provider
returned no numerically valid candles". Rows are dropped rather than defaulted
because there is no honest substitute for a missing price — a zero would be a
believable lie. Verified: 210 rows with every 50th corrupted → 205 clean
candles, no NaN; all-corrupt → explicit failure.

#### Defect 2 — order book aged from request time, not the exchange

`fetchOkxOrderBook` never returned an `observedAt`, so fan-out diagnostics
fell back to request-completion time. Measured: a snapshot the exchange
stamped **12,002 ms** ago was reported as ~5 ms old — a stale book presented
as freshly observed, violating the Phase 178d §7 rule that `observedAt` must
be the provider's own observation when it exposes one.

Fixed: the action now reports `snapshotTs` (the exchange timestamp) as
`observedAt`, and omits it entirely when the book is unusable. Provenance and
the freshness gate now derive from the same basis — pinned by a test asserting
`observedAt === data.snapshotTs`.

#### Legitimate defaults explicitly RETAINED

| Site | Why it cannot fabricate evidence |
|---|---|
| `volume \|\| 0` (candles) | Volume is genuinely absent from many spot-forex feeds. The consumer `computeVolumeProfile` refuses to build a profile when total volume is zero and states why; `analyzeVolume` reports `unknown` below 20 candles. Test-pinned both ways. |
| `sentimentScore ?? 0` (Alpha Vantage) | Applied only to articles already filtered by `sentimentScore !== undefined`; arithmetically unreachable. |
| `relevanceScore ?? 0.5` | Sort tie-break only. Cannot alter direction, confidence, or evidence. |
| `profitSignalsUsed ?? 0` | Entitlement counter for a user with no row yet — the correct starting count, and the gate is fail-closed. |
| `?? Date.now()` (FX `observedAt`) | Dead branch: `fetchPair` always sets `timestamp` and returns `null` otherwise. Retained as a type-level guard, not a live path. |
| `mode ?? "observed-now"` (fan-out) | Now reachable only when `observedAt` **is** a finite number, i.e. a real observation whose mode went unreported. The no-evidence case returns `unavailable` before this line. |

#### Defence in depth discovered by mutation testing

Fabricating a timestamp in `legFromFailure` changed **nothing** — because
`recordProvenance` independently refuses to attach an observation to a mode
outside `CARRIES_EVIDENCE`. That second layer was real but **untested**, so a
later refactor could have removed it silently. It is now pinned directly:
removing layer 2 fails 2 tests, removing both fails 6.

#### Confirmed absent on the protected path

No directional default (`?? "BUY"`/`"SELL"`/`"LONG"`/`"SHORT"`), no
`?? "live"` / `"fresh"` / `"verified"` / `"success"`, no default provider
identity, no `allowed` default in the entitlement gate, no `return true` on
missing provider evidence, and no confidence/freshness fallback.

---

#### Scope honesty — what "shared" means here

The registry (`src/lib/data/provider-cache-registry.ts`) is a module-level
singleton, which in Convex means **one action instance / one V8 isolate**. It
deduplicates work within that instance, including across concurrent callers on
it. It is **not distributed**: a cold instance re-acquires, and two instances
do not share entries.

No global or cross-instance quota reduction is claimed. Achieving that would
need external coordination (a Convex table or an external store) and is
deliberately out of scope. The measured 90% reduction is a **per-instance**
figure.

#### Sandbox limits

Cache behaviour is verified against injected clocks and injected transports.
**No provider quota was measured against a live endpoint** — all provider
hosts are firewalled here. The quota reduction reported above is a real count
of outbound calls made by the production handlers under test, not an observed
billing delta. See UAT 13A.

---

## 5. Known issues

- The main JS chunk exceeds 1,000 kB. Non-fatal, but worth code-splitting
  before launch.

### ACTION REQUIRED before production — rotate the leaked OTP key

A third-party API key for the OTP email service was committed in
`src/convex/auth/emailOtp.ts` and is present in this repository's git history.

Phase 165 removed the literal from the source and moved it to the
`OTP_EMAIL_API_KEY` environment variable, but **removing it from the working
tree does not remove it from history** — the value is still recoverable from
earlier commits, and this repository has been pushed.

Before launch you must:

1. **Rotate/revoke the key** at the provider (`auth.freebuff.app`). This is the
   only step that actually neutralizes the exposure; assume the old value is
   compromised.
2. Set the new value as `OTP_EMAIL_API_KEY` in the Convex deployment
   environment (not in the client bundle — anything prefixed `VITE_` ships to
   the browser).
3. Optionally purge the value from history (`git filter-repo` or BFG) and
   force-push. Do this only after rotating; it rewrites commit hashes.

#### Phase 172 — measured exposure scope

Re-verified by scanning every reachable commit. Reported as counts only; the
value itself is never printed by the audit.

| Check | Result |
| --- | --- |
| Literal in the current working tree | **absent** |
| Literal in tracked files on this branch | **absent** |
| Literal in the built bundle (`dist/`) | **absent** |
| Literal in `.env.example`, fixtures, docs, tests | **absent** |
| Commits still containing the literal | **9** |
| Distinct file path across those commits | `src/convex/auth/emailOtp.ts` |
| Literal in the **`origin/main` working tree** | **PRESENT** |

The last row is the important one and is easy to miss: `origin/main` is still
at `51c9dde`, which predates the Phase 165 removal. The credential is therefore
not merely in history on `main` — it is in `main`'s **current checked-out
source**. Anyone cloning the default branch today gets the live key in plain
text. This is an additional reason not to treat `main` as production-ready.

#### Safe remediation order (after rotation, never before)

Rewriting shared history invalidates every existing clone and all open PRs, so
this is deliberately NOT automated here. Run it only once the key is revoked.

```bash
# 0. PREREQUISITE: revoke the old key at the provider first.
#    Until that is done, purging history only hides the exposure.

# 1. Merge the remediated branch so main no longer serves the literal.
git switch main && git merge --ff-only arena/01a08e67-trade-intel-bot

# 2. Back up before rewriting.
git clone --mirror <remote-url> repo-backup.git

# 3. Purge the literal from every commit. Put the value in a local
#    replacements file; do NOT commit that file.
#    echo 'literal:<OLD_KEY>==>OTP_EMAIL_API_KEY_REMOVED' > /tmp/replace.txt
git filter-repo --replace-text /tmp/replace.txt

# 4. Force-push all refs, then have every collaborator re-clone.
git push --force --all && git push --force --tags
```

After step 4, re-run the scan to confirm zero matches remain:

```bash
git rev-list --all | while read c; do
  git grep -qI "<OLD_KEY>" "$c" -- 2>/dev/null && echo "STILL PRESENT: $c"
done
```

Note that GitHub retains unreferenced objects for a period even after a force
push, so rotation — not history rewriting — remains the step that actually
neutralizes the exposure.

Related hardening shipped in the same phase: the handler previously threw
`JSON.stringify(error)`, which serialized the whole axios error — including the
request headers carrying the key and the OTP itself — into the error message.
It now reports the HTTP status only.

### Phase 172 — discovery → scanner path verified (mocked transport)

The full runtime path was exercised end to end against the REAL production
functions, in the same order `Dashboard.runDiscoveryCycle` calls them:

```
okx-discovery.discoverOkxInstruments(transport)      raw OKX JSON
  -> runtime.normalizeOkxDiscoveryAction()
  -> pipeline.runDiscoveryPipelineStep()
       -> registry.selectAcquirableInstruments()      capability/state filter
       -> liveScanner.selectRotatingDiscoveryBatch()  per-cycle budget
       -> runtime.toAcquisitionResults()              identity re-binding
  -> liveScanner.scanInstruments()                    ranked output
```

Only two seams are injected: the HTTP transport and the acquisition callback —
exactly the seam the Convex action occupies in production. No pipeline logic is
re-implemented in the test.

`selectRotatingDiscoveryBatch` **is** wired into the runtime path
(`discovery/pipeline.ts:160`), not merely a test helper. It is a per-cycle work
budget, not a whitelist: the cursor wraps modulo the discovered set, and
coverage was proven exhaustive for set sizes 3/5/7/11 against budgets 1/2/4 —
the awkward non-dividing combinations where starvation bugs hide.

**Live provider verification remains externally BLOCKED.** OKX and CoinGecko
are firewalled in the sandbox, so the transport is deterministic and mocked.
That proves our wiring, not OKX uptime, and must not be reported as live
provider verification.

### Silent-failure patterns found in Phases 170–171 — read this one too

Three defects in this batch shared one shape: **the broken value made a
comparison false, and a false comparison looks like "nothing to report".**

- `NaN <= 0` is **false**, so every `typeof x !== "number" || x <= 0`
  validator in `position-registration.ts` accepted `NaN` and `Infinity` as
  valid prices.
- `NaN < 2` is **false**, so an unguarded distance-to-stop did not render a
  visibly wrong warning — it *silently dropped* the "approaching stop loss"
  warning entirely.
- Both `NaN > peak` and `NaN < peak` are **false**, so a `NaN` unrealized P/L
  silently disabled **giveback protection** in `protection-engine.ts` instead
  of surfacing an error.

Standing caution: **a guard written as `x <= 0` does not reject non-finite
numbers.** Use `Number.isFinite(x) && x > 0`. When a numeric field can
legitimately be unknown, type it `number | undefined` rather than defaulting
it to `0` — TypeScript then forces every consumer to decide what "unknown"
means, which is how all nine `unrealizedPnL` call sites were found. A default
of `0` is not neutral on a trading surface: it reads as "breaking even",
"at the stop", or "no giveback".

Related: `parseFloat` is not a validator. `parseFloat("12abc")` is `12`, and
`parseFloat(x) || 0` turns unparseable input into a price the user never
typed.

### Test-collection gap (fixed in Phase 166) — read this one

`vitest.config.ts` had `include: ["src/**/*.test.ts"]`, which never matched
`.test.tsx`. The two component render suites — the only tests in the repo that
mount a real React component — were therefore collected by **no run at all**.
They had silently rotted, and every assertion in them was dead.

This matters beyond those two files: it means a green suite was never evidence
about UI behaviour. Enabling them (split `unit`/`ui` vitest projects, jsdom for
`.tsx`) immediately exposed four real defects, listed under Resolved below.

Treat this as the standing caution for this project: **a passing suite only
covers what it actually collects.** Check the collected-file count, not just
the pass rate.

### Resolved

- **Phase 169 — no entitlement system existed.** There was no table, no
  counter and no enforcement anywhere in the codebase, so any free-tier limit
  would have been client-side and therefore decorative. Now server-authoritative
  in `src/convex/entitlements.ts` against an `entitlements` table keyed by
  userId. Only actionable BUY/SELL/LONG/SHORT results are charged — WAIT and
  NO_TRADE are always free, so the pricing model cannot create pressure to
  manufacture recommendations.
- **Phase 169 — open redirect via `?returnTo=`.** The guard
  `startsWith("/") && !startsWith("//")` accepted `/\evil.com`, which browsers
  normalise into a protocol-relative URL to another origin. Replaced with
  `src/lib/routing/safe-redirect.ts`; 15 attack vectors pinned as tests.
- **Phase 169 — `MemoryRouter` in production.** Deep links, reload and browser
  back/forward were all broken; the address bar never updated. Switched to
  `BrowserRouter` and added the required host rewrite (`public/_redirects`,
  `vercel.json`).
- **Phase 169 — build-platform branding shipped to users.** "secured by
  freebuff.com" on the sign-in card, an "Open editor" button in the error
  dialog, and a `[Freebuff ...]` runtime log tag. The editor toolbar was
  mounted unconditionally and only caught by grepping `dist/`; it is now gated
  behind `import.meta.env.DEV`. `grep -c "freebuff.com" dist/assets/*.js` is 0
  across every chunk. The locale storage key was renamed with a one-time
  legacy read so existing users keep their language.
- **Phase 170 — fabricated prices on the entry path.** `formatInstrumentPrice`
  rendered `NaN`, `∞` and `0.00000`; the last is the dangerous one because it
  reads as a real quote rather than an error.
- **Phase 171 — giveback protection silently disabled by a NaN P/L.** See the
  silent-failure section above.

- **Enum mappers crashed on missing data (fixed in Phase 166).** All 34
  `map*` helpers in `src/lib/i18n/enum-mapping.ts` ended in
  `default: return value.replace(...)`, and five called `.toUpperCase()` on
  the switch subject. The module docstring promised the opposite ("never
  undefined, blank, or crash"). Any absent field threw a TypeError that took
  down the whole localized surface.

- **IntelligenceDashboard hard-crashed on absent fields (fixed in Phase 166).**
  `actionRecommendation` and `pnlPct` were dereferenced unguarded; `pnlPct !== 0`
  also passes for `undefined`. An absent recommendation now reads UNAVAILABLE
  and an absent PnL is omitted rather than shown as a fabricated `0.00%`.

- **"What changed" reported present data as unavailable (fixed in Phase 166).**
  An empty array — meaning "compared, nothing changed" — was rendered as
  "provider not connected". Empty, missing and null are now three distinct
  states.

- **MarketOverviewPanel could print "NaN" as a price (fixed in Phase 166).**
  `price ?? 0` let NaN/Infinity through, rendering the literal string beside a
  green LIVE badge. `SIMULATED` was also unhandled. A price is now shown only
  for a finite positive number, simulated data is treated as unavailable, and
  the "N/M live" counter uses the same rule as the rows.

- **Credentialed Convex actions were publicly callable (fixed in Phase 167).**
  Eight actions proxying Alpha Vantage, CoinGlass, EIA, Trading Economics and
  Twelve Data had no authorization check, so an anonymous caller could exhaust
  a paid quota or use the deployment as a free API proxy. All eight now
  require an identity before the key is read; guest sign-in satisfies it.

- **Stream cursor cross-user read (fixed in Phase 165).** `streamCursors` rows
  carry a `userId`, but the table's only index was `by_provider_instrument` and
  `positionProtection.getCursor` had no authentication check at all. Any signed-in
  user could read another user's stream position by requesting the same
  provider/instrument pair, and `saveCursor`'s upsert could patch a row
  belonging to a different user. Fixed with a `by_user_provider_instrument`
  index and user-scoped lookups in both handlers.

- **OKX derivatives were silently undiscoverable (fixed in Phase 165).**
  `discoverOkxInstruments` requested SPOT, SWAP and FUTURES, then rejected every
  row lacking `baseCcy`/`quoteCcy`. Per the OKX v5 API those fields are
  populated for SPOT only; derivatives express the pair through `uly`. The
  result was that 100% of perpetuals and futures were discarded without a
  warning, so they could never reach the scanner — the failure was invisible
  because discovery still "succeeded" with a non-empty spot list. Found by
  running the real pipeline against an injected transport rather than by
  reading tests.

- **`src/convex/auth/emailOtp.ts` TypeScript errors (fixed in Phase 164).**
  Three long-standing errors (`TS2353` on `id`, two `TS7031`) broke
  `npm run build`, since that script runs `tsc -b` before `vite build`.

  Root cause: `@auth/core` is a **required peer dependency** of
  `@convex-dev/auth@0.0.90` and was never installed. Without it, the
  `EmailConfig` type that `EmailUserConfig` derives from could not resolve,
  so the valid `id` property appeared unknown and the
  `sendVerificationRequest` parameters lost their types and fell back to
  implicit `any`.

  The application code was correct all along — the dependency was missing.
  Installing `@auth/core@^0.37.0` resolved all three errors with no source
  changes. `tsc -b` now exits 0.
