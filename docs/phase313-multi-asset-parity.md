# Phase 313 — Multi-Asset Intelligence Parity + Provider Gap Closure

**Date:** 2026-10-05 · **Branch:** `arena/01a0d195-trade-intel-bot` · **Base:** `3f04ffc` (phase 312 incl. addendum)

Source rule unchanged: every threshold/flag here is **ENGINE-DEFINED** or quotes an
existing engine contract. Nothing is claimed to come from an external document.

---

## 1. Current architecture (audited, unchanged by this phase)

One unified pipeline; asset classes differ ONLY in the evidence they naturally carry:

```
instrument → provider/native identity (providerInstrumentId, never substituted)
  → discovery (universal cycle; no hardcoded symbol whitelist)
  → OHLCV acquisition (timeframe verbatim; freshness/provenance per leg)
  → technical/SMC (data/technical, data/smc) → MTF (data/mtf, TF ladder)
  → fundamentals/macro (fundamental-engine.assessFundamentals — DOMAIN-ROUTED)
  → evidence (advancedTechnicalEvidence, decisionTrace layers, provenance)
  → strategy engine (strategy/*: zones, patterns, candles, unicorn, correlation)
  → probability/history (journal-derived only) → risk (lib/risk.ts, singular)
  → trade-plan (strategy/trade-plan.ts) → chart (strategy/chart.ts)
  → dashboard/signal card → reasoning chain
```

Audit confirmations:
- `assessFundamentals` routes by instrumentType: crypto → tokenomics/DeFi/derivatives-context; forex → two-sided macro/calendar/treasury; commodity → treasury/COT/EIA; stock → AV OVERVIEW+EARNINGS. One contract, four evidence profiles. CoinGlass derivatives inside the crypto assessment are INFORMATIONAL and provably cannot move the fundamental state (phase-279 contract, still green).
- One sizing engine (`lib/risk.ts`); `strategy/position.ts` only forwards inputs and shapes product presentation. One execution surface: none (nothing places orders).
- No parallel intelligence engine exists; phase-313 added no second engine and no new scoring path.

## 2. CoinGlass status — REUSED, already integrated (no duplicate)

`convex/coinglass.ts fetchDerivatives`: four legs (openInterest, fundingRate,
longShort, liquidations), per-leg availability + provider observation timestamps,
`COINGLASS_API_KEY` required (`CREDENTIAL_REQUIRED` when absent —
runtime-readiness), budget-impacting like every leg. Consumed by:
- `scoreSentiment` (engine) — now as ONE dependency family (§5);
- `derivatives-bridge` → radar candidates (strict base-asset identity, provider
  freshness window, per-dataset availability; cross-symbol payloads rejected, never re-labelled);
- `attachAdvancedTechnical` (context) and the crypto fundamental assessment (context-only).

ETF flows / options data: NOT available from the existing CoinGlass integration —
stated as unavailable; nothing simulated.

## 3. Crypto on-chain gap analysis — candidates already integrated or decided

Existing (since phase 279): **DeFiLlama** (chain TVL + fees via
`data/crypto/defillama-adapter.ts`) and **Tokenomist** (tokenomics) through
`crypto-fundamentals` leg → `cryptoIntelligenceContext` → crypto fundamental
assessment on the same deterministic contract as equity. The mission's
"potential additions" therefore mostly already exist:

| Candidate | Decision | Reason |
|---|---|---|
| DeFiLlama | **KEEP** (already integrated) | keyless, structured, provenance OK, unique TVL/fees evidence |
| Token Terminal | **DEFER** | paid API key required; no credential available; would duplicate fee/revenue evidence DeFiLlama already supplies |
| Nansen | **DEFER** | licensed research-grade wallet intelligence; no structured keyless access; operational risk |
| Dune | **DEFER** | query-based, no stable structured endpoint without curated queries + key |
| SoSoValue | **DEFER** | ETF-flow data unstructured/undocumented for automated use |
| SpotOnChain | **DEFER** | wallet/entity alerts; research-grade, no deterministic contract |
| CoinMarketCap | **REJECT** | no unique evidence (price/OHLCV covered by OKX/twelve-data); breadth-only |
| OrionTerminal / IntentX | **REJECT** | no unique intelligence; breadth-only |

## 4. Asset-class parity matrix

