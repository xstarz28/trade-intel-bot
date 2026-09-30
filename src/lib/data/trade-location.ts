/**
 * Phase 291 — TRADE LOCATION & SETUP CONTEXT.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * After Phase 290-A the engine knows the STRUCTURE (which confirmed swing level
 * broke, when, and where invalidation sits) and the SMC layer knows the OBJECTS
 * (FVGs, validated order blocks, liquidity pools and sweeps). What it did not
 * have is a deterministic answer to the trader's actual question: *where is
 * price, relative to those objects, and does that location mean anything given
 * the structure?*
 *
 * This layer answers exactly that, and nothing more:
 *
 *   · `readZoneLocation` — price against the real bounds of the real zones
 *     (inside / at boundary / outside), the nearest resting liquidity on each
 *     side, and whether the latest sweep is still the current story. No zone is
 *     ever created to fit the price, and no percentage distance is invented:
 *     the only tolerance used is `EQUAL_LEVEL_TOLERANCE`, the constant this
 *     repository already uses to decide when two levels are the same level.
 *
 *   · `readSetupContext` — a deterministic STATE MACHINE over evidence that is
 *     already computed: the external regime, the internal leg, the latest
 *     confirmed structural event, the zones, displacement and the liquidity
 *     event. It produces one of six explicit states (never a score, never a
 *     probability), and it exposes every component separately so the verdict can
 *     be audited:
 *
 *         INVALID_SETUP_CONTEXT   structure of these candles says the other way
 *         COUNTER_TREND_SETUP     price is positioned against an intact regime
 *                                 while the internal leg turns
 *         CONFIRMED_SETUP_CONTEXT direction + qualifying zone + confirmation
 *         STRUCTURAL_SETUP        direction, but the location is not engaged
 *         LOCATION_ONLY           a zone or a sweep without structural support
 *         NO_SETUP_EVIDENCE       nothing to stand on
 *
 * Rules the state machine obeys without exception:
 *   · a liquidity sweep ALONE is never a directional signal — it needs the
 *     structural leg, and by itself it can only produce LOCATION_ONLY;
 *   · an internal (minor) read can refine an intact external regime but can
 *     never silently flip it, so internal agreement is what separates
 *     COUNTER_TREND_SETUP from INVALID_SETUP_CONTEXT;
 *   · nothing here reads a candle after the one being described, and every
 *     number in the output comes from a real candle, a real zone or a real
 *     structural event.
 */

import {
  EQUAL_LEVEL_TOLERANCE,
  type SwingPoint,
} from "./smc";
import type {
  FairValueGap,
  LiquiditySide,
  LiquiditySweepEvent,
  ObStatus,
  FvgStatus,
  OrderBlock,
  SmcContext,
} from "./market-types";
import type { StructuralRead, StructureDirection, StructurePair } from "./structure";

// ── Documented windows ────────────────────────────────────────────

/**
 * A sweep older than this is no longer "the current location story": the SMC
 * layer keeps the most recent 12 FVGs and the block validator allows 8 candles
 * for its structural confirmation, so a dozen candles is the same order of
 * recency the rest of the engine already treats as current. Stated here because
 * a recency window is a policy choice, not a derived quantity.
 */
export const SWEEP_RECENCY_CANDLES = 12;

/** Boundary tolerance — the repository's existing equal-level tolerance (0.15%). */
export const ZONE_BOUNDARY_TOLERANCE = EQUAL_LEVEL_TOLERANCE;

// ── Zone location ─────────────────────────────────────────────────

export type ZonePosition = "inside" | "at_boundary" | "outside";

export interface ZoneView {
  kind: "FVG" | "OB";
  direction: "bullish" | "bearish";
  upper: number;
  lower: number;
  status: FvgStatus | ObStatus;
  /** Candle that created the zone (third FVG candle / source OB candle). */
  createdAtIndex: number;
  createdAt: number;
  /** Candle at which the zone became VALIDATED (OB: structural event; FVG: creation). */
  knownAtIndex: number;
  knownAt: number;
  position: ZonePosition;
  /** Absolute distance from the latest close to the NEAREST bound (0 when inside). */
  distanceToBoundary: number;
  /** Candles between creation and the candle being described. */
  ageCandles: number;
  /** Zone-specific lifecycle timestamps the engine already recorded. */
  mitigatedAt?: number;
  invalidatedAt?: number;
}

