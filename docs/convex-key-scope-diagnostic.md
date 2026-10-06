# DIAGNOSTIC — why the runner still receives the OLD Convex deploy key

Diagnostic-only run: 37413464082 (workflow Development auth verify, head f21483ae, ref
arena/01a0d195-trade-intel-bot). NO secret changed, NO deploy, NO phase.

## Items 1–6 (verified)
1. Run 37413124948 = "Development auth verify" #24, path
   `.github/workflows/development-auth-verify.yml`, event workflow_dispatch, head_branch
   **main**, head_sha **0c61d1d4c53bde93e1e681443e6f0a2dfd1db793** (the blob-sync commit).
2. At that SHA the job `auth-verify` declares **`environment: development`** (line 54).
3. The injection expression is exactly **`${{ secrets.CONVEX_DEPLOY_KEY }}`** (5 usages).
4. Scopes in play: **org = N/A** (`xstarz28` is a user account, GET /orgs → 404). Two
   environments exist: `development` (id 22729058732, protection_rules [], no branch
   policy) and `Production` (id 22235977822). Repo/environment secret METADATA lists are
   403 for this identity (admin-only) — names/dates unreadable from here.
5. The `development` environment OBJECT exists with no protections — yet runtime
   attachment could not be confirmed: the probe variable `GITHUB_ENVIRONMENT` is NOT a
   guaranteed default (my `<none attached>` line is INCONCLUSIVE and I retract it as
   evidence).
6. The latest diagnostic executed at head f21483ae (docs/workflow-only lineage;
   product bytes 2633125afdca… untouched).

## Exact effective cause (by GitHub secret precedence, not by guess)
`secrets.CONVEX_DEPLOY_KEY` resolves, in order: environment-scoped (IF attached) →
repository-scoped. The runner consistently receives a key whose printed prefix is
`dev:tough-goose-455` — the OLD deployment. Therefore **the winning scope for this job
still holds the OLD key**, and the owner's visibly-correct new key
(`dev:calculating-eagle-241|…`) landed in a NON-winning place. Possible non-winning
places, given (4): the `Production` environment (wrong env), the repository scope updated
while an old `development`-env value shadows it (env wins → old), or the save never
committed. GitHub's own warning about environment attachment, if any, only appears in the
log stream this identity cannot read — so the report stops at the provable layer.

## Minimum owner action (covers every branch — same value in BOTH scopes)
In GitHub → trade-intel-bot → Settings → Secrets and variables → Actions:
1. **Repository secrets** → create/update `CONVEX_DEPLOY_KEY` = the new key
   (starts `dev:calculating-eagle-241|`).
2. **Environments → development → environment secrets** → update `CONVEX_DEPLOY_KEY`
   to the SAME new key (this scope shadows the repo one whenever the environment
   attaches, so it must not keep the old value).
3. While there: if `CONVEX_DEPLOY_KEY` exists under the **Production environment**,
   ignore it for this purpose (that is a different scope entirely).
Then say "lanjut" — the fingerprint re-check (30 s) will prove which scope serves, and
the full chain executes.
