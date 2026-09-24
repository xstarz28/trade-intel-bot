/**
 * Phase 234 — the Convex access verdict contract.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, IN BOTH DIRECTIONS
 *
 * The probe classifies what it observed about the Convex control plane. Two
 * mistakes are possible, and they point opposite ways:
 *
 *   A blocked network reported as auth evidence
 *     -> a dead sandbox looks like a rejected key, and someone "confirms" the
 *        credential is bad (or revoked) when it was never delivered. This is
 *        the direction the Phase 200 test guarded, and it guarded it by
 *        pinning one machine's egress policy — which is why it failed on any
 *        networked runner.
 *
 *   A refused credential reported as merely unreachable
 *     -> a real rejection looks like a firewall problem, and the operator
 *        hunts for an allowlist entry that was never the issue.
 *
 * Both are prevented by one rule, encoded once and asserted exhaustively here:
 *
 *   "Network reachability must never be reported as authentication evidence,
 *    and no authentication verdict may be emitted unless the control plane was
 *    actually reached and answered."
 *
 * WHY FIXTURES RATHER THAN THE LIVE PROBE
 *
 * A test that runs the live probe and asserts its verdict asserts the network,
 * not the program: four of the eight outcomes below cannot even be produced on
 * a given machine, and which one appears is an accident of egress policy. The
 * classification is a pure function of the observations, so every outcome is
 * driven from a fixture here — deterministically, on any machine.
 * `handoff-readiness.phase200.test.ts` cross-checks the REAL probe against the
 * same contract, and its assertions are written to hold in either environment.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Typed via scripts/lib/convex-access-verdict.d.mts — no `any` cast.
import {
  AUTH_EVIDENCE_STATES,
  AUTH_STATES,
  EXIT_CODES,
  TRANSPORT_LAYERS,
  VERDICT_STATES,
  classifyAuthResponse,
  classifyAuthTransportFailure,
  computeVerdict,
  validateVerdict,
} from "../../../scripts/lib/convex-access-verdict.mjs";

const root = process.cwd();
const HOST = "api.convex.dev";

type Layer = { layer: string; host: string; status: string; detail: string };
type AuthState = (typeof AUTH_STATES)[number];
type VerdictState = (typeof VERDICT_STATES)[number];

const pass = (layer: string, host = HOST): Layer => ({ layer, host, status: "PASS", detail: "fixture" });
const fail = (layer: string, host = HOST): Layer => ({ layer, host, status: "FAIL", detail: "fixture" });

/** Same-network controls, so a targeted block is distinguishable from an outage. */
const CONTROLS: Layer[] = [pass("control", "api.github.com"), pass("control", "registry.npmjs.org")];

/** Transport that stops at `blocked`: every earlier layer passed, `blocked` failed. */
function stoppedAt(blocked: string): Layer[] {
  const out: Layer[] = [];
  for (const layer of TRANSPORT_LAYERS) {
    if (layer === blocked) {
      out.push(fail(layer));
      break;
    }
    out.push(pass(layer));
  }
  return out;
}

/** The control plane answered at HTTP — all four transport layers passed. */
const transportOk = (): Layer[] => TRANSPORT_LAYERS.map((layer) => pass(layer));

type Observation = Parameters<typeof computeVerdict>[0];

/** Defaults for every field, so a scenario only states what it is varying. */
const obs = (over: Partial<Observation>): Observation => ({
  layers: [],
  primaryHost: HOST,
  reachable: false,
  authState: "not_attempted",
  deploymentPlaneReachable: true,
  ...over,
});

const observe = (over: Partial<Observation>) => computeVerdict(obs(over));

/* ═══════════════════════════════════════════════════════════════
 * 1-7 — every network outcome, driven deterministically
 * ═══════════════════════════════════════════════════════════════ */

interface Scenario {
  name: string;
  observation: Observation;
  state: VerdictState;
  blockedAt: string | null;
  isAuthEvidence: boolean;
  exitCode: number;
}

