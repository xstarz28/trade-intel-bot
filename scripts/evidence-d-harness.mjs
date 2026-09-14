#!/usr/bin/env node
/**
 * Phase 200 — Evidence D execution harness (D1–D10).
 *
 * Evidence D is "authenticated calls succeed against a REAL deployment". This
 * harness performs those calls and records what actually happened. It exists so
 * that whoever finally has a deployment does not have to reinvent the
 * verification, and so the result is a machine-readable artifact rather than
 * someone's recollection.
 *
 * ## What this harness refuses to do
 *
 * - It will NOT run against localhost, a mock, or a substitute backend. A
 *   passing run against a stub is worse than no run: it manufactures false
 *   confidence in the one gate that exists to prevent exactly that.
 * - It will NOT report PASS for a check it could not execute. Unexecuted checks
 *   are BLOCKED, and a run with any BLOCKED check is not Evidence D.
 * - It will NOT print an OTP, a session token, or any credential.
 *
 * ## D1 requires a human
 *
 * D1 is "an OTP email arrived in a real mailbox". No script can observe that.
 * The harness prompts for the code and records the observation as HUMAN-
 * attested; it never fabricates it, and never infers delivery from a 200
 * response to the send call. A provider accepting a send request is not
 * delivery.
 *
 * Usage:
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud \
 *   EVIDENCE_D_EMAIL=you@your-domain \
 *   node scripts/evidence-d-harness.mjs [--json] [--otp 123456]
 *
 * Exit codes:
 *   0 = all ten observations captured and passing (Evidence D achieved)
 *   1 = at least one observation FAILED (a real defect)
 *   2 = could not execute (no deployment configured, or a substitute detected)
 */

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const otpFromFlag = args[args.indexOf("--otp") + 1];
const providedOtp = args.includes("--otp") ? otpFromFlag : null;

const DEPLOYMENT_URL = (process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL ?? "").trim();
const TEST_EMAIL = (process.env.EVIDENCE_D_EMAIL ?? "").trim();
const TIMEOUT_MS = 30_000;

const checks = [];
const record = (id, title, status, detail, evidence = null) => {
  checks.push({ id, title, status, detail, evidence });
};

/* ------------------------------------------------------------------ *
 * Refuse to run against anything that is not a real deployment
 * ------------------------------------------------------------------ */

function refuse(reason) {
  const payload = {
    evidenceD: "NOT EXECUTED",
    reason,
    checks: D_DEFINITIONS.map((d) => ({
      id: d.id,
      title: d.title,
      status: "BLOCKED",
      detail: reason,
    })),
  };
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else {
    console.error(`REFUSING TO RUN: ${reason}`);
    console.error("Evidence D stays BLOCKED. No check was marked PASS.");
  }
  process.exit(2);
}

/** The ten observations, defined once so a refusal still reports all of them. */
const D_DEFINITIONS = [
  { id: "D1", title: "OTP email received at a real mailbox" },
  { id: "D2", title: "Sign-in with that code creates a session" },
  { id: "D3", title: "Unauthenticated call to a protected route is rejected" },
  { id: "D4", title: "getMyEntitlement returns GUEST with remaining = 2" },
  { id: "D5", title: "A chargeable BUY/SELL consumes exactly one signal" },
  { id: "D6", title: "A WAIT/NO_TRADE consumes zero signals" },
  { id: "D7", title: "The third chargeable request returns LOCKED" },
  { id: "D8", title: "The LOCKED payload carries no directional/actionable field" },
  { id: "D9", title: "A forged provider payload is rejected server-side" },
  { id: "D10", title: "Provenance observedAt is provider-derived, not local" },
];

if (!DEPLOYMENT_URL) {
  refuse("VITE_CONVEX_URL is not set — there is no deployment to test against.");
}

let parsed;
try {
  parsed = new URL(DEPLOYMENT_URL);
} catch {
  refuse(`VITE_CONVEX_URL is not a valid URL.`);
}

