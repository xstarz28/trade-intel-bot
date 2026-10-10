/**
 * Tokenomist v4 adapter.
 *
 * Uses the official token list to resolve provider IDs before requesting
 * cliff unlock events. Ambiguous symbols are rejected rather than substituted.
 * Provider failures are non-fatal to the main market analysis.
 */
import type {
  CryptoIntelligenceProvider,
  CryptoIntelligenceProviderResult,
  TokenomicsIntelligence,
} from "./types";
import { toTokenomistSymbol } from "./symbols";

const TOKENOMIST_BASE = "https://api.unlocks.app";
const REQUEST_TIMEOUT_MS = 6_000;
const TOKEN_LIST_TTL_MS = 15 * 60 * 1000;

type TokenListEntry = {
  id?: string;
  name?: string;
  symbol?: string;
  circulatingSupply?: number | null;
  maxSupply?: number | null;
  lastUpdatedDate?: string;
};

// These aliases are used only when the provider's own token-list row confirms
// the symbol. They never bypass provider matching or choose among duplicates.
const TOKEN_ID_HINTS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "polygon",
  UNI: "uniswap",
  ATOM: "cosmos",
  LTC: "litecoin",
  FIL: "filecoin",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  NEAR: "near",
  AAVE: "aave",
};

function asFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class TokenomistAdapter implements CryptoIntelligenceProvider {
  readonly name = "Tokenomist";
  private httpFetch?: typeof fetch;
  private apiKey?: string;
  private tokenList?: TokenListEntry[];
  private tokenListExpiresAt = 0;

  constructor(httpFetch?: typeof fetch, apiKey?: string) {
    this.httpFetch = httpFetch;
    this.apiKey = apiKey;
  }

  supportsInstrument(instrument: string): boolean {
    return toTokenomistSymbol(instrument) !== null;
  }

  private async request(path: string): Promise<any> {
    const fetchFn = this.httpFetch ?? fetch;
    const response = await fetchFn(TOKENOMIST_BASE + path, {
      headers: {
        Accept: "application/json",
        "x-api-key": this.apiKey!,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Tokenomist authentication failed (HTTP " + response.status + ")."), { code: "AUTH_ERROR" });
      }
      if (response.status === 429) {
        throw Object.assign(new Error("Tokenomist rate limit exceeded."), { code: "RATE_LIMIT" });
      }
      throw Object.assign(new Error("Tokenomist HTTP " + response.status + ": " + response.statusText), { code: "API_UNAVAILABLE" });
    }
    const json = await response.json();
    if (json?.status === false || json?.success === false) {
      throw Object.assign(new Error(String(json?.message ?? json?.error ?? "Tokenomist returned an unsuccessful response.")), { code: "API_UNAVAILABLE" });
    }
    return json;
  }

  private async getTokenList(): Promise<TokenListEntry[]> {
    if (this.tokenList && Date.now() < this.tokenListExpiresAt) return this.tokenList;
    const payload = await this.request("/v4/token/list");
    const entries = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.tokens)
        ? payload.tokens
        : [];
    if (!entries.length) throw new Error("Tokenomist returned an empty token list.");
    this.tokenList = entries.filter((row: any) => row && typeof row.id === "string" && typeof row.symbol === "string");
    this.tokenListExpiresAt = Date.now() + TOKEN_LIST_TTL_MS;
    return this.tokenList;
  }

  private resolveToken(symbol: string, entries: TokenListEntry[]): TokenListEntry | undefined {
    const matches = entries.filter((item) => item.symbol?.trim().toUpperCase() === symbol.toUpperCase());
    const hintedId = TOKEN_ID_HINTS[symbol.toUpperCase()];
    if (hintedId) {
      const hintedMatch = matches.find((item) => item.id?.toLowerCase() === hintedId.toLowerCase());
      if (hintedMatch) return hintedMatch;
    }
    // Exact ID match is unambiguous and still must match the requested symbol.
    const exactId = matches.find((item) => item.id?.toLowerCase() === symbol.toLowerCase());
    if (exactId) return exactId;
    return matches.length === 1 ? matches[0] : undefined;
  }

  async fetch(instrument: string): Promise<CryptoIntelligenceProviderResult | null> {
    if (!this.supportsInstrument(instrument)) return null;
    const symbol = toTokenomistSymbol(instrument);
    if (!symbol) return null;
    const observedAt = Date.now();

    if (!this.apiKey?.trim()) {
      return {
        success: false,
        provider: this.name,
        observedAt,
        error: "TOKENOMIST_API_KEY is not configured.",
        errorCode: "AUTH_ERROR",
      };
    }

    try {
      const tokens = await this.getTokenList();
      const token = this.resolveToken(symbol, tokens);
      if (!token?.id) {
        return {
          success: false,
          provider: this.name,
          observedAt,
          error: "Tokenomist token ID could not be resolved unambiguously for " + symbol + ".",
          errorCode: "UNSUPPORTED_ASSET",
        };
      }

      const now = new Date();
      const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const start = utcDate(now);
      const end = utcDate(horizon);
      const eventsPayload = await this.request(
        "/v4/unlock/events?tokenId=" + encodeURIComponent(token.id) +
        "&start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end),
      );
      const rawEvents = Array.isArray(eventsPayload?.data) ? eventsPayload.data : [];
      const upcoming = rawEvents.flatMap((event: any) => {
        const eventTime = new Date(event?.unlockDate ?? "").getTime();
        if (!Number.isFinite(eventTime) || eventTime < now.getTime() || eventTime > horizon.getTime()) return [];
        // v4 documents cliff unlock events; do not treat linear-only events as v4 unlocks.
        const cliff = event?.cliffUnlocks;
        if (!cliff || typeof cliff !== "object") return [];
        const entries = Array.isArray(cliff) ? cliff : [cliff];
        const amount = entries.reduce((sum: number, row: any) => sum + (asFiniteNumber(row?.cliffAmount) ?? 0), 0);
        const usdValue = entries.reduce((sum: number, row: any) => sum + (asFiniteNumber(row?.cliffValue) ?? 0), 0);
        return [{ amount, usdValue }];
      });

      const circulatingSupply = asFiniteNumber(token.circulatingSupply);
      const maxSupply = asFiniteNumber(token.maxSupply);
      const data: Record<string, any> = {
        supply: (circulatingSupply !== undefined || maxSupply !== undefined) ? {
          ...(circulatingSupply !== undefined ? { circulatingSupply } : {}),
          ...(maxSupply !== undefined ? { maxSupply } : {}),
          ...(circulatingSupply !== undefined && maxSupply !== undefined && maxSupply > 0
            ? { circulatingPercent: (circulatingSupply / maxSupply) * 100 }
            : {}),
        } : undefined,
        unlocks: {
          upcomingCount30d: upcoming.length,
          upcomingValue30d: upcoming.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0),
          upcomingUsdValue30d: upcoming.reduce((sum: number, item: { usdValue: number }) => sum + item.usdValue, 0) || undefined,
          summary: upcoming.length > 0
            ? upcoming.length + " cliff unlock event(s) in next 30 days"
            : "No cliff unlock events reported in the next 30 days",
        },
        availableDatasets: 0,
        totalDatasets: 2,
      };
      data.availableDatasets = [data.supply, data.unlocks].filter(Boolean).length;

      return {
        success: data.availableDatasets > 0,
        provider: this.name,
        observedAt,
        data,
        ...(data.availableDatasets === 0 ? { error: "Tokenomist returned no usable tokenomics data." } : {}),
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        observedAt,
        error: err instanceof Error ? err.message : "Tokenomist request failed.",
        errorCode: ["AUTH_ERROR", "RATE_LIMIT", "UNSUPPORTED_ASSET", "API_UNAVAILABLE"].includes(err?.code)
          ? err.code
          : "NETWORK_ERROR",
      };
    }
  }
}

export function parseTokenomistResult(
  data: Record<string, any>,
  _instrument: string,
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
      maxSupply: data.supply.maxSupply,
      totalSupply: data.supply.totalSupply,
      circulatingPercent: data.supply.circulatingPercent,
      reliable: typeof data.supply.circulatingSupply === "number" && data.supply.circulatingSupply > 0,
    } : undefined,
    unlocks: data.unlocks ? {
      upcomingCount30d: data.unlocks.upcomingCount30d ?? 0,
      upcomingValue30d: data.unlocks.upcomingValue30d,
      upcomingUsdValue30d: data.unlocks.upcomingUsdValue30d,
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
