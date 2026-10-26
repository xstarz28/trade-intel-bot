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
  /** Aggregated analyzer rejection reasons, useful for diagnosing over-filtering. */
  noTradeReasonCounts?: Array<{ reason: string; count: number }>;
  /** Future support/resistance watch confirmation and linked executable-trade metrics. */
  watchlistEvaluation?: WatchlistEvaluationReport;
  warnings: string[];
}

export interface BacktestSignal {
  recommendation: "LONG" | "SHORT" | "NO_TRADE";
  tradePlan?: Pick<TradePlan, "direction" | "entry" | "stopLoss" | "takeProfit">;
  confidence?: number;
  noTradeReasons?: string[];
  watchLevels?: Array<{ level: string | number; type: string; source?: string; description?: string }>;
}

export interface WatchlistTypeEvaluation {
  type: "support" | "resistance";
  candidates: number;
  confirmed: number;
  expired: number;
  censored: number;
  confirmationRatePct: number | null;
  linkedTradeCount: number;
  linkedTradeWinRatePct: number | null;
  linkedTradeExpectancyR: number | null;
  linkedTradeProfitFactor: number | null;
  linkedTradeNetReturnPct: number;
}

export interface WatchlistEvaluationReport {
  candidates: number;
  confirmed: number;
  expired: number;
  censored: number;
  confirmationRatePct: number | null;
  confirmedWithActionableTrade: number;
  confirmedWithoutActionableTrade: number;
  linkedTradeCount: number;
  linkedTradeWinRatePct: number | null;
  linkedTradeExpectancyR: number | null;
  linkedTradeProfitFactor: number | null;
  linkedTradeNetReturnPct: number;
  linkedTradeRiskBudgetReturnPct: number;
  byType: WatchlistTypeEvaluation[];
}

interface WatchLevelObservation {
  signalIndex: number;
  level: number;
  type: "support" | "resistance";
}

function summarizeLinkedTrades(trades: BacktestTrade[]) {
  const wins = trades.filter((trade) => trade.rMultiple > 0).length;
  const sumR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossWinsR = trades.reduce((sum, trade) => sum + Math.max(0, trade.rMultiple), 0);
  const grossLossesR = trades.reduce((sum, trade) => sum + Math.max(0, -trade.rMultiple), 0);
  const fullNotionalEquity = trades.reduce((equity, trade) => equity * (1 + trade.netReturnPct / 100), 1);
  const riskBudgetEquity = trades.reduce((equity, trade) => equity * Math.max(0, 1 + 0.01 * trade.rMultiple), 1);
  return {
    linkedTradeCount: trades.length,
    linkedTradeWinRatePct: trades.length ? (wins / trades.length) * 100 : null,
    linkedTradeExpectancyR: trades.length ? sumR / trades.length : null,
    linkedTradeProfitFactor: grossLossesR > 0 ? grossWinsR / grossLossesR : null,
    linkedTradeNetReturnPct: (fullNotionalEquity - 1) * 100,
    linkedTradeRiskBudgetReturnPct: (riskBudgetEquity - 1) * 100,
  };
}

/**
 * Evaluate future structural watch levels using only later candles. A confirmation
 * requires a close beyond support/resistance, a directional candle body, and
 * volume above the preceding 20-bar mean. Only production-approved trades on
 * that same confirmation candle are linked to transaction-cost-adjusted P&L.
 */
