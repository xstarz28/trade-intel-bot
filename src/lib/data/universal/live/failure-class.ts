/**
 * Safe, user-facing live-acquisition failure classes.
 *
 * These name WHY an acquisition did not produce verified live data.
 * They never carry credentials, raw provider payloads, or env var names.
 *
 * Distinct classes must stay distinct: a quota rejection is not "symbol
 * unsupported", and a missing price is not a network failure.
 */

export type LiveAcquisitionFailureClass =
  | "PROVIDER_AUTH"
  | "RATE_LIMIT"
  | "SYMBOL_UNSUPPORTED"
  | "NO_LIVE_DATA"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEFRAME_UNAVAILABLE";

const ALL: readonly LiveAcquisitionFailureClass[] = [
  "PROVIDER_AUTH",
  "RATE_LIMIT",
  "SYMBOL_UNSUPPORTED",
  "NO_LIVE_DATA",
  "MALFORMED_RESPONSE",
  "NETWORK_ERROR",
  "TIMEFRAME_UNAVAILABLE",
];

export function isLiveAcquisitionFailureClass(
  value: string,
): value is LiveAcquisitionFailureClass {
  return (ALL as readonly string[]).includes(value);
}

/**
 * Strip credentials and env names from a reason before it crosses to the UI.
 * Never reconstruct a secret; only redact obvious patterns.
 */
export function sanitizeFailureReason(reason: string): string {
  return reason
    .replace(/apikey=[^&\s"'`]+/gi, "apikey=redacted")
    .replace(/api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/gi, "credential=redacted")
    .replace(/TWELVE_DATA_API_KEY/g, "provider credential")
    .replace(/ALPHA_VANTAGE_API_KEY/g, "provider credential")
    .replace(/process\.env\.[A-Z0-9_]+/g, "provider credential");
}

export function formatLiveFailure(
  failureClass: LiveAcquisitionFailureClass,
  reason: string,
): string {
  const clean = sanitizeFailureReason(reason).trim();
  return clean ? `${failureClass}: ${clean}` : failureClass;
}

/**
 * Map HTTP status, vendor body codes, live-status labels, and thrown
 * messages onto one failure class. Prefer the most specific class.
 */
export function classifyLiveFailure(input: {
  httpStatus?: number;
  vendorCode?: number | string;
  liveStatus?: string;
  message?: string;
}): LiveAcquisitionFailureClass {
  const status = input.httpStatus;
  const codeNum =
    typeof input.vendorCode === "number"
      ? input.vendorCode
      : typeof input.vendorCode === "string" && /^\d+$/.test(input.vendorCode)
        ? Number(input.vendorCode)
        : NaN;
  const msg = (input.message ?? "").toLowerCase();
  const live = input.liveStatus ?? "";

  if (
    status === 401 ||
    status === 403 ||
    codeNum === 401 ||
    codeNum === 403 ||
    live === "CREDENTIAL_MISSING" ||
    msg.includes("auth_error") ||
    msg.startsWith("[401]") ||
    msg.startsWith("[403]")
  ) {
    return "PROVIDER_AUTH";
  }

  if (
    status === 429 ||
    codeNum === 429 ||
    live === "RATE_LIMITED" ||
    msg.includes("rate_limit") ||
    msg.startsWith("[429]")
  ) {
    return "RATE_LIMIT";
  }

  if (
    live === "NETWORK_UNAVAILABLE" ||
    msg.includes("network failure") ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("aborted") ||
    msg.includes("timeout") ||
    msg.includes("aborterror")
  ) {
    return "NETWORK_ERROR";
  }

  if (
    live === "MALFORMED_RESPONSE" ||
    msg.includes("malformed") ||
    msg.includes("no numerically valid") ||
    msg.includes("failed to extract") ||
    msg.includes("unparsable")
  ) {
    return "MALFORMED_RESPONSE";
  }

  if (
    msg.includes("interval") ||
    msg.includes("timeframe") ||
    msg.includes("unsupported bar")
  ) {
    return "TIMEFRAME_UNAVAILABLE";
  }

  if (
    status === 404 ||
    codeNum === 404 ||
    live === "UNSUPPORTED" ||
    msg.includes("symbol") && (msg.includes("not") || msg.includes("invalid") || msg.includes("unknown")) ||
    msg.includes("not registered") ||
    msg.includes("not present in provider discovery") ||
    msg.includes("symbol_unsupported")
  ) {
    return "SYMBOL_UNSUPPORTED";
  }

  if (
    live === "UNAVAILABLE" ||
    msg.includes("no candle") ||
    msg.includes("no usable") ||
    msg.includes("zero usable") ||
    msg.includes("no live")
  ) {
    return "NO_LIVE_DATA";
  }

  return "NO_LIVE_DATA";
}
