/**
 * Phase 300e — the A/B split the 401/403 verdict was missing.
 *
 * vercel/vercel#17506 (open, CLI 59.x, 2026-10): with a PROJECT-SCOPED token
 * the CLI's own debug trace shows `GET /v2/user` -> 404, `GET /teams/<org>` ->
 * 403, and the teamId-suffixed project read -> 200 — yet the CLI still throws
 * "Could not retrieve Project Settings." So a refused teamId-suffixed read is
 * NOT, by itself, proof that the credential cannot read the project: for some
 * project-scoped tokens the suffixed form is refused while the UNSUFFIXED form
 * succeeds, and the genuinely broken part is the CLI's user/team scope
 * resolution that the pinned flow can avoid entirely.
 *
 * Under test:
 *   case B  suffixed 401/403 + unsuffixed 200
 *           -> PROJECT_ACCESS_SCOPE_METADATA_RISK, exit 0 (proceed; the
 *              pipeline avoids the poisoned lookups), both reads disclosed.
 *   case A  suffixed 401/403 + unsuffixed also refused
 *           -> TOKEN_CANNOT_ACCESS_ORG, exit 1 (a real refusal stays named).
 *   200 on the suffixed read -> single probe, VERIFIED unchanged.
 *
 * Plus the publication contract that removes the trigger: the deploy step
 * selects the project through the `.vercel/project.json` link file and DROPS
 * the org/project env vars (the shape that drives the CLI's poisoned scope
 * resolution), and the alias is assigned through the teamId-scoped REST API
 * (`POST /v2/deployments/<deployment>/aliases?teamId=<org>`) instead of
 * `vercel alias set`, which performs a user lookup a project-scoped token
 * cannot satisfy.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROJECT_ACCESS_STATES,
  exitCodeFor,
  verifyVercelProjectAccess,
} from "../../../scripts/verify-vercel-project-access.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const ORG = "team_eDGLXdW7ZyigDFM57sqm6Pf0";
const PROJECT = "prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb";
const HOST = "https://trade-intel-bot.vercel.app";
const TOKEN = "fake-token-for-injectable-fetch-only";

const argvOf = () => ["--org-id", ORG, "--project-id", PROJECT, "--host-url", HOST];
const envOf = () => ({ VERCEL_TOKEN: TOKEN });

const json = (body: unknown, status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

/** Fetch double keyed by URL shape, recording every call. */
function fetchShaped(handler: (url: string) => { ok: boolean; status: number; text: () => Promise<string> }) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    return handler(url);
  };
  return { impl, calls };
}

const projectBody = { name: "trade-intel-bot", framework: null };

