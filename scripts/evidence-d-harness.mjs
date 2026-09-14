#!/usr/bin/env node
/**
 * Evidence D execution harness (D1–D10).
 *
 * Phase 200 created this. Phase 203 rewrote the execution half after an audit
 * found it could not have produced correct results against a real deployment:
 * it called `runProtectedAnalysis` with the wrong argument shape, and it sent
 * D9's forged payload to a nesting level the server never reads — so D9, the
 * single most security-critical observation, would have reported PASS without
 * the server having stripped anything. See docs/EVIDENCE-D.md §"Phase 203".
 *
 * Evidence D is "authenticated calls behave correctly against a REAL
 * deployment". This harness performs those calls and records what actually
 * happened, as a machine-readable artifact rather than someone's recollection.
 *
 * ## What this harness refuses to do
 *
 * - It will NOT run against localhost, a mock, or a substitute backend. A
 *   passing run against a stub is worse than no run: it manufactures false
 *   confidence in the one gate that exists to prevent exactly that.
 * - It has no fixture path, no mock mode, no result cache and no way to load a
 *   previous report. Every status in its output comes from an HTTP response
 *   received during this process's lifetime.
 * - It will NOT report PASS for a check it could not execute. Unexecuted checks
 *   are BLOCKED, and a run with any BLOCKED check is not Evidence D.
 * - It will NOT print an OTP, a session token, or any credential.
 * - It will NOT label a development deployment as production evidence.
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
 *   npm run evidence:d                      # derives config from the environment
 *   node scripts/evidence-d-harness.mjs --auto-env [--json]
 *     [--auth otp|anonymous] [--otp 123456] [--env-file path]
 *     [--production-evidence]
 *
 * Exit codes:
 *   0 = all ten observations captured and passing (Evidence D achieved)
 *   1 = at least one observation FAILED (a real defect)
 *   2 = could not execute, or the run was incomplete
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const autoEnv = args.includes("--auto-env");
const claimsProduction = args.includes("--production-evidence");
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const providedOtp = args.includes("--otp") ? flag("--otp") : null;
const authMode = (flag("--auth") ?? "otp").toLowerCase();
const envFileFlag = flag("--env-file");

const TIMEOUT_MS = 60_000;
const STARTED_AT = Date.now();

/** The ten observations, defined once so a refusal still reports all of them. */
const D_DEFINITIONS = [
  { id: "D1", title: "OTP email received at a real mailbox" },
  { id: "D2", title: "Sign-in creates an authenticated session" },
  { id: "D3", title: "Unauthenticated call to a protected route is rejected" },
  { id: "D4", title: "getMyEntitlement returns GUEST with remaining = 2" },
  { id: "D5", title: "A chargeable BUY/SELL consumes exactly one signal" },
  { id: "D6", title: "A WAIT/NO_TRADE consumes zero signals" },
  { id: "D7", title: "The third chargeable request returns LOCKED" },
  { id: "D8", title: "The LOCKED payload carries no directional/actionable field" },
  { id: "D9", title: "A forged provider payload is rejected server-side" },
  { id: "D10", title: "Provenance observedAt is provider-derived, not local" },
];

/**
 * The entitlement STATE MACHINE track (Phase 205).
 *
 * Separate from D1-D10 on purpose. D5-D8 measure the market-analysis
 * guarantee and are market-dependent; these measure the accounting guarantee
 * and are not. A green E-track is never reported as a green D-track.
 */
const E_DEFINITIONS = [
  ["E1", "A fresh authenticated GUEST starts with remaining = 2"],
  ["E2", "A non-chargeable event consumes nothing"],
  ["E3", "First chargeable consumption: remaining 2 -> 1"],
  ["E4", "Second chargeable consumption: remaining 1 -> 0"],
  ["E5", "Third chargeable attempt is refused, nothing charged"],
  ["E6", "Refusal is redacted and non-chargeable stays free after exhaustion"],
];
const E_MAP = Object.fromEntries(E_DEFINITIONS);

/** Directional fields the server must never expose. Mirrors PROTECTED_DECISION_FIELDS. */
const PROTECTED_FIELDS = [
  "recommendation",
  "conviction",
  "tradePlan",
  "positionSizing",
  "bias",
  "confidence",
  "analystThesis",
  "professionalThesis",
  "marketScenario",
  "forwardMarketPath",
  "longHorizonThesis",
  "evidenceChallenge",
  "decisionTrace",
  "decisionFingerprint",
  "keyLevels",
  "technicalSummary",
  "fundamentalSummary",
  "riskNote",
];

const entitlementChecks = [];
const checks = [];
const record = (id, status, detail, evidence = null) => {
  const def = D_DEFINITIONS.find((d) => d.id === id);
  checks.push({ id, title: def?.title ?? id, status, detail, evidence });
};
const recorded = (id) => checks.some((c) => c.id === id);

/* ------------------------------------------------------------------ *
 * Configuration discovery (§2 — derived, never hardcoded)
 * ------------------------------------------------------------------ */

/** Parse a dotenv-style file into a plain object. Values are never logged. */
function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip a trailing `# comment` that Convex appends to CONVEX_DEPLOYMENT.
    const hash = value.indexOf(" #");
    if (hash > 0) value = value.slice(0, hash).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build the effective environment.
 *
 * The real process environment always wins; a file only supplies what is
 * missing. File discovery is opt-in (`--auto-env` / `--env-file`) so that the
 * harness behaves identically on a machine that happens to have a .env.local
 * and one that does not — a test asserting a refusal must not start passing
 * because the developer has a deployment configured locally.
 */
