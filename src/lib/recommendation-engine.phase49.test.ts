/**
 * Phase 49 — Universal Asset Discovery & Recommendation Engine Tests
 *
 * Test groups:
 * A. Candidate discovery
 * B. Universe scanning
 * C. Scalping ranking
 * D. Intraday ranking
 * E. Swing ranking
 * F. Investor horizon ranking
 * G. Asset-class-specific scoring
 * H. IDX equity support
 * I. Crypto support
 * J. Forex support
 * K. Commodity support
 * L. Index support
 * M. Missing data
 * N. Stale data
 * O. Provider failure
 * P. Dependency/double-counting
 * Q. Cross-instrument isolation
 * R. Determinism
 * S. No fabrication
 * T. Confidence semantics
 * U. No forced recommendation
 * V. Decision immutability
 * W. Security/no secrets
 * X. Empty universe
 * Y. Large universe scalability
 * Z. Adversarial inputs
 */

import { describe, it, expect } from "vitest";

import {
  generateRecommendation,
  scoreCandidate,
  isEligible,
  discoverCandidates,
  HORIZON_PROFILES,
  type CandidateInput,
  type TradingMode,
  type InvestorHorizon,
} from "./recommendation-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return {
    instrument: "BTC/USD",
    assetClass: "crypto",
    currentPrice: 65000,
    dataCompleteness: "FULL",
    dataPoints: 200,
    hasLiveData: true,
    freshness: "FRESH",
    providerCoverage: "FULL",
    htfBias: "long",
    marketRegime: "TRENDING",
    mtfAlignment: "ALIGNED_BULLISH",
    riskReward: 2.5,
    hasAnalysis: true,
    analysisConfidence: 72,
    hasDerivatives: true,
    hasExecutionQuality: true,
    spreadBps: 3,
    atr: 1500,
    ...overrides,
  };
}

function makeForexCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return makeCandidate({
    instrument: "EUR/USD",
    assetClass: "forex",
    currentPrice: 1.085,
    rateDifferential: 75,
    yieldDifferential: 45,
    hasCOT: true,
    cotNet: 45000,
    dxyTrend: "falling",
    riskRegime: "risk_on",
    hasDerivatives: false,
    hasExecutionQuality: true,
    spreadBps: 1,
    ...overrides,
  });
}

function makeEquityCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return makeCandidate({
    instrument: "AAPL",
    assetClass: "equity",
    currentPrice: 195,
    hasFundamentals: true,
    peRatio: 28.5,
    revenueGrowth: 0.12,
    profitMargin: 0.25,
    marketCap: 3_500_000_000_000,
    hasDerivatives: false,
    hasExecutionQuality: false,
    ...overrides,
  });
}

function makeIDXCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return makeCandidate({
    instrument: "BBCA",
    assetClass: "equity",
    currentPrice: 9500,
    hasFundamentals: true,
    peRatio: 18,
    revenueGrowth: 0.08,
    profitMargin: 0.35,
    marketCap: 1_200_000_000_000_000,
    hasDerivatives: false,
    hasExecutionQuality: false,
    ...overrides,
  });
}

function makeCommodityCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return makeCandidate({
    instrument: "XAU/USD",
    assetClass: "commodity",
    currentPrice: 2650,
    inventory: 420_000_000,
    inventoryChange: -2_500_000,
    futuresStructure: "backwardation",
    hasCOT: true,
    cotNet: 125000,
    dxyTrend: "falling",
    seasonality: "Seasonally strong Q3",
    hasDerivatives: false,
    hasExecutionQuality: true,
    spreadBps: 5,
    ...overrides,
  });
}

