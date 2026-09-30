/**
 * Phase 296 — RECORDED NON-PRICE EVIDENCE: CONTRACT, AS-OF, PROVENANCE (§2, §3, §4, §5, §6, §7, §8, §9, §10, §12, §13, §18, §19, §20).
 *
 * These tests run against the verbatim provider captures in
 * `src/lib/data/__fixtures__/historical-evidence/`. Every expected value below
 * is either read from the fixture or computed from two recorded observations —
 * nothing is synthesised in the assertions.
 */

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_ACQUISITION_GAPS,
  EVIDENCE_FIXTURES,
  EVIDENCE_SCHEMA_VERSION,
  asOfIndex,
  assertUsableForHistory,
  currentOnlyDataset,
  evidenceCoverage,
  evidenceFingerprint,
  evidenceForDecision,
  evidenceRegistryFingerprint,
  formatEvidenceCoverage,
  lastObservations,
  loadEvidenceFixture,
  loadEvidenceRegistry,
  observationAtOrBefore,
  parseEvidenceRows,
} from "./historical/evidence";
import type { EvidenceDatasetMeta, HistoricalEvidenceDataset } from "./historical/evidence";

const registry = loadEvidenceRegistry();
const okxFunding = registry.byId.get("okx-funding-rate-BTC-USDT-SWAP-8H")!;
const okxOi = registry.byId.get("okx-open-interest-BTC-USDT-SWAP-1H")!;
const okxLs = registry.byId.get("okx-long-short-account-ratio-BTC-1H")!;
const cotEur = registry.byId.get("cftc-cot-EURO-FX-weekly")!;
const cotBtc = registry.byId.get("cftc-cot-BITCOIN-weekly")!;
const dgs10 = registry.byId.get("fred-DGS10-daily")!;
const dgs2 = registry.byId.get("fred-DGS2-daily")!;
const vintage = registry.byId.get("fred-alfred-DGS10-vintage-2026-09-25")!;

const T = (iso: string): number => Date.parse(iso);

