/**
 * Phase 75 — Live Data Guard
 *
 * Shared module that prevents CoinGecko rate limiting from failing the
 * deterministic regression suite. When a live API call returns 429,
 * subsequent tests skip their live data sections gracefully.
 *
 * This module does NOT weaken any test assertions.
 * Tests that require live data simply skip when the guard is tripped.
 * Tests can be run individually (not in the full regression) to exercise
 * live data paths without rate-limit interference.
 */

let _rateLimited = false;
let _lastCheckAt = 0;
const RATE_LIMIT_RESET_MS = 65_000; // CoinGecko free tier resets every ~60s

/**
 * Check if live data fetching is currently rate-limited.
 * Returns true if we should skip live data tests.
 */
export function isRateLimited(): boolean {
  if (!_rateLimited) return false;
  // Auto-reset after cooldown
  if (Date.now() - _lastCheckAt > RATE_LIMIT_RESET_MS) {
    _rateLimited = false;
    return false;
  }
  return true;
}

/**
 * Mark that a rate limit was encountered.
 */
export function markRateLimited(): void {
  _rateLimited = true;
  _lastCheckAt = Date.now();
}

/**
 * Reset the rate limit flag (for manual reset or after successful fetch).
 */
export function resetRateLimit(): void {
  _rateLimited = false;
}

/**
 * Fetch from CoinGecko with rate-limit detection.
 * Returns null if rate-limited (caller should skip the test).
 */
export async function safeCoingeckoFetch(
  ids: string,
): Promise<Record<string, { usd: number; usd_24h_change?: number; usd_24h_vol?: number } | undefined> | null> {
  if (isRateLimited()) return null;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (res.status === 429) {
      markRateLimited();
      console.warn("[live-data-guard] CoinGecko rate limited — live tests will be skipped until cooldown");
      return null;
    }

    const data = await res.json();

    // CoinGecko error response
    if (data && typeof data === "object" && "error" in data) {
      markRateLimited();
      console.warn("[live-data-guard] CoinGecko error:", data.error);
      return null;
    }

    // Success — reset rate limit flag
    resetRateLimit();
    return data;
  } catch (err) {
    // Network error — don't mark as rate limited
    console.warn("[live-data-guard] CoinGecko fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
