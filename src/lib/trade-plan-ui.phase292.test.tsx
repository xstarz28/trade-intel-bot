/**
 * Phase 292 — the risk plan as the USER sees it, and as the next layer reads it.
 *
 * Two integration surfaces, one invariant: NOTHING is recomputed downstream.
 *
 *   · `AnalysisResultDisplay` renders the engine's own published values —
 *     entry (market reference + setup verdict), stop (with the invalidation
 *     LEVEL and the buffer, separately), target (with its provenance), the R:R
 *     measured from those levels, and the sizing card only when it is genuinely
 *     computable. No contradictory combination can be assembled from these
 *     fields, and an unavailable size is never rendered as a number.
 *   · `buildCandidateFromSource` (recommendation/radar entry) reads
 *     `tradePlan.riskReward` verbatim — the published ratio, not a re-derived
 *     one — so the Phase 292 R:R correction propagates instead of being undone.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AnalysisResultDisplay } from "@/components/AnalysisResult";
import { runAnalysis } from "@/lib/analysis-engine";
import { buildCandidateFromSource } from "@/lib/liveCandidateBuilder";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { calculateTechnical } from "@/lib/data/technical";
import { computeSmcContext } from "@/lib/data/smc";
import { I18nProvider } from "@/lib/i18n";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { InstrumentSpec } from "@/lib/risk";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

// ── Designed fixture (test-only series) ───────────────────────────
const T0 = Date.now() - 199 * 4 * 3600_000;
const TS = (i: number) => T0 + i * 4 * 3600_000;

function designedUptrendSeries(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: TS(i), open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(i, p - 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(i, p - 0.5, p + 0.5, p - 1, p); }
  push(125, 169, 169.5, 167, 168);
  for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(i, p + 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(i, p - 0.3, p + 0.5, p - 0.9, p); }
  for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(i, p + 0.3, p + 0.7, p - 0.7, p); }
  for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(i, p - 0.2, p + 0.4, p - 0.5, p); }
  return out;
}

const SERIES = designedUptrendSeries();
const LAST = SERIES[SERIES.length - 1];

const COMPLETE_SPEC: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 100000,
  quoteCurrency: "USD",
  tickSize: 0.00001,
  quantityStep: 0.01,
  minQuantity: 0.01,
  source: "test-broker specification",
};

function techFor(candles: OhlcvCandle[]): TechnicalData {
  const smc = computeSmcContext(candles, "H4");
  return {
    ...calculateTechnical(candles, candles, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
    ]),
  };
}

function inputFor(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    instrument: "TEST/USD",
    instrumentType: "forex",
    timeframe: "H4" as Timeframe,
    provider: "fixture",
    providerInstrumentId: "TEST/USD",
    marketData: {
      instrument: "TEST/USD",
      instrumentType: "forex",
      provider: "fixture",
      providerInstrumentId: "TEST/USD",
      fetchTimestamp: LAST.timestamp,
      price: { price: LAST.close, timestamp: LAST.timestamp, source: "fixture" },
      candles: SERIES,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: techFor(SERIES),
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...overrides,
  } as AnalysisInput;
}

const SIZED = runAnalysis(
  inputFor({ accountEquity: 10_000_000, riskPercent: 0.01, instrumentSpec: COMPLETE_SPEC }),
);
const UNSIZED = runAnalysis(inputFor());

/**
 * An honest NO_TRADE variant: the same candles with no opposing structural
 * level anywhere, so the target gate refuses instead of inventing a level.
 */
const NO_PLAN = runAnalysis(
  inputFor({
    technicalData: (() => {
      const smc = computeSmcContext(SERIES, "H4");
      return {
        ...techFor(SERIES),
        swingHighs: [],
        resistanceLevels: [],
        smc: { ...smc, liquidityPools: [], orderBlocks: [], fvgs: [] },
        mtf: undefined,
      } as TechnicalData;
    })(),
  }),
);

function renderResult(result: typeof SIZED) {
  return render(
    React.createElement(I18nProvider, null, React.createElement(AnalysisResultDisplay, { result })),
  );
}

/** Everything rendered, as one searchable string (assertions target the exact
 *  engine values, wherever the card layout puts them). */
