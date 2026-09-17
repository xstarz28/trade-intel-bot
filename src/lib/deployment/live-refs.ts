/**
 * Phase 233 — the deterministic source of truth for which refs exist.
 *
 * THE DEFECT THIS REPLACES
 * `release-gate-consistency.phase221.test.ts` derived its subject set from
 * `git for-each-ref refs/remotes/origin refs/tags` — the LOCAL remote-tracking
 * set. That set is a function of how the clone was made, not of what the
 * remote contains:
 *
 *   - a full clone sees every branch;
 *   - `fetch-depth: 1` (what CI's `verify` job uses) sees one;
 *   - a clone with no origin refs sees NOTHING, and the old test then looped
 *     zero times and passed without checking anything — a vacuous green.
 *
 * Measured three ways on the same commit: removing the extra tracking ref
 * passed 15/15, restoring one ref failed on that ref alone, and a depth-1
 * clone of a branch absent from the runbook failed while a depth-1 clone of a
 * branch present in it passed. Same code, same commit, three verdicts — the
 * oracle was the environment, not the repository.
 *
 * THE RULE
 * Ask the remote. `git ls-remote origin` reads the authoritative ref list, so
 * the answer no longer depends on fetch depth or clone shape. If the remote
 * cannot be reached the check FAILS CLOSED with an explicit infrastructure
 * error: "could not look" must never be reported as "nothing to see", because
 * a security check that passes when it did not run is worse than no check.
 *
 * The ref list is never hardcoded here — hardcoding would recreate the same
 * defect in a new place, and would silently stop covering any ref added later.
 */

import { execFileSync } from "node:child_process";

/**
 * The remote was unreachable, or answered with nothing usable.
 *
 * A distinct type (not a bare Error) so callers and tests can assert the
 * failure is explicitly an infrastructure fault rather than a runbook defect.
 */
export class LiveRefSourceUnavailableError extends Error {
  readonly code = "LIVE_REF_SOURCE_UNAVAILABLE";
  /** The underlying git failure, kept for diagnosis. */
  readonly cause?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LiveRefSourceUnavailableError";
    this.cause = options?.cause;
  }
}

/** Injectable git runner so the fail-closed paths are testable without a network. */
export type GitRunner = (args: string[]) => string;

const defaultRunner: GitRunner = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 24 });

/**
 * Normalise `git ls-remote` output into canonical `heads/…` / `tags/…` names.
 *
 * Peeled tag entries (`…^{}`) are dropped: they name the object a tag points
 * at, not a ref, and counting them would double every annotated tag. The
 * pseudo-ref `HEAD` is dropped for the same reason — it is not a branch.
 */
export function parseLsRemote(stdout: string): string[] {
  const refs = new Set<string>();

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const ref = line.slice(tab + 1).trim();

    // Peeled tag object, not a ref.
    if (ref.endsWith("^{}")) continue;
    if (ref === "refs/heads/HEAD" || ref === "HEAD") continue;

    if (ref.startsWith("refs/heads/")) refs.add(`heads/${ref.slice("refs/heads/".length)}`);
    else if (ref.startsWith("refs/tags/")) refs.add(`tags/${ref.slice("refs/tags/".length)}`);
  }

  return [...refs].sort();
}

/**
 * The refs that actually exist on the remote, read from the remote.
 *
 * Throws `LiveRefSourceUnavailableError` when git fails, when the command
 * produces no parseable refs, or when it yields only non-ref entries. All
 * three mean the same thing operationally: the check could not look.
 */
export function listLiveRefs(
  run: GitRunner = defaultRunner,
  remote = "origin",
): string[] {
  let stdout: string;
  try {
    stdout = run(["ls-remote", "--heads", "--tags", remote]);
  } catch (err) {
    throw new LiveRefSourceUnavailableError(
      `could not read refs from remote "${remote}" — the ref inventory cannot be ` +
        `verified from this environment. This is an infrastructure failure, NOT a ` +
        `clean result. Run in an environment with network access to the remote.`,
      { cause: err },
    );
  }

  const refs = parseLsRemote(stdout);
  if (refs.length === 0) {
    throw new LiveRefSourceUnavailableError(
      `remote "${remote}" reported no branches or tags. An empty ref list is not ` +
        `evidence that the repository is clean — refusing to report success.`,
    );
  }
  return refs;
}
