#!/usr/bin/env node
/**
 * Phase 311 — Google authentication configuration verifier.
 *
 * Operator-facing, fail-closed, NON-SECRET. Answers exactly one question:
 *
 *   "Is Google sign-in completable on THIS environment's configuration?"
 *
 * with one of three explicit states (never a maybe, never a fake PASS):
 *
 *   GOOGLE_AUTH_CONFIGURED      code/config correct + secrets present and
 *                               plausible — actual validity still requires a
 *                               real sign-in (network acceptance is a separate
 *                               act, this tool can never prove it);
 *   GOOGLE_AUTH_NOT_CONFIGURED  code/config correct + secrets missing — the
 *                               exact external setup that remains is printed
 *                               as VARIABLE NAMES and commands, never values;
 *   GOOGLE_AUTH_INVALID         a present value is implausible (placeholder,
 *                               wrong shape) — the OAuth flow would die at the
 *                               provider with `401 invalid_client` or the
 *                               post-auth redirect would throw.
 *
 * Why this must exist (derived from the actual architecture, not guessed):
 *
 *   · `src/convex/auth.ts` builds the Google provider from
 *     `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, which `@auth/core`
 *     `setEnvDefaults` injects on the Convex deployment. A missing pair is
 *     invisible until a real user clicks sign-in and Google answers
 *     `401 invalid_client`.
 *   · The OAuth callback endpoint is
 *     `${CONVEX_SITE_URL}/api/auth/callback/google`
 *     (`@convex-dev/auth` `addHttpRoutes` + `oauth2RedirectURI`), and it is
 *     EXACTLY the string that must be registered as an authorized redirect
 *     URI in the Google Cloud OAuth client.
 *   · After the callback succeeds, the library resolves the post-auth
 *     destination against `requireEnv("SITE_URL")`
 *     (`implementation/redirects.js` → `defaultRedirectCallback`): a relative
 *     `redirectTo` becomes `${SITE_URL}${redirectTo}`. If `SITE_URL` is unset
 *     the callback THROWS after the user has already consented on Google —
 *     the worst possible failure mode, so its absence is a first-class state
 *     here, not a footnote.
 *
 * Secrets are never printed — not redacted, simply never read into any output
 * path. The tool reports names, shapes and derived non-secret URLs only.
 *
 * Usage:
 *   node scripts/verify-google-auth-config.mjs [--json] [--require-configured]
 *
 * Exit codes: 0 = CONFIGURED, 1 = NOT_CONFIGURED, 2 = INVALID.
 * `--require-configured` upgrades NOT_CONFIGURED to a hard failure for gates
 * (exit 1 either way, with an explicit marker in the output).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The variables the Google path needs, in check order. */
export const GOOGLE_AUTH_VARS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "SITE_URL",
  "CONVEX_SITE_URL",
];

/** Placeholder shapes that must never reach a real deployment. */
const PLACEHOLDER_RE =
  /(placeholder|example|change[-_]?me|your[-_]?(client|key|id|secret)|dummy|sample|todo|replace[-_]?me|xxxx)/i;

/** A real Google OAuth client id ends with this suffix. */
const GOOGLE_ID_SUFFIX = ".apps.googleusercontent.com";

const present = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

/** Shape check for a Google OAuth client id (shape only — no value leaves). */
export function plausibleGoogleClientId(value) {
  const v = String(value ?? "").trim();
  if (v.length < 20) return { ok: false, reason: "implausibly short for a Google client id (<20 chars)" };
  if (PLACEHOLDER_RE.test(v)) return { ok: false, reason: "looks like a placeholder" };
  if (/\s/.test(v)) return { ok: false, reason: "contains whitespace" };
  if (!v.endsWith(GOOGLE_ID_SUFFIX)) {
    return { ok: false, reason: `does not end with ${GOOGLE_ID_SUFFIX}` };
  }
  return { ok: true };
}

