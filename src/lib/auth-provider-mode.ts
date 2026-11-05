import { isAllowedConvexCloudUrl } from "./convex-url";

/**
 * Identifies a syntactically valid legacy Convex URL for explicit one-time
 * account export only. It is never an application-authentication setting.
 */
export function isActiveConvexUrl(value: unknown): value is string {
  return isAllowedConvexCloudUrl(value);
}
