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
