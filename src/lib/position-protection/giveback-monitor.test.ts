import { describe, it, expect } from "vitest";
import { calculateGiveback, classifyGivebackSeverity } from "./giveback-monitor";
import type { PositionSnapshot } from "./realtime-types";

function snapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    entryPrice: 50000,
    currentPrice: 52000,
    horizon: "SWING",
    openedAt: Date.now(),
    lastUpdateAt: Date.now(),
    monitoringStatus: "LIVE",
    ...overrides,
  };
}

describe("calculateGiveback", () => {
  it("tracks peak price as current when at new high", () => {
    const pos = snapshot({ currentPrice: 53000 });
    const result = calculateGiveback(pos);
    expect(result.peakPrice).toBe(53000);
    expect(result.givebackPct).toBe(0);
    expect(result.pullbackType).toBe("NORMAL_PULLBACK");
  });

  it("calculates giveback when below peak", () => {
    const pos = snapshot({ currentPrice: 52000 });
    const result = calculateGiveback(pos, 53000);
    expect(result.peakPrice).toBe(53000);
    expect(result.peakProfit).toBe(3000); // 53000 - 50000
    expect(result.currentProfit).toBe(2000); // 52000 - 50000
    expect(result.givebackAbsolute).toBe(1000);
    expect(result.givebackPct).toBeCloseTo(33.33, 0);
  });

  it("classifies PROTECTION_EVENT when giveback exceeds threshold for SWING", () => {
    const pos = snapshot({ currentPrice: 50500, horizon: "SWING" });
    const result = calculateGiveback(pos, 53000);
    expect(result.pullbackType).toBe("PROTECTION_EVENT");
  });

  it("tracks SHORT position peak correctly", () => {
    const pos = snapshot({
      side: "SHORT",
      entryPrice: 50000,
      currentPrice: 48000,
    });
    const result = calculateGiveback(pos, 47000);
    expect(result.peakPrice).toBe(47000);
    expect(result.peakProfit).toBe(3000); // 50000 - 47000
    expect(result.currentProfit).toBe(2000); // 50000 - 48000
    expect(result.givebackPct).toBeCloseTo(33.33, 0);
  });

  it("computes R giveback when SL is available", () => {
    const pos = snapshot({
      currentPrice: 51000,
      stopLoss: 49000,
    });
    const result = calculateGiveback(pos, 53000);
    expect(result.rGiveback).toBeDefined();
    expect(result.rGiveback!).toBeGreaterThan(0);
  });

  it("returns zero giveback when at entry (no profit yet)", () => {
    const pos = snapshot({ currentPrice: 50000 });
    const result = calculateGiveback(pos, 50000);
    expect(result.givebackPct).toBe(0);
    expect(result.givebackAbsolute).toBe(0);
  });
});

describe("classifyGivebackSeverity", () => {
  it("returns NONE for zero giveback", () => {
    const giveback = calculateGiveback(snapshot({ currentPrice: 53000 }));
    expect(classifyGivebackSeverity(giveback, "SWING")).toBe("NONE");
  });

  it("returns WATCH for moderate giveback", () => {
    const pos = snapshot({ currentPrice: 52100 });
    const giveback = calculateGiveback(pos, 53000); // peakProfit=3000, currentProfit=2100, givebackPct=30%
    // SWING thresholds: watchPct=30, partialTpPct=45 — 30% >= 30 but < 45 → WATCH
    expect(classifyGivebackSeverity(giveback, "SWING")).toBe("WATCH");
  });

  it("returns PARTIAL_TP for moderate-high giveback", () => {
    const pos = snapshot({ currentPrice: 51500 });
    const giveback = calculateGiveback(pos, 53000); // peakProfit=3000, currentProfit=1500, givebackPct=50%
    // SWING thresholds: partialTpPct=45 — 50% >= 45 but < 60 → PARTIAL_TP
    expect(classifyGivebackSeverity(giveback, "SWING")).toBe("PARTIAL_TP");
  });

  it("returns PROTECT_NOW for extreme giveback", () => {
    const pos = snapshot({ currentPrice: 50200 });
    const giveback = calculateGiveback(pos, 53000); // ~93.3% of 3000 peak
    expect(classifyGivebackSeverity(giveback, "SWING")).toBe("PROTECT_NOW");
  });

  it("uses SCALPING thresholds (tighter)", () => {
    const pos = snapshot({ currentPrice: 52000 });
    const giveback = calculateGiveback(pos, 53000); // ~33.3% — SCALPING: watchPct=15, partialTpPct=25
    // 33.3% >= 25 → PARTIAL_TP
    expect(classifyGivebackSeverity(giveback, "SCALPING")).toBe("PARTIAL_TP");
  });

  it("uses INVESTING thresholds (wider)", () => {
    const pos = snapshot({ currentPrice: 52000 });
    const giveback = calculateGiveback(pos, 53000); // ~33.3%
    expect(classifyGivebackSeverity(giveback, "INVESTING")).toBe("NONE");
  });
});
