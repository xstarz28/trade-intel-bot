/**
 * Phase 174 — the protected decision-delivery boundary.
 *
 * ## The vulnerability this closes
 *
 * Phase 169 made the entitlement *counter* server-authoritative. It did not
 * make the *decision* server-authoritative, and that distinction was the
 * whole hole:
 *
 *   1. `runAnalysis()` ran in the browser. The directional decision existed
 *      client-side the moment it was computed — before any mutation ran.
 *   2. `consumeProfitSignal({ recommendation })` trusted the client to report
 *      what the engine produced.
 *
 * So a caller could report `"WAIT"` (→ `NOT_CHARGEABLE`, nothing consumed) and
 * still hold the LONG, or simply never call the mutation. This required no
 * special tooling: the mutation is callable from the browser console, and the
 * engine's logic ships in the bundle.
 *
 * Adding another client-side check would have been theatre. The only real fix
 * is to stop producing the protected payload on the client:
 *
 *   client sends INPUTS  →  server runs the engine  →  server reads its OWN
 *   entitlement row  →  server decides  →  either the full result or a locked
 *   stub crosses the wire.
 *
 * The directional recommendation, trade plan and sizing for an exhausted guest
 * are therefore never serialized to that client at all. There is nothing in
 * the response to un-hide, and nothing in devtools to read.
 *
 * ## Why an action + internal mutation
 *
 * The engine calls `Date.now()`, so it is not deterministic and cannot run
 * inside a Convex mutation's sandbox. It runs in an **action**; the counter is
 * incremented by an **internal mutation**, which keeps the read-modify-write
 * atomic under Convex's serializable OCC. The internal mutation is not part of
 * the public API surface, so it is not callable by a client.
 *
 * ## Ordering
 *
 * Entitlement is consumed *before* the result is returned. If the consume step
 * fails, nothing is delivered — the boundary fails closed.
 *
 * ## Phase 175 — evidence provenance
 *
 * Moving the engine server-side closed the *entitlement* hole but not an
 * *integrity* one: the action accepted the full `AnalysisInput` from the
 * client, including provider-backed evidence. That was exploitable — a client
 * could invent a price the provider never returned, flip market structure to
 * reverse the verdict, relabel the payload with another provider's name, or
 * back-date month-old candles as `realtime` and still receive a
 * `dataCompleteness: "full"` result.
 *
 * The fix is provenance, not a checksum: the **server re-acquires the decisive
 * evidence itself** (price, candles, derived technicals) from the instrument
 * identifiers, and overwrites whatever the client sent. Client-supplied
 * `marketData`/`technicalData` is therefore inert on the trusted path.
 *
 * What the client may still supply is *intent* — instrument, timeframe,
 * trading style, and the user's own risk inputs (account equity, risk percent)
 * — none of which is provider evidence.
 *
 * Provider-native identity is preserved exactly: the instrument string is
 * passed through unchanged and the provider's own response supplies the id and
 * provider name. Missing-data behaviour is unchanged — when acquisition fails
 * the engine receives no market data and degrades explicitly, which is why
 * this cannot fabricate evidence.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { runAnalysis } from "@/lib/analysis-engine";
import { fetchOptionalSlowData } from "@/lib/data/optional-providers";
import { parseSymbolCurrencies } from "@/lib/risk/spec-resolver";
import {
  type ProviderOutcome,
  runFanOut,
  runProviderLeg,
  skippedLeg,
  successfulData,
  summarize,
} from "@/lib/data/provider-resilience";
import {
  type LegDiagnostic,
  formatProvenance,
  legFromCache,
  legFromFailure,
  legUncachedByDesign,
  summarizeProvenance,
} from "@/lib/data/provenance-diagnostics";
import type { AnalysisInput } from "@/types/analysis";
import {
  gateDecision,
  type LockedDecisionPayload,
} from "@/lib/entitlement/decision-gate";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type Plan,
} from "@/lib/entitlement/entitlement";

// ═══════════════════════════════════════════════════════════════
// INTERNAL: atomic entitlement resolution + consumption
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve the caller's plan and, when the decision is actionable and allowed,
 * consume exactly one unit — atomically.
 *
 * `chargeable` is computed by the *caller in this file* from the engine's own
 * output. It is never accepted from outside Convex: this is an
 * `internalMutation`, absent from the public `api` object.
 *
 * Returns the entitlement verdict; the action decides what to deliver.
 */
