/**
 * Live public-endpoint tests — moved out of
 * `live-provider-validation.phase39.test.ts` by Phase 237.
 *
 * WHY THEY MOVED
 * Phase 181 allowed this file into the default suite on the grounds that its
 * assertions sit inside `if (res && res.ok)`, so a failed fetch asserts nothing.
 * That reasoning covers the assertions but not the execution: the file still
 * opened 13 real sockets to public providers during `npm test`, so the run —
 * and anything it shares a process with — still depended on those providers
 * being reachable. Hermetic means no external I/O happens at all, not that the
 * I/O is politely ignored.
 *
 * The bodies below are unchanged; only the place they run has changed.
 *
 * RUN IT WITH:
 *   LIVE_PROVIDER_VERIFICATION=1 npm run test:live
 */
import { describe, it, expect } from "vitest";

import {
  mapInstrumentToCot,
  buildCotContext,
} from "./data/cot";
import { parseOkxResponse } from "./risk/okx-spec";
import {
  parseTreasuryXml,
  buildTreasuryContext,
  deriveMacroYieldEvidence,
} from "./data/treasury";
import { buildExecutionData, parseOkxOrderBook } from "./execution-quality";

// ─── HTTP helpers for live public endpoints ─────────────────────────

const TIMEOUT_MS = 15_000;

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}


// ─── OKX Live Public Endpoint ───────────────────────────────────────

describe("Phase 39 — OKX Public Endpoint (Live)", () => {
  it("fetches BTC-USDT-SWAP instrument spec", async () => {
    const res = await safeFetch(
      "https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP",
    );
    // If we get a response, validate it
    if (res && res.ok) {
      const json = await res.json();
      const parsed = parseOkxResponse(json);
      expect(parsed.instruments.length).toBeGreaterThanOrEqual(1);
      const btc = parsed.instruments.find((i) => i.instId === "BTC-USDT-SWAP");
      if (btc) {
        expect(btc.instType).toBe("SWAP");
        expect(btc.ctType).toBe("linear");
        expect(btc.settleCcy).toBe("USDT");
        expect(btc.ctVal).toBeGreaterThan(0);
      }
    } else {
      // Network blocked or provider unavailable — mark as NOT TESTABLE
      console.log("[Phase 39] OKX endpoint unreachable from test environment");
    }
  }, TIMEOUT_MS);

  it("fetches ETH-USDT-SWAP instrument spec", async () => {
    const res = await safeFetch(
      "https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=ETH-USDT-SWAP",
    );
    if (res && res.ok) {
      const json = await res.json();
      const parsed = parseOkxResponse(json);
      expect(parsed.instruments.length).toBeGreaterThanOrEqual(1);
      const eth = parsed.instruments.find((i) => i.instId === "ETH-USDT-SWAP");
      if (eth) {
        expect(eth.instType).toBe("SWAP");
        expect(eth.settleCcy).toBe("USDT");
      }
    } else {
      console.log("[Phase 39] OKX endpoint unreachable for ETH");
    }
  }, TIMEOUT_MS);
});

// ─── CoinGecko Public Endpoint ─────────────────────────────────────

describe("Phase 39 — CoinGecko Public Endpoint (Live)", () => {
  it("fetches BTC price without API key", async () => {
    const res = await safeFetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    );
    if (res && res.ok) {
      const json = await res.json();
      const price = json.bitcoin?.usd;
      expect(typeof price).toBe("number");
      expect(price).toBeGreaterThan(0);
    } else {
      console.log("[Phase 39] CoinGecko endpoint unreachable from test environment");
    }
  }, TIMEOUT_MS);

  it("fetches ETH price without API key", async () => {
    const res = await safeFetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    if (res && res.ok) {
      const json = await res.json();
      const price = json.ethereum?.usd;
      expect(typeof price).toBe("number");
      expect(price).toBeGreaterThan(0);
    } else {
      console.log("[Phase 39] CoinGecko endpoint unreachable for ETH");
    }
  }, TIMEOUT_MS);
});

