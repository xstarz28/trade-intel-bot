import type { AnalysisInput, AnalysisResult, InstrumentType, Timeframe, TradePlan } from "@/types/analysis";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { runAnalysis } from "@/lib/analysis-engine";
import { calculateTechnical } from "@/lib/data/technical";
import { computeSmcContext } from "@/lib/data/smc";

export interface WalkForwardOptions {
  /** Number of completed candles required before the first signal. */
  minimumHistory?: number;
  /** Maximum bars after entry to hold a trade. */
  maxHoldingBars?: number;
  /** Combined fee + slippage assumption per side, in basis points. */
  costBpsPerSide?: number;
  /** Optional first candle index scored as out-of-sample; earlier bars are history only. */
  outOfSampleStartIndex?: number;
}

export interface BacktestTrade {
  signalTime: number;
  entryTime: number;
  exitTime: number;
  direction: "long" | "short";
  entry: number;
  exit: number;
  stopLoss: number;
  takeProfit: number;
  exitReason: "stop_loss" | "take_profit" | "time_exit";
  barsHeld: number;
  grossReturnPct: number;
  netReturnPct: number;
  rMultiple: number;
  confidence: number;
}

export interface WalkForwardReport {
  instrument: string;
  timeframe: string;
  candleCount: number;
  signalsChecked: number;
  noTradeSignals: number;
  rejectedPlans: number;
  executedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  totalNetReturnPct: number;
  averageNetReturnPct: number | null;
  trades: BacktestTrade[];
  warnings: string[];
}

export interface BacktestSignal {
  recommendation: "LONG" | "SHORT" | "NO_TRADE";
  tradePlan?: Pick<TradePlan, "direction" | "entry" | "stopLoss" | "takeProfit">;
  confidence?: number;
}

export interface WalkForwardInput {
  instrument: string;
  timeframe: Timeframe;
  candles: OhlcvCandle[];
  options?: WalkForwardOptions;
  /** Receives only candles available at signal time. No future candles are passed. */
  analyzeAtClose: (visibleCandles: readonly OhlcvCandle[], signalIndex: number) => BacktestSignal;
}

const finitePositive = (n: number): boolean => Number.isFinite(n) && n > 0;
const parsePrice = (value: string): number => Number(value);

function validateCandles(candles: OhlcvCandle[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(candles) || candles.length < 3) return ["At least 3 OHLCV candles are required."];
  let previousTimestamp = -Infinity;
  candles.forEach((c, index) => {
    if (!Number.isFinite(c.timestamp) || c.timestamp <= previousTimestamp) {
      errors.push(`Candle ${index}: timestamps must be finite, unique and strictly ascending.`);
    }
    previousTimestamp = c.timestamp;
    const values = [c.open, c.high, c.low, c.close, c.volume];
    if (!values.every(Number.isFinite)) errors.push(`Candle ${index}: OHLCV values must all be finite.`);
    if (!finitePositive(c.open) || !finitePositive(c.high) || !finitePositive(c.low) || !finitePositive(c.close)) {
      errors.push(`Candle ${index}: OHLC prices must be positive.`);
    } else if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high)) {
      errors.push(`Candle ${index}: inconsistent OHLC high/low bounds.`);
    }
    if (Number.isFinite(c.volume) && c.volume < 0) errors.push(`Candle ${index}: volume cannot be negative.`);
  });
  return errors;
}

function adversePrice(price: number, direction: "long" | "short", isEntry: boolean, costRate: number): number {
  const adverseSign = (direction === "long") === isEntry ? 1 : -1;
  return price * (1 + adverseSign * costRate);
}

