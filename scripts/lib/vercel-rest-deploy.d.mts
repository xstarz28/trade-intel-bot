/**
 * Types for `vercel-rest-deploy.mjs`.
 *
 * The REST prebuilt deployment path: the exact request shape the Vercel CLI
 * sends for `deploy --prebuilt`, performed directly so no user/team scope
 * lookup (vercel/vercel#17506) is ever part of the publication.
 */

export const VERCEL_REST_DEPLOY_SCHEMA: string;

export const REST_DEPLOY_STATES: {
  readonly DEPLOYED: "REST_DEPLOY_DEPLOYED";
  readonly ARTIFACT_INVALID: "REST_DEPLOY_ARTIFACT_INVALID";
  readonly PROJECT_READ_FAILED: "REST_DEPLOY_PROJECT_READ_FAILED";
  readonly CREATE_REFUSED: "REST_DEPLOY_CREATE_REFUSED";
  readonly UPLOAD_FAILED: "REST_DEPLOY_UPLOAD_FAILED";
  readonly DEPLOYMENT_FAILED: "REST_DEPLOY_DEPLOYMENT_FAILED";
  readonly DEPLOYMENT_TIMEOUT: "REST_DEPLOY_DEPLOYMENT_TIMEOUT";
  readonly NO_CREDENTIAL: "REST_DEPLOY_NO_CREDENTIAL";
  readonly INCOMPLETE_TARGET: "REST_DEPLOY_INCOMPLETE_TARGET";
};

export type RestDeployState = (typeof REST_DEPLOY_STATES)[keyof typeof REST_DEPLOY_STATES];

/** 0 = deployed, 2 = cannot evaluate (environment), 1 = refused (named). */
export function exitCodeFor(state: RestDeployState): 0 | 1 | 2;

export type OutputFileInfo = {
  /** POSIX path prefixed with `.vercel/output/`. */
  file: string;
  size: number;
  mode: number;
  /** Plain sha1 of the content — the deployments API's wire identity. */
  sha: string;
};

export function collectOutputFiles(options?: {
  outputDir: string;
  prefix?: string;
}): Promise<OutputFileInfo[]>;

export function buildDeploymentRequestBody(options: {
  files: OutputFileInfo[];
  projectName: string;
  projectId: string;
  target?: "preview" | "production";
}): Record<string, unknown>;

export type RestDeployFetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export function restDeployPrebuilt(options?: {
  apiBase?: string;
  orgId: string;
  projectId: string;
  projectName?: string | null;
  target?: "preview" | "production";
  token?: string;
  outputDir: string;
  expectCommit?: string | null;
  fetchImpl?: RestDeployFetchImpl;
  sleepMs?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<{
  schema: string;
  state: RestDeployState;
  problems: string[];
  evidence: string[];
  deploymentUrl: string | null;
  deploymentId: string | null;
}>;
