/**
 * Normalized economic calendar event types.
 * Provider-agnostic: any economic calendar source maps into these types.
 */

export type EventImportance = 1 | 2 | 3; // 1=low, 2=medium, 3=high

export type EventStatus = "upcoming" | "released" | "revised" | "unavailable";

export type CalendarSource = "trading-economics" | "tickatlas";

/** A single normalized economic event. */
export interface EconomicEvent {
  id: string;
  /** Event name, e.g. "CPI (YoY)", "Non-Farm Payrolls" */
  event: string;
  /** Event category, e.g. "Inflation", "Employment", "Interest Rate" */
  category: string;
  /** Country name, e.g. "United States", "Euro Area" */
  country: string;
  /** ISO currency code, e.g. "USD", "EUR", "JPY" */
  currency: string;
  /** Scheduled/released datetime (Unix ms) */
  datetime: number;
  /** Actual released value, if available */
  actual?: number | string;
  /** Forecast/consensus value */
  forecast?: number | string;
  /** Previous period value */
  previous?: number | string;
  /** Revised previous value, if available */
  revised?: number | string;
  /** Importance: 1=low, 2=medium, 3=high */
  importance: EventImportance;
  /** Source name */
  source: string;
  /** Source URL for verification */
  sourceUrl?: string;
  /** Reference period, e.g. "Dec 2024", "Q3 2024" */
  referencePeriod?: string;
  /** Status of this event */
  status: EventStatus;
}

/** Macro risk level derived from upcoming events. */
export type MacroRiskLevel = "low" | "medium" | "high";

/** A macro risk assessment for the analysis. */
export interface MacroRiskAssessment {
  level: MacroRiskLevel;
  /** Human-readable explanation of the risk level */
  explanation: string;
  /** Number of high-impact events in the next 24h */
  highImpact24h: number;
  /** Number of high-impact events in the next 72h */
  highImpact72h: number;
  /** Nearest high-impact event, if any */
  nearestHighImpact?: {
    event: string;
    currency: string;
    datetime: number;
    hoursUntil: number;
  };
}

/** Combined economic calendar intelligence. */
export interface EconomicCalendarData {
  provider: CalendarSource;
  /** Events relevant to this instrument, sorted by datetime */
  events: EconomicEvent[];
  /** Macro risk assessment */
  macroRisk: MacroRiskAssessment;
  /** Fetched timestamp */
  timestamp: number;
  /** Data freshness */
  freshness: "realtime" | "recent" | "stale" | "unavailable";
  /** Confidence based on data completeness */
  confidence: "high" | "medium" | "low" | "unavailable";
  /** Which event windows are populated */
  availability: {
    upcoming24h: boolean;
    upcoming72h: boolean;
    recentReleased: boolean;
  };
  error?: string;
}

/** Result wrapper for the Convex action. */
export interface CalendarResult {
  success: boolean;
  data?: EconomicCalendarData;
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "RATE_LIMIT" | "AUTH_ERROR" | "NO_DATA";
  /**
   * Phase 178d — how this result was obtained, reported by the provider
   * cache. Diagnostics only; never a substitute for the payload's own
   * observation timestamp.
   */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
  /** Phase 178d — original provider observation time, preserved across hits. */
  observedAt?: number;
}

/** Mapping of currency pairs to relevant country/currency codes. */
export const FOREX_COUNTRY_MAP: Record<string, { country: string; currency: string }[]> = {
  EUR: [{ country: "Euro Area", currency: "EUR" }],
  GBP: [{ country: "United Kingdom", currency: "GBP" }],
  USD: [{ country: "United States", currency: "USD" }],
  JPY: [{ country: "Japan", currency: "JPY" }],
  CHF: [{ country: "Switzerland", currency: "CHF" }],
  CAD: [{ country: "Canada", currency: "CAD" }],
  AUD: [{ country: "Australia", currency: "AUD" }],
  NZD: [{ country: "New Zealand", currency: "NZD" }],
};

/**
 * Phase 288 — the reason a calendar acquisition never happened.
 *
 * `getRelevantCurrencies` covers only the eight majors in
 * {@link FOREX_COUNTRY_MAP}. For a pair whose sides are absent from that table
 * the relevant-currency set is empty, and NO provider request can be formed.
 * That is a COVERAGE GAP of this platform, not a provider outage: reporting it
 * as "the provider returned no data" blames the provider for a request that was
 * never sent, and (worse) implies an all-clear that was never assessed.
 *
 * Returns `undefined` when a request IS formable, so callers keep their normal
 * path.
 */
