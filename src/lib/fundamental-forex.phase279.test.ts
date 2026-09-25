/**
 * Phase 279 — FOREX macro-relative fundamental intelligence regression contract.
 *
 * Task B of the phase: a currency pair must be assessed as a TWO-SIDED macro
 * comparison — policy, inflation, labour, growth, external balance, yields,
 * positioning and event risk — with each side read from its own released
 * measurements, and with everything another engine layer already scores marked
 * informational so no provider field is counted twice.
 *
 * What these proofs establish:
 *   · the exact pair identity is preserved (EUR/USD is not USD/JPY);
 *   · every scored dimension compares BOTH sides, from released values whose
 *     period and release instant travel with the evidence;
 *   · a rate differential, a policy divergence reading and a per-side surprise
 *     average are computed only where both sides really report;
 *   · positioned/yield/event-risk evidence is informational and cannot move the
 *     state; the treasury evidence states that no non-USD yield source exists;
 *   · an upcoming release is never treated as a measurement;
 *   · no company metric exists anywhere in a forex assessment;
 *   · the assessment is deterministic and changes when the macro evidence does;
 *   · without released macro evidence the domain reports UNAVAILABLE with the
 *     missing evidence named — never a fabricated neutral macro read.
 */

import { describe, it, expect } from "vitest";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { assessFundamentals } from "./fundamental-engine";
import { calculateTechnical } from "./data/technical";
import type { OhlcvCandle } from "./data/market-types";
import type { EconomicCalendarData, EconomicEvent } from "./data/calendar-types";
import type { CotData } from "./data/cot";
import type { TreasuryData } from "./data/treasury";

const BAR_MS = 3_600_000;
const END_TS = Date.parse("2025-07-04T20:00:00Z");
const PROVIDER_OBSERVED = Date.parse("2025-07-04T19:30:00Z");

function candles(n: number): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = 1.085 + 0.00002 * j + 0.0005 * Math.sin(j * 0.55);
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - 0.0001,
      high: close + 0.0004,
      low: close - 0.0004,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const CANDLES = candles(240);

function event(overrides: Partial<EconomicEvent> & { event: string; currency: string }): EconomicEvent {
  return {
    id: `${overrides.currency}-${overrides.event}-${overrides.datetime ?? 0}`,
    category: "Macro",
    country: overrides.currency === "USD" ? "United States" : overrides.currency === "EUR" ? "Euro Area" : "Japan",
    datetime: Date.parse("2025-06-15T12:00:00Z"),
    importance: 3,
    source: "TickAtlas",
    status: "released",
    ...overrides,
  } as EconomicEvent;
}

