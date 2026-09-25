/**
 * Phase 7D — U.S. EIA Weekly Petroleum Status Report inventories (pure module).
 *
 * Source: EIA Open Data API v2, route `/v2/petroleum/sto/data/`
 *   (verified live: requires api_key → 403 without one; docs verified at
 *   eia.gov/opendata/documentation.php — response is
 *   `{ response: { data: [ { period, value, ... } ] }, request, apiVersion }`,
 *   data values standardized as STRINGS since v2.1.6).
 *
 * NON-NEGOTIABLE:
 * - Inventory values come ONLY from actual EIA observations. No estimates,
 *   no interpolation between weeks, no substitution when a product leg fails.
 * - Observation date is NEVER rewritten to "today". Weekly slow-data
 *   freshness policy below — price staleness rules do NOT apply.
 * - Crude + gasoline + distillate from the SAME WPSR release = ONE
 *   evidence layer with an internal breakdown, never three votes.
 * - Availability ≠ confluence: sub-threshold changes contribute zero.
 * - Product facet codes (EPC0/EPD0/EPM0) are documented-but-not-live-
 *   verifiable until a key exists; a wrong code simply fails its leg
 *   independently and is reported — never substituted or fabricated.
 *
 * No `@/` alias imports: this module is also consumed by Convex actions.
 */

// ── Types ──────────────────────────────────────────────────────────

export type EiaFreshness = "FRESH" | "DELAYED" | "STALE";

export interface EiaSeriesPoint {
  /** EIA product facet id actually returned by the provider. */
  productId: string;
  productName?: string;
  /** Latest observation period exactly as the feed reports it. */
  observationDate: string;
  previousObservationDate?: string;
  latestValue: number;
  previousValue?: number;
  change?: number;
  changePercent?: number;
  unit?: string;
  /**
   * Phase 280 — the OLDER observations of this same provider series (newest
   * first, excluding the latest two, which already have their own fields).
   * Only ever populated from rows the provider actually returned: a short
   * window stays short, and nothing is interpolated, back-filled or defaulted.
   * This is what makes a multi-week trend / baseline read possible.
   */
  recentWeeks?: { period: string; value: number }[];
}

export interface EiaContext {
  available: true;
  source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)";
  fetchedAt: number;
  freshness: EiaFreshness;
  /** Only legs that ACTUALLY returned valid dated observations. */
  series: EiaSeriesPoint[];
  /** Legs that failed independently, each with an explicit reason. */
  failedLegs: { productId: string; reason: string }[];
}

export interface EiaUnavailable {
  available: false;
  reason: string;
}

export type EiaData = EiaContext | EiaUnavailable;

/**
 * Directional oil evidence derived ONLY from the change between two actual
 * consecutive WPSR observations of the same series.
 */
export interface EiaInventoryEvidence {
  /**
   * Effect on OIL longs: inventory drawdown → positive (supportive),
   * build → negative. Signed magnitude in [-1,1]; 0 = insufficient
   * directional evidence (availability alone contributes nothing).
   */
  effectOnOilLong: number;
  aggregate: "DRAW" | "BUILD" | "MIXED" | "INSUFFICIENT";
  notes: string[];
}

// ── Documented policy parameters ───────────────────────────────────

/**
 * Weekly-release freshness thresholds (days since latest observation date).
 * FRESH ≤10d covers one full release cycle including holidays; DELAYED ≤18d
 * tolerates one missed release; beyond that STALE. Weekend/holiday never
 * makes weekly data stale by itself — only elapsed days matter.
 */
export const EIA_FRESH_DAYS = 10;
export const EIA_DELAYED_DAYS = 18;

/**
 * A week-over-week stock change counts as directional evidence only when it
 * exceeds BOTH: |change| ≥ 0.5M bbl AND |change| ≥ 0.25% of the stock level.
 * These are PLATFORM POLICY parameters (documented here), not universal
 * market truths. Effect saturates linearly to full magnitude at 2.0% of level.
 */
export const EIA_SIGNAL_MIN_MBBL = 0.5;
export const EIA_SIGNAL_THRESHOLD_PCT = 0.25; // % of stock level
export const EIA_FULL_EFFECT_PCT = 2.0; // % of stock level

/**
 * Phase 280 — how much OBSERVATION HISTORY the framework will carry per series.
 * Bounded for payload size; the acquisition requests a 12-week window, so the
 * latest two weeks plus up to 10 older ones are preserved. More history is
 * never required to read the latest release, it only enables trend/baseline.
 */
export const EIA_MAX_RECENT_WEEKS = 10;

