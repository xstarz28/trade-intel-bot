/**
 * Phase 226 — CoinGlass derivatives actually reach the radar, and only when
 * their provenance holds.
 *
 * Defect (found in Phase 225): `RadarCandidateSource.derivatives` was read by
 * radar scoring / candidate-builder but never written — the Dashboard mapping
 * dropped `derivativesData`, and the registry's CoinGlass adapter parsed OI +
 * funding into locals it threw away while stamping the price FRESH/now.
 *
 * Fixture shape is the payload `convex/coinglass.fetchDerivatives` produces
 * (`CryptoDerivativesData`): provider "coinglass", base-asset `symbol`,
 * provider `timestamp`, per-dataset `availability`, `freshness: "delayed"`.
 */
import { describe, expect, it } from "vitest";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import { derivativesForRadar, baseAssetOf } from "./derivatives-bridge";
import { buildRadarCandidate, type RadarCandidateSource } from "./candidate-builder";
import { scanRadar } from "./radar";
import { getAdapters, resetAdapters, acquireLiveData } from "./provider-registry";

const NOW = 1_758_000_000_000;
const MIN = 60_000;

/** Payload as produced by convex/coinglass.ts for BTC. */
function coinglassPayload(overrides: Partial<CryptoDerivativesData> = {}): CryptoDerivativesData {
  return {
    provider: "coinglass",
    symbol: "BTC",
    timestamp: NOW - 2 * MIN,
    freshness: "delayed",
    openInterest: { current: 31_250_000_000, change1h: 0.42 },
    fundingRate: { currentRate: 0.0001, annualizedRate: 0.1095 },
    longShort: { accountRatio: 1.12 },
    liquidations: { totalVolume: 84_000_000, longVolume: 50_000_000, shortVolume: 34_000_000, dominantSide: "longs", window: "24h" },
    availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
    confidence: "high",
    interpretation: "OI rising with positive funding",
    ...overrides,
  };
}

function snapshot(instrument: string): RadarCandidateSource["snapshot"] {
  return {
    instrument, assetClass: "crypto", price: 65_000, ohlcvAvailable: true,
    availableTimeframes: ["H1", "H4", "D1"], htfBias: "long", marketRegime: "TRENDING",
    provider: "okx", observedAt: NOW - MIN, freshness: "FRESH", quality: "VERIFIED",
  };
}

function source(instrument: string, derivatives?: RadarCandidateSource["derivatives"]): RadarCandidateSource {
  return {
    universe: { instrument, assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote", "derivatives"], priority: 1, refreshIntervalMs: 300_000 },
    snapshot: snapshot(instrument),
    ...(derivatives ? { derivatives } : {}),
  };
}

describe("226 — valid CoinGlass derivatives reach the radar consumer", () => {
  it("forwards funding rate, open interest and liquidation volume verbatim", () => {
    const r = derivativesForRadar("BTC/USD", coinglassPayload(), NOW);
    expect(r.derivatives).toEqual({ fundingRate: 0.0001, openInterest: 31_250_000_000, liquidationVolume: 84_000_000 });
    expect(r.rejected).toEqual([]);
  });

  it("candidate-builder and radar scoring see the values", () => {
    const d = derivativesForRadar("BTC/USD", coinglassPayload(), NOW).derivatives!;
    const c = buildRadarCandidate(source("BTC/USD", d), NOW);
    expect(c.hasDerivatives).toBe(true);
    expect(c.fundingRate).toBe(0.0001);
    expect(c.openInterest).toBe(31_250_000_000);

    const scan = scanRadar([source("BTC/USD", d)], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = scan.results.get("INTRADAY")!.find((o) => o.instrument === "BTC/USD")!;
    expect(opp.supportingEvidence).toContain("funding rate available");
    expect(opp.supportingEvidence).toContain("open interest available");
    expect(opp.missingInformation).not.toContain("funding rate");
  });

  it("without the bridge the same candidate reports funding rate as MISSING (the old defect)", () => {
    const scan = scanRadar([source("BTC/USD")], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = scan.results.get("INTRADAY")!.find((o) => o.instrument === "BTC/USD")!;
    expect(opp.missingInformation).toContain("funding rate");
  });

  it("lower-case / spaced instrument still maps to the provider symbol", () => {
    expect(baseAssetOf(" eth/usd ")).toBe("ETH");
    expect(derivativesForRadar("eth/usd", coinglassPayload({ symbol: "ETH" }), NOW).derivatives?.fundingRate).toBe(0.0001);
  });
});

describe("226 — invalid or missing derivatives stay classified as missing", () => {
  it("no payload → undefined", () => {
    expect(derivativesForRadar("BTC/USD", undefined, NOW).derivatives).toBeUndefined();
    expect(derivativesForRadar("BTC/USD", null, NOW).derivatives).toBeUndefined();
  });

  it("provider-marked unavailable → undefined even if numbers are present", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ freshness: "unavailable" }), NOW).derivatives).toBeUndefined();
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ confidence: "unavailable" }), NOW).derivatives).toBeUndefined();
  });

  it("dataset flagged unavailable is dropped individually — never defaulted to 0", () => {
    const r = derivativesForRadar("BTC/USD", coinglassPayload({
      availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
    }), NOW);
    expect(r.derivatives).toEqual({ fundingRate: 0.0001 });
    expect(r.derivatives).not.toHaveProperty("openInterest");
    expect(r.rejected).toContain("open interest not available");
  });

  it("NaN / zero open interest and non-finite funding are not forwarded", () => {
    const r = derivativesForRadar("BTC/USD", coinglassPayload({
      openInterest: { current: 0 },
      fundingRate: { currentRate: Number.NaN },
      liquidations: undefined,
      availability: { openInterest: true, fundingRate: true, longShort: false, liquidations: false },
    }), NOW);
    expect(r.derivatives).toBeUndefined();
  });

  it("when nothing survives the result is undefined, not an empty object", () => {
    const r = derivativesForRadar("BTC/USD", coinglassPayload({
      availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false },
    }), NOW);
    expect(r.derivatives).toBeUndefined();
    const c = buildRadarCandidate(source("BTC/USD", r.derivatives), NOW);
    expect(c.hasDerivatives).toBeUndefined();
  });

  it("unknown provider is rejected", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ provider: "someone-else" }), NOW).derivatives).toBeUndefined();
  });
});

