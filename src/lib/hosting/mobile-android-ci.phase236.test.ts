/**
 * Phase 236 — the Android packaging job must keep failing loudly, and must set
 * up a toolchain that still exists.
 *
 * THE FAILURE THIS EXPLAINS
 * The `Android debug APK` job went red on 2026-09-15 and stayed red. The red is
 * NOT in the Gradle build: the `android-actions/setup-android@v3` step fails in
 * about nine seconds and steps 6–10 (`Install dependencies` … `Upload APK`) are
 * all SKIPPED, so the APK is never even attempted.
 *
 * The action's default input is `packages: 'tools platform-tools'`. Google
 * stopped serving the legacy `tools` package, so the action's
 * `sdkmanager tools` exits 1 and the action throws before anything else runs.
 * Upstream: android-actions/setup-android#537, opened 2026-09-15T01:26Z, which
 * reports `Failed to find package 'tools'` against `9fc6c4e` — the commit the
 * `v3` tag points at, i.e. the exact action revision this workflow resolves to.
 * v4 carries the same default, so a major-version bump would not have fixed it.
 *
 * THE FIX IS A PINNED PACKAGE LIST, NOT A DISABLED CHECK
 * The job now asks for `platform-tools` explicitly. Nothing about the failure
 * handling was relaxed: `set -euo pipefail` stays, the Gradle command stays
 * fatal, the "an APK exists", "the web assets are inside it" and "the asset base
 * is absolute" assertions stay, and the packaged-artifact secret scan stays.
 *
 * WHAT THESE TESTS ARE FOR
 * Every one of those properties is a line of configuration that a future edit
 * can quietly delete. This suite reads the workflow as text (deliberately no
 * YAML dependency, following Phase 181) and fails if the job stops being fatal,
 * stops proving it did real work, or goes back to relying on a default package
 * set that includes a package the SDK no longer serves.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKFLOW = join(ROOT, ".github", "workflows", "mobile.yml");
const raw = readFileSync(WORKFLOW, "utf8");

/** The `android:` job block: from its key to the next two-space job key. */
function jobBlock(name: string): string {
  const start = raw.indexOf(`\n  ${name}:`);
  if (start === -1) return "";
  const rest = raw.slice(start + 1);
  const next = rest.slice(1).match(/\n {2}[a-z][\w-]*:/);
  return next?.index === undefined ? rest : rest.slice(0, next.index + 1);
}

/** Steps of a job block, split on the six-space `- ` step marker. */
function steps(block: string): string[] {
  return block
    .split(/\n(?= {6}- )/)
    .filter((s) => /^ {6}- /.test(s))
    .map((s) => s.trimEnd());
}

/** The shell body of a step, without YAML indentation. */
function shellOf(step: string): string {
  const body = step.slice(step.indexOf("run:"));
  return body
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .join("\n");
}

const android = jobBlock("android");
const androidSteps = steps(android);
const setupAndroidStep = androidSteps.find((s) => s.includes("uses: android-actions/setup-android@"));
const assembleStep = androidSteps.find((s) => s.includes("Assemble debug APK"));
const assembleShell = assembleStep ? shellOf(assembleStep) : "";

/** `packages:` tokens, split the way the action splits them (on spaces). */
const packagesTokens = (setupAndroidStep ?? "")
  .split("\n")
  .filter((l) => l.trim().startsWith("packages:"))
  .flatMap((l) =>
    l
      .slice(l.indexOf("packages:") + "packages:".length)
      // Trim BEFORE stripping quotes: with the quotes still attached to a
      // leading space, `^["']` never matches and `"tools platform-tools"` would
      // tokenise to `['"tools', 'platform-tools"']` — hiding the very package
      // this guard exists to reject.
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );

