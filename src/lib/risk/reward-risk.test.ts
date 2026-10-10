import { describe, expect, it } from "vitest";
import { calculateRiskRewardRatio } from "./reward-risk";

describe("calculateRiskRewardRatio", () => {
  it("calculates long R:R from the displayed prices", () => {
    expect(calculateRiskRewardRatio({
      direction: "long", entry: "1.10000", stopLoss: "1.09500", takeProfit: "1.11000",
    })).toBeCloseTo(2, 10);
  });

  it("calculates short R:R with the stop above and target below entry", () => {
    expect(calculateRiskRewardRatio({
      direction: "short", entry: "65000.00", stopLoss: "65200.00", takeProfit: "64600.00",
    })).toBeCloseTo(2, 10);
  });

  it("rejects a long plan whose stop is not below entry", () => {
    expect(calculateRiskRewardRatio({
      direction: "long", entry: "1.10000", stopLoss: "1.10000", takeProfit: "1.11000",
    })).toBeUndefined();
    expect(calculateRiskRewardRatio({
      direction: "long", entry: "1.10000", stopLoss: "1.10500", takeProfit: "1.11000",
    })).toBeUndefined();
  });

  it("rejects a long plan whose target is not above entry", () => {
    expect(calculateRiskRewardRatio({
      direction: "long", entry: "1.10000", stopLoss: "1.09500", takeProfit: "1.09000",
    })).toBeUndefined();
  });

  it("rejects a short plan whose stop is not above entry", () => {
    expect(calculateRiskRewardRatio({
      direction: "short", entry: "1.10000", stopLoss: "1.09500", takeProfit: "1.09000",
    })).toBeUndefined();
  });

  it("rejects a short plan whose target is not below entry", () => {
    expect(calculateRiskRewardRatio({
      direction: "short", entry: "1.10000", stopLoss: "1.10500", takeProfit: "1.11000",
    })).toBeUndefined();
  });

  it("preserves precision near the minimum-R:R threshold", () => {
    expect(calculateRiskRewardRatio({
      direction: "long", entry: "100", stopLoss: "90", takeProfit: "114.99",
    })).toBeCloseTo(1.499, 10);
  });

  it("rejects zero, negative, and non-finite price levels", () => {
    for (const badPrice of ["0", "-1", "NaN", "Infinity"]) {
      expect(calculateRiskRewardRatio({
        direction: "long", entry: badPrice, stopLoss: "1.09500", takeProfit: "1.11000",
      })).toBeUndefined();
    }
  });
});
