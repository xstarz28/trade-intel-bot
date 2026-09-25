/**
 * Phase 279 — CRYPTO-NATIVE fundamental intelligence regression contract.
 *
 * Task A of the phase: a crypto asset must be assessed with crypto evidence —
 * token economics, supply/dilution, unlock schedule, protocol economics and
 * market-structure CONTEXT — on the SAME deterministic contract the equity
 * domain uses, inside the real analysis pipeline.
 *
 * What these proofs establish:
 *   · the domain is chosen by routing, never by the shape of the ticker;
 *   · the provider-native identity (BTC-USDT) is preserved on the assessment
 *     and on every evidence item, and one instrument's numbers never appear on
 *     another's assessment;
 *   · supply/unlock/TVL/fee evidence carries provider, source, instant, period,
 *     unit and value, and derived values (market cap, FDV) carry their basis;
 *   · evidence another engine layer already scores (CoinGlass OI/funding/
 *     positioning/liquidations) is reported as INFORMATIONAL context and can
 *     never move the fundamental state — no double counting;
 *   · absent provider evidence stays UNAVAILABLE with a reason: no zero-fill,
 *     no estimate, no borrowing of another domain's metrics;
 *   · the assessment is deterministic and reacts to changed evidence;
 *   · `technical_only` is NOT the outcome when crypto evidence exists, and the
 *     correct domain assessment reaches the unified layer.
 */

import { describe, it, expect, vi } from "vitest";
import { runAnalysis, type AnalysisInput } from "./analysis-engine";
import { assessFundamentals } from "./fundamental-engine";
import { calculateTechnical } from "./data/technical";
import type { OhlcvCandle } from "./data/market-types";
import type { CryptoIntelligenceContext, DeFiIntelligence, TokenomicsIntelligence } from "./data/crypto/types";
import type { CryptoDerivativesData } from "./data/derivatives-types";

const BAR_MS = 900_000; // H4
const END_TS = Date.parse("2025-07-04T20:00:00Z");

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

// ── Provider payload shapes (Tokenomist / DeFiLlama / CoinGlass) ──

const TOKENOMIST_OBSERVED = Date.parse("2025-07-04T19:05:00Z");
const DEFILLAMA_OBSERVED = Date.parse("2025-07-04T19:04:00Z");

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
    fees: { dailyFees: 1_250_000, dailyRevenue: 125_000, reliable: true },
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
    ...(parts.tokenomics ? { tokenomics: parts.tokenomics } : {}),
    ...(parts.defi ? { defi: parts.defi } : {}),
    evidence: [],
    overallAvailability: "FULL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    dataFlags: [],
    analystSummary: "test fixture",
  };
}

const DERIVATIVES: CryptoDerivativesData = {
  provider: "coinglass",
  symbol: "BTC/USDT",
  timestamp: Date.parse("2025-07-04T19:00:00Z"),
  freshness: "realtime",
  openInterest: { current: 12_345_678, change1h: 1.2, change24h: -2.4 },
  fundingRate: { currentRate: 0.0001, annualizedRate: 0.1095 },
  longShort: { accountRatio: 1.12, topTraderRatio: 1.05 },
  liquidations: { dominantSide: "longs" },
  availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
  confidence: "high",
};

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

const BTC = cryptoInput({ cryptoIntelligenceContext: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }), derivativesData: DERIVATIVES });
const SOL = cryptoInput(
  {
    cryptoIntelligenceContext: cryptoContext("SOL-USDT", {
      tokenomics: tokenomics({
        supply: { circulatingSupply: 470_000_000, totalSupply: 590_000_000, circulatingPercent: 79.66, reliable: true },
        unlocks: { upcomingCount30d: 1, upcomingValue30d: 4_700_000, unlockPercentOfCirculating: 1, reliable: true, summary: "1 linear unlock" },
      }),
    }),
  },
  "SOL-USDT",
);

// ── 1. Domain selection + native identity ────────────────────────