function positionOf(
  price: number,
  lower: number,
  upper: number,
): { position: ZonePosition; distanceToBoundary: number } {
  if (price >= lower && price <= upper) return { position: "inside", distanceToBoundary: 0 };
  const nearest = price < lower ? lower : upper;
  const distance = Math.abs(price - nearest);
  const tolerance = nearest * ZONE_BOUNDARY_TOLERANCE;
  return {
    position: distance <= tolerance ? "at_boundary" : "outside",
    distanceToBoundary: distance,
  };
}

function fvgView(fvg: FairValueGap, price: number, lastIndex: number): ZoneView {
  const { position, distanceToBoundary } = positionOf(price, fvg.lower, fvg.upper);
  return {
    kind: "FVG",
    direction: fvg.direction,
    upper: fvg.upper,
    lower: fvg.lower,
    status: fvg.status,
    createdAtIndex: fvg.createdAtIndex,
    createdAt: fvg.createdAt,
    // A three-candle gap needs all three candles; that IS its knowledge time.
    knownAtIndex: fvg.createdAtIndex,
    knownAt: fvg.createdAt,
    position,
    distanceToBoundary,
    ageCandles: Math.max(0, lastIndex - fvg.createdAtIndex),
    ...(fvg.mitigatedAt !== undefined ? { mitigatedAt: fvg.mitigatedAt } : {}),
    ...(fvg.invalidatedAt !== undefined ? { invalidatedAt: fvg.invalidatedAt } : {}),
  };
}

function obView(ob: OrderBlock, price: number, lastIndex: number): ZoneView {
  const { position, distanceToBoundary } = positionOf(price, ob.lower, ob.upper);
  return {
    kind: "OB",
    direction: ob.direction,
    upper: ob.upper,
    lower: ob.lower,
    status: ob.status,
    createdAtIndex: ob.sourceIndex,
    createdAt: ob.createdAt,
    // The block only exists once its evidence (displacement, then the confirmed
    // structural event) has printed.
    knownAtIndex: ob.validatedAtIndex,
    knownAt: ob.validatedAt,
    position,
    distanceToBoundary,
    ageCandles: Math.max(0, lastIndex - ob.validatedAtIndex),
    ...(ob.mitigatedAt !== undefined ? { mitigatedAt: ob.mitigatedAt } : {}),
    ...(ob.invalidatedAt !== undefined ? { invalidatedAt: ob.invalidatedAt } : {}),
  };
}

// ── Liquidity location ────────────────────────────────────────────

export interface LiquidityContext {
  /** The latest sweep in the series — always after its pool became knowable. */
  sweep?: {
    side: LiquiditySide;
    level: number;
    source: LiquiditySweepEvent["source"];
    candleIndex: number;
    candleTime: number;
    poolFormedAtIndex: number;
    poolFormedAtTime: number;
    ageCandles: number;
    /** Swept-side favour for a requested direction (undefined without one). */
    favorable?: boolean;
  };
  nearestBuySide?: { level: number; source: LiquiditySweepEvent["source"]; distance: number };
  nearestSellSide?: { level: number; source: LiquiditySweepEvent["source"]; distance: number };
  /** Price sits within the equal-level tolerance of a resting pool. */
  atLiquidityLevel: boolean;
  /** A sweep printed within SWEEP_RECENCY_CANDLES of the latest candle. */
  afterSweep: boolean;
  /** Levels that were CLOSED through (breakouts — no longer liquidity). */
  brokenLevels: number[];
}