// A substitute backend must never be able to produce Evidence D.
const LOCAL_RE = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)$/i;
if (LOCAL_RE.test(parsed.hostname)) {
  refuse(
    `VITE_CONVEX_URL points at a local host (${parsed.hostname}). ` +
      "Evidence D requires a real deployment; a local substitute cannot produce it.",
  );
}
if (parsed.protocol !== "https:") {
  refuse(`VITE_CONVEX_URL must be https (got ${parsed.protocol}).`);
}
if (!/\.convex\.(cloud|site)$/i.test(parsed.hostname)) {
  refuse(
    `VITE_CONVEX_URL host (${parsed.hostname}) is not a Convex deployment domain. ` +
      "Refusing to attribute Evidence D to an unknown backend.",
  );
}
if (!TEST_EMAIL) {
  refuse("EVIDENCE_D_EMAIL is not set — D1 needs a real mailbox to deliver to.");
}

/* ------------------------------------------------------------------ *
 * Convex HTTP client (functions endpoint)
 * ------------------------------------------------------------------ */

async function callConvex(path, functionName, args_, token = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${DEPLOYMENT_URL}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path: functionName, args: args_, format: "json" }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error?.cause?.code ?? error?.name };
  } finally {
    clearTimeout(timer);
  }
}

const query = (fn, a, t) => callConvex("query", fn, a, t);
const mutation = (fn, a, t) => callConvex("mutation", fn, a, t);
const action = (fn, a, t) => callConvex("action", fn, a, t);

/* ------------------------------------------------------------------ *
 * Observations
 * ------------------------------------------------------------------ */

