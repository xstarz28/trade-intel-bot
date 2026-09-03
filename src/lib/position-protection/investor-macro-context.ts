/**
 * Phase 140 — Investor Macro Context View Model (pure)
 *
 * SELECTION ONLY. This module never fetches data, never runs an analyzer and
 * never calculates a score, regime or relationship. It maps already-existing
 * macro/cross-asset state (live quotes, US Treasury yields, economic calendar)
 * into a compact investor-oriented view while preserving each source's own
 * availability/freshness semantics.
 *
 * Global-context boundary: every structure produced here is PORTFOLIO/GLOBAL.
 * There is no positionId field anywhere and no association with any position
 * — macro context applies to the whole portfolio, never to a single position.
 *
 * Missing data stays missing: an absent quote is UNAVAILABLE with value null,
 * a stale quote stays STALE (never LIVE), absent yields/events simply do not
 * produce rows. No fallback numbers are invented.
 */

import type { TreasuryData } from "../data/treasury";
import type { EconomicCalendarData } from "../data/calendar-types";
import type { LiveInstrumentState } from "./use-live-protection-polling";

// ─── Macro quotes (VIX / DXY / US10Y / WTI) ──────────────────────────
//
// livePrices may be keyed by the requested canonical symbol OR by the Yahoo
// alias the provider actually returned ("^VIX", "DX-Y.NYB", "^TNX",
// "CL=F"/"CL"). Lookup is alias-aware; only the provider's own record is used.

export type MacroQuoteStatus = "LIVE" | "STALE" | "UNAVAILABLE";

export interface MacroQuoteView {
  /** Canonical symbol used for the i18n label lookup (VIX/DXY/US10Y/WTI). */
  symbol: "VIX" | "DXY" | "US10Y" | "WTI";
  /** Raw provider value, verbatim. null when unavailable. */
  value: number | null;
  /** Provider-reported 24h change, verbatim. null when not provided. */
  change24h: number | null;
  /** Source status preserved from the provider state. */
  status: MacroQuoteStatus;
  /** Provider name when known. */
  provider: string | null;
}

const MACRO_QUOTE_DEFS: ReadonlyArray<{
  symbol: MacroQuoteView["symbol"];
  aliases: readonly string[];
}> = [
  { symbol: "VIX", aliases: ["VIX", "^VIX"] },
  { symbol: "DXY", aliases: ["DXY", "DX-Y.NYB"] },
  { symbol: "US10Y", aliases: ["US10Y", "^TNX"] },
  { symbol: "WTI", aliases: ["WTI", "CL=F", "CL"] },
];

/**
 * Selects the four macro quotes from the shared live-price map.
 * - sourceMode LIVE && price > 0  → LIVE quote with the provider value
 * - sourceMode STALE              → STALE quote (price shown but flagged STALE)
 * - anything else / missing       → UNAVAILABLE, value null
 */
export function selectMacroQuotes(
  livePrices: ReadonlyMap<string, LiveInstrumentState>,
): MacroQuoteView[] {
  return MACRO_QUOTE_DEFS.map(({ symbol, aliases }) => {
    let state: LiveInstrumentState | undefined;
    for (const alias of aliases) {
      const candidate = livePrices.get(alias);
      if (candidate) {
        state = candidate;
        break;
      }
    }

    if (!state) {
      return { symbol, value: null, change24h: null, status: "UNAVAILABLE", provider: null };
    }
    if (state.sourceMode === "LIVE" && state.price > 0) {
      return {
        symbol,
        value: state.price,
        change24h: state.change24h ?? null,
        status: "LIVE",
        provider: state.provider,
      };
    }
    if (state.sourceMode === "STALE") {
      return {
        symbol,
        value: state.price > 0 ? state.price : null,
        change24h: state.change24h ?? null,
        status: "STALE",
        provider: state.provider,
      };
    }
    return { symbol, value: null, change24h: null, status: "UNAVAILABLE", provider: state.provider };
  });
}

// ─── US Treasury yields (official curve) ──────────────────────────────

export interface TreasuryRateRow {
  /** Tenor code: "2Y", "10Y" (nominal) or "REAL_10Y" (real/TIPS). */
  tenor: "2Y" | "10Y" | "REAL_10Y";
  /** Actual reported rate (%). Never interpolated or derived. */
  value: number;
}

export interface TreasuryRatesView {
  /** Whether the official Treasury feed is available. */
  available: boolean;
  /** Treasury feed's own freshness classification. */
  freshness: "FRESH" | "DELAYED" | "STALE" | null;
  /** Observation date from the feed itself (YYYY-MM-DD). */
  observationDate: string | null;
  /** Only tenors actually present in the feed. */
  rows: TreasuryRateRow[];
}

