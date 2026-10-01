/**
 * Types for `verify-vercel-project-access.mjs`.
 *
 * The verifier performs ONE read-only "project settings" retrieval against a
 * pinned (org, project, host) triple and classifies the outcome. These
 * declarations exist so the suite can pin the named verdicts without pinning
 * an implementation detail.
 */

export const VERCEL_PROJECT_ACCESS_SCHEMA: string;

export const PROJECT_ACCESS_STATES: {
  readonly VERIFIED: "PROJECT_ACCESS_VERIFIED";
  readonly SCOPE_METADATA_RISK: "PROJECT_ACCESS_SCOPE_METADATA_RISK";
  readonly TOKEN_CANNOT_ACCESS_ORG: "TOKEN_CANNOT_ACCESS_ORG";
  readonly PROJECT_NOT_UNDER_ORG: "PROJECT_NOT_UNDER_ORG";
  readonly PROJECT_SETTINGS_UNREACHABLE: "PROJECT_SETTINGS_UNREACHABLE";
  readonly HOST_NOT_ON_PROJECT: "HOST_NOT_ON_PROJECT";
  readonly HOST_POINTS_TO_DIFFERENT_PROJECT: "HOST_POINTS_TO_DIFFERENT_PROJECT";
  readonly DEPLOYMENT_LOOKUP_REFUSED: "DEPLOYMENT_LOOKUP_REFUSED";
  readonly NO_CREDENTIAL: "NO_CREDENTIAL";
  readonly INCOMPLETE_TARGET: "INCOMPLETE_TARGET";
  readonly API_UNREACHABLE: "API_UNREACHABLE";
};

export type ProjectAccessState =
  (typeof PROJECT_ACCESS_STATES)[keyof typeof PROJECT_ACCESS_STATES];

export type ProjectAccessReport = {
  schema: string;
  state: ProjectAccessState;
  problems: string[];
  evidence: string[];
  /** HTTP status of the settings call; `null` when it never completed. */
  httpStatus: number | null;
  /** vercel/vercel#17506 disclosure, present only on SCOPE_METADATA_RISK. */
  scopeNote?: string;
  orgId?: string;
  projectId?: string;
  projectName?: string | null;
  hostUrl?: string | null;
};

/** 0 = verified, 2 = cannot evaluate (environment), 1 = refused (named). */
export function exitCodeFor(state: ProjectAccessState): 0 | 1 | 2;

/**
 * Injectable fetch so the exact pinned situation is reproducible in a test
 * without a network or a credential. Kept structural (not `typeof fetch`) so
 * test doubles need only the fields `vercelGet` consumes.
 */
export type AccessFetchImpl = (
  url: string,
  init: { method: string; signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export function verifyVercelProjectAccess(options?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: AccessFetchImpl;
}): Promise<ProjectAccessReport>;
