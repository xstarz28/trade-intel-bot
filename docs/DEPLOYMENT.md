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

### Disclosure safety — which values may ever be printed

Class B/C describe *where a variable lives*. They do not answer the operational
question an operator actually faces: **may I print this value into a terminal?**
Two variables appear in both tables, which is precisely the ambiguity that
leads to a credential being echoed. This table is the authoritative answer.

| Variable | Safe to print? | Why |
| --- | --- | --- |
| `XSTARZ_EMAIL_API_KEY` | **NEVER** | Provider credential. Printing it discloses it, including into shell history and transcripts. Inspect **presence only**. |
| `XSTARZ_EMAIL_SENDER_ADDRESS` | Yes | A sending identity is published in the headers of every message it sends. It is operationally sensitive, not secret. |
| `XSTARZ_EMAIL_TRANSPORT` | Yes | One of `resend`, `smtp2go`, `console`. |
| `XSTARZ_EMAIL_SENDER_NAME` | Yes | Display name. |
| `XSTARZ_DEPLOYMENT_ENV` | Yes | Environment label. |
| `SITE_URL` / `CONVEX_SITE_URL` | Yes | Public origin. |
| `CONVEX_DEPLOYMENT` | Yes | Deployment identity, not a credential. |
| every other `*_API_KEY`, `*_KEY`, deploy key | **NEVER** | Credentials. |

**Commands.** `npx convex env list` prints `NAME=VALUE` for *every* variable —
use `npx convex env list --names-only`. `npx convex env get NAME` prints the
raw value with no masking, so it may only be pointed at a row marked "Yes"
above. Never at `XSTARZ_EMAIL_API_KEY`.

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
| `.github/workflows/production-deploy.yml` | `ubuntu-latest` | Manual Convex production deploy (fail-closed) |

CI exists specifically to remove sandbox limitations: the sandbox has no JDK
(so the APK could not be compiled) and no macOS (so the iOS project could not
be opened). A GitHub macOS runner can compile the iOS project.

**A green mobile check does not mean release readiness.** It means the projects
compile. It does not verify behaviour on a physical device, and no CI runner
can — nobody on this project has an iPhone.

`ci.yml` and `mobile.yml` do not deploy and take no provider secret.
`release-admission.yml` is hermetic and takes no secret.

`production-deploy.yml` is **manual only** (`workflow_dispatch`). It runs in
the GitHub Environment `production`, requires the secret `CONVEX_DEPLOY_KEY`
and the variable `CONVEX_DEPLOYMENT` (`prod:<team>:<project>`), refuses
anonymous/dev/preview/local identities, then runs `npx convex deploy --yes
--cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL`. A missing
secret fails the guard. A green dispatch is not a release, not Evidence D,
and not proof that production exists — the workflow has not been run from
this environment, and no production deployment is claimed here.

Email stays in Convex production env (never GitHub): `XSTARZ_EMAIL_TRANSPORT`
(`resend` or `smtp2go`), `XSTARZ_EMAIL_API_KEY`, `XSTARZ_EMAIL_SENDER_ADDRESS`.

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

## Phase 186 — deployment pipeline

### Preflight before every deploy

```bash
npm run convex:preflight                       # validates process.env
npm run convex:preflight -- --env-file .env.production.local
npm run convex:preflight -- --json             # machine-readable, for CI
```

Exit codes: `0` valid, `1` rejected by a fail-closed policy, `2` could not
evaluate. The script imports the real policy modules from `src/convex/lib`
rather than restating the rules, so its verdict and the deployed backend
cannot disagree. It reads variable **names** and presence only; credential
values are never printed.

What it validates:

- the deployment environment resolves, and a typo is refused rather than guessed
- the console transport is rejected on production
- no federated issuer is trusted on production
- the sender address exists and is not a retired Freebuff domain
- every production-required variable is present
- no server-only secret is exposed through a `VITE_`-prefixed variable
- the retired `OTP_EMAIL_API_KEY` / `VLY_APP_NAME` are absent

What it explicitly does **not** prove, and reports as NOT VERIFIED: provider
account validity, DNS records, real email delivery, deployed runtime
behaviour. A green preflight is not evidence that the deployment works.

### Deployment order

Staging first. A production deployment is never the first deployment.

```bash
# 1. Staging / preview deployment
npx convex env set XSTARZ_DEPLOYMENT_ENV preview
npm run convex:preflight
npx convex deploy

# 2. Verify against the deployed preview backend
#    auth, entitlement, provenance, fan-out, cache, degradation

# 3. Production — ONLY after the Phase 184 gate is cleared
npx convex env set XSTARZ_DEPLOYMENT_ENV production
npm run convex:preflight
npx convex deploy --prod
```

### Codegen

```bash
npx convex dev --once      # configures CONVEX_DEPLOYMENT on first use
npx convex codegen         # regenerates src/convex/_generated/*
git diff --stat src/convex/_generated/
npm test && npx tsc -b && npm run build
```

`src/convex/_generated/*` is **never** hand-edited. Only output produced by the
official CLI is committed. The Phase 175 integrity test asserts that every
Convex module on disk appears in `_generated/api.d.ts`, so a stale or
hand-patched generated directory fails the suite.

### Hard gate

A production deployment remains **BLOCKED** until Phase 184 is cleared:

```
old credential revoked -> history cleaned -> new RC identity -> artifacts rebuilt
```

A successful deployment is evidence that the backend runs. It is not
permission to release. These are separate decisions and must not be conflated.

## Phase 187 — hand-added generated API entry

`src/convex/otpLimiter.ts` is a new Convex module. `_generated/api.d.ts` lists
modules explicitly, and `npx convex codegen` cannot run here (Phase 186), so
the `otpLimiter` entry was added by hand — the same precedent Phase 174 set
for `entitlements` and `protectedAnalysis`, and the Phase 175 integrity test
enforces that the list matches the modules on disk.

Scope of the edit: two lines, an import and a map entry. It affects **types
only**. `api.js` exports `anyApi`, a runtime proxy, so function resolution does
not depend on the `.d.ts` at all.

`auth/emailOtp.ts` references the mutation through `makeFunctionReference`
rather than `internal.otpLimiter.*`, which is the officially supported way to
name a function without generated types. Once codegen can run, regenerate and
replace that reference with the generated one; the string path is identical.
