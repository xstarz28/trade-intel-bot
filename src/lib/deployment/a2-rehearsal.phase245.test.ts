/**
 * Phase 245 — A2 full-clone rehearsal and rewrite proof: the 28 required cases.
 *
 * Every case drives injected observations through the pure decisions. Nothing here
 * spawns git, opens a socket, writes a ref or touches the real repository; the
 * driver that does the I/O is exercised separately (the mutation suite runs it
 * against disposable fixtures, and the phase report records the real-clone run).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureRehearsalEvidence,
  canonicalRefName,
  evaluateCloneCompleteness,
  evaluateInvocation,
  REHEARSAL_EXECUTION_STAGES,
  evaluatePostRewriteEvidence,
  evaluateRehearsal,
  evaluateRehearsalIdentity,
  evaluateRehearsalRefInventory,
  evidenceDigest,
  formatRehearsalReport,
  planBackup,
  rehearsalExitCode,
  verifyBackup,
  verifyRefBoundary,
  verifyRepositoryIntegrity,
  verifyRestore,
  verifyRewriteOutcome,
  type CloneObservation,
  type RefSnapshot,
  type RefVerification,
} from "./a2-rehearsal";
import { REMEDIATION_MANIFEST, type RemediationManifest } from "./remediation-manifest";
import { currentReleaseVerdict } from "./release-current-state";
import { evaluateRelease, RELEASE_PREREQUISITES } from "./release-gate";
import { evaluateReleaseAdmission } from "./release-admission";

const MANIFEST: RemediationManifest = REMEDIATION_MANIFEST;
const NOW = 1_770_000_000_000;
const REWRITE_AT = NOW + 1_000;

const SCOPED_REFS = MANIFEST.affectedRefs.map((entry) => canonicalRefName(entry.ref));

function clone(overrides: Partial<CloneObservation> = {}): CloneObservation {
  return {
    workDir: "/tmp/disposable/rehearsal.git",
    bare: true,
    shallow: false,
    grafted: false,
    reachableCommits: 427,
    requiredObjectsPresent: true,
    objectDatabaseComplete: true,
    refs: [],
    errors: [],
    ...overrides,
  };
}

function ref(overrides: Partial<RefSnapshot> & { ref: string }): RefSnapshot {
  return {
    tip: "a".repeat(40),
    reachableCommits: 300,
    carrierCommits: 3,
    exposedAtTip: false,
    blobReachable: true,
    traversable: true,
    ...overrides,
  };
}

/** The eight scoped refs in the shape a clean full clone has before the rewrite. */
function scopedBefore(): RefSnapshot[] {
  return SCOPED_REFS.map((name) => ref({ ref: name, tip: `${name.length}`.padEnd(40, "b") }));
}

function verification(overrides: Partial<RefVerification> & { ref: string }): RefVerification {
  return {
    tip: "c".repeat(40),
    exists: true,
    fingerprintAtTip: false,
    fingerprintReachable: false,
    carrierCommits: 0,
    traversable: true,
    ...overrides,
  };
}

function postPackage(overrides: { phase?: "pre" | "post"; capturedAt?: number } = {}) {
  return captureRehearsalEvidence({
    phase: overrides.phase ?? "post",
    capturedAt: overrides.capturedAt ?? REWRITE_AT + 1,
    manifest: MANIFEST,
    remoteUrl: MANIFEST.repository.remoteUrl,
    branch: MANIFEST.repository.expectedBranch,
    candidate: "d".repeat(40),
    refs: SCOPED_REFS.map((name) => ref({ ref: name, carrierCommits: 0, blobReachable: false })),
    reachableCommits: 427,
    cloneState: "FULL_CLONE_OK",
    worktreeClean: true,
    rewriteAt: REWRITE_AT,
  });
}

