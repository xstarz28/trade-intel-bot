/**
 * Phase 178d — fan-out acquisition diagnostics.
 *
 * Phase 177 answers "why did a leg fail". Phase 178c answers "how was this
 * value obtained". This module joins the two into ONE structured,
 * credential-free summary of a single protected analysis, so an operator can
 * look at one run and tell, per provider, whether the evidence was freshly
 * observed, shared from a concurrent call, reused from cache, deliberately
 * uncached, skipped, or unavailable.
 *
 * Two rules govern everything here:
 *
 *  1. **Modes are reported, never inferred.** The acquisition mode comes from
 *     the cache's own `acquisition` field or from the provider outcome. It is
 *     never guessed from latency — a fast leg is not evidence of a cache hit.
 *
 *  2. **No mode may falsely imply a new observation.** `cache-reused` is
 *     always rendered as a reuse with its true age, and a leg that produced
 *     no data never carries an observation timestamp at all.
 */

import {
  type AcquisitionMode,
  type AcquisitionProvenance,
  describeProvenance,
  providerContacted,
  quotaChargeAttributableToCaller,
  recordProvenance,
  sharedWithConcurrentCallers,
} from "./acquisition-provenance";
import type { ProviderOutcome } from "./provider-resilience";

/**
 * One provider leg, as an operator sees it.
 *
 * `acquired`, `attached` and `usedByEngine` are deliberately separate: a
 * provider can return data that the engine never consumes for a given asset
 * class or trading style, and reporting that as "used" would overstate the
 * evidence behind a decision.
 */
export interface LegDiagnostic {
  provider: string;
  dataset: string;
  /** Provider-native instrument identity, verbatim. Omitted when global. */
  instrument?: string;
  mode: AcquisitionMode;
  /** Provider observation time. Absent when nothing was observed. */
  observedAt?: number;
  usedAt: number;
  evidenceAgeMs?: number;
  /** The provider was contacted (directly or via a shared in-flight call). */
  providerContacted: boolean;
  /** THIS caller caused a provider request. Single-flight joins are false. */
  quotaChargeAttributableToCaller: boolean;
  sharedWithConcurrentCallers: boolean;
  /** Data came back at all. */
  acquired: boolean;
  /** Data was attached to the engine input. */
  attached: boolean;
  /** The engine actually consumed it for this asset class / style. */
  usedByEngine: boolean;
  /**
   * Phase 288 — WHY a leg produced no evidence, verbatim from the leg's own
   * classified outcome (provider class included: `[429] …`, `timeout (…)`,
   * `no candle data returned`, a provider message, …), passed through
   * {@link redactDiagnosticText} and length-bounded.
   *
   * A leg that answered never carries this field, and it is never composed
   * here: the text is the failing leg's own report. Before this phase the
   * reasons were computed by each leg and then dropped on the floor, so every
   * surface could only say "unavailable" without saying why.
   */
  reason?: string;
}

/** Longest reason fragment kept in diagnostics; longer text is truncated. */
export const LEG_REASON_MAX_CHARS = 400;

export interface FanOutProvenance {
  legs: LegDiagnostic[];
  /** Provider requests THIS analysis caused. Single-flight joins excluded. */
  providerRequestsCaused: number;
  /** Legs served without contacting any provider. */
  cacheReuseCount: number;
  /** Legs that joined another caller's in-flight request. */
  sharedCount: number;
  /** Legs deliberately never cached. */
  uncachedByDesignCount: number;
  /** Legs that produced no evidence. */
  unavailableCount: number;
}

/** Matches anything credential-shaped so it can never reach diagnostics. */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // Phase 288 — key/value forms FIRST: the value is what must disappear.
  // Masking only the key NAME (`apikey=VALUE` → `[redacted]=VALUE`) left the
  // secret in the text, which stayed invisible while these strings were only
  // console lines and became reachable as soon as they travel with a result.
  /(?:(?:(?:api|access|auth)[-_\s]*key|[?&]key|token|secret|password|passwd|credential)s?\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
  /(bearer\s+)\S+/gi,
  /api[-_]?key/i,
  /apikey=/i,
  /bearer\s+\S+/i,
  /authorization/i,
  /token=/i,
  /secret/i,
  /password/i,
  /sk-[A-Za-z0-9]{8,}/,
];

