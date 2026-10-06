# FRESH CONVEX KEY — DECISIVE FINGERPRINT (owner retry needed)

Tip: see `git log -1` (docs-only). Product bytes UNCHANGED (`2633125afdca…`).

## Evidence (non-secret, from the workflow itself)
The auth-verify access check printed the installed key's TYPE:DEPLOYMENT prefix —
a deploy key is `<type>:<deploymentName>|<secret>` and only the part before `|`
is ever printed:

> installed deploy key identifies :: `dev:tough-goose-455`

The secret under **Environment development → CONVEX_DEPLOY_KEY** is therefore STILL the
OLD deployment's key. Consequently (all jobs read this same secret):
- the earlier "successful" deploy pushed to tough-goose-455 (old deployments still accept
  control-plane pushes; nothing user-facing changed — same function lineage it already had);
- `auth:signIn` still fails with the free-plan refusal (old deployment's data-plane);
- the smoke/deploy chain cannot reach calculating-eagle-241 until the value is corrected.

## The exact owner retry (with self-check)
1. dashboard.convex.dev → **Xstarz Production** → **Xstarz Analysis** → deployment
   **calculating-eagle-241** → Settings → **Deployment Keys** → Create → scope **Development**.
2. Copy the value. CHECK IT EYES-ON: it must START WITH `dev:calculating-eagle-241|`.
3. GitHub → trade-intel-bot → Settings → Environments → **development** → edit the secret
   **CONVEX_DEPLOY_KEY** → replace the WHOLE value with the copied key → Save.
4. Reply "lanjut" — the full chain (deploy → real anonymous sign-in → data-plane →
   4× exact smoke → production step → repoint → republish → acceptance) executes
   without further owner action.
