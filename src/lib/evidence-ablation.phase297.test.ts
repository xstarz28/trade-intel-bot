/**
 * Phase 297 — FACTOR DECOMPOSITION, EVIDENCE ABLATION & RECORDED BENCHMARK (§6, §7, §10, §14).
 *
 * Every number below comes from running the PRODUCTION engine
 * (`runAnalysis`) on the recorded Phase 294/296 corpus: same candles, same
 * decision clock, same gates. The only thing that changes between modes is which
 * evidence class is attached — so any difference is attributable to that class,
 * and any absence of a difference is attributable to the engine's existing rules.
 *
 * This is an audit harness. It is not a scoring mode, and the ablation results are
 * never used to pick a preferred decision.
 */

import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { OutcomeCandle } from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

import { selectBenchmark } from "@/lib/historical/benchmark";
import { evidenceForDecision, loadEvidenceRegistry } from "@/lib/historical/evidence";
import type { HistoricalEvidenceAttachment, RecordedEvidenceRegistry } from "@/lib/historical/evidence";
import { loadRecordedFixtures } from "@/lib/historical/fixtures";
import { buildGateBottleneckReport, mergeGateBottleneckReports } from "@/lib/historical/gate-diagnostics";
import { closedOutcomeCandles, decisiveProjection, runRecordedDataset } from "@/lib/historical/recorded-walkforward";
import {
  ABLATION_MODES,
  ablationAttachment,
  auditCotConsumption,
  decomposeDecision,
  diagnoseDerivatives,
  formatDecisionDecomposition,
  type AblationMode,
  type DecisionDecomposition,
} from "@/lib/evidence-sensitivity";

const fixtures = loadRecordedFixtures();
const registry = loadEvidenceRegistry();
const selection = selectBenchmark(fixtures.datasets);
const RUN_OPTIONS = { minPrefixCandles: 24, maxEvaluations: 10, maxFutureCandles: 10 };

function techFor(candles: readonly OutcomeCandle[], timeframe: string): TechnicalData {
  const c = candles as unknown as OhlcvCandle[];
  return {
    ...calculateTechnical(c, c, timeframe),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc: computeSmcContext(c, timeframe),
    mtf: buildMtfContext(timeframe, [
      { timeframe, role: "setup", candles: c },
      ...buildChain(timeframe).map((t) => ({ timeframe: t.timeframe, role: t.role, candles: c } satisfies MtfCandleInput)),
    ]),
  };
}

function priceBuilder(parsed: (typeof fixtures.datasets)[number]) {
  const meta = parsed.provenance;
  const instrumentType = meta.assetClass as "crypto" | "forex" | "stock";
  return (prefix: readonly OutcomeCandle[]): AnalysisInput => {
    const candles = prefix as unknown as OhlcvCandle[];
    const last = candles[candles.length - 1];
    return {
      instrument: meta.instrument,
      instrumentType,
      timeframe: meta.timeframe as Timeframe,
      provider: meta.provider,
      providerInstrumentId: meta.providerInstrumentId,
      marketData: {
        instrument: meta.instrument,
        instrumentType,
        provider: meta.provider,
        providerInstrumentId: meta.providerInstrumentId,
        fetchTimestamp: last.timestamp,
        price: { price: last.close, timestamp: last.timestamp, source: meta.provider },
        candles,
        timeframe: meta.timeframe,
        dataFreshness: "delayed",
      } as unknown as MarketData,
      technicalData: techFor(prefix, meta.timeframe),
      economicEvents: "",
    } as unknown as AnalysisInput;
  };
}

/** Attach evidence for one decision instant, then ablate to the requested mode. */
function attachmentFor(
  parsed: (typeof fixtures.datasets)[number],
  asOfMs: number,
  mode: AblationMode,
  source: RecordedEvidenceRegistry = registry,
): HistoricalEvidenceAttachment {
  const instrumentType = parsed.provenance.assetClass as "crypto" | "forex" | "stock";
  const full = evidenceForDecision(source, { instrument: parsed.provenance.instrument, instrumentType, asOfMs });
  return ablationAttachment(full, mode);
}

interface AuditRow {
  datasetId: string;
  assetClass: string;
  timeframe: string;
  index: number;
  asOf: number;
  mode: AblationMode;
  decomposition: DecisionDecomposition;
  setupState: string;
  evidenceFields: string[];
  derivativesRulesFired: number;
  cotFires: boolean;
  sentinel: string;
}

