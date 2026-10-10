import type { TokenomicsIntelligence } from "./types";
import { toTokenomistSymbol } from "./symbols";

const UNLOCKS_URL = "https://pattern.plus/api/v1/unlocks.json";
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

type UnlockRow = {
  date?: string;
  token?: string;
  symbol?: string;
  name?: string;
  amount?: number;
  pct_circulating?: number;
  value_usd?: number;
  categories?: string[];
  basis?: string[];
};

type UnlockSnapshot = {
  as_of: string;
  rebuilt?: string;
  data: UnlockRow[];
};

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function dayNumber(day: string): number {
  return new Date(day + "T00:00:00.000Z").getTime();
}

function freshnessFor(snapshot: UnlockSnapshot): TokenomicsIntelligence["freshness"] {
  const sourceTime = Date.parse(snapshot.rebuilt ?? snapshot.as_of);
  if (!Number.isFinite(sourceTime)) return "UNAVAILABLE";
  const age = Date.now() - sourceTime;
  if (age <= 48 * 60 * 60 * 1000) return "FRESH";
  if (age <= 96 * 60 * 60 * 1000) return "DELAYED";
  return "STALE";
}

function unavailable(reason: string, observedAt = Date.now()): TokenomicsIntelligence {
  return {
    provider: "PatternPlus",
    observedAt,
    freshness: "UNAVAILABLE",
    quality: "UNAVAILABLE",
    available: false,
    failureReason: reason,
    availableDatasets: 0,
    totalDatasets: 2,
  };
}

export class PatternPlusUnlockAdapter {
  private fetchFn: typeof fetch;
  private snapshot?: UnlockSnapshot;
  private expiresAt = 0;
  private inflight?: Promise<UnlockSnapshot>;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? fetch;
  }

  private async getSnapshot(): Promise<UnlockSnapshot> {
    if (this.snapshot && Date.now() < this.expiresAt) return this.snapshot;
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const response = await this.fetchFn(UNLOCKS_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error("PatternPlus unlock feed HTTP " + response.status + ": " + response.statusText);
      }
      const payload = await response.json() as Partial<UnlockSnapshot> & { file?: string };
      if (
        payload.file !== "unlocks" ||
        typeof payload.as_of !== "string" ||
        !Array.isArray(payload.data)
      ) {
        throw new Error("PatternPlus unlock feed returned an invalid payload");
      }
      const snapshot: UnlockSnapshot = {
        as_of: payload.as_of,
        rebuilt: typeof payload.rebuilt === "string" ? payload.rebuilt : undefined,
        data: payload.data as UnlockRow[],
      };
      this.snapshot = snapshot;
      this.expiresAt = Date.now() + CACHE_TTL_MS;
      return snapshot;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  async fetch(instrument: string): Promise<TokenomicsIntelligence> {
    const symbol = toTokenomistSymbol(instrument);
    if (!symbol) {
      return unavailable("PatternPlus fallback does not map this instrument to a supported crypto ticker.");
    }

    let snapshot: UnlockSnapshot;
    try {
      snapshot = await this.getSnapshot();
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : "PatternPlus unlock feed request failed.");
    }

    const observedAt = Date.parse(snapshot.rebuilt ?? snapshot.as_of);
    const sourceTimestamp = Number.isFinite(observedAt) ? observedAt : Date.now();
    const freshness = freshnessFor(snapshot);
    if (freshness === "UNAVAILABLE") return unavailable("PatternPlus feed has no valid update timestamp.", sourceTimestamp);

    const allRows = snapshot.data.filter((row) =>
      typeof row.symbol === "string" &&
      row.symbol.trim().toUpperCase() === symbol.toUpperCase() &&
      typeof row.token === "string" &&
      typeof row.date === "string" &&
      Number.isFinite(dayNumber(row.date)) &&
      dayNumber(row.date) >= dayNumber(snapshot.as_of)
    );

    if (allRows.length === 0) {
      return unavailable(
        "No " + symbol + " unlock record is listed in PatternPlus's upcoming 180-day dataset. Missing rows do not prove zero future unlocks.",
        sourceTimestamp,
      );
    }

    const identities = new Set(allRows.map((row) => row.token));
    if (identities.size !== 1) {
      return unavailable(
        "PatternPlus has multiple token identities with ticker " + symbol + "; the fallback rejects this ambiguous ticker.",
        sourceTimestamp,
      );
    }

    const validRows = allRows.filter((row) => {
      const amount = numberValue(row.amount);
      return amount !== undefined && amount > 0;
    }).sort((a, b) => dayNumber(a.date!) - dayNumber(b.date!));

    if (validRows.length === 0) {
      return unavailable("PatternPlus has no valid positive unlock amounts for " + symbol + ".", sourceTimestamp);
    }

    const today = new Date().toISOString().slice(0, 10);
    const horizonDate = new Date(dayNumber(today) + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const next30d = validRows.filter((row) => row.date! >= today && row.date! <= horizonDate);
    const sum = (rows: UnlockRow[], selector: (row: UnlockRow) => unknown): number | undefined => {
      const values = rows.map((row) => numberValue(selector(row)));
      if (values.some((value) => value === undefined)) return undefined;
      return values.reduce((total, value) => total + value!, 0);
    };
    const nextAmount = sum(next30d, (row) => row.amount) ?? 0;
    const nextUsdValues = next30d.map((row) => numberValue(row.value_usd));
    const nextUsd = nextUsdValues.length > 0 && nextUsdValues.every((value) => value !== undefined)
      ? nextUsdValues.reduce((total, value) => total + value!, 0)
      : undefined;
    const nextPctValues = next30d.map((row) => numberValue(row.pct_circulating));
    const pctCirculating = nextPctValues.length > 0 && nextPctValues.every((value) => value !== undefined)
      ? nextPctValues.reduce((total, value) => total + value!, 0)
      : undefined;

    const nearest = validRows[0];
    const sourceBasis = [...new Set(validRows.flatMap((row) =>
      Array.isArray(row.basis) ? row.basis.filter((item): item is string => typeof item === "string") : []
    ))].slice(0, 2);
    const summary = next30d.length > 0
      ? next30d.length + " scheduled unlock event(s) in next 30 days; dataset as of " + snapshot.as_of +
        (sourceBasis.length ? "; basis: " + sourceBasis.join(", ") : "") + "."
      : "No listed unlock rows in next 30 days; next tracked event is " + nearest.date +
        " (" + Number(nearest.amount).toLocaleString("en-US") + " " + symbol + "); dataset as of " + snapshot.as_of + ".";

    return {
      provider: "PatternPlus",
      observedAt: sourceTimestamp,
      freshness,
      quality: freshness === "STALE" ? "STALE" : "DEGRADED",
      available: true,
      unlocks: {
        upcomingCount30d: next30d.length,
        upcomingValue30d: nextAmount,
        ...(nextUsd !== undefined ? { upcomingUsdValue30d: nextUsd } : {}),
        ...(pctCirculating !== undefined ? { unlockPercentOfCirculating: pctCirculating } : {}),
        reliable: freshness === "FRESH" || freshness === "DELAYED",
        summary,
      },
      availableDatasets: 1,
      totalDatasets: 2,
    };
  }
}