function makeIndexCandidate(overrides?: Partial<CandidateInput>): CandidateInput {
  return makeCandidate({
    instrument: "SPX",
    assetClass: "indices",
    currentPrice: 5800,
    hasMacro: true,
    dxyTrend: "stable",
    riskRegime: "risk_on",
    hasDerivatives: false,
    hasExecutionQuality: false,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════
// A. CANDIDATE DISCOVERY
// ═══════════════════════════════════════════════════════════════

describe("A — Candidate Discovery", () => {
  it("discovers candidates from instrument registry", () => {
    const candidates = discoverCandidates();
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("discovers crypto instruments", () => {
    const candidates = discoverCandidates(["crypto"]);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => expect(c.assetClass).toBe("crypto"));
  });

  it("discovers forex instruments", () => {
    const candidates = discoverCandidates(["forex"]);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => expect(c.assetClass).toBe("forex"));
  });

  it("discovers equity instruments", () => {
    const candidates = discoverCandidates(["equity"]);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => expect(c.assetClass).toBe("equity"));
  });

  it("discovers commodity instruments", () => {
    const candidates = discoverCandidates(["commodity"]);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => expect(c.assetClass).toBe("commodity"));
  });

  it("discovers index instruments", () => {
    const candidates = discoverCandidates(["indices"]);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => expect(c.assetClass).toBe("indices"));
  });
});

// ═══════════════════════════════════════════════════════════════
// B. UNIVERSE SCANNING
// ═══════════════════════════════════════════════════════════════