describe("phase300e · verifier splits a refused suffixed read into case A vs case B", () => {
  it("case B: suffixed 403 + unsuffixed 200 -> SCOPE_METADATA_RISK, exit 0, both reads disclosed", async () => {
    const { impl, calls } = fetchShaped((url) =>
      url.includes("teamId=") ? json({ message: "Forbidden" }, 403) : json(projectBody, 200),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK);
    expect(exitCodeFor(report.state)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`teamId=${ORG}`);
    expect(calls[1]).not.toContain("teamId=");
    expect(report.scopeNote).toContain("vercel/vercel#17506");
    expect(report.evidence.join("\n")).toContain("(no teamId)");
  });

  it("case B covers 401 the same way: suffixed 401 + unsuffixed 200 -> SCOPE_METADATA_RISK", async () => {
    const { impl } = fetchShaped((url) =>
      url.includes("teamId=") ? json({ message: "Unauthorized" }, 401) : json(projectBody, 200),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK);
    expect(exitCodeFor(report.state)).toBe(0);
  });

  it("case A stays named: suffixed 403 + unsuffixed 403 -> TOKEN_CANNOT_ACCESS_ORG, exit 1", async () => {
    const { impl, calls } = fetchShaped(() => json({ message: "Forbidden" }, 403));
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG);
    expect(exitCodeFor(report.state)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(report.problems.join(" ")).toContain("with AND without the org scope");
  });

  it("case A covers unsuffixed 404: suffixed 401 + unsuffixed 404 -> TOKEN_CANNOT_ACCESS_ORG", async () => {
    const { impl } = fetchShaped((url) =>
      url.includes("teamId=") ? json({ message: "Unauthorized" }, 401) : json({ message: "Not Found" }, 404),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG);
    expect(exitCodeFor(report.state)).toBe(1);
  });

  it("a 200 on the suffixed read is still VERIFIED with a single probe (no extra request)", async () => {
    const { impl, calls } = fetchShaped(() =>
      json({ name: "trade-intel-bot", alias: ["trade-intel-bot.vercel.app"] }, 200),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.VERIFIED);
    expect(exitCodeFor(report.state)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("the risk path never discloses the token value", async () => {
    const { impl } = fetchShaped((url) =>
      url.includes("teamId=") ? json({ message: "Forbidden" }, 403) : json(projectBody, 200),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });
});

describe("phase300e · the deploy step no longer drives the poisoned scope path", () => {
  it("the publisher selects the project through the link file and never drives the poisoned env shape", () => {
    const publisher = read("scripts/publish-frontend.mjs");
    // Phase 300g: the deploy is the in-process REST deployer — there is NO
    // child process at all, hence no org/project env injection (the shape
    // that drove the CLI's poisoned scope resolution) and no CLI to trigger it.
    expect(publisher).toContain("restDeployPrebuilt({");
    expect(publisher).toContain("orgId: target.orgId");
    expect(publisher).not.toMatch(/VERCEL_ORG_ID:\s*target\.orgId/);
    expect(publisher).not.toMatch(/run\(\s*"npx"\s*,\s*deployArgs/);
    expect(publisher).toContain("vercel/vercel#17506");
  });

  it("the publisher assigns the alias through the teamId-scoped REST API, not `vercel alias set`", () => {
    const publisher = read("scripts/publish-frontend.mjs");
    expect(publisher).toContain("/v2/deployments/");
    expect(publisher).toContain("/aliases?teamId=");
    expect(publisher).toContain('JSON.stringify({ alias: host })');
    expect(publisher).not.toContain('"alias", "set"');
    // a non-200 alias still fails the publication
    expect(publisher).toContain("aliasStatus !== 200");
  });

  it("the publisher accepts the risk verdict on the pinned path and still fails case A", () => {
    const publisher = read("scripts/publish-frontend.mjs");
    expect(publisher).toContain("PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK");
    expect(publisher).toContain("verdict.state === PROJECT_ACCESS_STATES.VERIFIED ||");
    expect(publisher).toContain("was rejected by the credential");
  });

  it("the workflow deploy invocation drops both org/project env vars and stays prebuilt", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    // Phase 300g: the deploy is the project-scoped REST script (the CLI's
    // linked flow reproduces the #17506 refusal before uploading), the ids go
    // in as ARGV identifiers, and BOTH env vars are still dropped from the
    // child environment.
    expect(workflow).toContain("env -u VERCEL_ORG_ID -u VERCEL_PROJECT_ID node scripts/deploy-frontend-rest.mjs");
    expect(workflow).toContain('--org-id "$org"');
    expect(workflow).toContain('--project-id "$project"');
    expect(workflow).toContain("--expect-commit \"$XSTARZ_ARTIFACT_COMMIT\"");
    expect(workflow).toContain("vercel/vercel#17506");
  });

  it("the workflow deploy step captures and prints BOTH streams and reads the exit code directly", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    const deployStep = workflow.slice(workflow.indexOf("Publish the verified bytes"));
    expect(deployStep).toContain('>"$out_file" 2>"$err_file"');
    expect(deployStep).toContain('cat "$out_file"');
    expect(deployStep).toContain('cat "$err_file" >&2');
    expect(deployStep).toContain("deploy_status=$?");
    // nothing pipes the deploy command itself; no `tail` can hide an error
    expect(deployStep).not.toMatch(/node scripts\/deploy-frontend-rest\.mjs[^\n]*\|/);
    // the URL is parsed from the captured FULL stdout, after both streams print
    const catAt = deployStep.indexOf('cat "$err_file" >&2');
    const parseAt = deployStep.indexOf('grep -oE');
    expect(parseAt).toBeGreaterThan(catAt);
  });

  it("the workflow alias step uses the REST endpoint and no longer calls `vercel alias set`", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    // Phase 300I: the project-scoped token cannot use the teamId-scoped alias
    // form — the alias is the PROJECT-scoped REST POST without teamId (live
    // verified by the 300K deployment).
    expect(workflow).toContain('"https://api.vercel.com/v2/deployments/${deployment_host}/aliases"');
    expect(workflow).not.toContain("/aliases?teamId=");
    expect(workflow).not.toContain("vercel@latest alias set");
    // the refusal still fails the run with a named annotation
    expect(workflow).toContain("::error title=Alias refused (HTTP ${code})");
  });

  it("the workflow verifier refusal annotation reflects the A/B split (no blanket 'regenerate token')", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    // Phase 300I-K: the runner no longer restates the verdict taxonomy inline —
    // it points at the verifier's own JSON evidence (which carries the named
    // states), so the annotation cannot drift from the classifier again. The
    // verifier still names both cases.
    expect(workflow).toContain("::error title=Pinned Vercel target failed credential validation");
    expect(workflow).toContain("its JSON evidence is printed above");
    expect(workflow).not.toMatch(/regenerate[^\n]*token/i);
    const verifier = read("scripts/verify-vercel-project-access.mjs");
    expect(verifier).toContain("TOKEN_CANNOT_ACCESS_ORG");
  });
});
