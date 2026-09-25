/**
 * Phase 279 — FOREX fundamental intelligence (domain adapter).
 *
 * Forex fundamentals are MACROECONOMIC and POLICY-RELATIVE: a currency pair has
 * no company behind it, so this adapter compares the two sides of the pair on
 * the evidence the repository actually has:
 *
 *   POLICY      released central-bank rate decisions per side → policy rate,
 *               direction (hike/hold/cut) and the rate differential
 *   INFLATION   released CPI/PCE/PPI per side → level, trend, surprise
 *   LABOR       released employment/unemployment/wage data per side
 *   GROWTH      released GDP/PMI/retail-sales/industrial data per side
 *   EXTERNAL    trade-balance / current-account releases, where supplied
 *   YIELDS      US Treasury nominal + real curves (USD side only — the
 *               repository has no non-USD yield source) → INFORMATIONAL
 *   POSITIONING CFTC COT reports → INFORMATIONAL
 *   EVENT RISK  the calendar provider's own upcoming-event assessment →
 *               INFORMATIONAL
 *
 * Every evidence item carries the provider's currency code, event name,
 * reference period and release instant verbatim. A released macro value is
 * NEVER presented as a live market price.
 *
 * PURE: no clock. The upcoming-event window comes from the calendar payload's
 * own assessment — the local clock is never read here.
 */

import type { CotContext, CotData } from "@/lib/data/cot";
import type { EconomicCalendarData, EconomicEvent } from "@/lib/data/calendar-types";
import type { TreasuryContext, TreasuryData } from "@/lib/data/treasury";
import { parseSymbolCurrencies } from "@/lib/risk/spec-resolver";
import type {
  ForexFundamentalMetrics,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalEvidenceItem,
} from "@/lib/data/fundamental-contract";
import { aggregateConfidence, coverageOf, dimension, isFiniteNumber, unavailable } from "./framework";

export interface ForexFundamentalContext {
  instrument: string;
  provider?: string;
  providerInstrumentId?: string;
  /** Trading Economics / TickAtlas calendar evidence (both sides of the pair). */
  calendar?: EconomicCalendarData;
  /** US Treasury nominal + real yields (USD side only). */
  treasury?: TreasuryData;
  /** CFTC COT positioning for the pair's mapped contract. */
  cot?: CotData;
}

/** Documented interpretation parameters — nothing below is a magic number. */
export const FOREX_PARAMETERS = {
  /** Surprise smaller than this share of the forecast magnitude is "in line". */
  surpriseNoisePercent: 0.5,
  /** Absolute surprise floor in the event's own units (levels like PMI ≈ 50). */
  surpriseNoiseAbsolute: 0.1,
  /**
   * Tolerance for the two floors above. Released values are decimals, so an
   * exact threshold comparison is not reliable (6.4 − 6.5 === −0.0999…): without
   * it, a surprise sitting exactly ON the documented floor would be reported as
   * "in line". Applied to the floor only — it never turns an in-band surprise
   * into a signal.
   */
  fpTolerance: 1e-9,
  /** Policy-rate moves under this (pp) are treated as "unchanged". */
  rateChangeNoisePp: 0.001,
  /** Yield change (pp) treated as directional for the display read. */
  yieldMaterialPp: 0.03,
} as const;

type Category = "policy-rates" | "inflation" | "labor" | "growth" | "external-balance";

const CATEGORY_RULES: { category: Category; test: RegExp }[] = [
  {
    category: "policy-rates",
    test: /interest rate|rate decision|policy rate|federal funds|refinanc\w* rate|bank rate|cash rate|deposit rate|monetary policy/i,
  },
  { category: "inflation", test: /cpi|consumer price|inflation|\bpce\b|producer price|\bppi\b/i },
  {
    category: "labor",
    test: /non-?farm|payroll|unemployment|employment|jobless|labour|labou?r force|wage|average earnings/i,
  },
  {
    category: "growth",
    test: /\bgdp\b|gross domestic|\bpmi\b|retail sales|industrial production|consumer confidence|business activity|\bism\b|durable goods|tankan|manufacturers? index|services index|economy watchers/i,
  },
  { category: "external-balance", test: /trade balance|current account|exports|imports/i },
];