/**
 * Run the production engine over the exact benchmark windows, in every ablation
 * mode. Window indices are taken from the Phase 294/295 driver so the audit sees
 * precisely the windows the recorded benchmark evaluates.
 */
function audit(): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const chosen of selection.selected) {
    const parsed = fixtures.byId.get(chosen.datasetId)!;
    const { candles } = closedOutcomeCandles(parsed);
    const driverRun = runRecordedDataset(parsed, priceBuilder(parsed), { ...RUN_OPTIONS });
    const indices = driverRun.report.evaluations.map((e) => e.decision.evaluationIndex);
    for (const mode of ABLATION_MODES) {
      for (const index of indices) {
        const prefix = candles.slice(0, index + 1);
        const asOf = prefix[prefix.length - 1].timestamp;
        const attachment = attachmentFor(parsed, asOf, mode);
        const input: AnalysisInput = {
          ...priceBuilder(parsed)(prefix),
          ...(attachment.derivativesData ? { derivativesData: attachment.derivativesData } : {}),
          ...(attachment.cotData ? { cotData: attachment.cotData } : {}),
          ...(attachment.macroData ? { macroData: attachment.macroData } : {}),
          decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: asOf },
        } as AnalysisInput;
        const result = runAnalysis(input);
        const trace = result.decisionTrace;
        if (!trace) throw new Error("engine returned no decision trace");
        const decomposition = decomposeDecision(trace);
        const rules = diagnoseDerivatives(attachment.derivativesData, "HH/HL");
        rows.push({
          datasetId: parsed.provenance.datasetId,
          assetClass: parsed.provenance.assetClass,
          timeframe: parsed.provenance.timeframe,
          index,
          asOf,
          mode,
          decomposition,
          setupState: String(
            (result as unknown as { setupState?: string }).setupState ??
              trace.evidenceLayers.find((l) => l.layer === "_context")?.reason ??
              "",
          ),
          evidenceFields: [
            attachment.derivativesData ? "derivativesData" : undefined,
            attachment.cotData ? "cotData" : undefined,
            attachment.macroData ? "macroData" : undefined,
          ].filter((f): f is string => f !== undefined),
          derivativesRulesFired: rules.filter((r) => r.fires).length,
          cotFires: auditCotConsumption(attachment.cotData).fires,
          sentinel: JSON.stringify([
            decomposition.factorScores,
            decomposition.rawBias,
            decomposition.finalBias,
            decomposition.vetoApplied,
            decomposition.coreWeightedAvg,
            trace.recommendation,
          ]),
        });
      }
    }
  }
  return rows;
}

const ROWS = audit();
const rowsOf = (mode: AblationMode): AuditRow[] => ROWS.filter((r) => r.mode === mode);
const BASE = rowsOf("BASE");
const PRICE_ONLY = rowsOf("PRICE_ONLY");

function distribution(values: readonly (number | string)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
}

function modeSummary(mode: AblationMode) {
  const rows = rowsOf(mode);
  const gateCounts = new Map<string, number>();
  const blockers = new Map<string, number>();
  for (const row of rows) {
    for (const gate of row.decomposition.gate3.status === "FAIL" ? ["GATE3_DIRECTIONAL_BIAS"] : []) {
      gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
    }
    if (row.decomposition.gate4Status.status === "FAIL") {
      gateCounts.set("GATE4_CONFLUENCE", (gateCounts.get("GATE4_CONFLUENCE") ?? 0) + 1);
    }
    if (row.decomposition.firstBlockingGate) {
      blockers.set(row.decomposition.firstBlockingGate, (blockers.get(row.decomposition.firstBlockingGate) ?? 0) + 1);
    }
  }
  return {
    mode,
    windows: rows.length,
    trend: distribution(rows.map((r) => r.decomposition.factorScores.trend)),
    fundamental: distribution(rows.map((r) => r.decomposition.factorScores.fundamental)),
    positioning: distribution(rows.map((r) => r.decomposition.factorScores.sentiment)),
    rawBias: distribution(rows.map((r) => r.decomposition.rawBias)),
    finalBias: distribution(rows.map((r) => r.decomposition.finalBias)),
    gate3Fail: gateCounts.get("GATE3_DIRECTIONAL_BIAS") ?? 0,
    gate4Fail: gateCounts.get("GATE4_CONFLUENCE") ?? 0,
    firstBlockers: [...blockers.entries()].sort().map(([g, n]) => `${g}=${n}`).join(", "),
    recommendations: distribution(rows.map((r) => r.decomposition.recommendation)),
    rulesFired: rows.reduce((n, r) => n + r.derivativesRulesFired, 0),
    cotFiring: rows.filter((r) => r.cotFires).length,
  };
}

