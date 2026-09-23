/**
 * Phase 177 — provider fan-out resilience (pure, transport-agnostic).
 *
 * Phase 176 moved nine provider acquisitions onto the server, in front of the
 * decision engine. That closed the provenance hole but created a liveness one:
 * NONE of those provider actions set a fetch deadline, and a Convex action may
 * run for up to 30 minutes (Convex runtime). A single hung provider socket
 * could therefore stall a user's analysis effectively forever.
 *
 * This module adds bounded waiting WITHOUT changing what provider evidence
 * MEANS. It never invents data. Its only outputs are:
 *   - the provider's own successful payload, unchanged; or
 *   - an explicit non-success OUTCOME describing why nothing arrived.
 *
 * Design rules that fall out of the product invariants:
 *
 *  - A timeout is not evidence. It is never `available: true`, never
 *    `quality: VERIFIED`, never a zero/empty dataset the engine could mistake
 *    for a real reading. `data` is left strictly `undefined`.
 *  - A timeout for provider A must not touch provider B's result, freshness or
 *    provenance. Legs are isolated.
 *  - Results that already arrived are kept when the overall deadline fires.
 *    Losing good evidence would be a second failure, not a safety measure.
 *  - Provider identity is recorded verbatim. A response is never attributed to
 *    a different provider.
 *  - No fallback, no default, no substitution, no retry beyond an explicitly
 *    configured bound.
 */

// ═══════════════════════════════════════════════════════════════
// OUTCOME MODEL
// ═══════════════════════════════════════════════════════════════

/**
 * Why a provider leg produced no usable evidence.
 *
 * These are structurally distinct from "the provider returned an empty but
 * valid dataset", which stays a SUCCESS carrying the provider's own payload.
 */
export type ProviderFailureCategory =
  | "timeout"
  | "network"
  | "rate-limit"
  | "invalid-response"
  | "unavailable"
  | "deadline-exceeded"
  | "skipped";

export type ProviderOutcomeStatus = "success" | "failed" | "skipped";

/** One provider leg's observed result. Always recorded, success or not. */
export interface ProviderOutcome<T = unknown> {
  /** Provider identity, verbatim. Never rewritten to another provider. */
  provider: string;
  status: ProviderOutcomeStatus;
  /** Present ONLY on success. A failure never carries synthesized data. */
  data?: T;
  /**
   * Failure class. On `failed`/`skipped` this is why nothing arrived.
   * On `success` it is present only for a Phase 229 partial: surviving
   * `data` is real, but the envelope `error` named a classified sub-leg
   * failure (`leg: class (reason)`). Absent on a complete success.
   */
  category?: ProviderFailureCategory;
  /** Human-readable, credential-free. */
  reason?: string;
  /** Epoch ms when the leg started. */
  startedAt: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** The deadline this leg was given, in ms. */
  budgetMs?: number;
  /** True when the leg was cut off by its own budget. */
  timedOut: boolean;
  /** True when the provider explicitly reported a rate limit. */
  rateLimited: boolean;
  /** How many attempts were made (1 = no retry). */
  attempts: number;
  /**
   * Phase 178d — how a SUCCESSFUL leg's data was obtained, as reported by the
   * cache rather than inferred from timing. Absent on failures and on legs
   * that do not pass through the provider cache.
   */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
  /**
   * Phase 178d — the provider's own observation time, when the leg can supply
   * one. A cache hit carries the ORIGINAL observation, never the read time.
   */
  observedAt?: number;
  /**
   * Whether the engine actually consumed this evidence. Set by the caller
   * after attachment, so diagnostics distinguish "acquired" from "used".
   */
  usedByEngine?: boolean;
}

/** Aggregate view of one fan-out. */
export interface FanOutDiagnostics {
  startedAt: number;
  durationMs: number;
  /** The overall budget applied to the wave. */
  budgetMs: number;
  /** True when the overall deadline cut the wave short. */
  deadlineExceeded: boolean;
  outcomes: ProviderOutcome[];
}