function simulateTrade(args: {
  candles: OhlcvCandle[];
  signalIndex: number;
  signal: BacktestSignal;
  maxHoldingBars: number;
  costRate: number;
}): BacktestTrade | undefined {
  const { candles, signalIndex, signal, maxHoldingBars, costRate } = args;
  const plan = signal.tradePlan;
  if (!plan || signal.recommendation === "NO_TRADE") return undefined;
  const direction = signal.recommendation === "LONG" ? "long" : "short";
  if (plan.direction !== direction) return undefined;

  const plannedEntry = parsePrice(plan.entry);
  const stopLoss = parsePrice(plan.stopLoss);
  const takeProfit = parsePrice(plan.takeProfit);
  if (![plannedEntry, stopLoss, takeProfit].every(finitePositive)) return undefined;
  if (direction === "long" ? !(stopLoss < plannedEntry && takeProfit > plannedEntry) : !(takeProfit < plannedEntry && stopLoss > plannedEntry)) {
    return undefined;
  }

  // Signal is evaluated after a candle closes; execution starts at the NEXT candle open.
  const entryIndex = signalIndex + 1;
  if (entryIndex >= candles.length) return undefined;
  const rawEntry = candles[entryIndex].open;
  const entry = adversePrice(rawEntry, direction, true, costRate);
  // Evaluate risk/reward using estimated executable fills on BOTH sides.
  // Otherwise exit-side costs reduce realized P&L but are omitted from the R denominator.
  const stopFill = adversePrice(stopLoss, direction, false, costRate);
  const targetFill = adversePrice(takeProfit, direction, false, costRate);
  const risk = direction === "long" ? entry - stopFill : stopFill - entry;
  const reward = direction === "long" ? targetFill - entry : entry - targetFill;
  // Reject gaps/costs that make the executable setup invalid or below minimum R:R.
  if (!(risk > 0) || !(reward > 0) || reward / risk < 1.5) return undefined;

  const lastIndex = Math.min(candles.length - 1, entryIndex + Math.max(1, maxHoldingBars) - 1);
  let exitIndex = lastIndex;
  let exitReason: BacktestTrade["exitReason"] = "time_exit";
  let rawExit = candles[lastIndex].close;

  for (let i = entryIndex; i <= lastIndex; i++) {
    const candle = candles[i];
    const stopHit = direction === "long" ? candle.low <= stopLoss : candle.high >= stopLoss;
    const targetHit = direction === "long" ? candle.high >= takeProfit : candle.low <= takeProfit;
    // Conservative ambiguity rule: if both levels occur within one OHLC bar, count the stop first.
    if (stopHit) {
      exitIndex = i;
      exitReason = "stop_loss";
      // A stop-market order can fill worse than its trigger after an opening gap.
      // Use the bar open when it has already crossed the stop; otherwise use the stop level.
      const gappedThroughStop = direction === "long"
        ? candle.open <= stopLoss
        : candle.open >= stopLoss;
      rawExit = gappedThroughStop ? candle.open : stopLoss;
      break;
    }
    if (targetHit) {
      exitIndex = i;
      exitReason = "take_profit";
      rawExit = takeProfit;
      break;
    }
  }

  const exit = adversePrice(rawExit, direction, false, costRate);
  const signedMove = direction === "long" ? exit - entry : entry - exit;
  const grossSignedMove = direction === "long" ? rawExit - rawEntry : rawEntry - rawExit;
  const grossReturnPct = (grossSignedMove / rawEntry) * 100;
  // Net return is measured against actual entry fill, including entry-side costs.
  const netReturnPct = (signedMove / entry) * 100;
  return {
    signalTime: candles[signalIndex].timestamp,
    entryTime: candles[entryIndex].timestamp,
    exitTime: candles[exitIndex].timestamp,
    direction,
    entry,
    exit,
    stopLoss,
    takeProfit,
    exitReason,
    barsHeld: exitIndex - entryIndex + 1,
    grossReturnPct,
    netReturnPct,
    rMultiple: signedMove / risk,
    confidence: Number.isFinite(signal.confidence) ? Number(signal.confidence) : 0,
  };
}

/**
 * Deterministic walk-forward simulation. Signals see a prefix ending at the
 * completed signal candle, and fills cannot occur before the next candle open.
 * It intentionally uses conservative same-bar stop/target ordering.
 */
