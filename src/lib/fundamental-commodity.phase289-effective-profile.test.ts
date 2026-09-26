/**
 * Phase 289 — ONE effective commodity profile.
 *
 * DEFECT (live, smoke run 36208494796): the paced commodity probe classified
 * 12/12 provider-native identities and reached #7 `WTI/USD`, but the runtime
 * reported `classified #7 WTI/USD · group=unclassified` and the energy gate
 * stayed UNAVAILABLE. The cause was not discovery, quota or the gate: Phase 288
 * resolved the pair's BASE leg for the physical-feed applicability ONLY, while
 * the rest of `assessCommodityFundamentals` kept reading the ORIGINAL pair-level
 * profile — the evidence hierarchy handed to the aggregation, the macro-driver
 * branch, and the `commodityProfile` in the returned contract. The resolved
 * classification therefore leaked away between the gate and the contract, and a
 * petroleum instrument could be analysed with petroleum stocks while reporting
 * itself unclassified.
 *
 * FIX: `effectiveCommodityProfile()` — the ONE profile the assessment uses for
 * physical-feed applicability, evidence hierarchy, aggregation hierarchy, macro
 * driver selection and all three returned `commodityProfile` fields. A directly
 * classified identity is returned unchanged; a pair that does not classify as a
 * whole resolves its base leg through the SAME canonical registry + alias path
 * used by `commodityProfileOf`; an unclassified base leg stays unclassified.
 * No ticker list, no pattern match, no provider alias, no substitution — the
 * provider-native identity stays the exact original pair everywhere.
 *
 * The eleven tests below are the required regression items, in order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assessCommodityFundamentals,
  commodityProfileOf,
  effectiveCommodityProfile,
} from "./fundamental/commodity";
import type { EiaData, EiaSeriesPoint } from "./data/eia";
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
} as unknown as EiaData;

/** Treasury curve where the REAL 10Y falls while the NOMINAL 10Y rises. */
const TREASURY: TreasuryData = {
  available: true,
  source: "US Treasury (home.treasury.gov XML feed)",
  fetchedAt: FETCHED,
  freshness: "FRESH",
  latest: {
    nominal: { observationDate: "2026-09-22", nominal: { "2Y": 4.12, "10Y": 4.31 } },
    real: { observationDate: "2026-09-22", real: { "10Y": 1.98 } },
  },
  previous: {
    nominal: { observationDate: "2026-09-21", nominal: { "2Y": 4.1, "10Y": 4.28 } },
    real: { observationDate: "2026-09-21", real: { "10Y": 2.05 } },
  },
} as unknown as TreasuryData;

const ctx = (instrument: string, extra: Record<string, unknown> = {}) =>
  ({
    instrument,
    provider: "twelve-data",
    providerInstrumentId: instrument,
    eia: WPSR,
    treasury: TREASURY,
    ...extra,
  }) as Parameters<typeof assessCommodityFundamentals>[0];

const dim = (a: ReturnType<typeof assessCommodityFundamentals>, name: string) =>
  a.dimensions.find((d) => d.name === name)!;

const ENERGY_HIERARCHY = commodityProfileOf("WTI").hierarchy;

