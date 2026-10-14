/**
 * TPO + visible-range volume-profile primitives.
 *
 * Important: OHLCV candles do not reveal the exact traded volume at each price.
 * VPVR below distributes each candle's volume evenly across the price rows touched
 * by that candle. It is an explicitly approximate OHLCV profile, never trade-level
 * volume-at-price. Callers must reject missing, zero, or non-representative volume.
 */
export interface ProfileCandle {
  timestamp: number; // Unix milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface ProfileLevel {
  price: number;
  value: number;
}

export interface MarketProfile {
  available: boolean;
  reason?: string;
  method: "ohlcv-range-allocation" | "time-price-opportunity";
  rows: ProfileLevel[];
  poc?: number;
  vah?: number;
  val?: number;
  total?: number;
  valueAreaPercent: number;
  approximation?: string;
}

export interface ProfileOptions {
  rows?: number;
  valueAreaPercent?: number;
  /** TPO time block in minutes. Defaults to 30. */
  blockMinutes?: number;
}

const DEFAULT_ROWS = 64;
const DEFAULT_VA = 0.7;
const DEFAULT_BLOCK_MINUTES = 30;

function validCandles(candles: ProfileCandle[]): ProfileCandle[] {
  return candles.filter((c) =>
    Number.isFinite(c.timestamp) &&
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close) &&
    c.high >= c.low && c.low > 0 &&
    c.open > 0 && c.close > 0
  ).sort((a, b) => a.timestamp - b.timestamp);
}

function bounds(candles: ProfileCandle[]) {
  return {
    low: Math.min(...candles.map((c) => c.low)),
    high: Math.max(...candles.map((c) => c.high)),
  };
}

function normalizedOptions(options: ProfileOptions) {
  return {
    rows: Math.max(8, Math.min(200, Math.floor(options.rows ?? DEFAULT_ROWS))),
    valueAreaPercent: Math.max(0.5, Math.min(0.9, options.valueAreaPercent ?? DEFAULT_VA)),
    blockMs: Math.max(1, options.blockMinutes ?? DEFAULT_BLOCK_MINUTES) * 60_000,
  };
}

function valueArea(values: number[], low: number, step: number, percent: number) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return undefined;
  let pocIndex = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[pocIndex]) pocIndex = i;
  }
  let left = pocIndex;
  let right = pocIndex;
  let included = values[pocIndex];
  const target = total * percent;
  while (included < target && (left > 0 || right < values.length - 1)) {
    const below = left > 0 ? values[left - 1] : -1;
    const above = right < values.length - 1 ? values[right + 1] : -1;
    if (above > below) {
      right++;
      included += values[right];
    } else if (below > above) {
      left--;
      included += values[left];
    } else if (above >= 0) {
      // Deterministic tie-break: choose the row closer to POC; on equal
      // distance choose the higher row.
      const aboveDistance = right + 1 - pocIndex;
      const belowDistance = pocIndex - (left - 1);
      if (aboveDistance <= belowDistance) {
        right++;
        included += values[right];
      } else {
        left--;
        included += values[left];
      }
    } else {
      break;
    }
  }
  return {
    poc: low + (pocIndex + 0.5) * step,
    vah: low + (right + 1) * step,
    val: low + left * step,
    total,
  };
}

/** Build TPO counts: each distinct time block contributes one count per price row touched. */
export function calculateTpoProfile(
  input: ProfileCandle[],
  options: ProfileOptions = {},
): MarketProfile {
  const candles = validCandles(input);
  const { rows, valueAreaPercent, blockMs } = normalizedOptions(options);
  if (candles.length < 20) {
    return { available: false, reason: "At least 20 valid candles are required.", method: "time-price-opportunity", rows: [], valueAreaPercent };
  }
  const { low, high } = bounds(candles);
  if (!(high > low)) {
    return { available: false, reason: "Price range is degenerate.", method: "time-price-opportunity", rows: [], valueAreaPercent };
  }
  const step = (high - low) / rows;
  const buckets = new Map<number, Set<number>>();
  for (const candle of candles) {
    const block = Math.floor(candle.timestamp / blockMs);
    let first = Math.max(0, Math.floor((candle.low - low) / step));
    let last = Math.min(rows - 1, Math.floor((candle.high - low) / step));
    if (candle.high === high) last = rows - 1;
    first = Math.min(rows - 1, first);
    for (let i = first; i <= last; i++) {
      if (!buckets.has(i)) buckets.set(i, new Set<number>());
      buckets.get(i)!.add(block);
    }
  }
  const values = Array.from({ length: rows }, (_, i) => buckets.get(i)?.size ?? 0);
  const levels = values.map((value, i) => ({ price: low + (i + 0.5) * step, value }));
  const area = valueArea(values, low, step, valueAreaPercent);
  if (!area) return { available: false, reason: "No TPO observations were produced.", method: "time-price-opportunity", rows: levels, valueAreaPercent };
  return { available: true, method: "time-price-opportunity", rows: levels, ...area, valueAreaPercent };
}

/**
 * Approximate visible-range volume profile from OHLCV candles.
 * Do not use when volume is absent, all-zero, negative, or non-finite.
 */
export function calculateVpvrProfile(
  input: ProfileCandle[],
  options: ProfileOptions = {},
): MarketProfile {
  const candles = validCandles(input);
  const { rows, valueAreaPercent } = normalizedOptions(options);
  if (candles.length < 20) {
    return { available: false, reason: "At least 20 valid candles are required.", method: "ohlcv-range-allocation", rows: [], valueAreaPercent };
  }
  if (candles.some((c) => c.volume == null || !Number.isFinite(c.volume) || c.volume < 0) ||
      !candles.some((c) => (c.volume ?? 0) > 0)) {
    return { available: false, reason: "Representative positive volume is unavailable; VPVR was not fabricated.", method: "ohlcv-range-allocation", rows: [], valueAreaPercent };
  }
  const { low, high } = bounds(candles);
  if (!(high > low)) {
    return { available: false, reason: "Price range is degenerate.", method: "ohlcv-range-allocation", rows: [], valueAreaPercent };
  }
  const step = (high - low) / rows;
  const values = Array.from({ length: rows }, () => 0);
  for (const candle of candles) {
    const volume = candle.volume ?? 0;
    if (volume === 0) continue;
    let first = Math.max(0, Math.floor((candle.low - low) / step));
    let last = Math.min(rows - 1, Math.floor((candle.high - low) / step));
    if (candle.high === high) last = rows - 1;
    first = Math.min(rows - 1, first);
    const touched = Math.max(1, last - first + 1);
    const allocation = volume / touched;
    for (let i = first; i <= last; i++) values[i] += allocation;
  }
  const levels = values.map((value, i) => ({ price: low + (i + 0.5) * step, value }));
  const area = valueArea(values, low, step, valueAreaPercent);
  if (!area) return { available: false, reason: "No volume could be allocated.", method: "ohlcv-range-allocation", rows: levels, valueAreaPercent };
  return {
    available: true,
    method: "ohlcv-range-allocation",
    rows: levels,
    ...area,
    valueAreaPercent,
    approximation: "Candle volume is allocated evenly across price rows touched by each OHLC range; this is not true trade-level volume-at-price.",
  };
}
