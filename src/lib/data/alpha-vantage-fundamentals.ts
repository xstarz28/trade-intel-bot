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


function providerDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

/**
 * Map the newest quarterly earnings record while keeping its fiscal period end
 * distinct from the provider's public report date. FiscalDateEnding is not the
 * date the information became available to the market.
 */
export function mapAlphaVantageLatestEarnings(raw: unknown): FundamentalData["latestEarnings"] | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const quarterlyEarnings = (raw as Record<string, unknown>).quarterlyEarnings;
  if (!Array.isArray(quarterlyEarnings) || quarterlyEarnings.length === 0) return undefined;

  const latest = quarterlyEarnings[0];
  if (typeof latest !== "object" || latest === null || Array.isArray(latest)) return undefined;
  const record = latest as Record<string, unknown>;
  const date = providerDate(record.fiscalDateEnding);
  const reportedDate = providerDate(record.reportedDate);
  const eps = finiteProviderNumber(record.reportedEPS);
  const revenue = finiteProviderNumber(record.reportedRevenue);

  if (date === undefined && reportedDate === undefined && eps === undefined && revenue === undefined) {
    return undefined;
  }

  return { date, reportedDate, eps, revenue };
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