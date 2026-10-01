/**
 * Phase 300f — the run builds THE accepted artifact, not "whatever the tip is".
 *
 * Two findings drove this:
 *
 * 1. REGRESSION (my own 4d3d8b5 plumbing): the workflow blob taken from the
 *    arena branch silently DROPPED two main-side fixes — "Pin build provenance
 *    to the verified checkout" (run 36821835039 recorded the default-branch
 *    dispatch SHA in dist/build-info.json) and "Fail closed unless
 *    VITE_CONVEX_URL is a convex.cloud HTTPS origin". Both are restored and
 *    LOCKED here so plumbing can never lose them again.
 *
 * 2. The phase target names the artifact commit explicitly
 *    (bdd1715edfb563cbe5dfc04e77f1f0203c40f659). A run that builds the tip
 *    stamps the tip, so the workflow gained an optional `artifact_commit`
 *    input: detach to that commit, build, verify, then restore the tip for
 *    the upload/verify steps. Every --expect-commit compares against
 *    $XSTARZ_ARTIFACT_COMMIT, so "verified" and "published" stay the same
 *    bytes even though the branch tip has moved past the accepted artifact.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = readFileSync(resolve(root, ".github/workflows/publish-development-frontend.yml"), "utf8");

describe("phase300f · the workflow restores the lost main-side guards", () => {
  it("pins build provenance to the verified checkout (XSTARZ_BUILD_COMMIT/XSTARZ_BUILD_REF)", () => {
    expect(workflow).toContain("Pin build provenance to the verified checkout");
    expect(workflow).toContain('echo "XSTARZ_BUILD_COMMIT=$(git rev-parse HEAD)" >> "$GITHUB_ENV"');
    expect(workflow).toContain('echo "XSTARZ_BUILD_REF=${SOURCE_REF}" >> "$GITHUB_ENV"');
  });

  it("fails closed unless VITE_CONVEX_URL is a convex.cloud HTTPS origin", () => {
    expect(workflow).toContain("Fail closed unless VITE_CONVEX_URL is a convex.cloud HTTPS origin");
    expect(workflow).toContain("::error title=VITE_CONVEX_URL is not set");
    expect(workflow).toContain("VITE_CONVEX_URL is not a convex.cloud HTTPS origin");
  });
});

describe("phase300f · the artifact_commit input pins the published bytes", () => {
  it("declares the input and resolves XSTARZ_ARTIFACT_COMMIT (validated commit or the tip)", () => {
    expect(workflow).toContain("artifact_commit:");
    expect(workflow).toContain("Resolve the artifact commit to build and publish");
    // the value is validated as a commit object before it is trusted
    expect(workflow).toContain('git cat-file -e "${ARTIFACT_COMMIT_INPUT}^{commit}"');
    // named failure when it is not reachable
    expect(workflow).toContain("::error title=artifact_commit is not a commit in this history");
    // both paths end in the same env var every later step consumes
    expect(workflow).toContain('echo "XSTARZ_ARTIFACT_COMMIT=${ARTIFACT_COMMIT_INPUT}" >> "$GITHUB_ENV"');
    expect(workflow).toContain('echo "XSTARZ_ARTIFACT_COMMIT=$(git rev-parse HEAD)" >> "$GITHUB_ENV"');
  });

  it("detaches to the artifact commit for the build and restores the tip afterwards", () => {
    const detach = workflow.indexOf("Check out the pinned artifact content for the build");
    const restore = workflow.indexOf("Restore the branch tip for the publication steps");
    const build = workflow.indexOf("Build the pinned branch");
    const assemble = workflow.indexOf("Assemble the host's prebuilt output from the verified artifact");
    for (const at of [detach, restore, build, assemble]) expect(at).toBeGreaterThan(-1);
    // detach BEFORE the build; restore BETWEEN verify and assemble
    expect(detach).toBeLessThan(build);
    expect(build).toBeLessThan(restore);
    expect(restore).toBeLessThan(assemble);
    expect(workflow).toContain('git checkout --detach "$XSTARZ_ARTIFACT_COMMIT"');
    expect(workflow).toContain('git reset --hard "$XSTARZ_BUILD_TIP_SHA"');
    // the restore explains why the untracked build output survives
    expect(workflow).toContain("the verified artifact directory (untracked build output) is untouched");
  });

  it("gives the publish checkout full history so the artifact commit's objects exist", () => {
    const publishJob = workflow.slice(workflow.indexOf("  publish:"));
    expect(publishJob).toContain("fetch-depth: 0");
    expect(publishJob).toContain("# Full history: the pinned-artifact step below may detach to an");
  });

  it("every --expect-commit and the published notice use the resolved artifact commit", () => {
    expect(workflow).not.toContain('--expect-commit "$(git rev-parse HEAD)"');
    // verify:frontend, frontend:prebuilt and verify:published all compare
    // against the same value (the deploy/alias steps are contract-locked in
    // publication-scope-metadata.phase300e.test.ts)
    expect(workflow.match(/--expect-commit "\$XSTARZ_ARTIFACT_COMMIT"/g)?.length).toBe(3);
    expect(workflow).toContain("::notice title=Verified artifact::commit=${XSTARZ_ARTIFACT_COMMIT}");
    expect(workflow).toContain('echo "published commit: ${XSTARZ_ARTIFACT_COMMIT}"');
  });

  it("the provenance pin runs AFTER the detach so the stamp is the artifact commit", () => {
    const detach = workflow.indexOf("Check out the pinned artifact content for the build");
    const pin = workflow.indexOf("Pin build provenance to the verified checkout");
    expect(pin).toBeGreaterThan(detach);
    expect(pin).toBeLessThan(workflow.indexOf("Build the pinned branch"));
  });
});