describe("245 — full-clone requirement (cases 1-3)", () => {
  it("1. a shallow clone is rejected", () => {
    const verdict = evaluateCloneCompleteness(clone({ shallow: true }));
    expect(verdict.state).toBe("SHALLOW_CLONE");
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("shallow");
  });

  it("2. a full clone is accepted", () => {
    const verdict = evaluateCloneCompleteness(clone());
    expect(verdict.state).toBe("FULL_CLONE_OK");
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  it("3. an incomplete object database, a graft and an unreadable ref are all rejected", () => {
    expect(evaluateCloneCompleteness(clone({ objectDatabaseComplete: false })).state).toBe("INCOMPLETE_OBJECT_DATABASE");
    expect(evaluateCloneCompleteness(clone({ requiredObjectsPresent: false })).state).toBe("INCOMPLETE_OBJECT_DATABASE");
    expect(evaluateCloneCompleteness(clone({ reachableCommits: 1 })).state).toBe("INCOMPLETE_OBJECT_DATABASE");
    const grafted = evaluateCloneCompleteness(clone({ grafted: true }));
    expect(grafted.state).toBe("GRAFTED_CLONE");
    // the operator has to read *why*; a silent state change would be a worse report
    expect(grafted.problems.join(" ")).toContain("grafted");
    // A measurement that failed is not a clone we can vouch for.
    expect(evaluateCloneCompleteness(clone({ errors: ["rev-list timed out"] })).state).toBe("UNKNOWN_CLONE");
    expect(evaluateCloneCompleteness(clone({ errors: ["x"], shallow: true })).state).toBe("SHALLOW_CLONE");
  });
});

describe("245 — repository identity (cases 4-6)", () => {
  it("4. the exact repository is accepted in every transport form, and the directory name is never the evidence", () => {
    for (const source of [
      "https://github.com/xstarz28/trade-intel-bot.git",
      "https://github.com/xstarz28/trade-intel-bot",
      "https://x-access-token@github.com/xstarz28/trade-intel-bot",
      "git@github.com:xstarz28/trade-intel-bot.git",
    ]) {
      const verdict = evaluateRehearsalIdentity(
        { remoteUrl: source, directoryName: "some-other-name", source, declaredSource: null },
        MANIFEST,
      );
      expect(verdict.state).toBe("IDENTITY_OK");
      expect(verdict.problems).toEqual([]);
    }
    // A local fixture is identified by the source the manifest declares, not by the
    // name of the directory it happens to live in.
    const local = evaluateRehearsalIdentity(
      { remoteUrl: "", directoryName: "trade-intel-bot", source: "/tmp/fixtures/origin.git", declaredSource: "/tmp/fixtures/origin.git" },
      MANIFEST,
    );
    expect(local.state).toBe("IDENTITY_OK");
    const misnamed = evaluateRehearsalIdentity(
      { remoteUrl: "", directoryName: "trade-intel-bot", source: "/tmp/other/thing.git", declaredSource: null },
      MANIFEST,
    );
    expect(misnamed.state).toBe("AMBIGUOUS_REMOTE");
  });

  it("5. another owner or another repository is rejected", () => {
    for (const source of [
      "https://github.com/someone-else/trade-intel-bot.git",
      "https://github.com/xstarz28/trade-intel-bot-fork.git",
      "https://github.com/xstarz28/another-repo.git",
    ]) {
      const verdict = evaluateRehearsalIdentity({ remoteUrl: source, directoryName: "trade-intel-bot", source, declaredSource: null }, MANIFEST);
      expect(verdict.state).toBe("WRONG_REPOSITORY");
      expect(verdict.ok).toBe(false);
      expect(verdict.problems.join(" ")).toContain("directory name is not identity");
    }
    const local = evaluateRehearsalIdentity(
      { remoteUrl: "", directoryName: "trade-intel-bot", source: "/tmp/fixtures/other.git", declaredSource: "/tmp/fixtures/origin.git" },
      MANIFEST,
    );
    expect(local.state).toBe("WRONG_REPOSITORY");
  });

  it("6. another host is rejected, and an unparsable remote is refused rather than assumed", () => {
    for (const source of ["https://gitlab.com/xstarz28/trade-intel-bot.git", "https://example.invalid/xstarz28/trade-intel-bot"]) {
      expect(evaluateRehearsalIdentity({ remoteUrl: source, directoryName: "x", source, declaredSource: null }, MANIFEST).state).toBe("WRONG_REPOSITORY");
    }
    expect(evaluateRehearsalIdentity({ remoteUrl: "", directoryName: "x", source: "", declaredSource: null }, MANIFEST).state).toBe("AMBIGUOUS_REMOTE");
    expect(evaluateRehearsalIdentity({ remoteUrl: "/tmp/clone", directoryName: "x", source: "/tmp/clone", declaredSource: null }, MANIFEST).state).toBe("AMBIGUOUS_REMOTE");
  });
});

describe("245 — affected-ref inventory (cases 7-11)", () => {
  const opts = { cloneOk: true };

  it("7. a missing affected ref is rejected", () => {
    const measured = scopedBefore().filter((entry) => entry.ref !== `refs/heads/main`);
    const verdict = evaluateRehearsalRefInventory(measured, MANIFEST, opts);
    expect(verdict.state).toBe("MISSING_REF");
    expect(verdict.missingRefs).toEqual(["refs/heads/main"]);
    expect(verdict.ok).toBe(false);
  });

  it("8. an extra, unapproved ref is rejected", () => {
    const measured = [...scopedBefore(), ref({ ref: "refs/heads/some-other-branch" })];
    const verdict = evaluateRehearsalRefInventory(measured, MANIFEST, opts);
    expect(verdict.state).toBe("UNEXPECTED_REF");
    expect(verdict.unexpectedRefs).toEqual(["refs/heads/some-other-branch"]);
  });

  it("9. an empty inventory is not 'nothing to rewrite'", () => {
    const verdict = evaluateRehearsalRefInventory([], MANIFEST, opts);
    expect(verdict.state).toBe("EMPTY_INVENTORY");
    expect(verdict.problems.join(" ")).toContain("nothing to rewrite");
    // and an inventory that could not be measured at all is refused, not inferred
    expect(evaluateRehearsalRefInventory(scopedBefore(), MANIFEST, { cloneOk: false }).state).toBe("CLONE_REJECTED");
    const unreadable = [...scopedBefore().slice(1), ref({ ref: `refs/heads/main`, tip: null, traversable: false })];
    expect(evaluateRehearsalRefInventory(unreadable, MANIFEST, opts).state).toBe("UNKNOWN_INVENTORY");
  });

  it("10. the exact nine-ref inventory is accepted, in any order", () => {
    const measured = scopedBefore();
    expect(measured.map((entry) => entry.ref)).toEqual(SCOPED_REFS);
    expect(SCOPED_REFS).toHaveLength(9);
    const verdict = evaluateRehearsalRefInventory(measured, MANIFEST, opts);
    expect(verdict.state).toBe("INVENTORY_EXACT");
    expect(verdict.ok).toBe(true);
    expect(verdict.affectedRefs).toEqual([...SCOPED_REFS].sort());
    const shuffled = [...measured].reverse();
    expect(evaluateRehearsalRefInventory(shuffled, MANIFEST, opts).state).toBe("INVENTORY_EXACT");
    expect(evaluateRehearsalRefInventory(shuffled, MANIFEST, opts).refs.map((entry) => entry.ref)).toEqual(verdict.refs.map((entry) => entry.ref));
    // A scoped ref that carries no exposure contradicts the manifest.
    const clean = measured.map((entry) => ref({ ref: entry.ref, carrierCommits: entry.ref === "refs/heads/main" ? 0 : 3 }));
    expect(evaluateRehearsalRefInventory(clean, MANIFEST, opts).state).toBe("UNKNOWN_INVENTORY");
  });

  it("11. the pre-rewrite evidence captures all eight tips and a stable digest", () => {
    const package_ = captureRehearsalEvidence({
      phase: "pre",
      capturedAt: NOW,
      manifest: MANIFEST,
      remoteUrl: MANIFEST.repository.remoteUrl,
      branch: MANIFEST.repository.expectedBranch,
      candidate: "e".repeat(40),
      refs: scopedBefore(),
      reachableCommits: 427,
      cloneState: "FULL_CLONE_OK",
      worktreeClean: true,
    });
    expect(package_.refs).toHaveLength(9);
    for (const entry of package_.refs) expect(entry.tip).toMatch(/^[0-9a-f]{40}$/);
    expect(package_.digest).toMatch(/^[0-9a-f]{8}$/);
    const moved = captureRehearsalEvidence({
      phase: "pre",
      capturedAt: NOW,
      manifest: MANIFEST,
      remoteUrl: MANIFEST.repository.remoteUrl,
      branch: MANIFEST.repository.expectedBranch,
      candidate: "e".repeat(40),
      refs: scopedBefore().map((entry) => ({ ...entry, carrierCommits: entry.carrierCommits + 1 })),
      reachableCommits: 427,
      cloneState: "FULL_CLONE_OK",
      worktreeClean: true,
    });
    expect(moved.digest).not.toBe(package_.digest);
    const again = captureRehearsalEvidence({
      phase: "pre",
      capturedAt: NOW,
      manifest: MANIFEST,
      remoteUrl: MANIFEST.repository.remoteUrl,
      branch: MANIFEST.repository.expectedBranch,
      candidate: "e".repeat(40),
      refs: [...scopedBefore()].reverse(),
      reachableCommits: 427,
      cloneState: "FULL_CLONE_OK",
      worktreeClean: true,
    });
    expect(again.digest).toBe(package_.digest);
    expect(package_.fingerprint).toBe(MANIFEST.credential.fingerprint);
    // no credential value, only the fingerprint and the blob it lived in
    expect(Object.keys(package_)).not.toContain("value");
    expect(package_.fingerprint).toHaveLength(16);
    // the digest covers the content: it is computed over the package without the
    // digest field itself, and a single changed field changes it
    const withoutDigest = (entry: typeof package_) => {
      const copy: Record<string, unknown> = { ...entry };
      delete copy.digest;
      return copy;
    };
    expect(evidenceDigest(withoutDigest(package_))).toBe(package_.digest);
    expect(evidenceDigest(withoutDigest({ ...package_, candidate: "f".repeat(40) }))).not.toBe(package_.digest);
  });
});

describe("245 — backup and restore (cases 12-13)", () => {
  it("12. a backup that misses one ref, or points somewhere else, is rejected", () => {
    const plan = planBackup(scopedBefore(), "refs/p245-backup");
    expect(plan.entries).toHaveLength(9);
    expect(plan.immutable).toBe(true);
    const complete = plan.entries.map((entry) => ({ backupRef: entry.backupRef, sha: entry.sha }));
    expect(verifyBackup(plan, { present: complete }).state).toBe("BACKUP_COMPLETE");
    const missing = complete.filter((entry) => !entry.backupRef.endsWith("refs/heads/main"));
    expect(verifyBackup(plan, { present: missing }).state).toBe("BACKUP_MISSING_REF");
    const wrong = complete.map((entry) => (entry.backupRef.endsWith("main") ? { ...entry, sha: "f".repeat(40) } : entry));
    expect(verifyBackup(plan, { present: wrong }).state).toBe("BACKUP_SHA_MISMATCH");
    expect(verifyBackup(plan, { present: [] }).state).toBe("BACKUP_MISSING_REF");
    expect(verifyBackup(planBackup([], "refs/p245-backup"), { present: [] }).state).toBe("BACKUP_EMPTY");
  });

  it("13. the restore returns every tip exactly, and a moved tip is not a restore", () => {
    const before = scopedBefore();
    const tips = before.map((entry) => ({ ref: entry.ref, sha: entry.tip }));
    const expected = { refs: before.length, reachableCommits: 4_270 };
    const exact = verifyRestore(before, { tips, reachableCommits: 4_270, refCount: before.length, unexpectedRefs: [] }, expected);
    expect(exact.state).toBe("RESTORE_EXACT");
    expect(exact.ok).toBe(true);
    const moved = tips.map((entry) => (entry.ref === "refs/heads/main" ? { ...entry, sha: "9".repeat(40) } : entry));
    expect(verifyRestore(before, { tips: moved, reachableCommits: 4_270, refCount: before.length, unexpectedRefs: [] }, expected).state).toBe("RESTORE_REF_MISMATCH");
    const lost = tips.slice(1);
    expect(verifyRestore(before, { tips: lost, reachableCommits: 4_270, refCount: before.length - 1, unexpectedRefs: [] }, expected).state).toBe("RESTORE_REF_MISMATCH");
    expect(verifyRestore(before, { tips, reachableCommits: 3_000, refCount: before.length, unexpectedRefs: [] }, expected).state).toBe("RESTORE_DIGEST_MISMATCH");
    expect(verifyRestore(before, { tips: [...tips, { ref: "refs/heads/extra", sha: "a".repeat(40) }], reachableCommits: 4_270, refCount: before.length + 1, unexpectedRefs: ["refs/heads/extra"] }, expected).state).toBe("RESTORE_EXTRA_REF");
    // a backup ref left behind is an extra ref too: the fixture must not keep one
    expect(verifyRestore(before, { tips, reachableCommits: 4_270, refCount: before.length, unexpectedRefs: ["refs/p245-backup/refs/heads/main"] }, expected).state).toBe("RESTORE_EXTRA_REF");
  });
});

describe("245 — post-rewrite verification (cases 14-20)", () => {
  it("14. a rewrite that removes the fingerprint from reachable history verifies, per ref", () => {
    const verdict = verifyRewriteOutcome({
      after: SCOPED_REFS.map((name) => verification({ ref: name })),
      approvedRefs: SCOPED_REFS,
      rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT },
      evidence: postPackage(),
    });
    expect(verdict.state).toBe("REWRITE_VERIFIED");
    expect(verdict.ok).toBe(true);
    expect(verdict.verifiedRefs).toHaveLength(9);

    // the mechanism is held to the approved scope: a ref nobody approved is a failure
    for (const unapproved of ["refs/pull/1/head", "refs/heads/main"]) {
      const scope = verifyRewriteOutcome({
        after: SCOPED_REFS.map((name) => verification({ ref: name })),
        approvedRefs: SCOPED_REFS.filter((name) => name !== "refs/heads/main"),
        rewrite: { rewrittenRefs: [...SCOPED_REFS, unapproved], rewriteAt: REWRITE_AT },
        evidence: postPackage(),
      });
      expect(scope.state).toBe("UNAPPROVED_REF_REWRITTEN");
      expect(scope.ok).toBe(false);
      expect(scope.problems.join(" ")).toContain(unapproved);
    }
  });

  it("15. a clean tip with a fingerprinted history is a failure, not a pass", () => {
    const after = SCOPED_REFS.map((name) =>
      name === "refs/heads/main" ? verification({ ref: name, carrierCommits: 2, fingerprintReachable: true, fingerprintAtTip: false }) : verification({ ref: name }),
    );
    const verdict = verifyRewriteOutcome({ after, approvedRefs: SCOPED_REFS, rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT }, evidence: postPackage() });
    expect(verdict.state).toBe("TIP_ONLY_CLEAN");
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("tip looks clean");
    expect(verdict.problems.join(" ")).toContain("2 carrier commit(s)");

    // a reachable copy of the blob is a failure even when no carrier commit is
    // counted: the historical object is still there, so the ref is not clean
    const objectStillThere = verifyRewriteOutcome({
      after: SCOPED_REFS.map((name) =>
        name === "refs/heads/main" ? verification({ ref: name, fingerprintReachable: true, carrierCommits: 0 }) : verification({ ref: name }),
      ),
      approvedRefs: SCOPED_REFS,
      rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT },
      evidence: postPackage(),
    });
    expect(objectStillThere.ok).toBe(false);
    expect(objectStillThere.problems.join(" ")).toContain("still reachable");
  });

  it("16. a ref that disappears after the rewrite is a failure", () => {
    const after = SCOPED_REFS.map((name) => (name === "refs/tags/rc-181" ? verification({ ref: name, tip: null, exists: false }) : verification({ ref: name })));
    const verdict = verifyRewriteOutcome({ after, approvedRefs: SCOPED_REFS, rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT }, evidence: postPackage() });
    expect(verdict.state).toBe("REF_MISSING_AFTER_REWRITE");
    expect(verdict.problems.join(" ")).toContain("missing after the rewrite");
  });

  it("17. a ref changed without approval, a disappeared ref and a new ref are all failures", () => {
    const before = [...scopedBefore(), ref({ ref: "refs/pull/1/head", tip: "1".repeat(40) })];
    const rewritten = before.map((entry) => (SCOPED_REFS.includes(entry.ref) ? { ...entry, tip: `r${entry.ref}`.padEnd(40, "0") } : entry));

    const okBoundary = verifyRefBoundary({ before, after: rewritten, approvedRefs: SCOPED_REFS });
    expect(okBoundary.state).toBe("BOUNDARY_OK");
    expect(okBoundary.changed).toHaveLength(9);

    const unapproved = verifyRefBoundary({
      before,
      after: rewritten.map((entry) => (entry.ref === "refs/pull/1/head" ? { ...entry, tip: "2".repeat(40) } : entry)),
      approvedRefs: SCOPED_REFS,
    });
    expect(unapproved.state).toBe("UNAPPROVED_REF_CHANGED");
    expect(unapproved.problems.join(" ")).toContain("refs/pull/1/head");

    const disappeared = verifyRefBoundary({ before, after: rewritten.filter((entry) => entry.ref !== "refs/tags/rc-181"), approvedRefs: SCOPED_REFS });
    expect(disappeared.state).toBe("REF_DISAPPEARED");
    expect(disappeared.problems.join(" ")).toContain("refs/tags/rc-181");

    const added = verifyRefBoundary({ before, after: [...rewritten, ref({ ref: "refs/heads/surprise" })], approvedRefs: SCOPED_REFS });
    expect(added.state).toBe("UNEXPECTED_NEW_REF");
    expect(added.problems.join(" ")).toContain("refs/heads/surprise");

    // a rewrite that changed nothing at all cannot claim success
    const noop = verifyRefBoundary({ before, after: before, approvedRefs: SCOPED_REFS });
    expect(noop.ok).toBe(false);
    expect(noop.problems.join(" ")).toContain("did not do the work it claimed");
  });

  it("18. unrelated history rewritten, a broken checkout and damaged objects are all failures", () => {
    const base = {
      checkoutSucceeded: true,
      worktreeFiles: 764,
      preservedPaths: [{ path: "src/app.ts", same: true }],
      targetPath: { path: MANIFEST.credential.path, present: true, rewritten: true },
      fsckClean: true,
      refsPresent: SCOPED_REFS,
      expectedRefs: SCOPED_REFS,
    };
    expect(verifyRepositoryIntegrity(base).state).toBe("INTEGRITY_OK");
    expect(verifyRepositoryIntegrity({ ...base, preservedPaths: [{ path: "src/app.ts", same: false }] }).state).toBe("UNRELATED_CONTENT_CHANGED");
    expect(verifyRepositoryIntegrity({ ...base, checkoutSucceeded: false, worktreeFiles: 0 }).state).toBe("CHECKOUT_FAILED");
    expect(verifyRepositoryIntegrity({ ...base, fsckClean: false }).state).toBe("OBJECTS_DAMAGED");
    expect(verifyRepositoryIntegrity({ ...base, refsPresent: SCOPED_REFS.slice(1) }).state).toBe("REFS_MISSING");
    expect(verifyRepositoryIntegrity({ ...base, targetPath: { path: MANIFEST.credential.path, present: false, rewritten: false } }).state).toBe("CONTENT_LOST");
    expect(verifyRepositoryIntegrity({ ...base, targetPath: { path: MANIFEST.credential.path, present: true, rewritten: false } }).state).toBe("CONTENT_LOST");
    // history that no longer traverses is caught in the rewrite verification too
    const broken = SCOPED_REFS.map((name) => (name === "refs/heads/main" ? verification({ ref: name, traversable: false }) : verification({ ref: name })));
    expect(
      verifyRewriteOutcome({ after: broken, approvedRefs: SCOPED_REFS, rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT }, evidence: postPackage() }).state,
    ).toBe("HISTORY_NOT_TRAVERSABLE");
  });

  it("19. post-rewrite verification cannot reuse pre-rewrite evidence", () => {
    const pre = postPackage({ phase: "pre", capturedAt: NOW });
    const verdict = evaluatePostRewriteEvidence(pre, REWRITE_AT);
    expect(verdict.state).toBe("WRONG_PHASE");
    expect(verdict.ok).toBe(false);
    const outcome = verifyRewriteOutcome({
      after: SCOPED_REFS.map((name) => verification({ ref: name })),
      approvedRefs: SCOPED_REFS,
      rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT },
      evidence: pre,
    });
    expect(outcome.state).toBe("FINGERPRINT_STILL_REACHABLE");
    expect(outcome.ok).toBe(false);
    expect(outcome.problems.join(" ")).toContain("cannot prove the rewrite");
    // and a tampered post package fails on its digest
    const tampered = { ...postPackage(), refs: [] };
    expect(evaluatePostRewriteEvidence(tampered, REWRITE_AT).state).toBe("DIGEST_MISMATCH");
  });

  it("20. evidence captured before the rewrite cannot satisfy the post-rewrite proof", () => {
    const atTheInstant = postPackage({ capturedAt: REWRITE_AT });
    expect(evaluatePostRewriteEvidence(atTheInstant, REWRITE_AT).state).toBe("STALE_INSTANT");
    const before = postPackage({ capturedAt: REWRITE_AT - 1 });
    expect(evaluatePostRewriteEvidence(before, REWRITE_AT).ok).toBe(false);
    const after = postPackage({ capturedAt: REWRITE_AT + 1 });
    expect(evaluatePostRewriteEvidence(after, REWRITE_AT).state).toBe("EVIDENCE_ACCEPTED");
    expect(after.rewriteAt).toBe(REWRITE_AT);
  });
});

