# Phase 320 — Convex Database Cleanup, Storage Recovery & Long-Term Retention

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 319 docs tip `b223d57`.
Code tips: `a4326fb` (cleanup + retention + cron) → `c00d080` (sweep transaction isolation).
No blind schema drop, no user/auth/business data touched, no fabricated telemetry, no auto-cleanup
per request, no public mutation path.

Mission context: the owner dashboard showed the development deployment over the Convex Free-plan
allowances (Storage 1.21 GB vs 512 MB, function I/O 5.05 GB vs 1 GB, egress 886 MB vs 1 GB).
Phase 319 removed avoidable request waste; phase 320 accounts for the DATA ALREADY THERE and
installs the long-term lifecycle.

## 1. Table audit (§1) — writer/reader inventory

`schema.ts` defines **18 application tables** plus the `authTables` spread from
`@convex-dev/auth/server` (component-owned session/user/account tables). Classification:

| Table | Writers (current code) | Readers (current code) | Class |
|---|---|---|---|
| `users`, `entitlements`, `analyses`, `journal` | app/auth flows | app/auth flows | **PROTECTED — business/auth data, never swept** |
| `monitoredPositions`, `alertHistory`, `alertRules`, `ruleAlertHistory`, `notifications`, `notificationPreferences`, `streamCursors`, `historicalSnapshots`, `historicalEvents`, `runtimeHealthSnapshots`, `otpResendBuckets` | their own features | their own features | **PROTECTED — app data, never swept** |
| auth component tables (`authTables`) | `@convex-dev/auth` | `@convex-dev/auth` | **PROTECTED — auth data, never swept** |
| `discoveryStages` | `discoveryStage.ts` openStage/closeStage/supersede | `readStageRows` + chunk joins | **ACTIVE — lifecycle-managed** |
| `discoveryStageChunks` | `discoveryStage.ts` appendStageChunks | `readStageRows` | **ACTIVE — lifecycle-managed** |
| `discoveryStageRows` | **NONE** (grep: only `schema.ts` definition + the phase-289g replacement test) | **NONE** (same grep) | **LEGACY RETAINED DATA — bounded drain** |

**`discoveryStageRows` verdict:** it is the pre-289G per-row staging (one document per catalog
row — ≈124,000 documents for the `/stocks` walk alone). Phase 289G replaced the mechanism with
chunked documents and NOTHING in current production code reads or writes the old table. Any rows
left in the deployment are pure retained ballast. Per the schema-hygiene rule the table DEFINITION
is retained until the owner confirms the table is empty (removing a table definition from a live
schema is a separate, owner-visible act — never part of a cleanup sweep). Indexes were not touched.

## 2. Retention policy (the lifecycle, not wall-clock vibes)

Documented in the module header (`src/convex/discoveryRetention.ts`):

- **ACTIVE** stage of a catalog (newest, not superseded, closed) → **KEEP**. Never a candidate.
- **SUPERSEDED** stage (a newer stage of the same catalog closed) → **PRUNE**.
- **ABANDONED** stage (open, `closedAt` undefined, older than
  `ABANDONED_STAGE_RETENTION_MS` = 24 h) → **mark + PRUNE**. A live walk finishes in minutes
  (transports carry 10 s deadlines), so an open stage older than a day is dead by construction —
  this is a documented lifecycle boundary, never a bare `Date.now()` deletion rule.
- **ORPHAN** chunk (no stage document) → **PRUNE**. Appends always follow their own awaited
  `openStage` in order, so a chunk without a stage document is truly orphaned, never in-flight.
- **Legacy rows** → one-time bounded drain.

## 3. The cleanup mechanism — bounded, resumable, fail-closed, transaction-isolated

`src/convex/discoveryRetention.ts` exports `runBoundedCleanupSweep` (internalMutation — no public
API surface; internal functions are unreachable from the client by Convex semantics):

- Batches: `LEGACY_ROWS_BATCH = 2000` legacy docs, `MAX_STAGES_PER_SWEEP = 3` stages,
  `PRUNE_BATCH_ROWS = 512` chunk docs per stage (exported from `discoveryStage.ts` — the same
  primitive the shipped `pruneStage` uses), `ORPHAN_SCAN_BATCH = 200` sampled chunks.
