#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const REQUIRED_NAMES = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "CONVEX_SITE_URL",
  "SITE_URL",
  "VITE_CONVEX_URL",
];

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

/** Reports only names/status. CONFIGURED is structural validation, not sign-in proof. */
export function classifyGoogleAuthConfig(env = process.env) {
  const missing = [];
  const invalid = [];

  for (const name of REQUIRED_NAMES) {
    if (typeof env[name] !== "string" || env[name].trim().length === 0) missing.push(name);
  }

  const googleId = env.AUTH_GOOGLE_ID?.trim() ?? "";
  if (googleId && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleId)) {
    invalid.push("AUTH_GOOGLE_ID must be a Google OAuth client ID");
  }

  const googleSecret = env.AUTH_GOOGLE_SECRET?.trim() ?? "";
  if (googleSecret && (googleSecret.length < 16 || /\s/.test(googleSecret))) {
    invalid.push("AUTH_GOOGLE_SECRET must be a non-empty secret without whitespace");
  }

  const convexSite = httpsOrigin(env.CONVEX_SITE_URL);
  if (env.CONVEX_SITE_URL?.trim() && (!convexSite || !convexSite.hostname.endsWith(".convex.site"))) {
    invalid.push("CONVEX_SITE_URL must be an HTTPS origin on *.convex.site");
  }

  const convexCloud = httpsOrigin(env.VITE_CONVEX_URL);
  if (env.VITE_CONVEX_URL?.trim() && (!convexCloud || !convexCloud.hostname.endsWith(".convex.cloud"))) {
    invalid.push("VITE_CONVEX_URL must be an HTTPS origin on *.convex.cloud");
  }
  if (convexSite && convexCloud) {
    const expectedSiteHost = convexCloud.hostname.replace(/\.convex\.cloud$/i, ".convex.site");
    if (convexSite.hostname !== expectedSiteHost) {
      invalid.push("CONVEX_SITE_URL and VITE_CONVEX_URL must identify the same deployment");
    }
  }

  const siteUrl = httpsOrigin(env.SITE_URL);
  if (env.SITE_URL?.trim() && !siteUrl) {
    invalid.push("SITE_URL must be an HTTPS origin");
  } else if (siteUrl && siteUrl.hostname !== "xstarzanalysis.vercel.app") {
    invalid.push("SITE_URL must use the official XSTARZG Analysis domain");
  }

  const callbackUrl = convexSite
    ? new URL("/api/auth/callback/google", convexSite).toString()
    : null;
  const state = invalid.length > 0 ? "INVALID" : missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED";
  return { state, missing, invalid, callbackUrl };
}

function main() {
  const result = classifyGoogleAuthConfig(process.env);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`Google OAuth configuration: ${result.state}\n`);
    if (result.missing.length) process.stdout.write(`Missing variables: ${result.missing.join(", ")}\n`);
    if (result.invalid.length) process.stdout.write(`Invalid configuration: ${result.invalid.join("; ")}\n`);
    if (result.callbackUrl) process.stdout.write(`Expected Google callback URL: ${result.callbackUrl}\n`);
    process.stdout.write("Configuration shape only; this does not prove browser sign-in.\n");
  }
  if (result.state === "NOT_CONFIGURED") process.exitCode = 1;
  if (result.state === "INVALID") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
