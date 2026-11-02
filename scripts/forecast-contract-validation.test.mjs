import { describe, expect, it } from "vitest";
import { extractForecastStatus } from "./forecast-contract-validation.mjs";

describe("production smoke forecast status badge parsing", () => {
  it("does not mistake conditional wording in limitations for a CONDITIONAL badge", () => {
    const text = [
      "trader forecast",
      "UNAVAILABLE · unvalidated",
      "direction: bullish · horizon: 20 bars",
      "! A conditional or projected setup is not an order.",
    ].join("\n");
    expect(extractForecastStatus(text)).toBe("UNAVAILABLE");
  });

  it("recognizes an actual CONDITIONAL badge", () => {
    expect(extractForecastStatus("trader forecast\nCONDITIONAL · unvalidated\nobjective: 105\ninvalidation/downside: 95"))
      .toBe("CONDITIONAL");
  });

  it("recognizes blocked data quality badge", () => {
    expect(extractForecastStatus("investor forecast\nBLOCKED DATA QUALITY · unvalidated"))
      .toBe("BLOCKED DATA QUALITY");
  });

  it("rejects prose without an explicit status badge", () => {
    expect(extractForecastStatus("No forecast is available; conditional setup is not an order."))
      .toBeUndefined();
  });
});
