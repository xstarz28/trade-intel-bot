/**
 * Phase 48 — INVESTOR FUNDAMENTAL OUTLOOK.
 *
 * Read-only, asset-class-aware evidence projection for the investor forecast.
 * It consumes existing provider-backed intelligence and never creates a
 * directional signal, fair value, probability, trade, or execution permission.
 *
 * Exact instrument identity, provider availability, quality, freshness, and
 * source timestamps are mandatory. Missing/stale evidence stays unavailable.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { UniversalEvidenceItem } from "@/lib/data/universal/types";
import type { CryptoEvidenceItem } from "@/lib/data/crypto/types";

export type InvestorValuationStatus =
  | "AVAILABLE"
  | "NOT_AVAILABLE"
  | "STALE"
  | "DEGRADED"
  | "INVALID";

export interface InvestorFundamentalEvidence {
  source: string;
  category: string;
  direction: string;
  strength: string;
  quality: string;
  freshness: string;
  dependencyGroup: string;
  explanation: string;
  /** Timestamp of the source sub-context, not the UI render time. */
  asOf: number;
}

export interface InvestorValuationReference {
  kind: "PROVIDER_INTRINSIC_VALUE" | "ANALYST_CONSENSUS_TARGET";
  price: number;
  source: string;
  asOf: number;
  upsidePct: number;
  description: string;
}

export interface InvestorFundamentalOutlook {
  evidenceStatus: "VERIFIED" | "DEGRADED" | "UNAVAILABLE";
  evidence: InvestorFundamentalEvidence[];
  valuationStatus: InvestorValuationStatus;
  valuationReference?: InvestorValuationReference;
  limitations: string[];
}

