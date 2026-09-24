/**
 * Phase 244 — A1/A2 execution readiness.
 *
 * WHAT THIS ANSWERS
 * "If an operator performed the remediation right now, would they be doing it
 * against the right repository, the right refs, the right credential — and would
 * they be able to prove afterwards that it worked?" It answers that and nothing
 * else. No function here calls the issuer, writes a ref, opens a socket, spawns a
 * process or touches the filesystem: the observations arrive as arguments, the
 * clock arrives as an argument, and the same input always produces the same
 * report.
 *
 * TWO SEPARATE VERDICTS
 * A1 (issuer revocation) and A2 (history rewrite) are evaluated independently
 * because they have different preconditions and different failure modes. Neither
 * can be satisfied by local code, local tests or documentation: the evidence
 * sources that count for the operations themselves are the issuer's own
 * confirmation and independent tooling verification.
 *
 * READINESS IS NOT REMEDIATION
 * A ready state means "the only remaining step is the external operation" and
 * never "the operation happened". Every report carries `remediationPerformed:
 * false` and `verified: false`, and the states are named after the operation that
 * would be *permitted* — READY_TO_REVOKE, READY_TO_REWRITE — not after a result.
 */
import {
  manifestProblems,
  sameRepository,
  type InventoryArtifactLike,
  type RemediationEvidenceRecord,
  type RemediationManifest,
  type RemediationEvidenceRequirement,
  type RepositoryObservation,
  REMEDIATION_MANIFEST,
} from "./remediation-manifest";

export type A1ReadinessOutcome =
  | "READY_TO_REVOKE"
  | "WRONG_ISSUER"
  | "WRONG_CREDENTIAL"
  | "WRONG_REPOSITORY"
  | "MISSING_PRECHECK"
  | "MISSING_EXTERNAL_ACCESS"
  | "NOT_READY";

export type A2ReadinessOutcome =
  | "READY_TO_REWRITE"
  | "WRONG_REPOSITORY"
  | "WRONG_BRANCH"
  | "WRONG_CANDIDATE"
  | "INCOMPLETE_REF_INVENTORY"
  | "UNEXPECTED_REF"
  | "DIRTY_WORKTREE"
  | "MISSING_BACKUP_EVIDENCE"
  | "NOT_READY";

export interface RequirementStatus {
  id: string;
  phase: "pre" | "post";
  satisfied: boolean;
  /** The source of the record that satisfied it, when one did. */
  source: string | null;
  detail: string;
}

export interface EvidenceEvaluation {
  requirements: readonly RequirementStatus[];
  satisfied: number;
  total: number;
  unsatisfied: readonly string[];
}

/** Records that may never satisfy a requirement, whatever they claim. */
const NEVER_EVIDENCE = new Set(["fixture", "local-run", "documentation"]);

function evaluateEvidence(
  requirements: readonly RemediationEvidenceRequirement[],
  records: readonly RemediationEvidenceRecord[],
  phase: "pre" | "post",
): EvidenceEvaluation {
  const wanted = requirements.filter((requirement) => requirement.phase === phase);
  const statuses: RequirementStatus[] = wanted.map((requirement) => {
    const candidates = records.filter((record) => record.requirementId === requirement.id);
    const acceptable = candidates.find(
      (record) =>
        (requirement.acceptableSources as readonly string[]).includes(record.source) &&
        !NEVER_EVIDENCE.has(record.source) &&
        record.fixture !== true,
    );
    if (acceptable) {
      return {
        id: requirement.id,
        phase,
        satisfied: true,
        source: acceptable.source,
        detail: acceptable.detail ?? "recorded",
      };
    }
    const rejected = candidates.find(
      (record) => NEVER_EVIDENCE.has(record.source) || record.fixture === true,
    );
    return {
      id: requirement.id,
      phase,
      satisfied: false,
      source: null,
      detail: rejected
        ? `only a ${rejected.fixture === true ? "fixture" : rejected.source} record was supplied, which cannot satisfy this requirement`
        : "no record supplied",
    };
  });
  const unsatisfied = statuses.filter((status) => !status.satisfied).map((status) => status.id);
  return {
    requirements: statuses,
    satisfied: statuses.length - unsatisfied.length,
    total: statuses.length,
    unsatisfied,
  };
}

