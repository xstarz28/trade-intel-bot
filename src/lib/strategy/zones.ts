/**
 * Phase 312 — Supply & Demand zone classification (RBR / RBD / DBR / DBD).
 *
 * SOURCE BOUNDARY (documented, not hidden): the source document names the four
 * base-and-leg patterns and the proximal/distal boundaries, but does not
 * provide numeric geometry. Every threshold below is therefore ENGINE-DEFINED
 * (stated, exported, and deterministic) — none is claimed to come from the
 * document. A zone is created ONLY from real candles: a base (a short run of
 * small-range candles) with a directional leg INTO it and a directional leg
 * OUT of it. No zone is created merely because price currently sits somewhere
 * useful.
 *
 * Terminology (source document's):
 *   RBR = Rally–Base–Rally  → demand continuation zone
 *   DBR = Drop–Base–Rally   → demand reversal zone
 *   RBD = Rally–Base-Drop   → supply continuation zone
 *   DBD = Drop–Base-Drop    → supply reversal zone
 *   proximal = the edge of the base nearest the departure direction
 *   distal   = the far edge of the base
 */

import type { OhlcvCandle } from "../data/market-types";
import { atr } from "../data/technical";

/** ENGINE-DEFINED geometry (documented in the header). */
export const BASE_MAX_CANDLES = 6;
export const BASE_MAX_CANDLE_RANGE_ATR = 0.8;
export const BASE_MAX_TOTAL_RANGE_ATR = 1.5;
export const LEG_MIN_MOVE_ATR = 1.0;
export const LEG_MAX_CANDLES = 8;

export type ZoneKind = "RBR" | "RBD" | "DBR" | "DBD";
export type ZoneSide = "demand" | "supply";
export type ZoneLifecycle = "fresh" | "tested" | "broken";
export type ZonePriceLocation = "above" | "below" | "inside";

export interface SupplyDemandZone {
  kind: ZoneKind;
  side: ZoneSide;
  /** Near edge at completion (demand: base high; supply: base low). */
  proximal: number;
  /** Far edge of the base (demand: base low; supply: base high). */
  distal: number;
  timeframe: string;
  /** First candle of the base — provenance, verbatim candle timestamp. */
  baseStartIndex: number;
  baseStartTime: number;
  /** Last candle of the base — the zone's causal knowledge time. */
  baseEndIndex: number;
  baseEndTime: number;
  lifecycle: ZoneLifecycle;
  /** First candle that traded back into the zone after completion. */
  testedAtIndex?: number;
  testedAtTime?: number;
  /** First candle that CLOSED beyond the distal edge (zone failed). */
  brokenAtIndex?: number;
  brokenAtTime?: number;
  /** Location of the CURRENT close relative to the zone. */
  priceLocation: ZonePriceLocation;
  /** Distance from the current close to the proximal edge (price units). */
  distanceToProximal: number;
  /** The ATR the geometry was measured against (provenance of thresholds). */
  atrUsed: number;
}

function netDirection(candles: OhlcvCandle[], from: number, to: number): "up" | "down" | null {
  if (from < 0 || to >= candles.length || to < from) return null;
  const move = candles[to].close - candles[from].close;
  if (!Number.isFinite(move) || move === 0) return null;
  return move > 0 ? "up" : "down";
}

function legIsDirectional(candles: OhlcvCandle[], from: number, to: number, scale: number): boolean {
  if (from < 0 || to >= candles.length || to < from) return false;
  return Math.abs(candles[to].close - candles[from].close) >= LEG_MIN_MOVE_ATR * scale;
}

/**
 * Classify supply/demand zones from actual OHLCV. Deterministic; newest base
 * first. Every index/timestamp in the result is copied verbatim from the input
 * candles — nothing is re-timed or interpolated.
 */
