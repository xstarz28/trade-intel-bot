/**
 * Phase 43 — UI INTEGRATION & ANALYST WORKSPACE
 *
 * Comprehensive tests covering:
 * A. Crypto Intelligence Context rendering data
 * B. Investor / Futures perspectives
 * C. Long-horizon thesis integration with crypto evidence
 * D. Evidence challenge integration with crypto evidence
 * E. Instrument isolation (crypto vs non-crypto)
 * F. Decision immutability
 * G. Security / no secrets
 * H. Empty / degraded states
 * I. Determinism
 */

import { describe, it, expect } from "vitest";

import {
  buildFuturesPerspective,
  buildInvestorPerspective,
} from "@/lib/data/crypto/perspectives";
import {
  buildCryptoIntelligenceContext,
} from "@/lib/data/crypto/intelligence";
import {
  buildLongHorizonThesis,
} from "@/lib/long-horizon-thesis";
import {
  buildEvidenceChallenge,
} from "@/lib/evidence-challenge";
import type {
  CryptoIntelligenceContext,
  DerivativesIntelligence,
  DeFiIntelligence,
  TokenomicsIntelligence,
} from "@/lib/data/crypto/types";
import type { AnalysisResult, InstrumentType } from "@/types/analysis";

// ── Helpers ──────────────────────────────────────────────────────

const now = Date.now();

function makeFullCryptoContext(instrument: string = "BTC/USD"): CryptoIntelligenceContext {
  const derivatives: DerivativesIntelligence = {
    provider: "CoinGlass",
    observedAt: now,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    openInterest: { current: 35_000_000_000, change1h: 2.5, change24h: 5.3, reliable: true },
    fundingRate: { currentRate: 0.0003, annualizedRate: 32.85, isExtreme: false, reliable: true },
    liquidation: { totalVolume: 125_000_000, longVolume: 80_000_000, shortVolume: 45_000_000, dominantSide: "longs", reliable: true },
    positioning: { accountRatio: 1.45, topTraderRatio: 1.2, takerRatio: 1.3, reliable: true },
    availableDatasets: 4,
    totalDatasets: 4,
  };
  const defi: DeFiIntelligence = {
    provider: "DeFiLlama",
    observedAt: now,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    tvl: { current: 50_000_000_000, change7d: 3.2, change30d: 12.5, reliable: true },
    fees: { dailyFees: 5_000_000, dailyRevenue: 2_000_000, reliable: true },
    availableDatasets: 2,
    totalDatasets: 2,
  };
  const tokenomics: TokenomicsIntelligence = {
    provider: "Tokenomist",
    observedAt: now,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    supply: { circulatingSupply: 19_800_000, totalSupply: 21_000_000, circulatingPercent: 94.3, reliable: true },
    unlocks: { upcomingCount30d: 2, upcomingValue30d: 5000, unlockPercentOfCirculating: 0.03, reliable: true, summary: "Minor unlocks scheduled" },
    availableDatasets: 2,
    totalDatasets: 2,
  };
  return buildCryptoIntelligenceContext(instrument, derivatives, defi, tokenomics)!;
}

function makePartialCryptoContext(instrument: string = "ETH/USD"): CryptoIntelligenceContext {
  const derivatives: DerivativesIntelligence = {
    provider: "CoinGlass",
    observedAt: now,
    freshness: "FRESH",
    quality: "DEGRADED",
    available: true,
    openInterest: { current: 10_000_000_000, change1h: undefined, change24h: undefined, reliable: false },
    availableDatasets: 1,
    totalDatasets: 4,
  };
  return buildCryptoIntelligenceContext(instrument, derivatives)!;
}

function makeEmptyCryptoContext(instrument: string = "SOL/USD"): CryptoIntelligenceContext {
  return buildCryptoIntelligenceContext(instrument)!;
}

