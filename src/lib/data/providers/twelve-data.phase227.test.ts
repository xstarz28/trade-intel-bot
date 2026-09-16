/**
 * Phase 227 — TwelveDataProvider parses `unknown` JSON.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwelveDataProvider } from "./twelve-data";

let payload: unknown = {};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "", json: async () => payload }) as unknown as Response));
});
afterEach(() => vi.unstubAllGlobals());
const p = () => new TwelveDataProvider({ apiKey: "k" });
const TS = 1_735_732_800; // 2025-01-01T12:00:00Z

describe("fetchCandles", () => {
  it("valid rows parse and are returned oldest-first", async () => {
    payload = { values: [
      { datetime: "2025-01-01 11:00:00", open: "2", high: "3", low: "1", close: "2.5", volume: "7" },
      { datetime: "2025-01-01 10:00:00", open: "1", high: "2", low: "0.5", close: "1.5" },
    ] };
    const c = await p().fetchCandles("EUR/USD", "H1", 2);
    expect(c.map((x) => x.open)).toEqual([1, 2]);
    expect(c[0].volume).toBe(0);
    expect(c[1].volume).toBe(7);
    expect(c[0].timestamp).toBeLessThan(c[1].timestamp);
  });
  it.each([null, "s", 1, [], { values: "x" }, { values: [null, 1] }, { values: [{ open: "1" }],  },
    { values: [{ datetime: "2025-01-01 10:00:00", open: "1", high: "2", low: "0.5" }] },
    { values: [{ datetime: "2025-01-01 10:00:00", open: "1", high: "2", close: "0.5" }] },
    { values: [{ datetime: "2025-01-01 10:00:00", open: "1", low: "2", close: "0.5" }] }])("malformed %j → throws 'No candle data', never NaN candles", async (v) => {
    payload = v;
    await expect(p().fetchCandles("EUR/USD", "H1", 1)).rejects.toThrow(/No candle data/);
  });
  it("NaN / Infinity / non-string datetime / garbage datetime rows are dropped", async () => {
    payload = { values: [
      { datetime: "2025-01-01 10:00:00", open: "NaN", high: "2", low: "0.5", close: "1.5" },
      { datetime: "2025-01-01 10:00:00", open: "Infinity", high: "2", low: "0.5", close: "1.5" },
      { datetime: { d: 1 }, open: "1", high: "2", low: "0.5", close: "1.5" },
      { datetime: "yesterday-ish", open: "1", high: "2", low: "0.5", close: "1.5" },
      { datetime: "2025-01-01 10:00:00", open: "1", high: "2", low: "0.5", close: "1.5" },
    ] };
    const c = await p().fetchCandles("EUR/USD", "H1", 5);
    expect(c).toHaveLength(1);
    for (const k of ["open", "high", "low", "close", "timestamp"] as const) expect(Number.isFinite(c[0][k])).toBe(true);
  });
  it("error envelope with non-string message still throws a readable error", async () => {
    payload = { code: 429, message: { x: 1 }, status: "error" };
    await expect(p().fetchCandles("EUR/USD", "H1", 1)).rejects.toThrow(/Twelve Data error 429/);
  });
});

describe("fetchPrice", () => {
  it("valid quote: price from close, timestamp from the provider (seconds → ms), bid/ask optional", async () => {
    payload = { close: "1.0850", timestamp: TS, bid: "1.0849", ask: "x" };
    const q = await p().fetchPrice("EUR/USD");
    expect(q).toEqual({ price: 1.085, timestamp: TS * 1000, source: "twelve-data", bid: 1.0849, ask: undefined });
  });
  it("timestamp is the provider's, not the request clock", async () => {
    payload = { close: "1", timestamp: TS };
    const before = Date.now();
    const q = await p().fetchPrice("EUR/USD");
    expect(q.timestamp).toBe(TS * 1000);
    expect(q.timestamp).toBeLessThan(before);
  });
  it.each([null, "s", [], {}, { close: "abc", timestamp: TS }, { close: NaN, timestamp: TS }, { close: "1" }, { close: "1", timestamp: "nope" }, { close: "1", timestamp: 0 }, { close: "1", timestamp: TS * 1000 }])(
    "malformed quote %j → throws (no zero price, no Date.now())", async (v) => {
      payload = v;
      await expect(p().fetchPrice("EUR/USD")).rejects.toThrow();
    });
});
