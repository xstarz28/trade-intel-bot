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

## 15. Sign-off

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