const US_AND_EU_EVENTS: EconomicEvent[] = [
  event({
    event: "ECB Interest Rate Decision",
    currency: "EUR",
    datetime: Date.parse("2025-06-06T11:45:00Z"),
    actual: 4.0,
    forecast: 4.0,
    previous: 4.25,
    referencePeriod: "June 2025",
  }),
  event({
    event: "Fed Interest Rate Decision",
    currency: "USD",
    datetime: Date.parse("2025-06-18T18:00:00Z"),
    actual: 5.5,
    forecast: 5.5,
    previous: 5.25,
    referencePeriod: "June 2025",
  }),
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

const JP_EVENTS: EconomicEvent[] = [
  event({
    event: "BoJ Interest Rate Decision",
    currency: "JPY",
    datetime: Date.parse("2025-06-17T03:00:00Z"),
    actual: 0.5,
    forecast: 0.5,
    previous: 0.5,
    referencePeriod: "June 2025",
  }),
  event({
    event: "Fed Interest Rate Decision",
    currency: "USD",
    datetime: Date.parse("2025-06-18T18:00:00Z"),
    actual: 5.5,
    forecast: 5.5,
    previous: 5.5,
    referencePeriod: "June 2025",
  }),
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
  event({
    event: "Tankan Large Manufacturers Index",
    currency: "JPY",
    datetime: Date.parse("2025-07-01T23:50:00Z"),
    actual: 13,
    forecast: 10,
    previous: 12,
    referencePeriod: "Q2 2025",
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

function calendar(events: EconomicEvent[], currencies: string[]): EconomicCalendarData {
  return {
    provider: "tickatlas",
    events,
    macroRisk: {
      level: "medium",
      explanation: "CPI scheduled inside the forward window",
      highImpact24h: 0,
      highImpact72h: currencies.length,
    },
    timestamp: PROVIDER_OBSERVED,
    freshness: "recent",
    confidence: "high",
    availability: { upcoming24h: false, upcoming72h: true, recentReleased: true },
  };
}

const EUR_USD_CALENDAR = calendar(US_AND_EU_EVENTS, ["EUR", "USD"]);
const USD_JPY_CALENDAR = calendar(JP_EVENTS, ["USD", "JPY"]);

const COT_EUR: CotData = {
  available: true,
  source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
  fetchedAt: Date.parse("2025-07-04T19:30:00Z"),
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

function forexInput(instrument: string, extra: Partial<AnalysisInput>): AnalysisInput {
  const last = CANDLES[CANDLES.length - 1];
  return {
    instrument,
    instrumentType: "forex",
    timeframe: "H1",
    tradingStyle: "intraday",
    provider: "twelve-data",
    providerInstrumentId: instrument,
    marketData: {
      instrument,
      instrumentType: "forex",
      provider: "twelve-data",
      providerInstrumentId: instrument,
      price: { price: last.close, timestamp: last.timestamp, source: "twelve-data" },
      candles: CANDLES,
      timeframe: "H1",
      fetchTimestamp: last.timestamp,
      dataFreshness: "realtime",
    },
    technicalData: calculateTechnical(CANDLES),
    ...extra,
  } as AnalysisInput;
}

const EUR_USD = forexInput("EUR/USD", {
  calendarData: EUR_USD_CALENDAR,
  cotData: COT_EUR,
  treasuryData: TREASURY,
});
const USD_JPY = forexInput("USD/JPY", { calendarData: USD_JPY_CALENDAR });

// ── 1. Pair identity + two-sided construction ────────────────────

describe("279 forex (B) — pair identity and two-sided construction", () => {
  it("(1) the exact pair identity is preserved and the domain is forex", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    expect(a.domain).toBe("forex");
    expect(a.instrumentId).toBe("EUR/USD");
    expect(a.available).toBe(true);
    expect(a.dimensions.length).toBe(8);
  });

  it("(2) both sides of the pair are read from their own released measurements", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const policy = a.dimensions.find((d) => d.name === "policy-rates")!;
    expect(policy.evidence).toContain("base EUR ECB Interest Rate Decision");
    expect(policy.evidence).toContain("quote USD Fed Interest Rate Decision");
    expect(policy.evidence).toContain("period June 2025");
    const currencies = new Set(a.evidence.map((e) => e.providerInstrumentId));
    expect(currencies.has("EUR")).toBe(true);
    expect(currencies.has("USD")).toBe(true);
  });

  it("(3) USD/JPY is a different pair with its own evidence — never the EUR/USD readings", () => {
    const jpy = runAnalysis(USD_JPY).fundamentalAssessment!;
    expect(jpy.instrumentId).toBe("USD/JPY");
    expect(jpy.dimensions.find((d) => d.name === "policy-rates")!.evidence).toContain("BoJ Interest Rate Decision");
    expect(jpy.evidence.every((e) => e.providerInstrumentId !== "EUR")).toBe(true);
    expect(JSON.stringify(jpy)).not.toContain("ECB");
    expect(jpy.forexMetrics?.basePolicyRate).toBe(5.5);
    expect(jpy.forexMetrics?.quotePolicyRate).toBe(0.5);
  });

  it("(4) the assessment is produced with no clock reading at all", () => {
    const a = assessFundamentals(undefined, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: EUR_USD_CALENDAR,
      treasury: TREASURY,
      cot: COT_EUR,
    });
    expect(a.domain).toBe("forex");
    expect(a.available).toBe(true);
  });
});

// ── 2. Policy, differentials and divergence ──────────────────────

describe("279 forex (B) — policy, rates and differentials", () => {
  it("(5) the policy dimension scores the rate CHANGE, and reports the differential", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const policy = a.dimensions.find((d) => d.name === "policy-rates")!;
    expect(policy.evidence).toContain("rate cut of -0.25pp vs the previous release");
    expect(policy.evidence).toContain("rate increase of 0.25pp vs the previous release");
    expect(policy.evidence).toContain("reading favours USD (quote side of the pair)");
    expect(policy.status).toBe("negative");
    expect(a.forexMetrics?.policyRateDifferentialPp).toBeCloseTo(-1.5, 6);
  });

  it("(6) a policy differential is reported as a derived measurement with its basis, and only when BOTH sides report", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const diff = a.evidence.find((e) => e.metric === "policy_rate_differential")!;
    expect(diff.derived).toBe(true);
    expect(diff.unit).toBe("pp");
    expect(diff.value).toBeCloseTo(-1.5, 6);
    expect(diff.basis).toContain("latest released EUR policy rate");
    expect(a.comparisons!.some((c) => c.includes("policy rate differential: EUR 4.00% vs USD 5.50%"))).toBe(true);
  });

  it("(7) monetary-policy divergence across the two sides is stated as a comparison", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    expect(a.comparisons!.some((c) => c.includes("monetary-policy divergence") && c.includes("EUR easing relative to USD"))).toBe(true);
  });

  it("(8) a single-sided release still scores its own side and never invents the other", () => {
    const a = runAnalysis(
      forexInput("EUR/USD", {
        calendarData: calendar(
          [
            event({
              event: "ECB Interest Rate Decision",
              currency: "EUR",
              datetime: Date.parse("2025-06-06T11:45:00Z"),
              actual: 4.0,
              forecast: 4.0,
              previous: 3.75,
              referencePeriod: "June 2025",
            }),
          ],
          ["EUR", "USD"],
        ),
      }),
    ).fundamentalAssessment!;
    expect(a.forexMetrics?.basePolicyRate).toBe(4);
    expect(a.forexMetrics?.quotePolicyRate).toBeUndefined();
    expect(a.forexMetrics?.policyRateDifferentialPp).toBeUndefined();
    expect(a.evidence.some((e) => e.metric === "policy_rate_differential")).toBe(false);
    const policy = a.dimensions.find((d) => d.name === "policy-rates")!;
    expect(policy.status).toBe("positive");
    expect(policy.evidence).toContain("quote USD had no released policy rates measurement");
    expect(policy.evidence).toContain("the comparison is one-sided and no reading is invented for it");
    expect(policy.evidence).toContain("on a one-sided comparison");
  });
});

