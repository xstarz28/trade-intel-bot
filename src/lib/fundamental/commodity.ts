/**
 * Phase 279/280 — Commodity fundamental adapter (same framework, commodity-native).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Stock fundamentals are NOT universal fundamentals. A barrel of crude oil has
 * no revenue, no EPS and no P/E. The commodity domain therefore has its OWN
 * dimension space inside the ONE shared framework — `supply-demand`,
 * `inventories`, `term-structure`, `futures-positioning`, `macro-drivers` —
 * and never borrows equity, crypto or forex metrics.
 *
 * Phase 280 turns this domain from reported-context into a genuinely SCORABLE
 * assessment, using only evidence the configured providers really return:
 *
 *   · inventories (EIA WPSR stock series): levels, week-over-week changes,
 *     breadth across product legs, a multi-week TREND and a recent-BASELINE
 *     deviation — all from the provider's own dated observations.
 *   · supply-demand (EIA flow series): production / imports / exports /
 *     refinery inputs / refinery utilisation / product supplied, classified
 *     from the provider's OWN labels and units. The configured request fetches
 *     the stock series only, so this dimension reports its exact reason when no
 *     flow series arrives — it is never estimated from stocks or price.
 *   · term-structure (a real multi-expiry curve): contango / backwardation /
 *     flat, front-to-back slope and roll context. No configured provider
 *     supplies a futures curve today; when a caller hands one in, it is scored
 *     and its provider identity, contracts, instants and units are preserved.
 *   · futures-positioning (CFTC COT): non-commercial change scaled by open
 *     interest, commercial (hedger) net, crowding and the net/OI percentile
 *     inside the provider's own report history. Crowding and extremes are
 *     CONTEXT — an extreme is never turned into a bullish or bearish call.
 *   · macro-drivers (US Treasury curve): the discount-rate channel. Precious
 *     metals read the REAL yield (the metal's own driver); energy and metals
 *     read the nominal 10Y change, with the 2s10s slope as context.
 *
 * EVIDENCE HIERARCHY (Phase 280, binding)
 * ---------------------------------------
 * Evidence is not equal. The hierarchy is chosen by the instrument's COMMODITY
 * GROUP from the repository's canonical instrument registry (tags such as
 * `energy`, `precious_metal`, `industrial_metal`) — configuration, never a
 * symbol-specific branch — and it is applied by the shared framework:
 *
 *   primary    (weight 3) — the group's own physical/dominant evidence
 *   secondary  (weight 2) — positioning structure
 *   supporting (weight 1) — macro/discount-rate context
 *
 * A direction requires a PRIMARY dimension on the winning side, so supporting
 * context (macro) can never dictate the assessment, and a single dimension may
 * set the state only when nothing opposes it.
 *
 * NO PROVIDER, NO METRIC
 * ----------------------
 * Regional/warehouse stocks, inventory surprise versus a consensus,
 * days-of-supply, crop/weather/harvest, OPEC/central-bank flows, a real USD
 * index and industrial-demand proxies do not exist in the configured feeds.
 * Each is reported as an unavailable dimension or an explicit limitation.
 *
 * DOUBLE COUNTING
 * ---------------
 * The same releases are also consumed by the conviction engine's own layers
 * (EIA Inventory, COT Positioning, Macro Yield) for the DECISION path. Every
 * evidence item therefore carries `consumedElsewhere`, and this module never
 * imports a decision/conviction scoring function: the fundamental state is
 * consumed by the unified layer as an agreement class only, so the same
 * provider field never becomes a second weighted decision vote.
 *
 * PURE: no clock. Every instant is carried by the provider payloads
 * (`fetchedAt` acquisition receipts, observation/report dates), so identical
 * evidence yields a byte-identical assessment.
 */

import type { CotContext, CotData } from "@/lib/data/cot";
import {
  classifyCotPositioning,
  COT_CROWDING_OI_RATIO,
  COT_PERCENTILE_MIN_REPORTS,
  COT_SIGNAL_CHANGE_OI_RATIO,
} from "@/lib/data/cot";
import type { EiaContext, EiaData, EiaSeriesPoint } from "@/lib/data/eia";
import {
  baselinePosition,
  derivePhysicalRegime,
  inventoryTrend,
  EIA_SIGNAL_THRESHOLD_PCT,
  EIA_TREND_MIN_WEEKS,
} from "@/lib/data/eia";
import type { TreasuryContext, TreasuryData } from "@/lib/data/treasury";
import { resolveInstrumentWithAliases } from "@/lib/data/universal/instruments";
import type {
  CommodityFundamentalMetrics,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalEvidenceItem,
} from "@/lib/data/fundamental-contract";
import {
  aggregateConfidence,
  aggregateStateWithHierarchy,
  coverageOf,
  dimension,
  isFiniteNumber,
  unavailable,
  type DimensionHierarchyEntry,
} from "./framework";

/**
 * Phase 280 — a REAL multi-expiry curve, as a provider would supply it.
 * Nothing in the configured pipeline fabricates one; the domain context
 * accepts it so a curve provider can be wired without touching this logic.
 */
export interface CommodityFuturesCurvePoint {
  /** Provider/native contract id, verbatim (e.g. "CLZ25", "GCJ26"). */
  contract: string;
  /** Delivery/expiry label as the provider states it, verbatim. */
  expiry?: string;
  /** Provider price for that contract (units stated on the curve). */
  price: number;
  /** Provider open interest for that contract, when supplied. */
  openInterest?: number;
}

export interface CommodityFuturesCurve {
  provider: string;
  /** Exact dataset/endpoint the curve came from. */
  source: string;
  /** Provider observation instant of the curve (ms). Never a clock read. */
  observedAt: number;
  freshness?: string;
  /** Price unit as the provider states it (e.g. "USD per barrel"). */
  unit?: string;
  /** Contracts front-first, as the provider lists the curve (≥ 2 to score). */
  contracts: CommodityFuturesCurvePoint[];
}

/** The evidence the live pipeline may hand this adapter (verbatim contexts). */
export interface CommodityFundamentalContext {
  instrument: string;
  provider?: string;
  providerInstrumentId?: string;
  /** U.S. EIA Weekly Petroleum Status Report stocks (+ any flow series). */
  eia?: EiaData;
  /** CFTC Commitments of Traders futures positioning (verified mappings only). */
  cot?: CotData;
  /** US Treasury nominal + real curves (macro / discount-rate driver). */
  treasury?: TreasuryData;
  /** A real multi-expiry curve, when a provider supplies one. */
  futuresCurve?: CommodityFuturesCurve;
}

/** Exported for the UI/tests: the dimensions this domain defines. */
export const COMMODITY_DIMENSIONS: FundamentalDimension["name"][] = [
  "supply-demand",
  "inventories",
  "term-structure",
  "futures-positioning",
  "macro-drivers",
];

/**
 * Documented policy parameters (no market truth is claimed by them).
 */
