/**
 * Phase 290-A — DETERMINISTIC, CAUSAL, EVENT-BASED MARKET STRUCTURE.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The repository already had swing detection (`detectSwings` /
 * `detectSwingPoints`), a structure label (`HH/HL` / `LH/LL` / `range`) and two
 * label-shaped helpers (`detectBos`, `detectChoch`). Audited against real
 * candles, those helpers answer a DIFFERENT question than the one the analysis
 * needs:
 *
 *   `detectBos(highs, lows, currentPrice)` returns "bullish" while price merely
 *   sits above the most recent swing high. That is a STATE, not an EVENT: it
 *   stays true for as long as price never comes back, it carries no candle, no
 *   time and no broken level, and it cannot distinguish "just broke structure"
 *   from "broke it 40 candles ago".
 *
 *   `detectChoch(...)` compares the structure LABEL with the current price, so a
 *   label that has not yet been revised can silently produce a CHoCH, and a
 *   CHoCH can appear/disappear as the label drifts.
 *
 * This module replaces neither the label nor the swing detector (both stay, and
 * the rest of the SMC engine — liquidity, FVG, displacement, order blocks,
 * VWAP, volume profile — is untouched). It adds the missing layer: structure as
 * a sequence of CONFIRMED EVENTS.
 *
 * THE RULES, IN FULL
 * ------------------
 * 1. CAUSALITY. A fractal swing at index `i` with window `L` needs `L` candles
 *    on each side, so it is only knowable at the CLOSE of candle `i + L`. Every
 *    swing here therefore carries `confirmedAtIndex = i + L`, and the event walk
 *    refuses to use a swing before that index. Nothing in this module reads a
 *    candle after the candle being evaluated.
 *
 * 2. CLOSE, NOT WICK. A break is confirmed only by a candle whose CLOSE is
 *    beyond the level. A candle that pierces the level and closes back inside is
 *    recorded as a wick-only rejection, never as a break.
 *
 * 3. EVENT, NOT STATE. An event is emitted once, at the candle that confirmed
 *    it, naming the exact level and the exact swing it broke. A level is
 *    consumed by its break and cannot fire twice. Price remaining beyond an old
 *    level produces no further events.
 *
 * 4. BOS vs CHoCH. A break in the direction of the established regime continues
 *    it (BOS). The first break AGAINST an established regime is a CHoCH, and it
 *    flips the regime. With no established regime there is nothing to change
 *    character FROM, so the first break is a BOS that establishes the regime —
 *    it is never labelled CHoCH.
 *
 * 5. INVALIDATION, FROM STRUCTURE. A bullish read is invalidated by a close
 *    below its protected structural low; a bearish read by a close above its
 *    protected structural high. Two levels are exposed, both taken from real
 *    confirmed swings:
 *      · `invalidation` — the LATEST confirmed swing on the protected side
 *        (a trailing structural stop: lose it and the sequence of higher
 *        lows / lower highs is broken);
 *      · `majorInvalidation` — the EXTREME confirmed swing on the protected
 *        side since the event that established the regime (the regime-level
 *        line: lose it and the trend itself is void).
 *    Neither is chosen for how a reward/risk ratio looks.
 *
 * 6. EXTERNAL vs INTERNAL. The two reads use different windows and are computed
 *    independently; an internal break can never rewrite the external regime. The
 *    pair reports their relationship instead of merging them.
 *
 * 7. NO EVIDENCE, NO CLAIM. Insufficient history, no confirmed swings, or no
 *    confirmed event are returned as explicit evidence states with a reason —
 *    never as a direction, never as a fabricated event.
 *
 * Everything here is pure: (candles, options) → data. Repeated calls on the same
 * input return identical output.
 */

import type { OhlcvCandle } from "./market-types";

// ── Public types ──────────────────────────────────────────────────

export interface ConfirmedSwing {
  kind: "high" | "low";
  price: number;
  index: number;
  /**
   * Candle index at which this swing became knowable (the close of
   * `index + lookback`). Swings are NEVER used before this index.
   */
  confirmedAtIndex: number;
  /** Provider candle timestamp of the swing candle itself. */
  timestamp: number;
}

export type StructureDirection = "bullish" | "bearish" | "none";
export type StructureEventKind = "BOS" | "CHOCH";

