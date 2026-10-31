import test from "node:test";
import assert from "node:assert/strict";
import { classifyGoogleAuthConfig } from "./verify-google-auth-config.mjs";

const configured = {
  AUTH_GOOGLE_ID: "123456789-example.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "gocspx-abcdefghijklmnop",
  CONVEX_SITE_URL: "https://hushed-seal-237.convex.site",
  SITE_URL: "https://xstarzanalysis.vercel.app",
  VITE_CONVEX_URL: "https://hushed-seal-237.convex.cloud",
};

test("reports missing auth variable names without values", () => {
  const result = classifyGoogleAuthConfig({});
  assert.equal(result.state, "NOT_CONFIGURED");
  assert.deepEqual(result.missing, [
    "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "CONVEX_SITE_URL", "SITE_URL", "VITE_CONVEX_URL",
  ]);
});

test("accepts structurally plausible OAuth configuration and derives callback", () => {
  const result = classifyGoogleAuthConfig(configured);
  assert.equal(result.state, "CONFIGURED");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.callbackUrl, "https://hushed-seal-237.convex.site/api/auth/callback/google");
  assert.equal(JSON.stringify(result).includes(configured.AUTH_GOOGLE_SECRET), false);
});

test("rejects invalid IDs, short secrets, non-HTTPS endpoints and mismatched hosts", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    AUTH_GOOGLE_ID: "not-a-google-client-id",
    AUTH_GOOGLE_SECRET: "short",
    CONVEX_SITE_URL: "http://hushed-seal-237.convex.site",
    VITE_CONVEX_URL: "https://other.convex.cloud",
  });
  assert.equal(result.state, "INVALID");
  assert.equal(result.invalid.length, 3);
  assert.equal(JSON.stringify(result).includes("not-a-google-client-id"), false);
  assert.equal(JSON.stringify(result).includes("short"), false);
});

test("rejects non-official frontend origins", () => {
  const result = classifyGoogleAuthConfig({ ...configured, SITE_URL: "https://preview.vercel.app" });
  assert.equal(result.state, "INVALID");
  assert.ok(result.invalid.some((entry) => entry.includes("official XSTARZG Analysis domain")));
});

test("keeps INVALID precedence when required fields are also missing", () => {
  const result = classifyGoogleAuthConfig({ ...configured, AUTH_GOOGLE_ID: "bad", AUTH_GOOGLE_SECRET: undefined });
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.missing, ["AUTH_GOOGLE_SECRET"]);
});
