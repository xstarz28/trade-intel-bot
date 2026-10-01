/**
 * Phase 300g — the publication path performs NO user/team scope lookup.
 *
 * THE ACTUAL PRODUCTION ERROR (reproduced 2026-10-01 against a local mock of
 * the Vercel API with CLI 62.1.0 AND 59.1.3; run 36840069831 failed invisibly
 * on this because a `| tail` pipeline + `set -e` swallowed the CLI's output):
 *
 *   $ vercel deploy --prebuilt --yes        # .vercel/project.json link present
 *   GET /v2/user                              -> 404
 *   GET /teams/team_eDGLXdW7ZyigDFM57sqm6Pf0  -> 403 (code "forbidden")
 *   GET /v9/projects/prj_ms5x…?teamId=…       -> 200
 *   Error: Could not retrieve Project Settings. To link your Project, remove
 *   the `.vercel` directory and deploy again.                 [exit 1]
 *
 * The CLI tolerates ONLY the 403 code `team_unauthorized`
 * (`isOwnerLookupUnavailableError`), and NO invocation shape avoids the lookup:
 * reproduced identically with `--scope <teamId>`, `VERCEL_TEAM_ID=<teamId>`,
 * `--project <id>`, on both CLI versions. The upload itself is
 * project-scoped-safe: with the tolerated code the same CLI creates the
 * deployment through `POST /v13/deployments?…prebuilt=1` without any other
 * poisoned call.
 *
 * THE FIX under test: `scripts/lib/vercel-rest-deploy.mjs` + the workflow's
 * deploy step perform the CLI's EXACT prebuilt request directly (body captured
 * from a real CLI run — `version:2`, `source:"cli"`, `projectSettings:
 * {"sourceFilesOutsideRootDirectory":true}`, the `.vercel/output` sha list,
 * `POST /v2/files` uploads for `missing`, poll until READY) and touch ONLY
 * project-scoped endpoints. The regression lock: the recorded requests must
 * NEVER include `GET /v2/user` or `GET /teams/<org>` — the poisoned lookups
 * that killed runs 36827988817 (verdict misread), 36834839301 (host check) and
 * 36840069831 (invisible CLI failure) must stay impossible in this path.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  REST_DEPLOY_STATES,
  buildDeploymentRequestBody,
  collectOutputFiles,
  exitCodeFor,
  restDeployPrebuilt,
} from "../../../scripts/lib/vercel-rest-deploy.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const ORG = "team_eDGLXdW7ZyigDFM57sqm6Pf0";
const PROJECT = "prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb";
const TOKEN = "fake0000abcdef1234567890abcdef00";
const COMMIT = "bdd1715edfb563cbe5dfc04e77f1f0203c40f659";

/** A minimal assembled Build Output directory. */
async function makeOutput({ commit = COMMIT } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "rest-deploy-"));
  await mkdir(join(dir, "static", "assets"), { recursive: true });
  await writeFile(join(dir, "config.json"), JSON.stringify({ version: 3, routes: [] }));
  await writeFile(
    join(dir, "static", "build-info.json"),
    JSON.stringify({ commit, branch: "arena/01a0d195-trade-intel-bot" }),
  );
  await writeFile(join(dir, "static", "index.html"), "<html>x</html>");
  await writeFile(join(dir, "static", "assets", "app.js"), "console.log(1)".repeat(40));
  return dir;
}

type Recorded = { url: string; init: { method: string; headers: Record<string, string> } };

function happyFetch() {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    recorded.push({ url, init });
    const path = new URL(url).pathname;
    if (path === "/v9/projects/prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb")
      return json(200, { id: PROJECT, name: "trade-intel-bot" });
    if (path === "/v13/deployments" && init.method === "POST")
      return json(200, { id: "dpl_1", url: "trade-intel-bot-x.vercel.app", missing: [], readyState: "READY" });
    if (path === "/v13/deployments/dpl_1")
      return json(200, { id: "dpl_1", url: "trade-intel-bot-x.vercel.app", readyState: "READY" });
    return json(200, {});
  };
  return { impl, recorded };
}
const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

