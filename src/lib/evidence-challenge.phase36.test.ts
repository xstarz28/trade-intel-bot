/**
 * Phase 36 — EVIDENCE & THESIS CHALLENGE ENGINE TESTS.
 *
 * Comprehensive validation of the evidence challenge module.
 * Tests work with the ACTUAL engine output — they do not assume
 * any specific recommendation/bias from deterministic fixtures.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildChain, buildMtfContext } from "./data/mtf";
import { buildEvidenceChallenge } from "./evidence-challenge";
import type { EvidenceChallengeContext } from "./evidence-challenge";

// ── Fixture builders ─────────────────────────────────────────────

function ts(i: number): number {
  return Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000;
}

function bullCandle(i: number, base: number): OhlcvCandle {
  const price = base + i * 50;
  return { timestamp: ts(i), open: price - 20, high: price + 30, low: price - 40, close: price, volume: 1_000_000 };
}

function bearCandle(i: number, base: number): OhlcvCandle {
  const price = base - i * 50;
  return { timestamp: ts(i), open: price + 20, high: price + 40, low: price - 30, close: price, volume: 1_000_000 };
}

function bullCandles(start: number, base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bullCandle(start + i, base));
}

function bearCandles(start: number, base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bearCandle(start + i, base));
}

function flatCandles(base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, () => ({
    timestamp: ts(0), open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1000,
  }));
}

function mixedCandles(n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0;
    const base = 50000 + Math.sin(i * 0.1) * 2000;
    return {
      timestamp: ts(i),
      open: base + (up ? -10 : 10),
      high: base + 50,
      low: base - 50,
      close: base + (up ? 30 : -30),
      volume: 1_000_000,
    };
  });
}

function buildInput(
  instrument: string,
  type: AnalysisInput["instrumentType"],
  candles: OhlcvCandle[],
  opts: Partial<AnalysisInput> = {},
): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({
      timeframe: s.timeframe,
      role: (s.role === "setup" || s.role === "trigger" ? s.role : "setup") as "setup" | "trigger",
      candles: candles.slice(-120),
    })),
  ];
  tech.mtf = buildMtfContext("D1", mtfInputs);
  return {
    instrument, instrumentType: type, timeframe: "D1", tradingStyle: "swing",
    marketData: {
      instrument, instrumentType: type, provider: "twelve-data", fetchTimestamp: Date.now(),
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech, ...opts,
  };
}

function run(input: AnalysisInput): AnalysisResult {
  return runAnalysis(input);
}

function assertEvidenceChallenge(ec: EvidenceChallengeContext, label: string) {
  expect(ec.evidenceImpact, `${label}: evidenceImpact`).toBe("INFORMATIONAL_ONLY");
  expect(ec.supportingEvidence, `${label}: supportingEvidence`).toBeDefined();
  expect(ec.conflictingEvidence, `${label}: conflictingEvidence`).toBeDefined();
  expect(ec.neutralEvidence, `${label}: neutralEvidence`).toBeDefined();
  expect(ec.thesisSupportStatus, `${label}: thesisSupportStatus`).toBeTruthy();
  expect(ec.thesisSupportExplanation, `${label}: thesisSupportExplanation`).toBeTruthy();
  expect(ec.counterThesis, `${label}: counterThesis`).toBeTruthy();
  expect(ec.counterThesisSource, `${label}: counterThesisSource`).toBeTruthy();
  expect(ec.doubleCountingWarnings, `${label}: doubleCountingWarnings`).toBeDefined();
  expect(ec.thesisFragility, `${label}: thesisFragility`).toBeTruthy();
  expect(ec.fragilityExplanation, `${label}: fragilityExplanation`).toBeTruthy();
  expect(ec.missingEvidence, `${label}: missingEvidence`).toBeDefined();
  expect(ec.thesisStrengtheners, `${label}: thesisStrengtheners`).toBeDefined();
  expect(ec.thesisWeaknesseners, `${label}: thesisWeaknesseners`).toBeDefined();
  expect(ec.thesisInvalidators, `${label}: thesisInvalidators`).toBeDefined();
  expect(ec.auditSummary, `${label}: auditSummary`).toBeTruthy();
  expect(["WELL_SUPPORTED", "SUPPORTED", "MIXED_SUPPORT", "WEAK_SUPPORT", "INSUFFICIENT_SUPPORT", "CONFLICTED", "NO_ACTIVE_THESIS"]).toContain(ec.thesisSupportStatus);
  expect(["LOW", "MODERATE", "ELEVATED", "HIGH", "UNKNOWN"]).toContain(ec.thesisFragility);
}

function assertNoProbabilityLanguage(ec: EvidenceChallengeContext, label: string) {
  const text = JSON.stringify(ec).toLowerCase();
  expect(text, `${label}: no probability`).not.toMatch(/\b(probability|chance|percent|win.?rate|guarantee|guaranteed|certainty|will definitely|will certainly)\b/);
}

// ── Tests ────────────────────────────────────────────────────────

describe("Phase 36 — Evidence & Thesis Challenge Engine", () => {

  describe("Evidence collection", () => {
    it("collects evidence for any directional or neutral result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      // Regardless of direction, we should collect SOME evidence items
      const total = ec.supportingEvidence.length + ec.conflictingEvidence.length + ec.neutralEvidence.length;
      expect(total).toBeGreaterThan(0);
    });

    it("collects structure evidence for directional result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      // If directional, structure evidence should exist
      if (r.bias !== "Neutral") {
        const structure = [...ec.supportingEvidence, ...ec.conflictingEvidence].filter(
          (e) => e.category === "STRUCTURE",
        );
        expect(structure.length).toBeGreaterThan(0);
      }
    });

    it("collects MTF evidence when MTF data is available", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      const mtf = [...ec.supportingEvidence, ...ec.conflictingEvidence, ...ec.neutralEvidence].filter(
        (e) => e.category === "MTF",
      );
      expect(mtf.length).toBeGreaterThan(0);
    });

    it("collects regime evidence when regime context is available", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      const regime = [...ec.supportingEvidence, ...ec.conflictingEvidence, ...ec.neutralEvidence].filter(
        (e) => e.category === "MARKET_REGIME",
      );
      expect(regime.length).toBeGreaterThan(0);
    });

    it("collects fundamental/macro evidence", () => {
      const r = run(buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 2)));
      const ec = buildEvidenceChallenge(r);
      const fund = [...ec.supportingEvidence, ...ec.conflictingEvidence, ...ec.neutralEvidence].filter(
        (e) => e.category === "FUNDAMENTAL" || e.category === "MACRO",
      );
      expect(fund.length).toBeGreaterThan(0);
    });

    it("marks unavailable fundamental data correctly", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (!r.fundamentalThesis) {
        const fundUnavailable = [...ec.neutralEvidence].filter(
          (e) => e.category === "FUNDAMENTAL" && e.direction === "unavailable",
        );
        expect(fundUnavailable.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Thesis support audit", () => {
    it("returns valid thesis support status", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(["WELL_SUPPORTED", "SUPPORTED", "MIXED_SUPPORT", "WEAK_SUPPORT", "INSUFFICIENT_SUPPORT", "CONFLICTED", "NO_ACTIVE_THESIS"]).toContain(ec.thesisSupportStatus);
      expect(ec.thesisSupportExplanation).toBeTruthy();
    });

    it("identifies strongest supporting evidence when present", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (ec.supportingEvidence.length > 0) {
        expect(ec.strongestSupportingEvidence).not.toBeNull();
        expect(ec.strongestSupportingEvidence!.strength).toBeTruthy();
      }
    });

    it("identifies strongest conflicting evidence when present", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      const ec = buildEvidenceChallenge(r);
      if (ec.conflictingEvidence.length > 0) {
        expect(ec.strongestConflictingEvidence).not.toBeNull();
      }
    });

    it("NO_ACTIVE_THESIS when neutral and NO_TRADE", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles(50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.bias === "Neutral" || r.recommendation === "NO_TRADE") {
        expect(ec.thesisSupportStatus).toBe("NO_ACTIVE_THESIS");
      }
    });
  });

  describe("Counter-thesis", () => {
    it("provides counter-thesis for any result", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.counterThesis).toBeTruthy();
      expect(ec.counterThesis.length).toBeGreaterThan(10);
    });

    it("counter-thesis for bearish input", () => {
      const r = run(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.counterThesis).toBeTruthy();
    });

    it("counter-thesis source is traceable", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.counterThesisSource).toBeTruthy();
    });
  });

  describe("Double-counting detection", () => {
    it("detects shared dependency groups accurately", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.doubleCountingWarnings).toBeDefined();
      for (const w of ec.doubleCountingWarnings) {
        expect(w.dependencyGroup).toBeTruthy();
        expect(w.relatedEvidenceCount).toBeGreaterThanOrEqual(2);
        expect(w.description).toBeTruthy();
      }
    });
  });

  describe("Thesis fragility", () => {
    it("reports valid fragility level", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(["LOW", "MODERATE", "ELEVATED", "HIGH", "UNKNOWN"]).toContain(ec.thesisFragility);
      expect(ec.fragilityExplanation).toBeTruthy();
    });

    it("higher fragility for conflicting evidence", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      const ec = buildEvidenceChallenge(r);
      if (r.bias !== "Neutral" && ec.conflictingEvidence.length >= 2) {
        expect(["MODERATE", "ELEVATED", "HIGH"]).toContain(ec.thesisFragility);
      }
    });

    it("UNKNOWN fragility when no active thesis", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles(50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.bias === "Neutral") {
        expect(ec.thesisFragility).toBe("UNKNOWN");
      }
    });
  });

  describe("Missing evidence", () => {
    it("identifies missing fundamental data for crypto without provider", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (!r.fundamentalThesis) {
        const hasFundMissing = ec.missingEvidence.some((m) => m.toLowerCase().includes("fundamental"));
        expect(hasFundMissing).toBe(true);
      }
    });

    it("identifies missing derivatives for crypto when absent", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (!r.derivativesData) {
        const hasDerivMissing = ec.missingEvidence.some((m) => m.toLowerCase().includes("derivative"));
        expect(hasDerivMissing).toBe(true);
      }
    });

    it("missing evidence remains neutral — never directional", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      for (const item of ec.supportingEvidence) {
        expect(item.direction).not.toBe("unavailable");
      }
      for (const item of ec.conflictingEvidence) {
        expect(item.direction).not.toBe("unavailable");
      }
    });
  });

  describe("Thesis modifiers", () => {
    it("always provides strengtheners", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.thesisStrengtheners.length).toBeGreaterThan(0);
    });

    it("always provides invalidators for directional thesis", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.bias !== "Neutral") {
        expect(ec.thesisInvalidators.length).toBeGreaterThan(0);
      }
    });

    it("neutral thesis gets directional strengtheners", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles(50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.bias === "Neutral") {
        expect(ec.thesisStrengtheners.some((s) => s.toLowerCase().includes("directional structure"))).toBe(true);
      }
    });
  });

  describe("Audit summary", () => {
    it("produces a meaningful summary", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.auditSummary.length).toBeGreaterThan(50);
      expect(ec.auditSummary).toContain("Decision:");
      expect(ec.auditSummary).toContain("Bias:");
    });

    it("includes thesis support and fragility info", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      expect(ec.auditSummary.toLowerCase()).toContain("thesis support");
      expect(ec.auditSummary.toLowerCase()).toContain("fragility");
    });
  });

  describe("Safety — no probability language", () => {
    it("no probability in bullish scenario", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      assertNoProbabilityLanguage(buildEvidenceChallenge(r), "BTC bullish");
    });

    it("no probability in bearish scenario", () => {
      const r = run(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
      assertNoProbabilityLanguage(buildEvidenceChallenge(r), "BTC bearish");
    });

    it("no probability in mixed scenario", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      assertNoProbabilityLanguage(buildEvidenceChallenge(r), "BTC mixed");
    });
  });

  describe("Non-authoritative behavior", () => {
    it("does not modify recommendation", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const rec = r.recommendation;
      buildEvidenceChallenge(r);
      expect(r.recommendation).toBe(rec);
    });

    it("does not modify conviction", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const conv = r.conviction;
      const conf = r.confidence;
      buildEvidenceChallenge(r);
      expect(r.conviction).toBe(conv);
      expect(r.confidence).toBe(conf);
    });

    it("does not modify trade plan", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const tp = r.tradePlan;
      buildEvidenceChallenge(r);
      expect(r.tradePlan).toBe(tp);
    });

    it("does not modify bias", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const bias = r.bias;
      buildEvidenceChallenge(r);
      expect(r.bias).toBe(bias);
    });
  });

  describe("Determinism", () => {
    it("same input produces identical challenge", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec1 = buildEvidenceChallenge(r);
      const ec2 = buildEvidenceChallenge(r);
      expect(ec1.thesisSupportStatus).toBe(ec2.thesisSupportStatus);
      expect(ec1.thesisFragility).toBe(ec2.thesisFragility);
      expect(ec1.supportingEvidence.length).toBe(ec2.supportingEvidence.length);
      expect(ec1.conflictingEvidence.length).toBe(ec2.conflictingEvidence.length);
      expect(ec1.counterThesis).toBe(ec2.counterThesis);
      expect(ec1.auditSummary).toBe(ec2.auditSummary);
    });

    it("different instruments produce different challenges when directional", () => {
      // Use EUR/USD forex and XAU/USD commodity to ensure different instruments produce different evidence
      const eur = run(buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 2)));
      const xau = run(buildInput("XAU/USD", "commodity", bullCandles(0, 2400)));
      const ecEur = buildEvidenceChallenge(eur);
      const ecXau = buildEvidenceChallenge(xau);
      // Different instrument types produce different evidence categories
      expect(ecEur.supportingEvidence.length + ecEur.conflictingEvidence.length + ecEur.neutralEvidence.length)
        .not.toBe(ecXau.supportingEvidence.length + ecXau.conflictingEvidence.length + ecXau.neutralEvidence.length);
    });
  });

  describe("Multi-instrument", () => {
    const instruments: [string, AnalysisInput["instrumentType"], OhlcvCandle[]][] = [
      ["BTC/USD", "crypto", bullCandles(0, 50000)],
      ["ETH/USD", "crypto", bullCandles(0, 3000)],
      ["SOL/USD", "crypto", bullCandles(0, 150)],
      ["DOGE/USD", "crypto", bullCandles(0, 0.1)],
      ["EUR/USD", "forex", bullCandles(0, 1.1, 2)],
      ["XAU/USD", "commodity", bullCandles(0, 2400)],
      ["AAPL", "stock", bullCandles(0, 200)],
    ];

    for (const [symbol, type, candles] of instruments) {
      it(`valid challenge for ${symbol}`, () => {
        const r = run(buildInput(symbol, type, candles));
        const ec = buildEvidenceChallenge(r);
        assertEvidenceChallenge(ec, symbol);
        assertNoProbabilityLanguage(ec, symbol);
      });
    }
  });

  describe("Adversarial scenarios", () => {
    it("no optional providers do not crash", () => {
      const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
      delete input.fundamentalData;
      delete input.sentimentData;
      delete input.macroData;
      delete input.derivativesData;
      delete input.calendarData;
      delete input.treasuryData;
      delete input.cotData;
      delete input.eiaData;
      const r = run(input);
      const ec = buildEvidenceChallenge(r);
      assertEvidenceChallenge(ec, "no-optionals");
      assertNoProbabilityLanguage(ec, "no-optionals");
      expect(ec.supportingEvidence.length + ec.conflictingEvidence.length + ec.neutralEvidence.length).toBeGreaterThan(0);
    });

    it("sparse candles do not crash", () => {
      const sparse = Array.from({ length: 10 }, (_, i) => bullCandle(i, 50000));
      const r = run(buildInput("BTC/USD", "crypto", sparse));
      const ec = buildEvidenceChallenge(r);
      assertEvidenceChallenge(ec, "sparse");
    });

    it("flat candles produce valid challenge", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles(50000)));
      const ec = buildEvidenceChallenge(r);
      assertEvidenceChallenge(ec, "flat");
      if (r.bias === "Neutral") {
        expect(ec.thesisSupportStatus).toBe("NO_ACTIVE_THESIS");
      }
    });

    it("mixed candles produce valid challenge", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      const ec = buildEvidenceChallenge(r);
      assertEvidenceChallenge(ec, "mixed");
    });

    it("bearish input produces valid challenge", () => {
      const r = run(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      assertEvidenceChallenge(ec, "bearish");
    });

    it("engine result is not mutated", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const origRec = r.recommendation;
      const origBias = r.bias;
      const origConv = r.conviction;
      const origConf = r.confidence;
      const origTp = r.tradePlan;
      buildEvidenceChallenge(r);
      expect(r.recommendation).toBe(origRec);
      expect(r.bias).toBe(origBias);
      expect(r.conviction).toBe(origConv);
      expect(r.confidence).toBe(origConf);
      expect(r.tradePlan).toBe(origTp);
    });
  });

  describe("Integration with AnalysisResult", () => {
    it("evidenceChallenge is populated in engine output", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      expect(r.evidenceChallenge).toBeDefined();
      assertEvidenceChallenge(r.evidenceChallenge!, "engine-integration");
    });

    it("evidenceChallenge is informational only", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      expect(r.evidenceChallenge!.evidenceImpact).toBe("INFORMATIONAL_ONLY");
    });
  });

  describe("Fragility edge cases", () => {
    it("strong coherent thesis = low or moderate fragility", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.bias !== "Neutral" && ec.conflictingEvidence.length === 0 && ec.supportingEvidence.length >= 2) {
        expect(["LOW", "MODERATE"]).toContain(ec.thesisFragility);
      }
    });

    it("EXHAUSTED continuation increases fragility", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      const ec = buildEvidenceChallenge(r);
      if (r.marketRegimeContext?.continuationQuality === "EXHAUSTED" && r.bias !== "Neutral") {
        expect(["ELEVATED", "HIGH"]).toContain(ec.thesisFragility);
      }
    });

    it("fundamental conflict increases fragility", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.fundamentalThesis?.alignment === "CONFLICTING" && r.bias !== "Neutral") {
        expect(["MODERATE", "ELEVATED", "HIGH"]).toContain(ec.thesisFragility);
      }
    });
  });

  describe("HTF > MTF > LTF hierarchy", () => {
    it("HTF structure evidence has high relevance", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      const htfEvidence = [...ec.supportingEvidence, ...ec.conflictingEvidence].filter(
        (e) => e.source === "HTF structure",
      );
      for (const e of htfEvidence) {
        expect(e.relevance).toBe("high");
      }
    });

    it("MTF alignment evidence has high relevance", () => {
      const r = run(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
      const ec = buildEvidenceChallenge(r);
      const mtfEvidence = [...ec.supportingEvidence, ...ec.conflictingEvidence].filter(
        (e) => e.source === "MTF alignment" || e.source === "MTF conflict",
      );
      for (const e of mtfEvidence) {
        expect(e.relevance).toBe("high");
      }
    });
  });

  describe("NO_TRADE and WAIT", () => {
    it("NO_TRADE has valid audit", () => {
      const r = run(buildInput("BTC/USD", "crypto", flatCandles(50000)));
      const ec = buildEvidenceChallenge(r);
      if (r.recommendation === "NO_TRADE") {
        expect(ec.thesisSupportStatus).toBe("NO_ACTIVE_THESIS");
        expect(ec.auditSummary).toBeTruthy();
      }
    });

    it("WAIT has meaningful audit even without trade plan", () => {
      const r = run(buildInput("BTC/USD", "crypto", mixedCandles()));
      const ec = buildEvidenceChallenge(r);
      if (r.professionalThesis?.actionability === "WAIT") {
        expect(ec.auditSummary).toBeTruthy();
        expect(ec.thesisSupportStatus).not.toBe("NO_ACTIVE_THESIS");
      }
    });
  });
});
