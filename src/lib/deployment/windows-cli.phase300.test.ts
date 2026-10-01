/**
 * Phase 300 hotfix — the publication path must run from Windows CMD.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * The operator ran `npm.cmd run frontend:publish -- --allow-dirty` from Windows
 * CMD and got:
 *
 *     building…
 *     REFUSED: the build failed:
 *
 * — an empty failure. The cause was not the build: `spawnSync("npm", …)` cannot
 * start `npm.cmd` on Windows (Node does not consult `PATHEXT`, and a `.cmd`
 * needs a shell), so the child never existed, `status` was `null` and both
 * streams were empty. The same would have hit `npx` at the upload and the alias.
 *
 * These tests pin, without deploying anything:
 *
 *   · the executable chosen per platform (`npm.cmd`/`npx.cmd` on Windows, the
 *     bare names elsewhere) and that a shell is used ONLY for the `.cmd` case;
 *   · that a command which cannot start reports WHY, instead of empty output;
 *   · that candidate fallback (a Windows `git.cmd` when `git.exe` is absent)
 *     still yields a real result;
 *   · that every child-process call in the publication path goes through the
 *     helper — no bare `spawnSync("npm")`/`spawnSync("npx")` remains;
 *   · that none of this weakened a guard: the pinned-branch check, the artifact
 *     verification and the published-URL verification are all still in the order
 *     that makes them meaningful.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXECUTABLE_CANDIDATES,
  executableCandidates,
  gitOutput,
  isMissingExecutable,
  resolveExecutable,
  runCommand,
} from "../../../scripts/lib/executable.mjs";
import { chooseHostUrl, isHostnameShaped, projectDomains } from "../../../scripts/resolve-vercel-target.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

type SpawnOutcome = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: { code?: string; message?: string } | null;
};
type SpawnLike = (command: string, args: string[], options: Record<string, unknown>) => SpawnOutcome;

/** A fake `spawnSync` that records the calls it received. */
function spySpawn(behaviour: SpawnLike) {
  const calls: { command: string; args: string[]; shell: boolean | undefined }[] = [];
  const spawn: SpawnLike = (command, args, options) => {
    calls.push({ command, args, shell: options?.shell as boolean | undefined });
    return behaviour(command, args, options);
  };
  return { spawn, calls };
}

const ok = (stdout = ""): SpawnOutcome => ({ status: 0, stdout, stderr: "", error: null });
const enoent = (): SpawnOutcome => ({
  status: null,
  stdout: "",
  stderr: "",
  error: Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }),
});

describe("300h — the executable chosen per platform", () => {
  it("uses the .cmd shims on Windows and the bare names elsewhere", () => {
    expect(resolveExecutable("npm", "win32")).toMatchObject({ command: "npm.cmd", shell: true });
    expect(resolveExecutable("npx", "win32")).toMatchObject({ command: "npx.cmd", shell: true });
    expect(resolveExecutable("node", "win32")).toMatchObject({ command: "node.exe", shell: false });
    expect(resolveExecutable("git", "win32")).toMatchObject({ command: "git.exe", shell: false });

    for (const platform of ["linux", "darwin"]) {
      expect(resolveExecutable("npm", platform)).toMatchObject({ command: "npm", shell: false });
      expect(resolveExecutable("npx", platform)).toMatchObject({ command: "npx", shell: false });
      expect(resolveExecutable("node", platform)).toMatchObject({ command: "node", shell: false });
      expect(resolveExecutable("git", platform)).toMatchObject({ command: "git", shell: false });
    }
  });

  it("keeps the Unix behaviour byte-for-byte: one candidate, no shell", () => {
    expect(executableCandidates("npm", "linux")).toEqual(["npm"]);
    expect(executableCandidates("npm", "darwin")).toEqual(["npm"]);
    expect(executableCandidates("npm", "win32")).toEqual(["npm.cmd", "npm"]);
  });

  it("does not pretend to know an unknown command", () => {
    expect(resolveExecutable("somethingelse", "win32")).toMatchObject({ command: "somethingelse", shell: false });
    expect(EXECUTABLE_CANDIDATES).toHaveProperty("npm");
  });

  it("treats only cmd/bat as shell scripts", () => {
    expect(resolveExecutable("npm", "win32").shell).toBe(true);
    expect(resolveExecutable("node", "win32").shell).toBe(false);
    // A .cmd on POSIX is not a thing Node needs a shell for.
    expect(resolveExecutable("npm", "linux").shell).toBe(false);
  });
});

