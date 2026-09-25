/**
 * Phase 279 — CRYPTO-NATIVE fundamental adapter (domain evidence → assessment).
 *
 * A crypto asset has no company: it has a supply schedule, a network and a
 * market structure. This adapter therefore reads ONLY crypto-native evidence,
 * and each dimension below states exactly which provider dataset produced it:
 *
 *   TOKEN ECONOMICS   Tokenomist supply + unlock schedule  → supply, dilution
 *   PROTOCOL/NETWORK  DeFiLlama chain TVL and fee summary  → protocol economics
 *   VALUATION CONTEXT price × provider-reported supply     → DERIVED, disclosed
 *   MARKET STRUCTURE  CoinGlass OI/funding/L-S/liquidations→ INFORMATIONAL only
 *
 * INFORMATIONAL means the engine ALREADY scores that exact provider evidence
 * (sentiment/derivatives factor, Phase 278 market context). It is reported here
 * as traceable context with its own provenance, and it never moves the
 * fundamental state — so one CoinGlass field can never be counted twice.
 *
 * HONESTY RULES ENFORCED HERE
 *   · The provider-native identity is preserved verbatim on every item.
 *   · Tokenomics/protocol datasets carry no provider-stamped observation
 *     instant, so the recorded instant is the ACQUISITION RECEIPT and the
 *     freshness is HISTORICAL, never "FRESH" (Phase 267 doctrine).
 *   · Supply/emission figures are never estimated from each other: a missing
 *     total supply yields NO dilution ratio, not a guess.
 *   · Derived values (market cap, FDV, dilution pressure) are flagged derived
 *     and carry the exact provider inputs they combine.
 *   · Evidence the configured providers do not supply (active addresses, on-chain
 *     valuation, options/ETF flows, staking, exchange flows) stays UNAVAILABLE
 *     with a reason — never a zero, never a placeholder.
 */

import type { CryptoIntelligenceContext } from "@/lib/data/crypto/types";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type {
  CryptoFundamentalMetrics,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalEvidenceItem,
} from "@/lib/data/fundamental-contract";
import {
  PUBLICATION_FRESHNESS,
  aggregateConfidence,
  coverageOf,
  dimension,
  isFiniteNumber,
  unavailable,
  type DimensionHierarchyEntry,
} from "./framework";

export interface CryptoFundamentalContext {
  /** Canonical instrument the assessment is about (never substituted). */
  instrument: string;
  /** Routing provider identity (okx / ccxt…), verbatim. */
  provider?: string;
  /** Exact provider/native instrument id ("BTC-USDT"), verbatim. */
  providerInstrumentId?: string;
  /** Phase 41 crypto intelligence context (Tokenomist / DeFiLlama / CoinGlass). */
  crypto?: CryptoIntelligenceContext;
  /** CoinGlass derivatives evidence, already fetched by the live pipeline. */
  derivatives?: CryptoDerivativesData;
  /** REAL market price used only for the DERIVED market-cap context. */
  price?: number;
  priceObservedAt?: number;
  priceProvider?: string;
}

/**
 * The dimension space this domain defines. The assessment always reports all
 * of them so an unavailable one is visible as unavailable rather than absent.
 */
export const CRYPTO_DIMENSIONS = [
  "supply-structure",
  "unlock-dilution",
  "protocol-economics",
  "valuation-context",
  "network-activity",
  "on-chain-valuation",
  "market-positioning",
  "options-etf-flows",
] as const;

/**
 * Documented thresholds — every directional crypto reading cites one of these.
 * They are deliberately few and stated in supply/valuation terms; no score.
 */
export const CRYPTO_PARAMETERS = {
  /** Circulating ≥ this share of total supply → little dilution left ahead. */
  lowDilutionCirculatingPercent: 80,
  /** Circulating < this share → a material overhang of supply remains. */
  highDilutionCirculatingPercent: 60,
  /** Unlock ≥ this % of circulating inside the window → material dilution. */
  materialUnlockPercent: 5,
  /** FDV/market-cap at or below this → minor future-supply overhang. */
  minorOverhangFdvToMcap: 1.25,
  /** FDV/market-cap above this → material future-supply overhang. */
  materialOverhangFdvToMcap: 2,
  /** TVL change (%) inside the window treated as network growth/contraction. */
  tvlMaterialChangePercent: 2,
  /**
   * Phase 281 — account long/short ratio at (or beyond) which the book is one
   * sided. Symmetric: 1 / 2 = 0.5 marks the other extreme.
   */
  crowdedLongShortRatio: 2,
  /** 24h open-interest change (%) at which a positioning build is flagged. */
  crowdedOpenInterestChangePercent: 25,
  /**
   * |annualized funding| (%) at or beyond which the funding leg of the
   * market-structure context is reported as extreme. The provider's own
   * annualized figure is used verbatim when supplied — this adapter never
   * annualizes a per-interval rate itself.
   */
  extremeFundingAnnualizedPercent: 50,
} as const;

/** The engine layer that already scores the derivatives evidence. */
const MARKET_STRUCTURE_CONSUMER =
  "technical/derivatives scoring in the analysis engine (sentiment factor, Phase 278 market context)";

