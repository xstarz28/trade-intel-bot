/**
 * Owner-principal configuration (pure).
 *
 * OWNER is not a stored plan and not a client flag. The Convex handlers
 * compare an *already authenticated* principal (Convex `users` document id
 * and/or email) against a server-only environment list. This module never
 * reads `process.env` itself so a client import cannot inline the secret.
 *
 * Parsing is fail-closed: unset/empty matches nobody; any malformed entry
 * rejects the whole list so a typo cannot grant access. Matching is exact
 * (no globs, no regex, no substring, no role=admin).
 */

export const OWNER_PRINCIPALS_ENV = "XSTARZ_OWNER_PRINCIPALS";

export type OwnerPrincipal =
  | { readonly kind: "email"; readonly value: string }
  | { readonly kind: "user"; readonly value: string };

export type OwnerPrincipalConfig =
  | { readonly status: "empty"; readonly principals: readonly [] }
  | { readonly status: "ok"; readonly principals: readonly OwnerPrincipal[] }
  | { readonly status: "malformed"; readonly principals: readonly [] };

export interface OwnerIdentity {
  readonly userId?: string | null;
  readonly email?: string | null;
}

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function emptyConfig(): OwnerPrincipalConfig {
  return { status: "empty", principals: [] };
}

function malformedConfig(): OwnerPrincipalConfig {
  return { status: "malformed", principals: [] };
}

function parseOne(token: string): OwnerPrincipal | null {
  const sep = token.indexOf(":");
  if (sep <= 0) return null;
  const scheme = token.slice(0, sep).trim().toLowerCase();
  const raw = token.slice(sep + 1).trim();
  if (!raw) return null;
  // Globs / regex / wildcards are never owners. Fail closed.
  if (/[*?[\]{}()\\]/.test(raw)) return null;

  if (scheme === "email") {
    const email = raw.toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return null;
    if (email.length > 254) return null;
    return { kind: "email", value: email };
  }

  if (scheme === "user") {
    // Convex `users` document id — not a JWT subject, not an email.
    if (!USER_ID_PATTERN.test(raw)) return null;
    if (raw.length > 128) return null;
    return { kind: "user", value: raw };
  }

  return null;
}

/**
 * Parse `XSTARZ_OWNER_PRINCIPALS`.
 *
 * Format: comma-separated `email:<addr>` and/or `user:<convexUserId>`.
 * Whitespace around tokens is ignored. A single bad token invalidates the
 * entire configuration (no partial grant).
 */
export function parseOwnerPrincipals(
  raw: string | undefined | null,
): OwnerPrincipalConfig {
  if (raw == null) return emptyConfig();
  const trimmed = raw.trim();
  if (trimmed.length === 0) return emptyConfig();

  const tokens = trimmed.split(",");
  const principals: OwnerPrincipal[] = [];
  let sawToken = false;
  for (const piece of tokens) {
    const token = piece.trim();
    if (token.length === 0) continue;
    sawToken = true;
    const parsed = parseOne(token);
    if (!parsed) return malformedConfig();
    principals.push(parsed);
  }
  if (!sawToken) return emptyConfig();
  return { status: "ok", principals };
}

/** True only when the authenticated identity exactly matches a valid config. */
export function matchOwnerPrincipal(
  identity: OwnerIdentity,
  config: OwnerPrincipalConfig,
): boolean {
  if (config.status !== "ok") return false;

  const userId = typeof identity.userId === "string" ? identity.userId.trim() : "";
  const email =
    typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (!userId && !email) return false;

  for (const principal of config.principals) {
    if (principal.kind === "email") {
      if (email && email === principal.value) return true;
    } else if (userId && userId === principal.value) {
      return true;
    }
  }
  return false;
}

export function isConfiguredOwner(
  identity: OwnerIdentity,
  rawEnvValue: string | undefined | null,
): boolean {
  return matchOwnerPrincipal(identity, parseOwnerPrincipals(rawEnvValue));
}
