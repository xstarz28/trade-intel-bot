/**
 * Phase 312 addendum — product-specific POSITION MECHANICS (never execution).
 *
 * Order of operations is fixed and auditable:
 *   1. Position size is computed from the ALLOWED RISK first, via the existing
 *      risk engine (`computePositionSizing`) — spec-driven, never assumed.
 *   2. Only THEN is leverage compatibility assessed for futures/perpetual
 *      products: leverage changes margin requirements and liquidation
 *      constraints, NEVER the risk at the stop and never the R:R. The engine
 *      will never suggest leverage to "make profit bigger".
 *   3. Every product-specific figure (pips, lots, shares, contracts) is
 *      derived only from specifications that were actually supplied; missing
 *      conversion/spec evidence yields an explicit UNAVAILABLE state, never an
 *      invented lot/share/contract count.
 *
 * This module is pure: it cannot place, route, or simulate order submission.
 */

import {
  computePositionSizing,
  type FxRateSnapshot,
  type InstrumentSpec,
  type PositionSizingResult,
} from "../risk";
import type { NormalizedRiskPolicy } from "./policy";

/** Exchange-native contract data — accepted ONLY when a provider supplied it. */
export interface ContractMeta {
  source: string;
  /** Maintenance-margin rate (fraction), e.g. 0.005 — from the exchange. */
  maintenanceMarginRate?: number;
  /** Contract's maximum leverage, e.g. 100 — from the exchange. */
  maxLeverage?: number;
  /** Last observed funding rate (fraction per interval) + its observation time. */
  fundingRate?: number;
  fundingObservedAt?: number;
}

/** Forex specs additionally need the pip definition — never assumed. */
export type SizingSpec = InstrumentSpec & { pipSize?: number };

export interface LeverageCompatibility {
  available: boolean;
  reason?: string;
  /** Mechanical explanation — always rendered where leverage is discussed. */
  mechanicsNote: string;
  suggestedRange?: { min: number; max: number };
  /** Approximate liquidation price per leverage in `checkedLeverage`. */
  liquidationCheck?: {
    available: boolean;
    reason?: string;
    checkedLeverage: number;
    approximateLiquidationPrice?: number;
    stopIsSafe?: boolean;
    formula: string;
  };
  fundingCaveat?: string;
}

export interface PositionMechanics {
  productType: string;
  /** The core risk-first sizing result (shared by every product). */
  sizing: PositionSizingResult;
  /** Policy provenance — the budget came from the user, never a default. */
  policySource: string;
  // ── crypto ──
  spot?: {
    quantity?: number;
    notional?: number;
    slDistance?: number;
    expectedLossAtSL?: number;
  };
  futures?: {
    notional?: number;
    riskAmountAtSL?: number;
    leverage?: LeverageCompatibility;
  };
  // ── forex ──
  forex?: {
    available: boolean;
    reason?: string;
    stopDistancePips?: number;
    targetDistancePips?: number;
    pipValuePerStandardLot?: number;
    lotSize?: number;
    standardLots?: number;
    miniLots?: number;
    microLots?: number;
  };
  // ── stock ──
  stock?: {
    available: boolean;
    reason?: string;
    shares?: number;
    riskPerShare?: number;
    notional?: number;
    constraints?: string[];
  };
  // ── commodity ──
  commodity?: {
    available: boolean;
    reason?: string;
    mode?: "units" | "contracts" | "cfd";
    units?: number;
    contracts?: number;
    contractMultiplier?: number;
    multiplierSource?: string;
    notional?: number;
  };
  /** Constant: this layer computes numbers and can never execute anything. */
  executesOrders: false;
}

const MARGIN_BUFFER = 0.5; // engine-defined: suggested margin must fit in half the equity