describe("300h — running a command on Windows runs npm.cmd, and says why when it cannot", () => {
  it("spawns npm.cmd with a shell on win32", () => {
    const { spawn, calls } = spySpawn(() => ok("built"));
    const result = runCommand("npm", ["run", "build"], { platform: "win32", spawn });
    expect(calls).toEqual([{ command: "npm.cmd", args: ["run", "build"], shell: true }]);
    expect(result).toMatchObject({ status: 0, stdout: "built", executable: "npm.cmd", shell: true });
    expect(result.failureText).toBeNull();
  });

  it("spawns the bare name without a shell on POSIX", () => {
    const { spawn, calls } = spySpawn(() => ok("built"));
    const result = runCommand("npm", ["run", "build"], { platform: "linux", spawn });
    expect(calls).toEqual([{ command: "npm", args: ["run", "build"], shell: false }]);
    expect(result).toMatchObject({ status: 0, executable: "npm", shell: false });
  });

  it("reports the reason a command could not start, instead of empty output", () => {
    // The Windows symptom: status null, no stdout, no stderr. The helper must
    // never hand that to a caller without saying why.
    const { spawn } = spySpawn(() => enoent());
    const result = runCommand("npm", ["run", "build"], { platform: "win32", spawn });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.failureText).toMatch(/could not run "npm" on win32/);
    expect(result.failureText).toMatch(/npm\.cmd -> ENOENT/);
    expect(result.failureText).toMatch(/npm -> ENOENT/);
    expect(result.attempts.map((a) => a.executable)).toEqual(["npm.cmd", "npm"]);
  });

  it("falls back to the next candidate (git.cmd when git.exe is absent)", () => {
    const { spawn, calls } = spySpawn((command) => (command === "git.exe" ? enoent() : ok("origin\n")));
    const output = gitOutput(["config", "--get", "remote.origin.url"], { platform: "win32", spawn });
    expect(output).toBe("origin");
    expect(calls.map((c) => c.command)).toEqual(["git.exe", "git.cmd"]);
    // The .cmd fallback is shell-run; the .exe attempt was not.
    expect(calls.map((c) => c.shell)).toEqual([false, true]);
  });

  it("returns null — not a crash — when git is absent entirely", () => {
    const { spawn } = spySpawn(() => enoent());
    expect(gitOutput(["rev-parse", "HEAD"], { platform: "win32", spawn })).toBeNull();
  });

  it("keeps a real failure as a failure (a non-zero exit is a result, not a reason to try another binary)", () => {
    const { spawn, calls } = spySpawn(() => ({ status: 2, stdout: "partial", stderr: "boom\n", error: null }));
    const result = runCommand("npm", ["run", "build"], { platform: "win32", spawn });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("boom\n");
    expect(result.failureText).toMatch(/exited with code 2: boom/);
  });

  it("only treats not-found/not-runnable as 'missing'", () => {
    expect(isMissingExecutable({ error: { code: "ENOENT" } })).toBe(true);
    expect(isMissingExecutable({ error: { code: "EINVAL" } })).toBe(true);
    expect(isMissingExecutable({ error: { code: "EACCES" } })).toBe(true);
    expect(isMissingExecutable({ error: { code: "EPIPE" } })).toBe(false);
    expect(isMissingExecutable({ status: 1 })).toBe(false);
  });
});

