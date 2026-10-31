import { describe, expect, it } from "vitest";
import type { OhlcvCandle } from "@/lib/data/market-types";
import {
  evaluateForwardForecastOutcomes,
  type ForwardForecastObservation,
} from "./forward-forecast-evaluation";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function candle(timestamp: number, open: number, high: number, low: number, close: number): OhlcvCandle {
  return { timestamp, open, high, low, close, volume: 100 };
}

function simpleCandles(): OhlcvCandle[] {
  return [
    candle(T0, 100, 101, 99, 100),
    candle(T0 + DAY, 100, 102, 99, 101),
    candle(T0 + 2 * DAY, 101, 111, 100, 110),
    candle(T0 + 3 * DAY, 110, 111, 109, 110),
    candle(T0 + 4 * DAY, 110, 112, 109, 111),
    candle(T0 + 5 * DAY, 111, 112, 110, 111),
  ];
}

function observation(overrides: Partial<ForwardForecastObservation> = {}): ForwardForecastObservation {
  return {
    id: "forecast-1",
    instrument: "BTCUSDT",
    dataAsOf: T0 + DAY,
    horizonEndsAt: T0 + 3 * DAY,
    direction: "bullish",
    baselineDirection: "bearish",
    baselineTrainingEndTime: T0,
    baselineMethod: "prior-200-bar momentum sign",
    objectivePrice: 110,
    invalidationPrice: 95,
    ...overrides,
  };
}

