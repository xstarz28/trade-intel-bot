/**
 * Phase 281 — MODERN FOREX FUNDAMENTAL INTELLIGENCE (two-sided comparison,
 * policy divergence, positioning as RISK).
 *
 * What these proofs establish on top of the Phase 279 forex contract:
 *   · every pair is scored as a TWO-SIDED comparison of its own released
 *     measurements, with the two currency areas counted as independent
 *     evidence groups and per-side surprises as multi-period history;
 *   · `insufficient` is not the default while released macro evidence exists:
 *     a pair with only policy + inflation releases is still scored, with the
 *     missing families named;
 *   · the rate/policy differential CHANGES the result — flipping a hike/cut
 *     differential moves the pair from weakening to a different state, and the
 *     differential itself is reported in pp with its basis;
 *   · conflicting PRIMARY evidence (policy vs inflation) is mixed at medium
 *     confidence, and secondary evidence cannot establish a direction on its
 *     own;
 *   · positioning is informational + RISK: a crowded COT report never turns
 *     the pair bullish/bearish and never moves state, confidence or bias;
 *   · unmeasurable inputs stay unavailable with their reason — no non-USD
 *     yield source is invented, an upcoming release is never a measurement,
 *     and no equity/crypto metric appears in a forex assessment.
 */

import { describe, it, expect, vi } from "vitest";
import { assessFundamentals } from "./fundamental-engine";
import type { EconomicCalendarData, EconomicEvent } from "./data/calendar-types";
import type { CotData } from "./data/cot";
import type { TreasuryData } from "./data/treasury";
import { FOREX_DIMENSIONS } from "./fundamental/forex";
import { CRYPTO_DIMENSIONS } from "./fundamental/crypto";

const PROVIDER_OBSERVED = Date.parse("2025-07-04T19:30:00Z");

function event(overrides: Partial<EconomicEvent> & { event: string; currency: string }): EconomicEvent {
  return {
    id: `${overrides.currency}-${overrides.event}-${overrides.datetime ?? 0}`,
    category: "Macro",
    country:
      overrides.currency === "USD" ? "United States" : overrides.currency === "EUR" ? "Euro Area" : "Japan",
    datetime: Date.parse("2025-06-15T12:00:00Z"),
    importance: 3,
    source: "TickAtlas",
    status: "released",
    ...overrides,
  } as EconomicEvent;
}

function calendar(events: EconomicEvent[]): EconomicCalendarData {
  return {
    provider: "tickatlas",
    events,
    macroRisk: { level: "medium", explanation: "CPI window", highImpact24h: 0, highImpact72h: 2 },
    timestamp: PROVIDER_OBSERVED,
    freshness: "recent",
    confidence: "high",
    availability: { upcoming24h: false, upcoming72h: true, recentReleased: true },
  };
}

/** ECB decision + Fed decision: the policy-rate differential of the pair. */
const policy = (base: "EUR" | "JPY", actual: number, previous: number, fedActual: number, fedPrevious: number) => [
  event({
    event: base === "EUR" ? "ECB Interest Rate Decision" : "BoJ Interest Rate Decision",
    currency: base,
    datetime: Date.parse("2025-06-06T11:45:00Z"),
    actual,
    forecast: actual,
    previous,
    referencePeriod: "June 2025",
  }),
  event({
    event: "Fed Interest Rate Decision",
    currency: "USD",
    datetime: Date.parse("2025-06-18T18:00:00Z"),
    actual: fedActual,
    forecast: fedActual,
    previous: fedPrevious,
    referencePeriod: "June 2025",
  }),
];

const INFLATION: EconomicEvent[] = [
  event({
    event: "CPI YoY",
    currency: "EUR",
    datetime: Date.parse("2025-06-19T09:00:00Z"),
    actual: 2.1,
    forecast: 2.3,
    previous: 2.4,
    referencePeriod: "May 2025",
  }),
  event({
    event: "CPI YoY",
    currency: "USD",
    datetime: Date.parse("2025-06-12T12:30:00Z"),
    actual: 3.3,
    forecast: 3.1,
    previous: 3.4,
    referencePeriod: "May 2025",
  }),
];

