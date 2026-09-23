/**
 * Phase 227 — crypto intelligence adapters parse provider JSON as `unknown`.
 * DeFiLlama / Tokenomist adapters are driven through their injected fetch;
 * the pure parse* functions are fed malformed envelopes directly.
 */
import { describe, expect, it } from "vitest";
import { DeFiLlamaAdapter, parseDeFiLlamaResult } from "./defillama-adapter";
import { TokenomistAdapter, parseTokenomistResult } from "./tokenomist-adapter";
import { CoinGlassAdapter, parseCoinGlassResult } from "./coinglass-adapter";

const http = (route: (url: string) => unknown, ok = true) =>
  (async (input: unknown) => ({ ok, status: ok ? 200 : 500, json: async () => route(String(input)) })) as unknown as typeof fetch;

const DAY = 86400;
const T0 = 1_735_689_600; // 2025-01-01 (unix s)

describe("227 DeFiLlama", () => {
  it("valid history + fees", async () => {
    const a = new DeFiLlamaAdapter(http((u) => u.includes("historicalChainTvl")
      ? [{ date: T0 - 30 * DAY, tvl: 80 }, { date: T0 - 7 * DAY, tvl: 90 }, { date: T0, tvl: 99 }]
      : { total24h: 5 }));
    const r = await a.fetch("ETH/USD");
    expect(r!.success).toBe(true);
    const d = parseDeFiLlamaResult(r!.data, "ETH/USD", 1);
    expect(d.quality).toBe("VERIFIED");
    expect(d.tvl).toMatchObject({ current: 99, change7d: 10, change30d: 23.75, reliable: true });
    expect(d.fees).toMatchObject({ dailyFees: 5, dailyRevenue: 0.5, reliable: true });
  });
  it.each([null, "s", 3, {}, { data: [] }, [null, 1, "x"], [{ date: "abc", tvl: "NaN" }], [{ tvl: 5 }], [{ date: T0 }]])(
    "malformed TVL history %j → no TVL dataset (never a 0 TVL)", async (hist) => {
      const a = new DeFiLlamaAdapter(http((u) => u.includes("historicalChainTvl") ? hist : "junk"));
      const r = await a.fetch("ETH/USD");
      expect(r!.success).toBe(false);
      const d = parseDeFiLlamaResult(r!.data, "ETH/USD", 1);
      expect(d.tvl).toBeUndefined();
      expect(d.fees).toBeUndefined();
      expect(d.available).toBe(false);
    });
  it("fees: non-numeric / Infinity total24h → no fees dataset", async () => {
    for (const v of ["abc", Infinity, NaN, null, { x: 1 }]) {
      const a = new DeFiLlamaAdapter(http((u) => u.includes("fees") ? { total24h: v } : []));
      const d = parseDeFiLlamaResult((await a.fetch("ETH/USD"))!.data, "ETH/USD", 1);
      expect(d.fees, String(v)).toBeUndefined();
    }
  });
  it("mixed rows: invalid points are skipped, the latest VALID point is used", async () => {
    const a = new DeFiLlamaAdapter(http((u) => u.includes("historicalChainTvl")
      ? [{ date: T0 - 7 * DAY, tvl: 50 }, { date: T0, tvl: 100 }, { date: T0 + DAY, tvl: "oops" }, null]
      : {}));
    const d = parseDeFiLlamaResult((await a.fetch("ETH/USD"))!.data, "ETH/USD", 1);
    expect(d.tvl).toMatchObject({ current: 100, change7d: 100 });
  });
  it.each([null, "x", 7, [], { tvl: "str", fees: 1 }, { tvl: { current: "NaN" }, fees: { dailyFees: "abc" } }])("parseDeFiLlamaResult(%j) never throws, never reliable", (v) => {
    const d = parseDeFiLlamaResult(v, "ETH/USD", 1);
    expect(d.available).toBe(false);
    expect(d.tvl?.reliable ?? false).toBe(false);
    expect(d.fees?.reliable ?? false).toBe(false);
  });
});

