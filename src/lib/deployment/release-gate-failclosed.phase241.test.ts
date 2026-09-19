/**
 * Phase 241 — the release gate fails closed, in every direction.
 *
 * The contract under test, stated once:
 *
 *   READY  iff  EVERY mandatory prerequisite is explicitly VERIFIED.
 *
 * and therefore: BLOCKED ≠ PASS · SKIPPED ≠ PASS · UNKNOWN ≠ PASS ·
 * DOCUMENTED ≠ VERIFIED · CI GREEN ≠ RELEASE READY · LOCAL SUCCESS ≠ PRODUCTION
 * VERIFICATION.
 *
 * Every test below is a deterministic synthetic input. Nothing here reads the
 * network, the credential issuer or the deployment, and nothing here can make a
 * prerequisite pass by asserting that it did.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateRelease,
  RELEASE_PREREQUISITES,
  type EvidenceRecord,
  type ReleaseInput,
} from "./release-gate";

/** A fixed instant: no wall clock, so freshness is decided, not raced. */
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const A1 = "A1_OTP_ISSUER_REVOCATION";
const A2 = "A2_HISTORY_REWRITE";
const DEPLOY = "CONVEX_PRODUCTION_DEPLOYMENT";
const EMAIL = "PRODUCTION_EMAIL_TRANSPORT";
const EVIDENCE_D = "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION";

const AFFECTED_REFS = ["heads/one", "heads/two", "heads/three"];
const PROVIDERS = ["coingecko", "okx", "twelve-data"];

const CANDIDATE = {
  commit: "cafe1234",
  ref: "heads/arena/01a0adfb-trade-intel-bot",
  productionDeployment: "prod-deployment-1",
};

/** The subject a given prerequisite's evidence must carry to bind correctly. */
function subjectFor(id: string) {
  if (id === A2) return { refs: [...AFFECTED_REFS] };
  if (id === DEPLOY) return { deployment: CANDIDATE.productionDeployment };
  if (id === EVIDENCE_D) return { providers: [...PROVIDERS] };
  return undefined;
}

/** A record that SHOULD satisfy its prerequisite, so tests can perturb it. */
function proof(id: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    prerequisite: id,
    status: "VERIFIED",
    source: "external-verification",
    environment: "production",
    observedAt: NOW - 1000,
    subject: subjectFor(id),
    ...overrides,
  };
}

/** Everything verified — the only shape that may produce READY. */
function allVerified(): EvidenceRecord[] {
  return RELEASE_PREREQUISITES.map((p) => proof(p.id));
}

function input(records: EvidenceRecord[], overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    candidate: { ...CANDIDATE },
    affectedRefs: [...AFFECTED_REFS],
    requiredProviders: [...PROVIDERS],
    records,
    ...overrides,
  };
}

const evaluate = (records: EvidenceRecord[], overrides: Partial<ReleaseInput> = {}) =>
  evaluateRelease(input(records, overrides), { prerequisites: RELEASE_PREREQUISITES, now: NOW });

const stateOf = (records: EvidenceRecord[], id: string) =>
  evaluate(records).prerequisites.find((p) => p.id === id)?.state;

