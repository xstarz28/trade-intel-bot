import { describe, expect, it } from "vitest";
import { validateTradePlanAgainstMarket } from "./trade-plan-validation";

const candles = [{
  open: 100,
  high: 102,
  low: 98,
  close: 101,
  timestamp: 1_700_000_000_000,
}];

describe("validateTradePlanAgainstMarket", () => {
  it("accepts a directionally coherent long plan near the latest market price", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "long", entry: "101", stopLoss: "97", takeProfit: "107",
    }, candles, 3)).toEqual({ valid: true });
  });

  it("accepts a directionally coherent short plan near the latest market price", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "101", stopLoss: "104", takeProfit: "95",
    }, candles, 3)).toEqual({ valid: true });
  });

  it("rejects levels on the wrong side of entry", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "101", stopLoss: "98", takeProfit: "105",
    }, candles, 3)).toEqual({ valid: false, reason: "invalid_geometry" });
  });

  it("rejects an entry that has drifted materially away from the latest candle", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "110", stopLoss: "115", takeProfit: "95",
    }, candles, 2)).toEqual({ valid: false, reason: "entry_detached_from_latest_price" });
  });

  it("rejects a plan when no valid market candle exists", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "long", entry: "101", stopLoss: "97", takeProfit: "107",
    }, [], 3)).toEqual({ valid: false, reason: "missing_market_candles" });
  });

  it("rejects a long plan after confirmed price has already reached its target", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "long", entry: "101", stopLoss: "98", takeProfit: "107",
    }, [{ ...candles[0], close: 108, high: 109 }], 3)).toEqual({
      valid: false, reason: "target_or_stop_already_crossed",
    });
  });

  it("rejects a short plan when the latest confirmed close is beyond its target", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "101", stopLoss: "104", takeProfit: "95",
    }, [{ ...candles[0], close: 94, low: 93 }], 3)).toEqual({
      valid: false, reason: "target_or_stop_already_crossed",
    });
  });

  it("does not reject a short setup because an earlier wick crossed its stop before the entry decision", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "101", stopLoss: "104", takeProfit: "95",
    }, [{ ...candles[0], high: 105, close: 101 }], 3)).toEqual({ valid: true });
  });

  it("does not reject a long setup because an earlier wick crossed its target before the entry decision", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "long", entry: "101", stopLoss: "97", takeProfit: "107",
    }, [{ ...candles[0], high: 108, close: 101 }], 3)).toEqual({ valid: true });
  });

  it("rejects a long setup when the latest confirmed close is below its stop", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "long", entry: "101", stopLoss: "97", takeProfit: "107",
    }, [{ ...candles[0], low: 95, close: 96 }], 3)).toEqual({
      valid: false, reason: "target_or_stop_already_crossed",
    });
  });

  it("rejects a short setup when the latest confirmed close is above its stop", () => {
    expect(validateTradePlanAgainstMarket({
      direction: "short", entry: "101", stopLoss: "104", takeProfit: "95",
    }, [{ ...candles[0], high: 106, close: 105 }], 3)).toEqual({
      valid: false, reason: "target_or_stop_already_crossed",
    });
  });
});
