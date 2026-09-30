/**
 * Phase 180 — build provenance, readable at runtime.
 * Phase 299 — extended so a DEPLOYED artifact can be identified without
 * opening a console: the same values are emitted as `<meta name="xstarz-build-*">`
 * tags and as `dist/build-info.json` (see `src/lib/build-provenance.ts`).
 *
 * Lets a deployed artifact be traced to the exact commit that produced it,
 * which matters because the browser-facing site can be served by a host that
 * rebuilds on its own schedule — and a stale artifact from the retired
 * build-platform scaffold (green theme, "secured by freebuff.com", email-OTP
 * sign-in) is otherwise only distinguishable by eye.
 *
 * Deliberately carries no author, commit message, remote URL, or environment
 * value — nothing here can leak a credential.
 */

import {
  BUILD_INFO_SCHEMA,
  isUnsafeProvenanceSource,
  shortenCommit,
  type BuildProvenanceSource,
} from "./build-provenance";

declare const __BUILD_COMMIT__: string;
declare const __BUILD_COMMIT_SHORT__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_SOURCE__: string;
declare const __BUILD_DIRTY__: boolean | null;

export { BUILD_INFO_SCHEMA };

export interface BuildInfo {
  commit: string;
  shortCommit: string;
  branch: string;
  builtAt: string;
  source: BuildProvenanceSource;
  /** True when the build tree had uncommitted changes. */
  worktreeDirty?: boolean | null;
}

const asString = (value: unknown, fallback = "unknown"): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

export function getBuildInfo(): BuildInfo {
  const commit = asString(
    typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : undefined,
  );
  return {
    commit,
    shortCommit: asString(
      typeof __BUILD_COMMIT_SHORT__ === "string" ? __BUILD_COMMIT_SHORT__ : undefined,
      shortenCommit(commit),
    ),
    branch: asString(typeof __BUILD_BRANCH__ === "string" ? __BUILD_BRANCH__ : undefined),
    builtAt: asString(typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : undefined),
    source: asString(
      typeof __BUILD_SOURCE__ === "string" ? __BUILD_SOURCE__ : undefined,
    ) as BuildProvenanceSource,
    worktreeDirty:
      typeof __BUILD_DIRTY__ === "boolean" ? __BUILD_DIRTY__ : null,
  };
}

/** One-line identifier, e.g. "eb3a60e (arena/…) built 2026-09-12T…". */
export function describeBuild(): string {
  const b = getBuildInfo();
  return `${b.shortCommit} (${b.branch}) built ${b.builtAt}`;
}

/**
 * True when the build came from `main`.
 *
 * `main` still contains the leaked OTP credential in its history and is NOT
 * a valid production source; deployments must come from the hardened branch.
 */
export function isUnsafeDeploymentSource(): boolean {
  return isUnsafeProvenanceSource(getBuildInfo());
}
