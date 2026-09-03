/**
 * Phase 140 — Investor Macro Context View-Model Tests
 *
 * Verifies the pure selection layer that maps EXISTING macro/cross-asset
 * state (live quotes, US Treasury yields, economic calendar) into the
 * investor workspace:
 * - values come verbatim from provider state (never recalculated)
 * - LIVE / STALE / UNAVAILABLE semantics are preserved (stale is never live)
 * - global macro context carries NO position association
 * - missing data yields explicit unavailable states, never fabricated numbers
 * - pure & deterministic: identical inputs → identical output, inputs unmutated
 */

import { describe, it, expect } from "vitest";
import type { LiveInstrumentState } from "./use-live-protection-polling";
import type { TreasuryData } from "../data/treasury";
import type { EconomicCalendarData, EconomicEvent } from "../data/calendar-types";
import {
  selectMacroQuotes,
  selectTreasuryRates,
  selectUpcomingEvents,
  buildInvestorMacroContext,
} from "./investor-macro-context";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

function makeLive(
  instrument: string,
  overrides: Partial<LiveInstrumentState> = {},
): LiveInstrumentState {
  return {
    instrument,
    price: 0,
    provider: "TwelveData",
    sourceMode: "UNAVAILABLE",
    lastUpdateAt: 1_700_000_000_000,
    success: false,
    ...overrides,
  } as LiveInstrumentState;
}

function makeTreasury(overrides: Partial<TreasuryData> = {}): TreasuryData {
  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: 1_700_000_000_000,
    freshness: "FRESH",
    latest: {
      nominal: { observationDate: "2026-09-02", nominal: { "2Y": 4.1, "10Y": 4.3 } },
      real: { observationDate: "2026-09-02", real: { "10Y": 1.8 } },
    },
    ...overrides,
  } as TreasuryData;
}

function makeEvent(overrides: Partial<EconomicEvent>): EconomicEvent {
  return {
    id: "evt-1",
    event: "CPI (YoY)",
    category: "Inflation",
    country: "United States",
    currency: "USD",
    datetime: Date.now() + 86_400_000,
    importance: 3,
    source: "tickatlas",
    status: "upcoming",
    ...overrides,
  };
}

function makeCalendar(events: EconomicEvent[]): EconomicCalendarData {
  return {
    provider: "tickatlas",
    events,
    macroRisk: {
      level: "medium",
      explanation: "Some events.",
      highImpact24h: 1,
      highImpact72h: 2,
    },
    timestamp: Date.now(),
    freshness: "recent",
    confidence: "high",
    availability: { upcoming24h: true, upcoming72h: true, recentReleased: true },
  };
}

// ═══════════════════════════════════════════════════════════════
// selectMacroQuotes
// ═══════════════════════════════════════════════════════════════

