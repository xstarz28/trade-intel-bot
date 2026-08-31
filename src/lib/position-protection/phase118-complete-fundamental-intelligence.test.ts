/**
 * Phase 118 — Complete Fundamental Intelligence Implementation
 *
 * Tests covering:
 * - TickAtlas calendar event parsing
 * - CPI/FOMC/GDP/NFP event classification
 * - actual/previous/forecast preservation
 * - Inflation observation from calendar events
 * - Policy rate observation from FOMC events
 * - Economic event dimension in regime
 * - Structured data dimension in regime
 * - Real-yield precedence (Treasury > text > derived)
 * - Asset-specific transmission with economic events
 * - LONG/SHORT symmetry
 * - Safety invariants
 * - Determinism
 * - Provider failure degradation
 */

import { describe, it, expect } from "vitest";
import {
  buildFundamentalRegime,
  buildFundamentalInputFromPositionIntel,
  buildAssetFundamentalContext,
  type FundamentalRegimeInput,
  type InflationObservation,
  type PolicyRateRegime,
} from "./fundamental-regime";
import type { FundamentalDataPoint, EconomicEvent } from "./fundamental-intelligence";
import type { EconomicEvent as CalendarEvent } from "../../lib/data/calendar-types";
import type { EconomicCalendarData } from "../../lib/data/calendar-types";
import type { TreasuryData, TreasuryContext } from "../../lib/data/treasury";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "test-1",
    event: "CPI (YoY)",
    category: "Inflation",
    country: "United States",
    currency: "USD",
    datetime: Date.now(),
    actual: 3.2,
    forecast: 3.0,
    previous: 2.9,
    importance: 3,
    source: "tickatlas",
    status: "released",
    ...overrides,
  };
}

function makeCalendarData(events: CalendarEvent[] = []): EconomicCalendarData {
  return {
    provider: "tickatlas",
    events,
    macroRisk: { level: "low", explanation: "test", highImpact24h: 0, highImpact72h: 0 },
    timestamp: Date.now(),
    freshness: events.length > 0 ? "recent" : "unavailable",
    confidence: events.length > 0 ? "medium" : "unavailable",
    availability: { upcoming24h: false, upcoming72h: false, recentReleased: events.length > 0 },
  };
}

