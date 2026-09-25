/**
 * Phase 51 — Autonomous Market Radar Engine
 *
 * Discovery, lifecycle management, diff detection, quality tiering,
 * correlation control, and horizon-specific ranking.
 *
 * INFORMATIONAL_ONLY — never modifies the decision engine.
 * Provider availability NEVER becomes directional evidence.
 */

import type {
  TradingMode,
  InvestorHorizon,
} from "@/lib/recommendation-engine";
import type {
  RadarOpportunity,
  RadarScanConfig,
  RadarScanResult,
  OpportunityDiff,
  OpportunityLifecycle,
  QualityTier,
  FreshnessLevel,
} from "./types";

// Re-export types for consumers
export type { RadarScanResult, RadarScanConfig, RadarOpportunity } from "./types";
// Phase 158: DEFAULT_UNIVERSE is deliberately NOT imported here.
// The radar scans the sources it is given; it never enumerates a static
// instrument list. Only correlation metadata is consumed from this module.
import { CORRELATION_CLUSTERS } from "./universe";
import { buildRadarCandidate, type RadarCandidateSource } from "./candidate-builder";
import {
  evaluateUnifiedConfluence,
  type UnifiedConfluenceEvaluation,
} from "./unified-confluence";
import {
  checkFreshnessEligibility,
  assessFreshness,
  summarizeFreshness,
} from "./freshness";
import { assessEvidenceConfidence } from "./evidence-confidence";
import type { CandidateInput } from "@/lib/recommendation-engine";

// ═══════════════════════════════════════════════════════════════
// QUALITY TIER ASSIGNMENT
// ═══════════════════════════════════════════════════════════════