// ═══════════════════════════════════════════════════════════════
// BUDGETS
// ═══════════════════════════════════════════════════════════════

/**
 * Per-provider deadlines, in milliseconds.
 *
 * These are NOT arbitrary. Each is derived from the observed shape of the
 * provider action as implemented in `src/convex/`:
 *
 *  - `market-data` (12s) — the slowest leg by construction. It issues a
 *    multi-timeframe `Promise.allSettled` batch AND, for correlation, a
 *    BOUNDED SEQUENTIAL probe over `DXY_CANDIDATE_SYMBOLS` followed by a
 *    comparison-candle fetch. Sequential sub-fetches justify the widest
 *    budget; it is also the only leg whose absence forces NO_TRADE.
 *  - `treasury` (10s) — four independent `fetchFeed` legs in one
 *    `Promise.all` against a slow government host.
 *  - `eia` (10s) — three product legs in one `Promise.all`, government host.
 *  - `alpha-vantage` (8s) — parallel sub-requests, but a documented ~5 req/min
 *    budget means a queued request can sit before responding.
 *  - `tickatlas` (8s) — calendar assembly across the relevant currencies.
 *  - `coinglass` (8s) — parallel derivative datasets.
 *  - `cftc` (8s) — single Socrata query, historically slow to first byte.
 *  - `okx-*` (6s) — single low-latency exchange endpoint each.
 *  - `fx-rate` (6s) — one quote lookup.
 *
 * The ceiling is deliberately set by the SLOWEST leg (12s) rather than by the
 * sum of all legs, because the wave is parallel — see `runFanOut`.
 */
export const PROVIDER_BUDGET_MS: Record<string, number> = {
  "market-data": 12_000,
  treasury: 10_000,
  eia: 10_000,
  "alpha-vantage": 8_000,
  tickatlas: 8_000,
  coinglass: 8_000,
  cftc: 8_000,
  "okx-order-book": 6_000,
  "okx-instrument-spec": 6_000,
  "fx-rate": 6_000,
};

/** Applied to any provider without an explicit entry. Conservative. */
export const DEFAULT_PROVIDER_BUDGET_MS = 8_000;

/**
 * Overall fan-out deadline.
 *
 * Rationale: the wave is genuinely parallel, so the expected bound is the
 * SLOWEST leg (12s), not the sum (~82s). The overall budget is set to 15s —
 * the slowest leg plus ~3s of headroom for Convex action dispatch across ten
 * `ctx.runAction` boundaries.
 *
 * It is a backstop, not the primary mechanism: per-leg budgets should always
 * fire first. If this deadline is ever the thing that trips, a per-leg budget
 * is mis-sized, and the diagnostics will show which leg was still pending.
 */
export const FANOUT_BUDGET_MS = 15_000;

export function budgetFor(provider: string): number {
  return PROVIDER_BUDGET_MS[provider] ?? DEFAULT_PROVIDER_BUDGET_MS;
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /too many requests/i,
  /quota exceeded/i,
];

/**
 * Envelope-path timeout text. Named `TimeoutError` / `AbortError` already
 * classify as timeout on the thrown path; Convex re-wraps those into a
 * `{success:false, error}` string, so the class can only survive as text.
 *
 * Deliberately NOT `/timed.?out/i` or a bare `/timeout/i`: those would steal
 * socket `ETIMEDOUT` from the network class. Word-boundary `timeout` and
 * spaced `timed out` match Phase 229/230 envelope text
 * (`leg: timeout (The operation timed out)`) without touching ETIMEDOUT.
 */
const TIMEOUT_PATTERNS = [
  /\btimeout\b/i,
  /timed out/i,
  /deadline[- ](?:exceeded|elapsed)/i,
];

const NETWORK_PATTERNS = [
  /econnrefused/i,
  /econnreset/i,
  /enotfound/i,
  /etimedout/i,
  /socket hang up/i,
  /network/i,
  /fetch failed/i,
  /disconnected/i,
];

