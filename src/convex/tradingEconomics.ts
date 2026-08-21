/**
 * Convex server-side action for TickAtlas economic calendar.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import type {
  EconomicEvent,
  EconomicCalendarData,
  CalendarResult,
  EventImportance,
} from "../lib/data/calendar-types";
import { getRelevantCurrencies, calculateMacroRisk } from "../lib/data/calendar-types";

// ── In-memory cache (20 min TTL) ────────────────────────────────
const cache = new Map<string, { data: EconomicCalendarData; expiresAt: number }>();
const CACHE_TTL = 20 * 60 * 1000;

function getCached(key: string): EconomicCalendarData | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  cache.delete(key);
  return null;
}

// ── TickAtlas API ────────────────────────────────────────────────

const TA_BASE = "https://tickatlas.com/v1";

async function taFetch(path: string, apiKey: string): Promise<any> {
  const url = `${TA_BASE}${path}`;
  const res = await fetch(url, {
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
    throw new Error(`TickAtlas HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
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

function normalizeImportance(raw: string | undefined): EventImportance {
  if (!raw) return 1;
  const lower = raw.toLowerCase();
  if (lower === "high") return 3;
  if (lower === "medium") return 2;
  return 1;
}

function parseValue(raw: any): number | string | undefined {
  if (raw === null || raw === undefined || raw === "" || raw === "‑" || raw === "—") {
    return undefined;
  }
  const num = Number(raw);
  if (!isNaN(num) && raw !== "") return num;
  return String(raw);
}

function normalizeEvent(raw: any): EconomicEvent | null {
  if (!raw) return null;

  const id = raw.id ?? `ta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const eventName = raw.event ?? raw.Event ?? "";
  if (!eventName) return null;

  const currency = raw.currency ?? raw.Currency ?? "";
  const country = CURRENCY_COUNTRY[currency] ?? "";

  // Parse datetime
  let datetime = Date.now();
  const dateStr = raw.datetime ?? raw.Date ?? raw.date;
  if (dateStr) {
    const parsed = new Date(dateStr).getTime();
    if (!isNaN(parsed)) datetime = parsed;
  }

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
    id: String(id),
    event: eventName,
    category: raw.category ?? raw.Category ?? "",
    country,
    currency,
    datetime,
    actual,
    forecast,
    previous,
    revised,
    importance: normalizeImportance(raw.impact ?? raw.Importance),
    source: "tickatlas",
    sourceUrl: raw.url ?? raw.Source_url,
    referencePeriod: raw.period ?? raw.Period,
    status,
  };
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchCalendar = action({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
  },
  handler: async (_ctx, args): Promise<CalendarResult> => {
    const apiKey = process.env.TICKATLAS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "TickAtlas not configured: TICKATLAS_API_KEY is missing. Add it via: bunx convex env set TICKATLAS_API_KEY <your-key>",
        errorCode: "AUTH_ERROR",
      };
    }

    const cacheKey = `cal:${args.instrument}:${args.instrumentType}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    try {
      // Determine relevant currencies for this instrument
      const relevantCurrencies = getRelevantCurrencies(args.instrument, args.instrumentType);
      if (relevantCurrencies.length === 0) {
        return {
          success: false,
          error: "No relevant currencies determined for this instrument.",
          errorCode: "NO_DATA",
        };
      }

      const countryParam = relevantCurrencies
        .map((c) => encodeURIComponent(c.country))
        .join(",");

      // Fetch upcoming events (next 7 days)
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dateFrom = now.toISOString().split("T")[0];
      const dateTo = in7Days.toISOString().split("T")[0];

      let rawEvents: any[] = [];
      try {
        const result = await taFetch(
          `/calendar?countries=${countryParam}&from=${dateFrom}&to=${dateTo}`,
          apiKey,
        );
        if (result?.success && Array.isArray(result?.data?.events)) {
          rawEvents = result.data.events;
        } else if (Array.isArray(result?.data)) {
          rawEvents = result.data;
        }
      } catch (err: any) {
        if (String(err?.message).startsWith("RATE_LIMIT")) {
          return { success: false, error: "TickAtlas rate limit exceeded.", errorCode: "RATE_LIMIT" };
        }
        if (String(err?.message).startsWith("AUTH_ERROR")) {
          return { success: false, error: "TickAtlas authentication failed.", errorCode: "AUTH_ERROR" };
        }
      }

      // Also fetch recently released high-impact events (last 7 days)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const datePast = sevenDaysAgo.toISOString().split("T")[0];

      try {
        const result = await taFetch(
          `/calendar?countries=${countryParam}&from=${datePast}&to=${dateFrom}`,
          apiKey,
        );
        const pastEvents = result?.success && Array.isArray(result?.data?.events)
          ? result.data.events
          : Array.isArray(result?.data) ? result.data : [];
        if (Array.isArray(pastEvents)) {
          const existingIds = new Set(rawEvents.map((e: any) => e.id));
          for (const evt of pastEvents) {
            if (evt.id && !existingIds.has(evt.id)) {
              const norm = normalizeEvent(evt);
              if (norm && norm.importance === 3 && norm.actual !== undefined) {
                rawEvents.push(evt);
              }
            }
          }
        }
      } catch {
        // Recent events fetch failed — not critical
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
      };

      cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: `Calendar fetch failed: ${err?.message ?? "unknown error"}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});
