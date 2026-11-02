/**
 * Phase 3B — Risk model & position sizing.
 *
 * NON-NEGOTIABLE: contract specifications vary per instrument/provider/broker.
 * This module NEVER assumes a contract size, tick value, lot convention, or
 * leverage. Sizing is computed ONLY when a complete InstrumentSpec plus real
 * account inputs are provided — otherwise it returns an explicit
 * unavailable state with the reason.
 */
import { resolveConversionRate } from "./risk/fx";

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
  /** Where this specification came from (e.g. "user-provided", provider name).
   *  Only set when the value was actually observed — never inferred. */
  source?: string;
}

/** Which required spec fields are missing, if any. */
export function specGaps(spec: InstrumentSpec | undefined): string[] {
  if (!spec) return ["instrument specification not provided"];
  const gaps: string[] = [];
  if (!Number.isFinite(spec.contractSize) || (spec.contractSize ?? 0) <= 0) gaps.push("contract size");
  if (typeof spec.quoteCurrency !== "string" || !spec.quoteCurrency.trim()) gaps.push("quote currency");
  if (!Number.isFinite(spec.quantityStep) || (spec.quantityStep ?? 0) <= 0) gaps.push("quantity step");
  if (spec.minQuantity !== undefined && (!Number.isFinite(spec.minQuantity) || spec.minQuantity <= 0)) {
    gaps.push("minimum quantity");
  }
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
  /** Explicit account currency. When omitted, sizing stays denominated in
   *  the instrument's quote currency (Phase 3B behavior preserved). */
  accountCurrency?: string;
  /** Observed FX snapshots usable for quote→account conversion.
   *  Real-time and dated reference sources must disclose their timestamp/provenance.
   *  Never use embedded constants. */
  fxDirect?: FxRateSnapshot;
  fxInverse?: FxRateSnapshot;
  /** Evaluation clock (ms) for staleness checks; defaults to Date.now(). */
  now?: number;
}

/** A market FX rate observed from a provider (never an embedded constant). */
export interface FxRateSnapshot {
  /** Rate for the quoted pair, e.g. pair="EUR/USD" rate=1.08 means 1 EUR = 1.08 USD. */
  rate: number;
  timestamp: number;
  source: string;
  /** The literal pair the rate was observed for, e.g. "EUR/USD" or "USD/EUR". */
  pair: string;
  /** Optional source-specific freshness ceiling for dated reference feeds. */
  maxAgeMs?: number;
}

export interface ConversionInfo {
  from: string;
  to: string;
  rate: number;
  direction: "same" | "direct" | "inverse";
  source: string;
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
  /** Currency all monetary outputs are denominated in. */
  denominationCurrency?: string;
  /** Quote→account currency conversion actually applied, if any. */
  conversion?: ConversionInfo;
  /** Where each critical spec field came from. */
  specificationSource?: string;
}

/**
 * Compute position size from REAL inputs only:
 *   riskAmount = equity × riskPercent   (account currency)
 *   riskPerUnit = |entry − stopLoss| × contractSize   (quote currency)
 *   converted via an observed provider FX rate when account ≠ quote currency
 *   (a dated reference rate is allowed only with its explicit source date/age policy)
 *   quantity = floor(riskAmount / riskPerUnit / step) × step
 *
 * Returns an explicit unavailable state whenever ANY input is missing,
 * invalid, or the specification is incomplete. Never estimates, never
 * substitutes leverage for risk sizing, never fabricates an FX rate.
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
  if (
    !Number.isFinite(req.entry) || req.entry <= 0 ||
    !Number.isFinite(req.stopLoss) || req.stopLoss <= 0
  ) {
    return { available: false, unavailableReason: "entry and structural stop must be finite positive prices" };
  }
  const gaps = specGaps(req.spec);
  if (gaps.length > 0) {
    return {
      available: false,
      unavailableReason: `cannot compute position size — incomplete or invalid instrument specification (${gaps.join(", ")})`,
    };
  }
  const spec = req.spec!;
  const distance = Math.abs(req.entry - req.stopLoss);
  if (!Number.isFinite(distance) || distance <= 0) {
    return { available: false, unavailableReason: "entry and structural stop define no finite risk distance" };
  }

  // ── Currency resolution (Phase 4) ────────────────────────────────
  const quoteCcy = spec.quoteCurrency!.trim().toUpperCase();
  const accountCcy = req.accountCurrency?.trim().toUpperCase();
  let conversion: ConversionInfo | undefined;
  let denomFactor = 1;
  if (accountCcy) {
    const conv = resolveConversionRate(quoteCcy, accountCcy, {
      now: req.now ?? Date.now(),
      direct: req.fxDirect,
      inverse: req.fxInverse,
    });
    if (!conv.available) {
      return {
        available: false,
        unavailableReason: `cannot compute position size — ${conv.reason} (quote ${quoteCcy} → account ${accountCcy})`,
      };
    }
    denomFactor = conv.rate;
    conversion = {
      from: quoteCcy,
      to: accountCcy,
      rate: conv.rate,
      direction: conv.direction,
      source: conv.source,
    };
  }
  const denom = accountCcy ?? quoteCcy;

  const riskAmount = req.equity * req.riskPercent;
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return { available: false, unavailableReason: "computed risk budget is not finite and positive" };
  }
  const riskPerUnitQuote = distance * spec.contractSize!;
  if (!Number.isFinite(riskPerUnitQuote) || riskPerUnitQuote <= 0) {
    return { available: false, unavailableReason: "computed quote-currency risk per unit is not finite and positive — check price distance and contract size" };
  }
  const riskPerUnit = riskPerUnitQuote * denomFactor;
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
    return { available: false, unavailableReason: "computed account-currency risk per unit is not finite and positive" };
  }

  const rawQuantity = riskAmount / riskPerUnit;
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
    return { available: false, unavailableReason: "computed raw position quantity is not finite and positive" };
  }
  const step = spec.quantityStep!;
  let quantity = Math.floor(rawQuantity / step) * step;

  // Keep the step-rounded quantity at full useful precision; a fixed 1e-9
  // multiplier incorrectly erased valid quantities for finer-grained specs.
  quantity = Number(quantity.toPrecision(15));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      available: false,
      unavailableReason: `risk budget yields less than one tradable quantity step (${step})`,
      riskAmount,
      riskPerUnit,
    };
  }

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
    quantityUnit: `${quoteCcy}-quoted contract${spec.contractSize !== 1 ? ` (×${spec.contractSize})` : ""}`,
    appliedRiskPercent: req.riskPercent,
    denominationCurrency: denom,
    conversion,
    specificationSource: spec.source?.trim() || "user-provided",
  };
}