export interface StructureEvent {
  kind: StructureEventKind;
  /** Direction of the break that created the event. */
  direction: "bullish" | "bearish";
  /** The confirmed swing level that was broken. */
  brokenLevel: number;
  /** Index (and time) of the swing candle whose level broke. */
  brokenSwingIndex: number;
  brokenSwingTime: number;
  /** The level is the swing's high (broken upward) or low (broken downward). */
  brokenSwingKind: "high" | "low";
  /** Candle whose CLOSE confirmed the break — the event candle. */
  candleIndex: number;
  candleTime: number;
  /** Same as `candleIndex`: the event is knowable at that candle's close. */
  confirmedAtIndex: number;
}

export type StructureEvidenceState =
  | "confirmed_event"
  | "no_event"
  | "no_confirmed_swings"
  | "insufficient_history";

export interface StructuralInvalidation {
  level: number;
  swingIndex: number;
  swingKind: "high" | "low";
  timestamp: number;
  /** How close the last candle got to it (absolute price distance). */
  distance: number;
}

export interface StructuralRead {
  timeframe: string;
  lookback: number;
  evidenceState: StructureEvidenceState;
  /** Regime direction as established by confirmed events. "none" = no event yet. */
  direction: StructureDirection;
  /** The label view of the same swings, kept for continuity with the SMC layer. */
  regime: "HH/HL" | "LH/LL" | "range" | "unknown";
  lastEvent?: StructureEvent;
  lastBos?: StructureEvent;
  lastChoch?: StructureEvent;
  /** Trailing structural invalidation (latest confirmed protected swing). */
  invalidation?: StructuralInvalidation;
  /** Regime-level structural invalidation (extreme since the regime event). */
  majorInvalidation?: StructuralInvalidation;
  /** Confirmed swings this read was built from, in provider order. */
  swings: ConfirmedSwing[];
  /** Every confirmed event, oldest first (deterministic, reproducible). */
  events: StructureEvent[];
  /** Candles that pierced a level but closed back inside — never events. */
  wickOnlyRejections: number;
  /**
   * Pivot candles the anomaly guard rejected (range beyond
   * `ANOMALY_RANGE_ATR_MULT`× trailing ATR14): their extremes are data, not
   * structure, and they never become structural levels. Reported, never hidden.
   */
  anomalousPivots: SwingAnomaly[];
  /** Last close of the read. */
  price: number;
  /** Deterministic one-line summary of the structural state. */
  reason: string;
}

export type StructurePairState =
  | "ALIGNED"
  | "INTERNAL_COUNTERTREND"
  | "EXTERNAL_UNKNOWN"
  | "INTERNAL_UNKNOWN"
  | "BOTH_UNKNOWN";

export interface StructurePair {
  external: StructuralRead;
  internal: StructuralRead;
  state: StructurePairState;
  /** True only when BOTH sides carry a direction and they oppose each other. */
  disagreement: boolean;
  reason: string;
}

// ── 1. Confirmed swings ───────────────────────────────────────────

/**
 * A pivot candle whose own range exceeds this multiple of the TRAILING ATR14 is
 * treated as a DATA ANOMALY rather than as a structural pivot: the phase-24
 * manipulation class, where one manipulated candle must not be able to authorise
 * (or forbid) a structural decision. A normal session runs at roughly 1–3× ATR,
 * so the threshold sits far outside ordinary behaviour and no real breakout
 * candle is discarded, while a bar whose range is off by orders of magnitude can
 * no longer become a swing level. The ATR is measured up to the candle that
 * CONFIRMS the pivot, so the guard is exactly as causal as the pivot itself.
 */
export const ANOMALY_RANGE_ATR_MULT = 8;

export interface SwingAnomaly {
  index: number;
  kind: "high" | "low";
  /** Candle range (high − low). */
  range: number;
  /** Trailing ATR14 at the pivot's confirmation candle. */
  atr: number;
}

export interface SwingScan {
  swings: ConfirmedSwing[];
  /** Pivot candles rejected by the anomaly guard, in provider order. */
  anomalies: SwingAnomaly[];
}

/** True-range ATR over `period` candles ending at `endIndex` (inclusive). */
function trailingAtr(candles: OhlcvCandle[], endIndex: number, period = 14): number | undefined {
  const start = endIndex - period + 1;
  if (start < 1) return undefined;
  let sum = 0;
  for (let i = start; i <= endIndex; i += 1) {
    const c = candles[i];
    const prev = candles[i - 1];
    sum += Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
  }
  return sum / period;
}

