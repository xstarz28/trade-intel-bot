/**
 * Phase 172 — OKX discovery → live scanner end-to-end integration.
 *
 * This suite drives the REAL production functions in the same order the
 * Dashboard runtime calls them:
 *
 *   okx-discovery.discoverOkxInstruments(transport)   [raw OKX JSON]
 *     -> runtime.normalizeOkxDiscoveryAction()
 *     -> pipeline.runDiscoveryPipelineStep()          [rotation + lifecycle]
 *          -> registry.selectAcquirableInstruments()
 *          -> liveScanner.selectRotatingDiscoveryBatch()
 *          -> runtime.toAcquisitionResults()          [identity re-binding]
 *     -> liveScanner.scanInstruments()                [ranking output]
 *
 * Nothing here re-implements pipeline logic; the only injected seam is the
 * HTTP transport and the acquisition callback, which is exactly the seam the
 * Convex action occupies in production.
 *
 * Live provider calls are firewalled in this environment, so the transport is
 * a deterministic mock. That is a test of OUR wiring, not of OKX uptime, and
 * live provider verification remains externally blocked.
 */

import { describe, expect, it } from "vitest";
import { discoverOkxInstruments } from "@/lib/data/universal/okx-discovery";
import {
  normalizeOkxDiscoveryAction,
  toAcquisitionResults,
} from "./runtime";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import { scanInstruments, selectRotatingDiscoveryBatch } from "@/lib/liveScanner";
import type { DiscoveredInstrument } from "./types";
import type { ScanResult } from "@/lib/liveScanner";

/** Ranked instruments for a horizon, from the real ScanResult Map shape. */
function ranked(scan: ScanResult, horizon: string) {
  return scan.results.get(horizon as never)?.rankedInstruments ?? [];
}

// ───────────────────────────────────────────────────────────────
// Deterministic OKX transport
// ───────────────────────────────────────────────────────────────

/**
 * Two instruments that deliberately do NOT exist in DEFAULT_UNIVERSE or any
 * static list, plus one deliberately confusable pair.
 *
 * "NEWCOIN-USDT" and "NEWCOIN-USDT-SWAP" share a prefix: if any stage
 * canonicalises or prefix-matches, they will collapse into one another and
 * the identity assertions below will fail.
 */
const OKX_ROWS = [
  {
    instId: "NEWCOIN-USDT",
    instType: "SPOT",
    baseCcy: "NEWCOIN",
    quoteCcy: "USDT",
    state: "live",
    tickSz: "0.0001",
    lotSz: "0.01",
    minSz: "0.01",
  },
  {
    instId: "NEWCOIN-USDT-SWAP",
    instType: "SWAP",
    uly: "NEWCOIN-USDT",
    settleCcy: "USDT",
    ctValCcy: "NEWCOIN",
    state: "live",
    tickSz: "0.0001",
    lotSz: "1",
    minSz: "1",
  },
  {
    instId: "ZZZTOKEN-USDT",
    instType: "SPOT",
    baseCcy: "ZZZTOKEN",
    quoteCcy: "USDT",
    state: "live",
    tickSz: "0.001",
    lotSz: "0.1",
    minSz: "0.1",
  },
] as const;

function okxResponse(rows: readonly unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: "0", msg: "", data: rows }),
  } as unknown as Response;
}

/** Serves SPOT/SWAP/FUTURES exactly as the real endpoint does. */
function makeTransport(rows: readonly (typeof OKX_ROWS)[number][] = OKX_ROWS) {
  return async (url: string): Promise<Response> => {
    const type = new URL(url).searchParams.get("instType");
    return okxResponse(rows.filter((r) => r.instType === type));
  };
}

// ───────────────────────────────────────────────────────────────
// Acquisition doubles (stand in for the Convex action)
// ───────────────────────────────────────────────────────────────

const NOW = 1_735_000_000_000;

function candles(closes: readonly number[], lastTs: number) {
  return closes.map((close, i) => ({
    timestamp: lastTs - (closes.length - 1 - i) * 3_600_000,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000 + i,
  }));
}