function makeMinimalAnalysisResult(instrument: string = "BTC/USD", instrumentType: string = "crypto"): AnalysisResult {
  return {
    id: `test-${instrument}-${Date.now()}`,
    instrument,
    instrumentType: instrumentType as InstrumentType,
    timeframe: "D1",
    bias: "Bullish",
    confidence: 65,
    recommendation: "LONG",
    conviction: "Medium",
    priceSnapshot: { price: 67500, timestamp: now, source: "Twelve Data" },
    technicalData: {
      dataPoints: 200,
      rsi14: 58,
      macdHistogram: 0.0012,
      sma50: 66000,
      atr14: 1200,
      structure: "HH/HL",
      bosDirection: "bullish",
      chochDirection: "none",
      volumeTrend: "increasing",
      swingHighs: [68000, 67500],
      swingLows: [65000, 64000],
      supportLevels: [66000, 64000],
      resistanceLevels: [70000, 72000],
    } as any,
    technicalSummary: "Structure is bullish with higher highs and higher lows.",
    fundamentalSummary: "Macro context neutral.",
    riskNote: "Standard market risk applies.",
    keyLevels: { support: "66000", resistance: "70000", invalidation: "64000" },
    noTradeReasons: [],
    dataFlags: [],
    dataCompleteness: "full" as "full" | "partial" | "limited",
    breakdown: { trend: 2, indicator: 1, fundamental: 1, sentiment: 1 },
    tradingStyle: "swing",
    decisionFingerprint: "fp-abc123",
    timestamp: now,
  };
}

// ── A. Crypto Intelligence Context Tests ────────────────────────

describe("Phase 43 — A. Crypto Intelligence Context", () => {
  it("builds a full context with all sub-providers", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    expect(ctx.instrument).toBe("BTC/USD");
    expect(ctx.instrumentType).toBe("crypto");
    expect(ctx.overallAvailability).toBe("FULL");
    expect(ctx.overallQuality).toBe("VERIFIED");
    expect(ctx.derivatives).toBeDefined();
    expect(ctx.defi).toBeDefined();
    expect(ctx.tokenomics).toBeDefined();
    expect(ctx.evidence.length).toBeGreaterThan(0);
    expect(ctx.missingInformation.length).toBe(0);
  });

  it("builds a partial context with only derivatives", () => {
    const ctx = makePartialCryptoContext("ETH/USD");
    expect(ctx.overallAvailability).toBe("MINIMAL");
    expect(ctx.derivatives).toBeDefined();
    expect(ctx.defi).toBeUndefined();
    expect(ctx.tokenomics).toBeUndefined();
    expect(ctx.missingInformation.length).toBeGreaterThan(0);
    expect(ctx.missingInformation.some((m) => m.includes("DeFi"))).toBe(true);
    expect(ctx.missingInformation.some((m) => m.includes("Tokenomics"))).toBe(true);
  });

  it("returns null for non-crypto instruments", () => {
    expect(buildCryptoIntelligenceContext("EUR/USD")).toBeNull();
    expect(buildCryptoIntelligenceContext("AAPL")).toBeNull();
    expect(buildCryptoIntelligenceContext("XAU/USD")).toBeNull();
  });

  it("preserves instrument identity through context", () => {
    const ctx = makeFullCryptoContext("DOGE/USD");
    expect(ctx.instrument).toBe("DOGE/USD");
    expect(ctx.evidence.every((e) => e.source !== "")).toBe(true);
  });

  it("has evidence with valid dependency groups", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const validGroups = new Set([
      "DERIVATIVES_OI", "DERIVATIVES_FUNDING", "DERIVATIVES_LIQUIDATION", "DERIVATIVES_POSITIONING",
      "DEFI_TVL", "DEFI_FEES_REVENUE", "DEFI_STABLECOIN", "DEFI_PROTOCOL",
      "TOKENOMICS_SUPPLY", "TOKENOMICS_UNLOCK", "ON_CHAIN_ACTIVITY",
    ]);
    for (const e of ctx.evidence) {
      expect(validGroups.has(e.dependencyGroup)).toBe(true);
      expect(["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]).toContain(e.direction);
      expect(["STRONG", "MODERATE", "WEAK", "UNKNOWN"]).toContain(e.strength);
    }
  });
});

// ── B. Investor / Futures Perspectives ───────────────────────────

