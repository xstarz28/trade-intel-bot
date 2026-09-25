/**
 * Convex server-side action for TickAtlas economic calendar.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import type {
  EconomicEvent,
  EconomicCalendarData,
  CalendarResult,
  EventImportance,
} from "../lib/data/calendar-types";
import {
  getRelevantCurrencies,
  calculateMacroRisk,
  calendarCoverageGapReason,
} from "../lib/data/calendar-types";

// ── Phase 178b — authoritative provider cache ───────────────────
// Replaces this module's private Map cache so calendar evidence shares one
// set of TTL / freshness / single-flight semantics with every other provider.
import { getProviderCache } from "../lib/data/provider-cache-registry";
import {
  isLegFailure,
  runLeg,
  summarizeLegFailures,
  ProviderHttpError,
  ProviderMalformedError,
} from "./lib/legOutcome";
import {
  asRecordArray,
  asString,
  errorMessage,
  field,
  isRecord,
  type JsonRecord,
} from "./lib/json";

// ── TickAtlas API ────────────────────────────────────────────────

const TA_BASE = "https://tickatlas.com/v1";

async function taFetch(path: string, apiKey: string): Promise<unknown> {
  const url = `${TA_BASE}${path}`;
  const res = await fetch(url, {
    // Phase 177 — HTTP deadline below the 8s tickatlas leg budget.
    signal: AbortSignal.timeout(7_000),
    headers: {
      "X-API-Key": apiKey,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("AUTH_ERROR:TickAtlas authentication failed");
    }
    if (res.status === 429) {
      throw new Error("RATE_LIMIT:TickAtlas rate limit exceeded");
    }
    throw new ProviderHttpError("TickAtlas", res.status, text || res.statusText);
  }
  try {
    return await res.json();
  } catch (err: unknown) {
    throw new ProviderMalformedError(`TickAtlas body is not JSON: ${errorMessage(err)}`);
  }
}

/**
 * TickAtlas wraps the calendar as `{ success, data: { events: [...] } }` or,
 * on older routes, `{ data: [...] }`. Anything else is "no events" — never a
 * crash, never a synthesized event.
 */
function extractEvents(result: unknown): JsonRecord[] {
  const data = field(result, "data");
  if (field(result, "success") && Array.isArray(field(data, "events"))) {
    return asRecordArray(field(data, "events"));
  }
  if (Array.isArray(data)) return asRecordArray(data);
  return [];
}

// ── Currency → Country Mapping ───────────────────────────────────

const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "United States",
  EUR: "Euro Area",
  GBP: "United Kingdom",
  JPY: "Japan",
  CHF: "Switzerland",
  CAD: "Canada",
  AUD: "Australia",
  NZD: "New Zealand",
  CNY: "China",
  SEK: "Sweden",
  NOK: "Norway",
};

// ── Response Normalization ───────────────────────────────────────

function normalizeImportance(raw: unknown): EventImportance {
  if (typeof raw !== "string" || raw === "") return 1;
  const lower = raw.toLowerCase();
  if (lower === "high") return 3;
  if (lower === "medium") return 2;
  return 1;
}

/**
 * Actual/forecast/previous cells: numbers pass through when finite, numeric
 * strings are parsed, other strings (e.g. "2.5%") are kept verbatim, and
 * blanks/dashes/objects are undefined.
 */
function parseValue(raw: unknown): number | string | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  if (raw === "" || raw === "‑" || raw === "—") return undefined;
  const num = Number(raw);
  if (Number.isFinite(num)) return num;
  return raw;
}