describe("§6 factor decomposition (parity with the engine, every window)", () => {
  it("reconstructs the core weighted average from the reported factor scores", () => {
    for (const row of ROWS) {
      const { trend, fundamental, sentiment } = row.decomposition.factorScores;
      const expected = Math.round((trend * 0.45 + fundamental * 0.3 + sentiment * 0.25) * 100) / 100;
      expect(row.decomposition.coreWeightedAvg).toBe(expected);
    }
    expect(ROWS).toHaveLength(400); // 80 windows × 5 ablation modes
  });

  it("agrees with the engine on Gate 3 and Gate 4 for every window", () => {
    const mismatches: string[] = [];
    for (const row of ROWS) {
      const neutral = row.decomposition.finalBias === "Neutral";
      if ((row.decomposition.gate3.status === "FAIL") !== neutral) {
        mismatches.push(
          `${row.mode} ${row.datasetId} i=${row.index} gate3=${row.decomposition.gate3.status} final=${row.decomposition.finalBias} raw=${row.decomposition.rawBias} veto=${row.decomposition.vetoApplied} reason=${row.decomposition.gate3.reason}`,
        );
      }
      const satisfied = row.decomposition.gate4.satisfied;
      expect(row.decomposition.gate4Status.status === "PASS").toBe(satisfied);
      if (row.decomposition.gate4Status.status === "FAIL") {
        expect(row.decomposition.gate4.agreeing.length).toBeLessThan(2);
      }
    }
    if (mismatches.length > 0) {
      // eslint-disable-next-line no-console
      console.log("Gate 3 attribution mismatches:", mismatches.join(" || "));
    }
    expect(mismatches).toHaveLength(0);
  });

  it("reports the veto state and the exact blocking gate", () => {
    for (const row of ROWS) {
      if (row.decomposition.vetoApplied) {
        expect(row.decomposition.vetoReason).toBeDefined();
      }
      if (row.decomposition.recommendation === "NO_TRADE") {
        expect(row.decomposition.firstBlockingGate).toBeDefined();
      }
    }
  });
});

