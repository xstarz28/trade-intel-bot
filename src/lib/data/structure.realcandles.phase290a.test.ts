/**
 * Phase 290-A — real-provider E2E: provider OHLCV → structure → MTF → unified
 * analysis → recommendation.
 *
 * The candles are the PROVIDER's own payload, captured verbatim from OKX
 * (`GET /api/v5/market/candles`) for BTC-USDT and stored outside the repository
 * as evidence. This file is HERMETIC by default: it skips unless the evidence
 * directory is provided (`PHASE290A_REAL_CANDLES_DIR`), so the default suite
 * never depends on a third party or on the sandbox's network.
 *
 * Run:
 *   PHASE290A_REAL_CANDLES_DIR=/home/user/phase290a/evidence \
 *     npx vitest run src/lib/data/structure.realcandles.phase290a.test.ts
 *
 * Nothing here fabricates a price: if the evidence is absent the test reports
 * itself as skipped, and every value asserted comes from the provider payload.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { computeSmcContext } from "./smc";
import { buildMtfContext } from "./mtf";
import { calculateTechnical } from "./technical";
import type { MtfCandleInput } from "./mtf";
import type { OhlcvCandle, TechnicalData } from "./market-types";
import type { Timeframe } from "@/types/analysis";
import { runAnalysis } from "@/lib/analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import { generateRecommendation } from "@/lib/recommendation-engine";
import type { CandidateInput } from "@/lib/recommendation-engine";

const EVIDENCE_DIR = process.env.PHASE290A_REAL_CANDLES_DIR;
const INSTRUMENT = "BTC-USDT";
const PROVIDER = "okx";

function loadProviderCandles(bar: string): OhlcvCandle[] | undefined {
  if (!EVIDENCE_DIR) return undefined;
  const file = path.join(EVIDENCE_DIR, `${PROVIDER.toLowerCase()}-${INSTRUMENT}-${bar}.json`);
  if (!fs.existsSync(file)) return undefined;
  const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
    code: string;
    data: [string, string, string, string, string, string, string, string, string][];
  };
  expect(payload.code).toBe("0");
  // OKX returns newest-first; the live client reverses to oldest-first. The same
  // step is applied here, and the provider's own timestamps are preserved.
  return payload.data
    .map((row) => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .reverse();
}

const W1 = loadProviderCandles("1W");
const D1 = loadProviderCandles("1D");
const H4 = loadProviderCandles("4H");
const H1 = loadProviderCandles("1H");

const haveEvidence = Boolean(W1 && D1 && H4 && H1);

describe.skipIf(!haveEvidence)(
  "Phase 290-A — real OKX candles through structure → MTF → unified → recommendation",
  () => {
    const setup = H4!;
    // The production caller passes EVERY chain slot; a slot that could not be
    // fetched arrives with null candles plus the provider's failure reason.
    const inputs = (opts: { macro?: boolean } = {}): MtfCandleInput[] => [
      opts.macro === false
        ? { timeframe: "W1", role: "macro" as const, candles: null, error: "fetch failed: provider unavailable" }
        : { timeframe: "W1", role: "macro" as const, candles: W1! },
      { timeframe: "D1", role: "structure" as const, candles: D1! },
      { timeframe: "H4", role: "setup" as const, candles: setup },
      { timeframe: "H1", role: "trigger" as const, candles: H1! },
    ];

    it("the provider payload is internally consistent (no synthesized rows)", () => {
      for (const [tf, candles] of [
        ["W1", W1!],
        ["D1", D1!],
        ["4H", setup],
        ["1H", H1!],
      ] as const) {
        expect(candles.length).toBeGreaterThanOrEqual(20);
        for (const c of candles) {
          expect(Number.isFinite(c.timestamp)).toBe(true);
          expect(c.high).toBeGreaterThanOrEqual(c.low);
          expect(c.high).toBeGreaterThanOrEqual(c.close);
          expect(c.low).toBeLessThanOrEqual(c.close);
          expect(Number.isFinite(c.volume)).toBe(true);
        }
        // strictly increasing, no duplicate or synthetic timestamps
        for (let i = 1; i < candles.length; i++) {
          expect(candles[i].timestamp).toBeGreaterThan(candles[i - 1].timestamp);
        }
        expect(tf.length).toBeGreaterThan(0);
      }
    });

    it("the SMC layer produces a confirmed, causal structural read", () => {
      const smc = computeSmcContext(setup, "H4");
      const read = smc.structural!.external;
      expect(read.timeframe).toBe("H4");
      expect(["confirmed_event", "no_event", "no_confirmed_swings"]).toContain(read.evidenceState);
      for (const e of read.events) {
        expect(e.candleIndex).toBeLessThan(setup.length);
        expect(setup[e.candleIndex].timestamp).toBe(e.candleTime);
        expect(e.confirmedAtIndex).toBe(e.candleIndex);
      }
      if (read.invalidation) {
        expect(setup[read.invalidation.swingIndex].timestamp).toBe(read.invalidation.timestamp);
        expect(read.invalidation.swingIndex).toBeLessThan(setup.length);
      }
      console.log(`[290-A] H4 ${read.evidenceState} direction=${read.direction} :: ${read.reason}`);
      console.log(`[290-A] ${JSON.stringify(read.lastEvent)} inv=${JSON.stringify(read.invalidation)}`);
    });

    it("the MTF chain is independent per timeframe and structurally confluent", () => {
      const ctx = buildMtfContext("H4", inputs());
      expect(ctx.chainUsed).toEqual(["W1", "D1", "H4", "H1"]);
      expect(ctx.unavailable).toEqual([]);
      for (const t of ctx.timeframes) {
        expect(t.structural).toBeDefined();
        expect(t.structural!.timeframe).toBe(t.timeframe);
        for (const e of t.structural!.events) {
          const candles = t.timeframe === "W1" ? W1! : t.timeframe === "D1" ? D1! : t.timeframe === "H4" ? setup : H1!;
          expect(candles[e.candleIndex].timestamp).toBe(e.candleTime);
        }
      }
      expect(ctx.structuralConfluence).toBeDefined();
      expect([
        "ALIGNED_BULLISH",
        "ALIGNED_BEARISH",
        "COUNTER_TREND",
        "MIXED",
        "INCOMPLETE",
        "UNKNOWN",
      ]).toContain(ctx.structuralConfluence!.state);
      console.log(`[290-A] confluence: ${JSON.stringify(ctx.structuralConfluence)}`);
      console.log(`[290-A] alignment=${ctx.alignment} htfBias=${ctx.htfBias} htf=${ctx.htfTimeframe}`);
    });

    it("a missing timeframe is stated explicitly and never synthesized", () => {
      const ctx = buildMtfContext("H4", inputs({ macro: false }));
      const w1 = ctx.unavailable.find((u) => u.timeframe === "W1");
      expect(w1).toBeDefined();
      // The provider's own failure reason is preserved verbatim.
      expect(w1!.reason).toBe("fetch failed: provider unavailable");
      expect(w1!.role).toBe("macro");
      expect(ctx.chainUsed).toEqual(["D1", "H4", "H1"]);
      expect(ctx.timeframes.some((t) => t.timeframe === "W1")).toBe(false);
      // The next readable timeframe carries the context — no synthetic W1.
      expect(ctx.htfTimeframe).toBe("D1");
      expect(ctx.structuralConfluence!.htfTimeframe).toBe("D1");
      // Roles that produced no confirmed direction are named, not assumed.
      expect(ctx.structuralConfluence!.unresolvedRoles).toContain("trigger");
    });

    it("HTF context, unified analysis and recommendation all carry the structural facts", () => {
      const tech: TechnicalData = {
        ...calculateTechnical(setup, D1, "D1"),
        smc: computeSmcContext(setup, "H4"),
        mtf: buildMtfContext("H4", inputs()),
      };
      const last = setup[setup.length - 1];
      const input: AnalysisInput = {
        instrument: INSTRUMENT,
        instrumentType: "crypto",
        timeframe: "H4",
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        marketData: {
          instrument: INSTRUMENT,
          instrumentType: "crypto",
          provider: PROVIDER,
          providerInstrumentId: INSTRUMENT,
          fetchTimestamp: last.timestamp,
          price: { price: last.close, timestamp: last.timestamp, source: PROVIDER },
          candles: setup,
          timeframe: "H4",
          dataFreshness: "delayed",
        },
        technicalData: tech,
      };
      const analysis = runAnalysis(input);
      expect(analysis.structuralEvidence).toBeDefined();
      const evidence = analysis.structuralEvidence!;
      expect(evidence.timeframes.map((t) => t.timeframe)).toContain("H4");
      for (const line of evidence.digest) {
        // Engine wording only — no probability, no advisory language.
        expect(line).not.toMatch(/probab|advice|signal strength/i);
      }
      expect(tech.htfContext!.structuralEvidence).toBeDefined();
      expect(tech.htfContext!.structuralEvidence!.timeframe).toBe("D1");

      const event = tech.smc!.structural!.external.lastEvent;
      const invalidation = tech.smc!.structural!.external.invalidation;
      const candidate = {
        instrument: INSTRUMENT,
        assetClass: "crypto",
        currentPrice: last.close,
        dataCompleteness: "FULL",
        dataPoints: setup.length,
        hasLiveData: true,
        freshness: "DELAYED",
        providerCoverage: "PARTIAL",
        atr: tech.atr14,
        htfBias:
          tech.mtf!.structuralConfluence?.htfDirection === "bullish"
            ? "long"
            : tech.mtf!.structuralConfluence?.htfDirection === "bearish"
              ? "short"
              : "neutral",
        mtfAlignment: tech.mtf!.alignment,
        structuralDirection: tech.smc!.structural!.external.direction,
        ...(event
          ? {
              structuralEvent: {
                kind: event.kind,
                direction: event.direction,
                brokenLevel: event.brokenLevel,
                candleTime: event.candleTime,
                timeframe: "H4",
              },
            }
          : {}),
        ...(invalidation
          ? {
              structuralInvalidation: {
                level: invalidation.level,
                timeframe: "H4",
                swingKind: invalidation.swingKind,
              },
            }
          : {}),
        structuralPairState: tech.smc!.structural!.state,
      } as CandidateInput;

      const rec = generateRecommendation([candidate], "INTRADAY");
      expect(rec.rankedInstruments.length).toBeGreaterThan(0);
      const ranked = rec.rankedInstruments[0];
      if (event) {
        expect(ranked.structuralFacts!.join("\n")).toContain(String(event.brokenLevel));
      }
      if (invalidation) {
        expect(ranked.invalidationConditions.join("\n")).toContain(
          String(invalidation.level),
        );
      }
      console.log(`[290-A] analysis bias=${analysis.bias} rec=${analysis.recommendation}`);
      console.log(`[290-A] ranked score=${ranked.analyticalScore} conf=${ranked.confidence}`);
      console.log(`[290-A] facts: ${JSON.stringify(ranked.structuralFacts ?? [])}`);
      console.log(`[290-A] digest: ${evidence.digest.join(" | ")}`);
    });

    it("the whole pass is deterministic on the same provider candles", () => {
      const once = buildMtfContext("H4", inputs());
      const twice = buildMtfContext("H4", inputs());
      expect(JSON.stringify(once.structuralConfluence)).toBe(
        JSON.stringify(twice.structuralConfluence),
      );
      const a = runAnalysis({
        instrument: INSTRUMENT,
        instrumentType: "crypto",
        timeframe: "H4" as Timeframe,
        marketData: {
          instrument: INSTRUMENT,
          instrumentType: "crypto",
          provider: PROVIDER,
          fetchTimestamp: setup[setup.length - 1].timestamp,
          price: {
            price: setup[setup.length - 1].close,
            timestamp: setup[setup.length - 1].timestamp,
            source: PROVIDER,
          },
          candles: setup,
          timeframe: "H4",
          dataFreshness: "delayed",
        },
        technicalData: {
          ...calculateTechnical(setup, D1, "D1"),
          smc: computeSmcContext(setup, "H4"),
          mtf: once,
        },
      });
      const b = runAnalysis({
        instrument: INSTRUMENT,
        instrumentType: "crypto",
        timeframe: "H4" as Timeframe,
        marketData: {
          instrument: INSTRUMENT,
          instrumentType: "crypto",
          provider: PROVIDER,
          fetchTimestamp: setup[setup.length - 1].timestamp,
          price: {
            price: setup[setup.length - 1].close,
            timestamp: setup[setup.length - 1].timestamp,
            source: PROVIDER,
          },
          candles: setup,
          timeframe: "H4",
          dataFreshness: "delayed",
        },
        technicalData: {
          ...calculateTechnical(setup, D1, "D1"),
          smc: computeSmcContext(setup, "H4"),
          mtf: twice,
        },
      });
      expect(JSON.stringify(a.structuralEvidence)).toBe(JSON.stringify(b.structuralEvidence));
      expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
    });
  },
);

describe.skipIf(haveEvidence)("Phase 290-A — real-candle evidence", () => {
  it("is skipped without PHASE290A_REAL_CANDLES_DIR (hermetic default)", () => {
    expect(haveEvidence).toBe(false);
  });
});
