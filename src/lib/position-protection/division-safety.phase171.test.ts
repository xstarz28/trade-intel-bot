/**
 * Phase 171 — Division-by-price safety.
 *
 * Percentages across the protection surface are expressed against entryPrice.
 * When that price is 0 or non-finite the expression yields Infinity or NaN,
 * and those values were being formatted and shown as real measurements
 * ("Infinity%" as a distance-to-stop).
 *
 * The subtler bug is the comparison, not the display: `NaN < 2` is false, so
 * an unguarded NaN silently SUPPRESSES an "approaching stop loss" warning
 * instead of raising it. A missing alert is worse than a visibly broken one.
 */

import { describe, expect, it } from "vitest";
import { calculateProfitMetrics } from "./profit-state";
import { deriveInvalidationConditions } from "./decision-support";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PositionContext } from "./types";

const basePosition: PositionContext = {
  instrument: "BTC/USD",
  assetClass: "crypto",
  side: "LONG",
  entryPrice: 100,
  currentPrice: 100,
  horizon: "SWING",
  openedAt: 1_700_000_000_000,
};

describe("calculateProfitMetrics with an unusable entry price", () => {
  const badEntries = [0, Number.NaN, Number.POSITIVE_INFINITY];

  for (const entryPrice of badEntries) {
    it(`does not emit non-finite percentages for entryPrice=${entryPrice}`, () => {
      const state = calculateProfitMetrics({
        ...basePosition,
        entryPrice,
        currentPrice: 100,
        stopLoss: 95,
        takeProfit: 110,
      });

      for (const [key, value] of Object.entries(state)) {
        if (typeof value === "number") {
          expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
        }
      }
    });

    it(`reports distances as unknown rather than fabricated for entryPrice=${entryPrice}`, () => {
      const state = calculateProfitMetrics({
        ...basePosition,
        entryPrice,
        currentPrice: 100,
        stopLoss: 95,
        takeProfit: 110,
      });
      expect(state.distanceToSLPct).toBeUndefined();
      expect(state.distanceToTPPct).toBeUndefined();
    });
  }

  it("still computes real distances from a valid entry price", () => {
    // The guards must not suppress genuine measurements.
    const state = calculateProfitMetrics({
      ...basePosition,
      entryPrice: 100,
      currentPrice: 105,
      stopLoss: 95,
      takeProfit: 115,
    });
    expect(state.distanceToSLPct).toBeCloseTo(10, 5);
    expect(state.distanceToTPPct).toBeCloseTo(10, 5);
    expect(state.distanceFromEntryPct).toBeCloseTo(5, 5);
  });
});

describe("invalidation conditions never report an unknown distance as a number", () => {
  const makeIntel = (
    distancePct: number | undefined,
    approaching: boolean,
  ): PositionIntelligence =>
    ({
      invalidationConditions: [
        { description: "Stop loss at 95", distancePct, approaching },
      ],
    }) as unknown as PositionIntelligence;

  it("renders an unavailable distance in words", () => {
    const [row] = deriveInvalidationConditions(makeIntel(undefined, false));
    expect(row.currentState).toBe("Distance: unavailable");
    expect(row.currentState).not.toContain("NaN");
    expect(row.currentState).not.toContain("Infinity");
  });

  it("keeps the numeric distance undefined rather than zero", () => {
    // Zero would read as "already at the stop".
    const [row] = deriveInvalidationConditions(makeIntel(undefined, false));
    expect(row.distancePct).toBeUndefined();
  });

  it("still formats a real distance", () => {
    const [row] = deriveInvalidationConditions(makeIntel(3.5, false));
    expect(row.currentState).toBe("Distance: 3.50%");
    expect(row.status).toBe("NOT_APPROACHING");
  });

  it("still flags a triggered condition", () => {
    const [row] = deriveInvalidationConditions(makeIntel(0, true));
    expect(row.status).toBe("TRIGGERED");
  });

  it("still flags an approaching condition", () => {
    const [row] = deriveInvalidationConditions(makeIntel(1.2, true));
    expect(row.status).toBe("APPROACHING");
  });
});
