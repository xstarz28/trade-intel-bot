/**
 * Phase 242 — the release boundary.
 *
 * This file is the release path. Ordinary development CI runs it in `verify`
 * mode, where it asserts that the admission MACHINERY behaves — the current
 * release is refused, and the refusal is derived from evidence — and is green
 * while the release is blocked, because a red development pipeline for an
 * external blocker teaches people to ignore red.
 *
 * The release workflow (`.github/workflows/release-admission.yml`, tags and
 * manual dispatch only) runs the same file in `require` mode, where the only
 * acceptable outcome is an admission. Until every mandatory prerequisite is
 * verified, that job fails — which is the correct statement about this release,
 * not a defect in the pipeline. The distinction is the whole phase:
 *
 *   `verify`   → "the gate works"                     (green today)
 *   `require`  → "the gate admits THIS release"       (refused today, by design)
 *   `report`   → "what the gate says, for a human"    (display only)
 *
 * An unknown mode fails: a typo must not silently downgrade to report-and-pass.
 *
 * Every test in this file runs under the repository's hermetic network guard
 * (`src/test-network-guard.ts`), which fails any non-loopback connection, so the
 * release gate is proven not to need a provider call.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentReleaseVerdict } from "./release-current-state";
import { RELEASE_PREREQUISITES } from "./release-gate";
import {
  evaluateReleaseAdmission,
  formatReleaseAdmissionReport,
  releaseAdmissionExitCode,
  releaseAdmissionJson,
  resolveCandidateIdentity,
} from "./release-admission";

const MODE = (process.env.RELEASE_ADMISSION ?? "verify").trim().toLowerCase();
const KNOWN_MODES = ["verify", "require", "report"] as const;

/** CI step summaries, when a runner provides one. Best-effort by design. */
function summarise(title: string, body: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, `## ${title}\n\n\`\`\`\n${body}\`\`\`\n`);
  } catch {
    // A summary that cannot be written must never change the decision.
  }
}

/*
  The entry point resolves the candidate it is admitting: on a release tag the
  workflow supplies the tagged commit and ref, locally the reader falls back to
  the worktree sentinel it binds proofs to. The admission module itself reads no
  environment — it is handed this identity.
*/
const candidate = resolveCandidateIdentity({}, process.env);
const admission = evaluateReleaseAdmission(candidate);
const report = formatReleaseAdmissionReport(admission);
const mandatoryIds = RELEASE_PREREQUISITES.filter((entry) => entry.mandatory).map(
  (entry) => entry.id,
);

describe(`242 — release boundary (mode: ${MODE})`, () => {
  it("runs in a known mode", () => {
    expect(KNOWN_MODES).toContain(MODE);
  });

  if (MODE === "verify") {
    it("the gate refuses this release, and says why, without failing development CI", () => {
      summarise("Release admission (verify mode)", report);

      expect(admission.admitted).toBe(false);
      expect(admission.verdict).toBe("NOT READY");
      expect(releaseAdmissionExitCode(admission)).toBe(1);
      expect(admission.blockers.length).toBeGreaterThan(0);
      for (const blocker of admission.blockers) expect(mandatoryIds).toContain(blocker.id);
      expect(report).toMatch(/admitted: no/);
    });

    it("the refusal is the canonical verdict, not a message this file wrote", () => {
      const canonical = currentReleaseVerdict();
      expect(admission.verdict).toBe(canonical.verdict);
      expect(admission.blockers.map((blocker) => blocker.id).sort()).toEqual(
        [...canonical.blockers].sort(),
      );
    });

    it("verifying the machinery does not claim readiness for the product", () => {
      // The distinction this test exists for: a green `verify` run means the gate
      // behaves, and says nothing about whether the release is admissible.
      expect(report).toMatch(/NOT ADMITTED/);
      expect(admission.admitted).not.toBe(true);
    });
  }

  if (MODE === "require") {
    it("admits this release, or refuses it in the operator's words", () => {
      summarise("Release admission (require mode)", report);

      expect(
        admission.admitted,
        [
          "RELEASE ADMISSION REFUSED — this is the gate working, not a pipeline defect.",
          "",
          report,
          `structured: ${releaseAdmissionJson(admission)}`,
        ].join("\n"),
      ).toBe(true);
      expect(releaseAdmissionExitCode(admission)).toBe(0);
    });
  }

  if (MODE === "report") {
    it("reports what the gate says, and adds nothing to it", () => {
      summarise("Release admission (report mode)", report);
      // A human running this locally must see the verdict, not just a green test.
      process.stdout.write(`\n${report}\n`);

      const canonical = currentReleaseVerdict();
      const lines = report.split("\n");
      expect(lines).toContain(`verdict: ${canonical.verdict}`);
      expect(lines).toContain("admitted: no");
      expect(report).toContain(`candidate: ${admission.candidate.commit}`);
      expect(report).toContain("deploys nothing");
      for (const blocker of admission.blockers) expect(report).toContain(blocker.id);
      // Display mode never asserts an admission: it is not a gate.
      expect(JSON.parse(releaseAdmissionJson(admission))).toHaveProperty("admitted");
    });
  }
});
