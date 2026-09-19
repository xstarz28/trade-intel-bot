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

import { DEPLOYMENT_ENV_VAR, isProductionDeployment } from "./deploymentEnvironment";
import { RETIRED_ISSUER_HOSTS } from "./issuerPolicy";
import {
  XSTARZ_PRODUCT_NAME,
  formatSenderHeader,
  renderSecurityAlertMessage,
  renderVerificationMessage,
  type SecurityAlertEmailContent,
} from "./emailTemplates";

export { XSTARZ_PRODUCT_NAME } from "./emailTemplates";
export {
  buildVerificationSubject as buildSubject,
  formatSenderHeader,
  renderSecurityAlertHtml,
  renderSecurityAlertText,
  renderVerificationHtml,
  renderVerificationText,
} from "./emailTemplates";

/** Transports supported today. Provider-neutral by construction. */
export type EmailTransportId = "resend" | "smtp2go" | "console";

/** Transports that do not actually deliver mail. Never valid in production. */
export const NON_DELIVERING_TRANSPORTS: readonly EmailTransportId[] = ["console"];

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

export type SecurityAlertEmail = SecurityAlertEmailContent;

export const DEFAULT_DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Sender domains production must never send OTP mail from.
 *
 * Phase 214 — this list previously covered only the Freebuff hosts, while
 * `RETIRED_ISSUER_HOSTS` in issuerPolicy.ts also retires `vly.ai`. A production
 * deployment therefore ACCEPTED `noreply@vly.ai` as an OTP sender: the auth
 * issuer was retired but the sending identity was not. The two lists are now
 * consistent by construction — `vly.ai` is imported from the issuer policy
 * rather than copied, so retiring a host in one place retires it in both.
 *
 * `auth.freebuff.app` is retained explicitly: it is the leaked-credential
 * issuer, and naming it produces a clearer error than the suffix rule alone.
 */
export const FORBIDDEN_DELIVERY_HOSTS = ["auth.freebuff.app", ...RETIRED_ISSUER_HOSTS];

/**
 * Provider-shared test sending identities (not Xstarz-owned, not production
 * verified). Resend's `resend.dev` mailbox can only deliver to the Resend
 * account owner and cannot serve production OTP to arbitrary users.
 *
 * These are NOT retired Freebuff/VLY hosts. They are refused in production
 * only, so a development/preview smoke test can still use a temporary Resend
 * test sender without pretending it is an Xstarz domain.
 */
export const PROVIDER_SHARED_TEST_SENDER_HOSTS: readonly string[] = ["resend.dev"];

