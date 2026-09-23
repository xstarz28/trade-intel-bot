/**
 * Type declarations for the Evidence D probe classification (Phase 235).
 *
 * The harness is plain ESM so it can run under bare `node` with no build step,
 * but the guard tests are TypeScript. These declarations give the tests real
 * types instead of an `any` cast, so a change to the classification shape or
 * the state set surfaces as a type error rather than silently weakening an
 * assertion about an evidence gate.
 */

export type TransportLayer = "dns" | "tcp" | "tls" | "timeout" | "unknown";

export type ProbeState =
  | "TRANSPORT_BLOCKED"
  | "SERVICE_UNAVAILABLE"
  | "MALFORMED"
  | "UNAUTHENTICATED"
  | "AUTHENTICATED";

export const TRANSPORT_LAYERS: TransportLayer[];
export const PROBE_STATES: ProbeState[];
export const AUTH_EVIDENCE_STATES: ProbeState[];
export const INFRASTRUCTURE_STATES: ProbeState[];

export interface ProbeInput {
  httpStatus?: number;
  transportError?: string | null;
  appStatus?: unknown;
}

export interface ProbeClassification {
  state: ProbeState;
  /** Only set for TRANSPORT_BLOCKED; null once the service answered. */
  layer: TransportLayer | null;
  /** The raw fetch error code, carried for diagnostics; null once answered. */
  transportError: string | null;
  httpStatus: number;
  reached: boolean;
  isAuthEvidence: boolean;
  isRevocationEvidence: boolean;
  detail: string;
}

export function transportLayerOf(code: unknown): TransportLayer;

export function classifyProbeResult(probe?: ProbeInput): ProbeClassification;

export function probeRefusalReason(
  classification: ProbeClassification,
  hostname?: string | null,
): string;

export function validateProbeClassification(classification: unknown): string[];
