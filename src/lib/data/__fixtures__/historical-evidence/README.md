# Recorded historical non-price evidence (Phase 296)

Every file in this directory is a **verbatim capture** of a real provider response, taken
once through the page-fetch transport (direct sandbox egress to these hosts is blocked).
Values are unmodified. No value was synthesised, interpolated, substituted or repaired.

## Classification

All eight datasets are `RECORDED_HISTORICAL`: the provider itself exposes the history, each
row carries its own observation instant, and the row is knowable at that instant (or at the
documented publication instant, for weekly COT). Nothing here is `CURRENT_ONLY`.

* `CURRENT_ONLY` — the provider returns only today's snapshot. Not captured here; such
  evidence never enters a historical decision.
* `UNAVAILABLE` — no reachable provider path. Recorded as a gap, never synthesised.
* `DESIGNED_TEST_FIXTURE` — synthetic rows used only to exercise mechanics. Never in
  empirical aggregates. This directory contains none of these.

## Datasets

| datasetId | provider | domain | cadence | rows | observation window |
| --- | --- | --- | --- | --- | --- |
| `okx-funding-rate-BTC-USDT-SWAP-8H` | okx | crypto derivatives | 8h settlements | 28 | 2026-09-21 → 2026-09-30 |
| `okx-open-interest-BTC-USDT-SWAP-1H` | okx | crypto derivatives | 1h | 76 | 2026-09-27 → 2026-09-30 |
| `okx-long-short-account-ratio-BTC-1H` | okx | crypto derivatives | 1h | 76 | 2026-09-27 → 2026-09-30 |
| `cftc-cot-EURO-FX-weekly` | cftc | COT positioning | weekly | 14 | 2026-06-23 → 2026-09-22 |
| `cftc-cot-BITCOIN-weekly` | cftc | COT positioning | weekly | 14 | 2026-06-23 → 2026-09-22 |
| `fred-DGS10-daily` | fred | macro rates | daily | 40 | 2026-08-03 → 2026-09-28 |
| `fred-DGS2-daily` | fred | macro rates | daily | 40 | 2026-08-03 → 2026-09-28 |
| `fred-alfred-DGS10-vintage-2026-09-25` | alfred | macro rates (point-in-time) | daily vintage | 11 | 2026-09-10 → 2026-09-24 |

Acquisition instant for all eight: `2026-09-30T03:53:27Z` (299 rows total).
Registry fingerprint: `fnv1a32:5b58092d`.

> Phase 297 note: this value was stale. The registry fingerprint is computed from each
> dataset's content-addressed fingerprint, and the `note` fields added to the two OKX 1H
> datasets after the first hash was taken changed it. The fingerprint below is the value the
> committed parser computes from these exact files; `evidence-consumption.phase297.test.ts`
> re-derives it from the directory so the documented value cannot drift again.
> Nothing about the rows, the values, the classification or the as-of rules changed.

The BTC COT contract is captured but marked `applicableInReplay: false`: the repository's COT
mapping is explicitly limited to verified CFTC futures contracts (EUR/USD, GBP/USD, AUD/USD,
USD/JPY, USD/CAD, USD/CHF, gold, silver, WTI) and has no crypto entry, so the report is
recorded-without-application rather than forced onto a spot pair.

## As-of semantics

Each dataset declares an `availabilityRule`. Two shapes are used, both conservative:

* **observation-instant** (OKX funding/OI/long-short): available from the row's own provider
  instant. Publication time equals the funding settlement instant for realised funding.
* **publication-instant** (CFTC COT): the Tuesday report is only knowable after the
  documented Friday 15:30 America/New_York publication.
* **conservative end-of-day** (FRED daily series): a daily value is treated as knowable only
  from the end of its observation date. This *delays* availability; it can never leak a
  value into an earlier decision.
* **vintage** (ALFRED): the provider's own as-known-at record, used to verify that our FRED
  values are the values that were available at the time.

## What is deliberately missing

* **Commodity positioning / XAU/USD, WTI**: the reachable provider paths used here do not
  serve commodity price or positioning history. No substitution was made (never XAU/USD →
  BTC, never WTI → an unrelated instrument). Recorded as a gap.
* **Point-in-time stock fundamentals**: Alpha Vantage requires a key and Twelve Data's free
  tier exposes only the current snapshot. Market cap / P/E from a later date must never enter
  an older decision, so no equities fundamentals dataset is captured. The equity series in
  the candle corpus therefore replays without a fundamentals layer — honestly, and visibly.
* **Economic-calendar history**: no reachable provider path for historical calendars.
