/**
 * Phase 286 — the development deploy guard, and the workflow that uses it.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * A workflow that can deploy has two failure modes worth a test:
 *
 *   1. it deploys somewhere it should not — production, or a `preview:` target
 *      accepted merely because it is "not production";
 *   2. it can be reached by something other than a deliberate human action.
 *
 * Both are structural, so they are checked structurally against the real files
 * rather than by prose. The guard's behaviour is checked by execution, because
 * it is pure and runs here.
 *
 * The polarity is the whole point: `production-deploy-guard` refuses
 * development; this one refuses production. A future reader must be able to see
 * that neither guard can be satisfied by the other's inputs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_DEPLOYMENT_IDENTITY_PATTERN,
  DEVELOPMENT_DEPLOY_GUARD_SCHEMA,
  evaluateDevelopmentDeployGuard,
} from "./development-deploy-guard";
import { evaluateProductionDeployGuard } from "./production-deploy-guard";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const WORKFLOW = ".github/workflows/development-deploy.yml";
const SCRIPT = "scripts/development-deploy-guard.mjs";

/** A key that is neither placeholder-shaped nor a real credential. */
const DEPLOY_KEY = "abcdefghijklmnop0123456789";

const DEV = {
  convexDeployKey: DEPLOY_KEY,
  convexDeployment: "dev:gil-xstarz:trade-intel",
  viteConvexUrl: "https://tough-goose-455.convex.cloud",
  convexSiteUrl: "https://tough-goose-455.convex.site",
  xstarzDeploymentEnv: "development",
  sourceRef: "refs/heads/arena/01a0d195-trade-intel-bot",
};