function assignQualityTier(
  score: number,
  confidence: number,
  dataCompleteness: string,
  conflictingEvidence: number,
  freshness: FreshnessLevel,
): QualityTier {
  // X — Insufficient Data
  if (dataCompleteness === "NONE" || freshness === "UNAVAILABLE") return "X";

  // A — Strong Evidence: high score, high confidence, minimal conflict, fresh
  if (score >= 75 && confidence >= 70 && conflictingEvidence <= 1 && freshness === "FRESH") return "A";

  // B — Good Evidence: decent score, reasonable confidence
  if (score >= 60 && confidence >= 55 && conflictingEvidence <= 2) return "B";

  // C — Mixed Evidence: moderate score or significant conflicts
  if (score >= 40 && dataCompleteness !== "MINIMAL") return "C";

  // D — Weak Evidence
  if (dataCompleteness === "MINIMAL" || score < 40) return "D";

  return "D";
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY SCORING
// ═══════════════════════════════════════════════════════════════

function scoreOpportunity(
  source: RadarCandidateSource,
  horizon: TradingMode | InvestorHorizon,
  candidate?: CandidateInput,
  now?: number,
): {
  score: number;
  confidence: number;
  supporting: string[];
  conflicting: string[];
  missing: string[];
  reasons: string[];
  unified: UnifiedConfluenceEvaluation;
} {
  const snapshot = source.snapshot;
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];
  let score = 50; // ranking baseline — confidence is scored separately

  // ── Data Quality (ranking score only; confidence uses assessEvidenceConfidence) ──
  // Phase 239: use provided timestamp for determinism, not wall clock, to preserve freshness truthfulness
  const evalNow = now ?? Date.now();
  const freshness = snapshot ? assessFreshness(snapshot.observedAt, evalNow) : "UNAVAILABLE";
  if (freshness === "FRESH") { score += 10; supporting.push("fresh market data"); }
  else if (freshness === "DELAYED") { score += 5; supporting.push("delayed data available"); }
  else if (freshness === "STALE") { score -= 10; conflicting.push("stale data"); }
  else { score -= 30; missing.push("market data unavailable"); }

  // ── Market Structure ──
  if (snapshot?.htfBias && snapshot.htfBias !== "unknown") {
    score += 5;
    supporting.push(`HTF bias: ${snapshot.htfBias}`);
  } else {
    missing.push("HTF structure");
  }
  if (snapshot?.mtfAlignment) {
    if (snapshot.mtfAlignment.includes("ALIGNED")) {
      score += 8;
      supporting.push(`MTF aligned: ${snapshot.mtfAlignment}`);
    } else if (snapshot.mtfAlignment === "MIXED") {
      score -= 3;
      conflicting.push("MTF mixed signals");
    }
  } else {
    missing.push("MTF alignment");
  }
  if (snapshot?.marketRegime && snapshot.marketRegime !== "UNKNOWN") {
    score += 3;
    supporting.push(`regime: ${snapshot.marketRegime}`);
  }

  // ── Execution Quality ──
  if (snapshot?.spreadBps !== undefined) {
    if (snapshot.spreadBps < 5) { score += 3; supporting.push("tight spread"); }
    else if (snapshot.spreadBps > 20) { score -= 5; conflicting.push("wide spread"); }
  }

  // ── Asset-class-specific scoring ──
  switch (source.universe.assetClass) {
    case "crypto":
      if (source.derivatives?.fundingRate !== undefined) {
        score += 3;
        supporting.push("funding rate available");
      } else { missing.push("funding rate"); }
      if (source.derivatives?.openInterest !== undefined) {
        score += 2;
        supporting.push("open interest available");
      }
      break;
    case "forex":
      if (source.cot?.netNonCommercial !== undefined) {
        score += 3;
        supporting.push("COT positioning available");
      } else { missing.push("COT positioning"); }
      if (source.treasury?.dxyTrend) {
        score += 2;
        supporting.push(`DXY trend: ${source.treasury.dxyTrend}`);
      } else { missing.push("DXY context"); }
      break;
    case "equity":
      if (source.fundamentals?.peRatio !== undefined) {
        score += 3;
        supporting.push(`P/E: ${source.fundamentals.peRatio.toFixed(1)}`);
      } else { missing.push("P/E valuation"); }
      if (source.fundamentals?.revenueGrowth !== undefined) {
        score += 2;
        supporting.push(`revenue growth: ${(source.fundamentals.revenueGrowth * 100).toFixed(1)}%`);
      }
      break;
    case "commodity":
      if (source.eia?.inventory !== undefined) {
        score += 3;
        supporting.push("inventory data available");
      } else { missing.push("inventory data"); }
      if (source.cot?.netNonCommercial !== undefined) {
        score += 2;
        supporting.push("COT available");
      }
      break;
    case "indices":
      if (source.treasury?.riskRegime) {
        score += 3;
        supporting.push(`risk regime: ${source.treasury.riskRegime}`);
      } else { missing.push("risk regime"); }
      break;
    case "macro":
      if (source.treasury?.tenYearYield !== undefined) {
        score += 5;
        supporting.push("yield data available");
      } else { missing.push("yield data"); }
      if (source.treasury?.dxyTrend) {
        score += 3;
        supporting.push(`DXY: ${source.treasury.dxyTrend}`);
      }
      break;
  }

  // ── Horizon-specific adjustments ──
  const isInvesting = horizon.includes("MONTHS") || horizon.includes("YEARS") || horizon === "1-4_WEEKS";
  if (isInvesting && source.fundamentals) {
    score += 5;
    supporting.push("fundamental data for investment horizon");
  }
  if (!isInvesting && snapshot?.volatility && snapshot.volatility > 0) {
    score += 3;
    supporting.push("volatility context available");
  }

  // Clamp ranking score. Confidence is NOT this baseline-plus-increments
  // path — that clustered every live snapshot around 60.
  score = Math.max(0, Math.min(100, score));

  // ── Phase 55: Analytical Depth (informational only, small weight) ──
  if (source.analyticalDepth) {
    const ad = source.analyticalDepth;
    if (ad.regime && ad.regime !== "UNKNOWN") {
      score += 2;
      supporting.push(`analytical regime: ${ad.regime}`);
    }
    if (ad.dimensionsAvailable && ad.dimensionsAvailable >= 4) {
      score += 3;
      supporting.push(`deep analytical context (${ad.dimensionsAvailable} dimensions)`);
    } else if (ad.dimensionsAvailable !== undefined && ad.dimensionsAvailable < 2) {
      missing.push("deep analytical context");
    }
    if (ad.relativeValue) {
      score += 1;
      supporting.push(`relative value: ${ad.relativeValue}`);
    }
  }

  // ── Phase 277 — Unified Intelligence confluence ──
  // The unified layer's state contributes a FIXED, disclosed delta (see
  // unified-confluence.ts) and can only ever CAP confidence. Two evidence
  // classes never double-count here: an aligned pair adds one confluence
  // confirmation, not a second copy of the technical evidence, and a
  // technical-only read adds nothing at all because its evidence is already
  // scored by the components above.
  const unified = evaluateUnifiedConfluence(source.unified);
  if (unified.present) {
    score += unified.policy.scoreDelta;
    supporting.push(...unified.supporting);
    conflicting.push(...unified.conflicting);
    missing.push(...unified.missing);
  }

  // Confluence may only LOWER confidence. Its supporting statements restate
  // evidence that the components above already counted, so they are excluded
  // from the coherence ratio — two evidence classes never double-count.
  const supportingCountBeforeConfluence = supporting.length - unified.supporting.length;

  const { confidence } = assessEvidenceConfidence({
    freshness,
    dataCompleteness:
      candidate?.dataCompleteness === "FULL" ||
      candidate?.dataCompleteness === "PARTIAL" ||
      candidate?.dataCompleteness === "MINIMAL" ||
      candidate?.dataCompleteness === "NONE"
        ? candidate.dataCompleteness
        : "NONE",
    providerCoverage:
      candidate?.providerCoverage === "FULL" ||
      candidate?.providerCoverage === "PARTIAL" ||
      candidate?.providerCoverage === "MINIMAL" ||
      candidate?.providerCoverage === "NONE"
        ? candidate.providerCoverage
        : "NONE",
    // Phase 277 — a documented absence of fundamental coverage is reported in
    // missingInformation but is NOT a critical gap: an instrument without
    // fundamentals keeps the opportunity quality it had before this layer.
    missingCriticalCount: missing.length - unified.informationalMissing.length,
    conflictingCount: conflicting.length,
    hasVerifiedLivePrice: Boolean(
      snapshot && snapshot.price > 0 && snapshot.quality !== "UNAVAILABLE",
    ),
    hasOhlcv: Boolean(snapshot?.ohlcvAvailable),
    hasExecutionEvidence: snapshot?.spreadBps !== undefined,
    supportingCount: supportingCountBeforeConfluence,
  });

  // Confluence can only LOWER the opportunity's confidence, never raise it:
  // the cap is applied on top of a confidence the confluence itself cannot
  // inflate, so an aligned pair is never "more confident" merely for having
  // two sources.
  const cappedConfidence =
    unified.policy.confidenceCap !== undefined
      ? Math.min(confidence, unified.policy.confidenceCap)
      : confidence;

  // Build primary reasons from top supporting evidence
  const topReasons = supporting.slice(0, 3);

  return {
    score,
    confidence: cappedConfidence,
    supporting,
    conflicting,
    missing,
    reasons: topReasons,
    unified,
  };
}

