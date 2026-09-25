/**
 * Phase 279 — LIVE crypto-native fundamental acquisition.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Tokenomics (supply, unlock schedule) and protocol/network datasets (chain TVL,
 * fees) have had provider adapters since Phase 41, but the live pipeline never
 * called them: crypto analyses carried prices, derivatives and news only, so the
 * crypto domain of the fundamental assessment had nothing to read and stayed
 * `technical_only` even though real provider evidence was reachable. This module
 * is the single acquisition leg that closes that gap.
 *
 * It is called by the authoritative server-side entry point
 * `src/convex/protectedAnalysis.ts`, whose `crypto-fundamentals` leg resolves
 * to the engine's `cryptoIntelligenceContext` input. There is deliberately no
 * separate client-facing action: the browser must never fetch or assemble
 * provider fundamentals itself.
 *
 * NON-NEGOTIABLE RULES ENCODED HERE
 * ---------------------------------
 *   1. The provider-native identity is used verbatim. The base asset is derived
 *      from the id's OWN structure ("BTC-USDT" → "BTC"); no symbol is ever
 *      substituted and no unknown slug is ever guessed.
 *   2. DeFiLlama mappings come only from this repository's verified table
 *      (`toDefiLlamaId` / `toDefiLlamaIdByBaseAsset`). A token with no verified
 *      entry reports TVL UNAVAILABLE rather than being queried as another token.
 *   3. Nothing is zero-filled, invented or defaulted. A provider that does not
 *      answer produces an explicit leg report and no dataset.
 *   4. Observation times are the PROVIDER's own (`providerResult.observedAt`,
 *      which each adapter derives from the provider payload). The naive local
 *      clock is never used as a provider timestamp.
 *   5. Derivatives are NOT fetched here. The live pipeline already acquires them
 *      through CoinGlass and passes the same payload to the engine; fetching
 *      again would spend quota to produce a second copy of one evidence item.
 */

import type {
  CryptoIntelligenceProviderResult,
  DeFiIntelligence,
  TokenomicsIntelligence,
} from "./types";
import { DeFiLlamaAdapter, parseDeFiLlamaResult } from "./defillama-adapter";
import { TokenomistAdapter, parseTokenomistResult } from "./tokenomist-adapter";
import {
  baseAssetOf,
  toDefiLlamaId,
  toDefiLlamaIdByBaseAsset,
  toTokenomistSymbol,
  toTokenomistSymbolByBaseAsset,
} from "./symbols";
import { getProviderCache } from "../provider-cache-registry";
import type { ProviderCache } from "../provider-cache";

/** One provider leg's outcome — always explicit, never silent. */
export interface CryptoFundamentalLegReport {
  provider: string;
  /** The provider-native identity the leg was asked for. */
  requested: string;
  status: "ok" | "unavailable";
  reason?: string;
  /** Provider observation time, when the provider supplied one. */
  observedAt?: number;
  /** Cache diagnostics, when the leg went through the shared cache. */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
}

export interface CryptoFundamentalsAcquisition {
  /** DeFiLlama dataset (TVL / fees), present only when the provider answered. */
  defi?: DeFiIntelligence;
  /** Tokenomist dataset (supply / unlocks), present only when it answered. */
  tokenomics?: TokenomicsIntelligence;
  legs: CryptoFundamentalLegReport[];
  /**
   * The OLDEST provider observation across the answering legs — the age of the
   * evidence SET. Never a local clock reading.
   */
  observedAt?: number;
  /** Aggregate cache acquisition class across the answering legs. */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
}

export interface CryptoFundamentalsOptions {
  /** Canonical instrument the analysis is about (provenance label). */
  instrument: string;
  /** Routing asset class — authoritative; anything but "crypto" is refused. */
  instrumentType: string;
  /** Provider-native id when the caller has one (defaults to `instrument`). */
  providerInstrumentId?: string;
  /**
   * Test seam. Production omits this and the adapters use global fetch.
   * A suite can therefore drive the REAL production path hermetically.
   */
  http?: typeof fetch;
  /** Test seam. Production uses the process-wide shared cache. */
  cache?: ProviderCache;
  /** Tokenomist API key (env in production). */
  tokenomistApiKey?: string;
}

/** Provider payload wrapper: the raw result plus the provider's own stamp. */
interface RawLeg {
  raw: CryptoIntelligenceProviderResult;
  observedAt: number;
}

/**
 * Acquire crypto-native fundamental datasets for one instrument.
 *
 * Never throws for a provider failure: each leg reports its own outcome and the
 * caller decides what to do with a partial or empty evidence set.
 */