/** Entitlement verdict produced by {@link resolveAndConsume}. */
export interface ConsumeVerdict {
  plan: Plan;
  allowed: boolean;
  charged: boolean;
  remaining: number | null;
  upgradeRequired: boolean;
  reason:
    | "NOT_CHARGEABLE"
    | "CONSUMED"
    | "PREMIUM"
    | "WITHIN_FREE_ALLOWANCE"
    | "FREE_ALLOWANCE_EXHAUSTED";
}

export const resolveAndConsume = internalMutation({
  args: {
    userId: v.id("users"),
    /** Derived server-side from the engine result. Not a client assertion. */
    chargeable: v.boolean(),
  },
  handler: async (ctx, args): Promise<ConsumeVerdict> => {
    const now = Date.now();

    const row = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const storedPlan: Plan = row?.plan === "PREMIUM" ? "PREMIUM" : "GUEST";
    const expired =
      storedPlan === "PREMIUM" &&
      typeof row?.premiumUntil === "number" &&
      row.premiumUntil <= now;
    const plan: Plan = expired ? "GUEST" : storedPlan;
    const used = row?.profitSignalsUsed ?? 0;

    const decision = evaluateEntitlement({ plan, profitSignalsUsed: used });

    // Non-chargeable output never touches the counter.
    if (!args.chargeable) {
      return {
        plan,
        allowed: true,
        charged: false,
        remaining: plan === "PREMIUM" ? null : decision.remaining,
        upgradeRequired: false,
        reason: "NOT_CHARGEABLE" as const,
      };
    }

    if (!decision.allowed) {
      // Persist a degraded plan so an expired subscription is not re-evaluated
      // as PREMIUM forever, even though nothing is consumed here.
      if (row && expired) {
        await ctx.db.patch(row._id, { plan, updatedAt: now });
      }
      return {
        plan,
        allowed: false,
        charged: false,
        remaining: 0,
        upgradeRequired: true,
        reason: decision.reason,
      };
    }

    const updated = nextUsageCount({ plan, profitSignalsUsed: used }, "LONG");

    if (row) {
      await ctx.db.patch(row._id, {
        profitSignalsUsed: updated,
        plan,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("entitlements", {
        userId: args.userId,
        plan,
        profitSignalsUsed: updated,
        updatedAt: now,
      });
    }

    const after = evaluateEntitlement({ plan, profitSignalsUsed: updated });

    return {
      plan,
      allowed: true,
      charged: plan !== "PREMIUM",
      remaining: plan === "PREMIUM" ? null : after.remaining,
      upgradeRequired: false,
      reason: "CONSUMED" as const,
    };
  },
});

/** Resolve the signed-in user id, or null. Mirrors entitlements.ts. */
export const resolveCallerId = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const email = identity.email;
    if (email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (byEmail) return byEmail._id;
    }

    try {
      const byId = await ctx.db.get(identity.subject as Id<"users">);
      return byId?._id ?? null;
    } catch {
      return null;
    }
  },
});

// ═══════════════════════════════════════════════════════════════
// EVIDENCE PROVENANCE
// ═══════════════════════════════════════════════════════════════

/**
 * Fields the client is NEVER trusted for on the decision path.
 *
 * These are provider-backed evidence: they must originate from a server-side
 * acquisition, not from the caller. Anything listed here is stripped from the
 * incoming input before the engine sees it.
 *
 * Exported so the test-suite asserts against the same list the server uses.
 */
