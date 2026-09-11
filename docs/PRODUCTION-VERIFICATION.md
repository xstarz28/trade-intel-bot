# Production Verification — Xstarz Analysis

This document records what has been **verified**, what is **unverified**, and
what **cannot be verified** by automated agent runs. It is deliberately
conservative: anything not actually executed and observed is not marked PASS.

Last updated: Phase 167.

---

## 1. Verification status summary

| Area | Status | Evidence |
| --- | --- | --- |
| Unit + integration test suite | **PASS** | 7,674 tests / 198 files, 0 failures |
| Component (jsdom) render suites | **PASS** | Collected for the first time in Phase 166 — see below |
| TypeScript compile | **PASS** | `tsc -b` exit 0, fully clean |
| Production build | **PASS** | `npm run build` (`tsc -b && vite build`) exit 0 |
| Lint | **PASS (no new)** | Error count unchanged from baseline on every touched file |
| Live provider calls | **NOT VERIFIED** | Outbound market-data hosts are blocked in the agent sandbox |
| Credentialed providers | **NOT VERIFIED** | No API keys present in this environment |
| Convex deployment runtime | **NOT VERIFIED** | No deployment URL configured here |
| Browser / manual E2E | **CANNOT BE DONE BY AGENT** | Requires a human clicking through the UI |
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

## 4. Manual browser E2E checklist

This portion **must** be done by a human; the agent cannot drive a browser.

Prerequisites: `npx convex dev` running, `.env` populated from
`.env.example`, then `npm run dev`.

- [ ] App loads with no console errors
- [ ] Sign-in completes and the session persists across a hard refresh
- [ ] Dashboard performs a discovery cycle and lists instruments
- [ ] Instrument ids shown are provider-native (e.g. `BTC-USDT`), not
      canonicalized
- [ ] A scan produces rankings, or an explicit WAIT / no-opportunity state
- [ ] No recommendation appears when no live data was acquired
- [ ] Disconnecting the network mid-session shows a degraded state, and
      previously acquired data is retained rather than wiped
- [ ] Reconnecting recovers without a manual reload
- [ ] Deep links to a specific instrument resolve correctly
- [ ] Layout is usable at mobile width
- [ ] Light/dark follows the system setting

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