export const COMMODITY_PARAMETERS = {
  /** Curve slope (%) below which the structure reads "flat". */
  curveFlatBandPercent: 0.25,
  /** 10Y move (pp) below which the rate channel is noise. */
  macroYieldMaterialPp: 0.03,
  /** 2s10s spread (pp) below which the curve is described as flat. */
  curveSlopeFlatPp: 0.05,
} as const;

/** Commodity groups the profiles know about. */
export type CommodityGroup =
  | "energy"
  | "precious-metals"
  | "industrial-metals"
  | "agriculture"
  | "unclassified";

export interface CommodityProfile {
  group: CommodityGroup;
  /** Where the classification came from — auditable, never implicit. */
  classificationSource: string;
  /** The documented hierarchy applied to the state. */
  hierarchy: DimensionHierarchyEntry[];
}

/**
 * Domain-aware evidence hierarchy. Energy is physical-first; precious metals
 * are driven by the real-yield channel plus positioning; industrial metals and
 * agriculture are physical-first (their inventory/production feeds are not
 * configured, so those dimensions honestly report unavailable).
 */
const PROFILE_HIERARCHY: Record<CommodityGroup, DimensionHierarchyEntry[]> = {
  energy: [
    { name: "inventories", role: "primary" },
    { name: "supply-demand", role: "primary" },
    { name: "term-structure", role: "primary" },
    { name: "futures-positioning", role: "secondary" },
    { name: "macro-drivers", role: "supporting" },
  ],
  "precious-metals": [
    // No physical/inventory feed exists for bullion on this platform's
    // configured providers, so its documented profile promotes the ONE
    // evidence class that does exist — the regulated CFTC positioning
    // structure — to primary, keeps a real futures curve secondary, and keeps
    // the real-yield channel SUPPORTING (so one macro variable can never
    // dictate the state). If a physical feed is ever wired, its role comes
    // from this configuration, not from new code.
    { name: "futures-positioning", role: "primary" },
    { name: "term-structure", role: "secondary" },
    { name: "inventories", role: "supporting" },
    { name: "supply-demand", role: "supporting" },
    { name: "macro-drivers", role: "supporting" },
  ],
  "industrial-metals": [
    { name: "inventories", role: "primary" },
    { name: "supply-demand", role: "primary" },
    { name: "term-structure", role: "secondary" },
    { name: "futures-positioning", role: "secondary" },
    { name: "macro-drivers", role: "supporting" },
  ],
  agriculture: [
    { name: "inventories", role: "primary" },
    { name: "supply-demand", role: "primary" },
    { name: "term-structure", role: "secondary" },
    { name: "futures-positioning", role: "secondary" },
    { name: "macro-drivers", role: "supporting" },
  ],
  // Physical-first default for a commodity the registry does not classify.
  unclassified: [
    { name: "inventories", role: "primary" },
    { name: "supply-demand", role: "primary" },
    { name: "term-structure", role: "primary" },
    { name: "futures-positioning", role: "secondary" },
    { name: "macro-drivers", role: "supporting" },
  ],
};

/**
 * Classify the instrument from the CANONICAL INSTRUMENT REGISTRY (tags), not
 * from its ticker: the same function classifies WTI, BRENT, XAU/USD, COPPER and
 * any future commodity the registry gains.
 */
export function commodityProfileOf(instrument: string): CommodityProfile {
  const resolution = resolveInstrumentWithAliases(instrument);
  const canonical = resolution.status === "RESOLVED" ? resolution.instrument : undefined;
  if (!canonical || canonical.assetClass !== "commodity") {
    return {
      group: "unclassified",
      classificationSource: canonical
        ? `canonical registry entry "${canonical.canonical}" is assetClass "${canonical.assetClass}" — commodity tags absent, generic physical-first hierarchy applied`
        : `"${instrument}" is not in the canonical instrument registry — generic physical-first commodity hierarchy applied`,
      hierarchy: PROFILE_HIERARCHY.unclassified,
    };
  }
  const tags = canonical.tags.map((t) => t.toLowerCase());
  const group: CommodityGroup = tags.includes("energy")
    ? "energy"
    : tags.includes("precious_metal")
      ? "precious-metals"
      : tags.includes("industrial_metal")
        ? "industrial-metals"
        : tags.some((t) => t.includes("agri") || t.includes("grain") || t.includes("soft"))
          ? "agriculture"
          : "unclassified";
  return {
    group,
    classificationSource: `canonical registry entry "${canonical.canonical}" (${canonical.name}), tags [${canonical.tags.join(", ")}]`,
    hierarchy: PROFILE_HIERARCHY[group],
  };
}

// ── formatting helpers (pure) ──────────────────────────────────────

