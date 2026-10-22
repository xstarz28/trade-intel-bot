#!/usr/bin/env node

const API_URL = "https://api.coingecko.com/api/v3/simple/price";
const COINS = ["bitcoin", "ethereum"];
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

function retryDelayMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 2_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 2_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = process.env.COINGECKO_DEMO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "COINGECKO_DEMO_API_KEY is required. Create a CoinGecko Demo API key and set it as an environment variable; live verification will not silently skip.",
    );
  }

  const url = new URL(API_URL);
  url.searchParams.set("ids", COINS.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_24hr_change", "true");

  let response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-cg-demo-api-key": apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status !== 429) break;
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `CoinGecko still returned HTTP 429 after ${MAX_ATTEMPTS} attempts. Check Demo API plan/rate limits; no live-provider check was passed.`,
      );
    }

    const delay = retryDelayMs(response);
    if (delay > MAX_RETRY_DELAY_MS) {
      throw new Error(
        `CoinGecko requested a ${Math.ceil(delay / 1000)}s retry delay, exceeding the safe ${MAX_RETRY_DELAY_MS / 1000}s limit. Retry later; no live-provider check was passed.`,
      );
    }
    console.warn(`CoinGecko rate-limited the request; retrying once the provider's Retry-After window expires (attempt ${attempt + 1}/${MAX_ATTEMPTS}).`);
    await sleep(delay);
  }

  if (!response?.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`CoinGecko HTTP ${response?.status ?? "unknown"}: ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  for (const coin of COINS) {
    const price = data?.[coin]?.usd;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`CoinGecko returned an invalid USD price for ${coin}; live-provider verification failed.`);
    }
    console.log(`CoinGecko live quote verified: ${coin.toUpperCase()} USD price is finite and positive.`);
  }
  console.log("CoinGecko live-provider verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
