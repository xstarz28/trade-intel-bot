#!/usr/bin/env node
/**
 * Phase 245 — A2 full-clone rehearsal driver.
 *
 *   node scripts/a2-rehearsal.mjs --source <url|path> --work-dir <dir> [--manifest fixture.json] [--json] [--keep] [--now <ms>]
 *
 * What this is for: proving the A2 procedure — full clone, identity, exact ref
 * inventory, pre-rewrite evidence, backup, rewrite, post-rewrite scan, per-ref
 * verification, restore — **against a disposable clone**, so that the real
 * remediation is a rehearsed procedure rather than an experiment.
 *
 * What it deliberately cannot do:
 *
 *   * it never pushes: `push`, `fetch`, `remote add/set-url` and every other
 *     remote-mutating verb are refused outright, and a ref-writing verb is only
 *     permitted with the working directory *inside* the disposable work dir;
 *   * it refuses to touch the project checkout: the work dir may not contain it
 *     and the source may not be it;
 *   * it refuses a shallow, grafted or incomplete clone instead of measuring it;
 *   * it never reports A2 as verified: a rehearsal proves the procedure, and the
 *     report always says so.
 *
 * Exit codes: 0 rehearsed clean, 1 refused/failed, 2 could not be evaluated.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { registerHooks } from "node:module";

/* ── module resolution: `@/x` -> src/x, extensionless -> .ts ─────────────── */

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolve(projectRoot, "src", specifier.slice(2));
      return nextResolve(existsSync(`${target}.ts`) ? `${target}.ts` : target, context);
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

const { REMEDIATION_MANIFEST } = await import("../src/lib/deployment/remediation-manifest.ts");
const {
  REHEARSAL_MARKER,
  captureRehearsalEvidence,
  evaluateCloneCompleteness,
  evaluateInvocation,
  evaluateRehearsal,
  evaluateRehearsalIdentity,
  evaluateRehearsalRefInventory,
  formatRehearsalReport,
  planBackup,
  rehearsalExitCode,
  verifyBackup,
  verifyRefBoundary,
  verifyRepositoryIntegrity,
  verifyRestore,
  verifyRewriteOutcome,
} = await import("../src/lib/deployment/a2-rehearsal.ts");

/* ── flags ──────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const source = flag("source");
const repoDir = flag("repo");
const workDir = resolve(flag("work-dir", "/tmp/a2-rehearsal"));
const manifestPath = flag("manifest");
const asJson = has("json");
const keep = has("keep");
const nowMs = Number(flag("now", String(Date.now())));
const BACKUP_NAMESPACE = "refs/p245-backup";
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|env|txt|md|html|yml|yaml|sh|toml)$/i;

if (!source && !repoDir) {
  console.error("usage: node scripts/a2-rehearsal.mjs (--source <url|path> | --repo <dir>) --work-dir <dir> [--manifest fixture.json] [--json]");
  process.exit(2);
}

const manifest = manifestPath ? JSON.parse(readFileSync(resolve(manifestPath), "utf8")) : REMEDIATION_MANIFEST;

/* ── git, with the safety guard ─────────────────────────────────────────── */

/**
 * Ref-writing verbs are permitted only inside the disposable work dir — or inside
 * the disposable repository when one was handed over with `--repo`, which is checked
 * at startup to be outside the project checkout. The decision itself lives in the
 * pure module so it can be tested without spawning anything.
 */
function insideWorkDir(path) {
  const target = resolve(path);
  const inWork = target === workDir || target.startsWith(`${workDir}${sep}`);
  const inRepo = repoDir !== null && (target === resolve(repoDir) || target.startsWith(`${resolve(repoDir)}${sep}`));
  return inWork || inRepo;
}

function gitStatus(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd: options.cwd ?? workDir,
    maxBuffer: 1 << 30,
    input: options.input,
    env: options.env ?? process.env,
  });
  return result;
}

