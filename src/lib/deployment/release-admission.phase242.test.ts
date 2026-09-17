/**
 * Phase 242 — release admission: one canonical decision, fail-closed.
 *
 * Phase 241 proved the EVALUATOR cannot be talked into READY. This file proves
 * the layer release paths actually call cannot be talked into an ADMISSION, and
 * that it has no opinion of its own: every result here is compared against the
 * canonical verdict computed independently through `currentReleaseVerdict()`.
 *
 * The fixtures are in-memory trees so that every refusal path is reachable. The
 * current-repository tests read the real tree, so the suite fails if the release
 * silently becomes admissible — and also if it becomes admissible *without*
 * evidence, which is the failure this phase exists to prevent.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllProviders } from "@/lib/data/universal/providers";
import {
  currentReleaseVerdict,
  PROOF_PATHS,
  type FactSource,
} from "./release-current-state";
import { RELEASE_PREREQUISITES, evaluateRelease } from "./release-gate";
import {
  evaluateReleaseAdmission,
  formatReleaseAdmissionReport,
  releaseAdmissionExitCode,
  releaseAdmissionJson,
  resolveCandidateIdentity,
  type ReleaseAdmissionRequest,
} from "./release-admission";

const NOW = 1_800_000_000_000;
const COMMIT = "c0ffee242";
const REF = "refs/tags/rc-242";
const DEPLOYMENT = "prod-deployment-242";
const HOUR = 60 * 60 * 1000;

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

/** An in-memory tree. Counts accesses so side effects would be visible. */
function memorySource(files: Record<string, string>) {
  const reads: string[] = [];
  const source: FactSource = {
    exists: (path) => path in files,
    read: (path) => {
      reads.push(path);
      const body = files[path];
      if (body === undefined) throw new Error(`no such file: ${path}`);
      return body;
    },
  };
  return { source, reads };
}

const AFFECTED_REFS = ["main", "phase-157", "rc-181"];
const REF_INVENTORY = JSON.stringify({
  refs: [
    { ref: AFFECTED_REFS[0], affected: true, exposedAtTip: true },
    { ref: AFFECTED_REFS[1], affected: true, exposedAtTip: false },
    { ref: AFFECTED_REFS[2], affected: true, exposedAtTip: false },
  ],
});
const REQUIRED_PROVIDERS = getAllProviders()
  .map((provider) => provider.id)
  .sort();

/** A well-formed external production proof, aged `ageMs`, bound as instructed. */
function proof(
  overrides: Record<string, unknown> = {},
  ageMs = HOUR,
): string {
  return JSON.stringify({
    verified: true,
    source: "external-verification",
    environment: "production",
    observedAt: NOW - ageMs,
    ...overrides,
  });
}

/** Every prerequisite evidenced and bound: the only shape that may be admitted. */
function fullyVerified(overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    [PROOF_PATHS.refInventory]: REF_INVENTORY,
    [PROOF_PATHS.a1Revocation]: proof({ detail: "issuer confirmed revocation" }),
    [PROOF_PATHS.rewriteVerification]: proof({
      subject: { commit: COMMIT, refs: AFFECTED_REFS },
    }),
    [PROOF_PATHS.convexDeployment]: proof({
      subject: { commit: COMMIT, deployment: DEPLOYMENT },
    }),
    [PROOF_PATHS.emailDelivery]: proof({ detail: "delivered to a real mailbox" }),
    [PROOF_PATHS.evidenceD]: proof({
      subject: { commit: COMMIT, providers: REQUIRED_PROVIDERS },
      detail: "every provider answered live",
    }),
    ...overrides,
  };
  return files;
}

const admissionRequest = (
  files: Record<string, string>,
  extra: Partial<Parameters<typeof evaluateReleaseAdmission>[0]> = {},
) => ({
  source: memorySource(files).source,
  now: NOW,
  commit: COMMIT,
  ref: REF,
  ...extra,
});

const requestWithDeployment = (files: Record<string, string>) =>
  admissionRequest(files, { productionDeployment: DEPLOYMENT });

const blockerIds = (admission: ReturnType<typeof evaluateReleaseAdmission>) =>
  admission.blockers.map((blocker) => blocker.id).sort();