describe("Phase 236 — the Android job cannot silently stop proving anything", () => {
  it("still defines the job, on a hosted Linux runner with a bound", () => {
    expect(android, "the android job is gone from mobile.yml").not.toBe("");
    expect(android).toMatch(/runs-on:\s*ubuntu-latest/);
    const timeout = android.match(/timeout-minutes:\s*(\d+)/);
    expect(timeout, "the job has no timeout-minutes").toBeTruthy();
    expect(Number(timeout![1])).toBeGreaterThan(0);
    expect(Number(timeout![1])).toBeLessThanOrEqual(60);
    // The packaging steps must exist at all — a job that runs nothing is a
    // green tick that proves nothing.
    for (const name of [
      "Install dependencies",
      "Build web assets and sync into the native project",
      "Assemble debug APK",
      "Verify packaged artifacts contain no secrets",
      "Upload APK",
    ]) {
      expect(android, `step missing from the android job: ${name}`).toContain(`name: ${name}`);
    }
  });

  it("cannot swallow a failure: no continue-on-error and no false condition", () => {
    expect(android).not.toMatch(/continue-on-error/);
    // A conditional job is how a packaging check quietly disappears. `if: false`
    // and its spellings are rejected outright.
    expect(android).not.toMatch(/if:\s*(false|["']false["']|\$\{\{\s*false\s*\}\})/);
  });

  it("installs a JDK the Android Gradle Plugin actually supports", () => {
    const java = android.match(/java-version:\s*"(\d+)"/);
    expect(java, "the android job no longer pins a JDK").toBeTruthy();
    // android/build.gradle pins AGP 8.7.2, whose floor is JDK 17. A downgrade
    // would fail the build; pinning it here makes the failure explicit rather
    // than a mystery in a skipped step.
    expect(Number(java![1]), "JDK below the AGP 8.x floor").toBeGreaterThanOrEqual(17);
  });
});

describe("Phase 236 — the Android SDK packages are explicit and still exist", () => {
  it("pins `packages` instead of taking the action's default", () => {
    expect(setupAndroidStep, "no android-actions/setup-android step").toBeTruthy();
    // The action's default is `tools platform-tools`; relying on it is exactly
    // what broke on 2026-09-15.
    expect(
      packagesTokens.length,
      "packages is not set, so the action falls back to its default (`tools platform-tools`)",
    ).toBeGreaterThan(0);
  });

  it("never asks for the retired `tools` package", () => {
    // Token equality, not substring: `platform-tools` contains "tools", so a
    // substring check would both misfire and miss the real defect.
    expect(packagesTokens, `packages asks for the removed 'tools' package: ${packagesTokens.join(" ")}`).not.toContain(
      "tools",
    );
  });

  it("still asks for the component the job uses", () => {
    expect(packagesTokens).toContain("platform-tools");
  });

  it("injects no credential to make the build pass", () => {
    // A debug APK needs no signing material and no provider key; if a secret
    // ever appears here, the build is no longer reproducible from the repo.
    expect(raw).not.toMatch(/\$\{\{\s*secrets\./);
  });
});

describe("Phase 236 — the APK step still proves it did real work", () => {
  it("fails the job on the first error, with a stacktrace for the next reader", () => {
    expect(assembleStep, "the Assemble debug APK step is gone").toBeTruthy();
    expect(assembleStep).toMatch(/working-directory:\s*android/);
    expect(assembleShell).toContain("set -euo pipefail");
    expect(assembleShell).toContain("./gradlew assembleDebug");
    expect(assembleShell).toContain("--no-daemon");
    expect(assembleShell).toContain("--stacktrace");
  });

  it("does not swallow the Gradle exit code", () => {
    expect(assembleShell).not.toMatch(/\|\|\s*true/);
    expect(assembleShell).not.toMatch(/\|\|\s*echo/);
    expect(assembleShell).not.toMatch(/continue-on-error/);
  });

  it("asserts an APK was produced, and that it contains the web app", () => {
    expect(assembleShell).toMatch(/test -n "\$APK"/);
    // Assert the two checks as COMMANDS, not as bare substrings: the bare path
    // `assets/public/index.html` also appears in the second command, so a
    // substring check would keep passing after the zip-listing check had been
    // weakened (mutation M9 proved exactly that).
    expect(assembleShell, "the APK is no longer listed to prove the web assets are inside it").toMatch(
      /unzip -l "\$APK" \| grep -q 'assets\/public\/index\.html'/,
    );
    // The Phase 180 defect: a relative base renders a blank page in the app.
    expect(assembleShell, "the absolute asset base is no longer verified").toMatch(
      /unzip -p "\$APK" assets\/public\/index\.html \| grep -q 'src="\/assets\/'/,
    );
  });

  it("builds the web assets from source and scans the packaged artifacts", () => {
    const sync = android.indexOf("npm run mobile:sync:android");
    const build = android.indexOf("./gradlew assembleDebug");
    expect(sync, "the native project is no longer synced from the web build").toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(sync, "the APK is assembled before the web assets are synced").toBeLessThan(build);
    expect(android).toContain("run: npm run mobile:verify");
  });
});