/**
 * Phase 280 — a multi-week TREND needs at least four weekly observations, and
 * the four-week change must clear the same documented materiality policy the
 * weekly signal uses (percent of the stock level). Fewer observations or a
 * smaller move → "stable"/"insufficient", never an inferred direction.
 */
export const EIA_TREND_MIN_WEEKS = 4;

/** A baseline read needs at least this many older observations. */
export const EIA_BASELINE_MIN_PERIODS = 3;

/**
 * Materiality for the multi-week trend and the baseline deviation. Pinned to
 * the SAME documented policy percentage the weekly signal uses — a second,
 * invented band would make one release mean two different things.
 */
export const EIA_TREND_MATERIAL_PCT = EIA_SIGNAL_THRESHOLD_PCT;

/** Internal breakdown weights within the single EIA layer (documented). */
const LEG_WEIGHTS: Record<string, number> = {
  EPC0: 0.6, // crude oil excl. SPR — headline series
  EPM0: 0.2, // finished motor gasoline
  EPD0: 0.2, // distillate fuel oil
};

// ── Response parsing (defensive) ───────────────────────────────────

export interface ParsedEiaSeries {
  ok: true;
  productId: string;
  productName?: string;
  unit?: string;
  /** Sorted descending by period (newest first). */
  observations: { period: string; value: number }[];
}

export interface ParsedEiaError {
  ok: false;
  reason: string;
}

/**
 * Parses ONE product leg of an EIA v2 /petroleum/sto/data response.
 * Handles: valid payloads, API error objects ({error, code}), empty data,
 * malformed rows, non-numeric values, and unexpected schemas — always
 * returning an explicit failure reason instead of throwing or guessing.
 */
export function parseEiaResponse(json: unknown): ParsedEiaSeries | ParsedEiaError {
  if (json === null || typeof json !== "object") {
    return { ok: false, reason: "malformed response: not an object" };
  }
  const obj = json as Record<string, unknown>;

  // EIA error shape: { error: "...", code: <http code> }
  if (typeof obj.error === "string" && obj.error.length > 0) {
    return { ok: false, reason: `provider error: ${obj.error}` };
  }

  const response = obj.response as Record<string, unknown> | undefined;
  const rawRows = Array.isArray(response?.data) ? response.data : undefined;
  if (!rawRows) {
    return { ok: false, reason: "unexpected schema: missing response.data array" };
  }
  if (rawRows.length === 0) {
    return { ok: false, reason: "empty dataset for this query" };
  }

  const productId =
    typeof (rawRows[0] as Record<string, unknown>)?.product === "string"
      ? ((rawRows[0] as Record<string, unknown>).product as string)
      : "";
  const productNameRaw = (rawRows[0] as Record<string, unknown>)?.["product-name"];
  const productName = typeof productNameRaw === "string" ? productNameRaw : undefined;
  const unitRaw = (rawRows[0] as Record<string, unknown>)?.units;
  const unit = typeof unitRaw === "string" ? unitRaw : undefined;

  const observations: { period: string; value: number }[] = [];
  for (const row of rawRows) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.period !== "string" || r.period.length < 8) continue; // need a real date
    // Values are standardized STRINGS in APIv2 — parse defensively.
    const value = typeof r.value === "number" ? r.value : parseFloat(String(r.value));
    if (!Number.isFinite(value)) continue; // invalid numeric → skip row, never coerce
    observations.push({ period: r.period, value });
  }
  if (observations.length === 0) {
    return { ok: false, reason: "no valid dated observations in response" };
  }

  // Sort descending by period string (ISO-like YYYY-MM-DD sorts correctly);
  // mixed-format periods would be caught by the date-length filter above.
  observations.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));

  if (!productId) {
    return { ok: false, reason: "missing product facet identifier in rows" };
  }
  return { ok: true, productId, productName, unit, observations };
}

// ── Freshness (weekly slow-data policy) ─────────────────────────────

export function classifyEiaFreshness(latestObservationDate: string, nowMs: number): EiaFreshness {
  const obsMs = Date.parse(`${latestObservationDate}T00:00:00Z`);
  if (!Number.isFinite(obsMs)) return "STALE"; // unparseable date can never look fresh
  const ageDays = Math.floor((nowMs - obsMs) / 86_400_000);
  if (ageDays <= EIA_FRESH_DAYS) return "FRESH";
  if (ageDays <= EIA_DELAYED_DAYS) return "DELAYED";
  return "STALE";
}

// ── Context builder ────────────────────────────────────────────────

