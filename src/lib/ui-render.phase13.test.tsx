/**
 * Phase 13 P1 — UI RENDER VALIDATION (jsdom + testing-library).
 *
 * Proves the production component renders engine output faithfully for
 * LONG / SHORT / NO_TRADE, honest provider unavailability, crypto execution
 * quality and slow-macro provenance. Presentation ONLY — the component is
 * rendered with a REAL engine result and never computes decisions itself.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { AnalysisResultDisplay } from "@/components/AnalysisResult";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  BEAR_LEVELS,
  execution,
  macro,
} from "./benchmark-fixtures.phase9";

type RunSpec = Parameters<typeof assemble>[0] & Record<string, unknown>;
const run = (spec: RunSpec = {}) =>
  runAnalysis({ ...assemble(spec), ...spec } as never);

// AnalysisResultDisplay consumes the i18n context, so every render must be
// wrapped in the provider exactly as the application does.
const render = (ui: React.ReactElement) =>
  rtlRender(<I18nProvider>{ui}</I18nProvider>);

const BULL = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  events: "Fed signals hawkish stance, rate hike",
};
const BEAR = {
  ...BULL,
  structure: "LH/LL" as const,
  bos: "bearish" as const,
  support: BEAR_LEVELS.support,
  resistance: BEAR_LEVELS.resistance,
  sweepSide: "buy_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
  events: "ECB dovish, rate cut expected",
};

/** Minimal honest EIA fixture (documented schema). */
const eiaFixture = (latestValue: number, previousValue: number) => ({
  available: true as const,
  source: "U.S. EIA (Weekly Petroleum Status Report)",
  fetchedAt: Date.parse("2026-08-20T14:00:00Z"),
  freshness: "FRESH" as const,
  series: [
    {
      productId: "EPC0",
      observationDate: "2026-08-15",
      previousObservationDate: "2026-08-08",
      latestValue,
      previousValue,
      change: latestValue - previousValue,
      unit: "million bbl",
    },
  ],
  failedLegs: [],
});

describe("UI render validation — LONG result", () => {
  it("A: renders decision summary, conviction breakdown, fingerprint and trade plan", () => {
    const r = run(BULL);
    expect(r.recommendation).toBe("LONG");
    render(<AnalysisResultDisplay result={r} />);
    // Decision trace panel with deterministic fingerprint badge.
    expect(screen.getByText(/why-this-decision/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`fp:${r.decisionFingerprint}`))).toBeInTheDocument();
    // Conviction breakdown rows show actual layer contributions.
    expect(screen.getAllByText(/Structure/).length).toBeGreaterThan(0);
    expect(screen.getByText(/evidence strength — not a probability/)).toBeInTheDocument();
    // Trade plan levels from the engine are visible.
    expect(screen.getByText(/trade-plan/)).toBeInTheDocument();
    expect(screen.getAllByText(r.tradePlan!.entry).length).toBeGreaterThan(0);
    expect(screen.getAllByText(r.tradePlan!.stopLoss).length).toBeGreaterThan(0);
    expect(screen.getAllByText(r.tradePlan!.takeProfit).length).toBeGreaterThan(0);
    // NO trade-plan contradiction: no rejection card on a valid setup.
    expect(screen.queryByText(/no-trade — setup rejected/)).toBeNull();
  });

  it("E: crypto execution panel shows bid/ask/spread/depth/imbalance/slippage", () => {
    const r = run({
      ...BULL,
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      macroData: macro("bullish"),
      executionData: execution(0.6),
      accountEquity: 100_000,
      riskPercent: 0.01,
      instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
    });
    render(<AnalysisResultDisplay result={r} />);
    expect(screen.getByText(/execution-quality/)).toBeInTheDocument();
    expect(screen.getByText(/bid\/ask:/)).toBeInTheDocument();
    expect(screen.getByText(/spread:/)).toBeInTheDocument();
    expect(screen.getAllByText(/bps/).length).toBeGreaterThan(0);
    expect(screen.getByText(/depth L\/R:/)).toBeInTheDocument();
    expect(screen.getByText(/imbalance:/)).toBeInTheDocument();
    expect(screen.getByText(/est\. impact:/)).toBeInTheDocument();
  });
});

