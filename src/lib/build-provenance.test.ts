/**
 * Phase 299 — build provenance.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The site has served two different products from the same origin: the current
 * UI (Xstarz blue, Google + guest sign-in) and a retired build-platform
 * scaffold (green primary, "secured by freebuff.com", email-OTP sign-in). The
 * only thing that made the difference detectable was the artifact's own
 * metadata, so the metadata is now a contract:
 *
 *   - `dist/build-info.json` and the `xstarz-build-*` meta tags are generated
 *     from ONE object (`buildProvenance`), so the static file, the HTML and the
 *     runtime log cannot disagree;
 *   - the recorded ref is the branch CI actually built, not the literal "HEAD"
 *     a detached checkout reports;
 *   - a build from a dirty tree says so, because a commit id alone does not
 *     identify an artifact that contains uncommitted edits;
 *   - nothing in the record can leak a credential.
 *
 * These are checked by EXECUTING the pure module (not by grepping comments),
 * because a provenance record that is merely described is not provenance.
 */

import { describe, expect, it } from "vitest";
import {
  BUILD_INFO_SCHEMA,
  buildInfoJson,
  buildInfoMetaTags,
  buildInfoPayload,
  buildProvenance,
  isUnsafeProvenanceSource,
  normalizeGitRef,
  resolveBuildCommit,
  resolveBuildRef,
  shortenCommit,
} from "./build-provenance";

const SAMPLE = buildProvenance({
  commit: "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc",
  branch: "arena/01a0d195-trade-intel-bot",
  builtAt: "2026-09-30T05:02:36.000Z",
  source: "git",
  worktreeDirty: false,
});

describe("299 — ref normalisation (one answer for one branch)", () => {
  it("treats the spellings of one branch as one branch", () => {
    for (const spelling of [
      "arena/01a0d195-trade-intel-bot",
      "refs/heads/arena/01a0d195-trade-intel-bot",
      "refs/remotes/origin/arena/01a0d195-trade-intel-bot",
      "origin/arena/01a0d195-trade-intel-bot",
      "heads/arena/01a0d195-trade-intel-bot",
      "  arena/01a0d195-trade-intel-bot  ",
    ]) {
      expect(normalizeGitRef(spelling), spelling).toBe("arena/01a0d195-trade-intel-bot");
    }
  });

  it("returns an empty string for absent or blank refs, never a guess", () => {
    expect(normalizeGitRef(undefined)).toBe("");
    expect(normalizeGitRef(null)).toBe("");
    expect(normalizeGitRef("   ")).toBe("");
  });

  it("resolves the ref in a documented precedence order", () => {
    // The explicit build ref wins: it is the only one that states intent.
    expect(
      resolveBuildRef({
        XSTARZ_BUILD_REF: "refs/heads/arena/intended",
        SOURCE_REF: "refs/heads/source",
        GITHUB_REF_NAME: "ci-name",
        GITHUB_REF: "refs/heads/ci",
      }),
    ).toBe("arena/intended");
    expect(resolveBuildRef({ SOURCE_REF: "refs/heads/source", GITHUB_REF_NAME: "ci-name" })).toBe(
      "source",
    );
    expect(resolveBuildRef({ GITHUB_REF_NAME: "ci-name", GITHUB_REF: "refs/heads/ci" })).toBe(
      "ci-name",
    );
    expect(resolveBuildRef({ GITHUB_REF: "refs/heads/ci" })).toBe("ci");
    expect(resolveBuildRef({})).toBe("");
  });

  it("accepts a commit only when it is a commit id", () => {
    expect(resolveBuildCommit({ XSTARZ_BUILD_COMMIT: "B298C3C7B26D" })).toBe("b298c3c7b26d");
    expect(resolveBuildCommit({ GITHUB_SHA: "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc" })).toBe(
      "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc",
    );
    // Anything that is not a hex id is refused rather than recorded.
    for (const bad of ["", "unknown", "v1.2.3", "b298c3", "  "]) {
      expect(resolveBuildCommit({ XSTARZ_BUILD_COMMIT: bad }), bad).toBe("");
    }
  });

  it("shortens a commit for display without inventing one", () => {
    expect(shortenCommit(SAMPLE.commit)).toBe("b298c3c7");
    expect(shortenCommit("unknown")).toBe("unknown");
    expect(shortenCommit("")).toBe("unknown");
  });
});

describe("299 — the provenance record", () => {
  it("carries the schema, the commit, the branch and the build instant", () => {
    const payload = buildInfoPayload(SAMPLE);
    expect(payload.schema).toBe(BUILD_INFO_SCHEMA);
    expect(payload.commit).toBe(SAMPLE.commit);
    expect(payload.branch).toBe("arena/01a0d195-trade-intel-bot");
    expect(payload.builtAt).toBe("2026-09-30T05:02:36.000Z");
    expect(payload.worktreeDirty).toBe(false);
    expect(payload.unsafeSource).toBe(false);
  });

  it("flags a build from main, including its ref spellings", () => {
    for (const branch of ["main", "refs/heads/main", "origin/main"]) {
      expect(isUnsafeProvenanceSource({ ...SAMPLE, branch }), branch).toBe(true);
    }
    expect(isUnsafeProvenanceSource({ ...SAMPLE, branch: "maintenance/x" })).toBe(false);
  });

  it("flags a dirty worktree instead of implying reproducibility it lacks", () => {
    const dirty = buildProvenance({ ...SAMPLE, worktreeDirty: true });
    expect(buildInfoPayload(dirty).worktreeDirty).toBe(true);
    // Unknown is not silently "clean".
    const unknown = buildProvenance({ commit: "unknown", branch: "unknown", builtAt: "unknown", source: "unknown" });
    expect(buildInfoPayload(unknown).worktreeDirty).toBeNull();
    expect(buildInfoPayload(unknown).commit).toBe("unknown");
  });

  it("emits the same facts into the HTML as meta tags", () => {
    const tags = buildInfoMetaTags(SAMPLE);
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.content]));
    expect(byName["xstarz-build-schema"]).toBe(BUILD_INFO_SCHEMA);
    expect(byName["xstarz-build-commit"]).toBe(SAMPLE.commit);
    expect(byName["xstarz-build-branch"]).toBe(SAMPLE.branch);
    expect(byName["xstarz-build-time"]).toBe(SAMPLE.builtAt);
  });

  it("writes parseable JSON", () => {
    const text = buildInfoJson(SAMPLE);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).commit).toBe(SAMPLE.commit);
  });

  it("carries no author, message, remote or environment value", () => {
    const text = buildInfoJson(SAMPLE);
    for (const forbidden of [
      "author",
      "commitMessage",
      "remote",
      "originUrl",
      "git@",
      "https://",
      "env",
      "TOKEN",
      "KEY",
    ]) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The record is exactly the documented field set — a new field is a
    // deliberate act, not something that appears because a helper was reused.
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      [
        "branch",
        "builtAt",
        "commit",
        "schema",
        "shortCommit",
        "source",
        "unsafeSource",
        "worktreeDirty",
      ].sort(),
    );
  });
});