export interface EiaLegInput {
  ok: boolean;
  requestedProductId: string;
  /** Parse result when the HTTP fetch succeeded (may still be a parse failure). */
  parsed?: ParsedEiaSeries | ParsedEiaError;
  /** Transport-level failure reason (HTTP status / network). */
  reason?: string;
}

/**
 * Builds the EIA context from independent per-product legs. Each leg either
 * contributes its two most recent REAL observations or an explicit failure —
 * never a synthetic value. The context is available iff at least one leg
 * produced valid data.
 */
export function buildEiaContext(legs: EiaLegInput[], fetchedAt: number, nowMs: number): EiaData {
  const series: EiaSeriesPoint[] = [];
  const failedLegs: { productId: string; reason: string }[] = [];

  for (const leg of legs) {
    if (!leg.ok || !leg.parsed || !leg.parsed.ok) {
      const parseReason = leg.parsed && !leg.parsed.ok ? leg.parsed.reason : undefined;
      failedLegs.push({
        productId: leg.requestedProductId,
        reason: leg.reason ?? parseReason ?? "leg failed without reason",
      });
      continue;
    }
    const p = leg.parsed;
    const [latest, previous] = p.observations;
    if (!latest) {
      failedLegs.push({ productId: leg.requestedProductId, reason: "no observation rows" });
      continue;
    }
    const point: EiaSeriesPoint = {
      productId: p.productId,
      productName: p.productName,
      observationDate: latest.period,
      latestValue: latest.value,
      unit: p.unit,
    };
    if (previous) {
      point.previousObservationDate = previous.period;
      point.previousValue = previous.value;
      point.change = latest.value - previous.value;
      if (previous.value !== 0) {
        point.changePercent = (point.change / previous.value) * 100;
      }
    }
    // Phase 280 — preserve the provider's own older rows (bounded) so the
    // trend/baseline reads are derived from real observations only.
    const older = p.observations.slice(2, 2 + EIA_MAX_RECENT_WEEKS);
    if (older.length > 0) {
      point.recentWeeks = older.map((o) => ({ period: o.period, value: o.value }));
    }
    series.push(point);
  }

  if (series.length === 0) {
    const detail = failedLegs.map((f) => `${f.productId}: ${f.reason}`).join("; ");
    return {
      available: false,
      reason: `No EIA inventory series available${detail ? ` (${detail})` : ""}`,
    };
  }

  const freshness = classifyEiaFreshness(series[0].observationDate, nowMs);
  return { available: true, source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)", fetchedAt, freshness, series, failedLegs };
}

// ── Phase 280 inventory regime derivations ─────────────────────────

/** Documented per-leg weight, exported so the regime read uses ONE policy. */
export function eiaLegWeight(productId: string): number {
  return LEG_WEIGHTS[productId] ?? 0.2;
}

export interface EiaInventoryTrend {
  direction: "declining" | "rising" | "stable" | "insufficient";
  /** Weekly observations actually used (latest first). */
  weeks: number;
  change?: number;
  changePercent?: number;
  /** Exact reason / basis — always stated, never implied. */
  basis: string;
}

/**
 * Multi-week trend of ONE provider series. Compares the latest observation
 * with the value EIA_TREND_MIN_WEEKS − 1 weeks earlier and requires the same
 * documented materiality band as the weekly signal. Below the band, or with
 * fewer observations than the policy minimum, the trend is "stable" /
 * "insufficient" — a direction is never inferred from a 1–2 week series.
 */
export function inventoryTrend(point: EiaSeriesPoint): EiaInventoryTrend {
  const values = [
    point.latestValue,
    ...(point.previousValue !== undefined ? [point.previousValue] : []),
    ...(point.recentWeeks ?? []).map((w) => w.value),
  ];
  const periods = [
    point.observationDate,
    ...(point.previousObservationDate !== undefined ? [point.previousObservationDate] : []),
    ...(point.recentWeeks ?? []).map((w) => w.period),
  ];
  if (values.length < EIA_TREND_MIN_WEEKS) {
    return {
      direction: "insufficient",
      weeks: values.length,
      basis: `${values.length} weekly observation(s) supplied; a ${EIA_TREND_MIN_WEEKS}-observation trend is not derivable from the configured request — no direction is inferred`,
    };
  }
  const backIndex = EIA_TREND_MIN_WEEKS - 1;
  const reference = values[backIndex];
  const referencePeriod = periods[backIndex];
  const change = point.latestValue - reference;
  const pct = reference !== 0 ? (change / Math.abs(reference)) * 100 : undefined;
  const material = pct !== undefined && Math.abs(pct) >= EIA_TREND_MATERIAL_PCT;
  const direction: EiaInventoryTrend["direction"] = !material
    ? "stable"
    : change < 0
      ? "declining"
      : "rising";
  return {
    direction,
    weeks: EIA_TREND_MIN_WEEKS,
    change,
    ...(pct !== undefined ? { changePercent: pct } : {}),
    basis: material
      ? `${EIA_TREND_MIN_WEEKS}-observation change ${change >= 0 ? "+" : ""}${change.toFixed(2)} ${point.unit ?? ""} (${pct!.toFixed(2)}%) from ${referencePeriod} to ${point.observationDate} — a ${EIA_TREND_MIN_WEEKS - 1}-week span`
      : `${EIA_TREND_MIN_WEEKS}-observation change ${pct !== undefined ? `${pct.toFixed(2)}%` : "not computable"} is inside the documented noise band (±${EIA_TREND_MATERIAL_PCT}%)`,
  };
}