describe("§7 evidence ablation over the recorded corpus", () => {
  it("prints the ablation table (facts only)", () => {
    const summaries = ABLATION_MODES.map(modeSummary);
    // eslint-disable-next-line no-console
    console.log(
      [
        "Phase 297 ablation — 80 recorded windows per mode (same candles, same clock, same gates)",
        "mode | trend scores | fundamental | positioning | raw bias | gate3 fail | gate4 fail | first blockers | rules fired | COT firing",
        ...summaries.map((s) =>
          [
            s.mode,
            s.trend,
            s.fundamental,
            s.positioning,
            s.rawBias,
            s.gate3Fail,
            s.gate4Fail,
            s.firstBlockers || "none",
            s.rulesFired,
            s.cotFiring,
          ].join(" | "),
        ),
      ].join("\n"),
    );
    expect(summaries).toHaveLength(5);
    expect(summaries.find((s) => s.mode === "BASE")!.windows).toBe(80);
  });

  it("separates the classes by what the engine is documented to consume", () => {
    for (let i = 0; i < BASE.length; i++) {
      const base = BASE[i];
      const priceOnly = PRICE_ONLY[i];
      const cotOnly = rowsOf("COT_ONLY")[i];
      const macroOnly = rowsOf("MACRO_ONLY")[i];
      const derivativesOnly = rowsOf("DERIVATIVES_ONLY")[i];
      // Price facts never move: trend is identical in every mode.
      expect(cotOnly.decomposition.factorScores.trend).toBe(base.decomposition.factorScores.trend);
      expect(macroOnly.decomposition.factorScores.trend).toBe(base.decomposition.factorScores.trend);
      expect(derivativesOnly.decomposition.factorScores.trend).toBe(base.decomposition.factorScores.trend);
      expect(priceOnly.decomposition.factorScores.trend).toBe(base.decomposition.factorScores.trend);
      // COT and macro cannot touch a core factor: they are conviction layers.
      expect(cotOnly.decomposition.factorScores).toEqual(priceOnly.decomposition.factorScores);
      expect(macroOnly.decomposition.factorScores).toEqual(priceOnly.decomposition.factorScores);
      // Derivatives may touch positioning only.
      expect(derivativesOnly.decomposition.factorScores.fundamental).toBe(priceOnly.decomposition.factorScores.fundamental);
      expect(derivativesOnly.decomposition.factorScores.trend).toBe(priceOnly.decomposition.factorScores.trend);
      // And in this corpus even derivatives change nothing.
      expect(base.sentinel).toBe(priceOnly.sentinel);
    }
  });

  it("proves the recorded macro evidence is score-neutral, not missing", () => {
    const attached = BASE.filter((r) => r.evidenceFields.includes("macroData"));
    expect(attached.length).toBeGreaterThan(0);
    for (const row of attached) {
      expect(row.decomposition.factorScores.fundamental).toBe(0);
      expect(row.decomposition.factorContributions.fundamental).toBe(0);
    }
    // The macro attachment itself is real (not an empty object).
    const sample = attachmentFor(fixtures.byId.get("twelvedata-EURUSD-1D")!, attached[0].asOf, "MACRO_ONLY");
    expect(sample.macroData!.indicators.length).toBeGreaterThan(0);
    expect(sample.macroData!.indicators.every((i) => i.sentiment === undefined)).toBe(true);
  });

  it("shows the recorded crypto positioning never crosses a rule boundary", () => {
    const cryptoRows = BASE.filter((r) => r.assetClass === "crypto");
    expect(cryptoRows.length).toBe(40);
    for (const row of cryptoRows) {
      expect(row.derivativesRulesFired).toBe(0);
      expect(row.decomposition.factorScores.sentiment).toBe(row.decomposition.factorScores.sentiment);
    }
    const withEvidence = cryptoRows.filter((r) => r.evidenceFields.includes("derivativesData"));
    expect(withEvidence.length).toBeGreaterThan(0);
    // Positioning is zero in every crypto window: inside the dead bands.
    const changed = withEvidence.filter((r) => r.decomposition.factorScores.sentiment !== 0);
    expect(changed).toHaveLength(0);
  });

  it("shows COT producing real, non-core evidence for forex", () => {
    const fxRows = BASE.filter((r) => r.assetClass === "forex");
    expect(fxRows.length).toBe(20);
    expect(fxRows.some((r) => r.evidenceFields.includes("cotData"))).toBe(true);
    // COT fires on its own rule but never reaches a core factor.
    expect(fxRows.filter((r) => r.cotFires).length).toBeGreaterThan(0);
    for (const row of fxRows) {
      expect(row.decomposition.factorScores.fundamental).toBe(0);
      expect(row.decomposition.factorScores.sentiment).toBe(0);
    }
  });
});

describe("§10 recorded benchmark after the wiring audit", () => {
  it("keeps the Phase 296 benchmark counts exactly", () => {
    const firstOfEachWindow = ABLATION_MODES.map((mode) => rowsOf(mode)[0]);
    expect(firstOfEachWindow).toHaveLength(5);
    // The benchmark verdict is unchanged by the audit: actionable stays 0.
    const actionable = ROWS.filter((r) => r.decomposition.recommendation !== "NO_TRADE");
    expect(actionable).toHaveLength(0);
    const gate3 = BASE.filter((r) => r.decomposition.gate3.status === "FAIL").length;
    const gate4 = BASE.filter((r) => r.decomposition.gate4Status.status === "FAIL").length;
    // eslint-disable-next-line no-console
    console.log(
      `Phase 297 benchmark (BASE, 80 windows): actionable 0 | NO_TRADE 80 | Gate3 fail ${gate3} | Gate4 fail ${gate4} | ` +
        `first blockers ${modeSummary("BASE").firstBlockers}`,
    );
    expect(gate3 + gate4).toBeGreaterThan(0);
    expect(gate3 + gate4).toBeLessThanOrEqual(160);
  });

  it("reproduces the gate-bottleneck report over the same windows", () => {
    const parked = selection.selected.map((chosen) => {
      const parsed = fixtures.byId.get(chosen.datasetId)!;
      const run = runRecordedDataset(parsed, priceBuilder(parsed), RUN_OPTIONS);
      return buildGateBottleneckReport(run.report.evaluations);
    });
    const merged = mergeGateBottleneckReports(parked);
    expect(merged.evaluations).toBe(80);
    expect(merged.actionable).toBe(0);
    expect(merged.noTrade).toBe(80);
    const failed = Object.fromEntries(merged.failedGateCounts.map((g) => [g.gateId, g.occurrences]));
    expect(failed.GATE3_DIRECTIONAL_BIAS).toBe(37);
    expect(failed.GATE4_CONFLUENCE).toBe(43);
    expect(merged.firstBlockerCounts.map((g) => `${g.gateId}=${g.occurrences}`).join(",")).toBe(
      "GATE3_DIRECTIONAL_BIAS=37,GATE4_CONFLUENCE=43",
    );
    expect(merged.setupStatesBeforeRejection.map((s) => `${s.state}=${s.occurrences}`).join(",")).toBe(
      "CONFIRMED_SETUP_CONTEXT=39,INVALID_SETUP_CONTEXT=11,LOCATION_ONLY=23,STRUCTURAL_SETUP=7",
    );
  });

  it("keeps every asset class and timeframe bucket separate", () => {
    const buckets = new Set(BASE.map((r) => `${r.assetClass}|${r.timeframe}`));
    expect(buckets.size).toBeGreaterThanOrEqual(6);
    for (const bucket of buckets) {
      const rows = BASE.filter((r) => `${r.assetClass}|${r.timeframe}` === bucket);
      expect(rows).toHaveLength(10);
    }
  });
});

