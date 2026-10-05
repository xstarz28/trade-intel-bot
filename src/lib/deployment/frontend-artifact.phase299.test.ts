/**
 * Phase 299 — the frontend artifact contract.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * "The site looks old" was previously an observation, not a finding. The same
 * origin has served the current product UI (Xstarz blue, Google + guest
 * sign-in) and a retired build-platform scaffold (green primary, "secured by
 * freebuff.com", email-OTP sign-in), and a green pipeline step said nothing
 * about which one a person would open.
 *
 * The checker under test inspects the BUILT ARTIFACT, so these assertions run
 * its real evaluation function against synthetic artifacts, and then assert
 * that the artifact contract is actually wired into CI and the deploy
 * workflows — a checker nothing calls is worse than no checker, because it
 * looks like verification.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BRAND_PRIMARY_OKLCH,
  CURRENT_AUTH_MARKERS,
  RETIRED_PRIMARY_OKLCH,
  evaluateFrontendArtifact,
  metaContent,
  primaryTokens,
  colorMatches,
} from "../../../scripts/verify-frontend-artifact.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const COMMIT = "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc";
const BRANCH = "arena/01a0d195-trade-intel-bot";

/** A synthetic artifact that satisfies every check. */
function goodArtifact() {
  const info = {
    schema: "xstarz.build-info/v1",
    commit: COMMIT,
    shortCommit: COMMIT.slice(0, 8),
    branch: BRANCH,
    builtAt: "2026-09-30T05:02:36.000Z",
    source: "git",
    worktreeDirty: false,
    unsafeSource: false,
  };
  const indexHtml = [
    "<html><head>",
    '<meta name="xstarz-build-schema" content="xstarz.build-info/v1">',
    `<meta name="xstarz-build-commit" content="${COMMIT}">`,
    `<meta name="xstarz-build-branch" content="${BRANCH}">`,
    '<meta name="xstarz-build-time" content="2026-09-30T05:02:36.000Z">',
    "</head><body></body></html>",
  ].join("\n");
  return {
    indexHtml,
    buildInfoText: `${JSON.stringify(info, null, 2)}\n`,
    textAssets: [
      { name: "assets/index.js", text: 'const a="Continue with Google";const b="Continue as guest";' },
      { name: "build-info.json", text: JSON.stringify(info) },
    ],
    // As minified: percentages and a leading-dot chroma.
    cssText: ":root{--primary:oklch(52% .18 255)}",
  };
}

function failures(result: { checks: { name: string; ok: boolean }[] }): string[] {
  return result.checks.filter((c) => !c.ok).map((c) => c.name);
}

/** Overrides may clear a field (`null`), which the artifact check must handle. */
type ArtifactOverride = {
  indexHtml?: string | null;
  buildInfoText?: string | null;
  textAssets?: { name: string; text: string }[];
  cssText?: string;
};

function run(overrides: ArtifactOverride = {}) {
  return evaluateFrontendArtifact({
    ...goodArtifact(),
    ...overrides,
    expected: { commit: COMMIT, branch: BRANCH, requireClean: true },
  });
}

