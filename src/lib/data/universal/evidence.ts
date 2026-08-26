/**
 * Phase 44 — Universal Evidence Standardization & Intelligence Builder
 *
 * Provides:
 *   1. Universal evidence derivation (reusable across all asset classes)
 *   2. Double-counting detection via dependency groups
 *   3. Asset-class-specific intelligence context builders
 *   4. Universal intelligence context assembly
 *
 * CRITICAL DESIGN:
 *   - All functions are PURE — no side effects, no network calls.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data remains missing — never fabricated.
 *   - Stale data remains stale — never presented as fresh.
 *   - This module CANNOT modify bias, conviction, gates, trade plan,
 *     recommendation, or actionability.
 */

import type {
  AssetClass,
  CanonicalInstrument,
  DependencyGroup,
  EvidenceCategory,
  EvidenceDirection,
  EvidenceQuality,
  EvidenceStrength,
  FreshnessState,
  UniversalEvidenceItem,
  UniversalIntelligenceContext,
  ForexIntelligenceContext,
  EquityIntelligenceContext,
  CommodityIntelligenceContext,
  CrossAssetIntelligenceContext,
  IntelligenceMeta,
} from "./types";
import { resolveInstrument } from "./instruments";

// ═══════════════════════════════════════════════════════════════
// EVIDENCE FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Create a universal evidence item with all required fields.
 */
export function createEvidenceItem(params: {
  source: string;
  category: EvidenceCategory;
  direction: EvidenceDirection;
  strength: EvidenceStrength;
  quality: EvidenceQuality;
  freshness: FreshnessState;
  dependencyGroup: DependencyGroup;
  explanation: string;
  providerAvailable: boolean;
  assetClass: AssetClass;
  instrument: string;
}): UniversalEvidenceItem {
  return { ...params };
}

/**
 * Create an UNAVAILABLE evidence item.
 * Used when a provider cannot supply data for an instrument.
 * Provider unavailability NEVER becomes directional evidence.
 */
export function createUnavailableEvidence(params: {
  source: string;
  category: EvidenceCategory;
  dependencyGroup: DependencyGroup;
  assetClass: AssetClass;
  instrument: string;
  reason: string;
}): UniversalEvidenceItem {
  return {
    source: params.source,
    category: params.category,
    direction: "UNAVAILABLE",
    strength: "UNKNOWN",
    quality: "UNAVAILABLE",
    freshness: "UNAVAILABLE",
    dependencyGroup: params.dependencyGroup,
    explanation: `${params.source}: ${params.reason}`,
    providerAvailable: false,
    assetClass: params.assetClass,
    instrument: params.instrument,
  };
}

// ═══════════════════════════════════════════════════════════════
// DOUBLE-COUNTING DETECTION
// ═══════════════════════════════════════════════════════════════

export interface DoubleCountingWarning {
  dependencyGroup: DependencyGroup;
  evidenceCount: number;
  sources: string[];
  message: string;
}

/**
 * Detect evidence items that share the same dependency group.
 * These items originate from the same underlying data observation
 * and must NOT be counted as independent full-strength evidence.
 */