/**
 * Strip anything credential-shaped from a free-text fragment.
 *
 * Provider errors and URLs can embed keys, so no raw provider string is ever
 * copied into diagnostics without passing through here.
 */
export function redactDiagnosticText(text: string): string {
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), "[redacted]");
  }
  return out;
}

/** True when a string looks like it carries a credential. */
export function looksLikeCredential(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((p) => p.test(text));
}

/**
 * Map a Phase 177 provider outcome to an acquisition mode.
 *
 * Only used for legs that did NOT produce data, or that bypass the cache.
 * A successful cached leg reports its own mode instead — see `legFromCache`.
 */
export function modeFromOutcome(
  outcome: Pick<ProviderOutcome, "status" | "category">,
): AcquisitionMode {
  if (outcome.status === "skipped") return "skipped";
  if (outcome.status === "success") return "observed-now";
  switch (outcome.category) {
    case "timeout":
    case "deadline-exceeded":
      return "timed-out";
    case "rate-limit":
      return "rate-limited";
    case "skipped":
      return "skipped";
    default:
      return "unavailable";
  }
}

/**
 * Build a leg diagnostic from a cache result.
 *
 * `acquisition` must come from `CachedEvidence.acquisition` — the cache's own
 * report — so a single-flight join is never mislabelled as a cache hit.
 */
export function legFromCache(input: {
  provider: string;
  dataset: string;
  instrument?: string;
  acquisition: "observed-now" | "observed-shared" | "cache-reused";
  observedAt: number;
  usedAt?: number;
  attached?: boolean;
  usedByEngine?: boolean;
}): LegDiagnostic {
  return buildLeg({
    provider: input.provider,
    dataset: input.dataset,
    instrument: input.instrument,
    mode: input.acquisition,
    observedAt: input.observedAt,
    usedAt: input.usedAt,
    acquired: true,
    attached: input.attached ?? true,
    usedByEngine: input.usedByEngine ?? false,
  });
}

/** Build a leg diagnostic for a provider that is never cached. */
export function legUncachedByDesign(input: {
  provider: string;
  dataset: string;
  instrument?: string;
  /**
   * The provider's own observation time when it exposes one (e.g. the OKX
   * exchange timestamp). Falls back to acquisition time — never to
   * request-start, which would understate the age.
   */
  observedAt: number;
  usedAt?: number;
  attached?: boolean;
  usedByEngine?: boolean;
}): LegDiagnostic {
  return buildLeg({
    ...input,
    mode: "uncached-by-design",
    acquired: true,
    attached: input.attached ?? true,
    usedByEngine: input.usedByEngine ?? false,
  });
}

/** Build a leg diagnostic for a leg that produced no evidence. */
export function legFromFailure(input: {
  provider: string;
  dataset: string;
  instrument?: string;
  outcome: Pick<ProviderOutcome, "status" | "category">;
  usedAt?: number;
  /**
   * Phase 288 — the failing leg's own reason text. Recorded verbatim (after
   * credential redaction and bounding) so an unavailable leg keeps its
   * diagnosis instead of collapsing to a bare "unavailable".
   */
  reason?: string;
}): LegDiagnostic {
  return buildLeg({
    provider: input.provider,
    dataset: input.dataset,
    instrument: input.instrument,
    mode: modeFromOutcome(input.outcome),
    // No observation happened, so no timestamp is recorded. Back-filling one
    // would fabricate evidence.
    observedAt: undefined,
    usedAt: input.usedAt,
    acquired: false,
    attached: false,
    usedByEngine: false,
    reason: input.reason,
  });
}