function leverageCompatibility(args: {
  productType: string;
  notional: number;
  equity: number;
  entry: number;
  stop: number;
  direction: "long" | "short";
  preference?: number;
  meta?: ContractMeta;
}): LeverageCompatibility {
  const mechanicsNote =
    "Leverage sets the required margin (notional ÷ leverage) and the liquidation constraint. It does NOT change the loss at the stop — position risk is driven by position size and stop distance, so size is computed from the risk budget FIRST and leverage is only checked for compatibility afterwards.";
  const { notional, equity, entry, stop, direction, preference, meta } = args;
  if (!meta) {
    return {
      available: false,
      reason:
        "contract specifications (maintenance margin / max leverage) are not known from any provider — no leverage range is suggested and no liquidation check is performed; sizing above is unchanged",
      mechanicsNote,
    };
  }
  const minRaw = notional / Math.max(equity * MARGIN_BUFFER, Number.MIN_VALUE);
  const minCompatible = Math.ceil(minRaw);
  const maxAllowed = Math.min(
    meta.maxLeverage ?? Number.POSITIVE_INFINITY,
    preference ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(maxAllowed) || minCompatible > maxAllowed) {
    return {
      available: true,
      mechanicsNote,
      reason: `the notional ${notional} needs ≥ ${minCompatible}x to fit the margin buffer, but the allowed maximum is ${
        Number.isFinite(maxAllowed) ? maxAllowed : "unbounded-spec"
      } — the position requires more capital or a smaller size; leverage is never raised to force compatibility`,
    };
  }
  const range = { min: minCompatible, max: maxAllowed };
  // The liquidation approximation is checked at the TOP of the compatible
  // range — the highest leverage in range is the least safe (liquidation
  // closest to entry), so this is the conservative choice. At 1x the formula
  // has no meaning (no borrowed funds), which the top-of-range check avoids.
  const checked = Number.isFinite(maxAllowed) ? maxAllowed : minCompatible;
  let liquidationCheck: LeverageCompatibility["liquidationCheck"];
  if (meta.maintenanceMarginRate === undefined) {
    liquidationCheck = {
      available: false,
      reason: "maintenance-margin rate was not supplied by the provider — no liquidation-price estimate is produced",
      checkedLeverage: checked,
      formula: "long ≈ entry × (1 − 1/L + MMR); short ≈ entry × (1 + 1/L − MMR)",
    };
  } else {
    const mmr = meta.maintenanceMarginRate;
    const liq =
      direction === "long"
        ? entry * (1 - 1 / checked + mmr)
        : entry * (1 + 1 / checked - mmr);
    const stopIsSafe = direction === "long" ? stop < liq : stop > liq;
    liquidationCheck = {
      available: true,
      checkedLeverage: checked,
      approximateLiquidationPrice: liq,
      stopIsSafe,
      formula:
        direction === "long"
          ? `long ≈ entry × (1 − 1/${checked} + ${mmr}) = ${liq}`
          : `short ≈ entry × (1 + 1/${checked} − ${mmr}) = ${liq}`,
    };
  }
  const fundingCaveat =
    meta.fundingRate !== undefined
      ? `provider-observed funding rate ${meta.fundingRate} (observed at ${meta.fundingObservedAt}) — carrying costs apply and are not part of the R:R math`
      : undefined;
  return { available: true, mechanicsNote, suggestedRange: range, liquidationCheck, ...(fundingCaveat ? { fundingCaveat } : {}) };
}

const LOT_SIZE_UNAVAILABLE = "LOT SIZE UNAVAILABLE — missing conversion/spec evidence";