function buildEnv() {
  const fromProcess = { ...process.env };
  let source = "process environment";
  let fileEnv = {};
  if (envFileFlag) {
    const p = resolve(process.cwd(), envFileFlag);
    if (!existsSync(p)) refuse(`--env-file ${envFileFlag} does not exist.`);
    fileEnv = parseEnvFile(p);
    source = `process environment + ${envFileFlag}`;
  } else if (autoEnv) {
    for (const candidate of [".env.local", ".env"]) {
      const p = resolve(process.cwd(), candidate);
      if (existsSync(p)) {
        fileEnv = parseEnvFile(p);
        source = `process environment + ${candidate}`;
        break;
      }
    }
  }
  const merged = { ...fileEnv };
  for (const [k, v] of Object.entries(fromProcess)) {
    if (v !== undefined && v !== "") merged[k] = v;
  }
  return { env: merged, source };
}

/**
 * Derive the deployment identity.
 *
 * `CONVEX_DEPLOYMENT` is written by the Convex CLI as `<type>:<name>` — it is
 * the authoritative statement of which deployment this working copy is wired
 * to, and its prefix is what separates a development deployment from a
 * production one. The URL alone cannot make that distinction: dev and prod
 * deployments are both `https://<name>.convex.cloud`.
 */
function deriveDeployment(env) {
  const raw = (env.CONVEX_DEPLOYMENT ?? "").trim();
  let type = null;
  let name = null;
  if (raw) {
    const m = /^(dev|prod|preview)\s*:\s*([A-Za-z0-9-]+)$/.exec(raw);
    if (m) {
      type = m[1];
      name = m[2];
    } else if (/^[A-Za-z0-9-]+$/.test(raw)) {
      name = raw;
    }
  }
  let url = (env.VITE_CONVEX_URL ?? env.CONVEX_URL ?? "").trim();
  if (!url && name) url = `https://${name}.convex.cloud`;
  return { raw, type, name, url };
}

