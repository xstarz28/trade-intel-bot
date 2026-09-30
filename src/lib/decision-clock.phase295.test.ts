/**
 * Phase 295 — CANONICAL DECISION CLOCK SUITE (§2–§5, §10, §11).
 *
 * Proves, at the engine boundary:
 *  · LIVE keeps the real wall clock and stays exactly as strict as before;
 *  · HISTORICAL_AS_OF measures freshness against the historical evaluation
 *    instant, so a candle that was current then is current there — while an
 *    input dated AFTER that instant is still refused;
 *  · the current system date cannot influence a historical decision;
 *  · an unusable deterministic clock fails closed instead of borrowing today.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MtfCandleInput } from "@/lib/data/mtf";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import {
  LIVE_DECISION_CLOCK,
  decisionClockMode,
  describeDecisionClock,
  fixedTestClock,
  historicalAsOfClock,
  isLiveClock,
  isValidDecisionClock,
  resolveDecisionNow,
} from "@/lib/decision-clock";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

const INTERVAL = 4 * 3600_000;
const NOW = Date.now();
/** The designed series ends here, so the whole prefix is old relative to "today". */
const SERIES_END = NOW - 120 * INTERVAL; // ~20 days ago
const DAY = 24 * 3600_000;

/** 90 designed H4 bars — enough for structure, MTF and the gate chain. */
function series(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let i = 0; i < 90; i += 1) {
    const p = 100 + i * 0.35 + Math.sin(i / 4) * 1.2;
    out.push({
      timestamp: SERIES_END - (89 - i) * INTERVAL,
      open: p - 0.2,
      high: p + 0.6,
      low: p - 0.8,
      close: p,
      volume: 1000,
    });
  }
  return out;
}

function techFor(candles: readonly OhlcvCandle[]): TechnicalData {
  const c = candles as OhlcvCandle[];
  return {
    ...calculateTechnical(c, c, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc: computeSmcContext(c, "H4"),
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles: c },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles: c } satisfies MtfCandleInput)),
    ]),
  };
}

/** Input for the designed series, with an overridable price-snapshot instant. */
function inputWith(overrides: { priceTimestamp?: number; clock?: AnalysisInput["decisionClock"] } = {}): AnalysisInput {
  const candles = series();
  const last = candles[candles.length - 1];
  return {
    instrument: "TEST/USD",
    instrumentType: "forex",
    timeframe: "H4" as Timeframe,
    provider: "test-fixture-generator",
    providerInstrumentId: "TEST-USD",
    marketData: {
      instrument: "TEST/USD",
      instrumentType: "forex",
      provider: "test-fixture-generator",
      providerInstrumentId: "TEST-USD",
      fetchTimestamp: overrides.priceTimestamp ?? last.timestamp,
      price: {
        price: last.close,
        timestamp: overrides.priceTimestamp ?? last.timestamp,
        source: "test-fixture-generator",
      },
      candles,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as unknown as MarketData,
    technicalData: techFor(candles),
    economicEvents: "",
    ...(overrides.clock !== undefined ? { decisionClock: overrides.clock } : {}),
  } as AnalysisInput;
}

const reasonsOf = (result: AnalysisResult): string => (result.noTradeReasons ?? []).join(" | ");
const decisive = (result: AnalysisResult) =>
  JSON.stringify({
    recommendation: result.recommendation,
    bias: result.bias,
    confidence: result.confidence,
    setup: result.tradeLocation?.context.state ?? null,
    location: result.tradeLocation?.location ?? null,
    plan: result.tradePlan ?? null,
    reasons: result.noTradeReasons ?? [],
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§2 canonical clock resolution", () => {
  it("resolves LIVE to the real wall clock and the deterministic modes to their own instant", () => {
    const before = Date.now();
    const live = resolveDecisionNow();
    const liveExplicit = resolveDecisionNow(LIVE_DECISION_CLOCK);
    const after = Date.now();
    expect(live).toBeGreaterThanOrEqual(before);
    expect(live).toBeLessThanOrEqual(after);
    expect(liveExplicit).toBeGreaterThanOrEqual(before);
    expect(liveExplicit).toBeLessThanOrEqual(after);

    const asOf = 1_780_000_000_000;
    expect(resolveDecisionNow(historicalAsOfClock(asOf))).toBe(asOf);
    expect(resolveDecisionNow(fixedTestClock(asOf))).toBe(asOf);
    expect(isLiveClock()).toBe(true);
    expect(isLiveClock(LIVE_DECISION_CLOCK)).toBe(true);
    expect(isLiveClock(historicalAsOfClock(asOf))).toBe(false);
    expect(decisionClockMode(undefined)).toBe("LIVE_WALL_CLOCK");
    expect(decisionClockMode(historicalAsOfClock(asOf))).toBe("HISTORICAL_AS_OF");
    expect(decisionClockMode(fixedTestClock(asOf))).toBe("FIXED_TEST_CLOCK");
  });

  it("fails closed on an unusable deterministic clock instead of borrowing today", () => {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const clock = historicalAsOfClock(bad);
      expect(isValidDecisionClock(clock)).toBe(false);
      expect(Number.isNaN(resolveDecisionNow(clock))).toBe(true);
      expect(describeDecisionClock(clock)).toContain("INVALID deterministic clock");
    }
    expect(isValidDecisionClock(historicalAsOfClock(1_780_000_000_000))).toBe(true);
    expect(isValidDecisionClock(undefined)).toBe(true);
  });

  it("describes each mode factually and never claims a historical run is live", () => {
    const live = describeDecisionClock(LIVE_DECISION_CLOCK);
    expect(live).toContain("LIVE wall clock");
    const historical = describeDecisionClock(historicalAsOfClock(1_780_000_000_000));
    expect(historical).toContain("HISTORICAL AS-OF 2026-05-28");
    expect(historical).toContain("never a live feed");
    expect(historical).not.toMatch(/\bLIVE\b/);
    expect(describeDecisionClock(fixedTestClock(1_780_000_000_000))).toContain("FIXED TEST instant");
  });
});

