/**
 * Types for `scripts/lib/executable.mjs` (Phase 300 hotfix).
 *
 * The publication path runs `npm`, `npx` and `git` as child processes. On
 * Windows those names are `.cmd`/`.exe` shims that `spawnSync` cannot start
 * without a shell, which produced a failure with empty stdout and stderr. These
 * declarations let the suite pin the platform mapping and the failure text
 * without deploying anything.
 */

export const EXECUTABLE_CANDIDATES: Record<string, { win32: string[]; default: string[] }>;
export const SHELL_SCRIPT_PATTERN: RegExp;

export type ExecutableResolution = {
  /** The name to run first on this platform. */
  command: string;
  /** Every name that will be tried, in order. */
  candidates: string[];
  platform: string;
  /** True only for a `.cmd`/`.bat` on Windows, where Node requires a shell. */
  shell: boolean;
};

/** `npm` -> `npm.cmd` (Windows) / `npm` (everywhere else), etc. */
export function executableCandidates(command: string, platform?: string): string[];
export function resolveExecutable(command: string, platform?: string): ExecutableResolution;

export type Attempt = { executable: string; shell: boolean; status: number | null; error: string | null };

export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  error: { code?: string } | null;
  executable: string;
  shell: boolean;
  attempts: Attempt[];
  /** Never empty when the command failed: the reason, or the candidates tried. */
  failureText: string | null;
};

export function isMissingExecutable(result: unknown): boolean;
export function describeSpawnFailure(
  result: { status?: number | null; error?: { code?: string; message?: string } | null; stderr?: string | null; signal?: string | null },
  executable: string,
  args?: unknown[],
): string | null;

/**
 * Runs the first candidate that starts. Injectable `spawn`/`platform` so the
 * Windows and Unix paths are both testable without running anything.
 */
export function runCommand(
  command: string,
  args?: string[],
  options?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    platform?: string;
    /** Injected for tests; the real default is `child_process.spawnSync`. */
    spawn?: (command: string, args: string[], options: Record<string, unknown>) => {
      status?: number | null;
      stdout?: string | null;
      stderr?: string | null;
      error?: { code?: string; message?: string } | null;
      signal?: string | null;
    };
    input?: string;
    timeoutMs?: number;
  },
): CommandResult;

/** `git <args>` as a trimmed string, or null when git is absent or failed. */
export function gitOutput(
  args: string[],
  options?: {
    platform?: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
    spawn?: (command: string, args: string[], options: Record<string, unknown>) => {
      status?: number | null;
      stdout?: string | null;
      stderr?: string | null;
      error?: { code?: string; message?: string } | null;
      signal?: string | null;
    };
  },
): string | null;
