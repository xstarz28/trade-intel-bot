/**
 * Phase 7D — EIA Weekly Petroleum Status Report inventory fetch action.
 *
 * Route (documented + auth behavior verified live — 403 without key):
 *   GET https://api.eia.gov/v2/petroleum/sto/data/
 *     ?api_key=…&frequency=weekly&data[]=value
 *     &facets[product][]=<PRODUCT>&facets[process][]=STA
 *     &facets[area][]=NUS-Z00&sort[0][column]=period&sort[0][direction]=desc&length=2
 *
 * Three independent product legs (crude EPC0 / gasoline EPM0 / distillate
 * EPD0). A failing leg never corrupts the others; a wrong facet code simply
 * fails its leg with an explicit reason. Parsing/derivation uses the SHARED
 * pure module (src/lib/data/eia.ts) — no duplicate logic.
 *
 * The API key is read from process.env.EIA_API_KEY and NEVER hardcoded.
 * Without a key this returns an explicit unavailable state — no placeholder,
 * no fabricated data.
 *
 * Phase 230 — single-leg failure semantics via the shared leg taxonomy
 * (lib/legOutcome.ts). Before this phase every failure was folded into a
 * per-leg `reason` string and — critically — the fetcher returned the
 * all-failed legs as a normal payload, so a full EIA outage (or a 403 from
 * an invalid key) was CACHED for 6h and replayed as evidence. Now:
 *  - HTTP 429 -> RATE_LIMIT, 401/403 -> AUTH_ERROR (EIA answers 403 for a
 *    missing/invalid key — verified live): fatal classes propagate out of
 *    the cache fetcher, so nothing is cached and the caller receives the
 *    explicit envelope;
 *  - a wave where EVERY leg failed for transport/provider reasons (nothing
 *    was even parsed) throws -> API_UNAVAILABLE, uncached — an outage is
 *    never cached as an all-failed payload;
 *  - a PARTIAL wave keeps the surviving legs cached; each failed leg keeps
 *    its explicit `${class}: ${reason}` on the payload (the cache replays
 *    the true acquisition record, matching the Phase 228/229 contract);
 *  - an answered-but-error body (EIA's own `error` JSON, e.g. a wrong facet
 *    code) keeps the existing per-leg contract — a valid answer is not an
 *    outage (§227).
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { buildEiaContext, parseEiaResponse } from "../lib/data/eia";
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { errorMessage, isRecord } from "./lib/json";
import {
  isFatalLegError,
  ProviderHttpError,
  runLeg,
  type LegOutcome,
} from "./lib/legOutcome";

const BASE = "https://api.eia.gov/v2/petroleum/sto/data/";
const PRODUCT_IDS = ["EPC0", "EPM0", "EPD0"] as const;

type ParsedEia = ReturnType<typeof parseEiaResponse>;
type EiaLeg = { ok: boolean; requestedProductId: string; parsed?: ParsedEia; reason?: string };

/** Surface the provider's own error text when a non-2xx body carries it. */
async function eiaErrorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.error === "string") return `: ${body.error}`;
  } catch {
    /* body not JSON — keep HTTP status only */
  }
  return "";
}

/**
 * One product leg. Throws fatal classes (RATE_LIMIT / AUTH_ERROR) and
 * classified provider faults; returns the parse outcome otherwise (an EIA
 * error body is a parse-level fact, not a transport failure).
 */
async function fetchProductLegRaw(productId: string, apiKey: string): Promise<ParsedEia> {
  const url =
    `${BASE}?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=weekly&data%5B0%5D=value` +
    `&facets%5Bproduct%5D%5B%5D=${encodeURIComponent(productId)}` +
    `&facets%5Bprocess%5D%5B%5D=STA&facets%5Barea%5D%5B%5D=NUS-Z00` +
    `&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=desc&length=2`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Phase 177 — HTTP deadline; three legs share the 10s eia budget.
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
  if (res.status === 401 || res.status === 403) {
    // EIA rejects a missing/invalid key with 403 — that is AUTH_ERROR, not
    // a generic outage, and must never be cached as a failed payload.
    throw new Error(`AUTH_ERROR: HTTP ${res.status}${await eiaErrorDetail(res)}`);
  }
  if (!res.ok) throw new ProviderHttpError("EIA", res.status, `${res.statusText}${await eiaErrorDetail(res)}`);
  // A non-JSON body rejects here; runLeg classifies SyntaxError as malformed.
  const json: unknown = await res.json();
  return parseEiaResponse(json);
}