/** CPI released HOT for the base currency — the opposite primary read. */
const INFLATION_HOT_EUR: EconomicEvent[] = [
  { ...INFLATION[0], actual: 2.6, forecast: 2.2 },
  INFLATION[1],
];

const LABOR: EconomicEvent[] = [
  event({
    event: "Unemployment Rate",
    currency: "EUR",
    datetime: Date.parse("2025-07-01T09:00:00Z"),
    actual: 6.4,
    forecast: 6.5,
    previous: 6.5,
    referencePeriod: "May 2025",
  }),
  event({
    event: "Non-Farm Payrolls",
    currency: "USD",
    datetime: Date.parse("2025-07-03T12:30:00Z"),
    actual: 210_000,
    forecast: 190_000,
    previous: 205_000,
    referencePeriod: "June 2025",
  }),
];

const GROWTH: EconomicEvent[] = [
  event({
    event: "GDP Growth Rate QoQ",
    currency: "EUR",
    datetime: Date.parse("2025-06-06T09:00:00Z"),
    actual: 0.3,
    forecast: 0.2,
    previous: 0.1,
    referencePeriod: "Q1 2025",
  }),
  event({
    event: "ISM Manufacturing PMI",
    currency: "USD",
    datetime: Date.parse("2025-07-01T14:00:00Z"),
    actual: 48.5,
    forecast: 49.2,
    previous: 48.7,
    referencePeriod: "June 2025",
  }),
];

const EXTERNAL: EconomicEvent[] = [
  event({
    event: "Trade Balance",
    currency: "EUR",
    datetime: Date.parse("2025-06-13T09:00:00Z"),
    actual: 14.2,
    forecast: 12.0,
    previous: 12.5,
    referencePeriod: "April 2025",
  }),
  event({
    event: "Trade Balance",
    currency: "USD",
    datetime: Date.parse("2025-07-03T12:30:00Z"),
    actual: -71.5,
    forecast: -70.0,
    previous: -74.0,
    referencePeriod: "May 2025",
  }),
];

const UPCOMING: EconomicEvent[] = [
  event({
    event: "CPI YoY",
    currency: "EUR",
    datetime: Date.parse("2025-07-08T09:00:00Z"),
    importance: 3,
    status: "upcoming",
  }),
];

const COT_EUR: CotData = {
  available: true,
  source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
  fetchedAt: PROVIDER_OBSERVED,
  freshness: "FRESH",
  requestedInstrument: "EUR/USD",
  sourceInstrument: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
  mappedAsset: "Euro FX futures (CME)",
  latest: {
    reportDate: "2025-07-01",
    nonCommercialLong: 100_000,
    nonCommercialShort: 145_000,
    openInterest: 700_000,
  },
  previous: { reportDate: "2025-06-24", nonCommercialLong: 105_000, nonCommercialShort: 143_000 },
  netNonCommercial: -45_000,
  changeFromPreviousReport: -7_000,
};

/** Same provider, same report date — a genuinely one-sided book (38.6% of OI). */
const COT_EUR_CROWDED: CotData = {
  ...COT_EUR,
  latest: {
    reportDate: "2025-07-01",
    nonCommercialLong: 120_000,
    nonCommercialShort: 390_000,
    openInterest: 700_000,
  },
  netNonCommercial: -270_000,
  changeFromPreviousReport: -60_000,
};

const TREASURY: TreasuryData = {
  available: true,
  source: "US Treasury (home.treasury.gov XML feed)",
  fetchedAt: Date.parse("2025-07-04T18:00:00Z"),
  freshness: "FRESH",
  latest: {
    nominal: { observationDate: "2025-07-03", nominal: { "2Y": 4.12, "10Y": 4.35 } },
    real: { observationDate: "2025-07-03", real: { "10Y": 2.05 } },
  },
  previous: {
    nominal: { observationDate: "2025-07-02", nominal: { "2Y": 4.09, "10Y": 4.28 } },
    real: { observationDate: "2025-07-02", real: { "10Y": 2.01 } },
  },
};