const SCENARIOS: Scenario[] = [
  {
    name: "1. DNS unavailable — nothing resolved, so nothing was contacted",
    observation: obs({ layers: [...stoppedAt("dns"), ...CONTROLS] }),
    state: "NOT_REACHABLE",
    blockedAt: "dns",
    isAuthEvidence: false,
    exitCode: 2,
  },
  {
    name: "2. TCP unavailable — the port never accepted a connection",
    observation: obs({ layers: [...stoppedAt("tcp"), ...CONTROLS] }),
    state: "NOT_REACHABLE",
    blockedAt: "tcp",
    isAuthEvidence: false,
    exitCode: 2,
  },
  {
    name: "3. TLS unavailable — the handshake was severed by egress policy",
    observation: obs({ layers: [...stoppedAt("tls"), ...CONTROLS] }),
    state: "NOT_REACHABLE",
    blockedAt: "tls",
    isAuthEvidence: false,
    exitCode: 2,
  },
  {
    name: "4. HTTP unreachable — TLS completed but no HTTP answer came back",
    observation: obs({ layers: [...stoppedAt("http"), ...CONTROLS] }),
    state: "NOT_REACHABLE",
    blockedAt: "http",
    isAuthEvidence: false,
    exitCode: 2,
  },
  {
    name: "5. Service reached and the credential was refused",
    observation: obs({ layers: [...transportOk(), ...CONTROLS], reachable: true, authState: "credentials_rejected" }),
    state: "CREDENTIALS_REJECTED",
    blockedAt: "auth",
    isAuthEvidence: true,
    exitCode: 1,
  },
  {
    name: "6. Service reached, no usable credential presented",
    observation: obs({ layers: [...transportOk(), ...CONTROLS], reachable: true, authState: "no_credentials" }),
    state: "UNAUTHENTICATED",
    blockedAt: "auth",
    isAuthEvidence: false,
    exitCode: 1,
  },
  {
    name: "7a. Service reached, the authenticated request died in transport",
    observation: obs({ layers: [...transportOk(), ...CONTROLS], reachable: true, authState: "unreachable" }),
    state: "AUTH_INDETERMINATE",
    blockedAt: "auth",
    isAuthEvidence: false,
    exitCode: 1,
  },
  {
    name: "7b. Service reached, the authenticated request got a 5xx",
    observation: obs({ layers: [...transportOk(), ...CONTROLS], reachable: true, authState: "server_error" }),
    state: "AUTH_INDETERMINATE",
    blockedAt: "auth",
    isAuthEvidence: false,
    exitCode: 1,
  },
  {
    name: "control plane authenticated but the deployment family is blocked",
    observation: obs({
      layers: [...transportOk(), ...CONTROLS],
      reachable: true,
      authState: "authenticated",
      deploymentPlaneReachable: false,
    }),
    state: "CONTROL_PLANE_ONLY",
    blockedAt: "deployment-plane",
    isAuthEvidence: true,
    exitCode: 1,
  },
  {
    name: "fully reachable and authenticated",
    observation: obs({
      layers: [...transportOk(), ...CONTROLS],
      reachable: true,
      authState: "authenticated",
      deploymentPlaneReachable: true,
    }),
    state: "AUTHENTICATED",
    blockedAt: null,
    isAuthEvidence: true,
    exitCode: 0,
  },
];

