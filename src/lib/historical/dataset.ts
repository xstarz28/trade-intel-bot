/**
 * Phase 294 — CANONICAL RECORDED HISTORICAL DATASET CONTRACT.
 *
 * One representation for candles that really came from a provider, carrying
 * everything needed to answer "where did this candle come from?":
 *
 *   provider · providerInstrumentId · assetClass · timeframe · provider bar
 *   label · provider row shape · request lineage (every page URL) · capture
 *   instant · capture method · schema version · source classification.
 *
 * Rules held by construction here:
 *   - nothing is synthesised: missing timestamps, prices, volume or identity are
 *     rejected or left explicitly unavailable, never filled in;
 *   - provider values are copied character for character — parsing converts the
 *     provider's own strings, it does not rewrite or rescale them;
 *   - a recorded candle is HISTORICAL. It is never labelled live;
 *   - quality gates reject malformed candles and quarantine conflicting
 *     duplicates instead of silently picking a winner.
 *
 * This module is pure and deterministic (no clock, no network, no randomness).
 */

import { fnv1a32, stableSerialize } from "@/lib/decision-trace";

export const HISTORICAL_SCHEMA_VERSION = "phase294.1";

/** Where a dataset came from. Designed fixtures are mechanically different data. */
export type SourceClassification = "RECORDED_HISTORICAL" | "DESIGNED_TEST_FIXTURE";

/** Timeframe milliseconds — the engine's ladder only, no invented intervals. */
export const TIMEFRAME_MS: Record<string, number> = {
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
  W1: 7 * 24 * 60 * 60_000,
};

export interface DatasetRequestPage {
  page: number;
  url: string;
  rows: number;
  oldestTimestamp?: number | string;
  cursorParameter?: string;
}

export interface DatasetProvenance {
  datasetId: string;
  schemaVersion: string;
  sourceClassification: SourceClassification;
  provider: string;
  providerInstrumentId: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  providerBarLabel?: string;
  providerRowShape: string;
  providerFieldOrder?: string[];
  rowOrder: string;
  requestPages: DatasetRequestPage[];
  apiKeyClass?: string;
  volumeSupplied?: boolean;
  providerMeta?: Record<string, unknown>;
  capturedAt: string;
  captureMethod: string;
  valuesUnmodified: boolean;
}

export type HistoricalRow = string[] | Record<string, unknown>;

export interface RecordedDatasetFile {
  dataset: DatasetProvenance;
  rows: HistoricalRow[];
}

/** A candle as recorded — timestamps are the PROVIDER's, never re-stamped. */
export interface HistoricalCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /**
   * False when the provider flagged the bar as still forming. A historical
   * decision may not be taken on a bar that had not closed yet.
   */
  closed: boolean;
}

export type QualityFindingCode =
  | "MALFORMED_ROW"
  | "MISSING_FIELD"
  | "NON_FINITE_VALUE"
  | "NON_POSITIVE_PRICE"
  | "HIGH_BELOW_LOW"
  | "OPEN_OUTSIDE_RANGE"
  | "CLOSE_OUTSIDE_RANGE"
  | "INVALID_TIMESTAMP"
  | "DUPLICATE_IDENTICAL"
  | "DUPLICATE_CONFLICT";

export interface QualityFinding {
  code: QualityFindingCode;
  rowIndex: number;
  detail: string;
}

export interface ParsedDataset {
  provenance: DatasetProvenance;
  /** Oldest first. Includes both closed and forming bars, flagged. */
  candles: HistoricalCandle[];
  rejections: QualityFinding[];
  duplicateIdenticalCount: number;
  conflicts: QualityFinding[];
  fingerprint: string;
  status: "OK" | "QUARANTINED";
  timestampSemantics: string;
}

