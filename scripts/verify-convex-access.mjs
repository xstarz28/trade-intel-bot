#!/usr/bin/env node
/**
 * Phase 200 — Convex control-plane access diagnostic.
 *
 * WHY THIS EXISTS
 *
 * Phase 199 established that `*.convex.dev` is unreachable from the agent
 * sandbox, but "unreachable" is not one failure — it is at least six, and they
 * have completely different owners:
 *
 *   DNS fails            -> resolver / network configuration
 *   TCP fails            -> firewall, port block
 *   TLS fails            -> egress allowlist doing TLS interception   <- current
 *   HTTP reachable       -> network is fine, nothing proven about auth
 *   reachable, no creds  -> operator has not configured a deploy key
 *   reachable, bad creds -> the key is wrong or revoked
 *   authenticated        -> actually usable
 *
 * Collapsing these into "it doesn't work" is what forces re-discovery every
 * time someone revisits the blocker. This script separates them at the layer
 * where each one actually fails, so whoever unblocks the network can tell
 * immediately whether their change worked and what is left.
 *
 * HARD RULES
 *
 * - Never prints a secret. Credentials are reported as present/absent and, at
 *   most, by a short non-reversible fingerprint.
 * - HTTP 000, a TLS error and a timeout are NEVER reported as authentication
 *   failures and never as revocation evidence. An absence of answer proves
 *   nothing about the far end.
 * - Reports only what it observed. It cannot mark a deployment usable.
 *
 * Usage:
 *   node scripts/verify-convex-access.mjs
 *   node scripts/verify-convex-access.mjs --json
 *   node scripts/verify-convex-access.mjs --timeout 20
 *
 * Exit codes:
 *   0 = control plane reachable AND authenticated (ready to deploy)
 *   1 = reachable but not authenticated (credentials missing or rejected)
 *   2 = not reachable (DNS/TCP/TLS) — a network/platform problem, not auth
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const timeoutSeconds = Number(
  args[args.indexOf("--timeout") + 1] ?? (args.includes("--timeout") ? 15 : 15),
);
const TIMEOUT_MS = Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 15_000;

/** Hosts that must work for `npx convex deploy` / `codegen` to function. */
const CONTROL_PLANE_HOSTS = ["api.convex.dev", "provision.convex.dev", "dashboard.convex.dev"];

/**
 * Controls on the same network. Without these, a failure is ambiguous: an
 * offline sandbox and a targeted allowlist look identical.
 *
 * NOTE ON TLS INTERCEPTION: some sandboxes terminate TLS at a proxy and
 * re-sign with a private CA (the agent sandbox uses an "E2B Proxy CA"). curl
 * trusts it via the system bundle; Node ships its own bundle and rejects it
 * with UNABLE_TO_VERIFY_LEAF_SIGNATURE. That is a *trust-store* mismatch, not
 * a connectivity failure, so it must not be read as "the network is down" —
 * which is why `classifyControl()` below separates the two.
 */
const CONTROL_HOSTS = ["api.github.com", "registry.npmjs.org"];

/**
 * A control host that completes a TLS handshake but fails certificate
 * verification still proves the network path works. Treat it as reachable, and
 * say why, rather than logging a bare FAIL that misrepresents the network.
 */
function classifyControl(probe) {
  if (probe.ok) return { status: "PASS", note: "" };
  const intercepted = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|DEPTH_ZERO/.test(
    probe.detail,
  );
  return intercepted
    ? {
        status: "PASS",
        note: " — reached the host; certificate signed by a local interception CA (network path works)",
      }
    : { status: "FAIL", note: "" };
}

const layers = [];
const record = (layer, host, status, detail) => {
  layers.push({ layer, host, status, detail });
};

/* ------------------------------------------------------------------ *
 * Layer probes — each isolates exactly one failure mode
 * ------------------------------------------------------------------ */

async function probeDns(host) {
  try {
    const { address, family } = await lookup(host);
    return { ok: true, detail: `resolved to ${address} (IPv${family})` };
  } catch (error) {
    return { ok: false, detail: `DNS lookup failed: ${error?.code ?? error?.message ?? error}` };
  }
}

function probeTcp(host, port = 443) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = netConnect({ host, port });
    const finish = (ok, detail) => {
      socket.destroy();
      resolve({ ok, detail, ms: Date.now() - started });
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => finish(true, `TCP ${port} accepted the connection`));
    socket.once("timeout", () => finish(false, `TCP ${port} timed out after ${TIMEOUT_MS}ms`));
    socket.once("error", (error) => finish(false, `TCP ${port} failed: ${error?.code ?? error?.message}`));
  });
}