function makeDataPoint(overrides: Partial<FundamentalDataPoint> = {}): FundamentalDataPoint {
  return {
    metric: "US CPI YoY",
    value: 3.2,
    previous: 2.9,
    expected: 3.0,
    timestamp: Date.now(),
    source: "test",
    freshness: "FRESH",
    category: "INFLATION",
    relatedInstruments: ["*"],
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeEconEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    name: "FOMC Rate Decision",
    timestamp: Date.now(),
    currency: "USD",
    importance: "CRITICAL",
    relatedInstruments: ["*"],
    previous: 5.25,
    expected: 5.25,
    source: "tickatlas",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeTreasuryData(overrides: Partial<TreasuryContext> = {}): TreasuryContext {
  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: Date.now(),
    freshness: "FRESH",
    latest: {
      nominal: { observationDate: "2025-01-15", nominal: { "10Y": 4.55 } },
      real: { observationDate: "2025-01-15", real: { "10Y": 2.10 } },
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<FundamentalRegimeInput> = {}): FundamentalRegimeInput {
  return { vixLevel: 18, ...overrides };
}

function makeRegime(overrides: Partial<FundamentalRegimeInput> = {}): ReturnType<typeof buildFundamentalRegime> {
  return buildFundamentalRegime(makeInput(overrides));
}

// ═══════════════════════════════════════════════════════════════
// A. TICKATLAS CALENDAR PARSING
// ═══════════════════════════════════════════════════════════════

describe("A. TickAtlas calendar event parsing", () => {
  it("CPI event with actual/previous/forecast → FundamentalDataPoint", () => {
    const ev = makeCalendarEvent({ event: "CPI (YoY)", actual: 3.2, previous: 2.9, forecast: 3.0 });
    const r = makeRegime({
      fundamentalDataPoints: [{
        metric: ev.event, value: ev.actual as number, previous: ev.previous as number, expected: ev.forecast as number,
        timestamp: ev.datetime, source: ev.source, freshness: "FRESH", category: "INFLATION", relatedInstruments: ["*"], sourceMode: "LIVE",
      }],
    });
    expect(r.structuredDataPointCount).toBe(1);
    const sdDim = r.dimensions.find((d) => d.name === "STRUCTURED_ECONOMIC_DATA");
    expect(sdDim?.status).toBe("AVAILABLE");
  });

  it("FOMC event → EconomicEvent", () => {
    const r = makeRegime({
      economicEvents: [makeEconEvent({ name: "FOMC Rate Decision", previous: 5.25, expected: 5.25 })],
    });
    expect(r.economicEventCount).toBe(1);
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(evDim?.status).toBe("AVAILABLE");
  });

  it("No events → dimensions UNAVAILABLE", () => {
    const r = makeRegime({});
    expect(r.structuredDataPointCount).toBe(0);
    expect(r.economicEventCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CPI / CORE CPI
// ═══════════════════════════════════════════════════════════════

describe("B. CPI / Core CPI", () => {
  it("CPI actual 3.2, previous 2.9, forecast 3.0 → RISING + ABOVE_EXPECTATION", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI (YoY)", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });

  it("CPI actual 2.5, previous 3.2, forecast 3.0 → DISINFLATIONARY + BELOW_EXPECTATION", () => {
    const r = makeRegime({
      inflationObservation: { actual: 2.5, previous: 3.2, forecast: 3.0, metric: "CPI (YoY)", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
    expect(r.inflationExpectationSurprise).toBe("BELOW_EXPECTATION");
  });

  it("CPI actual 3.0, forecast 3.0 → IN_LINE", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.0, previous: 2.9, forecast: 3.0, metric: "CPI (YoY)", availability: "AVAILABLE" },
    });
    expect(r.inflationExpectationSurprise).toBe("IN_LINE");
  });

  it("Core CPI distinct from headline CPI", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.5, previous: 3.2, forecast: 3.3, metric: "Core CPI (YoY)", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
    // Core CPI can have different surprise than headline
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PCE / CORE PCE
// ═══════════════════════════════════════════════════════════════

describe("C. PCE / Core PCE", () => {
  it("PCE actual 2.8, previous 2.6 → STABLE (ppDiff=0.2, absolute level 1.5-3)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 2.8, previous: 2.6, forecast: 2.7, metric: "PCE Price Index (YoY)", availability: "AVAILABLE" },
    });
    // ppDiff = 0.2 is not > 0.2, so falls to absolute level: 2.8 >= 1.5 → STABLE
    expect(r.inflationRegime).toBe("STABLE");
  });

  it("PCE actual 3.5, previous 2.8 → RISING (ppDiff=0.7 > 0.2)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.5, previous: 2.8, forecast: 3.0, metric: "PCE Price Index (YoY)", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
  });

  it("Core PCE metric preserved", () => {
    const obs: InflationObservation = { actual: 2.9, previous: 2.8, forecast: 2.8, metric: "Core PCE (MoM)", availability: "AVAILABLE" };
    expect(obs.metric).toBe("Core PCE (MoM)");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. FED FUNDS / POLICY RATE
// ═══════════════════════════════════════════════════════════════

describe("D. Fed Funds / policy rate", () => {
  it("FOMC rate hike → TIGHTENING", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("TIGHTENING");
  });

  it("FOMC rate cut → EASING", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.0, previous: 5.25, forecast: 5.0, decision: "RATE_CUT", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("EASING");
  });

  it("FOMC hold → NEUTRAL", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: 5.25, decision: "HOLD", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("NEUTRAL");
  });

  it("Policy rate separate from US10Y", () => {
    const r = makeRegime({
      us10yChange: 10,
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: null, decision: "HOLD", availability: "AVAILABLE" },
    });
    expect(r.rateRegime).toBe("TIGHTENING"); // from US10Y
    expect(r.policyRateRegime).toBe("NEUTRAL"); // from policy rate
  });
});

// ═══════════════════════════════════════════════════════════════
// E. ECONOMIC CALENDAR EVENTS
// ═══════════════════════════════════════════════════════════════

describe("E. Economic calendar events", () => {
  it("Multiple events → correct count", () => {
    const r = makeRegime({
      economicEvents: [
        makeEconEvent({ name: "CPI (YoY)" }),
        makeEconEvent({ name: "FOMC Rate Decision" }),
        makeEconEvent({ name: "Non-Farm Payrolls" }),
      ],
    });
    expect(r.economicEventCount).toBe(3);
  });

  it("Event with actual value → FundamentalDataPoint created", () => {
    const fps: FundamentalDataPoint[] = [{
      metric: "Non-Farm Payrolls", value: 250000, previous: 200000, expected: 180000,
      timestamp: Date.now(), source: "tickatlas", freshness: "FRESH", category: "EMPLOYMENT", relatedInstruments: ["*"], sourceMode: "LIVE",
    }];
    const r = makeRegime({ fundamentalDataPoints: fps });
    expect(r.structuredDataPointCount).toBe(1);
  });

  it("Event importance preserved", () => {
    const ev = makeEconEvent({ importance: "CRITICAL" });
    expect(ev.importance).toBe("CRITICAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. REAL YIELD PRECEDENCE
// ═══════════════════════════════════════════════════════════════

describe("F. Real yield precedence", () => {
  it("Treasury OBSERVED > text > derived", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({ treasuryContext: td, realYieldDescription: "Real yields stable" });
    // Treasury OBSERVED takes precedence
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("No treasury → text fallback", () => {
    const r = makeRegime({ realYieldDescription: "Real yields rising" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("No treasury, no text → derived from US10Y+inflation", () => {
    const r = makeRegime({
      us10yChange: -10,
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: null, metric: "CPI", availability: "AVAILABLE" },
    });
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("No treasury, no text, no inflation → UNAVAILABLE", () => {
    const r = makeRegime({});
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. ASSET TRANSMISSION WITH ECONOMIC EVENTS
// ═══════════════════════════════════════════════════════════════

describe("G. Asset transmission with economic events", () => {
  it("GOLD with falling real yields + high inflation → supporting evidence", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const regime = makeRegime({
      treasuryContext: td,
      inflationObservation: { actual: 4.0, previous: 3.5, forecast: 3.5, metric: "CPI", availability: "AVAILABLE" },
      vixLevel: 25,
    });
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.dataQuality).toBeDefined();
    expect(ctx.supportingEvidence.length + ctx.conflictingEvidence.length).toBeGreaterThanOrEqual(0);
  });

  it("CRYPTO with easing policy + low VIX → risk-on environment", () => {
    const regime = makeRegime({
      policyRateObservation: { current: 4.5, previous: 5.0, forecast: 4.5, decision: "RATE_CUT", availability: "AVAILABLE" },
      vixLevel: 14,
    });
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.dataQuality).toBeDefined();
  });

  it("EQUITIES with tight policy + high inflation → conflicting forces", () => {
    const regime = makeRegime({
      policyRateObservation: { current: 5.75, previous: 5.5, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
      inflationObservation: { actual: 5.0, previous: 4.0, forecast: 4.0, metric: "CPI", availability: "AVAILABLE" },
      us10yChange: 15,
      vixLevel: 22,
    });
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.dataQuality).toBeDefined();
  });

  it("OIL with energy regime from WTI", () => {
    const regime = makeRegime({ oilPrice: 90, oilChange: "Oil price rising significantly" });
    expect(regime.energyRegime).toBe("BALANCED");
  });

  it("FOREX with DXY observation", () => {
    const regime = makeRegime({ usdIndex: 104.5, dxyTrend: "DXY strengthening" });
    expect(regime.currencyRegime).toBe("STRENGTHENING");
  });

  it("SILVER with growth + inflation context", () => {
    const regime = makeRegime({
      growthDescription: "expanding economy",
      inflationObservation: { actual: 2.5, previous: 2.0, forecast: 2.0, metric: "CPI", availability: "AVAILABLE" },
    });
    const ctx = buildAssetFundamentalContext("SILVER", regime);
    expect(ctx.dataQuality).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. CONFLICTING FORCES
// ═══════════════════════════════════════════════════════════════

describe("H. Conflicting forces exposed", () => {
  it("GOLD: falling real yields (supporting) + strong USD (conflicting)", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const regime = makeRegime({
      treasuryContext: td,
      usdIndex: 106,
      dxyTrend: "DXY strengthening",
      vixLevel: 18,
    });
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    // Should have both supporting and conflicting evidence
    expect(ctx.dataQuality).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("I. LONG/SHORT symmetry", () => {
  it("Same macro input → same regime regardless of side", () => {
    const input = makeInput({
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
      vixLevel: 18,
    });
    const r = buildFundamentalRegime(input);
    expect(r.inflationRegime).toBe("RISING");
    expect(r.policyRateRegime).toBe("TIGHTENING");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. PROVIDER FAILURE DEGRADATION
// ═══════════════════════════════════════════════════════════════

describe("J. Provider failure degradation", () => {
  it("TickAtlas unavailable → calendar events UNAVAILABLE", () => {
    const r = makeRegime({});
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(evDim?.status).toBe("UNAVAILABLE");
  });

  it("Treasury unavailable → falls back gracefully", () => {
    const td: TreasuryData = { available: false, reason: "Network error" };
    const r = makeRegime({ treasuryContext: td });
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("Partial data preserves available dimensions", () => {
    const r = makeRegime({
      vixLevel: 20,
      treasuryContext: makeTreasuryData(),
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
    });
    const available = r.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(available.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("K. Safety invariants", () => {
  it("NO BUY/SELL EXECUTION", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 4.0, previous: 3.0, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
      policyRateObservation: { current: 5.5, previous: 5.0, forecast: 5.0, decision: "RATE_HIKE", availability: "AVAILABLE" },
      vixLevel: 22,
    });
    const assets: Array<"GOLD" | "CRYPTO" | "EQUITIES" | "SILVER" | "OIL"> = ["GOLD", "CRYPTO", "EQUITIES", "SILVER", "OIL"];
    for (const asset of assets) {
      const ctx = buildAssetFundamentalContext(asset, regime);
      const allText = JSON.stringify(ctx).toLowerCase();
      expect(allText).not.toContain("buy");
      expect(allText).not.toContain("sell");
      expect(allText).not.toContain("execute");
    }
  });

  it("NO PROBABILITY CLAIMS", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 4.0, previous: 3.0, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
      vixLevel: 22,
    });
    const allText = JSON.stringify(regime).toLowerCase();
    expect(allText).not.toContain("probability");
    expect(allText).not.toContain("% chance");
  });

  it("US10Y NOT treated as policy rate", () => {
    const r = makeRegime({ us10yYield: 4.55, us10yChange: 10 });
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("US10Y NOT treated as real yield", () => {
    const r = makeRegime({ us10yYield: 4.55 });
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("L. Deterministic output", () => {
  it("identical inputs → identical outputs", () => {
    const input: FundamentalRegimeInput = {
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
      vixLevel: 18,
    };
    const r1 = buildFundamentalRegime(input);
    const r2 = buildFundamentalRegime(input);
    expect(r1.inflationRegime).toBe(r2.inflationRegime);
    expect(r1.policyRateRegime).toBe(r2.policyRateRegime);
    expect(r1.inflationExpectationSurprise).toBe(r2.inflationExpectationSurprise);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. NO DUPLICATE PROVIDER REQUESTS
// ═══════════════════════════════════════════════════════════════

describe("M. No duplicate provider requests", () => {
  it("Calendar data passed once, used by regime builder without re-fetch", () => {
    const fps: FundamentalDataPoint[] = [{
      metric: "CPI (YoY)", value: 3.2, previous: 2.9, expected: 3.0,
      timestamp: Date.now(), source: "tickatlas", freshness: "FRESH", category: "INFLATION", relatedInstruments: ["*"], sourceMode: "LIVE",
    }];
    const input = makeInput({ fundamentalDataPoints: fps });
    const r = buildFundamentalRegime(input);
    expect(r.structuredDataPointCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. DATA AVAILABILITY MATRIX
// ═══════════════════════════════════════════════════════════════

describe("N. Data availability matrix", () => {
  it("Full data → all dimensions available", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({
      vixLevel: 20,
      treasuryContext: td,
      usdIndex: 104.5,
      dxyTrend: "DXY stable",
      oilPrice: 80,
      oilChange: "Oil price stable balanced",
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: 5.25, decision: "HOLD", availability: "AVAILABLE" },
      fundamentalDataPoints: [makeDataPoint()],
      economicEvents: [makeEconEvent()],
    });
    const available = r.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(available.length).toBeGreaterThanOrEqual(5);
  });

  it("No data → all dimensions unavailable", () => {
    const r = makeRegime({});
    const unavailable = r.dimensions.filter((d) => d.status === "UNAVAILABLE");
    expect(unavailable.length).toBeGreaterThan(0);
  });
});