const reasonsOf = (admission: ReturnType<typeof evaluateReleaseAdmission>) =>
  admission.blockers.flatMap((blocker) => blocker.reasons).join(" | ");

describe("242 — the canonical admission path", () => {
  it("1. returns the verdict the Phase 241 machinery computes for this tree", () => {
    const admission = evaluateReleaseAdmission({ now: NOW });
    const canonical = currentReleaseVerdict(undefined, { now: NOW });

    expect(admission.verdict).toBe(canonical.verdict);
    expect(admission.admitted).toBe(canonical.ready);
    expect(admission.prerequisites.map((outcome) => [outcome.id, outcome.state])).toEqual(
      canonical.prerequisites.map((outcome) => [outcome.id, outcome.state]),
    );
  });

  it("1b. the default evidence source IS this checkout, byte for byte", () => {
    const implicit = evaluateReleaseAdmission({ now: NOW });
    const explicit = evaluateReleaseAdmission({ source: realSource, now: NOW });

    expect(implicit.verdict).toBe(explicit.verdict);
    expect(blockerIds(implicit)).toEqual(blockerIds(explicit));
    expect(releaseAdmissionJson(implicit)).toBe(releaseAdmissionJson(explicit));
  });

  it("2. the repository is still not admissible, and the blockers are the unmet ones", () => {
    const admission = evaluateReleaseAdmission({ now: NOW });
    const mandatory = RELEASE_PREREQUISITES.filter((entry) => entry.mandatory).map(
      (entry) => entry.id,
    );

    expect(admission.admitted).toBe(false);
    expect(admission.verdict).toBe("NOT READY");
    expect(admission.blockers.length).toBeGreaterThan(0);
    for (const id of blockerIds(admission)) expect(mandatory).toContain(id);
    expect(admission.evaluationError).toBeUndefined();
  });

  it("3. the release entry point refuses admission and reports how to fix it", () => {
    const admission = evaluateReleaseAdmission({ now: NOW });

    expect(releaseAdmissionExitCode(admission)).toBe(1);
    expect(reasonsOf(admission)).toMatch(/no evidence|no usable evidence/);
    expect(formatReleaseAdmissionReport(admission)).toMatch(/admitted: no/);
    expect(formatReleaseAdmissionReport(admission)).toMatch(/deploys nothing/);
  });

  it("5. the report and the JSON are the admission's own words, not a second opinion", () => {
    const admission = evaluateReleaseAdmission({ now: NOW });
    const report = formatReleaseAdmissionReport(admission);
    const json = JSON.parse(releaseAdmissionJson(admission)) as {
      admitted: boolean;
      verdict: string;
      blockers: { id: string }[];
    };

    // Line-exact on purpose: `toContain` would also be satisfied by the
    // diagnostic line "canonical verdict: ...", which is how a hardcoded display
    // verdict slipped past the first version of this assertion.
    const lines = report.split("\n");
    expect(lines).toContain(`verdict: ${admission.verdict}`);
    expect(lines).toContain(`admitted: ${admission.admitted ? "yes" : "no"}`);
    expect(lines.some((line) => line.startsWith(`candidate: ${admission.candidate.commit}`))).toBe(
      true,
    );
    expect(json.admitted).toBe(admission.admitted);
    expect(json.verdict).toBe(admission.verdict);
    expect(json.blockers.map((blocker) => blocker.id)).toEqual(blockerIds(admission));
  });

  it("6. no parallel path disagrees: admission always mirrors the canonical verdict", () => {
    const cases: [string, Record<string, string>, ReleaseAdmissionRequest][] =
      [
        ["empty tree", {}, {}],
        ["fully verified, deployment declared", fullyVerified(), { productionDeployment: DEPLOYMENT }],
        ["fully verified, deployment undeclared", fullyVerified(), {}],
        [
          "wrong commit",
          fullyVerified({
            [PROOF_PATHS.a1Revocation]: proof({ subject: { commit: "deadbeef0" } }),
          }),
          { productionDeployment: DEPLOYMENT },
        ],
        ["stale", fullyVerified({ [PROOF_PATHS.emailDelivery]: proof({}, 30 * 24 * HOUR) }), {}],
      ];

    for (const [name, files, extra] of cases) {
      const request = admissionRequest(files, extra);
      const admission = evaluateReleaseAdmission(request);
      const canonical = currentReleaseVerdict(request.source, {
        now: NOW,
        commit: COMMIT,
        ref: REF,
        productionDeployment: extra.productionDeployment,
      });
      expect(admission.verdict, name).toBe(canonical.verdict);
      expect(admission.admitted, name).toBe(canonical.ready);
    }
  });

  it("16. the blocker list is projected from canonical outcomes, per source", () => {
    const real = evaluateReleaseAdmission({ now: NOW });
    const canonical = currentReleaseVerdict(undefined, { now: NOW });
    const expectedFromCanonical = canonical.prerequisites
      .filter((outcome) => outcome.mandatory && outcome.state !== "VERIFIED")
      .map((outcome) => outcome.id)
      .sort();
    expect(blockerIds(real)).toEqual(expectedFromCanonical);

    // A tree where A1 alone is proven must lose exactly that blocker — a
    // hardcoded list would keep all five.
    const partial = evaluateReleaseAdmission(
      admissionRequest({ [PROOF_PATHS.a1Revocation]: proof({ detail: "issuer confirmed" }) }),
    );
    expect(blockerIds(partial)).not.toContain("A1_OTP_ISSUER_REVOCATION");
    expect(blockerIds(partial).length).toBe(blockerIds(real).length - 1);
  });

  it("15. two independent evaluations of the same facts agree, byte for byte", () => {
    const first = evaluateReleaseAdmission(requestWithDeployment(fullyVerified()));
    const second = evaluateReleaseAdmission(requestWithDeployment(fullyVerified()));

    expect(second.admitted).toBe(first.admitted);
    expect(second.verdict).toBe(first.verdict);
    expect(blockerIds(second)).toEqual(blockerIds(first));
    expect(releaseAdmissionJson(second)).toBe(releaseAdmissionJson(first));
  });

  it("the one shape that CAN be admitted is admitted — the path is not a constant refusal", () => {
    const admission = evaluateReleaseAdmission(requestWithDeployment(fullyVerified()));

    expect(admission.evaluationError).toBeUndefined();
    expect(admission.blockers).toEqual([]);
    expect(admission.verdict).toBe("READY");
    expect(admission.admitted).toBe(true);
    expect(releaseAdmissionExitCode(admission)).toBe(0);
    expect(admission.candidate).toEqual({
      commit: COMMIT,
      ref: REF,
      environment: "production",
      deployment: DEPLOYMENT,
    });
  });

  it("the deployment declaration is load-bearing: the same proofs cannot admit without it", () => {
    const admission = evaluateReleaseAdmission(admissionRequest(fullyVerified()));

    expect(admission.admitted).toBe(false);
    expect(blockerIds(admission)).toEqual(["CONVEX_PRODUCTION_DEPLOYMENT"]);
    expect(reasonsOf(admission)).toContain("no production deployment is declared");
  });
});

