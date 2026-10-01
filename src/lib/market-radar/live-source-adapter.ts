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

    // Phase 240: numerical validation — price, bid, ask, volume
    const priceVal = marketData?.price?.price;
    const bid = marketData?.price?.bid;
    const ask = marketData?.price?.ask;
    const hasValidBidAsk =
      typeof bid === "number" &&
      typeof ask === "number" &&
      Number.isFinite(bid) &&
      Number.isFinite(ask) &&
      bid > 0 &&
      ask > 0 &&
      ask >= bid;

    const volume = (marketData as any)?.volume;
    const hasInvalidVolume =
      volume !== undefined && !(typeof volume === "number" && Number.isFinite(volume) && volume >= 0);

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
            price: marketData.price.price, // raw preserved, downstream validates via isValidPrice
            ohlcvAvailable: marketData.candles.length > 0,
            availableTimeframes:
              marketData.candles.length > 0 ? [marketData.timeframe] : [],
            // Phase 300 — absent analysis stays "unknown", never a default
            // "neutral" (same contract as the Dashboard radar builder).
            htfBias:
              analysis?.bias === "Bullish"
                ? "long"
                : analysis?.bias === "Bearish"
                  ? "short"
                  : analysis?.bias === "Neutral"
                    ? "neutral"
                    : "unknown",
            // Phase 290-A — confirmed structural evidence, carried verbatim from
            // the analysis engine (never re-derived here). Absent when the
            // engine produced no event read for this instrument.
            ...(() => {
              const setup = analysis?.structuralEvidence?.timeframes.find(
                (t) => t.role === "setup",
              );
              const inv = setup?.invalidation;
              const ev = setup?.event;
              const pair = analysis?.technicalData?.smc?.structural;
              if (!setup || (!ev && !inv && !pair)) return {};
              return {
                ...(ev
                  ? {
                      structuralEvent: {
                        kind: ev.kind,
                        direction: ev.direction,
                        brokenLevel: ev.brokenLevel,
                        candleTime: ev.candleTime,
                        timeframe: setup.timeframe,
                      },
                    }
                  : {}),
                ...(inv
                  ? {
                      structuralInvalidation: {
                        level: inv.level,
                        timeframe: setup.timeframe,
                        swingKind: inv.swingKind,
                      },
                    }
                  : {}),
                ...(pair ? { structuralPairState: pair.state } : {}),
              };
            })(),
            // Phase 291 — the location/setup verdict, carried verbatim. No
            // location is recomputed here from another timeframe's price.
            ...(() => {
              const tl = analysis?.tradeLocation;
              if (!tl) return {};
              const nearest = tl.zones[0];
              const sweep = tl.liquidity.sweep;
              return {
                setupContext: {
                  state: tl.context.state,
                  direction: tl.context.direction,
                  location: tl.location,
                  reasons: tl.context.reasons,
                },
                ...(nearest
                  ? {
                      zoneContext: {
                        kind: nearest.kind,
                        direction: nearest.direction,
                        lower: nearest.lower,
                        upper: nearest.upper,
                        position: nearest.position,
                        status: nearest.status,
                        timeframe: tl.setupTimeframe,
                      },
                    }
                  : {}),
                ...(sweep
                  ? {
                      liquidityEvent: {
                        side: sweep.side,
                        level: sweep.level,
                        candleTime: sweep.candleTime,
                        ageCandles: sweep.ageCandles,
                        timeframe: tl.setupTimeframe,
                      },
                    }
                  : {}),
              };
            })(),
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
            // Phase 240: validate bid/ask before computing spread, never fabricate.
            ...(hasValidBidAsk
              ? {
                  spreadBps: (() => {
                    const mid = (bid! + ask!) / 2;
                    const spread = ask! - bid!;
                    if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(spread) || spread < 0) return undefined;
                    const bps = (spread / mid) * 10000;
                    if (!Number.isFinite(bps) || bps < 0) return undefined;
                    return bps;
                  })(),
                }
              : {}),
            // Preserve change/volatility only if finite and valid — derived remains derived
            ...((marketData as any).change24h !== undefined && Number.isFinite((marketData as any).change24h)
              ? { change24h: (marketData as any).change24h }
              : {}),
            ...((marketData as any).volatility !== undefined &&
            Number.isFinite((marketData as any).volatility) &&
            (marketData as any).volatility >= 0
              ? { volatility: (marketData as any).volatility }
              : {}),
            // Volume preserved only if valid
            ...(hasInvalidVolume ? {} : volume !== undefined ? { volume24h: volume } : {}),
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
