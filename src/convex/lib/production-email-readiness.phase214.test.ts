/**
 * Phase 214 — production email / OTP readiness.
 *
 * The headline regression: production ACCEPTED `noreply@vly.ai` as an OTP
 * sender. `RETIRED_ISSUER_HOSTS` retired `vly.ai` for auth issuers, but
 * `FORBIDDEN_DELIVERY_HOSTS` was a separate hand-maintained copy that only
 * listed the Freebuff hosts, so the sending identity was never retired with it.
 *
 * These tests drive the real configuration reader. They never perform a send,
 * never contain a credential, and cannot be satisfied by a console transport.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_DELIVERY_HOSTS,
  readEmailDeliveryConfig,
  EmailDeliveryError,
} from "./emailDelivery";
import { RETIRED_ISSUER_HOSTS } from "./issuerPolicy";

/** A key-shaped placeholder. Assembled so no scanner sees a literal secret. */
const PLACEHOLDER_KEY = ["placeholder", "not", "a", "real", "key", "0000"].join("-");

const envFrom = (o: Record<string, string>) => (k: string) => o[k];

const PROD_BASE = {
  XSTARZ_EMAIL_TRANSPORT: "resend",
  XSTARZ_EMAIL_API_KEY: PLACEHOLDER_KEY,
  XSTARZ_DEPLOYMENT_ENV: "production",
};

const expectRefused = (env: Record<string, string>) => {
  let threw: unknown = null;
  try {
    readEmailDeliveryConfig(envFrom(env));
  } catch (e) {
    threw = e;
  }
  expect(threw, "configuration must be refused").toBeInstanceOf(EmailDeliveryError);
  expect((threw as EmailDeliveryError).reason).toBe("not_configured");
};

