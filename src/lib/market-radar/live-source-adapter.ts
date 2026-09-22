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

    // Preserve exact provider-native identity, correlation grouping, and region
    // — never synthesize or hardcode. Phase 239 evidence integrity.
    const observedAt =
      marketData && Number.isFinite(marketData.price.timestamp) && marketData.price.timestamp > 0
        ? marketData.price.timestamp
        : undefined;

    const acquiredAt = marketData?.fetchTimestamp;

    return {
      universe: {
        instrument: source.instrument,
        assetClass: source.assetClass,
        region: source.region ?? "global",
        requiredCapabilities: ["ohlcv", "quote"],
        priority: 1,
        refreshIntervalMs: 300_000,
        ...(source.providerNative ? { providerNative: source.providerNative } : {}),
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
            // Phase 239: preserve provider observation time truthfully.
            // Do NOT fallback to fetchTimestamp — missing observation → undefined → UNAVAILABLE freshness.
            // observedAt is provider's claim; acquiredAt is our receipt.
            ...(observedAt !== undefined ? { observedAt } : {}),
            ...(acquiredAt !== undefined ? { acquiredAt } : {}),
            ...(marketData.timestampProvenance
              ? { timestampProvenance: marketData.timestampProvenance as any }
              : {}),
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
            // Spread is DERIVED from bid/ask, not provider-observed price. Preserve as derived.
            ...(marketData.price.bid !== undefined && marketData.price.ask !== undefined
              ? {
                  spreadBps: (() => {
                    const mid = (marketData.price.bid! + marketData.price.ask!) / 2;
                    const spread = marketData.price.ask! - marketData.price.bid!;
                    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(spread)) return undefined;
                    return (spread / mid) * 10000;
                  })(),
                }
              : {}),
          }
        : null,
      analysisResult: analysis
        ? {
            // RadarCandidateSource.confidence is a string that
            // candidate-builder parseInt()s; AnalysisResult.confidence is 0-100.
            confidence: String(analysis.confidence),
            bias: analysis.bias,
            recommendation: analysis.recommendation,
          }
        : undefined,
    };
  });
}