/**
 * Fractal swings WITH their confirmation index, plus the pivots the anomaly
 * guard rejected.
 *
 * A candle is a swing high when no candle in `[i-L, i+L]` prints a higher high;
 * it is therefore only knowable once candle `i+L` has closed. The scan stops at
 * `candles.length - L`, so a candle near the live edge is never promoted to a
 * swing by assuming candles that do not exist yet.
 */
export function scanConfirmedSwings(
  candles: OhlcvCandle[],
  lookback: number,
  options: { anomalyGuard?: boolean } = {},
): SwingScan {
  const L = Math.max(1, Math.floor(lookback));
  const swings: ConfirmedSwing[] = [];
  const anomalies: SwingAnomaly[] = [];
  if (candles.length < 2 * L + 1) return { swings, anomalies };
  const guard = options.anomalyGuard !== false;

  for (let i = L; i < candles.length - L; i += 1) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - L; j <= i + L; j += 1) {
      if (j === i) continue;
      if (candles[j].high > c.high) isHigh = false;
      if (candles[j].low < c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (!isHigh && !isLow) continue;

    const confirmedAtIndex = i + L;
    if (guard) {
      const atr = trailingAtr(candles, confirmedAtIndex);
      const range = c.high - c.low;
      if (atr !== undefined && atr > 0 && range > ANOMALY_RANGE_ATR_MULT * atr) {
        if (isHigh) anomalies.push({ index: i, kind: "high", range, atr });
        if (isLow) anomalies.push({ index: i, kind: "low", range, atr });
        continue;
      }
    }

    if (isHigh) {
      swings.push({
        kind: "high",
        price: c.high,
        index: i,
        confirmedAtIndex,
        timestamp: c.timestamp,
      });
    }
    if (isLow) {
      swings.push({
        kind: "low",
        price: c.low,
        index: i,
        confirmedAtIndex,
        timestamp: c.timestamp,
      });
    }
  }

  return { swings: swings.sort((a, b) => a.index - b.index || (a.kind === "high" ? -1 : 1)), anomalies };
}

/** The swings alone (the anomaly count is reported by `scanConfirmedSwings`). */
export function detectConfirmedSwings(
  candles: OhlcvCandle[],
  lookback: number,
  options: { anomalyGuard?: boolean } = {},
): ConfirmedSwing[] {
  return scanConfirmedSwings(candles, lookback, options).swings;
}

// ── 2. Events ─────────────────────────────────────────────────────

/**
 * Walk the candles forward and emit the confirmed BOS/CHOCH sequence.
 *
 * Causality is enforced by two rules that are easy to state and hard to cheat:
 *   · a swing is only visible from `confirmedAtIndex` onward;
 *   · a break is only a break on a candle that CLOSES beyond the level, and the
 *     candle must come after the swing candle itself.
 *
 * A level that has been broken is CONSUMED: it cannot fire a second event, so a
 * later pullback that re-crosses an old swing cannot manufacture a new BOS.
 */
