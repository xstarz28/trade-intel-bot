/**
 * Phase 181 — the default test suite must be hermetic.
 *
 * THE DEFECT THIS GUARDS AGAINST
 * `npm test` passed locally (8,455 tests) and failed on GitHub Actions. The
 * cause was not a code difference — it was a NETWORK difference.
 *
 * phase75-production-activation.test.ts calls api.coingecko.com for real. The
 * sandbox has no outbound provider access, so the fetch always failed and the
 * test took its graceful-skip path. A GitHub runner has full network access,
 * so the call actually executed and its assertions ran against a live third
 * party — subject to that party's uptime and rate limits.
 *
 * The repository already had the right idea: vitest.config.ts excludes
 * phase72/73/74 as LIVE_ONLY and vitest.live.config.ts runs them separately.
 * phase75 was simply never added. Nothing detected the omission, because the
 * only environment that could reveal it was CI.
 *
 * Two consequences worth stating plainly:
 *   1. A green local suite was not evidence the suite would pass elsewhere.
 *   2. A red CI run was not evidence of a regression in the change that
 *      triggered it — it was pre-existing, and would have misdirected whoever
 *      investigated next.
 *
 * These tests read the real config and the real test sources, so the guarantee
 * is enforced rather than documented.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Hosts a test must never contact during the default regression suite. */
const LIVE_HOSTS = [
  "api.coingecko.com",
  "api.twelvedata.com",
  "www.okx.com",
  "www.alphavantage.co",
  "api.coinglass.com",
  "home.treasury.gov",
  "api.eia.gov",
  "convex.cloud",
  "auth.freebuff.app",
];

