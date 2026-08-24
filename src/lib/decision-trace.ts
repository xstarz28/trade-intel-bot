/**
 * Phase 11 — DECISION TRACE / EXPLAINABILITY MODEL (pure).
 *
 * Single source of truth remains the analysis engine: the engine records
 * layer contributions and gate outcomes WHILE deciding; this module only
 * defines the typed shape, stable serialization and deterministic hashing.
 * No decision logic lives here. No secrets ever enter these structures.
 */

// ── Gate trace ─────────────────────────────────────────────────────

export type GateStatus = "PASS" | "FAIL" | "NOT_APPLICABLE";

export interface GateTraceEntry {
  gateId: string;
  status: GateStatus;
  /** Human-readable rejection reason for FAIL; empty otherwise. */
  reason: string;
  evidenceDomain?: string;
}

/** Canonical gate ids, in evaluation order. */
export const GATE_IDS = [
  "GATE0_DATA_FRESHNESS",
  "GATE1_LIVE_PRICE",
  "GATE2_COMPLETENESS",
  "GATE3_DIRECTIONAL_BIAS",
  "GATE4_CONFLUENCE",
  "GATE5_MATERIAL_OPPOSITION",
  "GATE6_HTF_LTF",
  "GATE6B_MTF_HIERARCHY",
  "GATE6C_STYLE_REQUIREMENTS",
  "GATE6D_EXECUTION_VETO",
  "GATE7_STRUCTURAL_LEVELS",
  "GATE8_RR",
] as const;

// ── Conviction breakdown ───────────────────────────────────────────

export interface ConvictionLayerContribution {
  layer: string;
  /** Actual signed contribution AFTER clamping — exactly what the engine added. */
  contribution: number;
  /** Layer cap magnitude as configured by policy/style. */
  cap: number;
  direction: "supportive" | "opposing" | "neutral";
  reason: string;
}

export interface ConvictionBreakdown {
  base: number;
  layers: ConvictionLayerContribution[];
  rawTotal: number;
  clamp: [number, number];
  final: number;
  band: "Low" | "Medium" | "High" | undefined;
}

// ── Evidence / provenance summaries ────────────────────────────────

export type EvidenceKind = "actual" | "derived" | "proxy" | "unavailable";

export interface EvidenceLayerSummary {
  layer: string;
  available: boolean;
  direction: "bullish" | "bearish" | "neutral" | "unknown";
  contribution: number;
  cap: number;
  reason: string;
  source?: string;
  freshness?: string;
  dataKind?: EvidenceKind;
}

export interface ProvenanceEntry {
  provider: string;
  available: boolean;
  fetchedAt?: number;
  observationDate?: string;
  freshness?: string;
  dataKind?: EvidenceKind;
  failureReason?: string;
}

export interface DecisionTrace {
  version: 1;
  tradingStyle: string;
  inputSnapshotSummary: {
    instrument: string;
    instrumentType: string;
    timeframe: string;
    dataFreshness?: string;
    dataCompleteness: string;
    provider?: string;
  };
  structuralDirection: "long" | "short" | "none";
  biasCalculation: {
    rawBias: "Bullish" | "Bearish" | "Neutral";
    coreWeightedAvg: number;
    vetoApplied: boolean;
    vetoReason?: string;
    finalBias: "Bullish" | "Bearish" | "Neutral";
  };
  evidenceLayers: EvidenceLayerSummary[];
  gates: GateTraceEntry[];
  passedGates: string[];
  failedGates: string[];
  contradictions: Array<{ severity: string; description: string }>;
  informationalFlags: string[];
  criticalFlags: string[];
  convictionBreakdown: ConvictionBreakdown;
  recommendation: "LONG" | "SHORT" | "NO_TRADE";
  tradePlanStatus: { present: boolean; direction?: string; rr?: number };
  provenance: ProvenanceEntry[];
}

// ── Stable serialization + FNV-1a 32-bit hash ──────────────────────

/**
 * Deterministic JSON: object keys sorted recursively; non-finite numbers and
 * undefined dropped. Key-order independent (metamorphic M3).
 */
export function stableSerialize(value: unknown): string {
  const enc = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
    if (Array.isArray(v)) return v.map(enc);
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = enc(obj[k]);
      return out;
    }
    return String(v);
  };
  return JSON.stringify(enc(value));
}