- A stage larger than one batch reconciles ACROSS sweeps (`remainingBatches` in the deterministic
  report); nothing is ever half-pruned into an inconsistent state.
- Returns a deterministic `CleanupReport {legacyRowsDeleted, stagesReconciled, orphanChunksDeleted,
  reconciled[{stageId, reason, remainingBatches}], moreWorkRemaining}` and schedules its own
  bounded continuation while work remains. Idempotent and safe on empty state.
- **Transaction isolation (added in `c00d080`):** a sweep invocation is ONE Convex transaction.
  The abandoned-stage leg patches `supersededAt` (an update); the legacy drain is pure DELETE.
  Convex's limits documentation states that after the Free plan's resource limits are hit "new
  mutations that attempt to commit more insertions or updates may fail". Coupling the drain to the
  patch would let one refused update roll back the deletes and deadlock the recovery. Therefore:
  while any legacy row was drained, the invocation commits deletes only (drain + orphan deletes)
  and returns; staging reconciliation waits for the next sweep.

## 4. Execution paths — exactly two, both deliberate

1. **Weekly cron** `crons.ts` → `discovery-retention-sweep`, Sundays 03:00 UTC. This is the only
   scheduled lifecycle in the deployment. (Convex does not backfill missed windows: the cron was
   registered 2026-10-05 ≈08:49 UTC, after that day's 03:00 window, so its first natural fire is
   **2026-10-12 03:00 UTC** unless invoked sooner.)
2. **Operator CLI** (owner, from an authenticated control-plane session):
   `npx convex run discoveryRetention:runBoundedCleanupSweep`.

There is NO public mutation, NO dashboard-render/login/analysis/request trigger, and the module is
imported by nothing on the hot path. Safe-when-empty: a sweep over clean state returns a zeroed
report (test F).

## 5. Deterministic tests (§A–M) — `src/convex/discovery-retention.phase320.test.ts`

9 tests: A legacy drain with exact counts · G 4005-row multi-sweep batch chain · B active stage
never a candidate · C superseded-without-prune re-armed · E abandoned vs fresh open (24 h
boundary) · D orphan chunk deleted · F idempotence (zeroed report over clean state) · H user rows
survive while staging is cleaned (scope protection) · L/M shipped lifecycle round trip + a pruned
stage reads back EMPTY through `readStageRows` (no stale-as-live, no completeness regression).

## 6. Validation (deterministic + CI) — all green at BOTH tips

| Check | `a4326fb` | `c00d080` |
|---|---|---|
| `tsc -b` | 0 errors | 0 errors |
| `npm run build` | ✓ | ✓ (6.89 s) |
| FULL vitest | **490 files / 15,292 PASS / 0 FAIL / 13 skipped** | **490 files / 15,292 PASS / 0 FAIL / 13 skipped** |
| CI (push, `arena/**`) | **SUCCESS** (run @ 08:49:23Z) | in progress at doc time — push event |

`_generated/api.d.ts` was hand-extended additively (imports + fullApi entries for the two new
modules) because codegen needs control-plane access the sandbox does not have; regenerate it
properly on the next owner-side `npx convex dev`. Runtime unaffected (anyApi proxy).

## 7. Deployment provenance

| Run | Commit | Result |
|---|---|---|
| deploy 37286054856 | `a4326fb` | **SUCCESS** (08:49Z) |
| deploy 37289188089 | `c00d080` | **SUCCESS** (09:18Z, after the isolation hardening) |

The development deployment currently runs `c00d080` functions — same commit as the pushed arena
tip (production-chain rule; the two rollback attempts below never deployed anything).

## 8. Live verification — EXTERNALLY BLOCKED (conviction: 4 deterministic runs)

The exact-only live smoke (`domains=none`) against the deployed runtime could not complete. Every
failure is the SAME signature: the API plane answers READS (`/version` OK,
`entitlements:getMyEntitlement` liveness OK) while `auth:signIn` — the first WRITE (anonymous
sign-in inserts user/session rows) — fails with NO structured function error (`appError=null`,
fallback reason "sign-in failed"):

