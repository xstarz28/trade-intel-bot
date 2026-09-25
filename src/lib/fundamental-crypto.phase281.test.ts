/**
 * Phase 281 — MODERN CRYPTO FUNDAMENTAL INTELLIGENCE (independent groups,
 * non-insufficient by default, positioning as RISK).
 *
 * What these proofs establish on top of the Phase 279 crypto contract:
 *   · a token is scored from INDEPENDENT provider groups (tokenomics, DeFi,
 *     price/supply derivation) and multi-period provider windows — never from
 *     the number of fields;
 *   · `insufficient` is NOT the answer just because one metric family is
 *     missing: real independent evidence still produces improving/weakening/
 *     mixed, and the missing family is named instead of being estimated;
 *   · changed token economics / network economics / positioning change the
 *     RESULT in the documented way (state, confidence or the disclosed risk);
 *   · conflicting PRIMARY evidence is mixed at medium confidence — never a
 *     weighted average that hides the disagreement;
 *   · positioning is INFORMATION + RISK: extreme/crowded positioning never
 *     turns a token bullish or bearish, and dropping the derivatives payload
 *     cannot change state, confidence or bias;
 *   · nothing is invented: unavailable evidence stays unavailable with its
 *     reason, the fee-derived revenue estimate is never reported as revenue,
 *     and no equity/forex metric appears anywhere in a crypto assessment;
 *   · the assessment is a pure function of the provider instants — no clock.
 */

import { describe, it, expect, vi } from "vitest";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { assessFundamentals } from "./fundamental-engine";
import { calculateTechnical } from "./data/technical";
import { DeFiLlamaAdapter } from "./data/crypto/defillama-adapter";
import type { OhlcvCandle } from "./data/market-types";
import type { CryptoIntelligenceContext, DeFiIntelligence, TokenomicsIntelligence } from "./data/crypto/types";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import { CRYPTO_DIMENSIONS } from "./fundamental/crypto";
import { FOREX_DIMENSIONS } from "./fundamental/forex";
import { EQUITY_DIMENSIONS } from "./fundamental/equity";

const BAR_MS = 900_000;
const END_TS = Date.parse("2025-07-04T20:00:00Z");
const TOKENOMIST_OBSERVED = Date.parse("2025-07-04T19:05:00Z");
const DEFILLAMA_OBSERVED = Date.parse("2025-07-04T19:04:00Z");
const PRICE_OBSERVED = Date.parse("2025-07-04T19:59:00Z");

function candles(n: number, start: number, slopePerBar: number): OhlcvCandle[] {
  const amp = Math.max(4, Math.abs(slopePerBar) * 5);
  const out: OhlcvCandle[] = [];
  for (let j = 0; j < n; j++) {
    const close = start + slopePerBar * j + amp * Math.sin(j * 0.55);
    out.push({
      timestamp: END_TS - (n - 1 - j) * BAR_MS,
      open: close - slopePerBar / 2,
      high: close + amp / 2,
      low: close - amp / 2,
      close,
      volume: 1_000 + j,
    });
  }
  return out;
}

const UPTREND = candles(210, 60_000, 5);

function tokenomics(overrides: Partial<TokenomicsIntelligence> = {}): TokenomicsIntelligence {
  return {
    provider: "Tokenomist",
    observedAt: TOKENOMIST_OBSERVED,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    supply: {
      circulatingSupply: 19_850_000,
      totalSupply: 21_000_000,
      circulatingPercent: 94.52380952380952,
      reliable: true,
    },
    unlocks: {
      upcomingCount30d: 2,
      upcomingValue30d: 12_000,
      unlockPercentOfCirculating: 0.06,
      reliable: true,
      summary: "2 small cliff unlocks",
    },
    availableDatasets: 2,
    totalDatasets: 2,
    ...overrides,
  };
}