export function detectDoubleCounting(
  evidence: UniversalEvidenceItem[],
): DoubleCountingWarning[] {
  const byGroup = new Map<DependencyGroup, UniversalEvidenceItem[]>();

  for (const item of evidence) {
    const existing = byGroup.get(item.dependencyGroup) ?? [];
    existing.push(item);
    byGroup.set(item.dependencyGroup, existing);
  }

  const warnings: DoubleCountingWarning[] = [];

  for (const [group, items] of byGroup) {
    if (items.length > 1) {
      const sources = [...new Set(items.map((i) => i.source))];
      warnings.push({
        dependencyGroup: group,
        evidenceCount: items.length,
        sources,
        message: `${items.length} evidence items share dependency group "${group}" from source(s): ${sources.join(", ")}. These should not be counted as independent evidence.`,
      });
    }
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════
// ASSET-CLASS EVIDENCE DERIVATION
// ═══════════════════════════════════════════════════════════════

/**
 * Derive evidence from Forex intelligence context.
 */
export function deriveForexEvidence(
  ctx: ForexIntelligenceContext,
): UniversalEvidenceItem[] {
  const evidence: UniversalEvidenceItem[] = [];
  const inst = ctx.instrument;

  if (ctx.rates?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.rates.provider,
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.rates.quality,
      freshness: ctx.rates.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `Interest rate differential data available: ${ctx.rates.rateDifferential !== undefined ? `differential ${ctx.rates.rateDifferential.toFixed(2)}bp` : "differential not computed"}.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument: inst,
    }));
  } else if (ctx.rates?.failureReason) {
    evidence.push(createUnavailableEvidence({
      source: ctx.rates.provider,
      category: "RATES",
      dependencyGroup: "MACRO_RATES",
      assetClass: "forex",
      instrument: inst,
      reason: ctx.rates.failureReason,
    }));
  }

  if (ctx.yields?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.yields.provider,
      category: "MACRO",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.yields.quality,
      freshness: ctx.yields.freshness,
      dependencyGroup: "MACRO_YIELD_CURVE",
      explanation: `Yield differential: ${ctx.yields.yieldDifferential !== undefined ? ctx.yields.yieldDifferential.toFixed(2) + "bp" : "not computed"}.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument: inst,
    }));
  }

  if (ctx.positioning?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.positioning.provider,
      category: "POSITIONING",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.positioning.quality,
      freshness: ctx.positioning.freshness,
      dependencyGroup: "MACRO_COT",
      explanation: `COT positioning data available. ${ctx.positioning.positioningContext ?? ""}`,
      providerAvailable: true,
      assetClass: "forex",
      instrument: inst,
    }));
  }

  if (ctx.crossAsset?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.crossAsset.provider,
      category: "CROSS_ASSET",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.crossAsset.quality,
      freshness: ctx.crossAsset.freshness,
      dependencyGroup: "MACRO_RATES",
      explanation: `Cross-asset context: DXY ${ctx.crossAsset.dxyTrend ?? "unknown"}, risk regime ${ctx.crossAsset.riskRegime ?? "unknown"}.`,
      providerAvailable: true,
      assetClass: "forex",
      instrument: inst,
    }));
  }

  return evidence;
}

/**
 * Derive evidence from Equity intelligence context.
 */
export function deriveEquityEvidence(
  ctx: EquityIntelligenceContext,
): UniversalEvidenceItem[] {
  const evidence: UniversalEvidenceItem[] = [];
  const inst = ctx.instrument;

  if (ctx.fundamentals?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.fundamentals.provider,
      category: "FUNDAMENTALS",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.fundamentals.quality,
      freshness: ctx.fundamentals.freshness,
      dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS",
      explanation: `Fundamental data available: P/E ${ctx.fundamentals.peRatio?.toFixed(1) ?? "N/A"}, revenue growth ${ctx.fundamentals.revenueGrowth !== undefined ? (ctx.fundamentals.revenueGrowth * 100).toFixed(1) + "%" : "N/A"}.`,
      providerAvailable: true,
      assetClass: "equity",
      instrument: inst,
    }));
  }

  if (ctx.earnings?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.earnings.provider,
      category: "EARNINGS",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.earnings.quality,
      freshness: ctx.earnings.freshness,
      dependencyGroup: "EQUITY_EARNINGS",
      explanation: `Earnings data available. ${ctx.earnings.earningsContext ?? ""}`,
      providerAvailable: true,
      assetClass: "equity",
      instrument: inst,
    }));
  }

  if (ctx.valuation?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.valuation.provider,
      category: "VALUATION",
      direction: "NEUTRAL",
      strength: "WEAK",
      quality: ctx.valuation.quality,
      freshness: ctx.valuation.freshness,
      dependencyGroup: "EQUITY_VALUATION",
      explanation: `Valuation context: ${ctx.valuation.relativeValuation ?? "unknown"}. ${ctx.valuation.valuationContext ?? ""}`,
      providerAvailable: true,
      assetClass: "equity",
      instrument: inst,
    }));
  }

  return evidence;
}

/**
 * Derive evidence from Commodity intelligence context.
 */
export function deriveCommodityEvidence(
  ctx: CommodityIntelligenceContext,
): UniversalEvidenceItem[] {
  const evidence: UniversalEvidenceItem[] = [];
  const inst = ctx.instrument;

  if (ctx.inventory?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.inventory.provider,
      category: "INVENTORY",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.inventory.quality,
      freshness: ctx.inventory.freshness,
      dependencyGroup: "COMMODITY_INVENTORY",
      explanation: `Inventory data available. ${ctx.inventory.inventoryContext ?? ""}`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument: inst,
    }));
  }

  if (ctx.futuresStructure?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.futuresStructure.provider,
      category: "FUTURES_STRUCTURE",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.futuresStructure.quality,
      freshness: ctx.futuresStructure.freshness,
      dependencyGroup: "COMMODITY_FUTURES_STRUCTURE",
      explanation: `Futures structure: ${ctx.futuresStructure.structure ?? "unknown"}. ${ctx.futuresStructure.structureContext ?? ""}`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument: inst,
    }));
  }

  if (ctx.positioning?.available) {
    evidence.push(createEvidenceItem({
      source: ctx.positioning.provider,
      category: "POSITIONING",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: ctx.positioning.quality,
      freshness: ctx.positioning.freshness,
      dependencyGroup: "COMMODITY_COT",
      explanation: `COT positioning available. ${ctx.positioning.positioningContext ?? ""}`,
      providerAvailable: true,
      assetClass: "commodity",
      instrument: inst,
    }));
  }

  return evidence;
}

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE CONTEXT BUILDERS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute overall availability from IntelligenceMeta sub-contexts.
 */