describe("Phase 214 — retired domains cannot be used as OTP senders", () => {
  it.each(["vly.ai", "freebuff.com", "freebuff.app", "auth.freebuff.app"])(
    "refuses a production sender at %s",
    (host) => {
      expectRefused({ ...PROD_BASE, XSTARZ_EMAIL_SENDER_ADDRESS: `no-reply@${host}` });
    },
  );

  it.each(["mail.vly.ai", "smtp.freebuff.com", "a.b.vly.ai"])(
    "refuses a subdomain of a retired host (%s)",
    (host) => {
      expectRefused({ ...PROD_BASE, XSTARZ_EMAIL_SENDER_ADDRESS: `no-reply@${host}` });
    },
  );

  it("every retired issuer host is also a forbidden sending host", () => {
    // The invariant that was violated: the two lists must not drift apart.
    for (const host of RETIRED_ISSUER_HOSTS) {
      expect(
        FORBIDDEN_DELIVERY_HOSTS,
        `${host} is retired for auth and must be retired for sending`,
      ).toContain(host);
    }
  });

  it("still names the leaked-credential issuer explicitly", () => {
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("auth.freebuff.app");
  });

  it("accepts a sender on a domain the project controls", () => {
    const config = readEmailDeliveryConfig(
      envFrom({ ...PROD_BASE, XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-analysis.test" }),
    );
    expect(config.transport).toBe("resend");
    expect(config.senderAddress).toBe("no-reply@xstarz-analysis.test");
  });
});

describe("Phase 214 — production fails closed", () => {
  it("refuses the console transport in production", () => {
    expectRefused({
      XSTARZ_EMAIL_TRANSPORT: "console",
      XSTARZ_DEPLOYMENT_ENV: "production",
      XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-analysis.test",
    });
  });

  it("treats an UNSET deployment environment as production", () => {
    // The dangerous default is the safe one: absent => production => console
    // refused. A deployment that forgets the variable must not silently send
    // nothing.
    expectRefused({
      XSTARZ_EMAIL_TRANSPORT: "console",
      XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-analysis.test",
    });
  });

  it("refuses a missing API key on a real transport", () => {
    expectRefused({
      XSTARZ_EMAIL_TRANSPORT: "resend",
      XSTARZ_DEPLOYMENT_ENV: "production",
      XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-analysis.test",
    });
  });

  it("refuses a missing sender", () => {
    expectRefused({ ...PROD_BASE });
  });

  it.each(["not-an-email", "@nodomain", "spaces in@example.test", "no-at-sign.test"])(
    "refuses an implausible sender address (%s)",
    (sender) => {
      expectRefused({ ...PROD_BASE, XSTARZ_EMAIL_SENDER_ADDRESS: sender });
    },
  );

  it("refuses an unsupported transport name", () => {
    expectRefused({
      XSTARZ_EMAIL_TRANSPORT: "sendgrid",
      XSTARZ_EMAIL_API_KEY: PLACEHOLDER_KEY,
      XSTARZ_DEPLOYMENT_ENV: "production",
      XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-analysis.test",
    });
  });

  it("permits console only when the deployment is explicitly non-production", () => {
    const config = readEmailDeliveryConfig(
      envFrom({ XSTARZ_EMAIL_TRANSPORT: "console", XSTARZ_DEPLOYMENT_ENV: "development" }),
    );
    expect(config.transport).toBe("console");
  });
});

describe("Phase 214 — OTP security policy is unchanged", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  /**
   * Strip comments before asserting absence. The invariants below are also
   * DOCUMENTED in comments ("Math.random must never appear here", "NOT
   * refunded on a delivery failure"), so a naive not.toContain fails on the
   * very text that states the rule.
   */
  const codeOnly = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  const emailOtp = read("src/convex/auth/emailOtp.ts");
  const auth = read("src/convex/auth.ts");
  const throttle = read("src/convex/lib/otpResendThrottle.ts");
  const limiter = read("src/convex/otpLimiter.ts");

  it("keeps the OTP lifetime at 10 minutes", () => {
    expect(emailOtp).toMatch(/OTP_EXPIRY_MINUTES\s*=\s*10\s*;/);
    expect(emailOtp).toMatch(/maxAge: 60 \* OTP_EXPIRY_MINUTES/);
  });

  it("generates codes with a CSPRNG, never Math.random", () => {
    expect(emailOtp).toContain("generateRandomString");
    expect(emailOtp).toContain("getRandomValues");
    expect(codeOnly(emailOtp)).not.toContain("Math.random");
  });

  it("keeps the failed sign-in limit at 5 per hour", () => {
    expect(auth).toMatch(/MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR\s*=\s*5\s*;/);
    expect(auth).toContain("maxFailedAttempsPerHour");
  });

  it("keeps the resend cooldown at 60s and the window at 5 per hour", () => {
    // Anchor the numbers: an unanchored /=\s*5/ also matches 500, which let a
    // "resend limit raised to 500" mutation survive.
    expect(throttle).toMatch(/RESEND_COOLDOWN_MS\s*=\s*60_000\s*;/);
    expect(throttle).toMatch(/MAX_SENDS_PER_WINDOW\s*=\s*5\s*;/);
    expect(throttle).toMatch(/RESEND_WINDOW_MS\s*=\s*60 \* 60 \* 1000\s*;/);
  });

  it("stores a hashed identity, never a raw email address", () => {
    expect(limiter).toContain("hashIdentifier");
    expect(limiter).toMatch(/SHA-256/i);
    // The durable bucket is keyed by hash.
    expect(limiter).toContain("identityHash");
  });

  it("does not extend the cooldown when a request is rejected", () => {
    const fn = limiter.slice(limiter.indexOf("consumeResendAllowance"));
    const rejection = fn.slice(0, fn.indexOf("allowed: false"));
    // No write may occur on the path leading to the rejection return.
    expect(rejection).not.toContain("ctx.db.patch");
    expect(rejection).not.toContain("ctx.db.insert");
    expect(limiter).toMatch(/rejected request must not extend the cooldown/i);
  });

  it("does not refund the allowance when a send fails", () => {
    expect(emailOtp).toMatch(/NOT refunded on a delivery failure/i);
    const catchBlock = codeOnly(emailOtp.slice(emailOtp.indexOf("} catch (error) {")));
    expect(catchBlock).not.toContain("refund");
    expect(catchBlock).not.toContain("releaseResendAllowance");
    expect(catchBlock).not.toContain("runMutation");
  });

  it("surfaces only an error category, never the provider payload", () => {
    expect(emailOtp).toMatch(/Failed to send verification email \(\$\{error\.reason\}\)/);
    expect(emailOtp).not.toMatch(/error\.message/);
  });
});

describe("Phase 214 — the runbook tells the operator the truth", () => {
  const runbook = readFileSync(
    resolve(process.cwd(), "docs/PRODUCTION-EMAIL-SETUP.md"),
    "utf8",
  );

  it("lists every configuration name the reader actually consults", () => {
    for (const name of [
      "XSTARZ_EMAIL_TRANSPORT",
      "XSTARZ_EMAIL_API_KEY",
      "XSTARZ_EMAIL_SENDER_ADDRESS",
      "XSTARZ_EMAIL_SENDER_NAME",
      "XSTARZ_EMAIL_TIMEOUT_MS",
      "XSTARZ_DEPLOYMENT_ENV",
      "SITE_URL",
    ]) {
      expect(runbook, `runbook must document ${name}`).toContain(name);
    }
  });

  it("states that HTTP 200 is not delivery evidence", () => {
    expect(runbook).toMatch(/HTTP 200/);
    expect(runbook).toMatch(/an accepted request is not a delivered message/i);
  });

  it("requires a human attestation and a real mailbox for D1", () => {
    expect(runbook).toMatch(/actually received/i);
    expect(runbook).toMatch(/human attestation/i);
    expect(runbook).toMatch(/OTP session was created through the application/i);
  });

  it("separates the new email credential from the leaked Freebuff credential", () => {
    expect(runbook).toMatch(/does not revoke the leaked key/i);
    expect(runbook).toMatch(/401\/403/);
    expect(runbook).toMatch(/history rewrite remains blocked/i);
  });

  it("does not invent a production domain or a sender address", () => {
    // Placeholders must be obviously non-routable; no real-looking domain.
    expect(runbook).not.toMatch(/example\.invalid/);
    expect(runbook).not.toMatch(/@xstarz\.(com|io|ai|app)\b/);
  });

  it("never contains a credential-shaped literal", () => {
    expect(runbook).not.toMatch(/re_[A-Za-z0-9]{16,}/);
    expect(runbook).not.toMatch(/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i);
  });
});
