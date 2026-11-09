#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const REQUIRED_NAMES = ["APP_ORIGIN", "PUBLIC_BASE_URL", "DOMAIN"];
const OAUTH_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

function httpsOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Validates the self-hosted Google OAuth environment without ever returning
 * credential values. This checks configuration shape, not a live OAuth login.
 */
export function classifyGoogleAuthConfig(env = process.env) {
  const missing = [];
  const invalid = [];

  for (const name of REQUIRED_NAMES) {
    if (typeof env[name] !== "string" || env[name].trim().length === 0) missing.push(name);
  }
  const oauthPresent = OAUTH_NAMES.map((name) =>
    typeof env[name] === "string" && env[name].trim().length > 0
  );
  const oauthConfigured = oauthPresent.every(Boolean);
  const oauthAbsent = oauthPresent.every((present) => !present);
  if (!oauthConfigured && !oauthAbsent) {
    for (const [index, present] of oauthPresent.entries()) {
      if (!present) missing.push(OAUTH_NAMES[index]);
    }
  }

  const googleId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  if (googleId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleId)) {
    invalid.push("GOOGLE_CLIENT_ID must be a Google OAuth client ID");
  }

  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (googleSecret && (googleSecret.length < 16 || /\s/.test(googleSecret))) {
    invalid.push("GOOGLE_CLIENT_SECRET must be a non-empty secret without whitespace");
  }

  const appOrigin = httpsOrigin(env.APP_ORIGIN);
  if (env.APP_ORIGIN?.trim() && !appOrigin) {
    invalid.push("APP_ORIGIN must be an HTTPS origin");
  }

  const backendOrigin = httpsOrigin(env.PUBLIC_BASE_URL);
  if (env.PUBLIC_BASE_URL?.trim() && !backendOrigin) {
    invalid.push("PUBLIC_BASE_URL must be an HTTPS origin");
  }

  if (appOrigin && backendOrigin && appOrigin.origin !== backendOrigin.origin) {
    invalid.push("APP_ORIGIN and PUBLIC_BASE_URL must match for the same-origin session cookie deployment");
  }

  const domain = env.DOMAIN?.trim().toLowerCase() ?? "";
  if (domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    invalid.push("DOMAIN must be a hostname without scheme, path, port, or credentials");
  }
  if (domain && appOrigin && domain !== appOrigin.hostname.toLowerCase()) {
    invalid.push("DOMAIN must match APP_ORIGIN hostname so Caddy TLS and application cookies use the same canonical host");
  }

  const callbackUrl = backendOrigin
    ? new URL("/api/v1/auth/google/callback", backendOrigin).toString()
    : null;
  const state = invalid.length > 0
    ? "INVALID"
    : missing.length > 0
      ? "NOT_CONFIGURED"
      : oauthAbsent
        ? "ANONYMOUS_ONLY"
        : "CONFIGURED";
  return { state, missing, invalid, callbackUrl, googleSignInEnabled: oauthConfigured };
}

function main() {
  const result = classifyGoogleAuthConfig(process.env);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`Self-hosted authentication configuration: ${result.state}\n`);
    process.stdout.write(`Google sign-in enabled: ${result.googleSignInEnabled ? "yes" : "no (anonymous access remains available)"}\n`);
    if (result.missing.length) process.stdout.write(`Missing variables: ${result.missing.join(", ")}\n`);
    if (result.invalid.length) process.stdout.write(`Invalid configuration: ${result.invalid.join("; ")}\n`);
    if (result.callbackUrl) process.stdout.write(`Expected Google callback URL: ${result.callbackUrl}\n`);
    process.stdout.write("Configuration shape only; this does not prove browser sign-in.\n");
  }
  if (result.state === "NOT_CONFIGURED") process.exitCode = 1;
  if (result.state === "INVALID") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