function bodyText(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

// ── A. The rendered plan is the engine's plan ─────────────────────

describe("Phase 292 — the UI renders the published plan, nothing else", () => {
  it("shows the exact published entry, stop, target and R:R", () => {
    const plan = SIZED.tradePlan!;
    renderResult(SIZED);
    const text = bodyText();
    expect(text).toContain(plan.entry);
    expect(text).toContain(plan.stopLoss);
    expect(text).toContain(plan.takeProfit);
    expect(text).toContain(plan.riskReward.toFixed(2));
    cleanup();
  });

  it("shows the invalidation level and the buffer separately from the published stop", () => {
    const plan = SIZED.tradePlan!;
    const sp = plan.stopProvenance!;
    renderResult(SIZED);
    const text = bodyText();
    // The raw market-derived level AND the protective stop are both named.
    expect(text).toContain(String(sp.level));
    expect(text).toContain(plan.stopLoss);
    expect(text).toContain("protective buffer");
    expect(text).toContain("structural invalidation");
    expect(text).toContain(plan.structuralInvalidation!.note);
    cleanup();
  });

  it("separates the published ratio from the ratio at the raw invalidation level", () => {
    const plan = SIZED.tradePlan!;
    renderResult(SIZED);
    const text = bodyText();
    expect(text).toContain(`R:R ${plan.riskReward.toFixed(2)} measured from the published entry, stop and target`);
    if (plan.structuralRiskReward !== undefined) {
      expect(text).toContain(`${plan.structuralRiskReward.toFixed(2)} at the raw invalidation level`);
    }
    cleanup();
  });

  it("never presents the entry price as a confirmed trigger", () => {
    const ctx = SIZED.tradePlan!.entryContext!;
    renderResult(SIZED);
    const text = bodyText();
    expect(text).toContain("market reference");
    expect(text).toContain("not a filled order");
    if (ctx.triggerConfirmed) {
      expect(text).toContain("CONFIRMED_SETUP_CONTEXT at the reference price");
    } else {
      expect(text).toContain("no confirmed trigger at the reference price");
      expect(text).toContain(ctx.setupState ?? "no setup context");
    }
    // The verdict rendered is the engine's own flag, not a UI guess.
    expect(text.includes("CONFIRMED_SETUP_CONTEXT at the reference price")).toBe(ctx.triggerConfirmed);
    cleanup();
  });

  it("shows the target's provenance and timeframe", () => {
    const tp = UNSIZED.tradePlan!.targetProvenance!;
    renderResult(UNSIZED);
    const text = bodyText();
    expect(text).toContain(tp.note);
    expect(text).toContain(String(tp.level));
    cleanup();
  });
});

// ── B. Sizing surface ─────────────────────────────────────────────

describe("Phase 292 — the sizing surface never shows an uncomputed size", () => {
  it("renders the exact computed quantity and its provenance when available", () => {
    const s = SIZED.positionSizing!;
    expect(s.available).toBe(true);
    renderResult(SIZED);
    const text = bodyText();
    expect(text).toContain(String(s.quantity));
    expect(text).toContain(s.quantityUnit!);
    expect(text).toContain(`spec source: ${s.specificationSource}`);
    expect(text).toContain((s.appliedRiskPercent! * 100).toFixed(2));
    cleanup();
  });

  it("renders NO quantity when sizing is unavailable — and explains why", () => {
    expect(UNSIZED.positionSizing).toBeUndefined();
    renderResult(UNSIZED);
    const text = bodyText();
    // The sizing CARD is absent: no quantity label, no unit, no risk-per-unit.
    expect(text).not.toContain("risk / unit");
    expect(text).not.toContain("at 1.00% risk");
    // No fabricated zero quantity anywhere.
    expect(text).not.toMatch(/quantity[^A-Za-z]{0,12}0\b/i);
    // The reason is stated in the risk note instead.
    expect(UNSIZED.riskNote).toMatch(/Position sizing unavailable|cannot compute position size/);
    expect(text).toContain(UNSIZED.riskNote!.slice(0, 40));
    cleanup();
  });

  it("a NO_TRADE result renders neither a plan nor a size", () => {
    expect(NO_PLAN.recommendation).toBe("NO_TRADE");
    renderResult(NO_PLAN);
    const text = bodyText();
    // No plan card and no sizing card — only the honest no-trade explanation
    // (which is allowed to SAY that an R:R could not be computed).
    expect(text).not.toContain("measured from the published entry, stop and target");
    expect(text).not.toContain("risk / unit");
    expect(text).toContain("No opposing structural level available to define a take profit");
    expect(text).toContain("NO_TRADE");
    cleanup();
  });

  it("keeps the risk note's invalidation sentence aligned with the plan", () => {
    renderResult(SIZED);
    const text = bodyText();
    const sp = SIZED.tradePlan!.stopProvenance!;
    expect(text).toContain(SIZED.riskNote!.slice(0, 30));
    expect(SIZED.riskNote).toContain(String(sp.level));
    cleanup();
  });
});

// ── C. Downstream consumption — recommendation / radar entry ──────

describe("Phase 292 — the recommendation layer consumes the published R:R", () => {
  const candidateFor = (result: typeof SIZED) =>
    buildCandidateFromSource(
      {
        instrument: "TEST/USD",
        assetClass: "forex",
        marketData: result.priceSnapshot
          ? {
              instrument: "TEST/USD",
              instrumentType: "forex",
              provider: "fixture",
              providerInstrumentId: "TEST/USD",
              fetchTimestamp: result.priceSnapshot.timestamp,
              price: result.priceSnapshot,
              candles: SERIES,
              timeframe: "H4",
              dataFreshness: "delayed",
            } as MarketData
          : undefined,
        technicalData: result.technicalData,
        analysisResult: result,
      },
      Date.now(),
    );

  it("carries the published ratio verbatim — including the Phase 292 correction", () => {
    const plan = SIZED.tradePlan!;
    const c = candidateFor(SIZED);
    expect(c.riskReward).toBe(plan.riskReward);
    // And it is NOT the raw-invalidation ratio the fix replaced.
    if (plan.structuralRiskReward !== undefined) {
      expect(c.riskReward).not.toBe(plan.structuralRiskReward);
    }
    // The published entry/stop still define the risk the ratio describes.
    const entry = parseFloat(plan.entry);
    const stop = parseFloat(plan.stopLoss);
    const target = parseFloat(plan.takeProfit);
    expect(c.riskReward).toBeCloseTo(Math.abs(target - entry) / Math.abs(entry - stop), 2);
  });

  it("risk values never become directional evidence in the candidate", () => {
    const c = candidateFor(SIZED);
    const noPlan = candidateFor(NO_PLAN);
    expect(noPlan.riskReward).toBeUndefined();
    // The setup evidence the ranking uses comes from Phase 291, untouched by risk.
    expect(c.setupContextState).toBe(SIZED.tradeLocation!.context.state);
    expect(c.setupDirection).toBe(SIZED.tradeLocation!.context.direction);
  });
});
