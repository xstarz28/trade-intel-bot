# FINAL RELEASE UNBLOCK — CONVEX ANONYMOUS AUTH: EXACT RUNTIME VERDICT

Date: 2026-10-05/06 · activation tip `60c2131` · product bytes UNCHANGED (`2633125afdca…`).

## STEP 1 — exact underlying error (captured from the deployment itself)
Auth-verify diagnostic (run against `tough-goose-455` with the dev deploy key):

> `✖ Failed to run function "auth:signIn": Error: Server Error — You have exceeded the
> free plan limits, so your deployments have been disabled. Please upgrade to a Pro plan
> or reach out to us at support@convex.dev for help.`

The **retention sweep** (`discoveryRetention:runBoundedCleanupSweep`, the Phase-320-documented
CLI lifecycle) is refused with the SAME enforcement — the deployment refuses ALL data-plane
function execution while over-limit. Only the control plane (functions push, `env list`,
static probe) still answers, which is why the push succeeded and the probe returned HTTP 200.

## STEP 2 — repository cross-check (no repo-side defect)
- `src/convex/auth.ts` configures the Anonymous provider (unchanged since the last passing
  smoke); the harness is unchanged; the `convex/` delta since that smoke is retention-only.
- No deployment-name/env mismatch: the diagnostic ran against the deployment the workflows
  actually target.
- The one remediation the repository ships (retention sweep) is itself blocked by the same
  enforcement — there is NO repo-side fix. Per the brief: none was invented, none faked.

## STEP 3–6 — exact owner-side requirement (the single remaining blocker)
**Resolve the Convex Free-plan over-limit state of deployment `tough-goose-455`:** upgrade the
team to Pro, or contact support@convex.dev, or wait for the owner's usage cycle to reset — then
data-plane execution resumes and the anonymous guest path works unchanged. Immediately after
that, the standard chain completes: exact-only smoke matrix (EUR/USD H4, XAU/USD D1, BTC/USDT
M30, AAPL W1) → decision A is reachable without any further code change.

## STEP 7 — deterministic gates at the activation tip
tsc 0 · build WITH VITE_CONVEX_URL ✓ · verify:frontend 26 ok/0 fail · full suite 494 files /
15,336 PASS | 0 FAIL | 9 skipped · CI SUCCESS at every activation tip · secret scan ✓ ·
Android/iOS/Windows packaging ✓ · published-URL verification SUCCESS (host serves `2633125`).
Smoke matrix: honest UNAVAILABLE (3 independent evidences: runs 37408706058, 37408845382 and
this direct `auth:signIn` diagnostic).

## STEP 8 — DECISION: B — RELEASE CANDIDATE — EXTERNAL BLOCKER
Blocker narrowed to ONE sentence, quoted from the deployment: the team has exceeded the Convex
free plan limits and the deployment is disabled for data-plane execution. Owner action: Pro
upgrade / support / cycle reset. Google OAuth remains separately unconfigured (4 env vars) —
non-blocking for the guest journey once the plan is resolved.
