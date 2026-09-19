/**
 * Phase 244 — A1 execution readiness (Phase B).
 *
 * The contract under test, stated once:
 *
 *   READY_TO_REVOKE  iff  the issuer is the manifest's, the fingerprint is the
 *   exposed credential's, the repository is the canonical one, every
 *   pre-revocation requirement is satisfied by evidence that could actually
 *   exist — and the only remaining operation is the revocation itself, which
 *   happens outside this repository, by a human who has issuer access.
 *
 * Every input here is synthetic. Nothing contacts the issuer, and no test can
 * make a revocation true by asserting it.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateA1Readiness,
  formatReadinessReport,
  readinessJson,
  type A1ReadinessRequest,
} from "./remediation-readiness";
import type {
  RemediationEvidenceRecord,
  RepositoryObservation,
} from "./remediation-manifest";
import { REMEDIATION_MANIFEST } from "./remediation-manifest";

const NOW = 1_800_000_000_000;
const ISSUER = REMEDIATION_MANIFEST.issuer.identity;
const FINGERPRINT = REMEDIATION_MANIFEST.credential.fingerprint;

const REPOSITORY: RepositoryObservation = {
  workdir: "/repo",
  branch: REMEDIATION_MANIFEST.repository.expectedBranch,
  head: "cafe1234",
  remoteName: "origin",
  remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
  shallow: false,
  worktreeClean: true,
  historyCommitCount: 400,
};

/** The three pre-revocation requirements, satisfied the way they can be. */
function preRecords(): RemediationEvidenceRecord[] {
  return [
    {
      requirementId: "a1-pre-credential-identity",
      source: "local-tooling",
      observedAt: NOW - 3000,
      subject: { fingerprint: FINGERPRINT },
      detail: "fingerprint recomputed from the known blob",
    },
    {
      requirementId: "a1-pre-live-status",
      source: "external-issuer",
      observedAt: NOW - 2000,
      subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
      observation: { endpoint: `https://${ISSUER}/send_otp` },
      detail: "status observed by the operator",
    },
    {
      requirementId: "a1-pre-replacement-provisioned",
      source: "external-issuer",
      observedAt: NOW - 1000,
      subject: { issuer: ISSUER, environment: "production" },
      detail: "replacement credential configured outside source control",
    },
  ];
}

const evaluate = (overrides: Partial<A1ReadinessRequest> = {}) =>
  evaluateA1Readiness({
    repository: REPOSITORY,
    declared: { issuer: ISSUER, fingerprint: FINGERPRINT },
    externalIssuerAccess: "available",
    evidence: preRecords(),
    now: NOW,
    ...overrides,
  });

