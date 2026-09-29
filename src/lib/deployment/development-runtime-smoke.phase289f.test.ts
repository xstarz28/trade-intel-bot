/**
 * Phase 289F — the smoke's RETURN-BOUNDARY and EIA-TELEMETRY surfaces.
 *
 * THE TWO DEPLOYED CONTRADICTIONS THIS PINS
 * -----------------------------------------
 *  1. `marketData.js:discoverTwelveDataCatalog return value invalid: Array
 *     length is too long (143300 > maximum length 8192)`: the smoke must be able
 *     to state that a catalog is COMPLETE while its 143300 rows live server-side
 *     — and prove they are readable — WITHOUT transferring the universe, and
 *     without a single stock row ever being required to reach a commodity or a
 *     forex candidate.
 *  2. `eiaLeg=consumed` next to `eiaEvidence=0` and a real `inventoryLatest`: the
 *     evidence metric must be derived from the assessment's CANONICAL evidence
 *     items, must agree semantically with the EIA leg's own state, and must never
 *     be satisfied by a look-alike provider string, a provider list, or a
 *     successful HTTP exchange.
 */
import { describe, expect, it } from "vitest";

import { effectiveCommodityProfile } from "@/lib/fundamental/commodity";
import {
  commodityMarketOf,
  discoveryDigest,
  eiaEvidenceRecord,
  eiaLegRecord,
  energyGateVerdict,
  EIA_PROVIDER_SOURCE_NAME,
  isEiaProviderIdentity,
  probeDiscoveryStages,
  readResultEvidence,
  selectCandidates,
  STAGE_READ_PROOF_ROWS,
  stageReadDigest,
} from "../../../scripts/development-runtime-smoke.mjs";

type TransportResult = {
  ok: boolean;
  httpStatus: number;
  appError?: string | null;
  transportError?: string;
  value?: unknown;
};

function recordingTransport(handler: (args: Record<string, unknown>) => TransportResult) {
  const calls: { path: string; args: Record<string, unknown> }[] = [];
  const transport = {
    state: { calls: 0, lastError: null as string | null, blocked: false },
    action: async (path: string, args: unknown = {}) => {
      calls.push({ path, args: args as Record<string, unknown> });
      transport.state.calls += 1;
      return handler(args as Record<string, unknown>);
    },
    query: async (path: string, args: unknown = {}) => {
      calls.push({ path, args: args as Record<string, unknown> });
      return handler(args as Record<string, unknown>);
    },
  };
  return { transport, calls };
}

const stagedPage = (overrides: Record<string, unknown> = {}): TransportResult => ({
  ok: true,
  httpStatus: 200,
  value: {
    rows: [
      { provider: "twelve-data", providerInstrumentId: "STK0", assetClass: "equity", subType: "equity_common" },
      { provider: "twelve-data", providerInstrumentId: "STK1", assetClass: "equity", subType: "equity_common" },
    ],
    hasMore: true,
    nextAfterSeq: 1,
    stagedRows: 143_300,
    totalDiscovered: 143_300,
    completeness: "COMPLETE",
    transportState: "complete",
    catalogPath: "/stocks",
    provider: "twelve-data",
    ...overrides,
  },
});

