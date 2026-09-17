/**
 * Phase 244 — pre-remediation evidence capture and post-remediation verification.
 *
 * THE ORDER THIS ENCODES
 *   PRECHECK -> CAPTURE EVIDENCE -> EXPLICIT OPERATOR ACTION -> POSTCHECK ->
 *   RELEASE-GATE RE-EVALUATION
 *
 * Nothing here performs an operation, and nothing here can be satisfied by an
 * operation that has not happened. A post-check requires evidence produced
 * *after* the remediation instant: the same records that satisfy a pre-check are
 * held before the remediation and cannot be reused after it, which is the whole
 * difference between "we collected evidence" and "it worked".
 *
 * The freshness window and the subject bindings are derived from
 * `release-gate.ts` rather than restated, so a post-check cannot drift from what
 * the gate will accept.
 */
import { RELEASE_PREREQUISITES, type EvidenceRecord } from "./release-gate";
import {
  REMEDIATION_MANIFEST,
  type InventoryArtifactLike,
  type RemediationEvidenceRecord,
  type RemediationManifest,
  type RepositoryObservation,
} from "./remediation-manifest";

export const EVIDENCE_PACKAGE_SCHEMA = "phase244.pre-remediation-evidence/v1";

/** The freshness window the release gate applies to A1 and A2. */
export function prerequisiteMaxAgeMs(id: "A1_OTP_ISSUER_REVOCATION" | "A2_HISTORY_REWRITE"): number {
  const prerequisite = RELEASE_PREREQUISITES.find((entry) => entry.id === id);
  if (!prerequisite) throw new Error(`unknown prerequisite: ${id}`);
  if (typeof prerequisite.maxAgeMs !== "number") {
    // A prerequisite without a freshness window cannot be verified by freshness;
    // refusing is the only safe answer, because the gate would accept any age.
    throw new Error(`prerequisite ${id} declares no freshness window`);
  }
  return prerequisite.maxAgeMs;
}

/* ── Phase D: the pre-remediation evidence package ──────────────────────── */

export interface PreRemediationEvidenceRequest {
  manifest?: RemediationManifest;
  repository: RepositoryObservation;
  inventory: InventoryArtifactLike;
  /** The verdict the release gate computes today, passed in rather than re-derived. */
  releaseVerdict: string;
  /** The readiness outcome the operator obtained, for the record. */
  a1Outcome: string;
  a2Outcome: string;
  /** Injected: the package must be reproducible, so the clock is an argument. */
  now: number;
}

export interface PreRemediationEvidencePackage {
  schema: string;
  capturedAt: number;
  repository: {
    canonical: string;
    remoteUrl: string;
    branch: string;
    head: string;
    shallow: boolean;
  };
  credential: { name: string; fingerprint: string; fingerprintRule: string; path: string };
  issuer: { identity: string; selfServiceRevocation: string };
  exposure: {
    inventoryPath: string;
    inventoryVerifiedAt: number | null;
    historyCommits: number;
    carrierCommits: number;
    refs: readonly { ref: string; affected: boolean; carrierCommits: number; exposedAtTip: boolean }[];
  };
  worktreeClean: boolean;
  releaseVerdict: string;
  readiness: { a1: string; a2: string };
  /** Deterministic digest of the package's own content, over the fields above. */
  digest: string;
  /** Always true: this package contains no credential value, by construction. */
  containsCredentialValue: false;
  /** Always false: capturing evidence is not remediating. */
  remediationPerformed: false;
}

