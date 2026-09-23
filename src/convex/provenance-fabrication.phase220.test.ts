/**
 * Phase 220 — final provenance-fabrication sweep of the MOUNTED
 * intelligence/protection surfaces.
 *
 * Scope was derived from the executable import graph rooted at src/main.tsx
 * (176 modules), not from an inventory file. Every timestamp reaching a
 * mounted surface was traced to its origin and classified. Four genuine
 * defects and one state-machine gap were found; each is reproduced here by
 * driving the REAL exported handler with a mocked provider.
 *
 * E1  alphaVantage.normalizeNewsFromAV — `time_published ? parse : Date.now()`
 *     stamped undated articles "published now", and an unparseable value
 *     produced NaN. publishedAt is now 0 (the sentinel the Phase 218 feed
 *     already renders UNAVAILABLE) for both.
 *
 * E2  marketData.fetchMarketData — `price.timestamp: Date.now()` labelled the
 *     REQUEST clock as "when the price was last updated". Twelve Data's
 *     /quote carries its own `timestamp` (UNIX s); a quote the provider
 *     dated 3h earlier graded FRESH in the radar and passed the engine's
 *     Gate 0 staleness check. The provider time is now used, falling back to
 *     the last candle's own datetime — never the request clock.
 *
 * E3  liveProtection.fetchOHLCVCandles + technical-indicators.validateCandle —
 *     `new Date(v.datetime).getTime()` emitted NaN for an unparseable
 *     datetime, and `raw.timestamp <= 0` is false for NaN, so the candle
 *     survived normalisation with no position in time. Both layers now drop
 *     it.
 *
 * E4  Dashboard universal-intelligence assembly — `meta()` stamped every
 *     provider dataset `observedAt: now, freshness: "FRESH"`, discarding the
 *     FRESH/DELAYED/STALE the Treasury/CFTC/EIA/calendar modules had already
 *     derived from their own observation dates. A week-old COT report
 *     rendered FRESH in AnalysisResult. The provider's classification is now
 *     carried through.
 *
 * S1  stream-orchestrator cursor — a non-finite timestamp reached the
 *     cursor. +Infinity permanently suppressed every later genuine quote
 *     (Phase 219's failure mode without the ×1000). Non-finite timestamps
 *     are now dropped before the cursor.
 *
 * Audited and deliberately unchanged (B/C/D): CoinGecko/TwelveData receipt
 * stamping in liveProtection (documented), coinglass/tradingEconomics
 * envelope `timestamp` (fetch time by contract, not derived freshness),
 * provider-cache observedAt, OKX discovery acquiredAt, registration LIVE
 * lifecycle state, runtime-health/log event times, market-radar
 * assessFreshness (already maps 0/undefined/future to UNAVAILABLE), the
 * universal live client (validateOhlcvSeries rejects non-finite/future), and
 * the market-radar OKX/Treasury adapters' `?? Date.now()` (proven unmounted:
 * `acquireLiveData` has no caller outside its own file).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchIntelligence } from "./alphaVantage";
import { fetchMarketData, resolveProviderPriceTimestamp } from "./marketData";
import { fetchOHLCVCandles } from "./liveProtection";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { classifyNewsFreshness } from "../lib/position-protection/news-intelligence";
import { assessFreshness } from "../lib/market-radar/freshness";
import { validateCandle, normalizeCandles } from "../lib/position-protection/technical-indicators";
import {
  createOrchestratorState,
  registerPosition,
  registerSymbolMapping,
  processStreamEvent,
} from "../lib/market-stream/stream-orchestrator";
import type { StreamEvent } from "../lib/market-stream/types";

// ── Harness ────────────────────────────────────────────────────

const ctx = () =>
  ({ auth: { getUserIdentity: async () => ({ subject: "user_A", issuer: "test" }) } }) as never;
const handlerOf = <A, R>(a: unknown) =>
  (a as { _handler: (c: never, x: A) => Promise<R> })._handler;

type Article = { title: string; publishedAt: number };
type IntelResult = { sentiment?: { articles: Article[] } };
type MarketResult = { success: boolean; data: { price: { timestamp: number }; candles: { timestamp: number }[] } };
type OhlcvResult = { instrument: string; candles: { timestamp: number; close: number }[]; success: boolean }[];

const callIntel = handlerOf<{ instrument: string; instrumentType: string }, IntelResult>(fetchIntelligence);
const callMarket = handlerOf<{ instrument: string; instrumentType: string; timeframe: string }, MarketResult>(fetchMarketData);
const callOhlcv = handlerOf<{ instruments: string[]; timeframes: string[]; outputsize: number }, OhlcvResult>(fetchOHLCVCandles);

const HOUR = 3_600_000;
const CANDLES = Array.from({ length: 210 }, (_, i) => ({
  datetime: new Date(Date.now() - (210 - i) * HOUR).toISOString(),
  open: "1", high: "1.1", low: "0.9", close: "1", volume: "1",
}));

function stub(responder: (url: string) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (u: unknown) => ({ ok: true, status: 200, json: async () => responder(String(u)) }) as unknown as Response));
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

beforeEach(() => {
  resetProviderCache();
  process.env.ALPHA_VANTAGE_API_KEY = "test-key";
  process.env.TWELVE_DATA_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

// ── E1 ─────────────────────────────────────────────────────────

describe("Phase 220 E1 — an article without a provider publication time is not 'published now'", () => {
  const feed = (items: Record<string, unknown>[]) => () => ({ feed: items });

  it("missing, null, empty and unparseable time_published all yield the 0 sentinel", async () => {
    stub(feed([
      { title: "missing", url: "u1", source: "s" },
      { title: "null", url: "u2", source: "s", time_published: null },
      { title: "empty", url: "u3", source: "s", time_published: "" },
      { title: "junk", url: "u4", source: "s", time_published: "yesterday-ish" },
      { title: "short", url: "u5", source: "s", time_published: "2026" },
    ]));
    const r = await callIntel(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    const arts = r.sentiment?.articles ?? [];
    expect(arts).toHaveLength(5);
    for (const a of arts) {
      expect(a.publishedAt).toBe(0);
      expect(Number.isNaN(a.publishedAt)).toBe(false);
    }
  });

  it("the sentinel is what the Phase 218 feed guard treats as no provider timestamp", () => {
    // PositionProtectionDashboard: `art.publishedAt ? ... : null` → UNAVAILABLE.
    const publishedAt = 0;
    const hasProviderTimestamp = publishedAt ? Number.isFinite(publishedAt) : false;
    expect(hasProviderTimestamp).toBe(false);
  });

  it("a genuine time_published still classifies by real age", async () => {
    const d = new Date(Date.now() - 30 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const av = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    stub(feed([{ title: "real", url: "u", source: "s", time_published: av }]));
    const r = await callIntel(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    const a = r.sentiment!.articles[0];
    expect(Math.abs(a.publishedAt - d.getTime())).toBeLessThan(1_000);
    expect(classifyNewsFreshness(a.publishedAt, Date.now())).toBe("FRESH");
  });

  it("no longer substitutes the local clock and never returns NaN", () => {
    const code = codeOnly(read("src/convex/alphaVantage.ts"));
    expect(code).not.toMatch(/time_published\s*\?\s*parseAVTime\([^)]*\)\s*:\s*Date\.now\(\)/);
    const fn = code.slice(code.indexOf("function parseAVTime"), code.indexOf("function safeNum"));
    expect(fn).not.toContain("Date.now()");
    expect(fn).toMatch(/Number\.isFinite\(ms\)\s*&&\s*ms\s*>\s*0\s*\?\s*ms\s*:\s*0/);
  });
});

// ── E2 ─────────────────────────────────────────────────────────

describe("Phase 220 E2 — the primary price snapshot carries the provider's time, not the request clock", () => {
  const market = (quote: Record<string, unknown>) => (u: string) =>
    u.includes("time_series") ? { values: [...CANDLES].reverse(), status: "ok" } : quote;

  it("a quote the provider dated 3h ago no longer grades FRESH", async () => {
    const sec = Math.floor(Date.now() / 1000) - 3 * 3600;
    stub(market({ close: "1.0850", timestamp: sec }));
    const r = await callMarket(ctx(), { instrument: "EUR/USD", instrumentType: "forex", timeframe: "1h" });
    expect(r.data.price.timestamp).toBe(sec * 1000);
    expect(assessFreshness(r.data.price.timestamp, Date.now())).toBe("STALE");
  });

  it("a genuinely current provider quote still grades FRESH", async () => {
    const sec = Math.floor(Date.now() / 1000) - 20;
    stub(market({ close: "1.0850", timestamp: String(sec) })); // numeric string form
    const r = await callMarket(ctx(), { instrument: "EUR/USD", instrumentType: "forex", timeframe: "1h" });
    expect(r.data.price.timestamp).toBe(sec * 1000);
    expect(assessFreshness(r.data.price.timestamp, Date.now())).toBe("FRESH");
  });

  it("without a provider quote time it falls back to the last candle's own datetime", async () => {
    stub(market({ close: "1.0850" }));
    const before = Date.now();
    const r = await callMarket(ctx(), { instrument: "EUR/USD", instrumentType: "forex", timeframe: "1h" });
    const lastCandle = r.data.candles[r.data.candles.length - 1].timestamp;
    expect(r.data.price.timestamp).toBe(lastCandle);
    // The last candle is ~1h old; the request clock would have been ≥ before.
    expect(r.data.price.timestamp).toBeLessThan(before - 30 * 60_000);
  });

  it("rejects null / NaN / negative / millisecond-scaled / far-future provider values", () => {
    const candle = Date.now() - HOUR;
    for (const bad of [null, undefined, NaN, -5, 0, "abc", Date.now() /* ms, not s */, 1e12, Infinity]) {
      expect(resolveProviderPriceTimestamp(bad, candle)).toBe(candle);
    }
    expect(resolveProviderPriceTimestamp(1_700_000_000, candle)).toBe(1_700_000_000_000);
    // No candle either → 0 sentinel, never the clock.
    expect(resolveProviderPriceTimestamp(undefined, NaN)).toBe(0);
  });

  it("the request clock is no longer written into price.timestamp", () => {
    const code = codeOnly(read("src/convex/marketData.ts"));
    expect(code).not.toContain('price: { price, timestamp: Date.now(), source: "twelve-data" }');
    expect(code).toContain("timestamp: priceTimestamp");
  });

  it("fetchFxRate does not stamp the request clock as the quote observation (E2 sibling)", () => {
    const code = codeOnly(read("src/convex/marketData.ts"));
    expect(code).not.toContain('timestamp: Date.now(), source: "twelve-data"');
    expect(code).toContain("providerQuoteTimestampMs");
    expect(code).toContain("malformed (quote has no provider timestamp)");
  });
});

