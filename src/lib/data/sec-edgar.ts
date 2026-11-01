/**
 * SEC EDGAR company-facts normalization.
 *
 * SEC filing dates are daily point-in-time boundaries, not proof of the exact
 * moment a filing became publicly accessible. acceptanceDateTime is retained
 * as SEC acceptance metadata and must not be relabelled as public-availability
 * time.
 */
export interface SecTickerRecord {
  cik_str: number;
  ticker: string;
  title: string;
}

export interface SecSubmissionRecent {
  accessionNumber?: string[];
  filingDate?: string[];
  acceptanceDateTime?: string[];
  form?: string[];
  reportDate?: string[];
  fy?: number[];
  fp?: string[];
}

export interface SecSubmissions {
  cik?: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  filings?: { recent?: SecSubmissionRecent };
}

interface SecFactUnit {
  accn?: string;
  filed?: string;
  start?: string;
  end?: string;
  val?: number;
  fy?: number;
  fp?: string;
  form?: string;
  frame?: string;
}

interface SecCompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, SecFactUnit[]> }>;
  };
}

export interface SecQuarterlyFundamentalObservation {
  cik: string;
  ticker: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  /** SEC acceptance metadata; not a verified public-availability timestamp. */
  acceptanceDateTime?: string;
  fiscalPeriodStart: string;
  fiscalPeriodEnd: string;
  fiscalYear?: number;
  fiscalPeriod?: string;
  eps?: number;
  revenue?: number;
  epsTag?: string;
  revenueTag?: string;
  sourceUrl: string;
}

const EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"];
const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
];

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function durationDays(start: string, end: string): number {
  return (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000;
}

export function normalizeSecCik(value: string | number): string | null {
  const digits = String(value).replace(/^CIK/i, "").replace(/\D/g, "");
  if (!digits || digits.length > 10) return null;
  return digits.padStart(10, "0");
}

export function findSecTickerRecord(
  ticker: string,
  records: Record<string, SecTickerRecord> | SecTickerRecord[],
): SecTickerRecord | null {
  const normalized = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,15}$/.test(normalized)) return null;
  const values = Array.isArray(records) ? records : Object.values(records);
  return values.find((record) => record.ticker?.toUpperCase() === normalized) ?? null;
}

function factsForTag(
  facts: SecCompanyFacts,
  tags: string[],
  accessionNumber: string,
  filingDate: string,
  unitMatcher: (unit: string) => boolean,
  start: string,
  end: string,
): { value: number; tag: string } | undefined {
  const gaap = facts.facts?.["us-gaap"];
  if (!gaap) return undefined;

  for (const tag of tags) {
    const units = gaap[tag]?.units;
    if (!units) continue;
    for (const [unit, rows] of Object.entries(units)) {
      if (!unitMatcher(unit)) continue;
      const row = rows.find((item) =>
        item.accn === accessionNumber &&
        item.filed === filingDate &&
        item.start === start &&
        item.end === end &&
        typeof item.val === "number" &&
        Number.isFinite(item.val),
      );
      if (row) return { value: row.val!, tag };
    }
  }
  return undefined;
}

/**
 * Selects discrete quarterly facts from SEC companyfacts and joins them to
 * the matching filing accession. YTD/annual durations and comparative facts
 * from other filings are excluded to avoid look-ahead and period mixing.
 */
export function mapSecQuarterlyFundamentals(
  ticker: string,
  cikInput: string | number,
  facts: SecCompanyFacts,
  submissions: SecSubmissions,
): SecQuarterlyFundamentalObservation[] {
  const cik = normalizeSecCik(cikInput);
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!cik || !/^[A-Z0-9.-]{1,15}$/.test(normalizedTicker)) return [];
  if (facts.cik !== undefined && normalizeSecCik(facts.cik) !== cik) return [];
  if (submissions.cik !== undefined && normalizeSecCik(submissions.cik) !== cik) return [];

  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber || !recent.filingDate || !recent.form) return [];
  const output: SecQuarterlyFundamentalObservation[] = [];

  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const accessionNumber = recent.accessionNumber[i];
    const filingDate = recent.filingDate[i];
    const form = recent.form[i];
    if (!accessionNumber || !validDate(filingDate) || !["10-Q", "6-K"].includes(form ?? "")) continue;

    const accessionFacts = Object.values(facts.facts?.["us-gaap"] ?? {})
      .flatMap((entry) => Object.values(entry.units ?? {}).flat())
      .filter((row) => row.accn === accessionNumber && row.filed === filingDate);
    const periods = new Map<string, { start: string; end: string }>();
    for (const row of accessionFacts) {
      if (!validDate(row.start) || !validDate(row.end)) continue;
      const days = durationDays(row.start, row.end);
      if (days < 70 || days > 110) continue;
      periods.set(row.start + "|" + row.end, { start: row.start, end: row.end });
    }

    for (const period of periods.values()) {
      const eps = factsForTag(
        facts, EPS_TAGS, accessionNumber, filingDate,
        (unit) => /USD\s*\/\s*shares?/i.test(unit),
        period.start, period.end,
      );
      const revenue = factsForTag(
        facts, REVENUE_TAGS, accessionNumber, filingDate,
        (unit) => unit === "USD",
        period.start, period.end,
      );
      if (!eps && !revenue) continue;

      const acceptanceDateTime = recent.acceptanceDateTime?.[i];
      output.push({
        cik,
        ticker: normalizedTicker,
        accessionNumber,
        form,
        filingDate,
        acceptanceDateTime: acceptanceDateTime && Number.isFinite(Date.parse(acceptanceDateTime))
          ? acceptanceDateTime
          : undefined,
        fiscalPeriodStart: period.start,
        fiscalPeriodEnd: period.end,
        fiscalYear: recent.fy?.[i],
        fiscalPeriod: recent.fp?.[i],
        eps: eps?.value,
        revenue: revenue?.value,
        epsTag: eps?.tag,
        revenueTag: revenue?.tag,
        sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/`,
      });
    }
  }

  return output.sort((a, b) =>
    a.filingDate.localeCompare(b.filingDate) ||
    a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd) ||
    a.accessionNumber.localeCompare(b.accessionNumber),
  );
}
