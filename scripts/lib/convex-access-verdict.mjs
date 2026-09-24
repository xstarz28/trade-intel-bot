/**
 * Phase 234 — the Convex access verdict contract, as a pure function.
 *
 * WHY THIS IS SEPARATE FROM THE PROBE
 *
 * `verify-convex-access.mjs` does real DNS/TCP/TLS/HTTP I/O, so its verdict
 * depends on whatever network the machine happens to have. That is correct for
 * a diagnostic and fatal for a test: pinning the verdict of a live probe means
 * the test asserts the sandbox's egress policy, not the program's behaviour.
 * The Phase 200 test did exactly that, and failed on any machine with working
 * network access.
 *
 * The security-critical part is not the probing — it is the CLASSIFICATION:
 * given what was observed, which conclusions may be drawn. That is a pure
 * function of the observations, so it lives here and is tested with fixtures.
 * All eight network outcomes can then be exercised deterministically, including
 * ones the test machine cannot produce.
 *
 * THE PROPERTY THIS ENCODES
 *
 *   "Network reachability must never be reported as authentication evidence,
 *    and no authentication verdict may be emitted unless the control plane was
 *    actually reached and answered."
 *
 * Two directions, and both matter:
 *
 *   Blocked network claimed as auth evidence  -> a dead sandbox looks like a
 *     rejected key. Someone "confirms" the key is bad (or revoked) when it was
 *     never delivered. This is the one the Phase 200 test guarded.
 *
 *   Reached-and-rejected claimed as merely unreachable -> a genuinely refused
 *     credential looks like a firewall problem, and the operator goes hunting
 *     for an allowlist entry that was never the issue.
 *
 * The state set below is closed and total: every input lands in exactly one
 * state, the exit code is a function of the state, and `isAuthEvidence` is a
 * function of the state rather than something a branch can set independently.
 */

/** The layers that establish transport. A failure here proves nothing about credentials. */
export const TRANSPORT_LAYERS = ["dns", "tcp", "tls", "http"];

/**
 * Every verdict this diagnostic may emit.
 *
 * `AUTH_INDETERMINATE` is the Phase 234 addition. Before it, a transport
 * failure or a 5xx on the authenticated request collapsed into
 * `UNAUTHENTICATED`, whose classification reads "no usable credential was
 * presented" — a claim about the credential that the observation did not
 * support. The distinction is now explicit.
 */
export const VERDICT_STATES = [
  "NOT_REACHABLE",
  "AUTH_INDETERMINATE",
  "UNAUTHENTICATED",
  "CREDENTIALS_REJECTED",
  "AUTHENTICATED",
  "CONTROL_PLANE_ONLY",
];

/**
 * States that justify an authentication conclusion.
 *
 * Membership is the whole definition of `isAuthEvidence` — it is never set by
 * hand, so a verdict cannot claim auth evidence without being in this set.
 * Every member required a real answer from the service to be reached.
 */
export const AUTH_EVIDENCE_STATES = ["CREDENTIALS_REJECTED", "AUTHENTICATED", "CONTROL_PLANE_ONLY"];

/** Outcomes of the authenticated probe. Anything else is indeterminate. */
export const AUTH_STATES = [
  "not_attempted",
  "no_credentials",
  "credentials_rejected",
  "authenticated",
  "unreachable",
  "server_error",
];

export const EXIT_CODES = {
  AUTHENTICATED: 0,
  CONTROL_PLANE_ONLY: 1,
  UNAUTHENTICATED: 1,
  AUTH_INDETERMINATE: 1,
  CREDENTIALS_REJECTED: 1,
  NOT_REACHABLE: 2,
};

/** Tokens `blockedAt` may take. `auth` is a STEP, not a transport layer. */
export const BLOCKED_AT_TOKENS = [...TRANSPORT_LAYERS, "auth", "deployment-plane", "unknown"];

/**
 * The first transport layer that failed for the host that matters.
 *
 * Ordered by dependency: a TLS failure is only meaningful if DNS and TCP
 * succeeded, so the FIRST failure is the one to report, not any failure.
 */
export function failedTransportLayer(layers, primaryHost) {
  return TRANSPORT_LAYERS.find((layer) =>
    layers.some((l) => l.layer === layer && l.host === primaryHost && l.status === "FAIL"),
  );
}

/** A same-network control answered — separates a targeted block from an outage. */
export function controlsUp(layers) {
  return layers.some((l) => l.layer === "control" && l.status === "PASS");
}

