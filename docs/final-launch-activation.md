# FINAL LAUNCH ACTIVATION — XSTARZG RELEASE UNBLOCK (record)

Date: 2026-10-05/06 · branch `arena/01a0d195-trade-intel-bot` · activation tip `06ae035`.
Product bytes remain EXACTLY the accepted artifact `2633125afdca046fb4b47fadb355d007a0d9f5d8`
(post-325 commits are workflow/docs-only; verified by `git diff --name-only 2633125..06ae035`
yielding `.github/workflows/publish-development-frontend.yml` + docs).

## STEP 1 — re-audit ✓
Tree clean; `50e16c8` was docs-only; CI green; lineage intact.

## STEP 2 — public frontend: VERIFIED GREEN
Root cause of the long-running verify failures was a WORKFLOW GAP, not the host: in
`verify-only` mode `XSTARZ_FRONTEND_HOST_URL` was only set by publish-only steps, so the
verifier ran with an EMPTY `--url` (usage error) every time. Activation plumbing (workflow-only,
synced to main via the sanctioned blob pattern) fixed the step env + surfaced the verifier's
failure lines as API-readable annotations. Final verdict — verify-only run **37409010844
SUCCESS** against the browser-facing host: HTTP ok · served build provenance = commit
`2633125afdca…` · served bytes = the accepted artifact · retired scaffold markers absent ·
OTP surface absent · Google+guest copy present · XSTARZG identity present.

## STEP 3 — Convex production backend: WRITABLE ✓ / RUNTIME AUTH ✗ (external)
- Deployment `tough-goose-455.convex.cloud` answers (probe HTTP 200, api plane reachable).
- Functions push SUCCEEDED (Development deploy run **37408302471**) → write capacity proven.
- Guest/anonymous runtime sign-in FAILS persistently: smoke runs 37408706058 + 37408845382,
  every exact instrument honest `UNAVAILABLE — no anonymous session: sign-in failed`
  (no fabricated results). `convex/` delta since the last passing smoke (53c26aa) is
  retention-only; auth code and harness unchanged → deployment-side runtime state.
  Classification: **EXTERNAL CONVEX RUNTIME BLOCKER** (auth:signIn anonymous path).

## STEP 4 — Google auth (presence audit, values never printed)
`state=GOOGLE_AUTH_NOT_CONFIGURED · missing=AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, SITE_URL,
CONVEX_SITE_URL · invalid=none · callback=none` (auth-verify 37405769088). Guest path exists in
code; its runtime failure is the blocker above (distinct from Google OAuth).

## STEP 5 — provider runtime acceptance: EXTERNALLY BLOCKED
Both exact-only matrix attempts produced honest UNAVAILABLE at the session step; no fake prices,
no substitution, no historical-as-live. The harness, identities and budget logic behaved
correctly (pacing model ran, TD credits untouched).

## STEP 6 — entitlement: deterministic proof intact; live boundary needs the session fix
Server rules pinned by tests (free allowance 2, WAIT/NO_TRADE free, UNKNOWN≠0, no client grant);
live verification requires the blocked anonymous session.

## STEP 7–9 — journey / UX / pricing
Public surface verified at the HTTP+artifact level (published verifier); deep click-through
journey requires the blocked session. Identity discipline remains test-pinned (no violet, no
decorative emoji, no blur-xl, no AI copy). Pricing reality unchanged: Professional = planned,
checkout honestly disabled; technical release ≠ commercial activation.

## STEP 10 — deterministic gates at the activation tip (06ae035)
tsc 0 · production build WITH VITE_CONVEX_URL ✓ · frontend artifact verification 26 ok / 0 fail ·
full suite **494 files / 15,336 PASS | 0 FAIL | 9 skipped** (baseline preserved) ·
CI 37408690111 SUCCESS · secret scan SUCCESS · Android APK ✓ · iOS compile ✓ · Windows/Tauri ✓ ·
published-URL verification SUCCESS.

## STEP 11 — decision: B — RELEASE CANDIDATE — EXTERNAL BLOCKER (narrowed)
Every repository-side gate is green and the browser-facing site now provably serves the accepted
artifact. ONE precise owner action remains for full (A) activation:
  Inspect the Convex deployment `tough-goose-455` runtime for the `auth:signIn`
  (provider "anonymous") failure — dashboard function logs — and restore the guest
  session path. Then re-run the exact-only smoke matrix; if green, the release is A.
Secondary owner items (not blocking the technical release classification): the four Google
auth env vars for sign-in flows; billing whenever commercial activation is wanted.
