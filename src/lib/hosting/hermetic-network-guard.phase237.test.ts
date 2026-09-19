/**
 * Phase 237 — the default suite is fail-closed against the external network.
 *
 * Phase 181 tried to prove hermeticity by scanning test sources for hostnames
 * from a hardcoded list. It reported the suite clean while the suite was making
 * 45 real outbound requests per run, because it could only see the leaks whose
 * shape it already knew:
 *
 *   - phase54 called `verifyProvider()`, and `fetch()` lives in
 *     `market-radar/verification.ts` — no hostname literal in the test;
 *   - `vi.mock(` anywhere in a file excused every call in that file;
 *   - `derivatives-bridge.phase226.test.ts` leaked a request that no list named.
 *
 * So this phase moved the proof from text to behaviour: the guard in
 * `src/test-network-guard.ts` is installed by the suite's setup file, and the
 * tests below attempt real external I/O and require it to be REFUSED.
 *
 * The critical detail is that they assert on the error's IDENTITY, not merely
 * that the call failed. "It failed" is worthless here: this sandbox has no
 * provider access at all, so an unguarded fetch fails too — which is exactly how
 * Phase 181's blind spot survived a local green run. A refusal is a specific,
 * named error that no network outage can produce.
 */
import { createServer, type Server } from "node:http";
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  ExternalNetworkBlockedError,
  LIVE_OPT_IN_ENV,
  LIVE_OPT_IN_VALUE,
  hostOfUrl,
  installNetworkGuard,
  isLiveOptIn,
  isLoopbackHost,
  isNetworkGuardInstalled,
} from "../../test-network-guard";
import assertLiveOptIn from "../../vitest-live-global-setup";
import { VERIFICATION_MATRIX, verifyProvider } from "../market-radar/verification";

const ROOT = process.cwd();

/** A real provider this repository actually talks to. */
const EXTERNAL_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
/** A literal external address, to prove the rule is about the address and not DNS. */
const EXTERNAL_IP_URL = "http://93.184.216.34/";

function blocked(): { name: string; code: string; message: string } {
  return expect.objectContaining({
    name: "ExternalNetworkBlockedError",
    code: "ERR_EXTERNAL_NETWORK_BLOCKED",
  }) as unknown as { name: string; code: string; message: string };
}

describe("237 A — the guard is installed in the default suite", () => {
  it("is active in this run, which is a run of the default suite", () => {
    // If the setup file stops being wired into vitest.config.ts, this fails —
    // the guarantee is not allowed to degrade into documentation.
    expect(isNetworkGuardInstalled()).toBe(true);
  });

  it("is not running in live mode", () => {
    expect(isLiveOptIn()).toBe(false);
    expect(process.env[LIVE_OPT_IN_ENV]).not.toBe(LIVE_OPT_IN_VALUE);
  });

  it("refuses with a named error, never a bare network failure", () => {
    const err = new ExternalNetworkBlockedError("fetch", "api.coingecko.com");
    expect(err.name).toBe("ExternalNetworkBlockedError");
    expect(err.code).toBe("ERR_EXTERNAL_NETWORK_BLOCKED");
    expect(err).toBeInstanceOf(Error);
    // The message must tell whoever hits it how to run the test deliberately.
    expect(err.message).toContain("api.coingecko.com");
    expect(err.message).toContain(`${LIVE_OPT_IN_ENV}=${LIVE_OPT_IN_VALUE}`);
  });
});

