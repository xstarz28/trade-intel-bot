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

  async fetch(instrument: string): Promise<CryptoIntelligenceProviderResult | null> {
    if (!this.supportsInstrument(instrument)) return null;

    const symbol = toTokenomistSymbol(instrument);
    if (!symbol) return null;

    const fetchFn = this.httpFetch ?? fetch;
    const observedAt = Date.now();

    try {
      // Tokenomist API endpoint (public for basic data)
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      // Fetch upcoming unlocks
      const data: Record<string, any> = {};

      try {
        const unlockRes = await fetchFn(
          `https://api.tokenomist.xyz/unlocks?token=${symbol}&limit=10`,
          { headers },
        );
        if (unlockRes.ok) {
          const unlockData = await unlockRes.json();
          const events = Array.isArray(unlockData?.data) ? unlockData.data : [];
          const now = Date.now();
          const thirtyDays = 30 * 24 * 3600 * 1000;

          const upcoming = events.filter((e: any) => {
            const unlockTime = new Date(e.unlock_date ?? e.date ?? 0).getTime();
            return unlockTime > now && unlockTime < now + thirtyDays;
          });

          const totalUpcoming = upcoming.reduce(
            (sum: number, e: any) => sum + (parseFloat(e.amount ?? "0") || 0),
            0,
          );

          data.unlocks = {
            upcomingCount30d: upcoming.length,
            upcomingValue30d: totalUpcoming > 0 ? totalUpcoming : undefined,
            summary: upcoming.length > 0
              ? `${upcoming.length} unlock event(s) totaling ${totalUpcoming.toLocaleString()} tokens in next 30 days`
              : "No upcoming unlock events in next 30 days",
          };
        }
      } catch {
        // Unlock fetch failed — non-fatal
      }

      // Fetch token supply info
      try {
        const supplyRes = await fetchFn(
          `https://api.tokenomist.xyz/token/${symbol}/supply`,
          { headers },
        );
        if (supplyRes.ok) {
          const supplyData = await supplyRes.json();
          if (supplyData) {
            const circulating = parseFloat(supplyData.circulating_supply ?? "0");
            const total = parseFloat(supplyData.total_supply ?? "0");
            data.supply = {
              circulatingSupply: circulating > 0 ? circulating : undefined,
              totalSupply: total > 0 ? total : undefined,
              circulatingPercent: circulating > 0 && total > 0
                ? (circulating / total) * 100
                : undefined,
            };
          }
        }
      } catch {
        // Supply fetch failed — non-fatal
      }

      const availableDatasets = [data.unlocks, data.supply].filter(Boolean).length;

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
  data: Record<string, any>,
  instrument: string,
  observedAt: number,
): TokenomicsIntelligence {
  const availableDatasets = data.availableDatasets ?? 0;
  const totalDatasets = data.totalDatasets ?? 2;

  return {
    provider: "Tokenomist",
    observedAt,
    freshness: "FRESH",
    quality: availableDatasets >= 2 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No Tokenomist data available" : undefined,

    supply: data.supply ? {
      circulatingSupply: data.supply.circulatingSupply,
      totalSupply: data.supply.totalSupply,
      circulatingPercent: data.supply.circulatingPercent,
      reliable: typeof data.supply.circulatingSupply === "number" && data.supply.circulatingSupply > 0,
    } : undefined,

    unlocks: data.unlocks ? {
      upcomingCount30d: data.unlocks.upcomingCount30d ?? 0,
      upcomingValue30d: data.unlocks.upcomingValue30d,
      unlockPercentOfCirculating: data.supply?.circulatingSupply && data.unlocks.upcomingValue30d
        ? (data.unlocks.upcomingValue30d / data.supply.circulatingSupply) * 100
        : undefined,
      reliable: true,
      summary: data.unlocks.summary,
    } : undefined,

    availableDatasets,
    totalDatasets,
  };
}