describe("Phase 234 — every network outcome is classified distinctly", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const { verdict, exitCode } = computeVerdict(scenario.observation);
      expect(verdict.state).toBe(scenario.state);
      expect(verdict.blockedAt).toBe(scenario.blockedAt);
      expect(verdict.isAuthEvidence).toBe(scenario.isAuthEvidence);
      expect(exitCode).toBe(scenario.exitCode);
      expect(verdict.classification).toBeTruthy();
      // Every produced verdict must satisfy the contract's own invariants.
      expect(validateVerdict(verdict, { reachable: scenario.observation.reachable })).toEqual([]);
    });
  }

  it("the exit code is a function of the state, not of the branch that produced it", () => {
    for (const scenario of SCENARIOS) {
      const { verdict, exitCode } = computeVerdict(scenario.observation);
      expect(exitCode, `${verdict.state} has an inconsistent exit code`).toBe(EXIT_CODES[verdict.state]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
 * The properties, asserted over the WHOLE input space
 * ═══════════════════════════════════════════════════════════════ */

/** Every combination of the three inputs the classification depends on. */
function allObservations() {
  const out: Observation[] = [];
  for (const reachable of [true, false]) {
    for (const authState of AUTH_STATES) {
      for (const deploymentPlaneReachable of [true, false]) {
        out.push(
          obs({
            layers: reachable ? [...transportOk(), ...CONTROLS] : [...stoppedAt("tls"), ...CONTROLS],
            reachable,
            authState,
            deploymentPlaneReachable,
          }),
        );
      }
    }
  }
  return out;
}

describe("Phase 234 — unreachable is never authentication failure", () => {
  it("no auth state can produce an auth verdict when the control plane was not reached", () => {
    // Exhaustive over AUTH_STATES: this is the rule the Phase 200 test was
    // trying to pin, stated once and checked against every credential outcome.
    for (const authState of AUTH_STATES) {
      const { verdict, exitCode } = observe({
        layers: [...stoppedAt("tls"), ...CONTROLS],
        reachable: false,
        authState,
      });
      expect(verdict.state, `authState=${authState} leaked a verdict from an unreachable plane`).toBe(
        "NOT_REACHABLE",
      );
      expect(verdict.isAuthEvidence).toBe(false);
      expect(verdict.isRevocationEvidence).toBe(false);
      expect(exitCode).toBe(2);
      expect(TRANSPORT_LAYERS).toContain(verdict.blockedAt);
    }
  });

  it("a transport failure is never reported as a rejected credential", () => {
    for (const blocked of TRANSPORT_LAYERS) {
      const { verdict } = observe({
        layers: [...stoppedAt(blocked), ...CONTROLS],
        reachable: false,
        authState: "credentials_rejected",
      });
      expect(verdict.state).not.toBe("CREDENTIALS_REJECTED");
      expect(verdict.isAuthEvidence).toBe(false);
    }
  });

  it("an unreachable verdict never stops at the auth step", () => {
    for (const observation of allObservations()) {
      const { verdict } = computeVerdict(observation);
      if (verdict.state !== "NOT_REACHABLE") continue;
      expect(verdict.blockedAt).not.toBe("auth");
      expect(verdict.blockedAt).not.toBe("deployment-plane");
    }
  });
});

describe("Phase 234 — a rejection requires a delivered credential", () => {
  it("CREDENTIALS_REJECTED is emitted only when the service was reached", () => {
    for (const observation of allObservations()) {
      const { verdict } = computeVerdict(observation);
      if (verdict.state !== "CREDENTIALS_REJECTED") continue;
      expect(
        observation.reachable,
        "a rejection was claimed for a credential the service never received",
      ).toBe(true);
    }
  });

  it("is emitted only for an actual refusal, never for an indeterminate outcome", () => {
    for (const authState of AUTH_STATES) {
      const { verdict } = observe({
        layers: [...transportOk(), ...CONTROLS],
        reachable: true,
        authState,
      });
      expect(verdict.state === "CREDENTIALS_REJECTED").toBe(authState === "credentials_rejected");
    }
  });

  it("401 and 403 produce a rejection; every other answer does not", () => {
    expect(classifyAuthResponse(401).state).toBe("credentials_rejected");
    expect(classifyAuthResponse(403).state).toBe("credentials_rejected");
    for (const status of [200, 204, 400, 404, 429]) {
      expect(classifyAuthResponse(status).state).toBe("authenticated");
    }
    for (const status of [500, 502, 503]) {
      const r = classifyAuthResponse(status);
      expect(r.state, `HTTP ${status} must not be read as an auth verdict`).toBe("server_error");
      expect(r.detail).toMatch(/not an auth verdict/i);
    }
  });

  it("a transport failure on the authenticated request classifies as indeterminate", () => {
    const r = classifyAuthTransportFailure(Object.assign(new Error("boom"), { cause: { code: "ECONNRESET" } }));
    expect(r.state).toBe("unreachable");
    expect(r.detail).toMatch(/TRANSPORT failure/i);
    expect(r.detail).toMatch(/says nothing about the credential/i);
    // Not a rejection, and not a success.
    expect(r.state).not.toBe("credentials_rejected");
    expect(r.state).not.toBe("authenticated");
  });
});

describe("Phase 234 — no state is converted into another", () => {
  it("the classification is deterministic — the same observation yields the same verdict", () => {
    for (const observation of allObservations()) {
      expect(computeVerdict(observation)).toEqual(computeVerdict(observation));
    }
  });

  it("reachability dominates: the verdict never varies with the credential when unreached", () => {
    const states = new Set(
      AUTH_STATES.map(
        (authState) => observe({ layers: stoppedAt("tls"), reachable: false, authState }).verdict.state,
      ),
    );
    expect([...states]).toEqual(["NOT_REACHABLE"]);
  });

  it("the three credential outcomes are three distinct states", () => {
    const states = (["credentials_rejected", "no_credentials", "server_error"] as const).map(
      (authState) => observe({ layers: transportOk(), reachable: true, authState }).verdict.state,
    );
    expect(new Set(states).size).toBe(3);
  });

  it("a 5xx is not folded into 'no credential was presented'", () => {
    // The specific collapse Phase 234 removed: the server failing to answer
    // tells you nothing about whether the key was usable.
    const noCreds = observe({ layers: transportOk(), reachable: true, authState: "no_credentials" });
    const serverError = observe({ layers: transportOk(), reachable: true, authState: "server_error" });
    expect(serverError.verdict.state).not.toBe(noCreds.verdict.state);
  });
});

describe("Phase 234 — no false security evidence is created", () => {
  it("isAuthEvidence is derived from the state, never set independently", () => {
    for (const observation of allObservations()) {
      const { verdict } = computeVerdict(observation);
      expect(verdict.isAuthEvidence).toBe(AUTH_EVIDENCE_STATES.includes(verdict.state));
    }
  });

  it("auth evidence implies the control plane was reached", () => {
    for (const observation of allObservations()) {
      const { verdict } = computeVerdict(observation);
      if (verdict.isAuthEvidence) expect(observation.reachable).toBe(true);
    }
  });

  it("revocation is never claimed — this probe cannot observe it", () => {
    for (const observation of allObservations()) {
      expect(computeVerdict(observation).verdict.isRevocationEvidence).toBe(false);
    }
  });

  it("every reachable observation conforms to the contract", () => {
    for (const observation of allObservations()) {
      const { verdict } = computeVerdict(observation);
      expect(
        validateVerdict(verdict, { reachable: observation.reachable }),
        `state=${verdict.state} violates the contract`,
      ).toEqual([]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
 * 8 — malformed probe results are refused, not treated as safe
 * ═══════════════════════════════════════════════════════════════ */

describe("Phase 234 — a malformed or hand-edited result is rejected", () => {
  const conformant = {
    state: "NOT_REACHABLE",
    blockedAt: "tls",
    classification: "blocked at tls",
    isAuthEvidence: false,
    isRevocationEvidence: false,
  };

  it("accepts a conformant verdict (the validator is not vacuously strict)", () => {
    expect(validateVerdict(conformant, { reachable: false })).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "NOT_REACHABLE"],
    ["an empty object", {}],
    ["a missing state", { ...conformant, state: undefined }],
    ["an unknown state", { ...conformant, state: "PROBABLY_FINE" }],
  ])("rejects %s", (_name, value) => {
    expect(validateVerdict(value, { reachable: false }).length).toBeGreaterThan(0);
  });

  it("rejects the exact forgery that would matter: unreachable + auth evidence", () => {
    const forged = { ...conformant, isAuthEvidence: true };
    const problems = validateVerdict(forged, { reachable: false });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toMatch(/contradicts state/);
  });

  it("rejects an unreachable verdict that stops at the auth step", () => {
    const forged = { ...conformant, blockedAt: "auth" };
    const problems = validateVerdict(forged, { reachable: false });
    expect(problems.join(" ")).toMatch(/cannot yield a credential verdict|implies the control plane was reached/);
  });

  it("rejects a rejection claimed without reachability", () => {
    const forged = {
      state: "CREDENTIALS_REJECTED",
      blockedAt: "auth",
      classification: "refused",
      isAuthEvidence: true,
      isRevocationEvidence: false,
    };
    expect(validateVerdict(forged, { reachable: false }).length).toBeGreaterThan(0);
    // ...and the same verdict is legitimate once the service was actually reached.
    expect(validateVerdict(forged, { reachable: true })).toEqual([]);
  });

  it("rejects a revocation claim", () => {
    const forged = { ...conformant, isRevocationEvidence: true };
    expect(validateVerdict(forged, { reachable: false }).join(" ")).toMatch(/revocation/);
  });

  it("rejects an authenticated verdict that also claims to be blocked", () => {
    const forged = {
      state: "AUTHENTICATED",
      blockedAt: "tls",
      classification: "ok",
      isAuthEvidence: true,
      isRevocationEvidence: false,
    };
    expect(validateVerdict(forged, { reachable: true }).join(" ")).toMatch(/blockedAt null/);
  });

  it("rejects an empty classification", () => {
    expect(validateVerdict({ ...conformant, classification: "" }, { reachable: false }).length).toBeGreaterThan(0);
  });

  it("an unrecognised auth state fails closed rather than becoming a success", () => {
    for (const authState of ["", "ok", "SUCCESS", "authenticated ", undefined]) {
      const { verdict, exitCode } = observe({
        layers: transportOk(),
        reachable: true,
        authState: authState as AuthState,
      });
      expect(verdict.state).toBe("AUTH_INDETERMINATE");
      expect(verdict.isAuthEvidence).toBe(false);
      expect(exitCode).not.toBe(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
 * The probe must not keep a second copy of the rules
 * ═══════════════════════════════════════════════════════════════ */

describe("Phase 234 — the rules live in exactly one place", () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the probe delegates classification instead of inlining it", () => {
    const source = stripComments(readFileSync(join(root, "scripts/verify-convex-access.mjs"), "utf8"));
    expect(source).toContain("computeVerdict(");
    // If a state literal reappears in the probe, the contract has been forked
    // and the fixture tests would no longer be proving anything about it.
    for (const state of VERDICT_STATES) {
      expect(
        source.includes(`"${state}"`),
        `${state} is hardcoded in the probe — classification must stay in the contract module`,
      ).toBe(false);
    }
    // Auth states are NOT checked here: the probe legitimately produces
    // `not_attempted` and compares against `authenticated`. It is the verdict
    // vocabulary — the conclusions — that must not be duplicated.
  });

  it("the probe still performs the real probes (it did not become a stub)", () => {
    const source = readFileSync(join(root, "scripts/verify-convex-access.mjs"), "utf8");
    for (const fn of ["probeDns", "probeTcp", "probeTls", "probeHttp", "probeAuthenticated"]) {
      expect(source, `${fn} is missing`).toContain(fn);
    }
    expect(source).toMatch(/rejectUnauthorized: true/);
  });
});