describe("227 Tokenomist", () => {
  const soon = new Date(Date.now() + 5 * DAY * 1000).toISOString();
  it("valid unlocks + supply", async () => {
    const a = new TokenomistAdapter(http((u) => u.includes("unlocks")
      ? { data: [{ unlock_date: soon, amount: "100" }, { date: soon, amount: 50 }, { unlock_date: "2000-01-01", amount: 999 }] }
      : { circulating_supply: "1000", total_supply: 2000 }));
    const d = parseTokenomistResult((await a.fetch("SOL/USD"))!.data, "SOL/USD", 1);
    expect(d.quality).toBe("VERIFIED");
    expect(d.unlocks).toMatchObject({ upcomingCount30d: 2, upcomingValue30d: 150, unlockPercentOfCirculating: 15 });
    expect(d.supply).toMatchObject({ circulatingSupply: 1000, totalSupply: 2000, circulatingPercent: 50, reliable: true });
  });
  it("malformed unlock rows: object/absent dates and non-numeric amounts do not count or crash", async () => {
    // `{ d: 1 }` as a date: `new Date(object)` is `Invalid Date` in most
    // engines but a Date-like object could coerce — the row must be rejected
    // on TYPE, so we use an object whose valueOf() lands inside the window.
    const coercible = { valueOf: () => Date.now() + 3 * DAY * 1000 };
    const a = new TokenomistAdapter(http((u) => u.includes("unlocks")
      ? { data: [null, 5, { unlock_date: coercible, amount: "100" }, { amount: "100" }, { unlock_date: soon, amount: "abc" }, { unlock_date: soon, amount: Infinity }, { unlock_date: soon, amount: "7" }] }
      : "nope"));
    const d = parseTokenomistResult((await a.fetch("SOL/USD"))!.data, "SOL/USD", 1);
    expect(d.unlocks).toMatchObject({ upcomingCount30d: 3, upcomingValue30d: 7 });
    expect(d.supply).toBeUndefined();
  });
  it.each([null, "s", [], { data: "x" }])("malformed unlocks envelope %j → zero events, not a crash", async (v) => {
    const a = new TokenomistAdapter(http((u) => u.includes("unlocks") ? v : null));
    const d = parseTokenomistResult((await a.fetch("SOL/USD"))!.data, "SOL/USD", 1);
    expect(d.unlocks?.upcomingCount30d).toBe(0);
  });
  it("supply: NaN/negative/string garbage → undefined fields, reliable=false", async () => {
    const a = new TokenomistAdapter(http((u) => u.includes("supply") ? { circulating_supply: "NaN", total_supply: -5 } : []));
    const d = parseTokenomistResult((await a.fetch("SOL/USD"))!.data, "SOL/USD", 1);
    expect(d.supply).toEqual({ circulatingSupply: undefined, totalSupply: undefined, circulatingPercent: undefined, reliable: false });
  });
  it.each([null, "x", 7, [], { supply: 3, unlocks: "s" }])("parseTokenomistResult(%j) never throws", (v) => {
    const d = parseTokenomistResult(v, "SOL/USD", 1);
    expect(d.available).toBe(false);
    expect(d.supply).toBeUndefined();
    expect(d.unlocks).toBeUndefined();
  });
});

describe("227 CoinGlass adapter", () => {
  it("unknown errorCode from the thunk is normalized to NO_DATA (not cast through)", async () => {
    const a = new CoinGlassAdapter(async () => ({ success: false, errorCode: "WEIRD", error: "x" }));
    const r = await a.fetch("BTC/USD");
    expect(r!.errorCode).toBe("NO_DATA");
    const b = new CoinGlassAdapter(async () => ({ success: false, errorCode: "RATE_LIMIT" }));
    expect((await b.fetch("BTC/USD"))!.errorCode).toBe("RATE_LIMIT");
  });
  it.each([null, "x", 7, [], { availability: "yes" }, { availability: { openInterest: "true" } }])("parseCoinGlassResult(%j) → unavailable, never throws", (v) => {
    const d = parseCoinGlassResult(v, "BTC/USD", 1);
    expect(d.available).toBe(false);
    expect(d.availableDatasets).toBe(0);
  });
  it("wrong-typed leg fields → reliable=false, NaN never leaks", () => {
    const d = parseCoinGlassResult({
      availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
      openInterest: { current: "NaN" }, fundingRate: { currentRate: "abc" }, liquidations: { totalVolume: Infinity, dominantSide: "sideways" }, longShort: { accountRatio: null },
      freshness: 42,
    }, "BTC/USD", 1);
    expect(d.openInterest).toMatchObject({ current: 0, reliable: false });
    expect(d.fundingRate).toMatchObject({ currentRate: 0, reliable: false, isExtreme: false });
    expect(d.liquidation).toMatchObject({ totalVolume: undefined, dominantSide: undefined, reliable: false });
    expect(d.positioning).toMatchObject({ accountRatio: undefined, reliable: false });
    expect(d.freshness).toBe("UNAVAILABLE");
    for (const v of Object.values({ ...d.openInterest, ...d.fundingRate, ...d.liquidation, ...d.positioning })) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });
  it("numeric strings are accepted for reliability, matching the Convex action's own coercion", () => {
    const d = parseCoinGlassResult({ availability: { openInterest: true }, openInterest: { current: "1000" } }, "BTC/USD", 1);
    expect(d.openInterest).toMatchObject({ current: 1000, reliable: true });
  });
});
