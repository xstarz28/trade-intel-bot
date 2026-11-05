import { isAllowedConvexCloudUrl } from "./convex-url";

/**
 * Validates the optional legacy Convex URL used only for one-time account
 * export. Application authentication and market data never depend on it.
 */
export function isActiveConvexUrl(value: unknown): value is string {
  return isAllowedConvexCloudUrl(value);
}
