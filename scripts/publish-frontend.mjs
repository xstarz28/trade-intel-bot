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
 *   5. assemble the host's Build Output API directory (`.vercel/output`) from
 *      the SAME bytes that passed step 3, prove it is those bytes, and upload it
 *      with `--prebuilt` — the host runs no build at all;
 *   6. point the browser-facing host at that deployment;
 *   7. `verify:published` against the PUBLIC url with the artifact's provenance
 *      hash and entry-bundle names — the only acceptance evidence there is.
 *
 * A green step 5 is not a publication. If step 7 fails, this command fails.
 *
 * WHY `--prebuilt` AND NOT `vercel deploy <dir>`
 * ----------------------------------------------
 * Uploading a directory makes the host treat it as SOURCE: it runs the
 * project's configured build command in its own builder, which has none of the
 * checkout's dependencies. That is what produced
 * `sh: line 1: vite: command not found` / `Command "vite build" exited with 127`
 * — and, worse than the failure, a successful remote build would have served
 * bytes from a build nobody verified, under the URL this command then checks.
 * `--prebuilt` uploads `.vercel/output` exactly as assembled here, so the
 * published bytes ARE the verified bytes and no build happens anywhere.
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
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { gitOutput, resolveExecutable, runCommand } from "./lib/executable.mjs";
import {
  BUILD_OUTPUT_DIR,
  VERCEL_CONFIG_FILE,
  ensureLocalProjectLink,
  materializeBuildOutput,
  verifyBuildOutput,
} from "./lib/vercel-prebuilt.mjs";
import { restDeployPrebuilt, REST_DEPLOY_STATES } from "./lib/vercel-rest-deploy.mjs";

import { registerTypeScriptResolution } from "./lib/ts-module-loader.mjs";
import {
  PROJECT_ACCESS_STATES,
  verifyVercelProjectAccess,
} from "./verify-vercel-project-access.mjs";
import {
  chooseHostUrl,
  dedupeProjects,
  projectDomains,
  scopeForProject,
  selectVercelProject,
  vercelGet,
  VERCEL_API,
} from "./resolve-vercel-target.mjs";

// The source-pin rule lives in ONE module used by the workflow, the guard CLI
// and this command; loading it needs the same TypeScript resolution hook the
// other operator scripts register, so it is imported after that hook is up.
registerTypeScriptResolution();
const { evaluateFrontendPublicationGuard } = await import(
  "../src/lib/deployment/frontend-publication-guard.ts"
);

export const PUBLISH_FRONTEND_SCHEMA = "phase300.publish-frontend/v1";

/**
 * Run a command through the platform-safe resolver: `npm.cmd`/`npx.cmd` (and a
 * shell, which Node requires for a `.cmd`) on Windows, the bare name everywhere
 * else. A failure carries `failureText`, so a process that could not even start
 * reports WHY instead of returning empty stdout and stderr.
 */
export function run(command, args, { env = process.env, cwd = process.cwd(), platform } = {}) {
  return runCommand(command, args, { env, cwd, ...(platform ? { platform } : {}) });
}