export function buildPositionMechanics(args: {
  instrumentType: string;
  productType?: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target?: number;
  policy?: NormalizedRiskPolicy;
  spec?: SizingSpec;
  contractMeta?: ContractMeta;
  fxDirect?: FxRateSnapshot;
  fxInverse?: FxRateSnapshot;
  now?: number;
}): PositionMechanics {
  const productType = args.productType ?? args.instrumentType;
  let sizing: PositionSizingResult = {
    available: false,
    unavailableReason:
      "no risk policy configured — sizing is never computed by default; supply account equity and a max risk per trade to enable it",
  };
  let policySource = "not configured";
  const policy = args.policy;
  if (policy?.available && policy.riskAmount !== undefined) {
    const spec = args.spec;
    if (!spec) {
      sizing = {
        available: false,
        unavailableReason:
          "no instrument specification was supplied (contract size / quantity step / quote currency) — nothing is assumed",
      };
    } else {
      const fraction =
        policy.riskPercent !== undefined
          ? policy.riskPercent
          : policy.equity !== undefined
            ? policy.riskAmount / policy.equity
            : undefined;
      sizing = computePositionSizing({
        equity: policy.equity!,
        riskPercent: fraction!,
        entry: args.entry,
        stopLoss: args.stop,
        spec,
        ...(policy.accountCurrency !== undefined ? { accountCurrency: policy.accountCurrency } : {}),
        ...(args.fxDirect ? { fxDirect: args.fxDirect } : {}),
        ...(args.fxInverse ? { fxInverse: args.fxInverse } : {}),
        ...(args.now !== undefined ? { now: args.now } : {}),
      });
    }
    policySource = "user-configured risk policy";
  }
  const qty = sizing.available ? sizing.quantity! : undefined;
  const slDistance = Math.abs(args.entry - args.stop);
  const notional = qty !== undefined ? qty * args.entry : undefined;
  const riskAtSL = sizing.available ? sizing.riskAmount! : undefined;

  const out: PositionMechanics = {
    productType,
    sizing,
    policySource,
    executesOrders: false,
  };

  if (args.instrumentType === "crypto") {
    const isLeveraged = productType === "futures" || productType === "perpetual";
    out.spot = {
      ...(qty !== undefined ? { quantity: qty } : {}),
      ...(notional !== undefined ? { notional } : {}),
      ...(slDistance > 0 ? { slDistance } : {}),
      ...(riskAtSL !== undefined ? { expectedLossAtSL: riskAtSL } : {}),
    };
    if (isLeveraged) {
      out.futures = {
        ...(notional !== undefined ? { notional } : {}),
        ...(riskAtSL !== undefined ? { riskAmountAtSL: riskAtSL } : {}),
        leverage: leverageCompatibility({
          productType,
          notional: notional ?? 0,
          equity: policy?.equity ?? 0,
          entry: args.entry,
          stop: args.stop,
          direction: args.direction,
          ...(policy?.maxLeveragePreference !== undefined
            ? { preference: policy.maxLeveragePreference }
            : {}),
          ...(args.contractMeta ? { meta: args.contractMeta } : {}),
        }),
      };
    }
  }

  if (args.instrumentType === "forex") {
    const spec = args.spec;
    if (!spec || !spec.contractSize || !spec.pipSize || !spec.quoteCurrency) {
      out.forex = {
        available: false,
        reason: `${LOT_SIZE_UNAVAILABLE} (pip size / contract size / quote currency not supplied — never assumed)`,
      };
    } else {
      const stopPips = slDistance / spec.pipSize;
      const targetPips =
        args.target !== undefined && Number.isFinite(args.target)
          ? Math.abs(args.target - args.entry) / spec.pipSize
          : undefined;
      const pipValuePerStandardLot = spec.pipSize * spec.contractSize;
      const denom = sizing.denominationCurrency ?? spec.quoteCurrency;
      // Per-standard-lot pip value in the denomination currency (conversion
      // already applied by the sizing engine is 1:1 in quote currency terms
      // when the quote currency denominates; when the account currency
      // differs, the sizing engine's conversion rate is the same rate needed
      // here and it is reused — never a second, invented rate).
      const convRate = sizing.conversion ? sizing.conversion.rate : 1;
      const pipValueDenominated = pipValuePerStandardLot * convRate;
      const lotSize = qty !== undefined ? qty : undefined; // quantity IS in standard contracts
      out.forex = {
        available: sizing.available,
        ...(!sizing.available ? { reason: `${LOT_SIZE_UNAVAILABLE} (${sizing.unavailableReason})` } : {}),
        ...(sizing.available
          ? {
              stopDistancePips: stopPips,
              ...(targetPips !== undefined ? { targetDistancePips: targetPips } : {}),
              pipValuePerStandardLot: pipValueDenominated,
              // computePositionSizing returns quantity in CONTRACTS (one
              // contract = contractSize units of quote), i.e. standard lots:
              // the mini/micro nomenclature is the spec's contract size
              // divided by 10 / 100 — stated, not assumed.
              ...(lotSize !== undefined ? { lotSize, standardLots: lotSize } : {}),
              ...(lotSize !== undefined
                ? {
                    miniLots: lotSize * 10,
                    microLots: lotSize * 100,
                  }
                : {}),
            }
          : {}),
      };
      void denom;
    }
  }

  if (args.instrumentType === "stock") {
    const spec = args.spec;
    if (!spec) {
      out.stock = {
        available: false,
        reason: "no instrument specification was supplied — share sizing would require assumptions",
      };
    } else {
      const constraints: string[] = [];
      if (spec.minQuantity !== undefined) constraints.push(`minimum quantity ${spec.minQuantity}`);
      if (spec.quantityStep !== undefined) constraints.push(`quantity step ${spec.quantityStep}`);
      if (spec.tickSize !== undefined) constraints.push(`price precision (tick) ${spec.tickSize}`);
      out.stock = {
        available: sizing.available,
        ...(!sizing.available ? { reason: sizing.unavailableReason } : {}),
        ...(qty !== undefined
          ? {
              shares: qty,
              riskPerShare: slDistance,
              notional: notional!,
            }
          : {}),
        ...(constraints.length > 0 ? { constraints } : {}),
      };
    }
  }

  if (args.instrumentType === "commodity") {
    const spec = args.spec;
    if (!spec) {
      out.commodity = {
        available: false,
        reason:
          "no commodity instrument specification was supplied (contract multiplier / unit definition) — one universal lot size is never assumed",
      };
    } else if (productType === "cfd") {
      out.commodity = {
        available: sizing.available,
        mode: "cfd",
        ...(!sizing.available ? { reason: sizing.unavailableReason } : {}),
        ...(qty !== undefined ? { units: qty, notional: notional! } : {}),
        ...(spec.source ? { multiplierSource: spec.source } : {}),
      };
    } else if (spec.contractSize !== undefined && spec.contractSize > 1) {
      out.commodity = {
        available: sizing.available,
        mode: "contracts",
        ...(!sizing.available ? { reason: sizing.unavailableReason } : {}),
        ...(qty !== undefined
          ? {
              // quantity is in contracts of `contractSize` units each.
              units: qty * spec.contractSize,
              contracts: qty,
              contractMultiplier: spec.contractSize,
              notional: notional!,
            }
          : {}),
        ...(spec.source ? { multiplierSource: spec.source } : {}),
      };
    } else {
      out.commodity = {
        available: sizing.available,
        mode: "units",
        ...(!sizing.available ? { reason: sizing.unavailableReason } : {}),
        ...(qty !== undefined ? { units: qty, notional: notional! } : {}),
        ...(spec.source ? { multiplierSource: spec.source } : {}),
      };
    }
  }

  return out;
}