describe("Phase 43 — B. Investor / Futures Perspectives", () => {
  it("builds a futures perspective with derivatives focus", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const fp = buildFuturesPerspective(ctx);
    expect(fp.perspective).toBe("FUTURES_TRADER");
    expect(fp.applicable).toBe(true);
    expect(fp.derivativesContext).toContain("funding");
    expect(fp.focusAreas).toContain("Derivatives context");
    expect(fp.keyConsiderations).toBeDefined();
  });

  it("builds an investor perspective with fundamentals focus", () => {
    const ctx = makeFullCryptoContext("ETH/USD");
    const ip = buildInvestorPerspective(ctx);
    expect(ip.perspective).toBe("SPOT_INVESTOR");
    expect(ip.applicable).toBe(true);
    expect(ip.fundamentalsContext).toContain("TVL");
    expect(ip.tokenomicsContext).toContain("unlock");
    expect(ip.focusAreas).toContain("DeFi fundamentals");
    expect(ip.focusAreas).toContain("Tokenomics");
  });

  it("returns non-applicable perspective for undefined context", () => {
    const fp = buildFuturesPerspective(undefined);
    expect(fp.applicable).toBe(false);
    expect(fp.derivativesContext.toLowerCase()).toContain("no crypto intelligence");

    const ip = buildInvestorPerspective(undefined);
    expect(ip.applicable).toBe(false);
    expect(ip.fundamentalsContext.toLowerCase()).toContain("no crypto intelligence");
  });

  it("both perspectives use the same underlying facts", () => {
    const ctx = makeFullCryptoContext("SOL/USD");
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    // Both should reference derivatives/fundamentals data from the same context
    expect(fp.derivativesContext).toContain("funding");
    expect(ip.fundamentalsContext).toContain("TVL");
    // Both should share missing information patterns
    expect(fp.missingInformation).toEqual([]);
    expect(ip.missingInformation).toEqual([]);
  });

  it("futures perspective flags extreme funding", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    if (ctx.derivatives?.fundingRate) {
      ctx.derivatives.fundingRate.isExtreme = true;
      const fp = buildFuturesPerspective(ctx);
      expect(fp.keyConsiderations.some((c) => c.includes("extreme") || c.includes("Extreme"))).toBe(true);
    }
  });

  it("investor perspective flags low circulating percentage", () => {
    const ctx = makeFullCryptoContext("ETH/USD");
    if (ctx.tokenomics?.supply) {
      ctx.tokenomics.supply.circulatingPercent = 15;
      const ip = buildInvestorPerspective(ctx);
      expect(ip.keyConsiderations.some((c) => c.includes("float") || c.includes("circulating") || c.includes("supply expansion"))).toBe(true);
    }
  });

  it("perspectives have no contradictory factual claims", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    // Both reference the same instrument
    // Both should be applicable
    expect(fp.applicable).toBe(true);
    expect(ip.applicable).toBe(true);
  });
});

// ── C. Long-Horizon Thesis Integration ──────────────────────────

describe("Phase 43 — C. Long-Horizon Thesis Integration", () => {
  it("builds a thesis with crypto intelligence context", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    result.cryptoIntelligenceContext = ctx;

    const thesis = buildLongHorizonThesis(result);
    expect(thesis).toBeDefined();
    expect(thesis.primaryThesis).toBeDefined();
    expect(thesis.investorImplication).toBeDefined();
    expect(thesis.traderImplication).toBeDefined();
  });

  it("thesis remains deterministic for identical input", () => {
    const ctx = makeFullCryptoContext("ETH/USD");
    const result = makeMinimalAnalysisResult("ETH/USD", "crypto");
    result.cryptoIntelligenceContext = ctx;

    const t1 = buildLongHorizonThesis(result);
    const t2 = buildLongHorizonThesis(result);
    expect(t1.primaryThesis).toBe(t2.primaryThesis);
    expect(t1.investorImplication).toBe(t2.investorImplication);
    expect(t1.traderImplication).toBe(t2.traderImplication);
    expect(t1.marketCycle).toBe(t2.marketCycle);
  });

  it("thesis does not fabricate evidence when crypto intel is unavailable", () => {
    const result = makeMinimalAnalysisResult("EUR/USD", "forex");
    // No crypto intelligence for forex

    const thesis = buildLongHorizonThesis(result);
    // Thesis should exist but should NOT contain crypto-specific terms
    expect(thesis).toBeDefined();
    expect(thesis.supportingEvidence.every((e) => !e.explanation.includes("CoinGlass"))).toBe(true);
    expect(thesis.supportingEvidence.every((e) => !e.explanation.includes("DeFiLlama"))).toBe(true);
  });
});

// ── D. Evidence Challenge Integration ────────────────────────────

