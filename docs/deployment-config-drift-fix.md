# DEPLOYMENT CONFIGURATION DRIFT — DETERMINATION & FIX STATE

Activation tip: `git log -1` (workflow/docs-only). Product bytes UNCHANGED (`2633125afdca…`).

## STEP 1 — exact deployment reference (authoritative: the CLI's own resolution banner, run 37414201157)
- team: `xstarz-production` · project: `xstarz-analysis`
- deployment reference: `dev/gil-xstarz` · deployment name: `calculating-eagle-241`
- URL: `https://calculating-eagle-241.convex.cloud`
- Required `CONVEX_DEPLOYMENT` value (the guard's documented `dev:<team>:<project>` shape,
  regex `/^dev:[a-z0-9-]+:[a-z0-9-]+$/i`, with the authoritative team/project):
  **`dev:xstarz-production:xstarz-analysis`**

## STEP 2 — CLI semantics (installed 1.42.1, source-verified)
`getDeploymentSelectionFromEnv`: when `CONVEX_DEPLOY_KEY` holds a DEPLOYMENT key, the
deployment is taken FROM THE KEY and "selectors … will be ignored"; `CONVEX_DEPLOYMENT`
is not consulted (source comment states this explicitly). Therefore the stale var cannot
redirect the deploy — but the guard requires the variable PRESENT and dev-shaped
(fail-closed `MISSING_DEPLOYMENT_IDENTITY` otherwise), and if the key were ever absent
the CLI WOULD fall back to this var — so it must not stay stale.

## STEP 3 — state after this commit
- Repo-side fixed: `ci.yml` no longer references the retired URL (build now embeds the
  fresh dev URL); smoke already retargeted; deploy workflow documents the key-wins
  semantics and keeps the guard's identity injection.
- Remaining owner-side (THE one action, both values in one edit):
  GitHub → trade-intel-bot → Settings → Environments → **development**:
  1. `CONVEX_DEPLOYMENT` = `dev:xstarz-production:xstarz-analysis`
  2. `VITE_CONVEX_URL` = `https://calculating-eagle-241.convex.cloud`

## STEP 4 — STOP state (per brief)
Key fingerprint = `dev:calculating-eagle-241` ✓ (run 37414068310).
`CONVEX_DEPLOYMENT` (old `dev:gil-xstarz:trade-intel`) and `VITE_CONVEX_URL`
(old tough-goose URL) are still old → chain STOPPED before deploy per instructions.
NOTE for the next attempt: the push previously failed with a KEY PERMISSION error
(`deployment:data:view`) — if that persists after the variables are corrected, the
deployment key's permission set is the remaining item (the dashboard implements
correcting it by issuing the key again with full default permissions).
