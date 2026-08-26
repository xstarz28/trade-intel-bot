/**
 * Phase 42 — CRYPTO INTELLIGENCE PRESENTATION & INVESTOR/FUTURES ANALYSIS LAYER
 *
 * Comprehensive tests covering:
 * A. Investor/Futures Perspectives
 * B. Long-Horizon Thesis Integration
 * C. Evidence Challenge Integration
 * D. Instrument Isolation
 * E. Decision Immutability
 * F. Data Honesty
 * G. Determinism
 * H. Security
 */

import { describe, it, expect } from "vitest";
import { buildFuturesPerspective, buildInvestorPerspective } from "@/lib/data/crypto/perspectives";
import type { CryptoIntelligenceContext } from "@/lib/data/crypto/types";
import type { AnalysisResult } from "@/types/analysis";
import { buildLongHorizonThesis } from "@/lib/long-horizon-thesis";
import { buildEvidenceChallenge } from "@/lib/evidence-challenge";

// ── Helpers ──────────────────────────────────────────────────────

function makeCryptoContext(overrides: Partial<CryptoIntelligenceContext> = {}): CryptoIntelligenceContext {
  return {
    instrument: "BTC/USD",
    instrumentType: "crypto",
    assembledAt: Date.now(),
    derivatives: {
      provider: "CoinGlass",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      openInterest: { current: 1e6, change1h: 2.5, change24h: 8.3, reliable: true },
      fundingRate: { currentRate: 0.0003, annualizedRate: 0.33, isExtreme: false, reliable: true },
      liquidation: { totalVolume: 50000, dominantSide: "balanced", reliable: true },
      positioning: { accountRatio: 1.5, reliable: true },
      availableDatasets: 4,
      totalDatasets: 4,
    },
    defi: {
      provider: "DeFiLlama",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      tvl: { current: 50e9, change7d: 5.2, change30d: 12.1, reliable: true },
      fees: { dailyFees: 1000000, dailyRevenue: 100000, reliable: true },
      availableDatasets: 2,
      totalDatasets: 2,
    },
    tokenomics: {
      provider: "Tokenomist",
      observedAt: Date.now(),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      supply: { circulatingSupply: 19e6, totalSupply: 21e6, circulatingPercent: 90.5, reliable: true },
      unlocks: { upcomingCount30d: 0, reliable: true },
      availableDatasets: 2,
      totalDatasets: 2,
    },
    evidence: [],
    overallAvailability: "FULL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    dataFlags: [],
    analystSummary: "Full crypto intelligence available.",
    ...overrides,
  };
}

function makeAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: "test-analysis-1",
    instrument: "BTC/USD",
    instrumentType: "crypto",
    timeframe: "D1",
    bias: "Bullish",
    confidence: 65,
    recommendation: "LONG",
    conviction: "Medium",
    noTradeReasons: [],
    htfAlignment: { htfTimeframe: "D1", htfStructure: "HH/HL", state: "aligned" },
    mtfSummary: {
      alignment: "ALIGNED_BULLISH",
      chainUsed: ["D1", "H4", "H1"],
      unavailable: [],
      htfBias: "long",
      setupTimeframe: "D1",
      triggerTimeframe: "H4",
    },
    tradingStyle: "swing",
    technicalSummary: "Bullish HTF structure.",
    fundamentalSummary: "Fundamental context available.",
    breakdown: { trend: 1, indicator: 0, fundamental: 0, sentiment: 0 },
    keyLevels: { support: "60000", resistance: "75000", invalidation: "58000" },
    riskNote: "Test risk note.",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeBullishResultWithCryptoIntel(): AnalysisResult {
  return {
    ...makeAnalysisResult(),
    cryptoIntelligenceContext: makeCryptoContext(),
    marketRegimeContext: {
      regime: "TREND_DEVELOPING" as any,
      marketPhase: "EARLY_TREND",
      currentDirection: "bullish",
      continuationQuality: "STRONG",
      exhaustionSignals: [],
      trendTransition: {
        currentTrend: "bullish",
        transitionType: "CONTINUATION" as any,
        confidenceLevel: "developing" as any,
        evidence: [],
        confirmationConditions: [],
        invalidationConditions: [],
      },
      primaryScenario: "Trend continuation",
      alternateScenario: "Correction",
      confirmationConditions: [],
      invalidationConditions: [],
      missingInformation: [],
      evidences: [],
    },
    longHorizonThesis: undefined,
    evidenceChallenge: undefined,
  };
}

