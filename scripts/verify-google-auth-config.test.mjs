import test from "node:test";
import assert from "node:assert/strict";
import { classifyGoogleAuthConfig } from "./verify-google-auth-config.mjs";

const configured = {
  GOOGLE_CLIENT_ID: "123456789-example.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "gocspx-abcdefghijklmnop",
  APP_ORIGIN: "https://xstarzganalys.com",
  PUBLIC_BASE_URL: "https://xstarzganalys.com",
  DOMAIN: "xstarzganalys.com",
};

test("reports missing self-hosted OAuth variable names without values", () => {
  const result = classifyGoogleAuthConfig({});
  assert.equal(result.state, "NOT_CONFIGURED");
  assert.deepEqual(result.missing, [
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_ORIGIN", "PUBLIC_BASE_URL", "DOMAIN",
  ]);
});

test("accepts structurally valid self-hosted OAuth configuration and derives callback", () => {
  const result = classifyGoogleAuthConfig(configured);
  assert.equal(result.state, "CONFIGURED");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
  assert.equal(
    result.callbackUrl,
    "https://xstarzganalys.com/api/v1/auth/google/callback",
  );
  assert.equal(JSON.stringify(result).includes(configured.GOOGLE_CLIENT_SECRET), false);
});

test("rejects malformed client IDs, weak secrets and non-HTTPS origins", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    GOOGLE_CLIENT_ID: "not-a-google-client-id",
    GOOGLE_CLIENT_SECRET: "short",
    APP_ORIGIN: "http://xstarzganalys.com",
  });
  assert.equal(result.state, "INVALID");
  assert.equal(result.invalid.length, 3);
  assert.equal(JSON.stringify(result).includes("not-a-google-client-id"), false);
  assert.equal(JSON.stringify(result).includes("short"), false);
});

test("requires frontend and backend origins to match for host-only cookies", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    PUBLIC_BASE_URL: "https://api.xstarzganalys.com",
  });
  assert.equal(result.state, "INVALID");
  assert.ok(result.invalid.some((entry) => entry.includes("must match")));
});

test("rejects a Caddy domain that differs from the canonical application origin", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    DOMAIN: "other.example.com",
  });
  assert.equal(result.state, "INVALID");
  assert.ok(result.invalid.some((entry) => entry.includes("DOMAIN must match APP_ORIGIN")));
});

test("rejects a DOMAIN value containing a URL scheme or port", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    DOMAIN: "https://xstarzganalys.com:443",
  });
  assert.equal(result.state, "INVALID");
  assert.ok(result.invalid.some((entry) => entry.includes("hostname without scheme")));
});

test("keeps INVALID precedence when required fields are also missing", () => {
  const result = classifyGoogleAuthConfig({
    ...configured,
    GOOGLE_CLIENT_ID: "bad",
    GOOGLE_CLIENT_SECRET: undefined,
  });
  assert.equal(result.state, "INVALID");
  assert.deepEqual(result.missing, ["GOOGLE_CLIENT_SECRET"]);
});