describe("phase300g · the REST deployer never performs the poisoned scope lookups", () => {
  it("touches ONLY project-scoped endpoints: no /v2/user, no /teams/, ever", async () => {
    const dir = await makeOutput();
    const { impl, recorded } = happyFetch();
    const result = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: impl,
    });
    expect(result.state).toBe(REST_DEPLOY_STATES.DEPLOYED);
    expect(result.deploymentUrl).toBe("https://trade-intel-bot-x.vercel.app");
    const urls = recorded.map((r) => new URL(r.url).pathname);
    expect(urls.some((p) => p === "/v2/user")).toBe(false);
    expect(urls.some((p) => p.startsWith("/teams/"))).toBe(false);
    expect(urls.some((p) => p.startsWith("/v9/projects/"))).toBe(false);
    for (const url of recorded.map((r) => r.url)) {
      expect(url).not.toContain("teamId=");
    }
  });

  it("sends the CLI's exact prebuilt create request (captured 2026-10-01)", async () => {
    const dir = await makeOutput();
    const { impl, recorded } = happyFetch();
    await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: impl,
    });
    const create = recorded.find((r) => new URL(r.url).pathname === "/v13/deployments");
    expect(create).toBeTruthy();
    expect(new URL(create!.url).search).toContain("skipAutoDetectionConfirmation=1");
    expect(new URL(create!.url).search).toContain("prebuilt=1");
    expect(new URL(create!.url).search).not.toContain("teamId=");
    expect(create!.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse((create!.init as unknown as { body: string }).body as string);
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["env", "build", "name", "project", "meta", "projectSettings", "source", "version", "files"]),
    );
    expect(body.source).toBe("cli");
    expect(body.version).toBe(2);
    expect(body.projectSettings).toEqual({ sourceFilesOutsideRootDirectory: true });
    expect(body.name).toBe("trade-intel-bot");
    expect(body.project).toBe(PROJECT);
    const files = body.files as Array<{ file: string; sha: string }>;
    expect(files.some((f) => f.file === ".vercel/output/config.json")).toBe(true);
    expect(files.some((f) => f.file === ".vercel/output/static/assets/app.js")).toBe(true);
  });

  it("uploads only the shas the server names as missing, with the CLI's digest headers", async () => {
    const dir = await makeOutput();
    const recorded: Recorded[] = [];
    let missingRequested = false;
    const impl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      recorded.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/v13/deployments" && init.method === "POST") {
        missingRequested = true;
        const files = JSON.parse((init as unknown as { body: string }).body).files as Array<{
          file: string;
          sha: string;
        }>;
        const appJs = files.find((f) => f.file === ".vercel/output/static/assets/app.js")!;
        return json(200, { id: "dpl_1", url: "trade-intel-bot-x.vercel.app", missing: [appJs.sha], readyState: "READY" });
      }
      if (path === "/v2/files") return json(200, {});
      if (path === "/v13/deployments/dpl_1")
        return json(200, { id: "dpl_1", url: "trade-intel-bot-x.vercel.app", readyState: "READY" });
      return json(200, {});
    };
    const result = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: impl,
    });
    expect(missingRequested).toBe(true);
    expect(result.state).toBe(REST_DEPLOY_STATES.DEPLOYED);
    const upload = recorded.find((r) => new URL(r.url).pathname === "/v2/files");
    expect(upload).toBeTruthy();
    expect(upload!.init.headers["x-now-digest"]).toMatch(/^[0-9a-f]{40}$/);
    expect(upload!.init.headers["content-type"]).toBe("application/octet-stream");
    // the upload is bounded by the verified file list — an unknown sha is refused
    const result2 = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: async (url, init) => {
        if (new URL(url).pathname === "/v13/deployments" && init.method === "POST")
          return json(200, { id: "dpl_1", url: "x.vercel.app", missing: ["deadbeef".repeat(5)] });
        if (new URL(url).pathname === "/v9/projects/prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb")
          return json(200, { id: PROJECT, name: "trade-intel-bot" });
        return json(200, {});
      },
    });
    expect(result2.state).toBe(REST_DEPLOY_STATES.UPLOAD_FAILED);
    expect(result2.problems.join(" ")).toContain("not in the verified file list");
  });
});