// ─── CFTC COT Public Endpoint ──────────────────────────────────────

describe("Phase 39 — CFTC COT Public Endpoint (Live)", () => {
  it("fetches EUR FX COT data", async () => {
    const url =
      "https://publicreporting.cftc.gov/resource/6dca-aqww.json" +
      "?market_and_exchange_names=EURO FX - CHICAGO MERCANTILE EXCHANGE" +
      "&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=2";
    const res = await safeFetch(url, { headers: { Accept: "application/json" } });
    if (res && res.ok) {
      const json = await res.json();
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(1);
      const first = json[0];
      expect(first.report_date_as_yyyy_mm_dd).toBeDefined();
      expect(first.noncomm_positions_long_all).toBeDefined();
      expect(first.noncomm_positions_short_all).toBeDefined();

      // Verify pure parser works on live data
      const ctx = buildCotContext(json, "EUR/USD", Date.now(), Date.now());
      expect(ctx.available).toBe(true);
      if (ctx.available) {
        expect(ctx.sourceInstrument).toContain("EURO FX");
        expect(typeof ctx.netNonCommercial).toBe("number");
      }
    } else {
      console.log("[Phase 39] CFTC COT endpoint unreachable from test environment");
    }
  }, TIMEOUT_MS);

  it("fetches Gold COT data", async () => {
    const url =
      "https://publicreporting.cftc.gov/resource/6dca-aqww.json" +
      "?market_and_exchange_names=GOLD - COMMODITY EXCHANGE INC." +
      "&%24order=report_date_as_yyyy_mm_dd%20DESC&%24limit=2";
    const res = await safeFetch(url, { headers: { Accept: "application/json" } });
    if (res && res.ok) {
      const json = await res.json();
      expect(json.length).toBeGreaterThanOrEqual(1);
      const ctx = buildCotContext(json, "XAU/USD", Date.now(), Date.now());
      expect(ctx.available).toBe(true);
      if (ctx.available) {
        expect(ctx.mappedAsset).toContain("Gold");
        // contractSide is on the mapping, not the context
        const mapping = mapInstrumentToCot("XAU/USD");
        expect(mapping!.contractSide).toBe("asset");
      }
    } else {
      console.log("[Phase 39] CFTC Gold COT endpoint unreachable");
    }
  }, TIMEOUT_MS);
});

// ─── Treasury Public Endpoint ───────────────────────────────────────

