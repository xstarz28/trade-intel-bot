/** Phase 300 final hotfix — Build Output API assembly for prebuilt publication. */

export const VERCEL_CONFIG_FILE: string;
export const BUILD_OUTPUT_DIR: string;
export const BUILD_OUTPUT_STATIC: string;
export const BUILD_OUTPUT_CONFIG_FILE: string;
export const BUILD_OUTPUT_VERSION: number;
export const CONVERTIBLE_VERCEL_JSON_KEYS: string[];
export const FILESYSTEM_HANDLE: string;

export type BuildOutputRoute = { handle: string } | { src: string; dest: string };
export type VerkelRewrite = { source: string; destination: string };

export type RoutingResult =
  | { ok: true; routes: BuildOutputRoute[]; rewrites: VerkelRewrite[]; fallback: boolean }
  | { ok: false; problem: string };

export type ConfigResult =
  | {
      ok: true;
      routes: BuildOutputRoute[];
      rewrites: VerkelRewrite[];
      fallback: boolean;
      config: { version: number; routes: BuildOutputRoute[] };
    }
  | { ok: false; problem: string };

/** Build Output API `routes`, derived from a `vercel.json`'s rewrites. */
export function routesForBuildOutput(vercelJsonText: string): RoutingResult;

/** The full `config.json` object for a `vercel.json`. */
export function buildOutputConfig(vercelJsonText: string): ConfigResult;

export type BuildOutputFile = { path: string; bytes: number; sha256: string };

export type MaterializeResult =
  | {
      ok: true;
      outDir: string;
      configPath: string;
      staticDir: string;
      configText: string;
      config: { version: number; routes: BuildOutputRoute[] };
      routes: BuildOutputRoute[];
      rewrites: VerkelRewrite[];
      fallback: boolean;
      files: number;
      fileList: BuildOutputFile[];
      bytes: number;
      buildInfoSha256: string | null;
      indexPath: string;
    }
  | { ok: false; problem: string };

/**
 * Copy the VERIFIED `dist/` into `.vercel/output/static` and write the routing
 * config derived from `vercel.json`. Never runs a build.
 */
export function materializeBuildOutput(options?: {
  distDir?: string;
  outDir?: string;
  vercelJsonPath?: string;
}): MaterializeResult;

export type OutputCheck = { name: string; ok: boolean; detail: string };

/** Byte-identity + routing + provenance comparison of an assembled output. */
export function verifyBuildOutput(options?: {
  distDir?: string;
  outDir?: string;
  vercelJsonPath?: string;
  expectCommit?: string | null;
  expectBranch?: string | null;
}): { ok: boolean; checks: OutputCheck[]; problems: string[] };

/**
 * `npx <...>` arguments for `vercel deploy --prebuilt` — the only deploy shape
 * this publication uses (a plain directory deploy would trigger a host build).
 */

/** Write `.vercel/project.json` from resolved ids; refuse a disagreeing link. */
export function ensureLocalProjectLink(options?: {
  orgId?: string | null;
  projectId?: string | null;
  linkPath?: string;
}): { ok: true; state: "existing" | "created"; linkPath: string } | { ok: false; problem: string };

export function isFile(path: string): boolean;