/** First string-valued field among `keys`, or undefined. */
function str(raw: JsonRecord, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = asString(raw[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function normalizeEvent(raw: unknown): EconomicEvent | null {
  if (!isRecord(raw)) return null;

  const rawId = raw.id;
  const id =
    typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const eventName = str(raw, "event", "Event");
  if (!eventName) return null;

  const currency = str(raw, "currency", "Currency") ?? "";
  const country = CURRENCY_COUNTRY[currency] ?? "";

  // Parse datetime — the event's schedule time is provenance supplied by the
  // provider. Phase 219: an event whose time is absent or unparseable is
  // unusable (same rule as a Treasury entry without an observation date).
  // Substituting the local clock manufactured a "scheduled right now"
  // event that then drove status, macro-risk and the upcoming-events view.
  const dateRaw = raw.datetime ?? raw.Date ?? raw.date;
  if (typeof dateRaw !== "string" && typeof dateRaw !== "number") return null;
  if (dateRaw === "") return null;
  const datetime = new Date(dateRaw).getTime();
  if (!Number.isFinite(datetime)) return null;

  // Determine status from actual/forecast
  const actual = parseValue(raw.actual ?? raw.Actual);
  const forecast = parseValue(raw.forecast ?? raw.Forecast);
  const previous = parseValue(raw.previous ?? raw.Previous);
  const revised = parseValue(raw.revised ?? raw.Revised);

  let status: EconomicEvent["status"] = "upcoming";
  if (actual !== undefined) {
    status = revised !== undefined ? "revised" : "released";
  } else if (datetime < Date.now()) {
    status = "released";
  }

  return {
    id,
    event: eventName,
    category: str(raw, "category", "Category") ?? "",
    country,
    currency,
    datetime,
    actual,
    forecast,
    previous,
    revised,
    importance: normalizeImportance(raw.impact ?? raw.Importance),
    source: "tickatlas",
    sourceUrl: str(raw, "url", "Source_url"),
    referencePeriod: str(raw, "period", "Period"),
    status,
  };
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchCalendar = action({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
  },
  handler: async (ctx, args): Promise<CalendarResult> => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

    const apiKey = process.env.TICKATLAS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "TickAtlas not configured: TICKATLAS_API_KEY is missing. Add it via: bunx convex env set TICKATLAS_API_KEY <your-key>",
        errorCode: "AUTH_ERROR",
      };
    }

    // Phase 178b — the whole acquisition runs inside the cache fetcher.
    // The instrument is upper-cased for the KEY only (the calendar response
    // depends on the resolved currency set, which is case-insensitive), so
    // `EUR/USD` and `eur/usd` no longer cause two calls for identical data.
    // The request itself still uses the caller's exact instrument.
    try {
      const evidence = await getProviderCache().fetch<EconomicCalendarData>(
        {
          provider: "tickatlas",
          dataset: "calendar",
          instrument: args.instrument.toUpperCase().trim(),
          instrumentType: args.instrumentType,
        },
        async () => {
      // Determine relevant currencies for this instrument
      const relevantCurrencies = getRelevantCurrencies(args.instrument, args.instrumentType);
      if (relevantCurrencies.length === 0) {
        // Phase 178b — nothing to acquire. Return null so the cache stores
        // no entry: an absent currency mapping is not evidence.
        return null;
      }

      const countryParam = relevantCurrencies
        .map((c) => encodeURIComponent(c.country))
        .join(",");

      // Fetch upcoming events (next 7 days)
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dateFrom = now.toISOString().split("T")[0];
      const dateTo = in7Days.toISOString().split("T")[0];

      // Phase 229 — both legs run through the shared leg taxonomy. Fatal
      // classes (RATE_LIMIT / AUTH_ERROR) reject out of runLeg — from EITHER
      // leg — so the Phase 178b contract holds: nothing is cached and the
      // outer catch emits the RATE_LIMIT / AUTH_ERROR envelope. Before this
      // phase the past leg's `catch {}` discarded a 429 outright, and a
      // timeout / 5xx on the UPCOMING leg was swallowed into an empty event
      // list that was then cached as a success with macroRisk LOW.
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const datePast = sevenDaysAgo.toISOString().split("T")[0];
      const [upcomingLeg, pastLeg] = await Promise.all([
        runLeg(async () =>
          extractEvents(await taFetch(`/calendar?countries=${countryParam}&from=${dateFrom}&to=${dateTo}`, apiKey)),
        ),
        runLeg(async () =>
          extractEvents(await taFetch(`/calendar?countries=${countryParam}&from=${datePast}&to=${dateFrom}`, apiKey)),
        ),
      ]);
      const legs = { upcoming: upcomingLeg, recentReleased: pastLeg };
      const legFailures = summarizeLegFailures(legs);

      // The upcoming window is the one macro-risk is computed from. If that
      // leg failed for a transport/provider reason there is no calendar to
      // assess: throw so the action reports API_UNAVAILABLE and nothing is
      // cached — an outage must never read as "no events → LOW risk".
      if (isLegFailure(upcomingLeg)) {
        throw new Error(`Calendar fetch failed: ${legFailures}`);
      }

      const rawEvents: JsonRecord[] = upcomingLeg.status === "ok" ? upcomingLeg.value : [];

      // Recently released high-impact events (last 7 days) are additive; a
      // failed past leg is reported on `error`, not silently dropped.
      if (pastLeg.status === "ok") {
        const existingIds = new Set(rawEvents.map((e) => e.id));
        for (const evt of pastLeg.value) {
          if (evt.id && !existingIds.has(evt.id)) {
            const norm = normalizeEvent(evt);
            if (norm && norm.importance === 3 && norm.actual !== undefined) {
              rawEvents.push(evt);
            }
          }
        }
      }

      // Normalize and filter by relevant currencies
      const relevantCurrencySet = new Set(relevantCurrencies.map((c) => c.currency));
      const events: EconomicEvent[] = [];

      for (const raw of rawEvents) {
        const event = normalizeEvent(raw);
        if (!event) continue;
        if (event.currency && relevantCurrencySet.has(event.currency)) {
          events.push(event);
        }
      }

      // Sort by datetime
      events.sort((a, b) => a.datetime - b.datetime);

      // Calculate macro risk
      const macroRisk = calculateMacroRisk(events);

      // Determine availability
      const nowMs = Date.now();
      const in24h = nowMs + 24 * 60 * 60 * 1000;
      const in72h = nowMs + 72 * 60 * 60 * 1000;

      const upcoming = events.filter((e) => e.status === "upcoming" && e.datetime > nowMs);
      const recentlyReleased = events.filter((e) => e.status === "released" && e.datetime > nowMs - 7 * 24 * 60 * 60 * 1000);

      const availability = {
        upcoming24h: upcoming.some((e) => e.datetime <= in24h),
        upcoming72h: upcoming.some((e) => e.datetime <= in72h),
        recentReleased: recentlyReleased.length > 0,
      };

      // Determine confidence
      let confidence: EconomicCalendarData["confidence"] = "unavailable";
      if (events.length > 0) {
        const hasHighImpact = events.some((e) => e.importance === 3);
        if (hasHighImpact && events.length >= 5) confidence = "high";
        else if (events.length >= 3) confidence = "medium";
        else confidence = "low";
      }

      const data: EconomicCalendarData = {
        provider: "tickatlas" as EconomicCalendarData["provider"],
        events,
        macroRisk,
        timestamp: Date.now(),
        freshness: events.length > 0 ? "recent" : "unavailable",
        confidence,
        availability,
        // Phase 229 — partial: the past-events leg failed (class + reason).
        ...(legFailures ? { error: legFailures } : {}),
      };

          return { data, observedAt: data.timestamp };
        },
      );
      if (!evidence) {
        // Phase 288 — the fetcher's only `null` path is the empty
        // relevant-currency guard (an absent currency mapping is not
        // evidence, so no request is formed and nothing is cached). Saying
        // "the provider returned no data" there blames the provider for a
        // request this platform never sent, and reads as an all-clear that was
        // never assessed. The coverage gap is named for what it is.
        const gap = calendarCoverageGapReason(args.instrument, args.instrumentType);
        return {
          success: false,
          error: gap ?? "Calendar provider returned no data.",
          errorCode: "NO_DATA",
        };
      }
      // Verbatim payload: `timestamp` remains the original observation time.
      return {
        success: true,
        data: evidence.data,
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return { success: false, error: "TickAtlas rate limit exceeded.", errorCode: "RATE_LIMIT" };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return { success: false, error: "TickAtlas authentication failed.", errorCode: "AUTH_ERROR" };
      }
      return {
        success: false,
        error: `Calendar fetch failed: ${msg}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});
