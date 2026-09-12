/**
 * Phase 181 — mobile CI trigger coverage.
 *
 * THE DEFECT THIS GUARDS AGAINST
 * The mobile workflow originally triggered only on paths that "look mobile":
 * android/**, ios/**, capacitor.config.ts, src/lib/mobile/**. But Android and
 * iOS embed the SAME dist/ built from the entire Vite application, so editing
 * src/pages/Dashboard.tsx changes the shipped mobile artifact while matching
 * none of those paths. Measured directly: building dist/ before and after a
 * web-only edit produced different SHA-256 digests.
 *
 * The consequence was a release-integrity hole — mobile packaging validation
 * could be skipped for a change that alters what mobile users receive.
 *
 * WHY AN EXCLUDE-LIST, NOT AN INCLUDE-LIST
 * An include-list must enumerate every build input; anything forgotten fails
 * silently by NOT running. An exclude-list fails the safe way: something
 * unforeseen triggers a redundant build. A wasted CI minute is cheap, a missed
 * mobile validation before release is not.
 *
 * These tests reproduce GitHub's path-filter semantics against the real
 * workflow file, so the guarantee is checked rather than assumed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

interface WorkflowTriggers {
  push?: { branches?: string[]; paths?: string[]; "paths-ignore"?: string[] };
  pull_request?: { paths?: string[]; "paths-ignore"?: string[] };
  workflow_dispatch?: unknown;
}

/**
 * Minimal reader for the two workflow files.
 *
 * Deliberately not using a YAML library: js-yaml and picomatch are only
 * present here as transitive dependencies of other packages, ship no types,
 * and could vanish on any lockfile change. A guard that protects release
 * integrity must not rest on a dependency nobody declared. The parsing needed
 * is narrow and fully determined by files in this repository.
 */
function loadWorkflow(name: string): {
  on: WorkflowTriggers;
  jobs: Record<string, { steps: Array<Record<string, unknown>>; "runs-on": string }>;
  raw: string;
} {
  const raw = readFileSync(join(ROOT, ".github", "workflows", name), "utf8");

  /** Items of a `- "value"` list nested under `key:`, following the anchor. */
  const listUnder = (key: string): string[] | undefined => {
    const at = raw.indexOf(`${key}:`);
    if (at === -1) return undefined;
    const rest = raw.slice(at + key.length + 1);
    const items: string[] = [];
    for (const line of rest.split("\n").slice(1)) {
      const m = line.match(/^\s+-\s+"([^"]+)"\s*$/);
      if (m) {
        items.push(m[1]);
        continue;
      }
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      break;
    }
    return items.length > 0 ? items : undefined;
  };

  // `paths-ignore: &non_build_inputs` is declared once and reused via an
  // alias, so both push and pull_request resolve to the same list.
  const ignore = listUnder("paths-ignore: &non_build_inputs") ?? listUnder("paths-ignore");
  const usesAlias = /pull_request:\s*\n\s+paths-ignore:\s*\*non_build_inputs/.test(raw);
  const hasPushPaths = /push:[\s\S]*?\n\s+paths:\s*\n/.test(raw);

  const on: WorkflowTriggers = {
    push: {
      paths: hasPushPaths ? (listUnder("paths") ?? []) : undefined,
      "paths-ignore": ignore,
    },
    pull_request: { "paths-ignore": usesAlias ? ignore : listUnder("paths-ignore") },
  };

  // Jobs: `  <name>:` at two-space indent, each with `runs-on` and `- run:`.
  const jobs: Record<string, { steps: Array<Record<string, unknown>>; "runs-on": string }> = {};
  const jobsAt = raw.indexOf("\njobs:");
  if (jobsAt !== -1) {
    const body = raw.slice(jobsAt);
    const names = [...body.matchAll(/^ {2}([a-z][\w-]*):$/gm)];
    names.forEach((match, i) => {
      const start = match.index ?? 0;
      const end = i + 1 < names.length ? (names[i + 1].index ?? body.length) : body.length;
      const section = body.slice(start, end);
      // `$` with the m flag, not `\Z` — JavaScript has no \Z, and escaping it
      // silently matched a literal "Z" instead of end-of-input.
      const steps = [...section.matchAll(/^\s+- (?:name|uses):[\s\S]*?(?=^\s+- (?:name|uses):|$(?![\s\S]))/gm)].map(
        (s) => {
          const block = s[0];
          const runMatch = block.match(/run:\s*(?:\|[\s\S]*?(?=\n\s{6}\S|$)|(.*))/);
          return {
            name: block.match(/name:\s*(.*)/)?.[1]?.trim() ?? "",
            run: runMatch ? runMatch[0] : "",
            "continue-on-error": /continue-on-error:\s*true/.test(block),
          } as Record<string, unknown>;
        },
      );
      jobs[match[1]] = {
        steps,
        "runs-on": section.match(/runs-on:\s*(\S+)/)?.[1] ?? "",
      };
    });
  }

  return { on, jobs, raw };
}