describe("286 — the development guard is ready only for a development target", () => {
  it("accepts a development identity with a real-looking key", () => {
    const report = evaluateDevelopmentDeployGuard(DEV);
    expect(report.schema).toBe(DEVELOPMENT_DEPLOY_GUARD_SCHEMA);
    expect(report.state).toBe("READY_TO_INVOKE_DEV_DEPLOY");
    expect(report.mayInvokeDeploy).toBe(true);
    expect(report.deployment.developmentShaped).toBe(true);
    expect(report.deployment.productionShaped).toBe(false);
    // A green guard is permission to attempt, never a result.
    expect(report.deploymentPerformed).toBe(false);
    expect(report.productionVerified).toBe(false);
    expect(report.releaseAdmitted).toBe(false);
  });

  it("FAILS CLOSED when CONVEX_DEPLOYMENT points at production", () => {
    const report = evaluateDevelopmentDeployGuard({
      ...DEV,
      convexDeployment: "prod:gil-xstarz:trade-intel",
      xstarzDeploymentEnv: "production",
    });
    expect(report.state).toBe("PRODUCTION_IDENTITY");
    expect(report.mayInvokeDeploy).toBe(false);
    expect(report.deployment.productionShaped).toBe(true);
    expect(report.problems.join(" ")).toMatch(/must never target production/);
  });

  it("does not accept `preview:` (or local/anonymous) as a development target", () => {
    for (const name of [
      "preview:gil-xstarz:trade-intel",
      "local:gil-xstarz:trade-intel",
      "anonymous:gil-xstarz:trade-intel",
    ]) {
      const report = evaluateDevelopmentDeployGuard({ ...DEV, convexDeployment: name });
      expect(report.state, name).toBe("WRONG_IDENTITY");
      expect(report.mayInvokeDeploy, name).toBe(false);
    }
  });

  it("refuses a missing, placeholder or too-short key", () => {
    expect(evaluateDevelopmentDeployGuard({ ...DEV, convexDeployKey: undefined }).state).toBe(
      "MISSING_DEPLOY_KEY",
    );
    expect(evaluateDevelopmentDeployGuard({ ...DEV, convexDeployKey: "your-key-here" }).state).toBe(
      "PLACEHOLDER_DEPLOY_KEY",
    );
    expect(evaluateDevelopmentDeployGuard({ ...DEV, convexDeployKey: "short" }).state).toBe(
      "PLACEHOLDER_DEPLOY_KEY",
    );
    expect(evaluateDevelopmentDeployGuard({ ...DEV, convexDeployKey: undefined }).keyPresent).toBe(
      false,
    );
    // Presence is reported; the value is never carried into the report.
    const report = evaluateDevelopmentDeployGuard(DEV);
    expect(JSON.stringify(report)).not.toContain(DEPLOY_KEY);
  });

  it("refuses `main` as a deploy source, for development as well as production", () => {
    for (const ref of ["main", "refs/heads/main", "origin/main", "refs/remotes/origin/main"]) {
      const report = evaluateDevelopmentDeployGuard({ ...DEV, sourceRef: ref });
      expect(report.state, ref).toBe("FORBIDDEN_SOURCE_REF");
      expect(report.mayInvokeDeploy, ref).toBe(false);
    }
    // A branch that merely contains the word is not `main`.
    expect(
      evaluateDevelopmentDeployGuard({ ...DEV, sourceRef: "refs/heads/maintenance/x" }).state,
    ).toBe("READY_TO_INVOKE_DEV_DEPLOY");
  });

  it("refuses a declared environment that is not development", () => {
    expect(
      evaluateDevelopmentDeployGuard({ ...DEV, xstarzDeploymentEnv: "production" }).state,
    ).toBe("WRONG_ENVIRONMENT");
    expect(evaluateDevelopmentDeployGuard({ ...DEV, xstarzDeploymentEnv: "preview" }).state).toBe(
      "WRONG_ENVIRONMENT",
    );
    expect(evaluateDevelopmentDeployGuard({ ...DEV, xstarzDeploymentEnv: "banana" }).state).toBe(
      "WRONG_ENVIRONMENT",
    );
    // Undeclared is allowed: the deployment's own value governs its runtime.
    expect(
      evaluateDevelopmentDeployGuard({ ...DEV, xstarzDeploymentEnv: undefined }).state,
    ).toBe("READY_TO_INVOKE_DEV_DEPLOY");
  });

  it("refuses endpoint URLs that are not https Convex hosts", () => {
    for (const url of [
      "http://tough-goose-455.convex.cloud",
      "https://evil.example.com",
      "https://localhost:3210",
      "not a url",
    ]) {
      const report = evaluateDevelopmentDeployGuard({ ...DEV, viteConvexUrl: url });
      expect(report.state, url).toBe("WRONG_CONVEX_URL");
    }
    expect(
      evaluateDevelopmentDeployGuard({ ...DEV, convexSiteUrl: "https://x.convex.cloud" }).state,
    ).toBe("WRONG_SITE_URL");
    // Absent URLs are not a refusal: this guard judges the identity, and the
    // workflow only uses the URL for an optional version probe.
    const bare = evaluateDevelopmentDeployGuard({
      convexDeployKey: DEPLOY_KEY,
      convexDeployment: "dev:gil-xstarz:trade-intel",
    });
    expect(bare.state).toBe("READY_TO_INVOKE_DEV_DEPLOY");
    expect(bare.urls.viteConvexUrlHost).toBeNull();
  });

  it("is the exact inverse of the production guard on the identity axis", () => {
    const dev = evaluateDevelopmentDeployGuard(DEV);
    const prodShapedForProd = evaluateProductionDeployGuard({
      convexDeployKey: DEPLOY_KEY,
      convexDeployment: "prod:gil-xstarz:trade-intel",
      xstarzDeploymentEnv: "production",
      sourceRef: DEV.sourceRef,
    });
    expect(dev.mayInvokeDeploy).toBe(true);
    expect(prodShapedForProd.mayInvokeDeploy).toBe(true);

    // Neither guard may be satisfied by the other guard's identity.
    const devInputsThroughProd = evaluateProductionDeployGuard({
      convexDeployKey: DEPLOY_KEY,
      convexDeployment: DEV.convexDeployment,
      xstarzDeploymentEnv: "production",
      sourceRef: DEV.sourceRef,
    });
    const prodInputsThroughDev = evaluateDevelopmentDeployGuard({
      ...DEV,
      convexDeployment: "prod:gil-xstarz:trade-intel",
    });
    expect(devInputsThroughProd.mayInvokeDeploy).toBe(false);
    expect(prodInputsThroughDev.mayInvokeDeploy).toBe(false);
  });

  it("is deterministic and free of ambient input", () => {
    const a = evaluateDevelopmentDeployGuard(DEV);
    const b = evaluateDevelopmentDeployGuard(DEV);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(DEVELOPMENT_DEPLOYMENT_IDENTITY_PATTERN.test("dev:team:project")).toBe(true);
    expect(DEVELOPMENT_DEPLOYMENT_IDENTITY_PATTERN.test("prod:team:project")).toBe(false);
  });
});

