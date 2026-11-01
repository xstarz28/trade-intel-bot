import { describe, expect, it } from "vitest";
import { mapAlphaVantageFundamentalMetrics, mapAlphaVantageLatestEarnings } from "./alpha-vantage-fundamentals";

describe("mapAlphaVantageFundamentalMetrics", () => {
  it("maps provider growth, valuation, profitability and scale fields without changing units", () => {
    const result = mapAlphaVantageFundamentalMetrics({
      ForwardPE: "18.4",
      PriceToSalesRatioTTM: "5.2",
      EVToRevenue: "4.1",
      EVToEBITDA: "15.0",
      QuarterlyRevenueGrowthYOY: "0.12",
      QuarterlyEarningsGrowthYOY: "0.22",
      ReturnOnAssetsTTM: "0.08",
      RevenueTTM: "100000000000",
      GrossProfitTTM: "50000000000",
      DilutedEPSTTM: "3.8",
      Beta: "1.2",
      SharesOutstanding: "15000000000",
      "50DayMovingAverage": "120",
      "200DayMovingAverage": "110",
    });
    expect(result).toEqual({
      forwardPeRatio: 18.4,
      priceToSalesRatio: 5.2,
      evToRevenue: 4.1,
      evToEbitda: 15,
      revenueGrowth: 0.12,
      earningsGrowth: 0.22,
      returnOnAssets: 0.08,
      revenueTTM: 100000000000,
      grossProfitTTM: 50000000000,
      dilutedEPS: 3.8,
      beta: 1.2,
      sharesOutstanding: 15000000000,
      fiftyDayMovingAverage: 120,
      twoHundredDayMovingAverage: 110,
    });
  });

  it("omits missing, non-numeric and non-finite provider values instead of fabricating zeros", () => {
    expect(mapAlphaVantageFundamentalMetrics({
      ForwardPE: "None",
      EVToEBITDA: "-",
      QuarterlyRevenueGrowthYOY: "",
      Beta: "NaN",
      RevenueTTM: Number.POSITIVE_INFINITY,
    })).toEqual({});
    expect(mapAlphaVantageFundamentalMetrics(null)).toEqual({});
  });

describe("mapAlphaVantageLatestEarnings", () => {
  it("keeps fiscal period end distinct from the public earnings report date", () => {
    const result = mapAlphaVantageLatestEarnings({
      quarterlyEarnings: [{
        fiscalDateEnding: "2026-09-30",
        reportedDate: "2026-10-28",
        reportedEPS: "1.25",
        reportedRevenue: "1250000000",
      }],
    });

    expect(result).toMatchObject({
      date: "2026-09-30",
      reportedDate: "2026-10-28",
      eps: 1.25,
      revenue: 1250000000,
    });
    expect(result?.reportedDate).not.toBe(result?.date);
  });

  it("does not substitute fiscal period end when publication date is missing or malformed", () => {
    const result = mapAlphaVantageLatestEarnings({
      quarterlyEarnings: [{
        fiscalDateEnding: "2026-09-30",
        reportedDate: "not-a-date",
        reportedEPS: "1.25",
      }],
    });

    expect(result?.date).toBe("2026-09-30");
    expect(result?.reportedDate).toBeUndefined();
  });

  it("rejects malformed earnings dates and empty provider payloads", () => {
    expect(mapAlphaVantageLatestEarnings({
      quarterlyEarnings: [{
        fiscalDateEnding: "2026-02-30",
        reportedDate: "2026-99-99",
        reportedEPS: "None",
        reportedRevenue: "-",
      }],
    })).toBeUndefined();
    expect(mapAlphaVantageLatestEarnings(null)).toBeUndefined();
    expect(mapAlphaVantageLatestEarnings({ quarterlyEarnings: [] })).toBeUndefined();
  });
});