function defi(overrides: Partial<DeFiIntelligence> = {}): DeFiIntelligence {
  return {
    provider: "DeFiLlama",
    observedAt: DEFILLAMA_OBSERVED,
    freshness: "FRESH",
    quality: "VERIFIED",
    available: true,
    tvl: { current: 62_000_000_000, change7d: 1.4, change30d: 4.2, reliable: true },
    fees: { dailyFees: 1_250_000, revenue24h: 125_000, feeChange7d: 1.2, feeChange30d: 6.4, reliable: true },
    availableDatasets: 2,
    totalDatasets: 2,
    ...overrides,
  };
}

function cryptoContext(
  instrument: string,
  parts: { tokenomics?: TokenomicsIntelligence; defi?: DeFiIntelligence },
): CryptoIntelligenceContext {
  return {
    instrument,
    instrumentType: "crypto",
    assembledAt: Date.parse("2025-07-04T19:06:00Z"),
    ...parts,
    evidence: [],
    overallAvailability: "FULL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    dataFlags: [],
    analystSummary: "fixture",
  } as CryptoIntelligenceContext;
}

/** Real provider shapes: moderate book — no crowding. */
const DERIVATIVES: CryptoDerivativesData = {
  provider: "coinglass",
  symbol: "BTC/USDT",
  timestamp: Date.parse("2025-07-04T19:00:00Z"),
  freshness: "realtime",
  openInterest: { current: 12_345_678, change1h: 1.2, change24h: -2.4 },
  fundingRate: { currentRate: 0.0001, annualizedRate: 10.95 },
  longShort: { accountRatio: 1.12, topTraderRatio: 1.05 },
  liquidations: { dominantSide: "longs" },
  availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
  confidence: "high",
};

/** Same provider, genuinely crowded book: extreme funding + one-sided accounts. */
const CROWDED_DERIVATIVES: CryptoDerivativesData = {
  ...DERIVATIVES,
  openInterest: { current: 15_000_000, change1h: 3, change24h: 41.5 },
  fundingRate: { currentRate: 0.0011, annualizedRate: 121.4 },
  longShort: { accountRatio: 2.45, topTraderRatio: 2.1 },
};

function assess(
  context: CryptoIntelligenceContext | undefined,
  options: { derivatives?: CryptoDerivativesData; price?: number } = {},
) {
  const instrument = context?.instrument ?? "BTC-USDT";
  return assessFundamentals(undefined, {
    instrument,
    instrumentType: "crypto",
    provider: "okx",
    providerInstrumentId: instrument,
    ...(context ? { crypto: context } : {}),
    ...(options.derivatives ? { derivatives: options.derivatives } : {}),
    price: options.price ?? 61_000,
    priceObservedAt: PRICE_OBSERVED,
    priceProvider: "okx",
  } as never);
}

const BTC = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), { derivatives: DERIVATIVES });

function cryptoInput(extra: Partial<AnalysisInput>, providerInstrumentId = "BTC-USDT"): AnalysisInput {
  const last = UPTREND[UPTREND.length - 1];
  return {
    instrument: providerInstrumentId,
    instrumentType: "crypto",
    timeframe: "H4",
    tradingStyle: "intraday",
    provider: "okx",
    providerInstrumentId,
    marketData: {
      instrument: providerInstrumentId,
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles: UPTREND,
      timeframe: "H4",
      fetchTimestamp: last.timestamp,
      dataFreshness: "realtime",
    },
    technicalData: calculateTechnical(UPTREND),
    ...extra,
  } as AnalysisInput;
}

// ── 1. Independent groups + confidence ──────────────────────────

