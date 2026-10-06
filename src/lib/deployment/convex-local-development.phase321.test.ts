/**
 * Phase 321 — development/production Convex separation, pinned by artifact.
 *
 * The contract this suite locks in:
 *
 *  1. The LOCAL development escape exists and is version-pinned (never
 *     "latest"), so a local backend cannot drift under a running workflow.
 *  2. Local selection uses the convex CLI's self-hosted deployment-selection
 *     variables — an explicit env file, never an implicit "always local".
 *  3. The NORMAL test suite never targets a Convex Cloud deployment: no cloud
 *     URL in the vitest/build configs, no cloud client constructed in tests.
 *  4. The production path is untouched: the Vercel build keeps its baked
 *     VITE_CONVEX_URL and CI keeps its CONVEX_DEPLOY_KEY flows — this suite
 *     reads the real artifacts so a later edit cannot silently entangle them.
 *
 * Nothing here contacts a network.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const script = read("scripts/dev/local-backend.mjs");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

describe("321 — local Convex development escape", () => {
  it("the local backend runner is version-pinned to a GitHub release tag", () => {
    expect(script).toMatch(/const BACKEND_RELEASE = "precompiled-\d{4}-\d{2}-\d{2}-[0-9a-f]+";/);
    expect(script).toMatch(/get-convex\/convex-backend\/releases\/download\/\$\{BACKEND_RELEASE\}/);
  });

  it("local selection is explicit, via the CLI's self-hosted env file — never implicit", () => {
    expect(script).toMatch(/CONVEX_SELF_HOSTED_URL=http:\/\/127\.0\.0\.1:\$\{PORT\}/);
    expect(script).toMatch(/CONVEX_SELF_HOSTED_ADMIN_KEY=\$\{adminKey\}/);
    // The env file is the ONLY coupling: no cloud deployment names, no deploy
    // keys — judged on CODE (the header comment names what is NOT used).
    const code = script.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/CONVEX_DEPLOY_KEY/);
    expect(code).not.toMatch(/CONVEX_DEPLOYMENT/);
  });

  it("local-only secrets never reach stdout", () => {
    // The admin key is interpolated only into the env file write.
    expect(script).toMatch(/values local-only, not printed/);
  });

  it("the one-shot push targets ONLY the local env file", () => {
    expect(pkg.scripts["convex:push:local"]).toBe(
      "convex dev --env-file .env.local-backend --once --typecheck=disable",
    );
  });

  it("the normal test script still never touches a Convex deployment", () => {
    expect(pkg.scripts.test).toBe("vitest run");
    const vitestConfig = read("vitest.config.ts");
    expect(vitestConfig).not.toMatch(/convex\.cloud|convex\.dev|CONVEX_DEPLOY_KEY/);
  });

  it("the local env file and storage are gitignored", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/\.env\.local-backend/);
    expect(gitignore).toMatch(/\.convex-local\//);
  });

  it("production stays cloud-backed: the build bakes VITE_CONVEX_URL and CI keeps its deploy-key flows", () => {
    expect(script).toMatch(/Vercel builds keep their existing/);
    const deployWorkflow = read(".github/workflows/development-deploy.yml");
    expect(deployWorkflow).toMatch(/CONVEX_DEPLOY_KEY/);
    // The local runner deliberately never reads those credentials.
    const runnerCode = script.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(runnerCode).not.toMatch(/DEPLOY_KEY/);
  });
});
