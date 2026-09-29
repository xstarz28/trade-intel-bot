/**
 * Phase 289G — WHAT THE SMOKE SAYS ABOUT A LARGE CATALOG'S COMPLETENESS.
 *
 * The 289F proof could read one bounded page back, which proves READABILITY.
 * The deployed 289G classification question is different: after the batching and
 * timeout work, a run has to state, from its own annotations alone,
 *
 *   catalog completeness  — what the provider walk did (COMPLETE/PARTIAL/FAILED)
 *   provider count        — the number the PROVIDER published for that catalog
 *   staged rows           — how many rows are really available through the stage
 *   transport state       — whether every discovered row is retrievable
 *
 * — and it must do so WITHOUT transferring the universe it is describing, and
 * without letting a stock-catalog problem be read as a commodity/forex problem.
 * These tests drive the smoke's own exported surfaces (the same functions the run
 * calls) and pin exactly that.
 */
import { describe, expect, it } from "vitest";

import { effectiveCommodityProfile } from "@/lib/fundamental/commodity";
import {
  commodityMarketOf,
  discoveryDiagnosis,
  discoveryDigest,
  eiaEvidenceRecord,
  probeDiscoveryStages,
  STAGE_READ_PROOF_ROWS,
  stageReadDigest,
} from "../../../scripts/development-runtime-smoke.mjs";

const STOCK_TOTAL = 124_000;

const stagedCatalog = (overrides: Record<string, unknown> = {}) => {
  const { transport, ...rest } = overrides;
  return {
    path: "/stocks",
    assetClass: "equity",
    completeness: "COMPLETE",
    pagesFetched: 1,
    totalDiscovered: STOCK_TOTAL,
    providerCount: STOCK_TOTAL,
    failedPage: null,
    ...rest,
    transport: {
      mode: "staged",
      state: "complete",
      inlineRows: 0,
      stagedRows: STOCK_TOTAL,
      totalKept: STOCK_TOTAL,
      chunkRows: 2048,
      writeChunkRows: 256,
      stageId: "/stocks|1700000000000|abc12345",
      detail: null,
      ...(transport as Record<string, unknown> | undefined),
    },
  };
};

const ROUNDED_TOTAL = 156_730;

const discovery = (
  catalogs: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) => ({
  success: true,
  completeness: "COMPLETE",
  pagesFetched: 5,
  totalDiscovered: ROUNDED_TOTAL,
  instruments: [{ providerInstrumentId: "WTI/USD", assetClass: "commodity" }],
  catalogs,
  warnings: [],
  error: null,
  ...overrides,
});

const page = (overrides: Record<string, unknown> = {}) => ({
  ok: true as const,
  httpStatus: 200,
  appError: null,
  value: {
    rows: [
      { provider: "twelve-data", providerInstrumentId: "STK0", assetClass: "equity" },
      { provider: "twelve-data", providerInstrumentId: "STK1", assetClass: "equity" },
    ],
    hasMore: true,
    nextAfterSeq: 1,
    stagedRows: STOCK_TOTAL,
    totalDiscovered: STOCK_TOTAL,
    providerCount: STOCK_TOTAL,
    completeness: "COMPLETE",
    transportState: "complete",
    catalogPath: "/stocks",
    provider: "twelve-data",
    ...overrides,
  },
});

function transportReturning(value: unknown, calls: unknown[] = []) {
  return {
    calls,
    transport: {
      state: { calls: 0, lastError: null, blocked: false },
      action: async (path: string, args: unknown) => {
        calls.push({ path, args });
        return value;
      },
      query: async (path: string, args: unknown) => {
        calls.push({ path, args });
        return value;
      },
    },
  };
}

describe("289G — the digest states catalog completeness, provider count and staged rows", () => {
  it("names all three numbers for a staged catalog, in one bounded line", () => {
    const text = discoveryDigest(discovery([stagedCatalog()]) as never) as string;
    // `/stocks/COMPLETE/1p/124000kept/of:124000/staged:124000:complete/chunk=2048/writeChunk=256`
    expect(text).toContain("/stocks/COMPLETE/1p/124000kept");
    expect(text).toContain("of:124000");
    expect(text).toContain("staged:124000:complete");
    expect(text).toContain("chunk=2048");
    expect(text).toContain("writeChunk=256");
  });

  it("keeps a provider-complete catalog with a partial transport visibly partial", () => {
    const text = discoveryDigest(
      discovery([stagedCatalog({ transport: { state: "partial", stagedRows: 33_289 } })]) as never,
    ) as string;
    // The provider walk finished; the transport did not deliver all of it.
    expect(text).toContain("/stocks/COMPLETE/1p/124000kept");
    expect(text).toContain("staged:33289:partial");
    expect(text).not.toContain("staged:124000:complete");
  });

  it("reports the provider's count even when it differs from what the walk kept", () => {
    const text = discoveryDigest(
      discovery([stagedCatalog({ totalDiscovered: 120_000, providerCount: STOCK_TOTAL })]) as never,
    ) as string;
    expect(text).toContain("120000kept");
    expect(text).toContain("of:124000");
  });

  it("cannot let a stock-catalog failure read as a commodity or forex failure", () => {
    const text = discoveryDigest(
      discovery([
        {
          path: "/commodities",
          assetClass: "commodity",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: 31,
          providerCount: 32,
          failedPage: null,
          transport: { mode: "inline", state: "complete", inlineRows: 31, stagedRows: 0, totalKept: 31 },
        },
        {
          path: "/forex_pairs",
          assetClass: "forex",
          completeness: "COMPLETE",
          pagesFetched: 1,
          totalDiscovered: 1399,
          providerCount: 1399,
          failedPage: null,
          transport: { mode: "inline", state: "complete", inlineRows: 1399, stagedRows: 0, totalKept: 1399 },
        },
        staggeredFailedStock(),
      ]) as never,
    ) as string;
    expect(text).toContain("/commodities/COMPLETE/1p/31kept");
    expect(text).toContain("/forex_pairs/COMPLETE/1p/1399kept");
    expect(text).toContain("/stocks/FAILED");
    // The run's overall verdict is not dragged down to FAILED by one catalog,
    // and the identity sample still names the commodity the run discovered.
    expect(text).toContain("success=true");
    expect(text).toContain("identities=WTI/USD");
    // The diagnosis NAMES the failed catalog (context for a reader) while the
    // commodity catalog's own line stays COMPLETE — a stock problem cannot be
    // read as a commodity problem.
    const diagnosis = discoveryDiagnosis(
      discovery([staggeredFailedStock()]) as never,
      "commodity",
    ) as string;
    expect(diagnosis).toContain("/stocks FAILED");
    expect(diagnosis).toContain("catalog completeness COMPLETE");
  });
});

