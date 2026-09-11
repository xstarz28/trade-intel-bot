/**
 * Phase 178 — provenance-preserving provider cache.
 *
 * Phase 177 bounded the fan-out. Each analysis can now issue up to nine
 * provider calls, and some providers have budgets as low as 2 requests/minute.
 * Caching is therefore necessary — but a cache is also the easiest way to
 * launder old data into "fresh" evidence, which would violate the live-data
 * integrity invariant far more quietly than a fabricated price.
 *
 * The rules this module enforces:
 *
 *  1. A cache entry records WHEN THE PROVIDER OBSERVED the data
 *     (`observedAt`), separately from when it was cached and when it was read.
 *     A cache hit NEVER rewrites `observedAt`.
 *
 *  2. Evidence age is always `readAt - observedAt`. Retrieval time is not
 *     observation time. This is the single most important property here.
 *
 *  3. TTL is per-dataset, derived from that dataset's real update cadence.
 *     There is no global TTL, because a funding rate and a COT report do not
 *     age at the same speed.
 *
 *  4. Failures are never cached as evidence. A miss is a miss.
 *
 *  5. Cache keys are structural, not stringly-typed: every dimension that
 *     changes a provider response is a named field, so a collision requires
 *     deliberately passing the same dimensions.
 *
 *  6. Only PUBLIC provider data may be cached. User-owned risk parameters are
 *     rejected outright — a shared cache must never carry them.
 *
 * "Cached", "fresh", "live" and "provider-observed" are four different
 * properties. This module keeps them separate rather than collapsing them.
 */

// ═══════════════════════════════════════════════════════════════
// DATASETS AND TTLs
// ═══════════════════════════════════════════════════════════════

/**
 * Cacheable datasets. Each has its own semantic update cadence.
 */
export type ProviderDataset =
  | "ohlcv"
  | "quote"
  | "news-sentiment"
  | "fundamentals"
  | "macro"
  | "calendar"
  | "derivatives"
  | "treasury"
  | "cot"
  | "eia"
  | "order-book"
  | "instrument-spec"
  | "fx-rate";

/**
 * Per-dataset TTLs, derived from how often the underlying data can actually
 * change. Deliberately NOT uniform:
 *
 *  - `order-book` (5s) — changes continuously; caching beyond a few seconds
 *    would make the microstructure veto act on a stale book.
 *  - `quote` (20s) / `ohlcv` (60s) — price must stay close to live; the engine
 *    independently rejects prices older than its style budget anyway.
 *  - `derivatives` (60s) — funding/OI update on exchange cadence.
 *  - `fx-rate` (5m) — conversion rate; only affects sizing arithmetic.
 *  - `news-sentiment` (10m) — matches the existing Alpha Vantage behaviour.
 *  - `calendar` (20m) — scheduled events; matches existing TickAtlas TTL.
 *  - `macro` (1h) — macro series update far slower than intraday data.
 *  - `treasury` (6h) — daily yield-curve publication.
 *  - `eia` (6h) — WEEKLY petroleum status report.
 *  - `cot` (12h) — WEEKLY CFTC report, published Fridays.
 *  - `fundamentals` (24h) — quarterly filings; effectively static intraday.
 *  - `instrument-spec` (24h) — contract metadata changes very rarely.
 *
 * Longer TTLs are safe here precisely BECAUSE freshness is recomputed from
 * `observedAt` on every read: a long TTL means "we may reuse this", never
 * "this is still current".
 */
export const DATASET_TTL_MS: Record<ProviderDataset, number> = {
  "order-book": 5_000,
  quote: 20_000,
  ohlcv: 60_000,
  derivatives: 60_000,
  "fx-rate": 5 * 60_000,
  "news-sentiment": 10 * 60_000,
  calendar: 20 * 60_000,
  macro: 60 * 60_000,
  treasury: 6 * 60 * 60_000,
  eia: 6 * 60 * 60_000,
  cot: 12 * 60 * 60_000,
  fundamentals: 24 * 60 * 60_000,
  "instrument-spec": 24 * 60 * 60_000,
};

/**
 * Age beyond which a dataset should no longer be described as current, even
 * when a cached copy exists. Always >= the TTL: TTL governs REUSE, this
 * governs LABELLING.
 */