describe("245 — determinism and the operator contract (cases 21-23)", () => {
  it("21. identical input produces an identical report, whatever the order", () => {
    const build = (refs: RefSnapshot[]) =>
      evaluateRehearsal({
        clone: evaluateCloneCompleteness(clone({ refs })),
        identity: evaluateRehearsalIdentity({ remoteUrl: MANIFEST.repository.remoteUrl, directoryName: "x", source: MANIFEST.repository.remoteUrl, declaredSource: null }, MANIFEST),
        inventory: evaluateRehearsalRefInventory(refs, MANIFEST, { cloneOk: true }),
        backup: verifyBackup(planBackup(refs, "refs/p245-backup"), { present: planBackup(refs, "refs/p245-backup").entries.map((entry) => ({ backupRef: entry.backupRef, sha: entry.sha })) }),
        rewrite: verifyRewriteOutcome({
          after: refs.map((entry) => verification({ ref: entry.ref })),
          approvedRefs: refs.map((entry) => entry.ref),
          rewrite: { rewrittenRefs: refs.map((entry) => entry.ref), rewriteAt: REWRITE_AT },
          evidence: postPackage(),
        }),
        boundary: verifyRefBoundary({ before: refs, after: refs.map((entry) => ({ ...entry, tip: `r${entry.ref}`.padEnd(40, "0") })), approvedRefs: refs.map((entry) => entry.ref) }),
        integrity: verifyRepositoryIntegrity({
          checkoutSucceeded: true,
          worktreeFiles: 10,
          preservedPaths: [{ path: "a.ts", same: true }],
          targetPath: { path: MANIFEST.credential.path, present: true, rewritten: true },
          fsckClean: true,
          refsPresent: refs.map((entry) => entry.ref),
          expectedRefs: refs.map((entry) => entry.ref),
        }),
        restore: verifyRestore(
          refs,
          {
            tips: refs.map((entry) => ({ ref: entry.ref, sha: entry.tip })),
            reachableCommits: 4_270,
            refCount: refs.length,
            unexpectedRefs: [],
          },
          { refs: refs.length, reachableCommits: 4_270 },
        ),
        evidence: { preDigest: "0f0f0f0f", postDigest: "1f1f1f1f" },
        completedStages: [],
      });
    const forward = formatRehearsalReport(build(scopedBefore()));
    const reversed = formatRehearsalReport(build([...scopedBefore()].reverse()));
    expect(reversed).toBe(forward);
    expect(build(scopedBefore()).verdict).toBe("REHEARSAL_VERIFIED");
  });

  it("22. the rewritten repository still traverses", () => {
    const after = SCOPED_REFS.map((name) => verification({ ref: name }));
    expect(verifyRewriteOutcome({ after, approvedRefs: SCOPED_REFS, rewrite: { rewrittenRefs: SCOPED_REFS, rewriteAt: REWRITE_AT }, evidence: postPackage() }).ok).toBe(true);
    const intact = verifyRepositoryIntegrity({
      checkoutSucceeded: true,
      worktreeFiles: 764,
      preservedPaths: [],
      targetPath: { path: MANIFEST.credential.path, present: true, rewritten: true },
      fsckClean: true,
      refsPresent: SCOPED_REFS,
      expectedRefs: SCOPED_REFS,
    });
    expect(intact.state).toBe("INTEGRITY_OK");
  });

  it("23. the rewritten repository can still be checked out and materialized", () => {
    const materialized = verifyRepositoryIntegrity({
      checkoutSucceeded: true,
      worktreeFiles: 764,
      preservedPaths: [{ path: "src/convex/auth/emailOtp.ts", same: false }].slice(0, 0),
      targetPath: { path: MANIFEST.credential.path, present: true, rewritten: true },
      fsckClean: true,
      refsPresent: SCOPED_REFS,
      expectedRefs: SCOPED_REFS,
    });
    expect(materialized.ok).toBe(true);
    const empty = verifyRepositoryIntegrity({
      checkoutSucceeded: true,
      worktreeFiles: 0,
      preservedPaths: [],
      targetPath: { path: MANIFEST.credential.path, present: true, rewritten: true },
      fsckClean: true,
      refsPresent: SCOPED_REFS,
      expectedRefs: SCOPED_REFS,
    });
    expect(empty.state).toBe("CHECKOUT_FAILED");
  });
});

