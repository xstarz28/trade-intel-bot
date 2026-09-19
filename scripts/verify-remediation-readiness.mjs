#!/usr/bin/env node
/**
 * Phase 244 — A1/A2 remediation readiness checker.
 *
 * WHAT IT DOES
 * Reads the canonical manifest, the local repository state and the recorded
 * exposure inventory, and answers whether an operator would be performing the
 * remediation against the right repository, the right refs and the right
 * credential — and whether the evidence needed afterwards can exist. It answers
 * nothing else.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION
 *   * no issuer request: the import list has no http/https/net/tls/dgram module,
 *     and there is no `fetch` anywhere in this file;
 *   * no ref write: every git command it runs is checked against a read-only
 *     allowlist (READ_ONLY_GIT) before it runs, so `push`, `update-ref`,
 *     `delete-ref`, `filter-repo`, `gc`, `reset` and `checkout` are not merely
 *     unused — they are refused;
 *   * no file write: nothing here writes, appends, removes or creates a path;
 *   * no deployment, no email, no provider call: there is no code path for any
 *     of them, and the reachability suite asserts that.
 *
 * Usage
 *   node scripts/verify-remediation-readiness.mjs --a1 --issuer auth.freebuff.app \
 *     --fingerprint b1ce18a1e85ba121 --issuer-access unavailable
 *   node scripts/verify-remediation-readiness.mjs --a2 --expect-candidate <sha> [--evidence file.json]
 *   node scripts/verify-remediation-readiness.mjs --capture-evidence --json
 *   node scripts/verify-remediation-readiness.mjs --a2 --json
 *
 * Exit codes
 *   0 = READY_TO_REVOKE / READY_TO_REWRITE (the only remaining step is external)
 *   1 = refused (not ready, wrong identity, wrong scope, missing evidence)
 *   2 = could not evaluate (the policy modules failed to load, or an input could not be read)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * The policy modules use extensionless relative imports, which is what the Convex
 * bundler expects but not what Node's ESM resolver does. This hook appends the
 * .ts extension so the REAL modules load unmodified.
 */
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    // The project's "@/" alias points at src/, which is a bundler setting that
    // Node does not know about. Resolving it here keeps the policy modules
    // unmodified rather than making the tooling copy their imports.
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
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      const parentPath = context.parentURL?.startsWith("file:")
        ? fileURLToPath(context.parentURL)
        : null;
      if (parentPath) {
        const candidate = resolve(parentPath, "..", `${specifier}.ts`);
        try {
          readFileSync(candidate);
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          /* fall through to the default resolver */
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

/* ------------------------------------------------------------------ *
 * Read-only git access
 * ------------------------------------------------------------------ */

/**
 * The complete set of git subcommands this tool may run. Every entry reads; none
 * of them can change a ref, the index or the working tree.
 */
export const READ_ONLY_GIT = new Set([
  "rev-parse",
  "status",
  "remote",
  "rev-list",
  "symbolic-ref",
  "for-each-ref",
  "show-ref",
  "cat-file",
  "count-objects",
  "log",
  "ls-files",
  "config",
]);

function git(args) {
  if (!READ_ONLY_GIT.has(args[0])) {
    throw new Error(`refused: "${args[0]}" is not a read-only git subcommand`);
  }
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function observeRepository() {
  const gitDir = git(["rev-parse", "--git-dir"]) || ".git";
  return {
    workdir: process.cwd(),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(["rev-parse", "HEAD"]),
    remoteName: "origin",
    remoteUrl: git(["remote", "get-url", "origin"]),
    shallow: existsSync(resolve(gitDir, "shallow")),
    worktreeClean: git(["status", "--porcelain"]).length === 0,
    historyCommitCount: Number.parseInt(git(["rev-list", "--all", "--count"]) || "0", 10),
  };
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const capture = argv.includes("--capture-evidence");
const wantA1 = argv.includes("--a1");
const wantA2 = argv.includes("--a2");
const flag = (name) => {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    process.stderr.write(`REFUSED: ${name} needs a value.\n`);
    process.exit(2);
  }
  return value;
};

if (!wantA1 && !wantA2 && !capture) {
  process.stderr.write("REFUSED: choose --a1, --a2 or --capture-evidence.\n");
  process.exit(2);
}

const policy = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/deployment/remediation-readiness.ts")).href
).catch((error) => {
  process.stderr.write(
    "REFUSED: could not load the remediation policy module. Run with node >= 22.6 and " +
      "--experimental-strip-types (which the npm script sets).\n",
  );
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exit(2);
});

const manifestModule = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/deployment/remediation-manifest.ts")).href
).catch((error) => {
  process.stderr.write("REFUSED: could not load the remediation manifest module.\n");
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exit(2);
});

const postCheckModule = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/deployment/remediation-postcheck.ts")).href
).catch((error) => {
  process.stderr.write("REFUSED: could not load the post-check module.\n");
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exit(2);
});

