#!/usr/bin/env node
/**
 * Phase 300 — resolve the three IDENTIFIERS a frontend publication needs, from
 * the host credential, deterministically and without guessing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The publication workflow needs three values:
 *
 *   VERCEL_ORG_ID       which account/team owns the existing host project
 *   VERCEL_PROJECT_ID   which project serves the browser-facing site
 *   FRONTEND_HOST_URL   the https origin a browser actually opens
 *
 * None of them may be invented, and a wrong project would publish the right
 * bytes to the wrong place — or worse, over someone else's site. So they are
 * READ from the API the credential authorises, with the credential's own scope
 * as the search space, and the result is accepted only when exactly one project
 * is positively identified as THIS repository's project.
 *
 * The token's VALUE is never printed, logged or written. Only non-secret
 * identifiers are printed — which is also why they are safe to pin as GitHub
 * Environment VARIABLES (they authorise nothing without the token).
 *
 * HOW A PROJECT IS IDENTIFIED (all evidence, no heuristics)
 * --------------------------------------------------------
 *   1. strengthen the identity — records returned by several listings (personal
 *      and team) are collapsed to one candidate by the project's own `id`, so
 *      the same project seen twice is not mistaken for two projects;
 *   2. strongest evidence — the project's Git link names this repository
 *      (`link.type === "github"` and `link.repo === "<owner>/<repo>"`);
 *   3. otherwise — the project's name equals the expected name, which defaults
 *      to the repository name read from `git remote.origin.url`;
 *   4. exactly one match, or the run FAILS and lists every candidate it saw.
 *      Distinct ids stay distinct: two projects with the same name, or two
 *      projects linking the same repository, are still refused.
 *
 * The host URL is likewise taken from the project's own data — a verified
 * custom domain if it has one, else the production alias the project reports.
 * When no host can be read from the project, the script says so instead of
 * composing one.
 *
 * SCOPE
 * -----
 * Read-only: `GET` on the account, team, project and domain lists. It never
 * creates, deploys, links, renames or deletes anything — a resolver that can
 * mutate is not a resolver.
 *
 * Usage:
 *   VERCEL_TOKEN=... node scripts/resolve-vercel-target.mjs
 *   VERCEL_TOKEN=... node scripts/resolve-vercel-target.mjs --expected-name trade-intel-bot
 *   VERCEL_TOKEN=... node scripts/resolve-vercel-target.mjs --host-url https://<host> --json
 *
 * Flags / env:
 *   --expected-name / XSTARZ_VERCEL_PROJECT_NAME   expected project name
 *   --team / XSTARZ_VERCEL_TEAM_ID                 restrict to one team scope
 *   --host-url / XSTARZ_FRONTEND_HOST_URL          assert/choose this origin
 *   --allow-unverified-host                        accept a host that is not
 *                                                  listed on the project
 *   --json                                         machine-readable output
 *
 * Exit codes:
 *   0 = resolved (orgId, projectId, hostUrl all read from the API)
 *   1 = refused (missing/ambiguous/wrong target — the report names it)
 *   2 = could not evaluate (no token, or the API could not be reached)
 */
import { gitOutput } from "./lib/executable.mjs";

export const VERCEL_API = "https://api.vercel.com";
export const VERCEL_TARGET_SCHEMA = "phase300.vercel-target/v1";

/* ------------------------------------------------------------------ *
 * Pure selection — testable without a network or a credential
 * ------------------------------------------------------------------ */

/**
 * Identify THIS repository's project among the projects a scope can see.
 *
 * Strengthened evidence first: a project whose Git link names this repository
 * is not a guess. Only when no project links this repository does the expected
 * NAME decide, and only when exactly one project carries it. Anything else —
 * zero matches, several matches — is a refusal that names the candidates.
 */
export function selectVercelProject({ projects, expectedName, repoFullName }) {
  const list = Array.isArray(projects) ? projects : [];
  const linked = repoFullName
    ? list.filter(
        (p) =>
          p?.link?.type === "github" &&
          String(p.link.repo ?? "").toLowerCase() === repoFullName.toLowerCase(),
      )
    : [];
  if (linked.length === 1) return { chosen: linked[0], matchedBy: "git-link", candidates: list };
  if (linked.length > 1) {
    return {
      chosen: null,
      matchedBy: null,
      candidates: list,
      problem: `${linked.length} projects in this scope link the repository ${repoFullName}: ${linked
        .map((p) => `${p.name} (${p.id})`)
        .join(", ")} — refusing to choose`,
    };
  }
  const named = expectedName ? list.filter((p) => p?.name === expectedName) : [];
  if (named.length === 1) return { chosen: named[0], matchedBy: "name", candidates: list };
  if (named.length > 1) {
    return {
      chosen: null,
      matchedBy: null,
      candidates: list,
      problem: `${named.length} projects are named ${expectedName}: ${named
        .map((p) => `${p.name} (${p.id})`)
        .join(", ")} — refusing to choose`,
    };
  }
  return {
    chosen: null,
    matchedBy: null,
    candidates: list,
    problem: expectedName
      ? `no project in this scope is named ${expectedName} or links ${repoFullName ?? "this repository"}`
      : "no expected project name was given and no project links this repository",
  };
}

