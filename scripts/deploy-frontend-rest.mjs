/**
 * Phase 300g — deploy the VERIFIED `.vercel/output` over the Vercel REST API.
 *
 * This is the publication path the runner uses instead of
 * `vercel deploy --prebuilt`: the CLI's linked-project flow performs the
 * vercel/vercel#17506 user/team lookups, which a project-scoped token cannot
 * satisfy (`GET /teams/<org>` -> 403 code "forbidden" -> "Could not retrieve
 * Project Settings", reproduced against a local mock on CLI 62.1.0 AND
 * 59.1.3). The REST path performs ONLY project-scoped operations:
 *
 *   GET  /v9/projects/<id>?teamId=<org>            (the verifier-proven read)
 *   POST /v13/deployments?...&prebuilt=1&teamId=.. (the CLI's exact body)
 *   POST /v2/files?teamId=<org>                    (only shas the server lacks)
 *   GET  /v13/deployments/<id>?teamId=<org>        (until READY)
 *
 * Usage (token comes from VERCEL_TOKEN, environment-only):
 *   node scripts/deploy-frontend-rest.mjs \
 *     --org-id team_... --project-id prj_... \
 *     --target preview --expect-commit <sha> \
 *     [--output-dir .vercel/output] [--project-name trade-intel-bot]
 *
 * Output: human-readable evidence lines; the deployment URL is printed as a
 * bare https line so a runner can parse it from the captured FULL stdout.
 * Exit: 0 deployed · 1 refused (named) · 2 cannot evaluate.
 */

import { resolve } from "node:path";
import {
  REST_DEPLOY_STATES,
  exitCodeFor,
  restDeployPrebuilt,
} from "./lib/vercel-rest-deploy.mjs";

function parseArgs(argv) {
  const args = {
    outputDir: ".vercel/output",
    target: "preview",
    expectCommit: null,
    orgId: null,
    projectId: null,
    projectName: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org-id") args.orgId = argv[++i];
    else if (arg.startsWith("--org-id=")) args.orgId = arg.split("=")[1];
    else if (arg === "--project-id") args.projectId = argv[++i];
    else if (arg.startsWith("--project-id=")) args.projectId = arg.split("=")[1];
    else if (arg === "--project-name") args.projectName = argv[++i];
    else if (arg.startsWith("--project-name=")) args.projectName = arg.split("=")[1];
    else if (arg === "--target") args.target = argv[++i];
    else if (arg.startsWith("--target=")) args.target = arg.split("=")[1];
    else if (arg === "--expect-commit") args.expectCommit = argv[++i];
    else if (arg.startsWith("--expect-commit=")) args.expectCommit = arg.split("=")[1];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.split("=")[1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await restDeployPrebuilt({
  orgId: args.orgId,
  projectId: args.projectId,
  projectName: args.projectName,
  target: args.target === "production" ? "production" : "preview",
  token: process.env.VERCEL_TOKEN,
  outputDir: resolve(args.outputDir),
  expectCommit: args.expectCommit,
});

for (const line of result.evidence ?? []) process.stdout.write(`  ${line}\n`);
if (result.deploymentUrl) process.stdout.write(`${result.deploymentUrl}\n`);
if (result.state !== REST_DEPLOY_STATES.DEPLOYED) {
  process.stderr.write(`rest deploy: ${result.state}\n`);
  for (const problem of result.problems ?? []) process.stderr.write(`  - ${problem}\n`);
  process.stderr.write(
    "nothing else was changed: no project created, no domain mutated, no remote build ran.\n",
  );
} else {
  process.stdout.write(`rest deploy: ${result.state} (deployment ${result.deploymentId})\n`);
}
process.exit(exitCodeFor(result.state));