describe("226 — provenance / timestamp is enforced, never back-filled", () => {
  it("missing or non-finite provider timestamp → rejected", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ timestamp: undefined as unknown as number }), NOW).derivatives).toBeUndefined();
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ timestamp: Number.NaN }), NOW).derivatives).toBeUndefined();
  });

  it("future-dated payload → rejected", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ timestamp: NOW + MIN }), NOW).derivatives).toBeUndefined();
  });

  it("payload older than the radar freshness window (≥24h) → rejected; inside the window → accepted", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ timestamp: NOW - 25 * 60 * MIN }), NOW).derivatives).toBeUndefined();
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ timestamp: NOW - 50 * MIN }), NOW).derivatives).toBeDefined();
  });

  it("the bridge does not mutate the payload or invent a timestamp", () => {
    const p = coinglassPayload();
    const before = JSON.stringify(p);
    derivativesForRadar("BTC/USD", p, NOW);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("226 — no cross-instrument contamination", () => {
  it("an ETH payload never attaches to BTC (and vice versa)", () => {
    expect(derivativesForRadar("BTC/USD", coinglassPayload({ symbol: "ETH" }), NOW).derivatives).toBeUndefined();
    expect(derivativesForRadar("ETH/USD", coinglassPayload({ symbol: "BTC" }), NOW).derivatives).toBeUndefined();
    const r = derivativesForRadar("BTC/USD", coinglassPayload({ symbol: "ETH" }), NOW);
    expect(r.rejected[0]).toMatch(/symbol mismatch/);
  });

  it("a shared scan keeps each instrument's derivatives separate", () => {
    const btc = derivativesForRadar("BTC/USD", coinglassPayload(), NOW).derivatives!;
    const eth = derivativesForRadar("ETH/USD", coinglassPayload({ symbol: "ETH", fundingRate: { currentRate: -0.0003 }, openInterest: { current: 9_000_000_000 } }), NOW).derivatives!;
    const cBtc = buildRadarCandidate(source("BTC/USD", btc), NOW);
    const cEth = buildRadarCandidate(source("ETH/USD", eth), NOW);
    const cSol = buildRadarCandidate(source("SOL/USD"), NOW);
    expect(cBtc.fundingRate).toBe(0.0001);
    expect(cEth.fundingRate).toBe(-0.0003);
    expect(cEth.openInterest).toBe(9_000_000_000);
    expect(cSol.hasDerivatives).toBeUndefined();
    expect(cSol.fundingRate).toBeUndefined();
  });
});

describe("226 — registry CoinGlass adapter no longer fabricates a live price", () => {
  it("is still registered as the crypto derivatives provider", () => {
    resetAdapters();
    const a = getAdapters().find((x) => x.id === "coinglass")!;
    expect(a.capabilities).toEqual(["derivatives"]);
    expect(a.supportedAssetClasses).toEqual(["crypto"]);
  });

  it("fetch() returns null even with a key present — it must not emit observedAt=now/FRESH", async () => {
    resetAdapters();
    const a = getAdapters().find((x) => x.id === "coinglass")!;
    const snap = await a.fetch("BTC/USD", "crypto", (n) => (n === "COINGLASS_API_KEY" ? "present" : undefined));
    expect(snap).toBeNull();
  });

  it("acquireLiveData never routes a quote through coinglass", async () => {
    resetAdapters();
    const r = await acquireLiveData("BTC/USD", "crypto", () => undefined);
    expect(r.provider).not.toBe("coinglass");
  });

  it("the Dashboard radar mapping goes through the bridge (structural)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(src).toContain("derivativesForRadar(ls.instrument, ls.derivativesData");
  });
});
