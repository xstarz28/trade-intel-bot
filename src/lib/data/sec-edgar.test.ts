import { describe, expect, it } from "vitest";
import {
  findSecTickerRecord,
  mapSecQuarterlyFundamentals,
  normalizeSecCik,
} from "./sec-edgar";

const cik = "0000320193";
const accession = "0000320193-26-000010";
const start = "2026-07-01";
const end = "2026-09-30";
const filed = "2026-10-29";

function fixtures() {
  return {
    facts: {
      cik: 320193,
      facts: {
        "us-gaap": {
          EarningsPerShareDiluted: {
            units: {
              "USD / shares": [{
                accn: accession, filed, start, end, val: 1.85, fy: 2026, fp: "Q3",
              }],
            },
          },
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [{
                accn: accession, filed, start, end, val: 102000000000, fy: 2026, fp: "Q3",
              }],
            },
          },
        },
      },
    },
    submissions: {
      cik,
      filings: {
        recent: {
          accessionNumber: [accession],
          filingDate: [filed],
          acceptanceDateTime: ["2026-10-29T16:31:12.000Z"],
          form: ["10-Q"],
          fy: [2026],
          fp: ["Q3"],
        },
      },
    },
  };
}

describe("SEC EDGAR identity normalization", () => {
  it("normalizes CIK values without inventing an identity", () => {
    expect(normalizeSecCik(320193)).toBe(cik);
    expect(normalizeSecCik("CIK0000320193")).toBe(cik);
    expect(normalizeSecCik("")).toBeNull();
    expect(normalizeSecCik("12345678901")).toBeNull();
  });

  it("resolves exact ticker identity from SEC ticker directory", () => {
    expect(findSecTickerRecord("aapl", {
      apple: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    })?.cik_str).toBe(320193);
    expect(findSecTickerRecord("AAPL;DROP", [])).toBeNull();
    expect(findSecTickerRecord("MISSING", [])).toBeNull();
  });
});

describe("mapSecQuarterlyFundamentals", () => {
  it("joins EPS and revenue only to the matching quarterly filing accession", () => {
    const { facts, submissions } = fixtures();
    const rows = mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticker: "AAPL",
      cik,
      accessionNumber: accession,
      form: "10-Q",
      filingDate: filed,
      acceptanceDateTime: "2026-10-29T16:31:12.000Z",
      fiscalPeriodStart: start,
      fiscalPeriodEnd: end,
      eps: 1.85,
      revenue: 102000000000,
    });
    expect(rows[0].sourceUrl).toContain("/000032019326000010/");
  });

  it("does not treat SEC acceptance time as an exact public-availability timestamp", () => {
    const { facts, submissions } = fixtures();
    const [row] = mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions);
    expect(row.filingDate).toBe(filed);
    expect(row.acceptanceDateTime).toBe("2026-10-29T16:31:12.000Z");
    expect(row).not.toHaveProperty("publiclyAvailableAt");
  });

  it("rejects comparative facts from another accession and YTD durations", () => {
    const { facts, submissions } = fixtures();
    const gaap = facts.facts["us-gaap"];
    gaap.EarningsPerShareDiluted.units["USD / shares"].push({
      accn: accession,
      filed,
      start: "2025-07-01",
      end: "2025-09-30",
      val: 77,
      fy: 2025,
      fp: "Q3",
    });
    gaap.EarningsPerShareDiluted.units["USD / shares"].push({
      accn: "0000320193-26-000009",
      filed: "2026-10-29",
      start: "2026-04-01",
      end,
      val: 99,
      fy: 2026,
      fp: "Q3",
    });
    gaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({
      accn: accession,
      filed,
      start: "2026-04-01",
      end,
      val: 999,
      fy: 2026,
      fp: "Q3",
    });
    const rows = mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions);
    expect(rows).toHaveLength(1);
    expect(rows[0].eps).toBe(1.85);
    expect(rows[0].revenue).toBe(102000000000);
  });

  it("rejects CIK mismatches", () => {
    const { facts, submissions } = fixtures();
    expect(mapSecQuarterlyFundamentals("AAPL", "0000789019", facts, submissions)).toEqual([]);
  });

  it("maps annual 10-K facts only for the SEC report date, excluding comparative annual periods", () => {
    const annualAccession = "0000320193-26-000020";
    const annualStart = "2025-01-01";
    const annualEnd = "2025-12-31";
    const annualFiled = "2026-02-10";
    const annualFacts = {
      cik: 320193,
      facts: {
        "us-gaap": {
          EarningsPerShareDiluted: {
            units: {
              "USD / shares": [
                { accn: annualAccession, filed: annualFiled, start: annualStart, end: annualEnd, val: 7.25, fy: 2025, fp: "FY" },
                { accn: annualAccession, filed: annualFiled, start: "2024-01-01", end: "2024-12-31", val: 6.10, fy: 2025, fp: "FY" },
              ],
            },
          },
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { accn: annualAccession, filed: annualFiled, start: annualStart, end: annualEnd, val: 410_000_000_000, fy: 2025, fp: "FY" },
                { accn: annualAccession, filed: annualFiled, start: "2024-01-01", end: "2024-12-31", val: 390_000_000_000, fy: 2025, fp: "FY" },
              ],
            },
          },
        },
      },
    };
    const annualSubmissions = {
      cik,
      filings: {
        recent: {
          accessionNumber: [annualAccession],
          filingDate: [annualFiled],
          reportDate: [annualEnd],
          acceptanceDateTime: ["2026-02-10T16:31:12.000Z"],
          form: ["10-K"],
          fy: [2025],
          fp: ["FY"],
        },
      },
    };
    const rows = mapSecQuarterlyFundamentals("AAPL", cik, annualFacts, annualSubmissions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      form: "10-K",
      filingDate: annualFiled,
      fiscalPeriodStart: annualStart,
      fiscalPeriodEnd: annualEnd,
      fiscalYear: 2025,
      fiscalPeriod: "FY",
      eps: 7.25,
      revenue: 410_000_000_000,
    });
  });

  it("ignores malformed dates and malformed numeric facts", () => {
    const { facts, submissions } = fixtures();
    submissions.filings.recent.filingDate = ["2026-02-30"];
    expect(mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions)).toEqual([]);
  });
});
