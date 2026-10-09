# Xstarz Analysis — Agent Handoff

## Current checkpoint
- Working branch: `fix/radar-completeness-context`
- `main` and production have not been changed.
- Current branch is not assumed to be deployed.

## Confirmed fixes

1. **Radar completeness overstatement** — `src/lib/market-radar/candidate-builder.ts`
   - Snapshot fields plus prior analysis metadata alone remain `PARTIAL`; `FULL` requires actual contextual evidence from derivatives, fundamentals, COT, EIA, or Treasury/macro data.
   - Actual provider-reported candle row counts replace the old estimated 50-row value.

2. **Missing intelligence treated as contradiction** — `src/lib/recommendation-engine.ts`
   - Missing fundamental/macro/positioning layers no longer lower coherence as though they were opposing signals.
   - Regression coverage distinguishes missing evidence from actual opposition.

3. **Structural bias and outage fixture** — `src/lib/analysis-engine.ts`, `src/lib/chaos.phase8.test.ts`
   - Weighted evidence is aligned to the displayed 40/40/20 score breakdown, while external structure remains authoritative except for a validated HTF reversal.
   - The degraded-context test preserves the underlying neutral structure instead of accidentally substituting a default bullish fixture.

## Newly fixed candidate-to-ranking defect
- Dashboard scans previously computed only `INTRADAY` and `SWING`, while Market Opportunities exposes scalping and six investment horizons.
- Selecting a horizon missing from the scan result fell back to static zero-price/unavailable placeholders despite available live sources, producing an empty/incorrect view.
- `ALL_SCAN_HORIZONS` is now the shared horizon list for initial discovery, auto-scan, and manual refresh, with regression coverage for full horizon coverage.

## Analysis failure visibility
- Smoke must unwrap Playwright's `JSHandle` result with `jsonValue()` before comparing it to `"success"`; comparing the handle object itself creates a false failure even when output is present.
- The Dashboard previously rendered `fetchError` only inside the loading branch, then set `isAnalyzing=false` on error; the failure text disappeared and left the production smoke test waiting until timeout.
- Provider/analysis failures now remain visible after loading exits. The smoke harness waits for either a valid analysis result or the explicit error panel, and emits visible-page diagnostics on an unresolved timeout. This exposes failures; it does not by itself prove the provider/backend succeeded.

## Validation status
- Previous checkpoint `e73ef69528569837e028af5a3aff73d434f600d1`: CI passed typecheck/build and 7,397 tests across 178 test files. Lint still reports existing/advisory errors and is not claimed clean.
- The newly added horizon-coverage fix must still pass its own CI run before it is considered validated.
- No production deployment was triggered. Production end-to-end BTC/XAU analysis remains unverified.

## Next bounded task
- Verify score differentiation with real, verified OHLCV inputs from structurally distinct instruments. Add a regression only after identifying a reproducible scoring collapse; do not tune scores by assumption.
- A confirmed scoring-collapse cause was found in `src/lib/liveCandidateBuilder.ts`: a valid BOS on a ranging structure was ignored, making that actual directional break score as Neutral. Builder now falls back to BOS only when no directional HTF bias or HH/HL/LH/LL structure exists; regression tests cover bullish and bearish breaks.
- After CI confirms these changes, resume true end-to-end BTC and XAU analysis checks, without deploying to production until the deployment quota/status is known and a smoke test can be run.

## Guardrails
- Preserve provider-native instrument identity and provenance.
- Never synthesize live prices, technical direction, or evidence.
- Keep `main` and production untouched until validation is satisfactory.
- Do not label the product ready based on branch CI alone.
