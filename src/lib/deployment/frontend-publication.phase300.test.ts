/**
 * Phase 300 — the frontend publication gate, and the workflow that uses it.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * Phase 299 fixed the source of the artifact and proved the artifact correct;
 * the browser-facing site was still served by an external host that rebuilt
 * `main`. Publication is therefore a decision of its own, and its failure modes
 * are the quiet ones:
 *
 *   1. publishing without a source pin, so the site can silently become the
 *      legacy `main` scaffold again;
 *   2. publishing to nothing verifiable — an upload with no URL anyone fetches;
 *   3. skipping the upload because the host credential is missing and leaving
 *      the run green, which reads as "published" to everyone who looks at it.
 *
 * All three are structural, so they are checked structurally against the real
 * files, and the gate's behaviour is checked by execution because it is pure.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FRONTEND_PUBLICATION_GUARD_PRECEDENCE,
  FRONTEND_PUBLICATION_GUARD_SCHEMA,
  evaluateFrontendPublicationGuard,
} from "./frontend-publication-guard";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const WORKFLOW = ".github/workflows/publish-development-frontend.yml";
const SCRIPT = "scripts/frontend-publication-guard.mjs";
const PINNED = "arena/01a0d195-trade-intel-bot";

const READY = {
  sourceRef: `refs/heads/${PINNED}`,
  requiredSourceBranch: PINNED,
  hostUrl: "https://trade-intel-bot.example.app",
  mode: "publish" as const,
  hostCredential: { tokenPresent: true, projectPresent: true, orgPresent: true },
};

describe("300 — publication is refused unless it can be proven afterwards", () => {
  it("is ready only with the pinned ref, a browser-facing origin and a credential", () => {
    const report = evaluateFrontendPublicationGuard(READY);
    expect(report.schema).toBe(FRONTEND_PUBLICATION_GUARD_SCHEMA);
    expect(report.state).toBe("READY_TO_PUBLISH");
    expect(report.mayPublish).toBe(true);
    // Permission to attempt is never a result.
    expect(report.publicationPerformed).toBe(false);
    expect(report.frontendVerified).toBe(false);
    expect(report.problems).toEqual([]);
  });

  it("refuses main, by the repository-wide rule, in every mode", () => {
    for (const mode of ["publish", "verify-only"] as const) {
      const report = evaluateFrontendPublicationGuard({
        ...READY,
        sourceRef: "refs/heads/main",
        mode,
      });
      expect(report.state).toBe("FORBIDDEN_SOURCE_REF");
      expect(report.mayPublish).toBe(false);
      expect(report.problems.join(" ")).toMatch(/main/);
    }
  });

  it("refuses every ref that is not the pin, and reports the pin it expected", () => {
    for (const ref of [
      "refs/heads/arena/01a08e67-trade-intel-bot",
      "refs/heads/phase-157-live-discovery-lifecycle",
      "refs/heads/other",
    ]) {
      const report = evaluateFrontendPublicationGuard({ ...READY, sourceRef: ref });
      expect(report.state, ref).toBe("WRONG_SOURCE_BRANCH");
      expect(report.mayPublish, ref).toBe(false);
    }
    // The pin is accepted in every spelling of the same ref.
    for (const ref of [PINNED, `refs/heads/${PINNED}`, `origin/${PINNED}`]) {
      expect(evaluateFrontendPublicationGuard({ ...READY, sourceRef: ref }).state, ref).toBe(
        "READY_TO_PUBLISH",
      );
    }
    expect(evaluateFrontendPublicationGuard({ ...READY, requiredSourceBranch: undefined }).state).toBe(
      "MISSING_SOURCE_PIN",
    );
  });

  it("refuses a publication with no URL anyone can fetch afterwards", () => {
    const report = evaluateFrontendPublicationGuard({ ...READY, hostUrl: undefined });
    expect(report.state).toBe("MISSING_HOST_URL");
    expect(report.mayPublish).toBe(false);
    // A non-https origin is not a browser-facing target.
    expect(evaluateFrontendPublicationGuard({ ...READY, hostUrl: "http://trade-intel-bot.example.app" }).state).toBe(
      "MISSING_HOST_URL",
    );
  });

  it("refuses to publish without the host credential rather than skipping the upload", () => {
    const report = evaluateFrontendPublicationGuard({
      ...READY,
      hostCredential: { tokenPresent: false, projectPresent: true, orgPresent: true },
    });
    expect(report.state).toBe("HOST_CREDENTIAL_ABSENT");
    expect(report.mayPublish).toBe(false);
    expect(report.problems.join(" ")).toMatch(/credential is absent/);
    // The URL is still verifiable — an operator can judge the live site even
    // when this run may not replace it.
    expect(report.mayVerify).toBe(true);
  });

  it("allows verification alone, which publishes nothing", () => {
    const report = evaluateFrontendPublicationGuard({
      ...READY,
      mode: "verify-only",
      hostCredential: { tokenPresent: false, projectPresent: false, orgPresent: false },
    });
    expect(report.state).toBe("READY_TO_VERIFY_ONLY");
    expect(report.mayPublish).toBe(false);
    expect(report.mayVerify).toBe(true);
    expect(report.publicationPerformed).toBe(false);
  });

  it("takes the origin from a pasted deep link and says so instead of hiding it", () => {
    const report = evaluateFrontendPublicationGuard({
      ...READY,
      hostUrl: "https://trade-intel-bot.example.app/some/page?x=1",
    });
    expect(report.hostUrl).toBe("https://trade-intel-bot.example.app");
    expect(report.hostUrlIgnoredPath).toBe("/some/page?x=1");
  });

  it("never reports or echoes a credential value", () => {
    const report = evaluateFrontendPublicationGuard(READY);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/token"\s*:\s*"(?!true|false)/);
    expect(Object.keys(report.hostCredential).sort()).toEqual(["orgPresent", "projectPresent", "tokenPresent"]);
    // Values are not part of the input contract at all.
    expect(serialized.toLowerCase()).not.toContain("bearer");
  });

  it("declares its precedence, with the ref rules ahead of the credential rule", () => {
    expect(FRONTEND_PUBLICATION_GUARD_PRECEDENCE.indexOf("FORBIDDEN_SOURCE_REF")).toBeLessThan(
      FRONTEND_PUBLICATION_GUARD_PRECEDENCE.indexOf("HOST_CREDENTIAL_ABSENT"),
    );
    expect(FRONTEND_PUBLICATION_GUARD_PRECEDENCE.indexOf("MISSING_SOURCE_PIN")).toBe(0);
  });
});

describe("300 — the publication workflow is a real, pinned, verifiable path", () => {
  it("exists, is manual-only, and confirms before replacing a live site", () => {
    expect(existsSync(resolve(root, WORKFLOW))).toBe(true);
    const wf = read(WORKFLOW);
    expect(wf).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(wf).not.toMatch(/^\s*push:/m);
    expect(wf).not.toMatch(/^\s*pull_request:/m);
    expect(wf).toMatch(/PUBLISH_FRONTEND/);
    expect(wf).toMatch(/environment: development/);
  });

  it("runs the guard with the pin, the target and the mode", () => {
    const wf = read(WORKFLOW);
    expect(wf).toMatch(/npm run frontend:publish:guard/);
    expect(wf).toMatch(/--require-branch "\$XSTARZ_REQUIRED_SOURCE_BRANCH"/);
    expect(wf).toMatch(/--host-url "\$XSTARZ_FRONTEND_HOST_URL"/);
    expect(wf).toMatch(/--mode "\$XSTARZ_FRONTEND_MODE"/);
  });

  it("handles the credential by presence only, and never through argv", () => {
    const wf = read(WORKFLOW);
    expect(wf).toMatch(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
    expect(wf).toMatch(/if \[ -n "\$VERCEL_TOKEN" \]/);
    expect(wf).not.toMatch(/--token/);
  });

  it("keeps the guard script runnable and free of credential values", () => {
    const script = read(SCRIPT);
    // Presence booleans only — the script must never read a value into output.
    expect(script).toMatch(/tokenPresent: Boolean\(/);
    expect(script).not.toMatch(/process\.stdout\.write\([^)]*VERCEL_TOKEN/);
    expect(script).toMatch(/process\.exit\(ready \? 0 : 1\)/);
  });
});
