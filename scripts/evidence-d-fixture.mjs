#!/usr/bin/env node
/**
 * Evidence D FIXTURE deployment — NOT EVIDENCE.
 * ============================================================================
 *
 * A deliberately fake Convex-shaped backend used to prove the OPERATOR TOOLING
 * works end to end before it is pointed at the real DEV deployment.
 *
 * It exists because the Phase 208 report builder had only ever been exercised
 * through unit inputs: the harness refuses every host reachable from this
 * sandbox, so the actual CLI path — argument parsing, HTTP transport, check
 * recording, verdict, exit code, both renderers — had never run once.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Nothing this server returns is evidence of anything. It does not contact a
 * provider, a Convex deployment, or a mailbox. Its answers are hardcoded. A
 * run against it is labelled FIXTURE — NOT EVIDENCE at every layer, and the
 * harness refuses to classify such a run as DEV_VERIFIED or PRODUCTION.
 *
 * SAFETY PROPERTIES
 * -----------------
 *   - binds to 127.0.0.1 only, never 0.0.0.0;
 *   - speaks plain HTTP on an ephemeral port, so it can never satisfy the
 *     harness's https + *.convex.cloud requirement by accident;
 *   - reachable only when the operator passes --fixture explicitly;
 *   - every response carries `fixture: true`;
 *   - deterministic: no clock-dependent branching beyond timestamps that are
 *     derived from a fixed offset, no randomness, no persistence.
 *
 * SCENARIOS (--scenario)
 * ----------------------
 *   complete    every observation answerable: the primary instrument yields a
 *               directional signal every time, so the free allowance is spent
 *               and the lock ceiling is reached. This is the only scenario in
 *               which all ten observations can resolve.
 *   exhausted   alias of complete, kept explicit for the exit-code matrix.
 *   incomplete  quiet market: engine answers WAIT/NO_TRADE, so D5/D7/D8 stay
 *               NOT_VERIFIED. This is the realistic DEV shape.
 *   blocked     the deployment rejects the session, so nothing downstream can
 *               be observed.
 *   malformed   a function answers with a nonsense status, to prove the report
 *               renders UNKNOWN rather than PASS.
 *   silent      every call fails at transport, so zero observations succeed.
 *   okx-down    reproduces the real Phase 210 DEV run: the OKX order book is
 *               unavailable and the credentialed fallback answers with
 *               API_UNAVAILABLE. Used to prove the evidence attributes each
 *               failure to the provider it actually came from.
 *
 * Usage:
 *   node scripts/evidence-d-fixture.mjs --scenario complete [--port 0]
 */

import { createServer } from "node:http";

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};

const SCENARIO = (flag("--scenario") ?? "incomplete").toLowerCase();
const VALID = ["complete", "incomplete", "blocked", "malformed", "silent", "exhausted", "okx-down"];
if (!VALID.includes(SCENARIO)) {
  console.error(`FIXTURE: unknown scenario "${SCENARIO}". Expected one of ${VALID.join(", ")}.`);
  process.exit(2);
}

/** Fixed epoch so every run is byte-comparable. 2026-01-01T00:00:00Z. */
const BASE_TS = 1_767_225_600_000;

/** The fake session token. Deterministic and obviously not a credential. */
const FIXTURE_TOKEN = "fixture-session-token-not-a-credential";

/** Deterministic entitlement state, reset per process. */
let used = 0;
const LIMIT = 2;

const CHARGEABLE = ["BUY", "SELL", "LONG", "SHORT"];

const ok = (value) => ({ status: "success", value: { ...value, fixture: true } });
const err = (message) => ({ status: "error", errorMessage: `FIXTURE: ${message}` });

const entitlementBody = (authenticated) => ({
  authenticated,
  plan: "GUEST",
  profitSignalsUsed: used,
  remaining: Math.max(0, LIMIT - used),
  limit: LIMIT,
  allowed: used < LIMIT,
  upgradeRequired: used >= LIMIT,
  reason: authenticated ? null : "UNAUTHENTICATED",
  premiumUntil: null,
});

