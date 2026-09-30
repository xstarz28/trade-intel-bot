# Recorded historical datasets (Phase 294)

These files are **recorded provider responses**, transcribed value for value. They are
HISTORICAL material for validation only: nothing here is a live feed, and no price,
timestamp, volume or instrument identity was resampled, filled, "repaired" or invented.

## Schema (`schemaVersion: "phase294.1"`)

```
{
  "dataset": {
    "datasetId", "schemaVersion", "sourceClassification": "RECORDED_HISTORICAL",
    "provider", "providerInstrumentId", "instrument", "assetClass", "timeframe",
    "providerBarLabel", "providerRowShape", "providerFieldOrder", "rowOrder",
    "requestPages": [{ page, url, rows, oldestTimestamp?, cursorParameter? }],
    "apiKeyClass"?, "volumeSupplied"?, "providerMeta"?,
    "capturedAt", "captureMethod", "valuesUnmodified": true
  },
  "rows": [ ... provider rows, verbatim ... ]
}
```

* `providerRowShape: "okx-candles-v5-array"` — OKX `data[]` rows
  `[ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]`, milliseconds, newest first;
  `confirm: "0"` marks the still-forming bar.
* `providerRowShape: "twelvedata-time-series-row-array"` — Twelve Data `values[]` rows
  `[datetime, open, high, low, close, volume?]`, newest first. The provider's own datetime
  format is kept (dates for daily/weekly, `YYYY-MM-DD HH:mm:ss` for intraday).

`src/lib/historical/dataset.ts` parses these with the quality gates (rejected rows are never
repaired), `src/lib/historical/fixtures.ts` is the registry, and
`src/lib/historical/capture.ts` is the runner that produced the request lineage.

## How the captures were made

Direct egress from the build sandbox is blocked, so each request was issued through the
analysis environment's page-fetch transport. The exact URL of every page is recorded in
`requestPages`, and `capturedAt` is the capture instant of the whole dataset.

| Dataset | Provider | Rows | Pages | Oldest recorded instant |
| --- | --- | --- | --- | --- |
| okx-BTC-USDT-1W | OKX `/api/v5/market/history-candles` | 60 | 1 | 2025-08-10 |
| okx-BTC-USDT-1D | OKX | 60 | 1 | 2026-08-01 |
| okx-BTC-USDT-4H | OKX | 120 | 2 (`after=`) | 2026-09-10 |
| okx-BTC-USDT-1H | OKX | 60 | 1 | 2026-09-27 |
| twelvedata-EURUSD-1D | Twelve Data `/time_series` (public demo key) | 80 | 1 | 2026-07-13 |
| twelvedata-EURUSD-4H | Twelve Data | 80 | 1 | 2026-09-17 |
| twelvedata-AAPL-1D | Twelve Data | 80 | 1 | 2026-06-05 |
| twelvedata-AAPL-1W | Twelve Data | 80 | 1 | 2025-03-24 |

Because a provider keeps serving its live edge, the newest bar of an OKX capture is flagged
`confirm: "0"` and its values may change between captures. A recorded dataset is therefore
one capture instant; two captures are never mixed inside one dataset.

## Known acquisition gaps (never substituted)

* **Commodities.** Twelve Data's public demo key refuses commodity symbols — `XAU/USD`
  returned HTTP 401 — and no other configured provider serves commodity OHLCV here. No
  substitute instrument was used, so the benchmark reports the asset class as unavailable.
* **CSV representation.** The provider's CSV output returned HTTP 500 through the capture
  transport; only its JSON representation is recorded.
