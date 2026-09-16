/**
 * Phase 86 — Intelligence Dashboard Integration Tests
 *
 * Tests the integration between intelligence engines and dashboard data flow.
 * Pure deterministic tests — no React rendering (handled by .tsx files).
 */

import { describe, it, expect } from "vitest";
import { synthesizeNews, classifyNewsFreshness, type NewsItem } from "./news-intelligence";
import { synthesizeFundamentals, type FundamentalDataPoint, type EconomicEvent } from "./fundamental-intelligence";
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

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "1",
    timestamp: now - 600_000,
    source: "Reuters",
    headline: "Bitcoin ETF approved by SEC",
    relatedInstruments: ["BTC/USDT"],
    assetClass: "crypto",
    category: "ETF",
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
    value: 2.5,
    previous: 3.0,
    expected: 3.1,
    timestamp: now,
    source: "BLS",
    freshness: "FRESH",
    category: "INFLATION",
    relatedInstruments: ["BTC/USDT"],
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
    relatedInstruments: ["EUR/USD"],
    previous: 5.25,
    expected: 5.25,
    source: "EconomicCalendar",
    sourceMode: "LIVE",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. NEWS DASHBOARD INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("A. News Dashboard Integration", () => {
  it("synthesizeNews → multiDimensional with news dimension", () => {
    const news = synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG");
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
    });
    expect(md.news).toBeTruthy();
    expect(md.news!.newsStance).toBe("SUPPORTING");
    expect(md.dimensions.some(d => d.dimension === "NEWS")).toBe(true);
  });

  it("no news → NEWS dimension UNAVAILABLE", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    expect(md.news).toBeNull();
    expect(md.dimensions.find(d => d.dimension === "NEWS")?.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. FUNDAMENTAL DASHBOARD INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("B. Fundamental Dashboard Integration", () => {
  it("synthesizeFundamentals → multiDimensional with fundamental dimension", () => {
    const fund = synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now);
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      fundamentals: fund,
    });
    expect(md.fundamentals).toBeTruthy();
    expect(md.fundamentals!.fundamentalStance).toBe("SUPPORTING");
    expect(md.dimensions.some(d => d.dimension === "FUNDAMENTALS")).toBe(true);
  });

  it("no fundamentals → FUNDAMENTALS dimension UNAVAILABLE", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    expect(md.fundamentals).toBeNull();
    expect(md.dimensions.find(d => d.dimension === "FUNDAMENTALS")?.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. CATALYST INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("C. Catalyst Integration", () => {
  it("upcoming event → catalyst in fundamentals", () => {
    const fund = synthesizeFundamentals([], [makeEvent()], "EUR/USD", "LONG", now);
    expect(fund.catalyst.status).not.toBe("NO_MATERIAL_CATALYST");
  });

  it("no events → NO_MATERIAL_CATALYST", () => {
    const fund = synthesizeFundamentals([], [], "EUR/USD", "LONG", now);
    expect(fund.catalyst.status).toBe("NO_MATERIAL_CATALYST");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. EVIDENCE HIERARCHY WITH NEWS
// ═══════════════════════════════════════════════════════════════

describe("D. Evidence Hierarchy with News", () => {
  it("news evidence appears in CONTEXT tier", () => {
    const news = synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG");
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

  it("fundamental evidence appears in CONTEXT tier", () => {
    const fund = synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now);
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      fundamentals: fund,
    });
    const fundEvidence = md.evidence.filter(e => e.category === "FUNDAMENTAL");
    expect(fundEvidence.length).toBeGreaterThan(0);
    expect(fundEvidence[0].tier).toBe("CONTEXT");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SCENARIOS INCLUDE CATALYST
// ═══════════════════════════════════════════════════════════════

describe("E. Scenarios", () => {
  it("has base/alternative/invalidation cases", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    expect(md.scenarios.baseCase).toBeTruthy();
    expect(md.scenarios.alternativeCase).toBeTruthy();
    expect(md.scenarios.invalidationCase).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. LONG/SHORT NEWS SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("F. LONG/SHORT News Symmetry", () => {
  it("bullish news supports LONG and conflicts SHORT", () => {
    const longMd = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news: synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG"),
    });
    const shortMd = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "SHORT",
      confluence: mockConfluence,
      vixPrice: 15,
      news: synthesizeNews([makeNewsItem()], "BTC/USDT", "SHORT"),
    });
    expect(longMd.news!.newsStance).toBe("SUPPORTING");
    expect(shortMd.news!.newsStance).toBe("CONFLICTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("G. No Probability Claims", () => {
  it("news synthesis has no probability", () => {
    const news = synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG");
    const json = JSON.stringify(news).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
  });

  it("fundamental synthesis has no probability", () => {
    const fund = synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now);
    const json = JSON.stringify(fund).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
  });

  it("multi-dimensional has no probability", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news: synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG"),
      fundamentals: synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now),
    });
    const json = JSON.stringify(md).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("H. No Auto-Execution", () => {
  it("no execution language in any output", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news: synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG"),
      fundamentals: synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now),
    });
    const json = JSON.stringify(md).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("buy now");
    expect(json).not.toContain("sell now");
    expect(json).not.toContain("place order");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DIMENSIONS COUNT
// ═══════════════════════════════════════════════════════════════

describe("I. Dimensions Count", () => {
  it("6 dimensions tracked", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news: synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG"),
      fundamentals: synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now),
    });
    expect(md.dimensions.length).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("J. Determinism", () => {
  it("same inputs → same multi-dimensional output", () => {
    const news = synthesizeNews([makeNewsItem()], "BTC/USDT", "LONG");
    const fund = synthesizeFundamentals([makeFundamental()], [], "BTC/USDT", "LONG", now);
    const r1 = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
      fundamentals: fund,
    });
    const r2 = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
      fundamentals: fund,
    });
    expect(r1.dimensions).toEqual(r2.dimensions);
    expect(r1.evidenceQuality).toBe(r2.evidenceQuality);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. SOURCE MODE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("K. Source Mode Integrity", () => {
  it("LIVE news → news source mode LIVE", () => {
    const news = synthesizeNews([makeNewsItem({ sourceMode: "LIVE" })], "BTC/USDT", "LONG");
    expect(news.relevantItems.length).toBeGreaterThan(0);
  });

  it("STALE news → fresh classification", () => {
    expect(classifyNewsFreshness(now - 25_000_000, now)).toBe("STALE");
  });
});
