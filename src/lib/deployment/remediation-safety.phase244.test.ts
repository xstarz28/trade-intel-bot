/**
 * Phase 244 — the safety properties of the readiness kit (Phases D, E, F, and the
 * cross-cutting cases).
 *
 * The claim these tests exist to defend: this tooling can prepare and can check,
 * and it cannot act. No readiness path reaches a force-push, a ref update, a
 * credential revocation endpoint, a deployment command, an email send or a
 * production provider request — and a post-check cannot be satisfied by the
 * evidence that was captured before the operation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_STAGES,
  REMEDIATION_MANIFEST,
  REMEDIATION_STAGES,
  advanceRemediationStage,
  type InventoryArtifactLike,
  type RemediationManifest,
  type RemediationEvidenceRecord,
  type RepositoryObservation,
} from "./remediation-manifest";
import { evaluateA1Readiness, evaluateA2Readiness } from "./remediation-readiness";
import {
  capturePreRemediationEvidence,
  evaluateA1PostCheck,
  evaluateA2PostCheck,
  remediationEvidenceRecord,
  type A2PostCheckRequest,
  type FingerprintScanResult,
  type PostCheckResult,
  type RewriteIntegrityRecord,
} from "./remediation-postcheck";
import { currentReleaseVerdict } from "./release-current-state";
import { evaluateRelease, RELEASE_PREREQUISITES } from "./release-gate";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const NOW = 1_800_000_000_000;
const REMEDIATION_AT = NOW - 86_400_000;
const ISSUER = REMEDIATION_MANIFEST.issuer.identity;
const FINGERPRINT = REMEDIATION_MANIFEST.credential.fingerprint;
const BRANCH = REMEDIATION_MANIFEST.repository.expectedBranch;
const REFS = REMEDIATION_MANIFEST.affectedRefs.map((entry) => entry.ref);

const IMPLEMENTATION_FILES = [
  "src/lib/deployment/remediation-manifest.ts",
  "src/lib/deployment/remediation-readiness.ts",
  "src/lib/deployment/remediation-postcheck.ts",
  "scripts/verify-remediation-readiness.mjs",
];

/** Strip comments so prose about a forbidden operation is not read as one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("244 — the readiness kit cannot act (Phase F)", () => {
  it("runs git through a read-only allowlist, and every call is on the list", () => {
    const source = stripComments(read("scripts/verify-remediation-readiness.mjs"));
    const calls = [...source.matchAll(/git\(\[([^\]]*)\]/g)].map(
      (match) => /"([^"]+)"/.exec(match[1])?.[1] ?? "",
    );

    expect(calls.length).toBeGreaterThan(4);
    const allowlist = /const READ_ONLY_GIT = new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1] ?? "";
    const allowed = [...allowlist.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    for (const subcommand of calls) {
      expect(allowed, `git ${subcommand}`).toContain(subcommand);
    }
    for (const verb of ["push", "update-ref", "delete-ref", "filter-repo", "filter-branch", "gc", "reset", "checkout", "reflog"]) {
      expect(allowed, verb).not.toContain(verb);
    }
  });

  it("cannot invoke a force-push, a ref mutation or a process runner it does not guard", () => {
    const source = stripComments(read("scripts/verify-remediation-readiness.mjs"));

    // Exactly one process spawn exists: the guarded git helper.
    expect(source.match(/spawnSync\(/g)?.length ?? 0).toBe(1);
    expect(source).not.toMatch(/execSync|execFileSync|exec\(/);
    // No write verb appears as a value anywhere in the code.
    for (const verb of ["push", "update-ref", "delete-ref", "filter-repo", "filter-branch", "--force", "set-url", "tag -d"]) {
      expect(source, verb).not.toMatch(new RegExp(`["'\`][^"'\`]*${verb}`));
    }
    // Nothing writes to the filesystem, and nothing opens a socket.
    expect(source).not.toMatch(
      /writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|renameSync|copyFileSync|chmodSync/,
    );
    expect(source).not.toMatch(/node:(net|http|https|tls|dgram)|fetch\(|WebSocket|XMLHttpRequest/);
  });

  it("reaches no deployment, email or provider operation from any readiness path", () => {
    // The manifest is excluded on purpose: it *describes* the historical exposure
    // (including the issuer's send path) in prose, which is not an operation.
    for (const path of IMPLEMENTATION_FILES.filter((file) => !file.endsWith("remediation-manifest.ts"))) {
      const source = stripComments(read(path));
      for (const operation of [
        "convex deploy",
        "npx convex",
        "sendEmail",
        "sendMail",
        "api.resend.com",
        "smtp2go",
        "revoke(",
        ".delete(",
        "deployments",
      ]) {
        expect(source, `${path}: ${operation}`).not.toContain(operation);
      }
    }
  });

  it("the policy modules are pure: no filesystem, no process, no network import", () => {
    for (const path of IMPLEMENTATION_FILES.filter((file) => file.startsWith("src/"))) {
      const source = read(path);
      expect(source, path).not.toMatch(/from "node:(fs|child_process|net|http|https|tls|dgram|worker_threads)"/);
      expect(source, path).not.toMatch(/process\.env/);
      expect(source, path).not.toMatch(/Date\.now\(\)/);
    }
  });

  it("the modules cannot mutate anything by accident: no writer, no spawner, no clock", () => {
    const manifest = read("src/lib/deployment/remediation-manifest.ts");
    const readiness = read("src/lib/deployment/remediation-readiness.ts");
    const postcheck = read("src/lib/deployment/remediation-postcheck.ts");

    // Call-shaped patterns only: the words "execution window" in a requirement
    // description are prose, while `execSync(` would be an operation.
    for (const source of [manifest, readiness, postcheck].map(stripComments)) {
      expect(source).not.toMatch(
        /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|writeFile|writeFileSync|appendFile|appendFileSync|unlinkSync|rmSync|mkdirSync|renameSync)\s*\(/,
      );
    }
    // Time arrives as an argument everywhere: no ambient clock in a decision.
    expect(readiness).toContain("now: number");
    expect(postcheck).toContain("capturedAt: request.now");
  });
});

describe("244 — the two-phase safety model", () => {
  it("advances one stage at a time and never skips", () => {
    const first = advanceRemediationStage("PRECHECK", "CAPTURE_EVIDENCE");
    expect(first.advanced).toBe(true);
    expect(first.external).toBe(false);

    const skipped = advanceRemediationStage("PRECHECK", "EXPLICIT_OPERATOR_ACTION", {
      operatorConfirmation: true,
    });
    expect(skipped.advanced).toBe(false);
    expect(skipped.reason).toContain("may not be skipped");
    expect(skipped.stage).toBe("PRECHECK");
  });

  it("refuses to enter the destructive stage without an explicit operator action", () => {
    const without = advanceRemediationStage("CAPTURE_EVIDENCE", "EXPLICIT_OPERATOR_ACTION");
    expect(without.advanced).toBe(false);
    expect(without.external).toBe(true);
    expect(without.reason).toContain("explicit operator action");

    const withConfirmation = advanceRemediationStage("CAPTURE_EVIDENCE", "EXPLICIT_OPERATOR_ACTION", {
      operatorConfirmation: true,
    });
    expect(withConfirmation.advanced).toBe(true);
    // Even then, the function only records the acknowledgement: it performs nothing.
    expect(withConfirmation.reason).toContain("happens outside this repository");
    expect(JSON.stringify(withConfirmation)).not.toMatch(/perform|invoke|execute/i);
  });

  it("marks exactly one stage as external, and refuses to move backwards", () => {
    expect([...EXTERNAL_STAGES]).toEqual(["EXPLICIT_OPERATOR_ACTION"]);
    const backwards = advanceRemediationStage("POSTCHECK", "CAPTURE_EVIDENCE");
    expect(backwards.advanced).toBe(false);
    expect(backwards.reason).toContain("only moves forward");
    expect([...REMEDIATION_STAGES]).toContain("RELEASE_GATE_REEVALUATION");
  });
});

describe("244 — the pre-remediation evidence package (Phase D)", () => {
  const repository: RepositoryObservation = {
    workdir: "/repo",
    branch: BRANCH,
    head: "cafe1234",
    remoteName: "origin",
    remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
    shallow: false,
    worktreeClean: true,
    historyCommitCount: 398,
  };
  const inventory: InventoryArtifactLike = {
    present: true,
    generatedBy: REMEDIATION_MANIFEST.inventory.generator,
    verifiedAt: NOW - 3_600_000,
    fingerprint: FINGERPRINT,
    blobPaths: [...REMEDIATION_MANIFEST.inventory.requiredBlobPaths],
    historyCommits: 398,
    carrierCommits: 270,
    refs: REMEDIATION_MANIFEST.affectedRefs.map((entry) => ({
      ref: entry.ref,
      affected: true,
      carrierCommits: entry.carrierCommits,
      exposedAtTip: entry.exposedAtTip,
    })),
  };

  const capture = (overrides: Partial<Parameters<typeof capturePreRemediationEvidence>[0]> = {}) =>
    capturePreRemediationEvidence({
      repository,
      inventory,
      releaseVerdict: currentReleaseVerdict().verdict,
      a1Outcome: "MISSING_EXTERNAL_ACCESS",
      a2Outcome: "INCOMPLETE_REF_INVENTORY",
      now: NOW,
      ...overrides,
    });

  it("captures the before-state an after-state can be compared with", () => {
    const pkg = capture();

    expect(pkg.repository.head).toBe("cafe1234");
    expect(pkg.repository.branch).toBe(BRANCH);
    expect(pkg.credential.fingerprint).toBe(FINGERPRINT);
    // Phase 272 — the pre-remediation exposure set is the ten measured
    // refs: nine plus the intentionally persisted Arena recovery branch.
    expect(pkg.exposure.refs.length).toBe(10);
    expect(pkg.exposure.carrierCommits).toBe(270);
    expect(pkg.worktreeClean).toBe(true);
    expect(pkg.releaseVerdict).toBe(currentReleaseVerdict().verdict);
    expect(pkg.capturedAt).toBe(NOW);
  });

  it("contains no credential value and performs no remediation", () => {
    const pkg = capture();

    expect(pkg.containsCredentialValue).toBe(false);
    expect(pkg.remediationPerformed).toBe(false);
    const serialized = JSON.stringify(pkg);
    const accountedFor = new Set([
      REMEDIATION_MANIFEST.credential.blob,
      ...REMEDIATION_MANIFEST.affectedRefs.flatMap((entry) => entry.ref.split("/")),
      pkg.digest,
    ]);
    const unaccounted = [...new Set(serialized.match(/[A-Za-z0-9_-]{33,}/g) ?? [])].filter(
      (run) => !accountedFor.has(run),
    );
    expect(unaccounted).toEqual([]);
  });

  it("is deterministic for identical input, and sensitive to a changed candidate", () => {
    expect(capture().digest).toBe(capture().digest);
    const moved = capture({ repository: { ...repository, head: "beef5678" } });
    expect(moved.digest).not.toBe(capture().digest);
    expect(JSON.stringify(capture())).toBe(JSON.stringify(capture()));
  });
});

describe("244 — the post-remediation verification contract (Phase E)", () => {
  const preCheckRecord = (requirementId: string): RemediationEvidenceRecord => ({
    requirementId,
    source: "external-issuer",
    observedAt: REMEDIATION_AT - 60_000,
    subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
    observation: { rejectionStatus: 200, endpoint: `https://${ISSUER}/send_otp` },
    detail: "observed before the revocation",
  });

  const postRecords = (): RemediationEvidenceRecord[] => [
    {
      requirementId: "a1-post-issuer-confirmation",
      source: "external-issuer",
      observedAt: REMEDIATION_AT + 60_000,
      subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
      detail: "issuer console confirms revocation",
    },
    {
      requirementId: "a1-post-credential-rejected",
      source: "external-issuer",
      observedAt: REMEDIATION_AT + 120_000,
      subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
      observation: { rejectionStatus: 401, endpoint: `https://${ISSUER}/send_otp` },
      detail: "presenting the old credential fails",
    },
  ];

  it("a complete, post-revocation A1 evidence set passes", () => {
    const result = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords(),
    });

    expect(result.verified).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.evidenceSource).toBe("external-issuer");
    expect(result.checks.length).toBeGreaterThan(4);
  });

  it("29. pre-check evidence cannot satisfy a post-check", () => {
    const result = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: [
        preCheckRecord("a1-post-issuer-confirmation"),
        preCheckRecord("a1-post-credential-rejected"),
      ],
    });

    expect(result.verified).toBe(false);
    expect(result.failed).toContain("a1-post-issuer-confirmation");
    expect(result.failed).toContain("a1-post-credential-rejected");
    expect(result.checks.map((check) => check.detail).join(" ")).toContain("before the revocation");
    expect(remediationEvidenceRecord({ operation: "A1", postCheck: result, observedAt: NOW }).status).toBe(
      "UNVERIFIED",
    );
  });

  it("25. a precheck cannot produce a VERIFIED A1 record, and a real post-check can", () => {
    const notPassed = evaluateA1PostCheck({ remediationAt: null, now: NOW, evidence: postRecords() });
    const record = remediationEvidenceRecord({ operation: "A1", postCheck: notPassed, observedAt: NOW });
    expect(record.status).toBe("UNVERIFIED");
    expect(record.source).toBe("local-run");
    expect(record.environment).toBe("local");

    const passed = evaluateA1PostCheck({ remediationAt: REMEDIATION_AT, now: NOW, evidence: postRecords() });
    const verified = remediationEvidenceRecord({ operation: "A1", postCheck: passed, observedAt: NOW });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.source).toBe("external-verification");
    expect(verified.environment).toBe("production");
    expect(verified.subject?.issuer).toBe(ISSUER);
  });

  it("a revocation the issuer does not confirm, or a status that is not a rejection, fails", () => {
    const withoutConfirmation = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords().filter((record) => record.requirementId !== "a1-post-issuer-confirmation"),
    });
    expect(withoutConfirmation.verified).toBe(false);
    expect(withoutConfirmation.failed).toContain("a1-post-issuer-confirmation");

    const timedOut = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords().map((record) =>
        record.requirementId === "a1-post-credential-rejected"
          ? { ...record, observation: { rejectionStatus: 0, endpoint: `https://${ISSUER}/send_otp` } }
          : record,
      ),
    });
    expect(timedOut.verified).toBe(false);
    expect(timedOut.checks.map((check) => check.detail).join(" ")).toContain("not proof of revocation");
  });

  it("a different credential's revocation, or a fixture record, is not this credential's", () => {
    const wrongCredential = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords().map((record) => ({
        ...record,
        subject: { ...record.subject, fingerprint: "deadbeefdeadbeef" },
      })),
    });
    expect(wrongCredential.verified).toBe(false);
    expect(wrongCredential.failed).toContain("a1-post-correct-credential");

    const fixture = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords().map((record) => ({ ...record, fixture: true })),
    });
    expect(fixture.verified).toBe(false);
    expect(fixture.failed).toContain("a1-post-no-local-substitutes");
  });

  it("an expired revocation record outside the gate's window fails", () => {
    const old = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT - 60 * 86_400_000,
      now: NOW,
      evidence: postRecords().map((record) => ({
        ...record,
        observedAt: record.observedAt - 60 * 86_400_000,
      })),
    });

    expect(old.verified).toBe(false);
    expect(old.failed).toContain("a1-post-bound-and-fresh");
  });

  const scan = (overrides: Partial<FingerprintScanResult> = {}): FingerprintScanResult => ({
    tool: REMEDIATION_MANIFEST.inventory.generator,
    exitCode: 0,
    zeroOccurrences: true,
    positiveControl: true,
    observedAt: REMEDIATION_AT + 1000,
    refsScanned: REFS,
    ...overrides,
  });

  const integrity = (overrides: Partial<RewriteIntegrityRecord> = {}): RewriteIntegrityRecord => ({
    commitCountBefore: 398,
    commitCountAfter: 398,
    metadataDigestEqual: true,
    topologyDigestEqual: true,
    candidateTreeIdentical: true,
    refsRewritten: REFS,
    repoUsable: true,
    ...overrides,
  });

  const inventoryAfter = (overrides: Partial<InventoryArtifactLike> = {}): InventoryArtifactLike => ({
    present: true,
    generatedBy: REMEDIATION_MANIFEST.inventory.generator,
    verifiedAt: REMEDIATION_AT + 2000,
    fingerprint: FINGERPRINT,
    blobPaths: [...REMEDIATION_MANIFEST.inventory.requiredBlobPaths],
    historyCommits: 398,
    carrierCommits: 0,
    refs: REMEDIATION_MANIFEST.affectedRefs.map((entry) => ({
      ref: entry.ref,
      affected: false,
      carrierCommits: entry.carrierCommits,
      exposedAtTip: false,
    })),
    ...overrides,
  });

  const a2 = (overrides: Partial<A2PostCheckRequest> = {}) =>
    evaluateA2PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      scan: scan(),
      inventoryAfter: inventoryAfter(),
      integrity: integrity(),
      candidateBranchAfter: BRANCH,
      ...overrides,
    });

  it("a complete post-rewrite verification passes, and satisfies the release gate's A2", () => {
    const result = a2();
    expect(result.verified).toBe(true);
    expect(result.evidenceSource).toBe("external-verification");

    const record = remediationEvidenceRecord({
      operation: "A2",
      postCheck: result,
      candidateCommit: "cafe1234",
      observedAt: NOW,
    });
    expect(record.status).toBe("VERIFIED");
    expect(record.subject?.refs).toEqual(REFS);

    const verdict = evaluateRelease(
      {
        candidate: { commit: "cafe1234", ref: `heads/${BRANCH}` },
        affectedRefs: [...REFS],
        requiredProviders: [],
        records: [
          record,
          ...RELEASE_PREREQUISITES.filter((entry) => entry.id !== "A2_HISTORY_REWRITE").map(
            (entry) => ({
              prerequisite: entry.id,
              status: "UNVERIFIED" as const,
              source: "documentation" as const,
              environment: "production" as const,
              observedAt: now(),
            }),
          ),
        ],
      },
      { prerequisites: RELEASE_PREREQUISITES, now: now() },
    );
    function now() {
      return NOW;
    }
    // A2 is satisfied by the contract's output; the other four still block it.
    expect(verdict.prerequisites.find((entry) => entry.id === "A2_HISTORY_REWRITE")?.state).toBe(
      "VERIFIED",
    );
    expect(verdict.verdict).toBe("NOT READY");
  });

  it("a scan without a positive control proves nothing", () => {
    const result = a2({ scan: scan({ positiveControl: false }) });
    expect(result.verified).toBe(false);
    expect(result.failed).toContain("a2-post-positive-control");
  });

  it("a scan or inventory produced before the rewrite describes the old history", () => {
    const staleScan = a2({
      scan: scan({ observedAt: REMEDIATION_AT - 1000 }),
    });
    expect(staleScan.verified).toBe(false);
    expect(staleScan.failed).toContain("a2-post-zero-occurrences");
    expect(staleScan.checks.map((check) => check.detail).join(" ")).toContain("predates the rewrite");
  });

  it("a surviving ref, a missing ref or an unexpected ref fails the per-ref check", () => {
    const stillAffected = a2({
      inventoryAfter: inventoryAfter({
        refs: inventoryAfter().refs.map((entry) =>
          entry.ref === "heads/main" ? { ...entry, affected: true } : entry,
        ),
      }),
    });
    expect(stillAffected.failed).toContain("a2-post-per-ref-verified");

    const missing = a2({
      inventoryAfter: inventoryAfter({
        refs: inventoryAfter().refs.filter((entry) => entry.ref !== "tags/rc-181"),
      }),
    });
    expect(missing.failed).toContain("a2-post-per-ref-verified");

    const extra = a2({
      inventoryAfter: inventoryAfter({
        refs: [
          ...inventoryAfter().refs,
          { ref: "heads/elsewhere", affected: false, carrierCommits: 0, exposedAtTip: false },
        ],
      }),
    });
    expect(extra.failed).toContain("a2-post-per-ref-verified");

    // A scan that did not look at every ref cannot certify that every ref is clean.
    const uncovered = a2({
      scan: scan({ refsScanned: REFS.filter((ref) => ref !== "tags/rc-181") }),
    });
    expect(uncovered.verified).toBe(false);
    expect(uncovered.failed).toContain("a2-post-per-ref-verified");
    expect(uncovered.checks.map((check) => check.detail).join(" ")).toContain(
      "did not cover every manifest ref",
    );
  });

  it("carriers that remain reachable, a broken history or a rewritten main all fail", () => {
    expect(a2({ inventoryAfter: inventoryAfter({ carrierCommits: 3 }) }).failed).toContain(
      "a2-post-no-carrier",
    );
    expect(a2({ integrity: integrity({ commitCountAfter: 397 }) }).failed).toContain(
      "a2-post-history-consistency",
    );
    expect(a2({ integrity: integrity({ refsRewritten: ["heads/main"] }) }).failed).toContain(
      "a2-post-history-consistency",
    );
    expect(a2({ candidateBranchAfter: "main" }).failed).toContain("a2-post-candidate-branch");
  });

  it("26/27/28. the same input gives the same answer, and damaged manifests fail closed", () => {
    expect(JSON.stringify(a2())).toBe(JSON.stringify(a2()));

    const damaged = JSON.parse(JSON.stringify(REMEDIATION_MANIFEST)) as RemediationManifest;
    damaged.affectedRefs = [];
    const repository: RepositoryObservation = {
      workdir: "/repo",
      branch: BRANCH,
      head: "cafe1234",
      remoteName: "origin",
      remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
      shallow: false,
      worktreeClean: true,
      historyCommitCount: 400,
    };
    expect(evaluateA2Readiness({ repository, inventory: inventoryAfter(), expectedCandidate: "cafe1234", evidence: [], now: NOW, manifest: damaged }).outcome).toBe("NOT_READY");

    const contradictory = JSON.parse(JSON.stringify(REMEDIATION_MANIFEST)) as RemediationManifest;
    contradictory.repository.expectedBranch = "main";
    expect(
      evaluateA1Readiness({
        manifest: contradictory,
        repository,
        declared: { issuer: ISSUER, fingerprint: FINGERPRINT },
        externalIssuerAccess: "available",
        evidence: [],
        now: NOW,
      }).outcome,
    ).toBe("NOT_READY");
  });

  it("24. readiness and completion are different states, never the same flag", () => {
    const ready = evaluateA1Readiness({
      repository: {
        workdir: "/repo",
        branch: BRANCH,
        head: "cafe1234",
        remoteName: "origin",
        remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
        shallow: false,
        worktreeClean: true,
        historyCommitCount: 400,
      },
      declared: { issuer: ISSUER, fingerprint: FINGERPRINT },
      externalIssuerAccess: "available",
      evidence: REMEDIATION_MANIFEST.a1Requirements
        .filter((requirement) => requirement.phase === "pre")
        .map((requirement) => ({
          requirementId: requirement.id,
          source: requirement.acceptableSources[0] as RemediationEvidenceRecord["source"],
          observedAt: NOW - 1000,
          subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
        })),
      now: NOW,
    });

    expect(ready.outcome).toBe("READY_TO_REVOKE");
    expect(ready.ready).toBe(true);
    expect(ready.verified).toBe(false);
    expect(ready.remediationPerformed).toBe(false);

    const completion: PostCheckResult = evaluateA1PostCheck({
      remediationAt: REMEDIATION_AT,
      now: NOW,
      evidence: postRecords(),
    });
    // The two states are produced by different functions from different evidence.
    expect(completion.verified).toBe(true);
    expect(JSON.stringify(ready)).not.toContain("a1-post-");
  });
});
