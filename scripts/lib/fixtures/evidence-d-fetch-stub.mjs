/**
 * Phase 235 test fixture — a deterministic fake `fetch` for the Evidence D harness.
 *
 * The harness classifies what a deployment answers, but the guard suite proved
 * that classification by pointing the harness at a real host and asserting the
 * *machine's* network outcome. That is not a property of the harness: an
 * egress-blocked sandbox produced a transport failure, while a networked runner
 * resolved the wildcard host, completed TLS, got an HTTP answer, and failed the
 * assertion for the opposite reason.
 *
 * This stub takes the network out of the equation. It is loaded into the guard's
 * CHILD process only (`NODE_OPTIONS=--import <this file>`), so the harness is
 * unmodified and unaware — no test-only hook, no weakened check.
 * `EVIDENCE_D_STUB_MODE` selects the answer the fake deployment gives, so every
 * branch of the classification can be exercised deterministically, on any
 * machine, in milliseconds.
 *
 * Fidelity notes: transport failures are shaped the way Node shapes them (the
 * errno lives on `error.cause.code`, which is what the harness reads), and the
 * Convex success envelope mirrors `ProtectedAnalysisResponse` in
 * `src/convex/protectedAnalysis.ts`.
 */

const MODE = process.env.EVIDENCE_D_STUB_MODE ?? "tls";

const transportFailure = (code) =>
  Object.assign(new Error(`stub: simulated transport failure (${code})`), {
    cause: { code },
  });

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** `runProtectedAnalysis` for an unauthenticated caller, per the server contract. */
const UNAUTHENTICATED_VALUE = {
  status: "UNAUTHENTICATED",
  entitlement: {
    authenticated: false,
    plan: "GUEST",
    remaining: null,
    limit: 1,
    upgradeRequired: false,
  },
  result: null,
};

const RESPONSES = {
  // --- transport never completed: the errno Node would report -------------
  dns: () => {
    throw transportFailure("ENOTFOUND");
  },
  tcp: () => {
    throw transportFailure("ECONNREFUSED");
  },
  tls: () => {
    throw transportFailure("ECONNRESET");
  },
  cert: () => {
    throw transportFailure("ERR_TLS_CERT_ALTNAME_INVALID");
  },
  timeout: () => {
    throw transportFailure("ETIMEDOUT");
  },
  // A failure with no errno at all: the layer must degrade to `unknown`, never
  // be guessed into an authentication conclusion.
  opaque: () => {
    throw new Error("stub: simulated failure with no errno");
  },

  // --- the service answered, but is not serving --------------------------
  "http-503": () =>
    json(503, { status: "error", errorMessage: "service unavailable" }),
  "http-404": () => json(404, { status: "error", errorMessage: "not found" }),

  // --- the service answered with an authentication outcome ----------------
  "unauth-401": () =>
    json(401, { status: "error", errorMessage: "Unauthenticated" }),
  "unauth-app": () =>
    json(200, { status: "success", value: UNAUTHENTICATED_VALUE }),

  // --- the service never answers at all ----------------------------------
  // Used to prove `--timeout` is honoured: without it the harness would wait its
  // full default before refusing. Faithful to a real transport: an abort is
  // OBSERVED through the signal and rejects with an AbortError, which is how
  // undici surfaces a timed-out fetch. A stub that ignored the signal would
  // never settle and node would exit on an unsettled top-level await instead.
  hang: (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () =>
        reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener("abort", abort, { once: true });
    }),

  // --- the service answered, but not in a shape the harness can read ------
  "malformed-200": () => json(200, { ok: true }),
  "non-json": () => new Response("<html>gateway</html>", { status: 200 }),
};

const answer = RESPONSES[MODE];
if (!answer) {
  throw new Error(
    `evidence-d fetch stub: unknown EVIDENCE_D_STUB_MODE "${MODE}" ` +
      `(expected one of ${Object.keys(RESPONSES).join(", ")})`,
  );
}

globalThis.fetch = async (url, init) => answer(url, init);

// Fail loudly rather than silently testing the real network if the stub is ever
// loaded without an explicit mode by mistake.
if (!process.env.EVIDENCE_D_STUB_MODE) {
  process.emitWarning(
    "evidence-d fetch stub loaded without EVIDENCE_D_STUB_MODE; defaulting to tls",
  );
}