Legend: **COMPLETE** · **PARTIAL** · **EXTERNAL_DATA_GAP** · **UNAVAILABLE** ·
**RESTRICTED**. "Weaker" is never graded where a market has no such data
naturally; the row grades whether the engine extracts the best legitimate
evidence available.

| Dimension | Crypto | Forex | Commodities | Stocks |
|---|---|---|---|---|
| DATA QUALITY (OHLCV/native identity) | COMPLETE (okx/twelve-data) | COMPLETE (twelve-data) | COMPLETE (twelve-data) | COMPLETE (twelve-data) |
| TECHNICAL DEPTH (trend/MA/SMC/S&D/OB/FVG/patterns/confirmations) | COMPLETE (same stack) | COMPLETE (same stack) | COMPLETE (same stack) | COMPLETE (same stack) |
| MTF DEPTH | COMPLETE (TF ladder) | COMPLETE | COMPLETE | COMPLETE |
| FUNDAMENTAL DEPTH | COMPLETE (tokenomics/DeFi/derivatives-context; phase-279 contract) | COMPLETE (calendar released actuals, two-sided policy/inflation hierarchy) | PARTIAL (treasury/COT/EIA-oil; non-oil supply releases absent → EXTERNAL_DATA_GAP for metals/agri inventories) | COMPLETE (AV OVERVIEW+EARNINGS: P/E, margin, EPS) |
| MACRO DEPTH | PARTIAL (macro indicators + calendar where supplied; no dedicated crypto-macro feed) | COMPLETE (calendar + treasury yields + USD regime incl. actual-DXY redundancy control) | COMPLETE (treasury + USD regime; EIA oil-only by design) | PARTIAL (sector context stored but unscored — no sector-benchmark provider; broad-market regime via market data) |
| POSITIONING/ORDER-FLOW DEPTH | COMPLETE (CoinGlass derivatives family, capped ±2; OKX order book when reachable) | PARTIAL (COT FX-futures weekly where mapped; no decentralized funding/OI feed exists naturally — not a defect) | PARTIAL (COT commodity contracts where mapped; EIA for oil) | PARTIAL (no COT mapping; insider/13F not available — honest unavailable) |
| HISTORICAL EVIDENCE | COMPLETE (journal R/EV/probability, key-matched) | COMPLETE | COMPLETE | COMPLETE |
| RISK/SIZING | COMPLETE (spot/perp; leverage compatibility from real specs only) | COMPLETE (pips/lots; LOT SIZE UNAVAILABLE without conversion) | COMPLETE (contracts via actual multiplier; below-one-step → unavailable) | COMPLETE (shares; constraints from spec only) |
| TRADE-PLAN + CHART | COMPLETE (phase-312 addendum) | COMPLETE | COMPLETE | COMPLETE |
| PROVENANCE | COMPLETE (provider-native id, observedAt/knownAt) | COMPLETE | COMPLETE | COMPLETE |
| FRESHNESS | COMPLETE (per-leg states) | COMPLETE | COMPLETE | COMPLETE |
| FAILURE SEMANTICS | COMPLETE (explicit unavailable; no zero-fill) | COMPLETE | COMPLETE | COMPLETE |

No asset class is scored by provider count. Crypto's extra feeds (derivatives)
are one correlated family; forex/commodities' missing equivalents are natural
market-structure facts, not engine defects.

## 5. Evidence dependency groups (phase-313 change)

`strategy/evidence-groups.ts` — the canonical registry:

| Family | Underlying state | Members | Additive cap |
|---|---|---|---|
| `derivatives_state` | crypto derivatives positioning | funding, OI change, L/S ratio, liquidation dominance | **±2** (was uncapped ±4 in `scoreSentiment`) |
| `technical_trend` | price trend | trend factor, MAs, structure | bounded by core breakdown weights |
| `usd_regime` | USD strength | DXY proxy, actual DXY comparator, treasury context | proxy yields to actual data (existing rule) |
| `news_sentiment` | media sentiment | average score, article breakdown | one payload inside one factor |
| `oil_supply_state` | petroleum balance | EIA WPSR change | one provider, one layer, oil-only |

The only behavioural change this phase: the CoinGlass block in `scoreSentiment`
now sums its four correlated readings and clamps the SUM to ±2. Individual
directions are preserved; four agreeing readings can no longer masquerade as
four independent confirmations. Locked by deterministic engine tests.

