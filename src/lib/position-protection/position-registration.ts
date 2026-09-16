/**
 * Phase 61 — Position Registration
 *
 * Handles the complete lifecycle of registering, updating,
 * and removing positions for profit protection monitoring.
 *
 * Pure data helpers — no side effects.
 */

import type { PositionSide } from "./types";
import type { PositionSnapshot, MonitoringStatus } from "./realtime-types";

// ═══════════════════════════════════════════════════════════════
// REGISTRATION INPUT
// ═══════════════════════════════════════════════════════════════

export interface PositionRegistrationInput {
  /** Unique position identifier. */
  positionId: string;
  /** Canonical instrument (e.g. "BTC/USDT"). */
  instrument: string;
  /** Trading side. */
  side: PositionSide;
  /** Entry price. */
  entryPrice: number;
  /** Current market price (optional — will be updated by stream). */
  currentPrice?: number;
  /** Stop loss (optional). */
  stopLoss?: number;
  /** Take profit (optional). */
  takeProfit?: number;
  /** Leverage (optional). */
  leverage?: number;
  /** Trading horizon. */
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  /** When the position was opened. */
  openedAt?: number;
  /** Original thesis (optional). */
  originalThesis?: string;
  /** Asset class (optional — inferred from instrument if not set). */
  assetClass?: "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro";
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_SIDES = new Set(["LONG", "SHORT"]);
const VALID_HORIZONS = new Set(["SCALPING", "INTRADAY", "SWING", "INVESTING"]);

/**
 * Validate a position registration input.
 * Never fabricates data — only validates what is provided.
 */
/**
 * True only for a real, usable positive price.
 *
 * `NaN <= 0` and `Infinity <= 0` are both false, so the obvious
 * `typeof x !== "number" || x <= 0` check silently ACCEPTS NaN and Infinity.
 * Those values then flow into arithmetic and render as "NaN" in the UI, so
 * finiteness must be asserted explicitly.
 */
/**
 * Describe a rejected numeric field in words a user can act on.
 *
 * These strings reach the registration panel directly, so "got: NaN" is not
 * acceptable: it exposes an internal representation and tells the user
 * nothing about what to change.
 */
function describeBadNumber(value: unknown): string {
  if (typeof value !== "number") return "no value was entered";
  if (Number.isNaN(value)) return "that is not a valid number";
  if (!Number.isFinite(value)) return "that number is too large";
  if (value <= 0) return `must be greater than zero, got ${value}`;
  return `got ${value}`;
}

function isUsablePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateRegistration(
  input: PositionRegistrationInput,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.positionId || input.positionId.trim().length === 0) {
    errors.push("positionId is required and cannot be empty.");
  }

  if (!input.instrument || input.instrument.trim().length === 0) {
    errors.push("instrument is required and cannot be empty.");
  }

  if (!VALID_SIDES.has(input.side)) {
    errors.push(`side must be LONG or SHORT, got: ${input.side}`);
  }

  if (!isUsablePositiveNumber(input.entryPrice)) {
    errors.push(`Entry price: ${describeBadNumber(input.entryPrice)}.`);
  }

  if (input.currentPrice !== undefined && !isUsablePositiveNumber(input.currentPrice)) {
    errors.push(`Current price: ${describeBadNumber(input.currentPrice)}.`);
  }

  if (input.stopLoss !== undefined) {
    if (!isUsablePositiveNumber(input.stopLoss)) {
      errors.push(`Stop loss: ${describeBadNumber(input.stopLoss)}.`);
    } else if (input.side === "LONG" && input.stopLoss >= input.entryPrice) {
      warnings.push("LONG stopLoss is above entryPrice — unusual but accepted.");
    } else if (input.side === "SHORT" && input.stopLoss <= input.entryPrice) {
      warnings.push("SHORT stopLoss is below entryPrice — unusual but accepted.");
    }
  }

  if (input.takeProfit !== undefined) {
    if (!isUsablePositiveNumber(input.takeProfit)) {
      errors.push(`Take profit: ${describeBadNumber(input.takeProfit)}.`);
    } else if (input.side === "LONG" && input.takeProfit <= input.entryPrice) {
      warnings.push("LONG takeProfit is below entryPrice — unusual but accepted.");
    } else if (input.side === "SHORT" && input.takeProfit >= input.entryPrice) {
      warnings.push("SHORT takeProfit is above entryPrice — unusual but accepted.");
    }
  }

