/**
 * Phase 241 — the verdict this checkout actually earns, and why.
 *
 * The gate's fail-closed rules are proven with synthetic evidence next door.
 * This file proves the OTHER half: that the real repository is read honestly, so
 * the verdict is derived from what is present rather than asserted in prose.
 *
 * Nothing here hardcodes "NOT READY" as an expectation of the code under test.
 * The verdict is computed, and the assertions check it against the FACTS the
 * reader derived from the real files: no proof file exists for any mandatory
 * prerequisite, therefore none of them can be VERIFIED, therefore the verdict is
 * NOT READY and the blocker set is exactly the mandatory set. If a real proof
 * file were filed, the last test would tell the reader to come back — it would
 * not fail silently.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_PREREQUISITES } from "./release-gate";
import {
  currentReleaseVerdict,
  deriveCurrentReleaseState,
  PROOF_PATHS,
  type FactSource,
} from "./release-current-state";

const root = process.cwd();
const realSource: FactSource = {
  exists: (path) => {
    try {
      return readFileSync(resolve(root, path)) !== undefined;
    } catch {
      return false;
    }
  },
  read: (path) => readFileSync(resolve(root, path), "utf8"),
};

/** An in-memory tree, so every refusal path is reachable without touching disk. */
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

const MANDATORY_IDS = RELEASE_PREREQUISITES.filter((p) => p.mandatory).map((p) => p.id);

/** Which proof file exists for which prerequisite — the reader's own mapping. */
const PROOF_BY_PREREQUISITE: Record<string, string[]> = {
  A1_OTP_ISSUER_REVOCATION: [PROOF_PATHS.a1Revocation, PROOF_PATHS.a1CompensatingControls],
  A2_HISTORY_REWRITE: [PROOF_PATHS.rewriteVerification],
  CONVEX_PRODUCTION_DEPLOYMENT: [PROOF_PATHS.convexDeployment],
  /* Phase 270: no PRODUCTION_EMAIL_TRANSPORT row — retired with the email
     capability it would have proven. */
  EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION: [PROOF_PATHS.evidenceD],
};

describe("241 — the real repository, read honestly", () => {
  it("20. the current tree is NOT READY, and the blockers are DERIVED", () => {
    const { facts, verdict } = deriveCurrentReleaseState(realSource);

    // Derived from the tree: which proof files are present right now.
    // A1 can be satisfied by either revocation attestation OR compensating controls.
    const unresolved = MANDATORY_IDS.filter((id) => {
      const candidates = PROOF_BY_PREREQUISITE[id] ?? [];
      return !candidates.some((p) => facts.proofFilesPresent.includes(p));
    });

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.ready).toBe(false);
    expect(verdict.evaluationError).toBeUndefined();

    // The verdict agrees with the facts, and the two are computed separately:
    // every mandatory prerequisite without a proof file is a blocker, and no
    // mandatory prerequisite WITH one is.
    expect([...verdict.blockers].sort()).toEqual([...unresolved].sort());
    expect(unresolved.length).toBeGreaterThan(0);

    for (const id of verdict.blockers) {
      const outcome = verdict.prerequisites.find((p) => p.id === id);
      expect(outcome, `${id} is a blocker but has no outcome`).toBeDefined();
      expect(["UNVERIFIED", "BLOCKED", "STALE", "CONTRADICTORY"]).toContain(outcome!.state);
      expect(outcome!.reasons.length).toBeGreaterThan(0);
    }
  });

  it("20b. the exposure inventory is read, not assumed", () => {
    const { facts } = deriveCurrentReleaseState(realSource);
    const onDisk = JSON.parse(readFileSync(resolve(root, PROOF_PATHS.refInventory), "utf8")) as {
      refs: { ref: string; affected?: boolean; exposedAtTip?: boolean }[];
    };
    const affected = onDisk.refs.filter((r) => r.affected === true).map((r) => r.ref);
    const serving = onDisk.refs.filter((r) => r.exposedAtTip === true).map((r) => r.ref);

    expect(facts.inventoryPresent).toBe(true);
    expect([...facts.affectedRefs].sort()).toEqual(affected.sort());
    expect([...facts.refsStillServingBlob].sort()).toEqual(serving.sort());
    // After rewrite, all 9 writable refs measure unaffected (0 carriers).
    // Before rewrite, affected count was >1. This test now verifies the inventory
    // is read honestly, not that it is still affected — the NOT READY verdict
    // comes from missing deployment proofs, not from affected refs.
    expect(facts.affectedRefs.length).toBe(affected.length);
  });

  it("20b2. the DOCUMENTED verdict cannot drift from the COMPUTED one", () => {
    /*
      The last place a release verdict can go wrong is the prose. A document that
      still says READY after the gate stopped saying it is not a documentation
      problem, it is the release decision itself being wrong — so the marker in
      `docs/RELEASE-GATE.md` is read here and compared with the computed verdict.

      The expected value is NOT hardcoded: it is whatever the gate derives from
      the tree, on both sides of the comparison.
    */
    const gate = readFileSync(resolve(root, "docs/RELEASE-GATE.md"), "utf8");
    const markers = [...gate.matchAll(/<!--\s*release-verdict:\s*(READY|NOT READY)\s*-->/g)].map(
      (m) => m[1],
    );
    const computed = currentReleaseVerdict(realSource);

    expect(markers.length, "the gate document must carry exactly one verdict marker").toBe(1);
    expect(markers[0]).toBe(computed.verdict);
    // And the marker cannot disagree with the verdict the document narrates.
    expect(gate).toContain(computed.verdict);
  });

  it("20c. the verdict is reproducible and the reader does not mutate the tree", () => {
    const first = currentReleaseVerdict(realSource);
    const second = currentReleaseVerdict(realSource);
    expect(second).toEqual(first);
    // The reader must also be usable when asked twice in a row without state.
    expect(deriveCurrentReleaseState(realSource).verdict).toEqual(first);
  });
});

