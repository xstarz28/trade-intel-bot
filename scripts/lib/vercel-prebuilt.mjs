/**
 * Phase 300 final hotfix — publish the VERIFIED artifact as a PREBUILT
 * deployment, so the host never runs a build of its own.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first publication attempt uploaded the verified directory with
 * `vercel deploy dist`. The host treated the upload as *source*: it ran the
 * project's build command remotely, in a container that has no `node_modules`,
 * and the deployment failed with
 *
 *     Running "vercel build"
 *     sh: line 1: vite: command not found
 *     Error: Command "vite build" exited with 127
 *
 * Two things were wrong with that, and only the second one is loud:
 *
 *   1. It failed. That is visible.
 *   2. It would have REBUILT the frontend — remotely, from the uploaded
 *      directory rather than necessarily the same revision — and then served
 *      those bytes under the URL that `verify:published` checks. Phase 300's
 *      whole invariant is "what was verified is what is published"; a remote
 *      build makes those two different artifacts, and a green remote build
 *      would have hidden it.
 *
 * So the publication now assembles the Vercel **Build Output API** directory
 * itself, from the exact directory that passed `verify:frontend`, and deploys
 * it with `vercel deploy --prebuilt`. `--prebuilt` uploads `.vercel/output`
 * as-is; the host does not build it. The bytes are the verified bytes.
 *
 * WHY NOT `vercel build`
 * ----------------------
 * The task's own constraint is that `.vercel/output` must be derived from the
 * SAME verified build and must not silently rebuild from another revision.
 * `vercel build` runs the project's build command locally — for this project
 * that is `vite build`, i.e. a SECOND build of the same checkout, whose output
 * is only incidentally identical to the artifact that already passed
 * `verify:frontend` (and which for the Vite preset writes `dist/` again). It
 * would replace the verified directory with a fresh one. Assembling the Build
 * Output API layout by copying the verified bytes is therefore strictly
 * stronger than calling `vercel build`, and needs no second build at all.
 *
 * WHAT IT PRODUCES
 * ----------------
 *   .vercel/output/config.json   routing, derived from `vercel.json` (see below)
 *   .vercel/output/static/**     a byte-identical copy of the verified `dist/`
 *
 * Routing: the Build Output API's `config.json` knows `routes`, not the
 * `rewrites` of `vercel.json`. `vercel.json`'s rewrites are applied AFTER the
 * filesystem is checked — that is what makes the existing
 * `{ "source": "/(.*)", "destination": "/index.html" }` a single-page-app
 * fallback instead of a rule that swallows `/assets/*.js`. The same order is
 * reproduced explicitly:
 *
 *   "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/index.html" } ]
 *
 * A `vercel.json` key that this converter would DROP (redirects, headers,
 * cleanUrls, …) is a refusal, not a silent change of runtime behaviour.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * · It never runs a build. The only input is the directory that already passed
 *   the artifact contract.
 * · It never deploys. `vercel deploy --prebuilt` is a separate call made by the
 *   caller, and the deploy itself is the project-scoped REST path in
 *   `vercel-rest-deploy.mjs` (phase 300g — the CLI's link flow reproduces the
 *   vercel/vercel#17506 refusal for project-scoped tokens).
 *   publication knows — there is no fallback to a build-triggering deploy.
 * · It never writes outside `.vercel/` (a local, ignored directory): the link
 *   file it may create contains the org/project ids the resolver READ, never a
 *   guess, and it refuses to overwrite a link that disagrees with them.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve as resolvePath, sep } from "node:path";

/** The checked-in configuration whose rewrites define the deployment's routing. */
export const VERCEL_CONFIG_FILE = "vercel.json";
/** Where the host CLI looks for prebuilt output, relative to the project root. */
export const BUILD_OUTPUT_DIR = ".vercel/output";
/** The directory inside it whose files are served at the deployment's root. */
export const BUILD_OUTPUT_STATIC = "static";
/** The Build Output API configuration file. */
export const BUILD_OUTPUT_CONFIG_FILE = "config.json";
/** The Build Output API version this module emits. */
export const BUILD_OUTPUT_VERSION = 3;
/**
 * `vercel.json` keys this converter understands. Anything else would be
 * silently dropped from the built deployment, so it is refused by name.
 */
