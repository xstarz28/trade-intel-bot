/**
 * Phase 245 — A2 full-clone rehearsal and history-rewrite proof.
 *
 * This module is the *decision* half of the rehearsal: it is pure, takes injected
 * observations, and never touches a repository, a network or a clock. The driver
 * (`scripts/a2-rehearsal.mjs`) does the I/O against a **disposable** clone that it
 * creates under a work directory, and feeds the observations here.
 *
 * Two things this module deliberately cannot do:
 *
 *   * it cannot conclude that A2 is remediated — a rehearsal proves the procedure,
 *     not the remediation, so every report carries `a2Verified: false` and
 *     `realRemoteTouched: false`;
 *   * it cannot be satisfied by evidence captured before the rewrite — the post
 *     phase rejects any package whose phase is not `post` or whose capture instant
 *     is not strictly after the recorded rewrite instant.
 *
 * The 8-ref scope is never restated here: it is read from the canonical Phase 244
 * manifest, so a second, drifting list cannot exist.
 */
import { sameRepository, type RemediationManifest } from "./remediation-manifest";

/* ── the invocation guard: a rehearsal reads, and never mutates a remote ─── */

/** Verbs that only read a repository. */
export const READ_ONLY_VERBS = [
  "rev-parse", "rev-list", "for-each-ref", "ls-tree", "cat-file", "count-objects",
  "fsck", "log", "show", "status", "remote", "symbolic-ref", "var", "worktree", "ls-remote", "clone",
] as const;

/** Verbs that write refs or objects — fenced to the disposable directories. */
export const REF_WRITING_VERBS = ["update-ref", "reflog", "filter-branch", "hash-object"] as const;

/** Verbs that can mutate a remote repository. Never permitted, in any mode. */
export const REMOTE_MUTATING_VERBS = ["push", "fetch", "pull", "send-pack", "submodule", "gc", "prune", "repack"] as const;

export interface InvocationObservation {
  /** The git subcommand, e.g. `rev-parse` or `filter-branch`. */
  verb: string;
  /** Everything after the subcommand — the verb is never repeated here. */
  args: readonly string[];
  /** Where the command would run. */
  cwd: string;
  /** The disposable work dir; nothing may be written outside it. */
  workDir: string;
  /** The disposable repository handed over with `--repo`, if any. */
  repoDir?: string | null;
}

export interface InvocationDecision {
  allowed: boolean;
  reason: string | null;
}

const normalisePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

function containsPath(parent: string, child: string): boolean {
  const outer = normalisePath(parent);
  const inner = normalisePath(child);
  return inner === outer || inner.startsWith(`${outer}/`);
}

/**
 * The one gate every git invocation passes through. It is deliberately a pure
 * decision so the discipline can be tested without spawning anything: a remote
 * mutation is refused outright, an unknown verb is refused, the remote
 * configuration is read-only, HEAD is never repointed, ref writes stay inside the
 * disposable directories, and `--force` is permitted only for the local rewrite.
 */
export function evaluateInvocation(observation: InvocationObservation): InvocationDecision {
  const { verb, args } = observation;
  const refuse = (reason: string): InvocationDecision => ({ allowed: false, reason: `refused: ${reason}` });

  if ((REMOTE_MUTATING_VERBS as readonly string[]).includes(verb))
    return refuse(`"${verb}" can mutate a remote and this tool never does`);
  const known = (READ_ONLY_VERBS as readonly string[]).includes(verb) || (REF_WRITING_VERBS as readonly string[]).includes(verb);
  if (!known) return refuse(`"${verb}" is not in the allowlist`);
  if (verb === "remote" && args[0] !== "get-url") return refuse("the remote is read, never reconfigured");
  // `symbolic-ref --short HEAD` is a read; `symbolic-ref HEAD <target>` repoints HEAD
  if (verb === "symbolic-ref" && args.some((argument) => argument === "-m" || argument === "--delete"))
    return refuse("HEAD is read, never repointed with a message and never deleted");
  const repointsHead = verb === "symbolic-ref" && args.filter((argument) => !argument.startsWith("-")).length > 1;
  if ((REF_WRITING_VERBS as readonly string[]).includes(verb) || repointsHead) {
    const inside = containsPath(observation.workDir, observation.cwd) ||
      (observation.repoDir ? containsPath(observation.repoDir, observation.cwd) : false);
    if (!inside) return refuse(`"${verb}" would write outside the disposable work dir (${observation.cwd})`);
  }
  if (verb !== "filter-branch" && args.some((argument) => argument === "--force" || argument === "-f"))
    return refuse("--force is not permitted here");
  return { allowed: true, reason: null };
}

/**
 * The manifest records Git's short ref names (`heads/main`, `tags/rc-181`) because
 * that is what `git ls-remote --heads --tags` prints; a repository reports full
 * names (`refs/heads/main`). This is the single join between them — it adds the
 * prefix and nothing else, so it can never invent a ref.
 */