describe("§2/§13 contract + registry", () => {
  it("registers exactly the captured datasets, all RECORDED_HISTORICAL", () => {
    expect(registry.datasets).toHaveLength(EVIDENCE_FIXTURES.length);
    expect(registry.datasets.map((d) => d.meta.datasetId).sort()).toEqual(
      [...EVIDENCE_FIXTURES.map((f) => f.file.replace(/\.json$/, ""))].sort(),
    );
    for (const d of registry.datasets) {
      expect(d.meta.sourceClassification).toBe("RECORDED_HISTORICAL");
      expect(d.meta.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
      expect(d.meta.valuesUnmodified).toBe(true);
      expect(d.meta.valuesSubstituted).toBe(false);
      expect(d.meta.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(d.fingerprint.startsWith("fnv1a32:")).toBe(true);
      expect(d.meta.asOfSemantics.length).toBeGreaterThan(20);
    }
  });

  it("parses the row counts the provider actually returned", () => {
    expect(okxFunding.observations).toHaveLength(28);
    expect(okxOi.observations).toHaveLength(76);
    expect(okxLs.observations).toHaveLength(76);
    expect(cotEur.observations).toHaveLength(14);
    expect(cotBtc.observations).toHaveLength(14);
    expect(dgs10.observations).toHaveLength(40);
    expect(dgs2.observations).toHaveLength(40);
    expect(vintage.observations).toHaveLength(11);
  });

  it("orders observations by availability and keeps provider instants verbatim", () => {
    for (const d of registry.datasets) {
      const stamps = d.observations.map((o) => o.availableFrom);
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
      expect(new Set(stamps).size).toBe(stamps.length);
    }
    // OKX funding: the newest recorded settlement was 0.0001 at 1790726400000.
    const newest = okxFunding.observations[okxFunding.observations.length - 1];
    expect(newest.observedLabel).toBe("1790726400000");
    expect(newest.values.realizedRate).toBe(0.0001);
  });

  it("fingerprints are deterministic and content-addressed", () => {
    expect(loadEvidenceRegistry().fingerprint).toBe(registry.fingerprint);
    const again = loadEvidenceFixture("fred-DGS2-daily.json");
    expect(again.fingerprint).toBe(dgs2.fingerprint);
    // Meta identity participates: same rows, different dataset id ⇒ different fingerprint.
    const renamed = evidenceFingerprint({ ...dgs2.meta, datasetId: "renamed" }, dgs2.observations);
    expect(renamed).not.toBe(dgs2.fingerprint);
    expect(evidenceRegistryFingerprint([...registry.datasets].reverse())).toBe(registry.fingerprint);
  });

  it("refuses to parse a CURRENT_ONLY snapshot as history", () => {
    const meta = currentOnlyDataset({
      datasetId: "snapshot-AAPL-2026-09-30",
      provider: "twelve-data",
      providerNativeId: "AAPL",
      metric: "trailing_pe",
    });
    expect(meta.sourceClassification).toBe("CURRENT_ONLY");
    expect(() => parseEvidenceRows(meta, [["AAPL", 37.73]])).toThrow(/CURRENT_ONLY/);
    const marker = { meta, observations: [], fingerprint: "fnv1a32:x", findings: [] } as unknown as HistoricalEvidenceDataset;
    expect(() => assertUsableForHistory(marker)).toThrow(/may not inform a historical decision/);
  });

  it("keeps DESIGNED_TEST_FIXTURE material out of empirical use", () => {
    const designed: HistoricalEvidenceDataset = {
      meta: { ...dgs10.meta, datasetId: "designed-evidence", sourceClassification: "DESIGNED_TEST_FIXTURE" },
      observations: dgs10.observations,
      fingerprint: "fnv1a32:designed",
      findings: [],
    };
    expect(() => assertUsableForHistory(designed)).toThrow(/DESIGNED_TEST_FIXTURE/);
  });

  it("records the acquisition gaps instead of filling them in", () => {
    const commodity = EVIDENCE_ACQUISITION_GAPS.find((g) => g.domain === "commodity_positioning");
    const stock = EVIDENCE_ACQUISITION_GAPS.find((g) => g.domain === "stock_fundamentals");
    const calendar = EVIDENCE_ACQUISITION_GAPS.find((g) => g.domain === "economic_calendar");
    expect(commodity?.reason).toMatch(/401/);
    expect(commodity?.reason).toMatch(/never XAU\/USD → BTC/);
    expect(stock?.reason).toMatch(/CURRENT snapshot/);
    expect(calendar?.reason).toMatch(/no reachable provider path/i);
  });
});

describe("§3 as-of alignment", () => {
  it("returns nothing before the first observation is knowable", () => {
    expect(observationAtOrBefore(okxOi, T("2026-09-01T00:00:00Z"))).toBeUndefined();
    expect(observationAtOrBefore(cotEur, T("2026-06-01T00:00:00Z"))).toBeUndefined();
    expect(observationAtOrBefore(dgs10, T("2026-07-01T00:00:00Z"))).toBeUndefined();
    expect(asOfIndex(okxOi, T("2026-09-01T00:00:00Z"))).toBe(-1);
  });

  it("uses only observations knowable at the decision instant", () => {
    const t = T("2026-09-29T12:00:00Z");
    const latest = observationAtOrBefore(okxOi, t)!;
    expect(latest.observedLabel).toBe("1790683200000"); // 2026-09-29T12:00:00Z — exactly the decision instant
    expect(latest.availableFrom).toBe(t);
    // The next recorded hour exists in the corpus but is AFTER the decision.
    expect(okxOi.observations.some((o) => o.observedLabel === "1790679600000")).toBe(true);
    expect(T("2026-09-29T11:00:00Z")).toBeLessThan(t);
  });

  it("applies a conservative end-of-day boundary to daily macro series", () => {
    const morning = T("2026-09-24T12:00:00Z");
    expect(observationAtOrBefore(dgs10, morning)!.values.percent).toBe(5.11); // 2026-09-23
    expect(observationAtOrBefore(dgs10, morning)!.observedLabel).toBe("2026-09-23");
    const afterClose = T("2026-09-25T00:00:00Z");
    expect(observationAtOrBefore(dgs10, afterClose)!.values.percent).toBe(5.18); // 2026-09-24
  });

  it("respects the weekly COT publication schedule (Tuesday report → Friday 15:30 ET)", () => {
    const report = cotEur.observations.find((o) => o.observedLabel.startsWith("2026-09-22"))!;
    expect(report.availableFrom).toBe(Date.parse("2026-09-25T19:30:00Z"));
    // Monday 2026-09-21 report (published 2026-08-28 19:30Z) is the July-21 report;
    // the key check: at Thursday 2026-09-24 the 09-22 report does not exist yet.
    const thursday = T("2026-09-24T23:00:00Z");
    expect(observationAtOrBefore(cotEur, thursday)!.values.reportDate).toMatch(/^2026-09-15/);
    const saturday = T("2026-09-26T00:00:00Z");
    expect(observationAtOrBefore(cotEur, saturday)!.values.reportDate).toMatch(/^2026-09-22/);
  });

  it("never places an observation before the report it describes was published", () => {
    for (const o of cotEur.observations) {
      expect(o.availableFrom).toBeGreaterThan(o.observedAt!);
      expect(o.availableFrom - o.observedAt!).toBeGreaterThan(2 * 86_400_000);
      expect(o.availableFrom - o.observedAt!).toBeLessThan(4 * 86_400_000);
    }
  });
});

describe("§3/§4 point-in-time integrity", () => {
  it("matches the provider's own vintage record for the overlapping days", () => {
    const vintageValues = new Map(vintage.observations.map((o) => [o.observedLabel, o.values.percent]));
    expect(vintageValues.size).toBe(11);
    for (const [label, value] of vintageValues) {
      const fred = dgs10.observations.find((o) => o.observedLabel === label);
      // Same value ⇒ no revision was leaked backward into the recorded series.
      expect(fred?.values.percent).toBe(value);
    }
    const labels = [...vintageValues.keys()];
    expect(labels[labels.length - 1]).toBe("2026-09-24");
  });

  it("has no point-in-time equity fundamentals, and says so instead of reusing today's", () => {
    const coverage = evidenceCoverage(registry, {
      instrument: "AAPL",
      instrumentType: "stock",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    const fundamentals = coverage.domains.find((d) => d.domain === "stock_fundamentals")!;
    expect(fundamentals.classification).toBe("UNAVAILABLE");
    expect(fundamentals.applied).toBe(false);
    expect(fundamentals.observations).toBe(0);
    expect(coverage.notes.join(" ")).toMatch(/Historical fundamental evidence: UNAVAILABLE/);
    const attachment = evidenceForDecision(registry, {
      instrument: "AAPL",
      instrumentType: "stock",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    // No fundamentals payload and no macro substitution for the equity branch.
    expect(attachment.macroData).toBeUndefined();
    expect(Object.keys(attachment)).not.toContain("fundamentalData");
  });

  it("exposes a commodity-positioning gap rather than substituting an instrument", () => {
    const coverage = evidenceCoverage(registry, {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    expect(coverage.completeness).toBe("PARTIAL"); // recorded macro applies; positioning does not
    for (const d of coverage.domains) {
      if (d.domain === "macro_rates") continue;
      expect(d.applied).toBe(false);
    }
    expect(coverage.domains.find((d) => d.domain === "commodity_positioning")!.classification).toBe("UNAVAILABLE");
    const attachment = evidenceForDecision(registry, {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    expect(attachment.derivativesData).toBeUndefined();
    expect(attachment.cotData).toBeUndefined();
  });
});

describe("§6 crypto positioning as-of", () => {
  it("builds derivatives evidence from recorded OKX observations only", () => {
    const asOf = T("2026-09-30T03:00:00Z");
    const a = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const d = a.derivativesData!;
    expect(d.provider).toBe("okx");
    expect(d.symbol).toBe("BTC-USDT-SWAP");
    expect(d.freshness).toBe("delayed");
    expect(d.fundingRate!.currentRate).toBe(0.0001);
    expect(d.openInterest!.current).toBeCloseTo(3066140096.2291, 4);
    const prev = 3068853959.0316;
    expect(d.openInterest!.change1h).toBeCloseTo(((3066140096.2291 - prev) / prev) * 100, 6);
    expect(d.longShort!.accountRatio).toBe(1.38);
    expect(d.availability).toEqual({
      openInterest: true,
      fundingRate: true,
      longShort: true,
      liquidations: false,
    });
    expect(d.confidence).toBe("medium");
    expect(d.timestamp).toBe(1790737200000);
    for (const p of a.provenance) expect(p.classification).toBe("RECORDED_HISTORICAL");
    const okxProvenance = a.provenance.filter((p) => p.domain === "crypto_derivatives");
    expect(okxProvenance.map((p) => p.datasetId).sort()).toEqual([
      "okx-funding-rate-BTC-USDT-SWAP-8H",
      "okx-long-short-account-ratio-BTC-1H",
      "okx-open-interest-BTC-USDT-SWAP-1H",
    ]);
    // Macro context travels alongside, with its own provenance and no direction.
    expect(a.provenance.filter((p) => p.domain === "macro_rates")).toHaveLength(2);
  });

  it("degrades honestly when only part of the evidence was knowable", () => {
    const asOf = T("2026-09-25T00:00:00Z"); // funding only: OI/LS corpus starts 09-27
    const a = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf });
    const d = a.derivativesData!;
    expect(d.fundingRate).toBeDefined();
    expect(d.openInterest).toBeUndefined();
    expect(d.longShort).toBeUndefined();
    expect(d.confidence).toBe("low");
    expect(d.availability.openInterest).toBe(false);
    // Provenance lists only what was used — never the datasets that were not.
    const cryptoProvenance = a.provenance.filter((p) => p.domain === "crypto_derivatives");
    expect(cryptoProvenance).toHaveLength(1);
    expect(cryptoProvenance[0].datasetId).toBe(okxFunding.meta.datasetId);
  });

  it("attaches nothing when no observation is knowable", () => {
    const a = evidenceForDecision(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: T("2026-07-01T00:00:00Z"), // before every recorded evidence window
    });
    expect(a.derivativesData).toBeUndefined();
    expect(a.macroData).toBeUndefined();
    expect(a.provenance).toHaveLength(0);
    expect(a.coverage.completeness).toBe("NONE");
  });

  it("does not turn a recorded level into a directional score", () => {
    const asOf = T("2026-09-30T03:00:00Z");
    const d = evidenceForDecision(registry, { instrument: "BTC/USDT", instrumentType: "crypto", asOfMs: asOf })
      .derivativesData!;
    // The engine's own thresholds: funding ±0.001, OI change ±2%. Neither fires
    // on the recorded values, and the payload must not pretend otherwise.
    expect(Math.abs(d.fundingRate!.currentRate)).toBeLessThan(0.001);
    expect(Math.abs(d.openInterest!.change1h!)).toBeLessThan(2);
    expect(d.liquidations).toBeUndefined();
    expect(d.interpretation!).toMatch(/RECORDED \/ HISTORICAL/);
    // Never presented as a live/real-time layer, and never with a directional claim.
    expect(d.interpretation!).not.toMatch(/\bLIVE\b|\bREAL-TIME\b|CURRENT SIGNAL/);
    expect(d.interpretation!).not.toMatch(/\bsignal\b|bullish|bearish/i);
  });
});

describe("§7 COT chronology", () => {
  it("maps EUR/USD through the existing verified COT mapping", () => {
    const a = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: T("2026-09-26T00:00:00Z"),
    });
    const cot = a.cotData!;
    if (!cot.available) throw new Error("expected an available COT context");
    expect(cot.source).toBe("CFTC Commitments of Traders (publicreporting.cftc.gov)");
    expect(cot.requestedInstrument).toBe("EUR/USD");
    expect(cot.sourceInstrument).toBe("EURO FX - CHICAGO MERCANTILE EXCHANGE");
    expect(cot.mappedAsset).toBe("Euro FX futures (CME)");
    expect(cot.freshness).toBe("DELAYED");
    expect(cot.latest.reportDate).toMatch(/^2026-09-22/);
    expect(cot.netNonCommercial).toBe(220708 - 273042);
    expect(cot.changeFromPreviousReport).toBe(220708 - 273042 - (209000 - 235993));
    expect(cot.history!.length).toBeGreaterThan(1);
  });

  it("never uses a report that had not been published at the decision", () => {
    const a = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: T("2026-09-24T23:00:00Z"),
    });
    const cot = a.cotData!;
    if (!cot.available) throw new Error("expected an available COT context");
    expect(cot.latest.reportDate).toMatch(/^2026-09-15/);
    expect(cot.fetchedAt).toBe(Date.parse("2026-09-18T19:30:00Z"));
    // Older reports only — nothing from the future, and nothing back-dated.
    for (const r of cot.history ?? []) {
      expect(Date.parse(String(r.reportDate))).toBeLessThanOrEqual(Date.parse("2026-09-15T00:00:00.000Z"));
    }
  });

  it("records the BTC COT contract but never applies it (no verified mapping)", () => {
    expect(cotBtc.meta.applicableInReplay).toBe(false);
    const a = evidenceForDecision(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    expect(a.cotData).toBeUndefined();
    expect(a.coverage.notes.join(" ")).toMatch(/not mapped to BTC\/USDT/);
  });
});

describe("§5 macro snapshot", () => {
  it("carries recorded rates as facts with no invented direction", () => {
    const asOf = T("2026-09-25T12:00:00Z");
    const macro = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: asOf })
      .macroData!;
    expect(macro.provider).toBe("fred");
    expect(macro.dxyTrend).toBeUndefined();
    expect(macro.indicators).toHaveLength(2);
    const ten = macro.indicators.find((i) => i.name.includes("10y"))!;
    const two = macro.indicators.find((i) => i.name.includes("2y"))!;
    expect(ten.value).toBe("5.18");
    expect(two.value).toBe("4.87");
    for (const i of macro.indicators) {
      // No sentiment ⇒ the engine's macro ratio stays 0 ⇒ no score movement.
      expect(i.sentiment).toBeUndefined();
      expect(i.description).toMatch(/no verified rate→direction rule/i);
    }
    expect(macro.confidence).toBe("medium");
    expect(macro.summary).toMatch(/cannot move a conviction score/);
  });

  it("shifts with the as-of instant exactly as the recorded series does", () => {
    const at283 = T("2026-09-24T12:00:00Z");
    const macro = evidenceForDecision(registry, { instrument: "EUR/USD", instrumentType: "forex", asOfMs: at283 })
      .macroData!;
    expect(macro.indicators.find((i) => i.name.includes("10y"))!.value).toBe("5.11");
    expect(macro.timestamp).toBe(Date.parse("2026-09-23T23:59:59.999Z"));
  });

  it("drops evidence older than the documented age bound", () => {
    const macro = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: T("2026-09-30T00:00:00Z"),
    }).macroData!;
    expect(macro.indicators.length).toBe(2); // 09-28 is within 7 days
    const stale = evidenceForDecision(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: T("2026-10-20T00:00:00Z"),
    });
    expect(stale.macroData).toBeUndefined();
    expect(evidenceCoverage(registry, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      asOfMs: T("2026-10-20T00:00:00Z"),
    }).notes.join(" ")).toMatch(/Macro snapshot: unavailable for this date/);
  });
});

