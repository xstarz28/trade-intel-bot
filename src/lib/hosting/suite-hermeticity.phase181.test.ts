/**
 * Phase 181 — the default test suite must be hermetic.
 * Phase 237 — and the proof must be behavioural, not a hostname list.
 *
 * THE ORIGINAL DEFECT
 * `npm test` passed locally (8,455 tests) and failed on GitHub Actions. The
 * cause was not a code difference — it was a NETWORK difference.
 * phase75-production-activation.test.ts calls api.coingecko.com for real. The
 * sandbox has no outbound provider access, so the fetch always failed and the
 * test took its graceful-skip path. A GitHub runner has full network access,
 * so the call actually executed and its assertions ran against a live third
 * party — subject to that party's uptime and rate limits.
 *
 * WHAT PHASE 181 GOT WRONG
 * It enforced the rule by scanning test sources for hostnames drawn from a
 * hardcoded list, plus a regex for `fetch(`/`axios.*(` applied to a literal URL.
 * That is a detector for the leaks somebody already thought of. Phase 237's
 * runtime audit found the suite was making 45 real outbound requests per run,
 * including 29 from phase54 — which called `verifyProvider()`, whose `fetch()`
 * lives in `market-radar/verification.ts`, so no URL literal ever appeared in
 * the test. Two more escapes: `vi.mock(` anywhere in a file excused every call
 * in it, and `derivatives-bridge.phase226.test.ts` leaked a request that the
 * list simply did not name.
 *
 * WHAT REPLACED IT
 *   1. RUNTIME (authoritative): `src/test-network-guard.ts` refuses every
 *      non-loopback outbound attempt, whatever API reaches for it. Proved by
 *      `hermetic-network-guard.phase237.test.ts` (node) and
 *      `hermetic-guard-jsdom.phase237.test.tsx` (jsdom).
 *   2. STRUCTURE (this file): live suites are not collected by the default
 *      config; both projects install the guard; the two configs agree; and no
 *      file the default suite collects performs a direct outbound call to a
 *      non-loopback URL — a boundary derived from the same loopback predicate
 *      the runtime guard uses, instead of a list of provider hostnames that
 *      goes stale the moment a provider is added.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { isLoopbackHost } from "../../test-network-guard";

const ROOT = process.cwd();
const GUARD_SETUP = "src/test-setup-network-guard.ts";

function readConfig(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** Recursively collect test files without depending on an undeclared glob package. */
function findTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findTestFiles(full, acc);
    else if (/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const rel = (file: string): string => relative(ROOT, file).replace(/\\/g, "/");

/** Characters that mean something to RegExp and must be escaped verbatim. */
const REGEXP_SPECIAL = new Set([
  ".",
  "+",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);

/**
 * Glob → RegExp, where a double-star path segment matches zero or more
 * directories. (Written as "double-star" rather than the literal pair, because
 * a star immediately followed by a slash closes a block comment — the reason
 * this file previously failed to compile.)
 */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (REGEXP_SPECIAL.has(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp("^" + out + "$");
}

const matches = (file: string, globs: string[]): boolean =>
  globs.some((g) => globToRegExp(g).test(file));

/** String literals inside the array assigned to `name` in a config's text. */
function stringArray(cfg: string, name: string): string[] {
  const block = cfg.match(new RegExp(`${name}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Prefixes excluded from the default suite by vitest.config.ts. */
function liveOnlyPatterns(): string[] {
  const cfg = readConfig("vitest.config.ts");
  const block = cfg.match(/const LIVE_ONLY\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The exclude globs the default config actually computes.
 *
 * They are not written as a literal array — each project writes
 * `exclude: LIVE_ONLY.map((p) => ...)`. Reading the expression is what keeps
 * this check honest: a version that only understood literal arrays would
 * report "nothing is excluded" and quietly pass while every live suite ran.
 */
function defaultExcludePatterns(): string[] {
  const cfg = readConfig("vitest.config.ts");
  const patterns: string[] = [];
  for (const line of cfg.split("\n")) {
    const declared = line.match(/exclude:\s*(.+)$/);
    if (!declared) continue;
    const expr = declared[1].trim();
    const mapped = expr.match(/LIVE_ONLY\.map\(\(p\)\s*=>\s*`\$\{p\}([^`]*)`\)/);
    if (mapped) {
      patterns.push(...liveOnlyPatterns().map((p) => `${p}${mapped[1]}`));
    } else {
      for (const quoted of expr.match(/"[^"]+"/g) ?? []) patterns.push(quoted.slice(1, -1));
    }
  }
  return patterns;
}

/** Every file the default suite actually collects. */
function defaultSuiteFiles(): string[] {
  const cfg = readConfig("vitest.config.ts");
  const include = stringArray(cfg, "include");
  const exclude = defaultExcludePatterns();
  return findTestFiles(join(ROOT, "src"))
    .map(rel)
    .filter((f) => matches(f, include) && !matches(f, exclude));
}

const CALL_SYNTAX = String.raw`(?:\b[\w$]*[Ff]etch\s*\(|\bhttps?\.(?:get|request)\s*\(|\bnet\.connect\s*\(|\btls\.connect\s*\()`;
const urlLiteral = (quote: string) =>
  new RegExp(`${CALL_SYNTAX}\\s*\\n?\\s*${quote}(https?://[^\\s${quote}\\\\)]+)`, "g");

/**
 * Tests that deliberately attempt external I/O in order to prove it is
 * refused, plus this file (which names the boundary rule). They are exempt
 * because attempting a blocked connection is their subject — the runtime guard
 * still governs whether the attempt can succeed.
 */
const ATTEMPTS_BLOCKED_ON_PURPOSE = [
  /hermetic-network-guard\.phase237\.test\.ts$/,
  /hermetic-guard-jsdom\.phase237\.test\.tsx$/,
  /suite-hermeticity\.phase181\.test\.ts$/,
];

/** A direct outbound call whose URL literal points somewhere non-loopback. */
function directExternalCalls(relPath: string): string[] {
  const code = readFileSync(join(ROOT, relPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const quote of ['"', "'", "`"]) {
    for (const m of code.matchAll(urlLiteral(quote))) {
      let host: string | null = null;
      try {
        // A template URL interpolates at runtime (`http://127.0.0.1:${port}/x`),
        // so it cannot be parsed as written. Substituting the interpolation
        // keeps the authority intact — a loopback origin stays loopback, and
        // `https://${host}/x` still resolves to a host that is not loopback and
        // is therefore reported.
        host = new URL(m[1].replace(/\$\{[^}]*\}/g, "0")).hostname;
      } catch {
        host = null;
      }
      if (host === null || !isLoopbackHost(host)) found.push(m[1]);
    }
  }
  return found;
}

describe("Phase 181/237 — default suite hermeticity", () => {
  it("wires the runtime guard into every project", () => {
    const cfg = readConfig("vitest.config.ts");
    // Declared once as a constant, then referenced by each project's
    // setupFiles — a literal count would miss that indirection.
    expect(cfg).toContain(GUARD_SETUP);
    expect((cfg.match(/NETWORK_GUARD_SETUP/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const setupEntries = cfg.match(/setupFiles:\s*\[[^\]]*\]/g) ?? [];
    expect(
      setupEntries.length,
      "expected one setupFiles entry per project",
    ).toBeGreaterThanOrEqual(2);
    for (const entry of setupEntries) expect(entry).toContain("NETWORK_GUARD_SETUP");
    expect(readFileSync(join(ROOT, GUARD_SETUP), "utf8")).toContain("installNetworkGuard");
  });

  it("excludes every live suite from the default suite", () => {
    const patterns = liveOnlyPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    expect(
      defaultExcludePatterns().length,
      "the default config must actually exclude the live patterns",
    ).toBeGreaterThan(0);

    const collected = defaultSuiteFiles();
    const leaked = collected.filter((f) => matches(f, patterns));
    expect(
      leaked,
      `These live suites are still collected by "npm test":\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the two configs in agreement", () => {
    // A file excluded from the default suite but absent from the live config
    // would never run anywhere — silently losing coverage.
    const live = readConfig("vitest.live.config.ts");
    for (const pattern of liveOnlyPatterns()) {
      expect(
        live.includes(pattern),
        `${pattern} is excluded from the default suite but not included in ` +
          `vitest.live.config.ts, so it would never execute at all`,
      ).toBe(true);
    }
    expect(live).toContain("vitest-live-global-setup");
  });

  it("covers phase75 specifically (the CI failure that started this)", () => {
    expect(liveOnlyPatterns().some((p) => p.startsWith("phase75") || p.includes("phase75"))).toBe(
      true,
    );
    expect(readConfig("vitest.live.config.ts")).toContain("phase75");
  });

  it("would collect phase75 if its exclusion were removed", () => {
    // Mutation guard: proves the exclusion is load-bearing rather than
    // decorative. Without the pattern, the file lands in the default suite.
    const cfg = readConfig("vitest.config.ts");
    const include = stringArray(cfg, "include");
    const withoutPhase75 = defaultExcludePatterns().filter((e) => !e.includes("phase75"));
    const wouldBeCollected = defaultSuiteFilesFrom(include, withoutPhase75, "phase75");
    expect(wouldBeCollected.length).toBeGreaterThan(0);
  });

  it("the external-call scanner detects calls without firing on mere mentions", () => {
    // Without this, a scanner that returned [] for every file would let the
    // check below pass while proving nothing. phase75 is the known offender
    // that started Phase 181 — it must still be recognisable as one.
    const knownOffender = "src/lib/position-protection/phase75-production-activation.test.ts";
    expect(directExternalCalls(knownOffender).length).toBeGreaterThan(0);

    // Precision, on a file whose strings name hosts both ways: the guard's own
    // test names api.coingecko.com in a plain constant (a mention, not a call —
    // must be ignored) and reaches 93.184.216.34 as a call argument (an actual
    // attempt — must be reported). A scanner that fired on the mention would be
    // unusable; one that missed the call would be worthless.
    const guardTest = directExternalCalls(
      "src/lib/hosting/hermetic-network-guard.phase237.test.ts",
    );
    // The lookalike hosts it deliberately attempts are reported...
    expect(guardTest.length).toBeGreaterThan(0);
    expect(guardTest.some((url) => url.includes("127.0.0.1.evil.com"))).toBe(true);
    // ...a provider named only in a constant is not (a mention is not a call)...
    expect(guardTest.some((url) => url.includes("api.coingecko.com"))).toBe(false);
    // ...and a loopback origin that merely interpolates a port is not a false
    // positive either.
    expect(guardTest.some((url) => url.includes("127.0.0.1:"))).toBe(false);
  });

  it("no default-suite file makes a direct call to a non-loopback URL", () => {
    const scanned = defaultSuiteFiles().filter(
      (f) => !ATTEMPTS_BLOCKED_ON_PURPOSE.some((re) => re.test(f)),
    );
    // Guard against the check passing because it scanned nothing: the suite is
    // ~290 files today, and a collapsed file list would make "no offenders" a
    // vacuous truth.
    expect(scanned.length).toBeGreaterThan(200);

    const offenders = scanned
      .map((f) => ({ file: f, urls: directExternalCalls(f) }))
      .filter((entry) => entry.urls.length > 0);

    expect(
      offenders,
      `These files run in "npm test" and call an external URL directly. Move them ` +
        `to a *.live.test.ts file (they will otherwise be refused by the runtime ` +
        `guard, which is the point, but they do not belong here):\n` +
        offenders.map((o) => `  - ${o.file}: ${o.urls.join(", ")}`).join("\n"),
    ).toEqual([]);
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
});

/** Files matching `include` minus `exclude`, restricted to a name filter. */
function defaultSuiteFilesFrom(include: string[], exclude: string[], nameFilter: string): string[] {
  return findTestFiles(join(ROOT, "src"))
    .map(rel)
    .filter((f) => matches(f, include) && !matches(f, exclude) && f.includes(nameFilter));
}
