/**
 * Phase 48 — INVESTOR FUNDAMENTAL OUTLOOK.
 *
 * Read-only, asset-class-aware evidence projection for the investor forecast.
 * It consumes existing provider-backed intelligence and never creates a
 * directional signal, fair value, probability, trade, or execution permission.
 *
 * Exact instrument identity, provider availability, quality, freshness, and
 * source timestamps are mandatory. Missing/stale evidence stays unavailable.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { UniversalEvidenceItem } from "@/lib/data/universal/types";
import type { CryptoEvidenceItem } from "@/lib/data/crypto/types";
import { deriveCotEvidence, mapInstrumentToCot, type CotData } from "@/lib/data/cot";
import { deriveEiaInventoryEvidence, type EiaData } from "@/lib/data/eia";
import { deriveMacroYieldEvidence, type TreasuryData } from "@/lib/data/treasury";
import { buildEquityFundamentalEvidence } from "@/lib/data/universal/equity-evidence";

export type InvestorValuationStatus =
  | "AVAILABLE"
  | "NOT_AVAILABLE"
  | "STALE"
  | "DEGRADED"
  | "INVALID";

export interface InvestorFundamentalEvidence {
  source: string;
  category: string;
  direction: string;
  strength: string;
  quality: string;
  freshness: string;
  dependencyGroup: string;
  explanation: string;
  /** Timestamp of the source sub-context, not the UI render time. */
  asOf: number;
}

export interface InvestorValuationReference {
  kind: "PROVIDER_INTRINSIC_VALUE" | "ANALYST_CONSENSUS_TARGET";
  price: number;
  source: string;
  asOf: number;
  upsidePct: number;
  description: string;
}

export interface InvestorFundamentalOutlook {
  evidenceStatus: "VERIFIED" | "DEGRADED" | "UNAVAILABLE";
  evidence: InvestorFundamentalEvidence[];
  valuationStatus: InvestorValuationStatus;
  valuationReference?: InvestorValuationReference;
  limitations: string[];
}

const MAX_VALUATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeInstrument(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function validTimestamp(value: unknown, notAfter: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= notAfter
    ? value
    : undefined;
}

function positiveFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function universalEvidenceAsOf(result: AnalysisResult, item: UniversalEvidenceItem): number | undefined {
  const context = result.universalIntelligenceContext;
  if (!context) return undefined;
  const category = item.category;
  const observedAt =
    category === "VALUATION" ? context.equity?.valuation?.observedAt ?? context.equity?.fundamentals?.observedAt :
    category === "FUNDAMENTALS" ? context.equity?.fundamentals?.observedAt :
    category === "EARNINGS" ? context.equity?.earnings?.observedAt :
    category === "INVENTORY" ? context.commodity?.inventory?.observedAt :
    category === "SUPPLY_DEMAND" ? context.commodity?.supplyDemand?.observedAt :
    category === "FUTURES_STRUCTURE" ? context.commodity?.futuresStructure?.observedAt :
    category === "POSITIONING" ? context.forex?.positioning?.observedAt ?? context.commodity?.positioning?.observedAt :
    category === "RATES" || category === "CARRY" || category === "MONETARY_POLICY"
      ? context.forex?.rates?.observedAt ?? context.forex?.yields?.observedAt ?? context.forex?.macro?.observedAt
      : category === "RISK_REGIME" ? context.crossAsset?.riskRegime?.observedAt :
      category === "MACRO" || category === "CROSS_ASSET"
        ? context.crossAsset?.treasury?.observedAt ?? context.crossAsset?.dxy?.observedAt ?? context.crossAsset?.centralBanks?.observedAt ?? context.crossAsset?.globalLiquidity?.observedAt
        : undefined;
  return validTimestamp(observedAt, result.timestamp);
}

function mapUniversalEvidence(result: AnalysisResult): InvestorFundamentalEvidence[] {
  const context = result.universalIntelligenceContext;
  if (!context || normalizeInstrument(context.instrument) !== normalizeInstrument(result.instrument)) return [];
  return context.evidence.flatMap((item) => {
    if (
      !item.providerAvailable ||
      item.assetClass !== context.assetClass ||
      normalizeInstrument(item.instrument) !== normalizeInstrument(result.instrument) ||
      (item.freshness !== "FRESH" && item.freshness !== "DELAYED") ||
      (item.quality !== "VERIFIED" && item.quality !== "DEGRADED") ||
      item.direction === "UNAVAILABLE"
    ) return [];
    const asOf = universalEvidenceAsOf(result, item);
    if (asOf === undefined) return [];
    return [{
      source: item.source,
      category: item.category,
      direction: item.direction,
      strength: item.strength,
      quality: item.quality,
      freshness: item.freshness,
      dependencyGroup: item.dependencyGroup,
      explanation: item.explanation,
      asOf,
    }];
  });
}

function cryptoEvidenceAsOf(result: AnalysisResult, item: CryptoEvidenceItem): number | undefined {
  const context = result.cryptoIntelligenceContext;
  if (!context) return undefined;
  const category = item.category;
  const observedAt = category.startsWith("DERIVATIVES")
    ? context.derivatives?.observedAt
    : category.startsWith("DEFI") || category === "ON_CHAIN" || category === "LIQUIDITY"
      ? context.defi?.observedAt
      : category.startsWith("TOKENOMICS") || category === "SUPPLY_DYNAMICS"
        ? context.tokenomics?.observedAt
        : undefined;
  return validTimestamp(observedAt, result.timestamp);
}

function mapCryptoEvidence(result: AnalysisResult): InvestorFundamentalEvidence[] {
  const context = result.cryptoIntelligenceContext;
  if (!context || normalizeInstrument(context.instrument) !== normalizeInstrument(result.instrument)) return [];
  return context.evidence.flatMap((item) => {
    if (
      !item.providerAvailable ||
      (item.freshness !== "FRESH" && item.freshness !== "DELAYED") ||
      (item.quality !== "VERIFIED" && item.quality !== "DEGRADED") ||
      item.direction === "UNAVAILABLE"
    ) return [];
    const asOf = cryptoEvidenceAsOf(result, item);
    if (asOf === undefined) return [];
    return [{
      source: item.source,
      category: item.category,
      direction: item.direction,
      strength: item.strength,
      quality: item.quality,
      freshness: item.freshness,
      dependencyGroup: item.dependencyGroup,
      explanation: item.explanation,
      asOf,
    }];
  });
}

function observationDateTimestamp(value: string | undefined, notAfter: number): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return validTimestamp(parsed, notAfter);
}