/** Selects the 2Y/10Y nominal and 10Y real (TIPS) points when present. */
export function selectTreasuryRates(treasuryData: TreasuryData | null): TreasuryRatesView {
  if (!treasuryData || !treasuryData.available) {
    return { available: false, freshness: null, observationDate: null, rows: [] };
  }

  const rows: TreasuryRateRow[] = [];
  const nominal = treasuryData.latest.nominal.nominal;

  const pushNominal = (tenor: "2Y" | "10Y") => {
    const value = nominal[tenor];
    if (value !== undefined && Number.isFinite(value)) {
      rows.push({ tenor, value });
    }
  };
  pushNominal("2Y");
  pushNominal("10Y");

  const real10Y = treasuryData.latest.real?.real?.["10Y"];
  if (real10Y !== undefined && Number.isFinite(real10Y)) {
    rows.push({ tenor: "REAL_10Y", value: real10Y });
  }

  return {
    available: rows.length > 0,
    freshness: treasuryData.freshness,
    observationDate: treasuryData.latest.nominal.observationDate,
    rows,
  };
}

// ─── Economic calendar (upcoming macro events) ────────────────────────

export interface UpcomingEventView {
  /** Event name as reported by the calendar source. */
  event: string;
  /** ISO currency code. */
  currency: string;
  /** Country as reported. */
  country: string;
  /** Scheduled datetime (Unix ms). */
  datetime: number;
  /** Importance 1=low, 2=medium, 3=high (verbatim). */
  importance: 1 | 2 | 3;
}

export interface UpcomingEventsOptions {
  /** Only events with importance >= this value. Default 2. */
  minImportance?: 1 | 2 | 3;
  /** Only events within this many days. Default 7. */
  maxDays?: number;
  /** Max rows returned (earliest first). Default 3. */
  limit?: number;
}

/**
 * Selects the nearest upcoming macro events from the existing calendar data.
 * Only events whose own status is "upcoming" are eligible.
 */
export function selectUpcomingEvents(
  calendarData: EconomicCalendarData | null,
  options?: UpcomingEventsOptions,
): UpcomingEventView[] {
  if (!calendarData?.events || calendarData.events.length === 0) return [];

  const minImportance = options?.minImportance ?? 2;
  const maxDays = options?.maxDays ?? 7;
  const limit = options?.limit ?? 3;
  const now = Date.now();
  const horizonMs = maxDays * 24 * 60 * 60 * 1000;

  return calendarData.events
    .filter(
      (e) =>
        e.status === "upcoming" &&
        e.datetime > now &&
        e.datetime < now + horizonMs &&
        e.importance >= minImportance,
    )
    .sort((a, b) => a.datetime - b.datetime)
    .slice(0, limit)
    .map((e) => ({
      event: e.event,
      currency: e.currency,
      country: e.country,
      datetime: e.datetime,
      importance: e.importance,
    }));
}

// ─── Macro risk (calendar module's own derived assessment) ─────────────

export type MacroRiskLevelView = "low" | "medium" | "high";

/**
 * The calendar module already derives a global macro-risk assessment from
 * upcoming high-impact events. The investor view reuses that derived level
 * verbatim (never recomputed here).
 */
export function selectMacroRisk(
  calendarData: EconomicCalendarData | null,
): MacroRiskLevelView | null {
  const level = calendarData?.macroRisk?.level;
  return level === "low" || level === "medium" || level === "high" ? level : null;
}

// ─── Aggregated investor macro context ────────────────────────────────

export interface InvestorMacroContext {
  /** Global macro quotes. NOT keyed to any position. */
  quotes: MacroQuoteView[];
  /** Global rates from the official Treasury curve. NOT keyed to any position. */
  rates: TreasuryRatesView;
  /** Global upcoming macro events. NOT keyed to any position. */
  events: UpcomingEventView[];
  /**
   * Global macro-risk level derived by the calendar module (verbatim), or
   * null when the calendar provider did not supply one.
   */
  macroRisk: MacroRiskLevelView | null;
  /**
   * true when at least one macro evidence item is present somewhere.
   * Drives the explicit empty/unavailable state in the UI.
   */
  hasAnyData: boolean;
  /** Number of LIVE quotes (allows a compact live indicator). */
  liveQuoteCount: number;
}

/**
 * Builds the full global macro context for the investor workspace from the
 * shared, already-fetched state. Pure: identical inputs → identical output;
 * never mutates inputs; no side effects.
 */
export function buildInvestorMacroContext(
  livePrices: ReadonlyMap<string, LiveInstrumentState>,
  treasuryData: TreasuryData | null,
  calendarData: EconomicCalendarData | null,
): InvestorMacroContext {
  const quotes = selectMacroQuotes(livePrices);
  const rates = selectTreasuryRates(treasuryData);
  const events = selectUpcomingEvents(calendarData);

  const hasAnyData =
    quotes.some((q) => q.value !== null) ||
    rates.rows.length > 0 ||
    events.length > 0;

  return {
    quotes,
    rates,
    events,
    macroRisk: selectMacroRisk(calendarData),
    hasAnyData,
    liveQuoteCount: quotes.filter((q) => q.status === "LIVE").length,
  };
}
