import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMarket, fetchAlphaVantageIntelligence, fetchCotPositioning } from "../dist/market-data-engine.mjs";

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

  it("passes verified SEC-derived fundamentals into the shared forward decision engine", async () => {
    const now = Date.now();
    const fundamentalData = {
      provider: "sec-edgar", timestamp: now, instrumentType: "stock", symbol: "AAPL",
      available: true, earningsPerShare: 6.4, dilutedEPS: 6.4,
      latestEarnings: { date: "2026-09-30", eps: 6.4 },
      pointInTimeHistory: { status: "PERSISTED", providerObservationCount: 4, newlyPersistedCount: 0 },
    };
    const result = await analyzeMarket({
      instrument: "AAPL", instrumentType: "stock", timeframe: "H1", fundamentalData,
    }, async () => new Response(JSON.stringify(yahooPayload(now)), {
      status: 200, headers: { "content-type": "application/json" },
    }));

    assert.equal(result.success, true);
    assert.equal(result.analysis.fundamentalData.provider, "sec-edgar");
    assert.equal(result.analysis.fundamentalData.earningsPerShare, 6.4);
    assert.equal(result.analysis.fundamentalData.pointInTimeHistory.status, "PERSISTED");
  });

  it("normalizes Alpha Vantage stock news, sentiment, macro and fundamentals without exposing the API key", async () => {
    const apiKey = "test-secret-alpha-key";
    const feed = Array.from({ length: 8 }, (_, index) => ({
      title: "AAPL market update " + index,
      url: "https://example.test/news/" + index,
      source: "Test Wire",
      time_published: "20261103090000",
      overall_sentiment_score: "0.35",
      overall_sentiment_label: "Somewhat-Bullish",
      summary: "Technology earnings and growth outlook.",
    }));
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      const fn = url.searchParams.get("function");
      const payload = fn === "NEWS_SENTIMENT"
        ? { feed }
        : fn === "OVERVIEW"
          ? { Symbol: "AVTEST", Name: "Alpha Test Corp", PERatio: "18.5", EPS: "4.2", ProfitMargin: "0.22" }
          : { quarterlyEarnings: [{ fiscalDateEnding: "2026-09-30", reportedDate: "2026-10-28", reportedEPS: "1.1", reportedRevenue: "1200000000" }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await fetchAlphaVantageIntelligence("AVTEST", apiKey, fetchImpl);
    assert.equal(result.success, true);
    assert.equal(result.dataAvailable.news, true);
    assert.equal(result.dataAvailable.fundamentals, true);
    assert.equal(result.sentiment.confidence, "high");
    assert.equal(result.fundamentals.provider, "alpha-vantage");
    assert.equal(result.fundamentals.peRatio, 18.5);
    assert.equal(result.fundamentals.latestEarnings.eps, 1.1);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  });

  it("fails closed when Alpha Vantage credentials are absent", async () => {
    let called = false;
    const result = await fetchAlphaVantageIntelligence("AVNOKEY", undefined, async () => {
      called = true;
      throw new Error("network must not be called");
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "AUTH_ERROR");
    assert.equal(called, false);
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

  it("builds COT positioning only from the exact mapped futures contract and consecutive reports", async () => {
    let requestedUrl = "";
    const rows = [
      {
        report_date_as_yyyy_mm_dd: "2026-10-20T00:00:00.000",
        noncomm_positions_long_all: "140000",
        noncomm_positions_short_all: "95000",
        comm_positions_long_all: "80000",
        comm_positions_short_all: "120000",
        open_interest_all: "490000",
      },
      {
        report_date_as_yyyy_mm_dd: "2026-10-27T00:00:00.000",
        noncomm_positions_long_all: "150000",
        noncomm_positions_short_all: "90000",
        comm_positions_long_all: "82000",
        comm_positions_short_all: "118000",
        open_interest_all: "500000",
      },
    ];
    const result = await fetchCotPositioning("EUR/USD", async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    assert.equal(result.success, true);
    assert.match(requestedUrl, /publicreporting\.cftc\.gov\/resource\/6dca-aqww\.json/);
    assert.match(decodeURIComponent(requestedUrl), /EURO FX - CHICAGO MERCANTILE EXCHANGE/);
    assert.equal(result.data.latest.reportDate, "2026-10-27");
    assert.equal(result.data.previous.reportDate, "2026-10-20");
    assert.equal(result.data.netNonCommercial, 60_000);
    assert.equal(result.data.changeFromPreviousReport, 15_000);
    assert.equal(result.data.source, "CFTC Commitments of Traders (publicreporting.cftc.gov)");
  });

  it("keeps COT unavailable for instruments without an explicitly verified CFTC mapping", async () => {
    let providerCalled = false;
    const result = await fetchCotPositioning("BTC/USD", async () => {
      providerCalled = true;
      throw new Error("Unmapped instruments must not reach the provider.");
    });

    assert.equal(result.success, false);
    assert.match(result.error, /No verified CFTC futures contract mapping/);
    assert.equal(providerCalled, false);
  });
});
