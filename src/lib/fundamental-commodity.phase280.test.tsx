/**
 * Phase 280 — the commodity fundamental domain must be SCORABLE, not
 * informational-only.
 *
 * The Phase 279 contract proved the plumbing (one framework, four domains, no
 * fabricated evidence). This suite proves the substance:
 *
 *   · a WTI assessment with genuinely sufficient real evidence reaches a real
 *     deterministic state (improving / weakening / mixed) — `insufficient` is
 *     reserved for genuinely insufficient evidence;
 *   · the SAME generic engine assesses gold without a symbol branch, and a
 *     missing term structure (or any other single dimension) never forces
 *     `insufficient`;
 *   · inventory history, production flows, COT positioning and a real curve
 *     each ALTER the assessment when their evidence changes;
 *   · evidence is weighted by the domain's documented hierarchy (physical
 *     primary, positioning secondary, macro supporting) so one macro variable
 *     can never dictate the state;
 *   · every evidence item is labelled provider-reported / derived-metric /
 *     interpretation, and nothing is double counted;
 *   · no clock, no stock metric, no fake order-flow/derivatives, no fabricated
 *     curve;
 *   · Unified intelligence and the radar consume the commodity assessment, and
 *     the existing Fundamental UI section renders it verbatim.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender } from "@testing-library/react";
import { createElement } from "react";
import fs from "node:fs";
import path from "node:path";

import {
  assessCommodityFundamentals,
  COMMODITY_DIMENSIONS,
  commodityProfileOf,
  type CommodityFuturesCurve,
} from "@/lib/fundamental/commodity";
import { assessFundamentals } from "@/lib/fundamental-engine";
import { I18nProvider } from "./i18n";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { calculateTechnical } from "./data/technical";
import { buildUnifiedIntelligence } from "./unified-intelligence";
import { scanRadar } from "./market-radar/radar";
import type { RadarCandidateSource } from "./market-radar/candidate-builder";
import { AnalysisResultDisplay } from "../components/AnalysisResult";
import { EIA_SIGNAL_MIN_MBBL, EIA_SIGNAL_THRESHOLD_PCT, EIA_TREND_MIN_WEEKS } from "@/lib/data/eia";
import { COT_CROWDING_OI_RATIO, COT_PERCENTILE_MIN_REPORTS } from "@/lib/data/cot";
import type { EiaContext, EiaData, EiaSeriesPoint } from "@/lib/data/eia";
import type { CotContext, CotData, CotReport } from "@/lib/data/cot";
import type { TreasuryContext, TreasuryData } from "@/lib/data/treasury";
import type { FundamentalAssessment } from "@/lib/data/fundamental-contract";
import type { OhlcvCandle } from "@/lib/data/market-types";

const render = (ui: React.ReactElement) => rtlRender(createElement(I18nProvider, null, ui));

/** Code only: block and line comments stripped before static scans. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ═══════════════════════════════════════════════════════════════
// Provider payloads — real shapes, real periods, no fabrication
// ═══════════════════════════════════════════════════════════════

const EIA_FETCHED = Date.parse("2025-07-04T18:10:00Z");
const COT_FETCHED = Date.parse("2025-07-04T18:20:00Z");
const TREASURY_FETCHED = Date.parse("2025-07-04T18:30:00Z");
const CURVE_OBSERVED = Date.parse("2025-07-04T20:00:00Z");

/** Twelve consecutive weekly Thursday observations, newest first. */
const WEEKS = [
  "2025-07-02",
  "2025-06-25",
  "2025-06-18",
  "2025-06-11",
  "2025-06-04",
  "2025-05-28",
  "2025-05-21",
  "2025-05-14",
  "2025-05-07",
  "2025-04-30",
  "2025-04-23",
  "2025-04-16",
] as const;

/** A WPSR stock series: 12 real weekly levels, newest first. */
function stockLeg(args: {
  productId: string;
  productName: string;
  values: number[];
}): EiaSeriesPoint {
  const [latest, previous, ...older] = args.values;
  return {
    productId: args.productId,
    productName: args.productName,
    observationDate: WEEKS[0],
    previousObservationDate: WEEKS[1],
    latestValue: latest,
    previousValue: previous,
    change: latest - previous,
    changePercent: ((latest - previous) / previous) * 100,
    unit: "million barrels",
    recentWeeks: older.map((value, i) => ({ period: WEEKS[i + 2], value })),
  };
}

// Crude draws every week (−2.3% on the week, −5.5% over the 4 observations).
const CRUDE_STOCKS = stockLeg({
  productId: "EPC0",
  productName: "Crude Oil Excluding SPR",
  values: [442.1, 452.6, 468.0, 472.4, 475.1, 478.6, 480.2, 482.9, 485.4, 487.0, 489.2, 491.1],
});

// Gasoline and distillate draw with it → one physical condition, read once.
const GASOLINE_STOCKS = stockLeg({
  productId: "EPM0",
  productName: "Finished Motor Gasoline",
  values: [231.2, 236.4, 239.1, 241.0, 243.6, 245.2, 246.9, 248.1, 249.4, 250.2, 251.0, 252.3],
});

const DISTILLATE_STOCKS = stockLeg({
  productId: "EPD0",
  productName: "Distillate Fuel Oil",
  values: [118.4, 121.9, 123.2, 124.4, 125.1, 126.3, 127.0, 127.9, 128.4, 129.0, 129.6, 130.2],
});

/** A flow series from the EIA supply-and-disposition dataset. */
function flow(args: {
  productId: string;
  productName: string;
  unit: string;
  values: number[];
}): EiaSeriesPoint {
  const [latest, previous] = args.values;
  return {
    productId: args.productId,
    productName: args.productName,
    observationDate: WEEKS[0],
    previousObservationDate: WEEKS[1],
    latestValue: latest,
    previousValue: previous,
    change: latest - previous,
    changePercent: ((latest - previous) / previous) * 100,
    unit: args.unit,
  };
}

const FLOWS_RISING_SUPPLY = [
  flow({
    productId: "PRD",
    productName: "U.S. Field Production of Crude Oil",
    unit: "thousand barrels per day",
    values: [13_620, 13_450],
  }),
  flow({
    productId: "IMP",
    productName: "Crude Oil Imports",
    unit: "thousand barrels per day",
    values: [6_230, 6_050],
  }),
  flow({
    productId: "EXP",
    productName: "Crude Oil Exports",
    unit: "thousand barrels per day",
    values: [3_420, 3_520],
  }),
  flow({
    productId: "REFU",
    productName: "Refinery Utilization",
    unit: "%",
    values: [92.1, 92.6],
  }),
];