function git(args, options = {}) {
  const verb = args[0];
  const cwd = options.cwd ?? workDir;
  const decision = evaluateInvocation({ verb, args: args.slice(1), cwd, workDir, repoDir });
  if (!decision.allowed) throw new Error(String(decision.reason));
  const result = gitStatus(args, { cwd, input: options.input, env: options.env });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`git ${verb} failed: ${String(result.stderr).trim().split("\n").slice(-1)[0] ?? ""}`);
  }
  return result.stdout;
}

const text = (args, options) => git(args, options).trim();
const maybe = (args, options) => String(git(args, { ...options, allowFailure: true }) ?? "").trim();

function assertProjectCheckoutUntouched() {
  if (workDir === projectRoot || workDir.startsWith(`${projectRoot}${sep}`))
    throw new Error("refused: the work dir is inside the project checkout");
  if (repoDir !== null && (resolve(repoDir) === projectRoot || resolve(repoDir).startsWith(`${projectRoot}${sep}`)))
    throw new Error("refused: --repo is the project checkout itself; a rehearsal runs on a disposable copy");
  if (source && !/^(https?|ssh|git):\/\//.test(source) && resolve(source).startsWith(`${projectRoot}${sep}`))
    throw new Error("refused: the rehearsal source is the project checkout itself");
}

/* ── measurement ────────────────────────────────────────────────────────── */

const fingerprintOf = (candidate) => createHash("sha256").update(`${candidate}\n`).digest("hex").slice(0, 16);

/** Every distinct blob in the object database that carries the fingerprint. */
function leakedBlobs(clone) {
  const found = new Map();
  const seen = new Set();
  for (const line of git(["rev-list", "--objects", "--all"], { cwd: clone }).split("\n")) {
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const oid = line.slice(0, space);
    const path = line.slice(space + 1);
    if (!path || !TEXT_FILE.test(path) || seen.has(oid)) continue;
    seen.add(oid);
    const body = git(["cat-file", "-p", oid], { cwd: clone, allowFailure: true });
    if (typeof body !== "string" || !body) continue;
    for (const match of body.matchAll(/["'`]([^"'`\n]{8,})["'`]/g)) {
      if (fingerprintOf(match[1]) === manifest.credential.fingerprint) {
        found.set(oid, { oid, path, value: match[1] });
        break;
      }
    }
  }
  return found;
}

const refsOf = (clone) =>
  git(["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: clone })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, tip] = line.split(" ");
      return { ref, tip };
    });

const commitsOf = (clone, ref) => git(["rev-list", ref], { cwd: clone }).split("\n").filter(Boolean);

function snapshot(clone, refs, blobOids, path, carriers) {
  return refs.map(({ ref, tip }) => {
    const commits = commitsOf(clone, tip);
    const at = maybe(["rev-parse", `${tip}:${path}`], { cwd: clone });
    return {
      ref,
      tip,
      reachableCommits: commits.length,
      carrierCommits: commits.filter((commit) => carriers.has(commit)).length,
      exposedAtTip: Boolean(at && blobOids.has(at)),
      blobReachable: commits.some((commit) => {
        const seen = maybe(["rev-parse", `${commit}:${path}`], { cwd: clone });
        return Boolean(seen) && blobOids.has(seen);
      }),
      traversable: commits.length > 0,
    };
  });
}

function carriersOf(clone, blobOids, path) {
  const carriers = new Set();
  for (const commit of commitsOf(clone, "--all")) {
    const at = maybe(["rev-parse", `${commit}:${path}`], { cwd: clone });
    if (at && blobOids.has(at)) carriers.add(commit);
  }
  return carriers;
}

function indexEntries(listing) {
  const index = new Map();
  for (const line of listing.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const meta = line.slice(0, tab).split(" ");
    index.set(line.slice(tab + 1), { mode: meta[0], oid: meta[2] });
  }
  return index;
}

/* ── the rehearsal ──────────────────────────────────────────────────────── */

function walkCount(dir) {
  const result = spawnSync("find", [dir, "-type", "f"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean).length : 0;
}

const completedStages = [];
const mark = (stage) => completedStages.push(stage);
const steps = {};

function run() {
  assertProjectCheckoutUntouched();
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  /* 1 ── full clone acquisition, into the disposable work dir only. `--repo` accepts
     an already-acquired disposable repository instead (a copy, never the project). */
  const clone = repoDir ? resolve(repoDir) : resolve(workDir, "rehearsal.git");
  if (!repoDir) git(["clone", "--mirror", "--quiet", source, clone], { cwd: workDir });
  mark("FULL_CLONE_ACQUISITION");

  /* 2 ── repository identity: the source, never the directory name */
  const remoteUrl = maybe(["remote", "get-url", "origin"], { cwd: clone });
  const sourceOf = repoDir ?? source;
  const identity = evaluateRehearsalIdentity(
    { remoteUrl, directoryName: clone.split(sep).pop() ?? "", source: sourceOf, declaredSource: manifest.source ?? null },
    manifest,
  );
  steps.identity = identity;
  mark("REPOSITORY_IDENTITY");
  if (!identity.ok) return { verdict: "identity" };

  /* 3 ── clone completeness: shallow, grafted, incomplete are all refused */
  const gitDir = text(["rev-parse", "--git-dir"], { cwd: clone });
  const absoluteGitDir = gitDir.startsWith("/") ? gitDir : resolve(clone, gitDir);
  const before = refsOf(clone);
  const cloneObservation = {
    workDir: clone,
    bare: true,
    shallow: existsSync(resolve(absoluteGitDir, "shallow")),
    grafted: existsSync(resolve(absoluteGitDir, "info/grafts")),
    reachableCommits: commitsOf(clone, "--all").length,
    requiredObjectsPresent: before.every((entry) => maybe(["cat-file", "-t", entry.tip], { cwd: clone }) !== ""),
    objectDatabaseComplete: gitStatus(["fsck", "--full", "--no-progress"], { cwd: clone }).status === 0,
    refs: [],
    errors: [],
  };
  steps.clone = evaluateCloneCompleteness(cloneObservation);
  if (!steps.clone.ok) return { verdict: "clone" };

  /* 4 ── the affected-ref inventory, exactly the manifest's */
  const scopedRefs = before.filter((entry) => /^refs\/(heads|tags)\//.test(entry.ref));
  const blobs = leakedBlobs(clone);
  if (blobs.size === 0) throw new Error("no fingerprinted blob found: the fixture does not contain the exposure");
  const path = manifest.credential.path;
  const blobOids = new Set(blobs.keys());
  const carriers = carriersOf(clone, blobOids, path);
  const beforeAll = snapshot(clone, before, blobOids, path, carriers);
  const inventory = evaluateRehearsalRefInventory(snapshot(clone, scopedRefs, blobOids, path, carriers), manifest, {
    cloneOk: steps.clone.ok,
  });
  steps.inventory = inventory;
  mark("REF_INVENTORY");
  if (!inventory.ok) return { verdict: "inventory" };

  /* 5 ── pre-rewrite evidence */
  const branch = maybe(["symbolic-ref", "--short", "HEAD"], { cwd: clone });
  const pre = captureRehearsalEvidence({
    phase: "pre",
    capturedAt: nowMs,
    manifest,
    remoteUrl,
    branch,
    candidate: text(["rev-parse", "HEAD"], { cwd: clone }),
    refs: inventory.refs,
    reachableCommits: cloneObservation.reachableCommits,
    cloneState: steps.clone.state,
    worktreeClean: true,
  });
  mark("PRE_REWRITE_EVIDENCE");

  /* 6 ── backup all scoped refs, in the fixture only, then prove the backup */
  const plan = planBackup(inventory.refs, BACKUP_NAMESPACE);
  for (const entry of plan.entries) git(["update-ref", entry.backupRef, entry.sha], { cwd: clone });
  steps.backup = verifyBackup(plan, {
    present: plan.entries.map((entry) => ({
      backupRef: entry.backupRef,
      sha: maybe(["rev-parse", entry.backupRef], { cwd: clone }) || null,
    })),
  });
  mark("BACKUP");
  if (!steps.backup.ok) return { verdict: "backup" };

  /* 7 ── rewrite: only the fingerprinted blobs, only in the scoped refs */
  const replacements = {};
  const replacementOids = [];
  for (const [oid, entry] of blobs) {
    const original = git(["cat-file", "-p", oid], { cwd: clone });
    const rewritten = original.split(entry.value).join(REHEARSAL_MARKER);
    const newOid = text(["hash-object", "-w", "--stdin"], { cwd: clone, input: rewritten });
    if (!replacements[entry.path]) replacements[entry.path] = {};
    replacements[entry.path][oid] = newOid;
    replacementOids.push({ path: entry.path, from: oid.slice(0, 8), to: newOid.slice(0, 8) });
  }
  const mapPath = resolve(workDir, "replacements.json");
  const filterPath = resolve(workDir, "index-filter.py");
  writeFileSync(mapPath, JSON.stringify(replacements));
  writeFileSync(
    filterPath,
    [
      '"""Deterministic index filter: swap only the fingerprinted blobs at their recorded paths."""',
      "import json, os, subprocess, sys",
      "",
      "def sh(*a):",
      "    return subprocess.run(a, capture_output=True, text=True)",
      "",
      'MAP = json.load(open(os.environ["P245_MAP"]))',
      "for path, mapping in MAP.items():",
      '    fields = sh("git", "ls-files", "-s", "--", path).stdout.split()',
      "    if len(fields) >= 2 and fields[1] in mapping:",
      '        done = sh("git", "update-index", "--cacheinfo", "%s,%s,%s" % (fields[0], mapping[fields[1]], path))',
      "        if done.returncode != 0:",
      "            print(done.stderr, file=sys.stderr)",
      "            sys.exit(1)",
      "",
    ].join("\n"),
  );

  const rewriteAt = nowMs;
  const rewrite = spawnSync(
    "git",
    ["filter-branch", "--force", "--index-filter", `python3 ${filterPath}`, "--tag-name-filter", "cat", "--", ...scopedRefs.map((entry) => entry.ref)],
    { cwd: clone, encoding: "utf8", env: { ...process.env, P245_MAP: mapPath, FILTER_BRANCH_SQUELCH_WARNING: "1" }, maxBuffer: 1 << 30 },
  );
  if (rewrite.status !== 0) throw new Error(`the rewrite mechanism failed: ${String(rewrite.stderr).trim().split("\n").slice(-1)[0]}`);
  /* The mechanism's own leftovers: `refs/original/*` holds the pre-rewrite commits
     and would keep the credential reachable, so it is deleted inside the fixture
     (and the reflog with it) — otherwise the scan below proves nothing. */
  for (const entry of refsOf(clone)) {
    if (entry.ref.startsWith("refs/original/")) git(["update-ref", "-d", entry.ref], { cwd: clone });
  }
  git(["reflog", "expire", "--expire=now", "--all"], { cwd: clone });
  const rewrittenRefs = scopedRefs
    .map((entry) => entry.ref)
    .filter((ref) => maybe(["rev-parse", ref], { cwd: clone }) !== inventory.refs.find((entry) => entry.ref === ref)?.tip);
  mark("REWRITE");

  /* 8 ── post-rewrite scan: reachable history, per ref, from the refs as they are now */
  const rewrittenSet = new Set(scopedRefs.map((entry) => entry.ref));
  const afterScoped = snapshot(clone, refsOf(clone).filter((entry) => rewrittenSet.has(entry.ref)), blobOids, path, carriers);
  const post = captureRehearsalEvidence({
    phase: "post",
    capturedAt: rewriteAt + 1,
    manifest,
    remoteUrl,
    branch,
    candidate: maybe(["rev-parse", scopedRefs[0].ref], { cwd: clone }),
    refs: afterScoped,
    reachableCommits: commitsOf(clone, "--all").length,
    cloneState: steps.clone.state,
    worktreeClean: true,
    rewriteAt,
  });
  steps.rewrite = verifyRewriteOutcome({
    after: afterScoped.map((entry) => ({
      ref: entry.ref,
      tip: entry.tip,
      exists: entry.tip !== null,
      fingerprintAtTip: entry.exposedAtTip,
      fingerprintReachable: entry.blobReachable,
      carrierCommits: entry.carrierCommits,
      traversable: entry.traversable,
    })),
    approvedRefs: scopedRefs.map((entry) => entry.ref),
    rewrite: { rewrittenRefs, rewriteAt },
    evidence: post,
  });
  mark("POST_REWRITE_SCAN");
  mark("PER_REF_VERIFICATION");

  /* 9 ── boundary: every ref in the fixture, before and after */
  const after = refsOf(clone);
  const notBackup = (entry) => !entry.ref.startsWith(`${BACKUP_NAMESPACE}/`);
  const backupRefsSeen = after.filter((entry) => !notBackup(entry)).map((entry) => entry.ref);
  steps.boundary = verifyRefBoundary({
    before: beforeAll.filter(notBackup),
    after: snapshot(clone, after.filter(notBackup), blobOids, path, carriers),
    approvedRefs: scopedRefs.map((entry) => entry.ref),
  });
  steps.backupObservedRefs = backupRefsSeen;

  /* 10 ── integrity: materialize the tree, compare the content that must not move */
  const targetRef = scopedRefs[0].ref;
  const newTip = text(["rev-parse", targetRef], { cwd: clone });
  const oldTip = pre.refs.find((entry) => entry.ref === targetRef)?.tip ?? "";
  const checkoutDir = resolve(workDir, "checkout");
  const worktree = spawnSync("git", ["worktree", "add", "--detach", checkoutDir, newTip], { cwd: clone, encoding: "utf8" });
  const checkoutSucceeded = worktree.status === 0;
  const checkoutFiles = checkoutSucceeded ? walkCount(checkoutDir) : 0;
  const oldTree = indexEntries(maybe(["ls-tree", "-r", oldTip], { cwd: clone }));
  const newTree = indexEntries(maybe(["ls-tree", "-r", newTip], { cwd: clone }));
  const mismatched = [...oldTree.entries()]
    .filter(([file, entry]) => file !== path && (!newTree.has(file) || newTree.get(file).oid !== entry.oid || newTree.get(file).mode !== entry.mode))
    .map(([file]) => file);
  const removed = [...oldTree.keys()].filter((file) => file !== path && !newTree.has(file));
  const replacementsAtPath = Object.values(replacements[path] ?? {});
  const markerApplied = commitsOf(clone, newTip).some((commit) =>
    replacementsAtPath.includes(maybe(["rev-parse", `${commit}:${path}`], { cwd: clone })),
  );
  steps.integrity = verifyRepositoryIntegrity({
    checkoutSucceeded,
    worktreeFiles: checkoutFiles,
    preservedPaths:
      mismatched.length > 0 || removed.length > 0
        ? [...mismatched, ...removed].map((file) => ({ path: file, same: false }))
        : [{ path: `${oldTree.size - 1} untouched paths (sampled)`, same: true }],
    targetPath: { path, present: newTree.has(path), rewritten: markerApplied },
    fsckClean: gitStatus(["fsck", "--full", "--no-progress"], { cwd: clone }).status === 0,
    refsPresent: refsOf(clone).map((entry) => entry.ref),
    expectedRefs: before.map((entry) => entry.ref),
  });
  mark("INTEGRITY_CHECK");

  /* the checkout was a proof, not a resident: it holds a detached HEAD, and a
     reachable HEAD would keep the rewritten commits alive through the restore */
  if (checkoutSucceeded) {
    const removed = spawnSync("git", ["worktree", "remove", checkoutDir], { cwd: clone, encoding: "utf8" });
    if (removed.status !== 0) {
      rmSync(checkoutDir, { recursive: true, force: true });
      git(["worktree", "prune"], { cwd: clone });
    }
  }

  /* 11 ── restore from the backup, prove it, then drop the fixture */
  for (const entry of plan.entries) git(["update-ref", entry.ref, entry.sha], { cwd: clone });
  for (const entry of plan.entries) git(["update-ref", "-d", entry.backupRef], { cwd: clone });
  const restoredRefs = refsOf(clone);
  const beforeNames = new Set(before.map((entry) => entry.ref));
  steps.restore = verifyRestore(
    beforeAll,
    {
      tips: restoredRefs.map((entry) => ({ ref: entry.ref, sha: entry.tip })),
      reachableCommits: commitsOf(clone, "--all").length,
      refCount: restoredRefs.length,
      unexpectedRefs: restoredRefs.map((entry) => entry.ref).filter((ref) => !beforeNames.has(ref)),
    },
    { refs: beforeAll.length, reachableCommits: cloneObservation.reachableCommits },
  );
  mark("RESTORE_PROOF");

  const fixture = {
    cloneReachableCommits: cloneObservation.reachableCommits,
    refsTotal: before.length,
    refsScoped: scopedRefs.length,
    carriers: carriers.size,
    replacementOids,
    markers: REHEARSAL_MARKER,
    backupNamespace: BACKUP_NAMESPACE,
    backupRefsCreated: plan.entries.length,
    rewrittenRefs,
    rewrittenTips: rewrittenSet.size > 0 ? [...rewrittenSet].map((ref) => ({ ref, tip: maybe(["rev-parse", ref], { cwd: clone }) })) : [],
    untouchedPaths: oldTree.size - 1,
    markerApplied,
    backupRefsSeen,
    checkoutFiles,
  };
  return { pre, post, fixture };
}

/* ── run ────────────────────────────────────────────────────────────────── */

let outcome;
try {
  outcome = run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!keep) rmSync(workDir, { recursive: true, force: true });
  const fatal = { mode: "REHEARSAL", verdict: "REHEARSAL_FAILED", fatal: message, realRemoteTouched: false, remediationPerformed: false, a2Verified: false, stages: completedStages };
  console.error(asJson ? JSON.stringify(fatal, null, 2) : `fatal: ${message}\nrealRemoteTouched: no\na2Verified: no`);
  process.exit(2);
}

const report = evaluateRehearsal({
  clone: steps.clone,
  identity:
    steps.identity ??
    evaluateRehearsalIdentity(
      { remoteUrl: source ?? "", directoryName: "", source: repoDir ?? source ?? "", declaredSource: manifest.source ?? null },
      manifest,
    ),
  inventory: steps.inventory ?? { state: "UNKNOWN_INVENTORY", ok: false, missingRefs: [], unexpectedRefs: [], affectedRefs: [], refs: [], problems: ["not reached"] },
  backup: steps.backup ?? null,
  rewrite: steps.rewrite ?? null,
  boundary: steps.boundary ?? null,
  integrity: steps.integrity ?? null,
  restore: steps.restore ?? null,
  evidence: outcome.pre && outcome.post ? { preDigest: outcome.pre.digest, postDigest: outcome.post.digest } : null,
  completedStages,
});
if (!keep) rmSync(workDir, { recursive: true, force: true });

if (asJson) console.log(JSON.stringify({ ...report, fixture: outcome.fixture ?? null }, null, 2));
else {
  console.log(formatRehearsalReport(report));
  if (outcome.fixture) console.log(`fixture: ${JSON.stringify(outcome.fixture)}`);
}
process.exit(rehearsalExitCode(report));
