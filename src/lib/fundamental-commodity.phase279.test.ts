/**
 * Phase 279 — Commodity fundamental domain (Task D/E/F/G/I of the phase).
 *
 * The commodity adapter runs inside the SAME framework as equity, crypto and
 * forex: one contract, one aggregation, one deterministic result. What must be
 * proven here is the commodity-specific half:
 *
 *   · commodity-native evidence ONLY — the U.S. EIA petroleum stock release,
 *     the CFTC Commitments of Traders report and the US Treasury curve, each
 *     verbatim from the provider payload;
 *   · every evidence category the configured feeds do NOT supply (supply/demand
 *     balance, futures term structure, physical/regional detail, commodity
 *     drivers beyond the discount-rate channel) stays UNAVAILABLE with a reason
 *     and is never estimated from price, inventory or positioning;
 *   · NO stock-style metric exists for a commodity — no EPS, P/E, revenue or
 *     margin is computed, inferred or rendered;
 *   · nothing the conviction engine already scores is re-scored here (no double
 *     counting), so the domain is honestly non-directional;
 *   · provider identity, observation period/report date, unit, freshness and
 *     acquisition receipt survive the round trip, and no clock is ever read.
 *
 * Two real commodity identities run through the whole suite: WTI (petroleum
 * inventories + its own CFTC contract + the curve) and GOLD (no EIA stock
 * series at all, its own CFTC contract + the curve).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { assessFundamentals } from "@/lib/fundamental-engine";
import { assessCommodityFundamentals, COMMODITY_DIMENSIONS } from "@/lib/fundamental/commodity";
import { EIA_SIGNAL_MIN_MBBL, EIA_SIGNAL_THRESHOLD_PCT } from "@/lib/data/eia";
import { COT_SIGNAL_CHANGE_OI_RATIO } from "@/lib/data/cot";
import type { EiaContext, EiaData, EiaSeriesPoint } from "@/lib/data/eia";
import type { CotContext, CotData } from "@/lib/data/cot";
import type { TreasuryContext, TreasuryData } from "@/lib/data/treasury";
import type { FundamentalAssessment } from "@/lib/data/fundamental-contract";

// ── Provider payloads (verbatim provider shapes) ─────────────────

const EIA_FETCHED = Date.parse("2025-07-04T18:10:00Z");
const COT_FETCHED = Date.parse("2025-07-04T18:20:00Z");
const TREASURY_FETCHED = Date.parse("2025-07-04T18:30:00Z");

const crude: EiaSeriesPoint = {
  productId: "EPC0",
  productName: "Crude Oil Excluding SPR",
  observationDate: "2025-07-02",
  previousObservationDate: "2025-06-25",
  latestValue: 442.1,
  previousValue: 446.5,
  change: -4.4,
  changePercent: -0.99,
  unit: "million barrels",
};

const gasoline: EiaSeriesPoint = {
  productId: "EPM0",
  productName: "Finished Motor Gasoline",
  observationDate: "2025-07-02",
  previousObservationDate: "2025-06-25",
  latestValue: 231.2,
  previousValue: 228.9,
  change: 2.3,
  changePercent: 1.0,
  unit: "million barrels",
};

function eia(series: EiaSeriesPoint[] = [crude, gasoline], extra?: Partial<EiaContext>): EiaContext {
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

function cot(args: {
  instrument: string;
  sourceInstrument: string;
  mappedAsset: string;
  net: number;
  change?: number;
  openInterest?: number;
  freshness?: CotContext["freshness"];
  previous?: boolean;
}): CotContext {
  const openInterest = args.openInterest ?? 520_000;
  const long = 260_000;
  const short = long - args.net;
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: COT_FETCHED,
    freshness: args.freshness ?? "FRESH",
    requestedInstrument: args.instrument,
    sourceInstrument: args.sourceInstrument,
    mappedAsset: args.mappedAsset,
    latest: {
      reportDate: "2025-07-01",
      nonCommercialLong: long,
      nonCommercialShort: short,
      openInterest,
    },
    ...(args.previous === false
      ? {}
      : {
          previous: {
            reportDate: "2025-06-24",
            nonCommercialLong: long - (args.change ?? 0),
            nonCommercialShort: short,
            openInterest: openInterest - 5_000,
          },
        }),
    netNonCommercial: args.net,
    ...(args.change === undefined || args.previous === false
      ? {}
      : { changeFromPreviousReport: args.change }),
  };
}

const COT_WTI = cot({
  instrument: "WTI",
  sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
  mappedAsset: "WTI Crude Oil futures (NYMEX)",
  net: -42_000,
  change: -6_000,
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
  realTenY?: number | null;
  previousTenY?: number;
  freshness?: TreasuryContext["freshness"];
  source?: string;
}): TreasuryContext {
  const real = overrides?.realTenY;
  const nominalTenY = overrides?.nominalTenY ?? 4.35;
  const previousTenY = overrides?.previousTenY ?? 4.28;
  return {
    available: true,
    source: (overrides?.source ?? "US Treasury (home.treasury.gov XML feed)") as TreasuryContext["source"],
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
        : { real: { observationDate: "2025-07-02", real: { "10Y": (real ?? 2.05) - 0.07 } } }),
    },
  };
}

const EIA_UNAVAILABLE: EiaData = {
  available: false,
  reason: "EIA_API_KEY is not configured",
  source: "U.S. Energy Information Administration (Weekly Petroleum Status Report) as never-fetched",
} as unknown as EiaData;

const OIL = () =>
  assessCommodityFundamentals({
    instrument: "WTI",
    provider: "twelve-data",
    providerInstrumentId: "WTI",
    eia: eia(),
    cot: COT_WTI,
    treasury: treasury(),
  });

const GOLD = () =>
  assessCommodityFundamentals({
    instrument: "XAU/USD",
    provider: "twelve-data",
    providerInstrumentId: "XAU/USD",
    cot: COT_GOLD,
    treasury: treasury(),
  });

const dim = (a: FundamentalAssessment, name: string) => a.dimensions.find((d) => d.name === name)!;

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// A. Dispatch and the shared contract
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (A) — the dispatcher routes the domain through the shared engine", () => {
  it("(1) instrumentType commodity is assessed by the commodity adapter", () => {
    const a = assessFundamentals(undefined, { instrument: "WTI", instrumentType: "commodity" });
    expect(a.domain).toBe("commodity");
    expect(a.instrumentId).toBe("WTI");
    // The commodity dimension space — and only it.
    expect(a.dimensions.map((d) => d.name).sort()).toEqual([...COMMODITY_DIMENSIONS].sort());
  });

  it("(2) an unknown routing domain is explicitly unavailable, never another domain's metrics", () => {
    const a = assessFundamentals(undefined, { instrument: "US500", instrumentType: "indices" });
    expect(a.domain).toBe("insufficient");
    expect(a.available).toBe(false);
    expect(a.state).toBe("insufficient");
    expect(a.dimensions).toEqual([]);
    expect(a.evidence).toEqual([]);
    expect(a.metrics).toEqual({});
    expect(a.directionalBias).toBe("none");
    expect(a.limitations.join(" ")).toMatch(/not one of the four domains this fundamental framework assesses \(equity, crypto, forex, commodity\)/);
    expect(a.confidenceEvidence).toMatch(/no fundamental dimension space/);
  });

  it("(3) a missing instrumentType still routes to equity (Phase 274/275 continuity)", () => {
    const a = assessFundamentals(undefined);
    expect(a.domain).toBe("equity");
    expect(a.dimensions.map((d) => d.name)).toContain("revenue-growth");
  });

  it("(4) the assessment carries the SAME contract fields as the other domains", () => {
    const a = OIL();
    expect(a.available).toBe(true);
    expect(a.state).toBe("insufficient");
    expect(a.confidence).toBe("insufficient");
    expect(a.periodsCount).toBe(a.evidence.length);
    expect(a.evidenceCoverage.dimensionsTotal).toBe(a.dimensions.length);
    expect(a.evidenceCoverage.dimensionsAvailable).toBe(
      a.dimensions.filter((d) => d.status !== "unavailable").length,
    );
    expect(a.unavailableDimensions).toEqual(["supply-demand", "term-structure"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Inventories — U.S. EIA petroleum stocks
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (B) — EIA inventory evidence is provider-native and never re-scored", () => {
  it("(5) the EIA release produces inventory evidence with provider period, unit and receipt", () => {
    const a = OIL();
    const inv = dim(a, "inventories");
    expect(inv.status).toBe("neutral");
    expect(inv.informational).toBe(true);
    expect(inv.consumedBy).toBe("the conviction engine's EIA Inventory layer");
    expect(inv.evidence).toMatch(/U.S. EIA Weekly Petroleum Status Report \(observation 2025-07-02 vs 2025-06-25/);
    expect(inv.evidence).toMatch(/Crude Oil Excluding SPR \(EPC0\) 442\.1 million barrels, week-over-week -4\.40 million barrels \(-0\.99%\)/);
    expect(inv.evidence).toMatch(/Finished Motor Gasoline \(EPM0\) 231\.2 million barrels/);

    const item = a.evidence.find((e) => e.metric === "inventory_wpsr")!;
    expect(item.provider).toBe("U.S. Energy Information Administration");
    expect(item.value).toBe(442.1);
    expect(item.unit).toBe("million barrels");
    expect(item.period).toBe("2025-07-02");
    expect(item.observedAt).toBe(EIA_FETCHED);
    expect(item.observedAtSemantics).toBe("acquisition-receipt");
    expect(item.freshness).toBe("FRESH");
    expect(item.consumedElsewhere).toBe("the conviction engine's EIA Inventory layer");
    expect(item.source).toMatch(/petroleum\/sto\/data; series EPC0/);
  });

  it("(6) the materiality wording uses the EIA module's own documented thresholds", () => {
    const material = dim(OIL(), "inventories");
    expect(material.evidence).toContain(`>=${EIA_SIGNAL_MIN_MBBL}M bbl`);
    expect(material.evidence).toContain(`>=${EIA_SIGNAL_THRESHOLD_PCT}% of stocks`);
    expect(material.evidence).toMatch(/exceeds the EIA module's documented materiality thresholds/);

    // Sub-threshold move: the adapter says so and STILL forces no direction.
    const tiny: EiaSeriesPoint = {
      ...crude,
      latestValue: 442.05,
      previousValue: 442.1,
      change: -0.05,
      changePercent: -0.01,
    };
    const a = assessCommodityFundamentals({ instrument: "WTI", eia: eia([tiny]), cot: COT_WTI, treasury: treasury() });
    const quiet = dim(a, "inventories");
    expect(quiet.status).toBe("neutral");
    expect(quiet.informational).toBe(true);
    expect(quiet.evidence).toMatch(/is inside the EIA module's documented noise band/);
    expect(a.directionalBias).toBe("none");
  });

  it("(7) a single-observation leg claims no week-over-week change and no metric", () => {
    const lone: EiaSeriesPoint = {
      productId: "EPC0",
      productName: "Crude Oil Excluding SPR",
      observationDate: "2025-07-02",
      latestValue: 442.1,
      unit: "million barrels",
    };
    const a = assessCommodityFundamentals({ instrument: "WTI", eia: eia([lone]), cot: COT_WTI, treasury: treasury() });
    const inv = dim(a, "inventories");
    expect(inv.evidence).toMatch(/single observation/);
    expect(inv.evidence).toMatch(/no week-over-week change exists, and none is imputed/);
    expect(a.commodityMetrics?.inventoryLatest).toBe(442.1);
    expect("inventoryChangeWoW" in (a.commodityMetrics ?? {})).toBe(false);
    expect("inventoryChangePercentWoW" in (a.commodityMetrics ?? {})).toBe(false);
  });

  it("(8) failed EIA legs are reported with their reasons and never substituted", () => {
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      eia: eia([crude], { failedLegs: [{ productId: "EPD0", reason: "HTTP 403 — no API key" }] }),
      cot: COT_WTI,
      treasury: treasury(),
    });
    expect(a.limitations.join(" ")).toMatch(/EIA product legs that failed independently \(reported, never substituted or estimated\): EPD0 — HTTP 403 — no API key/);
    expect(a.evidence.filter((e) => e.metric === "inventory_wpsr").length).toBe(1);
  });

  it("(9) an unavailable EIA provider leaves inventories UNAVAILABLE with the provider's own reason", () => {
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      provider: "twelve-data",
      eia: EIA_UNAVAILABLE,
      cot: COT_WTI,
      treasury: treasury(),
    });
    const inv = dim(a, "inventories");
    expect(inv.status).toBe("unavailable");
    expect(inv.evidence).toBeUndefined();
    expect(a.limitations.join(" ")).toMatch(/Inventory UNAVAILABLE — no configured inventory provider returned a stock series for this instrument \(EIA_API_KEY is not configured\)/);
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(a.unavailableDimensions).toContain("inventories");
    // Regional/warehouse detail is disclosed as missing even when the headline exists.
    expect(OIL().limitations.join(" ")).toMatch(/Regional\/warehouse-level stocks, inventory surprise against a consensus and days-of-supply are NOT supplied/);
  });

  it("(10) gold has no EIA stock series — and none is invented for it", () => {
    const a = GOLD();
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(a.evidence.some((e) => e.metric === "inventory_wpsr")).toBe(false);
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(a.commodityMetrics?.inventoryLegsAvailable).toBeUndefined();
    expect(a.unavailableDimensions).toContain("inventories");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Futures positioning — CFTC COT
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (C) — CFTC positioning is context, never a second vote", () => {
  it("(11) the COT report produces positioning evidence for the verified contract", () => {
    const a = OIL();
    const pos = dim(a, "futures-positioning");
    expect(pos.status).toBe("neutral");
    expect(pos.informational).toBe(true);
    expect(pos.consumedBy).toBe("the conviction engine's COT Positioning layer");
    expect(pos.evidence).toMatch(/CFTC Commitments of Traders — WTI Crude Oil futures \(NYMEX\) \(WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE\), report 2025-07-01 vs 2025-06-24/);
    expect(pos.evidence).toMatch(/net -42,000, change -6,000 vs the previous report, open interest 520,000/);
    expect(pos.evidence).toMatch(/crowding .*% of open interest \(level context only — a level is never directional\)/);

    const item = a.evidence.find((e) => e.metric === "cot_net_non_commercial")!;
    expect(item.value).toBe(-42_000);
    expect(item.unit).toBe("contracts");
    expect(item.period).toBe("2025-07-01");
    expect(item.observedAt).toBe(COT_FETCHED);
    expect(a.commodityMetrics?.futuresPositioningNet).toBe(-42_000);
    expect(a.commodityMetrics?.futuresPositioningChange).toBe(-6_000);
  });

  it("(12) with no previous consecutive report no change is claimed", () => {
    const solo = cot({
      instrument: "WTI",
      sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
      mappedAsset: "WTI Crude Oil futures (NYMEX)",
      net: -42_000,
      previous: false,
    });
    const a = assessCommodityFundamentals({ instrument: "WTI", cot: solo, treasury: treasury() });
    expect(dim(a, "futures-positioning").evidence).toMatch(/no previous consecutive report, so no change is claimed/);
    expect(a.commodityMetrics?.futuresPositioningNet).toBe(-42_000);
    expect("futuresPositioningChange" in (a.commodityMetrics ?? {})).toBe(false);
  });

  it("(13) an unmapped or failed COT provider leaves positioning UNAVAILABLE with the reason", () => {
    const unavailable: CotData = {
      available: false,
      reason: "instrument is not one of the verified CFTC contract mappings",
      requestedInstrument: "COPPER",
    };
    const a = assessCommodityFundamentals({
      instrument: "COPPER",
      cot: unavailable,
      treasury: treasury(),
    });
    const pos = dim(a, "futures-positioning");
    expect(pos.status).toBe("unavailable");
    expect(a.limitations.join(" ")).toMatch(/Futures positioning UNAVAILABLE — no verified CFTC contract report covers this instrument \(instrument is not one of the verified CFTC contract mappings\); a contract is never guessed and another instrument's report is never substituted/);
    expect(a.commodityMetrics?.futuresPositioningNet).toBeUndefined();
  });

  it("(14) the crowding scale is the provider module's, not a new constant", () => {
    expect(COT_SIGNAL_CHANGE_OI_RATIO).toBeGreaterThan(0);
    const tiny = cot({
      instrument: "WTI",
      sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
      mappedAsset: "WTI Crude Oil futures (NYMEX)",
      net: 1_000,
      change: 100,
    });
    const a = assessCommodityFundamentals({ instrument: "WTI", cot: tiny, treasury: treasury() });
    expect(a.evidence.find((e) => e.metric === "cot_net_non_commercial")!.value).toBe(1_000);
    // A tiny positioning change is never promoted to a directional statement.
    expect(a.directionalBias).toBe("none");
    expect(dim(a, "futures-positioning").status).toBe("neutral");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. Macro drivers — the Treasury curve
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (D) — the discount-rate channel keeps Treasury's own values", () => {
  it("(15) nominal, real and the observation-to-observation change are reported verbatim", () => {
    const a = OIL();
    const macro = dim(a, "macro-drivers");
    expect(macro.status).toBe("neutral");
    expect(macro.informational).toBe(true);
    expect(macro.consumedBy).toBe("the conviction engine's Macro Yield layer");
    expect(macro.evidence).toMatch(/10Y nominal 4\.35%, 2Y 4\.12%, real 10Y 2\.05% \(Treasury's own real-yield feed\)/);
    expect(macro.evidence).toMatch(/10Y \+0\.07pp vs the previous observation/);
    expect(a.commodityMetrics?.nominal10yYieldPercent).toBe(4.35);
    expect(a.commodityMetrics?.real10yYieldPercent).toBe(2.05);
    expect(a.commodityMetrics?.nominal10yChangePp).toBeCloseTo(0.07, 6);
    expect(a.evidence.find((e) => e.metric === "usd_10y_real")!.source).toBe(
      "daily_treasury_real_yield_curve (home.treasury.gov XML feed)",
    );
  });

  it("(16) a missing real-yield feed is never proxied by the nominal one", () => {
    const a = assessCommodityFundamentals({
      instrument: "XAU/USD",
      cot: COT_GOLD,
      treasury: treasury({ realTenY: null }),
    });
    expect(dim(a, "macro-drivers").evidence).toMatch(/real 10Y not supplied/);
    expect(a.evidence.some((e) => e.metric === "usd_10y_real")).toBe(false);
    expect(a.commodityMetrics?.real10yYieldPercent).toBeUndefined();
    expect(a.commodityMetrics?.nominal10yYieldPercent).toBe(4.35);
  });

  it("(17) an unavailable Treasury leaves macro-drivers UNAVAILABLE with the reason", () => {
    const unavailable: TreasuryData = { available: false, reason: "Treasury feed returned no dated observations" };
    const a = assessCommodityFundamentals({ instrument: "WTI", eia: eia(), cot: COT_WTI, treasury: unavailable });
    const macro = dim(a, "macro-drivers");
    expect(macro.status).toBe("unavailable");
    expect(a.limitations.join(" ")).toMatch(/Macro-driver evidence UNAVAILABLE — no Treasury observation was supplied for this analysis \(Treasury feed returned no dated observations\)/);
    expect("nominal10yYieldPercent" in (a.commodityMetrics ?? {})).toBe(false);
  });

  it("(18) a DELAYED/STALE provider label is preserved, never upgraded", () => {
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      eia: eia([crude], { freshness: "DELAYED" }),
      cot: COT_WTI,
      treasury: treasury({ freshness: "STALE" }),
    });
    expect(dim(a, "inventories").evidence).toMatch(/freshness DELAYED/);
    expect(dim(a, "macro-drivers").evidence).toMatch(/freshness STALE/);
    expect(a.evidence.find((e) => e.metric === "inventory_wpsr")!.freshness).toBe("DELAYED");
    expect(a.evidence.find((e) => e.metric === "usd_10y_nominal")!.freshness).toBe("STALE");
    expect(a.available).toBe(true);
    expect(a.directionalBias).toBe("none");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. No invention, no leakage, no double counting
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (E) — unavailable stays unavailable, nothing leaks in", () => {
  it("(19) supply/demand and term structure are ALWAYS unavailable, with explicit reasons", () => {
    for (const [label, a] of [["WTI", OIL()], ["GOLD", GOLD()]] as const) {
      expect(dim(a, "supply-demand").status, label).toBe("unavailable");
      expect(dim(a, "supply-demand").evidence, label).toBeUndefined();
      expect(dim(a, "term-structure").status, label).toBe("unavailable");
      const text = a.limitations.join(" ");
      expect(text, label).toMatch(/Supply\/demand UNAVAILABLE — no configured provider returned production, consumption, imports\/exports, surplus\/deficit or production-capacity evidence/);
      expect(text, label).toMatch(/Futures term structure \(contango\/backwardation, front\/back-month relationship, curve slope, calendar spreads, basis and roll yield\) UNAVAILABLE/);
      expect(text, label).toMatch(/crop\/weather\/harvest evidence\) UNAVAILABLE/);
    }
  });

  it("(20) no stock-style metric exists for a commodity, and none is rendered as applicable", () => {
    for (const a of [OIL(), GOLD()]) {
      expect(a.metrics).toEqual({});
      const keys = Object.keys(a.commodityMetrics ?? {});
      const forbidden = ["eps", "peRatio", "priceTo", "revenue", "margin", "earnings", "bookValue", "dividend"];
      for (const token of forbidden) {
        expect(keys.some((k) => k.toLowerCase().includes(token.toLowerCase())), token).toBe(false);
      }
      expect(a.limitations.join(" ")).toMatch(/no EPS\/P\/E\/revenue metric is computed or shown for one, and a commodity is never treated as having a corporate issuer/);
      expect(keys).toEqual(
        expect.arrayContaining(["nominal10yYieldPercent", "real10yYieldPercent"]),
      );
    }
  });

  it("(21) the metric bag contains ONLY what the providers supplied", () => {
    const oil = OIL();
    expect(Object.keys(oil.commodityMetrics ?? {}).sort()).toEqual(
      [
        "futuresPositioningChange",
        "futuresPositioningNet",
        "inventoryChangePercentWoW",
        "inventoryChangeWoW",
        "inventoryLatest",
        "inventoryLegsAvailable",
        "nominal10yChangePp",
        "nominal10yYieldPercent",
        "real10yYieldPercent",
      ].sort(),
    );

    const gold = GOLD();
    expect(Object.keys(gold.commodityMetrics ?? {}).sort()).toEqual(
      ["futuresPositioningChange", "futuresPositioningNet", "nominal10yChangePp", "nominal10yYieldPercent", "real10yYieldPercent"].sort(),
    );
  });

  it("(22) the conviction engine's own layers are never re-scored (no double counting)", () => {
    const a = OIL();
    const usable = a.dimensions.filter((d) => d.status !== "unavailable");
    expect(usable.length).toBe(3);
    for (const d of usable) {
      expect(d.informational, d.name).toBe(true);
      expect(d.consumedBy, d.name).toMatch(/conviction engine's (EIA Inventory|COT Positioning|Macro Yield) layer/);
    }
    // No independently scored dimension → the state is insufficient BY DESIGN.
    expect(a.state).toBe("insufficient");
    expect(a.confidence).toBe("insufficient");
    expect(a.directionalBias).toBe("none");
    expect(a.directionalBiasEvidence).toMatch(/No independent directional read for WTI: 0 independently scored commodity dimensions exist/);
    expect(a.limitations.join(" ")).toMatch(/already scored by the conviction engine's own layers, so the state reads insufficient BY DESIGN/);
    expect(a.limitations.join(" ")).toMatch(/this assessment feeds only the unified intelligence layer and the opportunity scanner/);
  });

  it("(23) the cross-provider tension is reported as a contradiction, never averaged away", () => {
    // EIA draws stocks (negative) while non-commercial net positioning rises.
    const rising = cot({
      instrument: "WTI",
      sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
      mappedAsset: "WTI Crude Oil futures (NYMEX)",
      net: -20_000,
      change: 12_000,
    });
    const a = assessCommodityFundamentals({ instrument: "WTI", eia: eia(), cot: rising, treasury: treasury() });
    expect(a.contradictions.length).toBe(1);
    expect(a.contradictions[0]).toMatch(/Cross-provider tension for WTI: the EIA release moved stocks down \(-4\.40\) while CFTC non-commercial net positioning rose \(\+12,000\)/);

    // Same-direction evidence (stocks drawn AND non-commercial net cut)
    // produces no manufactured contradiction.
    const same = cot({
      instrument: "WTI",
      sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
      mappedAsset: "WTI Crude Oil futures (NYMEX)",
      net: -20_000,
      change: -12_000,
    });
    const b = assessCommodityFundamentals({ instrument: "WTI", eia: eia(), cot: same, treasury: treasury() });
    expect(b.contradictions).toEqual([]);
  });

  it("(24) no provider at all → explicit unavailable, never a fabricated state", () => {
    const a = assessCommodityFundamentals({ instrument: "COPPER", provider: "twelve-data" });
    expect(a.available).toBe(false);
    expect(a.domain).toBe("commodity");
    expect(a.provider).toBe("twelve-data");
    expect(a.instrumentId).toBe("COPPER");
    expect(a.state).toBe("insufficient");
    expect(a.confidence).toBe("insufficient");
    expect(a.directionalBias).toBe("none");
    expect(a.evidence).toEqual([]);
    expect(a.metrics).toEqual({});
    expect(a.commodityMetrics).toBeUndefined();
    expect(a.observedAt).toBe(0);
    expect(a.limitations[0]).toMatch(/No commodity-native fundamental evidence was supplied for COPPER/);
    expect(a.dimensions.every((d) => d.status === "unavailable")).toBe(true);
    expect(a.unavailableDimensions.length).toBe(COMMODITY_DIMENSIONS.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Determinism, periods, identities
// ═══════════════════════════════════════════════════════════════

describe("279 commodity (F) — deterministic, period-preserving, identity-preserving", () => {
  it("(25) identical evidence yields a byte-identical assessment and no clock read", () => {
    const spy = vi.spyOn(Date, "now");
    const first = OIL();
    const second = OIL();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    // …and the desktop-level entry point stays clock-free too.
    const spy2 = vi.spyOn(Date, "now");
    assessFundamentals(undefined, { instrument: "WTI", instrumentType: "commodity", cot: COT_WTI });
    expect(spy2).not.toHaveBeenCalled();
  });

  it("(26) changed provider evidence changes the result", () => {
    const base = OIL();
    const changed = assessCommodityFundamentals({
      instrument: "WTI",
      eia: eia([{ ...crude, latestValue: 430.0, change: -16.5, changePercent: -3.7 }]),
      cot: COT_WTI,
      treasury: treasury({ nominalTenY: 4.6, previousTenY: 4.28 }),
    });
    expect(changed.commodityMetrics?.inventoryLatest).toBe(430.0);
    expect(changed.commodityMetrics?.nominal10yChangePp).toBeCloseTo(0.32, 6);
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(base));
  });

  it("(27) the reporting period and acquisition instant come from the payloads only", () => {
    const a = OIL();
    expect(a.reportingPeriod).toBe("2025-07-03"); // latest of 2025-07-02 / 2025-07-01 / 2025-07-03
    expect(a.observedAt).toBe(TREASURY_FETCHED); // max acquisition receipt
    expect(a.evidence.every((e) => e.observedAt > 0)).toBe(true);
    expect(a.evidence.every((e) => typeof e.period === "string" && e.period.length > 0)).toBe(true);
    expect(a.evidence.every((e) => e.observedAtSemantics === "acquisition-receipt")).toBe(true);
  });

  it("(28) two different commodity identities never borrow each other's evidence", () => {
    const oil = OIL();
    const gold = GOLD();
    expect(oil.instrumentId).toBe("WTI");
    expect(gold.instrumentId).toBe("XAU/USD");
    expect(oil.provider).toBe("U.S. EIA + CFTC + US Treasury");
    expect(gold.provider).toBe("CFTC + US Treasury");
    expect(gold.evidence.every((e) => e.providerInstrumentId === "XAU/USD")).toBe(true);
    expect(oil.evidence.every((e) => e.providerInstrumentId === "WTI")).toBe(true);
    // The COT report is the instrument's OWN verified contract.
    expect(oil.evidence.find((e) => e.metric === "cot_net_non_commercial")!.source).toMatch(/CRUDE OIL/);
    expect(gold.evidence.find((e) => e.metric === "cot_net_non_commercial")!.source).toMatch(/GOLD - COMMODITY EXCHANGE/);
    expect(JSON.stringify(oil)).not.toBe(JSON.stringify(gold));
    // Every piece of evidence is attributable to a real provider.
    for (const a of [oil, gold]) {
      for (const item of a.evidence) {
        expect(item.provider.length).toBeGreaterThan(0);
        expect(item.source.length).toBeGreaterThan(0);
      }
    }
  });

  it("(29) the fixed dimension space never grows with evidence availability", () => {
    const rich = OIL().dimensions.map((d) => d.name).sort();
    const poor = assessCommodityFundamentals({ instrument: "COPPER" }).dimensions.map((d) => d.name).sort();
    expect(rich).toEqual(poor);
    expect(rich).toEqual([...COMMODITY_DIMENSIONS].sort());
  });
});