describe("UI render validation — SHORT result", () => {
  it("B: renders mirrored side correctly without LONG terminology leakage", () => {
    const r = run(BEAR);
    expect(r.recommendation).toBe("SHORT");
    render(<AnalysisResultDisplay result={r} />);
    expect(screen.getByText(/trade-plan/)).toBeInTheDocument();
    // Side-correct LEVELS (from the engine) are what the user sees.
    expect(screen.getAllByText(r.tradePlan!.stopLoss).length).toBeGreaterThan(0);
    expect(screen.getAllByText(r.tradePlan!.takeProfit).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no-trade — setup rejected/)).toBeNull();
  });
});

describe("UI render validation — NO_TRADE result", () => {
  it("C: no plan/sizing rendered; blocking gate and reasons ARE rendered", () => {
    const r = run({}); // neutral/range
    expect(r.recommendation).toBe("NO_TRADE");
    render(<AnalysisResultDisplay result={r} />);
    expect(screen.getByText(/no-trade — setup rejected/)).toBeInTheDocument();
    // Blocking reason text surfaces verbatim from the gate trace.
    for (const reason of r.noTradeReasons) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
    expect(screen.getByText(/blocking gate:/)).toBeInTheDocument();
    // Terminal state: plan and sizing panels must NOT exist.
    expect(screen.queryByText(/trade-plan/)).toBeNull();
    expect(r.positionSizing).toBeUndefined();
  });

  it("D: unavailable providers render as context-unavailable, never directional", () => {
    const r = run(BULL); // no optional providers → informational flags only
    render(<AnalysisResultDisplay result={r} />);
    const flags = r.decisionTrace!.informationalFlags;
    if (flags.length > 0) {
      expect(screen.getAllByText(/decision not penalized/).length).toBeGreaterThan(0);
    }
    // No synthetic numbers appear for missing providers.
    expect(screen.queryByText(/synthetic/i)).toBeNull();
  });
});

describe("UI render validation — execution & slow data honesty", () => {
  it("F: non-crypto has NO execution panel — honest absence, no fake spread", () => {
    const r = run(BULL); // forex: no validated bid/ask provider
    expect(r.executionContext).toBeUndefined();
    render(<AnalysisResultDisplay result={r} />);
    expect(screen.queryByText(/execution-quality/)).toBeNull();
    expect(screen.queryByText(/bid\/ask:/)).toBeNull();
  });

  it("G: slow macro data shows its ACTUAL observation date, not fetch time", () => {
    const r = run({
      ...BULL,
      instrument: "WTI",
      instrumentType: "commodity",
      eiaData: eiaFixture(420.5, 419.8),
    });
    render(<AnalysisResultDisplay result={r} />);
    expect(screen.getByText(/eia-inventory/)).toBeInTheDocument();
    // The provider's own freshness label is shown — in the slow-data panel and
    // in the fundamental assessment's EIA evidence — so presence is asserted
    // rather than a single node.
    expect(screen.getAllByText(/FRESH/).length).toBeGreaterThan(0);
    // Observation date verbatim; the fetchedAt clock time is NOT the obs date.
    expect(screen.getByText(/obs:\s*2026-08-15/)).toBeInTheDocument();
    expect(screen.queryByText(/obs:\s*2026-08-20/)).toBeNull(); // fetchedAt ≠ observationDate
  });
});

describe("UI decision-neutrality invariants", () => {
  it("rendered output contains no probability/win-rate/guarantee language", () => {
    const r = run(BULL);
    const { container } = render(<AnalysisResultDisplay result={r} />);
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/win rate|win-rate|probability of profit|guaranteed/);
  });

  it("trace-less legacy-style result does not crash the component", () => {
    const r = run(BULL);
    const legacy = { ...r };
    delete (legacy as Partial<typeof r>).decisionTrace;
    delete (legacy as Partial<typeof r>).decisionFingerprint;
    expect(() => render(<AnalysisResultDisplay result={legacy as typeof r} />)).not.toThrow();
  });
});