function staggeredFailedStock() {
  return {
    path: "/stocks",
    assetClass: "equity",
    completeness: "FAILED",
    pagesFetched: 0,
    totalDiscovered: 0,
    providerCount: null,
    failedPage: 1,
    transport: { mode: "inline", state: "failed", inlineRows: 0, stagedRows: 0, totalKept: 0 },
  };
}

describe("289G — the stage-read proof states the stage's own completeness", () => {
  it("reads ONE bounded page and reports the catalog's total independently", async () => {
    const { transport, calls } = transportReturning(page());
    const reads = await probeDiscoveryStages(
      discovery([stagedCatalog()]) as never,
      transport as never,
      null,
    );

    expect(reads).toHaveLength(1);
    // Bounded: the proof transferred TWO rows, never the universe.
    expect(reads[0].rows).toBe(2);
    expect(reads[0].stagedRows).toBe(STOCK_TOTAL);
    expect(reads[0].ok).toBe(true);
    // The stage's own record travels with the read.
    expect(reads[0].catalogCompleteness).toBe("COMPLETE");
    expect(reads[0].catalogRows).toBe(STOCK_TOTAL);
    expect(reads[0].providerCount).toBe(STOCK_TOTAL);
    // Every call asked for at most the proof bound.
    for (const call of calls as { args: { limit?: number } }[]) {
      expect(call.args.limit).toBeLessThanOrEqual(STAGE_READ_PROOF_ROWS);
    }

    const text = stageReadDigest(reads) as string;
    expect(text).toContain("/stocks:ok:2of124000");
    expect(text).toContain("state=complete");
    expect(text).toContain("catalog=COMPLETE");
    expect(text).toContain("total=124000");
    expect(text).toContain("of:124000");
  });

  it("states a partial transport as partial rather than dressing it as complete", async () => {
    const { transport } = transportReturning(
      page({ stagedRows: 33_289, transportState: "partial", completeness: "COMPLETE" }),
    );
    const reads = await probeDiscoveryStages(
      discovery([stagedCatalog()]) as never,
      transport as never,
      null,
    );
    expect(reads[0].ok).toBe(false);
    expect(String(reads[0].reason)).toContain("transport state is partial");
    // The catalog's completeness is still reported as the provider left it.
    expect(reads[0].catalogCompleteness).toBe("COMPLETE");
  });

  it("still refuses to assume readability from the catalog's completeness", async () => {
    const { transport } = transportReturning({ ok: false, httpStatus: 500, appError: "stage read failed" });
    const reads = await probeDiscoveryStages(
      discovery([stagedCatalog()]) as never,
      transport as never,
      null,
    );
    expect(reads[0].ok).toBe(false);
    expect(reads[0].rows).toBe(0);
    expect(String(reads[0].reason)).toContain("stage read failed");
    expect(reads[0].catalogCompleteness).toBeNull();
  });
});

describe("289G — the product facts the batching work may not disturb", () => {
  it("keeps WTI/USD in the energy group the runtime's own registry resolves", () => {
    expect(effectiveCommodityProfile("WTI/USD").group).toBe("energy");
  });

  it("keeps the EIA metric agreeing with the leg that produced it", () => {
    const evidence = {
      fundamental: {
        commodityProfile: { group: "energy" },
        commodityMetrics: { inventoryLatest: 426_398 },
        evidenceItemCount: 24,
        eiaEvidenceItemCount: 6,
        eiaEvidenceMetrics: ["inventoryLatest", "inventoryChange"],
        evidenceItems: [
          { metric: "inventoryLatest", provider: "U.S. Energy Information Administration" },
        ],
        dimensions: [{ name: "inventories", status: "positive", role: "primary" }],
      },
      diagnostics: [
        { provider: "eia", dataset: "inventories", acquired: true, attached: true, usedByEngine: true },
      ],
    };
    const market = commodityMarketOf(evidence);
    expect(market.group).toBe("energy");
    expect(market.inventoryLatest).toBe(426_398);
    expect(market.eiaEvidenceItems).toBe(6);
    expect(market.eiaEvidenceState).toBe("consistent-consumed");
    expect(eiaEvidenceRecord(evidence).legState).toBe("consumed");
  });
});