// ── E3 ─────────────────────────────────────────────────────────

describe("Phase 220 E3 — a candle without a parseable provider datetime is dropped, not NaN-stamped", () => {
  it("the server drops it", async () => {
    stub(() => ({ status: "ok", values: [
      { datetime: "garbage", open: "1", high: "1.1", low: "0.9", close: "7", volume: "1" },
      { datetime: "", open: "1", high: "1.1", low: "0.9", close: "8", volume: "1" },
      ...[...CANDLES].reverse().slice(0, 5),
    ] }));
    const r = await callOhlcv(ctx(), { instruments: ["EUR/USD"], timeframes: ["H1"], outputsize: 7 });
    expect(r[0].success).toBe(true);
    expect(r[0].candles).toHaveLength(5);
    expect(r[0].candles.every((c) => Number.isFinite(c.timestamp) && c.timestamp > 0)).toBe(true);
  });

  it("the client validator rejects NaN, Infinity, 0 and negative timestamps", () => {
    const base = { open: 1, high: 1.1, low: 0.9, close: 1, volume: 1 };
    for (const t of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(validateCandle({ ...base, timestamp: t })).toBeNull();
    }
    expect(validateCandle({ ...base, timestamp: 1 })).not.toBeNull();
  });

  it("normalizeCandles therefore never yields an unordered series", () => {
    const now = Date.now();
    const mk = (i: number, close = 1) => ({ timestamp: now - i * HOUR, open: 1, high: 1.1, low: 0.9, close, volume: 1 });
    const out = normalizeCandles([mk(3), { ...mk(2), timestamp: NaN }, mk(1), { ...mk(0), timestamp: NaN, close: 999 }]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.timestamp)).toEqual([now - 3 * HOUR, now - HOUR]);
  });

  it("valid candles pass unchanged", async () => {
    stub(() => ({ status: "ok", values: [...CANDLES].reverse().slice(0, 5) }));
    const r = await callOhlcv(ctx(), { instruments: ["EUR/USD"], timeframes: ["H1"], outputsize: 5 });
    expect(r[0].candles).toHaveLength(5);
  });
});