/**
 * Glob matcher covering the subset of syntax GitHub path filters use here:
 * `**` (crosses directories, and matches a leading path so `**\/*.md` hits a
 * root-level README.md), `*` (within a segment), and literals.
 */
function globMatch(file: string, pattern: string): boolean {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      re += ".*";
      i += 2;
    } else {
      const ch = pattern[i];
      re += ch === "*" ? "[^/]*" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`).test(file);
}

/**
 * GitHub's rule: with `paths-ignore`, a push runs unless EVERY changed file
 * matches an ignore pattern. A single non-ignored file triggers the workflow.
 *
 * picomatch is the matcher underlying most glob tooling and reproduces the
 * semantics GitHub documents, including `**` crossing directory boundaries and
 * `**\/*.md` matching a root-level README.md. `dot: true` matters because real
 * changed paths include dotfiles such as `.github/workflows/mobile.yml`.
 */
function wouldTrigger(changedFiles: string[], ignore: string[]): boolean {
  return changedFiles.some(
    (file) => !ignore.some((pattern) => globMatch(file, pattern)),
  );
}

const mobile = loadWorkflow("mobile.yml");
const ignorePatterns = mobile.on.push?.["paths-ignore"] ?? [];

describe("Phase 181 — mobile workflow trigger coverage", () => {
  it("uses an exclude-list, never an enumerated include-list", () => {
    // An include-list is the shape that caused the original defect.
    expect(mobile.on.push?.paths).toBeUndefined();
    expect(ignorePatterns.length).toBeGreaterThan(0);
  });

  /**
   * The exact paths named in the review, plus the rest of the build graph.
   * Every one of these can change what a mobile user receives.
   */
  const mustTrigger: Array<[string, string]> = [
    ["src/pages/Dashboard.tsx", "web UI shipped inside the app"],
    ["src/components/NotificationCenter.tsx", "web UI"],
    ["src/lib/analysis-engine.ts", "analysis behaviour"],
    ["src/lib/i18n/en.ts", "user-visible copy"],
    ["src/lib/mobile/native-shell.ts", "native bridge"],
    ["src/main.tsx", "entry point"],
    ["src/index.css", "styles compiled into the bundle"],
    ["public/logo.svg", "public asset copied verbatim"],
    ["public/_redirects", "hosting contract"],
    ["public/.well-known/assetlinks.json", "deep-link association"],
    ["index.html", "HTML shell"],
    ["package.json", "dependencies and build scripts"],
    ["package-lock.json", "resolved dependency versions"],
    ["vite.config.ts", "asset base and build config"],
    ["postcss.config.cjs", "CSS pipeline"],
    ["tsconfig.app.json", "compilation settings"],
    ["capacitor.config.ts", "Capacitor configuration"],
    ["android/app/src/main/AndroidManifest.xml", "native Android"],
    ["ios/App/App/Info.plist", "native iOS"],
    ["scripts/verify-mobile-artifacts.mjs", "artifact verification"],
    ["src/convex/marketData.ts", "backend contract the client calls"],
  ];

  it.each(mustTrigger)("triggers mobile validation for %s (%s)", (file) => {
    expect(wouldTrigger([file], ignorePatterns)).toBe(true);
  });

  /**
   * Exclusions must be justified, not convenient. Each of these is provably
   * not a `vite build` input.
   */
  const mustNotTrigger: Array<[string, string]> = [
    ["docs/DEPLOYMENT.md", "documentation is never bundled"],
    ["docs/UAT-MATRIX.md", "documentation"],
    ["README.md", "documentation"],
    ["eslint.config.js", "vite build does not run eslint"],
    ["vitest.config.ts", "test-runner config is not a build input"],
    [".gitignore", "VCS metadata"],
  ];

  it.each(mustNotTrigger)("skips mobile validation for %s (%s)", (file) => {
    expect(wouldTrigger([file], ignorePatterns)).toBe(false);
  });

  it("still triggers when a doc change is bundled with a code change", () => {
    // GitHub ignores a push only when EVERY file is ignorable.
    expect(
      wouldTrigger(["docs/DEPLOYMENT.md", "src/pages/Dashboard.tsx"], ignorePatterns),
    ).toBe(true);
  });

  /**
   * MUTATION GUARD. Reinstating the original mobile-only include-list must be
   * detectable. This encodes the defect so it cannot come back unnoticed.
   */
  it("detects a regression to the original mobile-only filter", () => {
    const originalBrokenFilter = [
      "android/**",
      "ios/**",
      "capacitor.config.ts",
      "src/lib/mobile/**",
      "scripts/verify-mobile-artifacts.mjs",
      ".github/workflows/mobile.yml",
    ];
    const matchesInclude = (file: string): boolean =>
      originalBrokenFilter.some((p) => globMatch(file, p));

    // The exact hole that was found: these were NOT covered before.
    for (const missed of [
      "src/pages/Dashboard.tsx",
      "src/components/NotificationCenter.tsx",
      "src/lib/analysis-engine.ts",
      "public/logo.svg",
      "package.json",
      "vite.config.ts",
    ]) {
      expect(matchesInclude(missed)).toBe(false);
      // ...and are covered now.
      expect(wouldTrigger([missed], ignorePatterns)).toBe(true);
    }
  });

  it("covers pull requests with the same filter as pushes", () => {
    // A filter that protects pushes but not PRs still lets an unvalidated
    // change reach a release branch through review.
    expect(mobile.on.pull_request?.["paths-ignore"]).toEqual(ignorePatterns);
  });

  it("builds every packaged platform and scans artifacts on every run", () => {
    // Phase 182 added Windows as the fourth distribution surface. All three
    // packaged platforms wrap the same web build, so all three are packaged
    // and scanned by the same workflow.
    expect(Object.keys(mobile.jobs).sort()).toEqual(["android", "ios", "windows"]);
    for (const job of Object.values(mobile.jobs)) {
      const runs = job.steps.map((s) => String(s.run ?? "")).join("\n");
      expect(runs).toContain("mobile:verify");
    }
  });

  /**
   * Phase 182 — desktop paths must trigger packaging too.
   *
   * The desktop shell has its own sources (src-tauri/**) that the original
   * Phase 181 exclude-list never contemplated. Because that list is an
   * exclude-list rather than an include-list, they trigger automatically —
   * this asserts the property rather than assuming it.
   */
  it.each([
    ["src-tauri/tauri.conf.json", "desktop bundle configuration"],
    ["src-tauri/src/lib.rs", "desktop shell source"],
    ["src-tauri/Cargo.toml", "desktop dependencies"],
    ["src-tauri/capabilities/default.json", "desktop permission set"],
    ["src/lib/desktop/desktop-shell.ts", "desktop detection in the web layer"],
    ["src/pages/Download.tsx", "public download page"],
  ])("triggers packaging for %s (%s)", (file) => {
    expect(wouldTrigger([file], ignorePatterns)).toBe(true);
  });
});

describe("Phase 181 — CI cannot report a false green", () => {
  const ci = loadWorkflow("ci.yml");

  /**
   * `continue-on-error` makes a failing step report success. It is acceptable
   * ONLY for the known-noisy lint backlog, and must never be attached to a
   * correctness gate.
   */
  it("allows continue-on-error only on the advisory lint step", () => {
    for (const [name, job] of Object.entries({ ...ci.jobs, ...mobile.jobs })) {
      for (const step of job.steps) {
        if (step["continue-on-error"] === true) {
          expect(
            String(step.name ?? "").toLowerCase(),
            `${name}: continue-on-error on a non-lint step hides real failures`,
          ).toContain("lint");
        }
      }
    }
  });

  it("keeps tests, typecheck, build and the secret scan as hard gates", () => {
    const verify = ci.jobs.verify;
    const hard = verify.steps.filter((s) => s["continue-on-error"] !== true);
    const runs = hard.map((s) => String(s.run ?? "")).join("\n");
    expect(runs).toContain("npm test");
    expect(runs).toContain("npm run build");
    expect(runs).toContain("npm run mobile:verify");
  });

  it("never deploys and never consumes a provider secret", () => {
    for (const wf of ["ci.yml", "mobile.yml"]) {
      const { raw } = loadWorkflow(wf);
      // A deploy from CI would bypass the outstanding credential rotation.
      expect(raw).not.toMatch(/convex\s+deploy/);
      expect(raw).not.toMatch(/vercel\s+(deploy|--prod)/);
      // Provider keys belong only in the Convex deployment environment.
      expect(raw).not.toMatch(/secrets\.[A-Z_]*(API_KEY|TOKEN|KEY)/);
    }
  });
});