describe("279 crypto (A) — domain selection and provider-native identity", () => {
  it("(1) routing decides the domain: a crypto instrument is assessed as crypto, not as equity", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    expect(a.domain).toBe("crypto");
    expect(a.available).toBe(true);
    expect(a.instrumentId).toBe("BTC-USDT");
    // No equity metric is produced for a token — not even an empty one.
    expect(Object.keys(a.metrics)).toEqual([]);
    expect(a.metrics.epsRises).toBeUndefined();
    expect(a.metrics.revenueRises).toBeUndefined();
    expect(a.cryptoMetrics?.circulatingSupply).toBe(19_850_000);
  });

  it("(2) the provider-native id is preserved on the assessment and on every evidence item", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    expect(a.instrumentId).toBe("BTC-USDT");
    const ids = new Set(a.evidence.map((e) => e.providerInstrumentId));
    expect([...ids].every((id) => id === "BTC-USDT")).toBe(true);
    // A substituted ticker would show up here.
    expect(a.evidence.some((e) => e.providerInstrumentId === "BTC/USD")).toBe(false);
  });

  it("(3) two different instruments keep their own evidence and their own numbers", () => {
    const btc = runAnalysis(BTC).fundamentalAssessment!;
    const sol = runAnalysis(SOL).fundamentalAssessment!;
    expect(btc.instrumentId).not.toBe(sol.instrumentId);
    expect(sol.cryptoMetrics?.circulatingSupply).toBe(470_000_000);
    expect(sol.evidence.every((e) => e.providerInstrumentId === "SOL-USDT")).toBe(true);
    const btcText = JSON.stringify(btc);
    expect(sol.evidence.some((e) => typeof e.value === "number" && e.value === 19_850_000)).toBe(false);
    expect(btcText).not.toContain("SOL-USDT");
  });

  it("(4) the assessment is produced with no clock reading at all", () => {
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockImplementation(() => {
        throw new Error("Date.now() must not be used on the fundamental path");
      });
      const a = assessFundamentals(undefined, {
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        crypto: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }),
        derivatives: DERIVATIVES,
        price: 61_000,
        priceObservedAt: Date.parse("2025-07-04T19:59:00Z"),
        priceProvider: "okx",
      });
      expect(a.domain).toBe("crypto");
      expect(a.available).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 2. Token economics: supply, dilution, unlocks ────────────────

describe("279 crypto (A) — token economics", () => {
  it("(5) circulating/total supply and dilution pressure come from the provider, with provenance", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    const supply = a.evidence.find((e) => e.metric === "circulating_supply")!;
    expect(supply.value).toBe(19_850_000);
    expect(supply.unit).toBe("tokens");
    expect(supply.provider).toBe("Tokenomist");
    expect(supply.observedAt).toBe(TOKENOMIST_OBSERVED);
    expect(supply.observedAtSemantics).toBe("acquisition-receipt");
    expect(supply.freshness).toBe("HISTORICAL");
    const dilution = a.evidence.find((e) => e.metric === "circulating_percent")!;
    expect(dilution.derived).toBe(true);
    expect(dilution.basis).toContain("circulating");
    expect(a.cryptoMetrics?.dilutionPressurePercent).toBeCloseTo(5.48, 2);
  });

  it("(6) the supply dimension is scored from the real circulating share", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    const dim = a.dimensions.find((d) => d.name === "supply-structure")!;
    expect(dim.status).toBe("positive");
    expect(dim.evidence).toContain("94.5%");
    expect(dim.evidence).toContain("Tokenomist");
  });

  it("(7) a low circulating share is scored as dilution pressure, and the same evidence flips the state", () => {
    const low = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", {
          tokenomics: tokenomics({
            supply: { circulatingSupply: 3_000_000, totalSupply: 10_000_000, circulatingPercent: 30, reliable: true },
            unlocks: { upcomingCount30d: 1, upcomingValue30d: 900_000, unlockPercentOfCirculating: 30, reliable: true, summary: "large cliff" },
          }),
        }),
      }),
    ).fundamentalAssessment!;
    expect(low.dimensions.find((d) => d.name === "supply-structure")!.status).toBe("negative");
    expect(low.dimensions.find((d) => d.name === "unlock-dilution")!.status).toBe("negative");
    expect(low.state).toBe("weakening");
    expect(low.directionalBias).toBe("bearish");
    expect(low.directionalBias).not.toBe(runAnalysis(BTC).fundamentalAssessment!.directionalBias);
  });

  it("(8) an unlock schedule is dilution evidence only above the documented materiality threshold", () => {
    const small = runAnalysis(BTC).fundamentalAssessment!;
    expect(small.dimensions.find((d) => d.name === "unlock-dilution")!.status).toBe("neutral");

    const none = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", {
          tokenomics: tokenomics({ unlocks: { upcomingCount30d: 0, reliable: true } }),
        }),
      }),
    ).fundamentalAssessment!;
    // Zero scheduled unlocks is CONTEXT (neutral), never bullish evidence.
    expect(none.dimensions.find((d) => d.name === "unlock-dilution")!.status).toBe("neutral");
    expect(none.limitations.join(" ")).toContain("absence of unlocks is not treated as bullish evidence");
  });

  it("(9) a missing total supply yields NO dilution metric and an explicit limitation (never a zero)", () => {
    const a = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", {
          tokenomics: tokenomics({
            supply: { circulatingSupply: 19_850_000, reliable: true },
            unlocks: undefined,
            availableDatasets: 1,
          }),
        }),
      }),
    ).fundamentalAssessment!;
    expect(a.cryptoMetrics?.totalSupply).toBeUndefined();
    expect(a.cryptoMetrics?.circulatingPercent).toBeUndefined();
    expect(a.cryptoMetrics?.dilutionPressurePercent).toBeUndefined();
    expect(a.evidence.some((e) => e.metric === "total_supply")).toBe(false);
    expect(a.dimensions.find((d) => d.name === "supply-structure")!.status).toBe("neutral");
    expect(a.limitations.join(" ")).toMatch(/Total supply was not supplied/);
    expect(a.limitations.join(" ")).toMatch(/Unlock schedule UNAVAILABLE/);
  });
});

