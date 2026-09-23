/**
 * Type declarations for the Convex access verdict contract (Phase 234).
 *
 * The probe is plain ESM so it can run under bare `node` with no build step,
 * but the guard tests are TypeScript. These declarations give the tests real
 * types instead of an `any` cast, so a change to the verdict shape or the
 * state set surfaces as a type error rather than silently weakening an
 * assertion about a security gate.
 */

export type TransportLayer = "dns" | "tcp" | "tls" | "http";

export type VerdictState =
  | "NOT_REACHABLE"
  | "AUTH_INDETERMINATE"
  | "UNAUTHENTICATED"
  | "CREDENTIALS_REJECTED"
  | "AUTHENTICATED"
  | "CONTROL_PLANE_ONLY";

export type AuthState =
  | "not_attempted"
  | "no_credentials"
  | "credentials_rejected"
  | "authenticated"
  | "unreachable"
  | "server_error";

export type BlockedAt = TransportLayer | "auth" | "deployment-plane" | "unknown" | null;

export const TRANSPORT_LAYERS: TransportLayer[];
export const VERDICT_STATES: VerdictState[];
export const AUTH_EVIDENCE_STATES: VerdictState[];
export const AUTH_STATES: AuthState[];
export const BLOCKED_AT_TOKENS: Exclude<BlockedAt, null>[];
export const EXIT_CODES: Record<VerdictState, number>;

export interface Layer {
  layer: string;
  host: string;
  status: string;
  detail: string;
}

export interface Verdict {
  state: VerdictState;
  blockedAt: BlockedAt;
  classification: string;
  isAuthEvidence: boolean;
  isRevocationEvidence: boolean;
}

export function failedTransportLayer(
  layers: Layer[],
  primaryHost: string,
): TransportLayer | undefined;

export function controlsUp(layers: Layer[]): boolean;

export function computeVerdict(observation: {
  layers: Layer[];
  primaryHost: string;
  reachable: boolean;
  authState: AuthState | string;
  deploymentPlaneReachable: boolean;
}): { verdict: Verdict; exitCode: number };

export function classifyAuthResponse(status: number): { state: AuthState; detail: string };

export function classifyAuthTransportFailure(error: unknown): { state: AuthState; detail: string };

export function validateVerdict(
  verdict: unknown,
  context?: { reachable?: boolean },
): string[];