// ── Phase 14 P5 — runtime observability event ──────────────────────
/**
 * Minimal typed telemetry summary derived FROM an already-made decision.
 * DECISION-NEUTRAL by construction: nothing here feeds back into bias,
 * conviction, gates or plans. Allowlisted fields ONLY — never raw provider
 * payloads, never secrets, never user-identifying data.
 */
export interface ObservabilityEvent {
  kind: "analysis.completed";
  fingerprint: string;
  instrument: string;
  instrumentType: string;
  timeframe: string;
  tradingStyle: string;
  recommendation: "LONG" | "SHORT" | "NO_TRADE";
  convictionBand: string;
  failedGateCount: number;
  contradictionSeverities: string[];
  providersAvailable: number;
  providersUnavailable: number;
  freshnessByProvider: Record<string, string>;
  dataCompleteness: string;
}

const OBSERVABILITY_KEYS: readonly (keyof ObservabilityEvent)[] = [
  "kind",
  "fingerprint",
  "instrument",
  "instrumentType",
  "timeframe",
  "tradingStyle",
  "recommendation",
  "convictionBand",
  "failedGateCount",
  "contradictionSeverities",
  "providersAvailable",
  "providersUnavailable",
  "freshnessByProvider",
  "dataCompleteness",
];

/** Exact allowlist exposed for audit/tests — the event may never grow silently. */
export function observabilityAllowlist(): readonly string[] {
  return OBSERVABILITY_KEYS;
}

export function buildObservabilityEvent(trace: DecisionTrace): ObservabilityEvent {
  const freshnessByProvider: Record<string, string> = {};
  for (const p of trace.provenance) {
    freshnessByProvider[p.provider] = p.available ? (p.freshness ?? "available") : "unavailable";
  }
  return {
    kind: "analysis.completed",
    fingerprint: computeDecisionFingerprint(trace),
    instrument: trace.inputSnapshotSummary.instrument,
    instrumentType: trace.inputSnapshotSummary.instrumentType,
    timeframe: trace.inputSnapshotSummary.timeframe,
    tradingStyle: trace.tradingStyle,
    recommendation: trace.recommendation,
    convictionBand:
      trace.recommendation === "NO_TRADE"
        ? "informational"
        : (trace.convictionBreakdown.band ?? "unknown"),
    failedGateCount: trace.failedGates.length,
    contradictionSeverities: trace.contradictions.map((c) => c.severity),
    providersAvailable: trace.provenance.filter((p) => p.available).length,
    providersUnavailable: trace.provenance.filter((p) => !p.available).length,
    freshnessByProvider,
    dataCompleteness: trace.inputSnapshotSummary.dataCompleteness,
  };
}

/** FNV-1a 32-bit — dependency-free, deterministic across runtimes. */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Decision fingerprint: covers ONLY decision-relevant state. Deliberately
 * EXCLUDED: ids, timestamps, fetch latencies, provider failure-reason TEXT,
 * informational flags text, secrets/keys (never stored here anyway).
 */
export function computeDecisionFingerprint(trace: DecisionTrace): string {
  const core = {
    v: trace.version,
    style: trace.tradingStyle,
    completeness: trace.inputSnapshotSummary.dataCompleteness,
    structuralDirection: trace.structuralDirection,
    bias: trace.biasCalculation.finalBias,
    rawBias: trace.biasCalculation.rawBias,
    vetoApplied: trace.biasCalculation.vetoApplied,
    regimeAndSetup: trace.evidenceLayers.filter((l) => l.layer === "_context").map((l) => l.reason),
    gates: trace.gates.map((g) => [g.gateId, g.status]),
    layers: [...trace.convictionBreakdown.layers]
      .map((l): [string, number] => [l.layer, l.contribution])
      .sort((a, b) => a[0].localeCompare(b[0])),
    contradictions: trace.contradictions.map((c) => c.severity).sort(),
    recommendation: trace.recommendation,
    confidenceBand:
      trace.recommendation === "NO_TRADE"
        ? "informational"
        : trace.convictionBreakdown.band,
    plan: trace.tradePlanStatus.present
      ? { d: trace.tradePlanStatus.direction, rrBucket: Math.round((trace.tradePlanStatus.rr ?? 0) * 10) / 10 }
      : null,
  };
  return fnv1a32(stableSerialize(core));
}