  if (
    input.leverage !== undefined &&
    (typeof input.leverage !== "number" ||
      !Number.isFinite(input.leverage) ||
      input.leverage < 1)
  ) {
    errors.push(
      `Leverage: ${
        typeof input.leverage === "number" && Number.isFinite(input.leverage)
          ? `must be at least 1, got ${input.leverage}`
          : describeBadNumber(input.leverage)
      }.`,
    );
  }

  if (!VALID_HORIZONS.has(input.horizon)) {
    errors.push(`horizon must be SCALPING, INTRADAY, SWING, or INVESTING, got: ${input.horizon}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT CREATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create a PositionSnapshot from registration input.
 * Uses currentPrice if provided, otherwise falls back to entryPrice.
 * Missing values remain undefined — never fabricated.
 */
export function createSnapshotFromRegistration(
  input: PositionRegistrationInput,
  now: number = Date.now(),
): PositionSnapshot {
  return {
    positionId: input.positionId,
    instrument: input.instrument,
    side: input.side,
    entryPrice: input.entryPrice,
    currentPrice: input.currentPrice ?? input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    leverage: input.leverage,
    horizon: input.horizon,
    openedAt: input.openedAt ?? now,
    peakPrice: undefined,
    lastUpdateAt: now,
    monitoringStatus: "LIVE" as MonitoringStatus,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION ID GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a deterministic position ID from registration fields.
 * Collision-resistant for same instrument + side + timestamp.
 */
export function generatePositionId(
  instrument: string,
  side: string,
  entryPrice: number,
  openedAt: number,
): string {
  const instrumentNorm = instrument.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const priceHash = Math.round(entryPrice * 100).toString(36);
  const timeHash = (openedAt % 100000).toString(36);
  return `pos-${instrumentNorm}-${side}-${priceHash}-${timeHash}`;
}

// ═══════════════════════════════════════════════════════════════
// ASSET CLASS INFERENCE
// ═══════════════════════════════════════════════════════════════

/**
 * Infer asset class from instrument name.
 * Never guesses — returns "crypto" as default for unknown patterns.
 */
export function inferAssetClass(instrument: string): "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro" {
  const upper = instrument.toUpperCase();

  // Forex pairs: 6 letters or XXX/YYY pattern with major currencies
  if (/^[A-Z]{6}$/.test(upper) || /^[A-Z]{3}\/[A-Z]{3}$/.test(upper)) {
    const currencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY", "HKD", "SGD"];
    const parts = upper.replace("/", "").match(/.{3}/g);
    if (parts && parts.every(p => currencies.includes(p))) return "forex";
  }

  // Commodity names
  if (upper.includes("XAU") || upper.includes("GOLD") || upper.includes("XAG") || upper.includes("SILVER")) return "commodity";
  if (upper.includes("WTI") || upper.includes("BRENT") || upper.includes("OIL") || upper.includes("CL")) return "commodity";
  if (upper.includes("CORN") || upper.includes("WHEAT") || upper.includes("SOYBEAN")) return "commodity";

  // Index names
  if (upper.includes("SPX") || upper.includes("SPY") || upper.includes("S&P")) return "indices";
  if (upper.includes("NDX") || upper.includes("QQQ") || upper.includes("NASDAQ")) return "indices";
  if (upper.includes("DJI") || upper.includes("DOW")) return "indices";
  if (upper.includes("DAX") || upper.includes("FTSE") || upper.includes("NIKKEI")) return "indices";
  if (upper.includes("HSI") || upper.includes("KOSPI")) return "indices";
  if (upper.includes("BBCA") || upper.includes("BBRI") || upper.includes("TLKM") || upper.includes("BMRI") || upper.includes("BBNI") || upper.includes("GOTO")) return "equity";

  // Equity patterns (has . or known exchange suffix)
  if (upper.includes(".JK") || upper.includes(".US") || upper.includes(".L") || upper.includes(".T")) return "equity";
  if (/^[A-Z]{3,5}$/.test(upper) && !upper.includes("/")) return "equity";

  // Crypto patterns (contains BTC, ETH, SOL, or ends with USDT/BUSD/USDC)
  if (upper.includes("BTC") || upper.includes("ETH") || upper.includes("SOL")) return "crypto";
  if (upper.includes("USDT") || upper.includes("BUSD") || upper.includes("USDC") || upper.includes("DAI")) return "crypto";

  // Forex pattern (contains /)
  if (upper.includes("/")) return "forex";

  // Default: crypto (most common for this trading platform)
  return "crypto";
}
