import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  generateRecommendation,
  filterCandidatesWithObservedMarketData,
  type CandidateInput,
} from "./recommendation-engine";

function baseCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    instrument: "TEST/USD",
    assetClass: "crypto",
    currentPrice: 100,
    dataCompleteness: "FULL",
    dataPoints: 200,
    hasLiveData: true,
    freshness: "FRESH",
    providerCoverage: "FULL",
    htfBias: "long",
    mtfAlignment: "ALIGNED_BULLISH",
    marketRegime: "TRENDING",
    atr: 2,
    hasExecutionQuality: true,
    spreadBps: 3,
    riskReward: 2,
    hasAnalysis: false,
    hasDerivatives: false,
    ...overrides,
  };
}

describe("Observed-data fallback eligibility", () => {
  it("rejects discovery placeholders and accepts only candidates with observed market data", () => {
    const candidates = [
      baseCandidate({ instrument: "PLACEHOLDER/USD", currentPrice: 0, dataPoints: 0, hasLiveData: false, freshness: "UNAVAILABLE", providerCoverage: "PARTIAL", dataCompleteness: "MINIMAL" }),
      baseCandidate({ instrument: "NO-CANDLES/USD", dataPoints: 0 }),
      baseCandidate({ instrument: "NO-LIVE/USD", hasLiveData: false }),
      baseCandidate({ instrument: "NO-PRICE/USD", currentPrice: 0 }),
      baseCandidate({ instrument: "NO-PROVIDER/USD", providerCoverage: "NONE" }),
      baseCandidate({ instrument: "BTC/USD" }),
    ];

    expect(filterCandidatesWithObservedMarketData(candidates).map((candidate) => candidate.instrument))
      .toEqual(["BTC/USD"]);
  });

  it("retains observed delayed or stale data for horizon-specific downstream gates", () => {
    const delayed = baseCandidate({ instrument: "DELAYED/USD", freshness: "DELAYED" });
    const stale = baseCandidate({ instrument: "STALE/USD", freshness: "STALE" });

    expect(filterCandidatesWithObservedMarketData([delayed, stale]).map((candidate) => candidate.instrument))
      .toEqual(["DELAYED/USD", "STALE/USD"]);
  });
});