export interface EiaBaselinePosition {
  position: "below" | "above" | "at" | "insufficient";
  /** Older observations used for the baseline mean. */
  periods: number;
  deviationPercent?: number;
  basis: string;
}

/**
 * Where the latest observation sits versus the mean of the EARLIER provider
 * observations — the "below recent baseline" read. Requires
 * EIA_BASELINE_MIN_PERIODS older observations and the same documented
 * materiality band; otherwise "insufficient"/"at".
 */
export function baselinePosition(point: EiaSeriesPoint): EiaBaselinePosition {
  const older = [
    ...(point.previousValue !== undefined ? [point.previousValue] : []),
    ...(point.recentWeeks ?? []).map((w) => w.value),
  ];
  if (older.length < EIA_BASELINE_MIN_PERIODS) {
    return {
      position: "insufficient",
      periods: older.length,
      basis: `${older.length} older observation(s) supplied; a baseline needs at least ${EIA_BASELINE_MIN_PERIODS} — no baseline deviation is claimed`,
    };
  }
  const mean = older.reduce((a, b) => a + b, 0) / older.length;
  if (mean === 0) {
    return { position: "insufficient", periods: older.length, basis: "baseline mean is zero — no percentage deviation is computable" };
  }
  const deviation = ((point.latestValue - mean) / Math.abs(mean)) * 100;
  const position: EiaBaselinePosition["position"] =
    Math.abs(deviation) < EIA_TREND_MATERIAL_PCT ? "at" : deviation < 0 ? "below" : "above";
  return {
    position,
    periods: older.length,
    deviationPercent: deviation,
    basis: `${Math.abs(deviation).toFixed(2)}% ${deviation < 0 ? "below" : "above"} the mean of the previous ${older.length} weekly observations`,
  };
}

export interface EiaPhysicalRegime {
  regime: "tightening" | "balanced" | "loosening" | "insufficient";
  draws: number;
  builds: number;
  neutral: number;
  /** Weighted net weekly stock change across the legs that signalled. */
  netChange?: number;
  basis: string;
}

/**
 * DERIVED (never reported) physical-market regime for the ONE WPSR release:
 * the weighted, breadth-checked direction of the week-over-week stock changes
 * across the product legs, using the module's own leg weights and signal
 * thresholds. This is an INTERPRETATION of provider stock changes, not a
 * provider-reported supply/demand balance, and it is the same release the
 * conviction engine's EIA Inventory layer scores for the decision path.
 */
export function derivePhysicalRegime(series: EiaSeriesPoint[]): EiaPhysicalRegime {
  let draws = 0;
  let builds = 0;
  let neutral = 0;
  let weighted = 0;
  let weightSum = 0;
  for (const point of series) {
    const signal = legSignal(point);
    if (signal.direction === 0) {
      neutral += 1;
      continue;
    }
    if (signal.direction > 0) draws += 1;
    else builds += 1;
    const w = eiaLegWeight(point.productId);
    weighted += signal.direction * signal.magnitude * w;
    weightSum += w;
  }
  const net = weightSum > 0 ? weighted / weightSum : undefined;
  if (draws === 0 && builds === 0) {
    return {
      regime: "insufficient",
      draws,
      builds,
      neutral,
      basis: "no product leg carried a change beyond the documented signal thresholds — availability alone is not a tightening/loosening read",
    };
  }
  const regime: EiaPhysicalRegime["regime"] =
    draws > 0 && builds > 0
      ? "balanced" // conflicting legs — never averaged into a one-sided read
      : draws > 0
        ? "tightening"
        : "loosening";
  return {
    regime,
    draws,
    builds,
    neutral,
    ...(net !== undefined ? { netChange: net } : {}),
    basis:
      regime === "balanced"
        ? `product legs disagree (${draws} draw / ${builds} build / ${neutral} neutral) — no net physical direction is claimed`
        : `${draws > 0 ? draws : builds} leg(s) ${draws > 0 ? "drew" : "built"} beyond the documented thresholds (${neutral} neutral), weighted net ${net !== undefined ? net.toFixed(2) : "n/a"}`,
  };
}