function directionFromEffect(effect: number): string {
  return effect > 0 ? "SUPPORTING" : effect < 0 ? "CONFLICTING" : "NEUTRAL";
}

function strengthFromEffect(effect: number): string {
  const magnitude = Math.abs(effect);
  return magnitude >= 0.6 ? "STRONG" : magnitude >= 0.2 ? "MODERATE" : "WEAK";
}

function mapSecEdgarEvidence(result: AnalysisResult): InvestorFundamentalEvidence[] {
  if (result.instrumentType !== "stock") return [];
  const ticker = normalizeInstrument(result.instrument);
  const groups = new Map<string, Array<{
    observation: NonNullable<AnalysisResult["secEdgarObservations"]>[number];
    year: number;
    asOf: number;
  }>>();

  for (const observation of result.secEdgarObservations ?? []) {
    if (normalizeInstrument(observation.ticker) !== ticker) continue;
    const form = observation.form.trim().toUpperCase();
    if (form !== "10-K" && form !== "10-Q") continue;
    const fiscalPeriod = observation.fiscalPeriod?.trim().toUpperCase() || (form === "10-K" ? "FY" : "");
    if (!fiscalPeriod) continue;
    const year = observation.fiscalYear ?? new Date(observation.fiscalPeriodEnd).getUTCFullYear();
    if (!Number.isSafeInteger(year) || year < 1900) continue;
    // SEC filingDate is the daily point-in-time eligibility boundary. Fiscal
    // period end is used only to align year-over-year comparisons.
    const asOf = validTimestamp(Date.parse(observation.filingDate), result.timestamp);
    if (asOf === undefined) continue;
    const key = `${form}|${fiscalPeriod}`;
    const rows = groups.get(key) ?? [];
    rows.push({ observation, year, asOf });
    groups.set(key, rows);
  }

  const buildMetricEvidence = (
    metric: "revenue" | "eps",
  ): InvestorFundamentalEvidence | undefined => {
    const candidates: InvestorFundamentalEvidence[] = [];
    for (const rows of groups.values()) {
      const byYear = new Map<number, (typeof rows)[number]>();
      for (const row of [...rows].sort((a, b) => a.asOf - b.asOf)) {
        const existing = byYear.get(row.year);
        if (!existing || row.asOf >= existing.asOf) byYear.set(row.year, row);
      }
      const ordered = [...byYear.values()].sort((a, b) => a.year - b.year);
      const latest = ordered.length > 0 ? ordered[ordered.length - 1] : undefined;
      if (!latest) continue;
      const previous = byYear.get(latest.year - 1);
      if (!previous) continue;
      const latestValue = latest.observation[metric];
      const previousValue = previous.observation[metric];
      if (typeof latestValue !== "number" || !Number.isFinite(latestValue) ||
          typeof previousValue !== "number" || !Number.isFinite(previousValue)) continue;
      if (metric === "revenue" && previousValue === 0) continue;

      const change = latestValue - previousValue;
      const normalizedChange = metric === "revenue"
        ? change / Math.abs(previousValue)
        : change / Math.max(Math.abs(previousValue), 0.05);
      const threshold = metric === "revenue" ? 0.03 : 0.05;
      const direction = normalizedChange > threshold
        ? "SUPPORTING"
        : normalizedChange < -threshold
          ? "CONFLICTING"
          : "NEUTRAL";
      const age = Math.max(0, result.timestamp - latest.asOf);
      const form = latest.observation.form.toUpperCase();
      const freshness = form === "10-Q"
        ? age <= 120 * 24 * 60 * 60 * 1000 ? "FRESH" : age <= 240 * 24 * 60 * 60 * 1000 ? "DELAYED" : "STALE"
        : age <= 400 * 24 * 60 * 60 * 1000 ? "FRESH" : age <= 550 * 24 * 60 * 60 * 1000 ? "DELAYED" : "STALE";
      if (freshness === "STALE") continue;

      const magnitude = Math.abs(normalizedChange);
      const period = latest.observation.fiscalPeriod ?? (form === "10-K" ? "FY" : "quarter");
      const metricLabel = metric === "revenue" ? "Revenue" : "Diluted EPS";
      const percent = normalizedChange * 100;
      candidates.push({
        source: `SEC EDGAR Form ${form}`,
        category: metric === "revenue" ? "REVENUE_GROWTH" : "EPS_GROWTH",
        direction,
        strength: magnitude >= 0.25 ? "STRONG" : magnitude >= 0.1 ? "MODERATE" : "WEAK",
        quality: "VERIFIED",
        freshness,
        dependencyGroup: "SEC_EDGAR_FINANCIALS",
        explanation: `${metricLabel} changed ${percent >= 0 ? "+" : ""}${percent.toFixed(1)}% year over year for ${period} FY${latest.year} versus FY${previous.year}. Eligibility is based on SEC filing date ${latest.observation.filingDate}, not fiscal period end. ${latest.observation.sourceUrl}`,
        asOf: latest.asOf,
      });
    }
    return candidates.sort((a, b) => b.asOf - a.asOf)[0];
  };

  return [buildMetricEvidence("revenue"), buildMetricEvidence("eps")]
    .filter((item): item is InvestorFundamentalEvidence => item !== undefined);
}