export interface A1ReadinessRequest {
  manifest?: RemediationManifest;
  repository: RepositoryObservation;
  /** What the operator says they are about to revoke. Never called, only compared. */
  declared: { issuer: string | null; fingerprint: string | null };
  /** Whether an external path to the issuer exists at all. */
  externalIssuerAccess: "available" | "unavailable" | "unknown";
  evidence: readonly RemediationEvidenceRecord[];
  now: number;
}

export interface A1ReadinessReport {
  operation: "A1";
  outcome: A1ReadinessOutcome;
  ready: boolean;
  remediationPerformed: false;
  verified: false;
  evaluation: { at: number; repository: string; branch: string; head: string };
  issuer: { expected: string; declared: string | null; matches: boolean };
  credential: { fingerprint: string; declared: string | null; matches: boolean };
  external: {
    issuerAccess: "available" | "unavailable" | "unknown";
    operationAttempted: false;
    externalOperationRequired: boolean;
  };
  evidence: EvidenceEvaluation;
  postRevocationRequirement: string;
  remainingOperation: string | null;
  problems: readonly string[];
  advisories: readonly string[];
}

const sameHost = (value: string, expected: string): boolean => {
  const normalize = (input: string) =>
    input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  return normalize(value) === normalize(expected) && normalize(value).length > 0;
};

/**
 * Evaluate A1 readiness. The refusal order is fixed so the sentence an operator
 * reads is the one that must be acted on first:
 *
 *   1. a manifest that cannot scope anything          -> NOT_READY
 *   2. the wrong repository (or a forbidden branch)   -> WRONG_REPOSITORY
 *   3. a missing or substituted issuer                -> MISSING_PRECHECK / WRONG_ISSUER
 *   4. a missing or substituted fingerprint           -> MISSING_PRECHECK / WRONG_CREDENTIAL
 *   5. no external path to the issuer                 -> MISSING_EXTERNAL_ACCESS
 *   6. incomplete pre-revocation evidence             -> MISSING_PRECHECK
 *   7. otherwise                                      -> READY_TO_REVOKE
 *
 * Step 5 outranks step 6 deliberately: no amount of local evidence collection
 * creates issuer access, so reporting the evidence gap first would send an
 * operator to do work that cannot change the outcome.
 */
