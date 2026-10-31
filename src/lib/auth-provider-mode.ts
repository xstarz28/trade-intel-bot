export type AuthProviderMode = "convex" | "mock" | "misconfigured";

export function resolveAuthProviderMode(input: {
  isDevelopment: boolean;
  hasConvexClient: boolean;
}): AuthProviderMode {
  if (input.hasConvexClient) return "convex";
  return input.isDevelopment ? "mock" : "misconfigured";
}

export function isActiveConvexUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^https:\/\/hushed-seal-237\.convex\.cloud\/?$/.test(value.trim());
}
