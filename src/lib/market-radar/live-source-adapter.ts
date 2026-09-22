import type { LiveCandidateSource } from "../liveCandidateBuilder";
import type { RadarCandidateSource } from "./candidate-builder";

/**
 * Phase 158 — convert verified runtime live sources into Radar inputs.
 *
 * Live discovery is the source of instrument eligibility.
 * This adapter never derives provider identity, prices, or evidence.
 * Region is intentionally neutral until the discovery provider supplies
 * authoritative regional metadata; no ticker whitelist is used.
 */
export function buildRadarSourcesFromLiveSources(
  sources: readonly LiveCandidateSource[],
): RadarCandidateSource[] {
  return sources.map((source) => {
    const marketData = source.marketData;
    const analysis = source.analysisResult;

    return {
      universe: {
        instrument: source.instrument,
        assetClass: source.assetClass,
        region: "global",
        requiredCapabilities: ["ohlcv", "quote"],
        priority: 1,
        refreshIntervalMs: 300_000,
      },
      snapshot: marketData
        ? {
            instrument: marketData.instrument,
            assetClass: source.assetClass,
            price: marketData.price.price,
            ohlcvAvailable: marketData.candles.length > 0,
            availableTimeframes:
              marketData.candles.length > 0 ? [marketData.timeframe] : [],
            htfBias:
              analysis?.bias === "Bullish"
                ? "long"
                : analysis?.bias === "Bearish"
                  ? "short"
                  : "neutral",
            marketRegime: "UNKNOWN",
            provider: marketData.provider,
            observedAt:
              marketData.price.timestamp || marketData.fetchTimestamp,
            freshness:
              marketData.dataFreshness === "realtime"
                ? "FRESH"
                : marketData.dataFreshness === "delayed"
                  ? "DELAYED"
                  : marketData.dataFreshness === "stale"
                    ? "STALE"
                    : "UNAVAILABLE",
            quality:
              marketData.dataFreshness === "unavailable"
                ? "UNAVAILABLE"
                : "VERIFIED",
          }
        : null,
      analysisResult: analysis
        ? {
            confidence: analysis.confidence,
            bias: analysis.bias,
            recommendation: analysis.recommendation,
          }
        : undefined,
    };
  });
}
