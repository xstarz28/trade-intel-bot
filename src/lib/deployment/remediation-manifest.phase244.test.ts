/**
 * Phase 244 — the canonical A1/A2 remediation manifest (Phase A).
 *
 * These tests couple the manifest to the measurements it quotes. A manifest that
 * drifts from the recorded inventory is worse than no manifest: an operator would
 * scope a rewrite from a list that no longer matches the repository.
 *
 * Nothing here reads the credential, contacts the issuer or writes a ref. The
 * fixture fingerprints are hashes, which is the only form the credential is ever
 * identified by in this repository.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AFFECTED_REF_EXPECTATIONS,
  A1_REQUIREMENTS,
  A2_REQUIREMENTS,
  MEASUREMENT_RECONCILIATION,
  REMEDIATION_MANIFEST,
  REMEDIATION_STAGES,
  REFS_EXPOSED_AT_TIP,
  VERIFICATION_TOOLING,
  manifestProblems,
  repositoryIdentity,
  sameRepository,
  type RemediationManifest,
} from "./remediation-manifest";

const root = process.cwd();
const readDoc = (path: string) => readFileSync(resolve(root, path), "utf8");

interface ArtifactRef {
  ref: string;
  affected: boolean;
  carrierCommits: number;
  exposedAtTip: boolean;
}
interface Artifact {
  generatedBy: string;
  verifiedAt: string;
  fingerprint: string;
  blobPaths: string[];
  historyCommits: number;
  carrierCommits: number;
  refs: ArtifactRef[];
}

const artifact = JSON.parse(
  readDoc("docs/secret-remediation-refs.json"),
) as Artifact;

describe("244 — the manifest is a measurement, not a memory", () => {
  it("is structurally valid, and carries no credential value", () => {
    expect(manifestProblems(REMEDIATION_MANIFEST)).toEqual([]);

    const serialized = JSON.stringify(REMEDIATION_MANIFEST);
    /*
      The credential is identified by fingerprint, and a value could not hide in
      here: every literal run long enough to be a secret (33 characters, the
      credential's measured length) is accounted for — the leaked blob's git
      object hash, which is already public in this repository and in the runbook.
    */
    const accountedFor = new Set([
      REMEDIATION_MANIFEST.credential.blob,
      ...REMEDIATION_MANIFEST.affectedRefs.flatMap((entry) => entry.ref.split("/")),
    ]);
    const unaccounted = [...new Set(serialized.match(/[A-Za-z0-9_-]{33,}/g) ?? [])].filter(
      (run) => !accountedFor.has(run),
    );
    expect(unaccounted).toEqual([]);
    // And the project's own credential-literal rule finds nothing to report.
    expect(serialized).not.toMatch(
      /(api[_-]?key|secret|password|bearer)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i,
    );
    expect(Object.keys(REMEDIATION_MANIFEST.credential)).not.toContain("value");
    expect(REMEDIATION_MANIFEST.credential.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(REMEDIATION_MANIFEST.credential.fingerprintRule).toContain("sha256");
    expect(REMEDIATION_MANIFEST.credential.name).toContain("OTP");
  });

  it("names a repository identity, a branch and an issuer — all explicitly", () => {
    expect(REMEDIATION_MANIFEST.repository.canonical).toBe("xstarz28/trade-intel-bot");
    expect(REMEDIATION_MANIFEST.repository.remoteUrl).toMatch(/^https:\/\/github\.com\//);
    expect(REMEDIATION_MANIFEST.repository.expectedBranch).not.toBe("main");
    expect(REMEDIATION_MANIFEST.repository.forbiddenBranches).toContain("main");
    expect(REMEDIATION_MANIFEST.issuer.identity).toBe("auth.freebuff.app");
    expect(REMEDIATION_MANIFEST.issuer.selfServiceRevocation).toContain("absent");
    expect(REMEDIATION_MANIFEST.issuer.procedure.length).toBeGreaterThan(3);
  });

  it("agrees with the recorded inventory artifact, ref by ref", () => {
    expect(artifact.generatedBy).toBe(REMEDIATION_MANIFEST.inventory.generator);
    expect(artifact.fingerprint).toBe(REMEDIATION_MANIFEST.credential.fingerprint);
    expect([...artifact.blobPaths]).toEqual([...REMEDIATION_MANIFEST.inventory.requiredBlobPaths]);
    expect(artifact.carrierCommits).toBe(REMEDIATION_MANIFEST.credential.carrierCommits);

    const manifestRefs = AFFECTED_REF_EXPECTATIONS.map((entry) => entry.ref).sort();
    expect(artifact.refs.map((entry) => entry.ref).sort()).toEqual(manifestRefs);
    // A deliberate literal pin, not a derivation: the count may only move when a
    // measurement moves it. Phase 249 measured the ninth live ref (01a0b293).
    expect(artifact.refs.length).toBe(9);
    expect(AFFECTED_REF_EXPECTATIONS.length).toBe(9);

    for (const expectation of AFFECTED_REF_EXPECTATIONS) {
      const measured = artifact.refs.find((entry) => entry.ref === expectation.ref);
      expect(measured, expectation.ref).toBeDefined();
      expect(measured?.carrierCommits, expectation.ref).toBe(expectation.carrierCommits);
      expect(measured?.exposedAtTip, expectation.ref).toBe(expectation.exposedAtTip);
      expect(measured?.affected, expectation.ref).toBe(false);
    }

    // The artifact is a measurement of the same history the manifest describes.
    expect(artifact.historyCommits).toBeGreaterThanOrEqual(artifact.carrierCommits);
  });

  it("records every writable ref as 0 carriers after the rewrite, with no tip exposure", () => {
    expect(AFFECTED_REF_EXPECTATIONS.every((entry) => entry.carrierCommits === 0)).toBe(true);
    expect(artifact.refs.every((entry) => entry.affected === false)).toBe(true);
    expect(artifact.refs.every((entry) => entry.exposedAtTip === false)).toBe(true);
    expect([...REFS_EXPOSED_AT_TIP]).toEqual([]);
    expect(artifact.carrierCommits).toBe(269);
  });

  it("points at tooling that exists, and at an artifact that exists", () => {
    for (const tool of Object.values(VERIFICATION_TOOLING)) {
      expect(readDoc(tool).length, tool).toBeGreaterThan(500);
    }
    expect(readDoc(REMEDIATION_MANIFEST.inventory.path).length).toBeGreaterThan(200);
    expect(() => JSON.parse(readDoc(REMEDIATION_MANIFEST.inventory.path))).not.toThrow();
  });

  it("states that the leaked path is clean today while the history is not", () => {
    const current = readDoc(REMEDIATION_MANIFEST.credential.path);
    // The retired issuer host and the retired variable are absent from HEAD...
    expect(current).not.toContain(REMEDIATION_MANIFEST.issuer.identity);
    expect(current).not.toContain("x-api-key");
    for (const name of REMEDIATION_MANIFEST.credential.retiredEnvNames) {
      expect(current).not.toContain(name);
    }
    // ...which is precisely why the manifest records the refs, not the tree.
    expect(REMEDIATION_MANIFEST.credential.carrierCommits).toBe(269);
  });
});

