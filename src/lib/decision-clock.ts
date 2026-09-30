/**
 * Phase 295 — CANONICAL DECISION CLOCK (pure).
 *
 * WHY THIS EXISTS
 * ---------------
 * The production engine is written for live transport: its freshness gates
 * compare a price snapshot with the wall clock. A historical replay must
 * reproduce what the engine would have known AT A HISTORICAL MOMENT — "is this
 * snapshot old?" has to mean "older than the instant this analysis is made at",
 * not "older than today".
 *
 * ONE mechanism, three explicit modes:
 *
 *   LIVE_WALL_CLOCK    the default, and the only mode production uses. "now" is
 *                      the real wall clock; live freshness stays exactly as
 *                      strict as before.
 *   HISTORICAL_AS_OF   a recorded replay: "now" is the historical evaluation
 *                      instant (`asOfMs`) — in Phase 294/295 that is the last
 *                      CLOSED provider candle of the prefix. Freshness is then
 *                      measured against that instant, so a candle that was
 *                      current then is current there, while a candle dated after
 *                      the instant is still a future/impossible input.
 *   FIXED_TEST_CLOCK   a deterministic injected instant for tests. Same
 *                      semantics as HISTORICAL_AS_OF; only the intent differs.
 *
 * WHAT IS NEVER OVERLOADED
 * ------------------------
 * Four instants stay separate and are never interchanged:
 *   · candle timestamp           — the provider's own bar instant;
 *   · provider observation time  — when the provider produced/observed it;
 *   · historical evaluation time  — the instant a replay claims to decide at;
 *   · wall-clock runtime time     — the process clock.
 *
 * FAIL-CLOSED RULE
 * ----------------
 * A deterministic mode without a usable instant resolves to `NaN` rather than
 * falling back to the wall clock: the engine's timestamp checks then treat the
 * snapshot as unverifiable and Gate 0 refuses it. A misconfigured replay can
 * therefore never masquerade as live, and can never silently borrow today's
 * clock.
 *
 * The instant is resolved once per analysis (see `runAnalysis`), so no gate
 * reconstructs the clock repeatedly.
 */

export interface LiveWallClock {
  mode: "LIVE_WALL_CLOCK";
  note?: string;
}

export interface HistoricalAsOfClock {
  mode: "HISTORICAL_AS_OF";
  /** The historical instant this analysis claims to have been made at. */
  asOfMs: number;
  note?: string;
}

export interface FixedTestClock {
  mode: "FIXED_TEST_CLOCK";
  /** Deterministic instant injected by a test. */
  nowMs: number;
  note?: string;
}

export type DecisionClock = LiveWallClock | HistoricalAsOfClock | FixedTestClock;
export type DecisionClockMode = DecisionClock["mode"];

/** The only clock production uses unless a replay explicitly says otherwise. */
export const LIVE_DECISION_CLOCK: LiveWallClock = {
  mode: "LIVE_WALL_CLOCK",
  note: "Live wall clock — provider freshness is measured against the real current time.",
};

export function historicalAsOfClock(
  asOfMs: number,
  note = "Recorded replay — freshness measured against the historical evaluation instant.",
): HistoricalAsOfClock {
  return { mode: "HISTORICAL_AS_OF", asOfMs, note };
}

export function fixedTestClock(nowMs: number, note = "Deterministic test clock."): FixedTestClock {
  return { mode: "FIXED_TEST_CLOCK", nowMs, note };
}

/** True when the clock may be treated as live transport (the default). */
export function isLiveClock(clock?: DecisionClock): boolean {
  return clock === undefined || clock.mode === "LIVE_WALL_CLOCK";
}

function deterministicInstant(clock: HistoricalAsOfClock | FixedTestClock): number {
  const raw = clock.mode === "FIXED_TEST_CLOCK" ? clock.nowMs : clock.asOfMs;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : Number.NaN;
}

/**
 * The single source of "now" for one analysis. LIVE reads the real clock; every
 * other mode reads its recorded instant and fails closed when it is unusable.
 */
export function resolveDecisionNow(clock?: DecisionClock): number {
  if (isLiveClock(clock)) return Date.now();
  return deterministicInstant(clock as HistoricalAsOfClock | FixedTestClock);
}

/** Structural validity of an injected clock (asserted by tests and call sites). */
export function isValidDecisionClock(clock?: DecisionClock): boolean {
  if (isLiveClock(clock)) return true;
  return Number.isFinite(deterministicInstant(clock as HistoricalAsOfClock | FixedTestClock));
}

export function decisionClockMode(clock?: DecisionClock): DecisionClockMode {
  return clock?.mode ?? "LIVE_WALL_CLOCK";
}

/**
 * Factual description for diagnostics. A historical replay is named as such and
 * is never described with a live word.
 */
export function describeDecisionClock(clock?: DecisionClock): string {
  if (isLiveClock(clock)) {
    return "Decision clock: LIVE wall clock — provider freshness is evaluated against the current real time.";
  }
  const asOf = resolveDecisionNow(clock);
  if (!Number.isFinite(asOf)) {
    return "Decision clock: INVALID deterministic clock — freshness cannot be verified, so the engine must refuse the snapshot.";
  }
  if (clock!.mode === "HISTORICAL_AS_OF") {
    return `Decision clock: HISTORICAL AS-OF ${new Date(asOf).toISOString()} — the recorded instant this analysis claims to have been made at; provider freshness is evaluated against that instant. RECORDED / HISTORICAL, never a live feed.`;
  }
  return `Decision clock: FIXED TEST instant ${new Date(asOf).toISOString()} — deterministic evaluation clock injected by the caller.`;
}
