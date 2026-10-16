import type { UniversalEvidenceItem } from "./types";

export interface EquityFundamentalSource {
  provider: string;
  timestamp: number;
  symbol?: string;
  available: boolean;
  analystTargetPrice?: number;
  earningsPerShare?: number;
  latestEarnings?: { eps?: number };
  profitMargin?: number;
}

/**
 * Convert only fresh, exact-symbol equity fundamentals into bounded,
 * directional evidence. Provider availability alone is never evidence.
 * Financial metrics use separate dependency groups only when their
 * underlying sources are distinct; correlated earnings/financial metrics
 * remain weak and are capped by the analysis engine.
 */
export function buildEquityFundamentalEvidence(
  instrument: string,
  currentPrice: number | undefined,
  fundamentals: EquityFundamentalSource | undefined,
  now: number,
): UniversalEvidenceItem[] {
  if (!fundamentals?.available || !fundamentals.provider?.trim()) return [];
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const requested = normalize(instrument);
  const observedSymbol = typeof fundamentals.symbol === "string" ? normalize(fundamentals.symbol) : "";
  if (!requested || !observedSymbol || requested !== observedSymbol) return [];
  if (!Number.isFinite(fundamentals.timestamp) || fundamentals.timestamp <= 0 || fundamentals.timestamp > now) return [];
  const ageMs = now - fundamentals.timestamp;
  if (ageMs > 72 * 60 * 60 * 1000) return [];
  const freshness: UniversalEvidenceItem["freshness"] =
    ageMs <= 6 * 60 * 60 * 1000 ? "FRESH" : "DELAYED";
  const evidence: UniversalEvidenceItem[] = [];
  const base = {
    source: fundamentals.provider,
    quality: "VERIFIED" as const,
    freshness,
    providerAvailable: true,
    assetClass: "equity" as const,
    instrument,
  };

  if (
    Number.isFinite(currentPrice) && (currentPrice ?? 0) > 0 &&
    Number.isFinite(fundamentals.analystTargetPrice) && (fundamentals.analystTargetPrice ?? 0) > 0
  ) {
    const relativeGap = (fundamentals.analystTargetPrice! - currentPrice!) / currentPrice!;
    if (Math.abs(relativeGap) >= 0.05) {
      evidence.push({
        ...base,
        category: "VALUATION",
        direction: relativeGap > 0 ? "SUPPORTING" : "CONFLICTING",
        strength: Math.abs(relativeGap) >= 0.15 ? "MODERATE" : "WEAK",
        dependencyGroup: "EQUITY_VALUATION",
        explanation: `Provider analyst target is ${(relativeGap * 100).toFixed(1)}% ${relativeGap > 0 ? "above" : "below"} the observed market price; this is an estimate, not a guarantee.`,
      });
    }
  }

  // EPS, profit margin and P/E are already scored by the core
  // Fundamental layer. Do not add them again here as independent evidence.
  return evidence;
}