describe("244 — superseded measurements stay visible, with their ruling", () => {
  it("reconciles the shallow-clone audit instead of silently replacing it", () => {
    const affected = MEASUREMENT_RECONCILIATION.find((entry) => entry.fact === "affected commits");
    expect(affected).toBeDefined();
    expect(affected?.superseded).toContain("9");
    expect(affected?.authoritative).toContain("270");
    expect(affected?.reason).toContain("shallow");
    expect(affected?.measuredBy).toBe(VERIFICATION_TOOLING.globalScanner);
  });

  it("reconciles the reachable-commit count as growth, not as a contradiction", () => {
    const reachable = MEASUREMENT_RECONCILIATION.find(
      (entry) => entry.fact === "reachable commits",
    );
    expect(reachable?.superseded).toContain("306");
    expect(reachable?.superseded).toContain("397");
    // Each superseded figure stays visible: the audit trail is the point.
    expect(reachable?.superseded).toContain("398");
    expect(reachable?.superseded).toContain("429");
    expect(reachable?.authoritative).toContain("840");
    expect(reachable?.reason).toMatch(/grows|newest/);
    expect(reachable?.reason).toContain("269");
  });

  it("reconciles the ref set, naming the branches that were missed", () => {
    const refs = MEASUREMENT_RECONCILIATION.find((entry) => entry.fact === "affected refs");
    expect(refs?.superseded).toContain("01a0a92b");
    expect(refs?.superseded).toContain("01a0ad26");
    // Phase 238's count is now itself superseded, and stays visible as such.
    expect(refs?.superseded).toContain("01a0adfb");
    expect(refs?.superseded).toContain("8");
    expect(refs?.authoritative).toContain("9");
    expect(refs?.measuredBy).toBe(VERIFICATION_TOOLING.perRefInventory);
    // The ninth ref is named as measured, and growth is explicitly not progress.
    expect(refs?.reason).toContain("01a0b293");
    expect(refs?.reason).toMatch(/measured, not inferred|not progress/);
    expect(refs?.reason).toContain("270");
  });

  it("reconciles the 'clean tip means remediated' confusion explicitly", () => {
    const tips = MEASUREMENT_RECONCILIATION.find((entry) => entry.fact === "exposed-ref tips");
    expect(tips?.authoritative).toContain("heads/main");
    expect(tips?.authoritative).toContain("phase-157");
    expect(tips?.reason).toMatch(/two different facts|not remediation/);
  });

  it("gives every ruling a reason and a measuring tool", () => {
    expect(MEASUREMENT_RECONCILIATION.length).toBeGreaterThanOrEqual(4);
    for (const entry of MEASUREMENT_RECONCILIATION) {
      expect(entry.reason.length, entry.fact).toBeGreaterThan(40);
      expect(entry.authoritative.length, entry.fact).toBeGreaterThan(0);
      expect(entry.measuredBy.length, entry.fact).toBeGreaterThan(0);
    }
  });
});