function probeTls(host, port = 443) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: true });
    const finish = (ok, detail) => {
      socket.destroy();
      resolve({ ok, detail, ms: Date.now() - started });
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const issuer = cert?.issuer?.O ?? cert?.issuer?.CN ?? "unknown issuer";
      finish(true, `TLS handshake completed (certificate issued by ${issuer})`);
    });
    socket.once("timeout", () => finish(false, `TLS timed out after ${TIMEOUT_MS}ms`));
    socket.once("error", (error) => {
      const code = error?.code ?? error?.message;
      // Distinguish the two very different TLS failures:
      //   ECONNRESET / EPIPE  -> the handshake was SEVERED (blocking middlebox)
      //   CERT_* / *_SIGNATURE -> the handshake completed, trust was refused
      const severed = /ECONNRESET|EPIPE|ECONNABORTED/.test(String(code));
      finish(
        false,
        severed
          ? `TLS handshake severed mid-negotiation (${code}) — consistent with an egress allowlist`
          : `TLS handshake failed: ${code}`,
      );
    });
  });
}

async function probeHttp(host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`https://${host}/`, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return {
      ok: true,
      status: response.status,
      detail: `HTTP ${response.status} in ${Date.now() - started}ms`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: `no HTTP response: ${error?.cause?.code ?? error?.name ?? error?.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Credential state — presence only, never the value
 * ------------------------------------------------------------------ */

function fingerprint(value) {
  // Short, non-reversible, and only ever derived from a value the operator
  // already holds. Lets two people confirm they mean the same key without
  // either of them pasting it anywhere.
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function credentialState() {
  const deployKey = process.env.CONVEX_DEPLOY_KEY ?? "";
  const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
  return {
    deployKeyPresent: deployKey.trim().length > 0,
    deployKeyFingerprint: deployKey.trim() ? fingerprint(deployKey.trim()) : null,
    deploymentPresent: deployment.trim().length > 0,
    // The deployment NAME is not a secret — it appears in the dashboard URL.
    deploymentName: deployment.trim() || null,
  };
}

/* ------------------------------------------------------------------ *
 * Authenticated probe — only attempted when it can mean something
 * ------------------------------------------------------------------ */

async function probeAuthenticated(creds) {
  if (!creds.deployKeyPresent) {
    return {
      state: "no_credentials",
      detail: "CONVEX_DEPLOY_KEY is not set — no authenticated call was attempted",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Convex's CLI authenticates to the provision host with the deploy key.
    // A 200/2xx means the key is accepted; 401/403 means it is rejected.
    const response = await fetch("https://api.convex.dev/api/deployment/provision_and_authorize", {
      method: "POST",
      headers: {
        Authorization: `Convex ${process.env.CONVEX_DEPLOY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return {
        state: "credentials_rejected",
        detail: `control plane answered HTTP ${response.status} — the key was presented and refused`,
      };
    }
    if (response.status >= 200 && response.status < 500) {
      return {
        state: "authenticated",
        detail: `control plane answered HTTP ${response.status} to an authenticated request`,
      };
    }
    return {
      state: "server_error",
      detail: `control plane answered HTTP ${response.status} — not an auth verdict`,
    };
  } catch (error) {
    // CRITICAL: a transport failure here is NOT an auth failure. Saying
    // otherwise would let a blocked network masquerade as a bad key — and, in
    // the other direction, let someone claim a key was "rejected" (or revoked)
    // when it was never actually delivered to the far end.
    return {
      state: "unreachable",
      detail:
        `no answer to the authenticated request (${error?.cause?.code ?? error?.name}). ` +
        "This is a TRANSPORT failure and says nothing about the credential.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const primary = CONTROL_PLANE_HOSTS[0];
let reachable = false;

for (const host of CONTROL_PLANE_HOSTS) {
  const dns = await probeDns(host);
  record("dns", host, dns.ok ? "PASS" : "FAIL", dns.detail);
  if (!dns.ok) continue;

  const tcp = await probeTcp(host);
  record("tcp", host, tcp.ok ? "PASS" : "FAIL", `${tcp.detail} (${tcp.ms}ms)`);
  if (!tcp.ok) continue;

  const tls = await probeTls(host);
  record("tls", host, tls.ok ? "PASS" : "FAIL", `${tls.detail} (${tls.ms}ms)`);
  if (!tls.ok) continue;

  const http = await probeHttp(host);
  record("http", host, http.ok ? "PASS" : "FAIL", http.detail);
  if (http.ok && host === primary) reachable = true;
}

for (const host of CONTROL_HOSTS) {
  const http = await probeHttp(host);
  const { status, note } = classifyControl(http);
  record("control", host, status, `${http.detail}${note} [same-network control]`);
}

const creds = credentialState();
record(
  "credentials",
  "environment",
  creds.deployKeyPresent ? "PASS" : "ABSENT",
  creds.deployKeyPresent
    ? `CONVEX_DEPLOY_KEY present (fingerprint ${creds.deployKeyFingerprint}; value never printed)`
    : "CONVEX_DEPLOY_KEY not set",
);
record(
  "credentials",
  "deployment",
  creds.deploymentPresent ? "PASS" : "ABSENT",
  creds.deploymentPresent ? `CONVEX_DEPLOYMENT=${creds.deploymentName}` : "CONVEX_DEPLOYMENT not set",
);

// Only meaningful once the transport works. Attempting it on a dead network
// produces a misleading "auth" result, which is the exact confusion this
// script exists to prevent.
const auth = reachable
  ? await probeAuthenticated(creds)
  : {
      state: "not_attempted",
      detail: "control plane is not reachable — an authenticated probe would be meaningless",
    };
record("auth", primary, auth.state === "authenticated" ? "PASS" : "BLOCKED", auth.detail);

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

const controlsUp = layers.some((l) => l.layer === "control" && l.status === "PASS");
const failedLayer = ["dns", "tcp", "tls", "http"].find((layer) =>
  layers.some((l) => l.layer === layer && l.host === primary && l.status === "FAIL"),
);

let verdict;
let exitCode;
if (!reachable) {
  verdict = {
    state: "NOT_REACHABLE",
    blockedAt: failedLayer ?? "unknown",
    classification: controlsUp
      ? `egress to ${primary} is blocked at the ${failedLayer ?? "unknown"} layer, ` +
        "while same-network controls succeed — a targeted allowlist, not an outage"
      : "the whole network appears unavailable — controls failed too",
    isAuthEvidence: false,
    isRevocationEvidence: false,
  };
  exitCode = 2;
} else if (auth.state === "authenticated") {
  verdict = {
    state: "AUTHENTICATED",
    blockedAt: null,
    classification: "control plane reachable and the deploy key was accepted",
    isAuthEvidence: true,
    isRevocationEvidence: false,
  };
  exitCode = 0;
} else {
  verdict = {
    state: auth.state === "credentials_rejected" ? "CREDENTIALS_REJECTED" : "UNAUTHENTICATED",
    blockedAt: "auth",
    classification:
      auth.state === "credentials_rejected"
        ? "control plane reachable; the key was delivered and refused"
        : "control plane reachable; no usable credential was presented",
    isAuthEvidence: auth.state === "credentials_rejected",
    isRevocationEvidence: false,
  };
  exitCode = 1;
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        baselineCommit: process.env.GITHUB_SHA ?? null,
        reachable,
        verdict,
        layers,
        credentials: {
          deployKeyPresent: creds.deployKeyPresent,
          deployKeyFingerprint: creds.deployKeyFingerprint,
          deploymentPresent: creds.deploymentPresent,
          deploymentName: creds.deploymentName,
        },
        notes: [
          "HTTP 000, a TLS error and a timeout are transport failures.",
          "They are never authentication failures and never revocation evidence.",
        ],
      },
      null,
      2,
    ),
  );
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log("Convex control-plane access diagnostic");
  console.log("─".repeat(72));
  for (const l of layers) {
    console.log(`  ${pad(l.status, 8)} ${pad(l.layer, 12)} ${pad(l.host, 24)} ${l.detail}`);
  }
  console.log("─".repeat(72));
  console.log(`VERDICT: ${verdict.state}`);
  console.log(`  ${verdict.classification}`);
  if (verdict.blockedAt) console.log(`  first failing layer: ${verdict.blockedAt}`);
  console.log("");
  console.log("  This diagnostic reports transport and credential state only.");
  console.log("  It is NOT a deployment and NOT Evidence D.");
  if (!verdict.isAuthEvidence) {
    console.log("  No authentication conclusion may be drawn from this run.");
  }
}

process.exit(exitCode);
