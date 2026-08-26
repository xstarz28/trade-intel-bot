/**
 * Phase 41 — Crypto Intelligence Evidence Derivation
 *
 * Derives evidence items from the normalized crypto intelligence sub-contexts.
 *
 * CRITICAL DESIGN:
 *   1. Provider availability NEVER becomes directional evidence.
 *   2. All evidence is derived from ACTUAL data, never inferred from availability.
 *   3. Dependency groups prevent double-counting.
 *   4. Token unlocks are CONTEXT, not automatic bearish evidence.
 *   5. Derivatives data is CONTEXT, not simple bullish/bearish signals.
 *   6. DeFi fundamentals are CONTEXT for long-horizon analysis.
 *   7. This module contains NO decision logic.
 */

import type {
  CryptoEvidenceItem,
  DerivativesIntelligence,
  DeFiIntelligence,
  TokenomicsIntelligence,
  CryptoDependencyGroup,
} from "./types";

// ── Derivatives Evidence ────────────────────────────────────────

/**
 * Derive evidence from derivatives intelligence.
 * Returns evidence items — never modifies any external state.
 */
export function deriveDerivativesEvidence(
  derivatives: DerivativesIntelligence,
): CryptoEvidenceItem[] {
  const evidence: CryptoEvidenceItem[] = [];
  if (!derivatives.available) return evidence;

  // Open Interest evidence
  if (derivatives.openInterest?.reliable) {
    const oi = derivatives.openInterest;
    if (oi.change1h !== undefined) {
      const direction = Math.abs(oi.change1h) > 2
        ? oi.change1h > 0 ? "SUPPORTING" : "CONFLICTING"
        : "NEUTRAL";
      evidence.push({
        source: "CoinGlass",
        category: "DERIVATIVES",
        direction,
        strength: Math.abs(oi.change1h) > 5 ? "STRONG" : Math.abs(oi.change1h) > 2 ? "MODERATE" : "WEAK",
        quality: derivatives.quality,
        freshness: derivatives.freshness,
        dependencyGroup: "DERIVATIVES_OI",
        explanation: `Open interest ${oi.change1h > 0 ? "increased" : "decreased"} ${Math.abs(oi.change1h).toFixed(1)}% in 1h — ${Math.abs(oi.change1h) > 2 ? "notable" : "minor"} positioning change`,
        providerAvailable: true,
      });
    }
  }

  // Funding Rate evidence
  if (derivatives.fundingRate?.reliable) {
    const fr = derivatives.fundingRate;
    const direction = fr.isExtreme
      ? fr.currentRate > 0 ? "CONFLICTING" : "SUPPORTING"
      : "NEUTRAL";
    evidence.push({
      source: "CoinGlass",
      category: "DERIVATIVES",
      direction,
      strength: fr.isExtreme ? "MODERATE" : "WEAK",
      quality: derivatives.quality,
      freshness: derivatives.freshness,
      dependencyGroup: "DERIVATIVES_FUNDING",
      explanation: `Funding rate ${fr.currentRate > 0 ? "positive" : "negative"} at ${(fr.currentRate * 100).toFixed(4)}%${fr.isExtreme ? " (extreme — potential overcrowding)" : ""}`,
      providerAvailable: true,
    });
  }

  // Liquidation evidence
  if (derivatives.liquidation?.reliable) {
    const liq = derivatives.liquidation;
    const direction = liq.dominantSide && liq.dominantSide !== "balanced"
      ? liq.dominantSide === "longs" ? "CONFLICTING" : "SUPPORTING"
      : "NEUTRAL";
    evidence.push({
      source: "CoinGlass",
      category: "DERIVATIVES",
      direction,
      strength: liq.totalVolume && liq.totalVolume > 10_000_000 ? "MODERATE" : "WEAK",
      quality: derivatives.quality,
      freshness: derivatives.freshness,
      dependencyGroup: "DERIVATIVES_LIQUIDATION",
      explanation: `Liquidation context: ${liq.dominantSide ?? "balanced"} dominant${
        liq.totalVolume ? ` — $${(liq.totalVolume / 1e6).toFixed(1)}M total volume` : ""
      }`,
      providerAvailable: true,
    });
  }

  // Positioning evidence
  if (derivatives.positioning?.reliable) {
    const pos = derivatives.positioning;
    if (pos.accountRatio !== undefined) {
      const direction = pos.accountRatio > 1.5 || pos.accountRatio < 0.67
        ? pos.accountRatio > 1.5 ? "CONFLICTING" : "SUPPORTING"
        : "NEUTRAL";
      evidence.push({
        source: "CoinGlass",
        category: "DERIVATIVES",
        direction,
        strength: pos.accountRatio > 2 || pos.accountRatio < 0.5 ? "STRONG" : "WEAK",
        quality: derivatives.quality,
        freshness: derivatives.freshness,
        dependencyGroup: "DERIVATIVES_POSITIONING",
        explanation: `L/S ratio: ${pos.accountRatio.toFixed(2)}${
          pos.accountRatio > 1.5 ? " — retail heavily long (contrarian risk)" :
          pos.accountRatio < 0.67 ? " — retail heavily short (contrarian risk)" :
          " — balanced positioning"
        }`,
        providerAvailable: true,
      });
    }
  }

  return evidence;
}

// ── DeFi Fundamental Evidence ───────────────────────────────────

/**
 * Derive evidence from DeFi intelligence.
 * Returns evidence items — never modifies any external state.
 *
 * TVL rising ≠ guaranteed price increase.
 * TVL falling ≠ guaranteed price decrease.
 * These are fundamental health indicators, not price signals.
 */
