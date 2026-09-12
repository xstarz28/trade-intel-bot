/**
 * Xstarz-owned transactional email delivery.
 *
 * SERVER-ONLY. This module runs inside Convex and must never be imported by
 * client code — it reads provider credentials from the deployment environment.
 *
 * Phase 185 replaced a hardcoded third-party OTP endpoint (`auth.freebuff.app`)
 * with this abstraction. The authentication layer now calls
 * `sendXstarzVerificationEmail()` and knows nothing about which vendor
 * delivers the mail, so the transport can be swapped by changing environment
 * variables alone — no change to the auth flow, no redeploy of auth logic.
 *
 * ## Design constraints
 *
 * - **Provider-neutral.** A transport is a small descriptor (endpoint, headers,
 *   body shape). Adding a vendor means adding a descriptor, not editing the
 *   auth flow.
 * - **Fails closed.** Missing configuration throws before any network call.
 *   A sign-in code that cannot be delivered must surface as an error, never as
 *   a silent success that leaves the user waiting for mail.
 * - **Leaks nothing.** The OTP, the API key and the raw provider response never
 *   appear in thrown errors. Errors carry a category and an HTTP status, which
 *   is all an operator needs to diagnose delivery.
 * - **No Freebuff fallback.** If Xstarz configuration is absent the send fails.
 *   It must never silently fall back to a sender the project does not own.
 */

/** Transports supported today. Provider-neutral by construction. */
export type EmailTransportId = "resend" | "smtp2go" | "console";

/** Why a delivery attempt failed. Safe to log and safe to return upstream. */
export type EmailDeliveryFailureReason =
  | "not_configured"
  | "invalid_recipient"
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "network_error";

export class EmailDeliveryError extends Error {
  readonly reason: EmailDeliveryFailureReason;
  readonly status?: number;

  constructor(reason: EmailDeliveryFailureReason, message: string, status?: number) {
    super(message);
    this.name = "EmailDeliveryError";
    this.reason = reason;
    this.status = status;
  }
}

export type EmailDeliveryConfig = {
  transport: EmailTransportId;
  apiKey: string;
  senderAddress: string;
  senderName: string;
  /** Milliseconds before the provider call is abandoned. */
  timeoutMs: number;
};

export type VerificationEmail = {
  recipient: string;
  otp: string;
  /** Minutes until the code expires, shown to the user. */
  expiryMinutes: number;
};

export type EnvSource = (key: string) => string | undefined;

/** Product name in the email. Never a vendor name. */
export const XSTARZ_PRODUCT_NAME = "Xstarz Analysis";

export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Endpoints that must never be used for Xstarz OTP delivery.
 *
 * The first entry is the retired third-party service. It is listed here — not
 * as a live dependency but as a guard — so that a regression reintroducing it
 * fails a test instead of quietly shipping.
 */
export const FORBIDDEN_DELIVERY_HOSTS = ["auth.freebuff.app", "freebuff.com", "freebuff.app"];

/** RFC-5322 is famously permissive; this is a deliberate pragmatic subset. */
const EMAIL_PATTERN = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

export function isPlausibleEmailAddress(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_PATTERN.test(trimmed);
}

/**
 * Read delivery configuration from the environment.
 *
 * Throws `not_configured` when anything required is missing. That is
 * deliberate: production must refuse to start an OTP send it cannot complete
 * with an Xstarz-owned identity.
 */