export async function acquireCryptoFundamentals(
  options: CryptoFundamentalsOptions,
): Promise<CryptoFundamentalsAcquisition> {
  const legs: CryptoFundamentalLegReport[] = [];

  // A non-crypto routing class is refused outright: this module must never be
  // the place where an asset class gets guessed.
  if (options.instrumentType !== "crypto") {
    return {
      legs: [
        {
          provider: "crypto-fundamentals",
          requested: options.instrument,
          status: "unavailable",
          reason: `not applicable to ${options.instrumentType} instruments`,
        },
      ],
    };
  }

  const nativeId =
    typeof options.providerInstrumentId === "string" &&
    options.providerInstrumentId.trim().length > 0
      ? options.providerInstrumentId.trim()
      : options.instrument.trim();
  const baseAsset = baseAssetOf(nativeId) ?? baseAssetOf(options.instrument);

  const cache = options.cache ?? getProviderCache();
  const acquisitions: Array<"observed-now" | "observed-shared" | "cache-reused"> = [];
  const observations: number[] = [];

  let tokenomics: TokenomicsIntelligence | undefined;
  let defi: DeFiIntelligence | undefined;

  // ── Tokenomist: supply + unlock schedule ──────────────────────
  const tokenomistSymbol =
    toTokenomistSymbol(nativeId) ?? (baseAsset ? toTokenomistSymbolByBaseAsset(baseAsset) : null);
  if (!tokenomistSymbol) {
    legs.push({
      provider: "Tokenomist",
      requested: nativeId,
      status: "unavailable",
      reason:
        "no base asset could be derived from the instrument identity — no substitution is attempted",
    });
  } else {
    await runLeg({
      provider: "Tokenomist",
      dataset: "crypto-fundamentals",
      nativeId,
      qualifier: tokenomistSymbol,
      cache,
      legs,
      acquisitions,
      observations,
      run: async () => {
        const adapter = new TokenomistAdapter(options.http, options.tokenomistApiKey);
        return adapter.fetch(nativeId, tokenomistSymbol);
      },
      parse: (payload, instrument, observedAt) =>
        parseTokenomistResult(payload, instrument, observedAt),
      accept: (parsed) => {
        tokenomics = parsed;
      },
      failureReason: (parsed) => parsed.failureReason,
      isAvailable: (parsed) => parsed.available,
    });
  }

  // ── DeFiLlama: chain TVL + daily fees ─────────────────────────
  const llamaMapping =
    toDefiLlamaId(nativeId) ?? (baseAsset ? toDefiLlamaIdByBaseAsset(baseAsset) : null);
  if (!llamaMapping) {
    legs.push({
      provider: "DeFiLlama",
      requested: nativeId,
      status: "unavailable",
      reason:
        "this asset has no verified DeFiLlama chain mapping in the repository — no slug is guessed",
    });
  } else {
    await runLeg({
      provider: "DeFiLlama",
      dataset: "crypto-fundamentals",
      nativeId,
      qualifier: llamaMapping.slug,
      cache,
      legs,
      acquisitions,
      observations,
      run: async () => {
        const adapter = new DeFiLlamaAdapter(options.http);
        return adapter.fetch(nativeId, llamaMapping);
      },
      parse: (payload, instrument, observedAt) =>
        parseDeFiLlamaResult(payload, instrument, observedAt),
      accept: (parsed) => {
        defi = parsed;
      },
      failureReason: (parsed) => parsed.failureReason,
      isAvailable: (parsed) => parsed.available,
    });
  }

  const acquisition =
    acquisitions.length > 0 && acquisitions.every((a) => a === "cache-reused")
      ? "cache-reused"
      : acquisitions.includes("observed-shared")
        ? "observed-shared"
        : acquisitions.length > 0
          ? "observed-now"
          : undefined;

  return {
    defi,
    tokenomics,
    legs,
    observedAt: observations.length > 0 ? Math.min(...observations) : undefined,
    acquisition,
  };
}

/**
 * One provider leg: cache-backed fetch + pure parse + explicit outcome.
 * Provider errors are classified into the leg report, never thrown upward.
 */
async function runLeg<TParsed extends { available: boolean; failureReason?: string }>(leg: {
  provider: string;
  dataset: "crypto-fundamentals";
  nativeId: string;
  qualifier: string;
  cache: ProviderCache;
  legs: CryptoFundamentalLegReport[];
  acquisitions: Array<"observed-now" | "observed-shared" | "cache-reused">;
  observations: number[];
  run: () => Promise<CryptoIntelligenceProviderResult | null>;
  parse: (payload: unknown, instrument: string, observedAt: number) => TParsed;
  accept: (parsed: TParsed) => void;
  failureReason: (parsed: TParsed) => string | undefined;
  isAvailable: (parsed: TParsed) => boolean;
}): Promise<void> {
  try {
    const evidence = await leg.cache.fetch<RawLeg>(
      {
        provider: leg.provider.toLowerCase(),
        dataset: leg.dataset,
        instrument: leg.nativeId,
        instrumentType: "crypto",
        qualifier: leg.qualifier,
      },
      async () => {
        const raw = await leg.run();
        if (!raw) return null;
        // One instant for one acquisition: the provider result's own stamp.
        return { data: { raw, observedAt: raw.observedAt }, observedAt: raw.observedAt };
      },
    );

    if (!evidence) {
      leg.legs.push({
        provider: leg.provider,
        requested: leg.nativeId,
        status: "unavailable",
        reason: "the provider returned no dataset for this identity",
      });
      return;
    }

    leg.acquisitions.push(evidence.acquisition);
    const { raw } = evidence.data;

    if (!raw.success) {
      leg.legs.push({
        provider: leg.provider,
        requested: leg.nativeId,
        status: "unavailable",
        reason: raw.error ?? "the provider reported failure",
        observedAt: evidence.observedAt,
        acquisition: evidence.acquisition,
      });
      return;
    }

    leg.observations.push(evidence.observedAt);
    const parsed = leg.parse(raw.data, leg.nativeId, evidence.observedAt);
    leg.accept(parsed);
    const available = leg.isAvailable(parsed);
    leg.legs.push({
      provider: leg.provider,
      requested: leg.nativeId,
      status: available ? "ok" : "unavailable",
      ...(available ? {} : { reason: leg.failureReason(parsed) ?? "no usable dataset fields" }),
      observedAt: evidence.observedAt,
      acquisition: evidence.acquisition,
    });
  } catch (err: unknown) {
    leg.legs.push({
      provider: leg.provider,
      requested: leg.nativeId,
      status: "unavailable",
      reason: err instanceof Error ? err.message : "provider call failed",
    });
  }
}
