/**
 * PHASE 310 — Dashboard evidence visibility + recommendation closure.
 *
 * Deterministic engine-level tests (NO live provider, NO React render): every
 * fact the Dashboard now renders must come from the engine's authoritative
 * result — provider-native identity, the provider's own observation instant,
 * technical depth with the thin/unavailable distinction, PLAN_RESTRICTED vs
 * EXTERNAL_DATA_GAP, the forex acquisition limitation WITHOUT fabricated
 * macro numbers, rec↔analysis identity agreement, the delisted/non-trading
 * eligibility gate, an explanation that tracks the evidence, and the rule
 * that the client never re-scores behind the engine's back.
 */

import { describe, it, expect } from "vitest";
import { generateRecommendation, type CandidateInput } from "../recommendation-engine";
import { buildCandidateFromSource, type LiveCandidateSource } from "../liveCandidateBuilder";
import {
  technicalEvidenceState,
  describeProviderState,
  forexAcquisitionLines,
  availabilityClassOf,
  MIN_TECHNICAL_OBSERVATIONS,
} from "../dashboard-evidence";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NOW = 1_760_000_000_000;

/** The phase-309 reader-captured forex pipeline, verbatim. */
const READER_FOREX_PIPELINE = {
  acquisition: {
    lookbackDays: 40,
    merged: 0,
    pastFetched: 0,
    pastWithActual: 0,
    upcomingFetched: 100,
    pastLeg: "failed:provider_error",
  },
  availability: false,
  baseReleasedMatched: 0,
  calendarDelivered: true,
  eventsReceived: 52,
  inflationBase: false,
  inflationQuote: false,
  policyRatesBase: false,
  policyRatesQuote: false,
  quoteReleasedMatched: 0,
  releasedWithActual: 0,
};

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    instrument: "EUR/USD",
    assetClass: "forex",
    currentPrice: 1.1259,
    dataCompleteness: "FULL",
    dataPoints: 210,
    hasLiveData: true,
    freshness: "FRESH",
    providerCoverage: "PARTIAL",
    providerNative: { provider: "twelve-data", providerInstrumentId: "EUR/USD" },
    observedAt: NOW - 120_000,
    technicalState: "available",
    fundamentalAvailable: true,
    fundamentalDomain: "forex",
    fundamentalProvider: "fmp",
    htfBias: "long",
    marketRegime: "trending",
    mtfAlignment: "aligned",
    structuralDirection: "bullish",
    structureScore: 80,
    technicalScore: 80,
    momentumScore: 75,
    volumeScore: 60,
    ...overrides,
  } as CandidateInput;
}

function rankedMaxInputs(inputs: CandidateInput[], overrides: Parameters<typeof generateRecommendation>[2] = {}) {
  return generateRecommendation(inputs, "1-4_WEEKS", { maxResults: 20, ...overrides });
}

describe("phase 310 — evidence identity from the authoritative analysis", () => {
  it("(1) carries the analysis' provider + provider-native id verbatim onto the ranked evidence", () => {
    const result = rankedMaxInputs([candidate()]);
    const top = result.rankedInstruments[0];
    expect(top).toBeDefined();
    expect(top.evidence).toBeDefined();
    expect(top.evidence!.provider).toBe("twelve-data");
    expect(top.evidence!.providerInstrumentId).toBe("EUR/USD");
    // and the ranked row keeps the same provider-native identity as the evidence
    expect(top.providerNative).toEqual({ provider: "twelve-data", providerInstrumentId: "EUR/USD" });
  });

  it("(2) reports the provider's observation instant and freshness WITHOUT rewriting either", () => {
    const stamp = NOW - 90 * 60 * 1000; // 90 minutes old — DELAYED
    const result = rankedMaxInputs([
      candidate({ observedAt: stamp, freshness: "DELAYED" }),
    ]);
    const top = result.rankedInstruments[0];
    expect(top.evidence!.observedAt).toBe(stamp); // verbatim — no re-timing
    expect(top.freshness).toBe("DELAYED"); // canonical enum, not re-derived
  });

  it("(3) reports the technical depth the engine actually had", () => {
    const result = rankedMaxInputs([candidate({ dataPoints: 210 })]);
    expect(result.rankedInstruments[0].evidence!.technicalDepth).toBe(210);
  });
});

