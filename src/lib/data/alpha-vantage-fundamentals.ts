import type { FundamentalData } from "./intelligence-types";

type ExtendedEquityMetrics = Pick<
  FundamentalData,
  | "forwardPeRatio"
  | "priceToSalesRatio"
  | "evToRevenue"
  | "evToEbitda"
  | "revenueGrowth"
  | "earningsGrowth"
  | "returnOnAssets"
  | "revenueTTM"
  | "grossProfitTTM"
  | "dilutedEPS"
  | "beta"
  | "sharesOutstanding"
  | "fiftyDayMovingAverage"
  | "twoHundredDayMovingAverage"
>;

function finiteProviderNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Normalize extended documented Alpha Vantage OVERVIEW fields without fabricating zero values. */
export function mapAlphaVantageFundamentalMetrics(raw: unknown): ExtendedEquityMetrics {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const overview = raw as Record<string, unknown>;
  const out: Partial<ExtendedEquityMetrics> = {};
  const mappings: Array<[keyof ExtendedEquityMetrics, string]> = [
    ["forwardPeRatio", "ForwardPE"],
    ["priceToSalesRatio", "PriceToSalesRatioTTM"],
    ["evToRevenue", "EVToRevenue"],
    ["evToEbitda", "EVToEBITDA"],
    ["revenueGrowth", "QuarterlyRevenueGrowthYOY"],
    ["earningsGrowth", "QuarterlyEarningsGrowthYOY"],
    ["returnOnAssets", "ReturnOnAssetsTTM"],
    ["revenueTTM", "RevenueTTM"],
    ["grossProfitTTM", "GrossProfitTTM"],
    ["dilutedEPS", "DilutedEPSTTM"],
    ["beta", "Beta"],
    ["sharesOutstanding", "SharesOutstanding"],
    ["fiftyDayMovingAverage", "50DayMovingAverage"],
    ["twoHundredDayMovingAverage", "200DayMovingAverage"],
  ];
  for (const [target, source] of mappings) {
    const value = finiteProviderNumber(overview[source]);
    if (value !== undefined) (out as Record<string, number>)[target] = value;
  }
  return out;
}