const stagedDiscovery = () => ({
  success: true,
  completeness: "COMPLETE",
  pagesFetched: 5,
  totalDiscovered: 143_300 + 34 + 1399,
  instruments: [
    { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot" },
    { providerInstrumentId: "GAU/IDR", assetClass: "commodity", subType: "commodity_spot" },
    { providerInstrumentId: "EUR/USD", assetClass: "forex", subType: "forex_spot" },
  ],
  catalogs: [
    {
      path: "/forex_pairs",
      assetClass: "forex",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: 1399,
      failedPage: null,
      transport: { mode: "inline", state: "complete", inlineRows: 1399, stagedRows: 0, totalKept: 1399, chunkRows: null, stageId: null, detail: null },
    },
    {
      path: "/stocks",
      assetClass: "equity",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: 143_300,
      failedPage: null,
      transport: { mode: "staged", state: "complete", inlineRows: 0, stagedRows: 143_300, totalKept: 143_300, chunkRows: 2048, stageId: "/stocks|1700000000000|abc12345", detail: null },
    },
    {
      path: "/commodities",
      assetClass: "commodity",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: 34,
      failedPage: null,
      transport: { mode: "inline", state: "complete", inlineRows: 34, stagedRows: 0, totalKept: 34, chunkRows: null, stageId: null, detail: null },
    },
  ],
  warnings: [],
  error: null,
});

describe("289F — the run states a staged catalog without transferring it", () => {
  it("names the transport of a staged catalog while the universe stays server-side", () => {
    const digest = discoveryDigest(stagedDiscovery()) as string;

    expect(digest).toContain("success=true");
    expect(digest).toContain("total=144733");
    // The stock catalog's own completeness and its REAL kept count are stated...
    expect(digest).toContain("/stocks/COMPLETE/1p/143300kept");
    // ...next to the transport that carries it, and none of its rows travel.
    expect(digest).toContain("staged:143300:complete");
    expect(digest).not.toContain("STK0");
    expect(digest).not.toContain("STK1");
  });

  it("reads ONE bounded page of every staged catalog through the deployment's own action", async () => {
    const { transport, calls } = recordingTransport(() => stagedPage());
    const reads = (await probeDiscoveryStages(stagedDiscovery(), transport, "token", 2)) as {
      path: string;
      ok: boolean;
      rows: number;
      stagedRows: number;
      state: string;
      identitySample: string[];
    }[];

    expect(calls.map((c) => c.path)).toEqual([
      "marketData:readTwelveDataCatalogStage",
      "marketData:readTwelveDataCatalogStage",
    ]);
    expect(calls[0].args).toMatchObject({ afterSeq: -1, limit: 2 });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ path: "/stocks", ok: true, rows: 2, stagedRows: 143_300, state: "complete" });
    expect(reads[0].identitySample).toEqual(["STK0", "STK1"]);
  });

  it("never asks a staged catalog for the universe, and never assumes readability", async () => {
    const { transport, calls } = recordingTransport(() => stagedPage());
    await probeDiscoveryStages(stagedDiscovery(), transport, null, STAGE_READ_PROOF_ROWS);
    // The proof is a bounded read: the request carries the harness's small bound
    // (never the staged row count) and no inline array is consulted.
    expect(calls.every((c) => Number(c.args.limit) <= 8)).toBe(true);
    expect(calls.every((c) => c.args.limit !== 143_300)).toBe(true);
    expect(calls.every((c) => c.args.stageId === "/stocks|1700000000000|abc12345")).toBe(true);
    // No staged catalog, no probe: nothing is fabricated for the report.
    const inlineOnly = {
      catalogs: stagedDiscovery().catalogs.filter((c) => c.transport?.mode === "inline"),
    } as never;
    expect(await probeDiscoveryStages(inlineOnly, transport, null)).toEqual([]);
  });

  it("reports a failed or empty stage read as failed, with its reason", async () => {
    const failing = recordingTransport(() => ({
      ok: false,
      httpStatus: 200,
      appError: "Function marketData.js:readTwelveDataCatalogStage threw: stage missing",
    }));
    const failedReads = (await probeDiscoveryStages(stagedDiscovery(), failing.transport, null)) as {
      ok: boolean;
      rows: number;
      reason: string;
    }[];
    expect(failedReads[0].ok).toBe(false);
    expect(failedReads[0].rows).toBe(0);
    expect(failedReads[0].reason).toContain("stage missing");

    const empty = recordingTransport(() => stagedPage({ rows: [] }));
    const emptyReads = (await probeDiscoveryStages(stagedDiscovery(), empty.transport, null)) as {
      ok: boolean;
      reason: string;
    }[];
    expect(emptyReads[0].ok).toBe(false);
    expect(emptyReads[0].reason).toMatch(/no rows/i);

    // A stage whose own transport state is not complete is not claimed readable.
    const partial = recordingTransport(() => stagedPage({ transportState: "partial" }));
    const partialReads = (await probeDiscoveryStages(stagedDiscovery(), partial.transport, null)) as {
      ok: boolean;
      reason: string;
    }[];
    expect(partialReads[0].ok).toBe(false);
    expect(partialReads[0].reason).toContain("partial");
  });

  it("states the stage reads in one bounded, credential-free line", async () => {
    const { transport } = recordingTransport(() => stagedPage());
    const reads = await probeDiscoveryStages(stagedDiscovery(), transport, null, 2);
    const digest = stageReadDigest(reads) as string;

    expect(digest).toContain("/stocks");
    expect(digest).toContain("ok");
    expect(digest).toContain("2of143300");
    expect(digest).toContain("state=complete");
    expect(digest).toContain("STK0");
    expect(digest).not.toContain("apikey");
    expect(stageReadDigest([])).toBeNull();
    expect(stageReadDigest(null)).toBeNull();

    // The whole digest stays one bounded line even with the stage read in it.
    const discovery = stagedDiscovery();
    (discovery as { stageReads?: unknown }).stageReads = reads;
    const full = discoveryDigest(discovery) as string;
    expect(full).toContain("stageRead=");
    expect(full.length).toBeLessThan(900);
  });

  it("finds commodity and forex candidates without the stock universe ever arriving", () => {
    const discovery = stagedDiscovery();
    const commoditySpec = {
      domain: "commodity",
      label: "Commodity",
      discovery: "twelve-data" as const,
      assetClass: "commodity",
    };
    const picked = selectCandidates(commoditySpec, discovery, 12) as { providerInstrumentId: string }[];

    expect(picked.map((c) => c.providerInstrumentId)).toEqual(["WTI/USD", "GAU/IDR"]);
    // Nothing the staged catalog holds is needed to select them.
    expect(discovery.instruments.some((i) => i.assetClass === "equity")).toBe(false);
  });
});

