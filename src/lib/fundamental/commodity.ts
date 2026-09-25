/**
 * Phase 279 — Commodity fundamental adapter (same framework, commodity-native).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Stock fundamentals are NOT universal fundamentals. A barrel of crude oil has
 * no revenue, no EPS and no P/E, and a gold contract has no reporting period.
 * The commodity domain therefore has its OWN dimension space inside the ONE
 * shared framework — `supply-demand`, `inventories`, `term-structure`,
 * `futures-positioning`, `macro-drivers` — and never borrows equity, crypto or
 * forex metrics.
 *
 * WHAT THE REPOSITORY ACTUALLY SUPPLIES FOR COMMODITIES (verified inventory of
 * the configured providers — everything else is reported UNAVAILABLE):
 *
 *   1. U.S. EIA Weekly Petroleum Status Report stock series (`lib/data/eia.ts`,
 *      EIA Open Data v2 `/petroleum/sto/data/`) — real weekly petroleum
 *      inventory levels and week-over-week changes with the provider's own
 *      observation dates and units. Petroleum products only.
 *   2. CFTC Commitments of Traders (`lib/data/cot.ts`) — weekly regulated
 *      futures positioning, only for contracts with a VERIFIED mapping
 *      (gold, silver, WTI/BRENT crude). An unmapped instrument yields the
 *      provider module's explicit unavailable state, never a forced mapping.
 *   3. U.S. Treasury nominal + real yield curves (`lib/data/treasury.ts`) —
 *      the discount-rate / macro driver channel.
 *
 * NO PROVIDER, NO METRIC. Production, consumption, imports/exports,
 * supply-demand balance, capacity, regional/warehouse stocks, days-of-supply,
 * inventory surprise (no consensus series exists), futures curve
 * (contango/backwardation, calendar spreads, basis, roll yield), a real USD
 * index, central-bank flows, OPEC/refinery-utilisation and crop/weather/harvest
 * evidence do NOT exist in the configured feeds. Each is reported as an
 * unavailable dimension with the reason, and none is ever estimated from price,
 * inventory or positioning.
 *
 * NO DOUBLE COUNTING (binding)
 * ---------------------------
 * The EIA inventory change, the COT report-to-report change and the Treasury
 * curve are ALREADY scored by the conviction engine's own layers (EIA
 * Inventory, COT Positioning, Macro Yield). They are reported here as
 * traceable context — `informational` + `consumedBy` — and are never re-scored,
 * so one provider field can never become two votes. That is also why this
 * adapter's own state is honestly `insufficient`: it has no independently
 * scoreable evidence in the current provider set, and it refuses to manufacture
 * one by re-scoring what the engine already counted.
 *
 * PURE: no clock. Every instant is carried by the provider payloads
 * (`fetchedAt` acquisition receipts, observation/report dates), so identical
 * evidence yields a byte-identical assessment.
 */

import type { CotContext, CotData } from "@/lib/data/cot";
import { COT_SIGNAL_CHANGE_OI_RATIO } from "@/lib/data/cot";
import type { EiaContext, EiaData } from "@/lib/data/eia";
import { EIA_SIGNAL_MIN_MBBL, EIA_SIGNAL_THRESHOLD_PCT } from "@/lib/data/eia";
import type { TreasuryContext, TreasuryData } from "@/lib/data/treasury";
import type {
  CommodityFundamentalMetrics,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalEvidenceItem,
} from "@/lib/data/fundamental-contract";
import {
  aggregateConfidence,
  coverageOf,
  dimension,
  isFiniteNumber,
  unavailable,
} from "./framework";

/** The evidence the live pipeline may hand this adapter (verbatim contexts). */
export interface CommodityFundamentalContext {
  instrument: string;
  provider?: string;
  providerInstrumentId?: string;
  /** U.S. EIA Weekly Petroleum Status Report stocks (petroleum products). */
  eia?: EiaData;
  /** CFTC Commitments of Traders futures positioning (verified mappings only). */
  cot?: CotData;
  /** US Treasury nominal + real curves (macro / discount-rate driver). */
  treasury?: TreasuryData;
}

/** Exported for the UI/tests: the dimensions this domain defines. */
export const COMMODITY_DIMENSIONS: FundamentalDimension["name"][] = [
  "supply-demand",
  "inventories",
  "term-structure",
  "futures-positioning",
  "macro-drivers",
];

const EIA_CONSUMER = "the conviction engine's EIA Inventory layer";
const COT_CONSUMER = "the conviction engine's COT Positioning layer";
const YIELD_CONSUMER = "the conviction engine's Macro Yield layer";