describe("281 crypto (A/E) — independent provider groups, not field count", () => {
  it("(1) a token with three real provider families is improving at high confidence", () => {
    expect(BTC.available).toBe(true);
    expect(BTC.state).toBe("improving");
    expect(BTC.confidence).toBe("high");
    expect(BTC.directionalBias).toBe("bullish");
    // Confidence names the independent groups and the measured history.
    expect(BTC.confidenceEvidence).toContain("3 independent provider group(s)");
    expect(BTC.confidenceEvidence).toContain("multi-period history");
    // The hierarchy is applied — not a raw count of fields.
    expect(BTC.confidenceEvidence).toContain("primary dimension(s) strengthening");
  });

  it("(2) informational, unavailable and derived dimensions never add an independent group", () => {
    // Same payload without any derivatives feed: identical group count (the
    // market-structure feed is informational) and identical state.
    const withoutFeed = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }));
    expect(withoutFeed.confidenceEvidence).toContain("3 independent provider group(s)");
    expect(withoutFeed.state).toBe(BTC.state);
    expect(withoutFeed.confidence).toBe(BTC.confidence);
    expect(withoutFeed.directionalBias).toBe(BTC.directionalBias);
    // The named group count is unchanged; only the count of provider snapshots
    // differs, because the informational feed is not one of the groups.
    expect(withoutFeed.confidenceEvidence.replace(/\d+ provider dataset snapshots/, "N provider dataset snapshots")).toBe(
      BTC.confidenceEvidence.replace(/\d+ provider dataset snapshots/, "N provider dataset snapshots"),
    );
  });

  it("(3) the run pipeline carries the same crypto assessment (no recalculation)", () => {
    const input = cryptoInput({
      cryptoIntelligenceContext: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }),
      derivativesData: DERIVATIVES,
    });
    const viaPipeline = runAnalysis(input).fundamentalAssessment!;
    expect(viaPipeline.domain).toBe("crypto");
    expect(viaPipeline.state).toBe(BTC.state);
    expect(viaPipeline.confidence).toBe(BTC.confidence);
    expect(viaPipeline.instrumentId).toBe("BTC-USDT");
  });
});

// ── 2. `insufficient` is not the default ────────────────────────

describe("281 crypto (A) — a missing metric family never forces insufficient", () => {
  it("(4) no DeFi mapping at all: supply + derived valuation still produce a real state", () => {
    const sol = assess(
      cryptoContext("SOL-USDT", {
        tokenomics: tokenomics({
          supply: {
            circulatingSupply: 519_200_000,
            totalSupply: 590_000_000,
            circulatingPercent: 88,
            reliable: true,
          },
          unlocks: {
            upcomingCount30d: 1,
            upcomingValue30d: 5_192_000,
            unlockPercentOfCirculating: 1,
            reliable: true,
            summary: "1 linear unlock",
          },
        }),
      }),
      { price: 150 },
    );
    expect(sol.available).toBe(true);
    expect(sol.state).not.toBe("insufficient");
    expect(sol.state).toBe("improving");
    expect(sol.directionalBias).toBe("bullish");
    // The whole protocol-economics family is unavailable — and named, not filled.
    expect(sol.dimensions.find((d) => d.name === "protocol-economics")?.status).toBe("unavailable");
    expect(sol.unavailableDimensions).toContain("protocol-economics");
    expect(sol.limitations.join(" ")).toContain("Protocol economics UNAVAILABLE");
    expect(sol.summary).toContain("Network health: unavailable");
    expect(sol.summary).toContain("Assessment: improving");
  });

  it("(5) real evidence with no direction is mixed — still not insufficient", () => {
    const neutral = assess(
      cryptoContext("SOL-USDT", {
        tokenomics: tokenomics({
          supply: {
            circulatingSupply: 470_000_000,
            totalSupply: 590_000_000,
            circulatingPercent: 79.66,
            reliable: true,
          },
          unlocks: {
            upcomingCount30d: 1,
            upcomingValue30d: 4_700_000,
            unlockPercentOfCirculating: 1,
            reliable: true,
            summary: "1 linear unlock",
          },
        }),
      }),
      { price: 150 },
    );
    expect(neutral.available).toBe(true);
    expect(neutral.state).toBe("mixed");
    expect(neutral.directionalBias).toBe("none");
    expect(neutral.dimensions.filter((d) => d.status !== "unavailable").length).toBeGreaterThan(0);
  });

  it("(6) no provider evidence at all is insufficient, with every dimension named", () => {
    const empty = assess(undefined);
    expect(empty.available).toBe(false);
    expect(empty.state).toBe("insufficient");
    expect(empty.confidence).toBe("insufficient");
    expect(empty.dimensions.filter((d) => d.status === "unavailable").map((d) => d.name)).toEqual([
      ...CRYPTO_DIMENSIONS,
    ]);
    expect(empty.limitations.join(" ")).toContain("No assessment produced — absent evidence is never fabricated");
  });
});

