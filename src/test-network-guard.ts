/**
 * Phase 237 — the default test suite cannot reach the external network.
 *
 * WHY THIS EXISTS
 * Phase 181 tried to make the default suite hermetic by *scanning test sources*
 * for a hardcoded list of provider hostnames. That detector is structural, not
 * behavioural, and it missed real leaks:
 *
 *   - `live-provider-verification.phase54.test.ts` calls `verifyProvider()`,
 *     which reaches `fetch()` inside `market-radar/verification.ts`. The URL is
 *     built in production code, so no hostname literal appears in the test and
 *     the scan saw nothing. Phase 54 ran in `npm test` and made 29 real
 *     outbound requests.
 *   - `market-radar/derivatives-bridge.phase226.test.ts` leaked one too.
 *   - The scan short-circuited on any file containing `vi.mock(`, so a single
 *     mock excused every other call in that file.
 *
 * A list of hostnames can only catch the leaks somebody already thought of.
 * This module enforces the boundary at execution time instead: with the guard
 * installed, an outbound connection to anything that is not loopback FAILS,
 * whatever API the test (or the production helper it calls) reaches for.
 *
 * THE BOUNDARY
 *   - Loopback (`localhost`, `*.localhost`, 127.0.0.0/8, `::1`) is allowed, so
 *     a test may stand up its own local server.
 *   - Everything else is refused before any I/O happens, so the result does not
 *     depend on this machine's network access, on a provider's uptime, or on a
 *     rate limit. A test that depends on a live response fails here — every
 *     time, everywhere — instead of passing locally and failing on CI.
 *
 * IMPORTANT: allowing a hostname that merely *ends* in `.localhost` is safe by
 * construction — RFC 6761 reserves that name, resolvers map it to loopback
 * rather than to any real host — while `localhost.evil.com` and
 * `127.0.0.1.evil.com` are refused (see the edge-case tests).
 *
 * This file is test infrastructure. Nothing under `src/` outside test setup and
 * test files imports it, and it is never bundled into the application.
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** The only way to run the live suite. Any other value leaves the guard on. */
export const LIVE_OPT_IN_ENV = "LIVE_PROVIDER_VERIFICATION";
export const LIVE_OPT_IN_VALUE = "1";

/** Documented command that sets it. */
export const LIVE_RUN_COMMAND = `${LIVE_OPT_IN_ENV}=${LIVE_OPT_IN_VALUE} npm run test:live`;

/**
 * Set to the value above to run the live provider suite. Deliberately strict:
 * a stray `LIVE_PROVIDER_VERIFICATION=true`, `=yes`, or `=0` does NOT open the
 * boundary, so a typo in CI cannot switch the default suite into live mode.
 */
export function isLiveOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_OPT_IN_ENV] === LIVE_OPT_IN_VALUE;
}

/** Thrown instead of connecting. Named, so assertions cannot confuse it with a provider outage. */
export class ExternalNetworkBlockedError extends Error {
  readonly code = "ERR_EXTERNAL_NETWORK_BLOCKED";
  readonly api: string;
  readonly target: string;

  constructor(api: string, target: string) {
    super(
      `External network access is blocked in the default test suite.\n` +
        `  attempted via : ${api}\n` +
        `  target      : ${target}\n` +
        `The default suite must be hermetic: its result may not depend on a third ` +
        `party's uptime, rate limits or this machine's connectivity. Move the test to ` +
        `a *.live.test.ts file and run the live suite explicitly:\n` +
        `  ${LIVE_RUN_COMMAND}`,
    );
    this.name = "ExternalNetworkBlockedError";
    this.api = api;
    this.target = target;
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * True only for addresses that cannot leave this machine.
 *
 * `""` means "no host was specified", which for `http.request({port})`,
 * `net.connect({port})` and `tls.connect({port})` is Node's documented
 * loopback default — not an external target.
 */
export function isLoopbackHost(rawHost: string | null): boolean {
  const host = (rawHost ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;

  const ipv4 = IPV4.exec(host);
  if (ipv4) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
    if (octets.some((o) => o > 255)) return false;
    return octets[0] === 127;
  }
  return false;
}

/** Hostname of an absolute URL, or null when it cannot be parsed. */
export function hostOfUrl(input: unknown): string | null {
  const raw =
    typeof input === "string"
      ? input
      : typeof URL !== "undefined" && input instanceof URL
        ? input.href
        : typeof input === "object" && input !== null && "url" in input
          ? String((input as { url: unknown }).url)
          : null;
  if (raw === null) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

/** A socket-style argument list: options object, or (port, host). */
function hostOfSocketArgs(args: unknown[]): string | null {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const host = (first as { host?: unknown; hostname?: unknown }).host;
    if (typeof host === "string") return host;
    const hostname = (first as { hostname?: unknown }).hostname;
    if (typeof hostname === "string") return hostname;
    // Unix socket path, or port only — both local.
    if (typeof (first as { path?: unknown }).path === "string") return "localhost";
    if (typeof (first as { port?: unknown }).port === "number") return "localhost";
    return null;
  }
  if (typeof first === "number" || typeof first === "string") {
    // (port, host) / (path, cb)
    return typeof args[1] === "string" ? args[1] : "localhost";
  }
  return null;
}

function blockedError(api: string, target: string): ExternalNetworkBlockedError {
  return new ExternalNetworkBlockedError(api, target);
}

interface Patched {
  restore: () => void;
}

let handle: GuardedNetwork | null = null;

class GuardedNetwork {
  readonly patches: Patched[] = [];
  restore(): void {
    for (const patch of this.patches) patch.restore();
    this.patches.length = 0;
    handle = null;
  }
}

/** True while the guard is installed in this process. */
export function isNetworkGuardInstalled(): boolean {
  return handle !== null;
}

/**
 * Replaces every outbound-network entry point with a refusing one.
 *
 * Deliberately not a hostname allowlist: the rule is the loopback boundary, so
 * a provider nobody has heard of is refused exactly like the ones this repo
 * happens to use today.
 */
export function installNetworkGuard(): GuardedNetwork {
  if (handle) return handle;

  const guard = new GuardedNetwork();
  handle = guard;

  // ── fetch (undici) ──
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function guardedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const host = hostOfUrl(input);
      // Fail closed: an unparseable target is not evidence of a local one.
      if (host === null || !isLoopbackHost(host)) {
        return Promise.reject(blockedError("fetch", describeTarget(input, host)));
      }
      return originalFetch.call(globalThis, input, init);
    } as typeof globalThis.fetch;
    guard.patches.push({
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    });
  }

