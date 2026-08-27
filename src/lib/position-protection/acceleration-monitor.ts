/**
 * Phase 59 — Acceleration Monitor
 *
 * Tracks timestamped observations and detects abnormal rate-of-change
 * in price, momentum, volatility, and profit giveback.
 *
 * Pure functions — no side effects.
 */

// ═══════════════════════════════════════════════════════════════
// OBSERVATION
// ═══════════════════════════════════════════════════════════════

export interface Observation {
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** Observed value. */
  value: number;
  /** Observation source. */
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// ACCELERATION STATE
// ═══════════════════════════════════════════════════════════════

export type AccelerationLevel = "NORMAL" | "ELEVATED" | "HIGH";

export interface AccelerationResult {
  /** Current acceleration level. */
  level: AccelerationLevel;
  /** Rate of change (units per second). */
  rate: number;
  /** Previous rate for comparison. */
  previousRate: number;
  /** Duration of observation window (ms). */
  windowMs: number;
  /** Number of observations. */
  observationCount: number;
  /** Description. */
  description: string;
}

export interface AccelerationState {
  /** Price observations. */
  priceObservations: Observation[];
  /** Volatility observations. */
  volatilityObservations: Observation[];
  /** Giveback observations. */
  givebackObservations: Observation[];
  /** Max buffer size per type. */
  maxBufferSize: number;
  /** Observation window (ms). */
  windowMs: number;
}

export function createAccelerationState(config?: {
  maxBufferSize?: number;
  windowMs?: number;
}): AccelerationState {
  return {
    priceObservations: [],
    volatilityObservations: [],
    givebackObservations: [],
    maxBufferSize: config?.maxBufferSize ?? 100,
    windowMs: config?.windowMs ?? 300_000, // 5 minutes
  };
}

// ═══════════════════════════════════════════════════════════════
// BUFFER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function addObservation(
  buffer: Observation[],
  obs: Observation,
  maxsize: number,
  windowMs: number,
): Observation[] {
  const cutoff = obs.timestamp - windowMs;
  const filtered = buffer.filter(o => o.timestamp > cutoff);
  const result = [...filtered, obs];
  if (result.length > maxsize) {
    return result.slice(result.length - maxsize);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// RECORD OBSERVATIONS
// ═══════════════════════════════════════════════════════════════

export function recordPriceObservation(
  state: AccelerationState,
  timestamp: number,
  price: number,
  source: string,
): AccelerationState {
  return {
    ...state,
    priceObservations: addObservation(
      state.priceObservations,
      { timestamp, value: price, source },
      state.maxBufferSize,
      state.windowMs,
    ),
  };
}

export function recordVolatilityObservation(
  state: AccelerationState,
  timestamp: number,
  volatility: number,
  source: string,
): AccelerationState {
  return {
    ...state,
    volatilityObservations: addObservation(
      state.volatilityObservations,
      { timestamp, value: volatility, source },
      state.maxBufferSize,
      state.windowMs,
    ),
  };
}

export function recordGivebackObservation(
  state: AccelerationState,
  timestamp: number,
  givebackPct: number,
  source: string,
): AccelerationState {
  return {
    ...state,
    givebackObservations: addObservation(
      state.givebackObservations,
      { timestamp, value: givebackPct, source },
      state.maxBufferSize,
      state.windowMs,
    ),
  };
}

// ═══════════════════════════════════════════════════════════════
// ACCELERATION CALCULATION
// ═══════════════════════════════════════════════════════════════

export function calculateAcceleration(
  observations: Observation[],
  now: number,
  windowMs?: number,
): AccelerationResult {
  const effectiveWindow = windowMs ?? 300_000;
  const cutoff = now - effectiveWindow;
  const recent = observations.filter(o => o.timestamp > cutoff);

  if (recent.length < 2) {
    return {
      level: "NORMAL",
      rate: 0,
      previousRate: 0,
      windowMs: effectiveWindow,
      observationCount: recent.length,
      description: "Insufficient observations for acceleration analysis.",
    };
  }

  // Current rate: last 3 observations
  const last3 = recent.slice(-3);
  const currentRate = computeRate(last3);

  // Previous rate: observations before last 3
  const prev3 = recent.slice(-6, -3);
  const previousRate = prev3.length >= 2 ? computeRate(prev3) : currentRate;

  // Classify
  const rateRatio = previousRate !== 0 ? Math.abs(currentRate / previousRate) : Math.abs(currentRate);
  let level: AccelerationLevel;
  let description: string;

  if (rateRatio > 3.0 || Math.abs(currentRate) > 10) {
    level = "HIGH";
    description = `High acceleration: rate ${currentRate.toFixed(2)}/s (previous: ${previousRate.toFixed(2)}/s).`;
  } else if (rateRatio > 1.5 || Math.abs(currentRate) > 3) {
    level = "ELEVATED";
    description = `Elevated acceleration: rate ${currentRate.toFixed(2)}/s.`;
  } else {
    level = "NORMAL";
    description = `Normal rate: ${currentRate.toFixed(2)}/s.`;
  }

  return {
    level,
    rate: currentRate,
    previousRate,
    windowMs: effectiveWindow,
    observationCount: recent.length,
    description,
  };
}

/** Compute rate of change per second from observations. */
function computeRate(observations: Observation[]): number {
  if (observations.length < 2) return 0;
  const first = observations[0];
  const last = observations[observations.length - 1];
  const dtSec = (last.timestamp - first.timestamp) / 1000;
  if (dtSec <= 0) return 0;
  return (last.value - first.value) / dtSec;
}

// ═══════════════════════════════════════════════════════════════
// PRICE ACCELERATION (adverse direction check)
// ═══════════════════════════════════════════════════════════════

export function detectPriceAcceleration(
  state: AccelerationState,
  side: "LONG" | "SHORT",
  now: number,
): AccelerationResult {
  const result = calculateAcceleration(state.priceObservations, now);

  // For LONG: negative rate = adverse (price dropping)
  // For SHORT: positive rate = adverse (price rising)
  const isAdverse = side === "LONG" ? result.rate < 0 : result.rate > 0;

  if (!isAdverse) {
    return {
      ...result,
      level: "NORMAL",
      description: `Price rate ${result.rate.toFixed(2)}/s is in favorable direction.`,
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// GIVEBACK ACCELERATION
// ═══════════════════════════════════════════════════════════════

export function detectGivebackAcceleration(
  state: AccelerationState,
  now: number,
): AccelerationResult {
  return calculateAcceleration(state.givebackObservations, now);
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY ACCELERATION
// ═══════════════════════════════════════════════════════════════

export function detectVolatilityAcceleration(
  state: AccelerationState,
  now: number,
): AccelerationResult {
  return calculateAcceleration(state.volatilityObservations, now);
}