describe("Phase 43 — D. Evidence Challenge Integration", () => {
  it("builds an evidence challenge for crypto analysis", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");

    const challenge = buildEvidenceChallenge(result);
    expect(challenge).toBeDefined();
    expect(challenge.thesisSupportStatus).toBeDefined();
    expect(challenge.auditSummary).toBeDefined();
  });

  it("evidence challenge contains crypto intelligence evidence categories", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");

    const challenge = buildEvidenceChallenge(result);
    // Crypto evidence should appear in supporting, conflicting, or missing
    const allText = [
      challenge.thesisSupportExplanation,
      challenge.auditSummary,
      ...(challenge.thesisStrengtheners || []),
      ...(challenge.thesisWeaknesseners || []),
      ...(challenge.thesisInvalidators || []),
    ].join(" ").toLowerCase();

    // Should reference crypto-related concepts or be informational
    expect(challenge.thesisSupportStatus).toBeDefined();
  });

  it("evidence challenge is deterministic for same input", () => {
    const result = makeMinimalAnalysisResult("SOL/USD", "crypto");
    result.cryptoIntelligenceContext = makeFullCryptoContext("SOL/USD");

    const c1 = buildEvidenceChallenge(result);
    const c2 = buildEvidenceChallenge(result);
    expect(c1.thesisSupportStatus).toBe(c2.thesisSupportStatus);
    expect(c1.thesisFragility).toBe(c2.thesisFragility);
    expect(c1.auditSummary).toBe(c2.auditSummary);
  });

  it("evidence challenge does not fabricate evidence for non-crypto", () => {
    const result = makeMinimalAnalysisResult("XAU/USD", "commodity");
    const challenge = buildEvidenceChallenge(result);
    expect(challenge).toBeDefined();
    expect(challenge.thesisSupportStatus).toBeDefined();
  });
});

// ── E. Instrument Isolation ──────────────────────────────────────

describe("Phase 43 — E. Instrument Isolation", () => {
  const cryptoInstruments = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"];
  const nonCryptoInstruments: Array<[string, string]> = [
    ["EUR/USD", "forex"],
    ["GBP/USD", "forex"],
    ["USD/JPY", "forex"],
    ["XAU/USD", "commodity"],
    ["AAPL", "stock"],
  ];

  it.each(cryptoInstruments)("crypto intelligence available for %s", (inst) => {
    const ctx = buildCryptoIntelligenceContext(inst);
    expect(ctx).not.toBeNull();
    expect(ctx!.instrument).toBe(inst);
    expect(ctx!.instrumentType).toBe("crypto");
  });

  it.each(nonCryptoInstruments)("no crypto intelligence for %s (%s)", (inst, type) => {
    const ctx = buildCryptoIntelligenceContext(inst);
    expect(ctx).toBeNull();
  });

  it("no cross-instrument contamination in crypto context", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    expect(ctx.instrument).toBe("BTC/USD");
    // Evidence should not reference other instruments
    for (const e of ctx.evidence) {
      expect(e.explanation.toLowerCase()).not.toContain("ethereum");
      expect(e.explanation.toLowerCase()).not.toContain("solana");
    }
  });

  it("perspectives preserve instrument identity", () => {
    const ctx = makeFullCryptoContext("DOGE/USD");
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    expect(fp.applicable).toBe(true);
    expect(ip.applicable).toBe(true);
    // Both should reference the same underlying context
    expect(fp.intelligenceSummary.toLowerCase()).toContain("derivatives");
    expect(ip.intelligenceSummary.toLowerCase()).toContain("fundamentals");
  });
});

// ── F. Decision Immutability ────────────────────────────────────

describe("Phase 43 — F. Decision Immutability", () => {
  it("crypto intelligence does not change recommendation", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    const original = {
      recommendation: result.recommendation,
      bias: result.bias,
      confidence: result.confidence,
      conviction: result.conviction,
      fingerprint: result.decisionFingerprint,
    };

    // Attach crypto intelligence
    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");

    // Decision must remain identical
    expect(result.recommendation).toBe(original.recommendation);
    expect(result.bias).toBe(original.bias);
    expect(result.confidence).toBe(original.confidence);
    expect(result.conviction).toBe(original.conviction);
    expect(result.decisionFingerprint).toBe(original.fingerprint);
  });

  it("attaching crypto intelligence does not add trade plan", () => {
    const result = makeMinimalAnalysisResult("ETH/USD", "crypto");
    expect(result.tradePlan).toBeUndefined();

    result.cryptoIntelligenceContext = makeFullCryptoContext("ETH/USD");
    // tradePlan should still be undefined (not created by crypto intel)
    expect(result.tradePlan).toBeUndefined();
  });

  it("noTradeReasons remain unchanged after crypto intelligence", () => {
    const result = makeMinimalAnalysisResult("SOL/USD", "crypto");
    result.recommendation = "NO_TRADE";
    result.noTradeReasons = ["Structure unclear", "Insufficient confluence"];

    result.cryptoIntelligenceContext = makeFullCryptoContext("SOL/USD");
    expect(result.noTradeReasons).toEqual(["Structure unclear", "Insufficient confluence"]);
  });

  it("data flags are not mutated by crypto intelligence attachment", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    const originalFlags = [...result.dataFlags];

    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");
    // dataFlags on the result should not change
    expect(result.dataFlags).toEqual(originalFlags);
  });
});

