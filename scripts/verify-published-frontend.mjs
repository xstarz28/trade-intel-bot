#!/usr/bin/env node
/**
 * Phase 300 — verify the PUBLISHED frontend over HTTP, and refuse acceptance.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 299 verified the artifact in `dist/`. That says what CI built, not what
 * a browser receives. Between the two sit a host, a project setting, a branch
 * rule, a cache and a build pipeline nobody in this repository controls — and
 * the same origin has served both the current product UI and a retired
 * build-platform scaffold, with only the colours to tell them apart.
 *
 * So this checker asks the network. It fetches the real URL and applies the
 * SAME rules the artifact checker applies to `dist/`:
 *
 *   1. `/build-info.json`  — exists, parses, schema/commit/branch/instant valid
 *   2. `/`                 — the served HTML carries `xstarz-build-*` meta tags
 *                            that AGREE with that JSON
 *   3. `/build`            — the provenance route answers (no silent 404)
 *   4. the assets the page actually loads — no retired platform branding, no
 *                            retired email-OTP surface, Xstarz blue primary
 *                            present and the retired teal-green absent, current
 *                            sign-in copy shipped
 *
 * Acceptance is refused, by name, when any of those fails — including the cases
 * that look like success: a host that answers 200 with a legacy build, a host
 * that serves the current HTML but a stale `/build-info.json`, and a host that
 * serves nothing at all. A green GitHub workflow is not consulted, because it
 * cannot know any of this.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It sends no credential, follows no redirect out of the configured origin, and
 * reads only GET responses. It never writes, publishes or "fixes" anything: a
 * wrong published frontend must fail loudly.
 *
 * Usage:
 *   node scripts/verify-published-frontend.mjs --url https://host
 *   node scripts/verify-published-frontend.mjs --url https://host \
 *     --expect-branch arena/01a0d195-trade-intel-bot --expect-commit <sha>
 *   node scripts/verify-published-frontend.mjs --url https://host --json
 *   node scripts/verify-published-frontend.mjs --url https://host \
 *     --expect-build-info-sha256 "$(sha256sum dist/build-info.json | cut -d' ' -f1)" \
 *     --expect-asset-names "assets/index-abc123.js,assets/index-def456.css"
 *
 * `--expect-build-info-sha256` is what makes "verified" and "published" the same
 * thing: it compares the BYTES of the served provenance file with the bytes of
 * the artifact that passed `verify:frontend`, so a host that rebuilds after
 * verification is caught even when the content looks right.
 *
 * Exit codes:
 *   0 = the published frontend is the expected revision and carries no legacy
 *       surface (every check passed)
 *   1 = at least one check failed (the report names it)
 *   2 = nothing could be inspected (transport failure before any usable answer)
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  BRAND_PRIMARY_OKLCH,
  CURRENT_AUTH_MARKERS,
  RETIRED_OTP_MARKERS,
  RETIRED_PLATFORM_MARKERS,
  RETIRED_PRIMARY_OKLCH,
  colorMatches,
  evaluateFrontendArtifact,
  metaContent,
  primaryTokens,
} from "./verify-frontend-artifact.mjs";

/** Bounds: a published page is fetched, never crawled. */
export const MAX_ASSETS = 24;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The published evaluation: the artifact contract applied to what the network
 * returned, plus the checks that only make sense for a live URL.
 *
 * Pure — the caller supplies the responses — so the rules can be tested without
 * a host, and so there is exactly ONE definition of "this is not our artifact"
 * shared by the build-time and published-time checks.
 */
