/**
 * Phase 288 — the one configured physical feed is PETROLEUM.
 *
 * The U.S. EIA Weekly Petroleum Status Report (US crude / gasoline / distillate
 * stocks and their supply-and-disposition flows) is the physical market of an
 * ENERGY commodity only. The acquisition leg takes no instrument argument — the
 * same WPSR series come back for every commodity — and the adapter consumed
 * them for whatever group the profile resolved to. A precious-metal instrument
 * (or, as in the live four-asset run, the provider-native gold-gram pair
 * `GAU/EUR`, which the canonical registry cannot classify) therefore gained a
 * "physical" reading built from another market's inventory, attributed to its
 * own native id.
 *
 * The file's own hierarchy documentation already said the opposite ("no
 * physical/inventory feed exists for bullion"); these tests make the code agree
 * with it: only `energy` consumes the feed, and every other group reports its
 * physical dimensions UNAVAILABLE with the real reason.
 */
import { describe, it, expect } from "vitest";
import { assessCommodityFundamentals } from "./fundamental/commodity";
import type { EiaContext, EiaSeriesPoint, EiaData } from "./data/eia";
import type { CotData } from "./data/cot";
import type { TreasuryData } from "./data/treasury";

const FETCHED = Date.parse("2026-09-23T18:00:00Z");

function stocks(over?: Partial<EiaSeriesPoint>): EiaSeriesPoint {
  return {
    productId: "EPC0",
    productName: "Crude Oil",
    observationDate: "2026-09-18",
    latestValue: 412_500,
    unit: "thousand barrels",
    previousObservationDate: "2026-09-11",
    previousValue: 415_100,
    change: -2_600,
    changePercent: -0.63,
    recentWeeks: [
      { period: "2026-09-04", value: 417_200 },
      { period: "2026-08-28", value: 419_000 },
    ],
    ...over,
  };
}

/** An EIA context that genuinely answered with US petroleum stocks. */
const WPSR: EiaData = {
  available: true,
  source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
  fetchedAt: FETCHED,
  freshness: "FRESH",
  series: [stocks(), stocks({ productId: "EPD0", productName: "Distillate Fuel Oil" })],
  failedLegs: [],
} as unknown as EiaContext as unknown as EiaData;

const treasury = {
  available: true,
  source: "US Treasury (home.treasury.gov XML feed)",
  fetchedAt: FETCHED,
  freshness: "FRESH",
  latest: {
    nominal: { observationDate: "2026-09-22", nominal: { "2Y": 4.12, "10Y": 4.31 } },
    real: { observationDate: "2026-09-22", real: { "10Y": 2.05 } },
  },
  previous: {
    nominal: { observationDate: "2026-09-21", nominal: { "2Y": 4.1, "10Y": 4.28 } },
    real: { observationDate: "2026-09-21", real: { "10Y": 1.98 } },
  },
} as unknown as TreasuryData;

const dim = (a: ReturnType<typeof assessCommodityFundamentals>, name: string) =>
  a.dimensions.find((d) => d.name === name)!;