function eia(series: EiaSeriesPoint[], extra?: Partial<EiaContext>): EiaContext {
  return {
    available: true,
    source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
    fetchedAt: EIA_FETCHED,
    freshness: "FRESH",
    series,
    failedLegs: [],
    ...extra,
  };
}

const STOCKS_ONLY = eia([CRUDE_STOCKS, GASOLINE_STOCKS, DISTILLATE_STOCKS]);
const STOCKS_AND_FLOWS = eia([
  CRUDE_STOCKS,
  GASOLINE_STOCKS,
  DISTILLATE_STOCKS,
  ...FLOWS_RISING_SUPPLY,
]);

/** 26 older weekly CFTC reports — the provider's own distribution. */
function cotHistory(base: number, step: number): CotReport[] {
  return Array.from({ length: COT_PERCENTILE_MIN_REPORTS }, (_, i) => ({
    reportDate: `2024-${String(1 + Math.floor(i / 4)).padStart(2, "0")}-${String(1 + (i % 4) * 7).padStart(2, "0")}`,
    nonCommercialLong: base + i * step,
    nonCommercialShort: base - i * step,
    openInterest: 520_000,
  }));
}

function cot(args: {
  instrument: string;
  sourceInstrument: string;
  mappedAsset: string;
  net: number;
  change: number;
  openInterest?: number;
  history?: boolean;
  commercialNet?: number;
  commercialNetChange?: number;
}): CotContext {
  const oi = args.openInterest ?? 520_000;
  const long = 260_000;
  const short = long - args.net;
  const prevLong = long - args.change;
  const commercialLong = args.commercialNet === undefined ? undefined : 300_000;
  const commercialShort =
    args.commercialNet === undefined || commercialLong === undefined ? undefined : commercialLong - args.commercialNet;
  const prevCommercialLong =
    args.commercialNetChange === undefined || commercialLong === undefined ? undefined : commercialLong - args.commercialNetChange;
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: COT_FETCHED,
    freshness: "FRESH",
    requestedInstrument: args.instrument,
    sourceInstrument: args.sourceInstrument,
    mappedAsset: args.mappedAsset,
    latest: {
      reportDate: "2025-07-01",
      nonCommercialLong: long,
      nonCommercialShort: short,
      ...(commercialLong !== undefined && commercialShort !== undefined
        ? { commercialLong, commercialShort }
        : {}),
      openInterest: oi,
    },
    previous: {
      reportDate: "2025-06-24",
      nonCommercialLong: prevLong,
      nonCommercialShort: short,
      ...(prevCommercialLong !== undefined && commercialShort !== undefined
        ? { commercialLong: prevCommercialLong, commercialShort }
        : {}),
      openInterest: oi - 5_000,
    },
    netNonCommercial: args.net,
    changeFromPreviousReport: args.change,
    ...(args.history !== false ? { history: cotHistory(150_000, 500) } : {}),
  };
}

const COT_WTI_SUPPORTIVE = cot({
  instrument: "WTI",
  sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
  mappedAsset: "WTI Crude Oil futures (NYMEX)",
  net: -20_000,
  change: 12_000,
  commercialNet: 60_000,
  commercialNetChange: 9_000,
});

const COT_WTI_OPPOSING = cot({
  instrument: "WTI",
  sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
  mappedAsset: "WTI Crude Oil futures (NYMEX)",
  net: -44_000,
  change: -12_000,
  commercialNet: 60_000,
  commercialNetChange: -9_000,
});

const COT_GOLD = cot({
  instrument: "XAU/USD",
  sourceInstrument: "GOLD - COMMODITY EXCHANGE INC.",
  mappedAsset: "Gold futures (COMEX)",
  net: 216_000,
  change: 19_000,
});

function treasury(overrides?: {
  nominalTenY?: number;
  previousTenY?: number;
  realTenY?: number | null;
  previousRealTenY?: number;
  freshness?: TreasuryContext["freshness"];
}): TreasuryContext {
  const real = overrides?.realTenY;
  const nominalTenY = overrides?.nominalTenY ?? 4.35;
  const previousTenY = overrides?.previousTenY ?? 4.28;
  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: TREASURY_FETCHED,
    freshness: overrides?.freshness ?? "FRESH",
    latest: {
      nominal: { observationDate: "2025-07-03", nominal: { "2Y": 4.12, "10Y": nominalTenY } },
      ...(real === null
        ? {}
        : { real: { observationDate: "2025-07-03", real: { "10Y": real ?? 2.05 } } }),
    },
    previous: {
      nominal: { observationDate: "2025-07-02", nominal: { "2Y": 4.1, "10Y": previousTenY } },
      ...(real === null
        ? {}
        : { real: { observationDate: "2025-07-02", real: { "10Y": overrides?.previousRealTenY ?? (real ?? 2.05) - 0.07 } } }),
    },
  };
}

/** Rising yields = a headwind for every commodity group (supporting only). */
const TREASURY_HEADWIND = treasury();

/** A REAL multi-expiry curve, supplied verbatim (no provider ships one yet). */
const CURVE_BACKWARDATION: CommodityFuturesCurve = {
  provider: "curve-feed",
  source: "FUTURES_CURVE (front-first settlement curve)",
  observedAt: CURVE_OBSERVED,
  freshness: "FRESH",
  unit: "USD per barrel",
  contracts: [
    { contract: "CLU25", expiry: "2025-09", price: 68.4, openInterest: 412_000 },
    { contract: "CLZ25", expiry: "2025-12", price: 67.1, openInterest: 208_000 },
    { contract: "CLH26", expiry: "2026-03", price: 65.9, openInterest: 96_000 },
  ],
};

const CURVE_CONTANGO: CommodityFuturesCurve = {
  ...CURVE_BACKWARDATION,
  contracts: [
    { contract: "CLU25", expiry: "2025-09", price: 65.9, openInterest: 412_000 },
    { contract: "CLZ25", expiry: "2025-12", price: 67.1, openInterest: 208_000 },
    { contract: "CLH26", expiry: "2026-03", price: 68.4, openInterest: 96_000 },
  ],
};

