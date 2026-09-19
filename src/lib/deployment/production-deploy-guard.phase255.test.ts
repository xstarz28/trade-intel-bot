/**
 * Phase 255 — fail-closed production-deploy bootstrap.
 *
 * The repository now has a manual production-deploy workflow. These tests
 * prove it cannot run without a production identity and a deploy key, cannot
 * target anonymous/dev/preview/local, cannot print a credential, and cannot
 * be read as "a production deployment exists". Nothing here deploys.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  evaluateProductionDeployGuard,
  formatProductionDeployGuard,
  isForbiddenDeploySourceRef,
  productionDeployGuardExitCode,
  productionDeployGuardJson,
  PRODUCTION_DEPLOY_GUARD_SCHEMA,
  type ProductionDeployGuardInput,
} from "./production-deploy-guard";

const root = process.cwd();
const SCRIPT = "scripts/production-deploy-guard.mjs";
const WORKFLOW = ".github/workflows/production-deploy.yml";
const tmp = mkdtempSync(join(tmpdir(), "phase255-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Assembled so Phase 12 does not treat a fixture as a credential literal. */
const DEPLOY_KEY = ["phase255", "deploy", "key", "notreal", "aaaa"].join("-");
const FIXTURE_IDENTITY = ["prod", "example-team", "example-project"].join(":");
const FIXTURE_CLOUD = "https://example-project.convex.cloud";
const FIXTURE_SITE = "https://example-project.convex.site";