function refuse(reason, extra = {}) {
  const payload = {
    evidenceD: "NOT EXECUTED",
    reason,
    ...extra,
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

const { env, source: envSource } = buildEnv();
const deployment = deriveDeployment(env);
const TEST_EMAIL = (env.EVIDENCE_D_EMAIL ?? "").trim();

if (authMode !== "otp" && authMode !== "anonymous") {
  refuse(`--auth must be "otp" or "anonymous" (got "${authMode}").`);
}
if (!deployment.url) {
  refuse(
    "No deployment is configured. Set VITE_CONVEX_URL (or CONVEX_DEPLOYMENT) — " +
      "there is no deployment to test against.",
  );
}

let parsed;
try {
  parsed = new URL(deployment.url);
} catch {
  refuse("The configured Convex URL is not a valid URL.");
}

// A substitute backend must never be able to produce Evidence D.
const LOCAL_RE = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)$/i;
if (LOCAL_RE.test(parsed.hostname)) {
  refuse(
    `The configured Convex URL points at a local host (${parsed.hostname}). ` +
      "Evidence D requires a real deployment; a local substitute cannot produce it.",
  );
}
if (parsed.protocol !== "https:") {
  refuse(`The configured Convex URL must be https (got ${parsed.protocol}).`);
}
if (!/\.convex\.(cloud|site)$/i.test(parsed.hostname)) {
  refuse(
    `The configured Convex URL host (${parsed.hostname}) is not a Convex deployment domain. ` +
      "Refusing to attribute Evidence D to an unknown backend.",
  );
}

// Wrong-deployment control: if the CLI recorded a deployment name, the URL has
// to be that deployment. Otherwise a stale VITE_CONVEX_URL would silently
// attribute this run to a different backend than the one just deployed.
if (deployment.name) {
  const hostName = parsed.hostname.split(".")[0];
  if (hostName !== deployment.name) {
    refuse(
      `Deployment mismatch: CONVEX_DEPLOYMENT names "${deployment.name}" but the URL targets ` +
        `"${hostName}". Refusing to attribute evidence to an ambiguous target.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Environment labelling (§5)
 * ------------------------------------------------------------------ */

/**
 * Which environment this evidence describes.
 *
 * Unknown is NOT treated as production: claiming production evidence from an
 * unlabelled deployment is exactly the mislabelling this section exists to
 * prevent. Unknown is reported as unknown, and cannot carry a production
 * claim.
 */
const DEPLOYMENT_ENVIRONMENT =
  deployment.type === "prod"
    ? "production"
    : deployment.type === "dev"
      ? "development"
      : deployment.type === "preview"
        ? "preview"
        : "unknown";

if (claimsProduction && DEPLOYMENT_ENVIRONMENT !== "production") {
  refuse(
    `--production-evidence was requested, but the configured deployment is ` +
      `"${DEPLOYMENT_ENVIRONMENT}". Production evidence requires an actual production ` +
      "deployment identity (CONVEX_DEPLOYMENT=prod:<name>).",
  );
}
if (DEPLOYMENT_ENVIRONMENT === "production" && authMode === "anonymous") {
  refuse(
    "Anonymous sign-in is a development convenience. Production Evidence D must exercise " +
      "the real OTP flow (--auth otp).",
  );
}
if (authMode === "otp" && !TEST_EMAIL) {
  refuse("EVIDENCE_D_EMAIL is not set — D1 needs a real mailbox to deliver to.");
}

/**
 * A development run can never be production evidence, however green it is.
 */
const EVIDENCE_CLASS =
  DEPLOYMENT_ENVIRONMENT === "production" && claimsProduction
    ? "PRODUCTION_EVIDENCE"
    : DEPLOYMENT_ENVIRONMENT === "development"
      ? "DEV_VERIFIED — NOT PRODUCTION EVIDENCE"
      : `${DEPLOYMENT_ENVIRONMENT.toUpperCase()}_VERIFIED — NOT PRODUCTION EVIDENCE`;

/* ------------------------------------------------------------------ *
 * Convex HTTP client
 * ------------------------------------------------------------------ */

const transport = { calls: 0, lastError: null };

async function callConvex(kind, functionName, functionArgs, token = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${parsed.origin}/api/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path: functionName, args: functionArgs ?? {}, format: "json" }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    transport.calls += 1;
    // Convex answers 200 with {status:"error"} for a thrown function error.
    const appError = body?.status === "error" ? (body.errorMessage ?? "error") : null;
    return {
      ok: response.ok && !appError,
      httpStatus: response.status,
      appError,
      value: body?.value,
      body,
    };
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? "unknown";
    transport.lastError = code;
    return { ok: false, httpStatus: 0, transportError: code, value: undefined, body: null };
  } finally {
    clearTimeout(timer);
  }
}

const query = (fn, a, t) => callConvex("query", fn, a, t);
const action = (fn, a, t) => callConvex("action", fn, a, t);
const mutation = (fn, a, t) => callConvex("mutation", fn, a, t);

const maskEmail = (email) => {
  const [user, domain] = String(email).split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
};

/**
 * The server takes ONE argument: `input`. Sending `{symbol, tradingStyle}` at
 * the top level yields INVALID_INPUT, which would read as a product defect
 * when it is really a harness defect. This shape is the contract.
 */
const analysisInput = (extra = {}) => ({
  input: {
    instrument: "EURUSD",
    instrumentType: "forex",
    timeframe: "1h",
    tradingStyle: "intraday",
    ...extra,
  },
});

/** Recommendations the server treats as chargeable (src/lib/entitlement/entitlement.ts). */
const CHARGEABLE_RECS = ["BUY", "SELL", "LONG", "SHORT"];

const usedOf = (entitlementValue) => Number(entitlementValue?.profitSignalsUsed ?? 0);

async function readEntitlement(token) {
  const r = await query("entitlements:getMyEntitlement", {}, token);
  return r.value ?? {};
}

/* ------------------------------------------------------------------ *
 * Observations
 * ------------------------------------------------------------------ */

async function run() {
  /* --- D3 first: needs no session, and proves the deployment answers. --- */
  const unauth = await action("protectedAnalysis:runProtectedAnalysis", analysisInput());
  if (unauth.httpStatus === 0) {
    refuse(
      `The deployment did not answer (${unauth.transportError}). This is a transport failure, ` +
        "not an authentication or authorisation result. Check connectivity before " +
        "attributing anything to the application.",
      { deployment: parsed.hostname, environment: DEPLOYMENT_ENVIRONMENT },
    );
  }
  const unauthStatus = unauth.value?.status;
  record(
    "D3",
    unauthStatus === "UNAUTHENTICATED" || unauth.httpStatus === 401 ? "PASS" : "FAIL",
    `deployment answered HTTP ${unauth.httpStatus}; application status=${unauthStatus ?? "n/a"}` +
      (unauthStatus === "UNAUTHENTICATED" ? " (no engine run, no payload)" : ""),
    {
      httpStatus: unauth.httpStatus,
      appStatus: unauthStatus,
      resultWithheld: unauth.value?.result === null,
    },
  );

  /* --- D1 + D2: establish a session. --- */
  let token = null;

  if (authMode === "anonymous") {
    record(
      "D1",
      "NOT_VERIFIED",
      "run used --auth anonymous: no OTP email was requested, so mailbox delivery was " +
        "neither attempted nor observed. D1 requires --auth otp against a provisioned mailbox.",
      { humanAttested: false, mechanism: "anonymous" },
    );
    const anon = await action("auth:signIn", { provider: "anonymous" });
    token = anon.value?.tokens?.token ?? anon.value?.token ?? null;
    record(
      "D2",
      token ? "PASS" : "FAIL",
      token
        ? "session established through the application's anonymous provider " +
          "(a supported development mechanism, not the OTP flow; token withheld)"
        : `no session (HTTP ${anon.httpStatus}${anon.appError ? `, ${anon.appError}` : ""})`,
      { sessionEstablished: Boolean(token), mechanism: "anonymous" },
    );
  } else {
    // Detect the non-delivering transport BEFORE attributing anything to D1.
    // `console` reports delivered:true and sends nothing; a code read out of a
    // server log is not evidence that mail reached a mailbox.
    const declaredTransport = (env.XSTARZ_EMAIL_TRANSPORT ?? "").trim().toLowerCase();
    if (declaredTransport === "console") {
      record(
        "D1",
        "BLOCKED",
        'XSTARZ_EMAIL_TRANSPORT is "console", which delivers nothing while reporting success. ' +
          "A code taken from a server log is not mailbox delivery.",
        { humanAttested: false, transport: "console" },
      );
      for (const d of D_DEFINITIONS) {
        if (!recorded(d.id)) record(d.id, "BLOCKED", "no authenticated session (D1 not completed)");
      }
      return;
    }

    const send = await action("auth:signIn", {
      provider: "email-otp",
      params: { email: TEST_EMAIL },
    });

    let otp = providedOtp;
    if (!otp && !asJson && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(
        `\n  A code was requested for ${maskEmail(TEST_EMAIL)}.\n` +
          "  Enter it ONLY if it arrived in the real mailbox (blank to leave D1 blocked): ",
      );
      rl.close();
      otp = answer.trim() || null;
    }

    if (!otp) {
      record(
        "D1",
        "BLOCKED",
        send.ok
          ? "send request accepted, but arrival in a mailbox was NOT observed. " +
            "Re-run with --otp <code> once the mail is in hand. " +
            "A 200 from the provider is not delivery."
          : `send request failed (HTTP ${send.httpStatus}${send.appError ? `, ${send.appError}` : ""})`,
        { sendAccepted: send.ok, humanAttested: false },
      );
      for (const d of D_DEFINITIONS) {
        if (!recorded(d.id)) record(d.id, "BLOCKED", "no authenticated session (D1 not completed)");
      }
      return;
    }

    record(
      "D1",
      send.ok ? "PASS" : "FAIL",
      send.ok
        ? `code delivered to ${maskEmail(TEST_EMAIL)} and supplied by a human operator ` +
          "(HUMAN-attested: the operator asserts it arrived in a real mailbox)"
        : `send request failed (HTTP ${send.httpStatus})`,
      { sendAccepted: send.ok, humanAttested: true, recipient: maskEmail(TEST_EMAIL) },
    );

    const verify = await action("auth:signIn", {
      provider: "email-otp",
      params: { email: TEST_EMAIL, code: otp },
    });
    token = verify.value?.tokens?.token ?? verify.value?.token ?? null;
    record(
      "D2",
      token ? "PASS" : "FAIL",
      token
        ? "session established from the OTP exchange (token withheld from this report)"
        : `no session (HTTP ${verify.httpStatus}${verify.appError ? `, ${verify.appError}` : ""})`,
      { sessionEstablished: Boolean(token), mechanism: "email-otp" },
    );
  }

  if (!token) {
    for (const d of D_DEFINITIONS) {
      if (!recorded(d.id)) record(d.id, "BLOCKED", "no authenticated session");
    }
    return;
  }

  /* --- D4: a fresh guest starts with two free profit signals. --- */
  //
  // `getMyEntitlement` deliberately answers an UNAUTHENTICATED caller with the
  // guest SHAPE: plan GUEST, remaining 2, used 0 — identical to a real fresh
  // guest except for `authenticated: false`. Checking only plan/remaining
  // therefore passes whether or not the session works, which is exactly how
  // the Phase 204 run reported D4 PASS while the backend was rejecting every
  // session. The `authenticated` flag is the load-bearing assertion.
  const e0 = await readEntitlement(token);
  const startUsed = usedOf(e0);
  if (e0.authenticated !== true) {
    record(
      "D4",
      "FAIL",
      `the deployment did not recognise the session: authenticated=${e0.authenticated}, ` +
        `reason=${e0.reason ?? "n/a"}. The guest-shaped response (plan=${e0.plan}, ` +
        `remaining=${e0.remaining}) is the UNAUTHENTICATED fallback, not a real entitlement.`,
      e0,
    );
    for (const d of D_DEFINITIONS) {
      if (!recorded(d.id)) {
        record(
          d.id,
          "BLOCKED",
          "the session was not recognised by the deployment (see D4); no authenticated " +
            "observation can be made.",
        );
      }
    }
    return { sessionRecognised: false };
  }
  if (e0.plan === "GUEST" && e0.remaining === 2 && startUsed === 0) {
    record(
      "D4",
      "PASS",
      `authenticated=true plan=${e0.plan} remaining=${e0.remaining} limit=${e0.limit}`,
      e0,
    );
  } else if (e0.plan === "GUEST" && startUsed > 0) {
    // Re-running against an already-used identity is an operator condition,
    // not a product defect. Reporting FAIL here would be a false alarm.
    record(
      "D4",
      "NOT_VERIFIED",
      `this identity has already consumed ${startUsed} signal(s), so the initial-state ` +
        "assertion cannot be made. D4 needs a fresh account: use a new mailbox, or " +
        "--auth anonymous, which mints a new identity per run.",
      e0,
    );
  } else {
    record("D4", "FAIL", `plan=${e0.plan} remaining=${e0.remaining} limit=${e0.limit}`, e0);
  }

  /* --- Client cannot self-grant Premium (§7). --- */
  const forcePremium = await mutation(
    "entitlements:grantPremium",
    { premiumUntil: Date.now() + 86_400_000 },
    token,
  );
  const afterForce = await readEntitlement(token);
  const premiumForced = afterForce.plan === "PREMIUM";
  const premiumProbe = {
    rejected: !forcePremium.ok && !premiumForced,
    planAfter: afterForce.plan,
    serverMessage: forcePremium.appError ? "rejected by server" : null,
  };

  /* --- D9 BEFORE exhaustion. --- */
  //
  // Ordering matters and is not cosmetic. Once the account is LOCKED the
  // response is redacted to a minimal payload, so a forged value could not
  // appear in it no matter what the server did with it — the check would pass
  // vacuously. D9 is therefore run while results are still deliverable.
  const FORGED_PRICE = 99999.99;
  const FORGED_SOURCE = "forged-by-client-evidence-d";
  const forgedBefore = usedOf(await readEntitlement(token));
  const forged = await action(
    "protectedAnalysis:runProtectedAnalysis",
    analysisInput({
      currentPrice: FORGED_PRICE,
      marketData: {
        price: { price: FORGED_PRICE, timestamp: 0, source: FORGED_SOURCE },
        provider: FORGED_SOURCE,
        fetchTimestamp: 0,
      },
      instrumentSpec: { contractSize: 100000, quantityStep: 1, source: FORGED_SOURCE },
      newsContext: "Fed signals hawkish stance, rate hike",
      economicEvents: "forged high-impact event",
    }),
    token,
  );
  const forgedSerialized = JSON.stringify(forged.body ?? {});
  const echoes = [];
  if (forgedSerialized.includes(FORGED_SOURCE)) echoes.push("source label");
  if (forgedSerialized.includes(String(FORGED_PRICE))) echoes.push("forged price");
  const forgedStatus = forged.value?.status;
  const forgedRejectedAsInput = forgedStatus === "INVALID_INPUT";
  const forgedRan = forgedStatus === "DELIVERED" || forgedStatus === "LOCKED";

  if (!forgedRan && !forgedRejectedAsInput) {
    record(
      "D9",
      "BLOCKED",
      `the forged request did not produce an evaluable response (status=${forgedStatus ?? "n/a"}, ` +
        `HTTP ${forged.httpStatus}).`,
      { status: forgedStatus },
    );
  } else if (echoes.length > 0) {
    record(
      "D9",
      "FAIL",
      `the deployment echoed client-supplied provider evidence (${echoes.join(", ")}). ` +
        "Provenance is compromised: a client can state market facts.",
      { echoes, status: forgedStatus },
    );
  } else {
    record(
      "D9",
      "PASS",
      `client-supplied provider evidence (price, source label, instrument spec and ` +
        `directional free text) did not reach the result; status=${forgedStatus}. ` +
        "The server discarded it and acquired its own evidence.",
      { echoes: [], status: forgedStatus, forgedFieldsSent: 5 },
    );
  }

  /* --- D5: a chargeable recommendation consumes exactly one. --- */
  const beforeBuy = usedOf(await readEntitlement(token));
  const buy = await action("protectedAnalysis:runProtectedAnalysis", analysisInput(), token);
  const afterBuy = await readEntitlement(token);
  const buyRec = buy.value?.result?.recommendation;
  const buyStatus = buy.value?.status;
  const consumed = usedOf(afterBuy) - beforeBuy;
  if (buyStatus === "UNAUTHENTICATED") {
    record(
      "D5",
      "BLOCKED",
      "the deployment answered UNAUTHENTICATED, so consumption was never exercised. " +
        "This is a session/identity failure, not a statement about chargeability.",
      { status: buyStatus },
    );
  } else if (buyStatus === "LOCKED") {
    record(
      "D5",
      "NOT_VERIFIED",
      "the allowance was already exhausted before this observation, so a single " +
        "consumption could not be measured. Re-run with a fresh identity.",
      { status: buyStatus },
    );
  } else if (CHARGEABLE_RECS.includes(String(buyRec))) {
    record(
      "D5",
      consumed === 1 ? "PASS" : "FAIL",
      `recommendation=${buyRec}, consumed=${consumed} (expected exactly 1), charged=${
        buy.value?.entitlement?.charged
      }`,
      { recommendation: buyRec, consumed },
    );
  } else {
    record(
      "D5",
      "NOT_VERIFIED",
      `the engine returned ${buyRec ?? buyStatus}, which is not a chargeable directional ` +
        "signal. The engine is never forced to produce one; re-run when live conditions " +
        "yield BUY/SELL.",
      { recommendation: buyRec, consumed },
    );
  }

  /* --- D6: a non-chargeable recommendation consumes nothing. --- */
  const beforeWait = usedOf(await readEntitlement(token));
  const wait = await action(
    "protectedAnalysis:runProtectedAnalysis",
    analysisInput({ instrument: "XAUUSD", instrumentType: "commodity", timeframe: "1d" }),
    token,
  );
  const afterWait = await readEntitlement(token);
  const waitRec = wait.value?.result?.recommendation;
  const waitStatus = wait.value?.status;
  const waitConsumed = usedOf(afterWait) - beforeWait;
  if (waitStatus === "UNAUTHENTICATED") {
    record(
      "D6",
      "BLOCKED",
      "the deployment answered UNAUTHENTICATED, so the non-chargeable path was never " +
        "exercised. This is a session/identity failure.",
      { status: waitStatus },
    );
  } else if (["WAIT", "NO_TRADE"].includes(String(waitRec))) {
    record(
      "D6",
      waitConsumed === 0 ? "PASS" : "FAIL",
      `recommendation=${waitRec}, consumed=${waitConsumed} (expected 0), charged=${
        wait.value?.entitlement?.charged
      }`,
      { recommendation: waitRec, consumed: waitConsumed },
    );
  } else {
    record(
      "D6",
      "NOT_VERIFIED",
      `the engine returned ${waitRec ?? waitStatus}; a WAIT/NO_TRADE did not occur in this run. ` +
        "Re-run when live conditions yield one — the engine must never be forced.",
      { recommendation: waitRec, consumed: waitConsumed },
    );
  }

  /* --- D7 + D8: exhaustion must LOCK, and reveal nothing. --- */
  //
  // LOCKED is only reachable when the ENGINE ITSELF produces a chargeable
  // recommendation: `gateDecision` returns DELIVERED for WAIT/NO_TRADE
  // regardless of allowance. So on a quiet market this observation cannot be
  // made at all. That is a test-condition limitation, not a product defect,
  // and it is reported NOT_VERIFIED — never FAIL, and never "fixed" by
  // fabricating a BUY, which would prove nothing about the real engine.
  //
  // The entitlement STATE MACHINE is verified separately and unconditionally
  // by the E-track below, through a real deployed authenticated boundary.
  let locked = null;
  let attempts = 0;
  let lastStatus = null;
  const observedRecs = [];
  for (; attempts < 4 && !locked; attempts += 1) {
    const r = await action(
      "protectedAnalysis:runProtectedAnalysis",
      analysisInput({ instrument: "GBPUSD", timeframe: "15min" }),
      token,
    );
    lastStatus = r.value?.status ?? null;
    const rec = r.value?.result?.recommendation;
    if (rec !== undefined) observedRecs.push(String(rec));
    if (lastStatus === "LOCKED") locked = r.value;
    // An UNAUTHENTICATED reply means the session was not accepted. Retrying
    // cannot change that, and reporting "no LOCKED produced" would blame the
    // entitlement backend for an authentication failure.
    if (lastStatus === "UNAUTHENTICATED") break;
  }
  const finalEnt = await readEntitlement(token);
  const sawChargeable = observedRecs.some((r) => CHARGEABLE_RECS.includes(r));
  if (lastStatus === "UNAUTHENTICATED") {
    record(
      "D7",
      "BLOCKED",
      "the deployment answered UNAUTHENTICATED to an authenticated request, so the " +
        "allowance was never exercised (used=" +
        `${usedOf(finalEnt)} limit=${finalEnt.limit}). This is a session/identity failure, ` +
        "NOT evidence about the entitlement rules.",
      { locked: false, attempts, lastStatus, used: usedOf(finalEnt) },
    );
  } else if (locked) {
    record(
      "D7",
      "PASS",
      `an exhausted account received LOCKED after ${attempts} request(s); ` +
        `used=${usedOf(finalEnt)} limit=${finalEnt.limit} upgradeRequired=${finalEnt.upgradeRequired}`,
      { locked: true, attempts, lastStatus, used: usedOf(finalEnt), observedRecs },
    );
  } else if (!sawChargeable) {
    record(
      "D7",
      "NOT_VERIFIED",
      "no real chargeable signal occurred: the engine returned " +
        `${observedRecs.join(", ") || "no recommendation"} over ${attempts} request(s), and a ` +
        "non-actionable result is delivered free by design, so LOCKED is unreachable. " +
        "This is a market-condition limitation, not a product defect. The entitlement " +
        "state machine is verified independently by E1-E6.",
      { locked: false, attempts, observedRecs, used: usedOf(finalEnt) },
    );
  } else {
    record(
      "D7",
      "FAIL",
      `the engine produced a chargeable signal (${observedRecs.join(", ")}) but the ` +
        `allowance never locked after ${attempts} requests ` +
        `(used=${usedOf(finalEnt)} limit=${finalEnt.limit}, lastStatus=${lastStatus})`,
      { locked: false, attempts, lastStatus, observedRecs, used: usedOf(finalEnt) },
    );
  }

  if (locked) {
    // Allowlist-by-omission on the server means an unlisted field is withheld.
    // Verify the negative directly against the protected field list.
    const DIRECTIONAL = [
      "recommendation",
      "conviction",
      "tradePlan",
      "positionSizing",
      "bias",
      "confidence",
      "analystThesis",
      "professionalThesis",
      "marketScenario",
      "forwardMarketPath",
      "longHorizonThesis",
      "evidenceChallenge",
      "decisionTrace",
      "decisionFingerprint",
      "keyLevels",
      "technicalSummary",
      "fundamentalSummary",
      "riskNote",
      "direction",
      "entry",
      "stopLoss",
      "takeProfit",
      "side",
    ];
    const serialized = JSON.stringify(locked.result ?? {});
    const leaked = DIRECTIONAL.filter((f) => serialized.includes(`"${f}"`));
    const tellsSignalExists = locked.result?.hadActionableSignal === true;
    record(
      "D8",
      leaked.length === 0 ? "PASS" : "FAIL",
      leaked.length === 0
        ? `LOCKED payload contains none of the ${DIRECTIONAL.length} directional/actionable ` +
          `fields; it discloses only that a signal existed (hadActionableSignal=${tellsSignalExists}), ` +
          "never which way it points"
        : `LOCKED payload leaked: ${leaked.join(", ")}`,
      { leakedFields: leaked, checkedFields: DIRECTIONAL.length },
    );
  } else if (lastStatus === "UNAUTHENTICATED") {
    record("D8", "BLOCKED", "no LOCKED payload to inspect (session not recognised)");
  } else {
    record(
      "D8",
      "NOT_VERIFIED",
      "no real chargeable signal occurred, so no LOCKED payload was produced to inspect. " +
        "The redaction contract is exercised against the real payload only; E6 separately " +
        "confirms the server refuses an exhausted chargeable request.",
      { observedRecs },
    );
  }

  /* --- Post-exhaustion safety: WAIT must stay free, nothing substituted. --- */
  const postLockWait = await action(
    "protectedAnalysis:runProtectedAnalysis",
    analysisInput({ instrument: "XAUUSD", instrumentType: "commodity", timeframe: "1d" }),
    token,
  );
  const postLockEnt = await readEntitlement(token);
  const postLockSafety = {
    statusAfterExhaustion: postLockWait.value?.status,
    usedDidNotGrowBeyondLimit: usedOf(postLockEnt) >= usedOf(finalEnt),
    planStillGuest: postLockEnt.plan === "GUEST",
  };

  /* ================================================================ *
   * E-TRACK — the entitlement STATE MACHINE, independent of the market
   * ================================================================ *
   *
   * D5-D8 verify the MARKET ANALYSIS guarantee: that the real engine's own
   * output drives charging. They are market-dependent by nature — on a quiet
   * market no chargeable signal exists, and forcing one would invalidate the
   * very thing they measure.
   *
   * The ENTITLEMENT guarantee is a separate claim: given a chargeable event,
   * the counter moves 2 -> 1 -> 0 and then refuses. That does not need a live
   * BUY, and it should not be hostage to one.
   *
   * This track exercises it through `entitlements:consumeProfitSignal`, which
   * is a REAL deployed, authenticated, client-callable mutation — the same
   * least-privileged boundary a client already has. It is emphatically NOT a
   * test backdoor:
   *
   *   - it is authenticated and rejects anonymous callers;
   *   - it returns ACCOUNTING ONLY (allowed/charged/plan/remaining/reason) and
   *     never a recommendation, entry, stop or target, so it cannot be used to
   *     obtain a signal without paying;
   *   - it can only ever DEBIT (nextUsageCount is min(used+1, LIMIT)); there is
   *     no path by which it grants allowance or Premium;
   *   - it is deliberately NOT wired into any delivery path (Phase 174), so it
   *     is not a bypass of `runProtectedAnalysis` — the directional payload is
   *     unreachable through it.
   *
   * What it CANNOT prove is that the engine's own output decides chargeability
   * — it takes the recommendation as an argument. That is precisely why this
   * track does not replace D5-D8, and why a green E-track is never reported as
   * a green D-track.
   */
  const eRecord = (id, title, status, detail, evidence = null) => {
    entitlementChecks.push({ id, title, status, detail, evidence });
  };

  // The E-track needs a pristine identity. The D-track has already spent
  // allowance on this one, so only run it when we can mint a fresh session
  // the same legitimate way the application does.
  let eToken = null;
  if (authMode === "anonymous") {
    const freshAnon = await action("auth:signIn", { provider: "anonymous" });
    eToken = freshAnon.value?.tokens?.token ?? freshAnon.value?.token ?? null;
  }

  if (!eToken) {
    for (const [id, title] of E_DEFINITIONS) {
      eRecord(
        id,
        title,
        "NOT_VERIFIED",
        authMode === "anonymous"
          ? "could not mint a fresh identity for the state-machine track."
          : "the state-machine track needs a pristine identity; with --auth otp the D-track " +
            "has already consumed allowance on this mailbox. Re-run with --auth anonymous " +
            "against a development deployment.",
      );
    }
  } else {
    const eRead = async () => (await query("entitlements:getMyEntitlement", {}, eToken)).value ?? {};
    const eConsume = (rec) =>
      mutation("entitlements:consumeProfitSignal", { recommendation: rec }, eToken);

    // E1 — a fresh authenticated GUEST starts at remaining = 2.
    const s0 = await eRead();
    eRecord(
      "E1",
      E_MAP.E1,
      s0.authenticated === true && s0.plan === "GUEST" && s0.remaining === 2 ? "PASS" : "FAIL",
      `authenticated=${s0.authenticated} plan=${s0.plan} remaining=${s0.remaining} ` +
        `used=${usedOf(s0)}`,
      s0,
    );

    // E2 — a non-chargeable event must not move the counter.
    const beforeFree = usedOf(s0);
    const freeCall = await eConsume("WAIT");
    const afterFree = await eRead();
    eRecord(
      "E2",
      E_MAP.E2,
      freeCall.value?.charged === false && usedOf(afterFree) === beforeFree ? "PASS" : "FAIL",
      `reason=${freeCall.value?.reason} charged=${freeCall.value?.charged}; ` +
        `used ${beforeFree} -> ${usedOf(afterFree)} (expected unchanged)`,
      { reason: freeCall.value?.reason, before: beforeFree, after: usedOf(afterFree) },
    );

    // E3 — first chargeable consumption: remaining 2 -> 1.
    const c1 = await eConsume("BUY");
    const s1 = await eRead();
    eRecord(
      "E3",
      E_MAP.E3,
      c1.value?.charged === true && s1.remaining === 1 && usedOf(s1) === 1 ? "PASS" : "FAIL",
      `reason=${c1.value?.reason} charged=${c1.value?.charged}; remaining=${s1.remaining} ` +
        `used=${usedOf(s1)} (expected remaining 1, used 1)`,
      { reason: c1.value?.reason, remaining: s1.remaining, used: usedOf(s1) },
    );

    // E4 — second chargeable consumption: remaining 1 -> 0.
    const c2 = await eConsume("SELL");
    const s2 = await eRead();
    eRecord(
      "E4",
      E_MAP.E4,
      c2.value?.charged === true && s2.remaining === 0 && usedOf(s2) === 2 ? "PASS" : "FAIL",
      `reason=${c2.value?.reason} charged=${c2.value?.charged}; remaining=${s2.remaining} ` +
        `used=${usedOf(s2)} (expected remaining 0, used 2)`,
      { reason: c2.value?.reason, remaining: s2.remaining, used: usedOf(s2) },
    );

    // E5 — the third chargeable attempt is refused, and nothing is charged.
    const c3 = await eConsume("BUY");
    const s3 = await eRead();
    const refused =
      c3.value?.allowed === false &&
      c3.value?.upgradeRequired === true &&
      c3.value?.charged === false;
    eRecord(
      "E5",
      E_MAP.E5,
      refused && usedOf(s3) === 2 ? "PASS" : "FAIL",
      `allowed=${c3.value?.allowed} upgradeRequired=${c3.value?.upgradeRequired} ` +
        `reason=${c3.value?.reason}; used stayed ${usedOf(s3)} (must not exceed the limit)`,
      { allowed: c3.value?.allowed, reason: c3.value?.reason, used: usedOf(s3) },
    );

    // E6 — an exhausted account still gets no directional payload, and the
    // refusal itself must not leak one.
    const refusalBody = JSON.stringify(c3.value ?? {});
    const leakedInRefusal = PROTECTED_FIELDS.filter((f) => refusalBody.includes(`"${f}"`));
    // And a non-chargeable request must STILL be free after exhaustion.
    const postExhaustFree = await eConsume("NO_TRADE");
    const s4 = await eRead();
    eRecord(
      "E6",
      E_MAP.E6,
      leakedInRefusal.length === 0 &&
        postExhaustFree.value?.charged === false &&
        usedOf(s4) === 2 &&
        s4.plan === "GUEST"
        ? "PASS"
        : "FAIL",
      leakedInRefusal.length === 0
        ? `the refusal carries no directional field; a NO_TRADE after exhaustion is still ` +
          `free (charged=${postExhaustFree.value?.charged}), plan stayed ${s4.plan}, ` +
          `used stayed ${usedOf(s4)}`
        : `the refusal leaked: ${leakedInRefusal.join(", ")}`,
      { leakedInRefusal, planAfter: s4.plan, usedAfter: usedOf(s4) },
    );
  }

  /* --- D10: observedAt must come from the provider acquisition path. --- */
  //
  // `runProtectedAnalysis` does not return provenance to the client (it is
  // logged server-side), so provenance is probed where it is actually exposed:
  // the acquisition action itself, which reports `observedAt` and the
  // acquisition mode it used.
  const probeStart = Date.now();
  const md = await action(
    "marketData:fetchMarketData",
    { instrument: "EURUSD", instrumentType: "forex", timeframe: "1h" },
    token,
  );
  const probeEnd = Date.now();
  const mdValue = md.value ?? {};
  const observedAt = typeof mdValue.observedAt === "number" ? mdValue.observedAt : null;
  const acquisition = mdValue.acquisition ?? null;

  if (mdValue.success === false || mdValue.errorCode) {
    record(
      "D10",
      "BLOCKED",
      `the provider acquisition path could not run (${mdValue.errorCode ?? "unavailable"}). ` +
        "Provenance cannot be evidenced without a live provider credential — and a " +
        "fabricated timestamp must never be accepted in its place.",
      { errorCode: mdValue.errorCode ?? null, acquisition },
    );
  } else if (observedAt === null) {
    record(
      "D10",
      "BLOCKED",
      "the acquisition response carried no observedAt to evaluate.",
      { acquisition },
    );
  } else if (observedAt > probeEnd + 5_000) {
    record(
      "D10",
      "FAIL",
      `observedAt (${new Date(observedAt).toISOString()}) is in the future relative to the ` +
        "request. A provider observation cannot post-date the request that produced it.",
      { observedAt, acquisition },
    );
  } else if (acquisition === "cache-reused" && observedAt >= probeStart) {
    record(
      "D10",
      "FAIL",
      "the leg reported cache-reused but stamped observedAt at request time — " +
        "request time was substituted for observation time.",
      { observedAt, acquisition, probeStart },
    );
  } else {
    const ageMs = probeEnd - observedAt;
    record(
      "D10",
      "PASS",
      `observedAt=${new Date(observedAt).toISOString()} with acquisition=${acquisition ?? "n/a"}; ` +
        `age at response ${ageMs}ms. The value comes from the provider acquisition path and ` +
        "was not substituted with request time.",
      { observedAt, acquisition, ageMs },
    );
  }

  return { premiumProbe, postLockSafety };
}

const safety = (await run()) ?? {};

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

checks.sort(
  (a, b) =>
    D_DEFINITIONS.findIndex((d) => d.id === a.id) - D_DEFINITIONS.findIndex((d) => d.id === b.id),
);

const failed = checks.filter((c) => c.status === "FAIL");
const blocked = checks.filter((c) => c.status === "BLOCKED");
const notVerified = checks.filter((c) => c.status === "NOT_VERIFIED");
const passed = checks.filter((c) => c.status === "PASS");

const complete = failed.length === 0 && blocked.length === 0 && notVerified.length === 0;
const evidenceD = failed.length > 0 ? "FAILED" : complete ? "ACHIEVED" : "INCOMPLETE";

const ePassed = entitlementChecks.filter((c) => c.status === "PASS");
const eFailed = entitlementChecks.filter((c) => c.status === "FAIL");
const eUnresolved = entitlementChecks.filter(
  (c) => c.status !== "PASS" && c.status !== "FAIL",
);
const entitlementStateMachine =
  entitlementChecks.length === 0
    ? "NOT EXECUTED"
    : eFailed.length > 0
      ? "FAILED"
      : eUnresolved.length > 0
        ? "INCOMPLETE"
        : "VERIFIED";

const report = {
  evidenceD,
  evidenceClass: complete && failed.length === 0 ? EVIDENCE_CLASS : `${EVIDENCE_CLASS} (INCOMPLETE)`,
  environment: DEPLOYMENT_ENVIRONMENT,
  deployment: { host: parsed.hostname, name: deployment.name ?? null, declared: deployment.type },
  productionEvidence: evidenceD === "ACHIEVED" && EVIDENCE_CLASS === "PRODUCTION_EVIDENCE",
  configSource: envSource,
  authMechanism: authMode === "anonymous" ? "anonymous (development)" : "email-otp",
  capturedAt: new Date().toISOString(),
  durationMs: Date.now() - STARTED_AT,
  transportCalls: transport.calls,
  summary: {
    passed: passed.length,
    failed: failed.length,
    blocked: blocked.length,
    notVerified: notVerified.length,
  },
  safetyProbes: safety,
  checks,
  // Reported alongside D1-D10, never merged into them: a verified state
  // machine does not make the market-analysis guarantee verified.
  entitlementStateMachine: {
    verdict: entitlementStateMachine,
    note:
      "Exercised through entitlements:consumeProfitSignal, a real deployed " +
      "authenticated boundary that returns accounting only and can never grant " +
      "allowance. It does NOT prove the engine decides chargeability — that is D5-D8.",
    summary: {
      passed: ePassed.length,
      failed: eFailed.length,
      unresolved: eUnresolved.length,
    },
    checks: entitlementChecks,
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Evidence D harness — ${parsed.hostname} [${DEPLOYMENT_ENVIRONMENT}]`);
  console.log("─".repeat(78));
  for (const c of checks) {
    console.log(`  ${c.status.padEnd(13)} ${c.id.padEnd(4)} ${c.title}`);
    console.log(`  ${" ".repeat(18)} ${c.detail}`);
  }
  if (entitlementChecks.length > 0) {
    console.log("─".repeat(78));
    console.log("  ENTITLEMENT STATE MACHINE (independent of market conditions)");
    for (const c of entitlementChecks) {
      console.log(`  ${c.status.padEnd(13)} ${c.id.padEnd(4)} ${c.title}`);
      console.log(`  ${" ".repeat(18)} ${c.detail}`);
    }
  }
  console.log("─".repeat(78));
  console.log(`EVIDENCE D: ${evidenceD}`);
  if (entitlementChecks.length > 0) {
    console.log(`ENTITLEMENT STATE MACHINE: ${entitlementStateMachine}`);
  }
  console.log(
    `  ${passed.length} passed, ${failed.length} failed, ` +
      `${blocked.length} blocked, ${notVerified.length} not verified`,
  );
  console.log(`  CLASS: ${report.evidenceClass}`);
  if (!report.productionEvidence) {
    console.log("  This run is NOT production release evidence.");
  }
  if (evidenceD !== "ACHIEVED") {
    console.log("  Evidence D is NOT achieved. Do not report the backend as verified.");
  }
}

process.exit(failed.length > 0 ? 1 : complete ? 0 : 2);