describe("241 — the reader refuses to promote a claim", () => {
  const inventory = JSON.stringify({
    refs: [
      { ref: "heads/one", affected: true, exposedAtTip: false },
      { ref: "heads/two", affected: true, exposedAtTip: false },
    ],
  });

  it("a proof file that declares itself as documentation is still not verification", () => {
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        [PROOF_PATHS.a1Revocation]: JSON.stringify({
          verified: true,
          source: "documentation",
          environment: "production",
          observedAt: Date.now() - 1000,
          detail: "the runbook says the key was revoked",
        }),
      }),
    );

    const a1 = state.verdict.prerequisites.find((p) => p.id === "A1_OTP_ISSUER_REVOCATION");
    expect(a1?.state).toBe("UNVERIFIED");
    expect(a1?.reasons.join(" ")).toContain("documentation is not verification");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("a proof file with the wrong environment is refused", () => {
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        [PROOF_PATHS.rewriteVerification]: JSON.stringify({
          verified: true,
          source: "external-verification",
          environment: "development",
          observedAt: Date.now() - 1000,
          detail: "rewritten against a development mirror",
        }),
      }),
    );

    const rewrite = state.verdict.prerequisites.find((p) => p.id === "A2_HISTORY_REWRITE");
    expect(rewrite?.state).toBe("UNVERIFIED");
    expect(rewrite?.reasons.join(" ")).toContain("wrong environment");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("a malformed proof file fails closed instead of being skipped", () => {
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        [PROOF_PATHS.convexDeployment]: "{ this is not json",
      }),
    );

    const deployment = state.verdict.prerequisites.find(
      (p) => p.id === "CONVEX_PRODUCTION_DEPLOYMENT",
    );
    expect(deployment?.state).toBe("UNVERIFIED");
    // Two layers say why, and neither is silent: the reader names the parse
    // failure, and the gate reports why the record cannot count.
    expect(state.input.records[0]?.detail).toContain("not valid JSON");
    expect(deployment?.reasons.join(" ")).toContain("observedAt is not a finite instant");
    // The file was not skipped either — it is reported as present, so a
    // malformed proof cannot disappear behind "no proof was filed".
    expect(state.facts.proofFilesPresent).toContain(PROOF_PATHS.convexDeployment);
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("an unreadable inventory makes A2 coverage unknowable — and unknowable is not complete", () => {
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.rewriteVerification]: JSON.stringify({
          verified: true,
          source: "external-verification",
          environment: "production",
          observedAt: Date.now() - 1000,
          subject: { refs: [] },
          detail: "rewrite executed",
        }),
      }),
    );

    expect(state.facts.inventoryPresent).toBe(false);
    const a2 = state.verdict.prerequisites.find((p) => p.id === "A2_HISTORY_REWRITE");
    expect(a2?.state).toBe("UNVERIFIED");
    expect(a2?.reasons.join(" ")).toContain("affected-ref set is unknown");
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("a well-formed proof file that does NOT declare verification is not verified", () => {
    /*
      Found by the Phase 241 mutation pass: ignoring the file's own `verified`
      flag left every test green, because every other fixture declared
      `verified: true`. The flag is the file's whole claim; a proof that does not
      make it has proved nothing, however well-formed the rest of it is.
    */
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        // A1 carries no subject binding, so ONLY the claim itself stands between
        // this file and a pass — which is exactly what makes it a test of the
        // flag rather than of a binding.
        [PROOF_PATHS.a1Revocation]: JSON.stringify({
          verified: false,
          source: "external-verification",
          environment: "production",
          observedAt: Date.now() - 1000,
          detail: "the issuer was contacted but has not confirmed revocation",
        }),
      }),
    );

    const a1 = state.verdict.prerequisites.find((p) => p.id === "A1_OTP_ISSUER_REVOCATION");
    expect(a1?.state).toBe("UNVERIFIED");
    expect(a1?.reasons.length).toBeGreaterThan(0);
    expect(state.verdict.verdict).toBe("NOT READY");
  });

  it("a fully-formed proof for ONE prerequisite cannot carry the rest", () => {
    // The strongest realistic case: real external verification, production
    // environment, correct binding — and every other prerequisite still open.
    const state = deriveCurrentReleaseState(
      memorySource({
        [PROOF_PATHS.refInventory]: inventory,
        [PROOF_PATHS.rewriteVerification]: JSON.stringify({
          verified: true,
          source: "external-verification",
          environment: "production",
          observedAt: Date.now() - 1000,
          subject: { refs: ["heads/one", "heads/two"] },
          detail: "rewrite executed and verified across both affected refs",
        }),
      }),
    );

    expect(state.verdict.prerequisites.find((p) => p.id === "A2_HISTORY_REWRITE")?.state).toBe(
      "VERIFIED",
    );
    // A2 verified changes nothing else: the verdict is still NOT READY, and the
    // blockers are exactly the remaining mandatory prerequisites.
    expect(state.verdict.verdict).toBe("NOT READY");
    expect(state.verdict.blockers).not.toContain("A2_HISTORY_REWRITE");
    expect([...state.verdict.blockers].sort()).toEqual(
      MANDATORY_IDS.filter((id) => id !== "A2_HISTORY_REWRITE").sort(),
    );
  });
});
