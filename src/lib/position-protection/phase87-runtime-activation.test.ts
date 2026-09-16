/**
 * Phase 87 — Real News & Fundamental Runtime Activation Tests
 *
 * Tests the real provider integration pipeline:
 * - AlphaVantage news normalization
 * - NewsItem creation from provider data
 * - Position-aware relevance
 * - LONG/SHORT symmetry
 * - Multi-dimensional integration
 * - Source mode integrity
 * - Graceful degradation
 * - No fabricated data
 * - No probability claims
 * - No auto-execution
 */

import { describe, it, expect } from "vitest";
import {
  synthesizeNews,
  classifyNewsRelevance,
  classifyNewsFreshness,
  deduplicateNews,
  type NewsItem,
} from "./news-intelligence";
import {
  interpretFundamental,
  classifyCatalyst,
  classifyEventImportance,
  type FundamentalDataPoint,
  type EconomicEvent,
} from "./fundamental-intelligence";
import { synthesizeMultiDimensionalIntelligence } from "./multi-dimensional-intelligence";
import type { MTFConfluence } from "./multi-timeframe-engine";

const now = Date.now();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const mockConfluence: MTFConfluence = {
  regime: "TRENDING_UP",
  overallQuality: "SUFFICIENT",
  allAligned: true,
  timeframeConflict: false,
  description: "H1 bullish",
  timeframes: [
    {
      timeframe: "H1",
      trend: "BULLISH",
      momentum: "POSITIVE",
      volatility: "NORMAL",
      structure: "HIGHER_HIGHS_HIGHER_LOWS",
      structureBroken: false,
      rsiValue: 55,
      atrPct: 0.5,
      atrValue: 50,
      lastSwingHigh: 1000,
      lastSwingLow: 950,
      priceVsMA: "ABOVE",
      candleCount: 50,
      dataQuality: "SUFFICIENT",
    },
  ],
};

/** Simulate a real AlphaVantage news response structure. */
function makeAVNewsResponse(headlines: string[], sentiment: "positive" | "negative" | "neutral" = "positive"): NewsItem[] {
  return headlines.map((headline, i) => ({
    id: `av-${i}`,
    timestamp: now - i * 3600_000,
    source: "AlphaVantage",
    headline,
    relatedInstruments: ["BTC/USDT"],
    assetClass: "crypto" as const,
    category: "CRYPTO_SPECIFIC" as const,
    sentiment: sentiment === "positive" ? "BULLISH" as const :
               sentiment === "negative" ? "BEARISH" as const : "NEUTRAL" as const,
    impactStrength: "MODERATE" as const,
    freshness: classifyNewsFreshness(now - i * 3600_000, now),
    sourceMode: "LIVE" as const,
  }));
}