// ═══════════════════════════════════════════════════════════════
// INVALIDATION CONDITIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Phase 277 — when the unified assessment carries the technical engine's own
 * invalidation, it is added verbatim. Nothing is fabricated: if the engine
 * supplied no level, no level is invented here.
 */
function unifiedInvalidationConditions(source: RadarCandidateSource): string[] {
  const unified = source.unified;
  const invalidation = unified?.technical.invalidation;
  if (!invalidation) return [];
  return [`${invalidation} (technical invalidation, preserved by the engine)`];
}

function buildInvalidationConditions(
  source: RadarCandidateSource,
  freshness: FreshnessLevel,
): string[] {
  const conditions: string[] = [];
  conditions.push(`price structure invalidation`);
  if (freshness !== "FRESH") {
    conditions.push(`freshness expiration at current level`);
  }
  if (source.snapshot?.spreadBps && source.snapshot.spreadBps > 20) {
    conditions.push(`spread deterioration beyond ${source.snapshot.spreadBps} bps`);
  }
  if (source.universe.assetClass === "crypto" && source.derivatives) {
    conditions.push(`derivatives data becomes unavailable`);
  }
  conditions.push(`provider failure for critical data`);
  conditions.push(`evidence conflict increase`);
  return conditions;
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY KEY — Phase 239 collision prevention, Phase 240 hardening, Phase 241 canonical
// ═══════════════════════════════════════════════════════════════
// provider:: pattern preserved via canonicalOpportunityKey — radar and UI share single source

import { canonicalOpportunityKey as canonicalKey } from "./opportunity-identity";

/**
 * Provider-qualified key for an opportunity.
 * Phase 241: delegates to canonicalOpportunityKey single source of truth.
 * Preserves Phase240 precedence, never invents IDs, never mutates native IDs.
 */
export function opportunityKey(
  opp: Pick<RadarOpportunity, "instrument" | "providerNative" | "provider" | "assetClass" | "region" | "candidateInstrument"> & {
    assetClass?: string;
    region?: string;
    provider?: string;
    candidateInstrument?: string;
  },
): string {
  return canonicalKey({
    instrument: opp.instrument,
    providerNative: opp.providerNative as any,
    provider: (opp as any).provider,
    assetClass: (opp as any).assetClass,
    region: (opp as any).region,
    candidateInstrument: (opp as any).candidateInstrument,
  });
}

/**
 * Phase 240 — numerical validation helpers.
 * Domain validity: price>0, volume>=0, bid>0, ask>0, ask>=bid, spread>=0, volatility>=0, change finite.
 * Never fabricate replacements.
 */
export function isValidPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
export function isValidVolume(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
export function isValidBidAsk(bid: unknown, ask: unknown): boolean {
  if (typeof bid !== "number" || typeof ask !== "number") return false;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return false;
  if (bid <= 0 || ask <= 0) return false;
  if (ask < bid) return false; // bid > ask invalid
  return true;
}
export function isValidSpreadBps(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
export function isValidChange(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function isValidVolatility(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
export function isValidCorrelation(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 1;
}

/**
 * Phase 240 — multi-evidence freshness aggregation.
 *
 * Classification (existing architecture semantics):
 * - REQUIRED: price/snapshot (must be present for opportunity to be valid)
 * - OPTIONAL/SUPPORTING: derivatives (funding, OI), fundamentals (P/E), COT, EIA, treasury, analyticalDepth
 *   Missing supporting → missingInformation, confidence degraded, but does NOT affect effective freshness
 * - INFORMATIONAL: region, provider coverage, etc.
 *
 * For REQUIRED evidence, effective freshness = weakest (max rank) among required.
 * For OPTIONAL, preserve primary freshness, track missing/stale separately.
 */
export type EvidenceFreshnessInput = {
  freshness: FreshnessLevel;
  required: boolean;
  source: string; // e.g. "price", "derivatives", "cot"
};

export function computeEffectiveFreshness(
  primary: FreshnessLevel,
  additional: EvidenceFreshnessInput[] = [],
): { effective: FreshnessLevel; weakestRequired: FreshnessLevel; details: string[] } {
  const required = additional.filter((e) => e.required);
  const allRequired = [{ freshness: primary, required: true, source: "price" }, ...required];
  // Find weakest (highest rank) among required — UNKNOWN treated as UNAVAILABLE
  let weakest: FreshnessLevel = primary === ("UNKNOWN" as any) ? "UNAVAILABLE" : primary;
  let weakestRank = freshnessRank(primary);
  for (const ev of allRequired) {
    const r = freshnessRank(ev.freshness);
    if (r > weakestRank) {
      weakestRank = r;
      // Normalize UNKNOWN → UNAVAILABLE for effective output
      weakest = ev.freshness === ("UNKNOWN" as any) ? "UNAVAILABLE" : (ev.freshness as FreshnessLevel);
    }
  }
  // If primary was UNKNOWN, normalize
  if ((primary as any) === "UNKNOWN") weakest = "UNAVAILABLE";
  const details: string[] = [];
  if (required.length > 0) {
    details.push(`required sources: ${allRequired.map((e) => `${e.source}=${e.freshness}`).join(", ")}`);
    details.push(`effective=${weakest} (weakest required)`);
  }
  return { effective: weakest, weakestRequired: weakest, details };
}

function freshnessRank(f: FreshnessLevel | "UNKNOWN"): number {
  // UNKNOWN is not trustworthy — treat as UNAVAILABLE for required weakest semantics
  const order = ["FRESH", "DELAYED", "STALE", "UNKNOWN", "UNAVAILABLE"] as const;
  const idx = (order as readonly string[]).indexOf(f as string);
  if (idx === -1) return 4; // unknown string → treat as UNAVAILABLE
  // Map UNKNOWN to same rank as UNAVAILABLE for effective freshness (never FRESH)
  if (f === "UNKNOWN") return 4;
  return idx;
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION CLUSTER FILTERING — Phase 241 hardening
// ═══════════════════════════════════════════════════════════════

/**
 * Derive correlation grouping key from opportunity metadata.
 * Uses assetClass:baseAsset pattern (e.g., crypto:BTC) to group logically related instruments
 * without hardcoding ticker lists. Preserves provider-native identity separation.
 */
function deriveOpportunityCorrelationKey(opp: RadarOpportunity): string | undefined {
  // Prefer explicit correlation if available via candidateInstrument or instrument parsing
  const instrument = opp.instrument;
  if (!instrument) return undefined;
  // Extract base asset: split by /, -, :, etc., first token uppercased
  const base = instrument.split(/[/:\-]/)[0]?.trim().toUpperCase();
  if (!base) return `${opp.assetClass}:UNKNOWN`;
  return `${opp.assetClass}:${base}`;
}

function filterByCorrelation(
  opportunities: RadarOpportunity[],
): RadarOpportunity[] {
  const clusterDisplayCounts = new Map<string, number>();
  const filtered: RadarOpportunity[] = [];
  const seenKeys = new Set<string>(); // prevent Map collision via canonical identity

  // Sort by score descending
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);

  for (const opp of sorted) {
    const canonicalKey = opportunityKey(opp);
    // Prevent duplicate canonical identity from entering twice (Map collision prevention)
    if (seenKeys.has(canonicalKey)) continue;
    seenKeys.add(canonicalKey);

    // Phase 241: correlation grouping uses derived key + static clusters, but identity remains distinct
    // First try static CORRELATION_CLUSTERS (canonical names), then derived grouping
    const cluster = CORRELATION_CLUSTERS.find(c => c.instruments.includes(opp.instrument));
    let groupId: string | undefined;
    if (cluster) {
      groupId = cluster.id;
    } else {
      // For discovered provider-native instruments, derive grouping key
      const derived = deriveOpportunityCorrelationKey(opp);
      if (derived) {
        // Use derived key as group id for display cap purposes, but with higher maxDisplay to avoid unfair collapse
        // For distinct provider-native instruments sharing same logical asset, we allow up to 2 per group (not 1) to avoid removing one provider simply because another shares symbol
        groupId = derived;
      }
    }

    if (!groupId) {
      filtered.push(opp);
      continue;
    }

    const count = clusterDisplayCounts.get(groupId) ?? 0;
    // Determine maxDisplay: for static clusters use defined maxDisplay, for derived use 2 to prevent unfair collapse of distinct providers
    const maxDisplay = cluster ? cluster.maxDisplay : 2;
    if (count < maxDisplay) {
      clusterDisplayCounts.set(groupId, count + 1);
      filtered.push(opp);
    }
    // else: correlated exposure limit reached — filtered out but not merged, identity preserved
  }

  return filtered;
}

// ═══════════════════════════════════════════════════════════════
// RADAR ENGINE
// ═══════════════════════════════════════════════════════════════

export interface RadarState {
  /** Previous scan opportunities keyed by provider-qualified instrument. */
  previous: Map<string, RadarOpportunity>;
  /** Timestamp of last scan. */
  lastScanAt: number;
}

export function scanRadar(
  sources: RadarCandidateSource[],
  config: RadarScanConfig,
  previousState?: RadarState,
  now?: number,
): RadarScanResult {
  const startTime = Date.now();
  const timestamp = now ?? config.now ?? Date.now();
  const maxResults = config.maxResults ?? 10;

  // Filter by asset class if configured
  let filteredSources = sources;
  if (config.assetClasses && config.assetClasses.length > 0) {
    filteredSources = sources.filter(s => config.assetClasses!.includes(s.universe.assetClass));
  }

  // Build candidates from sources
  const candidates = filteredSources.map(s => buildRadarCandidate(s, timestamp));

  // Score each candidate per horizon
  const allHorizonOpps = new Map<TradingMode | InvestorHorizon, RadarOpportunity[]>();
  const freshnessLevels: FreshnessLevel[] = [];
  let totalWithLiveData = 0;
  let totalInsufficient = 0;
  const providerErrors: string[] = [];

  // Initialize empty horizon arrays for all requested horizons
  for (const horizon of config.horizons) {
    if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
  }

  for (const source of filteredSources) {
    // Phase 240: primary freshness from price/snapshot (REQUIRED)
    const primaryFreshness = source.snapshot
      ? assessFreshness(source.snapshot.observedAt, timestamp)
      : "UNAVAILABLE";

    // Phase 241: additional evidence freshness contract — explicit inventory
    // Classification: REQUIRED=price only, OPTIONAL/SUPPORTING=derivatives, fundamentals, COT, EIA, treasury, analyticalDepth
    // Each additional source must have explicit freshness OR be marked UNAVAILABLE, never silently FRESH
    const additionalFreshness: EvidenceFreshnessInput[] = [];

    // From explicit additionalEvidence array (new contract)
    if (source.additionalEvidence && source.additionalEvidence.length > 0) {
      for (const ev of source.additionalEvidence) {
        // If no trustworthy timestamp, freshness must be UNAVAILABLE per contract, never FRESH
        const f = ev.freshness ?? "UNAVAILABLE";
        // Future timestamp check: assessFreshness would return UNAVAILABLE for future, so we preserve that
        // Do not silently promote UNKNOWN to FRESH
        const effectiveF = f === "FRESH" && ev.observedAt === undefined && ev.timestampProvenance === "UNKNOWN" ? "UNAVAILABLE" : f;
        additionalFreshness.push({
          freshness: effectiveF,
          required: ev.required,
          source: ev.source,
        });
      }
    }

    // From legacy optional fields that may carry freshness (backward compat)
    const legacySources: Array<{ obj: any; name: string }> = [
      { obj: source.derivatives, name: "derivatives" },
      { obj: source.fundamentals, name: "fundamentals" },
      { obj: source.cot, name: "cot" },
      { obj: source.eia, name: "eia" },
      { obj: source.treasury, name: "treasury" },
      { obj: source.analyticalDepth, name: "analyticalDepth" },
    ];
    for (const { obj, name } of legacySources) {
      if (obj && typeof obj === "object" && (obj as any).freshness) {
        const f = (obj as any).freshness as FreshnessLevel;
        // Validate: if observedAt missing and provenance UNKNOWN, cannot be FRESH
        const obs = (obj as any).observedAt;
        const prov = (obj as any).timestampProvenance;
        const effectiveF = f === "FRESH" && obs === undefined && prov === "UNKNOWN" ? "UNAVAILABLE" : f;
        // Only add if not already present from additionalEvidence to avoid double count
        if (!additionalFreshness.some((e) => e.source === name)) {
          additionalFreshness.push({
            freshness: effectiveF,
            required: false, // per classification, all additional are optional/supporting
            source: name,
          });
        }
      }
    }

    const { effective: freshness } = computeEffectiveFreshness(primaryFreshness, additionalFreshness);

    freshnessLevels.push(freshness);
    if (freshness === "FRESH" || freshness === "DELAYED") totalWithLiveData++;
    // Phase 239: use provider-qualified lookup for completeness to avoid collision on same symbol different providers
    const completeness = candidates.find(c => {
      const native = source.universe.providerNative;
      if (native && c.providerNative) {
        return c.providerNative.provider === native.provider && c.providerNative.providerInstrumentId === native.providerInstrumentId;
      }
      return c.instrument === source.universe.instrument;
    })?.dataCompleteness;
    if (completeness === "NONE" || completeness === "MINIMAL") totalInsufficient++;

    for (const horizon of config.horizons) {
      // Freshness gate check
      const eligibility = checkFreshnessEligibility(freshness, freshness === "FRESH" || freshness === "DELAYED", horizon);

      // Phase 239 — evidence traceability shared across eligible/ineligible paths
      const providerNative = source.universe.providerNative;
      const snap = source.snapshot;
      const observedAt = snap?.observedAt;
      const acquiredAt = snap?.acquiredAt;
      const timestampProvenance = snap?.timestampProvenance;
      const provider = snap?.provider ?? providerNative?.provider;

      const buildEvidence = () => {
        if (!snap) return undefined;
        const price = snap.price;
        // Phase 240: full numerical validation — price must be valid, not zero/negative/NaN/Infinity
        if (!isValidPrice(price)) return undefined;
        // Validate derived fields individually, never fabricate
        const derived: { spreadBps?: number; volatility?: number; change24h?: number } = {};
        if (snap.spreadBps !== undefined) {
          if (isValidSpreadBps(snap.spreadBps)) derived.spreadBps = snap.spreadBps;
        }
        if (snap.volatility !== undefined) {
          if (isValidVolatility(snap.volatility)) derived.volatility = snap.volatility;
        }
        if (snap.change24h !== undefined) {
          if (isValidChange(snap.change24h)) derived.change24h = snap.change24h;
        }
        // volume validation if present (volume24h)
        if ((snap as any).volume24h !== undefined) {
          if (!isValidVolume((snap as any).volume24h)) {
            // invalid volume → treat as missing, not invented; evidence still valid for price
          }
        }
        return {
          price,
          ...(observedAt !== undefined ? { observedAt } : {}),
          ...(acquiredAt !== undefined ? { acquiredAt } : {}),
          ...(timestampProvenance ? { timestampProvenance } : {}),
          freshness,
          provider: provider ?? "unknown",
          providerInstrumentId: providerNative?.providerInstrumentId ?? snap.instrument,
          derived: Object.keys(derived).length > 0 ? derived : undefined,
        };
      };

      if (!eligibility.eligible) {
        // Still record as opportunity with EXPIRED/INVALIDATED lifecycle
        const opp: RadarOpportunity = {
          instrument: source.universe.instrument,
          assetClass: source.universe.assetClass,
          region: source.universe.region,
          // Provider-native identity travels with the opportunity, unchanged.
          ...(providerNative ? { providerNative } : {}),
          ...(provider ? { provider } : {}),
          ...(observedAt !== undefined ? { observedAt } : {}),
          ...(acquiredAt !== undefined ? { acquiredAt } : {}),
          ...(timestampProvenance ? { timestampProvenance } : {}),
          horizon,
          evidence: buildEvidence(),
          lifecycle: "EXPIRED",
          qualityTier: "X",
          score: 0,
          confidence: 0,
          dataCompleteness: candidates.find(c => {
            const n = source.universe.providerNative;
            if (n && c.providerNative) {
              return c.providerNative.provider === n.provider && c.providerNative.providerInstrumentId === n.providerInstrumentId;
            }
            return c.instrument === source.universe.instrument;
          })?.dataCompleteness ?? "NONE",
          freshness,
          supportingEvidence: [],
          conflictingEvidence: [eligibility.reason],
          missingInformation: ["data freshness insufficient for this horizon"],
          invalidationConditions: [],
          primaryReasons: [],
          providerCoverage: "NONE",
          lastUpdated: timestamp,
          candidateInstrument: source.universe.instrument,
          dependencyGroups: [],
        };

        if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
        allHorizonOpps.get(horizon)!.push(opp);
        continue;
      }

      const candidate = candidates.find((c) => {
        const native = source.universe.providerNative;
        if (native && c.providerNative) {
          return (
            c.providerNative.provider === native.provider &&
            c.providerNative.providerInstrumentId === native.providerInstrumentId
          );
        }
        return c.instrument === source.universe.instrument;
      });
      const scored = scoreOpportunity(source, horizon, candidate, timestamp);

      // ── Phase 277 — a combined directional call is presented as "clean"
      // only when the unified layer justified it. When it did not (conflict,
      // mixed, insufficient, fundamental-only, or a directional pair with no
      // invalidation) the opportunity is still shown, but its lifecycle and
      // quality tier are capped so it cannot read as an actionable signal,
      // and the reason is stated in the evidence lists.
      const confluence = scored.unified;
      const baseLifecycle: OpportunityLifecycle =
        scored.score >= 50 ? "ACTIVE" : scored.score >= 30 ? "QUALIFIED" : "DISCOVERED";
      const lifecycle: OpportunityLifecycle = confluence.blocksCleanActionability
        ? baseLifecycle === "ACTIVE"
          ? "QUALIFIED"
          : baseLifecycle
        : baseLifecycle;

      const rawQualityTier = assignQualityTier(
        scored.score,
        scored.confidence,
        candidate?.dataCompleteness ?? "NONE",
        scored.conflicting.length,
        freshness,
      );
      // Capped at C — "Mixed Evidence". A — Strong / B — Good are reserved for
      // opportunities whose combined conclusion the unified layer supported.
      const qualityTier: QualityTier =
        confluence.blocksCleanActionability && (rawQualityTier === "A" || rawQualityTier === "B")
          ? "C"
          : rawQualityTier;

      const conflictingEvidence = [...scored.conflicting];
      const supportingEvidence = [...scored.supporting];
      const missingInformation = [...scored.missing];
      if (confluence.blocksCleanActionability) {
        conflictingEvidence.push(
          `unified intelligence did not justify a combined directional conclusion — ${confluence.actionabilityReason}`,
        );
      } else if (confluence.present) {
        supportingEvidence.push(`unified assessment: ${confluence.explanation}`);
      }

      // Phase 55: Build analytical context summary for the opportunity
      const ad = source.analyticalDepth;
      const analyticalContext = ad ? {
        regime: ad.regime,
        primarySupport: ad.supportingEvidence?.[0],
        primaryConflict: ad.conflictingEvidence?.[0],
        keyRisk: ad.missingInformation?.[0],
        missingCritical: ad.missingInformation?.slice(0, 2).join('; '),
        relativeValue: ad.relativeValue,
        dimensionsAvailable: ad.dimensionsAvailable,
        dimensionsTotal: ad.dimensionsTotal,
      } : undefined;

      const opp: RadarOpportunity = {
        instrument: source.universe.instrument,
        assetClass: source.universe.assetClass,
        region: source.universe.region,
        // Provider-native identity travels with the opportunity, unchanged.
        ...(providerNative ? { providerNative } : {}),
        ...(provider ? { provider } : {}),
        ...(observedAt !== undefined ? { observedAt } : {}),
        ...(acquiredAt !== undefined ? { acquiredAt } : {}),
        ...(timestampProvenance ? { timestampProvenance } : {}),
        horizon,
        evidence: buildEvidence(),
        lifecycle,
        qualityTier,
        score: scored.score,
        confidence: scored.confidence,
        dataCompleteness: candidate?.dataCompleteness ?? "NONE",
        freshness,
        supportingEvidence,
        conflictingEvidence,
        missingInformation,
        invalidationConditions: [
          ...buildInvalidationConditions(source, freshness),
          ...unifiedInvalidationConditions(source),
        ],
        // Phase 277 — the unified assessment travels with the opportunity,
        // including the technical engine's own invalidation, both providers'
        // native identities and the fiscal reporting period.
        ...(confluence.present
          ? {
              unified: {
                state: source.unified!.state,
                technicalBias: source.unified!.technical.bias,
                fundamentalState: source.unified!.fundamental.state,
                agreement: source.unified!.confluence.agreement,
                confidence: source.unified!.confidence,
                actionable: confluence.actionable,
                actionabilityReason: confluence.actionabilityReason,
                combinedDirectional: confluence.policy.combinedDirectional,
                blocksCleanActionability: confluence.blocksCleanActionability,
                explanation: confluence.explanation,
                ...(confluence.invalidation ? { invalidation: confluence.invalidation } : {}),
                provenance: confluence.provenance,
              },
            }
          : {}),
        primaryReasons: scored.reasons,
        providerCoverage: candidate?.providerCoverage ?? "NONE",
        lastUpdated: timestamp,
        candidateInstrument: source.universe.instrument,
        dependencyGroups: [],
        analyticalContext,
      };

      if (!allHorizonOpps.has(horizon)) allHorizonOpps.set(horizon, []);
      allHorizonOpps.get(horizon)!.push(opp);
    }
  }

  // For each horizon: sort, filter by correlation, limit
  const results = new Map<TradingMode | InvestorHorizon, RadarOpportunity[]>();
  const allOpps: RadarOpportunity[] = [];

  for (const [horizon, opps] of allHorizonOpps) {
    const sorted = [...opps].sort((a, b) => b.score - a.score);
    const filtered = filterByCorrelation(sorted);
    const limited = filtered.slice(0, maxResults);
    results.set(horizon, limited);
    allOpps.push(...limited);
  }

  // Detect diffs from previous state — Phase 239: use provider-qualified key to prevent collision
  const diffs: OpportunityDiff[] = [];
  if (previousState) {
    const currentMap = new Map<string, RadarOpportunity>();
    for (const opp of allOpps) {
      const k = opportunityKey(opp);
      if (!currentMap.has(k)) currentMap.set(k, opp);
    }

    // Check appeared/disappeared/changed — keys are provider-qualified
    const allKeys = new Set([
      ...previousState.previous.keys(),
      ...currentMap.keys(),
    ]);

    for (const key of allKeys) {
      const prev = previousState.previous.get(key);
      const curr = currentMap.get(key);
      const instrument = curr?.instrument ?? prev?.instrument ?? key;
      const changes: string[] = [];

      if (!prev && curr) {
        diffs.push({ instrument, changes: ["opportunity appeared"], appeared: true, disappeared: false });
      } else if (prev && !curr) {
        diffs.push({ instrument, changes: ["opportunity disappeared"], appeared: false, disappeared: true });
      } else if (prev && curr) {
        const scoreDelta = curr.score - prev.score;
        const confDelta = curr.confidence - prev.confidence;
        if (Math.abs(scoreDelta) > 5) changes.push(`score ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`);
        if (Math.abs(confDelta) > 5) changes.push(`confidence ${confDelta > 0 ? "+" : ""}${confDelta}`);
        if (prev.lifecycle !== curr.lifecycle) changes.push(`lifecycle ${prev.lifecycle} → ${curr.lifecycle}`);
        if (prev.qualityTier !== curr.qualityTier) changes.push(`tier ${prev.qualityTier} → ${curr.qualityTier}`);
        if (changes.length > 0) {
          diffs.push({
            instrument,
            changes,
            scoreDelta,
            confidenceDelta: confDelta,
            lifecycleChanged: prev.lifecycle !== curr.lifecycle,
            qualityTierChanged: prev.qualityTier !== curr.qualityTier,
            appeared: false,
            disappeared: false,
          });
        }
      }
    }
  }

  const fs = summarizeFreshness(freshnessLevels);

  return {
    results,
    diffs,
    totalScanned: filteredSources.length,
    totalWithLiveData,
    totalInsufficient,
    freshCount: fs.fresh,
    delayedCount: fs.delayed,
    staleCount: fs.stale,
    unavailableCount: fs.unavailable,
    timestamp,
    durationMs: Date.now() - startTime,
    providerErrors,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build state from result for next diff
// ═══════════════════════════════════════════════════════════════

export function buildRadarState(result: RadarScanResult): RadarState {
  const previous = new Map<string, RadarOpportunity>();
  for (const [, opps] of result.results) {
    for (const opp of opps) {
      const k = opportunityKey(opp);
      if (!previous.has(k)) {
        previous.set(k, opp);
      }
    }
  }
  return { previous, lastScanAt: result.timestamp };
}
