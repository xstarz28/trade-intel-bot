/**
 * Phase 7B-1 — US Treasury yield & real-yield integration (pure module).
 *
 * Source (verified live): home.treasury.gov daily interest-rate XML feeds.
 *   Nominal par yield curve : data=daily_treasury_yield_curve      fields d:BC_*
 *   REAL yield curve        : data=daily_treasury_real_yield_curve fields d:TC_*
 *
 * NON-NEGOTIABLE:
 * - Nominal and real yields are NEVER conflated. Real yields come from the
 *   Treasury's own real-yield feed — never derived, estimated, or proxied.
 * - Missing tenors stay missing. No interpolation between tenors or dates.
 * - This is slow-moving DAILY macro data with its own freshness policy
 *   (documented below) — price-data staleness rules do NOT apply.
 *
 * No `@/` alias imports: this module is also consumed by Convex actions.
 */

// ── Types ──────────────────────────────────────────────────────────

export type TreasuryFreshness = "FRESH" | "DELAYED" | "STALE";

export interface TreasuryCurvePoint {
  observationDate: string; // YYYY-MM-DD from the feed itself
  /** NOMINAL par-yield-curve rates (%). Keyed by tenor label ("2Y","10Y",…). */
  nominal: Record<string, number>;
}

export interface TreasuryRealCurvePoint {
  observationDate: string;
  /** ACTUAL real-yield-curve rates (%) from the Treasury real-yield feed. */
  real: Record<string, number>;
}

export interface TreasuryContext {
  available: true;
  source: "US Treasury (home.treasury.gov XML feed)";
  fetchedAt: number;
  freshness: TreasuryFreshness;
  latest: {
    nominal: TreasuryCurvePoint;
    real?: TreasuryRealCurvePoint;
  };
  previous?: {
    nominal: TreasuryCurvePoint;
    real?: TreasuryRealCurvePoint;
  };
}

export interface TreasuryUnavailable {
  available: false;
  reason: string;
}

export type TreasuryData = TreasuryContext | TreasuryUnavailable;

/**
 * Directional macro-yield evidence derived ONLY from actual consecutive
 * Treasury observations. Zero values mean "no directional evidence" —
 * availability alone is never evidence.
 */
export interface MacroYieldEvidence {
  /**
   * Effect on GOLD longs from the ACTUAL real-yield change:
   * falling real yields → positive (supportive), rising → negative.
   * Magnitude in [-1,1]; 0 = insufficient/no directional evidence.
   */
  goldLongEffect: number;
  /**
   * Effect on USD strength from the nominal 2Y/10Y change:
   * rising yields → USD-positive, falling → USD-negative. [-1,1].
   */
  usdStrengthEffect: number;
  notes: string[];
}

// ── Documented policy parameters ───────────────────────────────────

/** Daily-macro freshness thresholds (days since observation date). */
export const TREASURY_FRESH_DAYS = 4; // covers weekends/holidays
export const TREASURY_DELAYED_DAYS = 9;

/**
 * Minimum absolute change (percentage points) between consecutive
 * observations before a directional signal is recognized at all.
 * Below this = noise → no directional evidence (availability ≠ confluence).
 */
export const MACRO_YIELD_SIGNAL_THRESHOLD_PTS = 0.03;
/** Change size (pts) at which the effect reaches full layer magnitude. */
export const MACRO_YIELD_FULL_EFFECT_PTS = 0.15;

// ── Tenor field maps (verified against live XML) ───────────────────

const NOMINAL_FIELDS: Record<string, string> = {
  BC_1MONTH: "1M",
  BC_2MONTH: "2M",
  BC_3MONTH: "3M",
  BC_4MONTH: "4M",
  BC_6MONTH: "6M",
  BC_1YEAR: "1Y",
  BC_2YEAR: "2Y",
  BC_3YEAR: "3Y",
  BC_5YEAR: "5Y",
  BC_7YEAR: "7Y",
  BC_10YEAR: "10Y",
  BC_20YEAR: "20Y",
  BC_30YEAR: "30Y",
  // BC_30YEARDISPLAY intentionally ignored (display duplicate of 30Y).
};

const REAL_FIELDS: Record<string, string> = {
  TC_5YEAR: "5Y",
  TC_7YEAR: "7Y",
  TC_10YEAR: "10Y",
  TC_20YEAR: "20Y",
  TC_30YEAR: "30Y",
};