describe("phase 288 — the WPSR feed backs energy only", () => {
  it("energy (WTI) still consumes the real petroleum stocks", () => {
    const a = assessCommodityFundamentals({
      instrument: "WTI",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
      eia: WPSR,
      treasury,
    });
    expect(a.commodityProfile?.group).toBe("energy");
    expect(dim(a, "inventories").status).not.toBe("unavailable");
    expect(a.evidence.some((e) => e.metric.startsWith("inventory_"))).toBe(true);
    // Domain metrics stay in their own bag — never mixed into `metrics`.
    expect(a.metrics).toEqual({});
    expect(a.commodityMetrics?.inventoryLatest).toBe(412_500);
  });

  it("precious metals never read another market's inventory", () => {
    const a = assessCommodityFundamentals({
      instrument: "XAU/USD",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      eia: WPSR,
      treasury,
    });
    expect(a.commodityProfile?.group).toBe("precious-metals");
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(a.evidence.some((e) => e.metric.startsWith("inventory_"))).toBe(false);
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(dim(a, "supply-demand").status).toBe("unavailable");
  });

  it("a provider-native gold-gram pair (unclassified) is treated the same way", () => {
    const a = assessCommodityFundamentals({
      instrument: "GAU/EUR",
      provider: "twelve-data",
      providerInstrumentId: "GAU/EUR",
      eia: WPSR,
      treasury,
    });
    // The registry cannot classify GAU/EUR, so the physical-first default
    // applies — and the default must still not launder petroleum into it.
    expect(a.commodityProfile?.group).toBe("unclassified");
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(a.evidence.some((e) => e.provider === "U.S. Energy Information Administration")).toBe(
      false,
    );
    expect(dim(a, "supply-demand").status).toBe("unavailable");
  });

  it("names the real reason: an acquired feed that is out of scope", () => {
    const a = assessCommodityFundamentals({
      instrument: "XAU/USD",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      eia: WPSR,
      treasury,
    });
    const text = a.limitations.join(" ");
    expect(text).toContain("Weekly Petroleum Status Report");
    expect(text).toContain("out of scope");
    expect(text).not.toContain("no configured inventory provider returned");
  });

  it("keeps the ordinary 'no feed answered' wording when EIA is genuinely absent", () => {
    const a = assessCommodityFundamentals({
      instrument: "XAU/USD",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      eia: {
        available: false,
        reason: "EIA_API_KEY is not configured",
        source: "EIA as never-fetched",
      } as unknown as EiaData,
      treasury,
    });
    const text = a.limitations.join(" ");
    expect(text).toContain("no configured inventory provider returned a stock series");
    expect(text).toContain("EIA_API_KEY is not configured");
  });

  it("never attributes petroleum data to the assessed instrument's identity", () => {
    const a = assessCommodityFundamentals({
      instrument: "XAU/USD",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      eia: WPSR,
      treasury,
      cot: { available: false } as unknown as CotData,
    });
    const petroleum = a.evidence.filter((e) =>
      (e.provider ?? "").includes("Energy Information Administration"),
    );
    expect(petroleum).toHaveLength(0);
  });

  it("a provider-native petroleum pair still reads its OWN physical market", () => {
    // Regression, caught by the phase-282 four-asset suite: `WTI/USD` is the
    // provider-native spelling of WTI Crude Oil, but the PAIR string is not a
    // canonical registry entry, so an earlier version of this gate resolved it
    // as "unclassified" and withheld petroleum's own inventory feed — a false
    // negative. The base leg IS the traded commodity and must classify.
    const a = assessCommodityFundamentals({
      instrument: "WTI/USD",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
      eia: WPSR,
      treasury,
    });
    // Phase 289 correction: this assertion used to read `unclassified` and was
    // WRONG — it pinned the leak the live smoke later exposed (run 36208494796:
    // `classified #7 WTI/USD · group=unclassified` while the same assessment
    // consumed petroleum stocks). The base leg had been resolved for the FEED
    // only; the returned profile kept the pair-level verdict.
    // `effectiveCommodityProfile` now supplies ONE profile to the feed, the
    // aggregation hierarchy, the macro branch and the contract. The gate
    // assertions around it are unchanged.
    expect(a.commodityProfile?.group).toBe("energy");
    expect(dim(a, "inventories").status).not.toBe("unavailable");
    expect(a.commodityMetrics?.inventoryLatest).toBe(412_500);
    expect(a.limitations.join(" ")).not.toContain("out of scope");
  });

  it("resolving the base leg is not a blanket allowance for every pair", () => {
    // COPPER/USD has the same shape as WTI/USD, but its base leg is an
    // industrial metal: the base-leg resolution must not become a way for any
    // slash-delimited pair to reach the petroleum feed.
    const a = assessCommodityFundamentals({
      instrument: "COPPER/USD",
      provider: "twelve-data",
      providerInstrumentId: "COPPER/USD",
      eia: WPSR,
      treasury,
    });
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(a.limitations.join(" ")).toContain("out of scope for this industrial-metals instrument");
  });
});