export function detectSupplyDemandZones(
  candles: OhlcvCandle[],
  timeframe: string,
): SupplyDemandZone[] {
  if (candles.length < 6) return [];
  const atrValue = atr(candles);
  const scale =
    atrValue && Number.isFinite(atrValue) && atrValue > 0
      ? atrValue
      : // ENGINE-DEFINED fallback: average true range of the last 20 candles.
        (() => {
          const slice = candles.slice(-Math.min(20, candles.length));
          const trs = slice.map((c, k) => {
            const prevClose = k > 0 ? slice[k - 1].close : c.close;
            return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
          });
          return trs.reduce((a, b) => a + b, 0) / Math.max(1, trs.length);
        })();
  if (!(scale > 0)) return [];

  const zones: SupplyDemandZone[] = [];
  /** Bases already claimed, so overlapping bases never double-report. */
  const usedBases: Array<{ start: number; end: number }> = [];
  const overlapsUsed = (s: number, e: number) =>
    usedBases.some((u) => s <= u.end && e >= u.start);

  for (let start = 1; start < candles.length - 2; start++) {
    for (let end = start; end < Math.min(candles.length - 1, start + BASE_MAX_CANDLES); end++) {
      // ── base shape: every candle small-ranged, total base range bounded ──
      let baseHigh = -Infinity;
      let baseLow = Infinity;
      let isBase = true;
      for (let k = start; k <= end; k++) {
        const c = candles[k];
        if (!(c.high >= c.low) || c.high <= 0 || !Number.isFinite(c.close)) {
          isBase = false;
          break;
        }
        if (c.high - c.low > BASE_MAX_CANDLE_RANGE_ATR * scale) {
          isBase = false;
          break;
        }
        baseHigh = Math.max(baseHigh, c.high);
        baseLow = Math.min(baseLow, c.low);
      }
      if (!isBase) continue;
      if (baseHigh - baseLow > BASE_MAX_TOTAL_RANGE_ATR * scale) continue;
      if (overlapsUsed(start, end)) continue;

      // ── leg OUT of the base (must start at the next candle) ──
      const outTo = Math.min(candles.length - 1, end + LEG_MAX_CANDLES);
      if (outTo <= end) continue;
      const outDir = netDirection(candles, end, outTo);
      if (!outDir || !legIsDirectional(candles, end, outTo, scale)) continue;

      // ── leg INTO the base (ends at `start`, inclusive) ──
      const inFrom = Math.max(0, start - LEG_MAX_CANDLES);
      if (inFrom >= start) continue;
      const inDir = netDirection(candles, inFrom, start);
      if (!inDir || !legIsDirectional(candles, inFrom, start, scale)) continue;

      // ── classification (source terminology) ──
      let kind: ZoneKind;
      let side: ZoneSide;
      if (inDir === "up" && outDir === "up") {
        kind = "RBR";
        side = "demand";
      } else if (inDir === "down" && outDir === "up") {
        kind = "DBR";
        side = "demand";
      } else if (inDir === "up" && outDir === "down") {
        kind = "RBD";
        side = "supply";
      } else {
        kind = "DBD";
        side = "supply";
      }

      const proximal = side === "demand" ? baseHigh : baseLow;
      const distal = side === "demand" ? baseLow : baseHigh;

      // ── lifecycle from candles AFTER the base completes ──
      let lifecycle: ZoneLifecycle = "fresh";
      let testedAtIndex: number | undefined;
      let testedAtTime: number | undefined;
      let brokenAtIndex: number | undefined;
      let brokenAtTime: number | undefined;
      for (let k = end + 1; k < candles.length; k++) {
        const c = candles[k];
        // Close beyond the distal edge ends the zone outright.
        const closedThroughDistal =
          side === "demand" ? c.close < distal : c.close > distal;
        if (closedThroughDistal) {
          lifecycle = "broken";
          brokenAtIndex = k;
          brokenAtTime = c.timestamp;
          break;
        }
        // Traded back into the base band → tested (recorded once).
        if (testedAtIndex === undefined && c.high >= distal && c.low <= proximal) {
          lifecycle = "tested";
          testedAtIndex = k;
          testedAtTime = c.timestamp;
        }
      }

      const lastClose = candles[candles.length - 1].close;
      const priceLocation: ZonePriceLocation =
        lastClose <= proximal && lastClose >= distal
          ? "inside"
          : side === "demand"
            ? lastClose > proximal
              ? "above"
              : "below"
            : lastClose < proximal
              ? "below"
              : "above";

      zones.push({
        kind,
        side,
        proximal,
        distal,
        timeframe,
        baseStartIndex: start,
        baseStartTime: candles[start].timestamp,
        baseEndIndex: end,
        baseEndTime: candles[end].timestamp,
        lifecycle,
        ...(testedAtIndex !== undefined ? { testedAtIndex, testedAtTime } : {}),
        ...(brokenAtIndex !== undefined ? { brokenAtIndex, brokenAtTime } : {}),
        priceLocation,
        distanceToProximal: Math.abs(lastClose - proximal),
        atrUsed: scale,
      });
      usedBases.push({ start, end });
    }
  }

  return zones.reverse(); // newest base first
}