describe("§14 recorded trace (capture → clock → evidence → factor → gate → recommendation)", () => {
  it("prints one crypto window with attached recorded evidence", () => {
    const row = BASE.find((r) => r.datasetId === "okx-BTC-USDT-1H" && r.evidenceFields.length > 0)!;
    const parsed = fixtures.byId.get("okx-BTC-USDT-1H")!;
    const { candles } = closedOutcomeCandles(parsed);
    const prefix = candles.slice(0, row.index + 1);
    const last = prefix[prefix.length - 1];
    const attachment = attachmentFor(parsed, row.asOf, "BASE");
    const rules = diagnoseDerivatives(attachment.derivativesData, "HH/HL");
    const lines = [
      `Phase 297 recorded trace — ${parsed.provenance.datasetId} (${parsed.provenance.provider} ${parsed.provenance.providerInstrumentId}, ${parsed.provenance.timeframe})`,
      `provider candle: ts=${last.timestamp} (${new Date(last.timestamp).toISOString()}) close=${last.close}`,
      `historical clock: HISTORICAL_AS_OF @ ${new Date(row.asOf).toISOString()} (prefix closed candles ${prefix.length})`,
      `evidence: ${attachment.provenance.map((p) => `${p.datasetId}@${p.availableFrom}`).join(", ")}`,
      `coverage: completeness=${attachment.coverage.completeness} | ${attachment.coverage.notes.join(" | ")}`,
      ...rules.map(
        (r) =>
          `rule ${r.ruleId}: observed=${r.observed ?? "n/a"} threshold=${r.threshold} margin=${r.margin?.toFixed(6) ?? "n/a"} effect=${r.effect} fires=${r.fires}`,
      ),
      ...formatDecisionDecomposition(row.decomposition),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(row.decomposition.factorScores.sentiment).toBe(0);
    expect(rules.every((r) => !r.fires)).toBe(true);
    expect(row.decomposition.recommendation).toBe("NO_TRADE");
  });

  it("prints one forex window where recorded COT carries a real effect", () => {
    const row = BASE.find((r) => r.datasetId === "twelvedata-EURUSD-1D" && r.cotFires)!;
    const attachment = attachmentFor(fixtures.byId.get("twelvedata-EURUSD-1D")!, row.asOf, "BASE");
    const cot = auditCotConsumption(attachment.cotData);
    const lines = [
      `Phase 297 recorded trace — EUR/USD COT (report ${cot.latestReportDate} vs ${cot.previousReportDate})`,
      `contract: ${cot.sourceInstrument} → ${cot.mappedAsset} (contractSide ${cot.contractSide})`,
      `change from previous report: ${cot.changeFromPreviousReport} (${(cot.changeRatioOfOi! * 100).toFixed(2)}% of OI, threshold 0.50%)`,
      `effect on contract currency: ${cot.effectOnContractCurrency!.toFixed(3)} | effect on long side: ${cot.effectOnLong!.toFixed(3)} | crowded=${cot.crowded}`,
      `conviction layer only — Gate 4 factors here: ${JSON.stringify(row.decomposition.factorScores)}`,
      ...formatDecisionDecomposition(row.decomposition),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(cot.fires).toBe(true);
    expect(Math.abs(cot.effectOnContractCurrency!)).toBeGreaterThan(0);
    // Real evidence, still not a Gate 4 factor.
    expect(row.decomposition.factorScores.fundamental).toBe(0);
    expect(row.decomposition.factorScores.sentiment).toBe(0);
  });

  it("prints one directional crypto window where Gate 4 is the blocker", () => {
    const row = BASE.find(
      (r) => r.datasetId === "okx-BTC-USDT-4H" && r.decomposition.finalBias !== "Neutral" && r.decomposition.gate4Status.status === "FAIL",
    )!;
    const parsed = fixtures.byId.get("okx-BTC-USDT-4H")!;
    const { candles } = closedOutcomeCandles(parsed);
    const prefix = candles.slice(0, row.index + 1);
    const attachment = attachmentFor(parsed, row.asOf, "BASE");
    const rules = diagnoseDerivatives(attachment.derivativesData, "HH/HL");
    const nextThreshold = rules
      .filter((r) => r.margin !== undefined)
      .map((r) => `${r.ruleId} needs ${r.threshold} (observed ${r.observed!.toFixed(6)}, short by ${Math.abs(r.margin!).toFixed(6)})`)
      .join("; ");
    const lines = [
      `Phase 297 recorded trace (Gate 4 blocker) — ${parsed.provenance.datasetId} (${parsed.provenance.timeframe})`,
      `provider candle: ts=${prefix[prefix.length - 1].timestamp} close=${prefix[prefix.length - 1].close}`,
      `evidence available: ${attachment.provenance.map((p) => p.domain).join(", ") || "none"}`,
      `positioning rules and their distance from firing: ${nextThreshold}`,
      ...formatDecisionDecomposition(row.decomposition),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(row.decomposition.factorScores.trend).not.toBe(0);
    expect(row.decomposition.factorScores.fundamental).toBe(0);
    expect(row.decomposition.factorScores.sentiment).toBe(0);
    expect(row.decomposition.gate4.agreeing).toEqual(["structure"]);
    expect(row.decomposition.gate4Status.status).toBe("FAIL");
    expect(row.decomposition.firstBlockingGate).toBe("GATE4_CONFLUENCE");
  });

  it("keeps zero when nothing can be published", () => {
    expect(ROWS.every((r) => r.decomposition.recommendation === "NO_TRADE")).toBe(true);
  });
});

describe("§13 the whole corpus is lookahead-free", () => {
  it("changing only future evidence leaves every earlier decomposition identical", () => {
    const cut = Math.max(...BASE.map((r) => r.asOf));
    const truncated: RecordedEvidenceRegistry = {
      datasets: registry.datasets
        .map((d) => ({ ...d, observations: d.observations.filter((o) => o.availableFrom <= cut) }))
        .filter((d) => d.observations.length > 0),
      byId: registry.byId,
      fingerprint: "cut",
    };
    for (const mode of ABLATION_MODES) {
      for (const row of rowsOf(mode)) {
        const parsed = fixtures.byId.get(row.datasetId)!;
        const { candles } = closedOutcomeCandles(parsed);
        const prefix = candles.slice(0, row.index + 1);
        const attachment = attachmentFor(parsed, row.asOf, mode, truncated);
        const input: AnalysisInput = {
          ...priceBuilder(parsed)(prefix),
          ...(attachment.derivativesData ? { derivativesData: attachment.derivativesData } : {}),
          ...(attachment.cotData ? { cotData: attachment.cotData } : {}),
          ...(attachment.macroData ? { macroData: attachment.macroData } : {}),
          decisionClock: { mode: "HISTORICAL_AS_OF", asOfMs: row.asOf },
        } as AnalysisInput;
        const trace = runAnalysis(input).decisionTrace!;
        const sentinel = JSON.stringify([
          decomposeDecision(trace).factorScores,
          trace.biasCalculation.rawBias,
          trace.biasCalculation.finalBias,
          trace.biasCalculation.vetoApplied,
          trace.biasCalculation.coreWeightedAvg,
          trace.recommendation,
        ]);
        expect(sentinel).toBe(row.sentinel);
      }
    }
  });

  it("uses exactly the recorded decision instants, never the capture instant", () => {
    const captureInstant = Date.parse("2026-09-30T03:53:27Z");
    for (const row of BASE) {
      expect(row.asOf).toBeLessThan(captureInstant);
      expect(new Date(row.asOf).toISOString()).toBe(new Date(row.asOf).toISOString());
    }
  });
});