// ── 3. Protocol / network economics + valuation context ──────────

describe("279 crypto (A) — protocol economics and valuation context", () => {
  it("(10) TVL and fees are reported with provider, source, period and unit", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    const tvl = a.evidence.find((e) => e.metric === "tvl")!;
    expect(tvl.value).toBe(62_000_000_000);
    expect(tvl.unit).toBe("USD");
    expect(tvl.provider).toBe("DeFiLlama");
    expect(tvl.source).toContain("TVL");
    const fees = a.evidence.find((e) => e.metric === "daily_fees")!;
    expect(fees.value).toBe(1_250_000);
    expect(fees.freshness).toBe("HISTORICAL");
    const dim = a.dimensions.find((d) => d.name === "protocol-economics")!;
    expect(dim.status).toBe("positive");
    expect(dim.evidence).toContain("+4.20%");
  });

  it("(11) a contracting protocol is scored as weakening, from the same measurement", () => {
    const a = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", {
          defi: defi({ tvl: { current: 48_000_000_000, change7d: -6.1, change30d: -9.4, reliable: true } }),
        }),
      }),
    ).fundamentalAssessment!;
    expect(a.dimensions.find((d) => d.name === "protocol-economics")!.status).toBe("negative");
    expect(a.state).toBe("weakening");
  });

  it("(12) market capitalisation and FDV are DERIVED and carry their basis, never presented as provider valuation", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    const mcap = a.evidence.find((e) => e.metric === "market_cap")!;
    expect(mcap.derived).toBe(true);
    expect(mcap.basis).toContain("circulating supply");
    const dim = a.dimensions.find((d) => d.name === "valuation-context")!;
    expect(dim.evidence).toContain("FDV/market-cap");
    expect(dim.evidence).toContain("DERIVED");
    expect(a.limitations.join(" ")).toContain("DERIVED");
    expect(a.cryptoMetrics?.fdvDerived! > a.cryptoMetrics?.marketCapDerived!).toBe(true);
  });

  it("(13) no price → no derived valuation context (never assumed), and it is disclosed", () => {
    const a = assessFundamentals(undefined, {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      providerInstrumentId: "BTC-USDT",
      crypto: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }),
    });
    expect(a.dimensions.find((d) => d.name === "valuation-context")!.status).toBe("neutral");
    expect(a.cryptoMetrics?.marketCapDerived).toBeUndefined();
    expect(a.limitations.join(" ")).toMatch(/no market price was supplied/);
  });
});

// ── 4. Market structure context: traceable, never double counted ──

describe("279 crypto (A) — market-structure context is informational only", () => {
  it("(14) CoinGlass evidence is reported as context with the consuming layer named", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    const dim = a.dimensions.find((d) => d.name === "market-positioning")!;
    expect(dim.status).toBe("neutral");
    expect(dim.informational).toBe(true);
    expect(dim.consumedBy).toContain("analysis engine");
    expect(dim.evidence).toContain("coinglass");
    const oi = a.evidence.find((e) => e.metric === "open_interest")!;
    expect(oi.consumedElsewhere).toContain("analysis engine");
    expect(oi.providerInstrumentId).toBe("BTC-USDT");
    expect(oi.source).toContain("provider symbol");
  });

  it("(15) changing the derivatives payload alone cannot change the fundamental state", () => {
    const base = runAnalysis(BTC).fundamentalAssessment!;
    const wild = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }),
        derivativesData: {
          ...DERIVATIVES,
          openInterest: { current: 99_000_000, change1h: 55, change24h: 88 },
          fundingRate: { currentRate: -0.004, annualizedRate: -4.2 },
          longShort: { accountRatio: 4.5 },
          liquidations: { dominantSide: "shorts", totalVolume: 500_000_000 },
        },
      }),
    ).fundamentalAssessment!;
    expect(wild.state).toBe(base.state);
    expect(wild.confidence).toBe(base.confidence);
    expect(wild.directionalBias).toBe(base.directionalBias);
    // …but the context text does reflect the new provider values.
    expect(wild.dimensions.find((d) => d.name === "market-positioning")!.evidence).not.toBe(
      base.dimensions.find((d) => d.name === "market-positioning")!.evidence,
    );
  });

  it("(16) without a derivatives payload the context dimension is UNAVAILABLE with a reason", () => {
    const a = runAnalysis(
      cryptoInput({
        cryptoIntelligenceContext: cryptoContext("BTC-USDT", { tokenomics: tokenomics(), defi: defi() }),
      }),
    ).fundamentalAssessment!;
    expect(a.dimensions.find((d) => d.name === "market-positioning")!.status).toBe("unavailable");
    expect(a.unavailableDimensions).toContain("market-positioning");
    expect(a.limitations.join(" ")).toMatch(/no configured derivatives provider/i);
  });
});

