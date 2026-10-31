export type AuthProviderMode = "convex" | "mock" | "misconfigured";

const ACTIVE_CONVEX_URL = "https://hushed-seal-237.convex.cloud";

export function resolveAuthProviderMode(input: {
  isDevelopment: boolean;
  hasConvexClient: boolean;
}): AuthProviderMode {
  if (input.hasConvexClient) return "convex";
  return input.isDevelopment ? "mock" : "misconfigured";
}

export function isActiveConvexUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.origin === ACTIVE_CONVEX_URL &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}