describe("237 B — external attempts are refused, deterministically", () => {
  it("refuses fetch to a real provider", async () => {
    // Identity, not just failure: an unguarded fetch in this sandbox also
    // rejects (no route to the provider), so `rejects.toThrow()` alone would
    // pass with the guard removed.
    await expect(fetch(EXTERNAL_URL)).rejects.toMatchObject(blocked());
  });

  it("refuses fetch to a literal external IP (not a DNS failure)", async () => {
    await expect(fetch(EXTERNAL_IP_URL)).rejects.toMatchObject(blocked());
  });

  it("refuses an unparseable target instead of assuming it is local", async () => {
    // Fail closed: "I could not tell where this goes" must never become
    // "so it is probably fine". The refusal is the guard's own error, which is
    // exactly what an unguarded `fetch("not-a-url")` cannot produce (it raises
    // a TypeError about the URL).
    await expect(fetch("not-a-url")).rejects.toBeInstanceOf(ExternalNetworkBlockedError);
  });

  it("refuses http.get / https.request", () => {
    expect(() => http.get(EXTERNAL_URL)).toThrow(ExternalNetworkBlockedError);
    expect(() => http.request({ host: "api.coingecko.com", port: 80 })).toThrow(
      ExternalNetworkBlockedError,
    );
  });

  it("refuses raw sockets — the bypass a fetch-only guard would leave open", () => {
    expect(() => net.connect({ host: "api.coingecko.com", port: 443 })).toThrow(
      ExternalNetworkBlockedError,
    );
    expect(() => net.connect(443, "93.184.216.34")).toThrow(ExternalNetworkBlockedError);
    expect(() => tls.connect({ host: "api.coingecko.com", port: 443 })).toThrow(
      ExternalNetworkBlockedError,
    );
  });

  it("refuses name resolution for external hosts (callback and promise APIs)", async () => {
    const viaCallback = await new Promise<Error | null>((resolve) => {
      dns.lookup("api.coingecko.com", (err) => resolve(err ?? null));
    });
    expect(viaCallback).toBeInstanceOf(ExternalNetworkBlockedError);
    await expect(dns.promises.lookup("api.coingecko.com")).rejects.toBeInstanceOf(
      ExternalNetworkBlockedError,
    );
  });

  it("refuses WebSocket connections to external hosts", () => {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    expect(typeof WS).toBe("function");
    expect(() => new (WS as typeof WebSocket)("wss://api.coingecko.com/ws")).toThrow(
      ExternalNetworkBlockedError,
    );
  });
});

describe("237 C — the refusal reaches through production code, not just direct calls", () => {
  it("verifyProvider() degrades instead of reaching the provider", async () => {
    const spec = VERIFICATION_MATRIX.find(
      (s) => s.provider === "coingecko" && s.instrument === "BTC/USD",
    )!;
    const result = await verifyProvider(spec);

    // Every provider in the matrix is external, so nothing may come back live.
    expect(result.status).not.toBe("LIVE_VERIFIED");
    expect(result.status).toBe("TIMEOUT");
    expect(result.provenance).toBe("network");
    expect(result.schemaValid).toBe(false);
    expect(result.numericValid).toBe(false);
    expect(result.responseTimestamp).toBeNull();
  });

  it("a production helper cannot be used to smuggle a live response", async () => {
    // Same rule, reached through the helper rather than the raw API: the guard
    // sits below the abstraction, so the abstraction cannot opt out of it.
    const result = await verifyProvider(
      {
        provider: "coingecko",
        instrument: "ETH/USD",
        providerSymbol: "ethereum",
        capability: "quote",
        assetClass: "crypto",
        requiresCredential: false,
      },
      () => undefined,
    );
    expect(result.status).toBe("TIMEOUT");
  });
});

describe("237 D — loopback still works, so the guard is test-only and not a blanket ban", () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  async function startLocalServer(): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return address.port;
  }

  it("allows a real local server over 127.0.0.1", async () => {
    const port = await startLocalServer();
    const res = await fetch(`http://127.0.0.1:${port}/local`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows a real local server over localhost and raw http.get", async () => {
    const port = await startLocalServer();
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://localhost:${port}/local`, (res) => {
        let acc = "";
        res.on("data", (c) => (acc += String(c)));
        res.on("end", () => resolve(acc));
      }).on("error", reject);
    });
    expect(JSON.parse(body)).toEqual({ ok: true });
  });
});

