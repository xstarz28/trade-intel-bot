import { describe, expect, it } from "vitest";
import { buildHistoricalContextSummaries, buildPersistedContextSummaries, resolveHistoricalDecision } from "./analysis-history";

describe("historical analysis integrity", () => {
  it("keeps saved narratives without inventing raw provider metrics", () => {
    expect(buildHistoricalContextSummaries({
      sentimentSummary: "Mixed headlines.", sentimentScore: -0.2,
      macroSummary: "Yields rose.", derivativesSummary: "Funding elevated.",
    })).toEqual({ sentiment: { summary: "Mixed headlines.", score: -0.2 }, macro: "Yields rose.", derivatives: "Funding elevated." });
  });

  it("removes legacy placeholder text", () => {
    expect(buildHistoricalContextSummaries({ sentimentSummary: "undefined (0 articles)" })).toBeUndefined();
  });

  it("does not persist absent or unavailable providers", () => {
    expect(buildPersistedContextSummaries({})).toEqual({});
    expect(buildPersistedContextSummaries({
      sentimentData: { confidence: "unavailable", label: "neutral", articleCount: 0, averageScore: 0 },
      macroData: { confidence: "unavailable", summary: "unavailable" },
      derivativesData: { confidence: "unavailable", interpretation: "unavailable" },
      calendarData: { confidence: "unavailable", macroRisk: { level: "medium", explanation: "" } },
    })).toEqual({});
  });

  it("fails closed when the historical trade decision was never stored", () => {
    expect(resolveHistoricalDecision(undefined, undefined).recommendation).toBe("NO_TRADE");
  });
});