export function runWalkForwardBacktest(input: WalkForwardInput): WalkForwardReport {
  const { instrument, timeframe, candles } = input;
  const validationErrors = validateCandles(candles);
  if (validationErrors.length > 0) throw new Error(validationErrors.join(" "));
  const requestedMinimumHistory = input.options?.minimumHistory ?? 220;
  const requestedMaxHoldingBars = input.options?.maxHoldingBars ?? 20;
  const costBpsPerSide = input.options?.costBpsPerSide ?? 5;
  const requestedOutOfSampleStartIndex = input.options?.outOfSampleStartIndex ?? 0;
  if (!Number.isInteger(requestedOutOfSampleStartIndex) ||
      requestedOutOfSampleStartIndex < 0 ||
      requestedOutOfSampleStartIndex >= candles.length - 1) {
    throw new Error("outOfSampleStartIndex must be an integer candle index before the final candle.");
  }
  if (!Number.isFinite(requestedMinimumHistory) || requestedMinimumHistory < 20 || requestedMinimumHistory > 100_000) {
    throw new Error("minimumHistory must be a finite integer-compatible value between 20 and 100000.");
  }
  if (!Number.isFinite(requestedMaxHoldingBars) || requestedMaxHoldingBars < 1 || requestedMaxHoldingBars > 100_000) {
    throw new Error("maxHoldingBars must be a finite integer-compatible value between 1 and 100000.");
  }
  if (!Number.isFinite(costBpsPerSide) || costBpsPerSide < 0 || costBpsPerSide > 500) {
    throw new Error("costBpsPerSide must be between 0 and 500 basis points.");
  }
  const minimumHistory = Math.floor(requestedMinimumHistory);
  const maxHoldingBars = Math.floor(requestedMaxHoldingBars);
  const firstSignalIndex = Math.max(minimumHistory - 1, requestedOutOfSampleStartIndex);

  const warnings = [
    "Backtest quality depends on the supplied historical OHLCV source and timeframe alignment.",
    `Out-of-sample scoring starts at candle index ${firstSignalIndex}; earlier candles are history only.`,
    "Signals use the production analysis callback on past-only candles; no provider fundamentals, news, COT, derivatives, or MTF feeds are synthesized.",
    "Entry is next-bar open; stop/target touches use OHLC approximations and stop wins if both levels are touched in one bar.",
    "Fees/slippage are a user-configurable per-side assumption; results are not proof of future profitability.",
  ];
  const trades: BacktestTrade[] = [];
  let signalsChecked = 0;
  let noTradeSignals = 0;
  let rejectedPlans = 0;
  let nextEligibleSignalIndex = firstSignalIndex;

  for (let i = firstSignalIndex; i < candles.length - 1; i++) {
    if (i < nextEligibleSignalIndex) continue;
    const visible = candles.slice(0, i + 1);
    const signal = input.analyzeAtClose(visible, i);
    signalsChecked++;
    if (signal.recommendation === "NO_TRADE") {
      noTradeSignals++;
      continue;
    }
    const trade = simulateTrade({
      candles,
      signalIndex: i,
      signal,
      maxHoldingBars,
      costRate: costBpsPerSide / 10_000,
    });
    if (!trade) {
      rejectedPlans++;
      continue;
    }
    trades.push(trade);
    const exitIndex = candles.findIndex((c) => c.timestamp === trade.exitTime);
    nextEligibleSignalIndex = Math.max(i + 1, exitIndex);
  }

  const wins = trades.filter((t) => t.rMultiple > 0).length;
  const losses = trades.filter((t) => t.rMultiple < 0).length;
  const sumR = trades.reduce((sum, t) => sum + t.rMultiple, 0);
  const grossWinsR = trades.reduce((sum, t) => sum + Math.max(0, t.rMultiple), 0);
  const grossLossesR = trades.reduce((sum, t) => sum + Math.max(0, -t.rMultiple), 0);
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  for (const trade of trades) {
    equityR += trade.rMultiple;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
  }
  return {
    instrument,
    timeframe,
    candleCount: candles.length,
    signalsChecked,
    noTradeSignals,
    rejectedPlans,
    executedTrades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : null,
    expectancyR: trades.length ? sumR / trades.length : null,
    profitFactor: grossLossesR > 0 ? grossWinsR / grossLossesR : grossWinsR > 0 ? null : null,
    maxDrawdownR,
    totalNetReturnPct: (trades.reduce((growth, trade) => growth * (1 + trade.netReturnPct / 100), 1) - 1) * 100,
    averageNetReturnPct: trades.length ? trades.reduce((sum, t) => sum + t.netReturnPct, 0) / trades.length : null,
    trades,
    warnings,
  };
}

/**
 * Adapter for the actual analysis engine. Each call rebuilds all technical and
 * SMC context from the prefix ending at the signal candle; future bars are
 * never passed to indicator or profile calculations.
 */
export function runProductionWalkForwardBacktest(args: {
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  candles: OhlcvCandle[];
  options?: WalkForwardOptions;
}): WalkForwardReport {
  return runWalkForwardBacktest({
    instrument: args.instrument,
    timeframe: args.timeframe,
    candles: args.candles,
    options: args.options,
    analyzeAtClose: (visibleCandles) => {
      const latest = visibleCandles[visibleCandles.length - 1];
      const marketData: MarketData = {
        instrument: args.instrument,
        instrumentType: args.instrumentType,
        provider: "historical-walk-forward",
        fetchTimestamp: latest.timestamp,
        price: { price: latest.close, timestamp: latest.timestamp, source: "historical-OHLCV" },
        candles: [...visibleCandles],
        timeframe: args.timeframe,
        dataFreshness: "delayed",
      };
      const technicalData: TechnicalData = calculateTechnical([...visibleCandles]);
      technicalData.smc = computeSmcContext([...visibleCandles], args.timeframe);
      const analysisInput: AnalysisInput = {
        instrument: args.instrument,
        instrumentType: args.instrumentType,
        timeframe: args.timeframe,
        dataMode: "historical",
        currentPrice: String(latest.close),
        marketData,
        technicalData,
      };
      const result: AnalysisResult = runAnalysis(analysisInput);
      return {
        recommendation: result.recommendation,
        tradePlan: result.tradePlan,
        confidence: result.confidence,
      };
    },
  });
}