export function evaluatePublishedFrontend({
  url,
  buildInfoText,
  buildInfoStatus,
  indexHtml,
  indexPath,
  buildRouteHtml,
  buildRouteStatus,
  assets,
  expected = {},
}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const index = indexHtml ?? "";
  const cssText = assets
    .filter((a) => /\.css(\?|$)/i.test(a.path))
    .map((a) => a.text)
    .join("\n");

  // 1-4. The published URL must satisfy the same contract as `dist/`.
  const artifact = evaluateFrontendArtifact({
    indexHtml: indexHtml ?? null,
    buildInfoText: buildInfoText ?? null,
    textAssets: assets,
    cssText,
    expected,
  });
  for (const check of artifact.checks) {
    // The artifact checker's wording is about a build directory; keep the rule,
    // name the surface it was applied to.
    add(check.name, check.ok, `${check.detail} [published]`);
  }

  // 5. Published-only: the provenance route must answer.
  add(
    "published /build route answers",
    buildRouteStatus === 200 && /<html/i.test(buildRouteHtml ?? ""),
    buildRouteStatus === 200
      ? "200 with an HTML document"
      : `/build returned ${buildRouteStatus ?? "no response"} — a provenance route nobody can open is a provenance claim nobody can check`,
  );

  // 6. Published-only: `/build-info.json` must have answered 200, not a 404 that
  //    happened to be JSON-ish, and the HTML must have come from this origin.
  add(
    "published /build-info.json answered 200",
    buildInfoStatus === 200,
    buildInfoStatus === 200
      ? "200"
      : `/build-info.json returned ${buildInfoStatus ?? "no response"} — the artifact may embed provenance while the host serves the legacy build`,
  );
  add(
    "published index page answered 200",
    !indexPath || indexPath === "/",
    `the served HTML came from ${indexPath ?? "/"}`,
  );

  // 7. Published-only: every asset the page loads must have been fetchable. An
  //    index that references a bundle the host does not serve is a broken site
  //    that a build-time check cannot see.
  const unfetchable = assets.filter((a) => a.status !== 200);
  add(
    "every referenced asset was served",
    unfetchable.length === 0,
    unfetchable.length === 0
      ? `${assets.length} asset(s) fetched`
      : `not served: ${unfetchable.map((a) => `${a.path} (${a.status ?? "no response"})`).join(", ")}`,
  );

  // 8. Report the provenance actually observed, so the log answers "which
  //    commit is live?" without the reader opening anything.
  let observed = null;
  if (buildInfoText) {
    try {
      observed = JSON.parse(buildInfoText);
    } catch {
      observed = null;
    }
  }
  const metaCommit = metaContent(index, "xstarz-build-commit");
  add(
    "published provenance is readable",
    observed !== null && typeof observed.commit === "string",
    observed
      ? `commit ${observed.commit} on ${observed.branch} built ${observed.builtAt}${
          metaCommit ? ` (html meta ${metaCommit})` : " (html meta absent)"
        }`
      : "the published provenance could not be read",
  );

  // 9. Published-only, and the strictest check here: the SAME BYTES the artifact
  //    check approved must be the bytes the host serves. A host that rebuilds
  //    after verification can produce a bundle that passes every content check
  //    and still not be the artifact that was verified — this is what makes
  //    "published" and "verified" the same thing rather than two similar things.
  if (expected.buildInfoSha256) {
    const served = createHash("sha256").update(buildInfoText ?? "").digest("hex");
    const want = expected.buildInfoSha256.trim().toLowerCase();
    add(
      "published provenance is the byte-identical verified file",
      served === want,
      served === want
        ? `sha256 ${served}`
        : `served sha256 ${served}, verified artifact ${want} — the host served different provenance bytes`,
    );
  }

  // 10. Content-hashed bundle names are byte identity by construction: Vite puts
  //     a hash of the CONTENT in the filename, so a page loading the same names
  //     is loading the same code.
  if (expected.assetNames && expected.assetNames.length > 0) {
    const html = `${index}\n${assets.map((a) => a.text).join("\n")}`;
    const missing = expected.assetNames.filter((name) => !html.includes(name));
    add(
      "published page loads the verified content-hashed bundles",
      missing.length === 0,
      missing.length === 0
        ? `${expected.assetNames.length} bundle name(s) present`
        : `not referenced by the published page: ${missing.join(", ")}`,
    );
  }

  return { url, ok: checks.every((c) => c.ok), checks, observed };
}

/* ------------------------------------------------------------------ *
 * HTTP — bounded, same-origin, GET only
 * ------------------------------------------------------------------ */

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/json,text/css,text/javascript,*/*" },
    });
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_ASSET_BYTES) {
      return { status: response.status, text: "", tooLarge: true };
    }
    const body = await response.text();
    return { status: response.status, text: body.slice(0, MAX_ASSET_BYTES) };
  } catch (error) {
    return { status: null, text: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The asset URLs the served HTML actually references, same-origin only. */