/** JSON loaded from disk is unknown until parsed — nothing is trusted blindly. */
export function asDatasetFile(value: unknown): RecordedDatasetFile {
  if (typeof value !== "object" || value === null) throw new Error("dataset file is not an object");
  const record = value as { dataset?: unknown; rows?: unknown };
  if (typeof record.dataset !== "object" || record.dataset === null) throw new Error("dataset metadata missing");
  if (!Array.isArray(record.rows)) throw new Error("dataset rows missing");
  return { dataset: record.dataset as DatasetProvenance, rows: record.rows as HistoricalRow[] };
}

// ── Provider row parsing (verbatim values) ───────────────────────

const OKX_ROW_SHAPE = "okx-candles-v5-array";
const TWELVE_ROW_SHAPE = "twelvedata-time-series-row-array";

/** Twelve Data datetimes are strings in the exchange's clock. They are read as
 *  UTC for ordering purposes only; `timestampSemantics` records exactly that and
 *  the exchange timezone stays in providerMeta. No offset is invented. */
export function parseProviderDatetime(input: string): number | undefined {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const withTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(input);
  if (withTime) {
    return Date.UTC(
      Number(withTime[1]),
      Number(withTime[2]) - 1,
      Number(withTime[3]),
      Number(withTime[4]),
      Number(withTime[5]),
      Number(withTime[6]),
    );
  }
  return undefined;
}

function numeric(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return n;
}

interface RowOutcome {
  candle?: HistoricalCandle;
  finding?: QualityFinding;
}

function parseRow(provenance: DatasetProvenance, row: HistoricalRow, rowIndex: number): RowOutcome {
  const shape = provenance.providerRowShape;
  if (!Array.isArray(row)) {
    return { finding: { code: "MALFORMED_ROW", rowIndex, detail: "row is not a provider row array" } };
  }
  if (shape === OKX_ROW_SHAPE) {
    if (row.length < 6) return { finding: { code: "MISSING_FIELD", rowIndex, detail: "okx row shorter than 6 fields" } };
    const timestamp = numeric(row[0]);
    const open = numeric(row[1]);
    const high = numeric(row[2]);
    const low = numeric(row[3]);
    const close = numeric(row[4]);
    const volume = numeric(row[5]);
    const confirm = row[8];
    const closed = confirm === undefined ? true : String(confirm) !== "0";
    return checkCandle({ timestamp, open, high, low, close, volume, closed }, rowIndex, provenance.timeframe);
  }
  if (shape === TWELVE_ROW_SHAPE) {
    if (row.length < 5) {
      return { finding: { code: "MISSING_FIELD", rowIndex, detail: `twelve-data row has ${row.length} field(s); OHLC needs 5` } };
    }
    const dt = row[0];
    if (typeof dt !== "string") return { finding: { code: "MISSING_FIELD", rowIndex, detail: "twelve-data row without datetime" } };
    const timestamp = parseProviderDatetime(dt);
    if (timestamp === undefined) {
      return { finding: { code: "INVALID_TIMESTAMP", rowIndex, detail: `unparseable datetime ${dt}` } };
    }
    const open = numeric(row[1]);
    const high = numeric(row[2]);
    const low = numeric(row[3]);
    const close = numeric(row[4]);
    const volumeRaw = row[5];
    const volume = volumeRaw === undefined || volumeRaw === null || volumeRaw === "" ? undefined : numeric(volumeRaw);
    return checkCandle({ timestamp, open, high, low, close, ...(volume !== undefined ? { volume } : {}), closed: true }, rowIndex, provenance.timeframe);
  }
  return { finding: { code: "MALFORMED_ROW", rowIndex, detail: `unsupported provider row shape ${shape}` } };
}

