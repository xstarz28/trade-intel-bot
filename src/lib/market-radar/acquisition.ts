/**
 * Phase 51 — Provider-Aware Market Data Acquisition
 *
 * Orchestrates market data acquisition through provider routing
 * with isolation, rate limiting, caching, and failure resilience.
 *
 * Provider availability NEVER becomes directional evidence.
 * Missing data remains missing — never fabricated.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { MarketSnapshot } from "./types";
import { RadarCache } from "./cache";
import { RateLimitController } from "./rate-limit";

// ═══════════════════════════════════════════════════════════════
// ACQUISITION RESULT
// ═══════════════════════════════════════════════════════════════

export interface AcquisitionResult {
  instrument: string;
  assetClass: AssetClass;
  snapshot: MarketSnapshot | null;
  provider: string;
  success: boolean;
  error?: string;
  latencyMs: number;
  fromCache: boolean;
}

// ═══════════════════════════════════════════════════════════════
// DATA ACQUISITION SERVICE
// ═══════════════════════════════════════════════════════════════

export interface MarketDataProvider {
  /** Provider name. */
  name: string;
  /** Supported asset classes. */
  supportedAssetClasses: AssetClass[];
  /** Supported capabilities. */
  capabilities: string[];
  /** Fetch market snapshot for an instrument. */
  fetch(instrument: string, assetClass: AssetClass): Promise<MarketSnapshot | null>;
  /** Health status. */
  isAvailable(): boolean;
}

export class MarketDataAcquisitionService {
  private providers: MarketDataProvider[];
  private cache: RadarCache;
  private rateLimit: RateLimitController;

  constructor(
    providers: MarketDataProvider[] = [],
    cache?: RadarCache,
    rateLimit?: RateLimitController,
  ) {
    this.providers = providers;
    this.cache = cache ?? new RadarCache();
    this.rateLimit = rateLimit ?? new RateLimitController();
  }

  /**
   * Get the best available provider for an instrument + capability.
   */
  selectProvider(
    instrument: string,
    assetClass: AssetClass,
    capability: string,
  ): MarketDataProvider | null {
    const candidates = this.providers.filter(
      p =>
        p.isAvailable() &&
        p.supportedAssetClasses.includes(assetClass) &&
        p.capabilities.includes(capability) &&
        this.rateLimit.canRequest(p.name),
    );
    // Prefer provider with least requests (spread load)
    return candidates.sort((a, b) =>
      (this.rateLimit.getStateFor(a.name)?.totalRequests ?? 0) -
      (this.rateLimit.getStateFor(b.name)?.totalRequests ?? 0)
    )[0] ?? null;
  }

  /**
   * Acquire market data for an instrument.
   */
  async acquire(
    instrument: string,
    assetClass: AssetClass,
    _now?: number,
  ): Promise<AcquisitionResult> {
    const startTime = Date.now();

    // Check cache first (stale-while-revalidate)
    const cached = this.cache.get<MarketSnapshot>(
      "*", instrument, "market-snapshot",
    );
    if (cached && !cached.stale) {
      return {
        instrument,
        assetClass,
        snapshot: cached.data,
        provider: cached.data.provider,
        success: true,
        latencyMs: Date.now() - startTime,
        fromCache: true,
      };
    }

    // Select provider
    const provider = this.selectProvider(instrument, assetClass, "market-snapshot")
      ?? this.selectProvider(instrument, assetClass, "quote")
      ?? this.selectProvider(instrument, assetClass, "ohlcv");

    if (!provider) {
      return {
        instrument,
        assetClass,
        snapshot: null,
        provider: "none",
        success: false,
        error: "no available provider for this instrument",
        latencyMs: Date.now() - startTime,
        fromCache: false,
      };
    }

    // Request with deduplication and rate limit
    try {
      this.rateLimit.recordRequest(provider.name);
      const snapshot = await this.cache.deduplicate(
        `acquire:${provider.name}:${instrument}`,
        () => provider.fetch(instrument, assetClass),
      );

      if (snapshot) {
        // Cache result
        this.cache.set(
          provider.name, instrument, "market-snapshot",
          snapshot, 5 * 60_000, // 5 min TTL
        );
        this.rateLimit.recordSuccess(provider.name);

        return {
          instrument,
          assetClass,
          snapshot,
          provider: provider.name,
          success: true,
          latencyMs: Date.now() - startTime,
          fromCache: false,
        };
      }

      return {
        instrument,
        assetClass,
        snapshot: null,
        provider: provider.name,
        success: false,
        error: "provider returned null",
        latencyMs: Date.now() - startTime,
        fromCache: false,
      };
    } catch (err: any) {
      const is429 = err?.status === 429 || err?.statusCode === 429;
      this.rateLimit.recordFailure(provider.name, is429);
      return {
        instrument,
        assetClass,
        snapshot: null,
        provider: provider.name,
        success: false,
        error: err?.message || "provider error",
        latencyMs: Date.now() - startTime,
        fromCache: false,
      };
    }
  }

  /**
   * Batch acquire for multiple instruments.
   */
  async acquireBatch(
    instruments: { instrument: string; assetClass: AssetClass }[],
    now?: number,
    concurrency = 5,
  ): Promise<AcquisitionResult[]> {
    const results: AcquisitionResult[] = [];
    // Process in batches to avoid overwhelming providers
    for (let i = 0; i < instruments.length; i += concurrency) {
      const batch = instruments.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(({ instrument, assetClass }) =>
          this.acquire(instrument, assetClass, now),
        ),
      );
      results.push(...batchResults);
    }
    return results;
  }

  /** Expose cache for external stats. */
  getCache(): RadarCache { return this.cache; }
  /** Expose rate limiter. */
  getRateLimit(): RateLimitController { return this.rateLimit; }
}
