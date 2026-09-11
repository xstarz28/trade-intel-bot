/**
 * Phase 86 — Intelligence Dashboard Tests
 *
 * Tests the IntelligenceDashboard component rendering logic
 * and integration with Phase 83-85 intelligence engines.
 */

import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import en from "@/lib/i18n/en";
import React from "react";
import { IntelligenceDashboard } from "../../components/IntelligenceDashboard";
import { synthesizeNews } from "./news-intelligence";
import { synthesizeFundamentals } from "./fundamental-intelligence";
import { synthesizeMultiDimensionalIntelligence } from "./multi-dimensional-intelligence";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { MTFConfluence } from "./multi-timeframe-engine";
import type { NewsItem } from "./news-intelligence";
import type { FundamentalDataPoint, EconomicEvent } from "./fundamental-intelligence";

// IntelligenceDashboard consumes the i18n context, so every render must be
// wrapped in the provider exactly as the application does.
const render = (ui: React.ReactElement) =>
  rtlRender(<I18nProvider>{ui}</I18nProvider>);

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

function makeIntelligence(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 80000,
    entryPrice: 75000,
    marketState: "BULLISH",
    shortTermContext: "Short-term bullish",
    mediumTermContext: "Medium-term bullish",
    volatilityContext: "Normal volatility",
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    confidence: "MODERATE_EVIDENCE",
    evidence: [],
    supportingEvidence: [],
    conflictingEvidence: [],
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [{ description: "Price below 70000", type: "structural" }],
    nextMonitor: ["M5 momentum continuation"],
    // Required by PositionIntelligence. The fixture previously omitted it,
    // which is how the missing-data crash in IntelligenceDashboard went
    // unnoticed while these tests were dormant.
    actionRecommendation: "HOLD",
    ...overrides,
  } as PositionIntelligence;
}

function makeNewsItems(): NewsItem[] {
  return [
    {
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
    },
  ];
}

function makeFundamentals(): FundamentalDataPoint[] {
  return [
    {
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
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// A. RENDERING
// ═══════════════════════════════════════════════════════════════

describe("A. IntelligenceDashboard Rendering", () => {
  it("renders without crashing", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.analyticalSummary)).toBeTruthy();
  });

  it("shows UNAVAILABLE when no intelligence", () => {
    const { container } = render(
      <IntelligenceDashboard
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    // No intelligence and no whatChanged prop at all: every section must
    // report UNAVAILABLE rather than inventing a state. This is distinct from
    // whatChanged=[] which means "compared, nothing changed".
    expect(container.textContent).toContain(en.status.unavailable);
    expect(container.textContent).not.toContain(en.intelligence.noMaterialChange);
  });

  it("displays thesis health", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence({ thesisHealth: "HEALTHY" })}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText("HEALTHY")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// B. NEWS INTELLIGENCE DISPLAY
// ═══════════════════════════════════════════════════════════════

describe("B. News Intelligence Display", () => {
  it("shows UNAVAILABLE when no news", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={synthesizeMultiDimensionalIntelligence({
          instrument: "BTC/USDT",
          side: "LONG",
          confluence: mockConfluence,
          vixPrice: 15,
        })}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.newsIntelligence)).toBeTruthy();
  });

  it("shows news when available", () => {
    const news = synthesizeNews(makeNewsItems(), "BTC/USDT", "LONG");
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      news,
    });
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={md}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.newsIntelligence)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// C. FUNDAMENTAL DISPLAY
// ═══════════════════════════════════════════════════════════════

describe("C. Fundamental Display", () => {
  it("shows UNAVAILABLE when no fundamentals", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={synthesizeMultiDimensionalIntelligence({
          instrument: "BTC/USDT",
          side: "LONG",
          confluence: mockConfluence,
          vixPrice: 15,
        })}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.fundamentals)).toBeTruthy();
  });

  it("shows fundamentals when available", () => {
    const fund = synthesizeFundamentals(makeFundamentals(), [], "BTC/USDT", "LONG", now);
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      fundamentals: fund,
    });
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={md}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.fundamentals)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// D. EVIDENCE HIERARCHY DISPLAY
// ═══════════════════════════════════════════════════════════════

describe("D. Evidence Hierarchy Display", () => {
  it("shows evidence hierarchy when available", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={md}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.evidenceHierarchy)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SCENARIOS DISPLAY
// ═══════════════════════════════════════════════════════════════

describe("E. Scenarios Display", () => {
  it("shows scenarios when available", () => {
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USDT",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
    });
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={md}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.scenarios)).toBeTruthy();
    expect(screen.getByText(en.intelligence.baseCase)).toBeTruthy();
    expect(screen.getByText(en.intelligence.alternative)).toBeTruthy();
    expect(screen.getByText("INVALIDATION")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// F. WHAT CHANGED DISPLAY
// ═══════════════════════════════════════════════════════════════

describe("F. What Changed Display", () => {
  it("shows no change when empty", () => {
    const { container } = render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        whatChanged={[]}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    // The label shares its element with an icon, so assert on the rendered
    // text of the whole subtree rather than an exact single-node match.
    expect(container.textContent).toContain(en.intelligence.noMaterialChange);
  });

  it("shows changes when present", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        whatChanged={["H1 trend shifted from BEARISH to BULLISH"]}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText("H1 trend shifted from BEARISH to BULLISH")).toBeTruthy();
  });

  it("shows awaiting when null", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        whatChanged={null}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getByText(en.intelligence.awaitingFirstAnalysis)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("G. LONG/SHORT Symmetry", () => {
  it("shows LONG position side", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence({ side: "LONG" })}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getAllByText("LONG BTC/USDT").length).toBeGreaterThan(0);
  });

  it("shows SHORT position side", () => {
    render(
      <IntelligenceDashboard
        intelligence={makeIntelligence({ side: "SHORT" })}
        positionSide="SHORT"
        instrument="BTC/USDT"
      />
    );
    expect(screen.getAllByText("SHORT BTC/USDT").length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("H. No Probability Claims", () => {
  it("does not contain percentage signs", () => {
    const { container } = render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        multiDimensional={synthesizeMultiDimensionalIntelligence({
          instrument: "BTC/USDT",
          side: "LONG",
          confluence: mockConfluence,
          vixPrice: 15,
          news: synthesizeNews(makeNewsItems(), "BTC/USDT", "LONG"),
          fundamentals: synthesizeFundamentals(makeFundamentals(), [], "BTC/USDT", "LONG", now),
        })}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("probability");
    expect(text.toLowerCase()).not.toContain("chance");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("I. No Auto-Execution", () => {
  it("does not contain execution language", () => {
    const { container } = render(
      <IntelligenceDashboard
        intelligence={makeIntelligence()}
        positionSide="LONG"
        instrument="BTC/USDT"
      />
    );
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("execute");
    expect(text).not.toContain("order");
    expect(text).not.toContain("buy now");
    expect(text).not.toContain("sell now");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISTIC
// ═══════════════════════════════════════════════════════════════

describe("J. Deterministic", () => {
  it("same intelligence → same rendering", () => {
    const intel = makeIntelligence();
    const { container: c1 } = render(
      <IntelligenceDashboard intelligence={intel} positionSide="LONG" instrument="BTC/USDT" />
    );
    const t1 = c1.textContent;
    const { container: c2 } = render(
      <IntelligenceDashboard intelligence={intel} positionSide="LONG" instrument="BTC/USDT" />
    );
    const t2 = c2.textContent;
    expect(t1).toBe(t2);
  });
});