function checkCandle(
  candle: HistoricalCandle,
  rowIndex: number,
  timeframe: string,
): RowOutcome {
  const fields: Array<[string, number]> = [
    ["timestamp", candle.timestamp],
    ["open", candle.open],
    ["high", candle.high],
    ["low", candle.low],
    ["close", candle.close],
  ];
  if (candle.volume !== undefined) fields.push(["volume", candle.volume]);
  for (const [name, value] of fields) {
    if (!Number.isFinite(value)) {
      return { finding: { code: "NON_FINITE_VALUE", rowIndex, detail: `${name} is not finite for ${timeframe}` } };
    }
  }
  if (candle.timestamp <= 0) {
    return { finding: { code: "INVALID_TIMESTAMP", rowIndex, detail: "timestamp is not a positive instant" } };
  }
  for (const name of ["open", "high", "low", "close"] as const) {
    if (candle[name] <= 0) {
      return { finding: { code: "NON_POSITIVE_PRICE", rowIndex, detail: `${name} is not positive` } };
    }
  }
  if (candle.high < candle.low) {
    return { finding: { code: "HIGH_BELOW_LOW", rowIndex, detail: `high ${candle.high} below low ${candle.low}` } };
  }
  if (candle.open > candle.high || candle.open < candle.low) {
    return { finding: { code: "OPEN_OUTSIDE_RANGE", rowIndex, detail: `open ${candle.open} outside [${candle.low}, ${candle.high}]` } };
  }
  if (candle.close > candle.high || candle.close < candle.low) {
    return { finding: { code: "CLOSE_OUTSIDE_RANGE", rowIndex, detail: `close ${candle.close} outside [${candle.low}, ${candle.high}]` } };
  }
  return { candle };
}

const TS_EPOCH = 1_000_000_000_000; // 2001-09-09 — provider instants are ms since 1970

function rowSignature(candle: HistoricalCandle): string {
  return [candle.open, candle.high, candle.low, candle.close, candle.volume ?? "none"].join("|");
}

/**
 * Parse provider rows into candles: malformed rows are rejected (never
 * repaired), exact duplicates are collapsed, and duplicates that DISAGREE are
 * kept apart and reported so a conflict can never overwrite silently.
 */
export function parseCandleRows(provenance: DatasetProvenance, rows: readonly HistoricalRow[]): ParsedDataset {
  const rejections: QualityFinding[] = [];
  const conflicts: QualityFinding[] = [];
  const byTimestamp = new Map<number, HistoricalCandle>();
  let duplicateIdenticalCount = 0;

  rows.forEach((row, rowIndex) => {
    const outcome = parseRow(provenance, row, rowIndex);
    if (!outcome.candle) {
      if (outcome.finding) rejections.push(outcome.finding);
      return;
    }
    const candle = outcome.candle;
    const existing = byTimestamp.get(candle.timestamp);
    if (!existing) {
      byTimestamp.set(candle.timestamp, candle);
      return;
    }
    if (rowSignature(existing) === rowSignature(candle)) {
      duplicateIdenticalCount += 1;
      return;
    }
    conflicts.push({
      code: "DUPLICATE_CONFLICT",
      rowIndex,
      detail: `timestamp ${candle.timestamp} appears twice with different values (${rowSignature(existing)} vs ${rowSignature(candle)})`,
    });
  });

  const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);

  return {
    provenance,
    candles,
    rejections,
    duplicateIdenticalCount,
    conflicts,
    fingerprint: datasetFingerprint(provenance, candles),
    status: conflicts.length > 0 || rejections.length > 0 ? "QUARANTINED" : "OK",
    timestampSemantics:
      provenance.providerRowShape === TWELVE_ROW_SHAPE
        ? "provider datetime parsed as UTC for ordering; exchange timezone preserved in providerMeta, never shifted"
        : "provider millisecond timestamp used verbatim",
  };
}

/**
 * Deterministic dataset identity: schema version + provider-native identity +
 * every candle value. Same recorded data → same fingerprint, on any machine.
 */
export function datasetFingerprint(provenance: DatasetProvenance, candles: readonly HistoricalCandle[]): string {
  const payload = {
    v: provenance.schemaVersion,
    provider: provenance.provider,
    providerInstrumentId: provenance.providerInstrumentId,
    timeframe: provenance.timeframe,
    rows: candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume ?? null, c.closed ? 1 : 0]),
  };
  return `fnv1a32:${fnv1a32(stableSerialize(payload))}`;
}

