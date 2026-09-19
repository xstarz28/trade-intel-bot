/**
 * Phase 85 — News & Fundamental Intelligence Tests
 *
 * Tests cover:
 * - News normalization, relevance, freshness, deduplication
 * - News position symmetry (LONG/SHORT)
 * - Fundamental normalization, interpretation
 * - Economic event classification
 * - Catalyst detection
 * - Evidence hierarchy with news/fundamental dimensions
 * - Missing-data behavior
 * - Provider failure neutrality
 * - LONG/SHORT symmetry
 * - Determinism
 * - No probability claims
 * - No auto-execution
 * - Source mode integrity
 * - Bounded memory
 */

import { describe, it, expect } from "vitest";
import {
  classifyNewsRelevance,
  classifyNewsFreshness,
  deduplicateNews,
  synthesizeNews,
  boundNewsItems,
  type NewsItem,
} from "./news-intelligence";
import {
  interpretFundamental,
  classifyCatalyst,
  classifyEventImportance,
  synthesizeFundamentals,
  boundFundamentals,
  boundEvents,
  type FundamentalDataPoint,
  type EconomicEvent,
} from "./fundamental-intelligence";
import {
  buildHierarchicalEvidence,
  synthesizeMultiDimensionalIntelligence,
} from "./multi-dimensional-intelligence";
import type { MTFConfluence } from "./multi-timeframe-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "1",
    timestamp: now - 300_000,
    source: "Reuters",
    headline: "Federal Reserve holds rates steady",
    relatedInstruments: ["EUR/USD", "GBP/USD", "USD/JPY"],
    assetClass: "macro",
    category: "CENTRAL_BANK",
    sentiment: "BULLISH",
    impactStrength: "HIGH",
    freshness: "FRESH",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeFundamental(overrides: Partial<FundamentalDataPoint> = {}): FundamentalDataPoint {
  return {
    metric: "US CPI YoY",
    value: 3.2,
    previous: 3.0,
    expected: 3.1,
    timestamp: now,
    source: "BLS",
    freshness: "FRESH",
    category: "INFLATION",
    relatedInstruments: ["EUR/USD", "XAU/USD"],
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    name: "FOMC Rate Decision",
    timestamp: now + 3600_000,
    currency: "USD",
    importance: "CRITICAL",
    relatedInstruments: ["EUR/USD", "GBP/USD", "USD/JPY"],
    previous: 5.25,
    expected: 5.25,
    source: "EconomicCalendar",
    sourceMode: "LIVE",
    ...overrides,
  };
}

