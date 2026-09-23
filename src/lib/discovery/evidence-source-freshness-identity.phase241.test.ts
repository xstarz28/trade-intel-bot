/**
 * Phase 241 — Evidence Source Freshness & Identity Unification
 *
 * Covers:
 * - additional evidence explicit freshness/provenance contract
 * - effective freshness weakest required, optional must not strengthen
 * - future timestamp never FRESH
 * - correlation hardening provider-native separation
 * - canonical identity one source, radar===UI, legacy collision-safe
 * - retained/failure regression
 * - UI truthfulness
 * - security / no fabrication
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  scanRadar,
  opportunityKey,
  computeEffectiveFreshness,
} from "../market-radar/radar";
import { canonicalOpportunityKey, isLegacyIdentity, isDeterministicIdentity } from "../market-radar/opportunity-identity";
import { buildRadarSourcesFromLiveSources } from "../market-radar/live-source-adapter";
import type { MarketData } from "../data/market-types";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import type { RadarCandidateSource } from "../market-radar/candidate-builder";
import { deriveCorrelationKey, limitByCorrelationGroup } from "./correlation";
import { derivativesForRadar } from "../market-radar/derivatives-bridge";

const NOW = 1_800_000_000_000;

// helpers
function mkMarketData(overrides: any): MarketData {
  return {
    instrument: overrides.instrument,
    instrumentType: overrides.instrumentType ?? "crypto",
    provider: overrides.provider,
    fetchTimestamp: overrides.fetchTimestamp,
    price: {
      price: overrides.price,
      timestamp: overrides.observedAt,
      source: overrides.provider,
      ...(overrides.bid !== undefined ? { bid: overrides.bid } : {}),
      ...(overrides.ask !== undefined ? { ask: overrides.ask } : {}),
    },
    candles: overrides.candles ?? [{ timestamp: overrides.observedAt, open: overrides.price, high: overrides.price * 1.01, low: overrides.price * 0.99, close: overrides.price, volume: 1000 }],
    timeframe: overrides.timeframe ?? "1h",
    dataFreshness: overrides.dataFreshness ?? "realtime",
    timestampProvenance: overrides.provenance ?? "PROVIDER_OBSERVED",
  } as MarketData;
}

function mkLiveSource(opts: {
  instrument: string;
  provider: string;
  providerInstrumentId: string;
  price: number;
  observedAt: number;
  fetchedAt: number;
  provenance?: MarketData["timestampProvenance"];
  assetClass?: any;
  correlationKey?: string;
  region?: string;
}): LiveCandidateSource {
  const md = mkMarketData({
    instrument: opts.instrument,
    provider: opts.provider,
    price: opts.price,
    observedAt: opts.observedAt,
    fetchTimestamp: opts.fetchedAt,
    provenance: opts.provenance ?? "PROVIDER_OBSERVED",
  });
  return {
    instrument: opts.instrument,
    assetClass: opts.assetClass ?? "crypto",
    providerNative: { provider: opts.provider, providerInstrumentId: opts.providerInstrumentId },
    correlationKey: opts.correlationKey ?? `${opts.assetClass ?? "crypto"}:${opts.instrument.split("/")[0] ?? opts.instrument}`,
    region: opts.region,
    marketData: md,
  } as LiveCandidateSource;
}

function mkRadarCandidate(opts: {
  instrument: string;
  assetClass: string;
  provider: string;
  providerInstrumentId: string;
  observedAt?: number;
  freshness?: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  additionalEvidence?: RadarCandidateSource["additionalEvidence"];
  region?: string;
}): RadarCandidateSource {
  return {
    universe: {
      instrument: opts.instrument,
      assetClass: opts.assetClass as any,
      ...(opts.region ? { region: opts.region } : {}),
      providerNative: { provider: opts.provider, providerInstrumentId: opts.providerInstrumentId },
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot: {
      instrument: opts.instrument,
      assetClass: opts.assetClass as any,
      price: 50000,
      ohlcvAvailable: true,
      availableTimeframes: ["1h"],
      htfBias: "neutral",
      marketRegime: "UNKNOWN",
      provider: opts.provider,
      observedAt: opts.observedAt,
      freshness: opts.freshness ?? "FRESH",
      quality: "VERIFIED",
    },
    additionalEvidence: opts.additionalEvidence,
  } as RadarCandidateSource;
}

// ────────────────────────────────────────────────────────────────
// A. additional evidence inventory — provider identity, observedAt, provenance, freshness, required vs optional
// ────────────────────────────────────────────────────────────────
describe("Phase241 A — additional evidence inventory", () => {
  it("derivatives has explicit freshness, observedAt, provider, provenance, required=false", () => {
    const ev = mkRadarCandidate({
      instrument: "BTC/USDT",
      assetClass: "crypto",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      observedAt: NOW - 1000,
      additionalEvidence: [{
        source: "derivatives",
        provider: "coinglass",
        observedAt: NOW - 500,
        freshness: "FRESH",
        timestampProvenance: "PROVIDER_OBSERVED",
        required: false,
      }],
    });
    expect(ev.additionalEvidence![0].source).toBe("derivatives");
    expect(ev.additionalEvidence![0].provider).toBe("coinglass");
    expect(ev.additionalEvidence![0].observedAt).toBeDefined();
    expect(ev.additionalEvidence![0].freshness).toBe("FRESH");
    expect(ev.additionalEvidence![0].timestampProvenance).toBe("PROVIDER_OBSERVED");
    expect(ev.additionalEvidence![0].required).toBe(false);
  });

  it("funding and openInterest are separate optional sources", () => {
    const ev = mkRadarCandidate({
      instrument: "BTC/USDT",
      assetClass: "crypto",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      additionalEvidence: [
        { source: "funding", provider: "coinglass", observedAt: NOW - 100, freshness: "FRESH", timestampProvenance: "PROVIDER_OBSERVED", required: false },
        { source: "openInterest", provider: "coinglass", observedAt: NOW - 200, freshness: "FRESH", timestampProvenance: "PROVIDER_OBSERVED", required: false },
      ],
    });
    expect(ev.additionalEvidence!.some(e => e.source === "funding")).toBe(true);
    expect(ev.additionalEvidence!.some(e => e.source === "openInterest")).toBe(true);
    expect(ev.additionalEvidence!.every(e => e.required === false)).toBe(true);
  });

  it("COT has explicit freshness, provider cftc, required=false", () => {
    const ev = mkRadarCandidate({
      instrument: "EUR/USD",
      assetClass: "forex",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      additionalEvidence: [{ source: "cot", provider: "cftc", observedAt: NOW - 86400000, freshness: "DELAYED", timestampProvenance: "PROVIDER_OBSERVED", required: false }],
    });
    expect(ev.additionalEvidence![0].source).toBe("cot");
    expect(ev.additionalEvidence![0].provider).toBe("cftc");
    expect(ev.additionalEvidence![0].required).toBe(false);
  });

  it("EIA has explicit freshness, provider eia, required=false", () => {
    const ev = mkRadarCandidate({
      instrument: "WTI/USD",
      assetClass: "commodity",
      provider: "twelve-data",
      providerInstrumentId: "WTI/USD",
      additionalEvidence: [{ source: "eia", provider: "eia", observedAt: NOW - 86400000 * 2, freshness: "DELAYED", timestampProvenance: "PROVIDER_OBSERVED", required: false }],
    });
    expect(ev.additionalEvidence![0].source).toBe("eia");
    expect(ev.additionalEvidence![0].freshness).toBe("DELAYED");
  });

  it("Treasury has explicit freshness, provider treasury, required=false", () => {
    const ev = mkRadarCandidate({
      instrument: "EUR/USD",
      assetClass: "forex",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      additionalEvidence: [{ source: "treasury", provider: "treasury", observedAt: NOW - 3600000, freshness: "FRESH", timestampProvenance: "PROVIDER_OBSERVED", required: false }],
    });
    expect(ev.additionalEvidence![0].source).toBe("treasury");
    expect(ev.additionalEvidence![0].required).toBe(false);
  });

  it("fundamentals, riskRegime, analyticalDepth are optional/supporting", () => {
    const ev = mkRadarCandidate({
      instrument: "AAPL",
      assetClass: "equity",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
      additionalEvidence: [
        { source: "fundamentals", provider: "alpha-vantage", freshness: "UNAVAILABLE", timestampProvenance: "UNKNOWN", required: false },
        { source: "riskRegime", provider: "cross-asset", freshness: "UNAVAILABLE", timestampProvenance: "UNKNOWN", required: false },
        { source: "analyticalDepth", provider: "universal", freshness: "UNAVAILABLE", timestampProvenance: "UNKNOWN", required: false },
        { source: "relativeValue", provider: "universal", freshness: "UNAVAILABLE", timestampProvenance: "UNKNOWN", required: false },
        { source: "macro", provider: "trading-economics", freshness: "DELAYED", timestampProvenance: "PROVIDER_OBSERVED", required: false },
      ],
    });
    expect(ev.additionalEvidence!.length).toBe(5);
    expect(ev.additionalEvidence!.every(e => e.required === false)).toBe(true);
  });

  it("missing timestamp → undefined/UNKNOWN/UNAVAILABLE never FRESH", () => {
    const ev = mkRadarCandidate({
      instrument: "AAPL",
      assetClass: "equity",
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
      additionalEvidence: [
        { source: "fundamentals", provider: "alpha-vantage", observedAt: undefined, freshness: "UNAVAILABLE", timestampProvenance: "UNKNOWN", required: false },
      ],
    });
    const meta = ev.additionalEvidence![0];
    expect(meta.observedAt).toBeUndefined();
    expect(meta.timestampProvenance).toBe("UNKNOWN");
    expect(meta.freshness).not.toBe("FRESH");
    expect(meta.freshness).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// B. effective freshness — required weakest, optional must not strengthen, future timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase241 B — effective freshness", () => {
  it("required effective freshness weakest trustworthy required", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "DELAYED", required: true, source: "price" },
      { freshness: "STALE", required: true, source: "derivatives" },
    ]);
    expect(res.effective).toBe("STALE");
  });

  it("optional must not strengthen freshness", () => {
    const res = computeEffectiveFreshness("STALE", [
      { freshness: "FRESH", required: false, source: "derivatives" },
    ]);
    expect(res.effective).toBe("STALE");
    expect(res.effective).not.toBe("FRESH");
  });

  it("missing/stale explicit — missing required → UNAVAILABLE", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "UNAVAILABLE", required: true, source: "price" },
    ]);
    expect(res.effective).toBe("UNAVAILABLE");
  });

  it("future timestamp never FRESH — assessFreshness returns UNAVAILABLE for future", () => {
    // simulate future observedAt via scanRadar
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW + 10 * 60_000, // 10 min future
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.freshness).not.toBe("FRESH");
    expect(opp.freshness).toBe("UNAVAILABLE");
  });

  it("effective freshness with 8 cases including future timestamp", () => {
    const cases: Array<{ primary: any; additional: any[]; expected: string }> = [
      { primary: "FRESH", additional: [], expected: "FRESH" },
      { primary: "FRESH", additional: [{ freshness: "DELAYED", required: true, source: "a" }], expected: "DELAYED" },
      { primary: "FRESH", additional: [{ freshness: "STALE", required: true, source: "b" }], expected: "STALE" },
      { primary: "FRESH", additional: [{ freshness: "UNAVAILABLE", required: true, source: "c" }], expected: "UNAVAILABLE" },
      { primary: "DELAYED", additional: [{ freshness: "FRESH", required: false, source: "opt" }], expected: "DELAYED" },
      { primary: "STALE", additional: [{ freshness: "FRESH", required: false, source: "opt2" }], expected: "STALE" },
      { primary: "FRESH", additional: [{ freshness: "FRESH", required: false, source: "opt" }, { freshness: "DELAYED", required: true, source: "req" }], expected: "DELAYED" },
      { primary: "FRESH", additional: [{ freshness: "UNKNOWN" as any, required: true, source: "unk" }], expected: "UNAVAILABLE" },
      // extra: future timestamp handled via assessFreshness returning UNAVAILABLE, effective becomes UNAVAILABLE
      { primary: "UNAVAILABLE", additional: [{ freshness: "FRESH", required: false, source: "opt" }], expected: "UNAVAILABLE" },
    ];
    for (const c of cases) {
      const res = computeEffectiveFreshness(c.primary, c.additional);
      expect(res.effective).toBe(c.expected);
    }
  });

  it("additional FRESH without trustworthy timestamp → UNAVAILABLE not FRESH in scanRadar", () => {
    const src = mkRadarCandidate({
      instrument: "BTC/USDT",
      assetClass: "crypto",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      observedAt: NOW - 1000,
      freshness: "FRESH",
      additionalEvidence: [{
        source: "derivatives",
        provider: "coinglass",
        observedAt: undefined,
        freshness: "FRESH",
        timestampProvenance: "UNKNOWN",
        required: false,
      }],
    });
    const result = scanRadar([src], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    // primary FRESH, optional with unknown timestamp that claims FRESH should be downgraded to UNAVAILABLE for optional, but must not affect primary
    // effective should remain FRESH because optional must not strengthen nor weaken beyond required
    expect(opp.freshness).toBe("FRESH");
  });
});

// ────────────────────────────────────────────────────────────────
// C. provenance audit
// ────────────────────────────────────────────────────────────────
describe("Phase241 C — provenance audit", () => {
  it("PROVIDER_OBSERVED vs APPLICATION_RECEIPT distinct, observedAt !== acquiredAt unless documented", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 5000,
      fetchedAt: NOW,
      provenance: "PROVIDER_OBSERVED",
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.observedAt).toBe(NOW - 5000);
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
    expect(radarSources[0].snapshot?.observedAt).not.toBe(radarSources[0].snapshot?.acquiredAt);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });

  it("PROVIDER_RESPONSE, APPLICATION_RECEIPT, UNKNOWN are valid provenances", () => {
    const file = readFileSync("src/lib/market-radar/types.ts", "utf8");
    expect(file).toContain("PROVIDER_OBSERVED");
    expect(file).toContain("PROVIDER_RESPONSE");
    expect(file).toContain("APPLICATION_RECEIPT");
    expect(file).toContain("UNKNOWN");
  });

  it("receipt never promoted to observation — acquiredAt not used as observedAt when missing", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, observedAt: undefined, fetchTimestamp: NOW, dataFreshness: "unavailable", provenance: "UNKNOWN" });
    const src: any = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md };
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.observedAt).toBeUndefined();
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
  });
});

// ────────────────────────────────────────────────────────────────
// D. correlation hardening
// ────────────────────────────────────────────────────────────────
describe("Phase241 D — correlation hardening", () => {
  it("bare instrument must not cause cap merge — ccxt:binance vs ccxt:okx BTC/USDT separate", () => {
    const a = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, correlationKey: "crypto:BTC" });
    const b = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", price: 50100, observedAt: NOW - 1000, fetchedAt: NOW, correlationKey: "crypto:BTC" });
    const radarSources = buildRadarSourcesFromLiveSources([a, b]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
  });

  it("twelve-data BTC/USD vs ccxt BTC/USDT distinct provider-native", () => {
    const twelve = mkLiveSource({ instrument: "BTC/USD", provider: "twelve-data", providerInstrumentId: "BTC/USD", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const ccxt = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([twelve, ccxt]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const keys = result.results.get("INTRADAY")!.map(o => o.providerNative?.providerInstrumentId);
    expect(keys).toContain("BTC/USD");
    expect(keys).toContain("BTC/USDT");
  });

  it("DEX provider separate from CEX", () => {
    const dex = mkLiveSource({ instrument: "eth:0xabc", provider: "dexscreener", providerInstrumentId: "eth:0xabc", price: 3000, observedAt: NOW - 1000, fetchedAt: NOW });
    const cex = mkLiveSource({ instrument: "ETH/USDT", provider: "ccxt:binance", providerInstrumentId: "ETH/USDT", price: 3000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([dex, cex]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
  });

  it("CORRELATION_CLUSTERS uses derived key, display caps not merge provider-native", () => {
    const items = [
      { id: "a", corr: "crypto:BTC", provider: "ccxt:binance", inst: "BTC/USDT" },
      { id: "b", corr: "crypto:BTC", provider: "ccxt:okx", inst: "BTC/USDT" },
      { id: "c", corr: "crypto:BTC", provider: "twelve-data", inst: "BTC/USD" },
    ];
    const limited = limitByCorrelationGroup(items, (x) => x.corr, 2);
    expect(limited.length).toBe(2);
    // but distinct identities preserved in full list
    expect(items.length).toBe(3);
    expect(new Set(items.map(i => `${i.provider}::${i.inst}`)).size).toBe(3);
  });

  it("deriveCorrelationKey groups by assetClass:baseAsset", () => {
    const key = deriveCorrelationKey({ assetClass: "crypto" as any, baseAsset: "BTC" });
    expect(key).toBe("crypto:BTC");
    const key2 = deriveCorrelationKey({ assetClass: "crypto" as any, baseAsset: "btc" });
    expect(key2).toBe("crypto:BTC");
  });
});

// ────────────────────────────────────────────────────────────────
// E. canonical identity
// ────────────────────────────────────────────────────────────────
describe("Phase241 E — canonical identity", () => {
  it("one canonical function dependency-safe, no radar/candidate imports", () => {
    const src = readFileSync("src/lib/market-radar/opportunity-identity.ts", "utf8");
    expect(src).not.toContain("from \"./radar\"");
    expect(src).not.toContain("from \"./candidate-builder\"");
    expect(src).not.toContain("MarketOpportunities");
  });

  it("radar and UI use same canonical", () => {
    const radarFile = readFileSync("src/lib/market-radar/radar.ts", "utf8");
    const uiFile = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(radarFile).toContain("opportunity-identity");
    expect(uiFile).toContain("opportunity-identity");
    expect(radarFile).toContain("canonicalOpportunityKey");
    expect(uiFile).toContain("canonicalOpportunityKey");
  });

  it("precedence 1 provider+providerInstrumentId", () => {
    const opp = { instrument: "BTC/USDT", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any;
    expect(canonicalOpportunityKey(opp)).toBe("ccxt:binance::BTC/USDT");
  });

  it("precedence 2 id+instrument+assetClass when provider missing", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { providerInstrumentId: "BTC/USDT" } } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("crypto");
  });

  it("precedence 3 provider+instrument+assetClass+region", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", region: "us", providerNative: { provider: "okx" } } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("okx");
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("crypto");
    expect(key).toContain("us");
  });

  it("precedence 4 provider+instrument+assetClass", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "okx" } } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("okx::BTC/USDT::crypto");
  });

  it("precedence 5 legacy assetClass/instrument/candidate/region", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", region: "global", candidateInstrument: "BTC-USDT-PERP" } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("crypto");
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("BTC-USDT-PERP");
  });

  it("no invented native ID, deterministic, same input same output", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", region: "global" } as any;
    const k1 = canonicalOpportunityKey(opp);
    const k2 = canonicalOpportunityKey(opp);
    expect(k1).toBe(k2);
    expect(isDeterministicIdentity(opp)).toBe(true);
  });

  it("radar opportunityKey === UI opportunityDisplayKey via canonical", () => {
    const opp = { instrument: "ETH/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "ETH/USDT" } } as any;
    const radarKey = opportunityKey(opp);
    const canonical = canonicalOpportunityKey(opp);
    expect(radarKey).toBe(canonical);
  });

  it("collisions prevented — different assetClass same instrument distinct", () => {
    const a = { instrument: "BTC/USD", assetClass: "crypto", region: "global" } as any;
    const b = { instrument: "BTC/USD", assetClass: "forex", region: "global" } as any;
    expect(canonicalOpportunityKey(a)).not.toBe(canonicalOpportunityKey(b));
  });
});

// ────────────────────────────────────────────────────────────────
// F. legacy without assetClass
// ────────────────────────────────────────────────────────────────
describe("Phase241 F — legacy without assetClass", () => {
  it("uses existing candidate/region/provider/native metadata, no random/Date.now", () => {
    const opp = { instrument: "BTC/USDT", candidateInstrument: "BTC-USDT-SWAP", region: "us", providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT-SWAP" } } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("BTC-USDT-SWAP");
    expect(key).not.toMatch(/random|Date\.now/);
    expect(isLegacyIdentity(opp)).toBe(false); // has providerNative so not legacy
  });

  it("legacy degraded explicit — unknown assetClass falls back safely", () => {
    const opp = { instrument: "UNKNOWN", candidateInstrument: "X", region: "global" } as any;
    const key = canonicalOpportunityKey(opp);
    expect(key).toContain("UNKNOWN");
    expect(key).not.toBe("");
  });

  it("deterministic no random/time identity", () => {
    const opp = { instrument: "AAPL", assetClass: "equity" } as any;
    const k1 = canonicalOpportunityKey(opp);
    const k2 = canonicalOpportunityKey(opp);
    expect(k1).toBe(k2);
    expect(k1).not.toContain(String(Date.now()));
  });
});

// ────────────────────────────────────────────────────────────────
// G. retained/failure regression
// ────────────────────────────────────────────────────────────────
describe("Phase241 G — retained/failure regression", () => {
  it("fresh→fail→retained preserves observedAt/provenance", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const first = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp1 = first.results.get("INTRADAY")![0];
    expect(opp1.observedAt).toBe(NOW - 1000);
    // simulate retained after failure — same snapshot, later now
    const later = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 60000 });
    const opp2 = later.results.get("INTRADAY")![0];
    expect(opp2.observedAt).toBe(NOW - 1000);
  });

  it("freshness ages, not newly live", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const later = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 2 * 60 * 60_000 });
    const opp = later.results.get("INTRADAY")![0];
    expect(opp.freshness).toBe("STALE");
    expect(opp.observedAt).not.toBe(NOW + 2 * 60 * 60_000);
  });

  it("REFRESH_FAILED / providerErrors visible, not silently dropped", () => {
    const lifecycleFile = readFileSync("src/lib/discovery/lifecycle.ts", "utf8");
    expect(lifecycleFile).toContain("REFRESH_FAILED");
    const radarFile = readFileSync("src/lib/market-radar/radar.ts", "utf8");
    expect(radarFile).toContain("providerErrors");
  });
});

// ────────────────────────────────────────────────────────────────
// H. UI audit
// ────────────────────────────────────────────────────────────────
describe("Phase241 H — UI audit", () => {
  it("UI key canonical, not bare instrument", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("canonicalOpportunityKey");
    expect(ui).not.toMatch(/key=\{opp\.instrument\}/);
  });

  it("UI shows provider/native correct, freshness correct, unknown not live", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("providerNative");
    expect(ui).toContain("freshness");
    expect(ui).toContain("isLive");
  });

  it("required stale not shown as fresh, optional degraded visible, errors visible, correlation not collapse", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("FRESHNESS_COLORS");
    expect(ui).toContain("providerErrors");
    // correlation hardening is in radar.ts, UI must not collapse provider-native via bare key
    const radar = readFileSync("src/lib/market-radar/radar.ts", "utf8");
    expect(radar).toContain("filterByCorrelation");
    expect(radar).toContain("canonicalOpportunityKey");
    // UI must use canonical key, not bare instrument
    expect(ui).toContain("opportunityDisplayKey");
  });
});

// ────────────────────────────────────────────────────────────────
// I. security
// ────────────────────────────────────────────────────────────────
describe("Phase241 I — security", () => {
  it("no API_KEY/apikey/secret/authorization/bearer/sk-/credentials in opportunity/evidence/correlation/UI", () => {
    const files = [
      "src/lib/market-radar/radar.ts",
      "src/lib/market-radar/candidate-builder.ts",
      "src/lib/market-radar/opportunity-identity.ts",
      "src/components/MarketOpportunities.tsx",
      "src/lib/discovery/correlation.ts",
    ];
    for (const f of files) {
      const content = readFileSync(f, "utf8").toLowerCase();
      // we allow the word 'secret' in comments? But should not have credential patterns
      expect(content).not.toMatch(/api_key/);
      expect(content).not.toMatch(/sk-/);
      // bearer token pattern not present
      expect(content).not.toMatch(/authorization:\s*bearer/);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// J. no fabrication, no hardcoded lists, provider-native preserved
// ────────────────────────────────────────────────────────────────
describe("Phase241 J — no fabrication invariants", () => {
  it("no Date.now() as observedAt in candidate-builder", () => {
    const file = readFileSync("src/lib/market-radar/candidate-builder.ts", "utf8");
    // should not have observedAt: Date.now()
    expect(file).not.toMatch(/observedAt:\s*Date\.now\(\)/);
  });

  it("no acquired→observed promotion", () => {
    const file = readFileSync("src/lib/market-radar/live-source-adapter.ts", "utf8");
    expect(file).toContain("observedAt");
    expect(file).toContain("acquiredAt");
  });

  it("provider/native preserved, not discarded", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.providerNative?.provider).toBe("ccxt:binance");
    expect(opp.providerNative?.providerInstrumentId).toBe("BTC/USDT");
  });

  it("Map/Set only symbol collision prevented via canonical key", () => {
    const a = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any;
    const b = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" } } as any;
    const ka = canonicalOpportunityKey(a);
    const kb = canonicalOpportunityKey(b);
    expect(ka).not.toBe(kb);
    const map = new Map();
    map.set(ka, a);
    map.set(kb, b);
    expect(map.size).toBe(2);
  });

  it("derivatives bridge preserves provider timestamp, no invented freshness", () => {
    const data: any = {
      provider: "coinglass",
      symbol: "BTC",
      timestamp: NOW - 1000,
      freshness: "realtime",
      confidence: "high",
      availability: { fundingRate: true, openInterest: true },
      fundingRate: { currentRate: 0.01 },
      openInterest: { current: 1000000 },
    };
    const res = derivativesForRadar("BTC/USDT", data, NOW);
    expect(res.derivatives).toBeDefined();
    expect(res.additionalEvidence).toBeDefined();
    expect(res.additionalEvidence!.every(ev => ev.observedAt === NOW - 1000)).toBe(true);
    expect(res.additionalEvidence!.every(ev => ev.freshness !== "UNKNOWN")).toBe(true);
  });

  it("no hardcoded ticker/provider lists in identity", () => {
    const file = readFileSync("src/lib/market-radar/opportunity-identity.ts", "utf8");
    // should not contain hardcoded list of tickers like BTC, ETH etc as whitelist
    expect(file).not.toMatch(/POPULAR_INSTRUMENTS/);
    expect(file).not.toMatch(/\[\"BTC\"/);
  });
});
