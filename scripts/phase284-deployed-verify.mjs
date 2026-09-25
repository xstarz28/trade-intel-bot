#!/usr/bin/env node
/**
 * Phase 284 — TEMPORARY deployed-environment verification (verification-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Phase 284 mission asks for the four-asset live path to be proven through
 * the REAL deployed Convex environment, because the agent sandbox cannot reach
 * provider hosts or *.convex.cloud at all. This script is the smallest
 * mechanism that can answer that question from a host with normal egress
 * (a GitHub Actions runner), and it is removed again after the run.
 *
 * WHAT IT IS NOT
 * --------------
 * - It does NOT deploy. No `convex deploy`, no schema push, no function upload.
 * - It does NOT create an alternate analysis path. It calls the EXISTING
 *   production action `protectedAnalysis:runProtectedAnalysis` over the
 *   deployment's own `/api/action` endpoint, exactly as the browser client
 *   does, with the app's own anonymous provider (`auth:signIn {provider}`).
 * - It does NOT mock, stub, or fixture anything. Every status printed below
 *   comes from an HTTP response received during this process.
 * - It does NOT print a credential VALUE. Configuration is reported by NAME
 *   and PRESENT/MISSING only; the deployment URL is a public client value that
 *   ships in the browser bundle.
 * - ERROR TEXT FROM THE SERVER IS INCLUDED VERBATIM. Those strings are the
 *   product's own messages; they name environment variables and never contain
 *   key material (`src/convex/marketData.ts` reports "TWELVE_DATA_API_KEY is
 *   missing", never a value).
 *
 * MODES
 * -----
 *   node scripts/phase284-deployed-verify.mjs --presence
 *      Prints NAME PRESENT|MISSING for every provider credential the production
 *      server code reads, plus the Convex deployment configuration names.
 *
 *   node scripts/phase284-deployed-verify.mjs --four-asset
 *      Runs BTC-USDT / EUR-USDT(fx) / AAPL / WTI-USD through the deployed
 *      production action and prints one safe-metadata JSON line per asset,
 *      followed by a `::notice::` annotation so the result is readable over
 *      the GitHub API.
 *
 * Exit codes: 0 = mechanism ran (whatever it observed), 2 = could not execute.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

/* ------------------------------------------------------------------ *
 * Configuration presence — NAMES ONLY, never values
 * ------------------------------------------------------------------ */

/** Provider credentials the production server reads (src/convex/*.ts). */
const PROVIDER_ENV_NAMES = [
  "TWELVE_DATA_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "COINGLASS_API_KEY",
  "TICKATLAS_API_KEY",
  "EIA_API_KEY",
];

/** Deployment configuration names (values are public client configuration). */
const DEPLOYMENT_ENV_NAMES = [
  "CONVEX_DEPLOYMENT",
  "VITE_CONVEX_URL",
  "CONVEX_SITE_URL",
  "CONVEX_DEPLOY_KEY",
  "XSTARZ_DEPLOYMENT_ENV",
];

function presenceReport() {
  const rows = [];
  const lines = [];
  for (const name of [...DEPLOYMENT_ENV_NAMES, ...PROVIDER_ENV_NAMES]) {
    const value = process.env[name];
    const present = typeof value === "string" && value.trim().length > 0;
    rows.push({ name, present });
    // Only the deployment URL and the environment label are printed in full:
    // both are public client values. Every credential prints as PRESENT/MISSING.
    const printable =
      present && (name === "VITE_CONVEX_URL" || name === "CONVEX_SITE_URL" || name === "XSTARZ_DEPLOYMENT_ENV")
        ? ` (${value.trim()})`
        : "";
    const line = `${name.padEnd(24)} ${present ? "PRESENT" : "MISSING"}${printable}`;
    console.log(`[284] ${line}`);
    lines.push(line);
  }

  // The deployment's OWN environment: readable only through the CLI with a
  // deploy key. Names are extracted before anything is printed, so a value can
  // never reach the log.
  const envsFile = process.env.PHASE284_DEPLOYMENT_ENV_NAMES_FILE;
  if (envsFile && existsSync(envsFile)) {
    const names = readFileSync(envsFile, "utf8")
      .split("\n")
      .map((line) => line.split("=")[0].trim())
      .filter((n) => n.length > 0 && /^[A-Z0-9_]+$/.test(n))
      .sort();
    const line = `deployment env var names (${names.length}): ${names.join(", ") || "(none)"}`;
    console.log(`[284] ${line}`);
    lines.push(line);
  } else {
    const line = "deployment env var names: NOT READABLE (no deploy key / no CLI access)";
    console.log(`[284] ${line}`);
    lines.push(line);
  }
  annotate("Phase 284 configuration presence", lines.join("\n"));
  return rows;
}