export function canonicalRefName(ref: string): string {
  const trimmed = ref.trim();
  return trimmed.startsWith("refs/") ? trimmed : `refs/${trimmed}`;
}

/** The synthetic replacement the rehearsal writes into the disposable clone only. */
export const REHEARSAL_MARKER = "REDACTED-BY-A2-REHEARSAL";

/** The ten steps an operator performs, in order, for the real remediation too. */
export const REHEARSAL_STAGES = [
  "FULL_CLONE_ACQUISITION",
  "REPOSITORY_IDENTITY",
  "REF_INVENTORY",
  "PRE_REWRITE_EVIDENCE",
  "BACKUP",
  "EXPLICIT_OPERATOR_APPROVAL",
  "REWRITE",
  "POST_REWRITE_SCAN",
  "PER_REF_VERIFICATION",
  "RELEASE_GATE_REEVALUATION",
] as const;

export type RehearsalStage = (typeof REHEARSAL_STAGES)[number];

/**
 * The ten steps a *rehearsal run* completes. They map onto the operator sequence
 * above, with two differences that must not be blurred: the rehearsal performs the
 * integrity check and the restore drill itself, while `EXPLICIT_OPERATOR_APPROVAL`
 * and `RELEASE_GATE_REEVALUATION` belong to the real remediation and cannot be
 * rehearsed end to end.
 */
export const REHEARSAL_EXECUTION_STAGES = [
  "FULL_CLONE_ACQUISITION",
  "REPOSITORY_IDENTITY",
  "REF_INVENTORY",
  "PRE_REWRITE_EVIDENCE",
  "BACKUP",
  "REWRITE",
  "POST_REWRITE_SCAN",
  "PER_REF_VERIFICATION",
  "INTEGRITY_CHECK",
  "RESTORE_PROOF",
] as const;

export type RehearsalExecutionStage = (typeof REHEARSAL_EXECUTION_STAGES)[number];

/** Every stage name the tool may log — the operator sequence and the rehearsal run. */
export type RehearsalStageName = RehearsalStage | RehearsalExecutionStage;

/** `EXPLICIT_OPERATOR_APPROVAL` is the only step no tool may perform on its own. */
export const EXTERNAL_REHEARSAL_STAGES: readonly RehearsalStage[] = ["EXPLICIT_OPERATOR_APPROVAL"];

export type CloneState =
  | "FULL_CLONE_OK"
  | "SHALLOW_CLONE"
  | "GRAFTED_CLONE"
  | "INCOMPLETE_OBJECT_DATABASE"
  | "UNKNOWN_CLONE";

/** One ref as the fixture actually shows it. `tip: null` means it is gone. */
export interface RefSnapshot {
  ref: string;
  tip: string | null;
  reachableCommits: number;
  /** Commits reachable from this ref whose tree holds the leaked blob at its path. */
  carrierCommits: number;
  /** The leaked blob is in this ref's tip tree. */
  exposedAtTip: boolean;
  /** The leaked blob is reachable from this ref at all. */
  blobReachable: boolean;
  /** The ref's history traverses without error. */
  traversable: boolean;
}

export interface CloneObservation {
  workDir: string;
  bare: boolean;
  shallow: boolean;
  grafted: boolean;
  reachableCommits: number;
  /** `git cat-file -t` resolved every commit an inventory ref points at. */
  requiredObjectsPresent: boolean;
  /** The object database can be traversed end to end (`git fsck`). */
  objectDatabaseComplete: boolean;
  refs: readonly RefSnapshot[];
  errors: readonly string[];
}

export interface IdentityObservation {
  remoteUrl: string;
  /** Recorded so the report can show that the name was *not* used. */
  directoryName: string;
  /** Where the fixture was actually acquired from: a URL or a local path. */
  source: string;
  /**
   * The place the manifest says that source must be. Only consulted for a local
   * path, which has no host to normalize; a URL is always compared as an identity.
   */
  declaredSource: string | null;
}

/** A URL, or the `git@host:owner/repo` shorthand an operator clones with. */
const URL_LIKE = /^(?:https?|ssh|git):\/\//;
const SCP_LIKE = /^[^@/:]+@[^/:]+:/;

export interface CloneCompleteness {
  state: CloneState;
  ok: boolean;
  problems: readonly string[];
}

/**
 * Phase A. A shallow, grafted or incomplete object database is refused: it cannot
 * measure the affected history, and a rewrite scoped from it would leave carriers
 * behind — the Phase 181 "9 commits instead of 270" failure, made impossible.
 */