/**
 * The analysis result. The engine is NOT simulated — these are canned answers
 * whose only purpose is to drive the report's branches. `complete` returns a
 * BUY for one specific instrument so the sweep has something to find; every
 * other instrument answers WAIT, exactly as a quiet market would.
 */
function analysisFor(instrument) {
  if (SCENARIO !== "complete" && SCENARIO !== "exhausted") {
    return { recommendation: "NO_TRADE" };
  }
  // In the complete scenario the engine is "decisive": the D5/D6/D7 probes use
  // the default instrument, so it must answer directionally there in order for
  // the free allowance to be spent and LOCKED to become reachable. A quiet
  // instrument is still included so D6 has a genuine non-chargeable answer.
  if (instrument === QUIET_INSTRUMENT) return { recommendation: "NO_TRADE" };
  return { recommendation: "BUY" };
}
// The D6 probe asks specifically about XAUUSD, so that is the instrument the
// fixture answers non-directionally. Everything else answers BUY, which spends
// the free allowance and makes the LOCKED ceiling reachable for D7/D8.
const QUIET_INSTRUMENT = "XAUUSD";

function handle(path, body, authorized) {
  const a = body?.args ?? {};

  /* ---- auth ---- */
  if (path === "auth:signIn") {
    if (SCENARIO === "blocked") return ok({ tokens: null, blocked: true });
    if (a.provider === "anonymous") return ok({ tokens: { token: FIXTURE_TOKEN } });
    if (a.params?.code) return ok({ tokens: { token: FIXTURE_TOKEN } });
    return ok({ started: true });
  }

  /* ---- entitlements ---- */
  if (path === "entitlements:getMyEntitlement") {
    if (SCENARIO === "blocked") return ok(entitlementBody(false));
    return ok(entitlementBody(Boolean(authorized)));
  }

  if (path === "entitlements:consumeProfitSignal") {
    if (!authorized) return err("unauthenticated");
    const rec = String(a.recommendation ?? "");
    // Mirrors the real return contract in src/convex/entitlements.ts:
    // { allowed, charged, plan, remaining, upgradeRequired, reason }.
    if (!CHARGEABLE.includes(rec)) {
      return ok({
        allowed: true,
        charged: false,
        plan: "GUEST",
        remaining: LIMIT - used,
        upgradeRequired: false,
        reason: "NOT_CHARGEABLE",
        profitSignalsUsed: used,
      });
    }
    if (used >= LIMIT) {
      return ok({
        allowed: false,
        charged: false,
        plan: "GUEST",
        remaining: 0,
        upgradeRequired: true,
        reason: "FREE_LIMIT_REACHED",
        profitSignalsUsed: used,
      });
    }
    used += 1;
    return ok({
      allowed: true,
      charged: true,
      plan: "GUEST",
      remaining: LIMIT - used,
      upgradeRequired: false,
      reason: "CONSUMED",
      profitSignalsUsed: used,
    });
  }

  if (path === "entitlements:grantPremium") {
    // Mirrors the real boundary: a non-admin caller is refused.
    return err("FORBIDDEN: grantPremium requires an administrator.");
  }

  /* ---- analysis ---- */
  if (path === "protectedAnalysis:runProtectedAnalysis") {
    if (!authorized) return ok({ status: "UNAUTHENTICATED" });

    const input = a.input ?? {};
    const instrument = String(input.instrument ?? "");

    // Forged-evidence control: the real server ignores client-supplied
    // evidence fields. The fixture mirrors that by rejecting them outright.
    const forgedKeys = Object.keys(input).filter((k) =>
      ["providerObservedAt", "observedAt", "evidence", "providerPayload", "snapshot"].includes(k),
    );
    if (forgedKeys.length > 0) {
      return ok({ status: "INVALID_INPUT", rejected: forgedKeys, reason: "CLIENT_UNTRUSTED_EVIDENCE" });
    }

    if (SCENARIO === "malformed") {
      return ok({ status: "DELIVERED", result: { recommendation: "MAYBE_BUY_PROBABLY" } });
    }

    const { recommendation } = analysisFor(instrument);
    const chargeable = CHARGEABLE.includes(recommendation);

    if (chargeable && used >= LIMIT) {
      return ok({
        status: "LOCKED",
        entitlement: { plan: "GUEST", profitSignalsUsed: used, remaining: 0, charged: false },
        result: { locked: true, upgradeRequired: true },
      });
    }
    if (chargeable) used += 1;

    return ok({
      status: "DELIVERED",
      entitlement: {
        plan: "GUEST",
        profitSignalsUsed: used,
        remaining: Math.max(0, LIMIT - used),
        charged: chargeable,
      },
      result: { recommendation, instrument },
    });
  }

  if (path === "protectedAnalysis:resolveAndConsume") {
    // Internal function: must not be reachable from a client.
    return err("Could not find public function for 'protectedAnalysis:resolveAndConsume'.");
  }

  /* ---- providers ---- */
  if (path === "okx:fetchOkxOrderBook") {
    if (SCENARIO === "blocked") return ok({ success: false, errorCode: "FIXTURE_UNAVAILABLE" });
    if (SCENARIO === "okx-down") {
      // Exactly the shape the real action returns on a parser rejection: no
      // error, no errorCode, the reason buried at data.reason.
      return ok({
        success: false,
        data: { available: false, reason: "missing/invalid exchange timestamp (ts)" },
      });
    }
    // An exchange-stamped observation, deliberately older than the response.
    return ok({
      success: true,
      observedAt: BASE_TS - 1_500,
      data: {
        freshness: "fresh",
        instrument: a.instrument ?? null,
        // The real parser reports the exchange's own instId; mirror that so
        // the harness can detect a silent remap.
        instrumentId: a.instrument ?? null,
      },
    });
  }

  if (path === "okx:discoverOkxInstruments") {
    return ok({
      success: true,
      provider: "okx",
      discoveredAt: BASE_TS,
      instruments: [
        { instId: "BTC-USDT", instType: "SPOT", baseAsset: "BTC", quoteAsset: "USDT", state: "live" },
        { instId: "ETH-USDT", instType: "SPOT", baseAsset: "ETH", quoteAsset: "USDT", state: "live" },
        { instId: "SOL-USDT", instType: "SPOT", baseAsset: "SOL", quoteAsset: "USDT", state: "suspend" },
      ],
      warnings: [],
    });
  }

  if (path === "marketData:fetchMarketData") {
    if (SCENARIO === "okx-down") {
      return ok({ success: false, error: "Market data fetch failed", errorCode: "API_UNAVAILABLE" });
    }
    return ok({ success: false, errorCode: "FIXTURE_NO_CREDENTIAL" });
  }

  return err(`Could not find public function for '${path}'.`);
}

const server = createServer((req, res) => {
  if (SCENARIO === "silent") {
    req.socket.destroy();
    return;
  }

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    const auth = req.headers.authorization ?? "";
    const authorized = auth === `Bearer ${FIXTURE_TOKEN}`;
    const payload = handle(String(body.path ?? ""), body, authorized);
    const out = JSON.stringify(payload);
    res.writeHead(200, {
      "Content-Type": "application/json",
      // ASCII only: HTTP header values are Latin-1, and a non-ASCII dash here
      // makes Node throw ERR_INVALID_CHAR and destroy the socket.
      "X-Evidence-Fixture": "FIXTURE - NOT EVIDENCE",
    });
    res.end(out);
  });
});

const port = Number.parseInt(flag("--port") ?? "0", 10) || 0;
// Loopback only. Never 0.0.0.0 — this must not be reachable off the machine.
server.listen(port, "127.0.0.1", () => {
  const { port: bound } = server.address();
  console.log(`FIXTURE — NOT EVIDENCE | scenario=${SCENARIO} | http://127.0.0.1:${bound}`);
});
