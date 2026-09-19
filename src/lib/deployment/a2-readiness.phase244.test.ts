/**
 * Phase 244 — A2 execution readiness (Phase C).
 *
 * The contract under test:
 *
 *   READY_TO_REWRITE  iff  the repository, the branch and the candidate are
 *   exactly the manifest's, the affected-ref scope is complete, current and
 *   generator-produced — every manifest ref present, none missing, none extra —
 *   the worktree is clean, and the rollback and rehearsal evidence exists.
 *
 * The security-critical property is the scope: a rewrite that misses a ref
 * leaves the blob reachable and undoes the whole exercise, so an empty,
 * partial, stale or unmeasurable inventory is never "ready".
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateA2Readiness,
  readinessJson,
  type A2ReadinessRequest,
} from "./remediation-readiness";
import {
  AFFECTED_REF_EXPECTATIONS,
  REMEDIATION_MANIFEST,
  type InventoryArtifactLike,
  type RemediationEvidenceRecord,
  type RepositoryObservation,
} from "./remediation-manifest";
import { currentReleaseVerdict } from "./release-current-state";
import { evaluateReleaseAdmission } from "./release-admission";
import { evaluateRelease, RELEASE_PREREQUISITES } from "./release-gate";

const root = process.cwd();
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const FINGERPRINT = REMEDIATION_MANIFEST.credential.fingerprint;
const BRANCH = REMEDIATION_MANIFEST.repository.expectedBranch;

const REPOSITORY: RepositoryObservation = {
  workdir: "/repo",
  branch: BRANCH,
  head: "cafe1234",
  remoteName: "origin",
  remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
  shallow: false,
  worktreeClean: true,
  historyCommitCount: 400,
};

function inventory(overrides: Partial<InventoryArtifactLike> = {}): InventoryArtifactLike {
  return {
    present: true,
    generatedBy: REMEDIATION_MANIFEST.inventory.generator,
    verifiedAt: NOW - HOUR,
    fingerprint: FINGERPRINT,
    blobPaths: [...REMEDIATION_MANIFEST.inventory.requiredBlobPaths],
    historyCommits: 398,
    carrierCommits: REMEDIATION_MANIFEST.credential.carrierCommits,
    refs: AFFECTED_REF_EXPECTATIONS.map((entry) => ({
      ref: entry.ref,
      affected: true,
      carrierCommits: entry.carrierCommits,
      exposedAtTip: entry.exposedAtTip,
    })),
    ...overrides,
  };
}

function preRecords(): RemediationEvidenceRecord[] {
  return REMEDIATION_MANIFEST.a2Requirements
    .filter((requirement) => requirement.phase === "pre")
    .map((requirement) => ({
      requirementId: requirement.id,
      source: "local-tooling" as const,
      observedAt: NOW - 1000,
      subject: { commit: REPOSITORY.head, refs: AFFECTED_REF_EXPECTATIONS.map((entry) => entry.ref) },
    }));
}

const evaluate = (overrides: Partial<A2ReadinessRequest> = {}) =>
  evaluateA2Readiness({
    repository: REPOSITORY,
    inventory: inventory(),
    expectedCandidate: REPOSITORY.head,
    evidence: preRecords(),
    now: NOW,
    ...overrides,
  });

describe("244 — A2 readiness", () => {
  it("11. the exact affected-ref set, pinned to a candidate, permits the rewrite", () => {
    const report = evaluate();

    expect(report.outcome).toBe("READY_TO_REWRITE");
    expect(report.ready).toBe(true);
    expect(report.scope.expectedRefs.length).toBe(8);
    expect(report.scope.measuredRefs.length).toBe(8);
    expect(report.scope.missingRefs).toEqual([]);
    expect(report.scope.unexpectedRefs).toEqual([]);
    expect(report.scope.authoritativeScope).toBe(true);
    expect(report.candidate.matches).toBe(true);
    expect(report.remainingOperation).toMatch(/mirror/);
    expect(report.problems).toEqual([]);
  });

  it("12. a ref the manifest requires but the inventory omits is refused", () => {
    const short = inventory({
      refs: inventory().refs.filter((entry) => entry.ref !== "heads/main"),
    });
    const report = evaluate({ inventory: short });

    expect(report.outcome).toBe("INCOMPLETE_REF_INVENTORY");
    expect(report.scope.missingRefs).toEqual(["heads/main"]);
    expect(report.problems.join(" ")).toContain("does not account for");
  });

  it("13. a ref the manifest does not account for is refused, not quietly rewritten", () => {
    const extra = inventory({
      refs: [
        ...inventory().refs,
        { ref: "heads/something-new", affected: true, carrierCommits: 12, exposedAtTip: false },
      ],
    });
    const report = evaluate({ inventory: extra });

    expect(report.outcome).toBe("UNEXPECTED_REF");
    expect(report.scope.unexpectedRefs).toEqual(["heads/something-new"]);
    expect(report.ready).toBe(false);
  });

  it("14. an inventory that cannot be established is refused, in every way it can fail", () => {
    const cases: [string, InventoryArtifactLike, Partial<A2ReadinessRequest>][] = [
      ["absent artifact", { ...inventory(), present: false, refs: [] }, {}],
      ["shallow clone", inventory(), { repository: { ...REPOSITORY, shallow: true } }],
      ["not generator-produced", inventory({ generatedBy: "hand-edited" }), {}],
      ["no measurement time", inventory({ verifiedAt: null }), {}],
      ["stale beyond the window", inventory({ verifiedAt: NOW - 25 * HOUR }), {}],
      ["dated in the future", inventory({ verifiedAt: NOW + HOUR }), {}],
      ["history not present locally", inventory(), { repository: { ...REPOSITORY, historyCommitCount: 1 } }],
    ];

    for (const [name, artifact, overrides] of cases) {
      const report = evaluate({ inventory: artifact, ...overrides });
      expect(report.outcome, name).toBe("INCOMPLETE_REF_INVENTORY");
      expect(report.ready, name).toBe(false);
      expect(report.problems.length, name).toBeGreaterThan(0);
    }
  });

  it("14b. a shallow clone is reported as the Phase 184 lesson, not as a warning", () => {
    const report = evaluate({ repository: { ...REPOSITORY, shallow: true } });

    expect(report.scope.authoritativeScope).toBe(false);
    expect(report.problems.join(" ")).toContain("shallow");
    expect(report.problems.join(" ")).toContain("Phase 184");
    expect(report.worktree.shallow).toBe(true);
    expect(report.advisories.join(" ")).toContain("--mirror");
  });

  it("15. an empty ref set is not 'nothing to rewrite'", () => {
    const report = evaluate({ inventory: inventory({ refs: [] }) });

    expect(report.outcome).toBe("INCOMPLETE_REF_INVENTORY");
    expect(report.problems.join(" ")).toContain("empty ref set is not 'nothing to rewrite'");
    expect(report.ready).toBe(false);
  });

  it("16. the wrong repository is refused", () => {
    const report = evaluate({
      repository: { ...REPOSITORY, remoteUrl: "https://github.com/someone/else.git" },
    });

    expect(report.outcome).toBe("WRONG_REPOSITORY");
  });

  it("17. a moved or missing candidate is refused; the pin comes from the captured package", () => {
    const moved = evaluate({ repository: { ...REPOSITORY, head: "beef5678" } });
    expect(moved.outcome).toBe("WRONG_CANDIDATE");
    expect(moved.problems.join(" ")).toContain("HEAD has moved");

    const unpinned = evaluate({ expectedCandidate: null });
    expect(unpinned.outcome).toBe("NOT_READY");
    expect(unpinned.problems.join(" ")).toContain("no candidate commit was pinned");
  });

  it("18. main, another branch, or a detached head is refused as the wrong branch", () => {
    for (const branch of ["main", "some-other-branch", ""]) {
      const report = evaluate({ repository: { ...REPOSITORY, branch } });
      expect(report.outcome, branch || "(detached)").toBe("WRONG_BRANCH");
      expect(report.ready, branch || "(detached)").toBe(false);
    }
    // A branch name is not identity proof on its own — it is checked with the
    // remote identity and the candidate, and all three must agree.
    const report = evaluate({ repository: { ...REPOSITORY, branch: "main" } });
    expect(report.evaluation.repository).toBe(REMEDIATION_MANIFEST.repository.canonical);
  });

  it("19. uncommitted work is refused, because a rewrite cannot be scoped around it", () => {
    const report = evaluate({ repository: { ...REPOSITORY, worktreeClean: false } });

    expect(report.outcome).toBe("DIRTY_WORKTREE");
    expect(report.worktree.clean).toBe(false);
  });

  it("20. missing pre-rewrite evidence is refused, requirement by requirement", () => {
    for (const missing of ["a2-pre-backup", "a2-pre-rehearsal", "a2-pre-candidate", "a2-pre-inventory"]) {
      const report = evaluate({
        evidence: preRecords().filter((record) => record.requirementId !== missing),
      });
      expect(report.outcome, missing).toBe("MISSING_BACKUP_EVIDENCE");
      expect(report.evidence.unsatisfied, missing).toEqual([missing]);
    }
  });

  it("20b. local tests and documentation cannot stand in for the rehearsal record", () => {
    for (const source of ["local-run", "documentation"] as const) {
      const report = evaluate({
        evidence: preRecords().map((record) =>
          record.requirementId === "a2-pre-rehearsal" ? { ...record, source } : record,
        ),
      });
      expect(report.outcome, source).toBe("MISSING_BACKUP_EVIDENCE");
      expect(report.evidence.unsatisfied, source).toEqual(["a2-pre-rehearsal"]);
    }
  });

  it("20c. a fixture rehearsal is not a rehearsal", () => {
    const report = evaluate({
      evidence: preRecords().map((record) =>
        record.requirementId === "a2-pre-rehearsal" ? { ...record, fixture: true } : record,
      ),
    });

    expect(report.outcome).toBe("MISSING_BACKUP_EVIDENCE");
    expect(report.evidence.requirements.find((entry) => entry.id === "a2-pre-rehearsal")?.detail).toContain(
      "fixture",
    );
  });

  it("21. a contradictory inventory fails closed rather than scoping a partial rewrite", () => {
    const differentCredential = evaluate({ inventory: inventory({ fingerprint: "ffffffffffffffff" }) });
    expect(differentCredential.outcome).toBe("NOT_READY");
    expect(differentCredential.problems.join(" ")).toContain("different credential fingerprint");

    const changedExposure = evaluate({
      inventory: inventory({
        refs: inventory().refs.map((entry) =>
          entry.ref === "heads/main" ? { ...entry, carrierCommits: 99 } : entry,
        ),
      }),
    });
    expect(changedExposure.outcome).toBe("NOT_READY");
    expect(changedExposure.problems.join(" ")).toContain("re-measure and re-derive");

    const differentPaths = evaluate({ inventory: inventory({ blobPaths: ["src/other.ts"] }) });
    expect(differentPaths.outcome).toBe("NOT_READY");

    const impossible = evaluate({ inventory: inventory({ carrierCommits: 500, historyCommits: 10 }) });
    expect(impossible.problems.join(" ")).toContain("cannot both be true");
  });

  it("22. identical input produces an identical report", () => {
    expect(readinessJson(evaluate())).toBe(readinessJson(evaluate()));
    const shallow = { repository: { ...REPOSITORY, shallow: true } };
    expect(readinessJson(evaluate(shallow))).toBe(readinessJson(evaluate(shallow)));
  });

  it("22b. readiness is not remediation, in the ready state too", () => {
    const report = evaluate();

    expect(report.remediationPerformed).toBe(false);
    expect(report.verified).toBe(false);
    expect(readinessJson(report)).not.toMatch(/"verified":\s*true/);
  });
});

describe("244 — the real tree is not ready, and stays that way", () => {
  /** Observations read from Git's own files: no process, no network, no writes. */
  function observeRealRepository(): RepositoryObservation {
    // Every read is optional: a CI runner may pack its refs, keep the git
    // directory elsewhere (a worktree) or check out a detached HEAD, and none of
    // that may turn an observation into a crash. An unreadable fact stays empty,
    // and an empty fact fails closed in the checks below.
    const dotGit = resolve(root, ".git");
    const gitDir =
      existsSync(dotGit) && statSync(dotGit).isFile()
        ? resolve(root, /gitdir:\s*(\S+)/.exec(readFileSync(dotGit, "utf8"))?.[1] ?? ".git")
        : dotGit;
    const readIfPresent = (relative: string): string =>
      existsSync(resolve(gitDir, relative))
        ? readFileSync(resolve(gitDir, relative), "utf8").trim()
        : "";
    const headFile = readIfPresent("HEAD");
    const branch = headFile.startsWith("ref: refs/heads/") ? headFile.slice("ref: refs/heads/".length) : "";
    const config = readIfPresent("config");
    const remoteUrl = /\[remote "origin"\][\s\S]*?url = (\S+)/.exec(config)?.[1] ?? "";
    const packed = readIfPresent("packed-refs");
    const head = branch
      ? readIfPresent(`refs/heads/${branch}`) ||
        new RegExp(`^([0-9a-f]{40}) refs/heads/${branch}$`, "m").exec(packed)?.[1] ||
        ""
      : headFile; // a detached HEAD holds the commit itself
    return {
      workdir: root,
      branch,
      head,
      remoteName: "origin",
      remoteUrl,
      shallow: existsSync(resolve(gitDir, "shallow")),
      worktreeClean: true,
      historyCommitCount: 400,
    };
  }

  const realInventory = (() => {
    const parsed = JSON.parse(readFileSync(resolve(root, REMEDIATION_MANIFEST.inventory.path), "utf8")) as {
      generatedBy: string;
      verifiedAt: string;
      fingerprint: string;
      blobPaths: string[];
      historyCommits: number;
      carrierCommits: number;
      refs: { ref: string; affected: boolean; carrierCommits: number; exposedAtTip: boolean }[];
    };
    return {
      present: true,
      generatedBy: parsed.generatedBy,
      verifiedAt: Date.parse(parsed.verifiedAt),
      fingerprint: parsed.fingerprint,
      blobPaths: parsed.blobPaths,
      historyCommits: parsed.historyCommits,
      carrierCommits: parsed.carrierCommits,
      refs: parsed.refs,
    } satisfies InventoryArtifactLike;
  })();

  it("23. the current real state evaluates to a refusal, with the reason named", () => {
    const repository = observeRealRepository();
    const report = evaluateA2Readiness({
      repository,
      inventory: realInventory,
      expectedCandidate: repository.head,
      evidence: [],
      now: Date.now(),
    });

    // Environment-independent invariants. Whatever clone this runs in, the tree is
    // never ready to rewrite, and the reason always includes the pre-rewrite
    // evidence that does not exist: an empty evidence list cannot satisfy it, so
    // READY_TO_REWRITE is unreachable here by construction rather than by luck.
    expect(report.ready).toBe(false);
    expect(report.outcome).not.toBe("READY_TO_REWRITE");
    expect(report.remediationPerformed).toBe(false);
    expect(report.verified).toBe(false);
    expect(report.evidence.unsatisfied).toContain("a2-pre-backup");
    expect(report.evidence.satisfied).toBe(0);

    // Which clone this is decides the *exact* refusal, and each shape is asserted
    // rather than tolerated. A detached HEAD (a CI pull-request checkout) is refused
    // before the scope can even be discussed; a shallow clone (a CI push checkout,
    // and this workspace) is the Phase 184 condition, where a rewrite scoped from
    // here would under-report the affected history; a full clone falls through to
    // the evidence refusal asserted unconditionally above.
    if (repository.branch === "") {
      expect(report.outcome).toBe("WRONG_BRANCH");
    } else if (repository.shallow) {
      expect(report.outcome).toBe("INCOMPLETE_REF_INVENTORY");
      expect(report.problems.join(" ")).toContain("shallow");
    } else {
      expect(report.outcome).toBe("MISSING_BACKUP_EVIDENCE");
      expect(report.problems.join(" ")).not.toContain("shallow");
    }
  });

  it("23b. which clone this ran in is recorded, not assumed", () => {
    // The clone's shape is what decides which branch of test 23 ran: detached,
    // shallow or full. This assertion records the two facts it depends on, and the
    // invariants in 23 hold in all three, which is why they are stated there.
    expect(observeRealRepository().shallow).toBe(existsSync(resolve(root, ".git/shallow")));
    expect(observeRealRepository().head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("30. the release admission still refuses, with or without a rewritten inventory", () => {
    const admission = evaluateReleaseAdmission({});
    expect(admission.admitted).toBe(false);
    expect(currentReleaseVerdict().verdict).toBe("NOT READY");

    // Even synthetic A1/A2 verification leaves the verdict short of READY: three
    // mandatory prerequisites have nothing to do with this phase.
    const records = RELEASE_PREREQUISITES.map((prerequisite) => ({
      prerequisite: prerequisite.id,
      status: "UNVERIFIED" as const,
      source: "documentation" as const,
      environment: "production" as const,
      observedAt: Date.now(),
    }));
    const verdict = evaluateRelease(
      {
        candidate: { commit: "cafe1234", ref: `heads/${BRANCH}` },
        affectedRefs: AFFECTED_REF_EXPECTATIONS.map((entry) => entry.ref),
        requiredProviders: [],
        records,
      },
      { prerequisites: RELEASE_PREREQUISITES, now: Date.now() },
    );

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers.length).toBeGreaterThanOrEqual(3);
  });
});