const mockConfluence: MTFConfluence = {
  regime: "TRENDING_UP",
  overallQuality: "SUFFICIENT",
  allAligned: true,
  timeframeConflict: false,
  description: "H1 bullish, M15 bullish, M5 bullish — aligned",
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
    {
      timeframe: "M15",
      trend: "BULLISH",
      momentum: "POSITIVE",
      volatility: "NORMAL",
      structure: "HIGHER_HIGHS_HIGHER_LOWS",
      structureBroken: false,
      rsiValue: 52,
      atrPct: 0.4,
      atrValue: 20,
      lastSwingHigh: 1000,
      lastSwingLow: 950,
      priceVsMA: "ABOVE",
      candleCount: 50,
      dataQuality: "SUFFICIENT",
    },
    {
      timeframe: "M5",
      trend: "BULLISH",
      momentum: "POSITIVE",
      volatility: "NORMAL",
      structure: "HIGHER_HIGHS_HIGHER_LOWS",
      structureBroken: false,
      rsiValue: 48,
      atrPct: 0.3,
      atrValue: 10,
      lastSwingHigh: 1000,
      lastSwingLow: 950,
      priceVsMA: "ABOVE",
      candleCount: 50,
      dataQuality: "SUFFICIENT",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// A. NEWS NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("A. News Normalization", () => {
  it("creates valid NewsItem with all required fields", () => {
    const item = makeNewsItem();
    expect(item.id).toBeTruthy();
    expect(item.timestamp).toBeGreaterThan(0);
    expect(item.headline).toBeTruthy();
    expect(item.source).toBeTruthy();
    expect(item.sourceMode).toBe("LIVE");
  });

  it("news freshness FRESH for < 1 hour", () => {
    expect(classifyNewsFreshness(now - 1800_000, now)).toBe("FRESH");
  });

  it("news freshness RECENT for 1-6 hours", () => {
    expect(classifyNewsFreshness(now - 7200_000, now)).toBe("RECENT");
  });

  it("news freshness STALE for > 6 hours", () => {
    expect(classifyNewsFreshness(now - 25_000_000, now)).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. NEWS RELEVANCE
// ═══════════════════════════════════════════════════════════════

describe("B. News Relevance", () => {
  it("direct match for BTC headline", () => {
    const item = makeNewsItem({ headline: "Bitcoin ETF approved by SEC" });
    const rel = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    expect(rel.relevance).toBe("DIRECT");
  });

  it("moderate relevance for Fed news on forex", () => {
    const item = makeNewsItem({ headline: "Federal Reserve signals rate pause", relatedInstruments: [] });
    const rel = classifyNewsRelevance(item, "EUR/USD", "LONG");
    expect(["MODERATE", "LOW"]).toContain(rel.relevance);
  });

  it("irrelevant for unrelated instrument", () => {
    const item = makeNewsItem({ headline: "Dogecoin community event", relatedInstruments: [], category: "CRYPTO_SPECIFIC" });
    const rel = classifyNewsRelevance(item, "EUR/USD", "LONG");
    expect(rel.relevance).toBe("IRRELEVANT");
  });

  it("ETH headline matches ETH/USDT", () => {
    const item = makeNewsItem({ headline: "Ethereum upgrade goes live" });
    const rel = classifyNewsRelevance(item, "ETH/USDT", "LONG");
    expect(rel.relevance).toBe("DIRECT");
  });

  it("geopolitical news has moderate relevance for risk assets", () => {
    const item = makeNewsItem({
      headline: "Major geopolitical tension escalation",
      category: "GEOPOLITICAL",
    });
    const rel = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    expect(["MODERATE", "LOW", "IRRELEVANT"]).toContain(rel.relevance);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. NEWS DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("C. News Deduplication", () => {
  it("removes duplicate headlines", () => {
    const item1 = makeNewsItem({ id: "1", headline: "Fed holds rates", timestamp: now - 1000 });
    const item2 = makeNewsItem({ id: "2", headline: "Fed holds rates", timestamp: now });
    const deduped = deduplicateNews([item1, item2]);
    expect(deduped.length).toBe(1);
    expect(deduped[0].id).toBe("2"); // keeps newer
  });

  it("keeps distinct headlines", () => {
    const item1 = makeNewsItem({ headline: "Fed holds rates" });
    const item2 = makeNewsItem({ headline: "ECB cuts rates" });
    const deduped = deduplicateNews([item1, item2]);
    expect(deduped.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. NEWS POSITION SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("D. News Position Symmetry", () => {
  it("bullish news supports LONG and conflicts SHORT", () => {
    const item = makeNewsItem({
      headline: "Bitcoin ETF approved — massive institutional inflow",
      relatedInstruments: ["BTC/USDT"],
    });
    const longRel = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    const shortRel = classifyNewsRelevance(item, "BTC/USDT", "SHORT");
    expect(longRel.positionImpact).toBe("SUPPORTING");
    expect(shortRel.positionImpact).toBe("CONFLICTING");
  });

  it("bearish news conflicts LONG and supports SHORT", () => {
    const item = makeNewsItem({
      headline: "Bitcoin regulation crackdown announced",
      sentiment: "BEARISH",
      relatedInstruments: ["BTC/USDT"],
    });
    const longRel = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    const shortRel = classifyNewsRelevance(item, "BTC/USDT", "SHORT");
    expect(longRel.positionImpact).toBe("CONFLICTING");
    expect(shortRel.positionImpact).toBe("SUPPORTING");
  });

  it("neutral news is neutral for both", () => {
    const item = makeNewsItem({
      headline: "Fed holds rates as expected",
      sentiment: "NEUTRAL",
      relatedInstruments: ["EUR/USD"],
    });
    const longRel = classifyNewsRelevance(item, "EUR/USD", "LONG");
    const shortRel = classifyNewsRelevance(item, "EUR/USD", "SHORT");
    expect(longRel.positionImpact).toBe("NEUTRAL");
    expect(shortRel.positionImpact).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. NEWS SYNTHESIS
// ═══════════════════════════════════════════════════════════════

describe("E. News Synthesis", () => {
  it("no items → INSUFFICIENT", () => {
    const syn = synthesizeNews([], "BTC/USDT", "LONG");
    expect(syn.newsStance).toBe("INSUFFICIENT");
    expect(syn.availability).toBe("UNAVAILABLE");
  });

  it("single supporting item → SUPPORTING", () => {
    const item = makeNewsItem({
      headline: "Bitcoin ETF massive inflow",
      sentiment: "BULLISH",
      relatedInstruments: ["BTC/USDT"],
    });
    const syn = synthesizeNews([item], "BTC/USDT", "LONG");
    expect(syn.newsStance).toBe("SUPPORTING");
  });

  it("mixed items → MIXED", () => {
    const supporting = makeNewsItem({
      headline: "Bitcoin ETF massive inflow",
      sentiment: "BULLISH",
      relatedInstruments: ["BTC/USDT"],
    });
    const conflicting = makeNewsItem({
      headline: "Bitcoin regulation crackdown",
      sentiment: "BEARISH",
      relatedInstruments: ["BTC/USDT"],
      id: "2",
    });
    const syn = synthesizeNews([supporting, conflicting], "BTC/USDT", "LONG");
    expect(syn.newsStance).toBe("MIXED");
    expect(syn.supportingCount).toBeGreaterThan(0);
    expect(syn.conflictingCount).toBeGreaterThan(0);
  });

  it("deduplicates before synthesis", () => {
    const item1 = makeNewsItem({ headline: "Fed holds rates", sentiment: "BULLISH", relatedInstruments: ["EUR/USD"] });
    const item2 = makeNewsItem({ headline: "Fed holds rates", sentiment: "BULLISH", relatedInstruments: ["EUR/USD"], id: "2" });
    const syn = synthesizeNews([item1, item2], "EUR/USD", "LONG");
    // After dedup, should be 1 item
    expect(syn.relevantItems.length).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. FUNDAMENTAL NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("F. Fundamental Normalization", () => {
  it("creates valid data point", () => {
    const dp = makeFundamental();
    expect(dp.metric).toBeTruthy();
    expect(typeof dp.value).toBe("number");
    expect(dp.source).toBeTruthy();
  });

  it("bounds fundamental data", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeFundamental({ metric: `Metric ${i}` }),
    );
    expect(boundFundamentals(items).length).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. FUNDAMENTAL INTERPRETATION
// ═══════════════════════════════════════════════════════════════

describe("G. Fundamental Interpretation", () => {
  it("hotter-than-expected CPI conflicts LONG on crypto", () => {
    const dp = makeFundamental({ value: 3.5, expected: 3.1, previous: 3.0 });
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.positionImpact).toBe("CONFLICTING");
    expect(interp.hasComparison).toBe(true);
    expect(interp.surpriseDirection).toBe("POSITIVE");
  });

  it("cooler-than-expected CPI supports LONG on crypto", () => {
    const dp = makeFundamental({ value: 2.5, expected: 3.1, previous: 3.0 });
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.positionImpact).toBe("SUPPORTING");
    expect(interp.surpriseDirection).toBe("NEGATIVE");
  });

  it("no expected → INSUFFICIENT", () => {
    const dp = makeFundamental({ expected: null });
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.positionImpact).toBe("INSUFFICIENT");
    expect(interp.hasComparison).toBe(false);
  });

  it("in-line expectation → NEUTRAL", () => {
    const dp = makeFundamental({ value: 3.1, expected: 3.1, previous: 3.0 });
    const interp = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(interp.positionImpact).toBe("NEUTRAL");
    expect(interp.surpriseDirection).toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. ECONOMIC EVENT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("H. Economic Event Classification", () => {
  it("FOMC → CRITICAL", () => {
    expect(classifyEventImportance("FOMC Rate Decision")).toBe("CRITICAL");
  });

  it("CPI → HIGH", () => {
    expect(classifyEventImportance("US CPI")).toBe("HIGH");
  });

  it("NFP → HIGH", () => {
    expect(classifyEventImportance("Non-Farm Payrolls")).toBe("HIGH");
  });

  it("Consumer Sentiment → MODERATE", () => {
    expect(classifyEventImportance("University of Michigan Consumer Sentiment")).toBe("MODERATE");
  });

  it("unknown event → LOW", () => {
    expect(classifyEventImportance("Minor Regional Manufacturing")).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. CATALYST DETECTION
// ═══════════════════════════════════════════════════════════════

describe("I. Catalyst Detection", () => {
  it("no events → NO_MATERIAL_CATALYST", () => {
    const cat = classifyCatalyst([], "EUR/USD", now);
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });

  it("event in 30 minutes → HIGH_IMPACT_EVENT_APPROACHING", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.status).toBe("HIGH_IMPACT_EVENT_APPROACHING");
    expect(cat.positionSensitivity).toBe("HIGH");
  });

  it("event in 3 hours → POTENTIAL_CATALYST", () => {
    const evt = makeEvent({ timestamp: now + 3 * 3600_000 });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.status).toBe("POTENTIAL_CATALYST");
  });

  it("event 1 hour ago → RECENT_CATALYST", () => {
    const evt = makeEvent({ timestamp: now - 3600_000 });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.status).toBe("RECENT_CATALYST");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. EVIDENCE HIERARCHY WITH NEWS/FUNDAMENTALS
// ═══════════════════════════════════════════════════════════════

describe("J. Evidence Hierarchy with News/Fundamentals", () => {
  it("includes NEWS evidence when news is available", () => {
    const newsSyn = synthesizeNews(
      [makeNewsItem({ headline: "Bitcoin ETF inflow", sentiment: "BULLISH", relatedInstruments: ["BTC/USDT"] })],
      "BTC/USDT",
      "LONG",
    );
    const evidence = buildHierarchicalEvidence(
      mockConfluence,
      { riskRegime: "RISK_ON", vixLevel: 10, vixDescription: "low", positionImpact: "SUPPORTING", narrative: "risk on", availability: "AVAILABLE" },
      { pairs: [], correlationState: "INSUFFICIENT_DATA", positionImpact: "NEUTRAL", narrative: "neutral", availability: "UNAVAILABLE" },
      { fundingRate: null, oiChange: null, liquidationPressure: "NORMAL", positionImpact: "UNAVAILABLE", narrative: "no data", availability: "UNAVAILABLE" },
      "LONG",
      newsSyn,
      null,
    );
    const newsEvidence = evidence.filter(e => e.category === "NEWS");
    expect(newsEvidence.length).toBeGreaterThan(0);
  });

  it("includes FUNDAMENTAL evidence when fundamentals are available", () => {
    const fundSyn = synthesizeFundamentals(
      [makeFundamental({ value: 2.5, expected: 3.1, previous: 3.0 })],
      [],
      "BTC/USDT",
      "LONG",
      now,
    );
    const evidence = buildHierarchicalEvidence(
      mockConfluence,
      { riskRegime: "RISK_ON", vixLevel: 10, vixDescription: "low", positionImpact: "SUPPORTING", narrative: "risk on", availability: "AVAILABLE" },
      { pairs: [], correlationState: "INSUFFICIENT_DATA", positionImpact: "NEUTRAL", narrative: "neutral", availability: "UNAVAILABLE" },
      { fundingRate: null, oiChange: null, liquidationPressure: "NORMAL", positionImpact: "UNAVAILABLE", narrative: "no data", availability: "UNAVAILABLE" },
      "LONG",
      null,
      fundSyn,
    );
    const fundEvidence = evidence.filter(e => e.category === "FUNDAMENTAL");
    expect(fundEvidence.length).toBeGreaterThan(0);
  });

  it("no news/fundamentals → no extra evidence", () => {
    const evidence = buildHierarchicalEvidence(
      mockConfluence,
      { riskRegime: "RISK_ON", vixLevel: 10, vixDescription: "low", positionImpact: "SUPPORTING", narrative: "risk on", availability: "AVAILABLE" },
      { pairs: [], correlationState: "INSUFFICIENT_DATA", positionImpact: "NEUTRAL", narrative: "neutral", availability: "UNAVAILABLE" },
      { fundingRate: null, oiChange: null, liquidationPressure: "NORMAL", positionImpact: "UNAVAILABLE", narrative: "no data", availability: "UNAVAILABLE" },
      "LONG",
    );
    const newsEvidence = evidence.filter(e => e.category === "NEWS" || e.category === "FUNDAMENTAL");
    expect(newsEvidence.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. MULTI-DIMENSIONAL SYNTHESIS WITH NEWS
// ═══════════════════════════════════════════════════════════════

describe("K. Multi-Dimensional Synthesis with News", () => {
  it("includes news dimension in output", () => {
    const newsSyn = synthesizeNews(
      [makeNewsItem({ headline: "Bitcoin ETF inflow", sentiment: "BULLISH", relatedInstruments: ["BTC/USDT"] })],
      "BTC/USDT",
      "LONG",
    );
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news: newsSyn,
    });
    expect(result.news).toBeTruthy();
    expect(result.dimensions.some(d => d.dimension === "NEWS")).toBe(true);
  });

  it("news = null → NEWS dimension UNAVAILABLE", () => {
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    expect(result.news).toBeNull();
    expect(result.dimensions.find(d => d.dimension === "NEWS")?.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. MISSING DATA BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("L. Missing Data Behavior", () => {
  it("no news → UNAVAILABLE", () => {
    const syn = synthesizeNews([], "BTC/USDT", "LONG");
    expect(syn.availability).toBe("UNAVAILABLE");
    expect(syn.newsStance).toBe("INSUFFICIENT");
  });

  it("no events → NO_MATERIAL_CATALYST", () => {
    const cat = classifyCatalyst([], "EUR/USD", now);
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });

  it("no fundamentals → INSUFFICIENT", () => {
    const syn = synthesizeFundamentals([], [], "EUR/USD", "LONG", now);
    expect(syn.fundamentalStance).toBe("INSUFFICIENT");
    expect(syn.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("M. Determinism", () => {
  it("same inputs → same output (news)", () => {
    const item = makeNewsItem();
    const r1 = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    const r2 = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    expect(r1).toEqual(r2);
  });

  it("same inputs → same output (fundamental)", () => {
    const dp = makeFundamental();
    const r1 = interpretFundamental(dp, "LONG", "BTC/USDT");
    const r2 = interpretFundamental(dp, "LONG", "BTC/USDT");
    expect(r1).toEqual(r2);
  });

  it("same inputs → same output (catalyst)", () => {
    const evt = makeEvent();
    const r1 = classifyCatalyst([evt], "EUR/USD", now);
    const r2 = classifyCatalyst([evt], "EUR/USD", now);
    expect(r1.status).toEqual(r2.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("N. No Probability Claims", () => {
  it("no percentage/probability in news synthesis", () => {
    const items = [
      makeNewsItem({ headline: "Bitcoin ETF inflow", sentiment: "BULLISH", relatedInstruments: ["BTC/USDT"] }),
      makeNewsItem({ headline: "Bitcoin regulation", sentiment: "BEARISH", relatedInstruments: ["BTC/USDT"], id: "2" }),
    ];
    const syn = synthesizeNews(items, "BTC/USDT", "LONG");
    const allText = JSON.stringify(syn).toLowerCase();
    expect(allText).not.toContain("%");
    expect(allText).not.toContain("probability");
    expect(allText).not.toContain("chance");
    expect(allText).not.toContain("likely");
  });

  it("no percentage/probability in fundamental synthesis", () => {
    const syn = synthesizeFundamentals(
      [makeFundamental()],
      [makeEvent()],
      "EUR/USD",
      "LONG",
      now,
    );
    const allText = JSON.stringify(syn).toLowerCase();
    expect(allText).not.toContain("probability");
    expect(allText).not.toContain("chance");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("O. No Auto-Execution", () => {
  it("no execution-related text in any output", () => {
    const syn = synthesizeNews(
      [makeNewsItem({ headline: "Bitcoin price surge", sentiment: "BULLISH", relatedInstruments: ["BTC/USDT"] })],
      "BTC/USDT",
      "LONG",
    );
    const allText = JSON.stringify(syn).toLowerCase();
    expect(allText).not.toContain("execute");
    expect(allText).not.toContain("order");
    expect(allText).not.toContain("trade");
    expect(allText).not.toContain("buy");
    expect(allText).not.toContain("sell");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. SOURCE MODE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("P. Source Mode Integrity", () => {
  it("LIVE source mode on valid item", () => {
    const item = makeNewsItem({ sourceMode: "LIVE" });
    expect(item.sourceMode).toBe("LIVE");
  });

  it("STALE source mode on stale item", () => {
    const item = makeNewsItem({ sourceMode: "STALE" });
    expect(item.sourceMode).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Q. Instrument Isolation", () => {
  it("BTC news does not directly match ETH", () => {
    const item = makeNewsItem({
      headline: "Bitcoin ETF approved",
      sentiment: "BULLISH",
      relatedInstruments: ["BTC/USDT"],
    });
    const btcRel = classifyNewsRelevance(item, "BTC/USDT", "LONG");
    const ethRel = classifyNewsRelevance(item, "ETH/USDT", "LONG");
    expect(btcRel.relevance).toBe("DIRECT");
    // ETH is crypto so may get LOW from asset-class match, but not DIRECT
    expect(ethRel.relevance).not.toBe("DIRECT");
  });

  it("EUR/USD news does not affect GBP/USD", () => {
    const item = makeNewsItem({
      headline: "ECB cuts rates by 25bps",
      sentiment: "BULLISH",
      relatedInstruments: ["EUR/USD"],
    });
    const eurRel = classifyNewsRelevance(item, "EUR/USD", "LONG");
    const gbpRel = classifyNewsRelevance(item, "GBP/USD", "LONG");
    expect(eurRel.relevance).toBe("DIRECT");
    expect(gbpRel.relevance).not.toBe("DIRECT");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. BOUNDED MEMORY
// ═══════════════════════════════════════════════════════════════

describe("R. Bounded Memory", () => {
  it("boundNewsItems limits to 50", () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeNewsItem({ id: `${i}`, headline: `Headline ${i} unique text` }),
    );
    expect(boundNewsItems(items).length).toBe(50);
  });

  it("boundEvents limits to 20", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ name: `Event ${i}` }),
    );
    expect(boundEvents(events).length).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("S. Stale Data", () => {
  it("stale news is classified STALE (> 6 hours)", () => {
    const freshness = classifyNewsFreshness(now - 25_000_000, now);
    expect(freshness).toBe("STALE");
  });
});