describe("selectMacroQuotes — verbatim values, preserved status", () => {
  it("returns LIVE quotes with the provider's exact price", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["VIX", makeLive("VIX", { price: 17.42, sourceMode: "LIVE", change24h: -0.6, success: true })],
    ]);
    const quotes = selectMacroQuotes(map);
    expect(quotes).toHaveLength(4);
    const vix = quotes.find((q) => q.symbol === "VIX")!;
    expect(vix.status).toBe("LIVE");
    expect(vix.value).toBe(17.42);
    expect(vix.change24h).toBe(-0.6);
  });

  it("resolves provider alias keys to canonical symbols", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["^VIX", makeLive("^VIX", { price: 20.1, sourceMode: "LIVE", success: true })],
      ["DX-Y.NYB", makeLive("DX-Y.NYB", { price: 104.5, sourceMode: "LIVE", success: true })],
      ["^TNX", makeLive("^TNX", { price: 42.1, sourceMode: "LIVE", success: true })],
      ["CL=F", makeLive("CL=F", { price: 78.9, sourceMode: "LIVE", success: true })],
    ]);
    const quotes = selectMacroQuotes(map);
    expect(quotes.every((q) => q.status === "LIVE")).toBe(true);
    expect(quotes.map((q) => q.symbol)).toEqual(["VIX", "DXY", "US10Y", "WTI"]);
  });

  it("treats missing quotes as UNAVAILABLE with null value", () => {
    const quotes = selectMacroQuotes(new Map());
    for (const q of quotes) {
      expect(q.status).toBe("UNAVAILABLE");
      expect(q.value).toBeNull();
      expect(q.change24h).toBeNull();
    }
  });

  it("never promotes a LIVE record with price 0 to a value", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["DXY", makeLive("DXY", { price: 0, sourceMode: "LIVE" })],
    ]);
    const quotes = selectMacroQuotes(map);
    expect(quotes.find((q) => q.symbol === "DXY")).toMatchObject({
      status: "UNAVAILABLE",
      value: null,
    });
  });

  it("preserves STALE as STALE — never presented as LIVE", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["WTI", makeLive("WTI", { price: 80.2, sourceMode: "STALE" })],
    ]);
    const quotes = selectMacroQuotes(map);
    expect(quotes.find((q) => q.symbol === "WTI")).toMatchObject({
      status: "STALE",
      value: 80.2,
    });
  });

  it("maps provider UNAVAILABLE records to UNAVAILABLE view rows", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["US10Y", makeLive("US10Y", { price: 0, sourceMode: "UNAVAILABLE" })],
    ]);
    expect(selectMacroQuotes(map).find((q) => q.symbol === "US10Y")).toMatchObject({
      status: "UNAVAILABLE",
      value: null,
    });
  });

  it("does not mutate the input map and is deterministic", () => {
    const map = new Map<string, LiveInstrumentState>([
      ["VIX", makeLive("VIX", { price: 17.4, sourceMode: "LIVE", success: true })],
    ]);
    const before = map.size;
    const first = selectMacroQuotes(map);
    const second = selectMacroQuotes(map);
    expect(map.size).toBe(before);
    expect(first).toEqual(second);
  });
});

// ═══════════════════════════════════════════════════════════════
// selectTreasuryRates
// ═══════════════════════════════════════════════════════════════

describe("selectTreasuryRates — official curve only, verbatim", () => {
  it("returns no rows when treasury data is unavailable", () => {
    expect(selectTreasuryRates(null)).toEqual({
      available: false,
      freshness: null,
      observationDate: null,
      rows: [],
    });
    expect(selectTreasuryRates({ available: false, reason: "no key" })).toMatchObject({
      available: false,
      rows: [],
    });
  });

  it("selects present nominal 2Y/10Y and real 10Y points verbatim", () => {
    const view = selectTreasuryRates(makeTreasury());
    expect(view.available).toBe(true);
    expect(view.freshness).toBe("FRESH");
    expect(view.observationDate).toBe("2026-09-02");
    expect(view.rows).toContainEqual({ tenor: "2Y", value: 4.1 });
    expect(view.rows).toContainEqual({ tenor: "10Y", value: 4.3 });
    expect(view.rows).toContainEqual({ tenor: "REAL_10Y", value: 1.8 });
  });

  it("omits tenors that are absent — no interpolation or substitution", () => {
    const view = selectTreasuryRates(
      makeTreasury({
        latest: {
          nominal: { observationDate: "2026-09-02", nominal: { "10Y": 4.3 } },
          real: { observationDate: "2026-09-02", real: {} },
        },
      }),
    );
    expect(view.rows).toEqual([{ tenor: "10Y", value: 4.3 }]);
  });

  it("preserves the feed's own freshness classification", () => {
    expect(selectTreasuryRates(makeTreasury({ freshness: "STALE" })).freshness).toBe("STALE");
    expect(selectTreasuryRates(makeTreasury({ freshness: "DELAYED" })).freshness).toBe("DELAYED");
  });
});

// ═══════════════════════════════════════════════════════════════
// selectUpcomingEvents
// ═══════════════════════════════════════════════════════════════