function mapDirectProviderEvidence(
  result: AnalysisResult,
  spot?: number,
): InvestorFundamentalEvidence[] {
  const evidence: InvestorFundamentalEvidence[] = [];
  const existing = [...mapUniversalEvidence(result), ...mapCryptoEvidence(result)];
  evidence.push(...mapSecEdgarEvidence(result));

  // Alpha Vantage analyst-target evidence is independently timestamped and
  // exact-symbol checked by the shared equity evidence builder.
  if (!existing.some((item) => item.category === "VALUATION")) {
    const fundamentals = result.fundamentalData;
    const asOf = validTimestamp(fundamentals?.timestamp, result.timestamp);
    if (fundamentals?.available && asOf !== undefined) {
      const equityItems = buildEquityFundamentalEvidence(
        result.instrument,
        spot,
        fundamentals,
        result.timestamp,
      );
      for (const item of equityItems) {
        if (!item.providerAvailable || normalizeInstrument(item.instrument) !== normalizeInstrument(result.instrument)) continue;
        evidence.push({
          source: item.source,
          category: item.category,
          direction: item.direction,
          strength: item.strength,
          quality: item.quality,
          freshness: item.freshness,
          dependencyGroup: item.dependencyGroup,
          explanation: item.explanation,
          asOf,
        });
      }
    }
  }

  // CFTC positioning is mapped to the exact contract side. A quote-currency
  // contract has the inverse effect on the pair; no fuzzy ticker matching.
  const cot = result.cotContext as CotData | undefined;
  if (cot?.available && cot.freshness !== "STALE" && !existing.some((item) => item.category === "POSITIONING")) {
    const mapping = mapInstrumentToCot(result.instrument);
    const asOf = observationDateTimestamp(cot.latest.reportDate, result.timestamp);
    if (
      mapping && mapping.sourceInstrument === cot.sourceInstrument &&
      normalizeInstrument(cot.requestedInstrument) === normalizeInstrument(result.instrument) &&
      asOf !== undefined
    ) {
      const derived = deriveCotEvidence(cot);
      const effect = mapping.contractSide === "quote"
        ? -derived.effectOnContractCurrency
        : derived.effectOnContractCurrency;
      if (effect !== 0 || derived.crowded) {
        evidence.push({
          source: cot.source,
          category: "POSITIONING",
          direction: directionFromEffect(effect),
          strength: effect === 0 ? "WEAK" : strengthFromEffect(effect),
          quality: "VERIFIED",
          freshness: cot.freshness,
          dependencyGroup: `CFTC_COT_${normalizeInstrument(mapping.sourceInstrument)}`,
          explanation: [
            `CFTC positioning for ${mapping.mappedAsset} is mapped to the ${mapping.contractSide} side of ${result.instrument}.`,
            ...derived.notes,
          ].join(" "),
          asOf,
        });
      }
    }
  }

  // EIA inventory direction is oil-specific. It is never applied to natural
  // gas or unrelated commodities merely because they share the provider.
  const eia = result.eiaContext as EiaData | undefined;
  const instrumentKey = normalizeInstrument(result.instrument);
  if (
    eia?.available && eia.freshness !== "STALE" &&
    /(WTI|BRENT|CRUDE)/.test(instrumentKey) &&
    !existing.some((item) => item.category === "INVENTORY")
  ) {
    const derived = deriveEiaInventoryEvidence(eia);
    const observationDates = eia.series
      .map((series) => observationDateTimestamp(series.observationDate, result.timestamp))
      .filter((value): value is number => value !== undefined);
    const asOf = observationDates.length > 0 ? Math.min(...observationDates) : undefined;
    if (derived.effectOnOilLong !== 0 && asOf !== undefined) {
      evidence.push({
        source: eia.source,
        category: "INVENTORY",
        direction: directionFromEffect(derived.effectOnOilLong),
        strength: strengthFromEffect(derived.effectOnOilLong),
        quality: "VERIFIED",
        freshness: eia.freshness,
        dependencyGroup: "EIA_WEEKLY_PETROLEUM_INVENTORY",
        explanation: derived.notes.join(" "),
        asOf,
      });
    }
  }

  // Treasury evidence is applied only where the measured exposure is explicit:
  // real yields to gold, nominal USD yields to USD-base/quote FX pairs.
  const treasury = result.treasuryContext as TreasuryData | undefined;
  if (
    treasury?.available && treasury.freshness !== "STALE" &&
    !existing.some((item) => item.source === treasury.source && item.category === "MACRO")
  ) {
    const derived = deriveMacroYieldEvidence(treasury);
    let effect = 0;
    let exposure = "";
    let observationDate: string | undefined;
    if (instrumentKey.includes("XAU") || instrumentKey === "GOLD") {
      effect = derived.goldLongEffect;
      exposure = "US real-yield change mapped to gold";
      observationDate = treasury.latest.real?.observationDate;
    } else {
      const pair = result.instrument.split(/[\\/_-]/).map((part) => part.trim().toUpperCase());
      const base = pair[0];
      const quote = pair[1];
      if (base === "USD") {
        effect = derived.usdStrengthEffect;
        exposure = "US nominal-yield change mapped to USD base-currency strength";
      } else if (quote === "USD") {
        effect = -derived.usdStrengthEffect;
        exposure = "US nominal-yield change inverted for USD quote-currency exposure";
      }
      observationDate = treasury.latest.nominal.observationDate;
    }
    const asOf = observationDateTimestamp(observationDate, result.timestamp);
    if (effect !== 0 && asOf !== undefined) {
      evidence.push({
        source: treasury.source,
        category: "MACRO",
        direction: directionFromEffect(effect),
        strength: strengthFromEffect(effect),
        quality: "VERIFIED",
        freshness: treasury.freshness,
        dependencyGroup: "US_TREASURY_YIELD_CURVE",
        explanation: [exposure, ...derived.notes].join(" "),
        asOf,
      });
    }
  }

  return evidence;
}