// ── Multi-timeframe alignment (no backward leakage) ──────────────

/**
 * A higher-timeframe bar is only usable once it has CLOSED. Given the instant a
 * decision is taken, this returns the bars that had closed by then — the exact
 * rule that stops a later weekly candle from leaking into an earlier H4 read.
 */
export function closedBarsAt(candles: readonly HistoricalCandle[], timeframe: string, decisionTime: number): HistoricalCandle[] {
  const interval = TIMEFRAME_MS[timeframe];
  if (interval === undefined) throw new Error(`unknown timeframe ${timeframe}`);
  return candles.filter((c) => c.timestamp + interval <= decisionTime);
}

/** Instant at which the candle at `index` is complete for its timeframe. */
export function decisionTimeAt(candles: readonly HistoricalCandle[], timeframe: string, index: number): number {
  const interval = TIMEFRAME_MS[timeframe];
  if (interval === undefined) throw new Error(`unknown timeframe ${timeframe}`);
  const candle = candles[index];
  if (!candle) throw new Error(`no candle at index ${index}`);
  return candle.timestamp + interval;
}

// ── Diagnostics (factual only) ──────────────────────────────────

export interface DatasetDiagnostics {
  datasets: number;
  candles: number;
  instruments: number;
  providers: number;
  assetClasses: string[];
  timeframes: string[];
  earliestTimestamp?: number;
  latestTimestamp?: number;
  rejections: number;
  conflicts: number;
  identicalDuplicates: number;
  quarantined: string[];
}

export function datasetDiagnostics(parsed: readonly ParsedDataset[]): DatasetDiagnostics {
  const timestamps = parsed.flatMap((p) => p.candles.map((c) => c.timestamp));
  return {
    datasets: parsed.length,
    candles: parsed.reduce((sum, p) => sum + p.candles.length, 0),
    instruments: new Set(parsed.map((p) => p.provenance.instrument)).size,
    providers: new Set(parsed.map((p) => p.provenance.provider)).size,
    assetClasses: [...new Set(parsed.map((p) => p.provenance.assetClass))].sort(),
    timeframes: [...new Set(parsed.map((p) => p.provenance.timeframe))].sort(),
    earliestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    latestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    rejections: parsed.reduce((sum, p) => sum + p.rejections.length, 0),
    conflicts: parsed.reduce((sum, p) => sum + p.conflicts.length, 0),
    identicalDuplicates: parsed.reduce((sum, p) => sum + p.duplicateIdenticalCount, 0),
    quarantined: parsed.filter((p) => p.status === "QUARANTINED").map((p) => p.provenance.datasetId),
  };
}

export function formatDatasetDiagnostics(parsed: readonly ParsedDataset[]): string[] {
  const d = datasetDiagnostics(parsed);
  const lines = [
    `Recorded historical datasets: ${d.datasets}`,
    `Candles: ${d.candles}`,
    `Instruments: ${d.instruments}`,
    `Providers: ${d.providers}`,
    `Asset classes: ${d.assetClasses.join(", ") || "none"}`,
    `Timeframes: ${d.timeframes.join(", ") || "none"}`,
  ];
  if (d.earliestTimestamp !== undefined && d.latestTimestamp !== undefined) {
    lines.push(`Coverage: ${new Date(d.earliestTimestamp).toISOString()} → ${new Date(d.latestTimestamp).toISOString()}`);
  }
  lines.push(`Rejected candles: ${d.rejections}`);
  lines.push(`Duplicate conflicts: ${d.conflicts}`);
  lines.push(`Exact duplicate candles collapsed: ${d.identicalDuplicates}`);
  lines.push(
    d.quarantined.length === 0
      ? "Dataset quality: all datasets passed the quality gates"
      : `Dataset quality: quarantined — ${d.quarantined.join(", ")}`,
  );
  return lines;
}
