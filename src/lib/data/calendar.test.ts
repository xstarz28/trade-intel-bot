import { describe, it, expect } from "vitest";
import {
  getRelevantCurrencies,
  hoursUntil,
  calculateMacroRisk,
} from "./calendar-types";
import type { EconomicEvent } from "./calendar-types";
import { runAnalysis } from "../analysis-engine";
import type { AnalysisInput } from "@/types/analysis";

// ── getRelevantCurrencies ────────────────────────────────────────

describe("getRelevantCurrencies", () => {
  it("maps EUR/USD to Euro Area + United States", () => {
    const result = getRelevantCurrencies("EUR/USD", "forex");
    expect(result).toEqual(
      expect.arrayContaining([
        { country: "Euro Area", currency: "EUR" },
        { country: "United States", currency: "USD" },
      ]),
    );
    expect(result.length).toBe(2);
  });

  it("maps GBP/USD to United Kingdom + United States", () => {
    const result = getRelevantCurrencies("GBP/USD", "forex");
    expect(result).toEqual(
      expect.arrayContaining([
        { country: "United Kingdom", currency: "GBP" },
        { country: "United States", currency: "USD" },
      ]),
    );
  });

  it("maps USD/JPY to United States + Japan", () => {
    const result = getRelevantCurrencies("USD/JPY", "forex");
    expect(result).toEqual(
      expect.arrayContaining([
        { country: "United States", currency: "USD" },
        { country: "Japan", currency: "JPY" },
      ]),
    );
  });

  it("maps BTC/USD to United States (crypto)", () => {
    const result = getRelevantCurrencies("BTC/USD", "crypto");
    expect(result).toEqual([{ country: "United States", currency: "USD" }]);
  });

  it("maps XAU/USD to United States (commodity)", () => {
    const result = getRelevantCurrencies("XAU/USD", "commodity");
    expect(result).toEqual([{ country: "United States", currency: "USD" }]);
  });

  it("maps AAPL to United States (stock)", () => {
    const result = getRelevantCurrencies("AAPL", "stock");
    expect(result).toEqual([{ country: "United States", currency: "USD" }]);
  });
});

// ── hoursUntil ───────────────────────────────────────────────────

describe("hoursUntil", () => {
  it("returns positive hours for future timestamps", () => {
    const future = Date.now() + 3 * 60 * 60 * 1000;
    const hrs = hoursUntil(future);
    expect(hrs).toBeGreaterThanOrEqual(2);
    expect(hrs).toBeLessThanOrEqual(4);
  });

  it("returns 0 for past timestamps", () => {
    const past = Date.now() - 3600000;
    expect(hoursUntil(past)).toBe(0);
  });
});

// ── calculateMacroRisk ───────────────────────────────────────────

describe("calculateMacroRisk", () => {
  const highImpact = 3 as const;
  const mediumImpact = 2 as const;

  it("returns high when high-impact event is within 24h", () => {
    const events: EconomicEvent[] = [
      {
        id: "1",
        event: "CPI",
        category: "Inflation",
        country: "United States",
        currency: "USD",
        datetime: Date.now() + 2 * 60 * 60 * 1000, // 2h from now
        importance: highImpact,
        source: "trading-economics",
        status: "upcoming",
      },
    ];
    const risk = calculateMacroRisk(events);
    expect(risk.level).toBe("high");
    expect(risk.highImpact24h).toBe(1);
    expect(risk.nearestHighImpact).toBeDefined();
    expect(risk.nearestHighImpact!.event).toBe("CPI");
  });

  it("returns medium when high-impact event is within 72h but not 24h", () => {
    const events: EconomicEvent[] = [
      {
        id: "1",
        event: "NFP",
        category: "Employment",
        country: "United States",
        currency: "USD",
        datetime: Date.now() + 48 * 60 * 60 * 1000, // 48h from now
        importance: highImpact,
        source: "trading-economics",
        status: "upcoming",
      },
    ];
    const risk = calculateMacroRisk(events);
    expect(risk.level).toBe("medium");
    expect(risk.highImpact24h).toBe(0);
    expect(risk.highImpact72h).toBe(1);
  });

  it("returns low when no high-impact events in 72h", () => {
    const events: EconomicEvent[] = [
      {
        id: "1",
        event: "Retail Sales",
        category: "Economy",
        country: "United States",
        currency: "USD",
        datetime: Date.now() + 6 * 24 * 60 * 60 * 1000, // 6 days from now
        importance: mediumImpact,
        source: "trading-economics",
        status: "upcoming",
      },
    ];
    const risk = calculateMacroRisk(events);
    expect(risk.level).toBe("low");
    expect(risk.explanation).toContain("No high-impact");
  });

  it("returns low with empty event list", () => {
    const risk = calculateMacroRisk([]);
    expect(risk.level).toBe("low");
    expect(risk.highImpact24h).toBe(0);
    expect(risk.highImpact72h).toBe(0);
  });

  it("ignores released events for upcoming risk", () => {
    const events: EconomicEvent[] = [
      {
        id: "1",
        event: "CPI",
        category: "Inflation",
        country: "United States",
        currency: "USD",
        datetime: Date.now() - 3600000, // 1h ago
        importance: highImpact,
        source: "trading-economics",
        status: "released",
      },
    ];
    const risk = calculateMacroRisk(events);
    expect(risk.level).toBe("low");
  });
});

