/**
 * Transactional templates + temporary-sender policy.
 *
 * These tests never perform a network send and never contain a real
 * credential. They do not mark production email transport as verified.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EmailDeliveryError,
  FORBIDDEN_DELIVERY_HOSTS,
  PROVIDER_SHARED_TEST_SENDER_HOSTS,
  XSTARZ_PRODUCT_NAME,
  buildProviderRequest,
  buildSubject,
  formatSenderHeader,
  isSharedTestSenderHost,
  readEmailDeliveryConfig,
  renderSecurityAlertHtml,
  renderSecurityAlertText,
  renderVerificationHtml,
  renderVerificationText,
  sendXstarzSecurityAlertEmail,
  sendXstarzVerificationEmail,
  type FetchLike,
} from "./emailDelivery";
import {
  buildSecurityAlertSubject,
  renderSecurityAlertMessage,
  renderVerificationMessage,
} from "./emailTemplates";

const OTP = "418237";
const RECIPIENT = "trader@example.com";
const EMAIL = { recipient: RECIPIENT, otp: OTP, expiryMinutes: 10 };
const ALERT = { recipient: RECIPIENT, event: "new sign-in from a new device" };

const PLACEHOLDER_KEY = ["placeholder", "not", "a", "real", "key", "0000"].join("-");

const envFrom = (over: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = {
    XSTARZ_EMAIL_TRANSPORT: "resend",
    XSTARZ_EMAIL_API_KEY: PLACEHOLDER_KEY,
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

describe("OTP template is branded and complete", () => {
  it("includes product name, code, expiry, do-not-share, and a security warning", () => {
    const text = renderVerificationText(EMAIL);
    const html = renderVerificationHtml(EMAIL);
    for (const body of [text, html]) {
      expect(body).toContain(XSTARZ_PRODUCT_NAME);
      expect(body).toContain(OTP);
      expect(body).toContain("10 minutes");
      expect(body.toLowerCase()).toContain("do not share");
      expect(body.toLowerCase()).toContain("did not request");
      expect(body.toLowerCase()).toContain("will ever ask you");
    }
  });

  it("never puts the code in the subject", () => {
    const rendered = renderVerificationMessage(EMAIL);
    expect(rendered.subject).toContain(XSTARZ_PRODUCT_NAME);
    expect(rendered.subject).not.toContain(OTP);
    expect(buildSubject()).not.toContain(OTP);
    expect(buildSubject.length).toBe(0);
  });

  it("contains no tracking pixel, remote image or marketing content", () => {
    const html = renderVerificationHtml(EMAIL);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("contains no market analysis or account data", () => {
    const text = renderVerificationText(EMAIL).toLowerCase();
    for (const forbidden of ["buy", "sell", "portfolio", "balance", "password", "api key"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("security-alert template is branded and reusable", () => {
  it("includes product name, the event, and a concise security warning", () => {
    const text = renderSecurityAlertText(ALERT);
    const html = renderSecurityAlertHtml(ALERT);
    for (const body of [text, html]) {
      expect(body).toContain(XSTARZ_PRODUCT_NAME);
      expect(body).toContain(ALERT.event);
      expect(body.toLowerCase()).toContain("if you did not");
      expect(body.toLowerCase()).toContain("will ever ask you");
    }
    expect(buildSecurityAlertSubject()).toContain(XSTARZ_PRODUCT_NAME);
    expect(buildSecurityAlertSubject()).not.toContain(ALERT.event);
  });

  it("never includes an OTP or a tracking pixel", () => {
    const rendered = renderSecurityAlertMessage(ALERT);
    expect(rendered.subject).not.toMatch(/\d{6}/);
    expect(rendered.text).not.toContain(OTP);
    expect(rendered.html).not.toMatch(/<img/i);
    expect(rendered.html).not.toMatch(/https?:\/\//);
  });

  it("escapes attacker-controlled event text", () => {
    const html = renderSecurityAlertHtml({
      recipient: RECIPIENT,
      event: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("From header is Xstarz-branded without rewriting the mailbox", () => {
  it("formats display name plus the configured address", () => {
    expect(formatSenderHeader("Xstarz Analysis", "no-reply@xstarz-placeholder.invalid")).toBe(
      "Xstarz Analysis <no-reply@xstarz-placeholder.invalid>",
    );
  });

  it("defaults an empty display name to the product name", () => {
    expect(formatSenderHeader("  ", "alerts@example.test")).toBe(
      `${XSTARZ_PRODUCT_NAME} <alerts@example.test>`,
    );
  });

  it("puts a custom display name in From and keeps the configured mailbox", () => {
    const config = readEmailDeliveryConfig(
      envFrom({
        XSTARZ_DEPLOYMENT_ENV: "development",
        XSTARZ_EMAIL_SENDER_NAME: "Xstarz Analysis Alerts",
        XSTARZ_EMAIL_SENDER_ADDRESS: "onboarding@resend.dev",
      }),
    );
    const request = buildProviderRequest(config, EMAIL);
    const body = request.body as { from: string };
    expect(body.from).toBe("Xstarz Analysis Alerts <onboarding@resend.dev>");
    expect(body.from).toContain("onboarding@resend.dev");
    expect(config.senderAddress).toBe("onboarding@resend.dev");
  });
});

describe("provider shared test senders fail closed in production", () => {
  it("names resend.dev as a shared test host, not a retired Freebuff host", () => {
    expect(PROVIDER_SHARED_TEST_SENDER_HOSTS).toContain("resend.dev");
    expect(FORBIDDEN_DELIVERY_HOSTS).not.toContain("resend.dev");
    expect(isSharedTestSenderHost("resend.dev")).toBe(true);
    expect(isSharedTestSenderHost("mail.resend.dev")).toBe(true);
    expect(isSharedTestSenderHost("xstarz-placeholder.invalid")).toBe(false);
  });

  it("refuses onboarding@resend.dev when the deployment is production", () => {
    let threw: unknown = null;
    try {
      readEmailDeliveryConfig(
        envFrom({
          XSTARZ_DEPLOYMENT_ENV: "production",
          XSTARZ_EMAIL_SENDER_ADDRESS: "onboarding@resend.dev",
        }),
      );
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(EmailDeliveryError);
    expect((threw as EmailDeliveryError).reason).toBe("not_configured");
    expect((threw as Error).message).toMatch(/shared test identity/i);
  });

  it("refuses a shared test sender when XSTARZ_DEPLOYMENT_ENV is unset", () => {
    expect(() =>
      readEmailDeliveryConfig(envFrom({ XSTARZ_EMAIL_SENDER_ADDRESS: "onboarding@resend.dev" })),
    ).toThrow(EmailDeliveryError);
  });

  it("allows a shared test sender only in explicit non-production", () => {
    const config = readEmailDeliveryConfig(
      envFrom({
        XSTARZ_DEPLOYMENT_ENV: "development",
        XSTARZ_EMAIL_SENDER_ADDRESS: "onboarding@resend.dev",
      }),
    );
    expect(config.senderAddress).toBe("onboarding@resend.dev");
    expect(config.senderName).toBe(XSTARZ_PRODUCT_NAME);
  });

  it("does not fall back to a Freebuff sender when the test identity is refused", () => {
    const delivery = readFileSync(join(process.cwd(), "src/convex/lib/emailDelivery.ts"), "utf8");
    const code = delivery.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("OTP_EMAIL_API_KEY");
    expect(code).not.toContain("/send_otp");
    expect(() =>
      readEmailDeliveryConfig(
        envFrom({
          XSTARZ_DEPLOYMENT_ENV: "production",
          XSTARZ_EMAIL_SENDER_ADDRESS: "onboarding@resend.dev",
        }),
      ),
    ).toThrow(/not_configured|shared test identity/i);
  });
});

describe("missing production credentials still fail closed", () => {
  it("refuses a missing API key", () => {
    expect(() =>
      readEmailDeliveryConfig(
        envFrom({
          XSTARZ_DEPLOYMENT_ENV: "production",
          XSTARZ_EMAIL_API_KEY: undefined,
        }),
      ),
    ).toThrow(/XSTARZ_EMAIL_API_KEY/);
  });

  it("refuses a missing sender", () => {
    expect(() =>
      readEmailDeliveryConfig(
        envFrom({
          XSTARZ_DEPLOYMENT_ENV: "production",
          XSTARZ_EMAIL_SENDER_ADDRESS: undefined,
        }),
      ),
    ).toThrow(/XSTARZ_EMAIL_SENDER_ADDRESS/);
  });
});

describe("retired domains stay forbidden", () => {
  it.each(["auth.freebuff.app", "freebuff.com", "freebuff.app", "vly.ai"])(
    "refuses %s in production",
    (host) => {
      expect(() =>
        readEmailDeliveryConfig(
          envFrom({
            XSTARZ_DEPLOYMENT_ENV: "production",
            XSTARZ_EMAIL_SENDER_ADDRESS: `no-reply@${host}`,
          }),
        ),
      ).toThrow(/Xstarz-owned domain/);
    },
  );
});

describe("app-facing send remains sendXstarzVerificationEmail", () => {
  it("OTP send still posts through the configured transport", async () => {
    const { fetchImpl, calls } = okFetch();
    const result = await sendXstarzVerificationEmail(EMAIL, {
      env: envFrom({ XSTARZ_DEPLOYMENT_ENV: "development" }),
      fetchImpl,
    });
    expect(result).toEqual({ transport: "resend", delivered: true });
    const body = JSON.parse(calls[0].init.body);
    expect(body.from).toBe("Xstarz Analysis <no-reply@xstarz-placeholder.invalid>");
    expect(body.text).toContain("Do not share");
    expect(body.subject).not.toContain(OTP);
  });

  it("security notices reuse the same transport and sender policy", async () => {
    const { fetchImpl, calls } = okFetch();
    const result = await sendXstarzSecurityAlertEmail(ALERT, {
      env: envFrom({ XSTARZ_DEPLOYMENT_ENV: "development" }),
      fetchImpl,
    });
    expect(result).toEqual({ transport: "resend", delivered: true });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(calls[0].init.body);
    expect(body.from).toBe("Xstarz Analysis <no-reply@xstarz-placeholder.invalid>");
    expect(body.subject).toContain(XSTARZ_PRODUCT_NAME);
    expect(body.text).toContain(ALERT.event);
    expect(body.text).not.toContain(OTP);
  });

  it("auth still imports sendXstarzVerificationEmail only", () => {
    const otp = readFileSync(join(process.cwd(), "src/convex/auth/emailOtp.ts"), "utf8");
    expect(otp).toContain("sendXstarzVerificationEmail");
    expect(otp).not.toContain("sendXstarzSecurityAlertEmail");
    expect(otp).not.toContain("OTP_EMAIL_API_KEY");
  });
});