function mapCoreFundamentalSummary(
  result: AnalysisResult,
  existingEvidence: InvestorFundamentalEvidence[],
): InvestorFundamentalEvidence[] {
  if (existingEvidence.some((item) => item.direction === "SUPPORTING" || item.direction === "CONFLICTING")) return [];
  const score = result.breakdown?.fundamental;
  if (typeof score !== "number" || !Number.isFinite(score) || Math.abs(score) < 1) return [];

  const observations: Array<{ asOf: number; freshness: string }> = [];
  const fundamentalTimestamp = validTimestamp(result.fundamentalData?.timestamp, result.timestamp);
  if (result.fundamentalData?.available && fundamentalTimestamp !== undefined) {
    const age = result.timestamp - fundamentalTimestamp;
    observations.push({ asOf: fundamentalTimestamp, freshness: age <= 6 * 60 * 60 * 1000 ? "FRESH" : age <= 72 * 60 * 60 * 1000 ? "DELAYED" : "STALE" });
  }
  const macro = result.macroData as { timestamp?: number; available?: boolean; confidence?: string } | undefined;
  const macroTimestamp = macro && macro.available !== false && macro.confidence !== "unavailable"
    ? validTimestamp(macro.timestamp, result.timestamp)
    : undefined;
  if (macroTimestamp !== undefined) {
    const age = result.timestamp - macroTimestamp;
    observations.push({ asOf: macroTimestamp, freshness: age <= 6 * 60 * 60 * 1000 ? "FRESH" : age <= 72 * 60 * 60 * 1000 ? "DELAYED" : "STALE" });
  }
  const cot = result.cotContext as CotData | undefined;
  if (cot?.available) {
    const asOf = observationDateTimestamp(cot.latest.reportDate, result.timestamp);
    if (asOf !== undefined) observations.push({ asOf, freshness: cot.freshness });
  }
  const eia = result.eiaContext as EiaData | undefined;
  if (eia?.available) {
    const dates = eia.series.map((series) => observationDateTimestamp(series.observationDate, result.timestamp)).filter((value): value is number => value !== undefined);
    if (dates.length > 0) observations.push({ asOf: Math.min(...dates), freshness: eia.freshness });
  }
  const treasury = result.treasuryContext as TreasuryData | undefined;
  if (treasury?.available) {
    const asOf = observationDateTimestamp(treasury.latest.nominal.observationDate, result.timestamp);
    if (asOf !== undefined) observations.push({ asOf, freshness: treasury.freshness });
  }

  const usable = observations.filter((item) => item.freshness === "FRESH" || item.freshness === "DELAYED");
  if (usable.length === 0) return [];
  const freshness = usable.some((item) => item.freshness === "DELAYED") ? "DELAYED" : "FRESH";
  const asOf = Math.min(...usable.map((item) => item.asOf));
  const magnitude = Math.abs(score);
  return [{
    source: "Core fundamental analysis engine",
    category: "FUNDAMENTALS",
    direction: score > 0 ? "SUPPORTING" : "CONFLICTING",
    strength: magnitude >= 60 ? "STRONG" : magnitude >= 30 ? "MODERATE" : "WEAK",
    quality: "DEGRADED",
    freshness,
    dependencyGroup: "CORE_FUNDAMENTAL_ENGINE_AGGREGATE",
    explanation: `The existing fundamental layer produced a score of ${score.toFixed(1)} from the available asset-specific provider inputs. This is an aggregate summary, not an independent provider confirmation.`,
    asOf,
  }];
}

