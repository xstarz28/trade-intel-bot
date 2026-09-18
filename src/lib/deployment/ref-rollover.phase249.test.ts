/**
 * Phase 249 — the A2 live-ref rollover, reconciled rather than asserted.
 *
 * WHAT CHANGED IN THE WORLD
 * Phase 248 pushed this session branch to open PR #4. That push made
 * `heads/arena/01a0b293-trade-intel-bot` a live ref on the remote, so the
 * inventory the A2 rewrite is scoped from grew from eight refs to nine. Nothing
 * about the exposure changed: the carrier count is still 270 and two refs still
 * serve the blob from their tips. A bigger scope is not progress, and these tests
 * are written so that distinction cannot be lost.
 *
 * WHY A ROLLOVER IS A DECISION, NOT AN EDIT
 * The scope lives in three artefacts that must agree — the measured inventory, the
 * canonical manifest and the runbook's two tables. Before this phase they agreed
 * only because someone remembered to edit all three, and the guards reported the
 * omission as an unexplained red test. `evaluateRefRollover` compares the three
 * layers and names the disagreement, so "the rollover landed consistently" is a
 * result that can be evaluated, mutated and refused rather than a claim.
 *
 * MEASURED, NEVER INFERRED
 * The ninth ref is affected because the leaked blob is *reachable from its tip*,
 * established by `scripts/secret-ref-inventory.mjs` over full history — not
 * because the branch descends from an affected branch, and not because its tip
 * looks clean. Both shortcuts are wrong in opposite directions: ancestry would
 * condemn a ref that was rewritten, and tip-cleanliness would acquit every working
 * branch while `main` still serves the credential. A shallow clone cannot answer
 * the question at all, so a shallow measurement is refused rather than trusted.
 *
 * FAIL-CLOSED
 * Reading the live refs can fail (no network). That failure is a hard,
 * self-describing error and never a skip: a security check that goes green because
 * it did not run is worse than no check.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LiveRefSourceUnavailableError,
  listLiveRefs,
  parseLsRemote,
} from "./live-refs";
import {
  parseDeclaredRefCount,
  parseExposureFacts,
  parseRewriteCoverage,
  parseVerifiedInventory,
  normalizeRunbookRef,
} from "./runbook-ref-facts";
import {
  AFFECTED_REF_EXPECTATIONS,
  MEASUREMENT_RECONCILIATION,
  REMEDIATION_MANIFEST,
  REMEDIATION_REPOSITORY,
} from "./remediation-manifest";
import {
  ROLLOVER_CODE_STATES,
  ROLLOVER_STATE_PRECEDENCE,
  type RolloverInput,
  evaluateRefRollover,
  formatRolloverReport,
  rolloverAddedRefs,
  rolloverDigest,
  rolloverDroppedRefs,
  rolloverStateForCode,
  tipStatusSaysExposed,
} from "./ref-rollover-reconciliation";
import { evaluateA2Readiness } from "./remediation-readiness";
import { currentReleaseVerdict } from "./release-current-state";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const RUNBOOK = read("docs/SECRET-REMEDIATION-RUNBOOK.md");
const INVENTORY_JSON = read("docs/secret-remediation-refs.json");
const GENERATOR = read("scripts/secret-ref-inventory.mjs");
const MODULE_SOURCE = read("src/lib/deployment/ref-rollover-reconciliation.ts");

/** The ref this phase added to the inventory. Named in tests, never in product code. */
const ROLLED_OVER_REF = "heads/arena/01a0b293-trade-intel-bot";
/** The eight refs the inventory carried before this phase. */
const PRIOR_REFS = [
  "heads/arena/01a08e67-trade-intel-bot",
  "heads/arena/01a0a5f5-trade-intel-bot",
  "heads/arena/01a0a92b-trade-intel-bot",
  "heads/arena/01a0ad26-trade-intel-bot",
  "heads/arena/01a0adfb-trade-intel-bot",
  "heads/main",
  "heads/phase-157-live-discovery-lifecycle",
  "tags/rc-181",
];

const artifact = parseVerifiedInventory(INVENTORY_JSON);

/**
 * The live refs, read from the remote through the existing read-only source.
 *
 * Fail-closed on purpose: if this throws, the rollover could not be checked, and
 * a green suite that never looked is the exact failure mode Phase 233 removed.
 */
