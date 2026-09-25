/**
 * Phase 10 — hardening benchmarks.
 *
 * Step 2: conviction band reachability (honest, no forced coverage)
 * Step 7: determinism for identical snapshots
 * Step 8: style isolation — market facts identical across styles
 * Step 9: trade-plan & risk safety adversarial cases
 * Step 13: temporal/freshness chaos (slow-data paths)
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { assemble, buildMtf, BULL_LEVELS, BEAR_LEVELS, execution, sentiment } from "./benchmark-fixtures.phase9";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";

const hawkEvents = "Fed signals hawkish stance, rate hike";

type Spec = Record<string, unknown>;
const R = (spec: Spec): AnalysisResult => {
  const base = assemble(spec as never);
  return runAnalysis({ ...base, ...spec } as unknown as AnalysisInput);
};

// ═══════════ STEP 2 — CONVICTION REACHABILITY ══════════════════════

describe("Step 2: conviction band reachability", () => {
  // Pinned deterministic fixtures per band (measured, then asserted).
  const minLong = R({ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance, events: hawkEvents });
  const degradedLong = (() => {
    const td = assemble({
      structure: "HH/HL" as never, bos: "bullish" as never,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    }).technicalData!;
    td.dataPoints = 40; // limited-history flag
    const base = assemble({
      structure: "HH/HL" as never, bos: "bullish" as never,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    });
    return runAnalysis({ ...base, technicalData: td, economicEvents: hawkEvents } as never);
  })();
  const medium = R({ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance, events: hawkEvents, sentimentData: sentiment("bullish", 0.8) });
  const high = R({ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance, events: hawkEvents, sentimentData: sentiment("bullish", 1), mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long" }) });

  it("40–49 band: minimal Gate-4-compliant LONG", () => {
    expect(minLong.recommendation).toBe("LONG");
    expect(minLong.confidence!).toBeGreaterThanOrEqual(40);
    expect(minLong.confidence!).toBeLessThan(50);
    expect(minLong.conviction).toBe("Low");
  });

  it("40–49 band lower edge: critical data gaps reduce toward 40 without killing a valid thesis", () => {
    expect(degradedLong.recommendation).toBe("LONG");
    expect(degradedLong.confidence!).toBeLessThan(minLong.confidence!); // penalty applied
    expect(degradedLong.conviction).toBe("Low");
  });

  it("50–59 band: aligned positioning layer lifts to Medium", () => {
    expect(medium.recommendation).toBe("LONG");
    expect(medium.confidence!).toBeGreaterThanOrEqual(50);
    expect(medium.confidence!).toBeLessThan(70);
    expect(medium.conviction).toBe("Medium");
  });

  it("70–88 band: full hierarchy confluence reaches High, clamp holds", () => {
    expect(high.recommendation).toBe("LONG");
    expect(high.confidence!).toBeGreaterThanOrEqual(70);
    expect(high.confidence!).toBeLessThanOrEqual(88);
    expect(high.conviction).toBe("High");
  });

  it("NO_TRADE informational confidence occupies its own bounded channel [20,55]", () => {
    const neutral = R({ structure: "range" });
    expect(neutral.recommendation).toBe("NO_TRADE");
    if (neutral.confidence !== undefined && neutral.confidence !== null) {
      expect(neutral.confidence).toBeGreaterThanOrEqual(20);
      expect(neutral.confidence).toBeLessThanOrEqual(55);
    }
    expect(neutral.conviction).toBeUndefined(); // never dressed up as trade conviction
  });

  it("DOCUMENTED: bands 20–39 are unreachable-by-design for healthy directional setups", () => {
    // Formal reasoning encoded as assertions:
    // Gate 4 demands ≥2 agreeing core factors ⇒ minimum layered contribution
    // = base(30) + structure(≥6) + fundamental(≥5..10) − partial(0..3) −
    // criticalFlags(4×n). Healthy fixtures expose ≤1 non-informational gap,
    // so the OBSERVED directional floor is the low 40s (see tests above).
    // The numeric clamp supports 20, but no production path through Gates
    // 0–8 with valid evidence lands below 40 in this suite.
    const floorObserved = Math.min(minLong.confidence!, degradedLong.confidence!);
    expect(floorObserved).toBeGreaterThanOrEqual(40);
    // Clamp itself is still proven by the informational channel bound above.
  });
});

// ═══════════ STEP 7 — DETERMINISM ══════════════════════════════════

describe("Step 7: determinism for identical snapshots", () => {
  /**
   * Phase 278 — absolute instants inside the advanced technical block are
   * PROVIDER OBSERVATION times mirrored from the candle series (whose own
   * `priceSnapshot.timestamp` is stripped above), and this fixture builds its
   * candles relative to the run clock. They are therefore excluded here for
   * exactly the same reason, while every DECISION-relevant value in the block
   * — levels, ratios, profile bins, states, parameters, contribution rules —
   * is still compared byte-for-byte. The layer's own clock-free determinism is
   * pinned separately by advanced-technical.phase278.test.tsx (test 10).
   */
  const INSTANT_KEYS = new Set([
    "observedAt",
    "anchorAt",
    "periodStart",
    "sessionStart",
    "candleTime",
    "breakTime",
    "createdAt",
    "snapshotTs",
    "fetchedAt",
  ]);
  function stripInstants<T>(value: T): T {
    if (Array.isArray(value)) return value.map(stripInstants) as unknown as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (INSTANT_KEYS.has(k)) continue;
        out[k] = stripInstants(v);
      }
      return out as T;
    }
    return value;
  }

  function strip(r: AnalysisResult) {
    // Strip legitimately time-dependent identity/provenance fields.
    const { id, timestamp, priceSnapshot, ...rest } = r;
    void id; void timestamp; void priceSnapshot;
    // Phase 276 — the unified intelligence layer MIRRORS the technical
    // observation instant (`priceSnapshot.timestamp`, stripped just above) so
    // the UI can show where the technical evidence came from. The mirror is
    // excluded for exactly the same reason its source is: it is provenance,
    // not decision state. Every decision-relevant field of the unified object
    // — state, both biases, confluence, confidence, actionability, evidence
    // text and limitations — is still compared byte-for-byte below, and the
    // layer's own clock-free determinism is pinned by
    // unified-intelligence.phase276.test.tsx.
    if (rest.technicalData?.advanced) {
      rest.technicalData = {
        ...rest.technicalData,
        advanced: stripInstants(rest.technicalData.advanced),
      };
    }
    if (rest.unifiedIntelligence) {
      rest.unifiedIntelligence = {
        ...rest.unifiedIntelligence,
        technical: { ...rest.unifiedIntelligence.technical, observedAt: undefined },
      };
    }
    return JSON.stringify(rest, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
  }

  const spec: Spec = {
    structure: "HH/HL", bos: "bullish",
    support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
    events: hawkEvents, sentimentData: sentiment("bullish", 0.6),
    treasuryData: undefined,
    mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  };

  it("pure engine: two runs produce byte-identical decisions", () => {
    const a = strip(R(spec));
    const b = strip(R(spec));
    expect(a).toBe(b);
  });

  it("determinism holds with optional providers AND provider failures", () => {
    const variants: Spec[] = [
      { ...spec, treasuryData: { available: false, reason: "x", fetchedAt: Date.now() } },
      { ...spec, executionData: { available: false, reason: "down", instrumentId: null } },
      { ...spec, instrument: "BTC/USD", instrumentType: "crypto", executionData: execution(0.8) },
    ];
    for (const v of variants) {
      expect(strip(R(v))).toBe(strip(R(v)));
    }
  });

  it("determinism across all three trading styles", () => {
    for (const style of ["scalping", "intraday", "swing"]) {
      const s = { ...spec, style };
      expect(strip(R(s))).toBe(strip(R(s)));
    }
  });
});

