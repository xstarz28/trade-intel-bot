# Production Verification — Xstarz Analysis

This document records what has been **verified**, what is **unverified**, and
what **cannot be verified** by automated agent runs. It is deliberately
conservative: anything not actually executed and observed is not marked PASS.

Last updated: Phase 174 (2026-09-11).

---

## 1. Verification status summary

| Area | Status | Evidence |
| --- | --- | --- |
| Unit + integration test suite | **PASS** | 7,966 tests / 214 files, 0 failures (Phase 174) |
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
| Entitlement runtime on a deployment | **NOT VERIFIED** | No Convex deployment here — see Phase 174 caveat |
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