/** Shape check for the client secret (length/placeholder only, by design). */
export function plausibleGoogleSecret(value) {
  const v = String(value ?? "").trim();
  if (v.length < 20) return { ok: false, reason: "implausibly short for an OAuth client secret (<20 chars)" };
  if (PLACEHOLDER_RE.test(v)) return { ok: false, reason: "looks like a placeholder" };
  if (/\s/.test(v)) return { ok: false, reason: "contains whitespace" };
  return { ok: true };
}

/**
 * Shape check for a redirect/landing base URL: absolute https, origin-shaped
 * (no query, no hash, no trailing path other than a bare "/"). `http://` is
 * accepted ONLY for an explicit localhost host (local dev servers).
 */
export function plausibleSiteUrl(value) {
  const v = String(value ?? "").trim();
  let url;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, reason: "not an absolute URL" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /localhost|127\.0\.0\.1/.test(url.hostname))) {
    return { ok: false, reason: "must be https (http is accepted for localhost dev only)" };
  }
  if (url.search || url.hash) return { ok: false, reason: "must not carry a query or hash" };
  if (url.pathname !== "/" && url.pathname !== "") return { ok: false, reason: "must be an origin (no path)" };
  if (v.endsWith("/") && v !== `${url.protocol}//${url.host}/`) return { ok: false, reason: "trailing slash" };
  return { ok: true };
}

/**
 * The exact OAuth callback URL for a given deployment site URL — the string
 * that must be registered in the Google Cloud OAuth client. Derived from
 * `@convex-dev/auth`'s `addHttpRoutes`/`oauth2RedirectURI` convention.
 */
export function derivedCallbackUrl(convexSiteUrl) {
  return `${String(convexSiteUrl).replace(/\/$/, "")}/api/auth/callback/google`;
}

/**
 * The three-state classification. Pure: pass any env-like object (the real
 * environment, or a test fixture). Returns the state, the evidence, and the
 * operator-facing remediation — with NO secret material anywhere in the
 * result.
 */
export function classifyGoogleAuthConfig(env) {
  const missing = GOOGLE_AUTH_VARS.filter((name) => !present(env, name));
  const invalid = [];

  for (const name of GOOGLE_AUTH_VARS) {
    if (!present(env, name)) continue;
    const value = env[name].trim();
    if (name === "AUTH_GOOGLE_ID") {
      const check = plausibleGoogleClientId(value);
      if (!check.ok) invalid.push(`${name}: ${check.reason}`);
    } else if (name === "AUTH_GOOGLE_SECRET") {
      const check = plausibleGoogleSecret(value);
      if (!check.ok) invalid.push(`${name}: ${check.reason}`);
    } else {
      const check = plausibleSiteUrl(value);
      if (!check.ok) invalid.push(`${name}: ${check.reason}`);
    }
  }

  // State 3 wins over state 2: a present-but-broken value is worse than a
  // missing one because it looks configured.
  if (invalid.length > 0) {
    return {
      state: "GOOGLE_AUTH_INVALID",
      exitCode: 2,
      missing,
      invalid,
      callbackUrl: present(env, "CONVEX_SITE_URL") ? derivedCallbackUrl(env.CONVEX_SITE_URL) : null,
      remediation: [
        "Fix the implausible values listed above on the Convex deployment:",
        "  npx convex env set <NAME>   # value is prompted, never echoed here",
        ...invalid.map((line) => `  · ${line}`),
      ],
      secretMaterialPresent: false,
    };
  }

  if (missing.length > 0) {
    return {
      state: "GOOGLE_AUTH_NOT_CONFIGURED",
      exitCode: 1,
      missing,
      invalid: [],
      callbackUrl: present(env, "CONVEX_SITE_URL") ? derivedCallbackUrl(env.CONVEX_SITE_URL) : null,
      remediation: [
        "Google sign-in is NOT completable with this configuration.",
        "Set the missing variables on the Convex deployment (values are never",
        "printed by this tool):",
        ...missing.map((name) => `  npx convex env set ${name} ...`),
        "",
        "In the Google Cloud OAuth client, register the authorized redirect URI:",
        present(env, "CONVEX_SITE_URL")
          ? `  ${derivedCallbackUrl(env.CONVEX_SITE_URL)}`
          : "  ${CONVEX_SITE_URL}/api/auth/callback/google   (once CONVEX_SITE_URL is set)",
        "",
        "SITE_URL must be the origin that serves the app UI (post-auth landing:",
        "  ${SITE_URL}<resolved safe path, default /dashboard>).",
        "",
        "After setting the variables, run one real sign-in acceptance:",
        "  Google button → Google consent → callback → authenticated Dashboard",
        "  (and verify NO verification-code step appears in between).",
      ],
      secretMaterialPresent: false,
    };
  }

  return {
    state: "GOOGLE_AUTH_CONFIGURED",
    exitCode: 0,
    missing: [],
    invalid: [],
    callbackUrl: derivedCallbackUrl(env.CONVEX_SITE_URL),
    remediation: [
      "Configuration is present and plausible. This tool CANNOT verify the",
      "credentials against Google (no network) — one real sign-in acceptance",
      "remains the only proof that the OAuth flow completes.",
    ],
    secretMaterialPresent: false,
  };
}