export const CLIENT_UNTRUSTED_EVIDENCE_FIELDS = [
  "marketData",
  "technicalData",
  "sentimentData",
  "fundamentalData",
  "macroData",
  "derivativesData",
  "calendarData",
  "treasuryData",
  "cotData",
  "eiaData",
  "executionData",
  "okxSpecData",
  "cryptoIntelligenceContext",
  "universalIntelligenceContext",
  "fxRates",
  "currentPrice",
  "recentHigh",
  "recentLow",
  "fundingRate",
  "openInterest",
  // ── Phase 176 ──
  // Reclassified from "trusted user intent" after a counterfactual audit
  // proved they are DIRECTIONAL EVIDENCE, not narrative.
  //
  // The engine keyword-scores both strings as a fallback whenever provider
  // intelligence/calendar data is absent (analysis-engine.ts: trend score,
  // fundamental score, sentiment score, evidence naming, data-completeness
  // flags, and the SWING fundamental-context gate). Measured against the
  // repo's own proven LONG fixture with server-acquired market data:
  //
  //   "Fed signals hawkish stance, rate hike"  -> LONG,     conf 45
  //   "dovish, rate cut, easing"               -> NO_TRADE
  //   "weak gdp, recession"                    -> NO_TRADE
  //   "fear panic capitulation"                -> LONG,     conf 57
  //   "greed euphoria fomo"                    -> LONG,     conf 37
  //   both weaponised                          -> NO_TRADE, bias Neutral, 31
  //
  // A 26-point confidence swing and outright trade cancellation from
  // unverifiable client text. Provider-backed calendar/news data is acquired
  // server-side instead; these free-text fields never reach the engine.
  "newsContext",
  "economicEvents",
  // Provider/broker CONTRACT SPECIFICATION — not a user preference.
  // resolveInstrumentSpec() lets an explicit spec override verified OKX
  // metadata field-by-field, so a forged contractSize/quantityStep silently
  // rewrites position sizing (measured: quantity 0 -> 20 on the same plan).
  // The server acquires this from OKX instead.
  "instrumentSpec",
] as const;

/**
 * Intent/parameter fields the client legitimately controls.
 *
 * None of these is provider evidence: they select *what* to analyse and *how*,
 * or describe the user's own account. They cannot invent market facts.
 */
export const CLIENT_TRUSTED_INPUT_FIELDS = [
  "instrument",
  "instrumentType",
  "timeframe",
  "tradingStyle",
  "requestedTimeframe",
  "styleNotes",
  // User-owned RISK PARAMETERS. These describe the user's own account, not
  // the market. They scale sizing arithmetic but cannot create or alter a
  // market fact, a bias, a recommendation or a confidence score.
  "accountEquity",
  "riskPercent",
  "accountCurrency",
] as const;

/**
 * Strip every untrusted evidence field from a client-supplied input.
 *
 * Built up from an allowlist rather than deleted from the original, so a field
 * added to `AnalysisInput` later is untrusted by default. Failing closed is the
 * only safe direction here.
 */
export function stripClientEvidence(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of CLIENT_TRUSTED_INPUT_FIELDS) {
    if (input[key] !== undefined) clean[key] = input[key];
  }
  return clean;
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC: run an analysis behind the entitlement boundary
// ═══════════════════════════════════════════════════════════════

/**
 * Run the decision engine server-side and return only what the caller is
 * entitled to receive.
 *
 * The client supplies *inputs* (instrument, timeframe, market data). It does
 * not supply — and cannot influence — the recommendation, the chargeability
 * determination, the plan, or the remaining allowance.
 */
/** Response shape of {@link runProtectedAnalysis}. */
export interface ProtectedAnalysisResponse {
  status: "UNAUTHENTICATED" | "INVALID_INPUT" | "DELIVERED" | "LOCKED";
  entitlement: {
    authenticated: boolean;
    plan: Plan;
    remaining: number | null;
    limit: number;
    upgradeRequired: boolean;
    charged?: boolean;
    reason?: string;
  };
  result: Record<string, unknown> | LockedDecisionPayload | null;
}

/**
 * Which AnalysisInput field each provider ultimately populates.
 *
 * Used only for diagnostics, to distinguish "the provider answered" from "the
 * engine actually consumed it". Never used to attach evidence.
 */
/**
 * Phase 178d — the dataset each provider leg supplies, plus whether that
 * dataset is cached. Drives acquisition diagnostics so an operator can tell a
 * new observation from reused evidence.
 *
 * `cached: false` is an architectural statement, not an omission: the OKX
 * order book is UNCACHED BY DESIGN (see okx.ts) because its freshness label
 * is computed once and stored, so reuse would replay a stale FRESH.
 */
