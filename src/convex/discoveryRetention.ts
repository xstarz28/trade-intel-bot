/**
 * Phase 320 — discovery-staging retention and one-time legacy cleanup.
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployment hit its Convex free-plan storage/IO limits (owner dashboard:
 * 1.21 GB database storage vs a 512 MB allowance). Phase 319 removed avoidable
 * request waste; this module accounts for the DATA ALREADY THERE:
 *
 *   1. `discoveryStageRows` is LEGACY RETAINED DATA. Phase 289G replaced the
 *      per-row implementation (one document per catalog row — ~124,000
 *      documents for the /stocks catalog alone) with chunked documents, and
 *      NOTHING in current production code writes or reads the old table any
 *      more (the only repository references are its schema definition and the
 *      phase-289g test that pins the replacement). Whatever rows the pre-289G
 *      era left behind sit in the deployment forever unless a bounded cleanup
 *      removes them.
 *   2. The staging lifecycle has three bounded failure modes:
 *        - an ABANDONED stage: `openStage` ran but the walk died mid-action —
 *          the stage document and its chunks are never superseded (only a
 *          LATER COMPLETED walk supersedes older stages), so they persist;
 *        - ORPHAN CHUNKS: chunks whose stage document is gone (a partially
 *          completed prune). Appends always follow their own openStage
 *          (awaited, in order), so a chunk with no stage document is truly
 *          orphaned — never a write in flight;
 *        - a lost/failed scheduled prune: `supersedeOlderStages` schedules
 *          `pruneStage` per stage; a reconciliation sweep re-arms any
 *          superseded stage that still holds data.
 *
 * RETENTION POLICY (the lifecycle, not wall-clock vibes)
 * ------------------------------------------------------
 *   - The ACTIVE stage of a catalog (newest, NOT superseded, closed)  → KEEP.
 *   - A SUPERSEDED stage (a newer stage of the same catalog closed)   → PRUNE.
 *   - An ABANDONED stage (never closed AND older than
 *     ABANDONED_STAGE_RETENTION_MS)                                   → PRUNE.
 *     A live walk finishes in minutes (its transports carry 10s deadlines),
 *     so an open stage older than a day is dead by construction. The age
 *     threshold is the documented lifecycle boundary — never a bare Date.now
 *     deletion rule.
 *   - An ORPHAN chunk (no stage document)                             → PRUNE.
 *   - LEGACY `discoveryStageRows`                                     → ONE-TIME
 *     bounded drain (no current writer; the table definition stays until the
 *     owner confirms the deployment is empty — schema hygiene, Phase 320).
 *
 * SAFETY
 * ------
 *   - The sweeps touch ONLY `discoveryStageRows`, `discoveryStages` and
 *     `discoveryStageChunks`. Users, auth, analyses, journal, entitlements,
 *     alerts, notifications, historical evidence — never referenced.
 *   - Everything is bounded per invocation and resumable: a 124,000-row table
 *     is drained in batches across scheduled continuations, never one huge
 *     transaction.
 *   - Idempotent: a sweep over clean state returns a zeroed report and does
 *     nothing.
 *   - No automatic per-request triggering: the sweep runs from the weekly cron
 *     (explicitly safe lifecycle) and is operator-invocable through the CLI
 *     (`npx convex run discoveryRetention:runBoundedCleanupSweep`) — never
 *     from a dashboard render, analysis, login or discovery cycle.
 */

import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import { PRUNE_BATCH_ROWS } from "./discoveryStage";

/**
 * Self-continuation reference. `internal` is Convex's anyApi proxy at runtime,
 * so this resolves in the deployed bundle even before the checked-in generated
 * `api.d.ts` is regenerated (codegen requires control-plane access the sandbox
 * does not have) — the local cast keeps the type checker honest without
 * touching generated files.
 */
