import type { TokenomicsIntelligence } from "./types";

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3/coins/";
const COINGECKO_REQUEST_TIMEOUT_MS = 3_000;
const COINGECKO_MAX_ATTEMPTS = 2;
const COINGECKO_MAX_RETRY_AFTER_MS = 1_000;

export interface CoinGeckoSupplyFetchOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CoinGeckoSupplyFetchResult {
  payload?: unknown;
  failureReason?: string;
}

function retryAfterMs(response: Response, now: number): number {
  const header = response.headers.get("retry-after");
  if (!header) return 1_000;
  const seconds = Number(header);
  if (header.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1_000;
}

/**
 * Fetch CoinGecko's public coin detail with an optional Demo key and one
 * strictly bounded retry for HTTP 429. Errors are returned as diagnostics
 * instead of silently disappearing; callers must not infer missing supply.
 */
export async function fetchCoinGeckoSupplyPayload(
  coinId: string,
  options: CoinGeckoSupplyFetchOptions = {},
): Promise<CoinGeckoSupplyFetchResult> {
  const normalizedId = coinId.trim();
  if (!normalizedId) return { failureReason: "CoinGecko supply fallback skipped: coin ID is empty." };

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const url = COINGECKO_API_BASE + encodeURIComponent(normalizedId) +
    "?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false";
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.apiKey?.trim()) headers["x-cg-demo-api-key"] = options.apiKey.trim();

  for (let attempt = 1; attempt <= COINGECKO_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(COINGECKO_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        failureReason: "CoinGecko supply fallback request failed: " +
          (error instanceof Error ? error.message : String(error)),
      };
    }

    if (response.status === 429) {
      if (attempt === COINGECKO_MAX_ATTEMPTS) {
        return { failureReason: "CoinGecko supply fallback rate-limited (HTTP 429) after 2 attempts." };
      }
      const delay = retryAfterMs(response, now());
      if (!Number.isFinite(delay) || delay > COINGECKO_MAX_RETRY_AFTER_MS) {
        return {
          failureReason: "CoinGecko supply fallback rate-limited (HTTP 429); Retry-After exceeds the safe 1s retry window.",
        };
      }
      await sleepImpl(delay);
      continue;
    }

    if (!response.ok) {
      return { failureReason: `CoinGecko supply fallback unavailable (HTTP ${response.status}).` };
    }

    try {
      return { payload: await response.json() };
    } catch {
      return { failureReason: "CoinGecko supply fallback returned invalid JSON." };
    }
  }

  return { failureReason: "CoinGecko supply fallback ended without a usable response." };
}

function positiveFinite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parse CoinGecko's public coin-detail response as a SUPPLY-only fallback.
 * It intentionally never invents an unlock schedule: this fallback can fill
 * circulating/total/max supply fields, but upcoming unlock events stay absent.
 */
export function parseCoinGeckoSupplyFallback(
  payload: unknown,
  fetchedAt = Date.now(),
): TokenomicsIntelligence | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const marketData = root.market_data;
  if (!marketData || typeof marketData !== "object") return null;
  const md = marketData as Record<string, unknown>;
  const circulatingSupply = positiveFinite(md.circulating_supply);
  const totalSupply = positiveFinite(md.total_supply);
  const maxSupply = positiveFinite(md.max_supply);
  if (circulatingSupply === undefined && totalSupply === undefined && maxSupply === undefined) return null;

  const denominator = maxSupply ?? totalSupply;
  const updated = typeof md.last_updated === "string" ? Date.parse(md.last_updated) : Number.NaN;
  const observedAt = Number.isFinite(updated) && updated > 0 ? updated : fetchedAt;
  const supply: NonNullable<TokenomicsIntelligence["supply"]> = {
    reliable: circulatingSupply !== undefined,
    ...(circulatingSupply !== undefined ? { circulatingSupply } : {}),
    ...(totalSupply !== undefined ? { totalSupply } : {}),
    ...(maxSupply !== undefined ? { maxSupply } : {}),
    ...(circulatingSupply !== undefined && denominator !== undefined
      ? { circulatingPercent: Math.min(100, circulatingSupply / denominator * 100) }
      : {}),
  };

  return {
    provider: "CoinGecko public API",
    observedAt,
    freshness: fetchedAt - observedAt > 24 * 60 * 60_000 ? "STALE" : "FRESH",
    quality: "DEGRADED",
    available: true,
    failureReason: "Supply metrics use CoinGecko as a fallback. This source does not provide a verified upcoming unlock calendar; unlock events remain unconfirmed.",
    supply,
    availableDatasets: 1,
    totalDatasets: 2,
  };
}
