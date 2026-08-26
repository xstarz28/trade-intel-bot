/**
 * Phase 45 — Asset-Class Intelligence Engines
 *
 * Pure functions that transform raw provider data (or unavailable state)
 * into structured intelligence results with:
 *   - Enhanced evidence with provenance
 *   - Dependency groups for double-counting prevention
 *   - Missing information tracking
 *   - Data quality assessment
 *   - Analyst summaries
 *
 * CRITICAL:
 *   - All functions are PURE — no side effects, no network calls.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data remains missing.
 *   - Stale data remains stale.
 *   - These engines CANNOT modify bias, conviction, gates, trade plan,
 *     recommendation, or actionability.
 */

import type {
  AssetClass,
  DataCapability,
  EvidenceCategory,
  EvidenceDirection,
  EvidenceQuality,
  EvidenceStrength,
  FreshnessState,
  UniversalEvidenceItem,
} from "./types";

import type {
  EnhancedEvidenceItem,
  DataProvenance,
  ForexIntelligenceResult,
  EquityIntelligenceResult,
  CommodityIntelligenceResult,
  CrossAssetIntelligenceResult,
  UniversalIntelligenceResult,
} from "./engine-types";

import type {
  ForexIntelligenceContext,
  EquityIntelligenceContext,
  CommodityIntelligenceContext,
  CrossAssetIntelligenceContext,
  IntelligenceMeta,
} from "./types";

import { detectDoubleCounting } from "./evidence";
import { resolveInstrument as resolveInstrumentLocal } from "./instruments";

// ═══════════════════════════════════════════════════════════════
// EVIDENCE FACTORY
// ═══════════════════════════════════════════════════════════════

function buildEvidence(params: {
  source: string;
  category: EvidenceCategory;
  direction: EvidenceDirection;
  strength: EvidenceStrength;
  quality: EvidenceQuality;
  freshness: FreshnessState;
  dependencyGroup: string;
  explanation: string;
  providerAvailable: boolean;
  assetClass: AssetClass;
  instrument: string;
  observedAt: number;
  fromCache: boolean;
}): EnhancedEvidenceItem {
  const now = Date.now();
  return {
    source: params.source,
    category: params.category,
    direction: params.direction,
    strength: params.strength,
    quality: params.quality,
    freshness: params.freshness,
    dependencyGroup: params.dependencyGroup as any,
    explanation: params.explanation,
    providerAvailable: params.providerAvailable,
    assetClass: params.assetClass,
    instrument: params.instrument,
    observedAt: params.observedAt,
    assembledAt: now,
    provenance: {
      provider: params.source,
      observedAt: params.observedAt,
      fetchedAt: now,
      freshness: params.freshness,
      quality: params.quality,
      available: params.providerAvailable,
      instrument: params.instrument,
      instrumentVerified: true,
    },
    fromCache: params.fromCache,
  };
}

