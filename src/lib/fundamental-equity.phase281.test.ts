/**
 * Phase 281 — MODERN EQUITY FUNDAMENTAL INTELLIGENCE (hierarchy, depth,
 * honest gaps).
 *
 * What these proofs establish on top of the Phase 274/275/279 equity contract:
 *   · the equity domain is assessed through the SHARED framework with its own
 *     documented role hierarchy — operating performance (revenue growth, EPS
 *     trend, profitability, cash flow) is primary; earnings quality, balance
 *     sheet and valuation qualify it and can never lead it;
 *   · `insufficient` is not the default: real reported evidence produces
 *     improving/weakening/mixed even though cash-flow and balance-sheet line
 *     items are genuinely absent from the configured provider endpoints;
 *   · confidence counts the TWO independent provider datasets and the
 *     multi-period history, not the number of reported fields — and a stale
 *     reporting period still caps it;
 *   · conflicting primary evidence is mixed at medium confidence; a stretched
 *     multiple against strong operating evidence is a recorded contradiction
 *     that lowers confidence without inventing a direction;
 *   · the explanation cites the assessment's own derived evidence (growth,
 *     profitability, cash flow, balance sheet, valuation, earnings quality,
 *     coverage, periods) — nothing is recomputed for display;
 *   · no symbol-specific branch exists: two different symbols are assessed by
 *     the same code path, each with its own reported periods and numbers.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { assessFundamentals, type FundamentalAssessment } from "./fundamental-engine";
import { normalizeFundamentals, type RawEarnings, type RawOverview } from "./data/alpha-vantage/normalize";
import { EQUITY_DIMENSIONS, EQUITY_HIERARCHY } from "./fundamental/equity";
import { CRYPTO_DIMENSIONS } from "./fundamental/crypto";
import { FOREX_DIMENSIONS } from "./fundamental/forex";

const AV_OBSERVED = Date.parse("2025-07-05T14:00:00Z");
const AV_DATES = [
  "2025-06-30",
  "2025-03-31",
  "2024-12-31",
  "2024-09-30",
  "2024-06-30",
  "2024-03-31",
  "2023-12-31",
  "2023-09-30",
];

/** Provider payload shape: OVERVIEW reported levels + EARNINGS history. */
function equityPayload(options: {
  symbol: string;
  /** Provider payload values — numbers are stringified exactly as AV sends them. */
  revenue: (string | number)[];
  eps: (string | number)[];
  estimates: (string | number)[];
  overview?: Partial<RawOverview>;
  annual?: { fiscalDateEnding: string; reportedEPS: string }[];
}): { overview: RawOverview; earnings: RawEarnings } {
  const overview: RawOverview = {
    Symbol: options.symbol,
    Name: `${options.symbol} Incorporated`,
    Sector: "TECHNOLOGY",
    PERatio: "28.5",
    ForwardPE: "26.1",
    PEGRatio: "1.82",
    PriceToBookRatio: "12.10",
    PriceToSalesRatioTTM: "7.80",
    EVToRevenue: "7.95",
    EVToEBITDA: "22.40",
    DividendYield: "0.0044",
    MarketCapitalization: "3000000000000",
    OperatingMarginTTM: "0.310",
    RevenuePerShareTTM: "24.51",
    ProfitMargin: "0.265",
    ReturnOnEquityTTM: "1.470",
    ReturnOnAssetsTTM: "0.220",
    QuarterlyRevenueGrowthYOY: "0.151",
    QuarterlyEarningsGrowthYOY: "0.178",
    BookValue: "4.38",
    DividendPerShare: "0.98",
    ...options.overview,
  };
  const earnings = {
    quarterlyEarnings: options.eps.map((e, i) => ({
      fiscalDateEnding: AV_DATES[i],
      reportedDate: AV_DATES[i],
      reportedEPS: String(e),
      estimatedEPS: String(options.estimates[i]),
      reportedRevenue: String(options.revenue[i]),
    })),
    annualEarnings: options.annual ?? [
      { fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" },
      { fiscalDateEnding: "2023-09-30", reportedEPS: "5.12" },
    ],
  } as RawEarnings;
  return { overview, earnings };
}

function assessEquity(
  symbol: string,
  payload: { overview: RawOverview; earnings: RawEarnings },
  observedAt = AV_OBSERVED,
): FundamentalAssessment {
  const data = normalizeFundamentals(payload.overview, payload.earnings, "stock", symbol);
  return assessFundamentals({ ...data, timestamp: observedAt }, {
    instrument: symbol,
    instrumentType: "stock",
    provider: "alpha-vantage",
    providerInstrumentId: symbol,
  } as never);
}

const RISING = [1.65, 1.53, 1.5, 1.42, 1.35, 1.28, 1.24, 1.15];
const RISING_ESTIMATES = [1.6, 1.5, 1.45, 1.38, 1.33, 1.25, 1.2, 1.12];
const REVENUE_UP = [
  "94000000000",
  "90000000000",
  "85000000000",
  "81000000000",
  "78000000000",
  "74000000000",
  "71000000000",
  "68000000000",
];
const FALLING = [0.31, 0.44, 0.58, 0.72, 0.85, 0.9, 0.95, 1.0];
const FALLING_ESTIMATES = [0.42, 0.5, 0.6, 0.7, 0.8, 0.86, 0.9, 0.96];
const REVENUE_DOWN = [
  "21000000000",
  "23000000000",
  "25000000000",
  "26000000000",
  "27000000000",
  "28000000000",
  "29000000000",
  "30000000000",
];

const STRONG = assessEquity("MSFT", equityPayload({ symbol: "MSFT", revenue: REVENUE_UP, eps: RISING, estimates: RISING_ESTIMATES }));
const WEAK = assessEquity(
  "TSLA",
  equityPayload({
    symbol: "TSLA",
    revenue: REVENUE_DOWN,
    eps: FALLING,
    estimates: FALLING_ESTIMATES,
    overview: { PERatio: "62.0", ProfitMargin: "-0.041", ReturnOnEquityTTM: "-0.120", ReturnOnAssetsTTM: "-0.050", PEGRatio: undefined },
  }),
);

// ── 1. Hierarchy + honest gaps ──────────────────────────────────

describe("281 equity (C/E) — documented hierarchy over the real evidence", () => {
  it("(1) the role hierarchy is explicit and operating performance leads it", () => {
    const roleOf = (name: string) => EQUITY_HIERARCHY.find((h) => h.name === name)?.role;
    for (const name of ["revenue-growth", "eps-trend", "profitability", "cash-flow"]) {
      expect(roleOf(name)).toBe("primary");
    }
    for (const name of ["earnings-quality", "balance-sheet", "valuation"]) {
      expect(roleOf(name)).toBe("secondary");
    }
    expect(EQUITY_HIERARCHY.map((h) => h.name).sort()).toEqual([...EQUITY_DIMENSIONS].sort());
  });

  it("(2) real reported evidence is improving at high confidence — with a missing family", () => {
    expect(STRONG.available).toBe(true);
    expect(STRONG.domain).toBe("equity");
    expect(STRONG.state).toBe("improving");
    expect(STRONG.confidence).toBe("high");
    expect(STRONG.directionalBias).toBe("bullish");
    // Cash flow is genuinely absent from the configured endpoints — and the
    // assessment is still directional rather than "insufficient".
    expect(STRONG.dimensions.find((d) => d.name === "cash-flow")?.status).toBe("unavailable");
    expect(STRONG.unavailableDimensions).toContain("cash-flow");
    expect(STRONG.unavailableDimensions).toContain("balance-sheet");
    expect(STRONG.confidenceEvidence).toContain("2 independent provider group(s)");
    expect(STRONG.confidenceEvidence).toContain("multi-period history");
  });

  it("(3) secondary-only evidence cannot establish a direction", () => {
    // Only a reported multiple is supplied: nothing primary was measured.
    const sparse = assessEquity(
      "MSFT",
      equityPayload({
        symbol: "MSFT",
        revenue: [],
        eps: [],
        estimates: [],
        overview: {
          PERatio: "22.0",
          // No growth/margin/return evidence at all: only a reported multiple.
          ProfitMargin: undefined,
          ReturnOnEquityTTM: undefined,
          ReturnOnAssetsTTM: undefined,
          QuarterlyRevenueGrowthYOY: undefined,
          QuarterlyEarningsGrowthYOY: undefined,
          OperatingMarginTTM: undefined,
          RevenuePerShareTTM: undefined,
          PEGRatio: undefined,
        },
      }),
    );
    expect(sparse.available).toBe(true);
    expect(sparse.state).not.toBe("insufficient");
    expect(sparse.dimensions.find((d) => d.name === "valuation")?.status).toBe("neutral");
    expect(sparse.directionalBias).toBe("none");
    expect(sparse.confidenceEvidence).toMatch(/every scored dimension is neutral|a primary read is required/);
  });

  it("(4) no provider evidence at all stays insufficient, never fabricated", () => {
    const empty = assessFundamentals(undefined, {
      instrument: "MSFT",
      instrumentType: "stock",
      provider: "alpha-vantage",
      providerInstrumentId: "MSFT",
    } as never);
    expect(empty.available).toBe(false);
    expect(empty.state).toBe("insufficient");
    expect(empty.confidence).toBe("insufficient");
    expect(empty.dimensions.every((d) => d.status === "unavailable")).toBe(true);
  });
});

// ── 2. Changing real evidence changes the result ────────────────

describe("281 equity (C/D) — growth, profitability and valuation drive the state", () => {
  it("(5) two symbols are assessed by the same path with their own periods and numbers", () => {
    expect(STRONG.instrumentId).toBe("MSFT");
    expect(WEAK.instrumentId).toBe("TSLA");
    expect(STRONG.state).toBe("improving");
    expect(WEAK.state).toBe("weakening");
    expect(WEAK.directionalBias).toBe("bearish");
    expect(STRONG.reportingPeriod).toBe("2025-06-30");
    expect(WEAK.reportingPeriod).toBe("2025-06-30");
    expect(WEAK.evidence.every((e) => e.providerInstrumentId === "TSLA")).toBe(true);
    expect(JSON.stringify(WEAK)).not.toContain("MSFT");
    // Same dimension space, different readings.
    expect(STRONG.dimensions.map((d) => d.name)).toEqual(WEAK.dimensions.map((d) => d.name));

    const profitability = WEAK.dimensions.find((d) => d.name === "profitability")!;
    expect(profitability.status).toBe("negative");
    expect(profitability.evidence).toContain("net margin -4.1%");
    expect(STRONG.dimensions.find((d) => d.name === "profitability")?.evidence).toContain("net margin 26.5%");
  });

  it("(6) conflicting PRIMARY evidence is mixed at medium confidence and says why", () => {
    const conflicted = assessEquity(
      "MSFT",
      equityPayload({
        symbol: "MSFT",
        revenue: REVENUE_UP,
        eps: RISING,
        estimates: RISING_ESTIMATES,
        overview: { ProfitMargin: "-0.020", ReturnOnEquityTTM: "-0.100", ReturnOnAssetsTTM: "-0.030" },
      }),
    );
    expect(conflicted.dimensions.find((d) => d.name === "revenue-growth")?.status).toBe("positive");
    expect(conflicted.dimensions.find((d) => d.name === "profitability")?.status).toBe("negative");
    expect(conflicted.state).toBe("mixed");
    expect(conflicted.confidence).toBe("medium");
    expect(conflicted.directionalBias).toBe("none");
    expect(conflicted.confidenceEvidence).toContain("primary evidence conflicts across dimensions");
    expect(conflicted.contradictions.join(" ")).toContain("growth with deteriorating profitability");
  });

  it("(7) a stretched multiple against strong operations is a contradiction that lowers confidence", () => {
    const stretched = assessEquity(
      "MSFT",
      equityPayload({
        symbol: "MSFT",
        revenue: REVENUE_UP,
        eps: RISING,
        estimates: RISING_ESTIMATES,
        overview: { PERatio: "120.0" },
      }),
    );
    expect(stretched.dimensions.find((d) => d.name === "valuation")?.status).toBe("negative");
    expect(stretched.contradictions.join(" ")).toContain("does not keep pace");
    // The operating evidence still stands — but confidence is capped.
    expect(stretched.state).toBe("improving");
    expect(stretched.confidence).toBe("medium");
    expect(STRONG.confidence).toBe("high");
    expect(stretched.confidenceEvidence).toContain("conflicting dimension evidence caps confidence at medium");
  });

  it("(8) an old reporting period reduces freshness and caps confidence — it never becomes live data", () => {
    const stale = assessEquity(
      "MSFT",
      equityPayload({
        symbol: "MSFT",
        revenue: [
          "94000000000",
          "90000000000",
          "85000000000",
          "81000000000",
          "78000000000",
          "74000000000",
          "71000000000",
          "68000000000",
        ],
        eps: RISING,
        estimates: RISING_ESTIMATES,
      }),
      Date.parse("2025-07-05T14:00:00Z"),
    );
    // Same payload, later observation: the period is still the reported one.
    expect(stale.reportingPeriod).toBe("2025-06-30");
    expect(stale.reportAgeDaysAtObservation).toBe(5);

    const old = assessEquity(
      "MSFT",
      {
        overview: { ...equityPayload({ symbol: "MSFT", revenue: REVENUE_UP, eps: RISING, estimates: RISING_ESTIMATES }).overview },
        earnings: {
          quarterlyEarnings: RISING.map((e, i) => ({
            fiscalDateEnding: ["2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30", "2023-06-30", "2023-03-31", "2022-12-31"][i],
            reportedDate: ["2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30", "2023-06-30", "2023-03-31", "2022-12-31"][i],
            reportedEPS: String(e),
            estimatedEPS: String(RISING_ESTIMATES[i]),
            reportedRevenue: String(REVENUE_UP[i]),
          })),
          annualEarnings: [
            { fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" },
            { fiscalDateEnding: "2023-09-30", reportedEPS: "5.12" },
          ],
        } as RawEarnings,
      },
      AV_OBSERVED,
    );
    expect(old.reportingPeriod).toBe("2024-09-30");
    expect(old.reportAgeDaysAtObservation).toBe(278);
    expect(old.confidence).toBe("medium");
    expect(old.confidenceEvidence).toContain("stale reporting period");
    expect(old.summary).toContain("reported statements, never live market data");
  });
});

// ── 3. Explanation + integrity ──────────────────────────────────

describe("281 equity (F/H) — the explanation cites its own evidence", () => {
  it("(9) the summary covers every required family and the assessment's own numbers", () => {
    const summary = STRONG.summary!;
    for (const section of ["Growth:", "Profitability:", "Cash flow:", "Balance sheet:", "Valuation:", "Earnings quality:", "Coverage:", "Assessment:", "Risk:", "Periods:"]) {
      expect(summary).toContain(section);
    }
    expect(summary).toContain(`Assessment: ${STRONG.state} · confidence ${STRONG.confidence} for MSFT.`);
    // Values it states are the ones the assessment carries.
    expect(summary).toContain("net margin 26.5%");
    expect(summary).toContain(STRONG.dimensions.find((d) => d.name === "valuation")!.evidence!);
    expect(summary).toContain("balance-sheet, cash-flow are UNAVAILABLE");
    expect(summary).toContain("reduce completeness only");
  });

  it("(10) the two reported per-share levels are cited, with provenance", () => {
    const dividend = STRONG.evidence.find((e) => e.metric === "dividend_per_share")!;
    expect(dividend.value).toBe(0.98);
    expect(dividend.unit).toBe("USD");
    expect(dividend.provider).toBe("alpha-vantage");
    expect(dividend.source).toContain("OVERVIEW");
    const book = STRONG.evidence.find((e) => e.metric === "book_value_per_share")!;
    expect(book.value).toBe(4.38);
    expect(book.providerInstrumentId).toBe("MSFT");
    expect(STRONG.metrics.dividendPerShare).toBe(0.98);
    expect(STRONG.metrics.bookValuePerShare).toBe(4.38);
  });

  it("(11) every evidence item keeps provider, identity, source and its own period", () => {
    expect(STRONG.evidence.length).toBeGreaterThan(0);
    for (const e of STRONG.evidence) {
      expect(e.provider).toBeTruthy();
      expect(e.providerInstrumentId).toBe("MSFT");
      expect(e.source).toBeTruthy();
      expect(e.observedAt).toBe(AV_OBSERVED);
      expect(e.period).toBeTruthy();
      if (typeof e.value === "number") expect(e.unit).toBeTruthy();
    }
  });

  it("(12) no crypto or forex metric leaks into an equity assessment", () => {
    const bag = STRONG.metrics as unknown as Record<string, unknown>;
    expect(bag.circulatingSupply).toBeUndefined();
    expect(bag.tvlCurrent).toBeUndefined();
    expect(bag.basePolicyRate).toBeUndefined();
    expect(bag.policyRateDifferentialPp).toBeUndefined();
    expect(STRONG.cryptoMetrics).toBeUndefined();
    expect(STRONG.forexMetrics).toBeUndefined();
    const names = STRONG.dimensions.map((d) => d.name) as string[];
    for (const foreign of [...CRYPTO_DIMENSIONS, ...FOREX_DIMENSIONS]) {
      if (!(EQUITY_DIMENSIONS as readonly string[]).includes(foreign)) expect(names).not.toContain(foreign);
    }
    expect(names.sort()).toEqual([...EQUITY_DIMENSIONS].sort());
  });

  it("(14) profitability is level evidence only — no margin trend is claimed", () => {
    const profitability = STRONG.dimensions.find((d) => d.name === "profitability")!;
    expect(profitability.evidence).toContain("Reported:");
    expect(STRONG.summary).toContain("no margin TREND is claimed");
    expect(STRONG.limitations.join(" ")).toContain("not a trend across periods");
    // A level cannot be turned into a trend anywhere in the assessment text.
    expect(STRONG.summary).not.toMatch(/margin (rose|fell|expanded|contracted)/i);
    // Zero margin is neutral by the documented sign rule — never negative-by-default.
    const flat = assessEquity(
      "MSFT",
      equityPayload({
        symbol: "MSFT",
        revenue: REVENUE_UP,
        eps: RISING,
        estimates: RISING_ESTIMATES,
        overview: { ProfitMargin: "0", ReturnOnEquityTTM: undefined, ReturnOnAssetsTTM: undefined },
      }),
    );
    expect(flat.dimensions.find((d) => d.name === "profitability")!.status).toBe("neutral");
  });

  it("(13) the equity path has no symbol-specific branch and no clock", () => {
    const engineSource = fs.readFileSync(path.resolve(__dirname, "fundamental-engine.ts"), "utf8");
    const equitySource = fs.readFileSync(path.resolve(__dirname, "fundamental", "equity.ts"), "utf8");
    for (const source of [engineSource, equitySource]) {
      expect(source).not.toMatch(/switch\s*\(\s*(symbol|ticker)/);
      expect(source).not.toMatch(/symbol\s*===\s*"[A-Z]{1,5}"/);
      expect(source).not.toMatch(/ticker\s*===\s*"[A-Z]{1,5}"/);
    }
    // The provider payload is normalized BEFORE the clock is spied: the
    // acquisition receipt legitimately stamps the payload, while the ASSESSMENT
    // itself must never read the clock.
    const payload = equityPayload({ symbol: "MSFT", revenue: REVENUE_UP, eps: RISING, estimates: RISING_ESTIMATES });
    const normalized = { ...normalizeFundamentals(payload.overview, payload.earnings, "stock", "MSFT"), timestamp: AV_OBSERVED };
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockImplementation(() => {
        throw new Error("Date.now() must not be used on the fundamental path");
      });
      const again = assessFundamentals(normalized, {
        instrument: "MSFT",
        instrumentType: "stock",
        provider: "alpha-vantage",
        providerInstrumentId: "MSFT",
      } as never);
      expect(again.state).toBe(STRONG.state);
      expect(JSON.stringify(again)).toBe(JSON.stringify(STRONG));
    } finally {
      spy.mockRestore();
    }
  });
});