export function readEmailDeliveryConfig(env: EnvSource): EmailDeliveryConfig {
  const transport = (env("XSTARZ_EMAIL_TRANSPORT") ?? "resend").trim() as EmailTransportId;

  if (!isSupportedTransport(transport)) {
    throw new EmailDeliveryError(
      "not_configured",
      `Unsupported XSTARZ_EMAIL_TRANSPORT "${transport}". Supported: resend, smtp2go, console.`,
    );
  }

  const senderAddress = (env("XSTARZ_EMAIL_SENDER_ADDRESS") ?? "").trim();
  const senderName = (env("XSTARZ_EMAIL_SENDER_NAME") ?? XSTARZ_PRODUCT_NAME).trim();

  // The console transport is for local development only: it never leaves the
  // machine, so it needs no credential and no verified domain.
  if (transport === "console") {
    return {
      transport,
      apiKey: "",
      senderAddress: senderAddress || "dev@localhost.invalid",
      senderName: senderName || XSTARZ_PRODUCT_NAME,
      timeoutMs: readTimeout(env),
    };
  }

  const apiKey = (env("XSTARZ_EMAIL_API_KEY") ?? "").trim();
  const missing: string[] = [];
  if (apiKey.length === 0) missing.push("XSTARZ_EMAIL_API_KEY");
  if (senderAddress.length === 0) missing.push("XSTARZ_EMAIL_SENDER_ADDRESS");

  if (missing.length > 0) {
    throw new EmailDeliveryError(
      "not_configured",
      `Xstarz email delivery is not configured: ${missing.join(", ")} missing. ` +
        "Set these in the Convex deployment environment.",
    );
  }

  if (!isPlausibleEmailAddress(senderAddress)) {
    throw new EmailDeliveryError(
      "not_configured",
      "XSTARZ_EMAIL_SENDER_ADDRESS is not a valid email address.",
    );
  }

  // A sender the project does not control must never be used, even if someone
  // sets it deliberately. Owning the sending identity is the point of Phase 185.
  const senderHost = senderAddress.split("@")[1]?.toLowerCase() ?? "";
  if (FORBIDDEN_DELIVERY_HOSTS.some((host) => senderHost === host || senderHost.endsWith(`.${host}`))) {
    throw new EmailDeliveryError(
      "not_configured",
      "XSTARZ_EMAIL_SENDER_ADDRESS must use an Xstarz-owned domain, not a retired third-party domain.",
    );
  }

  return { transport, apiKey, senderAddress, senderName, timeoutMs: readTimeout(env) };
}

function isSupportedTransport(value: string): value is EmailTransportId {
  return value === "resend" || value === "smtp2go" || value === "console";
}

function readTimeout(env: EnvSource): number {
  const raw = env("XSTARZ_EMAIL_TIMEOUT_MS");
  if (raw === undefined) return DEFAULT_DELIVERY_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIVERY_TIMEOUT_MS;
  return Math.min(parsed, 30_000);
}

/** A provider request, built without performing it. Keeps transports testable. */
export type ProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export function buildProviderRequest(
  config: EmailDeliveryConfig,
  email: VerificationEmail,
): ProviderRequest {
  const subject = buildSubject();
  const text = renderVerificationText(email);
  const html = renderVerificationHtml(email);
  const from = `${config.senderName} <${config.senderAddress}>`;

  switch (config.transport) {
    case "resend":
      return {
        url: "https://api.resend.com/emails",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: { from, to: [email.recipient], subject, text, html },
      };

    case "smtp2go":
      return {
        url: "https://api.smtp2go.com/v3/email/send",
        headers: {
          "X-Smtp2go-Api-Key": config.apiKey,
          "content-type": "application/json",
        },
        body: {
          sender: from,
          to: [email.recipient],
          subject,
          text_body: text,
          html_body: html,
        },
      };

    case "console":
      return { url: "", headers: {}, body: { from, to: email.recipient, subject } };
  }
}

/**
 * Subject line.
 *
 * Takes no OTP parameter by design: a subject is rendered in lock-screen and
 * notification previews, so putting the code there would expose it to anyone
 * glancing at the device. Making it impossible to pass is stronger than
 * remembering not to use it.
 */
export function buildSubject(): string {
  return `Your ${XSTARZ_PRODUCT_NAME} verification code`;
}

