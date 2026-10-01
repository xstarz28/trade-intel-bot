/**
 * Phase 300 — resolving the host identifiers, and the one-command publication.
 *
 * WHY THESE ASSERTIONS EXIST
 * --------------------------
 * A publication needs three values — which account, which project, which
 * browser-facing URL. Two ways to get them are unacceptable: inventing them, and
 * publishing to whichever project happens to come back first. The resolver
 * therefore has to be checkable on the cases that matter:
 *
 *   · a project that LINKS this repository is chosen over a name coincidence;
 *   · several matches, or none, is a refusal that names the candidates;
 *   · the host URL comes from the project's own data, and an explicit host the
 *     project does not serve is refused rather than trusted;
 *   · with no credential the resolver reports exactly that — exit 2, and no
 *     identifier printed as if it were known.
 *
 * The publisher is checked structurally for the same reason the workflow is:
 * the order (verify → upload the same bytes → alias → fetch the public URL) is
 * the guarantee, and a reordering would silently weaken it.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  chooseHostUrl,
  dedupeProjects,
  dedupeSummary,
  projectDomains,
  resolveVercelTarget,
  scopeForProject,
  selectVercelProject,
} from "../../../scripts/resolve-vercel-target.mjs";
import { artifactFingerprint, deploymentUrlFrom } from "../../../scripts/publish-frontend.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const REPO = "xstarz28/trade-intel-bot";

describe("300 — the host project is identified by evidence, never by hope", () => {
  it("prefers the project that LINKS this repository", () => {
    const projects = [
      { id: "prj_a", name: "trade-intel-bot", link: { type: "github", repo: REPO } },
      { id: "prj_b", name: "trade-intel-bot", link: null },
    ];
    const selection = selectVercelProject({ projects, expectedName: "trade-intel-bot", repoFullName: REPO });
    expect(selection.chosen?.id).toBe("prj_a");
    expect(selection.matchedBy).toBe("git-link");
  });

  it("accepts a unique name match when nothing links the repository", () => {
    const projects = [
      { id: "prj_a", name: "trade-intel-bot" },
      { id: "prj_b", name: "something-else" },
    ];
    const selection = selectVercelProject({ projects, expectedName: "trade-intel-bot", repoFullName: REPO });
    expect(selection.chosen?.id).toBe("prj_a");
    expect(selection.matchedBy).toBe("name");
  });

  it("refuses several matches, and names them", () => {
    const projects = [
      { id: "prj_a", name: "trade-intel-bot", link: { type: "github", repo: REPO } },
      { id: "prj_b", name: "trade-intel-bot", link: { type: "github", repo: REPO } },
    ];
    const selection = selectVercelProject({ projects, expectedName: "trade-intel-bot", repoFullName: REPO });
    expect(selection.chosen).toBeNull();
    expect(selection.problem).toMatch(/refusing to choose/);
    expect(selection.problem).toContain("prj_a");
    expect(selection.problem).toContain("prj_b");
  });

  it("refuses when nothing matches, and names what it saw", () => {
    const projects = [{ id: "prj_x", name: "unrelated" }];
    const selection = selectVercelProject({ projects, expectedName: "trade-intel-bot", repoFullName: REPO });
    expect(selection.chosen).toBeNull();
    expect(selection.problem).toMatch(/no project in this scope is named trade-intel-bot/);
  });

  it("does not match a repo with a similar name", () => {
    const projects = [{ id: "prj_a", name: "trade-intel-bot", link: { type: "github", repo: "someone/trade-intel-bot-fork" } }];
    const selection = selectVercelProject({ projects, expectedName: "other-name", repoFullName: REPO });
    expect(selection.chosen).toBeNull();
  });
});

describe("300 — the browser-facing URL is read from the project, not composed", () => {
  it("collects aliases and domains once each, lower-cased", () => {
    const domains = projectDomains(
      { alias: ["Trade-Intel-Bot.vercel.app"], targets: { production: { alias: ["trade-intel-bot.freebuff.app"] } } },
      [{ name: "trade-intel-bot.freebuff.app", verified: true }, { name: "", verified: true }],
    );
    expect(domains.map((d: { name: string }) => d.name)).toEqual(["trade-intel-bot.vercel.app", "trade-intel-bot.freebuff.app"]);
  });

  it("prefers a verified custom domain over the vercel.app alias", () => {
    const chosen = chooseHostUrl({
      explicit: null,
      domains: [
        { name: "trade-intel-bot.vercel.app", source: "project alias", verified: true },
        { name: "trade-intel-bot.freebuff.app", source: "project domain", verified: true },
      ],
    });
    expect(chosen.hostUrl).toBe("https://trade-intel-bot.freebuff.app");
    expect(chosen.source).toMatch(/project's own domain/);
  });

  it("falls back to the project's own production alias", () => {
    const chosen = chooseHostUrl({
      explicit: null,
      domains: [{ name: "trade-intel-bot.vercel.app", source: "project alias", verified: true }],
    });
    expect(chosen.hostUrl).toBe("https://trade-intel-bot.vercel.app");
  });

  it("reports the missing prerequisite when the project lists no host at all", () => {
    const chosen = chooseHostUrl({ explicit: null, domains: [] });
    expect(chosen.hostUrl).toBeNull();
    expect(chosen.problem).toMatch(/no verified domain or production alias/);
  });

  it("accepts an explicit host only when the project serves it", () => {
    const listed = chooseHostUrl({
      explicit: "https://trade-intel-bot.freebuff.app/",
      domains: [{ name: "trade-intel-bot.freebuff.app", source: "project domain", verified: true }],
    });
    expect(listed.hostUrl).toBe("https://trade-intel-bot.freebuff.app");

    const unlisted = chooseHostUrl({ explicit: "https://some-other-site.example", domains: [] });
    expect(unlisted.hostUrl).toBeNull();
    expect(unlisted.problem).toMatch(/not among the project's domains/);

    const forced = chooseHostUrl({ explicit: "https://some-other-site.example", domains: [], allowUnverifiedHost: true });
    expect(forced.hostUrl).toBe("https://some-other-site.example");
    expect(forced.source).toMatch(/NOT listed/);
  });
});

describe("300 — the resolver refuses, loudly, when it cannot know", () => {
  it("exits 2 with NO_CREDENTIAL and resolves nothing", () => {
    const result = spawnSync("node", ["scripts/resolve-vercel-target.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    // Exit 2 means "could not evaluate", which is NOT a result about any site.
    expect(result.status).toBe(2);
    const output = result.stdout;
    expect(output).toContain("NO_CREDENTIAL");
    expect(output).toContain("VERCEL_ORG_ID: (not resolved)");
    expect(output).toContain("VERCEL_PROJECT_ID: (not resolved)");
    expect(output).toContain("FRONTEND_HOST_URL: (not resolved)");
  });

  it("never prints the credential it is given", () => {
    const source = read("scripts/resolve-vercel-target.mjs");
    // The token reaches the API call and nothing else.
    expect(source).not.toMatch(/console\.log\([^)]*token/);
    expect(source).not.toMatch(/authorization:\s*`Bearer \$\{token\}`[^\n]*\n[^\n]*console/);
    expect(source).toMatch(/authorization: `Bearer \$\{token\}`/);
  });
});

/* ------------------------------------------------------------------ *
 * The operator's runtime failure: one project, two scopes
 * ------------------------------------------------------------------ */

