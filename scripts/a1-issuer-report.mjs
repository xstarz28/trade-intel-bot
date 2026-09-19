#!/usr/bin/env node
/**
 * Phase 246 — A1 issuer evidence and operator handoff.
 *
 * WHAT IT DOES
 * Prints the deterministic handoff for the A1 operation: which issuer must act,
 * which credential fingerprint must be matched, what the release gate will admit
 * as evidence, what only looks like evidence, what is still unavailable without
 * issuer access, and where an operator would file the attestation.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION
 *   * no issuer request: the import list has no http/https/net/tls/dgram module,
 *     and there is no `fetch` anywhere in this file;
 *   * no credential access: the fingerprint is a published hash prefix, and no
 *     field of any record — manifest, environment or file — is printed as a value;
 *   * no ref write and no git mutation: every git command runs through a
 *     read-only allowlist (READ_ONLY_GIT) and the guarded `git()` helper is the
 *     only place a process is spawned;
 *   * no file write: nothing here writes, appends, removes or creates a path, so
 *     no synthetic record can be persisted as production evidence by this command;
 *   * no deployment, no email, no provider credential change: there is no code
 *     path for any of them.
 *
 * Usage
 *   node scripts/a1-issuer-report.mjs
 *   node scripts/a1-issuer-report.mjs --json
 *   node scripts/a1-issuer-report.mjs --issuer-access unavailable
 *   node scripts/a1-issuer-report.mjs --attestation docs/remediation/a1-revocation-attestation.json
 *
 * Exit codes
 *   0 = the handoff was produced and the only remaining step is the external one
 *   1 = the handoff was produced, and a blocker remains (today: MISSING_EXTERNAL_ACCESS)
 *   2 = the report could not be produced (a policy module failed to load, or an input could not be read)
 *
 * Exit code 1 is not a negative result about the issuer: it means the evidence
 * that would prove revocation does not exist yet, which is a different statement
 * from "the credential has been checked and is fine".
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * The policy modules use extensionless relative imports, which is what the Convex
 * bundler expects but not what Node's ESM resolver does. This hook appends the
 * .ts extension so the REAL modules load unmodified, and resolves the project's
 * "@/" alias without making the tooling copy their imports.
 */
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const aliased = resolve(process.cwd(), "src", specifier.slice(2));
      for (const candidate of [aliased, `${aliased}.ts`, `${aliased}/index.ts`]) {
        try {
          readFileSync(candidate);
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          /* try the next form */
        }
      }
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

/* ── git, read-only ─────────────────────────────────────────────────────── */

const READ_ONLY_GIT = new Set([
  "rev-parse",
  "symbolic-ref",
  "remote",
  "status",
  "rev-list",
  "for-each-ref",
]);

/**
 * The only place this file spawns a process. The verb is checked against the
 * allowlist before anything runs, so `push`, `update-ref`, `fetch`, `gc`, `reset`
 * and friends are not merely unused here — they are refused.
 */
function git(args) {
  const verb = args[0];
  if (!READ_ONLY_GIT.has(verb)) {
    throw new Error(`refused: "git ${verb}" is not in the read-only allowlist`);
  }
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 24 });
  if (result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
}

/* ── flags ──────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const flag = (name) => {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
};

async function main() {
  const manifestModule = await import("../src/lib/deployment/remediation-manifest.ts");
  const evidenceModule = await import("../src/lib/deployment/a1-issuer-evidence.ts");
  const currentStateModule = await import("../src/lib/deployment/release-current-state.ts");
  const { REMEDIATION_MANIFEST } = manifestModule;
  const { buildA1OperatorHandoff, formatA1OperatorHandoff, a1HandoffJson, a1HandoffExitCode, validateA1Attestation } =
    evidenceModule;
  const { currentReleaseVerdict } = currentStateModule;

  const now = Number(flag("--now") ?? Date.now());
  if (!Number.isFinite(now)) {
    console.error("fatal: --now must be a finite instant in milliseconds");
    return 2;
  }

  /* The repository observation is read, never inferred from a directory name. */
  const gitDir = git(["rev-parse", "--git-dir"]);
  const repository = {
    workdir: process.cwd(),
    branch: git(["symbolic-ref", "--short", "HEAD"]) || "(detached)",
    head: git(["rev-parse", "HEAD"]) || "UNKNOWN",
    remoteName: "origin",
    remoteUrl: git(["remote", "get-url", "origin"]) || "",
    shallow: gitDir.length > 0 && existsSync(resolve(gitDir, "shallow")),
    worktreeClean: git(["status", "--porcelain"]).length === 0,
    historyCommitCount: Number(git(["rev-list", "--count", "HEAD"]) || 0),
  };

  const issuerAccess = flag("--issuer-access") ?? "unavailable";
  if (!["available", "unavailable", "unknown"].includes(issuerAccess)) {
    console.error(`fatal: --issuer-access must be available, unavailable or unknown (got "${issuerAccess}")`);
    return 2;
  }

  const releaseVerdict = currentReleaseVerdict(undefined, { now });
  const report = buildA1OperatorHandoff({
    manifest: REMEDIATION_MANIFEST,
    repository,
    externalIssuerAccess: issuerAccess,
    now,
    releaseVerdict: releaseVerdict.verdict,
  });

  /* An attestation is only ever READ here: the command has no way to file one. */
  const attestationPath = flag("--attestation");
  let attestation = null;
  if (attestationPath) {
    const absolute = resolve(process.cwd(), attestationPath);
    if (!existsSync(absolute)) {
      attestation = { path: attestationPath, present: false, state: "NOT_FILED", admissible: false, problems: ["the file does not exist"] };
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSync(absolute, "utf8"));
      } catch {
        attestation = { path: attestationPath, present: true, state: "MALFORMED", admissible: false, problems: ["the file is not valid JSON"] };
      }
      if (parsed !== null) {
        const validation = validateA1Attestation(parsed, { manifest: REMEDIATION_MANIFEST, now });
        attestation = { path: attestationPath, present: true, ...validation };
      }
    }
  }

  /* 0 only when the handoff is actionable *and* nothing supplied was refused. */
  const handoffCode = a1HandoffExitCode(report);
  const suppliedButRefused = attestation !== null && attestation.admissible !== true;
  const exitCode = handoffCode === 0 && !suppliedButRefused ? 0 : 1;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ...report,
          attestation: attestation
            ? { path: attestation.path, present: attestation.present, state: attestation.state, admissible: attestation.admissible, problems: attestation.problems }
            : null,
          exitCode,
        },
        null,
        2,
      ),
    );
    return exitCode;
  }

  console.log(formatA1OperatorHandoff(report));
  if (attestation !== null) {
    console.log("");
    console.log("── attestation filed at the proof path ─────────────────────────────────");
    console.log(`path: ${attestation.path}`);
    console.log(`present: ${attestation.present ? "yes" : "no"}`);
    console.log(`state: ${attestation.state} (${attestation.admissible ? "the gate can admit it" : "the gate cannot admit it"})`);
    for (const problem of attestation.problems) console.log(`  refused: ${problem}`);
  } else {
    console.log("");
    console.log(
      `attestation: not supplied (pass --attestation ${report.contract.attestation.path} to validate a filed record)`,
    );
  }
  console.log("");
  console.log(
    `exitCode: ${exitCode} (0 = only the external step remains; 1 = a blocker remains, which is not a negative result about the issuer)`,
  );
  return exitCode;
}

const invokedAsFile = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedAsFile) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`fatal: the report could not be produced: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
