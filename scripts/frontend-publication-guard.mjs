#!/usr/bin/env node
/**
 * Phase 300 — operator/CI gate in front of a BROWSER-FACING frontend publication.
 *
 * Reads SOURCE_REF / GITHUB_REF, XSTARZ_REQUIRED_SOURCE_BRANCH,
 * XSTARZ_FRONTEND_HOST_URL (or FRONTEND_HOST_URL), XSTARZ_FRONTEND_MODE and the
 * host credential's PRESENCE (VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID)
 * from the process environment, and asks
 * `src/lib/deployment/frontend-publication-guard.ts` whether this run may
 * publish — or only verify — the development frontend.
 *
 * It never contacts a host, never uploads anything, never prints a credential
 * and never reports a publication. The publication's own evidence is the
 * published URL fetched by `scripts/verify-published-frontend.mjs`.
 *
 * Usage:
 *   npm run frontend:publish:guard
 *   npm run frontend:publish:guard -- --json
 *   npm run frontend:publish:guard -- \
 *     --require-branch arena/01a0d195-trade-intel-bot \
 *     --host-url https://trade-intel-bot.example.app --mode verify-only
 *
 * Exit codes:
 *   0 = ready (publish or verify-only), 1 = refused, 2 = could not evaluate
 */
import { registerTypeScriptResolution } from "./lib/ts-module-loader.mjs";

registerTypeScriptResolution();

const { evaluateFrontendPublicationGuard } = await import(
  "../src/lib/deployment/frontend-publication-guard.ts"
);

export const HOST_PUBLICATION_CREDENTIAL_ENV = [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
];

const argv = process.argv.slice(2);
const env = process.env;
const asJson = argv.includes("--json");

const input = {
  sourceRef: env.SOURCE_REF || env.GITHUB_REF || undefined,
  requiredSourceBranch: env.XSTARZ_REQUIRED_SOURCE_BRANCH || undefined,
  hostUrl: env.XSTARZ_FRONTEND_HOST_URL || env.FRONTEND_HOST_URL || undefined,
  mode: env.XSTARZ_FRONTEND_MODE === "verify-only" ? "verify-only" : "publish",
  hostCredential: {
    tokenPresent: Boolean(env.VERCEL_TOKEN && env.VERCEL_TOKEN.trim()),
    orgPresent: Boolean(env.VERCEL_ORG_ID && env.VERCEL_ORG_ID.trim()),
    projectPresent: Boolean(env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID.trim()),
  },
};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--require-branch") input.requiredSourceBranch = argv[++i];
  else if (arg.startsWith("--require-branch=")) input.requiredSourceBranch = arg.split("=")[1];
  else if (arg === "--source-ref") input.sourceRef = argv[++i];
  else if (arg.startsWith("--source-ref=")) input.sourceRef = arg.split("=")[1];
  else if (arg === "--host-url") input.hostUrl = argv[++i];
  else if (arg.startsWith("--host-url=")) input.hostUrl = arg.split("=")[1];
  else if (arg === "--mode") input.mode = argv[++i] === "verify-only" ? "verify-only" : "publish";
  else if (arg.startsWith("--mode=")) input.mode = arg.split("=")[1] === "verify-only" ? "verify-only" : "publish";
  else if (arg === "--no-credential") {
    input.hostCredential = { tokenPresent: false, orgPresent: false, projectPresent: false };
  }
}

const report = evaluateFrontendPublicationGuard(input);

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const lines = [
    `frontend publication guard: ${report.state}`,
    `  mode: ${report.mode}`,
    `  source ref: ${report.sourceRef ?? "(none)"}`,
    `  pinned branch: ${report.requiredSourceBranch ?? "(none)"}`,
    `  browser-facing origin: ${report.hostUrl ?? "(none)"}`,
  ];
  if (report.hostUrlIgnoredPath) lines.push(`  path dropped from the URL: ${report.hostUrlIgnoredPath}`);
  lines.push(
    `  host credential present: token=${report.hostCredential.tokenPresent} org=${report.hostCredential.orgPresent} project=${report.hostCredential.projectPresent}`,
  );
  lines.push(`  may publish: ${report.mayPublish}`);
  lines.push(`  may verify the published URL: ${report.mayVerify}`);
  lines.push(`  publication performed: ${report.publicationPerformed}`);
  lines.push(`  published frontend verified: ${report.frontendVerified}`);
  lines.push("");
  lines.push("problems:");
  lines.push(report.problems.length === 0 ? "  none" : report.problems.map((p) => `  - ${p}`).join("\n"));
  lines.push("");
  lines.push(`statement: ${report.statement}`);
  lines.push("This command does not publish, does not contact a host, does not print a credential");
  lines.push("and does not admit a release.");
  process.stdout.write(`${lines.join("\n")}\n`);
}

const ready = report.state === "READY_TO_PUBLISH" || report.state === "READY_TO_VERIFY_ONLY";
process.exit(ready ? 0 : 1);
