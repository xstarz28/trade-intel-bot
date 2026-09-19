/**
 * Phase 169 — Post-authentication redirect safety.
 *
 * `?returnTo=` is attacker-controllable: anyone can send a user a link to our
 * own sign-in page carrying any value they like. If that value can escape to
 * another origin, we have an open redirect — the user signs in on our real
 * domain, sees our real branding, and is then dropped on a page the attacker
 * controls. For a product that handles trading accounts that is a credible
 * phishing vector, so the rule here is allowlist-shaped: a candidate must
 * prove it is a same-origin, absolute, single-slash path or it is discarded.
 *
 * The naive check `startsWith("/") && !startsWith("//")` is NOT sufficient:
 *   "/\evil.com"   — browsers normalise "\" to "/", making this protocol-relative
 *   "/\/evil.com"  — same
 *   "/\tevil"      — control characters are stripped before parsing
 * All three pass the naive check and all three leave the origin.
 */

/** Where users land when no safe destination was supplied. */
export const DEFAULT_REDIRECT = "/dashboard";

/**
 * Routes the app actually serves. A returnTo pointing anywhere else is not
 * useful and is more likely to be probing than a genuine deep link.
 */
const KNOWN_ROUTE_PREFIXES = ["/dashboard", "/journal", "/"] as const;

/** Characters that browsers strip or normalise before resolving a URL. */
// eslint-disable-next-line no-control-regex
const STRIPPED_OR_NORMALISED = /[\u0000-\u001F\u007F\s\\]/;

/**
 * Returns a safe same-origin path, or the fallback.
 *
 * @param returnTo   untrusted candidate, typically from a query parameter
 * @param fallback   destination when the candidate is unusable
 */
export function resolveSafeRedirect(
  returnTo: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (typeof returnTo !== "string") return fallback;

  const candidate = returnTo.trim();
  if (candidate.length === 0) return fallback;

  // Must be an absolute path on this origin.
  if (!candidate.startsWith("/")) return fallback;

  // "//host" and "/\host" both resolve to another origin.
  if (candidate.startsWith("//")) return fallback;

  // Reject anything containing a character the browser would strip or
  // normalise, since our checks would then be validating a different string
  // from the one actually navigated to.
  if (STRIPPED_OR_NORMALISED.test(candidate)) return fallback;

  // A scheme cannot appear in a path-only redirect.
  if (candidate.includes(":")) return fallback;

  // Defence in depth: resolve against a throwaway origin and confirm it did
  // not escape. This catches normalisation tricks the string checks miss.
  let resolved: URL;
  try {
    resolved = new URL(candidate, "https://xstarz.invalid");
  } catch {
    return fallback;
  }
  if (resolved.origin !== "https://xstarz.invalid") return fallback;

  // Only accept destinations the app actually serves, so a stale or probing
  // link degrades to the dashboard rather than the not-found page.
  const path = resolved.pathname;
  const known = KNOWN_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!known) return fallback;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