function buildUnavailableEvidence(params: {
  source: string;
  category: EvidenceCategory;
  dependencyGroup: string;
  assetClass: AssetClass;
  instrument: string;
  reason: string;
}): EnhancedEvidenceItem {
  const now = Date.now();
  return {
    source: params.source,
    category: params.category,
    direction: "UNAVAILABLE",
    strength: "UNKNOWN",
    quality: "UNAVAILABLE",
    freshness: "UNAVAILABLE",
    dependencyGroup: params.dependencyGroup as any,
    explanation: `${params.source}: ${params.reason}`,
    providerAvailable: false,
    assetClass: params.assetClass,
    instrument: params.instrument,
    observedAt: now,
    assembledAt: now,
    provenance: {
      provider: params.source,
      observedAt: now,
      fetchedAt: now,
      freshness: "UNAVAILABLE",
      quality: "UNAVAILABLE",
      available: false,
      failureReason: params.reason,
      instrument: params.instrument,
      instrumentVerified: false,
    },
    fromCache: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// FOREX INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

export function buildForexIntelligence(
  instrument: string,
  ctx: ForexIntelligenceContext,
): ForexIntelligenceResult {
  const evidence: EnhancedEvidenceItem[] = [];
  const provenance: DataProvenance[] = [];
  const missingInformation: string[] = [];
  const dataFlags: string[] = [];

  // Interest rates
  if (ctx.rates?.available) {
    evidence.push(buildEvidence({
      source: ctx.rates.provider,
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.rates.quality,
      freshness: ctx.rates.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `Interest rate differential: ${ctx.rates.rateDifferential !== undefined ? ctx.rates.rateDifferential.toFixed(1) + "bp" : "not computed"}. Rate differential is contextual evidence — not an automatic directional signal.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument,
      observedAt: ctx.rates.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.rates as any);
  } else if (ctx.rates?.failureReason) {
    evidence.push(buildUnavailableEvidence({
      source: ctx.rates.provider, category: "RATES",
      dependencyGroup: "MACRO_RATES", assetClass: "forex",
      instrument, reason: ctx.rates.failureReason,
    }));
    missingInformation.push("Interest rate data");
  } else {
    missingInformation.push("Interest rate data (no provider)");
  }

  // Yields
  if (ctx.yields?.available) {
    evidence.push(buildEvidence({
      source: ctx.yields.provider,
      category: "MACRO",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.yields.quality,
      freshness: ctx.yields.freshness,
      dependencyGroup: "MACRO_YIELD_CURVE",
      explanation: `Yield differential: ${ctx.yields.yieldDifferential !== undefined ? ctx.yields.yieldDifferential.toFixed(1) + "bp" : "N/A"}. Yield spreads provide carry and macro context.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument,
      observedAt: ctx.yields.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.yields as any);
  } else {
    missingInformation.push("Yield curve data");
  }

  // COT positioning
  if (ctx.positioning?.available) {
    evidence.push(buildEvidence({
      source: ctx.positioning.provider,
      category: "POSITIONING",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.positioning.quality,
      freshness: ctx.positioning.freshness,
      dependencyGroup: "MACRO_COT",
      explanation: `COT positioning: non-commercial net ${ctx.positioning.nonCommercialNet !== undefined ? ctx.positioning.nonCommercialNet.toFixed(0) : "N/A"}. Positioning is contextual — not an automatic directional signal.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument,
      observedAt: ctx.positioning.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.positioning as any);
  } else {
    missingInformation.push("CFTC COT positioning data");
  }

  // Macro calendar
  if (ctx.macro?.available) {
    evidence.push(buildEvidence({
      source: ctx.macro.provider,
      category: "MACRO",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.macro.quality,
      freshness: ctx.macro.freshness,
      dependencyGroup: "MACRO_CALENDAR",
      explanation: `Economic calendar: ${ctx.macro.upcomingEvents?.length ?? 0} upcoming events. Macro events provide risk context.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument,
      observedAt: ctx.macro.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.macro as any);
  } else {
    missingInformation.push("Economic calendar data");
  }

  // Cross-asset context
  if (ctx.crossAsset?.available) {
    evidence.push(buildEvidence({
      source: ctx.crossAsset.provider,
      category: "CROSS_ASSET",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.crossAsset.quality,
      freshness: ctx.crossAsset.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `DXY: ${ctx.crossAsset.dxyTrend ?? "unknown"}, risk regime: ${ctx.crossAsset.riskRegime ?? "unknown"}. Cross-asset context supports but does not determine FX direction.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument,
      observedAt: ctx.crossAsset.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.crossAsset as any);
  } else {
    missingInformation.push("Cross-asset / DXY context");
  }

  // Double-counting detection
  const dcWarnings = detectDoubleCounting(evidence);
  const dcFlags = dcWarnings.map((w) => `DOUBLE_COUNTING:${w.dependencyGroup}`);

  // Overall quality
  const qualities = provenance.filter((p) => p.available).map((p) => p.quality);
  const overallQuality: EvidenceQuality =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.includes("STALE") ? "STALE" :
    qualities.length > 0 ? "INSUFFICIENT" :
    "UNAVAILABLE";

  // totalCount includes all expected data sources (including those not attempted = undefined)
  const expectedSources = 5; // rates, yields, positioning, macro, crossAsset
  const availableCount = provenance.filter((p) => p.available).length;
  const totalCount = Math.max(provenance.length, expectedSources);
  const overallAvailability =
    totalCount === 0 ? "UNAVAILABLE" :
    availableCount >= totalCount * 0.8 ? "FULL" :
    availableCount >= totalCount * 0.4 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" :
    "UNAVAILABLE";

  return {
    instrument,
    assembledAt: Date.now(),
    evidence,
    provenance,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags: dcFlags,
    analystSummary: `Forex intelligence: ${availableCount}/${totalCount} data sources available. ${evidence.filter((e) => e.direction === "SUPPORTING").length} supporting, ${evidence.filter((e) => e.direction === "CONFLICTING").length} conflicting evidence items.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// EQUITY INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

export function buildEquityIntelligence(
  instrument: string,
  ctx: EquityIntelligenceContext,
): EquityIntelligenceResult {
  const evidence: EnhancedEvidenceItem[] = [];
  const provenance: DataProvenance[] = [];
  const missingInformation: string[] = [];
  const dataFlags: string[] = [];

  // Fundamentals
  if (ctx.fundamentals?.available) {
    const peStr = ctx.fundamentals.peRatio !== undefined ? `P/E ${ctx.fundamentals.peRatio.toFixed(1)}` : "P/E N/A";
    const revStr = ctx.fundamentals.revenueGrowth !== undefined ? `revenue growth ${(ctx.fundamentals.revenueGrowth * 100).toFixed(1)}%` : "revenue growth N/A";
    evidence.push(buildEvidence({
      source: ctx.fundamentals.provider,
      category: "FUNDAMENTALS",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.fundamentals.quality,
      freshness: ctx.fundamentals.freshness,
      dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS",
      explanation: `Fundamentals: ${peStr}, ${revStr}. Fundamental data provides valuation and activity context — not automatic directional signals.`,
      providerAvailable: true,
      assetClass: "equity",
      instrument,
      observedAt: ctx.fundamentals.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.fundamentals as any);
  } else if (ctx.fundamentals?.failureReason) {
    evidence.push(buildUnavailableEvidence({
      source: ctx.fundamentals.provider, category: "FUNDAMENTALS",
      dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS", assetClass: "equity",
      instrument, reason: ctx.fundamentals.failureReason,
    }));
    missingInformation.push("Fundamental data");
  } else {
    missingInformation.push("Fundamental data (no provider)");
  }

  // Earnings
  if (ctx.earnings?.available) {
    evidence.push(buildEvidence({
      source: ctx.earnings.provider,
      category: "EARNINGS",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.earnings.quality,
      freshness: ctx.earnings.freshness,
      dependencyGroup: "EQUITY_EARNINGS",
      explanation: `Earnings context: latest EPS ${ctx.earnings.latestEarnings?.eps?.toFixed(2) ?? "N/A"}, upcoming earnings ${ctx.earnings.upcomingEarnings?.date ?? "N/A"}. Earnings provide event context.`,
      providerAvailable: true,
      assetClass: "equity",
      instrument,
      observedAt: ctx.earnings.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.earnings as any);
  } else {
    missingInformation.push("Earnings data");
  }

  // Valuation
  if (ctx.valuation?.available) {
    evidence.push(buildEvidence({
      source: ctx.valuation.provider,
      category: "VALUATION",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.valuation.quality,
      freshness: ctx.valuation.freshness,
      dependencyGroup: "EQUITY_VALUATION",
      explanation: `Valuation: ${ctx.valuation.relativeValuation ?? "unknown"}. Valuation context supports but does not determine direction.`,
      providerAvailable: true,
      assetClass: "equity",
      instrument,
      observedAt: ctx.valuation.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.valuation as any);
  } else {
    missingInformation.push("Valuation data");
  }

  // Corporate actions
  if (ctx.corporateActions?.available) {
    evidence.push(buildEvidence({
      source: ctx.corporateActions.provider,
      category: "FUNDAMENTALS",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.corporateActions.quality,
      freshness: ctx.corporateActions.freshness,
      dependencyGroup: "EQUITY_DIVIDENDS",
      explanation: `Corporate actions: buybacks ${ctx.corporateActions.recentBuybacks ? "yes" : "no"}, dilution risk ${ctx.corporateActions.dilutionRisk ?? "unknown"}.`,
      providerAvailable: true,
      assetClass: "equity",
      instrument,
      observedAt: ctx.corporateActions.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.corporateActions as any);
  } else {
    missingInformation.push("Corporate actions data");
  }

  // Double-counting
  const dcWarnings = detectDoubleCounting(evidence);
  const dcFlags = dcWarnings.map((w) => `DOUBLE_COUNTING:${w.dependencyGroup}`);

  // Overall
  const qualities = provenance.filter((p) => p.available).map((p) => p.quality);
  const overallQuality: EvidenceQuality =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.includes("STALE") ? "STALE" :
    qualities.length > 0 ? "INSUFFICIENT" : "UNAVAILABLE";

  const availableCount = provenance.filter((p) => p.available).length;
  const totalCount = provenance.length;
  const overallAvailability =
    totalCount === 0 ? "UNAVAILABLE" :
    availableCount >= totalCount * 0.8 ? "FULL" :
    availableCount >= totalCount * 0.4 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" : "UNAVAILABLE";

  return {
    instrument,
    assembledAt: Date.now(),
    evidence,
    provenance,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags: dcFlags,
    analystSummary: `Equity intelligence: ${availableCount}/${totalCount} data sources available.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMMODITY INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

export function buildCommodityIntelligence(
  instrument: string,
  ctx: CommodityIntelligenceContext,
): CommodityIntelligenceResult {
  const evidence: EnhancedEvidenceItem[] = [];
  const provenance: DataProvenance[] = [];
  const missingInformation: string[] = [];
  const dataFlags: string[] = [];

  // Inventory
  if (ctx.inventory?.available) {
    evidence.push(buildEvidence({
      source: ctx.inventory.provider,
      category: "INVENTORY",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.inventory.quality,
      freshness: ctx.inventory.freshness,
      dependencyGroup: "COMMODITY_INVENTORY",
      explanation: `Inventory: ${ctx.inventory.currentInventory !== undefined ? (ctx.inventory.currentInventory / 1e6).toFixed(1) + "M bbl" : "N/A"}. Inventory level is supply context — not automatic directional signal.`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument,
      observedAt: ctx.inventory.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.inventory as any);
  } else if (ctx.inventory?.failureReason) {
    evidence.push(buildUnavailableEvidence({
      source: ctx.inventory.provider, category: "INVENTORY",
      dependencyGroup: "COMMODITY_INVENTORY", assetClass: "commodity",
      instrument, reason: ctx.inventory.failureReason,
    }));
    missingInformation.push("Inventory data");
  } else {
    missingInformation.push("Inventory data (no provider)");
  }

  // Supply/demand
  if (ctx.supplyDemand?.available) {
    evidence.push(buildEvidence({
      source: ctx.supplyDemand.provider,
      category: "SUPPLY_DEMAND",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.supplyDemand.quality,
      freshness: ctx.supplyDemand.freshness,
      dependencyGroup: "COMMODITY_SUPPLY_DEMAND",
      explanation: `Supply/demand: ${ctx.supplyDemand.supplyDemandContext ?? "context available"}. Supply-demand dynamics provide fundamental context.`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument,
      observedAt: ctx.supplyDemand.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.supplyDemand as any);
  } else {
    missingInformation.push("Supply/demand data");
  }

  // Futures structure
  if (ctx.futuresStructure?.available) {
    evidence.push(buildEvidence({
      source: ctx.futuresStructure.provider,
      category: "FUTURES_STRUCTURE",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.futuresStructure.quality,
      freshness: ctx.futuresStructure.freshness,
      dependencyGroup: "COMMODITY_FUTURES_STRUCTURE",
      explanation: `Futures structure: ${ctx.futuresStructure.structure ?? "unknown"}. Term structure reflects near-term supply expectations.`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument,
      observedAt: ctx.futuresStructure.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.futuresStructure as any);
  } else {
    missingInformation.push("Futures structure data");
  }

  // COT positioning
  if (ctx.positioning?.available) {
    evidence.push(buildEvidence({
      source: ctx.positioning.provider,
      category: "POSITIONING",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.positioning.quality,
      freshness: ctx.positioning.freshness,
      dependencyGroup: "COMMODITY_COT",
      explanation: `COT positioning: managed money net ${ctx.positioning.managedMoneyNet !== undefined ? ctx.positioning.managedMoneyNet.toFixed(0) : "N/A"}. Positioning is contextual.`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument,
      observedAt: ctx.positioning.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.positioning as any);
  } else {
    missingInformation.push("CFTC COT positioning data");
  }

  // Double-counting
  const dcWarnings = detectDoubleCounting(evidence);
  const dcFlags = dcWarnings.map((w) => `DOUBLE_COUNTING:${w.dependencyGroup}`);

  // Overall
  const qualities = provenance.filter((p) => p.available).map((p) => p.quality);
  const overallQuality: EvidenceQuality =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.includes("STALE") ? "STALE" :
    qualities.length > 0 ? "INSUFFICIENT" : "UNAVAILABLE";

  const availableCount = provenance.filter((p) => p.available).length;
  const totalCount = provenance.length;
  const overallAvailability =
    totalCount === 0 ? "UNAVAILABLE" :
    availableCount >= totalCount * 0.8 ? "FULL" :
    availableCount >= totalCount * 0.4 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" : "UNAVAILABLE";

  return {
    instrument,
    assembledAt: Date.now(),
    evidence,
    provenance,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags: dcFlags,
    analystSummary: `Commodity intelligence: ${availableCount}/${totalCount} data sources available.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-ASSET INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

export function buildCrossAssetIntelligence(
  ctx: CrossAssetIntelligenceContext,
): CrossAssetIntelligenceResult {
  const evidence: EnhancedEvidenceItem[] = [];
  const provenance: DataProvenance[] = [];
  const missingInformation: string[] = [];
  const dataFlags: string[] = [];

  // DXY
  if (ctx.dxy?.available) {
    evidence.push(buildEvidence({
      source: ctx.dxy.provider,
      category: "CROSS_ASSET",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.dxy.quality,
      freshness: ctx.dxy.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `DXY: ${ctx.dxy.value?.toFixed(1) ?? "N/A"}, trend: ${ctx.dxy.trend ?? "unknown"}. Dollar direction provides cross-asset context.`,
      providerAvailable: true,
      assetClass: "macro",
      instrument: "DXY",
      observedAt: ctx.dxy.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.dxy as any);
  } else if (ctx.dxy?.failureReason) {
    evidence.push(buildUnavailableEvidence({
      source: ctx.dxy.provider, category: "CROSS_ASSET",
      dependencyGroup: "MACRO_RATES", assetClass: "macro",
      instrument: "DXY", reason: ctx.dxy.failureReason,
    }));
    missingInformation.push("DXY data");
  } else {
    missingInformation.push("DXY data");
  }

  // Treasury yields
  if (ctx.treasury?.available) {
    evidence.push(buildEvidence({
      source: ctx.treasury.provider,
      category: "MACRO",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.treasury.quality,
      freshness: ctx.treasury.freshness,
      dependencyGroup: "MACRO_YIELD_CURVE",
      explanation: `Yields: 10Y ${ctx.treasury.tenYear?.toFixed(2) ?? "N/A"}%, curve ${ctx.treasury.yieldCurve ?? "unknown"}. Yield environment provides macro context.`,
      providerAvailable: true,
      assetClass: "macro",
      instrument: "DXY",
      observedAt: ctx.treasury.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.treasury as any);
  } else {
    missingInformation.push("Treasury yield data");
  }

  // Risk regime
  if (ctx.riskRegime?.available) {
    evidence.push(buildEvidence({
      source: ctx.riskRegime.provider,
      category: "CROSS_ASSET",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.riskRegime.quality,
      freshness: ctx.riskRegime.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `Risk regime: ${ctx.riskRegime.regime ?? "unknown"}. Regime context is descriptive, not predictive.`,
      providerAvailable: true,
      assetClass: "macro",
      instrument: "DXY",
      observedAt: ctx.riskRegime.observedAt,
      fromCache: false,
    }));
    provenance.push(ctx.riskRegime as any);
  } else {
    missingInformation.push("Risk regime data");
  }

  // Double-counting
  const dcWarnings = detectDoubleCounting(evidence);
  const dcFlags = dcWarnings.map((w) => `DOUBLE_COUNTING:${w.dependencyGroup}`);

  // Overall
  const qualities = provenance.filter((p) => p.available).map((p) => p.quality);
  const overallQuality: EvidenceQuality =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.length > 0 ? "INSUFFICIENT" : "UNAVAILABLE";

  const expectedSources = 3; // dxy, treasury, riskRegime
  const availableCount = provenance.filter((p) => p.available).length;
  const totalCount = Math.max(provenance.length, expectedSources);
  const overallAvailability =
    totalCount === 0 ? "UNAVAILABLE" :
    availableCount >= totalCount * 0.8 ? "FULL" :
    availableCount >= totalCount * 0.4 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" : "UNAVAILABLE";

  return {
    assembledAt: Date.now(),
    evidence,
    provenance,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags: dcFlags,
    analystSummary: `Cross-asset intelligence: ${availableCount}/${totalCount} data sources available.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INTELLIGENCE ASSEMBLER
// ═══════════════════════════════════════════════════════════════

/**
 * Assemble universal intelligence result from asset-class-specific results.
 */
export function assembleUniversalIntelligence(params: {
  instrument: string;
  forex?: ForexIntelligenceResult;
  equity?: EquityIntelligenceResult;
  commodity?: CommodityIntelligenceResult;
  crossAsset?: CrossAssetIntelligenceResult;
}): UniversalIntelligenceResult {
  const { instrument } = params;
  const canonical = resolveInstrumentLocal(instrument);
  const assetClass: AssetClass = canonical?.assetClass ?? "unknown" as AssetClass;

  const allEvidence: EnhancedEvidenceItem[] = [
    ...(params.forex?.evidence ?? []),
    ...(params.equity?.evidence ?? []),
    ...(params.commodity?.evidence ?? []),
    ...(params.crossAsset?.evidence ?? []),
  ];

  const allProvenance: DataProvenance[] = [
    ...(params.forex?.provenance ?? []),
    ...(params.equity?.provenance ?? []),
    ...(params.commodity?.provenance ?? []),
    ...(params.crossAsset?.provenance ?? []),
  ];

  const dcWarnings = detectDoubleCounting(allEvidence);
  const doubleCountingWarnings = dcWarnings.map((w) => w.message);

  const missingInformation = [
    ...(params.forex?.missingInformation ?? []),
    ...(params.equity?.missingInformation ?? []),
    ...(params.commodity?.missingInformation ?? []),
    ...(params.crossAsset?.missingInformation ?? []),
  ];

  const dataFlags = [
    ...(params.forex?.dataFlags ?? []),
    ...(params.equity?.dataFlags ?? []),
    ...(params.commodity?.dataFlags ?? []),
    ...(params.crossAsset?.dataFlags ?? []),
    ...doubleCountingWarnings.map((w) => `DOUBLE_COUNTING:${w}`),
  ];

  const allResults = [params.forex, params.equity, params.commodity, params.crossAsset].filter(Boolean);
  const availableCount = allResults.filter((r) => r!.overallAvailability !== "UNAVAILABLE").length;
  const overallAvailability =
    availableCount >= 3 ? "FULL" :
    availableCount >= 2 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" :
    "UNAVAILABLE";

  const qualities = allResults.map((r) => r!.overallQuality).filter(Boolean);
  const overallQuality: EvidenceQuality =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.length > 0 ? "INSUFFICIENT" : "UNAVAILABLE";

  const summaryParts = [
    params.forex ? `Forex: ${params.forex.overallAvailability}` : null,
    params.equity ? `Equity: ${params.equity.overallAvailability}` : null,
    params.commodity ? `Commodity: ${params.commodity.overallAvailability}` : null,
    params.crossAsset ? `Cross-Asset: ${params.crossAsset.overallAvailability}` : null,
  ].filter(Boolean);

  return {
    instrument,
    assetClass,
    assembledAt: Date.now(),
    forex: params.forex,
    equity: params.equity,
    commodity: params.commodity,
    crossAsset: params.crossAsset,
    allEvidence,
    allProvenance,
    doubleCountingWarnings,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags,
    analystSummary: summaryParts.join(" | ") || `No intelligence available for ${instrument}`,
  };
}
