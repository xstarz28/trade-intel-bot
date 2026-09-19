/**
 * Phase 235 — Evidence D probe-result classification, as a pure function.
 *
 * WHY THIS IS SEPARATE FROM THE HARNESS
 *
 * `evidence-d-harness.mjs` probes a live deployment. What it OBSERVES depends on
 * the network the machine happens to have; what it may CONCLUDE does not. The
 * Phase 203 tests that asserted the observed outcome (`exit 2` plus a transport
 * `reason`) were really asserting the sandbox's egress policy: for a host that
 * resolves but is not a real deployment, a networked runner gets an HTTP answer
 * and the harness legitimately proceeds instead of refusing. They failed on CI
 * for exactly that reason.
 *
 * The classification below is the part that must hold everywhere. It is a pure
 * function of the probe result, so every outcome — including the ones a given
 * machine cannot produce — is exercised from fixtures.
 *
 * WHAT A PROBE PROVES, AND WHAT IT DOES NOT
 *
 *   DNS / TCP / TLS      collapsed by `fetch` into one thrown error; the code is
 *                        mapped to a layer for reporting (see transportLayerOf).
 *                        This is INFRASTRUCTURE and nothing else.
 *   HTTP/service answer  an HTTP status, which is a statement about the service,
 *                        not about credentials.
 *   auth verdict         only derivable from an answer. A transport failure
 *                        carries no information about any credential, in either
 *                        direction: it cannot show a key is bad, and it cannot
 *                        show a key is good.
 *
 * THE INVARIANT THIS ENCODES
 *
 *   "Authentication evidence requires an actual service answer. A result that
 *    only proves transport failure stays an infrastructure condition."
 *
 * Encoded as: `isAuthEvidence` is derived from the state, and `isAuthEvidence`
 * implies `reached`. `isRevocationEvidence` is always false — this probe cannot
 * observe revocation, and a network failure is especially not evidence of it.
 */

/**
 * Transport layers a thrown fetch error can be attributed to.
 *
 * `fetch` collapses DNS, TCP and TLS into one exception, so the layer is
 * inferred from the error code and is a REPORTING aid. It is honest about its
 * own limits: codes it does not recognise become `unknown` rather than being
 * assigned to a layer that would look more precise than the evidence supports.
 */
export const TRANSPORT_LAYERS = ["dns", "tcp", "tls", "timeout", "unknown"];

/** Every classification this probe may produce. Closed and total. */
export const PROBE_STATES = [
  "TRANSPORT_BLOCKED",
  "SERVICE_UNAVAILABLE",
  "MALFORMED",
  "UNAUTHENTICATED",
  "AUTHENTICATED",
];

/**
 * States that justify a conclusion about authentication.
 *
 * Membership is the definition of `isAuthEvidence`; it is never set by hand.
 * Both members require an HTTP answer, which is the point.
 */
export const AUTH_EVIDENCE_STATES = ["UNAUTHENTICATED", "AUTHENTICATED"];

/** States that are an infrastructure condition rather than a service verdict. */
export const INFRASTRUCTURE_STATES = [
  "TRANSPORT_BLOCKED",
  "SERVICE_UNAVAILABLE",
  "MALFORMED",
];

/**
 * Map a thrown fetch error code onto the layer it most plausibly failed at.
 *
 * Deliberately conservative: DNS and TCP codes are unambiguous, TLS-severing
 * and certificate errors are grouped because the observable difference is not
 * meaningful here, and anything unrecognised stays `unknown`.
 */
export function transportLayerOf(code) {
  const c = String(code ?? "");
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(c)) return "dns";
  if (/^(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENETDOWN)$/.test(c))
    return "tcp";
  if (
    /^(ECONNRESET|EPIPE|ECONNABORTED)$/.test(c) ||
    /^(ERR_TLS_|UNABLE_TO_VERIFY|SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_)/.test(
      c,
    )
  ) {
    return "tls";
  }
  if (/^(ETIMEDOUT|ABORT_ERR|AbortError|UND_ERR_CONNECT_TIMEOUT)$/.test(c))
    return "timeout";
  return "unknown";
}

/**
 * Classify one probe result.
 *
 * Total: every input lands in exactly one state. The ordering matters — a
 * transport failure is decided FIRST and unconditionally, so no HTTP status or
 * application status can pull an auth verdict out of a request that never
 * reached the service.
 *
 * @param {{ httpStatus?: number, transportError?: string|null, appStatus?: unknown }} probe
 */
