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

test("reports missing auth variables by name only", () => {
  const result = classifyGoogleAuthConfig({});
  assert.equal(result.state, "NOT_CONFIGURED");
  assert.deepEqual(result.missing, [
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "CONVEX_SITE_URL",
    "SITE_URL",
    "VITE_CONVEX_URL",
  ]);
  assert.equal(JSON.stringify(result).includes("gocspx"), false);
});

test("accepts plausible OAuth config and derives the callback URL", () => {
  const result = classifyGoogleAuthConfig(configured);
  assert.equal(result.state, "CONFIGURED");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  assert.equal(
    result.callbackUrl,
    "https://hushed-seal-237.convex.site/api/auth/callback/google",
  );
  assert.equal(JSON.stringify(result).includes(configured.AUTH_GOOGLE_SECRET), false);
});

test("rejects invalid URLs and implausible Google credentials without echoing values", () => {
  const secret = "this-is-a-secret-value-that-must-not-leak";
  const result = classifyGoogleAuthConfig({
    ...configured,
    AUTH_GOOGLE_ID: "not-a-google-client-id",
    AUTH_GOOGLE_SECRET: "short",
    CONVEX_SITE_URL: "http://calculating-eagle-241.convex.cloud",
    SITE_URL: "javascript:alert(1)",
  });
  assert.equal(result.state, "INVALID");
  assert.equal(result.invalid.length, 4);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("not-a-google-client-id"), false);
});

test("rejects auth and frontend URLs that point at different deployments", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    CONVEX_SITE_URL: "https://calculating-eagle-241.convex.site",
  });
  assert.equal(result.state, "INVALID");
  assert.ok(result.invalid.includes("CONVEX_SITE_URL and VITE_CONVEX_URL must identify the same deployment"));
});

test("keeps the state INVALID when required fields are also missing", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    AUTH_GOOGLE_ID: "bad-id",
    AUTH_GOOGLE_SECRET: undefined,
  });
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.missing, ["AUTH_GOOGLE_SECRET"]);
});