/**
 * Classify a provider failure from its own error/envelope text.
 *
 * Deliberately conservative: anything unrecognised is `unavailable`, never
 * something more specific and never something the engine could read as a
 * directional signal.
 */
export function classifyFailure(raw: unknown): {
  category: ProviderFailureCategory;
  rateLimited: boolean;
} {
  const text =
    raw instanceof Error
      ? `${raw.name}: ${raw.message}`
      : typeof raw === "string"
        ? raw
        : "";

  if (raw instanceof Error && raw.name === "TimeoutError") {
    return { category: "timeout", rateLimited: false };
  }
  if (raw instanceof Error && raw.name === "AbortError") {
    return { category: "timeout", rateLimited: false };
  }
  if (RATE_LIMIT_PATTERNS.some((re) => re.test(text))) {
    return { category: "rate-limit", rateLimited: true };
  }
  if (TIMEOUT_PATTERNS.some((re) => re.test(text))) {
    return { category: "timeout", rateLimited: false };
  }
  if (NETWORK_PATTERNS.some((re) => re.test(text))) {
    return { category: "network", rateLimited: false };
  }
  if (/malformed|invalid|non-array|unexpected token/i.test(text)) {
    return { category: "invalid-response", rateLimited: false };
  }
  return { category: "unavailable", rateLimited: false };
}

