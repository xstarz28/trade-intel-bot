/**
 * Phase 312 — deterministic, NON-EXECUTING trade risk math.
 *
 * POLICY BOUNDARY (source document): the document states a per-trade risk rule
 * in the 1–2%-of-account family. That is an EDUCATIONAL/CONFIGURABLE strategy
 * policy — it is NEVER applied automatically to any user, never used to force
 * account-level risk, and never sent anywhere as an order. Position sizing in
 * this module is pure math over caller-supplied inputs: the caller must bring
 * an explicit risk budget (an absolute amount, or a fraction plus explicit
 * account equity). No default fraction exists. This module cannot place
 * orders — it computes numbers and states their provenance.
 */

export interface EducationalRiskPolicy {
  /** Source-document educational per-trade risk rule, as a REFERENCE range. */
  min: 0.01;
  max: 0.02;
  note: string;
}

/**
 * The source document's educational rule, kept as reference metadata only.
 * Nothing in the engine reads this as a default.
 */
export const PDF_EDUCATIONAL_RISK_FRACTION: EducationalRiskPolicy = {
  min: 0.01,
  max: 0.02,
  note: "Educational reference from the source document's risk-per-trade rule (1–2% of trading capital). Configurable strategy policy — never auto-applied; actual per-trade risk always comes from the caller's explicit budget.",
};

export interface TradeRiskInput {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  /** Explicit absolute risk budget (account currency). */
  riskAmount?: number;
  /** Explicit fraction of account equity; requires accountEquity. */
  riskFraction?: number;
  accountEquity?: number;
}

export interface TradeRiskPlan {
  available: boolean;
  unavailableReason?: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  /** Reward-to-risk over the planned leg: |target − entry| / |entry − stop|. */
  riskReward: number;
  /** |entry − stop| per unit. */
  perUnitRisk: number;
  /** Units sized so that hitting the stop loses exactly the risk budget. */
  positionSize?: number;
  notional?: number;
  riskBudget?: number;
  /** Where the budget came from — never an implicit default. */
  policySource: "explicit-risk-amount" | "explicit-fraction-of-explicit-equity" | "ratio-only";
}

/**
 * Compute the risk plan. Pure, deterministic, side-effect free: it can never
 * create an order or touch an account (see the module header).
 */
export function computeTradeRisk(input: TradeRiskInput): TradeRiskPlan {
  const { direction, entry, stop, target } = input;
  const perUnitRisk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  if (!(perUnitRisk > 0) || !Number.isFinite(perUnitRisk)) {
    return ratioOnlyUnavailable(direction, entry, stop, target, "stop must differ from entry");
  }
  if (!(reward >= 0) || !Number.isFinite(reward)) {
    return ratioOnlyUnavailable(direction, entry, stop, target, "target must be a finite number");
  }
  const stopOnCorrectSide = direction === "long" ? stop < entry : stop > entry;
  const targetOnCorrectSide = direction === "long" ? target > entry : target < entry;
  if (!stopOnCorrectSide) {
    return ratioOnlyUnavailable(
      direction,
      entry,
      stop,
      target,
      `stop must be ${direction === "long" ? "below" : "above"} entry for a ${direction}`,
    );
  }
  if (!targetOnCorrectSide) {
    return ratioOnlyUnavailable(
      direction,
      entry,
      stop,
      target,
      `target must be ${direction === "long" ? "above" : "below"} entry for a ${direction}`,
    );
  }

  const riskReward = reward / perUnitRisk;

  // Budget resolution — explicit inputs only.
  let riskBudget: number | undefined;
  let policySource: TradeRiskPlan["policySource"] = "ratio-only";
  if (typeof input.riskAmount === "number" && Number.isFinite(input.riskAmount) && input.riskAmount > 0) {
    riskBudget = input.riskAmount;
    policySource = "explicit-risk-amount";
  } else if (
    typeof input.riskFraction === "number" &&
    Number.isFinite(input.riskFraction) &&
    input.riskFraction > 0 &&
    typeof input.accountEquity === "number" &&
    Number.isFinite(input.accountEquity) &&
    input.accountEquity > 0
  ) {
    riskBudget = input.riskFraction * input.accountEquity;
    policySource = "explicit-fraction-of-explicit-equity";
  }

  const positionSize = riskBudget !== undefined ? riskBudget / perUnitRisk : undefined;
  return {
    available: true,
    direction,
    entry,
    stop,
    target,
    riskReward,
    perUnitRisk,
    ...(positionSize !== undefined
      ? { positionSize, notional: positionSize * entry, riskBudget }
      : {}),
    policySource,
  };
}

function ratioOnlyUnavailable(
  direction: "long" | "short",
  entry: number,
  stop: number,
  target: number,
  reason: string,
): TradeRiskPlan {
  return {
    available: false,
    unavailableReason: reason,
    direction,
    entry,
    stop,
    target,
    riskReward: NaN,
    perUnitRisk: NaN,
    policySource: "ratio-only",
  };
}