const fmtInt = (v: number): string => Math.round(v).toLocaleString("en-US");
const fmtSigned = (v: number, digits = 2): string =>
  `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
const fmtSignedInt = (v: number): string =>
  `${v >= 0 ? "+" : "-"}${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const pct = (v: number, digits = 2): string => `${fmtSigned(v, digits)}%`;
const iso = (ms: number): string => new Date(ms).toISOString();

const EIA_CONSUMER = "the conviction engine's EIA Inventory layer";
const COT_CONSUMER = "the conviction engine's COT Positioning layer";
const YIELD_CONSUMER = "the conviction engine's Macro Yield layer";

/**
 * Flow series the EIA supply-and-disposition dataset carries, recognised from
 * the provider's OWN product/series labels and units. Direction is the effect
 * a RISE has on the commodity's physical balance:
 *   production ↑ / imports ↑        → more supply       → negative
 *   exports ↑ / refinery demand ↑   → less domestic     → positive
 *   product supplied ↑              → more demand       → positive
 * An unclassifiable flow is reported, never scored.
 */
type FlowKind =
  | "production"
  | "imports"
  | "exports"
  | "refinery-inputs"
  | "refinery-utilisation"
  | "product-supplied";

const FLOW_RULES: { kind: FlowKind; test: RegExp; direction: 1 | -1; label: string }[] = [
  { kind: "production", test: /production|output|field production|crude oil supplied/i, direction: -1, label: "production" },
  { kind: "imports", test: /import/i, direction: -1, label: "imports" },
  { kind: "exports", test: /export/i, direction: 1, label: "exports" },
  { kind: "refinery-utilisation", test: /utilis|utiliz/i, direction: 1, label: "refinery utilisation" },
  { kind: "refinery-inputs", test: /refinery input|refinery crude|inputs to refiner/i, direction: 1, label: "refinery inputs" },
  { kind: "product-supplied", test: /product supplied|products supplied|demand/i, direction: 1, label: "product supplied" },
];

function classifyFlow(point: EiaSeriesPoint): { kind: FlowKind; direction: 1 | -1; label: string; unit?: string } | undefined {
  const text = `${point.productName ?? ""} ${point.productId}`.trim();
  if (text.length === 0) return undefined;
  const rule = FLOW_RULES.find((r) => r.test.test(text));
  if (!rule) return undefined;
  return { ...rule, ...(point.unit ? { unit: point.unit } : {}) };
}

/** A flow series carries a per-day (or %) unit; stocks carry a level unit. */
function isFlowUnit(point: EiaSeriesPoint): boolean {
  const unit = point.unit ?? "";
  return /per day|\/d\b|\bdaily\b/i.test(unit);
}

/**
 * TRUE when a series is a FLOW (per-day volume or a percentage) rather than a
 * stock level. Flow series live in the provider's supply-and-disposition
 * dataset; a stock series must never be read as a flow, and vice versa.
 */
export function isFlowSeries(point: EiaSeriesPoint): boolean {
  const flow = classifyFlow(point);
  if (!flow) return false;
  return (point.unit ?? "").includes("%") || isFlowUnit(point);
}

interface FlowReading {
  kind: FlowKind;
  label: string;
  direction: 1 | -1;
  point: EiaSeriesPoint;
  /** Material, provider-scaled change for this series. */
  material: boolean;
  note: string;
}

/**
 * Reads whatever FLOW series the EIA payload actually carries. Returns an
 * empty list when the payload holds stock series only — in which case the
 * supply/demand dimension reports exactly that instead of inventing a balance.
 */
export function readEiaFlows(eia: EiaContext): { readings: FlowReading[]; unclassified: string[] } {
  const readings: FlowReading[] = [];
  const unclassified: string[] = [];
  for (const point of eia.series) {
    const flow = classifyFlow(point);
    if (!flow) continue; // a stock leg (or an unclassifiable series) — read elsewhere
    const percentSeries = (point.unit ?? "").includes("%");
    if (!percentSeries && !isFlowUnit(point)) continue; // no per-day/percent unit → not a flow read
    if (point.change === undefined) {
      unclassified.push(`${flow.label} (${point.productId}) — single observation, no change to read`);
      continue;
    }
    const denominator = point.previousValue !== undefined && point.previousValue !== 0 ? Math.abs(point.previousValue) : undefined;
    const changePercent = denominator !== undefined ? (point.change / denominator) * 100 : undefined;
    // Flow series carry different units (thousand barrels/day, percent), so no
    // single absolute band applies: materiality uses the documented percentage
    // band, and the note says so.
    const material = changePercent !== undefined && Math.abs(changePercent) >= EIA_SIGNAL_THRESHOLD_PCT;
    readings.push({
      kind: flow.kind,
      label: flow.label,
      direction: flow.direction,
      point,
      material,
      note: `${flow.label} (${point.productId}${point.productName ? `, ${point.productName}` : ""}) ${point.latestValue}${point.unit ? ` ${point.unit}` : ""}, change ${fmtSigned(point.change, 2)}${changePercent !== undefined ? ` (${pct(changePercent)})` : ""} — observation ${point.observationDate} vs ${point.previousObservationDate ?? "n/a"}; materiality band ±${EIA_SIGNAL_THRESHOLD_PCT}% (flow units differ, so no absolute band is applied)`,
    });
  }
  return { readings, unclassified };
}

// ── the assessment ────────────────────────────────────────────────

export function assessCommodityFundamentals(
  ctx: CommodityFundamentalContext,
): FundamentalAssessment {
  const nativeId = ctx.providerInstrumentId ?? ctx.instrument;
  const profile = commodityProfileOf(ctx.instrument.length > 0 ? ctx.instrument : nativeId);
  const eia: EiaContext | undefined = ctx.eia && ctx.eia.available ? ctx.eia : undefined;
  const cot: CotContext | undefined = ctx.cot && ctx.cot.available ? ctx.cot : undefined;
  const treasury: TreasuryContext | undefined =
    ctx.treasury && ctx.treasury.available ? ctx.treasury : undefined;
  const curve = ctx.futuresCurve && ctx.futuresCurve.contracts.length >= 2 ? ctx.futuresCurve : undefined;

  const dimensions: FundamentalDimension[] = [];
  const evidence: FundamentalEvidenceItem[] = [];
  const limitations: string[] = [];
  const contradictions: string[] = [];
  const metrics: CommodityFundamentalMetrics = {};
  const providers: string[] = [];
  const groups = new Set<string>();
  let historyDepth = 0;

  // ═══════════════════════════════════════════════════════════════
  // A. Inventories — the physical read (EIA WPSR stock series)
  // ═══════════════════════════════════════════════════════════════
  {
    const stockSeries = eia ? eia.series.filter((point) => !isFlowSeries(point)) : [];
    const headline = stockSeries[0];
    if (eia && headline) {
      providers.push("U.S. EIA");
      groups.add("EIA");
      const regime = derivePhysicalRegime(stockSeries);
      const trend = inventoryTrend(headline);
      const baseline = baselinePosition(headline);
      const weeklyDir = regime.regime === "tightening" ? 1 : regime.regime === "loosening" ? -1 : 0;
      const trendDir = trend.direction === "declining" ? 1 : trend.direction === "rising" ? -1 : 0;
      const baselineDir =
        baseline.position === "below" ? 1 : baseline.position === "above" ? -1 : 0;
      if (isFiniteNumber(headline.change) || trend.direction !== "insufficient") historyDepth += 1;

      let status: FundamentalDimension["status"] = "neutral";
      const conflictWindow =
        weeklyDir !== 0 && trendDir !== 0 && weeklyDir !== trendDir
          ? `weekly release says ${regime.regime} while the ${EIA_TREND_MIN_WEEKS}-week trend is ${trend.direction}`
          : weeklyDir !== 0 && baselineDir !== 0 && weeklyDir !== baselineDir
            ? `weekly release says ${regime.regime} while stocks sit ${baseline.position} the recent baseline`
            : undefined;
      if (weeklyDir === 0) {
        status = "neutral";
      } else if (conflictWindow) {
        status = "neutral";
        contradictions.push(
          `Conflicting physical windows for ${nativeId}: ${conflictWindow}. Both windows are reported; neither is averaged away, so the physical dimension carries no direction.`,
        );
      } else {
        status = weeklyDir > 0 ? "positive" : "negative";
      }

      const legText = stockSeries
        .map((s) => {
          const change = isFiniteNumber(s.change)
            ? `week-over-week ${fmtSigned(s.change, 2)}${s.unit ? ` ${s.unit}` : ""}${
                isFiniteNumber(s.changePercent) ? ` (${pct(s.changePercent)})` : ""
              }`
            : "single observation — no week-over-week change exists";
          return `${s.productName ?? s.productId} (${s.productId}) ${s.latestValue}${s.unit ? ` ${s.unit}` : ""}, ${change}`;
        })
        .join("; ");

      dimensions.push(
        dimension(
          "inventories",
          status,
          `U.S. EIA Weekly Petroleum Status Report (observation ${headline.observationDate}${
            headline.previousObservationDate ? ` vs ${headline.previousObservationDate}` : ""
          }, freshness ${eia.freshness}, release acquired ${iso(eia.fetchedAt)}): ${legText}. Physical regime: ${regime.regime} — ${regime.basis}. Multi-week trend: ${trend.direction} — ${trend.basis}. Baseline: ${baseline.position} — ${baseline.basis}. Provider stocks only: levels, changes, breadth and trend are real observations, while any supply/demand balance statement would be DERIVED and is not made here.`,
        ),
      );

      const pushLegItems: FundamentalEvidenceItem[] = stockSeries.map((s) => ({
        metric: `inventory_${s.productId}`,
        label: `${s.productName ?? s.productId} weekly stocks`,
        value: s.latestValue,
        unit: s.unit,
        provider: "U.S. Energy Information Administration",
        providerInstrumentId: nativeId,
        source: `Weekly Petroleum Status Report stocks (EIA Open Data v2 /petroleum/sto/data; series ${s.productId})`,
        observedAt: eia.fetchedAt,
        observedAtSemantics: "acquisition-receipt",
        period: s.observationDate,
        freshness: eia.freshness,
        evidenceClass: "provider-reported",
        basis: `${s.latestValue} ${s.unit ?? ""} at ${s.observationDate} vs ${s.previousValue ?? "n/a"} at ${s.previousObservationDate ?? "n/a"}`,
        consumedElsewhere: EIA_CONSUMER,
      }));
      evidence.push(...pushLegItems.slice(0, 1).map((item) => ({ ...item, metric: "inventory_wpsr", label: "EIA weekly petroleum stocks (headline series)" })));
      evidence.push(...pushLegItems.slice(1));
      evidence.push({
        metric: "inventory_physical_regime",
        label: "Derived physical-market regime of the WPSR release",
        value: regime.regime,
        unit: "regime",
        provider: "U.S. Energy Information Administration",
        providerInstrumentId: nativeId,
        source: "derived from the provider's own week-over-week stock changes across the WPSR product legs",
        observedAt: eia.fetchedAt,
        observedAtSemantics: "acquisition-receipt",
        period: headline.observationDate,
        freshness: eia.freshness,
        derived: true,
        evidenceClass: "interpretation",
        basis: regime.basis,
        consumedElsewhere: EIA_CONSUMER,
      });
      if (trend.direction !== "insufficient") {
        evidence.push({
          metric: "inventory_trend",
          label: `EIA inventory trend (${EIA_TREND_MIN_WEEKS} weekly observations)`,
          value: trend.direction,
          unit: "trend",
          provider: "U.S. Energy Information Administration",
          providerInstrumentId: nativeId,
          source: "derived from consecutive WPSR observations of the headline series",
          observedAt: eia.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: headline.observationDate,
          freshness: eia.freshness,
          derived: true,
          evidenceClass: "derived-metric",
          basis: trend.basis,
          consumedElsewhere: EIA_CONSUMER,
        });
      }
      if (baseline.position !== "insufficient") {
        evidence.push({
          metric: "inventory_baseline",
          label: "Latest stocks vs the recent provider baseline",
          value: isFiniteNumber(baseline.deviationPercent) ? baseline.deviationPercent : baseline.position,
          unit: isFiniteNumber(baseline.deviationPercent) ? "%" : "position",
          provider: "U.S. Energy Information Administration",
          providerInstrumentId: nativeId,
          source: "derived from consecutive WPSR observations of the headline series",
          observedAt: eia.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: headline.observationDate,
          freshness: eia.freshness,
          derived: true,
          evidenceClass: "derived-metric",
          basis: baseline.basis,
          consumedElsewhere: EIA_CONSUMER,
        });
      }

      metrics.inventoryLatest = headline.latestValue;
      if (isFiniteNumber(headline.change)) metrics.inventoryChangeWoW = headline.change;
      if (isFiniteNumber(headline.changePercent)) metrics.inventoryChangePercentWoW = headline.changePercent;
      metrics.inventoryLegsAvailable = stockSeries.length;
      metrics.inventoryTrend = trend.direction;
      if (isFiniteNumber(trend.change)) metrics.inventoryTrendChange = trend.change;
      if (isFiniteNumber(trend.changePercent)) metrics.inventoryTrendPercent = trend.changePercent;
      metrics.inventoryBaselinePosition = baseline.position;
      if (isFiniteNumber(baseline.deviationPercent)) metrics.inventoryBaselineDeviationPercent = baseline.deviationPercent;
      metrics.inventoryDraws = regime.draws;
      metrics.inventoryBuilds = regime.builds;
      metrics.physicalRegime = regime.regime;

      if (eia.failedLegs.length > 0) {
        limitations.push(
          `EIA product legs that failed independently (reported, never substituted or estimated): ${eia.failedLegs
            .map((f) => `${f.productId} — ${f.reason}`)
            .join("; ")}.`,
        );
      }
      limitations.push(
        `Regional/warehouse-level stocks, inventory surprise against a consensus and days-of-supply are NOT supplied by the configured inventory feed (U.S. aggregate petroleum stocks only), so none of them is derived. Multi-week reads use the ${EIA_TREND_MIN_WEEKS}-week window the acquisition requests; a shorter window reports "insufficient" instead of extrapolating.`,
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
  // B. Supply / demand — only from REAL flow series
  // ═══════════════════════════════════════════════════════════════
  {
    const flows = eia ? readEiaFlows(eia) : { readings: [], unclassified: [] };
    if (eia && flows.readings.length > 0) {
      providers.push("U.S. EIA (supply-and-disposition series)");
      groups.add("EIA-supply-demand");
      const directional = flows.readings.filter((r) => r.material);
      let status: FundamentalDimension["status"] = "neutral";
      if (directional.length > 0) {
        // `direction` states the effect of a RISE; the reported sign decides
        // which way the balance actually moved, so the two are multiplied.
        const score =
          directional.reduce((sum, r) => sum + r.direction * Math.sign(r.point.change ?? 0), 0) / directional.length;
        status = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
      }
      const flowText = flows.readings.map((r) => `${r.note}${r.material ? "" : " (inside the documented noise band)"}`).join("; ");
      dimensions.push(
        dimension(
          "supply-demand",
          status,
          `U.S. EIA supply-and-disposition series (freshness ${eia.freshness}, release acquired ${iso(
            eia.fetchedAt,
          )}): ${flowText}. DIRECTION POLICY (documented): rising production/imports loosen the physical balance; rising exports, refinery inputs/utilisation and product supplied tighten it. These are provider REPORTED flow fields; the tightening/loosening label is a DERIVED interpretation and is never presented as a provider-reported balance.`,
        ),
      );
      for (const r of flows.readings) {
        evidence.push({
          metric: `supply_demand_${r.kind}`,
          label: `EIA ${r.label}`,
          value: r.point.latestValue,
          unit: r.point.unit,
          provider: "U.S. Energy Information Administration",
          providerInstrumentId: nativeId,
          source: `EIA supply-and-disposition series (${r.point.productId})`,
          observedAt: eia.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: r.point.observationDate,
          freshness: eia.freshness,
          evidenceClass: "provider-reported",
          basis: r.note,
          consumedElsewhere: EIA_CONSUMER,
        });
        if (isFiniteNumber(r.point.change)) {
          const rTrend = inventoryTrend(r.point);
          if (rTrend.direction !== "insufficient") {
            evidence.push({
              metric: `supply_demand_${r.kind}_trend`,
              label: `EIA ${r.label} multi-observation trend`,
              value: rTrend.direction,
              unit: "trend",
              provider: "U.S. Energy Information Administration",
              providerInstrumentId: nativeId,
              source: `derived from consecutive EIA supply-and-disposition observations (${r.point.productId})`,
              observedAt: eia.fetchedAt,
              observedAtSemantics: "acquisition-receipt",
              period: r.point.observationDate,
              freshness: eia.freshness,
              derived: true,
              evidenceClass: "derived-metric",
              basis: rTrend.basis,
              consumedElsewhere: EIA_CONSUMER,
            });
          }
        }
      }
      if (flows.unclassified.length > 0) {
        limitations.push(
          `Flow series the adapter could not classify from the provider's own labels are reported, never scored: ${flows.unclassified.join("; ")}.`,
        );
      }
    } else {
      dimensions.push(unavailable("supply-demand"));
      const detail = flows.unclassified.length > 0 ? ` (${flows.unclassified.join("; ")})` : "";
      limitations.push(
        `Supply/demand UNAVAILABLE${detail} — no configured provider returned production, consumption, imports/exports, refinery-utilisation or product-supplied series for this instrument. The configured EIA request fetches the WPSR STOCK series only, so a physical balance is neither reported nor estimated from stocks, price or positioning.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // C. Futures / term structure — only from a REAL multi-expiry curve
  // ═══════════════════════════════════════════════════════════════
  {
    if (curve) {
      providers.push(curve.provider);
      groups.add(curve.provider);
      historyDepth += 1;
      const front = curve.contracts[0];
      const back = curve.contracts[curve.contracts.length - 1];
      const slope = back.price !== 0 ? ((back.price - front.price) / Math.abs(front.price)) * 100 : undefined;
      const band = COMMODITY_PARAMETERS.curveFlatBandPercent;
      const structure: "contango" | "backwardation" | "flat" | "insufficient" =
        slope === undefined ? "insufficient" : Math.abs(slope) < band ? "flat" : slope > 0 ? "contango" : "backwardation";
      const status: FundamentalDimension["status"] =
        structure === "backwardation" ? "positive" : structure === "contango" ? "negative" : "neutral";
      dimensions.push(
        dimension(
          "term-structure",
          status,
          `${curve.provider} futures curve (${curve.source}; observed ${iso(curve.observedAt)}${
            curve.freshness ? `, freshness ${curve.freshness}` : ""
          }): ${curve.contracts
            .map(
              (c) =>
                `${c.contract}${c.expiry ? ` (${c.expiry})` : ""} ${c.price}${curve.unit ? ` ${curve.unit}` : ""}${
                  c.openInterest !== undefined ? `, OI ${fmtInt(c.openInterest)}` : ""
                }`,
            )
            .join("; ")}. Front-to-back slope ${slope !== undefined ? pct(slope) : "not computable"} → structure ${structure}. DIRECTION POLICY (documented): backwardation (front above deferred) is supportive for the front contract's physical balance, contango implies carry/oversupply, and a slope inside ±${band}% reads flat. The structure is derived from the provider's own contract prices.`,
        ),
      );
      metrics.curveStructure = structure;
      metrics.curveFrontPrice = front.price;
      metrics.curveBackPrice = back.price;
      if (slope !== undefined) metrics.curveSlopePercent = slope;
      evidence.push({
        metric: "curve_front",
        label: `Front contract ${front.contract}`,
        value: front.price,
        unit: curve.unit,
        provider: curve.provider,
        providerInstrumentId: front.contract,
        source: curve.source,
        observedAt: curve.observedAt,
        ...(curve.freshness ? { freshness: curve.freshness } : {}),
        evidenceClass: "provider-reported",
        period: front.expiry ?? "front contract",
      });
      evidence.push({
        metric: "curve_back",
        label: `Back contract ${back.contract}`,
        value: back.price,
        unit: curve.unit,
        provider: curve.provider,
        providerInstrumentId: back.contract,
        source: curve.source,
        observedAt: curve.observedAt,
        ...(curve.freshness ? { freshness: curve.freshness } : {}),
        evidenceClass: "provider-reported",
        period: back.expiry ?? "deferred contract",
      });
    } else {
      dimensions.push(unavailable("term-structure"));
      limitations.push(
        "Futures term structure (contango/backwardation, front/back relationship, curve slope, calendar spreads, basis and roll yield) UNAVAILABLE — no configured provider supplies a multi-expiry futures curve, so none is derived from spot candles, from the front month alone or from the COT report. A curve supplied by a real provider is scored by this adapter without code changes.",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // D. Futures positioning — CFTC Commitments of Traders
  // ═══════════════════════════════════════════════════════════════
  {
    if (cot) {
      providers.push("CFTC");
      groups.add("CFTC");
      const read = classifyCotPositioning(cot);
      if (read.historyReports >= COT_PERCENTILE_MIN_REPORTS) historyDepth += 1;
      const status: FundamentalDimension["status"] =
        read.label === "supportive" ? "positive" : read.label === "opposing" ? "negative" : "neutral";
      const oi = cot.latest.openInterest;
      dimensions.push(
        dimension(
          "futures-positioning",
          read.label === "insufficient" ? "unavailable" : status,
          read.label === "insufficient"
            ? `CFTC Commitments of Traders — ${cot.mappedAsset} (${cot.sourceInstrument}), report ${cot.latest.reportDate}: ${read.basis}.`
            : `CFTC Commitments of Traders — ${cot.mappedAsset} (${cot.sourceInstrument}), report ${cot.latest.reportDate}${
                cot.previous ? ` vs ${cot.previous.reportDate}` : ""
              }, freshness ${cot.freshness}, rows acquired ${iso(cot.fetchedAt)}: non-commercial long ${fmtInt(
                cot.latest.nonCommercialLong,
              )} / short ${fmtInt(cot.latest.nonCommercialShort)} → net non-commercial ${fmtInt(cot.netNonCommercial)}${
                isFiniteNumber(cot.changeFromPreviousReport)
                  ? `, change ${fmtSignedInt(cot.changeFromPreviousReport)} vs the previous report`
                  : ", no previous consecutive report so no change is claimed"
              }${isFiniteNumber(oi) ? `, open interest ${fmtInt(oi)}` : ""}${
                read.commercialNet !== undefined ? `, commercial (hedger) net ${fmtSignedInt(read.commercialNet)}` : ""
              }. Classification: ${read.label} — ${read.basis}. An extreme/crowded reading is CONTEXT (continuation fuel or contrarian risk) and is never turned into a direction by itself.`,
        ),
      );
      if (read.label === "insufficient") {
        limitations.push(
          `Positioning UNAVAILABLE — ${read.basis}; a single report cannot produce a report-to-report change, and none is invented.`,
        );
      }
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
        period: cot.latest.reportDate,
        freshness: cot.freshness,
        evidenceClass: "provider-reported",
        consumedElsewhere: COT_CONSUMER,
      });
      evidence.push({
        metric: "cot_positioning_classification",
        label: "Derived positioning classification (provider reports)",
        value: read.label,
        unit: "classification",
        provider: "CFTC",
        providerInstrumentId: nativeId,
        source: `derived from CFTC weekly reports (${cot.sourceInstrument})`,
        observedAt: cot.fetchedAt,
        observedAtSemantics: "acquisition-receipt",
        period: cot.latest.reportDate,
        freshness: cot.freshness,
        derived: true,
        evidenceClass: "interpretation",
        basis: read.basis,
        consumedElsewhere: COT_CONSUMER,
      });
      metrics.futuresPositioningNet = cot.netNonCommercial;
      if (isFiniteNumber(cot.changeFromPreviousReport)) metrics.futuresPositioningChange = cot.changeFromPreviousReport;
      metrics.positioningLabel = read.label;
      if (isFiniteNumber(read.percentile)) metrics.positioningPercentile = read.percentile;
      if (isFiniteNumber(read.crowdRatio)) metrics.positioningCrowdRatio = read.crowdRatio;
      if (isFiniteNumber(read.commercialNet)) metrics.positioningCommercialNet = read.commercialNet;

      if (read.crowded) {
        contradictions.push(
          `Crowded positioning for ${nativeId}: non-commercial net is ${
            read.crowdRatio !== undefined ? `${(read.crowdRatio * 100).toFixed(1)}%` : "at or above the documented share"
          } of open interest${
            read.extreme ? ` (${read.extreme === "long" ? "upper" : "lower"} tail of the provider's own history)` : ""
          } — crowded positioning may amplify a reversal, so it is reported as risk context and never as a direction.`,
        );
      }
      if (read.contradictory) {
        contradictions.push(
          `Positioning disagreement for ${nativeId}: non-commercial and commercial (hedger) positioning moved in opposite directions beyond the documented signal threshold — the two sides of the report disagree.`,
        );
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
      groups.add("US Treasury");
      const nominal = treasury.latest.nominal;
      const real = treasury.latest.real;
      const tenY = nominal.nominal["10Y"];
      const twoY = nominal.nominal["2Y"];
      const realTenY = real?.real["10Y"];
      const prevRealTenY = treasury.previous?.real?.real["10Y"];
      const prevTenY = treasury.previous?.nominal.nominal["10Y"];
      const nominalChange = isFiniteNumber(tenY) && isFiniteNumber(prevTenY) ? tenY - prevTenY : undefined;
      const realChange = isFiniteNumber(realTenY) && isFiniteNumber(prevRealTenY) ? realTenY - prevRealTenY : undefined;
      const slope = isFiniteNumber(tenY) && isFiniteNumber(twoY) ? tenY - twoY : undefined;
      const material = COMMODITY_PARAMETERS.macroYieldMaterialPp;

      // Precious metals read the REAL yield (their own driver); every other
      // group reads the nominal 10Y change with the curve slope as context.
      const usesReal = profile.group === "precious-metals";
      const referenceLabel = usesReal
        ? realChange !== undefined
          ? "real 10Y"
          : "nominal 10Y (the real-yield feed was not supplied)"
        : "nominal 10Y";
      const change = usesReal && realChange !== undefined ? realChange : nominalChange;
      const status: FundamentalDimension["status"] =
        change === undefined || Math.abs(change) < material ? "neutral" : change < 0 ? "positive" : "negative";
      const directionText =
        status === "positive"
          ? "supportive (falling yields lower the discount rate / real opportunity cost)"
          : status === "negative"
            ? "a headwind (rising yields raise the discount rate)"
            : "neutral (inside the documented materiality band)";

      dimensions.push(
        dimension(
          "macro-drivers",
          status,
          `US Treasury curve (${treasury.source}, observation ${nominal.observationDate}, freshness ${treasury.freshness}, acquired ${iso(
            treasury.fetchedAt,
          )}): ${isFiniteNumber(tenY) ? `10Y nominal ${tenY.toFixed(2)}%` : "10Y nominal not supplied"}${
            isFiniteNumber(twoY) ? `, 2Y ${twoY.toFixed(2)}%` : ""
          }${
            isFiniteNumber(realTenY) ? `, real 10Y ${realTenY.toFixed(2)}% (Treasury's own real-yield feed)` : ", real 10Y not supplied"
          }${
            slope !== undefined
              ? `, 2s10s ${fmtSigned(slope, 2)}pp (${
                  Math.abs(slope) < COMMODITY_PARAMETERS.curveSlopeFlatPp
                    ? "flat"
                    : slope < 0
                      ? "inverted"
                      : "upward-sloping"
                })`
              : ""
          }; ${referenceLabel} change ${
            change !== undefined ? `${fmtSigned(change, 2)}pp vs the previous observation` : "not computable (no previous observation)"
          } → ${directionText}. ${
            profile.group === "precious-metals"
              ? "Profile: precious metals are read through the REAL-yield channel (the metal's own driver), with the nominal curve as context."
              : `Profile: ${profile.group} commodities are read through the nominal discount-rate channel, with the 2s10s slope as context.`
          } Supporting driver only: the shared hierarchy gives this dimension the lowest weight and requires a PRIMARY dimension on the winning side, so it can never set the commodity's direction on its own. The conviction engine's Macro Yield layer separately consumes the same release for the DECISION path; this assessment adds no weighted decision factor, and the evidence item names that consumer through its consumedElsewhere field.`,
        ),
      );
      if (isFiniteNumber(tenY)) {
        evidence.push({
          metric: "usd_10y_nominal",
          label: "USD 10Y nominal yield",
          value: tenY,
          unit: "%",
          provider: "US Treasury XML feed",
          providerInstrumentId: nativeId,
          source: "daily_treasury_yield_curve (home.treasury.gov XML feed)",
          observedAt: treasury.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: String(nominal.observationDate),
          freshness: String(treasury.freshness),
          evidenceClass: "provider-reported",
          consumedElsewhere: YIELD_CONSUMER,
        });
      }
      if (isFiniteNumber(realTenY)) {
        evidence.push({
          metric: "usd_10y_real",
          label: "USD 10Y real yield",
          value: realTenY,
          unit: "%",
          provider: "US Treasury XML feed",
          providerInstrumentId: nativeId,
          source: "daily_treasury_real_yield_curve (home.treasury.gov XML feed)",
          observedAt: treasury.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: String(real?.observationDate ?? nominal.observationDate),
          freshness: String(treasury.freshness),
          evidenceClass: "provider-reported",
          consumedElsewhere: YIELD_CONSUMER,
        });
      }
      if (change !== undefined) {
        evidence.push({
          metric: "usd_yield_reference_change",
          label: `${usesReal ? "US Treasury real 10Y" : "US Treasury nominal 10Y"} change`,
          value: change,
          unit: "pp",
          provider: "US Treasury XML feed",
          providerInstrumentId: nativeId,
          source: usesReal
            ? "derived from consecutive daily_treasury_real_yield_curve observations"
            : "derived from consecutive daily_treasury_yield_curve observations",
          observedAt: treasury.fetchedAt,
          observedAtSemantics: "acquisition-receipt",
          period: String(usesReal && real ? real.observationDate : nominal.observationDate),
          freshness: String(treasury.freshness),
          derived: true,
          evidenceClass: "derived-metric",
          basis: `${referenceLabel} ${fmtSigned(change, 2)}pp vs the previous Treasury observation`,
          consumedElsewhere: YIELD_CONSUMER,
        });
      }
      if (isFiniteNumber(tenY)) metrics.nominal10yYieldPercent = tenY;
      if (isFiniteNumber(realTenY)) metrics.real10yYieldPercent = realTenY;
      if (nominalChange !== undefined) metrics.nominal10yChangePp = nominalChange;
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
  // F. Cross-provider tension + honesty disclosures
  // ═══════════════════════════════════════════════════════════════
  {
    const inv = metrics.inventoryChangeWoW;
    const invLatest = metrics.inventoryLatest;
    const posChange = metrics.futuresPositioningChange;
    const oi = cot?.latest.openInterest;
    // Directional READING, not raw sign: a stock draw is a bullish physical
    // read while a build is bearish; a rising non-commercial net is bullish
    // positioning while a cut is bearish. Tension = the two readings disagree.
    if (
      isFiniteNumber(inv) &&
      inv !== 0 &&
      isFiniteNumber(invLatest) &&
      invLatest > 0 &&
      isFiniteNumber(posChange) &&
      posChange !== 0 &&
      (isFiniteNumber(oi) && oi > 0 ? Math.abs(posChange) / oi >= COT_SIGNAL_CHANGE_OI_RATIO : true) &&
      (inv < 0 ? 1 : -1) !== Math.sign(posChange)
    ) {
      contradictions.push(
        `Cross-provider tension for ${nativeId}: the EIA release moved stocks ${
          inv >= 0 ? "up" : "down"
        } (${fmtSigned(inv, 2)}, a ${inv < 0 ? "tightening" : "loosening"} physical read) while CFTC non-commercial net positioning ${
          posChange >= 0 ? "rose" : "fell"
        } (${fmtSignedInt(posChange)}, a ${
          posChange >= 0 ? "bullish" : "bearish"
        } positioning read) — the physical and positioning readings point in opposite directions. Both are reported as context; neither is averaged away.`,
      );
    }
  }

  limitations.push(
    `Commodity-specific drivers beyond the discount-rate channel (a real USD index, central-bank flows, OPEC/supply actions, refinery utilisation when the EIA flow series are not configured, industrial demand indicators and crop/weather/harvest evidence) UNAVAILABLE — no configured provider supplies them for this instrument. The platform's USD proxy is explicitly news-derived, not a DXY price series, and is never substituted here.`,
  );
  limitations.push(
    "EIA inventory and CFTC positioning are weekly provider RELEASES and Treasury yields are daily observations: each carries its own observation/report date and is never presented as a live market price.",
  );
  limitations.push(
    "Company-style fundamentals (EPS, P/E, revenue growth, margins) do not apply to a commodity instrument — no EPS/P/E/revenue metric is computed or shown for one, and a commodity is never treated as having a corporate issuer.",
  );
  limitations.push(
    "The conviction engine's own layers (EIA Inventory, COT Positioning, Macro Yield) remain the only scoring consumers of these releases for the DECISION path; every evidence item names the layer that consumes it. This assessment adds no weighted decision factor and is consumed by the unified intelligence layer as an agreement class only, so one provider field never becomes two votes.",
  );

  // ═══════════════════════════════════════════════════════════════
  // No evidence at all → explicit unavailable (never a fabricated state)
  // ═══════════════════════════════════════════════════════════════
  if (!eia && !cot && !treasury && !curve) {
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
        "No usable commodity fundamental dimensions — no configured provider returned inventory, positioning, curve or macro-driver evidence for this instrument.",
      directionalBias: "none",
      dimensions,
      contradictions: [],
      unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
      evidenceCoverage: coverageOf(dimensions, []),
      evidence: [],
      metrics: {},
      commodityProfile: { group: profile.group, classificationSource: profile.classificationSource, hierarchy: profile.hierarchy },
      summary: `Physical market: unavailable. Inventory: unavailable. Supply/demand: unavailable. Positioning: unavailable. Term structure: unavailable. Macro: unavailable. Assessment: insufficient — no commodity-native evidence was supplied. Periods: none.`,
      limitations: [
        `No commodity-native fundamental evidence was supplied for ${nativeId} — supply/demand, inventory, futures-curve, positioning and macro-driver evidence are all UNAVAILABLE, and none of them is invented.`,
        ...limitations,
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Aggregation (shared framework, hierarchy-aware)
  // ═══════════════════════════════════════════════════════════════
  const extras: string[] = [];
  if (metrics.positioningLabel === "crowded") {
    extras.push("crowded positioning is risk context, not evidence — confidence capped at medium");
  }
  // Provider freshness is a confidence input: a provider that classifies its
  // own release STALE caps the read, and a DELAYED label is disclosed. The
  // labels are the providers' own, never upgraded here.
  {
    const labels = [
      eia ? { source: "EIA inventory", freshness: eia.freshness } : undefined,
      cot ? { source: "CFTC positioning", freshness: cot.freshness } : undefined,
      treasury ? { source: "US Treasury", freshness: treasury.freshness } : undefined,
      curve ? { source: `${curve.provider} curve`, freshness: curve.freshness } : undefined,
    ].filter((x): x is { source: string; freshness: string | undefined } => x !== undefined && x.freshness !== undefined);
    if (labels.some((l) => l.freshness === "STALE")) {
      extras.push("a provider classified its evidence STALE — confidence capped at medium");
    }
    const delayed = labels.filter((l) => l.freshness === "DELAYED").map((l) => l.source);
    if (delayed.length > 0) {
      limitations.push(
        `Provider freshness labels are carried verbatim: ${delayed.join(", ")} classified its evidence DELAYED${
          labels.some((l) => l.freshness === "STALE") ? " (and at least one provider classified its release STALE)" : ""
        } — the assessment never upgrades a provider's own freshness label.`,
      );
    }
  }
  const periods = [
    eia ? eia.series.filter((point) => !isFlowSeries(point))[0]?.observationDate : undefined,
    cot ? cot.latest.reportDate : undefined,
    treasury ? treasury.latest.nominal.observationDate : undefined,
    curve ? new Date(curve.observedAt).toISOString().slice(0, 10) : undefined,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  const reportingPeriod = periods.length > 0 ? periods.reduce((a, b) => (a > b ? a : b)) : undefined;

  const { state, confidence, confidenceEvidence } = aggregateConfidence({
    dimensions,
    periodsCount: evidence.length,
    periodsLabel: "provider commodity measurements",
    ...(reportingPeriod ? { reportingPeriod } : {}),
    hierarchy: profile.hierarchy,
    independentGroups: groups.size,
    historyDepth,
    extraCaps: extras,
  });
  const weighted = aggregateStateWithHierarchy(dimensions, profile.hierarchy);

  const directionalBias = state === "improving" ? "bullish" : state === "weakening" ? "bearish" : "none";
  const directionalBiasEvidence =
    state === "improving" || state === "weakening"
      ? `${state === "improving" ? "Improving" : "Weakening"} physical/fundamental evidence for ${nativeId}: ${weighted.basis}.`
      : `No directional fundamental read for ${nativeId} — ${weighted.basis}.`;

  const scored = dimensions.filter((d) => d.status !== "unavailable");
  if (scored.length === 0) {
    limitations.push(
      "No dimension carried usable commodity evidence — the state reads insufficient rather than importing another asset class's metrics.",
    );
  }

  const observedAt = Math.max(
    eia?.fetchedAt ?? 0,
    cot?.fetchedAt ?? 0,
    treasury?.fetchedAt ?? 0,
    curve?.observedAt ?? 0,
  );

  // ── the §9 explanation, built from the same evidence ──
  const positioningLine = metrics.positioningLabel
    ? `Positioning: ${metrics.positioningLabel}${
        isFiniteNumber(metrics.positioningPercentile)
          ? ` (net/OI percentile ${(metrics.positioningPercentile * 100).toFixed(0)}% of the provider's own history)`
          : " (percentile context insufficient)"
      }${
        isFiniteNumber(metrics.positioningCrowdRatio)
          ? metrics.positioningLabel === "crowded"
            ? `, crowding ${(metrics.positioningCrowdRatio * 100).toFixed(
                1,
              )}% of open interest (beyond the documented ${(COT_CROWDING_OI_RATIO * 100).toFixed(0)}% band)`
            : `, |net|/OI ${(metrics.positioningCrowdRatio * 100).toFixed(1)}% (inside the documented ${(
                COT_CROWDING_OI_RATIO * 100
              ).toFixed(0)}% crowding band)`
          : ""
      }`
    : "Positioning: unavailable";
  const curveLine = metrics.curveStructure
    ? `Term structure: ${metrics.curveStructure}${
        isFiniteNumber(metrics.curveSlopePercent) ? ` (front-to-back ${pct(metrics.curveSlopePercent)})` : ""
      }`
    : "Term structure: unavailable — no multi-expiry provider is configured";
  const macroLine = (() => {
    const d = dimensions.find((x) => x.name === "macro-drivers");
    if (!d || d.status === "unavailable") return "Macro: unavailable";
    return `Macro: ${d.status === "positive" ? "supportive" : d.status === "negative" ? "a headwind" : "neutral"}${
      isFiniteNumber(metrics.nominal10yChangePp) ? ` (nominal 10Y ${fmtSigned(metrics.nominal10yChangePp, 2)}pp)` : ""
    }${isFiniteNumber(metrics.real10yYieldPercent) ? `, real 10Y ${metrics.real10yYieldPercent.toFixed(2)}%` : ""}`;
  })();
  const eiaStockUnit = eia ? eia.series.filter((point) => !isFlowSeries(point))[0]?.unit : undefined;
  const inventoryLine =
    metrics.inventoryLatest !== undefined
      ? `Inventory: ${metrics.inventoryLatest}${eiaStockUnit ? ` ${eiaStockUnit}` : ""}${
          isFiniteNumber(metrics.inventoryChangeWoW) ? `, week-over-week ${fmtSigned(metrics.inventoryChangeWoW, 2)}` : ""
        } — trend ${metrics.inventoryTrend ?? "insufficient"}${
          isFiniteNumber(metrics.inventoryTrendPercent) ? ` (${pct(metrics.inventoryTrendPercent)})` : ""
        }, ${metrics.inventoryBaselinePosition ?? "insufficient"} the recent baseline${
          isFiniteNumber(metrics.inventoryBaselineDeviationPercent) ? ` (${pct(metrics.inventoryBaselineDeviationPercent)})` : ""
        }`
      : "Inventory: unavailable";
  const supplyLine = (() => {
    const d = dimensions.find((x) => x.name === "supply-demand");
    if (!d || d.status === "unavailable") return "Supply/demand: unavailable";
    return `Supply/demand: ${d.status === "positive" ? "tightening" : d.status === "negative" ? "loosening" : "balanced"} from the provider's reported flow series`;
  })();
  const riskParts: string[] = [];
  if (metrics.positioningLabel === "crowded") riskParts.push("crowded positioning");
  if (metrics.positioningLabel === "contradictory") riskParts.push("commercial/non-commercial disagreement");
  if (contradictions.some((c) => c.startsWith("Conflicting physical windows"))) {
    riskParts.push("conflicting physical windows (weekly vs trend)");
  }
  if (contradictions.some((c) => c.startsWith("Cross-provider tension"))) {
    riskParts.push("physical and positioning readings point opposite ways");
  }
  const summary = [
    `Physical market: ${metrics.physicalRegime ?? "insufficient"}${metrics.inventoryDraws !== undefined ? ` (${metrics.inventoryDraws} leg(s) drawing, ${metrics.inventoryBuilds ?? 0} building)` : ""}.`,
    `${inventoryLine}.`,
    `${supplyLine}.`,
    `${positioningLine}.`,
    `${curveLine}.`,
    `${macroLine}.`,
    `Assessment: ${state} · confidence ${confidence}.`,
    `Risk: ${riskParts.length > 0 ? riskParts.join("; ") : "none identified in the supplied evidence"}.`,
    `Periods: ${periods.length > 0 ? periods.join(" / ") : "none"}.`,
  ].join(" ");

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
    unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, providers),
    evidence,
    metrics: {},
    commodityMetrics: metrics,
    commodityProfile: {
      group: profile.group,
      classificationSource: profile.classificationSource,
      hierarchy: profile.hierarchy,
    },
    summary,
    limitations,
  };
}