export function evaluateA1Readiness(request: A1ReadinessRequest): A1ReadinessReport {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const problems: string[] = [];
  const advisories: string[] = [];

  const structureProblems = manifestProblems(manifest);
  problems.push(...structureProblems);

  const { repository, declared } = request;
  if (!sameRepository(repository.remoteUrl, manifest.repository.remoteUrl)) {
    problems.push(
      `repository mismatch: the clone's ${repository.remoteName} remote is not the manifest's canonical repository`,
    );
  }
  if (manifest.repository.forbiddenBranches.includes(repository.branch)) {
    problems.push(
      `the working branch is ${repository.branch}, which is never a remediation context`,
    );
  }

  const declaredIssuer = declared.issuer?.trim() ?? null;
  const operatorSuppliedIssuer = declaredIssuer !== null && declaredIssuer.length > 0;
  const issuerMatches = operatorSuppliedIssuer
    ? sameHost(declaredIssuer as string, manifest.issuer.identity)
    : false;
  if (!operatorSuppliedIssuer) {
    problems.push(
      "no issuer identity was supplied: an operator must confirm which issuer is being asked to revoke, from the manifest and not from memory",
    );
  } else if (!issuerMatches) {
    problems.push(
      `issuer mismatch: the declared issuer is not ${manifest.issuer.identity}. Revoking at another issuer would leave the credential live`,
    );
  }

  const declaredFingerprint = declared.fingerprint?.trim().toLowerCase() ?? null;
  const operatorSuppliedFingerprint =
    declaredFingerprint !== null && declaredFingerprint.length > 0;
  const fingerprintMatches =
    operatorSuppliedFingerprint && declaredFingerprint === manifest.credential.fingerprint;
  if (!operatorSuppliedFingerprint) {
    problems.push(
      "no credential fingerprint was supplied: the credential under remediation must be identified by fingerprint, never by a pasted value",
    );
  } else if (!fingerprintMatches) {
    problems.push(
      "credential mismatch: the declared fingerprint is not the exposed credential's fingerprint, so this is not the credential A1 is about",
    );
  }

  const evidence = evaluateEvidence(manifest.a1Requirements, request.evidence, "pre");
  const externalAccessAvailable = request.externalIssuerAccess === "available";
  if (!externalAccessAvailable) {
    // No amount of local evidence creates issuer access, so this is reported as a
    // problem rather than as advice: it is what stands between the operator and
    // the revocation, and only a human with issuer-side access can remove it.
    problems.push(
      request.externalIssuerAccess === "unavailable"
        ? `no external path to ${manifest.issuer.identity}: its self-service revocation surface is ${manifest.issuer.selfServiceRevocation}, so only a human with issuer-side access can revoke`
        : `external access to ${manifest.issuer.identity} is unknown: readiness cannot be established from an unknown path`,
    );
  }

  if (structureProblems.length > 0) {
    return report("NOT_READY");
  }
  if (
    !sameRepository(repository.remoteUrl, manifest.repository.remoteUrl) ||
    (manifest.repository.forbiddenBranches as readonly string[]).includes(repository.branch)
  ) {
    return report("WRONG_REPOSITORY");
  }
  if (!operatorSuppliedIssuer || !operatorSuppliedFingerprint) {
    return report("MISSING_PRECHECK");
  }
  if (!issuerMatches) {
    return report("WRONG_ISSUER");
  }
  if (!fingerprintMatches) {
    return report("WRONG_CREDENTIAL");
  }
  if (!externalAccessAvailable) {
    return report("MISSING_EXTERNAL_ACCESS");
  }
  if (evidence.unsatisfied.length > 0) {
    return report("MISSING_PRECHECK");
  }
  return report("READY_TO_REVOKE");

  function report(outcome: A1ReadinessOutcome): A1ReadinessReport {
    if (!externalAccessAvailable) {
      advisories.push(
        request.externalIssuerAccess === "unavailable"
          ? `the issuer reports no self-service revocation surface (${manifest.issuer.selfServiceRevocation}); the operator needs issuer-side access`
          : "external issuer access is unknown: readiness cannot be established without it",
      );
    }
    advisories.push(
      "the exposed key is a shared scaffold default: revoking it at the issuer affects every project that still uses it, which is the point rather than a side effect",
    );
    return {
      operation: "A1",
      outcome,
      ready: outcome === "READY_TO_REVOKE",
      remediationPerformed: false,
      verified: false,
      evaluation: {
        at: request.now,
        repository: manifest.repository.canonical,
        branch: repository.branch,
        head: repository.head,
      },
      issuer: {
        expected: manifest.issuer.identity,
        declared: declaredIssuer,
        matches: issuerMatches,
      },
      credential: {
        fingerprint: manifest.credential.fingerprint,
        declared: declaredFingerprint,
        matches: fingerprintMatches === true,
      },
      external: {
        issuerAccess: request.externalIssuerAccess,
        operationAttempted: false,
        externalOperationRequired: outcome === "READY_TO_REVOKE",
      },
      evidence,
      postRevocationRequirement: requirementText(
        manifest,
        "a1-post-credential-rejected",
        "an explicit authentication failure (401/403) presenting the old credential",
      ),
      remainingOperation:
        outcome === "READY_TO_REVOKE"
          ? `revoke the credential at ${manifest.issuer.identity} (external, by the operator)`
          : null,
      problems,
      advisories,
    };
  }
}

export interface A2ReadinessRequest {
  manifest?: RemediationManifest;
  repository: RepositoryObservation;
  inventory: InventoryArtifactLike;
  /** The candidate commit the operator pinned before the rewrite. */
  expectedCandidate: string | null;
  evidence: readonly RemediationEvidenceRecord[];
  now: number;
}

