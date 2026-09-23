/**
 * Phase 162 — Opportunity engine final integration.
 *
 * Proves the complete chain holds together as ONE path:
 *
 *   discovery -> live acquisition -> scanner -> scoring -> ranking
 *
 * and that the guarantees survive the whole journey rather than only
 * holding inside individual modules:
 *   - instrument isolation (no bleed between instruments)
 *   - provider-native identity preserved to the final recommendation
 *   - WAIT / NO-TRADE preserved; no forced recommendations
 *   - decision immutability
 *   - discovery metadata never becomes evidence
 */

import { describe, expect, it } from "vitest";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import type { NativeAcquisitionResult } from "./pipeline";
import type { DiscoveredInstrument } from "./types";
import { scanInstruments } from "@/lib/liveScanner";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import type { OhlcvCandle } from "@/lib/data/market-types";

const NOW = 1_800_000_000_000;

function candles(count: number, base: number, drift: number): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = base + drift * i;
    return {
      timestamp: NOW - (count - i) * 3_600_000,
      open: close - drift / 2,
      high: close + Math.abs(drift),
      low: close - Math.abs(drift),
      close,
      volume: 1_000 + i,
    };
  });
}

function inst(
  id: string,
  provider = "okx",
  overrides: Partial<DiscoveredInstrument> = {},
): DiscoveredInstrument {
  return {
    provider,
    providerInstrumentId: id,
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: id.split("-")[0] ?? id,
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function source(
  i: DiscoveredInstrument,
  price: number,
  drift: number,
): LiveCandidateSource {
  return {
    instrument: i.providerInstrumentId,
    assetClass: i.assetClass,
    providerNative: {
      provider: i.provider,
      providerInstrumentId: i.providerInstrumentId,
    },
    correlationKey: `${i.assetClass}:${i.baseAsset}`,
    marketData: {
      instrument: i.providerInstrumentId,
      instrumentType: "crypto",
      provider: i.provider,
      fetchTimestamp: NOW,
      price: { price, timestamp: NOW, source: i.provider },
      candles: candles(60, price, drift),
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };
}

function acquired(
  i: DiscoveredInstrument,
  price: number,
  drift: number,
): NativeAcquisitionResult {
  return {
    provider: i.provider,
    providerInstrumentId: i.providerInstrumentId,
    assetClass: i.assetClass,
    success: true,
    source: source(i, price, drift),
    observedAt: NOW,
  };
}

async function runChain(discovered: DiscoveredInstrument[]) {
  const step = await runDiscoveryPipelineStep({
    state: createPipelineState(),
    discovered,
    succeededProviders: Array.from(new Set(discovered.map((d) => d.provider))),
    batchSize: 50,
    now: NOW,
    acquire: async (batch) =>
      batch.map((i, idx) => acquired(i, 100 + idx * 10, idx % 2 === 0 ? 1 : -1)),
  });

  return {
    step,
    scan: scanInstruments(step.liveSources, {
      horizons: ["INTRADAY", "SWING"],
      now: NOW,
      maxResults: 20,
      providerErrors: step.providerErrors,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// A. THE FULL CHAIN RUNS
// ═══════════════════════════════════════════════════════════════

describe("A — discovery to ranked opportunity", () => {
  it("carries discovered instruments all the way to a ranking", async () => {
    const { scan } = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);

    expect(scan.totalScanned).toBe(2);
    expect(scan.degraded).toBe(false);
    expect(scan.results.has("INTRADAY")).toBe(true);
    expect(scan.results.has("SWING")).toBe(true);
  });

  it("preserves provider-native identity into the final ranking", async () => {
    const { scan } = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);
    const ranked = scan.results.get("SWING")!.rankedInstruments;

    expect(ranked.length).toBeGreaterThan(0);
    for (const r of ranked) {
      expect(r.providerNative).toBeDefined();
      expect(r.providerNative!.provider).toBe("okx");
      // The exact native id, never canonicalized to "BTC/USD".
      expect(r.providerNative!.providerInstrumentId).toBe(r.instrument);
      expect(r.instrument).toMatch(/-USDT$/);
    }
  });

  it("keeps two venues' instruments distinct through the whole chain", async () => {
    const { scan } = await runChain([
      inst("BTC-USDT", "okx"),
      inst("BTCUSDT", "other"),
    ]);

    const ranked = scan.results.get("SWING")!.rankedInstruments;
    const providers = ranked.map((r) => r.providerNative?.provider).sort();

    expect(scan.totalScanned).toBe(2);
    expect(providers).toEqual(["okx", "other"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("B — instrument isolation", () => {
  it("scores an instrument identically whether or not others are present", async () => {
    const alone = await runChain([inst("BTC-USDT")]);
    const crowded = await runChain([
      inst("BTC-USDT"),
      inst("ETH-USDT"),
      inst("SOL-USDT"),
    ]);

    const btcAlone = alone.scan.results
      .get("SWING")!
      .rankedInstruments.find((r) => r.instrument === "BTC-USDT");
    const btcCrowded = crowded.scan.results
      .get("SWING")!
      .rankedInstruments.find((r) => r.instrument === "BTC-USDT");

    expect(btcAlone).toBeDefined();
    expect(btcCrowded).toBeDefined();
    // Rank may change, but the analysis of BTC itself must not.
    expect(btcCrowded!.analyticalScore).toBe(btcAlone!.analyticalScore);
    expect(btcCrowded!.confidence).toBe(btcAlone!.confidence);
    expect(btcCrowded!.suitability).toBe(btcAlone!.suitability);
  });

  it("one instrument's failure does not alter another's analysis", async () => {
    const healthy = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);

    const partial = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [inst("BTC-USDT"), inst("ETH-USDT")],
      succeededProviders: ["okx"],
      batchSize: 50,
      now: NOW,
      acquire: async (batch) =>
        batch.map((i, idx) =>
          i.providerInstrumentId === "ETH-USDT"
            ? {
                provider: i.provider,
                providerInstrumentId: i.providerInstrumentId,
                assetClass: i.assetClass,
                success: false,
                error: "HTTP 500",
              }
            : acquired(i, 100 + idx * 10, 1),
        ),
    });

    const partialScan = scanInstruments(partial.liveSources, {
      horizons: ["SWING"],
      now: NOW,
      providerErrors: partial.providerErrors,
    });

    const btcHealthy = healthy.scan.results
      .get("SWING")!
      .rankedInstruments.find((r) => r.instrument === "BTC-USDT");
    const btcPartial = partialScan.results
      .get("SWING")!
      .rankedInstruments.find((r) => r.instrument === "BTC-USDT");

    expect(btcPartial!.analyticalScore).toBe(btcHealthy!.analyticalScore);
    expect(partialScan.degraded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. NO FORCED RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════

describe("C — WAIT / NO-TRADE is preserved", () => {
  it("returns no ranked opportunities when nothing was acquired", async () => {
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [inst("BTC-USDT")],
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) =>
        batch.map((i) => ({
          provider: i.provider,
          providerInstrumentId: i.providerInstrumentId,
          assetClass: i.assetClass,
          success: false,
          error: "no data",
        })),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      now: NOW,
      providerErrors: step.providerErrors,
    });

    expect(scan.results.get("INTRADAY")!.rankedInstruments).toEqual([]);
    // Emptiness is explained, not filled with a manufactured pick.
    expect(scan.degraded).toBe(true);
  });

  it("excludes stale data from scalping instead of downgrading it into a pick", async () => {
    const stale = inst("BTC-USDT");
    const staleSource: LiveCandidateSource = {
      ...source(stale, 100, 1),
      marketData: {
        ...source(stale, 100, 1).marketData!,
        // Observed 6 hours ago — not acceptable for scalping.
        fetchTimestamp: NOW - 6 * 3_600_000,
        price: { price: 100, timestamp: NOW - 6 * 3_600_000, source: "okx" },
        dataFreshness: "stale",
      },
    };

    const scan = scanInstruments([staleSource], {
      horizons: ["SCALPING"],
      now: NOW,
    });

    const result = scan.results.get("SCALPING")!;
    expect(result.rankedInstruments).toEqual([]);
    expect(result.excludedInstruments.length).toBeGreaterThan(0);
  });

  it("never invents an opportunity from an empty universe", () => {
    const scan = scanInstruments([], { horizons: ["INTRADAY", "SWING"], now: NOW });

    for (const horizon of ["INTRADAY", "SWING"] as const) {
      expect(scan.results.get(horizon)!.rankedInstruments).toEqual([]);
    }
    expect(scan.degraded).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. DECISION IMMUTABILITY & DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("D — decision immutability", () => {
  it("produces identical results for identical inputs", async () => {
    const a = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);
    const b = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);

    const rank = (x: typeof a) =>
      x.scan.results
        .get("SWING")!
        .rankedInstruments.map((r) => [
          r.instrument,
          r.rank,
          r.analyticalScore,
          r.confidence,
          r.suitability,
        ]);

    expect(rank(a)).toEqual(rank(b));
  });

  it("does not mutate the ranked result when scanning again", async () => {
    const { step } = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);

    const first = scanInstruments(step.liveSources, {
      horizons: ["SWING"],
      now: NOW,
    });
    const snapshot = JSON.stringify(first.results.get("SWING")!.rankedInstruments);

    scanInstruments(step.liveSources, { horizons: ["SWING"], now: NOW });

    expect(JSON.stringify(first.results.get("SWING")!.rankedInstruments)).toBe(
      snapshot,
    );
  });

  it("ranks are contiguous and ordered by score", async () => {
    const { scan } = await runChain([
      inst("BTC-USDT"),
      inst("ETH-USDT"),
      inst("SOL-USDT"),
      inst("XRP-USDT"),
    ]);
    const ranked = scan.results.get("SWING")!.rankedInstruments;

    expect(ranked.map((r) => r.rank)).toEqual(
      Array.from({ length: ranked.length }, (_, i) => i + 1),
    );
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].analyticalScore).toBeGreaterThanOrEqual(
        ranked[i].analyticalScore,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// E. DISCOVERY METADATA IS NOT EVIDENCE
// ═══════════════════════════════════════════════════════════════

describe("E — discovery metadata never becomes evidence", () => {
  it("does not cite the provider or listing as supporting evidence", async () => {
    const { scan } = await runChain([inst("BTC-USDT"), inst("ETH-USDT")]);
    const ranked = scan.results.get("SWING")!.rankedInstruments;

    for (const r of ranked) {
      const evidence = [
        ...r.supportingEvidence,
        ...r.primaryReasons,
      ].join(" ").toLowerCase();

      expect(evidence).not.toContain("discovered");
      expect(evidence).not.toContain("listed on");
      expect(evidence).not.toContain("is tradable");
    }
  });

  it("richer discovery metadata does not change the score", async () => {
    const plain = await runChain([inst("BTC-USDT")]);
    const rich = await runChain([
      inst("BTC-USDT", "okx", {
        capabilities: ["ohlcv", "quote", "order_book"],
        precision: { tickSize: 0.1, lotSize: 0.0001, minSize: 0.0001 },
        region: "global",
        providerState: "live",
      }),
    ]);

    const scoreOf = (x: typeof plain) =>
      x.scan.results.get("SWING")!.rankedInstruments[0]?.analyticalScore;

    expect(scoreOf(rich)).toBe(scoreOf(plain));
  });
});
