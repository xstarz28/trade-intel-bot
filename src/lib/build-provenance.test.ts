import { describe, expect, it } from "vitest";
import { buildProvenance, isUnsafeProvenanceSource } from "./build-provenance";

describe("build provenance safety", () => {
  it("allows a verified clean main build", () => {
    const provenance = buildProvenance({
      commit: "5fea56950d53e5ffbbbcdd4074dd1e70f6844745",
      branch: "main",
      builtAt: "2026-10-25T03:59:03.000Z",
      source: "git",
      worktreeDirty: false,
    });

    expect(isUnsafeProvenanceSource(provenance)).toBe(false);
  });

  it.each([
    ["unknown source", { commit: "abc1234", branch: "main", source: "unknown" as const }],
    ["unknown commit", { commit: "unknown", branch: "main", source: "git" as const }],
    ["unknown branch", { commit: "abc1234", branch: "unknown", source: "git" as const }],
  ])("rejects %s provenance", (_label, input) => {
    const provenance = buildProvenance({
      ...input,
      builtAt: "2026-10-25T03:59:03.000Z",
      worktreeDirty: false,
    });

    expect(isUnsafeProvenanceSource(provenance)).toBe(true);
  });
});