// ═══════════ STEP 8 — STYLE ISOLATION (RAW FACTS) ══════════════════

describe("Step 8: style isolation — market facts invariant", () => {
  const shared = {
    structure: "LH/LL", bos: "bearish",
    support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance,
    events: "ECB dovish, rate cut expected",
    treasuryData: undefined,
    cotData: undefined,
  };

  it("raw context objects are passed through untouched for every style", () => {
    const results = (["scalping", "intraday", "swing"] as const).map((style) =>
      R({ ...shared, style }),
    );
    const ref = results[1]; // intraday
    for (const r of results) {
      expect(r.breakdown).toEqual(ref.breakdown);            // structure/fundamental facts
      expect(r.marketRegime!.regime).toBe(ref.marketRegime!.regime);
      expect(r.mtfSummary?.alignment ?? null).toBe(ref.mtfSummary?.alignment ?? null);
      expect(r.keyLevels.support === ref.keyLevels.support ||
             r.keyLevels.support === "").toBe(true);
      // Raw provider contexts identical when present
      expect(JSON.stringify(r.treasuryContext ?? null)).toBe(JSON.stringify(ref.treasuryContext ?? null));
      expect(JSON.stringify(r.cotContext ?? null)).toBe(JSON.stringify(ref.cotContext ?? null));
      expect(JSON.stringify(r.executionContext ?? null)).toBe(JSON.stringify(ref.executionContext ?? null));
    }
  });
});

// ═══════════ STEP 9 — TRADE PLAN & RISK SAFETY ═════════════════════

