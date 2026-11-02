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


describe("SEC EDGAR point-in-time investor evidence", () => {
  it("maps year-over-year revenue and EPS growth using filing date, excluding future filings", () => {
    const secEdgarObservations = [
      {
        ticker: "AAPL", cik: "0000320193", accessionNumber: "0000320193-25-000001",
        form: "10-Q", filingDate: "2025-08-01", acceptanceDateTime: "2025-08-01T12:00:00Z",
        fiscalPeriodStart: "2025-04-01", fiscalPeriodEnd: "2025-06-30", fiscalYear: 2025, fiscalPeriod: "Q2",
        revenue: 100, eps: 1, sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/2025/q2.htm",
      },
      {
        ticker: "AAPL", cik: "0000320193", accessionNumber: "0000320193-26-000001",
        form: "10-Q", filingDate: "2026-08-01", acceptanceDateTime: "2026-08-01T12:00:00Z",
        fiscalPeriodStart: "2026-04-01", fiscalPeriodEnd: "2026-06-30", fiscalYear: 2026, fiscalPeriod: "Q2",
        revenue: 120, eps: 1.5, sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/2026/q2.htm",
      },
      {
        ticker: "AAPL", cik: "0000320193", accessionNumber: "0000320193-26-000099",
        form: "10-Q", filingDate: "2026-11-02", acceptanceDateTime: "2026-11-02T12:00:00Z",
        fiscalPeriodStart: "2026-07-01", fiscalPeriodEnd: "2026-09-30", fiscalYear: 2027, fiscalPeriod: "Q3",
        revenue: 200, eps: 2, sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/2026/q3.htm",
      },
    ];
    const outlook = buildInvestorFundamentalOutlook(
      providerResult("AAPL", "stock", { secEdgarObservations }),
      100,
    );
    expect(outlook.evidenceStatus).toBe("VERIFIED");
    expect(outlook.evidence).toHaveLength(2);
    expect(outlook.evidence.map((item) => item.category).sort()).toEqual(["EPS_GROWTH", "REVENUE_GROWTH"]);
    expect(outlook.evidence.every((item) => item.direction === "SUPPORTING")).toBe(true);
    expect(outlook.evidence.every((item) => item.asOf === Date.parse("2026-08-01T00:00:00.000Z"))).toBe(true);
    expect(outlook.evidence.every((item) => item.source === "SEC EDGAR Form 10-Q")).toBe(true);
  });

  it("uses annual 10-K filings for year-over-year investor fundamentals", () => {
    const secEdgarObservations = [
      {
        ticker: "MSFT", cik: "0000789019", accessionNumber: "0000789019-25-000001",
        form: "10-K", filingDate: "2025-02-10", fiscalPeriodStart: "2024-07-01",
        fiscalPeriodEnd: "2025-06-30", fiscalYear: 2025, fiscalPeriod: "FY",
        revenue: 100, eps: 5, sourceUrl: "https://www.sec.gov/Archives/edgar/data/789019/2025/fy.htm",
      },
      {
        ticker: "MSFT", cik: "0000789019", accessionNumber: "0000789019-26-000001",
        form: "10-K", filingDate: "2026-02-10", fiscalPeriodStart: "2025-07-01",
        fiscalPeriodEnd: "2026-06-30", fiscalYear: 2026, fiscalPeriod: "FY",
        revenue: 120, eps: 6, sourceUrl: "https://www.sec.gov/Archives/edgar/data/789019/2026/fy.htm",
      },
    ];
    const outlook = buildInvestorFundamentalOutlook(
      providerResult("MSFT", "stock", { secEdgarObservations }),
      100,
    );
    expect(outlook.evidenceStatus).toBe("VERIFIED");
    expect(outlook.evidence.map((item) => item.category).sort()).toEqual(["EPS_GROWTH", "REVENUE_GROWTH"]);
    expect(outlook.evidence.every((item) => item.source === "SEC EDGAR Form 10-K")).toBe(true);
    expect(outlook.evidence.every((item) => item.asOf === Date.parse("2026-02-10T00:00:00.000Z"))).toBe(true);
  });

  it("does not create a growth signal without a prior same-period filing", () => {
    const secEdgarObservations = [{
      ticker: "MSFT", cik: "0000789019", accessionNumber: "0000789019-26-000001",
      form: "10-K", filingDate: "2026-10-01", fiscalPeriodStart: "2025-07-01",
      fiscalPeriodEnd: "2026-06-30", fiscalYear: 2026, fiscalPeriod: "FY",
      revenue: 200, eps: 8, sourceUrl: "https://www.sec.gov/Archives/edgar/data/789019/2026/fy.htm",
    }];
    const outlook = buildInvestorFundamentalOutlook(providerResult("MSFT", "stock", { secEdgarObservations }));
    expect(outlook.evidence).toHaveLength(0);
    expect(outlook.evidenceStatus).toBe("UNAVAILABLE");
  });
});