export const DATASET_FRESH_MS: Record<ProviderDataset, number> = {
  "order-book": 10_000,
  quote: 60_000,
  ohlcv: 5 * 60_000,
  derivatives: 5 * 60_000,
  "fx-rate": 15 * 60_000,
  "news-sentiment": 30 * 60_000,
  calendar: 60 * 60_000,
  macro: 3 * 60 * 60_000,
  treasury: 24 * 60 * 60_000,
  eia: 24 * 60 * 60_000,
  cot: 7 * 24 * 60 * 60_000,
  fundamentals: 7 * 24 * 60 * 60_000,
  "instrument-spec": 7 * 24 * 60 * 60_000,
};

// ═══════════════════════════════════════════════════════════════
// KEYS
// ═══════════════════════════════════════════════════════════════

/**
 * Every dimension that can change a provider response.
 *
 * Structural rather than a bare string so a missing dimension is a type error
 * instead of a silent collision. `instrument` MUST be the provider-native
 * identity, byte-for-byte — never a lossy canonicalisation.
 */
export interface ProviderCacheKey {
  provider: string;
  dataset: ProviderDataset;
  /** Provider-native instrument id, verbatim. Omitted for global datasets. */
  instrument?: string;
  instrumentType?: string;
  timeframe?: string;
  /** e.g. FX conversion direction, calendar currency set. */
  qualifier?: string;
}

/** Fields that must never appear in a shared cache key or payload. */
export const USER_OWNED_FIELDS = [
  "accountEquity",
  "riskPercent",
  "accountCurrency",
  "userId",
  "email",
  "instrumentSpec",
] as const;

/**
 * Serialize a key. Case-sensitive dimensions that are genuinely
 * case-insensitive upstream are normalised ONLY for `instrumentType` and
 * `timeframe` — never for `instrument`, whose exact bytes are provider
 * identity (`BTC-USDT-SWAP` must not become `btc-usdt-swap`).
 */
export function serializeKey(key: ProviderCacheKey): string {
  const parts = [
    key.provider,
    key.dataset,
    key.instrument ?? "-",
    (key.instrumentType ?? "-").toLowerCase(),
    (key.timeframe ?? "-").toUpperCase(),
    key.qualifier ?? "-",
  ];
  return parts.join("|");
}

/** Throws if a caller tries to key or store user-owned data. */
export function assertNoUserData(value: unknown, context: string): void {
  if (!value || typeof value !== "object") return;
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || !node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((USER_OWNED_FIELDS as readonly string[]).includes(k)) {
        throw new Error(
          `refusing to cache user-owned field "${k}" in a shared provider cache (${context})`,
        );
      }
      walk(v, depth + 1);
    }
  };
  walk(value, 0);
}

// ═══════════════════════════════════════════════════════════════
// ENTRIES AND FRESHNESS
// ═══════════════════════════════════════════════════════════════

export type EvidenceFreshness =
  | "FRESH"
  | "DELAYED"
  | "STALE"
  | "HISTORICAL"
  | "UNAVAILABLE";

export interface CachedEvidence<T> {
  data: T;
  provider: string;
  dataset: ProviderDataset;
  /** When the PROVIDER observed this. Never rewritten by a cache hit. */
  observedAt: number;
  /** When this entry entered the cache. Diagnostics only. */
  cachedAt: number;
  /** When this read happened. */
  readAt: number;
  /** `readAt - observedAt`. The only definition of evidence age. */
  ageMs: number;
  /** True when this read was served from cache rather than a provider call. */
  fromCache: boolean;
  /** Derived from `ageMs`, never stored. */
  freshness: EvidenceFreshness;
}

interface StoredEntry {
  data: unknown;
  provider: string;
  dataset: ProviderDataset;
  observedAt: number;
  cachedAt: number;
  expiresAt: number;
}

/**
 * Derive freshness from real elapsed time.
 *
 * This is recomputed on EVERY read. A cached value therefore decays honestly:
 * the same entry can be FRESH now and STALE ten minutes from now without any
 * refetch, which is exactly the intended behaviour.
 */