export function detectStructureEvents(
  candles: OhlcvCandle[],
  swings: ConfirmedSwing[],
): { events: StructureEvent[]; wickOnlyRejections: number } {
  const events: StructureEvent[] = [];
  let wickOnlyRejections = 0;

  /** Most recent confirmed swing at or before the candle being evaluated. */
  let activeHigh: ConfirmedSwing | undefined;
  let activeLow: ConfirmedSwing | undefined;
  let swingCursor = 0;

  /** Regime: which side last broke structure (BOS or CHoCH), and where. */
  let regime: StructureDirection = "none";

  for (let k = 0; k < candles.length; k += 1) {
    // Fold in every swing that became knowable at this candle's close.
    while (swingCursor < swings.length && swings[swingCursor].confirmedAtIndex <= k) {
      const s = swings[swingCursor];
      swingCursor += 1;
      // A swing is only usable if it formed before the candle evaluating it.
      if (s.index >= k) continue;
      if (s.kind === "high") activeHigh = s;
      else activeLow = s;
    }

    const candle = candles[k];
    const close = candle.close;

    // ── break UP: the active confirmed swing high ──────────────────
    if (activeHigh && activeHigh.index < k) {
      if (close > activeHigh.price) {
        const direction: "bullish" = "bullish";
        // A bullish break against an established bearish regime changes
        // character; with no regime (or with a bullish one) it continues it.
        const kind: StructureEventKind = regime === "bearish" ? "CHOCH" : "BOS";
        events.push({
          kind,
          direction,
          brokenLevel: activeHigh.price,
          brokenSwingIndex: activeHigh.index,
          brokenSwingTime: activeHigh.timestamp,
          brokenSwingKind: "high",
          candleIndex: k,
          candleTime: candle.timestamp,
          confirmedAtIndex: k,
        });
        regime = "bullish";
        // The level is consumed: the next bullish break must clear a NEW high.
        activeHigh = undefined;
        continue;
      }
      if (candle.high > activeHigh.price) {
        // Pierced, closed back below: liquidity behaviour, NOT structure.
        wickOnlyRejections += 1;
      }
    }

    // ── break DOWN: the active confirmed swing low ─────────────────
    if (activeLow && activeLow.index < k) {
      if (close < activeLow.price) {
        const direction: "bearish" = "bearish";
        const kind: StructureEventKind = regime === "bullish" ? "CHOCH" : "BOS";
        events.push({
          kind,
          direction,
          brokenLevel: activeLow.price,
          brokenSwingIndex: activeLow.index,
          brokenSwingTime: activeLow.timestamp,
          brokenSwingKind: "low",
          candleIndex: k,
          candleTime: candle.timestamp,
          confirmedAtIndex: k,
        });
        regime = "bearish";
        activeLow = undefined;
        continue;
      }
      if (candle.low < activeLow.price) {
        wickOnlyRejections += 1;
      }
    }
  }

  return { events, wickOnlyRejections };
}

// ── 3. Label view (kept for continuity with the SMC layer) ────────

function labelFromSwings(
  swings: ConfirmedSwing[],
): "HH/HL" | "LH/LL" | "range" | "unknown" {
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  if (highs.length < 2 || lows.length < 2) return "unknown";
  const rh = highs.slice(-3);
  const rl = lows.slice(-3);
  const highsRising = rh[rh.length - 1].price > rh[0].price;
  const lowsRising = rl[rl.length - 1].price > rl[0].price;
  if (highsRising && lowsRising) return "HH/HL";
  if (!highsRising && !lowsRising) return "LH/LL";
  return "range";
}

// ── 4. One structural read ────────────────────────────────────────

export interface StructureReadOptions {
  /** Fractal window for this read. Larger = slower, more structural. */
  lookback: number;
  /** Minimum candles before a read is attempted (defaults to 2L + 3). */
  minCandles?: number;
}

function invalidationOf(
  direction: StructureDirection,
  swings: ConfirmedSwing[],
  lastIndex: number,
  price: number,
  lastEvent: StructureEvent | undefined,
): {
  invalidation?: StructuralInvalidation;
  majorInvalidation?: StructuralInvalidation;
} {
  if (direction === "none") return {};
  const side: "high" | "low" = direction === "bullish" ? "low" : "high";
  const usable = swings.filter((s) => s.kind === side && s.index <= lastIndex);
  if (usable.length === 0) return {};

  const latest = usable[usable.length - 1];
  const mk = (s: ConfirmedSwing): StructuralInvalidation => ({
    level: s.price,
    swingIndex: s.index,
    swingKind: s.kind,
    timestamp: s.timestamp,
    distance: Math.abs(price - s.price),
  });

  // Regime-level protection: extremes since the regime was established. When the
  // regime came from a bullish event, only lows formed at/after the broken swing
  // belong to that regime's own sequence.
  const from = lastEvent ? Math.max(0, lastEvent.brokenSwingIndex) : 0;
  const regimeSwings = usable.filter((s) => s.index >= from);
  const scoped = regimeSwings.length > 0 ? regimeSwings : usable;
  const extreme = scoped.reduce((best, s) =>
    side === "low" ? (s.price < best.price ? s : best) : s.price > best.price ? s : best,
  );

  return { invalidation: mk(latest), majorInvalidation: mk(extreme) };
}

/**
 * One deterministic structural read on one candle series.
 *
 * `external` reads use a slow window and describe the regime; `internal` reads
 * use a fast window and describe the current leg. Both are computed from the
 * same candles with the same causal rules — only the window differs.
 */
