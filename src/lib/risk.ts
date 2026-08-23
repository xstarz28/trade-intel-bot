/**
 * Phase 3B — Risk model & position sizing.
 *
 * NON-NEGOTIABLE: contract specifications vary per instrument/provider/broker.
 * This module NEVER assumes a contract size, tick value, lot convention, or
 * leverage. Sizing is computed ONLY when a complete InstrumentSpec plus real
 * account inputs are provided — otherwise it returns an explicit
 * unavailable state with the reason.
 */

/** Instrument specification — must come from a provider/broker, never assumed. */
export interface InstrumentSpec {
  /** e.g. "forex" | "crypto" | "stock" | "commodity" | "indices". */
  assetClass: string;
  /** Units of base asset per 1 lot/contract (e.g. 100000 for EUR/USD std lot). */
  contractSize?: number;
  /** Currency in which P&L is denominated for this instrument. */
  quoteCurrency?: string;
  /** Minimum price increment. */
  tickSize?: number;
  /** Monetary value of one tick per lot/contract in the account currency. */
  tickValue?: number;
  /** Smallest tradable quantity. */
  minQuantity?: number;
  /** Quantity granularity (step). Quantities round DOWN to this step. */
  quantityStep?: number;
}

/** Which required spec fields are missing, if any. */
export function specGaps(spec: InstrumentSpec | undefined): string[] {
  if (!spec) return ["instrument specification not provided"];
  const gaps: string[] = [];
  if (!spec.contractSize || spec.contractSize <= 0) gaps.push("contract size");
  if (!spec.quoteCurrency) gaps.push("quote currency");
  if (!spec.quantityStep || spec.quantityStep <= 0) gaps.push("quantity step");
  return gaps;
}

export interface PositionSizingRequest {
  /** Account equity in the ACCOUNT currency. */
  equity: number;
  /** Risk per trade as a FRACTION of equity (0.01 = 1%). User-chosen. */
  riskPercent: number;
  entry: number;
  /** Structural stop level (market-derived). */
  stopLoss: number;
  spec?: InstrumentSpec;
}

export interface PositionSizingResult {
  available: boolean;
  /** Present when available=false — why sizing cannot be computed. */
  unavailableReason?: string;
  /** Account currency at risk if SL is hit. */
  riskAmount?: number;
  /** Loss per 1 unit of quantity if SL is hit (account/quote currency). */
  riskPerUnit?: number;
  /** Computed position size, rounded DOWN to the spec's quantity step. */
  quantity?: number;
  /** Quantity unit description from the spec context. */
  quantityUnit?: string;
  /** The user-chosen risk fraction actually applied (for transparency). */
  appliedRiskPercent?: number;
}

/**
 * Compute position size from REAL inputs only:
 *   riskAmount = equity × riskPercent
 *   riskPerUnit = |entry − stopLoss| × contractSize
 *   quantity = floor(riskAmount / riskPerUnit / step) × step
 *
 * Returns an explicit unavailable state whenever ANY input is missing,
 * invalid, or the specification is incomplete. Never estimates, never
 * substitutes leverage for risk sizing.
 */
export function computePositionSizing(req: PositionSizingRequest): PositionSizingResult {
  if (!Number.isFinite(req.equity) || req.equity <= 0) {
    return { available: false, unavailableReason: "account equity not provided or invalid" };
  }
  if (
    !Number.isFinite(req.riskPercent) ||
    req.riskPercent <= 0 ||
    req.riskPercent > 0.1
  ) {
    return {
      available: false,
      unavailableReason:
        "risk percent not provided or outside the accepted 0–10% guard band — choose your own risk per trade",
    };
  }
  const gaps = specGaps(req.spec);
  if (gaps.length > 0) {
    return {
      available: false,
      unavailableReason: `cannot compute position size — incomplete instrument specification (${gaps.join(", ")})`,
    };
  }
  const spec = req.spec!;
  const distance = Math.abs(req.entry - req.stopLoss);
  if (!Number.isFinite(distance) || distance <= 0) {
    return { available: false, unavailableReason: "entry and structural stop define no risk distance" };
  }

  const riskAmount = req.equity * req.riskPercent;
  const riskPerUnit = distance * spec.contractSize!;
  if (!(riskPerUnit > 0)) {
    return { available: false, unavailableReason: "computed risk per unit is zero — check contract size" };
  }

  const rawQuantity = riskAmount / riskPerUnit;
  const step = spec.quantityStep!;
  let quantity = Math.floor(rawQuantity / step) * step;

  // Guard floating-point residue before the minimum-quantity comparison.
  quantity = Math.round(quantity * 1e9) / 1e9;

  if (spec.minQuantity !== undefined && quantity < spec.minQuantity) {
    return {
      available: false,
      unavailableReason: `required risk budget yields ${rawQuantity.toFixed(6)} units — below the instrument minimum of ${spec.minQuantity}`,
      riskAmount,
      riskPerUnit,
    };
  }

  return {
    available: true,
    riskAmount,
    riskPerUnit,
    quantity,
    quantityUnit: `${spec.quoteCurrency}-quoted contract${spec.contractSize !== 1 ? ` (×${spec.contractSize})` : ""}`,
    appliedRiskPercent: req.riskPercent,
  };
}