// ── 3. Changing real evidence changes the result ────────────────

describe("281 crypto (A/E) — network economics and tokenomics drive the state", () => {
  it("(7) contracting protocol economics flips the read and lowers confidence", () => {
    const weak = assess(
      cryptoContext("BTC-USDT", {
        tokenomics: tokenomics(),
        defi: defi({
          tvl: { current: 54_000_000_000, change7d: -3.1, change30d: -12.3, reliable: true },
          fees: { dailyFees: 900_000, revenue24h: 90_000, feeChange7d: -2.1, feeChange30d: -9.5, reliable: true },
        }),
      }),
      { derivatives: DERIVATIVES },
    );
    expect(weak.state).toBe("mixed");
    expect(weak.confidence).toBe("medium");
    expect(weak.state).not.toBe(BTC.state);
    expect(weak.dimensions.find((d) => d.name === "protocol-economics")?.status).toBe("negative");
    expect(weak.confidenceEvidence).toContain("primary evidence conflicts across dimensions");
    expect(weak.confidenceEvidence).toContain("caps confidence at medium");
    expect(weak.summary).toContain("-12.30% in TVL over the provider's 30-day window");
  });

  it("(8) the two provider windows disagreeing yields no protocol-growth direction", () => {
    const disagree = assess(
      cryptoContext("BTC-USDT", {
        tokenomics: tokenomics(),
        defi: defi({
          tvl: { current: 62_000_000_000, change7d: 1.4, change30d: 4.2, reliable: true },
          fees: { dailyFees: 1_250_000, revenue24h: 125_000, feeChange7d: -1.1, feeChange30d: -8.2, reliable: true },
        }),
      }),
      { derivatives: DERIVATIVES },
    );
    const proto = disagree.dimensions.find((d) => d.name === "protocol-economics")!;
    expect(proto.status).toBe("neutral");
    expect(proto.evidence).toContain("the two provider measurements disagree");
  });

  it("(9) heavy dilution changes supply, unlock and valuation together", () => {
    const heavy = assess(
      cryptoContext("BTC-USDT", {
        tokenomics: tokenomics({
          supply: {
            circulatingSupply: 300_000_000,
            totalSupply: 1_000_000_000,
            circulatingPercent: 30,
            reliable: true,
          },
          unlocks: {
            upcomingCount30d: 3,
            upcomingValue30d: 90_000_000,
            unlockPercentOfCirculating: 30,
            reliable: true,
            summary: "large cliff",
          },
        }),
        defi: defi(),
      }),
      { derivatives: DERIVATIVES, price: 2.5 },
    );
    expect(heavy.cryptoMetrics?.dilutionPressurePercent).toBeCloseTo(70, 6);
    expect(heavy.dimensions.find((d) => d.name === "supply-structure")?.status).toBe("negative");
    expect(heavy.dimensions.find((d) => d.name === "unlock-dilution")?.status).toBe("negative");
    expect(heavy.dimensions.find((d) => d.name === "valuation-context")?.status).toBe("negative");
    expect(heavy.state).not.toBe("improving");
    expect(heavy.contradictions.join(" ")).toContain("future-supply overhang");
    expect(heavy.directionalBias).not.toBe("bullish");
  });

  it("(10) provider-reported revenue is reported; the fee-derived estimate never is", () => {
    expect(BTC.cryptoMetrics?.protocolRevenue24h).toBe(125_000);
    const revenue = BTC.evidence.find((e) => e.metric === "protocol_revenue_24h")!;
    expect(revenue.value).toBe(125_000);
    expect(revenue.unit).toBe("USD");
    expect(revenue.provider).toBe("DeFiLlama");
    expect(revenue.source).toContain("dataType=dailyRevenue");
    expect(BTC.cryptoMetrics?.feesChange30dPercent).toBe(6.4);

    const legacy = assess(
      cryptoContext("BTC-USDT", {
        tokenomics: tokenomics(),
        defi: defi({ fees: { dailyFees: 1_250_000, dailyRevenue: 125_000, reliable: true } }),
      }),
      { derivatives: DERIVATIVES },
    );
    // The legacy estimate is NOT promoted to reported revenue.
    expect(legacy.cryptoMetrics?.protocolRevenue24h).toBeUndefined();
    expect(legacy.evidence.some((e) => e.metric === "protocol_revenue_24h")).toBe(false);
    expect(legacy.limitations.join(" ")).toContain("Protocol revenue UNAVAILABLE as provider evidence");
  });
});

