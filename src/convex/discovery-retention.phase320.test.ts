/**
 * Phase 320 — discovery-staging retention, against convex-test's own database
 * with the SHIPPED mutations (same pattern as the phase-289g suite).
 *
 * Covers the phase's required deterministic cases:
 *   A. legacy `discoveryStageRows` cleanup (bounded, resumable, exact counts)
 *   B. the ACTIVE stage of a catalog is protected — never a prune candidate
 *   C. a SUPERSEDED stage is reconciled (marked + pruned)
 *   D. ORPHAN chunks (stage doc gone) are deleted
 *   E. an ABANDONED stage (open past the documented retention boundary) is
 *      bounded-pruned; a FRESH open stage is never touched
 *   F. repeated sweeps are idempotent (clean state → zeroed report)
 *   G. bounded batches: a large legacy table drains across sweeps, never in
 *      one transaction
 *   H. the sweep touches ONLY the three staging tables — no user/auth/
 *      business table is ever referenced
 *   L. no stale-as-live: pruned state can never be read back as a catalog —
 *      the shipped reader answers a pruned stage with zero rows / hasMore=false
 *   M. no discovery-completeness regression: the full live walk lifecycle
 *      (stage → append → close → supersede → read) still works through the
 *      shipped functions, and the sweep leaves the active stage intact
 *
 * (I/J/K — the exact-only smoke mode and the Dashboard single-flight/window —
 * are pinned in `development-runtime-smoke.phase319.test.ts` and the Dashboard
 * artifacts; this suite does not duplicate them.)
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import {
  runBoundedCleanupSweep,
  LEGACY_ROWS_BATCH,
  ABANDONED_STAGE_RETENTION_MS,
} from "./discoveryRetention";
import {
  openStage,
  appendStageChunks,
  closeStage,
  supersedeOlderStages,
  pruneStage,
} from "./discoveryStage";

const modules = import.meta.glob("./**/*.ts");

type TestT = ReturnType<typeof convexTest>;
/** convex-test's t.mutation wants a FunctionReference at the type level. */
type MutRef = Parameters<TestT["mutation"]>[0];
function mut(fn: unknown): MutRef {
  return fn as MutRef;
}

function row(seq: number) {
  return {
    seq,
    provider: "twelve-data",
    providerInstrumentId: `SYM${seq}`,
    assetClass: "equity",
    subType: "stock",
    baseAsset: "SYM",
    quoteAsset: "USD",
    tradingState: "ACTIVE",
    capabilities: ["ohlcv"],
    discoveredAt: Date.now(),
  };
}

async function insertLegacyRows(t: TestT, stageId: string, from: number, to: number) {
  await t.run(async ({ db }) => {
    for (let seq = from; seq < to; seq++) {
      await db.insert("discoveryStageRows", {
        stageId,
        seq,
        provider: "twelve-data",
        providerInstrumentId: `SYM${seq}`,
        assetClass: "equity",
        subType: "stock",
        baseAsset: "SYM",
        quoteAsset: "USD",
        tradingState: "ACTIVE",
        capabilities: ["ohlcv"],
        discoveredAt: Date.now(),
      });
    }
  });
}

/** Seed a stage (+ one chunk) through the SHIPPED mutations. */
async function seedStage(
  t: TestT,
  opts: {
    stageId: string;
    catalogPath: string;
    close?: boolean;
    createdAtAgeMs?: number;
    rows?: number;
  },
) {
  await t.mutation(mut(openStage), {
    stageId: opts.stageId,
    provider: "twelve-data",
    catalogPath: opts.catalogPath,
    assetClass: "equity",
    discoveredAt: Date.now(),
  });
  if (opts.createdAtAgeMs !== undefined) {
    await t.run(async ({ db }) => {
      const stage = await db
        .query("discoveryStages")
        .filter((q) => q.eq(q.field("stageId"), opts.stageId))
        .first();
      await db.patch(stage!._id, { createdAt: Date.now() - opts.createdAtAgeMs! });
    });
  }
  const rows = Array.from({ length: opts.rows ?? 3 }, (_, i) => row(i));
  await t.mutation(mut(appendStageChunks), { stageId: opts.stageId, rows });
  if (opts.close) {
    await t.mutation(mut(closeStage), {
      stageId: opts.stageId,
      stagedRows: opts.rows ?? 3,
      totalDiscovered: opts.rows ?? 3,
      completeness: "COMPLETE",
      state: "complete",
    });
  }
}

