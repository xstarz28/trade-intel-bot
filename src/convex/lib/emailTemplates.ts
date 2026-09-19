/**
 * Transactional email templates for Xstarz Analysis.
 *
 * Pure rendering. No environment access, no network, no credentials. The
 * delivery module (`emailDelivery.ts`) owns transport, fail-closed production
 * policy and provider requests.
 *
 * A future Xstarz-owned domain replaces the configured sender address only.
 * These templates never embed a From address; the display name is branded
 * Xstarz regardless of which provider mailbox actually sends.
 */

/** Product name in the email. Never a vendor name. */
export const XSTARZ_PRODUCT_NAME = "Xstarz Analysis";

export type VerificationEmailContent = {
  recipient: string;
  otp: string;
  expiryMinutes: number;
};

export type SecurityAlertEmailContent = {
  recipient: string;
  /**
   * Short, non-secret label for the event (e.g. "new sign-in"). Never an OTP,
   * never a credential, never a raw session token.
   */
  event: string;
};

export type RenderedTransactionalEmail = {
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * RFC 5322 display-name + address. The mailbox is whatever the operator
 * configured (`XSTARZ_EMAIL_SENDER_ADDRESS`); the visible name is Xstarz.
 */
export function formatSenderHeader(displayName: string, address: string): string {
  const name = displayName.trim() || XSTARZ_PRODUCT_NAME;
  return `${name} <${address}>`;
}

/**
 * Subject for OTP mail. Takes no OTP parameter: lock-screen previews would
 * otherwise expose the code.
 */
export function buildVerificationSubject(): string {
  return `Your ${XSTARZ_PRODUCT_NAME} verification code`;
}

export function buildSecurityAlertSubject(): string {
  return `${XSTARZ_PRODUCT_NAME} security notice`;
}

export function renderVerificationText(email: VerificationEmailContent): string {
  return [
    `${XSTARZ_PRODUCT_NAME} verification code`,
    "",
    `Your verification code is: ${email.otp}`,
    "",
    `This code expires in ${email.expiryMinutes} minutes and can only be used once.`,
    "",
    "Do not share this code with anyone.",
    "If you did not request this code, you can safely ignore this email.",
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for this code.`,
    "",
    `${XSTARZ_PRODUCT_NAME} — decision-support trading intelligence.`,
  ].join("\n");
}

export function renderVerificationHtml(email: VerificationEmailContent): string {
  const otp = escapeHtml(email.otp);
  const minutes = escapeHtml(String(email.expiryMinutes));
  const inner = [
    '<div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1550c5;',
    "background:#eef3ff;border-radius:8px;padding:16px;text-align:center;\">",
    otp,
    "</div>",
    '<p style="margin:16px 0 0 0;font-size:14px;color:#33445c;line-height:1.5;">',
    `This code expires in <strong>${minutes} minutes</strong> and can only be used once.`,
    "</p>",
    '<p style="margin:12px 0 0 0;font-size:13px;color:#6b7a90;line-height:1.5;">',
    "Do not share this code with anyone. ",
    "If you did not request this code you can safely ignore this email. ",
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for it.`,
    "</p>",
  ].join("");
  return transactionalShell("Verification code", inner);
}

export function renderSecurityAlertText(email: SecurityAlertEmailContent): string {
  return [
    `${XSTARZ_PRODUCT_NAME} security notice`,
    "",
    `We recorded this account event: ${email.event}.`,
    "",
    `If this was you, no action is required.`,
    `If you did not do this, sign in to ${XSTARZ_PRODUCT_NAME} and review your recent activity.`,
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for a verification code or password.`,
    "",
    `${XSTARZ_PRODUCT_NAME} — decision-support trading intelligence.`,
  ].join("\n");
}

export function renderSecurityAlertHtml(email: SecurityAlertEmailContent): string {
  const event = escapeHtml(email.event);
  const inner = [
    '<p style="margin:0;font-size:14px;color:#33445c;line-height:1.5;">',
    `We recorded this account event: <strong>${event}</strong>.`,
    "</p>",
    '<p style="margin:12px 0 0 0;font-size:13px;color:#6b7a90;line-height:1.5;">',
    "If this was you, no action is required. ",
    `If you did not do this, sign in to ${XSTARZ_PRODUCT_NAME} and review your recent activity. `,
    `Nobody from ${XSTARZ_PRODUCT_NAME} will ever ask you for a verification code or password.`,
    "</p>",
  ].join("");
  return transactionalShell("Security notice", inner);
}

export function renderVerificationMessage(
  email: VerificationEmailContent,
): RenderedTransactionalEmail {
  return {
    recipient: email.recipient,
    subject: buildVerificationSubject(),
    text: renderVerificationText(email),
    html: renderVerificationHtml(email),
  };
}

export function renderSecurityAlertMessage(
  email: SecurityAlertEmailContent,
): RenderedTransactionalEmail {
  return {
    recipient: email.recipient,
    subject: buildSecurityAlertSubject(),
    text: renderSecurityAlertText(email),
    html: renderSecurityAlertHtml(email),
  };
}

function transactionalShell(subtitle: string, inner: string): string {
  const heading = escapeHtml(XSTARZ_PRODUCT_NAME);
  const sub = escapeHtml(subtitle);
  // Inline styles only: transactional mail clients strip <style> blocks.
  // No tracking pixel, no remote images, no marketing content.
  return [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;',
    "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;\">",
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ',
    'style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;',
    'border:1px solid #e3e8ef;">',
    '<tr><td style="padding:28px 28px 8px 28px;">',
    `<div style="font-size:18px;font-weight:600;color:#0b1f3a;">${heading}</div>`,
    `<div style="font-size:14px;color:#5b6b82;margin-top:4px;">${sub}</div>`,
    "</td></tr>",
    '<tr><td style="padding:8px 28px 28px 28px;">',
    inner,
    "</td></tr>",
    "</table></body></html>",
  ].join("");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