const PROJECT_ID = "prj_ms5x9MGeIkAQ1kvi5iBrgRBItJEb";
const TEAM_ID = "team_xstarz";
const USER_ID = "user_xstarz28";
const PERSONAL = { kind: "personal" as const, id: USER_ID, label: "personal account xstarz28" };
const TEAM = { kind: "team" as const, id: TEAM_ID, label: "team xstarz" };

type StubProject = {
  id: string;
  name: string;
  accountId?: string;
  link?: { type: string; repo: string } | null;
  __scope: { kind: string; id: string; label?: string };
};
type StubDomain = { name: string; verified?: boolean };

/** A Vercel API stub that answers exactly the routes the resolver reads. */
function fakeVercel(
  options: {
    projects?: StubProject[];
    domains?: StubDomain[];
    detail?: Record<string, unknown> | null;
    domainStatus?: number;
  } = {},
) {
  const { projects = [], domains = [], detail = null, domainStatus = 200 } = options;
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const path = String(url).replace("https://api.vercel.com", "");
    calls.push(path);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/v2/user")) return json({ user: { id: USER_ID, username: "xstarz28" } });
    if (path.startsWith("/v2/teams")) return json({ teams: [{ id: TEAM_ID, slug: "xstarz" }] });
    if (path.startsWith("/v9/projects/") && path.includes("/domains")) {
      return new Response(JSON.stringify({ domains }), { status: domainStatus });
    }
    if (path.startsWith("/v9/projects/")) {
      return json({ project: detail ?? { id: PROJECT_ID, name: "trade-intel-bot" } });
    }
    if (path.startsWith("/v9/projects")) {
      const teamScoped = path.includes(`teamId=${TEAM_ID}`);
      const list = projects.filter((p) => (teamScoped ? p.__scope.id === TEAM_ID : p.__scope.id === USER_ID));
      return json({ projects: list.map(({ __scope: _scope, ...rest }) => rest) });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("300 — one project returned by two scopes is ONE project (the operator's failure)", () => {
  it("collapses identical records across scopes instead of refusing", () => {
    const record = { id: PROJECT_ID, name: "trade-intel-bot" };
    const deduped = dedupeProjects([
      { ...record, __scope: PERSONAL },
      { ...record, __scope: TEAM },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe(PROJECT_ID);
    expect((deduped[0].__scopes ?? []).map((s: { kind: string }) => s.kind)).toEqual(["personal", "team"]);
    expect(dedupeSummary([record, record], deduped)).toEqual({
      rawRecords: 2,
      distinctProjects: 1,
      collapsed: 1,
    });
  });

  it("resolves the identical-project case end to end: one candidate, RESOLVED with a host", async () => {
    const record = {
      id: PROJECT_ID,
      name: "trade-intel-bot",
      accountId: TEAM_ID,
      link: { type: "github", repo: REPO },
    };
    const { fetchImpl, calls } = fakeVercel({
      projects: [
        { ...record, __scope: PERSONAL },
        { ...record, __scope: TEAM },
      ],
      domains: [{ name: "trade-intel-bot.freebuff.app", verified: true }],
      detail: record,
    });
    const report = await resolveVercelTarget({
      argv: [],
      env: { VERCEL_TOKEN: "token-not-printed" },
      fetchImpl,
    });
    expect(report.state).toBe("RESOLVED");
    expect(report.orgId).toBe(TEAM_ID);
    expect(report.orgKind).toBe("team");
    expect(report.orgSource).toMatch(/accountId/);
    expect(report.projectId).toBe(PROJECT_ID);
    expect(report.hostUrl).toBe("https://trade-intel-bot.freebuff.app");
    expect(report.dedupe).toEqual({ rawRecords: 2, distinctProjects: 1, collapsed: 1 });
    // The provenance of the decision is in the evidence, not implied.
    expect((report.evidence ?? []).join("\n")).toMatch(/deduped 2 project record\(s\).*into 1 distinct project id/);
    // Both scopes were actually searched, and the team scope carried the id.
    expect(calls.some((c) => c.includes(`teamId=${TEAM_ID}`))).toBe(true);
    // Nothing about the token can appear in the report.
    expect(JSON.stringify(report)).not.toContain("token-not-printed");
  });

  it("uses the personal scope as org id when that is where the project lives", async () => {
    const record = { id: PROJECT_ID, name: "trade-intel-bot" };
    const { fetchImpl } = fakeVercel({
      projects: [{ ...record, __scope: PERSONAL }],
      domains: [{ name: "trade-intel-bot.vercel.app", verified: true }],
      detail: record,
    });
    const report = await resolveVercelTarget({ argv: [], env: { VERCEL_TOKEN: "t" }, fetchImpl });
    expect(report.state).toBe("RESOLVED");
    expect(report.orgId).toBe(USER_ID);
    expect(report.orgKind).toBe("personal");
  });

  it("says so when the host does not exist yet, instead of composing one", async () => {
    const record = { id: PROJECT_ID, name: "trade-intel-bot", accountId: TEAM_ID };
    const { fetchImpl } = fakeVercel({
      projects: [{ ...record, __scope: TEAM }],
      domains: [],
      detail: record,
    });
    const report = await resolveVercelTarget({ argv: [], env: { VERCEL_TOKEN: "t" }, fetchImpl });
    expect(report.state).toBe("HOST_NOT_DISCOVERABLE");
    expect(report.projectId).toBe(PROJECT_ID);
    expect(report.hostUrl).toBeNull();
    expect((report.problems ?? []).join(" ")).toMatch(/no verified domain or production alias/);
  });

  it("still refuses two DISTINCT projects that share a name", async () => {
    const { fetchImpl } = fakeVercel({
      projects: [
        { id: "prj_one", name: "trade-intel-bot", __scope: PERSONAL },
        { id: "prj_two", name: "trade-intel-bot", __scope: TEAM },
      ],
    });
    const report = await resolveVercelTarget({ argv: [], env: { VERCEL_TOKEN: "t" }, fetchImpl });
    expect(report.state).toBe("PROJECT_NOT_IDENTIFIED");
    expect(report.dedupe?.distinctProjects).toBe(2);
    expect((report.problems ?? []).join(" ")).toMatch(/refusing to choose/);
    expect((report.candidates ?? []).map((c: { id?: string | null }) => c.id).sort()).toEqual([
      "prj_one",
      "prj_two",
    ]);
  });

  it("still refuses two DISTINCT projects linked to the same repository", async () => {
    const { fetchImpl } = fakeVercel({
      projects: [
        { id: "prj_one", name: "trade-intel-bot", link: { type: "github", repo: REPO }, __scope: PERSONAL },
        { id: "prj_two", name: "trade-intel-bot-old", link: { type: "github", repo: REPO }, __scope: TEAM },
      ],
    });
    const report = await resolveVercelTarget({ argv: [], env: { VERCEL_TOKEN: "t" }, fetchImpl });
    expect(report.state).toBe("PROJECT_NOT_IDENTIFIED");
    expect((report.problems ?? []).join(" ")).toMatch(/link the repository/);
  });

  it("never merges records that have no id, and never merges different ids", () => {
    const merged = dedupeProjects([
      { name: "trade-intel-bot", __scope: PERSONAL },
      { name: "trade-intel-bot", __scope: TEAM },
      { id: "prj_a", name: "x" },
      { id: "prj_b", name: "x" },
    ]);
    // The two unnamed records stay two (identity cannot be proven), the two ids
    // stay two as well.
    expect(merged).toHaveLength(4);
  });

  it("keeps the git link stronger than the name after deduplication", () => {
    const linked = { id: "prj_linked", name: "something-else", link: { type: "github", repo: REPO } };
    const named = { id: "prj_named", name: "trade-intel-bot" };
    const deduped = dedupeProjects([
      { ...linked, __scope: PERSONAL },
      { ...named, __scope: TEAM },
    ]);
    const selection = selectVercelProject({ projects: deduped, expectedName: "trade-intel-bot", repoFullName: REPO });
    expect(selection.chosen?.id).toBe("prj_linked");
    expect(selection.matchedBy).toBe("git-link");
  });

  it("reports VERCEL_ORG_ID as undeterminable rather than guessing it", () => {
    const project = { id: "prj_a", __scopes: [{ kind: "team", id: "team_1" }, { kind: "team", id: "team_2" }] };
    const choice = scopeForProject(project, { personalId: USER_ID });
    expect(choice.scope).toBeNull();
    expect(choice.problem).toMatch(/cannot be determined/);
    // With the accountId present, the host's own statement decides it.
    const certain = scopeForProject({ ...project, accountId: "team_2" }, { personalId: USER_ID });
    expect(certain.scope?.id).toBe("team_2");
    expect(certain.certain).toBe(true);
  });

  it("does not mutate its inputs or touch the network in the pure helpers", () => {
    const input = [{ id: "prj_a", name: "n", __scope: PERSONAL }];
    const snapshot = JSON.stringify(input);
    dedupeProjects(input);
    selectVercelProject({ projects: dedupeProjects(input), expectedName: "n", repoFullName: REPO });
    expect(JSON.stringify(input)).toBe(snapshot);
    const script = read("scripts/resolve-vercel-target.mjs");
    // Read-only: no write verbs anywhere in the resolver.
    for (const forbidden of ["POST", "PUT", "PATCH", "DELETE", "createProject", "deleteProject", "unlink"]) {
      expect(script).not.toMatch(new RegExp(`["'\`]${forbidden}["'\`]`));
    }
  });
});

describe("300 — the one-command publication keeps the verified bytes and proves the result", () => {
  it("reads the deployment URL from the host CLI's last https line", () => {
    const stdout = [
      "Vercel CLI 48.0.0",
      "Inspect: https://vercel.com/team/project/abc",
      "https://trade-intel-bot-abc123.vercel.app",
    ].join("\n");
    expect(deploymentUrlFrom(stdout)).toBe("https://trade-intel-bot-abc123.vercel.app");
    expect(deploymentUrlFrom("no url here")).toBeNull();
  });

  it("fingerprints the artifact that will be uploaded", () => {
    const dir = mkdtempSync(join(tmpdir(), "phase300-dist-"));
    const info = {
      schema: "xstarz.build-info/v1",
      commit: "7684323b7de578906038cf2c9e08bf2e9290bc2c",
      shortCommit: "7684323b",
      branch: "arena/01a0d195-trade-intel-bot",
      builtAt: "2026-09-30T06:59:32.000Z",
      source: "git",
      worktreeDirty: false,
      unsafeSource: false,
    };
    writeFileSync(join(dir, "build-info.json"), `${JSON.stringify(info)}\n`);
    writeFileSync(join(dir, "index.html"), '<script src="/assets/index-abc.js"></script><link href="/assets/index-abc.css">');
    const fingerprint = artifactFingerprint(dir);
    expect(fingerprint?.buildInfo.commit).toBe(info.commit);
    expect(fingerprint?.entry).toBe("assets/index-abc.js,assets/index-abc.css");
    expect(fingerprint?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifactFingerprint(mkdtempSync(join(tmpdir(), "phase300-empty-")))).toBeNull();
  });

  it("keeps the order: verify the artifact, upload the same bytes, alias the host, fetch the public URL", () => {
    const source = read("scripts/publish-frontend.mjs");
    const verifyArtifact = source.indexOf("scripts/verify-frontend-artifact.mjs");
    // The call site, not the import line at the top of the file.
    const upload = source.indexOf("prebuiltDeployArgs({");
    // 300e: alias through the teamId-scoped REST API (vercel/vercel#17506)
    const alias = source.indexOf("/aliases?teamId=");
    const verifyPublished = source.indexOf("scripts/verify-published-frontend.mjs");
    for (const at of [verifyArtifact, upload, alias, verifyPublished]) expect(at).toBeGreaterThan(-1);
    expect(verifyArtifact).toBeLessThan(upload);
    expect(upload).toBeLessThan(alias);
    expect(alias).toBeLessThan(verifyPublished);
    // Never a token on argv, and the acceptance failure fails the command.
    expect(source).not.toMatch(/--token/);
    expect(source).toMatch(/the published URL did not pass the acceptance check/);
  });

  it("is wired as npm scripts, and the workflow resolves identifiers it was not given", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["frontend:resolve"]).toBe("node scripts/resolve-vercel-target.mjs");
    expect(pkg.scripts["frontend:publish"]).toContain("scripts/publish-frontend.mjs");

    const wf = read(".github/workflows/publish-development-frontend.yml");
    expect(wf).toMatch(/npm run frontend:resolve/);
    expect(wf).toMatch(/VERCEL_ORG_ID=\$org/);
    expect(wf).toMatch(/XSTARZ_FRONTEND_HOST_URL=\$host/);
    // The documented dispatch limitation is stated where a reader will hit it.
    expect(wf).toMatch(/DEFAULT branch/);
    expect(read("docs/FRONTEND-PUBLICATION.md")).toMatch(/npm run frontend:publish/);
  });
});
