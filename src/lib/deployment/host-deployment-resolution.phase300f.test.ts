/**
 * Phase 300f — the browser-facing host is resolved, not merely listed.
 *
 * Production finding (run 36834839301, dispatched on main@1adcd9c): the
 * project-settings read succeeded — `GET /v9/projects/<id>?teamId=<org>` ->
 * 200, "project trade-intel-bot belongs to org team_eDGL…" — but the verifier
 * still returned HOST_NOT_ON_PROJECT, because a browser-facing `*.vercel.app`
 * host is often a DEPLOYMENT alias, not a project domain record: the project's
 * domains/aliases list was empty ("none") while the host demonstrably serves
 * the project. The credential, org, and project are all VALID; the host check
 * was too strict.
 *
 * Under test (operator-specified matrix):
 *   1. settings 200 + host absent from domains + `GET /v13/deployments/<host>`
 *      -> 200 with deployment.projectId == pinned id  => ACCEPT (VERIFIED),
 *      with the deployment-resolution evidence.
 *   2. same, but the deployment belongs to another project => REFUSE
 *      (HOST_POINTS_TO_DIFFERENT_PROJECT).
 *   3. deployment lookup 404 => REFUSE (HOST_NOT_ON_PROJECT).
 *   4. deployment lookup 403 => a NAMED per-endpoint permission failure
 *      (DEPLOYMENT_LOOKUP_REFUSED), never a blanket token verdict.
 *   5. the existing domain/alias path still verifies with a single probe.
 *
 * Contract locks: no `--allow-unverified-host` shortcut in the automation (a
 * host must be PROVEN, host -> deployment -> pinned project), and the token
 * never appears in any verdict output.
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

/** Fetch double keyed by endpoint shape, recording every call. */
function fetchShaped(handler: (url: string) => { ok: boolean; status: number; text: () => Promise<string> }) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    return handler(url);
  };
  return { impl, calls };
}

/** Run 36834839301's exact project-settings shape: 200, no domains/aliases. */
const bareProject = () => json({ name: "trade-intel-bot" }, 200);
const isDeploymentLookup = (url: string) => url.includes("/v13/deployments/");

describe("phase300f · the host is proven via deployment resolution when the project record does not list it", () => {
  it("settings 200 + host absent + deployment of the SAME project -> VERIFIED with resolution evidence", async () => {
    const { impl, calls } = fetchShaped((url) =>
      isDeploymentLookup(url) ? json({ projectId: PROJECT, url: "trade-intel-bot.vercel.app" }, 200) : bareProject(),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.VERIFIED);
    expect(exitCodeFor(report.state)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("/v13/deployments/trade-intel-bot.vercel.app");
    expect(calls[1]).toContain(`teamId=${ORG}`);
    expect(report.evidence.join("\n")).toContain(
      "browser-facing host resolves to deployment belonging to pinned project",
    );
    expect(report.hostUrl).toBe(HOST);
  });

  it("same case but the deployment belongs to ANOTHER project -> HOST_POINTS_TO_DIFFERENT_PROJECT (refused)", async () => {
    const { impl } = fetchShaped((url) =>
      isDeploymentLookup(url) ? json({ projectId: "prj_someOTHERproject" }, 200) : bareProject(),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.HOST_POINTS_TO_DIFFERENT_PROJECT);
    expect(exitCodeFor(report.state)).toBe(1);
    expect(report.problems.join(" ")).toContain("DIFFERENT project");
    expect(report.problems.join(" ")).toContain("prj_someOTHERproject");
    expect(report.hostUrl).toBeNull();
  });

  it("deployment lookup 404 -> HOST_NOT_ON_PROJECT (the host serves nobody we can prove)", async () => {
    const { impl, calls } = fetchShaped((url) =>
      isDeploymentLookup(url) ? json({ message: "Not Found" }, 404) : bareProject(),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.HOST_NOT_ON_PROJECT);
    expect(exitCodeFor(report.state)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(report.problems.join(" ")).toContain("does not serve");
    expect(report.problems.join(" ")).toContain("404");
  });

  it("deployment lookup 403 -> DEPLOYMENT_LOOKUP_REFUSED: a named per-endpoint permission failure", async () => {
    const { impl } = fetchShaped((url) =>
      isDeploymentLookup(url) ? json({ message: "Forbidden" }, 403) : bareProject(),
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf(),
      fetchImpl: impl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.DEPLOYMENT_LOOKUP_REFUSED);
    expect(exitCodeFor(report.state)).toBe(1);
    // NOT the blanket token verdict: the project settings themselves were readable.
    expect(report.state).not.toBe(PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG);
    expect(report.problems.join(" ")).toContain("/v13/deployments/");
    expect(report.problems.join(" ")).toContain("per-endpoint permission finding");
  });

  it("the existing domain/alias path still verifies with a single probe (no deployment call)", async () => {
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

  it("every resolution verdict keeps the token out of the output", async () => {
    const cases = [
      fetchShaped((url) =>
        isDeploymentLookup(url) ? json({ projectId: PROJECT }, 200) : bareProject(),
      ),
      fetchShaped((url) =>
        isDeploymentLookup(url) ? json({ projectId: "prj_other" }, 200) : bareProject(),
      ),
      fetchShaped((url) => (isDeploymentLookup(url) ? json({}, 404) : bareProject())),
      fetchShaped((url) => (isDeploymentLookup(url) ? json({}, 403) : bareProject())),
    ];
    for (const { impl } of cases) {
      const report = await verifyVercelProjectAccess({
        argv: argvOf(),
        env: envOf(),
        fetchImpl: impl,
      });
      expect(JSON.stringify(report)).not.toContain(TOKEN);
    }
  });
});

describe("phase300f · no unverified-host shortcut in the automation", () => {
  it("the workflow and publisher never pass --allow-unverified-host; the proof path is the verifier's", () => {
    const workflow = read(".github/workflows/publish-development-frontend.yml");
    const publisher = read("scripts/publish-frontend.mjs");
    expect(workflow).not.toContain("--allow-unverified-host");
    expect(publisher).not.toContain("--allow-unverified-host");
    // the deployment-resolution fallback exists in the verifier, with evidence
    const verifier = read("scripts/verify-vercel-project-access.mjs");
    expect(verifier).toContain("/v13/deployments/");
    expect(verifier).toContain("browser-facing host resolves to deployment belonging to pinned project");
    // the publisher still refuses anything that is not VERIFIED / SCOPE_METADATA_RISK
    expect(publisher).toContain("was rejected by the credential");
  });
});
