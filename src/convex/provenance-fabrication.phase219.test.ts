/**
 * Phase 219 — provenance fabrication on the Investor Workspace and Position
 * Protection surfaces.
 *
 * Phase 218 removed one instance of the pattern "provider timestamp absent →
 * substitute Date.now() → display as FRESH/LIVE" from the intelligence feed.
 * This phase audited every other timestamp that reaches those two surfaces
 * and found two more instances, both in the Convex actions that feed them.
 * Both are proven here by driving the REAL exported action handlers with a
 * mocked provider, exactly as Phase 178b/178d do.
 *
 * DEFECT 1 — economic calendar (feeds Investor Workspace "Upcoming events",
 * the calendar-derived macro-risk level, and R7 of the investor synthesis).
 * `normalizeEvent` did `let datetime = Date.now()` and only overwrote it when
 * the provider string parsed. An event with no date, or an unparseable one,
 * was therefore scheduled "right now": status "upcoming", inside every
 * 24h/72h window, and if high-impact it raised macroRisk to HIGH with the
 * explanation "<event> in 0h". A missing schedule time is not "now".
 *
 * DEFECT 2 — Yahoo Finance macro quotes (VIX/DXY/US10Y/WTI on both
 * surfaces). `timestamp: (meta.regularMarketTime ?? Date.now()) * 1000`
 * scaled the millisecond fallback as if it were seconds whenever the provider
 * omitted the field, yielding a timestamp ~56,000 years in the future. That
 * value was carried into the stream orchestrator's out-of-order cursor, after
 * which every subsequent GENUINE quote for the instrument was dropped as
 * "older than the last one". Fabricated provenance did not just mislabel a
 * row; it silently froze the price the protection engine evaluated against.
 *
 * Audited and left alone: the CoinGecko and TwelveData quote paths stamp
 * receipt time in milliseconds and do not multiply; the Treasury parser
 * already drops entries without an observation date; snapshot registration
 * uses `now` only as "registered at", and the panel's LIVE badge for a
 * registered position is a monitoring-lifecycle state, not a data-age claim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchCalendar } from "./tradingEconomics";
import { fetchLiveProtectionQuote } from "./liveProtection";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { selectUpcomingEvents } from "../lib/position-protection/investor-macro-context";
import {
  createOrchestratorState,
  registerPosition,
  registerSymbolMapping,
  processStreamEvent,
} from "../lib/market-stream/stream-orchestrator";
import type { StreamEvent } from "../lib/market-stream/types";

// ── Harness (same shape as Phase 178b) ─────────────────────────

function ctx() {
  return {
    auth: { getUserIdentity: async () => ({ subject: "user_A", issuer: "test" }) },
  } as never;
}

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

type CalendarEvent = {
  id: string;
  event: string;
  datetime: number;
  status: string;
  importance: number;
};
type CalendarResult = {
  success: boolean;
  data: {
    events: CalendarEvent[];
    macroRisk: { level: string; explanation: string; highImpact24h: number; highImpact72h: number };
  };
};
type QuoteResult = { instrument: string; timestamp: number; success: boolean; sourceMode: string };

const callCalendar = handlerOf<{ instrument: string; instrumentType: string }, CalendarResult>(fetchCalendar);
const callQuotes = handlerOf<{ instruments: string[] }, QuoteResult[]>(fetchLiveProtectionQuote);

function stubProvider(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response),
  );
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

beforeEach(() => {
  resetProviderCache();
  process.env.TICKATLAS_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── DEFECT 1: calendar ─────────────────────────────────────────

describe("Phase 219 — an economic event without a provider schedule time is not 'now'", () => {
  const undatedHighImpact = { id: "u1", event: "FOMC Rate Decision", currency: "USD", impact: "High" };
  const unparseable = { id: "u2", event: "CPI", currency: "USD", impact: "High", datetime: "not-a-date" };
  const emptyString = { id: "u3", event: "NFP", currency: "USD", impact: "High", datetime: "" };

  it("drops events with an absent, empty or unparseable datetime", async () => {
    stubProvider({ success: true, data: { events: [undatedHighImpact, unparseable, emptyString] } });
    const r = await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.success).toBe(true);
    expect(r.data.events).toEqual([]);
  });

  it("therefore cannot raise macro risk to HIGH on a fabricated '0h away' event", async () => {
    stubProvider({ success: true, data: { events: [undatedHighImpact] } });
    const r = await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.data.macroRisk.level).toBe("low");
    expect(r.data.macroRisk.highImpact24h).toBe(0);
    expect(r.data.macroRisk.explanation).not.toMatch(/in 0h/);
  });

  it("therefore shows nothing in the Investor Workspace upcoming-events view", async () => {
    stubProvider({ success: true, data: { events: [undatedHighImpact, unparseable] } });
    const r = await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    expect(selectUpcomingEvents(r.data as never)).toEqual([]);
  });

  it("still passes through a genuinely dated event with its own time", async () => {
    const at = Date.now() + 2 * 3_600_000;
    stubProvider({
      success: true,
      data: { events: [{ id: "d1", event: "ISM", currency: "USD", impact: "High", datetime: new Date(at).toISOString() }] },
    });
    const r = await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    expect(r.data.events).toHaveLength(1);
    expect(r.data.events[0].datetime).toBe(at);
    expect(r.data.events[0].status).toBe("upcoming");
    // Real high-impact event in 2h IS high macro risk — the fix did not dull the signal.
    expect(r.data.macroRisk.level).toBe("high");
    expect(selectUpcomingEvents(r.data as never)).toHaveLength(1);
  });

  it("no longer seeds the event time from the local clock", () => {
    const code = codeOnly(read("src/convex/tradingEconomics.ts"));
    expect(code).not.toMatch(/let datetime = Date\.now\(\)/);
    const fn = code.slice(code.indexOf("function normalizeEvent"), code.indexOf("export const fetchCalendar"));
    // Date.now() may remain only for the synthetic id and the
    // released/upcoming comparison — never as a value assigned to datetime.
    expect(fn).not.toMatch(/datetime\s*=\s*Date\.now\(\)/);
    expect(fn).toMatch(/Number\.isFinite\(datetime\)\)\s*return null/);
  });
});

// ── DEFECT 2: Yahoo Finance ────────────────────────────────────

describe("Phase 219 — a Yahoo quote without regularMarketTime gets a millisecond timestamp", () => {
  const priceOnly = { chart: { result: [{ meta: { regularMarketPrice: 18.5 } }] } };

  it("demonstrates the old expression's magnitude error", () => {
    const now = Date.now();
    const meta: { regularMarketTime?: number } = {}; // Yahoo omitted the field
    const old = (meta.regularMarketTime ?? now) * 1000; // the previous code, literally
    expect(old).toBeGreaterThan(now * 100); // ~56,000 years ahead
  });

  it("stamps receipt time in milliseconds, not milliseconds × 1000", async () => {
    stubProvider(priceOnly);
    const before = Date.now();
    const [q] = await callQuotes(ctx(), { instruments: ["VIX"] });
    const after = Date.now();
    expect(q.success).toBe(true);
    expect(q.timestamp).toBeGreaterThanOrEqual(before);
    expect(q.timestamp).toBeLessThanOrEqual(after);
  });

  it("still scales a genuine provider time from seconds", async () => {
    const seconds = Math.floor(Date.now() / 1000) - 120;
    stubProvider({ chart: { result: [{ meta: { regularMarketPrice: 18.5, regularMarketTime: seconds } }] } });
    const [q] = await callQuotes(ctx(), { instruments: ["VIX"] });
    expect(q.timestamp).toBe(seconds * 1000);
  });

  it("treats a non-finite or non-positive provider time as absent", async () => {
    for (const bad of [0, -5, Number.NaN, "1700000000"]) {
      resetProviderCache();
      stubProvider({ chart: { result: [{ meta: { regularMarketPrice: 18.5, regularMarketTime: bad } }] } });
      const before = Date.now();
      const [q] = await callQuotes(ctx(), { instruments: ["VIX"] });
      expect(q.timestamp).toBeGreaterThanOrEqual(before);
      expect(q.timestamp).toBeLessThanOrEqual(Date.now());
    }
  });

  it("no longer multiplies the fallback", () => {
    const code = codeOnly(read("src/convex/liveProtection.ts"));
    expect(code).not.toContain("(meta.regularMarketTime ?? Date.now()) * 1000");
  });
});

// ── Why defect 2 mattered: the cursor ──────────────────────────

describe("Phase 219 — a future-dated quote would have frozen the monitored price", () => {
  function mkStream(ts: number, price: number): StreamEvent {
    return {
      eventId: `e-${ts}-${price}`,
      provider: "OKX",
      instrument: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      assetClass: "crypto",
      eventType: "QUOTE",
      timestamp: ts,
      receivedAt: ts,
      freshness: "FRESH",
      dependencyGroup: "g",
      payload: { price },
    } as StreamEvent;
  }

  function seeded(now: number) {
    let st = createOrchestratorState();
    st = registerSymbolMapping(st, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    st = registerPosition(
      st,
      {
        positionId: "p1",
        instrument: "BTC/USDT",
        side: "LONG",
        entryPrice: 60_000,
        stopLoss: 55_000,
        takeProfit: 70_000,
        leverage: 1,
        horizon: "SWING",
        openedAt: now,
        lifecycle: "MONITORING",
      },
      now,
    );
    return st;
  }

  it("with the old magnitude error, every later genuine quote is dropped as out-of-order", () => {
    const now = Date.now();
    let r = processStreamEvent(seeded(now), mkStream(now * 1000, 61_000), now);
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(61_000);
    r = processStreamEvent(r.state, mkStream(now + 30_000, 50_000), now + 30_000);
    r = processStreamEvent(r.state, mkStream(now + 60_000, 45_000), now + 60_000);
    // Price is well below stop-loss, and the monitor never saw it.
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(61_000);
    expect(r.state.totalEventsDropped).toBe(2);
  });

  it("with honest millisecond timestamps the monitor tracks the price", () => {
    const now = Date.now();
    let r = processStreamEvent(seeded(now), mkStream(now, 61_000), now);
    r = processStreamEvent(r.state, mkStream(now + 30_000, 50_000), now + 30_000);
    r = processStreamEvent(r.state, mkStream(now + 60_000, 45_000), now + 60_000);
    expect(r.state.monitor.positions.get("p1")!.currentPrice).toBe(45_000);
    expect(r.state.totalEventsDropped).toBe(0);
  });
});

// ── Audited-clean invariants that must stay that way ──────────

describe("Phase 219 — sibling paths audited clean stay clean", () => {
  it("CoinGecko and TwelveData quote paths never multiply a timestamp", () => {
    const code = codeOnly(read("src/convex/liveProtection.ts"));
    expect(code).not.toMatch(/Date\.now\(\)\s*\)?\s*\*\s*1000/);
  });

  it("the Treasury parser still rejects an entry with no observation date", () => {
    const code = codeOnly(read("src/lib/data/treasury.ts"));
    expect(code).toMatch(/if \(!dateMatch\) continue;/);
  });

  it("the investor macro view keeps quote status verbatim from the provider state", () => {
    const code = codeOnly(read("src/lib/position-protection/investor-macro-context.ts"));
    expect(code).not.toMatch(/status:\s*"LIVE"[\s\S]{0,80}Date\.now/);
    expect(code).toContain('state.sourceMode === "LIVE" && state.price > 0');
  });

  it("the Phase 218 news-feed fix is still in place", () => {
    const code = codeOnly(read("src/components/PositionProtectionDashboard.tsx"));
    expect(code).not.toContain("new Date(art.publishedAt).getTime() : Date.now()");
    expect(code).toContain("hasProviderTimestamp");
  });
});
