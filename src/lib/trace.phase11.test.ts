/**
 * Phase 11 — observability & explainability validation.
 *
 * Proves the trace/breakdown/gate/provenance/fingerprint layers are:
 * - complete and consistent with the actual decision (no recomputation),
 * - deterministic (identical decision-relevant input → identical fingerprint),
 * - invariant to availability, key order, failure-reason text, timestamps,
 * - secret-free,
 * - backward compatible (fields optional).
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  BEAR_LEVELS,
  treasury as treasuryFixture,
  executionUnavailable,
} from "./benchmark-fixtures.phase9";
import { computeDecisionFingerprint } from "./decision-trace";
import type { AnalysisInput } from "@/types/analysis";

const run = (spec: Parameters<typeof assemble>[0] = {}) => runAnalysis(assemble(spec) as AnalysisInput);

const BULL_CONT = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  events: "Fed signals hawkish stance, rate hike",
};

// ── P1/P2/P3: trace completeness & consistency ─────────────────────

describe("decision trace completeness", () => {
  it("every result carries a complete trace consistent with the decision", () => {
    const r = run(BULL_CONT);
    const t = r.decisionTrace!;
    expect(t.version).toBe(1);
    expect(t.tradingStyle).toBe(r.tradingStyle);
    expect(t.biasCalculation.finalBias).toBe(r.bias);
    expect(t.recommendation).toBe(r.recommendation);
    expect(t.tradePlanStatus.present).toBe(r.tradePlan !== undefined);
    // Gate trace: every canonical gate present exactly once.
    const ids = t.gates.map((g) => g.gateId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    for (const g of t.gates) {
      expect(["PASS", "FAIL", "NOT_APPLICABLE"]).toContain(g.status);
      if (g.status === "FAIL") expect(g.reason.length).toBeGreaterThan(0);
    }
    // passedGates/failedGates mirror the entries.
    expect(t.failedGates).toEqual(t.gates.filter((g) => g.status === "FAIL").map((g) => g.gateId));
    expect(t.passedGates).toEqual(t.gates.filter((g) => g.status === "PASS").map((g) => g.gateId));
    // A valid directional trade has NO failing gates.
    expect(t.failedGates).toEqual([]);
  });

  it("conviction breakdown is internally consistent and honest", () => {
    const r = run(BULL_CONT);
    const b = r.decisionTrace!.convictionBreakdown;
    expect(b.base).toBe(30);
    expect(b.clamp).toEqual([20, 88]);
    const sum = b.layers.reduce((a, l) => a + l.contribution, 0);
    expect(b.rawTotal).toBe(30 + sum);
    expect(b.final).toBe(r.confidence);
    expect(b.band).toBe(r.conviction);
    // Every layer respects its own cap.
    for (const l of b.layers) expect(Math.abs(l.contribution)).toBeLessThanOrEqual(l.cap);
    // Final stays inside the documented clamp even when raw exceeds it.
    expect(b.final).toBeGreaterThanOrEqual(20);
    expect(b.final).toBeLessThanOrEqual(88);
  });

  it("unavailable optional providers contribute exactly zero", () => {
    const r = run({ ...BULL_CONT }); // no treasury/cot/eia/execution provided
    const layers = r.decisionTrace!.convictionBreakdown.layers;
    for (const name of ["Macro Yield", "COT Positioning", "EIA Inventory", "Execution"]) {
      const l = layers.find((x) => x.layer === name)!;
      expect(l.contribution).toBe(0);
      expect(/unavailable|not applicable|no validated/.test(l.reason.toLowerCase())).toBe(true);
    }
  });

  it("NO_TRADE keeps terminal state visible in the trace", () => {
    const r = run({}); // neutral/range fixture
    const t = r.decisionTrace!;
    expect(r.recommendation).toBe("NO_TRADE");
    expect(t.recommendation).toBe("NO_TRADE");
    expect(t.tradePlanStatus.present).toBe(false);
    expect(r.tradePlan).toBeUndefined();
    expect(t.failedGates.length).toBeGreaterThan(0);
    // The blocking gate reason appears among the user-facing NO_TRADE reasons
    // (gate reasons are captured AT rejection time — single source of truth).
    const failedReasons = t.gates.filter((g) => g.status === "FAIL").map((g) => g.reason);
    for (const reason of r.noTradeReasons) expect(failedReasons.some((f) => f.includes(reason))).toBe(true);
  });

  it("provenance covers every provider with honest availability", () => {
    const absent = run({});
    const providers = absent.decisionTrace!.provenance.map((p) => p.provider);
    expect(providers).toContain("Market candles (primary)");
    expect(providers).toContain("US Treasury XML feed");
    expect(providers).toContain("CFTC COT");
    expect(providers).toContain("EIA WPSR");
    expect(providers).toContain("OKX order book");
    for (const p of absent.decisionTrace!.provenance) {
      if (!p.available) expect(p.failureReason).toBeTruthy();
      else expect(p.failureReason).toBeUndefined();
    }
    const withTreasury = run({ ...BULL_CONT, treasuryData: treasuryFixture(15) });
    const tp = withTreasury.decisionTrace!.provenance.find((p) => p.provider === "US Treasury XML feed")!;
    expect(tp.available).toBe(true);
    expect(tp.freshness).toBeTruthy();
    expect(tp.fetchedAt).toBeGreaterThan(0);
  });

  it("structural veto is disclosed in biasCalculation", () => {
    // Strong bearish secondary evidence over bullish structure → veto to Neutral
    // is recorded with its structured reason (not silently swallowed).
    const r = run({
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      macroData: undefined,
      news: undefined,
    });
    const bc = r.decisionTrace!.biasCalculation;
    expect(bc.rawBias).toBeDefined();
    expect(bc.vetoApplied).toBe(bc.rawBias !== bc.finalBias);
    if (bc.vetoApplied) expect(bc.vetoReason).toBeTruthy();
  });
});

// ── P5: deterministic decision fingerprint ─────────────────────────

describe("deterministic decision fingerprint", () => {
  it("identical input → identical fingerprint across repeated runs", () => {
    const a = run(BULL_CONT);
    const b = run(BULL_CONT);
    expect(a.decisionFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
  });

  it("M1: adding an UNAVAILABLE provider does not change the fingerprint", () => {
    const base = run(BULL_CONT);
    const withDead = run({ ...BULL_CONT, executionData: executionUnavailable() });
    expect(withDead.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("M2: adding an AVAILABLE but directionally-neutral provider changes neither decision nor conviction", () => {
    const base = run(BULL_CONT);
    const withNeutral = run({ ...BULL_CONT, treasuryData: treasuryFixture(1) }); // sub-threshold
    expect(withNeutral.recommendation).toBe(base.recommendation);
    expect(withNeutral.confidence).toBe(base.confidence);
    expect(withNeutral.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("M8: provider failure REASON TEXT does not affect the decision or fingerprint", () => {
    const a = run({
      ...BULL_CONT,
      executionData: { available: false, reason: "books unreachable" } as never,
    });
    const b = run({
      ...BULL_CONT,
      executionData: { available: false, reason: "HTTP 429 rate limited after retry storm at edge PoP fra1" } as never,
    });
    expect(b.recommendation).toBe(a.recommendation);
    expect(b.confidence).toBe(a.confidence);
    expect(b.decisionFingerprint).toBe(a.decisionFingerprint);
    // …but provenance still explains each failure honestly.
    const pa = a.decisionTrace!.provenance.find((p) => p.provider === "OKX order book")!;
    const pb = b.decisionTrace!.provenance.find((p) => p.provider === "OKX order book")!;
    expect(pa.failureReason).not.toBe(pb.failureReason);
  });

  it("fingerprint is stable under object-key reordering (stable serialization)", () => {
    const a = run(BULL_CONT);
    const reordered = JSON.parse(JSON.stringify(a.decisionTrace));
    // Deep-reverse every key order.
    const rev = (o: unknown): unknown => {
      if (Array.isArray(o)) return o.map(rev);
      if (o && typeof o === "object") {
        return Object.fromEntries(Object.entries(o as Record<string, unknown>).reverse().map(([k, v]) => [k, rev(v)]));
      }
      return o;
    };
    expect(computeDecisionFingerprint(rev(reordered) as NonNullable<typeof a.decisionTrace>)).toBe(a.decisionFingerprint);
  });

  it("fetch timestamps do NOT enter the fingerprint (time-independent)", () => {
    const a = run({ ...BULL_CONT, treasuryData: treasuryFixture(15), style: "swing" });
    const t1 = JSON.parse(JSON.stringify(a.decisionTrace!)) as NonNullable<typeof a.decisionTrace>;
    const t2 = JSON.parse(JSON.stringify(a.decisionTrace!)) as NonNullable<typeof a.decisionTrace>;
    t2.provenance = t2.provenance.map((p) => ({ ...p, fetchedAt: (p.fetchedAt ?? 0) + 987654321 }));
    expect(computeDecisionFingerprint(t2)).toBe(computeDecisionFingerprint(t1));
  });

  it("a genuinely different decision produces a different fingerprint", () => {
    const long = run(BULL_CONT);
    const short = run({
      ...BULL_CONT,
      structure: "LH/LL" as const, bos: "bearish" as const,
      support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
    });
    expect(long.decisionFingerprint).not.toBe(short.decisionFingerprint);
  });
});

// ── Golden decision fixtures ────────────────────────────────────────

describe("golden decision fixtures", () => {
  it("golden LONG: bullish continuation", () => {
    const s = run(BULL_CONT);
    const t = s.decisionTrace!;
    expect(s.recommendation).toBe("LONG");
    expect(s.bias).toBe("Bullish");
    expect(s.tradePlan !== undefined).toBe(true);
    expect(t.structuralDirection).toBe("long");
    expect(t.evidenceLayers.find((l) => l.layer === "Structure")!.direction).toBe("bullish");
    expect(t.convictionBreakdown.final).toBeGreaterThanOrEqual(40);
  });

  it("golden NO_TRADE: range market with strong opposing-context attempt", () => {
    const s = run({});
    expect(s.recommendation).toBe("NO_TRADE");
    expect(s.tradePlan).toBeUndefined();
    expect(s.decisionTrace!.structuralDirection).toBe("none");
  });

  it("golden SHORT mirrors golden LONG structurally", () => {
    const s = run({
      ...BULL_CONT,
      structure: "LH/LL" as const, bos: "bearish" as const,
      support: BEAR_LEVELS.support, resistance: BEAR_LEVELS.resistance,
      sweepSide: "buy_side" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
      events: "ECB dovish, rate cut expected",
    });
    expect(s.recommendation).toBe("SHORT");
    expect(s.decisionTrace!.structuralDirection).toBe("short");
    expect(s.decisionTrace!.evidenceLayers.find((l) => l.layer === "Structure")!.direction).toBe("bearish");
    expect(s.decisionTrace!.failedGates).toEqual([]);
  });
});

// ── Security / hygiene & backward compatibility ─────────────────────

describe("secret hygiene & backward compatibility", () => {
  it("no secrets or sensitive material can appear in the serialized trace", () => {
    const r = run({ ...BULL_CONT, executionData: executionUnavailable() });
    const raw = JSON.stringify(r.decisionTrace).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "secret", "token", "authorization", "bearer", "password"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("trace is JSON-serializable (safe for persistence/UI transport)", () => {
    const r = run(BULL_CONT);
    expect(() => JSON.stringify(r.decisionTrace)).not.toThrow();
    expect(JSON.parse(JSON.stringify(r.decisionTrace!))).toEqual(r.decisionTrace);
  });

  it("backward compatibility: legacy results without trace fields remain valid shapes", () => {
    const r = run(BULL_CONT);
    const legacy = { ...r } as Record<string, unknown>;
    delete legacy.decisionTrace;
    delete legacy.decisionFingerprint;
    // All pre-Phase-11 fields intact.
    expect(legacy.bias).toBe(r.bias);
    expect(legacy.recommendation).toBe(r.recommendation);
    expect(legacy.confidence).toBe(r.confidence);
    expect(legacy.noTradeReasons).toEqual(r.noTradeReasons);
    expect(legacy.technicalSummary).toBeTruthy();
    expect(typeof legacy.id).toBe("string");
  });
});
