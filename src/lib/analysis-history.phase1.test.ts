import { describe, expect, it } from "vitest";
import { buildHistoricalContextSummaries, buildPersistedContextSummaries, resolveHistoricalDecision } from "./analysis-history";

describe("buildHistoricalContextSummaries", () => {
  it("preserves only context summaries and the persisted finite sentiment score", () => {
    expect(
      buildHistoricalContextSummaries({
        sentimentSummary: "  Risk sentiment cooled after the release. ",
        sentimentScore: -0.35,
        macroSummary: "Yields moved higher.",
        derivativesSummary: "Funding was elevated.",
        calendarSummary: "CPI is due tomorrow.",
      }),
    ).toEqual({
      sentiment: {
        summary: "Risk sentiment cooled after the release.",
        score: -0.35,
      },
      macro: "Yields moved higher.",
      derivatives: "Funding was elevated.",
      calendar: "CPI is due tomorrow.",
    });
  });

  it("does not invent structured metrics or provider-availability claims", () => {
    const summaries = buildHistoricalContextSummaries({
      sentimentSummary: "Mixed headlines.",
      derivativesSummary: "No reliable interpretation was stored.",
    });

    expect(summaries).toEqual({
      sentiment: { summary: "Mixed headlines." },
      derivatives: "No reliable interpretation was stored.",
    });
    expect(summaries?.sentiment).not.toHaveProperty("articleCount");
    expect(summaries?.sentiment).not.toHaveProperty("breakdown");
    expect(summaries?.derivatives).not.toHaveProperty("availability");
  });

  it("ignores blank narratives and non-finite sentiment scores", () => {
    expect(
      buildHistoricalContextSummaries({
        sentimentSummary: "   ",
        sentimentScore: Number.NaN,
        macroSummary: null,
        derivativesSummary: 42,
        calendarSummary: "",
      }),
    ).toBeUndefined();
  });

  it("keeps a genuine stored score even when no sentiment summary was stored", () => {
    expect(buildHistoricalContextSummaries({ sentimentScore: 0.12 })).toEqual({
      sentiment: { score: 0.12 },
    });
  });
});

describe("buildPersistedContextSummaries", () => {
  it("does not persist placeholder summaries when optional context is absent", () => {
    expect(buildPersistedContextSummaries({})).toEqual({});
  });

  it("does not persist unavailable provider responses", () => {
    expect(
      buildPersistedContextSummaries({
        sentimentData: {
          confidence: "unavailable",
          label: "neutral",
          articleCount: 0,
          averageScore: 0,
        },
        macroData: { confidence: "unavailable", summary: "" },
        derivativesData: { confidence: "unavailable", interpretation: "" },
        calendarData: {
          confidence: "unavailable",
          macroRisk: { level: "medium", explanation: "" },
        },
      }),
    ).toEqual({});
  });

  it("persists only actual available summary data", () => {
    expect(
      buildPersistedContextSummaries({
        sentimentData: {
          confidence: "medium",
          label: "neutral",
          articleCount: 6,
          averageScore: 0.08,
        },
        macroData: { confidence: "medium", summary: "Yields rose." },
        derivativesData: { confidence: "high", interpretation: "Funding elevated." },
        calendarData: {
          confidence: "medium",
          macroRisk: { level: "high", explanation: "CPI release imminent." },
        },
      }),
    ).toEqual({
      sentimentSummary: "neutral (6 articles)",
      sentimentScore: 0.08,
      macroSummary: "Yields rose.",
      derivativesSummary: "Funding elevated.",
      calendarSummary: "Macro risk: high — CPI release imminent.",
    });
  });
});

describe("resolveHistoricalDecision", () => {
  it("preserves an explicitly saved decision instead of deriving it from bias", () => {
    expect(resolveHistoricalDecision("NO_TRADE", ["no valid setup"])).toEqual({
      recommendation: "NO_TRADE",
      noTradeReasons: ["no valid setup"],
    });
    expect(resolveHistoricalDecision("SHORT", [])).toEqual({
      recommendation: "SHORT",
      noTradeReasons: [],
    });
  });

  it("fails closed when the historical decision is missing", () => {
    const result = resolveHistoricalDecision(undefined, undefined);
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.noTradeReasons).toContain(
      "Historical trade decision was not stored; this result cannot be treated as an actionable trade.",
    );
  });

  it("fails closed when the stored decision is malformed", () => {
    expect(resolveHistoricalDecision("BUY", ["older note"]).recommendation).toBe("NO_TRADE");
    expect(resolveHistoricalDecision("BUY", ["older note"]).noTradeReasons).toContain("older note");
  });
});