const { REMEDIATION_MANIFEST } = manifestModule;

/** The recorded exposure inventory. A missing or unreadable artifact is not an empty one. */
function readInventory() {
  const path = resolve(process.cwd(), flag("--inventory") ?? REMEDIATION_MANIFEST.inventory.path);
  const empty = {
    present: false,
    generatedBy: "",
    verifiedAt: null,
    fingerprint: "",
    blobPaths: [],
    historyCommits: 0,
    carrierCommits: 0,
    refs: [],
  };
  if (!existsSync(path)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const verifiedAt = Date.parse(String(parsed.verifiedAt ?? ""));
    return {
      present: true,
      generatedBy: String(parsed.generatedBy ?? ""),
      verifiedAt: Number.isFinite(verifiedAt) ? verifiedAt : null,
      fingerprint: String(parsed.fingerprint ?? ""),
      blobPaths: Array.isArray(parsed.blobPaths) ? parsed.blobPaths.map(String) : [],
      historyCommits: Number(parsed.historyCommits ?? 0),
      carrierCommits: Number(parsed.carrierCommits ?? 0),
      refs: (Array.isArray(parsed.refs) ? parsed.refs : []).map((entry) => ({
        ref: String(entry?.ref ?? ""),
        affected: entry?.affected === true,
        carrierCommits: Number(entry?.carrierCommits ?? 0),
        exposedAtTip: entry?.exposedAtTip === true,
      })),
    };
  } catch {
    return empty;
  }
}

/** Evidence records supplied by the operator, never invented here. */
function readEvidence() {
  const path = flag("--evidence");
  if (path === null) return [];
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) {
    process.stderr.write(`REFUSED: cannot read the evidence file ${path}.\n`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(readFileSync(absolute, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("the evidence file must contain a JSON array");
    return parsed;
  } catch (error) {
    process.stderr.write(`REFUSED: the evidence file is not usable: ${String(error?.message ?? error)}\n`);
    process.exit(2);
  }
}

const repository = observeRepository();
if (!repository.head || !repository.remoteUrl) {
  process.stderr.write("REFUSED: could not read the repository identity (HEAD and origin are required).\n");
  process.exit(2);
}
const inventory = readInventory();
const evidence = readEvidence();
const now = Date.now();

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

function emit(report) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(policy.formatReadinessReport(report));
  process.stdout.write(
    "\nNOTE: readiness is not remediation. This checker performed no revocation, wrote no\n" +
      "      ref, sent no request and deployed nothing. After the external operation, the\n" +
      "      post-checks and the release gate re-evaluation must be run separately.\n",
  );
}

const exitFor = (report) => policy.readinessExitCode(report);

if (capture) {
  const releaseState = await import(
    pathToFileURL(resolve(process.cwd(), "src/lib/deployment/release-current-state.ts")).href
  ).catch(() => null);
  const verdict = releaseState ? releaseState.currentReleaseVerdict().verdict : "UNAVAILABLE";
  const a1 = policy.evaluateA1Readiness({
    repository,
    declared: { issuer: flag("--issuer"), fingerprint: flag("--fingerprint") },
    externalIssuerAccess: flag("--issuer-access") ?? "unknown",
    evidence,
    now,
  });
  const a2 = policy.evaluateA2Readiness({
    repository,
    inventory,
    expectedCandidate: flag("--expect-candidate"),
    evidence,
    now,
  });
  const pkg = postCheckModule.capturePreRemediationEvidence({
    repository,
    inventory,
    releaseVerdict: verdict,
    a1Outcome: a1.outcome,
    a2Outcome: a2.outcome,
    now,
  });
  process.stdout.write(`${JSON.stringify(pkg, null, 2)}\n`);
  process.exit(0);
}

if (wantA1) {
  const report = policy.evaluateA1Readiness({
    repository,
    declared: { issuer: flag("--issuer"), fingerprint: flag("--fingerprint") },
    externalIssuerAccess: flag("--issuer-access") ?? "unknown",
    evidence,
    now,
  });
  emit(report);
  process.exit(exitFor(report));
}

const report = policy.evaluateA2Readiness({
  repository,
  inventory,
  expectedCandidate: flag("--expect-candidate"),
  evidence,
  now,
});
emit(report);
process.exit(exitFor(report));
