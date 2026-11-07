import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMarket, fetchAlphaVantageIntelligence, fetchTwelveDataIdxFundamentals, fetchYahooIdxFundamentals, isIdxListedEquity, fetchCotPositioning, fetchFxReference, fetchOkxInstrumentSpec, fetchOkxOrderBook, fetchOkxFuturesOpenInterest, fetchCryptoDerivatives, fetchCryptoFundamentals, fetchMarketCandlesBatch, fetchMarketQuotesBatch } from "../dist/market-data-engine.mjs";

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

  it("falls back from OKX to Binance only for the identical USDT spot pair", async () => {
    const now = Date.now();
    const requested = [];
    const binanceRows = Array.from({ length: 220 }, (_, index) => {
      const timestamp = now - (220 - index) * 60 * 60 * 1000;
      const open = 60_000 + index * 2;
      return [timestamp, String(open), String(open + 50), String(open - 30), String(open + 10), "125"];
    });
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("okx.com/api/v5/market/candles")) {
        return new Response(JSON.stringify({ code: "50011", msg: "Rate limit reached", data: [] }), { status: 429 });
      }
      if (url.includes("binance.com/api/v3/klines") || url.includes("binance.vision/api/v3/klines")) {
        assert.equal(new URL(url).searchParams.get("symbol"), "BTCUSDT");
        return new Response(JSON.stringify(binanceRows), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await analyzeMarket({
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "H1",
    }, fetchImpl);

    assert.equal(result.success, true);
    assert.equal(result.data.provider, "binance-spot-public-fallback");
    assert.equal(result.data.candles.length, 210);
    assert.equal(result.data.candles.at(-1).close, 60_448);
    assert.ok(requested.some((url) => url.includes("okx.com/api/v5/market/candles")));
    assert.ok(requested.some((url) => url.includes("binance.com/api/v3/klines")));
  });

  it("does not substitute Binance USDT pricing for a USD-quoted crypto instrument", async () => {
    const requested = [];
    const result = await analyzeMarket({
      instrument: "DOGE/USD",
      instrumentType: "crypto",
      timeframe: "H1",
    }, async (input) => {
      requested.push(String(input));
      return new Response("rate limited", { status: 429 });
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "RATE_LIMIT");
    assert.ok(requested.every((url) => !url.includes("binance.com/api/v3/klines")));
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


  it("loads exact IDX-listed fundamentals from Twelve Data XIDX without substituting US SEC filings", async () => {
    const apiKey = "test-twelve-data-fundamentals-secret";
    let requested;
    const result = await fetchTwelveDataIdxFundamentals("BBCA", apiKey, async (input) => {
      requested = new URL(String(input));
      return new Response(JSON.stringify({
        meta: { symbol: "BBCA", exchange: "IDX", mic_code: "XIDX", name: "Bank Central Asia" },
        statistics: {
          valuations_metrics: { market_capitalization: "1000000000000", trailing_pe: "18.2", price_to_book_mrq: "4.1" },
          financials: { profit_margin: "0.225", return_on_equity_ttm: "1.27125", income_statement: { revenue_ttm: "90000000000", revenue_per_share_ttm: "320", diluted_eps_ttm: "500", quarterly_revenue_growth: "0.125", quarterly_earnings_growth_yoy: "0.084" } },
          stock_price_summary: { day_50_ma: "9500", day_200_ma: "9100", fifty_two_week_high: "10500", fifty_two_week_low: "7800" },
          dividends_and_splits: { trailing_annual_dividend_rate: "250", trailing_annual_dividend_yield: "0.021" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(requested.pathname, "/statistics");
    assert.equal(requested.searchParams.get("symbol"), "BBCA");
    assert.equal(requested.searchParams.get("mic_code"), "XIDX");
    assert.equal(requested.searchParams.get("apikey"), apiKey);
    assert.equal(result.provider, "twelve-data-statistics");
    assert.equal(result.symbol, "BBCA");
    assert.equal(result.name, "Bank Central Asia");
    assert.equal(result.marketCap, 1_000_000_000_000);
    assert.equal(result.peRatio, 18.2);
    assert.equal(result.revenueTTM, 90_000_000_000);
    assert.equal(result.dilutedEPS, 500);
    assert.equal(result.earningsPerShare, 500);
    assert.equal(result.profitMargin, 0.225);
    assert.equal(result.returnOnEquity, 1.27125);
    assert.equal(result.revenuePerShare, 320);
    assert.equal(result.revenueGrowth, 0.125);
    assert.equal(result.earningsGrowth, 0.084);
    assert.equal(result.priceToBook, 4.1);
    assert.equal(result.fiftyDayMovingAverage, 9500);
    assert.equal(result.twoHundredDayMovingAverage, 9100);
    assert.equal(result.fiftyTwoWeekHigh, 10500);
    assert.equal(result.fiftyTwoWeekLow, 7800);
    assert.equal(result.dividendPerShare, 250);
    assert.equal(result.dividendYield, 0.021);
    assert.equal(result.available, true);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  });


  it("loads IDX fundamentals from the free Yahoo public session and verifies the exact .JK symbol", async () => {
    const calls = [];
    const modules = {
      price: { symbol: "BBCA.JK", longName: "Bank Central Asia Tbk", marketCap: { raw: 1_200_000_000_000 } },
      summaryDetail: {
        trailingPE: { raw: 18.2 }, forwardPE: { raw: 16.4 },
        fiftyDayAverage: { raw: 9_500 }, twoHundredDayAverage: { raw: 9_100 },
        fiftyTwoWeekHigh: { raw: 10_500 }, fiftyTwoWeekLow: { raw: 7_800 },
        dividendRate: { raw: 250 }, dividendYield: { raw: 0.021 },
      },
      defaultKeyStatistics: {
        pegRatio: { raw: 1.2 }, priceToBook: { raw: 4.1 }, trailingEps: { raw: 520 },
        beta: { raw: 0.8 }, sharesOutstanding: { raw: 100_000_000 },
      },
      financialData: {
        totalRevenue: { raw: 80_000_000_000 }, revenueGrowth: { raw: 0.12 },
        earningsGrowth: { raw: 0.08 }, returnOnAssets: { raw: 0.025 },
        returnOnEquity: { raw: 0.19 }, profitMargins: { raw: 0.31 },
        operatingMargins: { raw: 0.42 }, grossProfits: { raw: 50_000_000_000 },
        revenuePerShare: { raw: 800 },
      },
    };
    const fetchImpl = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, headers: init.headers ?? {} });
      if (url === "https://fc.yahoo.com/") {
        return new Response("", { status: 404, headers: { "set-cookie": "A1=free-session; Path=/; Secure; HttpOnly" } });
      }
      if (url.includes("/v1/test/getcrumb")) {
        assert.match(init.headers.cookie, /A1=free-session/);
        return new Response("free-crumb", { status: 200 });
      }
      if (url.includes("/v10/finance/quoteSummary/BBRI.JK")) {
        assert.match(init.headers.cookie, /A1=free-session/);
        assert.equal(new URL(url).searchParams.get("crumb"), "free-crumb");
        return new Response(JSON.stringify({ quoteSummary: { result: [modules] } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected URL", { status: 404 });
    };
    const result = await fetchYahooIdxFundamentals("BBRI", fetchImpl);
    assert.equal(result.symbol, "BBCA");
    assert.equal(result.provider, "yahoo-finance-public");
    assert.equal(result.marketCap, 1_200_000_000_000);
    assert.equal(result.peRatio, 18.2);
    assert.equal(result.returnOnEquity, 0.19);
    assert.equal(result.revenueGrowth, 0.12);
    assert.equal(result.available, true);
    assert.equal(calls.length, 3);
    assert.ok(!JSON.stringify(result).includes("free-crumb"));
  });

  it("rejects Yahoo IDX fundamentals when the returned symbol is not the requested listing", async () => {
    const fetchImpl = async (input) => {
      const url = String(input);
      if (url === "https://fc.yahoo.com/") return new Response("", { status: 404, headers: { "set-cookie": "A1=session; Path=/" } });
      if (url.includes("/v1/test/getcrumb")) return new Response("crumb", { status: 200 });
      if (url.includes("/v10/finance/quoteSummary/")) return new Response(JSON.stringify({
        quoteSummary: { result: [{ price: { symbol: "BBRI.JK" }, summaryDetail: { trailingPE: { raw: 10 } } }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("unexpected", { status: 404 });
    };
    await assert.rejects(fetchYahooIdxFundamentals("BBRI", fetchImpl), /symbol identity mismatch/);
  });

  it("classifies IDX listings strictly and never queries Twelve Data for US stocks or without credentials", async () => {
    let called = false;
    assert.equal(isIdxListedEquity("BBCA"), true);
    assert.equal(isIdxListedEquity("BBCA.JK"), true);
    assert.equal(isIdxListedEquity("ASII"), true);
    assert.equal(isIdxListedEquity("UNVR"), true);
    assert.equal(isIdxListedEquity("UNTR.JK"), true);
    assert.equal(isIdxListedEquity("AAPL"), false);
    const idxRequests = [];
    for (const ticker of ["ASII", "UNVR"]) {
      const result = await fetchTwelveDataIdxFundamentals(ticker, "secret", async (input) => {
        const url = new URL(String(input));
        idxRequests.push(url);
        return new Response(JSON.stringify({
          meta: { symbol: ticker, exchange: "IDX", mic_code: "XIDX" },
          statistics: { valuations_metrics: { trailing_pe: "12" } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      });
      assert.equal(result.symbol, ticker);
    }
    assert.deepEqual(idxRequests.map((url) => url.searchParams.get("symbol")), ["ASII", "UNVR"]);
    assert.equal(await fetchTwelveDataIdxFundamentals("AAPL", "secret", async () => {
      called = true; throw new Error("US issuer must not be queried via IDX");
    }), null);
    assert.equal(await fetchTwelveDataIdxFundamentals("BBCA", undefined, async () => {
      called = true; throw new Error("Missing credentials must fail closed");
    }), null);
    assert.equal(called, false);
  });

  it("rejects a Twelve Data response that identifies a different IDX security", async () => {
    await assert.rejects(
      fetchTwelveDataIdxFundamentals("BBRI", "secret", async () => new Response(JSON.stringify({
        meta: { symbol: "BBCA", exchange: "IDX", mic_code: "XIDX" },
        statistics: { valuations_metrics: { trailing_pe: "10" } },
      }), { status: 200, headers: { "content-type": "application/json" } })),
      /different equity symbol/,
    );
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

  it("routes crypto, forex, commodity and macro news to asset-specific Alpha Vantage filters", async () => {
    const apiKey = "test-secret-cross-asset-news";
    const cases = [
      { type: "crypto", symbol: "BTC/USDT", filter: "tickers", expected: "CRYPTO:BTC", related: "CRYPTO:BTC" },
      { type: "forex", symbol: "EUR/USD", filter: "tickers", expected: "FOREX:EUR,FOREX:USD", related: "FOREX:EUR" },
      { type: "commodity", symbol: "WTI", filter: "topics", expected: "energy_transportation", related: "" },
      { type: "macro", symbol: "US10Y", filter: "topics", expected: "economy_monetary", related: "" },
    ];
    for (const [index, item] of cases.entries()) {
      let requestedUrl;
      const result = await fetchAlphaVantageIntelligence(item.symbol, apiKey, async (input) => {
        requestedUrl = new URL(String(input));
        return new Response(JSON.stringify({
          feed: [{
            title: "Cross-asset macro and market update " + index,
            url: "https://example.test/cross-asset/" + index,
            source: "Test Wire",
            time_published: index === 2 ? undefined : "20261105090000",
            overall_sentiment_score: "0.32",
            overall_sentiment_label: "Somewhat-Bullish",
            ticker_sentiment: item.related ? [{
              ticker: item.related,
              relevance_score: "0.88",
              ticker_sentiment_score: "0.42",
              ticker_sentiment_label: "Bullish",
            }] : [],
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }, item.type);

      assert.equal(requestedUrl.searchParams.get(item.filter), item.expected, item.symbol);
      assert.equal(result.success, true, item.symbol);
      assert.equal(result.dataAvailable.news, true, item.symbol);
      assert.equal(result.dataAvailable.fundamentals, false, item.symbol);
      assert.equal(result.sentiment.articles.length, 1, item.symbol);
      if (item.type === "commodity") assert.equal(result.sentiment.articles[0].publishedAt, 0);
      assert.equal(JSON.stringify(result).includes(apiKey), false);
    }
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

  it("validates and caches dated Frankfurter FX reference observations", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const payload = { base: "EUR", quote: "JPY", date: today, rate: 163.25 };
    let providerCalls = 0;
    const fetchImpl = async (input) => {
      providerCalls += 1;
      assert.equal(String(input), "https://api.frankfurter.dev/v2/rate/eur/jpy");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const first = await fetchFxReference("EUR", "JPY", fetchImpl);
    assert.equal(first.success, true);
    assert.equal(first.direct.pair, "EUR/JPY");
    assert.equal(first.direct.rate, 163.25);
    assert.match(first.direct.source, /Frankfurter daily reference/);
    assert.equal(first.inverse, null);

    const second = await fetchFxReference("EUR", "JPY", async () => {
      throw new Error("A fresh cached reference should not call the provider again.");
    });
    assert.equal(second.success, true);
    assert.equal(second.direct.rate, 163.25);
    assert.equal(providerCalls, 1);
  });

  it("rejects invalid currency pairs and stale Frankfurter observations without inventing a rate", async () => {
    let providerCalled = false;
    const invalid = await fetchFxReference("EURO", "USD", async () => {
      providerCalled = true;
      throw new Error("Invalid currency codes must not reach the provider.");
    });
    assert.equal(invalid.success, false);
    assert.match(invalid.error, /invalid ISO currency code/);
    assert.equal(providerCalled, false);

    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const stale = await fetchFxReference("GBP", "CHF", async () => new Response(JSON.stringify({
      base: "GBP", quote: "CHF", date: staleDate, rate: 1.1,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    assert.equal(stale.success, false);
    assert.match(stale.error, /FX_RATE_STALE/);
    assert.equal(stale.direct, undefined);
  });

  it("fetches batch OHLCV from the self-hosted engine with exact contract identity", async () => {
    const now = Date.now();
    const requested = [];
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/api/v5/market/candles")) {
        return new Response(JSON.stringify({ code: "0", data: okxCandles(now).map((c) => [
          String(c[0]), c[1], c[2], c[3], c[4], c[5], "0", "0", "1",
        ]) }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const results = await fetchMarketCandlesBatch(["BTC-USDT-SWAP"], ["H1", "M15"], 50, fetchImpl);
    assert.equal(results.length, 2);
    assert.ok(results.every((result) => result.success));
    assert.ok(results.every((result) => result.instrument === "BTC-USDT-SWAP"));
    assert.deepEqual(results.map((result) => result.timeframe), ["H1", "M15"]);
    assert.ok(results.every((result) => result.candles.length === 50));
    assert.ok(requested.every((url) => url.includes("instId=BTC-USDT-SWAP")));
  });

  it("analyzes literal OKX perpetual and dated futures contracts without spot substitution", async () => {
    for (const instrument of ["BTC-USDT-SWAP", "BTC-USDT-261225"]) {
      const now = Date.now();
      const requested = [];
      const fetchImpl = async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("/api/v5/market/candles")) {
          const rows = okxCandles(now).map((c) => [
            String(c[0]), c[1], c[2], c[3], c[4], c[5], "0", "0", "1",
          ]);
          return new Response(JSON.stringify({ code: "0", data: rows }), { status: 200 });
        }
        return new Response(JSON.stringify({ code: "51001", msg: "instrument not found" }), { status: 404 });
      };
      const result = await analyzeMarket({
        instrument, instrumentType: "crypto", timeframe: "H1",
      }, fetchImpl);
      assert.equal(result.success, true, instrument);
      assert.equal(result.data.instrument, instrument);
      assert.equal(result.data.provider, instrument.endsWith("-SWAP") ? "okx-perpetual-public" : "okx-dated-futures-public");
      assert.equal(result.data.candles.length, 210);
      assert.ok(requested.some((url) => url.includes("instId=" + encodeURIComponent(instrument))));
      assert.ok(requested.every((url) => !url.includes("BTC-USDT&")));
    }
  });

  it("fetches CoinGlass derivatives through backend-owned credentials and normalizes real datasets", async () => {
    const requested = [];
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("pattern.plus") || url.includes("api.coingecko.com")) return new Response("not found", { status: 404 });
      const payload = url.includes("open-interest")
        ? { code: "0", data: [{ exchange: "All", open_interest_usd: "1000000", open_interest_change_percent_1h: "2.5", open_interest_change_percent_24h: "4" }] }
        : url.includes("funding-rate")
          ? { code: "0", data: [{ symbol: "BTC", stablecoin_margin_list: [{ exchange: "Binance", funding_rate: "0.01", funding_rate_interval: 8 }] }] }
          : url.includes("global-long-short")
            ? { code: "0", data: [{ global_account_long_short_ratio: "1.2" }] }
            : { code: "0", data: [{ aggregated_long_liquidation_usd: "100", aggregated_short_liquidation_usd: "50" }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await fetchCryptoDerivatives("BTC-USDT-SWAP", "server-only-test-key", fetchImpl);
    assert.equal(result.success, true);
    assert.equal(result.data.provider, "coinglass");
    assert.equal(result.data.openInterest.current, 1_000_000);
    assert.equal(result.data.fundingRate.currentRate, 0.0001);
    assert.equal(result.data.longShort.accountRatio, 1.2);
    assert.equal(result.data.liquidations.totalVolume, 150);
    const coinGlassRequests = requested.filter((url) => url.startsWith("https://open-api-v4.coinglass.com/api/"));
    assert.equal(coinGlassRequests.length, 4);
    assert.ok(coinGlassRequests.filter((url) => !url.includes("global-long-short")).every((url) => new URL(url).searchParams.get("symbol") === "BTC"));
    assert.equal(new URL(coinGlassRequests.find((url) => url.includes("global-long-short"))).searchParams.get("symbol"), "BTCUSDT");
  });

  it("does not request DeFiLlama data for unsupported instruments", async () => {
    let called = false;
    const result = await fetchCryptoFundamentals("AAPL", async () => {
      called = true;
      throw new Error("unsupported instruments must not trigger provider calls");
    });
    assert.equal(result.success, false);
    assert.equal(called, false);
  });

  it("fetches only exact OKX instrument metadata and rejects mismatched contract rows", async () => {
    let requestedUrl = "";
    const result = await fetchOkxInstrumentSpec("BTC-USDT-SWAP", async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        code: "0",
        data: [{
          instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live",
          ctType: "linear", ctVal: "0.01", ctValCcy: "BTC",
          settleCcy: "USDT", lotSz: "0.01", minSz: "0.01", tickSz: "0.1",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(result.success, true);
    assert.match(requestedUrl, /instType=SWAP/);
    assert.match(decodeURIComponent(requestedUrl), /instId=BTC-USDT-SWAP/);
    assert.equal(result.data.instruments.length, 1);
    assert.equal(result.data.instruments[0].instId, "BTC-USDT-SWAP");
    assert.equal(result.data.freshness, "static");

    const mismatch = await fetchOkxInstrumentSpec("ETH-USDT-SWAP", async () => new Response(JSON.stringify({
      code: "0",
      data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.equal(mismatch.success, false);
    assert.match(mismatch.error, /exact requested instrument ETH-USDT-SWAP/);
  });

  it("builds OKX execution quality only from the requested instrument's exchange-timestamped book", async () => {
    const now = Date.now();
    const result = await fetchOkxOrderBook("BTC-USDT-SWAP", async () => new Response(JSON.stringify({
      code: "0",
      data: [{
        instId: "BTC-USDT-SWAP",
        ts: String(now),
        bids: [["65000", "2"], ["64999", "3"]],
        asks: [["65001", "4"], ["65002", "5"]],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.equal(result.success, true);
    assert.equal(result.data.available, true);
    assert.equal(result.data.instrumentId, "BTC-USDT-SWAP");
    assert.equal(result.data.bid, 65000);
    assert.equal(result.data.ask, 65001);
    assert.equal(result.data.freshness, "FRESH");

    const mismatch = await fetchOkxOrderBook("BTC-USDT-SWAP", async () => new Response(JSON.stringify({
      code: "0",
      data: [{
        instId: "ETH-USDT-SWAP",
        ts: String(now),
        bids: [["3000", "2"]],
        asks: [["3001", "2"]],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.equal(mismatch.success, false);
    assert.equal(mismatch.data.available, false);
    assert.match(mismatch.data.reason, /instrument identity mismatch/);
  });

  it("fetches USD open interest only for the literal dated OKX futures contract", async () => {
    const now = Date.now();
    let requestedUrl = "";
    const result = await fetchOkxFuturesOpenInterest("BTC-USDT-261225", async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        code: "0",
        data: [{
          instId: "BTC-USDT-261225",
          instType: "FUTURES",
          oiUsd: "1250000",
          ts: String(now),
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(result.success, true);
    assert.match(requestedUrl, /instType=FUTURES/);
    assert.match(decodeURIComponent(requestedUrl), /instId=BTC-USDT-261225/);
    assert.equal(result.data.openInterest.current, 1_250_000);
    assert.equal(result.data.availability.fundingRate, false);

    let providerCalled = false;
    const invalid = await fetchOkxFuturesOpenInterest("BTC-USDT-SWAP", async () => {
      providerCalled = true;
      throw new Error("A perpetual contract must not be substituted for dated futures.");
    });
    assert.equal(invalid.success, false);
    assert.equal(providerCalled, false);
  });
});


describe("self-hosted live protection quote provider", () => {
  const yahooQuotePayload = (timestamp = Date.now()) => ({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 100.25,
          regularMarketTime: Math.floor(timestamp / 1000),
          bid: 100.2,
          ask: 100.3,
          regularMarketChangePercent: 1.5,
          regularMarketVolume: 250_000,
        },
      }],
    },
  });

  it("fetches an exact OKX perpetual ticker without substituting spot", async () => {
    const now = Date.now();
    const requested = [];
    const [quote] = await fetchMarketQuotesBatch(["BTC-USDT-SWAP"], async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        code: "0",
        data: [{
          instId: "BTC-USDT-SWAP",
          last: "101250",
          bidPx: "101249",
          askPx: "101251",
          ts: String(now),
          open24h: "100000",
          vol24h: "125",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    assert.equal(quote.success, true);
    assert.equal(quote.sourceMode, "LIVE");
    assert.equal(quote.provider, "OKX");
    assert.equal(quote.instrument, "BTC-USDT-SWAP");
    assert.equal(quote.price, 101250);
    assert.equal(quote.change24h, 1.25);
    assert.match(decodeURIComponent(requested[0]), /instId=BTC-USDT-SWAP/);
    assert.equal(requested.length, 1);
  });

  it("never falls back from a dated futures contract to a spot quote", async () => {
    const requested = [];
    const [quote] = await fetchMarketQuotesBatch(["BTC-USDT-261225"], async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ code: "51001", msg: "instrument not found" }), {
        status: 404, headers: { "content-type": "application/json" },
      });
    });

    assert.equal(quote.success, false);
    assert.equal(quote.sourceMode, "UNAVAILABLE");
    assert.match(quote.error ?? "", /exact-instrument ticker unavailable/i);
    assert.equal(requested.length, 1);
    assert.match(requested[0], /okx\.com\/api\/v5\/market\/ticker/);
  });

  it("preserves the exact USD quote currency for BTC/USD", async () => {
    const requested = [];
    const now = Date.now();
    const [quote] = await fetchMarketQuotesBatch(["BTC/USD"], async (input) => {
      const url = String(input);
      requested.push(url);
      return new Response(JSON.stringify({
        code: "0",
        data: [{
          instId: "BTC-USD",
          last: "65000",
          bidPx: "64999",
          askPx: "65001",
          open24h: "64000",
          vol24h: "100",
          ts: String(now),
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    assert.equal(requested.length, 1);
    assert.match(requested[0], /instId=BTC-USD/);
    assert.doesNotMatch(requested[0], /BTC-USDT/);
    assert.equal(quote.price, 65000);
    assert.equal(quote.success, true);
  });

  it("does not substitute the 13-week T-bill series for the US 2-year yield", async () => {
    const requested = [];
    const [quote] = await fetchMarketQuotesBatch(["US2Y"], async (input) => {
      requested.push(String(input));
      throw new Error("No external request should be made for an unverified mapping");
    });

    assert.equal(requested.length, 0);
    assert.equal(quote.success, false);
    assert.equal(quote.sourceMode, "UNAVAILABLE");
    assert.match(quote.error ?? "", /\^IRX 13-week T-bill series is not a valid substitute/);
  });

  it("uses exact Yahoo tickers for FX, metals, equities, indices, and macro context", async () => {
    const requested = [];
    const instruments = ["EUR/USD", "XAU/USD", "AAPL", "DXY", "US10Y", "US100", "WTI"];
    const results = await fetchMarketQuotesBatch(instruments, async (input) => {
      const url = new URL(String(input));
      requested.push(decodeURIComponent(url.pathname.split("/").pop() ?? ""));
      return new Response(JSON.stringify(yahooQuotePayload()), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });

    assert.deepEqual(requested.sort(), ["EURUSD=X", "XAUUSD=X", "AAPL", "DX-Y.NYB", "^TNX", "^NDX", "CL=F"].sort());
    assert.deepEqual(results.map((item) => item.instrument), instruments);
    assert.equal(results[0].assetClass, "forex");
    assert.equal(results[1].assetClass, "commodity");
    assert.equal(results[2].assetClass, "stock");
    assert.equal(results[3].assetClass, "macro");
    assert.equal(results[4].assetClass, "macro");
    assert.equal(results[5].assetClass, "indices");
    assert.equal(results[6].assetClass, "commodity");
    assert.ok(results.every((item) => item.success && item.sourceMode === "LIVE"));
  });

  it("fails closed for the unverified US 2-year yield ticker", async () => {
    let providerCalled = false;
    const [quote] = await fetchMarketQuotesBatch(["US2Y"], async () => {
      providerCalled = true;
      throw new Error("An unverified macro ticker must not reach a provider.");
    });
    assert.equal(quote.success, false);
    assert.equal(quote.assetClass, "macro");
    assert.equal(quote.sourceMode, "UNAVAILABLE");
    assert.equal(providerCalled, false);
  });

  it("marks provider observations stale from the provider timestamp and rejects unsupported symbols", async () => {
    const [stale] = await fetchMarketQuotesBatch(["MSFT"], async () =>
      new Response(JSON.stringify(yahooQuotePayload(Date.now() - 120_000)), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    assert.equal(stale.success, true);
    assert.equal(stale.sourceMode, "STALE");

    let providerCalled = false;
    const [unsupported] = await fetchMarketQuotesBatch(["UNMAPPED-COMMODITY"], async () => {
      providerCalled = true;
      throw new Error("Unmapped instruments must fail before provider access.");
    });
    assert.equal(unsupported.success, false);
    assert.equal(unsupported.sourceMode, "UNAVAILABLE");
    assert.equal(providerCalled, false);
  });

  it("uses backend-configured TwelveData for fresh FX quotes without exposing its key", async () => {
    const secret = "test-twelve-data-secret";
    const now = Date.now();
    let requestedUrl = "";
    const [quote] = await fetchMarketQuotesBatch(["EUR/USD"], async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        close: "1.085",
        timestamp: String(Math.floor(now / 1000)),
        bid: "1.0849",
        ask: "1.0851",
        percent_change: "0.5",
        volume: "1200",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }, secret);

    assert.match(requestedUrl, /api\.twelvedata\.com\/quote/);
    assert.match(decodeURIComponent(requestedUrl), /symbol=EUR\/USD/);
    assert.match(requestedUrl, /apikey=test-twelve-data-secret/);
    assert.equal(quote.provider, "TwelveData");
    assert.equal(quote.primaryProvider, "TwelveData");
    assert.equal(quote.sourceMode, "LIVE");
    assert.equal(quote.price, 1.085);
    assert.equal(quote.bid, 1.0849);
    assert.equal(JSON.stringify(quote).includes(secret), false);
  });

  it("does not reuse a public quote cache entry when TwelveData credentials are configured", async () => {
    const instrument = "NZD/CHF";
    const now = Date.now();
    await fetchMarketQuotesBatch([instrument], async () =>
      new Response(JSON.stringify(yahooQuotePayload(now)), {
        status: 200, headers: { "content-type": "application/json" },
      }));

    let twelveDataCalls = 0;
    const [quote] = await fetchMarketQuotesBatch([instrument], async (input) => {
      twelveDataCalls += 1;
      assert.match(String(input), /api\.twelvedata\.com\/quote/);
      return new Response(JSON.stringify({
        close: "0.52",
        timestamp: String(Math.floor(now / 1000)),
        bid: "0.5199",
        ask: "0.5201",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }, "test-twelve-data-secret");

    assert.equal(twelveDataCalls, 1);
    assert.equal(quote.provider, "TwelveData");
    assert.equal(quote.price, 0.52);
  });

  it("falls back to provider-timestamped Yahoo quotes when TwelveData is unavailable", async () => {
    const now = Date.now();
    const [quote] = await fetchMarketQuotesBatch(["GBP/JPY"], async (input) => {
      const url = String(input);
      if (url.includes("api.twelvedata.com")) {
        return new Response(JSON.stringify({ code: 429, message: "rate limit" }), {
          status: 429, headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("query1.finance.yahoo.com")) {
        return new Response(JSON.stringify(yahooQuotePayload(now)), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected provider", { status: 404 });
    }, "test-twelve-data-secret");

    assert.equal(quote.provider, "Yahoo Finance");
    assert.equal(quote.primaryProvider, "TwelveData");
    assert.equal(quote.fallbackUsed, true);
    assert.match(quote.fallbackReason ?? "", /TwelveData/);
    assert.equal(quote.sourceMode, "LIVE");
  });

  it("uses Binance only as an exact USDT spot fallback after an OKX spot failure", async () => {
    const requested = [];
    const [quote] = await fetchMarketQuotesBatch(["DOGE/USDT"], async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("www.okx.com")) {
        return new Response(JSON.stringify({ code: "500", msg: "temporary error" }), {
          status: 503, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        symbol: "DOGEUSDT",
        lastPrice: "0.18",
        bidPrice: "0.1799",
        askPrice: "0.1801",
        priceChangePercent: "2.5",
        volume: "1000000",
        closeTime: Date.now(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    assert.equal(quote.success, true);
    assert.equal(quote.provider, "Binance Spot");
    assert.equal(quote.fallbackUsed, true);
    assert.equal(quote.sourceMode, "LIVE");
    assert.equal(quote.price, 0.18);
    assert.equal(requested.length, 2);
    assert.match(requested[1], /api\.binance\.com\/api\/v3\/ticker\/24hr\?symbol=DOGEUSDT/);
  });
});