/** A stable digest over a package's decision-relevant fields. No crypto, no clock. */
function digestOf(packageWithoutDigest: Omit<PreRemediationEvidencePackage, "digest">): string {
  const canonical = JSON.stringify(packageWithoutDigest);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${canonical.length}`;
}

export function capturePreRemediationEvidence(
  request: PreRemediationEvidenceRequest,
): PreRemediationEvidencePackage {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const withoutDigest: Omit<PreRemediationEvidencePackage, "digest"> = {
    schema: EVIDENCE_PACKAGE_SCHEMA,
    capturedAt: request.now,
    repository: {
      canonical: manifest.repository.canonical,
      remoteUrl: request.repository.remoteUrl,
      branch: request.repository.branch,
      head: request.repository.head,
      shallow: request.repository.shallow,
    },
    credential: {
      name: manifest.credential.name,
      fingerprint: manifest.credential.fingerprint,
      fingerprintRule: manifest.credential.fingerprintRule,
      path: manifest.credential.path,
    },
    issuer: {
      identity: manifest.issuer.identity,
      selfServiceRevocation: manifest.issuer.selfServiceRevocation,
    },
    exposure: {
      inventoryPath: manifest.inventory.path,
      inventoryVerifiedAt: request.inventory.verifiedAt,
      historyCommits: request.inventory.historyCommits,
      carrierCommits: request.inventory.carrierCommits,
      refs: request.inventory.refs.map((entry) => ({
        ref: entry.ref,
        affected: entry.affected,
        carrierCommits: entry.carrierCommits,
        exposedAtTip: entry.exposedAtTip,
      })),
    },
    worktreeClean: request.repository.worktreeClean,
    releaseVerdict: request.releaseVerdict,
    readiness: { a1: request.a1Outcome, a2: request.a2Outcome },
    containsCredentialValue: false,
    remediationPerformed: false,
  };
  return { ...withoutDigest, digest: digestOf(withoutDigest) };
}

/* ── Phase E: the post-remediation verification contract ────────────────── */

export interface PostCheckResult {
  operation: "A1" | "A2";
  verified: boolean;
  remediationRecorded: boolean;
  checks: readonly { id: string; description: string; passed: boolean; detail: string }[];
  failed: readonly string[];
  evidenceSource: "external-issuer" | "external-verification" | null;
  problems: readonly string[];
}

export interface FingerprintScanResult {
  tool: string;
  exitCode: number;
  zeroOccurrences: boolean;
  /** Whether the same scan was shown to find the credential where it is present. */
  positiveControl: boolean;
  observedAt: number;
  refsScanned: readonly string[];
}

export interface RewriteIntegrityRecord {
  commitCountBefore: number;
  commitCountAfter: number;
  metadataDigestEqual: boolean;
  topologyDigestEqual: boolean;
  candidateTreeIdentical: boolean;
  refsRewritten: readonly string[];
  repoUsable: boolean;
}

export interface A1PostCheckRequest {
  manifest?: RemediationManifest;
  /** When the revocation was performed, by the operator, outside this repository. */
  remediationAt: number | null;
  now: number;
  evidence: readonly RemediationEvidenceRecord[];
}

export interface A2PostCheckRequest {
  manifest?: RemediationManifest;
  remediationAt: number | null;
  now: number;
  scan: FingerprintScanResult | null;
  inventoryAfter: InventoryArtifactLike | null;
  integrity: RewriteIntegrityRecord | null;
  /** The branch holding the candidate, as it exists after the rewrite. */
  candidateBranchAfter: string | null;
}

const hostOf = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const POST_ONLY = (record: RemediationEvidenceRecord, remediationAt: number | null): boolean =>
  remediationAt !== null && record.observedAt > remediationAt;

function selectPostEvidence(
  evidence: readonly RemediationEvidenceRecord[],
  id: string,
  remediationAt: number | null,
): { record: RemediationEvidenceRecord | null; rejectedPreCheck: boolean } {
  const candidates = evidence.filter((record) => record.requirementId === id);
  const post = candidates.find((record) => POST_ONLY(record, remediationAt));
  return { record: post ?? null, rejectedPreCheck: post === undefined && candidates.length > 0 };
}

export function evaluateA1PostCheck(request: A1PostCheckRequest): PostCheckResult {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const maxAgeMs = prerequisiteMaxAgeMs("A1_OTP_ISSUER_REVOCATION");
  const problems: string[] = [];
  const checks: { id: string; description: string; passed: boolean; detail: string }[] = [];

  const remediationAt = request.remediationAt;
  const recorded =
    typeof remediationAt === "number" &&
    Number.isFinite(remediationAt) &&
    remediationAt > 0 &&
    remediationAt <= request.now;
  checks.push({
    id: "a1-post-remediation-recorded",
    description: "the revocation instant is recorded, in the past, before this check",
    passed: recorded,
    detail: recorded ? "recorded" : "no usable revocation instant was supplied",
  });

  const confirmation = selectPostEvidence(
    request.evidence,
    "a1-post-issuer-confirmation",
    remediationAt,
  );
  const rejected = selectPostEvidence(
    request.evidence,
    "a1-post-credential-rejected",
    remediationAt,
  );

  const confirmationOk =
    confirmation.record !== null &&
    confirmation.record.source === "external-issuer" &&
    confirmation.record.fixture !== true &&
    hostOf(confirmation.record.subject?.issuer ?? "") === hostOf(manifest.issuer.identity);
  checks.push({
    id: "a1-post-issuer-confirmation",
    description: "the issuer itself confirms the revocation, after it happened",
    passed: confirmationOk,
    detail: confirmationOk
      ? "issuer confirmation recorded"
      : confirmation.rejectedPreCheck
        ? "only evidence produced before the revocation was supplied"
        : "no issuer confirmation recorded for this issuer",
  });

  const rejectionStatus = rejected.record?.observation?.rejectionStatus ?? null;
  const rejectionEndpoint = hostOf(rejected.record?.observation?.endpoint ?? "");
  const rejectionOk =
    rejected.record !== null &&
    rejected.record.source === "external-issuer" &&
    rejected.record.fixture !== true &&
    (rejectionStatus === 401 || rejectionStatus === 403) &&
    (rejectionEndpoint === "" || rejectionEndpoint === hostOf(manifest.issuer.identity));
  checks.push({
    id: "a1-post-credential-rejected",
    description: "presenting the exposed credential now fails with an explicit 401/403",
    passed: rejectionOk,
    detail: rejectionOk
      ? `observed ${rejectionStatus}`
      : rejectionStatus === null || rejectionStatus === 0
        ? "no response observed: a timeout or a 000 is not proof of revocation"
        : `observed ${rejectionStatus}, which is not an authentication failure`,
  });

  const fingerprintBound = request.evidence
    .filter((record) => record.requirementId.startsWith("a1-post-"))
    .every(
      (record) =>
        record.subject?.fingerprint === undefined ||
        record.subject.fingerprint === manifest.credential.fingerprint,
    );
  const fingerprintPresent = request.evidence.some(
    (record) =>
      record.requirementId.startsWith("a1-post-") &&
      record.subject?.fingerprint === manifest.credential.fingerprint,
  );
  checks.push({
    id: "a1-post-correct-credential",
    description: "the evidence identifies the exposed credential's fingerprint, not another's",
    passed: fingerprintBound && fingerprintPresent,
    detail: !fingerprintBound
      ? "evidence refers to a different fingerprint: a different credential's revocation is not this one's"
      : fingerprintPresent
        ? "fingerprint matches the manifest"
        : "no evidence carries the credential fingerprint, so the credential cannot be identified",
  });

  const boundAndFresh = request.evidence
    .filter((record) => record.requirementId.startsWith("a1-post-"))
    .filter((record) => record.source === "external-issuer")
    .every((record) => {
      const environment = record.subject?.environment;
      const fresh = request.now - record.observedAt <= maxAgeMs && record.observedAt <= request.now;
      return environment === "production" && fresh;
    });
  const hasExternalPost = request.evidence.some(
    (record) => record.requirementId.startsWith("a1-post-") && record.source === "external-issuer",
  );
  checks.push({
    id: "a1-post-bound-and-fresh",
    description: "the evidence is bound to the production environment and inside the gate's window",
    passed: hasExternalPost && boundAndFresh,
    detail:
      hasExternalPost && boundAndFresh
        ? `within ${Math.round(maxAgeMs / 86_400_000)} days, environment production`
        : "evidence is not bound to the production environment, or is older than the gate's window",
  });

  const localSubstitutes = request.evidence.filter(
    (record) =>
      record.requirementId.startsWith("a1-post-") &&
      (record.fixture === true || record.source === "local-run" || record.source === "documentation"),
  );
  checks.push({
    id: "a1-post-no-local-substitutes",
    description: "no fixture, local run or written note is standing in for issuer evidence",
    passed: localSubstitutes.length === 0,
    detail:
      localSubstitutes.length === 0
        ? "none"
        : `${localSubstitutes.length} record(s) cannot speak for the issuer`,
  });

  for (const check of checks) {
    if (!check.passed) problems.push(`${check.id}: ${check.detail}`);
  }
  const verified = checks.every((check) => check.passed);
  return {
    operation: "A1",
    verified,
    remediationRecorded: recorded,
    checks,
    failed: checks.filter((check) => !check.passed).map((check) => check.id),
    evidenceSource: verified ? "external-issuer" : null,
    problems,
  };
}

export function evaluateA2PostCheck(request: A2PostCheckRequest): PostCheckResult {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const expectedRefs = manifest.affectedRefs.map((entry) => entry.ref);
  const problems: string[] = [];
  const checks: { id: string; description: string; passed: boolean; detail: string }[] = [];

  const remediationAt = request.remediationAt;
  const recorded =
    typeof remediationAt === "number" &&
    Number.isFinite(remediationAt) &&
    remediationAt > 0 &&
    remediationAt <= request.now;
  checks.push({
    id: "a2-post-remediation-recorded",
    description: "the rewrite instant is recorded, in the past, before this check",
    passed: recorded,
    detail: recorded ? "recorded" : "no usable rewrite instant was supplied",
  });

  const scan = request.scan;
  const scanAfter = scan !== null && POST_ONLY({ observedAt: scan.observedAt } as RemediationEvidenceRecord, remediationAt);
  checks.push({
    id: "a2-post-zero-occurrences",
    description: "the fingerprint scan reports zero occurrences, run after the rewrite",
    passed:
      scan !== null &&
      scanAfter &&
      scan.exitCode === 0 &&
      scan.zeroOccurrences === true &&
      scan.tool.length > 0,
    detail:
      scan === null
        ? "no scan result supplied"
        : !scanAfter
          ? "the scan predates the rewrite, so it describes the old history"
          : scan.exitCode !== 0 || scan.zeroOccurrences !== true
            ? `scan reported exit ${scan.exitCode} with occurrences still present`
            : "zero occurrences",
  });

  checks.push({
    id: "a2-post-positive-control",
    description: "the same scan was shown to find the credential where it is still present",
    passed: scan !== null && scan.positiveControl === true,
    detail:
      scan !== null && scan.positiveControl === true
        ? "positive control passed"
        : "a scan that cannot be shown to be sensitive reads as success when it is broken",
  });

  const after = request.inventoryAfter;
  const measuredAfter = after?.refs ?? [];
  const afterNames = measuredAfter.map((entry) => entry.ref);
  const missingAfter = expectedRefs.filter((ref) => !afterNames.includes(ref));
  const stillAffected = measuredAfter
    .filter((entry) => expectedRefs.includes(entry.ref) && entry.affected)
    .map((entry) => entry.ref);
  const unexpectedAfter = afterNames.filter((ref) => !expectedRefs.includes(ref));
  const refsCoveredByScan =
    scan !== null && expectedRefs.every((ref) => scan.refsScanned.includes(ref));
  checks.push({
    id: "a2-post-per-ref-verified",
    description: "every manifest ref is re-measured as unaffected, none missing, none unexpected",
    passed:
      after !== null &&
      after.present &&
      after.generatedBy === manifest.inventory.generator &&
      missingAfter.length === 0 &&
      stillAffected.length === 0 &&
      unexpectedAfter.length === 0 &&
      refsCoveredByScan,
    detail:
      after === null
        ? "no post-rewrite inventory supplied"
        : missingAfter.length > 0
          ? `${missingAfter.length} manifest ref(s) missing from the post-rewrite inventory`
          : stillAffected.length > 0
            ? `${stillAffected.length} ref(s) still affected after the rewrite`
            : unexpectedAfter.length > 0
              ? `${unexpectedAfter.length} unexpected ref(s) appeared`
              : !refsCoveredByScan
                ? "the scan did not cover every manifest ref"
                : "all refs verified",
  });

  checks.push({
    id: "a2-post-no-carrier",
    description: "no carrier commit remains reachable from any ref",
    passed: after !== null && after.carrierCommits === 0,
    detail:
      after === null
        ? "no post-rewrite inventory supplied"
        : after.carrierCommits === 0
          ? "zero carriers"
          : `${after.carrierCommits} carrier commits remain reachable`,
  });

  const integrity = request.integrity;
  const rewrittenSet = new Set(integrity?.refsRewritten ?? []);
  const rewrittenExactly =
    integrity !== null &&
    expectedRefs.every((ref) => rewrittenSet.has(ref)) &&
    rewrittenSet.size === expectedRefs.length;
  checks.push({
    id: "a2-post-history-consistency",
    description:
      "commit counts, metadata and topology are unchanged, the candidate tree is identical, and exactly the manifest refs were rewritten",
    passed:
      integrity !== null &&
      integrity.commitCountBefore === integrity.commitCountAfter &&
      integrity.commitCountAfter > 0 &&
      integrity.metadataDigestEqual &&
      integrity.topologyDigestEqual &&
      integrity.candidateTreeIdentical &&
      rewrittenExactly,
    detail:
      integrity === null
        ? "no integrity record supplied"
        : !rewrittenExactly
          ? "the set of rewritten refs is not exactly the manifest's affected-ref set"
          : integrity.commitCountBefore !== integrity.commitCountAfter
            ? "the commit count changed: the rewrite removed or added history instead of replacing content"
            : !integrity.candidateTreeIdentical
              ? "the candidate branch's tree changed"
              : !integrity.metadataDigestEqual || !integrity.topologyDigestEqual
                ? "author/date/subject metadata or parent topology changed"
                : "history preserved",
  });

  const candidateBranch = request.candidateBranchAfter ?? "";
  checks.push({
    id: "a2-post-candidate-branch",
    description: "the candidate branch still exists, is not main, and the repository remains usable",
    passed:
      candidateBranch === manifest.repository.expectedBranch &&
      !manifest.repository.forbiddenBranches.includes(candidateBranch) &&
      integrity !== null &&
      integrity.repoUsable === true,
    detail:
      candidateBranch !== manifest.repository.expectedBranch
        ? `the candidate branch is ${candidateBranch || "(absent)"}, not ${manifest.repository.expectedBranch}`
        : integrity === null || integrity.repoUsable !== true
          ? "the repository was not reported usable after the rewrite"
          : "usable",
  });

  for (const check of checks) {
    if (!check.passed) problems.push(`${check.id}: ${check.detail}`);
  }
  const verified = checks.every((check) => check.passed);
  return {
    operation: "A2",
    verified,
    remediationRecorded: recorded,
    checks,
    failed: checks.filter((check) => !check.passed).map((check) => check.id),
    evidenceSource: verified ? "external-verification" : null,
    problems,
  };
}

/* ── the release-gate record a completed remediation may produce ────────── */

/**
 * Turn a passed post-check into the evidence record the release gate reads.
 * A post-check that has not passed produces an UNVERIFIED record — there is no
 * path from a pre-check, from a plan or from a note to a VERIFIED one, and the
 * caller still has to write the file itself, later, after the real operation.
 */
export function remediationEvidenceRecord(request: {
  operation: "A1" | "A2";
  postCheck: PostCheckResult;
  manifest?: RemediationManifest;
  candidateCommit?: string;
  observedAt: number;
}): EvidenceRecord {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const prerequisite =
    request.operation === "A1" ? "A1_OTP_ISSUER_REVOCATION" : "A2_HISTORY_REWRITE";
  const verified = request.postCheck.verified && request.postCheck.operation === request.operation;

  return {
    prerequisite,
    status: verified ? "VERIFIED" : "UNVERIFIED",
    // The gate accepts only an external verifying source; a post-check that did
    // not pass therefore cannot borrow one, and is reported as a local run.
    source: verified ? "external-verification" : "local-run",
    environment: verified ? "production" : "local",
    observedAt: request.observedAt,
    subject:
      request.operation === "A1"
        ? { issuer: manifest.issuer.identity }
        : { refs: manifest.affectedRefs.map((entry) => entry.ref), commit: request.candidateCommit },
    detail: verified
      ? `post-check passed: ${request.postCheck.checks.length} checks`
      : `post-check not passed: ${request.postCheck.failed.join(", ") || "no post-check performed"}`,
  };
}
