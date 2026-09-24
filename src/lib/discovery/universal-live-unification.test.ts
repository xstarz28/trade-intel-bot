/**
 * Discovery → native acquire → scanner, and the same identity → Analyze acquire.
 *
 * Paths must not contradict availability. Newly discovered instruments do not
 * need an instruments.ts entry. XAU/USD is a regression via discovery only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scanInstruments } from "@/lib/liveScanner";
import { resolveInstrument } from "@/lib/data/universal/instruments";
import {
  acquireProviderNativeLiveData,
  providerNativeAcquisitionToMarketData,
} from "@/lib/market-radar/provider-registry";
import { resetLiveState, type Transport } from "@/lib/data/universal/live/client";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import { resolveLiveIdentity } from "./live-identity";
import type { DiscoveredInstrument } from "./types";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";

const NOW = Date.now();

function discovered(
  overrides: Partial<DiscoveredInstrument> &
    Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): DiscoveredInstrument {
  return {
    subType: "commodity_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function tdBody(symbol: string) {
  const t0 = NOW - 3_600_000;
  const t1 = NOW - 60_000;
  return {
    symbol,
    values: [
      {
        datetime: new Date(t1).toISOString(),
        open: "101",
        high: "102",
        low: "100",
        close: "101.5",
        volume: "10",
      },
      {
        datetime: new Date(t0).toISOString(),
        open: "100",
        high: "101",
        low: "99",
        close: "100.5",
        volume: "8",
      },
    ],
  };
}

const tdEnv = (name: string) => (name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined);

function tdTransport(symbol: string): Transport {
  return async (url) => {
    expect(url.toLowerCase()).not.toMatch(/apikey=/);
    expect(url).toContain(`symbol=${encodeURIComponent(symbol)}`);
    return { ok: true, status: 200, json: tdBody(symbol) };
  };
}

describe("universal live unification", () => {
  it("a discovered XAU/USD reaches the scanner via native identity, not a whitelist", async () => {
    const xau = discovered({
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      assetClass: "commodity",
      subType: "commodity_spot",
      baseAsset: "XAU",
    });

    const acq = await acquireProviderNativeLiveData(
      {
        instrument: xau.providerInstrumentId,
        provider: xau.provider,
        providerInstrumentId: xau.providerInstrumentId,
        assetClass: xau.assetClass,
      },
      tdEnv,
      tdTransport("XAU/USD"),
    );
    expect(acq.success).toBe(true);
    expect(acq.providerInstrumentId).toBe("XAU/USD");
    expect(acq.snapshot?.price).toBe(101.5);
    expect(acq.liveStatus).toBe("LIVE_VERIFIED");

    const market = providerNativeAcquisitionToMarketData(acq);
    expect(market?.providerInstrumentId).toBe("XAU/USD");

    const source: LiveCandidateSource = {
      instrument: xau.providerInstrumentId,
      assetClass: xau.assetClass,
      providerNative: {
        provider: xau.provider,
        providerInstrumentId: xau.providerInstrumentId,
      },
      marketData: market!,
    };

    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [xau],
      succeededProviders: ["twelve-data"],
      batchSize: 20,
      now: NOW,
      acquire: async (batch) =>
        batch.map((item) => ({
          provider: item.provider,
          providerInstrumentId: item.providerInstrumentId,
          assetClass: item.assetClass,
          success: true,
          source,
          observedAt: NOW,
        })),
    });

    expect(step.liveSources.map((s) => s.instrument)).toContain("XAU/USD");
    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
      providerErrors: step.providerErrors,
    });
    const ranked =
      scan.results.get("INTRADAY")?.rankedInstruments.map((r) => r.instrument) ?? [];
    expect(ranked).toContain("XAU/USD");
  });

  it("the same native identity is what Analyze would acquire — availability agrees", async () => {
    const xau = discovered({
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      assetClass: "commodity",
      baseAsset: "XAU",
    });
    const identity = resolveLiveIdentity({
      typed: "XAU/USD",
      instrumentType: "forex",
      discovered: [xau],
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const scannerAcq = await acquireProviderNativeLiveData(
      {
        instrument: identity.providerInstrumentId,
        provider: identity.provider,
        providerInstrumentId: identity.providerInstrumentId,
        assetClass: identity.assetClass,
      },
      tdEnv,
      tdTransport("XAU/USD"),
    );
    const analyzeAcq = await acquireProviderNativeLiveData(
      {
        instrument: identity.providerInstrumentId,
        provider: identity.provider,
        providerInstrumentId: identity.providerInstrumentId,
        assetClass: identity.assetClass,
        timeframe: "H1",
        count: 210,
      },
      tdEnv,
      tdTransport("XAU/USD"),
    );

    expect(scannerAcq.success).toBe(true);
    expect(analyzeAcq.success).toBe(true);
    expect(scannerAcq.providerInstrumentId).toBe(analyzeAcq.providerInstrumentId);
    expect(scannerAcq.provider).toBe(analyzeAcq.provider);
    expect(analyzeAcq.success).toBe(scannerAcq.success);
  });

  it("a generic discovered instrument with no instruments.ts entry is analyzable on the native path", async () => {
    expect(resolveInstrument("BRAND-NEW-XYZ")).toBeUndefined();
    const fresh = discovered({
      provider: "twelve-data",
      providerInstrumentId: "BRAND-NEW-XYZ",
      assetClass: "equity",
      subType: "equity_common",
      baseAsset: "BRAND-NEW-XYZ",
    });
    const identity = resolveLiveIdentity({ typed: "BRAND-NEW-XYZ", discovered: [fresh] });
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const acq = await acquireProviderNativeLiveData(
      {
        instrument: identity.providerInstrumentId,
        provider: identity.provider,
        providerInstrumentId: identity.providerInstrumentId,
        assetClass: identity.assetClass,
      },
      tdEnv,
      tdTransport("BRAND-NEW-XYZ"),
    );
    expect(acq.success).toBe(true);
    expect(acq.providerInstrumentId).toBe("BRAND-NEW-XYZ");

    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [fresh],
      succeededProviders: ["twelve-data"],
      batchSize: 20,
      now: NOW,
      acquire: async (batch) =>
        batch.map((item) => ({
          provider: item.provider,
          providerInstrumentId: item.providerInstrumentId,
          assetClass: item.assetClass,
          success: true,
          source: {
            instrument: item.providerInstrumentId,
            assetClass: item.assetClass,
            providerNative: {
              provider: item.provider,
              providerInstrumentId: item.providerInstrumentId,
            },
            marketData: providerNativeAcquisitionToMarketData(acq)!,
          },
          observedAt: NOW,
        })),
    });
    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
    });
    const ranked =
      scan.results.get("INTRADAY")?.rankedInstruments.map((r) => r.instrument) ?? [];
    expect(ranked).toContain("BRAND-NEW-XYZ");
  });

  it("vendor 429 on the native path is RATE_LIMIT, never a live success", async () => {
    const acq = await acquireProviderNativeLiveData(
      {
        instrument: "XAU/USD",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
        assetClass: "commodity",
      },
      tdEnv,
      async () => ({
        ok: true,
        status: 200,
        json: { code: 429, message: "You have exceeded your API credits" },
      }),
    );
    expect(acq.success).toBe(false);
    expect(acq.snapshot).toBeNull();
    expect(acq.failureClass).toBe("RATE_LIMIT");
    expect(acq.error).not.toMatch(/apikey=/i);
  });

  it("Dashboard Analyze resolves against tracked discovery and shows fetchError on empty", () => {
    const dash = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(dash).toContain("resolveLiveIdentity");
    expect(dash).toContain("discoveredFromTracked");
    expect(dash).toContain("providerInstrumentId: identity.providerInstrumentId");
    expect(dash).toContain("uiLiveFailure");
    expect(dash).toMatch(/fetchError && \(/);
    expect(dash).not.toMatch(/GOLD\s*→|\"GOLD\"\s*:/);
    expect(dash).not.toContain("instrument.toUpperCase()");
  });

  it("fetchMarketData shares the Twelve Data parser and skips the TD key for provider-native live legs", () => {
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).toContain("parseTwelveDataTimeSeries");
    expect(src).toContain("acquireProviderNativeLiveData");
    expect(src).toContain("acquireCcxtLive");
    // Phase 272 — the TD key guard exempts every verified provider-native
    // live-OHLCV leg (OKX and the CCXT family), not just the literal OKX
    // branch of the OKX-slice era.
    expect(src).toContain("!apiKey && !useProviderNative");
    expect(src).toContain("const symbol = args.instrument.toUpperCase()");
    expect(src).toMatch(/errorCode: \"AUTH_ERROR\"/);
    expect(src).toMatch(/errorCode: \"RATE_LIMIT\"/);
    expect(src).toMatch(/errorCode: \"API_UNAVAILABLE\"/);
  });

  it("protectedAnalysis forwards routing identity and never uppercases the instrument", () => {
    const src = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
    expect(src).toContain("providerInstrumentId");
    expect(src).not.toMatch(/instrument\.toUpperCase\(/);
    expect(src).toContain('"provider"');
    expect(src).toContain('"providerInstrumentId"');
  });
});
