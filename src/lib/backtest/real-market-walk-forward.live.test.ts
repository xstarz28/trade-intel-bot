import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runProductionWalkForwardBacktest } from "./walk-forward";
import type { InstrumentType } from "@/types/analysis";
import type { OhlcvCandle } from "@/lib/data/market-types";

const enabled = process.env.RUN_REAL_MARKET_WALK_FORWARD === "1";

type YahooChartResponse = {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    } | null>;
  };
};

const markets: Array<{ symbol: string; instrument: string; type: InstrumentType }> = [
  { symbol: "AAPL", instrument: "AAPL", type: "stock" },
  { symbol: "SPY", instrument: "SPY", type: "indices" },
  { symbol: "BTC-USD", instrument: "BTC/USD", type: "crypto" },
  { symbol: "EURUSD=X", instrument: "EUR/USD", type: "forex" },
  { symbol: "GC=F", instrument: "XAU/USD", type: "commodity" },
];

async function loadYahooDailyCandles(symbol: string): Promise<OhlcvCandle[]> {
  const period2 = Math.floor(Date.now() / 1000);
  // Five years of daily history broadens the sample across more market regimes.
  const period1 = period2 - 5 * 365 * 24 * 60 * 60;
  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  endpoint.searchParams.set("period1", String(period1));
  endpoint.searchParams.set("period2", String(period2));
  endpoint.searchParams.set("interval", "1d");
  endpoint.searchParams.set("events", "history");

  const response = await fetch(endpoint, {
    headers: { "User-Agent": "trade-intel-bot-real-market-walk-forward/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${symbol}: Yahoo Finance HTTP ${response.status}`);
  const payload = await response.json() as YahooChartResponse;
  if (payload.chart?.error) {
    throw new Error(`${symbol}: Yahoo Finance error ${payload.chart.error.code ?? ""} ${payload.chart.error.description ?? ""}`);
  }
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  if (!quote || timestamps.length === 0) throw new Error(`${symbol}: historical provider returned no daily OHLCV candles`);

  let invalidOhlcvRows = 0;
  const candles = timestamps.flatMap((timestamp, index): OhlcvCandle[] => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    if (![open, high, low, close, volume].every((value) => typeof value === "number" && Number.isFinite(value))) {
      invalidOhlcvRows++;
      return [];
    }

    // Reject malformed provider rows instead of inventing/correcting prices.
    const o = open as number;
    const h = high as number;
    const l = low as number;
    const c = close as number;
    const v = volume as number;
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      Math.min(o, h, l, c) <= 0 ||
      v < 0 ||
      h < Math.max(o, c, l) ||
      l > Math.min(o, c, h)
    ) {
      invalidOhlcvRows++;
      return [];
    }

    return [{
      timestamp: timestamp * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
    }];
  });

  console.log(`YAHOO_OHLCV_VALIDATION ${JSON.stringify({ symbol, providerRows: timestamps.length, acceptedRows: candles.length, rejectedMalformedRows: invalidOhlcvRows })}`);
  if (candles.length < 500) {
    throw new Error(`${symbol}: only ${candles.length} valid daily candles after rejecting ${invalidOhlcvRows} malformed rows; at least 500 required`);
  }
  return candles;
}

describe.runIf(enabled)("REAL MARKET walk-forward (Yahoo Finance daily OHLCV)", () => {
  it.each(markets)("$symbol: run production decision engine on real historical candles", async ({ symbol, instrument, type }) => {
    const candles = await loadYahooDailyCandles(symbol);
    // Score roughly two years out-of-sample; the earlier history is warm-up only.
    const outOfSampleStartIndex = Math.max(300, candles.length - 500);
    const report = runProductionWalkForwardBacktest({
      instrument,
      instrumentType: type,
      timeframe: "D1",
      candles,
      options: {
        minimumHistory: 220,
        outOfSampleStartIndex,
        maxHoldingBars: 20,
        // Conservative combined fee+slippage assumption per side; no leverage/funding is implied.
        costBpsPerSide: 10,
      },
    });

    const summary = {
      provider: "Yahoo Finance chart API",
      symbol,
      instrument,
      instrumentType: type,
      timeframe: "D1",
      firstCandleUtc: new Date(candles[0].timestamp).toISOString(),
      lastCandleUtc: new Date(candles[candles.length - 1].timestamp).toISOString(),
      candleCount: candles.length,
      outOfSampleStartIndex,
      outOfSampleCandleCount: candles.length - outOfSampleStartIndex,
      costs: { feeAndSlippageBpsPerSide: 10 },
      metrics: {
        signalsChecked: report.signalsChecked,
        noTradeSignals: report.noTradeSignals,
        noTradeReasonCounts: report.noTradeReasonCounts,
        rejectedPlans: report.rejectedPlans,
        executedTrades: report.executedTrades,
        winRatePct: report.winRatePct,
        expectancyR: report.expectancyR,
        profitFactor: report.profitFactor,
        maxDrawdownR: report.maxDrawdownR,
        totalNetReturnPct: report.totalNetReturnPct,
        averageNetReturnPct: report.averageNetReturnPct,
      },
      warnings: report.warnings,
    };
    await mkdir("artifacts/real-market-walk-forward", { recursive: true });
    await writeFile(
      `artifacts/real-market-walk-forward/${symbol.replace(/[^A-Za-z0-9_-]/g, "_")}.json`,
      JSON.stringify({ ...summary, candles }, null, 2) + "\n",
      "utf8",
    );
    console.log(`REAL_MARKET_WALK_FORWARD ${JSON.stringify(summary)}`);

    expect(report.candleCount).toBe(candles.length);
    expect(report.signalsChecked).toBeGreaterThan(0);
    expect(candles.length - outOfSampleStartIndex).toBeGreaterThanOrEqual(400);
    expect(report.warnings.some((warning) => warning.includes("Out-of-sample"))).toBe(true);
    expect(Number.isFinite(report.maxDrawdownR)).toBe(true);
    expect(Number.isFinite(report.totalNetReturnPct)).toBe(true);
  }, 120_000);
});
