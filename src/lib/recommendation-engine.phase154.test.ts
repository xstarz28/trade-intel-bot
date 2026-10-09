import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
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
