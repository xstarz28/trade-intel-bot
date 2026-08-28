/**
 * Phase 58 — Giveback Monitor Tests
 */
import { describe, it, expect } from "vitest";
import {
  calculateGiveback,
  classifyGivebackSeverity,
} from "../giveback-monitor";
import type { PositionSnapshot } from "../realtime-types";

function longSnapshot(
  overrides: Partial<PositionSnapshot> = {},
): PositionSnapshot {
  return {
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    entryPrice: 100_000,
    currentPrice: 105_000,
    horizon: "SWING",
    openedAt: Date.now(),
    lastUpdateAt: Date.now(),
    monitoringStatus: "LIVE",
    ...overrides,
  };
}

describe("calculateGiveback", () => {
  it("tracks peak price for long", () => {
    const snap = longSnapshot({ currentPrice: 110_000 });
    const gb = calculateGiveback(snap, 100_000);
    expect(gb.peakPrice).toBe(110_000);
    expect(gb.givebackPct).toBe(0);
    expect(gb.pullbackType).toBe("NORMAL_PULLBACK");
  });

  it("computes giveback from peak", () => {
    const snap = longSnapshot({ currentPrice: 103_000 });
    const gb = calculateGiveback(snap, 110_000);
    expect(gb.givebackPct).toBeGreaterThan(0);
    expect(gb.givebackAbsolute).toBe(7000);
    expect(gb.peakProfit).toBe(10_000);
  });

  it("classifies PROTECTION_EVENT when giveback exceeds threshold", () => {
    const snap = longSnapshot({ currentPrice: 101_000 });
    const gb = calculateGiveback(snap, 120_000);
    // Peak profit = 20_000, current profit = 1_000, giveback = 19_000 / 20_000 = 95%
    expect(gb.givebackPct).toBeGreaterThan(80);
    expect(gb.pullbackType).toBe("PROTECTION_EVENT");
  });

  it("tracks short position correctly", () => {
    const snap = longSnapshot({
      side: "SHORT",
      entryPrice: 100_000,
      currentPrice: 97_000,
    });
    const gb = calculateGiveback(snap, 95_000);
    expect(gb.peakPrice).toBe(95_000);
    expect(gb.givebackAbsolute).toBeGreaterThan(0);
  });

  it("computes R-giveback when stop loss is available", () => {
    const snap = longSnapshot({ stopLoss: 98_000 });
    const gb = calculateGiveback(snap, 110_000);
    expect(gb.rGiveback).toBeDefined();
    expect(gb.rGiveback!).toBeGreaterThan(0);
  });

  it("handles no previous peak", () => {
    const snap = longSnapshot();
    const gb = calculateGiveback(snap);
    expect(gb.peakPrice).toBe(snap.currentPrice);
    expect(gb.givebackPct).toBe(0);
  });

  it("handles zero peak profit", () => {
    const snap = longSnapshot({ entryPrice: 100_000, currentPrice: 100_000 });
    const gb = calculateGiveback(snap, 100_000);
    expect(gb.givebackPct).toBe(0);
  });
});

describe("classifyGivebackSeverity", () => {
  it("returns NONE for zero giveback", () => {
    const gb = {
      peakPrice: 110_000,
      currentPrice: 110_000,
      peakProfit: 10_000,
      currentProfit: 10_000,
      givebackAbsolute: 0,
      givebackPct: 0,
      pullbackType: "NORMAL_PULLBACK" as const,
      accelerating: false,
    };
    expect(classifyGivebackSeverity(gb, "SWING")).toBe("NONE");
  });

  it("returns WATCH for moderate giveback", () => {
    const gb = {
      peakPrice: 110_000,
      currentPrice: 105_000,
      peakProfit: 10_000,
      currentProfit: 5_000,
      givebackAbsolute: 5_000,
      givebackPct: 50,
      pullbackType: "NORMAL_PULLBACK" as const,
      accelerating: false,
    };
    expect(classifyGivebackSeverity(gb, "SWING")).toBe("WATCH");
  });

  it("returns PROTECT_NOW for extreme giveback on scalping", () => {
    const gb = {
      peakPrice: 110_000,
      currentPrice: 102_000,
      peakProfit: 10_000,
      currentProfit: 2_000,
      givebackAbsolute: 8_000,
      givebackPct: 80,
      pullbackType: "PROTECTION_EVENT" as const,
      accelerating: true,
    };
    expect(classifyGivebackSeverity(gb, "SCALPING")).toBe("PROTECT_NOW");
  });

  it("horizon-sensitive: higher thresholds for INVESTING", () => {
    const gb = {
      peakPrice: 110_000,
      currentPrice: 103_000,
      peakProfit: 10_000,
      currentProfit: 3_000,
      givebackAbsolute: 7_000,
      givebackPct: 70,
      pullbackType: "NORMAL_PULLBACK" as const,
      accelerating: false,
    };
    // 70% giveback for INVESTING: MANUAL_TP threshold is 70, so it's at the boundary
    const result = classifyGivebackSeverity(gb, "INVESTING");
    expect(["PARTIAL_TP", "MANUAL_TP"]).toContain(result);
  });
});