// ── 5. Unavailable stays unavailable; determinism; pipeline reach ──

describe("279 crypto (A) — honesty, determinism and pipeline integration", () => {
  it("(17) dimensions no provider supplies stay UNAVAILABLE with reasons, never zeros", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    for (const name of ["network-activity", "on-chain-valuation", "options-etf-flows"]) {
      expect(a.dimensions.find((d) => d.name === name)!.status).toBe("unavailable");
      expect(a.unavailableDimensions).toContain(name);
    }
    expect(a.limitations.join(" ")).toMatch(/active addresses/);
    expect(a.limitations.join(" ")).toMatch(/MVRV/);
    expect(a.limitations.join(" ")).toMatch(/ETF flow/);
    // No evidence item exists for a metric no provider supplied.
    expect(a.evidence.some((e) => e.metric === "active_addresses")).toBe(false);
    expect(a.evidence.some((e) => typeof e.value === "number" && e.value === 0)).toBe(false);
  });

  it("(18) an instrument with no verified protocol mapping reports protocol economics unavailable (no guessed slug)", () => {
    const a = runAnalysis(SOL).fundamentalAssessment!;
    expect(a.dimensions.find((d) => d.name === "protocol-economics")!.status).toBe("unavailable");
    expect(a.evidence.some((e) => e.provider === "DeFiLlama")).toBe(false);
    expect(a.available).toBe(true);
  });

  it("(19) identical evidence yields a byte-identical assessment", () => {
    const first = runAnalysis(BTC).fundamentalAssessment!;
    const second = runAnalysis(BTC).fundamentalAssessment!;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("(20) the unified layer receives the crypto assessment and no technical_only escape is taken", () => {
    const result = runAnalysis(BTC);
    const unified = result.unifiedIntelligence!;
    expect(unified.fundamental.state).toBe(result.fundamentalAssessment!.state);
    expect(unified.fundamental.state).toBe("improving");
    expect(unified.state).toBe("aligned_bullish");
    expect(unified.explanation).not.toMatch(/technical.only/i);
    expect(unified.confluence.agreement).toBe("aligned");
    expect(result.fundamentalSummary).toBeTruthy();
  });

  it("(21) no crypto evidence at all → explicit unavailable assessment, no fabricated dimensions", () => {
    const a = runAnalysis(cryptoInput({})).fundamentalAssessment!;
    expect(a.domain).toBe("crypto");
    expect(a.available).toBe(false);
    expect(a.state).toBe("insufficient");
    expect(a.evidence).toEqual([]);
    expect(a.dimensions.every((d) => d.status === "unavailable")).toBe(true);
    expect(a.dimensions.length).toBe(8);
    expect(a.limitations.join(" ")).toMatch(/Traditional company fundamentals .* do not apply/);
  });

  it("(22) the rendered crypto result carries no equity metrics — only the disclosure that they do not apply", () => {
    const a = runAnalysis(BTC).fundamentalAssessment!;
    // Everything the card renders EXCEPT the explicit "these do not apply"
    // disclosure must be free of equity vocabulary.
    const rendered = [a.confidenceEvidence, ...a.dimensions.map((d) => d.evidence ?? "")].join(" ");
    for (const term of ["P/E", "EPS", "net margin", "ROE", "peers", "dividend", "EBITDA"]) {
      expect(rendered).not.toContain(term);
    }
    const equityVocabLimitations = a.limitations.filter((l) => /P\/E|EPS|net margin/.test(l));
    expect(equityVocabLimitations.length).toBe(1);
    expect(equityVocabLimitations[0]).toMatch(/do not apply to a crypto asset and are never shown for one/);
  });
});
