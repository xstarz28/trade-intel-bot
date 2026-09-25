/**
 * Phase 279 — CROSS-DOMAIN contract + UI + equity-depth regression contract.
 *
 * Task C/D/E/G of the phase. One contract, one deterministic framework, FOUR
 * domain adapters — and the existing UI rendering whichever domain the engine
 * produced, without recomputing anything.
 *
 * What these proofs establish:
 *   · all four domains return the SAME contract shape (dimensions, evidence,
 *     coverage, contradictions, limitations, unavailable dimensions);
 *   · no metric leaks across domains — dimension names are disjoint, the
 *     domain-specific metric objects never carry another domain's fields, and a
 *     token has no EPS while a currency pair has no revenue;
 *   · provider-native identity is preserved in every domain;
 *   · HISTORICAL vs live is preserved: publication datasets are classified
 *     HISTORICAL with an acquisition-receipt instant, fiscal periods stay
 *     reported periods, released macro values stay releases;
 *   · missing evidence is never fabricated in any domain;
 *   · the unified layer receives the CORRECT domain assessment;
 *   · the radar still consumes the unified result (Phase 277 policy untouched);
 *   · the equity domain is deepened with the remaining as-reported fields, with
 *     balance-sheet / cash-flow / peer valuation explicitly unavailable;
 *   · the existing Fundamental UI section renders the domain assessment
 *     verbatim and React recalculates nothing.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";

import { I18nProvider } from "./i18n";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { assessFundamentals, type FundamentalAssessment } from "./fundamental-engine";
import { calculateTechnical } from "./data/technical";
import { buildUnifiedIntelligence } from "./unified-intelligence";
import { scanRadar } from "./market-radar/radar";
import type { RadarCandidateSource } from "./market-radar/candidate-builder";
import { normalizeFundamentals, type RawEarnings, type RawOverview } from "./data/alpha-vantage/normalize";
import type { FundamentalData } from "./data/intelligence-types";
import type { OhlcvCandle } from "./data/market-types";
import type { CryptoIntelligenceContext } from "./data/crypto/types";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import type { EconomicCalendarData } from "./data/calendar-types";
import type { EiaData } from "./data/eia";
import type { CotData } from "./data/cot";
import type { TreasuryData } from "./data/treasury";
import { COMMODITY_DIMENSIONS } from "./fundamental/commodity";
import { CRYPTO_DIMENSIONS } from "./fundamental/crypto";
import { FOREX_DIMENSIONS } from "./fundamental/forex";
import { AnalysisResultDisplay } from "../components/AnalysisResult";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));

/** Code only: block comments and line comments removed before static scans. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const BAR_MS = 900_000;
const END_TS = Date.parse("2025-07-04T20:00:00Z");
const NOW = Date.parse("2025-07-05T14:30:00Z");

function candles(n: number, start: number, slope: number): OhlcvCandle[] {
  const amp = Math.max(4, Math.abs(slope) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = start + slope * j + amp * Math.sin(j * 0.55);
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - slope / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const UPTREND = candles(210, 40_000, 40);
const FX_CANDLES = candles(210, 1.085, 0.00002);

// ── Equity fixture (Alpha Vantage response shapes) ───────────────

const AV_DATES = ["2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30"];
const AV_OBSERVED = Date.parse("2025-07-05T14:00:00Z");

function equityFundamentals(overrides: Partial<RawOverview> = {}): FundamentalData {
  const eps = ["1.65", "1.53", "1.50", "1.42", "1.35", "1.28", "1.24", "1.15"];
  const estimates = ["1.60", "1.50", "1.45", "1.38", "1.33", "1.25", "1.20", "1.12"];
  const revenue = ["94000000000", "90000000000", "85000000000", "81000000000", "78000000000", "74000000000", "71000000000", "68000000000"];
  const overview: RawOverview = {
    Symbol: "MSFT",
    Name: "Microsoft Corporation",
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
    ...overrides,
  };
  const earnings: RawEarnings = {
    quarterlyEarnings: eps.map((e, i) => ({
      fiscalDateEnding: AV_DATES[i],
      reportedDate: AV_DATES[i],
      reportedEPS: e,
      estimatedEPS: estimates[i],
      reportedRevenue: revenue[i],
    })),
    annualEarnings: [
      { fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" },
      { fiscalDateEnding: "2023-09-30", reportedEPS: "5.12" },
    ],
  } as RawEarnings;
  const data = normalizeFundamentals(overview, earnings, "stock", "MSFT");
  return { ...data, timestamp: AV_OBSERVED };
}

// ── Crypto fixture ──────────────────────────────────────────────

const CRYPTO_OBSERVED = Date.parse("2025-07-04T19:05:00Z");

const CRYPTO_CTX: CryptoIntelligenceContext = {
  instrument: "BTC-USDT",
  instrumentType: "crypto",
  assembledAt: CRYPTO_OBSERVED,
  tokenomics: {
    provider: "Tokenomist",
    observedAt: CRYPTO_OBSERVED,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    supply: { circulatingSupply: 19_850_000, totalSupply: 21_000_000, circulatingPercent: 94.52, reliable: true },
    unlocks: { upcomingCount30d: 0, reliable: true },
    availableDatasets: 2,
    totalDatasets: 2,
  },
  defi: {
    provider: "DeFiLlama",
    observedAt: CRYPTO_OBSERVED,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    tvl: { current: 61_000_000_000, change7d: 1.1, change30d: 3.4, reliable: true },
    fees: { dailyFees: 1_100_000, reliable: true },
    availableDatasets: 2,
    totalDatasets: 2,
  },
  evidence: [],
  overallAvailability: "FULL",
  overallQuality: "VERIFIED",
  missingInformation: [],
  dataFlags: [],
  analystSummary: "fixture",
};

const DERIVATIVES: CryptoDerivativesData = {
  provider: "coinglass",
  symbol: "BTC",
  timestamp: Date.parse("2025-07-04T19:00:00Z"),
  freshness: "realtime",
  openInterest: { current: 12_345_678, change1h: 1.2, change24h: -2.4 },
  fundingRate: { currentRate: 0.0001 },
  longShort: { accountRatio: 1.12 },
  liquidations: { dominantSide: "longs" },
  availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
  confidence: "high",
};

// ── Forex fixture ───────────────────────────────────────────────

const CALENDAR: EconomicCalendarData = {
  provider: "tickatlas",
  events: [
    {
      id: "eur-rate",
      event: "ECB Interest Rate Decision",
      category: "Interest Rate",
      country: "Euro Area",
      currency: "EUR",
      datetime: Date.parse("2025-06-06T11:45:00Z"),
      actual: 4.0,
      forecast: 4.0,
      previous: 3.75,
      importance: 3,
      source: "TickAtlas",
      referencePeriod: "June 2025",
      status: "released",
    },
    {
      id: "usd-rate",
      event: "Fed Interest Rate Decision",
      category: "Interest Rate",
      country: "United States",
      currency: "USD",
      datetime: Date.parse("2025-06-18T18:00:00Z"),
      actual: 5.5,
      forecast: 5.5,
      previous: 5.25,
      importance: 3,
      source: "TickAtlas",
      referencePeriod: "June 2025",
      status: "released",
    },
    {
      id: "eur-cpi",
      event: "CPI YoY",
      category: "Inflation",
      country: "Euro Area",
      currency: "EUR",
      datetime: Date.parse("2025-06-19T09:00:00Z"),
      actual: 2.1,
      forecast: 2.3,
      previous: 2.4,
      importance: 3,
      source: "TickAtlas",
      referencePeriod: "May 2025",
      status: "released",
    },
    {
      id: "usd-cpi",
      event: "CPI YoY",
      category: "Inflation",
      country: "United States",
      currency: "USD",
      datetime: Date.parse("2025-06-12T12:30:00Z"),
      actual: 3.3,
      forecast: 3.1,
      previous: 3.4,
      importance: 3,
      source: "TickAtlas",
      referencePeriod: "May 2025",
      status: "released",
    },
  ],
  macroRisk: { level: "medium", explanation: "CPI window", highImpact24h: 0, highImpact72h: 1 },
  timestamp: Date.parse("2025-07-04T19:30:00Z"),
  freshness: "recent",
  confidence: "high",
  availability: { upcoming24h: false, upcoming72h: true, recentReleased: true },
};

// ── Commodity fixture — the three providers the repository really has ──

const EIA_FETCHED = Date.parse("2025-07-04T18:10:00Z");
const COT_FETCHED = Date.parse("2025-07-04T18:20:00Z");
const TREASURY_FETCHED = Date.parse("2025-07-04T18:30:00Z");

const EIA_WTI: EiaData = {
  available: true,
  source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
  fetchedAt: EIA_FETCHED,
  freshness: "FRESH",
  series: [
    {
      productId: "EPC0",
      productName: "Crude Oil Excluding SPR",
      observationDate: "2025-07-02",
      previousObservationDate: "2025-06-25",
      latestValue: 442.1,
      previousValue: 446.5,
      change: -4.4,
      changePercent: -0.99,
      unit: "million barrels",
    },
    {
      productId: "EPM0",
      productName: "Finished Motor Gasoline",
      observationDate: "2025-07-02",
      previousObservationDate: "2025-06-25",
      latestValue: 231.2,
      previousValue: 228.9,
      change: 2.3,
      changePercent: 1.0,
      unit: "million barrels",
    },
  ],
  failedLegs: [],
};

function cotFor(instrument: string, sourceInstrument: string, mappedAsset: string, net: number, change: number): CotData {
  const long = 200_000 + Math.round(net / 2);
  const short = long - net;
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: COT_FETCHED,
    freshness: "FRESH",
    requestedInstrument: instrument,
    sourceInstrument,
    mappedAsset,
    latest: {
      reportDate: "2025-07-01",
      nonCommercialLong: long,
      nonCommercialShort: short,
      commercialLong: 120_000,
      commercialShort: 320_000,
      openInterest: 520_000,
    },
    previous: {
      reportDate: "2025-06-24",
      nonCommercialLong: long - change,
      nonCommercialShort: short,
      openInterest: 505_000,
    },
    netNonCommercial: net,
    changeFromPreviousReport: change,
  };
}

const COT_GOLD = cotFor("XAU/USD", "GOLD - COMMODITY EXCHANGE INC.", "Gold futures (COMEX)", 216_000, 19_000);
const COT_WTI = cotFor(
  "WTI",
  "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
  "WTI Crude Oil futures (NYMEX)",
  -42_000,
  -6_000,
);

const TREASURY: TreasuryData = {
  available: true,
  source: "US Treasury (home.treasury.gov XML feed)",
  fetchedAt: TREASURY_FETCHED,
  freshness: "FRESH",
  latest: {
    nominal: { observationDate: "2025-07-03", nominal: { "2Y": 4.12, "10Y": 4.35 } },
    real: { observationDate: "2025-07-03", real: { "10Y": 2.05 } },
  },
  previous: {
    nominal: { observationDate: "2025-07-02", nominal: { "2Y": 4.1, "10Y": 4.28 } },
    real: { observationDate: "2025-07-02", real: { "10Y": 1.98 } },
  },
};

// ── Input builders ──────────────────────────────────────────────

function inputProvider(instrumentType: string): string {
  if (instrumentType === "crypto") return "okx";
  if (instrumentType === "forex" || instrumentType === "commodity") return "twelve-data";
  return "alpha-vantage";
}

function input(instrument: string, instrumentType: string, extra: Partial<AnalysisInput>): AnalysisInput {
  const cs = instrumentType === "forex" ? FX_CANDLES : UPTREND;
  const last = cs[cs.length - 1];
  return {
    instrument,
    instrumentType,
    timeframe: instrumentType === "forex" ? "H1" : "H4",
    tradingStyle: "intraday",
    provider: inputProvider(instrumentType),
    providerInstrumentId: instrument,
    marketData: {
      instrument,
      instrumentType,
      provider: inputProvider(instrumentType),
      providerInstrumentId: instrument,
      price: { price: last.close, timestamp: last.timestamp, source: "provider" },
      candles: cs,
      timeframe: "H4",
      fetchTimestamp: last.timestamp,
      dataFreshness: "realtime",
    },
    technicalData: calculateTechnical(cs),
    ...extra,
  } as AnalysisInput;
}

const EQUITY_RESULT = runAnalysis(
  input("MSFT", "stock", { fundamentalData: equityFundamentals() }),
);
const CRYPTO_RESULT = runAnalysis(
  input("BTC-USDT", "crypto", { cryptoIntelligenceContext: CRYPTO_CTX, derivativesData: DERIVATIVES }),
);
const FOREX_RESULT = runAnalysis(input("EUR/USD", "forex", { calendarData: CALENDAR }));
const COMMODITY_RESULT = runAnalysis(
  input("XAU/USD", "commodity", { cotData: COT_GOLD, treasuryData: TREASURY }),
);
const COMMODITY_OIL_RESULT = runAnalysis(
  input("WTI", "commodity", { eiaData: EIA_WTI, cotData: COT_WTI, treasuryData: TREASURY }),
);

const DOMAINS: Array<[string, FundamentalAssessment]> = [
  ["equity", EQUITY_RESULT.fundamentalAssessment!],
  ["crypto", CRYPTO_RESULT.fundamentalAssessment!],
  ["forex", FOREX_RESULT.fundamentalAssessment!],
  ["commodity", COMMODITY_RESULT.fundamentalAssessment!],
];

const EQUITY_DIMENSIONS = [
  "revenue-growth",
  "eps-trend",
  "profitability",
  "earnings-quality",
  "valuation",
  "balance-sheet",
  "cash-flow",
];

// ── 1. One contract, four domains ───────────────────────────────

describe("279 cross-domain (D) — one contract for every asset class", () => {
  it("(1) every domain returns the same contract shape", () => {
    for (const [domain, a] of DOMAINS) {
      expect(a.domain).toBe(domain);
      expect(a.available).toBe(true);
      expect(typeof a.provider).toBe("string");
      expect(typeof a.instrumentId).toBe("string");
      expect(["improving", "weakening", "mixed", "insufficient"]).toContain(a.state);
      expect(["high", "medium", "low", "insufficient"]).toContain(a.confidence);
      expect(a.confidenceEvidence.length).toBeGreaterThan(0);
      expect(Array.isArray(a.dimensions)).toBe(true);
      expect(Array.isArray(a.evidence)).toBe(true);
      expect(Array.isArray(a.contradictions)).toBe(true);
      expect(Array.isArray(a.unavailableDimensions)).toBe(true);
      expect(Array.isArray(a.limitations)).toBe(true);
      expect(a.evidenceCoverage.dimensionsTotal).toBe(a.dimensions.length);
      expect(a.evidenceCoverage.dimensionsAvailable).toBe(
        a.dimensions.filter((d) => d.status !== "unavailable").length,
      );
      expect(["bullish", "bearish", "none"]).toContain(a.directionalBias);
      for (const d of a.dimensions) {
        expect(["positive", "negative", "neutral", "unavailable"]).toContain(d.status);
      }
    }
  });

  it("(2) every evidence item carries provider, identity, source, instant, unit or an unavailable reason", () => {
    for (const [, a] of DOMAINS) {
      for (const item of a.evidence) {
        expect(item.provider.length).toBeGreaterThan(0);
        expect(item.source.length).toBeGreaterThan(0);
        expect(typeof item.observedAt).toBe("number");
        expect(item.observedAt).toBeGreaterThan(0);
        expect(item.value === undefined || item.unit !== undefined).toBe(true);
        expect(item.derived === true ? typeof item.basis === "string" : true).toBe(true);
      }
    }
  });

  it("(3) dimension names never overlap between domains", () => {
    const names = (a: FundamentalAssessment) => a.dimensions.map((d) => d.name);
    // Every PAIR of domains must be disjoint, so no card can ever render
    // another asset class's dimension.
    for (let i = 0; i < DOMAINS.length; i++) {
      for (let j = i + 1; j < DOMAINS.length; j++) {
        const [domainA, a] = DOMAINS[i];
        const [domainB, b] = DOMAINS[j];
        const namesA = new Set(names(a));
        for (const n of names(b)) {
          expect(namesA.has(n), `${domainA} and ${domainB} share the dimension "${n}"`).toBe(false);
        }
      }
    }
    // …and each domain declares exactly the dimension space it owns.
    expect(names(DOMAINS[0][1]).sort()).toEqual([...EQUITY_DIMENSIONS].sort());
    expect(names(DOMAINS[1][1]).sort()).toEqual([...CRYPTO_DIMENSIONS].sort());
    expect(names(DOMAINS[2][1]).sort()).toEqual([...FOREX_DIMENSIONS].sort());
    expect(names(DOMAINS[3][1]).sort()).toEqual([...COMMODITY_DIMENSIONS].sort());
  });

  it("(4) domain metric objects never carry another domain's fields", () => {
    const equity = DOMAINS[0][1];
    const crypto = DOMAINS[1][1];
    const forex = DOMAINS[2][1];
    const commodity = DOMAINS[3][1];

    // The domain-specific metric objects exist ONLY for their own domain.
    expect(equity.cryptoMetrics).toBeUndefined();
    expect(equity.forexMetrics).toBeUndefined();
    expect(equity.commodityMetrics).toBeUndefined();
    expect(crypto.commodityMetrics).toBeUndefined();
    expect(forex.commodityMetrics).toBeUndefined();
    expect(commodity.cryptoMetrics).toBeUndefined();
    expect(commodity.forexMetrics).toBeUndefined();

    // Non-equity domains never populate the equity metric bag.
    expect(crypto.metrics).toEqual({});
    expect(forex.metrics).toEqual({});
    expect(commodity.metrics).toEqual({});

    expect(crypto.cryptoMetrics?.circulatingSupply).toBe(19_850_000);
    expect("epsYoY" in (crypto.cryptoMetrics ?? {})).toBe(false);
    expect(forex.forexMetrics?.policyRateDifferentialPp).toBeCloseTo(-1.5, 6);
    expect("circulatingSupply" in (forex.forexMetrics ?? {})).toBe(false);

    // The commodity numbers are the provider ones — and commodities carry no
    // equity, crypto or forex metric at all.
    const oil = COMMODITY_OIL_RESULT.fundamentalAssessment!;
    expect(commodity.commodityMetrics?.inventoryLatest).toBeUndefined(); // gold has no EIA stock series
    expect(commodity.commodityMetrics?.futuresPositioningNet).toBe(216_000);
    expect(commodity.commodityMetrics?.real10yYieldPercent).toBe(2.05);
    expect(oil.commodityMetrics?.inventoryLatest).toBe(442.1);
    expect(oil.commodityMetrics?.inventoryChangeWoW).toBe(-4.4);
    expect(oil.commodityMetrics?.inventoryLegsAvailable).toBe(2);
    expect(oil.commodityMetrics?.futuresPositioningNet).toBe(-42_000);
    expect("epsYoY" in (commodity.commodityMetrics ?? {})).toBe(false);
    expect("circulatingSupply" in (commodity.commodityMetrics ?? {})).toBe(false);

    expect(equity.metrics.epsYoY).toBeCloseTo(1.65 / 1.35 - 1, 6);
    expect("circulatingSupply" in equity.metrics).toBe(false);
    expect("policyRateDifferentialPp" in equity.metrics).toBe(false);
    expect("inventoryLatest" in equity.metrics).toBe(false);
  });

  it("(5) provider-native identity is preserved per domain", () => {
    expect(DOMAINS[0][1].instrumentId).toBe("MSFT");
    expect(DOMAINS[1][1].instrumentId).toBe("BTC-USDT");
    expect(DOMAINS[2][1].instrumentId).toBe("EUR/USD");
    expect(DOMAINS[3][1].instrumentId).toBe("XAU/USD");
    expect(DOMAINS[1][1].evidence.every((e) => e.providerInstrumentId !== "MSFT")).toBe(true);
    expect(DOMAINS[2][1].evidence.every((e) => e.providerInstrumentId !== "BTC")).toBe(true);
    expect(DOMAINS[3][1].evidence.every((e) => e.providerInstrumentId !== "EUR/USD")).toBe(true);
    const oil = COMMODITY_OIL_RESULT.fundamentalAssessment!;
    expect(oil.evidence.every((e) => e.providerInstrumentId === "WTI")).toBe(true);
    expect(oil.evidence.find((e) => e.metric === "cot_net_non_commercial")!.source).toMatch(
      /NEW YORK MERCANTILE EXCHANGE/,
    );
    expect(oil.evidence.every((e) => !/XAU|GOLD/i.test(e.source))).toBe(true);
  });
});

// ── 2. Historical vs live, and no fabrication ───────────────────

describe("279 cross-domain (D) — reported/historical evidence is never presented as live", () => {
  it("(6) publication datasets are HISTORICAL with an acquisition-receipt instant", () => {
    const crypto = DOMAINS[1][1];
    const publication = crypto.evidence.filter((e) => e.provider === "Tokenomist" || e.provider === "DeFiLlama");
    expect(publication.length).toBeGreaterThan(0);
    for (const item of publication) {
      expect(item.freshness).toBe("HISTORICAL");
      expect(item.observedAtSemantics).toBe("acquisition-receipt");
      expect(item.observedAt).toBe(CRYPTO_OBSERVED);
    }
    expect(crypto.limitations.join(" ")).toMatch(/ACQUISITION RECEIPT/);
    expect(crypto.limitations.join(" ")).toMatch(/never presented as a live quote/);
  });

  it("(7) the derivatives payload keeps its PROVIDER observation instant and freshness", () => {
    const crypto = DOMAINS[1][1];
    const oi = crypto.evidence.find((e) => e.metric === "open_interest")!;
    expect(oi.observedAt).toBe(DERIVATIVES.timestamp);
    expect(oi.observedAtSemantics).toBeUndefined();
    expect(oi.freshness).toBe("realtime");
  });

  it("(8) fiscal periods stay reported periods, with the report-age disclosure", () => {
    const equity = DOMAINS[0][1];
    expect(equity.reportingPeriod).toBe("2025-06-30");
    expect(equity.reportAgeDaysAtObservation).toBe(5);
    expect(equity.evidence.every((e) => e.observedAt === AV_OBSERVED)).toBe(true);
    expect(equity.limitations.join(" ")).toMatch(/reported disclosure, distinct from any live market price/);
  });

  it("(9) released macro values keep their release instant and reference period", () => {
    const forex = DOMAINS[2][1];
    const cpi = forex.evidence.find((e) => e.metric === "inflation:EUR")!;
    expect(cpi.period).toBe("May 2025");
    expect(cpi.observedAt).toBe(Date.parse("2025-06-19T09:00:00Z"));
    expect(forex.limitations.join(" ")).toMatch(/never presented as a live market price/);
  });

  it("(9b) commodity measurement periods and acquisition receipts are preserved", () => {
    const gold = DOMAINS[3][1];
    const oil = COMMODITY_OIL_RESULT.fundamentalAssessment!;

    // Gold: CFTC report + Treasury observation only — the EIA leg never runs
    // for a non-petroleum instrument, and no inventory number is invented.
    expect(gold.reportingPeriod).toBe("2025-07-03");
    expect(gold.evidence.some((e) => e.metric === "inventory_wpsr")).toBe(false);
    const goldCot = gold.evidence.find((e) => e.metric === "cot_net_non_commercial")!;
    expect(goldCot.period).toBe("2025-07-01");
    expect(goldCot.observedAt).toBe(COT_FETCHED);
    expect(goldCot.observedAtSemantics).toBe("acquisition-receipt");
    expect(goldCot.unit).toBe("contracts");
    const goldCurve = gold.evidence.find((e) => e.metric === "usd_10y_real")!;
    expect(goldCurve.period).toBe("2025-07-03");
    expect(goldCurve.unit).toBe("%");

    // Oil: the SAME framework plus the EIA stock series, each with its own
    // provider period, unit and acquisition receipt.
    expect(oil.instrumentId).toBe("WTI");
    expect(oil.reportingPeriod).toBe("2025-07-03");
    const inventory = oil.evidence.find((e) => e.metric === "inventory_wpsr")!;
    expect(inventory.period).toBe("2025-07-02");
    expect(inventory.observedAt).toBe(EIA_FETCHED);
    expect(inventory.observedAtSemantics).toBe("acquisition-receipt");
    expect(inventory.unit).toBe("million barrels");
    expect(inventory.value).toBe(442.1);
    expect(oil.evidence.find((e) => e.metric === "usd_10y_nominal")!.value).toBe(4.35);
    expect(gold.limitations.join(" ")).toMatch(/never presented as a live market price/);
  });

  it("(10) missing evidence is never fabricated in any domain, and no zero is invented", () => {
    const empty = {
      equity: assessFundamentals(undefined),
      crypto: assessFundamentals(undefined, { instrument: "BTC-USDT", instrumentType: "crypto" }),
      forex: assessFundamentals(undefined, { instrument: "EUR/USD", instrumentType: "forex" }),
      commodity: assessFundamentals(undefined, { instrument: "XAU/USD", instrumentType: "commodity" }),
    };
    for (const [domain, a] of Object.entries(empty)) {
      expect(a.domain).toBe(domain);
      expect(a.available).toBe(false);
      expect(a.state).toBe("insufficient");
      expect(a.confidence).toBe("insufficient");
      expect(a.directionalBias).toBe("none");
      expect(a.evidence).toEqual([]);
      expect(a.dimensions.every((d) => d.status === "unavailable")).toBe(true);
      expect(a.unavailableDimensions.length).toBe(a.dimensions.length);
      expect(a.metrics).toEqual({});
      expect(a.cryptoMetrics).toBeUndefined();
      expect(a.forexMetrics).toBeUndefined();
      expect(a.commodityMetrics).toBeUndefined();
    }
    expect(empty.commodity.dimensions.length).toBe(COMMODITY_DIMENSIONS.length);
    expect(empty.commodity.limitations.join(" ")).toMatch(/No commodity-native fundamental evidence was supplied/);
  });
});

// ── 3. Unified layer + radar ────────────────────────────────────

describe("279 cross-domain (E/F) — unified and radar consume the domain assessment", () => {
  it("(11) the unified layer reports the correct domain state for each asset class", () => {
    for (const [domain, assessment] of DOMAINS) {
      const result =
        domain === "equity"
          ? EQUITY_RESULT
          : domain === "crypto"
            ? CRYPTO_RESULT
            : domain === "forex"
              ? FOREX_RESULT
              : COMMODITY_RESULT;
      const unified = buildUnifiedIntelligence(result);
      expect(unified.fundamental.state).toBe(assessment.state);
      expect(unified.explanation.length).toBeGreaterThan(0);
      if (domain === "commodity") {
        // The commodity evidence the providers actually supply is already
        // scored by the conviction engine's own layers, so the fundamental
        // layer reports context and forces no direction — Unified must accept
        // that honestly instead of inventing a state.
        expect(assessment.state).toBe("insufficient");
        expect(assessment.directionalBias).toBe("none");
        expect(unified.confluence.agreement).toBe("not-assessable");
        expect(unified.fundamental.state).not.toMatch(/improving|weakening/);
      } else {
        expect(unified.fundamental.state).not.toBe("insufficient");
      }
    }
  });

  it("(12) the radar consumes the unified result for a crypto instrument without recalculating fundamentals", () => {
    const unified = buildUnifiedIntelligence(CRYPTO_RESULT);
    const source = {
      universe: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        region: "global",
        providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT" },
        requiredCapabilities: ["ohlcv", "quote"],
        priority: 1,
        refreshIntervalMs: 300_000,
      },
      snapshot: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        region: "global",
        price: 65_120,
        ohlcvAvailable: true,
        availableTimeframes: ["H1", "H4", "D1"],
        htfBias: "long",
        mtfAlignment: "ALIGNED_BULLISH",
        marketRegime: "TRENDING",
        spreadBps: 3,
        volatility: 800,
        provider: "okx",
        observedAt: NOW,
        timestampProvenance: "PROVIDER_OBSERVED",
        freshness: "FRESH",
        quality: "VERIFIED",
      },
      unified,
    } as unknown as RadarCandidateSource;
    const scan = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 10 }, undefined, NOW);
    const opportunities = scan.results.get("INTRADAY") ?? [];
    expect(opportunities.length).toBeGreaterThan(0);
    const opp = opportunities[0];
    // The scanner echoes the unified state it was given; it never invents one.
    expect(JSON.stringify(opp)).toContain(unified.fundamental.state);
  });
});

// ── 4. Equity depth (Task C) ────────────────────────────────────

describe("279 cross-domain (C) — deepened equity evidence from the same provider payload", () => {
  it("(13) the remaining as-reported multiples and margins are reported", () => {
    const equity = DOMAINS[0][1];
    const valuation = equity.dimensions.find((d) => d.name === "valuation")!.evidence!;
    for (const bit of ["PEG 1.82", "P/B 12.10", "P/S 7.80", "EV/Revenue 7.95", "EV/EBITDA 22.40", "dividend yield 0.44%", "market cap $3000.0B"]) {
      expect(valuation).toContain(bit);
    }
    const profitability = equity.dimensions.find((d) => d.name === "profitability")!.evidence!;
    expect(profitability).toContain("operating margin 31.0%");
    expect(profitability).toContain("revenue per share $24.51");
    expect(profitability).toContain("net margin 26.5%");
  });

  it("(14) earnings-quality and trend depths carry their own periods", () => {
    const equity = DOMAINS[0][1];
    const quality = equity.dimensions.find((d) => d.name === "earnings-quality")!.evidence!;
    expect(quality).toContain("beat");
    expect(quality).toContain("2025-06-30");
    const epsTrend = equity.dimensions.find((d) => d.name === "eps-trend")!.evidence!;
    expect(epsTrend).toContain("Annual reported EPS 2024-09-30 $5.55 vs 2023-09-30 $5.12");
    const surprise = equity.evidence.find((e) => e.metric === "latest_eps_surprise")!;
    expect(surprise.period).toBe("2025-06-30");
    expect(surprise.derived).toBeUndefined();
  });

  it("(15) balance sheet, cash flow and peer-relative valuation stay UNAVAILABLE with reasons", () => {
    const equity = DOMAINS[0][1];
    expect(equity.dimensions.find((d) => d.name === "balance-sheet")!.status).toBe("unavailable");
    expect(equity.dimensions.find((d) => d.name === "cash-flow")!.status).toBe("unavailable");
    expect(equity.unavailableDimensions).toContain("balance-sheet");
    expect(equity.limitations.join(" ")).toMatch(/Balance-sheet line items/);
    expect(equity.limitations.join(" ")).toMatch(/Free cash flow, FCF margin, ROIC/);
    expect(equity.limitations.join(" ")).toMatch(/Peer\/sector-relative valuation UNAVAILABLE/);
    expect(equity.limitations.join(" ")).toMatch(/Historical valuation context/);
    expect(equity.evidence.some((e) => /peer|sector/i.test(e.metric))).toBe(false);
  });

  it("(16) changed financials change the assessment; identical financials do not", () => {
    const base = runAnalysis(input("MSFT", "stock", { fundamentalData: equityFundamentals() })).fundamentalAssessment!;
    const again = runAnalysis(input("MSFT", "stock", { fundamentalData: equityFundamentals() })).fundamentalAssessment!;
    expect(JSON.stringify(again)).toBe(JSON.stringify(base));

    const weaker = runAnalysis(
      input("MSFT", "stock", {
        fundamentalData: equityFundamentals({
          ProfitMargin: "-0.081",
          ReturnOnEquityTTM: "-0.152",
          ReturnOnAssetsTTM: "-0.061",
          QuarterlyRevenueGrowthYOY: "-0.121",
          QuarterlyEarningsGrowthYOY: "-0.211",
        }),
      }),
    ).fundamentalAssessment!;
    expect(weaker.state).not.toBe(base.state);
    expect(weaker.contradictions.length).toBeGreaterThan(0);
  });

  it("(17) no domain module contains a ticker-specific branch or a clock read", () => {
    const sources = [
      "src/lib/fundamental-engine.ts",
      "src/lib/fundamental/equity.ts",
      "src/lib/fundamental/framework.ts",
      "src/lib/fundamental/crypto.ts",
      "src/lib/fundamental/forex.ts",
      "src/lib/fundamental/commodity.ts",
      "src/lib/data/fundamental-contract.ts",
    ].filter((f) => fs.existsSync(path.join(process.cwd(), f)));
    for (const file of sources) {
      // COMMENTS may quote the invariants (including `Date.now()`); CODE may not.
      const source = stripComments(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
      expect(source, file).not.toMatch(/switch\s*\(\s*(symbol|ticker|instrument)\b/);
      expect(source, file).not.toMatch(/Date\.now\(\)/);
      for (const ticker of ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META"]) {
        expect(source, `${file} mentions ${ticker}`).not.toMatch(new RegExp(`\\b${ticker}\\b`));
      }
    }
  });

  it("(22) the dispatcher routes ALL FOUR domains and names an unknown one explicitly", () => {
    const dispatcher = stripComments(
      fs.readFileSync(path.join(process.cwd(), "src/lib/fundamental-engine.ts"), "utf8"),
    );
    // One explicit route per supported domain, each calling its own adapter.
    expect(dispatcher).toContain('instrumentType === "crypto"');
    expect(dispatcher).toContain("assessCryptoFundamentals(");
    expect(dispatcher).toContain('instrumentType === "forex"');
    expect(dispatcher).toContain("assessForexFundamentals(");
    expect(dispatcher).toContain('instrumentType === "commodity"');
    expect(dispatcher).toContain("assessCommodityFundamentals(");
    expect(dispatcher).toMatch(/instrumentType === "stock"/);
    expect(dispatcher).toContain("assessEquityFundamentals(");
    // An unknown routing domain is explicit — never another domain's metrics.
    expect(dispatcher).toContain("unassessedDomain(");
    expect(dispatcher).toMatch(/return unassessedDomain\(/);
  });
});

// ── 5. UI (Task G) ──────────────────────────────────────────────

describe("279 cross-domain (G) — the existing Fundamental section renders the domain assessment", () => {
  it("(18) a crypto result renders the crypto assessment verbatim, with no equity metric", () => {
    const { container } = render(
      createElement(AnalysisResultDisplay, { result: CRYPTO_RESULT }),
    );
    const text = container.textContent ?? "";
    const assessment = CRYPTO_RESULT.fundamentalAssessment!;
    expect(text).toContain("FUNDAMENTAL ASSESSMENT");
    expect(text).toContain(assessment.provider);
    expect(text).toContain("BTC-USDT");
    for (const d of assessment.dimensions.filter((d) => d.status !== "unavailable" && d.evidence)) {
      expect(text).toContain(d.evidence!);
    }
    for (const limitation of assessment.limitations) {
      expect(text).toContain(limitation);
    }
    // No equity metric anywhere in the fundamental section for a token.
    expect(text).not.toContain("EV/EBITDA");
    expect(text).not.toContain("net margin");
    expect(text).toMatch(/Traditional company fundamentals/);
  });

  it("(19) a forex result renders the two-sided comparison and no company metric", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result: FOREX_RESULT }));
    const text = container.textContent ?? "";
    const assessment = FOREX_RESULT.fundamentalAssessment!;
    expect(text).toContain("EUR/USD");
    for (const comparison of assessment.comparisons!) {
      expect(text).toContain(comparison);
    }
    expect(text).toContain(assessment.confidenceEvidence);
    expect(text).not.toContain("EPS");
    expect(text).not.toContain("EV/EBITDA");
  });

  it("(20) React recalculates nothing: the components never import an assessment engine", () => {
    for (const file of [
      "src/components/AnalysisResult.tsx",
      "src/components/IntelligenceDashboard.tsx",
      "src/components/MarketOpportunities.tsx",
    ]) {
      if (!fs.existsSync(path.join(process.cwd(), file))) continue;
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const engineExport of [
        "assessFundamentals",
        "aggregateConfidence",
        "assessCryptoFundamentals",
        "assessForexFundamentals",
        "assessCommodityFundamentals",
        "COMMODITY_DIMENSIONS",
      ]) {
        expect(source, `${file} imports ${engineExport}`).not.toContain(engineExport);
      }
      // The client never reaches into the fundamental framework at all: every
      // rendered field is read from the engine's own assessment object.
      expect(source, file).not.toMatch(/from "@\/lib\/fundamental\//);
      expect(source, file).not.toMatch(/from "@\/lib\/fundamental-engine"/);
    }
    // The Fundamental section renders the assessment the engine produced —
    // every field is read from `result.fundamentalAssessment`, and none is
    // recomputed:
    const card = fs.readFileSync(path.join(process.cwd(), "src/components/AnalysisResult.tsx"), "utf8");
    for (const field of [
      "available",
      "state",
      "confidence",
      "provider",
      "instrumentId",
      "reportingPeriod",
      "observedAt",
      "dimensions",
      "comparisons",
      "confidenceEvidence",
      "limitations",
    ]) {
      expect(card, field).toContain(`result.fundamentalAssessment.${field}`);
    }
    // Dimensions are rendered through their own engine-supplied evidence text.
    expect(card).toContain("d.evidence");
  });

  it("(21b) a commodity result renders the commodity assessment and no equity/crypto metric", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result: COMMODITY_RESULT }));
    const text = container.textContent ?? "";
    const assessment = COMMODITY_RESULT.fundamentalAssessment!;
    expect(assessment.domain).toBe("commodity");
    expect(text).toContain(assessment.provider);
    expect(text).toContain("XAU/USD");
    for (const d of assessment.dimensions.filter((d) => d.status !== "unavailable" && d.evidence)) {
      expect(text).toContain(d.evidence!);
    }
    expect(text).toMatch(/Gold futures \(COMEX\)/);
    expect(text).toMatch(/real 10Y 2\.05%/);
    // Gold has no EIA stock series — no inventory number is invented for it.
    expect(text).not.toMatch(/Crude Oil Excluding SPR/);
    expect(text).not.toMatch(/million barrels/);
    // The oil instrument is the same framework plus the EIA release.
    const oilResult = COMMODITY_OIL_RESULT;
    const oilText = render(createElement(AnalysisResultDisplay, { result: oilResult }))
      .container.textContent ?? "";
    expect(oilText).toMatch(/Crude Oil Excluding SPR/);
    expect(oilText).toMatch(/Crude Oil Excluding SPR \(EPC0\) 442.1 million barrels/);
    expect(oilText).toMatch(/net non-commercial/);
    // Same rule for the oil instrument: only the non-applicability disclosure
    // may mention equity vocabulary.
    const oilWithoutDisclosure = oilResult.fundamentalAssessment!.limitations.reduce(
      (acc, limitation) => acc.split(limitation).join(" "),
      oilText,
    );
    expect(oilWithoutDisclosure).not.toContain("EPS");
    expect(oilWithoutDisclosure).not.toContain("P/E");
    // Commodity fundamentals never render company or token metrics. The only
    // place stock vocabulary is allowed to appear is the assessment's own
    // disclosure that it does not apply — so remove the rendered limitations,
    // then assert the rest of the page is free of equity metrics.
    const withoutDisclosure = assessment.limitations.reduce(
      (acc, limitation) => acc.split(limitation).join(" "),
      text,
    );
    expect(withoutDisclosure).not.toContain("EPS");
    expect(withoutDisclosure).not.toContain("P/E");
    expect(withoutDisclosure).not.toContain("EV/EBITDA");
    expect(withoutDisclosure).not.toContain("net margin");
    expect(withoutDisclosure).not.toContain("FDV/market-cap");
    expect(text).toMatch(/no EPS\/P\/E\/revenue metric is computed or shown/);
  });

  it("(21) an equity result still renders its own assessment (Phase 276 continuity)", () => {
    const { container } = render(createElement(AnalysisResultDisplay, { result: EQUITY_RESULT }));
    const text = container.textContent ?? "";
    const assessment = EQUITY_RESULT.fundamentalAssessment!;
    expect(assessment.domain).toBe("equity");
    expect(text).toContain(assessment.confidenceEvidence);
    expect(text).toContain("P/E 28.5");
    expect(text).not.toContain("FDV/market-cap");
  });
});
