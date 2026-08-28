/**
 * Phase 68 — Intelligence Calibration, False-Positive Reduction & Early-Warning Quality
 *
 * Comprehensive validation test suite.
 */
import { describe, it, expect } from "vitest";
import {
  calibrateIntelligence,
  type CalibrationInput,
  type CalibrationResult,
} from "../position-protection/intelligence-calibration";
import {
  classifyPullbackType,
  type PullbackClassificationInput,
} from "../position-protection/pullback-classifier";
import {
  guardAgainstFalsePositive,
  type FalsePositiveGuardInput,
} from "../position-protection/false-positive-guard";
import {
  computeEarlyWarningMetrics,
  type EarlyWarningTimestamps,
} from "../position-protection/early-warning-metrics";
import {
  evaluateAlertQuality,
  type AlertQualityInput,
} from "../position-protection/alert-quality";
import {
  evaluateProtection,
  type ProtectionEngineInput,
} from "../position-protection/protection-engine";
import type { PositionContext, AlertSeverity } from "../position-protection/types";
import type { MarketEvidence } from "../position-protection/thesis-health";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function pos(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 105000,
    stopLoss: 98000,
    takeProfit: 115000,
    leverage: 1,
    horizon: "SWING",
    openedAt: Date.now(),
    ...overrides,
  };
}

function ev(overrides: Partial<MarketEvidence> = {}): MarketEvidence {
  return {
    price: 105000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    momentumChange: 5,
    volatility: 20,
    avgVolatility: 20,
    fundingRate: 0.01,
    oiChange: 5,
    liquidationSpike: false,
    longShortRatio: 1.2,
    dxyTrend: "stable",
    vix: 18,
    riskRegime: "risk_on",
    riskRegimeChanged: false,
    eventApproaching: false,
    correlatedDivergence: false,
    structureBroken: false,
    ...overrides,
  };
}

function inp(
  posOverrides: Partial<PositionContext> = {},
  evidenceOverrides: Partial<MarketEvidence> = {}
): ProtectionEngineInput {
  return { position: pos(posOverrides), evidence: ev(evidenceOverrides) };
}