// ── E4 ─────────────────────────────────────────────────────────

describe("Phase 220 E4 — the Universal Intelligence panel shows the provider's freshness, not an assembly-time FRESH", () => {
  const dash = read("src/pages/Dashboard.tsx");
  const code = codeOnly(dash);

  it("the shared meta() no longer asserts FRESH", () => {
    const meta = code.slice(code.indexOf("const meta = (provider: string)"), code.indexOf("const providerFresh"));
    expect(meta).not.toContain('"FRESH"');
    expect(meta).toContain('"UNAVAILABLE"');
  });

  it("Treasury, CFTC (both surfaces), EIA and calendar carry their own classification", () => {
    expect(code).toMatch(/providerFresh\(treasuryData\.freshness/);
    expect(code.match(/providerFresh\(cotData\.freshness/g)?.length).toBe(2);
    expect(code).toMatch(/providerFresh\(eiaData\.freshness/);
    expect(code).toMatch(/calendarFresh\(calendarResult\.data\.freshness\)/);
  });

  it("observedAt for those datasets is the provider observation date, never the assembly clock", () => {
    const fn = code.slice(code.indexOf("const providerFresh"), code.indexOf("const isoDayMs"));
    expect(fn).not.toContain("now");
    // A provider that reported no classification must not be promoted to FRESH.
    expect(fn).toMatch(/freshness:\s*f\s*\?\?\s*\("UNAVAILABLE"/);
    expect(fn).not.toMatch(/\?\?\s*\("FRESH"/);
    expect(fn).toMatch(/\(observedAt as number\)\s*>\s*0[\s\S]*?:\s*0,/);
  });

  it("the calendar scale maps without inventing a level", () => {
    const fn = code.slice(code.indexOf("const calendarFresh"), code.indexOf("let forexCtx"));
    expect(fn).toMatch(/"realtime"\s*\?\s*\("FRESH"/);
    expect(fn).toMatch(/"recent"\s*\?\s*\("DELAYED"/);
    expect(fn).toMatch(/"stale"\s*\?\s*\("STALE"/);
    expect(fn).toMatch(/:\s*\("UNAVAILABLE"/);
  });

  it("the provider modules still derive freshness from their own observation dates", () => {
    expect(codeOnly(read("src/lib/data/treasury.ts"))).toMatch(/classifyMacroFreshness\(latestNominal\.observationDate/);
    expect(codeOnly(read("src/lib/data/cot.ts"))).toMatch(/classifyCotFreshness\(latest\.reportDate/);
    expect(codeOnly(read("src/lib/data/eia.ts"))).toMatch(/classifyEiaFreshness\(series\[0\]\.observationDate/);
  });
});

// ── S1 ─────────────────────────────────────────────────────────

describe("Phase 220 S1 — a non-finite timestamp cannot reach the cursor or suppress later real quotes", () => {
  const mk = (ts: number, price: number): StreamEvent => ({
    eventId: `e-${price}-${String(ts)}`, provider: "OKX", instrument: "BTC/USDT", providerSymbol: "BTC-USDT",
    assetClass: "crypto", eventType: "QUOTE", timestamp: ts, receivedAt: Date.now(), freshness: "FRESH",
    dependencyGroup: "g", payload: { price },
  }) as StreamEvent;
  const seeded = (now: number) => {
    let st = createOrchestratorState();
    st = registerSymbolMapping(st, { canonical: "BTC/USDT", providerSymbol: "BTC-USDT", provider: "OKX", assetClass: "crypto", quoteCurrency: "USDT", validated: true });
    return registerPosition(st, { positionId: "p1", instrument: "BTC/USDT", side: "LONG", entryPrice: 60_000, stopLoss: 55_000, takeProfit: 70_000, leverage: 1, horizon: "SWING", openedAt: now, lifecycle: "MONITORING" }, now);
  };

  it.each([["+Infinity", Infinity], ["-Infinity", -Infinity], ["NaN", NaN]])("%s is dropped and leaves no cursor", (_l, bad) => {
    const now = Date.now();
    const r = processStreamEvent(seeded(now), mk(bad, 61_000), now);
    expect(r.state.totalEventsDropped).toBe(1);
    expect(r.state.cursors.has("OKX:BTC/USDT")).toBe(false);
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(60_000);
  });

  it("after a non-finite event, later genuine quotes are still applied", () => {
    const now = Date.now();
    let r = processStreamEvent(seeded(now), mk(Infinity, 61_000), now);
    r = processStreamEvent(r.state, mk(now + 30_000, 50_000), now + 30_000);
    r = processStreamEvent(r.state, mk(now + 60_000, 45_000), now + 60_000);
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(45_000);
    expect(r.state.totalEventsDropped).toBe(1);
    expect(r.state.cursors.get("OKX:BTC/USDT")!.lastTimestamp).toBe(now + 60_000);
  });

  it("genuine out-of-order protection is untouched", () => {
    const now = Date.now();
    let r = processStreamEvent(seeded(now), mk(now + 60_000, 50_000), now + 60_000);
    r = processStreamEvent(r.state, mk(now + 30_000, 99_000), now + 61_000); // older → dropped
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(50_000);
    expect(r.state.totalEventsDropped).toBe(1);
  });

  it("the guard sits before the cursor read", () => {
    const code = codeOnly(read("src/lib/market-stream/stream-orchestrator.ts"));
    const guard = code.indexOf("Number.isFinite(normalized.timestamp)");
    const cursor = code.indexOf("state.cursors.get(cursorKey)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(cursor);
  });
});

// ── B/C/D invariants that must stay ────────────────────────────

describe("Phase 220 — receipt-time-by-policy and lifecycle paths are left alone", () => {
  it("liveProtection CoinGecko/TwelveData still stamp receipt time in ms (documented policy)", () => {
    const code = codeOnly(read("src/convex/liveProtection.ts"));
    expect(code).toMatch(/timestamp: now,\s*success: true/);
    expect(code).not.toMatch(/Date\.now\(\)\s*\)?\s*\*\s*1000/);
  });

  it("registration still starts a snapshot LIVE with lastUpdateAt = registration time", () => {
    const code = codeOnly(read("src/lib/market-stream/stream-orchestrator.ts"));
    expect(code).toMatch(/lastUpdateAt: now,\s*monitoringStatus: "LIVE"/);
  });

  it("radar assessFreshness still maps 0/undefined/future to UNAVAILABLE", () => {
    const now = Date.now();
    expect(assessFreshness(0, now)).toBe("UNAVAILABLE");
    expect(assessFreshness(undefined, now)).toBe("UNAVAILABLE");
    expect(assessFreshness(now + 60_000, now)).toBe("UNAVAILABLE");
  });

  it("Phase 218/219 fixes remain in place", () => {
    expect(codeOnly(read("src/components/PositionProtectionDashboard.tsx"))).toContain("hasProviderTimestamp");
    expect(codeOnly(read("src/convex/tradingEconomics.ts"))).not.toMatch(/let datetime = Date\.now\(\)/);
    expect(codeOnly(read("src/convex/liveProtection.ts"))).not.toContain("(meta.regularMarketTime ?? Date.now()) * 1000");
  });
});
