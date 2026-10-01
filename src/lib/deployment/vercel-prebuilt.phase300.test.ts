/**
 * Phase 300 final hotfix — the publication must upload PREBUILT bytes.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * The first real publication attempt from Windows CMD got as far as the upload
 * and then failed remotely:
 *
 *     Running "vercel build"
 *     sh: line 1: vite: command not found
 *     Error: Command "vite build" exited with 127
 *
 * `vercel deploy dist` had handed the host a directory, and the host treated it
 * as source: it ran the project's build command in its own builder. The visible
 * half of that is a failure. The invisible half — the one that matters — is that
 * a *successful* remote build would have served bytes from a build nobody
 * verified, under the very URL `verify:published` then checks. Phase 300's
 * invariant is "what was verified is what is published", so the publication now
 * assembles the host's Build Output API directory from the verified artifact and
 * deploys it with `--prebuilt`.
 *
 * These tests therefore check three different things:
 *
 *   1. the assembly is FAITHFUL — routing derived from `vercel.json` (filesystem
 *      first, so `/assets/*` is still served), byte-identical content;
 *   2. a MISMATCH is refused — a rebuilt page, a bundle from another revision, an
 *      extra or missing file, a stale routing config, the wrong commit: each is
 *      rejected by name, which is what makes a host-side rebuild impossible to
 *      publish silently;
 *   3. the WIRING still holds — the CLI and the workflow, in order, with the
 *      pinned branch, the artifact check before the upload, `--prebuilt` on the
 *      upload, and the published fetch afterwards with the expected provenance.
 *      Windows and Unix both go through the same executable resolver.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILD_OUTPUT_STATIC,
  BUILD_OUTPUT_VERSION,
  FILESYSTEM_HANDLE,
  buildOutputConfig,
  ensureLocalProjectLink,
  materializeBuildOutput,

  routesForBuildOutput,
  verifyBuildOutput,
} from "../../../scripts/lib/vercel-prebuilt.mjs";
import {
  REST_DEPLOY_STATES,
  buildDeploymentRequestBody,
  collectOutputFiles,
  exitCodeFor as restExitCodeFor,
  restDeployPrebuilt,
} from "../../../scripts/lib/vercel-rest-deploy.mjs";
import { resolveExecutable } from "../../../scripts/lib/executable.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const PINNED = "arena/01a0d195-trade-intel-bot";
const SPA_REWRITE = { source: "/(.*)", destination: "/index.html" };
const VERCEL_JSON = `${JSON.stringify({ rewrites: [SPA_REWRITE] }, null, 2)}\n`;

const COMMIT = "685c8d1db0577eec845dbaf90f7923d06cb08908";

let counter = 0;
/** A throwaway `dist/` that looks like the verified artifact. */
function fixtureDist({ commit = COMMIT, branch = PINNED, entry = "index-abc123.js" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `phase300-prebuilt-${counter++}-`));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(
    join(dir, "build-info.json"),
    `${JSON.stringify({
      schema: "xstarz.build-info/v1",
      commit,
      branch,
      builtAt: "2026-10-01T00:00:00.000Z",
      mode: "production",
    })}\n`,
  );
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><head><link rel="stylesheet" href="/assets/${entry.replace(/\.js$/, ".css")}"></head>` +
      `<body><script type="module" src="/assets/${entry}"></script></body></html>`,
  );
  writeFileSync(join(dir, "assets", entry), "export const app = 1;\n");
  writeFileSync(join(dir, "logo.svg"), "<svg></svg>");
  return dir;
}

function fixtureVercelJson(text = VERCEL_JSON) {
  const dir = mkdtempSync(join(tmpdir(), `phase300-verceljson-${counter++}-`));
  const path = join(dir, "vercel.json");
  writeFileSync(path, text);
  return path;
}

/** Materialize into a temp output dir (never `.vercel/output` in the repo). */
function assemble(dist: string, vercelJsonPath = fixtureVercelJson()) {
  const outDir = mkdtempSync(join(tmpdir(), `phase300-out-${counter++}-`));
  const result = materializeBuildOutput({ distDir: dist, outDir, vercelJsonPath });
  return { result, outDir, vercelJsonPath };
}

describe("300 — the Build Output API assembly is faithful to the verified artifact", () => {
  it("carries vercel.json's SPA rewrite over as a filesystem-first route table", () => {
    const routing = routesForBuildOutput(VERCEL_JSON);
    expect(routing.ok).toBe(true);
    if (!routing.ok) return;
    // The order is the whole point: without the filesystem phase first, the
    // catch-all rewrite would swallow /assets/*.js and the app would not boot.
    expect(routing.routes[0]).toEqual({ handle: FILESYSTEM_HANDLE });
    expect(routing.routes[1]).toEqual({ src: "/(.*)", dest: "/index.html" });
    expect(routing.fallback).toBe(true);

    const config = buildOutputConfig(VERCEL_JSON);
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect(config.config.version).toBe(BUILD_OUTPUT_VERSION);
    expect(config.config.routes).toEqual(routing.routes);
  });

  it("refuses a vercel.json whose configuration it would silently drop or lose", () => {
    for (const [label, text] of [
      ["redirects", JSON.stringify({ rewrites: [SPA_REWRITE], redirects: [{ source: "/a", destination: "/b" }] })],
      ["headers", JSON.stringify({ rewrites: [SPA_REWRITE], headers: [{ source: "/(.*)", headers: [] }] })],
      ["no rewrites", JSON.stringify({})],
      ["not JSON", "{ rewrites: nope"],
      ["malformed rewrite", JSON.stringify({ rewrites: [{ source: "/(.*)" }] })],
    ] as const) {
      const routing = routesForBuildOutput(text);
      expect(routing.ok, label).toBe(false);
      if (!routing.ok) expect(routing.problem.length, label).toBeGreaterThan(0);
    }
  });

  it("copies the verified bytes into .vercel/output/static and writes config.json", () => {
    const dist = fixtureDist();
    const { result } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toBe(4);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.buildInfoSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.config.version).toBe(BUILD_OUTPUT_VERSION);
    expect(result.config.routes[1]).toEqual({ src: "/(.*)", dest: "/index.html" });
    // The provenance of the copied artifact is the provenance of the verified one.
    const copied = JSON.parse(readFileSync(join(result.staticDir, "build-info.json"), "utf8"));
    expect(copied.commit).toBe(COMMIT);
    expect(copied.branch).toBe(PINNED);
    expect(result.staticDir).toBe(join(result.outDir, BUILD_OUTPUT_STATIC));
    expect(result.configPath).toBe(join(result.outDir, "config.json"));
  });

  it("refuses to assemble when there is no verified artifact to publish", () => {
    const empty = mkdtempSync(join(tmpdir(), `phase300-nodist-${counter++}-`));
    const outDir = mkdtempSync(join(tmpdir(), `phase300-noout-${counter++}-`));
    const result = materializeBuildOutput({ distDir: empty, outDir, vercelJsonPath: fixtureVercelJson() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/nothing to publish/);
  });
});

describe("300 — a host-side rebuild, or any other mismatch, is refused by name", () => {
  it("passes on an untouched assembly (the positive control)", () => {
    const dist = fixtureDist();
    const { result, outDir, vercelJsonPath } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const check = verifyBuildOutput({
      distDir: dist,
      outDir,
      vercelJsonPath,
      expectCommit: COMMIT,
      expectBranch: PINNED,
    });
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.checks.every((c) => c.ok)).toBe(true);
  });

  it("rejects a page that came back from a different build (the rebuild scenario)", () => {
    const dist = fixtureDist();
    const { result, outDir, vercelJsonPath } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // What a successful REMOTE build would have uploaded: a different bundle
    // name, a different page — the bytes nobody verified.
    writeFileSync(
      join(result.staticDir, "index.html"),
      '<!doctype html><html><body><script type="module" src="/assets/index-ZZZ999.js"></script></body></html>',
    );
    const check = verifyBuildOutput({ distDir: dist, outDir, vercelJsonPath, expectCommit: COMMIT, expectBranch: PINNED });
    expect(check.ok).toBe(false);
    expect(check.problems.join(" | ")).toMatch(/byte-identical/);
    expect(check.problems.join(" | ")).toMatch(/index\.html/);
  });

  it("rejects provenance from another commit, a missing file and an extra file", () => {
    const dist = fixtureDist();
    const { result, outDir, vercelJsonPath } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1. a rebuild of a DIFFERENT revision: same layout, other commit.
    const other = fixtureDist({ commit: "a".repeat(40) });
    const otherBytes = readFileSync(join(other, "build-info.json"));
    writeFileSync(join(result.staticDir, "build-info.json"), otherBytes);
    const wrongCommit = verifyBuildOutput({ distDir: dist, outDir, vercelJsonPath, expectCommit: COMMIT, expectBranch: PINNED });
    expect(wrongCommit.ok).toBe(false);
    expect(wrongCommit.problems.join(" | ")).toMatch(/byte-identical|records the expected commit/);

    // 2. content the artifact does not contain, or content it lost.
    const dist2 = fixtureDist();
    const second = assemble(dist2);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) return;
    rmSync(join(second.result.staticDir, "logo.svg"));
    writeFileSync(join(second.result.staticDir, "extra.txt"), "not in the verified artifact");
    const tampered = verifyBuildOutput({
      distDir: dist2,
      outDir: second.outDir,
      vercelJsonPath: second.vercelJsonPath,
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(" | ")).toMatch(/every verified file is in the build output/);
    expect(tampered.problems.join(" | ")).toMatch(/nothing the artifact does not/);
  });

  it("rejects a stale or tampered routing configuration", () => {
    const dist = fixtureDist();
    const { result, outDir, vercelJsonPath } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A config that lost the filesystem phase would rewrite /assets/*.js to the
    // SPA shell — a deployment that "looks" published but cannot boot.
    writeFileSync(
      join(outDir, "config.json"),
      `${JSON.stringify({ version: BUILD_OUTPUT_VERSION, routes: [{ src: "/(.*)", dest: "/index.html" }] }, null, 2)}\n`,
    );
    const check = verifyBuildOutput({ distDir: dist, outDir, vercelJsonPath });
    expect(check.ok).toBe(false);
    expect(check.problems.join(" | ")).toMatch(/routing matches vercel.json/);
  });

  it("rejects an output that was never assembled", () => {
    const empty = mkdtempSync(join(tmpdir(), `phase300-nooutput-${counter++}-`));
    const check = verifyBuildOutput({ distDir: fixtureDist(), outDir: empty, vercelJsonPath: fixtureVercelJson() });
    expect(check.ok).toBe(false);
    expect(check.problems.join(" | ")).toMatch(/has no config.json\/static/);
  });

  it("the prepare CLI refuses a mismatched output with a non-zero exit (the command the runner calls)", () => {
    const dist = fixtureDist();
    const { result, outDir, vercelJsonPath } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeFileSync(join(result.staticDir, "build-info.json"), `${JSON.stringify({ commit: "b".repeat(40), branch: PINNED })}\n`);
    const run = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/prepare-vercel-output.mjs"),
        "--verify-only",
        "--dist",
        dist,
        "--out",
        outDir,
        "--vercel-json",
        vercelJsonPath,
        "--expect-commit",
        COMMIT,
        "--expect-branch",
        PINNED,
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/vercel build output: FAIL/);
    expect(run.stdout).toMatch(/records the expected commit/);
  });
});

describe("300 — the deploy invocation cannot trigger a host build, on Windows or Unix", () => {
  it("always deploys --prebuilt (prebuilt=1 on the REST create), never a bare directory", () => {
    // Phase 300g: the upload is the project-scoped REST deployment. The
    // `prebuilt=1` query parameter IS the --prebuilt semantics: the request
    // carries the assembled `.vercel/output` sha list and the host runs NO
    // build. No CLI spawn and no positional directory exist anymore.
    const body = buildDeploymentRequestBody({
      files: [{ file: ".vercel/output/config.json", size: 1, mode: 33188, sha: "a" }],
      projectName: "trade-intel-bot",
      projectId: "prj_x",
      target: "production",
    });
    expect(body.source).toBe("cli");
    expect(body.version).toBe(2);
    expect(body.target).toBe("production");
    expect(body.name).toBe("trade-intel-bot");
    expect(body.project).toBe("prj_x");
    const previewBody = buildDeploymentRequestBody({
      files: [],
      projectName: "trade-intel-bot",
      projectId: "prj_x",
      target: "preview",
    });
    expect(previewBody.target).toBeUndefined(); // preview = omitted, like the CLI
    // No positional directory and no CLI spawn anywhere in the publisher: a
    // positional upload is what made the host run `vite build` remotely, and
    // the CLI's link flow reproduces the #17506 refusal (phase 300g).
    const source = read("scripts/publish-frontend.mjs");
    expect(source).toContain("restDeployPrebuilt(");
    expect(source).not.toMatch(/run\(\s*"npx"\s*,\s*deployArgs/);
    expect(source).not.toContain("vercel@latest");
  });

  it("routes the local tool invocations through the platform-safe resolver on both platforms", () => {
    expect(resolveExecutable("npx", "win32")).toMatchObject({ command: "npx.cmd", shell: true });
    expect(resolveExecutable("npx", "linux")).toMatchObject({ command: "npx", shell: false });
    expect(resolveExecutable("node", "win32")).toMatchObject({ command: "node.exe", shell: false });
    const source = read("scripts/publish-frontend.mjs");
    expect(source).toMatch(/runCommand/);
  });
});

describe("300 — the link to the verified project is explicit, never a guess", () => {
  it("writes the resolved ids, reuses an agreeing link, and refuses a disagreeing one", () => {
    const dir = mkdtempSync(join(tmpdir(), `phase300-link-${counter++}-`));
    const linkPath = join(dir, ".vercel", "project.json");
    const created = ensureLocalProjectLink({ orgId: "team_eDGLXdW7ZyigDFM57sqm6Pf0", projectId: "prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb", linkPath });
    expect(created).toEqual({ ok: true, state: "created", linkPath });
    const written = JSON.parse(readFileSync(linkPath, "utf8"));
    expect(written.orgId).toBe("team_eDGLXdW7ZyigDFM57sqm6Pf0");
    expect(written.projectId).toBe("prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb");

    const reuse = ensureLocalProjectLink({ orgId: written.orgId, projectId: written.projectId, linkPath });
    expect(reuse).toMatchObject({ ok: true, state: "existing" });

    const conflict = ensureLocalProjectLink({ orgId: "team_OTHER", projectId: written.projectId, linkPath });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.problem).toMatch(/refusing to deploy to a project other than the one/);
    // Nothing was overwritten.
    expect(JSON.parse(readFileSync(linkPath, "utf8")).orgId).toBe("team_eDGLXdW7ZyigDFM57sqm6Pf0");

    expect(ensureLocalProjectLink({ orgId: null, projectId: "prj_x", linkPath: join(dir, "other.json") }).ok).toBe(false);
  });
});

describe("300 — the publication still verifies, pins and proves, in that order", () => {
  it("keeps verify:frontend before the assembly, the upload prebuilt, and the published fetch last", () => {
    const source = read("scripts/publish-frontend.mjs");
    const verifyArtifact = source.indexOf("scripts/verify-frontend-artifact.mjs");
    // Call sites, not the import lines at the top of the file.
    const assemble = source.indexOf("materializeBuildOutput({");
    const proveOutput = source.indexOf("verifyBuildOutput({");
    // Phase 300g: the upload is the in-process REST deployer (no CLI spawn).
    const upload = source.indexOf("restDeployPrebuilt({");
    // Phase 300e: the alias is assigned through the teamId-scoped REST API
    // (vercel/vercel#17506 — `vercel alias set` performs a user lookup a
    // project-scoped token cannot satisfy). The call site moved; the ORDER
    // (upload -> alias -> verify published) is the contract under test.
    const alias = source.indexOf("/aliases?teamId=");
    const verifyPublished = source.indexOf("scripts/verify-published-frontend.mjs");
    for (const at of [verifyArtifact, assemble, proveOutput, upload, alias, verifyPublished]) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(verifyArtifact).toBeLessThan(assemble);
    expect(assemble).toBeLessThan(proveOutput);
    expect(proveOutput).toBeLessThan(upload);
    expect(upload).toBeLessThan(alias);
    expect(alias).toBeLessThan(verifyPublished);
    // No plain directory deploy anywhere in the publication path.
    expect(source).not.toMatch(/"deploy",\s*args\.dist/);
    expect(source).not.toMatch(/deploy",\s*args\.dist/);
  });

  it("still compares the PUBLIC url to the expected commit, branch, provenance and bundles", () => {
    const source = read("scripts/publish-frontend.mjs");
    expect(source).toMatch(/--expect-build-info-sha256/);
    expect(source).toMatch(/--expect-asset-names/);
    expect(source).toMatch(/--expect-commit/);
    expect(source).toMatch(/--expect-branch/);
    expect(source).toMatch(/fingerprint\.sha256/);
    expect(source).toMatch(/the published URL did not pass the acceptance check/);
    expect(source).not.toMatch(/--token/);
  });

  it("keeps the guard order in the publisher (pin, cleanliness, token) before anything is built", () => {
    const source = read("scripts/publish-frontend.mjs");
    const guard = source.indexOf("evaluateFrontendPublicationGuard");
    const dirty = source.indexOf("args.requireClean && dirty");
    const build = source.indexOf('run("npm"');
    expect(guard).toBeGreaterThan(-1);
    expect(dirty).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(build);
    expect(dirty).toBeLessThan(build);
    expect(source).toMatch(/WRONG_SOURCE_BRANCH/);
  });

  it("is wired as an npm script and used by the workflow before the upload", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["frontend:prebuilt"]).toBe("node scripts/prepare-vercel-output.mjs");

    const wf = read(".github/workflows/publish-development-frontend.yml");
    const verifyArtifact = wf.indexOf("npm run verify:frontend --");
    const prepare = wf.indexOf("npm run frontend:prebuilt --");
    const upload = wf.indexOf("node scripts/deploy-frontend-rest.mjs");
    const alias = wf.indexOf("v2/deployments/${deployment_host}/aliases");
    const verifyPublished = wf.indexOf("npm run verify:published --");
    for (const at of [verifyArtifact, prepare, upload, alias, verifyPublished]) expect(at).toBeGreaterThan(-1);
    expect(verifyArtifact).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(upload);
    expect(upload).toBeLessThan(alias);
    expect(alias).toBeLessThan(verifyPublished);
    // The old, rebuild-triggering invocation must not come back.
    expect(wf).not.toMatch(/deploy dist/);
    expect(wf).toMatch(/XSTARZ_REQUIRED_SOURCE_BRANCH/);
    expect(wf).toMatch(/--expect-build-info-sha256/);
    expect(wf).toMatch(/--expect-asset-names/);
  });

  it("documents the mechanism where the operator reads it", () => {
    const doc = read("docs/FRONTEND-PUBLICATION.md");
    expect(doc).toMatch(/--prebuilt/);
    expect(doc).toMatch(/frontend:prebuilt/);
    expect(doc).toMatch(/filesystem/);
    expect(doc).not.toMatch(/`vercel deploy dist` uploads static files as-is/);
  });
});

/** Sanity: the assembly is reproducible — same input, same bytes. */
describe("300 — the assembly is deterministic", () => {
  it("produces identical file hashes for an unchanged artifact", () => {
    const dist = fixtureDist();
    const first = assemble(dist);
    const second = assemble(dist);
    expect(first.result.ok && second.result.ok).toBe(true);
    if (!first.result.ok || !second.result.ok) return;
    expect(second.result.buildInfoSha256).toBe(first.result.buildInfoSha256);
    expect(second.result.fileList).toEqual(first.result.fileList);
    expect(second.result.configText).toBe(first.result.configText);
  });

  it("copies a file tree deeply enough to keep nested assets", () => {
    const dist = fixtureDist();
    mkdirSync(join(dist, "assets", "nested"), { recursive: true });
    writeFileSync(join(dist, "assets", "nested", "chunk.js"), "export const nested = 1;\n");
    const { result } = assemble(dist);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const relo = join(result.staticDir, "assets", "nested", "chunk.js");
    expect(readFileSync(relo, "utf8")).toBe("export const nested = 1;\n");
  });
});

