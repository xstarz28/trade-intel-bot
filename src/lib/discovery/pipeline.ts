/**
 * Phase 158 — Discovery → Acquisition → Scanner Pipeline
 *
 * The single runtime path from provider discovery to scanner-ready live
 * sources. The UI calls this instead of hand-rolling OKX-specific logic.
 *
 * Flow:
 *   discovery → reconcile lifecycle → rotating batch → native acquisition
 *   → verified snapshot → lifecycle outcomes → expiry → live sources
 *
 * CRITICAL INVARIANTS:
 *   - Only successfully acquired, verified data becomes a live source.
 *   - Failed acquisition never removes an existing live source.
 *   - Provider-native ids pass through untouched.
 *   - No instrument is hardcoded anywhere in this path.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import { selectRotatingDiscoveryBatch } from "@/lib/liveScanner";
import {
  discoveredInstrumentKey,
  type DiscoveredInstrument,
} from "./types";
import { selectAcquirableInstruments } from "./registry";
import {
  applyAcquisitionOutcomes,
  expireStaleInstruments,
  keysToEvict,
  reconcileDiscovery,
  DEFAULT_LIFECYCLE_CONFIG,
  type AcquisitionOutcome,
  type LifecycleConfig,
  type TrackedInstrument,
} from "./lifecycle";

// ═══════════════════════════════════════════════════════════════
// PIPELINE STATE
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryPipelineState {
  tracked: Map<string, TrackedInstrument>;
  /** Live sources keyed by discoveredInstrumentKey. */
  liveSources: Map<string, LiveCandidateSource>;
  /** Rotation cursor so acquisition work spreads over the whole universe. */
  cursor: number;
}

export function createPipelineState(): DiscoveryPipelineState {
  return { tracked: new Map(), liveSources: new Map(), cursor: 0 };
}

// ═══════════════════════════════════════════════════════════════
// ACQUISITION PORT
// ═══════════════════════════════════════════════════════════════

/** What the caller must return for one acquisition attempt. */
export interface NativeAcquisitionResult {
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
  success: boolean;
  /** Present only when success. */
  source?: LiveCandidateSource;
  /** Observation timestamp of the acquired data. */
  observedAt?: number;
}

export type NativeAcquisitionFn = (
  batch: readonly DiscoveredInstrument[],
) => Promise<NativeAcquisitionResult[]>;

// ═══════════════════════════════════════════════════════════════
// PIPELINE STEP
// ═══════════════════════════════════════════════════════════════

export interface PipelineStepInput {
  state: DiscoveryPipelineState;
  discovered: readonly DiscoveredInstrument[];
  succeededProviders: readonly string[];
  acquire: NativeAcquisitionFn;
  /** How many instruments to acquire this cycle. */
  batchSize: number;
  now: number;
  assetClasses?: readonly AssetClass[];
  lifecycleConfig?: LifecycleConfig;
}

export interface PipelineStepResult {
  state: DiscoveryPipelineState;
  /** Live sources ready for the scanner. */
  liveSources: LiveCandidateSource[];
  /** Instruments attempted this cycle. */
  attempted: number;
  /** Successful acquisitions this cycle. */
  acquired: number;
  /** Instruments dropped because they expired or were delisted. */
  evicted: string[];
}

/**
 * Run one discovery→acquisition cycle.
 *
 * Pure with respect to its inputs: given the same state and the same
 * acquisition results, the output is identical.
 */
export async function runDiscoveryPipelineStep(
  input: PipelineStepInput,
): Promise<PipelineStepResult> {
  const {
    state,
    discovered,
    succeededProviders,
    acquire,
    batchSize,
    now,
    assetClasses,
    lifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  } = input;

  // 1. Reconcile discovery into lifecycle state.
  //    A failed provider cannot retire anything here.
  let tracked = reconcileDiscovery({
    tracked: state.tracked,
    discovered,
    succeededProviders,
    now,
  });

  // 2. Choose the acquisition batch from genuinely acquirable instruments.
  const acquirable = selectAcquirableInstruments(
    Array.from(tracked.values())
      .filter((entry) => entry.state !== "DELISTED")
      .map((entry) => entry.instrument),
    "ohlcv",
    assetClasses,
  );

  const { batch, nextCursor } = selectRotatingDiscoveryBatch(
    acquirable,
    state.cursor,
    batchSize,
  );

  // 3. Acquire. Failures are outcomes, never exceptions that lose state.
  let results: NativeAcquisitionResult[] = [];
  if (batch.length > 0) {
    try {
      results = await acquire(batch);
    } catch {
      // Total acquisition failure = every attempted instrument failed.
      results = batch.map((instrument) => ({
        provider: instrument.provider,
        providerInstrumentId: instrument.providerInstrumentId,
        assetClass: instrument.assetClass,
        success: false,
      }));
    }
  }

  // 4. Only verified successes become live sources.
  const liveSources = new Map(state.liveSources);
  const outcomes: AcquisitionOutcome[] = [];

  for (const result of results) {
    const key = discoveredInstrumentKey(result);

    if (result.success && result.source && result.observedAt !== undefined) {
      liveSources.set(key, result.source);
      outcomes.push({ key, success: true, observedAt: result.observedAt });
      continue;
    }

    // Failure: record it, but do NOT touch the retained live source.
    outcomes.push({ key, success: false });
  }

  tracked = applyAcquisitionOutcomes(tracked, outcomes, now);

  // 5. Expire genuinely aged-out data, then evict expired/delisted only.
  tracked = expireStaleInstruments(tracked, now, lifecycleConfig);

  const evicted = keysToEvict(tracked);
  for (const key of evicted) {
    liveSources.delete(key);
    tracked.delete(key);
  }

  return {
    state: { tracked, liveSources, cursor: nextCursor },
    liveSources: Array.from(liveSources.values()),
    attempted: batch.length,
    acquired: results.filter((r) => r.success).length,
    evicted,
  };
}