describe("244 — the manifest fails closed when it is damaged", () => {
  const mutate = (change: (manifest: RemediationManifest) => void): RemediationManifest => {
    const copy = JSON.parse(JSON.stringify(REMEDIATION_MANIFEST)) as RemediationManifest;
    change(copy);
    return copy;
  };

  it("detects a manifest with no fingerprint", () => {
    const broken = mutate((manifest) => {
      manifest.credential.fingerprint = "";
    });
    expect(manifestProblems(broken).join(" ")).toContain("fingerprint");
  });

  it("detects a manifest with no issuer", () => {
    const broken = mutate((manifest) => {
      manifest.issuer.identity = "";
    });
    expect(manifestProblems(broken).join(" ")).toContain("issuer");
  });

  it("detects an empty or duplicated ref set, and refuses it as 'nothing to do'", () => {
    const empty = mutate((manifest) => {
      manifest.affectedRefs = [];
    });
    expect(manifestProblems(empty).join(" ")).toMatch(/empty/);

    const duplicated = mutate((manifest) => {
      manifest.affectedRefs = [manifest.affectedRefs[0], manifest.affectedRefs[0]];
    });
    expect(manifestProblems(duplicated).join(" ")).toMatch(/duplicates/);
  });

  it("detects an affected ref with no carriers, and a ref that is not qualified", () => {
    const noCarriers = mutate((manifest) => {
      manifest.affectedRefs = [{ ref: "heads/main", carrierCommits: 0, exposedAtTip: true }];
    });
    expect(manifestProblems(noCarriers).join(" ")).toContain("no carrier commits");

    const unqualified = mutate((manifest) => {
      manifest.affectedRefs = [{ ref: "main", carrierCommits: 5, exposedAtTip: false }];
    });
    expect(manifestProblems(unqualified).join(" ")).toContain("qualified ref name");
  });

  it("refuses a manifest whose expected branch is main", () => {
    const broken = mutate((manifest) => {
      manifest.repository.expectedBranch = "main";
    });
    expect(manifestProblems(broken).join(" ")).toContain("never be main");
  });

  it("refuses a manifest missing A1's post-revocation requirement or A2's rollback", () => {
    const noRejection = mutate((manifest) => {
      manifest.a1Requirements = manifest.a1Requirements.filter(
        (entry) => entry.id !== "a1-post-credential-rejected",
      );
    });
    expect(manifestProblems(noRejection).join(" ")).toContain("observed credential rejection");

    const noBackup = mutate((manifest) => {
      manifest.a2Requirements = manifest.a2Requirements.filter(
        (entry) => entry.id !== "a2-pre-backup",
      );
    });
    expect(manifestProblems(noBackup).join(" ")).toContain("rollback evidence");
  });

  it("requires both phases of evidence for both operations", () => {
    for (const requirements of [A1_REQUIREMENTS, A2_REQUIREMENTS]) {
      expect(requirements.filter((entry) => entry.phase === "pre").length).toBeGreaterThan(1);
      expect(requirements.filter((entry) => entry.phase === "post").length).toBeGreaterThan(1);
    }
    expect(A1_REQUIREMENTS.map((entry) => entry.id)).toContain("a1-pre-live-status");
    expect(A2_REQUIREMENTS.map((entry) => entry.id)).toContain("a2-pre-rehearsal");
  });

  it("defines the five-stage workflow with the destructive stage marked external", () => {
    expect([...REMEDIATION_STAGES]).toEqual([
      "PRECHECK",
      "CAPTURE_EVIDENCE",
      "EXPLICIT_OPERATOR_ACTION",
      "POSTCHECK",
      "RELEASE_GATE_REEVALUATION",
    ]);
  });
});

describe("244 — repository identity is host and owner/repo, not a string", () => {
  const canonical = REMEDIATION_MANIFEST.repository.remoteUrl;

  it("accepts every form of the same repository a clone or a runner may record", () => {
    for (const same of [
      "https://github.com/xstarz28/trade-intel-bot.git",
      "https://github.com/xstarz28/trade-intel-bot", // what `actions/checkout` writes
      "https://x-access-token@github.com/xstarz28/trade-intel-bot", // a credentialed runner URL
      "git@github.com:xstarz28/trade-intel-bot.git", // an operator cloning over SSH
      "ssh://git@github.com/xstarz28/trade-intel-bot.git",
      "https://GitHub.com/xstarz28/Trade-Intel-Bot.git",
    ]) {
      expect(sameRepository(canonical, same)).toBe(true);
    }
  });

  it("refuses another host, another owner, another path, and anything unparsable", () => {
    for (const other of [
      "https://github.com/someone-else/trade-intel-bot.git",
      "https://github.com/xstarz28/trade-intel-bot-fork.git",
      "https://gitlab.com/xstarz28/trade-intel-bot.git",
      "https://github.com/xstarz28/trade-intel",
      "/tmp/clone",
      "not a url",
      "",
    ]) {
      expect(sameRepository(canonical, other)).toBe(false);
      expect(repositoryIdentity(other)).not.toBe(repositoryIdentity(canonical));
    }
  });
});
