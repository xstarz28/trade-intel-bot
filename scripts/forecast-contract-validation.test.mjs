import test from "node:test";
import assert from "node:assert/strict";
import { extractForecastStatus } from "./forecast-contract-validation.mjs";

test("production smoke forecast status badge parsing", async (t) => {
  await t.test("does not mistake conditional wording in limitations for a CONDITIONAL badge", () => {
    const text = [
      "trader forecast",
      "UNAVAILABLE · unvalidated",
      "direction: bullish · horizon: 20 bars",
      "! A conditional or projected setup is not an order.",
    ].join("\n");
    assert.equal(extractForecastStatus(text), "UNAVAILABLE");
  });

  await t.test("recognizes an actual CONDITIONAL badge", () => {
    assert.equal(extractForecastStatus("trader forecast\nCONDITIONAL · unvalidated\nobjective: 105\ninvalidation/downside: 95"), "CONDITIONAL");
  });

  await t.test("recognizes blocked data quality badge", () => {
    assert.equal(extractForecastStatus("investor forecast\nBLOCKED DATA QUALITY · unvalidated"), "BLOCKED DATA QUALITY");
  });

  await t.test("rejects prose without an explicit status badge", () => {
    assert.equal(extractForecastStatus("No forecast is available; conditional setup is not an order."), undefined);
  });
});
