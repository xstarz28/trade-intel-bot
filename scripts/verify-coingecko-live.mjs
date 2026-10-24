#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const API_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINS = ["bitcoin", "ethereum"];
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function retryDelayMs(response, now = Date.now(), fallbackMs = 2_000, random = Math.random) {
  const value = response.headers.get("retry-after");
  if (value !== null && value.trim() !== "") {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }

  // Bounded jitter avoids synchronized retries when the provider omits Retry-After.
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  return Math.round(fallbackMs * jitter);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifyCoinGeckoLive({
  apiKey,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  log = console.log,
  warn = console.warn,
  now = Date.now,
  random = Math.random,
} = {}) {
  const normalizedApiKey = apiKey?.trim();

  const url = new URL(API_URL);
  url.searchParams.set("ids", COINS.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_last_updated_at", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_24hr_change", "true");

  let response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          ...(normalizedApiKey ? { "x-cg-demo-api-key": normalizedApiKey } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `CoinGecko request failed after ${MAX_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}; no live-provider check was passed.`,
        );
      }
      const delay = Math.min(MAX_RETRY_DELAY_MS, Math.round(1_000 * 2 ** (attempt - 1) * (0.5 + Math.min(1, Math.max(0, random())))));
      warn(`CoinGecko network/timeout error; retrying with bounded exponential backoff (attempt ${attempt + 1}/${MAX_ATTEMPTS}).`);
      await sleepImpl(delay);
      continue;
    }

    if (response.status !== 429) break;
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `CoinGecko still returned HTTP 429 after ${MAX_ATTEMPTS} attempts. Check Demo API plan/rate limits; no live-provider check was passed.`,
      );
    }

    const fallbackMs = 1_000 * 2 ** (attempt - 1);
    const delay = retryDelayMs(response, now(), fallbackMs, random);
    if (!Number.isFinite(delay) || delay > MAX_RETRY_DELAY_MS) {
      throw new Error(
        `CoinGecko requested a ${Number.isFinite(delay) ? Math.ceil(delay / 1000) : "non-finite"}s retry delay, exceeding the safe ${MAX_RETRY_DELAY_MS / 1000}s limit. Retry later; no live-provider check was passed.`,
      );
    }
    warn(`CoinGecko rate-limited the request; retrying after the provider's Retry-After window (attempt ${attempt + 1}/${MAX_ATTEMPTS}).`);
    await sleepImpl(delay);
  }

  if (!response?.ok) {
    const body = await response?.text?.().catch(() => "") ?? "";
    throw new Error(`CoinGecko HTTP ${response?.status ?? "unknown"}: ${body.slice(0, 500)}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("CoinGecko returned invalid JSON; live-provider verification failed.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("CoinGecko returned a malformed response object; live-provider verification failed.");
  }

  for (const coin of COINS) {
    const quote = data?.[coin];
    const price = quote?.usd;
    const updatedAt = quote?.last_updated_at;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`CoinGecko returned an invalid USD price for ${coin}; live-provider verification failed.`);
    }
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) {
      throw new Error(`CoinGecko returned a missing or invalid provider timestamp for ${coin}; live-provider verification failed.`);
    }
    const quoteTimestamp = updatedAt * 1_000;
    const ageMs = now() - quoteTimestamp;
    if (quoteTimestamp > now() + 60_000 || ageMs > 5 * 60_000) {
      throw new Error(`CoinGecko returned a stale or future-dated quote for ${coin}; live-provider verification failed.`);
    }
    log(`CoinGecko live quote verified: ${coin.toUpperCase()} USD price is finite, positive, and timestamp-fresh.`);
  }
  log("CoinGecko live-provider verification passed.");
  return { verifiedCoins: [...COINS] };
}

async function main() {
  await verifyCoinGeckoLive({ apiKey: process.env.COINGECKO_DEMO_API_KEY });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
