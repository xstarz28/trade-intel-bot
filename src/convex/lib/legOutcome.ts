/**
 * Phase 229 — shared per-leg failure taxonomy for multi-leg provider actions.
 *
 * Extracted from the Phase 228 CoinGlass fix so Alpha Vantage and TickAtlas
 * classify identically. Each provider keeps its OWN envelope contract; this
 * module only decides which class a thrown error belongs to.
 *
 *  - FATAL classes (`RATE_LIMIT`, `AUTH_ERROR`) are signalled by the error
 *    message prefix the providers already use. They must propagate out of the
 *    ProviderCache fetcher so nothing is cached (Phase 178b).
 *  - Every other failure is NON-FATAL and is reported per leg with a class +
 *    reason so a transport/provider failure is never read as "the market has
 *    no such data".
 */
import { asString, errorMessage, isRecord } from "./json";

export type LegFailureKind =
  | "unavailable" // provider answered, but sent no usable reading
  | "malformed" // provider answered with a body we cannot parse
  | "timeout" // HTTP deadline hit
  | "network" // DNS / TLS / connection failure
  | "provider_error"; // non-2xx HTTP or vendor-native error (not 429/401/403)

export type LegOutcome<T> =
  | { status: "ok"; value: T }
  | { status: LegFailureKind; reason: string };

const FATAL_PREFIXES = ["RATE_LIMIT", "AUTH_ERROR"] as const;
export function isFatalLegError(err: unknown): boolean {
  const msg = errorMessage(err);
  return FATAL_PREFIXES.some((p) => msg.startsWith(p));
}

/** Non-2xx HTTP that is not a quota/credential rejection. */
export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(provider: string, status: number, statusText: string) {
    super(`${provider} HTTP ${status}: ${statusText}`);
    this.status = status;
  }
}
/** Vendor-native error envelope (HTTP 200 with an error code/message). */
export class ProviderNativeError extends Error {}
/** Body that is not JSON / not the documented container. */
export class ProviderMalformedError extends Error {}

/** Classify a NON-fatal leg error. Fatal ones must be rethrown before this. */
export function classifyLegError(err: unknown): { status: LegFailureKind; reason: string } {
  const reason = errorMessage(err) || "unknown error";
  if (err instanceof ProviderHttpError || err instanceof ProviderNativeError) return { status: "provider_error", reason };
  if (err instanceof ProviderMalformedError) return { status: "malformed", reason };
  const name = isRecord(err) ? asString(err.name) : undefined;
  if (name === "TimeoutError" || name === "AbortError") return { status: "timeout", reason };
  if (err instanceof SyntaxError) return { status: "malformed", reason };
  // undici surfaces connection failures as TypeError("fetch failed").
  if (err instanceof TypeError) return { status: "network", reason };
  return { status: "provider_error", reason };
}

/**
 * Run one leg: fatal errors propagate (rejecting the promise), every other
 * failure becomes a classified outcome; a parser returning undefined is the
 * "provider answered, nothing usable" class.
 */
export async function runLeg<T>(parse: () => Promise<T | undefined>): Promise<LegOutcome<T>> {
  try {
    const value = await parse();
    return value === undefined
      ? { status: "unavailable", reason: "no usable reading in provider response" }
      : { status: "ok", value };
  } catch (err: unknown) {
    if (isFatalLegError(err)) throw err;
    return classifyLegError(err);
  }
}

/** True when the leg failed for a transport/provider reason (not merely empty). */
export function isLegFailure(l: LegOutcome<unknown>): boolean {
  return l.status !== "ok" && l.status !== "unavailable";
}

/** "openInterest: timeout (…); fundingRate: provider_error (…)" — or "" when none. */
export function summarizeLegFailures(legs: Record<string, LegOutcome<unknown>>): string {
  return Object.entries(legs)
    .filter(([, l]) => isLegFailure(l))
    .map(([name, l]) => `${name}: ${l.status}${"reason" in l && l.reason ? ` (${l.reason})` : ""}`)
    .join("; ");
}
