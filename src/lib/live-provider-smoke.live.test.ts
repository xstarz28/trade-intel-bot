/**
 * Live provider smoke tests — moved out of
 * `live-provider-verification.phase54.test.ts` by Phase 237.
 *
 * WHY THEY MOVED
 * These tests assert on responses from real third-party endpoints. They were
 * running inside `npm test`, and Phase 237's runtime audit measured 29 real
 * outbound requests from that file during a single default run — invisible to
 * the Phase 181 source scan, because the URL is built inside
 * `market-radar/verification.ts` rather than in the test.
 *
 * A test that can only pass while a third party is up and un-throttled is not
 * evidence about this repository. The assertions below are unchanged; only the
 * place they run has changed.
 *
 * RUN IT WITH:
 *   LIVE_PROVIDER_VERIFICATION=1 npm run test:live
 */
import { describe, it, expect } from "vitest";

import { VERIFICATION_MATRIX, verifyProvider } from "./market-radar/verification";

// ═══════════════════════════════════════════════════════════════
// I. LIVE SMOKE: COINGECKO (PUBLIC)
// ═══════════════════════════════════════════════════════════════

describe("I — Live Smoke: CoinGecko (Public)", () => {
  it("BTC/USD quote is live-verified or rate-limited", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "coingecko" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec);
    // Public endpoint — should succeed or be rate-limited
    expect(["LIVE_VERIFIED", "RATE_LIMITED", "TIMEOUT", "ENDPOINT_FAILED"]).toContain(result.status);
    if (result.status === "LIVE_VERIFIED") {
      expect(result.schemaValid).toBe(true);
      expect(result.numericValid).toBe(true);
      expect(result.freshness).toBe("FRESH");
    }
  }, 15_000);

  it("ETH/USD quote is live-verified or rate-limited", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "coingecko" && s.instrument === "ETH/USD",
    )!;
    const result = await verifyProvider(spec);
    expect(["LIVE_VERIFIED", "RATE_LIMITED", "TIMEOUT", "ENDPOINT_FAILED"]).toContain(result.status);
  }, 15_000);

  it("SOL/USD quote is live-verified or rate-limited", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "coingecko" && s.instrument === "SOL/USD",
    )!;
    const result = await verifyProvider(spec);
    expect(["LIVE_VERIFIED", "RATE_LIMITED", "TIMEOUT", "ENDPOINT_FAILED"]).toContain(result.status);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// J. LIVE SMOKE: OKX (PUBLIC)
// ═══════════════════════════════════════════════════════════════

describe("J — Live Smoke: OKX (Public)", () => {
  it("BTC-USDT OHLCV is live-verified or rate-limited", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "okx" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec);
    // OKX daily candles may be older than 5 min — DATA_STALE is acceptable
    expect(["LIVE_VERIFIED", "RATE_LIMITED", "TIMEOUT", "ENDPOINT_FAILED", "DATA_STALE"]).toContain(result.status);
    if (result.status === "LIVE_VERIFIED") {
      expect(result.schemaValid).toBe(true);
      expect(result.numericValid).toBe(true);
    }
  }, 15_000);

  it("ETH-USDT OHLCV is live-verified or rate-limited", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "okx" && s.instrument === "ETH/USD",
    )!;
    const result = await verifyProvider(spec);
    expect(["LIVE_VERIFIED", "RATE_LIMITED", "TIMEOUT", "ENDPOINT_FAILED", "DATA_STALE"]).toContain(result.status);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// K. LIVE SMOKE: TREASURY (PUBLIC)
// ═══════════════════════════════════════════════════════════════

describe("K — Live Smoke: Treasury (Public)", () => {
  it("US10Y yield is live-verified or endpoint-fails gracefully", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "treasury" && s.instrument === "US10Y",
    )!;
    const result = await verifyProvider(spec);
    // Treasury reports may be older than 5 min → DATA_STALE is expected
    expect(["LIVE_VERIFIED", "TIMEOUT", "ENDPOINT_FAILED", "MALFORMED_RESPONSE", "DATA_STALE"]).toContain(result.status);
  }, 20_000);
});

// ═══════════════════════════════════════════════════════════════
// L. LIVE SMOKE: CFTC (PUBLIC)
// ═══════════════════════════════════════════════════════════════

describe("L — Live Smoke: CFTC (Public)", () => {
  it("EUR COT data is live-verified or fails gracefully", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "cftc" && s.instrument === "EUR/USD",
    )!;
    const result = await verifyProvider(spec);
    // CFTC data is weekly → DATA_STALE is expected; may also fail with HTTP errors
    expect(["LIVE_VERIFIED", "TIMEOUT", "ENDPOINT_FAILED", "MALFORMED_RESPONSE", "DATA_STALE"]).toContain(result.status);
  }, 20_000);
});

// ═══════════════════════════════════════════════════════════════
// M. LIVE SMOKE: DEFILLAMA (PUBLIC)
// ═══════════════════════════════════════════════════════════════

describe("M — Live Smoke: DeFiLlama (Public)", () => {
  it("BTC chain TVL is live-verified or fails gracefully", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "defillama" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec);
    expect(["LIVE_VERIFIED", "TIMEOUT", "ENDPOINT_FAILED", "MALFORMED_RESPONSE"]).toContain(result.status);
  }, 15_000);
});