describe("286 — the guard CLI never prints a credential", () => {
  it("exists and reads the identity from the environment or a config file", () => {
    const script = read(SCRIPT);
    expect(script).toMatch(/process\.env/);
    expect(script).toMatch(/SOURCE_REF \|\| env\.GITHUB_REF/);
    // The key is only ever passed into the policy module.
    expect(script).toMatch(/convexDeployKey: env\.CONVEX_DEPLOY_KEY/);
    expect(script).not.toMatch(/console\.(log|error)\([^)]*CONVEX_DEPLOY_KEY/);
  });

  it("is wired as an npm script that both jobs can call", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["development:deploy:guard"]).toContain("scripts/development-deploy-guard.mjs");
    // The production guard's entry point must be intact.
    expect(pkg.scripts["production:deploy:guard"]).toContain("scripts/production-deploy-guard.mjs");
  });
});

describe("286 — the development workflow is manual, development-scoped and fail-closed", () => {
  const workflow = read(WORKFLOW);

  it("exists and is wired to workflow_dispatch only", () => {
    expect(existsSync(resolve(root, WORKFLOW))).toBe(true);
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).not.toMatch(/^ {2}push:/m);
    expect(triggers).not.toMatch(/^ {2}pull_request:/m);
    expect(triggers).not.toMatch(/^ {2}schedule:/m);
    expect(triggers).not.toMatch(/^ {2}tags:/m);
  });

  it("runs in the development GitHub environment and never in production", () => {
    const environments = [...workflow.matchAll(/^\s+environment:\s*(\S+)$/gm)].map((m) => m[1]);
    expect(environments.length).toBeGreaterThanOrEqual(2);
    for (const name of environments) expect(name).toBe("development");
    expect(workflow).not.toMatch(/environment:\s*production/);
  });

  it("requires the deploy key as a secret and the identity as a variable", () => {
    expect(workflow).toMatch(/secrets\.CONVEX_DEPLOY_KEY/);
    expect(workflow).toMatch(/vars\.CONVEX_DEPLOYMENT/);
    // No literal key material, and nothing that would echo the secret.
    expect(workflow).not.toMatch(/CONVEX_DEPLOY_KEY:\s*['"][A-Za-z0-9_-]{8,}/);
    expect(workflow).not.toMatch(/echo[^\n]*\$\{?CONVEX_DEPLOY_KEY|printenv CONVEX_DEPLOY_KEY/);
  });

  it("runs the guard before the deploy, in both jobs, and prints only safe metadata", () => {
    const guardCalls = [...workflow.matchAll(/npm run development:deploy:guard/g)];
    expect(guardCalls.length).toBe(2);
    const deployAt = workflow.indexOf("npx convex dev --once");
    expect(deployAt).toBeGreaterThan(workflow.lastIndexOf("npm run development:deploy:guard"));
    // The build prerequisite the mission asks for.
    expect(workflow).toMatch(/npm run build/);
    // Safe metadata only.
    expect(workflow).toMatch(/git rev-parse HEAD/);
    expect(workflow).toMatch(/deployment target: \$\{CONVEX_DEPLOYMENT\}/);
    // Never a production-shaped command, and never a release verdict.
    expect(workflow).not.toMatch(/npx convex deploy\b/);
    expect(workflow).not.toMatch(/continue-on-error/);
    expect(workflow).not.toMatch(/release:admission|RELEASE_ADMISSION|evidence:d/);
    expect(workflow).toMatch(/does not admit a release/);
  });

  it("checks out the selected ref, and requires an explicit confirmation", () => {
    expect(workflow).toMatch(/ref:\s*\$\{\{\s*inputs\.ref \|\| github\.ref\s*\}\}/);
    expect(workflow).toMatch(/SOURCE_REF:\s*\$\{\{\s*inputs\.ref \|\| github\.ref\s*\}\}/);
    expect(workflow).toMatch(/DEPLOY_DEV/);
  });

  it("cannot switch live provider verification on", () => {
    expect(workflow).not.toMatch(/LIVE_PROVIDER_VERIFICATION/);
  });
});