/**
 * Prepare a leg's own reason text for diagnostics: credential-redacted,
 * whitespace-collapsed and length-bounded. Returns `undefined` for blank
 * input so an empty string never becomes a claim of explanation.
 */
export function boundedLegReason(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const collapsed = redactDiagnosticText(raw).replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.length > LEG_REASON_MAX_CHARS
    ? `${collapsed.slice(0, LEG_REASON_MAX_CHARS - 1)}\u2026`
    : collapsed;
}

function buildLeg(input: {
  provider: string;
  dataset: string;
  instrument?: string;
  mode: AcquisitionMode;
  observedAt?: number;
  usedAt?: number;
  acquired: boolean;
  attached: boolean;
  usedByEngine: boolean;
  reason?: string;
}): LegDiagnostic {
  const p: AcquisitionProvenance = recordProvenance({
    provider: input.provider,
    dataset: input.dataset,
    mode: input.mode,
    observedAt: input.observedAt,
    usedAt: input.usedAt,
  });
  const reason = input.acquired ? undefined : boundedLegReason(input.reason);

  return {
    provider: p.provider,
    dataset: p.dataset,
    ...(input.instrument !== undefined ? { instrument: input.instrument } : {}),
    mode: p.mode,
    ...(p.observedAt !== undefined ? { observedAt: p.observedAt } : {}),
    usedAt: p.usedAt,
    ...(p.evidenceAgeMs !== undefined ? { evidenceAgeMs: p.evidenceAgeMs } : {}),
    providerContacted: providerContacted(p),
    quotaChargeAttributableToCaller: quotaChargeAttributableToCaller(p),
    sharedWithConcurrentCallers: sharedWithConcurrentCallers(p),
    acquired: input.acquired,
    // A leg cannot be attached or used unless it produced data.
    attached: input.acquired && input.attached,
    usedByEngine: input.acquired && input.attached && input.usedByEngine,
    // Only an unanswered leg has a reason to carry: a leg that produced data
    // is described by its data, and a stray reason string would blur that.
    ...(reason !== undefined ? { reason } : {}),
  };
}

/** Aggregate the legs of one analysis. */
export function summarizeProvenance(legs: LegDiagnostic[]): FanOutProvenance {
  return {
    legs,
    providerRequestsCaused: legs.filter(
      (l) => l.quotaChargeAttributableToCaller,
    ).length,
    cacheReuseCount: legs.filter((l) => l.mode === "cache-reused").length,
    sharedCount: legs.filter((l) => l.mode === "observed-shared").length,
    uncachedByDesignCount: legs.filter((l) => l.mode === "uncached-by-design")
      .length,
    unavailableCount: legs.filter((l) => !l.acquired).length,
  };
}

/**
 * Render one leg as a single credential-free line.
 *
 * Values are derived from the runtime; nothing here is hardcoded.
 */
export function formatLeg(leg: LegDiagnostic): string {
  const parts: string[] = [];
  if (leg.evidenceAgeMs !== undefined) parts.push(`age ${formatAge(leg.evidenceAgeMs)}`);
  if (leg.acquired) parts.push(leg.usedByEngine ? "used" : leg.attached ? "attached" : "acquired");
  const detail = parts.length > 0 ? `(${parts.join(", ")})` : "";
  const id = leg.instrument ? ` [${leg.instrument}]` : "";
  // Phase 288 — an unavailable leg's own reason is part of the line. It is
  // already redacted and bounded at construction; the final redaction stays
  // as defence in depth for the provider/dataset/instrument fields.
  const why = leg.reason !== undefined ? ` — ${leg.reason}` : "";
  return redactDiagnosticText(
    `${leg.provider}/${leg.dataset}${id} = ${leg.mode}${detail}${why}`,
  );
}