const fmtInt = (v: number): string => Math.round(v).toLocaleString("en-US");
const fmtSigned = (v: number, digits = 2): string =>
  `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
/** Contract counts are grouped and sign-prefixed so a change is readable. */
const fmtSignedInt = (v: number): string =>
  `${v >= 0 ? "+" : "-"}${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

export function assessCommodityFundamentals(
  ctx: CommodityFundamentalContext,
): FundamentalAssessment {
  const nativeId = ctx.providerInstrumentId ?? ctx.instrument;
  const eia: EiaContext | undefined = ctx.eia && ctx.eia.available ? ctx.eia : undefined;
  const cot: CotContext | undefined = ctx.cot && ctx.cot.available ? ctx.cot : undefined;
  const treasury: TreasuryContext | undefined =
    ctx.treasury && ctx.treasury.available ? ctx.treasury : undefined;

  const dimensions: FundamentalDimension[] = [];
  const evidence: FundamentalEvidenceItem[] = [];
  const limitations: string[] = [];
  const metrics: CommodityFundamentalMetrics = {};
  const providers: string[] = [];

  // ═══════════════════════════════════════════════════════════════
  // A. Supply / demand — no configured provider supplies a balance
  // ═══════════════════════════════════════════════════════════════
  dimensions.push(unavailable("supply-demand"));
  limitations.push(
    "Supply/demand UNAVAILABLE — no configured provider returned production, consumption, imports/exports, surplus/deficit or production-capacity evidence for this instrument; a balance is never estimated from price, inventory or positioning.",
  );

  // ═══════════════════════════════════════════════════════════════
  // B. Inventories — U.S. EIA Weekly Petroleum Status Report
  // ═══════════════════════════════════════════════════════════════
  {
    const headline = eia?.series[0];
    if (eia && headline) {
      providers.push("U.S. EIA");
      const legText = eia.series.map((s) => {
        const unit = s.unit ? ` ${s.unit}` : "";
        const change = isFiniteNumber(s.change)
          ? `, week-over-week ${fmtSigned(s.change, 2)}${unit}${
              isFiniteNumber(s.changePercent) ? ` (${fmtSigned(s.changePercent, 2)}%)` : ""
            }`
          : ", single observation — no week-over-week change";
        return `${s.productName ?? s.productId} (${s.productId}) ${s.latestValue}${unit}${change}`;
      });
      // Materiality uses the EIA module's OWN documented thresholds — this
      // adapter invents no market truth and the dimension is not scored.
      const material =
        isFiniteNumber(headline.change) &&
        isFiniteNumber(headline.previousValue) &&
        headline.previousValue > 0 &&
        Math.abs(headline.change) >= EIA_SIGNAL_MIN_MBBL &&
        (Math.abs(headline.change) / headline.previousValue) * 100 >= EIA_SIGNAL_THRESHOLD_PCT;

      dimensions.push(
        dimension(
          "inventories",
          "neutral",
          `U.S. EIA Weekly Petroleum Status Report (observation ${headline.observationDate}${
            headline.previousObservationDate ? ` vs ${headline.previousObservationDate}` : ""
          }, freshness ${eia.freshness}, release acquired ${new Date(eia.fetchedAt).toISOString()}): ${legText.join(
            "; ",
          )}. The headline week-over-week move ${
            material
              ? `exceeds the EIA module's documented materiality thresholds (>=${EIA_SIGNAL_MIN_MBBL}M bbl and >=${EIA_SIGNAL_THRESHOLD_PCT}% of stocks)`
              : isFiniteNumber(headline.change)
                ? "is inside the EIA module's documented noise band"
                : "cannot be assessed (the headline series carries a single observation — no week-over-week change exists, and none is imputed)"
          }. Reported as traceable PHYSICAL context only — ${EIA_CONSUMER} already scores this release, so it is neither scored nor counted here.`,
          { informational: true, consumedBy: EIA_CONSUMER },
        ),
      );
      evidence.push({
        metric: "inventory_wpsr",
        label: "EIA weekly petroleum stocks (headline series)",
        value: headline.latestValue,
        unit: headline.unit,
        provider: "U.S. Energy Information Administration",
        providerInstrumentId: nativeId,
        source: `Weekly Petroleum Status Report stocks (EIA Open Data v2 /petroleum/sto/data; series ${headline.productId})`,
        observedAt: eia.fetchedAt,
        observedAtSemantics: "acquisition-receipt",
        period: headline.observationDate,
        freshness: eia.freshness,
        consumedElsewhere: EIA_CONSUMER,
      });
      metrics.inventoryLatest = headline.latestValue;
      if (isFiniteNumber(headline.change)) metrics.inventoryChangeWoW = headline.change;
      if (isFiniteNumber(headline.changePercent)) {
        metrics.inventoryChangePercentWoW = headline.changePercent;
      }
      metrics.inventoryLegsAvailable = eia.series.length;

      if (eia.failedLegs.length > 0) {
        limitations.push(
          `EIA product legs that failed independently (reported, never substituted or estimated): ${eia.failedLegs
            .map((f) => `${f.productId} — ${f.reason}`)
            .join("; ")}.`,
        );
      }
      limitations.push(
        "Regional/warehouse-level stocks, inventory surprise against a consensus and days-of-supply are NOT supplied by the configured inventory feed (U.S. aggregate petroleum stocks only), so none of them is derived.",
      );
    } else {
      dimensions.push(unavailable("inventories"));
      const reason = ctx.eia && !ctx.eia.available ? ctx.eia.reason : undefined;
      limitations.push(
        `Inventory UNAVAILABLE — no configured inventory provider returned a stock series for this instrument${
          reason ? ` (${reason})` : ""
        }. The only configured inventory source is the U.S. EIA weekly petroleum report; inventory is never approximated from price or volume.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // C. Futures / term structure — no configured provider supplies it
  // ═══════════════════════════════════════════════════════════════
  dimensions.push(unavailable("term-structure"));
  limitations.push(
    "Futures term structure (contango/backwardation, front/back-month relationship, curve slope, calendar spreads, basis and roll yield) UNAVAILABLE — no configured provider supplies a futures curve or basis series, so none is derived from spot candles or from the front month alone.",
  );

  // ═══════════════════════════════════════════════════════════════
  // D. Futures positioning — CFTC Commitments of Traders
  // ═══════════════════════════════════════════════════════════════
  {
    if (cot) {
      providers.push("CFTC");
      const latest = cot.latest;
      const previous = cot.previous;
      const oi = latest.openInterest;
      const crowdRatio = isFiniteNumber(oi) && oi > 0 ? Math.abs(cot.netNonCommercial) / oi : undefined;
      const changeText = isFiniteNumber(cot.changeFromPreviousReport)
        ? `change ${fmtSignedInt(cot.changeFromPreviousReport)} vs the previous report`
        : "no previous consecutive report, so no change is claimed";

      dimensions.push(
        dimension(
          "futures-positioning",
          "neutral",
          `CFTC Commitments of Traders — ${cot.mappedAsset} (${cot.sourceInstrument}), report ${latest.reportDate}${
            previous ? ` vs ${previous.reportDate}` : ""
          }, freshness ${cot.freshness}, rows acquired ${new Date(cot.fetchedAt).toISOString()}: non-commercial long ${fmtInt(
            latest.nonCommercialLong,
          )} / short ${fmtInt(latest.nonCommercialShort)} → net ${fmtInt(cot.netNonCommercial)}, ${changeText}${
            isFiniteNumber(oi) ? `, open interest ${fmtInt(oi)}` : ", open interest not supplied"
          }${
            crowdRatio !== undefined
              ? `, crowding ${(crowdRatio * 100).toFixed(1)}% of open interest (level context only — a level is never directional)`
              : ""
          }. Reported as traceable POSITIONING context only — ${COT_CONSUMER} already scores the report-to-report change, so it is neither scored nor counted here.`,
          { informational: true, consumedBy: COT_CONSUMER },
        ),
      );
      evidence.push({
        metric: "cot_net_non_commercial",
        label: "CFTC non-commercial net position",
        value: cot.netNonCommercial,
        unit: "contracts",
        provider: "CFTC",
        providerInstrumentId: nativeId,
        source: `${cot.source} — ${cot.sourceInstrument}`,
        observedAt: cot.fetchedAt,
        observedAtSemantics: "acquisition-receipt",
        period: latest.reportDate,
        freshness: cot.freshness,
        consumedElsewhere: COT_CONSUMER,
      });
      metrics.futuresPositioningNet = cot.netNonCommercial;
      if (isFiniteNumber(cot.changeFromPreviousReport)) {
        metrics.futuresPositioningChange = cot.changeFromPreviousReport;
      }
    } else {
      dimensions.push(unavailable("futures-positioning"));
      const reason = ctx.cot && !ctx.cot.available ? ctx.cot.reason : undefined;
      limitations.push(
        `Futures positioning UNAVAILABLE — no verified CFTC contract report covers this instrument${
          reason ? ` (${reason})` : ""
        }; a contract is never guessed and another instrument's report is never substituted.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // E. Macro drivers — the discount-rate channel (US Treasury curve)
  // ═══════════════════════════════════════════════════════════════
  {
    if (treasury) {
      providers.push("US Treasury");
      const nominal = treasury.latest.nominal;
      const real = treasury.latest.real;
      const tenY = nominal.nominal["10Y"];
      const twoY = nominal.nominal["2Y"];
      const realTenY = real?.real["10Y"];
      const prevTenY = treasury.previous?.nominal.nominal["10Y"];
      const change =
        isFiniteNumber(tenY) && isFiniteNumber(prevTenY) ? tenY - prevTenY : undefined;

      dimensions.push(
        dimension(
          "macro-drivers",
          "neutral",
          `US Treasury curve (${treasury.source}, observation ${nominal.observationDate}, freshness ${treasury.freshness}, acquired ${new Date(
            treasury.fetchedAt,
          ).toISOString()}): ${
            isFiniteNumber(tenY) ? `10Y nominal ${tenY.toFixed(2)}%` : "10Y nominal not supplied"
          }${isFiniteNumber(twoY) ? `, 2Y ${twoY.toFixed(2)}%` : ""}${
            isFiniteNumber(realTenY)
              ? `, real 10Y ${realTenY.toFixed(2)}% (Treasury's own real-yield feed)`
              : ", real 10Y not supplied"
          }; ${
            change !== undefined
              ? `10Y ${fmtSigned(change, 2)}pp vs the previous observation`
              : "no previous observation, so no yield change is claimed"
          }. Reported as macro/discount-rate context only — ${YIELD_CONSUMER} already scores this evidence, so it is neither scored nor counted here.`,
          { informational: true, consumedBy: YIELD_CONSUMER },
        ),
      );
      if (isFiniteNumber(tenY)) {
        evidence.push({
          metric: "usd_10y_nominal",
          label: "US Treasury 10Y nominal yield",
          value: tenY,
          unit: "%",
          provider: "US Treasury",
          providerInstrumentId: nativeId,
          source: "daily_treasury_yield_curve (home.treasury.gov XML feed)",
          observedAt: treasury.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: nominal.observationDate,
          freshness: treasury.freshness,
          consumedElsewhere: YIELD_CONSUMER,
        });
        metrics.nominal10yYieldPercent = tenY;
      }
      if (isFiniteNumber(realTenY)) {
        evidence.push({
          metric: "usd_10y_real",
          label: "US Treasury 10Y real yield",
          value: realTenY,
          unit: "%",
          provider: "US Treasury",
          providerInstrumentId: nativeId,
          source: "daily_treasury_real_yield_curve (home.treasury.gov XML feed)",
          observedAt: treasury.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: real?.observationDate ?? nominal.observationDate,
          freshness: treasury.freshness,
          consumedElsewhere: YIELD_CONSUMER,
        });
        metrics.real10yYieldPercent = realTenY;
      }
      if (change !== undefined) metrics.nominal10yChangePp = change;
    } else {
      dimensions.push(unavailable("macro-drivers"));
      const reason = ctx.treasury && !ctx.treasury.available ? ctx.treasury.reason : undefined;
      limitations.push(
        `Macro-driver evidence UNAVAILABLE — no Treasury observation was supplied for this analysis${
          reason ? ` (${reason})` : ""
        }.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Cross-provider tension + honesty disclosures
  // ═══════════════════════════════════════════════════════════════
  const contradictions: string[] = [];
  {
    const inv = metrics.inventoryChangeWoW;
    const posChange = metrics.futuresPositioningChange;
    const oi = cot?.latest.openInterest;
    const posMaterial =
      isFiniteNumber(posChange) &&
      posChange !== 0 &&
      (isFiniteNumber(oi) && oi > 0
        ? Math.abs(posChange) / oi >= COT_SIGNAL_CHANGE_OI_RATIO
        : true);
    const invMaterial =
      isFiniteNumber(inv) &&
      inv !== 0 &&
      isFiniteNumber(metrics.inventoryLatest) &&
      metrics.inventoryLatest > 0;
    if (invMaterial && posMaterial && Math.sign(inv) !== Math.sign(posChange)) {
      contradictions.push(
        `Cross-provider tension for ${nativeId}: the EIA release moved stocks ${inv >= 0 ? "up" : "down"} (${fmtSigned(
          inv,
          2,
        )}) while CFTC non-commercial net positioning ${posChange >= 0 ? "rose" : "fell"} (${fmtSignedInt(posChange)}) — the physical and positioning readings point in opposite directions. Both are reported as context; neither is averaged away.`,
      );
    }
  }

  limitations.push(
    "Commodity-specific drivers beyond the discount-rate channel (a real USD index, central-bank flows, OPEC/supply actions, refinery utilisation, industrial demand indicators and crop/weather/harvest evidence) UNAVAILABLE — no configured provider supplies them for this instrument. The platform's USD proxy is explicitly news-derived, not a DXY price series, and is never substituted here.",
  );
  limitations.push(
    "EIA inventory and CFTC positioning are weekly provider RELEASES and Treasury yields are daily observations: each carries its own observation/report date and is never presented as a live market price.",
  );
  limitations.push(
    "Company-style fundamentals (EPS, P/E, revenue growth, margins) do not apply to a commodity instrument — no EPS/P/E/revenue metric is computed or shown for one, and a commodity is never treated as having a corporate issuer.",
  );
  limitations.push(
    `The conviction engine's own layers (EIA Inventory, COT Positioning, Macro Yield) already score the evidence reported here; every such dimension is marked informational so the same provider field can never be counted twice, and this assessment feeds only the unified intelligence layer and the opportunity scanner.`,
  );

  // ═══════════════════════════════════════════════════════════════
  // No evidence at all → explicit unavailable (never a fabricated state)
  // ═══════════════════════════════════════════════════════════════
  if (!eia && !cot && !treasury) {
    return {
      available: false,
      domain: "commodity",
      provider: ctx.provider ?? "none",
      instrumentId: nativeId,
      observedAt: 0,
      periodsCount: 0,
      state: "insufficient",
      confidence: "insufficient",
      confidenceEvidence:
        "No usable commodity fundamental dimensions — no configured provider returned inventory, positioning or macro-driver evidence for this instrument.",
      directionalBias: "none",
      dimensions,
      contradictions: [],
      unavailableDimensions: dimensions
        .filter((d) => d.status === "unavailable")
        .map((d) => d.name),
      evidenceCoverage: coverageOf(dimensions, []),
      evidence: [],
      metrics: {},
      limitations: [
        `No commodity-native fundamental evidence was supplied for ${nativeId} — supply/demand, inventory, futures-curve, positioning and macro-driver evidence are all UNAVAILABLE, and none of them is invented.`,
        ...limitations,
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Aggregation (shared framework)
  // ═══════════════════════════════════════════════════════════════
  const { state, confidence, confidenceEvidence } = aggregateConfidence({
    dimensions,
    periodsCount: evidence.length,
    periodsLabel: "provider commodity measurements",
    extraCaps: [],
  });

  const scored = dimensions.filter((d) => !d.informational && d.status !== "unavailable");
  const positives = scored.filter((d) => d.status === "positive").length;
  const negatives = scored.filter((d) => d.status === "negative").length;

  // A direction is never forced: the commodity evidence the providers actually
  // supply is already scored by the conviction engine, so this layer reports it
  // and derives no separate direction of its own.
  const directionalBias = "none" as const;
  const directionalBiasEvidence =
    `No independent directional read for ${nativeId}: ${scored.length} independently scored commodity dimensions exist in the current provider set — ` +
    `the inventory, positioning and yield evidence reported here is already scored by the conviction engine's own layers, and re-scoring it here would count one provider field twice.`;

  // The latest MEASUREMENT period present in the evidence (never a clock read).
  const periods = [
    eia ? eia.series[0]?.observationDate : undefined,
    cot ? cot.latest.reportDate : undefined,
    treasury ? treasury.latest.nominal.observationDate : undefined,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const reportingPeriod = periods.length > 0 ? periods.reduce((a, b) => (a > b ? a : b)) : undefined;

  const observedAt = Math.max(eia?.fetchedAt ?? 0, cot?.fetchedAt ?? 0, treasury?.fetchedAt ?? 0);

  if (scored.length === 0) {
    limitations.push(
      "This domain has no independently scoreable dimension in the current provider set: the evidence above is real and traceable but already scored by the conviction engine's own layers, so the state reads insufficient BY DESIGN rather than because evidence is missing.",
    );
  }

  return {
    available: true,
    domain: "commodity",
    provider: providers.length > 0 ? [...new Set(providers)].join(" + ") : (ctx.provider ?? "none"),
    instrumentId: nativeId,
    observedAt,
    ...(reportingPeriod ? { reportingPeriod } : {}),
    periodsCount: evidence.length,
    state,
    confidence,
    confidenceEvidence,
    directionalBias,
    directionalBiasEvidence,
    dimensions,
    contradictions,
    unavailableDimensions: dimensions
      .filter((d) => d.status === "unavailable")
      .map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, providers),
    evidence,
    metrics: {},
    commodityMetrics: metrics,
    limitations,
  };
}