describe("selectUpcomingEvents — schedule only, earliest first", () => {
  const now = Date.now();
  const base = (over: Partial<EconomicEvent> = {}) => makeEvent(over);

  it("returns upcoming events within horizon sorted by time, limited", () => {
    const events = [
      base({ id: "a", datetime: now + 2 * 86_400_000, event: "Later" }),
      base({ id: "b", datetime: now + 1 * 86_400_000, event: "Sooner" }),
      base({ id: "c", datetime: now + 3 * 86_400_000, event: "Third" }),
      base({ id: "d", datetime: now + 4 * 86_400_000, event: "Fourth" }),
    ];
    const selected = selectUpcomingEvents(makeCalendar(events), { minImportance: 2, limit: 3 });
    expect(selected.map((e) => e.event)).toEqual(["Sooner", "Later", "Third"]);
  });

  it("excludes released/revised events and events already in the past", () => {
    const past = base({ id: "past", datetime: now - 3_600_000, status: "upcoming" });
    const released = base({ id: "released", datetime: now + 86_400_000, status: "released" });
    const ok = base({ id: "ok", datetime: now + 86_400_000, status: "upcoming" });

    // past + released only → nothing eligible
    expect(selectUpcomingEvents(makeCalendar([past, released]))).toEqual([]);
    // adding one genuinely upcoming event → only that event
    const selected = selectUpcomingEvents(makeCalendar([past, released, ok]));
    expect(selected).toHaveLength(1);
    expect(selected[0].datetime).toBe(ok.datetime);
  });

  it("respects minImportance (low-importance events are not shown as macro context)", () => {
    const events = [
      base({ id: "low", event: "Retail Sales", importance: 1 as const, datetime: now + 86_400_000 }),
      base({ id: "high", event: "FOMC Rate Decision", importance: 3 as const, datetime: now + 86_400_000 }),
    ];
    const selected = selectUpcomingEvents(makeCalendar(events));
    expect(selected.map((e) => e.event)).toEqual(["FOMC Rate Decision"]);
  });

  it("returns [] for missing calendar data", () => {
    expect(selectUpcomingEvents(null)).toEqual([]);
    expect(selectUpcomingEvents(makeCalendar([]))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// buildInvestorMacroContext — global scope + availability
// ═══════════════════════════════════════════════════════════════

describe("buildInvestorMacroContext — global, availability-honest", () => {
  it("hasAnyData is false and liveQuoteCount is 0 when nothing is available", () => {
    const ctx = buildInvestorMacroContext(new Map(), null, null);
    expect(ctx.hasAnyData).toBe(false);
    expect(ctx.liveQuoteCount).toBe(0);
    expect(ctx.quotes.every((q) => q.status === "UNAVAILABLE")).toBe(true);
    expect(ctx.rates.rows).toEqual([]);
    expect(ctx.events).toEqual([]);
  });

  it("detects data from any single source", () => {
    const liveOnly = buildInvestorMacroContext(
      new Map([["VIX", makeLive("VIX", { price: 16.0, sourceMode: "LIVE", success: true })]]),
      null,
      null,
    );
    expect(liveOnly.hasAnyData).toBe(true);
    expect(liveOnly.liveQuoteCount).toBe(1);

    const ratesOnly = buildInvestorMacroContext(new Map(), makeTreasury(), null);
    expect(ratesOnly.hasAnyData).toBe(true);

    const eventsOnly = buildInvestorMacroContext(
      new Map(),
      null,
      makeCalendar([makeEvent({})]),
    );
    expect(eventsOnly.hasAnyData).toBe(true);
  });

  it("carries NO position association — global context only", () => {
    const ctx = buildInvestorMacroContext(
      new Map([["VIX", makeLive("VIX", { price: 16.0, sourceMode: "LIVE", success: true })]]),
      makeTreasury(),
      makeCalendar([makeEvent({})]),
    );
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("positionId");
    expect(json).not.toContain("position");
  });

  it("is independent of any position lifecycle state (pure selection)", () => {
    // Macro context is derived purely from macro maps/data — two different
    // "portfolio states" cannot change it because it never reads them.
    const map = new Map([["VIX", makeLive("VIX", { price: 16.0, sourceMode: "LIVE", success: true })]]);
    const a = buildInvestorMacroContext(map, makeTreasury(), null);
    const b = buildInvestorMacroContext(map, makeTreasury(), null);
    expect(a).toEqual(b);
    expect(a.liveQuoteCount).toBe(b.liveQuoteCount);
  });

  it("counts only LIVE quotes as live", () => {
    const ctx = buildInvestorMacroContext(
      new Map([
        ["VIX", makeLive("VIX", { price: 16.0, sourceMode: "LIVE", success: true })],
        ["WTI", makeLive("WTI", { price: 80.0, sourceMode: "STALE" })],
      ]),
      null,
      null,
    );
    expect(ctx.liveQuoteCount).toBe(1);
    expect(ctx.quotes.find((q) => q.symbol === "VIX")!.status).toBe("LIVE");
    expect(ctx.quotes.find((q) => q.symbol === "WTI")!.status).toBe("STALE");
  });
});