// ── the EIA telemetry surfaces ───────────────────────────────────────────────

type LegFixture = {
  provider: string;
  acquired?: boolean;
  attached?: boolean;
  usedByEngine?: boolean;
  reason?: string;
  dataset?: string;
  mode?: string;
  observedAt?: number;
};

function runtimeResult({
  leg = null,
  itemProviders = ["U.S. Energy Information Administration"],
  metrics = ["inventory_wpsr"],
  inventoryLatest = 426_398,
  group = "energy",
}: {
  leg?: LegFixture | null;
  itemProviders?: string[];
  metrics?: string[];
  inventoryLatest?: number | null;
  group?: string | null;
} = {}) {
  const evidence = itemProviders.flatMap((provider) =>
    metrics.map((metric) => ({
      provider,
      metric,
      source: "EIA Weekly Petroleum Status Report",
      unit: "MBBL",
      value: "426398",
      observedAt: 1_790_652_783_533,
      period: "2026-09-18",
      derived: false,
      evidenceClass: "provider-reported",
    })),
  );
  return {
    provider: "twelve-data",
    providerInstrumentId: "WTI/USD",
    priceSnapshot: { price: 62.5, timestamp: 1_790_652_780_000, source: "twelve-data" },
    technicalData: { dataPoints: 200 },
    unifiedIntelligence: {
      available: true,
      technical: { available: true, bias: "neutral", confidence: "medium" },
      confluence: { agreement: "mixed", reason: "test fixture" },
      confidence: "medium",
      actionable: false,
    },
    fundamentalAssessment: {
      available: true,
      domain: "commodity",
      provider: "U.S. Energy Information Administration",
      instrumentId: "WTI/USD",
      observedAt: 1_790_652_783_533,
      state: "mixed",
      confidence: "medium",
      directionalBias: "none",
      periodsCount: 3,
      commodityProfile: group === null ? null : { group, classificationSource: "commodity-group-registry" },
      commodityMetrics: inventoryLatest === null ? {} : { inventoryLatest },
      dimensions: [{ name: "inventories", status: "neutral", role: "primary" }],
      evidence,
      limitations: [],
    },
    providerDiagnostics: leg ? [leg] : [],
  };
}

const marketOf = (options: Parameters<typeof runtimeResult>[0] = {}) =>
  commodityMarketOf(readResultEvidence(runtimeResult(options)));

