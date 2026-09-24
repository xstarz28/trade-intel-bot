/**
 * Phase 243 — the operator checker, exercised as the operator runs it.
 *
 * These tests spawn the real script (`scripts/verify-production-config.mjs`) with
 * configuration files written to a temporary directory: the exit code, the
 * outcome and every byte it prints are the observable behaviour, not a
 * description of it. Nothing here touches the machine's configuration — the
 * child is given a stripped environment on purpose, and one test proves the
 * verdict does not change when the ambient environment is emptied, which is the
 * difference between "reads its input" and "reads the machine".
 *
 * No network: the script imports only filesystem, path, url and module builtins,
 * and the suite runs under the repository's hermetic guard, which fails any
 * non-loopback connection. No deployment: the script has no way to reach one —
 * asserted below, and true of the policy module it loads.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const SCRIPT = "scripts/verify-production-config.mjs";
const dir = mkdtempSync(join(tmpdir(), "phase243-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A secret long enough to matter, assembled so no literal is credential-shaped. */
const EMAIL_SECRET = ["e243", "5a7c9e1b3d5f7a9c1e3b"].join("-");

/** Complete synthetic production configuration — no real key, ever. */
function complete(): Record<string, string> {
  return {
    XSTARZ_DEPLOYMENT_ENV: "production",
    CONVEX_SITE_URL: "https://xstarz-prod.convex.site",
    VITE_CONVEX_URL: "https://xstarz-prod.convex.cloud",
    CONVEX_DEPLOYMENT: "prod:xstarz-team:xstarz-prod",
    /* Phase 270: no XSTARZ_EMAIL_* names — a complete configuration has none. */
    TWELVE_DATA_API_KEY: "td-243",
    ALPHA_VANTAGE_API_KEY: "av-243",
    COINGLASS_API_KEY: "cg-243",
    TICKATLAS_API_KEY: "ta-243",
    EIA_API_KEY: "eia-243",
  };
}

function writeConfig(name: string, config: Record<string, string>): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the checker with a stripped environment: its input is the file, nothing else. */
function run(args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: dir },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const outcomeOf = (run: Run): string | undefined =>
  run.stdout.split("\n").find((line) => line.startsWith("outcome: "))?.slice("outcome: ".length);