/**
 * Classify an observation set into a verdict + exit code.
 *
 * Ordering is the security property, so it is deliberate:
 *   1. `!reachable` is decided FIRST and unconditionally. No auth state, however
 *      confident, can produce an auth verdict when the control plane was never
 *      reached. That single ordering rule is what makes
 *      NOT_REACHABLE -> CREDENTIALS_REJECTED impossible.
 *   2. Only then may credential states be considered.
 */
export function computeVerdict({
  layers,
  primaryHost,
  reachable,
  authState,
  deploymentPlaneReachable,
}) {
  const blockedTransport = failedTransportLayer(layers, primaryHost);
  const controls = controlsUp(layers);

  if (!reachable) {
    return {
      verdict: {
        state: "NOT_REACHABLE",
        // Never "auth": nothing was delivered, so nothing about auth was learned.
        blockedAt: blockedTransport ?? "unknown",
        classification: controls
          ? `egress to ${primaryHost} is blocked at the ${blockedTransport ?? "unknown"} layer, ` +
            "while same-network controls succeed — a targeted allowlist, not an outage"
          : "the whole network appears unavailable — controls failed too",
        isAuthEvidence: false,
        isRevocationEvidence: false,
      },
      exitCode: EXIT_CODES.NOT_REACHABLE,
    };
  }

  if (authState === "authenticated" && !deploymentPlaneReachable) {
    // The dangerous middle state: deploys would work, Evidence D would not.
    return {
      verdict: {
        state: "CONTROL_PLANE_ONLY",
        blockedAt: "deployment-plane",
        classification:
          "control plane reachable and authenticated, but *.convex.cloud / *.convex.site are " +
          "still blocked — deployment would succeed while Evidence D could never run. " +
          "Allowlist the deployment domains too.",
        isAuthEvidence: true,
        isRevocationEvidence: false,
      },
      exitCode: EXIT_CODES.CONTROL_PLANE_ONLY,
    };
  }

  if (authState === "authenticated") {
    return {
      verdict: {
        state: "AUTHENTICATED",
        blockedAt: null,
        classification:
          "control plane reachable, deploy key accepted, and the deployment domain family is reachable",
        isAuthEvidence: true,
        isRevocationEvidence: false,
      },
      exitCode: EXIT_CODES.AUTHENTICATED,
    };
  }

  // Reached, but not authenticated. The control plane ANSWERED, so a credential
  // conclusion is now legitimate — but only for the one outcome that actually
  // carries one.
  if (authState === "credentials_rejected") {
    return {
      verdict: {
        state: "CREDENTIALS_REJECTED",
        blockedAt: "auth",
        classification: "control plane reachable; the key was delivered and refused",
        isAuthEvidence: true,
        isRevocationEvidence: false,
      },
      exitCode: EXIT_CODES.CREDENTIALS_REJECTED,
    };
  }

  if (authState === "no_credentials") {
    return {
      verdict: {
        state: "UNAUTHENTICATED",
        blockedAt: "auth",
        classification: "control plane reachable; no usable credential was presented",
        isAuthEvidence: false,
        isRevocationEvidence: false,
      },
      exitCode: EXIT_CODES.UNAUTHENTICATED,
    };
  }

  // `unreachable` (the authenticated request hit a transport error),
  // `server_error` (the control plane answered 5xx), or anything unrecognised.
  //
  // These are NOT "no credential was presented": the credential was sent and
  // no verdict came back about it. Reporting them as UNAUTHENTICATED would
  // convert a transport failure into a statement about the key — the exact
  // class of error this module exists to prevent, pointing the other way.
  return {
    verdict: {
      state: "AUTH_INDETERMINATE",
      blockedAt: "auth",
      classification:
        `control plane reached, but the authenticated request produced no verdict from the ` +
        `service (${authState === "server_error" ? "server error" : "transport failure"}) — ` +
        "this says nothing about whether the credential is valid. Re-run when the control " +
        "plane answers authenticated requests.",
      isAuthEvidence: false,
      isRevocationEvidence: false,
    },
    exitCode: EXIT_CODES.AUTH_INDETERMINATE,
  };
}

/**
 * Turn the authenticated request's HTTP status into an auth state.
 *
 * Only a real answer from the service reaches this function, which is what
 * makes "the control plane was reached" a precondition rather than a promise:
 * a transport failure never gets a status to classify and goes to
 * `classifyAuthTransportFailure` instead.
 *
 * Semantics are unchanged from the original inline implementation — in
 * particular 2xx-4xx counts as authenticated, because an answer to an
 * authenticated request that is not a refusal means the credential was
 * accepted. 401/403 is the ONLY status that may produce a rejection claim.
 */