const TENOR_ORDER = ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

// ── XML parsing ────────────────────────────────────────────────────

function parseNumber(raw: string): number | undefined {
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Parse one Treasury Atom/XML feed into ascending-date observations.
 * Robust by design: malformed input, empty feeds, entries without dates,
 * or unexpected schemas yield fewer/zero observations — never an error,
 * never synthetic values.
 */
export function parseTreasuryXml(xml: string, kind: "nominal" | "real"): TreasuryCurvePoint[] {
  const fields = kind === "nominal" ? NOMINAL_FIELDS : REAL_FIELDS;
  if (!xml || !xml.includes("<entry>")) return [];

  const out: TreasuryCurvePoint[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const dateMatch = block.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue; // entry without observation date is unusable
    const yields: Record<string, number> = {};
    for (const [field, tenor] of Object.entries(fields)) {
      const fm = block.match(new RegExp(`<d:${field}[^>]*>(-?\\d+(?:\\.\\d+)?)<`));
      if (!fm) continue; // missing tenor stays missing — no interpolation
      const v = parseNumber(fm[1]);
      if (v !== undefined) yields[tenor] = v;
    }
    // An observation with no usable rates is not an observation.
    if (Object.keys(yields).length === 0) continue;
    out.push({ observationDate: dateMatch[1], nominal: yields });
  }
  return out.sort((a, b) => a.observationDate.localeCompare(b.observationDate));
}

function pickLatest<T extends { observationDate: string }>(obs: T[]): T | undefined {
  return obs.length > 0 ? obs[obs.length - 1] : undefined;
}

function pickPrevious<T extends { observationDate: string }>(obs: T[]): T | undefined {
  return obs.length > 1 ? obs[obs.length - 2] : undefined;
}

function daysBetween(fromIsoDate: string, nowMs: number): number {
  const t = Date.parse(`${fromIsoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - t) / 86400e3);
}

export function classifyMacroFreshness(observationDate: string, nowMs: number): TreasuryFreshness {
  const ageDays = daysBetween(observationDate, nowMs);
  if (ageDays <= TREASURY_FRESH_DAYS) return "FRESH";
  if (ageDays <= TREASURY_DELAYED_DAYS) return "DELAYED";
  return "STALE";
}

/**
 * Build the context from already-fetched feed payloads. Each element is
 * either XML text or undefined (fetch failure for that specific month/feed).
 * A failed leg degrades gracefully: context needs AT LEAST one nominal
 * observation; the real curve simply stays unavailable if its legs fail.
 */
export function buildTreasuryContext(
  nominalXmls: (string | undefined)[],
  realXmls: (string | undefined)[],
  nowMs: number,
): TreasuryData {
  const nominalObs = nominalXmls
    .filter((x): x is string => typeof x === "string")
    .flatMap((x) => parseTreasuryXml(x, "nominal"))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));

  const latestNominal = pickLatest(nominalObs);
  if (!latestNominal) {
    return { available: false, reason: "US Treasury feed returned no usable nominal yield observations." };
  }

  const prevNominal = pickPrevious(nominalObs);

  let latestReal: TreasuryRealCurvePoint | undefined;
  let prevReal: TreasuryRealCurvePoint | undefined;
  if (realXmls.some((x) => typeof x === "string")) {
    const realObs = realXmls
      .filter((x): x is string => typeof x === "string")
      .flatMap((x) => parseTreasuryXml(x as string, "real" as const))
      .map(
        (p): TreasuryRealCurvePoint => ({
          observationDate: p.observationDate,
          real: p.nominal as unknown as TreasuryRealCurvePoint["real"],
        }),
      )
      .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
    latestReal = pickLatest(realObs);
    prevReal = pickPrevious(realObs);
  }

  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: nowMs,
    freshness: classifyMacroFreshness(latestNominal.observationDate, nowMs),
    latest: { nominal: latestNominal, ...(latestReal ? { real: latestReal } : {}) },
    ...(prevNominal
      ? {
          previous: {
            nominal: prevNominal,
            ...(prevReal && prevReal.observationDate === prevNominal.observationDate
              ? { real: prevReal }
              : prevReal
                ? { real: prevReal }
                : {}),
          },
        }
      : {}),
  };
}

// ── Directional evidence derivation ────────────────────────────────

function meanSharedChange(
  latest: Record<string, number>,
  previous: Record<string, number>,
  preferredTenors: string[],
): { change?: number; tenors: string[] } {
  let tenors = preferredTenors.filter((t) => t in latest && t in previous);
  if (tenors.length === 0) {
    tenors = Object.keys(latest).filter(
      (t) => t in previous && TENOR_ORDER.indexOf(t) >= 0,
    );
  }
  if (tenors.length === 0) return { tenors: [] };
  const sum = tenors.reduce((acc, t) => acc + (latest[t] - previous[t]), 0);
  return { change: sum / tenors.length, tenors };
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/**
 * Derive directional macro-yield evidence from two consecutive Treasury
 * observations. Conventional macro relationships are used as EVIDENCE with
 * magnitude scaling — never as deterministic trade rules, and never as a
 * substitute for structure/liquidity (enforced by the engine's hierarchy).
 */
export function deriveMacroYieldEvidence(ctx: TreasuryContext): MacroYieldEvidence {
  const notes: string[] = [];
  const empty: MacroYieldEvidence = { goldLongEffect: 0, usdStrengthEffect: 0, notes };

  if (!ctx.previous) {
    notes.push("Only one Treasury observation available — no consecutive-change evidence.");
    return empty;
  }

  const nom = meanSharedChange(
    ctx.latest.nominal.nominal,
    ctx.previous.nominal.nominal,
    ["2Y", "10Y"],
  );
  if (!nom.change || Math.abs(nom.change) < MACRO_YIELD_SIGNAL_THRESHOLD_PTS) {
    notes.push(
      nom.tenors.length > 0
        ? `Nominal ${nom.tenors.join("/")} change ${(nom.change ?? 0).toFixed(3)}pp below signal threshold — no USD directional evidence.`
        : "No shared nominal tenors between observations.",
    );
  }

  let usdStrengthEffect = 0;
  // Phase 13 — a NON-FINITE change (Infinity/NaN from malformed feed values)
  // is UNAVAILABLE evidence, never an extreme directional signal.
  const nomChange = nom.change !== undefined && Number.isFinite(nom.change) ? nom.change : undefined;
  if (nomChange !== undefined && Math.abs(nomChange) >= MACRO_YIELD_SIGNAL_THRESHOLD_PTS) {
    nom.change = nomChange;
    usdStrengthEffect = clampUnit(nom.change / MACRO_YIELD_FULL_EFFECT_PTS);
    notes.push(
      `Nominal ${nom.tenors.join("/")} changed ${nomChange > 0 ? "+" : ""}${nomChange.toFixed(3)}pp → USD-${usdStrengthEffect > 0 ? "positive" : "negative"} context.`,
    );
  }

  let goldLongEffect = 0;
  if (ctx.latest.real && ctx.previous.real) {
    const rl = meanSharedChange(ctx.latest.real.real, ctx.previous.real.real, ["5Y", "10Y", "30Y"]);
    const rlChange = rl.change !== undefined && Number.isFinite(rl.change) ? rl.change : undefined;
    if (rlChange !== undefined && Math.abs(rlChange) >= MACRO_YIELD_SIGNAL_THRESHOLD_PTS) {
      // Falling ACTUAL real yields are historically supportive of gold.
      goldLongEffect = clampUnit(-rlChange / MACRO_YIELD_FULL_EFFECT_PTS);
      notes.push(
        `REAL yields (${rl.tenors.join("/")}, actual Treasury data) changed ${rlChange > 0 ? "+" : ""}${rlChange.toFixed(3)}pp → gold-${goldLongEffect > 0 ? "supportive" : "opposing"} context.`,
      );
    } else {
      notes.push(
        rl.tenors.length > 0
          ? `Real-yield change ${(rlChange ?? 0).toFixed(3)}pp below signal threshold — no gold directional evidence.`
          : "No shared real-yield tenors between observations.",
      );
    }
  } else {
    notes.push("Real-yield curve unavailable from this fetch — gold real-yield context absent (nominal yields are NOT substituted).");
  }

  return { goldLongEffect, usdStrengthEffect, notes };
}
