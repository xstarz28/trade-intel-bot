/**
 * Types for `publish-frontend.mjs`.
 *
 * The publisher reads the token from the environment only (never `argv`), so it
 * runs the same way in a workflow and in an operator's shell. These declarations
 * exist so the suite can pin its decision points — the order of verify → upload
 * → alias → fetch, the artifact fingerprint, and the host CLI's URL parsing —
 * without pinning an implementation detail.
 */

export const PUBLISH_FRONTEND_SCHEMA: string;

export type RunResult = { status: number; stdout: string; stderr: string };

/** Run a command without a shell, returning its status and captured output. */
export function run(
  command: string,
  args: string[],
  options?: { env?: Record<string, string | undefined>; cwd?: string },
): RunResult;

export type ArtifactFingerprint = {
  /** sha256 of `dist/build-info.json` — what the published check compares. */
  sha256: string;
  /** Comma-separated content-hashed entry bundles the page references. */
  entry: string;
  buildInfo: Record<string, unknown>;
};

/** `null` when the artifact has no readable provenance. */
export function artifactFingerprint(distDir?: string): ArtifactFingerprint | null;

/** The https deployment URL on the last line of the host CLI's output. */
export function deploymentUrlFrom(stdout: string): string | null;

export type ResolvedIdentifiers = {
  orgId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  matchedBy?: string | null;
  domains?: string[];
  hostUrl?: string | null;
  hostSource?: string | null;
  problem?: string | null;
  candidates?: string[];
};

/**
 * Read the three identifiers from the account the token authorises. Read-only,
 * and it refuses (returning `problem`) rather than choosing among candidates.
 */
export function resolveIdentifiers(input: {
  token: string;
  expectedName?: string | null;
  repoFullName?: string | null;
  hostUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedIdentifiers>;