describe("241 — the one shape that may produce READY", () => {
  it("1. every mandatory prerequisite VERIFIED => READY", () => {
    const verdict = evaluate(allVerified());

    expect(verdict.verdict).toBe("READY");
    expect(verdict.ready).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.evaluationError).toBeUndefined();
    // Only the five mandatory prerequisites decide the verdict; nothing else is
    // in the manifest that could gate a release by existing.
    expect(verdict.prerequisites.filter((p) => p.mandatory).map((p) => p.id).sort()).toEqual(
      [A1, A2, DEPLOY, EMAIL, EVIDENCE_D].sort(),
    );
  });

  it("2. one missing prerequisite => NOT READY, naming it", () => {
    const verdict = evaluate(allVerified().filter((r) => r.prerequisite !== DEPLOY));

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toEqual([DEPLOY]);
    expect(verdict.prerequisites.find((p) => p.id === DEPLOY)?.reasons).toContain(
      "no evidence was supplied",
    );
  });

  it("3. one BLOCKED prerequisite => NOT READY", () => {
    const records = allVerified();
    records[0] = proof(A1, { status: "BLOCKED", detail: "issuer has not confirmed revocation" });
    const verdict = evaluate(records);

    expect(verdict.verdict).toBe("NOT READY");
    expect(stateOf(records, A1)).toBe("BLOCKED");
    expect(verdict.blockers).toContain(A1);
  });

  it("4. one STALE prerequisite => NOT READY", () => {
    const stale = NOW - 40 * DAY; // A1/A2 window is 30 days
    const records = allVerified().map((r) =>
      r.prerequisite === A2 ? { ...r, observedAt: stale } : r,
    );

    expect(evaluate(records).verdict).toBe("NOT READY");
    expect(stateOf(records, A2)).toBe("STALE");
  });

  it("5. one CONTRADICTORY prerequisite => NOT READY, and the pass is not preferred", () => {
    const records = [
      ...allVerified(),
      {
        ...proof(EMAIL),
        status: "BLOCKED" as const,
        detail: "the sender was never verified from a real inbox",
      },
    ];

    const verdict = evaluate(records);
    expect(verdict.verdict).toBe("NOT READY");
    // The convenient record is NOT picked: disagreement is reported as such.
    expect(stateOf(records, EMAIL)).toBe("CONTRADICTORY");
    expect(verdict.blockers).toContain(EMAIL);
  });
});

describe("241 — the externally blocked prerequisites cannot be talked past", () => {
  it("6. A1 unresolved => NOT READY even with everything else verified", () => {
    const records = allVerified().filter((r) => r.prerequisite !== A1);
    const verdict = evaluate(records);

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toEqual([A1]);
  });

  it("7. A2 unresolved => NOT READY even with everything else verified", () => {
    const verdict = evaluate(allVerified().filter((r) => r.prerequisite !== A2));

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toEqual([A2]);
  });

  it("7b. a rewrite map that covers only SOME affected refs is a partial rewrite", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === A2 ? proof(A2, { subject: { refs: ["heads/one"] } }) : r,
    );

    expect(evaluate(records).verdict).toBe("NOT READY");
    expect(stateOf(records, A2)).toBe("UNVERIFIED");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === A2)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("partial rewrite");
    expect(reasons.join(" ")).toContain("2 affected ref(s) are not covered");
  });

  it("7c. one successful ref check cannot stand in for the whole ref set", () => {
    // The strongest form: the evidence is genuine, current and externally
    // produced — for one branch. It still does not describe the other two.
    const records = allVerified().map((r) =>
      r.prerequisite === A2
        ? proof(A2, { subject: { refs: AFFECTED_REFS.slice(0, 1) } })
        : r,
    );
    expect(stateOf(records, A2)).not.toBe("VERIFIED");
  });

  it("7d. a missing ref list is not an empty ref list", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === A2 ? proof(A2, { subject: {} }) : r,
    );
    expect(stateOf(records, A2)).toBe("UNVERIFIED");
  });
});