const MAX_VALUATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeInstrument(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function validTimestamp(value: unknown, notAfter: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= notAfter
    ? value
    : undefined;
}

function positiveFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function universalEvidenceAsOf(result: AnalysisResult, item: UniversalEvidenceItem): number | undefined {
  const context = result.universalIntelligenceContext;
  if (!context) return undefined;
  const category = item.category;
  const observedAt =
    category === "VALUATION" ? context.equity?.valuation?.observedAt ?? context.equity?.fundamentals?.observedAt :
    category === "EARNINGS" ? context.equity?.earnings?.observedAt :
    category === "INVENTORY" ? context.commodity?.inventory?.observedAt :
    category === "SUPPLY_DEMAND" ? context.commodity?.supplyDemand?.observedAt :
    category === "FUTURES_STRUCTURE" ? context.commodity?.futuresStructure?.observedAt :
    category === "RATES" || category === "CARRY" || category === "MONETARY_POLICY"
      ? context.forex?.rates?.observedAt ?? context.forex?.yields?.observedAt ?? context.forex?.positioning?.observedAt ?? context.forex?.macro?.observedAt
      : context.assembledAt;
  return validTimestamp(observedAt, result.timestamp);
}

function mapUniversalEvidence(result: AnalysisResult): InvestorFundamentalEvidence[] {
  const context = result.universalIntelligenceContext;
  if (!context || normalizeInstrument(context.instrument) !== normalizeInstrument(result.instrument)) return [];
  return context.evidence.flatMap((item) => {
    if (
      !item.providerAvailable ||
      normalizeInstrument(item.instrument) !== normalizeInstrument(result.instrument) ||
      (item.freshness !== "FRESH" && item.freshness !== "DELAYED") ||
      (item.quality !== "VERIFIED" && item.quality !== "DEGRADED") ||
      item.direction === "UNAVAILABLE"
    ) return [];
    const asOf = universalEvidenceAsOf(result, item);
    if (asOf === undefined) return [];
    return [{
      source: item.source,
      category: item.category,
      direction: item.direction,
      strength: item.strength,
      quality: item.quality,
      freshness: item.freshness,
      dependencyGroup: item.dependencyGroup,
      explanation: item.explanation,
      asOf,
    }];
  });
}

function cryptoEvidenceAsOf(result: AnalysisResult, item: CryptoEvidenceItem): number | undefined {
  const context = result.cryptoIntelligenceContext;
  if (!context) return undefined;
  const category = item.category;
  const observedAt = category.startsWith("DERIVATIVES")
    ? context.derivatives?.observedAt
    : category.startsWith("DEFI")
      ? context.defi?.observedAt
      : category.startsWith("TOKENOMICS")
        ? context.tokenomics?.observedAt
        : context.assembledAt;
  return validTimestamp(observedAt, result.timestamp);
}

function mapCryptoEvidence(result: AnalysisResult): InvestorFundamentalEvidence[] {
  const context = result.cryptoIntelligenceContext;
  if (!context || normalizeInstrument(context.instrument) !== normalizeInstrument(result.instrument)) return [];
  return context.evidence.flatMap((item) => {
    if (
      !item.providerAvailable ||
      (item.freshness !== "FRESH" && item.freshness !== "DELAYED") ||
      (item.quality !== "VERIFIED" && item.quality !== "DEGRADED") ||
      item.direction === "UNAVAILABLE"
    ) return [];
    const asOf = cryptoEvidenceAsOf(result, item);
    if (asOf === undefined) return [];
    return [{
      source: item.source,
      category: item.category,
      direction: item.direction,
      strength: item.strength,
      quality: item.quality,
      freshness: item.freshness,
      dependencyGroup: item.dependencyGroup,
      explanation: item.explanation,
      asOf,
    }];
  });
}

function buildValuationReference(
  result: AnalysisResult,
  spot: number | undefined,
): { status: InvestorValuationStatus; reference?: InvestorValuationReference } {
  if (result.instrumentType !== "stock" || spot === undefined) return { status: "NOT_AVAILABLE" };
  const instrument = normalizeInstrument(result.instrument);
  const universal = result.universalIntelligenceContext;
  const equity = universal?.assetClass === "equity" &&
    normalizeInstrument(universal.instrument) === instrument
    && universal.equity && normalizeInstrument(universal.equity.instrument) === instrument
    ? universal.equity
    : undefined;
  const valuation = equity?.valuation;

  if (valuation?.available && valuation.provider?.trim()) {
    const asOf = validTimestamp(valuation.observedAt, result.timestamp);
    if (asOf === undefined || result.timestamp - asOf > MAX_VALUATION_AGE_MS) {
      // A separately verified analyst target may still be used below.
    } else if (valuation.quality === "DEGRADED") {
      // Do not publish a numeric valuation reference from degraded evidence.
    } else if (valuation.quality === "VERIFIED" && (valuation.freshness === "FRESH" || valuation.freshness === "DELAYED")) {
      const intrinsicValue = positiveFinite(valuation.intrinsicValue);
      if (intrinsicValue !== undefined) {
        return {
          status: "AVAILABLE",
          reference: {
            kind: "PROVIDER_INTRINSIC_VALUE",
            price: intrinsicValue,
            source: valuation.provider,
            asOf,
            upsidePct: ((intrinsicValue / spot) - 1) * 100,
            description: "Provider-supplied intrinsic-value estimate; not a guaranteed fair value or expected return.",
          },
        };
      }
    }
  }

  const fundamental = result.fundamentalData;
  if (
    fundamental?.available &&
    fundamental.instrumentType === "stock" &&
    normalizeInstrument(fundamental.symbol) === instrument &&
    typeof fundamental.provider === "string" &&
    fundamental.provider.trim()
  ) {
    const asOf = validTimestamp(fundamental.timestamp, result.timestamp);
    if (asOf !== undefined && result.timestamp - asOf <= MAX_VALUATION_AGE_MS) {
      const target = positiveFinite(fundamental.analystTargetPrice);
      if (target !== undefined) {
        return {
          status: "AVAILABLE",
          reference: {
            kind: "ANALYST_CONSENSUS_TARGET",
            price: target,
            source: fundamental.provider,
            asOf,
            upsidePct: ((target / spot) - 1) * 100,
            description: "Provider-reported analyst consensus target; not intrinsic value or a guaranteed return.",
          },
        };
      }
      if (fundamental.analystTargetPrice !== undefined) return { status: "INVALID" };
    } else {
      return { status: "STALE" };
    }
  }

  if (valuation?.available && valuation.quality === "DEGRADED") return { status: "DEGRADED" };
  if (valuation?.available && (!positiveFinite(valuation.intrinsicValue) && valuation.intrinsicValue !== undefined)) {
    return { status: "INVALID" };
  }
  if (valuation?.available && (!validTimestamp(valuation.observedAt, result.timestamp) ||
    result.timestamp - (valuation.observedAt ?? 0) > MAX_VALUATION_AGE_MS)) return { status: "STALE" };
  return { status: "NOT_AVAILABLE" };
}

/** Build investor-facing fundamentals without allowing them to alter the trading decision. */
export function buildInvestorFundamentalOutlook(result: AnalysisResult, spot?: number): InvestorFundamentalOutlook {
  const evidence = [...mapUniversalEvidence(result), ...mapCryptoEvidence(result)];
  const valuation = buildValuationReference(result, spot);
  const hasDegraded = evidence.some((item) => item.quality === "DEGRADED");
  return {
    evidenceStatus: evidence.length === 0 ? "UNAVAILABLE" : hasDegraded ? "DEGRADED" : "VERIFIED",
    evidence,
    valuationStatus: valuation.status,
    valuationReference: valuation.reference,
    limitations: [
      "Fundamental evidence is asset-class-specific context; it does not independently establish a calibrated price forecast or win probability.",
      "A provider intrinsic-value estimate or analyst consensus target is a sourced reference, not a guaranteed fair value or expected return.",
      "Stale, unavailable, or mismatched evidence is excluded; degraded evidence may remain contextual but cannot produce a numeric valuation reference.",
    ],
  };
}