describe("289F — the EIA metric agrees with the leg that produced it", () => {
  it("counts the canonical EIA evidence when the leg was consumed", () => {
    const market = marketOf({
      leg: { provider: "eia", acquired: true, attached: true, usedByEngine: true, dataset: "eia" },
    }) as Record<string, unknown>;

    expect(market.eiaLegState).toBe("consumed");
    expect(market.eiaEvidenceItems).toBe(1);
    expect(market.eiaEvidenceState).toBe("consistent-consumed");
    expect(market.eiaEvidenceDetail).toBeNull();
    expect(market.eiaEvidenceMetrics).toEqual(["inventory_wpsr"]);
    // The reading itself is untouched: the metric is the evidence, not a count.
    expect(market.group).toBe("energy");
    expect(market.inventoryLatest).toBe(426_398);
  });

  it.each([
    ["attached-not-used", { provider: "eia", acquired: true, attached: true, usedByEngine: false }],
    ["acquired-not-attached", { provider: "eia", acquired: true, attached: false, usedByEngine: false }],
    ["no-evidence", { provider: "eia", acquired: false, attached: false, usedByEngine: false, reason: "empty dataset" }],
  ])("stays at zero evidence for a leg that was not consumed (%s)", (expected, leg) => {
    const record = eiaLegRecord(readResultEvidence(runtimeResult({ leg, itemProviders: [] })));
    expect(record.state).toBe(expected);

    const market = marketOf({ leg, itemProviders: [] }) as Record<string, unknown>;
    expect(market.eiaEvidenceItems).toBe(0);
    expect(market.eiaEvidenceState).toBe("consistent-not-consumed");
  });

  it("reports a leg that was never scheduled as not-scheduled, with zero evidence", () => {
    const record = eiaLegRecord(readResultEvidence(runtimeResult({ leg: null, itemProviders: [] })));
    expect(record.state).toBe("not-scheduled");

    const market = marketOf({ leg: null, itemProviders: [] }) as Record<string, unknown>;
    expect(market.eiaEvidenceItems).toBe(0);
    expect(market.eiaEvidenceState).toBe("consistent-not-consumed");
  });

  it("fails loudly when the leg says consumed and the canonical evidence says otherwise", () => {
    // The exact deployed contradiction: consumed leg + real inventory reading,
    // but not one EIA evidence item to point at.
    const market = marketOf({
      leg: { provider: "eia", acquired: true, attached: true, usedByEngine: true, dataset: "eia" },
      itemProviders: [],
    }) as Record<string, unknown>;

    expect(market.eiaLegState).toBe("consumed");
    expect(market.eiaEvidenceItems).toBe(0);
    expect(market.eiaEvidenceState).toBe("inconsistent");
    expect(String(market.eiaEvidenceDetail)).toContain("consumed");

    const verdict = energyGateVerdict([
      { instrument: "WTI/USD", ...market, eiaEvidenceDetail: market.eiaEvidenceDetail },
      { instrument: "GAU/IDR", group: "unclassified", inventories: "unavailable", inventoryLatest: null, eiaEvidenceItems: 0, eiaEvidenceState: "consistent-not-consumed", eiaLegState: "not-scheduled" },
    ]) as { verdict: string; summary: string };
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.summary).toContain("disagree");
  });

  it("counts nothing from a provider that only resembles the EIA identity", () => {
    const lookalikes = [
      "Energy Information Administration",
      "US Energy Information Administration",
      "EIA mirror",
      "U.S. Energy Information Administration (unofficial mirror)",
      "alpha-vantage",
    ];
    for (const provider of lookalikes) {
      expect(isEiaProviderIdentity(provider)).toBe(false);
      const market = marketOf({
        leg: { provider: "eia", acquired: false, attached: false, usedByEngine: false },
        itemProviders: [provider],
      }) as Record<string, unknown>;
      // A look-alike item can neither raise the metric...
      expect(market.eiaEvidenceItems).toBe(0);
      // ...nor be mistaken for a contradiction, while a real EIA item is counted.
    }
    expect(isEiaProviderIdentity("eia")).toBe(true);
    expect(isEiaProviderIdentity("EIA")).toBe(true);
    expect(isEiaProviderIdentity(EIA_PROVIDER_SOURCE_NAME)).toBe(true);
    // A suffix bolted onto the canonical name is a DIFFERENT identity.
    expect(isEiaProviderIdentity(`${EIA_PROVIDER_SOURCE_NAME} (EIA WPSR)`)).toBe(false);
    // An item with no provider at all is not evidence of anything.
    expect(isEiaProviderIdentity(null)).toBe(false);
    expect(isEiaProviderIdentity("")).toBe(false);
  });

  it("cannot be raised by an evidence ITEM alone when the run was not consumed", () => {
    const market = marketOf({
      leg: { provider: "eia", acquired: false, attached: false, usedByEngine: false },
      itemProviders: [EIA_PROVIDER_SOURCE_NAME, "eia"],
    }) as Record<string, unknown>;

    expect(market.eiaEvidenceItems).toBe(2);
    expect(market.eiaLegState).toBe("no-evidence");
    expect(market.eiaEvidenceState).toBe("inconsistent");
    expect(String(market.eiaEvidenceDetail)).toContain("no-evidence");
  });

  it("derives the metric from canonical items, not from the bounded report sample", () => {
    // The report samples at most 24 items; the metric is counted over the whole
    // assessment, so an EIA item past the sample still raises it.
    const evidence = [
      ...Array.from({ length: 30 }, (_, i) => ({
        provider: "US Treasury XML feed",
        metric: `other_${i}`,
        source: "treasury",
      })),
      { provider: EIA_PROVIDER_SOURCE_NAME, metric: "inventory_wpsr", source: "EIA WPSR" },
    ];
    const result = runtimeResult({ leg: null, itemProviders: [] }) as {
      fundamentalAssessment: { evidence: unknown[] };
      providerDiagnostics: LegFixture[];
    };
    result.fundamentalAssessment.evidence = evidence;
    result.providerDiagnostics = [
      { provider: "eia", acquired: true, attached: true, usedByEngine: true, dataset: "eia" },
    ];

    const market = commodityMarketOf(readResultEvidence(result)) as Record<string, unknown>;
    expect(market.eiaEvidenceItems).toBe(1);
    expect(market.eiaEvidenceState).toBe("consistent-consumed");
  });

  it("keeps WTI/USD in the energy group the runtime's own registry resolves", () => {
    // Phase 289F touches none of this: the classification is the canonical
    // registry's, and the smoke only reports what the runtime classified.
    const profile = effectiveCommodityProfile("WTI/USD");
    expect(profile.group).toBe("energy");
    expect(profile.classificationSource).toContain("canonical registry");

    const market = marketOf({
      leg: { provider: "eia", acquired: true, attached: true, usedByEngine: true },
      group: profile.group,
    }) as Record<string, unknown>;
    expect(market.group).toBe("energy");
    expect(market.eiaEvidenceState).toBe("consistent-consumed");
    expect(market.inventoryLatest).toBe(426_398);
  });

  it("records what eiaEvidenceRecord saw, and never infers success from a status", () => {
    const evidence = readResultEvidence(
      runtimeResult({
        leg: {
          provider: "eia",
          acquired: true,
          attached: true,
          usedByEngine: true,
          mode: "observed-now",
          observedAt: 1_790_652_784_840,
        },
      }),
    );
    const record = eiaEvidenceRecord(evidence) as {
      items: number;
      legState: string;
      state: string;
      metrics: string[];
      providers: string[];
    };
    expect(record).toMatchObject({ items: 1, legState: "consumed", state: "consistent-consumed" });
    expect(record.metrics).toContain("inventory_wpsr");
    expect(record.providers).toContain("U.S. Energy Information Administration");

    // A successful-looking acquisition that never attached and was never used is
    // NOT consumption — the metric stays at zero and the state says so.
    const notConsumed = eiaEvidenceRecord(
      readResultEvidence(
        runtimeResult({
          leg: { provider: "eia", acquired: true, attached: false, usedByEngine: false, mode: "observed-now" },
          itemProviders: [],
        }),
      ),
    ) as { items: number; legState: string; state: string };
    expect(notConsumed).toMatchObject({ items: 0, legState: "acquired-not-attached", state: "consistent-not-consumed" });
  });
});
