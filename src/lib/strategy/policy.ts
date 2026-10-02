/**
 * Phase 312 addendum — the USER risk-policy input layer.
 *
 * POLICY BOUNDARY (unchanged): the source document's 1–2% per-trade rule is a
 * CONFIGURABLE/educational strategy policy, never an automatic command. The
 * default policy is EMPTY: nothing about the user's money is assumed, and no
 * sizing is computed until the user explicitly supplies inputs. This module
 * only normalizes and validates what the caller brings.
 */

import { resolveStyle, type TradingStyle } from "../trading-style";

/** Product type where relevant (crypto: spot vs futures/perpetual, etc.). */
export type ProductType = "spot" | "futures" | "perpetual" | "cfd" | "cash";

export interface RiskPolicyInput {
  /** Account equity in the account currency. Sizing stays UNAVAILABLE without it. */
  accountEquity?: number;
  /** ISO-style account currency code (e.g. "USD"). Optional. */
  accountCurrency?: string;
  /** Maximum risk per trade as a FRACTION of equity (0.01 = 1%). User-chosen. */
  maxRiskPercent?: number;
  /** Fixed monetary risk per trade (account currency). Alternative to a fraction. */
  fixedRiskAmount?: number;
  /** Preferred trading style — reuses the engine's existing style policy. */
  tradingStyle?: TradingStyle | string;
  /** Product type where relevant (crypto spot vs futures/perpetual, commodity CFD). */
  productType?: ProductType | string;
  /** Optional constraint: reject plans whose R:R falls below this. */
  minAcceptableRR?: number;
  /** Optional constraint: never suggest leverage above this. */
  maxLeveragePreference?: number;
}

/**
 * The default policy: EMPTY. No equity, no risk fraction, no leverage —
 * the system must never silently risk the user's money.
 */
export const DEFAULT_RISK_POLICY: RiskPolicyInput = {};

/** Hard guard band reused from the risk engine's own contract (0–10%). */
export const MAX_ACCEPTED_RISK_PERCENT = 0.1;

export interface NormalizedRiskPolicy {
  available: boolean;
  unavailableReason?: string;
  equity?: number;
  accountCurrency?: string;
  /** Risk budget in the account currency (from a fraction or a fixed amount). */
  riskAmount?: number;
  /** The fraction actually applied (present when derived from a fraction). */
  riskPercent?: number;
  style?: ReturnType<typeof resolveStyle>;
  productType?: string;
  minAcceptableRR?: number;
  maxLeveragePreference?: number;
}

/**
 * Normalize a user policy into a computed risk budget. Deterministic, pure.
 * `available: false` always carries the exact missing-input reason; nothing is
 * defaulted behind the user's back.
 */
export function normalizeRiskPolicy(policy: RiskPolicyInput | undefined): NormalizedRiskPolicy {
  if (!policy || (policy.accountEquity === undefined && policy.fixedRiskAmount === undefined)) {
    return {
      available: false,
      unavailableReason:
        "no risk policy configured — sizing is never computed by default; supply account equity and a max risk per trade to enable it",
    };
  }
  const equity = policy.accountEquity;
  if (equity !== undefined && (!Number.isFinite(equity) || equity <= 0)) {
    return { available: false, unavailableReason: "configured account equity is not a positive number" };
  }
  let riskAmount: number | undefined;
  let riskPercent: number | undefined;
  if (policy.fixedRiskAmount !== undefined) {
    if (!Number.isFinite(policy.fixedRiskAmount) || policy.fixedRiskAmount <= 0) {
      return { available: false, unavailableReason: "configured fixed risk amount is not a positive number" };
    }
    riskAmount = policy.fixedRiskAmount;
    if (equity !== undefined) riskPercent = policy.fixedRiskAmount / equity;
  } else {
    const frac = policy.maxRiskPercent;
    if (frac === undefined || !Number.isFinite(frac) || frac <= 0) {
      return {
        available: false,
        unavailableReason:
          "risk fraction not configured — choose your own maximum risk per trade (the engine never applies one for you)",
      };
    }
    if (frac > MAX_ACCEPTED_RISK_PERCENT) {
      return {
        available: false,
        unavailableReason: `configured risk fraction ${frac} is outside the accepted 0–10% guard band`,
      };
    }
    if (equity === undefined) {
      return { available: false, unavailableReason: "risk fraction configured but account equity is missing" };
    }
    riskPercent = frac;
    riskAmount = equity * frac;
  }
  return {
    available: true,
    equity,
    ...(policy.accountCurrency !== undefined ? { accountCurrency: policy.accountCurrency } : {}),
    riskAmount: riskAmount!,
    ...(riskPercent !== undefined ? { riskPercent } : {}),
    // Only an EXPLICITLY configured style becomes a probability match
    // constraint — the engine's default style must never silently narrow
    // the historical match.
    ...(policy.tradingStyle !== undefined ? { style: resolveStyle(policy.tradingStyle) } : {}),
    ...(policy.productType !== undefined ? { productType: policy.productType } : {}),
    ...(policy.minAcceptableRR !== undefined ? { minAcceptableRR: policy.minAcceptableRR } : {}),
    ...(policy.maxLeveragePreference !== undefined
      ? { maxLeveragePreference: policy.maxLeveragePreference }
      : {}),
  };
}