// ── Analysis Engine Integration ──────────────────────────────────

describe("Analysis engine with calendar data", () => {
  const baseInput: AnalysisInput = {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    marketData: {
      instrument: "EUR/USD",
      instrumentType: "forex",
      provider: "twelve-data",
      fetchTimestamp: Date.now(),
      price: { price: 1.1, timestamp: Date.now(), source: "twelve-data" },
      candles: [],
      timeframe: "H4",
      dataFreshness: "realtime",
    },
    technicalData: {
      dataPoints: 100,
      structure: "HH/HL",
      bosDirection: "bullish",
      chochDirection: "none",
      rsi14: 55,
      macdHistogram: 0.001,
      sma50: 1.09,
      sma100: 1.085,
      sma200: 1.08,
      atr14: 0.01,
      swingHighs: [1.12, 1.11],
      swingLows: [1.08, 1.07],
      supportLevels: [1.08, 1.07],
      resistanceLevels: [1.12, 1.13],
      volumeTrend: "stable",
    },
  };

  it("scores fundamental from released CPI with surprise", () => {
    const input: AnalysisInput = {
      ...baseInput,
      calendarData: {
        provider: "trading-economics",
        timestamp: Date.now(),
        freshness: "recent",
        confidence: "high",
        macroRisk: {
          level: "low",
          explanation: "No upcoming high-impact events",
          highImpact24h: 0,
          highImpact72h: 0,
        },
        availability: { upcoming24h: false, upcoming72h: false, recentReleased: true },
        events: [
          {
            id: "cpi1",
            event: "CPI (YoY)",
            category: "Inflation",
            country: "United States",
            currency: "USD",
            datetime: Date.now() - 3600000,
            actual: 3.5,
            forecast: 3.2,
            previous: 3.1,
            importance: 3,
            source: "trading-economics",
            status: "released",
          },
        ],
      },
    };
    const result = runAnalysis(input);
    // CPI above forecast for USD → hawkish → EUR/USD bearish → fundamental should be negative
    expect(result.breakdown.fundamental).toBeLessThan(0);
    expect(result.fundamentalSummary).toContain("Macro risk");
    expect(result.fundamentalSummary).toContain("CPI");
  });

  it("does not score upcoming events directionally", () => {
    const input: AnalysisInput = {
      ...baseInput,
      calendarData: {
        provider: "trading-economics",
        timestamp: Date.now(),
        freshness: "recent",
        confidence: "high",
        macroRisk: {
          level: "high",
          explanation: "CPI (USD) in 2h",
          highImpact24h: 1,
          highImpact72h: 1,
          nearestHighImpact: {
            event: "CPI (YoY)",
            currency: "USD",
            datetime: Date.now() + 2 * 3600000,
            hoursUntil: 2,
          },
        },
        availability: { upcoming24h: true, upcoming72h: true, recentReleased: false },
        events: [
          {
            id: "cpi2",
            event: "CPI (YoY)",
            category: "Inflation",
            country: "United States",
            currency: "USD",
            datetime: Date.now() + 2 * 3600000,
            forecast: 3.2,
            previous: 3.1,
            importance: 3,
            source: "trading-economics",
            status: "upcoming",
          },
        ],
      },
    };
    const result = runAnalysis(input);
    // Upcoming events should NOT affect fundamental score (no actual vs forecast)
    expect(result.breakdown.fundamental).toBe(0);
    expect(result.fundamentalSummary).toContain("Macro risk: HIGH");
  });

  it("handles calendar data unavailable gracefully", () => {
    const input: AnalysisInput = {
      ...baseInput,
      calendarData: {
        provider: "trading-economics",
        timestamp: Date.now(),
        freshness: "unavailable",
        confidence: "unavailable",
        macroRisk: {
          level: "low",
          explanation: "No economic calendar data available.",
          highImpact24h: 0,
          highImpact72h: 0,
        },
        availability: { upcoming24h: false, upcoming72h: false, recentReleased: false },
        events: [],
      },
    };
    const result = runAnalysis(input);
    // Calendar unavailable should not crash
    expect(result.bias).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("includes calendarData in result output", () => {
    const input: AnalysisInput = {
      ...baseInput,
      calendarData: {
        provider: "trading-economics",
        timestamp: Date.now(),
        freshness: "recent",
        confidence: "medium",
        macroRisk: {
          level: "medium",
          explanation: "NFP in 48h",
          highImpact24h: 0,
          highImpact72h: 1,
        },
        availability: { upcoming24h: false, upcoming72h: true, recentReleased: false },
        events: [],
      },
    };
    const result = runAnalysis(input);
    expect(result.calendarData).toBeDefined();
    expect(result.calendarData!.macroRisk.level).toBe("medium");
  });
});
