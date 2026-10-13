import { describe, expect, it } from "vitest";
import { buildHistoricalContextSummaries } from "./analysis-history";

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