export interface A2ReadinessReport {
  operation: "A2";
  outcome: A2ReadinessOutcome;
  ready: boolean;
  remediationPerformed: false;
  verified: false;
  evaluation: { at: number; repository: string; branch: string; head: string };
  candidate: { expected: string | null; observed: string; matches: boolean };
  scope: {
    expectedRefs: readonly string[];
    measuredRefs: readonly string[];
    missingRefs: readonly string[];
    unexpectedRefs: readonly string[];
    inventoryAgeMs: number | null;
    inventoryFromGenerator: boolean;
    authoritativeScope: boolean;
  };
  worktree: { clean: boolean; shallow: boolean; historyCommitCount: number };
  evidence: EvidenceEvaluation;
  postRewriteRequirement: string;
  remainingOperation: string | null;
  problems: readonly string[];
  advisories: readonly string[];
}

/**
 * Evaluate A2 readiness. The refusal order, fixed and documented:
 *
 *   1. a manifest that cannot scope anything         -> NOT_READY
 *   2. not the canonical repository                  -> WRONG_REPOSITORY
 *   3. main, or a detached or unexpected branch      -> WRONG_BRANCH
 *   4. no candidate pin                              -> NOT_READY
 *      a candidate that moved since capture           -> WRONG_CANDIDATE
 *   5. the inventory contradicts the manifest        -> NOT_READY
 *   6. the ref scope cannot be established or is stale -> INCOMPLETE_REF_INVENTORY
 *   7. a ref the manifest does not account for       -> UNEXPECTED_REF
 *   8. uncommitted work                              -> DIRTY_WORKTREE
 *   9. pre-rewrite evidence incomplete               -> MISSING_BACKUP_EVIDENCE
 *  10. otherwise                                     -> READY_TO_REWRITE
 *
 * Steps 5-7 are the security-critical ones: a rewrite scoped from an incomplete
 * inventory leaves carriers reachable, which is the failure Phase 233 was
 * written to end.
 */
