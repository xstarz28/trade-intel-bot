/**
 * Phase 227 — narrowing helpers for provider JSON on the client/lib side.
 * Mirror of src/convex/lib/json.ts (Convex functions cannot import from
 * outside src/convex without bundling the whole lib tree; keeping two small
 * copies is the deliberate trade-off). Never fabricates a default.
 */
export type JsonRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function field(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "" || t === "-") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asRecordArray(v: unknown): JsonRecord[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const m = field(err, "message");
  return typeof m === "string" ? m : String(err);
}