export function readStructure(
  candles: OhlcvCandle[],
  timeframe: string,
  options: StructureReadOptions,
): StructuralRead {
  const lookback = Math.max(1, Math.floor(options.lookback));
  const minCandles = options.minCandles ?? 2 * lookback + 3;
  const price = candles.length > 0 ? candles[candles.length - 1].close : 0;

  if (candles.length < minCandles) {
    return {
      timeframe,
      lookback,
      evidenceState: "insufficient_history",
      direction: "none",
      regime: "unknown",
      swings: [],
      events: [],
      wickOnlyRejections: 0,
      anomalousPivots: [],
      price,
      reason: `${candles.length} candle(s) — below the ${minCandles} needed for a confirmed structural read.`,
    };
  }

  const { swings, anomalies } = scanConfirmedSwings(candles, lookback);
  const anomalyNote =
    anomalies.length > 0
      ? ` ${anomalies.length} anomalous pivot candle(s) ignored (range beyond ${ANOMALY_RANGE_ATR_MULT}× trailing ATR14).`
      : "";
  const { events, wickOnlyRejections } = detectStructureEvents(candles, swings);
  const regime = labelFromSwings(swings);
  const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
  const lastBos = [...events].reverse().find((e) => e.kind === "BOS");
  const lastChoch = [...events].reverse().find((e) => e.kind === "CHOCH");
  const direction: StructureDirection = lastEvent ? lastEvent.direction : "none";
  const { invalidation, majorInvalidation } = invalidationOf(
    direction,
    swings,
    candles.length - 1,
    price,
    lastEvent,
  );

  let evidenceState: StructureEvidenceState;
  let reason: string;
  if (swings.length === 0) {
    evidenceState = "no_confirmed_swings";
    reason = `No confirmed swing (window ${lookback}) in ${candles.length} candles — no structural event can be established.` + anomalyNote;
  } else if (!lastEvent) {
    evidenceState = "no_event";
    reason = `No confirmed close beyond a swing level: last swing high ${fmt(
      swings.filter((s) => s.kind === "high").slice(-1)[0]?.price,
    )}, last swing low ${fmt(swings.filter((s) => s.kind === "low").slice(-1)[0]?.price)} — structure is unbroken.` + anomalyNote;
  } else {
    evidenceState = "confirmed_event";
    reason = `${lastEvent.kind} ${lastEvent.direction} confirmed at candle ${lastEvent.candleIndex} by close ${fmt(
      candles[lastEvent.candleIndex].close,
    )} beyond ${lastEvent.brokenSwingKind} ${fmt(lastEvent.brokenLevel)}${
      lastBos && lastChoch
        ? ` (last BOS #${lastBos.candleIndex}, last CHoCH #${lastChoch.candleIndex})`
        : ""
    }.` + anomalyNote;
  }

  return {
    timeframe,
    lookback,
    evidenceState,
    direction,
    regime,
    ...(lastEvent ? { lastEvent } : {}),
    ...(lastBos ? { lastBos } : {}),
    ...(lastChoch ? { lastChoch } : {}),
    ...(invalidation ? { invalidation } : {}),
    ...(majorInvalidation ? { majorInvalidation } : {}),
    swings,
    events,
    wickOnlyRejections,
    anomalousPivots: anomalies,
    price,
    reason,
  };
}

const fmt = (v: number | undefined): string =>
  v === undefined ? "n/a" : Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/0+$/, "");

// ── 5. External + internal pair ───────────────────────────────────

export interface StructurePairOptions {
  externalLookback: number;
  internalLookback: number;
  minCandles?: number;
}

/**
 * External (regime) and internal (leg) structure over the same candles.
 *
 * They are separate reads on purpose: they may legitimately disagree, and this
 * function REPORTS that disagreement instead of letting the fast window rewrite
 * the slow one. Internal counter-trend movement stays counter-trend until the
 * EXTERNAL read changes.
 */
export function readStructurePair(
  candles: OhlcvCandle[],
  timeframe: string,
  options: StructurePairOptions,
): StructurePair {
  const external = readStructure(candles, timeframe, {
    lookback: options.externalLookback,
    ...(options.minCandles !== undefined ? { minCandles: options.minCandles } : {}),
  });
  const internal = readStructure(candles, `${timeframe}:internal`, {
    lookback: options.internalLookback,
    ...(options.minCandles !== undefined ? { minCandles: options.minCandles } : {}),
  });

  let state: StructurePairState;
  if (external.direction === "none" && internal.direction === "none") state = "BOTH_UNKNOWN";
  else if (external.direction === "none") state = "EXTERNAL_UNKNOWN";
  else if (internal.direction === "none") state = "INTERNAL_UNKNOWN";
  else if (external.direction === internal.direction) state = "ALIGNED";
  else state = "INTERNAL_COUNTERTREND";

  const disagreement = state === "INTERNAL_COUNTERTREND";
  const reason =
    state === "ALIGNED"
      ? `External and internal structure agree (${external.direction}); the internal read refines the same side.`
      : state === "INTERNAL_COUNTERTREND"
        ? `External structure is ${external.direction} while the internal leg is ${internal.direction}: counter-trend movement INSIDE an intact ${external.direction} regime — the external regime is unchanged until external evidence says otherwise.`
        : state === "EXTERNAL_UNKNOWN"
          ? `External structure has no confirmed event (${external.evidenceState}); the internal read (${internal.direction}) is trigger context only.`
          : state === "INTERNAL_UNKNOWN"
            ? `External structure is ${external.direction}; the internal leg has no confirmed event (${internal.evidenceState}).`
            : `Neither the external nor the internal window produced a confirmed event yet.`;

  return { external, internal, state, disagreement, reason };
}

// ── 6. MTF structural confluence ──────────────────────────────────

export type StructuralRole = "macro" | "structure" | "setup" | "trigger";

export type StructuralConfluenceState =
  | "ALIGNED_BULLISH"
  | "ALIGNED_BEARISH"
  | "COUNTER_TREND"
  | "INCOMPLETE"
  | "MIXED"
  | "UNKNOWN";

export interface StructuralConfluencePart {
  role: StructuralRole;
  read: StructuralRead;
}

export interface StructuralConfluence {
  state: StructuralConfluenceState;
  /** Dominant higher-timeframe direction (macro, else structure). */
  htfDirection: StructureDirection;
  htfTimeframe?: string;
  setupDirection: StructureDirection;
  triggerDirection: StructureDirection;
  /** Higher structure intact while the trigger pulls the other way. */
  triggerPullback: boolean;
  /** Roles that were requested but produced no direction. */
  unresolvedRoles: StructuralRole[];
  detail: string;
}

/**
 * Deterministic structural confluence — a state machine over the ACTUAL
 * per-timeframe reads, never a weighted score.
 *
 *   htf bullish + setup bullish                → ALIGNED_BULLISH
 *   htf bullish + setup bearish                → MIXED (retracement inside an
 *                                                 opposing higher trend is not
 *                                                 an alignment and not a trend)
 *   htf bullish + setup none                   → INCOMPLETE
 *   htf bullish + setup bullish + trigger bear → ALIGNED_BULLISH + pullback flag
 *   macro and structure disagree               → MIXED
 *   no readable HTF                            → UNKNOWN
 */
export function structuralConfluence(
  parts: StructuralConfluencePart[],
  /**
   * Roles the caller's chain actually expected. A role that produced NO read at
   * all (slot unavailable) is reported as unresolved instead of simply
   * disappearing from the confluence — the absence is stated, never implied.
   */
  expectedRoles: StructuralRole[] = [],
): StructuralConfluence {
  const byRole = new Map<StructuralRole, StructuralRead>();
  for (const part of parts) byRole.set(part.role, part.read);

  const macro = byRole.get("macro");
  const structure = byRole.get("structure");
  const setup = byRole.get("setup");
  const trigger = byRole.get("trigger");

  const dirOf = (r?: StructuralRead): StructureDirection => r?.direction ?? "none";
  const macroDir = dirOf(macro);
  const structureDir = dirOf(structure);
  const setupDir = dirOf(setup);
  const triggerDir = dirOf(trigger);

  const htf = macroDir !== "none" ? macro : structureDir !== "none" ? structure : undefined;
  const htfDirection = dirOf(htf);

  const unresolvedRoles: StructuralRole[] = [];
  for (const [role, read] of [
    ["macro", macro],
    ["structure", structure],
    ["setup", setup],
    ["trigger", trigger],
  ] as [StructuralRole, StructuralRead | undefined][]) {
    if (read === undefined) {
      // No read because the role was never supplied to the confluence: only a
      // role the caller says it expected is reported as unresolved.
      if (expectedRoles.includes(role) && !unresolvedRoles.includes(role)) {
        unresolvedRoles.push(role);
      }
      continue;
    }
    if (read.direction === "none") unresolvedRoles.push(role);
  }

  const triggerPullback =
    htfDirection !== "none" && triggerDir !== "none" && triggerDir !== htfDirection;

  let state: StructuralConfluenceState;
  let detail: string;

  if (htfDirection === "none") {
    state = "UNKNOWN";
    detail =
      "No higher-timeframe structure produced a confirmed event, so no dominant structural direction exists yet.";
  } else if (macroDir !== "none" && structureDir !== "none" && macroDir !== structureDir) {
    state = "MIXED";
    detail = `Higher timeframes disagree (macro ${macroDir} vs structure ${structureDir}); the structural context is mixed and no dominant direction is asserted.`;
  } else if (setupDir === "none") {
    state = "INCOMPLETE";
    detail = `Higher-timeframe structure is ${htfDirection} on ${htf?.timeframe ?? "n/a"} but the setup timeframe has no confirmed structural event${unresolvedRoles.length > 0 ? ` (unresolved: ${unresolvedRoles.join(", ")})` : ""}.`;
  } else if (setupDir === htfDirection) {
    state = htfDirection === "bullish" ? "ALIGNED_BULLISH" : "ALIGNED_BEARISH";
    detail = `Higher-timeframe structure (${htf?.timeframe ?? "n/a"}) and the setup timeframe agree on ${htfDirection}${
      triggerDir !== "none" && triggerDir !== htfDirection
        ? `; the trigger timeframe is ${triggerDir}, i.e. a pullback inside the ${htfDirection} structure rather than a change of character`
        : ""
    }.`;
  } else {
    state = "COUNTER_TREND";
    detail = `Setup timeframe is ${setupDir} against ${htfDirection} higher-timeframe structure on ${htf?.timeframe ?? "n/a"} — a counter-trend context until the higher timeframe's own structure changes.`;
  }

  return {
    state,
    htfDirection,
    ...(htf ? { htfTimeframe: htf.timeframe } : {}),
    setupDirection: setupDir,
    triggerDirection: triggerDir,
    triggerPullback,
    unresolvedRoles,
    detail,
  };
}

