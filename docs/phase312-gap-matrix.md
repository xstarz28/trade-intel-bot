# Phase 312 — PDF → Engine Gap Matrix

**Source note (honest):** the file `Panduan_Lengkap_Trading_Strategy_and_Risk_Management.pdf`
was NOT present in the workspace or repository this session. The matrix and the
implementation are driven by the **concept enumeration in the Phase-312 mission
statement** (the 11 modules). Per the source rule, every deterministic
operationalisation that the mission text does not itself specify numerically is
marked **ENGINE-DEFINED** in code — nothing is claimed to come from the PDF
verbatim where it cannot be verified. Underdetermined models stay PARTIAL or
informational with exact limitation strings.

| # | PDF concept | Existing implementation | Runtime input | Decision influence | Status | Phase-312 action |
|---|---|---|---|---|---|---|
| 1 | Trend / MA / HTF / LTF / MTF alignment | `data/technical.ts` (sma/ema/rsi/macd from real closes; `TechnicalData.sma50/100/200, ema20/50`), `data/mtf.ts` (TF ladder, chain), `data/structure.ts` (BOS/CHOCH, pair), engine counter-trend guard ("LTF signals alone do not reverse HTF context") | real OHLCV per timeframe | trend component of bias breakdown; regime | **IMPLEMENTED** | tests (1, 2) |
| 2 | Supply & Demand RBD/DBR/RBR/DBD, proximal/distal, lifecycle, price location | none (only OB/FVG) | — | none | **MISSING** | `strategy/zones.ts` (ENGINE-DEFINED geometry from real candles) + attach + tests (3–7) |
| 3 | Order Block (opposing candle + displacement + BOS) | `data/smc.ts detectOrderBlocks` — source candle, bounds, displacement, structural event, status | real OHLCV + structural read | setup context | **IMPLEMENTED** | tests (8) |
| 4 | FVG creation/bounds/mitigation/invalidation/timeframe | `data/smc.ts detectFvgs` (ATR noise policy, statuses) | real OHLCV | setup | **IMPLEMENTED** | tests (9) |
| 5 | Liquidity hunt BSL/SSL; sweep = wick+close-back; close-through = breakout; knowledge time | `data/smc.ts buildLiquidityPools` (equal highs/lows, causal `formedAtIndex`, source swings, sweep events) | real OHLCV | context | **IMPLEMENTED** | tests (10, 11) |
| 6 | Bull Flag / Bear Flag / Falling Wedge / Rising Wedge | none | — | none | **MISSING** | `strategy/patterns.ts` (deterministic swing geometry, ENGINE-DEFINED thresholds) + attach + tests (12–15) |
| 7 | Bullish/Bearish Pin Bar, 3-candle sandwich | none | — | none | **MISSING** | `strategy/candles.ts` (exact OHLCV body/wick math, ENGINE-DEFINED ratios) + tests (16–18) |
| 8 | ICT Unicorn Model | components exist (OB + FVG) but no composition | — | none | **NOT SAFELY AUTOMATABLE AS SPECIFIED** → partial composition | `strategy/unicorn.ts`: overlap of a validated OB with a same-direction FVG reported as **PARTIAL** with exact limitation; never labelled a complete detector (19) |
| 9 | Risk: RRR / 1R / position sizing / risk-per-trade | engine `tradePlan` (entry/SL/TP/RR from real levels); journal fields (entry/SL/TP/RR/positionSize) | real levels | plan/actionability | **PARTIAL** (no explicit sizing helper; risk-per-trade rule as silent policy would be wrong) | `strategy/risk.ts`: deterministic sizing, caller-supplied risk budget ONLY, PDF 1–2% exposed as an educational reference constant, non-executing; tests (29) |
| 10 | Journal / evaluation / Expected Value | journal table (snapshot, entry/SL/TP/RR, exit, pnl, outcome, closedAt, review fields); no R-multiple, no EV | recorded trades | evaluation | **PARTIAL** | `rMultiple` journal field (computed deterministically on close), `strategy/ev.ts` EV **only from recorded outcomes** with transparent formula; insufficient sample → unavailable; tests (30, 31) |
| 11 | BTC ↔ altcoin correlation | `lib/market-context.ts pearsonCorrelation` on RETURNS (n ≥ 20), `crossMarketComparator` in advanced technical | real return series | context | **IMPLEMENTED (generic)** | `strategy/correlation.ts` explicit BTC↔alt context (sample size, timeframe, provider, observedAt, context-only) + tests (26) |
| 12 | Probability / win-rate mathematics | `calibration.phase8`, unified policy | recorded evidence | confidence | **IMPLEMENTED** | EV complements it (30) |
| 13 | Trading-plan hierarchy (structure > setup > confirmation > execution; indicators secondary) | engine bias breakdown + hierarchy guards; RSI/MACD secondary | real evidence | ranking | **IMPLEMENTED** | explanation chain makes the distinction explicit (K) |
| 14 | Fundamental primary/secondary/supporting hierarchy | `fundamental/framework.ts` (roles, weights 3/2/1, supporting can never dictate, primary conflict → mixed) | real macro dimensions | fundamental state | **IMPLEMENTED** | tests (23, 24, 25) |
| 15 | Unified confluence as derivation | `market-radar/unified-confluence.ts` (+ engine builder) technical_only/fundamental_only/combined/insufficient | finished evidence | actionability | **IMPLEMENTED** | tests (21, 22) |
| 16 | Recommendation readiness w/o double counting | `recommendation-engine.ts` fixed weight classes + Phase-310 gates/caps | candidate facts | ranking | **IMPLEMENTED** | tests (27, 28) — new PDF concepts are descriptive-only and provably not scored |
| 17 | User-facing explanation chain | thesis/digest strings (scattered) | result fields | UX | **PARTIAL** | `strategy/explanation.ts`: ordered factual chain MARKET STRUCTURE → … → LIMITATIONS attached to the result; every missing layer says so |

