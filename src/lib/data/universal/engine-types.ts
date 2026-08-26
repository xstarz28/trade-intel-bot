/**
 * Phase 45 — Production Universal Intelligence Engine Types
 *
 * Extends Phase 44 foundation with:
 *   - Dynamic instrument resolution status
 *   - Provider routing health/status
 *   - Per-provider cache model
 *   - Enhanced evidence with observedAt
 *   - Asset-class intelligence engine results
 *
 * CRITICAL: All intelligence is INFORMATIONAL ONLY.
 * Provider data NEVER becomes directional evidence or decision logic.
 */

import type {
  AssetClass,
  CanonicalInstrument,
  DataCapability,
  EvidenceCategory,
  EvidenceDirection,
  EvidenceQuality,
  EvidenceStrength,
  FreshnessState,
  InstrumentSubType,
  ProviderProfile,
  ProviderRoute,
  Region,
  Exchange,
  UniversalEvidenceItem,
} from "./types";

// ═══════════════════════════════════════════════════════════════
// 1. INSTRUMENT RESOLUTION
// ═══════════════════════════════════════════════════════════════

export type InstrumentStatus =
  | "ACTIVE"           // Registered and mapped to providers
  | "MAPPED"           // Has identity but limited provider support
  | "UNKNOWN"          // Not registered in the universal registry
  | "UNAVAILABLE";     // Registered but all providers unavailable

export interface InstrumentResolution {
  /** Canonical instrument identifier. */
  canonical: string;
  /** Resolution status. */
  status: InstrumentStatus;
  /** Full instrument identity if resolved. */
  instrument?: CanonicalInstrument;
  /** Why resolution failed. */
  failureReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// 2. PROVIDER ROUTING ENGINE
// ═══════════════════════════════════════════════════════════════

export type ProviderStatus =
  | "SUPPORTED"      // Provider supports this capability for this instrument
  | "AVAILABLE"      // Supported AND credentials configured
  | "DEGRADED"       // Available but recently returning errors
  | "RATE_LIMITED"   // Supported but currently rate-limited
  | "UNAVAILABLE"    // Supported but credentials missing or provider down
  | "UNSUPPORTED";   // Provider does not support this capability/instrument

export interface ProviderHealthRecord {
  /** Provider ID. */
  providerId: string;
  /** Last health check timestamp. */
  lastCheckedAt: number;
  /** Current status. */
  status: ProviderStatus;
  /** Number of consecutive failures. */
  consecutiveFailures: number;
  /** Last error message. */
  lastError?: string;
  /** Rate limit reset timestamp (if rate-limited). */
  rateLimitResetAt?: number;
  /** Average response time in ms (rolling). */
  avgResponseTimeMs?: number;
}

export interface EnhancedProviderRoute extends ProviderRoute {
  /** Provider health status. */
  healthStatus: ProviderStatus;
  /** Average response time. */
  avgResponseTimeMs?: number;
  /** Consecutive failures count. */
  consecutiveFailures: number;
}

export interface RoutingResult {
  /** Instrument that was routed. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Requested capability. */
  capability: DataCapability;
  /** All candidate routes sorted by priority. */
  routes: EnhancedProviderRoute[];
  /** Best available route. */
  bestRoute?: EnhancedProviderRoute;
  /** Whether any route is currently available. */
  available: boolean;
  /** Why no route is available. */
  unavailableReason?: string;
  /** Routing timestamp. */
  routedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// 3. CACHE MODEL
// ═══════════════════════════════════════════════════════════════

export interface CacheKey {
  /** Canonical instrument. */
  instrument: string;
  /** Data capability. */
  capability: DataCapability;
  /** Provider ID. */
  providerId: string;
}

export interface CacheEntry<T = unknown> {
  /** Cache key. */
  key: CacheKey;
  /** Cached data. */
  data: T;
  /** When this entry was cached. */
  cachedAt: number;
  /** TTL in milliseconds. */
  ttlMs: number;
  /** Whether this entry is stale. */
  isStale: boolean;
  /** Freshness at time of caching. */
  freshnessAtCache: FreshnessState;
}

export interface CacheConfig {
  /** Default TTL in milliseconds per capability type. */
  defaultTtlMs: number;
  /** TTL overrides by capability. */
  capabilityTtlMs: Partial<Record<DataCapability, number>>;
  /** Maximum cache entries. */
  maxEntries: number;
  /** Whether stale-while-revalidate is allowed. */
  staleWhileRevalidate: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 4. PROVENANCE
// ═══════════════════════════════════════════════════════════════

export interface DataProvenance {
  /** Provider that supplied the data. */
  provider: string;
  /** When the data was observed at the source. */
  observedAt: number;
  /** When we fetched/received it. */
  fetchedAt: number;
  /** Freshness classification. */
  freshness: FreshnessState;
  /** Quality classification. */
  quality: EvidenceQuality;
  /** Whether data is available. */
  available: boolean;
  /** Why data might be unavailable. */
  failureReason?: string;
  /** Instrument the data pertains to. */
  instrument: string;
  /** Instrument identity verified against request. */
  instrumentVerified: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 5. ENHANCED EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface EnhancedEvidenceItem extends UniversalEvidenceItem {
  /** When this evidence was observed. */
  observedAt: number;
  /** When this evidence was assembled. */
  assembledAt: number;
  /** Data provenance. */
  provenance: DataProvenance;
  /** Whether this evidence is from cache. */
  fromCache: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 6. ASSET-CLASS INTELLIGENCE ENGINE RESULTS
// ═══════════════════════════════════════════════════════════════

export interface ForexIntelligenceResult {
  instrument: string;
  assembledAt: number;
  evidence: EnhancedEvidenceItem[];
  provenance: DataProvenance[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  dataFlags: string[];
  analystSummary: string;
}

export interface EquityIntelligenceResult {
  instrument: string;
  assembledAt: number;
  evidence: EnhancedEvidenceItem[];
  provenance: DataProvenance[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  dataFlags: string[];
  analystSummary: string;
}

export interface CommodityIntelligenceResult {
  instrument: string;
  assembledAt: number;
  evidence: EnhancedEvidenceItem[];
  provenance: DataProvenance[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  dataFlags: string[];
  analystSummary: string;
}

export interface CrossAssetIntelligenceResult {
  assembledAt: number;
  evidence: EnhancedEvidenceItem[];
  provenance: DataProvenance[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  dataFlags: string[];
  analystSummary: string;
}

export interface UniversalIntelligenceResult {
  instrument: string;
  assetClass: AssetClass;
  assembledAt: number;
  forex?: ForexIntelligenceResult;
  equity?: EquityIntelligenceResult;
  commodity?: CommodityIntelligenceResult;
  crossAsset?: CrossAssetIntelligenceResult;
  allEvidence: EnhancedEvidenceItem[];
  allProvenance: DataProvenance[];
  doubleCountingWarnings: string[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  dataFlags: string[];
  analystSummary: string;
}
