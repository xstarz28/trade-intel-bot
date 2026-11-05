const LEGACY_CONVEX_URL = "https://hushed-seal-237.convex.cloud";

/**
 * Identifies the one legacy Convex deployment that may be used only for
 * explicit account export. It is not an application-authentication setting.
 */
export function isActiveConvexUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.origin === LEGACY_CONVEX_URL &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}
