/**
 * Phase 300c — a PINNED Vercel target is a CLAIM, and it is checked against
 * the credential BEFORE a build is invested in it.
 *
 * Production finding (run 36823507179): the publication's pinned path exported
 * VERCEL_ORG_ID / VERCEL_PROJECT_ID / host from environment variables and
 * trusted them blindly, so `vercel deploy --prebuilt` became the FIRST place
 * the token was checked against the identifiers — and failed there with the
 * opaque "Error: Could not retrieve Project Settings." ("To link your Project,
 * remove the .vercel directory…"), which misdiagnoses a credential/scope
 * mismatch as a stale local link.
 *
 * The fix under test — `scripts/verify-vercel-project-access.mjs` — performs
 * the SAME read-only "project settings" retrieval the host CLI performs
 * (`GET /v9/projects/<id>?teamId=<orgId>`) and CLASSIFIES the outcome:
 *
 *   401/403 → TOKEN_CANNOT_ACCESS_ORG  (regenerate/re-scope the token)
 *   404     → PROJECT_NOT_UNDER_ORG    (re-derive the ids, re-pin)
 *   other   → PROJECT_SETTINGS_UNREACHABLE
 *   200 + host absent → HOST_NOT_ON_PROJECT
 *   200 + host listed → PROJECT_ACCESS_VERIFIED
 *
 * plus the workflow/publisher contract: the pinned branch must RUN this check,
 * must fail the run on refusal, and the token must stay environment-only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROJECT_ACCESS_STATES,
  exitCodeFor,
  verifyVercelProjectAccess,
} from "../../../scripts/verify-vercel-project-access.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const ORG = "team_eDGLXdW7ZyigDFM57sqm6Pf0";
const PROJECT = "prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb";
const HOST = "https://trade-intel-bot.vercel.app";

const argvOf = (overrides: string[] = []) => [
  "--org-id",
  ORG,
  "--project-id",
  PROJECT,
  "--host-url",
  HOST,
  ...overrides,
];

/** The pinned ids are identifiers, not credentials — token comes from env. */
const envOf = (token: string | undefined) => ({ VERCEL_TOKEN: token });

function fetchWith(body: unknown, status: number) {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as never;
}

describe("300c — pinned target verification classifies the run-36823507179 failure", () => {
  it("200 with the host listed on the project → PROJECT_ACCESS_VERIFIED", async () => {
    const fetchImpl = fetchWith(
      { name: "trade-intel-bot", alias: ["trade-intel-bot.vercel.app"] },
      200,
    );
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_test"),
      fetchImpl,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.VERIFIED);
    expect(report.httpStatus).toBe(200);
    expect(report.projectName).toBe("trade-intel-bot");
    expect(report.hostUrl).toBe(HOST);
    expect(report.evidence.join(" | ")).toContain("GET /v9/projects/");
    expect(exitCodeFor(report.state)).toBe(0);
  });

  it("403 → TOKEN_CANNOT_ACCESS_ORG: the token, not the identifiers, is the fault", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_revoked"),
      fetchImpl: fetchWith({ error: { code: "FORBIDDEN" } }, 403),
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG);
    expect(report.httpStatus).toBe(403);
    // Phase 300e: case A is only named with per-endpoint evidence (both reads
    // refused) — never a blanket 403 => "token wrong" (vercel/vercel#17506).
    expect(report.problems.join(" ")).toContain("with AND without the org scope");
    expect(exitCodeFor(report.state)).toBe(1);
  });

  it("401 → TOKEN_CANNOT_ACCESS_ORG as well", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_stale"),
      fetchImpl: fetchWith({ error: { code: "UNAUTHORIZED" } }, 401),
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG);
    expect(exitCodeFor(report.state)).toBe(1);
  });

  it("404 → PROJECT_NOT_UNDER_ORG: the pinned identifiers do not match the credential", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_other_account"),
      fetchImpl: fetchWith({ error: { code: "NOT_FOUND" } }, 404),
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.PROJECT_NOT_UNDER_ORG);
    expect(report.problems.join(" ")).toContain("frontend:resolve");
    expect(exitCodeFor(report.state)).toBe(1);
  });

  it("200 without the pinned host → HOST_NOT_ON_PROJECT (refused, never aliased blind)", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_test"),
      fetchImpl: fetchWith({ name: "trade-intel-bot", alias: ["other-project.vercel.app"] }, 200),
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.HOST_NOT_ON_PROJECT);
    expect(report.problems.join(" ")).toContain("does not serve");
    // An explicit operator override may accept it, disclosed as such.
    const accepted = await verifyVercelProjectAccess({
      argv: argvOf(["--allow-unverified-host"]),
      env: envOf("tok_test"),
      fetchImpl: fetchWith({ name: "trade-intel-bot", alias: ["other-project.vercel.app"] }, 200),
    });
    expect(accepted.state).toBe(PROJECT_ACCESS_STATES.VERIFIED);
    expect(accepted.evidence.join(" | ")).toContain("NOT listed");
  });

  it("no token → NO_CREDENTIAL (exit 2): presence was never the question, access is", async () => {
    const report = await verifyVercelProjectAccess({ argv: argvOf(), env: envOf(undefined) });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.NO_CREDENTIAL);
    expect(exitCodeFor(report.state)).toBe(2);
  });

  it("missing ids → INCOMPLETE_TARGET naming the exact missing identifier", async () => {
    const report = await verifyVercelProjectAccess({
      argv: ["--org-id", ORG],
      env: envOf("tok_test"),
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.INCOMPLETE_TARGET);
    expect(report.problems.join(" ")).toContain("VERCEL_PROJECT_ID/--project-id");
    expect(exitCodeFor(report.state)).toBe(1);
  });

  it("transport failure → API_UNREACHABLE (exit 2), status never invented", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_test"),
      fetchImpl: (async () => {
        throw new Error("getaddrinfo ENOTFOUND api.vercel.com");
      }) as never,
    });
    expect(report.state).toBe(PROJECT_ACCESS_STATES.API_UNREACHABLE);
    expect(report.httpStatus).toBeNull();
    expect(exitCodeFor(report.state)).toBe(2);
  });

  it("the token's value never reaches the report", async () => {
    const report = await verifyVercelProjectAccess({
      argv: argvOf(),
      env: envOf("tok_SUPER_SECRET_VALUE"),
      fetchImpl: fetchWith({ name: "trade-intel-bot", alias: ["trade-intel-bot.vercel.app"] }, 200),
    });
    expect(JSON.stringify(report)).not.toContain("tok_SUPER_SECRET_VALUE");
  });
});

