/**
 * Phase 300 — the PUBLISHED frontend contract.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * Phase 299 could prove what CI built. It could not prove what a browser
 * receives, and the same origin had already served two different products. The
 * gap between the two is a host, a project setting, a branch rule and a cache —
 * none of which this repository controls — so the only acceptable evidence is a
 * fetch of the public URL, judged by rules that refuse acceptance by name.
 *
 * These tests run the real evaluation function over synthetic *published*
 * responses: a site that is the current branch must pass, and every way a host
 * can serve the wrong thing — a 404 provenance file, `main` provenance, a stale
 * commit, legacy branding, the retired OTP surface, the teal-green primary, a
 * different build's bytes — must fail with the check named. They also pin the
 * CLI wiring (npm script, workflow order) because a checker nobody runs is
 * worse than no checker.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  advertisedAssets,
  evaluatePublishedFrontend,
  formatPublishedReport,
  MAX_ASSETS,
} from "../../../scripts/verify-published-frontend.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const COMMIT = "8d06cb5d57acf62aafb363aeecca1d89dc3e079b";
const BRANCH = "arena/01a0d195-trade-intel-bot";
const SHA = "9221fe4cf343cf0a84a7ee8d7dfc2303d535e8dae49914cb21e96cdd34503b77";
const ENTRY = ["assets/index-Bpr5NQGV.js", "assets/index-FBL2Fnsb.css"];

function published(overrides: Partial<Parameters<typeof evaluatePublishedFrontend>[0]> = {}) {
  const info = {
    schema: "xstarz.build-info/v1",
    commit: COMMIT,
    shortCommit: COMMIT.slice(0, 8),
    branch: BRANCH,
    builtAt: "2026-09-30T06:40:17.000Z",
    source: "git",
    worktreeDirty: false,
    unsafeSource: false,
  };
  const indexHtml = [
    "<html><head>",
    '<meta name="xstarz-build-schema" content="xstarz.build-info/v1">',
    `<meta name="xstarz-build-commit" content="${COMMIT}">`,
    `<meta name="xstarz-build-branch" content="${BRANCH}">`,
    '<meta name="xstarz-build-time" content="2026-09-30T06:40:17.000Z">',
    '<script src="/assets/index-Bpr5NQGV.js"></script>',
    '<link rel="stylesheet" href="/assets/index-FBL2Fnsb.css">',
    "</head><body></body></html>",
  ].join("\n");
  return {
    url: "https://trade-intel-bot.example.app",
    buildInfoText: `${JSON.stringify(info, null, 2)}\n`,
    buildInfoStatus: 200,
    indexHtml,
    indexPath: "/",
    buildRouteHtml: indexHtml,
    buildRouteStatus: 200,
    assets: [
      {
        path: "/assets/index-Bpr5NQGV.js",
        name: "/assets/index-Bpr5NQGV.js",
        status: 200,
        text: 'const a="Continue with Google";const b="Continue as guest";',
      },
      {
        path: "/assets/index-FBL2Fnsb.css",
        name: "/assets/index-FBL2Fnsb.css",
        status: 200,
        text: ":root{--primary:oklch(52% .18 255)}",
      },
    ],
    expected: { commit: COMMIT, branch: BRANCH, buildInfoSha256: SHA, assetNames: ENTRY },
    ...overrides,
  } as Parameters<typeof evaluatePublishedFrontend>[0];
}

function failures(result: { checks: { name: string; ok: boolean }[] }): string[] {
  return result.checks.filter((c) => !c.ok).map((c) => c.name);
}

describe("300 — a published site that is the current branch is accepted", () => {
  it("accepts provenance, theme, auth surface and byte-identity", () => {
    const result = evaluatePublishedFrontend(published());
    expect(failures(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.observed?.commit).toBe(COMMIT);
  });

  it("reports the observed provenance in the log line", () => {
    const text = formatPublishedReport(evaluatePublishedFrontend(published()));
    expect(text).toContain("published frontend: PASS");
    expect(text).toContain(COMMIT);
  });
});

describe("300 — a published site that is not the current branch is refused, by name", () => {
  it("refuses when the host serves no provenance at all", () => {
    const result = evaluatePublishedFrontend(published({ buildInfoText: null, buildInfoStatus: 404 }));
    const failed = failures(result);
    expect(result.ok).toBe(false);
    expect(failed).toContain("build-info.json present");
    expect(failed).toContain("published /build-info.json answered 200");
  });

  it("refuses the legacy scaffold: main branch, green primary, platform branding, OTP sign-in", () => {
    const legacyInfo = JSON.parse(published().buildInfoText ?? "{}");
    legacyInfo.branch = "main";
    legacyInfo.commit = "01951c64e236851f02da4718a3120c0437d4c090";
    legacyInfo.unsafeSource = true;
    const result = evaluatePublishedFrontend(
      published({
        buildInfoText: `${JSON.stringify(legacyInfo)}\n`,
        indexHtml: "<html><head></head><body>Xstarz Analysis</body></html>",
        buildRouteHtml: null,
        buildRouteStatus: 404,
        assets: [
          {
            path: "/assets/index-legacy.js",
            name: "/assets/index-legacy.js",
            status: 200,
            text: 'const a="secured by freebuff.com";const b="Sign in with email";',
          },
          {
            path: "/assets/index-legacy.css",
            name: "/assets/index-legacy.css",
            status: 200,
            text: ":root{--primary: oklch(0.6 0.16 170)}",
          },
        ],
      }),
    );
    const failed = failures(result);
    expect(result.ok).toBe(false);
    expect(failed).toContain("branch matches the required deploy source");
    expect(failed).toContain("commit matches the checked-out revision");
    expect(failed).toContain("artifact does not come from main");
    expect(failed).toContain('no retired platform marker "freebuff.com"');
    expect(failed).toContain('no retired platform marker "secured by"');
    expect(failed).toContain('no retired OTP marker "Sign in with email"');
    expect(failed).toContain("Xstarz blue primary token present in built CSS");
    expect(failed).toContain("retired teal-green primary absent from built CSS");
    expect(failed).toContain("current sign-in copy (Google + guest) is shipped");
    expect(failed).toContain("published /build route answers");
  });

  it("refuses a host that rebuilt after verification: same content, different bytes", () => {
    const result = evaluatePublishedFrontend(
      published({ expected: { commit: COMMIT, branch: BRANCH, buildInfoSha256: "0".repeat(64) } }),
    );
    expect(failures(result)).toContain("published provenance is the byte-identical verified file");
  });

  it("refuses a page loading a different build's bundles", () => {
    const result = evaluatePublishedFrontend(
      published({ expected: { commit: COMMIT, branch: BRANCH, assetNames: ["assets/index-OTHER.js"] } }),
    );
    expect(failures(result)).toContain("published page loads the verified content-hashed bundles");
  });

  it("refuses an asset the page references but the host does not serve", () => {
    const withMissing = published();
    withMissing.assets[0].status = 404;
    const result = evaluatePublishedFrontend(withMissing);
    expect(failures(result)).toContain("every referenced asset was served");
  });

  it("refuses a stale commit even when the branch matches", () => {
    const stale = JSON.parse(published().buildInfoText ?? "{}");
    stale.commit = "b298c3c7b26d6974a5cba8cf6aaa8d53059ee7bc";
    const result = evaluatePublishedFrontend(
      published({ buildInfoText: `${JSON.stringify(stale)}\n` }),
    );
    expect(failures(result)).toContain("commit matches the checked-out revision");
  });
});

describe("300 — the advertised-asset extraction is bounded and same-origin", () => {
  it("takes only same-origin .js/.css references", () => {
    const html = [
      '<script src="/assets/a.js"></script>',
      '<link href="/assets/b.css" rel="stylesheet">',
      '<script src="https://cdn.example.com/evil.js"></script>',
      '<img src="/logo.svg">',
    ].join("");
    expect(advertisedAssets(html, "https://host.example")).toEqual(["/assets/a.js", "/assets/b.css"]);
  });

  it("caps the number of assets it will fetch", () => {
    const html = Array.from({ length: MAX_ASSETS + 10 }, (_, i) => `<script src="/a${i}.js"></script>`).join("");
    expect(advertisedAssets(html, "https://host.example").length).toBe(MAX_ASSETS);
  });
});

describe("300 — the published check is wired where it can refuse acceptance", () => {
  const WORKFLOW = ".github/workflows/publish-development-frontend.yml";

  it("is an npm script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["verify:published"]).toBe("node scripts/verify-published-frontend.mjs");
    expect(pkg.scripts["frontend:publish:guard"]).toContain("scripts/frontend-publication-guard.mjs");
  });

  it("publishes the verified bytes and verifies the PUBLIC url afterwards", () => {
    const wf = read(WORKFLOW);
    // Order matters: verification, then upload, then the published fetch.
    const verifyArtifact = wf.indexOf("npm run verify:frontend --");
    // The upload is the PREBUILT one: a plain directory deploy would make the
    // host run its own build instead of serving the verified bytes.
    const publish = wf.indexOf("vercel@latest deploy --prebuilt");
    // 300e: alias through the teamId-scoped REST API (vercel/vercel#17506)
    const alias = wf.indexOf("v2/deployments/${deployment_host}/aliases");
    const verifyPublished = wf.indexOf("npm run verify:published --");
    for (const at of [verifyArtifact, publish, alias, verifyPublished]) expect(at).toBeGreaterThan(-1);
    expect(verifyArtifact).toBeLessThan(publish);
    expect(publish).toBeLessThan(alias);
    expect(alias).toBeLessThan(verifyPublished);
    // The exact bytes, not a rebuild by the host, and the browser-facing host is
    // what gets checked.
    expect(wf).toMatch(/--expect-build-info-sha256/);
    expect(wf).toMatch(/--expect-asset-names/);
    expect(wf).toMatch(/--expect-branch "\$XSTARZ_REQUIRED_SOURCE_BRANCH"/);
    expect(wf).toMatch(/--expect-commit "\$\(git rev-parse HEAD\)"/);
    // Never a token on argv (it would be visible in a process listing / log).
    expect(wf).not.toMatch(/--token/);
  });

  it("never publishes without the pin, and never touches production", () => {
    const wf = read(WORKFLOW);
    expect(wf).toMatch(/XSTARZ_REQUIRED_SOURCE_BRANCH: arena\/01a0d195-trade-intel-bot/);
    expect(wf).toMatch(/required: true\s*\n\s*default: "arena\/01a0d195-trade-intel-bot"/);
    expect(wf).not.toMatch(/default: "main"/);
    expect(wf).not.toMatch(/npx convex deploy\b/);
    expect(wf).not.toMatch(/--prod\b/);
    expect(wf).not.toMatch(/continue-on-error/);
    expect(wf).toMatch(/HOST_CREDENTIAL_ABSENT/);
  });
});
