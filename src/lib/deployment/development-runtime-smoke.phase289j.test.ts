/**
 * Phase 289J — THE SMOKE MUST STATE THE FOUR NUMBERS THAT DECIDE COMPLETENESS.
 *
 * The deployed 289G run could say `providerCount`, `totalKept` and `stagedRows`
 * for a catalog. Those three are not enough to justify "COMPLETE":
 *
 *   providerCount  — what the PROVIDER published
 *   rawRowsSeen    — what this walk actually parsed (the reconciling number)
 *   totalKept      — unique usable instruments (normalization may keep fewer)
 *   stagedRows     — what is really readable through the stage
 *
 * These tests pin that the run's own one-line digests carry all four, that the
 * stage-read proof states the raw reconciliation too, and that a deployment
 * which does not report the new fields degrades to reporting NOTHING rather than
 * inventing a number.
 */
import { describe, expect, it } from "vitest";

import {
  discoveryDigest,
  probeDiscoveryStages,
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
    rawRowsSeen: STOCK_TOTAL,
    skippedIdentityRows: 0,
    duplicateRows: 0,
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

const discovery = (catalogs: Record<string, unknown>[]) => ({
  success: true,
  completeness: "COMPLETE",
  pagesFetched: 5,
  totalDiscovered: STOCK_TOTAL,
  instruments: [{ providerInstrumentId: "WTI/USD", assetClass: "commodity" }],
  catalogs,
  warnings: [],
  error: null,
});

describe("289J — the catalog line carries the raw reconciliation beside the counts", () => {
  it("names providerCount, rawRowsSeen, totalKept and stagedRows for one catalog", () => {
    const text = discoveryDigest(discovery([stagedCatalog()]) as never) as string;

    // The four numbers a reader must be able to tell apart, in one line.
    expect(text).toContain("of:124000");
    expect(text).toContain("raw:124000");
    expect(text).toContain("124000kept");
    expect(text).toContain("staged:124000:complete");
    expect(text).toContain("skipped:0");
    expect(text).toContain("dupes:0");
    expect(text).not.toContain("\n");
  });

  it("makes a provider-complete catalog with skipped rows visibly accounted for", () => {
    // The deployed `/commodities` shape: 32 provider rows, 31 usable instruments.
    const text = discoveryDigest(
      discovery([
        stagedCatalog({
          path: "/commodities",
          assetClass: "commodity",
          totalDiscovered: 31,
          providerCount: 32,
          rawRowsSeen: 32,
          skippedIdentityRows: 1,
          duplicateRows: 0,
          transport: { stagedRows: 31, totalKept: 31 },
        }),
      ]) as never,
    ) as string;

    expect(text).toContain("/commodities/COMPLETE");
    expect(text).toContain("31kept");
    expect(text).toContain("of:32");
    expect(text).toContain("raw:32");
    expect(text).toContain("skipped:1");
    expect(text).toContain("dupes:0");
    expect(text).toContain("staged:31:complete");
  });

  it("shows a short read as raw < provider count instead of claiming completeness", () => {
    const text = discoveryDigest(
      discovery([
        stagedCatalog({
          completeness: "PARTIAL",
          totalDiscovered: 33_289,
          rawRowsSeen: 33_289,
          providerCount: 143_300,
        }),
      ]) as never,
    ) as string;

    expect(text).toContain("/stocks/PARTIAL");
    expect(text).toContain("raw:33289");
    expect(text).toContain("of:143300");
  });

  it("reports nothing rather than a fabricated number when the new fields are absent", () => {
    const { rawRowsSeen, skippedIdentityRows, duplicateRows, ...legacy } = stagedCatalog();
    const text = discoveryDigest(discovery([legacy]) as never) as string;

    expect(text).toContain("of:124000");
    expect(text).toContain("staged:124000:complete");
    // A deployment that does not report the raw accounting gets no invented one.
    expect(text).not.toContain("raw:");
    expect(text).not.toContain("skipped:");
    expect(text).not.toContain("dupes:");
  });
});

describe("289J — the bounded read proof states the stage's own raw reconciliation", () => {
  const stageValue = (overrides: Record<string, unknown> = {}) => ({
    rows: [
      { provider: "twelve-data", providerInstrumentId: "STK0", assetClass: "equity" },
      { provider: "twelve-data", providerInstrumentId: "STK1", assetClass: "equity" },
    ],
    hasMore: true,
    nextAfterSeq: 1,
    stagedRows: STOCK_TOTAL,
    totalDiscovered: STOCK_TOTAL,
    providerCount: STOCK_TOTAL,
    rawRowsSeen: STOCK_TOTAL,
    skippedIdentityRows: 0,
    duplicateRows: 0,
    completeness: "COMPLETE",
    transportState: "complete",
    catalogPath: "/stocks",
    provider: "twelve-data",
    ...overrides,
  });

  const transportReturning = (value: unknown) => ({
    calls: [] as unknown[],
    state: { calls: 0, lastError: null, blocked: false },
    action: async (_path: string, args: unknown) => {
      return { ok: true, httpStatus: 200, appError: null, value } as never;
    },
    query: async () => ({ ok: true, httpStatus: 200, appError: null, value }) as never,
  });

  it("carries raw/provider/kept/staged and the catalog's completeness in one bounded line", async () => {
    const catalogs = [stagedCatalog()];
    const reads = await probeDiscoveryStages(
      { catalogs } as never,
      transportReturning(stageValue()) as never,
      "token",
    );
    const line = stageReadDigest(reads) as string;

    expect(reads).toHaveLength(1);
    expect(line).toContain("/stocks:ok:");
    expect(line).toContain("state=complete");
    expect(line).toContain("catalog=COMPLETE");
    expect(line).toContain("total=124000");
    expect(line).toContain("of:124000");
    expect(line).toContain("raw:124000");
    expect(line).toContain("skipped:0");
    expect(line).toContain("dupes:0");
    // The proof stays bounded whatever the catalog's size is.
    expect(line.length).toBeLessThanOrEqual(300);
  });

  it("reports the raw accounting of a stage whose walk ended early", async () => {
    const catalogs = [
      stagedCatalog({
        completeness: "PARTIAL",
        totalDiscovered: 33_289,
        transport: { stagedRows: 33_289, totalKept: 33_289, state: "partial" },
      }),
    ];
    const reads = await probeDiscoveryStages(
      { catalogs } as never,
      transportReturning(
        stageValue({
          stagedRows: 33_289,
          totalDiscovered: 33_289,
          providerCount: 143_300,
          rawRowsSeen: 33_289,
          completeness: "PARTIAL",
        }),
      ) as never,
      "token",
    );
    const line = stageReadDigest(reads) as string;

    expect(line).toContain("catalog=PARTIAL");
    expect(line).toContain("total=33289");
    expect(line).toContain("of:143300");
    expect(line).toContain("raw:33289");
  });
});
