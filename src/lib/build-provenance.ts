/**
 * Frontend build provenance — one derivation, shared by the build and the app.
 *
 * WHY THIS EXISTS
 * ---------------
 * A deployed Xstarz Analysis page must be able to answer, on its own, exactly
 * which commit produced it. Without that, "the site looks old" and "the site
 * looks new" are opinions: the only way to tell a current artifact from a
 * legacy one was to compare colours by eye. That is how a stale artifact from
 * the retired build-platform scaffold (green primary, "secured by
 * freebuff.com", email-OTP sign-in) can be mistaken for the current product UI,
 * which is Xstarz blue and signs in with Google or as a guest.
 *
 * The values are produced HERE, at build time, and appear in three places that
 * cannot drift because they are generated from this one object:
 *
 *   1. `dist/build-info.json`      — a static file any HTTP GET can read;
 *   2. `<meta name="xstarz-build-*">` tags in the built `index.html` — visible
 *      in "view source" and to any crawler or uptime check, with no JavaScript;
 *   3. `src/lib/build-info.ts`     — the runtime value logged at startup and
 *      rendered by the `/build` route.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * No author, no commit message, no remote URL, no environment value, no
 * credential. Commit id, branch, build instant and the source of that
 * information only. An artifact must be identifiable without becoming a
 * disclosure surface.
 *
 * The build instant is the COMMIT timestamp (`SOURCE_DATE_EPOCH` overrides),
 * never `new Date()`: a rebuild of the same commit must produce the same
 * provenance, or "rebuild and compare" stops being possible.
 */

/** Schema id for `dist/build-info.json`. Bump only for a shape change. */
export const BUILD_INFO_SCHEMA = "xstarz.build-info/v1";

/** Where the recorded commit/branch/time came from. */
export type BuildProvenanceSource = "git" | "xstarz-env" | "ci-env" | "unknown";

export interface BuildProvenance {
  /**
   * Full commit id when known; `unknown` when the build had no git metadata.
   *
   * NOTE: a commit id alone does not fully identify an artifact built from a
   * tree with uncommitted edits — see `worktreeDirty`.
   */
  commit: string;
  /** First 8 characters of `commit`, for display. */
  shortCommit: string;
  /** Branch (or tag/SHA) the artifact was built from. */
  branch: string;
  /** Commit instant, ISO-8601 UTC, or `unknown`. */
  builtAt: string;
  /** Which mechanism supplied the values. */
  source: BuildProvenanceSource;
  /**
   * True when the working tree had uncommitted changes at build time, false
   * when it was clean, null when unknowable (no git).
   *
   * A deployment must be reproducible from its commit, so "which commit?" has
   * to come with "…and nothing else". Without this flag a local build would
   * claim a commit it only partly corresponds to.
   */
  worktreeDirty?: boolean | null;
}

/** A `<meta>` tag the build injects into `index.html`. */
export interface BuildInfoMetaTag {
  name: string;
  content: string;
}

/**
 * Normalise a git ref for comparison and display.
 *
 * `refs/heads/X`, `refs/remotes/origin/X`, `origin/X` and `heads/X` all name
 * the same branch as `X`, and a workflow that compares a raw `github.ref`
 * against a branch name would otherwise refuse a correct deployment (or, worse,
 * accept the wrong one).
 */
