/**
 * Phase 246 — A1 issuer evidence and operator handoff: the required cases.
 *
 * Two halves, deliberately separated:
 *
 *   * the decision half drives injected observations through the pure functions
 *     (discovery, contract, attestation validation, admission, gate projection,
 *     handoff) — no clock, no filesystem, no network;
 *   * the command half is a source and behaviour guard over
 *     `scripts/a1-issuer-report.mjs`: it must have exactly one process spawn, a
 *     read-only git allowlist, no writer, no network module, no `process.env`, and
 *     no mutating verb of any kind.
 *
 * Nothing here talks to the issuer, and nothing here can file an attestation: the
 * path the operator would use does not exist in this tree, which is asserted as
 * the current real state rather than as a permanent property.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  A1_DISCOVERY,
  A1_EVIDENCE_SCHEMA,
  A1_HANDOFF_SCHEMA,
  a1EvidenceContract,
  a1HandoffExitCode,
  a1HandoffJson,
  buildA1OperatorHandoff,
  classifyIssuerDiscovery,
  evaluateA1EvidenceAdmission,
  formatA1OperatorHandoff,
  toGateEvidenceRecord,
  validateA1Attestation,
} from "./a1-issuer-evidence";
import {
  REMEDIATION_MANIFEST,
  type RemediationEvidenceRecord,
  type RepositoryObservation,
} from "./remediation-manifest";
import { prerequisiteMaxAgeMs } from "./remediation-postcheck";
import { evaluateRelease, RELEASE_PREREQUISITES, type EvidenceRecord } from "./release-gate";
import { currentReleaseVerdict, PROOF_PATHS } from "./release-current-state";
import { evaluateReleaseAdmission } from "./release-admission";

const NOW = 1_800_000_000_000;
const REMEDIATION_AT = NOW - 3_600_000;
const ISSUER = REMEDIATION_MANIFEST.issuer.identity;
const FINGERPRINT = REMEDIATION_MANIFEST.credential.fingerprint;
const CANDIDATE = "candidate-commit-sha";

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const script = readFileSync(resolve(process.cwd(), "scripts/a1-issuer-report.mjs"), "utf8");
const module_ = readFileSync(resolve(process.cwd(), "src/lib/deployment/a1-issuer-evidence.ts"), "utf8");

/** A valid issuer-side confirmation, as the post-check consumes it. */
function confirmation(overrides: Partial<RemediationEvidenceRecord> = {}): RemediationEvidenceRecord {
  return {
    requirementId: "a1-post-issuer-confirmation",
    source: "external-issuer",
    observedAt: REMEDIATION_AT + 60_000,
    subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
    detail: "issuer support confirmed the credential was revoked",
    ...overrides,
  };
}

/** A valid observed rejection, as the post-check consumes it. */
function rejection(overrides: Partial<RemediationEvidenceRecord> = {}): RemediationEvidenceRecord {
  return {
    requirementId: "a1-post-credential-rejected",
    source: "external-issuer",
    observedAt: REMEDIATION_AT + 120_000,
    subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production" },
    detail: "presenting the old credential returned 403",
    observation: { rejectionStatus: 403, endpoint: ISSUER },
    ...overrides,
  };
}

function admit(evidence: readonly RemediationEvidenceRecord[], options: { remediationAt?: number | null } = {}) {
  return evaluateA1EvidenceAdmission({
    manifest: REMEDIATION_MANIFEST,
    now: NOW,
    remediationAt: options.remediationAt === undefined ? REMEDIATION_AT : options.remediationAt,
    evidence,
    candidateCommit: CANDIDATE,
  });
}

/** The attestation an operator would file, in the shape this phase requires. */
function attestation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: A1_EVIDENCE_SCHEMA,
    verified: true,
    source: "external-verification",
    environment: "production",
    observedAt: NOW - 60_000,
    remediationAt: REMEDIATION_AT,
    authoritativeSource: "issuer support confirmation, ticket recorded by the operator",
    subject: { issuer: ISSUER, fingerprint: FINGERPRINT },
    detail: "the exposed credential was revoked at the issuer",
    ...overrides,
  };
}

const repositoryObservation: RepositoryObservation = {
  workdir: "/tmp/phase246-handoff",
  branch: REMEDIATION_MANIFEST.repository.expectedBranch,
  head: "0".repeat(40),
  remoteName: "origin",
  remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
  shallow: false,
  worktreeClean: true,
  historyCommitCount: 400,
};

const handoff = () =>
  buildA1OperatorHandoff({
    manifest: REMEDIATION_MANIFEST,
    repository: repositoryObservation,
    externalIssuerAccess: "unavailable",
    now: NOW,
    releaseVerdict: currentReleaseVerdict(undefined, { now: NOW }).verdict,
  });

