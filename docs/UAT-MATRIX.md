# Phase 173 — Manual Production UAT Matrix

**Xstarz Analysis** · executable browser test matrix
Last updated: Phase 177 (2026-09-11).

---

## How to use this document

Every row is one test. Execute them in order within a section — later rows
sometimes depend on the state left by earlier ones.

Fill in the **Result** column with exactly one of:

| Value | Meaning |
| --- | --- |
| `PASS` | Executed in a browser and the expected result was observed. |
| `FAIL` | Executed and the failure condition was observed. Record what you saw. |
| `BLOCKED` | Could not execute — prerequisite unavailable (no Convex deployment, no live provider, no credentials). Not a pass and not a failure. |

> **Nothing in this file is pre-filled as PASS.** The agent that produced this
> matrix cannot operate a browser. Every row below is unexecuted until a human
> runs it. Rows already covered by automated tests are marked in the
> **Coverage** column, but automated coverage is *not* a browser pass — it only
> narrows what manual execution has to catch.

### Coverage legend

| Tag | Meaning |
| --- | --- |
| `AUTO` | Behaviour is asserted by the automated suite. Manual run confirms it in a real browser. |
| `HUMAN` | Requires human browser interaction. No automated equivalent exists. |
| `EXT-BLOCKED` | Requires live external provider access or a deployed Convex backend. Cannot pass in the sandbox; may be executable in your environment. |

---

## 0. Environment prerequisites

Record these before starting — several sections are meaningless without them.

| # | Prerequisite | How to confirm | Required for |
| --- | --- | --- | --- |
| P1 | `.env.local` exists with a real `VITE_CONVEX_URL` | File present; value is a `https://*.convex.cloud` URL | §3, §4, §9, §10 |
| P2 | Convex backend deployed and reachable | `npx convex dev` connects without error | §3, §4, §9, §10 |
| P3 | Email OTP delivery works | A test sign-in email actually arrives | §3 |
| P4 | Outbound network to OKX (`www.okx.com`) is permitted | `curl -sS -o /dev/null -w '%{http_code}' https://www.okx.com/api/v5/public/instruments?instType=SPOT` returns `200` | §5, §6, §7, §8 |
| P5 | App is running | `npm run dev` (or a production preview of `npm run build`) | all |

> **Sandbox status:** P1–P4 are **not satisfied** in the agent sandbox. No
> Convex URL is configured, and OKX/CoinGecko are firewalled. Every row
> depending on them is therefore `EXT-BLOCKED` here and must be executed in an
> environment where they hold.

**Run the matrix twice** against a production build (`npm run build && npx vite preview`),
once on desktop and once on mobile, unless a row says otherwise.

---

## 1. Public routes and shell

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | P5 | Open `/` | Landing page renders. Brand reads **"Xstarz Analysis"**. | Blank page, console error, or any other brand name. | AUTO | ☐ |
| 1.2 | P5 | Search the page (Ctrl+F) for `Gilfan`, `freebuff`, `vly` | Zero matches in visible text. | Any internal/legacy brand visible. | AUTO | ☐ |
| 1.3 | P5 | Open browser devtools → Console, reload `/` | No uncaught errors, no React key/hydration warnings. | Any uncaught exception. | HUMAN | ☐ |
| 1.4 | P5 | Check the tab title | Reads `Xstarz Analysis`. | Default Vite title or stale brand. | AUTO | ☐ |
| 1.5 | P5 | Open `/nonexistent-route-xyz` | 404 page renders; heading and body text are **clearly readable** against the dark background. | Text invisible/near-black on dark (regression of the Phase 173 contrast fix), or blank page. | AUTO | ☐ |
| 1.6 | P5 | On `/`, click **Sign In** / **Get Started** | Navigates to `/auth`. | Stays on `/` or 404s. | HUMAN | ☐ |

## 2. BrowserRouter deep-links and hard refresh

These specifically verify the Phase 169 `BrowserRouter` + `_redirects` work.
**Run this section against a production build/deployment, not only the dev
server** — the dev server rewrites unknown paths automatically, so it can hide
a hosting misconfiguration.

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | P5 | Type `/auth` directly in the address bar, press Enter | Auth page renders. URL stays `/auth`. | Server 404 / "Cannot GET /auth". | EXT-BLOCKED (needs deployment) | ☐ |
| 2.2 | P5 | Hard-refresh (Ctrl+Shift+R) while on `/auth` | Same page re-renders, URL unchanged. | 404 or redirect to `/`. | EXT-BLOCKED | ☐ |
| 2.3 | P1,P2,P5 | Sign in, go to `/dashboard`, hard-refresh | Dashboard re-renders after a brief `restoring session...` state. URL stays `/dashboard`. | 404, or bounce to `/auth` despite a valid session. | EXT-BLOCKED | ☐ |
| 2.4 | P1,P2,P5 | Same for `/journal` | Journal re-renders, URL stays `/journal`. | 404 or unexpected redirect. | EXT-BLOCKED | ☐ |
| 2.5 | P5 | Use browser **Back** and **Forward** across `/` → `/auth` → `/dashboard` | Navigation is correct at each step; no duplicated history entries. | Back button traps the user or skips entries. | HUMAN | ☐ |
| 2.6 | P5 | Visit `/auth?returnTo=%2Fjournal` | After sign-in, lands on `/journal`. | Lands somewhere else. | AUTO (redirect validation) | ☐ |
| 2.7 | P5 | Visit `/auth?returnTo=https%3A%2F%2Fevil.example.com` | Open redirect is **rejected**; lands on `/dashboard`. | Browser navigates to the external origin. | AUTO | ☐ |
| 2.8 | P5 | Visit `/auth?returnTo=%2F%2Fevil.example.com` | Rejected; lands on `/dashboard`. | External navigation. | AUTO | ☐ |

## 3. Sign-in and session persistence

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 | P1–P3,P5 | On `/auth`, submit a valid email | Advances to "Check your email"; the address is echoed back. | Stays on step 1, or a silent failure with no message. | EXT-BLOCKED | ☐ |
| 3.2 | P1–P3,P5 | Enter the emailed OTP | Signs in and lands on `/dashboard`. | Rejects a valid code, or hangs on a spinner. | EXT-BLOCKED | ☐ |
| 3.3 | P1–P3,P5 | Enter a deliberately wrong OTP | Clear error; user stays on the OTP step; can retry. | Silent failure, or being signed in anyway. | EXT-BLOCKED | ☐ |
| 3.4 | 3.2 | Close the tab, reopen the app at `/dashboard` | Session persists; dashboard renders without re-authenticating. | Forced re-login every visit. | EXT-BLOCKED | ☐ |
| 3.5 | 3.2 | Hard-refresh `/dashboard` and watch closely | A stable `restoring session...` state appears, then content. | White flash, or a flicker to `/auth` before settling. | EXT-BLOCKED | ☐ |
| 3.6 | P1,P2,P5 | Sign out, then press **Back** | Does **not** return to an authenticated dashboard view. | Protected content visible after sign-out. | HUMAN | ☐ |
| 3.7 | P1,P2,P5 | On `/auth`, click **Continue as Guest** | Signs in anonymously and reaches the dashboard. | Error, or indistinguishable from a full account. | EXT-BLOCKED | ☐ |

## 4. Protected routes and logout

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1 | P5, signed out | Open `/dashboard` directly | Redirected to `/auth?returnTo=%2Fdashboard`. | Dashboard renders for an unauthenticated visitor. | AUTO | ☐ |
| 4.2 | P5, signed out | Open `/journal` directly | Redirected to `/auth?returnTo=%2Fjournal`. | Journal renders unauthenticated. | AUTO | ☐ |
| 4.3 | 4.1 | Complete sign-in from that redirect | Lands back on `/dashboard` (the original target). | Lands on `/` or ignores `returnTo`. | EXT-BLOCKED | ☐ |
| 4.4 | signed in | Sign out via the logo dropdown | Returns to a public route; protected content no longer reachable. | Stale authenticated UI persists. | HUMAN | ☐ |
| 4.5 | 4.4 | Open devtools → Application → clear cookies/storage, reload | Treated as signed out. | Session survives a full storage clear. | HUMAN | ☐ |
| 4.6 | two accounts | Sign in as A, note journal entries; sign out; sign in as B | B sees **only** B's data. No trace of A. | Any cross-account leakage. **Stop and report immediately.** | EXT-BLOCKED | ☐ |

## 5. Discovery cycle and instrument identity

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 5.1 | P4, signed in | Load the dashboard, watch the Market Opportunities panel | A discovery cycle runs on mount; a scan summary appears (`N scanned · M with live data · Xms`). | Panel never leaves the scanning state. | EXT-BLOCKED | ☐ |
| 5.2 | 5.1 | Read the instrument symbols in the ranked list | Symbols are **exactly** OKX provider-native ids (e.g. `BTC-USDT`, `BTC-USDT-SWAP`). | Any rewritten/canonicalised symbol (`BTC/USD`, `BTCUSD`) — a substitution defect. **Stop and report.** | AUTO | ☐ |
| 5.3 | 5.1 | Cross-check one symbol against `https://www.okx.com/api/v5/public/instruments?instType=SPOT` | The displayed `instId` exists verbatim in the provider response. | Displayed instrument not present upstream. | EXT-BLOCKED | ☐ |
| 5.4 | 5.1 | Click the refresh icon in the panel header | A new cycle runs; timestamp updates. | Nothing happens, or the button is missing. | AUTO | ☐ |
| 5.5 | 5.1 | Refresh several times, watching which instruments appear | The rotating batch covers different instruments over successive cycles — not a fixed hardcoded set. | The same small set forever, implying a hidden whitelist. | AUTO | ☐ |
| 5.6 | 5.1 | Confirm no instrument is silently dropped | Instruments removed from ranking appear under **Show excluded** with a stated reason. | Instruments vanish with no accounting. | AUTO | ☐ |

## 6. Live / degraded / empty provider states

The core integrity requirement: **a provider outage must never look like a
calm market.**

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 6.1 | P4, signed in | Normal conditions — inspect freshness badges | Each ranked row carries an explicit `FRESH` / `DELAYED` / `STALE` / `UNAVAILABLE` badge. | Missing badge, or freshness implied only by colour. | AUTO | ☐ |
| 6.2 | 6.1 | Devtools → Network → set **Offline**, then click refresh | The panel reports a **degraded** state. Provider failures are surfaced, not swallowed. | Renders as a normal empty result — i.e. an outage disguised as "no opportunities". **This is the Phase 172 defect; report if seen.** | AUTO | ☐ |
| 6.3 | 6.2 | While offline, read the opportunity list | Either previously retained data clearly marked stale, or an explicit unavailable state. Never fabricated prices. | Any confident-looking price/confidence with no live source. **Stop and report.** | AUTO | ☐ |
| 6.4 | 6.2 | Confirm the refresh control is still present while degraded | Refresh is available so the user can recover. | No retry affordance — the user is stuck until a manual page reload. (Phase 173 fix.) | AUTO | ☐ |
| 6.5 | 6.4 | Set Network back to **Online**, click refresh | The cycle succeeds; degraded indication clears; fresh data appears. | Stuck degraded after connectivity returns. | EXT-BLOCKED | ☐ |
| 6.6 | 6.5 | Compare the pre-outage and post-recovery instrument identities | Identity preserved exactly across the outage. | Instruments silently swapped during recovery. | AUTO | ☐ |
| 6.7 | P4 | Use devtools request blocking on `www.okx.com` only, then refresh | Only OKX-derived data degrades; unrelated panels keep working. | Whole app breaks on one provider failing. | HUMAN | ☐ |
| 6.8 | 6.2 | Throttle to "Slow 3G" and refresh | A scanning/loading state is shown; UI stays responsive; no duplicate submissions. | Frozen UI or a permanent spinner. | HUMAN | ☐ |

## 7. Ranking, opportunities, and decision surfaces

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 7.1 | 5.1 | Inspect a ranked opportunity card | Shows score, confidence, supporting/conflicting evidence, risks, invalidation conditions. | Any bare recommendation with no evidence trail. | AUTO | ☐ |
| 7.2 | 7.1 | Read the disclaimer text in the panel | States rankings are analytical and **not guaranteed profit predictions**. | Missing disclaimer, or any "guaranteed profit" phrasing. **Stop and report.** | AUTO | ☐ |
| 7.3 | 7.1 | Read the confidence note | Explains confidence reflects analytical coherence, **not** probability of profit. | Confidence presented as a win rate. | AUTO | ☐ |
| 7.4 | 7.1 | Click **why this asset?** | Expands a per-instrument evidence breakdown. | No explanation available. | HUMAN | ☐ |
| 7.5 | 7.1 | Toggle **Show excluded** | Lists excluded instruments each with a reason (e.g. `price unavailable`). | Empty or reasonless list. | AUTO | ☐ |
| 7.6 | 7.1 | Switch horizon (Intraday / Swing / longer) | Ranking recomputes for that horizon; labels update. | Identical output across all horizons. | HUMAN | ☐ |
| 7.7 | 7.1 | Switch asset-class and region filters | List filters accordingly; empty combinations state so explicitly. | Silent empty panel with no explanation. | HUMAN | ☐ |
| 7.8 | 7.1 | Verify no execution controls exist anywhere | There is **no** buy/sell/execute/broker-connect control. Decision support only. | Any order-placement affordance. **Stop and report.** | AUTO | ☐ |

## 8. WAIT / NO_TRADE and data disclosure

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 8.1 | 5.1 | Find a horizon/filter with weak evidence | Shows **"No Clear Opportunity"** with the hint that evidence does not support a strong ranking. | A recommendation forced out of weak evidence. | AUTO | ☐ |
| 8.2 | signed in | Run an analysis that resolves to WAIT or NO_TRADE | The verdict is displayed plainly as **Wait** / **No Trade**. | Coerced into BUY/SELL, or hidden entirely. | AUTO | ☐ |
| 8.3 | 8.2 | Check the WAIT/NO_TRADE card | Carries its own reasoning, same as a directional call. | Presented as an error or an empty state. | AUTO | ☐ |
| 8.4 | 6.3 | Trigger stale data (offline, then read retained values) | Explicit stale warning: market data is stale and evidence may not reflect current conditions. | Stale values shown as current. **Stop and report.** | AUTO | ☐ |
| 8.5 | 8.4 | Look for the retained-source note | Retained previous data is labelled as such (e.g. "previous data retained"). | Silently reused old data. | AUTO | ☐ |
| 8.6 | 5.1 | Check timestamps on data-bearing panels | Each shows when it was last updated. | Undated numbers. | AUTO | ☐ |
| 8.7 | signed in | Open a historical/timeline view | Clearly separated from live data; never labelled current. | History rendered as live. | AUTO | ☐ |

## 9. Entitlement (guest / free-signal limit / Premium)

> **Updated in Phase 174.** Entitlement is now wired to the UI *and* enforced
> at a server-side delivery boundary: `runAnalysis` executes inside the Convex
> action `protectedAnalysis.runProtectedAnalysis`, and an unentitled client
> never receives the directional payload. Rows 9.5–9.10 are now executable in a
> browser. Rows 9.1–9.4 remain server-observable via the Convex dashboard.

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 9.1 | P1,P2 | Call `getMyEntitlement` unauthenticated (Convex dashboard) | Returns `reason: "UNAUTHENTICATED"`. No DB row created. | Creates a row, or grants access. | AUTO | ☐ |
| 9.2 | P1,P2, signed in | Call `consumeProfitSignal` with a `BUY` recommendation 3× | First two → `CONSUMED`; third → `FREE_ALLOWANCE_EXHAUSTED`. | A third free profit signal is granted. | AUTO | ☐ |
| 9.3 | P1,P2 | Call it with `WAIT` / `NO_TRADE` | `NOT_CHARGEABLE` — never consumes allowance. | Non-directional output burns quota. | AUTO | ☐ |
| 9.4 | 9.2 | After exhaustion, reload the app and clear `localStorage` | Limit still enforced — it is **server-side**. | Reload or storage reset restores free signals. **Stop and report.** | AUTO | ☐ |
| 9.5 | signed in | Look at the dashboard header | A **Trial** badge shows the remaining free signals, matching the server. | No badge, or a count that disagrees with the DB row. | AUTO | ☐ |
| 9.6 | 9.5 | Run analyses until a directional result is produced twice | The counter decrements only on directional results. | WAIT/NO_TRADE decrements it. | AUTO | ☐ |
| 9.7 | 9.6 | Run one more analysis that produces a directional result | An explicit **"Actionable signal locked"** panel appears, stating it is *not* a Wait/No-Trade verdict, with an inert upgrade button and no price. | A WAIT is shown instead, or a price appears. **Stop and report.** | AUTO | ☐ |
| 9.8 | 9.7 | With the lock showing, open devtools → Network → inspect the `runProtectedAnalysis` response body | The response contains **no** `recommendation`, `tradePlan`, `conviction`, `bias` or `positionSizing` — only the locked stub. | Any directional field present in the payload. **Critical row — stop and report.** | AUTO | ☐ |
| 9.9 | 9.7 | Still exhausted, run an analysis that resolves to NO_TRADE | Delivered in full with its reasoning; the counter does not move. | Locked, or charged. | AUTO | ☐ |
| 9.10 | 9.7 | In the console, call the consume mutation directly claiming `WAIT` | No directional result is obtainable by any client call. | A directional payload is obtainable. **Stop and report.** | AUTO | ☐ |
| 9.11 | P1,P2, signed in | In devtools, intercept the `runProtectedAnalysis` request and replace `input.marketData.price.price` with `99999` | The returned decision uses the **real** provider price, not 99999. | The forged price appears in the result. **Stop and report.** | AUTO | ☐ |
| 9.12 | 9.11 | Intercept and flip `input.technicalData.structure` to the opposite (`HH/HL` ↔ `LH/LL`) | The verdict is unchanged — the server re-acquires its own technicals. | The direction flips. **Stop and report.** | AUTO | ☐ |
| 9.13 | 9.11 | Intercept and set `input.marketData.provider` to a different provider name | `dataSource` in the result reports the **real** acquiring provider. | The forged provider name is echoed back. | AUTO | ☐ |
| 9.14 | 9.11 | Intercept and back-date all candles ~30 days while setting `dataFreshness: "realtime"` | Freshness/quality reflect the server's own acquisition, not the client's claim. | Stale data reported as fresh/full. **Stop and report.** | AUTO | ☐ |
| 9.15 | P4 offline | Block the market-data provider, then run an analysis | Explicit degradation (no trade plan, reduced completeness). No fabricated price or invented decision. | A confident decision with no live data. **Stop and report.** | AUTO | ☐ |
| 9.16 | 9.11 | Intercept and inject `input.economicEvents = "dovish, rate cut, easing"` on a setup that returns a directional signal | The verdict is unchanged — the field is stripped server-side. | The signal flips or becomes NO_TRADE. **Stop and report.** | AUTO | ☐ |
| 9.17 | 9.11 | Intercept and inject `input.newsContext = "fear panic capitulation"` | Confidence is unchanged. | Confidence moves. **Stop and report.** | AUTO | ☐ |
| 9.18 | 9.11 | Intercept and inject a forged `input.instrumentSpec` with `contractSize: 1, quantityStep: 0.00000001` | Position sizing is unchanged (spec comes from the provider). | Sizing quantity changes. **Stop and report.** | AUTO | ☐ |
| 9.19 | P2, crypto instrument | Run an analysis on `BTC-USDT-SWAP` and inspect the Convex logs | Every provider action receives the instrument id byte-for-byte. | Any canonicalisation or substitution. **Stop and report.** | AUTO | ☐ |
| 9.20 | P2 | Run an analysis while one secondary provider key is unset | Analysis completes; that provider's context is absent and disclosed, not defaulted. | A fabricated/default value appears. **Stop and report.** | AUTO | ☐ |
| 9.21 | P2 | Time a full analysis and compare against the pre-176 baseline | Latency is comparable — providers are fetched in one parallel wave. | Latency grows roughly with provider count (serialized). | AUTO | ☐ |
| 9.22 | P2 | In the Convex dashboard, block/deconfigure one secondary provider and run an analysis | Analysis completes within ~15s; that provider is reported unavailable, others unaffected. | The analysis hangs or all providers fail together. **Stop and report.** | AUTO | ☐ |
| 9.23 | P2 | Inspect the Convex logs for the `fanout ...` summary line after an analysis | Each provider shows status + duration; no API key or token appears. | Any credential fragment in logs. **Stop and report.** | AUTO | ☐ |
| 9.24 | P2 | Compare logged per-provider durations against the Phase 177 budget table | Observed durations sit inside their budgets; re-tune if not. | A provider routinely hits its budget (mis-sized). | AUTO | ☐ |
| 9.25 | P2 | Trigger an Alpha Vantage rate limit (repeat analyses quickly) | Leg reports rate-limited; it is NOT retried; other providers still return. | Retry storm, or the rate limit changes the verdict. **Stop and report.** | AUTO | ☐ |
| 9.26 | P2, crypto | Run an analysis while OKX is unreachable | Sizing reports specification unavailable; no fabricated contract values. | Invented contractSize/quantityStep. **Stop and report.** | AUTO | ☐ |

## 10. Journal, positions, and protection lifecycle

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 10.1 | signed in | Open `/journal` | Renders the current user's entries only. | Another user's data, or a crash. | EXT-BLOCKED | ☐ |
| 10.2 | 10.1 | Register a position, then reload | Position persists with the values entered. | Lost or altered on reload. | EXT-BLOCKED | ☐ |
| 10.3 | 10.2 | Inspect the protection panel | Shows real protection state for the real position. | A phantom position that was never registered. **Stop and report.** | AUTO | ☐ |
| 10.4 | 10.2 | Check PnL figures | Derived from actual entry/current price, or explicitly unavailable. | Invented PnL when price data is missing. **Stop and report.** | AUTO | ☐ |
| 10.5 | 10.2 | Check the alert centre | Alerts correspond to real state changes and carry timestamps. | Fabricated alerts, or a stale alert presented as current. | AUTO | ☐ |
| 10.6 | 10.2 | Go offline, reload, inspect protection | Degraded/unavailable stated explicitly; monitoring limits disclosed. | Confident protection status with no live data. | AUTO | ☐ |

## 11. Responsive layout and mobile

Test at 320px (narrow), 375px, 768px (tablet), 1280px, 1920px. Use devtools
device emulation **and** at least one real phone.

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 11.1 | P5 | Load `/` at 320px wide | No horizontal scrollbar; nothing clipped. | Content overflows the viewport. | HUMAN | ☐ |
| 11.2 | signed in | Dashboard at 375px | Panels stack readably; tabs remain reachable. | Overlap, or unreachable controls. | HUMAN | ☐ |
| 11.3 | signed in | Opportunity cards at 375px | Symbols, badges, scores all legible and untruncated to the point of ambiguity. | Text clipped so a value is unreadable. | HUMAN | ☐ |
| 11.4 | signed in | Dashboard at 768px | Tablet layout is coherent — neither a stretched phone nor a cramped desktop. | Broken intermediate layout. | HUMAN | ☐ |
| 11.5 | P5 | Rotate a real phone portrait ↔ landscape | Layout reflows cleanly; no state lost. | Blank regions or a crash. | HUMAN | ☐ |
| 11.6 | P5 | Tap targets on a real phone | Buttons/dropdowns are comfortably tappable. | Targets too small or overlapping. | HUMAN | ☐ |
| 11.7 | signed in | Switch to a long-label locale (e.g. Deutsch), re-check 320px | Long labels wrap or truncate gracefully; no layout break. | Overflow or overlap. | HUMAN | ☐ |

## 12. Theme, locale, and accessibility

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 12.1 | P5 | Set the OS/browser to **light** mode, reload | *Known limitation:* the app renders **dark regardless**. `index.html` hardcodes `class="dark"`, the `.dark` block is empty, and `:root` holds the dark palette. Record `FAIL` if you consider system-following a release requirement, else `BLOCKED — by design, pending decision`. | — (see §13 finding F3) | HUMAN | ☐ |
| 12.2 | P5 | Set OS to **dark**, reload | Dark theme renders correctly; all text legible. | Contrast failures. | HUMAN | ☐ |
| 12.3 | signed in | Switch locale via the dashboard dropdown | UI switches language immediately. | Untranslated strings, or a crash. | AUTO | ☐ |
| 12.4 | 12.3 | Inspect `<html lang="…">` in devtools | Matches the selected locale (`ja`, `de`, …). | Stuck at `en` for every locale. (Phase 173 fix — WCAG 3.1.1.) | AUTO | ☐ |
| 12.5 | 12.3 | Reload after switching | Locale choice persists. | Resets to default. | AUTO | ☐ |
| 12.6 | 12.3 | Walk all 9 locales, scanning key screens | No raw keys (`marketPanel.title`), no obvious untranslated English. | Placeholder keys visible. | AUTO (leaf-count parity) | ☐ |
| 12.7 | P5 | Navigate the app using **Tab** only | Focus order is logical; focus is always visible. | Keyboard traps, or invisible focus. | HUMAN | ☐ |
| 12.8 | signed in | Find every status conveyed by colour (freshness, degraded, direction) | Each also carries text or an icon. | Colour is the only carrier. | AUTO | ☐ |
| 12.9 | P5 | Run Lighthouse → Accessibility on `/` and `/dashboard` | No critical contrast/ARIA violations. | Critical violations. | HUMAN | ☐ |
| 12.10 | P5 | Zoom the browser to 200% | Content remains usable. | Layout collapses. | HUMAN | ☐ |