describe("242 — evidence that cannot admit anything", () => {
  it("7. a missing prerequisite is a blocker, never a pass", () => {
    const files = fullyVerified();
    delete files[PROOF_PATHS.emailDelivery];
    const admission = evaluateReleaseAdmission(requestWithDeployment(files));

    expect(admission.admitted).toBe(false);
    expect(blockerIds(admission)).toEqual(["PRODUCTION_EMAIL_TRANSPORT"]);
  });

  it("8. an evaluation failure is a refusal with an error, and its own exit code", () => {
    const exploding: FactSource = {
      exists: () => {
        throw new Error("evidence source unavailable");
      },
      read: () => {
        throw new Error("evidence source unavailable");
      },
    };
    const admission = evaluateReleaseAdmission({ source: exploding, now: NOW });

    expect(admission.admitted).toBe(false);
    expect(admission.verdict).toBe("NOT READY");
    expect(admission.evaluationError).toContain("unavailable");
    expect(releaseAdmissionExitCode(admission)).toBe(2);
    expect(formatReleaseAdmissionReport(admission)).toMatch(/evaluation error/);
  });

  it("9. evidence for a different commit cannot satisfy readiness", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({
          [PROOF_PATHS.rewriteVerification]: proof({
            subject: { commit: "deadbeef0", refs: AFFECTED_REFS },
          }),
        }),
      ),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("wrong commit");
  });

  it("9b. a different candidate cannot inherit another candidate's evidence", () => {
    const admission = evaluateReleaseAdmission(
      admissionRequest(fullyVerified(), { commit: "0thercandidate" }),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("wrong commit");
  });

  it("10. evidence from the wrong environment cannot satisfy readiness", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(fullyVerified({ [PROOF_PATHS.a1Revocation]: proof({ environment: "local" }) })),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("wrong environment");
  });

  it("10b. a proof that never states an environment is not production evidence", () => {
    // The reader defaults a missing environment to `local`; a file that simply
    // omits the field must not inherit the production label by silence.
    const anonymous = JSON.stringify({
      verified: true,
      source: "external-verification",
      observedAt: NOW - HOUR,
    });
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(fullyVerified({ [PROOF_PATHS.a1Revocation]: anonymous })),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("wrong environment");
  });

  it("11. CI green is not production verification", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(fullyVerified({ [PROOF_PATHS.a1Revocation]: proof({ source: "ci-run" }) })),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("a green CI run is not production verification");
  });

  it("12. a local run is not production verification", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(fullyVerified({ [PROOF_PATHS.a1Revocation]: proof({ source: "local-run" }) })),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("a local run is not production verification");
  });

  it("13. documentation is not verification, and a coerced flag is not a flag", () => {
    const documented = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({ [PROOF_PATHS.a1Revocation]: proof({ source: "documentation" }) }),
      ),
    );
    expect(documented.admitted).toBe(false);
    expect(reasonsOf(documented)).toContain("documentation is not verification");

    // The reader compares `verified === true`; a truthy string is a claim with a
    // different type, and must not become evidence.
    const coerced = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({ [PROOF_PATHS.a1Revocation]: proof({ verified: "VERIFIED" }) }),
      ),
    );
    expect(coerced.admitted).toBe(false);
    expect(blockerIds(coerced)).toContain("A1_OTP_ISSUER_REVOCATION");
  });

  it("14. a partial provider set, a foreign deployment and a stale proof all refuse", () => {
    const partialProviders = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({
          [PROOF_PATHS.evidenceD]: proof({
            subject: { commit: COMMIT, providers: REQUIRED_PROVIDERS.slice(0, -1) },
          }),
        }),
      ),
    );
    expect(partialProviders.admitted).toBe(false);
    expect(reasonsOf(partialProviders)).toContain("incomplete provider set");

    const foreignDeployment = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({
          [PROOF_PATHS.convexDeployment]: proof({
            subject: { commit: COMMIT, deployment: "prod-deployment-elsewhere" },
          }),
        }),
      ),
    );
    expect(foreignDeployment.admitted).toBe(false);
    expect(reasonsOf(foreignDeployment)).toContain("wrong deployment");

    const stale = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({ [PROOF_PATHS.emailDelivery]: proof({}, 8 * 24 * HOUR) }),
      ),
    );
    expect(stale.admitted).toBe(false);
    expect(reasonsOf(stale)).toContain("stale");
  });

  it("14b. a partially rewritten history cannot satisfy the rewrite prerequisite", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(
        fullyVerified({
          [PROOF_PATHS.rewriteVerification]: proof({
            subject: { commit: COMMIT, refs: AFFECTED_REFS.slice(0, 1) },
          }),
        }),
      ),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("partial rewrite");
  });

  it("14c. an unreadable inventory makes the ref set unknown, not empty", () => {
    const admission = evaluateReleaseAdmission(
      requestWithDeployment(fullyVerified({ [PROOF_PATHS.refInventory]: "{ not json" })),
    );

    expect(admission.admitted).toBe(false);
    expect(reasonsOf(admission)).toContain("the affected-ref set is unknown");
  });
});