function assess(
  instrument: string,
  events: EconomicEvent[],
  extra: { cot?: CotData; treasury?: TreasuryData } = {},
) {
  return assessFundamentals(undefined, {
    instrument,
    instrumentType: "forex",
    provider: "twelve-data",
    providerInstrumentId: instrument,
    calendar: calendar(events),
    price: 1.085,
    priceObservedAt: Date.parse("2025-07-04T19:59:00Z"),
    priceProvider: "twelve-data",
    ...(extra.cot ? { cot: extra.cot } : {}),
    ...(extra.treasury ? { treasury: extra.treasury } : {}),
  } as never);
}

const FULL_EUR_EVENTS = [...policy("EUR", 4.0, 4.25, 5.5, 5.5), ...INFLATION, ...LABOR, ...GROWTH, ...EXTERNAL, ...UPCOMING];

const EUR_USD = assess("EUR/USD", FULL_EUR_EVENTS, { cot: COT_EUR, treasury: TREASURY });
/** Identical payload except ECB HIKES instead of cuts — the differential flips. */
const EUR_USD_HIKE = assess("EUR/USD", [...policy("EUR", 5.75, 5.5, 5.5, 5.5), ...INFLATION, ...LABOR, ...GROWTH, ...EXTERNAL], {
  cot: COT_EUR,
  treasury: TREASURY,
});

// ── 1. Two-sided construction + independent groups ──────────────

describe("281 forex (B/E) — two-sided comparison and independent evidence groups", () => {
  it("(1) both sides are read from their own releases, with the pair identity preserved", () => {
    expect(EUR_USD.domain).toBe("forex");
    expect(EUR_USD.instrumentId).toBe("EUR/USD");
    expect(EUR_USD.available).toBe(true);
    const currencies = new Set(EUR_USD.evidence.map((e) => e.providerInstrumentId));
    expect(currencies.has("EUR")).toBe(true);
    expect(currencies.has("USD")).toBe(true);
    const policy_ = EUR_USD.dimensions.find((d) => d.name === "policy-rates")!;
    expect(policy_.evidence).toContain("base EUR ECB Interest Rate Decision");
    expect(policy_.evidence).toContain("quote USD Fed Interest Rate Decision");
    expect(policy_.evidence).toContain("period June 2025");
  });

  it("(2) confidence counts the two currency areas as independent groups and the surprises as history", () => {
    expect(EUR_USD.confidenceEvidence).toContain("2 independent provider group(s)");
    expect(EUR_USD.confidenceEvidence).toMatch(/\d+ dimension\(s\) with multi-period history/);
    expect(EUR_USD.confidenceEvidence).not.toContain("0 dimension(s) with multi-period history");
    expect(EUR_USD.confidenceEvidence).toContain("primary dimension(s) weakening");
  });

  it("(3) a pair with only policy + inflation evidence is still scored", () => {
    const lite = assess("EUR/USD", [...policy("EUR", 4.0, 4.25, 5.5, 5.5), ...INFLATION]);
    expect(lite.available).toBe(true);
    expect(lite.state).toBe("weakening");
    expect(lite.confidence).toBe("medium");
    expect(lite.directionalBias).toBe("bearish");
    expect(lite.unavailableDimensions).toEqual(
      expect.arrayContaining(["labor", "growth", "external-balance", "positioning"]),
    );
    expect(lite.summary).toContain("Labour: unavailable");
    expect(lite.summary).toContain("Assessment: weakening");
  });
});

// ── 2. The rate differential changes the result ─────────────────