describe("300h — every child process in the publication path goes through the helper", () => {
  const PUBLISH = "scripts/publish-frontend.mjs";
  const RESOLVER = "scripts/resolve-vercel-target.mjs";
  const VERIFY = "scripts/verify-frontend-artifact.mjs";

  it("has no bare npm/npx/git spawn left in the publication path", () => {
    for (const path of [PUBLISH, RESOLVER, VERIFY]) {
      const source = read(path);
      expect(source, path).not.toMatch(/spawnSync\(\s*["'`](npm|npx|git)["'`]/);
      expect(source, path).not.toMatch(/execFileSync\(\s*["'`](npm|npx|git)["'`]/);
      expect(source, path).not.toMatch(/execSync\(\s*["'`]git/);
    }
  });

  it("imports the platform-safe runner wherever it runs a command", () => {
    expect(read(PUBLISH)).toMatch(/from "\.\/lib\/executable\.mjs"/);
    expect(read(RESOLVER)).toMatch(/from "\.\/lib\/executable\.mjs"/);
    expect(read(VERIFY)).toMatch(/from "\.\/lib\/executable\.mjs"/);
    expect(read(PUBLISH)).toMatch(/runCommand\(/);
  });

  it("names the executable it used, so a Windows log is diagnosable", () => {
    const source = read(PUBLISH);
    expect(source).toMatch(/building… \(\$\{resolveExecutable\("npm"\)\.command\}\)/);
    expect(source).toMatch(/via \$\{deploy\.executable \?\? resolveExecutable\("npx"\)\.command\}/);
    expect(source).toMatch(/failureText/);
  });
});

describe("300h — the hotfix weakened no guard", () => {
  it("still refuses a non-pinned branch, a dirty tree and a missing token before building", () => {
    const source = read("scripts/publish-frontend.mjs");
    const guard = source.indexOf("evaluateFrontendPublicationGuard");
    const dirty = source.indexOf("args.requireClean && dirty");
    const build = source.indexOf('run("npm"');
    for (const at of [guard, dirty, build]) expect(at).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(build);
    expect(dirty).toBeLessThan(build);
    const refusal = source.indexOf('guard.state === "FORBIDDEN_SOURCE_REF"');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(build);
    expect(source).toMatch(/WRONG_SOURCE_BRANCH/);
  });

  it("still verifies the artifact before upload and the PUBLISHED url after", () => {
    const source = read("scripts/publish-frontend.mjs");
    const verifyArtifact = source.indexOf("scripts/verify-frontend-artifact.mjs");
    // The call site, not the import line at the top of the file.
    const upload = source.indexOf("prebuiltDeployArgs({");
    const alias = source.indexOf('"alias", "set"');
    const verifyPublished = source.indexOf("scripts/verify-published-frontend.mjs");
    expect(verifyArtifact).toBeLessThan(upload);
    expect(upload).toBeLessThan(alias);
    expect(alias).toBeLessThan(verifyPublished);
    expect(source).toMatch(/--expect-build-info-sha256/);
    expect(source).toMatch(/--expect-asset-names/);
  });

  it("refuses a browser-facing host that is not a hostname, so a shell-run .cmd cannot be steered", () => {
    for (const bad of ["x; rm -rf /", "host with spaces", "https://host/path", "a..b", "`whoami`", "$(id)"]) {
      expect(isHostnameShaped(bad), bad).toBe(false);
    }
    for (const good of ["trade-intel-bot.freebuff.app", "trade-intel-bot.vercel.app", "a.b-c.example"]) {
      expect(isHostnameShaped(good), good).toBe(true);
    }
    const refused = chooseHostUrl({ explicit: "https://x; rm -rf /", domains: [], allowUnverifiedHost: true });
    expect(refused.hostUrl).toBeNull();
    expect(refused.problem).toMatch(/not a hostname/);
    // A listed host that is a hostname is still accepted.
    const accepted = chooseHostUrl({
      explicit: "https://trade-intel-bot.freebuff.app/",
      domains: [{ name: "trade-intel-bot.freebuff.app", source: "project domain", verified: true }],
    });
    expect(accepted.hostUrl).toBe("https://trade-intel-bot.freebuff.app");
  });

  it("drops a project domain that is not a hostname rather than passing it on", () => {
    const domains = projectDomains(
      { alias: ["trade-intel-bot.vercel.app"] },
      [
        { name: "trade-intel-bot.vercel.app", verified: true },
        { name: "not a host; rm -rf /", verified: true },
        { name: "*.wildcard.example", verified: true },
      ],
    );
    expect(domains.map((d: { name: string }) => d.name)).toEqual(["trade-intel-bot.vercel.app"]);
  });
});