/** A successful provider-native response for the given native id. */
function successResult(nativeId: string, price: number, observedAt: number) {
  return {
    instrument: nativeId,
    providerInstrumentId: nativeId,
    provider: "okx",
    assetClass: "crypto" as const,
    success: true,
    fetchedAt: observedAt,
    snapshot: {
      price,
      observedAt,
      freshness: "FRESH" as const,
    },
    candles: candles([price * 0.97, price * 0.98, price * 0.99, price], observedAt),
  };
}

/** Collect every native id the pipeline asked us to acquire. */
function recordingAcquire(
  respond: (batch: readonly DiscoveredInstrument[]) => unknown[],
  log?: string[],
) {
  return async (batch: readonly DiscoveredInstrument[]) => {
    log?.push(...batch.map((b) => b.providerInstrumentId));
    return toAcquisitionResults(batch, respond(batch) as never);
  };
}

// ───────────────────────────────────────────────────────────────
// Stage 1 — discovery preserves provider-native identity
// ───────────────────────────────────────────────────────────────

describe("stage 1: OKX discovery", () => {
  it("discovers instruments that appear in no static list", async () => {
    const raw = await discoverOkxInstruments(makeTransport(), NOW);
    expect(raw.success).toBe(true);

    const ids = raw.instruments.map((i) => i.instId);
    expect(ids).toContain("NEWCOIN-USDT");
    expect(ids).toContain("NEWCOIN-USDT-SWAP");
    expect(ids).toContain("ZZZTOKEN-USDT");
  });

  it("keeps the exact native instId, with no canonicalisation", async () => {
    const raw = await discoverOkxInstruments(makeTransport(), NOW);
    const normalized = normalizeOkxDiscoveryAction({
      success: raw.success,
      discoveredAt: raw.discoveredAt,
      warnings: raw.warnings,
      instruments: raw.instruments,
    });

    const ids = normalized.instruments.map((i) => i.providerInstrumentId);
    // Not "NEWCOIN/USDT", not "NEWCOINUSDT", not uppercased differently.
    expect(ids).toContain("NEWCOIN-USDT");
    expect(ids).toContain("NEWCOIN-USDT-SWAP");
    for (const id of ids) {
      expect(id).not.toContain("/");
    }
  });

  it("carries no price information out of discovery", async () => {
    // Discovery metadata must never be mistaken for live evidence.
    const raw = await discoverOkxInstruments(makeTransport(), NOW);
    for (const instrument of raw.instruments) {
      expect(instrument).not.toHaveProperty("price");
      expect(JSON.stringify(instrument)).not.toMatch(/"price"|"close"/);
    }
  });
});

// ───────────────────────────────────────────────────────────────
// Stage 2 — full pipeline to scanner
// ───────────────────────────────────────────────────────────────

/** Run discovery + one pipeline step exactly as Dashboard.runDiscoveryCycle does. */
async function runCycle(options: {
  state?: ReturnType<typeof createPipelineState>;
  respond: (batch: readonly DiscoveredInstrument[]) => unknown[];
  batchSize?: number;
  now?: number;
  log?: string[];
  rows?: readonly (typeof OKX_ROWS)[number][];
}) {
  const now = options.now ?? NOW;
  const raw = await discoverOkxInstruments(makeTransport(options.rows), now);
  const normalized = normalizeOkxDiscoveryAction({
    success: raw.success,
    discoveredAt: raw.discoveredAt,
    warnings: raw.warnings,
    instruments: raw.instruments,
  });

  return runDiscoveryPipelineStep({
    state: options.state ?? createPipelineState(),
    discovered: normalized.instruments,
    succeededProviders: normalized.success ? ["okx"] : [],
    batchSize: options.batchSize ?? 20,
    now,
    acquire: recordingAcquire(options.respond, options.log),
  });
}