export const CONVERTIBLE_VERCEL_JSON_KEYS = ["$schema", "rewrites"];
/** The routing phase that must run before the rewrites: "serve the file if it exists". */
export const FILESYSTEM_HANDLE = "filesystem";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** True when a value is a non-empty string that looks like a route path/regex. */
function isRouteString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Turn the `rewrites` of a `vercel.json` into Build Output API `routes`, without
 * changing what they do: the filesystem phase runs first, then the rewrites —
 * exactly the order the host applies to `vercel.json` rewrites.
 *
 * Returns `{ ok: true, routes, rewrites, fallback }` or `{ ok: false, problem }`.
 * A refusal here means the deployment would NOT behave like the checked-in
 * configuration, which is not something a publication may decide silently.
 */
export function routesForBuildOutput(vercelJsonText) {
  let parsed;
  try {
    parsed = JSON.parse(vercelJsonText);
  } catch (error) {
    return { ok: false, problem: `vercel.json is not readable JSON (${error?.message ?? "parse error"})` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, problem: "vercel.json is not a JSON object" };
  }
  const dropped = Object.keys(parsed).filter((key) => !CONVERTIBLE_VERCEL_JSON_KEYS.includes(key));
  if (dropped.length > 0) {
    return {
      ok: false,
      problem:
        `vercel.json configures ${dropped.map((k) => `"${k}"`).join(", ")}, which this Build Output API ` +
        `converter does not carry over — refusing rather than publishing a deployment with different ` +
        `runtime behaviour`,
    };
  }
  const rewrites = parsed.rewrites;
  if (!Array.isArray(rewrites) || rewrites.length === 0) {
    return {
      ok: false,
      problem: "vercel.json has no rewrites, so the single-page-app routing of the current site could not be carried into the deployment",
    };
  }
  for (const [index, rule] of rewrites.entries()) {
    if (!rule || typeof rule !== "object" || !isRouteString(rule.source) || !isRouteString(rule.destination)) {
      return { ok: false, problem: `vercel.json rewrite #${index + 1} has no readable source/destination` };
    }
  }
  const routes = [
    { handle: FILESYSTEM_HANDLE },
    ...rewrites.map((rule) => ({ src: rule.source, dest: rule.destination })),
  ];
  return {
    ok: true,
    routes,
    rewrites: rewrites.map((rule) => ({ source: rule.source, destination: rule.destination })),
    fallback: rewrites.some((rule) => String(rule.destination).endsWith("/index.html")),
  };
}

/** The full Build Output API `config.json` for a `vercel.json`. */
export function buildOutputConfig(vercelJsonText) {
  const routing = routesForBuildOutput(vercelJsonText);
  if (!routing.ok) return routing;
  return { ...routing, config: { version: BUILD_OUTPUT_VERSION, routes: routing.routes } };
}

/** Every file under `dir`, as posix-relative paths, sorted. */
function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute, base));
    else if (entry.isFile()) out.push(absolute.slice(base.length + 1).split(sep).join(posix.sep));
  }
  return out.sort();
}

