/**
 * Convex server-side action for Trading Economics economic calendar.
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

// ── Trading Economics API ────────────────────────────────────────

const TE_BASE = "https://api.tradingeconomics.com";

async function teFetch(path: string, apiKey: string): Promise<any> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${TE_BASE}${path}${separator}c=${apiKey}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("AUTH_ERROR:Trading Economics authentication failed");
    }
    if (res.status === 429) {
      throw new Error("RATE_LIMIT:Trading Economics rate limit exceeded");
    }
    throw new Error(`Trading Economics HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// ── Response Normalization ───────────────────────────────────────

function normalizeImportance(raw: string | number | undefined): EventImportance {
  if (typeof raw === "number") {
    if (raw >= 3) return 3;
    if (raw === 2) return 2;
    return 1;
  }
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "high" || lower === "3") return 3;
    if (lower === "medium" || lower === "mid" || lower === "2") return 2;
  }
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

  const id = raw.id ?? raw.Symbol ?? raw.Event ?? `te-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const eventName = raw.Event ?? raw.Name ?? raw.event ?? "";
  if (!eventName) return null;

  const country = raw.Country ?? raw.country ?? "";
  const currency = raw.Currency ?? raw.currency ?? "";

  // Parse datetime
  let datetime = Date.now();
  const dateStr = raw.Date ?? raw.date ?? raw.Datetime;
  if (dateStr) {
    const parsed = new Date(dateStr).getTime();
    if (!isNaN(parsed)) datetime = parsed;
  }

  // Determine status
  const actual = parseValue(raw.Actual ?? raw.actual);
  const forecast = parseValue(raw.Forecast ?? raw.forecast);
  const previous = parseValue(raw.Previous ?? raw.previous);
  const revised = parseValue(raw.Revised ?? raw.revised);

  let status: EconomicEvent["status"] = "upcoming";
  if (actual !== undefined) {
    status = revised !== undefined ? "revised" : "released";
  } else if (datetime < Date.now()) {
    // Past event with no actual — data might be missing
    status = "released";
  }

  return {
    id: String(id),
    event: eventName,
    category: raw.Category ?? raw.Type ?? raw.category ?? "",
    country,
    currency,
    datetime,
    actual,
    forecast,
    previous,
    revised,
    importance: normalizeImportance(raw.Importance ?? raw.important ?? 1),
    source: "trading-economics",
    sourceUrl: raw.Source_url ?? raw.url,
    referencePeriod: raw.Period ?? raw.period,
    status,
  };
}

// ── Currency Code Mapping ────────────────────────────────────────

function currencyToTECode(currency: string): string {
  const map: Record<string, string> = {
    EUR: "EUR",
    GBP: "GBP",
    USD: "USD",
    JPY: "JPY",
    CHF: "CHF",
    CAD: "CAD",
    AUD: "AUD",
    NZD: "NZD",
  };
  return map[currency.toUpperCase()] ?? currency.toUpperCase();
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchCalendar = action({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
  },
  handler: async (_ctx, args): Promise<CalendarResult> => {
    const apiKey = process.env.TRADING_ECONOMICS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error:
          "Trading Economics not configured: TRADING_ECONOMICS_API_KEY is missing. Add it via: bunx convex env set TRADING_ECONOMICS_API_KEY <your-key>",
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

      const currencyCodes = relevantCurrencies
        .map((c) => currencyToTECode(c.currency))
        .join(",");

      // Fetch upcoming + recent events
      // Trading Economics calendar endpoint: /calendar
      // Filter by countries
      const countries = relevantCurrencies.map((c) => c.country);
      const countryParam = countries.join(",");

      // Fetch upcoming events (next 7 days)
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dateFrom = now.toISOString().split("T")[0];
      const dateTo = in7Days.toISOString().split("T")[0];

      let rawEvents: any[] = [];
      try {
        const data = await teFetch(
          `/calendar/country/${encodeURIComponent(countryParam)}?d1=${dateFrom}&d2=${dateTo}`,
          apiKey,
        );
        if (Array.isArray(data)) {
          rawEvents = data;
        }
      } catch (err: any) {
        if (String(err?.message).startsWith("RATE_LIMIT")) {
          return { success: false, error: "Trading Economics rate limit exceeded.", errorCode: "RATE_LIMIT" };
        }
        if (String(err?.message).startsWith("AUTH_ERROR")) {
          return { success: false, error: "Trading Economics authentication failed.", errorCode: "AUTH_ERROR" };
        }
        // Try alternate endpoint format
        try {
          const data = await teFetch(
            `/calendar?country=${encodeURIComponent(countryParam)}&d1=${dateFrom}&d2=${dateTo}`,
            apiKey,
          );
          if (Array.isArray(data)) {
            rawEvents = data;
          }
        } catch {
          // Both endpoints failed — continue with empty data
        }
      }

      // Also fetch recently released high-impact events (last 7 days)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const datePast = sevenDaysAgo.toISOString().split("T")[0];

      try {
        const data = await teFetch(
          `/calendar/country/${encodeURIComponent(countryParam)}?d1=${datePast}&d2=${dateFrom}`,
          apiKey,
        );
        if (Array.isArray(data)) {
          // Only add high-impact recently released events not already in upcoming
          const existingIds = new Set(rawEvents.map((e: any) => e.id ?? e.Symbol));
          for (const evt of data) {
            const norm = normalizeEvent(evt);
            if (norm && norm.importance === 3 && norm.actual !== undefined && !existingIds.has(norm.id)) {
              rawEvents.push(evt);
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
        // Only include events for relevant currencies
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
        provider: "trading-economics",
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
