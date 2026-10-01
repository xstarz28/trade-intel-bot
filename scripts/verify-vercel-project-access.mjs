#!/usr/bin/env node
/**
 * Phase 300 — verify a PINNED Vercel target against the credential that will
 * deploy to it, BEFORE anything is built or uploaded.
 *
 * WHY THIS EXISTS
 * ---------------
 * Run 36823507179: the publication workflow's pinned path ("pinned values win")
 * exported VERCEL_ORG_ID / VERCEL_PROJECT_ID / host from GitHub Environment
 * variables and exited 0 WITHOUT a single API call — so the `vercel deploy
 * --prebuilt` step became the FIRST place the token was checked against the
 * identifiers, and the only symptom was the host CLI's opaque
 * "Error: Could not retrieve Project Settings." with the misleading advice to
 * "remove the .vercel directory". A pinned identifier is a CLAIM; this script
 * is the check of that claim against the credential's own scope.
 *
 * WHAT IT DOES — one read-only call, the same one that failed
 * ----------------------------------------------------------
 *   GET /v9/projects/<projectId>?teamId=<orgId>
 *
 * which is exactly the "Project Settings" retrieval the host CLI performs at
 * deploy time. The outcome CLASSIFIES the failure instead of swallowing it:
 *
 *   TOKEN_CANNOT_ACCESS_ORG   401/403 — the token authenticates but cannot
 *                             read this org's project: regenerate/re-scope the
 *                             token (the identifiers are NOT accused).
 *   PROJECT_NOT_UNDER_ORG     404 — no project with this id under this org id
 *                             is visible to this token: the pinned pair does
 *                             not match the credential — re-derive with
 *                             `npm run frontend:resolve` and re-pin.
 *   PROJECT_SETTINGS_UNREACHABLE  any other HTTP status (named, with the
 *                             status and a capped body excerpt).
 *   HOST_NOT_ON_PROJECT       settings retrieved, but the pinned host is not
 *                             among the project's own domains/aliases
 *                             (`--allow-unverified-host` to accept).
 *   PROJECT_ACCESS_VERIFIED   200 and host listed — the deploy's first host
 *                             API call is known-good before the run invests
 *                             a build in it.
 *   NO_CREDENTIAL / API_UNREACHABLE / INCOMPLETE_TARGET — cannot evaluate.
 *
 * SAFETY
 * ------
 * Read-only GET; never creates, links, deploys or deletes anything. The token
 * is read from the VERCEL_TOKEN environment variable only — never argv, never
 * printed. Printed values are non-secret identifiers and HTTP statuses.
 *
 * Usage:
 *   VERCEL_TOKEN=... node scripts/verify-vercel-project-access.mjs \
 *     --org-id <orgId> --project-id <projectId> --host-url https://<host>
 *   (--org-id/--project-id/--host-url default to VERCEL_ORG_ID /
 *    VERCEL_PROJECT_ID / XSTARZ_FRONTEND_HOST_URL from the environment)
 *
 * Exit codes: 0 verified · 1 refused (named state) · 2 could not evaluate.
 */

import {
  VERCEL_API,
  isHostnameShaped,
  projectDomains,
  vercelGet,
} from "./resolve-vercel-target.mjs";

export const VERCEL_PROJECT_ACCESS_SCHEMA = "phase300.vercel-project-access/v1";

/** The named states, with the exit class each maps to. */
export const PROJECT_ACCESS_STATES = {
  VERIFIED: "PROJECT_ACCESS_VERIFIED",
  /** vercel/vercel#17506: the settings ARE readable by this credential, but
   *  the CLI's own user/team scope lookups are the poisoned part for
   *  project-scoped tokens. Publication proceeds — the pipeline avoids those
   *  lookups (project.json link, org/project env dropped at deploy, REST
   *  alias). */
  SCOPE_METADATA_RISK: "PROJECT_ACCESS_SCOPE_METADATA_RISK",
  TOKEN_CANNOT_ACCESS_ORG: "TOKEN_CANNOT_ACCESS_ORG",
  PROJECT_NOT_UNDER_ORG: "PROJECT_NOT_UNDER_ORG",
  PROJECT_SETTINGS_UNREACHABLE: "PROJECT_SETTINGS_UNREACHABLE",
  HOST_NOT_ON_PROJECT: "HOST_NOT_ON_PROJECT",
  NO_CREDENTIAL: "NO_CREDENTIAL",
  INCOMPLETE_TARGET: "INCOMPLETE_TARGET",
  API_UNREACHABLE: "API_UNREACHABLE",
};

/** 0 = verified, 2 = cannot evaluate (environment), 1 = refused (named). */
export function exitCodeFor(state) {
  if (state === PROJECT_ACCESS_STATES.VERIFIED) return 0;
  if (state === PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK) return 0;
  if (
    state === PROJECT_ACCESS_STATES.NO_CREDENTIAL ||
    state === PROJECT_ACCESS_STATES.API_UNREACHABLE
  ) {
    return 2;
  }
  return 1;
}