describe("245 — the tool cannot reach a remote mutation (cases 24-25)", () => {
  const driver = readFileSync(resolve(process.cwd(), "scripts/a2-rehearsal.mjs"), "utf8");
  const module_ = readFileSync(resolve(process.cwd(), "src/lib/deployment/a2-rehearsal.ts"), "utf8");

  it("24. the rehearsal never mutates a remote, and refuses to run on the project checkout", () => {
    const workDir = "/tmp/p245-disposable/run";
    const cwd = "/tmp/p245-disposable/run/rehearsal.git";
    const call = (verb: string, args: string[] = [], overrides: Partial<Parameters<typeof evaluateInvocation>[0]> = {}) =>
      evaluateInvocation({ verb, args, cwd, workDir, repoDir: null, ...overrides });

    // every verb that can change a remote is refused outright, in every mode
    for (const verb of ["push", "fetch", "pull", "send-pack", "submodule", "gc", "prune", "repack"]) {
      const decision = call(verb, ["origin", "refs/heads/main"]);
      expect(decision.allowed).toBe(false);
      expect(String(decision.reason)).toContain("can mutate a remote");
    }
    // and nothing outside the allowlist sneaks in
    expect(call("credential", ["fill"]).allowed).toBe(false);
    expect(call("filter-repo", ["--replace-text", "x"]).allowed).toBe(false);
    // the remote is read, never reconfigured
    expect(call("remote", ["get-url", "origin"]).allowed).toBe(true);
    expect(call("remote", ["set-url", "origin", "https://example.invalid/x.git"]).allowed).toBe(false);
    expect(call("remote", ["remove", "origin"]).allowed).toBe(false);
    // HEAD is read; repointing it is a write and is fenced like any other
    expect(call("symbolic-ref", ["--short", "HEAD"]).allowed).toBe(true);
    expect(call("symbolic-ref", ["HEAD"]).allowed).toBe(true);
    expect(call("symbolic-ref", ["HEAD", "refs/heads/main"]).allowed).toBe(true);
    expect(call("symbolic-ref", ["HEAD", "refs/heads/main"], { cwd: "/home/user/trade-intel-bot" }).allowed).toBe(false);
    expect(call("symbolic-ref", ["-m", "HEAD", "refs/heads/other"]).allowed).toBe(false);
    expect(call("symbolic-ref", ["--delete", "HEAD"]).allowed).toBe(false);
    // ref writes are fenced to the disposable directories
    expect(call("update-ref", ["refs/heads/x", "0".repeat(40)]).allowed).toBe(true);
    expect(call("update-ref", ["refs/heads/x", "0".repeat(40)], { cwd: "/home/user/trade-intel-bot" }).allowed).toBe(false);
    expect(call("update-ref", ["refs/heads/x", "0".repeat(40)], { cwd: "/tmp/p245-disposable/elsewhere" }).allowed).toBe(false);
    // a sibling directory that merely shares a prefix is not inside the work dir
    expect(call("update-ref", ["refs/heads/x", "0".repeat(40)], { cwd: `${workDir}-sibling` }).allowed).toBe(false);
    // --force is refused everywhere except the local rewrite mechanism
    expect(call("rev-parse", ["--force", "HEAD"]).allowed).toBe(false);
    expect(call("ls-remote", ["--force", "origin"]).allowed).toBe(false);
    expect(call("filter-branch", ["--force", "--index-filter", "true", "--", "refs/heads/main"]).allowed).toBe(true);
    expect(call("filter-branch", ["--force", "--index-filter", "true", "--", "refs/heads/main"], { cwd: "/home/user/trade-intel-bot" }).allowed).toBe(false);

    // the driver holds no second copy of that discipline: it asks the module
    expect(driver).toContain("evaluateInvocation({ verb, args: args.slice(1), cwd, workDir, repoDir })");
    expect(driver).not.toMatch(/const REFUSED = new Set/);
    expect(driver).not.toMatch(/git\(\[\s*"push"/);
    expect(driver).not.toMatch(/gitStatus\(\[\s*"push"/);
    // the project checkout is refused as a source, as a --repo and as a work dir
    expect(driver).toContain("refused: the work dir is inside the project checkout");
    expect(driver).toContain("refused: --repo is the project checkout itself");
    expect(driver).toContain("refused: the rehearsal source is the project checkout itself");
    // the mode line makes a rehearsal impossible to mistake for the real thing
    expect(driver).toContain('mode: "REHEARSAL"');
    expect(module_).toContain("mode: REHEARSAL (disposable clone; the real repository is never contacted for mutation)");
  });

  it("25. no force-push is reachable: --force exists only in the local rewrite", () => {
    // one occurrence in the driver: the argv of the local, disposable rewrite
    const forces = driver.match(/--force/g) ?? [];
    expect(forces).toHaveLength(1);
    const forceLine = driver.split("\n").find((line) => line.includes("--force")) ?? "";
    expect(forceLine).toContain("filter-branch");
    expect(forceLine).not.toContain("push");
    expect(forceLine).not.toContain("https://");
    // the module's exemption is exactly one verb wide
    expect(module_).toContain('if (verb !== "filter-branch"');
    expect(module_).toContain("--force is not permitted here");
    // a rehearsal never claims the real work was done
    expect(module_).toContain("remediationPerformed: false");
    expect(module_).toContain("realRemoteTouched: false");
  });

  it("26. the current real project state is still not ready", () => {
    const verdict = currentReleaseVerdict();
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain("A1_OTP_ISSUER_REVOCATION");
    expect(verdict.blockers).toContain("A2_HISTORY_REWRITE");
    expect(verdict.ready).toBe(false);
    expect(verdict.evaluationError).toBeUndefined();
  });

  it("27. a successful rehearsal never marks A2 verified", () => {
    const report = evaluateRehearsal({
      clone: evaluateCloneCompleteness(clone()),
      identity: evaluateRehearsalIdentity({ remoteUrl: MANIFEST.repository.remoteUrl, directoryName: "x", source: MANIFEST.repository.remoteUrl, declaredSource: null }, MANIFEST),
      inventory: evaluateRehearsalRefInventory(scopedBefore(), MANIFEST, { cloneOk: true }),
      backup: { state: "BACKUP_COMPLETE", ok: true, problems: [] },
      rewrite: { state: "REWRITE_VERIFIED", ok: true, verifiedRefs: SCOPED_REFS, problems: [] },
      boundary: { state: "BOUNDARY_OK", ok: true, changed: SCOPED_REFS, problems: [] },
      integrity: { state: "INTEGRITY_OK", ok: true, problems: [] },
      restore: { state: "RESTORE_EXACT", ok: true, problems: [] },
      evidence: { preDigest: "aaaa", postDigest: "bbbb" },
      completedStages: ["FULL_CLONE_ACQUISITION", "REWRITE"],
    });
    expect(report.verdict).toBe("REHEARSAL_VERIFIED");
    expect(report.a2Verified).toBe(false);
    expect(report.remediationPerformed).toBe(false);
    expect(report.realRemoteTouched).toBe(false);
    expect(report.mode).toBe("REHEARSAL");
    expect(JSON.stringify(report)).not.toMatch(/"a2Verified":\s*true/);
    expect(report.stages.map((stage) => stage)).toEqual([
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
    ]);
    expect(formatRehearsalReport(report)).toContain("a2Verified: no");
    // the rehearsal's own ten steps are a distinct, documented list, and the driver
    // logs exactly those (the operator sequence above is asserted separately)
    expect(REHEARSAL_EXECUTION_STAGES).toHaveLength(10);
    expect(REHEARSAL_EXECUTION_STAGES).toContain("INTEGRITY_CHECK");
    expect(REHEARSAL_EXECUTION_STAGES).toContain("RESTORE_PROOF");
    expect(REHEARSAL_EXECUTION_STAGES).not.toContain("EXPLICIT_OPERATOR_APPROVAL");
    const marks = (driver.match(/mark\("([A-Z_]+)"\)/g) ?? []).map((call) => call.slice(6, -2));
    expect(marks).toEqual([...REHEARSAL_EXECUTION_STAGES]);
    expect(rehearsalExitCode(report)).toBe(0);
    // a refusal is never reported as a success, and a broken tool is not a refusal
    expect(rehearsalExitCode({ ...report, verdict: "REHEARSAL_FAILED", clone: { state: "SHALLOW_CLONE", ok: false, problems: [] } })).toBe(1);
    expect(rehearsalExitCode({ ...report, verdict: "REHEARSAL_FAILED", clone: { state: "UNKNOWN_CLONE", ok: false, problems: [] } })).toBe(2);
  });

  it("28. release admission stays refused without real remediation evidence", () => {
    expect(evaluateReleaseAdmission({}).admitted).toBe(false);
    const records = RELEASE_PREREQUISITES.map((prerequisite) => ({
      prerequisite: prerequisite.id,
      status: "UNVERIFIED" as const,
      source: "documentation" as const,
      environment: "production" as const,
      observedAt: NOW,
    }));
    const verdict = evaluateRelease(
      { candidate: { commit: "e".repeat(40), ref: `heads/${MANIFEST.repository.expectedBranch}` }, affectedRefs: SCOPED_REFS, requiredProviders: [], records },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers.length).toBeGreaterThanOrEqual(3);
  });
});
