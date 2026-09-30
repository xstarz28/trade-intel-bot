/**
 * Phase 294 — CAPTURE RUNNER (§4): provider pages → one canonical recorded dataset.
 *
 * The runner is deliberately transport-agnostic: the caller supplies a
 * `fetchPage` function (in this repo the analysis-time page-fetch transport,
 * because direct egress from the build sandbox is blocked). What the runner
 * guarantees:
 *
 *   · provider-native identity — the provider's symbol, bar label and row shape
 *     are recorded, never re-mapped into something more convenient;
 *   · deterministic pagination — the same spec produces the same page URLs, and
 *     paging stops on an explicit, recorded condition (end of history, a page
 *     with no new rows, or the documented page cap);
 *   · duplicates are removed only when provably identical; conflicting
 *     duplicates are NEVER overwritten — the dataset is quarantined instead;
 *   · malformed rows are rejected with a reason, never repaired;
 *   · provider timestamps are retained verbatim;
 *   · ingestion is chunked and bounded — rows stream into the canonical map, so
 *     a long history costs one candle per timestamp rather than one array per
 *     page, and `maxRows`/`maxPages` cap the work;
 *   · every capture records schema version, request lineage and capture instant.
 *
 * Nothing here touches the wall clock implicitly: `capturedAt` is passed in.
 */

import type {
  DatasetProvenance,
  DatasetRequestPage,
  HistoricalCandle,
  HistoricalRow,
  ParsedDataset,
  QualityFinding,
} from "./dataset";
import { HISTORICAL_SCHEMA_VERSION, datasetFingerprint, parseCandleRows } from "./dataset";

export interface CapturePage {
  url: string;
  rows: HistoricalRow[];
  /**
   * The provider's own paging cursor for the NEXT (older) page, when it has
   * one. Absent ⇒ the provider signalled the end of what it will serve.
   */
  nextCursor?: string;
  oldestTimestamp?: number | string;
}

export interface CaptureSpec {
  datasetId: string;
  provider: string;
  providerInstrumentId: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  providerBarLabel?: string;
  providerRowShape: string;
  providerFieldOrder?: string[];
  rowOrder: string;
  /** Page 1 URL — the first request the capture actually made. */
  firstUrl: string;
  /** Builds the next page URL from the previous page's cursor. Deterministic. */
  nextUrl: (cursor: string) => string;
  providerMeta?: Record<string, unknown>;
  apiKeyClass?: string;
  volumeSupplied?: boolean;
  captureMethod: string;
  capturedAt: string;
  /** How old the oldest page may get before paging stops (documented bound). */
  maxPages: number;
  /** Hard cap on retained candles — protects memory on a long history. */
  maxRows: number;
}

export type CaptureStopReason = "END_OF_HISTORY" | "NO_NEW_ROWS" | "PAGE_CAP" | "ROW_CAP";

export interface CaptureResult extends ParsedDataset {
  stopReason: CaptureStopReason;
  pagesFetched: number;
  requestPages: DatasetRequestPage[];
}

/**
 * Walk the provider's pages oldest-ward, accumulating candles as they arrive.
 * Each page is parsed immediately so nothing keeps the raw page arrays alive.
 */
