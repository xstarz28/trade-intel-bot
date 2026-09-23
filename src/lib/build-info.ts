/**
 * Phase 180 — build provenance, readable at runtime.
 *
 * Lets a deployed artifact be traced to the exact commit that produced it,
 * which matters because production deploys from the hardened agent branch,
 * NOT from `main`. Without this, "which revision is live?" is guesswork.
 *
 * Deliberately carries no author, commit message, remote URL, or environment
 * value — nothing here can leak a credential.
 */

declare const __BUILD_COMMIT__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_TIME__: string;

export interface BuildInfo {
  commit: string;
  branch: string;
  builtAt: string;
}

export function getBuildInfo(): BuildInfo {
  return {
    commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown",
    branch: typeof __BUILD_BRANCH__ === "string" ? __BUILD_BRANCH__ : "unknown",
    builtAt: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "unknown",
  };
}

/** One-line identifier, e.g. "eb3a60e (arena/…) built 2026-09-12T…". */
export function describeBuild(): string {
  const b = getBuildInfo();
  return `${b.commit} (${b.branch}) built ${b.builtAt}`;
}

/**
 * True when the build came from `main`.
 *
 * `main` still contains the leaked OTP credential in its history and is NOT
 * a valid production source; deployments must come from the hardened branch.
 */
export function isUnsafeDeploymentSource(): boolean {
  return getBuildInfo().branch === "main";
}