/* ------------------------------------------------------------------ *
 * Convex HTTP client — the browser's own contract
 * ------------------------------------------------------------------ */

/**
 * The deployment to verify, and WHERE its identity came from.
 *
 * `PHASE284_FALLBACK_DEPLOYMENT` is only ever the deployment this repository's
 * own records name as the project's development deployment
 * (`docs/UAT-MATRIX.md` §35j / Phase 212 run sheet). It is used only when no
 * deployment is configured in the workflow environment, and the report always
 * states which of the two it used.
 */
function resolveDeploymentSource() {
  for (const [source, value] of [
    ["PHASE284_DEPLOYMENT_URL", process.env.PHASE284_DEPLOYMENT_URL],
    ["VITE_CONVEX_URL", process.env.VITE_CONVEX_URL],
    ["PHASE284_FALLBACK_DEPLOYMENT (documented dev deployment)", process.env.PHASE284_FALLBACK_DEPLOYMENT],
  ]) {
    const candidate = (value ?? "").trim();
    if (candidate.length > 0) return { source, candidate };
  }
  return null;
}

function resolveDeploymentUrl() {
  const resolved = resolveDeploymentSource();
  if (!resolved) return null;
  const candidate = resolved.candidate;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  // A localhost, mock or non-Convex target is refused outright: a "pass" there
  // would be evidence about nothing.
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".convex.cloud")) return null;
  return parsed;
}

const TIMEOUT_MS = 90_000;
const transport = { calls: 0 };

async function callConvex(kind, path, fnArgs, token = null) {
  const deployment = resolveDeploymentUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${deployment.origin}/api/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path, args: fnArgs ?? {}, format: "json" }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    transport.calls += 1;
    const appError = body?.status === "error" ? (body.errorMessage ?? "error") : null;
    return {
      ok: response.ok && !appError,
      httpStatus: response.status,
      appError,
      value: body?.value,
      rawBody: body?.value === undefined ? text.slice(0, 200) : null,
      transportError: null,
    };
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? "unknown";
    return { ok: false, httpStatus: 0, appError: null, value: undefined, transportError: code };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Classification — the mission's taxonomy, decided from observed facts
 * ------------------------------------------------------------------ */

const CLASSIFICATIONS = [
  "SUCCESS",
  "PROVIDER_AUTH_FAILURE",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "CREDENTIAL_REQUIRED",
  "STALE",
  "DATA_QUALITY_FAILURE",
  "LOCKED_ENTITLEMENT",
  "NOT_EXECUTED",
];

function classify(text, { live, freshness }) {
  const s = String(text ?? "");
  if (/not configured|is missing|_API_KEY/i.test(s) && !/rejected|unauthor|invalid/i.test(s)) {
    return "CREDENTIAL_REQUIRED";
  }
  if (/unauthor|forbidden|\b401\b|\b403\b|invalid api key|key rejected|AUTH_ERROR/i.test(s)) {
    return "PROVIDER_AUTH_FAILURE";
  }
  if (/\b429\b|rate limit|too many requests|RATE_LIMIT/i.test(s)) return "RATE_LIMITED";
  if (/fetch failed|network|timeout|abort|ENOTFOUND|EAI_AGAIN|ECONN|socket/i.test(s)) return "PROVIDER_UNAVAILABLE";
  if (live && freshness === "stale") return "STALE";
  if (live) return "SUCCESS";
  if (s.length > 0) return "DATA_QUALITY_FAILURE";
  return "NOT_EXECUTED";
}

/* ------------------------------------------------------------------ *
 * Safe metadata extraction from the delivered analysis result
 * ------------------------------------------------------------------ */

const deep = (obj, path) => path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