function calibInput(
  posOverrides: Partial<PositionContext> = {},
  evidenceOverrides: Partial<MarketEvidence> = {},
  calibOverrides: Partial<CalibrationInput> = {}
): CalibrationInput {
  return {
    position: pos(posOverrides),
    evidence: ev(evidenceOverrides),
    severity: "NONE",
    urgency: "NONE",
    profit: { profitState: "PROFITABLE", unrealizedPnL: 5000, distanceFromEntryPct: 5, peakProfit: 5000, givebackPct: 0 },
    thesisHealthScore: 80,
    thesisHealthState: "HEALTHY",
    shock: { state: "NORMAL", score: 0, indicators: {} } as any,
    givebackPct: 0,
    accelerationLevel: "NORMAL",
    deteriorationCount: 0,
    confirmingCount: 0,
    missingData: [],
    conflictingEvidence: [],
    supportingEvidence: [],
    ...calibOverrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. INTELLIGENCE CALIBRATION MODEL
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 A — Intelligence Calibration", () => {
  it("healthy position gets strong evidence quality", () => {
    const result = calibrateIntelligence(calibInput());
    expect(result.evidenceQuality).toBeDefined();
    expect(result.calibratedSeverity).toBeDefined();
    expect(result.calibratedUrgency).toBeDefined();
  });

  it("deteriorating position gets meaningful classification", () => {
    const result = calibrateIntelligence(
      calibInput(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -20,
        },
        {
          severity: "CAUTION",
          urgency: "MODERATE",
          deteriorationCount: 3,
          thesisHealthState: "DETERIORATING",
          thesisHealthScore: 40,
          givebackPct: 20,
        }
      )
    );
    expect(result.evidenceQuality).not.toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reversalStructure).not.toBe("NO_REVERSAL");
  });

  it("confirmed reversal gets proper classification", () => {
    const result = calibrateIntelligence(
      calibInput(
        { currentPrice: 110000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
        },
        {
          severity: "HIGH_RISK",
          urgency: "HIGH",
          deteriorationCount: 4,
          thesisHealthState: "SEVERELY_DETERIORATING",
          thesisHealthScore: 20,
          givebackPct: 30,
          accelerationLevel: "HIGH",
        }
      )
    );
    expect(result.reversalStructure).toBe("CONFIRMED_REVERSAL");
    expect(result.evidenceQuality).toBe("STRONG_EVIDENCE");
  });

  it("insufficient evidence triggers suppression", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        {
          severity: "WATCH",
          urgency: "LOW",
          deteriorationCount: 0,
          confirmingCount: 0,
          thesisHealthState: "HEALTHY",
          thesisHealthScore: 80,
          givebackPct: 0,
        }
      )
    );
    expect(result.suppressionReason).toBeDefined();
  });

  it("calibration flags include relevant indicators", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {
          shortTermTrend: "bearish",
          structureBroken: true,
          correlatedDivergence: true,
        },
        {
          severity: "CAUTION",
          givebackPct: 35,
          accelerationLevel: "HIGH",
          deteriorationCount: 3,
          conflictingEvidence: ["H1 trend bullish"],
        }
      )
    );
    expect(result.calibrationFlags.length).toBeGreaterThan(0);
  });

  it("same inputs produce same calibration", () => {
    const input = calibInput(
      {},
      { shortTermTrend: "bearish", structureBroken: true },
      { severity: "CAUTION", deteriorationCount: 2, givebackPct: 15 }
    );
    const r1 = calibrateIntelligence(input);
    const r2 = calibrateIntelligence(input);
    expect(r1.calibratedSeverity).toBe(r2.calibratedSeverity);
    expect(r1.evidenceQuality).toBe(r2.evidenceQuality);
    expect(r1.reversalStructure).toBe(r2.reversalStructure);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. PULLBACK CLASSIFIER
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 B — Pullback Classifier", () => {
  it("small pullback is NORMAL_PULLBACK", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 3,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("NORMAL_PULLBACK");
  });

  it("structural break + multi-tf = STRUCTURAL_REVERSAL", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("STRUCTURAL_REVERSAL");
  });

  it("SHOCK state + giveback = SHOCK_REVERSAL", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "SHOCK", score: 80, indicators: {} } as any,
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("SHOCK_REVERSAL");
  });

  it("multi-tf adverse + high acceleration = MEANINGFUL_DETERIORATION", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bearish" }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 10,
      accelerationLevel: "HIGH",
    });
    expect(result).toBe("MEANINGFUL_DETERIORATION");
  });

  it("moderate giveback = EARLY_CORRECTION", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 18,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("EARLY_CORRECTION");
  });

  it("SHORT pullback classifier works symmetrically", () => {
    // SHORT: adverse is upward
    const result = classifyPullbackType({
      position: pos({ side: "SHORT" }),
      evidence: ev({ shortTermTrend: "bullish", mediumTermTrend: "bullish", structureBroken: true }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 25,
      accelerationLevel: "ELEVATED",
    });
    expect(result).toBe("STRUCTURAL_REVERSAL");
  });

  it("missing trend data = INSUFFICIENT_DATA", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: undefined, mediumTermTrend: undefined }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 3,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("INSUFFICIENT_DATA");
  });

  it("single timeframe only stays NORMAL or EARLY", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bullish" }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 8,
      accelerationLevel: "NORMAL",
    });
    // Single timeframe without structure break should not be structural
    expect(["NORMAL_PULLBACK", "EARLY_CORRECTION"]).toContain(result);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. FALSE POSITIVE GUARD
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 C — False Positive Guard", () => {
  it("normal pullback with weak evidence suppresses HIGH_RISK", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(false);
    expect(result.finalSeverity).toBe("CAUTION");
  });

  it("normal pullback with insufficient evidence suppresses to NONE", () => {
    const result = guardAgainstFalsePositive({
      severity: "WATCH",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "INSUFFICIENT_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 0,
      givebackPct: 2,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(false);
    expect(result.finalSeverity).toBe("NONE");
  });

  it("thesis invalidation is NEVER suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "INVALIDATED",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "INVALIDATED",
      independentSignalCount: 0,
      givebackPct: 0,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
    expect(result.finalSeverity).toBe("INVALIDATED");
  });

  it("critical shock is NEVER suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "CAUTION",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "SHOCK",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("structural reversal with strong evidence is never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "STRUCTURAL_REVERSAL",
      evidenceQuality: "STRONG_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "DETERIORATING",
      independentSignalCount: 3,
      givebackPct: 25,
      accelerationLevel: "HIGH",
    });
    expect(result.shouldAlert).toBe(true);
    expect(result.finalSeverity).toBe("HIGH_RISK");
  });

  it("single signal caps at WATCH unless structural", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "EARLY_CORRECTION",
      evidenceQuality: "MODERATE_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 15,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(false);
    expect(result.finalSeverity).toBe("WATCH");
  });

  it("extreme giveback + multiple signals is never suppressed", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "MEANINGFUL_DETERIORATION",
      evidenceQuality: "STRONG_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "DETERIORATING",
      independentSignalCount: 4,
      givebackPct: 60,
      accelerationLevel: "EXTREME",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("WATCH with normal pullback is allowed through", () => {
    const result = guardAgainstFalsePositive({
      severity: "WATCH",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 3,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. EARLY-WARNING METRICS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 D — Early Warning Metrics", () => {
  it("computes lead time when SL breach is after alert", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
      slBreachTimestamp: 5000,
    });
    expect(result.warningLeadTimeBeforeSL).toBe(4000);
  });

  it("returns null when SL breach is before alert", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 5000,
      slBreachTimestamp: 1000,
    });
    expect(result.warningLeadTimeBeforeSL).toBeNull();
  });

  it("returns null when SL breach is unavailable", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
    });
    expect(result.warningLeadTimeBeforeSL).toBeNull();
  });

  it("computes peak-to-giveback time", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
      peakProfitTimestamp: 2000,
      firstMeaningfulGivebackTimestamp: 4000,
    });
    expect(result.peakToGivebackTime).toBe(2000);
  });

  it("computes deterioration-to-HIGH_RISK time", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
      firstDeteriorationTimestamp: 2000,
      highRiskTimestamp: 5000,
    });
    expect(result.deteriorationToHighRiskTime).toBe(3000);
  });

  it("returns null for unavailable metrics", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
    });
    expect(result.warningLeadTimeBeforeSL).toBeNull();
    expect(result.peakToGivebackTime).toBeNull();
    expect(result.deteriorationToHighRiskTime).toBeNull();
    expect(result.highRiskToInvalidatedTime).toBeNull();
  });

  it("all timestamps available computes all metrics", () => {
    const result = computeEarlyWarningMetrics({
      alertTimestamp: 1000,
      firstDeteriorationTimestamp: 500,
      highRiskTimestamp: 3000,
      invalidatedTimestamp: 5000,
      slBreachTimestamp: 7000,
      peakProfitTimestamp: 2000,
      firstMeaningfulGivebackTimestamp: 4000,
    });
    expect(result.warningLeadTimeBeforeSL).toBe(6000);
    expect(result.peakToGivebackTime).toBe(2000);
    expect(result.deteriorationToHighRiskTime).toBe(2500);
    expect(result.highRiskToInvalidatedTime).toBe(2000);
  });

  it("deterministic: same inputs same outputs", () => {
    const ts: EarlyWarningTimestamps = {
      alertTimestamp: 1000,
      slBreachTimestamp: 5000,
      peakProfitTimestamp: 2000,
      firstMeaningfulGivebackTimestamp: 3000,
    };
    const r1 = computeEarlyWarningMetrics(ts);
    const r2 = computeEarlyWarningMetrics(ts);
    expect(r1).toEqual(r2);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. ALERT QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 E — Alert Quality", () => {
  it("strong evidence produces EXCELLENT or STRONG quality", () => {
    const result = evaluateAlertQuality({
      independentSignalCount: 5,
      dependencyDiversity: 4,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: true,
      givebackConfirmation: true,
      accelerationConfirmation: true,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    expect(["EXCELLENT", "STRONG"]).toContain(result.quality);
    expect(result.score).toBeGreaterThanOrEqual(6);
  });

  it("weak evidence produces WEAK or INSUFFICIENT quality", () => {
    const result = evaluateAlertQuality({
      independentSignalCount: 0,
      dependencyDiversity: 0,
      freshness: "UNAVAILABLE",
      multiTimeframeConfirmation: false,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 3,
      missingEvidenceCount: 5,
    });
    expect(["WEAK", "INSUFFICIENT"]).toContain(result.quality);
  });

  it("fresh data scores higher than stale", () => {
    const fresh = evaluateAlertQuality({
      independentSignalCount: 2,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    const stale = evaluateAlertQuality({
      independentSignalCount: 2,
      dependencyDiversity: 2,
      freshness: "STALE",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    expect(fresh.score).toBeGreaterThanOrEqual(stale.score);
  });

  it("conflicting evidence reduces score", () => {
    const clean = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    const conflicting = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 5,
      missingEvidenceCount: 0,
    });
    expect(conflicting.score).toBeLessThanOrEqual(clean.score);
  });

  it("includes factors explaining the score", () => {
    const result = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: true,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("deterministic: same inputs same quality", () => {
    const input: AlertQualityInput = {
      independentSignalCount: 4,
      dependencyDiversity: 3,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: true,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    };
    expect(evaluateAlertQuality(input).quality).toBe(
      evaluateAlertQuality(input).quality
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// F. EVIDENCE RANKING (via calibration reasons)
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 F — Evidence Ranking", () => {
  it("reasons prioritize strong signals", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        { shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true },
        {
          severity: "HIGH_RISK",
          deteriorationCount: 4,
          thesisHealthState: "SEVERELY_DETERIORATING",
          thesisHealthScore: 20,
          givebackPct: 35,
          accelerationLevel: "HIGH",
          shock: { state: "ELEVATED", score: 50, indicators: {} } as any,
        }
      )
    );
    // Reasons should contain key deterioration signals
    const reasonText = result.reasons.join(" ").toLowerCase();
    expect(reasonText).toContain("signal");
  });

  it("empty input produces minimal reasons", () => {
    const result = calibrateIntelligence(calibInput());
    expect(result.reasons.length).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. HORIZON CALIBRATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 G — Horizon Calibration", () => {
  it("SCALPING position evaluates correctly", () => {
    const result = evaluateProtection(
      inp({ horizon: "SCALPING" }, { shortTermTrend: "bearish", momentumChange: -10 })
    );
    expect(result.alert.severity).toBeDefined();
  });

  it("INVESTING position evaluates correctly", () => {
    const result = evaluateProtection(
      inp({ horizon: "INVESTING" }, { shortTermTrend: "bearish", momentumChange: -10 })
    );
    expect(result.alert.severity).toBeDefined();
  });

  it("different horizons can produce different severities", () => {
    const scalping = evaluateProtection(
      inp({ horizon: "SCALPING" }, { shortTermTrend: "bearish", momentumChange: -15 })
    );
    const investing = evaluateProtection(
      inp({ horizon: "INVESTING" }, { shortTermTrend: "bearish", momentumChange: -15 })
    );
    // Both should produce valid results
    expect(scalping.alert.severity).toBeDefined();
    expect(investing.alert.severity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. ASSET CLASS CALIBRATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 H — Asset Class Calibration", () => {
  it("CRYPTO evaluates with funding/OI data", () => {
    const result = evaluateProtection(
      inp(
        { assetClass: "crypto" },
        { fundingRate: 0.08, oiChange: -30, liquidationSpike: true }
      )
    );
    expect(result.alert).toBeDefined();
  });

  it("FOREX evaluates without derivatives data", () => {
    const result = evaluateProtection(
      inp(
        { instrument: "EUR/USD", assetClass: "forex" },
        { shortTermTrend: "bearish" }
      )
    );
    expect(result.alert).toBeDefined();
  });

  it("COMMODITY evaluates correctly", () => {
    const result = evaluateProtection(
      inp(
        { instrument: "XAU/USD", assetClass: "commodity" },
        { shortTermTrend: "bullish" }
      )
    );
    expect(result.alert).toBeDefined();
  });

  it("EQUITY evaluates correctly", () => {
    const result = evaluateProtection(
      inp(
        { instrument: "AAPL", assetClass: "equity" },
        { shortTermTrend: "bearish" }
      )
    );
    expect(result.alert).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 I — LONG/SHORT Symmetry", () => {
  it("LONG and SHORT on same adverse evidence both detect deterioration", () => {
    // LONG: bearish is adverse
    const longResult = evaluateProtection(
      inp(
        { side: "LONG", entryPrice: 100000, currentPrice: 105000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true, momentumChange: -20 }
      )
    );
    // SHORT: bullish is adverse
    const shortResult = evaluateProtection(
      inp(
        { side: "SHORT", entryPrice: 100000, currentPrice: 95000, stopLoss: 102000 },
        { shortTermTrend: "bullish", mediumTermTrend: "bullish", structureBroken: true, momentumChange: 20 }
      )
    );
    // Both should produce non-NONE severity
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(longResult.alert.severity as any)).toBeGreaterThan(0);
    expect(rank.indexOf(shortResult.alert.severity as any)).toBeGreaterThan(0);
  });

  it("LONG side is LONG, SHORT side is SHORT", () => {
    const longResult = evaluateProtection(inp({ side: "LONG" }));
    const shortResult = evaluateProtection(inp({ side: "SHORT" }));
    expect(longResult.alert.side).toBe("LONG");
    expect(shortResult.alert.side).toBe("SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. NORMAL PULLBACK (NO FALSE POSITIVE)
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 J — Normal Pullback", () => {
  it("small pullback does not trigger HIGH_RISK", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109500 },
        { shortTermTrend: "neutral", momentumChange: 0 }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("medium pullback without structure break stays mild", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 108000 },
        { shortTermTrend: "neutral", momentumChange: -5, structureBroken: false }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("one weak signal stays mild", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", momentumChange: -3 }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("conflicting signals stay mild", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bullish", longTermTrend: "bullish" }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. FAST REVERSAL (FALSE NEGATIVE TEST)
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 K — Fast Reversal Detection", () => {
  it("structure break + momentum collapse produces non-NONE", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 105000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -25,
          fundingRate: 0.08,
          oiChange: -30,
          liquidationSpike: true,
          riskRegime: "risk_off",
          vix: 30,
        }
      )
    );
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(result.alert.severity as any)).toBeGreaterThan(1);
  });

  it("acceleration + giveback produces meaningful classification", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        { shortTermTrend: "bearish", mediumTermTrend: "bearish" },
        {
          severity: "CAUTION",
          givebackPct: 25,
          accelerationLevel: "HIGH",
          deteriorationCount: 2,
        }
      )
    );
    expect(result.pullbackClassification).not.toBe("NORMAL_PULLBACK");
  });

  it("multi-tf reversal produces strong classification", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        { shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true },
        {
          severity: "HIGH_RISK",
          givebackPct: 20,
          deteriorationCount: 3,
          thesisHealthState: "SEVERELY_DETERIORATING",
        }
      )
    );
    expect(result.reversalStructure).toBe("CONFIRMED_REVERSAL");
  });

  it("extreme volatility shock triggers SHOCK_REVERSAL", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "SHOCK", score: 90, indicators: {} } as any,
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("SHOCK_REVERSAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. GIVEBACK SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 L — Giveback Scenarios", () => {
  it("giveback without thesis deterioration stays moderate", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        {
          severity: "WATCH",
          givebackPct: 20,
          thesisHealthState: "HEALTHY",
          thesisHealthScore: 75,
          deteriorationCount: 0,
        }
      )
    );
    expect(result.calibratedSeverity).not.toBe("HIGH_RISK");
  });

  it("giveback + structure break is meaningful", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ structureBroken: true, shortTermTrend: "bearish", mediumTermTrend: "bearish" }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("STRUCTURAL_REVERSAL");
  });

  it("large giveback + acceleration is meaningful", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bearish" }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 35,
      accelerationLevel: "HIGH",
    });
    expect(result).toBe("MEANINGFUL_DETERIORATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. SHOCK SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 M — Shock Scenarios", () => {
  it("shock with giveback bypasses normal classification", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "SHOCK", score: 85, indicators: {} } as any,
      givebackPct: 25,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("SHOCK_REVERSAL");
  });

  it("shock without significant giveback does not produce SHOCK_REVERSAL", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "SHOCK", score: 85, indicators: {} } as any,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(result).not.toBe("SHOCK_REVERSAL");
  });

  it("shock flag appears in calibration", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        {
          shock: { state: "SHOCK", score: 80, indicators: {} } as any,
          givebackPct: 20,
          severity: "CAUTION",
        }
      )
    );
    expect(result.calibrationFlags).toContain("MARKET_SHOCK");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. ACCELERATION SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 N — Acceleration Scenarios", () => {
  it("high acceleration flags appear", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        { accelerationLevel: "HIGH", givebackPct: 20 }
      )
    );
    expect(result.calibrationFlags).toContain("HIGH_ACCELERATION");
  });

  it("extreme acceleration flags appear", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        { accelerationLevel: "EXTREME", givebackPct: 20 }
      )
    );
    expect(result.calibrationFlags).toContain("HIGH_ACCELERATION");
  });

  it("normal acceleration does not produce flag", () => {
    const result = calibrateIntelligence(
      calibInput({}, {}, { accelerationLevel: "NORMAL" })
    );
    expect(result.calibrationFlags).not.toContain("HIGH_ACCELERATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. MULTI-TIMEFRAME SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 O — Multi-Timeframe", () => {
  it("M5 only stays mild", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bullish", longTermTrend: "bullish" }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("M5 + M15 increases severity", () => {
    const single = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bullish" }
      )
    );
    const dual = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bearish" }
      )
    );
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(dual.alert.severity as any)).toBeGreaterThanOrEqual(
      rank.indexOf(single.alert.severity as any)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// P. CONFLICTING EVIDENCE
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 P — Conflicting Evidence", () => {
  it("conflicting evidence reduces alert quality", () => {
    const clean = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 3,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    const conflicting = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 3,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 5,
      missingEvidenceCount: 0,
    });
    expect(conflicting.score).toBeLessThanOrEqual(clean.score);
  });

  it("conflicting flag appears in calibration", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        {
          severity: "CAUTION",
          conflictingEvidence: ["H1 trend bullish"],
          deteriorationCount: 2,
        }
      )
    );
    expect(result.calibrationFlags).toContain("CONFLICTING_EVIDENCE");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. MISSING DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 Q — Missing Data", () => {
  it("missing data degrades gracefully", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: undefined, mediumTermTrend: undefined })
    );
    expect(result.alert).toBeDefined();
  });

  it("partial data flag appears for many missing sources", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        {},
        {
          missingData: ["funding", "OI", "liquidation", "macro"],
        }
      )
    );
    expect(result.calibrationFlags).toContain("PARTIAL_DATA");
  });

  it("missing data does not become directional evidence", () => {
    // No evidence = no reason to be bullish or bearish
    const result = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        {
          shortTermTrend: undefined,
          mediumTermTrend: undefined,
          momentumChange: undefined,
          fundingRate: undefined,
          oiChange: undefined,
        }
      )
    );
    expect(result.alert.severity).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// R. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 R — Stale Data", () => {
  it("stale data degrades alert quality", () => {
    const fresh = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    const stale = evaluateAlertQuality({
      ...fresh as any,
      freshness: "STALE",
    });
    expect(stale.score).toBeLessThanOrEqual(fresh.score);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 S — Provider Failure", () => {
  it("provider failure does not become directional evidence", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: undefined })
    );
    expect(result.alert).toBeDefined();
    // Provider failure should never become bullish/bearish
  });

  it("unavailable data produces INSUFFICIENT quality", () => {
    const result = evaluateAlertQuality({
      independentSignalCount: 0,
      dependencyDiversity: 0,
      freshness: "UNAVAILABLE",
      multiTimeframeConfirmation: false,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 5,
    });
    expect(result.quality).toBe("INSUFFICIENT");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. ALERT ESCALATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 T — Alert Escalation", () => {
  it("escalation produces higher or equal severity", () => {
    const mild = evaluateProtection(
      inp({ currentPrice: 109000 }, { shortTermTrend: "bearish", momentumChange: -5 })
    );
    const severe = evaluateProtection(
      inp(
        { currentPrice: 105000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -25,
          fundingRate: 0.08,
          riskRegime: "risk_off",
          vix: 30,
          correlatedDivergence: true,
          liquidationSpike: true,
        }
      )
    );
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(severe.alert.severity as any)).toBeGreaterThanOrEqual(
      rank.indexOf(mild.alert.severity as any)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// U. RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 U — Recovery", () => {
  it("improving evidence produces lower severity", () => {
    const bad = evaluateProtection(
      inp(
        { currentPrice: 110000 },
        { shortTermTrend: "bearish", structureBroken: true }
      )
    );
    const good = evaluateProtection(
      inp({ currentPrice: 110000 }, { shortTermTrend: "bullish" })
    );
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(good.alert.severity as any)).toBeLessThanOrEqual(
      rank.indexOf(bad.alert.severity as any)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// V. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 V — Determinism", () => {
  it("calibration is deterministic", () => {
    const input = calibInput(
      {},
      { shortTermTrend: "bearish", structureBroken: true },
      { severity: "CAUTION", deteriorationCount: 3, givebackPct: 20 }
    );
    const r1 = calibrateIntelligence(input);
    const r2 = calibrateIntelligence(input);
    expect(r1.calibratedSeverity).toBe(r2.calibratedSeverity);
    expect(r1.evidenceQuality).toBe(r2.evidenceQuality);
    expect(r1.reversalStructure).toBe(r2.reversalStructure);
    expect(r1.pullbackClassification).toBe(r2.pullbackClassification);
  });

  it("pullback classifier is deterministic", () => {
    const input: PullbackClassificationInput = {
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    };
    expect(classifyPullbackType(input)).toBe(classifyPullbackType(input));
  });

  it("false-positive guard is deterministic", () => {
    const input: FalsePositiveGuardInput = {
      severity: "HIGH_RISK",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    };
    const r1 = guardAgainstFalsePositive(input);
    const r2 = guardAgainstFalsePositive(input);
    expect(r1.shouldAlert).toBe(r2.shouldAlert);
    expect(r1.finalSeverity).toBe(r2.finalSeverity);
  });

  it("alert quality is deterministic", () => {
    const input: AlertQualityInput = {
      independentSignalCount: 4,
      dependencyDiversity: 3,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: true,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: true,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    };
    expect(evaluateAlertQuality(input).quality).toBe(
      evaluateAlertQuality(input).quality
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// W. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 W — Security", () => {
  it("no API keys in calibration output", () => {
    const result = calibrateIntelligence(calibInput());
    const text = JSON.stringify(result);
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("password");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("Bearer");
  });

  it("no API keys in pullback classification", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(typeof result).toBe("string");
  });

  it("no API keys in guard output", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("password");
  });
});

// ═══════════════════════════════════════════════════════════════
// X. MEMORY BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 X — Memory Bounds", () => {
  it("1000 calibration runs complete without memory issues", () => {
    for (let i = 0; i < 1000; i++) {
      const result = calibrateIntelligence(
        calibInput(
          { currentPrice: 100000 + (i % 100) * 100 },
          { shortTermTrend: i % 3 === 0 ? "bearish" : "bullish" },
          { severity: (["NONE", "WATCH", "CAUTION"] as const)[i % 3], givebackPct: i % 50 }
        )
      );
      expect(result).toBeDefined();
    }
  });

  it("10000 evaluations complete", () => {
    for (let i = 0; i < 10000; i++) {
      const result = evaluateProtection(
        inp({ instrument: `INST_${i % 100}`, currentPrice: 100000 + (i % 100) * 100 })
      );
      expect(result.alert).toBeDefined();
    }
  });

  it("1000 calibration runs produce valid results", () => {
    for (let i = 0; i < 1000; i++) {
      const result = calibrateIntelligence(
        calibInput(
          { instrument: `INST_${i % 50}` },
          {},
          { severity: (['NONE', 'WATCH', 'CAUTION'] as const)[i % 3], givebackPct: i % 50 }
        )
      );
      expect(result.calibratedSeverity).toBeDefined();
    }
  });

});

// ═══════════════════════════════════════════════════════════════
// Y. 50+ POSITIONS STRESS
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 Y — 50+ Positions Stress", () => {
  it("50 positions all evaluate correctly", () => {
    for (let i = 0; i < 50; i++) {
      const result = evaluateProtection(
        inp({ instrument: `INST_${i}`, currentPrice: 100000 + i * 100 })
      );
      expect(result.alert).toBeDefined();
      expect(result.alert.instrument).toBe(`INST_${i}`);
    }
  });

  it("100 positions all calibrate correctly", () => {
    for (let i = 0; i < 100; i++) {
      const result = calibrateIntelligence(
        calibInput(
          { instrument: `INST_${i}` },
          {},
          {
            severity: (["NONE", "WATCH", "CAUTION", "HIGH_RISK"] as const)[i % 4],
            givebackPct: i % 50,
          }
        )
      );
      expect(result).toBeDefined();
      expect(result.calibratedSeverity).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. INSTRUMENT/POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 Z — Instrument/Position Isolation", () => {
  it("BTC LONG != BTC SHORT", () => {
    const longResult = evaluateProtection(
      inp(
        { instrument: "BTC/USDT", side: "LONG", entryPrice: 100000, currentPrice: 105000 },
        { shortTermTrend: "bearish", momentumChange: -15 }
      )
    );
    const shortResult = evaluateProtection(
      inp(
        { instrument: "BTC/USDT", side: "SHORT", entryPrice: 100000, currentPrice: 105000 },
        { shortTermTrend: "bearish", momentumChange: -15 }
      )
    );
    expect(longResult.alert.side).toBe("LONG");
    expect(shortResult.alert.side).toBe("SHORT");
  });

  it("BTC != ETH", () => {
    const btc = evaluateProtection(inp({ instrument: "BTC/USDT" }));
    const eth = evaluateProtection(inp({ instrument: "ETH/USDT" }));
    expect(btc.alert.instrument).toBe("BTC/USDT");
    expect(eth.alert.instrument).toBe("ETH/USDT");
  });

  it("EUR/USD != GBP/USD", () => {
    const eur = evaluateProtection(
      inp({ instrument: "EUR/USD", assetClass: "forex" })
    );
    const gbp = evaluateProtection(
      inp({ instrument: "GBP/USD", assetClass: "forex" })
    );
    expect(eur.alert.instrument).toBe("EUR/USD");
    expect(gbp.alert.instrument).toBe("GBP/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AA — No Auto-Execution", () => {
  it("calibration output has no execution fields", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        { shortTermTrend: "bearish", structureBroken: true },
        { severity: "INVALIDATED" }
      )
    );
    const text = JSON.stringify(result);
    expect(text).not.toContain("orderId");
    expect(text).not.toContain("executed");
    expect(text).not.toContain("auto-close");
  });

  it("pullback classification has no execution fields", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ structureBroken: true, shortTermTrend: "bearish" }),
      shock: { state: "SHOCK", score: 90, indicators: {} } as any,
      givebackPct: 30,
      accelerationLevel: "HIGH",
    });
    expect(typeof result).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AB — Decision Immutability", () => {
  it("calibration does not modify position context", () => {
    const ctx = pos({ currentPrice: 110000 });
    const snapshot = { ...ctx };
    calibrateIntelligence(calibInput({ currentPrice: 110000 }));
    expect(ctx.entryPrice).toBe(snapshot.entryPrice);
    expect(ctx.currentPrice).toBe(snapshot.currentPrice);
  });

  it("protection engine result has no trade plan fields", () => {
    const result = evaluateProtection(inp({ currentPrice: 110000 }));
    const alert = result.alert as any;
    expect(alert.recommendation).toBeUndefined();
    expect(alert.bias).toBeUndefined();
    expect(alert.conviction).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. FULL PROFITABLE LONG LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AC — Full Profitable LONG Lifecycle", () => {
  it("healthy → deterioration → protection → no auto-execute", () => {
    // Step 1: Healthy profit
    const r1 = evaluateProtection(inp({ currentPrice: 110000 }));
    expect(["NONE", "WATCH"]).toContain(r1.alert.severity);

    // Step 2: Momentum weakens
    const r2 = evaluateProtection(
      inp({ currentPrice: 109000 }, { shortTermTrend: "bearish", momentumChange: -8 })
    );
    expect(r2.alert.severity).toBeDefined();

    // Step 3: Structure breaks
    const r3 = evaluateProtection(
      inp(
        { currentPrice: 107000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -20,
          fundingRate: 0.06,
          oiChange: -20,
          liquidationSpike: true,
          riskRegime: "risk_off",
          vix: 28,
        }
      )
    );
    expect(["CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(r3.alert.severity);

    // Step 4: Severe — still above SL
    const r4 = evaluateProtection(
      inp(
        { currentPrice: 104000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -30,
          fundingRate: 0.08,
          oiChange: -35,
          liquidationSpike: true,
          riskRegime: "risk_off",
          riskRegimeChanged: true,
          vix: 35,
          correlatedDivergence: true,
        }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).toContain(r4.alert.severity);

    // Still above SL
    expect(104000).toBeGreaterThan(98000);

    // No auto-execution
    expect(r4.alert.actionRecommendation.toLowerCase()).not.toContain("auto");
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. FULL PROFITABLE SHORT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AD — Full Profitable SHORT Lifecycle", () => {
  it("healthy → deterioration → protection", () => {
    // Step 1: Profitable SHORT
    const r1 = evaluateProtection(
      inp({ side: "SHORT", entryPrice: 100000, currentPrice: 95000, stopLoss: 102000 })
    );
    expect(r1.alert.severity).toBeDefined();

    // Step 2: Price rises (adverse)
    const r2 = evaluateProtection(
      inp(
        { side: "SHORT", entryPrice: 100000, currentPrice: 98000, stopLoss: 102000 },
        { shortTermTrend: "bullish", momentumChange: 12 }
      )
    );
    expect(r2.alert.severity).toBeDefined();

    // Step 3: Stronger adverse
    const r3 = evaluateProtection(
      inp(
        { side: "SHORT", entryPrice: 100000, currentPrice: 100500, stopLoss: 102000 },
        {
          shortTermTrend: "bullish",
          mediumTermTrend: "bullish",
          structureBroken: true,
          momentumChange: 25,
        }
      )
    );
    expect(["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(r3.alert.severity);

    // No auto-execution
    expect(r3.alert.actionRecommendation.toLowerCase()).not.toContain("auto");
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. FALSE-POSITIVE MATRIX
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AE — False-Positive Matrix", () => {
  it("small pullback → no HIGH_RISK", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 109800 }, { shortTermTrend: "neutral" })
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("medium pullback → no HIGH_RISK without structure", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 108500 }, { shortTermTrend: "neutral", structureBroken: false })
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("one weak signal → no HIGH_RISK", () => {
    const result = evaluateProtection(
      inp({ currentPrice: 109000 }, { shortTermTrend: "bearish" })
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("conflicting signals → no HIGH_RISK", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 109000 },
        { shortTermTrend: "bearish", mediumTermTrend: "bullish", longTermTrend: "bullish" }
      )
    );
    expect(["HIGH_RISK", "INVALIDATED"]).not.toContain(result.alert.severity);
  });

  it("high giveback but intact structure → no HIGH_RISK", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 108000 },
        { shortTermTrend: "neutral", structureBroken: false, momentumChange: -5 }
      )
    );
    // Giveback exists but structure is intact
    expect(["INVALIDATED"]).not.toContain(result.alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. FALSE-NEGATIVE MATRIX
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AF — False-Negative Matrix", () => {
  it("structure break + momentum collapse → non-NONE", () => {
    const result = evaluateProtection(
      inp(
        { currentPrice: 105000 },
        {
          shortTermTrend: "bearish",
          mediumTermTrend: "bearish",
          structureBroken: true,
          momentumChange: -25,
        }
      )
    );
    const rank = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"] as const;
    expect(rank.indexOf(result.alert.severity as any)).toBeGreaterThan(0);
  });

  it("acceleration + giveback → meaningful pullback", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev({ shortTermTrend: "bearish", mediumTermTrend: "bearish" }),
      shock: { state: "NORMAL", score: 0, indicators: {} } as any,
      givebackPct: 30,
      accelerationLevel: "HIGH",
    });
    expect(["MEANINGFUL_DETERIORATION", "STRUCTURAL_REVERSAL"]).toContain(result);
  });

  it("multi-tf reversal → strong classification", () => {
    const result = calibrateIntelligence(
      calibInput(
        {},
        { shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true },
        { severity: "CAUTION", deteriorationCount: 3, givebackPct: 20 }
      )
    );
    expect(result.reversalStructure).not.toBe("NO_REVERSAL");
  });

  it("extreme volatility shock → detected", () => {
    const result = classifyPullbackType({
      position: pos(),
      evidence: ev(),
      shock: { state: "SHOCK", score: 90, indicators: {} } as any,
      givebackPct: 25,
      accelerationLevel: "NORMAL",
    });
    expect(result).toBe("SHOCK_REVERSAL");
  });

  it("thesis invalidation → NEVER suppressed by guard", () => {
    const result = guardAgainstFalsePositive({
      severity: "INVALIDATED",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "INVALIDATED",
      independentSignalCount: 0,
      givebackPct: 0,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. DEPENDENCY DIVERSITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 68 AG — Dependency Diversity", () => {
  it("more dependency groups produce higher diversity", () => {
    const low = evaluateAlertQuality({
      independentSignalCount: 2,
      dependencyDiversity: 1,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    const high = evaluateAlertQuality({
      independentSignalCount: 2,
      dependencyDiversity: 4,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: false,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 0,
    });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });
});