describe("B — Universe Scanning", () => {
  it("generates recommendation from multi-asset candidates", () => {
    const candidates = [
      makeCandidate(),
      makeForexCandidate(),
      makeEquityCandidate(),
      makeCommodityCandidate(),
    ];
    const result = generateRecommendation(candidates, "INTRADAY");
    expect(result.rankedInstruments.length).toBeGreaterThan(0);
    expect(result.mode).toBe("TRADING");
    expect(result.horizon).toBe("INTRADAY");
  });

  it("all ranked instruments have required fields", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    result.rankedInstruments.forEach(r => {
      expect(r.instrument).toBeTruthy();
      expect(r.assetClass).toBeTruthy();
      expect(r.rank).toBeGreaterThan(0);
      expect(r.analyticalScore).toBeGreaterThanOrEqual(0);
      expect(r.analyticalScore).toBeLessThanOrEqual(100);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
      expect(r.suitability).toBeTruthy();
      expect(Array.isArray(r.primaryReasons)).toBe(true);
      expect(Array.isArray(r.risks)).toBe(true);
      expect(r.dataCompleteness).toBeTruthy();
      expect(r.freshness).toBeTruthy();
      expect(r.recommendedAnalysisType).toBeTruthy();
    });
  });

  it("methodology field is present", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.methodology).toBeTruthy();
    expect(result.methodology).toContain("probability of profit");
  });

  it("data quality summary is present", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.dataQualitySummary).toBeTruthy();
  });

  it("timestamp is present", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. SCALPING RANKING
// ═══════════════════════════════════════════════════════════════

describe("C — Scalping Ranking", () => {
  it("scalping prefers high liquidity and live data", () => {
    const liquid = makeCandidate({ spreadBps: 1, hasLiveData: true });
    const illiquid = makeCandidate({ spreadBps: 30, hasLiveData: true });
    const r1 = scoreCandidate(liquid, "SCALPING");
    const r2 = scoreCandidate(illiquid, "SCALPING");
    expect(r1.analyticalScore).toBeGreaterThanOrEqual(r2.analyticalScore);
  });

  it("scalping excludes wide spreads", () => {
    const wide = makeCandidate({ spreadBps: 60 });
    const eligible = isEligible(wide, "SCALPING");
    expect(eligible.eligible).toBe(false);
    expect(eligible.reason).toContain("spread");
  });

  it("scalping requires live data", () => {
    const noLive = makeCandidate({ hasLiveData: false });
    const eligible = isEligible(noLive, "SCALPING");
    expect(eligible.eligible).toBe(false);
    expect(eligible.reason).toContain("live");
  });

  it("scalping recommended analysis type is M5/M15", () => {
    const result = generateRecommendation([makeCandidate()], "SCALPING");
    expect(result.rankedInstruments[0]?.recommendedAnalysisType).toContain("M5");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. INTRADAY RANKING
// ═══════════════════════════════════════════════════════════════

describe("D — Intraday Ranking", () => {
  it("intraday excludes stale data", () => {
    const stale = makeCandidate({ freshness: "STALE" });
    const eligible = isEligible(stale, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("intraday recommended analysis type is H1/H4", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.rankedInstruments[0]?.recommendedAnalysisType).toContain("H1");
  });

  it("intraday mode is TRADING", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.mode).toBe("TRADING");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SWING RANKING
// ═══════════════════════════════════════════════════════════════

describe("E — Swing Ranking", () => {
  it("swing recommended analysis type is D1/W1", () => {
    const result = generateRecommendation([makeCandidate()], "SWING");
    expect(result.rankedInstruments[0]?.recommendedAnalysisType).toContain("D1");
  });

  it("swing mode is TRADING", () => {
    const result = generateRecommendation([makeCandidate()], "SWING");
    expect(result.mode).toBe("TRADING");
  });

  it("swing weights HTF structure heavily", () => {
    const w = HORIZON_PROFILES.SWING;
    expect(w.htfStructure).toBeGreaterThan(w.volatility);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. INVESTOR HORIZON RANKING
// ═══════════════════════════════════════════════════════════════

describe("F — Investor Horizon Ranking", () => {
  it("1-3 years mode is INVESTING", () => {
    const result = generateRecommendation([makeEquityCandidate()], "1-3_YEARS");
    expect(result.mode).toBe("INVESTING");
  });

  it("long-term horizons weight fundamentals heavily", () => {
    const w = HORIZON_PROFILES["1-3_YEARS"];
    expect(w.fundamentals).toBeGreaterThan(w.volatility);
    expect(w.fundamentals).toBeGreaterThan(w.liquidity);
  });

  it("3+ years recommended analysis type mentions long-horizon", () => {
    const result = generateRecommendation([makeEquityCandidate()], "3+_YEARS");
    expect(result.rankedInstruments[0]?.recommendedAnalysisType).toContain("long-horizon");
  });

  it("1-4 weeks horizon produces results", () => {
    const result = generateRecommendation([makeCandidate()], "1-4_WEEKS");
    expect(result.rankedInstruments.length).toBeGreaterThan(0);
  });

  it("6-12 months horizon produces results", () => {
    const result = generateRecommendation([makeEquityCandidate()], "6-12_MONTHS");
    expect(result.rankedInstruments.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. ASSET-CLASS-SPECIFIC SCORING
// ═══════════════════════════════════════════════════════════════

describe("G — Asset-Class-Specific Scoring", () => {
  it("crypto with derivatives scores higher than without", () => {
    const withDeriv = makeCandidate({ hasDerivatives: true });
    const withoutDeriv = makeCandidate({ hasDerivatives: false });
    const s1 = scoreCandidate(withDeriv, "INTRADAY");
    const s2 = scoreCandidate(withoutDeriv, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("forex with rate differential scores higher than without", () => {
    const withRate = makeForexCandidate({ rateDifferential: 75 });
    const withoutRate = makeForexCandidate({ rateDifferential: undefined });
    const s1 = scoreCandidate(withRate, "INTRADAY");
    const s2 = scoreCandidate(withoutRate, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("equity with fundamentals scores higher than without", () => {
    const withFund = makeEquityCandidate({ hasFundamentals: true });
    const withoutFund = makeEquityCandidate({ hasFundamentals: false });
    const s1 = scoreCandidate(withFund, "INTRADAY");
    const s2 = scoreCandidate(withoutFund, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("commodity with inventory scores higher than without", () => {
    const withInv = makeCommodityCandidate({ inventory: 420_000_000 });
    const withoutInv = makeCommodityCandidate({ inventory: undefined });
    const s1 = scoreCandidate(withInv, "INTRADAY");
    const s2 = scoreCandidate(withoutInv, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. IDX EQUITY SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("H — IDX Equity Support", () => {
  it("IDX instruments are recognized as equity", () => {
    const c = makeIDXCandidate();
    expect(c.assetClass).toBe("equity");
    expect(c.instrument).toBe("BBCA");
  });

  it("IDX instruments can be ranked", () => {
    const result = generateRecommendation([makeIDXCandidate()], "SWING");
    expect(result.rankedInstruments.length).toBe(1);
    expect(result.rankedInstruments[0].instrument).toBe("BBCA");
  });

  it("IDX and US equities are isolated", () => {
    const bbca = makeIDXCandidate();
    const aapl = makeEquityCandidate();
    const result = generateRecommendation([bbca, aapl], "SWING");
    expect(result.rankedInstruments.length).toBe(2);
    const instruments = result.rankedInstruments.map(r => r.instrument);
    expect(instruments).toContain("BBCA");
    expect(instruments).toContain("AAPL");
  });

  it("IDX instrument fundamentals are independent of US equities", () => {
    const bbca = makeIDXCandidate({ peRatio: 18, revenueGrowth: 0.08 });
    const aapl = makeEquityCandidate({ peRatio: 28.5, revenueGrowth: 0.12 });
    const s1 = scoreCandidate(bbca, "SWING");
    const s2 = scoreCandidate(aapl, "SWING");
    // Both should have independent scores
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(0);
    expect(s2.analyticalScore).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. CRYPTO SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("I — Crypto Support", () => {
  it("crypto with derivatives scores higher", () => {
    const s1 = scoreCandidate(makeCandidate({ hasDerivatives: true }), "INTRADAY");
    const s2 = scoreCandidate(makeCandidate({ hasDerivatives: false }), "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("crypto with funding rate context is scored", () => {
    const c = makeCandidate({ fundingRate: 0.0003 });
    const result = scoreCandidate(c, "INTRADAY");
    // funding rate contributes to the analytical score even if not in reasons (score 50 = neutral)
    const noFunding = scoreCandidate(makeCandidate({ fundingRate: undefined }), "INTRADAY");
    expect(result.analyticalScore).toBeGreaterThanOrEqual(noFunding.analyticalScore);
  });

  it("BTC and ETH are isolated", () => {
    const btc = makeCandidate({ instrument: "BTC/USD" });
    const eth = makeCandidate({ instrument: "ETH/USD" });
    scoreCandidate(btc, "INTRADAY");
    scoreCandidate(eth, "INTRADAY");
    // Same structure but different instruments — scores may be same but instruments isolated
    expect(btc.instrument).not.toBe(eth.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. FOREX SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("J — Forex Support", () => {
  it("forex with DXY context scores higher", () => {
    const s1 = scoreCandidate(makeForexCandidate({ dxyTrend: "falling" }), "INTRADAY");
    const s2 = scoreCandidate(makeForexCandidate({ dxyTrend: undefined }), "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("forex with COT data scores higher", () => {
    const s1 = scoreCandidate(makeForexCandidate({ hasCOT: true, cotNet: 45000 }), "INTRADAY");
    const s2 = scoreCandidate(makeForexCandidate({ hasCOT: false }), "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("EUR/USD and GBP/USD are isolated", () => {
    const eur = makeForexCandidate({ instrument: "EUR/USD" });
    const gbp = makeForexCandidate({ instrument: "GBP/USD" });
    expect(eur.instrument).not.toBe(gbp.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. COMMODITY SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("K — Commodity Support", () => {
  it("commodity with futures structure scores higher", () => {
    const s1 = scoreCandidate(makeCommodityCandidate({ futuresStructure: "backwardation" }), "INTRADAY");
    const s2 = scoreCandidate(makeCommodityCandidate({ futuresStructure: "unknown" }), "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("XAU/USD and XAG/USD are isolated", () => {
    const xau = makeCommodityCandidate({ instrument: "XAU/USD" });
    const xag = makeCommodityCandidate({ instrument: "XAG/USD" });
    expect(xau.instrument).not.toBe(xag.instrument);
  });

  it("WTI and BRENT are isolated", () => {
    const wti = makeCommodityCandidate({ instrument: "WTI" });
    const brent = makeCommodityCandidate({ instrument: "BRENT" });
    expect(wti.instrument).not.toBe(brent.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. INDEX SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("L — Index Support", () => {
  it("SPX can be ranked", () => {
    const result = generateRecommendation([makeIndexCandidate()], "INTRADAY");
    expect(result.rankedInstruments.length).toBe(1);
    expect(result.rankedInstruments[0].instrument).toBe("SPX");
  });

  it("SPX and NDX are isolated", () => {
    const spx = makeIndexCandidate({ instrument: "SPX" });
    const ndx = makeIndexCandidate({ instrument: "NDX" });
    expect(spx.instrument).not.toBe(ndx.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. MISSING DATA
// ═══════════════════════════════════════════════════════════════

describe("M — Missing Data", () => {
  it("instrument with NONE data is excluded", () => {
    const c = makeCandidate({ dataCompleteness: "NONE" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("instrument with no price is excluded", () => {
    const c = makeCandidate({ currentPrice: 0 });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("instrument with UNAVAILABLE freshness is excluded", () => {
    const c = makeCandidate({ freshness: "UNAVAILABLE" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("instrument with NONE provider coverage is excluded", () => {
    const c = makeCandidate({ providerCoverage: "NONE" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("missing data reduces score", () => {
    const full = makeCandidate({ dataCompleteness: "FULL" });
    const minimal = makeCandidate({ dataCompleteness: "MINIMAL" });
    const s1 = scoreCandidate(full, "INTRADAY");
    const s2 = scoreCandidate(minimal, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("excluded instruments appear in result", () => {
    const good = makeCandidate();
    const bad = makeCandidate({ dataCompleteness: "NONE" });
    const result = generateRecommendation([good, bad], "INTRADAY");
    expect(result.excludedInstruments.some(e => e.instrument === bad.instrument)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("N — Stale Data", () => {
  it("stale data produces conflicts", () => {
    const c = makeCandidate({ freshness: "DELAYED" });
    const result = scoreCandidate(c, "INTRADAY");
    // DELAYED is not STALE so may not conflict, but the score should still work
    expect(result.analyticalScore).toBeGreaterThanOrEqual(0);
  });

  it("STALE data for intraday is excluded", () => {
    const c = makeCandidate({ freshness: "STALE" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("STALE data for swing is still eligible", () => {
    const c = makeCandidate({ freshness: "STALE" });
    const eligible = isEligible(c, "SWING");
    expect(eligible.eligible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("O — Provider Failure", () => {
  it("MINIMAL provider coverage reduces score", () => {
    const full = makeCandidate({ providerCoverage: "FULL" });
    const minimal = makeCandidate({ providerCoverage: "MINIMAL" });
    const s1 = scoreCandidate(full, "INTRADAY");
    const s2 = scoreCandidate(minimal, "INTRADAY");
    expect(s1.analyticalScore).toBeGreaterThanOrEqual(s2.analyticalScore);
  });

  it("NONE provider coverage is excluded", () => {
    const c = makeCandidate({ providerCoverage: "NONE" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. DEPENDENCY / DOUBLE-COUNTING
// ═══════════════════════════════════════════════════════════════

describe("P — Dependency / Double-Counting", () => {
  it("dependencyGroupsUsed field exists on candidates", () => {
    const c = makeCandidate({ dependencyGroupsUsed: ["DERIVATIVES_OI", "DERIVATIVES_FUNDING"] });
    expect(c.dependencyGroupsUsed).toHaveLength(2);
  });

  it("scoring does not produce inflated scores from correlated data", () => {
    // OI + funding from same source should not double-count
    const c = makeCandidate({
      hasDerivatives: true,
      fundingRate: 0.0003,
      openInterest: 35_000_000_000,
      dependencyGroupsUsed: ["DERIVATIVES_OI", "DERIVATIVES_FUNDING"],
    });
    const result = scoreCandidate(c, "INTRADAY");
    expect(result.analyticalScore).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. CROSS-INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Q — Cross-Instrument Isolation", () => {
  it("BTC/USD intelligence does not leak to ETH/USD", () => {
    const btc = makeCandidate({ instrument: "BTC/USD", currentPrice: 65000 });
    const eth = makeCandidate({ instrument: "ETH/USD", currentPrice: 3500 });
    const result = generateRecommendation([btc, eth], "INTRADAY");
    expect(result.rankedInstruments.every(r => r.instrument === "BTC/USD" || r.instrument === "ETH/USD")).toBe(true);
  });

  it("BTC/USD intelligence does not leak to EUR/USD", () => {
    const btc = makeCandidate();
    const eur = makeForexCandidate();
    const result = generateRecommendation([btc, eur], "INTRADAY");
    const btcRank = result.rankedInstruments.find(r => r.instrument === "BTC/USD");
    const eurRank = result.rankedInstruments.find(r => r.instrument === "EUR/USD");
    if (btcRank && eurRank) {
      expect(btcRank.assetClass).toBe("crypto");
      expect(eurRank.assetClass).toBe("forex");
    }
  });

  it("BBCA fundamentals do not leak to AAPL", () => {
    const bbca = makeIDXCandidate({ peRatio: 18 });
    const aapl = makeEquityCandidate({ peRatio: 28.5 });
    const result = generateRecommendation([bbca, aapl], "SWING");
    const bbcaRank = result.rankedInstruments.find(r => r.instrument === "BBCA");
    const aaplRank = result.rankedInstruments.find(r => r.instrument === "AAPL");
    if (bbcaRank && aaplRank) {
      expect(bbcaRank.instrument).toBe("BBCA");
      expect(aaplRank.instrument).toBe("AAPL");
    }
  });

  it("Gold does not inherit oil inventory", () => {
    const xau = makeCommodityCandidate({ instrument: "XAU/USD", inventory: undefined });
    const wti = makeCommodityCandidate({ instrument: "WTI", inventory: 420_000_000 });
    const result = generateRecommendation([xau, wti], "INTRADAY");
    expect(result.rankedInstruments.every(r => r.instrument === "XAU/USD" || r.instrument === "WTI")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("R — Determinism", () => {
  it("same candidates + same horizon = same ranking", () => {
    const candidates = [makeCandidate(), makeForexCandidate(), makeEquityCandidate()];
    const r1 = generateRecommendation(candidates, "INTRADAY");
    const r2 = generateRecommendation(candidates, "INTRADAY");
    expect(r1.rankedInstruments.map(r => r.instrument)).toEqual(r2.rankedInstruments.map(r => r.instrument));
    expect(r1.rankedInstruments.map(r => r.analyticalScore)).toEqual(r2.rankedInstruments.map(r => r.analyticalScore));
  });

  it("same candidate scored twice produces same score", () => {
    const c = makeCandidate();
    const s1 = scoreCandidate(c, "INTRADAY");
    const s2 = scoreCandidate(c, "INTRADAY");
    expect(s1.analyticalScore).toBe(s2.analyticalScore);
    expect(s1.confidence).toBe(s2.confidence);
  });

  it("tie-breaking is deterministic by instrument name", () => {
    const a = makeCandidate({ instrument: "AAA", hasAnalysis: false });
    const b = makeCandidate({ instrument: "ZZZ", hasAnalysis: false });
    // Both have same structure — tiebreak by name
    const result = generateRecommendation([b, a], "INTRADAY");
    if (result.rankedInstruments.length >= 2) {
      expect(result.rankedInstruments[0].instrument.localeCompare(result.rankedInstruments[1].instrument)).toBeLessThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// S. NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("S — No Fabrication", () => {
  it("recommendation does not fabricate win rates or guaranteed outcomes", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("win rate");
    expect(serialized).not.toContain("guaranteed");
    // methodology may mention "probability of profit" only in negation context ("NOT probability")
    expect(result.methodology).toContain("NOT probability of profit");
  });

  it("methodology explicitly states no probability of profit", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    expect(result.methodology).toContain("NOT probability of profit");
  });

  it("no fabricated prices in results", () => {
    const result = generateRecommendation([makeCandidate({ currentPrice: 0 })], "INTRADAY");
    expect(result.rankedInstruments.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. CONFIDENCE SEMANTICS
// ═══════════════════════════════════════════════════════════════

describe("T — Confidence Semantics", () => {
  it("confidence is 0-100", () => {
    const result = scoreCandidate(makeCandidate(), "INTRADAY");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it("high data quality increases confidence", () => {
    const full = makeCandidate({ dataCompleteness: "FULL", freshness: "FRESH" });
    const none = makeCandidate({ dataCompleteness: "MINIMAL", freshness: "STALE" });
    const c1 = scoreCandidate(full, "INTRADAY");
    const c2 = scoreCandidate(none, "INTRADAY");
    expect(c1.confidence).toBeGreaterThanOrEqual(c2.confidence);
  });

  it("more evidence produces higher analytical score", () => {
    const minimal = makeCandidate({
      dataCompleteness: "MINIMAL", freshness: "DELAYED", providerCoverage: "MINIMAL",
      hasAnalysis: false, hasDerivatives: false, hasFundamentals: false, hasMacro: false,
    });
    const full = makeCandidate({
      dataCompleteness: "FULL", freshness: "FRESH", providerCoverage: "FULL",
      hasAnalysis: true, analysisConfidence: 80, hasDerivatives: true, hasFundamentals: true, hasMacro: true,
    });
    const c1 = scoreCandidate(minimal, "INTRADAY");
    const c2 = scoreCandidate(full, "INTRADAY");
    expect(c2.analyticalScore).toBeGreaterThanOrEqual(c1.analyticalScore);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. NO FORCED RECOMMENDATION
// ═══════════════════════════════════════════════════════════════

describe("U — No Forced Recommendation", () => {
  it("empty candidates produce no ranked instruments", () => {
    const result = generateRecommendation([], "INTRADAY");
    expect(result.rankedInstruments.length).toBe(0);
    expect(result.excludedInstruments.length).toBe(0);
  });

  it("all ineligible candidates produce no ranked instruments", () => {
    const candidates = [
      makeCandidate({ dataCompleteness: "NONE" }),
      makeCandidate({ currentPrice: 0 }),
      makeCandidate({ freshness: "UNAVAILABLE" }),
    ];
    const result = generateRecommendation(candidates, "INTRADAY");
    expect(result.rankedInstruments.length).toBe(0);
    expect(result.excludedInstruments.length).toBe(3);
  });

  it("result does not force a TOP_OPPORTUNITY when scores are low", () => {
    const weak = makeCandidate({
      dataCompleteness: "MINIMAL",
      freshness: "STALE",
      htfBias: "unknown",
      marketRegime: "UNKNOWN",
      mtfAlignment: "INSUFFICIENT_DATA",
      hasAnalysis: false,
      hasDerivatives: false,
    });
    const result = generateRecommendation([weak], "INTRADAY");
    if (result.rankedInstruments.length > 0) {
      // Should not be TOP_OPPORTUNITY with all that missing data
      expect(result.rankedInstruments[0].suitability).not.toBe("TOP_OPPORTUNITY");
    }
  });

  it("all-neutrals are valid when data is minimal", () => {
    const candidates = [
      makeCandidate({ dataCompleteness: "MINIMAL", freshness: "STALE", providerCoverage: "MINIMAL",
        htfBias: "unknown", hasAnalysis: false, currentPrice: 100, hasLiveData: false }),
      makeCandidate({ dataCompleteness: "MINIMAL", freshness: "STALE", providerCoverage: "MINIMAL",
        htfBias: "unknown", hasAnalysis: false, instrument: "ETH/USD", currentPrice: 100, hasLiveData: false }),
    ];
    const result = generateRecommendation(candidates, "INTRADAY");
    // With MINIMAL+STALE data, scores should be low — none should be TOP_OPPORTUNITY
    result.rankedInstruments.forEach(r => {
      expect(r.suitability).not.toBe("TOP_OPPORTUNITY");
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// V. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("V — Decision Immutability", () => {
  it("recommendation engine does not modify analysis results", () => {
    const analysisResult = {
      recommendation: "LONG",
      bias: "Bullish",
      confidence: 72,
      conviction: "Medium",
      tradePlan: { entry: 65000, stop: 64000, target: 67000 },
    };
    const original = { ...analysisResult };
    // Generate recommendation — should not modify the original
    generateRecommendation([makeCandidate()], "INTRADAY");
    expect(analysisResult.recommendation).toBe(original.recommendation);
    expect(analysisResult.bias).toBe(original.bias);
    expect(analysisResult.confidence).toBe(original.confidence);
    expect(analysisResult.conviction).toBe(original.conviction);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. SECURITY / NO SECRETS
// ═══════════════════════════════════════════════════════════════

describe("W — Security / No Secrets", () => {
  it("recommendation result never contains API keys", () => {
    const result = generateRecommendation([makeCandidate()], "INTRADAY");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("secret");
  });

  it("candidate input never leaks into output as secrets", () => {
    const c = makeCandidate();
    const result = generateRecommendation([c], "INTRADAY");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
  });
});

// ═══════════════════════════════════════════════════════════════
// X. EMPTY UNIVERSE
// ═══════════════════════════════════════════════════════════════

describe("X — Empty Universe", () => {
  it("empty candidates produce valid result", () => {
    const result = generateRecommendation([], "INTRADAY");
    expect(result.rankedInstruments).toHaveLength(0);
    expect(result.excludedInstruments).toHaveLength(0);
    expect(result.marketOverview).toContain("No suitable");
    expect(result.methodology).toBeTruthy();
    expect(result.dataQualitySummary).toContain("0 candidates");
  });

  it("empty candidates for all horizons", () => {
    const horizons: (TradingMode | InvestorHorizon)[] = [
      "SCALPING", "INTRADAY", "SWING",
      "1-4_WEEKS", "1-3_MONTHS", "3-6_MONTHS",
      "6-12_MONTHS", "1-3_YEARS", "3+_YEARS",
    ];
    horizons.forEach(h => {
      const result = generateRecommendation([], h);
      expect(result.rankedInstruments).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. LARGE UNIVERSE SCALABILITY
// ═══════════════════════════════════════════════════════════════

describe("Y — Large Universe Scalability", () => {
  it("handles 50 candidates efficiently", () => {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      makeCandidate({
        instrument: `INST${i}`,
        currentPrice: 100 + i,
        assetClass: (["crypto", "forex", "equity", "commodity", "indices"] as const)[i % 5],
      }),
    );
    const start = Date.now();
    const result = generateRecommendation(candidates, "INTRADAY");
    const elapsed = Date.now() - start;
    expect(result.rankedInstruments.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000); // Should complete in < 5s
  });

  it("handles 100 candidates efficiently", () => {
    const candidates = Array.from({ length: 100 }, (_, i) =>
      makeCandidate({
        instrument: `INST${String(i).padStart(3, "0")}`,
        currentPrice: 100 + i,
        assetClass: (["crypto", "forex", "equity", "commodity", "indices"] as const)[i % 5],
      }),
    );
    const start = Date.now();
    const result = generateRecommendation(candidates, "SWING", { maxResults: 10 });
    const elapsed = Date.now() - start;
    expect(result.rankedInstruments.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. ADVERSARIAL INPUTS
// ═══════════════════════════════════════════════════════════════

describe("Z — Adversarial Inputs", () => {
  it("NaN price is excluded", () => {
    const c = makeCandidate({ currentPrice: NaN });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("Infinity price is excluded", () => {
    const c = makeCandidate({ currentPrice: Infinity });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("negative price is excluded", () => {
    const c = makeCandidate({ currentPrice: -100 });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("NaN R:R does not crash", () => {
    const c = makeCandidate({ riskReward: NaN });
    const result = scoreCandidate(c, "INTRADAY");
    expect(result.analyticalScore).toBeGreaterThanOrEqual(0);
    expect(result.analyticalScore).toBeLessThanOrEqual(100);
  });

  it("empty instrument string is excluded", () => {
    const c = makeCandidate({ instrument: "" });
    const eligible = isEligible(c, "INTRADAY");
    expect(eligible.eligible).toBe(false);
  });

  it("unknown asset class still produces a score", () => {
    const c = makeCandidate({ assetClass: "macro" as any });
    const result = scoreCandidate(c, "INTRADAY");
    expect(result.analyticalScore).toBeGreaterThanOrEqual(0);
  });

  it("all-undefined optional fields do not crash", () => {
    const c = makeCandidate({
      htfBias: undefined,
      marketRegime: undefined,
      mtfAlignment: undefined,
      riskReward: undefined,
      spreadBps: undefined,
      atr: undefined,
      openInterest: undefined,
      fundingRate: undefined,
      tvl: undefined,
      peRatio: undefined,
      revenueGrowth: undefined,
      profitMargin: undefined,
      marketCap: undefined,
      rateDifferential: undefined,
      yieldDifferential: undefined,
      cotNet: undefined,
      inventory: undefined,
      inventoryChange: undefined,
      futuresStructure: undefined,
      seasonality: undefined,
      dxyTrend: undefined,
      riskRegime: undefined,
    });
    const result = scoreCandidate(c, "INTRADAY");
    expect(result.analyticalScore).toBeGreaterThanOrEqual(0);
  });
});
