import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runProductionWalkForwardBacktest } from "./walk-forward";
import type { InstrumentType, Timeframe } from "@/types/analysis";
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

async function loadYahooIntradayCandles(interval: "15m" | "60m"): Promise<OhlcvCandle[]> {
  const period2 = Math.floor(Date.now() / 1000);
  // Yahoo's intraday retention is limited. A common 60-day window keeps both
  // intervals comparable and makes the evidence reproducible within provider limits.
  const period1 = period2 - 59 * 24 * 60 * 60;
  const endpoint = new URL("https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD");
  endpoint.searchParams.set("period1", String(period1));
  endpoint.searchParams.set("period2", String(period2));
  endpoint.searchParams.set("interval", interval);
  endpoint.searchParams.set("events", "history");

  const response = await fetch(endpoint, {
    headers: { "User-Agent": "trade-intel-bot-intraday-walk-forward/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BTC-USD ${interval}: Yahoo Finance HTTP ${response.status}`);
  const payload = await response.json() as YahooChartResponse;
  if (payload.chart?.error) {
    throw new Error(`BTC-USD ${interval}: Yahoo Finance error ${payload.chart.error.code ?? ""} ${payload.chart.error.description ?? ""}`);
  }

  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  if (!quote || timestamps.length === 0) {
    throw new Error(`BTC-USD ${interval}: historical provider returned no intraday OHLCV candles`);
  }

  let rejectedRows = 0;
  const candles = timestamps.flatMap((timestamp, index): OhlcvCandle[] => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    if (![open, high, low, close, volume].every((value) => typeof value === "number" && Number.isFinite(value))) {
      rejectedRows++;
      return [];
    }
    const o = open as number;
    const h = high as number;
    const l = low as number;
    const c = close as number;
    const v = volume as number;
    if (
      !Number.isFinite(timestamp) || timestamp <= 0 ||
      Math.min(o, h, l, c) <= 0 || v < 0 ||
      h < Math.max(o, c, l) || l > Math.min(o, c, h)
    ) {
      rejectedRows++;
      return [];
    }
    return [{ timestamp: timestamp * 1000, open: o, high: h, low: l, close: c, volume: v }];
  }).sort((a, b) => a.timestamp - b.timestamp);

  console.log(`YAHOO_INTRADAY_VALIDATION ${JSON.stringify({
    symbol: "BTC-USD", interval, providerRows: timestamps.length,
    acceptedRows: candles.length, rejectedMalformedRows: rejectedRows,
  })}`);
  if (candles.length < 300) {
    throw new Error(`BTC-USD ${interval}: only ${candles.length} valid candles; at least 300 required`);
  }
  return candles;
}

/** Aggregate completed hourly bars into UTC-aligned H4 bars; never synthesize OHLC prices. */
function aggregateHourlyToH4(hourly: OhlcvCandle[]): OhlcvCandle[] {
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const groups = new Map<number, OhlcvCandle[]>();
  for (const candle of hourly) {
    const bucket = Math.floor(candle.timestamp / fourHoursMs) * fourHoursMs;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([timestamp, group]): OhlcvCandle[] => {
      group.sort((a, b) => a.timestamp - b.timestamp);
      // Discard incomplete buckets (including the currently forming H4 candle).
      if (group.length !== 4) return [];
      for (let i = 1; i < group.length; i++) {
        if (group[i].timestamp - group[i - 1].timestamp !== 60 * 60 * 1000) return [];
      }
      return [{
        timestamp,
        open: group[0].open,
        high: Math.max(...group.map((c) => c.high)),
        low: Math.min(...group.map((c) => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, c) => sum + c.volume, 0),
      }];
    });
}

/** Aggregate only complete, contiguous hourly bars into UTC-aligned daily bars. */
function aggregateHourlyToD1(hourly: OhlcvCandle[]): OhlcvCandle[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const groups = new Map<number, OhlcvCandle[]>();
  for (const candle of hourly) {
    const bucket = Math.floor(candle.timestamp / dayMs) * dayMs;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([timestamp, group]): OhlcvCandle[] => {
      group.sort((a, b) => a.timestamp - b.timestamp);
      if (group.length !== 24) return [];
      for (let i = 1; i < group.length; i++) {
        if (group[i].timestamp - group[i - 1].timestamp !== 60 * 60 * 1000) return [];
      }
      return [{
        timestamp,
        open: group[0].open,
        high: Math.max(...group.map((c) => c.high)),
        low: Math.min(...group.map((c) => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((sum, c) => sum + c.volume, 0),
      }];
    });
}

describe.runIf(enabled)("REAL MARKET intraday walk-forward (Yahoo Finance BTC-USD)", () => {
  it("runs the production analysis engine on M15, H1 and H4 data", async () => {
    const [m15, hourly] = await Promise.all([
      loadYahooIntradayCandles("15m"),
      loadYahooIntradayCandles("60m"),
    ]);
    const h4 = aggregateHourlyToH4(hourly);
    const d1 = aggregateHourlyToD1(hourly);
    const datasets: Array<{
      timeframe: Timeframe;
      candles: OhlcvCandle[];
      source: string;
      higherTimeframe: Timeframe;
      higherTimeframeCandles: OhlcvCandle[];
    }> = [
      { timeframe: "M15", candles: m15, source: "Yahoo Finance 15m", higherTimeframe: "H1", higherTimeframeCandles: hourly },
      { timeframe: "H1", candles: hourly, source: "Yahoo Finance 60m", higherTimeframe: "H4", higherTimeframeCandles: h4 },
      { timeframe: "H4", candles: h4, source: "H4 aggregated from four completed Yahoo Finance 60m candles", higherTimeframe: "D1", higherTimeframeCandles: d1 },
    ];

    for (const dataset of datasets) {
      expect(dataset.candles.length, `${dataset.timeframe} should have sufficient completed history`).toBeGreaterThanOrEqual(300);
      const outOfSampleStartIndex = Math.max(220, dataset.candles.length - 120);
      const report = runProductionWalkForwardBacktest({
        instrument: "BTC/USD",
        instrumentType: "crypto" satisfies InstrumentType,
        timeframe: dataset.timeframe,
        candles: dataset.candles,
        higherTimeframe: dataset.higherTimeframe,
        higherTimeframeCandles: dataset.higherTimeframeCandles,
        options: {
          minimumHistory: 220,
          outOfSampleStartIndex,
          maxHoldingBars: dataset.timeframe === "M15" ? 32 : dataset.timeframe === "H1" ? 24 : 12,
          costBpsPerSide: 10,
        },
      });

      const evidence = {
        provider: "Yahoo Finance chart API",
        symbol: "BTC-USD",
        timeframe: dataset.timeframe,
        source: dataset.source,
        firstCandleUtc: new Date(dataset.candles[0].timestamp).toISOString(),
        lastCandleUtc: new Date(dataset.candles[dataset.candles.length - 1].timestamp).toISOString(),
        candleCount: dataset.candles.length,
        outOfSampleStartIndex,
        outOfSampleCandleCount: dataset.candles.length - outOfSampleStartIndex,
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
        `artifacts/real-market-walk-forward/BTC-USD-${dataset.timeframe}.json`,
        JSON.stringify({ ...evidence, candles: dataset.candles }, null, 2) + "\n",
        "utf8",
      );
      console.log(`REAL_INTRADAY_WALK_FORWARD ${JSON.stringify(evidence)}`);

      expect(report.candleCount).toBe(dataset.candles.length);
      expect(report.signalsChecked).toBeGreaterThan(0);
      expect(report.noTradeSignals + report.executedTrades).toBeLessThanOrEqual(report.signalsChecked);
      expect(Number.isFinite(report.maxDrawdownR)).toBe(true);
      expect(Number.isFinite(report.totalNetReturnPct)).toBe(true);
    }
  }, 240_000);
});
