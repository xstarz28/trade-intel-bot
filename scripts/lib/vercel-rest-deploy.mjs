/**
 * Phase 300g — REST prebuilt deployment (the CLI cannot link with this token).
 *
 * WHY THIS EXISTS (evidence chain, reproduced 2026-10-01 against a local mock
 * of the Vercel API with CLI 62.1.0 AND 59.1.3):
 *
 *   `vercel deploy --prebuilt --yes` with a `.vercel/project.json` link and a
 *   project-scoped token performs the vercel/vercel#17506 scope lookups BEFORE
 *   any upload:
 *
 *     GET /v2/user                 -> 404 (project-scoped tokens have no user)
 *     GET /teams/<orgId>           -> 403 (code "forbidden" for this token)
 *     GET /v9/projects/<id>?teamId -> 200 (the project itself is readable)
 *
 *   and then throws "Could not retrieve Project Settings." (exit 1) without
 *   uploading anything. The deploy command tolerates ONLY the
 *   `team_unauthorized` 403 code (`isOwnerLookupUnavailableError`); with
 *   `forbidden` it dies. No invocation shape avoids it — reproduced with:
 *   plain, `--scope <teamId>`, `VERCEL_TEAM_ID=<teamId>`, `--project <id>`,
 *   on 62.1.0 and 59.1.3 alike. The upload itself is project-scoped-safe
 *   (proved: with the tolerated code the deployment is created successfully).
 *
 *   Therefore the publication path performs the deployment DIRECTLY over the
 *   REST API, replicating the CLI's prebuilt request exactly (captured from a
 *   real CLI run against the mock):
 *
 *     POST /v13/deployments?skipAutoDetectionConfirmation=1&prebuilt=1&teamId=<org>
 *       {"env":{},"build":{"env":{}},"name":<projectName>,"project":<projectId>,
 *        "meta":{},"projectSettings":{"sourceFilesOutsideRootDirectory":true},
 *        "source":"cli","version":2,
 *        "files":[{"file":".vercel/output/config.json","size":85,"mode":33188,
 *                  "sha":"<sha1 of content>"}, ...]}
 *     -> response.missing lists shas the server lacks; each is uploaded via
 *        POST /v2/files
 *          headers: content-type application/octet-stream, x-now-digest <sha>,
 *                   x-now-size <size>; body = raw file content
 *     -> then GET /v13/deployments/<id> is polled until the
 *        deployment leaves BUILDING/PENDING.
 *
 * SAFETY
 * ------
 * - Uploads ONLY the already-verified `.vercel/output` (Build Output API v3);
 *   refuses to run when `config.json` is missing or when
 *   `static/build-info.json` does not carry `--expect-commit` (fail closed —
 *   the bytes must be the verified artifact).
 * - The only endpoints touched are the project-scoped ones above. It NEVER
 *   calls `/v2/user` or `/teams/<org>` — the poisoned lookups are not part of
 *   this path, and a regression test locks that.
 * - The token comes from the VERCEL_TOKEN environment variable only — never
 *   argv, never printed, never included in an error.
 * - No project is created, nothing is built remotely, no domain is mutated.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const VERCEL_REST_DEPLOY_SCHEMA = "xstarz.vercel-rest-deploy.v1";

export const REST_DEPLOY_STATES = {
  DEPLOYED: "REST_DEPLOY_DEPLOYED",
  ARTIFACT_INVALID: "REST_DEPLOY_ARTIFACT_INVALID",
  PROJECT_READ_FAILED: "REST_DEPLOY_PROJECT_READ_FAILED",
  CREATE_REFUSED: "REST_DEPLOY_CREATE_REFUSED",
  UPLOAD_FAILED: "REST_DEPLOY_UPLOAD_FAILED",
  DEPLOYMENT_FAILED: "REST_DEPLOY_DEPLOYMENT_FAILED",
  DEPLOYMENT_TIMEOUT: "REST_DEPLOY_DEPLOYMENT_TIMEOUT",
  NO_CREDENTIAL: "REST_DEPLOY_NO_CREDENTIAL",
  INCOMPLETE_TARGET: "REST_DEPLOY_INCOMPLETE_TARGET",
};

/** Exit classes: 0 = deployed, 1 = refused/named failure, 2 = cannot evaluate. */
export function exitCodeFor(state) {
  if (state === REST_DEPLOY_STATES.DEPLOYED) return 0;
  if (
    state === REST_DEPLOY_STATES.NO_CREDENTIAL ||
    state === REST_DEPLOY_STATES.INCOMPLETE_TARGET
  ) {
    return 2;
  }
  return 1;
}

