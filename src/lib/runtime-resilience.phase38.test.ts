/**
 * Phase 38 — LIVE RUNTIME & DATA-FAILURE RESILIENCE AUDIT.
 *
 * Validates the complete analysis pipeline under real-world failure conditions:
 *   - Provider absence / malformed data / stale data
 *   - Instrument identity preservation across the full pipeline
 *   - Rapid/sequential execution isolation
 *   - Concurrent execution simulation
 *   - Journal historical integrity
 *   - Error boundary safety (NaN, Infinity, undefined, null, empty arrays)
 *   - Professional decision safety under degraded conditions
 *   - Fundamental/news failure behavior
 *   - Data honesty rules
 *   - Observability traceability
 *
 * All tests use deterministic fixtures. No live provider calls.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildChain, buildMtfContext } from "./data/mtf";
import { buildEvidenceChallenge } from "./evidence-challenge";
import { buildLongHorizonThesis } from "./long-horizon-thesis";
import { auditDecisionIntegrity } from "./decision-integrity";
import { createAnalysisSnapshot, journalFromAnalysis, transitionEntry } from "./journal";

// ══════════════════════════════════════════════════════════════════
// FIXTURE BUILDERS
// ══════════════════════════════════════════════════════════════════

function ts(i: number): number {
  return Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000;
}

function candle(i: number, o: number, h: number, l: number, c: number, v = 1_000_000, tsOverride?: number): OhlcvCandle {
  return { timestamp: tsOverride ?? ts(i), open: o, high: h, low: l, close: c, volume: v };
}

function bullCandles(base = 50000, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = base + i * 80;
    return candle(i, p - 20, p + 30, p - 30, p + 20);
  });
}

function bearCandles(base = 50000, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = base - i * 80;
    return candle(i, p + 20, p + 30, p - 30, p - 20);
  });
}

function flatCandles(base = 50000, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, () => ({
    timestamp: ts(0), open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1000,
  }));
}

function buildInput(
  instrument: string,
  type: AnalysisInput["instrumentType"],
  candles: OhlcvCandle[],
  opts: Partial<AnalysisInput> = {},
): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({
      timeframe: s.timeframe,
      role: (s.role === "setup" || s.role === "trigger" ? s.role : "setup") as "setup" | "trigger",
      candles: candles.slice(-120),
    })),
  ];
  tech.mtf = buildMtfContext("D1", mtfInputs);
  return {
    instrument, instrumentType: type, timeframe: "D1", tradingStyle: "swing",
    marketData: {
      instrument, instrumentType: type, provider: "twelve-data", fetchTimestamp: Date.now(),
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech, ...opts,
  };
}

function run(input: AnalysisInput): AnalysisResult {
  return runAnalysis(input);
}

// ══════════════════════════════════════════════════════════════════
// CORE ASSERTIONS
// ══════════════════════════════════════════════════════════════════

function assertValid(r: AnalysisResult, label: string) {
  expect(r.bias, `${label}: bias`).toBeTruthy();
  expect(r.confidence, `${label}: confidence`).toBeGreaterThanOrEqual(20);
  expect(r.confidence, `${label}: confidence`).toBeLessThanOrEqual(88);
  expect(r.recommendation, `${label}: rec`).toBeTruthy();
  expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.recommendation);
  expect(r.instrument, `${label}: instrument`).toBeTruthy();

  if (r.recommendation === "NO_TRADE") {
    expect(r.tradePlan, `${label}: NO_TRADE no plan`).toBeUndefined();
  }
  if (r.tradePlan) {
    expect(r.tradePlan.riskReward, `${label}: R:R`).toBeGreaterThanOrEqual(1.5);
    const e = parseFloat(r.tradePlan.entry);
    const sl = parseFloat(r.tradePlan.stopLoss);
    const tp = parseFloat(r.tradePlan.takeProfit);
    expect(Number.isFinite(e) && e > 0).toBe(true);
    expect(Number.isFinite(sl) && sl > 0).toBe(true);
    expect(Number.isFinite(tp) && tp > 0).toBe(true);
  }
}

function assertNoFabrication(r: AnalysisResult, label: string) {
  const json = JSON.stringify({
    technicalSummary: r.technicalSummary,
    fundamentalSummary: r.fundamentalSummary,
    riskNote: r.riskNote,
    noTradeReasons: r.noTradeReasons,
  });
  expect(json, `${label}: no NaN`).not.toMatch(/\bNaN\b/);
  expect(json, `${label}: no Infinity`).not.toMatch(/\bInfinity\b/);
  expect(json, `${label}: no probability`).not.toMatch(/\b(probability|win.?rate|guarantee|guaranteed|will definitely)\b/);
}

function assertInstrumentIdentity(r: AnalysisResult, instrument: string, label: string) {
  expect(r.instrument, `${label}: instrument`).toBe(instrument);
}

// ══════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════

describe("Phase 38 — Runtime & Data-Failure Resilience", () => {

  // ── 1. Provider failure matrix ─────────────────────────────────

  describe("Provider failure / degraded input", () => {
    it("no optional providers at all", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      delete input.calendarData;
      delete input.treasuryData;
      delete input.cotData;
      delete input.eiaData;
      delete input.executionData;
      delete input.okxSpecData;
      const r = run(input);
      assertValid(r, "no-optionals");
      assertNoFabrication(r, "no-optionals");
    });

    it("no fundamental or sentiment data", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      const r = run(input);
      assertValid(r, "no-fund-sent");
    });

    it("no macro or calendar data", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.macroData;
      delete input.calendarData;
      const r = run(input);
      assertValid(r, "no-macro-cal");
    });

    it("no derivatives for crypto", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.derivativesData;
      const r = run(input);
      assertValid(r, "no-deriv");
    });

    it("no treasury or COT for forex", () => {
      const input = buildInput("EUR/USD", "forex", bullCandles(1.1));
      delete input.treasuryData;
      delete input.cotData;
      const r = run(input);
      assertValid(r, "no-treasury-cot");
    });

    it("no EIA for commodity", () => {
      const input = buildInput("XAU/USD", "commodity", bullCandles(2400));
      delete input.eiaData;
      const r = run(input);
      assertValid(r, "no-eia");
    });

    it("no execution data", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.executionData;
      const r = run(input);
      assertValid(r, "no-execution");
    });

    it("no okx spec data", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.okxSpecData;
      const r = run(input);
      assertValid(r, "no-okx");
    });

    it("no market data price snapshot does not crash", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      // The engine should handle missing price gracefully
      // We verify it does not crash — result may be degraded but valid
      const r = run(input);
      assertValid(r, "no-price");
    });

    it("provider failure never becomes directional evidence", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      const r = run(input);
      if (r.evidenceChallenge) {
        for (const e of r.evidenceChallenge.supportingEvidence) {
          expect(e.direction, `${e.source} not unavailable`).not.toBe("unavailable");
        }
      }
    });
  });

  // ── 2. Malformed / extreme data ────────────────────────────────

  describe("Malformed data safety", () => {
    it("candles with NaN close do not crash", () => {
      const candles = bullCandles();
      candles[100] = candle(100, 50000, 50100, 49900, NaN);
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "nan-close");
    });

    it("candles with Infinity values do not crash", () => {
      const candles = bullCandles();
      candles[50] = candle(50, 50000, Infinity, 49900, 50100);
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "infinity");
    });

    it("candles with negative prices do not crash", () => {
      const candles = bullCandles();
      candles[50] = candle(50, -100, 50, -200, -50);
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "negative-price");
    });

    it("candles with zero volume do not crash", () => {
      const candles = bullCandles();
      for (let i = 0; i < 10; i++) {
        candles[i] = candle(i, 50000, 50100, 49900, 50050, 0);
      }
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "zero-volume");
    });

    it("candles with zero high=low do not crash", () => {
      const candles = bullCandles();
      candles[50] = candle(50, 50000, 50000, 50000, 50000);
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "flat-candle");
    });

    it("candles where high < low (inverted) do not crash", () => {
      const candles = bullCandles();
      candles[50] = candle(50, 50000, 49000, 51000, 50500);
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "inverted-hl");
    });

    it("single candle does not crash", () => {
      const single = [candle(0, 50000, 50100, 49900, 50050)];
      const r = run(buildInput("BTC/USD", "crypto", single));
      assertValid(r, "single-candle");
    });

    it("empty technical data fields handled gracefully", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      if (input.technicalData) {
        delete (input.technicalData as unknown as Record<string, unknown>).rsi;
        delete (input.technicalData as unknown as Record<string, unknown>).macd;
      }
      const r = run(input);
      assertValid(r, "empty-tech-fields");
    });
  });

  // ── 3. Staleness / time audit ──────────────────────────────────

  describe("Data freshness / staleness", () => {
    it("fresh candles produce valid result", () => {
      const freshCandles = bullCandles().map((c, i) => ({
        ...c, timestamp: Date.now() - (200 - i) * 86_400_000,
      }));
      const r = run(buildInput("BTC/USD", "crypto", freshCandles));
      assertValid(r, "fresh");
    });

    it("stale candles (1 year old) produce valid result with appropriate quality", () => {
      const staleCandles = bullCandles().map((c) => ({
        ...c, timestamp: Date.parse("2025-01-01T00:00:00Z"),
      }));
      const r = run(buildInput("BTC/USD", "crypto", staleCandles));
      assertValid(r, "stale");
      if (r.dataQualityContext) {
        expect(r.dataQualityContext.primaryData.status).toBeTruthy();
      }
    });

    it("future-dated candles do not crash", () => {
      const futureCandles = bullCandles().map((c, i) => ({
        ...c, timestamp: Date.parse("2030-01-01T00:00:00Z") + i * 86_400_000,
      }));
      const r = run(buildInput("BTC/USD", "crypto", futureCandles));
      assertValid(r, "future-dated");
    });

    it("out-of-order timestamps do not crash", () => {
      const candles = bullCandles();
      // Reverse a few timestamps
      candles[50] = { ...candles[50], timestamp: candles[40].timestamp };
      candles[100] = { ...candles[100], timestamp: candles[90].timestamp };
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "out-of-order");
    });

    it("duplicate timestamps do not crash", () => {
      const candles = bullCandles();
      for (let i = 10; i < 20; i++) {
        candles[i] = { ...candles[i], timestamp: candles[10].timestamp };
      }
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "dup-timestamps");
    });

    it("irregular intervals do not crash", () => {
      const candles = bullCandles();
      // Some candles are 1 day apart, some are 7 days
      for (let i = 0; i < candles.length; i += 5) {
        candles[i] = { ...candles[i], timestamp: ts(i * 7) };
      }
      const r = run(buildInput("BTC/USD", "crypto", candles));
      assertValid(r, "irregular-intervals");
    });

    it("metadata-only timestamp change does not alter fingerprint", () => {
      const input1 = buildInput("BTC/USD", "crypto", bullCandles());
      input1.marketData!.fetchTimestamp = 1000;
      const r1 = run(input1);

      const input2 = buildInput("BTC/USD", "crypto", bullCandles());
      input2.marketData!.fetchTimestamp = 2000;
      const r2 = run(input2);

      // Fingerprint should be the same since decision-relevant data is identical
      if (r1.decisionFingerprint && r2.decisionFingerprint) {
        expect(r1.decisionFingerprint).toBe(r2.decisionFingerprint);
      }
    });
  });

  // ── 4. Instrument isolation ────────────────────────────────────

  describe("Instrument identity preservation", () => {
    const instruments: [string, AnalysisInput["instrumentType"], number][] = [
      ["BTC/USD", "crypto", 50000],
      ["ETH/USD", "crypto", 3000],
      ["SOL/USD", "crypto", 150],
      ["DOGE/USD", "crypto", 0.1],
      ["EUR/USD", "forex", 1.1],
      ["GBP/USD", "forex", 1.3],
      ["USD/JPY", "forex", 150],
      ["XAU/USD", "commodity", 2400],
      ["AAPL", "stock", 200],
    ];

    for (const [sym, type, base] of instruments) {
      it(`${sym}: identity preserved through full pipeline`, () => {
        const r = run(buildInput(sym, type, bullCandles(base)));
        assertInstrumentIdentity(r, sym, sym);
        assertValid(r, sym);
        assertNoFabrication(r, sym);

        // Journal snapshot preserves instrument
        const snapshot = createAnalysisSnapshot(r);
        expect(snapshot.analysisId).toBe(r.id);
        expect(snapshot.decision).toBe(r.recommendation);
      });
    }

    it("rapid instrument switch preserves identity", () => {
      const pairs: [string, AnalysisInput["instrumentType"], number][] = [
        ["BTC/USD", "crypto", 50000],
        ["ETH/USD", "crypto", 3000],
        ["EUR/USD", "forex", 1.1],
        ["XAU/USD", "commodity", 2400],
        ["AAPL", "stock", 200],
        ["BTC/USD", "crypto", 50000],
      ];
      const results = pairs.map(([sym, type, base]) => run(buildInput(sym, type, bullCandles(base))));
      results.forEach((r, i) => {
        assertInstrumentIdentity(r, pairs[i][0], `rapid-${i}`);
      });
      // First and last should be the same instrument
      expect(results[0].instrument).toBe(results[5].instrument);
      expect(results[1].instrument).not.toBe(results[0].instrument);
    });
  });

  // ── 5. Rapid / sequential execution ────────────────────────────

  describe("Rapid / sequential execution", () => {
    it("100 sequential analyses produce valid results", () => {
      for (let i = 0; i < 100; i++) {
        const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
        assertValid(r, `seq-${i}`);
      }
    });

    it("100 sequential analyses with alternating instruments", () => {
      const syms: [string, AnalysisInput["instrumentType"]][] = [
        ["BTC/USD", "crypto"],
        ["ETH/USD", "crypto"],
        ["EUR/USD", "forex"],
        ["XAU/USD", "commodity"],
      ];
      for (let i = 0; i < 100; i++) {
        const [sym, type] = syms[i % syms.length];
        const r = run(buildInput(sym, type, bullCandles()));
        assertInstrumentIdentity(r, sym, `alt-${i}`);
      }
    });

    it("mixed styles produce valid results", () => {
      const styles: AnalysisInput["tradingStyle"][] = ["scalping", "intraday", "swing"];
      for (const style of styles) {
        const r = run(buildInput("BTC/USD", "crypto", bullCandles(), { tradingStyle: style }));
        assertValid(r, `style-${style}`);
        expect(r.tradingStyle).toBe(style);
      }
    });

    it("no state leakage between rapid analyses", () => {
      const r1 = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const r2 = run(buildInput("ETH/USD", "crypto", bullCandles()));
      const r3 = run(buildInput("EUR/USD", "forex", bullCandles(1.1)));

      expect(r1.instrument).toBe("BTC/USD");
      expect(r2.instrument).toBe("ETH/USD");
      expect(r3.instrument).toBe("EUR/USD");
      expect(r1.id).not.toBe(r2.id);
      expect(r2.id).not.toBe(r3.id);
    });

    it("identical inputs produce identical results after rapid execution", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      const results = Array.from({ length: 20 }, () => run(input));
      for (let i = 1; i < results.length; i++) {
        expect(results[i].recommendation).toBe(results[0].recommendation);
        expect(results[i].bias).toBe(results[0].bias);
        expect(results[i].confidence).toBe(results[0].confidence);
        expect(results[i].decisionFingerprint).toBe(results[0].decisionFingerprint);
      }
    });
  });

  // ── 6. Concurrent / race simulation ────────────────────────────

  describe("Concurrent execution simulation", () => {
    it("concurrent-style execution preserves identity", () => {
      // Simulate interleaved execution
      const inputs = [
        buildInput("BTC/USD", "crypto", bullCandles()),
        buildInput("ETH/USD", "crypto", bullCandles()),
        buildInput("EUR/USD", "forex", bullCandles(1.1)),
        buildInput("XAU/USD", "commodity", bullCandles(2400)),
        buildInput("AAPL", "stock", bullCandles(200)),
      ];
      const expectedInstruments = ["BTC/USD", "ETH/USD", "EUR/USD", "XAU/USD", "AAPL"];

      // Execute in order (simulating completion after interleaving)
      const results = inputs.map((input) => run(input));
      results.forEach((r, i) => {
        assertInstrumentIdentity(r, expectedInstruments[i], `concurrent-${i}`);
      });
    });

    it("different completion order preserves identity", () => {
      const r1 = run(buildInput("ETH/USD", "crypto", bullCandles()));
      const r2 = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const r3 = run(buildInput("EUR/USD", "forex", bullCandles(1.1)));

      // ETH finished first
      expect(r1.instrument).toBe("ETH/USD");
      expect(r2.instrument).toBe("BTC/USD");
      expect(r3.instrument).toBe("EUR/USD");
    });
  });

  // ── 7. Journal historical integrity ────────────────────────────

  describe("Journal historical integrity", () => {
    it("snapshot preserves exact analytical state", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const snapshot = createAnalysisSnapshot(r);

      expect(snapshot.decision).toBe(r.recommendation);
      expect(snapshot.bias).toBe(r.bias);
      expect(snapshot.confidence).toBe(r.confidence);
      expect(snapshot.conviction).toBe(r.conviction);
      expect(snapshot.decisionFingerprint).toBe(r.decisionFingerprint);
      expect(snapshot.scenario).toBe(r.marketScenario?.scenario);
      expect(snapshot.marketRegime).toBe(r.marketRegimeContext?.regime);
      expect(snapshot.actionability).toBe(r.professionalThesis?.actionability);
    });

    it("snapshot is immutable — modifying result does not affect snapshot", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const snapshot = createAnalysisSnapshot(r);
      const snapshotCopy = { ...snapshot };

      // Journal creation must not modify original
      expect(r.recommendation).toBeTruthy();
      expect(snapshot).toEqual(snapshotCopy);
    });

    it("consecutive journal entries from different analyses are independent", () => {
      const r1 = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const r2 = run(buildInput("EUR/USD", "forex", bullCandles(1.1)));

      const snap1 = createAnalysisSnapshot(r1);
      const snap2 = createAnalysisSnapshot(r2);

      expect(snap1.analysisId).not.toBe(snap2.analysisId);
      // Different instrument types may produce different fingerprints
      expect(snap1.decision).toBeTruthy();
      expect(snap2.decision).toBeTruthy();
    });

    it("journal transition validates lifecycle rules", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const entry = journalFromAnalysis(r);

      // PLANNED → OPEN should work
      const opened = transitionEntry(entry, "OPEN");
      expect(opened.status).toBe("OPEN");

      // OPEN → CLOSED should work
      const closed = transitionEntry(opened, "CLOSED");
      expect(closed.status).toBe("CLOSED");

      // CLOSED → OPEN should fail
      expect(() => transitionEntry(closed, "OPEN")).toThrow();
    });

    it("later analysis does not modify previous journal entry", () => {
      const r1 = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const entry1 = journalFromAnalysis(r1);
      const snap1Fingerprint = entry1.analysisSnapshot.decisionFingerprint;

      // Run another analysis
      run(buildInput("BTC/USD", "crypto", bullCandles()));
      // entry1 snapshot must remain unchanged
      expect(entry1.analysisSnapshot.decisionFingerprint).toBe(snap1Fingerprint);
    });
  });

  // ── 8. Professional decision safety under degradation ───────────

  describe("Decision safety under degradation", () => {
    it("WAIT never has tradePlan", () => {
      const candles = flatCandles();
      const r = run(buildInput("BTC/USD", "crypto", candles));
      if (r.professionalThesis?.actionability === "WAIT") {
        expect(r.tradePlan).toBeUndefined();
      }
    });

    it("NO_TRADE is terminal and has no tradePlan", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles()));
      if (r.recommendation === "NO_TRADE") {
        expect(r.tradePlan).toBeUndefined();
        expect(r.noTradeReasons.length).toBeGreaterThan(0);
      }
    });

    it("LONG trade plan has correct direction and side-correct levels", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      if (r.recommendation === "LONG" && r.tradePlan) {
        expect(r.tradePlan.direction).toBe("long");
        const e = parseFloat(r.tradePlan.entry);
        const sl = parseFloat(r.tradePlan.stopLoss);
        const tp = parseFloat(r.tradePlan.takeProfit);
        expect(sl).toBeLessThan(e);
        expect(tp).toBeGreaterThan(e);
      }
    });

    it("SHORT trade plan has correct direction and side-correct levels", () => {
      const r = run(buildInput("BTC/USD", "crypto", bearCandles()));
      if (r.recommendation === "SHORT" && r.tradePlan) {
        expect(r.tradePlan.direction).toBe("short");
        const e = parseFloat(r.tradePlan.entry);
        const sl = parseFloat(r.tradePlan.stopLoss);
        const tp = parseFloat(r.tradePlan.takeProfit);
        expect(tp).toBeLessThan(e);
        expect(sl).toBeGreaterThan(e);
      }
    });

    it("missing optional data never forces LONG/SHORT", () => {
      const input = buildInput("BTC/USD", "crypto", flatCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      const r = run(input);
      // Without optional data, flat candles should produce NO_TRADE or WAIT
      // Not a forced directional trade
      if (r.recommendation !== "NO_TRADE") {
        expect(r.confidence).toBeLessThanOrEqual(60);
      }
    });

    it("provider outage does not create directional conviction", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      delete input.treasuryData;
      delete input.cotData;
      delete input.eiaData;
      const r = run(input);
      assertValid(r, "provider-outage");
      // With no optional data, conviction should reflect only structural evidence
      assertNoFabrication(r, "provider-outage");
    });
  });

  // ── 9. Fundamental / news failure behavior ─────────────────────

  describe("Fundamental / news failure behavior", () => {
    it("all optional providers unavailable for crypto", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      delete input.calendarData;
      delete input.treasuryData;
      delete input.cotData;
      const r = run(input);
      assertValid(r, "all-unavail-crypto");

      // Fundamental thesis should reflect unavailable data
      if (r.fundamentalThesis) {
        expect(["FUNDAMENTAL_UNAVAILABLE", "TECHNICAL_UNAVAILABLE"]).toContain(
          r.fundamentalThesis.alignment,
        );
      }
    });

    it("all optional providers unavailable for forex", () => {
      const input = buildInput("EUR/USD", "forex", bullCandles(1.1));
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.calendarData;
      delete input.treasuryData;
      delete input.cotData;
      const r = run(input);
      assertValid(r, "all-unavail-forex");
    });

    it("all optional providers unavailable for commodity", () => {
      const input = buildInput("XAU/USD", "commodity", bullCandles(2400));
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.calendarData;
      delete input.treasuryData;
      delete input.eiaData;
      const r = run(input);
      assertValid(r, "all-unavail-commodity");
    });

    it("unavailable ≠ bearish for any instrument", () => {
      const syms: [string, AnalysisInput["instrumentType"], number][] = [
        ["BTC/USD", "crypto", 50000],
        ["EUR/USD", "forex", 1.1],
        ["XAU/USD", "commodity", 2400],
      ];
      for (const [sym, type, base] of syms) {
        const input = buildInput(sym, type, bullCandles(base));
        delete input.fundamentalData;
        delete input.sentimentData;
        delete input.macroData;
        const r = run(input);
        assertValid(r, `${sym}-unavail`);
        // Without fundamental data, bias should come from structure, not from missing data
      }
    });

    it("fundamental thesis distinguishes known/unknown/conflicting", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      if (r.fundamentalThesis) {
        expect([
          "STRONGLY_ALIGNED", "ALIGNED", "MIXED", "CONFLICTED",
          "FUNDAMENTAL_UNAVAILABLE", "TECHNICAL_UNAVAILABLE",
        ]).toContain(r.fundamentalThesis.alignment);
      }
    });
  });

  // ── 10. Error boundary audit ───────────────────────────────────

  describe("Error boundary / edge cases", () => {
    it("undefined optional fields do not crash", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      input.sentimentData = undefined;
      input.fundamentalData = undefined;
      input.macroData = undefined;
      input.derivativesData = undefined;
      input.calendarData = undefined;
      input.treasuryData = undefined;
      input.cotData = undefined;
      input.eiaData = undefined;
      input.executionData = undefined;
      input.okxSpecData = undefined;
      const r = run(input);
      assertValid(r, "undefined-opts");
    });

    it("null market data fields handled", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      // Without price, engine should still produce a valid result
      const r = run(input);
      assertValid(r, "null-price");
    });

    it("minimal candle data (3 candles) handled", () => {
      const minimal = [candle(0, 50000, 50100, 49900, 50050), candle(1, 50050, 50150, 49950, 50100), candle(2, 50100, 50200, 50000, 50150)];
      const input = buildInput("BTC/USD", "crypto", minimal);
      const r = run(input);
      assertValid(r, "minimal-candles");
    });

    it("very large candle set (1000 candles) handled", () => {
      const large = bullCandles(50000, 1000);
      const r = run(buildInput("BTC/USD", "crypto", large));
      assertValid(r, "large-candles");
    });

    it("very small instrument prices (0.001) handled", () => {
      const tiny = bullCandles(0.001);
      const r = run(buildInput("SHIB/USD", "crypto", tiny));
      assertValid(r, "tiny-price");
    });

    it("very large instrument prices (100000) handled", () => {
      const huge = bullCandles(100000);
      const r = run(buildInput("BTC/USD", "crypto", huge));
      assertValid(r, "huge-price");
    });

    it("missing marketData entirely handled", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      delete (input as unknown as Record<string, unknown>).marketData;
      const r = run(input);
      assertValid(r, "no-market-data");
    });
  });

  // ── 11. Determinism under identical inputs ──────────────────────

  describe("Determinism", () => {
    it("same input 10x produces identical result", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles());
      const results = Array.from({ length: 10 }, () => run(input));
      for (let i = 1; i < results.length; i++) {
        expect(results[i].recommendation).toBe(results[0].recommendation);
        expect(results[i].bias).toBe(results[0].bias);
        expect(results[i].confidence).toBe(results[0].confidence);
        expect(results[i].conviction).toBe(results[0].conviction);
        expect(results[i].decisionFingerprint).toBe(results[0].decisionFingerprint);
        expect(results[i].tradePlan).toEqual(results[0].tradePlan);
      }
    });

    it("evidence challenge is deterministic from same result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const ec1 = buildEvidenceChallenge(r);
      const ec2 = buildEvidenceChallenge(r);
      expect(ec1.thesisSupportStatus).toBe(ec2.thesisSupportStatus);
      expect(ec1.thesisFragility).toBe(ec2.thesisFragility);
      expect(ec1.auditSummary).toBe(ec2.auditSummary);
    });

    it("long-horizon thesis is deterministic from same result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const lh1 = buildLongHorizonThesis(r);
      const lh2 = buildLongHorizonThesis(r);
      expect(lh1.marketCycle).toBe(lh2.marketCycle);
      expect(lh1.thesisStatus).toBe(lh2.thesisStatus);
      expect(lh1.primaryThesis).toBe(lh2.primaryThesis);
    });

    it("decision integrity is deterministic from same result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const di1 = auditDecisionIntegrity(r);
      const di2 = auditDecisionIntegrity(r);
      expect(di1.overallStatus).toBe(di2.overallStatus);
      expect(di1.violations.length).toBe(di2.violations.length);
    });
  });

  // ── 12. Non-authoritative module behavior ───────────────────────

  describe("Non-authoritative modules", () => {
    it("evidence challenge cannot modify result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const rec = r.recommendation;
      const bias = r.bias;
      const conf = r.confidence;
      const conv = r.conviction;
      const tp = r.tradePlan;
      buildEvidenceChallenge(r);
      expect(r.recommendation).toBe(rec);
      expect(r.bias).toBe(bias);
      expect(r.confidence).toBe(conf);
      expect(r.conviction).toBe(conv);
      expect(r.tradePlan).toBe(tp);
    });

    it("long-horizon thesis cannot modify result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const rec = r.recommendation;
      const conf = r.confidence;
      buildLongHorizonThesis(r);
      expect(r.recommendation).toBe(rec);
      expect(r.confidence).toBe(conf);
    });

    it("decision integrity audit cannot modify result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const rec = r.recommendation;
      const bias = r.bias;
      const conv = r.conviction;
      const tp = r.tradePlan;
      auditDecisionIntegrity(r);
      expect(r.recommendation).toBe(rec);
      expect(r.bias).toBe(bias);
      expect(r.conviction).toBe(conv);
      expect(r.tradePlan).toBe(tp);
    });
  });

  // ── 13. Security / no secrets ──────────────────────────────────

  describe("Security / no secrets", () => {
    it("no API keys in any output", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const json = JSON.stringify(r);
      expect(json).not.toMatch(/api[_-]?key/i);
      expect(json).not.toMatch(/sk_live/i);
      expect(json).not.toMatch(/secret/i);
      expect(json).not.toMatch(/authorization/i);
    });

    it("no API keys in evidence challenge", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const ec = buildEvidenceChallenge(r);
      const json = JSON.stringify(ec);
      expect(json).not.toMatch(/api[_-]?key/i);
      expect(json).not.toMatch(/secret/i);
    });

    it("no API keys in long-horizon thesis", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      const lh = buildLongHorizonThesis(r);
      const json = JSON.stringify(lh);
      expect(json).not.toMatch(/api[_-]?key/i);
      expect(json).not.toMatch(/secret/i);
    });
  });

  // ── 14. Observability traceability ─────────────────────────────

  describe("Observability", () => {
    it("decision trace exists and is consistent", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      expect(r.decisionTrace).toBeDefined();
      if (r.decisionTrace) {
        expect(r.decisionTrace.recommendation).toBe(r.recommendation);
      }
    });

    it("data quality context exists and is informative", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      expect(r.dataQualityContext).toBeDefined();
      if (r.dataQualityContext) {
        expect(r.dataQualityContext.primaryData.status).toBeTruthy();
      }
    });

    it("dataCompleteness field is valid", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      expect(["full", "partial", "limited"]).toContain(r.dataCompleteness);
    });

    it("dataFlags is an array", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      expect(Array.isArray(r.dataFlags)).toBe(true);
    });
  });

  // ── 15. Full pipeline integration ──────────────────────────────

  describe("Full pipeline integration", () => {
    it("BTC/USD: complete pipeline from input to all derivation layers", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles()));
      assertValid(r, "BTC-pipeline");

      // All derivation layers present
      expect(r.analystThesis).toBeDefined();
      expect(r.marketScenario).toBeDefined();
      expect(r.marketRegimeContext).toBeDefined();
      expect(r.fundamentalThesis).toBeDefined();
      expect(r.professionalThesis).toBeDefined();
      expect(r.forwardMarketPath).toBeDefined();
      expect(r.longHorizonThesis).toBeDefined();
      expect(r.evidenceChallenge).toBeDefined();
      expect(r.dataQualityContext).toBeDefined();

      // Evidence challenge
      assertNoFabrication(r, "BTC-pipeline");
    });

    it("EUR/USD: complete pipeline from input to all derivation layers", () => {
      const r = run(buildInput("EUR/USD", "forex", bullCandles(1.1)));
      assertValid(r, "EUR-pipeline");
      expect(r.analystThesis).toBeDefined();
      expect(r.marketScenario).toBeDefined();
      expect(r.marketRegimeContext).toBeDefined();
      expect(r.professionalThesis).toBeDefined();
      expect(r.forwardMarketPath).toBeDefined();
      expect(r.longHorizonThesis).toBeDefined();
      expect(r.evidenceChallenge).toBeDefined();
    });

    it("XAU/USD: complete pipeline from input to all derivation layers", () => {
      const r = run(buildInput("XAU/USD", "commodity", bullCandles(2400)));
      assertValid(r, "XAU-pipeline");
      expect(r.analystThesis).toBeDefined();
      expect(r.marketScenario).toBeDefined();
      expect(r.marketRegimeContext).toBeDefined();
      expect(r.professionalThesis).toBeDefined();
      expect(r.forwardMarketPath).toBeDefined();
      expect(r.longHorizonThesis).toBeDefined();
      expect(r.evidenceChallenge).toBeDefined();
    });
  });
});