describe("281 forex (B) — the policy/rate differential drives the read", () => {
  it("(4) the differential is reported in pp with both sides named", () => {
    expect(EUR_USD.forexMetrics?.basePolicyRate).toBe(4);
    expect(EUR_USD.forexMetrics?.quotePolicyRate).toBe(5.5);
    expect(EUR_USD.forexMetrics?.policyRateDifferentialPp).toBeCloseTo(-1.5, 6);
    expect(EUR_USD.comparisons?.join(" ")).toContain("policy rate differential: EUR 4.00% vs USD 5.50% → -1.50pp");
    const diff = EUR_USD.evidence.find((e) => e.metric === "policy_rate_differential")!;
    expect(diff.unit).toBe("pp");
    expect(diff.derived).toBe(true);
    expect(diff.basis).toContain("latest released EUR policy rate 4");
  });

  it("(5) flipping the differential from cut to hike changes the assessment", () => {
    expect(EUR_USD.state).toBe("weakening");
    expect(EUR_USD.directionalBias).toBe("bearish");
    expect(EUR_USD.dimensions.find((d) => d.name === "policy-rates")?.status).toBe("negative");

    expect(EUR_USD_HIKE.forexMetrics?.policyRateDifferentialPp).toBeCloseTo(0.25, 6);
    expect(EUR_USD_HIKE.dimensions.find((d) => d.name === "policy-rates")?.status).toBe("positive");
    expect(EUR_USD_HIKE.state).not.toBe(EUR_USD.state);
    expect(EUR_USD_HIKE.directionalBias).not.toBe("bearish");
  });

  it("(6) a changed inflation release changes the inflation read and the state", () => {
    const hot = assess("EUR/USD", [...policy("EUR", 5.75, 5.5, 5.5, 5.5), ...INFLATION_HOT_EUR]);
    // A hot EUR CPI replaces the negative inflation read: both sides now beat
    // their own consensus, so the measured comparison is level.
    expect(hot.dimensions.find((d) => d.name === "inflation")?.status).toBe("neutral");
    expect(EUR_USD.dimensions.find((d) => d.name === "inflation")?.status).toBe("negative");
    // With inflation no longer opposing it, the policy differential sets a
    // direction on its own — from the same shared framework.
    expect(hot.dimensions.find((d) => d.name === "policy-rates")?.status).toBe("positive");
    expect(hot.state).toBe("improving");
    expect(hot.directionalBias).toBe("bullish");
  });

  it("(6b) conflicting PRIMARY evidence is mixed at medium confidence, and says why", () => {
    const conflict = assess("EUR/USD", [...policy("EUR", 5.75, 5.5, 5.5, 5.5), ...INFLATION]);
    expect(conflict.state).toBe("mixed");
    expect(conflict.confidence).toBe("medium");
    expect(conflict.directionalBias).toBe("none");
    expect(conflict.confidenceEvidence).toContain("primary evidence conflicts across dimensions");
    expect(conflict.confidenceEvidence).toContain("caps confidence at medium");
    expect(conflict.contradictions.join(" ")).toContain("macro evidence conflicts between dimensions");
  });

  it("(7) secondary evidence cannot establish a direction on its own", () => {
    const secondaryOnly = assess("EUR/USD", [
      ...policy("EUR", 5.75, 5.5, 5.5, 5.5),
      ...LABOR.map((e) => (e.currency === "EUR" ? { ...e, actual: 6.9 } : { ...e, actual: 190_000, forecast: 190_000 })),
      ...GROWTH.map((e) => (e.currency === "EUR" ? { ...e, actual: -0.4 } : { ...e, actual: 48.5, forecast: 48.5 })),
    ]);
    expect(secondaryOnly.dimensions.find((d) => d.name === "policy-rates")?.status).toBe("positive");
    expect(secondaryOnly.dimensions.find((d) => d.name === "labor")?.status).toBe("negative");
    expect(secondaryOnly.dimensions.find((d) => d.name === "growth")?.status).toBe("negative");
    expect(secondaryOnly.state).toBe("mixed");
    expect(secondaryOnly.confidenceEvidence).toContain("a primary read is required");
  });
});

// ── 3. Positioning is RISK, never a direction ───────────────────