const continuationSweep = (
  internal as unknown as {
    discoveryRetention: { runBoundedCleanupSweep: FunctionReference<"mutation", "internal"> };
  }
).discoveryRetention.runBoundedCleanupSweep;

/** Legacy per-row documents deleted per sweep invocation (bounded). */
export const LEGACY_ROWS_BATCH = 2000;
/** Stage documents reconciled (inline pruned) per sweep invocation. */
export const MAX_STAGES_PER_SWEEP = 3;
/** Orphan-chunk scan width per sweep invocation. */
export const ORPHAN_SCAN_BATCH = 200;
/**
 * An open (never closed) stage older than this is abandoned: the walk's own
 * transports carry 10s deadlines, so a live walk cannot outlive this window.
 */
export const ABANDONED_STAGE_RETENTION_MS = 24 * 60 * 60_000;

export interface CleanupReport {
  /** Legacy `discoveryStageRows` documents deleted this invocation. */
  legacyRowsDeleted: number;
  /** Stage documents reconciled (marked + inline-pruned) this invocation. */
  stagesReconciled: number;
  /** Orphan chunk documents deleted this invocation. */
  orphanChunksDeleted: number;
  /** Deterministic per-stage detail (stageId, why, remaining chunk batches). */
  reconciled: Array<{ stageId: string; reason: "superseded" | "abandoned"; remainingBatches: number }>;
  /** Whether at least one more sweep is required (state, not telemetry). */
  moreWorkRemaining: boolean;
}

