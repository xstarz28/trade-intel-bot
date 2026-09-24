/**
 * Phase 227 — narrowing helpers for provider JSON.
 *
 * Every third-party response enters the codebase as `unknown`. These helpers
 * read a field with a runtime check and return `undefined` when the shape is
 * wrong — never a fabricated default (no `0`, no `""`, no `Date.now()`).
 * Callers decide what a missing field means (usually: unavailable).
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `v[key]` when `v` is an object, else undefined. */
export function field(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Non-empty string or undefined. */
export function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Finite number from a number or numeric string. `NaN`, `Infinity`, `""`,
 * `"-"`, `"None"` and non-numeric strings all yield undefined.
 */
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

export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

/** Array of objects; non-object elements are dropped. */
export function asRecordArray(v: unknown): JsonRecord[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

/** Message of a thrown value without assuming it is an Error. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const m = field(err, "message");
  return typeof m === "string" ? m : String(err);
}