export const fetchEiaInventory = action({
  args: {},
  handler: async (actionCtx) => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(actionCtx);

    const apiKey = process.env.EIA_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error:
          "EIA_API_KEY is missing. Add it in the Keys/API keys tab to enable actual WPSR inventory data.",
      };
    }

    // Phase 178c — the EIA Weekly Petroleum Status Report is published ONCE
    // per week (Wednesdays). Re-fetching every product leg per analysis cannot
    // produce new data, so the raw legs are cached for 6h.
    //
    // The RAW LEGS are cached, not the built context: `buildEiaContext`
    // recomputes freshness from the observation date against the current clock
    // on every read, so a cached report decays honestly and a hit can never
    // present an old release as newly published.
    try {
      const evidence = await getProviderCache().fetch<EiaLeg[]>(
        {
          provider: "eia",
          dataset: "eia",
          qualifier: PRODUCT_IDS.join(","),
        },
        async () => {
          // Phase 230 — each leg settles to a classified LegOutcome; only
          // the FATAL classes reject the promise.
          const settled = await Promise.allSettled(
            PRODUCT_IDS.map((p) => runLeg(() => fetchProductLegRaw(p, apiKey))),
          );

          // Phase 178b — fatal failures must THROW out of the cache fetcher,
          // leaving the cache untouched; the action-level catch below turns
          // them back into the explicitly classified envelope.
          for (const result of settled) {
            if (result.status !== "rejected") continue;
            const msg = errorMessage(result.reason);
            if (isFatalLegError(result.reason)) {
              if (msg.startsWith("RATE_LIMIT")) {
                throw new Error("RATE_LIMIT: EIA rate limit exceeded.");
              }
              throw new Error("AUTH_ERROR: EIA API key rejected.");
            }
            throw new Error(msg || "unknown error");
          }

          const legs = (
            settled as PromiseFulfilledResult<LegOutcome<ParsedEia>>[]
          ).map((s, i): EiaLeg => {
            const outcome = s.value;
            const productId = PRODUCT_IDS[i];
            if (outcome.status === "ok") {
              const parsed = outcome.value;
              return parsed.ok
                ? { ok: true, requestedProductId: productId, parsed }
                : { ok: false, requestedProductId: productId, parsed };
            }
            // A leg that failed before any parse (transport/provider/class —
            // or nothing usable) keeps its class + reason explicitly; the
            // leg is never silently absent.
            return {
              ok: false,
              requestedProductId: productId,
              reason: `${outcome.status}: ${outcome.reason}`,
            };
          });

          // Phase 230 — if EVERY leg failed for a transport/provider reason
          // (nothing was even parsed), that is a provider outage: throw so
          // the action reports API_UNAVAILABLE and NOTHING is cached. Before
          // this phase the all-failed payload was cached for 6h, replaying
          // an outage as if it were an acquisition.
          const anyAnswered = (settled as PromiseFulfilledResult<LegOutcome<ParsedEia>>[]).some(
            (s) => s.value.status === "ok" || s.value.status === "unavailable",
          );
          if (!anyAnswered) {
            const why = PRODUCT_IDS.map((p, i) => {
              const o = (settled as PromiseFulfilledResult<LegOutcome<ParsedEia>>[])[i].value;
              return `${p}: ${o.status}${o.status === "ok" ? "" : ` (${"reason" in o ? o.reason : ""})`}`;
            }).join("; ");
            throw new Error(`every leg failed (${why})`);
          }

          return { data: legs, observedAt: Date.now() };
        },
      );
      if (!evidence) {
        return { success: false as const, error: "EIA returned no data." };
      }
      // Freshness derived at READ time from the observation date.
      const ctx = buildEiaContext(evidence.data, Date.now(), Date.now());
      if (!ctx.available) {
        return { success: false as const, error: ctx.reason };
      }
      return {
        success: true as const,
        data: ctx,
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: unknown) {
      // Phase 230 — Convex re-wraps thrown errors, so the fatal classes can
      // only survive to the caller as an explicitly returned envelope.
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false as const,
          error: "EIA rate limit exceeded (HTTP 429).",
          errorCode: "RATE_LIMIT" as const,
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false as const,
          error: "EIA API key rejected (HTTP 401/403) — verify EIA_API_KEY.",
          errorCode: "AUTH_ERROR" as const,
        };
      }
      return {
        success: false as const,
        error: `EIA request failed: ${msg}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});