function buildValuationReference(
  result: AnalysisResult,
  spot: number | undefined,
): { status: InvestorValuationStatus; reference?: InvestorValuationReference } {
  if (result.instrumentType !== "stock" || spot === undefined) return { status: "NOT_AVAILABLE" };
  const instrument = normalizeInstrument(result.instrument);
  const universal = result.universalIntelligenceContext;
  const equity = universal?.assetClass === "equity" &&
    normalizeInstrument(universal.instrument) === instrument
    && universal.equity && normalizeInstrument(universal.equity.instrument) === instrument
    ? universal.equity
    : undefined;
  const valuation = equity?.valuation;

  if (valuation?.available && valuation.provider?.trim()) {
    const asOf = validTimestamp(valuation.observedAt, result.timestamp);
    if (asOf === undefined || result.timestamp - asOf > MAX_VALUATION_AGE_MS) {
      // A separately verified analyst target may still be used below.
    } else if (valuation.quality === "DEGRADED") {
      // Do not publish a numeric valuation reference from degraded evidence.
    } else if (valuation.quality === "VERIFIED" && (valuation.freshness === "FRESH" || valuation.freshness === "DELAYED")) {
      const intrinsicValue = positiveFinite(valuation.intrinsicValue);
      if (intrinsicValue !== undefined) {
        return {
          status: "AVAILABLE",
          reference: {
            kind: "PROVIDER_INTRINSIC_VALUE",
            price: intrinsicValue,
            source: valuation.provider,
            asOf,
            upsidePct: ((intrinsicValue / spot) - 1) * 100,
            description: "Provider-supplied intrinsic-value estimate; not a guaranteed fair value or expected return.",
          },
        };
      }
    }
  }

  const fundamental = result.fundamentalData;
  if (
    fundamental?.available &&
    fundamental.instrumentType === "stock" &&
    normalizeInstrument(fundamental.symbol) === instrument &&
    typeof fundamental.provider === "string" &&
    fundamental.provider.trim()
  ) {
    const asOf = validTimestamp(fundamental.timestamp, result.timestamp);
    if (asOf !== undefined && result.timestamp - asOf <= MAX_VALUATION_AGE_MS) {
      const target = positiveFinite(fundamental.analystTargetPrice);
      if (target !== undefined) {
        return {
          status: "AVAILABLE",
          reference: {
            kind: "ANALYST_CONSENSUS_TARGET",
            price: target,
            source: fundamental.provider,
            asOf,
            upsidePct: ((target / spot) - 1) * 100,
            description: "Provider-reported analyst consensus target; not intrinsic value or a guaranteed return.",
          },
        };
      }
      if (fundamental.analystTargetPrice !== undefined) return { status: "INVALID" };
    } else {
      return { status: "STALE" };
    }
  }

  if (valuation?.available && valuation.quality === "DEGRADED") return { status: "DEGRADED" };
  if (valuation?.available && (valuation.quality === "STALE" || valuation.freshness === "STALE")) return { status: "STALE" };
  if (valuation?.available && (!positiveFinite(valuation.intrinsicValue) && valuation.intrinsicValue !== undefined)) {
    return { status: "INVALID" };
  }
  if (valuation?.available && (!validTimestamp(valuation.observedAt, result.timestamp) ||
    result.timestamp - (valuation.observedAt ?? 0) > MAX_VALUATION_AGE_MS)) return { status: "STALE" };
  return { status: "NOT_AVAILABLE" };
}

