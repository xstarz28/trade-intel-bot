/**
 * Phase 294 — RECORDED FIXTURE REGISTRY (§1, §5, §6, §13).
 *
 * Every entry here is a dataset actually served by the named provider and
 * transcribed verbatim (see each file's `captureMethod`, `requestPages` and
 * `capturedAt`). Nothing in this list is generated, resampled or extended: if a
 * provider does not serve a series, the series is ABSENT and the gap is
 * recorded as a limitation instead of being filled in.
 *
 * The registry is also the record of what is NOT available:
 *   · Twelve Data's public demo key refuses commodity symbols (XAU/USD → 401),
 *     so no commodity history could be captured with it;
 *   · OKX serves crypto only, so no stock/forex history exists from OKX.
 * Both gaps are stated, never substituted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ParsedDataset, RecordedDatasetFile } from "./dataset";
import { HISTORICAL_SCHEMA_VERSION, asDatasetFile, parseCandleRows } from "./dataset";

export interface RecordedFixtureEntry {
  /** File name inside `src/lib/data/__fixtures__/historical/`. */
  file: string;
  provider: string;
  assetClass: "crypto" | "forex" | "stock";
  providerInstrumentId: string;
  timeframe: string;
}

/** Deterministic order: asset class, then instrument, then timeframe ladder. */
export const RECORDED_FIXTURES: readonly RecordedFixtureEntry[] = [
  { file: "okx-BTC-USDT-1W.json", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT", timeframe: "W1" },
  { file: "okx-BTC-USDT-1D.json", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT", timeframe: "D1" },
  { file: "okx-BTC-USDT-4H.json", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT", timeframe: "H4" },
  { file: "okx-BTC-USDT-1H.json", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT", timeframe: "H1" },
  { file: "twelvedata-EURUSD-1D.json", provider: "twelve-data", assetClass: "forex", providerInstrumentId: "EUR/USD", timeframe: "D1" },
  { file: "twelvedata-EURUSD-4H.json", provider: "twelve-data", assetClass: "forex", providerInstrumentId: "EUR/USD", timeframe: "H4" },
  { file: "twelvedata-AAPL-1D.json", provider: "twelve-data", assetClass: "stock", providerInstrumentId: "AAPL", timeframe: "D1" },
  { file: "twelvedata-AAPL-1W.json", provider: "twelve-data", assetClass: "stock", providerInstrumentId: "AAPL", timeframe: "W1" },
] as const;

/** Asset classes a provider genuinely serves history for, as captured. */
export const CAPTURED_ASSET_CLASSES = ["crypto", "forex", "stock"] as const;

/**
 * Documented acquisition gaps. These are observations about provider access,
 * recorded with the response the provider actually returned.
 */
export const ACQUISITION_GAPS: readonly { assetClass: string; symbol: string; reason: string }[] = [
  {
    assetClass: "commodity",
    symbol: "XAU/USD",
    reason:
      "Twelve Data's public demo key refuses commodity symbols (HTTP 401, \"demo API key is only used for initial familiarity\"); no other configured provider serves commodity OHLCV here. No substitute instrument was used.",
  },
  {
    assetClass: "commodity",
    symbol: "CSV export path",
    reason:
      "The provider's CSV representation returned HTTP 500 through the capture transport, so only its JSON representation was used — no value was reconstructed from a failed response.",
  },
] as const;

export function fixturePath(file: string): string {
  return fileURLToPath(new URL(`../data/__fixtures__/historical/${file}`, import.meta.url));
}

export function loadRecordedFixture(file: string): ParsedDataset {
  const raw = JSON.parse(readFileSync(fixturePath(file), "utf8")) as unknown;
  const parsed = asDatasetFile(raw);
  if (parsed.dataset.schemaVersion !== HISTORICAL_SCHEMA_VERSION) {
    throw new Error(`${file}: schema version ${parsed.dataset.schemaVersion}≠${HISTORICAL_SCHEMA_VERSION}`);
  }
  if (parsed.dataset.sourceClassification !== "RECORDED_HISTORICAL") {
    throw new Error(`${file}: ${parsed.dataset.sourceClassification} is not recorded provider history`);
  }
  return parseCandleRows(parsed.dataset, parsed.rows);
}

export interface RecordedFixtures {
  datasets: ParsedDataset[];
  byId: Map<string, ParsedDataset>;
  gaps: typeof ACQUISITION_GAPS;
}

/** Load and validate every recorded fixture once (deterministic order). */
export function loadRecordedFixtures(entries: readonly RecordedFixtureEntry[] = RECORDED_FIXTURES): RecordedFixtures {
  const datasets = entries.map((entry) => {
    const parsed = loadRecordedFixture(entry.file);
    const meta = parsed.provenance;
    if (meta.provider !== entry.provider || meta.timeframe !== entry.timeframe) {
      throw new Error(`${entry.file}: registry says ${entry.provider}/${entry.timeframe}, file says ${meta.provider}/${meta.timeframe}`);
    }
    return parsed;
  });
  return {
    datasets,
    byId: new Map(datasets.map((d) => [d.provenance.datasetId, d])),
    gaps: ACQUISITION_GAPS,
  };
}

/** The raw file shape, for tests that must inspect the recording verbatim. */
export function loadRecordedFixtureFile(file: string): RecordedDatasetFile {
  return asDatasetFile(JSON.parse(readFileSync(fixturePath(file), "utf8")) as unknown);
}
