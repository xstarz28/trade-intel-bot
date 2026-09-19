/**
 * Phase 172b — A degraded scan must stay degraded.
 *
 * Defect found while tracing every `scanInstruments` call site (audit item 4).
 * The Dashboard ran TWO scans over the same sources per cycle:
 *
 *   1. `runDiscoveryCycle` scanned with `providerErrors`  -> degraded: true
 *   2. an auto-scan `useMemo` re-scanned WITHOUT them     -> degraded: false
 *
 * The second overwrote the first via `setScanResult`, so a provider outage
 * rendered as a healthy, quiet market with zero opportunities. That is the
 * "provider availability becomes directional evidence" failure the integrity
 * rules forbid: the user cannot distinguish "nothing worth trading" from
 * "we could not reach the provider".
 *
 * Fix: one scan site, and the cycle's provider errors are retained so every
 * re-scan of the same sources carries them.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scanInstruments, type ScanConfig } from "@/lib/liveScanner";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";

const NOW = 1_735_000_000_000;

function liveSource(instrument: string, price = 100): LiveCandidateSource {
  const closes = [price * 0.97, price * 0.98, price * 0.99, price];
  return {
    instrument,
    assetClass: "crypto",
    providerNative: { provider: "okx", providerInstrumentId: instrument },
    marketData: {
      instrument,
      instrumentType: "crypto",
      provider: "okx",
      fetchTimestamp: NOW - 30_000,
      price: { price, timestamp: NOW - 30_000, source: "okx" },
      candles: closes.map((c, i, a) => ({
        timestamp: NOW - 30_000 - (a.length - 1 - i) * 3_600_000,
        open: c * 0.995,
        high: c * 1.01,
        low: c * 0.99,
        close: c,
        volume: 1_000 + i,
      })),
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  } as unknown as LiveCandidateSource;
}

const BASE: Omit<ScanConfig, "providerErrors"> = {
  horizons: ["INTRADAY", "SWING"],
  maxResults: 10,
  maxPerCorrelationGroup: 2,
  now: NOW,
};

describe("provider errors survive a re-scan of the same sources", () => {
  const sources = [liveSource("NEWCOIN-USDT")];
  const errors = ["okx: ZZZTOKEN-USDT acquisition failed — upstream 503"];

  it("a scan carrying provider errors is degraded", () => {
    const scan = scanInstruments(sources, { ...BASE, providerErrors: errors });
    expect(scan.degraded).toBe(true);
    expect(scan.providerErrors).toEqual(errors);
  });

  it("re-scanning the same sources without the errors loses the degradation", () => {
    // This is the exact behaviour that caused the defect. Pinned so the
    // consequence of dropping providerErrors stays visible.
    const scan = scanInstruments(sources, { ...BASE });
    expect(scan.degraded).toBe(false);
  });

  it("two scans of one cycle agree when the errors are retained", () => {
    const first = scanInstruments(sources, { ...BASE, providerErrors: errors });
    const second = scanInstruments(sources, { ...BASE, providerErrors: errors });

    expect(second.degraded).toBe(first.degraded);
    expect(second.providerErrors).toEqual(first.providerErrors);
  });

  it("a partial outage is degraded even though some instruments succeeded", () => {
    // The dangerous case: results exist, so the scan looks healthy unless the
    // failures are carried.
    const scan = scanInstruments(sources, { ...BASE, providerErrors: errors });
    const ranked = scan.results.get("SWING")?.rankedInstruments ?? [];

    expect(ranked.length).toBeGreaterThan(0);
    expect(scan.degraded).toBe(true);
  });

  it("a total outage reports degraded rather than an empty healthy scan", () => {
    const scan = scanInstruments([], {
      ...BASE,
      providerErrors: ["okx: discovery failed this cycle"],
    });

    expect(scan.degraded).toBe(true);
    expect(scan.totalScanned).toBe(0);
    // No direction is implied by the outage.
    expect(scan.results.get("SWING")?.rankedInstruments ?? []).toHaveLength(0);
  });

  it("provider errors never alter ranking order", () => {
    const many = [
      liveSource("AAA-USDT", 100),
      liveSource("BBB-USDT", 200),
      liveSource("CCC-USDT", 300),
    ];

    const clean = scanInstruments(many, { ...BASE });
    const degraded = scanInstruments(many, { ...BASE, providerErrors: errors });

    const order = (s: typeof clean) =>
      (s.results.get("SWING")?.rankedInstruments ?? []).map((r) => r.instrument);

    // Availability must not become evidence: it flags the scan, never reranks.
    expect(order(degraded)).toEqual(order(clean));
  });
});

describe("Dashboard wiring", () => {
  const SRC = readFileSync("src/pages/Dashboard.tsx", "utf8");

  it("builds a ScanResult in exactly one place", () => {
    // Two scan sites per cycle is what let the later result silently win.
    const sites = SRC.match(/scanInstruments\(/g) ?? [];
    expect(sites).toHaveLength(1);
  });

  it("the surviving scan site carries the retained provider errors", () => {
    const idx = SRC.indexOf("scanInstruments(");
    expect(idx).toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 400);
    expect(block).toContain("providerErrors");
    expect(block).toContain("cycleProviderErrorsRef.current");
  });

  it("records the cycle's errors when the discovery cycle completes", () => {
    expect(SRC).toMatch(
      /cycleProviderErrorsRef\.current\s*=\s*\[\s*\.\.\.discoveryErrors,\s*\.\.\.step\.providerErrors\s*\]/,
    );
  });

  it("passes the errors down to the opportunities component", () => {
    expect(SRC).toMatch(/providerErrors=\{cycleProviderErrorsRef\.current\}/);
  });
});

describe("MarketOpportunities wiring", () => {
  const SRC = readFileSync("src/components/MarketOpportunities.tsx", "utf8");

  it("accepts provider errors for its locally computed scan", () => {
    expect(SRC).toContain("providerErrors?: string[]");
  });

  it("passes them into scanInstruments rather than dropping them", () => {
    const idx = SRC.indexOf("const scanConfig");
    expect(idx).toBeGreaterThan(-1);
    expect(SRC.slice(idx, idx + 400)).toContain("providerErrors");
  });
});