/** Build investor-facing fundamentals without allowing them to alter the trading decision. */
export function buildInvestorFundamentalOutlook(result: AnalysisResult, spot?: number): InvestorFundamentalOutlook {
  const existingEvidence = [...mapUniversalEvidence(result), ...mapCryptoEvidence(result)];
  const directEvidence = mapDirectProviderEvidence(result, spot);
  const evidence = [...existingEvidence, ...directEvidence];
  const evidenceWithAggregate = evidence.length > 0 ? evidence : mapCoreFundamentalSummary(result, evidence);
  const valuation = buildValuationReference(result, spot);
  const hasDegraded = evidenceWithAggregate.some((item) => item.quality === "DEGRADED");
  return {
    evidenceStatus: evidenceWithAggregate.length === 0 ? "UNAVAILABLE" : hasDegraded ? "DEGRADED" : "VERIFIED",
    evidence: evidenceWithAggregate,
    valuationStatus: valuation.status,
    valuationReference: valuation.reference,
    limitations: [
      "Fundamental evidence is asset-class-specific context; it does not independently establish a calibrated price forecast or win probability.",
      "A provider intrinsic-value estimate or analyst consensus target is a sourced reference, not a guaranteed fair value or expected return.",
      "Stale, unavailable, or mismatched evidence is excluded; degraded evidence may remain contextual but cannot produce a numeric valuation reference.",
    ],
  };
}
