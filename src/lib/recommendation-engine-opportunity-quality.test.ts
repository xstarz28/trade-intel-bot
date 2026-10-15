import { describe, expect, it } from "vitest";
import { scoreCandidate, type CandidateInput } from "./recommendation-engine";

const baseCandidate: CandidateInput = {
  instrument: "SOL-USDT",
  assetClass: "crypto",
  currentPrice: 100,
  dataCompleteness: "PARTIAL",
  dataPoints: 200,
  hasLiveData: true,
  marketTimeframe: "M5",
  marketType: "spot",
  freshness: "FRESH",
  providerCoverage: "FULL",
  setupDirection: "short",
  setupStrength: 64,
  confluenceCount: 3,
  fundamentalEvidenceAvailable: false,
  positioningEvidenceAvailable: false,
};

describe("recommendation opportunity quality", () => {
  it("does not let an uncorroborated directional read score into the watchlist band", () => {
    const result = scoreCandidate(baseCandidate, "SCALPING");
    expect(result.analyticalScore).toBeLessThanOrEqual(59);
    expect(result.conflicts).toContain("independent directional confirmation unavailable");
  });

  it("keeps neutral structure out of the actionable score band", () => {
    const result = scoreCandidate({ ...baseCandidate, setupDirection: "neutral" }, "SCALPING");
    expect(result.analyticalScore).toBeLessThan(65);
  });
});