function computeOverallAvailability(
  contexts: (IntelligenceMeta | undefined)[],
): "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE" {
  const available = contexts.filter((c) => c?.available).length;
  if (available === contexts.length) return "FULL";
  if (available >= contexts.length * 0.5) return "PARTIAL";
  if (available >= 1) return "MINIMAL";
  return "UNAVAILABLE";
}

/**
 * Compute overall quality from IntelligenceMeta sub-contexts.
 */
function computeOverallQuality(
  contexts: (IntelligenceMeta | undefined)[],
): EvidenceQuality {
  const qualities = contexts.filter((c) => c?.available).map((c) => c!.quality);
  if (qualities.includes("VERIFIED")) return "VERIFIED";
  if (qualities.includes("DEGRADED")) return "DEGRADED";
  if (qualities.includes("STALE")) return "STALE";
  if (qualities.length > 0) return "INSUFFICIENT";
  return "UNAVAILABLE";
}

/**
 * Collect missing information from IntelligenceMeta sub-contexts.
 */
function collectMissing(
  contexts: Record<string, IntelligenceMeta | undefined>,
  labels: Record<string, string>,
): string[] {
  const missing: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const ctx = contexts[key];
    if (!ctx?.available) {
      missing.push(label);
    }
  }
  return missing;
}

/**
 * Build universal intelligence context from asset-class-specific sub-context.
 * This is the final assembly step.
 */
export function buildUniversalIntelligenceContext(params: {
  instrument: string;
  forex?: ForexIntelligenceContext;
  equity?: EquityIntelligenceContext;
  commodity?: CommodityIntelligenceContext;
  crossAsset?: CrossAssetIntelligenceContext;
}): UniversalIntelligenceContext {
  const canonical = resolveInstrument(params.instrument);
  const assetClass = canonical?.assetClass ?? "unknown" as AssetClass;

  const assembledAt = Date.now();
  let evidence: UniversalEvidenceItem[] = [];
  let missingInformation: string[] = [];
  const parts: string[] = [];

  // Derive evidence and collect missing from each sub-context
  if (params.forex) {
    evidence = [...evidence, ...deriveForexEvidence(params.forex)];
    missingInformation = [...missingInformation, ...params.forex.missingInformation];
    parts.push(`Forex: ${params.forex.overallAvailability}`);
  }
  if (params.equity) {
    evidence = [...evidence, ...deriveEquityEvidence(params.equity)];
    missingInformation = [...missingInformation, ...params.equity.missingInformation];
    parts.push(`Equity: ${params.equity.overallAvailability}`);
  }
  if (params.commodity) {
    evidence = [...evidence, ...deriveCommodityEvidence(params.commodity)];
    missingInformation = [...missingInformation, ...params.commodity.missingInformation];
    parts.push(`Commodity: ${params.commodity.overallAvailability}`);
  }
  if (params.crossAsset) {
    evidence = [...evidence, ...params.crossAsset.evidence];
    missingInformation = [...missingInformation, ...params.crossAsset.missingInformation];
    parts.push(`Cross-Asset: ${params.crossAsset.overallAvailability}`);
  }

  // Detect double-counting
  const dcWarnings = detectDoubleCounting(evidence);
  const dataFlags = dcWarnings.map((w) => `DOUBLE_COUNTING:${w.dependencyGroup}`);

  // Compute overall quality
  const allMeta = [
    params.forex?.rates, params.forex?.yields, params.forex?.positioning,
    params.equity?.fundamentals, params.equity?.earnings,
    params.commodity?.inventory, params.commodity?.futuresStructure,
  ].filter(Boolean) as IntelligenceMeta[];

  const overallQuality = computeOverallQuality(allMeta);
  const overallAvailability =
    evidence.length > 5 ? "FULL" :
    evidence.length > 2 ? "PARTIAL" :
    evidence.length > 0 ? "MINIMAL" :
    "UNAVAILABLE";

  return {
    instrument: params.instrument,
    assetClass,
    assembledAt,
    forex: params.forex,
    equity: params.equity,
    commodity: params.commodity,
    crossAsset: params.crossAsset,
    evidence,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags,
    analystSummary: parts.join(" | ") || `No intelligence available for ${params.instrument}`,
  };
}