export function evaluateA2Readiness(request: A2ReadinessRequest): A2ReadinessReport {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const problems: string[] = [];
  const advisories: string[] = [];

  const structureProblems = manifestProblems(manifest);
  problems.push(...structureProblems);

  const { repository, inventory } = request;
  const expectedRefs = manifest.affectedRefs.map((entry) => entry.ref);

  if (!sameRepository(repository.remoteUrl, manifest.repository.remoteUrl)) {
    problems.push("repository mismatch: the clone's remote is not the manifest's repository");
  }
  const onForbiddenBranch = manifest.repository.forbiddenBranches.includes(repository.branch);
  const branchProblem =
    repository.branch === manifest.repository.expectedBranch
      ? null
      : onForbiddenBranch
        ? `the working branch is ${repository.branch}: it is never a rewrite context, and a rewrite performed from it would rewrite the default branch in place`
        : `the working branch is ${repository.branch || "(detached)"}, not ${manifest.repository.expectedBranch}; a branch name alone is not identity proof, but the wrong branch means the wrong worktree`;
  if (branchProblem) problems.push(branchProblem);

  const candidateMatches =
    request.expectedCandidate !== null && request.expectedCandidate === repository.head;
  if (request.expectedCandidate === null) {
    problems.push(
      "no candidate commit was pinned: capture the pre-remediation evidence package first, then pass its candidate",
    );
  } else if (!candidateMatches) {
    problems.push(
      "candidate mismatch: HEAD has moved since the evidence package was captured; re-capture before rewriting",
    );
  }

  const inventoryAgeMs =
    typeof inventory.verifiedAt === "number" && Number.isFinite(inventory.verifiedAt)
      ? request.now - inventory.verifiedAt
      : null;
  const fromGenerator = inventory.generatedBy === manifest.inventory.generator;
  const measuredRefs = inventory.refs.map((entry) => entry.ref);
  const missingRefs = expectedRefs.filter((ref) => !measuredRefs.includes(ref));
  const unexpectedRefs = measuredRefs.filter((ref) => !expectedRefs.includes(ref));

  /* Contradictions: the inventory and the manifest disagree about fixed facts. */
  const contradictions: string[] = [];
  if (inventory.present && inventory.fingerprint !== manifest.credential.fingerprint) {
    contradictions.push(
      "the inventory was produced for a different credential fingerprint than the manifest declares",
    );
  }
  if (inventory.present) {
    for (const expectation of manifest.affectedRefs) {
      const measured = inventory.refs.find((entry) => entry.ref === expectation.ref);
      if (measured && measured.carrierCommits !== expectation.carrierCommits) {
        contradictions.push(
          `${expectation.ref}: the inventory reports ${measured.carrierCommits} carrier commits where the manifest records ${expectation.carrierCommits} — the exposure has changed, so re-measure and re-derive the manifest before rewriting`,
        );
      }
    }
    if ([...inventory.blobPaths].sort().join(",") !== [...manifest.inventory.requiredBlobPaths].sort().join(",")) {
      contradictions.push(
        "the inventory lists different leaked paths than the manifest: the scope of the exposure is not the scope being rewritten",
      );
    }
    if (inventory.carrierCommits > inventory.historyCommits) {
      contradictions.push(
        "the inventory reports more carrier commits than reachable commits, which cannot both be true",
      );
    }
  }

  /* Completeness: the scope cannot be established, or is too old to trust. */
  const incomplete: string[] = [];
  if (!inventory.present) {
    incomplete.push(`the inventory artifact (${manifest.inventory.path}) is absent or unreadable`);
  } else {
    if (!fromGenerator) {
      incomplete.push(
        `the inventory was not produced by ${manifest.inventory.generator}: a hand-maintained ref list is how three affected branches were missed before`,
      );
    }
    if (inventory.refs.length === 0) {
      incomplete.push(
        "the inventory lists no refs: an empty ref set is not 'nothing to rewrite', it is an absent measurement",
      );
    }
    if (inventoryAgeMs === null) {
      incomplete.push("the inventory carries no readable measurement time");
    } else if (inventoryAgeMs < 0) {
      incomplete.push("the inventory is dated in the future, so its measurement cannot be trusted");
    } else if (inventoryAgeMs > manifest.inventory.maxAgeMs) {
      incomplete.push(
        `the inventory is ${Math.round(inventoryAgeMs / 3_600_000)}h old, beyond the ${Math.round(manifest.inventory.maxAgeMs / 3_600_000)}h execution window`,
      );
    }
    if (repository.shallow) {
      incomplete.push(
        "the local clone is shallow: per-ref scope cannot be re-measured here, and the Phase 184 audit is the standing proof that a shallow clone under-reports affected history",
      );
    }
    if (repository.historyCommitCount <= 1) {
      incomplete.push(
        `only ${repository.historyCommitCount} commit(s) are reachable locally, so this clone cannot scope a rewrite`,
      );
    }
    if (missingRefs.length > 0) {
      incomplete.push(
        `the inventory does not account for ${missingRefs.length} ref(s) the manifest requires`,
      );
    }
  }

  const evidence = evaluateEvidence(manifest.a2Requirements, request.evidence, "pre");

  if (structureProblems.length > 0) return report("NOT_READY");
  if (!sameRepository(repository.remoteUrl, manifest.repository.remoteUrl)) return report("WRONG_REPOSITORY");
  if (branchProblem) return report("WRONG_BRANCH");
  if (request.expectedCandidate === null) return report("NOT_READY");
  if (!candidateMatches) return report("WRONG_CANDIDATE");
  if (contradictions.length > 0) {
    problems.push(...contradictions);
    return report("NOT_READY");
  }
  if (incomplete.length > 0) {
    problems.push(...incomplete);
    return report("INCOMPLETE_REF_INVENTORY");
  }
  if (unexpectedRefs.length > 0) {
    problems.push(
      `the inventory reports ${unexpectedRefs.length} affected ref(s) the manifest does not account for`,
    );
    return report("UNEXPECTED_REF");
  }
  if (!repository.worktreeClean) return report("DIRTY_WORKTREE");
  if (evidence.unsatisfied.length > 0) return report("MISSING_BACKUP_EVIDENCE");
  return report("READY_TO_REWRITE");

  function report(outcome: A2ReadinessOutcome): A2ReadinessReport {
    if (repository.shallow) {
      advisories.push(
        "run the rewrite procedure from a full mirror clone: `git clone --mirror` and `git rev-parse --is-shallow-repository` must print false",
      );
    }
    advisories.push(
      "the writable nine-ref rewrite has landed on github.com; do not rewrite again. A2 stays unverified while GitHub-managed pull refs still reach the credential (Support #4773405 pending)",
    );
    return {
      operation: "A2",
      outcome,
      ready: outcome === "READY_TO_REWRITE",
      remediationPerformed: false,
      verified: false,
      evaluation: {
        at: request.now,
        repository: manifest.repository.canonical,
        branch: repository.branch,
        head: repository.head,
      },
      candidate: {
        expected: request.expectedCandidate,
        observed: repository.head,
        matches: candidateMatches,
      },
      scope: {
        expectedRefs,
        measuredRefs,
        missingRefs,
        unexpectedRefs,
        inventoryAgeMs,
        inventoryFromGenerator: fromGenerator,
        authoritativeScope:
          inventory.present &&
          fromGenerator &&
          inventory.refs.length > 0 &&
          !repository.shallow &&
          inventoryAgeMs !== null &&
          inventoryAgeMs >= 0 &&
          inventoryAgeMs <= manifest.inventory.maxAgeMs &&
          missingRefs.length === 0,
      },
      worktree: {
        clean: repository.worktreeClean,
        shallow: repository.shallow,
        historyCommitCount: repository.historyCommitCount,
      },
      evidence,
      postRewriteRequirement: requirementText(
        manifest,
        "a2-post-zero-occurrences",
        "zero fingerprint occurrences across every blob in every ref, with the scanner's positive control",
      ),
      remainingOperation:
        outcome === "READY_TO_REWRITE"
          ? "rewrite the history of every affected ref in a disposable mirror, then force-push with explicit human authorization (external, by the operator)"
          : null,
      problems,
      advisories,
    };
  }
}