/**
 * Walk the assembled Build Output directory and produce the CLI-shaped file
 * list: POSIX paths prefixed with `.vercel/output/`, byte size, absolute mode,
 * and the plain sha1 of the content (the wire identity the deployments API
 * uses — verified against a captured CLI request).
 */
export async function collectOutputFiles({ outputDir, prefix = ".vercel/output" }) {
  const out = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const [info, content] = await Promise.all([stat(full), readFile(full)]);
      out.push({
        file: [prefix, relative(outputDir, full).split(sep).join("/")].join("/"),
        size: info.size,
        mode: info.mode,
        sha: createHash("sha1").update(content).digest("hex"),
      });
    }
  }
  await walk(outputDir);
  return out;
}

/**
 * The deployment request body — field-for-field the CLI 62.1.0 prebuilt shape
 * (captured 2026-10-01; see the module header). `target: "preview"` is
 * expressed by OMITTING the field, exactly like the CLI does.
 */
export function buildDeploymentRequestBody({ files, projectName, projectId, target }) {
  const body = {
    env: {},
    build: { env: {} },
    name: projectName,
    project: projectId,
    meta: {},
    projectSettings: { sourceFilesOutsideRootDirectory: true },
    source: "cli",
    version: 2,
    files,
  };
  if (target === "production") body.target = "production";
  return body;
}

function cap(text, limit = 400) {
  return String(text ?? "").slice(0, limit);
}

/**
 * Deploy `.vercel/output` to the EXISTING project over the REST API.
 *
 * Options are injectable (`fetchImpl`, `sleepMs`) so the exact flow is
 * reproducible in tests without a network or a credential.
 */
