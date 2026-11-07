import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { createAppServer } from "../src/app.mjs";
import { openDatabase } from "../src/database.mjs";

const temporaryDirectories = [];

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "trade-intel-live-quotes-"));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, "test.sqlite"), fileURLToPath(new URL("../migrations/", import.meta.url)));
}

async function withServer(database, callback, options = {}) {
  const server = createAppServer({ database, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("authenticated self-hosted live quote API", () => {
  it("routes exact crypto contracts and multi-asset quotes through backend providers", async () => {
    const database = createTemporaryDatabase();
    const now = Date.now();
    const requested = [];
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    const fetchImpl = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("www.okx.com/api/v5/market/ticker")) {
        const instId = new URL(url).searchParams.get("instId");
        return new Response(JSON.stringify({
          code: "0",
          data: [{
            instId,
            last: "101250",
            bidPx: "101249",
            askPx: "101251",
            ts: String(now),
            open24h: "100000",
            vol24h: "125",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("query1.finance.yahoo.com/v8/finance/chart/")) {
        return new Response(JSON.stringify({
          chart: {
            result: [{
              meta: {
                regularMarketPrice: 100.25,
                regularMarketTime: Math.floor(now / 1000),
                bid: 100.2,
                ask: 100.3,
                regularMarketChangePercent: 1.5,
                regularMarketVolume: 250000,
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected provider", { status: 404 });
    };

    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN },
        });
        assert.equal(signIn.status, 201);
        const cookie = signIn.headers.get("set-cookie").split(";")[0];

        const response = await fetch(`${baseUrl}/api/v1/market-data/quotes`, {
          method: "POST",
          headers: {
            Origin: env.APP_ORIGIN,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ instruments: ["BTC-USDT-SWAP", "EUR/USD", "XAU/USD", "AAPL"] }),
        });

        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.results.length, 4);
        assert.deepEqual(payload.results.map((item) => item.instrument), [
          "BTC-USDT-SWAP", "EUR/USD", "XAU/USD", "AAPL",
        ]);
        assert.ok(payload.results.every((item) => item.success && item.sourceMode === "LIVE"));
        assert.equal(payload.results[0].provider, "OKX");
        assert.equal(payload.results[0].price, 101250);
        assert.equal(payload.results[1].assetClass, "forex");
        assert.equal(payload.results[2].assetClass, "commodity");
        assert.equal(payload.results[3].assetClass, "stock");
        assert.ok(requested.some((url) => url.includes("instId=BTC-USDT-SWAP")));
        assert.ok(requested.some((url) => decodeURIComponent(url).includes("EURUSD=X")));
        assert.ok(requested.some((url) => decodeURIComponent(url).includes("XAUUSD=X")));
        assert.ok(requested.some((url) => decodeURIComponent(url).includes("/AAPL?")));
      }, { env, fetchImpl });
    } finally {
      database.close();
    }
  });


  it("routes IDX equity analysis to exact XIDX fundamentals and never to SEC or US stock enrichment", async () => {
    const database = createTemporaryDatabase();
    const now = Date.now();
    const requested = [];
    const env = {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:5173",
      TWELVE_DATA_API_KEY: "test-idx-fundamentals-key",
      SEC_USER_AGENT: "TradeIntelTest (ops@example.test)",
      ALPHA_VANTAGE_API_KEY: "test-alpha-key",
    };
    const timestamps = Array.from({ length: 220 }, (_, index) => Math.floor((now - (220-index) * 86_400_000) / 1000));
    const opens = timestamps.map((_, index) => 7000 + index * 2);
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.hostname === "api.twelvedata.com" && url.pathname === "/statistics") {
        return new Response(JSON.stringify({
          meta: { symbol: "BBCA", exchange: "IDX", mic_code: "XIDX", name: "Bank Central Asia" },
          statistics: { valuations_metrics: { trailing_pe: "18.2" }, financials: { return_on_equity: "19.2" } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "www.sec.gov" || url.hostname === "data.sec.gov" ||
          url.hostname === "www.alphavantage.co") {
        throw new Error("IDX issuer must not be queried through US-only fundamentals providers");
      }
      if (url.hostname === "query1.finance.yahoo.com") {
        return new Response(JSON.stringify({
          chart: { result: [{
            meta: { regularMarketPrice: 7438, regularMarketTime: Math.floor(now / 1000), currency: "IDR" },
            timestamp: timestamps,
            indicators: { quote: [{
              open: opens,
              high: opens.map((value) => value + 10),
              low: opens.map((value) => value - 10),
              close: opens.map((value) => value + 3),
              volume: opens.map(() => 1_000_000),
            }] },
          }] },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected provider", { status: 404 });
    };

    try {
      await withServer(database, async (baseUrl) => {
        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST", headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const response = await fetch(`${baseUrl}/api/v1/market-data/analyze`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ instrument: "BBCA", instrumentType: "stock", timeframe: "D1" }),
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.analysis.fundamentalData.provider, "twelve-data-statistics");
        assert.equal(payload.analysis.fundamentalData.symbol, "BBCA");
        assert.equal(payload.analysis.fundamentalData.peRatio, 18.2);
        assert.ok(requested.some((url) => url.pathname === "/statistics" &&
          url.searchParams.get("symbol") === "BBCA" && url.searchParams.get("mic_code") === "XIDX"));
        assert.ok(requested.every((url) => !["www.sec.gov", "data.sec.gov", "www.alphavantage.co"].includes(url.hostname)));
      }, { env, fetchImpl });
    } finally {
      database.close();
    }
  });

  it("requires a backend session and bounds the requested quote batch", async () => {
    const database = createTemporaryDatabase();
    const env = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:5173" };
    try {
      await withServer(database, async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/api/v1/market-data/quotes`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ instruments: ["AAPL"] }),
        });
        assert.equal(unauthorized.status, 401);

        const signIn = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
          method: "POST",
          headers: { Origin: env.APP_ORIGIN },
        });
        const cookie = signIn.headers.get("set-cookie").split(";")[0];
        const oversized = await fetch(`${baseUrl}/api/v1/market-data/quotes`, {
          method: "POST",
          headers: {
            Origin: env.APP_ORIGIN,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ instruments: Array.from({ length: 51 }, (_, index) => "QUOTE" + index) }),
        });
        assert.equal(oversized.status, 400);
        assert.deepEqual(await oversized.json(), {
          success: false,
          error: "invalid_live_quote_batch_request",
        });
      }, { env });
    } finally {
      database.close();
    }
  });
});
