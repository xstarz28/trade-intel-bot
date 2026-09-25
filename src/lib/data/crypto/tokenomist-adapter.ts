/**
 * Phase 41 — Tokenomist Provider Adapter
 *
 * Tokenomist provides token unlock schedules, vesting data, and supply dynamics.
 * This adapter normalizes their data into the CryptoIntelligence schema.
 *
 * NON-NEGOTIABLE:
 *   - Token unlocks are CONTEXT, not automatic bearish evidence.
 *   - "No upcoming unlock" ≠ automatically bullish.
 *   - Provider availability NEVER becomes directional evidence.
 *   - All failures surface explicitly.
 *   - No fabricated values.
 */

import type {
  CryptoIntelligenceProvider,
  CryptoIntelligenceProviderResult,
  TokenomicsIntelligence,
} from "./types";
import { toTokenomistSymbol } from "./symbols";
import { asFiniteNumber, asRecordArray, errorMessage, field, isRecord } from "../json/narrow";

/**
 * Phase 283 — HTTP status → this repository's provider-failure vocabulary.
 * A 429 is a rate limit, a 401/403 is an auth problem, anything else non-2xx is
 * the provider being unavailable. None of them is "this token has no data".
 */
type TokenomistHttpFailureCode = "API_UNAVAILABLE" | "RATE_LIMIT" | "AUTH_ERROR";

function tokenomistHttpFailureCode(status: number): TokenomistHttpFailureCode {
  if (status === 429) return "RATE_LIMIT";
  if (status === 401 || status === 403) return "AUTH_ERROR";
  return "API_UNAVAILABLE";
}

/** Internal accumulator for the two Tokenomist datasets. */
interface TokenomistRaw {
  unlocks?: { upcomingCount30d: number; upcomingValue30d?: number; summary: string };
  supply?: { circulatingSupply?: number; totalSupply?: number; circulatingPercent?: number };
}

/**
 * Tokenomist adapter — fetches tokenomics intelligence.
 */
export class TokenomistAdapter implements CryptoIntelligenceProvider {
  readonly name = "Tokenomist";

  private httpFetch?: typeof fetch;
  private apiKey?: string;

  constructor(httpFetch?: typeof fetch, apiKey?: string) {
    this.httpFetch = httpFetch;
    this.apiKey = apiKey;
  }

  supportsInstrument(instrument: string): boolean {
    return toTokenomistSymbol(instrument) !== null;
  }