/** Strip anything credential-shaped out of a diagnostic string. */
export function redactDiagnostic(text: string): string {
  return text
    .replace(/([?&](?:apikey|api_key|token|key|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED]");
}

// ═══════════════════════════════════════════════════════════════
// LEG EXECUTION
// ═══════════════════════════════════════════════════════════════

export interface LegOptions<T> {
  provider: string;
  /**
   * The work. Receives an AbortSignal so a cooperating transport can cancel
   * the real request rather than leaving it running behind a lost race.
   */
  run: (signal: AbortSignal) => Promise<
    | {
        success: boolean;
        data?: T;
        error?: string;
        /**
         * Phase 178d — acquisition provenance, passed straight through to the
         * outcome. Supplied by providers that route through the cache; absent
         * otherwise, and never synthesized here.
         */
        acquisition?: "observed-now" | "observed-shared" | "cache-reused";
        observedAt?: number;
      }
    | null
    | undefined
  >;
  budgetMs?: number;
  /**
   * Bounded retries. Defaults to 0 (no retry). A rate-limited response is
   * NEVER retried inside one analysis regardless of this setting.
   */
  maxRetries?: number;
  now?: () => number;
}

/**
 * Run one provider leg under its own deadline.
 *
 * The returned promise never rejects: a leg failure is data, not an exception,
 * so one bad provider cannot reject the whole wave.
 */
export async function runProviderLeg<T>(
  opts: LegOptions<T>,
): Promise<ProviderOutcome<T>> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? budgetFor(opts.provider);
  const maxRetries = Math.max(0, opts.maxRetries ?? 0);
  const startedAt = now();

  let attempts = 0;
  let last: { category: ProviderFailureCategory; rateLimited: boolean; reason: string } = {
    category: "unavailable",
    rateLimited: false,
    reason: "provider returned no result",
  };

  while (attempts <= maxRetries) {
    attempts++;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = now() - startedAt;
    const remaining = budgetMs - elapsed;

    if (remaining <= 0) {
      last = {
        category: "timeout",
        rateLimited: false,
        reason: `budget of ${budgetMs}ms exhausted`,
      };
      break;
    }

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Abort the real work, then reject. Aborting FIRST is what makes
          // this a genuine cancellation rather than an abandoned race.
          controller.abort();
          const err = new Error(`provider "${opts.provider}" exceeded ${budgetMs}ms`);
          err.name = "TimeoutError";
          reject(err);
        }, remaining);
      });

      const result = await Promise.race([opts.run(controller.signal), timeout]);

      if (result && result.success) {
        // Phase 229 §K.4 — a `success:true` envelope may still carry
        // `leg: class (reason)` metadata for a failed sub-leg. That is a
        // PARTIAL, not a complete success. Status stays `success` and
        // surviving `data` is kept (partial remains usable); classify the
        // error so the fan-out can name the class instead of looking
        // identical to a complete payload. Budget `timedOut` stays false:
        // a sub-leg timeout is not this leg's deadline firing.
        const envelopeError =
          typeof result.error === "string" && result.error.trim().length > 0
            ? result.error
            : undefined;
        const classified = envelopeError
          ? classifyFailure(envelopeError)
          : undefined;
        return {
          provider: opts.provider,
          status: "success",
          data: result.data,
          startedAt,
          durationMs: now() - startedAt,
          budgetMs,
          timedOut: false,
          rateLimited: false,
          attempts,
          ...(classified && envelopeError
            ? {
                category: classified.category,
                reason: redactDiagnostic(envelopeError),
              }
            : {}),
          // Passed through verbatim. `runProviderLeg` never invents a mode:
          // if the leg did not report one, the field stays absent.
          ...(result.acquisition !== undefined
            ? { acquisition: result.acquisition }
            : {}),
          ...(typeof result.observedAt === "number"
            ? { observedAt: result.observedAt }
            : {}),
        };
      }

      // A `success: false` envelope is the provider's own explicit failure.
      const envelopeError = result?.error ?? "provider reported failure";
      const classified = classifyFailure(envelopeError);
      last = {
        category: classified.category,
        rateLimited: classified.rateLimited,
        reason: redactDiagnostic(envelopeError),
      };

      // Never hammer a provider that just told us to back off.
      if (classified.rateLimited) break;
      // An envelope timeout is the same fact as a thrown TimeoutError: the
      // budget (HTTP or leg) is gone, so retrying cannot help.
      if (classified.category === "timeout") break;
    } catch (err) {
      const classified = classifyFailure(err);
      last = {
        category: classified.category,
        rateLimited: classified.rateLimited,
        reason: redactDiagnostic(
          err instanceof Error ? err.message : String(err),
        ),
      };
      // A timeout means the budget is gone; retrying cannot help.
      if (classified.category === "timeout") break;
      if (classified.rateLimited) break;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Ensure no work outlives the leg, even on the success path.
      if (!controller.signal.aborted) controller.abort();
    }
  }

  return {
    provider: opts.provider,
    status: "failed",
    // NOTE: `data` intentionally absent. A failure carries no payload.
    category: last.category,
    reason: last.reason,
    startedAt,
    durationMs: now() - startedAt,
    budgetMs,
    timedOut: last.category === "timeout",
    rateLimited: last.rateLimited,
    attempts,
  };
}