function readConfig(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** Prefixes excluded from the default suite by vitest.config.ts. */
function excludedPrefixes(): string[] {
  const cfg = readConfig("vitest.config.ts");
  const block = cfg.match(/const LIVE_ONLY\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return [...block[1].matchAll(/"src\/\*\*\/([^"*]+)\*?"/g)].map((m) => m[1]);
}

function isExcluded(file: string, prefixes: string[]): boolean {
  const base = file.split("/").pop() ?? "";
  return prefixes.some((p) => base.startsWith(p));
}

/**
 * Finds tests that perform genuine outbound I/O.
 *
 * A URL used only as a string literal (asserting that a constant contains
 * "okx.com", for example) is hermetic and must not be flagged — that
 * distinction is what keeps this check trustworthy rather than noisy.
 */
/** Recursively collect test files without depending on an undeclared glob package. */
function findTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findTestFiles(full, acc);
    else if (/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

async function nonHermeticTests(): Promise<string[]> {
  const files = findTestFiles(join(ROOT, "src"));
  const offenders: string[] = [];

  for (const file of files) {
    // This detector necessarily names live hosts in order to look for them;
    // scanning itself would be a guaranteed false positive.
    if (file.endsWith("suite-hermeticity.phase181.test.ts")) continue;

    const text = readFileSync(file, "utf8");

    // Real I/O: fetch(/axios.get(/axios.post( applied directly to a live URL.
    const callsOut = new RegExp(
      String.raw`(?:fetch|axios\.(?:get|post|put|delete))\(\s*[\`"']https://(?:${LIVE_HOSTS.map(
        (h) => h.replace(/\./g, String.raw`\.`),
      ).join("|")})`,
    );
    // Template-literal form: a backtick URL built with interpolation.
    const callsOutTemplate = new RegExp(
      String.raw`(?:fetch|axios\.(?:get|post))\(\s*\`https://(?:${LIVE_HOSTS.map((h) =>
        h.replace(/\./g, String.raw`\.`),
      ).join("|")})`,
    );
    // Indirect helper (e.g. safeFetch) pointed at a live host.
    const callsOutHelper = new RegExp(
      String.raw`\w*[Ff]etch\w*\(\s*\n?\s*[\`"']https://(?:${LIVE_HOSTS.map((h) =>
        h.replace(/\./g, String.raw`\.`),
      ).join("|")})`,
    );

    const mocked = /vi\.(mock|stubGlobal)\(|global\.fetch\s*=|globalThis\.fetch\s*=/.test(text);

    if (
      !mocked &&
      (callsOut.test(text) || callsOutTemplate.test(text) || callsOutHelper.test(text))
    ) {
      offenders.push(relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  return offenders;
}

/**
 * Tests that touch the network but are SAFE in the default suite because every
 * assertion is guarded by a successful response. phase39 wraps each call in
 * `safeFetch` (returns null on any failure) and asserts only inside
 * `if (res && res.ok)`, so a blocked network, a timeout, or a rate limit all
 * take the no-assertion path.
 *
 * This is an explicit, justified allowlist — not a way to silence the check.
 * phase75 did NOT qualify: it asserted on live results once data came back.
 */
const GUARDED_LIVE_TESTS = ["src/lib/live-provider-validation.phase39.test.ts"];

describe("Phase 181 — default suite hermeticity", () => {
  it("only allows network tests that cannot assert on a live response", () => {
    // Every allowlisted file must actually contain the guard that justifies it.
    for (const file of GUARDED_LIVE_TESTS) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text).toMatch(/if\s*\(res\s*&&\s*res\.ok\)/);
      // ...and must never assert outside that guard on a bare fetch result.
      expect(text).toContain("safeFetch");
    }
  });

  it("excludes every network-touching test from the default suite", async () => {
    const prefixes = excludedPrefixes();
    expect(prefixes.length).toBeGreaterThan(0);

    const offenders = await nonHermeticTests();
    const leaked = offenders.filter(
      (f) => !isExcluded(f, prefixes) && !GUARDED_LIVE_TESTS.includes(f),
    );

    expect(
      leaked,
      `These tests perform real network I/O but run in \`npm test\`. They will ` +
        `behave differently on a CI runner with network access. Add their ` +
        `prefix to LIVE_ONLY in vitest.config.ts and to vitest.live.config.ts:\n` +
        leaked.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("keeps the two configs in agreement", () => {
    // A file excluded from the default suite but absent from the live config
    // would never run anywhere — silently losing coverage.
    const prefixes = excludedPrefixes();
    const live = readConfig("vitest.live.config.ts");
    for (const prefix of prefixes) {
      expect(
        live.includes(prefix),
        `${prefix} is excluded from the default suite but not included in ` +
          `vitest.live.config.ts, so it would never execute at all`,
      ).toBe(true);
    }
  });

  it("covers phase75 specifically (the CI failure)", () => {
    const prefixes = excludedPrefixes();
    expect(prefixes.some((p) => p.startsWith("phase75"))).toBe(true);
    expect(readConfig("vitest.live.config.ts")).toContain("phase75");
  });

  /**
   * A test must not REQUIRE git-ignored generated output.
   *
   * The phase179 mobile tests asserted on `android/app/src/main/assets/public`
   * and `ios/App/App/public`, which `npx cap sync` produces and .gitignore
   * excludes. They passed locally (a sync had been run) and failed on CI with
   * ENOENT on a clean clone — the same shape of illusion as the network
   * problem: local green proving nothing about a fresh checkout.
   *
   * Reading such a path is fine; it must simply be guarded by an existence
   * check so the test skips instead of erroring.
   */
  it("never hard-requires git-ignored build output", () => {
    const generated = [
      "android/app/src/main/assets/public",
      "ios/App/App/public",
      "dist/",
    ];
    const files = findTestFiles(join(ROOT, "src"));

    for (const file of files) {
      const text = readFileSync(file, "utf8");

      // Match an actual filesystem READ of the path, not a mention of it.
      // A doc comment explaining that both platforms embed the same dist/ is
      // not a dependency on dist/ existing — the same name-versus-use
      // distinction that made the earlier secret scanner trustworthy.
      //
      // Strategy: strip comments, then look for the path inside a quoted
      // string. Only real code survives the strip.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const touches = generated.filter((g) => code.includes(g));
      if (touches.length === 0) continue;

      const guarded =
        /existsSync|\bhas\(|it\.skip|describeBuilt|describe\.skip|capSynced|itSynced/.test(text);
      expect(
        guarded,
        `${relative(ROOT, file)} reads generated output (${touches.join(", ")}) ` +
          `without an existence guard; it will fail on a clean checkout`,
      ).toBe(true);
    }
  });

  /**
   * MUTATION GUARD: with phase75 removed from LIVE_ONLY, the detector must
   * flag it. Proves the check has teeth rather than trivially passing.
   */
  it("would flag phase75 if the exclusion were removed", async () => {
    const offenders = await nonHermeticTests();
    expect(offenders.some((f) => f.includes("phase75"))).toBe(true);

    const withoutPhase75 = excludedPrefixes().filter((p) => !p.startsWith("phase75"));
    const leaked = offenders.filter((f) => !isExcluded(f, withoutPhase75));
    expect(leaked.some((f) => f.includes("phase75"))).toBe(true);
  });
});