function git(args) {
  return gitOutput(args, { stdio: ["ignore", "pipe", "ignore"] });
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

  const raw = [];
  for (const scope of scopes) {
    const query = scope.kind === "team" ? `?limit=100&teamId=${encodeURIComponent(scope.id)}` : "?limit=100";
    const projects = await vercelGet(`/v9/projects${query}`, { token, fetchImpl });
    if (!projects.ok) continue;
    for (const project of projects.json?.projects ?? []) raw.push({ ...project, __scope: scope });
  }
  // Same project through two listings is ONE project (Phase 300 fix): its own
  // id is the identity. Distinct ids remain distinct and stay ambiguous.
  const seen = dedupeProjects(raw);
  const selection = selectVercelProject({ projects: seen, expectedName, repoFullName });
  if (!selection.chosen) {
    return {
      problem: selection.problem,
      candidates: seen.map((p) => `${p.name} (${p.id})`),
    };
  }
  const chosen = selection.chosen;
  const ownership = scopeForProject(chosen, { personalId });
  if (!ownership.scope) return { problem: ownership.problem };
  const scope = ownership.scope;
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
    orgId: scope.id,
    orgSource: ownership.source,
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
    report.push(`building… (${resolveExecutable("npm").command})`);
    const build = run("npm", ["run", "build"], { cwd: process.cwd() });
    if (build.status !== 0) fail(`the build failed: ${build.failureText ?? "no output"}\n${build.stdout}\n${build.stderr}`, 2);
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
  if (verifyArtifact.status !== 0) {
    fail(
      `the built artifact did not satisfy the contract${verifyArtifact.failureText ? ` (${verifyArtifact.failureText})` : ""}:\n${verifyArtifact.stdout}`,
    );
  }
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
    // A pinned identifier is a CLAIM, not a fact: verify it against THIS
    // credential with the same read-only project-settings call the host CLI
    // makes at deploy time (run 36823507179 failed there, opaquely — "Could
    // not retrieve Project Settings."). Same named verdicts as the workflow's
    // pinned path: TOKEN_CANNOT_ACCESS_ORG / PROJECT_NOT_UNDER_ORG /
    // HOST_NOT_ON_PROJECT / PROJECT_ACCESS_VERIFIED.
    const verdict = await verifyVercelProjectAccess({
      argv: [
        "--org-id",
        target.orgId ?? "",
        "--project-id",
        target.projectId ?? "",
        "--host-url",
        target.hostUrl ?? "",
      ],
      env: process.env,
    });
    const acceptable =
      verdict.state === PROJECT_ACCESS_STATES.VERIFIED ||
      verdict.state === PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK;
    if (!acceptable) {
      fail(
        `the pinned host target was rejected by the credential: ${verdict.state} — ${(verdict.problems ?? []).join("; ")}`,
      );
    }
    report.push(
      `pinned target verified against the credential (project settings -> ${verdict.httpStatus}${verdict.projectName ? `, project ${verdict.projectName}` : ""})` +
        (verdict.state === PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK
          ? " — scope-metadata risk (vercel/vercel#17506): proceeding with the project.json link, no org/project env at deploy, REST alias"
          : ""),
    );
  }

  // 5. Assemble the host's Build Output API directory from the SAME directory
  //    that passed step 3, and prove it is that directory, then upload it as
  //    PREBUILT.
  //
  //    `vercel deploy dist` is deliberately not used and must not come back: the
  //    host treats an uploaded directory as SOURCE, runs the project's build
  //    command remotely (which failed with "vite: command not found" — and would
  //    have served bytes from a build nobody verified even if it had succeeded).
  //    `--prebuilt` uploads `.vercel/output` as-is, so nothing is built anywhere.
  const output = materializeBuildOutput({
    distDir: args.dist,
    outDir: BUILD_OUTPUT_DIR,
    vercelJsonPath: VERCEL_CONFIG_FILE,
  });
  if (!output.ok) {
    fail(`the build output could not be assembled from the verified artifact: ${output.problem}`, 2);
  }
  const outputCheck = verifyBuildOutput({
    distDir: args.dist,
    outDir: BUILD_OUTPUT_DIR,
    vercelJsonPath: VERCEL_CONFIG_FILE,
    expectCommit: head,
    expectBranch: args.pinnedBranch ?? branch,
  });
  if (!outputCheck.ok) {
    fail(
      `the assembled build output is not the verified artifact, so nothing was uploaded: ${outputCheck.problems.join("; ")}`,
    );
  }
  const link = ensureLocalProjectLink({ orgId: target.orgId, projectId: target.projectId });
  if (!link.ok) fail(`the host project could not be selected locally: ${link.problem}`);
  report.push(
    `build output assembled from the verified artifact: ${output.files} file(s), ${output.bytes} bytes, ` +
      `static/build-info.json sha256 ${output.buildInfoSha256}, routing ` +
      `(filesystem, then ${output.rewrites.map((r) => `${r.source} -> ${r.destination}`).join(", ") || "no rewrites"})`,
  );

  // Phase 300g: the upload is the REST prebuilt deployment. Reproduced against
  // a local mock of the Vercel API (CLI 62.1.0 AND 59.1.3): `vercel deploy
  // --prebuilt` performs the vercel/vercel#17506 user/team lookups and throws
  // "Could not retrieve Project Settings." for a project-scoped token whose
  // `GET /teams/<org>` 403 carries the code "forbidden" (no invocation shape —
  // --scope, VERCEL_TEAM_ID, --project — avoids it). The REST path below sends
  // the CLI's EXACT prebuilt request (captured from a real CLI run) and
  // touches ONLY project-scoped endpoints, so the poisoned lookups are not
  // part of this path at all. `.vercel/output` is uploaded as-is (Build Output
  // API v3 — the host builds nothing), the token is passed in-process and
  // never printed, and the deployment is created on the SAME verified project.
  report.push("uploading prebuilt via the project-scoped REST deployment API…");
  const deploy = await restDeployPrebuilt({
    orgId: target.orgId,
    projectId: target.projectId,
    projectName: target.projectName,
    target: args.target === "production" ? "production" : "preview",
    token,
    outputDir: BUILD_OUTPUT_DIR,
    expectCommit: head,
  });
  report.push(...(deploy.evidence ?? []).map((line) => `rest deploy: ${line}`));
  if (deploy.state !== REST_DEPLOY_STATES.DEPLOYED) {
    fail(
      `the upload failed: ${deploy.state} — ${(deploy.problems ?? []).join("; ")}` +
        (deploy.deploymentId ? ` (deployment ${deploy.deploymentId} exists but did not become READY)` : ""),
    );
  }
  const deploymentUrl = deploy.deploymentUrl;
  report.push(
    `uploaded: ${deploymentUrl} (prebuilt — the host built nothing; project-scoped REST, no user/team lookups)`,
  );

  // 6. Point the browser-facing host at it (preview only — a production
  //    deployment already serves the project's own domains, and saying so is
  //    more honest than running an alias that would be refused).
  if (args.target === "preview") {
    const host = String(target.hostUrl).replace(/^https?:\/\//, "");
    // vercel/vercel#17506 — the CLI's `alias set` performs a USER lookup that
    // a project-scoped token cannot satisfy, so the alias is assigned through
    // the teamId-scoped REST API instead (the proven workaround): one POST,
    // no user/team scope resolution, nothing created but the alias itself.
    const aliasHost = deploymentUrl.replace(/^https?:\/\//, "");
    const aliasUrl = `${VERCEL_API}/v2/deployments/${encodeURIComponent(aliasHost)}/aliases?teamId=${encodeURIComponent(target.orgId ?? "")}`;
    let aliasStatus = null;
    let aliasBody = "";
    try {
      const response = await fetch(aliasUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ alias: host }),
        signal: AbortSignal.timeout(20_000),
      });
      aliasStatus = response.status;
      aliasBody = (await response.text()).slice(0, 400);
    } catch (error) {
      aliasBody = error instanceof Error ? error.message : String(error);
    }
    if (aliasStatus !== 200) {
      fail(
        `the deployment exists (${deploymentUrl}) but the browser-facing host could not be pointed at it ` +
          `(alias REST call -> HTTP ${aliasStatus ?? "transport failure"}): ${aliasBody}\n` +
          `If ${host} is this project's production domain, re-run with --target production so the standard domain assignment applies.`,
      );
    }
    report.push(`host updated via the teamId-scoped alias API: ${target.hostUrl} -> ${deploymentUrl}`);
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
