/**
 * Phase 185 — Xstarz-owned OTP delivery.
 *
 * These tests assert BEHAVIOUR that matters for security: that no credential
 * or code leaks, that failures fail closed, and that the retired third-party
 * endpoint can never be contacted again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DELIVERY_TIMEOUT_MS,
  EmailDeliveryError,
  FORBIDDEN_DELIVERY_HOSTS,
  buildProviderRequest,
  buildSubject,
  isPlausibleEmailAddress,
  maskRecipient,
  readEmailDeliveryConfig,
  renderVerificationHtml,
  renderVerificationText,
  sendXstarzVerificationEmail,
  XSTARZ_PRODUCT_NAME,
  type FetchLike,
} from "./emailDelivery";
import {
  MAX_SENDS_PER_WINDOW,
  RESEND_COOLDOWN_MS,
  RESEND_WINDOW_MS,
  checkResendAllowed,
  recordResend,
  resetResendThrottleForTests,
} from "./otpResendThrottle";

const OTP = "418237";
const RECIPIENT = "trader@example.com";

const validEnv = (over: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = {
    XSTARZ_EMAIL_TRANSPORT: "resend",
    XSTARZ_EMAIL_API_KEY: "re_test_key_value_not_real",
    XSTARZ_EMAIL_SENDER_ADDRESS: "no-reply@xstarz-placeholder.invalid",
    XSTARZ_EMAIL_SENDER_NAME: "Xstarz Analysis",
    ...over,
  };
  return (key: string) => base[key];
};

type FetchInit = Parameters<FetchLike>[1];

const okFetch = (): { fetchImpl: FetchLike; calls: Array<{ url: string; init: FetchInit }> } => {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{"id":"x"}' };
  };
  return { fetchImpl, calls };
};

beforeEach(() => resetResendThrottleForTests());

describe("1. valid recipient reaches the Xstarz transport", () => {
  it("posts to the configured provider with the Xstarz sender", async () => {
    const { fetchImpl, calls } = okFetch();
    const result = await sendXstarzVerificationEmail(
      { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
      { env: validEnv(), fetchImpl },
    );

    expect(result).toEqual({ transport: "resend", delivered: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");

    const body = JSON.parse(calls[0].init.body);
    expect(body.to).toEqual([RECIPIENT]);
    expect(body.from).toBe("Xstarz Analysis <no-reply@xstarz-placeholder.invalid>");
  });

  it("carries the OTP in the body, never the subject line", async () => {
    const { fetchImpl, calls } = okFetch();
    await sendXstarzVerificationEmail(
      { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
      { env: validEnv(), fetchImpl },
    );
    const body = JSON.parse(calls[0].init.body);
    // Subjects surface in lock-screen previews; the code must not.
    expect(body.subject).not.toContain(OTP);
    expect(body.text).toContain(OTP);
  });
});

describe("2. missing configuration fails explicitly", () => {
  it("throws not_configured when the API key is absent", () => {
    expect(() => readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_API_KEY: undefined }))).toThrow(
      EmailDeliveryError,
    );
    try {
      readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_API_KEY: undefined }));
    } catch (e) {
      expect((e as EmailDeliveryError).reason).toBe("not_configured");
      expect((e as Error).message).toContain("XSTARZ_EMAIL_API_KEY");
    }
  });

  it("throws when the sender address is absent", () => {
    expect(() =>
      readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: undefined })),
    ).toThrow(/XSTARZ_EMAIL_SENDER_ADDRESS/);
  });

  it("reports an ABSENT sender distinctly from a MALFORMED one", () => {
    // Mutation testing found that deleting the "is it present?" check still
    // failed closed, because the format check caught it — but with a message
    // that misdiagnoses the operator's problem ("not a valid email address"
    // when the truth is "you never set it"). Both branches are asserted so
    // neither can silently absorb the other.
    const absent = (() => {
      try {
        readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: undefined }));
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();
    const malformed = (() => {
      try {
        readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: "not-an-email" }));
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();

    expect(absent).toContain("missing");
    expect(malformed).toContain("not a valid email address");
    expect(absent).not.toBe(malformed);
  });

  it("never falls back to a default sender when unconfigured", () => {
    // Failing closed is the point: a silent fallback would send production
    // mail from an identity the project does not own.
    let threw = false;
    try {
      readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: undefined }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("rejects an unsupported transport rather than guessing", () => {
    expect(() => readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_TRANSPORT: "carrier-pigeon" }))).toThrow(
      /Unsupported XSTARZ_EMAIL_TRANSPORT/,
    );
  });
});

describe("3. provider timeout fails safely", () => {
  it("reports timeout without exposing the request", async () => {
    const fetchImpl: FetchLike = async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };
    await expect(
      sendXstarzVerificationEmail(
        { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
        { env: validEnv(), fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("uses the default timeout when none is configured", () => {
    expect(readEmailDeliveryConfig(validEnv()).timeoutMs).toBe(DEFAULT_DELIVERY_TIMEOUT_MS);
  });

  it("caps an absurd configured timeout", () => {
    expect(
      readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_TIMEOUT_MS: "999999" })).timeoutMs,
    ).toBe(30_000);
  });
});

describe("4. provider 429 fails safely", () => {
  it("classifies rate limiting distinctly from a generic error", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 429,
      text: async () => "slow down",
    });
    await expect(
      sendXstarzVerificationEmail(
        { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
        { env: validEnv(), fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "rate_limited", status: 429 });
  });
});

describe("5-8. failures never leak the OTP, the key or the recipient", () => {
  const cases: Array<[string, FetchLike]> = [
    [
      "provider 500 echoing the request",
      async () => ({
        ok: false,
        status: 500,
        // A real provider genuinely can echo the submitted payload.
        text: async () => JSON.stringify({ error: "bad", echo: { otp: OTP, key: "re_test_key_value_not_real" } }),
      }),
    ],
    [
      "network error carrying the request in the message",
      async () => {
        throw new Error(`connect ECONNREFUSED body={"otp":"${OTP}","key":"re_test_key_value_not_real"}`);
      },
    ],
  ];

  it.each(cases)("%s does not surface secrets", async (_label, fetchImpl) => {
    let message = "";
    let serialised = "";
    try {
      await sendXstarzVerificationEmail(
        { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
        { env: validEnv(), fetchImpl },
      );
    } catch (e) {
      message = (e as Error).message;
      serialised = JSON.stringify({
        message: (e as Error).message,
        stack: (e as Error).stack ?? "",
      });
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(OTP);
    expect(message).not.toContain("re_test_key_value_not_real");
    expect(serialised).not.toContain(OTP);
    expect(serialised).not.toContain("re_test_key_value_not_real");
  });

  it("the console transport logs no OTP and no bare recipient", async () => {
    const logged: string[] = [];
    await sendXstarzVerificationEmail(
      { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
      {
        // Phase 185b: console is production-forbidden, so this dev-only test
        // must declare a development deployment.
        env: validEnv({
          XSTARZ_DEPLOYMENT_ENV: "development",
          XSTARZ_EMAIL_TRANSPORT: "console",
          XSTARZ_EMAIL_API_KEY: undefined,
        }),
        logger: (m) => logged.push(m),
      },
    );
    const all = logged.join("\n");
    expect(all).not.toContain(OTP);
    expect(all).not.toContain(RECIPIENT);
    expect(all).toContain("tr***@example.com");
  });

  it("masks recipients without destroying support usefulness", () => {
    expect(maskRecipient("trader@example.com")).toBe("tr***@example.com");
    expect(maskRecipient("a@b.co")).toBe("a***@b.co");
    expect(maskRecipient("garbage")).toBe("***");
  });
});

describe("9-10. the retired third-party dependency cannot return", () => {
  const convexDir = join(process.cwd(), "src/convex");
  const sources = [
    "auth/emailOtp.ts",
    "lib/emailDelivery.ts",
    "lib/otpResendThrottle.ts",
  ].map((f) => ({
    file: f,
    // Strip comments: prose legitimately names the retired host.
    code: readFileSync(join(convexDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  }));

  it.each(sources)("$file never CALLS a Freebuff endpoint", ({ code }) => {
    // Naming the host is fine — `FORBIDDEN_DELIVERY_HOSTS` is a deny-list, and
    // a deny-list has to name what it denies. What must not exist is a request
    // URL pointing at it. Assert on the thing that would actually send data.
    const requestUrls = [...code.matchAll(/["'`](https?:\/\/[^"'`]+)["'`]/g)].map((m) => m[1]);
    for (const url of requestUrls) {
      const host = new URL(url).hostname.toLowerCase();
      expect(FORBIDDEN_DELIVERY_HOSTS).not.toContain(host);
      expect(host.endsWith(".freebuff.app")).toBe(false);
      expect(host.endsWith(".freebuff.com")).toBe(false);
    }
    expect(code).not.toContain("/send_otp");
  });

  it("the deny-list is actually enforced, not merely declared", () => {
    // Guards the test above: if FORBIDDEN_DELIVERY_HOSTS became decorative,
    // the URL assertion would still pass. This proves the list has teeth.
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("auth.freebuff.app");
    expect(() =>
      readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: "x@auth.freebuff.app" })),
    ).toThrow();
  });

  it("no auth source reads the retired OTP credential variable", () => {
    for (const { code } of sources) expect(code).not.toContain("OTP_EMAIL_API_KEY");
  });

  it("no auth source reads VLY_APP_NAME", () => {
    // It existed solely to label the third-party OTP mail.
    for (const { code } of sources) expect(code).not.toContain("VLY_APP_NAME");
  });

  it("every provider request targets a non-Freebuff host", () => {
    for (const transport of ["resend", "smtp2go"] as const) {
      const config = readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_TRANSPORT: transport }));
      const request = buildProviderRequest(config, {
        recipient: RECIPIENT,
        otp: OTP,
        expiryMinutes: 10,
      });
      for (const host of FORBIDDEN_DELIVERY_HOSTS) {
        expect(request.url).not.toContain(host);
      }
    }
  });

  it("refuses a sender identity on a retired third-party domain", () => {
    for (const host of ["freebuff.com", "auth.freebuff.app", "mail.freebuff.com"]) {
      expect(() =>
        readEmailDeliveryConfig(validEnv({ XSTARZ_EMAIL_SENDER_ADDRESS: `no-reply@${host}` })),
      ).toThrow(/Xstarz-owned domain/);
    }
  });
});

describe("11. resend throttling", () => {
  it("allows the first send", () => {
    expect(checkResendAllowed(RECIPIENT).allowed).toBe(true);
  });

  it("blocks an immediate resend and reports how long to wait", () => {
    const t0 = 1_000_000;
    recordResend(RECIPIENT, t0);
    const decision = checkResendAllowed(RECIPIENT, t0 + 5_000);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("cooldown");
      expect(decision.retryAfterMs).toBe(RESEND_COOLDOWN_MS - 5_000);
    }
  });

  it("allows a resend once the cooldown elapses", () => {
    const t0 = 2_000_000;
    recordResend(RECIPIENT, t0);
    expect(checkResendAllowed(RECIPIENT, t0 + RESEND_COOLDOWN_MS + 1).allowed).toBe(true);
  });

  it("enforces a window cap even when cooldowns are respected", () => {
    let t = 3_000_000;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      expect(checkResendAllowed(RECIPIENT, t).allowed).toBe(true);
      recordResend(RECIPIENT, t);
      t += RESEND_COOLDOWN_MS + 1_000;
    }
    const decision = checkResendAllowed(RECIPIENT, t);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("window_exceeded");
  });

  it("recovers after the window rolls over", () => {
    let t = 4_000_000;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      recordResend(RECIPIENT, t);
      t += RESEND_COOLDOWN_MS + 1_000;
    }
    expect(checkResendAllowed(RECIPIENT, t).allowed).toBe(false);
    expect(checkResendAllowed(RECIPIENT, t + RESEND_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("cannot be evaded by changing capitalisation or padding", () => {
    const t0 = 5_000_000;
    recordResend("Trader@Example.com", t0);
    expect(checkResendAllowed("  trader@example.COM  ", t0 + 1_000).allowed).toBe(false);
  });

  it("throttles per address, not globally", () => {
    const t0 = 6_000_000;
    recordResend("a@example.com", t0);
    expect(checkResendAllowed("b@example.com", t0 + 1).allowed).toBe(true);
  });
});

describe("11b. the throttle is actually WIRED INTO the auth provider", () => {
  // Mutation testing caught this gap: every throttle unit test passed while
  // `sendVerificationRequest` ignored the throttle entirely. Testing a guard
  // in isolation proves the guard works, not that anything calls it. These
  // tests drive the real provider callback.
  // `vi.resetModules()` makes emailOtp import a FRESH copy of the throttle
  // module — a different instance from the one imported at the top of this
  // file. Without restoring the registry afterwards, the statically imported
  // throttle tests would observe unrelated state. Learned the hard way: this
  // leaked into an unrelated test and failed it.
  afterEach(() => {
    vi.resetModules();
    resetResendThrottleForTests();
  });

  const loadProvider = async () => {
    vi.resetModules();
    const mod = await import("../auth/emailOtp");
    return mod.emailOtp as unknown as {
      sendVerificationRequest: (args: { identifier: string; token: string }) => Promise<void>;
    };
  };

  const configureEnv = () => {
    // Phase 185b: the console transport is rejected in production, and an
    // unset XSTARZ_DEPLOYMENT_ENV resolves to production by design.
    process.env.XSTARZ_DEPLOYMENT_ENV = "development";
    process.env.XSTARZ_EMAIL_TRANSPORT = "console";
    process.env.XSTARZ_EMAIL_SENDER_ADDRESS = "no-reply@xstarz-placeholder.invalid";
    process.env.XSTARZ_EMAIL_SENDER_NAME = "Xstarz Analysis";
  };

  it("rejects a second immediate request for the same address", async () => {
    configureEnv();
    const provider = await loadProvider();
    await provider.sendVerificationRequest({ identifier: "wired@example.com", token: "111111" });
    await expect(
      provider.sendVerificationRequest({ identifier: "wired@example.com", token: "222222" }),
    ).rejects.toThrow(/Too many verification codes/);
  });

  it("tells the user how long to wait without leaking the code", async () => {
    configureEnv();
    const provider = await loadProvider();
    await provider.sendVerificationRequest({ identifier: "wait@example.com", token: "333333" });
    let message = "";
    try {
      await provider.sendVerificationRequest({ identifier: "wait@example.com", token: "444444" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/\d+ seconds/);
    expect(message).not.toContain("444444");
  });

  it("does not throttle a different address", async () => {
    configureEnv();
    const provider = await loadProvider();
    await provider.sendVerificationRequest({ identifier: "one@example.com", token: "555555" });
    await expect(
      provider.sendVerificationRequest({ identifier: "two@example.com", token: "666666" }),
    ).resolves.toBeUndefined();
  });

  it("surfaces a delivery failure as a category, never as the OTP", async () => {
    process.env.XSTARZ_DEPLOYMENT_ENV = "development";
    process.env.XSTARZ_EMAIL_TRANSPORT = "resend";
    process.env.XSTARZ_EMAIL_API_KEY = "";
    process.env.XSTARZ_EMAIL_SENDER_ADDRESS = "";
    const provider = await loadProvider();
    let message = "";
    try {
      await provider.sendVerificationRequest({ identifier: "fail@example.com", token: "777777" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("not_configured");
    expect(message).not.toContain("777777");
  });
});

describe("12-14. code lifecycle guarantees are delegated, not reimplemented", () => {
  // Convex Auth owns hashing, single-use deletion, expiry and attempt limits.
  // Reimplementing them would create a second source of truth for auth state,
  // so these tests assert the LIBRARY provides them and that we configured it.
  const authLib = join(process.cwd(), "node_modules/@convex-dev/auth/src/server/implementation");

  it("stores verification codes hashed, never in plaintext", () => {
    const src = readFileSync(join(authLib, "mutations/createVerificationCode.ts"), "utf8");
    expect(src).toContain("code: await sha256(code)");
  });

  it("deletes the code on use, so a replayed code cannot verify twice", () => {
    const src = readFileSync(join(authLib, "mutations/verifyCodeAndSignIn.ts"), "utf8");
    expect(src).toContain("await ctx.db.delete(verificationCode._id)");
  });

  it("rejects an expired code server-side", () => {
    const src = readFileSync(join(authLib, "mutations/verifyCodeAndSignIn.ts"), "utf8");
    expect(src).toContain("verificationCode.expirationTime < Date.now()");
  });

  it("supersedes an older code when a new one is issued", () => {
    const src = readFileSync(join(authLib, "mutations/createVerificationCode.ts"), "utf8");
    expect(src).toContain("await ctx.db.delete(existingCode._id)");
  });

  it("this project tightens the failed-attempt limit below the default", () => {
    const authSrc = readFileSync(join(process.cwd(), "src/convex/auth.ts"), "utf8");
    expect(authSrc).toContain("maxFailedAttempsPerHour");
    const defaults = readFileSync(join(authLib, "rateLimit.ts"), "utf8");
    expect(defaults).toContain("DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10");
    const configured = /MAX_FAILED_SIGN_IN_ATTEMPTS_PER_HOUR\s*=\s*(\d+)/.exec(authSrc);
    expect(configured).not.toBeNull();
    expect(Number(configured![1])).toBeLessThan(10);
  });

  it("uses a CSPRNG for code generation, never Math.random", () => {
    const src = readFileSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"), "utf8");
    expect(src).toContain("crypto.getRandomValues");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).not.toContain(
      "Math.random",
    );
  });

  it("shortens the code lifetime from the previous 15 minutes", () => {
    const src = readFileSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"), "utf8");
    const minutes = /OTP_EXPIRY_MINUTES\s*=\s*(\d+)/.exec(src);
    expect(minutes).not.toBeNull();
    expect(Number(minutes![1])).toBeLessThanOrEqual(10);
  });
});

describe("15. session model is unchanged by this phase", () => {
  it("keeps Convex Auth as the session layer with the same providers", () => {
    const src = readFileSync(join(process.cwd(), "src/convex/auth.ts"), "utf8");
    expect(src).toContain("convexAuth");
    expect(src).toContain("emailOtp");
    expect(src).toContain("Anonymous");
    // No alternative auth framework was introduced.
    expect(src).not.toMatch(/next-auth|lucia|clerk|firebase/i);
  });

  it("does not trust an external JWT issuer unless explicitly configured", () => {
    const src = readFileSync(join(process.cwd(), "src/convex/auth.config.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The hardcoded default issuer is gone: no ambient external trust.
    expect(code).not.toContain('"https://freebuff.com"');
    // Phase 185b moved the decision behind an explicit policy, so the config
    // no longer reads the variable inline at all.
    expect(code).toContain("resolveFederatedIssuer");
  });
});

describe("email content is transactional and safe", () => {
  const email = { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 };

  it("is branded Xstarz Analysis", () => {
    expect(renderVerificationText(email)).toContain(XSTARZ_PRODUCT_NAME);
    expect(renderVerificationHtml(email)).toContain(XSTARZ_PRODUCT_NAME);
    expect(buildSubject()).toContain(XSTARZ_PRODUCT_NAME);
    // Structurally impossible to leak the code into the subject.
    expect(buildSubject.length).toBe(0);
  });

  it("shows the code and an explicit expiry", () => {
    expect(renderVerificationText(email)).toContain(OTP);
    expect(renderVerificationText(email)).toContain("10 minutes");
    expect(renderVerificationHtml(email)).toContain("10 minutes");
  });

  it("carries a security warning", () => {
    expect(renderVerificationText(email).toLowerCase()).toContain("did not request");
    expect(renderVerificationHtml(email).toLowerCase()).toContain("did not request");
    // Phrasing differs between the text and HTML bodies; assert the intent.
    expect(renderVerificationHtml(email).toLowerCase()).toContain("will ever ask you");
  });

  it("contains no tracking pixel, remote image or marketing content", () => {
    const html = renderVerificationHtml(email);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("contains no market analysis or account data", () => {
    const text = renderVerificationText(email).toLowerCase();
    for (const forbidden of ["buy", "sell", "portfolio", "balance", "password", "api key"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("escapes the code into HTML rather than interpolating it raw", () => {
    const html = renderVerificationHtml({ ...email, otp: "<script>x</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("recipient validation", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@b.co", "trader.one+tag@sub.example.com"]) {
      expect(isPlausibleEmailAddress(ok)).toBe(true);
    }
  });

  it("rejects malformed addresses without revealing account existence", async () => {
    for (const bad of ["", "no-at-sign", "a@b", "a b@c.com", "a@@b.com"]) {
      expect(isPlausibleEmailAddress(bad)).toBe(false);
    }
    const { fetchImpl, calls } = okFetch();
    await expect(
      sendXstarzVerificationEmail(
        { recipient: "no-at-sign", otp: OTP, expiryMinutes: 10 },
        { env: validEnv(), fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "invalid_recipient" });
    // Fails before any network call, so nothing is sent.
    expect(calls).toHaveLength(0);
  });
});

describe("transport substitution", () => {
  it("changes vendor via configuration alone, with no auth change", async () => {
    const { fetchImpl, calls } = okFetch();
    await sendXstarzVerificationEmail(
      { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
      { env: validEnv({ XSTARZ_EMAIL_TRANSPORT: "smtp2go" }), fetchImpl },
    );
    expect(calls[0].url).toBe("https://api.smtp2go.com/v3/email/send");
    // The credential travels in the vendor's own header, not a hardcoded one.
    expect(calls[0].init.headers["X-Smtp2go-Api-Key"]).toBeDefined();
    expect(calls[0].init.headers.authorization).toBeUndefined();
  });

  it("sends the API key only to the provider endpoint, never elsewhere", async () => {
    const { fetchImpl, calls } = okFetch();
    await sendXstarzVerificationEmail(
      { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 },
      { env: validEnv(), fetchImpl },
    );
    expect(calls[0].url.startsWith("https://api.resend.com/")).toBe(true);
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty("apiKey");
  });
});