// ── 4. Positioning is information + RISK, never a direction ──────

describe("281 crypto (A/D) — positioning can never become bullish or bearish", () => {
  it("(11) a crowded book changes nothing but the disclosed risk", () => {
    const crowded = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), {
      derivatives: CROWDED_DERIVATIVES,
    });
    expect(crowded.state).toBe(BTC.state);
    expect(crowded.confidence).toBe(BTC.confidence);
    expect(crowded.directionalBias).toBe(BTC.directionalBias);
    expect(crowded.cryptoMetrics?.positioningRisk).toBe("crowded");
    expect(BTC.cryptoMetrics?.positioningRisk).toBe("none-detected");

    const risk = crowded.contradictions.join(" ");
    expect(risk).toContain("Crowded market-structure positioning");
    expect(risk).toContain("never turned into a fundamental direction");
    expect(risk).not.toMatch(/bullish|bearish/i);
    expect(crowded.limitations.join(" ")).toContain("reported as RISK");
  });

  it("(12) extreme positioning in the opposite direction is equally non-directional", () => {
    const shortCrowd = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), {
      derivatives: {
        ...DERIVATIVES,
        fundingRate: { currentRate: -0.0012, annualizedRate: -131.4 },
        longShort: { accountRatio: 0.42, topTraderRatio: 0.48 },
      },
    });
    expect(shortCrowd.cryptoMetrics?.positioningRisk).toBe("crowded");
    expect(shortCrowd.state).toBe(BTC.state);
    expect(shortCrowd.directionalBias).toBe(BTC.directionalBias);
    expect(shortCrowd.contradictions.join(" ")).not.toMatch(/bullish|bearish/i);
  });

  it("(13) the market-positioning dimension is informational and consumed elsewhere", () => {
    const positioning = BTC.dimensions.find((d) => d.name === "market-positioning")!;
    expect(positioning.informational).toBe(true);
    expect(positioning.status).toBe("neutral");
    expect(positioning.consumedBy).toBeTruthy();
    // No derivatives feed at all: unavailable with a reason, never neutral 0.
    const withoutFeed = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }));
    expect(withoutFeed.dimensions.find((d) => d.name === "market-positioning")?.status).toBe("unavailable");
    expect(withoutFeed.evidence.some((e) => e.metric.startsWith("open_interest"))).toBe(false);
  });
});

// ── 5. Integrity: identity, provenance, no leakage, determinism ──

