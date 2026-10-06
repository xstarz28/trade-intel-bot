# Phase 325 — Final Production Pass / Release Closure

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Release commit: **`2633125`**
(`2633125afdca046fb4b47fadb355d007a0d9f5d8`, phase 324 tip — this phase commits closure
documentation only). Roadmap complete: 321 local Convex escape · 322 XSTARZG identity ·
323 product UX · 324 pricing · **325 release closure**.

## Release decision: **B — RELEASE CANDIDATE — EXTERNAL BLOCKER**

Every repository-side release gate passes at `2633125`. Live production proof is blocked by two
**external, owner-side** dependencies (detailed below). Nothing repository-side is red; nothing
was weakened to turn it green.

## 1. Verified capabilities (all gates at the release commit)

| Gate | Result |
|---|---|
| `tsc -b` | 0 errors |
| Production build WITH `VITE_CONVEX_URL` (CI-exact) | ✓ |
| Frontend artifact verification (`verify:frontend --require-clean`) against the real dist | **26 ok / 0 fail** (provenance commit+branch, XSTARZG theme pins both schemes, retired markers absent — old teal AND pre-322 blue, OTP surface absent, Google+guest copy shipped, clean tree) |
| Full regression vs the CI-exact dist | **494 files / 15,336 PASS \| 0 FAIL \| 9 skipped** |
| CI at tip `2633125` (run 37404390039) | SUCCESS (test+typecheck+build+lint, Reachable-history secret scan) |
| Mobile/packaging at tip | **Android debug APK ✓ · iOS compile ✓ · Windows/Tauri ✓** (check-runs on the commit) |
| Secret scanning | Reachable-history scan SUCCESS (CI job) |

Journey audit at the release commit (source-verified): `/` → `/pricing` (public) → `/auth`
(Google + guest; OTP surface retired and artifact-pinned absent) → `/dashboard` (RequireAuth) →
instrument selection → analysis → decision output (SignalCard) → chart → evidence → trade plan →
history → protection/investor workspace → `/journal` (protected), `/download`, `/build`,
`/privacy`, `/terms` (public), `*` → NotFound. Identity pinned by the 322/323 suites (graphite/
steel/chrome, no violet, no decorative emoji, no `backdrop-blur-xl`); pricing honesty pinned by
the 324 suite (server-enforced split, no fabricated price/checkout/subscription/client grant).

## 2. Production deployment evidence (this phase, live GitHub Actions)

- **Publish path** (frozen 300K mechanism, via the dispatch relay): run **37406011488** —
  artifact for commit `2633125afdca046fb4b47fadb355d007a0d9f5d8` passed the artifact contract,
  was deployed through the project-scoped REST path, and the browser-facing host was re-pointed
  (alias REST **200**): recorded URL `https://trade-intel-7noetycsl-xstarz.vercel.app`,
  provenance sha256 `5681fdec173c7c97a570506afd9e478b4ad78d62ede3417f2bb05e95e068caeb`
  (deployed bytes = verified artifact bytes, pinned at deploy time).
- **Published-URL fetch verification FAILED** (the run's final acceptance step), and a
  `verify-only` re-check twice more (runs 37406442628, 37407042032; bounded — no further
  retries) kept failing on the same step ~15 minutes after publish. Everything the verifier
  demands is proven green against the SAME dist locally and in CI; the failing link is therefore
  the **served bytes at the host URL** (edge/alias propagation or a stale pinned host variable)
  — host-side, not resolvable from this repository. **The live URL is NOT claimed as serving the
  release candidate.**
- **Convex Cloud reachability**: the auth-verify relay run **37405769088** completed its
  classification against the deployment today — `state=GOOGLE_AUTH_NOT_CONFIGURED ·
  missing=AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, SITE_URL, CONVEX_SITE_URL · invalid=none ·
  callback=none`. The deployment **answered a read** (env listing) — the same expected
  credential state as Phase 319. Write-side (function push / dynamic analysis) was NOT probed:
  forcing a write against an owner-gated deployment is forbidden.

## 3. Known external blockers (the "B")

1. **Published-URL fetch verdict** — see §2: deploy-time byte identity is proven; the
   browser-facing fetch currently does not return the new artifact (host-side). Owner action:
   confirm `FRONTEND_HOST_URL` variable target / Vercel alias + edge state, then one
   `verify-only` dispatch closes this.
2. **Google OAuth credentials** — `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL`,
   `CONVEX_SITE_URL` absent (owner-side). Real sign-in remains a separate acceptance act.
3. **Convex Cloud Free-plan ownership** — owner-side usage/plan decision (Phase 320 context);
   reads answer, write-capacity unproven, dynamic live analysis acceptance therefore deferred.
4. **Billing** — intentionally none: `/pricing` honestly presents Professional as planned with
   checkout disabled until a real billing system exists (post-closure commercial decision).

## 4. Deployment target

- Frontend: Vercel project (browser-facing development host via the pinned repo variable;
  publish path = frozen Phase-300K mechanism).
- Backend: Convex Cloud dev deployment `tough-goose-455` (env-var `VITE_CONVEX_URL` baked at
  build; CI and deploy workflows use the dev-scoped `CONVEX_DEPLOY_KEY`).
- Local development: Convex Local Deployment via Phase 321 tooling — never replaces production.

## 5. Deferred (intentionally NOT new scope)

Real billing provider + prices; payment webhook wiring of the server-side grant; Google OAuth
credential provisioning; owner-side Convex plan resolution; GoPay/DANA/ShopeePay/crypto rails
(explicitly out of scope per brief); any product-UX expansion.

## 6. What would flip this to RELEASE READY

1. Owner confirms/fixes the host variable/alias → one `verify-only` publish dispatch passes.
2. Owner sets the four auth env vars → auth-verify reaches CONFIGURED.
3. Convex write-capacity confirmed → the standard development-deploy + runtime-smoke chain runs
   (BTC-USDT okx M30, XAU/USD D1, EUR/USD H4, AAPL W1 exact-only mode).