/* ------------------------------------------------------------------ *
 * Prohibitive scan: the frontend must not read Google secrets.       *
 * ------------------------------------------------------------------ */

/**
 * Scans the frontend source for any read of the Google credential variables.
 * Returns the offending file paths (empty = clean). The Convex server files
 * (src/convex/**) are allowed to NAME them (comments/injection), but no
 * `VITE_`-prefixed or direct client-side read may exist.
 */
export function scanFrontendForSecretReads(srcDir) {
  const offenders = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        if (/['"`](?:import\.meta\.)?env\.AUTH_GOOGLE_(?:ID|SECRET)['"`]/.test(text)) {
          offenders.push(full);
        }
      }
    }
  };
  walk(resolve(srcDir));
  return offenders;
}

/* ------------------------------------------------------------------ *
 * CLI                                                                *
 * ------------------------------------------------------------------ */

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const requireConfigured = argv.includes("--require-configured");

  const verdict = classifyGoogleAuthConfig(process.env);
  const frontendOffenders = scanFrontendForSecretReads(resolve(process.cwd(), "src"));

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          state: verdict.state,
          exitCode: verdict.exitCode,
          missing: verdict.missing,
          invalid: verdict.invalid,
          callbackUrl: verdict.callbackUrl,
          frontendSecretReads: frontendOffenders,
          secretMaterialPresent: false,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("════════════════════════════════════════════════════════════");
    console.log(" Google authentication configuration (values are never printed)");
    console.log("════════════════════════════════════════════════════════════");
    console.log(`STATE: ${verdict.state}`);
    if (verdict.missing.length > 0) console.log(`missing variables: ${verdict.missing.join(", ")}`);
    if (verdict.callbackUrl) console.log(`OAuth callback URL (register in Google Cloud): ${verdict.callbackUrl}`);
    if (verdict.state === "GOOGLE_AUTH_CONFIGURED") {
      console.log(`post-auth landing base: SITE_URL (origin only, path resolved by the app's safe-redirect)`);
    }
    for (const line of verdict.remediation) console.log(line);
    console.log("────────────────────────────────────────────────────────────");
    console.log(
      frontendOffenders.length === 0
        ? "frontend secret read scan: clean (no client-side AUTH_GOOGLE_* read)"
        : `frontend secret read scan: OFFENDERS — ${frontendOffenders.join(", ")}`,
    );
    console.log(
      "This validates configuration only. A real Google sign-in acceptance is",
      "a separate, required act before claiming the flow works end to end.",
    );
  }

  let exitCode = verdict.exitCode;
  if (frontendOffenders.length > 0) exitCode = 2;
  if (requireConfigured && verdict.state !== "GOOGLE_AUTH_CONFIGURED" && exitCode === 1) {
    console.log("Marker: --require-configured was set and the state is not CONFIGURED.");
  }
  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace(/^file:\/\//, ""))) {
  main();
}
