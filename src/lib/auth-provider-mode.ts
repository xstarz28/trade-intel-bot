export type AuthProviderMode = "convex" | "mock" | "misconfigured";

export function resolveAuthProviderMode(input: {
  isDevelopment: boolean;
  hasConvexClient: boolean;
}): AuthProviderMode {
  if (input.hasConvexClient) return "convex";
  return input.isDevelopment ? "mock" : "misconfigured";
}