describe("phase 289 — effective commodity profile for provider-native pairs", () => {
  it("1. a provider-native petroleum PAIR classifies as ENERGY", () => {
    // The exact identity from smoke run 36208494796.
    expect(commodityProfileOf("WTI/USD").group).toBe("unclassified"); // the raw pair string
    const effective = effectiveCommodityProfile("WTI/USD");
    expect(effective.group).toBe("energy");
    expect(assessCommodityFundamentals(ctx("WTI/USD")).commodityProfile?.group).toBe("energy");
    // The same base-leg market for the other provider-native petroleum spelling.
    expect(effectiveCommodityProfile("BRENT/USD").group).toBe("energy");
  });

  it("2. the classificationSource proves the canonical base-leg resolution", () => {
    const profile = effectiveCommodityProfile("WTI/USD");
    // The verdict must be auditable: which identity was resolved, from what.
    expect(profile.classificationSource).toContain('pair "WTI/USD"');
    expect(profile.classificationSource).toContain('base leg "WTI"');
    expect(profile.classificationSource).toContain("same canonical registry + alias path");
    expect(profile.classificationSource).toContain(commodityProfileOf("WTI").classificationSource);
    expect(profile.classificationSource).toContain('canonical registry entry "WTI"');
    // It is NOT the unresolved-registry verdict that the deployed runtime showed.
    expect(profile.classificationSource).not.toContain("is not in the canonical instrument registry");
    // And the assessment returns that same auditable string.
    expect(assessCommodityFundamentals(ctx("WTI/USD")).commodityProfile?.classificationSource).toBe(
      profile.classificationSource,
    );
  });

  it("3. the pair uses the ENERGY evidence hierarchy, not the resolved-away default", () => {
    const profile = effectiveCommodityProfile("WTI/USD");
    expect(profile.hierarchy).toEqual(ENERGY_HIERARCHY);
    // The SAME table instance the energy profile owns — not a look-alike array.
    // (Energy's and unclassified's ROLE tables happen to coincide, which is why
    // this leak could survive aggregation silently: the observable damage lay in
    // the returned group/source, the feed gate and the group-dependent macro
    // path. The identity assertion is what proves the resolution actually
    // selected the energy table.)
    expect(profile.hierarchy).toBe(ENERGY_HIERARCHY);
    expect(commodityProfileOf("WTI/USD").hierarchy).not.toBe(ENERGY_HIERARCHY);
    // Physical-first: inventories is a PRIMARY dimension for energy.
    expect(profile.hierarchy.find((h) => h.name === "inventories")?.role).toBe("primary");
    // The hierarchy is genuinely group-dependent: the industrial base leg
    // resolves to a DIFFERENT role table.
    expect(effectiveCommodityProfile("COPPER/USD").hierarchy).not.toEqual(ENERGY_HIERARCHY);
    const a = assessCommodityFundamentals(ctx("WTI/USD"));
    expect(a.commodityProfile?.hierarchy).toEqual(ENERGY_HIERARCHY);
    // Structural proof that the AGGREGATION reads that very profile: both
    // call sites take `profile.hierarchy`, and `profile` is the effective
    // profile — there is no second, pair-level profile left in the function.
    const source = readFileSync(
      fileURLToPath(new URL("./fundamental/commodity.ts", import.meta.url)),
      "utf8",
    );
    // Both aggregation inputs (aggregateConfidence + aggregateStateWithHierarchy)
    // and the returned contracts read the ONE `profile.hierarchy`.
    expect(source.match(/hierarchy: profile\.hierarchy/g)?.length).toBe(3);
    expect(source.match(/aggregateStateWithHierarchy\(dimensions, profile\.hierarchy\)/g)?.length).toBe(1);
    expect(source.match(/const profile = effectiveCommodityProfile\(subject\);/g)?.length).toBe(1);
    expect(source).not.toContain("baseLegMarketGroup");
    // The macro branch is the ENERGY branch — nominal discount-rate channel.
    expect(dim(a, "macro-drivers").evidence).toContain(
      "energy commodities are read through the nominal discount-rate channel",
    );
    expect(dim(a, "macro-drivers").evidence).not.toContain("REAL-yield channel");
  });

  it("4. petroleum feed applicability is TRUE and the EIA evidence keeps the native pair id", () => {
    const a = assessCommodityFundamentals(ctx("WTI/USD"));
    expect(dim(a, "inventories").status).not.toBe("unavailable");
    expect(a.commodityMetrics?.inventoryLatest).toBe(412_500);
    const inventoryEvidence = a.evidence.filter((e) => e.metric.startsWith("inventory_"));
    expect(inventoryEvidence.length).toBeGreaterThan(0);
    expect(inventoryEvidence.some((e) => e.provider === "U.S. Energy Information Administration")).toBe(
      true,
    );
    // No substitution: every piece of evidence is attributed to the EXACT
    // provider-native pair that was asked about — never to the base leg.
    for (const item of a.evidence) {
      expect(item.providerInstrumentId).toBe("WTI/USD");
    }
    expect(a.limitations.join(" ")).not.toContain("out of scope");
  });

  it("5. GAU/EUR stays unclassified — its canonical base leg is genuinely unclassified", () => {
    // The proof that this is a registry answer and not a special case: the base
    // leg itself does not classify, so the pair cannot either.
    expect(commodityProfileOf("GAU").group).toBe("unclassified");
    const profile = effectiveCommodityProfile("GAU/EUR");
    expect(profile.group).toBe("unclassified");
    expect(profile.hierarchy).toEqual(commodityProfileOf("GAU/EUR").hierarchy);
    expect(profile.classificationSource).toContain('base leg "GAU"');
    expect(profile.classificationSource).toContain("not classified by the same canonical registry");
    const a = assessCommodityFundamentals(ctx("GAU/EUR"));
    expect(a.commodityProfile?.group).toBe("unclassified");
    expect(dim(a, "inventories").status).toBe("unavailable");
    expect(a.evidence.some((e) => e.provider === "U.S. Energy Information Administration")).toBe(false);
    expect(dim(a, "supply-demand").status).toBe("unavailable");
    expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
  });

  it("6. XAU/USD resolves through the registry ITSELF — precious metals, profile unchanged", () => {
    const direct = commodityProfileOf("XAU/USD");
    expect(direct.group).toBe("precious-metals");
    const profile = effectiveCommodityProfile("XAU/USD");
    // A directly classified identity must come back EXACTLY as classified —
    // no re-derivation, no reworded source.
    expect(profile).toEqual(direct);
    expect(profile.classificationSource).toContain('canonical registry entry "XAU/USD"');
    expect(profile.classificationSource).not.toContain("base leg");
  });

  it("7. XAU/USD keeps the precious-metals hierarchy AND the REAL-yield macro path", () => {
    const a = assessCommodityFundamentals(ctx("XAU/USD"));
    expect(a.commodityProfile?.hierarchy).toEqual(commodityProfileOf("XAU/USD").hierarchy);
    expect(a.commodityProfile?.hierarchy.find((h) => h.name === "futures-positioning")?.role).toBe(
      "primary",
    );
    const macro = dim(a, "macro-drivers");
    // The fixture moves the REAL yield DOWN (-0.07pp) while the NOMINAL yield
    // moves UP (+0.03pp, at the materiality band): only the real-yield branch
    // can produce "positive" and say so.
    expect(macro.evidence).toContain("REAL-yield channel (the metal's own driver)");
    expect(macro.evidence).toContain("real 10Y change -0.07pp");
    expect(macro.status).toBe("positive");
    expect(macro.evidence).not.toContain("commodities are read through the nominal discount-rate channel");
    // The real-yield feed is the precious-metal driver; the raw real 10Y is
    // still an evidence item, attributed to the same native id.
    expect(a.evidence.some((e) => e.metric === "usd_10y_real" && e.period === "2026-09-22")).toBe(true);
  });

  it("8. an unknown pair stays unclassified — no look-alike matching, no substitution", () => {
    expect(effectiveCommodityProfile("ZZZ/USD").group).toBe("unclassified");
    expect(effectiveCommodityProfile("SOMETHING-NEW/EUR").group).toBe("unclassified");
    // Unknown base leg: the pair-level verdict stands, with the attempt named.
    expect(effectiveCommodityProfile("ZZZ/USD").classificationSource).toContain('base leg "ZZZ"');
    // A non-pair identity is never split at all: the profile is untouched.
    expect(effectiveCommodityProfile("SOMETHING-NEW")).toEqual(commodityProfileOf("SOMETHING-NEW"));
    // The registry's OWN alias path is what resolves aliases — not this function.
    expect(effectiveCommodityProfile("GOLD/USD").group).toBe("precious-metals");
    const a = assessCommodityFundamentals(ctx("ZZZ/USD"));
    expect(a.commodityProfile?.group).toBe("unclassified");
    expect(dim(a, "inventories").status).toBe("unavailable");
  });

  it("9. the resolution path introduces NO ticker list and NO pattern match", () => {
    const source = readFileSync(fileURLToPath(new URL("./fundamental/commodity.ts", import.meta.url)), "utf8");
    // Strip comments so the doc prose is not mistaken for code, then extract the
    // two functions that perform the pair resolution.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const start = code.indexOf("function baseLegOf");
    const end = code.indexOf("export function commodityProfileOf");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);

    // The split is on the provider's own delimiter — a string, not a pattern.
    expect(body).toContain('split("/")');
    expect(body).toContain("commodityProfileOf(base)");
    expect(body).not.toContain("new RegExp");
    // Removing the one legitimate delimiter literal leaves NO other slash: there
    // is no regex literal anywhere in the resolution path.
    expect(body.replace(/split\("\/"\)/g, "split(DELIMITER)")).not.toContain("/");
    // No ticker list and no provider alias of its own.
    for (const forbidden of [
      "WTI",
      "BRENT",
      "URALS",
      "XAU",
      "XAG",
      "GAU",
      "XPD",
      "XPT",
      "GOLD",
      "SILVER",
      "COPPER",
      "twelve",
      "ALIAS_MAP",
    ]) {
      expect(body).not.toContain(forbidden);
    }
    // Behavioural counter-proof: identical SHAPE, different registry truth —
    // a whitelist or a pattern could not tell these apart, the registry can.
    expect(effectiveCommodityProfile("WTI/USD").group).not.toBe(
      effectiveCommodityProfile("ZZZ/USD").group,
    );
    expect(effectiveCommodityProfile("COPPER/USD").group).toBe("industrial-metals");
  });

  it("10. the phase-288 WPSR gate invariants are preserved (see the dedicated phase-288 suite)", () => {
    // The phase-288 suite runs in the same validation pass; these are its gate
    // invariants re-asserted against the effective profile, so a regression is
    // caught even in isolation.
    const energy = assessCommodityFundamentals(ctx("WTI"));
    expect(energy.commodityProfile?.group).toBe("energy");
    expect(dim(energy, "inventories").status).not.toBe("unavailable");

    for (const instrument of ["XAU/USD", "GAU/EUR", "COPPER/USD"]) {
      const a = assessCommodityFundamentals(ctx(instrument));
      expect(a.commodityProfile?.group).not.toBe("energy");
      expect(dim(a, "inventories").status).toBe("unavailable");
      expect(a.evidence.some((e) => e.metric.startsWith("inventory_"))).toBe(false);
      expect(a.commodityMetrics?.inventoryLatest).toBeUndefined();
      expect(dim(a, "supply-demand").status).toBe("unavailable");
    }
    // COPPER/USD has the same PAIR SHAPE as WTI/USD: base-leg resolution must
    // never become a blanket allowance for slash-delimited identities.
    const copper = assessCommodityFundamentals(ctx("COPPER/USD"));
    expect(copper.commodityProfile?.group).toBe("industrial-metals");
    expect(copper.limitations.join(" ")).toContain("out of scope for this industrial-metals instrument");
  });

  it("11. the SAME effective profile is what the assessment RETURNS (end to end)", () => {
    const effective = effectiveCommodityProfile("WTI/USD");
    const a = assessCommodityFundamentals(ctx("WTI/USD"));
    // The returned contract is not a second opinion: all three fields are the
    // effective profile, so the runtime can no longer report `unclassified`
    // while consuming petroleum evidence.
    expect(a.commodityProfile).toEqual({
      group: effective.group,
      classificationSource: effective.classificationSource,
      hierarchy: effective.hierarchy,
    });
    expect(a.commodityProfile?.group).toBe("energy");
    expect(a.commodityProfile?.hierarchy).toEqual(ENERGY_HIERARCHY);

    // The no-evidence early return is the OTHER place a profile is returned —
    // it must carry the same effective classification.
    const bare = assessCommodityFundamentals({
      instrument: "WTI/USD",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
    });
    expect(bare.commodityProfile?.group).toBe("energy");
    expect(bare.commodityProfile?.classificationSource).toBe(effective.classificationSource);
    expect(bare.commodityProfile?.hierarchy).toEqual(ENERGY_HIERARCHY);
    // Provider-native identity is untouched by the classification.
    expect(bare.instrumentId).toBe("WTI/USD");
    expect(a.instrumentId).toBe("WTI/USD");
  });
});
