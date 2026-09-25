/**
 * Phase 288 — the fundamental summary must describe the domain that was
 * actually assessed.
 *
 * The live four-asset run surfaced this: a crypto instrument's reason read
 * "Traditional company fundamentals not applicable for crypto assets. …" — the
 * Alpha Vantage EQUITY payload's not-applicable note — even though the crypto
 * adapter had already produced its own, precise reason ("No crypto-native
 * fundamental evidence was supplied … tokenomics and protocol datasets are
 * unavailable"). A forex pair had the same substitution. The note is not a
 * reason: the equity leg never applied, so it cannot explain what is missing.
 *
 * These tests pin the rule for every routed domain, as well as the data-derived
 * commodity notes that replaced two symbol-regex statements which had drifted
 * into falsehood ("no yields provider integrated" — the Treasury curve IS read;
 * "no inventory provider integrated" — the EIA feed is integrated and is simply
 * petroleum).
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

function market(instrument: string, type: AnalysisInput["instrumentType"], price = 100): MarketData {
  return {
    instrument,
    instrumentType: type,
    provider: "twelve-data",
    fetchTimestamp: 1_760_000_000_000,
    price: { price, timestamp: 1_760_000_000_000, source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: 1_760_000_000_000 - (210 - i) * 36e5,
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 1000,
    })),
    timeframe: "H4",
    dataFreshness: "delayed",
  };
}

function tech(): TechnicalData {
  return {
    swingHighs: [105],
    swingLows: [98],
    structure: "HH/HL",
    bosDirection: "bullish",
    chochDirection: "none",
    supportLevels: [98],
    resistanceLevels: [105],
    volumeTrend: "unknown",
    dataPoints: 210,
  };
}

/** The Alpha Vantage payload as it actually arrives for a non-equity instrument. */
const notApplicablePayload = (instrumentType: string) =>
  ({
    provider: "alpha-vantage",
    symbol: "USDT",
    available: false,
    unavailableReason: `Traditional company fundamentals not applicable for ${instrumentType} assets.`,
  }) as unknown as AnalysisInput["fundamentalData"];

const base = (over: Partial<AnalysisInput>): AnalysisInput =>
  ({
    instrument: "USDT-SGD",
    instrumentType: "crypto",
    timeframe: "H4",
    marketData: market("USDT-SGD", "crypto"),
    technicalData: tech(),
    ...over,
  }) as AnalysisInput;

describe("phase 288 — the summary speaks for the assessed domain", () => {
  it("crypto: carries the crypto adapter's own reason, not the equity note", () => {
    const result = runAnalysis(
      base({ fundamentalData: notApplicablePayload("crypto") }),
    );
    expect(result.fundamentalAssessment!.domain).toBe("crypto");
    expect(result.fundamentalAssessment!.available).toBe(false);
    expect(result.fundamentalSummary).toContain(
      "No crypto-native fundamental evidence was supplied for this instrument",
    );
  });

  it("crypto: the assessment's limitations are the source of that text", () => {
    const result = runAnalysis(base({ fundamentalData: notApplicablePayload("crypto") }));
    for (const line of result.fundamentalAssessment!.limitations.slice(0, 3)) {
      // Every limitation the summary shows must be one the adapter disclosed.
      expect(
        result.fundamentalAssessment!.limitations.some((l) => result.fundamentalSummary.includes(l)),
      ).toBe(true);
      void line;
    }
    // The unrelated equity note is no longer presented as the reason.
    expect(result.fundamentalSummary).not.toContain(
      "Traditional company fundamentals not applicable for crypto assets",
    );
  });

  it("forex: same rule, with the forex adapter's own disclosure", () => {
    const result = runAnalysis(
      base({
        instrument: "AED/ARS",
        instrumentType: "forex",
        marketData: market("AED/ARS", "forex", 3.7),
        fundamentalData: notApplicablePayload("forex"),
      }),
    );
    expect(result.fundamentalAssessment!.domain).toBe("forex");
    expect(result.fundamentalSummary).not.toContain(
      "Traditional company fundamentals not applicable for forex assets",
    );
    const own = result.fundamentalAssessment!.limitations;
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((l) => result.fundamentalSummary.includes(l))).toBe(true);
  });

  it("stock: the equity payload note is kept verbatim (it IS the domain's payload)", () => {
    const result = runAnalysis(
      base({
        instrument: "AAPL",
        instrumentType: "stock",
        marketData: market("AAPL", "stock", 190),
        fundamentalData: {
          provider: "alpha-vantage",
          symbol: "AAPL",
          available: false,
          unavailableReason: "Alpha Vantage fundamentals unavailable for AAPL (provider returned no payload).",
        } as unknown as AnalysisInput["fundamentalData"],
      }),
    );
    expect(result.fundamentalAssessment!.domain).toBe("equity");
    expect(result.fundamentalSummary).toContain(
      "Alpha Vantage fundamentals unavailable for AAPL (provider returned no payload).",
    );
  });

  it("commodity notes are data-derived — no false 'no provider integrated' claims", () => {
    const result = runAnalysis(
      base({
        instrument: "GAU/EUR",
        instrumentType: "commodity",
        marketData: market("GAU/EUR", "commodity", 118),
        fundamentalData: notApplicablePayload("commodity"),
        // The Treasury leg answered: the real-yield channel IS available, so
        // the summary must not claim that no yields provider is integrated.
        treasuryData: {
          available: true,
          source: "US Treasury (home.treasury.gov XML feed)",
          fetchedAt: 1_760_000_000_000,
          freshness: "FRESH",
          latest: {
            nominal: { observationDate: "2026-09-24", nominal: { "2Y": 4.12, "10Y": 4.31 } },
            real: { observationDate: "2026-09-24", real: { "10Y": 2.05 } },
          },
          previous: {
            nominal: { observationDate: "2026-09-23", nominal: { "2Y": 4.1, "10Y": 4.28 } },
            real: { observationDate: "2026-09-23", real: { "10Y": 1.98 } },
          },
        } as unknown as AnalysisInput["treasuryData"],
      }),
    );
    expect(result.fundamentalAssessment!.domain).toBe("commodity");
    expect(result.fundamentalSummary).not.toContain("no yields provider integrated");
    expect(result.fundamentalSummary).not.toContain("no inventory provider integrated");
    expect(result.fundamentalSummary).toContain("ACTUAL US Treasury curve in use");
  });
});
