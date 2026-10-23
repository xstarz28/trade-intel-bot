import { describe, expect, it } from "vitest";
import { resolveBuildCommit, resolveBuildRef } from "./build-provenance";

describe("build provenance environment resolution", () => {
  it("prefers explicit refs, then CI refs, then Vercel's Git deployment ref", () => {
    expect(resolveBuildRef({ XSTARZ_BUILD_REF: "release/1", VERCEL_GIT_COMMIT_REF: "preview" })).toBe("release/1");
    expect(resolveBuildRef({ GITHUB_REF_NAME: "fix/ci", VERCEL_GIT_COMMIT_REF: "preview" })).toBe("fix/ci");
    expect(resolveBuildRef({ VERCEL_GIT_COMMIT_REF: "fix/lint-and-market-safety-20261019" })).toBe("fix/lint-and-market-safety-20261019");
  });

  it("normalizes Vercel refs and keeps invalid commit values out of provenance", () => {
    expect(resolveBuildRef({ VERCEL_GIT_COMMIT_REF: "refs/heads/fix/provenance" })).toBe("fix/provenance");
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: "38c383bdf0fec1a652c63a7ad8fb019cdaf677a3" })).toBe("38c383bdf0fec1a652c63a7ad8fb019cdaf677a3");
    expect(resolveBuildCommit({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" })).toBe("");
  });
});
