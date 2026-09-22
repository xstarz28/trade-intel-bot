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
): { score: number; confidence: number; supporting: string[]; conflicting: string[]; missing: string[]; reasons: string[] } {
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
    missingCriticalCount: missing.length,
    conflictingCount: conflicting.length,
    hasVerifiedLivePrice: Boolean(
      snapshot && snapshot.price > 0 && snapshot.quality !== "UNAVAILABLE",
    ),
    hasOhlcv: Boolean(snapshot?.ohlcvAvailable),
    hasExecutionEvidence: snapshot?.spreadBps !== undefined,
    supportingCount: supporting.length,
  });

  // Build primary reasons from top supporting evidence
  const topReasons = supporting.slice(0, 3);

  return { score, confidence, supporting, conflicting, missing, reasons: topReasons };
}

// ═══════════════════════════════════════════════════════════════
// INVALIDATION CONDITIONS
// ═══════════════════════════════════════════════════════════════

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
// OPPORTUNITY KEY — Phase 239 collision prevention, Phase 240 hardening
// ═══════════════════════════════════════════════════════════════

/**
 * Provider-qualified key for an opportunity.
 * Same symbol on different providers must remain distinct.
 * Uses provider::providerInstrumentId when available.
 * Phase 240: collision-safe fallback when providerNative absent/partial,
 * using strongest available identity (provider, assetClass, region, candidate).
 * Never invents provider IDs, never mutates native IDs.
 */
export function opportunityKey(
  opp: Pick<RadarOpportunity, "instrument" | "providerNative" | "provider" | "assetClass" | "region" | "candidateInstrument"> & {
    assetClass?: string;
    region?: string;
    provider?: string;
    candidateInstrument?: string;
  },
): string {
  const sanitize = (s: string) => s.trim();
  const pn = opp.providerNative as { provider?: string; providerInstrumentId?: string } | undefined;
  const asset = (opp as any).assetClass ?? "unknown";
  const region = (opp as any).region ?? "";
  const provider = (opp as any).provider ?? "";
  const candidate = (opp as any).candidateInstrument ?? "";
  const instrument = sanitize(opp.instrument);

  // Preferred: full provider-native identity
  if (pn?.provider && pn?.providerInstrumentId) {
    const p = sanitize(pn.provider);
    const id = sanitize(pn.providerInstrumentId);
    if (p && id) return `${p}::${id}`;
  }
  // Partial: has native id but no provider — include instrument + assetClass to avoid collision
  if (pn?.providerInstrumentId) {
    const id = sanitize(pn.providerInstrumentId);
    if (id) return `${id}::${instrument}::${asset}`;
  }
  // Partial: has provider but no native id — include instrument + assetClass + region
  if (pn?.provider) {
    const p = sanitize(pn.provider);
    if (p) {
      const base = `${p}::${instrument}::${asset}`;
      return region ? `${base}::${sanitize(region)}` : base;
    }
  }
  // Fallback: top-level provider + instrument + assetClass
  if (provider) {
    const p = sanitize(provider);
    if (p) return `${p}::${instrument}::${asset}`;
  }
  // Legacy fallback: assetClass::instrument::region (+ candidate if distinct)
  if (candidate && candidate !== opp.instrument) {
    return `${asset}::${instrument}::${sanitize(candidate)}::${sanitize(region || "global")}`;
  }
  return `${asset}::${instrument}::${sanitize(region || "global")}`;
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
  // Find weakest (highest rank) among required
  let weakest: FreshnessLevel = primary;
  let weakestRank = freshnessRank(primary);
  for (const ev of allRequired) {
    const r = freshnessRank(ev.freshness);
    if (r > weakestRank) {
      weakestRank = r;
      weakest = ev.freshness;
    }
  }
  const details: string[] = [];
  if (required.length > 0) {
    details.push(`required sources: ${allRequired.map((e) => `${e.source}=${e.freshness}`).join(", ")}`);
    details.push(`effective=${weakest} (weakest required)`);
  }
  return { effective: weakest, weakestRequired: weakest, details };
}

function freshnessRank(f: FreshnessLevel): number {
  const order: FreshnessLevel[] = ["FRESH", "DELAYED", "STALE", "UNAVAILABLE"];
  return order.indexOf(f);
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION CLUSTER FILTERING
// ═══════════════════════════════════════════════════════════════

function filterByCorrelation(
  opportunities: RadarOpportunity[],
): RadarOpportunity[] {
  const clusterDisplayCounts = new Map<string, number>();
  const filtered: RadarOpportunity[] = [];

  // Sort by score descending
  const sorted = [...opportunities].sort((a, b) => b.score - a.score);

  for (const opp of sorted) {
    const cluster = CORRELATION_CLUSTERS.find(c => c.instruments.includes(opp.instrument));
    if (!cluster) {
      filtered.push(opp);
      continue;
    }
    const count = clusterDisplayCounts.get(cluster.id) ?? 0;
    if (count < cluster.maxDisplay) {
      clusterDisplayCounts.set(cluster.id, count + 1);
      filtered.push(opp);
    }
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

    // Phase 240: additional evidence freshness classification
    // REQUIRED: price (already primary). OPTIONAL/SUPPORTING: derivatives, fundamentals, COT, EIA, treasury, analyticalDepth
    // For now no additional required freshness beyond price, but we compute effective explicitly
    // If future required evidence has freshness, effective = weakest required
    const additionalFreshness: EvidenceFreshnessInput[] = [];
    // Example placeholder: if derivatives had explicit freshness, we would push with required:false (optional)
    // If a horizon required derivatives, we would push with required:true and effective would be weakest

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

      const lifecycle: OpportunityLifecycle = scored.score >= 50 ? "ACTIVE" : scored.score >= 30 ? "QUALIFIED" : "DISCOVERED";
      const qualityTier = assignQualityTier(
        scored.score,
        scored.confidence,
        candidate?.dataCompleteness ?? "NONE",
        scored.conflicting.length,
        freshness,
      );

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
        supportingEvidence: scored.supporting,
        conflictingEvidence: scored.conflicting,
        missingInformation: scored.missing,
        invalidationConditions: buildInvalidationConditions(source, freshness),
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