describe("242 — bypass resistance", () => {
  it("an empty evidence object admits nothing", () => {
    const admission = evaluateReleaseAdmission(requestWithDeployment({}));
    expect(admission.admitted).toBe(false);
    expect(admission.blockers.length).toBe(
      RELEASE_PREREQUISITES.filter((entry) => entry.mandatory).length,
    );
  });

  it("the lower-level evaluator cannot be used to admit a candidate by hand", () => {
    // The gate is importable — it is the evaluator, not a back door. Hand-written
    // VERIFIED records still have to pass source, environment, freshness and
    // binding rules, so this call cannot produce a release-ready verdict.
    const verdict = evaluateRelease({
      candidate: { commit: COMMIT, ref: REF },
      affectedRefs: AFFECTED_REFS,
      requiredProviders: REQUIRED_PROVIDERS,
      records: RELEASE_PREREQUISITES.map((entry) => ({
        prerequisite: entry.id,
        status: "VERIFIED" as const,
        source: "fixture" as const,
        environment: "production" as const,
        observedAt: NOW,
      })),
    }, { prerequisites: RELEASE_PREREQUISITES, now: NOW });

    expect(verdict.ready).toBe(false);
    expect(verdict.verdict).toBe("NOT READY");
  });

  it("no module outside the admission layer may produce an admission", () => {
    // A second admission implementation is how two release checks start
    // disagreeing. The canonical layer is allowed to say it; nothing else is.
    const producers = walk(resolve(root, "src"))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => !file.endsWith("release-admission.ts"))
      .filter((file) =>
        /\badmitted\s*[:=]|\badmission\s*[:=]|evaluateReleaseAdmission|releaseAdmissionExitCode/i.test(
          readFileSync(file, "utf8"),
        ),
      );

    expect(producers).toEqual([]);
  });

  it("admission performs no external remediation and has no write path", () => {
    const text = readFileSync(resolve(root, "src/lib/deployment/release-admission.ts"), "utf8");
    const imports = text
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    expect(imports).not.toMatch(/node:fs|node:child_process|node:net|node:http/);
    // No environment access either: the client-hygiene guard in
    // production.phase12.test.ts catches this at repository scale, and this
    // states the same property where the decision is made. The entry point owns
    // the environment; the admission module is handed its candidate.
    expect(text).not.toMatch(/process\s*\.\s*env/);
    expect(text).not.toMatch(/\bfetch\s*\(|execSync|spawnSync|\bexec\s*\(|writeFileSync|rmSync/);
    // And the evidence source is only ever read.
    const { source, reads } = memorySource(fullyVerified());
    const before = reads.length;
    evaluateReleaseAdmission(requestWithDeployment(fullyVerified()));
    expect(reads.length).toBe(before);
    expect(typeof source.read).toBe("function");
  });

  it("the module's public surface is enumerated, so a bypass cannot be exported", () => {
    /*
      A force/bypass helper would be a one-line hole in everything above. The
      module therefore exports a fixed, reviewable set: adding anything to it
      means editing this list, which is the review checkpoint.
    */
    const text = readFileSync(resolve(root, "src/lib/deployment/release-admission.ts"), "utf8");
    const exported = [...text.matchAll(/^export (?:async )?(function|const) ([A-Za-z0-9_]+)/gm)]
      .map((match) => match[2])
      .sort();

    expect(exported).toEqual([
      "ADMISSION_ENVIRONMENT",
      "evaluateReleaseAdmission",
      "formatReleaseAdmissionReport",
      "releaseAdmissionExitCode",
      "releaseAdmissionJson",
      "resolveCandidateIdentity",
    ]);
  });

  it("candidate identity comes from the request, then the environment, then the default", () => {
    expect(resolveCandidateIdentity({ commit: "abc", ref: "r" }, {})).toEqual({
      commit: "abc",
      ref: "r",
    });
    expect(resolveCandidateIdentity({}, { GITHUB_SHA: "ci-sha", GITHUB_REF_NAME: "v9" })).toEqual({
      commit: "ci-sha",
      ref: "v9",
    });
    expect(resolveCandidateIdentity({}, {})).toEqual({ commit: undefined, ref: undefined });
    // A blank environment value is not an identity.
    expect(resolveCandidateIdentity({}, { GITHUB_SHA: "   ", RELEASE_CANDIDATE_COMMIT: " real " })).toEqual({
      commit: "real",
      ref: undefined,
    });
  });
});

/** Recursive file listing; kept here so the guard needs no extra dependency. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
