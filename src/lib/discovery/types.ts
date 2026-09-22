/**
 * Phase 158 — Universal Provider Discovery Contract
 *
 * A provider-agnostic contract for instrument discovery.
 *
 * CRITICAL INVARIANTS:
 *   - Discovery is METADATA ONLY. It never carries price, direction,
 *     recommendation, or any live market value. This is enforced
 *     structurally: `DiscoveredInstrument` has no price field.
 *   - Provider-native identity is preserved EXACTLY. `providerInstrumentId`
 *     is the literal id the provider returned and is never rewritten,
 *     canonicalized, or substituted.
 *   - The same economic asset listed on two providers remains TWO distinct
 *     discovered instruments, each owning its provider-native identity.
 *   - A provider failure never deletes another provider's instruments.
 *   - Discovery availability NEVER becomes directional evidence.
 */

import type {
  AssetClass,
  DataCapability,
  InstrumentSubType,
} from "@/lib/data/universal/types";
import type { CatalogFetchReport, DiscoveryCompleteness } from "./completeness";

export type { CatalogFetchReport, DiscoveryCompleteness };

// ═══════════════════════════════════════════════════════════════
// TRADING STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Normalized trading state.
 *
 * Only `TRADING` is eligible for live acquisition. Every other state is
 * explicit — we never guess that an unknown state is tradable.
 */
export type TradingState =
  | "TRADING"
  | "HALTED"
  | "PRE_LAUNCH"
  | "SUSPENDED"
  | "EXPIRED"
  | "UNKNOWN";

/** Only instruments actually open for trading may be acquired. */
export function isAcquirableState(state: TradingState): boolean {
  return state === "TRADING";
}

// ═══════════════════════════════════════════════════════════════
// PRECISION / SIZING
// ═══════════════════════════════════════════════════════════════

/**
 * Provider-reported precision and sizing.
 * Every field is optional — a provider that does not report it leaves it
 * missing rather than receiving a fabricated default.
 */
export interface InstrumentPrecision {
  tickSize?: number;
  lotSize?: number;
  minSize?: number;
  contractValue?: number;
  contractValueCurrency?: string;
}

// ═══════════════════════════════════════════════════════════════
// DISCOVERED INSTRUMENT
// ═══════════════════════════════════════════════════════════════

/**
 * A single instrument discovered from a provider.
 *
 * This is the universal contract every provider discovery adapter must
 * produce, regardless of asset class. It deliberately contains NO price,
 * quote, or directional field.
 */
export interface DiscoveredInstrument {
  /** Provider that returned this instrument. */
  provider: string;
  /** EXACT provider-native instrument id. Never rewritten or substituted. */
  providerInstrumentId: string;
  /** Asset class as classified from provider-native metadata. */
  assetClass: AssetClass;
  /** Provider-native instrument subtype (spot/perp/futures/cash/etc). */
  subType: InstrumentSubType;
  /** Base asset as reported by the provider. */
  baseAsset: string;
  /** Quote/pricing currency as reported by the provider. */
  quoteAsset: string;
  /** Settlement currency when the provider distinguishes it. */
  settleAsset?: string;
  /** Normalized trading state. */
  tradingState: TradingState;
  /** Raw provider state string, retained for diagnostics. */
  providerState?: string;
  /** Capabilities this provider can serve for this instrument. */
  capabilities: DataCapability[];
  /** Provider-reported precision/sizing. */
  precision?: InstrumentPrecision;
  /** Region/venue when the provider reports it. */
  region?: string;
  /** When this metadata was observed. Metadata freshness, NOT price freshness. */
  discoveredAt: number;
}

/**
 * Stable identity key for a discovered instrument.
 *
 * Scoped by provider so that the same symbol on two providers can never
 * collapse into one entry (which would be silent substitution).
 */
export function discoveredInstrumentKey(
  instrument: Pick<DiscoveredInstrument, "provider" | "providerInstrumentId">,
): string {
  return `${instrument.provider}::${instrument.providerInstrumentId}`;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER DISCOVERY ADAPTER
// ═══════════════════════════════════════════════════════════════

export interface ProviderDiscoveryResult {
  provider: string;
  success: boolean;
  discoveredAt: number;
  instruments: DiscoveredInstrument[];
  warnings: string[];
  error?: string;
  /**
   * Catalog-fetch completeness. Optional so older fixtures keep compiling.
   * Adapters always set it. HTTP 200 is not COMPLETE by itself.
   */
  completeness?: DiscoveryCompleteness;
  pagesFetched?: number;
  totalDiscovered?: number;
  catalogs?: CatalogFetchReport[];
}

/**
 * A provider's discovery capability.
 *
 * Adding an asset class means registering an adapter whose provider genuinely
 * lists those instruments — never by appending names to a static list.
 */
export interface ProviderDiscoveryAdapter {
  /** Provider id, matching the provider registry id. */
  provider: string;
  /** Asset classes this adapter can genuinely discover. */
  assetClasses: AssetClass[];
  /** Perform discovery. Must never throw; failures are returned explicitly. */
  discover(now: number): Promise<ProviderDiscoveryResult>;
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATED DISCOVERY
// ═══════════════════════════════════════════════════════════════

export interface UniversalDiscoveryResult {
  discoveredAt: number;
  /** All instruments across every provider that succeeded. */
  instruments: DiscoveredInstrument[];
  /** Per-provider outcome, including failures. */
  providerResults: ProviderDiscoveryResult[];
  /** Providers that failed this cycle. */
  failedProviders: string[];
  /** Providers that succeeded this cycle. */
  succeededProviders: string[];
  /** Aggregated warnings. */
  warnings: string[];
  /** Count of discovered instruments per asset class. */
  assetClassCoverage: Record<AssetClass, number>;
}

export const ALL_ASSET_CLASSES: AssetClass[] = [
  "crypto",
  "forex",
  "equity",
  "commodity",
  "indices",
  "macro",
];

export function emptyAssetClassCoverage(): Record<AssetClass, number> {
  return {
    crypto: 0,
    forex: 0,
    equity: 0,
    commodity: 0,
    indices: 0,
    macro: 0,
  };
}
