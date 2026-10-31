import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildInvestorFundamentalOutlook } from "./investor-fundamental-outlook";

function cryptoResult(overrides: Record<string, unknown> = {}): AnalysisResult {
  return {
    instrument: "BTC/USD",
    instrumentType: "crypto",
    timestamp: 2_000_000,
    cryptoIntelligenceContext: {
      instrument: "BTC/USD",
      instrumentType: "crypto",
      assembledAt: 1_990_000,
      derivatives: { observedAt: 1_900_000 },
      evidence: [{
        source: "DeFiLlama",
        category: "DEFI_FUNDAMENTAL",
        direction: "SUPPORTING",
        strength: "MODERATE",
        quality: "VERIFIED",
        freshness: "FRESH",
        dependencyGroup: "DEFI_TVL",
        explanation: "TVL evidence",
        providerAvailable: true,
      }],
      overallAvailability: "PARTIAL",
      overallQuality: "VERIFIED",
      missingInformation: [],
      dataFlags: [],
      analystSummary: "fixture",
      ...overrides,
    },
  } as unknown as AnalysisResult;
}

describe("investor fundamental evidence provenance", () => {
  it("does not borrow a derivatives timestamp for DeFi evidence", () => {
    const outlook = buildInvestorFundamentalOutlook(cryptoResult());
    expect(outlook.evidence).toHaveLength(0);
    expect(outlook.evidenceStatus).toBe("UNAVAILABLE");
  });

  it("uses the DeFi sub-context observation timestamp for DeFi evidence", () => {
    const outlook = buildInvestorFundamentalOutlook(cryptoResult({
      defi: { observedAt: 1_950_000 },
    }));
    expect(outlook.evidence).toHaveLength(1);
    expect(outlook.evidence[0].source).toBe("DeFiLlama");
    expect(outlook.evidence[0].asOf).toBe(1_950_000);
  });
});
