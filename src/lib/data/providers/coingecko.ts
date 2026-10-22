/**
 * CoinGecko fallback provider for crypto price quotes.
 *
 * Requests are bounded, validated against provider timestamps, and coalesced
 * briefly to reduce public API rate-limit pressure. This module must not be
 * used to expose private API credentials in browser bundles.
 */

import type { PriceSnapshot } from "../market-types";
import { toCoinGeckoId } from "../symbols";

const API_URL = "https://api.coingecko.com/api/v3/simple/price";
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 5_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

type CachedQuote = { quote: PriceSnapshot; expiresAt: number };
const quoteCache = new Map<string, CachedQuote>();
const inFlight = new Map<string, Promise<PriceSnapshot | null>>();
let rateLimitedUntil = 0;

type FetchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleepImpl?: (ms: number) => Promise<void>;
  random?: () => number;
};

function retryAfterMs(response: Response, now: number, fallback: number, random: () => number): number {
  const value = response.headers.get("retry-after");
  if (value?.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return Math.round(fallback * (0.5 + Math.min(1, Math.max(0, random()))));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchCryptoPrice(
  instrument: string,
  options: FetchOptions = {},
): Promise<PriceSnapshot | null> {
  const coinId = toCoinGeckoId(instrument);
  if (!coinId) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleepImpl = options.sleepImpl ?? sleep;
  const random = options.random ?? Math.random;
  const useSharedCache = !options.fetchImpl;
  const cached = quoteCache.get(coinId);
  if (useSharedCache && cached && now() < cached.expiresAt) return { ...cached.quote };
  if (useSharedCache && now() < rateLimitedUntil) return null;

  if (useSharedCache) {
    const existing = inFlight.get(coinId);
    if (existing) return existing;
  }

  const request = (async (): Promise<PriceSnapshot | null> => {
    const url = new URL(API_URL);
    url.searchParams.set("ids", coinId);
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_last_updated_at", "true");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt === MAX_ATTEMPTS) return null;
        const delay = Math.round(500 * 2 ** (attempt - 1) * (0.5 + Math.min(1, Math.max(0, random()))));
        await sleepImpl(delay);
        continue;
      }

      if (response.status === 429) {
        const delay = retryAfterMs(response, now(), 500 * 2 ** (attempt - 1), random);
        if (useSharedCache) rateLimitedUntil = now() + Math.max(RATE_LIMIT_COOLDOWN_MS, delay);
        if (attempt === MAX_ATTEMPTS || delay > MAX_RETRY_WAIT_MS) return null;
        await sleepImpl(delay);
        continue;
      }
      if (!response.ok) return null;

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return null;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const record = (payload as Record<string, unknown>)[coinId];
      if (!record || typeof record !== "object" || Array.isArray(record)) return null;

      const quote = record as Record<string, unknown>;
      const price = quote.usd;
      const updatedAt = quote.last_updated_at;
      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0 ||
        typeof updatedAt !== "number" ||
        !Number.isFinite(updatedAt) ||
        updatedAt <= 0
      ) return null;

      const timestamp = updatedAt * 1_000;
      const fetchedAt = now();
      if (timestamp > fetchedAt + 60_000 || fetchedAt - timestamp > 5 * 60_000) return null;

      const result: PriceSnapshot = { price, timestamp, source: "coingecko" };
      if (useSharedCache) {
        rateLimitedUntil = 0;
        quoteCache.set(coinId, { quote: result, expiresAt: fetchedAt + CACHE_TTL_MS });
      }
      return result;
    }
    return null;
  })();

  if (!useSharedCache) return request;
  inFlight.set(coinId, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(coinId) === request) inFlight.delete(coinId);
  }
}
