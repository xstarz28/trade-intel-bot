import type { AdvancedTechnicalIndicators, OhlcvCandle } from "./market-types";


function validCandles(candles: readonly OhlcvCandle[]): boolean {
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (
      ![candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
      candle.timestamp <= 0 ||
      candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close, candle.high) ||
      (index > 0 && candle.timestamp <= candles[index - 1].timestamp)
    ) return false;
  }
  return true;
}

function calculateAdxDmi(candles: readonly OhlcvCandle[], period = 14): AdvancedTechnicalIndicators["adx14"] {
  if (candles.length < period * 2) return undefined;
  const trueRanges: number[] = [];
  const positiveMoves: number[] = [];
  const negativeMoves: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
    positiveMoves.push(upMove > downMove && upMove > 0 ? upMove : 0);
    negativeMoves.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothedTr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedPositive = positiveMoves.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothedNegative = negativeMoves.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dxValues: number[] = [];

  for (let index = period - 1; index < trueRanges.length; index += 1) {
    if (index >= period) {
      smoothedTr = smoothedTr - smoothedTr / period + trueRanges[index];
      smoothedPositive = smoothedPositive - smoothedPositive / period + positiveMoves[index];
      smoothedNegative = smoothedNegative - smoothedNegative / period + negativeMoves[index];
    }
    if (!(smoothedTr > 0)) continue;
    const plusDi = 100 * smoothedPositive / smoothedTr;
    const minusDi = 100 * smoothedNegative / smoothedTr;
    const denominator = plusDi + minusDi;
    dxValues.push(denominator > 0 ? 100 * Math.abs(plusDi - minusDi) / denominator : 0);
  }

  if (dxValues.length < period) return undefined;
  let adx = dxValues.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < dxValues.length; index += 1) {
    adx = ((adx * (period - 1)) + dxValues[index]) / period;
  }
  if (!Number.isFinite(adx)) return undefined;

  const plusDi = smoothedTr > 0 ? 100 * smoothedPositive / smoothedTr : 0;
  const minusDi = smoothedTr > 0 ? 100 * smoothedNegative / smoothedTr : 0;
  return {
    value: adx,
    plusDi,
    minusDi,
    strength: adx < 20 ? "WEAK" : adx < 25 ? "DEVELOPING" : "STRONG",
  };
}

function calculateBollinger(candles: readonly OhlcvCandle[], period = 20): AdvancedTechnicalIndicators["bollinger20"] {
  if (candles.length < period) return undefined;
  const closes = candles.slice(-period).map((candle) => candle.close);
  const middle = closes.reduce((sum, value) => sum + value, 0) / period;
  if (!(middle > 0)) return undefined;
  const variance = closes.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
  const deviation = Math.sqrt(variance);
  const upper = middle + 2 * deviation;
  const lower = middle - 2 * deviation;
  const width = upper - lower;
  const latestClose = closes[closes.length - 1];
  return {
    upper,
    middle,
    lower,
    bandwidthPct: width / middle * 100,
    ...(width > 0 ? { percentB: (latestClose - lower) / width } : {}),
  };
}

function calculateStochastic(candles: readonly OhlcvCandle[], period = 14, smoothK = 3, smoothD = 3): AdvancedTechnicalIndicators["stochastic14"] {
  if (candles.length < period + smoothK + smoothD - 2) return undefined;
  const rawK: number[] = [];
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const highest = Math.max(...window.map((candle) => candle.high));
    const lowest = Math.min(...window.map((candle) => candle.low));
    const width = highest - lowest;
    if (!(width > 0)) return undefined;
    rawK.push((candles[index].close - lowest) / width * 100);
  }
  const smoothedK: number[] = [];
  for (let index = smoothK - 1; index < rawK.length; index += 1) {
    const window = rawK.slice(index - smoothK + 1, index + 1);
    smoothedK.push(window.reduce((sum, value) => sum + value, 0) / smoothK);
  }
  if (smoothedK.length < smoothD) return undefined;
  const latestK = smoothedK[smoothedK.length - 1];
  const latestD = smoothedK.slice(-smoothD).reduce((sum, value) => sum + value, 0) / smoothD;
  return { percentK: latestK, percentD: latestD };
}