describe("243 — the operator checker, run as an operator runs it", () => {
  it("accepts a complete configuration, and says what that does not mean", () => {
    const path = writeConfig("complete.json", complete());
    const result = run(["--config", path]);

    expect(result.status, result.stderr).toBe(0);
    expect(outcomeOf(result)).toBe("READY_FOR_CONFIGURATION");
    expect(result.stdout).toMatch(/productionVerified: no/);
    expect(result.stdout).toMatch(/does not mean production/);
    expect(result.stdout).toMatch(/release:report/);
  });

  it("refuses a configuration with a required variable missing", () => {
    const config = complete();
    delete config.CONVEX_DEPLOYMENT;
    const result = run(["--config", writeConfig("missing.json", config)]);

    expect(result.status).toBe(1);
    expect(outcomeOf(result)).toBe("MISSING_REQUIRED_CONFIG");
    expect(result.stdout).toMatch(/CONVEX_DEPLOYMENT/);
  });

  it("(retired, Phase 270) a console transport setting is inert, stronger than refused", () => {
    // The email boundary is gone: "console" cannot configure anything, so the
    // checker neither accepts nor refuses a transport — it reports the retired
    // name as unexpected and carries on.
    const result = run([
      "--config",
      writeConfig("console.json", { ...complete(), XSTARZ_EMAIL_TRANSPORT: "console" }),
    ]);

    expect(result.status).toBe(0);
    expect(outcomeOf(result)).toBe("READY_FOR_CONFIGURATION");
    expect(result.stdout).not.toMatch(/delivers nothing|non-delivering/);
    expect(result.stdout).toMatch(/XSTARZ_EMAIL_TRANSPORT/);
    expect(result.stdout).toMatch(/unexpected production-shaped/);
  });

  it("refuses a file that is not valid JSON as malformed, not as empty", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ this is not json", "utf8");
    const result = run(["--config", path]);

    expect(result.status).toBe(1);
    expect(outcomeOf(result)).toBe("INVALID_CONFIG");
    expect(result.stdout).toMatch(/not valid JSON/);
    // Not the "everything is missing" report: a broken file is one problem.
    expect(result.stdout).not.toMatch(/MISSING_REQUIRED_CONFIG/);
  });

  it("reports the environment and identity refusals by name", () => {
    const wrongEnvironment = run([
      "--config",
      writeConfig("dev.json", { ...complete(), XSTARZ_DEPLOYMENT_ENV: "development" }),
    ]);
    expect(wrongEnvironment.status).toBe(1);
    expect(outcomeOf(wrongEnvironment)).toBe("WRONG_ENVIRONMENT");

    const wrongIdentity = run([
      "--config",
      writeConfig("devdeploy.json", { ...complete(), CONVEX_DEPLOYMENT: "dev:xstarz-team:xstarz-dev" }),
    ]);
    expect(wrongIdentity.status).toBe(1);
    expect(outcomeOf(wrongIdentity)).toBe("WRONG_IDENTITY");
  });

  it("never claims verification, even when asked", () => {
    const path = writeConfig("complete-verified.json", complete());
    const result = run(["--config", path, "--require-verified"]);

    expect(result.status).toBe(1);
    expect(outcomeOf(result)).toBe("NOT_VERIFIED");
  });

  it("emits machine-readable JSON that carries the same outcome", () => {
    const path = writeConfig("complete-json.json", complete());
    const result = run(["--config", path, "--json"]);
    const parsed = JSON.parse(result.stdout) as {
      outcome: string;
      productionVerified: boolean;
      deployment: { deploymentVerified: boolean };
      providers: { providerId: string; configured: boolean }[];
    };

    expect(result.status).toBe(0);
    expect(parsed.outcome).toBe("READY_FOR_CONFIGURATION");
    expect(parsed.productionVerified).toBe(false);
    // Phase 270: the email boundary retired — the field is absent, not false.
    expect(Object.keys(parsed as unknown as Record<string, unknown>)).not.toContain("email");
    expect(parsed.deployment.deploymentVerified).toBe(false);
    expect(parsed.providers.length).toBeGreaterThan(9);
    expect(parsed.providers.every((provider) => provider.configured)).toBe(true);
  });

  it("15. no secret value reaches stdout or stderr, in any outcome", () => {
    const cases: [string, Record<string, string>][] = [
      ["ok", complete()],
      // A retired credential name still carries a redactable value.
      ["legacy-email", { ...complete(), XSTARZ_EMAIL_API_KEY: EMAIL_SECRET }],
      ["issuer", { ...complete(), VLY_CONVEX_AUTH_ISSUER: "https://freebuff.com/api/auth" }],
      ["shared", { ...complete(), ALPHA_VANTAGE_API_KEY: "td-243" }],
      ["json", complete()],
    ];

    for (const [name, config] of cases) {
      const args = ["--config", writeConfig(`leak-${name}.json`, config)];
      if (name === "json") args.push("--json");
      const result = run(args);
      const output = `${result.stdout}${result.stderr}`;
      const secrets = Object.entries(config)
        .filter(([key]) => /API_KEY|SECRET|TOKEN|PASSWORD/.test(key))
        .map(([, value]) => value);
      // Phase 270: five provider keys; the retired email key joins where set.
      expect(secrets.length, name).toBeGreaterThan(4);
      for (const value of secrets) {
        if (value.length < 8) continue;
        expect(output, `${name} leaked ${value.slice(0, 3)}…`).not.toContain(value);
      }
    }
  });

  it("18. the verdict does not depend on the ambient environment", () => {
    const path = writeConfig("complete-env-independence.json", complete());
    // `run` already strips the environment to PATH and HOME; the same file must
    // produce the same outcome when the machine's variables are visible.
    const stripped = run(["--config", path]);
    const ambient = execFileSync(process.execPath, [SCRIPT, "--config", path, "--json"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(stripped.status).toBe(0);
    expect(JSON.parse(ambient).outcome).toBe("READY_FOR_CONFIGURATION");
  });

  it("refuses an unreadable configuration path without pretending to evaluate", () => {
    const result = run(["--config", join(dir, "does-not-exist.json")]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/cannot read configuration file/);
    expect(result.stdout).toBe("");
  });

  it("16/17. the checker cannot perform network I/O or deploy anything", () => {
    const text = readFileSync(resolve(root, SCRIPT), "utf8");
    const imports = text
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    expect(imports).toMatch(/node:fs/);
    expect(imports).not.toMatch(/node:child_process|node:net|node:http|node:dgram|node:tls/);
    expect(text).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket/);
    expect(text).not.toMatch(/child_process|execSync|spawnSync|execFile/);
    // No deployment, and no command that could perform one.
    expect(text).not.toMatch(/convex\s+deploy|npx convex|tauri build|gh release|npm publish/);
    // It loads the real policy module, never a copy of the rules.
    expect(text).toMatch(/src\/lib\/deployment\/production-config\.ts/);
  });

  it("prints nothing at all when it is asked for JSON", () => {
    const path = writeConfig("pure-json.json", complete());
    const result = run(["--config", path, "--json"]);

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
  });
});