/** `{ path, bytes, sha256 }` for every file in a directory. */
function describeFiles(dir) {
  return walkFiles(dir).map((relative) => {
    const absolute = join(dir, relative);
    const bytes = readFileSync(absolute);
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

const totalBytes = (files) => files.reduce((sum, file) => sum + file.bytes, 0);

/**
 * Assemble `.vercel/output` from the VERIFIED artifact directory.
 *
 * `distDir` is the only source of content; `vercelJsonPath` is the source of
 * routing. Nothing is built, and the previous output directory is removed first
 * so a stale deployment can never be uploaded.
 */
export function materializeBuildOutput({
  distDir = "dist",
  outDir = BUILD_OUTPUT_DIR,
  vercelJsonPath = "vercel.json",
} = {}) {
  const distPath = resolvePath(distDir);
  const buildInfoPath = join(distPath, "build-info.json");
  const distIndexPath = join(distPath, "index.html");
  if (!existsSync(buildInfoPath) || !existsSync(distIndexPath)) {
    return {
      ok: false,
      problem: `the verified artifact is not in ${distDir} (build-info.json and index.html are required) — there is nothing to publish`,
    };
  }
  if (!existsSync(vercelJsonPath)) {
    return { ok: false, problem: `${vercelJsonPath} is missing, so the deployment's routing could not be derived` };
  }
  const configResult = buildOutputConfig(readFileSync(vercelJsonPath, "utf8"));
  if (!configResult.ok) return configResult;

  const outputPath = resolvePath(outDir);
  rmSync(outputPath, { recursive: true, force: true });
  const staticPath = join(outputPath, BUILD_OUTPUT_STATIC);
  mkdirSync(staticPath, { recursive: true });
  cpSync(distPath, staticPath, { recursive: true });

  if (!existsSync(join(staticPath, "build-info.json")) || !existsSync(join(staticPath, "index.html"))) {
    return { ok: false, problem: "the verified artifact could not be copied into the build output" };
  }

  const configPath = join(outputPath, BUILD_OUTPUT_CONFIG_FILE);
  const configText = `${JSON.stringify(configResult.config, null, 2)}\n`;
  writeFileSync(configPath, configText);

  const files = describeFiles(staticPath);
  const buildInfo = files.find((file) => file.path === "build-info.json");
  return {
    ok: true,
    outDir: outputPath,
    configPath,
    staticDir: staticPath,
    configText,
    config: configResult.config,
    routes: configResult.routes,
    rewrites: configResult.rewrites,
    fallback: configResult.fallback,
    files: files.length,
    fileList: files,
    bytes: totalBytes(files),
    buildInfoSha256: buildInfo?.sha256 ?? null,
    indexPath: join(staticPath, "index.html"),
  };
}

/**
 * Prove the assembled output IS the verified artifact: byte-for-byte, same
 * routing, same provenance. Anything else — a rebuilt `index.html`, a
 * bundle from another revision, a file the verified directory does not contain,
 * a stale routing config — is refused with the check named.
 *
 * This is the guard against the failure that made this module necessary: if the
 * host ever rebuilt the upload, what it would serve is exactly the kind of
 * mismatch this comparison rejects.
 */
export function verifyBuildOutput({
  distDir = "dist",
  outDir = BUILD_OUTPUT_DIR,
  vercelJsonPath = "vercel.json",
  expectCommit = null,
  expectBranch = null,
} = {}) {
  const checks = [];
  const problems = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) problems.push(`${name} — ${detail}`);
  };

  const distPath = resolvePath(distDir);
  const outputPath = resolvePath(outDir);
  const staticPath = join(outputPath, BUILD_OUTPUT_STATIC);
  const configPath = join(outputPath, BUILD_OUTPUT_CONFIG_FILE);
  if (!existsSync(configPath) || !existsSync(staticPath)) {
    return {
      ok: false,
      checks: [{ name: "build output exists", ok: false, detail: `${outDir} has no config.json/static — run the prepare step first` }],
      problems: [`build output exists — ${outDir} has no config.json/static`],
    };
  }

  // 1. Routing: version 3, filesystem phase first, rewrites unchanged.
  let config = null;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    record("config.json parses", false, `${error?.message ?? "parse error"}`);
  }
  if (config) {
    record("config.json parses", true, `${BUILD_OUTPUT_CONFIG_FILE} is JSON`);
    record(
      "config.json declares Build Output API version 3",
      config.version === BUILD_OUTPUT_VERSION,
      `version ${JSON.stringify(config.version)}`,
    );
    const expected = existsSync(vercelJsonPath)
      ? routesForBuildOutput(readFileSync(vercelJsonPath, "utf8"))
      : { ok: false, problem: `${vercelJsonPath} is missing` };
    if (!expected.ok) {
      record("routing is derived from a readable vercel.json", false, expected.problem);
    } else {
      record(
        "routing matches vercel.json (filesystem first, then its rewrites)",
        JSON.stringify(config.routes) === JSON.stringify(expected.routes),
        `${JSON.stringify(config.routes)} vs ${JSON.stringify(expected.routes)}`,
      );
    }
  }

  // 2. Content: every verified file present and identical, nothing extra.
  const distFiles = describeFiles(distPath);
  const staticFiles = describeFiles(staticPath);
  const byPath = new Map(staticFiles.map((file) => [file.path, file]));
  const missing = distFiles.filter((file) => !byPath.has(file.path)).map((file) => file.path);
  const differing = distFiles
    .filter((file) => byPath.has(file.path) && byPath.get(file.path).sha256 !== file.sha256)
    .map((file) => file.path);
  const extra = staticFiles.filter((file) => !distFiles.some((d) => d.path === file.path)).map((file) => file.path);
  record(
    "every verified file is in the build output",
    missing.length === 0,
    missing.length === 0 ? `${distFiles.length} file(s)` : `missing ${missing.join(", ")}`,
  );
  record(
    "the build output is byte-identical to the verified artifact",
    differing.length === 0,
    differing.length === 0 ? `${distFiles.length} file(s) match by sha256` : `differs: ${differing.join(", ")}`,
  );
  record(
    "the build output contains nothing the artifact does not",
    extra.length === 0,
    extra.length === 0 ? "no extra files" : `extra: ${extra.join(", ")}`,
  );

  // 3. Provenance: the output carries the commit/branch it is supposed to.
  if (existsSync(join(staticPath, "build-info.json"))) {
    let info = null;
    try {
      info = JSON.parse(readFileSync(join(staticPath, "build-info.json"), "utf8"));
    } catch {
      info = null;
    }
    if (expectCommit) {
      record(
        "the build output records the expected commit",
        info?.commit === expectCommit,
        `${info?.commit ?? "(none)"} vs ${expectCommit}`,
      );
    }
    if (expectBranch) {
      record(
        "the build output records the expected branch",
        info?.branch === expectBranch,
        `${info?.branch ?? "(none)"} vs ${expectBranch}`,
      );
    }
  } else {
    record("the build output carries build provenance", false, "static/build-info.json is absent");
  }

  return { ok: problems.length === 0, checks, problems };
}