describe("281 forex (D) — positioning can never become bullish or bearish", () => {
  it("(8) a crowded COT report changes nothing but the disclosed risk", () => {
    const crowded = assess("EUR/USD", FULL_EUR_EVENTS, { cot: COT_EUR_CROWDED, treasury: TREASURY });
    expect(crowded.state).toBe(EUR_USD.state);
    expect(crowded.confidence).toBe(EUR_USD.confidence);
    expect(crowded.directionalBias).toBe(EUR_USD.directionalBias);
    expect(crowded.dimensions.find((d) => d.name === "positioning")?.status).toBe("neutral");
    expect(crowded.dimensions.find((d) => d.name === "positioning")?.informational).toBe(true);

    const risk = crowded.contradictions.join(" ");
    expect(risk).toContain("Crowded currency positioning");
    expect(risk).toContain("never turned into a fundamental direction");
    expect(risk).not.toMatch(/bullish|bearish/i);
    expect(crowded.limitations.join(" ")).toContain("reported as RISK");
    expect(crowded.comparisons?.join(" ")).toContain("positioning crowding");
  });

  it("(9) the opposite extreme is equally non-directional", () => {
    const longCrowd = assess("EUR/USD", FULL_EUR_EVENTS, {
      cot: {
        ...COT_EUR,
        latest: {
          reportDate: "2025-07-01",
          nonCommercialLong: 395_000,
          nonCommercialShort: 120_000,
          openInterest: 700_000,
        },
        netNonCommercial: 275_000,
        changeFromPreviousReport: 55_000,
      },
      treasury: TREASURY,
    });
    expect(longCrowd.contradictions.join(" ")).toContain("Crowded currency positioning");
    expect(longCrowd.contradictions.join(" ")).not.toMatch(/bullish|bearish/i);
    expect(longCrowd.state).toBe(EUR_USD.state);
    expect(longCrowd.directionalBias).toBe(EUR_USD.directionalBias);
  });

  it("(10) without a verified report the dimension stays unavailable with its reason", () => {
    const noCot = assess("EUR/USD", FULL_EUR_EVENTS, { treasury: TREASURY });
    expect(noCot.dimensions.find((d) => d.name === "positioning")?.status).toBe("unavailable");
    expect(noCot.limitations.join(" ")).toContain("Positioning UNAVAILABLE");
    expect(noCot.evidence.some((e) => e.metric.startsWith("cot"))).toBe(false);
  });
});

// ── 4. Yields + event risk are informational, not measurements ──

describe("281 forex (B/D) — yields and event risk are informational only", () => {
  it("(11) the yield layer is informational and discloses that only USD yields exist", () => {
    const yields = EUR_USD.dimensions.find((d) => d.name === "rates-yields")!;
    expect(yields.informational).toBe(true);
    expect(yields.consumedBy).toContain("Macro Yield");
    expect(EUR_USD.limitations.join(" ")).toContain("Yield differential UNAVAILABLE");
    // No non-USD yield is invented anywhere in the evidence bag.
    expect(EUR_USD.evidence.some((e) => e.metric.startsWith("yield_reference_") && e.providerInstrumentId !== "USD")).toBe(
      false,
    );
  });

  it("(12) an upcoming release is never treated as a measurement", () => {
    const upcoming = EUR_USD.dimensions.find((d) => d.name === "event-risk")!;
    expect(upcoming.informational).toBe(true);
    expect(upcoming.status).not.toBe("positive");
    expect(upcoming.status).not.toBe("negative");
    expect(EUR_USD.evidence.some((e) => e.metric.startsWith("event_risk"))).toBe(true);
  });
});

// ── 5. A second pair, integrity, determinism ────────────────────

const JPY_EVENTS: EconomicEvent[] = [
  ...policy("JPY", 0.5, 0.5, 5.5, 5.5),
  event({
    event: "National CPI YoY",
    currency: "JPY",
    datetime: Date.parse("2025-06-20T00:30:00Z"),
    actual: 3.5,
    forecast: 3.2,
    previous: 3.6,
    referencePeriod: "May 2025",
  }),
  event({
    event: "CPI YoY",
    currency: "USD",
    datetime: Date.parse("2025-06-12T12:30:00Z"),
    actual: 3.3,
    forecast: 3.1,
    previous: 3.4,
    referencePeriod: "May 2025",
  }),
];
const USD_JPY = assess("USD/JPY", JPY_EVENTS);