describe("241 — deployment, email and Evidence D gates", () => {
  it("8. production deployment unverified => NOT READY", () => {
    const verdict = evaluate(allVerified().filter((r) => r.prerequisite !== DEPLOY));
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(DEPLOY);
  });

  it("8b. config present but deployment not performed is NOT verification", () => {
    // The candidate declares no production deployment — the actual state of this
    // repository, where the preflight validates configuration, not deployment.
    const records = allVerified();
    const verdict = evaluate(records, {
      candidate: { ...CANDIDATE, productionDeployment: undefined },
    });

    expect(verdict.verdict).toBe("NOT READY");
    const outcome = verdict.prerequisites.find((p) => p.id === DEPLOY);
    // The claim could not bind to anything, so it is unusable evidence — not a
    // pass, and not a silent disappearance either.
    expect(outcome?.state).toBe("UNVERIFIED");
    expect(outcome?.reasons.join(" ")).toContain("no production deployment is declared");
  });

  it("8c. a different production deployment does not satisfy this candidate", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === DEPLOY ? proof(DEPLOY, { subject: { deployment: "prod-deployment-9" } }) : r,
    );
    expect(stateOf(records, DEPLOY)).toBe("UNVERIFIED");
    expect(evaluate(records).verdict).toBe("NOT READY");
  });

  it("9. production email unverified => NOT READY", () => {
    const verdict = evaluate(allVerified().filter((r) => r.prerequisite !== EMAIL));
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(EMAIL);
  });

  it("9b. a local/mock transport is not a production transport", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === EMAIL
        ? proof(EMAIL, { environment: "local", detail: "console transport, mock inbox" })
        : r,
    );
    expect(stateOf(records, EMAIL)).toBe("UNVERIFIED");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === EMAIL)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("wrong environment");
  });

  it("10a. an UNKNOWN required-provider set cannot verify anything", () => {
    /*
      Found by the Phase 241 mutation pass: making the "unknown provider set"
      refusal inert left every test green, because every test supplied a set.
      An unreadable requirement list is not an empty one — if the product does
      not know which providers it depends on, a claim of complete coverage means
      nothing.
    */
    const records = allVerified();
    const verdict = evaluateRelease(input(records, { requiredProviders: [] }), {
      prerequisites: RELEASE_PREREQUISITES,
      now: NOW,
    });

    expect(verdict.verdict).toBe("NOT READY");
    const reasons =
      verdict.prerequisites.find((p) => p.id === EVIDENCE_D)?.reasons.join(" ") ?? "";
    expect(reasons).toContain("required provider set is unknown");
  });

  it("10. an incomplete provider set cannot verify Evidence D", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === EVIDENCE_D
        ? proof(EVIDENCE_D, { subject: { providers: ["okx"] } })
        : r,
    );

    expect(evaluate(records).verdict).toBe("NOT READY");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === EVIDENCE_D)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("incomplete provider set");
    expect(reasons.join(" ")).toContain("coingecko");
  });
});