| Run (UTC) | Commit | Outcome |
|---|---|---|
| 37286275516 08:51 | `a4326fb` | COULD_NOT_LOOK — even `/version` + liveness refused (2 min after deploy) |
| 37286940216 08:57 | `a4326fb` | reached runtime; sign-in failed ×2 (EUR/USD@H4, XAU/USD@D1); exit 2 |
| 37287492850 09:03 | `a4326fb` | identical refusal (deterministic repeat) |
| 37289375213 09:20 | `c00d080` | identical refusal at the new tip (blocker re-verified post-deploy) |

Control data point: the SAME payload shape PASSED at 08:05Z (run 37281520782, BTC + AAPL
exact-only) — the deployment wrote sessions fine 44 minutes before the first failure.

**Root cause (documented, not guessed): Convex Free-plan over-limit enforcement.** Convex's own
limits page (docs.convex.dev/production/state/limits): *"After these limits are hit on the Free
plan, new mutations that attempt to commit more insertions or updates may fail"*, and long-running
overage "may return HTTP errors in response to function calls". The dashboard showed Storage at
242 % and function I/O at 505 % of the Free allowance. The read-OK/write-refused signature and the
200-without-structured-error transports match this exactly. It is NOT a regression of this phase:

- the phase's five files touch zero auth/entitlement code (module audit in §1/§3);
- the identical refusal serves for two different function bundles (`a4326fb`, `c00d080`);
- a /version outage (run @ 08:51) cannot be caused by a function bundle;
- the refused call returns no structured function error — infra refusal, not a thrown function.

A rollback experiment (deploy parent `b223d57` to discriminate code vs infra) was attempted twice
and correctly REFUSED by the phase-299 deploy guard ("source ref … is not the pinned deploy source
branch") — deploys are pinned to the branch tip by design, and creating a rollback branch would
violate branch discipline. The refusal itself re-confirmed the guard chain works.

**Consequences (honest accounting):**

- BTC-USDT@M30, EUR/USD@H4, XAU/USD@D1, AAPL@W1 live verdicts: **NOT OBTAINED — deployment
  refuses writes**. No PASS is claimed. Re-verification after the owner resolves the overage is a
  single smoke dispatch with the same four exact specs (split 2+2 across two runs for the
  Twelve Data ≤2-TFs-per-run budget).
- The retention sweep has NOT yet executed on the deployment (the sandbox has no `*.convex.cloud`
  egress, and the deployment currently refuses mutation commits anyway). Row counts deleted,
  reclaimed bytes and before/after storage are **owner-telemetry-dependent** and will be available
  at FIRST EXECUTION (weekly cron 2026-10-12 03:00 UTC, or the owner CLI command above). No
  storage-reduction claim is made.
- Under the current enforcement the delete-only drain invocation may still be admitted (Convex
  names only "insertions or updates" as refusable); the transaction isolation exists precisely so
  that this partial admission translates into reclaimed space instead of a deadlock. If even
  delete commits are refused, the weekly cron retries — bounded, idempotent, deterministic.

## 9. Owner-side dependencies (unchanged in kind, now urgent in kind)

1. **Convex plan/usage decision** (was UNOBSERVABLE telemetry in 319; now an ACTIVE runtime
   refusal): upgrade the deployment off the Free plan or clear space so mutation commits are
   admitted again. Until then every write path of the product (sign-in included) stays down.
2. `COINGLASS_API_KEY` — CREDENTIAL_REQUIRED (unchanged, 319 final state).
3. Google OAuth `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`SITE_URL`/`CONVEX_SITE_URL` —
   NOT_CONFIGURED (auth-verify 37287326280 at the phase tip reproduced the exact documented
   state: missing=4, invalid=none, callback=none).
4. Regenerate `_generated/api.d.ts` via `npx convex dev` when control-plane access exists.

## 10. Scope compliance

- §6 protection list: sweep candidates are EXACTLY the three staging tables; users/auth/business
  rows are asserted untouched (test H).
- Provider discovery/correctness untouched; exact-only smoke mode intact (all four smoke runs ran
  `domains=none` with verbatim native IDs — okx `BTC-USDT`, twelve-data `EUR/USD`, `XAU/USD`,
  `AAPL` — and exact timeframes).
- No index removed, no schema dropped, no test weakened, no provider semantics changed, no
  fabricated numbers anywhere in this document.
