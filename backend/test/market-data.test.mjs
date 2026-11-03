import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMarket } from "../dist/market-data-engine.mjs";

function okxCandles(now) {
  return Array.from({ length: 220 }, (_, index) => {
    const timestamp = now - index * 60 * 60 * 1000;
    const open = 100 + index * 0.15;
    return [String(timestamp),String(open),String(open+0.4),String(open-0.3),String(open+0.1),"250"];
  });
}

function yahooPayload(now) {
  const timestamps = Array.from({ length: 220 }, (_, index) =>
    Math.floor((now - (220-index) * 60 * 60 * 1000) / 1000),
  );
  const open = timestamps.map((_, index) => 150 + index * 0.08);
  return {
    chart: {
      result: [{
        timestamp: timestamps,
        indicators: {
          quote: [{
            open,
            high: open.map((value) => value + 0.4),
            low: open.map((value) => value - 0.3),
            close: open.map((value) => value + 0.1),
            volume: open.map(() => 100_000),
          }],
        },
      }],
    },
  };
}

describe("self-hosted market analysis engine", () => {
  it("uses verified OKX candles and the shared technical/SMC/MTF algorithms", async () => {
    const now = Date.now();
    const candles = okxCandles(now);
    const fetchImpl = async (input) => {
      const url = String(input);
      if (url.includes("/market/candles")) {
        return new Response(JSON.stringify({ code: "0", data: candles }), { status: 200 });
      }
      if (url.includes("/market/ticker")) {
        return new Response(JSON.stringify({
          code: "0",
          data: [{ last: "132.5", bidPx: "132.4", askPx: "132.6", ts: String(now) }],
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await analyzeMarket({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H1",
    }, fetchImpl);

    assert.equal(result.success, true);
    assert.equal(result.data.provider, "okx-spot-public");
    assert.equal(result.data.price.price, 132.5);
    assert.equal(result.data.dataFreshness, "realtime");
    assert.equal(result.data.candles.length, 210);
    assert.ok(result.technical.smc);
    assert.ok(result.technical.mtf);
    assert.equal(result.technical.dataPoints, 210);
    // The self-hosted endpoint must return the existing forward decision
    // engine output, not stop at a snapshot of current market conditions.
    assert.ok(result.analysis);
    assert.ok(["LONG", "SHORT", "NO_TRADE"].includes(result.analysis.recommendation));
    assert.ok(result.analysis.forwardForecast);
    if (result.analysis.recommendation === "NO_TRADE") {
      assert.equal(result.analysis.tradePlan, undefined);
    } else {
      assert.ok(result.analysis.tradePlan);
      assert.ok(Number.isFinite(result.analysis.tradePlan.riskReward));
    }
  });

  it("uses exact Yahoo Finance mappings for equities and preserves delayed freshness", async () => {
    const now = Date.now();
    const payload = yahooPayload(now - 2 * 60 * 60 * 1000);
    const fetchImpl = async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

    const result = await analyzeMarket({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "H1",
    }, fetchImpl);

    assert.equal(result.success, true);
    assert.equal(result.data.provider, "yahoo-finance-public");
    assert.equal(result.data.dataFreshness, "stale");
    assert.equal(result.data.price.price, result.data.candles.at(-1).close);
    assert.ok(result.technical.smc);
  });

  it("fails closed when no exact provider symbol exists", async () => {
    const result = await analyzeMarket({
      instrument: "UNLISTED-COMMODITY",
      instrumentType: "commodity",
      timeframe: "D1",
    }, async () => {
      throw new Error("Network must not be called for an unmapped instrument.");
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "UNSUPPORTED");
  });

  it("classifies provider rate limits instead of fabricating a candle series", async () => {
    const result = await analyzeMarket({
      instrument: "ETH/USD",
      instrumentType: "crypto",
      timeframe: "H1",
    }, async () => new Response("rate limited", { status: 429 }));

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "RATE_LIMIT");
    assert.equal(result.data, undefined);
  });
});