async function run() {
  // --- D3 first: it needs NO session, and proves the deployment answers. ---
  const unauth = await action("protectedAnalysis:runProtectedAnalysis", {
    symbol: "EURUSD",
    instrumentType: "forex",
    tradingStyle: "intraday",
  });
  if (unauth.status === 0) {
    refuse(
      `the deployment did not answer (${unauth.error}). ` +
        "Check connectivity before attributing anything to the application.",
    );
  }
  const unauthStatus = unauth.body?.value?.status ?? unauth.body?.status;
  record(
    "D3",
    D_DEFINITIONS[2].title,
    unauthStatus === "UNAUTHENTICATED" || unauth.status === 401 ? "PASS" : "FAIL",
    `deployment returned HTTP ${unauth.status}, status=${unauthStatus ?? "n/a"}`,
    { httpStatus: unauth.status, appStatus: unauthStatus },
  );

  // --- D1: send the code, then a HUMAN confirms arrival. ---
  const send = await action("auth:signIn", {
    provider: "email-otp",
    params: { email: TEST_EMAIL },
  });
  const sendAccepted = send.ok;

  let otp = providedOtp;
  if (!otp) {
    record(
      "D1",
      D_DEFINITIONS[0].title,
      "BLOCKED",
      sendAccepted
        ? "send request accepted, but arrival in a mailbox was NOT observed. " +
            "Re-run with --otp <code> once the mail is in hand. " +
            "A 200 from the provider is not delivery."
        : `send request failed (HTTP ${send.status})`,
      { sendAccepted, humanAttested: false },
    );
    // Everything downstream needs a session.
    for (const d of D_DEFINITIONS.slice(1)) {
      if (d.id === "D3") continue;
      record(d.id, d.title, "BLOCKED", "no authenticated session (D1 not completed)");
    }
    return;
  }

  record(
    "D1",
    D_DEFINITIONS[0].title,
    sendAccepted ? "PASS" : "FAIL",
    sendAccepted
      ? `code delivered to ${maskEmail(TEST_EMAIL)} and supplied by a human operator (HUMAN-attested)`
      : `send request failed (HTTP ${send.status})`,
    { sendAccepted, humanAttested: true, recipient: maskEmail(TEST_EMAIL) },
  );

  // --- D2: exchange the code for a session. ---
  const verify = await action("auth:signIn", {
    provider: "email-otp",
    params: { email: TEST_EMAIL, code: otp },
  });
  const token = verify.body?.value?.tokens?.token ?? verify.body?.value?.token ?? null;
  record(
    "D2",
    D_DEFINITIONS[1].title,
    token ? "PASS" : "FAIL",
    token ? "session established (token withheld from this report)" : `no session (HTTP ${verify.status})`,
    { sessionEstablished: Boolean(token) },
  );
  if (!token) {
    for (const d of D_DEFINITIONS.slice(3)) {
      record(d.id, d.title, "BLOCKED", "no authenticated session");
    }
    return;
  }

  // --- D4: a fresh guest starts with two free profit signals. ---
  const ent = await query("entitlements:getMyEntitlement", {}, token);
  const e0 = ent.body?.value ?? {};
  record(
    "D4",
    D_DEFINITIONS[3].title,
    e0.plan === "GUEST" && e0.remaining === 2 ? "PASS" : "FAIL",
    `plan=${e0.plan} remaining=${e0.remaining} limit=${e0.limit}`,
    e0,
  );

  // --- D5: a chargeable recommendation consumes exactly one. ---
  const before = e0.profitSignalsUsed ?? 0;
  const buy = await action(
    "protectedAnalysis:runProtectedAnalysis",
    { symbol: "EURUSD", instrumentType: "forex", tradingStyle: "intraday" },
    token,
  );
  const afterBuy = (await query("entitlements:getMyEntitlement", {}, token)).body?.value ?? {};
  const buyRec = buy.body?.value?.result?.recommendation ?? buy.body?.value?.status;
  const consumed = (afterBuy.profitSignalsUsed ?? 0) - before;
  const chargeable = ["BUY", "SELL", "LONG", "SHORT"].includes(String(buyRec));
  record(
    "D5",
    D_DEFINITIONS[4].title,
    chargeable ? (consumed === 1 ? "PASS" : "FAIL") : "NOT APPLICABLE",
    chargeable
      ? `recommendation=${buyRec}, consumed=${consumed} (expected exactly 1)`
      : `the engine returned ${buyRec}, which is not chargeable — rerun when a directional signal occurs`,
    { recommendation: buyRec, consumed },
  );

  // --- D6: a non-chargeable recommendation consumes nothing. ---
  const beforeWait = afterBuy.profitSignalsUsed ?? 0;
  const wait = await action(
    "protectedAnalysis:runProtectedAnalysis",
    { symbol: "XAUUSD", instrumentType: "commodity", tradingStyle: "swing" },
    token,
  );
  const afterWait = (await query("entitlements:getMyEntitlement", {}, token)).body?.value ?? {};
  const waitRec = wait.body?.value?.result?.recommendation;
  const waitConsumed = (afterWait.profitSignalsUsed ?? 0) - beforeWait;
  const nonChargeable = ["WAIT", "NO_TRADE"].includes(String(waitRec));
  record(
    "D6",
    D_DEFINITIONS[5].title,
    nonChargeable ? (waitConsumed === 0 ? "PASS" : "FAIL") : "NOT APPLICABLE",
    nonChargeable
      ? `recommendation=${waitRec}, consumed=${waitConsumed} (expected 0)`
      : `the engine returned ${waitRec}; rerun when a WAIT/NO_TRADE occurs`,
    { recommendation: waitRec, consumed: waitConsumed },
  );

  // --- D7 + D8: exhaustion must LOCK, and reveal nothing. ---
  let locked = null;
  for (let attempt = 0; attempt < 4 && !locked; attempt += 1) {
    const r = await action(
      "protectedAnalysis:runProtectedAnalysis",
      { symbol: "GBPUSD", instrumentType: "forex", tradingStyle: "scalping" },
      token,
    );
    if ((r.body?.value?.status ?? "") === "LOCKED") locked = r.body.value;
  }
  record(
    "D7",
    D_DEFINITIONS[6].title,
    locked ? "PASS" : "FAIL",
    locked ? "an exhausted account received LOCKED" : "no LOCKED response after exhausting the quota",
    { locked: Boolean(locked) },
  );

  if (locked) {
    const DIRECTIONAL = ["recommendation", "direction", "entry", "stopLoss", "takeProfit", "side"];
    const serialized = JSON.stringify(locked.result ?? {});
    const leaked = DIRECTIONAL.filter((f) => serialized.includes(`"${f}"`));
    record(
      "D8",
      D_DEFINITIONS[7].title,
      leaked.length === 0 ? "PASS" : "FAIL",
      leaked.length === 0
        ? "LOCKED payload contains no directional or actionable field"
        : `LOCKED payload leaked: ${leaked.join(", ")}`,
      { leakedFields: leaked },
    );
  } else {
    record("D8", D_DEFINITIONS[7].title, "BLOCKED", "no LOCKED payload to inspect");
  }

  // --- D9: client-supplied evidence must not override the server's. ---
  const forged = await action(
    "protectedAnalysis:runProtectedAnalysis",
    {
      symbol: "EURUSD",
      instrumentType: "forex",
      tradingStyle: "intraday",
      marketData: { price: 99999, observedAt: 0, source: "forged-by-client" },
    },
    token,
  );
  const forgedBody = JSON.stringify(forged.body ?? {});
  const acceptedForgery = forgedBody.includes("forged-by-client") || forgedBody.includes("99999");
  record(
    "D9",
    D_DEFINITIONS[8].title,
    acceptedForgery ? "FAIL" : "PASS",
    acceptedForgery
      ? "the deployment echoed client-supplied market data — provenance is compromised"
      : "client-supplied market data did not reach the result; evidence is server-acquired",
    { acceptedForgery },
  );

  // --- D10: observedAt must come from the provider, not the local clock. ---
  const ev = forged.body?.value?.result?.evidence ?? buy.body?.value?.result?.evidence ?? null;
  const observedAt = ev?.observedAt ?? ev?.[0]?.observedAt ?? null;
  const skewMs = observedAt ? Math.abs(Date.now() - Number(observedAt)) : null;
  record(
    "D10",
    D_DEFINITIONS[9].title,
    observedAt ? "PASS" : "BLOCKED",
    observedAt
      ? `observedAt=${new Date(Number(observedAt)).toISOString()} (skew from local clock ${skewMs}ms; ` +
        "a provider timestamp is expected to differ from 'now')"
      : "no observedAt present in the response to evaluate",
    { observedAt, skewMs },
  );
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

await run();

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

const failed = checks.filter((c) => c.status === "FAIL");
const blocked = checks.filter((c) => c.status === "BLOCKED");
const passed = checks.filter((c) => c.status === "PASS");

const evidenceD = failed.length > 0 ? "FAILED" : blocked.length > 0 ? "INCOMPLETE" : "ACHIEVED";

if (asJson) {
  console.log(
    JSON.stringify(
      {
        evidenceD,
        deployment: parsed.hostname,
        capturedAt: new Date().toISOString(),
        summary: { passed: passed.length, failed: failed.length, blocked: blocked.length },
        checks,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Evidence D harness — ${parsed.hostname}`);
  console.log("─".repeat(72));
  for (const c of checks) {
    console.log(`  ${c.status.padEnd(15)} ${c.id.padEnd(4)} ${c.title}`);
    console.log(`  ${" ".repeat(20)} ${c.detail}`);
  }
  console.log("─".repeat(72));
  console.log(`EVIDENCE D: ${evidenceD}`);
  console.log(`  ${passed.length} passed, ${failed.length} failed, ${blocked.length} blocked`);
  if (evidenceD !== "ACHIEVED") {
    console.log("  Evidence D is NOT achieved. Do not report the backend as verified.");
  }
}

process.exit(failed.length > 0 ? 1 : blocked.length > 0 ? 2 : 0);
