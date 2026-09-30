/**
 * Phase 294 — CANONICAL RECORDED DATASET CONTRACT SUITE.
 *
 * Covers §2 (contract), §3 (multi-timeframe alignment), §5 (provider honesty),
 * §6 (deterministic selection), §7 (quality gates), §11 (fingerprint /
 * reproducibility), §13 (recorded material retained) and §14 (recorded vs
 * designed separation).
 */
import { describe, expect, it } from "vitest";

import type { DatasetProvenance, HistoricalRow, ParsedDataset } from "@/lib/historical/dataset";
import {
  HISTORICAL_SCHEMA_VERSION,
  TIMEFRAME_MS,
  asDatasetFile,
  closedBarsAt,
  datasetDiagnostics,
  datasetFingerprint,
  decisionTimeAt,
  formatDatasetDiagnostics,
  parseCandleRows,
  parseProviderDatetime,
} from "@/lib/historical/dataset";
import {
  ACQUISITION_GAPS,
  CAPTURED_ASSET_CLASSES,
  RECORDED_FIXTURES,
  loadRecordedFixture,
  loadRecordedFixtureFile,
  loadRecordedFixtures,
} from "@/lib/historical/fixtures";

const fixtures = loadRecordedFixtures();

function provenanceOf(overrides: Partial<DatasetProvenance> = {}): DatasetProvenance {
  return {
    datasetId: "synthetic-quality-gate",
    schemaVersion: HISTORICAL_SCHEMA_VERSION,
    sourceClassification: "RECORDED_HISTORICAL",
    provider: "quality-gate-probe",
    providerInstrumentId: "PROBE-1",
    instrument: "PROBE/1",
    assetClass: "test",
    timeframe: "H1",
    providerRowShape: "twelvedata-time-series-row-array",
    providerFieldOrder: ["datetime", "open", "high", "low", "close"],
    rowOrder: "provider (newest first)",
    requestPages: [],
    capturedAt: "2026-09-30T03:11:54.000Z",
    captureMethod: "hand-built rows for the quality-gate tests; never provider data",
    valuesUnmodified: true,
    ...overrides,
  };
}

describe("§2 canonical recorded dataset contract", () => {
  it("loads every recorded fixture with its provider-native identity", () => {
    expect(fixtures.datasets).toHaveLength(RECORDED_FIXTURES.length);

    for (const fixture of RECORDED_FIXTURES) {
      const parsed = fixtures.byId.get(fixture.file.replace(/\.json$/, ""));
      expect(parsed, `${fixture.file} is registered`).toBeDefined();
      const meta = parsed!.provenance;
      expect(meta.schemaVersion).toBe(HISTORICAL_SCHEMA_VERSION);
      expect(meta.sourceClassification).toBe("RECORDED_HISTORICAL");
      expect(meta.provider).toBe(fixture.provider);
      expect(meta.timeframe).toBe(fixture.timeframe);
      expect(meta.assetClass).toBe(fixture.assetClass);
      expect(meta.providerInstrumentId).toBe(fixture.providerInstrumentId);
      expect(meta.valuesUnmodified).toBe(true);
      expect(meta.requestPages.length).toBeGreaterThan(0);
      expect(new Date(meta.capturedAt).toISOString()).toBe(meta.capturedAt);
      expect(meta.captureMethod.length).toBeGreaterThan(20);
    }
  });

  it("keeps the provider's own symbol and bar label instead of rewriting them", () => {
    const okx = loadRecordedFixture("okx-BTC-USDT-1D.json");
    // OKX identifies the instrument as BTC-USDT; the display form BTC/USDT is derived and recorded separately.
    expect(okx.provenance.providerInstrumentId).toBe("BTC-USDT");
    expect(okx.provenance.instrument).toBe("BTC/USDT");
    expect(okx.provenance.providerBarLabel).toBe("1D");
    expect(okx.provenance.providerRowShape).toBe("okx-candles-v5-array");
    expect(okx.provenance.requestPages[0].url).toContain("instId=BTC-USDT");
    expect(okx.provenance.requestPages[0].url).toContain("bar=1D");

    const td = loadRecordedFixture("twelvedata-EURUSD-4H.json");
    expect(td.provenance.provider).toBe("twelve-data");
    expect(td.provenance.providerBarLabel).toBe("4h");
    expect(td.provenance.providerRowShape).toBe("twelvedata-time-series-row-array");
    expect(td.provenance.volumeSupplied).toBe(false);
    expect(td.provenance.apiKeyClass).toContain("demo");
  });

  it("records the pagination lineage of a multi-page capture (OKX 4H)", () => {
    const raw = loadRecordedFixtureFile("okx-BTC-USDT-4H.json");
    expect(raw.rows).toHaveLength(120);
    expect(raw.dataset.requestPages).toHaveLength(2);
    expect(raw.dataset.requestPages[1].cursorParameter).toBe("after");
    expect(raw.dataset.requestPages[1].url).toContain("after=1789876800000");
    expect(raw.dataset.requestPages[1].oldestTimestamp).toBe(1789012800000);
  });

  it("never re-labels recorded history as a live feed", () => {
    const text = [
      ...formatDatasetDiagnostics(fixtures.datasets),
      ...fixtures.datasets.map((d) => d.provenance.captureMethod),
      ...fixtures.datasets.map((d) => d.provenance.sourceClassification),
    ].join("\n");
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).not.toMatch(/live feed/i);
    for (const parsed of fixtures.datasets) {
      expect(parsed.provenance.sourceClassification).toBe("RECORDED_HISTORICAL");
    }
  });
});

