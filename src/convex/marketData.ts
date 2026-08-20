/**
 * Convex server-side market data proxy.
 * All logic is self-contained here to avoid transitive compilation issues.
 * API keys are read from environment variables, never exposed to the client.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

export const fetchMarketData = action({
  args: {
    instrument: v.string(),
    instrumentType: v.union(
      v.literal("forex"),
      v.literal("crypto"),
      v.literal("stock"),
      v.literal("commodity"),
      v.literal("indices"),
    ),
    timeframe: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error: "Market data provider not configured: TWELVE_DATA_API_KEY is missing. Add it in the Keys/API keys tab.",
        errorCode: "AUTH_ERROR" as const,
      };
    }

    const tf = mapTimeframe(args.timeframe);
    const symbol = args.instrument.toUpperCase().trim();

    try {
      // Fetch candles + price in parallel
      const [candlesRes, quoteRes] = await Promise.all([
        fetch(
          `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${tf}&outputsize=210&apikey=${apiKey}`
        ),
        fetch(
          `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
        ),
      ]);

      const candlesJson = await candlesRes.json();
      const quoteJson = await quoteRes.json();

      if (candlesJson.code) {
        return classifyError(candlesJson);
      }

      const values: any[] = candlesJson.values ?? [];
      if (values.length === 0) {
        return {
          success: false as const,
          error: `No candle data returned for ${symbol}. The symbol may not be supported.`,
          errorCode: "UNSUPPORTED_INSTRUMENT" as const,
        };
      }

      // Normalize candles (Twelve Data returns most-recent first)
      const candles = values
        .reverse()
        .map((c: any) => ({
          timestamp: new Date(c.datetime).getTime(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume) || 0,
        }));

      // Price
      const price = quoteJson.close ? parseFloat(quoteJson.close) : candles[candles.length - 1].close;
      const priceTimestamp = Date.now();

      // Calculate technical indicators from candles
      const technical = calculateAll(candles);

      // Optional: fetch D1 for higher-timeframe context
      let higherCandles: any[] | undefined;
      if (args.timeframe !== "D1" && args.timeframe !== "W1") {
        try {
          const htfRes = await fetch(
            `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=100&apikey=${apiKey}`
          );
          const htfJson = await htfRes.json();
          if (htfJson.values) {
            higherCandles = htfJson.values
              .reverse()
              .map((c: any) => ({
                timestamp: new Date(c.datetime).getTime(),
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume) || 0,
              }));
          }
        } catch {
          // Non-critical — proceed without HTF data
        }
      }

      return {
        success: true as const,
        data: {
          instrument: symbol,
          instrumentType: args.instrumentType,
          provider: "twelve-data",
          fetchTimestamp: Date.now(),
          price: { price, timestamp: priceTimestamp, source: "twelve-data" },
          candles,
          timeframe: args.timeframe,
          higherTimeframeCandles: higherCandles,
          higherTimeframe: higherCandles ? "D1" : undefined,
          dataFreshness: "delayed" as const,
        },
        technical,
      };
    } catch (err: any) {
      return {
        success: false as const,
        error: `Market data fetch failed: ${err?.message ?? "unknown error"}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});

// ── Helpers ────────────────────────────────────────────────────────

function mapTimeframe(tf: string): string {
  const map: Record<string, string> = {
    M1: "1min", M5: "5min", M15: "15min",
    H1: "1h", H4: "4h", D1: "1day", W1: "1week",
  };
  return map[tf] ?? tf.toLowerCase();
}

function classifyError(json: any) {
  const msg = json.message || "Unknown API error";
  const code = json.code;
  if (code === 401 || code === 403) {
    return { success: false as const, error: `Auth error: ${msg}`, errorCode: "AUTH_ERROR" as const };
  }
  if (code === 429) {
    return { success: false as const, error: `Rate limited: ${msg}`, errorCode: "RATE_LIMIT" as const };
  }
  return { success: false as const, error: `API error ${code}: ${msg}`, errorCode: "API_UNAVAILABLE" as const };
}

// ── Technical Calculations (inline to avoid import issues) ──────────

function calculateAll(candles: any[]) {
  if (candles.length === 0) {
    return { swingHighs: [], swingLows: [], structure: "unknown", supportLevels: [], resistanceLevels: [], volumeTrend: "unknown", dataPoints: 0 };
  }
  const closes = candles.map((c: any) => c.close);
  const currentPrice = closes[closes.length - 1];

  // Moving averages
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);

  // RSI
  const rsi14 = computeRsi(closes, 14);

  // MACD
  const macdResult = computeMacd(closes);

  // Swings
  const lookback = candles.length > 50 ? 5 : 3;
  const { highs: swingHighs, lows: swingLows } = detectSwings(candles, lookback);

  // Structure
  const structure = analyzeStructure(swingHighs, swingLows);
  const bosDirection = detectBos(swingHighs, swingLows, currentPrice);
  const chochDirection = detectChoch(swingHighs, swingLows, structure, currentPrice);

  // Key levels
  const { support, resistance } = findKeyLevels(swingHighs, swingLows, currentPrice);

  // Fibonacci
  let fibLevels: any;
  if (swingHighs.length >= 1 && swingLows.length >= 1) {
    const fibH = Math.max(...swingHighs.slice(-2));
    const fibL = Math.min(...swingLows.slice(-2));
    if (fibH > fibL) {
      const range = fibH - fibL;
      fibLevels = {
        level236: fibL + range * 0.236,
        level382: fibL + range * 0.382,
        level500: fibL + range * 0.5,
        level618: fibL + range * 0.618,
        level786: fibL + range * 0.786,
      };
    }
  }

  // Volume
  const { avg20, trend: volumeTrend } = analyzeVolume(candles);

  // ATR
  const atr14 = computeAtr(candles, 14);

  const dailyRange = candles[candles.length - 1].high - candles[candles.length - 1].low;

  return {
    sma50: sma50 != null ? Math.round(sma50 * 1e6) / 1e6 : undefined,
    sma100: sma100 != null ? Math.round(sma100 * 1e6) / 1e6 : undefined,
    sma200: sma200 != null ? Math.round(sma200 * 1e6) / 1e6 : undefined,
    rsi14: rsi14 != null ? Math.round(rsi14 * 10) / 10 : undefined,
    macdLine: macdResult?.line,
    macdSignal: macdResult?.signal,
    macdHistogram: macdResult?.histogram,
    swingHighs,
    swingLows,
    structure,
    bosDirection,
    chochDirection,
    supportLevels: support,
    resistanceLevels: resistance,
    fibLevels,
    avgVolume20: avg20,
    volumeTrend,
    atr14,
    dailyRange,
    dataPoints: candles.length,
  };
}

function sma(arr: number[], period: number): number | undefined {
  if (arr.length < period) return undefined;
  const s = arr.slice(arr.length - period);
  return s.reduce((a, b) => a + b, 0) / period;
}

function ema(arr: number[], period: number): number[] {
  if (arr.length === 0) return [];
  const k = 2 / (period + 1);
  const r = [arr[0]];
  for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
  return r;
}

function computeRsi(closes: number[], period = 14): number | undefined {
  if (closes.length < period + 1) return undefined;
  let gs = 0, ls = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gs += d; else ls += Math.abs(d);
  }
  let ag = gs / period, al = ls / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function computeMacd(closes: number[]) {
  if (closes.length < 35) return undefined;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signal = ema(macdLine.slice(26), 9);
  if (signal.length === 0) return undefined;
  const ml = macdLine[macdLine.length - 1];
  const sl = signal[signal.length - 1];
  return { line: ml, signal: sl, histogram: ml - sl };
}

function detectSwings(candles: any[], lookback: number) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    if (candles.slice(i - lookback, i).every((x: any) => c.high >= x.high) &&
        candles.slice(i + 1, i + lookback + 1).every((x: any) => c.high >= x.high))
      highs.push(c.high);
    if (candles.slice(i - lookback, i).every((x: any) => c.low <= x.low) &&
        candles.slice(i + 1, i + lookback + 1).every((x: any) => c.low <= x.low))
      lows.push(c.low);
  }
  return { highs, lows };
}

function analyzeStructure(sH: number[], sL: number[]): string {
  if (sH.length < 2 || sL.length < 2) return "unknown";
  const rh = sH.slice(-3), rl = sL.slice(-3);
  const hr = rh[rh.length - 1] > rh[0], lr = rl[rl.length - 1] > rl[0];
  if (hr && lr) return "HH/HL";
  if (!hr && !lr) return "LH/LL";
  return "range";
}

function detectBos(sH: number[], sL: number[], price: number): string {
  if (sH.length < 2 || sL.length < 2) return "none";
  if (price > sH[sH.length - 1]) return "bullish";
  if (price < sL[sL.length - 1]) return "bearish";
  return "none";
}

function detectChoch(sH: number[], sL: number[], structure: string, price: number): string {
  if (sH.length < 2 || sL.length < 2) return "none";
  if (structure === "HH/HL" && price < sL[sL.length - 1]) return "bearish";
  if (structure === "LH/LL" && price > sH[sH.length - 1]) return "bullish";
  return "none";
}

function findKeyLevels(sH: number[], sL: number[], price: number) {
  const all = [
    ...sH.map((h) => ({ level: h, type: "r" as const })),
    ...sL.map((l) => ({ level: l, type: "s" as const })),
  ].sort((a, b) => a.level - b.level);
  return {
    support: all.filter((s) => s.level < price && s.type === "s").map((s) => s.level).slice(-3),
    resistance: all.filter((s) => s.level > price && s.type === "r").map((s) => s.level).slice(0, 3),
  };
}

function analyzeVolume(candles: any[]) {
  if (candles.length < 20) return { avg20: undefined, trend: "unknown" as const };
  const vols = candles.map((c: any) => c.volume);
  const avg20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const r5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const o5 = vols.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  const ratio = o5 > 0 ? r5 / o5 : 1;
  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (ratio > 1.3) trend = "increasing";
  else if (ratio < 0.7) trend = "decreasing";
  return { avg20, trend };
}

function computeAtr(candles: any[], period = 14): number | undefined {
  if (candles.length < period + 1) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return undefined;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