export function deriveDeFiEvidence(
  defi: DeFiIntelligence,
): CryptoEvidenceItem[] {
  const evidence: CryptoEvidenceItem[] = [];
  if (!defi.available) return evidence;

  // TVL evidence
  if (defi.tvl?.reliable) {
    const tvl = defi.tvl;
    if (tvl.change7d !== undefined) {
      const direction = Math.abs(tvl.change7d) > 5
        ? tvl.change7d > 0 ? "SUPPORTING" : "CONFLICTING"
        : "NEUTRAL";
      evidence.push({
        source: "DeFiLlama",
        category: "DEFI_FUNDAMENTAL",
        direction,
        strength: Math.abs(tvl.change7d) > 15 ? "STRONG" : Math.abs(tvl.change7d) > 5 ? "MODERATE" : "WEAK",
        quality: defi.quality,
        freshness: defi.freshness,
        dependencyGroup: "DEFI_TVL",
        explanation: `TVL ${tvl.change7d > 0 ? "increased" : "decreased"} ${Math.abs(tvl.change7d).toFixed(1)}% over 7 days — ${
          tvl.change7d > 0 ? "growing ecosystem activity" : "declining ecosystem activity"
        }`,
        providerAvailable: true,
      });
    }
  }

  // Fees/Revenue evidence
  if (defi.fees?.reliable) {
    const fees = defi.fees;
    if (fees.dailyFees && fees.dailyFees > 0) {
      evidence.push({
        source: "DeFiLlama",
        category: "DEFI_FUNDAMENTAL",
        direction: "NEUTRAL",
        strength: "WEAK",
        quality: defi.quality,
        freshness: defi.freshness,
        dependencyGroup: "DEFI_FEES_REVENUE",
        explanation: `Daily fees: $${(fees.dailyFees / 1e3).toFixed(1)}K — protocol activity context`,
        providerAvailable: true,
      });
    }
  }

  return evidence;
}

// ── Tokenomics Evidence ─────────────────────────────────────────

/**
 * Derive evidence from tokenomics intelligence.
 * Returns evidence items — never modifies any external state.
 *
 * IMPORTANT: Token unlocks are CONTEXT, not automatic bearish evidence.
 * "Upcoming supply expansion is a potential supply-side risk;
 *  directional impact depends on unlock size, recipient behavior,
 *  liquidity, and prevailing market structure."
 */
export function deriveTokenomicsEvidence(
  tokenomics: TokenomicsIntelligence,
): CryptoEvidenceItem[] {
  const evidence: CryptoEvidenceItem[] = [];
  if (!tokenomics.available) return evidence;

  // Unlock evidence
  if (tokenomics.unlocks?.reliable) {
    const unlocks = tokenomics.unlocks;
    if (unlocks.upcomingCount30d > 0) {
      const strength = unlocks.unlockPercentOfCirculating
        ? unlocks.unlockPercentOfCirculating > 5 ? "STRONG" : unlocks.unlockPercentOfCirculating > 1 ? "MODERATE" : "WEAK"
        : "UNKNOWN";
      evidence.push({
        source: "Tokenomist",
        category: "TOKENOMICS",
        direction: "NEUTRAL",
        strength,
        quality: tokenomics.quality,
        freshness: tokenomics.freshness,
        dependencyGroup: "TOKENOMICS_UNLOCK",
        explanation: unlocks.summary ?? `${unlocks.upcomingCount30d} upcoming unlock event(s) in next 30 days — potential supply-side context`,
        providerAvailable: true,
      });
    } else {
      // No upcoming unlocks — still informational, not bullish
      evidence.push({
        source: "Tokenomist",
        category: "TOKENOMICS",
        direction: "NEUTRAL",
        strength: "WEAK",
        quality: tokenomics.quality,
        freshness: tokenomics.freshness,
        dependencyGroup: "TOKENOMICS_UNLOCK",
        explanation: "No upcoming token unlock events in next 30 days — no imminent supply expansion",
        providerAvailable: true,
      });
    }
  }

  // Supply evidence
  if (tokenomics.supply?.reliable) {
    const supply = tokenomics.supply;
    if (supply.circulatingPercent !== undefined) {
      evidence.push({
        source: "Tokenomist",
        category: "TOKENOMICS",
        direction: "NEUTRAL",
        strength: "WEAK",
        quality: tokenomics.quality,
        freshness: tokenomics.freshness,
        dependencyGroup: "TOKENOMICS_SUPPLY",
        explanation: `Circulating supply: ${supply.circulatingPercent.toFixed(1)}% of total — supply schedule context`,
        providerAvailable: true,
      });
    }
  }

  return evidence;
}

// ── Double-Counting Detection ───────────────────────────────────

/**
 * Detect double-counting across evidence items from the same dependency group.
 * Returns warnings for groups with multiple evidence items.
 */
export function detectDoubleCounting(
  evidence: CryptoEvidenceItem[],
): Array<{
  dependencyGroup: CryptoDependencyGroup;
  count: number;
  description: string;
}> {
  const groupCounts = new Map<CryptoDependencyGroup, CryptoEvidenceItem[]>();
  for (const item of evidence) {
    const existing = groupCounts.get(item.dependencyGroup) ?? [];
    existing.push(item);
    groupCounts.set(item.dependencyGroup, existing);
  }

  const warnings: Array<{
    dependencyGroup: CryptoDependencyGroup;
    count: number;
    description: string;
  }> = [];

  for (const [group, items] of groupCounts) {
    if (items.length > 1) {
      warnings.push({
        dependencyGroup: group,
        count: items.length,
        description: `${items.length} evidence items in group ${group} from same underlying data — should not be counted independently`,
      });
    }
  }

  return warnings;
}