export function deriveFreshness(
  dataset: ProviderDataset,
  ageMs: number,
): EvidenceFreshness {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "UNAVAILABLE";
  const fresh = DATASET_FRESH_MS[dataset];
  if (ageMs <= fresh) return "FRESH";
  if (ageMs <= fresh * 3) return "DELAYED";
  if (ageMs <= fresh * 12) return "STALE";
  return "HISTORICAL";
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

export interface CacheStats {
  hits: number;
  misses: number;
  providerCalls: number;
  singleFlightJoins: number;
  expired: number;
}

/**
 * A provider cache with single-flight deduplication.
 *
 * Per-process by construction (a Convex action instance). It reduces provider
 * load within an instance and across concurrent callers on that instance; it
 * makes no cross-instance guarantee, and the documentation says so rather than
 * implying a distributed cache.
 */
export class ProviderCache {
  private store = new Map<string, StoredEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    providerCalls: 0,
    singleFlightJoins: 0,
    expired: 0,
  };

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Read-through with single-flight.
   *
   * `fetcher` must return the provider payload AND the provider's own
   * observation time. When the provider does not expose one, the caller passes
   * the acquisition time — but it must be the time of the REAL provider call,
   * never the time of a cache read.
   */
  async fetch<T>(
    key: ProviderCacheKey,
    fetcher: () => Promise<{ data: T; observedAt: number } | null>,
  ): Promise<CachedEvidence<T> | null> {
    const serialized = serializeKey(key);
    const readAt = this.now();

    const entry = this.store.get(serialized);
    if (entry) {
      if (readAt < entry.expiresAt) {
        this.stats.hits++;
        return this.present<T>(entry, readAt, true);
      }
      // Expired: drop it and re-acquire. Never serve it as current.
      this.store.delete(serialized);
      this.stats.expired++;
    }

    // Single-flight: concurrent misses on the SAME key share one call.
    const pending = this.inFlight.get(serialized);
    if (pending) {
      this.stats.singleFlightJoins++;
      const shared = (await pending) as
        | { data: T; observedAt: number }
        | null;
      if (!shared) return null;
      return this.present<T>(
        {
          data: shared.data,
          provider: key.provider,
          dataset: key.dataset,
          observedAt: shared.observedAt,
          cachedAt: shared.observedAt,
          expiresAt: shared.observedAt + DATASET_TTL_MS[key.dataset],
        },
        this.now(),
        // A single-flight join is NOT a cache hit: the provider was called,
        // this caller simply shared the result.
        false,
      );
    }

    this.stats.misses++;
    this.stats.providerCalls++;

    const flight = (async () => {
      const result = await fetcher();
      if (!result) return null;
      assertNoUserData(result.data, `${key.provider}/${key.dataset}`);
      this.store.set(serialized, {
        data: result.data,
        provider: key.provider,
        dataset: key.dataset,
        observedAt: result.observedAt,
        cachedAt: this.now(),
        expiresAt: this.now() + DATASET_TTL_MS[key.dataset],
      });
      return result;
    })();

    this.inFlight.set(serialized, flight);

    // A failure is NEVER cached: the store write only happens on success
    // inside `flight`, so a rejection leaves no entry behind. The `finally`
    // clears the in-flight slot either way, so the next caller retries
    // cleanly and no unrelated key is affected.
    try {
      const result = (await flight) as { data: T; observedAt: number } | null;
      if (!result) return null;
      return this.present<T>(this.store.get(serialized)!, this.now(), false);
    } finally {
      this.inFlight.delete(serialized);
    }
  }

  /** Read without acquiring. Returns null on miss or expiry. */
  peek<T>(key: ProviderCacheKey): CachedEvidence<T> | null {
    const serialized = serializeKey(key);
    const entry = this.store.get(serialized);
    if (!entry) return null;
    const readAt = this.now();
    if (readAt >= entry.expiresAt) {
      this.store.delete(serialized);
      this.stats.expired++;
      return null;
    }
    return this.present<T>(entry, readAt, true);
  }

  private present<T>(
    entry: StoredEntry,
    readAt: number,
    fromCache: boolean,
  ): CachedEvidence<T> {
    // Age is measured from the PROVIDER's observation, not from `cachedAt`
    // and not from `readAt` alone.
    const ageMs = readAt - entry.observedAt;
    return {
      data: entry.data as T,
      provider: entry.provider,
      dataset: entry.dataset,
      observedAt: entry.observedAt,
      cachedAt: entry.cachedAt,
      readAt,
      ageMs,
      fromCache,
      freshness: deriveFreshness(entry.dataset, ageMs),
    };
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