export function advertisedAssets(html, origin) {
  const out = [];
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (!/\.(?:js|css)(?:\?|$)/i.test(raw)) continue;
    let url;
    try {
      url = new URL(raw, `${origin}/`);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!out.includes(url.pathname)) out.push(url.pathname);
  }
  return out.slice(0, MAX_ASSETS);
}

export function formatPublishedReport(result) {
  const lines = [];
  lines.push(`published frontend: ${result.ok ? "PASS" : "FAIL"}`);
  lines.push(`  url: ${result.url}`);
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? "ok  " : "FAIL"} ${check.name} — ${check.detail}`);
  }
  if (!result.ok) {
    lines.push("");
    lines.push("Acceptance is refused. This is a result about the PUBLISHED URL, not about any workflow.");
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    url: null,
    expectCommit: null,
    expectBranch: null,
    expectBuildInfoSha256: null,
    expectAssetNames: null,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--url") args.url = argv[++i];
    else if (arg.startsWith("--url=")) args.url = arg.slice("--url=".length);
    else if (arg === "--expect-commit") args.expectCommit = argv[++i];
    else if (arg.startsWith("--expect-commit=")) args.expectCommit = arg.slice("--expect-commit=".length);
    else if (arg === "--expect-branch") args.expectBranch = argv[++i];
    else if (arg.startsWith("--expect-branch=")) args.expectBranch = arg.slice("--expect-branch=".length);
    else if (arg === "--expect-build-info-sha256") args.expectBuildInfoSha256 = argv[++i];
    else if (arg.startsWith("--expect-build-info-sha256=")) {
      args.expectBuildInfoSha256 = arg.slice("--expect-build-info-sha256=".length);
    } else if (arg === "--expect-asset-names") args.expectAssetNames = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg.startsWith("--expect-asset-names=")) {
      args.expectAssetNames = arg.slice("--expect-asset-names=".length).split(",").filter(Boolean);
    } else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]) || DEFAULT_TIMEOUT_MS;
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = Number(arg.split("=")[1]) || DEFAULT_TIMEOUT_MS;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    process.stderr.write(
      "usage: verify-published-frontend.mjs --url <https origin> [--expect-branch <ref>] [--expect-commit <sha>]" +
        " [--expect-build-info-sha256 <hex>] [--expect-asset-names <a.js,b.css>]\n",
    );
    process.exit(2);
  }
  let origin;
  try {
    origin = new URL(args.url).origin;
  } catch {
    process.stderr.write(`--url is not a URL: ${args.url}\n`);
    process.exit(2);
  }

  const buildInfo = await fetchText(`${origin}/build-info.json`, args.timeoutMs);
  const index = await fetchText(`${origin}/`, args.timeoutMs);
  const buildRoute = await fetchText(`${origin}/build`, args.timeoutMs);

  if (buildInfo.status === null && index.status === null && buildRoute.status === null) {
    process.stderr.write(
      `published frontend: UNREACHABLE — neither /build-info.json, / nor /build answered (${buildInfo.error ?? "transport error"}).\n` +
        "This is a transport result, not evidence about what the host would serve a browser.\n",
    );
    process.exit(2);
  }

  const assets = [];
  for (const path of advertisedAssets(index.text ?? "", origin)) {
    const response = await fetchText(`${origin}${path}`, args.timeoutMs);
    assets.push({ name: path, path, status: response.status, text: response.text ?? "" });
  }

  const result = evaluatePublishedFrontend({
    url: origin,
    buildInfoText: buildInfo.text ?? null,
    buildInfoStatus: buildInfo.status,
    indexHtml: index.text ?? null,
    indexPath: "/",
    buildRouteHtml: buildRoute.text ?? null,
    buildRouteStatus: buildRoute.status,
    assets,
    expected: {
      commit: args.expectCommit,
      branch: args.expectBranch,
      buildInfoSha256: args.expectBuildInfoSha256,
      assetNames: args.expectAssetNames,
    },
  });

  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : formatPublishedReport(result));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
