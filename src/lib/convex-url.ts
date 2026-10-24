const RETIRED_CONVEX_HOSTS = new Set([
  "tough-goose-455.convex.cloud",
  "pleasant-curlew-264.convex.cloud",
  "calculating-eagle-241.convex.cloud",
]);

export function isAllowedConvexCloudUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      url.hostname.endsWith(".convex.cloud") &&
      !RETIRED_CONVEX_HOSTS.has(url.hostname.toLowerCase()) &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}