export function normalizeGitRef(ref: string | undefined | null): string {
  if (typeof ref !== "string") return "";
  let value = ref.trim();
  if (!value) return "";
  value = value
    .replace(/^refs\/remotes\/origin\//i, "")
    .replace(/^refs\/heads\//i, "")
    .replace(/^origin\//i, "")
    .replace(/^heads\//i, "");
  return value;
}

type Env = Record<string, string | undefined>;

/**
 * The ref an artifact should record, in precedence order:
 *
 *   1. `XSTARZ_BUILD_REF`    — explicit, set by the deploy workflow;
 *   2. `SOURCE_REF`          — the guard's deploy-source variable;
 *   3. `GITHUB_REF_NAME`     — the branch in CI even on a detached checkout;
 *   4. `GITHUB_REF`          — full ref, normalised.
 *
 * Returns `""` when none is present (the caller then falls back to git).
 */
export function resolveBuildRef(env: Env): string {
  return normalizeGitRef(
    env.XSTARZ_BUILD_REF ?? env.SOURCE_REF ?? env.GITHUB_REF_NAME ?? env.GITHUB_REF,
  );
}

/**
 * The commit an artifact should record: `XSTARZ_BUILD_COMMIT` (explicit),
 * then `GITHUB_SHA` (CI), else `""` so the caller can fall back to git.
 */
export function resolveBuildCommit(env: Env): string {
  const explicit = (env.XSTARZ_BUILD_COMMIT ?? env.GITHUB_SHA ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(explicit) ? explicit.toLowerCase() : "";
}

/** First 8 characters of a commit id, or `unknown`. */
export function shortenCommit(commit: string): string {
  const trimmed = (commit ?? "").trim();
  if (!trimmed || trimmed === "unknown") return "unknown";
  return trimmed.slice(0, 8);
}

/** Assemble the provenance record, filling in the derived fields. */
export function buildProvenance(input: {
  commit: string;
  branch: string;
  builtAt: string;
  source: BuildProvenanceSource;
  worktreeDirty?: boolean | null;
}): BuildProvenance {
  const commit = (input.commit ?? "").trim() || "unknown";
  const branch = (input.branch ?? "").trim() || "unknown";
  const builtAt = (input.builtAt ?? "").trim() || "unknown";
  return {
    commit,
    shortCommit: shortenCommit(commit),
    branch,
    builtAt,
    source: input.source,
    worktreeDirty: input.worktreeDirty ?? null,
  };
}

/**
 * True when the artifact was built from `main`.
 *
 * `main`'s history still serves the leaked OTP credential and its tip carries
 * the retired Freebuff scaffold (green theme, platform branding, email-OTP
 * sign-in). An artifact built from it is not the product UI, whatever it looks
 * like, so this flag is published with the provenance rather than hidden.
 */
export function isUnsafeProvenanceSource(provenance: BuildProvenance): boolean {
  return normalizeGitRef(provenance.branch).toLowerCase() === "main";
}

/**
 * The document written to `dist/build-info.json`.
 *
 * Serialised with `JSON.stringify(..., 2)` by the caller so the file is
 * readable in a browser tab without tooling.
 */
export function buildInfoPayload(provenance: BuildProvenance): Record<string, unknown> {
  return {
    schema: BUILD_INFO_SCHEMA,
    commit: provenance.commit,
    shortCommit: provenance.shortCommit,
    branch: provenance.branch,
    builtAt: provenance.builtAt,
    source: provenance.source,
    worktreeDirty: provenance.worktreeDirty ?? null,
    unsafeSource: isUnsafeProvenanceSource(provenance),
  };
}

/** `dist/build-info.json` contents, including the trailing newline. */
export function buildInfoJson(provenance: BuildProvenance): string {
  return `${JSON.stringify(buildInfoPayload(provenance), null, 2)}\n`;
}

/**
 * The `<meta>` tags injected into the built `index.html`.
 *
 * Deliberately static HTML: a deployed artifact must be identifiable with a
 * plain `curl` of the site root, with no JavaScript executed and no console
 * opened.
 */
export function buildInfoMetaTags(provenance: BuildProvenance): BuildInfoMetaTag[] {
  return [
    { name: "xstarz-build-schema", content: BUILD_INFO_SCHEMA },
    { name: "xstarz-build-commit", content: provenance.commit },
    { name: "xstarz-build-branch", content: provenance.branch },
    { name: "xstarz-build-time", content: provenance.builtAt },
  ];
}