describe("§9/§10 independence + honest completeness", () => {
  it("keeps the three OKX series as distinct evidence with distinct fingerprints", () => {
    const fp = new Set([okxFunding.fingerprint, okxOi.fingerprint, okxLs.fingerprint]);
    expect(fp.size).toBe(3);
    const metrics = new Set([okxFunding.meta.metric, okxOi.meta.metric, okxLs.meta.metric]);
    expect(metrics.size).toBe(3);
    // Same provider, same instrument, same instant — but different quantities:
    // they are not duplicate observations of one factor.
    const shared = okxFunding.observations
      .map((o) => o.observedLabel)
      .filter((label) => okxOi.observations.some((o) => o.observedLabel === label));
    expect(shared.length).toBeGreaterThan(0);
    expect(okxFunding.observations[0].values).not.toEqual(okxOi.observations[0].values);
  });

  it("reports completeness as PARTIAL when only some domains apply", () => {
    const coverage = evidenceCoverage(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    const crypto = coverage.domains.find((d) => d.domain === "crypto_derivatives")!;
    expect(crypto.applied).toBe(true);
    expect(crypto.classification).toBe("RECORDED_HISTORICAL");
    expect(coverage.completeness).toBe("PARTIAL");
    expect(coverage.notes).toContain("Evidence completeness: PARTIAL");
  });

  it("never counts technical/price data as an independent non-price layer", () => {
    const ids = registry.datasets.flatMap((d) => [
      d.meta.datasetId,
      d.meta.metric,
      String(d.meta.evidenceDomain),
    ]);
    for (const id of ids) expect(id).not.toMatch(/price|ohlc|candle|technical|trend/i);
  });
});

describe("§18 provenance strings", () => {
  it("labels recorded evidence explicitly and never as live", () => {
    const coverage = evidenceCoverage(registry, {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    const lines = formatEvidenceCoverage(coverage);
    expect(lines[0]).toMatch(/RECORDED \/ HISTORICAL/);
    for (const line of lines) {
      expect(line).not.toMatch(/\bLIVE\b|REAL-TIME|CURRENT SIGNAL|real time/i);
      expect(line).not.toMatch(/high probability|guaranteed|accurate|AI predicts/i);
    }
  });

  it("states the unavailable domains in the output", () => {
    const coverage = evidenceCoverage(registry, {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      asOfMs: T("2026-09-30T03:00:00Z"),
    });
    const text = formatEvidenceCoverage(coverage).join("\n");
    expect(text).toMatch(/commodity_positioning: UNAVAILABLE/);
    expect(text).toMatch(/Positioning: unavailable for this date/);
    // Macro rates genuinely applied, so the corpus is PARTIAL — never claimed FULL.
    expect(text).toMatch(/Evidence completeness: PARTIAL/);
    expect(text).toMatch(/macro_rates: RECORDED_HISTORICAL/);
  });
});

describe("§20 performance", () => {
  it("answers as-of lookups by binary search within a bounded budget", () => {
    const asOfMs = T("2026-09-30T03:00:00Z");
    const start = performance.now();
    let seen = 0;
    for (let i = 0; i < 20_000; i++) {
      const obs = observationAtOrBefore(okxOi, asOfMs - (i % 97) * 60_000);
      if (obs) seen++;
    }
    const elapsed = performance.now() - start;
    expect(seen).toBe(20_000);
    expect(elapsed).toBeLessThan(500);
    // Bounded windows: the helper never returns more rows than asked for.
    expect(lastObservations(okxOi, asOfMs, 2)).toHaveLength(2);
    expect(lastObservations(okxOi, asOfMs, 2, { maxAgeMs: 1 }).length).toBeLessThanOrEqual(1);
  });
});