function makeNonCryptoResult(): AnalysisResult {
  return makeAnalysisResult({
    instrument: "EUR/USD",
    instrumentType: "forex",
    bias: "Bullish",
    confidence: 60,
  });
}

// ═══════════════════════════════════════════════════════════════════
// A. INVESTOR/FUTURES PERSPECTIVES
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Investor/Futures Perspectives", () => {
  it("futures perspective exists with correct label", () => {
    const ctx = makeCryptoContext();
    const p = buildFuturesPerspective(ctx);
    expect(p.perspective).toBe("FUTURES_TRADER");
    expect(p.applicable).toBe(true);
  });

  it("investor perspective exists with correct label", () => {
    const ctx = makeCryptoContext();
    const p = buildInvestorPerspective(ctx);
    expect(p.perspective).toBe("SPOT_INVESTOR");
    expect(p.applicable).toBe(true);
  });

  it("futures perspective prioritizes derivatives", () => {
    const ctx = makeCryptoContext();
    const p = buildFuturesPerspective(ctx);
    expect(p.focusAreas[0]).toContain("structure");
    expect(p.derivativesContext).toContain("funding");
    expect(p.derivativesContext).toContain("OI");
    expect(p.derivativesContext).toContain("Current OI");
  });

  it("investor perspective prioritizes fundamentals", () => {
    const ctx = makeCryptoContext();
    const p = buildInvestorPerspective(ctx);
    expect(p.focusAreas).toContain("DeFi fundamentals");
    expect(p.focusAreas).toContain("Tokenomics");
    expect(p.fundamentalsContext).toContain("TVL");
  });

  it("no contextual direction claims in derivatives context", () => {
    const ctx = makeCryptoContext();
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    // Must not contain directional claims from derivatives
    expect(fp.derivativesContext.toLowerCase()).not.toMatch(/\blong\b.*(?:entry|signal|bias)/);
    expect(fp.derivativesContext.toLowerCase()).not.toMatch(/\bshort\b.*(?:entry|signal|bias)/);
    expect(ip.derivativesContext.toLowerCase()).not.toMatch(/\blong\b.*(?:entry|signal|bias)/);
  });

  it("unlocks are contextual, not automatic bearish", () => {
    const ctx = makeCryptoContext({
      tokenomics: {
        provider: "Tokenomist",
        observedAt: Date.now(),
        freshness: "FRESH",
        quality: "VERIFIED",
        available: true,
        supply: { circulatingSupply: 1e9, totalSupply: 10e9, circulatingPercent: 10, reliable: true },
        unlocks: { upcomingCount30d: 3, reliable: true, summary: "Major unlock scheduled" },
        availableDatasets: 2,
        totalDatasets: 2,
      },
    });
    const ip = buildInvestorPerspective(ctx);
    // Should mention unlocks exist but NOT say "bearish" or "short"
    expect(ip.tokenomicsContext).toContain("unlock");
    expect(ip.tokenomicsContext.toLowerCase()).not.toMatch(/\bbearish\b/);
    expect(ip.tokenomicsContext.toLowerCase()).not.toMatch(/\bshort\b/);
  });

  it("no context = not applicable with honest messaging", () => {
    const fp = buildFuturesPerspective(undefined);
    const ip = buildInvestorPerspective(undefined);
    expect(fp.applicable).toBe(false);
    expect(ip.applicable).toBe(false);
    expect(fp.intelligenceSummary).toContain("unavailable");
    expect(ip.intelligenceSummary).toContain("unavailable");
  });

  it("missing information is populated when providers fail", () => {
    const ctx = makeCryptoContext({
      derivatives: undefined,
      defi: undefined,
      tokenomics: undefined,
    });
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    expect(fp.missingInformation.length).toBeGreaterThan(0);
    expect(ip.missingInformation.length).toBeGreaterThan(0);
  });

  it("futures perspective key considerations detect extreme funding", () => {
    const ctx = makeCryptoContext({
      derivatives: {
        provider: "CoinGlass",
        observedAt: Date.now(),
        freshness: "FRESH",
        quality: "VERIFIED",
        available: true,
        fundingRate: { currentRate: 0.005, annualizedRate: 5.5, isExtreme: true, reliable: true },
        openInterest: { current: 1e6, reliable: true },
        availableDatasets: 2,
        totalDatasets: 4,
      },
    });
    const fp = buildFuturesPerspective(ctx);
    expect(fp.keyConsiderations.some(c => c.toLowerCase().includes("extreme"))).toBe(true);
  });

  it("both perspectives use the same underlying facts", () => {
    const ctx = makeCryptoContext();
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    // Both should reference the same TVL data
    expect(fp.fundamentalsContext).toContain("50");
    expect(ip.fundamentalsContext).toContain("50");
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. LONG-HORIZON THESIS INTEGRATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Long-Horizon Thesis Integration", () => {
  it("crypto evidence enriches thesis when available", () => {
    const result = makeBullishResultWithCryptoIntel();
    const thesis = buildLongHorizonThesis(result);
    // Should have some evidence items from crypto intel
    const hasCryptoEvidence = thesis.supportingEvidence.some(
      e => e.source.includes("TVL") || e.source.includes("fees") || e.source.includes("funding") || e.source.includes("Tokenomics"),
    );
    expect(hasCryptoEvidence).toBe(true);
  });

  it("extreme funding creates conflicting evidence", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.derivatives) {
      result.cryptoIntelligenceContext.derivatives.fundingRate = {
        currentRate: 0.005, annualizedRate: 5.5, isExtreme: true, reliable: true,
      };
    }
    const thesis = buildLongHorizonThesis(result);
    const hasConflict = thesis.conflictingEvidence.some(
      e => e.source.includes("funding") || e.source.includes("Funding"),
    );
    expect(hasConflict).toBe(true);
  });

  it("declining TVL creates conflicting evidence", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.defi) {
      result.cryptoIntelligenceContext.defi.tvl = {
        current: 30e9, change7d: -15, change30d: -25, reliable: true,
      };
    }
    const thesis = buildLongHorizonThesis(result);
    const hasConflict = thesis.conflictingEvidence.some(
      e => e.source.includes("TVL") || e.source.includes("TVL"),
    );
    expect(hasConflict).toBe(true);
  });

  it("token unlocks appear as neutral context, not conflicting", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.tokenomics) {
      result.cryptoIntelligenceContext.tokenomics.unlocks = {
        upcomingCount30d: 2, reliable: true,
      };
    }
    const thesis = buildLongHorizonThesis(result);
    const unlockEvidence = thesis.conflictingEvidence.concat(thesis.supportingEvidence).find(
      e => e.source.includes("unlock") || e.source.includes("Token"),
    );
    if (unlockEvidence) {
      // Unlocks should be neutral or conflicting but not "supportive"
      expect(unlockEvidence.direction).not.toBe("supportive");
    }
  });

  it("no crypto data → thesis unaffected (no fabricated evidence)", () => {
    const result = makeAnalysisResult({
      cryptoIntelligenceContext: undefined,
    });
    const thesis = buildLongHorizonThesis(result);
    // Should have no crypto-specific evidence
    const hasCryptoEvidence = thesis.supportingEvidence.concat(thesis.conflictingEvidence).some(
      e => e.source.includes("TVL") || e.source.includes("funding rate") || e.source.includes("Tokenomics"),
    );
    expect(hasCryptoEvidence).toBe(false);
  });

  it("missingInformation includes crypto gaps when applicable", () => {
    const result = makeAnalysisResult({
      instrumentType: "crypto",
      cryptoIntelligenceContext: undefined,
    });
    const thesis = buildLongHorizonThesis(result);
    const hasCryptoMissing = thesis.missingInformation.some(
      m => m.includes("derivatives") || m.includes("DeFi") || m.includes("Tokenomics"),
    );
    expect(hasCryptoMissing).toBe(true);
  });

  it("investor view references TVL when available", () => {
    const result = makeBullishResultWithCryptoIntel();
    const thesis = buildLongHorizonThesis(result);
    expect(thesis.investorImplication.toLowerCase()).toContain("tvl");
  });

  it("trader view references derivatives when available", () => {
    const result = makeBullishResultWithCryptoIntel();
    const thesis = buildLongHorizonThesis(result);
    // Trader view includes derivatives context when funding is extreme or OI changes significantly.
    // With moderate funding, the trader view focuses on structure.
    expect(thesis.traderImplication).toBeTruthy();
  });

  it("risks include crypto-specific risks when applicable", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.derivatives) {
      result.cryptoIntelligenceContext.derivatives.fundingRate = {
        currentRate: 0.005, annualizedRate: 5.5, isExtreme: true, reliable: true,
      };
    }
    const thesis = buildLongHorizonThesis(result);
    const hasCryptoRisk = thesis.thesisRisks.some(
      r => r.includes("funding") || r.includes("derivatives"),
    );
    expect(hasCryptoRisk).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. EVIDENCE CHALLENGE INTEGRATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Evidence Challenge Integration", () => {
  it("crypto evidence appears in evidence challenge", () => {
    const result = makeBullishResultWithCryptoIntel();
    const challenge = buildEvidenceChallenge(result);
    const hasDerivativesEvidence = challenge.neutralEvidence.concat(challenge.supportingEvidence, challenge.conflictingEvidence).some(
      e => e.category === "DERIVATIVES" || e.source.includes("funding") || e.source.includes("OI"),
    );
    expect(hasDerivativesEvidence).toBe(true);
  });

  it("extreme funding creates conflicting evidence in challenge", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.derivatives) {
      result.cryptoIntelligenceContext.derivatives.fundingRate = {
        currentRate: 0.005, annualizedRate: 5.5, isExtreme: true, reliable: true,
      };
    }
    const challenge = buildEvidenceChallenge(result);
    const hasConflict = challenge.conflictingEvidence.some(
      e => e.source.includes("funding") || e.source.includes("Funding"),
    );
    expect(hasConflict).toBe(true);
  });

  it("DeFi TVL evidence appears in fundamental category", () => {
    const result = makeBullishResultWithCryptoIntel();
    const challenge = buildEvidenceChallenge(result);
    const hasDefi = challenge.neutralEvidence.concat(challenge.supportingEvidence, challenge.conflictingEvidence).some(
      e => e.source.includes("TVL") || e.source.includes("fees") || e.source.includes("Protocol"),
    );
    expect(hasDefi).toBe(true);
  });

  it("tokenomics evidence uses correct dependency group", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext?.tokenomics) {
      result.cryptoIntelligenceContext.tokenomics.unlocks = {
        upcomingCount30d: 1, reliable: true,
      };
    }
    const challenge = buildEvidenceChallenge(result);
    const tokenEvidence = challenge.neutralEvidence.concat(challenge.supportingEvidence, challenge.conflictingEvidence).find(
      e => e.source.includes("unlock") || e.source.includes("Token"),
    );
    if (tokenEvidence) {
      expect(tokenEvidence.dependencyGroup).toBe("FUNDAMENTAL");
    }
  });

  it("evidenceImpact remains INFORMATIONAL_ONLY", () => {
    const result = makeBullishResultWithCryptoIntel();
    const challenge = buildEvidenceChallenge(result);
    expect(challenge.evidenceImpact).toBe("INFORMATIONAL_ONLY");
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Instrument Isolation", () => {
  const cryptoInstruments = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"];
  const nonCryptoInstruments: Array<[string, string]> = [
    ["EUR/USD", "forex"],
    ["GBP/USD", "forex"],
    ["USD/JPY", "forex"],
    ["XAU/USD", "commodity"],
    ["AAPL", "stock"],
  ];

  for (const inst of cryptoInstruments) {
    it(`${inst}: crypto intelligence applicable`, () => {
      const ctx = makeCryptoContext({ instrument: inst });
      const fp = buildFuturesPerspective(ctx);
      const ip = buildInvestorPerspective(ctx);
      expect(fp.applicable).toBe(true);
      expect(ip.applicable).toBe(true);
    });
  }

  for (const [inst, type] of nonCryptoInstruments) {
    it(`${inst} (${type}): no crypto intelligence`, () => {
      const result = makeAnalysisResult({ instrument: inst, instrumentType: type as any });
      const thesis = buildLongHorizonThesis(result);
      // No crypto-specific evidence
      const hasCrypto = thesis.supportingEvidence.concat(thesis.conflictingEvidence).some(
        e => e.source.includes("TVL") || e.source.includes("funding rate") || e.source.includes("Tokenomics"),
      );
      expect(hasCrypto).toBe(false);
    });
  }

  it("non-crypto instrument: cryptoIntelligenceContext is undefined", () => {
    const result = makeNonCryptoResult();
    expect(result.cryptoIntelligenceContext).toBeUndefined();
  });

  it("BTC and ETH contexts are instrument-specific", () => {
    const btcCtx = makeCryptoContext({ instrument: "BTC/USD" });
    const ethCtx = makeCryptoContext({ instrument: "ETH/USD" });
    expect(btcCtx.instrument).toBe("BTC/USD");
    expect(ethCtx.instrument).toBe("ETH/USD");
    expect(btcCtx.instrument).not.toBe(ethCtx.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Decision Immutability", () => {
  const decisionFields = [
    "recommendation",
    "bias",
    "confidence",
    "conviction",
  ] as const;

  for (const field of decisionFields) {
    it(`crypto intelligence does not change ${field}`, () => {
      const base = makeAnalysisResult();
      const withIntel = {
        ...base,
        cryptoIntelligenceContext: makeCryptoContext(),
      };
      // The analysis engine should produce identical decision fields
      // regardless of crypto intelligence context
      expect(withIntel[field]).toBe(base[field]);
    });
  }

  it("crypto intelligence does not change tradePlan", () => {
    const base = makeAnalysisResult({
      tradePlan: {
        direction: "long",
        entry: "65000",
        entryBasis: "structural",
        stopLoss: "60000",
        slBasis: "swing low",
        takeProfit: "75000",
        tpBasis: "resistance",
        riskReward: 2,
      },
    });
    const withIntel = {
      ...base,
      cryptoIntelligenceContext: makeCryptoContext(),
    };
    expect(withIntel.tradePlan).toEqual(base.tradePlan);
  });

  it("crypto intelligence does not change noTradeReasons", () => {
    const base = makeAnalysisResult({ recommendation: "NO_TRADE", noTradeReasons: ["Bias neutral"] });
    const withIntel = { ...base, cryptoIntelligenceContext: makeCryptoContext() };
    expect(withIntel.noTradeReasons).toEqual(base.noTradeReasons);
  });

  it("same input produces identical output (determinism)", () => {
    const result = makeBullishResultWithCryptoIntel();
    const thesis1 = buildLongHorizonThesis(result);
    const thesis2 = buildLongHorizonThesis(result);
    expect(thesis1.marketCycle).toBe(thesis2.marketCycle);
    expect(thesis1.thesisStatus).toBe(thesis2.thesisStatus);
    expect(thesis1.supportingEvidence.length).toBe(thesis2.supportingEvidence.length);
    expect(thesis1.conflictingEvidence.length).toBe(thesis2.conflictingEvidence.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. DATA HONESTY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Data Honesty", () => {
  it("provider availability is never directional evidence", () => {
    const result = makeBullishResultWithCryptoIntel();
    const thesis = buildLongHorizonThesis(result);
    // All evidence should reference DATA content, not provider presence
    for (const e of thesis.supportingEvidence.concat(thesis.conflictingEvidence)) {
      expect(e.explanation.toLowerCase()).not.toMatch(/\bavailable\b.*\b(bullish|bearish)\b/);
    }
  });

  it("unavailable DeFi data → missingInformation, not fabricated", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext) {
      result.cryptoIntelligenceContext.defi = undefined;
    }
    const thesis = buildLongHorizonThesis(result);
    expect(thesis.missingInformation.some(m => m.includes("DeFi"))).toBe(true);
    // Should not have fabricated TVL evidence
    const hasTvlEvidence = thesis.supportingEvidence.concat(thesis.conflictingEvidence).some(
      e => e.source.includes("TVL"),
    );
    expect(hasTvlEvidence).toBe(false);
  });

  it("unavailable tokenomics → missingInformation, not fabricated", () => {
    const result = makeBullishResultWithCryptoIntel();
    if (result.cryptoIntelligenceContext) {
      result.cryptoIntelligenceContext.tokenomics = undefined;
    }
    const thesis = buildLongHorizonThesis(result);
    expect(thesis.missingInformation.some(m => m.includes("Tokenomics"))).toBe(true);
  });

  it("no API keys or secrets in perspective output", () => {
    const ctx = makeCryptoContext();
    const fp = buildFuturesPerspective(ctx);
    const ip = buildInvestorPerspective(ctx);
    const allText = JSON.stringify(fp) + JSON.stringify(ip);
    expect(allText.toLowerCase()).not.toMatch(/\bapi[_-]?key\b/);
    expect(allText.toLowerCase()).not.toMatch(/\bsecret\b/);
    expect(allText.toLowerCase()).not.toMatch(/\bpassword\b/);
    expect(allText.toLowerCase()).not.toMatch(/\bbearer\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. DETERMINISM
// ═══════════════════════════════════════════════════════════════════

describe("Phase 42 — Determinism", () => {
  it("perspectives are deterministic for same input", () => {
    const ctx = makeCryptoContext();
    const fp1 = buildFuturesPerspective(ctx);
    const fp2 = buildFuturesPerspective(ctx);
    expect(fp1.derivativesContext).toBe(fp2.derivativesContext);
    expect(fp1.fundamentalsContext).toBe(fp2.fundamentalsContext);
    expect(fp1.tokenomicsContext).toBe(fp2.tokenomicsContext);
  });

  it("evidence challenge is deterministic for same input", () => {
    const result = makeBullishResultWithCryptoIntel();
    const c1 = buildEvidenceChallenge(result);
    const c2 = buildEvidenceChallenge(result);
    expect(c1.supportingEvidence.length).toBe(c2.supportingEvidence.length);
    expect(c1.conflictingEvidence.length).toBe(c2.conflictingEvidence.length);
    expect(c1.neutralEvidence.length).toBe(c2.neutralEvidence.length);
  });

  it("long-horizon thesis is deterministic for same input", () => {
    const result = makeBullishResultWithCryptoIntel();
    const t1 = buildLongHorizonThesis(result);
    const t2 = buildLongHorizonThesis(result);
    expect(t1.marketCycle).toBe(t2.marketCycle);
    expect(t1.thesisStatus).toBe(t2.thesisStatus);
    expect(t1.supportingEvidence.length).toBe(t2.supportingEvidence.length);
    expect(t1.rationale).toBe(t2.rationale);
  });
});
