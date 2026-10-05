# Phase 314 — External Evidence Closure + Multi-Asset Live Acceptance

**Date:** 2026-10-05 · **Branch:** `arena/01a0d195-trade-intel-bot` · **Base:** `803dab3` (phase 313)

Source rule unchanged: every statement here is verifiable from the repository.
Nothing is claimed integrated unless code actually consumes it; nothing is
claimed LIVE unless the runtime actually reached the provider.

---

## 1. Phase-313 inherited gaps → disposition matrix

Dispositions: **CLOSED** (implemented this phase) · **ALREADY COVERED** (the
engine already consumes legitimate evidence; verified at runtime level) ·
**EXTERNAL DEPENDENCY** (credentials/licensing/unsupported API) ·
**NOT A VALID GAP** (market structure, not an engine defect) · **DEFER**
(research-grade, revisit only with a real credential).

| Gap (inherited from 313) | Asset class | Disposition | Detail |
|---|---|---|---|
| CoinGlass ETF flows | crypto | **EXTERNAL DEPENDENCY** | the existing CoinGlass integration exposes OI/funding/longShort/liquidations only; ETF endpoints are not part of the integration, and no ETF provider exists in the repository. UNAVAILABLE state preserved — never invented. |
| CoinGlass options data | crypto | **EXTERNAL DEPENDENCY** | same as above; options IV/skew remain reported unavailable by the existing unavailableMetrics contract. |
| Derivatives volume (per-exchange taker/deriv volume) | crypto | **EXTERNAL DEPENDENCY** | not a dataset in the existing CoinGlass action; adding it would be a new acquisition path (breadth, not a demonstrated gap — the L/S taker ratio already covers taker-side positioning when the provider supplies it). |
| Deeper crypto fundamentals (fees/revenue/TVL) | crypto | **ALREADY COVERED** | DeFiLlama (chain TVL + fees) and Tokenomist (tokenomics) are integrated and consumed by the crypto fundamental assessment (phase-279 suites re-verified green this phase). |
| Token Terminal | crypto | **EXTERNAL DEPENDENCY** (+ duplication) | paid API key not present in the repository; its fee/revenue evidence is already supplied keylessly by DeFiLlama — integration would duplicate existing evidence. Exact blocker: no `TOKEN_TERMINAL_API_KEY`, paid endpoint. |
| Nansen / Dune / SoSoValue / SpotOnChain | crypto | **DEFER** | research-grade: Nansen = licensed wallet/entity intelligence; Dune = curated-query platform (no stable structured endpoint without a key); SoSoValue = undocumented ETF-flow access; SpotOnChain = alert-grade feeds. None has repository credentials; none closes a demonstrated gap the existing stack lacks. |
| Forex positioning | forex | **ALREADY COVERED** | CFTC COT weekly futures positioning is integrated with provider-verbatim release rows, mapped contracts (mappedAsset identity, never symbol substitution), weekly release freshness windows (COT_FRESH_DAYS 10 / DELAYED 17), and historical positioning never labelled real-time. No decentralized funding/OI equivalent exists for OTC forex — **NOT A VALID GAP** by market structure. |
| Forex rates/yields | forex | **ALREADY COVERED** | US Treasury curve (forex+commodity context), released calendar actuals with expected/previous when the provider supplies them, USD regime with the actual-DXY-over-proxy redundancy rule. |
| Forex calendar depth | forex | **ALREADY COVERED** | TickAtlas calendar: released events provider-verbatim; strikes learned within-run; a failed calendar leg is an explicit evidence gap (adversarial test B re-locked). |
| Forex spread/liquidity | forex | **EXTERNAL DEPENDENCY** (not a universal feed) | no existing repository provider supplies a real forex bid/ask book; OTC forex has no centralized order book — fabricating spread would be an unsafe assumption. Stated unavailable honestly. |
| Non-oil inventory (metals/agriculture) | commodities | **EXTERNAL DEPENDENCY** | no configured provider supplies metals/agriculture inventory releases; EIA WPSR stays oil-only by design (gold asserts the layer "not applicable" — adversarial matrix re-locked). Never generalizes oil data to other commodities. |
| Commodity positioning/rates/USD | commodities | **ALREADY COVERED** | COT mapped commodity contracts + Treasury + USD regime + EIA (oil) with exact observed timestamps and provenance. |
| Stock fundamentals (earnings/EPS/valuation) | stocks | **ALREADY COVERED** | Alpha Vantage OVERVIEW+EARNINGS → `fundamentalData` → `scoreFundamentals` (bounded factor) AND `assessFundamentals` equity domain (quarterly earnings history, revenue/earnings growth, margins, multiples) → unified reasoning → reasoning chain → signal card. Stale reporting is labelled against the payload's own observation instant. |
| Sector/benchmark context | stocks | **CLOSED (descriptive)** | phase 314 surfaces the provider-reported Name/Sector/Industry as a provenance-complete evidence item (`company_classification`, provider + providerInstrumentId + observedAt). Labels are explicitly never benchmarked: sector-relative valuation remains stated UNAVAILABLE — no synthetic peers, no sector averages. A true benchmark series would be an **EXTERNAL DEPENDENCY** (no provider in the repository supplies sector aggregates). |
| Stock events (company news/earnings dates) | stocks | **ALREADY COVERED** | Alpha Vantage news/sentiment leg runs for stocks with per-dataset cache identity; event-level earnings dates are never assumed (no fabricated earnings calendar). |
| Stock market regime | stocks | **ALREADY COVERED** | the same technical/MTF/regime stack applies; broad-market benchmark index evidence would be a new provider (breadth — rejected for now). |
| Non-crypto order book / microstructure | forex/commodities/stocks | **NOT A VALID GAP** (as a universal) + **EXTERNAL DEPENDENCY** (per-venue) | no existing provider supplies real non-crypto books. OTC forex is decentralized (no universal book exists to integrate); equity/commodity markets are fragmented across venues (a single venue's book would misrepresent the market). The Execution layer already states "no validated order-book provider for this asset class"; bid/ask depth is never reconstructed from candles. A venue-native feed (e.g. a specific exchange) would be per-venue only and is deferred unless it closes a demonstrated gap. |

## 2. Exact implementations this phase

1. **Stock company classification closure** — `fundamental-engine.ts`: the
   equity assessment now emits a provenance-complete evidence item
   (`company_classification`: name/sector/industry, unit "label", source
   "OVERVIEW (Name/Sector/Industry)", native identity, observedAt) into the
   assessment evidence list. Descriptive only — no dimension status, no score,
   benchmarking still explicitly unavailable.
2. **Chart provenance-mismatch guard** — `strategy/chart.ts`: when the result
   carries the strategy context's candle provenance, a rendering request with a
   DIFFERENT candle series (count/first/last mismatch) is refused with an
   explicit "provenance mismatch" unavailable state. A chart can no longer be
   rendered from evidence other than the analysis snapshot.
3. **Dependency-registry expansion** — `strategy/evidence-groups.ts` adds
   `stock_quality` (P/E + margin + EPS, one payload, bounded by the ±2 factor
   clamp), `crypto_onchain` (TVL + fees + tokenomics — context-only, nothing to
   cap), `rates_yields` (Treasury + calendar rate surprises + USD regime — each
   bounded by its own layer/factor clamp, DXY proxy yields to actual DXY),
   `smc_location` (zone/OB/FVG co-location — one Location layer). The phase-313
   `derivatives_state` cap (±2) is unchanged and its single additive consumption
   point is locked by source inspection in the test suite.
4. **Adversarial + acceptance suite** — `src/lib/phase314.evidence-closure.test.ts`
   (22 items): all mission §10 attacks (A–J) and the §9 cross-asset acceptance
   matrix (4 classes × M1/M5/M15/H1 full signal-shape assertions + M30/H4/D1/W1
   chart re-lock), stock classification trace, registry completeness, and the
   disposition/provider-doc locks below.

## 3. Provider decision table (final; unchanged from 313 unless stated)

| Provider | Decision | Evidence actually consumed at runtime | Credential | Freshness/provenance | Duplication risk | Budget impact |
|---|---|---|---|---|---|---|
| Twelve Data | KEEP | OHLCV/quotes all classes (native ids) | TWELVEDATE key (deployment) | per-leg observedAt | none | core budget |
| OKX | KEEP | crypto order book + instrument specs (execution layer, sizing specs) | none (public) | snapshot ts + fetchedAt | none | bounded |
| Alpha Vantage | KEEP (EXPAND realized) | news sentiment, macro indicators, stock OVERVIEW+EARNINGS (+ NEW: sector/industry classification surfaced 314) | key (deployment) | Phase-238 single-read observedAt | none | shared cache |
| CoinGlass | KEEP (reused, no duplicate) | derivatives family (OI/funding/LS/liquidations), family-capped ±2; context in crypto fundamentals | COINGLASS_API_KEY required else CREDENTIAL_REQUIRED | provider observation ts, freshness window | — (single additive consumer) | 4 legs, bounded |
| CFTC | KEEP | COT weekly positioning (forex/commodity mapped contracts) | none | release rows verbatim, weekly windows | none | bounded |
| Treasury | KEEP | yield-curve macro context (forex/commodity) | none | XML feed ts | none | bounded |
| EIA | KEEP | WPSR petroleum stocks (oil only; exact observed timestamps) | key (deployment) | release-verbatim | none | bounded |
| DeFiLlama | KEEP | chain TVL + protocol fees → crypto fundamental assessment | keyless | provider observedAt | none (unique on-chain evidence) | keyless/bounded |
| Tokenomist | KEEP | tokenomics/supply context (optional Bearer key) | TOKENOMIST_API_KEY optional | provider observedAt | none | bounded |
| CoinGecko | KEEP | crypto spot market/discovery identity | key optional | per-leg | none | bounded |
| TickAtlas | KEEP | economic calendar (released events verbatim) | key (deployment) | release timestamps | none | bounded |
| fx-rate | KEEP | account-currency conversion for sizing | none | rate snapshot + staleness | none | bounded |
| Token Terminal | DEFER | — | paid key absent; fees/revenue already via DeFiLlama (duplication) | — | high if added | — |
| Nansen | DEFER | — | license absent | — | — | — |
| Dune | DEFER | — | key + curated queries absent | — | — | — |
| SoSoValue | DEFER | — | no documented structured access | — | — | — |
| SpotOnChain | DEFER | — | research-grade alerts, no deterministic contract | — | — | — |
| CoinMarketCap | REJECT | — | — | — | duplicates OHLCV/price | breadth only |
| OrionTerminal | REJECT | — | — | — | no unique intelligence | breadth only |
| IntentX | REJECT | — | — | — | no unique intelligence | breadth only |

**No provider was added in phase 314** — every closure used existing integrations;
the only new code paths are descriptive/protective (classification evidence,
chart provenance guard, dependency registry, tests).

## 4. Evidence dependency groups (final registry, phase 313+314)

| Family | Members | Additive cap |
|---|---|---|
| derivatives_state | funding, OI change, L/S ratio, liquidation dominance | **±2** |
| technical_trend | trend factor, MAs, structure | core-breakdown bounds |
| usd_regime | DXY proxy, actual DXY, treasury context | proxy yields to actual |
| news_sentiment | average score, article breakdown | one factor |
| oil_supply_state | EIA WPSR change | one layer, oil-only |
| stock_quality | P/E, profit margin, EPS | **±2** (factor clamp) |
| crypto_onchain | TVL, fees, tokenomics | context-only (cap null) |
| rates_yields | treasury curve, calendar rate surprises, USD regime | each bounded by own clamp/cap |
| smc_location | zone/OB/FVG/setup state | one Location layer |

Historical probability remains journal-derived ONLY (sample size, Wilson 95%
interval, limited_sample/unavailable semantics) — re-locked per class this phase.

## 5. Runtime acceptance

**LIVE-ACCEPTANCE-BLOCKED:** this sandbox's egress policy permits only
api.github.com and registry.npmjs.org — no market-data provider endpoint is
reachable, and the standing phase-310 rule forbids live provider smoke merely to
prove rendering when provider-runtime semantics did not change (they did not:
no provider, acquisition path, or credential contract changed in 313/314).
Therefore NO source is marked LIVE from this environment, and the live
acceptance remains exactly as scoped in RUN-311 (operator-run, one pass, after
the Convex env setup).

Runtime contract validated instead through the existing deterministic runtime
suites (engine end-to-end, fanout/cache envelope, protected-analysis gate,
generalization slice) — all green this phase. Nothing about discovery,
provider budget, evidence provenance, dashboard recommendations, trade-plan,
chart rendering, risk engine or auth changed behaviourally.

## 6. No-data semantics preserved (adversarially locked)

Calendar unavailable → explicit flag + fundamental UNAVAILABLE (never a macro
conclusion); EIA unavailable → "EIA data unavailable" (oil) / "not applicable"
(non-oil); stock earnings unavailable → `insufficient`, metrics empty, "never
fabricated"; missing contract size → sizing unavailable; missing journal →
probability unavailable; cross-symbol payloads rejected; stale payloads rejected
with the staleness reason; partial fetch failures surface per-leg; mismatched
chart candles refused. No zero-fill anywhere.

## 7. Test coverage

`phase314.evidence-closure.test.ts` — 22 items. Re-verified green this phase:
phase312 (34+24), phase313 (22), fundamental equity/engine/cross-domain/domain-summary suites, signal-card UI. Full regression results in RUN-314.

## 8. Remaining external gaps (complete list)

CoinGlass ETF flows & options & per-exchange derivatives volume; Token Terminal
/ Nansen / Dune / SoSoValue / SpotOnChain (credentials/licensing/structure);
non-oil commodity inventory releases; universal non-crypto order book (market
structure) and per-venue books; stock sector benchmark aggregates; broad-market
index benchmark feed. Each is stated UNAVAILABLE/EXTERNAL DEPENDENCY in the
engine's own outputs — nothing is simulated.
