/**
 * Phase 300 hotfix — platform-safe executable resolution for child processes.
 *
 * WHY THIS EXISTS
 * ---------------
 * The publication path shells out to `npm` (to build), `npx` (to upload and to
 * alias) and `git` (to read the checkout). On Windows those names are shims:
 * `npm` is `npm.cmd`, `npx` is `npx.cmd`. Node's `spawnSync` does not consult
 * `PATHEXT`, and since Node 18.20/20.12 a `.cmd` cannot be spawned without a
 * shell at all — so `spawnSync("npm", ...)` fails with `ENOENT` (or `EINVAL`),
 * returns `status: null` with EMPTY stdout and stderr, and the caller reports a
 * failure with nothing in it to diagnose. That is exactly the Windows behaviour
 * this module removes.
 *
 * WHAT IT DOES
 * ------------
 *   1. `executableCandidates(command, platform)` — the names to try, in order,
 *      for a command: on Windows the `.cmd`/`.exe` shims first, then the bare
 *      name; elsewhere the bare name only. Unix behaviour is untouched.
 *   2. `runCommand(command, args, options)` — runs the first candidate that
 *      actually starts, marking a `.cmd`/`.bat` for `shell: true` (required by
 *      Node on Windows) and never for anything else. It always returns a
 *      truthful `failureText`, so a failed spawn says WHY instead of returning
 *      empty output.
 *   3. `gitOutput(args)` — the same, for git, with the Windows candidates tried
 *      in order.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It never passes `shell: true` for a real executable, never picks a candidate
 * by guessing that a command "probably exists", and never hides a failure: a
 * command that could not be started reports the error code and the candidate it
 * tried. Since a `.cmd` is run through a shell on Windows, callers that pass
 * user-supplied values must validate them first (see `isHostnameShaped` in the
 * resolver, which the publication uses before aliasing a host).
 */
import { spawnSync } from "node:child_process";

/** Executable names to try per command, per platform family. */
export const EXECUTABLE_CANDIDATES = {
  npm: { win32: ["npm.cmd", "npm"], default: ["npm"] },
  npx: { win32: ["npx.cmd", "npx"], default: ["npx"] },
  node: { win32: ["node.exe", "node"], default: ["node"] },
  git: { win32: ["git.exe", "git.cmd", "git"], default: ["git"] },
};

/** A file Node must run through a shell on Windows. */
export const SHELL_SCRIPT_PATTERN = /\.(?:cmd|bat)$/i;

/**
 * The candidate names for a command. Unknown commands resolve to themselves —
 * this helper maps the known shims and does not pretend to know others.
 */
export function executableCandidates(command, platform = process.platform) {
  const known = EXECUTABLE_CANDIDATES[command];
  if (!known) return [command];
  return platform === "win32" ? [...known.win32] : [...known.default];
}

/**
 * The executable to run first, and whether it needs a shell.
 *
 * `shell` is true only for a `.cmd`/`.bat` ON WINDOWS — the one case Node
 * requires it — and false everywhere else, so a POSIX run is byte-for-byte the
 * call it always was.
 */
export function resolveExecutable(command, platform = process.platform) {
  const candidates = executableCandidates(command, platform);
  const command_ = candidates[0];
  return {
    command: command_,
    candidates,
    platform,
    shell: platform === "win32" && SHELL_SCRIPT_PATTERN.test(command_),
  };
}

/** True when the failure means "that executable is not there / not runnable". */
export function isMissingExecutable(result) {
  const code = result?.error?.code;
  return code === "ENOENT" || code === "EINVAL" || code === "EACCES";
}

/**
 * One sentence explaining a failed child process — never empty, because an
 * empty failure is what made the Windows symptom undiagnosable.
 */
export function describeSpawnFailure(result, executable, args = []) {
  const shown = args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : "";
  const code = result?.error?.code;
  if (code) {
    return `${executable}${shown} could not be started (${code}: ${result.error?.message ?? "no message"})`;
  }
  if (typeof result?.status === "number" && result.status !== 0) {
    const tail = String(result.stderr ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
    return `${executable}${shown} exited with code ${result.status}${tail ? `: ${tail}` : ""}`;
  }
  if (result?.signal) return `${executable}${shown} was killed by ${result.signal}`;
  return null;
}

/**
 * Run a command, trying its platform candidates in order.
 *
 * Returns the same `{ status, stdout, stderr }` shape the publication already
 * used, plus the evidence of what was attempted: `executable`, `shell`,
 * `attempts` and `failureText`. The first candidate that STARTS is the one to
 * keep — a non-zero exit is a real result, not a reason to try a different
 * binary.
 */
export function runCommand(
  command,
  args = [],
  {
    env = process.env,
    cwd = process.cwd(),
    platform = process.platform,
    spawn = spawnSync,
    input,
    timeoutMs,
  } = {},
) {
  const candidates = executableCandidates(command, platform);
  const attempts = [];
  for (const candidate of candidates) {
    const needsShell = platform === "win32" && SHELL_SCRIPT_PATTERN.test(candidate);
    const result = spawn(candidate, args, {
      env,
      cwd,
      encoding: "utf8",
      shell: needsShell,
      windowsHide: true,
      ...(input === undefined ? {} : { input }),
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    });
    attempts.push({
      executable: candidate,
      shell: needsShell,
      status: typeof result?.status === "number" ? result.status : null,
      error: result?.error?.code ?? null,
    });
    if (!isMissingExecutable(result)) {
      return {
        status: typeof result?.status === "number" ? result.status : 1,
        stdout: result?.stdout ?? "",
        stderr: result?.stderr ?? "",
        error: result?.error ?? null,
        executable: candidate,
        shell: needsShell,
        attempts,
        failureText: describeSpawnFailure(result, candidate, args),
      };
    }
  }
  const last = attempts[attempts.length - 1];
  return {
    status: 1,
    stdout: "",
    stderr: "",
    error: last ? { code: last.error } : null,
    executable: last?.executable ?? command,
    shell: last?.shell ?? false,
    attempts,
    failureText: `could not run "${command}" on ${platform}: ${attempts
      .map((a) => `${a.executable} -> ${a.error ?? `exit ${a.status}`}`)
      .join("; ")}`,
  };
}

/** `git <args>` as a string, or `null` when git is absent or the command failed. */
export function gitOutput(args, options = {}) {
  const result = runCommand("git", args, { ...options, ...(options.input === undefined ? {} : {}) });
  if (result.status !== 0) return null;
  return String(result.stdout ?? "").trim();
}