const EIA_UNAVAILABLE: EiaData = {
  available: false,
  reason: "EIA_API_KEY is not configured",
  source: "U.S. Energy Information Administration (Weekly Petroleum Status Report) as never-fetched",
} as unknown as EiaData;

/** WTI with genuinely sufficient evidence: 12-week stock history + COT + curve. */
const assessWti = (overrides?: {
  eia?: EiaData;
  cot?: CotData;
  treasury?: TreasuryData;
  futuresCurve?: typeof CURVE_BACKWARDATION | typeof CURVE_CONTANGO | undefined;
}) =>
  assessCommodityFundamentals({
    instrument: "WTI",
    provider: "twelve-data",
    providerInstrumentId: "WTI",
    eia: overrides?.eia ?? STOCKS_ONLY,
    cot: overrides?.cot ?? COT_WTI_SUPPORTIVE,
    treasury: overrides?.treasury ?? TREASURY_HEADWIND,
    futuresCurve: overrides && "futuresCurve" in overrides ? overrides.futuresCurve : CURVE_BACKWARDATION,
  });

const assessGold = () =>
  assessCommodityFundamentals({
    instrument: "XAU/USD",
    provider: "twelve-data",
    providerInstrumentId: "XAU/USD",
    cot: COT_GOLD,
    treasury: TREASURY_HEADWIND,
  });