## 13. Security and disclosure spot-checks

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 13.1 | P5 | Devtools → Sources, search the bundle for `sk_`, `api_key`, `Bearer ` | No credential literals. | Any secret in client code. **Stop and report.** | AUTO | ☐ |
| 13.2 | P5 | Devtools → Network, inspect request payloads | No credentials in query strings. | Secrets on the wire from the client. | HUMAN | ☐ |
| 13.3 | P5 | Trigger a provider failure (offline) and read any error text | Errors are user-facing and generic; no stack traces, no config dumps. | Internal details or credentials in an error. | AUTO | ☐ |
| 13.4 | P5 | Confirm the dev toolbar is absent in production | No Vly toolbar overlay in a production build. | Dev tooling shipped to users. | AUTO | ☐ |
| 13.5 | signed in | Inspect `localStorage` | Only non-sensitive keys (e.g. `xstarz:locale`). No tokens/PII beyond the auth library's own session. | Sensitive data in plain storage. | HUMAN | ☐ |

---

## 13A. Provider cache, quota and freshness (Phase 178)

These rows exist to catch the failure mode that unit tests cannot fully prove:
a cache that quietly presents **old data as current**. Watch the displayed
timestamps and freshness labels, not just the numbers.

| # | Prereq | Action | Expected result | Failure condition | Coverage | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 13A.1 | signed in | Run an analysis, then press refresh 5× in ~30 s | Repeated runs stay responsive; the displayed observation time does **not** jump forward on every press. | Observation time resets to "now" on each refresh while no new provider data was fetched. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.2 | signed in | Analyse the same instrument 3× in a row | Later runs return noticeably faster (cache hits), and the evidence age **increases** across runs. | Evidence age resets to zero, or the age is not shown. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.3 | 2 browsers/users | Start two analyses of the same instrument simultaneously | Both complete; neither shows the other's account equity, risk percent, or position size. | Any personalised value leaking between sessions. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.4 | signed in | Analyse an instrument, wait past its dataset TTL (e.g. >20 min for calendar), analyse again | A real re-acquisition occurs; the observation time advances only now. | Data older than its TTL still presented as current. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.5 | signed in | Run an analysis, then take a provider offline and re-run within TTL | Cached evidence may be reused, but it is labelled with its true age — never as live/fresh. | Cached data shown as "live" during a provider outage. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.6 | signed in | Continue from 13A.5 until the TTL expires while the provider is still down | The affected evidence degrades to unavailable/stale; the decision degrades gracefully; no fabricated values. | Expired cache silently reused, or invented data. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.7 | signed in | Analyse `BTC/USDT`, then immediately analyse `BTC/USD` | The two return **different** derivatives evidence (different quote currency). | Identical funding/OI for both — a cache-key collision. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.8 | signed in | Analyse the same pair on H1, then on H4 | Timeframe-specific candles differ; no cross-timeframe reuse. | Identical candle data across timeframes. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.9 | signed in | Analyse the same ticker symbol as a crypto and as an equity (e.g. `BTC/USD` then a `BTC` stock) | Each returns its own asset class's news; no cross-class reuse. | Crypto news shown for the equity or vice versa. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.10 | signed in | After any cached analysis, read the displayed observation/"as of" time | It shows the ORIGINAL provider observation time, not the moment of the refresh. | Observation time equals the refresh time on a cache hit. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.11 | signed in | Force a stale cached response (wait past the fresh window, stay inside TTL) | Evidence is shown with its true age and is **not** labelled LIVE/FRESH. | Stale cached data presented as live. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.12 | signed in | Trigger a provider 429, then re-run the analysis | The 429 is not retained; the retry reaches the provider and can succeed. | Rate-limit response cached and replayed as evidence. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.13 | two users | User A runs an analysis with account equity set; User B analyses the same instrument | B sees the same public market evidence but none of A's equity/risk/currency or position size. | Any personalised value crossing users. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.14 | signed in | Compare a cold analysis against an immediate repeat | The repeat is faster and the recommendation is unchanged. | The verdict changes purely because data came from cache. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.15 | P2, crypto scalping | Run the same crypto scalping analysis twice in quick succession | The order book is re-observed both times (spread/depth may differ); it is **never** served from cache. | Identical order-book snapshot reused across runs. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.16 | P2, crypto | Run two crypto analyses several minutes apart | The contract specification (contract size / tick size) is reused; only the book is re-fetched. | Contract metadata re-fetched every run, or a spec change never picked up within 24 h. | EXT-BLOCKED | ☐ |
| 13A.17 | P2, commodity (WTI) | Analyse an oil instrument twice within an hour | EIA inventory context is reused and shows its true weekly observation date. | The EIA observation date advances on reuse. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.18 | P2, forex | Analyse a major FX pair twice within an hour | COT positioning is reused and still shows the real CFTC report date (a Tuesday). | The report date changes on reuse, or a weeks-old report is labelled FRESH. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.19 | P2, forex | Analyse twice within an hour and read the Treasury yield context | The yield curve is reused and shows its real observation date. | Yield observation date advances without a new publication. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.20 | signed in | Leave the app idle past a dataset TTL (e.g. >6 h for Treasury), then analyse | A real re-acquisition occurs and the observation date updates only if the provider published. | Expired data silently reused, or a fabricated newer date. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.21 | P2, crypto | Take OKX offline, then run a crypto analysis | Order-book evidence reports unavailable; sizing/veto degrade explicitly; no stale book is substituted. | A previous book snapshot reused during the outage. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.22 | deployment logs | Run one analysis and read the server logs | One `provider/dataset = mode(age, used)` line per leg, plus a `totals:` line. | Missing provenance lines, or a mode absent from the eight defined values. | EXT-BLOCKED | ☐ |
| 13A.23 | deployment logs | Run the same analysis twice and compare the log lines | Cold shows `observed-now`; warm shows `cache-reused` with a **larger** age. | Warm run still reports `observed-now`, or the age resets. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.24 | deployment logs | Trigger two simultaneous identical analyses | Some legs report `observed-shared`; the totals show fewer requests caused than legs. | A concurrent join reported as `cache-reused` (it was a real provider call). **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.25 | deployment logs, crypto | Run any crypto analysis repeatedly | `okx-order-book` reports `uncached-by-design` **every** time. | The order book ever reports `cache-reused`. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.26 | deployment logs | Take one provider offline and run an analysis | That leg reports `unavailable`/`timed-out`/`rate-limited` with **no** age figure. | A failed leg carries an observation age, or claims an observation. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.27 | deployment logs | Run an analysis with account equity and risk percent set | No log line contains the equity value, risk percent, currency, user id, or any key-shaped string. | Any credential or personalised value in diagnostics. **Stop and report.** | EXT-BLOCKED | ☐ |
| 13A.28 | deployment logs | Compare `totals:` across a cold and a warm run | Warm reports strictly fewer provider requests caused. | Warm equals cold despite cache hits being logged. | EXT-BLOCKED | ☐ |

**Why EXT-BLOCKED:** every provider host is firewalled in the build
environment, so no cache row can be executed here. Quota reduction is verified
structurally (call counts under test), never as an observed billing delta.

---

## 14. Findings raised while building this matrix

Four defects were found and three were fixed while grounding these steps in
real observable behaviour.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | Refresh control was gated on `liveSources.length > 0`, so the empty state produced by a failed first discovery cycle had **no retry affordance**. With no polling interval, the only escape was a manual page reload — and the state read as "no opportunities" rather than "retry available". | High — blocks outage recovery (row 6.4) | **Fixed** — handler always passed; 6 regression tests. |
| F2 | `<html lang>` never followed the active locale. `index.html` hardcodes `lang="en"`, so all 9 locales were announced to screen readers as English and indexed as English. WCAG 3.1.1 failure. | Medium — accessibility | **Fixed** — provider syncs `documentElement.lang`; 11 regression tests. |
| F3 | Light mode does not exist. `index.html` hardcodes `class="dark"`, the `.dark` CSS block is empty, and `:root` carries the dark palette. "Light/dark follows system" is therefore unimplemented. | Medium — stated requirement unmet | **Open — documented, not fixed.** Implementing it means authoring and reviewing a full second palette; that is a design decision, not a bug fix. Row 12.1 records it. |
| F4 | The 404 page used `text-gray-900` / `text-gray-600` on the dark background (`oklch(0.1)`), rendering near-black on near-black — effectively invisible. | Medium — unreadable page | **Fixed** — now uses `text-foreground` / `text-muted-foreground`. |

---

## 16. Mobile packaging — Android & iOS (Phase 179)

Capacitor wraps the SAME web build on both platforms, so analysis, entitlement,
provenance and route protection are shared code and cannot diverge by design.
These rows verify the WRAPPER, not the engine.

**Status legend for this section**
- `HUMAN` — needs a physical Android device. The agent cannot drive one.
- `BLOCKED` — cannot be executed at all in this environment. Android release
  build and every iOS row are blocked: this sandbox is Linux with **no JDK,
  no Android SDK, no macOS, no Xcode**, and the developer has **no iPhone**.

**No mobile row below has been executed. Nothing here is claimed as PASS.**

### Android

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 14A.1 | APK installed | Install the debug APK on an Android device | Installs as "Xstarz Analysis" with the blue chart launcher icon; no Capacitor branding. | Default Capacitor icon, wrong name, or install failure. | HUMAN | ☐ |
| 14A.2 | app installed | Cold launch from the launcher | Splash shows, then the landing page. No white flash, no blank screen. | Blank/white screen — usually an asset-path failure. | HUMAN | ☐ |
| 14A.3 | app open | Navigate to /auth and request an OTP | OTP arrives and sign-in completes. | No email, or auth silently fails. | HUMAN | ☐ |
| 14A.4 | signed in | Force-quit and relaunch | Session persists; user lands authenticated. | Session lost on every cold start. | HUMAN | ☐ |
| 14A.5 | signed in | Open the dashboard and run one analysis | Analysis returns from the SERVER; evidence shows provider provenance. | Any provider called directly from the device. | HUMAN | ☐ |
| 14A.6 | signed in | Open the journal | Journal loads and entries persist. | Route 404s inside the shell. | HUMAN | ☐ |
| 14A.7 | guest | Consume both free profit signals, request a third | Entitlement lock shows upgrade prompt; no third signal. | A third chargeable signal is delivered. | HUMAN | ☐ |
| 14A.8 | signed out | Tap an https://<host>/dashboard link | App opens and redirects to /auth (route guard intact). | Deep link renders the dashboard while signed out. **Stop and report.** | HUMAN | ☐ |
| 14A.9 | signed in | Tap an https://<host>/journal link | App opens directly on the journal. | Link opens the browser instead, or lands on the landing page. | HUMAN | ☐ |
| 14A.10 | app open | Enable airplane mode, then run an analysis | Explicit unavailable/degraded state; no price, no direction, no fabricated freshness. | Any cached or invented value shown as live. **Stop and report.** | HUMAN | ☐ |
| 14A.11 | offline state | Restore connectivity and retry | Analysis recovers and reports a NEW observation. | Stale evidence reported as newly observed. | HUMAN | ☐ |
| 14A.12 | app open | Background the app 5 minutes, then foreground | Session and route restored; no forced reload to landing. | App restarts into a logged-out state. | HUMAN | ☐ |
| 14A.13 | signed in | Press hardware BACK on /dashboard with no history | App stays open (backs within the app), does not exit. | App exits from an interior route. | HUMAN | ☐ |
| 14A.14 | signed in | Press hardware BACK on the landing page | App exits cleanly. | App traps the user. | HUMAN | ☐ |
| 14A.15 | signed in | Log out | Session cleared; protected routes redirect to /auth. | Protected route still renders after logout. **Stop and report.** | HUMAN | ☐ |
| 14A.16 | installed | Uninstall, reinstall, launch | Starts signed out; no session survives reinstall. | A session survives reinstall. | HUMAN | ☐ |
| 14A.17 | release build | Inspect the release APK/AAB | No provider key, no localhost, no debug flag, one permission (INTERNET). | Any secret, dev endpoint, or extra permission. **Stop and report.** | BLOCKED | ☐ |
| 14A.18 | toolchain | Build the debug APK (`./gradlew assembleDebug`) | APK produced. | Build failure. | BLOCKED | ☐ |

### iOS

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 14I.1 | IPA installed | Install on an iPhone | Installs as "Xstarz Analysis" with the correct icon. | Wrong icon/name or install failure. | BLOCKED | ☐ |
| 14I.2 | app installed | Cold launch | Splash then landing page; content clears the notch and home indicator. | Content under the notch, or a blank screen. | BLOCKED | ☐ |
| 14I.3 | app open | Sign in via OTP | Sign-in completes. | Auth fails inside the WKWebView. | BLOCKED | ☐ |
| 14I.4 | signed in | Force-quit and relaunch | Session persists. | Session lost every launch. | BLOCKED | ☐ |
| 14I.5 | signed in | Run one analysis | Server-side analysis with provenance. | Any direct provider call from the device. | BLOCKED | ☐ |
| 14I.6 | signed in | Open the journal | Journal loads. | Route fails inside the shell. | BLOCKED | ☐ |
| 14I.7 | guest | Exhaust the free signals | Entitlement lock identical to Android and web. | Divergent entitlement behaviour. | BLOCKED | ☐ |
| 14I.8 | signed out | Tap a universal link to /dashboard | Redirects to /auth. | Dashboard renders while signed out. **Stop and report.** | BLOCKED | ☐ |
| 14I.9 | signed in | Tap a universal link to /journal | Opens the journal in-app. | Opens Safari instead (association not verified). | BLOCKED | ☐ |
| 14I.10 | app open | Enable airplane mode and run an analysis | Explicit degraded state; nothing fabricated. | Fabricated price/freshness. **Stop and report.** | BLOCKED | ☐ |
| 14I.11 | offline | Restore connectivity and retry | Recovers with a new observation. | Stale data labelled live. | BLOCKED | ☐ |
| 14I.12 | app open | Background then foreground | Session and route restored. | Forced restart to landing. | BLOCKED | ☐ |
| 14I.13 | signed in | Focus a text input | Keyboard does not cover the field; no viewport auto-zoom. | Input hidden behind the keyboard, or the page zooms. | BLOCKED | ☐ |
| 14I.14 | signed in | Log out | Session cleared; protected routes redirect. | Protected route renders after logout. | BLOCKED | ☐ |
| 14I.15 | installed | Delete, reinstall, launch | Starts signed out. | Session survives reinstall. | BLOCKED | ☐ |
| 14I.16 | macOS toolchain | `pod install` then build in Xcode | Project builds. | Build failure. | BLOCKED | ☐ |
| 14I.17 | release build | Inspect the IPA | No secret, no localhost, no privacy permission. | Any secret or unexpected permission. **Stop and report.** | BLOCKED | ☐ |

## 17. Hosting & deployment (Phase 180)

The web client is a static SPA; the backend is a separate Convex deployment.
Rows here verify the artifact/host contract — the part that no unit test can
prove because it only exists once something is actually serving files.

**AUTOMATED** rows are covered by `deployment.phase180.test.ts` and
`npm run mobile:verify` and were executed. **HUMAN** rows need a browser
against a real deployment. **BLOCKED** rows cannot run in this environment.

### Deep links and refresh behaviour

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.1 | deployed URL | Open `/` | Landing page renders. | Blank page or 404. | HUMAN | ☐ |
| 17.2 | deployed URL | Open `/dashboard` directly in a new tab | App loads, then routes normally (to /auth if signed out). | **Blank page** — check the console for a module MIME-type error. **Stop and report.** | HUMAN | ☐ |
| 17.3 | on `/journal` | Press browser Refresh | Same route re-renders. | Blank page or 404. **Stop and report.** | HUMAN | ☐ |
| 17.4 | deployed URL | Open `/no-such-route` | App's own 404 view renders (HTTP 200 + index.html). | Host's raw 404 page. | HUMAN | ☐ |
| 17.5 | built artifact | Assert every asset ref is root-absolute | No `./assets/...` in `dist/index.html`. | Relative ref reintroduces the blank-page defect. | AUTOMATED — PASS | ☑ |
| 17.6 | built artifact | Resolve the entry script from `/`, `/dashboard`, `/journal/entry/42` | Identical path each time. | Depth-dependent resolution. | AUTOMATED — PASS | ☑ |
| 17.7 | repo | Compare `vercel.json` and `public/_redirects` | Both declare an equivalent 200 rewrite. | Host-dependent routing. | AUTOMATED — PASS | ☑ |
| 17.8 | built artifact | Check asset filenames | All content-hashed. | Unhashed asset served stale after deploy. | AUTOMATED — PASS | ☑ |

### Configuration and provenance

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.9 | deployed URL | Open the console on first load | One line: `[Xstarz Analysis] build <commit> (<branch>) built <time>`. | No provenance; live revision unknowable. | HUMAN | ☐ |
| 17.10 | deployed URL | Confirm the logged branch | Hardened `arena/...` branch. | Built from `main` — a warning is logged; **stop and report**. | HUMAN | ☐ |
| 17.11 | build without `VITE_CONVEX_URL` | Load the app | Explicit "not configured" screen. | Silent blank page. | AUTOMATED — PASS | ☑ |
| 17.12 | built artifact | Scan bundles for a localhost backend | None present. | Production points at a nonexistent machine. | AUTOMATED — PASS | ☑ |
| 17.13 | built artifact | Scan for server-only secret values and env reads | None present. | Provider key exposed. **Stop and report.** | AUTOMATED — PASS | ☑ |
| 17.14 | deployed backend | Confirm every provider call originates server-side | No provider host appears in browser network traffic. | Client-side provider call leaks a key. **Stop and report.** | HUMAN | ☐ |

### Association files

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.15 | deployed URL | GET `/.well-known/assetlinks.json` | Valid JSON, `application/json`, not index.html. | SPA rewrite swallows it; App Links can never verify. | HUMAN | ☐ |
| 17.16 | deployed URL | GET `/.well-known/apple-app-site-association` | Valid JSON, `application/json`, no `.json` extension. | Same as above for Universal Links. | HUMAN | ☐ |
| 17.17 | repo | Validate both files' structure and bundle id | `app.xstarz.analysis` in both. | Mismatched id silently breaks deep links. | AUTOMATED — PASS | ☑ |
| 17.18 | repo | Confirm placeholders remain | Links reported CONFIGURED, **NOT VERIFIED**. | Real values present but docs/UAT still say unverified. | AUTOMATED — PASS | ☑ |
| 17.19 | signing cert + Team ID exist | Replace placeholders, redeploy, retest on device | Links open in-app. | — | BLOCKED — no keystore, no Apple account | ☐ |

### Deep-link safety

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.20 | app installed | Open a link to `//evil.com` | Never navigates off-origin. | Open redirect. **Stop and report.** | AUTOMATED — PASS | ☑ |
| 17.21 | app installed | Open `javascript:`, `data:`, `file:` links | All rejected. | Script or local-file access. **Stop and report.** | AUTOMATED — PASS | ☑ |
| 17.22 | app installed | Open a malformed custom-scheme URL | Rejected without crashing. | Unhandled exception on launch. | AUTOMATED — PASS | ☑ |

### CI/CD

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.23 | GitHub Actions enabled | Run `ci.yml` | Tests, typecheck, build, secret scan pass; `dist/` uploaded. | Any gate fails. | BLOCKED — not executed from the sandbox | ☐ |
| 17.24 | GitHub Actions enabled | Run `mobile.yml` → android | Debug APK builds and uploads. | Gradle failure. | BLOCKED — no JDK locally | ☐ |
| 17.25 | GitHub Actions enabled | Run `mobile.yml` → ios | Unsigned simulator compile succeeds. | Xcode failure. | BLOCKED — no macOS locally | ☐ |
| 17.26 | APK from CI | Install on a physical Android device | App runs. | — | BLOCKED — no device | ☐ |
| 17.27 | iOS build | Run on a physical iPhone | App runs. | — | BLOCKED — no iPhone | ☐ |

### Backend deployment

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 17.28 | unrestricted network | `npx convex deploy` | Functions deploy. | — | BLOCKED — Convex TLS blocked by allowlist | ☐ |
| 17.29 | deployed backend | Set Class B/C variables | Providers report available. | Key missing ⇒ provider unavailable (never fabricated data). | BLOCKED | ☐ |
| 17.30 | deployed backend | Run one analysis end-to-end | Real provenance and timestamps. | Any fabricated value. **Stop and report.** | BLOCKED | ☐ |
| 17.31 | **credential rotated** | Confirm the old OTP key is rejected | Old key invalid. | Leaked credential still valid. **Hard release blocker.** | BLOCKED — rotation not performed | ☐ |

---

## 18. Release-candidate audit (Phase 181)

RC `155b59e` on `arena/01a08e67-trade-intel-bot`, tag `rc-181`.

**AUTOMATED** rows were executed. **HUMAN** rows need a person or a real
deployment. **BLOCKED** rows cannot run from this environment.

