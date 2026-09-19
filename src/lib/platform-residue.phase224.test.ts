/**
 * Phase 224 — build-platform residue must stay out of the product.
 *
 * The project was scaffolded by a hosted app builder (Vly, now Freebuff Web).
 * Its editor plumbing leaked into the shipped artifact in ways that are not
 * acceptable for a released product:
 *
 *  - `vlyPlugin()` in vite.config.ts injected window `error` /
 *    `unhandledrejection` listeners into PRODUCTION index.html that
 *    postMessage'd every runtime error (message, stack, file, line) to
 *    `window.parent` with target origin `"*"` — a diagnostic leak to any
 *    embedding frame.
 *  - main.tsx swallowed every uncaught error in capture phase and, whenever
 *    embedded in any iframe, overrode `Location.prototype.href` so all hard
 *    navigations (including Convex Auth redirects) were silently discarded.
 *  - A dev-only editor toolbar, an unused AI-gateway client, an unused error
 *    reporter to the platform's monitoring URL, and two unused dependencies
 *    (`@vly-ai/integrations`, `axios`) remained declared.
 *
 * These tests pin the removal. They are source-level guards; the built-artifact
 * scan in scripts/verify-mobile-artifacts.mjs covers the bundle.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("Phase 224 — platform residue removed", () => {
  it("vite.config.ts does not load the platform plugin", () => {
    const code = strip(read("vite.config.ts"));
    expect(code).not.toContain("@vly-ai/integrations");
    expect(code).not.toContain("vlyPlugin");
  });

  it("main.tsx neither swallows global errors nor overrides Location.href", () => {
    const code = strip(read("src/main.tsx"));
    expect(code).not.toContain("stopImmediatePropagation");
    expect(code).not.toMatch(/Object\.defineProperty\(\s*Location\.prototype/);
    expect(code).not.toContain("@vly-ai/integrations");
    expect(code).not.toContain("VlyToolbar");
    expect(code).toContain("RootErrorBoundary");
  });

  it("platform files are gone and nothing imports them", () => {
    for (const f of [
      "vly-toolbar-readonly.tsx",
      "src/lib/vly-integrations.ts",
      "src/instrumentation.tsx",
      "integrations.md",
      "bun.lock",
    ]) {
      expect(existsSync(resolve(process.cwd(), f)), `${f} should not exist`).toBe(false);
    }
    expect(read("tsconfig.app.json")).not.toContain("vly-toolbar");
  });

  it("unused platform dependencies are not declared", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(all["@vly-ai/integrations"]).toBeUndefined();
    expect(all["axios"]).toBeUndefined();
    const lock = read("package-lock.json");
    expect(lock).not.toContain("node_modules/@vly-ai/integrations");
  });

  it("the federated-issuer variable name is retained (still part of the issuer policy)", () => {
    // Not residue: preview/development may federate; production refuses it.
    expect(read("src/convex/lib/issuerPolicy.ts")).toContain('"VLY_CONVEX_AUTH_ISSUER"');
  });

  it("README no longer describes the scaffold's conventions", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/DO NOT MODIFY THIS FILE/);
    expect(readme).not.toMatch(/Use bun for the package manager/);
    expect(readme).toContain("emailDelivery.ts");
  });
});