describe("300c — the pinned path must never trust pinned identifiers blindly again", () => {
  const VERIFIER = "scripts/verify-vercel-project-access.mjs";
  const WORKFLOW = read(".github/workflows/publish-development-frontend.yml");
  const PUBLISHER = read("scripts/publish-frontend.mjs");

  it("the workflow's pinned branch runs the verifier with the pinned identifiers", () => {
    expect(WORKFLOW).toContain("verify-vercel-project-access.mjs");
    expect(WORKFLOW).toContain('--org-id "$XSTARZ_PINNED_ORG_ID"');
    expect(WORKFLOW).toContain('--project-id "$XSTARZ_PINNED_PROJECT_ID"');
    expect(WORKFLOW).toContain('--host-url "$XSTARZ_PINNED_HOST_URL"');
  });

  it("a refusal fails the run, with the failure modes named by the verifier evidence", () => {
    // Phase 300I-K: the runner fails with a pointer to the verifier's JSON
    // evidence instead of restating the taxonomy inline (which had drifted
    // once already); the named states live in the verifier itself.
    expect(WORKFLOW).toContain("Pinned Vercel target failed credential validation");
    expect(WORKFLOW).toContain("its JSON evidence is printed above");
    for (const named of ["TOKEN_CANNOT_ACCESS_ORG", "PROJECT_NOT_UNDER_ORG", "HOST_NOT_ON_PROJECT"]) {
      expect(read(VERIFIER)).toContain(named);
    }
  });

  it("the unpinned path still resolves from the credential (discovery unchanged)", () => {
    expect(WORKFLOW).toContain("npm run frontend:resolve");
  });

  it("the manual publisher's pinned branch verifies too, and refuses by state", () => {
    expect(PUBLISHER).toContain("verifyVercelProjectAccess(");
    expect(PUBLISHER).toContain("was rejected by the credential");
    expect(PUBLISHER).toContain("PROJECT_ACCESS_STATES.VERIFIED");
  });

  it("the token stays environment-only in both paths (never argv, never echoed)", () => {
    for (const [name, content] of [
      ["workflow", WORKFLOW],
      ["publisher", PUBLISHER],
    ] as const) {
      expect(content, name).not.toMatch(/--token/);
      expect(content, name).not.toContain('echo "$VERCEL_TOKEN"');
    }
    // The only token source in the workflow is the secret mapping.
    const mappings = WORKFLOW.match(/VERCEL_TOKEN: .*/g) ?? [];
    expect(mappings.length).toBeGreaterThan(0);
    for (const mapping of mappings) {
      expect(mapping).toContain("${{ secrets.VERCEL_TOKEN }}");
    }
  });
});