// ── 3. Inflation / labour / growth / external balance ────────────

describe("279 forex (B) — inflation, labour, growth and external balance", () => {
  it("(9) inflation is scored from the released surprise, with period and release instant", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const inflation = a.dimensions.find((d) => d.name === "inflation")!;
    expect(inflation.status).toBe("negative"); // EUR missed low, USD surprised higher
    expect(inflation.evidence).toContain("actual 2.1 vs consensus 2.3");
    expect(inflation.evidence).toContain("surprise +0.20");
    const item = a.evidence.find((e) => e.metric === "inflation:EUR")!;
    expect(item.period).toBe("May 2025");
    expect(item.observedAt).toBe(Date.parse("2025-06-19T09:00:00Z"));
  });

  it("(10) labour reads an inverted series correctly: lower unemployment is currency-positive", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const labor = a.dimensions.find((d) => d.name === "labor")!;
    // EUR unemployment came in BELOW consensus (positive for EUR) while USD
    // payrolls beat (positive for USD) → the two sides cancel out.
    expect(labor.evidence).toContain("surprise -0.10 vs consensus (inverted: a higher reading is currency-negative for this series)");
    expect(labor.status).toBe("neutral");
    expect(labor.evidence).toContain("the two sides are level on the measured evidence, so no side is favoured");
  });

  it("(11) a surprise inside the documented band is never scored as a signal", () => {
    const a = runAnalysis(
      forexInput("EUR/USD", {
        calendarData: calendar(
          [
            event({
              event: "CPI YoY",
              currency: "EUR",
              datetime: Date.parse("2025-06-19T09:00:00Z"),
              actual: 2.29,
              forecast: 2.3,
              previous: 2.3,
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
          ],
          ["EUR", "USD"],
        ),
      }),
    ).fundamentalAssessment!;
    const inflation = a.dimensions.find((d) => d.name === "inflation")!;
    expect(inflation.evidence).toContain("inside the documented \"in line\" band");
    expect(inflation.status).toBe("negative"); // only the USD side carries a real surprise
  });

  it("(12) growth is read on both sides, and external balance stays unavailable when no release exists", () => {
    const a = runAnalysis(USD_JPY).fundamentalAssessment!;
    const growth = a.dimensions.find((d) => d.name === "growth")!;
    expect(growth.evidence).toContain("Tankan Large Manufacturers Index");
    expect(growth.evidence).toContain("ISM Manufacturing PMI");
    expect(a.dimensions.find((d) => d.name === "external-balance")!.status).toBe("unavailable");
    expect(a.unavailableDimensions).toContain("external-balance");
    expect(a.limitations.join(" ")).toMatch(/external balance UNAVAILABLE/);
  });
});

// ── 4. Informational evidence: yields, positioning, event risk ───

