/**
 * Phase 6 — Trading style profiles (pure configuration).
 *
 * A style NEVER changes market facts (structure, swings, liquidity,
 * FVG/OB, prices, correlations). It only changes DECISION HORIZON and
 * OPPORTUNITY REQUIREMENTS: timeframe preference, freshness sensitivity,
 * evidence priority (conviction layer scaling), target-horizon guards,
 * and additional NO_TRADE conditions.
 *
 * The numbers below are POLICY PARAMETERS of this platform — documented
 * here, never presented as universal market truths.
 */

export type TradingStyle = "scalping" | "intraday" | "swing";

export const TRADING_STYLES: TradingStyle[] = ["scalping", "intraday", "swing"];

/** Neutral default when the user does not choose. */
export const DEFAULT_TRADING_STYLE: TradingStyle = "intraday";

export interface StyleProfile {
  style: TradingStyle;
  /** Setup timeframes consistent with this horizon (subset of TF_LADDER). */
  allowedSetupTfs: string[];
  /** Nearest supported fallback when the requested TF is outside the horizon. */
  fallbackTf: string;
  /** Live-price staleness window (policy, style-sensitive). */
  priceStaleMs: number;
  /** Fundamental conviction-layer multiplier + cap (evidence PRIORITY). */
  fundamentalLayerMultiplier: number;
  fundamentalLayerCap: number;
  /**
   * Macro-yield (Treasury) conviction-layer cap. Slow-moving macro data:
   * SCALPING treats it as near-irrelevant CONTEXT (±2); INTRADAY moderate
   * context (±8); SWING may weight it meaningfully (±12). Never a trigger.
   */
  macroYieldLayerCap: number;
  /**
   * Positioning-COT (CFTC weekly futures) conviction-layer cap.
   * SCALPING: near-zero context (±1); INTRADAY supporting (±5);
   * SWING: meaningful positioning evidence (±12). Never a trigger,
   * never able to create or flip a trade alone.
   */
  cotLayerCap: number;
  /**
   * EIA WPSR inventory conviction-layer cap (weekly slow fundamental data).
   * SCALPING: near-zero context (\u00b11); INTRADAY supporting (\u00b14);
   * SWING meaningful supply-demand context (\u00b18). Never an entry
   * trigger, never able to flip structural bias alone.
   */
  eiaLayerCap: number;
  /**
   * Execution-quality conviction-layer cap (crypto order book only).
   * INITIAL POLICY PARAMETER validated by tests: SCALPING \u00b16 (most
   * sensitive to microstructure), INTRADAY \u00b13, SWING \u00b11 (contextual
   * only). Must stay below structure/liquidity/MTF influence \u2014 never able
   * to flip bias or rescue NO_TRADE on its own.
   */
  executionLayerCap: number;
  /** Target-horizon guard in ATR multiples (null = unlimited). */
  targetMaxAtrMultiple: number | null;
  /** SCALPING: fresh execution evidence is mandatory. */
  requiresTriggerEvidence: boolean;
  /** SWING: readable HTF context is mandatory. */
  requiresHtfContext: boolean;
  /** INTRADAY: reject when high-impact events are imminent (hours; null = off). */
  eventRiskWindowHours: number | null;
}

export const STYLE_PROFILES: Record<TradingStyle, StyleProfile> = {
  scalping: {
    style: "scalping",
    allowedSetupTfs: ["M15", "H1"],
    fallbackTf: "H1",
    priceStaleMs: 10 * 60 * 1000,
    fundamentalLayerMultiplier: 0.5,
    fundamentalLayerCap: 8,
    macroYieldLayerCap: 2,
    cotLayerCap: 1,
    eiaLayerCap: 1,
    executionLayerCap: 6,
    targetMaxAtrMultiple: 6,
    requiresTriggerEvidence: true,
    requiresHtfContext: false,
    eventRiskWindowHours: null,
  },
  intraday: {
    style: "intraday",
    allowedSetupTfs: ["M15", "H1", "H4"],
    fallbackTf: "H4",
    priceStaleMs: 30 * 60 * 1000,
    fundamentalLayerMultiplier: 1,
    fundamentalLayerCap: 15,
    macroYieldLayerCap: 8,
    cotLayerCap: 5,
    eiaLayerCap: 4,
    executionLayerCap: 3,
    targetMaxAtrMultiple: null,
    requiresTriggerEvidence: false,
    requiresHtfContext: false,
    eventRiskWindowHours: 2,
  },
  swing: {
    style: "swing",
    allowedSetupTfs: ["H4", "D1", "W1"],
    fallbackTf: "H4",
    priceStaleMs: 60 * 60 * 1000,
    fundamentalLayerMultiplier: 1.25,
    fundamentalLayerCap: 18,
    macroYieldLayerCap: 12,
    cotLayerCap: 12,
    eiaLayerCap: 8,
    executionLayerCap: 1,
    targetMaxAtrMultiple: null,
    requiresTriggerEvidence: false,
    requiresHtfContext: true,
    eventRiskWindowHours: null,
  },
};

export function resolveStyle(style?: TradingStyle | string): StyleProfile {
  const s = TRADING_STYLES.includes(style as TradingStyle)
    ? (style as TradingStyle)
    : DEFAULT_TRADING_STYLE;
  return STYLE_PROFILES[s];
}

/**
 * Adaptive timeframe selection over the EXISTING ladder (no synthetic
 * timeframes): if the requested setup TF sits outside the style's horizon,
 * fall back to the nearest allowed ladder TF and DISCLOSE it.
 */
export function adaptSetupTimeframe(
  style: TradingStyle,
  requested: string,
): { timeframe: string; fallbackApplied: boolean; reason?: string } {
  const profile = STYLE_PROFILES[style];
  if (profile.allowedSetupTfs.includes(requested)) {
    return { timeframe: requested, fallbackApplied: false };
  }
  return {
    timeframe: profile.fallbackTf,
    fallbackApplied: true,
    reason: `${style.toUpperCase()} horizon does not use ${requested} as a setup timeframe — fell back to ${profile.fallbackTf} (real provider data, nothing synthesized)`,
  };
}