/**
 * Phase 281 — DOCUMENTED EVIDENCE HIERARCHY for a crypto asset.
 *
 * A token has no company and no balance sheet: what it has is a supply
 * schedule and a network. Those two are therefore the PRIMARY evidence; the
 * vesting schedule is SECONDARY (a scheduled future dilution next to the
 * measured current supply structure); the derived market-cap/FDV reading is
 * SUPPORTING, because it re-expresses the very same provider supply in market
 * terms and must never be counted as a second supply signal; and the
 * dimensions no configured provider supplies (chain activity, on-chain
 * valuation, options/ETF flows) keep the lowest role so that a future wiring
 * change is configuration, not new scoring logic.
 *
 * Nothing here is symbol-specific: every crypto instrument is classified by
 * this one configuration.
 */
export const CRYPTO_HIERARCHY: DimensionHierarchyEntry[] = [
  { name: "supply-structure", role: "primary" },
  { name: "protocol-economics", role: "primary" },
  { name: "unlock-dilution", role: "secondary" },
  { name: "network-activity", role: "secondary" },
  { name: "on-chain-valuation", role: "secondary" },
  { name: "valuation-context", role: "supporting" },
  { name: "market-positioning", role: "supporting" },
  { name: "options-etf-flows", role: "supporting" },
];

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Deterministically assess CRYPTO fundamentals.
 *
 * No clock: freshness/staleness are properties of the payloads, and the only
 * instants used are the ones the provider payloads already carry.
 */
