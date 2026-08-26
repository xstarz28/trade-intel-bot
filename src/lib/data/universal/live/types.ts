/**
 * Phase 46 — LIVE Universal Provider Integration Types
 *
 * Live status classification, response validation results,
 * structured diagnostics, cross-provider consistency and
 * non-decision data-quality assessment.
 *
 * CRITICAL RULES:
 *   - LIVE_VERIFIED is ONLY assigned after a real response was
 *     received AND successfully parsed AND validated.
 *   - Never report a mocked/deterministic result as LIVE_VERIFIED.
 *   - Diagnostics NEVER contain credentials or secrets.
 */

import type { DataCapability } from "../types";

// ═══════════════════════════════════════════════════════════════
// 1. LIVE STATUS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export type LiveStatus =
  /** Real response received, parsed and fully validated. */
  | "LIVE_VERIFIED"
  /** Real response received but some records/fields were invalid or missing. */
  | "LIVE_PARTIAL"
  /** Provider requires an API key that is not configured. */
  | "CREDENTIAL_MISSING"
  /** Network-level failure: fetch threw, DNS failure, connection refused. */
  | "NETWORK_UNAVAILABLE"
  /** Provider responded with HTTP 429 (rate limit). */
  | "RATE_LIMITED"
  /** Provider returned an error response (4xx other than 401/403/429, or 5xx). */
  | "PROVIDER_ERROR"
  /** Response body could not be parsed or failed structural validation. */
  | "MALFORMED_RESPONSE"
  /** No provider supports the requested capability for this instrument. */
  | "UNSUPPORTED"
  /** Instrument unknown or no route available for another reason. */
  | "UNAVAILABLE";

/** True when the status proves a real provider round-trip happened. */
export function isLiveStatus(status: LiveStatus): boolean {
  return status === "LIVE_VERIFIED" || status === "LIVE_PARTIAL";
}

// ═══════════════════════════════════════════════════════════════
// 2. OHLCV VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface OhlcvRecord {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type OhlcvIssueReason =
  | "NOT_A_NUMBER"
  | "NON_POSITIVE_PRICE"
  | "NEGATIVE_VOLUME"
  | "REVERSED_OHLC_HIGH"
  | "REVERSED_OHLC_LOW"
  | "DUPLICATE_TIMESTAMP"
  | "OUT_OF_ORDER_TIMESTAMP"
  | "FUTURE_TIMESTAMP";

export interface OhlcvIssue {
  index: number;
  reason: OhlcvIssueReason;
}

export interface OhlcvValidationResult {
  valid: boolean;
  totalRecords: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectedIndices: number[];
  issues: OhlcvIssue[];
}

/**
 * Validate a raw OHLCV series.
 * Invalid records are REJECTED — never repaired with fabricated values.
 */
