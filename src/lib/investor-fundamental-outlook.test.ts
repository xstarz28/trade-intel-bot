import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { mapInstrumentToCot } from "@/lib/data/cot";
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


const ANALYSIS_AT = Date.parse("2026-11-01T12:00:00.000Z");

function providerResult(
  instrument: string,
  instrumentType: string,
  overrides: Record<string, unknown> = {},
): AnalysisResult {
  return {
    instrument,
    instrumentType,
    timestamp: ANALYSIS_AT,
    breakdown: { fundamental: 0 },
    ...overrides,
  } as unknown as AnalysisResult;
}

describe("investor outlook direct provider evidence", () => {
  it("maps CFTC positioning to the exact quote-currency side of an FX pair", () => {
    const instrument = "USD/JPY";
    const mapping = mapInstrumentToCot(instrument);
    expect(mapping?.contractSide).toBe("quote");
    const cotContext = {
      available: true,
      source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
      fetchedAt: ANALYSIS_AT - 60_000,
      freshness: "FRESH",
      requestedInstrument: instrument,
      sourceInstrument: mapping!.sourceInstrument,
      mappedAsset: mapping!.mappedAsset,
      latest: { reportDate: "2026-10-30", openInterest: 100_000 },
      previous: { reportDate: "2026-10-23", openInterest: 100_000 },
      netNonCommercial: 10_000,
      changeFromPreviousReport: 10_000,
    };
    const outlook = buildInvestorFundamentalOutlook(providerResult(instrument, "forex", { cotContext }));
    expect(outlook.evidenceStatus).toBe("VERIFIED");
    expect(outlook.evidence).toHaveLength(1);
    expect(outlook.evidence[0]).toMatchObject({
      category: "POSITIONING",
      direction: "CONFLICTING",
      source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
      asOf: Date.parse("2026-10-30T00:00:00.000Z"),
    });
  });

  it("maps fresh EIA drawdown evidence only to oil instruments", () => {
    const eiaContext = {
      available: true,
      source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
      fetchedAt: ANALYSIS_AT - 60_000,
      freshness: "FRESH",
      series: [{
        productId: "EPC0",
        observationDate: "2026-10-28",
        previousObservationDate: "2026-10-21",
        latestValue: 100,
        previousValue: 101,
        change: -1,
        unit: "million barrels",
      }],
      failedLegs: [],
    };
    const oil = buildInvestorFundamentalOutlook(providerResult("WTI/USD", "commodity", { eiaContext }));
    expect(oil.evidence).toHaveLength(1);
    expect(oil.evidence[0]).toMatchObject({ category: "INVENTORY", direction: "SUPPORTING" });

    const gas = buildInvestorFundamentalOutlook(providerResult("NGAS/USD", "commodity", { eiaContext }));
    expect(gas.evidence).toHaveLength(0);
  });

  it("maps Treasury nominal-yield evidence with correct USD pair orientation", () => {
    const treasuryContext = {
      available: true,
      source: "US Treasury (home.treasury.gov XML feed)",
      fetchedAt: ANALYSIS_AT - 60_000,
      freshness: "FRESH",
      latest: { nominal: { observationDate: "2026-10-30", nominal: { "2Y": 4.2, "10Y": 4.5 } } },
      previous: { nominal: { observationDate: "2026-10-29", nominal: { "2Y": 4.1, "10Y": 4.4 } } },
    };
    const usdBase = buildInvestorFundamentalOutlook(providerResult("USD/JPY", "forex", { treasuryContext }));
    expect(usdBase.evidence[0]).toMatchObject({ category: "MACRO", direction: "SUPPORTING" });

    const usdQuote = buildInvestorFundamentalOutlook(providerResult("EUR/USD", "forex", { treasuryContext }));
    expect(usdQuote.evidence[0]).toMatchObject({ category: "MACRO", direction: "CONFLICTING" });
  });

  it("uses exact-symbol Alpha Vantage analyst-target evidence without requiring a universal wrapper", () => {
    const fundamentalData = {
      available: true,
      provider: "Alpha Vantage",
      symbol: "AAPL",
      timestamp: ANALYSIS_AT - 60 * 60_000,
      analystTargetPrice: 120,
    };
    const outlook = buildInvestorFundamentalOutlook(
      providerResult("AAPL", "stock", { fundamentalData }),
      100,
    );
    expect(outlook.evidence).toHaveLength(1);
    expect(outlook.evidence[0]).toMatchObject({ category: "VALUATION", direction: "SUPPORTING" });
  });

  it("labels an aggregate core fundamental score as degraded rather than independent provider evidence", () => {
    const outlook = buildInvestorFundamentalOutlook(providerResult("SPX", "indices", {
      breakdown: { fundamental: 45 },
      macroData: { timestamp: ANALYSIS_AT - 60 * 60_000, available: true, confidence: "high" },
    }));
    expect(outlook.evidenceStatus).toBe("DEGRADED");
    expect(outlook.evidence[0]).toMatchObject({
      source: "Core fundamental analysis engine",
      category: "FUNDAMENTALS",
      direction: "SUPPORTING",
      quality: "DEGRADED",
    });
  });
});