// ── Evidence derivation ────────────────────────────────────────────

interface LegSignal {
  productId: string;
  direction: number; // +1 draw (bullish oil longs), −1 build, 0 insufficient
  magnitude: number; // 0..1
  note: string;
}

function legSignal(p: EiaSeriesPoint): LegSignal {
  if (
    p.change === undefined ||
    p.previousValue === undefined ||
    p.previousValue <= 0 ||
    p.latestValue <= 0
  ) {
    return {
      productId: p.productId,
      direction: 0,
      magnitude: 0,
      note: `${p.productId}: single observation / invalid level — no directional evidence (availability ≠ confluence)`,
    };
  }
  const absChange = Math.abs(p.change);
  const pctOfLevel = (absChange / p.previousValue) * 100;
  if (absChange < EIA_SIGNAL_MIN_MBBL || pctOfLevel < EIA_SIGNAL_THRESHOLD_PCT) {
    return {
      productId: p.productId,
      direction: 0,
      magnitude: 0,
      note: `${p.productId}: week-over-week change ${p.change.toFixed(2)} ${p.unit ?? ""} below signal threshold — treated as noise`,
    };
  }
  // Drawdown → supportive of oil longs (+); build → bearish (−). Saturates
  // linearly between threshold and full-effect percentage of the stock level.
  const saturation = Math.min(1, pctOfLevel / EIA_FULL_EFFECT_PCT);
  const direction = p.change < 0 ? 1 : -1; // draw=+1, build=−1
  return {
    productId: p.productId,
    direction,
    magnitude: saturation,
    note: `${p.productId}: ${direction > 0 ? "DRAWDOWN" : "BUILD"} of ${absChange.toFixed(2)} ${p.unit ?? ""} (${pctOfLevel.toFixed(2)}% of stocks, obs ${p.observationDate})`,
  };
}

/**
 * Derives ONE layer's directional evidence from ALL available series of the
 * same WPSR release using documented internal weights (renormalized over the
 * legs that actually have directional signals). Conflicting signs yield MIXED
 * with a reduced net magnitude — never summed into a large one-sided vote.
 */
export function deriveEiaInventoryEvidence(ctx: EiaContext): EiaInventoryEvidence {
  const notes: string[] = [];

  if (ctx.freshness === "STALE") {
    notes.push(`Latest observation ${ctx.series[0].observationDate} exceeds the stale threshold for weekly data — context flagged, not scored`);
    return { effectOnOilLong: 0, aggregate: "INSUFFICIENT", notes };
  }

  const signals = ctx.series.map(legSignal);
  notes.push(...signals.map((s) => s.note));

  const active = signals.filter((s) => s.direction !== 0);
  if (active.length === 0) {
    notes.push("Aggregate: INSUFFICIENT — no series exceeded signal thresholds");
    return { effectOnOilLong: 0, aggregate: "INSUFFICIENT", notes };
  }

  const totalWeight = active.reduce(
    (sum, s) => sum + (LEG_WEIGHTS[s.productId] ?? 0.2),
    0,
  );
  let weightedDirection = 0;
  for (const s of active) {
    weightedDirection += s.direction * s.magnitude * (LEG_WEIGHTS[s.productId] ?? 0.2);
  }
  const net = totalWeight > 0 ? weightedDirection / totalWeight : 0;

  const draws = active.filter((s) => s.direction > 0).length;
  const builds = active.filter((s) => s.direction < 0).length;
  const aggregate: EiaInventoryEvidence["aggregate"] =
    draws > 0 && builds > 0 ? "MIXED" : draws > 0 ? "DRAW" : "BUILD";

  if (Math.abs(net) < 0.05) {
    notes.push("Aggregate: conflicting draws/builds roughly cancel out — no net directional evidence");
    return { effectOnOilLong: 0, aggregate, notes };
  }

  notes.push(
    `Aggregate: ${aggregate}, net weighted effect on oil longs ${net >= 0 ? "+" : ""}${net.toFixed(2)} (one WPSR release = one evidence layer)`,
  );
  return { effectOnOilLong: Math.max(-1, Math.min(1, net)), aggregate, notes };
}
