# FRESH CONVEX — KEY NOW TARGETS THE NEW DEPLOYMENT BUT LACKS PERMISSIONS

Activation tip: see `git log -1` (docs-only). Product bytes UNCHANGED (`2633125afdca…`).

## STEP 0 — fingerprint (run 37414068310)
- workflow run 37414068310 · ref `arena/01a0d195-trade-intel-bot` · workflow SHA `f21483ae`
- environment name: `development` (declared on the job; runtime attachment not independently
  provable — documented earlier) · secret presence: PRESENT
- effective deployment-key prefix: **`dev:calculating-eagle-241`** ✓ (STOP condition cleared)

## STEP 1 — push attempt (run 37414201157) — REFUSED BY KEY PERMISSIONS
The deploy CLI resolved the CORRECT target, then the push failed:

```
▌ [Development] xstarz-production:xstarz-analysis:dev/gil-xstarz (dev)
▌ └─ https://calculating-eagle-241.convex.cloud
- Preparing Convex functions...
✖ You do not have permission to perform this operation (deployment:data:view).
  This is determined by the permissions granted to CONVEX_DEPLOY_KEY.
```

The same permission error refuses every key-authenticated data operation
(`convex run auth:signIn`, retention sweep, `env list`).

## Diagnosis
The installed key AUTHENTICATES and IDENTIFIES `calculating-eagle-241`, but it was created
with a RESTRICTED permission set (data-view-only style) — it can neither push functions nor
execute/write data. This is a key-CREATION choice, not a repository defect and not the old
deployment.

## THE ONE OWNER ACTION
dashboard.convex.dev → **Xstarz Production** → **Xstarz Analysis** → deployment
**calculating-eagle-241** → **Settings → Deployment Keys**:
1. Delete/ignore the restricted key you created.
2. **Create Deployment Key** with scope **Development** and **FULL default permissions** —
   do NOT tick any "view/read-only/data-view" restriction if the UI offers one. The key must
   be allowed to (a) push/deploy functions and (b) read AND write data.
3. GitHub → trade-intel-bot → Settings → Secrets and variables → Actions → update
   **CONVEX_DEPLOY_KEY** in BOTH places (Repository secrets AND Environment `development`)
   with this full-permission key (it will still start `dev:calculating-eagle-241|`).
4. Say "lanjut" — fingerprint re-check → deploy → real anonymous sign-in → data-plane →
   4× exact smoke → production deployment (US East) → production auth+smoke → repoint →
   republish → FINAL GATE, all in one go.

No code change is needed for any of this; the chain is fully prepared.