const dim = (a: FundamentalAssessment, name: string) => a.dimensions.find((d) => d.name === name)!;

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// A. The state is real (proofs 1–3)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (A) — a real deterministic state from real evidence", () => {
  it("(1) WTI with sufficient evidence is assessable, non-insufficient and directional", () => {
    const a = assessWti();
    expect(a.available).toBe(true);
    expect(a.domain).toBe("commodity");
    expect(a.state).toBe("improving");
    expect(a.confidence).not.toBe("insufficient");
    expect(a.directionalBias).toBe("bullish");
    expect(dim(a, "inventories").status).toBe("positive");
    expect(a.commodityMetrics?.physicalRegime).toBe("tightening");
    expect(a.commodityMetrics?.inventoryTrend).toBe("declining");
    expect(a.commodityMetrics?.inventoryBaselinePosition).toBe("below");
    expect(a.commodityMetrics?.positioningLabel).toBe("supportive");
    expect(a.commodityMetrics?.curveStructure).toBe("backwardation");
    expect(a.evidenceCoverage.dimensionsScored).toBeGreaterThanOrEqual(3);
  });

  it("(2) gold is assessable without any physical feed — non-insufficient", () => {
    const a = assessGold();
    expect(a.available).toBe(true);
    expect(a.state).not.toBe("insufficient");
    expect(a.confidence).not.toBe("insufficient");
    // No physical feed exists for bullion: those dimensions stay unavailable
    // while positioning + the real-yield channel carry the read.
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(dim(a, "supply-demand").status).toBe("unavailable");
    expect(dim(a, "term-structure").status).toBe("unavailable");
    expect(dim(a, "futures-positioning").status).toBe("positive");
    expect(dim(a, "macro-drivers").status).toBe("negative");
    expect(a.commodityMetrics?.futuresPositioningNet).toBe(216_000);
    expect(a.commodityMetrics?.real10yYieldPercent).toBe(2.05);
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
  });

  it("(3) two identities share the SAME generic engine and contract", () => {
    const wti = assessFundamentals(undefined, {
      instrument: "WTI",
      instrumentType: "commodity",
      eia: STOCKS_ONLY,
      cot: COT_WTI_SUPPORTIVE,
      treasury: TREASURY_HEADWIND,
      commodityCurve: CURVE_BACKWARDATION,
    });
    const gold = assessFundamentals(undefined, {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      cot: COT_GOLD,
      treasury: TREASURY_HEADWIND,
    });
    for (const a of [wti, gold]) {
      expect(a.domain).toBe("commodity");
      expect(a.dimensions.map((d) => d.name).sort()).toEqual([...COMMODITY_DIMENSIONS].sort());
      expect(Array.isArray(a.evidence)).toBe(true);
      expect(typeof a.confidenceEvidence).toBe("string");
      expect(a.metrics).toEqual({});
    }
    // Same engine, different real evidence → different assessments (the two
    // identities share no metric, no dimension content and no profile).
    expect(wti.commodityMetrics).not.toEqual(gold.commodityMetrics);
    expect(wti.commodityProfile?.group).toBe("energy");
    expect(gold.commodityProfile?.group).toBe("precious-metals");
    expect(JSON.stringify(wti)).not.toBe(JSON.stringify(gold));
  });

  it("(4) no symbol-specific branch exists in the domain adapter", () => {
    const source = stripComments(fs.readFileSync(path.join(process.cwd(), "src/lib/fundamental/commodity.ts"), "utf8"));
    for (const token of ["WTI", "BRENT", "XAU", "GOLD", "SILVER", "COPPER", "NGAS", "CLU25", "CLZ25"]) {
      expect(source, token).not.toContain(token);
    }
    for (const pattern of [/instrument\s*===/, /instrument\s*\.toUpperCase\(\)\s*\.includes/, /symbol\s*===/]) {
      expect(source).not.toMatch(pattern);
    }
    // Classification comes from the canonical registry (tags), which IS the
    // configuration; the same helper classifies every commodity identity.
    expect(commodityProfileOf("WTI").group).toBe("energy");
    expect(commodityProfileOf("XAU/USD").group).toBe("precious-metals");
    expect(commodityProfileOf("XAU/USD").classificationSource).toMatch(/canonical registry entry "XAU\/USD"/);
    expect(commodityProfileOf("SOMETHING-NEW").group).toBe("unclassified");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Every real evidence change alters the assessment (proofs 5–9)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (B) — real evidence changes the assessment", () => {
  it("(5) an inventory change alters the state, the regime and the metrics", () => {
    const drawing = assessWti();
    const building = assessWti({
      futuresCurve: undefined,
      eia: eia([
        stockLeg({ productId: "EPC0", productName: "Crude Oil Excluding SPR", values: [494.6, 486.2, 480.1, 476.4, 472.0, 469.3, 466.8, 463.1, 460.4, 458.2, 455.9, 453.4] }),
        stockLeg({ productId: "EPM0", productName: "Finished Motor Gasoline", values: [252.3, 246.1, 241.0, 236.4, 231.2, 228.4, 226.1, 224.0, 222.3, 220.9, 219.6, 218.4] }),
        stockLeg({ productId: "EPD0", productName: "Distillate Fuel Oil", values: [130.2, 127.4, 125.1, 121.9, 118.4, 116.2, 114.8, 113.5, 112.6, 111.8, 111.0, 110.4] }),
      ]),
    });
    expect(drawing.state).toBe("improving");
    expect(building.state).toBe("weakening");
    expect(building.directionalBias).toBe("bearish");
    expect(drawing.commodityMetrics?.physicalRegime).toBe("tightening");
    expect(building.commodityMetrics?.physicalRegime).toBe("loosening");
    expect(building.commodityMetrics?.inventoryTrend).toBe("rising");
    expect(building.commodityMetrics?.inventoryChangeWoW).toBeGreaterThan(0);
    expect(dim(building, "inventories").status).toBe("negative");
  });

  it("(6) a production change alters the supply/demand dimension and the state", () => {
    const risingSupply = assessWti({ eia: STOCKS_AND_FLOWS, cot: COT_WTI_OPPOSING, futuresCurve: undefined });
    expect(dim(risingSupply, "supply-demand").status).toBe("negative");
    expect(risingSupply.state).not.toBe("improving");
    expect(risingSupply.commodityMetrics?.inventoryLegsAvailable).toBe(3);

    const fallingSupply = assessWti({
      cot: COT_WTI_OPPOSING,
      futuresCurve: undefined,
      eia: eia([
        CRUDE_STOCKS,
        GASOLINE_STOCKS,
        DISTILLATE_STOCKS,
        flow({
          productId: "PRD",
          productName: "U.S. Field Production of Crude Oil",
          unit: "thousand barrels per day",
          values: [13_280, 13_620],
        }),
        flow({
          productId: "IMP",
          productName: "Crude Oil Imports",
          unit: "thousand barrels per day",
          values: [5_890, 6_180],
        }),
        flow({
          productId: "EXP",
          productName: "Crude Oil Exports",
          unit: "thousand barrels per day",
          values: [4_210, 3_520],
        }),
        flow({
          productId: "REFU",
          productName: "Refinery Utilization",
          unit: "%",
          values: [94.8, 92.6],
        }),
      ]),
    });
    expect(dim(fallingSupply, "supply-demand").status).toBe("positive");
    expect(fallingSupply.state).toBe("improving");
    expect(fallingSupply.evidence.some((e) => e.metric === "supply_demand_production")).toBe(true);
  });

  it("(7) a COT change alters the positioning dimension and the state", () => {
    const supportive = assessWti({ cot: COT_WTI_SUPPORTIVE, futuresCurve: undefined });
    const opposing = assessWti({ cot: COT_WTI_OPPOSING, futuresCurve: undefined });
    expect(dim(supportive, "futures-positioning").status).toBe("positive");
    expect(dim(opposing, "futures-positioning").status).toBe("negative");
    expect(supportive.state).toBe("improving");
    expect(opposing.state).not.toBe("improving");
    expect(supportive.commodityMetrics?.positioningLabel).toBe("supportive");
    expect(opposing.commodityMetrics?.positioningLabel).toBe("opposing");
  });

  it("(8) a real curve changes the term-structure dimension and the state", () => {
    const backwardation = assessWti({ futuresCurve: CURVE_BACKWARDATION, cot: COT_WTI_OPPOSING });
    const contango = assessWti({ futuresCurve: CURVE_CONTANGO, cot: COT_WTI_OPPOSING });
    expect(dim(backwardation, "term-structure").status).toBe("positive");
    expect(dim(contango, "term-structure").status).toBe("negative");
    expect(backwardation.commodityMetrics?.curveStructure).toBe("backwardation");
    expect(contango.commodityMetrics?.curveStructure).toBe("contango");
    expect(backwardation.state).not.toBe(contango.state);
    expect(contango.directionalBias).not.toBe("bullish");
    // The curve's own contracts and levels are preserved verbatim.
    const front = contango.evidence.find((e) => e.metric === "curve_front")!;
    expect(front.providerInstrumentId).toBe("CLU25");
    expect(front.value).toBe(65.9);
    expect(front.unit).toBe("USD per barrel");
    expect(front.period).toBe("2025-09");
  });

  it("(9) a missing term structure never forces insufficient", () => {
    const a = assessWti({ futuresCurve: undefined });
    expect(dim(a, "term-structure").status).toBe("unavailable");
    expect(a.state).not.toBe("insufficient");
    expect(a.directionalBias).toBe("bullish");
    expect(a.commodityMetrics?.curveStructure).toBeUndefined();
    expect(a.unavailableDimensions).toContain("term-structure");
    expect(a.limitations.join(" ")).toMatch(/no configured provider supplies a multi-expiry futures curve/);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Honest unavailability and labelling (proofs 10–13, 22–23)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (C) — unavailable stays unavailable, nothing leaks in", () => {
  it("(10) a metric the providers did not supply stays absent, with a reason", () => {
    const gold = assessGold();
    expect(gold.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect("inventoryChangeWoW" in (gold.commodityMetrics ?? {})).toBe(false);
    expect("curveStructure" in (gold.commodityMetrics ?? {})).toBe(false);
    expect(gold.limitations.join(" ")).toMatch(/Inventory UNAVAILABLE/);
    expect(gold.limitations.join(" ")).toMatch(/Supply\/demand UNAVAILABLE/);

    const noReal = assessCommodityFundamentals({
      instrument: "XAU/USD",
      cot: COT_GOLD,
      treasury: treasury({ realTenY: null }),
    });
    expect(noReal.commodityMetrics?.real10yYieldPercent).toBeUndefined();
    expect(noReal.evidence.some((e) => e.metric === "usd_10y_real")).toBe(false);
    expect(dim(noReal, "macro-drivers").evidence).toMatch(/real 10Y not supplied/);
  });

  it("(11) provider failures are explicit and never substituted", () => {
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      provider: "twelve-data",
      eia: eia([CRUDE_STOCKS], { failedLegs: [{ productId: "EPD0", reason: "HTTP 403 — no API key" }] }),
      cot: { available: false, reason: "instrument is not one of the verified CFTC contract mappings", requestedInstrument: "WTI" } as CotData,
      treasury: { available: false, reason: "Treasury feed returned no dated observations" } as TreasuryData,
    });
    expect(a.available).toBe(true);
    expect(a.limitations.join(" ")).toMatch(/EIA product legs that failed independently .*EPD0 — HTTP 403 — no API key/);
    expect(a.limitations.join(" ")).toMatch(/Futures positioning UNAVAILABLE .*instrument is not one of the verified CFTC contract mappings/);
    expect(a.limitations.join(" ")).toMatch(/Macro-driver evidence UNAVAILABLE .*Treasury feed returned no dated observations/);
    expect(a.commodityMetrics?.futuresPositioningNet).toBeUndefined();
    expect(a.commodityMetrics?.nominal10yYieldPercent).toBeUndefined();
    expect(a.unavailableDimensions).toEqual(
      expect.arrayContaining(["supply-demand", "term-structure", "futures-positioning", "macro-drivers"]),
    );
    // A provider-level EIA failure with no stock series leaves inventory unavailable with the reason.
    const noEia = assessCommodityFundamentals({ instrument: "WTI", eia: EIA_UNAVAILABLE, treasury: TREASURY_HEADWIND });
    expect(dim(noEia, "inventories").status).toBe("unavailable");
    expect(noEia.limitations.join(" ")).toMatch(/\(EIA_API_KEY is not configured\)/);
  });

  it("(12) historical observation periods are preserved end to end", () => {
    const a = assessWti({ futuresCurve: undefined });
    expect(a.reportingPeriod).toBe("2025-07-03"); // latest provider period: EIA 07-02, COT 07-01, Treasury 07-03
    expect(a.observedAt).toBe(TREASURY_FETCHED); // max acquisition receipt
    // With a real curve, its own observation date is a measurement period too.
    expect(assessWti().reportingPeriod).toBe("2025-07-04");
    expect(a.evidence.every((e) => typeof e.period === "string" && e.period.length > 0)).toBe(true);
    expect(a.evidence.every((e) => e.observedAt > 0)).toBe(true);
    const inventory = a.evidence.find((e) => e.metric === "inventory_wpsr")!;
    expect(inventory.period).toBe("2025-07-02");
    expect(inventory.observedAt).toBe(EIA_FETCHED);
    expect(inventory.observedAtSemantics).toBe("acquisition-receipt");
    expect(inventory.freshness).toBe("FRESH");
    expect(inventory.unit).toBe("million barrels");
    // The multi-week trend cites the observation it compared against.
    const trend = a.evidence.find((e) => e.metric === "inventory_trend")!;
    expect(String(trend.basis)).toMatch(/from 2025-06-11 to 2025-07-02/);
    expect(trend.basis).toContain(`${EIA_TREND_MIN_WEEKS}-observation change`);
    expect(dim(a, "inventories").evidence).toMatch(/Multi-week trend: declining/);
    expect(dim(a, "inventories").evidence).toMatch(/below the mean of the previous 11 weekly observations/);
  });

  it("(13) nothing is double counted: the physical condition is scored once, consumers are named", () => {
    const a = assessWti();
    // Three stock legs describe ONE physical condition → one scored dimension.
    expect(a.dimensions.filter((d) => d.name === "inventories").length).toBe(1);
    expect(a.commodityMetrics?.inventoryLegsAvailable).toBe(3);
    expect(a.commodityMetrics?.inventoryDraws).toBe(3);
    expect(a.commodityMetrics?.inventoryBuilds).toBe(0);
    // Every EIA/COT/Treasury evidence item names the conviction layer that
    // also consumes it, so the same field can never become two weighted votes.
    for (const item of a.evidence.filter((e) => e.provider.includes("EIA") || e.provider === "CFTC" || e.provider === "US Treasury")) {
      expect(item.consumedElsewhere).toMatch(/conviction engine's (EIA Inventory|COT Positioning|Macro Yield) layer/);
    }
    // `consumedBy` is only ever set together with `informational` (Phase 279 contract).
    for (const d of a.dimensions) {
      if (d.consumedBy !== undefined) expect(d.informational, d.name).toBe(true);
    }
    expect(a.limitations.join(" ")).toMatch(/adds no weighted decision factor/);
  });

  it("(22) every evidence item states its class; derived/interpretation carry a basis", () => {
    for (const a of [assessWti(), assessGold()]) {
      expect(a.evidence.length).toBeGreaterThan(0);
      for (const item of a.evidence) {
        expect(item.evidenceClass, item.metric).toBeDefined();
        if (item.evidenceClass === "provider-reported") {
          expect(item.derived ?? false, item.metric).toBe(false);
        } else {
          expect(item.derived, item.metric).toBe(true);
          expect(typeof item.basis, item.metric).toBe("string");
        }
      }
      const classes = new Set(a.evidence.map((e) => e.evidenceClass));
      expect(classes.has("provider-reported")).toBe(true);
      expect(classes.has("derived-metric")).toBe(true);
      expect(classes.has("interpretation")).toBe(true);
      // The interpretation items say so in their own words.
      const regime = a.evidence.find((e) => e.metric === "inventory_physical_regime");
      if (regime) expect(regime.label).toMatch(/Derived physical-market regime/);
      const text = a.dimensions.map((d) => d.evidence ?? "").join(" ");
      if (a.instrumentId === "WTI") {
        expect(text).toMatch(/Provider stocks only/);
        expect(text).toMatch(/DIRECTION POLICY \(documented\)/);
      }
    }
  });

  it("(23) the documented hierarchy applies, and one macro variable can never dictate", () => {
    const wtiProfile = commodityProfileOf("WTI");
    expect(wtiProfile.group).toBe("energy");
    expect(wtiProfile.hierarchy.find((h) => h.name === "inventories")?.role).toBe("primary");
    expect(wtiProfile.hierarchy.find((h) => h.name === "futures-positioning")?.role).toBe("secondary");
    expect(wtiProfile.hierarchy.find((h) => h.name === "macro-drivers")?.role).toBe("supporting");

    const goldProfile = commodityProfileOf("XAU/USD");
    expect(goldProfile.group).toBe("precious-metals");
    expect(goldProfile.hierarchy.find((h) => h.name === "macro-drivers")?.role).toBe("supporting");

    // Macro evidence ALONE (however material) is supporting-only: no primary
    // dimension carries it, so the assessment stays non-directional.
    const macroOnly = assessCommodityFundamentals({
      instrument: "WTI",
      treasury: treasury({ nominalTenY: 4.9, previousTenY: 4.28 }),
    });
    expect(dim(macroOnly, "macro-drivers").status).toBe("negative");
    expect(macroOnly.state).not.toBe("improving");
    expect(macroOnly.state).not.toBe("weakening");
    expect(macroOnly.directionalBias).toBe("none");
    expect(macroOnly.confidenceEvidence).toMatch(/a primary read is required/);
    expect(macroOnly.confidenceEvidence).toMatch(/1 independent provider group/);

    // …while the same macro evidence as part of a physical read cannot flip
    // the physical dimension: the hierarchy keeps physical evidence primary.
    const physical = assessWti();
    expect(physical.commodityMetrics?.physicalRegime).toBe("tightening");
    expect(physical.state).toBe("improving");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. No stock metrics, no fake derivatives, no clock (proofs 14–17)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (D) — no leakage, no fabrication, no clock", () => {
  it("(14) no stock-style metric or wording exists for a commodity", () => {
    for (const a of [assessWti(), assessGold()]) {
      expect(a.metrics).toEqual({});
      const keys = Object.keys(a.commodityMetrics ?? {});
      for (const token of ["eps", "p/e", "peratio", "pe_ratio", "revenue", "margin", "earnings", "bookvalue", "dividend", "grossprofit"]) {
        expect(keys.some((k) => k.toLowerCase().includes(token)), token).toBe(false);
      }
      // Company vocabulary may only appear in the explicit non-applicability
      // disclosure — strip every limitation, then assert the rest is clean.
      const withoutDisclosures = [
        JSON.stringify(a.dimensions),
        JSON.stringify(a.evidence),
        a.summary ?? "",
        a.confidenceEvidence,
        a.directionalBiasEvidence ?? "",
        ...a.contradictions,
      ]
        .join(" ")
        .replace(/no EPS\/P\/E\/revenue metric[^.]*\./g, " ");
      for (const token of ["EPS", "P/E", "revenue growth", "gross margin", "net margin", "earnings per share"]) {
        expect(withoutDisclosures, token).not.toContain(token);
      }
      expect(a.limitations.join(" ")).toMatch(/no EPS\/P\/E\/revenue metric is computed or shown/);
    }
  });

  it("(15) no fake order-flow or derivatives evidence is invented", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/fundamental/commodity.ts"), "utf8");
    for (const token of ["cvd", "orderFlow", "order_flow", "liquidations", "fundingRate", "funding_rate", "open_interest", "iv_rank", "options"]) {
      expect(source, token).not.toContain(token);
    }
    for (const a of [assessWti(), assessGold()]) {
      for (const item of a.evidence) {
        expect(item.metric).not.toMatch(/funding|cvd|liquidation|order_book|option/i);
        expect(item.provider).not.toMatch(/CoinGlass|Binance|OKX/i);
      }
    }
  });

  it("(16) deterministic: identical evidence yields a byte-identical assessment and no clock read", () => {
    const spy = vi.spyOn(Date, "now");
    const first = assessWti();
    const second = assessWti();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const spy2 = vi.spyOn(Date, "now");
    assessFundamentals(undefined, {
      instrument: "WTI",
      instrumentType: "commodity",
      eia: STOCKS_ONLY,
      cot: COT_WTI_SUPPORTIVE,
      treasury: TREASURY_HEADWIND,
    });
    expect(spy2).not.toHaveBeenCalled();
  });

  it("(17) the adapter source never reads a clock", () => {
    const source = stripComments(fs.readFileSync(path.join(process.cwd(), "src/lib/fundamental/commodity.ts"), "utf8"));
    expect(source).not.toMatch(/Date\.now\(\)/);
    expect(source).not.toMatch(/new Date\(\)/);
    expect(source).not.toMatch(/performance\.now\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. Materiality, contradictions, explanation (proofs 18–20)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (E) — materiality, contradiction, explanation", () => {
  it("(18) immaterial moves do not flip the state; material ones do", () => {
    const quiet = stockLeg({
      productId: "EPC0",
      productName: "Crude Oil Excluding SPR",
      values: [442.06, 442.1, 442.05, 442.02, 442.08, 442.0, 441.98, 442.01, 442.04, 442.02, 442.0, 441.99],
    });
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      eia: eia([quiet]),
      cot: COT_WTI_SUPPORTIVE,
      treasury: TREASURY_HEADWIND,
    });
    expect(a.commodityMetrics?.physicalRegime).toBe("insufficient");
    expect(a.commodityMetrics?.inventoryTrend).toBe("stable");
    expect(dim(a, "inventories").status).toBe("neutral");
    expect(dim(a, "inventories").evidence).toMatch(/documented noise band/);
    expect(a.commodityMetrics?.inventoryChangeWoW).toBeLessThan(EIA_SIGNAL_MIN_MBBL);
    expect(Math.abs(a.commodityMetrics?.inventoryChangePercentWoW ?? 0)).toBeLessThan(EIA_SIGNAL_THRESHOLD_PCT);
    // The same instrument with material draws is improving — materiality is
    // what moves the assessment, not the mere presence of a number.
    expect(assessWti().state).toBe("improving");
  });

  it("(19) cross-provider tension is reported as a contradiction, never averaged away", () => {
    // Stocks draw while non-commercial positioning is cut: opposite directions.
    const a = assessWti({ cot: COT_WTI_OPPOSING });
    expect(a.contradictions.some((c) => c.startsWith("Cross-provider tension for WTI"))).toBe(true);
    expect(a.contradictions.find((c) => c.startsWith("Cross-provider tension"))).toMatch(
      /EIA release moved stocks down/,
    );
    // Same-direction evidence produces no manufactured contradiction.
    const b = assessWti({ cot: COT_WTI_SUPPORTIVE });
    expect(b.contradictions.some((c) => c.startsWith("Cross-provider tension"))).toBe(false);
  });

  it("(20) the explanation states every required line from the same evidence", () => {
    const a = assessWti({ cot: COT_WTI_OPPOSING });
    const s = a.summary ?? "";
    expect(s).toMatch(/Physical market: tightening/);
    expect(s).toMatch(/Inventory: 442\.1 million barrels, week-over-week -10\.50/);
    expect(s).toMatch(/trend declining/);
    expect(s).toMatch(/Supply\/demand: unavailable/);
    expect(s).toMatch(/Positioning: opposing/);
    expect(s).toMatch(/percentile \d+% of the provider's own history/);
    expect(s).toMatch(/Term structure: backwardation \(front-to-back [+-]?[\d.]+%\)/);
    expect(s).toMatch(/Macro: a headwind/);
    expect(s).toMatch(/Assessment: (improving|weakening|mixed) · confidence (high|medium|low)/);
    expect(s).toMatch(/Risk: /);
    expect(s).toMatch(/Periods: /);
    // Every number in the summary exists in the shown evidence/metrics.
    expect(s).toContain(String(a.commodityMetrics?.inventoryLatest));
    expect(a.directionalBiasEvidence).toBeTruthy();
  });

  it("(21) extreme positioning is context, never a direction", () => {
    const extreme = cot({
      instrument: "XAU/USD",
      sourceInstrument: "GOLD - COMMODITY EXCHANGE INC.",
      mappedAsset: "Gold futures (COMEX)",
      net: 470_000, // 90% of open interest — far beyond the crowding threshold
      change: 2_000, // inside the noise band, so the level is the only read
      openInterest: 520_000,
      history: false,
    });
    const a = assessCommodityFundamentals({ instrument: "XAU/USD", cot: extreme, treasury: TREASURY_HEADWIND });
    expect(a.commodityMetrics?.positioningLabel).toBe("crowded");
    expect(a.commodityMetrics?.positioningCrowdRatio).toBeGreaterThan(COT_CROWDING_OI_RATIO);
    expect(dim(a, "futures-positioning").status).toBe("neutral");
    expect(a.directionalBias).not.toBe("bearish");
    expect(a.contradictions.join(" ")).toMatch(/Crowded positioning/);
    expect(a.summary ?? "").toMatch(/crowded positioning/);
    expect(dim(a, "futures-positioning").status).toBe("neutral");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Consumers: unified, radar, UI (proofs 24–26)
// ═══════════════════════════════════════════════════════════════

function candles(count: number, start: number, slope: number): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = start + i * slope;
    return {
      timestamp: Date.parse("2025-01-01T00:00:00Z") + i * 3_600_000,
      open: base,
      high: base + 0.4,
      low: base - 0.4,
      close: base + 0.2,
      volume: 1_000 + i,
    } as OhlcvCandle;
  });
}

function analysisInput(overrides?: Partial<AnalysisInput>): AnalysisInput {
  const cs = candles(220, 60, 0.12); // rising technical read
  const last = cs[cs.length - 1];
  return {
    instrument: "WTI",
    instrumentType: "commodity",
    provider: "twelve-data",
    providerInstrumentId: "WTI",
    price: { price: last.close, timestamp: last.timestamp, source: "provider" },
    candles: cs,
    timeframe: "H4",
    fetchTimestamp: last.timestamp,
    dataFreshness: "realtime",
    technicalData: calculateTechnical(cs),
    ...overrides,
  } as AnalysisInput;
}

describe("280 commodity (F) — the rest of the platform receives the assessment", () => {
  it("(24) unified intelligence consumes the commodity assessment exactly as produced", () => {
    const result = runAnalysis(
      analysisInput({ eiaData: STOCKS_ONLY, cotData: COT_WTI_SUPPORTIVE, treasuryData: TREASURY_HEADWIND }),
    );
    const assessment = result.fundamentalAssessment!;
    expect(assessment.domain).toBe("commodity");
    expect(assessment.state).toBe("improving");
    const unified = buildUnifiedIntelligence(result);
    expect(unified.fundamental.state).toBe(assessment.state);
    expect(unified.fundamental.available).toBe(true);
    expect(unified.explanation).toContain("FUNDAMENTAL STATE IMPROVING");
    expect(["aligned_bullish", "mixed", "conflicting"]).toContain(unified.state);
    expect(unified.state).not.toBe("technical_only");
    expect(unified.state).not.toBe("insufficient");
  });

  it("(25) the radar receives the commodity fundamental state without recalculating it", () => {
    const result = runAnalysis(
      analysisInput({ eiaData: STOCKS_ONLY, cotData: COT_WTI_SUPPORTIVE, treasuryData: TREASURY_HEADWIND }),
    );
    const unified = buildUnifiedIntelligence(result);
    const now = Date.parse("2025-07-05T14:30:00Z");
    const source: RadarCandidateSource = {
      universe: {
        instrument: "WTI",
        assetClass: "commodity",
        region: "global",
        providerNative: { provider: "twelve-data", providerInstrumentId: "WTI" },
        requiredCapabilities: ["ohlcv", "quote"],
        priority: 1,
        refreshIntervalMs: 300_000,
      },
      snapshot: {
        instrument: "WTI",
        assetClass: "commodity",
        region: "global",
        price: 68.4,
        ohlcvAvailable: true,
        availableTimeframes: ["H1", "H4", "D1"],
        htfBias: "long",
        mtfAlignment: "ALIGNED_BULLISH",
        marketRegime: "TRENDING",
        spreadBps: 2,
        volatility: 14,
        provider: "twelve-data",
        observedAt: now,
        timestampProvenance: "PROVIDER_OBSERVED",
        freshness: "FRESH",
        quality: "VERIFIED",
      } as RadarCandidateSource["snapshot"],
      unified: unified as unknown as RadarCandidateSource["unified"],
    } as RadarCandidateSource;
    const scanned = scanRadar([source], { horizons: ["INTRADAY", "SWING"], maxResults: 5 }, undefined, now);
    const opportunities = [...scanned.results.values()].flat();
    expect(opportunities.length).toBeGreaterThan(0);
    const opportunity = opportunities.find((o) => o.instrument === "WTI");
    expect(opportunity).toBeDefined();
    // The radar carries the engine's own state verbatim — it never re-derives
    // a fundamental state from the unified object.
    expect(opportunity!.unified?.fundamentalState).toBe("improving");
    expect(opportunity!.unified?.fundamentalState).toBe(result.fundamentalAssessment!.state);
    const radarSource = fs.readFileSync(path.join(process.cwd(), "src/lib/market-radar/unified-confluence.ts"), "utf8");
    expect(radarSource).not.toMatch(/assessCommodityFundamentals|aggregateConfidence|aggregateState/);
  });

  it("(26) the existing Fundamental UI section renders the actual assessment", () => {
    const result = runAnalysis(
      analysisInput({
        eiaData: STOCKS_ONLY,
        cotData: COT_WTI_SUPPORTIVE,
        treasuryData: TREASURY_HEADWIND,
      }),
    );
    const { container } = render(createElement(AnalysisResultDisplay, { result }));
    const text = container.textContent ?? "";
    const assessment = result.fundamentalAssessment!;
    expect(text).toContain(assessment.provider);
    expect(text).toContain("WTI");
    for (const d of assessment.dimensions.filter((d) => d.status !== "unavailable" && d.evidence)) {
      expect(text).toContain(d.evidence!);
    }
    expect(text).toMatch(/Crude Oil Excluding SPR \(EPC0\) 442\.1 million barrels/);
    expect(text).toMatch(/net non-commercial/);
    expect(text).toMatch(/Physical regime: tightening/);
    expect(text).toMatch(/Multi-week trend: declining/);
    expect(text).toMatch(/Term structure: unavailable — no multi-expiry provider is configured/);
    expect(text).toMatch(/Supporting driver only/);
    const withoutDisclosures = assessment.limitations.reduce(
      (acc, limitation) => acc.split(limitation).join(" "),
      text,
    );
    expect(withoutDisclosures).not.toContain("EPS");
    expect(withoutDisclosures).not.toContain("P/E");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Metric-bag honesty, single observations, freshness (proofs 28–30)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (G) — the metric bag holds only what the providers supplied", () => {
  it("(28) the metric bag is exactly the supplied evidence", () => {
    const wti = assessWti({ futuresCurve: undefined });
    expect(Object.keys(wti.commodityMetrics ?? {}).sort()).toEqual(
      [
        "futuresPositioningChange",
        "futuresPositioningNet",
        "inventoryBaselineDeviationPercent",
        "inventoryBaselinePosition",
        "inventoryBuilds",
        "inventoryChangePercentWoW",
        "inventoryChangeWoW",
        "inventoryDraws",
        "inventoryLatest",
        "inventoryLegsAvailable",
        "inventoryTrend",
        "inventoryTrendChange",
        "inventoryTrendPercent",
        "nominal10yChangePp",
        "nominal10yYieldPercent",
        "physicalRegime",
        "positioningCommercialNet",
        "positioningCrowdRatio",
        "positioningLabel",
        "positioningPercentile",
        "real10yYieldPercent",
      ].sort(),
    );
    // A curve adds ONLY the curve fields, and gold carries no inventory field.
    const withCurve = assessWti();
    expect(Object.keys(withCurve.commodityMetrics ?? {}).sort()).toEqual(
      [...Object.keys(wti.commodityMetrics ?? {}), "curveBackPrice", "curveFrontPrice", "curveSlopePercent", "curveStructure"].sort(),
    );
    const gold = assessGold();
    expect(Object.keys(gold.commodityMetrics ?? {}).sort()).toEqual(
      [
        "futuresPositioningChange",
        "futuresPositioningNet",
        "nominal10yChangePp",
        "nominal10yYieldPercent",
        "positioningCrowdRatio",
        "positioningLabel",
        "positioningPercentile",
        "real10yYieldPercent",
      ].sort(),
    );
  });

  it("(29) a single-observation leg claims no week-over-week change and no imputed metric", () => {
    const lone: EiaSeriesPoint = {
      productId: "EPC0",
      productName: "Crude Oil Excluding SPR",
      observationDate: "2025-07-02",
      latestValue: 442.1,
      unit: "million barrels",
    };
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      eia: eia([lone]),
      cot: COT_WTI_SUPPORTIVE,
      treasury: TREASURY_HEADWIND,
    });
    expect(dim(a, "inventories").evidence).toMatch(/single observation — no week-over-week change exists/);
    expect(a.commodityMetrics?.inventoryLatest).toBe(442.1);
    expect("inventoryChangeWoW" in (a.commodityMetrics ?? {})).toBe(false);
    expect("inventoryChangePercentWoW" in (a.commodityMetrics ?? {})).toBe(false);
    expect(a.commodityMetrics?.inventoryTrend).toBe("insufficient");
    expect(a.commodityMetrics?.inventoryBaselinePosition).toBe("insufficient");
    expect(dim(a, "inventories").evidence).toMatch(/a 4-observation trend is not derivable/);
  });

  it("(30) a DELAYED/STALE provider label is preserved, never upgraded", () => {
    const a = assessWti({
      futuresCurve: undefined,
      eia: eia([CRUDE_STOCKS, GASOLINE_STOCKS], { freshness: "DELAYED" }),
      treasury: treasury({ freshness: "STALE" }),
    });
    expect(a.evidence.find((e) => e.metric === "inventory_wpsr")!.freshness).toBe("DELAYED");
    expect(a.evidence.find((e) => e.metric === "usd_10y_nominal")!.freshness).toBe("STALE");
    expect(dim(a, "inventories").evidence).toMatch(/freshness DELAYED/);
    expect(dim(a, "macro-drivers").evidence).toMatch(/freshness STALE/);
    expect(a.available).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. No leak into the other domains (proof 27)
// ═══════════════════════════════════════════════════════════════

describe("280 commodity (G) — the other domains are untouched", () => {
  it("(27) the commodity adapter cannot leak into crypto/forex/equity", () => {
    const crypto = assessFundamentals(undefined, { instrument: "BTC-USDT", instrumentType: "crypto" });
    const forex = assessFundamentals(undefined, { instrument: "EUR/USD", instrumentType: "forex" });
    const equity = assessFundamentals(undefined);
    expect(crypto.domain).toBe("crypto");
    expect(forex.domain).toBe("forex");
    expect(equity.domain).toBe("equity");
    for (const a of [crypto, forex, equity]) {
      expect(a.commodityMetrics).toBeUndefined();
      expect(a.commodityProfile).toBeUndefined();
      expect(a.dimensions.map((d) => d.name)).not.toContain("supply-demand");
      expect(a.summary ?? "").not.toMatch(/Physical market:/);
    }
    const source = stripComments(fs.readFileSync(path.join(process.cwd(), "src/lib/fundamental-engine.ts"), "utf8"));
    expect(source).toContain('instrumentType === "commodity"');
  });
});