describe("§5 timestamp integrity — provider instants are kept verbatim", () => {
  it("re-derives every candle timestamp from the recorded provider field", () => {
    for (const parsed of fixtures.datasets) {
      const file = RECORDED_FIXTURES.find((f) => f.file.replace(/\.json$/, "") === parsed.provenance.datasetId);
      const raw = loadRecordedFixtureFile(fixtureFileName(parsed));
      const providerStamps = new Set(
        raw.rows.map((row) => {
          const first = (row as string[])[0];
          return typeof first === "string" && first.includes("-") ? parseProviderDatetime(first) : Number(first);
        }),
      );
      expect(providerStamps.size).toBeGreaterThanOrEqual(parsed.candles.length);
      for (const candle of parsed.candles) expect(providerStamps.has(candle.timestamp)).toBe(true);
      expect(file, "fixture is registered").toBeDefined();
    }
  });

  it("is strictly increasing with the provider's own bar spacing", () => {
    const okx1h = loadRecordedFixture("okx-BTC-USDT-1H.json");
    const spacings = new Set(okx1h.candles.slice(1).map((c, i) => c.timestamp - okx1h.candles[i].timestamp));
    expect([...spacings]).toEqual([TIMEFRAME_MS.H1]);

    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const spacings4h = new Set(okx4h.candles.slice(1).map((c, i) => c.timestamp - okx4h.candles[i].timestamp));
    expect([...spacings4h]).toEqual([TIMEFRAME_MS.H4]);

    const eurDaily = loadRecordedFixture("twelvedata-EURUSD-1D.json");
    expect(eurDaily.candles).toHaveLength(80);
    // Daily bars include weekends in this provider feed: spacing is a whole day or a weekend gap, never sub-daily.
    for (let i = 1; i < eurDaily.candles.length; i += 1) {
      const delta = eurDaily.candles[i].timestamp - eurDaily.candles[i - 1].timestamp;
      expect(delta % TIMEFRAME_MS.D1).toBe(0);
      expect(delta).toBeGreaterThanOrEqual(TIMEFRAME_MS.D1);
      expect(delta).toBeLessThanOrEqual(4 * TIMEFRAME_MS.D1);
    }
  });

  it("rejects an unparseable provider datetime instead of inventing one", () => {
    expect(parseProviderDatetime("2026-09-30 11:00:00")).toBe(Date.UTC(2026, 8, 30, 11, 0, 0));
    expect(parseProviderDatetime("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
    expect(parseProviderDatetime("not-a-date")).toBeUndefined();
    expect(parseProviderDatetime("30/09/2026")).toBeUndefined();
    const parsed = parseCandleRows(provenanceOf(), [
      ["not-a-date", "1", "2", "0.5", "1.5"],
      ["2026-09-30 11:00:00", "1", "2", "0.5", "1.5"],
    ]);
    expect(parsed.rejections.map((r) => r.code)).toEqual(["INVALID_TIMESTAMP"]);
    expect(parsed.candles).toHaveLength(1);
  });

  it("flags a still-forming bar instead of treating it as a closed one", () => {
    const okx1d = loadRecordedFixture("okx-BTC-USDT-1D.json");
    const forming = okx1d.candles.filter((c) => !c.closed);
    expect(forming).toHaveLength(1);
    // The forming bar is the provider's newest row — its values may keep changing.
    expect(forming[0].timestamp).toBe(okx1d.candles[okx1d.candles.length - 1].timestamp);
    const td = loadRecordedFixture("twelvedata-AAPL-1D.json");
    expect(td.candles.every((c) => c.closed)).toBe(true);
  });
});

describe("§7 quality gates reject, never repair", () => {
  it("passes every real recorded dataset through the gates", () => {
    for (const parsed of fixtures.datasets) {
      expect(parsed.status, `${parsed.provenance.datasetId} is clean`).toBe("OK");
      expect(parsed.rejections).toEqual([]);
      expect(parsed.conflicts).toEqual([]);
    }
  });

  it.each([
    ["NON_FINITE_VALUE", ["2026-09-30", "1", "NaN", "0.5", "1.5"]],
    ["NON_POSITIVE_PRICE", ["2026-09-30", "0", "2", "0", "1.5"]],
    ["HIGH_BELOW_LOW", ["2026-09-30", "1.2", "1.0", "1.4", "1.3"]],
    ["OPEN_OUTSIDE_RANGE", ["2026-09-30", "3", "2", "0.5", "1.5"]],
    ["CLOSE_OUTSIDE_RANGE", ["2026-09-30", "1", "2", "0.5", "2.5"]],
    ["MISSING_FIELD", ["2026-09-30", "1", "2"]],
  ])("rejects %s", (code, row) => {
    const parsed = parseCandleRows(provenanceOf(), [row as string[]]);
    expect(parsed.candles).toHaveLength(0);
    expect(parsed.rejections.map((r) => r.code)).toEqual([code]);
    expect(parsed.status).toBe("QUARANTINED");
  });

  it("rejects a malformed row shape and an unsupported provider shape", () => {
    const notARow = parseCandleRows(provenanceOf(), [{ open: "1" }]);
    expect(notARow.rejections.map((r) => r.code)).toEqual(["MALFORMED_ROW"]);

    const unknownShape = parseCandleRows(provenanceOf({ providerRowShape: "unknown-shape" }), [
      ["2026-09-30", "1", "2", "0.5", "1.5"],
    ]);
    expect(unknownShape.rejections[0].code).toBe("MALFORMED_ROW");
    expect(unknownShape.rejections[0].detail).toContain("unknown-shape");
  });

  it("collapses an identical duplicate but keeps a conflicting one visible", () => {
    const row: string[] = ["2026-09-30", "1", "2", "0.5", "1.5"];
    const identical = parseCandleRows(provenanceOf(), [row, [...row]]);
    expect(identical.candles).toHaveLength(1);
    expect(identical.duplicateIdenticalCount).toBe(1);
    expect(identical.conflicts).toEqual([]);
    expect(identical.status).toBe("OK");

    const conflicting = parseCandleRows(provenanceOf(), [row, ["2026-09-30", "1", "2.2", "0.5", "2.0"]]);
    expect(conflicting.conflicts).toHaveLength(1);
    expect(conflicting.status).toBe("QUARANTINED");
    // The FIRST recorded value survives untouched — the later one never overwrites it.
    expect(conflicting.candles[0].high).toBe(2);
    expect(conflicting.conflicts[0].detail).toContain("appears twice with different values");
  });

  it("orders candles oldest-first regardless of the provider's row order", () => {
    for (const parsed of fixtures.datasets) {
      const stamps = parsed.candles.map((c) => c.timestamp);
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
      expect(parsed.provenance.rowOrder).toBe("provider (newest first)");
    }
  });
});

describe("§11 dataset fingerprint and reproducibility", () => {
  it("is stable across reloads and identifies the data, not the process", () => {
    for (const fixture of RECORDED_FIXTURES) {
      const first = loadRecordedFixture(fixture.file);
      const second = loadRecordedFixture(fixture.file);
      expect(first.fingerprint).toBe(second.fingerprint);
      expect(first.fingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
      expect(first.fingerprint).toBe(datasetFingerprint(first.provenance, first.candles));
    }
    expect(new Set(fixtures.datasets.map((d) => d.fingerprint)).size).toBe(fixtures.datasets.length);
  });

  it("changes when any recorded value changes and when identity changes", () => {
    const base = parseCandleRows(provenanceOf(), [["2026-09-30", "1", "2", "0.5", "1.5"]]);
    const tweaked = parseCandleRows(provenanceOf(), [["2026-09-30", "1", "2", "0.5", "1.50001"]]);
    const otherIdentity = parseCandleRows(provenanceOf({ providerInstrumentId: "PROBE-2" }), [
      ["2026-09-30", "1", "2", "0.5", "1.5"],
    ]);
    expect(base.fingerprint).not.toBe(tweaked.fingerprint);
    expect(base.fingerprint).not.toBe(otherIdentity.fingerprint);
  });
});

describe("§3 multi-timeframe alignment never borrows a future bar", () => {
  const okx1d = loadRecordedFixture("okx-BTC-USDT-1D.json");
  const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");

  it("exposes only bars that had closed by the decision instant", () => {
    const cut = okx1d.candles[10].timestamp + TIMEFRAME_MS.D1 / 2; // mid-way through bar 10
    const visible = closedBarsAt(okx1d.candles, "D1", cut);
    expect(visible).toHaveLength(10);
    expect(visible[visible.length - 1].timestamp).toBe(okx1d.candles[9].timestamp);
    for (const bar of visible) expect(bar.timestamp + TIMEFRAME_MS.D1).toBeLessThanOrEqual(cut);
  });

  it("shows an H4 window a different (larger) known history than the daily window at the same instant", () => {
    const cut = okx4h.candles[100].timestamp + 60_000; // one minute into an H4 bar
    const h4Visible = closedBarsAt(okx4h.candles, "H4", cut);
    const d1Visible = closedBarsAt(okx1d.candles, "D1", cut);
    expect(h4Visible).toHaveLength(100);
    expect(d1Visible.length).toBeLessThan(h4Visible.length);
    // Each timeframe keeps its own chronology: the daily read never sees the daily bar covering `cut`.
    if (d1Visible.length > 0) {
      expect(d1Visible[d1Visible.length - 1].timestamp + TIMEFRAME_MS.D1).toBeLessThanOrEqual(cut);
    }
  });

  it("derives a bar's completion instant from the provider timestamp", () => {
    for (const timeframe of ["H1", "H4", "D1", "W1"] as const) {
      const candles = timeframe === "H1" ? loadRecordedFixture("okx-BTC-USDT-1H.json").candles : okx1d.candles;
      const at = decisionTimeAt(candles, timeframe, 3);
      expect(at).toBe(candles[3].timestamp + TIMEFRAME_MS[timeframe]);
    }
    expect(() => decisionTimeAt(okx1d.candles, "H2", 0)).toThrow(/unknown timeframe/);
    expect(TIMEFRAME_MS.M15).toBe(900_000); // the production ladder includes M15
  });
});

describe("§6/§9 coverage diagnostics and the acquired-material bounds", () => {
  it("reports totals, coverage and quality as facts", () => {
    const diagnostics = datasetDiagnostics(fixtures.datasets);
    expect(diagnostics.datasets).toBe(8);
    expect(diagnostics.candles).toBe(
      fixtures.datasets.reduce((sum, d) => sum + d.candles.length, 0),
    );
    expect(diagnostics.instruments).toBe(3);
    expect(diagnostics.providers).toBe(2);
    expect(diagnostics.assetClasses).toEqual(["crypto", "forex", "stock"]);
    expect(diagnostics.timeframes).toEqual(["D1", "H1", "H4", "W1"]);
    expect(diagnostics.rejections).toBe(0);
    expect(diagnostics.conflicts).toBe(0);
    expect(diagnostics.quarantined).toEqual([]);
    expect(diagnostics.earliestTimestamp).toBeLessThan(diagnostics.latestTimestamp!);

    const lines = formatDatasetDiagnostics(fixtures.datasets);
    expect(lines.join("\n")).toContain("Recorded historical datasets: 8");
    expect(lines.join("\n")).not.toMatch(/accurate|win rate|probability|guarantee/i);
    expect(formatDatasetDiagnostics(fixtures.datasets)).toEqual(lines);
  });

  it("records asset classes that genuinely have provider history, and the gaps honestly", () => {
    expect([...CAPTURED_ASSET_CLASSES]).toEqual(["crypto", "forex", "stock"]);
    expect(ACQUISITION_GAPS.map((g) => g.symbol)).toEqual(["XAU/USD", "CSV export path"]);
    for (const gap of ACQUISITION_GAPS) expect(gap.reason.length).toBeGreaterThan(40);
    // No commodity dataset exists — the gap is stated rather than substituted.
    expect(fixtures.datasets.some((d) => d.provenance.assetClass === "commodity")).toBe(false);
  });
});

describe("§14 recorded and designed material are separable", () => {
  const designed: ParsedDataset = (() => {
    const provenance = provenanceOf({
      datasetId: "designed-probe",
      sourceClassification: "DESIGNED_TEST_FIXTURE",
      provider: "test-fixture-generator",
      providerInstrumentId: "TEST-USD",
      instrument: "TEST/USD",
      assetClass: "test",
      providerRowShape: "okx-candles-v5-array",
    });
    const rows: HistoricalRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      const p = 100 + i;
      rows.push([String(1_790_000_000_000 + i * 3_600_000), String(p), String(p + 1), String(p - 1), String(p + 0.5), "10", "10", "10", "1"]);
    }
    return parseCandleRows(provenance, rows);
  })();

  it("carries the classification through parsing and refuses to treat it as provider history", () => {
    expect(designed.provenance.sourceClassification).toBe("DESIGNED_TEST_FIXTURE");
    expect(fixtures.datasets.every((d) => d.provenance.sourceClassification === "RECORDED_HISTORICAL")).toBe(true);
  });

  it("accepts the file envelope but never invents a classification", () => {
    const file = asDatasetFile(loadRecordedFixtureFile("twelvedata-AAPL-1W.json"));
    expect(file.dataset.sourceClassification).toBe("RECORDED_HISTORICAL");
    expect(() => asDatasetFile({ rows: [] })).toThrow(/metadata missing/);
    expect(() => asDatasetFile({ dataset: {} })).toThrow(/rows missing/);
    expect(() => asDatasetFile(null)).toThrow(/not an object/);
  });
});

function fixtureFileName(parsed: ParsedDataset): string {
  const entry = RECORDED_FIXTURES.find((f) => f.file.replace(/\.json$/, "") === parsed.provenance.datasetId);
  if (!entry) throw new Error(`no registered fixture for ${parsed.provenance.datasetId}`);
  return entry.file;
}