/**
 * Collapse the SAME project seen through several scopes into ONE candidate.
 *
 * WHY: a Vercel project can be returned by more than one listing — the personal
 * scope and a team scope can both include it. Counting those as two candidates
 * makes an unambiguous project look like two projects that happen to share a
 * name, and the guard then refuses a publication it should have allowed. The
 * project's own `id` is the stable identity the host assigns, so it is the key.
 *
 * WHAT IS *NOT* MERGED:
 *   · different ids are always different projects — two projects with the same
 *     name, or two projects linking the same repository, stay ambiguous and are
 *     refused by `selectVercelProject`;
 *   · a record with no `id` cannot be proven identical to anything, so it is
 *     never merged (an absent identity is not a shared identity).
 *
 * Scope metadata is preserved (`__scopes`, in first-seen order) because the org
 * id has to be one of them, and the first occurrence's fields win so the result
 * does not depend on the order the API happened to answer.
 */
export function dedupeProjects(projects) {
  const byId = new Map();
  const withoutId = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    const id = typeof project?.id === "string" && project.id.trim() ? project.id : null;
    const scopesOf = (p) => {
      const scopes = Array.isArray(p?.__scopes) ? [...p.__scopes] : [];
      if (p?.__scope && !scopes.some((s) => s.kind === p.__scope.kind && s.id === p.__scope.id)) {
        scopes.push(p.__scope);
      }
      return scopes;
    };
    if (!id) {
      withoutId.push({ ...project, __scopes: scopesOf(project) });
      continue;
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { ...project, __scopes: scopesOf(project) });
      continue;
    }
    const merged = new Set([...existing.__scopes, ...scopesOf(project)].map((s) => `${s.kind}:${s.id}`));
    byId.set(id, {
      ...existing,
      __scopes: [...existing.__scopes, ...scopesOf(project)].filter(
        (s, i, all) => all.findIndex((o) => `${o.kind}:${o.id}` === `${s.kind}:${s.id}`) === i,
      ),
      __dedupedRecords: (existing.__dedupedRecords ?? 1) + 1,
      __mergedScopeCount: merged.size,
    });
  }
  return [...byId.values(), ...withoutId];
}

/** How many records collapsed into each distinct project id. */
export function dedupeSummary(rawProjects, dedupedProjects) {
  const raw = Array.isArray(rawProjects) ? rawProjects.length : 0;
  const distinct = Array.isArray(dedupedProjects) ? dedupedProjects.length : 0;
  return { rawRecords: raw, distinctProjects: distinct, collapsed: Math.max(0, raw - distinct) };
}

/**
 * Which scope owns the chosen project — i.e. the value `VERCEL_ORG_ID` must be.
 *
 * The project record's OWN `accountId` is authoritative when the API returns it,
 * because that is the host stating the owner; the enumerated scopes are then
 * only used to name it. When `accountId` is absent, one team scope is preferred
 * over the personal scope and the choice is DISCLOSED as a preference rather
 * than presented as a fact.
 */
export function scopeForProject(project, { personalId = null } = {}) {
  const scopes = Array.isArray(project?.__scopes)
    ? project.__scopes
    : project?.__scope
      ? [project.__scope]
      : [];
  const accountId = typeof project?.accountId === "string" && project.accountId.trim() ? project.accountId : null;
  if (accountId) {
    const known = scopes.find((s) => s.id === accountId) ?? null;
    const kind = known?.kind ?? (personalId && accountId === personalId ? "personal" : "team");
    return {
      scope: { kind, id: accountId, label: known?.label ?? `${kind} ${accountId}` },
      source: "the project record's own accountId",
      certain: true,
      scopes,
    };
  }
  const teamScopes = scopes.filter((s) => s.kind === "team");
  if (teamScopes.length === 1) {
    return { scope: teamScopes[0], source: "the single team scope that listed it", certain: true, scopes };
  }
  if (teamScopes.length > 1) {
    return {
      scope: null,
      source: null,
      certain: false,
      scopes,
      problem: `the project was listed under ${teamScopes.length} team scopes (${teamScopes
        .map((s) => s.label)
        .join(", ")}) and reports no accountId, so its owning scope cannot be determined`,
    };
  }
  const personal = scopes.find((s) => s.kind === "personal") ?? null;
  if (personal) {
    return { scope: personal, source: "the personal scope that listed it", certain: true, scopes };
  }
  return {
    scope: null,
    source: null,
    certain: false,
    scopes,
    problem: "the project was listed without a scope and reports no accountId, so VERCEL_ORG_ID cannot be determined",
  };
}

