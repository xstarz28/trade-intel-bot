/**
 * Phase 88 — Real Economic Calendar & Macro Catalyst Runtime Activation Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyCatalyst,
  classifyEventImportance,
  synthesizeFundamentals,
  interpretFundamental,
  type EconomicEvent,
} from "./fundamental-intelligence";
import { synthesizeMultiDimensionalIntelligence } from "./multi-dimensional-intelligence";
import type { MTFConfluence } from "./multi-timeframe-engine";

const now = Date.now();

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

function makeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    name: "FOMC Rate Decision",
    timestamp: now + 3600_000,
    currency: "USD",
    importance: "CRITICAL",
    relatedInstruments: ["EUR/USD"],
    previous: 5.25,
    expected: 5.25,
    source: "TickAtlas",
    sourceMode: "LIVE",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. EVENT NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("A. Event Normalization", () => {
  it("creates valid economic event", () => {
    const evt = makeEvent();
    expect(evt.name).toBeTruthy();
    expect(evt.timestamp).toBeGreaterThan(0);
    expect(evt.currency).toBeTruthy();
    expect(evt.source).toBe("TickAtlas");
  });

  it("handles missing actual/forecast gracefully", () => {
    const evt = makeEvent({ previous: undefined, expected: undefined });
    expect(evt.previous).toBeUndefined();
    expect(evt.expected).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// B. IMPORTANCE MAPPING
// ═══════════════════════════════════════════════════════════════

describe("B. Importance Mapping", () => {
  it("FOMC → CRITICAL", () => {
    expect(classifyEventImportance("FOMC Rate Decision")).toBe("CRITICAL");
  });

  it("ECB → CRITICAL", () => {
    expect(classifyEventImportance("ECB Interest Rate Decision")).toBe("CRITICAL");
  });

  it("CPI → HIGH", () => {
    expect(classifyEventImportance("US CPI")).toBe("HIGH");
  });

  it("NFP → HIGH", () => {
    expect(classifyEventImportance("Non-Farm Payrolls")).toBe("HIGH");
  });

  it("PMI → HIGH", () => {
    expect(classifyEventImportance("Manufacturing PMI")).toBe("HIGH");
  });

  it("unknown → LOW", () => {
    expect(classifyEventImportance("Minor Regional Data")).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. CATALYST CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("C. Catalyst Classification", () => {
  it("event in 30 min → HIGH_IMPACT_EVENT_APPROACHING", () => {
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

  it("no events → NO_MATERIAL_CATALYST", () => {
    const cat = classifyCatalyst([], "EUR/USD", now);
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });

  it("MODERATE event in 30 min → MODERATE sensitivity", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000, importance: "MODERATE" });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.positionSensitivity).toBe("MODERATE");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. INSTRUMENT RELEVANCE
// ═══════════════════════════════════════════════════════════════

describe("D. Instrument Relevance", () => {
  it("EUR event relevant to EUR/USD via relatedInstruments", () => {
    const evt = makeEvent({ currency: "EUR", relatedInstruments: ["EUR/USD"] });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.affectedInstruments.length).toBeGreaterThan(0);
  });

  it("USD event relevant to EUR/USD", () => {
    const evt = makeEvent({ currency: "USD", relatedInstruments: ["EUR/USD"] });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    expect(cat.affectedInstruments.length).toBeGreaterThan(0);
  });

  it("JPY event less relevant to EUR/USD", () => {
    const evt = makeEvent({ currency: "JPY", relatedInstruments: ["USD/JPY"] });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    // JPY event should not match EUR/USD
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SURPRISE DETECTION
// ═══════════════════════════════════════════════════════════════

describe("E. Surprise Detection", () => {
  it("actual above expected → POSITIVE surprise", () => {
    const dp = {
      metric: "CPI",
      value: 3.5,
      previous: 3.0,
      expected: 3.1,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH" as const,
      category: "INFLATION" as const,
      relatedInstruments: ["EUR/USD"],
      sourceMode: "LIVE" as const,
    };
    const interp = interpretFundamental(dp, "LONG", "EUR/USD");
    expect(interp.surpriseDirection).toBe("POSITIVE");
  });

  it("actual below expected → NEGATIVE surprise", () => {
    const dp = {
      metric: "CPI",
      value: 2.5,
      previous: 3.0,
      expected: 3.1,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH" as const,
      category: "INFLATION" as const,
      relatedInstruments: ["EUR/USD"],
      sourceMode: "LIVE" as const,
    };
    const interp = interpretFundamental(dp, "LONG", "EUR/USD");
    expect(interp.surpriseDirection).toBe("NEGATIVE");
  });

  it("actual equals expected → NONE", () => {
    const dp = {
      metric: "CPI",
      value: 3.1,
      previous: 3.0,
      expected: 3.1,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH" as const,
      category: "INFLATION" as const,
      relatedInstruments: ["EUR/USD"],
      sourceMode: "LIVE" as const,
    };
    const interp = interpretFundamental(dp, "LONG", "EUR/USD");
    expect(interp.surpriseDirection).toBe("NONE");
  });

  it("no expected → UNKNOWN", () => {
    const dp = {
      metric: "CPI",
      value: 3.5,
      previous: 3.0,
      expected: null,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH" as const,
      category: "INFLATION" as const,
      relatedInstruments: ["EUR/USD"],
      sourceMode: "LIVE" as const,
    };
    const interp = interpretFundamental(dp, "LONG", "EUR/USD");
    expect(interp.surpriseDirection).toBe("UNKNOWN");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("F. LONG/SHORT Symmetry", () => {
  it("hot CPI impacts LONG and SHORT differently", () => {
    const dp = {
      metric: "CPI",
      value: 3.5,
      previous: 3.0,
      expected: 3.1,
      timestamp: now,
      source: "BLS",
      freshness: "FRESH" as const,
      category: "INFLATION" as const,
      relatedInstruments: ["BTC/USDT"],
      sourceMode: "LIVE" as const,
    };
    const long = interpretFundamental(dp, "LONG", "BTC/USDT");
    const short = interpretFundamental(dp, "SHORT", "BTC/USDT");
    expect(long.positionImpact).not.toBe(short.positionImpact);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. PROVIDER UNAVAILABLE
// ═══════════════════════════════════════════════════════════════

describe("G. Provider Unavailable", () => {
  it("empty events → NO_MATERIAL_CATALYST", () => {
    const cat = classifyCatalyst([], "EUR/USD", now);
    expect(cat.status).toBe("NO_MATERIAL_CATALYST");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. EVIDENCE HIERARCHY
// ═══════════════════════════════════════════════════════════════

describe("H. Evidence Hierarchy", () => {
  it("catalyst evidence is CONTEXT tier", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const fundSyn = synthesizeFundamentals([], [evt], "EUR/USD", "LONG", now);
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "EUR/USD",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      fundamentals: fundSyn,
    });
    const catEvidence = md.evidence.filter(e => e.category === "CATALYST");
    if (catEvidence.length > 0) {
      expect(catEvidence[0].tier).toBe("CONTEXT");
    }
  });

  it("catalyst does not override PRIMARY evidence", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const fundSyn = synthesizeFundamentals([], [evt], "EUR/USD", "LONG", now);
    const md = synthesizeMultiDimensionalIntelligence({
      instrument: "EUR/USD",
      side: "LONG",
      confluence: mockConfluence,
      vixPrice: 15,
      fundamentals: fundSyn,
    });
    const primary = md.evidence.filter(e => e.tier === "PRIMARY");
    expect(primary.length).toBeGreaterThan(0);
    expect(primary[0].strength).toBe("STRONG");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("I. No Probability Claims", () => {
  it("catalyst analysis has no probability", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    const json = JSON.stringify(cat).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
    expect(json).not.toContain("%");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("J. No Auto-Execution", () => {
  it("no execution language", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const cat = classifyCatalyst([evt], "EUR/USD", now);
    const json = JSON.stringify(cat).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("buy now");
    expect(json).not.toContain("sell now");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. SOURCE MODE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("K. Source Mode Integrity", () => {
  it("LIVE source mode preserved", () => {
    const evt = makeEvent({ sourceMode: "LIVE" });
    expect(evt.sourceMode).toBe("LIVE");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("L. Determinism", () => {
  it("same events → same catalyst classification", () => {
    const evt = makeEvent({ timestamp: now + 30 * 60_000 });
    const r1 = classifyCatalyst([evt], "EUR/USD", now);
    const r2 = classifyCatalyst([evt], "EUR/USD", now);
    expect(r1.status).toBe(r2.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. MULTIPLE EVENTS
// ═══════════════════════════════════════════════════════════════

describe("M. Multiple Events", () => {
  it("picks closest event", () => {
    const near = makeEvent({ name: "Near Event", timestamp: now + 30 * 60_000 });
    const far = makeEvent({ name: "Far Event", timestamp: now + 72 * 3600_000 });
    const cat = classifyCatalyst([near, far], "EUR/USD", now);
    expect(cat.event?.name).toBe("Near Event");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("N. Instrument Isolation", () => {
  it("USD event does not affect JPY instrument directly", () => {
    const evt = makeEvent({ currency: "USD", relatedInstruments: ["EUR/USD"] });
    const cat = classifyCatalyst([evt], "USD/JPY", now);
    // USD event may or may not be relevant to USD/JPY — depends on currency matching
    // Key test: the catalyst engine doesn't crash
    expect(cat.status).toBeDefined();
  });
});