describe("Phase 47 — strict forward forecast outcome evaluation", () => {
  it("enters on the next candle open and records a target-first result after costs", () => {
    const report = evaluateForwardForecastOutcomes([observation()], simpleCandles(), {
      costBpsPerSide: 5,
      minimumSampleCount: 1,
    }, () => T0 + 10 * DAY);

    expect(report.evaluatedCount).toBe(1);
    expect(report.excludedCount).toBe(0);
    expect(report.outcomes[0]).toMatchObject({
      entryPrice: 100,
      exitPrice: 110,
      event: "TARGET",
      barsHeld: 2,
      timeToEventBars: 2,
      horizonClosePrice: 110,
      actualDirection: "bullish",
      predictedDirection: "bullish",
      baselineDirection: "bearish",
      forecastCorrect: true,
      baselineCorrect: false,
    });
    expect(report.outcomes[0].netR).toBeCloseTo(1.98);
    expect(report.expectancyR).toBeCloseTo(1.98);
    expect(report.costBpsPerSide).toBe(5);
  });

  it("scores directional accuracy at the horizon close even when a target exits earlier", () => {
    const candles = [
      candle(T0, 100, 101, 99, 100),
      candle(T0 + DAY, 100, 111, 99, 110),
      candle(T0 + 2 * DAY, 110, 112, 90, 95),
      candle(T0 + 3 * DAY, 95, 96, 94, 95),
    ];
    const report = evaluateForwardForecastOutcomes([observation()], candles, {
      costBpsPerSide: 5,
      minimumSampleCount: 1,
    });
    expect(report.outcomes[0].event).toBe("TARGET");
    expect(report.outcomes[0].exitPrice).toBe(110);
    expect(report.outcomes[0].horizonClosePrice).toBe(95);
    expect(report.outcomes[0].actualDirection).toBe("bearish");
    expect(report.outcomes[0].forecastCorrect).toBe(false);
    expect(report.outcomes[0].baselineCorrect).toBe(true);
  });

  it("assumes invalidation first when target and stop are both touched in one candle", () => {
    const candles = [
      candle(T0, 100, 101, 99, 100),
      candle(T0 + DAY, 100, 111, 94, 100),
      candle(T0 + 2 * DAY, 100, 101, 99, 100),
      candle(T0 + 3 * DAY, 100, 101, 99, 100),
    ];
    const report = evaluateForwardForecastOutcomes([observation()], candles, {
      costBpsPerSide: 5,
      minimumSampleCount: 1,
    });
    expect(report.outcomes[0].event).toBe("INVALIDATION");
    expect(report.outcomes[0].exitPrice).toBe(95);
    expect(report.outcomes[0].netR).toBeCloseTo(-1.02);
    expect(report.invalidationHitPct).toBe(100);
  });

  it("fills an adverse stop gap at the candle open rather than the stop price", () => {
    const candles = [
      candle(T0, 100, 101, 99, 100),
      candle(T0 + DAY, 100, 101, 99, 100),
      candle(T0 + 2 * DAY, 90, 96, 89, 92),
      candle(T0 + 3 * DAY, 92, 93, 91, 92),
    ];
    const report = evaluateForwardForecastOutcomes([observation()], candles, {
      costBpsPerSide: 0,
      minimumSampleCount: 1,
    });
    expect(report.outcomes[0].event).toBe("INVALIDATION");
    expect(report.outcomes[0].exitPrice).toBe(90);
    expect(report.outcomes[0].netR).toBeLessThan(-1);
  });

  it("scores bearish forecasts against actual market direction, not signed short PnL", () => {
    const report = evaluateForwardForecastOutcomes([
      observation({
        direction: "bearish",
        baselineDirection: "bullish",
        objectivePrice: 90,
        invalidationPrice: 105,
      }),
    ], [
      candle(T0, 100, 101, 99, 100),
      candle(T0 + DAY, 100, 101, 98, 99),
      candle(T0 + 2 * DAY, 99, 100, 89, 90),
      candle(T0 + 3 * DAY, 90, 91, 89, 90),
    ], { costBpsPerSide: 5, minimumSampleCount: 1 });

    expect(report.outcomes[0].actualDirection).toBe("bearish");
    expect(report.outcomes[0].forecastCorrect).toBe(true);
    expect(report.outcomes[0].baselineCorrect).toBe(false);
    expect(report.outcomes[0].event).toBe("TARGET");
  });

  it("keeps direction-only forecasts measurable without inventing R or trade geometry", () => {
    const report = evaluateForwardForecastOutcomes([
      observation({ objectivePrice: undefined, invalidationPrice: undefined }),
    ], simpleCandles(), { costBpsPerSide: 5, minimumSampleCount: 1 });
    expect(report.evaluatedCount).toBe(1);
    expect(report.outcomes[0].event).toBe("DIRECTION_ONLY");
    expect(report.outcomes[0].netR).toBeUndefined();
    expect(report.rEvaluatedCount).toBe(0);
    expect(report.expectancyR).toBeNull();
    expect(report.accuracyLift95Pct).toBeNull();
    expect(report.expectancyR95).toBeNull();
    expect(report.accuracyLiftBlockBootstrap95Pct).toBeNull();
    expect(report.expectancyBlockBootstrap95R).toBeNull();
    expect(report.blockBootstrap.method).toBe("circular-moving-block-bootstrap");
    expect(report.status).toBe("INCONCLUSIVE");
  });

  it("excludes overlapping forecast horizons by default", () => {
    const candles = Array.from({ length: 8 }, (_, index) =>
      candle(T0 + index * DAY, 100, 102, 98, 100),
    );
    const report = evaluateForwardForecastOutcomes([
      observation({ id: "first", dataAsOf: T0 + DAY, horizonEndsAt: T0 + 3 * DAY }),
      observation({ id: "overlap", dataAsOf: T0 + 2 * DAY, horizonEndsAt: T0 + 4 * DAY, baselineTrainingEndTime: T0 + DAY }),
    ], candles, { costBpsPerSide: 5 });
    expect(report.evaluatedCount).toBe(1);
    expect(report.excludedReasons.overlapping_horizon).toBe(1);
  });

  it("excludes right-censored horizons instead of truncating them", () => {
    const report = evaluateForwardForecastOutcomes([
      observation({ horizonEndsAt: T0 + 30 * DAY }),
    ], simpleCandles(), { costBpsPerSide: 5 });
    expect(report.evaluatedCount).toBe(0);
    expect(report.excludedReasons.right_censored_or_incomplete_horizon).toBe(1);
  });

  it("rejects a baseline whose training window reaches into the forecast timestamp", () => {
    expect(() => evaluateForwardForecastOutcomes([
      observation({ baselineTrainingEndTime: T0 + DAY }),
    ], simpleCandles(), { costBpsPerSide: 5 })).toThrow(/baseline leakage/i);
  });

  it("rejects candle gaps rather than filling missing bars", () => {
    const candles = simpleCandles();
    candles[2] = candle(T0 + 3 * DAY, 101, 111, 100, 110);
    expect(() => evaluateForwardForecastOutcomes([observation()], candles, {
      costBpsPerSide: 5,
    })).toThrow(/gap-free/i);
  });

  it("rejects duplicate observation IDs and duplicate timestamps", () => {
    expect(() => evaluateForwardForecastOutcomes([
      observation({ id: "same" }),
      observation({ id: "same", dataAsOf: T0 + DAY, horizonEndsAt: T0 + 5 * DAY, baselineTrainingEndTime: T0 }),
    ], simpleCandles(), { costBpsPerSide: 5 })).toThrow(/duplicate forecast observation timestamps/i);
  });

  it("requires an explicit cost assumption", () => {
    expect(() => evaluateForwardForecastOutcomes([observation()], simpleCandles(), {
      costBpsPerSide: Number.NaN,
    })).toThrow(/costbpsperside/i);
  });

  it("requires enough independent samples and only reports positive evidence when accuracy beats the prior-only baseline with positive net R", () => {
    const candles = Array.from({ length: 121 }, (_, index) =>
      candle(T0 + index * DAY, 100, 101, 99, 100),
    );
    const observations: ForwardForecastObservation[] = [];
    for (let i = 0; i < 40; i += 1) {
      const signalIndex = i * 3;
      const win = i < 38;
      candles[signalIndex] = candle(T0 + signalIndex * DAY, 100, 101, 99, 100);
      candles[signalIndex + 1] = candle(T0 + (signalIndex + 1) * DAY, 100, 101, 99, 100.5);
      candles[signalIndex + 2] = win
        ? candle(T0 + (signalIndex + 2) * DAY, 100.5, 111, 100, 110)
        : candle(T0 + (signalIndex + 2) * DAY, 100.5, 101, 94, 95);
      observations.push(observation({
        id: `oos-${i}`,
        dataAsOf: T0 + (signalIndex + 1) * DAY,
        horizonEndsAt: T0 + (signalIndex + 3) * DAY,
        baselineTrainingEndTime: T0 + signalIndex * DAY,
        baselineDirection: "bearish",
        objectivePrice: 110,
        invalidationPrice: 95,
      }));
    }
    const report = evaluateForwardForecastOutcomes(observations, candles, {
      costBpsPerSide: 5,
      minimumSampleCount: 20,
    });
    expect(report.evaluatedCount).toBe(40);
    expect(report.directionalAccuracyPct).toBe(95);
    expect(report.baselineAccuracyPct).toBe(5);
    expect(report.accuracyWilson95?.lowerPct).toBeGreaterThan(report.baselineAccuracyPct!);
    expect(report.baselineAccuracyWilson95).not.toBeNull();
    expect(report.accuracyLift95Pct?.lowerPct).toBeGreaterThan(0);
    expect(report.expectancyR95?.lower).toBeGreaterThan(0);
    expect(report.accuracyLiftBlockBootstrap95Pct?.lowerPct).toBeGreaterThan(0);
    expect(report.expectancyBlockBootstrap95R?.lower).toBeGreaterThan(0);
    expect(report.blockBootstrap.accuracyBlockLength).toBeGreaterThan(0);
    expect(report.blockBootstrap.expectancyBlockLength).toBeGreaterThan(0);
    const repeated = evaluateForwardForecastOutcomes(observations, candles, {
      costBpsPerSide: 5,
      minimumSampleCount: 20,
    });
    expect(repeated.accuracyLiftBlockBootstrap95Pct).toEqual(report.accuracyLiftBlockBootstrap95Pct);
    expect(repeated.expectancyBlockBootstrap95R).toEqual(report.expectancyBlockBootstrap95R);
    expect(report.expectancyR).toBeGreaterThan(0);
    expect(report.profitFactor).toBeGreaterThan(1);
    expect(report.status).toBe("POSITIVE_OUTCOME_EVIDENCE");
  });
});
