const ACTIVE_CONVEX_HOST = "hushed-seal-237.convex.cloud";

export function isAllowedConvexCloudUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === ACTIVE_CONVEX_HOST &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}
