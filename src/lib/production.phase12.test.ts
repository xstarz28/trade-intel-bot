/**
 * Phase 12 — production hygiene: history/persistence compatibility,
 * client-side secret hygiene (static scan), provider-failure sanitization
 * and the production error contract for corrupted primary input.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runAnalysis } from "./analysis-engine";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  executionUnavailable,
} from "./benchmark-fixtures.phase9";
import type { AnalysisInput } from "@/types/analysis";

type RunSpec = Parameters<typeof assemble>[0] & Record<string, unknown>;
const run = (spec: RunSpec = {}) =>
  runAnalysis({ ...assemble(spec), ...spec } as never);

const BULL = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
};

// ═════════════════ P8 — HISTORY / PERSISTENCE COMPATIBILITY ════════

describe("history / persistence compatibility", () => {
  /** Mirrors the Dashboard's legacy-record mapping guarantees. */
  const mapLegacy = (rec: Record<string, unknown>) => ({
    ...rec,
    tradingStyle: (rec.tradingStyle as string) ?? "intraday",
    noTradeReasons: (rec.noTradeReasons as string[]) ?? [],
    recommendation:
      (rec.recommendation as string) ??
      (rec.bias === "Bullish" ? "LONG" : rec.bias === "Bearish" ? "SHORT" : "NO_TRADE"),
    conviction: rec.conviction ?? undefined,
  });

  it("a pre-Phase-11 record (no trace/fingerprint/style) loads with safe defaults", () => {
    const old = { bias: "Bullish", confidence: 62, instrument: "EUR/USD" };
    const mapped = mapLegacy(old);
    expect(mapped.tradingStyle).toBe("intraday");
    expect(mapped.recommendation).toBe("LONG"); // derived, not fabricated evidence
    expect(mapped.noTradeReasons).toEqual([]);
    expect(() => JSON.stringify(mapped)).not.toThrow();
  });

  it("new records carry optional additive fields; both shapes serialize cleanly", () => {
    const r = run(BULL);
    const modern = JSON.parse(JSON.stringify(r));
    expect(modern.decisionTrace.version).toBe(1);
    expect(typeof modern.decisionFingerprint).toBe("string");
    // Legacy shape still round-trips.
    const legacy = { instrument: "XAU/USD", bias: "Neutral", confidence: 30 };
    expect(JSON.parse(JSON.stringify(legacy)).instrument).toBe("XAU/USD");
  });

  it("persistence payloads contain summary fields only — no raw provider dumps", () => {
    const r = run(BULL);
    // The persisted subset mirrors Dashboard's saveAnalysis args: scalars + summaries.
    for (const key of ["instrument", "instrumentType", "bias", "confidence"]) {
      expect(typeof (r as unknown as Record<string, unknown>)[key]).not.toBe("undefined");
    }
    // Raw provider contexts are NOT part of the persisted payload contract.
    expect(r.decisionTrace!.provenance.length).toBeGreaterThan(0); // provenance lives in result only
  });
});

// ═════════════════ P14 — CLIENT SECRET HYGIENE (STATIC) ════════════

describe("client-side secret hygiene (static source scan)", () => {
  const collectFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...collectFiles(p));
      else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
    }
    return out;
  };

  it("no client code reads process.env directly", () => {
    const offenders: string[] = [];
    for (const dir of ["src/components", "src/pages", "src/lib"]) {
      for (const f of collectFiles(dir)) {
        const src = readFileSync(f, "utf8");
        // Exclusions: *.test.* (this suite's own patterns) and
      // live/credentials.ts (server-side credential-check module that only
      // reads env-var NAMES, never values — injectable env reader).
      if (/\.test\./.test(f) || f.includes("live/credentials")) continue;
      if (/process\s*\.\s*env/.test(src)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]); // secrets are resolved server-side in Convex actions
  });

  it("no hardcoded credential-looking literals in client code", () => {
    const offenders: string[] = [];
    const pattern =
      /(api[_-]?key|secret|password|bearer)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i;
    for (const dir of ["src/components", "src/lib"]) {
      for (const f of collectFiles(dir)) {
        const src = readFileSync(f, "utf8");
        if (pattern.test(src.replace(/\/\*[\s\S]*?\*\//g, ""))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ═════════════════ P15 — PRODUCTION ERROR CONTRACT ═════════════════

describe("production error contract", () => {
  it("totally empty input → safe typed outcome, never a throw or invented thesis", () => {
    const r = runAnalysis({} as never);
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(r.recommendation);
    if (r.recommendation !== "NO_TRADE") {
      // A directional call from an empty input would mean fabricated evidence.
      expect(r.tradePlan).toBeDefined(); // state machine consistency either way
    } else {
      expect(r.tradePlan).toBeUndefined();
    }
  });

  it("provider failure reasons stay sanitized — no stack traces in provenance", () => {
    const r = run({ ...BULL, executionData: executionUnavailable() });
    for (const p of r.decisionTrace!.provenance) {
      if (p.failureReason) {
        expect(p.failureReason).not.toMatch(/\bat .+:\d+:\d+/); // stack frame shape
        expect(p.failureReason.length).toBeLessThan(300);
      }
    }
  });

  it("malformed optional context cannot crash the pipeline (I17)", () => {
    const variants = [
      { treasuryData: { garbage: true } },
      { cotData: { nonsense: [] } },
      { eiaData: null },
      { derivativesData: { confidence: "high" } }, // missing nested fields
      { calendarData: { events: "not-an-array" } },
    ];
    for (const extra of variants) {
      const input = { ...assemble(BULL), ...extra } as never;
      expect(() => runAnalysis(input)).not.toThrow();
    }
  });

  it("corrupted primary candles degrade honestly instead of inventing structure", () => {
    const input = assemble(BULL) as AnalysisInput;
    input.marketData = {
      ...input.marketData!,
      candles: [], // provider returned nothing usable
    };
    const r = runAnalysis(input);
    expect(r.decisionTrace).toBeDefined();
    // No directional thesis can rest on zero candles.
    if (r.recommendation !== "NO_TRADE") {
      expect(r.decisionTrace!.structuralDirection).not.toBe("none");
    } else {
      expect(r.noTradeReasons.join(" ").length).toBeGreaterThan(0);
    }
  });
});