describe("phase300g · fail-closed before any byte leaves the runner", () => {
  it("refuses to run without the verified artifact (no config.json / wrong commit)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rest-deploy-"));
    const noConfig = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: happyFetch().impl,
    });
    expect(noConfig.state).toBe(REST_DEPLOY_STATES.ARTIFACT_INVALID);
    expect(noConfig.problems.join(" ")).toContain("config.json");

    const wrongCommit = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: await makeOutput({ commit: "fca4575a14a1f6542f065482788f761d5cf7c5b8" }),
      expectCommit: COMMIT,
      fetchImpl: happyFetch().impl,
    });
    expect(wrongCommit.state).toBe(REST_DEPLOY_STATES.ARTIFACT_INVALID);
    expect(wrongCommit.problems.join(" ")).toContain("not the verified artifact");
  });

  it("does not perform a redundant project-settings read after target verification", async () => {
    const dir = await makeOutput();
    const recorded: Recorded[] = [];
    const impl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      recorded.push({ url, init });
      const path = new URL(url).pathname;
      if (path.startsWith("/v9/projects/"))
        return json(403, { error: { code: "forbidden", message: "Not authorized" } });
      if (path === "/v13/deployments" && init.method === "POST")
        return json(200, { id: "dpl_2", url: "trade-intel-bot-y.vercel.app", missing: [], readyState: "READY" });
      if (path === "/v13/deployments/dpl_2")
        return json(200, { id: "dpl_2", url: "trade-intel-bot-y.vercel.app", readyState: "READY" });
      throw new Error(`unexpected endpoint: ${path}`);
    };
    const result = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: impl,
    });
    expect(result.state).toBe(REST_DEPLOY_STATES.DEPLOYED);
    expect(recorded.some((r) => new URL(r.url).pathname.startsWith("/v9/projects/"))).toBe(false);
  });

  it("names the create refusal and the deployment failure instead of hiding them", async () => {
    const dir = await makeOutput();
    const createRefused = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: async (url, init) =>
        new URL(url).pathname === "/v13/deployments" && init.method === "POST"
          ? json(403, { error: { code: "forbidden", message: "nope" } })
          : json(200, { id: PROJECT, name: "trade-intel-bot" }),
    });
    expect(createRefused.state).toBe(REST_DEPLOY_STATES.CREATE_REFUSED);
    expect(createRefused.problems.join(" ")).toContain("HTTP 403");

    const failed = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: dir,
      expectCommit: COMMIT,
      fetchImpl: async (url, init) => {
        const path = new URL(url).pathname;
        if (path === "/v13/deployments" && init.method === "POST")
          return json(200, { id: "dpl_1", url: "x.vercel.app", missing: [] });
        if (path === "/v13/deployments/dpl_1") return json(200, { id: "dpl_1", readyState: "ERROR" });
        return json(200, { id: PROJECT, name: "trade-intel-bot" });
      },
    });
    expect(failed.state).toBe(REST_DEPLOY_STATES.DEPLOYMENT_FAILED);
    expect(failed.problems.join(" ")).toContain("readyState=ERROR");
  });

  it("cannot even start without a credential or a complete target (exit class 2)", async () => {
    const noToken = await restDeployPrebuilt({
      orgId: ORG,
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: "",
      outputDir: await makeOutput(),
      fetchImpl: happyFetch().impl,
    });
    expect(noToken.state).toBe(REST_DEPLOY_STATES.NO_CREDENTIAL);
    expect(exitCodeFor(noToken.state)).toBe(2);
    const incomplete = await restDeployPrebuilt({
      orgId: "",
      projectId: PROJECT,
      projectName: "trade-intel-bot",
      token: TOKEN,
      outputDir: await makeOutput(),
      fetchImpl: happyFetch().impl,
    });
    expect(incomplete.state).toBe(REST_DEPLOY_STATES.INCOMPLETE_TARGET);
    expect(exitCodeFor(incomplete.state)).toBe(2);
    expect(exitCodeFor(REST_DEPLOY_STATES.DEPLOYED)).toBe(0);
    expect(exitCodeFor(REST_DEPLOY_STATES.CREATE_REFUSED)).toBe(1);
  });

  it("keeps the token out of every verdict, including failures", async () => {
    const dir = await makeOutput();
    const results = await Promise.all([
      restDeployPrebuilt({ orgId: ORG, projectId: PROJECT, projectName: "trade-intel-bot", token: TOKEN, outputDir: dir, expectCommit: COMMIT, fetchImpl: happyFetch().impl }),
      restDeployPrebuilt({ orgId: ORG, projectId: PROJECT, projectName: "trade-intel-bot", token: TOKEN, outputDir: dir, expectCommit: COMMIT, fetchImpl: async () => json(403, {}) }),
      restDeployPrebuilt({ orgId: ORG, projectId: PROJECT, projectName: "trade-intel-bot", token: "", outputDir: dir, fetchImpl: happyFetch().impl }),
    ]);
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });
});

describe("phase300g · the workflow and publisher use this path, with full error visibility", () => {
  it("the workflow deploy step runs the REST script with argv ids, captured streams, direct exit code", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    expect(workflow).toContain("env -u VERCEL_ORG_ID -u VERCEL_PROJECT_ID node scripts/deploy-frontend-rest.mjs");
    expect(workflow).toContain('>"$out_file" 2>"$err_file"');
    expect(workflow).toContain("deploy_status=$?");
    expect(workflow).toContain('project_name="$(jq -r '.projectName // empty' "$target_report")"');
    expect(workflow).toContain('--project-name "$XSTARZ_VERCEL_PROJECT_NAME"');
    expect(workflow).not.toContain("GET /v9/projects/<id>");
    // the OLD swallowing pipeline is gone for good
    expect(workflow).not.toContain("deploy --prebuilt --yes 2>&1 | tail -n 1");
    expect(workflow).not.toContain("vercel@latest deploy");
    // the token is never an argument
    expect(workflow).not.toMatch(/--token/);
  });

  it("the publisher deploys through restDeployPrebuilt and fails by named state", () => {
    const publisher = read("scripts/publish-frontend.mjs");
    expect(publisher).toContain("restDeployPrebuilt({");
    expect(publisher).toContain("projectName: target.projectName");
    expect(publisher).toContain("expectCommit: head");
    expect(publisher).toContain("REST_DEPLOY_STATES.DEPLOYED");
    expect(publisher).toContain("the upload failed");
    // no CLI spawn for the deploy anywhere
    expect(publisher).not.toContain('"deploy"');
  });

  it("the alias path is untouched: teamId-scoped REST, from the 300e/300f contract", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    const publisher = read("scripts/publish-frontend.mjs");
    expect(workflow).not.toContain("v2/deployments/${deployment_host}/aliases?teamId=");
    expect(workflow).toContain("v2/deployments/${deployment_host}/aliases");
    expect(publisher).toContain("/aliases");
  });
});