describe("281 crypto (D/H) — integrity of the crypto evidence bag", () => {
  it("(14) every evidence item carries provider provenance and its own instant", () => {
    expect(BTC.evidence.length).toBeGreaterThan(0);
    for (const e of BTC.evidence) {
      expect(e.provider).toBeTruthy();
      expect(e.providerInstrumentId).toBe("BTC-USDT");
      expect(e.source).toBeTruthy();
      expect(e.observedAt).toBeGreaterThan(0);
      expect(e.freshness).toBeTruthy();
      if (typeof e.value === "number") expect(e.unit).toBeTruthy();
    }
    expect(BTC.observedAt).toBe(TOKENOMIST_OBSERVED);
  });

  it("(15) no equity or forex metric leaks into a token assessment", () => {
    // The domain metric bags are separate types; the crypto bag is checked as a
    // plain record so a leaked field from another domain is visible here.
    const bag = BTC.metrics as unknown as Record<string, unknown>;
    expect(bag.epsRises).toBeUndefined();
    expect(bag.peRatio).toBeUndefined();
    expect(bag.profitMargin).toBeUndefined();
    expect(bag.basePolicyRate).toBeUndefined();
    expect(bag.policyRateDifferentialPp).toBeUndefined();
    const names = BTC.dimensions.map((d) => d.name) as string[];
    expect(names).toEqual([...CRYPTO_DIMENSIONS]);
    for (const foreign of [...FOREX_DIMENSIONS, ...EQUITY_DIMENSIONS]) {
      if (!(CRYPTO_DIMENSIONS as readonly string[]).includes(foreign)) expect(names).not.toContain(foreign);
    }
    expect(BTC.dimensions.every((d) => !d.evidence || !/net margin|P\/E|EPS/.test(d.evidence))).toBe(true);
  });

  it("(16) the assessment is a pure function of provider evidence — no clock reading", () => {
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockImplementation(() => {
        throw new Error("Date.now() must not be used on the fundamental path");
      });
      const a = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), {
        derivatives: CROWDED_DERIVATIVES,
      });
      expect(a.state).toBe(BTC.state);
      expect(a.cryptoMetrics?.positioningRisk).toBe("crowded");
    } finally {
      spy.mockRestore();
    }
  });

  it("(17) repeated assessment is byte-identical", () => {
    const again = assess(cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), {
      derivatives: DERIVATIVES,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(BTC));
  });
});

// ── 6. The data layer actually fetches the revenue dataset ──────

describe("281 crypto (A) — DeFiLlama revenue is its own provider dataset", () => {
  it("(18) both fee and revenue summaries are requested, and revenue is not the 0.1 estimate", async () => {
    const requested: string[] = [];
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("historicalChainTvl")) {
        return {
          ok: true,
          json: async () => [
            { date: 1_735_000_000, tvl: 80 },
            { date: 1_735_600_000, tvl: 99 },
          ],
        };
      }
      if (url.includes("dataType=dailyFees")) {
        return { ok: true, json: async () => ({ total24h: 5_000_000, change_7d: 2.5, change_30d: 11.5 }) };
      }
      if (url.includes("dataType=dailyRevenue")) {
        return { ok: true, json: async () => ({ total24h: 880_000, change_7d: -1.5, change_30d: 3.25 }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const result = await new DeFiLlamaAdapter(fetchFn).fetch("ETH/USD");
    expect(result?.success).toBe(true);
    expect(requested.some((u) => u.includes("dataType=dailyFees"))).toBe(true);
    expect(requested.some((u) => u.includes("dataType=dailyRevenue"))).toBe(true);
    const data = result!.data as unknown as DeFiIntelligence;
    expect(data.fees?.revenue24h).toBe(880_000);
    expect(data.fees?.dailyFees).toBe(5_000_000);
    expect(data.fees?.feeChange30d).toBe(11.5);
    // Legacy display estimate survives unchanged — and is NOT the reported revenue.
    expect(data.fees?.dailyRevenue).toBe(500_000);
    expect(data.fees?.dailyRevenue).not.toBe(data.fees?.revenue24h);
  });

  it("(19) a missing revenue leg leaves reported revenue absent (never zero-filled)", async () => {
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("historicalChainTvl")) return { ok: true, json: async () => [{ date: 1, tvl: 5 }] };
      if (url.includes("dataType=dailyFees")) return { ok: true, json: async () => ({ total24h: 700 }) };
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await new DeFiLlamaAdapter(fetchFn).fetch("ETH/USD");
    const data = result!.data as unknown as DeFiIntelligence;
    expect(data.fees?.revenue24h).toBeUndefined();
    expect(data.fees?.dailyFees).toBe(700);
  });
});