describe("241 — evidence classes that can never verify production", () => {
  it("11. fixture evidence cannot satisfy production evidence", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === EVIDENCE_D
        ? proof(EVIDENCE_D, { source: "fixture", detail: "recorded provider fixture" })
        : r,
    );
    expect(evaluate(records).verdict).toBe("NOT READY");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === EVIDENCE_D)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("fixture data is not production evidence");
  });

  it("12. local and development evidence cannot satisfy production evidence", () => {
    for (const environment of ["local", "development", "preview", "ci"] as const) {
      const records = allVerified().map((r) =>
        r.prerequisite === A1 ? proof(A1, { environment }) : r,
      );
      expect(stateOf(records, A1), `environment ${environment}`).toBe("UNVERIFIED");
      expect(evaluate(records).verdict).toBe("NOT READY");
    }
  });

  it("13. documentation is not verification, even when it says verified: true", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === A1
        ? proof(A1, { source: "documentation", detail: "docs/RELEASE-GATE.md says it is fixed" })
        : r,
    );
    expect(evaluate(records).verdict).toBe("NOT READY");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === A1)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("documentation is not verification");
  });

  it("14. a green CI run cannot override a release blocker", () => {
    // Every prerequisite verified EXCEPT A1; a CI record vouches for A1 and a
    // suite-wide green claim is supplied. Neither may be counted.
    const records = [
      ...allVerified().filter((r) => r.prerequisite !== A1),
      proof(A1, { source: "ci-run", environment: "ci" }),
    ];
    const verdict = evaluate(records);

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers).toContain(A1);
    // And CI is not a prerequisite at all: it cannot gate, and it cannot pass.
    expect(RELEASE_PREREQUISITES.map((p) => p.id)).not.toContain("CI_GREEN");
  });

  it("15. evidence for the wrong commit, ref set, deployment or provider set is refused", () => {
    const cases: Array<[string, EvidenceRecord]> = [
      [A1, proof(A1, { subject: { commit: "other-commit" } })],
      [A2, proof(A2, { subject: { refs: ["heads/somewhere-else"] } })],
      [DEPLOY, proof(DEPLOY, { subject: { deployment: "prod-deployment-2" } })],
      [EVIDENCE_D, proof(EVIDENCE_D, { subject: { providers: ["okx", "coingecko"] } })],
    ];
    for (const [id, record] of cases) {
      const records = allVerified().map((r) => (r.prerequisite === id ? record : r));
      expect(evaluate(records).verdict, id).toBe("NOT READY");
      expect(stateOf(records, id), id).not.toBe("VERIFIED");
    }
  });

  it("15b. commit-bound evidence must match the candidate commit", () => {
    // A synthetic manifest exercises the binding the real one does not use yet,
    // so the rule is covered rather than merely written.
    const manifest = [
      {
        ...RELEASE_PREREQUISITES[0],
        id: "COMMIT_BOUND",
        binding: "candidate-commit" as const,
      },
    ];
    const wrong = evaluateRelease(
      input([{ ...proof(A1), prerequisite: "COMMIT_BOUND", subject: { commit: "deadbeef" } }]),
      { prerequisites: manifest, now: NOW },
    );
    const right = evaluateRelease(
      input([
        { ...proof(A1), prerequisite: "COMMIT_BOUND", subject: { commit: CANDIDATE.commit } },
      ]),
      { prerequisites: manifest, now: NOW },
    );

    expect(wrong.verdict).toBe("NOT READY");
    expect(wrong.prerequisites[0]?.reasons.join(" ")).toContain("wrong commit");
    expect(right.verdict).toBe("READY");
  });
});

describe("241 — malformed, unknown and failing input", () => {
  it("16. malformed evidence fails closed and never throws", () => {
    const malformed: EvidenceRecord[] = [
      proof(A1, { observedAt: Number.NaN }),
      proof(A2, { observedAt: "yesterday" as unknown as number }),
      proof(DEPLOY, { status: "PASS" as unknown as EvidenceRecord["status"] }),
      proof(EMAIL, { source: "hope" as unknown as EvidenceRecord["source"] }),
      null as unknown as EvidenceRecord,
    ];

    const verdict = evaluate(malformed);
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers.length).toBeGreaterThanOrEqual(4);
    // No throw, and no accidental pass hidden inside the malformed set.
    expect(verdict.prerequisites.every((p) => p.state !== "VERIFIED")).toBe(true);
  });

  it("16b. a future-dated proof is not a proof", () => {
    const records = allVerified().map((r) =>
      r.prerequisite === A1 ? proof(A1, { observedAt: NOW + DAY }) : r,
    );
    expect(evaluate(records).verdict).toBe("NOT READY");
    expect(stateOf(records, A1)).toBe("STALE");
    const reasons = evaluate(records).prerequisites.find((p) => p.id === A1)?.reasons ?? [];
    expect(reasons.join(" ")).toContain("future-dated");
  });

  it("17. an exception during evaluation fails closed, naming the error", () => {
    const hostile = {
      get prerequisite() {
        throw new Error("hostile evidence object");
      },
      status: "VERIFIED",
    } as unknown as EvidenceRecord;

    const verdict = evaluate([...allVerified(), hostile]);
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.ready).toBe(false);
    expect(verdict.evaluationError).toContain("hostile evidence object");
  });

  it("17b. an empty evidence object is NOT READY, not vacuously READY", () => {
    const verdict = evaluate([]);
    expect(verdict.verdict).toBe("NOT READY");
    expect([...verdict.blockers].sort()).toEqual([A1, A2, DEPLOY, EMAIL, EVIDENCE_D].sort());
  });

  it("17c. an empty manifest is an evaluation error, never a pass", () => {
    const verdict = evaluateRelease(input([]), { prerequisites: [], now: NOW });
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.evaluationError).toContain("no prerequisites");
  });

  it("17d. evidence claiming VERIFIED for an unknown prerequisite fails the gate", () => {
    const verdict = evaluate([
      ...allVerified(),
      {
        prerequisite: "SOMETHING_NOBODY_DEFINED",
        status: "VERIFIED",
        source: "external-verification",
        environment: "production",
        observedAt: NOW - 1000,
      },
    ]);

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.unrecognised).toContain("SOMETHING_NOBODY_DEFINED");
    expect(verdict.blockers.join(" ")).toContain("recognised");
  });

  it("17e. an exemption cannot waive a mandatory prerequisite", () => {
    const verdict = evaluateRelease(
      input(allVerified().filter((r) => r.prerequisite !== A1), {
        exemptions: { [A1]: { reason: "we accept the risk for this release" } },
      }),
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );

    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers.join(" ")).toContain("exemption refused");
  });

  it("17f. an exemption without a stated reason is refused", () => {
    const verdict = evaluateRelease(
      input(allVerified(), { exemptions: { [A1]: { reason: "   " } } }),
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.blockers.join(" ")).toContain("no stated reason");
  });
});

