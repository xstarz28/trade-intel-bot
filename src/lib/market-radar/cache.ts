/**
 * Phase 51 — Provider Cache
 *
 * Provider-aware cache with TTL, stale-while-revalidate,
 * per-instrument isolation, and request deduplication.
 */

import type { CacheEntry, CacheStats } from "./types";

// ═══════════════════════════════════════════════════════════════
// CACHE KEY BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildCacheKey(
  provider: string,
  instrument: string,
  capability: string,
  timeframe?: string,
): string {
  const parts = [provider, instrument, capability];
  if (timeframe) parts.push(timeframe);
  return parts.join(":");
}

// ═══════════════════════════════════════════════════════════════
// RADAR CACHE
// ═══════════════════════════════════════════════════════════════

export class RadarCache {
  private store = new Map<string, CacheEntry>();
  private dedupPromises = new Map<string, Promise<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, staleHits: 0, evictions: 0, size: 0 };

  /**
   * Get cached data if available and not expired.
   * Returns data, or undefined if miss/expired.
   * If staleWhileRevalidate is true, returns stale data but marks as stale-hit.
   */
  get<T>(
    provider: string,
    instrument: string,
    capability: string,
    timeframe?: string,
    staleWhileRevalidate = true,
  ): { data: T; stale: boolean } | undefined {
    const key = buildCacheKey(provider, instrument, capability, timeframe);
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    const now = Date.now();
    const expired = now > entry.timestamp + entry.ttlMs;
    if (expired && !staleWhileRevalidate) {
      this.stats.misses++;
      return undefined;
    }
    if (expired) {
      this.stats.staleHits++;
      return { data: entry.data as T, stale: true };
    }
    this.stats.hits++;
    return { data: entry.data as T, stale: false };
  }

  /**
   * Store data in cache.
   */
  set<T>(
    provider: string,
    instrument: string,
    capability: string,
    data: T,
    ttlMs: number,
    timeframe?: string,
  ): void {
    const key = buildCacheKey(provider, instrument, capability, timeframe);
    this.store.set(key, {
      key,
      provider,
      instrument,
      capability,
      timeframe,
      data,
      timestamp: Date.now(),
      ttlMs,
      stale: false,
    });
    this.stats.size = this.store.size;
  }

  /**
   * Request deduplication: if the same key is being fetched concurrently,
   * return the same promise.
   */
  deduplicate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.dedupPromises.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fetcher().finally(() => this.dedupPromises.delete(key));
    this.dedupPromises.set(key, promise);
    return promise;
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(provider: string, instrument: string, capability: string, timeframe?: string): void {
    const key = buildCacheKey(provider, instrument, capability, timeframe);
    if (this.store.delete(key)) {
      this.stats.evictions++;
      this.stats.size = this.store.size;
    }
  }

  /**
   * Invalidate all entries for a provider.
   */
  invalidateProvider(provider: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.provider === provider) {
        this.store.delete(key);
        count++;
      }
    }
    this.stats.evictions += count;
    this.stats.size = this.store.size;
    return count;
  }

  /**
   * Invalidate all entries for an instrument.
   */
  invalidateInstrument(instrument: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.instrument === instrument) {
        this.store.delete(key);
        count++;
      }
    }
    this.stats.evictions += count;
    this.stats.size = this.store.size;
    return count;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
    this.dedupPromises.clear();
    this.stats = { hits: 0, misses: 0, staleHits: 0, evictions: 0, size: 0 };
  }

  getStats(): CacheStats {
    return { ...this.stats, size: this.store.size };
  }

  get size(): number {
    return this.store.size;
  }
}