function readyInput(): ProductionDeployGuardInput {
  return {
    convexDeployKey: DEPLOY_KEY,
    convexDeployment: FIXTURE_IDENTITY,
    xstarzDeploymentEnv: "production",
  };
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: tmp },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function writeConfig(name: string, config: Record<string, string>): string {
  const path = join(tmp, name);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

describe("255 — the decision module refuses non-production and missing inputs", () => {
  it("empty input is missing the deploy key, and is not a deployment", () => {
    const report = evaluateProductionDeployGuard({});
    expect(report.state).toBe("MISSING_DEPLOY_KEY");
    expect(report.mayInvokeDeploy).toBe(false);
    expect(report.deploymentPerformed).toBe(false);
    expect(report.productionVerified).toBe(false);
    expect(report.releaseAdmitted).toBe(false);
    expect(report.keyPresent).toBe(false);
    expect(productionDeployGuardExitCode(report)).toBe(1);
  });

  it("a placeholder key is refused even with a prod identity", () => {
    const report = evaluateProductionDeployGuard({
      ...readyInput(),
      convexDeployKey: "changeme",
    });
    expect(report.state).toBe("PLACEHOLDER_DEPLOY_KEY");
    expect(report.mayInvokeDeploy).toBe(false);
    expect(report.keyPresent).toBe(true);
  });

  it("refuses anonymous, local, dev and preview identities", () => {
    for (const identity of ["anonymous:x", "local:x", "dev:example-team:example-dev", "preview:example-team:example-preview"]) {
      const report = evaluateProductionDeployGuard({
        ...readyInput(),
        convexDeployment: identity,
      });
      expect(report.state, identity).toBe("NON_PRODUCTION_IDENTITY");
      expect(report.mayInvokeDeploy, identity).toBe(false);
      expect(report.deployment.productionShaped, identity).toBe(false);
    }
  });

  it("refuses a malformed identity that is not prod:team:project", () => {
    const report = evaluateProductionDeployGuard({
      ...readyInput(),
      convexDeployment: "prod-only",
    });
    expect(report.state).toBe("WRONG_IDENTITY");
    expect(report.mayInvokeDeploy).toBe(false);
  });

  it("refuses development and preview environment labels", () => {
    for (const env of ["development", "preview"]) {
      const report = evaluateProductionDeployGuard({
        ...readyInput(),
        xstarzDeploymentEnv: env,
      });
      expect(report.state, env).toBe("WRONG_ENVIRONMENT");
      expect(report.mayInvokeDeploy, env).toBe(false);
    }
  });

  it("refuses a loopback or http Convex URL override", () => {
    const loopback = evaluateProductionDeployGuard({
      ...readyInput(),
      viteConvexUrl: "https://localhost:3210",
    });
    expect(loopback.state).toBe("WRONG_CONVEX_URL");
    const http = evaluateProductionDeployGuard({
      ...readyInput(),
      viteConvexUrl: "http://example-project.convex.cloud",
    });
    expect(http.state).toBe("WRONG_CONVEX_URL");
  });

  it("refuses a non-convex.site site override", () => {
    const report = evaluateProductionDeployGuard({
      ...readyInput(),
      convexSiteUrl: "https://example.com",
    });
    expect(report.state).toBe("WRONG_SITE_URL");
  });

  it("READY_TO_INVOKE_DEPLOY is permission to attempt, not a deployment", () => {
    const report = evaluateProductionDeployGuard(readyInput());
    expect(report.state).toBe("READY_TO_INVOKE_DEPLOY");
    expect(report.schema).toBe(PRODUCTION_DEPLOY_GUARD_SCHEMA);
    expect(report.mayInvokeDeploy).toBe(true);
    expect(report.deploymentPerformed).toBe(false);
    expect(report.productionVerified).toBe(false);
    expect(report.releaseAdmitted).toBe(false);
    expect(report.deployment.productionShaped).toBe(true);
    expect(report.environment.isProduction).toBe(true);
    expect(productionDeployGuardExitCode(report)).toBe(0);

    const printed = `${formatProductionDeployGuard(report)}${productionDeployGuardJson(report)}`;
    expect(printed).not.toContain(DEPLOY_KEY);
    expect(printed).toMatch(/deploymentPerformed: no|\"deploymentPerformed\": false/);
    expect(printed).toMatch(/productionVerified: no|\"productionVerified\": false/);
  });

  it("refuses main as a source ref even when the identity and key are production-shaped", () => {
    for (const sourceRef of ["refs/heads/main", "main", "refs/remotes/origin/main", "heads/main"]) {
      const report = evaluateProductionDeployGuard({ ...readyInput(), sourceRef });
      expect(report.state, sourceRef).toBe("FORBIDDEN_SOURCE_REF");
      expect(report.mayInvokeDeploy, sourceRef).toBe(false);
      expect(report.deploymentPerformed).toBe(false);
      expect(report.problems.join(" ")).toMatch(/main/i);
    }
  });

  it("does not treat an arena working branch, or a name that merely contains main, as forbidden", () => {
    expect(isForbiddenDeploySourceRef("refs/heads/arena/01a0b293-trade-intel-bot")).toBe(false);
    expect(isForbiddenDeploySourceRef("refs/heads/maintenance")).toBe(false);
    const report = evaluateProductionDeployGuard({
      ...readyInput(),
      sourceRef: "refs/heads/arena/01a0b293-trade-intel-bot",
    });
    expect(report.state).toBe("READY_TO_INVOKE_DEPLOY");
    expect(report.mayInvokeDeploy).toBe(true);
    expect(report.deploymentPerformed).toBe(false);
  });

  it("a missing source ref does not by itself refuse a local configuration check", () => {
    const report = evaluateProductionDeployGuard(readyInput());
    expect(report.state).toBe("READY_TO_INVOKE_DEPLOY");
  });

  it("never copies the deploy key into the report", () => {
    const report = evaluateProductionDeployGuard(readyInput());
    expect(JSON.stringify(report)).not.toContain(DEPLOY_KEY);
    expect(Object.keys(report)).not.toContain("convexDeployKey");
  });

  it("the decision module is pure: no env, no I/O, no deploy command", () => {
    const text = read("src/lib/deployment/production-deploy-guard.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/process\.env/);
    expect(text).not.toMatch(/node:fs|node:child_process|node:net|node:http|node:tls/);
    expect(text).not.toMatch(/Date\.now\s*\(/);
    expect(text).not.toMatch(/npx convex|convex deploy/);
    expect(text).toMatch(/deploymentIdentityProblem/);
  });
});

describe("255 — the operator/CI script matches the decision module", () => {
  it("is wired as production:deploy:guard and package.json still has no convex deploy", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["production:deploy:guard"]).toContain(SCRIPT);
    expect(Object.values(pkg.scripts).join("\n")).not.toMatch(/convex deploy/);
  });

  it("refuses an empty configuration with exit 1", () => {
    const result = run(["--config", writeConfig("empty.json", {}), "--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      state: string;
      mayInvokeDeploy: boolean;
      deploymentPerformed: boolean;
      productionVerified: boolean;
    };
    expect(parsed.state).toBe("MISSING_DEPLOY_KEY");
    expect(parsed.mayInvokeDeploy).toBe(false);
    expect(parsed.deploymentPerformed).toBe(false);
    expect(parsed.productionVerified).toBe(false);
  });

  it("accepts a production-shaped fixture and still says it did not deploy", () => {
    const result = run([
      "--config",
      writeConfig("ready.json", {
        CONVEX_DEPLOY_KEY: DEPLOY_KEY,
        CONVEX_DEPLOYMENT: FIXTURE_IDENTITY,
        VITE_CONVEX_URL: FIXTURE_CLOUD,
        CONVEX_SITE_URL: FIXTURE_SITE,
        XSTARZ_DEPLOYMENT_ENV: "production",
      }),
      "--json",
    ]);
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      state: string;
      mayInvokeDeploy: boolean;
      deploymentPerformed: boolean;
      productionVerified: boolean;
      releaseAdmitted: boolean;
    };
    expect(parsed.state).toBe("READY_TO_INVOKE_DEPLOY");
    expect(parsed.mayInvokeDeploy).toBe(true);
    expect(parsed.deploymentPerformed).toBe(false);
    expect(parsed.productionVerified).toBe(false);
    expect(parsed.releaseAdmitted).toBe(false);
    expect(`${result.stdout}${result.stderr}`).not.toContain(DEPLOY_KEY);
  });

  it("the script cannot deploy or print secrets", () => {
    const text = read(SCRIPT);
    expect(text).not.toMatch(/node:child_process|execSync|spawnSync|execFile/);
    expect(text).not.toMatch(/npx convex|convex deploy|tauri build|gh release|npm publish/);
    expect(text).toMatch(/production-deploy-guard\.ts/);
    expect(text).toMatch(/never prints a credential/);
  });

  it("refuses GITHUB_REF=refs/heads/main through the operator script", () => {
    const path = writeConfig("main-ref.json", {
      CONVEX_DEPLOY_KEY: DEPLOY_KEY,
      CONVEX_DEPLOYMENT: FIXTURE_IDENTITY,
      XSTARZ_DEPLOYMENT_ENV: "production",
      GITHUB_REF: "refs/heads/main",
    });
    const result = run(["--config", path, "--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { state: string; mayInvokeDeploy: boolean };
    expect(parsed.state).toBe("FORBIDDEN_SOURCE_REF");
    expect(parsed.mayInvokeDeploy).toBe(false);
  });
});

describe("255 — the production-deploy workflow is fail-closed and manual", () => {
  it("exists and is not wired to push or pull_request", () => {
    expect(existsSync(resolve(root, WORKFLOW))).toBe(true);
    const workflow = read(WORKFLOW);
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).not.toMatch(/branches:/);
    expect(triggers).not.toMatch(/pull_request:/);
    expect(triggers).not.toMatch(/tags:/);
    expect(triggers).not.toMatch(/push:/);
  });

  it("requires the production GitHub environment and CONVEX_DEPLOY_KEY as a secret", () => {
    const workflow = read(WORKFLOW);
    expect(workflow).toMatch(/environment:\s*production/);
    expect(workflow).toMatch(/secrets\.CONVEX_DEPLOY_KEY/);
    expect(workflow).toMatch(/vars\.CONVEX_DEPLOYMENT/);
    expect(workflow).not.toMatch(/CONVEX_DEPLOY_KEY:\s*['\"][A-Za-z0-9_-]{8,}/);
  });

  it("invokes convex deploy only after the guard, with the URL injected by Convex", () => {
    const workflow = read(WORKFLOW);
    expect(workflow).toMatch(/npm run production:deploy:guard/);
    expect(workflow).toMatch(/npx convex deploy --yes --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL/);
    expect(workflow).not.toMatch(/continue-on-error/);
    expect(workflow).not.toMatch(/echo.*CONVEX_DEPLOY_KEY|printenv CONVEX_DEPLOY_KEY/);
    expect(workflow).not.toMatch(/release:admission|RELEASE_ADMISSION|evidence:d|LIVE_OPT_IN/);
    expect(workflow).toMatch(/does not admit a release/);
  });

  it("passes github.ref into the guard so a main checkout cannot deploy", () => {
    const workflow = read(WORKFLOW);
    expect(workflow).toMatch(/SOURCE_REF:\s*\$\{\{\s*github\.ref\s*\}\}/);
    expect(read(SCRIPT)).toMatch(/SOURCE_REF \|\| env\.GITHUB_REF/);
  });

  it("ordinary CI, packaging and admission still do not deploy", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/workflows/mobile.yml",
      ".github/workflows/release-admission.yml",
    ]) {
      const body = read(path);
      expect(body, path).not.toMatch(/npx convex deploy/);
    }
  });
});