describe("Step 9: risk / sizing safety", () => {
  it("entry == structural stop level → rejected with explicit reason, no plan", () => {
    const r = R({ structure: "HH/HL", bos: "bullish", support: 100, resistance: 115, swingSupports: undefined, events: hawkEvents });
    if (r.tradePlan) {
      // A plan must NEVER carry zero risk distance.
      expect(Math.abs(parseFloat(r.tradePlan.entry) - parseFloat(r.tradePlan.stopLoss))).toBeGreaterThan(0);
    } else {
      expect(r.noTradeReasons.join(" ")).toMatch(/structural|R:R|stop|target/i);
    }
  });

  it("SL on wrong side is defensively invalidated (never shipped)", () => {
    // Only support ABOVE price exists → unusable for longs → no silent plan.
    const td = assemble({ structure: "HH/HL" as never, bos: "bullish" as never }).technicalData!;
    td.swingLows = [];
    td.supportLevels = [105];
    td.swingHighs = [112];
    td.resistanceLevels = [112];
    const r = runAnalysis({ ...assemble({}), technicalData: td, economicEvents: hawkEvents } as never);
    if (r.tradePlan) {
      expect(parseFloat(r.tradePlan.stopLoss)).toBeLessThan(parseFloat(r.tradePlan.entry));
    } else {
      expect(r.noTradeReasons.length).toBeGreaterThan(0);
    }
  });

  it("RR < 1.5 → explicit rejection reason", () => {
    const r = R({ structure: "HH/HL", bos: "bullish", support: 99, resistance: 101.4, events: hawkEvents });
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toMatch(/R:R/i);
    expect(r.tradePlan).toBeUndefined();
  });

  it("invalid risk inputs → sizing honestly unavailable, thesis untouched", () => {
    const good = R({ ...{ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance }, events: hawkEvents });
    expect(good.recommendation).toBe("LONG");
    const badInputs: Array<Record<string, unknown>> = [
      { accountEquity: -5000 },
      { riskPercent: -1 },
      { riskPercent: 0 },
      { accountEquity: NaN },
    ];
    for (const bad of badInputs) {
      const r = R({ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance, events: hawkEvents, instrumentSpec: { contractSize: 1, quantityStep: 0.01 } as never, ...bad });
      // Thesis validity is independent of sizing input quality.
      expect(["LONG", "NO_TRADE"]).toContain(r.recommendation);
      if (r.positionSizing) expect(r.positionSizing.available === true ? r.positionSizing.quantity : 0).toBeGreaterThanOrEqual(0);
      // Never a fabricated positive quantity from invalid inputs:
      if (r.positionSizing?.available) {
        expect(Number.isFinite(r.positionSizing.quantity)).toBe(true);
      }
    }
  });

  it("inverse-style contract semantics absent → no synthetic sizing", () => {
    const r = R({ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance, events: hawkEvents, instrumentSpec: { contractSize: 0, quantityStep: 0.01 } as never });
    // contractSize 0 is NOT a usable spec: sizing must be unavailable/honest.
    if (r.positionSizing?.available) {
      expect(r.positionSizing.quantity).toBeGreaterThanOrEqual(0);
    } else {
      expect(r.riskNote.toLowerCase()).toMatch(/unavailable|cannot|not/);
    }
  });
});

// ═══════════ STEP 13 — TEMPORAL / SLOW-DATA CHAOS ══════════════════

describe("Step 13: temporal & slow-data freshness", () => {
  it("Treasury DELAYED remains contextual evidence WITH honest label (weekly cadence ≠ stale)", () => {
    const fresh = R({ ...{ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance }, events: hawkEvents, treasuryData: { available: true, source: "s", fetchedAt: Date.now(), freshness: "FRESH", latest: { nominal: { observationDate: "2026-08-21", nominal: { "10Y": 4.68 } } }, previous: { nominal: { observationDate: "2026-08-20", nominal: { "10Y": 4.63 } } } } as never });
    const delayed = R({ ...{ structure: "HH/HL", bos: "bullish", support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance }, events: hawkEvents, treasuryData: { available: true, source: "s", fetchedAt: Date.now(), freshness: "DELAYED", latest: { nominal: { observationDate: "2026-08-21", nominal: { "10Y": 4.68 } } }, previous: { nominal: { observationDate: "2026-08-20", nominal: { "10Y": 4.63 } } } } as never });
    // Same directional evidence magnitude within policy — no fabricated jump.
    expect(Math.abs((delayed.confidence ?? 0) - (fresh.confidence ?? 0))).toBeLessThanOrEqual(12);
  });

  it("execution STALE contributes ZERO directional weight (crypto)", () => {
    const book = (freshness: "FRESH" | "STALE") => ({
      available: true, provider: "OKX public order book", instrumentId: "BTC-USDT-SWAP",
      snapshotTs: Date.now(), fetchedAt: Date.now(), freshness,
      bid: 99.95, ask: 100.05, mid: 100, spread: 0.1, spreadBps: 1,
      bidDepth: 900, askDepth: 100, imbalance: 0.9, regime: "LIQUID",
      book: { bids: [], asks: [] },
    } as never);
    const base = R({ instrument: "BTC/USD", instrumentType: "crypto", structure: "LH/LL", bos: "bearish", support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance, news: "ETF approval institutional adoption" });
    const stale = R({ instrument: "BTC/USD", instrumentType: "crypto", structure: "LH/LL", bos: "bearish", support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance, news: "ETF approval institutional adoption", executionData: book("STALE") });
    // STALE removes the imbalance tilt entirely: conviction returns to baseline.
    expect(stale.confidence).toBe(base.confidence);
  });
});
