# Deployment Guide — Xstarz Analysis

Phase 180. This document describes how the product is hosted, which variables
it needs, and exactly what remains blocked.

**Deployment status: NOT READY.** One security item and several external
verifications are outstanding. They are listed in
[Blocking items](#blocking-items) and none of them can be resolved from inside
the development sandbox.

---

## 1. Source of truth

| Item | Value |
| --- | --- |
| Deployable branch | `arena/01a08e67-trade-intel-bot` |
| **Not deployable** | `main` |

`main` is more than 25 commits behind and, more importantly, its git history
still contains a leaked OTP API key. **Do not deploy `main`, and do not merge
to it, until that credential has been rotated.** The running application logs
its own commit and branch at startup and prints a warning if it was ever built
from `main`.

Confirm what is actually live by opening the browser console:

```
[Xstarz Analysis] build eb3a60e (arena/01a08e67-trade-intel-bot) built 2026-09-12T…
```

---

## 2. Architecture

Two independently deployed pieces:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| Web client | Static SPA built by Vite into `dist/` | Any static host (Vercel configured) |
| Backend | Convex functions in `src/convex/` | Convex deployment |

**Every market-data provider call happens in the backend.** The client holds no
provider credentials and talks only to Convex. This is a security boundary, not
a preference: moving a provider call into the client would expose that
provider's key to every user.

The Android and iOS apps (Phase 179) wrap **the same `dist/`**. There is no
separate mobile build pipeline and no second copy of the UI.

---

## 3. Environment variables

Classified by where each one is allowed to exist.

### Class A — Client, public, inlined at build time

Read via `import.meta.env`, **baked into the JavaScript bundle**, and therefore
readable by anyone. Only non-secret values may appear here.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_CONVEX_URL` | **Yes** | Backend URL the client connects to |
| `VITE_VLY_APP_ID` | No | Optional monitoring identifier |
| `VITE_VLY_MONITORING_URL` | No | Optional monitoring endpoint |

> **These are read at BUILD time, not at run time.** Setting `VITE_CONVEX_URL`
> on the server after the fact has no effect — the artifact must be rebuilt.
> A build without it produces a visible "not configured" screen rather than a
> blank page (verified by `deployment.phase180.test.ts`).

### Class B — Server-only secrets

Set these in the **Convex deployment environment**. They must never appear in
`.env` files that reach the client, in the bundle, or in the native projects.

| Variable | Required | Effect if missing |
| --- | --- | --- |
| `XSTARZ_EMAIL_API_KEY` | **Yes** (unless transport is `console`) | Email sign-in cannot send codes |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | **Yes** (unless transport is `console`) | Send fails closed; no fallback sender |
| `TWELVE_DATA_API_KEY` | No | That provider is reported unavailable |
| `ALPHA_VANTAGE_API_KEY` | No | That provider is reported unavailable |
| `COINGLASS_API_KEY` | No | That provider is reported unavailable |
| `TICKATLAS_API_KEY` | No | That provider is reported unavailable |
| `EIA_API_KEY` | No | That provider is reported unavailable |
| `VLY_INTEGRATION_KEY` | No | Platform integration disabled |

A missing provider key **disables that provider explicitly**. It never causes
fabricated, placeholder, or stale-presented-as-live market data.

OKX, CoinGecko, DeFiLlama, Tokenomist, CFTC and US Treasury are public
endpoints and need no credentials.

### Class C — Server configuration, not secret

| Variable | Purpose |
| --- | --- |
| `CONVEX_SITE_URL` | Auth callback origin; must match the deployed origin |
| `CONVEX_DEPLOYMENT` | Selects the Convex deployment for CLI operations |
| ~~`VLY_APP_NAME`~~ | **Removed in Phase 185** — labelled the retired third-party OTP email |
| `XSTARZ_DEPLOYMENT_ENV` | `production` \| `preview` \| `development`. **Absent or empty means production** (fails closed). Unrecognised values throw |
| `VLY_CONVEX_AUTH_ISSUER` | Optional federated issuer, honoured only in preview/development. **A production deployment rejects any value** and trusts only its own issuer |
| `XSTARZ_EMAIL_TRANSPORT` | `resend` \| `smtp2go` \| `console`. **`console` is rejected in production** — it logs instead of delivering |
| `XSTARZ_EMAIL_API_KEY` | Provider credential. Server-only, never committed |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | Xstarz-owned verified sender. No default; send fails without it |
| `XSTARZ_EMAIL_SENDER_NAME` | Defaults to `Xstarz Analysis` |

### Class D — Build-time only, never shipped

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set by Vite; selects the absolute asset base (see §5) |
| `MOBILE_BUILD` | Set to `1` by the mobile build scripts |

**Enforcement.** `npm run mobile:verify` fails the build if a Class B variable
is assigned a value in, or read by, any client or native artifact. It matches
assignments and env reads — not bare name mentions, because the UI legitimately
tells operators things like *"Check that `TWELVE_DATA_API_KEY` is configured"*,
and those strings exist in all nine locales.

---

## 4. Web deployment

```bash
npm install --legacy-peer-deps   # default npm resolution fails on this peer graph
npm test
npm run build                    # tsc -b && vite build  ->  dist/
```

Publish `dist/`. Two host configurations are committed and kept equivalent:

- `vercel.json` — `/(.*)` → `/index.html`
- `public/_redirects` — `/*  /index.html  200` (Netlify and similar)

### The SPA rewrite is mandatory

The app uses `BrowserRouter` with real URLs. Without a catch-all rewrite,
`/dashboard` is a 404 on first load or refresh. The rewrite must be a
**200 rewrite, not a 301/302 redirect** — a redirect changes the URL and loses
the route the user asked for.

---

## 5. Why assets are referenced absolutely

A hosting defect found and fixed in Phase 180, recorded because it is easy to
reintroduce and every automated gate missed it.

The web build previously used a **relative** base (`./assets/...`). Combined
with the SPA rewrite, loading `/dashboard` made the browser resolve
`./assets/index-*.js` against `/dashboard/`, requesting
`/dashboard/assets/index-*.js`. That path does not exist — so the catch-all
rewrite answered it with **200 and `index.html`**. The browser received HTML
where a JavaScript module was expected, refused to execute it, and rendered
**a blank page on every deep link and every refresh**.

The rewrite *masked* the missing file by turning a 404 into a 200. Tests,
typecheck, build and lint all passed throughout.

`vite.config.ts` now uses an absolute base (`/`) whenever `NODE_ENV` is
`production` or `MOBILE_BUILD=1`, keeping the relative base only for the
development preview iframe. `deployment.phase180.test.ts` fails if a relative
asset reference ever returns.

---

## 6. Backend deployment

```bash
npx convex deploy
```

Then set every Class B and Class C variable in the Convex dashboard.

> **Blocked in this environment.** The sandbox reaches `registry.npmjs.org` and
> `api.github.com`, but TLS to `provision.convex.dev` is terminated by a domain
> allowlist (TCP 443 opens, the handshake is killed). `npx convex codegen`
> reports `No CONVEX_DEPLOYMENT set`. The backend has therefore **never been
> deployed or exercised against a live deployment** from here. Deployed-runtime
> verification must be performed by an operator on an unrestricted network.

---

## 7. Mobile deep links

`public/.well-known/` contains `assetlinks.json` (Android) and
`apple-app-site-association` (iOS). Both are served as `application/json` and
are **not** swallowed by the SPA rewrite (verified).

**Both contain placeholders, so deep links are CONFIGURED but NOT VERIFIED:**

| File | Placeholder | Needed to finish |
| --- | --- | --- |
| `assetlinks.json` | `REPLACE_WITH_RELEASE_CERT_SHA256` | SHA-256 of the release signing certificate |
| `apple-app-site-association` | `REPLACE_WITH_APPLE_TEAM_ID` | Apple Developer Team ID |

Neither value exists yet — no release keystore has been created and there is no
Apple Developer account. **Do not invent these values.** A test asserts the
placeholders are still present, so filling them in forces the documentation and
UAT matrix to be updated in the same change.

---

## 8. CI/CD

| Workflow | Runner | Produces |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `ubuntu-latest` | Tests, typecheck, build, secret scan, `dist/` artifact |
| `.github/workflows/mobile.yml` → `android` | `ubuntu-latest` | Debug APK |
| `.github/workflows/mobile.yml` → `ios` | `macos-14` | Unsigned simulator compile |

CI exists specifically to remove sandbox limitations: the sandbox has no JDK
(so the APK could not be compiled) and no macOS (so the iOS project could not
be opened). A GitHub macOS runner can compile the iOS project.

**A green mobile check does not mean release readiness.** It means the projects
compile. It does not verify behaviour on a physical device, and no CI runner
can — nobody on this project has an iPhone.

Neither workflow deploys anything, and no workflow takes a provider secret.

---

## 9. Blocking items

| # | Item | Why it blocks | Who can clear it |
| --- | --- | --- | --- |
| 1 | Leaked OTP key live in `main`'s history (9 commits) | Valid credential is publicly reachable | Rotate at `auth.freebuff.app`, **then** rewrite history |
| 2 | Convex never deployed | Control plane TLS-blocked here | Operator on an unrestricted network |
| 3 | No live provider verification | All provider hosts blocked here | Operator on an unrestricted network |
| 4 | Deep links unverified | Placeholder fingerprint and Team ID | Release keystore + Apple Developer account |
| 5 | No physical-device testing | No Android device, no iPhone | Human tester |
| 6 | Theme defect F3 | `<html class="dark">` hardcoded; `.dark {}` empty; `--primary` is teal, not the specified blue | Scheduled work, not opportunistic |

Until items 1–3 are cleared, this product is **NOT READY** for public release.

---

## 10. Rollback

The web artifact is static and immutable per build: redeploy the previous
`dist/`, or revert the commit and rebuild. Confirm the rollback using the
commit id logged at startup.

Convex deployments roll back from the dashboard. **Schema changes are not
automatically reversible** — review a schema diff before deploying it.

## Phase 185b — production fail-closed configuration

Two settings must be correct before a production deployment can authenticate a
real user. Both fail closed: a misconfiguration blocks sign-in rather than
quietly permitting an insecure path.

```bash
npx convex env set XSTARZ_DEPLOYMENT_ENV production
npx convex env set XSTARZ_EMAIL_TRANSPORT resend
npx convex env set XSTARZ_EMAIL_API_KEY <provider key>
npx convex env set XSTARZ_EMAIL_SENDER_ADDRESS <verified sender on an Xstarz domain>
# VLY_CONVEX_AUTH_ISSUER must be unset on production.
```

What each guard does when it is wrong:

| Misconfiguration | Result |
| --- | --- |
| `XSTARZ_DEPLOYMENT_ENV` unset on production | Treated as production — restrictions stay on |
| `XSTARZ_DEPLOYMENT_ENV=prod` (typo) | `DeploymentPolicyError` — refuses to guess |
| `XSTARZ_EMAIL_TRANSPORT=console` on production | `EmailDeliveryError(not_configured)` — no delivery result, no sign-in |
| `XSTARZ_EMAIL_TRANSPORT=resend` with no key | Explicit failure, no silent fallback sender |
| `VLY_CONVEX_AUTH_ISSUER` set on production | `IssuerPolicyError` — retired hosts named, others refused generically |

Preview and development deployments set `XSTARZ_DEPLOYMENT_ENV` to `preview` or
`development`, which re-enables the console transport and explicit federated
issuers for the platform that still needs them.