// ── 7. Output digest (deterministic, no decorative language) ──────

/**
 * Compact, machine-checkable facts for the analysis output. One line per
 * timeframe plus the confluence state, each naming the numbers it is built from.
 */
export function structureDigest(read: StructuralRead): string[] {
  const lines: string[] = [];
  const head = `${read.timeframe} [${read.evidenceState}] structure=${read.regime} direction=${read.direction}`;
  lines.push(head);
  if (read.lastEvent) {
    lines.push(
      `${read.timeframe} latest ${read.lastEvent.kind} ${read.lastEvent.direction}: close ${read.lastEvent.brokenSwingKind === "high" ? ">" : "<"} ${read.lastEvent.brokenLevel} at candle ${read.lastEvent.candleIndex} (${new Date(read.lastEvent.candleTime).toISOString()})`,
    );
  }
  if (read.invalidation) {
    lines.push(
      `${read.timeframe} invalidation ${read.invalidation.level} (structural ${read.invalidation.swingKind} #${read.invalidation.swingIndex}, distance ${read.invalidation.distance.toFixed(6)})`,
    );
  }
  if (read.majorInvalidation && read.majorInvalidation.level !== read.invalidation?.level) {
    lines.push(
      `${read.timeframe} regime invalidation ${read.majorInvalidation.level} (extreme ${read.majorInvalidation.swingKind} #${read.majorInvalidation.swingIndex})`,
    );
  }
  if (read.anomalousPivots.length > 0) {
    lines.push(
      `${read.timeframe} ignored ${read.anomalousPivots.length} anomalous pivot candle(s) — range beyond ${ANOMALY_RANGE_ATR_MULT}× trailing ATR14`,
    );
  }
  if (read.evidenceState === "no_event" || read.evidenceState === "no_confirmed_swings") {
    lines.push(`${read.timeframe} ${read.reason}`);
  }
  return lines;
}
