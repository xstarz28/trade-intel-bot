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
      accn: "0000320193-26-000009",
      filed: "2026-10-29",
      start: "2026-04-01",
      end,
      val: 99,
    });
    gaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({
      accn: accession,
      filed,
      start: "2026-04-01",
      end,
      val: 999,
    });
    const rows = mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions);
    expect(rows).toHaveLength(1);
    expect(rows[0].eps).toBe(1.85);
    expect(rows[0].revenue).toBeUndefined();
  });

  it("rejects CIK mismatches and ignores annual filings", () => {
    const { facts, submissions } = fixtures();
    expect(mapSecQuarterlyFundamentals("AAPL", "0000789019", facts, submissions)).toEqual([]);
    submissions.filings.recent.form = ["10-K"];
    expect(mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions)).toEqual([]);
  });

  it("ignores malformed dates and malformed numeric facts", () => {
    const { facts, submissions } = fixtures();
    submissions.filings.recent.filingDate = ["2026-02-30"];
    expect(mapSecQuarterlyFundamentals("AAPL", cik, facts, submissions)).toEqual([]);
  });
});
