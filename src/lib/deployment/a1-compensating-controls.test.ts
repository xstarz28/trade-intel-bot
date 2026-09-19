/**
 * A1 compensating-controls path: issuer unavailable, revocation not claimed.
 *
 * The file the owner would file is unfiled in this tree. These cases prove the
 * evaluator, the observer, and the reader — they do not file the attestation
 * and they do not satisfy the release gate on this checkout.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  A1_COMPENSATING_PREREQUISITE,
  A1_COMPENSATING_PROOF_PATH,
  A1_COMPENSATING_SCHEMA,
  A1_RUNTIME_CONTROL_PATHS,
  a1CompensatingControlsToEvidence,
  compensatingControlsProven,
  emptyA1CompensatingAssessment,
  evaluateA1CompensatingControls,
  observeA1RuntimeControls,
} from "./a1-compensating-controls";
import { a1EvidenceContract } from "./a1-issuer-evidence";
import { EXPOSED_CREDENTIAL } from "./remediation-manifest";
import {
  deriveCurrentReleaseState,
  PROOF_PATHS,
  type FactSource,
} from "./release-current-state";
import { RELEASE_PREREQUISITES, verifyingSourcesFor } from "./release-gate";

const NOW = 1_800_000_000_000;
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function realControlFiles(): Record<string, string> {
  return {
    "src/convex/auth/emailOtp.ts": read("src/convex/auth/emailOtp.ts"),
    "src/convex/lib/emailDelivery.ts": read("src/convex/lib/emailDelivery.ts"),
    "src/convex/lib/issuerPolicy.ts": read("src/convex/lib/issuerPolicy.ts"),
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: A1_COMPENSATING_SCHEMA,
    prerequisite: A1_COMPENSATING_PREREQUISITE,
    kind: "compensating-controls",
    source: "owner-risk-acceptance",
    environment: "production",
    issuer: "auth.freebuff.app",
    fingerprint: EXPOSED_CREDENTIAL.fingerprint,
    accepted: true,
    acceptedBy: "project-owner",
    acceptedAt: NOW - 60_000,
    rationale: "Issuer access is unavailable; Xstarz runtime no longer calls the leaked host.",
    residualRisk:
      "The leaked credential is not revoked at the issuer and remains valid in every clone, fork, CI cache and GitHub pull ref.",
    revocationClaimed: false,
    issuerContacted: false,
    ...overrides,
  };
}

function assess(
  body: unknown,
  controls = observeA1RuntimeControls(realControlFiles()),
  extra: { candidateCommit?: string; now?: number } = {},
) {
  return evaluateA1CompensatingControls(body, {
    now: extra.now ?? NOW,
    controls,
    candidateCommit: extra.candidateCommit,
  });
}

function memorySource(files: Record<string, string>): FactSource {
  return {
    exists: (path) => path in files,
    read: (path) => {
      const body = files[path];
      if (body === undefined) throw new Error(`no such file: ${path}`);
      return body;
    },
  };
}

describe("A1 compensating-controls — runtime observer", () => {
  it("the current Xstarz runtime independently proves the compensating controls", () => {
    const obs = observeA1RuntimeControls(realControlFiles());
    expect(obs.problems).toEqual([]);
    expect(compensatingControlsProven(obs)).toBe(true);
    expect(obs.neverCallsFreebuffHost).toBe(true);
    expect(obs.usesXstarzEmailAbstraction).toBe(true);
    expect(obs.retiredIssuersRefusedInProduction).toBe(true);
    expect(obs.productionEmailFailsClosed).toBe(true);
    expect(obs.noFreebuffOtpFallback).toBe(true);
  });

  it("a restored Freebuff OTP call is not a compensating control", () => {
    const files = realControlFiles();
    files["src/convex/auth/emailOtp.ts"] = files["src/convex/auth/emailOtp.ts"].replace(
      "sendXstarzVerificationEmail",
      "send_otp",
    );
    files["src/convex/auth/emailOtp.ts"] += "\nfetch(\"https://auth.freebuff.app/send_otp\");\n";
    const obs = observeA1RuntimeControls(files);
    expect(compensatingControlsProven(obs)).toBe(false);
    expect(obs.neverCallsFreebuffHost).toBe(false);
    expect(obs.problems.join(" ")).toMatch(/auth\.freebuff\.app|send_otp/);
  });

  it("missing runtime sources cannot be filled in by the attestation", () => {
    const obs = observeA1RuntimeControls({});
    expect(compensatingControlsProven(obs)).toBe(false);
    expect(obs.problems.length).toBe(A1_RUNTIME_CONTROL_PATHS.length);
  });
});

describe("A1 compensating-controls — evaluator", () => {
  it("an unfiled payload is not admissible and never claims revocation", () => {
    const empty = emptyA1CompensatingAssessment(NOW);
    expect(empty.outcome).toBe("NOT_FILED");
    expect(empty.admissible).toBe(false);
    expect(empty.revocationClaimed).toBe(false);
    expect(empty.issuerContacted).toBe(false);
    expect(empty.remediationPerformed).toBe(false);
    expect(assess(null).outcome).toBe("NOT_FILED");
  });

  it("a complete owner filing against proven controls is admissible and does not claim revocation", () => {
    const report = assess(payload());
    expect(report.outcome).toBe("ADMISSIBLE");
    expect(report.admissible).toBe(true);
    expect(report.controlsProven).toBe(true);
    expect(report.ownerAcceptanceComplete).toBe(true);
    expect(report.revocationClaimed).toBe(false);
    expect(report.issuerContacted).toBe(false);
    expect(report.remediationPerformed).toBe(false);
    const record = a1CompensatingControlsToEvidence(report);
    expect(record.status).toBe("VERIFIED");
    expect(record.source).toBe("owner-risk-acceptance");
    expect(record.environment).toBe("production");
    expect(record.detail).not.toMatch(/revoked|401|403/);
    expect(record.detail).toMatch(/revocation is not claimed/);
  });

  it("revocationClaimed true is refused as a revocation claim, not accepted as A1", () => {
    const report = assess(payload({ revocationClaimed: true }));
    expect(report.outcome).toBe("CLAIMS_REVOCATION");
    expect(report.admissible).toBe(false);
    expect(a1CompensatingControlsToEvidence(report).status).toBe("BLOCKED");
  });

  it("an http 401/403 on this path is refused — that belongs on issuer evidence", () => {
    expect(assess(payload({ httpStatus: 401 })).outcome).toBe("CLAIMS_REVOCATION");
    expect(assess(payload({ httpStatus: 403 })).outcome).toBe("CLAIMS_REVOCATION");
    expect(assess(payload({ issuerContacted: true })).outcome).toBe("CLAIMS_REVOCATION");
  });

  it("every credential-shaped field name is forbidden content", () => {
    const keys = [
      "credential",
      "secret",
      "apiKey",
      "api_key",
      "x-api-key",
      "token",
      "password",
      "value",
    ] as const;
    for (const key of keys) {
      const report = assess(payload({ [key]: "x".repeat(33) }));
      expect(report.outcome, key).toBe("FORBIDDEN_CONTENT");
      expect(report.admissible, key).toBe(false);
    }
  });

  it("a nested credential-shaped field is forbidden, not extra metadata", () => {
    expect(assess(payload({ extra: { value: "x".repeat(33) } })).outcome).toBe("FORBIDDEN_CONTENT");
    expect(assess(payload({ extra: { apiKey: "x".repeat(33) } })).outcome).toBe("FORBIDDEN_CONTENT");
    expect(assess(payload({ nested: [{ token: "x".repeat(33) }] })).outcome).toBe("FORBIDDEN_CONTENT");
    expect(assess(payload({ extra: { value: "x".repeat(33) } })).admissible).toBe(false);
  });

  it("harmless extra metadata cannot change Path C gate semantics", () => {
    const report = assess(payload({ ticket: "owner-note-1", controlsProven: true }));
    expect(report.outcome).toBe("ADMISSIBLE");
    expect(report.revocationClaimed).toBe(false);
    const record = a1CompensatingControlsToEvidence(report);
    expect(record.prerequisite).toBe(A1_COMPENSATING_PREREQUISITE);
    expect(record.source).toBe("owner-risk-acceptance");
    expect(record.detail).not.toMatch(/revoked|401|403/);
    expect(record.detail).toMatch(/revocation is not claimed/);
  });

  it("incorrect schema identity fields are refused", () => {
    expect(assess(payload({ schema: "phase246.a1-evidence/v1" })).outcome).toBe("MALFORMED");
    expect(assess(payload({ prerequisite: "A2_HISTORY_REWRITE" })).outcome).toBe("MALFORMED");
    expect(assess(payload({ kind: "issuer-revocation" })).outcome).toBe("MALFORMED");
    expect(assess(payload({ source: "external-verification" })).outcome).toBe("MALFORMED");
    expect(assess(payload({ environment: "development" })).outcome).toBe("MALFORMED");
    expect(assess(payload({ issuer: "auth.example.app" })).outcome).toBe("MALFORMED");
  });

  it("owner acceptance without the owner, the rationale, residual risk, or acceptedAt is incomplete", () => {
    expect(assess(payload({ accepted: false })).outcome).toBe("OWNER_ACCEPTANCE_INCOMPLETE");
    expect(assess(payload({ acceptedBy: "  " })).outcome).toBe("OWNER_ACCEPTANCE_INCOMPLETE");
    expect(assess(payload({ rationale: "too short" })).outcome).toBe("OWNER_ACCEPTANCE_INCOMPLETE");
    expect(assess(payload({ residualRisk: "" })).outcome).toBe("OWNER_ACCEPTANCE_INCOMPLETE");
    const withoutAcceptedAt = payload();
    delete withoutAcceptedAt.acceptedAt;
    expect(assess(withoutAcceptedAt).outcome).toBe("MALFORMED");
    expect(assess(withoutAcceptedAt).admissible).toBe(false);
  });

  it("a filing that asserts controlsProven true is still refused when observation fails", () => {
    const report = assess(payload({ controlsProven: true }), observeA1RuntimeControls({}));
    expect(report.outcome).toBe("CONTROLS_INCOMPLETE");
    expect(report.admissible).toBe(false);
    expect(report.controlsProven).toBe(false);
  });

  it("a fixture, a future stamp, a stale stamp, and a wrong fingerprint are refused", () => {
    expect(assess(payload({ fixture: true })).outcome).toBe("MALFORMED");
    expect(assess(payload({ acceptedAt: NOW + 1 })).outcome).toBe("FUTURE_DATED");
    expect(assess(payload({ acceptedAt: NOW - 40 * 24 * 60 * 60 * 1000 })).outcome).toBe("STALE");
    expect(assess(payload({ fingerprint: "ffffffffffffffff" })).outcome).toBe("MALFORMED");
  });

  it("a wrong commit is the wrong subject", () => {
    const report = assess(payload({ commit: "deadbeef" }), undefined, { candidateCommit: "cafe" });
    expect(report.outcome).toBe("WRONG_SUBJECT");
    expect(report.admissible).toBe(false);
  });
});

describe("A1 compensating-controls — gate contract", () => {
  it("A1 lists owner-risk-acceptance; no other mandatory prerequisite does", () => {
    const a1 = RELEASE_PREREQUISITES.find((entry) => entry.id === A1_COMPENSATING_PREREQUISITE);
    expect(a1?.exemptible).toBe(false);
    expect(verifyingSourcesFor(a1!)).toEqual(["external-verification", "owner-risk-acceptance"]);
    for (const entry of RELEASE_PREREQUISITES) {
      if (entry.id === A1_COMPENSATING_PREREQUISITE) continue;
      expect(verifyingSourcesFor(entry)).toEqual(["external-verification"]);
    }
    expect(a1EvidenceContract().gate.acceptedSources).toEqual([
      "external-verification",
      "owner-risk-acceptance",
    ]);
  });
});

describe("A1 compensating-controls — current tree and reader", () => {
  it("the compensating-controls file is unfiled, and A1 stays UNVERIFIED", () => {
    expect(PROOF_PATHS.a1CompensatingControls).toBe(A1_COMPENSATING_PROOF_PATH);
    expect(existsSync(resolve(root, A1_COMPENSATING_PROOF_PATH))).toBe(false);
    const { facts, verdict } = deriveCurrentReleaseState();
    expect(facts.proofFilesPresent).not.toContain(A1_COMPENSATING_PROOF_PATH);
    const a1 = verdict.prerequisites.find((entry) => entry.id === A1_COMPENSATING_PREREQUISITE);
    expect(a1?.state).toBe("UNVERIFIED");
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(A1_COMPENSATING_PREREQUISITE);
    expect(verdict.blockers).toContain("A2_HISTORY_REWRITE");
  });

  it("an in-memory filing against the real sources verifies A1 and does not verify A2 or the release", () => {
    const inventory = JSON.stringify({
      refs: [
        { ref: "heads/one", affected: true, exposedAtTip: false },
        { ref: "heads/two", affected: true, exposedAtTip: false },
      ],
    });
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        [PROOF_PATHS.a1CompensatingControls]: JSON.stringify(payload()),
        ...realControlFiles(),
      }),
      { now: NOW, commit: "WORKTREE" },
    );
    const a1 = state.verdict.prerequisites.find((entry) => entry.id === A1_COMPENSATING_PREREQUISITE);
    expect(a1?.state).toBe("VERIFIED");
    expect(state.verdict.blockers).not.toContain(A1_COMPENSATING_PREREQUISITE);
    expect(state.verdict.prerequisites.find((entry) => entry.id === "A2_HISTORY_REWRITE")?.state).not.toBe(
      "VERIFIED",
    );
    expect(state.verdict.verdict).toBe("NOT READY");
    expect(state.facts.proofFilesPresent).toContain(A1_COMPENSATING_PROOF_PATH);
    // the real tree was not written
    expect(existsSync(resolve(root, A1_COMPENSATING_PROOF_PATH))).toBe(false);
  });

  it("an in-memory filing without the runtime sources is BLOCKED, not VERIFIED", () => {
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.a1CompensatingControls]: JSON.stringify(payload()),
      }),
      { now: NOW },
    );
    const a1 = state.verdict.prerequisites.find((entry) => entry.id === A1_COMPENSATING_PREREQUISITE);
    expect(a1?.state).toBe("BLOCKED");
    expect(state.verdict.verdict).toBe("NOT READY");
  });
});

describe("A1 compensating-controls — purity", () => {
  it("the decision module has no I/O, no clock, no credential value, and issues no verdict", () => {
    const source = read("src/lib/deployment/a1-compensating-controls.ts");
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/Date\.now\s*\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/writeFile|appendFile|fetch\(/);
    expect(source).not.toMatch(/\badmitted\b/);
    expect(source).not.toMatch(/verdict\s*[:=]\s*["'`](READY|NOT READY)["'`]/);
    expect(source).not.toMatch(/b1ce18a1e85ba121.{8,}/);
  });
});
