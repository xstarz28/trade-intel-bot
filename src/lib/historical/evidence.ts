/**
 * Phase 296 — RECORDED NON-PRICE EVIDENCE: CONTRACT, REGISTRY, AS-OF LOOKUPS (§2, §3, §12, §13).
 *
 * WHAT THIS MODULE IS
 * -------------------
 * One typed contract for non-price evidence that a provider actually served
 * historically, plus the registry that records what is NOT available. It is the
 * non-price counterpart of the Phase 294 candle dataset: the same "record what
 * was really returned, verbatim, or record the gap" discipline, applied to
 * fundamentals, positioning, macro and COT material.
 *
 * CLASSIFICATION IS NOT DECORATION
 * --------------------------------
 *   · RECORDED_HISTORICAL — the provider itself exposes the history, every row
 *     carries its own observation instant, and the row is knowable at that
 *     instant (or at the documented publication instant for weekly COT).
 *     ONLY this class may feed empirical aggregates or a historical decision.
 *   · CURRENT_ONLY — the provider serves only today's snapshot. It is never
 *     converted into history, never back-dated, never used for an older
 *     decision. (Alpha Vantage / Twelve Data free-tier stock fundamentals and
 *     market cap live here.)
 *   · UNAVAILABLE — no reachable provider path. Recorded as a gap with reason.
 *   · DESIGNED_TEST_FIXTURE — synthetic rows that exercise mechanics only.
 *     Never in empirical aggregates, never in the benchmark corpus.
 *
 * AS-OF SEMANTICS (§3)
 * --------------------
 * Every observation carries TWO instants:
 *   · observedAt     — the period/instant the value describes (may be absent:
 *                      the provider may not say);
 *   · availableFrom  — the earliest instant the value is knowable.
 * A value whose `availableFrom` is after the decision instant does NOT exist
 * for that decision, and a value published later covering an earlier period is
 * NOT usable at the decision either. The lookup below is a binary search over
 * `availableFrom`, so a future (or later-revised) row can never be selected,
 * and as-of lookup is O(log n) rather than a scan.
 *
 * NO INVENTED DIRECTION
 * ---------------------
 * Recorded levels are attached as FACTS. Where the repository has no verified
 * rule turning a fact into a direction, no sentiment is attached at all: the
 * engine's macro branch counts only explicit `positive`/`negative` sentiments,
 * so an indicator without a sentiment contributes zero while staying visible
 * as coverage. Absent evidence stays absent — never neutral support.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fnv1a32, stableSerialize } from "@/lib/decision-trace";
import type {
  CryptoDerivativesData,
  FundingRateData,
  LongShortData,
  OpenInterestData,
} from "@/lib/data/derivatives-types";
import type { CotContext, CotData, CotFreshness, CotReport } from "@/lib/data/cot";
import { mapInstrumentToCot } from "@/lib/data/cot";
import type { MacroData, MacroIndicator } from "@/lib/data/intelligence-types";

export const EVIDENCE_SCHEMA_VERSION = "phase296.1";

export type EvidenceSourceClassification =
  | "RECORDED_HISTORICAL"
  | "CURRENT_ONLY"
  | "UNAVAILABLE"
  | "DESIGNED_TEST_FIXTURE";

export type EvidenceAvailabilityRule =
  | "OBSERVATION_INSTANT"
  | "PUBLICATION_INSTANT"
  | "CONSERVATIVE_END_OF_DAY"
  | "PROVIDER_VINTAGE"
  | "NONE";

export type EvidenceDomain =
  | "crypto_derivatives"
  | "cot_positioning"
  | "macro_rates"
  | "macro_rates_point_in_time"
  | "stock_fundamentals"
  | "commodity_positioning"
  | "economic_calendar"
  | "news_sentiment";

export interface EvidenceDatasetMeta {
  datasetId: string;
  schemaVersion: string;
  evidenceDomain: EvidenceDomain | string;
  metric: string;
  sourceClassification: EvidenceSourceClassification;
  provider: string;
  providerNativeId: string;
  instrument?: string;
  sameUnderlyingAs?: string;
  units?: string;
  observationCadence: string;
  asOfSemantics: string;
  availabilityRule: EvidenceAvailabilityRule | string;
  requestedPeriod: string;
  returnedPeriod: string;
  requestUrl?: string;
  source?: string;
  capturedAt: string;
  captureTransport?: string;
  valuesUnmodified: boolean;
  rowOrder: string;
  valuesSubstituted: boolean;
  applicableInReplay?: boolean;
  evidenceKind?: string;
  note?: string;
  mappingNote?: string;
}

export interface EvidenceObservation {
  /** Provider instant the value describes; null when the provider does not say. */
  observedAt: number | null;
  /** The provider's own representation of that instant (verbatim). */
  observedLabel: string;
  /** Earliest instant the value is knowable. Lookup key (ascending). */
  availableFrom: number;
  /** Recorded values, verbatim; never recomputed or filled in. */
  values: Record<string, number | string>;
}

export interface HistoricalEvidenceDataset {
  meta: EvidenceDatasetMeta;
  observations: readonly EvidenceObservation[];
  fingerprint: string;
  findings: readonly string[];
}

export interface EvidenceFile {
  dataset: EvidenceDatasetMeta;
  rows: unknown[];
}