export function evaluateCloneCompleteness(observation: CloneObservation): CloneCompleteness {
  const problems: string[] = [];
  if (observation.shallow) problems.push("clone is shallow: .git/shallow exists, so the history is truncated");
  if (observation.grafted) problems.push("clone is grafted: .git/info/grafts exists, so parents are rewritten locally");
  if (observation.reachableCommits <= 1)
    problems.push(`only ${observation.reachableCommits} reachable commit(s): the object database is not the repository`);
  if (!observation.requiredObjectsPresent)
    problems.push("a ref tip object could not be resolved: the object database is incomplete");
  if (!observation.objectDatabaseComplete)
    problems.push("the object database did not traverse end to end (git fsck reported damage)");
  for (const error of observation.errors) problems.push(`measurement failed: ${error}`);

  if (observation.shallow) return { state: "SHALLOW_CLONE", ok: false, problems };
  if (observation.grafted) return { state: "GRAFTED_CLONE", ok: false, problems };
  if (observation.errors.length > 0) return { state: "UNKNOWN_CLONE", ok: false, problems };
  if (problems.length > 0) return { state: "INCOMPLETE_OBJECT_DATABASE", ok: false, problems };
  return { state: "FULL_CLONE_OK", ok: true, problems };
}

export type IdentityState = "IDENTITY_OK" | "WRONG_REPOSITORY" | "AMBIGUOUS_REMOTE";

export interface IdentityVerdict {
  state: IdentityState;
  ok: boolean;
  /** The normalized identity that was compared, or null when unparsable. */
  measured: string | null;
  expected: string | null;
  problems: readonly string[];
}

/**
 * Phase B. Identity is the *normalized remote*: host + owner/repo, as Phase 244
 * defines it. The local directory name is recorded and never used — a fixture
 * called `trade-intel-bot` is not this repository, and a fixture called `scratch`
 * cloned from the canonical URL is.
 */
export function evaluateRehearsalIdentity(
  observation: IdentityObservation,
  manifest: RemediationManifest,
): IdentityVerdict {
  const problems: string[] = [];
  const expected = manifest.repository.canonical;
  const trimmedSource = observation.source.trim();
  const fromUrl = URL_LIKE.test(trimmedSource) || SCP_LIKE.test(trimmedSource);
  const measured = fromUrl
    ? observation.remoteUrl.trim()
    : observation.source.trim().length > 0
      ? `local:${resolveLike(observation.source)}`
      : "";
  const wanted = fromUrl ? manifest.repository.remoteUrl : (observation.declaredSource ?? "");
  const matches = fromUrl
    ? sameRepository(observation.remoteUrl, manifest.repository.remoteUrl)
    : wanted.length > 0 && resolveLike(observation.source) === resolveLike(wanted);

  if (fromUrl && !matches) {
    problems.push(`remote identity mismatch: the fixture's remote is not ${expected} (the directory name is not identity and was not used)`);
  }
  if (!fromUrl && wanted.length === 0) {
    problems.push("the source is a local path and the manifest declares no fixture source, so the identity cannot be established");
  }
  if (!fromUrl && wanted.length > 0 && !matches) {
    problems.push(`fixture identity mismatch: the source is not the fixture the manifest declares (the directory name was not used)`);
  }
  if (matches && !fromUrl) {
    problems.push(`identity established by the declared fixture source, not by the directory name (${observation.directoryName || "unnamed"})`);
  }
  return {
    state: matches ? "IDENTITY_OK" : !fromUrl && wanted.length === 0 ? "AMBIGUOUS_REMOTE" : "WRONG_REPOSITORY",
    ok: matches,
    measured: measured.length > 0 ? measured : null,
    expected: fromUrl ? expected : observation.declaredSource,
    problems: matches ? [] : problems,
  };
}