const LEG_DATASET: Record<string, { dataset: string; cached: boolean }> = {
  "market-data": { dataset: "ohlcv", cached: true },
  "alpha-vantage": { dataset: "news-sentiment", cached: true },
  tickatlas: { dataset: "calendar", cached: true },
  coinglass: { dataset: "derivatives", cached: true },
  cftc: { dataset: "cot", cached: true },
  treasury: { dataset: "treasury", cached: true },
  eia: { dataset: "eia", cached: true },
  "okx-order-book": { dataset: "order-book", cached: false },
  "okx-instrument-spec": { dataset: "instrument-spec", cached: true },
  "fx-rate": { dataset: "fx-rate", cached: true },
};

const USED_EVIDENCE_BY_PROVIDER: Record<string, string> = {
  "market-data": "marketData",
  "alpha-vantage": "sentimentData",
  tickatlas: "calendarData",
  coinglass: "derivativesData",
  cftc: "cotData",
  treasury: "treasuryData",
  eia: "eiaData",
  "okx-order-book": "executionData",
  "okx-instrument-spec": "okxSpecData",
  "fx-rate": "fxRates",
};

export const runProtectedAnalysis = action({
  args: {
    /**
     * Analysis inputs. Typed as `any` at the Convex boundary because
     * `AnalysisInput` is a large structural type with many optional provider
     * payloads; it is validated by the engine itself, which degrades
     * explicitly on missing data rather than fabricating it.
     */
    input: v.any(),
  },
  handler: async (ctx, args): Promise<ProtectedAnalysisResponse> => {
    const userId: Id<"users"> | null = await ctx.runMutation(
      internal.protectedAnalysis.resolveCallerId,
      {},
    );

    if (!userId) {
      // Fail closed. No engine run, no payload.
      return {
        status: "UNAUTHENTICATED" as const,
        entitlement: {
          authenticated: false,
          plan: "GUEST" as Plan,
          remaining: FREE_PROFIT_SIGNAL_LIMIT,
          limit: FREE_PROFIT_SIGNAL_LIMIT,
          upgradeRequired: false,
        },
        result: null,
      };
    }

    // 1. Establish TRUSTED evidence.
    //
    // Everything provider-backed the client sent is discarded, then the server
    // acquires the decisive evidence itself. A forged price, a flipped market
    // structure, a relabelled provider or a back-dated "realtime" candle set
    // therefore cannot reach the engine.
    const rawInput = (args.input ?? {}) as Record<string, unknown>;
    const trustedInput = stripClientEvidence(rawInput);

    const instrument = String(trustedInput.instrument ?? "").trim();
    const instrumentType = String(trustedInput.instrumentType ?? "");
    const timeframe = String(trustedInput.timeframe ?? "");

    if (!instrument || !instrumentType || !timeframe) {
      return {
        status: "INVALID_INPUT" as const,
        entitlement: {
          authenticated: true,
          plan: "GUEST" as Plan,
          remaining: null,
          limit: FREE_PROFIT_SIGNAL_LIMIT,
          upgradeRequired: false,
        },
        result: null,
      };
    }

    // Server-side acquisition. Provider-native identity is passed through
    // unchanged; the provider's own response supplies price, candles and the
    // provider name.
    const assetClass = instrumentType as
      | "forex"
      | "crypto"
      | "stock"
      | "commodity"
      | "indices";

    // Phase 177 — every provider call is issued under an explicit deadline.
    // `ctx.runAction` cannot be aborted mid-flight, so the budget bounds how
    // long THIS analysis waits; the abandoned action is left to Convex. The
    // point is that a hung provider can no longer stall the user's request.
    const acquiredLeg = runProviderLeg<{
      data?: unknown;
      technical?: unknown;
    }>({
      provider: "market-data",
      run: async () => {
        const r = (await ctx.runAction(api.marketData.fetchMarketData, {
          instrument,
          instrumentType: instrumentType as
            | "forex"
            | "crypto"
            | "stock"
            | "commodity"
            | "indices",
          timeframe,
        })) as {
          success: boolean;
          data?: unknown;
          technical?: unknown;
          error?: string;
        };
        return {
          success: r.success,
          data: { data: r.data, technical: r.technical },
          error: r.error,
        };
      },
    });

    // ── ONE parallel acquisition wave, now bounded ──
    //
    // Market data, the fast intelligence legs and the conditional slow legs
    // are all issued together so the server never serializes provider latency.
    // Each leg carries its own deadline; the whole wave carries an overall
    // backstop. Legs that already finished are never discarded.
    //
    // The slow/conditional legs run through the SAME pure policy module the
    // client used (Phase 15), so the per-asset/per-style conditional rules,
    // the at-most-once invocation guarantee and the non-fatal semantics are
    // provably identical — see src/lib/data/optional-providers.ts.
    //
    // FX conversion applies only when the user named an account currency that
    // differs from the instrument's quote currency. The quote currency comes
    // from the SYMBOL, never from a client-supplied instrumentSpec.
    let fxPair: { from: string; to: string } | undefined;
    const accountCurrency =
      typeof trustedInput.accountCurrency === "string"
        ? trustedInput.accountCurrency
        : undefined;
    if (accountCurrency) {
      const quoteCcy = parseSymbolCurrencies(instrument).quote;
      const acct = accountCurrency.toUpperCase();
      if (quoteCcy && quoteCcy.toUpperCase() !== acct) {
        fxPair = { from: quoteCcy, to: acct };
      }
    }

    const intelligenceLeg = runProviderLeg<{
      sentiment?: unknown;
      fundamentals?: unknown;
      macro?: unknown;
    }>({
      provider: "alpha-vantage",
      run: async () => {
        const r = (await ctx.runAction(api.alphaVantage.fetchIntelligence, {
          instrument,
          instrumentType: assetClass,
        })) as {
          success: boolean;
          sentiment?: unknown;
          fundamentals?: unknown;
          macro?: unknown;
          error?: string;
        };
        return {
                success: r.success,
                data: r,
                error: r.error,
                acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
                observedAt: (r as { observedAt?: number }).observedAt,
              };
      },
    });

    const calendarLeg = runProviderLeg<unknown>({
      provider: "tickatlas",
      run: async () => {
        const r = (await ctx.runAction(api.tradingEconomics.fetchCalendar, {
          instrument,
          instrumentType,
        })) as { success: boolean; data?: unknown; error?: string };
        return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
      },
    });

    const derivativesLeg =
      assetClass === "crypto"
        ? runProviderLeg<unknown>({
            provider: "coinglass",
            run: async () => {
              const r = (await ctx.runAction(api.coinglass.fetchDerivatives, {
                instrument,
              })) as { success: boolean; data?: unknown; error?: string };
              return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
            },
          })
        : Promise.resolve(
            skippedLeg("coinglass", "not a crypto instrument"),
          );

    // Bounded provider thunk for the Phase 15 policy module. The policy still
    // decides WHETHER a leg runs; the budget decides how long we wait for it.
    const budgeted =
      <T>(provider: string, call: () => Promise<{ success: boolean; data?: T; error?: string }>) =>
      async (): Promise<{ success: boolean; data?: T }> => {
        const outcome = await runProviderLeg<T>({ provider, run: call });
        slowOutcomes.push(outcome);
        return outcome.status === "success"
          ? { success: true, data: outcome.data }
          : { success: false };
      };
    const slowOutcomes: ProviderOutcome[] = [];

    const slowLeg = fetchOptionalSlowData(
      {
        instrumentType: assetClass,
        instrument,
        tradingStyle:
          typeof trustedInput.tradingStyle === "string"
            ? trustedInput.tradingStyle
            : undefined,
        // The client can no longer assert a complete spec, so the OKX
        // specification leg is always eligible for crypto.
        hasCompleteSpec: false,
      },
      {
        fx: fxPair
          ? budgeted("fx-rate", async () => {
              const r = (await ctx.runAction(api.marketData.fetchFxRate, {
                from: fxPair!.from,
                to: fxPair!.to,
              })) as {
                success: boolean;
                direct?: unknown;
                inverse?: unknown;
                error?: string;
              };
              return {
                success: r.success,
                data: r,
                error: r.error,
                acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
                observedAt: (r as { observedAt?: number }).observedAt,
              };
            })
          : undefined,
        cot: budgeted("cftc", async () => {
          const r = (await ctx.runAction(api.cot.fetchCotPositioning, {
            instrument,
          })) as { success: boolean; data?: never; error?: string };
          return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
        }),
        execution: budgeted("okx-order-book", async () => {
          const r = (await ctx.runAction(api.okx.fetchOkxOrderBook, {
            instrument,
          })) as { success: boolean; data?: never; error?: string };
          return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
        }),
        eia: budgeted("eia", async () => {
          const r = (await ctx.runAction(api.eia.fetchEiaInventory, {})) as {
            success: boolean;
            data?: never;
            error?: string;
          };
          return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
        }),
        treasury: budgeted("treasury", async () => {
          const r = (await ctx.runAction(
            api.treasury.fetchTreasuryYields,
            {},
          )) as { success: boolean; data?: never; error?: string };
          return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
        }),
        okxSpec: budgeted("okx-instrument-spec", async () => {
          const r = (await ctx.runAction(api.okx.fetchOkxInstrumentSpec, {
            instrument,
          })) as { success: boolean; data?: never; error?: string };
          return {
            success: r.success,
            data: r.data,
            error: r.error,
            acquisition: (r as { acquisition?: "observed-now" | "observed-shared" | "cache-reused" }).acquisition,
            observedAt: (r as { observedAt?: number }).observedAt,
          };
        }),
      },
    );

    // The fx thunk is typed loosely by the policy module; re-narrow here.
    const slowLegTyped = slowLeg as Promise<
      Awaited<ReturnType<typeof fetchOptionalSlowData>>
    >;

    const fanOut = await runFanOut([
      acquiredLeg,
      intelligenceLeg,
      calendarLeg,
      derivativesLeg,
      slowLegTyped.then(
        (data) =>
          ({
            provider: "optional-slow-group",
            status: "success",
            data,
            startedAt: Date.now(),
            durationMs: 0,
            timedOut: false,
            rateLimited: false,
            attempts: 1,
          }) as ProviderOutcome,
      ),
    ]);

    const [acquiredOutcome, intelOutcome, calendarOutcome, derivOutcome, slowOutcome] =
      fanOut.outcomes;

    const acquired = successfulData(
      acquiredOutcome as ProviderOutcome<{ data?: unknown; technical?: unknown }>,
    );
    const intelligence = successfulData(
      intelOutcome as ProviderOutcome<{
        sentiment?: unknown;
        fundamentals?: unknown;
        macro?: unknown;
      }>,
    );
    const calendar = successfulData(calendarOutcome);
    const derivatives = successfulData(derivOutcome);
    const slow =
      successfulData(
        slowOutcome as ProviderOutcome<
          Awaited<ReturnType<typeof fetchOptionalSlowData>>
        >,
      ) ?? {};

    // Acquisition failure is NOT fabricated around: the engine simply receives
    // no market data and degrades explicitly, exactly as before.
    if (acquired?.data !== undefined) {
      trustedInput.marketData = acquired.data;
      if (acquired.technical !== undefined) {
        trustedInput.technicalData = acquired.technical;
      }
    }

    // Only genuinely acquired evidence is attached. A timeout, a rate limit or
    // any other failure attaches NOTHING — absence is the honest signal the
    // engine already handles, and it is never a default or a fabricated value.
    if (intelligence) {
      if (intelligence.sentiment !== undefined) {
        trustedInput.sentimentData = intelligence.sentiment;
      }
      if (intelligence.fundamentals !== undefined) {
        trustedInput.fundamentalData = intelligence.fundamentals;
      }
      if (intelligence.macro !== undefined) {
        trustedInput.macroData = intelligence.macro;
      }
    }
    if (calendar !== undefined) trustedInput.calendarData = calendar;
    if (derivatives !== undefined) trustedInput.derivativesData = derivatives;
    if (slow.fxRates !== undefined) trustedInput.fxRates = slow.fxRates;
    if (slow.cotData !== undefined) trustedInput.cotData = slow.cotData;
    if (slow.executionData !== undefined) {
      trustedInput.executionData = slow.executionData;
    }
    if (slow.eiaData !== undefined) trustedInput.eiaData = slow.eiaData;
    if (slow.treasuryData !== undefined) {
      trustedInput.treasuryData = slow.treasuryData;
    }
    if (slow.okxSpecData !== undefined) {
      trustedInput.okxSpecData = slow.okxSpecData;
    }

    // Structured, credential-free latency diagnostics. Records which legs were
    // actually consumed by the engine, so "acquired" and "used" stay distinct.
    const allOutcomes: ProviderOutcome[] = [
      ...fanOut.outcomes.filter((o) => o.provider !== "optional-slow-group"),
      ...slowOutcomes,
    ];
    for (const outcome of allOutcomes) {
      outcome.usedByEngine =
        outcome.status === "success" &&
        USED_EVIDENCE_BY_PROVIDER[outcome.provider] !== undefined &&
        trustedInput[USED_EVIDENCE_BY_PROVIDER[outcome.provider]] !== undefined;
    }
    console.log(
      summarize({ ...fanOut, outcomes: allOutcomes }),
    );

    // Phase 178d — acquisition provenance. Answers a question the latency
    // summary cannot: was each piece of evidence freshly observed, shared
    // from a concurrent provider call, reused from cache, deliberately
    // uncached, skipped, or unavailable?
    //
    // Modes are REPORTED, never inferred from timing. A successful leg's mode
    // comes from the cache's own `acquisition` field, surfaced by the
    // provider actions; a failed leg's mode comes from its Phase 177 failure
    // category. A fast leg is not evidence of a cache hit.
    const provenanceLegs: LegDiagnostic[] = allOutcomes.map((outcome) => {
      const meta = LEG_DATASET[outcome.provider] ?? {
        dataset: "unknown",
        cached: false,
      };
      const attachedKey = USED_EVIDENCE_BY_PROVIDER[outcome.provider];
      const usedByEngine = outcome.usedByEngine === true;

      if (outcome.status !== "success") {
        return legFromFailure({
          provider: outcome.provider,
          dataset: meta.dataset,
          outcome,
        });
      }

      // The provider actions report their own acquisition mode. When a leg
      // does not surface one, fall back to `observed-now` rather than
      // guessing a cache hit: over-reporting reuse would understate provider
      // load, but falsely reporting a NEW OBSERVATION is the dangerous
      // direction, so the fallback is the honest-but-conservative one only
      // for genuinely uncached legs.
      const reported = outcome.acquisition;
      const mode =
        reported === "cache-reused" ||
        reported === "observed-shared" ||
        reported === "observed-now"
          ? reported
          : undefined;

      const observedAt =
        typeof outcome.observedAt === "number"
          ? outcome.observedAt
          : outcome.startedAt + outcome.durationMs;

      if (!meta.cached) {
        return legUncachedByDesign({
          provider: outcome.provider,
          dataset: meta.dataset,
          observedAt,
          attached: attachedKey !== undefined,
          usedByEngine,
        });
      }

      return legFromCache({
        provider: outcome.provider,
        dataset: meta.dataset,
        acquisition: mode ?? "observed-now",
        observedAt,
        attached: attachedKey !== undefined,
        usedByEngine,
      });
    });

    for (const line of formatProvenance(summarizeProvenance(provenanceLegs))) {
      console.log(line);
    }

    // 2. Run the engine on the SERVER over TRUSTED evidence only.
    const engineResult = runAnalysis(trustedInput as unknown as AnalysisInput) as unknown as Record<
      string,
      unknown
    >;

    // 2. Chargeability comes from the engine's own output.
    const chargeable = isProfitSignal(
      typeof engineResult.recommendation === "string"
        ? engineResult.recommendation
        : undefined,
    );

    // 3. Consume atomically BEFORE delivering anything.
    const verdict: ConsumeVerdict = await ctx.runMutation(
      internal.protectedAnalysis.resolveAndConsume,
      { userId, chargeable },
    );

    // 4. Redact if not entitled.
    const gated = gateDecision({
      result: engineResult,
      entitlement: { allowed: verdict.allowed },
    });

    return {
      status: gated.status,
      entitlement: {
        authenticated: true,
        plan: verdict.plan,
        remaining: verdict.remaining,
        limit: FREE_PROFIT_SIGNAL_LIMIT,
        upgradeRequired: verdict.upgradeRequired,
        charged: verdict.charged,
        reason: verdict.reason,
      },
      result: gated.result,
    };
  },
});