/**
 * The ONLY deploy invocation shape this publication uses.
 *
 * `--prebuilt` tells the host to upload `.vercel/output` as-is. Without it, a
 * directory upload is treated as source and the host runs the project's build
 * command remotely — the failure ("vite: command not found") is merely the
 * visible half of it; the invisible half is that the published bytes would come
 * from a build nobody verified. `vercel deploy dist` is therefore not reachable
 * from here, not even as a fallback.
 */
/**
 * Make sure the host CLI knows WHICH project is being deployed.
 *
 * `.vercel/project.json` is local state (ignored by git), not a host mutation.
 * The ids come from the resolver, which reads them from the token — so this is
 * never a guess. An existing link file is used as-is when it agrees, and
 * refused when it disagrees, because "the deployment went to a different
 * project than the one that was verified against" is not a recoverable
 * surprise.
 */
export function ensureLocalProjectLink({ orgId, projectId, linkPath = join(".vercel", "project.json") } = {}) {
  if (!isRouteString(orgId) || !isRouteString(projectId)) {
    return { ok: false, problem: "the org and project ids must both be known before the host CLI can be pointed at a project" };
  }
  if (existsSync(linkPath)) {
    let link = null;
    try {
      link = JSON.parse(readFileSync(linkPath, "utf8"));
    } catch {
      return { ok: false, problem: `${linkPath} exists but is not readable JSON — refusing to overwrite local project state` };
    }
    const sameOrg = !link.orgId || link.orgId === orgId;
    const sameProject = !link.projectId || link.projectId === projectId;
    if (!sameOrg || !sameProject) {
      return {
        ok: false,
        problem:
          `${linkPath} points at org ${link.orgId ?? "(unset)"} / project ${link.projectId ?? "(unset)"}, but the ` +
          `resolved target is org ${orgId} / project ${projectId} — refusing to deploy to a project other than the one ` +
          `that was verified against`,
      };
    }
    return { ok: true, state: "existing", linkPath };
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  writeFileSync(linkPath, `${JSON.stringify({ orgId, projectId }, null, 2)}\n`);
  return { ok: true, state: "created", linkPath };
}

/** `statSync` as a boolean helper (used by the CLI's preflight). */
export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