### CI and release integrity

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.1 | repo | Edit a web-only file and rebuild | Mobile artifact SHA changes | Trigger filter would skip mobile validation | AUTOMATED — PASS | ☑ |
| 18.2 | repo | Check mobile workflow triggers for web paths | src/**, public/**, package.json, vite.config.ts all trigger | Unvalidated artifact reaches release | AUTOMATED — PASS | ☑ |
| 18.3 | repo | Restore the old mobile-only filter | Guard fails (9 tests) | Regression undetected | AUTOMATED — PASS | ☑ |
| 18.4 | repo | Build the same commit twice | Byte-identical artifacts | Provenance unverifiable | AUTOMATED — PASS | ☑ |
| 18.5 | repo | Scan for network-touching tests in the default suite | None unguarded | Suite passes locally, fails in CI | AUTOMATED — PASS | ☑ |
| 18.6 | clean checkout | Run the suite with no dist/ and no cap-sync output | 233 files pass | ENOENT on a fresh clone | AUTOMATED — PASS | ☑ |
| 18.7 | workflows | Audit continue-on-error | Only on advisory lint | A correctness gate silently passes | AUTOMATED — PASS | ☑ |
| 18.8 | workflows | Confirm no deploy step and no provider secret | Neither present | CI bypasses the rotation blocker | AUTOMATED — PASS | ☑ |
| 18.9 | GitHub | Run ci.yml on the RC | All gates pass on a clean checkout | — | AUTOMATED — PASS (run 34668059671) | ☑ |

### Mobile artifacts

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.10 | GitHub | Build the Android debug APK | APK produced | — | AUTOMATED — PASS (run 34668059591) | ☑ |
| 18.11 | APK | Confirm web assets inside with an absolute base | `assets/public/index.html` with `src="/assets/` | Blank app on device | AUTOMATED — PASS | ☑ |
| 18.12 | GitHub macOS | `pod install` then compile | Pods/, Podfile.lock, App.app with executable | False green | AUTOMATED — PASS | ☑ |
| 18.13 | iOS bundle | Confirm web assets with an absolute base | `public/index.html` with `src="/assets/` | Blank app on device | AUTOMATED — PASS | ☑ |
| 18.14 | both artifacts | Secret / localhost / dev-endpoint scan | Clean | Credential shipped | AUTOMATED — PASS | ☑ |
| 18.15 | APK from CI | Install on a physical Android device | App runs | — | BLOCKED — no device | ☐ |
| 18.16 | iOS build | Run on a physical iPhone | App runs | — | BLOCKED — no iPhone | ☐ |
| 18.17 | release keystore | Produce a signed release AAB | Signed bundle | — | BLOCKED — no signing material (by design) | ☐ |

### Web deployment contract

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.18 | built dist | Request /, /auth, /dashboard, /journal | 200 + index.html | Deep link 404 | AUTOMATED — PASS | ☑ |
| 18.19 | built dist | Request the entry JS | `text/javascript` | HTML returned; blank page | AUTOMATED — PASS | ☑ |
| 18.20 | built dist | Request the entry CSS | `text/css` | Unstyled app | AUTOMATED — PASS | ☑ |
| 18.21 | built dist | Scan bundles for localhost/dev endpoints | None | Production points nowhere | AUTOMATED — PASS | ☑ |
| 18.22 | real deployment | Repeat 18.18–18.21 against the deployed URL | Same results | — | HUMAN — not executed | ☐ |

### Deep links

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.23 | built dist | GET both `.well-known` files | 200 `application/json`, not the SPA shell | Associations can never verify | AUTOMATED — PASS | ☑ |
| 18.24 | repo | Confirm placeholders remain | CONFIGURED / NOT VERIFIED | Overstated readiness | AUTOMATED — PASS | ☑ |
| 18.25 | signing identity | Replace placeholders and verify on device | Links open in-app | — | BLOCKED — no keystore, no Team ID | ☐ |

### Backend, auth, entitlement

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.26 | unrestricted network | `npx convex codegen` | Succeeds | — | BLOCKED — control plane TLS-blocked | ☐ |
| 18.27 | deployed backend | Deploy the RC and verify schema/functions | Deploys | — | BLOCKED | ☐ |
| 18.28 | deployed backend | Authenticated `runProtectedAnalysis` | Real provenance | — | BLOCKED | ☐ |
| 18.29 | deployed backend | Entitlement: chargeable vs WAIT/NO_TRADE free | Phase 174 behaviour preserved | Substituted WAIT | BLOCKED | ☐ |
| 18.30 | deployed backend | Exhausted guest receives explicit LOCKED | LOCKED, never a substituted WAIT | Silent degradation | BLOCKED | ☐ |
| 18.31 | deployed backend | Locked-result redaction | Protected fields withheld | Leak | BLOCKED | ☐ |
| 18.32 | deployed backend | User isolation across two accounts | No cross-read | Data leak | BLOCKED | ☐ |
| 18.33 | deployed backend | Provider fan-out, cache, timeout, rate-limit | Modes reported honestly | Fabricated data | BLOCKED | ☐ |
| 18.34 | deployment | Login, OTP, session persist, refresh, logout, return-to | All correct | — | BLOCKED | ☐ |

### Security

| ID | Precondition | Step | Expected | Failure | Status | ✔ |
|---|---|---|---|---|---|---|
| 18.35 | repo | Confirm the credential is absent from tree and artifacts | Absent | Shipped secret | AUTOMATED — PASS | ☑ |
| 18.36 | repo | Confirm the hardened branch reads the env var only | `process.env`, throws if unset | Hardcoded value | AUTOMATED — PASS | ☑ |
| 18.37 | repo | Count history commits containing the credential | 9, documented | Understated exposure | AUTOMATED — PASS | ☑ |
| 18.38 | `auth.freebuff.app` | Rotate and confirm the old key is rejected | 401/403 | **Live credential — hard blocker** | BLOCKED — not performed | ☐ |

---

## 19. Windows desktop (Phase 182)

Tauri 2 wraps the SAME production web build as the browser and both mobile
platforms. Analysis, entitlement, provenance, cache semantics, timestamps,
auth and route protection are therefore identical by construction — there is
no desktop-specific engine to diverge.

**AUTOMATED** rows were executed. **HUMAN** rows need a real Windows machine.
**BLOCKED** rows cannot run in this environment.

### Architecture and artifact integrity

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.1 | repo | Confirm `frontendDist` is the shared `dist/` | `../dist` | Desktop forks the UI | AUTOMATED - PASS | [x] |
| 19.2 | repo | Confirm no desktop-specific analysis engine | Only the shell module exists | Second engine diverges | AUTOMATED - PASS | [x] |
| 19.3 | repo | Confirm the shell has no HTTP client or provider host | None present | Client-side provider call | AUTOMATED - PASS | [x] |
| 19.4 | built app | Scan config and sources for secrets | Clean | Credential shipped | AUTOMATED - PASS | [x] |
| 19.5 | built app | Scan for localhost / dev server / sandbox host | Absent from the bundle | Dev dependency ships | AUTOMATED - PASS | [x] |
| 19.6 | repo | Confirm no signing material committed | None | Certificate leak | AUTOMATED - PASS | [x] |
| 19.7 | repo | Confirm capabilities grant no fs/shell/process/http | None granted | OS exposed to web content | AUTOMATED - PASS | [x] |
| 19.8 | repo | Confirm no self-updater configured | Absent | Unsigned update channel | AUTOMATED - PASS | [x] |
| 19.9 | CI | Scan the compiled .exe for secrets and dev endpoints | Clean | Secret in the binary | BLOCKED - runs in Windows CI | [ ] |

### Packaging metadata

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.10 | repo | Confirm product name and identifier | "Xstarz Analysis", `app.xstarz.analysis.desktop` | Wrong identity | AUTOMATED - PASS | [x] |
| 19.11 | repo | Confirm publisher differs from product name | `Xstarz` | Microsoft Store rejection | AUTOMATED - PASS | [x] |
| 19.12 | repo | Confirm version, copyright, descriptions | All present | Installer metadata incomplete | AUTOMATED - PASS | [x] |
| 19.13 | repo | Confirm multi-size `.ico` | 4 or more sizes | Blurry taskbar icon | AUTOMATED - PASS | [x] |
| 19.14 | repo | Confirm the description never claims trade execution | Decision-support wording | Product-identity violation | AUTOMATED - PASS | [x] |

### Routing

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.15 | repo | Confirm BrowserRouter preserved | No MemoryRouter/HashRouter | Deep links and returnTo break | AUTOMATED - PASS | [x] |
| 19.16 | built dist | Confirm absolute asset base | `src="/assets/..."` | Phase 180 blank page in the desktop window | AUTOMATED - PASS | [x] |
| 19.17 | built dist | Serve `/`, `/auth`, `/dashboard`, `/journal` | 200 + index.html; JS as text/javascript | Blank window | AUTOMATED - PASS | [x] |
| 19.18 | built dist | Serve `/download`, `/privacy`, `/terms` | 200 + index.html | Website pages 404 | AUTOMATED - PASS | [x] |
| 19.19 | installed app | Navigate to each route in the desktop window | Renders correctly | - | HUMAN - needs Windows | [ ] |
| 19.20 | installed app | Deep link into `/dashboard` where the wrapper permits | Route resolves or redirects to `/auth` | Blank window | HUMAN - needs Windows | [ ] |

### External navigation

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.21 | repo | `javascript:`, `data:`, `file:`, `http:` links | All rejected | Script or local-file access | AUTOMATED - PASS | [x] |
| 19.22 | repo | Look-alike host `xstarz.app.evil.com` | Rejected | Open redirect | AUTOMATED - PASS | [x] |
| 19.23 | repo | Rust and TypeScript allowlists agree | Identical | UI offers links the shell refuses | AUTOMATED - PASS | [x] |

### Windows CI build

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.24 | GitHub Actions | Run the Windows job | MSI and NSIS installers produced | Build failure | BLOCKED - not yet executed | [ ] |
| 19.25 | Windows CI | `cargo test` for the external-link allowlist | Passes | Redirect guard broken | BLOCKED | [ ] |
| 19.26 | Windows CI | Confirm bundled assets use an absolute base | Confirmed | Blank desktop window | BLOCKED | [ ] |

### Human verification on a real Windows machine

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.27 | installer | Install on Windows 10/11 x64 | Installs as "Xstarz Analysis" with the correct icon | - | BLOCKED - no Windows machine | [ ] |
| 19.28 | installed app | First launch | Window opens; landing page renders | Blank window | BLOCKED | [ ] |
| 19.29 | installed app | Sign in via OTP | Sign-in completes | Auth fails in WebView2 | BLOCKED | [ ] |
| 19.30 | signed in | Close and relaunch | Session persists | Session lost each launch | BLOCKED | [ ] |
| 19.31 | signed in | Open the dashboard | Loads with provenance | Divergent behaviour vs web | BLOCKED | [ ] |
| 19.32 | signed in | Open the journal | Loads | Route fails in the shell | BLOCKED | [ ] |
| 19.33 | signed in | Run one analysis | Server-side analysis with provenance | Any direct provider call from the desktop | BLOCKED | [ ] |
| 19.34 | guest | Exhaust the free signals | Explicit LOCKED, identical to other surfaces | Substituted WAIT | BLOCKED | [ ] |
| 19.35 | app open | Disconnect the network and run an analysis | Explicit degraded state; nothing fabricated | Fabricated price/freshness. **Stop and report.** | BLOCKED | [ ] |
| 19.36 | offline | Reconnect and retry | Recovers with a new observation | Stale data labelled live | BLOCKED | [ ] |
| 19.37 | signed in | Log out | Session cleared; protected routes redirect | Protected route renders after logout | BLOCKED | [ ] |
| 19.38 | installed app | Uninstall from Settings | Removed cleanly, no leftovers | Orphaned files or registry entries | BLOCKED | [ ] |
| 19.39 | uninstalled | Reinstall and launch | Starts signed out | Session survives reinstall | BLOCKED | [ ] |
| 19.40 | v0.1.0 installed | Install a higher version over it | Upgrades in place; data preserved | Downgrade or data loss | BLOCKED | [ ] |
| 19.41 | signed installer | Confirm no SmartScreen warning | No warning | Unsigned build deters users | BLOCKED - no certificate | [ ] |
| 19.42 | Windows ARM64 | Install and launch | Runs | - | BLOCKED - not built, not claimed | [ ] |

### Microsoft Store

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.43 | Partner Center account | Reserve the package identity | Identity reserved | - | BLOCKED - no account | [ ] |
| 19.44 | reserved identity | Produce an MSIX with matching identity | Package validates | Rejection | BLOCKED | [ ] |
| 19.45 | Store package | Set WebView2 to `offlineInstaller` | Store policy satisfied | Rejection | BLOCKED | [ ] |
| 19.46 | Store listing | Supply privacy URL, screenshots, age rating | Metadata complete | - | BLOCKED - needs the official domain | [ ] |

### Official website

| ID | Precondition | Step | Expected | Failure | Status | check |
|---|---|---|---|---|---|---|
| 19.47 | repo | Confirm no invented domain or download URL | None present | Button 404s for real users | AUTOMATED - PASS | [x] |
| 19.48 | built app | Confirm `/download` states availability honestly | Channels marked unavailable | Overstated readiness | AUTOMATED - PASS | [x] |
| 19.49 | custom domain | Serve `/`, `/download`, `/auth`, `/privacy`, `/terms` | All resolve with no routing change | - | BLOCKED - no domain | [ ] |

---

## 20. Phase 183 — external verification execution log

Every row records the exact environment, date and evidence. Rows that could
not be executed are BLOCKED with the reason, never softened into a pass.

RC `dea46ef`. All timestamps 2026-09-12 UTC.

### Executed — CI artifacts (real runners)

| ID | Step | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|
| 20.1 | Android debug APK build | `ubuntu-latest` | PASS | 3,809,003-byte APK; contains `assets/public/index.html` with absolute base | AUTOMATED |
| 20.2 | Android artifact secret scan | `ubuntu-latest` | PASS | Step "Verify packaged artifacts contain no secrets" | AUTOMATED |
| 20.3 | iOS Pods + simulator compile | `macos-14` | PASS | `App.app` with executable; web assets present | AUTOMATED |
| 20.4 | Windows MSI + NSIS build | `windows-latest` | PASS | 2,677,090-byte installer artifact | AUTOMATED |
| 20.5 | Windows installer existence assertion | `windows-latest` | PASS | Step "Verify installers were produced" | AUTOMATED |
| 20.6 | Windows bundled-asset base check | `windows-latest` | PASS | Absolute `/assets/` confirmed on the real build | AUTOMATED |
| 20.7 | Windows artifact scan | `windows-latest` | PASS | Passed only after the path-handling fix | AUTOMATED |
| 20.8 | **Windows compiled-binary scan** | `windows-latest` | PASS | Caught `localhost:5173` in the `.exe`; passes after the dev-overlay fix | AUTOMATED |

### Executed — web deployment contract (real build, local host)

| ID | Step | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|
| 20.9 | `/`, `/auth`, `/dashboard`, `/journal` | Local SPA host | PASS | 200 + `text/html` each | AUTOMATED |
| 20.10 | `/download`, `/privacy`, `/terms` | Local SPA host | PASS | 200 + `text/html` each | AUTOMATED |
| 20.11 | Deep nested route | Local SPA host | PASS | `/deep/nested` → 200 + HTML | AUTOMATED |
| 20.12 | Entry JS content type | Local SPA host | PASS | `text/javascript` | AUTOMATED |
| 20.13 | Entry CSS content type | Local SPA host | PASS | `text/css` | AUTOMATED |
| 20.14 | `.well-known` content type | Local SPA host | PASS | `application/json`, not the SPA shell | AUTOMATED |
| 20.15 | `/dashboard/assets/*` masquerade | Local SPA host | PASS | Never requested — every asset ref is absolute | AUTOMATED |
| 20.16 | Build provenance matches commit | Local build | PASS | Embedded commit == `HEAD`; a stale `dist/` was detected and rebuilt | AUTOMATED |

### Executed — security and configuration audit

| ID | Step | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|
| 20.17 | Count commits containing the credential | Sandbox | PASS | **9**, independently re-derived by fingerprint; matches documentation | AUTOMATED |
| 20.18 | Identify every affected ref | Sandbox | PASS | `main`, `arena/01a08e67-…` and tag `rc-181` all reach an affected commit | AUTOMATED |
| 20.19 | Working tree free of the credential | Sandbox | PASS | Hardened module reads `process.env` and throws if unset | AUTOMATED |
| 20.20 | No signing material committed | Sandbox | PASS | No keystore, cert, profile or private key anywhere | AUTOMATED |
| 20.21 | Association placeholders intact | Sandbox | PASS | Both still `REPLACE_WITH_…`; no fingerprint invented | AUTOMATED |
| 20.22 | Android release identity/version | Sandbox | PASS | `app.xstarz.analysis`, `versionCode 1`, `versionName 1.0` | AUTOMATED |
| 20.23 | iOS release identity/version | Sandbox | PASS | `app.xstarz.analysis`, `MARKETING_VERSION 1.0`, automatic signing | AUTOMATED |
| 20.24 | Windows identity/version/publisher | Sandbox | PASS | `app.xstarz.analysis.desktop`, `0.1.0`, publisher `Xstarz` ≠ product name | AUTOMATED |
| 20.25 | `_generated/` not hand-edited this phase | Sandbox | PASS | Zero drift | AUTOMATED |

### Blocked — external dependency unavailable

| ID | Step | Blocking dependency | Status |
|---|---|---|---|
| 20.26 | Rotate the OTP credential | `auth.freebuff.app` account | BLOCKED |
| 20.27 | Verify the old credential returns 401/403 | Same | BLOCKED |
| 20.28 | Verify OTP delivery with the replacement | Same + deployed backend | BLOCKED |
| 20.29 | Rewrite history on all affected refs | Rotation first; full mirror clone (repo here is shallow) | BLOCKED |
| 20.30 | `npx convex codegen` | Control plane HTTP 000 | BLOCKED |
| 20.31 | `npx convex deploy` | Same | BLOCKED |
| 20.32 | Set Class B/C environment variables | Deployment | BLOCKED |
| 20.33 | Evidence D — authenticated deployed calls | Deployment | BLOCKED |
| 20.34 | Live provider verification (9 providers) | All 7 hosts HTTP 000 | BLOCKED |
| 20.35 | Public web deployment verification | No deployment performed | BLOCKED |
| 20.36 | Android signed release AAB/APK | No keystore | BLOCKED |
| 20.37 | iOS archive and signing | No Apple Developer account | BLOCKED |
| 20.38 | Windows signed installer | No certificate | BLOCKED |
| 20.39 | Microsoft Store package validation | No Partner Center account | BLOCKED |
| 20.40 | Android App Links on-device verification | Needs real cert + domain | BLOCKED |
| 20.41 | iOS Universal Links verification | Needs Team ID + domain | BLOCKED |
| 20.42 | Android physical-device matrix | No device | BLOCKED |
| 20.43 | **iOS physical-device matrix** | **User has no iPhone** | BLOCKED |
| 20.44 | Windows physical-machine matrix | No Windows machine | BLOCKED |
| 20.45 | Official-domain verification | No custom domain | BLOCKED |

**Phase 183 totals: 25 executed and PASS, 20 blocked, 0 failed, 0 manufactured.**

---

## 21. Phase 184 — credential scope correction and rewrite rehearsal

RC `be98364`. 2026-09-12 UTC. The security blocker remains ACTIVE: rotation is
operator-gated and has not been confirmed.

### Executed

| ID | Step | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|
| 21.1 | Restore full history | Sandbox | PASS | `git fetch --unshallow`: 1 → **306** reachable commits | AUTOMATED |
| 21.2 | Re-audit affected commits | Sandbox | PASS | **270** affected (previous figure of 9 was a shallow-clone artifact) | AUTOMATED |
| 21.3 | Enumerate affected refs | Sandbox | PASS | 7 refs reach the credential, incl. previously invisible `phase-157-live-discovery-lifecycle` | AUTOMATED |
| 21.4 | Blob-level scan of all objects | Sandbox | PASS | 3,324 objects / 1,670 text blobs → **1 distinct blob**, one path | AUTOMATED |
| 21.5 | Commit-message scan | Sandbox | PASS | 0 occurrences | AUTOMATED |
| 21.6 | Tag-object scan | Sandbox | PASS | 0 occurrences | AUTOMATED |
| 21.7 | Mirror backup | Sandbox | PASS | `/home/user/backup-mirror-be98364.git`, fsck clean, 306 commits, 7 refs | AUTOMATED |
| 21.8 | **Rewrite rehearsal** (disposable copy) | Sandbox | PASS | `filter-repo` exit 0; 306/306 commits preserved; 4 refs rewritten | AUTOMATED |
| 21.9 | Post-rewrite zero-match (rehearsal) | Sandbox | PASS | **0** credential blobs | AUTOMATED |
| 21.10 | Rewrite is surgical | Sandbox | PASS | Exactly **1** source blob changed; RC tip tree hash **identical** | AUTOMATED |
| 21.11 | History scanner: fails when dirty | Sandbox | PASS | Exit 1 on the real repository today | AUTOMATED |
| 21.12 | History scanner: passes when clean | Rehearsed mirror | PASS | Exit 0 | AUTOMATED |
| 21.13 | History scanner: refuses shallow clones | Sandbox | PASS | Depth-1 clone → **exit 2**, refuses instead of reporting clean | AUTOMATED |
| 21.13a | Scanner exit codes are unambiguous | Sandbox | PASS | 0 clean / **1 found** / **2 refused** — verified all three | AUTOMATED |
| 21.13b | CI history job runs on full history | GitHub Actions | PASS | Run 34692174870: scanned and **failed correctly** (credential reachable) | AUTOMATED |
| 21.13c | CI job must not report false green | GitHub Actions | PASS | A `::warning::` variant made the job read **success** while the credential was still reachable; corrected to fail. Caught by checking the job conclusion, not the step output | AUTOMATED |
| 21.14 | `isolate/` dependency review | Sandbox | PASS | No build, deploy, test or packaging dependency | AUTOMATED |
| 21.15 | `isolate/` removal | Sandbox | PASS | 11 tracked files deleted; CI filter and its test updated | AUTOMATED |
| 21.16 | Clean build after removal | Sandbox | PASS | `tsc -b` 0, `vite build` 0 | AUTOMATED |
| 21.17 | Current-tree credential scan | Sandbox | PASS | 0 occurrences | AUTOMATED |
| 21.18 | Web artifact credential scan | Sandbox | PASS | 15 `dist/` files, 0 occurrences | AUTOMATED |
| 21.19 | Mobile artifact scan | Sandbox | PASS | `mobile:verify` PASS | AUTOMATED |
| 21.20 | Full gate suite | Sandbox | PASS | 234 test files, tsc 0, build 0, lint 1517 = baseline | AUTOMATED |

### Blocked — operator action required

| ID | Step | Blocking dependency | Status |
|---|---|---|---|
| 21.21 | Rotate the OTP credential | Operator + `auth.freebuff.app` | BLOCKED |
| 21.22 | Configure replacement in Convex | Operator + deployment | BLOCKED |
| 21.23 | Revoke the old credential | Operator | BLOCKED |
| 21.24 | Verify the old credential returns 401/403 | Operator | BLOCKED |
| 21.25 | Execute the real history rewrite | Gated behind 21.24 | BLOCKED |
| 21.26 | Force-push rewritten refs | Gated behind 21.25 | BLOCKED |
| 21.27 | New RC tag `rc-184` on rewritten history | Gated behind 21.26 | BLOCKED |
| 21.28 | Rebuild and re-verify provenance | Gated behind 21.27 | BLOCKED |

**Phase 184 totals: 20 executed and PASS, 8 blocked, 0 failed, 0 manufactured.**

---

## 22. Phase 185 — Xstarz-owned authentication and OTP delivery

2026-09-12 UTC. The Phase 184 credential blocker remains ACTIVE and separate:
removing the runtime dependency does **not** revoke the leaked credential.

### Executed

| ID | Step | Environment | Result | Evidence | Status |
|---|---|---|---|---|---|
| 22.1 | Audit Freebuff auth dependencies | Sandbox | PASS | 2 found: OTP endpoint + default trusted JWT issuer | AUTOMATED |
| 22.2 | Remove the OTP endpoint from the runtime | Sandbox | PASS | Executable code in the auth path contains no Freebuff URL | AUTOMATED |
| 22.3 | Make the federated issuer opt-in | Sandbox | PASS | Hardcoded `https://freebuff.com` default deleted | AUTOMATED |
| 22.4 | Provider-neutral delivery abstraction | Sandbox | PASS | `lib/emailDelivery.ts`; vendor swap is config-only | AUTOMATED |
| 22.5 | Valid recipient reaches the transport | Sandbox | PASS | Correct URL, Xstarz sender, OTP in body | AUTOMATED |
| 22.6 | Missing credential fails explicitly | Sandbox | PASS | `not_configured` before any network call | AUTOMATED |
| 22.7 | Absent vs malformed sender distinguished | Sandbox | PASS | Distinct messages; found by mutation testing | AUTOMATED |
| 22.8 | Provider timeout fails safely | Sandbox | PASS | Classified `timeout`, no payload leaked | AUTOMATED |
| 22.9 | Provider 429 fails safely | Sandbox | PASS | Classified `rate_limited` | AUTOMATED |
| 22.10 | Provider 500 echoing the request | Sandbox | PASS | Neither OTP nor key in message or stack | AUTOMATED |
| 22.11 | OTP never logged | Sandbox | PASS | Console transport logs a masked recipient only | AUTOMATED |
| 22.12 | Recipient masked in logs | Sandbox | PASS | `tr***@example.com` | AUTOMATED |
| 22.13 | Freebuff endpoint never called | Sandbox | PASS | Every request URL asserted against a deny-list | AUTOMATED |
| 22.14 | Freebuff sender identity refused | Sandbox | PASS | Rejected even when set deliberately | AUTOMATED |
| 22.15 | Resend cooldown | Sandbox | PASS | 60s enforced, retry-after reported | AUTOMATED |
| 22.16 | Resend window cap | Sandbox | PASS | 5/hour, recovers after rollover | AUTOMATED |
| 22.17 | Case/padding cannot evade the throttle | Sandbox | PASS | Identifier normalised | AUTOMATED |
| 22.18 | **Throttle wired into the provider** | Sandbox | PASS | Drives the real callback; gap found by mutation testing | AUTOMATED |
| 22.19 | Failed-attempt limit tightened | Sandbox | PASS | 5/hour vs library default of 10 | AUTOMATED |
| 22.20 | Replayed OTP rejected | Sandbox | PASS | Convex Auth deletes the code on use | AUTOMATED |
| 22.21 | Expired OTP rejected | Sandbox | PASS | Server-side `expirationTime` check | AUTOMATED |
| 22.22 | Codes hashed at rest | Sandbox | PASS | `code: await sha256(code)` | AUTOMATED |
| 22.23 | Code lifetime shortened | Sandbox | PASS | 15 → 10 minutes | AUTOMATED |
| 22.24 | CSPRNG generation | Sandbox | PASS | `crypto.getRandomValues`; no `Math.random` | AUTOMATED |
| 22.25 | Session model unchanged | Sandbox | PASS | Convex Auth retained; no framework swap | AUTOMATED |
| 22.26 | Email is transactional only | Sandbox | PASS | No tracking pixel, remote image or marketing | AUTOMATED |
| 22.27 | Email carries branding, expiry, warning | Sandbox | PASS | Asserted in both text and HTML | AUTOMATED |
| 22.28 | OTP escaped into HTML | Sandbox | PASS | Injection attempt escaped | AUTOMATED |
| 22.29 | OTP absent from the subject line | Sandbox | PASS | `buildSubject()` takes no argument | AUTOMATED |
| 22.30 | Web artifact scan | Sandbox | PASS | No provider credential in `dist/` | AUTOMATED |
| 22.31 | Android/iOS/Tauri config scan | Sandbox | PASS | `XSTARZ_EMAIL_API_KEY` added to the scanners | AUTOMATED |
| 22.32 | Scanner mutation test | Sandbox | PASS | Planted key in `dist/` → 3 rules fired | AUTOMATED |
| 22.33 | Obsolete env vars removed | Sandbox | PASS | `OTP_EMAIL_API_KEY`, `VLY_APP_NAME` gone from runtime | AUTOMATED |
| 22.34 | Retained VLY vars traced | Sandbox | PASS | 3 retained, each with a documented consumer | AUTOMATED |
| 22.35 | `_generated/` not hand-edited | Sandbox | PASS | Helpers placed in `lib/`; zero drift | AUTOMATED |
| 22.36 | Full gate suite | Sandbox | PASS | 235 files, tsc 0, build 0, lint 1517 = baseline | AUTOMATED |

### Blocked — external dependency

| ID | Step | Blocking dependency | Status |
|---|---|---|---|
| 22.37 | Create the provider account | Operator | BLOCKED |
| 22.38 | Purchase the Xstarz domain | Operator | BLOCKED |
| 22.39 | SPF/DKIM/DMARC verification | Domain | BLOCKED |
| 22.40 | Live OTP delivery to a real inbox | Account + domain + deployment | BLOCKED |
| 22.41 | Inbox-placement check | Same | BLOCKED |
| 22.42 | Deployed auth round trip | Convex deployment | BLOCKED |

**Phase 185 totals: 36 executed and PASS, 6 blocked, 0 failed, 0 manufactured.**

---

## 23. Phase 185b — Final authentication hardening

Environment mechanism: `XSTARZ_DEPLOYMENT_ENV`, an explicit per-deployment
Convex variable. Absent or empty resolves to `production`.

### Executed

| ID | Check | Evidence | Result |
| --- | --- | --- | --- |
| 23.1 | Unset deployment env resolves to production | Phase 185b suite | PASS |
| 23.2 | Empty/whitespace deployment env resolves to production | Same | PASS |
| 23.3 | Unrecognised value throws, no silent downgrade | Same | PASS |
| 23.4 | development + console allowed | Same | PASS |
| 23.5 | production + console rejected, no delivery result | Same | PASS |
| 23.6 | production + console performs no fetch | Same | PASS |
| 23.7 | production + resend valid when fully configured | Same | PASS |
| 23.8 | production + smtp2go valid when fully configured | Same | PASS |
| 23.9 | production + provider selected, credential missing, rejected | Same | PASS |
| 23.10 | production + no issuer configured, self-issuer only | Same | PASS |
| 23.11 | production + Freebuff issuer, failure | Same | PASS |
| 23.12 | production + VLY issuer, failure | Same | PASS |
| 23.13 | preview + explicit legacy issuer, allowed | Same | PASS |
| 23.14 | production + arbitrary external issuer, rejected | Same | PASS |
| 23.15 | production + malformed issuer, failure | Same | PASS |
| 23.16 | Empty/whitespace issuer treated as absent, self-only | Same | PASS |
| 23.17 | Production cannot silently fall back to federation | Same | PASS |
| 23.18 | `auth.config.ts` holds no inline issuer env read | Source assertion | PASS |
| 23.19 | Retired-host matching covers subdomains | Phase 185b suite | PASS |
| 23.20 | Session total duration 30 days | Library source assertion | PASS |
| 23.21 | Session inactive duration 30 days | Same | PASS |
| 23.22 | JWT duration 1 hour | Same | PASS |
| 23.23 | Throttle documents per-process scope honestly | Source assertion | PASS |
| 23.24 | M1 unset-default mutation caught | 7 failures | PASS |
| 23.25 | M2 console production check removed, caught | 4 failures | PASS |
| 23.26 | M3 production issuer gate removed, caught | 6 failures | PASS |
| 23.27 | M4 retired-host list emptied, caught | 3 failures | PASS |
| 23.28 | M5 bad value silently accepted, caught | 1 failure | PASS |
| 23.29 | Production runtime has zero Freebuff OTP dependency | Classified scan | PASS |
| 23.30 | `dist/` free of Freebuff, `/send_otp`, provider key | Artifact scan | PASS |
| 23.31 | Android/iOS/Tauri sources free of Freebuff | Artifact scan | PASS |
| 23.32 | No console transport configured for production artifacts | Artifact scan | PASS |

### Blocked — external dependency

| ID | Check | Blocker | Result |
| --- | --- | --- | --- |
| 23.33 | Deployed production rejects console transport live | Convex deployment | BLOCKED |
| 23.34 | Deployed production rejects a configured issuer live | Same | BLOCKED |
| 23.35 | Real 30-day session expiry observed end to end | Same + elapsed time | BLOCKED |

**Phase 185b totals: 32 executed and PASS, 3 blocked, 0 failed, 0 manufactured.**

---

## 24. Phase 186 — Convex deployment + runtime verification

Evidence level for this section: **C (harness-verified)** for the preflight
rows; **D BLOCKED** for every row requiring a deployed backend.

### Executed — AUTOMATED

| ID | Check | Evidence | Result |
| --- | --- | --- | --- |
| 24.1 | Preflight script exists and is wired to `npm run convex:preflight` | Phase 186 suite | PASS |
| 24.2 | Preflight imports real policy modules, keeps no rule copy | Source assertion | PASS |
| 24.3 | Valid production configuration accepted, exit 0 | Subprocess run | PASS |
| 24.4 | Green preflight still reports what it cannot prove | Subprocess run | PASS |
| 24.5 | Production + console transport rejected | Subprocess run | PASS |
| 24.6 | Production + Freebuff issuer rejected | Subprocess run | PASS |
| 24.7 | Production + arbitrary external issuer rejected | Subprocess run | PASS |
| 24.8 | Production without sender rejected | Subprocess run | PASS |
| 24.9 | Production + Freebuff sender domain rejected | Subprocess run | PASS |
| 24.10 | Missing provider credential = explicit config failure | Subprocess run | PASS |
| 24.11 | Lingering `OTP_EMAIL_API_KEY` rejected | Subprocess run | PASS |
| 24.12 | Lingering `VLY_APP_NAME` rejected | Subprocess run | PASS |
| 24.13 | Known server secret via `VITE_` rejected | Subprocess run | PASS |
| 24.14 | Any `VITE_` secret-shaped variable rejected | Subprocess run | PASS |
| 24.15 | Credential values never printed in output | Subprocess run | PASS |
| 24.16 | Absent deployment env resolves to production | Subprocess run | PASS |
| 24.17 | Typo refused rather than guessed | Subprocess run | PASS |
| 24.18 | Whitespace-only value treated as absent | Subprocess run | PASS |
| 24.19 | Case/whitespace normalised for recognised values only | Subprocess run | PASS |
| 24.20 | Normalisation never yields a permissive mode | Subprocess run | PASS |
| 24.21 | Preview allows console + explicit legacy issuer | Subprocess run | PASS |
| 24.22 | Preview affordances do not weaken production | Subprocess run | PASS |
| 24.23 | P1 always-exit-0 mutation caught | 13 failures | PASS |
| 24.24 | P2 `VITE_` sweep removed, caught | 1 failure | PASS |
| 24.25 | P3 retired-var check disabled, caught | 2 failures | PASS |
| 24.26 | P4 required-prod-vars disabled, caught | 1 failure | PASS |
| 24.27 | P5 sender-domain check disabled, caught | 1 failure | PASS |
| 24.28 | `_generated/*` unchanged, zero drift | `git status` | PASS |

### Blocked — no Convex deployment (Evidence D)

| ID | Check | Blocker | Result |
| --- | --- | --- | --- |
| 24.29 | `npx convex codegen` against a real deployment | No `CONVEX_DEPLOYMENT`; control plane unreachable | BLOCKED |
| 24.30 | Staging/preview deployment created | Same | BLOCKED |
| 24.31 | OTP send / verify / session / refresh / logout / re-login | Same | BLOCKED |
| 24.32 | Entitlement charge, WAIT free, exhausted LOCKED, bypass fails | Same (Evidence C passes) | BLOCKED |
| 24.33 | Provenance against deployed backend | Same (Evidence C passes) | BLOCKED |
| 24.34 | Fan-out timeout / partial failure / rate limit / deadline | Same (Evidence C passes) | BLOCKED |
| 24.35 | Cache cold / warm / single-flight / expiry / recovery | Same (Evidence C passes) | BLOCKED |
| 24.36 | User A cannot reach user B data on a real deployment | Same (Evidence C passes) | BLOCKED |
| 24.37 | Live provider matrix from the Convex environment | All provider hosts unreachable (HTTP 000) | BLOCKED |
| 24.38 | Real OTP email delivered and inbox-placed | No provider account, no domain | BLOCKED |
| 24.39 | Sender identity confirmed on a received email | Same | BLOCKED |
| 24.40 | Cross-platform runtime against live backend | Needs deployed backend | BLOCKED |
| 24.41 | Sender domain SPF / DKIM / DMARC verified | No registered domain | BLOCKED |
| 24.42 | Production routes served from the real origin | Same | BLOCKED |

**Phase 186 totals: 28 executed and PASS, 14 blocked, 0 failed, 0 manufactured.**

---

## 25. Phase 187 — Distributed abuse protection

Evidence level **C** for policy and atomicity; **D BLOCKED** for real Convex
durability and production contention.

### Executed — AUTOMATED

| ID | Check | Result |
| --- | --- | --- |
| 25.1 | Limiter state lives in a Convex table, not module memory | PASS |
| 25.2 | Auth provider consults the durable mutation, not the in-memory throttle | PASS |
| 25.3 | Email address never stored; only a SHA-256 identity hash | PASS |
| 25.4 | State shared across independent backend contexts | PASS |
| 25.5 | Limiter survives process recreation | PASS |
| 25.6 | Allowance expires as the rolling window advances | PASS |
| 25.7 | Expired rows reclaimable without affecting decisions | PASS |
| 25.8 | 20 concurrent sends consume exactly the permitted number | PASS |
| 25.9 | Cooldown enforced atomically across 10 concurrent retries | PASS |
| 25.10 | Interleaved bursts never exceed the window ceiling | PASS |
| 25.11 | Check-and-record are one mutation; no public query to race | PASS |
| 25.12 | A rejected request does not extend the cooldown | PASS |
| 25.13 | Storage failure fails closed, driven through the real provider | PASS |
| 25.14 | Refusal ordered before delivery | PASS |
| 25.15 | Failure message does not disclose the limiter as the cause | PASS |
| 25.16 | Delivery failure does not refund the allowance | PASS |
| 25.17 | Cooldown 60s, ceiling 5/hour, window 1h | PASS |
| 25.18 | Hourly ceiling binds independently of the cooldown | PASS |
| 25.19 | Casing/padding cannot evade the limit | PASS |
| 25.20 | Distinct identities have independent allowances | PASS |
| 25.21 | No competing failed-attempt counter added | PASS |
| 25.22 | Library attempt limit configured and bounded | PASS |
| 25.23 | Replay prevented upstream by delete-on-use | PASS |
| 25.24 | remaining=1, 10 concurrent chargeable: exactly one consumes | PASS |
| 25.25 | Usage monotonic; clamp can never grant allowance | PASS |
| 25.26 | WAIT and NO_TRADE remain free | PASS |
| 25.27 | Chargeability derived from engine output, not the client | PASS |
| 25.28 | Forged Premium rejected; plan resolved server-side | PASS |
| 25.29 | grantPremium not reachable from a client button; preserves usage | PASS |
| 25.30 | Storage reset and device switch share entitlement | PASS |
| 25.31 | Unauthenticated caller cannot consume or read allowance | PASS |
| 25.32 | Limiter returns no counters to the caller | PASS |
| 25.33 | Throttle message reveals only a wait time | PASS |
| 25.34 | No OTP/key/token/address in limiter or provider source | PASS |
| 25.35 | Limiter internal; cannot be probed by a client | PASS |
| 25.36 | Throttle rejection does not disclose account existence | PASS |
| 25.37 | One indexed mutation per send attempt | PASS |
| 25.38 | Indexed read, no table scan | PASS |
| 25.39 | Hot key cannot grow stored array without bound | PASS |
| 25.40 | Cleanup work per invocation capped | PASS |
| 25.41 | Phase 185b console/issuer guarantees intact | PASS |
| 25.42 | No Freebuff OTP dependency in the runtime path | PASS |
| 25.43 | OTP expiry policy unchanged (10 min) | PASS |
| 25.44 | Work per analysis bounded by a fixed leg list | PASS |
| 25.45 | 15s wave and per-provider budgets intact | PASS |
| 25.46 | Unauthenticated rejected before provider work | PASS |
| 25.47 | Invalid input rejected before acquisition | PASS |
| 25.48 | Client evidence stripped before the engine runs | PASS |
| 25.49 | Entitlement is the per-identity spend control | PASS |
| 25.50 | No hidden retry loop amplifying provider calls | PASS |
| 25.51 | Client artifacts contain no limiter internals | PASS |

### Mutation ledger — all caught

| ID | Mutation | Failures |
| --- | --- | --- |
| 25.52 | A1 atomicity removed (interleaved reads) | 15 |
| 25.53 | A2 cooldown removed | 8 |
| 25.54 | A3 hourly ceiling disabled | 4 |
| 25.55 | A4 OTP throttle disabled entirely | 12 |
| 25.56 | A5 allowance reset on every read | 9 |
| 25.57 | A6 limiter failure fails open | 1 (after fix) |
| 25.58 | A6b limiter never consulted | 4 |
| 25.59 | A7 unlimited remaining | 11 |
| 25.60 | A8 entitlement consumption removed | 10 |
| 25.61 | A9 server chargeability bypassed | 18 |

### Blocked — Evidence D

| ID | Check | Blocker | Result |
| --- | --- | --- | --- |
| 25.62 | Real Convex durability of limiter state | No deployment | BLOCKED |
| 25.63 | Multi-instance contention at production scale | Same | BLOCKED |
| 25.64 | Real OCC retry behaviour under load | Same | BLOCKED |
| 25.65 | Provider load behaviour under sustained abuse | Same + no provider egress | BLOCKED |
| 25.66 | Cross-platform abuse runs against a live backend | Same | BLOCKED |

**Phase 187 totals: 61 executed and PASS, 5 blocked, 0 failed, 0 manufactured.**

---

## 26. Phase 188 — Guest / free-trial product surface

Evidence **C** (rendered DOM + real component paths). Physical-device and
browser click-through remain HUMAN/BLOCKED.

### Executed — AUTOMATED

| ID | Check | Result |
| --- | --- | --- |
| 26.1 | Loading does not guess a plan | PASS |
| 26.2 | Loading does not guess a remaining count | PASS |
| 26.3 | Unauthenticated renders nothing, not a trial claim | PASS |
| 26.4 | Server trial count renders exactly | PASS |
| 26.5 | Premium renders unlimited, no finite trial count | PASS |
| 26.6 | Premium with remaining=0 does not render exhausted | PASS |
| 26.7 | Unknown remaining does NOT become "0 remaining" (defect 1 fixed) | PASS |
| 26.8 | Absent remaining field treated as unknown | PASS |
| 26.9 | A genuine server zero still renders exhausted | PASS |
| 26.10 | Component performs no entitlement arithmetic | PASS |
| 26.11 | Locked notice states a signal exists and is withheld | PASS |
| 26.12 | LOCKED never rewritten as WAIT/NO_TRADE | PASS |
| 26.13 | Locked DOM contains no LONG/SHORT/BUY/SELL (innerHTML) | PASS |
| 26.14 | Locked DOM exposes no entry/stop/target/confidence | PASS |
| 26.15 | No hidden-but-present actionable nodes | PASS |
| 26.16 | Server redaction withholds every protected field | PASS |
| 26.17 | Redaction builds from safe fields, unknown fields withheld | PASS |
| 26.18 | WAIT and NO_TRADE are not chargeable | PASS |
| 26.19 | Directional verdicts remain chargeable | PASS |
| 26.20 | Locked notice states free outcomes stay free | PASS |
| 26.21 | A WAIT verdict is delivered, never locked | PASS |
| 26.22 | Copy does not claim usage when nothing consumed | PASS |
| 26.23 | UI reads entitlement from the server query only | PASS |
| 26.24 | Entitlement never persisted to localStorage/cookies | PASS |
| 26.25 | No optimistic decrement anywhere in the UI | PASS |
| 26.26 | Extra client plan field cannot flip badge to Premium (defect 2 fixed) | PASS |
| 26.27 | Only the server plan value selects the Premium branch | PASS |
| 26.28 | Client-supplied plan is not sent to the server | PASS |
| 26.29 | Upgrade CTA mutates nothing | PASS |
| 26.30 | Upgrade surface invents no commercial terms | PASS |
| 26.31 | Dashboard distinguishes each server status | PASS |
| 26.32 | Provider degradation not rendered as NO_TRADE | PASS |
| 26.33 | Unauthenticated does not render an exhausted badge | PASS |
| 26.34 | All nine locales define every entitlement key | PASS |
| 26.35 | No locale falls back to the English locked sentence | PASS |
| 26.36 | The {count} placeholder survives translation in all nine | PASS |
| 26.37 | No hardcoded English entitlement text in the component | PASS |
| 26.38 | Locked notice announced via role=status | PASS |
| 26.39 | Meaning survives with icons stripped (colour-independent) | PASS |
| 26.40 | Upgrade control is a button with a discernible label | PASS |
| 26.41 | Inert upgrade button is genuinely disabled | PASS |
| 26.42 | Engine never invoked from client source | PASS |
| 26.43 | Dashboard reaches analysis only via the protected action | PASS |
| 26.44 | Dev toolbar gated out of production | PASS |
| 26.45 | Engine absent from the production bundle | PASS |
| 26.46 | Toolbar internals tree-shaken from the bundle | PASS |
| 26.47 | No provider secret in the bundle | PASS |

### Mutation ledger — all caught

| ID | Mutation | Failures |
| --- | --- | --- |
| 26.48 | M1 loading renders Premium | 3 |
| 26.49 | M2 query failure becomes 0 remaining | 2 |
| 26.50 | M3 LOCKED rewritten to WAIT | 1 |
| 26.51 | M4 directional payload exposed in locked DOM | 3 |
| 26.52 | M5 server redaction disabled | 2 |
| 26.53 | M6 optimistic local decrement | 6 |
| 26.54 | M7 localStorage restores allowance | 2 |
| 26.55 | M8 client Premium claim trusted | 2 (after fix) |
| 26.56 | M8b fuzzy plan matching | 1 |
| 26.57 | M9 accessibility announcement removed | 1 |

### HUMAN — requires a person at a device

| ID | Check | Result |
| --- | --- | --- |
| 26.58 | Guest sees correct allowance in a real browser | NOT VERIFIED |
| 26.59 | Allowance persists across refresh and back/forward | NOT VERIFIED |
| 26.60 | Two tabs never show fabricated extra allowance | NOT VERIFIED |
| 26.61 | Private window shows no carried-over trial state | NOT VERIFIED |
| 26.62 | Locked rendering on Android | NOT VERIFIED |
| 26.63 | Locked rendering on iOS | NOT VERIFIED |
| 26.64 | Locked rendering on Windows desktop | NOT VERIFIED |
| 26.65 | Screen-reader announcement on a real AT stack | NOT VERIFIED |

### Blocked — Evidence D

| ID | Check | Blocker | Result |
| --- | --- | --- | --- |
| 26.66 | Live entitlement countdown against a deployed backend | No Convex deployment | BLOCKED |
| 26.67 | Cross-device same-identity allowance | Same | BLOCKED |

**Phase 188 totals: 57 executed and PASS, 8 HUMAN/NOT VERIFIED, 2 blocked, 0 failed, 0 manufactured.**

---

## 27. Phase 189 — Onboarding & first-run experience

Evidence class: **C** (automated, local). Browser/device rows remain HUMAN;
live OTP delivery and live providers remain BLOCKED by the sandbox egress
allow-list (npm + GitHub API only).

### 27.1 Defects found and fixed

| # | Defect | Severity | Status |
|---|--------|----------|--------|
| D1 | `src/pages/Auth.tsx` was 100% hardcoded English — no `useI18n` at all — on the first screen a new user sees. Survived 188 phases because every localization guard was an enumerated file list and none walked `src/pages/`. | High (invariant 7) | FIXED — 24 `auth` keys × 9 locales |
| D2 | History loading collapsed to `[]`, so an unresolved Convex query rendered "No history yet". Loading presented as genuine emptiness. | High (req. 1/8) | FIXED — distinct `isLoading` branch + `role="status"` |
| D3 | `errors.checkApiKey` shipped "Check that TWELVE_DATA_API_KEY is configured…" to every client in all 9 locales, naming internal config to end users. Key had zero consumers. | Medium (req. 14) | FIXED — key removed from types + 9 locales |
| D4 | `console.error("Email sign-in error:", error)` logged raw rejections that can carry provider bodies, request URLs, tokens and stack traces. | Medium (req. 14) | FIXED — fixed-category `reportAuthDiagnostic`, no error binding |
| D5 | Phase 188 bundle assertions were **vacuous**: `dist/` had been built without `VITE_CONVEX_URL`, so main.tsx short-circuited to a "not configured" notice and the artifact contained almost no app code. Every `not.toContain` passed trivially. | High (CI false-green) | FIXED — real-build detection + engine-symbol assertions |
| D6 | `src/pages/Landing.tsx` carries ~40 hardcoded strings, much of it Indonesian prose rendered to all 9 locales. | High | OPEN — recorded in the `KNOWN_UNLOCALIZED` ratchet, scheduled next phase |

### 27.2 Automated rows (AUTOMATED — Evidence C)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Unauthenticated landing shows email entry, does not navigate | PASS |
| 2 | Auth copy explains the 6-digit code and "no password" | PASS |
| 3 | No vendor/provider name is user-visible on the auth surface | PASS |
| 4 | Decision-support boundary stated on the first screen | PASS |
| 5 | No permanent-login promise anywhere in auth copy | PASS |
| 6 | Guest path offered with an honest limit description | PASS |
| 7 | Auth loading does NOT redirect as authenticated | PASS |
| 8 | Loading-but-authenticated still waits for resolution | PASS |
| 9 | Resolved session redirects without a new OTP | PASS |
| 10 | Session restoration never re-prompts for OTP | PASS |
| 11 | OTP step names the destination address | PASS |
| 12 | Code validity stated (10 minutes) | PASS |
| 13 | Stated validity equals backend `OTP_EXPIRY_MINUTES` | PASS |
| 14 | Resend cooldown expectation set (spam folder, ~1 minute) | PASS |
| 15 | Recovery path back to the email step exists | PASS |
| 16 | OTP field carries an accessible label | PASS |
| 17 | Session note says "until the session expires" | PASS |
| 18 | Send failure shows a retryable message, no raw error | PASS |
| 19 | No provider payload reaches ANY console channel | PASS |
| 20 | Emitted diagnostic is a fixed safe category | PASS |
| 21 | No catch block binds the error value on the auth path | PASS |
| 22 | Diagnostic helper accepts no error argument | PASS |
| 23 | Failures announced via `role="alert"` | PASS |
| 24 | Never implies success after a failed operation | PASS |
| 25 | Failed guest sign-in fabricates no session | PASS |
| 26 | Deep link returns to the requested internal route | PASS |
| 27 | External `returnTo` refused → `/dashboard` | PASS |
| 28 | Protocol-relative and scheme tricks refused | PASS |
| 29 | Hardened resolver used, not raw params | PASS |
| 30 | Loading history does NOT claim the account is empty | PASS |
| 31 | Loading announced politely (`aria-live`) | PASS |
| 32 | Genuinely empty account still says so | PASS |
| 33 | Dashboard derives loading from the unresolved query | PASS |
| 34 | Every history call site forwards the loading flag | PASS |
| 35 | Loading is a distinct branch, not a variant of empty | PASS |
| 36 | Email field required and typed | PASS |
| 37 | Verify button disabled until the code is complete | PASS |
| 38 | Invalid input rejected before provider fan-out | PASS |
| 39 | Invalid input consumes no entitlement | PASS |
| 40 | Validation guard is reachable, not short-circuited (executed) | PASS |
| 41 | Failed provider leg surrenders no data | PASS |
| 42 | Skipped leg surrenders no data | PASS |
| 43 | Timed-out leg surrenders no data | PASS |
| 44 | Genuine success still returns data | PASS |
| 45 | Degradation distinct from an empty result | PASS |
| 46 | Dashboard calls only the protected action | PASS |
| 47 | No second analysis entry point | PASS |
| 48 | First-run guide shows the three required steps | PASS |
| 49 | Guide states WAIT/NO_TRADE are free | PASS |
| 50 | Guide describes LOCKED as withheld, never converted to WAIT | PASS |
| 51 | Guide invents no commercial terms | PASS |
| 52 | Guide hidden when history exists | PASS |
| 53 | Guide dismissible and stays dismissed | PASS |
| 54 | Guide gated on RESOLVED-empty, never on loading | PASS |
| 55 | Guide renders no data of its own (no queries) | PASS |
| 56 | Guide creates no second analysis path | PASS |
| 57 | Guide survives blocked localStorage | PASS |
| 58 | All 9 locales define all 24 `auth` keys | PASS |
| 59 | All 9 locales define all 9 `onboarding` keys | PASS |
| 60 | No locale silently falls back to the English sentence | PASS |
| 61 | `{email}` / `{minutes}` placeholders survive translation | PASS |
| 62 | No locale hardcodes the OTP lifetime | PASS |
| 63 | Brand preserved untranslated in every locale | PASS |
| 64 | No locale leaks a provider name in auth copy | PASS |
| 65 | No hardcoded English remains in the Auth page | PASS |
| 66 | Email input has accessible name + description | PASS |
| 67 | Icon-only submit has a discernible label | PASS |
| 68 | Disabled states are real attributes | PASS |
| 69 | Secondary buttons declare `type="button"` | PASS |
| 70 | No OTP/token/email value logged | PASS |
| 71 | No Convex internal function name user-visible | PASS |
| 72 | No analytics SDK added for onboarding | PASS |
| 73 | Page guard discovers page files (non-vacuous) | PASS |
| 74 | Page guard covers `src/pages/` | PASS |
| 75 | Planted JSX prose is caught | PASS |
| 76 | Planted hardcoded placeholder is caught | PASS |
| 77 | Planted hardcoded aria-label is caught | PASS |
| 78 | Localized expressions are not flagged | PASS |
| 79 | Known-debt ratchet cannot rot (entry must still have violations) | PASS |
| 80 | Bundle scanned is a real build, not a stub | PASS |
| 81 | No engine symbol ships to the client | PASS |
| 82 | No secret VALUE or key prefix in the bundle | PASS |
| 83 | No user-facing string names an internal env var | PASS |

### 27.3 Mutation ledger (all 8 mandated + verification)

| ID | Mutation | Result | Failing tests |
|----|----------|--------|---------------|
| M1 | auth loading → authenticated | CAUGHT | 1 |
| M2 | invalid input → success | CAUGHT | 1 |
| M3 | WAIT → chargeable | CAUGHT | 2 |
| M4 | LOCKED → WAIT | CAUGHT | 2 |
| M5 | entitlement/history loading → zero | CAUGHT | 1 |
| M6 | provider failure → success | CAUGHT | 3 |
| M7 | protected deep link → external URL | CAUGHT | 1 |
| M8 | English fallback when translation missing | CAUGHT | 1 |

M2 and M6 initially **SURVIVED** and were fixed by strengthening the
assertions, not the expectations:

- **M2** — ordering assertions read source TEXT, so `if (false && …)` left the
  text intact. Replaced with extraction and real execution of the production
  predicate, plus a short-circuit check.
- **M6** — nothing asserted that a non-success leg yields no data. Added five
  behavioural tests over `successfulData`.

Harness note: an earlier M7 run reported a phantom SURVIVED because the
harness used `git diff` to confirm the mutation applied, which is meaningless
in an uncommitted tree. Byte comparison (`cmp`) against the backup is now used.

### 27.4 Vacuity probes

| Probe | Expected | Observed |
|-------|----------|----------|
| Stub `dist/` (no `VITE_CONVEX_URL`) | bundle rows SKIP, never pass | 44 passed / **5 skipped** |
| Engine symbol planted in real bundle | fail | **1 failed** (test 19) |
| Planted page-level hardcoded string | caught by guard | caught |

### 27.5 HUMAN (not executed by the agent)

| # | Scenario | Status |
|---|----------|--------|
| H1 | Real browser first-run click-through | HUMAN — NOT VERIFIED |
| H2 | Keyboard-only traversal of the auth flow | HUMAN — NOT VERIFIED |
| H3 | Screen-reader announcement of OTP errors | HUMAN — NOT VERIFIED |
| H4 | Session restored after real browser restart | HUMAN — NOT VERIFIED |
| H5 | Android app restart retains session | HUMAN — NOT VERIFIED |
| H6 | iOS app restart retains session | HUMAN — NOT VERIFIED |
| H7 | Windows desktop restart retains session | HUMAN — NOT VERIFIED |
| H8 | Mobile deep link resumes the intended safe route | HUMAN — NOT VERIFIED |
| H9 | Visual review of the guide in all 9 locales | HUMAN — NOT VERIFIED |

### 27.6 BLOCKED (environment)

| # | Scenario | Blocker |
|---|----------|---------|
| B1 | Real OTP email arrives and validates | No egress to the email provider |
| B2 | Live entitlement against a deployed Convex | No `CONVEX_DEPLOYMENT` |
| B3 | Provider degradation against live providers | Provider hosts unreachable (HTTP 000) |

**Totals: 83 PASS (AUTOMATED) · 9 HUMAN — NOT VERIFIED · 3 BLOCKED.**

## 28. Phase 190 — Landing page localization & public-copy truthfulness

Scope: `src/pages/Landing.tsx`, the nine locale catalogues, `index.html`
metadata, and the public-route surface. The governing rule for this section is
that a public claim is a product guarantee: it must be traceable to implemented
behaviour, in every language.

### 28.1 Localization coverage

| # | Case | Method | Result |
|---|------|--------|--------|
| 28.1.1 | `landing` section exists in all 9 locales, 55 keys each | `public-copy-truthfulness.phase190.test.ts` | PASS |
| 28.1.2 | Locale key sets identical (no extra/misspelled key) | Automated | PASS |
| 28.1.3 | Canonical leaf count 908 → 963 | `phase145-localization.test.ts` | PASS |
| 28.1.4 | No locale value empty | Automated | PASS |
| 28.1.5 | No non-en locale falls back to the English sentence | Automated | PASS |
| 28.1.6 | No Indonesian markers leak into the other 8 locales | Automated | PASS |
| 28.1.7 | Every declared landing key is rendered (no dead keys) | Automated | PASS |
| 28.1.8 | Only literal JSX text on Landing is the brand | Automated | PASS |
| 28.1.9 | `KNOWN_UNLOCALIZED` empty; ratchet retained | `page-localization-guard.phase189.test.ts` | PASS |
| 28.1.10 | All 6 public pages walked by the guard | Automated | PASS |

### 28.2 Truthfulness of public claims

| # | Claim audited | Evidence | Result |
|---|---------------|----------|--------|
| 28.2.1 | "institutional-grade AI" removed | Unverifiable marketing | PASS |
| 28.2.2 | "presisi tinggi" / high-precision removed | Implied accuracy claim | PASS |
| 28.2.3 | "+ any symbol" replaced with provider-conditional wording | No whitelist exists, but provider must answer | PASS |
| 28.2.4 | "index futures" + US30 removed | `indices` absent from `InstrumentInput` selector | PASS |
| 28.2.5 | Funding/OI/liquidation/long-short scoped to crypto + conditional | `coinglass.ts` gates on `COINGLASS_API_KEY` | PASS |
| 28.2.6 | Calendar/macro conditional | `tradingEconomics.ts` gates on `TICKATLAS_API_KEY` | PASS |
| 28.2.7 | Conviction stated as neither win rate nor probability | `ConvictionLevel` ordinal; 0 probability refs in engine | PASS |
| 28.2.8 | No profit/accuracy/win-rate promise in any locale | Negation-aware scanner ×9 | PASS |
| 28.2.9 | Every locale carries an explicit profit-guarantee denial | Automated ×9 | PASS |
| 28.2.10 | No bank-grade / SOC 2 / regulated / WCAG-certified claim | Automated ×9 | PASS |
| 28.2.11 | No blanket "real-time" claim | Automated ×9 | PASS |
| 28.2.12 | No-fabrication guarantee present in all locales | Automated ×9 | PASS |
| 28.2.13 | No-execution guarantee present in all locales | Automated ×9 | PASS |
| 28.2.14 | BOS/CHoCH, FVG/order block, MTF W1→M5 claims | Verified in `analysis-engine.ts` | PASS |

### 28.3 Branding, metadata, routes, accessibility

| # | Case | Method | Result |
|---|------|--------|--------|
| 28.3.1 | No Freebuff/vly branding in public page source | Automated | PASS |
| 28.3.2 | No env-var name or dev URL in public copy | Automated | PASS |
| 28.3.3 | `freebuff:locale` storage key retained (migration, not branding) | Documented non-defect | NOT APPLICABLE |
| 28.3.4 | `TWELVE_DATA_API_KEY` in registry is a name, not a secret | Documented non-defect | NOT APPLICABLE |
| 28.3.5 | Title + description present, no untrue claim | Real `dist/index.html` | PASS |
| 28.3.6 | No canonical/og:url inventing a domain | Automated | PASS |
| 28.3.7 | `<html lang>` declared and follows locale | Phase 173 + automated | PASS |
| 28.3.8 | `/`, `/auth`, `/download`, `/privacy`, `/terms`, `/nonexistent` → 200 | SPA host, real build | PASS |
| 28.3.9 | Assets absolute, deep links survive refresh | `dist/index.html` inspected | PASS |
| 28.3.10 | Single h1, ordered headings | Automated | PASS |
| 28.3.11 | No hardcoded aria-label; `homeAriaLabel` translated | Automated | PASS |
| 28.3.12 | Decorative icons `aria-hidden` | Automated | PASS |
| 28.3.13 | No clickable-div controls | Automated | PASS |
| 28.3.14 | Visual rendering at 320/768/1440 in all 9 locales | No headless browser in env | HUMAN |
| 28.3.15 | Colour-contrast verification | Requires rendering | HUMAN |
| 28.3.16 | Keyboard tab order on the public surface | Requires a browser | HUMAN |

### 28.4 Layout resilience (text expansion)

Worst measured expansion vs English: `signIn` ×2.00 (es "Iniciar sesión"),
`principleCapitalTitle` ×1.92 (pt), `outputPlanLabel` ×1.90 (pt). Translations
were **not** shortened; the layout absorbs them.

| # | Case | Method | Result |
|---|------|--------|--------|
| 28.4.1 | Weight rows no longer `whitespace-nowrap` | Automated | PASS |
| 28.4.2 | Hero badge wraps instead of overflowing | Automated | PASS |
| 28.4.3 | Header brand truncates before auth buttons shrink | Automated | PASS |
| 28.4.4 | Icons beside text cannot be squashed (`shrink-0`) | Automated | PASS |
| 28.4.5 | No fixed pixel width constrains translated text | Automated | PASS |

### 28.5 Mutation suite — `scripts/mutation-suite-phase190.sh`

10 mutations applied to a byte-exact backup and verified with `cmp`; a mutation
that changes no bytes is reported INVALID rather than passing silently.

| # | Mutation | Result |
|---|----------|--------|
| M1 | Reinsert a hardcoded Landing string | CAUGHT |
| M2 | Remove a landing key from `de` | CAUGHT |
| M3 | Revert a `de` translation to English | CAUGHT |
| M4 | Rename a key in `en` only | CAUGHT |
| M5 | Reinsert Freebuff branding | CAUGHT |
| M6 | Add a guaranteed-accuracy claim | CAUGHT |
| M7 | Turn live-data wording absolute | CAUGHT |
| M8 | Reinstate the "any symbol" promise | CAUGHT |
| M9 | Advertise index futures | CAUGHT |
| M10 | Invent a compliance claim | CAUGHT |

**10 / 10 caught.**

### 28.6 Vacuity controls

| # | Control | Result |
|---|---------|--------|
| 28.6.1 | Bundle proven real before scanning (1.59M chars, 3/3 positive markers) | PASS |
| 28.6.2 | Build performed with `VITE_CONVEX_URL` set — a stub build is not evidence | PASS |
| 28.6.3 | Overclaim detector fires on 4 planted claims | PASS |
| 28.6.4 | Overclaim detector does **not** fire on 3 honest negated forms | PASS |
| 28.6.5 | Comment-stripping prevents a fix's own explanation from being read as a claim | PASS |

### 28.7 Defects found and fixed in this phase

| # | Defect | Fix |
|---|--------|-----|
| D1 | `ASSET_CLASS_LABEL` keyed `index` while `InstrumentType` is `indices` — label unreachable, raw union value would render | Re-keyed to `Record<InstrumentType, string>` so the compiler catches drift |
| D2 | `homeAriaLabel` declared but never consumed (same shape as the Phase 189 dead-key leak) | Wired to the header home link; dead-key test added |
| D3 | Header could overflow at 320px with the longest locale | Brand truncates, auth controls `shrink-0` |
| D4 | Landing logo was a plain `<a href="/">`, forcing a full reload | Switched to react-router `Link` |

## 29. Phase 191 — Authenticated-surface copy truthfulness

Scope: the signed-in product. The governing rule is stricter than Phase 190's:
a visitor who over-trusts marketing copy has lost nothing yet, while a user
reading a position dashboard may be about to risk capital on it.

### 29.1 Confidence / conviction semantics

| # | Case | Method | Result |
|---|------|--------|--------|
| 29.1.1 | `confidence` is a clamped 20-88 confluence heuristic, not a probability | `analysis-engine.ts` L1580 | PASS |
| 29.1.2 | No locale equates confidence/conviction with probability or win rate | Negation-aware scan ×9 | PASS |
| 29.1.3 | Detector catches 3 planted probability claims | Automated | PASS |
| 29.1.4 | Detector does not flag honest negations | Automated | PASS |
| 29.1.5 | **DEFECT D1** — `AnalysisHistory` rendered a bare `{confidence}%` beside a directional bias | Fixed: ordinal conviction label | PASS |
| 29.1.6 | History and result panel use identical conviction thresholds (70/50) | Automated | PASS |

### 29.2 Provenance / freshness / cache wording

Provenance modes existed since Phase 178c but only as English diagnostics. A
`provenance` section (13 keys ×9) and `src/lib/i18n/provenance-copy.ts` now map
acquisition state to translated, user-facing copy. Tests call the real mapping
functions with real modes, not string constants.

| # | Case | Method | Result |
|---|------|--------|--------|
| 29.2.1 | All 8 acquisition modes yield distinct non-empty copy ×9 | `describeAcquisitionForUser` | PASS |
| 29.2.2 | `cache-reused` never reads as a new observation | Automated ×9 | PASS |
| 29.2.3 | Only observed-now / observed-shared / uncached-by-design may present as current | `mayPresentAsCurrent` | PASS |
| 29.2.4 | Failure modes never claim completeness or verification | Automated ×9 | PASS |
| 29.2.5 | Evidence age shown only when an observation exists | Real `recordProvenance` | PASS |
| 29.2.6 | A 1-hour-old cache hit reports its age, never "just now" | Automated | PASS |
| 29.2.7 | `formatEvidenceAge` never reports a negative age | Automated | PASS |
| 29.2.8 | Historical records never described as live/current | Automated ×9 | PASS |
| 29.2.9 | Degraded described as missing evidence, not a market verdict | Automated ×9 | PASS |
| 29.2.10 | **DEFECT D2** — system-health labels could read as market verdicts | Guarded across healthy/degraded/failed | PASS |
| 29.2.11 | Freshness levels stay mutually distinct ×9 | Automated | PASS |

### 29.3 Freshness source integrity (usedAt ≠ observedAt)

| # | Case | Evidence | Result |
|---|------|----------|--------|
| 29.3.1 | **DEFECT D3** — `Dashboard` set `observedAt = price.timestamp \|\| fetchTimestamp` | Fetch time is not observation time; `assessFreshness` graded hours-old data FRESH | PASS (fixed) |
| 29.3.2 | An `as RadarCandidateSource` cast was suppressing the type error | `observedAt` now optional; compiler enforces it | PASS |
| 29.3.3 | Snapshot without observation time cannot be realtime | `provider-registry.ts` degrades to `unavailable` | PASS |
| 29.3.4 | Missing observation recorded as sentinel 0, never `Date.now()` | Automated | PASS |

### 29.4 Execution boundary

| # | Case | Method | Result |
|---|------|--------|--------|
| 29.4.1 | **DEFECT D4** — `protection.noAutoExecute` + `protection.confidenceNotProbability` translated ×9 but rendered NOWHERE | Now rendered in the monitoring header | PASS |
| 29.4.2 | No authenticated surface claims an order was placed | Negation-aware scan | PASS |
| 29.4.3 | Every locale's no-auto-execute string denies automation | Automated ×9 | PASS |
| 29.4.4 | No locale implies a broker/exchange acknowledged anything | Automated ×9 | PASS |
| 29.4.5 | Test asserts on rendered JSX, not comments mentioning the key | Comment-stripped scan | PASS |

### 29.5 LOCKED ≠ WAIT, risk, completeness, errors

| # | Case | Result |
|---|------|--------|
| 29.5.1 | Every locale states LOCKED is not a Wait verdict | PASS |
| 29.5.2 | Locked copy never leaks the withheld direction (LONG/SHORT/BUY/SELL) | PASS |
| 29.5.3 | WAIT / NO_TRADE remain free | PASS |
| 29.5.4 | No locale guarantees stops, fills or loss bounds | PASS |
| 29.5.5 | Completeness labels distinct; none implies provider verification | PASS |
| 29.5.6 | No locale exposes credentials, env vars, Convex internals or stack traces | PASS |
| 29.5.7 | Distinct failure kinds keep distinct copy (outage ≠ "no data") | PASS |

### 29.6 Localization

| # | Case | Result |
|---|------|--------|
| 29.6.1 | Canonical leaves 963 → 977 (`provenance` 13 + `auth.restoringSession`) | PASS |
| 29.6.2 | `{age}` placeholder registered and preserved ×9 | PASS |
| 29.6.3 | No English fallback in provenance copy | PASS |
| 29.6.4 | No Indonesian leakage into other locales | PASS |
| 29.6.5 | **DEFECT D5** — `RequireAuth` shipped hardcoded "restoring session..." to every user | PASS (localized) |
| 29.6.6 | Guard extended to `src/components` (was never walked) | PASS |
| 29.6.7 | 15 components recorded in `COMPONENT_DEBT` ratchet; list may only shrink | NOT VERIFIED (deferred) |

**Component localization debt is REAL and RECORDED, not hidden.** 15 of 29
authenticated components still contain hardcoded English (AnalysisResult alone
has 36 strings). Machine-translating trading terminology under time pressure
would violate the Phase 190 standard, so the debt is ratcheted: files not on
the list must stay clean, and files on it fail the suite once fixed.

### 29.7 Mutation suite — `scripts/mutation-suite-phase191.sh`

| # | Mutation | Result |
|---|----------|--------|
| M1 | confidence → probability | CAUGHT |
| M2 | conviction → win rate | CAUGHT |
| M3 | history shows raw `confidence%` | CAUGHT |
| M4 | LOCKED → WAIT | CAUGHT |
| M5 | LOCKED leaks direction | CAUGHT |
| M6 | cache-reused → "Observed now" | CAUGHT |
| M7 | cache allowed to present as current | CAUGHT |
| M8 | unavailable → "complete and verified" | CAUGHT |
| M9 | degraded → "no opportunity — wait" | CAUGHT |
| M10 | historical → live | CAUGHT |
| M11 | monitoring → execution | CAUGHT |
| M12 | stop rendering the no-exec boundary | CAUGHT |
| M13 | suggested stop → guaranteed stop | CAUGHT |
| M14 | `observedAt` ← `fetchTimestamp` | CAUGHT |
| M15 | no observation → realtime | CAUGHT |
| M16 | remove a locale key | CAUGHT |
| M17 | English fallback | CAUGHT |
| M18 | rename `{age}` placeholder | CAUGHT |
| M19 | plant hardcoded copy in a clean component | CAUGHT |

**19 / 19 caught.** M8, M9, M12 and M13 initially SURVIVED and were fixed by
strengthening assertions — never by weakening expectations. M9 exposed a
second unguarded key (`system.degraded`), and M13 required matching a value
that wraps onto a continuation line.

### 29.8 Vacuity controls

| # | Control | Result |
|---|---------|--------|
| 29.8.1 | Bundle proven real before scanning (1.6M chars, 3/3 markers) | PASS |
| 29.8.2 | Stub `dist/` produces 4 explicit SKIPs, never a false pass | PASS (probed) |
| 29.8.3 | Negation-aware bundle scan separates "not a win rate" from a win-rate claim | PASS |
| 29.8.4 | A stale artifact fails the marker check (observed accidentally, then fixed) | PASS |

### 29.9 Accessibility / responsive / cross-platform

| # | Case | Result |
|---|------|--------|
| 29.9.1 | Authenticated routes `/dashboard`, `/journal` resolve under SPA rewrite | PASS |
| 29.9.2 | No platform-specific copy or entitlement logic | PASS |
| 29.9.3 | Visual rendering of the monitoring header at 320/768/1440 | HUMAN |
| 29.9.4 | Screen-reader announcement of the execution-boundary line | HUMAN |
| 29.9.5 | Keyboard traversal of authenticated surfaces | HUMAN |

### 29.10 Defects found and fixed

| # | Defect | Fix |
|---|--------|-----|
| D1 | `AnalysisHistory` rendered `{confidence}%` beside a bias — reads as a probability | Ordinal conviction label via `mapConfidence` |
| D2 | `system.degraded` could be reworded into a market verdict | Health-state guard across all 9 locales |
| D3 | `observedAt` fell back to `fetchTimestamp`, letting stale data grade FRESH | Observation time never back-filled; type made optional so the compiler enforces it |
| D4 | No-auto-execution + confidence-not-probability guarantees translated but never rendered | Rendered in the position-monitoring header |
| D5 | `RequireAuth` shipped hardcoded "restoring session..." | Localized as `auth.restoringSession` ×9 |

## 30. Phase 192 — Mutation-gap closure (chargeability & fan-out failure)

Two mutations SURVIVED the full suite when the Phase 189 harness was re-run
after the sandbox was re-provisioned. Both are now caught. The harness itself
was previously `/tmp`-only and has been persisted to
`scripts/mutation-suite-phase189.sh` so this evidence is reproducible.

| # | Case | Method | Expected | Status |
| --- | --- | --- | --- | --- |
| 30.1 | `WAIT` consumes no entitlement | automated (25 tests) | never chargeable | PASS |
| 30.2 | `NO_TRADE` / `NO TRADE` / `HOLD` / `AVOID` free | automated | never chargeable | PASS |
| 30.3 | `INSUFFICIENT_DATA` / `UNAVAILABLE` free | automated | never chargeable | PASS |
| 30.4 | Case/whitespace variants stay free | automated | normalised, free | PASS |
| 30.5 | `BUY`/`SELL`/`LONG`/`SHORT` still chargeable | automated | inverse holds | PASS |
| 30.6 | Unknown/empty values fail closed to free | automated | free | PASS |
| 30.7 | PREMIUM plan never counted | automated | usage unchanged | PASS |
| 30.8 | Deny-list present as explicit safety layer | structural | layer exists | PASS |
| 30.9 | Rejected leg is `failed`, carries no data | automated | no payload | PASS |
| 30.10 | Provider `success:false` envelope is a failure | automated | `failed` | PASS |
| 30.11 | Unsettled leg at fan-out deadline is `failed` | automated | never `success` | PASS |
| 30.12 | Finished legs keep real results in a cut-short wave | automated | preserved | PASS |
| 30.13 | M2 invalid-input → DELIVERED | mutation | CAUGHT | PASS |
| 30.14 | M3 deny-list deleted | mutation | CAUGHT | PASS |
| 30.15 | M4 LOCKED → WAIT | mutation | CAUGHT | PASS |
| 30.16 | M6 fan-out failure → success | mutation | CAUGHT | PASS |
| 30.17 | Mutation restore is byte-exact (`cmp`) | harness | clean tree | PASS |
| 30.18 | Vacuity: bundle gates assert with real `dist/` | 18→3 skips | gates active | PASS |
| 30.19 | CI verified by job conclusion, not exit code | `gh api` | 4 success | PASS |
| 30.20 | Reachable-history secret scan | CI | expected failure (Phase 184) | BLOCKED |

**Known limitation, stated not hidden.** `ACTIONABLE` and `NON_ACTIONABLE` are
disjoint, so removing the deny-list changes no outcome today and *no black-box
test can witness it*. Case 30.8 therefore asserts the layer's presence
structurally. It is retained because the moment an upstream value like
`STRONG_BUY` appears, the deny-list is what keeps WAIT free.

## 31. Phase 193 — i18n key triage, protection/intelligence surfaces

Full evidence: `docs/I18N-KEY-AUDIT.md`. Classification artifacts are
regenerated by the guard, never hand-maintained.

| # | Case | Method | Expected | Status |
| --- | --- | --- | --- | --- |
| 31.1 | Protection surface still mounted and rendered | AUTOMATED | Dashboard → PositionProtectionDashboard renders | PASS |
| 31.2 | Intelligence surface still mounted and rendered | AUTOMATED | IntelligenceDashboard renders, 87 keys consumed | PASS |
| 31.3 | System health surface still rendered | AUTOMATED | RuntimeHealthDashboard on the system tab | PASS |
| 31.4 | Market badge renders translated LIVE label | AUTOMATED | `t.market.live`, not "LIVE" | PASS |
| 31.5 | Market badge renders translated STALE label | AUTOMATED | `t.market.stale` | PASS |
| 31.6 | Unavailable badge exposes an accessible name | AUTOMATED | aria-label present | PASS |
| 31.7 | Source-transparency legend is translated | AUTOMATED | `t.market.sourceTransparency` | PASS |
| 31.8 | Legend differs per locale (no English fallback) | AUTOMATED | 9 distinct strings | PASS |
| 31.9 | Legend keeps the LIVE/STALE tokens it explains | AUTOMATED | tokens preserved | PASS |
| 31.10 | Locale switching re-renders the legend | AUTOMATED | ja renders ja copy | PASS |
| 31.11 | No locale falls back to English for new key | AUTOMATED | all 9 defined | PASS |
| 31.12 | Removed dead keys absent from all 9 locales | AUTOMATED | 5 keys gone | PASS |
| 31.13 | `*Label` replacements survive removal | AUTOMATED | still present | PASS |
| 31.14 | Nine-locale parity after the change | AUTOMATED | 973 leaves each | PASS |
| 31.15 | Orphan detector is non-vacuous | AUTOMATED | >600 referenced | PASS |
| 31.16 | Allowlist rejects a stale entry | AUTOMATED | self-validating | PASS |
| 31.17 | Allowlist rejects an entry that gained a consumer | AUTOMATED | fails | PASS |
| 31.18 | Only `tx()` is a production dynamic site | AUTOMATED | asserted | PASS |
| 31.19 | Indirect consumers (enum-mapping) credited | AUTOMATED | not reported dead | PASS |
| 31.20 | Interpolation idiom `.replace()` credited | AUTOMATED | not reported dead | PASS |
| 31.21 | Mutations M1–M9 | AUTOMATED | 9/9 | PASS |
| 31.22 | New copy ships in the real bundle (9 locales) | AUTOMATED | markers found | PASS |
| 31.23 | Visual check: badge legible in all 9 locales | HUMAN | no clipping/overflow | NOT VERIFIED |
| 31.24 | Screen-reader announces the badge correctly | HUMAN | aria-label read aloud | NOT VERIFIED |
| 31.25 | Protection/intelligence tabs clicked through in a browser | HUMAN | surfaces render live | NOT VERIFIED |
| 31.26 | Legend wording reviewed by a native speaker (9 locales) | HUMAN | terminology correct | NOT VERIFIED |
| 31.27 | Fundamental (`fundamental.*`) surface renders with live evidence | BLOCKED | requires live providers | BLOCKED |
| 31.28 | MarketDataHealthPanel reachable in the deployed app | BLOCKED | component is unmounted by design | BLOCKED |

**Note on 31.23–31.26.** The agent environment has no headless browser and no
native speakers; these are HUMAN by necessity and are recorded as NOT VERIFIED
rather than inferred from the automated DOM assertions. The automated cases
prove the correct *string* is rendered, not that it *looks* right.

**Layout rule respected.** The nine legend translations were NOT shortened to
avoid overflow. If 31.23 finds clipping, the fix is the layout, not the copy.

## 32. Phase 194 — mounted-component localization burn-down

Re-measured with the shared detector (`src/lib/i18n/hardcoded-copy-detector.ts`).
The inherited figure of "14 components" was not accurate: 6 of those files are
UNMOUNTED, and `src/pages/Dashboard.tsx` carried debt the old list never named.

| # | Case | Method | Expected | Status |
| --- | --- | --- | --- | --- |
| 32.1 | TraderWorkspace heading localized | AUTOMATED | `t.trader.thesisDistribution` | PASS |
| 32.2 | HistoricalTimeline headings localized | AUTOMATED | 2 timeline keys | PASS |
| 32.3 | NotificationCenter controls localized | AUTOMATED | 5 keys | PASS |
| 32.4 | Journal wired to existing keys | AUTOMATED | 8 reused + 5 new | PASS |
| 32.5 | CustomAlertRulesPanel localized | AUTOMATED | 7 new + examplePrefix | PASS |
| 32.6 | Market live-counter localized | AUTOMATED | `market.liveCount` | PASS |
| 32.7 | Badge renders the LOCALE word (ja) | AUTOMATED | `ライブ`, not "LIVE" | PASS |
| 32.8 | Stale badge renders locale word (ja) | AUTOMATED | `陳腐化` | PASS |
| 32.9 | Accessible name localized (zh) | AUTOMATED | aria-label translated | PASS |
| 32.10 | Instrument symbols NOT translated | AUTOMATED | EUR/USD, BTC/USDT intact | PASS |
| 32.11 | Technical notation NOT translated | AUTOMATED | BOS/FVG/DXY/H4 intact | PASS |
| 32.12 | NO TRADE preserved as an outcome | AUTOMATED | `journal.statusNoTrade` | PASS |
| 32.13 | Nine-locale parity (994 leaves) | AUTOMATED | all locales equal | PASS |
| 32.14 | Placeholder vocabulary declared | AUTOMATED | `{example}`, `{total}` | PASS |
| 32.15 | Orphan-key budget respected | AUTOMATED | ratchet holds | PASS |
| 32.16 | Mutations M1–M9 | AUTOMATED | 9/9 | PASS |
| 32.17 | Detector has a single definition | AUTOMATED | guard + script share it | PASS |
| 32.18 | Mobile text wrapping in 9 locales | HUMAN | no clipping | NOT VERIFIED |
| 32.19 | Desktop label widths (Windows build) | HUMAN | no truncation | NOT VERIFIED |
| 32.20 | Locale switching across all tabs | HUMAN | copy updates live | NOT VERIFIED |
| 32.21 | Screen-reader announces badges | HUMAN | aria read correctly | NOT VERIFIED |
| 32.22 | Native-speaker terminology review | HUMAN | finance wording correct | NOT VERIFIED |
| 32.23 | AnalysisResult (51 strings) localized | AUTOMATED | remaining debt | NOT VERIFIED |

**Layout note.** German and Japanese strings here are longer than the English
originals (`Mindestschweregrad`, `インテリジェンスアラートがここに表示されます`).
Nothing was shortened to fit — if 32.18/32.19 find clipping, the layout is what
changes.

**32.23 is the honest remaining item.** `AnalysisResult.tsx` still holds 51
detected strings and was not localized in this phase.

## 33. Phase 195 — AnalysisResult localization & decision-semantics protection

`AnalysisResult.tsx` is the surface where the product states its actual
recommendation. Phase 194 reported it as 51 remaining strings; re-measurement
found **152** (the detector could not see single-word JSX prose, hiding 109
labels including the entry / stop loss / take profit captions). Debt on this
component is now **zero**.

The risk this phase had to manage is not cosmetic: touching the file that
renders a BUY/SELL/WAIT call can change what the engine appears to have
decided, or what the user is billed for. The safety net was therefore written
and proven BEFORE any copy was edited.

| # | Scenario | Method | Result |
|---|---|---|---|
| 33.1 | AnalysisResult mounted-string debt reaches 0 | `component-debt-inventory.mjs` | PASS (152 → 0) |
| 33.2 | Total mounted debt across all components | inventory | PASS (195 → 43) |
| 33.3 | Decision state is byte-identical across all 9 locales | 5 fixtures × JSON snapshot | PASS |
| 33.4 | `isProfitSignal` is locale-independent | semantics suite | PASS |
| 33.5 | WAIT / NO_TRADE are never chargeable in any locale | semantics suite | PASS |
| 33.6 | A translated label is rejected as an engine input | semantics suite | PASS |
| 33.7 | LOCKED direction is never rewritten to WAIT | semantics suite | PASS |
| 33.8 | No directional verb appears in WAIT copy (9 languages) | word list per locale | PASS |
| 33.9 | Conviction labels carry no probability claim | semantics suite | PASS |
| 33.10 | The 4 risk dimensions stay 4 distinct strings per locale | semantics suite | PASS |
| 33.11 | `whatInvalidates` ≠ `whatConfirms` | semantics suite | PASS |
| 33.12 | Thesis ≠ scenario; supporting ≠ conflicting | semantics suite | PASS |
| 33.13 | Every section/field label non-empty in all 9 locales | semantics suite | PASS |
| 33.14 | CFTC / EIA / MTF / SR notation survives translation | semantics suite | PASS |
| 33.15 | TVL and unlocks disclaimers keep their negation per clause | clause-scoped, script-aware | PASS |
| 33.16 | DXY notice still says unavailable, not fabricated | semantics suite | PASS |
| 33.17 | Evidence hierarchy keeps all 8 ranks in order | arrow count = 7 | PASS |
| 33.18 | ja/ko/zh contain no untranslated ASCII leftovers | script-awareness guard | PASS |
| 33.19 | Entry/stop/target reuse the canonical `protection.*` terms | key-reuse assertion | PASS |
| 33.20 | Phase 195 mutations (11 planted defects) | `mutation-suite-phase195.sh` | PASS (11/11) |
| 33.21 | Prior mutation suites still catch their defects | p189 / p191 / p193 | PASS (4/4, 19/19, 9/9) |
| 33.22 | Orphan-key budget tightened, not slackened | ratchet 261 → 259 | PASS |
| 33.23 | Nine-locale key parity at the new leaf count | parity test | PASS (9 × 1137) |
| 33.24 | Full suite / typecheck / production build / lint | CI-equivalent local run | PASS (9002 passed, 0 err, baseline 1517) |
| 33.25 | Rendered layout in ja/ko/zh at mobile width | requires a browser | HUMAN |
| 33.26 | Native-speaker review of 112 new finance strings | requires native speakers | HUMAN |
| 33.27 | Screen-reader announcement of translated labels | requires assistive tech | NOT VERIFIED |

**Known limitation (recorded, not hidden).** Automated checks prove the
*semantics* of the translations (negation retained, concepts distinct,
notation preserved, no locale-coupled decisions). They cannot prove
*idiomatic quality*. Rows 33.25–33.27 stay HUMAN / NOT VERIFIED until a
native speaker and a real browser are available; they must not be converted
to PASS on the strength of the automated suite.

## 34. Phase 196 — Journal localization & record-integrity protection

The journal is a financial record. Localization here can change what a record
*means* — a flipped P&L sign, an unknown P&L shown as 0, a translated label
written back as a stored status, or a filter that returns different rows per
language. Every row below was therefore asserted against the RECORD and the
CANONICAL values, never against rendered prose.

Re-measurement (§1) found the detector's 26 findings were an undercount: a
manual read located labels inside an array literal, a ternary and the
terminal-style `$` headings that the detector structurally cannot see. Total
localized: **43 user-facing strings**. Journal debt is now **zero**.

| # | Scenario | Method | Class | Result |
|---|---|---|---|---|
| 34.1 | Journal mounted-string debt reaches 0 | shared detector inventory | AUTOMATED | PASS (26 → 0) |
| 34.2 | Status labels render translated, never the raw enum | mapper output per locale | AUTOMATED | PASS |
| 34.3 | Outcome labels (WIN/LOSS/BREAKEVEN/PARTIAL/UNKNOWN) translated | mapper output per locale | AUTOMATED | PASS |
| 34.4 | Stored status stays canonical uppercase | record assertion | AUTOMATED | PASS |
| 34.5 | A translated label never collides with a stored enum | 9-locale check | AUTOMATED | PASS |
| 34.6 | Positive P&L never renders negative | fixture A, 9 locales | AUTOMATED | PASS |
| 34.7 | Negative P&L never renders positive | fixture B, 9 locales | AUTOMATED | PASS |
| 34.8 | Unknown P&L stays unknown, never 0 | fixture D, 9 locales | AUTOMATED | PASS |
| 34.9 | `computePnl` keeps long/short direction semantics | unit assertion | AUTOMATED | PASS |
| 34.10 | Direction of record pinned (LONG stays LONG) | explicit constants | AUTOMATED | PASS |
| 34.11 | `createdAt`/`closedAt` keep their exact epoch | fixture A, 9 locales | AUTOMATED | PASS |
| 34.12 | Date presentation follows the app locale, not the browser | component change + `<time dateTime>` | AUTOMATED | PASS |
| 34.13 | No timezone conversion introduced | diff inspection | AUTOMATED | PASS |
| 34.14 | Instrument identity survives verbatim (incl. `BTC-PERPETUAL`) | fixture E, 9 locales | AUTOMATED | PASS |
| 34.15 | No locale bundle hardcodes an instrument symbol | 9-locale scan | AUTOMATED | PASS |
| 34.16 | Every `<option value>` is canonical, labels translated | DOM assertion | AUTOMATED | PASS |
| 34.17 | Filter compares `e.status`, not a rendered label | DOM + structural | AUTOMATED | PASS (structural noted) |
| 34.18 | Locale change never alters filter results | canonical-value filtering | AUTOMATED | PASS |
| 34.19 | "No entries" ≠ "no entries match filters" ≠ NO_TRADE | 9-locale distinctness | AUTOMATED | PASS |
| 34.20 | Badges and both filters have localized accessible names | DOM `getByLabelText` | AUTOMATED | PASS |
| 34.21 | No English-only aria-label beside translated UI | ja render | AUTOMATED | PASS |
| 34.22 | Canonical value preserved in `data-status`/`data-outcome` | DOM attribute | AUTOMATED | PASS |
| 34.23 | Nine-locale key + placeholder parity | parity suite | AUTOMATED | PASS (9 × 1169) |
| 34.24 | Orphan-key budget tightened, not widened | ratchet 259 → 235 | AUTOMATED | PASS |
| 34.25 | Phase 196 mutations (14 planted defects) | `mutation-suite-phase196.sh` | AUTOMATED | PASS (14/14) |
| 34.26 | Prior mutation suites still catch their defects | p189/p191/p193/p195 | AUTOMATED | PASS (4/19/9/11) |
| 34.27 | Journal exposes no tokens, keys, OTP or user ids | source scan | AUTOMATED | PASS |
| 34.28 | No new telemetry; no record logged for debugging | source scan | AUTOMATED | PASS |
| 34.29 | Full suite / typecheck / build / lint / secret scan / mobile | CI-equivalent local run | AUTOMATED | PASS (9045 passed, lint 1517 baseline) |
| 34.30 | Mobile wrapping of long German status labels | requires a browser | HUMAN | NOT VERIFIED |
| 34.31 | Desktop width with ja/ko badge text | requires a browser | HUMAN | NOT VERIFIED |
| 34.32 | Screen-reader announcement of translated badges | requires assistive tech | HUMAN | NOT VERIFIED |
| 34.33 | Live locale switching with entries on screen | requires a browser | HUMAN | NOT VERIFIED |
| 34.34 | Native-speaker review of 32 new finance strings | requires native speakers | HUMAN | NOT VERIFIED |

**Structural-vs-behavioural disclosure (§15).** Row 34.17 is partly
structural: the filter predicate is a closure over component state and cannot
be observed from the DOM without seeded entries, which this component does not
accept as a prop (it holds entries in local state). The mutation M10 is caught
by a source assertion, and this is recorded as STRUCTURAL coverage rather than
claimed as behavioural.

**Layout (§13).** No clipping could be observed without a browser. Rows
34.30–34.33 stay NOT VERIFIED. Translations were NOT shortened to pre-empt
layout problems — German `Handelbarkeit` and `Fingerabdruck` are kept at full
length per the standing rule.

## 35. Phase 197 — Historical timeline localization & evidence integrity

The historical timeline is an **evidence** surface: it tells a trader what the
engine believed before, what it believes now, and therefore whether a thesis is
degrading. Localization here must change language only — never which fields are
marked as changed, never the direction of a transition, never the instrument.

Re-measurement (§1) reported **6** findings in this component. A full manual
read found **three** defect classes, and only the first was detector-visible:

1. six caption strings (`Current:`, `Previous:`, `Changed:`, `Also:`,
   `Evidence:`, `changed`);
2. **detector-blind** — the comparison table's labels lived in an array literal
   and its values rendered **raw enums**, so a Japanese user read
   `HIGHER_HIGHS_HIGHER_LOWS`;
3. **detector-blind** — `event.description` and `summary.interpretation` are
   English prose assembled with template literals in a lib file and rendered
   verbatim in all nine locales.

Defect 3 carried a hard constraint: `description` is **persisted**, so it is
localized at *render* time from the event's structured fields and the stored
English string is left byte-identical. The engine's emitted sentences were
verified unchanged by checksum before and after.

| # | Check | How | Who | Result |
|---|---|---|---|---|
| 35.1 | Six captions render from the dictionary in 9 locales | phase197 suite | AUTOMATED | PASS |
| 35.2 | No raw enum spelling reaches a non-English screen | phase197 suite | AUTOMATED | PASS |
| 35.3 | Structure/momentum/volatility values translated per locale | phase197 suite | AUTOMATED | PASS |
| 35.4 | Mapper output ≠ canonical enum in every non-English locale | phase197 suite | AUTOMATED | PASS |
| 35.5 | Instrument identity (`BTC/USDT`) never translated | phase197 suite | AUTOMATED | PASS |
| 35.6 | `changed` computed from raw enums, not translations | phase197 suite | AUTOMATED | PASS (structural — see 35.16) |
| 35.7 | Identical snapshots produce zero change markers in 9 locales | phase197 suite | AUTOMATED | PASS |
| 35.8 | Lib comparison engine still operates on canonical enums | phase197 suite | AUTOMATED | PASS |
| 35.9 | Stored English description not rendered in other locales | phase197 suite | AUTOMATED | PASS |
| 35.10 | Transition renders translated endpoints, arrow preserved | phase197 suite | AUTOMATED | PASS |
| 35.11 | INITIAL_ANALYSIS keeps instrument + side, translated thesis | phase197 suite | AUTOMATED | PASS |
| 35.12 | Unreconstructable event falls back, never invents copy | phase197 suite | AUTOMATED | PASS |
| 35.13 | Rendering never mutates the persisted `description` | phase197 suite | AUTOMATED | PASS |
| 35.14 | Event clock bound to app locale, not host locale | phase197 suite | AUTOMATED | PASS |
| 35.15 | Engine's persisted English sentences pinned exactly | phase197 suite | AUTOMATED | PASS |
| 35.16 | No two states share a translation within a domain/locale | phase197 suite | AUTOMATED | PASS |
| 35.17 | `interpretationParts` agree with the English `interpretation` | phase197 suite | AUTOMATED | PASS |
| 35.18 | Nine-locale key + placeholder parity | parity suite | AUTOMATED | PASS (9 × 1191) |
| 35.19 | HistoricalTimeline removed from `COMPONENT_DEBT` | guard suite | AUTOMATED | PASS |
| 35.20 | Orphan ratchet tightened 235 → 232 | orphan guard | AUTOMATED | PASS |
| 35.21 | Mutation suite (12 mutations incl. 1 control) | phase197 script | AUTOMATED | PASS (12/12) |
| 35.22 | All prior mutation suites still green | 189/191/193/195/196 | AUTOMATED | PASS (57/57) |
| 35.23 | Native-speaker review of 22 new strings × 9 locales | read each locale | HUMAN | NOT VERIFIED |
| 35.24 | Long structure labels do not clip at narrow widths | resize to 320 px | HUMAN | NOT VERIFIED |

**Disclosure — 35.6 is structural, not behavioural.** Mutation M4 rewrote the
change predicate to compare *translated* strings and **survived**: no two enum
values currently share a translation in any locale, so the rewritten predicate
returns identical booleans. It is an *equivalent mutant* today but a latent
defect tomorrow, so it is caught by asserting the source contains no mapper call
inside a `changed:` expression, and the no-collision property that makes it
equivalent is itself asserted (35.16). This is declared rather than counted as
behavioural coverage.

**Gap found by mutation and closed.** M9 rewrote the engine's persisted
description template and initially **survived** — Phase 90/91 only use those
strings as round-trip fixtures, so nothing pinned what the engine actually
emits. The template could have been changed, invalidating every persisted row,
with the suite green. Row 35.15 closes it.

**35.23/35.24 are NOT VERIFIED, not PASS.** No headless browser or native
speaker is available in this environment; they must not be reported as working.

---

## 35b. Phase 197 — Remaining components & the zero-debt invariant

Four further components were cleaned after the timeline. The detector reported
**11** strings across them; a full read found **23**. Every extra finding sat in
a construct the detector cannot parse: array literals, `title` attributes,
`toast` calls inside callbacks, and ternaries.

**InstrumentInput** (6 reported → 8 real). The load-bearing risk here is that
each `<SelectItem>` `value` is a canonical `InstrumentType` routed to provider
adapters. Labels are translated; values are not.

**CustomAlertRulesPanel** (2 reported → 8 real), **NotificationCenter**
(2 → 5), **PositionProtectionPanel** (1 → 1).

| # | Check | How | Who | Result |
|---|---|---|---|---|
| 35b.1 | SelectItem values remain canonical InstrumentType enums | phase197 input suite | AUTOMATED | PASS |
| 35b.2 | No translation is ever interpolated into a `value` attribute | phase197 input suite | AUTOMATED | PASS |
| 35b.3 | Four asset-type labels distinct + non-empty in 9 locales | phase197 input suite | AUTOMATED | PASS |
| 35b.4 | Terminal headings localized, `$` prompt preserved | phase197 input suite | AUTOMATED | PASS |
| 35b.5 | Trading-style buttons routed through `mapHorizon` | phase197 input suite | AUTOMATED | PASS |
| 35b.6 | Style click handler still submits the canonical value | phase197 input suite | AUTOMATED | PASS |
| 35b.7 | Provider-native symbols verbatim in 9 locales | phase197 input suite | AUTOMATED | PASS |
| 35b.8 | No English literals remain in the three panels | phase197 alerts suite | AUTOMATED | PASS |
| 35b.9 | Every copy-rendering `useCallback` depends on the translator | phase197 alerts suite | AUTOMATED | PASS |
| 35b.10 | Notification filter tokens stay canonical | phase197 alerts suite | AUTOMATED | PASS |
| 35b.11 | Filter compares the value, never the label | phase197 alerts suite | AUTOMATED | PASS |
| 35b.12 | New keys complete + non-empty in 9 locales | phase197 alerts suite | AUTOMATED | PASS |
| 35b.13 | `{name}` preserved in the rule-created toast, all locales | phase197 alerts suite | AUTOMATED | PASS |
| 35b.14 | Show/hide and success/failure wording distinguishable | phase197 alerts suite | AUTOMATED | PASS |
| 35b.15 | Backend error reasons still preferred over generic copy | phase197 alerts suite | AUTOMATED | PASS |
| 35b.16 | **No MOUNTED component carries localization debt** | guard suite | AUTOMATED | PASS |
| 35b.17 | Reachability walk proven non-vacuous (anchors asserted) | guard suite | AUTOMATED | PASS |
| 35b.18 | Nine-locale key + placeholder parity | parity suite | AUTOMATED | PASS (9 × 1207) |
| 35b.19 | Orphan ratchet retightened 235 → 228 | orphan guard | AUTOMATED | PASS |
| 35b.20 | Mutation suite (23 mutations incl. 1 control) | phase197 script | AUTOMATED | PASS (23/23) |
| 35b.21 | All six mutation suites green | 189/191/193/195/196/197 | AUTOMATED | PASS (80/80) |
| 35b.22 | Native-speaker review of 40 new strings × 9 locales | read each locale | HUMAN | NOT VERIFIED |
| 35b.23 | Toast/dropdown layout at narrow widths | resize to 320 px | HUMAN | NOT VERIFIED |

**Two defects found that were not localization defects.** Localizing the alert
toasts exposed `useCallback`s that would have captured the language at mount —
switch locale, delete a rule, and the confirmation appears in the old language.
Fixed by adding the translator to the dependency arrays and pinned by 35b.9.
Separately, `HEALTH_CONFIG` in PositionProtectionPanel holds five English
`label` fields that **nothing reads** — superseded by `mapThesisHealth`. Per the
standing rule on unused code it was recorded, not deleted.

**The zero-debt state is now enforced, not just achieved (35b.16).**
`COMPONENT_DEBT` may only contain UNMOUNTED components; mountedness is
recomputed by walking imports from `src/main.tsx` inside the guard rather than
trusting a generated artifact. Mutation M23 proves it fails when a mounted
component is re-added, and 35b.17 proves the walk is not vacuously empty. If
one of the six tracked unmounted components is ever wired up, this guard fails
until it is localized in the same change.

**35b.22/35b.23 are NOT VERIFIED, not PASS.**

---

## 35c. Phase 198 — Credential exposure audit & remediation rehearsal

Scope: re-measure the leaked OTP credential across **full** history, test the
rotation gate, and rehearse the rewrite on a disposable mirror. The credential
value is never printed; identity is by fingerprint
`sha256(value+"\n")[0:16] = b1ce18a1e85ba121`, length 33.

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 35c.1 | History is complete, not shallow | `git fetch --unshallow`; `rev-parse --is-shallow-repository` | PASS — `false`, 53 → **339** commits |
| 35c.2 | Scanning a shallow clone is refused | verifier against a `--depth=1` clone | PASS — refuses, exit 2 |
| 35c.3 | Fingerprint matches the Phase 184 record | sha256 of the extracted literal | PASS — `b1ce18a1e85ba121`, len 33 |
| 35c.4 | Distinct leaked blobs | blob walk over `rev-list --objects --all` | PASS — **1** (`e490ffda`) |
| 35c.5 | Affected paths | same | PASS — **1** (`src/convex/auth/emailOtp.ts`) |
| 35c.6 | Affected commits | per-commit `ls-tree` | PASS — **270 / 339** |
| 35c.7 | Oldest / newest affected | `git log` | PASS — `a71ea7f` 2026-08-20 → `3a82789` 2026-09-11 |
| 35c.8 | All refs enumerated (incl. unfetched remote branch) | `git ls-remote` vs local | PASS — 4 real refs; `phase-157` was missing locally and was fetched |
| 35c.9 | `main` tip status | `ls-tree` at tip | **TIP-EXPOSED** — serves the credential today |
| 35c.10 | `phase-157-live-discovery-lifecycle` tip status | same | **TIP-EXPOSED** |
| 35c.11 | Working branch + `rc-181` tip status | same | tip-clean (history still affected: 269 each) |
| 35c.12 | Credential kind classified | redacted blob read | PASS — hardcoded `x-api-key` for `auth.freebuff.app` |
| 35c.13 | Current source reads the key from env, not source | `grep` HEAD | PASS — `process.env[key]` |
| 35c.14 | Issuer reachable for rotation | `curl` | **BLOCKED** — HTTP 000 |
| 35c.15 | Block is egress, not a dead host | DNS + control hosts | PASS — DNS resolves; GitHub/npm HTTP 200 |
| 35c.16 | Issuer credential present for rotation | env inspection | **BLOCKED** — none set |
| 35c.17 | Revocation evidence obtainable | all of the above | **BLOCKED** — none; no revocation claimed |
| 35c.18 | Rewrite rehearsed on a disposable mirror only | fresh `--mirror` clone in `/tmp` | PASS |
| 35c.19 | Zero occurrences after rewrite (blob walk) | fingerprint scan, all refs | PASS — **0** |
| 35c.20 | Zero occurrences after rewrite (independent method) | `git grep -F`, all refs | PASS — **0** |
| 35c.21 | Scan is not vacuous | same method on unmodified `main` | PASS — finds **1**, so "clean" is meaningful |
| 35c.22 | Commit count preserved | `rev-list --count --all` | PASS — 339 → **339** |
| 35c.23 | Per-ref commit counts preserved | `rev-list --count` | PASS — 338/261/262 unchanged |
| 35c.24 | Author, email, timestamp, subject preserved | md5 of `%an\|%ae\|%at\|%s` | PASS — `b9b2dd5c…` identical |
| 35c.25 | Parent topology preserved | md5 of parent counts | PASS — `5af69801…` identical |
| 35c.26 | Working-branch tree byte-identical | tree diff old vs new tip | PASS — **0 files changed** |
| 35c.27 | Only the secret file changed elsewhere | tree diff on the 2 contaminated refs | PASS — only `emailOtp.ts` |
| 35c.28 | Change is exactly one line, no structural damage | line diff + `wc -l` | PASS — 1 line; 37 → 37 lines |
| 35c.29 | Production repo untouched | `HEAD`, `main`, `status --porcelain` | PASS — `835a254`, `51c9dde`, 0 dirty |
| 35c.30 | Remote untouched, no force-push | `git ls-remote` | PASS — all refs at original SHAs |
| 35c.31 | Verifier exit codes correct | 3 invocations | PASS — 2 (shallow) / 1 (exposed) / 0 (clean) |
| 35c.32 | Old credential proven revoked | — | **BLOCKED** — cannot be verified in this environment |
| 35c.33 | History rewrite applied to the real repository | — | **NOT APPLICABLE** — forbidden until 35c.32 clears |

**35c.32 is the phase verdict.** A successful rehearsal (35c.18–35c.31) does not
close Phase 184. Removing the credential from Git history does not retract it:
until it is dead at the issuer it remains valid in every existing clone, fork
and cache. Rewriting first would destroy the audit trail while changing nothing
about the actual exposure. **BLOCKED is therefore the correct and final state of
this phase**, and must never be converted to PASS on the strength of the
rehearsal alone.

---

## 35d. Phase 199 — Convex deployment & production backend readiness

Scope: evidence-based audit of what is still required for a real Convex
production deployment. No history rewrite, no `main` change, no secret printed,
no generated file hand-edited.

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 35d.1 | Branch / commit / clean tree | `git status` | PASS — `7ae8eed`, 0 dirty |
| 35d.2 | `CONVEX_DEPLOYMENT` present | env inspection | **BLOCKED** — unset |
| 35d.3 | `CONVEX_DEPLOY_KEY` present | env inspection | **BLOCKED** — unset |
| 35d.4 | `CONVEX_SITE_URL` present | preflight | **BLOCKED** — unset |
| 35d.5 | `convex.json` valid | file read | PASS — `functions: "src/convex/"` |
| 35d.6 | Auth issuer policy self-only in production | source + preflight | PASS — fails closed; retired hosts named |
| 35d.7 | Official codegen runs | `npx convex codegen` | **BLOCKED** — "No CONVEX_DEPLOYMENT set" |
| 35d.8 | No generated file hand-edited | `git status` on `_generated` | PASS — untouched |
| 35d.9 | Generated drift (source ↔ `api.d.ts`) | comparison script | PASS — zero drift, 23 modules |
| 35d.10 | Phase 187 `otpLimiter` entry status | grep + module read | PASS as consistent; **pending official regeneration** |
| 35d.11 | `otpLimiter.ts` is a real module, not a stub | file + export read | PASS — exports `consumeResendAllowance` |
| 35d.12 | Control-plane DNS | `getent hosts` | resolves (all 3 hosts) |
| 35d.13 | Control-plane TCP :443 | `/dev/tcp` probe | **OPEN** |
| 35d.14 | Control-plane TLS | `curl` | **FAILS** — `SSL_ERROR_SYSCALL` ~40ms |
| 35d.15 | Same-network controls | `curl` GitHub/npm | PASS — HTTP 200 |
| 35d.16 | Failure classified | 35d.12–15 combined | **unavailable egress**, NOT missing/invalid credentials |
| 35d.17 | HTTP 000 not used as auth/revocation evidence | documented | PASS — explicitly excluded |
| 35d.18 | Preflight fails closed with no config | `node scripts/verify-deployment-config.mjs` | PASS — exit 1, 3 FAILs |
| 35d.19 | Preflight never claims deployment success | output + test | PASS — disclaims in output and in `notVerified` |
| 35d.20 | New check: no Freebuff runtime OTP dependency | preflight | PASS — 32 modules scanned |
| 35d.21 | That check detects a planted real call | mutation M1b | PASS — caught at `emailDelivery.ts:88` |
| 35d.22 | That check does NOT flag denylist entries | mutation M3 (control) | PASS — survives, no false positive |
| 35d.23 | New check: runtime modules wired | preflight | PASS — 7 modules |
| 35d.24 | That check detects a removed export | mutation M2 | PASS — caught `consumeProfitSignal` |
| 35d.25 | That check handles destructured exports | regression test | PASS — no false failure on `auth.ts` |
| 35d.26 | Email code supports Resend and SMTP2GO | source read | PASS — both implemented |
| 35d.27 | `console` transport forbidden in production | source + test | PASS — hard error |
| 35d.28 | No Freebuff email fallback | source + preflight | PASS — throws before any network call |
| 35d.29 | Email account / API key provisioned | — | **BLOCKED** — human + billing |
| 35d.30 | Registered domain + verified sender | — | **BLOCKED** — no domain owned; none invented |
| 35d.31 | SPF / DKIM / DMARC | — | **BLOCKED** — requires the real domain |
| 35d.32 | Real OTP inbox delivery | — | **BLOCKED** — requires 35d.29–31 |
| 35d.33 | Evidence D minimum checklist defined | `docs/CONVEX-DEPLOYMENT-READINESS.md` §6 | PASS — D1–D10 |
| 35d.34 | Evidence D captured | — | **BLOCKED** — no deployment exists |
| 35d.35 | Full suite / tsc / build / lint | see §7 of the phase report | PASS — 9095 tests, tsc 0, build 0, lint 1517 |

**35d.34 is the phase verdict.** A passing preflight validates configuration and
source wiring only. It is not a deployment, a successful build is not Evidence
D, and none of auth, OTP delivery, entitlement enforcement or live providers may
be described as operational until they are observed against a deployed Convex
environment.

---

## 35e. Phase 200 — Convex unblock handoff & zero-friction readiness

Scope: make the project executable the moment `*.convex.dev` access and
deployment credentials exist. Baseline `5b3f0c4`. No history rewrite, no `main`
change, no generated file hand-edited, no fake credential or domain created.

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 35e.1 | Baseline locked | `git rev-parse` | PASS — `5b3f0c4`, clean, `main` untouched |
| 35e.2 | Preflight still fails closed with values missing | `convex:preflight` | PASS — exit 1, 3 FAILs |
| 35e.3 | Diagnostic separates DNS failure | `verify-convex-access.mjs` | PASS — DNS layer reported independently |
| 35e.4 | Diagnostic separates TCP failure | same | PASS — TCP :443 probed separately |
| 35e.5 | Diagnostic separates TLS failure | same | PASS — **ECONNRESET, "severed mid-negotiation"** |
| 35e.6 | Diagnostic separates HTTP reachability | same | PASS — distinct layer |
| 35e.7 | Diagnostic separates reachable-but-unauthenticated | same | PASS — `UNAUTHENTICATED` state |
| 35e.8 | Diagnostic separates authenticated access | same | PASS — `AUTHENTICATED` state, exit 0 |
| 35e.9 | Transport failure never reported as auth failure | test + code | PASS — `isAuthEvidence: false` |
| 35e.10 | Transport failure never reported as revocation evidence | test | PASS — `isRevocationEvidence: false` |
| 35e.11 | Auth probe skipped when unreachable | code | PASS — "would be meaningless" |
| 35e.12 | Credential value never printed | test w/ sentinel | PASS — fingerprint only (8 hex) |
| 35e.13 | Machine-readable output | `--json` | PASS |
| 35e.14 | Operator-readable output | default | PASS |
| 35e.15 | Same-network controls reported | `--json` | PASS — ≥2 controls |
| 35e.16 | TLS-interception CA not misread as an outage | control classification | PASS — E2B Proxy CA detected, path reported working |
| 35e.17 | Handoff steps A–H dependency-safe and ordered | test | PASS — order asserted |
| 35e.18 | Handoff records the baseline commit | test | PASS |
| 35e.19 | No step requiring unavailable credentials was executed | review | PASS — none run |
| 35e.20 | `otpLimiter` workaround recorded, not patched | `codegen-authority` suite | PASS — `_generated` untouched |
| 35e.21 | Post-codegen assertion defined | same | PASS — flips on official `internal.*` in code |
| 35e.22 | That assertion catches a half-migration | mutation M1 | PASS — caught after detector fix |
| 35e.23 | Workaround/limiter export pinned together | mutation M2 | PASS — rename caught |
| 35e.24 | `_generated` must contain no manual-workaround markers | test | PASS |
| 35e.25 | Preflight: no localhost/dev endpoint in production | test | PASS — rejected |
| 35e.26 | Preflight: no placeholder production domain | test | PASS — rejected |
| 35e.27 | Preflight: no plain http in production | test | PASS — rejected |
| 35e.28 | Preflight: no fake/example credential | test | PASS — rejected, value not echoed |
| 35e.29 | Preflight: plausible ≠ valid | test | PASS — detail says NOT VERIFIED |
| 35e.30 | Preflight: silent when nothing configured | test | PASS — no false alarm |
| 35e.31 | No overlapping scanner created | review | PASS — extended the existing script |
| 35e.32 | Evidence D harness defines exactly D1–D10 | test | PASS — in order |
| 35e.33 | Harness refuses localhost / 127.0.0.1 | test | PASS — exit 2 |
| 35e.34 | Harness refuses plain http | test | PASS — exit 2 |
| 35e.35 | Harness refuses a non-Convex host | test | PASS — exit 2 |
| 35e.36 | Harness refuses an unreachable deployment | manual run | PASS — refuses, invents nothing |
| 35e.37 | A refusal marks all ten BLOCKED, zero PASS | test | PASS |
| 35e.38 | D1 is HUMAN-attested, not inferred from HTTP 200 | code + test | PASS |
| 35e.39 | Evidence D never ACHIEVED while any check is blocked | test | PASS |
| 35e.40 | Evidence D actually captured | — | **BLOCKED** — no deployment exists |
| 35e.41 | Live provider inventory recorded (names only) | handoff §2 | PASS — 7 entries, no values |
| 35e.42 | Email inventory recorded (names only) | handoff §3 | PASS — no placeholder production values |
| 35e.43 | Release gate categorizes external vs code-ready | `RELEASE-GATE.md` | PASS — 7 external, 8 code-ready |
| 35e.44 | Full suite / tsc / build / lint / secret scan | §10 | PASS — **9131 passed / 3 skipped / 254 files**, tsc 0, build 0, lint 1517 = baseline |

**35e.40 is the phase verdict.** Phase 200 is not a deployment. The diagnostic
reports transport state, the preflight validates configuration, and the harness
is ready to execute — but until D1–D10 are captured against a real Convex
deployment, the backend is **NOT VERIFIED**, and no claim may be made about
production auth, OTP delivery, entitlement enforcement or live providers.

---

## 35f. Phase 202 — Post-codegen reference migration

Codegen ran against dev deployment `tough-goose-455` on the operator's
machine. The generated `internal.otpLimiter.consumeResendAllowance` reference
is now used directly by `src/convex/auth/emailOtp.ts`, replacing the Phase 187
`makeFunctionReference` string workaround.

Rows below verify the migration did not change **runtime** behaviour. The
compile-time proof is automated (see `codegen-authority.phase200.test.ts`);
these rows exist because a reference swap can typecheck perfectly and still
resolve to nothing at runtime if the deployed function set differs from the
generated types.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 35f.1 | Deploy the branch to the dev deployment, request an OTP for a fresh address | Code is delivered; no `Could not find public function` / `function not found` error in the Convex logs | BLOCKED — needs deployment + mailbox |
| 35f.2 | Request a second OTP for the same address within 60 s | Resend is refused by the **durable** limiter (not the in-memory one); Convex logs show `otpLimiter:consumeResendAllowance` executing | BLOCKED — needs deployment |
| 35f.3 | Wait out the 60 s window, request again | Resend is allowed; a new code arrives | BLOCKED — needs deployment + mailbox |
| 35f.4 | Exceed 5 resends in one hour | 6th resend refused with the hourly reason; refusal survives a server restart (durable, not in-memory) | BLOCKED — needs deployment |
| 35f.5 | Inspect Convex logs for the OTP send path | No error category leakage beyond the documented collapsed categories; no raw code or recipient in logs | BLOCKED — needs deployment |

**Why these are BLOCKED, not PASS:** the sandbox cannot reach
`tough-goose-455.convex.cloud` (TLS egress block), and a passing typecheck is
not evidence that the deployed backend exposes the function. These rows become
executable by the operator on the machine where codegen succeeded. They are a
subset of Evidence D and must not be reported as working until run.

## 35g. Phase 203 — Evidence D execution against a real deployment

`npm run evidence:d` now derives its target from the configured environment and
executes D1–D10 over HTTP. The sandbox cannot reach any Convex deployment
(HTTP 000), so the rows below are executed by the operator on the machine where
the deployment is reachable.

**A development run is not production evidence.** A fully green run against a
`dev:` deployment is labelled `DEV_VERIFIED — NOT PRODUCTION EVIDENCE`, and
`productionEvidence: true` is emitted only for a real `prod:` deployment.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 35g.1 | `npm run evidence:d` with the dev deployment configured | Runs; report header shows the dev deployment host and `[development]` | BLOCKED — operator machine |
| 35g.2 | Inspect the report class | `DEV_VERIFIED — NOT PRODUCTION EVIDENCE`; `productionEvidence: false` | BLOCKED — operator machine |
| 35g.3 | `npm run evidence:d -- --production-evidence` against the dev deployment | Refused, exit 2, `NOT EXECUTED` | BLOCKED — operator machine |
| 35g.4 | D3 with no session | `UNAUTHENTICATED`, `result: null` | BLOCKED — operator machine |
| 35g.5 | D1 with a real mailbox | Code arrives; operator supplies it (HUMAN-attested) | BLOCKED — needs email transport + mailbox |
| 35g.6 | D1 with `XSTARZ_EMAIL_TRANSPORT=console` | D1 BLOCKED, run stops; a log-scraped code is never accepted as delivery | BLOCKED — operator machine |
| 35g.7 | D4 on a fresh identity | `GUEST`, `remaining = 2` | BLOCKED — operator machine |
| 35g.8 | D5 when the engine yields BUY/SELL | Exactly one signal consumed | BLOCKED — operator machine |
| 35g.9 | D6 when the engine yields WAIT/NO_TRADE | Zero consumed | BLOCKED — operator machine |
| 35g.10 | D7 past the allowance | `LOCKED` | BLOCKED — operator machine |
| 35g.11 | D8 on the LOCKED payload | None of the 18 protected fields present; only `hadActionableSignal` | BLOCKED — operator machine |
| 35g.12 | D9 forged provider evidence inside `input` | Forged price/source/spec absent from the result | BLOCKED — operator machine |
| 35g.13 | Client self-grant probe (`grantPremium`) | Rejected; plan stays `GUEST` | BLOCKED — operator machine |
| 35g.14 | D10 provenance | `observedAt` from the acquisition path, not request time | BLOCKED — needs a live provider credential |

**Vocabulary note:** D5/D6 report `NOT_VERIFIED` when live conditions do not
produce the required recommendation. That is not a failure and must never be
converted to PASS — the engine is never forced to emit a signal.

## 35h. Phase 204 — first real DEV Evidence D run: root cause

The Phase 203 harness was run against the real dev deployment
(`--auth anonymous`). D7 returned `UNAUTHENTICATED` with `used=0`, `limit=2`.

**Root cause: a genuine backend defect.** Convex Auth mints its JWT subject as
`userId|sessionId` and sets no email claim. Six modules resolved the caller
with `ctx.db.get(identity.subject)`, a lookup for a document id containing a
pipe, so every authenticated caller was treated as unauthenticated.
`users.ts` was unaffected because it uses the library helper `getAuthUserId`.

The test-suite could not have caught it: every test double mocked
`{ subject: "user_A" }`, a shape the library never produces.

D4's PASS in that run was **vacuous** — `getMyEntitlement` answers an
unauthenticated caller with the guest shape (`GUEST`, `remaining: 2`,
`used: 0`), so the assertion passed without a working session. D4 now requires
`authenticated === true`.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 35h.1 | Re-run `npm run evidence:d -- --auth anonymous --json` after deploying the fix | D4 `authenticated=true`; D5-D7 exercise the allowance | BLOCKED — needs redeploy by operator |
| 35h.2 | D7 after the fix | `LOCKED` once the allowance is exhausted | BLOCKED — needs redeploy |
| 35h.3 | D4 against a deployment WITHOUT the fix | D4 FAIL (not PASS), D5-D10 BLOCKED | BLOCKED — needs deployment |
| 35h.4 | Signed-in journal / analyses / position-protection reads | Return the user's own rows, not empty | BLOCKED — needs redeploy |

**Scope note:** the same defect silently affected `analyses`, `journal`,
`positionProtection` and `historicalIntelligence`. Any signed-in user would
have seen empty lists. This was never observable in the sandbox.

## 35i. Phase 205 — entitlement state machine vs market conditions

The real DEV run confirmed auth works (D4 `authenticated=true`), D6 `NO_TRADE`
consumed 0, and D9 anti-spoofing passed. D7 could not complete because the
engine returned `NO_TRADE` — no chargeable signal existed, so `LOCKED` was
unreachable. That is a market-condition limitation, not a product defect.

D7/D8 now report `NOT_VERIFIED — no real chargeable signal occurred`. The
entitlement state machine is verified independently through
`entitlements:consumeProfitSignal`, an already-deployed authenticated boundary
that returns accounting only and can never grant allowance.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 35i.1 | `npm run evidence:d -- --auth anonymous --json` | `entitlementStateMachine.verdict = VERIFIED` | BLOCKED — operator machine |
| 35i.2 | E1 fresh identity | `authenticated=true`, `remaining=2` | BLOCKED — operator machine |
| 35i.3 | E2 `WAIT` | `charged=false`, counter unchanged | BLOCKED — operator machine |
| 35i.4 | E3 first `BUY` | `remaining` 2 → 1, `used=1` | BLOCKED — operator machine |
| 35i.5 | E4 second `SELL` | `remaining` 1 → 0, `used=2` | BLOCKED — operator machine |
| 35i.6 | E5 third chargeable | refused, `upgradeRequired=true`, `used` stays 2 | BLOCKED — operator machine |
| 35i.7 | E6 refusal payload | no directional field; `NO_TRADE` still free; plan stays GUEST | BLOCKED — operator machine |
| 35i.8 | D7 on a quiet market | `NOT_VERIFIED`, never FAIL, never forced | BLOCKED — operator machine |
| 35i.9 | D7 when a chargeable signal DOES occur but no lock follows | FAIL (must not be masked as NOT_VERIFIED) | BLOCKED — needs live directional signal |

**Invalid-evidence rule:** a green D7 obtained by forcing BUY/SELL is not
evidence. The harness has no code path that fabricates a recommendation, and
this is test-enforced.

## 35j. Phase 206 — E-track execution attempt against the DEV deployment

**Execution was attempted from the agent sandbox and BLOCKED at the network
layer.** This is recorded as an attempt, not a result.

| Layer | Observation |
| --- | --- |
| DNS | `tough-goose-455.convex.cloud` resolves (2606:4700::6812:f83) |
| TCP | port 443 accepts the connection |
| TLS | handshake severed mid-negotiation (ECONNRESET) |
| Controls | `registry.npmjs.org` HTTP 200, `api.github.com` reachable |
| Verdict | targeted egress allowlist, not an outage |

`CONVEX_DEPLOY_KEY` and `CONVEX_DEPLOYMENT` are unset in the sandbox and
`npx convex dev --once` fails at the same TLS layer, so neither deployment nor
execution is possible here. **No E-track row may be marked PASS from this
environment.**

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| 35j.1 | Deploy Phase 205/206 code to the dev deployment | `Convex functions ready!` | BLOCKED — operator machine |
| 35j.2 | E1 fresh identity | `authenticated=true`, `plan=GUEST`, `remaining=2`, `used=0` | BLOCKED — sandbox egress |
| 35j.3 | E2 `WAIT` | `charged=false`, state unchanged | BLOCKED — sandbox egress |
| 35j.4 | E3 first chargeable | `charged=true`, `used=1`, `remaining=1`, plan GUEST | BLOCKED — sandbox egress |
| 35j.5 | E4 second chargeable | `charged=true`, `used=2`, `remaining=0`, plan GUEST | BLOCKED — sandbox egress |
| 35j.6 | E5 third chargeable | refused, `used` stays 2, no Premium | BLOCKED — sandbox egress |
| 35j.7 | E6 refusal payload | no directional field; `NO_TRADE` still free | BLOCKED — sandbox egress |
| 35j.8 | E7 authorization probes | all five refusals hold | BLOCKED — sandbox egress |

## 35k. Phase 207 — provider-derived observation & natural chargeable sweep

Sandbox egress is severed (HTTP 000 to every provider and to the deployment), so
every row below is **BLOCKED** pending an operator run. The harness guard tests
pass in CI; that proves the *harness logic*, not the *evidence*.

| # | Scenario | Expected | Status |
| --- | --- | --- | --- |
| 35k.1 | `npm run evidence:d` — D10 provider order | OKX order book attempted before any credentialed provider | BLOCKED |
| 35k.2 | D10 with OKX exchange `ts` present | PASS; `observedAt` is the exchange timestamp | BLOCKED |
| 35k.3 | D10 when OKX omits `ts` | Snapshot rejected upstream; D10 never PASS | BLOCKED |
| 35k.4 | D10 falls back to TwelveData | NOT_VERIFIED, acquisition-time basis recorded | BLOCKED |
| 35k.5 | D10 receives a future-dated `observedAt` | FAIL | BLOCKED |
| 35k.6 | D10 value within 2 ms of local clock | FAIL | BLOCKED |
| 35k.7 | No provider returns any timestamp | BLOCKED (not FAIL, not PASS) | BLOCKED |
| 35k.8 | `--sweep 25` candidate sourcing | From `discoverOkxInstruments`, `state === "live"` only, provider-native ids | BLOCKED |
| 35k.9 | Sweep finds a chargeable signal | D5 consumption delta === 1 | BLOCKED |
| 35k.10 | Sweep finds none (quiet market) | D5/D7/D8 NOT_VERIFIED, never FAIL | BLOCKED |
| 35k.11 | Default run (no `--sweep`) | Behaviour identical to Phase 206 | BLOCKED |
| 35k.12 | `providerAttempts[]` present in output | Every attempt auditable after the fact | BLOCKED |

## 35l. Phase 208 — report surface & auditability

Unlike 35j/35k, these rows are verified by **structured assertions on the report
builder**, not by a live run, so they are PASS rather than BLOCKED: the subject
under test is the reporting logic itself.

| # | Scenario | Expected | Status |
| --- | --- | --- | --- |
| 35l.1 | A BLOCKED row is rendered | Shows BLOCKED in JSON and terminal; never PASS | PASS |
| 35l.2 | A NOT_VERIFIED row is rendered | Shows NOT_VERIFIED and keeps its reason | PASS |
| 35l.3 | A FAIL/FAILED row is rendered | Shows FAIL; verdict FAILED; exit 1 | PASS |
| 35l.4 | A check carries an unrecognised status | UNKNOWN, verdict INCOMPLETE (Phase 207 false-green) | PASS |
| 35l.5 | No checks recorded at all | 10 BLOCKED rows, verdict INCOMPLETE (Phase 207 false-green) | PASS |
| 35l.6 | One observation missing | Rendered BLOCKED, denominator stays 10 | PASS |
| 35l.7 | Same observation recorded twice | Worst status wins; PASS cannot overwrite FAIL | PASS |
| 35l.8 | All ten genuinely PASS | Verdict ACHIEVED | PASS |
| 35l.9 | `productionEvidence` on a dev deployment | false | PASS |
| 35l.10 | `productionEvidence` with anonymous auth | false | PASS |
| 35l.11 | `productionEvidence` with one unresolved check | false | PASS |
| 35l.12 | JSON exposes all 20 canonical top-level keys | Present | PASS |
| 35l.13 | Human report surfaces the same decision-critical facts | Present | PASS |
| 35l.14 | Provider attempts visible in terminal output | provider/dataset/instrument/access/basis/outcome | PASS |
| 35l.15 | Unavailable provider rendered | "failed", observedAt=none, failure reason | PASS |
| 35l.16 | Sweep candidates visible with provider-native ids | Present with status/recommendation/consumed | PASS |
| 35l.17 | Skipped/failed sweep candidate | Reason surfaced, not hidden | PASS |
| 35l.18 | Natural chargeable find | Exposed with instrument, recommendation, consumed | PASS |
| 35l.19 | No chargeable signal | `chargeableFind: null` + explicit market-condition note | PASS |
| 35l.20 | Quiet market | D5/D7/D8 NOT_VERIFIED, never FAIL | PASS |
| 35l.21 | E-track failure | D verdict unaffected | PASS |
| 35l.22 | D-track failure | E verdict unaffected | PASS |
| 35l.23 | E-track passes with an unresolved D check | Cannot reach ACHIEVED | PASS |
| 35l.24 | Report contents scanned for secrets | No token/OTP/API key | PASS |
| 35l.25 | Remaining blockers listed with classification | Every unresolved check, no passing one | PASS |
| 35l.26 | Refusal path (`--json` and human) | 0 PASS rows, 10 BLOCKED, exit 2 | PASS |

## 35m. Phase 209 — operator handoff dry-run (fixture)

Verified by executing the **real CLI** against a loopback fixture. These rows
prove the *tooling*; they are explicitly **not** evidence about the deployment,
providers or product. Live-deployment rows remain BLOCKED in 35j/35k.

| # | Scenario | Expected | Status |
| --- | --- | --- | --- |
| 35m.1 | Fixture binds loopback only | 127.0.0.1, never 0.0.0.0 | PASS |
| 35m.2 | Fixture makes no outbound call | No fetch/provider/Convex reference in code | PASS |
| 35m.3 | Fixture is deterministic | Fixed epoch, no randomness, no clock branching | PASS |
| 35m.4 | Fixture run stamps `fixture: true` + notice | Present in JSON and terminal banner | PASS |
| 35m.5 | Fixture environment/class | `fixture` / `FIXTURE — NOT EVIDENCE` | PASS |
| 35m.6 | Fixture deployment identity | `FIXTURE-NOT-EVIDENCE`, host 127.0.0.1 | PASS |
| 35m.7 | 10/10 ACHIEVED fixture run | `productionEvidence` still false | PASS |
| 35m.8 | Hostile env claiming `dev:tough-goose-455` | Still classified fixture, never DEV_VERIFIED | PASS |
| 35m.9 | `--fixture` + `--production-evidence` | Refused, exit 2 | PASS |
| 35m.10 | `--fixture https://evil.example.com` | Refused, exit 2 | PASS |
| 35m.11 | JSON exposes all 22 canonical keys | Present via real CLI | PASS |
| 35m.12 | Transport calls actually made | > 5 HTTP calls recorded | PASS |
| 35m.13 | providerAttempts from a real probe | okx/order-book, basis exchange ts | PASS |
| 35m.14 | sweepLog uses discovery ids | BTC-USDT present, suspended SOL-USDT excluded | PASS |
| 35m.15 | chargeableFind + E1–E7 + blockers exposed | Present in both modes | PASS |
| 35m.16 | JSON/human parity via the CLI | Every row id and status in both | PASS |
| 35m.17 | Exit 0 | `complete` + OTP, 10/10 | PASS |
| 35m.18 | Exit 2 (incomplete) | `incomplete` scenario | PASS |
| 35m.19 | Exit 1 (failure) | `blocked` scenario | PASS |
| 35m.20 | Exit 2 (malformed status) | UNKNOWN, never PASS; no fake chargeable find | PASS |
| 35m.21 | Exit 2 (silent deployment) | NOT EXECUTED, 10 BLOCKED, 0 PASS | PASS |
| 35m.22 | BLOCKED rendered end-to-end | Never PASS in either mode | PASS |
| 35m.23 | E VERIFIED + D INCOMPLETE | D stays INCOMPLETE, exit 2 | PASS |
| 35m.24 | D summary counts only D1–D10 | total 10; E-track 7 separately | PASS |
| 35m.25 | Quiet fixture market | D5/D7/D8 NOT_VERIFIED, 0 failed | PASS |
| 35m.26 | Non-fixture localhost / 127.0.0.1 | Still refused, exit 2 | PASS |
| 35m.27 | Arbitrary https / non-convex host | Still refused, exit 2 | PASS |
| 35m.28 | Deployment-name mismatch | Still refused, exit 2 | PASS |
| 35m.29 | `--production-evidence` on dev | Still refused, exit 2 | PASS |
| 35m.30 | No mock/replay escape hatch | Forbidden patterns absent; fixture evidence-incapable | PASS |

## 35n. Phase 211 — real DEV run triage & D10 failure attribution

The Phase 210 runbook was executed by the operator against the DEV deployment
(`XSTARZ_DEPLOYMENT_ENV=development`). Exit 2, Evidence D INCOMPLETE. This
section records what that run proved and what Phase 211 changed.

### Real run outcome (unchanged by this phase)

| check | status | note |
| --- | --- | --- |
| D1 | NOT VERIFIED | anonymous auth mode |
| D2, D3, D4, D6, D9 | PASS | first real confirmation |
| D5, D7, D8 | NOT VERIFIED | market returned NO_TRADE ×4 — no chargeable signal existed |
| D10 | BLOCKED | reported only `API_UNAVAILABLE` |
| E1–E7 | VERIFIED | first real E-track execution |

D5/D7/D8 are **not** defects: a chargeable signal cannot be manufactured, and
forcing one would violate the WAIT/NO_TRADE invariant.

### Triage findings

| # | finding | status |
| --- | --- | --- |
| 1 | `API_UNAVAILABLE` cannot originate from OKX — `okx.ts` emits no `errorCode` | PASS (proven by grep + execution) |
| 2 | The code came from the TwelveData fallback, misattributed to OKX | PASS (fixed) |
| 3 | OKX's real reason lives at `data.reason` and was being discarded | PASS (fixed) |
| 4 | Probe asked `BTC-USDT`; backend normalises to `BTC-USDT-SWAP` | PASS (fixed) |
| 5 | Missing key returns `AUTH_ERROR`, so the key was present | PASS (by elimination) |
| 6 | DEV deployment is current — `git diff ad7e896..HEAD -- src/convex/` empty | PASS (no redeploy needed) |
| 7 | Failure layer is diagnostic/harness only — no product code changed | PASS |
| 8 | `mapInstrumentToOkx` SWAP normalisation left intact (Phase 39 pinned) | PASS (not a defect) |
| 9 | Nine-class failure taxonomy with per-attempt `failureClass` | PASS (34 tests) |
| 10 | BLOCKED detail renders `provider[CLASS]:reason` per provider | PASS |
| 11 | `observedInstrument` recorded so substitution is visible | PASS |
| 12 | `okx-down` fixture reproduces the DEV shape end-to-end | PASS |
| 13 | D10 still BLOCKED, never upgraded to PASS by a better message | PASS |
| 14 | D10 unrunnable in sandbox (OKX HTTP 000 on both ids) | BLOCKED (external egress) |

### Verification

- 34 targeted tests; the suite evaluates the **real** classifier extracted from
  the harness source, not a local copy of it.
- 9/9 mutations killed. M1 (stop reading `data.reason`) and M3 (conflate rate
  limit with credential) **survived the first run** because the test mirrored
  the classifier inline; the mirror was replaced and both now fail the suite.
- Full suite 9376 passed / 3 skipped; tsc 0; build 0; lint 1517 (no regression).

## 35o. Phase 213 — first valid real DEV Evidence D run (DEV_VERIFIED)

**Classification: `DEV_VERIFIED — NOT PRODUCTION EVIDENCE`.**

The Phase 212 run sheet was executed by the operator against the real DEV
deployment. This is the first run in which D10 passed against a live provider.

| field | value |
| --- | --- |
| deployment | `tough-goose-455.convex.cloud` |
| environment | development (`XSTARZ_DEPLOYMENT_ENV=development`) |
| `productionEvidence` | **false** |
| exit code | 2 (incomplete — expected while D1/D5/D7/D8 are unevidenced) |
| auth mode | `--auth anonymous` |
| sweep | 25 candidates, discovery-derived, `instId` verbatim |
| evidence class | DEV runtime observation |

### Recorded DEV observations

| check | DEV status | basis |
| --- | --- | --- |
| D2 | **PASS (DEV)** | real deployed-function response |
| D3 | **PASS (DEV)** | real deployed-function response |
| D4 | **PASS (DEV)** | real deployed-function response |
| D6 | **PASS (DEV)** | real deployed-function response |
| D9 | **PASS (DEV)** | client-forged evidence fields rejected by the server |
| D10 | **PASS (DEV)** | OKX order book, `BTC-USDT-SWAP`, exchange `ts`, FRESH |
| D1 | NOT VERIFIED | anonymous auth — no OTP mailbox delivery occurred |
| D5 | **NOT_VERIFIED — MARKET_CONDITION** | no natural chargeable signal in 25 candidates |
| D7 | **NOT_VERIFIED — MARKET_CONDITION** | same |
| D8 | **NOT_VERIFIED — MARKET_CONDITION** | same |
| E1–E7 | **VERIFIED (DEV) 7/7** | entitlement state machine, independent axis |

D1/D5/D7/D8 are **not** recorded as PASS. E1–E7 are **not** a substitute for
D5/D7/D8: the E-track takes `recommendation` as an argument, so it can never
prove the engine decided chargeability on its own.

### D10 contract audit (no provider code changed)

| requirement | verdict | how it is enforced |
| --- | --- | --- |
| real OKX response | PASS | `okx:fetchOkxOrderBook` performs the live fetch; no fixture path exists in a non-`--fixture` run |
| exchange-supplied `ts` | PASS | `execution-quality.ts` rejects the payload outright with `missing/invalid exchange timestamp (ts)` when `e.ts` is absent or non-finite |
| `observedAt` preserved | PASS | `okx.ts` sets `observedAt: snapshotTs`, and `snapshotTs` **is** the parsed `e.ts` |
| no local-clock substitution | PASS | the harness FAILs when `abs(observedAt - startedAt) < 2 ms`; the run passed, so the value is not our clock |
| no future timestamp | PASS | harness FAILs when `observedAt > finishedAt + 5 s` |
| no cache relabelling | PASS | harness FAILs when `acquisition === "cache-reused"` and `observedAt >= startedAt` |
| instrument identity | PASS | requested and observed both `BTC-USDT-SWAP`; provider-native id passed verbatim |

`Date.now()` appears in `okx.ts` only as the freshness reference passed to
`buildExecutionData`; it never becomes `observedAt`. There is no code path by
which a local timestamp can satisfy this gate.

### Evidence provenance caveat

The `phase212.json` artefact was **not** attached to the repository, so these
rows are recorded from the operator's reported summary, not from a re-read of
the machine-generated report. The distinction is preserved deliberately: this
is an operator-attested DEV observation. Attaching `phase212.json` would
upgrade it to a re-verifiable artefact; it would **not** upgrade it to
production evidence.

## 35p. Stopping rule — no repeat-sweep phases (binding, Phase 213)

D10 is now VERIFIED in DEV. D5/D7/D8 are limited by **market condition**, not
by code, configuration or effort. This rule exists to stop that fact from
generating an endless series of "run the sweep again" phases.

**The rule.** Once D10 is DEV-VERIFIED and no legitimate chargeable signal is
naturally available, the project must **not** create further phases whose only
content is re-running the sweep. D5/D7/D8 remain explicit
`NOT_VERIFIED — MARKET_CONDITION` blockers until a chargeable event occurs
through normal operation or scheduled UAT.

**What a repeat sweep may not do.** The only legitimate way to widen the search
already exists: `--sweep N` walks discovery-derived instruments whose
`state === "live"`, keeping each `instId` verbatim. It does not and must not
acquire a chargeable signal by:

- a hardcoded instrument whitelist,
- symbol substitution (asking for A and reporting B),
- forcing or injecting a recommendation,
- moving a threshold, bias or confidence value,
- fabricating provider data or timestamps.

Raising `--sweep` samples more of the *same* quiet market. It is not a fix, and
a larger N is not evidence of greater effort.

**Permitted triggers for a new D5/D7/D8 attempt** (any one):

1. a code change lands that could plausibly alter chargeability, or
2. the operator runs the harness as part of scheduled UAT during ordinary use,
   and the engine independently produces BUY/SELL/LONG/SHORT, or
3. market conditions are independently observed to have changed.

Absent one of these, the correct action is to record
`NOT_VERIFIED — MARKET_CONDITION` and move to unrelated work. Forcing a
recommendation to close these rows would violate invariant 3 (WAIT/NO_TRADE
preserved) and invariant 9 (no guaranteed-profit behaviour), and would make the
evidence false rather than complete.

## 35q. Phase 214 — production email / OTP readiness

| # | item | status |
| --- | --- | --- |
| 1 | Production config names documented (`docs/PRODUCTION-EMAIL-SETUP.md`) | PASS |
| 2 | Resend and SMTP2GO both supported; no forced provider | PASS |
| 3 | `vly.ai` accepted as an OTP sender in production | **FAIL → FIXED** (proven by executing the config reader) |
| 4 | Forbidden sender list derived from `RETIRED_ISSUER_HOSTS` | PASS |
| 5 | Subdomains of retired hosts refused | PASS |
| 6 | `console` transport refused in production | PASS |
| 7 | Unset `XSTARZ_DEPLOYMENT_ENV` resolves to production (fails closed) | PASS |
| 8 | Missing key / missing sender / invalid sender refused | PASS |
| 9 | OTP lifetime 10 min | PASS (unchanged) |
| 10 | CSPRNG 6-digit, rejection-sampled | PASS (unchanged) |
| 11 | Failed sign-ins 5/hour | PASS (unchanged) |
| 12 | Resend cooldown 60 s, 5 per rolling hour | PASS (unchanged) |
| 13 | Limiter stores SHA-256 hash, no raw address | PASS (unchanged) |
| 14 | Rejected request does not extend cooldown | PASS (returns before any write) |
| 15 | Failed send does not refund allowance | PASS (unchanged) |
| 16 | Error surface is category-only | PASS (unchanged) |
| 17 | D1 execution contract written | PASS |
| 18 | D1 itself | **BLOCKED** — no provider account, no domain, no mailbox |
| 19 | DEV OTP smoke test possible? | **NOT VERIFIED** — sandbox cannot read deployment env; operator check documented |
| 20 | Email credential separated from leaked Freebuff key | PASS (documented in two places) |

No entitlement or business logic was touched. No credential, domain or delivery
evidence was invented. D1 remains BLOCKED and must not be recorded otherwise
until a real mailbox receives a code.

## 35r. Phase 215 — DEV email configuration gate

**Outcome: the gate could not be evaluated this phase, and a prerequisite
defect was fixed before the operator ran anything.**

### Blocking defect in the inspection command itself

Phase 214 instructed the operator to run `npx convex env list` and asserted it
"shows names only". That is false. The Convex CLI (1.42.1) prints
`NAME=VALUE` for every variable unless `--names-only` is passed:

```
for (const { name, value } of envs) {
  if (options?.namesOnly) { logOutput(name); continue; }
  logOutput(`${name}=${formatted}`);
}
```

Running the documented command would have printed the live
`XSTARZ_EMAIL_API_KEY` to the terminal and into any captured transcript —
directly violating the "names/presence only, never values" rule this phase is
built on. Three documents carried the wrong instruction and all three are
corrected to `--names-only`.

| # | item | status |
| --- | --- | --- |
| 1 | `convex env list` prints values without `--names-only` | **FAIL → FIXED** (verified in CLI source) |
| 2 | `docs/PRODUCTION-EMAIL-SETUP.md` corrected | PASS |
| 3 | `docs/RELEASE-GATE.md` corrected | PASS |
| 4 | `docs/OPERATOR-RUNBOOK.md` corrected (pre-existing, same defect) | PASS |
| 5 | Guard prevents reintroducing the value-printing form | PASS (3/3 mutations killed) |
| 6 | Recovery advice if the unsafe form was already run | PASS (rotate the key) |
| 7 | DEV email configuration state | **NOT VERIFIED** — operator output not yet provided |
| 8 | Case A / Case B decision | **PENDING** on item 7 |
| 9 | D1 | **BLOCKED** — unchanged |

### What is still needed to resolve the gate

The operator runs, against the DEV deployment:

```powershell
npx.cmd convex env list --names-only
```

and reports which of these names appear — **names only, no values**:
`XSTARZ_EMAIL_TRANSPORT`, `XSTARZ_EMAIL_API_KEY`,
`XSTARZ_EMAIL_SENDER_ADDRESS`, `XSTARZ_DEPLOYMENT_ENV`, `SITE_URL`.

Because `--names-only` prints no values, the transport's *value* (`resend` vs
`smtp2go` vs `console`) is not disclosed by it. If the transport value is
needed to decide Case A, the safe check is `npx convex env get
XSTARZ_EMAIL_TRANSPORT` — that variable is **not** a secret, unlike the key.

- **Case A** (all three present, transport non-console): DEV OTP smoke test is
  possible. D1 stays NOT_VERIFIED until a real mailbox receives a code, a human
  attests receipt, and a session is created through the application.
- **Case B** (any absent): **DEV OTP SMOKE TEST NOT POSSIBLE**. D1 stays
  BLOCKED pending external provider/domain provisioning, and Evidence-D
  repository work stops there.

This phase does not schedule a repeat of the command. One operator answer
resolves it.

### Credential distinction (unchanged)

An `XSTARZ_EMAIL_API_KEY` in the DEV deployment, if present, is a **new Xstarz
credential** and is unrelated to the leaked Freebuff credential. Configuring or
smoke-testing it does not revoke the old key and does not resolve the Phase 184
history-rewrite blocker, which still requires an observed 401/403 from the old
credential after rotation.

## 35s. Phase 216 — safe DEV email configuration gate

**Outcome: the gate still cannot be evaluated — no operator output was
provided — but the procedure is now safe to execute and a second disclosure
hazard was removed.**

### Verification of the commands before recommending them

| command | verified | finding |
| --- | --- | --- |
| `convex env list --names-only` | yes | `--names-only` is registered on **both** `envListCmd` and `envDefaultList` in convex 1.42.1, so the Phase 215 correction is valid |
| `convex env get NAME` | yes | prints `logOutput(\`${envVar.value}\`)` — the **raw value, unmasked**. Safe only for non-secret names |

### Defect found: contradictory secret classification

`docs/DEPLOYMENT.md` listed `XSTARZ_EMAIL_API_KEY` and
`XSTARZ_EMAIL_SENDER_ADDRESS` in **both** the Class B (server-only secrets)
table and the Class C (server configuration, *not secret*) table. An operator
following Class C would reasonably conclude the API key is printable — the
exact mistake Phase 215 was created to prevent.

Resolved by adding an explicit **disclosure-safety** table that answers the
operational question the A–D classes do not: *may this value be printed?*
`XSTARZ_EMAIL_API_KEY` is **NEVER**; the sender address, transport, deployment
env and site URL are safe (a sending identity is published in the headers of
every message it sends — operationally sensitive, not secret).

| # | item | status |
| --- | --- | --- |
| 1 | `--names-only` exists on `env list` (not only `env default list`) | PASS (verified in CLI source) |
| 2 | `env get` prints unmasked values | PASS (documented) |
| 3 | `XSTARZ_EMAIL_API_KEY` classified in two contradictory ways | **FAIL → FIXED** |
| 4 | Disclosure-safety table added | PASS |
| 5 | Safe 4-command gate sequence documented (§4c) | PASS |
| 6 | No document points `env get` at a credential | PASS (guard, mutation-killed) |
| 7 | Rotation instruction if the unsafe command was run | PASS |
| 8 | Phase 184 separation preserved | PASS |
| 9 | DEV configuration presence | **NOT VERIFIED** — operator output not provided |
| 10 | DEV OTP smoke test possible? | **UNRESOLVED** — depends on item 9 |
| 11 | D1 | **BLOCKED** — no mailbox delivery, no OTP session |

### Remaining condition

One operator response resolves this. The sequence is in
`docs/PRODUCTION-EMAIL-SETUP.md` §4c. If `XSTARZ_EMAIL_API_KEY` is absent, or
the transport is `console`, the answer is **DEV OTP SMOKE TEST NOT POSSIBLE**,
D1 stays BLOCKED on external provisioning, and Evidence-D repository work stops
there rather than repeating the check.

## 36. Sign-off

| Field | Value |
| --- | --- |
| Executed by | |
| Date | |
| Build / commit | |
| Environment (dev / preview / deployed URL) | |
| Browser + version | |
| Device(s) | |
| PASS count | |
| FAIL count | |
| BLOCKED count | |

**Release rule:** any `FAIL` on a row marked *"Stop and report"* is a hard
release blocker. Outstanding `BLOCKED` rows mean the corresponding capability
is **NOT VERIFIED** — it must never be reported as working.