async function supersede(t: TestT, catalogPath: string, keepStageId: string) {
  await t.mutation(mut(supersedeOlderStages), { catalogPath, keepStageId });
  // Deterministic inline prune for the superseded stages (the production
  // supersede schedules these; the retention sweep re-arms them too).
  const stages = await t.run(async ({ db }) => {
    const all = await db.query("discoveryStages").collect();
    return all.filter((s) => s.supersededAt !== undefined && s.stageId !== keepStageId);
  });
  for (const stage of stages) {
    await t.mutation(mut(pruneStage), { stageId: stage.stageId });
  }
}

async function sweep(t: TestT) {
  return await t.mutation(mut(runBoundedCleanupSweep), {});
}

async function counts(t: TestT) {
  return await t.run(async ({ db }) => {
    const stages = await db.query("discoveryStages").collect();
    const chunks = await db.query("discoveryStageChunks").collect();
    const legacy = await db.query("discoveryStageRows").collect();
    return { stages: stages.length, chunks: chunks.length, legacy: legacy.length };
  });
}

describe("320 — legacy discoveryStageRows cleanup (§A, §G)", () => {
  it("A: drains a small legacy table in one bounded sweep, with exact counts", async () => {
    const t = convexTest(schema, modules);
    await insertLegacyRows(t, "stage-legacy", 0, 10);
    const report = await sweep(t);
    expect(report.legacyRowsDeleted).toBe(10);
    expect(report.moreWorkRemaining).toBe(false);
    expect((await counts(t)).legacy).toBe(0);
  });

  it("G: a large legacy table drains in bounded batches across sweeps", async () => {
    const t = convexTest(schema, modules);
    await insertLegacyRows(t, "stage-legacy", 0, LEGACY_ROWS_BATCH * 2 + 5);
    const r1 = await sweep(t);
    expect(r1.legacyRowsDeleted).toBe(LEGACY_ROWS_BATCH);
    expect(r1.moreWorkRemaining).toBe(true);
    const r2 = await sweep(t);
    expect(r2.legacyRowsDeleted).toBe(LEGACY_ROWS_BATCH);
    const r3 = await sweep(t);
    expect(r3.legacyRowsDeleted).toBe(5);
    expect(r3.moreWorkRemaining).toBe(false);
    expect((await counts(t)).legacy).toBe(0);
  });
});

describe("320 — stage lifecycle protection and pruning (§B, §C, §E)", () => {
  it("B: the ACTIVE stage of a catalog is NEVER a prune candidate", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "active-1", catalogPath: "/stocks", close: true, rows: 2 });
    const report = await sweep(t);
    expect(report.stagesReconciled).toBe(0);
    const c = await counts(t);
    expect(c.stages).toBe(1);
    expect(c.chunks).toBe(1);
  });

  it("C: a SUPERSEDED stage still holding data is re-armed and reconciled by the sweep", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "old-1", catalogPath: "/forex", close: true, rows: 2 });
    await seedStage(t, { stageId: "new-1", catalogPath: "/forex", close: true, rows: 2 });
    // Supersede WITHOUT the immediate prune (the lost-scheduled-job scenario):
    await t.mutation(mut(supersedeOlderStages), { catalogPath: "/forex", keepStageId: "new-1" });
    let before = await t.run(async ({ db }) => {
      const all = await db.query("discoveryStages").collect();
      return all.filter((s) => s.supersededAt !== undefined).length;
    });
    expect(before).toBe(1);
    const report = await sweep(t);
    expect(report.stagesReconciled).toBe(1);
    expect(report.reconciled[0]).toMatchObject({ stageId: "old-1", reason: "superseded" });
    const c = await counts(t);
    expect(c.stages).toBe(1);
    expect(c.chunks).toBe(1);
    before = await t.run(async ({ db }) => {
      const all = await db.query("discoveryStages").collect();
      return all.filter((s) => s.supersededAt !== undefined).length;
    });
    expect(before).toBe(0);
  });

  it("E: an ABANDONED stage (open past the retention boundary) is pruned; a FRESH open stage is not", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "fresh-walk", catalogPath: "/crypto", rows: 2 });
    await seedStage(t, {
      stageId: "dead-walk",
      catalogPath: "/stocks",
      rows: 2,
      createdAtAgeMs: ABANDONED_STAGE_RETENTION_MS + 60_000,
    });
    const report = await sweep(t);
    expect(report.stagesReconciled).toBe(1);
    expect(report.reconciled[0]).toMatchObject({ stageId: "dead-walk", reason: "abandoned" });
    const c = await counts(t);
    expect(c.stages).toBe(1);
    expect(c.chunks).toBe(1);
  });
});