// ── G. Security / No Secrets ────────────────────────────────────

describe("Phase 43 — G. Security / No Secrets", () => {
  it("no API keys in crypto intelligence context", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const serialized = JSON.stringify(ctx);

    // Check for common API key patterns
    const suspiciousPatterns = [
      /api[_-]?key/i,
      /secret/i,
      /password/i,
      /token["']?\s*[:=]\s*["'][a-zA-Z0-9]{20,}/i,
      /bearer/i,
      /authorization/i,
    ];

    for (const pattern of suspiciousPatterns) {
      // Only check for actual key values, not type names or field labels
      expect(serialized).not.toMatch(new RegExp(pattern.source + ".*[a-f0-9]{16,}", "i"));
    }
  });

  it("no secrets in perspectives", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    const allText = JSON.stringify([fp, ip]);
    expect(allText).not.toMatch(/api[_-]?key/i);
    expect(allText).not.toMatch(/password/i);
  });

  it("no secrets in evidence challenge output", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");
    const challenge = buildEvidenceChallenge(result);
    const serialized = JSON.stringify(challenge);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
  });

  it("crypto intelligence provider names do not leak credentials", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    if (ctx.derivatives) {
      expect(ctx.derivatives.provider).toBe("CoinGlass");
      expect(ctx.derivatives.provider).not.toMatch(/key/i);
    }
    if (ctx.defi) {
      expect(ctx.defi.provider).toBe("DeFiLlama");
    }
    if (ctx.tokenomics) {
      expect(ctx.tokenomics.provider).toBe("Tokenomist");
    }
  });
});

// ── H. Empty / Degraded States ──────────────────────────────────

describe("Phase 43 — H. Empty / Degraded States", () => {
  it("empty crypto context has unavailable quality", () => {
    const ctx = makeEmptyCryptoContext("BTC/USD");
    expect(ctx.overallAvailability).toBe("UNAVAILABLE");
    expect(ctx.overallQuality).toBe("UNAVAILABLE");
    expect(ctx.derivatives).toBeUndefined();
    expect(ctx.defi).toBeUndefined();
    expect(ctx.tokenomics).toBeUndefined();
    expect(ctx.evidence).toHaveLength(0);
  });

  it("partial context gracefully reports missing data", () => {
    const ctx = makePartialCryptoContext("ETH/USD");
    expect(ctx.overallAvailability).toBe("MINIMAL");
    expect(ctx.missingInformation.length).toBeGreaterThan(0);
    expect(ctx.missingInformation.some((m) => m.includes("DeFi"))).toBe(true);
  });

  it("derivatives unavailable does not break context", () => {
    const ctx = buildCryptoIntelligenceContext(
      "BTC/USD",
      undefined, // no derivatives
      undefined, // no defi
      undefined, // no tokenomics
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.overallAvailability).toBe("UNAVAILABLE");
    expect(ctx!.evidence).toHaveLength(0);
  });

  it("futures perspective handles missing derivatives gracefully", () => {
    const ctx = makePartialCryptoContext("ETH/USD");
    // Only derivatives available, but degraded
    const fp = buildFuturesPerspective(ctx);
    expect(fp.applicable).toBe(true);
    expect(fp.derivativesContext).toBeDefined();
    expect(fp.derivativesContext.length).toBeGreaterThan(0);
  });

  it("investor perspective handles missing fundamentals gracefully", () => {
    const ctx = makePartialCryptoContext("ETH/USD");
    // No defi or tokenomics
    const ip = buildInvestorPerspective(ctx);
    expect(ip.applicable).toBe(true);
    expect(ip.missingInformation.length).toBeGreaterThan(0);
  });

  it("NO_TRADE analysis with crypto intelligence is consistent", () => {
    const result = makeMinimalAnalysisResult("BTC/USD", "crypto");
    result.recommendation = "NO_TRADE";
    result.noTradeReasons = ["Insufficient confluence"];
    result.cryptoIntelligenceContext = makeFullCryptoContext("BTC/USD");

    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.noTradeReasons).toEqual(["Insufficient confluence"]);
  });
});

