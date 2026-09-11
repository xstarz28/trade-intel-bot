# Production Verification — Xstarz Analysis

This document records what has been **verified**, what is **unverified**, and
what **cannot be verified** by automated agent runs. It is deliberately
conservative: anything not actually executed and observed is not marked PASS.

Last updated: Phase 164.

---

## 1. Verification status summary

| Area | Status | Evidence |
| --- | --- | --- |
| Unit + integration test suite | **PASS** | 7,529 tests / 187 files, 0 failures |
| TypeScript compile | **PASS** | `tsc -b` exit 0, fully clean |
| Production build | **PASS** | `npm run build` (`tsc -b && vite build`) exit 0 |
| Lint | **PASS (no new)** | Error count unchanged from baseline on every touched file |
| Live provider calls | **NOT VERIFIED** | Outbound market-data hosts are blocked in the agent sandbox |
| Credentialed providers | **NOT VERIFIED** | No API keys present in this environment |
| Convex deployment runtime | **NOT VERIFIED** | No deployment URL configured here |
| Browser / manual E2E | **CANNOT BE DONE BY AGENT** | Requires a human clicking through the UI |

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

### Resolved

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