export function assessCryptoFundamentals(context: CryptoFundamentalContext): FundamentalAssessment {
  const { instrument, provider, providerInstrumentId, crypto, derivatives, price } = context;
  const nativeId = providerInstrumentId?.trim() || instrument;
  const tokenomics = crypto?.tokenomics?.available ? crypto.tokenomics : undefined;
  const defi = crypto?.defi?.available ? crypto.defi : undefined;
  const marketStructure = derivatives && derivatives.confidence !== "unavailable" ? derivatives : undefined;

  const evidence: FundamentalEvidenceItem[] = [];
  const metrics: CryptoFundamentalMetrics = {};
  const dimensions: FundamentalDimension[] = [];
  const comparisons: string[] = [];
  const contradictions: string[] = [];
  const limitations: string[] = [];

  // ── Unavailable fast path (no crypto evidence at all) ──────────
  if (!tokenomics && !defi && !marketStructure) {
    return unavailableCryptoAssessment({
      instrument: nativeId,
      provider,
      limitations: [
        "No crypto-native fundamental evidence was supplied for this instrument — tokenomics and protocol datasets are unavailable, and nothing is estimated from price or volume.",
        "Traditional company fundamentals (revenue, EPS, margins, P/E) do not apply to a crypto asset and are never shown for one.",
      ],
    });
  }

  const providers: string[] = [];
  if (tokenomics) providers.push(tokenomics.provider);
  if (defi) providers.push(defi.provider);
  if (marketStructure) providers.push(marketStructure.provider);
  if (isFiniteNumber(price) && typeof context.priceProvider === "string" && context.priceProvider.length > 0) {
    providers.push(context.priceProvider);
  }

  // ── A. Token economics — supply and dilution pressure ──────────
  {
    const supply = tokenomics?.supply;
    const circulating = supply?.circulatingSupply;
    const total = supply?.totalSupply;
    const circulatingPercent = supply?.circulatingPercent;

    if (isFiniteNumber(circulating)) {
      metrics.circulatingSupply = circulating;
      evidence.push({
        metric: "circulating_supply",
        label: "Circulating supply",
        value: circulating,
        unit: "tokens",
        provider: tokenomics!.provider,
        providerInstrumentId: nativeId,
        source: "Tokenomist supply dataset",
        observedAt: tokenomics!.observedAt,
        observedAtSemantics: "acquisition-receipt",
        period: "as published at the provider response",
        freshness: PUBLICATION_FRESHNESS,
      });
    }
    if (isFiniteNumber(total)) {
      metrics.totalSupply = total;
      evidence.push({
        metric: "total_supply",
        label: "Total supply",
        value: total,
        unit: "tokens",
        provider: tokenomics!.provider,
        providerInstrumentId: nativeId,
        source: "Tokenomist supply dataset",
        observedAt: tokenomics!.observedAt,
        observedAtSemantics: "acquisition-receipt",
        period: "as published at the provider response",
        freshness: PUBLICATION_FRESHNESS,
      });
    }
    if (isFiniteNumber(circulatingPercent)) {
      metrics.circulatingPercent = circulatingPercent;
      metrics.dilutionPressurePercent = 100 - circulatingPercent;
      evidence.push({
        metric: "circulating_percent",
        label: "Circulating share of supply",
        value: circulatingPercent,
        unit: "%",
        provider: tokenomics!.provider,
        providerInstrumentId: nativeId,
        source: "Tokenomist supply dataset (circulating ÷ total)",
        observedAt: tokenomics!.observedAt,
        observedAtSemantics: "acquisition-receipt",
        freshness: PUBLICATION_FRESHNESS,
        derived: true,
        basis: "provider-reported circulating supply ÷ provider-reported total supply",
      });
    }

    if (isFiniteNumber(circulatingPercent)) {
      const p = CRYPTO_PARAMETERS;
      const status =
        circulatingPercent >= p.lowDilutionCirculatingPercent
          ? "positive"
          : circulatingPercent < p.highDilutionCirculatingPercent
            ? "negative"
            : "neutral";
      dimensions.push(
        dimension(
          "supply-structure",
          status,
          `${circulatingPercent.toFixed(1)}% of the reported total supply is circulating (${isFiniteNumber(circulating) ? `${Math.round(circulating).toLocaleString("en-US")} of ` : ""}${isFiniteNumber(total) ? Math.round(total).toLocaleString("en-US") : "an unreported total"}) — dilution pressure ${(100 - circulatingPercent).toFixed(1)}% of supply still to be released. Source ${tokenomics!.provider}, observed ${new Date(tokenomics!.observedAt).toISOString()}.`,
        ),
      );
    } else if (isFiniteNumber(circulating)) {
      dimensions.push(
        dimension(
          "supply-structure",
          "neutral",
          `Circulating supply ${Math.round(circulating).toLocaleString("en-US")} tokens reported by ${tokenomics!.provider} (observed ${new Date(tokenomics!.observedAt).toISOString()}); total supply was not supplied, so no dilution ratio is computed.`,
        ),
      );
      limitations.push(
        "Total supply was not supplied — supply dilution pressure cannot be quantified (no default and no estimate is used).",
      );
    } else {
      dimensions.push(unavailable("supply-structure"));
      limitations.push(
        "Supply UNAVAILABLE — no provider supplied circulating or total supply for this instrument.",
      );
    }
  }

  // ── B. Token economics — unlock schedule (dilution) ────────────
  {
    const unlocks = tokenomics?.unlocks;
    if (unlocks && unlocks.reliable) {
      const pct = unlocks.unlockPercentOfCirculating;
      metrics.upcomingUnlocks30d = unlocks.upcomingCount30d;
      if (isFiniteNumber(unlocks.upcomingValue30d)) metrics.upcomingUnlockAmount30d = unlocks.upcomingValue30d;
      if (isFiniteNumber(pct)) metrics.unlockPercentOfCirculating = pct;

      evidence.push({
        metric: "upcoming_unlocks_30d",
        label: "Upcoming unlocks (30 days)",
        value: unlocks.upcomingCount30d,
        unit: "events",
        provider: tokenomics!.provider,
        providerInstrumentId: nativeId,
        source: "unlock schedule",
        observedAt: tokenomics!.observedAt,
        observedAtSemantics: "acquisition-receipt",
        period: "rolling 30 days from the provider observation",
        freshness: PUBLICATION_FRESHNESS,
        ...(isFiniteNumber(pct)
          ? {
              derived: true,
              basis: "provider-reported unlock amount ÷ provider-reported circulating supply",
            }
          : {}),
      });

      // Phase 41 doctrine stands: an unlock is CONTEXT. Zero scheduled unlocks
      // is NOT bullish evidence, and a small unlock is not bearish evidence —
      // only a MATERIAL unlock (documented threshold) counts as dilution.
      const material = isFiniteNumber(pct) && pct >= CRYPTO_PARAMETERS.materialUnlockPercent;
      dimensions.push(
        dimension(
          "unlock-dilution",
          material ? "negative" : "neutral",
          isFiniteNumber(pct)
            ? `${unlocks.upcomingCount30d} scheduled unlock event(s) totaling ${isFiniteNumber(unlocks.upcomingValue30d) ? `${Math.round(unlocks.upcomingValue30d).toLocaleString("en-US")} tokens ` : ""}= ${pct.toFixed(2)}% of circulating supply in the provider's 30-day window${material ? ` — material dilution (≥ ${CRYPTO_PARAMETERS.materialUnlockPercent}% of circulating)` : " — below the documented material-dilution threshold, so it is context, not a dilution signal"}. ${unlocks.summary ? `${unlocks.summary} ` : ""}Source ${tokenomics!.provider}, observed ${new Date(tokenomics!.observedAt).toISOString()}.`
            : `${unlocks.upcomingCount30d} scheduled unlock event(s) inside the provider's 30-day window (${unlocks.summary ?? "no summary supplied"}); the unlocked amount was not supplied, so magnitude is not assessed. Source ${tokenomics!.provider}, observed ${new Date(tokenomics!.observedAt).toISOString()}.`,
        ),
      );
      if (unlocks.upcomingCount30d === 0) {
        limitations.push(
          "No scheduled unlock events inside the provider's window — recorded as context only; the absence of unlocks is not treated as bullish evidence.",
        );
      }
      limitations.push(
        "Emission/inflation schedule UNAVAILABLE — no configured provider supplies an issuance-rate schedule; it is never derived from supply snapshots.",
      );
    } else {
      dimensions.push(unavailable("unlock-dilution"));
      limitations.push(
        "Unlock schedule UNAVAILABLE — no configured provider returned vesting data for this instrument; dilution overhang is never estimated.",
      );
    }
  }

  // ── C. Network / protocol economics — TVL, fees ────────────────
  {
    const tvl = defi?.tvl;
    const fees = defi?.fees;
    const tvlCurrent = tvl?.reliable ? tvl.current : undefined;
    const change30d = isFiniteNumber(tvl?.change30d) ? tvl!.change30d : undefined;
    const change7d = isFiniteNumber(tvl?.change7d) ? tvl!.change7d : undefined;
    const windowPct = change30d ?? change7d;

    if (isFiniteNumber(tvlCurrent) || (fees?.reliable && isFiniteNumber(fees.dailyFees))) {
      if (isFiniteNumber(tvlCurrent)) {
        metrics.tvlCurrent = tvlCurrent;
        evidence.push({
          metric: "tvl",
          label: "Total value locked",
          value: tvlCurrent,
          unit: "USD",
          provider: defi!.provider,
          providerInstrumentId: nativeId,
          source: "chain TVL history (latest point)",
          observedAt: defi!.observedAt,
          observedAtSemantics: "acquisition-receipt",
          period: "latest observation of the provider series",
          freshness: PUBLICATION_FRESHNESS,
        });
      }
      if (change30d !== undefined) {
        metrics.tvlChange30dPercent = change30d;
        evidence.push({
          metric: "tvl_change_30d",
          label: "TVL change (30 days)",
          value: change30d,
          unit: "%",
          provider: defi!.provider,
          providerInstrumentId: nativeId,
          source: "chain TVL history (30-day comparison)",
          observedAt: defi!.observedAt,
          observedAtSemantics: "acquisition-receipt",
          freshness: PUBLICATION_FRESHNESS,
          derived: true,
          basis: "provider TVL point ~30 days before the latest ÷ latest provider TVL point",
        });
      }
      if (change7d !== undefined) metrics.tvlChange7dPercent = change7d;

      // Phase 281 — the provider's own FEE windows. A fee trend is a second,
      // genuinely different measurement of protocol health (usage) next to the
      // locked value (TVL); both come from the same provider dataset, which is
      // exactly why they are combined INSIDE this one dimension instead of
      // being scored as two.
      const feeWindowPct = isFiniteNumber(fees?.feeChange30d)
        ? fees!.feeChange30d
        : isFiniteNumber(fees?.feeChange7d)
          ? fees!.feeChange7d
          : undefined;
      if (isFiniteNumber(fees?.feeChange30d)) metrics.feesChange30dPercent = fees!.feeChange30d;
      if (isFiniteNumber(fees?.feeChange7d)) metrics.feesChange7dPercent = fees!.feeChange7d;

      // Each real window is material-or-not on its own; the dimension is
      // directional only when every measured window points the same way.
      const legs: { label: string; pct: number }[] = [];
      if (windowPct !== undefined) {
        legs.push({ label: `TVL over the provider's ${change30d !== undefined ? "30-day" : "7-day"} window`, pct: windowPct });
      }
      if (feeWindowPct !== undefined) {
        legs.push({
          label: `provider fees over the provider's ${isFiniteNumber(fees?.feeChange30d) ? "30-day" : "7-day"} window`,
          pct: feeWindowPct,
        });
      }
      const material = CRYPTO_PARAMETERS.tvlMaterialChangePercent;
      const positives = legs.filter((l) => l.pct >= material).length;
      const negatives = legs.filter((l) => l.pct <= -material).length;
      const status: FundamentalDimension["status"] =
        legs.length === 0
          ? "neutral"
          : positives === legs.length
            ? "positive"
            : negatives === legs.length
              ? "negative"
              : "neutral";
      const legText =
        legs.length === 0
          ? `${isFiniteNumber(tvlCurrent) ? `TVL $${tvlCurrent.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "TVL not supplied"} with no comparable prior point, so no growth is claimed`
          : legs.map((l) => `${formatPercent(l.pct)} in ${l.label}`).join(" and ") +
            (legs.length > 1 && positives > 0 && negatives > 0
              ? " — the two provider measurements disagree, so no protocol-growth direction is claimed"
              : "");
      dimensions.push(
        dimension(
          "protocol-economics",
          status,
          `${isFiniteNumber(tvlCurrent) ? `TVL $${tvlCurrent.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "TVL not supplied"}; ${legText}${fees?.reliable && isFiniteNumber(fees.dailyFees) ? `; daily protocol fees $${fees.dailyFees.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}. Source ${defi!.provider}, observed ${new Date(defi!.observedAt).toISOString()}.`,
        ),
      );

      if (fees?.reliable && isFiniteNumber(fees.dailyFees)) {
        metrics.dailyFees = fees.dailyFees;
        evidence.push({
          metric: "daily_fees",
          label: "Daily protocol fees",
          value: fees.dailyFees,
          unit: "USD",
          provider: defi!.provider,
          providerInstrumentId: nativeId,
          source: "protocol fees summary (total24h)",
          observedAt: defi!.observedAt,
          observedAtSemantics: "acquisition-receipt",
          period: "trailing 24 hours at the provider observation",
          freshness: PUBLICATION_FRESHNESS,
        });
      }

      // Phase 281 — provider-reported protocol REVENUE, when the provider's
      // own revenue series answers. The fee-derived estimate some layers show
      // is never used here as reported revenue.
      if (fees?.reliable && isFiniteNumber(fees.revenue24h)) {
        metrics.protocolRevenue24h = fees.revenue24h;
        evidence.push({
          metric: "protocol_revenue_24h",
          label: "Protocol revenue (24h, provider-reported)",
          value: fees.revenue24h,
          unit: "USD",
          provider: defi!.provider,
          providerInstrumentId: nativeId,
          source: "protocol revenue summary (dataType=dailyRevenue, total24h)",
          observedAt: defi!.observedAt,
          observedAtSemantics: "acquisition-receipt",
          period: "trailing 24 hours at the provider observation",
          freshness: PUBLICATION_FRESHNESS,
        });
      } else {
        limitations.push(
          "Protocol revenue UNAVAILABLE as provider evidence — the provider's revenue series did not answer for this instrument, and a fee-derived estimate is not treated as reported revenue.",
        );
      }
      if (feeWindowPct === undefined) {
        limitations.push(
          "Fee trend UNAVAILABLE — the provider's fee summary carried no 7/30-day comparison for this instrument, so no fee growth is claimed from a single point.",
        );
      }
      limitations.push(
        "Stablecoin liquidity UNAVAILABLE — no configured provider returns stablecoin supply for this instrument.",
      );
    } else {
      dimensions.push(unavailable("protocol-economics"));
      limitations.push(
        "Protocol economics UNAVAILABLE — no configured provider returned TVL or fee evidence for this instrument.",
      );
    }
  }

  // ── D. Valuation context — DERIVED market cap vs FDV ───────────
  {
    const circulating = metrics.circulatingSupply;
    const total = metrics.totalSupply;
    if (isFiniteNumber(price) && isFiniteNumber(circulating)) {
      const marketCapDerived = price * circulating;
      metrics.marketCapDerived = marketCapDerived;
      const observed = context.priceObservedAt ?? tokenomics?.observedAt ?? 0;
      evidence.push({
        metric: "market_cap",
        label: "Market capitalisation",
        value: marketCapDerived,
        unit: "USD",
        provider: `${context.priceProvider ?? "market price"} + ${tokenomics!.provider}`,
        providerInstrumentId: nativeId,
        source: "derived from market price × provider-reported circulating supply",
        observedAt: observed,
        ...(context.priceObservedAt !== undefined
          ? { observedAtSemantics: "provider-observation" as const }
          : { observedAtSemantics: "acquisition-receipt" as const }),
        freshness:
          context.priceObservedAt !== undefined
            ? "provider price observation + published supply dataset"
            : PUBLICATION_FRESHNESS,
        derived: true,
        basis: `market price × provider-reported circulating supply`,
      });
    }
    if (isFiniteNumber(price) && isFiniteNumber(total)) metrics.fdvDerived = price * total;

    if (
      isFiniteNumber(metrics.marketCapDerived) &&
      isFiniteNumber(metrics.fdvDerived) &&
      metrics.marketCapDerived > 0
    ) {
      const ratio = metrics.fdvDerived / metrics.marketCapDerived;
      const p = CRYPTO_PARAMETERS;
      const status =
        ratio <= p.minorOverhangFdvToMcap ? "positive" : ratio > p.materialOverhangFdvToMcap ? "negative" : "neutral";
      dimensions.push(
        dimension(
          "valuation-context",
          status,
          `FDV/market-cap ${ratio.toFixed(2)}× (FDV ${usd(metrics.fdvDerived)} vs market cap ${usd(metrics.marketCapDerived)})${ratio > p.materialOverhangFdvToMcap ? " — a material future-supply overhang" : ratio <= p.minorOverhangFdvToMcap ? " — little future-supply overhang" : " — moderate future-supply overhang"}. Both figures are DERIVED from the live market price and the provider-reported supply, not provider-reported valuation metrics.`,
        ),
      );
      limitations.push(
        "Market cap and FDV are DERIVED (market price × provider-reported supply) — not provider-reported valuation metrics; they describe supply structure, not a fair value.",
      );
      if (
        status === "negative" &&
        isFiniteNumber(metrics.unlockPercentOfCirculating) &&
        metrics.unlockPercentOfCirculating >= CRYPTO_PARAMETERS.materialUnlockPercent
      ) {
        contradictions.push(
          "Valuation carries a large future-supply overhang while a material unlock is already scheduled inside the provider's 30-day window — two independent dilution pressures measured by separate provider datasets.",
        );
      }
    } else if (isFiniteNumber(metrics.dilutionPressurePercent)) {
      dimensions.push(
        dimension(
          "valuation-context",
          "neutral",
          `Supply overhang known (${metrics.dilutionPressurePercent.toFixed(1)}% of supply not yet circulating) but no market-cap/FDV ratio is computed: ${isFiniteNumber(price) ? "total supply was not supplied" : "no live market price was supplied to the assessment"}.`,
        ),
      );
      if (!isFiniteNumber(price)) {
        limitations.push(
          "Derived market-cap/FDV context UNAVAILABLE — no market price was supplied, and a price is never assumed.",
        );
      }
    } else {
      dimensions.push(unavailable("valuation-context"));
      limitations.push("Valuation context UNAVAILABLE — neither supply structure nor price evidence was supplied.");
    }
  }

  // ── E. Network activity — no configured provider supplies it ───
  dimensions.push(unavailable("network-activity"));
  limitations.push(
    "Network activity (active addresses, transaction count, developer activity) UNAVAILABLE — no configured provider supplies chain activity for this instrument, and usage is never inferred from TVL or price.",
  );

  // ── F. On-chain valuation — no configured provider supplies it ─
  dimensions.push(unavailable("on-chain-valuation"));
  limitations.push(
    "On-chain valuation metrics (realized cap, MVRV, SOPR, NVT-style, exchange flows, holder concentration) UNAVAILABLE — no configured provider supplies them, and they are never approximated from price and volume.",
  );

  // ── G. Market-structure context — INFORMATIONAL (already scored) ─
  {
    const ms = marketStructure;
    const bits: string[] = [];
    if (ms) {
      if (ms.availability?.openInterest && ms.openInterest) {
        bits.push(
          `open interest $${ms.openInterest.current.toLocaleString("en-US", { maximumFractionDigits: 0 })}${isFiniteNumber(ms.openInterest.change24h) ? ` (${formatPercent(ms.openInterest.change24h)} 24h)` : ""}`,
        );
        evidence.push({
          metric: "open_interest",
          label: "Open interest",
          value: ms.openInterest.current,
          unit: "USD",
          provider: ms.provider,
          providerInstrumentId: nativeId,
          source: `derivatives dataset (open interest; provider symbol ${ms.symbol})`,
          observedAt: ms.timestamp,
          freshness: String(ms.freshness),
          consumedElsewhere: MARKET_STRUCTURE_CONSUMER,
        });
      }
      if (ms.availability?.fundingRate && ms.fundingRate) {
        bits.push(
          `funding rate ${ms.fundingRate.currentRate}${isFiniteNumber(ms.fundingRate.annualizedRate) ? ` (annualized ${ms.fundingRate.annualizedRate})` : ""}`,
        );
        evidence.push({
          metric: "funding_rate",
          label: "Funding rate",
          value: ms.fundingRate.currentRate,
          unit: "ratio",
          provider: ms.provider,
          providerInstrumentId: nativeId,
          source: `derivatives dataset (funding rate; provider symbol ${ms.symbol})`,
          observedAt: ms.timestamp,
          freshness: String(ms.freshness),
          consumedElsewhere: MARKET_STRUCTURE_CONSUMER,
        });
      }
      if (ms.availability?.longShort && ms.longShort) {
        const lsBits: string[] = [];
        if (isFiniteNumber(ms.longShort.accountRatio)) lsBits.push(`accounts ${ms.longShort.accountRatio}`);
        if (isFiniteNumber(ms.longShort.topTraderRatio)) lsBits.push(`top traders ${ms.longShort.topTraderRatio}`);
        if (isFiniteNumber(ms.longShort.takerRatio)) lsBits.push(`taker ${ms.longShort.takerRatio}`);
        if (lsBits.length > 0) bits.push(`long/short ${lsBits.join(", ")}`);
      }
      if (ms.availability?.liquidations && ms.liquidations) {
        const liq = ms.liquidations;
        bits.push(
          `liquidations ${liq.dominantSide ?? "unknown side"} dominant${isFiniteNumber(liq.totalVolume) ? ` ($${liq.totalVolume.toLocaleString("en-US", { maximumFractionDigits: 0 })})` : ""}`,
        );
      }
    }

    if (bits.length > 0 && ms) {
      // Phase 281 — crowded / extreme positioning is RISK, never a direction.
      // The levels are the provider's own, the thresholds are documented, and
      // the reading only ever produces a contradiction + limitation: it can
      // never move the state or the confidence (the derivatives layer already
      // scores this exact provider evidence).
      const crowded: string[] = [];
      const funding = ms.availability?.fundingRate ? ms.fundingRate : undefined;
      if (
        funding &&
        isFiniteNumber(funding.annualizedRate) &&
        Math.abs(funding.annualizedRate) >= CRYPTO_PARAMETERS.extremeFundingAnnualizedPercent
      ) {
        crowded.push(
          `the provider's annualized funding ${funding.annualizedRate} is beyond the documented ±${CRYPTO_PARAMETERS.extremeFundingAnnualizedPercent}% extreme threshold`,
        );
      }
      const ratio = ms.availability?.longShort ? ms.longShort?.accountRatio : undefined;
      if (isFiniteNumber(ratio) && (ratio >= CRYPTO_PARAMETERS.crowdedLongShortRatio || ratio <= 1 / CRYPTO_PARAMETERS.crowdedLongShortRatio)) {
        crowded.push(
          `account long/short ${ratio} is beyond the documented ±${(1 / CRYPTO_PARAMETERS.crowdedLongShortRatio).toFixed(2)}× crowding band`,
        );
      }
      const oiChange = ms.availability?.openInterest ? ms.openInterest?.change24h : undefined;
      if (isFiniteNumber(oiChange) && Math.abs(oiChange) >= CRYPTO_PARAMETERS.crowdedOpenInterestChangePercent) {
        crowded.push(
          `open interest moved ${formatPercent(oiChange)} in 24h, beyond the documented ${CRYPTO_PARAMETERS.crowdedOpenInterestChangePercent}% build threshold`,
        );
      }
      if (crowded.length > 0) {
        metrics.positioningRisk = "crowded";
        contradictions.push(
          `Crowded market-structure positioning for ${nativeId}: ${crowded.join("; ")}. Extreme positioning is continuation risk / contrarian context and is never turned into a fundamental direction by this assessment (${MARKET_STRUCTURE_CONSUMER} scores it).`,
        );
        limitations.push(
          "Crowded/extreme positioning was detected and is reported as RISK, not as bullish or bearish fundamental evidence — positioning levels are never scored directionally here.",
        );
      } else {
        metrics.positioningRisk = "none-detected";
      }
      dimensions.push(
        dimension(
          "market-positioning",
          "neutral",
          `Market-structure context from ${ms.provider} (observed ${new Date(ms.timestamp).toISOString()}, freshness ${ms.freshness}): ${bits.join("; ")}.${crowded.length > 0 ? " Position: crowded/extreme — reported as risk context." : ""} Reported as traceable context only — the decision engines already score this evidence, so it is neither scored nor counted here.`,
          { informational: true, consumedBy: MARKET_STRUCTURE_CONSUMER },
        ),
      );
    } else {
      dimensions.push(unavailable("market-positioning"));
      limitations.push(
        "Market-structure context (open interest, funding, long/short, liquidations) UNAVAILABLE — no configured derivatives provider returned evidence for this instrument.",
      );
    }
  }

  // ── H. Options / ETF flows — no configured provider supplies them ─
  dimensions.push(unavailable("options-etf-flows"));
  limitations.push(
    "Options positioning (implied volatility, skew, options open interest), futures basis and ETF flow context UNAVAILABLE — no configured provider supplies them for this instrument.",
  );

  // ── Cross-cutting honesty disclosures ─────────────────────────
  limitations.push(
    "Crypto fundamentals are point-in-time provider snapshots (tokenomics and protocol datasets). They are measured evidence, not a fiscal reporting period, and are never presented as a live quote.",
  );
  limitations.push(
    "Tokenomics and protocol datasets are PUBLISHED on a daily-or-slower cadence and their providers stamp no observation instant: the instant recorded against them is the ACQUISITION RECEIPT of the provider response, and those values are classified HISTORICAL for exactly that reason.",
  );
  limitations.push(
    "Traditional company fundamentals (revenue, EPS, margins, P/E) do not apply to a crypto asset and are never shown for one.",
  );
  limitations.push(
    "Staking, yield and utility evidence is NOT supplied by any configured provider, so it is not reported — a utility narrative is never assembled from price or social data.",
  );

  // ── Aggregation (shared framework) ───────────────────────────
  const scored = dimensions.filter((d) => !d.informational && d.status !== "unavailable");
  const positives = scored.filter((d) => d.status === "positive").length;
  const negatives = scored.filter((d) => d.status === "negative").length;

  // Phase 281 — INDEPENDENT EVIDENCE GROUPS behind the SCORED dimensions.
  // One provider dataset is one group no matter how many fields it carries,
  // and the market price counts only when it actually produced the derived
  // valuation context. Informational dimensions never contribute a group, so
  // evidence another layer scores can never inflate this confidence.
  const scoredNames = new Set(scored.map((d) => d.name));
  const groups = new Set<string>();
  if (tokenomics && (scoredNames.has("supply-structure") || scoredNames.has("unlock-dilution"))) {
    groups.add(tokenomics.provider);
  }
  if (defi && scoredNames.has("protocol-economics")) groups.add(defi.provider);
  if (
    scoredNames.has("valuation-context") &&
    typeof context.priceProvider === "string" &&
    context.priceProvider.length > 0
  ) {
    groups.add(context.priceProvider);
  }
  // Multi-period history: a scored dimension whose evidence compares TWO real
  // provider observations (the TVL and fee windows) rather than one snapshot.
  const hasProviderWindow =
    metrics.tvlChange30dPercent !== undefined ||
    metrics.tvlChange7dPercent !== undefined ||
    metrics.feesChange30dPercent !== undefined ||
    metrics.feesChange7dPercent !== undefined;
  const historyDepth = hasProviderWindow && scoredNames.has("protocol-economics") ? 1 : 0;

  const { state, confidence, confidenceEvidence } = aggregateConfidence({
    dimensions,
    periodsCount: providers.length,
    periodsLabel: "provider dataset snapshots",
    // No fiscal period exists for a crypto asset: report age is undefined
    // rather than invented, and staleness is disclosed through the dataset
    // freshness labels instead.
    extraCaps: [],
    hierarchy: CRYPTO_HIERARCHY,
    independentGroups: groups.size,
    historyDepth,
  });

  const directionalBias =
    state === "improving" ? ("bullish" as const) : state === "weakening" ? ("bearish" as const) : ("none" as const);

  const directionalBiasEvidence =
    directionalBias === "none"
      ? scored.length === 0
        ? "No directional crypto fundamental read — no scored dimension carried evidence."
        : `No directional crypto fundamental read: ${positives} strengthening / ${negatives} weakening of ${scored.length} scored dimensions (${scored.map((d) => d.name).join(", ")}) — a direction is never forced from mixed evidence.`
      : `${directionalBias === "bullish" ? "Strengthening" : "Weakening"} crypto-network fundamentals: ${positives} strengthening / ${negatives} weakening of ${scored.length} scored dimensions (${scored.map((d) => d.name).join(", ")}).`;

  // Two-sided comparison lines exist only where the evidence has two real
  // aggregates (market cap vs FDV); everything else is single-snapshot.
  if (isFiniteNumber(metrics.marketCapDerived) && isFiniteNumber(metrics.fdvDerived)) {
    comparisons.push(
      `market capitalisation ${usd(metrics.marketCapDerived)} vs fully diluted valuation ${usd(metrics.fdvDerived)} — both derived from the same market price and provider-reported supply`,
    );
  }
  if (isFiniteNumber(metrics.dailyFees) && isFiniteNumber(metrics.tvlCurrent)) {
    comparisons.push(
      `daily fees ${usd(metrics.dailyFees)} against ${usd(metrics.tvlCurrent)} of locked value — two independent provider datasets, reported side by side and not divided into a fabricated ratio`,
    );
  }

  // Observability instant: the newest real instant among the datasets. The
  // publication datasets contribute their acquisition receipt, and the
  // evidence items say so individually.
  const instants = [
    tokenomics?.observedAt ?? 0,
    defi?.observedAt ?? 0,
    marketStructure?.timestamp ?? 0,
  ].filter((t) => t > 0);
  const observedInstant = instants.length > 0 ? Math.max(...instants) : 0;

  // Phase 281 — the deterministic explanation, built ONLY from the dimension
  // records above: network health → token economics → valuation → positioning
  // → assessment → risk → measurement periods.
  const dimText = (name: FundamentalDimension["name"], fallback: string) => {
    const d = dimensions.find((x) => x.name === name);
    return d && d.status !== "unavailable" && d.evidence ? d.evidence : fallback;
  };
  const tokenEconomics =
    `${dimText("supply-structure", "unavailable — no provider supplied supply structure for this instrument.")}` +
    (dimensions.find((d) => d.name === "unlock-dilution")?.status !== "unavailable"
      ? ` ${dimText("unlock-dilution", "")}`
      : " Unlock/vesting data unavailable — dilution overhang is never estimated.");
  const riskBits: string[] = [];
  if (contradictions.length > 0) riskBits.push(contradictions.join(" "));
  if (dimensions.find((d) => d.name === "valuation-context")?.status === "negative") {
    riskBits.push("the derived fully-diluted valuation carries a material future-supply overhang");
  }
  if (limitations.some((l) => l.startsWith("Crowded/extreme positioning"))) {
    riskBits.push("crowded positioning is present (risk context, never a direction)");
  }
  // Phase 281 — a higher-level SUPPLY-VS-DEMAND reading, derived only from the
  // dimension statuses above: when the two independent evidence groups agree,
  // the reading is consistent; when they disagree the state already reflects the
  // documented hierarchy, so no average is presented as the conclusion.
  const protoDim = dimensions.find((d) => d.name === "protocol-economics");
  const supplyDim = dimensions.find((d) => d.name === "supply-structure");
  const supplyVsDemand =
    protoDim && supplyDim && protoDim.status !== "unavailable" && supplyDim.status !== "unavailable" &&
    protoDim.status !== "neutral" && supplyDim.status !== "neutral"
      ? protoDim.status === supplyDim.status
        ? `Supply-vs-demand reading: the two independent evidence groups agree (${supplyDim.status} supply structure with ${protoDim.status} network economics), so the higher-level read is consistent.`
        : `Supply-vs-demand reading: the two independent evidence groups disagree (${supplyDim.status} supply structure against ${protoDim.status} network economics) — the state above follows the documented hierarchy instead of averaging them.`
      : "";
  // Phase 281 — source quality/freshness are carried per dataset and restated
  // verbatim, so a reader can weigh the evidence without re-deriving anything.
  const sourceNotes: string[] = [];
  if (tokenomics) {
    sourceNotes.push(`${tokenomics.provider} supply/vesting dataset (freshness ${tokenomics.freshness}, quality ${tokenomics.quality})`);
  }
  if (defi) {
    sourceNotes.push(`${defi.provider} TVL and fee datasets (freshness ${defi.freshness}, quality ${defi.quality})`);
  }
  if (marketStructure) {
    sourceNotes.push(`${marketStructure.provider} market-structure context (freshness ${marketStructure.freshness}, informational)`);
  }
  const summary =
    `Network health: ${dimText("protocol-economics", "unavailable — no configured provider returned TVL or fee evidence")} ` +
    `Token economics: ${tokenEconomics} ` +
    (supplyVsDemand.length > 0 ? `${supplyVsDemand} ` : "") +
    (sourceNotes.length > 0 ? `Sources: ${sourceNotes.join("; ")}. ` : "") +
    `Valuation: ${dimText("valuation-context", "unavailable — neither supply structure nor price evidence was supplied, so no market-cap/FDV context is claimed.")} ` +
    `Positioning: ${
      dimensions.find((d) => d.name === "market-positioning")?.status !== "unavailable"
        ? `${dimText("market-positioning", "")} (informational — already scored by ${MARKET_STRUCTURE_CONSUMER})`
        : "unavailable — no configured derivatives provider returned market-structure evidence"
    } ` +
    `Assessment: ${state} · confidence ${confidence} for ${nativeId}. ` +
    `Risk: ${riskBits.length > 0 ? riskBits.join(" ") : "no conflicting provider evidence was found in this payload."} ` +
    `Periods: measured provider snapshots at the instants each dataset carries (latest ${observedInstant > 0 ? new Date(observedInstant).toISOString() : "not supplied"}), never a live quote.`;

  return {
    available: true,
    domain: "crypto",
    provider: providers.join(" + ") || provider || "none",
    instrumentId: nativeId,
    observedAt: observedInstant,
    periodsCount: providers.length,
    state,
    confidence,
    confidenceEvidence,
    directionalBias,
    directionalBiasEvidence,
    summary,
    dimensions,
    comparisons,
    contradictions,
    unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, providers),
    evidence,
    metrics: {},
    cryptoMetrics: metrics,
    limitations,
  };
}

/** The explicit "no crypto evidence at all" assessment. */
function unavailableCryptoAssessment(input: {
  instrument: string;
  provider?: string;
  limitations: string[];
}): FundamentalAssessment {
  const dimensions = CRYPTO_DIMENSIONS.map((name) => unavailable(name));
  return {
    available: false,
    domain: "crypto",
    provider: input.provider && input.provider.length > 0 ? input.provider : "none",
    instrumentId: input.instrument,
    observedAt: 0,
    periodsCount: 0,
    state: "insufficient",
    confidence: "insufficient",
    confidenceEvidence: "No usable crypto fundamental evidence — no assessment produced.",
    directionalBias: "none",
    dimensions,
    contradictions: [],
    unavailableDimensions: dimensions.map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, []),
    evidence: [],
    metrics: {},
    limitations: [
      ...input.limitations,
      "No assessment produced — absent evidence is never fabricated.",
    ],
  };
}