describe("320 — orphan chunks and idempotence (§D, §F)", () => {
  it("D: chunks whose stage document is gone are deleted (append always follows its own openStage, so no-doc means orphan)", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "orphan-src", catalogPath: "/fx", rows: 4 });
    await t.run(async ({ db }) => {
      const stage = await db
        .query("discoveryStages")
        .filter((q) => q.eq(q.field("stageId"), "orphan-src"))
        .first();
      await db.delete(stage!._id);
    });
    const report = await sweep(t);
    expect(report.orphanChunksDeleted).toBe(1);
    expect((await counts(t)).chunks).toBe(0);
  });

  it("F: repeated sweeps over clean state are idempotent (zeroed report)", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "keep-me", catalogPath: "/fx", close: true, rows: 2 });
    const r1 = await sweep(t);
    const r2 = await sweep(t);
    expect(r1.legacyRowsDeleted).toBe(0);
    expect(r1.stagesReconciled).toBe(0);
    expect(r1.orphanChunksDeleted).toBe(0);
    expect(r2).toEqual(r1);
    expect(r2.moreWorkRemaining).toBe(false);
    const c = await counts(t);
    expect(c.stages).toBe(1);
    expect(c.chunks).toBe(1);
  });
});

describe("320 — scope protection and live-path integrity (§H, §L, §M)", () => {
  it("H: the sweep's writes touch ONLY the three staging tables — user/business rows survive untouched", async () => {
    const t = convexTest(schema, modules);
    let userId: unknown = null;
    await t.run(async ({ db }) => {
      userId = await db.insert("users", {
        email: "phase320@example.com",
      } as never);
    });
    await insertLegacyRows(t, "stage-legacy", 0, 5);
    await sweep(t);
    await t.run(async ({ db }) => {
      const user = await db.get(userId as never);
      expect(user).not.toBeNull();
      expect((await db.query("analyses").collect()).length).toBe(0);
      expect((await db.query("journal").collect()).length).toBe(0);
      expect((await db.query("discoveryStageRows").collect()).length).toBe(0);
    });
  });

  it("L/M: no stale-as-live, no completeness regression — the shipped lifecycle round trip works and a pruned stage reads back EMPTY", async () => {
    const t = convexTest(schema, modules);
    await seedStage(t, { stageId: "live-1", catalogPath: "/stocks", close: true, rows: 6 });
    await supersede(t, "/stocks", "live-1");
    // The ACTIVE stage still serves its rows through the shipped reader.
    const readViaTest = t.query as unknown as (
      ref: unknown,
      args: unknown,
    ) => Promise<{ hasMore: boolean; rows: unknown[] }>;
    const page = await readViaTest(
      (await import("./discoveryStage")).readStageRows,
      { stageId: "live-1", afterSeq: -1, limit: 10 },
    );
    expect(page.hasMore).toBe(false);
    expect(page.rows).toHaveLength(6);
    // A pruned stage reads back EMPTY — pruned state is never served as a
    // catalog, and certainly never as live.
    await seedStage(t, { stageId: "gone-1", catalogPath: "/fx", close: true, rows: 2 });
    await supersede(t, "/fx", "live-1");
    const gone = await readViaTest(
      (await import("./discoveryStage")).readStageRows,
      { stageId: "gone-1", afterSeq: -1, limit: 10 },
    );
    expect(gone.rows).toHaveLength(0);
    expect(gone.hasMore).toBe(false);
  });
});
