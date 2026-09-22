/**
 * Single Twelve Data live protocol.
 *
 * Catalog discovery, native OHLCV, `/time_series`, `/quote`, and the
 * Convex `fetchMarketData` candle path must agree on:
 *   - URL shape (credentials are NEVER placed on the URL here),
 *   - interval mapping,
 *   - body/error parsing,
 *   - chronological candle order,
 *   - rejection of empty / NaN / unusable series.
 *
 * The transport injects the server-side key. Callers must never log the
 * final URL after injection.
 */

import type { OhlcvCandle } from "@/lib/data/market-types";
import {
  classifyLiveFailure,
  type LiveAcquisitionFailureClass,
} from "./failure-class";

const BASE = "https://api.twelvedata.com";

/** Provider interval tokens Twelve Data actually accepts. */
const INTERVAL: Record<string, string> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
  W1: "1week",
  "1min": "1min",
  "5min": "5min",
  "15min": "15min",
  "1h": "1h",
  "4h": "4h",
  "1day": "1day",
  "1week": "1week",
};

export function mapTwelveDataInterval(tf: string): string {
  return INTERVAL[tf] ?? INTERVAL[tf.toUpperCase()] ?? tf.toLowerCase();
}

export function buildTwelveDataTimeSeriesUrl(
  symbol: string,
  timeframe: string,
  outputsize: number,
): string {
  const interval = mapTwelveDataInterval(timeframe);
  return `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=${outputsize}`;
}

export function buildTwelveDataQuoteUrl(symbol: string): string {
  return `${BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
}

export interface TwelveDataVendorError {
  failureClass: LiveAcquisitionFailureClass;
  /** Safe reason — no secret, no raw dump. */
  reason: string;
  vendorCode?: number;
}

/**
 * Twelve Data answers many failures as HTTP 200 with `{ code, message }`.
 * HTTP status alone cannot classify them.
 */
export function inspectTwelveDataBody(json: unknown): TwelveDataVendorError | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as { code?: unknown; message?: unknown; status?: unknown };
  if (rec.code === undefined || rec.code === null || rec.code === 0 || rec.code === "") {
    return null;
  }
  const vendorCode =
    typeof rec.code === "number"
      ? rec.code
      : typeof rec.code === "string" && /^\d+$/.test(rec.code)
        ? Number(rec.code)
        : undefined;
  const message = typeof rec.message === "string" ? rec.message : "provider error";
  const failureClass = classifyLiveFailure({
    vendorCode,
    message: `[${vendorCode ?? rec.code}] ${message}`,
  });
  return {
    failureClass,
    reason: `[${vendorCode ?? String(rec.code)}] ${message}`,
    ...(vendorCode !== undefined ? { vendorCode } : {}),
  };
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  return NaN;
}

export type ParsedTwelveDataSeries =
  | { ok: true; candles: OhlcvCandle[]; symbol: string | null }
  | { ok: false; failureClass: LiveAcquisitionFailureClass; reason: string };

/**
 * Parse a `/time_series` body into chronological, numerically valid candles.
 * Invalid rows are dropped, never repaired. An empty usable series is a
 * failure — never a successful empty chart.
 */
export function parseTwelveDataTimeSeries(json: unknown): ParsedTwelveDataSeries {
  const vendor = inspectTwelveDataBody(json);
  if (vendor) {
    return { ok: false, failureClass: vendor.failureClass, reason: vendor.reason };
  }
  if (!json || typeof json !== "object") {
    return {
      ok: false,
      failureClass: "MALFORMED_RESPONSE",
      reason: "Provider returned a non-object time_series body.",
    };
  }
  const rec = json as {
    values?: unknown;
    symbol?: unknown;
  };
  if (!Array.isArray(rec.values)) {
    return {
      ok: false,
      failureClass: "NO_LIVE_DATA",
      reason: "no candle data returned",
    };
  }

  const parsed: OhlcvCandle[] = [];
  for (const row of rec.values) {
    if (!row || typeof row !== "object") continue;
    const c = row as {
      datetime?: unknown;
      open?: unknown;
      high?: unknown;
      low?: unknown;
      close?: unknown;
      volume?: unknown;
    };
    const timestamp = new Date(String(c.datetime ?? "")).getTime();
    const open = num(c.open);
    const high = num(c.high);
    const low = num(c.low);
    const close = num(c.close);
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    parsed.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(num(c.volume)) ? num(c.volume) : 0,
    });
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      failureClass: rec.values.length === 0 ? "NO_LIVE_DATA" : "MALFORMED_RESPONSE",
      reason:
        rec.values.length === 0
          ? "no candle data returned"
          : "provider returned no numerically valid candles",
    };
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);
  const symbol = typeof rec.symbol === "string" ? rec.symbol : null;
  return { ok: true, candles: parsed, symbol };
}

export interface ParsedTwelveDataQuote {
  close: number;
  timestamp?: unknown;
  bid?: number;
  ask?: number;
}

export type ParsedQuoteResult =
  | { ok: true; quote: ParsedTwelveDataQuote }
  | { ok: false; failureClass: LiveAcquisitionFailureClass; reason: string };

export function parseTwelveDataQuote(json: unknown): ParsedQuoteResult {
  const vendor = inspectTwelveDataBody(json);
  if (vendor) {
    return { ok: false, failureClass: vendor.failureClass, reason: vendor.reason };
  }
  if (!json || typeof json !== "object") {
    return {
      ok: false,
      failureClass: "MALFORMED_RESPONSE",
      reason: "Provider returned a non-object quote body.",
    };
  }
  const rec = json as { close?: unknown; timestamp?: unknown; bid?: unknown; ask?: unknown };
  if (rec.close === undefined) {
    return {
      ok: false,
      failureClass: "NO_LIVE_DATA",
      reason: "quote has no close",
    };
  }
  const close = num(rec.close);
  if (!Number.isFinite(close) || close <= 0) {
    return {
      ok: false,
      failureClass: "MALFORMED_RESPONSE",
      reason: "quote close is not a positive finite number",
    };
  }
  const bid = num(rec.bid);
  const ask = num(rec.ask);
  return {
    ok: true,
    quote: {
      close,
      timestamp: rec.timestamp,
      ...(Number.isFinite(bid) && bid > 0 ? { bid } : {}),
      ...(Number.isFinite(ask) && ask > 0 ? { ask } : {}),
    },
  };
}

/** OKX candle bar tokens. Unmapped timeframes stay undefined — never defaulted. */
const OKX_BAR: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1H",
  H4: "4H",
  D1: "1D",
  W1: "1W",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
  "1W": "1W",
  "1h": "1H",
  "4h": "4H",
  "1day": "1D",
  "1week": "1W",
};

export function mapOkxBar(tf: string): string | undefined {
  return OKX_BAR[tf] ?? OKX_BAR[tf.toUpperCase()];
}

export function buildOkxCandlesUrl(
  instId: string,
  timeframe: string,
  limit: number,
): string | undefined {
  const bar = mapOkxBar(timeframe);
  if (!bar) return undefined;
  return `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${encodeURIComponent(bar)}&limit=${limit}`;
}
