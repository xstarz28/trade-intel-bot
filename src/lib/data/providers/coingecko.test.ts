import { describe, expect, it, vi } from "vitest";
import { fetchCryptoPrice } from "./coingecko";

const NOW = 1_800_000_000_000;

function quoteResponse(
  coinId: string,
  price: number,
  updatedAt = NOW / 1_000,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ [coinId]: { usd: price, last_updated_at: updatedAt } }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

describe("CoinGecko fallback provider", () => {
  it("requests provider timestamps and returns validated price provenance", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("include_last_updated_at")).toBe("true");
      expect(url.searchParams.get("ids")).toBe("bitcoin");
      return quoteResponse("bitcoin", 67_000);
    });

    const result = await fetchCryptoPrice("BTC/USD", { fetchImpl: fetchImpl as typeof fetch, now: () => NOW });
    expect(result).toEqual({ price: 67_000, timestamp: NOW, source: "coingecko" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient network failures with bounded backoff", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("socket timeout"))
      .mockResolvedValueOnce(quoteResponse("ethereum", 3_500) as Response);
    const waits: number[] = [];

    const result = await fetchCryptoPrice("ETH/USD", {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      random: () => 0.5,
      sleepImpl: async (ms) => { waits.push(ms); },
    });

    expect(result?.price).toBe(3_500);
    expect(waits).toEqual([500]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After and retries a rate-limited request", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(quoteResponse("solana", 150) as Response);
    const waits: number[] = [];

    const result = await fetchCryptoPrice("SOL/USD", {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      sleepImpl: async (ms) => { waits.push(ms); },
      random: () => 0.5,
    });

    expect(result?.price).toBe(150);
    expect(waits).toEqual([1_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid prices and stale or missing provider timestamps", async () => {
    const invalidPrice = vi.fn(async () => quoteResponse("bitcoin", Number.NaN));
    const invalidResult = await fetchCryptoPrice("BTC/USD", {
      fetchImpl: invalidPrice as typeof fetch,
      now: () => NOW,
    });
    expect(invalidResult).toBeNull();

    const stale = vi.fn(async () => quoteResponse("ethereum", 3_500, NOW / 1_000 - 600));
    const staleResult = await fetchCryptoPrice("ETH/USD", {
      fetchImpl: stale as typeof fetch,
      now: () => NOW,
    });
    expect(staleResult).toBeNull();
  });

  it("fails closed after repeated network failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchCryptoPrice("DOGE/USD", {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      sleepImpl: async () => {},
      random: () => 0.5,
    });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