export async function captureDataset(
  spec: CaptureSpec,
  fetchPage: (url: string) => Promise<CapturePage>,
): Promise<CaptureResult> {
  const requestPages: DatasetRequestPage[] = [];
  const rejections: QualityFinding[] = [];
  const conflicts: QualityFinding[] = [];
  const byTimestamp = new Map<number, HistoricalCandle>();
  let duplicateIdenticalCount = 0;
  let stopReason: CaptureStopReason = "END_OF_HISTORY";
  let url = spec.firstUrl;

  const provenance: DatasetProvenance = {
    datasetId: spec.datasetId,
    schemaVersion: HISTORICAL_SCHEMA_VERSION,
    sourceClassification: "RECORDED_HISTORICAL",
    provider: spec.provider,
    providerInstrumentId: spec.providerInstrumentId,
    instrument: spec.instrument,
    assetClass: spec.assetClass,
    timeframe: spec.timeframe,
    ...(spec.providerBarLabel !== undefined ? { providerBarLabel: spec.providerBarLabel } : {}),
    providerRowShape: spec.providerRowShape,
    ...(spec.providerFieldOrder !== undefined ? { providerFieldOrder: spec.providerFieldOrder } : {}),
    rowOrder: spec.rowOrder,
    requestPages, // live reference — filled below, recorded in order
    ...(spec.apiKeyClass !== undefined ? { apiKeyClass: spec.apiKeyClass } : {}),
    ...(spec.volumeSupplied !== undefined ? { volumeSupplied: spec.volumeSupplied } : {}),
    ...(spec.providerMeta !== undefined ? { providerMeta: spec.providerMeta } : {}),
    capturedAt: spec.capturedAt,
    captureMethod: spec.captureMethod,
    valuesUnmodified: true,
  };

  for (let page = 1; page <= spec.maxPages; page += 1) {
    const response = await fetchPage(url);
    requestPages.push({
      page,
      url: response.url,
      rows: response.rows.length,
      ...(response.oldestTimestamp !== undefined ? { oldestTimestamp: response.oldestTimestamp } : {}),
      ...(page > 1 ? { cursorParameter: "after" } : {}),
    });

    // Parse this page alone, then fold it into the canonical map.
    const pageParsed = parseCandleRows({ ...provenance, requestPages: [] }, response.rows);
    rejections.push(...pageParsed.rejections);
    duplicateIdenticalCount += pageParsed.duplicateIdenticalCount;
    conflicts.push(...pageParsed.conflicts.map((c) => ({ ...c, detail: `page ${page}: ${c.detail}` })));

    let added = 0;
    for (const candle of pageParsed.candles) {
      const existing = byTimestamp.get(candle.timestamp);
      if (!existing) {
        byTimestamp.set(candle.timestamp, candle);
        added += 1;
        continue;
      }
      const same =
        existing.open === candle.open &&
        existing.high === candle.high &&
        existing.low === candle.low &&
        existing.close === candle.close &&
        (existing.volume ?? null) === (candle.volume ?? null);
      if (same) {
        duplicateIdenticalCount += 1;
      } else {
        conflicts.push({
          code: "DUPLICATE_CONFLICT",
          rowIndex: -1,
          detail: `page ${page}: timestamp ${candle.timestamp} re-served with different values — nothing was overwritten`,
        });
      }
    }

    if (byTimestamp.size >= spec.maxRows) {
      stopReason = "ROW_CAP";
      break;
    }
    if (response.nextCursor === undefined) {
      stopReason = "END_OF_HISTORY";
      break;
    }
    if (added === 0) {
      stopReason = "NO_NEW_ROWS";
      break;
    }
    if (page === spec.maxPages) {
      stopReason = "PAGE_CAP";
      break;
    }
    url = spec.nextUrl(response.nextCursor);
  }

  const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  const quarantined = conflicts.length > 0 || rejections.length > 0;

  const result: CaptureResult = {
    provenance,
    candles,
    rejections,
    duplicateIdenticalCount,
    conflicts,
    fingerprint: datasetFingerprint(provenance, candles),
    status: quarantined ? "QUARANTINED" : "OK",
    timestampSemantics:
      spec.providerRowShape === "twelvedata-time-series-row-array"
        ? "provider datetime parsed as UTC for ordering; exchange timezone preserved in providerMeta, never shifted"
        : "provider millisecond timestamp used verbatim",
    stopReason,
    pagesFetched: requestPages.length,
    requestPages,
  };
  return result;
}

/** Number of candles a capture may hold — documented bound, not a magic number. */
export const DEFAULT_CAPTURE_MAX_PAGES = 8;
export const DEFAULT_CAPTURE_MAX_ROWS = 2_000;