describe("241 — the aggregate is deterministic and order-independent", () => {
  it("18. shuffling the evidence and reordering the manifest changes nothing", () => {
    const records = allVerified();
    const reversed = [...records].reverse();
    const shuffled = [records[2]!, records[4]!, records[0]!, records[3]!, records[1]!];

    const a = evaluate(records);
    const b = evaluate(reversed);
    const c = evaluate(shuffled);
    const reorderedManifest = evaluateRelease(input(records), {
      prerequisites: [...RELEASE_PREREQUISITES].reverse(),
      now: NOW,
    });

    const shape = (v: typeof a) => ({
      verdict: v.verdict,
      blockers: v.blockers,
      states: v.prerequisites.map((p) => `${p.id}:${p.state}`),
    });
    expect(shape(b)).toEqual(shape(a));
    expect(shape(c)).toEqual(shape(a));
    expect(shape(reorderedManifest)).toEqual(shape(a));
  });

  it("18b. duplicate identical records are idempotent, contradictory ones are not", () => {
    const records = allVerified();
    const duplicated = [...records, ...records.map((r) => ({ ...r }))];
    expect(evaluate(duplicated).verdict).toBe("READY");

    const conflicting = [
      ...records,
      { ...proof(A1), status: "BLOCKED" as const, detail: "contradicts the other record" },
    ];
    expect(evaluate(conflicting).verdict).toBe("NOT READY");
  });

  it("19. repeated evaluation of identical evidence is identical", () => {
    const records = allVerified().filter((r) => r.prerequisite !== A2);
    const first = evaluate(records);
    for (let i = 0; i < 5; i += 1) {
      expect(evaluate(records)).toEqual(first);
    }
    // Evaluation may not mutate its input either.
    expect(records).toHaveLength(4);
  });

  it("19b. every blocker state is one of the four non-passing states", () => {
    const states = new Set(["UNVERIFIED", "BLOCKED", "STALE", "CONTRADICTORY"]);
    const verdict = evaluate([
      ...allVerified().filter((r) => ![A1, EMAIL, EVIDENCE_D].includes(r.prerequisite)),
      proof(EMAIL, { observedAt: NOW - 40 * DAY }),
      { ...proof(A1), status: "BLOCKED" as const },
    ]);

    expect(verdict.verdict).toBe("NOT READY");
    for (const blocker of verdict.blockers) {
      const outcome = verdict.prerequisites.find((p) => p.id === blocker);
      expect(outcome).toBeDefined();
      expect(states.has(outcome!.state)).toBe(true);
    }
    expect(verdict.blockers).toContain(EVIDENCE_D);
  });
});