export function asEvidenceFile(raw: unknown): EvidenceFile {
  if (typeof raw !== "object" || raw === null) throw new Error("evidence file: not an object");
  const file = raw as Record<string, unknown>;
  const dataset = file.dataset;
  const rows = file.rows;
  if (typeof dataset !== "object" || dataset === null) throw new Error("evidence file: missing dataset metadata");
  if (!Array.isArray(rows)) throw new Error("evidence file: missing rows array");
  return { dataset: dataset as EvidenceDatasetMeta, rows };
}

// ────────────────────────────────────────────────────────────────
// provider time helpers (deterministic, no wall clock)
// ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** UTC offset of a time zone at an instant (DST-correct via the platform tz database). */
function zoneOffsetMs(zone: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(atMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - atMs;
}

/** Wall-clock instant in `zone` on the day `days` after `utcMidnightMs`. */
function zoneInstant(zone: string, utcMidnightMs: number, days: number, hour: number, minute: number): number {
  const naive = utcMidnightMs + days * MS_PER_DAY + hour * 3_600_000 + minute * 60_000;
  const first = zoneOffsetMs(zone, naive);
  const corrected = naive - first;
  const second = zoneOffsetMs(zone, corrected);
  return second === first ? corrected : naive - second;
}

/**
 * CFTC release schedule: the Tuesday report is published the following Friday at
 * 15:30 America/New_York. Anything earlier would place a report in the corpus
 * before it was knowable — the exact failure mode §3 forbids.
 */
export function cftcPublicationInstant(reportDateMs: number): number {
  const utcMidnight = Math.floor(reportDateMs / MS_PER_DAY) * MS_PER_DAY;
  return zoneInstant("America/New_York", utcMidnight, 3, 15, 30);
}

/** End of the observation day (UTC) — deliberately conservative for daily series. */
function endOfDayUtc(dayMs: number): number {
  return Math.floor(dayMs / MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY - 1;
}

function parseUtcDay(label: string): number {
  const ms = Date.parse(`${label}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`evidence row: unusable date "${label}"`);
  return ms;
}

function asNumber(value: unknown, field: string, findings: string[]): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    findings.push(`row rejected: ${field} is not numeric ("${String(value)}")`);
    return undefined;
  }
  return n;
}

// ────────────────────────────────────────────────────────────────
// row parsers — table-driven, and a row shape that is not recognised is
// rejected rather than guessed
// ────────────────────────────────────────────────────────────────

type RowParser = (rows: readonly unknown[], findings: string[]) => EvidenceObservation[];

function okxTimestampRow(
  rows: readonly unknown[],
  findings: string[],
  fields: readonly string[],
): EvidenceObservation[] {
  const out: EvidenceObservation[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < fields.length + 1) {
      findings.push(`row rejected: expected [ts, ${fields.join(", ")}]`);
      continue;
    }
    const ts = asNumber(row[0], "ts", findings);
    if (ts === undefined) {
      findings.push("row rejected: unusable provider timestamp");
      continue;
    }
    const values: Record<string, number | string> = {};
    let ok = true;
    for (let i = 0; i < fields.length; i++) {
      const v = asNumber(row[i + 1], fields[i], findings);
      if (v === undefined) {
        ok = false;
        break;
      }
      values[fields[i]] = v;
    }
    if (!ok) continue;
    out.push({ observedAt: ts, observedLabel: String(row[0]), availableFrom: ts, values });
  }
  return out;
}

function dailySeriesRow(rows: readonly unknown[], findings: string[], field: string): EvidenceObservation[] {
  const out: EvidenceObservation[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) {
      findings.push(`row rejected: expected [date, ${field}]`);
      continue;
    }
    const label = String(row[0]);
    const value = asNumber(row[1], field, findings);
    if (value === undefined) {
      // A blank cell is the provider saying "no observation" — it is NOT zero
      // and NOT interpolated; the finding is recorded instead.
      findings.push(`row skipped: no observation published for ${label} (blank cell kept blank)`);
      continue;
    }
    const dayMs = parseUtcDay(label);
    out.push({ observedAt: dayMs, observedLabel: label, availableFrom: endOfDayUtc(dayMs), values: { [field]: value } });
  }
  return out;
}

function cotRow(rows: readonly unknown[], findings: string[]): EvidenceObservation[] {
  const out: EvidenceObservation[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      findings.push("row rejected: COT row is not an object");
      continue;
    }
    const r = row as Record<string, unknown>;
    const reportLabel = String(r.report_date_as_yyyy_mm_dd ?? "");
    if (!reportLabel) {
      findings.push("row rejected: COT row without report date");
      continue;
    }
    const reportDateMs = Date.parse(reportLabel);
    if (!Number.isFinite(reportDateMs)) {
      findings.push(`row rejected: unusable COT report date "${reportLabel}"`);
      continue;
    }
    const pick = (key: string): number | undefined => asNumber(r[key], key, findings);
    const values: Record<string, number | string> = { reportDate: reportLabel };
    const ncLong = pick("noncomm_positions_long_all");
    const ncShort = pick("noncomm_positions_short_all");
    if (ncLong === undefined || ncShort === undefined) {
      findings.push(`row rejected: COT report ${reportLabel} missing non-commercial legs`);
      continue;
    }
    values.nonCommercialLong = ncLong;
    values.nonCommercialShort = ncShort;
    const cLong = pick("comm_positions_long_all");
    const cShort = pick("comm_positions_short_all");
    if (cLong !== undefined) values.commercialLong = cLong;
    if (cShort !== undefined) values.commercialShort = cShort;
    const oi = pick("open_interest_all");
    if (oi !== undefined) values.openInterest = oi;
    values.marketAndExchangeName = String(r.market_and_exchange_names ?? "");
    out.push({
      observedAt: reportDateMs,
      observedLabel: reportLabel,
      availableFrom: cftcPublicationInstant(reportDateMs),
      values,
    });
  }
  return out;
}

function parserFor(meta: EvidenceDatasetMeta): RowParser {
  const key = `${meta.provider}|${meta.metric}`;
  switch (key) {
    case "okx|funding_rate":
      return (rows, f) => okxTimestampRow(rows, f, ["fundingRate", "realizedRate"]);
    case "okx|open_interest":
      return (rows, f) => okxTimestampRow(rows, f, ["openInterestUsd", "volumeUsd"]);
    case "okx|long_short_account_ratio":
      return (rows, f) => okxTimestampRow(rows, f, ["accountRatio"]);
    case "cftc|commitments_of_traders_legacy_futures_only":
      return cotRow;
    case "fred|treasury_constant_maturity_10y":
    case "fred|treasury_constant_maturity_2y":
      return (rows, f) => dailySeriesRow(rows, f, "percent");
    case "alfred|treasury_constant_maturity_10y_as_known_at_vintage":
      return (rows, f) => dailySeriesRow(rows, f, "percent");
    default:
      // Unknown provider/metric pair: refuse to guess a row shape.
      return () => {
        throw new Error(`evidence dataset ${meta.datasetId}: no parser for ${key} (row shape never guessed)`);
      };
  }
}

export function parseEvidenceRows(meta: EvidenceDatasetMeta, rows: readonly unknown[]): HistoricalEvidenceDataset {
  if (meta.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`${meta.datasetId}: schema ${meta.schemaVersion}≠${EVIDENCE_SCHEMA_VERSION}`);
  }
  if (meta.sourceClassification === "CURRENT_ONLY") {
    throw new Error(
      `${meta.datasetId}: CURRENT_ONLY snapshots are never parsed as history — they cannot be back-dated`,
    );
  }
  const findings: string[] = [];
  const observations = parserFor(meta)(rows, findings).sort((a, b) => a.availableFrom - b.availableFrom);
  if (observations.length === 0) throw new Error(`${meta.datasetId}: no usable observations`);
  return {
    meta,
    observations,
    fingerprint: evidenceFingerprint(meta, observations),
    findings,
  };
}

// ────────────────────────────────────────────────────────────────
// fingerprint, lookups
// ────────────────────────────────────────────────────────────────

export function evidenceFingerprint(
  meta: EvidenceDatasetMeta,
  observations: readonly EvidenceObservation[],
): string {
  const canonical = {
    datasetId: meta.datasetId,
    provider: meta.provider,
    providerNativeId: meta.providerNativeId,
    domain: meta.evidenceDomain,
    metric: meta.metric,
    classification: meta.sourceClassification,
    observations: observations.map((o) => [o.availableFrom, o.observedAt, stableSerialize(o.values)]),
  };
  return `fnv1a32:${fnv1a32(stableSerialize(canonical))}`;
}

/** Rightmost index with availableFrom ≤ asOfMs, or -1. */
export function asOfIndex(dataset: HistoricalEvidenceDataset, asOfMs: number): number {
  const obs = dataset.observations;
  let lo = 0;
  let hi = obs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (obs[mid].availableFrom <= asOfMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface AsOfOptions {
  /** Evidence older than this many ms before the decision is not used. */
  maxAgeMs?: number;
}

export function observationAtOrBefore(
  dataset: HistoricalEvidenceDataset,
  asOfMs: number,
  options: AsOfOptions = {},
): EvidenceObservation | undefined {
  const idx = asOfIndex(dataset, asOfMs);
  if (idx < 0) return undefined;
  const obs = dataset.observations[idx];
  if (options.maxAgeMs !== undefined && asOfMs - obs.availableFrom > options.maxAgeMs) return undefined;
  return obs;
}

export function lastObservations(
  dataset: HistoricalEvidenceDataset,
  asOfMs: number,
  count: number,
  options: AsOfOptions = {},
): EvidenceObservation[] {
  const idx = asOfIndex(dataset, asOfMs);
  if (idx < 0) return [];
  const start = Math.max(0, idx - count + 1);
  const slice = dataset.observations.slice(start, idx + 1);
  const maxAgeMs = options.maxAgeMs;
  if (maxAgeMs === undefined) return slice;
  return slice.filter((o) => asOfMs - o.availableFrom <= maxAgeMs);
}

// ────────────────────────────────────────────────────────────────
// registry (§13) — deterministic order, deterministic fingerprint
// ────────────────────────────────────────────────────────────────

export interface EvidenceFixtureEntry {
  file: string;
  provider: string;
  domain: EvidenceDomain;
}

/** Deterministic order: domain, then provider, then dataset id (file name). */
export const EVIDENCE_FIXTURES: readonly EvidenceFixtureEntry[] = [
  { file: "okx-funding-rate-BTC-USDT-SWAP-8H.json", provider: "okx", domain: "crypto_derivatives" },
  { file: "okx-long-short-account-ratio-BTC-1H.json", provider: "okx", domain: "crypto_derivatives" },
  { file: "okx-open-interest-BTC-USDT-SWAP-1H.json", provider: "okx", domain: "crypto_derivatives" },
  { file: "cftc-cot-BITCOIN-weekly.json", provider: "cftc", domain: "cot_positioning" },
  { file: "cftc-cot-EURO-FX-weekly.json", provider: "cftc", domain: "cot_positioning" },
  { file: "fred-DGS10-daily.json", provider: "fred", domain: "macro_rates" },
  { file: "fred-DGS2-daily.json", provider: "fred", domain: "macro_rates" },
  { file: "fred-alfred-DGS10-vintage-2026-09-25.json", provider: "alfred", domain: "macro_rates_point_in_time" },
] as const;

/**
 * Documented acquisition gaps for non-price evidence. These are observations
 * about provider access, recorded with the reason — never substitute data.
 */
export const EVIDENCE_ACQUISITION_GAPS: readonly { domain: EvidenceDomain; instrument?: string; reason: string }[] = [
  {
    domain: "stock_fundamentals",
    instrument: "AAPL",
    reason:
      "Official point-in-time stock fundamentals require a keyed provider (Alpha Vantage needs a key; the configured demo key returns nothing usable). Twelve Data's free tier serves only the CURRENT snapshot (market cap, trailing P/E). A snapshot taken 2026-09-30 cannot be used in a 2026-07 decision, and no filing-date/vintage series is reachable here, so no equities fundamentals dataset is recorded. Market cap and P/E are therefore absent — not zero, not neutral.",
  },
  {
    domain: "commodity_positioning",
    reason:
      "The reachable provider paths used for this corpus serve no commodity price or positioning history (Twelve Data demo: XAU/USD → HTTP 401; OKX: crypto only). No substitution was made — never XAU/USD → BTC, never WTI → an unrelated instrument — so commodity positioning is UNAVAILABLE for this date range.",
  },
  {
    domain: "economic_calendar",
    reason:
      "No reachable provider path serves historical economic-calendar events (the guest-tier calendar API responded that the account is discontinued). Event surprises therefore stay absent; nothing is reconstructed from today's calendar.",
  },
] as const;

export interface RecordedEvidenceRegistry {
  datasets: readonly HistoricalEvidenceDataset[];
  byId: ReadonlyMap<string, HistoricalEvidenceDataset>;
  fingerprint: string;
}

export function evidenceRegistryFingerprint(datasets: readonly HistoricalEvidenceDataset[]): string {
  // Sorted by dataset id: the registry identity must not depend on the order in
  // which the files happen to be listed.
  return `fnv1a32:${fnv1a32(
    stableSerialize(
      datasets
        .map((d) => [d.meta.datasetId, d.fingerprint] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  )}`;
}

export function evidenceFixturePath(file: string): string {
  return fileURLToPath(new URL(`../data/__fixtures__/historical-evidence/${file}`, import.meta.url));
}

export function loadEvidenceFixture(file: string): HistoricalEvidenceDataset {
  const raw = JSON.parse(readFileSync(evidenceFixturePath(file), "utf8")) as unknown;
  const asFile = asEvidenceFile(raw);
  return parseEvidenceRows(asFile.dataset, asFile.rows);
}

export function loadEvidenceRegistry(): RecordedEvidenceRegistry {
  const datasets = EVIDENCE_FIXTURES.map((entry) => loadEvidenceFixture(entry.file));
  const byId = new Map(datasets.map((d) => [d.meta.datasetId, d] as const));
  return { datasets, byId, fingerprint: evidenceRegistryFingerprint(datasets) };
}

/**
 * Guard for empirical use: only RECORDED_HISTORICAL material may inform a
 * historical decision. CURRENT_ONLY / UNAVAILABLE / DESIGNED_TEST_FIXTURE
 * throw here, so a caller cannot quietly treat them as history.
 */
export function assertUsableForHistory(dataset: HistoricalEvidenceDataset): void {
  if (dataset.meta.sourceClassification !== "RECORDED_HISTORICAL") {
    throw new Error(
      `${dataset.meta.datasetId}: ${dataset.meta.sourceClassification} may not inform a historical decision`,
    );
  }
  if (dataset.meta.applicableInReplay === false) {
    throw new Error(`${dataset.meta.datasetId}: recorded but marked not applicable in replay`);
  }
}

/** Build a CURRENT_ONLY marker so the classification is explicit in code and tests. */
export function currentOnlyDataset(meta: Partial<EvidenceDatasetMeta> & { datasetId: string }): EvidenceDatasetMeta {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceDomain: meta.evidenceDomain ?? "stock_fundamentals",
    metric: meta.metric ?? "snapshot",
    provider: meta.provider ?? "unknown",
    providerNativeId: meta.providerNativeId ?? "unknown",
    observationCadence: "current snapshot only",
    asOfSemantics: "the provider serves today's value only; it describes no earlier period and cannot be back-dated",
    availabilityRule: "NONE",
    requestedPeriod: "current",
    returnedPeriod: "current",
    capturedAt: meta.capturedAt ?? "not-captured",
    valuesUnmodified: true,
    rowOrder: "provider",
    valuesSubstituted: false,
    applicableInReplay: false,
    ...meta,
    sourceClassification: "CURRENT_ONLY",
  };
}

// ────────────────────────────────────────────────────────────────
// coverage reporting (§18) — factual strings only
// ────────────────────────────────────────────────────────────────

/**
 * Documented age bounds per domain. Coverage uses the SAME bounds the
 * attachment uses, so the report can never claim evidence that was not used.
 */
const COVERAGE_AGE_BOUNDS: Record<string, number> = {
  crypto_derivatives: 24 * 3_600_000,
  cot_positioning: 14 * 86_400_000,
  macro_rates: 7 * 86_400_000,
};

export interface EvidenceDomainCoverage {
  domain: EvidenceDomain | string;
  classification: EvidenceSourceClassification;
  datasetIds: string[];
  observations: number;
  /** How many of those observations are knowable at the decision instant. */
  usableAtDecision: number;
  from?: string;
  to?: string;
  /** True when this domain actually reached the engine's analysis input. */
  applied: boolean;
  reason?: string;
}

export interface EvidenceCoverage {
  instrument: string;
  instrumentType: string;
  asOf: string;
  domains: EvidenceDomainCoverage[];
  completeness: "FULL" | "PARTIAL" | "NONE";
  notes: string[];
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function evidenceCoverage(
  registry: RecordedEvidenceRegistry,
  params: { instrument: string; instrumentType: string; asOfMs: number },
): EvidenceCoverage {
  const { instrument, instrumentType, asOfMs } = params;
  const domains: EvidenceDomainCoverage[] = [];
  const notes: string[] = [];

  const relevant = registry.datasets.filter(
    (d) =>
      d.meta.evidenceDomain === "crypto_derivatives" ||
      d.meta.evidenceDomain === "cot_positioning" ||
      d.meta.evidenceDomain === "macro_rates",
  );

  for (const metric of ["crypto_derivatives", "cot_positioning", "macro_rates"] as const) {
    const group = relevant.filter((d) => d.meta.evidenceDomain === metric);
    if (group.length === 0) continue;
    const datasetIds: string[] = [];
    let observations = 0;
    let usable = 0;
    let first: number | undefined;
    let last: number | undefined;
    let classification: EvidenceSourceClassification = "RECORDED_HISTORICAL";
    let newestKnowable: number | undefined;
    let staleBeyondBound = false;
    for (const d of group) {
      const matches =
        metric === "macro_rates"
          ? true
          : (d.meta.sameUnderlyingAs ?? d.meta.instrument) === instrument;
      if (!matches) {
        datasetIds.push(d.meta.datasetId);
        classification = d.meta.sourceClassification;
        notes.push(`${d.meta.datasetId}: recorded but not mapped to ${instrument} — not applied`);
        continue;
      }
      datasetIds.push(d.meta.datasetId);
      classification = d.meta.sourceClassification;
      observations += d.observations.length;
      if (d.meta.applicableInReplay === false) {
        // Recorded, but the repository has no verified mapping for it: counting
        // it as applied coverage would overstate the evidence.
        notes.push(
          `${d.meta.datasetId}: recorded but marked not applicable in replay — never applied${d.meta.mappingNote ? ` (${d.meta.mappingNote})` : ""}`,
        );
        continue;
      }
      const idx = asOfIndex(d, asOfMs);
      const bound = COVERAGE_AGE_BOUNDS[metric];
      if (idx >= 0) {
        const newest = d.observations[idx];
        if (asOfMs - newest.availableFrom <= bound) {
          usable += 1; // one value per dataset is what a decision actually consumes
          newestKnowable = newestKnowable === undefined ? newest.availableFrom : Math.max(newestKnowable, newest.availableFrom);
          const fromMs = d.observations[0].availableFrom;
          first = first === undefined ? fromMs : Math.min(first, fromMs);
          last = newestKnowable;
        } else {
          staleBeyondBound = true;
          newestKnowable = newestKnowable === undefined ? newest.availableFrom : Math.max(newestKnowable, newest.availableFrom);
        }
      }
    }
    // Same applicability rule the attachment uses: derivatives are a crypto
    // layer, and macro rates are carried for every class EXCEPT equities, whose
    // branch consumes its own fundamentals instead (never a macro substitute).
    const appliesToInstrumentType =
      metric === "crypto_derivatives"
        ? instrumentType === "crypto"
        : metric === "macro_rates"
          ? instrumentType !== "stock"
          : true;
    const applied = appliesToInstrumentType && usable > 0;
    domains.push({
      domain: metric,
      classification,
      datasetIds,
      observations,
      usableAtDecision: usable,
      from: first !== undefined ? iso(first) : undefined,
      to: last !== undefined ? iso(last) : undefined,
      applied,
      reason: applied
        ? undefined
        : !appliesToInstrumentType
          ? `domain does not apply to ${instrumentType}`
          : staleBeyondBound
            ? `newest knowable observation (${newestKnowable !== undefined ? iso(newestKnowable) : "none"}) is older than the documented ${Math.round(
                COVERAGE_AGE_BOUNDS[metric] / 86_400_000,
              )}-day bound`
            : `no observation of this domain is knowable at ${iso(asOfMs)}`,
    });
  }

  // Domains with no recorded dataset at all are still reported, never hidden.
  for (const domain of [
    "stock_fundamentals",
    "commodity_positioning",
    "economic_calendar",
    "news_sentiment",
  ] as const) {
    const applies =
      domain === "stock_fundamentals"
        ? instrumentType === "stock"
        : domain === "commodity_positioning"
          ? instrumentType === "commodity"
          : true;
    if (!applies) continue;
    domains.push({
      domain,
      classification: "UNAVAILABLE",
      datasetIds: [],
      observations: 0,
      usableAtDecision: 0,
      applied: false,
      reason: EVIDENCE_ACQUISITION_GAPS.find((g) => g.domain === (domain as EvidenceDomain))?.reason,
    });
  }

  const appliedDomains = domains.filter((d) => d.applied).length;
  const completeness: EvidenceCoverage["completeness"] =
    appliedDomains === 0 ? "NONE" : domains.some((d) => !d.applied) ? "PARTIAL" : "FULL";

  notes.push(`Evidence completeness: ${completeness}`);
  for (const d of domains) {
    if (d.domain === "cot_positioning" && !d.applied) notes.push(`Positioning (COT): unavailable for this date`);
    if (d.domain === "macro_rates") {
      notes.push(
        d.usableAtDecision > 0
          ? `Macro snapshot: recorded as-of ${d.to} (${d.usableAtDecision} observations knowable)`
          : `Macro snapshot: unavailable for this date`,
      );
    }
    if (d.domain === "crypto_derivatives") {
      notes.push(
        d.usableAtDecision > 0
          ? `Historical derivatives evidence: RECORDED / HISTORICAL (${d.datasetIds.length} datasets, ${d.usableAtDecision} knowable)`
          : `Historical derivatives evidence: unavailable for this date`,
      );
    }
    if (d.domain === "stock_fundamentals") {
      notes.push("Historical fundamental evidence: UNAVAILABLE (no point-in-time provider reachable)");
    }
    if (d.domain === "commodity_positioning" && !d.applied) {
      notes.push("Positioning: unavailable for this date");
    }
  }
  return { instrument, instrumentType, asOf: iso(asOfMs), domains, completeness, notes };
}

export function formatEvidenceCoverage(coverage: EvidenceCoverage): string[] {
  const lines = [
    `Non-price evidence for ${coverage.instrument} (${coverage.instrumentType}) as of ${coverage.asOf} — RECORDED / HISTORICAL`,
  ];
  for (const d of coverage.domains) {
    lines.push(
      `  · ${d.domain}: ${d.classification} | ${d.usableAtDecision}/${d.observations} observations knowable at the decision` +
        (d.from && d.to ? ` | ${d.from} → ${d.to}` : "") +
        ` | ${d.applied ? "applied" : `not applied (${d.reason ?? "no reason recorded"})`}`,
    );
  }
  lines.push(`  · Evidence completeness: ${coverage.completeness}`);
  for (const note of [...new Set(coverage.notes)]) lines.push(`  · ${note}`);
  return lines;
}

// ────────────────────────────────────────────────────────────────
// decision-time attachment (§11) — as-of evidence, engine fields only
// ────────────────────────────────────────────────────────────────

export interface EvidenceProvenanceRecord {
  domain: string;
  datasetId: string;
  provider: string;
  providerNativeId: string;
  classification: EvidenceSourceClassification;
  /** Provider instant(s) of the values actually used (verbatim labels). */
  observationInstants: string[];
  /** Earliest instant the newest used value was knowable. */
  availableFrom: string;
  valuesUsed: Record<string, number | string>;
}

export interface HistoricalEvidenceAttachment {
  derivativesData?: CryptoDerivativesData;
  cotData?: CotData;
  macroData?: MacroData;
  provenance: EvidenceProvenanceRecord[];
  coverage: EvidenceCoverage;
}

export interface EvidenceDecisionParams {
  instrument: string;
  instrumentType: string;
  /** Historical decision instant — the last CLOSED candle of the prefix. */
  asOfMs: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Funding may be a few settlements old; intraday series must be recent. */
const FUNDING_MAX_AGE_MS = 24 * HOUR;
const INTRADAY_MAX_AGE_MS = 6 * HOUR;
const COT_MAX_AGE_MS = 14 * DAY;
const MACRO_MAX_AGE_MS = 7 * DAY;

function datasetFor(
  registry: RecordedEvidenceRegistry,
  domain: EvidenceDomain,
  instrument: string,
  metric?: string,
): HistoricalEvidenceDataset | undefined {
  return registry.datasets.find(
    (d) =>
      d.meta.evidenceDomain === domain &&
      (metric === undefined || d.meta.metric === metric) &&
      (d.meta.sameUnderlyingAs ?? d.meta.instrument) === instrument,
  );
}

function provenanceOf(
  dataset: HistoricalEvidenceDataset,
  used: readonly EvidenceObservation[],
  valuesUsed: Record<string, number | string>,
): EvidenceProvenanceRecord {
  const newest = used[used.length - 1];
  return {
    domain: String(dataset.meta.evidenceDomain),
    datasetId: dataset.meta.datasetId,
    provider: dataset.meta.provider,
    providerNativeId: dataset.meta.providerNativeId,
    classification: dataset.meta.sourceClassification,
    observationInstants: used.map((o) => o.observedLabel),
    availableFrom: iso(newest.availableFrom),
    valuesUsed,
  };
}

function buildDerivatives(
  registry: RecordedEvidenceRegistry,
  params: EvidenceDecisionParams,
  provenance: EvidenceProvenanceRecord[],
): CryptoDerivativesData | undefined {
  const { instrument, asOfMs } = params;
  assertInstrumentDomainUsable(registry, "crypto_derivatives", instrument);

  const fundingDs = datasetFor(registry, "crypto_derivatives", instrument, "funding_rate");
  const oiDs = datasetFor(registry, "crypto_derivatives", instrument, "open_interest");
  const lsDs = datasetFor(registry, "crypto_derivatives", instrument, "long_short_account_ratio");

  const fundingObs = fundingDs
    ? observationAtOrBefore(fundingDs, asOfMs, { maxAgeMs: FUNDING_MAX_AGE_MS })
    : undefined;
  const oiObs = oiDs ? lastObservations(oiDs, asOfMs, 2, { maxAgeMs: INTRADAY_MAX_AGE_MS }) : [];
  const lsObs = lsDs ? observationAtOrBefore(lsDs, asOfMs, { maxAgeMs: INTRADAY_MAX_AGE_MS }) : undefined;

  if (!fundingObs && oiObs.length === 0 && !lsObs) return undefined;

  let fundingRate: FundingRateData | undefined;
  if (fundingObs && fundingDs) {
    const rate = fundingObs.values.realizedRate ?? fundingObs.values.fundingRate;
    if (typeof rate === "number") {
      fundingRate = { currentRate: rate };
      provenance.push(provenanceOf(fundingDs, [fundingObs], { realizedRate: rate }));
    }
  }

  let openInterest: OpenInterestData | undefined;
  if (oiObs.length > 0 && oiDs) {
    const newest = oiObs[oiObs.length - 1];
    const current = newest.values.openInterestUsd;
    if (typeof current === "number") {
      openInterest = { current };
      const values: Record<string, number | string> = { openInterestUsd: current };
      if (oiObs.length >= 2) {
        const prev = oiObs[oiObs.length - 2].values.openInterestUsd;
        if (typeof prev === "number" && prev > 0) {
          // Percentage change between the two most recent recorded hourly
          // observations at or before the decision — the same quantity the
          // live path reads, computed from RECORDED values only.
          const change1h = ((current - prev) / prev) * 100;
          openInterest.change1h = change1h;
          values.change1h = change1h;
        }
      }
      provenance.push(provenanceOf(oiDs, oiObs, values));
    }
  }

  let longShort: LongShortData | undefined;
  if (lsObs && lsDs) {
    const ratio = lsObs.values.accountRatio;
    if (typeof ratio === "number") {
      longShort = { accountRatio: ratio };
      provenance.push(provenanceOf(lsDs, [lsObs], { accountRatio: ratio }));
    }
  }

  if (!fundingRate && !openInterest && !longShort) return undefined;

  const freshInstants = [
    fundingObs ? fundingObs.availableFrom : undefined,
    oiObs.length > 0 ? oiObs[oiObs.length - 1].availableFrom : undefined,
    lsObs ? lsObs.availableFrom : undefined,
  ].filter((v): v is number => v !== undefined);
  const newestInstant = Math.max(...freshInstants);
  const intradayFresh =
    (oiObs.length > 0 && asOfMs - oiObs[oiObs.length - 1].availableFrom <= INTRADAY_MAX_AGE_MS) ||
    (lsObs !== undefined && asOfMs - lsObs.availableFrom <= INTRADAY_MAX_AGE_MS);
  const fundingFresh = fundingObs !== undefined && asOfMs - fundingObs.availableFrom <= FUNDING_MAX_AGE_MS;
  const confidence: CryptoDerivativesData["confidence"] =
    fundingFresh && intradayFresh ? "medium" : "low";
  const stale = asOfMs - newestInstant > FUNDING_MAX_AGE_MS;

  const parts: string[] = [];
  if (fundingRate) parts.push(`funding ${fundingRate.currentRate}`);
  if (openInterest) {
    parts.push(
      openInterest.change1h === undefined
        ? `open interest ${openInterest.current} USD (single observation)`
        : `open interest ${openInterest.current} USD (${openInterest.change1h.toFixed(3)}% vs previous recorded hour)`,
    );
  }
  if (longShort) parts.push(`account long/short ${longShort.accountRatio}`);
  return {
    provider: "okx",
    symbol: fundingDs?.meta.providerNativeId ?? oiDs?.meta.providerNativeId ?? "unknown",
    timestamp: newestInstant,
    freshness: stale ? "stale" : "delayed",
    fundingRate,
    openInterest,
    longShort,
    availability: {
      openInterest: openInterest !== undefined,
      fundingRate: fundingRate !== undefined,
      longShort: longShort !== undefined,
      liquidations: false,
    },
    confidence,
    interpretation:
      `Recorded OKX aggregate position for ${instrument} knowable at the decision (${parts.join("; ")}). ` +
      `Liquidation data is not recorded, so none is claimed. RECORDED / HISTORICAL — not a live feed.`,
  };
}

function assertInstrumentDomainUsable(
  registry: RecordedEvidenceRegistry,
  domain: EvidenceDomain,
  instrument: string,
): void {
  for (const d of registry.datasets) {
    if (d.meta.evidenceDomain !== domain) continue;
    if ((d.meta.sameUnderlyingAs ?? d.meta.instrument) !== instrument) continue;
    assertUsableForHistory(d);
  }
}

function buildCot(
  registry: RecordedEvidenceRegistry,
  params: EvidenceDecisionParams,
  provenance: EvidenceProvenanceRecord[],
): CotData | undefined {
  const { instrument, asOfMs } = params;
  const mapping = mapInstrumentToCot(instrument);
  if (!mapping) return undefined;
  const ds = registry.datasets.find(
    (d) =>
      d.meta.evidenceDomain === "cot_positioning" &&
      (d.meta.sameUnderlyingAs ?? d.meta.instrument) === instrument,
  );
  if (!ds) return undefined;
  if (ds.meta.applicableInReplay === false) return undefined;
  assertUsableForHistory(ds);

  const latestIdx = asOfIndex(ds, asOfMs);
  if (latestIdx < 0) return undefined;
  const latestObs = ds.observations[latestIdx];
  if (asOfMs - latestObs.availableFrom > COT_MAX_AGE_MS) return undefined;

  const toReport = (o: EvidenceObservation): CotReport => ({
    reportDate: String(o.values.reportDate ?? o.observedLabel),
    nonCommercialLong: Number(o.values.nonCommercialLong),
    nonCommercialShort: Number(o.values.nonCommercialShort),
    commercialLong:
      o.values.commercialLong === undefined ? undefined : Number(o.values.commercialLong),
    commercialShort:
      o.values.commercialShort === undefined ? undefined : Number(o.values.commercialShort),
    openInterest: o.values.openInterest === undefined ? undefined : Number(o.values.openInterest),
  });

  const latest = toReport(latestObs);
  const previous = latestIdx >= 1 ? toReport(ds.observations[latestIdx - 1]) : undefined;
  const netNonCommercial = latest.nonCommercialLong - latest.nonCommercialShort;
  const history = ds.observations
    .slice(Math.max(0, latestIdx - 11), latestIdx + 1)
    .map(toReport)
    .reverse();

  const context: CotContext = {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    // Publication instant of the newest report actually used. Recorded history
    // has no fetch wall-clock, and inventing one is forbidden.
    fetchedAt: latestObs.availableFrom,
    freshness: "DELAYED" as CotFreshness,
    requestedInstrument: instrument,
    sourceInstrument: ds.meta.providerNativeId,
    mappedAsset: mapping.mappedAsset,
    latest,
    previous,
    netNonCommercial,
    changeFromPreviousReport:
      previous === undefined
        ? undefined
        : netNonCommercial - (previous.nonCommercialLong - previous.nonCommercialShort),
    history,
  };
  provenance.push(
    provenanceOf(ds, ds.observations.slice(Math.max(0, latestIdx - 1), latestIdx + 1), {
      reportDate: String(latest.reportDate),
      nonCommercialLong: latest.nonCommercialLong,
      nonCommercialShort: latest.nonCommercialShort,
      openInterest: latest.openInterest ?? "",
    }),
  );
  return context;
}

function buildMacro(
  registry: RecordedEvidenceRegistry,
  params: EvidenceDecisionParams,
  provenance: EvidenceProvenanceRecord[],
): MacroData | undefined {
  const { asOfMs } = params;
  const series = registry.datasets.filter((d) => d.meta.evidenceDomain === "macro_rates");
  if (series.length === 0) return undefined;

  const indicators: MacroIndicator[] = [];
  let newest = -1;
  for (const ds of series) {
    assertUsableForHistory(ds);
    const obs = observationAtOrBefore(ds, asOfMs, { maxAgeMs: MACRO_MAX_AGE_MS });
    if (!obs) continue;
    const value = obs.values.percent;
    if (typeof value !== "number") continue;
    const label =
      ds.meta.providerNativeId === "DGS10"
        ? "US Treasury 10y constant maturity (FRED DGS10)"
        : ds.meta.providerNativeId === "DGS2"
          ? "US Treasury 2y constant maturity (FRED DGS2)"
          : `FRED ${ds.meta.providerNativeId}`;
    indicators.push({
      name: label,
      value: String(value),
      description:
        `Recorded observation ${obs.observedLabel} (${ds.meta.units ?? "percent"}). ` +
        `No direction is attached: this repository has no verified rate→direction rule, and a level is not a positioning signal.`,
      relevance: "medium",
    });
    newest = Math.max(newest, obs.availableFrom);
    provenance.push(provenanceOf(ds, [obs], { percent: value }));
  }
  if (indicators.length === 0 || newest < 0) return undefined;

  const ageMs = asOfMs - newest;
  return {
    provider: "fred",
    timestamp: newest,
    // No DXY series is recorded, so no dollar trend is claimed. The engine's
    // news-derived DXY proxy must not be smuggled in as if it were recorded macro.
    dxyTrend: undefined,
    indicators,
    summary:
      `Recorded US Treasury constant-maturity observations knowable at the decision (as of ${iso(newest)}). ` +
      `Carried as macro context only: no indicator here carries a sentiment, so this cannot move a conviction score.`,
    confidence: ageMs <= 3 * DAY ? "medium" : "low",
  };
}

/**
 * Assemble the as-of non-price evidence for one historical decision.
 *
 * The returned object contains ONLY fields the production engine already reads
 * (`derivativesData`, `cotData`, `macroData`) plus provenance and coverage.
 * Nothing here changes a gate, a threshold or a score rule: it supplies
 * evidence, or it supplies nothing.
 */
export function evidenceForDecision(
  registry: RecordedEvidenceRegistry,
  params: EvidenceDecisionParams,
): HistoricalEvidenceAttachment {
  const provenance: EvidenceProvenanceRecord[] = [];
  const coverage = evidenceCoverage(registry, params);

  const derivativesData =
    params.instrumentType === "crypto" ? buildDerivatives(registry, params, provenance) : undefined;
  const cotData =
    params.instrumentType === "forex" ? buildCot(registry, params, provenance) : undefined;
  const macroData =
    params.instrumentType === "stock" ? undefined : buildMacro(registry, params, provenance);

  return { derivativesData, cotData, macroData, provenance, coverage };
}