describe("244 — A1 readiness", () => {
  it("1. correct issuer, correct fingerprint and valid preconditions permit the revocation", () => {
    const report = evaluate();

    expect(report.outcome).toBe("READY_TO_REVOKE");
    expect(report.ready).toBe(true);
    expect(report.evidence.satisfied).toBe(report.evidence.total);
    expect(report.evidence.total).toBeGreaterThan(2);
    expect(report.external.externalOperationRequired).toBe(true);
    expect(report.remainingOperation).toContain(ISSUER);
    expect(report.problems).toEqual([]);
  });

  it("2. a different issuer is refused, even with a perfect fingerprint", () => {
    const report = evaluate({ declared: { issuer: "auth.somewhere-else.example", fingerprint: FINGERPRINT } });

    expect(report.outcome).toBe("WRONG_ISSUER");
    expect(report.ready).toBe(false);
    expect(report.issuer.matches).toBe(false);
    expect(report.remainingOperation).toBeNull();
    expect(report.problems.join(" ")).toContain("leave the credential live");
  });

  it("3. a substituted fingerprint is refused: that is not the credential A1 is about", () => {
    const report = evaluate({ declared: { issuer: ISSUER, fingerprint: "deadbeefdeadbeef" } });

    expect(report.outcome).toBe("WRONG_CREDENTIAL");
    expect(report.credential.matches).toBe(false);
    expect(report.ready).toBe(false);
  });

  it("4. a missing issuer identity or fingerprint is refused as an incomplete precheck", () => {
    for (const declared of [
      { issuer: null, fingerprint: FINGERPRINT },
      { issuer: ISSUER, fingerprint: null },
      { issuer: "  ", fingerprint: FINGERPRINT },
    ]) {
      const report = evaluate({ declared });
      expect(report.outcome, JSON.stringify(declared)).toBe("MISSING_PRECHECK");
      expect(report.ready).toBe(false);
    }
  });

  it("5. an unavailable or unknown external path is reported as the blocker it is", () => {
    for (const access of ["unavailable", "unknown"] as const) {
      const report = evaluate({ externalIssuerAccess: access });
      expect(report.outcome, access).toBe("MISSING_EXTERNAL_ACCESS");
      expect(report.ready).toBe(false);
      expect(report.external.externalOperationRequired).toBe(false);
      expect(report.advisories.join(" ")).toContain("issuer");
    }
  });

  it("5b. missing external access outranks missing pre-evidence, because no evidence creates access", () => {
    const report = evaluate({ externalIssuerAccess: "unavailable", evidence: [] });

    expect(report.outcome).toBe("MISSING_EXTERNAL_ACCESS");
    expect(report.evidence.satisfied).toBe(0);
    expect(report.problems.join(" ")).toContain("self-service revocation surface");
  });

  it("6. a local test run cannot imply revocation", () => {
    const records = preRecords().map((record) =>
      record.requirementId === "a1-pre-live-status" ? { ...record, source: "local-run" as const } : record,
    );
    const report = evaluate({ evidence: records });

    expect(report.outcome).toBe("MISSING_PRECHECK");
    expect(report.evidence.unsatisfied).toContain("a1-pre-live-status");
    expect(
      report.evidence.requirements.find((entry) => entry.id === "a1-pre-live-status")?.detail,
    ).toContain("cannot satisfy");
  });

  it("7. documentation cannot imply revocation", () => {
    const records = preRecords().map((record) =>
      record.requirementId === "a1-pre-live-status"
        ? { ...record, source: "documentation" as const }
        : record,
    );
    expect(evaluate({ evidence: records }).outcome).toBe("MISSING_PRECHECK");
  });

  it("8. a synthetic 'revoked' fixture cannot stand in for issuer evidence", () => {
    const records = preRecords().map((record) =>
      record.requirementId === "a1-pre-live-status" ? { ...record, fixture: true } : record,
    );
    const report = evaluate({ evidence: records });

    expect(report.outcome).toBe("MISSING_PRECHECK");
    expect(
      report.evidence.requirements.find((entry) => entry.id === "a1-pre-live-status")?.detail,
    ).toContain("fixture");
  });

  it("8b. a fixture record cannot satisfy a requirement even when its source is external", () => {
    const report = evaluate({
      evidence: [
        ...preRecords(),
        {
          requirementId: "a1-pre-live-status",
          source: "external-issuer",
          fixture: true,
          observedAt: NOW,
          detail: "synthetic",
        },
      ],
    });
    // The genuine record still satisfies it; the fixture is not what did.
    expect(report.evidence.requirements.find((entry) => entry.id === "a1-pre-live-status")?.satisfied).toBe(true);
    expect(
      evaluate({
        evidence: [
          ...preRecords().filter((record) => record.requirementId !== "a1-pre-live-status"),
          { requirementId: "a1-pre-live-status", source: "external-issuer", fixture: true, observedAt: NOW },
        ],
      }).outcome,
    ).toBe("MISSING_PRECHECK");
  });

  it("11. every pre-revocation requirement must be satisfied, not most of them", () => {
    const report = evaluate({
      evidence: preRecords().filter((record) => record.requirementId !== "a1-pre-replacement-provisioned"),
    });

    expect(report.outcome).toBe("MISSING_PRECHECK");
    expect(report.evidence.unsatisfied).toEqual(["a1-pre-replacement-provisioned"]);
    expect(report.ready).toBe(false);
  });

  it("12. the wrong repository is refused, and main is never a working context", () => {
    const otherRemote = evaluate({
      repository: { ...REPOSITORY, remoteUrl: "https://github.com/someone/else.git" },
    });
    expect(otherRemote.outcome).toBe("WRONG_REPOSITORY");

    const onMain = evaluate({ repository: { ...REPOSITORY, branch: "main" } });
    expect(onMain.outcome).toBe("WRONG_REPOSITORY");
    expect(onMain.problems.join(" ")).toContain("main");
  });

  it("13. a damaged manifest fails closed before anything else is considered", () => {
    const broken = JSON.parse(JSON.stringify(REMEDIATION_MANIFEST)) as typeof REMEDIATION_MANIFEST;
    broken.issuer.identity = "";
    const report = evaluate({ manifest: broken });

    expect(report.outcome).toBe("NOT_READY");
    expect(report.ready).toBe(false);
    expect(report.problems.join(" ")).toContain("issuer");
  });

  it("14. the issuer is compared by host, not by string equality", () => {
    const report = evaluate({ declared: { issuer: `https://${ISSUER}/api/auth`, fingerprint: FINGERPRINT } });

    expect(report.issuer.matches).toBe(true);
    expect(report.outcome).toBe("READY_TO_REVOKE");
  });

  it("15. readiness never claims the operation happened", () => {
    const ready = evaluate();
    const refused = evaluate({ externalIssuerAccess: "unavailable" });

    for (const report of [ready, refused]) {
      expect(report.remediationPerformed).toBe(false);
      expect(report.verified).toBe(false);
      expect(report.external.operationAttempted).toBe(false);
      expect(formatReadinessReport(report)).toContain("remediationPerformed: no");
      expect(formatReadinessReport(report)).toContain("verified: no");
      expect(readinessJson(report)).not.toMatch(/"verified":\s*true/);
    }
    // A ready state points at the remaining operation instead of reporting one.
    expect(ready.remainingOperation).toMatch(/^revoke the credential at/);
    expect(refused.remainingOperation).toBeNull();
  });

  it("15b. the post-revocation requirement is stated, so the operator knows what will be needed", () => {
    const report = evaluate();

    expect(report.postRevocationRequirement).toContain("401/403");
    expect(report.postRevocationRequirement).toMatch(/timeout|not proof/);
  });

  it("16. identical input produces an identical report", () => {
    expect(readinessJson(evaluate())).toBe(readinessJson(evaluate()));
    const fingerprintOnly = { declared: { issuer: ISSUER, fingerprint: "deadbeefdeadbeef" } };
    expect(readinessJson(evaluate(fingerprintOnly))).toBe(readinessJson(evaluate(fingerprintOnly)));
  });
});
