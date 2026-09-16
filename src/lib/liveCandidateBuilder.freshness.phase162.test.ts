/**
 * Phase 162 — Freshness regression tests.
 *
 * Two real defects found by the integration chain test:
 *
 * 1. buildCandidateFromSource() called Date.now() internally, so
 *    ScanConfig.now was silently ignored. Freshness gating was evaluated
 *    against the wall clock, making scans non-reproducible and letting
 *    six-hour-old data be graded FRESH in a test using a fixed clock.
 *
 * 2. A timestamp in the FUTURE produced a negative age, which compared
 *    below every threshold and was therefore graded FRESH — meaning clock
 *    skew or a malformed provider payload could promote unverifiable data
 *    into the live scanner.
 */

import { describe, expect, it } from "vitest";
import { buildCandidateFromSource } from "./liveCandidateBuilder";
import type { LiveCandidateSource } from "./liveCandidateBuilder";
import { scanInstruments } from "./liveScanner";

const NOW = 1_800_000_000_000;

function sourceAt(timestamp: number): LiveCandidateSource {
  return {
    instrument: "BTC-USDT",
    assetClass: "crypto",
    providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT" },
    marketData: {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      provider: "okx",
      fetchTimestamp: timestamp,
      price: { price: 100, timestamp, source: "okx" },
      candles: [],
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };
}

describe("freshness honours the supplied clock", () => {
  it("grades against `now`, not the wall clock", () => {
    // Six hours before the supplied clock.
    const candidate = buildCandidateFromSource(
      sourceAt(NOW - 6 * 3_600_000),
      NOW,
    );
    expect(candidate.freshness).toBe("STALE");
    expect(candidate.hasLiveData).toBe(false);
  });

  it("grades recent data as FRESH", () => {
    const candidate = buildCandidateFromSource(sourceAt(NOW - 60_000), NOW);
    expect(candidate.freshness).toBe("FRESH");
    expect(candidate.hasLiveData).toBe(true);
  });

  it("grades the documented boundaries correctly", () => {
    expect(buildCandidateFromSource(sourceAt(NOW - 4 * 60_000), NOW).freshness).toBe("FRESH");
    expect(buildCandidateFromSource(sourceAt(NOW - 30 * 60_000), NOW).freshness).toBe("DELAYED");
    expect(buildCandidateFromSource(sourceAt(NOW - 5 * 3_600_000), NOW).freshness).toBe("STALE");
    expect(buildCandidateFromSource(sourceAt(NOW - 30 * 3_600_000), NOW).freshness).toBe("UNAVAILABLE");
  });

  it("makes scans reproducible for a fixed clock", () => {
    const sources = [sourceAt(NOW - 10 * 60_000)];
    const a = scanInstruments(sources, { horizons: ["INTRADAY"], now: NOW });
    const b = scanInstruments(sources, { horizons: ["INTRADAY"], now: NOW });

    expect(a.results.get("INTRADAY")!.rankedInstruments).toEqual(
      b.results.get("INTRADAY")!.rankedInstruments,
    );
  });

  it("applies the scan clock to every candidate", () => {
    // Stale relative to NOW, but would be fresh against the real wall clock.
    const scan = scanInstruments([sourceAt(NOW - 6 * 3_600_000)], {
      horizons: ["SCALPING"],
      now: NOW,
    });

    expect(scan.results.get("SCALPING")!.rankedInstruments).toEqual([]);
  });
});

describe("future timestamps are never treated as live", () => {
  it("refuses a timestamp far in the future", () => {
    const candidate = buildCandidateFromSource(
      sourceAt(NOW + 60 * 60_000),
      NOW,
    );
    expect(candidate.freshness).toBe("UNAVAILABLE");
    expect(candidate.hasLiveData).toBe(false);
  });

  it("tolerates benign clock skew", () => {
    const candidate = buildCandidateFromSource(sourceAt(NOW + 5_000), NOW);
    expect(candidate.freshness).toBe("FRESH");
  });

  it("keeps future-dated data out of the scanner", () => {
    const scan = scanInstruments([sourceAt(NOW + 24 * 3_600_000)], {
      horizons: ["SCALPING", "INTRADAY"],
      now: NOW,
    });

    expect(scan.results.get("SCALPING")!.rankedInstruments).toEqual([]);
    expect(scan.totalWithLiveData).toBe(0);
  });
});