describe("stage 2: discovered instrument reaches the scanner", () => {
  it("a dynamically discovered instrument becomes a ranked opportunity", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 12.5, NOW - 30_000)),
    });

    expect(step.acquired).toBeGreaterThan(0);
    expect(step.liveSources.length).toBeGreaterThan(0);

    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY", "SWING"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      // Pin the scan clock to the fixture epoch. Without this the fixture is
      // compared against real wall-clock time and correctly rejected as
      // ancient — which is the engine behaving properly, not a bug.
      now: NOW,
    });

    // The scanner produced ranked output for instruments pre-listed nowhere.
    const rows = ranked(scan, "SWING");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.instrument)).toContain("NEWCOIN-USDT");

    // Identity survives all the way into the ranked row the user sees.
    const row = rows.find((r) => r.instrument === "NEWCOIN-USDT");
    expect(row?.providerNative).toEqual({
      provider: "okx",
      providerInstrumentId: "NEWCOIN-USDT",
    });
  });

  it("preserves the exact native id through every stage into the scanner", async () => {
    const requested: string[] = [];
    const step = await runCycle({
      log: requested,
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 12.5, NOW - 30_000)),
    });

    // Requested ids are native.
    expect(requested).toContain("NEWCOIN-USDT-SWAP");

    // Live sources carry the native id in both places.
    for (const source of step.liveSources) {
      expect(source.providerNative?.provider).toBe("okx");
      expect(source.instrument).toBe(source.providerNative?.providerInstrumentId);
    }

    const ids = step.liveSources.map((s) => s.instrument).sort();
    expect(ids).toEqual(
      ["NEWCOIN-USDT", "NEWCOIN-USDT-SWAP", "ZZZTOKEN-USDT"].sort(),
    );
  });

  it("never substitutes one discovered instrument for another", async () => {
    // Prices are distinct per instrument; if any stage swaps identities the
    // price will follow the wrong id.
    const priceOf: Record<string, number> = {
      "NEWCOIN-USDT": 11,
      "NEWCOIN-USDT-SWAP": 22,
      "ZZZTOKEN-USDT": 33,
    };

    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) =>
          successResult(
            b.providerInstrumentId,
            priceOf[b.providerInstrumentId] ?? 999,
            NOW - 30_000,
          ),
        ),
    });

    for (const source of step.liveSources) {
      expect(
        source.marketData?.price?.price,
        `${source.instrument} received the wrong price`,
      ).toBe(priceOf[source.instrument]);
    }

    // The two confusable ids remain separate live sources.
    const ids = step.liveSources.map((s) => s.instrument);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ───────────────────────────────────────────────────────────────
// Stage 3 — failure must never fabricate
// ───────────────────────────────────────────────────────────────

describe("stage 3: failed acquisition never becomes live evidence", () => {
  it("a failed response produces no live source at all", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => ({
          instrument: b.providerInstrumentId,
          providerInstrumentId: b.providerInstrumentId,
          provider: "okx",
          assetClass: "crypto" as const,
          success: false,
          snapshot: null,
          error: "upstream 503",
        })),
    });

    expect(step.liveSources).toHaveLength(0);
    expect(step.acquired).toBe(0);
    // The failure is reported, not swallowed.
    expect(step.providerErrors.join(" ")).toContain("upstream 503");
  });

  it("an empty/omitted response is an explicit failure, not a zero price", async () => {
    const step = await runCycle({ respond: () => [] });

    expect(step.liveSources).toHaveLength(0);
    expect(step.providerErrors.join(" ")).toContain(
      "provider returned no result",
    );
    // No fabricated price of any kind reached the pipeline.
    expect(JSON.stringify(step.liveSources)).not.toContain('"price":0');
  });

  it("a success flag with no snapshot is rejected rather than trusted", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => ({
          instrument: b.providerInstrumentId,
          providerInstrumentId: b.providerInstrumentId,
          provider: "okx",
          assetClass: "crypto" as const,
          success: true,
          snapshot: null,
        })),
    });

    expect(step.liveSources).toHaveLength(0);
    expect(step.providerErrors.join(" ")).toContain("no usable snapshot");
  });

  it("provider failure produces a degraded scan, never a directional signal", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => ({
          instrument: b.providerInstrumentId,
          providerInstrumentId: b.providerInstrumentId,
          provider: "okx",
          assetClass: "crypto" as const,
          success: false,
          snapshot: null,
          error: "rate limited",
        })),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      providerErrors: step.providerErrors,
      now: NOW,
    });

    expect(scan.degraded).toBe(true);
    // An outage yields no ranked opportunities — it must not read as a quiet
    // market and must never become a BUY/SELL.
    expect(ranked(scan, "INTRADAY")).toHaveLength(0);
    expect(scan.totalScanned).toBe(0);
  });

  it("a failed refresh retains the previously good source", async () => {
    const first = await runCycle({
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 50, NOW - 30_000)),
    });
    expect(first.liveSources.length).toBe(3);

    const second = await runCycle({
      state: first.state,
      now: NOW + 60_000,
      respond: (batch) =>
        batch.map((b) => ({
          instrument: b.providerInstrumentId,
          providerInstrumentId: b.providerInstrumentId,
          provider: "okx",
          assetClass: "crypto" as const,
          success: false,
          snapshot: null,
          error: "timeout",
        })),
    });

    // Data is retained, and the retention is stated explicitly.
    expect(second.liveSources.length).toBe(3);
    expect(second.providerErrors.join(" ")).toContain("previous data retained");
  });
});

