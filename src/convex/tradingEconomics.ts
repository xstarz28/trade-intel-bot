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

/**
 * Phase 307 — the per-request transport deadline for the 7-day UPCOMING
 * calendar request (phase 177's number, unchanged). The PAST released leg is
 * a materially larger request and gets its own deadline below — a path-
 * specific bound, never an unbounded fetch.
 */
const TA_UPCOMING_FETCH_TIMEOUT_MS = 7_000;

/**
 * Phase 307 — live evidence (runs 36962601231 and 36967115649): EUR/USD kept
 * reporting EXTERNAL_DATA_GAP while the upcoming leg delivered, so the
 * unresolved stage is exactly the historical/released request. That leg now
 * asks the provider for 40 days of events (~6x the rows of the 7-day window)
 * but still carried the 7-day deadline — a self-inflicted ceiling. It gets a
 * proportional, still-bounded deadline (20s), which the calendar leg's outer
 * budget (CALENDAR_LEG_BUDGET_MS = 25s, set where the leg is run) is sized to
 * contain. A past leg that exceeds this bound fails as `failed:timeout` —
 * provenance, never synthetic availability.
 */
const TA_PAST_FETCH_TIMEOUT_MS = 20_000;

async function taFetch(path: string, apiKey: string, timeoutMs: number = TA_UPCOMING_FETCH_TIMEOUT_MS): Promise<unknown> {
  const url = `${TA_BASE}${path}`;
  const res = await fetch(url, {
    // Bounded per-request deadline (phase 177/307): callers pass the budget
    // that matches THEIR window; nothing here fetches unbounded.
    signal: AbortSignal.timeout(timeoutMs),
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

/**
 * Phase 305 — how far back the released-measurement leg reaches (days). 40
 * spans at least one central-bank decision cycle; bounded and disclosed. The
 * events stay provider-verbatim with their own provenance.
 */
export const CALENDAR_RELEASED_LOOKBACK_DAYS = 40;

/**
 * Phase 307 — cache-identity token for the released-window contract (see the
 * qualifier on the cache descriptor below). Version-bumped whenever the
 * released acquisition's contract changes; the current token already
 * distinguishes the 40-day released acquisition from any pre-306 7-day
 * cached entry.
 */
export const CALENDAR_CACHE_CONTRACT = "released-lookback-40d-v2";

/**
 * Phase 307 — the outer budget for the calendar provider leg where it is RUN
 * (protectedAnalysis). Both inner deadlines (7s upcoming, 20s past) must fit
 * inside it with headroom; it replaces the default 8s tickatlas budget that
 * pre-306 runs effectively imposed on the whole calendar acquisition and
 * which capped the past leg below its own window's needs. Bounded, and below
 * the harness transport's 60s action deadline.
 */
export const CALENDAR_LEG_BUDGET_MS = 25_000;

/** Minimum importance of a RELEASED event merged into the calendar (>= 2). */
export const RELEASED_MERGE_MIN_IMPORTANCE = 2;

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
          // Phase 307 — the released-window CONTRACT is part of the cache
          // identity. The 40-day acquisition changed what a cached calendar
          // entry must contain (a past leg with released actuals); bumping
          // this token guarantees a stale pre-40-day cached 7-day result can
          // never be served as the 40-day acquisition. Bump on every change
          // to the released-window contract (window, merge rule, deadlines).
          qualifier: CALENDAR_CACHE_CONTRACT,
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
      // Phase 305 — the RELEASED-measurement lookback. The previous 7-day
      // window made released policy-rate and inflation measurements a coin
      // flip per run: rate decisions come ~every 6 weeks and CPI monthly, so
      // a specific pair's sides often had NO released event inside 7 days and
      // the forex fundamental honestly reported EXTERNAL_DATA_GAP (live:
      // runs 36957205385 and 36960231581 — EUR/USD, AUD/CAD, GBP/JPY all
      // "No released macroeconomic measurement ..." while the provider holds
      // those prints). 40 days spans at least one decision cycle; the events
      // are still the provider's own released values verbatim (actual,
      // reference period, release instant, source) — nothing is invented.
      const lookbackMs = CALENDAR_RELEASED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const datePast = new Date(now.getTime() - lookbackMs).toISOString().split("T")[0];
      const [upcomingLeg, pastLeg] = await Promise.all([
        runLeg(async () =>
          extractEvents(await taFetch(`/calendar?countries=${countryParam}&from=${dateFrom}&to=${dateTo}`, apiKey)),
        ),
        runLeg(async () =>
          // Phase 307 — the released-measurement leg fetches 40 days of
          // provider events and carries ITS OWN bounded deadline (see
          // TA_PAST_FETCH_TIMEOUT_MS); the upcoming leg keeps the 7s bound.
          extractEvents(
            await taFetch(
              `/calendar?countries=${countryParam}&from=${datePast}&to=${dateFrom}`,
              apiKey,
              TA_PAST_FETCH_TIMEOUT_MS,
            ),
          ),
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
      const upcomingFetched = rawEvents.length;

      // Recently released high-impact events are additive; a failed past leg
      // is reported on `error`, not silently dropped. Phase 306 — every stage
      // of this acquisition is COUNTED into the calendar's own provenance, so
      // "no released measurement was delivered" can be PROVEN stage by stage
      // (provider rows -> rows carrying the provider's own actual -> merged).
      let pastFetched = 0;
      let pastWithActual = 0;
      let merged = 0;
      if (pastLeg.status === "ok") {
        pastFetched = pastLeg.value.length;
        const existingIds = new Set(rawEvents.map((e) => e.id));
        for (const evt of pastLeg.value) {
          if (evt.id && !existingIds.has(evt.id)) {
            const norm = normalizeEvent(evt);
            // Phase 305 — importance >= 2: released prints that the extractor
            // reads (CPI for several currency areas carries importance 2) are
            // merged too, still only with the provider's OWN actual value.
            // Importance gates nothing else: macroRisk stays computed from
            // UPCOMING events only, and the forex extractor classifies by the
            // event's own category/currency, never by importance.
            if (norm && norm.importance >= RELEASED_MERGE_MIN_IMPORTANCE) {
              if (norm.actual !== undefined) pastWithActual += 1;
              if (norm.actual !== undefined) {
                rawEvents.push(evt);
                merged += 1;
              }
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
        // Phase 306 — the released-measurement leg's own provenance: the
        // provider-true counts that stand between "we asked" and "a released
        // usable measurement was delivered".
        releasedAcquisition: {
          lookbackDays: CALENDAR_RELEASED_LOOKBACK_DAYS,
          upcomingFetched,
          pastFetched,
          pastWithActual,
          merged,
          // Phase 307 — the failure CLASS travels (timeout / network /
          // provider_error / malformed / unavailable), not a bare "failed":
          // the annotation can then show exactly which bound the past leg
          // hit, and a timed-out 40-day request can never masquerade as
          // "the provider holds no released events".
          pastLeg: pastLeg.status === "ok" ? "ok" : `failed:${pastLeg.status}`,
        },
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
