/**
 * Phase 312 — journal R-multiple and Expected Value from RECORDED outcomes.
 *
 * Expected Value is computed ONLY from actually recorded historical trade
 * outcomes (journal entries the user closed). The formula is transparent and
 * reproducible: EV = (1/n)·Σ Rᵢ — the mean R-multiple per trade. With fewer
 * than MIN_EV_SAMPLE recorded outcomes the answer is explicitly "insufficient
 * data"; nothing is extrapolated, no assumption distribution is invented.
 */

/** ENGINE-DEFINED minimum sample for a reportable EV (documented). */
export const MIN_EV_SAMPLE = 10;

export interface RMultipleInput {
  direction: "long" | "short";
  entry: number;
  stop: number;
  exit: number;
}

export interface RMultipleResult {
  available: boolean;
  unavailableReason?: string;
  rMultiple: number;
  perUnitRisk: number;
}

/**
 * Deterministic R-multiple of a recorded trade: profit/loss in units of the
 * planned per-unit risk. Direction-aware; a missing/degenerate stop makes the
 * R-multiple UNDEFINED (not zero — zero would be a fake measurement).
 */
export function rMultipleFromTrade(input: RMultipleInput): RMultipleResult {
  const risk = Math.abs(input.entry - input.stop);
  if (!(risk > 0) || !Number.isFinite(risk)) {
    return {
      available: false,
      unavailableReason: "stop must differ from entry to define one unit of risk",
      rMultiple: NaN,
      perUnitRisk: NaN,
    };
  }
  const raw =
    input.direction === "long"
      ? (input.exit - input.entry) / risk
      : (input.entry - input.exit) / risk;
  if (!Number.isFinite(raw)) {
    return {
      available: false,
      unavailableReason: "exit must be a finite number",
      rMultiple: NaN,
      perUnitRisk: risk,
    };
  }
  return { available: true, rMultiple: raw, perUnitRisk: risk };
}

export interface ExpectedValueResult {
  available: boolean;
  unavailableReason?: string;
  /** Sample size (recorded outcomes used). */
  n: number;
  /** EV = (1/n)·Σ Rᵢ — mean R-multiple per trade. */
  expectedValue: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Share of recorded outcomes with R > 0. */
  winRate: number;
  /** The exact formula, stated so anyone can reproduce the number. */
  formula: string;
}

/**
 * Expected Value over RECORDED R-multiples. Deterministic; insufficient
 * samples return unavailable rather than a made-up number.
 */
export function expectedValueFromOutcomes(
  rMultiples: number[],
  minSample: number = MIN_EV_SAMPLE,
): ExpectedValueResult {
  const finite = rMultiples.filter((r) => Number.isFinite(r));
  if (finite.length < minSample) {
    return {
      available: false,
      unavailableReason: `insufficient recorded outcomes: ${finite.length} available, ${minSample} required`,
      n: finite.length,
      expectedValue: NaN,
      wins: 0,
      losses: 0,
      breakeven: 0,
      winRate: NaN,
      formula: "EV = (1/n)·Σ Rᵢ",
    };
  }
  const n = finite.length;
  const sum = finite.reduce((a, b) => a + b, 0);
  const wins = finite.filter((r) => r > 0).length;
  const losses = finite.filter((r) => r < 0).length;
  const breakeven = finite.filter((r) => r === 0).length;
  return {
    available: true,
    n,
    expectedValue: sum / n,
    wins,
    losses,
    breakeven,
    winRate: wins / n,
    formula: "EV = (1/n)·Σ Rᵢ (per-trade expectancy in R, over recorded outcomes only)",
  };
}