describe("§5 the client boundary can never move the clock", () => {
  it("classifies decisionClock as untrusted and strips it from client input", async () => {
    const { CLIENT_TRUSTED_INPUT_FIELDS, CLIENT_UNTRUSTED_EVIDENCE_FIELDS, stripClientEvidence } = await import(
      "@/convex/protectedAnalysis"
    );
    expect(CLIENT_UNTRUSTED_EVIDENCE_FIELDS).toContain("decisionClock");
    expect(CLIENT_TRUSTED_INPUT_FIELDS).not.toContain("decisionClock");

    const clean = stripClientEvidence({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      // A forged instantaneous clock must never reach the engine.
      decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: NOW + 10 * 365 * DAY },
    });
    expect(clean.instrument).toBe("EUR/USD");
    expect(clean.decisionClock).toBeUndefined();
  });
});

describe("§3/§5 Gate 0 behaviour per mode", () => {
  it("LIVE accepts a fresh snapshot", () => {
    const result = runAnalysis(inputWith({ priceTimestamp: NOW }));
    expect(reasonsOf(result)).not.toContain("older than");
    expect(reasonsOf(result)).not.toContain("implausibly in the future");
  });

  it("LIVE still rejects a stale snapshot", () => {
    const result = runAnalysis(inputWith({ priceTimestamp: NOW - 2 * DAY }));
    expect(reasonsOf(result)).toContain("older than 30 minutes");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("LIVE still rejects an implausibly future or invalid snapshot", () => {
    const future = runAnalysis(inputWith({ priceTimestamp: NOW + 10 * 60_000 }));
    expect(reasonsOf(future)).toContain("implausibly in the future");
    const invalid = runAnalysis(inputWith({ priceTimestamp: Number.NaN }));
    expect(reasonsOf(invalid)).toContain("invalid or implausibly in the future");
  });

  it("HISTORICAL_AS_OF accepts a weeks-old candle that was current at its own instant", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    expect(NOW - instant).toBeGreaterThan(15 * DAY); // genuinely old relative to today
    const result = runAnalysis(inputWith({ clock: historicalAsOfClock(instant) }));
    expect(reasonsOf(result)).not.toContain("older than");
    expect(reasonsOf(result)).not.toContain("implausibly in the future");
    // The analysis records itself as made at the historical instant.
    expect(result.timestamp).toBe(instant);
  });

  it("HISTORICAL_AS_OF still measures age — against its own instant", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    // The as-of instant is two days AFTER the candle: the snapshot is old, not future.
    const stale = runAnalysis(inputWith({ clock: historicalAsOfClock(instant + 2 * DAY) }));
    expect(reasonsOf(stale)).toContain("older than 30 minutes");
  });

  it("HISTORICAL_AS_OF refuses an input dated after the as-of instant", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    // 10 minutes after the as-of instant — outside the documented 90 s skew tolerance.
    const result = runAnalysis(inputWith({ clock: historicalAsOfClock(instant - 10 * 60_000) }));
    expect(reasonsOf(result)).toContain("implausibly in the future");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("an unusable deterministic clock refuses the snapshot instead of analysing with today's time", () => {
    const result = runAnalysis(inputWith({ clock: historicalAsOfClock(Number.NaN) }));
    expect(reasonsOf(result)).toContain("invalid or implausibly in the future");
    expect(result.recommendation).toBe("NO_TRADE");
  });
});

describe("§10 causality — the current system date cannot decide a historical evaluation", () => {
  it("changes a LIVE decision when the wall clock jumps, and changes nothing in as-of mode", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    const liveInput = inputWith({ priceTimestamp: NOW });
    const asOfInput = inputWith({ clock: historicalAsOfClock(instant) });

    const liveBefore = runAnalysis(liveInput);
    const asOfBefore = runAnalysis(asOfInput);

    // Simulate "today" moving five years forward.
    vi.spyOn(Date, "now").mockReturnValue(NOW + 5 * 365 * DAY);

    const liveAfter = runAnalysis(liveInput);
    const asOfAfter = runAnalysis(asOfInput);

    // LIVE reads the wall clock: the same snapshot is now years stale.
    expect(reasonsOf(liveBefore)).not.toContain("older than");
    expect(reasonsOf(liveAfter)).toContain("older than");
    // Historical as-of mode is decided by its recorded instant — byte-identical.
    expect(decisive(asOfAfter)).toBe(decisive(asOfBefore));
    expect(asOfAfter.timestamp).toBe(instant);
  });

  it("gives the same decision for HISTORICAL_AS_OF and FIXED_TEST_CLOCK at the same instant", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    const asOf = runAnalysis(inputWith({ clock: historicalAsOfClock(instant) }));
    const fixed = runAnalysis(inputWith({ clock: fixedTestClock(instant) }));
    expect(decisive(fixed)).toBe(decisive(asOf));
    expect(fixed.timestamp).toBe(instant);
  });

  it("keeps LIVE behaviour identical whether or not the live clock is passed explicitly", () => {
    const implicit = runAnalysis(inputWith({ priceTimestamp: NOW }));
    const explicit = runAnalysis(inputWith({ priceTimestamp: NOW, clock: LIVE_DECISION_CLOCK }));
    expect(decisive(explicit)).toBe(decisive(implicit));
  });

  it("evaluates a months-old prefix historically while LIVE refuses it as stale (same candles)", () => {
    const candles = series();
    const instant = candles[candles.length - 1].timestamp;
    const live = runAnalysis(inputWith({ priceTimestamp: instant }));
    const historical = runAnalysis(inputWith({ clock: historicalAsOfClock(instant) }));

    expect(live.recommendation).toBe("NO_TRADE");
    expect(reasonsOf(live)).toContain("older than");
    // The historical read is not "live with a stale label": it is decided at its
    // own instant, and the structure/location evidence is still produced.
    expect(reasonsOf(historical)).not.toContain("older than");
    expect(historical.tradeLocation?.context.state).toBe(live.tradeLocation?.context.state);
    expect(historical.tradeLocation?.location).toBe(live.tradeLocation?.location);
  });
});