function summarize(asset, instrumentType, instrument, provider, providerInstrumentId, response) {
  const value = response.value;
  const rawBody = response.rawBody ? sanitize(String(response.rawBody)).slice(0, 200) : null;
  const result = deep(value, "result") ?? {};
  const unified = deep(result, "unifiedIntelligence") ?? null;
  const fa = deep(result, "fundamentalAssessment") ?? null;
  const price = deep(result, "priceSnapshot") ?? null;

  const failureText = [
    response.appError,
    response.transportError ? `transport: ${response.transportError}` : null,
    deep(result, "dataFlags")?.join?.(" "),
    deep(result, "noTradeReasons")?.join?.(" "),
    deep(fa, "limitations")?.join?.(" "),
  ]
    .filter((v) => typeof v === "string" && v.length > 0)
    .join(" | ")
    .slice(0, 600);

  const live = Boolean(price);
  const freshness = price?.dataFreshness ?? null;
  const entitlementStatus = deep(value, "status");

  const classification =
    entitlementStatus === "LOCKED"
      ? "LOCKED_ENTITLEMENT"
      : !response.ok && !failureText
        ? "PROVIDER_UNAVAILABLE"
        : classify(failureText, { live, freshness });

  return {
    asset,
    instrument,
    requestedProvider: provider,
    providerNativeId: providerInstrumentId,
    providerInstrumentId: result.providerInstrumentId ?? providerInstrumentId,
    request: {
      success: response.ok,
      httpStatus: response.httpStatus,
      appStatus: entitlementStatus ?? null,
      error: failureText || null,
      rawBody,
    },
    providerObservationTimestamp: price?.timestamp ?? null,
    marketDataFreshness: freshness,
    liveMarketData: live,
    recommendation: result.recommendation ?? null,
    dataCompleteness: result.dataCompleteness ?? null,
    technicalState: unified?.technical
      ? `${unified.technical.bias ?? "?"} (${unified.technical.confidence ?? "?"})`
      : null,
    fundamental: fa
      ? {
          available: fa.available === true,
          domain: fa.domain ?? null,
          provider: fa.provider ?? null,
          instrumentId: fa.instrumentId ?? providerInstrumentId,
          state: fa.state ?? null,
          confidence: fa.confidence ?? null,
          reportingPeriod: fa.reportingPeriod ?? null,
          observedAt: fa.observedAt ?? null,
          dimensions: (fa.dimensions ?? []).map((d) => `${d.name}:${d.status}`),
        }
      : null,
    unifiedState: unified?.state ?? null,
    agreement: unified?.confluence?.agreement ?? null,
    actionability: unified
      ? `${unified.actionable ? "actionable" : "not-actionable"}: ${unified.actionabilityReason ?? ""}`.slice(0, 300)
      : null,
    entitlement: deep(value, "entitlement") ?? null,
    // The radar is computed client-side from this delivered snapshot; the
    // server action does not return a radar verdict, so none is invented here.
    radarState: unified
      ? `not-returned-by-server-action (client scanRadar consumes unified=${unified.state})`
      : null,
    classification,
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

/** Nothing that looks like key material may ever reach a log or annotation. */
function sanitize(text) {
  return String(text ?? "").replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>");
}

/**
 * `npx convex run --prod` — the repository's own CLI path into the deployment.
 * The identity is injected by the CLI's admin flag because this deployment
 * disables the guest provider (its anonymous sign-in answers Server Error);
 * the provider path under test is the shipped one either way.
 */
function convexRun(functionName, fnArgs, identity, useProd = true) {
  const cli = ["--yes", "convex@1.42.1", "run", ...(useProd ? ["--prod"] : []), functionName, JSON.stringify(fnArgs)];
  if (identity) cli.push("--identity", JSON.stringify(identity));
  const result = spawnSync("npx", cli, {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  let value;
  if (first >= 0 && last > first) {
    try {
      value = JSON.parse(stdout.slice(first, last + 1));
    } catch {
      value = undefined;
    }
  }
  const appError = value?.status === "error" ? (value.errorMessage ?? "error") : null;
  return {
    ok: result.status === 0 && !appError && value !== undefined,
    exitCode: result.status,
    appError,
    value,
    raw: sanitize(stdout.slice(0, 300)),
    stderr: sanitize((result.stderr ?? "").slice(0, 800)),
  };
}

const ASSETS = [
  { asset: "crypto", instrument: "BTC-USDT", instrumentType: "crypto", timeframe: "M15", tradingStyle: "swing", provider: "okx", providerInstrumentId: "BTC-USDT" },
  { asset: "forex", instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4", tradingStyle: "swing", provider: "twelve-data", providerInstrumentId: "EUR/USD" },
  { asset: "stock", instrument: "AAPL", instrumentType: "stock", timeframe: "H4", tradingStyle: "swing", provider: "twelve-data", providerInstrumentId: "AAPL" },
  { asset: "commodity", instrument: "WTI/USD", instrumentType: "commodity", timeframe: "H4", tradingStyle: "swing", provider: "twelve-data", providerInstrumentId: "WTI/USD" },
];

function annotate(title, body) {
  // A GitHub annotation is the one channel the agent sandbox can read back
  // (results-receiver log download is blocked; the Checks API is not).
  // Annotation messages are SINGLE-LINE: a raw newline terminates the workflow
  // command, which silently truncates the report. `%0A`/`%25`/`%0D` are the
  // documented escapes and render as real line breaks in the Checks API.
  const escaped = body
    .slice(0, 55000)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.log(`::notice title=${title}::${escaped}`);
}

async function runFourAsset(label = "Phase 284 deployed verification") {
  const deployment = resolveDeploymentUrl();
  const source = resolveDeploymentSource()?.source ?? null;
  if (!deployment) {
    const blocker =
      "NOT_EXECUTED — no deployment URL is configured (VITE_CONVEX_URL / PHASE284_DEPLOYMENT_URL absent or not an https *.convex.cloud origin).";
    console.log(`[284] ${blocker}`);
    annotate(label, blocker);
    return 0;
  }
  console.log(`[284] deployment ${deployment.origin} (from ${source})`);

  // A deployment answers `GET /version` with its own identity document; a dead
  // or replaced deployment does not. This separates "no such deployment" from
  // "deployment exists but the action failed".
  let versionInfo = "unreachable";
  try {
    const versionRes = await fetch(`${deployment.origin}/version`, { signal: AbortSignal.timeout(20_000) });
    const text = (await versionRes.text()).slice(0, 200);
    versionInfo = `HTTP ${versionRes.status} ${sanitize(text).replace(/\n+/g, " ")}`;
  } catch (error) {
    versionInfo = `transport: ${error?.cause?.code ?? error?.name ?? "unknown"}`;
  }
  console.log(`[284] version probe: ${versionInfo}`);

  const signIn = await callConvex("action", "auth:signIn", { provider: "anonymous" });
  if (!signIn.ok) {
    const blocker = `NOT_EXECUTED — anonymous sign-in refused: ${signIn.appError ?? signIn.transportError ?? `HTTP ${signIn.httpStatus}`}`;
    console.log(`[284] ${blocker}`);
    annotate(label, `${deployment.origin} (from ${source})\n${blocker}`);
    return 0;
  }
  const token = deep(signIn.value, "token") ?? signIn.value?.token ?? null;
  console.log(`[284] anonymous session ${token ? "established" : "returned no token"}`);

  const records = [];
  for (const spec of ASSETS) {
    const response = await callConvex(
      "action",
      "protectedAnalysis:runProtectedAnalysis",
      {
        input: {
          instrument: spec.instrument,
          instrumentType: spec.instrumentType,
          timeframe: spec.timeframe,
          tradingStyle: spec.tradingStyle,
          provider: spec.provider,
          providerInstrumentId: spec.providerInstrumentId,
        },
      },
      token,
    );
    const record = summarize(spec.asset, spec.instrumentType, spec.instrument, spec.provider, spec.providerInstrumentId, response);
    records.push(record);
    console.log(`[284] ${JSON.stringify(record)}`);
  }

  const header =
    "ASSET | PROVIDER | DEPLOYED ENV | REAL MARKET DATA | FUNDAMENTAL | UNIFIED | RADAR | RESULT";
  const table = records.map((r) =>
    [
      `${r.asset} ${r.instrument}`,
      r.requestedProvider,
      `obs=${r.providerObservationTimestamp ?? "none"} fresh=${r.marketDataFreshness ?? "none"}`,
      r.liveMarketData ? `yes (${r.dataCompleteness ?? "?"})` : "no",
      r.fundamental ? `${r.fundamental.provider ?? "?"}/${r.fundamental.state ?? "?"}${r.fundamental.reportingPeriod ? ` period ${r.fundamental.reportingPeriod}` : ""}` : "none",
      r.unifiedState ?? "none",
      r.radarState ?? "none",
      r.classification,
    ].join(" | "),
  );
  const report = [header, ...table].join("\n");
  console.log(report);
  annotate(
    label,
    [`${deployment.origin} (from ${source})`, `version probe: ${versionInfo}`, report, ...records.map((r) => JSON.stringify(r))].join("\n"),
  );
  return 0;
}

/* ------------------------------------------------------------------ *
 * Mode: the deployment's OWN runtime, via the repository's CLI path
 * ------------------------------------------------------------------ */

function annotateJson(title, lines) {
  annotate(title, lines.join("\n"));
}

async function runConvexRunMode() {
  const lines = [];
  const deployment = (process.env.CONVEX_DEPLOYMENT ?? "").trim();
  const site = (process.env.CONVEX_SITE_URL ?? "").trim();
  lines.push(`CONVEX_DEPLOYMENT=${deployment || "(missing)"}`);
  lines.push(`VITE_CONVEX_URL=${(process.env.VITE_CONVEX_URL ?? "(missing)").trim()}`);
  lines.push(`CONVEX_SITE_URL=${site || "(missing in workflow env)"}`);

  // ── Deployment environment variable NAMES (never values) ──────────
  const runEnvList = (flags) =>
    spawnSync("npx", ["--yes", "convex@1.42.1", "env", "list", ...flags, "--names-only"], {
      encoding: "utf8",
      timeout: 120_000,
      env: process.env,
    });
  let envList = runEnvList(["--prod"]);
  if (envList.status !== 0) {
    const retry = runEnvList([]);
    lines.push(
      `env list --prod failed (exit=${String(envList.status)}); retried without --prod: exit=${String(retry.status)}`,
    );
    envList = retry;
  }
  const names = (envList.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Z0-9_]+$/.test(l))
    .sort();
  lines.push(
    `convex env list --names-only: exit=${String(envList.status)} names=${names.length}` +
      (envList.status === 0 ? "" : ` stderr=${sanitize((envList.stderr ?? "").replace(/\n+/g, " ¶ ")).slice(0, 800)}`),
  );
  if (names.length > 0) lines.push(`deployment env var names: ${names.join(", ")}`);
  console.log(`[284] ${lines.join("\n[284] ")}`);

  const identity = {
    subject: `phase284-verification-${Date.now()}`,
    issuer: site || "https://pleasant-curlew-264.convex.site",
    name: "Phase 284 verification",
  };

  // ── Is the deployment itself healthy, or is the analysis action the thrower?
  // A trivial authenticated read separates the two possibilities.
  const health = convexRun("entitlements:getMyEntitlement", {}, identity);
  lines.push(
    `health check entitlements:getMyEntitlement: exit=${String(health.exitCode)} ok=${String(health.ok)}` +
      (health.ok ? ` value=${sanitize(JSON.stringify(health.value)).slice(0, 240)}` : ` stderr=${sanitize((health.stderr ?? "").replace(/\n+/g, " ¶ ")).slice(0, 300)}`),
  );

  // ── Does the deployment answer ANY call? (identity-injected and not) ──
  const liveness = convexRun("auth:isAuthenticated", {}, null);
  lines.push(
    `liveness auth:isAuthenticated (no identity): exit=${String(liveness.exitCode)} ok=${String(liveness.ok)}` +
      (liveness.ok ? ` value=${sanitize(JSON.stringify(liveness.value)).slice(0, 120)}` : ` stderr=${sanitize((liveness.stderr ?? "").replace(/\n+/g, " ¶ ")).slice(0, 300)}`),
  );
  const guest = convexRun("entitlements:getMyEntitlement", {}, null);
  lines.push(
    `guest entitlements:getMyEntitlement (no identity): exit=${String(guest.exitCode)} ok=${String(guest.ok)}` +
      (guest.ok ? ` value=${sanitize(JSON.stringify(guest.value)).slice(0, 200)}` : ` stderr=${sanitize((guest.stderr ?? "").replace(/\n+/g, " ¶ ")).slice(0, 300)}`),
  );

  // ── The guard the product guarantees: no identity, no analysis ────
  const unauth = convexRun("protectedAnalysis:runProtectedAnalysis", {
    input: {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      tradingStyle: "swing",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    },
  }, null);
  const unauthStatus = unauth.value?.status ?? (unauth.appError ? "error" : unauth.stderr ? "cli-error" : "unknown");
  lines.push(
    `unauthenticated probe (analysis, no identity): status=${unauthStatus}` +
      ` stderr=${sanitize((unauth.stderr ?? "").replace(/\n+/g, " ¶ ")).slice(0, 300)}`,
  );

  // ── The four assets, through the deployed production action ───────
  for (const spec of ASSETS) {
    const call = convexRun(
      "protectedAnalysis:runProtectedAnalysis",
      {
        input: {
          instrument: spec.instrument,
          instrumentType: spec.instrumentType,
          timeframe: spec.timeframe,
          tradingStyle: spec.tradingStyle,
          provider: spec.provider,
          providerInstrumentId: spec.providerInstrumentId,
        },
      },
      identity,
    );
    let attempt = call;
    if (!attempt.ok && attempt.value === undefined) {
      const retry = convexRun(
        "protectedAnalysis:runProtectedAnalysis",
        {
          input: {
            instrument: spec.instrument,
            instrumentType: spec.instrumentType,
            timeframe: spec.timeframe,
            tradingStyle: spec.tradingStyle,
            provider: spec.provider,
            providerInstrumentId: spec.providerInstrumentId,
          },
        },
        identity,
        false,
      );
      if (retry.ok || retry.value !== undefined) attempt = retry;
      else
        lines.push(
          `${spec.asset} ${spec.instrument}: CLI BOTH FORMS FAILED exit=${String(attempt.exitCode)}/${String(retry.exitCode)} stderr=${sanitize((retry.stderr ?? "").replace(/\n+/g, " ¶ "))}`,
        );
    }
    if (!attempt.ok && attempt.value === undefined) continue;
    const record = summarize(
      spec.asset,
      spec.instrumentType,
      spec.instrument,
      spec.provider,
      spec.providerInstrumentId,
      { ok: attempt.ok, httpStatus: 200, appError: attempt.appError, value: attempt.value, transportError: null },
    );
    lines.push(`${spec.asset} ${spec.instrument}: ${JSON.stringify(record)}`);
  }

  const table = lines.filter((l) => l.includes(": {"));
  const headerLine = "ASSET | PROVIDER | DEPLOYED ENV | REAL MARKET DATA | FUNDAMENTAL | UNIFIED | RADAR | RESULT";
  const rows = table.map((l) => {
    const rec = JSON.parse(l.slice(l.indexOf(": {") + 2));
    return [
      `${rec.asset} ${rec.instrument}`,
      rec.requestedProvider,
      `obs=${rec.providerObservationTimestamp ?? "none"} fresh=${rec.marketDataFreshness ?? "none"}`,
      rec.liveMarketData ? `yes (${rec.dataCompleteness ?? "?"})` : "no",
      rec.fundamental ? `${rec.fundamental.provider ?? "?"}/${rec.fundamental.state ?? "?"}${rec.fundamental.reportingPeriod ? ` period ${rec.fundamental.reportingPeriod}` : ""}` : "none",
      rec.unifiedState ?? "none",
      rec.radarState ?? "none",
      rec.classification,
    ].join(" | ");
  });
  lines.push("", headerLine, ...rows);
  console.log(`[284] ${lines.slice(-(rows.length + 2)).join("\n[284] ")}`);
  annotateJson("Phase 284 deployed runtime (convex run)", lines.flatMap((l) => l.split("\n")));
  return 0;
}

if (has("--presence")) {
  presenceReport();
  process.exit(0);
}
if (has("--convex-run")) {
  process.exit(await runConvexRunMode());
}
if (has("--four-asset")) {
  process.exit(await runFourAsset());
}
if (has("--four-asset-dev")) {
  process.env.PHASE284_DEPLOYMENT_URL = process.env.PHASE284_FALLBACK_DEPLOYMENT ?? "";
  process.exit(await runFourAsset("Phase 284 dev deployment (app-issued session)"));
}
console.log("usage: phase284-deployed-verify.mjs --presence | --four-asset");
process.exit(2);