**Deliberately NOT added:** score bonuses for zones/patterns/candles (would
double-count correlated evidence); any auto-applied account risk; any
"institutional"-grade language; invented Unicorn thresholds presented as
source-derived.

## Addendum (same phase, same session) — signal chart + adaptive plan + position sizing

| # | Addendum concept | Phase-312 implementation | Status |
|---|---|---|---|
| A1 | Timeframe completeness M1–W1, style policy intact, no silent substitution | chart/plan builders take the result's timeframe verbatim (tests A across the full matrix); `STYLE_PROFILES` setup-TF policy locked; missing candles → explicit chart-unavailable state | **IMPLEMENTED** |
| A2 | Signal response carries a chart drawn from the SAME real OHLCV (no AI image, no screenshots) | `strategy/chart.ts` → serializable `SignalChartSpec` (verbatim candles, FNV-1a input hash, window provenance) rendered by `SignalChartView.tsx` as inline SVG; overlays ONLY from objects actually detected (zones/OBs/FVGs/pools/plan levels/confirmations); `SignalCard` mounted in `AnalysisResultDisplay` | **IMPLEMENTED** |
| A3 | Entry/SL from actually-detected setups; SL never a bare percent/ATR | `strategy/trade-plan.ts`: setup-based entry (zone proximal → OB bound → FVG bound) with distal/far-edge invalidation; engine's structural stop/reference used verbatim otherwise, basis strings always exposed | **IMPLEMENTED** |
| A4 | Adaptive R:R from actual levels + instrument precision; structural targets preferred | riskDistance/rewardDistance/R multiple from real levels; TP2 only from a second REAL structural object (opposing zone / resting pool); forex pip math from spec | **IMPLEMENTED** |
| A5 | "Probability profit" — three statuses, never manufactured | `strategy/probability.ts`: historically_estimated (n≥10, Wilson 95% interval) / limited_sample (count only) / unavailable (no numbers); input is recorded journal outcomes ONLY | **IMPLEMENTED** |
| A6 | Adaptive target selection; poor/undefined expectancy lowers actionability | plan actionability VALIDATED/WAIT/NO_TRADE: negative recorded expectancy → NO_TRADE, undefined history → WAIT, user min-R:R unmet → WAIT; engine NO_TRADE is never upgraded; no score is touched | **IMPLEMENTED** |
| A7 | Crypto spot vs futures/perp mechanics; leverage never fakes R:R | `strategy/position.ts`: risk-first sizing via the existing `computePositionSizing`; leverage compatibility + conservative liquidation check ONLY from supplied contract metadata; funding caveat only with provider data; mechanics explanation always | **IMPLEMENTED** |
| A8 | Forex pips/lots with real conversion; else LOT SIZE UNAVAILABLE | pip size from spec (never assumed); standard/mini/micro nomenclature from the spec's contract size; missing conversion → exact "LOT SIZE UNAVAILABLE — missing conversion/spec evidence" | **IMPLEMENTED** |
| A9 | Stock shares = floor(risk / risk-per-share) with known constraints only | shares, risk per share, notional; broker constraints only from the supplied spec | **IMPLEMENTED** |
| A10 | Commodity units vs contracts via ACTUAL multiplier; never one universal lot | contracts/units only with a supplied contract multiplier; absent spec → explicit unavailable | **IMPLEMENTED** |
| A11 | User risk-policy input layer; default never risks money | `strategy/policy.ts`: equity/currency/risk%-or-fixed/style/product/maxLeverage/minRR; DEFAULT policy EMPTY — sizing and risk figures stay "not configured" until the user supplies them; 1–2% stays an educational reference constant | **IMPLEMENTED** |
| A12 | Signal card + chart UX structure | `SignalCard.tsx`: CHART → WHY → TRADE PLAN → POSITION MECHANICS → RISK (+probability status) → INVALIDATION → LIMITATIONS, provider-native identity + observedAt on top; fully i18n (9 locales, phase-145 ratchet updated 1337→1393 leaves) | **IMPLEMENTED** |
| A13 | No guaranteed-profit language | disclaimer reworded to a no-promise commitment; banned-phrase tests over source + rendered output; phase-13/191 invariants kept green | **IMPLEMENTED** |
| A14 | Chart provenance & reproducibility; explicit unavailable state | provider, providerInstrumentId, timeframe, verbatim timestamps, candle input hash in every spec; "Chart unavailable — insufficient OHLCV" state; synthetic candles impossible by construction | **IMPLEMENTED** |
| A15 | Addendum tests | 24 new pure items + 3 UI items (tests A–X + card/chart/probability renders): TF matrix, overlays-only-when-detected, hash stability, story chapters, R:R exactness, probability statuses, crypto/forex/stock/commodity sizing, leverage compatibility, LOT SIZE UNAVAILABLE, no-execution source scan, language scan, engine-attach acceptance | **IMPLEMENTED** |
| A16 | Architecture: no second engine, no double scoring | the signal layer is a read-only consumer of the finished result; recommendation candidates still carry no strategy/signal keys; no score path reads it (original test 27 + guard W) | **IMPLEMENTED** |
