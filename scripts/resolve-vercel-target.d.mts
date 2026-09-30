/**
 * Types for `resolve-vercel-target.mjs`.
 *
 * The resolver must run anywhere with plain `node` and a token — CI, a runner,
 * an operator's shell — so it is JavaScript. These declarations are what keep
 * the pure selection rules checkable from the TypeScript suite without the test
 * silently accepting a shape the script does not produce.
 */

export const VERCEL_API: string;
export const VERCEL_TARGET_SCHEMA: string;

export type VercelLink = { type?: string | null; repo?: string | null } | null;

export type VercelProject = {
  /** The API always returns one; optional here so the pure rules can be fed a
   *  minimal project object by a test. */
  id?: string;
  name?: string | null;
  link?: VercelLink;
  alias?: string[] | null;
  targets?: { production?: { alias?: string[] | null } | null } | null;
};

export type ProjectSelection = {
  chosen: VercelProject | null;
  matchedBy: "git-link" | "name" | null;
  candidates: VercelProject[];
  problem?: string;
};

/**
 * Identify THIS repository's project: a project whose Git link names the
 * repository wins; otherwise the single project carrying the expected name.
 * Several matches or none returns `chosen: null` with `problem` set — never a
 * guess.
 */
export function selectVercelProject(input: {
  projects: VercelProject[];
  expectedName?: string | null;
  repoFullName?: string | null;
}): ProjectSelection;

export type ProjectDomain = { name: string; source: string; verified: boolean };

/** Every domain the project reports (aliases + `/domains`), deduplicated. */
export function projectDomains(project: VercelProject | null, domainList: unknown): ProjectDomain[];

export type HostChoice = { hostUrl: string | null; source: string | null; problem?: string };

/**
 * Choose the browser-facing origin from the project's own data. An explicit
 * value is honoured only when the project lists it (or `allowUnverifiedHost`).
 */
export function chooseHostUrl(input: {
  explicit?: string | null;
  domains: ProjectDomain[];
  allowUnverifiedHost?: boolean;
}): HostChoice;

export type VercelGetResult = {
  status: number | null;
  ok: boolean;
  json: unknown;
  text: string;
};

/** A read-only `GET`, bounded by a timeout. The token is never returned. */
export function vercelGet(
  path: string,
  options: { token: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<VercelGetResult>;
