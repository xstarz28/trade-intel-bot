/**
 * Phase 281 — CROSS-DOMAIN contract: one shared framework, four domain
 * evidence bags, and the same unified/radar path for all of them.
 *
 * What these proofs establish:
 *   · the framework rules the three new domains rely on are the SHARED ones —
 *     conflicting primary evidence is mixed, secondary evidence cannot
 *     establish a direction, one dimension cannot outvote several opposing
 *     dimensions, and confidence comes from independent groups + multi-period
 *     depth rather than field count;
 *   · crypto, forex, equity (and the Phase 280 commodity profile) report
 *     pairwise DISJOINT dimension spaces and pairwise isolated metric bags;
 *   · every domain assessment is pure: no clock, no cross-domain evidence, no
 *     value without provider provenance and a unit;
 *   · the unified layer echoes each domain's own assessment, and the radar
 *     consumes the unified result without recalculating fundamentals;
 *   · the existing UI renders the domain summary verbatim.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render as rtlRender } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { I18nProvider } from "./i18n";
import type { FundamentalAssessment } from "./fundamental-engine";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { calculateTechnical } from "./data/technical";
import type { OhlcvCandle } from "./data/market-types";
import { buildUnifiedIntelligence } from "./unified-intelligence";
import { scanRadar } from "./market-radar/radar";
import type { RadarCandidateSource } from "./market-radar/candidate-builder";
import { aggregateStateWithHierarchy, aggregateConfidence, type DimensionHierarchyEntry } from "./fundamental/framework";
import { CRYPTO_DIMENSIONS } from "./fundamental/crypto";
import { FOREX_DIMENSIONS } from "./fundamental/forex";
import { EQUITY_DIMENSIONS } from "./fundamental/equity";
import { COMMODITY_DIMENSIONS } from "./fundamental/commodity";
import { AnalysisResultDisplay } from "../components/AnalysisResult";
import { normalizeFundamentals, type RawOverview } from "./data/alpha-vantage/normalize";
import type { FundamentalDimension } from "./data/fundamental-contract";
import type { CryptoIntelligenceContext } from "./data/crypto/types";
import type { EconomicCalendarData } from "./data/calendar-types";

const render = (ui: ReactNode) => rtlRender(createElement(I18nProvider, null, ui));
const NOW = Date.parse("2025-07-05T14:30:00Z");

const dim = (
  name: FundamentalDimension["name"],
  status: FundamentalDimension["status"],
): FundamentalDimension => ({ name, status, evidence: `${name} measured` });

const HIERARCHY: DimensionHierarchyEntry[] = [
  { name: "revenue-growth", role: "primary" },
  { name: "eps-trend", role: "primary" },
  { name: "profitability", role: "primary" },
  { name: "earnings-quality", role: "secondary" },
];

// ── 1. The shared framework rules ───────────────────────────────

describe("281 cross-domain (D) — the shared framework rules", () => {
  it("(1) primary evidence pointing both ways is mixed, not a weighted average", () => {
    const conflict = aggregateStateWithHierarchy(
      [dim("revenue-growth", "positive"), dim("eps-trend", "positive"), dim("profitability", "negative")],
      HIERARCHY,
    );
    expect(conflict.state).toBe("mixed");
    expect(conflict.basis).toContain("primary evidence conflicts across dimensions");
    expect(conflict.basis).toContain("2 primary dimension(s) strengthening vs 1 weakening");
    // One-sided primaries still give a direction (same evidence, no conflict).
    const oneSided = aggregateStateWithHierarchy(
      [dim("revenue-growth", "positive"), dim("eps-trend", "positive"), dim("profitability", "positive")],
      HIERARCHY,
    );
    expect(oneSided.state).toBe("improving");
    expect(oneSided.basis).toContain("primary dimension(s) strengthening");
  });

  it("(2) secondary evidence cannot establish a direction, and one read cannot outvote several", () => {
    const secondaryOnly = aggregateStateWithHierarchy(
      [dim("earnings-quality", "positive"), dim("balance-sheet", "positive")],
      HIERARCHY,
    );
    expect(secondaryOnly.state).toBe("mixed");
    expect(secondaryOnly.basis).toContain("a primary read is required");

    // One primary read opposing another primary read stays mixed even when a
    // secondary read agrees with neither.
    const opposing = aggregateStateWithHierarchy(
      [dim("revenue-growth", "positive"), dim("profitability", "negative"), dim("earnings-quality", "negative")],
      HIERARCHY,
    );
    expect(opposing.state).toBe("mixed");

    // A single dimension cannot outvote several opposing reads of equal or
    // heavier role.
    const outvoted = aggregateStateWithHierarchy(
      [dim("revenue-growth", "positive"), dim("profitability", "negative"), dim("eps-trend", "negative")],
      HIERARCHY,
    );
    expect(outvoted.state).toBe("mixed");

    const tie = aggregateStateWithHierarchy(
      [dim("revenue-growth", "positive"), dim("profitability", "negative")],
      HIERARCHY,
    );
    expect(tie.state).toBe("mixed");
  });

  it("(3) confidence counts independent groups and multi-period depth, not fields", () => {
    const dimensions = [
      dim("revenue-growth", "positive"),
      dim("eps-trend", "positive"),
      dim("profitability", "positive"),
      dim("earnings-quality", "positive"),
      dim("valuation", "positive"),
    ];
    const deep = aggregateConfidence({
      dimensions,
      periodsCount: 8,
      periodsLabel: "fiscal periods",
      hierarchy: HIERARCHY,
      independentGroups: 1,
      historyDepth: 2,
    });
    expect(deep.confidence).toBe("high");
    expect(deep.confidenceEvidence).toContain("1 independent provider group(s)");
    expect(deep.confidenceEvidence).toContain("2 dimension(s) with multi-period history");

    // Field count alone is NOT confidence: five usable dimensions from one
    // group with no multi-period history cannot read high.
    const shallow = aggregateConfidence({
      dimensions,
      periodsCount: 8,
      periodsLabel: "fiscal periods",
      hierarchy: HIERARCHY,
      independentGroups: 1,
      historyDepth: 0,
    });
    expect(shallow.confidence).toBe("low");
    expect(shallow.confidenceEvidence).toContain("no multi-period provider history caps confidence at medium");

    const fieldRich = aggregateConfidence({
      dimensions: [dim("revenue-growth", "positive"), dim("eps-trend", "positive"), dim("profitability", "neutral")],
      periodsCount: 3,
      periodsLabel: "provider datasets",
      hierarchy: HIERARCHY,
      independentGroups: 3,
      historyDepth: 1,
    });
    expect(fieldRich.confidence).toBe("high");
  });
});

// ── 2. Domain evidence bags are disjoint ────────────────────────

describe("281 cross-domain (H) — disjoint dimension spaces and metric bags", () => {
  it("(4) no dimension name is shared between the four domains", () => {
    const spaces: [string, readonly string[]][] = [
      ["crypto", CRYPTO_DIMENSIONS],
      ["forex", FOREX_DIMENSIONS],
      ["equity", EQUITY_DIMENSIONS],
      ["commodity", COMMODITY_DIMENSIONS],
    ];
    for (let a = 0; a < spaces.length; a++) {
      for (let b = a + 1; b < spaces.length; b++) {
        const overlap = spaces[a][1].filter((n) => (spaces[b][1] as readonly string[]).includes(n));
        expect(overlap, `${spaces[a][0]} ∩ ${spaces[b][0]}`).toEqual([]);
      }
    }
  });

  it("(5) each domain module runs the SAME shared framework and no second engine", () => {
    const dir = path.resolve(__dirname, "fundamental");
    const framework = fs.readFileSync(path.join(dir, "framework.ts"), "utf8");
    expect(framework).toContain("export function aggregateConfidence");
    expect(framework).toContain("export function aggregateStateWithHierarchy");
    for (const file of ["crypto.ts", "forex.ts", "commodity.ts"]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source, file).toContain("aggregateConfidence");
      // No domain may own or call another domain's adapter.
      const others: Record<string, string[]> = {
        "crypto.ts": ["assessEquityFundamentals(", "assessForexFundamentals(", "assessCommodityFundamentals("],
        "forex.ts": ["assessEquityFundamentals(", "assessCryptoFundamentals(", "assessCommodityFundamentals("],
        "commodity.ts": ["assessEquityFundamentals(", "assessCryptoFundamentals(", "assessForexFundamentals("],
      };
      for (const foreign of others[file]) expect(source, foreign).not.toContain(foreign);
      expect(source, file).not.toMatch(/Date\.now\(/);
    }
    const equity = fs.readFileSync(path.resolve(__dirname, "fundamental", "equity.ts"), "utf8");
    expect(equity).not.toMatch(/Date\.now\(/);
    const engine = fs.readFileSync(path.resolve(__dirname, "fundamental-engine.ts"), "utf8");
    // Exactly one dispatcher: each domain is assessed by its own engine adapter.
    for (const fn of ["assessEquityFundamentals", "assessCryptoFundamentals", "assessForexFundamentals", "assessCommodityFundamentals"]) {
      expect(engine).toContain(`${fn}(`);
    }
    expect(engine.match(/function assessEquityFundamentals/g)?.length).toBe(1);
  });
});

// ── 3. Fixtures for the three domains ───────────────────────────

const CRYPTO_OBSERVED = Date.parse("2025-07-04T19:05:00Z");
const CAL_OBSERVED = Date.parse("2025-07-04T19:30:00Z");
const AV_OBSERVED = Date.parse("2025-07-05T14:00:00Z");
const END_TS = Date.parse("2025-07-04T20:00:00Z");

function candles(n: number, start: number, slope: number): OhlcvCandle[] {
  const amp = Math.max(1, Math.abs(slope) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = start + slope * j + amp * Math.sin(j * 0.55);
    out.push({
      timestamp: END_TS - (n - 1 - j) * 900_000,
      open: close - slope / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const UPTREND = candles(210, 60_000, 5);
const FX_CANDLES = candles(210, 1.085, 0.00002);

function input(instrument: string, instrumentType: string, extra: Partial<AnalysisInput>): AnalysisInput {
  const cs = instrumentType === "forex" ? FX_CANDLES : UPTREND;
  const last = cs[cs.length - 1];
  const provider = instrumentType === "crypto" ? "okx" : instrumentType === "stock" ? "alpha-vantage" : "twelve-data";
  return {
    instrument,
    instrumentType,
    timeframe: instrumentType === "forex" ? "H1" : "H4",
    tradingStyle: "intraday",
    provider,
    providerInstrumentId: instrument,
    marketData: {
      instrument,
      instrumentType,
      provider,
      providerInstrumentId: instrument,
      price: { price: last.close, timestamp: last.timestamp, source: provider },
      candles: cs,
      timeframe: "H4",
      fetchTimestamp: last.timestamp,
      dataFreshness: "realtime",
    },
    technicalData: calculateTechnical(cs),
    ...extra,
  } as AnalysisInput;
}

const CRYPTO_CONTEXT: CryptoIntelligenceContext = {
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
    tvl: { current: 62_000_000_000, change7d: 1.4, change30d: 4.2, reliable: true },
    fees: { dailyFees: 1_250_000, revenue24h: 125_000, feeChange7d: 1.2, feeChange30d: 6.4, reliable: true },
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

const FX_CALENDAR: EconomicCalendarData = {
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
      previous: 4.25,
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
  timestamp: CAL_OBSERVED,
  freshness: "recent",
  confidence: "high",
  availability: { upcoming24h: false, upcoming72h: true, recentReleased: true },
};

const EQUITY_OVERVIEW: RawOverview = {
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
  BookValue: "4.38",
  DividendPerShare: "0.98",
};

const EQUITY_DATA = (() => {
  const dates = ["2025-06-30", "2025-03-31", "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30"];
  const eps = ["1.65", "1.53", "1.50", "1.42", "1.35", "1.28", "1.24", "1.15"];
  const estimates = ["1.60", "1.50", "1.45", "1.38", "1.33", "1.25", "1.20", "1.12"];
  const revenue = ["94000000000", "90000000000", "85000000000", "81000000000", "78000000000", "74000000000", "71000000000", "68000000000"];
  const data = normalizeFundamentals(
    EQUITY_OVERVIEW,
    {
      quarterlyEarnings: eps.map((e, i) => ({
        fiscalDateEnding: dates[i],
        reportedDate: dates[i],
        reportedEPS: e,
        estimatedEPS: estimates[i],
        reportedRevenue: revenue[i],
      })),
      annualEarnings: [
        { fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" },
        { fiscalDateEnding: "2023-09-30", reportedEPS: "5.12" },
      ],
    } as never,
    "stock",
    "MSFT",
  );
  return { ...data, timestamp: AV_OBSERVED };
})();

const CRYPTO_RESULT = runAnalysis(input("BTC-USDT", "crypto", { cryptoIntelligenceContext: CRYPTO_CONTEXT }));
const FOREX_RESULT = runAnalysis(input("EUR/USD", "forex", { calendarData: FX_CALENDAR }));
const EQUITY_RESULT = runAnalysis(input("MSFT", "stock", { fundamentalData: EQUITY_DATA }));

const RESULTS = { crypto: CRYPTO_RESULT, forex: FOREX_RESULT, equity: EQUITY_RESULT } as const;
const ASSESSMENTS = {
  crypto: CRYPTO_RESULT.fundamentalAssessment!,
  forex: FOREX_RESULT.fundamentalAssessment!,
  equity: EQUITY_RESULT.fundamentalAssessment!,
};

// ── 4. Contract, provenance, unified + radar ────────────────────

describe("281 cross-domain (H) — one contract, no leakage, correct unified state", () => {
  it("(6) every domain produces the same contract shape and a real state", () => {
    for (const [domain, a] of Object.entries(ASSESSMENTS)) {
      expect(a.domain, domain).toBe(domain);
      expect(a.available, domain).toBe(true);
      expect(["improving", "weakening", "mixed"]).toContain(a.state);
      expect(a.confidence).not.toBe("insufficient");
      expect(a.summary, domain).toBeTruthy();
      expect(a.evidenceCoverage.dimensionsTotal, domain).toBe(a.dimensions.length);
      expect(a.unavailableDimensions.length, domain).toBe(
        a.dimensions.filter((d) => d.status === "unavailable").length,
      );
      for (const item of a.evidence) {
        expect(item.provider, `${domain}:${item.metric}`).toBeTruthy();
        expect(item.source, `${domain}:${item.metric}`).toBeTruthy();
        expect(item.providerInstrumentId, `${domain}:${item.metric}`).toBeTruthy();
        expect(item.observedAt, `${domain}:${item.metric}`).toBeGreaterThan(0);
        if (typeof item.value === "number") expect(item.unit, `${domain}:${item.metric}`).toBeTruthy();
      }
    }
  });

  it("(7) no value is invented and no metric bag carries another domain's fields", () => {
    const bag = (a: FundamentalAssessment) => a.metrics as unknown as Record<string, unknown>;
    expect(bag(ASSESSMENTS.crypto).epsRises).toBeUndefined();
    expect(bag(ASSESSMENTS.crypto).peRatio).toBeUndefined();
    expect(bag(ASSESSMENTS.forex).epsRises).toBeUndefined();
    expect(bag(ASSESSMENTS.forex).circulatingSupply).toBeUndefined();
    expect(bag(ASSESSMENTS.equity).circulatingSupply).toBeUndefined();
    expect(bag(ASSESSMENTS.equity).basePolicyRate).toBeUndefined();
    expect(ASSESSMENTS.crypto.cryptoMetrics?.circulatingSupply).toBe(19_850_000);
    expect(ASSESSMENTS.forex.forexMetrics?.policyRateDifferentialPp).toBeCloseTo(-1.5, 6);
    expect(ASSESSMENTS.equity.metrics.pegReported).toBe(1.82);
    // Provider identity never leaks across domains.
    expect(ASSESSMENTS.crypto.evidence.every((e) => !/TickAtlas|alpha-vantage/.test(e.provider))).toBe(true);
    expect(ASSESSMENTS.forex.evidence.every((e) => !/Tokenomist|DeFiLlama|alpha-vantage/.test(e.provider))).toBe(true);
    expect(ASSESSMENTS.equity.evidence.every((e) => e.provider === "alpha-vantage")).toBe(true);
  });

  it("(8) the unified layer echoes each domain's own assessment", () => {
    for (const [domain, a] of Object.entries(ASSESSMENTS)) {
      const unified = RESULTS[domain as keyof typeof RESULTS].unifiedIntelligence ?? buildUnifiedIntelligence(RESULTS[domain as keyof typeof RESULTS]);
      expect(unified.fundamental.state, domain).toBe(a.state);
      expect(unified.fundamental.available, domain).toBe(a.state === "improving" || a.state === "weakening");
      expect(unified.explanation, domain).toContain(a.state.toUpperCase());
      expect(unified.explanation, domain).not.toMatch(/technical.only/i);
    }
  });

  it("(9) the radar consumes the unified result without recalculating fundamentals", () => {
    for (const [domain, a] of Object.entries(ASSESSMENTS)) {
      const unified = RESULTS[domain as keyof typeof RESULTS].unifiedIntelligence ?? buildUnifiedIntelligence(RESULTS[domain as keyof typeof RESULTS]);
      const source = {
        universe: {
          instrument: a.instrumentId,
          assetClass: domain,
          region: "global",
          providerNative: { provider: a.provider, providerInstrumentId: a.instrumentId },
          requiredCapabilities: ["ohlcv", "quote"],
          priority: 1,
          refreshIntervalMs: 300_000,
        },
        snapshot: {
          instrument: a.instrumentId,
          assetClass: domain,
          region: "global",
          price: 100,
          ohlcvAvailable: true,
          availableTimeframes: ["H1", "H4", "D1"],
          htfBias: "long",
          mtfAlignment: "ALIGNED_BULLISH",
          marketRegime: "TRENDING",
          spreadBps: 3,
          volatility: 1,
          provider: a.provider,
          observedAt: NOW,
          timestampProvenance: "PROVIDER_OBSERVED",
          freshness: "FRESH",
          quality: "VERIFIED",
        },
        unified,
      } as unknown as RadarCandidateSource;
      const scan = scanRadar([source], { horizons: ["SWING"], maxResults: 10 }, undefined, NOW);
      const opportunities = scan.results.get("SWING") ?? [];
      expect(opportunities.length, domain).toBeGreaterThan(0);
      expect(JSON.stringify(opportunities[0]), domain).toContain(unified.fundamental.state);
    }
  });

  it("(10) the existing fundamental UI renders each domain summary verbatim", () => {
    for (const [domain, a] of Object.entries(ASSESSMENTS)) {
      const result = RESULTS[domain as keyof typeof RESULTS];
      const { container, unmount } = render(createElement(AnalysisResultDisplay, { result }));
      const text = container.textContent ?? "";
      expect(text, domain).toContain(a.summary!);
      expect(text, domain).toContain(a.confidenceEvidence);
      unmount();
    }
  });
});