export async function restDeployPrebuilt(options = {}) {
  const {
    apiBase = "https://api.vercel.com",
    orgId,
    projectId,
    projectName,
    target = "preview",
    token,
    outputDir,
    expectCommit, // fail closed unless static/build-info.json carries this
    fetchImpl = fetch,
    sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs = 2_000,
    timeoutMs = 10 * 60_000,
  } = options;

  const evidence = [];
  const problems = [];

  if (!token) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.NO_CREDENTIAL,
      problems: ["VERCEL_TOKEN is not set — the deployment cannot be authenticated"],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  if (!orgId || !projectId || !projectName || !outputDir) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.INCOMPLETE_TARGET,
      problems: [
        `orgId, projectId, projectName and outputDir are all required (got orgId=${orgId ? "set" : "EMPTY"}, projectId=${projectId ? "set" : "EMPTY"}, projectName=${projectName ? "set" : "EMPTY"}, outputDir=${outputDir ?? "EMPTY"})`,
      ],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  const jsonHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  const readHeaders = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };

  // 0. The artifact must be the verified one — read-only checks, fail closed.
  let configBytes;
  try {
    configBytes = await readFile(join(outputDir, "config.json"));
  } catch {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.ARTIFACT_INVALID,
      problems: [
        `the Build Output directory has no config.json (${outputDir}) — the verified artifact was not assembled; nothing was uploaded`,
      ],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  let buildInfo;
  try {
    buildInfo = JSON.parse(await readFile(join(outputDir, "static", "build-info.json"), "utf8"));
  } catch {
    buildInfo = null;
  }
  if (expectCommit && (!buildInfo || buildInfo.commit !== expectCommit)) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.ARTIFACT_INVALID,
      problems: [
        `the assembled output is not the verified artifact (build-info commit ${buildInfo?.commit ?? "ABSENT"} != expected ${expectCommit}) — refusing to upload bytes nobody verified`,
      ],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  evidence.push(
    `artifact: ${outputDir} (config.json ${configBytes.length} bytes${buildInfo?.commit ? `, build-info commit ${buildInfo.commit}` : ""})`,
  );

  const files = await collectOutputFiles({ outputDir });
  if (files.length === 0) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.ARTIFACT_INVALID,
      problems: ["the Build Output directory is empty — nothing was uploaded"],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  evidence.push(`file list: ${files.length} file(s), ${files.reduce((n, f) => n + f.size, 0)} bytes`);

  // 1. The target verifier already proved the pinned project and returned its
  //    canonical name. Do not re-read project settings here: production run
  //    36845812412 proved that a second GET can return 403 even immediately
  //    after the verifier's identical project read returned 200 for the same
  //    credential. The deployment request carries the pinned project id plus
  //    this verifier-supplied name, so no redundant authorization check occurs.
  const resolvedName = projectName;
  evidence.push(`project: ${resolvedName} (supplied by the verified target; no project-settings lookup)`);

  // 2. Create the prebuilt deployment. A project-scoped token is denied team-level
  //    resources, so do not append teamId here; the request carries the verified
  //    project id in its body and the token scope supplies the authorization.
  const createUrl =
    `${apiBase}/v13/deployments?skipAutoDetectionConfirmation=1&prebuilt=1`;
  const createBody = JSON.stringify(
    buildDeploymentRequestBody({ files, projectName: resolvedName, projectId, target }),
  );
  const contentBySha = new Map();
  for (const info of files) contentBySha.set(info.sha, info);

  async function uploadMissingFiles(missing, deploymentId = null) {
    for (const entry of missing) {
      const sha = typeof entry === "string" ? entry : entry?.sha;
      const info = contentBySha.get(sha);
      if (!info) {
        return {
          ok: false,
          state: REST_DEPLOY_STATES.UPLOAD_FAILED,
          deploymentId,
          problem: `the server asked for sha ${sha} which is not in the verified file list — refusing to fetch it from anywhere else`,
        };
      }
      const content = await readFile(join(outputDir, relative(".vercel/output", info.file)));
      const uploadResponse = await fetchImpl(`${apiBase}/v2/files`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "x-now-digest": sha,
          "x-now-size": String(content.length),
        },
        body: content,
      });
      evidence.push(`POST /v2/files (${info.file}, ${content.length} bytes) -> ${uploadResponse.status}`);
      if (!uploadResponse.ok) {
        const uploadText = await uploadResponse.text();
        return {
          ok: false,
          state: REST_DEPLOY_STATES.UPLOAD_FAILED,
          deploymentId,
          problem: `the file upload was refused (HTTP ${uploadResponse.status}) for ${info.file}. Body excerpt: ${cap(uploadText)}`,
        };
      }
    }
    return { ok: true, state: null, deploymentId, problem: null };
  }

  const createDeployment = async () => {
    const response = await fetchImpl(createUrl, {
      method: "POST",
      headers: { ...jsonHeaders },
      body: createBody,
    });
    const textBody = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(textBody);
    } catch {
      // Keep the raw body for the named failure below.
    }
    return { response, textBody, payload };
  };

  let { response: createResponse, textBody: createText, payload: deployment } = await createDeployment();
  evidence.push(
    `POST /v13/deployments?...&prebuilt=1 -> ${createResponse.status} (${files.length} files listed, ${createBody.length} bytes)`,
  );

  // Vercel can return HTTP 400/missing_files as a preflight response rather than
  // 2xx with a deployment id. Upload that exact missing-sha set, then retry the
  // SAME verified create request once. No bytes outside the artifact may be used.
  if (
    !createResponse.ok &&
    createResponse.status === 400 &&
    deployment?.error?.code === "missing_files" &&
    Array.isArray(deployment.missing)
  ) {
    evidence.push(`create preflight: server reports ${deployment.missing.length} missing file sha(s); uploading them before retry`);
    const upload = await uploadMissingFiles(deployment.missing);
    if (!upload.ok) {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: upload.state,
        problems: [upload.problem],
        evidence,
        deploymentUrl: null,
        deploymentId: null,
      };
    }
    ({ response: createResponse, textBody: createText, payload: deployment } = await createDeployment());
    evidence.push(
      `POST /v13/deployments retry -> ${createResponse.status} (${files.length} files listed, ${createBody.length} bytes)`,
    );
  }

  if (!createResponse.ok) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.CREATE_REFUSED,
      problems: [
        `the deployment create was refused (HTTP ${createResponse.status}). Body excerpt: ${cap(createText)}`,
      ],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  if (!deployment) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.CREATE_REFUSED,
      problems: [`the deployment create returned a non-JSON body. Excerpt: ${cap(createText)}`],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }
  const deploymentId = deployment.id ?? null;
  if (!deploymentId) {
    return {
      schema: VERCEL_REST_DEPLOY_SCHEMA,
      state: REST_DEPLOY_STATES.CREATE_REFUSED,
      problems: ["the deployment create response carried no id — cannot poll or alias it"],
      evidence,
      deploymentUrl: null,
      deploymentId: null,
    };
  }

  // 3. Upload whatever a successful create response says it still lacks.
  const missing = Array.isArray(deployment.missing) ? deployment.missing : [];
  if (missing.length > 0) {
    const upload = await uploadMissingFiles(missing, deploymentId);
    if (!upload.ok) {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: upload.state,
        problems: [upload.problem],
        evidence,
        deploymentUrl: null,
        deploymentId,
      };
    }
  } else {
    evidence.push("no missing files — the server accepted every sha on creation");
  }
  // 4. Poll until the deployment leaves BUILDING/PENDING/QUEUED.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pollResponse = await fetchImpl(
      `${apiBase}/v13/deployments/${encodeURIComponent(deploymentId)}`,
      { method: "GET", headers: { ...readHeaders } },
    );
    const pollText = await pollResponse.text();
    if (!pollResponse.ok) {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: REST_DEPLOY_STATES.DEPLOYMENT_FAILED,
        problems: [
          `the deployment status read failed (HTTP ${pollResponse.status}). Body excerpt: ${cap(pollText)}`,
        ],
        evidence,
        deploymentUrl: null,
        deploymentId,
      };
    }
    let status;
    try {
      status = JSON.parse(pollText);
    } catch {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: REST_DEPLOY_STATES.DEPLOYMENT_FAILED,
        problems: [`the deployment status was a non-JSON body. Excerpt: ${cap(pollText)}`],
        evidence,
        deploymentUrl: null,
        deploymentId,
      };
    }
    const readyState = status.readyState ?? status.status;
    evidence.push(`poll ${deploymentId}: readyState=${readyState}`);
    if (readyState === "READY") {
      const url = status.url ?? deployment.url;
      if (!url) {
        return {
          schema: VERCEL_REST_DEPLOY_SCHEMA,
          state: REST_DEPLOY_STATES.DEPLOYMENT_FAILED,
          problems: ["the deployment reported READY but carried no url"],
          evidence,
          deploymentUrl: null,
          deploymentId,
        };
      }
      const deploymentUrl = url.startsWith("http") ? url : `https://${url}`;
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: REST_DEPLOY_STATES.DEPLOYED,
        problems: [],
        evidence,
        deploymentUrl,
        deploymentId,
      };
    }
    if (readyState === "ERROR" || readyState === "CANCELED") {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: REST_DEPLOY_STATES.DEPLOYMENT_FAILED,
        problems: [`the deployment ended in readyState=${readyState}`],
        evidence,
        deploymentUrl: null,
        deploymentId,
      };
    }
    if (Date.now() > deadline) {
      return {
        schema: VERCEL_REST_DEPLOY_SCHEMA,
        state: REST_DEPLOY_STATES.DEPLOYMENT_TIMEOUT,
        problems: [
          `the deployment did not become READY within ${Math.round(timeoutMs / 1000)}s (last readyState=${readyState})`,
        ],
        evidence,
        deploymentUrl: null,
        deploymentId,
      };
    }
    await sleepMs(pollIntervalMs);
  }
}