export function classifyProbeResult({
  httpStatus,
  transportError,
  appStatus,
} = {}) {
  const status = Number(httpStatus ?? 0);

  // No answer. httpStatus 0 is how callConvex() reports a thrown fetch, and a
  // present transportError is the same fact stated positively; either alone is
  // enough, so a result missing one of them cannot slip through as "reached".
  if (status === 0 || transportError) {
    return {
      state: "TRANSPORT_BLOCKED",
      layer: transportLayerOf(transportError),
      // The raw code is carried through so the refusal message keeps the
      // diagnostic detail it had before the classification was extracted.
      transportError: transportError ?? null,
      httpStatus: 0,
      reached: false,
      isAuthEvidence: false,
      isRevocationEvidence: false,
      detail:
        `no HTTP answer (${transportError ?? "unknown"} at the ${transportLayerOf(transportError)} ` +
        "layer) — an infrastructure condition, not a statement about credentials",
    };
  }

  const answered = {
    layer: null,
    transportError: null,
    httpStatus: status,
    reached: true,
    isRevocationEvidence: false,
  };

  // The service refused the request as unauthenticated. This is the ONLY shape
  // that evidences "a protected route rejects anonymous callers".
  if (status === 401 || appStatus === "UNAUTHENTICATED") {
    return {
      ...answered,
      state: "UNAUTHENTICATED",
      isAuthEvidence: true,
      detail: `deployment answered HTTP ${status}; application status=UNAUTHENTICATED`,
    };
  }

  // Answered, but by something that is not serving this request as a working
  // deployment — a 5xx, or a 4xx that is not a refusal. Not an auth verdict.
  if (status >= 400) {
    return {
      ...answered,
      state: "SERVICE_UNAVAILABLE",
      isAuthEvidence: false,
      detail:
        `deployment answered HTTP ${status} — the service is not serving this request, which ` +
        `says nothing about credentials`,
    };
  }

  // 2xx. What the service did with the request is stated by the application
  // status; without one there is no verdict to draw, so it is not treated as
  // success.
  if (typeof appStatus === "string" && appStatus.trim() !== "") {
    return {
      ...answered,
      state: "AUTHENTICATED",
      isAuthEvidence: true,
      detail: `deployment answered HTTP ${status} with application status=${appStatus}`,
    };
  }

  return {
    ...answered,
    state: "MALFORMED",
    isAuthEvidence: false,
    detail:
      `deployment answered HTTP ${status} with no interpretable application status — ` +
      "fails closed rather than being read as success",
  };
}

/**
 * The refusal message for a probe that never reached the service.
 *
 * Refusal is the ONLY outcome for a transport failure, and the wording must
 * make the boundary explicit: an absence of answer proves nothing about the far
 * end, so it cannot be reported as an authentication or authorisation result.
 */
export function probeRefusalReason(classification, hostname) {
  const cause =
    classification.transportError ?? classification.layer ?? "unknown";
  return (
    `The deployment did not answer (${cause} at the ${classification.layer ?? "unknown"} layer` +
    `${hostname ? `, ${hostname}` : ""}). This is a transport failure, not an ` +
    "authentication or authorisation result. Check connectivity before " +
    "attributing anything to the application."
  );
}

/**
 * Check a classification against every invariant the contract promises.
 *
 * Returns violations (empty means conformant) rather than throwing, so a live
 * result and a hand-written fixture are checked the same way. A malformed or
 * hand-edited result is expected to fail here.
 */
export function validateProbeClassification(classification) {
  const problems = [];
  if (!classification || typeof classification !== "object") {
    return ["classification is not an object"];
  }

  const {
    state,
    layer,
    httpStatus,
    reached,
    isAuthEvidence,
    isRevocationEvidence,
  } = classification;

  if (!PROBE_STATES.includes(state)) {
    problems.push(`unknown probe state: ${JSON.stringify(state)}`);
  }

  const expected = AUTH_EVIDENCE_STATES.includes(state);
  if (isAuthEvidence !== expected) {
    problems.push(
      `isAuthEvidence=${JSON.stringify(isAuthEvidence)} contradicts state ${JSON.stringify(state)} ` +
        `(expected ${expected})`,
    );
  }

  // This probe has no way to learn that a credential was revoked. A network
  // failure is emphatically not evidence of it.
  if (isRevocationEvidence !== false) {
    problems.push(
      "isRevocationEvidence must always be false — this probe cannot observe revocation",
    );
  }

  const expectedReached = state !== "TRANSPORT_BLOCKED";
  if (reached !== expectedReached) {
    problems.push(
      `reached=${JSON.stringify(reached)} contradicts state ${JSON.stringify(state)}`,
    );
  }

  // "Reached" is an HTTP fact, so it must come with an HTTP status. A state
  // that claims the service answered while carrying the no-answer sentinel is
  // the same defect as an auth verdict pulled out of a transport failure.
  if (
    expectedReached &&
    !(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
  ) {
    problems.push(
      `a reached state must carry a real HTTP status, got ${JSON.stringify(httpStatus)} ` +
        `for state ${JSON.stringify(state)}`,
    );
  }

  // The load-bearing direction: no auth verdict without an answer.
  if (isAuthEvidence && !reached) {
    problems.push(
      "authentication evidence was claimed without the service being reached",
    );
  }

  if (state === "TRANSPORT_BLOCKED") {
    if (layer === null || !TRANSPORT_LAYERS.includes(layer)) {
      problems.push(
        `TRANSPORT_BLOCKED must name a transport layer, got ${JSON.stringify(layer)}`,
      );
    }
    if (httpStatus !== 0) {
      problems.push(
        `TRANSPORT_BLOCKED must have httpStatus 0, got ${JSON.stringify(httpStatus)}`,
      );
    }
  } else if (layer !== null) {
    problems.push(
      `a reached state must not name a transport layer, got ${JSON.stringify(layer)} ` +
        `for state ${JSON.stringify(state)}`,
    );
  }

  if (
    typeof classification.detail !== "string" ||
    classification.detail.trim() === ""
  ) {
    problems.push("detail must be a non-empty string");
  }

  return problems;
}