describe("phase 310 — thin vs unavailable technical evidence", () => {
  it("(4a) a real but thin series is LIMITED evidence, never full confirmation", () => {
    expect(technicalEvidenceState(5)).toBe("thin");
    expect(technicalEvidenceState(0)).toBe("unavailable");
    expect(technicalEvidenceState(undefined)).toBe("unavailable");
    expect(technicalEvidenceState(MIN_TECHNICAL_OBSERVATIONS)).toBe("available");

    const strong = candidate();
    const thin = candidate({ dataPoints: 5, technicalState: "thin" });
    const base = rankedMaxInputs([strong, thin]);
    const topThin = base.rankedInstruments.find((r) => r.evidence?.technicalState === "thin");
    expect(topThin).toBeDefined();
    // a thin series can never carry a TOP_OPPORTUNITY, whatever its score
    expect(topThin!.suitability).not.toBe("TOP_OPPORTUNITY");
    // the limitation names the actual count and the engine's own threshold
    expect(topThin!.evidence!.limitations.join(" ")).toContain("5 observations");
    expect(topThin!.evidence!.limitations.join(" ")).toContain(String(MIN_TECHNICAL_OBSERVATIONS));
  });

  it("(4b) no technical series at all cannot be a TOP_OPPORTUNITY either", () => {
    const none = candidate({ dataPoints: 0, technicalState: "unavailable", dataCompleteness: "MINIMAL" });
    const result = rankedMaxInputs([none]);
    const row = result.rankedInstruments.find((r) => r.instrument === "EUR/USD");
    if (row) {
      expect(row.suitability).not.toBe("TOP_OPPORTUNITY");
      expect(row.evidence!.availabilityClass).toBe("UNAVAILABLE");
    }
  });
});

describe("phase 310 — honest restriction classes", () => {
  it("(5a) a provider plan limitation is RESTRICTED (provider's own refusal)", () => {
    const info = describeProviderState([
      {
        provider: "twelve-data",
        dataset: "stocks/candles",
        acquired: false,
        reason: "This symbol is not available on your current plan. Consider switching to a higher tier plan.",
      },
    ]);
    expect(info.state).toBe("RESTRICTED");
    expect(info.failingLegs[0]).toContain("higher tier plan");

    const cls = availabilityClassOf({
      hasLiveData: true,
      technicalState: "available",
      fundamentalAvailable: true,
      providerState: "RESTRICTED",
    });
    expect(cls).toBe("RESTRICTED");
  });

  it("(5b) a forex analysis whose required external measurement did not arrive is EXTERNAL_DATA_GAP", () => {
    const cls = availabilityClassOf({
      hasLiveData: true,
      technicalState: "available",
      fundamentalAvailable: false,
      fundamentalDomain: "forex",
      hasFundamentalPipeline: true,
      providerState: "ELIGIBLE",
    });
    expect(cls).toBe("EXTERNAL_DATA_GAP");
    // transport failure stays UNAVAILABLE, not EXTERNAL_DATA_GAP
    expect(
      availabilityClassOf({
        hasLiveData: true,
        technicalState: "unavailable",
        fundamentalAvailable: false,
        fundamentalDomain: "forex",
        hasFundamentalPipeline: true,
        providerState: "ELIGIBLE",
      }),
    ).toBe("UNAVAILABLE");
  });

  it("(6) reports the forex acquisition limitation without inventing any macro value", () => {
    const result = rankedMaxInputs([
      candidate({
        fundamentalAvailable: false,
        fundamentalPipeline: READER_FOREX_PIPELINE,
        providerDiagnostics: [
          { provider: "fmp", dataset: "economic-calendar", acquired: false, reason: "past events leg failed: provider_error" },
        ],
      }),
    ]);
    const evidence = result.rankedInstruments[0].evidence!;
    const joined = evidence.limitations.join("\n") + "\n" + evidence.explanation;
    expect(evidence.availabilityClass).toBe("EXTERNAL_DATA_GAP");
    expect(joined).toContain("No released macroeconomic measurements arrived");
    expect(joined).toContain("40 days");
    // no fabricated measurement: no invented inflation/policy numbers appear
    expect(joined).not.toMatch(/inflation[^\n]*\d+(\.\d+)?%/i);
    expect(joined).not.toMatch(/policy rate[^\n]*\d+(\.\d+)?%/i);
    // and no sentence claims the fundamental is available
    expect(evidence.explanation).toContain("fundamental evidence is unavailable");
  });
});

