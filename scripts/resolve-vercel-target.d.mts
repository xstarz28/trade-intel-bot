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
  /** The host's own statement of which account/team owns the project. */
  accountId?: string | null;
  link?: VercelLink;
  alias?: string[] | null;
  targets?: { production?: { alias?: string[] | null } | null } | null;
  /** Scope metadata added while enumerating: `__scope` on one record, and
   *  `__scopes` after identical records are merged. */
  __scope?: VercelScope;
  __scopes?: VercelScope[];
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

/** What a listing told us: which scope, and whether it is a person or a team. */
export type VercelScope = { kind: string; id: string; label?: string };

/**
 * Collapse records of the SAME project (same `id`) returned by several listings
 * into one candidate. Different ids are never merged; a record without an id is
 * never merged either, because an absent identity is not a shared identity.
 */
export function dedupeProjects(
  projects: (VercelProject & { __scope?: VercelScope })[],
): (VercelProject & { __scopes?: VercelScope[]; __dedupedRecords?: number })[];

export type DedupeSummary = { rawRecords: number; distinctProjects: number; collapsed: number };

export function dedupeSummary(
  rawProjects: VercelProject[],
  dedupedProjects: { id?: string | null }[],
): DedupeSummary;

export type ScopeChoice = {
  scope: VercelScope | null;
  source: string | null;
  certain: boolean;
  scopes: VercelScope[];
  problem?: string;
};

/**
 * The scope that owns a project — the value `VERCEL_ORG_ID` must be. The
 * project's own `accountId` is authoritative; without it, one team scope is
 * preferred and the preference is disclosed.
 */
export function scopeForProject(
  project: (VercelProject & { __scopes?: VercelScope[]; __scope?: VercelScope }) | null,
  options?: { personalId?: string | null },
): ScopeChoice;

export type VercelTargetReport = {
  schema: string;
  state: string;
  orgId: string | null;
  orgKind?: string | null;
  orgSource?: string | null;
  projectId: string | null;
  projectName?: string | null;
  hostUrl: string | null;
  hostSource?: string | null;
  domains?: string[];
  matchedBy?: string | null;
  projectsSeen?: number;
  dedupe?: DedupeSummary;
  evidence?: string[];
  problems?: string[];
  candidates?: { name?: string | null; id?: string | null; scopes?: string[] }[];
};

/**
 * The whole resolution with injectable inputs, so the operator's exact situation
 * (one project returned by both the personal and the team scope) is reproducible
 * in a test without a network or a credential.
 */
export function resolveVercelTarget(options?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<VercelTargetReport>;

/**
 * A DNS hostname and nothing else. Part of the guard because the host is passed
 * to the host CLI's alias command, which is a shell-run `.cmd` on Windows.
 */
export function isHostnameShaped(value: unknown): boolean;

/** git, through the platform-safe runner (`scripts/lib/executable.mjs`). */
export function gitOutput(args: string[]): string | null;
