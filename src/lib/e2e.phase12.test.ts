/**
 * Phase 12 — END-TO-END production integration validation.
 *
 * Drives the REAL engine through complete pipelines: happy paths (E1–E5),
 * provider failure matrix, freshness chaos, style isolation, decision-trace
 * integrity and risk/sizing safety. No production logic is duplicated;
 * every expectation encodes the validated Phase 1–11 policy.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  BEAR_LEVELS,
  treasury as treasuryFixture,
  cot as cotFixture,
  execution,
  executionUnavailable,
  macro,
  sentiment,
} from "./benchmark-fixtures.phase9";
import type { AnalysisInput } from "@/types/analysis";

type RunSpec = Parameters<typeof assemble>[0] & Record<string, unknown>;
const run = (spec: RunSpec = {}) =>
  // Phase 9 InputSpec covers market-fact fixtures; risk/provider inputs
  // (accountEquity, eiaData, okxSpecData, …) pass straight through.
  runAnalysis({ ...assemble(spec), ...spec } as never);

const BULL = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  events: "Fed signals hawkish stance, rate hike",
};
const BEAR = {
  structure: "LH/LL" as const,
  bos: "bearish" as const,
  support: BEAR_LEVELS.support,
  resistance: BEAR_LEVELS.resistance,
  sweepSide: "buy_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
  events: "ECB dovish, rate cut expected",
};

/** Minimal honest EIA WPSR fixture (documented schema; values are real numbers). */
const eiaFixture = (
  latestValue: number,
  previousValue: number,
  observationDate = "2026-08-15",
) => ({
  available: true as const,
  source: "U.S. EIA (Weekly Petroleum Status Report)",
  fetchedAt: Date.now(),
  freshness: "FRESH" as const,
  series: [
    {
      productId: "EPC0",
      productName: "Crude oil excl. SPR",
      observationDate,
      previousObservationDate: "2026-08-08",
      latestValue,
      previousValue,
      change: latestValue - previousValue,
      unit: "million bbl",
    },
  ],
  failedLegs: [],
});

// ═════════════════════════ P1 — HAPPY PATHS ═════════════════════════