describe("281 forex (B/D/H) — a second pair, provenance and determinism", () => {
  it("(13) USD/JPY keeps its own evidence and never borrows the EUR side", () => {
    expect(USD_JPY.instrumentId).toBe("USD/JPY");
    expect(USD_JPY.available).toBe(true);
    expect(USD_JPY.dimensions.find((d) => d.name === "policy-rates")!.evidence).toContain("BoJ Interest Rate Decision");
    expect(USD_JPY.evidence.every((e) => e.providerInstrumentId !== "EUR")).toBe(true);
    expect(JSON.stringify(USD_JPY)).not.toContain("ECB");
    // USD is the BASE of USD/JPY: the Fed rate is the base read, BoJ the quote.
    expect(USD_JPY.forexMetrics?.basePolicyRate).toBe(5.5);
    expect(USD_JPY.forexMetrics?.quotePolicyRate).toBe(0.5);
    expect(USD_JPY.dimensions.find((d) => d.name === "policy-rates")!.evidence).toContain("base USD Fed Interest Rate Decision");
    expect(USD_JPY.state).not.toBe(EUR_USD.state);
  });

  it("(14) every released evidence item carries its provider, period and release instant", () => {
    const released = EUR_USD.evidence.filter((e) => /^[a-z-]+:(EUR|USD)$/.test(e.metric));
    expect(released.length).toBeGreaterThan(0);
    for (const e of released) {
      expect(e.provider).toBeTruthy();
      expect(e.source).toBe("economic calendar release");
      expect(e.observedAt).toBeGreaterThan(0);
      expect(e.freshness).toBe("recent");
      expect(e.unit).toBe("event units");
    }
    // Released macro values are never labelled as live market data.
    expect(EUR_USD.summary).toContain("never a market quote");
  });

  it("(15) no equity or crypto metric leaks into a forex assessment", () => {
    const bag = EUR_USD.metrics as unknown as Record<string, unknown>;
    expect(bag.epsRises).toBeUndefined();
    expect(bag.revenueRises).toBeUndefined();
    expect(bag.peRatio).toBeUndefined();
    expect(bag.circulatingSupply).toBeUndefined();
    expect(bag.positioningRisk).toBeUndefined();
    const names = EUR_USD.dimensions.map((d) => d.name) as string[];
    expect([...names].sort()).toEqual([...FOREX_DIMENSIONS].sort());
    for (const foreign of CRYPTO_DIMENSIONS) {
      if (!(FOREX_DIMENSIONS as readonly string[]).includes(foreign)) expect(names).not.toContain(foreign);
    }
    expect(EUR_USD.dimensions.every((d) => !d.evidence || !/EPS|net margin|P\/E|circulating supply|TVL/.test(d.evidence))).toBe(
      true,
    );
  });

  it("(16) no released measurement at all stays insufficient with both sides named", () => {
    const empty = assessFundamentals(undefined, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      price: 1.085,
      priceObservedAt: Date.parse("2025-07-04T19:59:00Z"),
      priceProvider: "twelve-data",
    } as never);
    expect(empty.available).toBe(false);
    expect(empty.state).toBe("insufficient");
    expect(empty.dimensions.filter((d) => d.status === "unavailable")).toHaveLength(FOREX_DIMENSIONS.length);
    expect(empty.limitations.join(" ")).toContain("No released macroeconomic measurement was supplied for EUR or USD");
    expect(empty.evidence).toEqual([]);
  });

  it("(17) the assessment never reads the clock and repeats byte-identically", () => {
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockImplementation(() => {
        throw new Error("Date.now() must not be used on the fundamental path");
      });
      const again = assess("EUR/USD", FULL_EUR_EVENTS, { cot: COT_EUR_CROWDED, treasury: TREASURY });
      expect(again.state).toBe(EUR_USD.state);
      expect(JSON.stringify(again)).not.toBe(JSON.stringify(EUR_USD));
      const repeat = assess("EUR/USD", FULL_EUR_EVENTS, { cot: COT_EUR, treasury: TREASURY });
      expect(JSON.stringify(repeat)).toBe(JSON.stringify(EUR_USD));
    } finally {
      spy.mockRestore();
    }
  });

  it("(18) the explanation cites the assessment's own derived evidence", () => {
    expect(EUR_USD.summary).toContain("Policy:");
    expect(EUR_USD.summary).toContain("Rates:");
    expect(EUR_USD.summary).toContain("Inflation:");
    expect(EUR_USD.summary).toContain("Labour:");
    expect(EUR_USD.summary).toContain("Growth:");
    expect(EUR_USD.summary).toContain("Positioning:");
    expect(EUR_USD.summary).toContain("Event risk:");
    expect(EUR_USD.summary).toContain(`Assessment: ${EUR_USD.state} · confidence ${EUR_USD.confidence} for EUR/USD.`);
    expect(EUR_USD.summary).toContain("Mean released surprise");
    expect(EUR_USD.summary).toContain("period June 2025");
    expect(EUR_USD.summary).toContain("Periods:");
  });
});