function evaluateWatchlistObservations(
  candles: OhlcvCandle[],
  observations: WatchLevelObservation[],
  trades: BacktestTrade[],
  maxWatchBars: number,
): WatchlistEvaluationReport {
  const activeUntil = new Map<string, number>();
  const candidates: WatchLevelObservation[] = [];
  for (const observation of [...observations].sort((a, b) => a.signalIndex - b.signalIndex)) {
    const key = `${observation.type}:${observation.level.toPrecision(12)}`;
    if ((activeUntil.get(key) ?? -1) >= observation.signalIndex) continue;
    candidates.push(observation);
    activeUntil.set(key, observation.signalIndex + maxWatchBars);
  }

  const eventResults: Array<{
    type: "support" | "resistance";
    status: "confirmed" | "expired" | "censored";
    linkedTrade?: BacktestTrade;
  }> = [];

  for (const candidate of candidates) {
    const finalIndex = Math.min(candidate.signalIndex + maxWatchBars, candles.length - 1);
    const fullWindowAvailable = candidate.signalIndex + maxWatchBars <= candles.length - 1;
    let confirmationIndex: number | undefined;
    for (let index = candidate.signalIndex + 1; index <= finalIndex; index++) {
      const candle = candles[index];
      const volumeHistory = candles.slice(Math.max(0, index - 20), index).map((item) => item.volume).filter((value) => Number.isFinite(value) && value > 0);
      const averageVolume = volumeHistory.length
        ? volumeHistory.reduce((sum, value) => sum + value, 0) / volumeHistory.length
        : 0;
      const volumeConfirmed = averageVolume > 0 && candle.volume > averageVolume;
      const confirmed = candidate.type === "resistance"
        ? candle.close > candidate.level && candle.close > candle.open && volumeConfirmed
        : candle.close < candidate.level && candle.close < candle.open && volumeConfirmed;
      if (confirmed) {
        confirmationIndex = index;
        break;
      }
    }

    if (confirmationIndex !== undefined) {
      const expectedDirection = candidate.type === "resistance" ? "long" : "short";
      const confirmationTime = candles[confirmationIndex].timestamp;
      const linkedTrade = trades.find((trade) =>
        trade.signalTime === confirmationTime && trade.direction === expectedDirection,
      );
      eventResults.push({ type: candidate.type, status: "confirmed", linkedTrade });
    } else {
      eventResults.push({
        type: candidate.type,
        status: fullWindowAvailable ? "expired" : "censored",
      });
    }
  }

  const confirmed = eventResults.filter((event) => event.status === "confirmed");
  const uniqueLinkedTrades = [...new Map(
    confirmed.flatMap((event) => event.linkedTrade ? [[`${event.linkedTrade.signalTime}:${event.linkedTrade.direction}`, event.linkedTrade] as const] : []),
  ).values()];
  const summarizeType = (type: "support" | "resistance"): WatchlistTypeEvaluation => {
    const events = eventResults.filter((event) => event.type === type);
    const typeTrades = [...new Map(
      events.flatMap((event) => event.linkedTrade ? [[`${event.linkedTrade.signalTime}:${event.linkedTrade.direction}`, event.linkedTrade] as const] : []),
    ).values()];
    const typeConfirmed = events.filter((event) => event.status === "confirmed").length;
    const typeExpired = events.filter((event) => event.status === "expired").length;
    return {
      type,
      candidates: events.length,
      confirmed: typeConfirmed,
      expired: typeExpired,
      censored: events.filter((event) => event.status === "censored").length,
      confirmationRatePct: typeConfirmed + typeExpired > 0 ? (typeConfirmed / (typeConfirmed + typeExpired)) * 100 : null,
      ...summarizeLinkedTrades(typeTrades),
    };
  };
  const expired = eventResults.filter((event) => event.status === "expired").length;
  const confirmedWithActionableTrade = confirmed.filter((event) => event.linkedTrade).length;
  const stats = summarizeLinkedTrades(uniqueLinkedTrades);
  return {
    candidates: eventResults.length,
    confirmed: confirmed.length,
    expired,
    censored: eventResults.filter((event) => event.status === "censored").length,
    confirmationRatePct: confirmed.length + expired > 0 ? (confirmed.length / (confirmed.length + expired)) * 100 : null,
    confirmedWithActionableTrade,
    confirmedWithoutActionableTrade: confirmed.length - confirmedWithActionableTrade,
    ...stats,
    byType: [summarizeType("support"), summarizeType("resistance")],
  };
}

export interface WalkForwardInput {
  instrument: string;
  timeframe: Timeframe;
  candles: OhlcvCandle[];
  options?: WalkForwardOptions;
  /** Receives only candles available at signal time. No future candles are passed. */
  analyzeAtClose: (visibleCandles: readonly OhlcvCandle[], signalIndex: number) => BacktestSignal;
}

const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
  W1: 604_800_000,
};

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
    "Fees, spread, and slippage are combined into a user-configurable per-side rate; results are not proof of future profitability.",
    "Watchlist confirmation is an OHLCV proxy: close beyond support/resistance, directional candle body, and volume above the preceding 20-bar mean. Non-OHLCV and MTF confirmation are not synthesized.",
  ];
  const trades: BacktestTrade[] = [];
  let signalsChecked = 0;
  let noTradeSignals = 0;
  const noTradeReasonCounts = new Map<string, number>();
  const watchObservations: WatchLevelObservation[] = [];
  let rejectedPlans = 0;
  let nextEligibleSignalIndex = firstSignalIndex;

  for (let i = firstSignalIndex; i < candles.length - 1; i++) {
    if (i < nextEligibleSignalIndex) continue;
    const visible = candles.slice(0, i + 1);
    const signal = input.analyzeAtClose(visible, i);
    signalsChecked++;
    if (signal.recommendation === "NO_TRADE") {
      for (const watchLevel of signal.watchLevels ?? []) {
        if (watchLevel.source !== "keyLevels" || (watchLevel.type !== "support" && watchLevel.type !== "resistance")) continue;
        const rawLevel = typeof watchLevel.level === "number" ? watchLevel.level : Number(watchLevel.level.replace(/,/g, "").trim());
        if (finitePositive(rawLevel)) watchObservations.push({ signalIndex: i, level: rawLevel, type: watchLevel.type });
      }
      noTradeSignals++;
      const reasons = signal.noTradeReasons?.length ? signal.noTradeReasons : ["Analyzer returned NO_TRADE without a reason"];
      for (const reason of reasons) noTradeReasonCounts.set(reason, (noTradeReasonCounts.get(reason) ?? 0) + 1);
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
    noTradeReasonCounts: [...noTradeReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    watchlistEvaluation: evaluateWatchlistObservations(candles, watchObservations, trades, maxHoldingBars),
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
      // Candle timestamps mark opens; the replay observes the completed close.
      const replayNow = latest.timestamp + TIMEFRAME_DURATION_MS[args.timeframe] - 1;
      const marketData: MarketData = {
        instrument: args.instrument,
        instrumentType: args.instrumentType,
        provider: "historical-walk-forward",
        fetchTimestamp: replayNow,
        price: { price: latest.close, timestamp: replayNow, source: "historical-OHLCV" },
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
        currentPrice: String(latest.close),
        marketData,
        technicalData,
      };
      const result: AnalysisResult = runAnalysis(analysisInput, { now: () => replayNow });
      return {
        recommendation: result.recommendation,
        tradePlan: result.tradePlan,
        confidence: result.confidence,
        noTradeReasons: result.noTradeReasons,
        watchLevels: result.forwardMarketPath?.watchLevels ?? [],
      };
    },
  });
}