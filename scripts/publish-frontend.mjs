#!/usr/bin/env node
/**
 * Phase 300 — publish the verified frontend, one command, no guessing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The GitHub workflow (`.github/workflows/publish-development-frontend.yml`) is
 * the intended path, but a `workflow_dispatch` workflow can only be started once
 * it exists on the repository's DEFAULT branch — and this repository's default
 * branch is not the branch that carries the Phase 299/300 work. So the same
 * publication is also available as one command that runs wherever the token
 * lives (an operator's machine, a runner, any shell with the credential in its
 * environment). It publishes exactly what it verified, and it ends by FETCHING
 * the browser-facing URL.
 *
 * ORDER, AND WHY IT IS THIS ORDER
 * -------------------------------
 *   1. refuse unless the checkout is the pinned branch and the tree is clean;
 *   2. build;
 *   3. `verify:frontend` on the built artifact (identity, theme, no legacy
 *      surface) — before a single byte can leave the machine;
 *   4. resolve/validate the host target (org, project, URL) from the token;
 *   5. upload the SAME directory that passed step 3 — never a rebuild;
 *   6. point the browser-facing host at that deployment;
 *   7. `verify:published` against the PUBLIC url with the artifact's provenance
 *      hash and entry-bundle names — the only acceptance evidence there is.
 *
 * A green step 5 is not a publication. If step 7 fails, this command fails.
 *
 * SAFETY
 * ------
 * · The token is read from the environment only, never from argv (argv is
 *   visible in a process listing), and never printed.
 * · Default deploy target is `preview`, aliased to the host. Overwriting a
 *   project's PRODUCTION deployment is opt-in (`--target production`) and is
 *   named in the output when used, so it can never happen by accident.
 * · Nothing is created: the org and project must already exist and must be
 *   positively identified (Git link or exact name) by `resolve-vercel-target`.
 *
 * Usage:
 *   VERCEL_TOKEN=... npm run frontend:publish -- --host-url https://<host>
 *   VERCEL_TOKEN=... npm run frontend:publish -- --target production
 *   VERCEL_TOKEN=... npm run frontend:publish -- --dist dist --skip-build
 *
 * Exit codes: 0 published AND verified · 1 refused or the published check failed
 * · 2 nothing to publish / could not evaluate.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { registerTypeScriptResolution } from "./lib/ts-module-loader.mjs";
import { chooseHostUrl, projectDomains, selectVercelProject, vercelGet } from "./resolve-vercel-target.mjs";

// The source-pin rule lives in ONE module used by the workflow, the guard CLI
// and this command; loading it needs the same TypeScript resolution hook the
// other operator scripts register, so it is imported after that hook is up.
registerTypeScriptResolution();
const { evaluateFrontendPublicationGuard } = await import(
  "../src/lib/deployment/frontend-publication-guard.ts"
);

export const PUBLISH_FRONTEND_SCHEMA = "phase300.publish-frontend/v1";

/** Run a command, streaming nothing, returning its status and output. */
export function run(command, args, { env = process.env, cwd = process.cwd() } = {}) {
  const result = spawnSync(command, args, { env, cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(args) {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** The entry bundles and provenance hash of the artifact that passed the check. */
export function artifactFingerprint(distDir = "dist") {
  const buildInfoPath = resolvePath(distDir, "build-info.json");
  const indexPath = resolvePath(distDir, "index.html");
  if (!existsSync(buildInfoPath) || !existsSync(indexPath)) return null;
  const buildInfoText = readFileSync(buildInfoPath, "utf8");
  const html = readFileSync(indexPath, "utf8");
  const entry = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.(?:js|css))["']/gi)]
    .map((m) => m[1].replace(/^\//, ""))
    .join(",");
  return {
    sha256: createHash("sha256").update(buildInfoText).digest("hex"),
    entry,
    buildInfo: JSON.parse(buildInfoText),
  };
}

/** The https URL on the last line of the host CLI's output. */
export function deploymentUrlFrom(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^https:\/\/[a-z0-9.-]+$/i.test(lines[i])) return lines[i];
  }
  return null;
}

function parseArgs(argv, env) {
  const args = {
    dist: "dist",
    hostUrl: env.XSTARZ_FRONTEND_HOST_URL ?? null,
    orgId: env.VERCEL_ORG_ID ?? null,
    projectId: env.VERCEL_PROJECT_ID ?? null,
    expectedName: env.XSTARZ_VERCEL_PROJECT_NAME ?? null,
    pinnedBranch: env.XSTARZ_REQUIRED_SOURCE_BRANCH ?? null,
    target: "preview",
    skipBuild: false,
    requireClean: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dist") args.dist = argv[++i];
    else if (arg.startsWith("--dist=")) args.dist = arg.split("=")[1];
    else if (arg === "--host-url") args.hostUrl = argv[++i];
    else if (arg.startsWith("--host-url=")) args.hostUrl = arg.split("=")[1];
    else if (arg === "--org-id") args.orgId = argv[++i];
    else if (arg === "--project-id") args.projectId = argv[++i];
    else if (arg === "--expected-name") args.expectedName = argv[++i];
    else if (arg.startsWith("--expected-name=")) args.expectedName = arg.split("=")[1];
    else if (arg === "--require-branch") args.pinnedBranch = argv[++i];
    else if (arg.startsWith("--require-branch=")) args.pinnedBranch = arg.split("=")[1];
    else if (arg === "--target") args.target = argv[++i] === "production" ? "production" : "preview";
    else if (arg.startsWith("--target=")) args.target = arg.split("=")[1] === "production" ? "production" : "preview";
    else if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--allow-dirty") args.requireClean = false;
    else if (arg === "--json") args.json = true;
  }
  return args;
}

/**
 * Read the host account with the token to obtain the identifiers that were not
 * pinned. Read-only, and it refuses rather than inventing a project.
 */
export async function resolveIdentifiers({ token, expectedName, repoFullName, hostUrl, fetchImpl = fetch }) {
  const user = await vercelGet("/v2/user", { token, fetchImpl });
  if (!user.ok) {
    return { problem: `the host account could not be read (${user.status ?? "transport"}): ${user.text}` };
  }
  const personalId = user.json?.user?.id ?? null;
  const teamsCall = await vercelGet("/v2/teams?limit=100", { token, fetchImpl });
  const teams = Array.isArray(teamsCall.json?.teams) ? teamsCall.json.teams : [];
  const scopes = [];
  if (personalId) scopes.push({ kind: "personal", id: personalId });
  for (const team of teams) scopes.push({ kind: "team", id: team.id, slug: team.slug ?? team.name });

  const seen = [];
  for (const scope of scopes) {
    const query = scope.kind === "team" ? `?limit=100&teamId=${encodeURIComponent(scope.id)}` : "?limit=100";
    const projects = await vercelGet(`/v9/projects${query}`, { token, fetchImpl });
    if (!projects.ok) continue;
    for (const project of projects.json?.projects ?? []) seen.push({ ...project, __scope: scope });
  }
  const selection = selectVercelProject({ projects: seen, expectedName, repoFullName });
  if (!selection.chosen) {
    return {
      problem: selection.problem,
      candidates: seen.map((p) => `${p.name} (${p.id})`),
    };
  }
  const chosen = selection.chosen;
  const scope = chosen.__scope;
  const detail = await vercelGet(
    `/v9/projects/${encodeURIComponent(chosen.id)}${scope?.kind === "team" ? `?teamId=${encodeURIComponent(scope.id)}` : ""}`,
    { token, fetchImpl },
  );
  const domainsCall = await vercelGet(
    `/v9/projects/${encodeURIComponent(chosen.id)}/domains${scope?.kind === "team" ? `?teamId=${encodeURIComponent(scope.id)}` : ""}`,
    { token, fetchImpl },
  );
  const project = detail.json?.project ?? detail.json ?? chosen;
  const domains = projectDomains(project, domainsCall.json?.domains);
  const host = chooseHostUrl({ explicit: hostUrl, domains, allowUnverifiedHost: false });
  return {
    orgId: scope?.id ?? null,
    projectId: chosen.id,
    projectName: project.name ?? chosen.name,
    matchedBy: selection.matchedBy,
    domains: domains.map((d) => d.name),
    hostUrl: host.hostUrl,
    hostSource: host.source,
    problem: host.problem ?? null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv, process.env);
  const report = [];
  const fail = (message, code = 1) => {
    report.push(`REFUSED: ${message}`);
    process.stdout.write(`${report.join("\n")}\n`);
    process.exit(code);
  };

  const token = process.env.VERCEL_TOKEN ?? "";
  const head = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = (git(["status", "--porcelain"]) ?? "").length > 0;
  const expectedName = args.expectedName ?? "trade-intel-bot";
  const remote = git(["config", "--get", "remote.origin.url"]) ?? "";
  const repoFullName = (remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i) ?? [])[1] ?? null;

  report.push(`publish frontend: ${args.target} target, branch ${branch ?? "(unknown)"}, commit ${head ?? "(unknown)"}`);

  // 1. Source pin. The guard is the same one the workflow runs, so both paths
  //    refuse the same things for the same reasons.
  const guard = evaluateFrontendPublicationGuard({
    sourceRef: branch ? `refs/heads/${branch}` : undefined,
    requiredSourceBranch: args.pinnedBranch ?? branch ?? undefined,
    hostUrl: args.hostUrl ?? (args.projectId ? "https://resolve.invalid" : undefined),
    mode: "publish",
    hostCredential: { tokenPresent: token.trim().length > 0, orgPresent: true, projectPresent: true },
  });
  if (!token.trim()) fail("VERCEL_TOKEN is not set in the environment, so nothing can be published");
  if (args.requireClean && dirty) {
    fail("the working tree is not clean, so the artifact could not be reproduced from the commit it claims");
  }
  if (guard.state === "FORBIDDEN_SOURCE_REF" || guard.state === "WRONG_SOURCE_BRANCH") {
    fail(`${branch} is not a deployable frontend source: ${guard.problems.join("; ")}`);
  }

  // 2. Build.
  if (!args.skipBuild) {
    report.push("building…");
    const build = run("npm", ["run", "build"], { cwd: process.cwd() });
    if (build.status !== 0) fail(`the build failed:\n${build.stdout}\n${build.stderr}`, 2);
  }

  // 3. Verify the artifact before anything leaves this machine.
  const verifyArtifact = run(
    "node",
    [
      "scripts/verify-frontend-artifact.mjs",
      "--dist",
      args.dist,
      "--expect-commit",
      head ?? "",
      "--expect-branch",
      args.pinnedBranch ?? branch ?? "",
    ],
    { cwd: process.cwd() },
  );
  if (verifyArtifact.status !== 0) fail(`the built artifact did not satisfy the contract:\n${verifyArtifact.stdout}`);
  const fingerprint = artifactFingerprint(args.dist);
  if (!fingerprint) fail("the artifact has no readable provenance", 2);
  report.push(
    `artifact verified: commit ${fingerprint.buildInfo.commit} branch ${fingerprint.buildInfo.branch} provenance sha256 ${fingerprint.sha256}`,
  );

  // 4. Resolve or validate the host target.
  let target = {
    orgId: args.orgId,
    projectId: args.projectId,
    hostUrl: args.hostUrl,
    projectName: null,
    matchedBy: null,
  };
  if (!target.orgId || !target.projectId || !target.hostUrl) {
    const resolved = await resolveIdentifiers({
      token,
      expectedName,
      repoFullName,
      hostUrl: args.hostUrl,
    });
    if (resolved.problem) {
      fail(
        `the host target could not be resolved: ${resolved.problem}${
          resolved.candidates?.length ? ` — projects seen: ${resolved.candidates.join(", ")}` : ""
        }`,
      );
    }
    target = { ...target, ...resolved };
    report.push(
      `host target resolved from the token: org ${target.orgId}, project ${target.projectId} (${target.projectName}, by ${target.matchedBy}), host ${target.hostUrl} — ${resolved.hostSource}`,
    );
  } else {
    report.push(`host target pinned: org ${target.orgId}, project ${target.projectId}, host ${target.hostUrl}`);
  }

  // 5. Upload the SAME directory that passed step 3.
  const deployArgs = ["--yes", "vercel@latest", "deploy", args.dist];
  if (args.target === "production") deployArgs.push("--prod");
  const deploy = run("npx", deployArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VERCEL_TOKEN: token,
      VERCEL_ORG_ID: target.orgId,
      VERCEL_PROJECT_ID: target.projectId,
    },
  });
  if (deploy.status !== 0) fail(`the upload failed:\n${deploy.stdout}\n${deploy.stderr}`);
  const deploymentUrl = deploymentUrlFrom(deploy.stdout);
  if (!deploymentUrl) fail(`the host CLI produced no deployment URL; last output:\n${deploy.stdout}`);
  report.push(`uploaded: ${deploymentUrl}`);

  // 6. Point the browser-facing host at it (preview only — a production
  //    deployment already serves the project's own domains, and saying so is
  //    more honest than running an alias that would be refused).
  if (args.target === "preview") {
    const host = String(target.hostUrl).replace(/^https?:\/\//, "");
    const alias = run("npx", ["--yes", "vercel@latest", "alias", "set", deploymentUrl, host], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERCEL_TOKEN: token,
        VERCEL_ORG_ID: target.orgId,
        VERCEL_PROJECT_ID: target.projectId,
      },
    });
    if (alias.status !== 0) {
      fail(
        `the deployment exists (${deploymentUrl}) but the browser-facing host could not be pointed at it:\n${alias.stdout}\n${alias.stderr}\n` +
          `If ${host} is this project's production domain, re-run with --target production so the standard domain assignment applies.`,
      );
    }
    report.push(`host updated: ${target.hostUrl} -> ${deploymentUrl}`);
  } else {
    report.push(`production deployment of the host project: ${target.hostUrl} serves it (no alias needed)`);
  }

  // 7. The acceptance evidence: fetch the public URL.
  const published = run(
    "node",
    [
      "scripts/verify-published-frontend.mjs",
      "--url",
      target.hostUrl,
      "--expect-branch",
      args.pinnedBranch ?? branch ?? "",
      "--expect-commit",
      head ?? "",
      "--expect-build-info-sha256",
      fingerprint.sha256,
      "--expect-asset-names",
      fingerprint.entry,
    ],
    { cwd: process.cwd() },
  );
  report.push("", published.stdout.trim());
  if (published.status !== 0) {
    fail("the published URL did not pass the acceptance check — see the checks above", 1);
  }
  report.push(`PUBLISHED AND VERIFIED: ${target.hostUrl} serves ${fingerprint.buildInfo.commit} on ${fingerprint.buildInfo.branch}`);
  process.stdout.write(`${report.join("\n")}\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  await main();
}