export function renderVerificationText(email: VerificationEmail): string {
  return [
    `${XSTARZ_PRODUCT_NAME} verification code`,
    "",
    `Your verification code is: ${email.otp}`,
    "",
    `This code expires in ${email.expiryMinutes} minutes and can only be used once.`,
    "",
    "If you did not request this code, you can safely ignore this email.",
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for this code.`,
    "",
    `${XSTARZ_PRODUCT_NAME} — decision-support trading intelligence.`,
  ].join("\n");
}

export function renderVerificationHtml(email: VerificationEmail): string {
  const otp = escapeHtml(email.otp);
  const minutes = String(email.expiryMinutes);

  // Inline styles only: transactional mail clients strip <style> blocks.
  // No tracking pixel, no remote images, no marketing content.
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ',
    'style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;',
    'border:1px solid #e3e8ef;">',
    '<tr><td style="padding:28px 28px 8px 28px;">',
    `<div style="font-size:18px;font-weight:600;color:#0b1f3a;">${XSTARZ_PRODUCT_NAME}</div>`,
    '<div style="font-size:14px;color:#5b6b82;margin-top:4px;">Verification code</div>',
    "</td></tr>",
    '<tr><td style="padding:8px 28px 0 28px;">',
    '<div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1550c5;',
    'background:#eef3ff;border-radius:8px;padding:16px;text-align:center;">',
    otp,
    "</div></td></tr>",
    '<tr><td style="padding:16px 28px 0 28px;font-size:14px;color:#33445c;line-height:1.5;">',
    `This code expires in <strong>${minutes} minutes</strong> and can only be used once.`,
    "</td></tr>",
    '<tr><td style="padding:12px 28px 28px 28px;font-size:13px;color:#6b7a90;line-height:1.5;">',
    "If you did not request this code you can safely ignore this email. ",
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for it.`,
    "</td></tr>",
    "</table></body></html>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Deliver a verification email through the configured Xstarz transport.
 *
 * `env` and `fetchImpl` are injected so the whole path is testable without a
 * network, and so no test needs a real credential.
 */
export async function sendXstarzVerificationEmail(
  email: VerificationEmail,
  options: { env: EnvSource; fetchImpl?: FetchLike; logger?: (message: string) => void } = {
    env: (key) => process.env[key],
  },
): Promise<{ transport: EmailTransportId; delivered: boolean }> {
  const { env, fetchImpl, logger } = options;

  if (!isPlausibleEmailAddress(email.recipient)) {
    // Does not reveal whether the address exists — only that it is malformed.
    throw new EmailDeliveryError("invalid_recipient", "Recipient address is not a valid email address.");
  }

  const config = readEmailDeliveryConfig(env);
  const request = buildProviderRequest(config, email);

  if (config.transport === "console") {
    // Development only. Never prints the OTP: a code in a log is a code in a
    // log aggregator, and this module's whole purpose is to not leak one.
    logger?.(`[email:console] verification code queued for ${maskRecipient(email.recipient)}`);
    return { transport: "console", delivered: true };
  }

  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== "function") {
    throw new EmailDeliveryError("not_configured", "No fetch implementation is available.");
  }

  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), config.timeoutMs)
    : undefined;

  let response: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    response = await doFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller?.signal,
    });
  } catch (error) {
    // The thrown error may embed the request — which carries the OTP and the
    // API key — so it is never re-thrown or interpolated.
    const aborted = isAbortError(error);
    throw new EmailDeliveryError(
      aborted ? "timeout" : "network_error",
      aborted
        ? `Verification email timed out after ${config.timeoutMs}ms.`
        : "Verification email could not be sent: network error.",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (response.ok) return { transport: config.transport, delivered: true };

  // Status only. The provider body can echo the request, including the OTP.
  if (response.status === 429) {
    throw new EmailDeliveryError("rate_limited", "Verification email was rate limited by the provider.", 429);
  }
  throw new EmailDeliveryError(
    "provider_error",
    `Verification email failed (HTTP ${response.status}).`,
    response.status,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** `ab***@example.com` — enough to correlate a support ticket, not to harvest. */
export function maskRecipient(recipient: string): string {
  const at = recipient.indexOf("@");
  if (at <= 0) return "***";
  const local = recipient.slice(0, at);
  const domain = recipient.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}