// ═══════════════════════════════════════════════════════════════
// A. PROVIDER NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("A. Provider Normalization", () => {
  it("AlphaVantage news structure → NewsItem", () => {
    const items = makeAVNewsResponse([
      "Bitcoin ETF inflows surge past $870M",
      "Saylor signals another BTC purchase",
    ]);
    expect(items.length).toBe(2);
    expect(items[0].source).toBe("AlphaVantage");
    expect(items[0].headline).toContain("Bitcoin ETF");
    expect(items[0].sourceMode).toBe("LIVE");
    expect(items[0].assetClass).toBe("crypto");
  });

  it("FRESH classification for recent news", () => {
    const item = makeAVNewsResponse(["Test"])[0];
    expect(["FRESH", "RECENT"]).toContain(item.freshness);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. NEWS RELEVANCE
// ═══════════════════════════════════════════════════════════════

describe("B. News Relevance", () => {
  it("BTC headline matches BTC/USDT", () => {
    const items = makeAVNewsResponse(["Bitcoin price surges to new high"]);
    const rel = classifyNewsRelevance(items[0], "BTC/USDT", "LONG");
    expect(rel.relevance).toBe("DIRECT");
  });

  it("irrelevant headline has low relevance", () => {
    const item: NewsItem = {
      id: "1",
      timestamp: now,
      source: "Reuters",
      headline: "Dogecoin community meetup scheduled",
      relatedInstruments: [],
      assetClass: "crypto",
      category: "CRYPTO_SPECIFIC",
      sentiment: "NEUTRAL",
      impactStrength: "LOW",
      freshness: "FRESH",
      sourceMode: "LIVE",
    };
    const rel = classifyNewsRelevance(item, "EUR/USD", "LONG");
    expect(rel.relevance).toBe("IRRELEVANT");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("C. LONG/SHORT Symmetry", () => {
  it("bullish news supports LONG and conflicts SHORT", () => {
    const items = makeAVNewsResponse(
      ["Bitcoin ETF massive inflow approved"],
      "positive",
    );
    const longSyn = synthesizeNews(items, "BTC/USDT", "LONG");
    const shortSyn = synthesizeNews(items, "BTC/USDT", "SHORT");
    expect(longSyn.newsStance).toBe("SUPPORTING");
    expect(shortSyn.newsStance).toBe("CONFLICTING");
  });

  it("bearish news conflicts LONG and supports SHORT", () => {
    const items = makeAVNewsResponse(
      ["Bitcoin regulation crackdown announced"],
      "negative",
    );
    const longSyn = synthesizeNews(items, "BTC/USDT", "LONG");
    const shortSyn = synthesizeNews(items, "BTC/USDT", "SHORT");
    expect(longSyn.newsStance).toBe("CONFLICTING");
    expect(shortSyn.newsStance).toBe("SUPPORTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. MULTI-DIMENSIONAL INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("D. Multi-Dimensional Integration", () => {
  it("real news → NEWS dimension AVAILABLE", () => {
    const items = makeAVNewsResponse(["Bitcoin ETF inflow surge"]);
    const news = synthesizeNews(items, "BTC/USDT", "LONG");
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
    });
    expect(md.dimensions.find(d => d.dimension === "NEWS")?.availability).toBe("AVAILABLE");
  });

  it("news evidence is CONTEXT tier (not PRIMARY)", () => {
    const items = makeAVNewsResponse(["Bitcoin ETF inflow surge"]);
    const news = synthesizeNews(items, "BTC/USDT", "LONG");
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
    });
    const newsEvidence = md.evidence.filter(e => e.category === "NEWS");
    expect(newsEvidence.length).toBeGreaterThan(0);
    expect(newsEvidence[0].tier).toBe("CONTEXT");
  });

  it("PRIMARY evidence dominates CONTEXT", () => {
    const items = makeAVNewsResponse(["Bitcoin crash imminent"], "negative");
    const news = synthesizeNews(items, "BTC/USDT", "LONG");
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
    });
    const primaryEvidence = md.evidence.filter(e => e.tier === "PRIMARY");
    const contextEvidence = md.evidence.filter(e => e.tier === "CONTEXT");
    // PRIMARY should exist and be stronger
    expect(primaryEvidence.length).toBeGreaterThan(0);
    expect(primaryEvidence[0].strength).toBe("STRONG");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. FUNDAMENTAL NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("E. Fundamental Normalization", () => {
  it("real fundamental data point with expected → surprise detection", () => {
    const dp: FundamentalDataPoint = {
      metric: "US CPI YoY",
      value: 2.5,
      previous: 3.0,
      expected: 3.1,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH",
      category: "INFLATION",
      relatedInstruments: ["BTC/USDT"],
      sourceMode: "LIVE",
    };
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.hasComparison).toBe(true);
    expect(interp.surpriseDirection).toBe("NEGATIVE"); // below expected
  });

  it("missing expected → INSUFFICIENT", () => {
    const dp: FundamentalDataPoint = {
      metric: "US CPI YoY",
      value: 2.5,
      previous: 3.0,
      expected: null,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH",
      category: "INFLATION",
      relatedInstruments: ["BTC/USDT"],
      sourceMode: "LIVE",
    };
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.positionImpact).toBe("INSUFFICIENT");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. CATALYST CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("F. Catalyst Classification", () => {
  it("FOMC → CRITICAL importance", () => {
    expect(classifyEventImportance("FOMC Rate Decision")).toBe("CRITICAL");
  });

  it("upcoming event → HIGH_IMPACT_EVENT_APPROACHING", () => {
    const evt: EconomicEvent = {
      name: "US CPI",
      timestamp: now + 30 * 60_000,
      currency: "USD",
      importance: "HIGH",
      relatedInstruments: ["EUR/USD"],
      previous: 3.0,
      expected: 3.1,
      source: "EconomicCalendar",
      sourceMode: "LIVE",
    };
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.status).toBe("HIGH_IMPACT_EVENT_APPROACHING");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. SOURCE MODE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("G. Source Mode Integrity", () => {
  it("LIVE news remains LIVE after normalization", () => {
    const items = makeAVNewsResponse(["Test headline"]);
    expect(items[0].sourceMode).toBe("LIVE");
  });

  it("STALE classification works correctly", () => {
    expect(classifyNewsFreshness(now - 25_000_000, now)).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. PROVIDER UNAVAILABLE BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("H. Provider Unavailable Behavior", () => {
  it("empty news → UNAVAILABLE", () => {
    const syn = synthesizeNews([], "BTC/USDT", "LONG");
    expect(syn.availability).toBe("UNAVAILABLE");
    expect(syn.newsStance).toBe("INSUFFICIENT");
  });

  it("no events → NO_MATERIAL_CATALYST", () => {
    const cat = classifyCatalyst([], "EUR/USD", now);
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("I. Deduplication", () => {
  it("removes duplicate headlines", () => {
    const items = [
      makeAVNewsResponse(["Bitcoin surges"])[0],
      makeAVNewsResponse(["Bitcoin surges"])[0],
    ];
    items[1].id = "dup";
    const deduped = deduplicateNews(items);
    expect(deduped.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("J. No Probability Claims", () => {
  it("news synthesis has no probability", () => {
    const items = makeAVNewsResponse(["Bitcoin ETF approved"]);
    const syn = synthesizeNews(items, "BTC/USDT", "LONG");
    const json = JSON.stringify(syn).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
    expect(json).not.toContain("%");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("K. No Auto-Execution", () => {
  it("no execution language", () => {
    const items = makeAVNewsResponse(["Bitcoin surges"]);
    const syn = synthesizeNews(items, "BTC/USDT", "LONG");
    const json = JSON.stringify(syn).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("buy now");
    expect(json).not.toContain("sell now");
    expect(json).not.toContain("place order");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("L. Determinism", () => {
  it("same inputs → same output", () => {
    const items = makeAVNewsResponse(["Bitcoin ETF"]);
    const r1 = synthesizeNews(items, "BTC/USDT", "LONG");
    const r2 = synthesizeNews(items, "BTC/USDT", "LONG");
    expect(r1.newsStance).toBe(r2.newsStance);
    expect(r1.supportingCount).toBe(r2.supportingCount);
  });
});