function calculateDonchian(candles: readonly OhlcvCandle[], period = 20): AdvancedTechnicalIndicators["donchian20"] {
  if (candles.length < period + 1) return undefined;
  const previousBars = candles.slice(-period - 1, -1);
  const upper = Math.max(...previousBars.map((candle) => candle.high));
  const lower = Math.min(...previousBars.map((candle) => candle.low));
  if (!(upper > 0) || !(lower > 0) || upper < lower) return undefined;
  const latestClose = candles[candles.length - 1].close;
  return {
    upper,
    lower,
    middle: (upper + lower) / 2,
    breakout: latestClose > upper ? "ABOVE" : latestClose < lower ? "BELOW" : "INSIDE",
  };
}

function calculateVolumeFlow(candles: readonly OhlcvCandle[], period = 14): AdvancedTechnicalIndicators["volumeFlow"] {
  if (candles.length < 2 || !candles.some((candle) => candle.volume > 0)) return undefined;
  const obvSeries = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    const volume = candles[index].volume;
    obvSeries.push(
      obvSeries[index - 1] + (current > previous ? volume : current < previous ? -volume : 0),
    );
  }
  const baseline = obvSeries[Math.max(0, obvSeries.length - 21)];
  const obv = obvSeries[obvSeries.length - 1];
  const obvChange20 = obv - baseline;
  const obvDirection = Math.abs(obvChange20) < 1e-12
    ? "FLAT"
    : obvChange20 > 0 ? "RISING" : "FALLING";

  let mfi14: number | undefined;
  if (candles.length > period) {
    const positiveFlows: number[] = [];
    const negativeFlows: number[] = [];
    for (let index = 1; index < candles.length; index += 1) {
      const current = candles[index];
      const previous = candles[index - 1];
      const currentTypical = (current.high + current.low + current.close) / 3;
      const previousTypical = (previous.high + previous.low + previous.close) / 3;
      const rawFlow = currentTypical * current.volume;
      positiveFlows.push(currentTypical > previousTypical ? rawFlow : 0);
      negativeFlows.push(currentTypical < previousTypical ? rawFlow : 0);
    }
    const positive = positiveFlows.slice(-period).reduce((sum, value) => sum + value, 0);
    const negative = negativeFlows.slice(-period).reduce((sum, value) => sum + value, 0);
    if (positive + negative > 0) {
      mfi14 = negative === 0 ? 100 : positive === 0 ? 0 : 100 - 100 / (1 + positive / negative);
    }
  }

  return {
    obv,
    obvChange20,
    obvDirection,
    ...(mfi14 !== undefined && Number.isFinite(mfi14) ? { mfi14 } : {}),
  };
}

/**
 * Calculates complementary classic indicators from one validated OHLCV series.
 * These fields are informational and must not independently change bias,
 * confidence, suitability, NO_TRADE, risk sizing, or execution permission.
 */
export function calculateAdvancedTechnicalIndicators(
  candles: readonly OhlcvCandle[],
): AdvancedTechnicalIndicators | undefined {
  if (candles.length === 0 || !validCandles(candles)) return undefined;
  const result: AdvancedTechnicalIndicators = {};
  const adx14 = calculateAdxDmi(candles);
  const bollinger20 = calculateBollinger(candles);
  const stochastic14 = calculateStochastic(candles);
  const donchian20 = calculateDonchian(candles);
  const volumeFlow = calculateVolumeFlow(candles);
  if (adx14) result.adx14 = adx14;
  if (bollinger20) result.bollinger20 = bollinger20;
  if (stochastic14) result.stochastic14 = stochastic14;
  if (donchian20) result.donchian20 = donchian20;
  if (volumeFlow) result.volumeFlow = volumeFlow;
  return Object.keys(result).length > 0 ? result : undefined;
}
