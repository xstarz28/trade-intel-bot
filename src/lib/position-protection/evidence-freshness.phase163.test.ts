/**
 * Phase 163 — Continuous monitoring: evidence freshness honesty.
 *
 * Defect found and fixed: every deterioration signal was stamped with
 * `observedAt: Date.now()` and `freshness: "FRESH"` regardless of when the
 * underlying evidence was actually observed. Monitoring could therefore
 * raise a signal claiming to be live while the evidence behind it was
 * hours old — a fake alert in the sense that matters: the CLAIM about the
 * data was false, even though the deterioration logic itself was real.
 *
 * These tests pin the honest behaviour:
 *   - signal freshness reflects the real observation time
 *   - evidence with no stated observation time is never asserted FRESH
 *   - future-dated evidence is never treated as live
 *   - periodic evidence (earnings) is never labelled live
 *   - the deterioration ANALYSIS is unchanged; only its provenance claim
 */

import { describe, expect, it } from "vitest";
import { evaluateThesisHealth, extractAllSignals } from "./thesis-health";
import type { MarketEvidence } from "./thesis-health";
import type { PositionContext } from "./types";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const position: PositionContext = {
  positionId: "pos-1",
  instrument: "BTC-USDT",
  assetClass: "crypto",
  side: "LONG",
  entryPrice: 100,
  currentPrice: 95,
  size: 1,
  openedAt: NOW - 2 * HOUR,
} as PositionContext;

/** Evidence that reliably triggers deterioration signals. */
function deterioratingEvidence(
  observedAt: number | undefined,
): MarketEvidence {
  return {
    price: 95,
    ...(observedAt === undefined ? {} : { observedAt }),
    structureBroken: true,
    shortTermTrend: "bearish",
    mediumTermTrend: "bearish",
    momentumChange: -30,
  };
}

function signalsAt(observedAt: number | undefined, now = NOW) {
  return extractAllSignals(position, deterioratingEvidence(observedAt), now)
    .deterioration;
}

// ═══════════════════════════════════════════════════════════════
// A. FRESHNESS REFLECTS REALITY
// ═══════════════════════════════════════════════════════════════

describe("A — signal freshness follows the evidence", () => {
  it("marks signals FRESH for a recent observation", () => {
    const signals = signalsAt(NOW - 1 * MINUTE);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.freshness === "FRESH")).toBe(true);
  });

  it("marks signals DELAYED for a half-hour-old observation", () => {
    const signals = signalsAt(NOW - 30 * MINUTE);
    const technical = signals.filter((s) => s.category === "TECHNICAL");
    expect(technical.length).toBeGreaterThan(0);
    expect(technical.every((s) => s.freshness === "DELAYED")).toBe(true);
  });

  it("marks signals STALE for a six-hour-old observation", () => {
    const signals = signalsAt(NOW - 6 * HOUR);
    const technical = signals.filter((s) => s.category === "TECHNICAL");
    expect(technical.every((s) => s.freshness === "STALE")).toBe(true);
  });

  it("marks signals UNAVAILABLE for a two-day-old observation", () => {
    const signals = signalsAt(NOW - 48 * HOUR);
    expect(signals.every((s) => s.freshness === "UNAVAILABLE")).toBe(true);
  });

  it("records the real observation time, not the evaluation time", () => {
    const observedAt = NOW - 3 * HOUR;
    const signals = signalsAt(observedAt);
    expect(signals.every((s) => s.observedAt === observedAt)).toBe(true);
    expect(signals.every((s) => s.observedAt !== NOW)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. NEVER ASSERT FRESHNESS WITHOUT PROOF
// ═══════════════════════════════════════════════════════════════

describe("B — unknown and impossible observation times", () => {
  it("never claims FRESH when no observation time was supplied", () => {
    const signals = signalsAt(undefined);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((s) => s.freshness === "FRESH")).toBe(false);
    expect(signals.every((s) => s.freshness === "UNAVAILABLE")).toBe(true);
  });

  it("never treats future-dated evidence as live", () => {
    const signals = signalsAt(NOW + 6 * HOUR);
    expect(signals.every((s) => s.freshness === "UNAVAILABLE")).toBe(true);
  });

  it("tolerates benign clock skew", () => {
    const signals = signalsAt(NOW + 5_000);
    expect(signals.every((s) => s.freshness === "FRESH")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PERIODIC EVIDENCE IS NEVER "LIVE"
// ═══════════════════════════════════════════════════════════════

describe("C — periodic fundamentals", () => {
  it("never labels earnings evidence FRESH", () => {
    const signals = extractAllSignals(
      { ...position, assetClass: "equity" } as PositionContext,
      {
        price: 95,
        observedAt: NOW - 1 * MINUTE,
        earningsSurpriseChange: -12,
        guidanceChange: "negative",
      },
      NOW,
    ).deterioration;

    const fundamental = signals.filter((s) => s.category === "FUNDAMENTAL");
    expect(fundamental.length).toBeGreaterThan(0);
    expect(fundamental.every((s) => s.freshness === "STALE")).toBe(true);
  });

  it("degrades very old periodic evidence to UNAVAILABLE", () => {
    const signals = extractAllSignals(
      { ...position, assetClass: "equity" } as PositionContext,
      {
        price: 95,
        observedAt: NOW - 72 * HOUR,
        earningsSurpriseChange: -12,
      },
      NOW,
    ).deterioration;

    const fundamental = signals.filter((s) => s.category === "FUNDAMENTAL");
    expect(fundamental.every((s) => s.freshness === "UNAVAILABLE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. ANALYSIS UNCHANGED — ONLY THE PROVENANCE CLAIM
// ═══════════════════════════════════════════════════════════════

describe("D — deterioration analysis is not weakened", () => {
  it("detects the same signals regardless of evidence age", () => {
    const fresh = signalsAt(NOW - 1 * MINUTE).map((s) => s.name).sort();
    const old = signalsAt(NOW - 6 * HOUR).map((s) => s.name).sort();

    // Stale data does not hide a real deterioration; it only stops us
    // claiming the observation was live.
    expect(old).toEqual(fresh);
  });

  it("keeps severities identical regardless of evidence age", () => {
    const fresh = signalsAt(NOW - 1 * MINUTE).map((s) => s.severity);
    const old = signalsAt(NOW - 6 * HOUR).map((s) => s.severity);
    expect(old).toEqual(fresh);
  });

  it("produces a deterministic health score for a fixed clock", () => {
    const evidence = deterioratingEvidence(NOW - 10 * MINUTE);
    const a = evaluateThesisHealth(position, evidence, NOW);
    const b = evaluateThesisHealth(position, evidence, NOW);
    expect(a.score).toBe(b.score);
    expect(a.state).toBe(b.state);
    expect(a.deteriorationCount).toBe(b.deteriorationCount);
  });

  it("reports no deterioration signals when evidence is healthy", () => {
    const healthy = extractAllSignals(
      position,
      {
        price: 105,
        observedAt: NOW - 1 * MINUTE,
        shortTermTrend: "bullish",
        mediumTermTrend: "bullish",
      },
      NOW,
    ).deterioration;

    // No manufactured alarm when nothing is actually wrong.
    expect(healthy.filter((s) => s.category === "TECHNICAL")).toEqual([]);
  });
});