/** Render the whole fan-out. One line per leg, plus a totals line. */
export function formatProvenance(summary: FanOutProvenance): string[] {
  const lines = summary.legs.map(formatLeg);
  lines.push(
    `totals: ${summary.providerRequestsCaused} provider request(s) caused, ` +
      `${summary.cacheReuseCount} reused from cache, ` +
      `${summary.sharedCount} shared, ` +
      `${summary.uncachedByDesignCount} uncached-by-design, ` +
      `${summary.unavailableCount} unavailable`,
  );
  return lines;
}

/** Human-readable age, chosen per magnitude rather than a fixed unit. */
function formatAge(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/** Re-exported so callers describe provenance consistently. */
export { describeProvenance };


/**
 * Combine the acquisition modes of several cache reads made by one action.
 *
 * An action such as `fetchMarketData` performs multiple cache reads (setup
 * candles, HTF context, comparator series). Reporting one mode for the whole
 * action requires a rule, and the rule must fail safe:
 *
 *   - `cache-reused` ONLY when every read was reused — otherwise the action
 *     really did contact the provider and must not claim otherwise.
 *   - `observed-now` when any read caused a request (the strongest claim of
 *     provider contact, and the one that keeps quota attribution honest).
 *   - `observed-shared` when reads were shared but none was caused here.
 *
 * The bias is deliberate: over-reporting provider contact understates the
 * cache's benefit, while under-reporting it would fabricate freshness.
 *
 * ─────────────────────────────────────────────────────────────────
 * EMPTY INPUT (Phase 178d integrity fix)
 *
 * An empty list means NO cache read completed, which is no evidence that any
 * provider was contacted. Returning `observed-now` for it — as this function
 * originally did — fabricated provider contact and violated the core Phase
 * 178d invariant that modes are reported, never inferred.
 *
 * This is NOT a defensive branch: it is reachable in production. When the
 * Alpha Vantage news transport dies, the handler swallows the error (news is
 * non-critical), no cache read completes, and the action still returns
 * `success: true`. Measured before the fix: `acquisition: "observed-now"`
 * with `observedAt: undefined` — a claimed fresh observation backed by
 * nothing.
 *
 * So an empty composite IS a legitimate runtime state and must not throw.
 * It resolves to `unavailable`, which already exists in `AcquisitionMode` as
 * the "provider returned no usable data" state — no invented mode, and the
 * return type widens only to a member the type model already defines.
 * `unavailable` is excluded from NEW_OBSERVATION and from every quota
 * predicate, so a degraded leg can no longer imply provider contact.
 * ─────────────────────────────────────────────────────────────────
 */
export function combineAcquisitions(
  modes: Array<"observed-now" | "observed-shared" | "cache-reused">,
): "observed-now" | "observed-shared" | "cache-reused" | "unavailable" {
  // No completed cache read: nothing was observed, shared, or reused.
  if (modes.length === 0) return "unavailable";
  if (modes.some((m) => m === "observed-now")) return "observed-now";
  if (modes.some((m) => m === "observed-shared")) return "observed-shared";
  return "cache-reused";
}

/**
 * Phase 178d integrity fix — the mode an ACTION ENVELOPE should carry.
 *
 * Envelopes (`IntelligenceResult`, `MarketDataResult`, ...) describe a
 * successful provider result, so they can only carry the three acquisition
 * modes. When no cache read completed there is no such mode: `undefined` is
 * returned so the envelope makes NO claim, rather than asserting contact that
 * did not happen. The fan-out treats an absent mode as unreported.
 */
export function envelopeAcquisition(
  modes: Array<"observed-now" | "observed-shared" | "cache-reused">,
): "observed-now" | "observed-shared" | "cache-reused" | undefined {
  const combined = combineAcquisitions(modes);
  return combined === "unavailable" ? undefined : combined;
}

/**
 * The OLDEST observation among several reads.
 *
 * Evidence age for a composite result is governed by its stalest component,
 * never by its freshest — otherwise one new read would mask old data.
 */
export function oldestObservation(times: number[]): number | undefined {
  const valid = times.filter((t) => Number.isFinite(t));
  return valid.length > 0 ? Math.min(...valid) : undefined;
}
