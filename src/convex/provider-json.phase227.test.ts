/**
 * Phase 227 — provider JSON enters src/convex as `unknown`.
 *
 * Drives the REAL action handlers (alphaVantage, coinglass, tradingEconomics,
 * liveProtection.fetchOHLCVCandles) through a stubbed `fetch`, so these tests
 * cover the narrowing code paths rather than a re-implementation. For each
 * parser: valid payload, malformed payload (non-object / wrong container),
 * missing field, wrong type, NaN/Infinity, invalid timestamp, instrument
 * mismatch. Also covers the helpers in lib/json.ts directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchOHLCVCandles } from "./liveProtection";
import {
  asFiniteNumber,
  asNonEmptyString,
  asRecordArray,
  asString,
  errorMessage,
  field,
  isRecord,
} from "./lib/json";

type Handler<A, R> = (ctx: unknown, args: A) => Promise<R>;
function handlerOf<A, R>(action: unknown): Handler<A, R> {
  return (action as { _handler: Handler<A, R> })._handler;
}
const av = handlerOf<{ instrument: string; instrumentType: "forex" | "crypto" | "stock" | "commodity" }, {
  success: boolean; sentiment?: { articles: { title: string; publishedAt: number; sentimentScore?: number; relevanceScore?: number }[] } | null;
  fundamentals?: { available: boolean; marketCap?: number; latestEarnings?: { date?: string } } | null;
  dataAvailable?: { news: boolean; fundamentals: boolean }; error?: string; errorCode?: string;
}>(fetchIntelligence);
const cg = handlerOf<{ instrument: string }, {
  success: boolean; data?: { symbol: string; confidence: string; openInterest?: { current: number; change1h?: number };
  fundingRate?: { currentRate: number; weightedRate?: number; exchanges?: { name: string; rate: number }[] };
  longShort?: Record<string, number>; liquidations?: Record<string, unknown> }; error?: string; errorCode?: string;
}>(fetchDerivatives);
const te = handlerOf<{ instrument: string; instrumentType: string }, {
  success: boolean; data?: { events: { id: string; event: string; datetime: number; actual?: unknown; importance: number; currency: string }[] }; error?: string; errorCode?: string;
}>(fetchCalendar);
const ohlcv = handlerOf<{ instruments: string[]; timeframes: string[]; outputsize?: number }, {
  success: boolean; sourceMode: string; candles: { timestamp: number; open: number; volume: number }[]; error?: string;
}[]>(fetchOHLCVCandles);

const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };

let responder: (url: string) => unknown = () => ({});
let httpStatus = 200;
beforeEach(() => {
  resetProviderCache();
  httpStatus = 200;
  process.env.ALPHA_VANTAGE_API_KEY = "k";
  process.env.COINGLASS_API_KEY = "k";
  process.env.TICKATLAS_API_KEY = "k";
  process.env.TWELVE_DATA_API_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => ({
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    statusText: "x",
    text: async () => "",
    json: async () => responder(String(input)),
  }) as unknown as Response));
});
afterEach(() => { vi.unstubAllGlobals(); resetProviderCache(); });

// ── lib/json ─────────────────────────────────────────────────────
describe("227 lib/json — narrowing never fabricates", () => {
  it("asFiniteNumber: numbers & numeric strings only", () => {
    expect(asFiniteNumber(1.5)).toBe(1.5);
    expect(asFiniteNumber("  -2e3 ")).toBe(-2000);
    for (const bad of [NaN, Infinity, -Infinity, "", "-", "None", "abc", null, undefined, {}, [], true, "NaN", "Infinity"]) {
      expect(asFiniteNumber(bad), String(bad)).toBeUndefined();
    }
  });
  it("asString / asNonEmptyString / isRecord / field / asRecordArray", () => {
    expect(asString(1)).toBeUndefined();
    expect(asNonEmptyString("")).toBeUndefined();
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(field(null, "a")).toBeUndefined();
    expect(field("str", "length")).toBeUndefined();
    expect(asRecordArray([1, null, { a: 1 }, [2]])).toEqual([{ a: 1 }]);
    expect(asRecordArray({ a: 1 })).toEqual([]);
  });
  it("errorMessage handles Error, string, object, primitive", () => {
    expect(errorMessage(new Error("RATE_LIMIT:x"))).toBe("RATE_LIMIT:x");
    expect(errorMessage("s")).toBe("s");
    expect(errorMessage({ message: "m" })).toBe("m");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});

// ── Alpha Vantage ────────────────────────────────────────────────
describe("227 alphaVantage — news + fundamentals from unknown JSON", () => {
  const good = {
    feed: [{ title: "A", url: "https://x/a", time_published: "20250101T120000", source: "W",
      ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.4", relevance_score: "0.9", ticker_sentiment_label: "Bullish" }] }],
  };
  it("valid payload parses", async () => {
    responder = (u) => u.includes("NEWS") ? good : u.includes("OVERVIEW") ? { Symbol: "AAPL", Name: "Apple", MarketCapitalization: "12", PERatio: "None" } : { quarterlyEarnings: [{ fiscalDateEnding: "2025-03-31", reportedEPS: "1.5" }] };
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r.success).toBe(true);
    const a = r.sentiment!.articles[0];
    expect(a.sentimentScore).toBe(0.4);
    expect(a.relevanceScore).toBe(0.9);
    expect(a.publishedAt).toBeGreaterThan(0);
    expect(r.fundamentals!.available).toBe(true);
    expect(r.fundamentals!.marketCap).toBe(12);
    expect(r.fundamentals!.latestEarnings?.date).toBe("2025-03-31");
  });
  it.each([null, "string", 42, [], { feed: "nope" }, { feed: [1, null, "x"] }])("malformed news payload %j → no articles, no crash", async (payload) => {
    responder = (u) => u.includes("NEWS") ? payload : {};
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r.dataAvailable?.news).toBe(false);
  });
  it("items missing title/url are dropped; wrong-type score is undefined, not NaN", async () => {
    responder = (u) => u.includes("NEWS") ? { feed: [
      { title: "no url" }, { url: "https://x" },
      { title: "T", url: "https://x/t", overall_sentiment_score: "abc", time_published: 12345 },
      { title: "U", url: "https://x/u", overall_sentiment_score: { v: 1 }, ticker_sentiment: "not-array" },
    ] } : {};
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    const arts = r.sentiment!.articles;
    expect(arts.map((x) => x.title).sort()).toEqual(["T", "U"]);
    for (const x of arts) {
      expect(x.sentimentScore).toBeUndefined();
      expect(Number.isNaN(x.sentimentScore as number)).toBe(false);
      expect(x.publishedAt).toBe(0); // invalid / non-string timestamp → sentinel, never Date.now()
    }
  });
  it("fundamentals: Symbol missing or non-string → unavailable; malformed earnings ignored", async () => {
    responder = (u) => u.includes("NEWS") ? {} : u.includes("OVERVIEW") ? { Symbol: 123 } : "junk";
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r.fundamentals?.available ?? false).toBe(false);
    responder = (u) => u.includes("NEWS") ? {} : u.includes("OVERVIEW") ? { Symbol: "AAPL", MarketCapitalization: "Infinity" } : { quarterlyEarnings: "x" };
    resetProviderCache();
    const r2 = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r2.fundamentals!.available).toBe(true);
    expect(r2.fundamentals!.marketCap).toBeUndefined();
    expect(r2.fundamentals!.latestEarnings).toBeUndefined();
  });
  it("rate-limit Note is still detected on an unknown payload", async () => {
    responder = () => ({ Note: "Thank you for using Alpha Vantage! rate" });
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r.errorCode).toBe("RATE_LIMIT");
  });
  it("relatedTicker filter still selects the matching ticker sentiment", async () => {
    responder = (u) => u.includes("NEWS") ? { feed: [{ title: "A", url: "https://x", ticker_sentiment: [
      { ticker: "MSFT", ticker_sentiment_score: "0.9" }, { ticker: "AAPL", ticker_sentiment_score: "-0.3" }] }] } : {};
    const r = await av(ctx, { instrument: "AAPL", instrumentType: "stock" });
    expect(r.sentiment!.articles[0].sentimentScore).toBe(-0.3);
  });
});

// ── CoinGlass ────────────────────────────────────────────────────
describe("227 coinglass — derivatives from unknown JSON", () => {
  function route(map: Record<string, unknown>) {
    responder = (u) => {
      for (const k of Object.keys(map)) if (u.includes(k)) return map[k];
      return {};
    };
  }
  it("valid payload parses every leg", async () => {
    route({
      openInterest: { code: "0", data: [{ openInterest: "900" }, { openInterest: "1000" }] },
      fundingRate: { code: 0, data: [{ symbol: "BTC", data: { currentRate: "0.0001", predictedRate: 0.0002, exchangeList: [{ exchange: "Binance", data: { currentRate: "0.0003" } }, { exchange: "Bad", rate: "x" }] } }] },
      longShort: { code: "0", data: [{ longShortRatio: 1.2, data: { takerBuySellRatio: "0.8" } }] },
      liquidation: { code: "0", data: [{ longLiquidation: 10, shortLiquidation: "40" }] },
    });
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.data!.openInterest).toEqual({ current: 1000, change1h: 11.11 });
    expect(r.data!.fundingRate!.currentRate).toBe(0.0001);
    expect(r.data!.fundingRate!.weightedRate).toBe(0.0002);
    expect(r.data!.fundingRate!.exchanges).toEqual([{ name: "Binance", rate: 0.0003 }]);
    expect(r.data!.longShort).toEqual({ accountRatio: 1.2, takerRatio: 0.8 });
    expect(r.data!.liquidations).toMatchObject({ totalVolume: 50, dominantSide: "shorts" });
    expect(r.data!.confidence).toBe("high");
  });
  it.each([null, "str", 7, true, { code: "0", data: "nope" }, { code: "0", data: 5 }, { code: "0", data: [1, "x", null] }, { code: "0", data: {} }])(
    "malformed payload %j → every leg unavailable, no crash", async (payload) => {
      responder = () => payload;
      const r = await cg(ctx, { instrument: "BTC/USD" });
      expect(r.success).toBe(true);
      expect(r.data!.confidence).toBe("unavailable");
      expect(r.data!.openInterest).toBeUndefined();
      expect(r.data!.fundingRate).toBeUndefined();
      expect(r.data!.longShort).toBeUndefined();
      expect(r.data!.liquidations).toBeUndefined();
    });
  it("missing numeric field is UNAVAILABLE, not a 0 reading (old parseFloat(x||\"0\") defect)", async () => {
    route({
      fundingRate: { code: "0", data: [{ symbol: "BTC", data: { exchangeList: [] } }] },
      longShort: { code: "0", data: [{ longShortRatio: "abc", data: { takerBuySellRatio: NaN } }] },
      liquidation: { code: "0", data: [{ foo: 1 }] },
      openInterest: { code: "0", data: [{ openInterest: "Infinity" }] },
    });
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.fundingRate).toBeUndefined();
    expect(r.data!.longShort).toBeUndefined();
    expect(r.data!.liquidations).toBeUndefined();
    expect(r.data!.openInterest).toBeUndefined();
  });
  it("funding: entry for a different symbol is not silently preferred over ours", async () => {
    route({ fundingRate: { code: "0", data: [{ symbol: "ETH", currentRate: 0.9 }, { symbol: "BTCUSDT", currentRate: 0.1 }] } });
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.symbol).toBe("BTC");
    expect(r.data!.fundingRate!.currentRate).toBe(0.1);
  });
  it("non-zero code with a non-string msg does not throw a TypeError at the boundary", async () => {
    // Phase 228 closed the §227 follow-up: the leg no longer swallows the
    // classification, so a code-429 body is now a RATE_LIMIT envelope
    // (asserted in depth in coinglass-legs.phase228.test.ts).
    responder = () => ({ code: 429, msg: { nested: true } });
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
  });
});

// ── TickAtlas ────────────────────────────────────────────────────
describe("227 tradingEconomics — calendar from unknown JSON", () => {
  const soon = new Date(Date.now() + 36e5).toISOString();
  it("valid payload in both container shapes", async () => {
    responder = (u) => u.includes("from=" + new Date().toISOString().slice(0, 10))
      ? { success: true, data: { events: [{ id: 1, event: "CPI", currency: "USD", datetime: soon, impact: "High", actual: "3.1", forecast: "3.0%" }] } }
      : { data: [] };
    const r = await te(ctx, { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.success).toBe(true);
    const e = r.data!.events.find((x) => x.event === "CPI")!;
    expect(e.id).toBe("1");
    expect(e.actual).toBe(3.1);
    expect(e.importance).toBe(3);
  });
  it.each([null, "s", 9, [], { success: true, data: { events: "x" } }, { data: { events: [{}] } }, { data: [null, 1, "a", []] }, { success: true, data: { events: [null, 1, "a", []] } }])(
    "malformed %j → empty calendar, no crash", async (payload) => {
      responder = () => payload;
      const r = await te(ctx, { instrument: "EUR/USD", instrumentType: "forex" });
      expect(r.success).toBe(true);
      expect(r.data!.events).toEqual([]);
    });
  it("missing name / invalid or non-string timestamp / object cells → event dropped or undefined, never fabricated", async () => {
    responder = () => ({ data: [
      { id: "a", currency: "USD", datetime: soon },                       // no event name
      { id: "b", event: "X", currency: "USD", datetime: "not a date" },    // unparseable
      { id: "c", event: "Y", currency: "USD", datetime: { when: soon } },  // wrong type
      { id: "d", event: "Z", currency: "USD" },                            // missing → no Date.now()
      { id: { o: 1 }, event: "W", currency: "USD", datetime: soon, actual: { v: 1 }, impact: 3, url: 5 },
    ] });
    const r = await te(ctx, { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.data!.events.map((e) => e.event)).toEqual(["W"]);
    const w = r.data!.events[0];
    expect(w.actual).toBeUndefined();
    expect(w.importance).toBe(1);
    expect(w.id).toMatch(/^ta-/);
  });
  it("a null row in the past-events array does not abort the valid released events after it", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(Date.now() - 2 * 864e5).toISOString();
    responder = (u) => u.includes(`to=${today}`)
      ? { data: [null, "junk", { id: "nfp", event: "NFP", currency: "USD", datetime: past, impact: "High", actual: "200" }] }
      : { data: [] };
    const r = await te(ctx, { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.data!.events.map((e) => e.id)).toEqual(["nfp"]);
  });
  it("instrument mismatch: events for currencies outside the pair are filtered out", async () => {
    responder = () => ({ data: [{ id: "j", event: "Tankan", currency: "JPY", datetime: soon }, { id: "u", event: "NFP", currency: "USD", datetime: soon }] });
    const r = await te(ctx, { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.data!.events.map((e) => e.currency)).toEqual(["USD"]);
  });
});

// ── Twelve Data OHLCV (liveProtection) ───────────────────────────
describe("227 liveProtection.fetchOHLCVCandles — candles from unknown JSON", () => {
  const args = { instruments: ["EUR/USD"], timeframes: ["H1"] };
  it("valid payload", async () => {
    responder = () => ({ values: [{ datetime: "2025-01-01 10:00:00", open: "1", high: "2", low: "0.5", close: "1.5", volume: "9" }] });
    const [r] = await ohlcv(ctx, args);
    expect(r.success).toBe(true);
    expect(r.sourceMode).toBe("LIVE");
    expect(r.candles[0].open).toBe(1);
    expect(r.candles[0].volume).toBe(9);
  });
  it.each([null, "x", 3, [], { values: "abc" }, { values: [null, 1, "s"] }, { status: "error", message: 5 }])(
    "malformed %j → UNAVAILABLE, never LIVE", async (payload) => {
      responder = () => payload;
      const [r] = await ohlcv(ctx, args);
      expect(r.success).toBe(false);
      expect(r.sourceMode).toBe("UNAVAILABLE");
      expect(r.candles).toEqual([]);
      // A non-array `values` is rejected at the boundary with a reason (an
      // array of invalid rows just yields zero candles, unchanged behavior).
      if (!Array.isArray(field(payload, "values"))) expect(typeof r.error).toBe("string");
    });
  it("candles with missing/NaN/Infinity price, non-positive price or bad datetime are dropped (no zero, no Date.now())", async () => {
    const before = Date.now();
    responder = () => ({ values: [
      { datetime: "2025-01-01 10:00:00", open: "1", high: "2", low: "0.5" },                      // missing close
      { datetime: "2025-01-01 11:00:00", open: "NaN", high: "2", low: "0.5", close: "1" },
      { datetime: "2025-01-01 12:00:00", open: "Infinity", high: "2", low: "0.5", close: "1" },
      { datetime: "2025-01-01 13:00:00", open: 0, high: "2", low: "0.5", close: "1" },
      { datetime: "garbage", open: "1", high: "2", low: "0.5", close: "1" },
      { datetime: { d: 1 }, open: "1", high: "2", low: "0.5", close: "1" },
      { open: "1", high: "2", low: "0.5", close: "1" },                                           // missing datetime
      { datetime: "2025-01-01 14:00:00", open: "1", high: "2", low: "0.5", close: "1", volume: "abc" },
    ] });
    const [r] = await ohlcv(ctx, args);
    expect(r.candles).toHaveLength(1);
    expect(r.candles[0].volume).toBe(0);
    expect(r.candles[0].timestamp).toBeLessThan(before);
  });
});

// ── structural: the boundaries stay `unknown` ────────────────────
describe("227 structural — no any at provider boundaries in src/convex", () => {
  it.each(["alphaVantage", "coinglass", "tradingEconomics", "liveProtection", "marketData"])("src/convex/%s.ts", (m) => {
    const src = readFileSync(`src/convex/${m}.ts`, "utf8");
    expect(src).not.toMatch(/:\s*any\b|as any\b|<any>|any\[\]/);
    expect(src).not.toMatch(/eslint-disable|@ts-ignore|@ts-expect-error/);
  });
  it("fetch wrappers return Promise<unknown>", () => {
    expect(readFileSync("src/convex/alphaVantage.ts", "utf8")).toMatch(/avFetch\([^)]*\): Promise<unknown>/);
    expect(readFileSync("src/convex/coinglass.ts", "utf8")).toMatch(/cgFetch\([^)]*\): Promise<unknown>/);
    expect(readFileSync("src/convex/tradingEconomics.ts", "utf8")).toMatch(/taFetch\([^)]*\): Promise<unknown>/);
    expect(readFileSync("src/convex/liveProtection.ts", "utf8")).toMatch(/const data: unknown = await res\.json\(\)/);
  });
});