/**
 * A DNS hostname and nothing else — no scheme, path, credentials, spaces, quotes
 * or shell metacharacters.
 *
 * WHY THIS IS PART OF THE GUARD, NOT A NICETY: the browser-facing host is passed
 * to the host CLI's alias command, and on Windows that CLI is a `.cmd` run
 * through a shell (see `scripts/lib/executable.mjs`). A value that is a hostname
 * cannot break out of that command; anything else is refused before it gets near
 * a shell.
 */
export function isHostnameShaped(value) {
  const host = String(value ?? "").trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return false;
  return host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

/** The domains a project reports, from both the project object and `/domains`. */
export function projectDomains(project, domainList) {
  const out = [];
  const push = (name, source, verified) => {
    const value = String(name ?? "").trim().toLowerCase();
    // A domain that is not a hostname is not a browser-facing URL anyone can
    // open safely, so it is dropped rather than carried into the alias command.
    if (!value || !isHostnameShaped(value) || out.some((d) => d.name === value)) return;
    out.push({ name: value, source, verified: verified !== false });
  };
  const alias = project?.alias ?? project?.targets?.production?.alias ?? [];
  for (const name of Array.isArray(alias) ? alias : []) push(name, "project alias");
  for (const domain of Array.isArray(domainList) ? domainList : []) {
    push(domain?.name ?? domain?.domain, "project domain", domain?.verified !== false);
  }
  return out;
}

/**
 * Choose the browser-facing origin from the project's OWN data.
 *
 * An explicit value is honoured only when the project lists it (or when the
 * caller accepts an unlisted host); otherwise the first verified non-`vercel.app`
 * domain wins, then the project's own production alias. Nothing is composed:
 * if the project reports no host, the caller is told which prerequisite is
 * missing instead of being handed a plausible-looking URL.
 */
export function chooseHostUrl({ explicit, domains, allowUnverifiedHost }) {
  const list = Array.isArray(domains) ? domains : [];
  const clean = (value) => String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
  if (explicit) {
    const want = clean(explicit).replace(/^https?:\/\//, "");
    if (!isHostnameShaped(want)) {
      return {
        hostUrl: null,
        source: null,
        problem: `the configured host is not a hostname (${JSON.stringify(String(explicit))}) — refusing to hand a non-hostname to the host CLI`,
      };
    }
    const found = list.find((d) => d.name === want);
    if (found) return { hostUrl: `https://${want}`, source: `explicit, listed on the project (${found.source})` };
    if (allowUnverifiedHost) {
      return { hostUrl: `https://${want}`, source: "explicit, NOT listed on the project (accepted with --allow-unverified-host)" };
    }
    return {
      hostUrl: null,
      source: null,
      problem: `the configured host ${want} is not among the project's domains (${list.map((d) => d.name).join(", ") || "none"}) — refusing to publish to a host this project does not serve`,
    };
  }
  const custom = list.find((d) => d.verified && !d.name.endsWith(".vercel.app"));
  if (custom) return { hostUrl: `https://${custom.name}`, source: `project's own domain (${custom.source})` };
  const alias = list.find((d) => d.verified);
  if (alias) return { hostUrl: `https://${alias.name}`, source: `project's own alias (${alias.source})` };
  return {
    hostUrl: null,
    source: null,
    problem:
      "the project reports no verified domain or production alias, so the browser-facing URL is not yet discoverable — it exists only after a first deployment",
  };
}

/* ------------------------------------------------------------------ *
 * Read-only API access
 * ------------------------------------------------------------------ */

export async function vercelGet(path, { token, timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${VERCEL_API}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json, text: text.slice(0, 400) };
  } catch (error) {
    return { status: null, ok: false, json: null, text: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `owner/repo` from the checkout's origin, or null. Through the platform-safe
 * runner, so the resolver behaves the same from Windows CMD as from a shell
 * (see `scripts/lib/executable.mjs`).
 */
function repoFullNameFromGit() {
  const url = gitOutput(["config", "--get", "remote.origin.url"]);
  if (!url) return null;
  const match =
    url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i) ?? url.match(/^([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

/**
 * The whole resolution, with injectable argv/env/fetch so the operator's exact
 * situation can be reproduced in a test without a network or a credential.
 */
export async function resolveVercelTarget({ argv = [], env = process.env, fetchImpl = fetch } = {}) {
  const args = { expectedName: env.XSTARZ_VERCEL_PROJECT_NAME ?? null, teamId: env.XSTARZ_VERCEL_TEAM_ID ?? null, hostUrl: env.XSTARZ_FRONTEND_HOST_URL ?? null, allowUnverifiedHost: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--expected-name") args.expectedName = argv[++i];
    else if (arg.startsWith("--expected-name=")) args.expectedName = arg.split("=")[1];
    else if (arg === "--team") args.teamId = argv[++i];
    else if (arg.startsWith("--team=")) args.teamId = arg.split("=")[1];
    else if (arg === "--host-url") args.hostUrl = argv[++i];
    else if (arg.startsWith("--host-url=")) args.hostUrl = arg.split("=")[1];
    else if (arg === "--allow-unverified-host") args.allowUnverifiedHost = true;
    else if (arg === "--json") args.json = true;
  }
  if (!args.expectedName) args.expectedName = "trade-intel-bot";

  const token = env.VERCEL_TOKEN ?? "";
  if (!token.trim()) {
    return {
      state: "NO_CREDENTIAL",
      problems: ["VERCEL_TOKEN is not set, so the host account cannot be searched and no identifier can be read"],
      evidence: [],
    };
  }

  const evidence = [];
  const user = await vercelGet("/v2/user", { token, fetchImpl });
  evidence.push(`GET /v2/user -> ${user.status ?? "transport failure"}`);
  if (!user.ok) {
    return {
      state: "API_UNREACHABLE",
      problems: [
        user.status === 403
          ? "the credential was refused by the host API (403) — it may be revoked, or scoped away from this account"
          : `the host API could not be read (${user.status ?? "transport"}): ${user.text}`,
      ],
      evidence,
    };
  }
  const personalId = user.json?.user?.id ?? null;
  const username = user.json?.user?.username ?? null;

  const teams = args.teamId
    ? { ok: true, json: { teams: [] } }
    : await vercelGet("/v2/teams?limit=100", { token, fetchImpl });
  evidence.push(`GET /v2/teams -> ${teams.status ?? "transport failure"}`);
  const teamList = Array.isArray(teams.json?.teams) ? teams.json.teams : [];

  const scopes = [];
  if (args.teamId) scopes.push({ kind: "team", id: args.teamId, label: `team ${args.teamId}` });
  else {
    if (personalId) scopes.push({ kind: "personal", id: personalId, label: `personal account ${username ?? personalId}` });
    for (const team of teamList) scopes.push({ kind: "team", id: team.id, label: `team ${team.slug ?? team.name ?? team.id}` });
    // A token scoped to a single team answers /v2/teams with that one team; the
    // personal scope is still searched because a personal token can own the app.
  }

  const raw = [];
  for (const scope of scopes) {
    const query = scope.kind === "team" ? `?limit=100&teamId=${encodeURIComponent(scope.id)}` : "?limit=100";
    const projects = await vercelGet(`/v9/projects${query}`, { token, fetchImpl });
    evidence.push(`GET /v9/projects [${scope.label}] -> ${projects.status ?? "transport failure"} (${(projects.json?.projects ?? []).length} project(s))`);
    if (!projects.ok) continue;
    for (const project of projects.json?.projects ?? []) raw.push({ ...project, __scope: scope });
  }

  // The same project can be returned by several listings (personal + team).
  // Its own id is the identity, so those records are ONE candidate — otherwise
  // an unambiguous project looks like two projects that share a name and the
  // guard refuses a publication it should allow.
  const seen = dedupeProjects(raw);
  const summary = dedupeSummary(raw, seen);
  if (summary.collapsed > 0) {
    evidence.push(
      `deduped ${summary.rawRecords} project record(s) across ${scopes.length} scope(s) into ${summary.distinctProjects} distinct project id(s) — ${summary.collapsed} record(s) were the same project seen twice`,
    );
  }

  const selection = selectVercelProject({
    projects: seen,
    expectedName: args.expectedName,
    repoFullName: repoFullNameFromGit(),
  });
  if (!selection.chosen) {
    return {
      state: "PROJECT_NOT_IDENTIFIED",
      problems: [selection.problem].filter(Boolean),
      evidence,
      candidates: seen.map((p) => ({
        name: p.name,
        id: p.id,
        scopes: (p.__scopes ?? []).map((sc) => sc.label),
      })),
      dedupe: summary,
    };
  }

  const chosen = selection.chosen;
  const ownership = scopeForProject(chosen, { personalId });
  const scope = ownership.scope;
  const teamQuery = scope?.kind === "team" ? `?teamId=${encodeURIComponent(scope.id)}` : "";
  const detail = await vercelGet(`/v9/projects/${encodeURIComponent(chosen.id)}${teamQuery}`, { token, fetchImpl });
  evidence.push(`GET /v9/projects/${chosen.id} -> ${detail.status ?? "transport failure"}`);
  const domainsCall = await vercelGet(
    `/v9/projects/${encodeURIComponent(chosen.id)}/domains${teamQuery}`,
    { token, fetchImpl },
  );
  evidence.push(`GET /v9/projects/${chosen.id}/domains -> ${domainsCall.status ?? "transport failure"}`);

  const project = detail.json?.project ?? detail.json ?? chosen;
  const domains = projectDomains(project, domainsCall.json?.domains);
  const host = chooseHostUrl({
    explicit: args.hostUrl,
    domains,
    allowUnverifiedHost: args.allowUnverifiedHost,
  });

  const problems = [];
  if (ownership.problem) problems.push(ownership.problem);
  if (host.problem) problems.push(host.problem);
  if (scope && ownership.source) {
    evidence.push(
      `owning scope determined from ${ownership.source}: ${scope.label} (id ${scope.id})` +
        (ownership.certain ? "" : " — NOT certain"),
    );
  }

  const report = {
    schema: VERCEL_TARGET_SCHEMA,
    state: !scope ? "ORG_NOT_DETERMINABLE" : host.hostUrl ? "RESOLVED" : "HOST_NOT_DISCOVERABLE",
    orgId: scope?.id ?? null,
    orgKind: scope?.kind ?? null,
    orgSource: ownership.source ?? null,
    projectId: chosen.id ?? null,
    projectName: project.name ?? chosen.name ?? null,
    hostUrl: host.hostUrl,
    hostSource: host.source,
    domains: domains.map((d) => d.name),
    matchedBy: selection.matchedBy,
    projectsSeen: seen.length,
    dedupe: summary,
    evidence,
    problems,
  };
  return report;
}

function formatReport(report) {
  const lines = [`vercel target: ${report.state}`, `  VERCEL_ORG_ID: ${report.orgId ?? "(not resolved)"}`, `  VERCEL_PROJECT_ID: ${report.projectId ?? "(not resolved)"}`, `  FRONTEND_HOST_URL: ${report.hostUrl ?? "(not resolved)"}`];
  if (report.projectName) lines.push(`  project: ${report.projectName} (identified by ${report.matchedBy})`);
  if (report.orgKind) lines.push(`  scope: ${report.orgKind}`)
  if (report.orgSource) lines.push(`  org id source: ${report.orgSource}`)
  if (report.dedupe) {
    lines.push(
      `  projects: ${report.dedupe.distinctProjects} distinct id(s) from ${report.dedupe.rawRecords} record(s) across all scopes` +
        (report.dedupe.collapsed > 0 ? ` — ${report.dedupe.collapsed} duplicate record(s) collapsed` : ""),
    );
  };
  if (report.hostSource) lines.push(`  host source: ${report.hostSource}`);
  if (report.domains?.length) lines.push(`  domains on the project: ${report.domains.join(", ")}`);
  lines.push(`  projects seen: ${report.projectsSeen ?? 0}`);
  lines.push("", "evidence:", ...(report.evidence ?? []).map((e) => `  - ${e}`));
  if (report.problems?.length) lines.push("", "problems:", ...report.problems.map((p) => `  - ${p}`));
  lines.push("", "These are IDENTIFIERS, not credentials: they authorise nothing without the token, and they are safe to pin as GitHub Environment VARIABLES.");
  lines.push("The token's value was never read into this output, and this command never creates, deploys or changes anything.");
  return `${lines.join("\n")}\n`;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const report = await resolveVercelTarget({ argv, env: process.env });
  process.stdout.write(argv.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  process.exit(report.state === "RESOLVED" ? 0 : report.state === "NO_CREDENTIAL" || report.state === "API_UNREACHABLE" ? 2 : 1);
}