// ───────────────────────────────────────────────────────────────
// Stage 4 — stale data must never be labelled live
// ───────────────────────────────────────────────────────────────

describe("stage 4: historical data cannot be labelled live", () => {
  it("an old observation is not admitted as fresh", async () => {
    // 6 hours old: past FRESH (5m) and DELAYED (1h), so it is STALE.
    const sixHoursAgo = NOW - 6 * 3_600_000;

    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => {
          const r = successResult(b.providerInstrumentId, 42, sixHoursAgo);
          return { ...r, snapshot: { ...r.snapshot, freshness: "STALE" as const } };
        }),
    });

    for (const source of step.liveSources) {
      expect(source.marketData?.dataFreshness).not.toBe("realtime");
    }

    // INTRADAY requires at least DELAYED, so stale data must not rank.
    const intraday = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      now: NOW,
    });
    expect(ranked(intraday, "INTRADAY")).toHaveLength(0);
    // And the exclusion is stated, not silent.
    const excluded = intraday.results.get("INTRADAY" as never)?.excludedInstruments ?? [];
    expect(excluded.length).toBeGreaterThan(0);
  });

  it("scalping rejects anything that is not genuinely live", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => {
          const r = successResult(b.providerInstrumentId, 42, NOW - 45 * 60_000);
          return { ...r, snapshot: { ...r.snapshot, freshness: "DELAYED" as const } };
        }),
    });

    const scalping = scanInstruments(step.liveSources, {
      horizons: ["SCALPING"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      now: NOW,
    });
    expect(ranked(scalping, "SCALPING")).toHaveLength(0);
  });
});

describe("stage 4b: the freshness gate uses real elapsed time", () => {
  it("rejects data that is old relative to the scan clock", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 42, NOW)),
    });

    // Same sources, but scanned two days later.
    const later = scanInstruments(step.liveSources, {
      horizons: ["SWING"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      now: NOW + 48 * 3_600_000,
    });

    expect(ranked(later, "SWING")).toHaveLength(0);
    const excluded =
      later.results.get("SWING" as never)?.excludedInstruments ?? [];
    expect(excluded.map((e) => e.reason).join(" ")).toContain("UNAVAILABLE");
  });
});

// ───────────────────────────────────────────────────────────────
// Stage 5 — rotation is a budget, never a whitelist
// ───────────────────────────────────────────────────────────────