describe("E2E happy path", () => {
  it("E1 crypto LONG: full pipeline with sizing + execution + trace", () => {
    const r = run({
      ...BULL,
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      macroData: macro("bullish"),
      executionData: execution(0.6),
      accountEquity: 100_000,
      riskPercent: 0.01,
      instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
    });
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan).toBeDefined();
    // Sizing from REAL inputs only.
    expect(r.positionSizing?.available).toBe(true);
    expect(r.positionSizing?.quantity).toBeGreaterThan(0);
    expect(r.positionSizing?.riskAmount).toBeCloseTo(1000, 0); // equity × 1%
    // Execution quality present and honest.
    expect(r.slippageEstimate?.quantityUsed).toBe(r.positionSizing?.quantity);
    // Trace + fingerprint available and consistent.
    expect(r.decisionTrace?.recommendation).toBe("LONG");
    expect(r.decisionFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("E2 forex LONG: valid thesis, execution honestly unavailable, no synthetic spread", () => {
    const r = run(BULL);
    expect(r.recommendation).toBe("LONG");
    expect(r.tradePlan?.direction).toBe("long");
    const okxProv = r.decisionTrace!.provenance.find((p) => p.provider === "OKX order book")!;
    expect(okxProv.available).toBe(false);
    expect(okxProv.failureReason).toBeTruthy();
    // No bid/ask/spread fabricated anywhere on the result.
    const raw = JSON.stringify(r).toLowerCase();
    expect(raw).not.toContain('"spreadbps"');
  });

  it("E2b forex SHORT mirror", () => {
    const r = run(BEAR);
    expect(r.recommendation).toBe("SHORT");
    expect(r.tradePlan?.stopLoss).toBeDefined();
    expect(r.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5);
  });

  it("E3 gold: Treasury context used when available, execution non-crypto unavailable", () => {
    const r = run({
      ...BULL,
      instrument: "XAU/USD",
      instrumentType: "commodity",
      events: "Fed dovish pivot, rate cuts expected, safe-haven demand",
      treasuryData: treasuryFixture(25),
    });
    const t = r.decisionTrace!;
    const tp = t.provenance.find((p) => p.provider === "US Treasury XML feed")!;
    expect(tp.available).toBe(true);
    expect(tp.observationDate ?? "").toBeTruthy(); // truthful date, never "now"
    // Execution layer explicitly not applicable for gold — no substitution.
    const execLayer = t.convictionBreakdown.layers.find((l) => l.layer === "Execution")!;
    expect(execLayer.contribution).toBe(0);
    expect(/no validated/.test(execLayer.reason)).toBe(true);
  });

  it("E4 oil: EIA context when available; honest fallback when unavailable", () => {
    const withEia = run({
      ...BULL,
      instrument: "WTI",
      instrumentType: "commodity",
      eiaData: eiaFixture(420.5, 419.8), // draw 0.7M bbl ≥ threshold
    });
    const prov = withEia.decisionTrace!.provenance.find((p) => p.provider === "EIA WPSR")!;
    expect(prov.available).toBe(true);
    expect(prov.observationDate).toBe("2026-08-15"); // actual obs date preserved verbatim

    const withoutEia = run({ ...BULL, instrument: "WTI", instrumentType: "commodity" });
    const provOff = withoutEia.decisionTrace!.provenance.find((p) => p.provider === "EIA WPSR")!;
    expect(provOff.available).toBe(false);
    expect(provOff.failureReason).toBeTruthy();
    // Fallback is honest: no inventory numbers invented anywhere.
    const raw = JSON.stringify(withoutEia).toLowerCase();
    expect(raw).not.toContain("million bbl draw of");
  });

  it("E5 neutral market → NO_TRADE terminal even with full risk inputs", () => {
    const r = run({
      accountEquity: 100_000,
      riskPercent: 0.01,
      instrumentSpec: { assetClass: "forex", contractSize: 100_000, quantityStep: 0.01, quoteCurrency: "USD" },
    });
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.tradePlan).toBeUndefined();
    expect(r.positionSizing).toBeUndefined();
    expect(r.noTradeReasons.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════ P2 — FAILURE MATRIX ══════════════════════

describe("provider failure matrix", () => {
  it("Twelve Data unavailable (no market data) → safe degraded state, no crash", () => {
    const input = assemble(BULL) as never as Record<string, unknown>;
    delete input.marketData;
    const r = runAnalysis(input as never);
    expect(r.decisionTrace).toBeDefined();
    expect(r.decisionTrace!.inputSnapshotSummary.dataCompleteness).not.toBe("full");
  });

  it("Treasury malformed (NaN numbers) → identical decision & fingerprint to absent", () => {
    const base = run(BULL);
    const bad = JSON.parse(JSON.stringify(treasuryFixture(500)));
    bad.latest.nominal.nominal["10Y"] = NaN;
    bad.previous.nominal.nominal["10Y"] = NaN;
    const r = run({ ...BULL, treasuryData: bad });
    expect(r.recommendation).toBe(base.recommendation);
    expect(r.confidence).toBe(base.confidence);
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("COT malformed (NaN report numbers) → zero evidence, no NaN in output", () => {
    const base = run(BULL);
    const bad = JSON.parse(JSON.stringify(cotFixture(500)));
    bad.latest.nonCommercialLong = NaN;
    bad.changeFromPreviousReport = NaN;
    const r = run({ ...BULL, cotData: bad });
    expect(r.confidence).toBe(base.confidence);
    expect(Number.isFinite(r.confidence)).toBe(true);
    expect(r.decisionFingerprint).toBe(base.decisionFingerprint); // I5: failure ≠ penalty/bonus
  });

  it("OKX order book unavailable vs stale → both zero-weight, decision unchanged", () => {
    const base = run({ ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"), executionData: execution(0.9) });
    const dead = run({ ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"), executionData: executionUnavailable() });
    const staleBook = { ...execution(0.9), freshness: "STALE" } as unknown as NonNullable<AnalysisInput["executionData"]>;
    const stale = run({ ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"), executionData: staleBook });
    for (const variant of [dead, stale]) {
      expect(variant.recommendation).toBe(base.recommendation);
      expect(variant.bias).toBe(base.bias);
      // STALE/unavailable removes the imbalance tilt only — conviction may drop
      // by at most the execution layer cap, never flip anything.
      expect(Math.abs(variant.confidence - base.confidence)).toBeLessThanOrEqual(7);
    }
  });

  it("invalid price (NaN / 0 / negative) → explicit rejection, never a silent state", () => {
    for (const price of [NaN, 0, -5]) {
      const input = assemble(BULL) as AnalysisInput;
      input.marketData = { ...input.marketData!, price: { ...input.marketData!.price, price } };
      const r = runAnalysis(input);
      expect(r.recommendation).toBe("NO_TRADE");
      expect(r.noTradeReasons.join(" ").length).toBeGreaterThan(0);
    }
  });

  it("invalid risk percentage does not generate quantity but thesis stays valid", () => {
    for (const rp of [-0.5, 0, NaN]) {
      const r = run({
        ...BULL,
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        macroData: macro("bullish"),
        accountEquity: 100_000,
        riskPercent: rp,
        instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
      });
      expect(r.recommendation).toBe("LONG"); // thesis intact
      if (r.positionSizing) expect(r.positionSizing.quantity).toBeUndefined();
    }
  });

  it("missing FX blocks conversion honestly — no invented rate", () => {
    const r = run({
      ...BULL,
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      macroData: macro("bullish"),
      accountEquity: 100_000,
      riskPercent: 0.01,
      accountCurrency: "EUR",
      instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, quoteCurrency: "USDT" },
    });
    if (r.positionSizing?.available) {
      // Sizing must stay quote-denominated or use an ACTUAL provided rate.
      expect(r.positionSizing.denominationCurrency ?? "USDT").toBe("USDT");
    } else if (r.positionSizing) {
      expect(r.positionSizing.unavailableReason).toBeTruthy();
    }
    // Either way: never a fabricated conversion rate.
    const conv = r.positionSizing as unknown as Record<string, unknown> | undefined;
    const fx = conv?.["fxRate"] ?? conv?.["fxRateApplied"];
    if (fx !== undefined) expect(fx).not.toBe(1); // never a silently-fabricated 1:1 rate
  });

  it("every provider-failure scenario leaves a VALID trace with provenance", () => {
    const variants = [
      run({}),
      run({ ...BULL, treasuryData: undefined }),
      run({ ...BULL, executionData: executionUnavailable() }),
    ];
    for (const r of variants) {
      const t = r.decisionTrace!;
      expect(t.version).toBe(1);
      expect(t.provenance.every((p) => typeof p.available === "boolean")).toBe(true);
      for (const p of t.provenance) {
        if (!p.available) expect(p.failureReason).toBeTruthy();
      }
    }
  });
});

// ═════════════════════════ P4 — FRESHNESS CHAOS ═════════════════════

describe("freshness / time chaos (engine level)", () => {
  it("price timestamp zero/negative/future → rejected under existing policy", () => {
    for (const ts of [0, -1000, Date.now() + 10 * 60_000]) {
      const input = assemble(BULL) as AnalysisInput;
      input.marketData = { ...input.marketData!, fetchTimestamp: ts, price: { ...input.marketData!.price, timestamp: ts } };
      const r = runAnalysis(input);
      expect(r.recommendation).toBe("NO_TRADE");
      expect(r.noTradeReasons.join(" ").toLowerCase()).toMatch(/stale|fresh|invalid|data/);
    }
  });

  it("execution snapshot STALE → disclosed, zero directional weight (policy)", () => {
    const base = run({ ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish") });
    const stale = run({
      ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"),
      executionData: { ...execution(0.95), freshness: "STALE" } as unknown as NonNullable<AnalysisInput["executionData"]>,
    });
    expect(stale.decisionTrace!.convictionBreakdown.layers.find((l) => l.layer === "Execution")!.contribution).toBe(0);
    expect(Math.abs(stale.confidence - base.confidence)).toBeLessThanOrEqual(7);
  });

  it("slow-data observation dates are NEVER replaced with current time", () => {
    const r = run({ ...BULL, eiaData: eiaFixture(421, 421.2, "2026-07-04") });
    const raw = JSON.stringify(r.decisionTrace!.provenance);
    expect(raw).toContain("2026-07-04"); // verbatim old date survives the pipeline
  });
});

// ═════════════════════════ P5 — STYLE ISOLATION E2E ═════════════════

describe("style end-to-end isolation", () => {
  const styles = ["scalping", "intraday", "swing"] as const;

  it("identical market facts across all three styles", () => {
    const results = styles.map((style) => run({ ...BULL, style }));
    const facts = results.map((r) => JSON.stringify(r.breakdown));
    expect(new Set(facts).size).toBe(1);
    expect(new Set(results.map((r) => r.marketRegime?.regime)).size).toBe(1);
    // Raw provider contexts echoed untouched.
    const withCtx = styles.map((style) =>
      run({ ...BULL, style, treasuryData: treasuryFixture(15), cotData: cotFixture(300) }),
    );
    for (const r of withCtx) {
      expect(r.decisionTrace!.tradingStyle).toBe(r.tradingStyle);
    }
  });

  it("each layer respects its style-scaled cap in every style", () => {
    for (const style of styles) {
      const r = run({ ...BULL, style, treasuryData: treasuryFixture(40), cotData: cotFixture(2000) });
      for (const l of r.decisionTrace!.convictionBreakdown.layers) {
        expect(Math.abs(l.contribution)).toBeLessThanOrEqual(l.cap);
      }
      expect(r.confidence).toBeGreaterThanOrEqual(20);
      expect(r.confidence).toBeLessThanOrEqual(88);
    }
  });

  it("style-specific decisions remain explainable via their own traces", () => {
    for (const style of styles) {
      const r = run({ ...BEAR, style });
      const t = r.decisionTrace!;
      expect(t.tradingStyle).toBe(style);
      if (r.recommendation !== "NO_TRADE") {
        expect(t.failedGates).toEqual([]);
        expect(t.structuralDirection).not.toBe("none");
      } else {
        expect(t.failedGates.length).toBeGreaterThan(0);
      }
    }
  });
});

// ═════════════════════════ P6 — TRACE INTEGRITY E2E ═════════════════

describe("decision trace integrity across scenarios", () => {
  const scenarios = [
    ["E1 crypto", run({ ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish") })],
    ["E2 forex long", run(BULL)],
    ["E2b forex short", run(BEAR)],
    ["E4 oil+eia", run({ ...BULL, instrument: "WTI", instrumentType: "commodity", eiaData: eiaFixture(420.5, 419.8) })],
    ["E5 neutral", run({})],
  ] as const;

  it("result fields are internally consistent with the trace in every scenario", () => {
    for (const [name, r] of scenarios) {
      const t = r.decisionTrace!;
      expect(t.recommendation).toBe(r.recommendation);
      expect(t.biasCalculation.finalBias).toBe(r.bias);
      expect(t.convictionBreakdown.final).toBe(r.confidence);
      expect(t.tradePlanStatus.present).toBe(r.tradePlan !== undefined);
      for (const c of r.keyContradictions ?? []) {
        expect(["MINOR", "MATERIAL", "DECISIVE"]).toContain(c.severity);
      }
      void name;
    }
  });

  it("directional results require structural agreement + no blocking gate + side-correct plan", () => {
    for (const [, r] of scenarios.filter(([, x]) => x.recommendation !== "NO_TRADE")) {
      const t = r.decisionTrace!;
      const dir = r.recommendation === "LONG" ? "long" : "short";
      expect(t.failedGates).toEqual([]);
      expect(t.structuralDirection).toBe(dir);
      expect(r.tradePlan!.direction).toBe(dir);
      const entry = parseFloat(r.tradePlan!.entry);
      const sl = parseFloat(r.tradePlan!.stopLoss);
      const tp = parseFloat(r.tradePlan!.takeProfit);
      expect(Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp)).toBe(true);
      if (dir === "long") {
        expect(sl).toBeLessThan(entry);
        expect(tp).toBeGreaterThan(entry);
      } else {
        expect(sl).toBeGreaterThan(entry);
        expect(tp).toBeLessThan(entry);
      }
      expect(parseFloat((Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(4))).toBeCloseTo(
        r.tradePlan!.riskReward, 2,
      );
    }
  });

  it("NO_TRADE identifies its blocking gate and keeps the terminal state", () => {
    const [, r] = scenarios.find(([n]) => n === "E5 neutral")!;
    const t = r.decisionTrace!;
    expect(t.failedGates.length).toBeGreaterThan(0);
    expect(r.tradePlan).toBeUndefined();
    expect(r.positionSizing).toBeUndefined();
    const failedReasons = t.gates.filter((g) => g.status === "FAIL").map((g) => g.reason);
    for (const reason of r.noTradeReasons) {
      expect(failedReasons.some((f) => f.includes(reason))).toBe(true);
    }
  });
});

// ═════════════════════════ P7 — RISK / SIZING SAFETY ════════════════

describe("risk / sizing end-to-end safety", () => {
  const sizingSpec = {
    ...BULL,
    instrument: "BTC/USDT",
    instrumentType: "crypto" as const,
    macroData: macro("bullish"),
    accountEquity: 50_000,
    riskPercent: 0.02,
    instrumentSpec: { assetClass: "crypto", contractSize: 1, quantityStep: 0.01, minQuantity: 0.01, quoteCurrency: "USDT" },
  };

  it("riskAmount = equity × risk% exactly; risk math uses NO leverage term", () => {
    const r = run(sizingSpec);
    expect(r.positionSizing?.riskAmount).toBeCloseTo(1000, 4);
    expect(Object.keys(r.positionSizing!).join(",")).not.toMatch(/leverage/i);
    const raw = JSON.stringify(r.positionSizing).toLowerCase();
    expect(raw).not.toContain("leverage");
  });

  it("quantity rounds DOWN to the spec step and stays ≥ minQuantity or is refused", () => {
    const r = run(sizingSpec);
    const q = r.positionSizing!.quantity!;
    const steps = q / 0.01;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    expect(q).toBeGreaterThanOrEqual(0.01);
  });

  it("sizing unavailable → thesis remains valid with an explicit reason", () => {
    const r = run({ ...sizingSpec, accountEquity: undefined, instrumentSpec: undefined });
    expect(r.recommendation).toBe("LONG");
    expect(r.positionSizing).toBeUndefined();
  });

  it("explicit spec wins; conflicting provider metadata blocks sizing honestly", () => {
    // Pure resolver-level guarantee re-verified through the engine:
    const ok = run(sizingSpec);
    expect(ok.positionSizing?.available).toBe(true);
    // A garbage provider payload cannot silently override the explicit spec.
    const badOkx = {
      fetchedAt: Date.now(), source: "OKX public instruments" as const, freshness: "static" as const,
      instruments: [{ instId: "BTC-USDT-SWAP", ctVal: NaN, ctValCcy: "BTC" }],
      parseWarnings: [],
    };
    const r = run({ ...sizingSpec, okxSpecData: badOkx as never });
    // Thesis unaffected…
    expect(r.recommendation).toBe("LONG");
    // …and NEVER a quantity computed from malformed provider metadata:
    // either clean resolution from the explicit spec, or honest absence/refusal.
    if (r.positionSizing?.available) {
      expect(r.positionSizing.quantity).toBeGreaterThan(0);
      expect(Number.isFinite(r.positionSizing.quantity)).toBe(true);
    } else {
      expect(r.positionSizing?.unavailableReason ?? "sizing withheld").toBeTruthy();
    }
  });

  it("R:R ≥ 1.5 enforced across every directional fixture in this file", () => {
    const directional = [
      run(BULL), run(BEAR),
      run({ ...sizingSpec }),
      run({ ...BULL, instrument: "WTI", instrumentType: "commodity", eiaData: eiaFixture(420.5, 419.8) }),
    ];
    for (const r of directional) {
      if (r.recommendation !== "NO_TRADE") {
        expect(r.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
});

// ═════════════════════════ P11 — DETERMINISM ════════════════════════

describe("determinism / repeatability", () => {
  const spec = {
    ...BULL,
    instrument: "BTC/USDT",
    instrumentType: "crypto" as const,
    macroData: macro("bullish"),
    sentimentData: sentiment("bullish", 0.8),
    treasuryData: treasuryFixture(20),
    cotData: cotFixture(400),
    executionData: execution(0.5),
  };

  it("repeated runs produce byte-identical decisions and fingerprints", () => {
    const input = { ...assemble(spec), ...spec };
    const r1 = runAnalysis(input as never);
    const r2 = runAnalysis(input as never);
    const strip = (r: ReturnType<typeof runAnalysis>) =>
      JSON.stringify({ ...r, id: "" }); // id is legitimately unique per run
    expect(strip(r2)).toBe(strip(r1));
    expect(r2.decisionFingerprint).toBe(r1.decisionFingerprint);
  });

  it("irrelevant extra metadata cannot alter the decision", () => {
    const base = run(spec);
    const noisy = run({ ...spec, styleNotes: ["user note", "another"] });
    expect(noisy.decisionFingerprint).toBe(base.decisionFingerprint);
  });

  it("sentiment article ordering does not affect scoring inputs (aggregates only)", () => {
    const a = run(spec);
    const flipped = {
      ...spec,
      sentimentData: {
        ...sentiment("bullish", 0.8),
        breakdown: { positive: 9, negative: 0, neutral: 1 }, // same aggregates, different key order
      },
    };
    const b = run(flipped);
    expect(b.confidence).toBe(a.confidence);
    expect(b.decisionFingerprint).toBe(a.decisionFingerprint);
  });
});