function liquidityContext(
  smc: SmcContext,
  price: number,
  lastIndex: number,
  direction: "bullish" | "bearish" | "none",
): LiquidityContext {
  const sw = smc.recentSweep;
  const sweep = sw
    ? {
        side: sw.side,
        level: sw.level,
        source: sw.source,
        candleIndex: sw.candleIndex,
        candleTime: sw.candleTime,
        poolFormedAtIndex: sw.poolFormedAtIndex,
        poolFormedAtTime: sw.poolFormedAtTime,
        ageCandles: Math.max(0, lastIndex - sw.candleIndex),
        ...(direction === "none"
          ? {}
          : {
              favorable:
                direction === "bullish" ? sw.side === "sell_side" : sw.side === "buy_side",
            }),
      }
    : undefined;

  const pools = smc.liquidityPools ?? [];
  const resting = pools.filter((p) => !p.swept && !p.broken);
  const nearest = (side: LiquiditySide) =>
    resting
      .filter((p) => p.side === side)
      .map((p) => ({
        level: p.level,
        source: p.source,
        distance: Math.abs(price - p.level),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

  const buy = nearest("buy_side");
  const sell = nearest("sell_side");
  const closeTo = (p?: { level: number }) =>
    p !== undefined && Math.abs(price - p.level) <= p.level * ZONE_BOUNDARY_TOLERANCE;

  return {
    ...(sweep ? { sweep } : {}),
    ...(buy ? { nearestBuySide: buy } : {}),
    ...(sell ? { nearestSellSide: sell } : {}),
    atLiquidityLevel: closeTo(buy) || closeTo(sell),
    afterSweep: sweep !== undefined && sweep.ageCandles <= SWEEP_RECENCY_CANDLES,
    brokenLevels: pools.filter((p) => p.broken).map((p) => p.level),
  };
}

// ── Trade location ────────────────────────────────────────────────

export type TradeLocationKind =
  | "inside_fvg"
  | "at_fvg_boundary"
  | "inside_ob"
  | "at_ob_boundary"
  | "at_liquidity_level"
  | "after_sweep"
  | "displaced_away"
  | "outside_zones";

export interface TradeLocation {
  timeframe: string;
  price: number;
  atCandleIndex: number;
  atTime: number;
  /** Non-invalidated zones, nearest to price first. */
  zones: ZoneView[];
  fvg?: ZoneView;
  ob?: ZoneView;
  liquidity: LiquidityContext;
  displacement?: {
    direction: "bullish" | "bearish";
    candleIndex: number;
    candleTime: number;
    ageCandles: number;
  };
  location: TradeLocationKind;
  /** Explicit answers to each question §7 asks — never collapsed into one flag. */
  flags: {
    insideFvg: boolean;
    atFvgBoundary: boolean;
    insideOb: boolean;
    atObBoundary: boolean;
    nearLiquidity: boolean;
    afterSweep: boolean;
    displacedAway: boolean;
    outsideZones: boolean;
  };
  facts: string[];
}

const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/0+$/, "");

/** "1 candle ago" / "5 candles ago" — fact lines read as sentences, not logs. */
const ago = (n: number): string => (n === 1 ? "1 candle ago" : `${n} candles ago`);

/**
 * The exact observation a location is described against: the latest candle of
 * that timeframe's own series. The MTF layer records it per timeframe, so a
 * timeframe can be described without shipping its whole candle array around.
 */
export interface LocationAnchor {
  price: number;
  lastIndex: number;
  atTime: number;
}

/** The anchor of a candle series — its last candle, which is the observation. */
export function anchorFromCandles(candles: { timestamp: number; close: number }[]): LocationAnchor {
  const last = Math.max(0, candles.length - 1);
  return {
    price: candles[last]?.close ?? 0,
    lastIndex: last,
    atTime: candles[last]?.timestamp ?? 0,
  };
}

/**
 * Where the LATEST provider observation sits relative to the real objects of
 * this timeframe. `direction` is optional and only adds the sweep-favour note.
 */
export function readZoneLocation(
  timeframe: string,
  smc: SmcContext,
  anchor: LocationAnchor,
  direction: "bullish" | "bearish" | "none" = "none",
): TradeLocation {
  const lastIndex = anchor.lastIndex;
  const price = anchor.price;

  const usable = (status: FvgStatus | ObStatus) => status !== "invalidated";
  // Defensive by construction: a partially-populated context degrades to "no
  // zones" instead of throwing — a missing zone is never a fabricated one.
  const zones: ZoneView[] = [
    ...(smc.fvgs ?? []).filter((f) => usable(f.status)).map((f) => fvgView(f, price, lastIndex)),
    ...(smc.orderBlocks ?? []).filter((o) => usable(o.status)).map((o) => obView(o, price, lastIndex)),
  ].sort((a, b) => a.distanceToBoundary - b.distanceToBoundary);

  const fvg = zones.find((z) => z.kind === "FVG");
  const ob = zones.find((z) => z.kind === "OB");
  const liquidity = liquidityContext(smc, price, lastIndex, direction);

  const displacement = smc.displacement
    ? {
        direction: smc.displacement.direction,
        candleIndex: smc.displacement.candleIndex,
        candleTime: smc.displacement.candleTime,
        ageCandles: Math.max(0, lastIndex - smc.displacement.candleIndex),
      }
    : undefined;

  const flags = {
    insideFvg: fvg?.position === "inside",
    atFvgBoundary: fvg?.position === "at_boundary",
    insideOb: ob?.position === "inside",
    atObBoundary: ob?.position === "at_boundary",
    nearLiquidity: liquidity.atLiquidityLevel,
    afterSweep: liquidity.afterSweep,
    // Displaced AWAY: the latest displacement candle printed after the nearest
    // zone existed and price now sits outside every zone on that side.
    displacedAway:
      displacement !== undefined &&
      zones.length > 0 &&
      zones.every((z) => z.position === "outside") &&
      zones.every((z) => z.knownAtIndex <= displacement.candleIndex),
    outsideZones: zones.every((z) => z.position === "outside"),
  };

  const location: TradeLocationKind = flags.insideFvg
    ? "inside_fvg"
    : flags.atFvgBoundary
      ? "at_fvg_boundary"
      : flags.insideOb
        ? "inside_ob"
        : flags.atObBoundary
          ? "at_ob_boundary"
          : flags.afterSweep
            ? "after_sweep"
            : flags.nearLiquidity
              ? "at_liquidity_level"
              : flags.displacedAway
                ? "displaced_away"
                : "outside_zones";

  const facts: string[] = [];
  if (fvg) {
    facts.push(
      `FVG ${fvg.direction} ${fmt(fvg.lower)}–${fmt(fvg.upper)} (${fvg.status}, created candle ${fvg.createdAtIndex}, ${ago(fvg.ageCandles)})`,
    );
    if (fvg.position === "inside") facts.push(`Price inside ${fvg.direction} FVG ${fmt(fvg.lower)}–${fmt(fvg.upper)}`);
    else if (fvg.position === "at_boundary")
      facts.push(`Price at ${fvg.direction} FVG boundary ${fmt(fvg.lower)}–${fmt(fvg.upper)}`);
  }
  if (ob) {
    facts.push(
      `OB ${ob.direction} ${fmt(ob.lower)}–${fmt(ob.upper)} (${ob.status}, validated candle ${ob.knownAtIndex}, ${ago(ob.ageCandles)})`,
    );
    if (ob.position === "inside") facts.push(`Price inside ${ob.direction} OB ${fmt(ob.lower)}–${fmt(ob.upper)}`);
    else if (ob.position === "at_boundary")
      facts.push(`Price at ${ob.direction} OB boundary ${fmt(ob.lower)}–${fmt(ob.upper)}`);
  }
  if (liquidity.sweep) {
    const s = liquidity.sweep;
    facts.push(
      `${s.side === "buy_side" ? "Buy-side" : "Sell-side"} liquidity swept at ${fmt(s.level)} on candle ${s.candleIndex} (pool known from candle ${s.poolFormedAtIndex}, ${ago(s.ageCandles)})`,
    );
  }
  if (liquidity.afterSweep) facts.push("Price is after a liquidity sweep");
  if (flags.outsideZones && zones.length > 0) facts.push("Price outside every identified zone");
  if (zones.length === 0) facts.push("No qualifying zone on this timeframe");
  if (liquidity.brokenLevels.length > 0) {
    facts.push(
      `Closed through liquidity at ${liquidity.brokenLevels.slice(0, 3).map(fmt).join(", ")} (breakout, not resting liquidity)`,
    );
  }

  return {
    timeframe,
    price,
    atCandleIndex: lastIndex,
    atTime: anchor.atTime,
    zones,
    ...(fvg ? { fvg } : {}),
    ...(ob ? { ob } : {}),
    liquidity,
    ...(displacement ? { displacement } : {}),
    location,
    flags,
    facts,
  };
}

// ── Setup context state machine ───────────────────────────────────

export type SetupContextState =
  | "NO_SETUP_EVIDENCE"
  | "LOCATION_ONLY"
  | "STRUCTURAL_SETUP"
  | "CONFIRMED_SETUP_CONTEXT"
  | "COUNTER_TREND_SETUP"
  | "INVALID_SETUP_CONTEXT";

export interface SetupContext {
  timeframe: string;
  /** The direction under consideration (the caller's thesis, or the regime). */
  direction: "bullish" | "bearish" | "none";
  state: SetupContextState;
  /** Every component exposed separately — the verdict is auditable, never opaque. */
  evidence: {
    externalStructure: StructureDirection;
    internalStructure: StructureDirection;
    pairState: StructurePair["state"];
    externalEvent?: StructuralRead["lastEvent"];
    internalEvent?: StructuralRead["lastEvent"];
    externalInvalidation?: StructuralRead["invalidation"];
    supportingZone?: ZoneView;
    zoneEngaged: boolean;
    opposingZone?: ZoneView;
    favorableSweep?: LiquidityContext["sweep"];
    opposingSweep?: LiquidityContext["sweep"];
    displacementAligned: boolean;
  };
  /** Why this state was chosen, in the order the machine evaluated. */
  reasons: string[];
  facts: string[];
}

const opposite = (d: "bullish" | "bearish"): "bullish" | "bearish" =>
  d === "bullish" ? "bearish" : "bullish";

export interface SetupContextInput {
  timeframe: string;
  /** The structural pair of THIS timeframe (Phase 290-A read). */
  pair?: StructurePair;
  location: TradeLocation;
  /** Direction under consideration; defaults to the external regime. */
  direction?: "bullish" | "bearish" | "none";
}

/**
 * The deterministic setup-context verdict. No weights, no thresholds beyond the
 * zone-boundary tolerance, no probability — just the state the evidence names.
 */
export function readSetupContext(input: SetupContextInput): SetupContext {
  const { timeframe, pair, location } = input;
  const external = pair?.external;
  const internal = pair?.internal;
  const externalDirection: StructureDirection = external?.direction ?? "none";
  const internalDirection: StructureDirection = internal?.direction ?? "none";
  const direction: "bullish" | "bearish" | "none" =
    input.direction ?? (externalDirection === "none" ? "none" : externalDirection);

  const reasons: string[] = [];
  const facts: string[] = [];

  const zones = location.zones;
  const supporting =
    direction === "none" ? undefined : zones.find((z) => z.direction === direction);
  const opposing =
    direction === "none" ? undefined : zones.find((z) => z.direction === opposite(direction));
  const engaged = supporting !== undefined && supporting.position !== "outside";
  const displacementAligned =
    direction !== "none" &&
    location.displacement !== undefined &&
    location.displacement.direction === direction;
  const sweep = location.liquidity.sweep;
  // Favour is decided by DIRECTION CONVENTION here, so the verdict never depends
  // on whether the caller asked the location reader for a directional note: a
  // sell-side sweep removes the stops beneath the market (favour for longs).
  const sweepFavorable =
    sweep === undefined || direction === "none"
      ? undefined
      : (sweep.favorable ??
        (direction === "bullish" ? sweep.side === "sell_side" : sweep.side === "buy_side"));
  const favorableSweep = sweepFavorable === true ? sweep : undefined;
  const opposingSweep = sweepFavorable === false ? sweep : undefined;
  const structureAligned = direction !== "none" && externalDirection === direction;
  const structureOpposed = direction !== "none" && externalDirection !== "none" && externalDirection !== direction;
  const internalAligned = direction !== "none" && internalDirection === direction;
  const hasAnyEvidence =
    externalDirection !== "none" ||
    internalDirection !== "none" ||
    zones.length > 0 ||
    sweep !== undefined ||
    location.displacement !== undefined;

  let state: SetupContextState;
  if (direction === "none") {
    // No thesis and no readable regime: the location may still be describable.
    state =
      zones.length > 0 || sweep !== undefined || location.displacement !== undefined
        ? "LOCATION_ONLY"
        : "NO_SETUP_EVIDENCE";
    reasons.push(
      externalDirection === "none"
        ? "no confirmed external structure on this timeframe — no direction can be claimed"
        : "no direction requested",
    );
    if (state === "LOCATION_ONLY") {
      reasons.push("location exists but nothing turns it into a directional setup");
    }
  } else if (structureOpposed && !internalAligned) {
    state = "INVALID_SETUP_CONTEXT";
    reasons.push(
      `external structure is ${externalDirection} on ${timeframe} while the thesis is ${direction} — the internal leg does not agree, so this is not even a counter-trend setup`,
    );
  } else if (structureOpposed && internalAligned) {
    state = "COUNTER_TREND_SETUP";
    reasons.push(
      `external structure is ${externalDirection} while the internal leg has turned ${direction} — counter-trend location inside an intact regime; the regime is unchanged until external evidence says otherwise`,
    );
  } else if (structureAligned) {
    if (supporting !== undefined && (engaged || displacementAligned || favorableSweep !== undefined)) {
      state = "CONFIRMED_SETUP_CONTEXT";
      reasons.push(`structure ${direction} with a qualifying ${supporting.kind} zone`);
      if (engaged) reasons.push(`price is ${supporting.position === "inside" ? "inside" : "at the boundary of"} the zone`);
      if (displacementAligned) reasons.push("displacement in the thesis direction");
      if (favorableSweep) reasons.push("sweep against the thesis side (liquidity taken before the move)");
    } else {
      state = "STRUCTURAL_SETUP";
      reasons.push(
        supporting === undefined
          ? `structure ${direction} but no qualifying zone on this timeframe`
          : `structure ${direction} with a ${supporting.kind} zone that price has not engaged and no confirming displacement`,
      );
    }
  } else {
    // No readable external regime (externalDirection === "none"), or the thesis
    // matches no regime. Only location evidence is available.
    state = zones.length > 0 || sweep !== undefined || location.displacement !== undefined
      ? "LOCATION_ONLY"
      : "NO_SETUP_EVIDENCE";
    reasons.push(
      externalDirection === "none"
        ? "no confirmed external structure on this timeframe — location cannot be upgraded to a structural setup"
        : `external structure is ${externalDirection}, which is neither the thesis nor an opposing regime`,
    );
  }

  if (state === "CONFIRMED_SETUP_CONTEXT" && opposing !== undefined && opposing.position !== "outside") {
    // A zone on the other side that price is also sitting in is a contradiction,
    // not a confirmation: the location cannot support two directions at once.
    state = "INVALID_SETUP_CONTEXT";
    reasons.push(
      `price is also ${opposing.position === "inside" ? "inside" : "at the boundary of"} the opposing ${opposing.kind} zone ${fmt(opposing.lower)}–${fmt(opposing.upper)}`,
    );
  }

  // Facts — deterministic lines, every one traceable to a candle or a level.
  if (externalDirection !== "none") {
    facts.push(`External structure ${externalDirection} on ${timeframe}`);
  } else {
    facts.push(`No confirmed external structure on ${timeframe}`);
  }
  if (internalDirection !== "none") facts.push(`Internal structure ${internalDirection}`);
  if (external?.lastEvent) {
    const e = external.lastEvent;
    facts.push(
      `Confirmed ${e.kind} ${e.direction} at ${fmt(e.brokenLevel)} (candle ${e.candleIndex}, ${new Date(e.candleTime).toISOString()})`,
    );
  }
  if (supporting) {
    facts.push(`Qualifying ${supporting.kind} zone ${supporting.direction} ${fmt(supporting.lower)}–${fmt(supporting.upper)} (${supporting.status})`);
  } else if (direction !== "none") {
    facts.push("No qualifying zone in the thesis direction");
  }
  if (favorableSweep) {
    facts.push(`Liquidity swept at ${fmt(favorableSweep.level)} on the thesis side before the move`);
  } else if (opposingSweep) {
    facts.push(`Liquidity swept at ${fmt(opposingSweep.level)} on the opposite side — not a signal on its own`);
  } else if (sweep !== undefined) {
    facts.push(
      `Liquidity swept at ${fmt(sweep.level)} on candle ${sweep.candleIndex} but no structural confirmation on this timeframe`,
    );
  }
  if (direction === "none" && zones.length > 0) {
    facts.push(
      `Zone present (${zones[0].kind} ${zones[0].direction} ${fmt(zones[0].lower)}–${fmt(zones[0].upper)}) but no confirmed structure to place it in a setup`,
    );
  }
  if (opposing !== undefined && opposing.position !== "outside") {
    facts.push(`Opposing ${opposing.kind} zone ${fmt(opposing.lower)}–${fmt(opposing.upper)} contains price`);
  }
  if (internalDirection !== "none" && externalDirection !== "none" && internalDirection !== externalDirection) {
    facts.push("Internal leg runs against the external regime (trigger context only)");
  }
  if (!hasAnyEvidence) facts.push("No structural, zone or liquidity evidence on this timeframe");
  facts.push(`Setup context ${state}`);

  return {
    timeframe,
    direction,
    state,
    evidence: {
      externalStructure: externalDirection,
      internalStructure: internalDirection,
      pairState: pair?.state ?? "BOTH_UNKNOWN",
      ...(external?.lastEvent ? { externalEvent: external.lastEvent } : {}),
      ...(internal?.lastEvent ? { internalEvent: internal.lastEvent } : {}),
      ...(external?.invalidation ? { externalInvalidation: external.invalidation } : {}),
      ...(supporting ? { supportingZone: supporting } : {}),
      zoneEngaged: engaged,
      ...(opposing ? { opposingZone: opposing } : {}),
      ...(favorableSweep ? { favorableSweep } : {}),
      ...(opposingSweep ? { opposingSweep } : {}),
      displacementAligned,
    },
    reasons,
    facts,
  };
}

// ── Invalidation evidence handoff (no risk-management changes) ─────

export interface InvalidationEvidence {
  /** Which object supplies the level. */
  source: "structural_invalidation" | "order_block" | "fair_value_gap" | "swept_liquidity";
  level: number;
  timeframe: string;
  /** Deterministic note — never chosen for how a reward/risk ratio looks. */
  note: string;
}

/**
 * The levels the EXISTING risk layer may consume, each with its provenance.
 * Nothing is ranked or picked here: choosing a stop stays with the risk code.
 */
export function invalidationEvidence(
  timeframe: string,
  smc: SmcContext,
  pair?: StructurePair,
): InvalidationEvidence[] {
  const out: InvalidationEvidence[] = [];
  const inv = pair?.external.invalidation ?? smc.structural?.external.invalidation;
  if (inv) {
    out.push({
      source: "structural_invalidation",
      level: inv.level,
      timeframe,
      note: `${timeframe} confirmed structural ${inv.swingKind} (swing #${inv.swingIndex}, ${new Date(inv.timestamp).toISOString()})`,
    });
  }
  for (const ob of (smc.orderBlocks ?? []).filter((o) => o.status !== "invalidated")) {
    out.push({
      source: "order_block",
      level: ob.direction === "bullish" ? ob.lower : ob.upper,
      timeframe,
      note: `${ob.direction} order block far side ${fmt(ob.lower)}–${fmt(ob.upper)} (validated candle ${ob.validatedAtIndex})`,
    });
  }
  for (const f of (smc.fvgs ?? []).filter((z) => z.status !== "invalidated")) {
    out.push({
      source: "fair_value_gap",
      level: f.direction === "bullish" ? f.lower : f.upper,
      timeframe,
      note: `${f.direction} FVG far side ${fmt(f.lower)}–${fmt(f.upper)} (created candle ${f.createdAtIndex})`,
    });
  }
  const sweeps = smc.recentSweep;
  if (sweeps) {
    out.push({
      source: "swept_liquidity",
      level: sweeps.level,
      timeframe,
      note: `${sweeps.side} liquidity level swept on candle ${sweeps.candleIndex} (pool known from candle ${sweeps.poolFormedAtIndex})`,
    });
  }
  return out;
}

/** Swings of a timeframe, newest first — convenience for callers that need them. */
export function newestSwings(points: SwingPoint[], count = 3): SwingPoint[] {
  return [...points].sort((a, b) => b.index - a.index).slice(0, count);
}