describe("Phase 154 — recommendation ranking integrity", () => {
  it("higher-quality HTF evidence must improve the analytical score", () => {
    const strong = scoreCandidate(
      baseCandidate({ htfBias: "long" }),
      "INTRADAY",
    );

    const neutral = scoreCandidate(
      baseCandidate({ htfBias: "neutral" }),
      "INTRADAY",
    );

    expect(strong.analyticalScore).toBeGreaterThan(neutral.analyticalScore);
  });

  it("differentiates neutral candidates by observed context without creating trade direction", () => {
    const quiet = scoreCandidate(
      baseCandidate({
        setupDirection: "neutral",
        setupStrength: 18,
        confluenceCount: 0,
        htfBias: "neutral",
        mtfAlignment: "MIXED",
        marketRegime: "RANGING",
      }),
      "INTRADAY",
    );
    const active = scoreCandidate(
      baseCandidate({
        setupDirection: "neutral",
        setupStrength: 42,
        confluenceCount: 3,
        htfBias: "neutral",
        mtfAlignment: "MIXED",
        marketRegime: "RANGING",
      }),
      "INTRADAY",
    );

    expect(active.analyticalScore).toBeGreaterThan(quiet.analyticalScore);
    expect(active.confidence).toBeGreaterThan(quiet.confidence);
    expect(quiet.analyticalScore).toBeLessThanOrEqual(45);
    expect(active.analyticalScore).toBeLessThanOrEqual(45);
  });

  it("does not turn an explicitly neutral setup bullish solely from HTF bias", () => {
    const neutralSetup = scoreCandidate(
      baseCandidate({
        setupDirection: "neutral",
        setupStrength: 50,
        confluenceCount: 3,
        htfBias: "long",
        mtfAlignment: "ALIGNED_BULLISH",
        marketRegime: "RANGING",
      }),
      "INTRADAY",
    );
    const unclassifiedSetup = scoreCandidate(
      baseCandidate({
        setupDirection: "unknown",
        setupStrength: 50,
        confluenceCount: 3,
        htfBias: "long",
        mtfAlignment: "ALIGNED_BULLISH",
        marketRegime: "RANGING",
      }),
      "INTRADAY",
    );

    expect(neutralSetup.analyticalScore).toBeLessThanOrEqual(45);
    expect(unclassifiedSetup.analyticalScore).toBeGreaterThan(neutralSetup.analyticalScore);
    expect(neutralSetup.conflicts).toContain("no confirmed directional setup");
  });

  it("preserves measured score differences above the former technical-only ceiling", () => {
    const moderate = scoreCandidate(
      baseCandidate({
        setupStrength: 55,
        confluenceCount: 2,
        fundamentalEvidenceAvailable: false,
        fundamentalScore: undefined,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );
    const strong = scoreCandidate(
      baseCandidate({
        setupStrength: 85,
        confluenceCount: 6,
        fundamentalEvidenceAvailable: false,
        fundamentalScore: undefined,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );

    expect(strong.analyticalScore).toBeGreaterThan(moderate.analyticalScore);
    expect(strong.analyticalScore).toBeGreaterThan(64);
    expect(strong.confidence).toBeGreaterThan(moderate.confidence);
  });

  it("does not label a technical-only high score as a watchlist opportunity", () => {
    const result = generateRecommendation([
      baseCandidate({
        instrument: "TECHNICAL-ONLY/USD",
        setupStrength: 85,
        confluenceCount: 6,
        fundamentalEvidenceAvailable: false,
        fundamentalScore: undefined,
        macroScore: undefined,
        positioningScore: undefined,
      }),
    ], "INTRADAY", { maxResults: 5 });

    expect(result.rankedInstruments).toHaveLength(1);
    expect(result.rankedInstruments[0].analyticalScore).toBeGreaterThan(60);
    expect(result.rankedInstruments[0].suitability).toBe("NEUTRAL");
    expect(result.rankedInstruments[0].conflictingEvidence).toContain("independent directional confirmation unavailable");
  });

  it("lower-quality derivatives evidence is incorporated into the score", () => {
    const without = scoreCandidate(
      baseCandidate({ hasDerivatives: false }),
      "INTRADAY",
    );

    const withDerivatives = scoreCandidate(
      baseCandidate({ hasDerivatives: true }),
      "INTRADAY",
    );

    expect(withDerivatives.analyticalScore).toBeLessThan(without.analyticalScore);
  });

  it("does not treat missing non-technical evidence as opposing directional evidence", () => {
    const missing = scoreCandidate(
      baseCandidate({
        fundamentalEvidenceAvailable: false,
        fundamentalScore: undefined,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );
    const observedNeutral = scoreCandidate(
      baseCandidate({
        fundamentalEvidenceAvailable: true,
        fundamentalScore: 0,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );

    expect(missing.confidence).toBe(observedNeutral.confidence);
    expect(missing.conflicts).toContain("directional fundamental evidence unavailable");
  });

  it("reduces coherence when actual opposing fundamental evidence is present", () => {
    const missing = scoreCandidate(
      baseCandidate({
        fundamentalEvidenceAvailable: false,
        fundamentalScore: undefined,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );
    const opposing = scoreCandidate(
      baseCandidate({
        fundamentalEvidenceAvailable: true,
        fundamentalScore: -2,
        macroScore: undefined,
        positioningScore: undefined,
      }),
      "INTRADAY",
    );

    expect(opposing.confidence).toBeLessThan(missing.confidence);
    expect(opposing.conflicts).toContain("fundamental evidence opposes the technical direction");
  });
});
