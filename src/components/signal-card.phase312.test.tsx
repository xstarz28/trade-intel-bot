/**
 * PHASE 312 ADDENDUM — the signal card renders the coherent response:
 * chart (or the explicit unavailable state), WHY, TRADE PLAN, POSITION
 * MECHANICS, RISK + probability status, INVALIDATION, LIMITATIONS — with the
 * guaranteed-profit language ban enforced on the rendered output.
 *
 * Deterministic fixtures only; no Convex context (the journal enrichment
 * falls back to the assessment embedded in the signal — the same behaviour
 * the test pins).
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { SignalCard } from "./SignalCard";
import { SignalChartView } from "./SignalChartView";
import { buildSignalResponse } from "@/lib/strategy/signal";
import type { AnalysisResult } from "@/types/analysis";
import type { OhlcvCandle } from "@/lib/data/market-types";
import { buildStrategyContext } from "@/lib/strategy/context";
import { buildReasoningChain } from "@/lib/strategy/explanation";

const T0 = 1_760_000_000_000;
const STEP = 60_000; // minute steps for the M5 chart fixture

function candles(n: number): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o + 0.5;
    out.push({
      timestamp: T0 + i * STEP,
      open: o,
      high: c + 0.2,
      low: o - 0.2,
      close: c,
      volume: 1000,
    });
    price = c;
  }
  return out;
}

function resultFixture(tf: string, cdls: OhlcvCandle[]): AnalysisResult {
  const fixture = {
    id: "card-fixture",
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: tf,
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    bias: "Bullish",
    confidence: 72,
    recommendation: "LONG",
    noTradeReasons: [],
    tradePlan: {
      direction: "long",
      entry: "103.5",
      entryBasis: "live market price at analysis time",
      stopLoss: "102.00",
      slBasis: "nearest market swing low (structural)",
      takeProfit: "112.00",
      tpBasis: "resting liquidity at 112",
      riskReward: 5.66,
      stopProvenance: {
        source: "swing_level",
        level: 102,
        timeframe: tf,
        buffer: 0,
        publishedStop: 102,
        note: "nearest unbroken market swing low 102",
      },
      targetProvenance: {
        source: "resting_liquidity",
        level: 112,
        timeframe: tf,
        note: "resting liquidity at 112 (never a swept level)",
      },
      structuralInvalidation: {
        level: 102,
        timeframe: tf,
        swingKind: "low",
        note: "confirmed swing low 102 voids the bullish thesis",
      },
    },
    technicalData: {
      dataPoints: cdls.length,
      structure: "HH/HL",
      bosDirection: "bullish",
      strategy: buildStrategyContext(cdls, tf),
    },
    keyLevels: { support: "102", resistance: "112", invalidation: "102" },
    dataFlags: [],
  } as unknown as AnalysisResult;
  fixture.reasoningChain = buildReasoningChain(fixture);
  return fixture;
}

const BANNED = ["guaranteed profit", "full profit", "pasti menang", "safe leverage", "win probability"];

function buildSignal(cdls: OhlcvCandle[], outcomes?: { rMultiple: number }[]) {
  return buildSignalResponse({
    result: resultFixture("M5", cdls),
    candles: cdls,
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    policy: { accountEquity: 1000, maxRiskPercent: 0.02, accountCurrency: "USDT", productType: "spot" },
    spec: { assetClass: "crypto", contractSize: 1, quoteCurrency: "USDT", quantityStep: 0.1, source: "user-provided" },
    ...(outcomes
      ? {
          historicalOutcomes: outcomes.map((o) => ({
            instrument: "BTC/USDT",
            timeframe: "M5",
            direction: "long" as const,
            rMultiple: o.rMultiple,
          })),
        }
      : {}),
  });
}

describe("312 UI — signal card and chart", () => {
  it("renders the full card: chart, WHY, plan, mechanics, risk, invalidation, limitations", () => {
    const cdls = candles(40);
    const signal = buildSignal(cdls);
    const { container, getByTestId } = render(
      <I18nProvider>
        <SignalCard signal={signal} />
      </I18nProvider>,
    );
    expect(getByTestId("signal-card")).toBeDefined();
    expect(getByTestId("signal-chart")).toBeDefined();
    expect(getByTestId("signal-chart").querySelector("svg")).toBeTruthy();
    expect(getByTestId("signal-why").textContent).toContain("MARKET STRUCTURE");
    expect(getByTestId("signal-plan").textContent).toContain("R:R");
    expect(getByTestId("signal-plan").textContent).toContain("103.5");
    expect(getByTestId("signal-plan").textContent).toContain("112");
    expect(getByTestId("signal-position").textContent).toContain("never executed");
    expect(getByTestId("signal-position").textContent).toContain("USDT");
    expect(getByTestId("signal-risk").textContent).toContain("20");
    expect(getByTestId("signal-invalidation").textContent).toContain("102");
    expect(getByTestId("signal-limitations").textContent.length).toBeGreaterThan(10);
    // Provider-native identity + observedAt on the chart provenance line.
    expect(getByTestId("signal-chart-provenance").textContent).toContain("okx");
    expect(getByTestId("signal-chart-provenance").textContent).toContain("BTC-USDT");
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of BANNED) expect(text.includes(banned), banned).toBe(false);
    // literal NaN/Infinity values never render (case-sensitive: "fiNANcial" is fine)
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("Infinity");
  });

  it("renders the explicit chart-unavailable state for insufficient OHLCV", () => {
    const signal = buildSignal(candles(3));
    const { getByTestId } = render(
      <I18nProvider>
        <SignalChartView spec={signal.chart} />
      </I18nProvider>,
    );
    const node = getByTestId("signal-chart-unavailable");
    expect(node.textContent).toContain("Chart unavailable — insufficient OHLCV");
  });

  it("probability blocks: estimated shows figures + sample; limited shows count only; unavailable shows no figures", () => {
    const cdls = candles(30);
    const estimated = buildSignal(cdls, Array.from({ length: 12 }, (_, i) => ({ rMultiple: i % 3 === 0 ? -1 : 1.5 })));
    const a = render(
      <I18nProvider>
        <SignalCard signal={estimated} />
      </I18nProvider>,
    );
    expect(a.getByTestId("probability-estimated").textContent).toContain("12");
    expect(a.getByTestId("probability-estimated").textContent.toLowerCase()).toContain("hit rate");
    a.unmount();

    const limited = buildSignal(cdls, [{ rMultiple: 2 }, { rMultiple: -1 }, { rMultiple: 1 }]);
    const b = render(
      <I18nProvider>
        <SignalCard signal={limited} />
      </I18nProvider>,
    );
    expect(b.getByTestId("probability-limited").textContent).toContain("3");
    expect(b.getByTestId("probability-limited").textContent).not.toContain("%");
    b.unmount();

    const unavailable = buildSignal(cdls);
    const c = render(
      <I18nProvider>
        <SignalCard signal={unavailable} />
      </I18nProvider>,
    );
    expect(c.getByTestId("probability-unavailable").textContent).toContain("unavailable");
    c.unmount();
  });
});
