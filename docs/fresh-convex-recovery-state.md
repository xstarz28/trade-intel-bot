# FRESH CONVEX BACKEND RECOVERY — STATE (calculating-eagle-241)

Product bytes remain EXACTLY `2633125afdca046fb4b47fadb355d007a0d9f5d8`. All changes in this
recovery are deployment/workflow configuration only.

## Verified so far (live, via the auth-verify diagnostic)
- **New deployment reachable**: `https://calculating-eagle-241.convex.cloud/instance_name`
  answers `calculating-eagle-241` (dev/gil-xstarz, US East, never deployed).
- **Old deployment**: still answers reads; data-plane refused (free-plan over-limit, quoted).
- **Access verdict**: the repository's `CONVEX_DEPLOY_KEY` secret STILL resolves to
  `tough-goose-455` (proven by the runtime error text discriminator — the free-plan refusal is
  the old deployment's signature; a fresh undeployed target would report a missing function).
  The agent therefore CANNOT deploy to the new project until the key is updated — an
  owner-only credential action by design.

## Prepared and waiting (single relay chain once the key lands)
1. `development-deploy-relay` (ref=arena/01a0d195-trade-intel-bot) → pushes the EXISTING
   backend to the key's (new) deployment. No schema/auth redesign.
2. `development-auth-verify-relay` → proves: Anonymous provider deployed, real anonymous
   sign-in PASS (key-targeted AND via the public API — a real session, not HTTP 200),
   data-plane writes working, no free-plan error.
3. Exact-only smoke matrix (workflow retargeted to calculating-eagle-241 with an explicit
   `--allow-host`): EUR/USD H4 → XAU/USD D1 → BTC/USDT M30 → AAPL W1, sequentially.
4. Then: production deployment step (see below) + VITE_CONVEX_URL repoint.

## Production deployment determination (brief step 7)
The fresh project currently has ONLY the dev deployment (dev/gil-xstarz). For RELEASE READY
the project needs its PRODUCTION deployment created (US East), a production deploy key, and
`npx convex deploy` (production) from the accepted sources. Per the brief this happens only
AFTER dev auth + runtime health are proven.

## VITE_CONVEX_URL repoint plan (brief step 9)
- GitHub Actions variable `VITE_CONVEX_URL` → https://calculating-eagle-241.convex.cloud
  (owner clicks; the deploy/publish workflows read it).
- `ci.yml` build env (workflow-hardcoded) → same URL (agent, after smoke passes).
- Rebuild FROM the accepted source commit `2633125…` with the new URL → publish → verify:
  product LOGIC bytes unchanged; only the embedded backend URL constant differs, so a fresh
  provenance sha256 is expected and honest.

## The ONE owner action that unblocks everything (exact clicks)
1. https://dashboard.convex.dev → team **Xstarz Production** → project **Xstarz Analysis**
   → deployment **calculating-eagle-241** → Settings → **Deployment Keys** →
   **Create Deployment Key** → scope **Development** → copy the value.
2. GitHub → xstarz28/trade-intel-bot → Settings → Secrets and variables → Actions →
   **Repository secrets** → edit **CONVEX_DEPLOY_KEY** → paste the new key → save.
   (The old key stays in the old deployment's page and the old deployment is not deleted.)
Nothing else — after this, dispatch one `development-deploy-relay` and the chain runs.