describe("§11 the clock does not change 291/292/293 semantics", () => {
  it("keeps bias, setup state, location and plan identical between modes when freshness is equal", () => {
    const fresh = runAnalysis(inputWith({ priceTimestamp: NOW }));
    const asOfAtSnapshot = runAnalysis(inputWith({ clock: historicalAsOfClock(NOW) }));
    expect(JSON.stringify(asOfAtSnapshot.tradeLocation)).toBe(JSON.stringify(fresh.tradeLocation));
    expect(JSON.stringify(asOfAtSnapshot.tradePlan ?? null)).toBe(JSON.stringify(fresh.tradePlan ?? null));
    expect(asOfAtSnapshot.bias).toBe(fresh.bias);
    expect(asOfAtSnapshot.confidence).toBe(fresh.confidence);
    // The only intended difference is the recorded clock reading.
    expect(asOfAtSnapshot.timestamp).toBe(NOW);
    expect(fresh.timestamp).not.toBe(NOW - 1); // live timestamp is the wall clock
  });

  it("records no trade decision without inventing a plan in either mode", () => {
    for (const clock of [undefined, historicalAsOfClock(SERIES_END)]) {
      const result = runAnalysis(inputWith({ clock }));
      if (result.recommendation === "NO_TRADE") {
        expect(result.tradePlan).toBeUndefined();
        expect(result.positionSizing).toBeUndefined();
      } else {
        expect(result.tradePlan).toBeDefined();
      }
    }
  });
});