describe("279 forex (B) — evidence another layer already scores stays informational", () => {
  it("(13) Treasury yields are informational, name the consuming layer and never move the state", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const y = a.dimensions.find((d) => d.name === "rates-yields")!;
    expect(y.informational).toBe(true);
    expect(y.consumedBy).toContain("Macro Yield");
    expect(y.evidence).toContain("10Y 4.35%");
    expect(y.evidence).toContain("real 10Y 2.05%");
    expect(a.evidence.find((e) => e.metric === "usd_10y_nominal")!.consumedElsewhere).toContain("Macro Yield");
    // Removing the Treasury payload cannot change the scored state.
    const without = runAnalysis(forexInput("EUR/USD", { calendarData: EUR_USD_CALENDAR })).fundamentalAssessment!;
    expect(without.state).toBe(a.state);
    expect(without.confidence).toBe(a.confidence);
    expect(without.dimensions.find((d) => d.name === "rates-yields")!.status).toBe("unavailable");
  });

  it("(14) no cross-currency yield differential is fabricated — the absence of a non-USD source is disclosed", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    expect(a.limitations.join(" ")).toMatch(/Yield differential UNAVAILABLE as a comparative measurement/);
    expect(a.evidence.some((e) => e.metric.includes("yield_differential"))).toBe(false);
    const jpy = runAnalysis(USD_JPY).fundamentalAssessment!;
    expect(jpy.dimensions.find((d) => d.name === "rates-yields")!.status).toBe("unavailable");
  });

  it("(15) COT positioning is informational, coterminous with its report date, and crowding is context", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const p = a.dimensions.find((d) => d.name === "positioning")!;
    expect(p.informational).toBe(true);
    expect(p.consumedBy).toContain("COT");
    expect(p.evidence).toContain("report 2025-07-01");
    expect(p.evidence).toContain("net non-commercial -45,000");
    const item = a.evidence.find((e) => e.metric === "cot_net_non_commercial")!;
    expect(item.period).toBe("2025-07-01");
    expect(item.consumedElsewhere).toContain("COT");
    // The COT payload cannot move the scored state either.
    const without = runAnalysis(forexInput("EUR/USD", { calendarData: EUR_USD_CALENDAR })).fundamentalAssessment!;
    expect(without.state).toBe(a.state);
  });

  it("(16) upcoming releases are event RISK, never measurements", () => {
    const upcoming = event({
      event: "CPI YoY",
      currency: "USD",
      datetime: Date.parse("2025-07-15T12:30:00Z"),
      actual: undefined,
      forecast: 3.2,
      referencePeriod: "June 2025",
      status: "upcoming",
    });
    const a = runAnalysis(
      forexInput("EUR/USD", { calendarData: calendar([...US_AND_EU_EVENTS, upcoming], ["EUR", "USD"]) }),
    ).fundamentalAssessment!;
    const risk = a.dimensions.find((d) => d.name === "event-risk")!;
    expect(risk.informational).toBe(true);
    expect(risk.evidence).toContain("CPI YoY on 2025-07-15");
    expect(risk.evidence).toContain("never directional evidence");
    // The upcoming release is NOT in the inflation measurement set.
    expect(a.evidence.some((e) => e.metric === "inflation:USD" && e.period === "June 2025")).toBe(false);
    expect(a.dimensions.find((d) => d.name === "inflation")!.evidence).not.toContain("June 2025");
  });
});

// ── 5. Honesty, determinism, pipeline ────────────────────────────