export const runBoundedCleanupSweep = internalMutation({
  args: {},
  handler: async (ctx): Promise<CleanupReport> => {
    const now = Date.now();

    // ── 1. Legacy drain (bounded; reschedules itself while a full batch went) ──
    const legacy = await ctx.db
      .query("discoveryStageRows")
      .take(LEGACY_ROWS_BATCH);
    for (const row of legacy) {
      await ctx.db.delete(row._id);
    }

    // Stage-candidate inventory is taken BEFORE any patch below: it is a READ
    // (stage docs are metadata-sized), and it is what lets the legacy drain
    // return a transaction that contains NO update — see the isolation note.
    const stages = await ctx.db.query("discoveryStages").collect();
    // Newest-first by createdAt: the ACTIVE stage of each catalog is the most
    // recent non-superseded one — it is NEVER a prune candidate. Collecting
    // all stage metadata is metadata-sized (one small doc per walk), not
    // catalog-sized; the CATALOG data is only touched through the bounded
    // inline prune below.
    const candidates = stages
      .filter((s) => {
        if (s.supersededAt !== undefined) return true; // superseded → prune
        // never closed AND past the documented retention boundary → abandoned
        return s.closedAt === undefined && now - s.createdAt > ABANDONED_STAGE_RETENTION_MS;
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    // ── 2. Orphan chunks (bounded scan; append-always-after-open ⇒ no doc ⇒ orphan) ──
    // Delete-only, so it is safe to run in the legacy-drain invocation too.
    let orphanChunksDeleted = 0;
    const sampled = await ctx.db
      .query("discoveryStageChunks")
      .take(ORPHAN_SCAN_BATCH);
    const stagePresence = new Map<string, boolean>();
    for (const chunk of sampled) {
      let present = stagePresence.get(chunk.stageId);
      if (present === undefined) {
        const stageDoc = await ctx.db
          .query("discoveryStages")
          .withIndex("by_stage", (q) => q.eq("stageId", chunk.stageId))
          .first();
        present = stageDoc !== null;
        stagePresence.set(chunk.stageId, present);
      }
      if (!present) {
        await ctx.db.delete(chunk._id);
        orphanChunksDeleted++;
      }
    }

    // ── 3. TRANSACTION ISOLATION — legacy drain never shares a commit with a patch ──
    // A sweep invocation is ONE Convex transaction. The abandoned-stage leg
    // PATCHes `supersededAt` (an update); the legacy drain is pure DELETE.
    // Convex's own limits documentation (docs.convex.dev/production/state/limits)
    // states that after the Free plan's resource limits are hit, "new mutations
    // that attempt to commit more insertions or updates may fail". Coupling the
    // drain to that patch would let one refused update roll back the deletes
    // and deadlock the recovery this module exists to perform. So: while any
    // legacy row was drained, this invocation commits deletes (+ the orphan
    // deletes) and returns; staging reconciliation waits for the next sweep.
    if (legacy.length > 0) {
      const moreWorkRemaining =
        legacy.length === LEGACY_ROWS_BATCH ||
        candidates.length > 0 ||
        orphanChunksDeleted > 0;
      if (legacy.length === LEGACY_ROWS_BATCH || candidates.length > 0) {
        // The cleanup continues across scheduled invocations — bounded,
        // resumable, never one huge transaction.
        await ctx.scheduler.runAfter(0, continuationSweep, {});
      }
      return {
        legacyRowsDeleted: legacy.length,
        stagesReconciled: 0,
        orphanChunksDeleted,
        reconciled: [],
        moreWorkRemaining,
      };
    }

    // ── 4. Stage reconciliation (bounded to MAX_STAGES_PER_SWEEP stages) ──
    const reconciled: CleanupReport["reconciled"] = [];
    let stagesReconciled = 0;
    for (const stage of candidates) {
      const reason: "superseded" | "abandoned" =
        stage.supersededAt !== undefined ? "superseded" : "abandoned";
      if (stagesReconciled >= MAX_STAGES_PER_SWEEP) continue;
      if (reason === "abandoned") {
        // Record the lifecycle fact before pruning (bounded patch).
        await ctx.db.patch(stage._id, { supersededAt: now });
      }
      // Inline bounded prune — the SAME primitive `pruneStage` performs,
      // written with ctx.db because run* helpers are action-only: delete one
      // batch of chunk docs; only when the stage holds no chunk docs any more,
      // remove the stage document itself. A larger stage simply reconciles
      // across sweeps (each sweep takes the next batch), so a 124k-row stage
      // never prunes in one transaction and nothing is ever half-deleted into
      // an inconsistent state (chunks-without-docs are the orphan sweep's
      // exact contract).
      const batch = await ctx.db
        .query("discoveryStageChunks")
        .withIndex("by_stage_seq", (q) => q.eq("stageId", stage.stageId))
        .take(PRUNE_BATCH_ROWS);
      for (const chunk of batch) {
        await ctx.db.delete(chunk._id);
      }
      if (batch.length < PRUNE_BATCH_ROWS) {
        const stageDocs = await ctx.db
          .query("discoveryStages")
          .withIndex("by_stage", (q) => q.eq("stageId", stage.stageId))
          .collect();
        for (const doc of stageDocs) {
          await ctx.db.delete(doc._id);
        }
      }
      reconciled.push({
        stageId: stage.stageId,
        reason,
        remainingBatches: batch.length >= PRUNE_BATCH_ROWS ? 1 : 0,
      });
      stagesReconciled++;
    }

    // ── 5. Report + continuation signal ──
    const moreWorkRemaining =
      legacy.length === LEGACY_ROWS_BATCH ||
      candidates.length > stagesReconciled ||
      reconciled.some((r) => r.remainingBatches > 0) ||
      orphanChunksDeleted > 0;

    if (
      legacy.length === LEGACY_ROWS_BATCH ||
      candidates.length > stagesReconciled ||
      reconciled.some((r) => r.remainingBatches > 0)
    ) {
      // The cleanup continues across scheduled invocations — bounded,
      // resumable, never one huge transaction.
      await ctx.scheduler.runAfter(0, continuationSweep, {});
    }

    return {
      legacyRowsDeleted: legacy.length,
      stagesReconciled,
      orphanChunksDeleted,
      reconciled,
      moreWorkRemaining,
    };
  },
});