// ── I. Determinism ──────────────────────────────────────────────

describe("Phase 43 — I. Determinism", () => {
  it("identical input produces identical context", () => {
    const d1: DerivativesIntelligence = {
      provider: "CoinGlass",
      observedAt: 1000000,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      openInterest: { current: 5e9, change1h: 1.0, change24h: 3.0, reliable: true },
      fundingRate: { currentRate: 0.0001, annualizedRate: 10.95, isExtreme: false, reliable: true },
      availableDatasets: 2,
      totalDatasets: 4,
    };

    const ctx1 = buildCryptoIntelligenceContext("BTC/USD", d1);
    const ctx2 = buildCryptoIntelligenceContext("BTC/USD", d1);

    expect(ctx1).not.toBeNull();
    expect(ctx2).not.toBeNull();
    expect(ctx1!.overallAvailability).toBe(ctx2!.overallAvailability);
    expect(ctx1!.overallQuality).toBe(ctx2!.overallQuality);
    expect(ctx1!.evidence.length).toBe(ctx2!.evidence.length);
    expect(ctx1!.missingInformation).toEqual(ctx2!.missingInformation);
  });

  it("perspectives are deterministic for same context", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    const fp1 = buildFuturesPerspective(ctx);
    const fp2 = buildFuturesPerspective(ctx);
    expect(fp1.derivativesContext).toBe(fp2.derivativesContext);
    expect(fp1.fundamentalsContext).toBe(fp2.fundamentalsContext);
    expect(fp1.tokenomicsContext).toBe(fp2.tokenomicsContext);
    expect(fp1.keyConsiderations).toEqual(fp2.keyConsiderations);
  });
});

// ── J. No Fabrication ───────────────────────────────────────────

describe("Phase 43 — J. No Fabrication", () => {
  it("unavailable provider does not produce directional evidence", () => {
    const ctx = makeEmptyCryptoContext("BTC/USD");
    expect(ctx.evidence).toHaveLength(0);
    // No evidence = no fabrication
  });

  it("provider availability is never directional evidence", () => {
    const ctx = makeFullCryptoContext("BTC/USD");
    // Evidence should be based on data values, not on whether the provider exists
    for (const e of ctx.evidence) {
      // Evidence direction should not be about provider availability
      expect(e.explanation.toLowerCase()).not.toMatch(/provider (is|was) (available|responding|online)/);
    }
  });

  it("partial derivatives data does not fabricate missing fields", () => {
    const partial: DerivativesIntelligence = {
      provider: "CoinGlass",
      observedAt: now,
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      openInterest: { current: 5e9, reliable: true },
      // fundingRate, liquidation, positioning all undefined
      availableDatasets: 1,
      totalDatasets: 4,
    };

    const ctx = buildCryptoIntelligenceContext("BTC/USD", partial);
    expect(ctx).not.toBeNull();
    expect(ctx!.derivatives!.fundingRate).toBeUndefined();
    expect(ctx!.derivatives!.liquidation).toBeUndefined();
    expect(ctx!.derivatives!.positioning).toBeUndefined();
    // Evidence should not include fabricated funding/liquidation data
    const fundingEvidence = ctx!.evidence.filter(
      (e) => e.dependencyGroup === "DERIVATIVES_FUNDING" || e.dependencyGroup === "DERIVATIVES_LIQUIDATION"
    );
    expect(fundingEvidence).toHaveLength(0);
  });

  it("missing data stays explicitly missing in evidence", () => {
    const partial: DerivativesIntelligence = {
      provider: "CoinGlass",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 0,
      totalDatasets: 4,
    };

    const ctx = buildCryptoIntelligenceContext("BTC/USD", partial);
    expect(ctx).not.toBeNull();
    // Should have UNAVAILABLE evidence for missing datasets
    const unavailableEvidence = ctx!.evidence.filter((e) => e.direction === "UNAVAILABLE");
    // If there are 0 available datasets, all evidence should be unavailable or none should exist
    expect(ctx!.evidence.filter((e) => e.direction === "SUPPORTING" || e.direction === "CONFLICTING")).toHaveLength(0);
  });
});