describe("279 forex (B) — honesty, determinism and pipeline integration", () => {
  it("(17) a forex assessment contains no company metric at all", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    expect(Object.keys(a.metrics)).toEqual([]);
    expect(a.metrics.epsYoY).toBeUndefined();
    expect(a.metrics.revenueRises).toBeUndefined();
    expect(a.metrics.marketCapReported).toBeUndefined();
    const text = [a.confidenceEvidence, ...a.dimensions.map((d) => d.evidence ?? "")].join(" ");
    for (const term of ["EPS", "revenue", "P/E", "net margin", "ROE"]) {
      expect(text).not.toContain(term);
    }
  });

  it("(18) released macro values are never labelled live", () => {
    const a = runAnalysis(EUR_USD).fundamentalAssessment!;
    const rendered = [a.confidenceEvidence, ...a.dimensions.map((d) => d.evidence ?? "")].join(" ");
    expect(rendered).not.toMatch(/\bLIVE\b/);
    expect(rendered).not.toMatch(/live (price|quote|market)/i);
    // …and the disclosure that they are NOT live is present verbatim.
    expect(a.limitations.join(" ")).toMatch(/never presented as a live market price/);
    for (const item of a.evidence) {
      if (item.metric.startsWith("inflation:") || item.metric.startsWith("labor:")) {
        expect(item.freshness).not.toBe("FRESH");
      }
    }
  });

  it("(19) identical evidence yields a byte-identical assessment; changed macro changes the assessment", () => {
    const first = runAnalysis(EUR_USD).fundamentalAssessment!;
    const second = runAnalysis(EUR_USD).fundamentalAssessment!;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const flipped = runAnalysis(
      forexInput("EUR/USD", {
        calendarData: calendar(
          US_AND_EU_EVENTS.map((e) =>
            e.currency === "EUR" && e.event === "CPI YoY"
              ? { ...e, actual: 2.6, forecast: 2.3 }
              : e.currency === "USD" && e.event === "CPI YoY"
                ? { ...e, actual: 2.9, forecast: 3.1 }
                : e,
          ),
          ["EUR", "USD"],
        ),
        treasuryData: TREASURY,
        cotData: COT_EUR,
      }),
    ).fundamentalAssessment!;
    expect(flipped.dimensions.find((d) => d.name === "inflation")!.status).toBe("positive");
    expect(flipped.state).not.toBe(first.state);
    // Mixed evidence (policy still favours USD, inflation now favours EUR) gets
    // no direction at all — a direction is never forced from conflict.
    expect(flipped.directionalBias).toBe("none");
    expect(flipped.contradictions.length).toBeGreaterThan(0);

    // A reading that favours ONE side on every scored dimension IS directional.
    const bullish = runAnalysis(
      forexInput("EUR/USD", {
        calendarData: calendar(
          US_AND_EU_EVENTS.map((e) => {
            if (e.event === "CPI YoY") return { ...e, actual: e.currency === "EUR" ? 2.6 : 2.9, forecast: e.currency === "EUR" ? 2.3 : 3.1 };
            if (e.currency === "EUR" && e.event === "ECB Interest Rate Decision") return { ...e, actual: 4.25, forecast: 4.25, previous: 4.0 };
            if (e.currency === "USD" && e.event === "Fed Interest Rate Decision") return { ...e, actual: 5.5, forecast: 5.5, previous: 5.5 };
            return e;
          }),
          ["EUR", "USD"],
        ),
        treasuryData: TREASURY,
        cotData: COT_EUR,
      }),
    ).fundamentalAssessment!;
    expect(bullish.dimensions.find((d) => d.name === "policy-rates")!.status).toBe("positive");
    expect(bullish.dimensions.find((d) => d.name === "inflation")!.status).toBe("positive");
    expect(bullish.state).toBe("improving");
    expect(bullish.directionalBias).toBe("bullish");
    expect(bullish.directionalBiasEvidence).toMatch(/Macro evidence favours EUR over USD/);
  });

  it("(20) without released macro evidence the domain reports UNAVAILABLE and names the missing evidence", () => {
    const a = runAnalysis(forexInput("EUR/USD", {})).fundamentalAssessment!;
    expect(a.domain).toBe("forex");
    expect(a.available).toBe(false);
    expect(a.state).toBe("insufficient");
    expect(a.evidence).toEqual([]);
    expect(a.dimensions.every((d) => d.status === "unavailable")).toBe(true);
    expect(a.limitations.join(" ")).toMatch(/No released macroeconomic measurement was supplied for EUR or USD/i);
    expect(a.dimensions.length).toBe(8);
  });

  it("(21) the unified layer receives the forex assessment with the correct direction", () => {
    const result = runAnalysis(EUR_USD);
    const unified = result.unifiedIntelligence!;
    expect(result.fundamentalAssessment!.domain).toBe("forex");
    expect(unified.fundamental.state).toBe(result.fundamentalAssessment!.state);
    expect(unified.fundamental.state).toBe("weakening");
    expect(unified.fundamental.instrumentId ?? result.fundamentalAssessment!.instrumentId).toBe("EUR/USD");
  });

  it("(22) another currency's releases are never borrowed for an unmeasured base", () => {
    const a = assessFundamentals(undefined, {
      instrument: "XAU/USD",
      instrumentType: "forex",
      providerInstrumentId: "XAU/USD",
      calendar: EUR_USD_CALENDAR,
    });
    expect(a.instrumentId).toBe("XAU/USD");
    // No EUR release is used anywhere: EUR is not a side of XAU/USD.
    expect(a.evidence.every((e) => e.providerInstrumentId !== "EUR")).toBe(true);
    expect(JSON.stringify(a)).not.toContain("ECB");
    // The USD side is measured, the XAU side is explicitly one-sided.
    expect(a.dimensions.find((d) => d.name === "inflation")!.evidence).toContain("base XAU had no released inflation measurement");
    expect(a.evidence.some((e) => e.metric === "inflation:USD")).toBe(true);
  });
});