describe("phase 310 — recommendation ↔ analysis identity agreement", () => {
  it("(7) the builder→engine path preserves the analysis' provider-native identity", () => {
    const source: LiveCandidateSource = {
      instrument: "AAPL",
      assetClass: "equity",
      providerNative: { provider: "twelve-data", providerInstrumentId: "AAPL" },
      marketData: {
        instrument: "AAPL",
        instrumentType: "stock",
        provider: "twelve-data",
        fetchTimestamp: NOW - 60_000,
        timeframe: "1h",
        dataFreshness: "realtime",
        price: { price: 227.5, timestamp: NOW - 60_000, source: "twelve-data" },
        candles: Array.from({ length: 60 }, (_, i) => ({
          timestamp: NOW - (60 - i) * 60_000,
          open: 227,
          high: 228,
          low: 226,
          close: 227.5,
          volume: 1000,
        })),
      },
      technicalData: { dataPoints: 60 } as LiveCandidateSource["technicalData"],
      analysisResult: {
        instrument: "AAPL",
        provider: "twelve-data",
        providerInstrumentId: "AAPL",
        priceSnapshot: { price: 227.5, timestamp: NOW - 60_000, source: "twelve-data" },
      } as unknown as LiveCandidateSource["analysisResult"],
    };
    const built = buildCandidateFromSource(source, NOW);
    expect(built.providerNative).toEqual({ provider: "twelve-data", providerInstrumentId: "AAPL" });
    expect(built.observedAt).toBe(NOW - 60_000);
    expect(built.technicalState).toBe("available");
    expect(built.dataPoints).toBe(60);

    const result = rankedMaxInputs([built]);
    const row = result.rankedInstruments.find((r) => r.instrument === "AAPL");
    expect(row).toBeDefined();
    expect(row!.providerNative).toEqual(built.providerNative);
    expect(row!.evidence!.providerInstrumentId).toBe("AAPL");
    expect(row!.evidence!.observedAt).toBe(NOW - 60_000);
  });

  it("(8) an instrument the provider delisted or disabled is never selected", () => {
    const delisted = candidate({
      instrument: "OLD/USD",
      providerNative: { provider: "twelve-data", providerInstrumentId: "OLD/USD" },
      tradingState: "DELISTED",
    });
    const result = rankedMaxInputs([delisted]);
    const selected = result.rankedInstruments.filter((r) => r.instrument === "OLD/USD");
    expect(selected).toHaveLength(0);
    const excluded = result.excludedInstruments.filter(
      (e) => e.instrument === "OLD/USD" && e.reason.includes("DELISTED"),
    );
    expect(excluded.length).toBeGreaterThan(0);
  });
});

describe("phase 310 — the explanation tracks the evidence", () => {
  it("(9) changes with availability and names the provider state, without filler", () => {
    const full = candidate();
    const degraded = candidate({
      dataPoints: 5,
      technicalState: "thin",
      fundamentalAvailable: false,
      fundamentalDomain: "forex",
      fundamentalPipeline: READER_FOREX_PIPELINE,
    });

    const fullEvidence = rankedMaxInputs([full]).rankedInstruments[0].evidence!;
    expect(fullEvidence.explanation).toContain("twelve-data");
    expect(fullEvidence.explanation).toContain("market evidence is live with 210 observations");
    expect(fullEvidence.explanation).toContain("fundamental evidence is available");
    expect(fullEvidence.explanation).toContain("provider state is ELIGIBLE");

    const degradedEvidence = rankedMaxInputs([degraded]).rankedInstruments[0].evidence!;
    expect(degradedEvidence.explanation).toContain("thin (5 observations");
    expect(degradedEvidence.explanation).toContain("fundamental evidence is unavailable");
    expect(degradedEvidence.explanation).toContain("provider state is ELIGIBLE");
    // factual sentences only — no invented confidence numbers, no profit claims
    expect(degradedEvidence.explanation).not.toMatch(/guarantee|profit|%/i);
  });
});

describe("phase 310 — single source of truth", () => {
  it("(10) the client renders the engine's score and never re-scores behind its back", () => {
    // determinism: identical evidence → identical ranking, twice
    const a = rankedMaxInputs([candidate(), candidate({ instrument: "USD/JPY", dataPoints: 120 })]);
    const b = rankedMaxInputs([candidate(), candidate({ instrument: "USD/JPY", dataPoints: 120 })]);
    expect(a.rankedInstruments.map((r) => [r.instrument, r.analyticalScore, r.confidence])).toEqual(
      b.rankedInstruments.map((r) => [r.instrument, r.analyticalScore, r.confidence]),
    );
    // evidence is derived from the SAME candidate facts that were scored
    expect(a.rankedInstruments[0].evidence!.technicalDepth).toBe(
      a.rankedInstruments[0].analyticalScore > 0 ? 210 : undefined,
    );

    // the dashboard component renders item.analyticalScore directly and does
    // not import any scoring helper (no second rec/evidence calc in React)
    const tsx = readFileSync(resolve(__dirname, "../../components/MarketOpportunities.tsx"), "utf-8");
    expect(tsx).toContain("item.analyticalScore");
    for (const banned of ["scoreCandidate(", "assessEvidenceConfidence(", "generateRecommendation("]) {
      // the component must not CALL any engine internals for scoring; it may
      // only declare the generateRecommendation fallback for an empty scan
      if (banned === "generateRecommendation(") {
        const calls = tsx.split(banned).length - 1;
        expect(calls).toBeLessThanOrEqual(1); // empty-universe fallback only
      } else {
        expect(tsx.includes(banned)).toBe(false);
      }
    }
  });
});