describe("stage 5: rotating acquisition cannot starve instruments", () => {
  it("covers the entire discovered set across cycles with a small budget", async () => {
    const requested: string[] = [];
    let state = createPipelineState();

    // Budget of 1 per cycle against 3 instruments.
    for (let cycle = 0; cycle < 3; cycle++) {
      const step = await runCycle({
        state,
        batchSize: 1,
        now: NOW + cycle * 60_000,
        log: requested,
        respond: (batch) =>
          batch.map((b) => successResult(b.providerInstrumentId, 10, NOW + cycle * 60_000)),
      });
      state = step.state;
    }

    expect(new Set(requested)).toEqual(
      new Set(["NEWCOIN-USDT", "NEWCOIN-USDT-SWAP", "ZZZTOKEN-USDT"]),
    );
  });

  it("advances the cursor rather than repeating the same instrument", async () => {
    const first = selectRotatingDiscoveryBatch(["a", "b", "c", "d"], 0, 2);
    expect(first.batch).toEqual(["a", "b"]);

    const second = selectRotatingDiscoveryBatch(["a", "b", "c", "d"], first.nextCursor, 2);
    expect(second.batch).toEqual(["c", "d"]);

    // And it wraps rather than stopping at the end.
    const third = selectRotatingDiscoveryBatch(["a", "b", "c", "d"], second.nextCursor, 2);
    expect(third.batch).toEqual(["a", "b"]);
  });

  it("reaches every element for awkward budget/size combinations", () => {
    // A budget that does not divide the set size is the classic starvation bug.
    for (const size of [3, 5, 7, 11]) {
      for (const budget of [1, 2, 4]) {
        const universe = Array.from({ length: size }, (_, i) => `i${i}`);
        const seen = new Set<string>();
        let cursor = 0;
        for (let cycle = 0; cycle < size * 2; cycle++) {
          const { batch, nextCursor } = selectRotatingDiscoveryBatch(
            universe,
            cursor,
            budget,
          );
          batch.forEach((x) => seen.add(x));
          cursor = nextCursor;
        }
        expect(seen.size, `size=${size} budget=${budget}`).toBe(size);
      }
    }
  });

  it("a newly listed instrument is picked up without any code change", async () => {
    // Cycle 1: three instruments.
    const first = await runCycle({
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 10, NOW)),
    });
    expect(first.liveSources.map((s) => s.instrument)).not.toContain(
      "BRANDNEW-USDT",
    );

    // Cycle 2: OKX starts listing a brand-new instrument. No source edit.
    const extended = [
      ...OKX_ROWS,
      {
        instId: "BRANDNEW-USDT",
        instType: "SPOT",
        baseCcy: "BRANDNEW",
        quoteCcy: "USDT",
        state: "live",
        tickSz: "0.01",
        lotSz: "1",
        minSz: "1",
      },
    ] as unknown as readonly (typeof OKX_ROWS)[number][];

    const second = await runCycle({
      state: first.state,
      rows: extended,
      now: NOW + 60_000,
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 10, NOW + 60_000)),
    });

    expect(second.liveSources.map((s) => s.instrument)).toContain("BRANDNEW-USDT");
  });

  it("a non-trading instrument is excluded by provider state, not by a list", async () => {
    const suspended = [
      { ...OKX_ROWS[0] },
      { ...OKX_ROWS[2], state: "suspend" },
    ] as unknown as readonly (typeof OKX_ROWS)[number][];

    const step = await runCycle({
      rows: suspended,
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 10, NOW)),
    });

    const ids = step.liveSources.map((s) => s.instrument);
    expect(ids).toContain("NEWCOIN-USDT");
    expect(ids).not.toContain("ZZZTOKEN-USDT");
  });
});

// ───────────────────────────────────────────────────────────────
// Stage 6 — ranking works on dynamic instruments
// ───────────────────────────────────────────────────────────────

describe("stage 6: scanner ranking on dynamically discovered instruments", () => {
  it("ranks without reference to any static universe", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b, i) =>
          successResult(b.providerInstrumentId, 100 + i * 10, NOW - 30_000),
        ),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["SWING"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      now: NOW,
    });

    expect(scan.degraded).toBe(false);
    const rows = ranked(scan, "SWING");
    expect(rows.length).toBeGreaterThan(0);

    // Ranking is ordered (highest score first) and ranks are contiguous.
    const scores = rows.map((r) => r.analyticalScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));

    // Confidence must reflect the evidence actually held. These fixtures
    // carry only 4 candles and a single provider, so nothing here may be
    // presented as high-confidence just because acquisition succeeded.
    for (const row of rows) {
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(100);
      expect(row.dataCompleteness).toBe("MINIMAL");
      expect(row.freshness).toBe("FRESH");
    }
  });

  it("respects maxResults on a dynamic set", async () => {
    const step = await runCycle({
      respond: (batch) =>
        batch.map((b) => successResult(b.providerInstrumentId, 100, NOW - 30_000)),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["SWING"],
      maxResults: 1,
      maxPerCorrelationGroup: 5,
      now: NOW,
    });
    expect(ranked(scan, "SWING").length).toBeLessThanOrEqual(1);
  });
});