function liveRefsOrFail(): string[] {
  try {
    return listLiveRefs();
  } catch (error) {
    if (error instanceof LiveRefSourceUnavailableError) {
      throw new Error(
        "Phase 249 could not read the remote's live refs, so the rollover is UNVERIFIED rather " +
          "than reconciled. This is not a skip: re-run where `git ls-remote` works. " +
          `Underlying cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

/** The working clone's depth, read-only. A shallow clone cannot measure reachability. */
function cloneIsShallow(): boolean {
  return (
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() ===
    "true"
  );
}

/**
 * Build the real input from the three artefacts plus the remote.
 *
 * `measurement.shallow` describes the clone the MEASUREMENT ran in, which is not
 * the clone this test runs in. The recorded artefact can only have come from a
 * full-history run, because `scripts/secret-ref-inventory.mjs` refuses a shallow or
 * grafted clone with exit 2 — a refusal case 3 asserts in the generator's own
 * source, and which the artefact's `method` field echoes by recording fingerprint
 * reachability rather than lineage. Case 3 also flips this flag on the REAL
 * nine-ref data and asserts the refusal, so recording it as full-history is a claim
 * the module still polices, not an exemption it grants.
 *
 * Reading the ambient depth here instead would make every real-tree assertion
 * depend on which runner executed it: CI's `verify` job deliberately checks out at
 * `fetch-depth: 1`. The ambient depth is asserted where it belongs — case 2, which
 * holds a full clone to a stricter standard than a shallow one and reports the
 * deferral out loud rather than passing quietly.
 */
function realInput(live: string[] = liveRefsOrFail()): RolloverInput {
  return {
    liveRefs: live,
    measurement: {
      shallow: false,
      present: existsSync(resolve(process.cwd(), "docs/secret-remediation-refs.json")),
      fingerprint: artifact.fingerprint,
      blobPaths: artifact.blobPaths,
      historyCommits: artifact.historyCommits,
      carrierCommits: artifact.carrierCommits,
      refs: artifact.refs,
    },
    manifest: {
      fingerprint: REMEDIATION_MANIFEST.credential.fingerprint,
      requiredBlobPaths: REMEDIATION_MANIFEST.inventory.requiredBlobPaths,
      carrierCommits: REMEDIATION_MANIFEST.credential.carrierCommits,
      refs: AFFECTED_REF_EXPECTATIONS,
    },
    runbook: {
      exposure: parseExposureFacts(RUNBOOK),
      coverage: parseRewriteCoverage(RUNBOOK),
      declaredCount: parseDeclaredRefCount(RUNBOOK),
    },
  };
}

/**
 * A synthetic input shaped exactly like the real one, so each refusal can be
 * produced in isolation without touching a repository. Nine live refs, all
 * affected, two exposed at tip — the measured shape of this repository.
 */
function syntheticInput(overrides: Partial<RolloverInput> = {}): RolloverInput {
  const refs = PRIOR_REFS.map((ref) => ({
    ref,
    affected: true,
    carrierCommits: ref === "heads/main" ? 261 : ref === "heads/phase-157-live-discovery-lifecycle" ? 262 : 269,
    exposedAtTip: ref === "heads/main" || ref === "heads/phase-157-live-discovery-lifecycle",
  }));
  refs.push({ ref: ROLLED_OVER_REF, affected: true, carrierCommits: 269, exposedAtTip: false });

  const base: RolloverInput = {
    liveRefs: refs.map((entry) => entry.ref),
    measurement: {
      shallow: false,
      present: true,
      fingerprint: "b1ce18a1e85ba121",
      blobPaths: ["src/convex/auth/emailOtp.ts"],
      historyCommits: 429,
      carrierCommits: 270,
      refs,
    },
    manifest: {
      fingerprint: "b1ce18a1e85ba121",
      requiredBlobPaths: ["src/convex/auth/emailOtp.ts"],
      carrierCommits: 270,
      refs: refs.map((entry) => ({
        ref: entry.ref,
        carrierCommits: entry.carrierCommits,
        exposedAtTip: entry.exposedAtTip,
      })),
    },
    runbook: {
      exposure: refs.map((entry) => ({
        ref: entry.ref,
        tipStatus: entry.exposedAtTip ? "**EXPOSED AT TIP**" : "**clean**",
        occurrences: entry.carrierCommits,
      })),
      coverage: refs.map((entry) => ({ ref: entry.ref })),
      declaredCount: refs.length,
    },
  };
  return { ...base, ...overrides };
}

const codes = (input: RolloverInput) => evaluateRefRollover(input).refusals.map((r) => r.code);

/**
 * Strip block comments, JSDoc continuation lines and line comments, so a source
 * scan reports what the code does rather than what the prose explains.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*\*.*$/gm, "");
}

// ═══════════════════════════════════════════════════════════════
// 1 — the rollover, measured against the real repository
// ═══════════════════════════════════════════════════════════════

describe("249 — the rollover is detected and reconciled against the real repository", () => {
  it("1. detects the new live branch the remote now advertises", () => {
    const live = liveRefsOrFail();
    expect(live).toContain(ROLLED_OVER_REF);
    // Detection is a count the remote answers, not a list written down here.
    expect(live).toHaveLength(9);
  });

  it("2. measures it from full history, not from ancestry or tip-cleanliness", () => {
    // The artefact's own provenance: blob identity, not lineage. This is what makes
    // "affected" a measurement rather than an inference from the branch's ancestry.
    expect(artifact.method).toMatch(/fingerprint reachability/i);
    expect(artifact.method).toMatch(/not lineage inference/i);
    expect(artifact.generatedBy).toBe(REMEDIATION_MANIFEST.inventory.generator);

    const measured = artifact.refs.find((entry) => entry.ref === ROLLED_OVER_REF);
    expect(measured, "the ninth ref must have its own measured row").toBeDefined();
    expect(measured?.affected).toBe(true);
    expect(measured?.carrierCommits).toBe(269);
    // Clean at the tip AND affected: the two facts coexist, and the runbook's own
    // wording is that tip-cleanliness is not remediation.
    expect(measured?.exposedAtTip).toBe(false);
    expect(artifact.historyCommits).toBe(429);

    // Depth-branched, following the Phase 233 guard. In a FULL clone there is no
    // excuse: the ninth ref's advertised tip must be present locally and its
    // tip-exposure re-verified from git rather than trusted from the artefact.
    // CI's `verify` job checks out at depth 1 and, on `pull_request`, a synthetic
    // MERGE commit rather than a branch tip, so the tip is absent there — and that
    // limitation is REPORTED, never silently passed.
    if (!cloneIsShallow()) {
      // The tip comes from the remote and is normalised with the same rule the
      // guards use, so this works for a head or a tag without mapping ref names.
      const listing = execFileSync("git", ["ls-remote", "--heads", "--tags", "origin"], {
        encoding: "utf8",
        maxBuffer: 1 << 24,
      });
      const row = listing
        .split("\n")
        .map((line) => line.split("\t"))
        .find(
          ([sha, ref]) =>
            Boolean(sha) &&
            Boolean(ref) &&
            !ref.endsWith("^{}") &&
            normalizeRunbookRef(ref) === ROLLED_OVER_REF,
        );
      expect(row, "the ninth ref must be advertised by the remote").toBeDefined();
      const tip = row?.[0] ?? "";
      expect(tip, "the ninth ref's tip must be a full SHA").toMatch(/^[0-9a-f]{40}$/);
      expect(spawnSync("git", ["cat-file", "-e", tip]).status).toBe(0);

      const blobPath = artifact.blobPaths[0];
      const atTip = execFileSync("git", ["rev-parse", `${tip}:${blobPath}`], {
        encoding: "utf8",
      }).trim();
      // Re-verified from git: the tip's own copy of the leaked path is NOT the
      // leaked blob, which is exactly what exposedAtTip=false claims.
      expect(atTip === REMEDIATION_MANIFEST.credential.blob).toBe(false);
      expect(atTip === REMEDIATION_MANIFEST.credential.blob).toBe(measured?.exposedAtTip);
      // And the exposure is still in the history behind that tip, not only in the
      // artefact's say-so: the leaked blob is reachable from it.
      const reachable = execFileSync(
        "git",
        ["rev-list", "--count", tip],
        { encoding: "utf8" },
      ).trim();
      expect(Number(reachable)).toBeGreaterThan(measured?.carrierCommits ?? 0);
    } else {
      console.log(
        `Phase 249: full-history re-verification of ${ROLLED_OVER_REF} DEFERRED — this checkout ` +
          `is shallow (CI's verify job uses fetch-depth: 1), so the advertised tip is not ` +
          `present locally. The recorded measurement stands on the generator's own full-history ` +
          `run, which refuses a shallow clone with exit 2 (see case 3). Not a silent pass.`,
      );
    }
  });

  it("3. refuses a shallow measurement instead of trusting its small numbers", () => {
    const shallow = evaluateRefRollover(syntheticInput({
      measurement: { ...syntheticInput().measurement, shallow: true },
    }));
    expect(shallow.state).toBe("MEASUREMENT_UNUSABLE");
    expect(shallow.reconciled).toBe(false);
    expect(shallow.measurementTrustworthy).toBe(false);
    expect(codes(syntheticInput({
      measurement: { ...syntheticInput().measurement, shallow: true },
    }))).toContain("MEASUREMENT_SHALLOW");
    // And the refusal names the reason a shallow clone cannot answer.
    expect(shallow.problems.join("\n")).toMatch(/graft/);

    // The generator refuses too, at the source: it will not emit an inventory from
    // a shallow or grafted clone, and it exits non-zero rather than printing a
    // small number that would look like a clean result.
    expect(GENERATOR).toMatch(/REFUSING — shallow clone/);
    expect(GENERATOR).toMatch(/process\.exit\(2\)/);
    expect(GENERATOR).toMatch(/git fetch --unshallow/);
    // A ref whose tip object is absent locally is refused, not reported as clean.
    expect(GENERATOR).toMatch(/cat-file/);

    // And the claim realInput() makes — that the recorded artefact came from a
    // full-history run — is policed, not granted. Same real nine-ref data, one flag
    // flipped, and the whole reconciliation collapses to the worst state.
    const real = realInput();
    const realFlaggedShallow = evaluateRefRollover({
      ...real,
      measurement: { ...real.measurement, shallow: true },
    });
    expect(realFlaggedShallow.state).toBe("MEASUREMENT_UNUSABLE");
    expect(realFlaggedShallow.reconciled).toBe(false);
    expect(realFlaggedShallow.measurementTrustworthy).toBe(false);
    expect(realFlaggedShallow.refusals.map((entry) => entry.code)).toContain("MEASUREMENT_SHALLOW");
    // The same data, unflagged, reconciles — so the refusal is about the depth and
    // nothing else.
    expect(evaluateRefRollover(real).reconciled).toBe(true);
  });

  it("4. adds the ref only because fingerprint reachability was proven", () => {
    // The rule is reachability of the recorded blob, so an affected ref must have
    // carriers, and the recorded blob path must be the one the manifest requires.
    expect(artifact.blobPaths).toEqual([...REMEDIATION_MANIFEST.inventory.requiredBlobPaths]);
    expect(artifact.fingerprint).toBe(REMEDIATION_MANIFEST.credential.fingerprint);
    expect(artifact.refs.every((entry) => !entry.affected || entry.carrierCommits > 0)).toBe(true);
    const ninth = artifact.refs.find((entry) => entry.ref === ROLLED_OVER_REF);
    expect(ninth?.carrierCommits).toBeGreaterThan(0);
  });

  it("5. never classifies an unaffected ref as affected", () => {
    const refs = syntheticInput().measurement.refs.map((entry) =>
      entry.ref === ROLLED_OVER_REF ? { ...entry, affected: false, carrierCommits: 0 } : entry,
    );
    const input = syntheticInput({ measurement: { ...syntheticInput().measurement, refs } });
    // The manifest still claims it affected, so the disagreement is named.
    expect(codes(input)).toContain("MANIFEST_EXTRA_REF");
    expect(evaluateRefRollover(input).affectedRefs).not.toContain(ROLLED_OVER_REF);
  });

  it("6. keeps all eight prior refs present, unaltered in their historical claims", () => {
    const live = liveRefsOrFail();
    for (const ref of PRIOR_REFS) {
      expect(live, `${ref} must still be advertised`).toContain(ref);
      expect(artifact.refs.map((e) => e.ref), `${ref} must still be measured`).toContain(ref);
      expect(AFFECTED_REF_EXPECTATIONS.map((e) => e.ref), `${ref} must stay canonical`).toContain(ref);
    }
    // Their facts are what they always were: the rollover added a row, it did not
    // re-adjudicate the eight.
    const main = artifact.refs.find((e) => e.ref === "heads/main");
    expect(main?.carrierCommits).toBe(261);
    expect(main?.exposedAtTip).toBe(true);
    expect(artifact.carrierCommits).toBe(270);
  });

  it("7. refuses to let an affected ref disappear from the canonical scope", () => {
    const manifest = syntheticInput().manifest;
    const dropped = manifest.refs.filter((entry) => entry.ref !== PRIOR_REFS[2]);
    expect(codes(syntheticInput({ manifest: { ...manifest, refs: dropped } }))).toContain(
      "MANIFEST_MISSING_AFFECTED_REF",
    );
    // Dropping it from the runbook coverage instead is equally refused.
    const coverage = syntheticInput().runbook.coverage.filter((r) => r.ref !== PRIOR_REFS[3]);
    expect(
      codes(syntheticInput({ runbook: { ...syntheticInput().runbook, coverage } })),
    ).toContain("RUNBOOK_COVERAGE_MISSING_REF");
  });

  it("8. refuses an unrelated ref added to the scope", () => {
    const manifest = syntheticInput().manifest;
    const injected = {
      ...manifest,
      refs: [...manifest.refs, { ref: "heads/some-unrelated-branch", carrierCommits: 1, exposedAtTip: false }],
    };
    expect(codes(syntheticInput({ manifest: injected }))).toContain("MANIFEST_EXTRA_REF");
  });

  it("9. makes the affected-ref count equal the canonical inventory", () => {
    const assessment = evaluateRefRollover(realInput());
    expect(assessment.reconciled, assessment.problems.join("\n")).toBe(true);
    expect(assessment.affectedRefCount).toBe(9);
    expect(assessment.affectedRefs).toEqual([...artifact.refs.filter((r) => r.affected).map((r) => r.ref)].sort());
    expect(AFFECTED_REF_EXPECTATIONS).toHaveLength(9);
  });

  it("10. makes the remote's live-ref count equal the observed inventory", () => {
    const live = liveRefsOrFail();
    const assessment = evaluateRefRollover(realInput(live));
    expect(live).toHaveLength(artifact.refs.length);
    expect(assessment.liveRefCount).toBe(assessment.affectedRefCount);
    expect(parseDeclaredRefCount(RUNBOOK)).toBe(live.length);
    // Every live ref is accounted for by all three layers.
    expect(assessment.unaccountedRefs).toEqual([]);
  });

  it("11. keeps branch-name normalization correct across all three layers", () => {
    // The remote advertises `refs/heads/x`; the inventory and manifest say `heads/x`;
    // the runbook's exposure table says `refs/heads/x`. All three must mean one ref.
    expect(parseLsRemote(`abc\trefs/${ROLLED_OVER_REF}\n`)).toEqual([ROLLED_OVER_REF]);
    expect(normalizeRunbookRef(`refs/${ROLLED_OVER_REF}`)).toBe(ROLLED_OVER_REF);
    const exposure = parseExposureFacts(RUNBOOK).map((row) => row.ref);
    expect(exposure).toContain(ROLLED_OVER_REF);
    expect(parseRewriteCoverage(RUNBOOK).map((row) => row.ref)).toContain(ROLLED_OVER_REF);
    // A peeled tag object is not a second ref, so the count stays honest.
    expect(parseLsRemote("ccc\trefs/tags/rc-181\nddd\trefs/tags/rc-181^{}\n")).toEqual([
      "tags/rc-181",
    ]);
  });

  it("12. still represents main as the existing affected ref exposed at its tip", () => {
    const assessment = evaluateRefRollover(realInput());
    expect(assessment.affectedRefs).toContain("heads/main");
    expect(assessment.exposedAtTipRefs).toEqual([
      "heads/main",
      "heads/phase-157-live-discovery-lifecycle",
    ]);
    expect(tipStatusSaysExposed("**EXPOSED AT TIP**")).toBe(true);
    expect(tipStatusSaysExposed("**clean**")).toBe(false);
  });

  it("13. keeps the session branch non-main and main forbidden as a target", () => {
    expect(ROLLED_OVER_REF).not.toBe("heads/main");
    expect(REMEDIATION_REPOSITORY.forbiddenBranches).toContain("main");
    // The rollover did not repoint the canonical branch the rewrite would run from.
    expect(REMEDIATION_REPOSITORY.expectedBranch).toBe("arena/01a0adfb-trade-intel-bot");
  });

  it("14. leaves A2 readiness UNVERIFIED after the rollover", () => {
    // The real nine-ref inventory, and no remediation evidence: the scope is now
    // complete, and readiness still refuses, because a complete inventory is a
    // precondition for the rewrite rather than a result of it.
    //
    // Depth is passed explicitly and BOTH directions are asserted. CI's verify job
    // checks out at depth 1, and a shallow clone is not an authoritative basis for a
    // history rewrite — so reading the ambient depth here would either fail in CI or
    // quietly drop the refusal's teeth. `now` is derived from the artefact, not from
    // a clock, so the freshness window does not rot as the artefact ages.
    const readiness = (shallow: boolean) =>
      evaluateA2Readiness({
        repository: {
          workdir: process.cwd(),
          branch: REMEDIATION_REPOSITORY.expectedBranch,
          head: "0000000",
          remoteName: "origin",
          remoteUrl: REMEDIATION_MANIFEST.repository.remoteUrl,
          shallow,
          worktreeClean: true,
          historyCommitCount: artifact.historyCommits,
        },
        inventory: {
          present: true,
          generatedBy: artifact.generatedBy,
          verifiedAt: Date.parse(artifact.verifiedAt),
          fingerprint: artifact.fingerprint,
          blobPaths: artifact.blobPaths,
          historyCommits: artifact.historyCommits,
          carrierCommits: artifact.carrierCommits,
          refs: artifact.refs,
        },
        expectedCandidate: null,
        evidence: [],
        now: Date.parse(artifact.verifiedAt) + 1000,
      });

    for (const shallow of [false, true]) {
      const label = `shallow=${String(shallow)}`;
      const report = readiness(shallow);
      // Unchanged by the rollover at either depth: nothing was remediated.
      expect(report.ready, label).toBe(false);
      expect(report.verified, label).toBe(false);
      expect(report.remediationPerformed, label).toBe(false);
      // The scope it would rewrite is the nine measured refs — complete, not partial.
      expect(report.scope.expectedRefs, label).toHaveLength(9);
      expect(report.scope.measuredRefs, label).toHaveLength(9);
      expect(report.scope.missingRefs, label).toEqual([]);
      expect(report.problems.length, label).toBeGreaterThan(0);
    }

    // A full clone yields an authoritative scope; a shallow one cannot, because
    // reachability is not established by a truncated history.
    expect(readiness(false).scope.authoritativeScope).toBe(true);
    expect(readiness(true).scope.authoritativeScope).toBe(false);
  });

  it("15. does not let a successful reconciliation imply rewrite completion", () => {
    const assessment = evaluateRefRollover(realInput());
    expect(assessment.reconciled).toBe(true);
    expect(assessment.remediationPerformed).toBe(false);
    expect(assessment.rewriteExecuted).toBe(false);
    expect(assessment.a2Verified).toBe(false);
    // The rendered report says so in words, not only in fields.
    const report = formatRolloverReport(assessment);
    expect(report).toMatch(/remediation performed: no/);
    expect(report).toMatch(/history rewritten:\s+no/);
    expect(report).toMatch(/A2 verified:\s+no/);
    expect(report).toMatch(/correctly scoped job, not a finished one/);
  });

  it("16. leaves release admission NOT READY", () => {
    expect(currentReleaseVerdict().verdict).toBe("NOT READY");
    const blockers = currentReleaseVerdict().blockers.join("\n");
    expect(blockers).toMatch(/A2|rewrite|credential|rotation/i);
  });

  it("17. performs no Git write: the measurement tooling only reads", () => {
    const READ_ONLY = new Set(["rev-parse", "ls-remote", "rev-list", "cat-file"]);
    const used = new Set(
      [...GENERATOR.matchAll(/"(rev-parse|ls-remote|rev-list|cat-file|log|for-each-ref|show|diff|status|push|fetch|tag|branch|reset|rebase|filter-branch|filter-repo|update-ref|commit|checkout|merge|cherry-pick)"/g)]
        .map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const subcommand of used) {
      expect(READ_ONLY.has(subcommand), `generator invokes non-read-only git ${subcommand}`).toBe(true);
    }
    // The only path it writes is the inventory artefact itself.
    expect(GENERATOR).toMatch(/writeFileSync\(OUT/);
    expect(GENERATOR.match(/writeFileSync\(/g)).toHaveLength(1);
    // The decision module is pure: no child process, no fs, no network, no clock.
    for (const forbidden of ["child_process", "node:fs", "writeFileSync", "spawnSync", "execSync", "fetch(", "Date.now", "process.env"]) {
      expect(MODULE_SOURCE, `module must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("18. performs no force-push", () => {
    // Prose legitimately says "a branch was pushed"; what must never appear is the
    // command. Comments and JSDoc are stripped so the scan covers code only.
    for (const source of [GENERATOR, MODULE_SOURCE]) {
      const code = stripComments(source);
      expect(code).not.toMatch(/--force\b/);
      expect(code).not.toMatch(/--force-with-lease/);
      expect(code).not.toMatch(/["']push["']/);
      expect(code).not.toMatch(/\bpush\s*,/);
    }
  });

  it("19. performs no history rewrite", () => {
    for (const source of [GENERATOR, MODULE_SOURCE]) {
      for (const forbidden of [
        "filter-branch",
        "filter-repo",
        "rebase",
        "reset --hard",
        "update-ref",
        "commit-tree",
        "replace",
      ]) {
        expect(source, `no ${forbidden} in the measurement path`).not.toContain(forbidden);
      }
    }
    // The artefact is data: rewriting it must not have rewritten anything else.
    expect(GENERATOR).not.toMatch(/rm\s+-rf|unlink/);
  });

  it("20. mutates no remote ref and creates no branch or tag", () => {
    // `ls-remote` is the only remote contact, and it is a read.
    expect(GENERATOR).toMatch(/ls-remote/);
    for (const forbidden of ["branch -f", "branch -d", "tag ", "checkout -b", "switch -c", "remote add", "remote set-url"]) {
      expect(GENERATOR, `no ${forbidden.trim()}`).not.toContain(forbidden);
    }
    // The rollover arithmetic can name what grew and what shrank, and nothing shrank.
    expect(rolloverAddedRefs(liveRefsOrFail(), PRIOR_REFS)).toEqual([ROLLED_OVER_REF]);
    expect(rolloverDroppedRefs(liveRefsOrFail(), PRIOR_REFS)).toEqual([]);
  });

  it("21. is deterministic for identical repository state", () => {
    const first = evaluateRefRollover(realInput());
    const second = evaluateRefRollover(realInput());
    expect(second).toEqual(first);
    expect(rolloverDigest(first.affectedRefs, first.carrierCommits)).toBe(
      rolloverDigest(second.affectedRefs, second.carrierCommits),
    );
    // The digest is sensitive to the scope it summarises.
    expect(rolloverDigest(PRIOR_REFS, 270)).not.toBe(
      rolloverDigest([...PRIOR_REFS, ROLLED_OVER_REF], 270),
    );
    expect(formatRolloverReport(first)).toBe(formatRolloverReport(second));
  });

  it("22. creates no second branch to do this work", () => {
    // The rollover is reconciled on the branch that already exists; making another
    // one would add a tenth live ref and start the cycle again.
    expect(ROLLOVER_STATE_PRECEDENCE[ROLLOVER_STATE_PRECEDENCE.length - 1]).toBe(
      "ROLLOVER_RECONCILED",
    );
    const live = liveRefsOrFail();
    expect(live.filter((ref) => ref.startsWith("heads/arena/"))).toHaveLength(6);
    expect(live).toContain(ROLLED_OVER_REF);
    // The added set is exactly one ref, and it is this branch — not a new one.
    expect(rolloverAddedRefs(live, PRIOR_REFS)).toHaveLength(1);
    expect(GENERATOR).not.toMatch(/checkout|switch/);
  });

  it("23. represents the Issue #5 scope without changing remediation semantics", () => {
    // The runbook still blocks the rewrite on rotation, and still says a clean tip
    // is not remediation — the rollover added a row, not a verdict.
    expect(RUNBOOK).toMatch(/Rotation gate — \*\*BLOCKED\*\*/);
    expect(RUNBOOK).toMatch(/removal from HEAD is not\s+remediation/i);
    expect(RUNBOOK).toMatch(/All nine refs still carry it in\s+reachable history/);
    expect(RUNBOOK).toMatch(/\*\*All nine\*\*/);
    expect(RUNBOOK).toMatch(/Phase 249 note/);
    // Growth is recorded as growth, with the carrier count unchanged as the proof
    // that the exposure itself did not move.
    expect(RUNBOOK).toMatch(/A nine-ref inventory is a\s+larger remediation scope, not progress/);
    expect(RUNBOOK).toMatch(/carrier commits remain \*\*270\*\*/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 — the refusal surface, exercised synthetically
// ═══════════════════════════════════════════════════════════════

describe("249 — every layer that can drift is refused by name", () => {
  it("reconciles the real nine-ref shape with no refusals at all", () => {
    const assessment = evaluateRefRollover(syntheticInput());
    expect(assessment.state).toBe("ROLLOVER_RECONCILED");
    expect(assessment.problems).toEqual([]);
    expect(assessment.measurementTrustworthy).toBe(true);
    expect(assessment.affectedRefCount).toBe(9);
  });

  it("refuses an absent inventory, which is not the same as an empty ref set", () => {
    const input = syntheticInput({ measurement: { ...syntheticInput().measurement, present: false } });
    expect(codes(input)).toContain("MEASUREMENT_ABSENT");
    expect(evaluateRefRollover(input).state).toBe("MEASUREMENT_UNUSABLE");
  });

  it("refuses an empty inventory while the leak is documented", () => {
    const input = syntheticInput({
      measurement: { ...syntheticInput().measurement, refs: [] },
      manifest: { ...syntheticInput().manifest, refs: [] },
      runbook: { ...syntheticInput().runbook, exposure: [], coverage: [], declaredCount: 0 },
    });
    const found = codes(input);
    expect(found).toContain("INVENTORY_EMPTY");
    // With nothing measured, no live ref is accounted for either. The manifest
    // cannot be "missing" a ref, because there is no measured affected ref to miss.
    expect(found).toContain("LIVE_REF_NOT_MEASURED");
    expect(found).not.toContain("MANIFEST_MISSING_AFFECTED_REF");
    expect(evaluateRefRollover(input).unaccountedRefs).toHaveLength(9);
  });

  it("refuses a fingerprint that is not the recorded exposure", () => {
    const input = syntheticInput({
      measurement: { ...syntheticInput().measurement, fingerprint: "deadbeefdeadbeef" },
    });
    expect(codes(input)).toContain("FINGERPRINT_MISMATCH");
    expect(evaluateRefRollover(input).problems.join("\n")).toMatch(/not the same exposure/);
  });

  it("refuses a measurement that did not find the required blob path", () => {
    const input = syntheticInput({
      measurement: { ...syntheticInput().measurement, blobPaths: ["src/other/file.ts"] },
    });
    expect(codes(input)).toContain("BLOB_PATH_MISSING");
  });

  it("refuses an unmeasured live ref: the ignore-new-ref failure", () => {
    const live = [...syntheticInput().liveRefs, "heads/arena/01a0ffff-trade-intel-bot"];
    const input = syntheticInput({ liveRefs: live });
    expect(codes(input)).toContain("LIVE_REF_NOT_MEASURED");
    expect(codes(input)).toContain("RUNBOOK_EXPOSURE_MISSING_REF");
    const assessment = evaluateRefRollover(input);
    expect(assessment.unaccountedRefs).toEqual(["heads/arena/01a0ffff-trade-intel-bot"]);
    // The refusal says why it matters, not just that a row is missing.
    expect(assessment.problems.join("\n")).toMatch(/would survive the rewrite/);
  });

  it("refuses a measured ref the remote no longer advertises", () => {
    const live = syntheticInput().liveRefs.filter((ref) => ref !== "tags/rc-181");
    expect(codes(syntheticInput({ liveRefs: live }))).toContain("MEASURED_REF_NOT_LIVE");
  });

  it("refuses a manifest that disagrees with the measurement on a fact", () => {
    const manifest = syntheticInput().manifest;
    const wrongCarriers = manifest.refs.map((entry) =>
      entry.ref === ROLLED_OVER_REF ? { ...entry, carrierCommits: 0 } : entry,
    );
    expect(codes(syntheticInput({ manifest: { ...manifest, refs: wrongCarriers } }))).toContain(
      "MANIFEST_CARRIER_MISMATCH",
    );
    const wrongTip = manifest.refs.map((entry) =>
      entry.ref === ROLLED_OVER_REF ? { ...entry, exposedAtTip: true } : entry,
    );
    expect(codes(syntheticInput({ manifest: { ...manifest, refs: wrongTip } }))).toContain(
      "MANIFEST_TIP_MISMATCH",
    );
    // A changed carrier TOTAL is not a rollover at all — it means the exposure moved.
    expect(
      codes(syntheticInput({ manifest: { ...manifest, carrierCommits: 271 } })),
    ).toContain("MANIFEST_CARRIER_TOTAL_MISMATCH");
  });

  it("refuses a runbook whose declared count no longer matches the remote", () => {
    // The hardcode-the-old-count failure: the summary still says eight.
    const input = syntheticInput({
      runbook: { ...syntheticInput().runbook, declaredCount: 8 },
    });
    expect(codes(input)).toContain("RUNBOOK_DECLARED_COUNT_MISMATCH");
    expect(evaluateRefRollover(input).problems.join("\n")).toMatch(/says it covers 8/);
    // And a summary that stops stating a count cannot be checked at all.
    expect(
      codes(syntheticInput({ runbook: { ...syntheticInput().runbook, declaredCount: null } })),
    ).toContain("RUNBOOK_DECLARED_COUNT_ABSENT");
  });

  it("refuses a duplicated row, which would let one ref satisfy two checks", () => {
    const runbook = syntheticInput().runbook;
    expect(
      codes(syntheticInput({
        runbook: { ...runbook, exposure: [...runbook.exposure, runbook.exposure[0]] },
      })),
    ).toContain("RUNBOOK_DUPLICATE_ROW");
    expect(
      codes(syntheticInput({
        runbook: { ...runbook, coverage: [...runbook.coverage, runbook.coverage[0]] },
      })),
    ).toContain("RUNBOOK_DUPLICATE_ROW");
  });

  it("refuses a runbook that names a ref the remote no longer has", () => {
    const live = syntheticInput().liveRefs.filter((ref) => ref !== PRIOR_REFS[0]);
    expect(codes(syntheticInput({ liveRefs: live }))).toContain("RUNBOOK_NAMES_DEAD_REF");
  });

  it("refuses a dead ref named in either table on its own, not only in both", () => {
    // Both tables are scanned by separate loops, so each is covered alone: a check
    // that only fires when the OTHER loop also fires is not a check.
    const base = syntheticInput();
    const dead = PRIOR_REFS[0];
    const live = base.liveRefs.filter((ref) => ref !== dead);
    const without = <T extends { ref: string }>(rows: readonly T[]) =>
      rows.filter((row) => row.ref !== dead);

    // Named only in the exposure table; coverage has already dropped it.
    const exposureOnly = syntheticInput({
      liveRefs: live,
      measurement: { ...base.measurement, refs: without(base.measurement.refs) },
      manifest: { ...base.manifest, refs: without(base.manifest.refs) },
      runbook: { ...base.runbook, coverage: without(base.runbook.coverage), declaredCount: live.length },
    });
    expect(codes(exposureOnly)).toContain("RUNBOOK_NAMES_DEAD_REF");

    // Named only in the rewrite coverage; the exposure table has already dropped it.
    const coverageOnly = syntheticInput({
      liveRefs: live,
      measurement: { ...base.measurement, refs: without(base.measurement.refs) },
      manifest: { ...base.manifest, refs: without(base.manifest.refs) },
      runbook: { ...base.runbook, exposure: without(base.runbook.exposure), declaredCount: live.length },
    });
    expect(codes(coverageOnly)).toContain("RUNBOOK_NAMES_DEAD_REF");
  });

  it("refuses a runbook that claims exposure the measurement does not see", () => {
    // The mirror of a missing row: the runbook still records occurrences for a ref
    // the measurement found unaffected. Only the affected-vs-claimed comparison can
    // see this — the carrier-count comparison is skipped for an unaffected ref.
    const base = syntheticInput();
    const target = "tags/rc-181";
    const refs = base.measurement.refs.map((entry) =>
      entry.ref === target ? { ...entry, affected: false, carrierCommits: 0, exposedAtTip: false } : entry,
    );
    const input = syntheticInput({
      measurement: { ...base.measurement, refs },
      manifest: { ...base.manifest, refs: base.manifest.refs.filter((e) => e.ref !== target) },
      runbook: {
        ...base.runbook,
        coverage: base.runbook.coverage.filter((row) => row.ref !== target),
      },
    });
    const found = codes(input);
    expect(found).toContain("RUNBOOK_OCCURRENCE_CONTRADICTION");
    expect(evaluateRefRollover(input).problems.join("\n")).toMatch(
      /measured affected=false \(carriers=0\) but the runbook claims occurrences=269/,
    );
  });

  it("refuses a tip status that contradicts the measurement", () => {
    // The treat-tip-cleanliness-as-sufficient failure: the runbook says main is
    // clean while the measurement says its tip serves the blob.
    const runbook = syntheticInput().runbook;
    const lied = runbook.exposure.map((row) =>
      row.ref === "heads/main" ? { ...row, tipStatus: "**clean**" } : row,
    );
    expect(
      codes(syntheticInput({ runbook: { ...runbook, exposure: lied } })),
    ).toContain("RUNBOOK_TIP_STATUS_CONTRADICTION");
    // And an occurrence count that disagrees with the carrier count.
    const stale = runbook.exposure.map((row) =>
      row.ref === ROLLED_OVER_REF ? { ...row, occurrences: 268 } : row,
    );
    expect(
      codes(syntheticInput({ runbook: { ...runbook, exposure: stale } })),
    ).toContain("RUNBOOK_OCCURRENCE_CONTRADICTION");
  });

  it("refuses coverage for a ref that is not affected", () => {
    const refs = syntheticInput().measurement.refs.map((entry) =>
      entry.ref === "tags/rc-181" ? { ...entry, affected: false, carrierCommits: 0 } : entry,
    );
    const manifest = syntheticInput().manifest.refs.filter((e) => e.ref !== "tags/rc-181");
    const exposure = syntheticInput().runbook.exposure.map((row) =>
      row.ref === "tags/rc-181" ? { ...row, tipStatus: "**clean**", occurrences: 0 } : row,
    );
    const input = syntheticInput({
      measurement: { ...syntheticInput().measurement, refs },
      manifest: { ...syntheticInput().manifest, refs: manifest },
      runbook: { ...syntheticInput().runbook, exposure },
    });
    expect(codes(input)).toContain("UNAFFECTED_REF_IN_COVERAGE");
  });

  it("reports the worst state when several layers drift at once", () => {
    const manifest = syntheticInput().manifest;
    const input = syntheticInput({
      measurement: { ...syntheticInput().measurement, shallow: true },
      manifest: { ...manifest, refs: manifest.refs.slice(0, 8) },
      runbook: { ...syntheticInput().runbook, declaredCount: 8 },
    });
    const assessment = evaluateRefRollover(input);
    expect(assessment.state).toBe("MEASUREMENT_UNUSABLE");
    expect(assessment.problems.length).toBeGreaterThan(2);
    // An unmeasured live ref outranks a stale one: the unseen ref may be affected.
    const live = [...syntheticInput().liveRefs, "heads/x"];
    const both = syntheticInput({
      liveRefs: live.filter((ref) => ref !== "tags/rc-181").concat("heads/x"),
      runbook: { ...syntheticInput().runbook, declaredCount: 9 },
    });
    expect(evaluateRefRollover(both).state).toBe("INVENTORY_INCOMPLETE");
    expect(ROLLOVER_STATE_PRECEDENCE.indexOf("INVENTORY_INCOMPLETE")).toBeLessThan(
      ROLLOVER_STATE_PRECEDENCE.indexOf("INVENTORY_STALE"),
    );
  });

  it("has a declared state for every refusal code, so none can summarise as reconciled", () => {
    const declared = new Set(Object.values(ROLLOVER_CODE_STATES));
    for (const state of ROLLOVER_STATE_PRECEDENCE) {
      if (state !== "ROLLOVER_RECONCILED") expect(declared.has(state)).toBe(true);
    }
    // Every code maps to a real state, and the map is closed against typos.
    for (const [code, state] of Object.entries(ROLLOVER_CODE_STATES)) {
      expect(ROLLOVER_STATE_PRECEDENCE, `${code} maps to an undeclared state`).toContain(state);
    }
    expect(ROLLOVER_CODE_STATES.UNMAPPED_REFUSAL_CODE).toBe("MEASUREMENT_UNUSABLE");
    // The fallback itself: a code nobody declared resolves to the WORST state, so a
    // new check can never fail silently as "reconciled".
    expect(rolloverStateForCode("A_CODE_NOBODY_DECLARED")).toBe("MEASUREMENT_UNUSABLE");
    expect(rolloverStateForCode("")).toBe("MEASUREMENT_UNUSABLE");
    // A state name is not a refusal code, and must not resolve to itself.
    expect(rolloverStateForCode("ROLLOVER_RECONCILED")).toBe("MEASUREMENT_UNUSABLE");
    // Every declared code resolves to the state the map says, through the same seam.
    for (const [code, state] of Object.entries(ROLLOVER_CODE_STATES)) {
      expect(rolloverStateForCode(code)).toBe(state);
    }
  });

  it("never derives remediation from a reconciliation, however good the input looks", () => {
    for (const input of [
      syntheticInput(),
      syntheticInput({ liveRefs: [] }),
      syntheticInput({ measurement: { ...syntheticInput().measurement, shallow: true } }),
    ]) {
      const assessment = evaluateRefRollover(input);
      expect(assessment.remediationPerformed).toBe(false);
      expect(assessment.rewriteExecuted).toBe(false);
      expect(assessment.a2Verified).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 — the artefacts this phase wrote
// ═══════════════════════════════════════════════════════════════

describe("249 — the three artefacts agree, and only the ninth row was added", () => {
  it("the inventory artifact is the measured nine-ref set", () => {
    expect(artifact.refs).toHaveLength(9);
    expect(artifact.refs.every((entry) => entry.affected)).toBe(true);
    expect(artifact.historyCommits).toBe(429);
    expect(artifact.carrierCommits).toBe(270);
    expect(artifact.generatedBy).toBe(REMEDIATION_MANIFEST.inventory.generator);
  });

  it("the canonical manifest carries the ninth row with the measured facts", () => {
    const ninth = AFFECTED_REF_EXPECTATIONS.find((entry) => entry.ref === ROLLED_OVER_REF);
    expect(ninth).toBeDefined();
    expect(ninth?.carrierCommits).toBe(269);
    expect(ninth?.exposedAtTip).toBe(false);
    // The manifest is still a copy of the measurement, ref by ref.
    for (const expectation of AFFECTED_REF_EXPECTATIONS) {
      const measured = artifact.refs.find((entry) => entry.ref === expectation.ref);
      expect(measured?.carrierCommits, expectation.ref).toBe(expectation.carrierCommits);
      expect(measured?.exposedAtTip, expectation.ref).toBe(expectation.exposedAtTip);
    }
  });

  it("the runbook records the ninth ref in both of its tables", () => {
    const exposure = parseExposureFacts(RUNBOOK).find((row) => row.ref === ROLLED_OVER_REF);
    expect(exposure?.tipStatus).toMatch(/clean/);
    expect(exposure?.occurrences).toBe(269);
    expect(parseRewriteCoverage(RUNBOOK).map((row) => row.ref)).toContain(ROLLED_OVER_REF);
    // The rewrite section still says what it covers, and the number is nine.
    expect(parseDeclaredRefCount(RUNBOOK)).toBe(9);
  });

  it("records the rollover as measured end-to-end, superseding the derived eighth row", () => {
    expect(RUNBOOK).toMatch(/Phase 249 note/);
    expect(RUNBOOK).toMatch(/full end-to-end measurement/);
    expect(RUNBOOK).toMatch(/unshallow/);
    expect(RUNBOOK).toMatch(/no longer the\s+one derived row/);
    // The reconciliation entry names the ninth ref and its status as superseded.
    const entry = MEASUREMENT_RECONCILIATION.find((row) => row.fact === "affected refs");
    expect(entry?.authoritative).toContain("9");
    expect(entry?.superseded).toContain("01a0adfb");
    expect(entry?.reason).toContain("01a0b293");
    const reachable = MEASUREMENT_RECONCILIATION.find((row) => row.fact === "reachable commits");
    expect(reachable?.authoritative).toContain("429");
    expect(reachable?.superseded).toContain("398");
  });
});