describe("237 E — the loopback allowance cannot be widened by a lookalike name", () => {
  it("classifies the ambiguous cases explicitly", () => {
    for (const local of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "", "api.localhost"]) {
      expect(isLoopbackHost(local), `expected ${local} to be loopback`).toBe(true);
    }
    for (const external of [
      "api.coingecko.com",
      "localhost.evil.com",
      "127.0.0.1.evil.com",
      "notlocalhost",
      "10.0.0.1",
      "192.168.1.1",
      "8.8.8.8",
      "256.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isLoopbackHost(external), `expected ${external} to be external`).toBe(false);
    }
  });

  it("blocks lookalike hostnames that merely contain a loopback name", async () => {
    await expect(fetch("http://127.0.0.1.evil.com/")).rejects.toMatchObject(blocked());
    await expect(fetch("http://localhost.evil.com/")).rejects.toMatchObject(blocked());
    expect(() => http.get("http://notlocalhost/")).toThrow(ExternalNetworkBlockedError);
  });

  it("reads the host out of Request-like and URL inputs", () => {
    expect(hostOfUrl("https://api.coingecko.com/x")).toBe("api.coingecko.com");
    expect(hostOfUrl(new URL("https://www.okx.com/api"))).toBe("www.okx.com");
    expect(hostOfUrl(new Request("https://home.treasury.gov/x"))).toBe("home.treasury.gov");
    expect(hostOfUrl(null)).toBeNull();
  });
});

describe("237 F — the live path is explicit, separate, and cannot switch itself on", () => {
  it("requires the exact opt-in value, not a lookalike", () => {
    expect(isLiveOptIn({})).toBe(false);
    expect(isLiveOptIn({ [LIVE_OPT_IN_ENV]: "true" })).toBe(false);
    expect(isLiveOptIn({ [LIVE_OPT_IN_ENV]: "1 " })).toBe(false);
    expect(isLiveOptIn({ [LIVE_OPT_IN_ENV]: "0" })).toBe(false);
    expect(isLiveOptIn({ [LIVE_OPT_IN_ENV]: LIVE_OPT_IN_VALUE })).toBe(true);
  });

  it("the live runner refuses to start without the opt-in", () => {
    const saved = process.env[LIVE_OPT_IN_ENV];
    try {
      delete process.env[LIVE_OPT_IN_ENV];
      expect(() => assertLiveOptIn()).toThrow(/opt-in/i);
      process.env[LIVE_OPT_IN_ENV] = LIVE_OPT_IN_VALUE;
      expect(() => assertLiveOptIn()).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env[LIVE_OPT_IN_ENV];
      else process.env[LIVE_OPT_IN_ENV] = saved;
    }
  });

  it("the default command stays hermetic and the live command stays separate", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.test).not.toContain("live");
    expect(pkg.scripts["test:live"]).toContain("vitest.live.config.ts");
  });

  it("no CI workflow can switch live verification on", () => {
    const dir = join(ROOT, ".github", "workflows");
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, `${file} must not set ${LIVE_OPT_IN_ENV}`).not.toContain(LIVE_OPT_IN_ENV);
    }
  });

  it("the guard is test infrastructure — no application code imports it", () => {
    // Requirement: production/runtime behaviour is unchanged. If a non-test
    // module ever imports the guard, this fails.
    const allowed = new Set([
      "src/test-setup-network-guard.ts",
      "src/vitest-live-global-setup.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const rel = relative(ROOT, full).replace(/\\/g, "/");
          if (rel === "src/test-network-guard.ts") continue;
          if (/\.test\.tsx?$/.test(rel) || allowed.has(rel)) continue;
          if (readFileSync(full, "utf8").includes("test-network-guard")) offenders.push(rel);
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });

  it("re-installing the guard is idempotent (a second call does not wrap twice)", () => {
    const before = globalThis.fetch;
    const again = installNetworkGuard();
    expect(again).toBeTruthy();
    expect(globalThis.fetch).toBe(before);
  });
});