## 6. Provider/source inventory — decisions

| Provider | Evidence | Decision | Reason |
|---|---|---|---|
| twelve-data | OHLCV/quotes (all classes) | **KEEP** | core market data, native ids, provenance |
| okx | crypto order book + instrument specs | **KEEP** | unique execution-grade liquidity/spec evidence; crypto-only by design |
| alpha-vantage | news sentiment, macro indicators, stock fundamentals | **EXPAND** | stock OVERVIEW+EARNINGS already wired; expansion = ensure fundamentals leg surfaces in stock signals (done in 312/313 signal plumbing) |
| coinglass | crypto derivatives (OI/funding/LS/liquidations) | **KEEP** (reused, not duplicated) | unique derivatives evidence; now family-capped |
| cftc | COT weekly futures positioning | **KEEP** | unique positioning for forex/commodity futures |
| treasury | yield curve macro context | **KEEP** | macro driver for forex/commodity |
| eia | WPSR petroleum stocks | **KEEP** | oil supply/demand releases; oil-only stated honestly |
| defillama | chain TVL + protocol fees | **KEEP** | already integrated (phase 279) |
| tokenomist | tokenomics/supply | **KEEP** | already integrated; optional key supported |
| coingecko | crypto spot market data | **KEEP** | discovery/identity coverage |
| tickatlas | economic calendar | **KEEP** | released-events provider-verbatim semantics |
| fx-rate | account-currency conversion | **KEEP** | sizing conversion honesty |
| Token Terminal / Nansen / Dune / SoSoValue / SpotOnChain | research-grade crypto fundamentals | **DEFER** | credentials/licensing/structure — see §3 |
| CoinMarketCap / OrionTerminal / IntentX | breadth-only | **REJECT** | no unique intelligence gap closed |

No new provider was added this phase: the audit demonstrated the candidate gaps
were already covered or blocked by genuine external dependencies (credentials/
licensing), which is the only permitted deferral reason.

## 7. Known external data gaps (explicit, never fabricated)

- Forex/commodities/stocks: no centralized funding/OI/liquidation equivalent — crypto-only by market structure.
- Non-oil commodity inventory releases (metals/agriculture): EXTERNAL_DATA_GAP (no configured provider).
- CoinGlass ETF flows / options: not available from the current plan/integration — UNAVAILABLE.
- Stock sector benchmarks, insider/13F: UNAVAILABLE (sector stored but deliberately unscored).
- Order-book spread/liquidity: crypto (OKX) only; other classes state spread honestly unavailable.
- Sizing: any missing contract size/pip size/quantity step/conversion → explicit UNAVAILABLE (LOT SIZE UNAVAILABLE semantics).

## 8. Tests (this phase)

`src/lib/phase313.multi-asset-parity.test.ts` (22 items):
derivatives-state family cap (all-4 = ±2, symmetric, non-binding below cap, unavailable-stays-unavailable), CoinGlass bridge identity reuse, cross-class architecture parity (chain headings, chart/plan, product mechanics isolation, probability key isolation), timeframe matrix M1…W1 × 4 classes (no substitution, verbatim provenance), style-policy setup TFs with explicit fallback, MTF coherence, per-class honesty (crypto no-derivatives flag, forex no-calendar flag, commodity EIA not-applicable, stock fundamentals path), NO_TRADE/WAIT parity, singular sizing engine + no-execution scan, byte-determinism, and the provider-decision doc lock (every inventoried provider has a decision; breadth-only candidates REJECTed).

Plus a sizing-integrity fix locked by existing suites: `computePositionSizing`
now reports `below one quantity step … size nothing rather than rounding up
beyond the budget` instead of an available-but-zero position (phase-4/292
suites still green; the more-specific instrument-minimum reason is preserved).

## 9. Remaining limitations

- Deferred crypto-research providers (§3) require credentials/licensing that do not exist in this deployment.
- CoinGlass ETF/options legs remain unavailable until the integration's plan supplies them.
- Sector-relative stock valuation stays unscored until a real sector-benchmark source exists.
- The 12 known full-suite failures (git ref-drift in `src/lib/deployment` + the phase-299 dist check) are pre-existing and unrelated to analysis correctness.