/**
 * The whole verification, injectable argv/env/fetch so the exact pinned
 * situation can be reproduced in a test without a network or a credential.
 */
export async function verifyVercelProjectAccess({
  argv = [],
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const args = {
    orgId: env.VERCEL_ORG_ID ?? null,
    projectId: env.VERCEL_PROJECT_ID ?? null,
    hostUrl: env.XSTARZ_FRONTEND_HOST_URL ?? null,
    allowUnverifiedHost: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org-id") args.orgId = argv[++i];
    else if (arg.startsWith("--org-id=")) args.orgId = arg.split("=")[1];
    else if (arg === "--project-id") args.projectId = argv[++i];
    else if (arg.startsWith("--project-id=")) args.projectId = arg.split("=")[1];
    else if (arg === "--host-url") args.hostUrl = argv[++i];
    else if (arg.startsWith("--host-url=")) args.hostUrl = arg.split("=")[1];
    else if (arg === "--allow-unverified-host") args.allowUnverifiedHost = true;
    else if (arg === "--json") args.json = true;
  }
  const clean = (value) => String(value ?? "").trim() || null;
  args.orgId = clean(args.orgId);
  args.projectId = clean(args.projectId);
  args.hostUrl = clean(args.hostUrl);

  const evidence = [];
  const token = clean(env.VERCEL_TOKEN);
  if (!token) {
    return {
      schema: VERCEL_PROJECT_ACCESS_SCHEMA,
      state: PROJECT_ACCESS_STATES.NO_CREDENTIAL,
      problems: [
        "VERCEL_TOKEN is not set, so the pinned target cannot be checked against the credential",
      ],
      evidence,
      httpStatus: null,
    };
  }
  const missing = [
    !args.orgId && "VERCEL_ORG_ID/--org-id",
    !args.projectId && "VERCEL_PROJECT_ID/--project-id",
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      schema: VERCEL_PROJECT_ACCESS_SCHEMA,
      state: PROJECT_ACCESS_STATES.INCOMPLETE_TARGET,
      problems: [
        `the pinned target is missing ${missing.join(" and ")} — pin all identifiers or let frontend:resolve read them from the credential`,
      ],
      evidence,
      httpStatus: null,
    };
  }

  // The exact call whose failure the host CLI reports as
  // "Error: Could not retrieve Project Settings."
  const detail = await vercelGet(
    `/v9/projects/${encodeURIComponent(args.projectId)}?teamId=${encodeURIComponent(args.orgId)}`,
    { token, fetchImpl },
  );
  evidence.push(`GET /v9/projects/${args.projectId}?teamId=… -> ${detail.status ?? "transport failure"}`);

  if (!detail.ok) {
    if (detail.status === null) {
      return {
        schema: VERCEL_PROJECT_ACCESS_SCHEMA,
        state: PROJECT_ACCESS_STATES.API_UNREACHABLE,
        problems: [`the host API could not be reached: ${detail.text}`],
        evidence,
        httpStatus: null,
        orgId: args.orgId,
        projectId: args.projectId,
      };
    }
    if (detail.status === 401 || detail.status === 403) {
      // vercel/vercel#17506 — for a project-scoped token the teamId-suffixed
      // project read is NOT a reliable access verdict: the CLI's own trace
      // shows /v2/user -> 404, /teams/<org> -> 403, and the SAME suffixed
      // project read -> 200, and it still threw. So a 401/403 here is judged
      // only after an UNSUFFIXED read of the same project: if THAT succeeds,
      // the credential CAN read the project and the failing part is the CLI's
      // scope-metadata combining (case B), not the token (case A).
      const unsuffixed = await vercelGet(`/v9/projects/${encodeURIComponent(args.projectId)}`, {
        token,
        fetchImpl,
      });
      evidence.push(
        `GET /v9/projects/${args.projectId} (no teamId) -> ${unsuffixed.status ?? "transport failure"}`,
      );
      if (unsuffixed.ok) {
        const project = unsuffixed.json?.project ?? unsuffixed.json ?? {};
        return {
          schema: VERCEL_PROJECT_ACCESS_SCHEMA,
          state: PROJECT_ACCESS_STATES.SCOPE_METADATA_RISK,
          problems: [],
          evidence,
          httpStatus: unsuffixed.status,
          orgId: args.orgId,
          projectId: args.projectId,
          projectName: typeof project.name === "string" ? project.name : null,
          hostUrl: null,
          scopeNote:
            `the suffixed read was refused (HTTP ${detail.status}) but the unsuffixed read succeeded — ` +
            "the credential CAN read this project (vercel/vercel#17506); publication proceeds: the project link is the .vercel/project.json file, the deploy step drops the org/project env vars, and the alias is assigned through the teamId-scoped REST API instead of the CLI's user lookup",
        };
      }
      return {
        schema: VERCEL_PROJECT_ACCESS_SCHEMA,
        state: PROJECT_ACCESS_STATES.TOKEN_CANNOT_ACCESS_ORG,
        problems: [
          `the credential was refused for this project with AND without the org scope (HTTP ${detail.status}, then ${unsuffixed.status}) — a genuine token-access refusal (case A), not the CLI's scope-metadata artifact: the credential cannot read project ${args.projectId} under org ${args.orgId}`,
        ],
        evidence,
        httpStatus: detail.status,
        orgId: args.orgId,
        projectId: args.projectId,
      };
    }
    if (detail.status === 404) {
      return {
        schema: VERCEL_PROJECT_ACCESS_SCHEMA,
        state: PROJECT_ACCESS_STATES.PROJECT_NOT_UNDER_ORG,
        problems: [
          `no project ${args.projectId} is visible under org ${args.orgId} for this credential (HTTP 404) — the pinned identifiers do not match this token's scope; re-derive them with 'npm run frontend:resolve' and re-pin`,
        ],
        evidence,
        httpStatus: 404,
        orgId: args.orgId,
        projectId: args.projectId,
      };
    }
    return {
      schema: VERCEL_PROJECT_ACCESS_SCHEMA,
      state: PROJECT_ACCESS_STATES.PROJECT_SETTINGS_UNREACHABLE,
      problems: [
        `project settings could not be retrieved (HTTP ${detail.status}): ${detail.text}`,
      ],
      evidence,
      httpStatus: detail.status,
      orgId: args.orgId,
      projectId: args.projectId,
    };
  }

  const project = detail.json?.project ?? detail.json ?? {};
  const projectName = typeof project.name === "string" ? project.name : null;
  evidence.push(
    `project settings retrieved: project ${projectName ?? args.projectId} belongs to org ${args.orgId} for this credential`,
  );

  const problems = [];
  let hostUrl = null;
  if (args.hostUrl) {
    const want = args.hostUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    if (!isHostnameShaped(want)) {
      problems.push(`the pinned host is not a hostname (${JSON.stringify(args.hostUrl)}) — refusing`);
    } else {
      const domains = projectDomains(project, []);
      const found = domains.find((d) => d.name === want);
      if (found) {
        hostUrl = `https://${want}`;
        evidence.push(`host ${want} is listed on the project (${found.source})`);
      } else if (args.allowUnverifiedHost) {
        hostUrl = `https://${want}`;
        evidence.push(`host ${want} is NOT listed on the project (accepted with --allow-unverified-host)`);
      } else {
        problems.push(
          `the pinned host ${want} is not among the project's domains/aliases (${domains.map((d) => d.name).join(", ") || "none"}) — refusing to alias a host this project does not serve`,
        );
      }
    }
  }

  if (problems.length > 0) {
    return {
      schema: VERCEL_PROJECT_ACCESS_SCHEMA,
      state: PROJECT_ACCESS_STATES.HOST_NOT_ON_PROJECT,
      problems,
      evidence,
      httpStatus: 200,
      orgId: args.orgId,
      projectId: args.projectId,
      projectName,
      hostUrl: null,
    };
  }

  return {
    schema: VERCEL_PROJECT_ACCESS_SCHEMA,
    state: PROJECT_ACCESS_STATES.VERIFIED,
    problems: [],
    evidence,
    httpStatus: 200,
    orgId: args.orgId,
    projectId: args.projectId,
    projectName,
    hostUrl: hostUrl ?? null,
  };
}

function formatReport(report) {
  const lines = [`pinned vercel target: ${report.state}`];
  if (report.orgId) lines.push(`  VERCEL_ORG_ID: ${report.orgId}`);
  if (report.projectId) lines.push(`  VERCEL_PROJECT_ID: ${report.projectId}`);
  if (report.projectName) lines.push(`  project: ${report.projectName}`);
  if (report.hostUrl) lines.push(`  host: ${report.hostUrl}`);
  lines.push("", "evidence:", ...(report.evidence ?? []).map((e) => `  - ${e}`));
  if (report.scopeNote) lines.push(`  - note: ${report.scopeNote}`);
  if (report.problems?.length) {
    lines.push("", "problems:", ...report.problems.map((p) => `  - ${p}`));
  }
  lines.push(
    "",
    "Read-only check: this command never creates, links, deploys or changes anything, and the token's value was never read into this output.",
    `API base: ${VERCEL_API}`,
  );
  return `${lines.join("\n")}\n`;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const report = await verifyVercelProjectAccess({ argv, env: process.env });
  process.stdout.write(
    argv.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
  );
  process.exit(exitCodeFor(report.state));
}