describe("299 — a correct artifact passes", () => {
  it("accepts provenance, theme and auth surface that match the branch", () => {
    const result = run();
    expect(failures(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reads meta tags regardless of attribute order and quote style", () => {
    const html = `<meta content="${COMMIT}" name='xstarz-build-commit'>`;
    expect(metaContent(html, "xstarz-build-commit")).toBe(COMMIT);
    expect(metaContent("<html></html>", "xstarz-build-commit")).toBeNull();
  });

  it("parses the primary token in both source and minified spellings", () => {
    const source = ":root{--primary: oklch(0.52 0.18 255);}";
    const minified = ":root{--primary:oklch(52% .18 255)}";
    for (const css of [source, minified]) {
      const tokens = primaryTokens(css);
      expect(tokens.length).toBe(1);
      expect(colorMatches(tokens[0], BRAND_PRIMARY_OKLCH)).toBe(true);
    }
    // A different hue is a different brand, however it is written.
    expect(colorMatches(primaryTokens("--primary: oklch(0.6 0.16 170)")[0], BRAND_PRIMARY_OKLCH)).toBe(
      false,
    );
  });
});

describe("299 — a wrong or stale artifact fails, by name", () => {
  it("fails when the artifact does not identify itself at all", () => {
    const result = run({ buildInfoText: null });
    expect(result.ok).toBe(false);
    expect(failures(result)).toContain("build-info.json present");
  });

  it("fails when the artifact is a different commit than the checkout", () => {
    const stale = JSON.parse(goodArtifact().buildInfoText);
    stale.commit = "01951c64e236851f02da4718a3120c0437d4c090";
    const result = run({ buildInfoText: `${JSON.stringify(stale)}\n` });
    expect(failures(result)).toContain("commit matches the checked-out revision");
  });

  it("fails when the artifact was built from another branch", () => {
    const other = JSON.parse(goodArtifact().buildInfoText);
    other.branch = "main";
    other.unsafeSource = true;
    const result = run({ buildInfoText: `${JSON.stringify(other)}\n` });
    const failed = failures(result);
    expect(failed).toContain("branch matches the required deploy source");
    expect(failed).toContain("artifact does not come from main");
  });

  it("fails when the deployed HTML does not advertise its provenance", () => {
    const result = run({ indexHtml: "<html><head></head><body></body></html>" });
    expect(failures(result)).toContain("index.html advertises build provenance");
  });

  it("fails on retired platform branding — the legacy scaffold's fingerprint", () => {
    const result = run({
      textAssets: [
        { name: "assets/index.js", text: "x;/* secured by freebuff.com */" },
      ],
    });
    const failed = failures(result);
    expect(failed).toContain('no retired platform marker "freebuff.com"');
    expect(failed).toContain('no retired platform marker "secured by"');
  });

  it("fails on the retired OTP sign-in surface", () => {
    const result = run({
      textAssets: [{ name: "assets/index.js", text: 'fetch("/send_otp")' }],
    });
    expect(failures(result)).toContain('no retired OTP marker "send_otp"');
  });

  it("fails on the retired teal-green primary", () => {
    const result = run({ cssText: "--primary:oklch(60% .16 170)" });
    const failed = failures(result);
    expect(failed).toContain("Xstarz blue primary token present in built CSS");
    expect(failed).toContain("retired teal-green primary absent from built CSS");
    expect(RETIRED_PRIMARY_OKLCH.h).toBe(170);
  });

  it("fails when the current sign-in copy is missing", () => {
    const result = run({ textAssets: [{ name: "assets/index.js", text: "nothing here" }] });
    expect(failures(result)).toContain("current sign-in copy (Google + guest) is shipped");
  });

  it("fails a dirty-tree artifact when cleanliness is required", () => {
    const dirty = JSON.parse(goodArtifact().buildInfoText);
    dirty.worktreeDirty = true;
    const strict = run({ buildInfoText: `${JSON.stringify(dirty)}\n` });
    expect(failures(strict)).toContain("artifact was built from a clean tree");
    // Without the requirement, a dirty local build is reported, not fatal.
    const lenient = evaluateFrontendArtifact({
      ...goodArtifact(),
      buildInfoText: `${JSON.stringify(dirty)}\n`,
      expected: { commit: COMMIT, branch: BRANCH },
    });
    expect(lenient.ok).toBe(true);
  });
});

describe("299 — the contract is wired where it can actually refuse a deploy", () => {
  it("is an npm script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["verify:frontend"]).toBe("node scripts/verify-frontend-artifact.mjs");
  });

  it("runs in CI against the checked-out commit", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/npm run verify:frontend/);
    expect(ci).toMatch(/--expect-commit "\$GITHUB_SHA"/);
  });

  it("runs in the development deploy with the branch pinned", () => {
    const workflow = read(".github/workflows/development-deploy.yml");
    expect(workflow).toMatch(/XSTARZ_REQUIRED_SOURCE_BRANCH: arena\/01a0d195-trade-intel-bot/);
    expect(workflow).toMatch(/--require-branch "\$XSTARZ_REQUIRED_SOURCE_BRANCH"/);
    expect(workflow).toMatch(/--expect-branch "\$XSTARZ_REQUIRED_SOURCE_BRANCH"/);
    // The artifact check must run BEFORE the Convex deploy, or it cannot refuse.
    expect(workflow.indexOf("npm run verify:frontend")).toBeLessThan(
      workflow.indexOf("npx convex dev --once"),
    );
    // And the deploy input must be explicit rather than defaulting to the
    // dispatched ref (which is how `main` was deployed in the past).
    expect(workflow).toMatch(/default: "arena\/01a0d195-trade-intel-bot"/);
    expect(workflow).not.toMatch(/default: "main"/);
  });

  it("runs in the production deploy too", () => {
    expect(read(".github/workflows/production-deploy.yml")).toMatch(/npm run verify:frontend/);
  });

  it("the build emits the provenance the checker reads", () => {
    const vite = read("vite.config.ts");
    expect(vite).toMatch(/build-info\.json/);
    expect(vite).toMatch(/xstarz-build-provenance/);
  });

  it("a built artifact here, when present, satisfies the real contract", () => {
    // Opportunistic: the suite must not require a build (CI runs the checker
    // itself, and this suite on its own must stay fast), but when dist/ exists
    // it is evaluated for real rather than only in the abstract.
    const dist = resolve(root, "dist");
    if (!existsSync(dist)) {
      expect(CURRENT_AUTH_MARKERS.length).toBeGreaterThan(0);
      return;
    }

    const assetsDir = resolve(dist, "assets");
    const assetNames: string[] = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
    const assets = assetNames
      .filter((name) => /\.(js|css)$/.test(name))
      .map((name) => ({ name, text: readFileSync(resolve(assetsDir, name), "utf8") }));

    // Phase 317 — there are TWO legitimate artifact kinds, and each has its
    // own contract. A build WITHOUT VITE_CONVEX_URL is a deliberate fail-
    // closed operator shell (main.tsx renders an explicit "set the variable
    // and rebuild" page and the app graph is dead-code-eliminated); it must
    // NOT fake the sign-in UI. A build WITH the variable is the real app and
    // must satisfy the full artifact contract below.
    const bundle = assets.map((a) => a.text).join("\n");
    const isNoConvexUrlShell = bundle.includes(
      "VITE_CONVEX_URL is not set. It is inlined at build time",
    );
    if (isNoConvexUrlShell) {
      expect(bundle).toContain("VITE_CONVEX_URL");
      expect(bundle).toContain("must be rebuilt with the variable present");
      // The shell never pretends to be the product: no sign-in copy.
      for (const marker of CURRENT_AUTH_MARKERS) {
        expect(bundle.includes(marker)).toBe(false);
      }
      return;
    }

    const result = evaluateFrontendArtifact({
      indexHtml: read(resolve(dist, "index.html")),
      buildInfoText: existsSync(resolve(dist, "build-info.json"))
        ? read(resolve(dist, "build-info.json"))
        : null,
      textAssets: assets,
      cssText: assets
        .filter((a) => a.name.endsWith(".css"))
        .map((a) => a.text)
        .join("\n"),
      expected: {},
    });
    expect(failures(result)).toEqual([]);
  });
});
