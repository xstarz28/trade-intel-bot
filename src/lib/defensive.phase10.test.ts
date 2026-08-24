/**
 * Phase 10 — DEFENSIVE DATA CONTRACT.
 *
 * Malformed / partial / non-finite provider data must:
 *   - never crash the engine,
 *   - never fabricate evidence,
 *   - produce deterministic, honest output (NO_TRADE where evidence is unusable).
 *
 * DATA FAILURE ≠ MARKET SIGNAL.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { assemble, buildMtf, buildSmc, BULL_LEVELS } from "./benchmark-fixtures.phase9";
import type { AnalysisInput } from "@/types/analysis";
import type { TechnicalData } from "@/lib/data/market-types";

const bullSpec = {
  structure: "HH/HL" as const, bos: "bullish" as const,
  support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
  events: "Fed signals hawkish stance, rate hike",
};

function runRaw(over: Record<string, unknown>) {
  return runAnalysis({ ...assemble(bullSpec), ...over } as unknown as AnalysisInput);
}

// ── MTF context malformations ──────────────────────────────────────

describe("Defensive: malformed MTF context", () => {
  it("1. available=true + smc MISSING on a timeframe slot → no crash, honest disclosure", () => {
    const mtf = buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" });
    (mtf.timeframes[0] as unknown as { smc: unknown }).smc = undefined;
    const r = runRaw({ technicalData: { ...assemble(bullSpec).technicalData!, mtf } });
    // No crash; decision remains deterministic; no fabricated per-TF structure text.
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    expect(r.technicalSummary).not.toContain("undefined");
    expect(r.bias).toBe("Bullish"); // primary facts intact
  });

  it("2. timeframes EMPTY array → no crash", () => {
    const mtf = buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long" });
    mtf.timeframes = [];
    const r = runRaw({ technicalData: { ...assemble(bullSpec).technicalData!, mtf } });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    expect(Number.isFinite(r.confidence ?? 50)).toBe(true);
  });

  it("3. malformed smc item ({}) inside timeframes → no crash, disclosed not fabricated", () => {
    const mtf = buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" });
    (mtf.timeframes[0] as unknown as { smc: unknown }).smc = {};
    const r = runRaw({ technicalData: { ...assemble(bullSpec).technicalData!, mtf } });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    expect(r.technicalSummary).not.toContain("undefined");
  });

  it("4. PRIMARY tech.smc malformed (missing internalExternal) → falls back honestly, no crash", () => {
    const td = assemble(bullSpec).technicalData!;
    (td.smc as unknown as Record<string, unknown>) = {}; // shape-violating smc
    const r = runRaw({ technicalData: td });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    // Reasons exist exactly when rejected — never a silent state either way.
    if (r.recommendation === "NO_TRADE") expect(r.noTradeReasons.length).toBeGreaterThan(0);
    else expect(r.tradePlan).toBeDefined();
    expect(JSON.stringify(r.breakdown)).not.toContain("NaN");
  });

  it("5. null nested field inside valid smc → no crash", () => {
    const td = assemble(bullSpec).technicalData!;
    const smc = buildSmc();
    (smc.recentSweep as unknown as null) = null;
    (td.smc as unknown) = smc;
    const r = runRaw({ technicalData: td });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
  });
});

// ── Non-finite numerics ────────────────────────────────────────────

describe("Defensive: non-finite numeric fields", () => {
  it("6. NaN price snapshot → no crash, NO tradePlan with NaN values", () => {
    const base = assemble(bullSpec);
    const r = runRaw({
      marketData: {
        ...base.marketData!,
        price: { price: NaN, timestamp: Date.now(), source: "x" },
      },
    });
    expect(r.tradePlan).toBeUndefined();
    expect(r.noTradeReasons.join(" ").toLowerCase()).toMatch(/price|structural|confluence/);
  });

  it("7. NaN swing levels are ignored (never enter keyLevels/plan)", () => {
    const td = assemble(bullSpec).technicalData!;
    td.swingHighs = [NaN, 112];
    td.swingLows = [NaN];
    td.supportLevels = [NaN];
    td.resistanceLevels = [Infinity];
    const r = runRaw({ technicalData: td });
    if (r.tradePlan) {
      const sl = parseFloat(r.tradePlan.stopLoss);
      const tp = parseFloat(r.tradePlan.takeProfit);
      expect(Number.isFinite(sl)).toBe(true);
      expect(Number.isFinite(tp)).toBe(true);
      // The finite fixture levels are the ONLY usable structural facts.
      expect([sl, tp]).toContain(BULL_LEVELS.support);
    }
  });

  it("8. Infinity atr14 does not produce Infinity in output", () => {
    const td = assemble(bullSpec).technicalData!;
    td.atr14 = Infinity;
    const r = runRaw({ technicalData: td });
    expect(r.tradePlan === undefined || Number.isFinite(parseFloat(r.tradePlan.stopLoss))).toBe(true);
  });
});

// ── Provider-context malformations ─────────────────────────────────

describe("Defensive: malformed optional provider contexts", () => {
  it("9. treasuryContext with garbage numbers → no crash, no directional vote from garbage", () => {
    const good = runRaw({});
    const r = runRaw({
      treasuryData: {
        available: true,
        source: "x",
        fetchedAt: Date.now(),
        freshness: "FRESH",
        latest: { nominal: { observationDate: "2026-08-21", nominal: { "2Y": NaN, "10Y": Infinity } } },
        previous: { nominal: { observationDate: "2026-08-20", nominal: { "10Y": undefined } } },
      },
    });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    // Garbage must not ADD conviction beyond the honest baseline.
    expect((r.confidence ?? 0) - (good.confidence ?? 0)).toBeLessThanOrEqual(12); // ≤ macroYield cap
  });

  it("10. executionData with non-finite book numbers → treated as unusable, thesis unchanged", () => {
    const r = runRaw({
      instrument: "BTC/USD", instrumentType: "crypto",
      executionData: {
        available: true, provider: "OKX public order book", instrumentId: "BTC-USDT-SWAP",
        snapshotTs: Date.now(), fetchedAt: Date.now(), freshness: "FRESH",
        bid: NaN, ask: Infinity, mid: NaN, spread: NaN, spreadBps: NaN,
        bidDepth: NaN, askDepth: NaN, imbalance: NaN, regime: "UNKNOWN",
        book: { bids: [], asks: [] },
      },
    });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    expect(r.executionWarnings?.join(" ") ?? "").not.toContain("NaN");
  });

  it("11. crossAsset with NaN correlation → weak/unavailable handling, no crash", () => {
    const r = runRaw({
      technicalData: {
        ...assemble(bullSpec).technicalData!,
        crossAsset: {
          comparatorSymbol: "DXY", timeframe: "H4", available: true,
          dataKind: "actual_price", provider: "Twelve Data",
          correlation: NaN, sampleSize: 30, directionalContext: "weak",
          comparatorMomentum: "flat",
        },
      },
    });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
  });

  it("12. calendar event with malformed actual/forecast strings → skipped without crash", () => {
    const r = runRaw({
      calendarData: {
        provider: "tickatlas", timestamp: Date.now(), freshness: "recent", confidence: "high",
        events: [{
          id: "e", event: "CPI y/y", currency: "USD", datetime: Date.now() - 36e5,
          status: "released", importance: 3, actual: "not-a-number", forecast: null,
        }],
        macroRisk: { level: "medium", explanation: "", highImpact24h: 0, highImpact72h: 0 },
        availability: { upcoming24h: false, upcoming72h: false, recentReleased: true },
      },
    });
    expect(r.recommendation).toBeOneOf(["LONG", "NO_TRADE"]);
    expect(JSON.stringify(r)).not.toContain("\"NaN\"");
  });
});