export function isSharedTestSenderHost(host: string): boolean {
  const normalised = host.trim().toLowerCase();
  return PROVIDER_SHARED_TEST_SENDER_HOSTS.some(
    (entry) => normalised === entry || normalised.endsWith(`.${entry}`),
  );
}

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

  // The console transport delivers NOTHING while reporting success. That is
  // useful locally and catastrophic in production: sign-in would appear to
  // work while no user ever receives a code, and — worse — any address could
  // be "verified" by a code that was never sent to it.
  //
  // A comment saying "local development only" is not a control. The
  // configuration path itself must refuse it, and it must refuse by default
  // (an unset XSTARZ_DEPLOYMENT_ENV resolves to production).
  if (transport === "console") {
    if (isProductionDeployment(env)) {
      throw new EmailDeliveryError(
        "not_configured",
        'The "console" email transport delivers nothing and is forbidden in production. ' +
          `Set XSTARZ_EMAIL_TRANSPORT to a real transport (resend, smtp2go), or set ` +
          `${DEPLOYMENT_ENV_VAR} to "development" or "preview" if this is not production.`,
      );
    }
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

  // Provider test mailboxes (e.g. onboarding@resend.dev) are not Xstarz-owned
  // and cannot deliver production OTP to arbitrary recipients. Fail closed in
  // production; development/preview may use them as a temporary sender.
  if (isProductionDeployment(env) && isSharedTestSenderHost(senderHost)) {
    throw new EmailDeliveryError(
      "not_configured",
      "XSTARZ_EMAIL_SENDER_ADDRESS is a provider shared test identity, not an Xstarz-owned domain. " +
        "Production OTP cannot use it. Set a verified sender on a domain Xstarz controls, " +
        `or set ${DEPLOYMENT_ENV_VAR} to "development" or "preview" for a temporary test sender.`,
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

export type OutboundEmail = {
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

export function buildProviderRequest(
  config: EmailDeliveryConfig,
  email: VerificationEmail,
): ProviderRequest {
  return buildOutboundRequest(config, renderVerificationMessage(email));
}

export function buildOutboundRequest(
  config: EmailDeliveryConfig,
  email: OutboundEmail,
): ProviderRequest {
  const from = formatSenderHeader(config.senderName, config.senderAddress);

  switch (config.transport) {
    case "resend":
      return {
        url: "https://api.resend.com/emails",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: {
          from,
          to: [email.recipient],
          subject: email.subject,
          text: email.text,
          html: email.html,
        },
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
          subject: email.subject,
          text_body: email.text,
          html_body: email.html,
        },
      };

    case "console":
      return { url: "", headers: {}, body: { from, to: email.recipient, subject: email.subject } };
  }
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type SendEmailOptions = {
  env: EnvSource;
  fetchImpl?: FetchLike;
  logger?: (message: string) => void;
};

/**
 * Deliver a verification email through the configured Xstarz transport.
 *
 * `env` and `fetchImpl` are injected so the whole path is testable without a
 * network, and so no test needs a real credential.
 */
export async function sendXstarzVerificationEmail(
  email: VerificationEmail,
  options: SendEmailOptions = {
    env: (key) => process.env[key],
  },
): Promise<{ transport: EmailTransportId; delivered: boolean }> {
  return sendRenderedEmail(renderVerificationMessage(email), "verification", options);
}

/**
 * Deliver a security/account notice through the same transport and sender
 * policy as OTP mail. Future notifications reuse this path; they do not
 * introduce a second provider or a Freebuff fallback.
 */
export async function sendXstarzSecurityAlertEmail(
  email: SecurityAlertEmail,
  options: SendEmailOptions = {
    env: (key) => process.env[key],
  },
): Promise<{ transport: EmailTransportId; delivered: boolean }> {
  return sendRenderedEmail(renderSecurityAlertMessage(email), "security notice", options);
}

async function sendRenderedEmail(
  email: OutboundEmail,
  kind: string,
  options: SendEmailOptions,
): Promise<{ transport: EmailTransportId; delivered: boolean }> {
  const { env, fetchImpl, logger } = options;

  if (!isPlausibleEmailAddress(email.recipient)) {
    // Does not reveal whether the address exists — only that it is malformed.
    throw new EmailDeliveryError("invalid_recipient", "Recipient address is not a valid email address.");
  }

  const config = readEmailDeliveryConfig(env);
  const request = buildOutboundRequest(config, email);

  if (config.transport === "console") {
    // Development only. Never prints the OTP or event payload: a code in a
    // log is a code in a log aggregator, and this module's whole purpose is
    // to not leak one.
    logger?.(`[email:console] ${kind} queued for ${maskRecipient(email.recipient)}`);
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
        ? `${kind} email timed out after ${config.timeoutMs}ms.`
        : `${kind} email could not be sent: network error.`,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (response.ok) return { transport: config.transport, delivered: true };

  // Status only. The provider body can echo the request, including the OTP.
  if (response.status === 429) {
    throw new EmailDeliveryError("rate_limited", `${kind} email was rate limited by the provider.`, 429);
  }
  throw new EmailDeliveryError(
    "provider_error",
    `${kind} email failed (HTTP ${response.status}).`,
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