export function calendarCoverageGapReason(
  instrument: string,
  instrumentType: string,
): string | undefined {
  if (getRelevantCurrencies(instrument, instrumentType).length > 0) return undefined;

  const sides =
    instrumentType === "forex"
      ? instrument
          .toUpperCase()
          .split("/")
          .map((p) => p.trim())
          .filter((p) => p !== "")
      : [];
  const unmapped = sides.filter((code) => FOREX_COUNTRY_MAP[code] === undefined);
  const mapped = Object.keys(FOREX_COUNTRY_MAP).join(", ");

  return instrumentType === "forex"
    ? `No verified economic-calendar currency mapping for ${instrument} — no calendar request was made, so macro risk is NOT assessed${
        unmapped.length > 0 ? ` (${unmapped.join(", ")} ${unmapped.length === 1 ? "is" : "are"} not in the verified mapping)` : ""
      }. The verified mapping covers ${mapped}; a country is never guessed for an unmapped currency.`
    : `No verified economic-calendar currency mapping exists for the "${instrumentType}" routing domain — no calendar request was made and macro risk is not assessed.`;
}

/**
 * Resolve the relevant currencies/countries for an instrument.
 */
export function getRelevantCurrencies(
  instrument: string,
  instrumentType: string,
): { country: string; currency: string }[] {
  const countries: { country: string; currency: string }[] = [];

  if (instrumentType === "forex") {
    // Parse the pair: EUR/USD → EUR + USD
    const parts = instrument.toUpperCase().split("/");
    for (const p of parts) {
      const code = p.trim();
      if (FOREX_COUNTRY_MAP[code]) {
        countries.push(...FOREX_COUNTRY_MAP[code]);
      }
    }
  } else if (instrumentType === "crypto") {
    // Crypto: focus on USD macro events
    countries.push({ country: "United States", currency: "USD" });
  } else if (instrumentType === "commodity") {
    // Gold/Silver/others: USD macro events
    countries.push({ country: "United States", currency: "USD" });
  } else if (instrumentType === "stock") {
    // Stocks: primarily USD/US events
    countries.push({ country: "United States", currency: "USD" });
  }

  // Deduplicate
  const seen = new Set<string>();
  return countries.filter((c) => {
    const key = `${c.country}:${c.currency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Calculate hours from now until a given datetime.
 */
export function hoursUntil(dt: number): number {
  return Math.max(0, (dt - Date.now()) / (1000 * 60 * 60));
}

/**
 * Calculate macro risk from a list of events.
 */
export function calculateMacroRisk(events: EconomicEvent[]): MacroRiskAssessment {
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const in72h = now + 72 * 60 * 60 * 1000;

  const upcoming = events.filter((e) => e.status === "upcoming" && e.datetime > now);
  const highImpact = upcoming.filter((e) => e.importance === 3);

  const highImpact24h = highImpact.filter((e) => e.datetime <= in24h).length;
  const highImpact72h = highImpact.filter((e) => e.datetime <= in72h).length;

  let level: MacroRiskLevel = "low";
  if (highImpact24h >= 1) level = "high";
  else if (highImpact72h >= 1) level = "medium";

  const nearestHighImpact = highImpact.length > 0 ? highImpact[0] : undefined;

  let explanation: string;
  if (level === "high") {
    const nearest = nearestHighImpact!;
    const hrs = Math.round(hoursUntil(nearest.datetime));
    explanation = `${nearest.event} (${nearest.currency}) in ${hrs}h — potential high volatility catalyst. Affects ${nearest.currency} pairs and risk assets.`;
  } else if (level === "medium") {
    const nearest = nearestHighImpact!;
    const hrs = Math.round(hoursUntil(nearest.datetime));
    explanation = `${nearest.event} (${nearest.currency}) in ${hrs}h — watch for potential market movement.`;
  } else {
    const highCount = highImpact.length;
    if (highCount === 0) {
      explanation = "No high-impact economic events in the next 72 hours. Low macro event risk.";
    } else {
      explanation = `${highCount} high-impact event(s) scheduled beyond the 72h window. Near-term macro risk is low.`;
    }
  }

  return {
    level,
    explanation,
    highImpact24h,
    highImpact72h,
    nearestHighImpact: nearestHighImpact
      ? {
          event: nearestHighImpact.event,
          currency: nearestHighImpact.currency,
          datetime: nearestHighImpact.datetime,
          hoursUntil: Math.round(hoursUntil(nearestHighImpact.datetime)),
        }
      : undefined,
  };
}