/** Path normalization without importing node:path (this module stays platform-free). */
function resolveLike(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

export type InventoryState =
  | "INVENTORY_EXACT"
  | "MISSING_REF"
  | "UNEXPECTED_REF"
  | "EMPTY_INVENTORY"
  | "UNKNOWN_INVENTORY"
  | "CLONE_REJECTED";

export interface InventoryVerdict {
  state: InventoryState;
  ok: boolean;
  /** Manifest refs with no measurement, sorted. */
  missingRefs: readonly string[];
  /** Measured refs the manifest does not scope, sorted. */
  unexpectedRefs: readonly string[];
  /** Measured refs that carry the exposure, sorted. */
  affectedRefs: readonly string[];
  refs: readonly RefSnapshot[];
  problems: readonly string[];
}

/**
 * Phase C. Exact equality with the manifest, in both directions: a ref that
 * disappeared silently and a ref nobody approved are both failures. An empty
 * measurement is never "nothing to rewrite", and a measurement taken from a clone
 * that failed Phase A is refused rather than trusted.
 */
export function evaluateRehearsalRefInventory(
  measured: readonly RefSnapshot[],
  manifest: RemediationManifest,
  options: { cloneOk: boolean },
): InventoryVerdict {
  const sorted = [...measured].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const expected = manifest.affectedRefs.map((entry) => canonicalRefName(entry.ref)).sort();
  const seen = new Set(sorted.map((entry) => entry.ref));
  const missingRefs = expected.filter((ref) => !seen.has(ref));
  const unexpectedRefs = sorted.map((entry) => entry.ref).filter((ref) => !expected.includes(ref));
  const affectedRefs = sorted.filter((entry) => entry.carrierCommits > 0).map((entry) => entry.ref);
  const problems: string[] = [];

  if (!options.cloneOk) {
    problems.push("the clone could not be measured, so no inventory can be authoritative here");
    return { state: "CLONE_REJECTED", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  if (sorted.length === 0) {
    problems.push("the measurement is empty: an empty ref set is not 'nothing to rewrite'");
    return { state: "EMPTY_INVENTORY", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  const unmeasured = sorted.filter((entry) => entry.tip === null || !entry.traversable);
  if (unmeasured.length > 0) {
    problems.push(`unmeasurable ref(s): ${unmeasured.map((entry) => entry.ref).join(", ")}`);
    return { state: "UNKNOWN_INVENTORY", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  // a positive control on the measurement itself: a ref that carries commits
  // containing the exposure must also report the exposed object as reachable
  const inconsistent = sorted.filter((entry) => entry.carrierCommits > 0 && !entry.blobReachable);
  if (inconsistent.length > 0) {
    problems.push(
      `the measurement contradicts itself for ${inconsistent.map((entry) => entry.ref).join(", ")}: ` +
        "carrier commits exist but the exposed object is reported as unreachable",
    );
    return { state: "UNKNOWN_INVENTORY", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  if (missingRefs.length > 0) {
    problems.push(`ref(s) in the manifest but not in the fixture: ${missingRefs.join(", ")}`);
    return { state: "MISSING_REF", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  if (unexpectedRefs.length > 0) {
    problems.push(`ref(s) nobody approved rewriting: ${unexpectedRefs.join(", ")}`);
    return { state: "UNEXPECTED_REF", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  if (affectedRefs.length !== expected.length) {
    problems.push(
      `only ${affectedRefs.length} of ${expected.length} scoped refs carry the exposure: the inventory contradicts the manifest`,
    );
    return { state: "UNKNOWN_INVENTORY", ok: false, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
  }
  return { state: "INVENTORY_EXACT", ok: true, missingRefs, unexpectedRefs, affectedRefs, refs: sorted, problems };
}

/* ── evidence ───────────────────────────────────────────────────────────── */

export type EvidencePhase = "pre" | "post";

export interface RehearsalEvidencePackage {
  phase: EvidencePhase;
  capturedAt: number;
  repository: string;
  remoteUrl: string;
  branch: string;
  candidate: string;
  fingerprint: string;
  blobPath: string;
  blobOid: string;
  refs: readonly { ref: string; tip: string; carrierCommits: number; exposedAtTip: boolean }[];
  carrierCommits: number;
  computedCarriers: number;
  reachableCommits: number;
  clonState: CloneState;
  worktreeClean: boolean;
  /** The synthetic rewrite instant, present only on the post package. */
  rewriteAt?: number;
  digest: string;
}

/** Deterministic, dependency-free digest over the package's own content. */
export function evidenceDigest(payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Phase D/J. A package describes the fixture; it never contains the secret (only
 * the fingerprint), and the digest makes a before/after comparison exact.
 */
export function captureRehearsalEvidence(input: {
  phase: EvidencePhase;
  capturedAt: number;
  manifest: RemediationManifest;
  remoteUrl: string;
  branch: string;
  candidate: string;
  refs: readonly RefSnapshot[];
  reachableCommits: number;
  cloneState: CloneState;
  worktreeClean: boolean;
  rewriteAt?: number;
}): RehearsalEvidencePackage {
  const refs = [...input.refs]
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .map((entry) => ({
      ref: entry.ref,
      tip: entry.tip ?? "",
      carrierCommits: entry.carrierCommits,
      exposedAtTip: entry.exposedAtTip,
    }));
  const payload = {
    phase: input.phase,
    capturedAt: input.capturedAt,
    repository: input.manifest.repository.canonical,
    remoteUrl: input.remoteUrl,
    branch: input.branch,
    candidate: input.candidate,
    fingerprint: input.manifest.credential.fingerprint,
    blobPath: input.manifest.credential.path,
    blobOid: input.manifest.credential.blob,
    refs,
    carrierCommits: input.manifest.credential.carrierCommits,
    computedCarriers: input.refs.reduce((max, entry) => Math.max(max, entry.carrierCommits), 0),
    reachableCommits: input.reachableCommits,
    clonState: input.cloneState,
    worktreeClean: input.worktreeClean,
    ...(input.phase === "post" && typeof input.rewriteAt === "number" ? { rewriteAt: input.rewriteAt } : {}),
  };
  return { ...payload, digest: evidenceDigest(payload) };
}

export type EvidenceState = "EVIDENCE_ACCEPTED" | "WRONG_PHASE" | "STALE_INSTANT" | "DIGEST_MISMATCH" | "NO_DIGEST";

/**
 * The post-rewrite proof may only be satisfied by a post-rewrite package captured
 * strictly after the rewrite — a pre-rewrite package can never be promoted, which
 * is the failure mode "we verified it" where nothing was verified.
 */
export function evaluatePostRewriteEvidence(
  package_: RehearsalEvidencePackage,
  rewriteAt: number,
): { state: EvidenceState; ok: boolean; problems: readonly string[] } {
  const problems: string[] = [];
  if (package_.phase !== "post") problems.push("the package describes the pre-rewrite state; it cannot prove the rewrite");
  if (!(package_.capturedAt > rewriteAt)) problems.push("the package was captured at or before the rewrite instant");
  const { digest, ...payload } = package_;
  if (!digest) problems.push("the package carries no digest");
  else if (evidenceDigest(payload) !== digest) problems.push("the package digest does not match its content");
  const ok = problems.length === 0;
  return {
    state: ok ? "EVIDENCE_ACCEPTED" : package_.phase !== "post" ? "WRONG_PHASE" : !digest ? "NO_DIGEST" : evidenceDigest(payload) !== digest ? "DIGEST_MISMATCH" : "STALE_INSTANT",
    ok,
    problems,
  };
}

/* ── backup and restore ─────────────────────────────────────────────────── */

export interface BackupEntry {
  ref: string;
  backupRef: string;
  sha: string;
}

export interface BackupPlan {
  entries: readonly BackupEntry[];
  digest: string;
  immutable: true;
}

export interface BackupObservation {
  present: readonly { backupRef: string; sha: string | null }[];
}

export type BackupState = "BACKUP_COMPLETE" | "BACKUP_MISSING_REF" | "BACKUP_SHA_MISMATCH" | "BACKUP_EMPTY";

/** Phase E. One local backup ref per scoped ref, each pointing at the original tip. */
export function planBackup(refs: readonly RefSnapshot[], namespace: string): BackupPlan {
  const entries = [...refs]
    .filter((entry) => entry.tip !== null)
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .map((entry) => ({ ref: entry.ref, backupRef: `${namespace}/${canonicalRefName(entry.ref)}`, sha: entry.tip as string }));
  return { entries, digest: evidenceDigest(entries), immutable: true };
}

export function verifyBackup(plan: BackupPlan, observation: BackupObservation): { state: BackupState; ok: boolean; problems: readonly string[] } {
  const problems: string[] = [];
  if (plan.entries.length === 0) return { state: "BACKUP_EMPTY", ok: false, problems: ["the backup plan is empty"] };
  const seen = new Map(observation.present.map((entry) => [entry.backupRef, entry.sha]));
  for (const entry of plan.entries) {
    if (!seen.has(entry.backupRef)) {
      problems.push(`no backup for ${entry.ref}`);
      continue;
    }
    const sha = seen.get(entry.backupRef);
    if (sha !== entry.sha) problems.push(`backup for ${entry.ref} points at ${sha ?? "nothing"}, not the original tip`);
  }
  const state: BackupState = problems.length === 0 ? "BACKUP_COMPLETE" : problems.some((p) => p.startsWith("no backup")) ? "BACKUP_MISSING_REF" : "BACKUP_SHA_MISMATCH";
  return { state, ok: problems.length === 0, problems };
}

export interface RestoreObservation {
  /** Every ref in the fixture after the restore, not only the scoped ones. */
  tips: readonly { ref: string; sha: string | null }[];
  reachableCommits: number;
  refCount: number;
  /** Refs that exist after the restore and did not exist before the rewrite. */
  unexpectedRefs: readonly string[];
}

export type RestoreState = "RESTORE_EXACT" | "RESTORE_REF_MISMATCH" | "RESTORE_DIGEST_MISMATCH" | "RESTORE_EXTRA_REF";

/**
 * Phase J. Restoration must be *proved*: every tip back to its pre-rewrite value,
 * the same number of refs, and the same reachable-commit count — a restored ref
 * pointing somewhere else is a failed recovery, not a nuance.
 */
export function verifyRestore(
  before: readonly RefSnapshot[],
  observation: RestoreObservation,
  expected: { refs: number; reachableCommits: number },
): { state: RestoreState; ok: boolean; problems: readonly string[] } {
  const problems: string[] = [];
  const wanted = new Map(before.filter((entry) => entry.tip !== null).map((entry) => [entry.ref, entry.tip as string]));
  const actual = new Map(observation.tips.map((entry) => [entry.ref, entry.sha]));
  for (const [ref, sha] of wanted) {
    if (!actual.has(ref)) problems.push(`${ref} did not come back`);
    else if (actual.get(ref) !== sha) problems.push(`${ref} came back at a different commit`);
  }
  const extra = observation.tips.map((entry) => entry.ref).filter((ref) => !wanted.has(ref));
  if (extra.length > 0 || observation.unexpectedRefs.length > 0 || observation.tips.length > expected.refs) {
    problems.push(`refs remain that were not there before the rewrite: ${[...extra, ...observation.unexpectedRefs].join(", ") || `${observation.tips.length} refs`}`);
    return { state: "RESTORE_EXTRA_REF", ok: false, problems };
  }
  if (problems.length > 0) return { state: "RESTORE_REF_MISMATCH", ok: false, problems };
  if (observation.reachableCommits !== expected.reachableCommits) {
    problems.push(
      `the restored fixture reaches ${observation.reachableCommits} commits, not the ${expected.reachableCommits} it reached before the rewrite`,
    );
    return { state: "RESTORE_DIGEST_MISMATCH", ok: false, problems };
  }
  return { state: "RESTORE_EXACT", ok: true, problems };
}

/* ── rewrite and post-rewrite verification ──────────────────────────────── */

export interface RewriteObservation {
  /** Refs the mechanism reported it rewrote, and only those. */
  rewrittenRefs: readonly string[];
  /** The synthetic instant the rewrite is recorded at. */
  rewriteAt: number;
}

export interface RefVerification {
  ref: string;
  tip: string | null;
  exists: boolean;
  fingerprintAtTip: boolean;
  fingerprintReachable: boolean;
  carrierCommits: number;
  traversable: boolean;
}

export type RewriteState =
  | "REWRITE_VERIFIED"
  | "REF_MISSING_AFTER_REWRITE"
  | "TIP_ONLY_CLEAN"
  | "FINGERPRINT_STILL_REACHABLE"
  | "CARRIER_REMAINS"
  | "HISTORY_NOT_TRAVERSABLE"
  | "UNAPPROVED_REF_REWRITTEN";

/**
 * Phase H. Per ref: the ref must still exist, the fingerprint must be absent from
 * *reachable history* (not merely from the tip), no carrier may remain, and the
 * resulting history must traverse. A ref that disappeared is a failure, never a
 * silent success.
 */
export function verifyRewriteOutcome(input: {
  after: readonly RefVerification[];
  approvedRefs: readonly string[];
  rewrite: RewriteObservation;
  evidence: RehearsalEvidencePackage;
}): { state: RewriteState; ok: boolean; verifiedRefs: readonly string[]; problems: readonly string[] } {
  const problems: string[] = [];
  const approved = new Set(input.approvedRefs);
  const unapproved = input.rewrite.rewrittenRefs.filter((ref) => !approved.has(ref));
  if (unapproved.length > 0) {
    problems.push(`the mechanism rewrote ref(s) outside the approved scope: ${unapproved.join(", ")}`);
    return { state: "UNAPPROVED_REF_REWRITTEN", ok: false, verifiedRefs: [], problems };
  }

  const evidenceVerdict = evaluatePostRewriteEvidence(input.evidence, input.rewrite.rewriteAt);
  if (!evidenceVerdict.ok) problems.push(...evidenceVerdict.problems);

  const verifiedRefs: string[] = [];
  const missing = input.after.filter((entry) => !entry.exists || entry.tip === null).map((entry) => entry.ref);
  if (missing.length > 0) {
    problems.push(`ref(s) missing after the rewrite: ${missing.join(", ")}`);
    return { state: "REF_MISSING_AFTER_REWRITE", ok: false, verifiedRefs, problems };
  }
  const traversable = input.after.filter((entry) => !entry.traversable).map((entry) => entry.ref);
  if (traversable.length > 0) {
    problems.push(`history does not traverse for: ${traversable.join(", ")}`);
    return { state: "HISTORY_NOT_TRAVERSABLE", ok: false, verifiedRefs, problems };
  }
  const reachable = input.after.filter((entry) => entry.fingerprintReachable || entry.carrierCommits > 0);
  if (reachable.length > 0) {
    const tipOnly = reachable.every((entry) => !entry.fingerprintAtTip);
    problems.push(
      `the fingerprint or a rewritten copy of it is still reachable from: ${reachable.map((entry) => entry.ref).join(", ")}` +
        (tipOnly ? " (the tip looks clean, which is exactly why the tip alone is not the proof)" : ""),
    );
    for (const entry of reachable) {
      if (entry.carrierCommits > 0) problems.push(`${entry.ref} still has ${entry.carrierCommits} carrier commit(s)`);
    }
    return { state: tipOnly ? "TIP_ONLY_CLEAN" : "FINGERPRINT_STILL_REACHABLE", ok: false, verifiedRefs, problems };
  }
  for (const entry of input.after) verifiedRefs.push(entry.ref);
  return {
    state: problems.length === 0 ? "REWRITE_VERIFIED" : "FINGERPRINT_STILL_REACHABLE",
    ok: problems.length === 0,
    verifiedRefs: problems.length === 0 ? verifiedRefs : [],
    problems,
  };
}

export type BoundaryState = "BOUNDARY_OK" | "UNAPPROVED_REF_CHANGED" | "REF_DISAPPEARED" | "UNEXPECTED_NEW_REF";

/**
 * Phase G. Every ref in the fixture is snapshotted before and after; only the
 * approved scope may move. This is what catches a rewrite that quietly moved
 * `main` or a tag nobody scoped.
 */
export function verifyRefBoundary(input: {
  before: readonly RefSnapshot[];
  after: readonly RefSnapshot[];
  approvedRefs: readonly string[];
}): { state: BoundaryState; ok: boolean; changed: readonly string[]; problems: readonly string[] } {
  const approved = new Set(input.approvedRefs);
  const before = new Map(input.before.map((entry) => [entry.ref, entry.tip]));
  const after = new Map(input.after.map((entry) => [entry.ref, entry.tip]));
  const problems: string[] = [];
  const changed: string[] = [];
  const newRefs: string[] = [];
  const goneRefs: string[] = [];
  const unapprovedRefs: string[] = [];

  for (const [ref, tip] of after) {
    if (!before.has(ref)) {
      newRefs.push(ref);
      problems.push(`new ref appeared during the rewrite: ${ref}`);
      continue;
    }
    if (before.get(ref) !== tip) {
      changed.push(ref);
      if (!approved.has(ref)) {
        unapprovedRefs.push(ref);
        problems.push(`ref changed without approval: ${ref}`);
      }
    }
  }
  for (const [ref] of before) {
    if (!after.has(ref)) {
      goneRefs.push(ref);
      problems.push(`ref disappeared during the rewrite: ${ref}`);
    }
  }

  if (newRefs.length > 0) return { state: "UNEXPECTED_NEW_REF", ok: false, changed, problems };
  if (goneRefs.length > 0) return { state: "REF_DISAPPEARED", ok: false, changed, problems };
  if (unapprovedRefs.length > 0) return { state: "UNAPPROVED_REF_CHANGED", ok: false, changed, problems };
  if (changed.length !== approved.size) {
    problems.push(`only ${changed.length} of ${approved.size} approved refs changed: the rewrite did not do the work it claimed`);
  }
  return { state: problems.length === 0 ? "BOUNDARY_OK" : "UNAPPROVED_REF_CHANGED", ok: problems.length === 0, changed, problems };
}

export interface IntegrityObservation {
  checkoutSucceeded: boolean;
  worktreeFiles: number;
  /** Files whose content must be identical to the pre-rewrite tree. */
  preservedPaths: readonly { path: string; same: boolean }[];
  /**
   * The target path itself. `rewritten` is a positive control — the replacement is
   * present somewhere in this ref's rewritten history. The tip blob may legitimately
   * be identical to the original when the tip already carried a rotated-out file;
   * what must never be true is that the tip still carries the credential, which the
   * rewrite verification above refuses.
   */
  targetPath: { path: string; present: boolean; rewritten: boolean };
  fsckClean: boolean;
  refsPresent: readonly string[];
  expectedRefs: readonly string[];
}

export type IntegrityState =
  | "INTEGRITY_OK"
  | "CHECKOUT_FAILED"
  | "CONTENT_LOST"
  | "UNRELATED_CONTENT_CHANGED"
  | "REFS_MISSING"
  | "OBJECTS_DAMAGED";

/**
 * Phase I. "Git accepts the refs" is not integrity: the tree must materialize, the
 * refs must all be there, the objects must traverse, unrelated files must be
 * byte-identical, and the target file must be present *and changed*.
 */
export function verifyRepositoryIntegrity(observation: IntegrityObservation): { state: IntegrityState; ok: boolean; problems: readonly string[] } {
  const problems: string[] = [];
  if (!observation.fsckClean) problems.push("git fsck reported damage");
  if (!observation.checkoutSucceeded || observation.worktreeFiles <= 0)
    problems.push("the rewritten history could not be checked out");
  const missingRefs = observation.expectedRefs.filter((ref) => !observation.refsPresent.includes(ref));
  if (missingRefs.length > 0) problems.push(`ref(s) missing: ${missingRefs.join(", ")}`);
  for (const entry of observation.preservedPaths) {
    if (!entry.same) problems.push(`unrelated file changed by the rewrite: ${entry.path}`);
  }
  if (!observation.targetPath.present) problems.push(`target file ${observation.targetPath.path} is gone`);
  else if (!observation.targetPath.rewritten)
    problems.push(
      `the replacement is absent from the rewritten history of ${observation.targetPath.path}: the mechanism did not do the work it claimed`,
    );

  if (problems.some((line) => line.includes("fsck"))) return { state: "OBJECTS_DAMAGED", ok: false, problems };
  if (problems.some((line) => line.includes("ref(s) missing"))) return { state: "REFS_MISSING", ok: false, problems };
  if (problems.some((line) => line.includes("could not be checked out"))) return { state: "CHECKOUT_FAILED", ok: false, problems };
  if (problems.some((line) => line.includes("unrelated file changed"))) return { state: "UNRELATED_CONTENT_CHANGED", ok: false, problems };
  if (problems.length > 0) return { state: "CONTENT_LOST", ok: false, problems };
  return { state: "INTEGRITY_OK", ok: true, problems };
}

/* ── the verdict ────────────────────────────────────────────────────────── */

export interface RehearsalReport {
  mode: "REHEARSAL";
  disposable: boolean;
  realRemoteTouched: false;
  remediationPerformed: false;
  /** A rehearsal proves the procedure. It never marks A2 remediated. */
  a2Verified: false;
  stages: readonly RehearsalStage[];
  completedStages: readonly RehearsalStageName[];
  verdict: "REHEARSAL_VERIFIED" | "REHEARSAL_FAILED";
  problems: readonly string[];
  clone: CloneCompleteness;
  identity: IdentityVerdict;
  inventory: InventoryVerdict;
  backup: { state: BackupState; ok: boolean; problems: readonly string[] } | null;
  rewrite: { state: RewriteState; ok: boolean; verifiedRefs: readonly string[]; problems: readonly string[] } | null;
  boundary: { state: BoundaryState; ok: boolean; changed: readonly string[]; problems: readonly string[] } | null;
  integrity: { state: IntegrityState; ok: boolean; problems: readonly string[] } | null;
  restore: { state: RestoreState; ok: boolean; problems: readonly string[] } | null;
  evidence: { preDigest: string; postDigest: string } | null;
}

export function evaluateRehearsal(steps: {
  clone: CloneCompleteness;
  identity: IdentityVerdict;
  inventory: InventoryVerdict;
  backup: { state: BackupState; ok: boolean; problems: readonly string[] } | null;
  rewrite: { state: RewriteState; ok: boolean; verifiedRefs: readonly string[]; problems: readonly string[] } | null;
  boundary: { state: BoundaryState; ok: boolean; changed: readonly string[]; problems: readonly string[] } | null;
  integrity: { state: IntegrityState; ok: boolean; problems: readonly string[] } | null;
  restore: { state: RestoreState; ok: boolean; problems: readonly string[] } | null;
  evidence: { preDigest: string; postDigest: string } | null;
  completedStages: readonly RehearsalStageName[];
}): RehearsalReport {
  const problems: string[] = [
    ...steps.clone.problems,
    ...steps.identity.problems,
    ...steps.inventory.problems,
    ...(steps.backup?.problems ?? []),
    ...(steps.rewrite?.problems ?? []),
    ...(steps.boundary?.problems ?? []),
    ...(steps.integrity?.problems ?? []),
    ...(steps.restore?.problems ?? []),
  ];
  const allPresent =
    steps.clone.ok &&
    steps.identity.ok &&
    steps.inventory.ok &&
    steps.backup !== null &&
    steps.rewrite !== null &&
    steps.boundary !== null &&
    steps.integrity !== null &&
    steps.restore !== null;
  const allOk =
    allPresent &&
    (steps.backup?.ok ?? false) &&
    (steps.rewrite?.ok ?? false) &&
    (steps.boundary?.ok ?? false) &&
    (steps.integrity?.ok ?? false) &&
    (steps.restore?.ok ?? false);

  if (!allPresent) problems.push("the rehearsal did not run every stage");
  if (allOk) problems.length = 0;

  return {
    mode: "REHEARSAL",
    disposable: true,
    realRemoteTouched: false,
    remediationPerformed: false,
    a2Verified: false,
    stages: REHEARSAL_STAGES,
    completedStages: steps.completedStages,
    verdict: allOk ? "REHEARSAL_VERIFIED" : "REHEARSAL_FAILED",
    problems,
    clone: steps.clone,
    identity: steps.identity,
    inventory: steps.inventory,
    backup: steps.backup,
    rewrite: steps.rewrite,
    boundary: steps.boundary,
    integrity: steps.integrity,
    restore: steps.restore,
    evidence: steps.evidence,
  };
}

/** Exit codes: 0 rehearsed clean, 1 refused, 2 could not be evaluated. */
export function rehearsalExitCode(report: RehearsalReport): 0 | 1 | 2 {
  if (report.clone.state === "UNKNOWN_CLONE") return 2;
  return report.verdict === "REHEARSAL_VERIFIED" ? 0 : 1;
}

/** A human report. It always states what a rehearsal is not. */
export function formatRehearsalReport(report: RehearsalReport): string {
  const lines: string[] = [];
  lines.push("mode: REHEARSAL (disposable clone; the real repository is never contacted for mutation)");
  lines.push(`verdict: ${report.verdict}`);
  lines.push(`clone: ${report.clone.state}`);
  lines.push(`identity: ${report.identity.state}`);
  lines.push(`inventory: ${report.inventory.state} (${report.inventory.refs.length} refs measured)`);
  lines.push(`backup: ${report.backup?.state ?? "not reached"}`);
  lines.push(`rewrite: ${report.rewrite?.state ?? "not reached"}`);
  lines.push(`boundary: ${report.boundary?.state ?? "not reached"}${report.boundary ? ` (${report.boundary.changed.length} refs changed)` : ""}`);
  lines.push(`integrity: ${report.integrity?.state ?? "not reached"}`);
  lines.push(`restore: ${report.restore?.state ?? "not reached"}`);
  if (report.evidence) lines.push(`evidence: pre ${report.evidence.preDigest} / post ${report.evidence.postDigest}`);
  lines.push(`stages: ${report.completedStages.join(" -> ")}`);
  lines.push("remediationPerformed: no");
  lines.push("a2Verified: no (a rehearsal proves the procedure, never the remediation)");
  lines.push("realRemoteTouched: no");
  for (const problem of report.problems) lines.push(`problem: ${problem}`);
  return lines.join("\n");
}