export type RemediationReadinessReport = A1ReadinessReport | A2ReadinessReport;

function requirementText(
  manifest: RemediationManifest,
  id: string,
  fallback: string,
): string {
  const found = [...manifest.a1Requirements, ...manifest.a2Requirements].find(
    (requirement) => requirement.id === id,
  );
  return found ? found.description : fallback;
}

/** Exit code for an operator: 0 ready, 1 refused. Never 0 for a not-ready state. */
export function readinessExitCode(report: RemediationReadinessReport): 0 | 1 {
  return report.ready ? 0 : 1;
}

export function formatReadinessReport(report: RemediationReadinessReport): string {
  const lines: string[] = [
    `operation: ${report.operation}`,
    `outcome: ${report.outcome}`,
    `repository: ${report.evaluation.repository}`,
    `branch: ${report.evaluation.branch}`,
    `head: ${report.evaluation.head}`,
    "remediationPerformed: no",
    "verified: no",
  ];
  if (report.operation === "A1") {
    lines.push(`issuer: ${report.issuer.expected} (declared: ${report.issuer.declared ?? "none"})`);
    lines.push(
      `credential: ${report.credential.fingerprint} (declared: ${report.credential.declared ?? "none"})`,
    );
    lines.push(`external issuer access: ${report.external.issuerAccess}`);
  } else {
    lines.push(`expected refs: ${report.scope.expectedRefs.length}`);
    lines.push(`measured refs: ${report.scope.measuredRefs.length}`);
    lines.push(`missing refs: ${report.scope.missingRefs.join(", ") || "none"}`);
    lines.push(`unexpected refs: ${report.scope.unexpectedRefs.join(", ") || "none"}`);
    lines.push(`candidate: ${report.candidate.expected ?? "unpinned"} (observed ${report.candidate.observed})`);
    lines.push(`worktree clean: ${report.worktree.clean ? "yes" : "no"}`);
    lines.push(`shallow clone: ${report.worktree.shallow ? "yes" : "no"}`);
  }
  lines.push(`evidence: ${report.evidence.satisfied}/${report.evidence.total} pre-requirements satisfied`);
  for (const problem of report.problems) lines.push(`problem: ${problem}`);
  for (const advisory of report.advisories) lines.push(`advisory: ${advisory}`);
  lines.push(`remaining operation: ${report.remainingOperation ?? "none (not ready)"}`);
  return `${lines.join("\n")}\n`;
}

export function readinessJson(report: RemediationReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
