/**
 * Test helper — extracts getNestedValue for test access.
 * This mirrors the internal utility in index.ts.
 */
export function getNestedValue(
  obj: unknown,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object")
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}