describe("Phase 39 — US Treasury Public Endpoint (Live)", () => {
  function getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function getLastMonthKey(): string {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  it("fetches nominal yield curve XML", async () => {
    // Try current month first, fall back to previous month (data may not be
    // published yet at the start of a new month).
    const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
    const currentMonth = getCurrentMonthKey();
    const prevMonth = getLastMonthKey();

    let text: string | null = null;
    for (const m of [currentMonth, prevMonth]) {
      const res = await safeFetch(
        `${BASE}?data=daily_treasury_yield_curve&field_tdr_date_value_month=${m}`,
        { headers: { Accept: "text/xml" } },
      );
      if (res && res.ok) {
        const body = await res.text();
        if (body.includes("<entry>")) {
          text = body;
          break;
        }
      }
    }

    if (text) {
      const points = parseTreasuryXml(text, "nominal");
      expect(points.length).toBeGreaterThan(0);
      const latest = points[points.length - 1];
      expect(latest.observationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // At least 2Y and 10Y should be present
      expect(typeof latest.nominal["2Y"]).toBe("number");
      expect(typeof latest.nominal["10Y"]).toBe("number");
      // Yields should be positive and reasonable (0% to 20%)
      expect(latest.nominal["2Y"]).toBeGreaterThan(0);
      expect(latest.nominal["2Y"]).toBeLessThan(20);
    } else {
      console.log("[Phase 39] Treasury endpoint unreachable or no entries for current/previous month");
    }
  }, TIMEOUT_MS);

  it("fetches real yield curve XML", async () => {
    // Try current month first, fall back to previous month.
    const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
    const currentMonth = getCurrentMonthKey();
    const prevMonth = getLastMonthKey();

    let text: string | null = null;
    for (const m of [currentMonth, prevMonth]) {
      const res = await safeFetch(
        `${BASE}?data=daily_treasury_real_yield_curve&field_tdr_date_value_month=${m}`,
        { headers: { Accept: "text/xml" } },
      );
      if (res && res.ok) {
        const body = await res.text();
        if (body.includes("<entry>")) {
          text = body;
          break;
        }
      }
    }

    if (text) {
      const points = parseTreasuryXml(text, "real");
      expect(points.length).toBeGreaterThan(0);
      const latest = points[points.length - 1];
      expect(latest.observationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } else {
      console.log("[Phase 39] Treasury real yield endpoint unreachable or no entries for current/previous month");
    }
  }, TIMEOUT_MS);

  it("builds full Treasury context from live data", async () => {
    const thisMonth = getCurrentMonthKey();
    const prevMonth = getLastMonthKey();
    const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

    const fetchFeed = async (data: string, yyyymm: string): Promise<string | undefined> => {
      const res = await safeFetch(
        `${BASE}?data=${data}&field_tdr_date_value_month=${yyyymm}`,
        { headers: { Accept: "text/xml" } },
      );
      if (!res || !res.ok) return undefined;
      const text = await res.text();
      return text.includes("<entry>") ? text : undefined;
    };

    const [nomThis, nomPrev] = await Promise.all([
      fetchFeed("daily_treasury_yield_curve", thisMonth),
      fetchFeed("daily_treasury_yield_curve", prevMonth),
    ]);

    const ctx = buildTreasuryContext([nomThis, nomPrev], [], Date.now(), Date.now());
    // At least one month should have data
    if (ctx.available) {
      expect(ctx.source).toContain("Treasury");
      expect(typeof ctx.freshness).toBe("string");
      expect(ctx.latest.nominal.observationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Evidence derivation should not crash
      const evidence = deriveMacroYieldEvidence(ctx);
      expect(typeof evidence.goldLongEffect).toBe("number");
      expect(typeof evidence.usdStrengthEffect).toBe("number");
    }
  }, TIMEOUT_MS * 2);
});

// ─── Execution Quality / OKX Order Book ─────────────────────────────

describe("Phase 39 — OKX Order Book (Live)", () => {
  it("fetches BTC-USDT order book and builds ExecutionData", async () => {
    const res = await safeFetch(
      "https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=50",
    );
    if (res && res.ok) {
      const json = await res.json();
      expect(json.data).toBeDefined();
      if (json.data) {
        const book = Array.isArray(json.data) ? json.data[0] : json.data;
        expect(book).toBeDefined();
        if (book) {
          expect(Array.isArray(book.asks)).toBe(true);
          expect(Array.isArray(book.bids)).toBe(true);
          expect(book.asks.length).toBeGreaterThan(0);
          expect(book.bids.length).toBeGreaterThan(0);

          // Validate bid/ask price sanity: best bid < best ask
          const bestBid = parseFloat(book.bids[0][0]);
          const bestAsk = parseFloat(book.asks[0][0]);
          expect(bestBid).toBeGreaterThan(0);
          expect(bestAsk).toBeGreaterThan(0);
          expect(bestBid).toBeLessThan(bestAsk);

          // Execute the pure parser + builder (pass full response to parser)
          const parsed = parseOkxOrderBook(json);
          const execData = buildExecutionData(parsed, Date.now(), Date.now());
          expect(execData).toBeDefined();
          if (execData) {
            expect(typeof execData.available).toBe("boolean");
          }
        }
      }
    } else {
      console.log("[Phase 39] OKX order book endpoint unreachable");
    }
  }, TIMEOUT_MS);
});