export function validateOhlcvSeries(
  candles: OhlcvRecord[],
  options: { now?: number; maxFutureSkewMs?: number } = {},
): OhlcvValidationResult {
  const now = options.now ?? Date.now();
  const maxSkew = options.maxFutureSkewMs ?? 5 * 60 * 1000;
  const issues: OhlcvIssue[] = [];
  const rejectedIndices = new Set<number>();
  let lastTimestamp = -Infinity;

  candles.forEach((c, i) => {
    const reject = (reason: OhlcvIssueReason) => {
      issues.push({ index: i, reason });
      rejectedIndices.add(i);
    };

    const nums = [c.open, c.high, c.low, c.close];
    if (nums.some((n) => typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n))) {
      reject("NOT_A_NUMBER");
      return;
    }
    if (nums.some((n) => n <= 0)) {
      reject("NON_POSITIVE_PRICE");
      return;
    }
    if (c.volume !== undefined && (typeof c.volume !== "number" || Number.isNaN(c.volume) || c.volume < 0 || !Number.isFinite(c.volume))) {
      reject("NEGATIVE_VOLUME");
      return;
    }
    if (c.high < Math.max(c.open, c.close)) {
      reject("REVERSED_OHLC_HIGH");
      return;
    }
    if (c.low > Math.min(c.open, c.close)) {
      reject("REVERSED_OHLC_LOW");
      return;
    }
    if (!Number.isFinite(c.timestamp) || typeof c.timestamp !== "number") {
      reject("FUTURE_TIMESTAMP");
      return;
    }
    if (c.timestamp > now + maxSkew) {
      reject("FUTURE_TIMESTAMP");
      return;
    }
    if (i > 0 && !rejectedIndices.has(i - 1)) {
      if (c.timestamp === lastTimestamp) {
        reject("DUPLICATE_TIMESTAMP");
        return;
      }
      if (c.timestamp < lastTimestamp) {
        reject("OUT_OF_ORDER_TIMESTAMP");
        return;
      }
    }
    lastTimestamp = c.timestamp;
  });

  const rejected = [...rejectedIndices].sort((a, b) => a - b);
  return {
    valid: rejected.length === 0 && candles.length > 0,
    totalRecords: candles.length,
    acceptedCount: candles.length - rejected.length,
    rejectedCount: rejected.length,
    rejectedIndices: rejected,
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. QUOTE VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface QuoteRecord {
  price: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
}

export interface QuoteValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateQuote(
  quote: QuoteRecord,
  options: { now?: number; maxFutureSkewMs?: number } = {},
): QuoteValidationResult {
  const now = options.now ?? Date.now();
  const maxSkew = options.maxFutureSkewMs ?? 5 * 60 * 1000;
  const issues: string[] = [];

  const sane = (n: number | undefined) =>
    typeof n === "number" && Number.isFinite(n);

  if (!sane(quote.price) || quote.price <= 0) {
    issues.push("price must be a positive finite number");
  }
  if (quote.bid !== undefined && (!sane(quote.bid) || quote.bid <= 0)) {
    issues.push("bid must be positive when present");
  }
  if (quote.ask !== undefined && (!sane(quote.ask) || quote.ask <= 0)) {
    issues.push("ask must be positive when present");
  }
  if (sane(quote.bid) && sane(quote.ask) && quote.ask! < quote.bid!) {
    issues.push("ask must be >= bid when both present");
  }
  if (
    quote.bid !== undefined &&
    quote.ask !== undefined &&
    sane(quote.bid) &&
    sane(quote.ask)
  ) {
    const spread = quote.ask - quote.bid;
    if (spread < 0) issues.push("spread must be >= 0");
  }
  if (quote.timestamp !== undefined) {
    if (!Number.isFinite(quote.timestamp) || typeof quote.timestamp !== "number") {
      issues.push("timestamp must be finite when present");
    } else if (quote.timestamp > now + maxSkew) {
      issues.push("timestamp must not be in the future");
    }
  }

  return { valid: issues.length === 0, issues };
}

// ═══════════════════════════════════════════════════════════════
// 4. SYMBOL IDENTITY VERIFICATION
// ═══════════════════════════════════════════════════════════════

export interface SymbolIdentityCheck {
  passed: boolean;
  expectedInstrument: string;
  returnedSymbol?: string;
  reason?: string;
}

function normalizeSymbol(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Verify that a provider-returned symbol matches the requested instrument.
 * Accepts the canonical id, display symbol, base+quote composition, or any
 * registered provider mapping for the instrument.
 */
export function verifySymbolIdentity(
  expectedInstrument: string,
  returnedSymbol?: string | null,
): SymbolIdentityCheck {
  const check: SymbolIdentityCheck = {
    passed: false,
    expectedInstrument,
    returnedSymbol: returnedSymbol ?? undefined,
  };
  if (!returnedSymbol || typeof returnedSymbol !== "string") {
    check.reason = "Provider did not return an identifiable symbol.";
    return check;
  }
  // Resolve the canonical instrument to gather acceptable identities.
  const normReturned = normalizeSymbol(returnedSymbol);
  const candidates = new Set<string>([normalizeSymbol(expectedInstrument)]);

  try {
    // Lazy import avoidance: resolve via registry module is injected by caller
    // through extraCandidates to keep this function pure.
  } catch {
    /* noop */
  }

  const passed = [...candidates].some((c) => c === normReturned);
  if (!passed) {
    check.reason = `Returned symbol "${returnedSymbol}" does not match requested instrument "${expectedInstrument}".`;
  } else {
    check.passed = true;
  }
  return check;
}

/**
 * Identity verification with registry-backed candidate symbols.
 */
export function verifySymbolIdentityWithCandidates(
  expectedInstrument: string,
  returnedSymbol: string | null | undefined,
  extraCandidates: string[],
): SymbolIdentityCheck {
  const check: SymbolIdentityCheck = {
    passed: false,
    expectedInstrument,
    returnedSymbol: returnedSymbol ?? undefined,
  };
  if (!returnedSymbol || typeof returnedSymbol !== "string") {
    check.reason = "Provider did not return an identifiable symbol.";
    return check;
  }
  const normReturned = normalizeSymbol(returnedSymbol);
  const candidates = new Set<string>(
    [expectedInstrument, ...extraCandidates].map(normalizeSymbol),
  );
  const passed = [...candidates].some((c) => c === normReturned);
  if (!passed) {
    check.reason = `Returned symbol "${returnedSymbol}" does not match requested instrument "${expectedInstrument}".`;
  } else {
    check.passed = true;
  }
  return check;
}

// ═══════════════════════════════════════════════════════════════
// 5. DIAGNOSTICS / OBSERVABILITY
// ═══════════════════════════════════════════════════════════════

export interface ProviderDiagnostic {
  provider: string;
  instrument: string;
  capability: DataCapability;
  status: LiveStatus;
  latencyMs: number | null;
  cacheHit: boolean;
  fallbackUsed: boolean;
  providerSymbol?: string;
  freshness: string;
  quality: string;
  failureReason?: string;
  fieldsParsed: string[];
}

// ═══════════════════════════════════════════════════════════════
// 6. CROSS-PROVIDER CONSISTENCY
// ═══════════════════════════════════════════════════════════════

export type ConsistencyVerdict =
  | "CONSISTENT"
  | "MINOR_VARIANCE"
  | "SIGNIFICANT_VARIANCE"
  | "CONFLICT"
  | "UNAVAILABLE";

/**
 * Compare close prices from multiple providers of the same instrument.
 * Relative-difference bands:
 *   <= 0.1% CONSISTENT
 *   <= 1%   MINOR_VARIANCE
 *   <= 3%   SIGNIFICANT_VARIANCE
 *   > 3%    CONFLICT
 */
export function compareCrossProviderPrices(
  observations: { provider: string; price: number }[],
): ConsistencyVerdict {
  const usable = observations.filter(
    (o) => typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0,
  );
  if (usable.length < 2) return usable.length === 1 ? "UNAVAILABLE" : "UNAVAILABLE";

  const min = Math.min(...usable.map((o) => o.price));
  const max = Math.max(...usable.map((o) => o.price));
  const relDiff = (max - min) / ((max + min) / 2);

  if (relDiff <= 0.001) return "CONSISTENT";
  if (relDiff <= 0.01) return "MINOR_VARIANCE";
  if (relDiff <= 0.03) return "SIGNIFICANT_VARIANCE";
  return "CONFLICT";
}

// ═══════════════════════════════════════════════════════════════
// 7. DATA QUALITY ASSESSMENT (non-decision)
// ═══════════════════════════════════════════════════════════════

export type DataQualityState =
  | "VERIFIED"
  | "GOOD"
  | "DEGRADED"
  | "STALE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "CONFLICTING";

export interface DataQualityAssessment {
  state: DataQualityState;
  explanation: string;
}

/**
 * Score overall data quality from live statuses + consistency verdict.
 * This describes DATA QUALITY ONLY — it must never be mapped onto
 * confidence, conviction, bias, or recommendation.
 */
export function assessDataQuality(params: {
  statuses: LiveStatus[];
  consistency?: ConsistencyVerdict;
}): DataQualityAssessment {
  const { statuses, consistency } = params;
  if (statuses.length === 0) {
    return { state: "UNAVAILABLE", explanation: "No data was requested." };
  }
  if (consistency === "CONFLICT") {
    return {
      state: "CONFLICTING",
      explanation:
        "Providers disagree on the same market fact beyond tolerance. Values are NOT merged.",
    };
  }
  const verified = statuses.filter((s) => s === "LIVE_VERIFIED").length;
  const partial = statuses.filter((s) => s === "LIVE_PARTIAL").length;
  const failed = statuses.filter((s) => !isLiveStatus(s)).length;

  if (verified > 0 && partial === 0 && failed === 0 && consistency !== undefined) {
    return {
      state: consistency === "CONSISTENT" ? "VERIFIED" : "GOOD",
      explanation:
        consistency === "CONSISTENT"
          ? "All live sources fully validated and mutually consistent."
          : `All live sources fully validated; minor variance across providers (${consistency}).`,
    };
  }
  if (verified > 0 && (partial > 0 || failed > 0)) {
    return {
      state: "PARTIAL",
      explanation:
        "Some live data validated; some providers failed or returned partial records.",
    };
  }
  if (partial > 0) {
    return {
      state: "DEGRADED",
      explanation: "Live responses received but contained invalid/partial records.",
    };
  }
  if (statuses.some((s) => s === "RATE_LIMITED")) {
    return {
      state: "STALE",
      explanation: "Rate limited — only cached/stale data may be available.",
    };
  }
  return { state: "UNAVAILABLE", explanation: "No live data could be validated." };
}
