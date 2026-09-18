/**
 * Phase 248 — the Convex function surface a deployment must publish.
 *
 * WHY THIS IS A SEPARATE FILE
 *
 * The deployment-verification contract next door (`convex-deployment-verification.ts`)
 * is pure: it takes the required function set as an argument and never touches
 * the filesystem, so the same package always yields the same decision. But
 * "which functions must a production deployment publish?" is a fact about THIS
 * candidate's source tree, and reading it needs `node:fs`. Splitting the two
 * keeps the validator pure and the scan honest — there is no hand-maintained
 * list of functions here that could silently stop covering one.
 *
 * WHAT THE SURFACE IS
 *
 * Every function the candidate DEFINES under `src/convex` — each
 * `export const <name> = query|mutation|action|internalQuery|internalMutation|
 * internalAction(...)`. That is exactly what `convex deploy` publishes and what
 * `convex function-spec` lists, so a deployment that is missing one is a
 * deployment that did not publish this candidate. The scan is derived, never
 * restated: a function added to the backend is required the moment it exists.
 *
 * Deliberately excluded, because they publish no callable function of their own:
 *   - `_generated/` (generated bindings, not definitions)
 *   - `lib/` (server-only helpers imported by the functions above)
 *   - `schema.ts`, `auth.config.ts` (declarations, not functions)
 *   - `*.test.ts`, `*.d.ts` (tests and types)
 *
 * The reference form is `<module>.<function>` where `<module>` is the path under
 * `src/convex` without its extension (`marketData`, `auth/emailOtp`). That is the
 * same form `api.marketData.fetchMarketData` uses, so an operator can read the
 * required set and the published set side by side.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The backend root the surface is scanned from. */
export const CONVEX_ROOT = "src/convex";

/** Directories under the root that publish no function of their own. */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set(["_generated", "lib"]);

/** Top-level files that are declarations rather than function modules. */
const EXCLUDED_FILES: ReadonlySet<string> = new Set(["schema.ts", "auth.config.ts"]);

/**
 * The definition forms Convex publishes. A `query`/`mutation`/`action` is
 * client-callable (`api.<module>.<fn>`); the `internal*` forms are server-only
 * (`internal.<module>.<fn>`) but are still published and still required: the
 * DEPLOYMENT-HANDOFF gate greps for `consumeResendAllowance`, an internal
 * mutation, precisely because a deployment that omitted it would 404 at runtime.
 */
const FUNCTION_DEFINITION =
  /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*(?:<[^>]*>)?\s*\(/g;

export type ConvexFunctionKind =
  | "query"
  | "mutation"
  | "action"
  | "internalQuery"
  | "internalMutation"
  | "internalAction";

export interface ConvexFunctionReference {
  /** `<module>.<function>` — the form both the required and published sets use. */
  reference: string;
  module: string;
  name: string;
  kind: ConvexFunctionKind;
  /** True for the `internal*` forms, which are server-only but still published. */
  internal: boolean;
}

/** Injectable filesystem access, so the refusal paths are testable. */
export interface SurfaceSource {
  readdir: (dir: string) => { name: string; isDirectory: boolean }[];
  read: (path: string) => string;
}

const defaultSource: SurfaceSource = {
  readdir: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  read: (path) => readFileSync(path, "utf8"),
};

function walk(dir: string, root: string, source: SurfaceSource): string[] {
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = source.readdir(dir);
  } catch {
    // An unreadable directory contributes nothing. The caller decides whether an
    // empty surface is a refusal; this never fabricates functions.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      // Only the top-level excluded dirs are skipped; a nested dir of the same
      // name is not a thing Convex produces, so this stays simple and correct.
      if (dir === root && EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...walk(path, root, source));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.name.includes(".test.")) continue;
    if (dir === root && EXCLUDED_FILES.has(entry.name)) continue;
    files.push(path);
  }
  return files;
}

/**
 * Scan the candidate's backend and return every function it defines, sorted by
 * reference. Deterministic for a given tree; performs no network, no process and
 * no write.
 */
export function scanConvexFunctionSurface(
  root: string = CONVEX_ROOT,
  source: SurfaceSource = defaultSource,
): ConvexFunctionReference[] {
  const files = walk(root, root, source).sort();
  const references: ConvexFunctionReference[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = source.read(file);
    } catch {
      continue;
    }
    const module = relative(root, file).replace(/\.ts$/, "").split(/[\\/]/).join("/");
    FUNCTION_DEFINITION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FUNCTION_DEFINITION.exec(text)) !== null) {
      const [, name, kind] = match as unknown as [string, string, ConvexFunctionKind];
      references.push({
        reference: `${module}.${name}`,
        module,
        name,
        kind,
        internal: kind.startsWith("internal"),
      });
    }
  }
  // Sorted and de-duplicated: two definitions of the same reference in one module
  // would be a compile error Convex itself refuses, so a stable sort is enough.
  return references.sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
}

/** The required references, as the plain `<module>.<function>` strings. */
export function requiredConvexFunctionReferences(
  root: string = CONVEX_ROOT,
  source: SurfaceSource = defaultSource,
): string[] {
  return scanConvexFunctionSurface(root, source).map((entry) => entry.reference);
}