  /**
   * Phase 279 — `resolvedSymbol` lets the live crypto-fundamentals action pass
   * the base asset of a provider-native crypto id ("BTC-USDT" → "BTC"), which
   * IS the token identity the provider expects. Callers that pass nothing keep
   * the exact Phase 41 behaviour (canonical table only).
   */
  async fetch(
    instrument: string,
    resolvedSymbol?: string,
  ): Promise<CryptoIntelligenceProviderResult | null> {
    const symbol = resolvedSymbol ?? toTokenomistSymbol(instrument);
    if (!symbol) return null;
    if (!resolvedSymbol && !this.supportsInstrument(instrument)) return null;

    const fetchFn = this.httpFetch ?? fetch;
    const observedAt = Date.now();

    try {
      // Tokenomist API endpoint (public for basic data)
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      // Fetch upcoming unlocks
      const data: TokenomistRaw = {};

      // Phase 283 — a leg that never answered is NOT "no data for this token".
      // The sibling DeFiLlama adapter has always distinguished a transport
      // failure from an empty dataset; this one swallowed the error and
      // reported an outage as a fact about the asset, which points the user at
      // the wrong next action. Each leg now records why it produced nothing.
      let networkError: string | undefined;
      let httpFailure: { status: number; errorCode: TokenomistHttpFailureCode } | undefined;
      // A container object is not a measurement. These flags record whether a
      // leg actually said something about the asset, so the availability and
      // quality verdicts below can never be earned by an empty response body.
      let unlockListSupplied = false;

      try {
        const unlockRes = await fetchFn(
          `https://api.tokenomist.xyz/unlocks?token=${symbol}&limit=10`,
          { headers },
        );
        if (unlockRes.ok) {
          const unlockList = field(await unlockRes.json(), "data");
          // The provider answered with an unlock LIST — even an empty list is a
          // real reading ("nothing unlocks in 30 days"). A body without a list
          // is not a reading at all.
          unlockListSupplied = Array.isArray(unlockList);
          const events = asRecordArray(unlockList);
          const now = Date.now();
          const thirtyDays = 30 * 24 * 3600 * 1000;

          const upcoming = events.filter((e) => {
            const when = e.unlock_date ?? e.date;
            if (typeof when !== "string" && typeof when !== "number") return false;
            const unlockTime = new Date(when).getTime();
            return unlockTime > now && unlockTime < now + thirtyDays;
          });

          const totalUpcoming = upcoming.reduce(
            (sum, e) => sum + (asFiniteNumber(e.amount) ?? 0),
            0,
          );

          data.unlocks = {
            upcomingCount30d: upcoming.length,
            upcomingValue30d: totalUpcoming > 0 ? totalUpcoming : undefined,
            summary: upcoming.length > 0
              ? `${upcoming.length} unlock event(s) totaling ${totalUpcoming.toLocaleString()} tokens in next 30 days`
              : "No upcoming unlock events in next 30 days",
          };
        } else {
          httpFailure ??= {
            status: unlockRes.status,
            errorCode: tokenomistHttpFailureCode(unlockRes.status),
          };
        }
      } catch (e) {
        // Unlock fetch failed — non-fatal to the OTHER leg, but the failure is
        // remembered: a leg that never answered must not be read as "no data".
        networkError ??= errorMessage(e);
      }

      // Fetch token supply info
      try {
        const supplyRes = await fetchFn(
          `https://api.tokenomist.xyz/token/${symbol}/supply`,
          { headers },
        );
        if (supplyRes.ok) {
          const supplyData: unknown = await supplyRes.json();
          if (isRecord(supplyData)) {
            const circulating = asFiniteNumber(supplyData.circulating_supply) ?? 0;
            const total = asFiniteNumber(supplyData.total_supply) ?? 0;
            data.supply = {
              circulatingSupply: circulating > 0 ? circulating : undefined,
              totalSupply: total > 0 ? total : undefined,
              circulatingPercent: circulating > 0 && total > 0
                ? (circulating / total) * 100
                : undefined,
            };
          }
        } else {
          httpFailure ??= {
            status: supplyRes.status,
            errorCode: tokenomistHttpFailureCode(supplyRes.status),
          };
        }
      } catch (e) {
        // Supply fetch failed — non-fatal to the other leg; remembered above.
        networkError ??= errorMessage(e);
      }

      const measured = {
        unlocks: unlockListSupplied,
        supply:
          data.supply !== undefined &&
          (data.supply.circulatingSupply !== undefined || data.supply.totalSupply !== undefined),
      };
      const availableDatasets = [measured.unlocks, measured.supply].filter(Boolean).length;

      // An outage is reported as an outage: "the provider could not be reached"
      // and "this token has no dataset" imply different next actions, so they
      // must never share one message.
      if (availableDatasets === 0 && networkError) {
        return {
          success: false,
          provider: this.name,
          observedAt,
          error: `Tokenomist request failed: ${networkError}`,
          errorCode: "NETWORK_ERROR",
        };
      }
      if (availableDatasets === 0 && httpFailure) {
        return {
          success: false,
          provider: this.name,
          observedAt,
          error: `Tokenomist request failed: HTTP ${httpFailure.status}`,
          errorCode: httpFailure.errorCode,
        };
      }

      return {
        success: availableDatasets > 0,
        provider: this.name,
        observedAt,
        data: {
          ...data,
          availableDatasets,
          totalDatasets: 2,
        },
        ...(availableDatasets === 0 ? { error: "No Tokenomist data available for this token" } : {}),
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        observedAt,
        error: err instanceof Error ? err.message : "Tokenomist fetch failed",
        errorCode: "NETWORK_ERROR",
      };
    }
  }
}

/**
 * Parse Tokenomist provider result into TokenomicsIntelligence.
 * Pure function — no side effects.
 */
export function parseTokenomistResult(
  raw: unknown,
  instrument: string,
  observedAt: number,
): TokenomicsIntelligence {
  const data = isRecord(raw) ? raw : {};
  const availableDatasets = asFiniteNumber(data.availableDatasets) ?? 0;
  const totalDatasets = asFiniteNumber(data.totalDatasets) ?? 2;
  const supply = isRecord(data.supply) ? data.supply : undefined;
  const unlocks = isRecord(data.unlocks) ? data.unlocks : undefined;
  const circulatingSupply = asFiniteNumber(supply?.circulatingSupply);
  const upcomingValue30d = asFiniteNumber(unlocks?.upcomingValue30d);

  return {
    provider: "Tokenomist",
    observedAt,
    freshness: "FRESH",
    quality: availableDatasets >= 2 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No Tokenomist data available" : undefined,

    supply: supply ? {
      circulatingSupply,
      totalSupply: asFiniteNumber(supply.totalSupply),
      circulatingPercent: asFiniteNumber(supply.circulatingPercent),
      reliable: circulatingSupply !== undefined && circulatingSupply > 0,
    } : undefined,

    unlocks: unlocks ? {
      upcomingCount30d: asFiniteNumber(unlocks.upcomingCount30d) ?? 0,
      upcomingValue30d,
      unlockPercentOfCirculating: circulatingSupply && upcomingValue30d
        ? (upcomingValue30d / circulatingSupply) * 100
        : undefined,
      reliable: true,
      summary: typeof unlocks.summary === "string" ? unlocks.summary : undefined,
    } : undefined,

    availableDatasets,
    totalDatasets,
  };
}