/** Events where a HIGHER reading means a WEAKER currency (inverted reading). */
const INVERTED_READING = /unemployment|jobless|claims/i;

function classify(event: EconomicEvent): Category | undefined {
  const name = event.event ?? "";
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(name)) return rule.category;
  }
  return undefined;
}

function numeric(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[%,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export interface ForexCategoryRead {
  category: Category;
  currency: string;
  event: EconomicEvent;
  actual: number;
  forecast?: number;
  previous?: number;
  /** Signed surprise in the event's own units (actual − forecast). */
  surprise?: number;
  /** Signed change vs the previous release (actual − previous). */
  changeVsPrevious?: number;
  /** −1 (currency-negative), 0 (in line/unknown), +1 (currency-positive). */
  score: -1 | 0 | 1;
  /** Why the score is what it is — the rule applied. */
  rule: string;
}

/**
 * Latest released measurement per category for one currency, with the
 * documented surprise rule applied. Selecting by the provider's own datetime
 * keeps the read deterministic and never uses the local clock.
 */
export function readCategory(
  events: EconomicEvent[],
  category: Category,
  currency: string,
): ForexCategoryRead | undefined {
  const candidates = events
    .filter(
      (e) =>
        e.currency?.toUpperCase() === currency &&
        e.status === "released" &&
        classify(e) === category &&
        numeric(e.actual) !== undefined,
    )
    .sort((a, b) => b.datetime - a.datetime);
  const event = candidates[0];
  if (!event) return undefined;

  const actual = numeric(event.actual)!;
  const forecast = numeric(event.forecast);
  const previous = numeric(event.previous);
  const inverted = INVERTED_READING.test(event.event);
  const surprise = isFiniteNumber(forecast) ? actual - forecast : undefined;
  const changeVsPrevious = isFiniteNumber(previous) ? actual - previous : undefined;

  // Policy rates read through the RATE CHANGE (hike/hold/cut); other
  // categories read through the SURPRISE vs the provider's own consensus.
  const signal =
    category === "policy-rates"
      ? changeVsPrevious !== undefined && Math.abs(changeVsPrevious) > FOREX_PARAMETERS.rateChangeNoisePp
        ? changeVsPrevious
        : 0
      : surprise !== undefined && isMaterialSurprise(surprise, forecast)
        ? surprise
        : 0;

  const oriented = inverted ? -signal : signal;
  const score: -1 | 0 | 1 = oriented > 0 ? 1 : oriented < 0 ? -1 : 0;
  const rule =
    category === "policy-rates"
      ? changeVsPrevious === undefined
        ? "no previous policy rate supplied — change cannot be measured, so the reading stays neutral"
        : Math.abs(changeVsPrevious) <= FOREX_PARAMETERS.rateChangeNoisePp
          ? "policy rate unchanged vs the previous release — no policy-direction signal"
          : `${changeVsPrevious > 0 ? "rate increase" : "rate cut"} of ${changeVsPrevious.toFixed(2)}pp vs the previous release`
      : surprise === undefined
        ? "no consensus (forecast) supplied — the surprise cannot be measured, so the reading stays neutral"
        : !isMaterialSurprise(surprise, forecast)
          ? `surprise ${surprise >= 0 ? "+" : ""}${surprise.toFixed(2)} is inside the documented "in line" band (±${FOREX_PARAMETERS.surpriseNoisePercent}% of consensus / ±${FOREX_PARAMETERS.surpriseNoiseAbsolute})`
          : `surprise ${surprise >= 0 ? "+" : ""}${surprise.toFixed(2)} vs consensus${inverted ? " (inverted: a higher reading is currency-negative for this series)" : ""}`;

  return {
    category,
    currency,
    event,
    actual,
    ...(isFiniteNumber(forecast) ? { forecast } : {}),
    ...(isFiniteNumber(previous) ? { previous } : {}),
    ...(surprise !== undefined ? { surprise } : {}),
    ...(changeVsPrevious !== undefined ? { changeVsPrevious } : {}),
    score,
    rule,
  };
}

function isMaterialSurprise(surprise: number, forecast: number | undefined): boolean {
  const floor = FOREX_PARAMETERS.surpriseNoiseAbsolute - FOREX_PARAMETERS.fpTolerance;
  if (!isFiniteNumber(forecast) || forecast === 0) return Math.abs(surprise) > floor;
  const pct = Math.abs(surprise / forecast) * 100;
  return pct >= FOREX_PARAMETERS.surpriseNoisePercent - FOREX_PARAMETERS.fpTolerance && Math.abs(surprise) >= floor;
}

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function readSummary(read: ForexCategoryRead): string {
  const e = read.event;
  return `${e.currency} ${e.event}: actual ${money(read.actual)}${isFiniteNumber(read.forecast) ? ` vs consensus ${money(read.forecast)}` : ""}${isFiniteNumber(read.previous) ? ` (previous ${money(read.previous)})` : ""}${e.referencePeriod ? `, period ${e.referencePeriod}` : ""} — released ${new Date(e.datetime).toISOString()} (${e.source})`;
}

export function assessForexFundamentals(ctx: ForexFundamentalContext): FundamentalAssessment {
  const { instrument, provider, providerInstrumentId, calendar, treasury, cot } = ctx;
  const { base, quote } = parseSymbolCurrencies(instrument);
  const nativeId = providerInstrumentId?.trim() || instrument;

  const limitations: string[] = [];
  const evidence: FundamentalEvidenceItem[] = [];
  const dimensions: FundamentalDimension[] = [];

  // ── Without a readable pair there is no two-sided comparison ──
  if (!base || !quote) {
    return {
      available: false,
      domain: "forex",
      provider: provider ?? "none",
      instrumentId: nativeId,
      observedAt: 0,
      periodsCount: 0,
      state: "insufficient",
      confidence: "insufficient",
      confidenceEvidence: "No usable forex fundamental evidence — the pair structure could not be read.",
      directionalBias: "none",
      dimensions: FOREX_DIMENSIONS.map((name) => unavailable(name)),
      contradictions: [],
      unavailableDimensions: [...FOREX_DIMENSIONS],
      evidenceCoverage: {
        dimensionsAvailable: 0,
        dimensionsScored: 0,
        dimensionsTotal: FOREX_DIMENSIONS.length,
        evidenceClasses: [],
      },
      evidence: [],
      metrics: {},
      limitations: [
        `Forex fundamentals need both sides of the pair, and "${instrument}" does not carry a readable BASE/QUOTE structure — no two-sided comparison is possible and none is invented.`,
      ],
    };
  }

  const events = calendar && Array.isArray(calendar.events) ? calendar.events : [];
  const calendarProvider = calendar?.provider ?? "none";
  const calendarObservedAt = calendar?.timestamp ?? 0;
  const metrics: ForexFundamentalMetrics = {};
  const comparisons: string[] = [];
  const providers: string[] = [];

  if (events.length > 0 && calendarProvider !== "none") providers.push(calendarProvider);

  // ═══════════════════════════════════════════════════════════════
  // Scored macro dimensions — one two-sided comparison each
  // ═══════════════════════════════════════════════════════════════
  const scoredCategories: Category[] = ["policy-rates", "inflation", "labor", "growth", "external-balance"];
  // Per-side released surprises (actual − consensus), accumulated across the
  // scored categories so the reported average describes the whole evidence set.
  const sideSurprises: Record<string, number[]> = { [base]: [], [quote]: [] };

  for (const category of scoredCategories) {
    const baseRead = readCategory(events, category, base);
    const quoteRead = readCategory(events, category, quote);

    if (!baseRead && !quoteRead) {
      // The dimension is defined by the domain but this payload has no
      // release for EITHER side: reported unavailable, never neutral-scored.
      dimensions.push(unavailable(category));
      limitations.push(
        `${category.replace("-", " ")} UNAVAILABLE — the calendar provider supplied no released ${category.replace("-", " ")} measurement for ${base} or ${quote}.`,
      );
      continue;
    }

    for (const read of [baseRead, quoteRead]) {
      if (!read) continue;
      evidence.push({
        metric: `${read.category}:${read.currency}`,
        label: `${read.currency} ${read.event.event}`,
        value: read.actual,
        unit: "event units",
        provider: read.event.source || calendarProvider,
        providerInstrumentId: read.currency,
        source: "economic calendar release",
        observedAt: read.event.datetime,
        ...(read.event.referencePeriod ? { period: read.event.referencePeriod } : {}),
        freshness: calendar?.freshness ?? "unavailable",
      });
    }

    // Pair-relative reading: base-currency strength is the pair's upside.
    const baseScore = baseRead?.score ?? 0;
    const quoteScore = quoteRead?.score ?? 0;
    const net = baseScore - quoteScore;
    const status = net > 0 ? "positive" : net < 0 ? "negative" : "neutral";

    const parts: string[] = [];
    if (baseRead) parts.push(`base ${readSummary(baseRead)} — ${baseRead.rule}`);
    if (quoteRead) parts.push(`quote ${readSummary(quoteRead)} — ${quoteRead.rule}`);
    // A one-sided read is disclosed as one-sided: the side with no released
    // measurement is named and no value is invented for it.
    const oneSided = !baseRead || !quoteRead;
    if (oneSided) {
      parts.push(
        `${!baseRead ? `base ${base}` : `quote ${quote}`} had no released ${category.replace("-", " ")} measurement in the provider's window — the comparison is one-sided and no reading is invented for it`,
      );
    }
    const verdict =
      net > 0
        ? `reading favours ${base} (base side of the pair)${oneSided ? " on a one-sided comparison" : ""}`
        : net < 0
          ? `reading favours ${quote} (quote side of the pair)${oneSided ? " on a one-sided comparison" : ""}`
          : baseRead || quoteRead
            ? "the two sides are level on the measured evidence, so no side is favoured"
            : "no side is favoured";
    dimensions.push(
      dimension(
        category,
        status,
        `${base}/${quote} ${category.replace("-", " ")} comparison: ${parts.join(" | ")} → ${verdict}.`,
      ),
    );

    if (baseRead && quoteRead) {
      comparisons.push(
        `${category.replace("-", " ")}: ${base} ${baseRead.score > 0 ? "+" : baseRead.score < 0 ? "−" : "0"} vs ${quote} ${quoteRead.score > 0 ? "+" : quoteRead.score < 0 ? "−" : "0"} → ${net > 0 ? base : net < 0 ? quote : "neither"} carries the stronger reading`,
      );
    }

    // Surprise accumulation is per SIDE (the released value against the
    // provider's own consensus), so the reported average never mixes the two
    // currencies into one number.
    if (baseRead?.surprise !== undefined) sideSurprises[base]?.push(baseRead.surprise);
    if (quoteRead?.surprise !== undefined) sideSurprises[quote]?.push(quoteRead.surprise);

    // Numeric domain metrics for the rate dimensions.
    if (category === "policy-rates") {
      const baseRate = baseRead?.actual;
      const quoteRate = quoteRead?.actual;
      if (isFiniteNumber(baseRate)) metrics.basePolicyRate = baseRate;
      if (isFiniteNumber(quoteRate)) metrics.quotePolicyRate = quoteRate;
      if (isFiniteNumber(baseRate) && isFiniteNumber(quoteRate)) {
        metrics.policyRateDifferentialPp = baseRate - quoteRate;
        comparisons.push(
          `policy rate differential: ${base} ${baseRate.toFixed(2)}% vs ${quote} ${quoteRate.toFixed(2)}% → ${(baseRate - quoteRate).toFixed(2)}pp in favour of ${baseRate >= quoteRate ? base : quote}`,
        );
      }

      if (isFiniteNumber(baseRate) && isFiniteNumber(quoteRate)) {
        evidence.push({
          metric: "policy_rate_differential",
          label: "Policy rate differential",
          value: baseRate - quoteRate,
          unit: "pp",
          provider: baseRead?.event.source || quoteRead?.event.source || calendarProvider,
          providerInstrumentId: nativeId,
          source: "released policy-rate decisions (both sides of the pair)",
          observedAt: Math.max(baseRead?.event.datetime ?? 0, quoteRead?.event.datetime ?? 0),
          freshness: calendar?.freshness ?? "unavailable",
          derived: true,
          basis: `latest released ${base} policy rate ${baseRate} − latest released ${quote} policy rate ${quoteRate}`,
        });
      }
      if (baseRead && quoteRead) {
        const divergence = (baseRead.changeVsPrevious ?? 0) - (quoteRead.changeVsPrevious ?? 0);
        if (Math.abs(divergence) > FOREX_PARAMETERS.rateChangeNoisePp) {
          comparisons.push(
            `monetary-policy divergence: ${base} moved ${(baseRead.changeVsPrevious ?? 0).toFixed(2)}pp while ${quote} moved ${(quoteRead.changeVsPrevious ?? 0).toFixed(2)}pp → ${divergence > 0 ? `${base} tightening relative to ${quote}` : `${base} easing relative to ${quote}`}`,
          );
        }
      }
    }
  }

  // Mean released surprise per side (only where surprises exist at all).
  const mean = (values: number[]): number | undefined =>
    values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
  const baseSurpriseMean = mean(sideSurprises[base] ?? []);
  const quoteSurpriseMean = mean(sideSurprises[quote] ?? []);
  if (baseSurpriseMean !== undefined) metrics.baseSurpriseAvg = baseSurpriseMean;
  if (quoteSurpriseMean !== undefined) metrics.quoteSurpriseAvg = quoteSurpriseMean;

  // ═══════════════════════════════════════════════════════════════
  // Yields — INFORMATIONAL: the conviction Macro Yield layer already
  // scores this exact Treasury evidence.
  // ═══════════════════════════════════════════════════════════════
  {
    const yieldConsumer = "conviction Macro Yield layer (US Treasury evidence)";
    const hasUsdSide = base === "USD" || quote === "USD";
    const tr: TreasuryContext | undefined = treasury?.available ? treasury : undefined;

    if (tr && hasUsdSide) {
      providers.push("US Treasury XML feed");
      const latestNominal = tr.latest.nominal.nominal;
      const latestReal = tr.latest.real?.real;
      const previousNominal = tr.previous?.nominal.nominal;
      const tenY = latestNominal["10Y"];
      const twoY = latestNominal["2Y"];
      const realTenY = latestReal?.["10Y"];
      const prevTenY = previousNominal?.["10Y"];
      const changeTenY = isFiniteNumber(tenY) && isFiniteNumber(prevTenY) ? tenY - prevTenY : undefined;

      if (isFiniteNumber(tenY)) {
        evidence.push({
          metric: "usd_10y_nominal",
          label: "USD 10Y nominal yield",
          value: tenY,
          unit: "%",
          provider: "US Treasury XML feed",
          providerInstrumentId: "USD",
          source: tr.source,
          observedAt: tr.fetchedAt,
          period: String(tr.latest.nominal.observationDate),
          freshness: String(tr.freshness),
          consumedElsewhere: yieldConsumer,
        });
      }
      if (isFiniteNumber(realTenY)) {
        evidence.push({
          metric: "usd_10y_real",
          label: "USD 10Y real yield",
          value: realTenY,
          unit: "%",
          provider: "US Treasury XML feed",
          providerInstrumentId: "USD",
          source: tr.source,
          observedAt: tr.fetchedAt,
          period: String(tr.latest.real?.observationDate ?? tr.latest.nominal.observationDate),
          freshness: String(tr.freshness),
          consumedElsewhere: yieldConsumer,
        });
      }

      // A cross-currency yield differential needs BOTH sides; the repository
      // has no non-USD yield source, so it is stated as unavailable instead of
      // being approximated from policy rates.
      limitations.push(
        "Yield differential UNAVAILABLE as a comparative measurement — the only yield source in this repository is the US Treasury curve, so no non-USD yield exists to difference against. Policy-rate levels are reported separately and are not substituted for market yields.",
      );

      const usdStronger = changeTenY !== undefined ? changeTenY > FOREX_PARAMETERS.yieldMaterialPp : undefined;
      const usdWeaker = changeTenY !== undefined ? changeTenY < -FOREX_PARAMETERS.yieldMaterialPp : undefined;
      const status: FundamentalDimension["status"] =
        usdStronger === true || usdWeaker === true
          ? ((base === "USD") === usdStronger ? "positive" : "negative")
          : "neutral";
      dimensions.push(
        dimension(
          "rates-yields",
          status,
          `USD yield curve (${tr.source}, observation ${tr.latest.nominal.observationDate}, freshness ${tr.freshness}): ${isFiniteNumber(twoY) ? `2Y ${twoY.toFixed(2)}%` : "2Y not supplied"}, ${isFiniteNumber(tenY) ? `10Y ${tenY.toFixed(2)}%` : "10Y not supplied"}${isFiniteNumber(realTenY) ? `, real 10Y ${realTenY.toFixed(2)}%` : ", real 10Y not supplied"}${changeTenY !== undefined ? ` — 10Y ${changeTenY >= 0 ? "+" : ""}${changeTenY.toFixed(2)}pp vs the previous observation` : " — no previous observation, so no yield change is claimed"}. Informational: the Macro Yield layer already scores this evidence, so it does not move the fundamental state.`,
          { informational: true, consumedBy: yieldConsumer },
        ),
      );
    } else {
      dimensions.push(unavailable("rates-yields"));
      limitations.push(
        hasUsdSide
          ? "Rates/yields UNAVAILABLE — no Treasury observation was supplied for this analysis."
          : "Rates/yields UNAVAILABLE for this pair — the only yield provider in this repository is the US Treasury curve and neither side of this pair is USD.",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Positioning (COT) — INFORMATIONAL: the COT layer already scores it.
  // ═══════════════════════════════════════════════════════════════
  {
    const cotConsumer = "conviction COT Positioning layer";
    const c: CotContext | undefined = cot?.available ? cot : undefined;
    // The net non-commercial position is derived from the report's own long and
    // short contract counts when the payload carries them; a report that cannot
    // yield a finite net is reported UNAVAILABLE rather than as a zero.
    const net = isFiniteNumber(c?.netNonCommercial)
      ? c.netNonCommercial
      : isFiniteNumber(c?.latest.nonCommercialLong) && isFiniteNumber(c?.latest.nonCommercialShort)
        ? c.latest.nonCommercialLong - c.latest.nonCommercialShort
        : undefined;
    if (c && isFiniteNumber(net)) {
      providers.push("CFTC Commitments of Traders");
      const change = c.changeFromPreviousReport;
      const crowdRatio =
        isFiniteNumber(c.latest.openInterest) && c.latest.openInterest > 0
          ? Math.abs(net) / c.latest.openInterest
          : undefined;
      evidence.push({
        metric: "cot_net_non_commercial",
        label: "COT net non-commercial positioning",
        value: net,
        unit: "contracts",
        provider: "CFTC Commitments of Traders",
        providerInstrumentId: c.mappedAsset,
        source: c.source,
        observedAt: c.fetchedAt,
        period: c.latest.reportDate,
        freshness: String(c.freshness),
        consumedElsewhere: cotConsumer,
      });
      dimensions.push(
        dimension(
          "positioning",
          "neutral",
          `CFTC ${c.mappedAsset} (report ${c.latest.reportDate}, freshness ${c.freshness}): net non-commercial ${net.toLocaleString("en-US")}${isFiniteNumber(change) ? `, change ${change >= 0 ? "+" : ""}${change.toLocaleString("en-US")} vs the previous report` : ", no previous report for a change"}${crowdRatio !== undefined ? `, crowding ${(crowdRatio * 100).toFixed(1)}% of open interest` : ""}; the contract measures the ${c.requestedInstrument}'s ${c.mappedAsset.includes("futures") ? "mapped side" : "mapped asset"}. Informational: the COT Positioning layer already scores this evidence, so it does not move the fundamental state.`,
          { informational: true, consumedBy: cotConsumer },
        ),
      );
      if (crowdRatio !== undefined && crowdRatio > 0.3) {
        comparisons.push(
          `positioning crowding: ${c.mappedAsset} net non-commercial is ${(crowdRatio * 100).toFixed(1)}% of open interest — reported as context, interpretation left to the COT layer`,
        );
      }
    } else {
      dimensions.push(unavailable("positioning"));
      limitations.push(
        "Positioning UNAVAILABLE — the CFTC mapping covers six currency contracts, and no verified report was supplied for this pair.",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Event risk — INFORMATIONAL: the calendar gate already uses it.
  // ═══════════════════════════════════════════════════════════════
  {
    const gateConsumer = "conviction calendar gate (imminent high-impact events)";
    const upcoming = events
      .filter((e) => e.status === "upcoming" && e.importance === 3 && (e.currency === base || e.currency === quote))
      .sort((a, b) => a.datetime - b.datetime);
    if (upcoming.length > 0 && calendar) {
      const nearest = upcoming[0];
      evidence.push({
        metric: "event_risk_next",
        label: `Next high-impact ${nearest.currency} event`,
        value: nearest.event,
        provider: nearest.source || calendarProvider,
        providerInstrumentId: nearest.currency,
        source: "economic calendar (scheduled)",
        observedAt: nearest.datetime,
        ...(nearest.referencePeriod ? { period: nearest.referencePeriod } : {}),
        freshness: calendar.freshness,
        consumedElsewhere: gateConsumer,
      });
      dimensions.push(
        dimension(
          "event-risk",
          "neutral",
          `${upcoming.length} scheduled high-impact ${base}/${quote} event(s) in the provider's forward window; nearest is ${nearest.currency} ${nearest.event} on ${new Date(nearest.datetime).toISOString()}${nearest.forecast !== undefined ? ` (consensus ${String(nearest.forecast)})` : ""}. Provider macro-risk assessment: ${calendar.macroRisk.level.toUpperCase()} — ${calendar.macroRisk.explanation}. Scheduled events are risk context, never directional evidence.`,
          { informational: true, consumedBy: gateConsumer },
        ),
      );
    } else {
      dimensions.push(unavailable("event-risk"));
      limitations.push(
        "Event risk UNAVAILABLE — no upcoming high-impact event was supplied for either side of this pair in the provider's forward window.",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Honest unavailability + no-double-count disclosure
  // ═══════════════════════════════════════════════════════════════
  limitations.push(
    "Released macroeconomic values are provider measurements with their own reference periods and release instants — they are never presented as a live market price and never treated as one.",
  );
  limitations.push(
    "The conviction engine's own factors already consume released macro surprises (USD-centric) and the Treasury/COT evidence; those dimensions are marked informational here so the same provider field can never be counted twice, and this assessment feeds only the unified intelligence layer and the opportunity scanner.",
  );
  limitations.push(
    "Assessment covers only dimensions the configured macro providers actually supply; unavailable dimensions are disclosed, never estimated.",
  );

  // ── Aggregation (shared framework) ─────────────────────────────
  // "Usable" means a dimension that carries a real released measurement. A
  // category whose releases are all missing is UNAVAILABLE and must not be
  // mistaken for a scored neutral reading.
  const scorableCategories = dimensions.filter(
    (d) => !d.informational && (scoredCategories as string[]).includes(d.name) && d.status !== "unavailable",
  );
  if (scorableCategories.length === 0) {
    return {
      available: false,
      domain: "forex",
      provider: provider ?? "none",
      instrumentId: nativeId,
      observedAt: calendarObservedAt,
      periodsCount: 0,
      state: "insufficient",
      confidence: "insufficient",
      confidenceEvidence: "No usable forex fundamental evidence — no released macro measurement was supplied for either side of the pair.",
      directionalBias: "none",
      dimensions,
      contradictions: [],
      unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
      evidenceCoverage: coverageOf(dimensions, providers),
      evidence,
      metrics: {},
      limitations: [
        `No released macroeconomic measurement was supplied for ${base} or ${quote} — no two-sided fundamental assessment is produced, and none is invented.`,
        ...limitations,
      ],
    };
  }

  const { state, confidence, confidenceEvidence } = aggregateConfidence({
    dimensions,
    periodsCount: evidence.filter((e) => !/^event_risk/.test(e.metric)).length,
    periodsLabel: "provider macro measurements",
    extraCaps: [],
  });

  const scored = dimensions.filter((d) => !d.informational && d.status !== "unavailable");
  const positives = scored.filter((d) => d.status === "positive").length;
  const negatives = scored.filter((d) => d.status === "negative").length;

  const directionalBias =
    positives > 0 && negatives === 0 && positives * 2 > scored.length
      ? ("bullish" as const)
      : negatives > 0 && positives === 0 && negatives * 2 > scored.length
        ? ("bearish" as const)
        : ("none" as const);

  const directionalBiasEvidence =
    directionalBias === "none"
      ? `No directional fundamental read for ${base}/${quote}: ${positives} side(s) favouring ${base} / ${negatives} favouring ${quote} of ${scored.length} scored macro dimensions — a direction is never forced from a level reading.`
      : `Macro evidence favours ${directionalBias === "bullish" ? base : quote} over ${directionalBias === "bullish" ? quote : base}: ${directionalBias === "bullish" ? positives : negatives} of ${scored.length} scored macro dimensions (${scored.map((d) => d.name).join(", ")}).`;

  // Conflicting readings between dimensions are disclosed, not averaged away.
  const contradictions: string[] = [];
  if (positives > 0 && negatives > 0) {
    contradictions.push(
      `${base}/${quote} macro evidence conflicts between dimensions: ${scored.filter((d) => d.status === "positive").map((d) => d.name).join(", ")} favour ${base} while ${scored.filter((d) => d.status === "negative").map((d) => d.name).join(", ")} favour ${quote}.`,
    );
  }

  return {
    available: true,
    domain: "forex",
    provider: calendarProvider !== "none" ? calendarProvider : (provider ?? "none"),
    instrumentId: nativeId,
    observedAt: calendarObservedAt,
    periodsCount: evidence.length,
    state,
    confidence,
    confidenceEvidence,
    directionalBias,
    directionalBiasEvidence,
    dimensions,
    comparisons,
    contradictions,
    unavailableDimensions: dimensions.filter((d) => d.status === "unavailable").map((d) => d.name),
    evidenceCoverage: coverageOf(dimensions, providers),
    evidence,
    metrics: {},
    forexMetrics: metrics,
    limitations,
  };
}

/** Exported for the UI/tests: the dimensions this domain defines. */
export const FOREX_DIMENSIONS: FundamentalDimension["name"][] = [
  "policy-rates",
  "inflation",
  "labor",
  "growth",
  "rates-yields",
  "positioning",
  "event-risk",
  "external-balance",
];
