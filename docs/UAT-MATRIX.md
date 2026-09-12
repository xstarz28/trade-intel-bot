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

## 27. Sign-off

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