/** A leg the conditional policy chose not to run. Distinct from a failure. */
export function skippedLeg(provider: string, reason: string, now = Date.now): ProviderOutcome<never> {
  const at = now();
  return {
    provider,
    status: "skipped",
    category: "skipped",
    reason,
    startedAt: at,
    durationMs: 0,
    timedOut: false,
    rateLimited: false,
    attempts: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// FAN-OUT
// ═══════════════════════════════════════════════════════════════

export interface FanOutOptions {
  budgetMs?: number;
  now?: () => number;
}

/**
 * Run every leg CONCURRENTLY under an overall deadline.
 *
 * Two properties matter and are both tested:
 *
 *  1. Parallelism — total time tracks the SLOWEST leg, not the sum. Legs are
 *     started before anything is awaited.
 *  2. Preservation — when the overall deadline fires, legs that already
 *     finished keep their real results. Only still-pending legs are marked
 *     `deadline-exceeded`. Good evidence is never discarded.
 */
export async function runFanOut(
  legs: Array<Promise<ProviderOutcome>>,
  opts: FanOutOptions = {},
): Promise<FanOutDiagnostics> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? FANOUT_BUDGET_MS;
  const startedAt = now();

  // Settled slots let us keep whatever arrived before the deadline.
  //
  // NOTE: this array is explicitly FILLED with `undefined`. `new Array(n)`
  // alone produces a SPARSE array, and `Array.prototype.map` skips holes —
  // which would silently drop still-pending legs from the diagnostics instead
  // of reporting them as deadline-exceeded. A missing leg must always be
  // accounted for.
  const settled = new Array<ProviderOutcome | undefined>(legs.length).fill(
    undefined,
  );
  legs.forEach((leg, i) => {
    void leg.then((outcome) => {
      settled[i] = outcome;
    });
  });

  let deadlineExceeded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), budgetMs);
  });

  try {
    const race = await Promise.race([
      Promise.all(legs).then(() => "complete" as const),
      deadline,
    ]);
    deadlineExceeded = race === "deadline";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const outcomes = settled.map((outcome, i) =>
    outcome ?? {
      provider: `leg-${i}`,
      status: "failed" as const,
      category: "deadline-exceeded" as const,
      reason: `overall fan-out budget of ${budgetMs}ms elapsed before this leg finished`,
      startedAt,
      durationMs: now() - startedAt,
      budgetMs,
      timedOut: true,
      rateLimited: false,
      attempts: 1,
    },
  );

  return {
    startedAt,
    durationMs: now() - startedAt,
    budgetMs,
    deadlineExceeded,
    outcomes,
  };
}

/** Successful outcomes only — the sole path by which evidence is attached. */
export function successfulData<T>(outcome: ProviderOutcome<T> | undefined): T | undefined {
  if (!outcome || outcome.status !== "success") return undefined;
  return outcome.data;
}

/**
 * Envelope consumed by `fetchOptionalSlowData` (Phase 15).
 *
 * Success carries the provider's own payload. Failure never carries `data`
 * — absence is the honest signal — and always carries classified `error`
 * text so group-level diagnostics can still see why the optional leg
 * produced nothing.
 */
export type OptionalSlowEnvelope<T> =
  | { success: true; data?: T }
  | { success: false; error: string };

/**
 * Phase 230 §M-3 — map a `ProviderOutcome` back to the optional-slow
 * envelope WITHOUT dropping classified failure text.
 *
 * The protected-analysis `budgeted` wrapper used to return `{success:false}`
 * with no `error`, so `fetchOptionalSlowData` and anything reading the
 * group envelope could not tell a timeout from a rate-limit from a
 * generic miss. Classes already travel through `runProviderLeg`; this
 * function is the only path that must not throw them away.
 *
 * The error string is prefixed with the Phase 177 category so a later
 * `classifyFailure` call recovers timeout / rate-limit / network even
 * when the raw reason (e.g. `provider "cftc" exceeded 8000ms`) would
 * not match those text patterns on its own. The reason is already
 * credential-redacted by `runProviderLeg`.
 */
export function optionalSlowEnvelope<T>(
  outcome: ProviderOutcome<T>,
): OptionalSlowEnvelope<T> {
  if (outcome.status === "success") {
    return { success: true, data: outcome.data };
  }
  const reason =
    typeof outcome.reason === "string" && outcome.reason.length > 0
      ? outcome.reason
      : "provider reported failure";
  const error =
    outcome.category !== undefined ? `${outcome.category}: ${reason}` : reason;
  return { success: false, error };
}

/** Compact, credential-free summary suitable for structured logging. */
export function summarize(diag: FanOutDiagnostics): string {
  const parts = diag.outcomes.map((o) => {
    const detail =
      o.status === "success"
        ? o.category
          ? `${o.durationMs}ms partial/${o.category}`
          : `${o.durationMs}ms`
        : `${o.category}${o.rateLimited ? "/rate-limited" : ""} ${o.durationMs}ms`;
    return `${o.provider}=${o.status}(${detail})`;
  });
  return `fanout ${diag.durationMs}ms${diag.deadlineExceeded ? " DEADLINE" : ""} :: ${parts.join(" ")}`;
}
