#!/usr/bin/env node
/**
 * Phase 300 final hotfix — assemble `.vercel/output` from the VERIFIED artifact.
 *
 * This is the step between `npm run verify:frontend` and
 * `npx vercel deploy --prebuilt`. It exists as its own command so the GitHub
 * workflow can run exactly what the one-command publisher runs, and so a person
 * can inspect the assembled output before anything is uploaded.
 *
 *   npm run frontend:prebuilt -- --expect-commit <sha> --expect-branch <branch>
 *   npm run frontend:prebuilt -- --verify-only        (re-check an existing output)
 *   npm run frontend:prebuilt -- --link-project       (also write .vercel/project.json
 *                                                      from VERCEL_ORG_ID/VERCEL_PROJECT_ID)
 *
 * It NEVER builds and NEVER deploys: its only inputs are the artifact directory
 * that already passed the contract and the checked-in `vercel.json` whose
 * rewrites define the deployment's routing.
 *
 * Exit codes: 0 assembled and proven · 1 the output is not the verified artifact
 * · 2 could not assemble (missing artifact / unreadable configuration).
 *
 * See `scripts/lib/vercel-prebuilt.mjs` for why the publication is prebuilt and
 * why `vercel deploy <dir>` must never come back.
 */
import { existsSync, readFileSync } from "node:fs";

import {
  BUILD_OUTPUT_DIR,
  BUILD_OUTPUT_STATIC,
  VERCEL_CONFIG_FILE,
  ensureLocalProjectLink,
  materializeBuildOutput,
  verifyBuildOutput,
} from "./lib/vercel-prebuilt.mjs";

export const PREPARE_VERCEL_OUTPUT_SCHEMA = "phase300.prepare-vercel-output/v1";

function parseArgs(argv) {
  const args = {
    dist: "dist",
    out: BUILD_OUTPUT_DIR,
    vercelJson: VERCEL_CONFIG_FILE,
    expectCommit: null,
    expectBranch: null,
    verifyOnly: false,
    linkProject: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dist") args.dist = argv[++i];
    else if (arg.startsWith("--dist=")) args.dist = arg.split("=")[1];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
    else if (arg === "--vercel-json") args.vercelJson = argv[++i];
    else if (arg === "--expect-commit") args.expectCommit = argv[++i];
    else if (arg.startsWith("--expect-commit=")) args.expectCommit = arg.split("=")[1];
    else if (arg === "--expect-branch") args.expectBranch = argv[++i];
    else if (arg.startsWith("--expect-branch=")) args.expectBranch = arg.split("=")[1];
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--link-project") args.linkProject = true;
    else if (arg === "--json") args.json = true;
  }
  return args;
}

/** The provenance the assembled output claims — printed as evidence, never invented. */
function outputProvenance(outDir) {
  const path = `${outDir}/${BUILD_OUTPUT_STATIC}/build-info.json`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function formatPrepareReport({ prepared, check, provenance, link }) {
  const lines = ["", `vercel build output: ${check.ok ? "PASS" : "FAIL"}`];
  if (prepared) {
    lines.push(
      `  assembled: ${prepared.files} file(s), ${prepared.bytes} bytes from the verified artifact ` +
        `(static/build-info.json sha256 ${prepared.buildInfoSha256})`,
    );
    lines.push(
      `  routing: filesystem first, then ${prepared.rewrites.map((r) => `${r.source} -> ${r.destination}`).join(", ")}`,
    );
  }
  for (const entry of check.checks) {
    lines.push(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name} — ${entry.detail}`);
  }
  if (provenance) lines.push(`  commit: ${provenance.commit}  branch: ${provenance.branch}`);
  if (link) lines.push(`  host project link (${link.state}): ${link.linkPath}`);
  lines.push(
    "",
    `Deploy it with: npx --yes vercel@latest deploy --prebuilt   (the host builds nothing)`,
  );
  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2), io = { out: process.stdout, err: process.stderr }) {
  const args = parseArgs(argv);
  let prepared = null;
  if (!args.verifyOnly) {
    const result = materializeBuildOutput({
      distDir: args.dist,
      outDir: args.out,
      vercelJsonPath: args.vercelJson,
    });
    if (!result.ok) {
      io.err.write(`cannot assemble the build output: ${result.problem}\n`);
      return 2;
    }
    prepared = result;
  }

  // The host CLI has to know WHICH project this output belongs to. The ids come
  // from the environment (the workflow resolved them from the credential and
  // exported them), never from a guess; a local link that disagrees is refused.
  let link = null;
  if (args.linkProject) {
    const linked = ensureLocalProjectLink({
      orgId: process.env.VERCEL_ORG_ID ?? null,
      projectId: process.env.VERCEL_PROJECT_ID ?? null,
    });
    if (!linked.ok) {
      io.err.write(`cannot point the host CLI at the verified project: ${linked.problem}\n`);
      return 2;
    }
    link = linked;
  }

  const check = verifyBuildOutput({
    distDir: args.dist,
    outDir: args.out,
    vercelJsonPath: args.vercelJson,
    expectCommit: args.expectCommit,
    expectBranch: args.expectBranch,
  });
  const provenance = outputProvenance(args.out);

  if (args.json) {
    io.out.write(
      `${JSON.stringify(
        {
          schema: PREPARE_VERCEL_OUTPUT_SCHEMA,
          prepared: prepared && {
            outDir: prepared.outDir,
            files: prepared.files,
            bytes: prepared.bytes,
            buildInfoSha256: prepared.buildInfoSha256,
            routes: prepared.routes,
            rewrites: prepared.rewrites,
            fallback: prepared.fallback,
          },
          ok: check.ok,
          checks: check.checks,
          problems: check.problems,
          provenance: provenance && { commit: provenance.commit, branch: provenance.branch },
          link: link && { state: link.state, path: link.linkPath },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.out.write(formatPrepareReport({ prepared, check, provenance, link }));
  }
  return check.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main());
}