export function classifyAuthResponse(status) {
  if (status === 401 || status === 403) {
    return {
      state: "credentials_rejected",
      detail: `control plane answered HTTP ${status} — the key was presented and refused`,
    };
  }
  if (status >= 200 && status < 500) {
    return {
      state: "authenticated",
      detail: `control plane answered HTTP ${status} to an authenticated request`,
    };
  }
  return {
    state: "server_error",
    detail: `control plane answered HTTP ${status} — not an auth verdict`,
  };
}

/**
 * A transport failure on the authenticated request.
 *
 * CRITICAL: this is NOT an auth failure. Saying otherwise would let a blocked
 * network masquerade as a bad key — and, in the other direction, let someone
 * claim a key was "rejected" (or revoked) when it was never delivered to the
 * far end. There is no status here to classify, and no conclusion to draw.
 */
export function classifyAuthTransportFailure(error) {
  return {
    state: "unreachable",
    detail:
      `no answer to the authenticated request (${error?.cause?.code ?? error?.name}). ` +
      "This is a TRANSPORT failure and says nothing about the credential.",
  };
}

/**
 * Check a verdict against every invariant the contract promises.
 *
 * Returns a list of violations (empty means conformant) rather than throwing,
 * so both a live report and a hand-written fixture can be checked the same way.
 * A malformed or hand-edited result is expected to fail here — that is the
 * point: the phase200 test validates the probe's real output against these
 * rules, and separate tests prove the rules reject fabricated ones.
 *
 * `context.reachable` is the probe's own reachability flag. It is passed in
 * rather than inferred, because the invariant it enforces is precisely about
 * the relationship between reachability and the auth conclusion.
 */
export function validateVerdict(verdict, context = {}) {
  const problems = [];
  if (!verdict || typeof verdict !== "object") return ["verdict is not an object"];

  const { state, blockedAt, isAuthEvidence, isRevocationEvidence, classification } = verdict;

  if (!VERDICT_STATES.includes(state)) {
    problems.push(`unknown verdict state: ${JSON.stringify(state)}`);
  }

  // isAuthEvidence is DERIVED from the state, never independent of it.
  const expectedAuthEvidence = AUTH_EVIDENCE_STATES.includes(state);
  if (isAuthEvidence !== expectedAuthEvidence) {
    problems.push(
      `isAuthEvidence=${JSON.stringify(isAuthEvidence)} contradicts state ${JSON.stringify(state)} ` +
        `(expected ${expectedAuthEvidence})`,
    );
  }

  // This diagnostic observes transport and credential state only. It has no way
  // to learn that a key was revoked, so it must never imply it did.
  if (isRevocationEvidence !== false) {
    problems.push("isRevocationEvidence must always be false — this probe cannot observe revocation");
  }

  if (typeof classification !== "string" || classification.trim() === "") {
    problems.push("classification must be a non-empty string");
  }

  if (!(blockedAt === null || BLOCKED_AT_TOKENS.includes(blockedAt))) {
    problems.push(`blockedAt is not a known token: ${JSON.stringify(blockedAt)}`);
  }

  if (state === "NOT_REACHABLE" && !(blockedAt === "unknown" || TRANSPORT_LAYERS.includes(blockedAt))) {
    problems.push(
      `NOT_REACHABLE must name a transport layer, got ${JSON.stringify(blockedAt)} — ` +
        "an unreachable control plane cannot yield a credential verdict",
    );
  }

  if (state === "AUTHENTICATED" && blockedAt !== null) {
    problems.push(`AUTHENTICATED must have blockedAt null, got ${JSON.stringify(blockedAt)}`);
  }

  if (state === "CREDENTIALS_REJECTED" && blockedAt !== "auth") {
    problems.push(`CREDENTIALS_REJECTED must stop at the auth step, got ${JSON.stringify(blockedAt)}`);
  }

  // Reachability is a precondition for any credential conclusion.
  if (context.reachable === false) {
    if (AUTH_EVIDENCE_STATES.includes(state)) {
      problems.push(
        `${state} claims auth evidence while the control plane was never reached — ` +
          "an unreachable service cannot reject a credential it never received",
      );
    }
    if (blockedAt === "auth" || blockedAt === "deployment-plane") {
      problems.push(
        `blockedAt=${JSON.stringify(blockedAt)} implies the control plane was reached, ` +
          "but reachable=false",
      );
    }
  }

  return problems;
}