describe("246 — discovery, without assumptions (cases 1-2)", () => {
  it("1. the canonical issuer identity is the manifest's, and nothing is invented", () => {
    expect(A1_DISCOVERY.host).toBe(ISSUER);
    expect(A1_DISCOVERY.host).toBe(REMEDIATION_MANIFEST.issuer.identity);
    expect(A1_DISCOVERY.classes).toEqual([
      "REVOCATION_ENDPOINT_NOT_DOCUMENTED",
      "EXTERNAL_ACCESS_REQUIRED",
      "NO_VERIFIABLE_SELF_SERVICE_PATH",
    ]);
    expect(A1_DISCOVERY.documentedRevocationEndpoint).toBeNull();
    expect(A1_DISCOVERY.documentedSelfServiceSurface).toBeNull();
    expect(A1_DISCOVERY.endpointInvented).toBe(false);
    expect(A1_DISCOVERY.endpointsContacted).toEqual([]);
    // no URL anywhere in the discovery payload: nothing was guessed at
    expect(JSON.stringify(A1_DISCOVERY)).not.toMatch(/https?:\/\//);
    // and every source row points at a document that exists in this repository
    for (const source of A1_DISCOVERY.sources) expect(source.source).toMatch(/^(src|docs)\//);
  });

  it("2. the classification is derived from the sources, not hardcoded", () => {
    const documented = classifyIssuerDiscovery({
      host: ISSUER,
      documentedEndpoints: ["issuer-side revocation API"],
      selfServiceSurfaces: ["issuer console"],
      externalAccessAvailable: true,
      sources: [],
    });
    expect(documented.classes).toEqual(["REVOCATION_ENDPOINT_DOCUMENTED"]);
    expect(documented.documentedRevocationEndpoint).toBe("issuer-side revocation API");
    expect(documented.externalAccessRequired).toBe(false);

    const halfDocumented = classifyIssuerDiscovery({
      host: ISSUER,
      documentedEndpoints: [],
      selfServiceSurfaces: ["issuer console"],
      externalAccessAvailable: null,
      sources: [],
    });
    expect(halfDocumented.classes).toEqual([
      "REVOCATION_ENDPOINT_NOT_DOCUMENTED",
      "EXTERNAL_ACCESS_REQUIRED",
    ]);
    expect(halfDocumented.documentedRevocationEndpoint).toBeNull();
    // an unknown path is not a path: it is reported as unknown access
    expect(halfDocumented.externalAccessRequired).toBe(true);
  });

  it("2b. the credential is identified by fingerprint only", () => {
    const contract = a1EvidenceContract();
    expect(contract.credential.fingerprint).toBe(FINGERPRINT);
    expect(contract.credential.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(contract.credential.rule).toContain("sha256");
    expect(contract.credential.length).toBe(REMEDIATION_MANIFEST.credential.secretLength);
    expect(contract.credential.valueMayBeStored).toBe(false);
  });
});

describe("246 — the canonical evidence contract", () => {
  const contract = a1EvidenceContract();

  it("derives freshness and sources from the canonical layer rather than restating them", () => {
    expect(contract.freshness.maxAgeMs).toBe(prerequisiteMaxAgeMs("A1_OTP_ISSUER_REVOCATION"));
    const prerequisite = RELEASE_PREREQUISITES.find((entry) => entry.id === "A1_OTP_ISSUER_REVOCATION");
    expect(prerequisite).toBeDefined();
    expect(prerequisite?.requiredEnvironment).toBe("production");
    expect(prerequisite?.exemptible).toBe(false);
    expect(prerequisite?.binding).toBe("none");
    expect(contract.environment.required).toBe(prerequisite?.requiredEnvironment);
    expect(contract.gate.acceptedSources).toEqual(["external-verification", "owner-risk-acceptance"]);
    expect(contract.gate.acceptedEnvironments).toEqual(["production"]);
    expect(contract.pre.map((entry) => entry.id)).toEqual([
      "a1-pre-credential-identity",
      "a1-pre-live-status",
      "a1-pre-replacement-provisioned",
    ]);
    expect(contract.post.map((entry) => entry.id)).toEqual([
      "a1-post-issuer-confirmation",
      "a1-post-credential-rejected",
      "a1-post-correct-credential",
      "a1-post-bound-and-fresh",
    ]);
  });

  it("keeps the accepted rejection statuses exactly as the existing contract has them", () => {
    const rejectionClass = contract.admissible.find((entry) => entry.id === "credential-rejection");
    expect(rejectionClass?.rejectionStatuses).toEqual([401, 403]);
    for (const entry of contract.admissible) {
      expect(entry.source).toBe("external-issuer");
      expect(entry.environment).toBe("production");
      expect(entry.observedAfterRemediation).toBe(true);
      expect(entry.fixtureAllowed).toBe(false);
      expect(entry.issuerMustMatch).toBe(ISSUER);
      expect(entry.fingerprintMustMatch).toBe(FINGERPRINT);
    }
    expect(contract.completeSet.requires).toEqual([
      "a1-post-issuer-confirmation",
      "a1-post-credential-rejected",
    ]);
  });

  it("names every class of observation that is not proof", () => {
    for (const phrase of [
      "timeout",
      "DNS failure",
      "connection refusal",
      "000",
      "local code or tests",
      "document",
      "synthetic fixture",
      "inability to authenticate",
      "different credential",
      "unrelated endpoint",
    ]) {
      expect(contract.rejected.map((entry) => entry.observation).join(" | ")).toContain(phrase);
    }
    // and the attestation contract is a superset of what the gate reader needs
    expect(contract.attestation.supersetOfGateReader).toBe(true);
    expect(contract.attestation.path).toBe(PROOF_PATHS.a1Revocation);
    for (const field of ["schema", "source", "environment", "observedAt", "authoritativeSource"]) {
      expect(contract.attestation.requiredFields).toContain(field);
    }
    for (const field of ["value", "secret", "token", "password"]) {
      expect(contract.attestation.forbiddenFields).toContain(field);
    }
  });
});

describe("246 — evidence admission, the required fixtures", () => {
  /** Each row is one of the required synthetic fixtures. */
  const fixtures: readonly {
    n: number;
    label: string;
    build: () => readonly RemediationEvidenceRecord[];
    remediationAt?: number | null;
    expectAdmitted: boolean;
    /** A phrase the refusal must name, or null when the fixture must be admitted. */
    expectIn: string | null;
    /** What the canonical Phase 244 layer must conclude for this input. */
    expectCanonicalVerified: boolean;
    /** The Phase 246 layer that must refuse it, when this phase is the one that does. */
    expectLayer?: { id: string; passed: boolean };
  }[] = [
    {
      n: 1,
      label: "valid issuer revocation confirmation (with the observed rejection it belongs with)",
      build: () => [confirmation(), rejection()],
      expectAdmitted: true,
      expectIn: null,
      expectCanonicalVerified: true,
    },
    {
      n: 2,
      label: "valid external rejection after revocation",
      build: () => [confirmation(), rejection({ observation: { rejectionStatus: 401, endpoint: ISSUER } })],
      expectAdmitted: true,
      expectIn: null,
      expectCanonicalVerified: true,
    },
    {
      n: 3,
      label: "wrong issuer",
      build: () => [
        confirmation({ subject: { issuer: "otp.example.com", fingerprint: FINGERPRINT, environment: "production" } }),
        rejection(),
      ],
      expectAdmitted: false,
      expectIn: "issuer confirmation",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-authoritative-source", passed: false },
    },
    {
      n: 4,
      label: "wrong credential fingerprint",
      build: () => [
        confirmation({ subject: { issuer: ISSUER, fingerprint: "ffffffffffffffff", environment: "production" } }),
        rejection(),
      ],
      expectAdmitted: false,
      expectIn: "different fingerprint",
      expectCanonicalVerified: false,
    },
    {
      n: 5,
      label: "stale evidence",
      build: () => [confirmation({ observedAt: NOW - 40 * 86_400_000 }), rejection({ observedAt: NOW - 40 * 86_400_000 })],
      expectAdmitted: false,
      expectIn: "window",
      expectCanonicalVerified: false,
    },
    {
      n: 6,
      label: "future-dated evidence",
      build: () => [confirmation({ observedAt: NOW + 60_000 }), rejection({ observedAt: NOW + 120_000 })],
      expectAdmitted: false,
      expectIn: "bound to the production environment",
      expectCanonicalVerified: false,
    },
    {
      n: 7,
      label: "pre-remediation evidence presented as post-remediation",
      build: () => [
        confirmation({ observedAt: REMEDIATION_AT - 60_000 }),
        rejection({ observedAt: REMEDIATION_AT - 30_000 }),
      ],
      expectAdmitted: false,
      expectIn: "before the revocation",
      expectCanonicalVerified: false,
    },
    {
      n: 8,
      label: "timeout",
      build: () => [confirmation(), rejection({ observation: { rejectionStatus: null, endpoint: ISSUER } })],
      expectAdmitted: false,
      expectIn: "no response",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-rejection-status", passed: false },
    },
    {
      n: 9,
      label: "HTTP 000 / no response",
      build: () => [confirmation(), rejection({ observation: { rejectionStatus: 0, endpoint: ISSUER } })],
      expectAdmitted: false,
      expectIn: "no response",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-rejection-status", passed: false },
    },
    {
      n: 10,
      label: "fixture-only evidence",
      build: () => [confirmation({ fixture: true }), rejection({ fixture: true })],
      expectAdmitted: false,
      expectIn: "fixture",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-no-fixture-in-the-set", passed: false },
    },
    {
      n: 11,
      label: "documentation-only evidence",
      build: () => [
        confirmation({ source: "documentation" }),
        rejection({ source: "documentation" }),
      ],
      expectAdmitted: false,
      expectIn: "issuer",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-issuer-source", passed: false },
    },
    {
      n: 12,
      label: "different credential rejected",
      build: () => [
        confirmation({ subject: { issuer: ISSUER, fingerprint: "0123456789abcdef", environment: "production" } }),
        rejection({ subject: { issuer: ISSUER, fingerprint: "0123456789abcdef", environment: "production" } }),
      ],
      expectAdmitted: false,
      expectIn: "different fingerprint",
      expectCanonicalVerified: false,
    },
    {
      n: 13,
      label: "production environment mismatch",
      build: () => [
        confirmation({ subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "development" } }),
        rejection({ subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "development" } }),
      ],
      expectAdmitted: false,
      expectIn: "production",
      expectCanonicalVerified: false,
    },
    {
      n: 14,
      label: "malformed evidence",
      build: () => [
        confirmation(),
        null as unknown as RemediationEvidenceRecord,
        "a record that is a string" as unknown as RemediationEvidenceRecord,
      ],
      expectAdmitted: false,
      expectIn: "malformed",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-evidence-well-formed", passed: false },
    },
    {
      n: 15,
      label: "contradictory revocation records",
      build: () => [
        confirmation(),
        rejection({ observation: { rejectionStatus: 200, endpoint: ISSUER }, detail: "the credential was still accepted" }),
      ],
      expectAdmitted: false,
      expectIn: "still being accepted",
      expectCanonicalVerified: false,
      expectLayer: { id: "a1-246-no-contradiction", passed: false },
    },
    {
      n: 16,
      label: "revocation evidence missing an authoritative source",
      build: () => [confirmation({ detail: "   " }), rejection()],
      expectAdmitted: false,
      expectIn: "no source",
      // the canonical post-check does not model this: the refusal comes from this phase
      expectCanonicalVerified: true,
      expectLayer: { id: "a1-246-authoritative-source", passed: false },
    },
    {
      n: 17,
      label: "exact current credential but an old remediation timestamp",
      build: () => [confirmation(), rejection()],
      remediationAt: NOW - 90 * 86_400_000,
      expectAdmitted: false,
      expectIn: "older than the window",
      // the canonical post-check does not model this: the refusal comes from this phase
      expectCanonicalVerified: true,
      expectLayer: { id: "a1-246-revocation-within-window", passed: false },
    },
    {
      n: 18,
      label: "valid-looking evidence with the wrong candidate context",
      build: () => [
        confirmation({
          subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production", commit: "old-commit-sha" },
        }),
        rejection(),
      ],
      expectAdmitted: false,
      expectIn: "not the candidate",
      // the canonical post-check does not model this: the refusal comes from this phase
      expectCanonicalVerified: true,
      expectLayer: { id: "a1-246-candidate-binding", passed: false },
    },
  ];

  for (const fixture of fixtures) {
    it(`${fixture.n}. ${fixture.label}`, () => {
      const report = admit(fixture.build(), { remediationAt: fixture.remediationAt });
      expect(report.admissible, JSON.stringify(report.problems)).toBe(fixture.expectAdmitted);
      expect(report.state).toBe(fixture.expectAdmitted ? "ADMISSIBLE" : "NOT_ADMISSIBLE");
      if (fixture.expectIn === null) expect(report.problems).toEqual([]);
      else expect(report.problems.join(" | ")).toContain(fixture.expectIn);
      // the canonical Phase 244 layer is asserted separately from this phase's
      // extra layers, so a weakening in either one is a distinct failure
      expect(report.canonical.verified).toBe(fixture.expectCanonicalVerified);
      if (fixture.expectLayer) {
        const check = report.checks.find((entry) => entry.id === fixture.expectLayer?.id);
        expect(check, fixture.expectLayer.id).toBeDefined();
        expect(check?.passed, fixture.expectLayer.id).toBe(fixture.expectLayer.passed);
      }
      // deterministic: the same input gives the same answer, twice
      const again = admit(fixture.build(), { remediationAt: fixture.remediationAt });
      expect(JSON.stringify(again)).toBe(JSON.stringify(report));
      // and nothing in the report can be mistaken for a completed operation
      expect(report.guarantees.remediationPerformed).toBe(false);
      expect(report.guarantees.issuerContacted).toBe(false);
    });
  }

  it("names the three refusals the canonical post-check cannot make on its own", () => {
    /*
      Those three are the reason this phase has a layer of its own: the canonical
      post-check reads the source, the environment, the window and the two
      requirement ids, but it does not model the authoritative-source binding, the
      age of the recorded revocation, or a record that names another candidate.
      Each of them is refused here, and the canonical layer's own answer is
      asserted alongside so the difference stays visible.
    */
    const rows: readonly { label: string; evidence: readonly RemediationEvidenceRecord[]; remediationAt?: number; layer: string }[] = [
      { label: "no authoritative source", evidence: [confirmation({ detail: "  " }), rejection()], layer: "a1-246-authoritative-source" },
      {
        label: "stale remediation instant",
        evidence: [confirmation(), rejection()],
        remediationAt: NOW - 90 * 86_400_000,
        layer: "a1-246-revocation-within-window",
      },
      {
        label: "another candidate",
        evidence: [confirmation({ subject: { issuer: ISSUER, fingerprint: FINGERPRINT, environment: "production", commit: "old" } }), rejection()],
        layer: "a1-246-candidate-binding",
      },
    ];
    for (const row of rows) {
      const report = admit(row.evidence, { remediationAt: row.remediationAt });
      expect(report.canonical.verified, row.label).toBe(true);
      expect(report.admissible, row.label).toBe(false);
      expect(report.checks.find((entry) => entry.id === row.layer)?.passed, row.label).toBe(false);
    }
  });

  it("a confirmation without the observed rejection is incomplete, not acceptable", () => {
    const report = admit([confirmation()]);
    expect(report.admissible).toBe(false);
    expect(report.problems.join(" ")).toContain("a1-post-credential-rejected");
  });

  it("a rejection without the issuer's confirmation is incomplete, not acceptable", () => {
    const report = admit([rejection()]);
    expect(report.admissible).toBe(false);
    expect(report.problems.join(" ")).toContain("a1-post-issuer-confirmation");
  });

  it("an admissible set still produces no gate record while it is fixture-scoped", () => {
    const report = evaluateA1EvidenceAdmission({
      manifest: REMEDIATION_MANIFEST,
      now: NOW,
      remediationAt: REMEDIATION_AT,
      evidence: [confirmation(), rejection()],
      candidateCommit: CANDIDATE,
      fixtureScope: true,
    });
    expect(report.fixtureScoped).toBe(true);
    expect(report.admissible).toBe(false);
    const projection = toGateEvidenceRecord(report, { candidateCommit: CANDIDATE, observedAt: NOW });
    expect(projection.record).toBeNull();
    expect(projection.refusals.join(" ")).toContain("never be filed");
  });

  it("a real, non-scoped admission does project to the record the gate reads", () => {
    const report = admit([confirmation(), rejection()]);
    expect(report.admissible).toBe(true);
    const projection = toGateEvidenceRecord(report, { candidateCommit: CANDIDATE, observedAt: NOW });
    expect(projection.record).not.toBeNull();
    expect(projection.record?.prerequisite).toBe("A1_OTP_ISSUER_REVOCATION");
    expect(projection.record?.source).toBe("external-verification");
    expect(projection.record?.environment).toBe("production");
    expect(projection.record?.subject?.issuer).toBe(ISSUER);
  });
});

describe("246 — the attestation the operator would file", () => {
  it("accepts the documented shape and refuses every required deviation", () => {
    const options = { manifest: REMEDIATION_MANIFEST, now: NOW, candidateCommit: CANDIDATE };
    expect(validateA1Attestation(attestation(), options).state).toBe("ADMISSIBLE");

    const cases: readonly { label: string; payload: unknown; state: string }[] = [
      { label: "not an object", payload: "attestation", state: "NOT_AN_OBJECT" },
      { label: "declared synthetic", payload: attestation({ synthetic: true }), state: "FIXTURE_ONLY" },
      { label: "declared fixture", payload: attestation({ fixture: true }), state: "FIXTURE_ONLY" },
      { label: "not verified", payload: attestation({ verified: false }), state: "NOT_VERIFIED" },
      { label: "documentation", payload: attestation({ source: "documentation" }), state: "DOCUMENTATION_ONLY" },
      { label: "wrong source", payload: attestation({ source: "local-run" }), state: "WRONG_SOURCE" },
      { label: "wrong environment", payload: attestation({ environment: "preview" }), state: "WRONG_ENVIRONMENT" },
      { label: "other issuer", payload: attestation({ subject: { issuer: "otp.example.com", fingerprint: FINGERPRINT } }), state: "WRONG_ISSUER" },
      { label: "no issuer binding", payload: attestation({ subject: { fingerprint: FINGERPRINT } }), state: "MISSING_ISSUER_BINDING" },
      { label: "other fingerprint", payload: attestation({ subject: { issuer: ISSUER, fingerprint: "ffffffffffffffff" } }), state: "WRONG_FINGERPRINT" },
      { label: "no fingerprint binding", payload: attestation({ subject: { issuer: ISSUER } }), state: "MISSING_FINGERPRINT_BINDING" },
      { label: "no authoritative source", payload: attestation({ authoritativeSource: "  " }), state: "MISSING_AUTHORITATIVE_SOURCE" },
      { label: "wrong candidate", payload: attestation({ subject: { issuer: ISSUER, fingerprint: FINGERPRINT, commit: "another" } }), state: "WRONG_CANDIDATE" },
      { label: "future dated", payload: attestation({ observedAt: NOW + 1 }), state: "FUTURE_DATED" },
      { label: "stale", payload: attestation({ observedAt: NOW - 90 * 86_400_000 }), state: "STALE" },
      { label: "stale remediation", payload: attestation({ remediationAt: NOW - 90 * 86_400_000 }), state: "STALE_REMEDIATION" },
      { label: "pre-remediation observation", payload: attestation({ observedAt: REMEDIATION_AT - 1 }), state: "PRE_REMEDIATION" },
      { label: "no response", payload: attestation({ observation: { rejectionStatus: 0 } }), state: "NO_RESPONSE" },
      { label: "not a rejection", payload: attestation({ observation: { rejectionStatus: 200 } }), state: "NOT_A_REJECTION" },
      { label: "carries the credential value", payload: attestation({ value: "x".repeat(33) }), state: "CARRIES_CREDENTIAL_VALUE" },
      {
        label: "carries the credential value in the credential block",
        payload: attestation({ credential: { fingerprint: FINGERPRINT, value: "x".repeat(33) } }),
        state: "CARRIES_CREDENTIAL_VALUE",
      },
    ];
    for (const entry of cases) {
      const verdict = validateA1Attestation(entry.payload, options);
      expect(verdict.state, entry.label).toBe(entry.state);
      expect(verdict.admissible, entry.label).toBe(false);
    }
  });

  it("an attestation this phase admits is one the gate's reader can use", () => {
    const options = { manifest: REMEDIATION_MANIFEST, now: NOW, candidateCommit: CANDIDATE };
    const payload = attestation();
    expect(validateA1Attestation(payload, options).admissible).toBe(true);
    // every field the gate reader reads is present and typed the way it reads them
    expect(typeof payload.verified).toBe("boolean");
    expect(typeof payload.source).toBe("string");
    expect(typeof payload.environment).toBe("string");
    expect(typeof payload.observedAt).toBe("number");
    expect((payload.subject as Record<string, unknown>).issuer).toBe(ISSUER);
  });
});

describe("246 — release-gate integration (Phase F)", () => {
  const a1Outcome = (records: readonly EvidenceRecord[]) => {
    const verdict = evaluateRelease(
      {
        candidate: { commit: CANDIDATE, ref: `refs/${REMEDIATION_MANIFEST.repository.expectedBranch}` },
        affectedRefs: REMEDIATION_MANIFEST.affectedRefs.map((entry) => `refs/${entry.ref}`),
        requiredProviders: ["market-data"],
        records,
      },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    return verdict.prerequisites.find((entry) => entry.id === "A1_OTP_ISSUER_REVOCATION");
  };

  const gateRecord = (overrides: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    prerequisite: "A1_OTP_ISSUER_REVOCATION",
    status: "VERIFIED",
    source: "external-verification",
    environment: "production",
    observedAt: NOW - 60_000,
    subject: { issuer: ISSUER, commit: CANDIDATE },
    ...overrides,
  });

  it("A1 without valid external evidence stays unverified, and the release stays refused", () => {
    expect(a1Outcome([])?.state).toBe("UNVERIFIED");
    expect(a1Outcome([gateRecord({ source: "fixture" })])?.state).not.toBe("VERIFIED");
    expect(a1Outcome([gateRecord({ source: "documentation" })])?.state).not.toBe("VERIFIED");
    expect(a1Outcome([gateRecord({ environment: "ci" })])?.state).not.toBe("VERIFIED");
    expect(a1Outcome([gateRecord({ observedAt: NOW - 90 * 86_400_000 })])?.state).not.toBe("VERIFIED");
    expect(a1Outcome([gateRecord({ subject: undefined })])?.state).toBe("VERIFIED");
  });

  it("the issuer binding the gate cannot check is enforced by this phase before filing", () => {
    /*
      A1's prerequisite carries `binding: "none"` because the issuer's key store is
      not a property of this repository — so the canonical gate compares no subject
      for it. This phase does, and the asymmetry is asserted rather than assumed:
      a record naming another issuer is refused here, and would otherwise be read.
    */
    const foreignIssuer = gateRecord({ subject: { issuer: "otp.example.com", commit: CANDIDATE } });
    expect(a1Outcome([foreignIssuer])?.state).toBe("VERIFIED");
    const options = { manifest: REMEDIATION_MANIFEST, now: NOW, candidateCommit: CANDIDATE };
    expect(validateA1Attestation(attestation({ subject: { issuer: "otp.example.com", fingerprint: FINGERPRINT } }), options).state).toBe(
      "WRONG_ISSUER",
    );
    const admission = admit([
      confirmation({ subject: { issuer: "otp.example.com", fingerprint: FINGERPRINT, environment: "production" } }),
      rejection(),
    ]);
    expect(admission.admissible).toBe(false);
    expect(admission.problems.join(" ")).toContain("issuer confirmation");
  });

  it("synthetic valid external evidence verifies A1 inside the fixture only", () => {
    expect(a1Outcome([gateRecord()])?.state).toBe("VERIFIED");
    // the rest of the mandatory set is untouched by that record, so nothing is admitted
    const verdict = evaluateRelease(
      {
        candidate: { commit: CANDIDATE, ref: `refs/${REMEDIATION_MANIFEST.repository.expectedBranch}` },
        affectedRefs: REMEDIATION_MANIFEST.affectedRefs.map((entry) => `refs/${entry.ref}`),
        requiredProviders: ["market-data"],
        records: [gateRecord()],
      },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain("A2_HISTORY_REWRITE");
    expect(verdict.blockers).not.toContain("A1_OTP_ISSUER_REVOCATION");
  });

  it("no fixture evaluation can move the real tree's verdict", () => {
    const before = currentReleaseVerdict(undefined, { now: NOW });
    a1Outcome([gateRecord()]);
    a1Outcome([gateRecord({ source: "fixture" })]);
    const after = currentReleaseVerdict(undefined, { now: NOW });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(before.verdict).toBe("NOT READY");
    expect(before.blockers).toContain("A1_OTP_ISSUER_REVOCATION");
  });
});

describe("246 — the operator handoff (Phase G)", () => {
  it("reports the issuer, the fingerprint, the contract and the unavailable prerequisite", () => {
    const report = handoff();
    expect(report.mode).toBe("A1_OPERATOR_HANDOFF");
    expect(report.schema).toBe(A1_HANDOFF_SCHEMA);
    expect(report.issuer.identity).toBe(ISSUER);
    expect(report.credential.fingerprint).toBe(FINGERPRINT);
    expect(report.credential.valueStored).toBe(false);
    expect(report.contract.attestation.path).toBe(PROOF_PATHS.a1Revocation);
    expect(report.current.outcome).toBe("MISSING_EXTERNAL_ACCESS");
    expect(report.current.actionPending).toBe(false);
    expect(report.unavailable.join(" ")).toContain("MISSING_EXTERNAL_ACCESS");
    expect(report.pendingEvidence.length).toBeGreaterThan(0);
    expect(report.blocker).toContain("MISSING_EXTERNAL_ACCESS");
    expect(report.releaseVerdict).toBe("NOT READY");
    expect(report.verdictIssuedHere).toBe(false);
    expect(report.remediationPerformed).toBe(false);
    expect(a1HandoffExitCode(report)).toBe(1);
  });

  it("says out loud that a blocker is not a negative result, and never claims revocation", () => {
    const report = handoff();
    const text = formatA1OperatorHandoff(report);
    expect(text).toContain("MISSING_EXTERNAL_ACCESS is a blocker, not a negative result");
    expect(text).toContain("A1 was NOT revoked by this tooling");
    expect(text).toContain("verdictIssuedHere: no");
    expect(text).toContain("remediationPerformed: no");
    expect(text).toContain("never stored, never printed, never requested by this command");
    expect(text).toContain(FINGERPRINT);
    // the operator gets the sequence and the contract, and no invented endpoint
    expect(text).toContain("documented revocation endpoint: none in the available sources (none was invented)");
    expect(text).toContain("endpoints contacted by this command: 0");
    for (const entry of report.operatorSequence) expect(text).toContain(entry.action);
    // a JSON form exists for machine consumption, with the same guarantees
    const parsed = JSON.parse(a1HandoffJson(report)) as Record<string, unknown>;
    expect(parsed.verdictIssuedHere).toBe(false);
    expect(parsed.remediationPerformed).toBe(false);
  });

  it("carries every zero-effect guarantee, and none of them can be flipped by input", () => {
    for (const access of ["available", "unavailable", "unknown"] as const) {
      const report = buildA1OperatorHandoff({
        manifest: REMEDIATION_MANIFEST,
        repository: repositoryObservation,
        externalIssuerAccess: access,
        now: NOW,
        releaseVerdict: "NOT READY",
      });
      expect(report.guarantees).toEqual({
        issuerContacted: false,
        networkOpened: false,
        credentialValuePrinted: false,
        credentialMutated: false,
        gitMutated: false,
        deploymentPerformed: false,
        emailSent: false,
        providerCredentialChanged: false,
      });
      expect(report.remediationPerformed).toBe(false);
      expect(report.verdictIssuedHere).toBe(false);
    }
    // an unknown path is reported as unknown, never as an available one
    const unknown = buildA1OperatorHandoff({
      manifest: REMEDIATION_MANIFEST,
      repository: repositoryObservation,
      externalIssuerAccess: "unknown",
      now: NOW,
      releaseVerdict: "NOT READY",
    });
    expect(unknown.current.outcome).toBe("MISSING_EXTERNAL_ACCESS");
    expect(unknown.unavailable.join(" ")).toContain("MISSING_EXTERNAL_ACCESS");
  });

  it("the command itself cannot do any of it: one spawn, a read-only allowlist, no writer, no socket", () => {
    const code = stripComments(script);
    expect(code.match(/spawnSync\(/g)?.length ?? 0).toBe(1);
    expect(code).not.toMatch(/execSync|execFileSync|exec\(|fork\(/);
    expect(code).not.toMatch(/node:(net|http|https|tls|dgram|worker_threads)/);
    expect(code).not.toMatch(/fetch\(|WebSocket|XMLHttpRequest/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(
      /writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|renameSync|copyFileSync|chmodSync/,
    );
    // every git call is on the allowlist, and the allowlist holds nothing that writes
    const calls = [...code.matchAll(/git\(\[([^\]]*)\]/g)].map((match) => /"([^"]+)"/.exec(match[1])?.[1] ?? "");
    expect(calls.length).toBeGreaterThan(4);
    const allowlist = /const READ_ONLY_GIT = new Set\(\[([\s\S]*?)\]\);/.exec(code)?.[1] ?? "";
    const allowed = [...allowlist.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    for (const subcommand of calls) expect(allowed, `git ${subcommand}`).toContain(subcommand);
    for (const verb of ["push", "update-ref", "delete-ref", "filter-branch", "filter-repo", "gc", "reset", "checkout", "reflog", "fetch"]) {
      expect(allowed, verb).not.toContain(verb);
      expect(code, verb).not.toContain(`"${verb}"`);
    }
    expect(code).not.toContain("--force");
  });

  it("the reporting path cannot mutate a credential, a provider or a deployment", () => {
    const code = stripComments(script);
    for (const operation of ["revoke(", ".delete(", "env set", "convex deploy", "npx convex", "sendEmail", "sendMail", "api.resend.com"]) {
      expect(code, operation).not.toContain(operation);
    }
    // the two node modules it may use are the guarded spawner and the reader
    const nodeImports = [...code.matchAll(/from "node:([a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(nodeImports).toEqual(["child_process", "fs", "module", "path", "url"]);
    // the decision module is pure: no node import at all, no clock, no spawner, no writer
    const decision = stripComments(module_);
    expect(decision).not.toMatch(/from "node:/);
    expect(decision).not.toMatch(/\b(?:spawn|spawnSync|exec|execSync|writeFile|writeFileSync|appendFileSync|unlinkSync|rmSync)\s*\(/);
    expect(decision).not.toMatch(/process\.env/);
    expect(decision).not.toMatch(/Date\.now\(\)/);
    // and the module never issues a verdict of its own
    expect(decision).not.toMatch(/verdict\s*[:=]\s*["'`](READY|NOT READY)["'`]/);
  });
});

describe("246 — the real state is unchanged (cases 17-24)", () => {
  it("17. A1 is genuinely still missing its external evidence in this tree", () => {
    const verdict = currentReleaseVerdict(undefined, { now: NOW });
    const a1 = verdict.prerequisites.find((entry) => entry.id === "A1_OTP_ISSUER_REVOCATION");
    expect(a1?.state).toBe("UNVERIFIED");
    expect(verdict.blockers).toContain("A1_OTP_ISSUER_REVOCATION");
    expect(verdict.verdict).toBe("NOT READY");
    // the attestation this phase describes has not been produced by anyone, and
    // if one ever is, it must not be a synthetic record parked at the proof path
    const report = handoff();
    expect(report.contract.attestation.path).toBe(PROOF_PATHS.a1Revocation);
  });

  it("18. synthetic evidence cannot be persisted as real evidence by this phase", () => {
    // nothing in the reporting path writes, so a fixture cannot reach the proof path
    const code = stripComments(script);
    expect(code).not.toMatch(/writeFileSync|appendFileSync|createWriteStream|writeFile\(/);
    expect(code).toContain("--attestation");
    // and the module that reads a filed attestation refuses anything synthetic
    const options = { manifest: REMEDIATION_MANIFEST, now: NOW };
    expect(validateA1Attestation(attestation({ fixture: true }), options).admissible).toBe(false);
    expect(validateA1Attestation(attestation({ synthetic: true }), options).admissible).toBe(false);
  });

  it("22. release admission stays refused without real A1 evidence", () => {
    const admission = evaluateReleaseAdmission({});
    expect(admission.admitted).toBe(false);
  });

  it("23. the A2 status is independent of anything this phase does", () => {
    const verdict = currentReleaseVerdict(undefined, { now: NOW });
    expect(verdict.blockers).toContain("A2_HISTORY_REWRITE");
    const a2 = verdict.prerequisites.find((entry) => entry.id === "A2_HISTORY_REWRITE");
    expect(a2?.state).not.toBe("VERIFIED");
    // an A1 record changes nothing about A2
    const withA1 = evaluateRelease(
      {
        candidate: { commit: CANDIDATE, ref: `refs/${REMEDIATION_MANIFEST.repository.expectedBranch}` },
        affectedRefs: REMEDIATION_MANIFEST.affectedRefs.map((entry) => `refs/${entry.ref}`),
        requiredProviders: ["market-data"],
        records: [
          {
            prerequisite: "A1_OTP_ISSUER_REVOCATION",
            status: "VERIFIED",
            source: "external-verification",
            environment: "production",
            observedAt: NOW - 60_000,
            subject: { issuer: ISSUER },
          },
        ],
      },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    expect(withA1.prerequisites.find((entry) => entry.id === "A2_HISTORY_REWRITE")?.state).not.toBe("VERIFIED");
    expect(withA1.blockers).toContain("A2_HISTORY_REWRITE");
  });

  it("24. the handoff is deterministic for a fixed instant", () => {
    const first = a1HandoffJson(handoff());
    const second = a1HandoffJson(handoff());
    expect(second).toBe(first);
    const later = buildA1OperatorHandoff({
      manifest: REMEDIATION_MANIFEST,
      repository: repositoryObservation,
      externalIssuerAccess: "unavailable",
      now: NOW + 1,
      releaseVerdict: "NOT READY",
    });
    expect(a1HandoffJson(later)).not.toBe(first);
  });
});