  // ── http / https ──
  for (const [name, mod] of [
    ["http", http] as const,
    ["https", https] as const,
  ]) {
    for (const method of ["request", "get"] as const) {
      const original = mod[method] as (...a: unknown[]) => unknown;
      (mod as unknown as Record<string, unknown>)[method] = function guarded(
        ...args: unknown[]
      ): unknown {
        const urlArg = args.find((a) => a instanceof URL || typeof a === "string");
        const host =
          urlArg === undefined ? hostOfSocketArgs(args) : hostOfUrl(urlArg);
        if (host === null || !isLoopbackHost(host)) {
          throw blockedError(`${name}.${method}`, describeTarget(urlArg ?? args[0], host));
        }
        return original.apply(mod, args);
      };
      guard.patches.push({
        restore: () => {
          (mod as unknown as Record<string, unknown>)[method] = original;
        },
      });
    }
  }

  // ── raw sockets ──
  const socketTargets: Array<[string, Record<string, unknown>, string]> = [
    ["net", net as unknown as Record<string, unknown>, "connect"],
    ["net", net as unknown as Record<string, unknown>, "createConnection"],
    ["tls", tls as unknown as Record<string, unknown>, "connect"],
  ];
  for (const [name, mod, method] of socketTargets) {
    const original = mod[method] as (...a: unknown[]) => unknown;
    mod[method] = function guarded(...args: unknown[]): unknown {
      const host = hostOfSocketArgs(args);
      if (host === null || !isLoopbackHost(host)) {
        throw blockedError(`${name}.${method}`, describeTarget(args[0], host));
      }
      return original.apply(mod, args);
    };
    guard.patches.push({
      restore: () => {
        mod[method] = original;
      },
    });
  }

  // ── name resolution ──
  const lookup = dns.lookup as unknown as (...a: unknown[]) => unknown;
  (dns as unknown as Record<string, unknown>).lookup = function guarded(
    hostname: unknown,
    ...rest: unknown[]
  ): unknown {
    if (typeof hostname === "string" && !isLoopbackHost(hostname)) {
      const cb = rest[rest.length - 1];
      const err = blockedError("dns.lookup", hostname);
      if (typeof cb === "function") {
        (cb as (e: Error) => void)(err);
        return undefined;
      }
      throw err;
    }
    return lookup.call(dns, hostname, ...rest);
  };
  guard.patches.push({
    restore: () => {
      (dns as unknown as Record<string, unknown>).lookup = lookup;
    },
  });

  // The promise API is a separate object — patching `dns.lookup` above does not
  // cover `dns.promises.lookup`, which is its own bypass route.
  const promises = dns.promises as unknown as { lookup: (...a: unknown[]) => unknown };
  const lookupPromise = promises.lookup;
  promises.lookup = function guarded(hostname: unknown, ...rest: unknown[]): unknown {
    if (typeof hostname === "string" && !isLoopbackHost(hostname)) {
      return Promise.reject(blockedError("dns.promises.lookup", hostname));
    }
    return lookupPromise.call(promises, hostname, ...rest);
  };
  guard.patches.push({
    restore: () => {
      promises.lookup = lookupPromise;
    },
  });

  // ── WebSocket (undici's global) ──
  const OriginalWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (typeof OriginalWebSocket === "function") {
    class GuardedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const host = hostOfUrl(url);
        if (host === null || !isLoopbackHost(host)) {
          throw blockedError("WebSocket", describeTarget(url, host));
        }
        super(url, protocols);
      }
    }
    (globalThis as { WebSocket?: unknown }).WebSocket = GuardedWebSocket;
    guard.patches.push({
      restore: () => {
        (globalThis as { WebSocket?: unknown }).WebSocket = OriginalWebSocket;
      },
    });
  }

  return guard;
}

function describeTarget(input: unknown, host: string | null): string {
  if (host !== null) return host;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}
