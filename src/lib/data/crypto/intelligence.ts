/**
 * Phase 41 — Crypto Intelligence Context Builder
 *
 * Assembles the complete CryptoIntelligenceContext from sub-provider results.
 *
 * CRITICAL DESIGN:
 *   1. This is a PURE function — no side effects, no network calls.
 *   2. Provider availability NEVER becomes directional evidence.
 *   3. Missing data remains neutral.
 *   4. All evidence is derived from actual data.
 *   5. This module CANNOT modify bias, conviction, gates, trade plan,
 *      recommendation, or actionability.
 *   6. This module is informational only for the existing decision engine.
 */

import type {
  CryptoIntelligenceContext,
  CryptoEvidenceItem,
  DerivativesIntelligence,
  DeFiIntelligence,
  TokenomicsIntelligence,
} from "./types";
import {
  deriveDerivativesEvidence,
  deriveDeFiEvidence,
  deriveTokenomicsEvidence,
  detectDoubleCounting,
} from "./evidence";
import { isCryptoInstrument } from "./symbols";

/**
 * Build the combined CryptoIntelligenceContext from sub-provider results.
 *
 * @param instrument - Canonical instrument string (e.g. "BTC/USD")
 * @param derivatives - CoinGlass derivatives intelligence (optional)
 * @param defi - DeFiLlama fundamental intelligence (optional)
 * @param tokenomics - Tokenomist tokenomics intelligence (optional)
 */
export function buildCryptoIntelligenceContext(
  instrument: string,
  derivatives?: DerivativesIntelligence,
  defi?: DeFiIntelligence,
  tokenomics?: TokenomicsIntelligence,
): CryptoIntelligenceContext | null {
  // Non-crypto instruments: explicitly not applicable
  if (!isCryptoInstrument(instrument)) {
    return null;
  }

  const assembledAt = Date.now();

  // Derive evidence from all available sub-contexts
  const evidence: CryptoEvidenceItem[] = [
    ...deriveDerivativesEvidenceFromOptional(derivatives),
    ...deriveDeFiEvidenceFromOptional(defi),
    ...deriveTokenomicsEvidenceFromOptional(tokenomics),
  ];

  // Detect double-counting
  const doubleCounting = detectDoubleCounting(evidence);

  // Compute overall availability
  const availableCount = [derivatives?.available, defi?.available, tokenomics?.available].filter(Boolean).length;
  const totalCount = 3;
  const overallAvailability: CryptoIntelligenceContext["overallAvailability"] =
    availableCount === 3 ? "FULL" :
    availableCount >= 2 ? "PARTIAL" :
    availableCount >= 1 ? "MINIMAL" :
    "UNAVAILABLE";

  // Compute overall quality
  const qualities = [derivatives?.quality, defi?.quality, tokenomics?.quality].filter(Boolean);
  const overallQuality: CryptoIntelligenceContext["overallQuality"] =
    qualities.includes("VERIFIED") ? "VERIFIED" :
    qualities.includes("DEGRADED") ? "DEGRADED" :
    qualities.includes("STALE") ? "STALE" :
    qualities.length > 0 ? "INSUFFICIENT" :
    "UNAVAILABLE";

  // Collect missing information
  const missingInformation: string[] = [];
  if (!derivatives?.available) missingInformation.push("Derivatives data (CoinGlass)");
  if (!defi?.available) missingInformation.push("DeFi fundamentals (DeFiLlama)");
  if (!tokenomics?.available) missingInformation.push("Tokenomics data (Tokenomist)");
  if (derivatives && !derivatives.openInterest?.reliable) missingInformation.push("Reliable open interest data");
  if (derivatives && !derivatives.fundingRate?.reliable) missingInformation.push("Reliable funding rate data");
  if (defi && !defi.tvl?.reliable) missingInformation.push("Reliable TVL data");
  if (tokenomics && !tokenomics.unlocks?.reliable) missingInformation.push("Reliable token unlock data");

  // Collect data flags
  const dataFlags: string[] = [];
  if (doubleCounting.length > 0) {
    dataFlags.push(...doubleCounting.map((dc) => `DOUBLE_COUNTING:${dc.dependencyGroup}`));
  }
  if (derivatives?.freshness === "STALE") dataFlags.push("STALE_DERIVATIVES");
  if (defi?.freshness === "STALE") dataFlags.push("STALE_DEFI");
  if (tokenomics?.freshness === "STALE") dataFlags.push("STALE_TOKENOMICS");

  // Build analyst summary
  const parts: string[] = [];
  if (derivatives?.available) {
    parts.push(`Derivatives: ${derivatives.availableDatasets}/${derivatives.totalDatasets} datasets available`);
  }
  if (defi?.available) {
    parts.push(`DeFi: TVL $${defi.tvl ? (defi.tvl.current / 1e9).toFixed(2) + "B" : "N/A"}`);
  }
  if (tokenomics?.available) {
    parts.push(`Tokenomics: ${tokenomics.unlocks?.upcomingCount30d ?? 0} upcoming unlocks`);
  }
  if (evidence.length > 0) {
    const supporting = evidence.filter((e) => e.direction === "SUPPORTING").length;
    const conflicting = evidence.filter((e) => e.direction === "CONFLICTING").length;
    parts.push(`Evidence: ${supporting} supporting, ${conflicting} conflicting`);
  }
  if (missingInformation.length > 0) {
    parts.push(`Missing: ${missingInformation.length} data source(s)`);
  }

  return {
    instrument,
    instrumentType: "crypto",
    assembledAt,
    derivatives,
    defi,
    tokenomics,
    evidence,
    overallAvailability,
    overallQuality,
    missingInformation,
    dataFlags,
    analystSummary: parts.join(" | ") || "No crypto intelligence available",
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function deriveDerivativesEvidenceFromOptional(
  derivatives?: DerivativesIntelligence,
): CryptoEvidenceItem[] {
  if (!derivatives?.available) return [];
  return deriveDerivativesEvidence(derivatives);
}

function deriveDeFiEvidenceFromOptional(
  defi?: DeFiIntelligence,
): CryptoEvidenceItem[] {
  if (!defi?.available) return [];
  return deriveDeFiEvidence(defi);
}

function deriveTokenomicsEvidenceFromOptional(
  tokenomics?: TokenomicsIntelligence,
): CryptoEvidenceItem[] {
  if (!tokenomics?.available) return [];
  return deriveTokenomicsEvidence(tokenomics);
}
