/**
 * Phase 248 — Convex production deployment verification.
 *
 * The suite is organised like the phase's decisions: the manifest read, the
 * scanned function surface, the package contract, the production identity, the
 * deployment binding, the URLs, the observed environment, the access verdict, the
 * function coverage, the candidate binding, the timestamps, the lesser-claim
 * markers, the state precedence, the gate projection, the reader integration, the
 * canonical admission, and the command's inability to act.
 *
 * Two properties carry the most weight and are tested directly:
 *   - a package that is not a real production deployment of THIS candidate is
 *     refused by a NAMED code, never merged into a vague one; and
 *   - the real tree, with no package filed, is still NOT READY, and nothing this
 *     suite synthesises changes that.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DEPLOYMENT_CATEGORIES,
  AUTHENTICATED_ACCESS_STATES,
  CONVEX_CLOUD_SUFFIX,
  CONVEX_DEPLOYMENT_CODE_STATES,
  CONVEX_DEPLOYMENT_CONTRACT_PROBLEMS,
  CONVEX_DEPLOYMENT_ENVIRONMENT,
  CONVEX_DEPLOYMENT_MAX_AGE_MS,
  CONVEX_DEPLOYMENT_PREREQUISITE,
  CONVEX_DEPLOYMENT_SCHEMA,
  CONVEX_DEPLOYMENT_STATE_PRECEDENCE,
  CONVEX_SITE_SUFFIX,
  FORBIDDEN_DEPLOYMENT_HOSTS,
  REJECTED_DEPLOYMENT_CATEGORIES,
  REQUIRED_PACKAGE_FIELDS,
  buildConvexDeploymentOperatorHandoff,
  buildConvexDeploymentPackage,
  convexDeploymentHandoffExitCode,
  evaluateConvexDeploymentPackage,
  formatConvexDeploymentOperatorHandoff,
  toGateConvexRecord,
  type ConvexDeploymentAssessment,
  type ConvexDeploymentPackage,
} from "./convex-deployment-verification";
import {
  CONVEX_ROOT,
  requiredConvexFunctionReferences,
  scanConvexFunctionSurface,
  type SurfaceSource,
} from "./convex-function-surface";
import { evidenceDigest } from "./a2-rehearsal";
import { RELEASE_PREREQUISITES, evaluateRelease } from "./release-gate";
import {
  currentReleaseVerdict,
  deriveCurrentReleaseState,
  PROOF_PATHS,
  type FactSource,
} from "./release-current-state";
import { evaluateReleaseAdmission } from "./release-admission";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
/** Prose about a forbidden operation is not the operation. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const COMMIT = "c0ffee248";
const REF = "heads/arena/01a0b293-trade-intel-bot";
const CANDIDATE = { commit: COMMIT, ref: REF };
const DEPLOYMENT = "prod:xstarz:trade-intel-bot";
const CLOUD_URL = "https://trade-intel-bot.convex.cloud";
const SITE_URL = "https://trade-intel-bot.convex.site";
/** The real function surface this candidate defines, scanned from src/convex. */
const FUNCTIONS = requiredConvexFunctionReferences();

/* ── fixtures ───────────────────────────────────────────────────────────── */

/**
 * A conformant package; every case perturbs exactly one thing from here.
 *
 * Overrides are applied to the BUILT package and the digest is RE-COMPUTED over
 * the result, so a case that breaks one field is refused by that field's own rule
 * rather than by the digest. (Test 13 is the one that keeps a stale digest, to
 * prove the digest itself bites.) This mirrors the Phase 247 Evidence D fixture.
 */
function pkg(
  overrides: Partial<ConvexDeploymentPackage> & { dropFunction?: string } = {},
): ConvexDeploymentPackage {
  const { dropFunction, ...rest } = overrides;
  const published = dropFunction
    ? FUNCTIONS.filter((reference) => reference !== dropFunction)
    : FUNCTIONS;
  const built = buildConvexDeploymentPackage({
    candidate: CANDIDATE,
    deployment: DEPLOYMENT,
    deploymentUrl: CLOUD_URL,
    siteUrl: SITE_URL,
    observedAt: NOW - HOUR,
    deploymentEnv: null,
    accessVerdict: AUTHENTICATED_ACCESS_STATES[0] ?? "AUTHENTICATED",
    publishedFunctions: published,
  });
  if (Object.keys(rest).length === 0) return built;
  const { digest: _ignored, ...payload } = built;
  const merged = { ...payload, ...rest } as Record<string, unknown>;
  return { ...merged, digest: evidenceDigest(merged) } as ConvexDeploymentPackage;
}

function assess(
  value: unknown,
  options: {
    now?: number;
    candidate?: { commit?: string; ref?: string };
    productionDeployment?: string;
    requiredFunctions?: readonly string[];
  } = {},
): ConvexDeploymentAssessment {
  return evaluateConvexDeploymentPackage(value, {
    now: options.now ?? NOW,
    candidate: options.candidate ?? CANDIDATE,
    productionDeployment:
      options.productionDeployment === undefined ? DEPLOYMENT : options.productionDeployment,
    requiredFunctions: options.requiredFunctions ?? FUNCTIONS,
  });
}

const codes = (assessment: ConvexDeploymentAssessment) => assessment.refusals.map((r) => r.code);

/** A memory tree, so the reader paths are reachable without touching disk. */
function memorySource(files: Record<string, string>): FactSource {
  return {
    exists: (path) => path in files,
    read: (path) => {
      const body = files[path];
      if (body === undefined) throw new Error(`no such file: ${path}`);
      return body;
    },
  };
}

const REF_INVENTORY = JSON.stringify({
  refs: [
    { ref: "main", affected: true, exposedAtTip: true },
    { ref: "phase-157", affected: true, exposedAtTip: false },
  ],
});

/** A bare, pre-Phase-248 CONVEX claim: the shape the gate used to accept. */
function bareConvexClaim(): string {
  return JSON.stringify({
    verified: true,
    source: "external-verification",
    environment: "production",
    observedAt: NOW - HOUR,
    subject: { commit: COMMIT, deployment: DEPLOYMENT },
  });
}

/* ── A. the prerequisite is read from the manifest ──────────────────────── */

describe("248 — the prerequisite is the manifest's one deployment-bound entry", () => {
  it("1. there is exactly one deployment-bound prerequisite, and it is CONVEX", () => {
    const deploymentBound = RELEASE_PREREQUISITES.filter((entry) => entry.binding === "deployment");
    expect(deploymentBound).toHaveLength(1);
    expect(CONVEX_DEPLOYMENT_PREREQUISITE).toBe("CONVEX_PRODUCTION_DEPLOYMENT");
    expect(CONVEX_DEPLOYMENT_CONTRACT_PROBLEMS).toEqual([]);
  });

  it("2. the environment and the freshness window are read, not restated", () => {
    const prerequisite = RELEASE_PREREQUISITES.find((e) => e.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(CONVEX_DEPLOYMENT_ENVIRONMENT).toBe(prerequisite.requiredEnvironment);
    expect(CONVEX_DEPLOYMENT_ENVIRONMENT).toBe("production");
    expect(CONVEX_DEPLOYMENT_MAX_AGE_MS).toBe(prerequisite.maxAgeMs);
    expect(CONVEX_DEPLOYMENT_MAX_AGE_MS).toBe(7 * DAY);
  });

  it("3. the accepted access verdicts are derived from the Phase 234 exit-0 state", () => {
    // Read from EXIT_CODES, so there is no second copy of "which verdict is ready".
    expect(AUTHENTICATED_ACCESS_STATES).toContain("AUTHENTICATED");
    expect(AUTHENTICATED_ACCESS_STATES.length).toBeGreaterThan(0);
    // A verdict that is NOT exit-0 is never accepted.
    expect(AUTHENTICATED_ACCESS_STATES).not.toContain("NOT_REACHABLE");
    expect(AUTHENTICATED_ACCESS_STATES).not.toContain("CONTROL_PLANE_ONLY");
  });
});

/* ── B. the required function surface is scanned, not listed ────────────── */

describe("248 — the function surface is the candidate's own, scanned", () => {
  it("4. the scan finds the functions the backend actually defines", () => {
    expect(FUNCTIONS.length).toBeGreaterThan(40);
    expect(FUNCTIONS).toContain("marketData.fetchMarketData");
    expect(FUNCTIONS).toContain("protectedAnalysis.runProtectedAnalysis");
    expect(FUNCTIONS).toContain("entitlements.getMyEntitlement");
    // Internal functions are published too, and are required.
    expect(FUNCTIONS).toContain("otpLimiter.consumeResendAllowance");
    expect(FUNCTIONS).toContain("protectedAnalysis.resolveCallerId");
  });

  it("5. the scan excludes declarations, helpers, generated code and tests", () => {
    const surface = scanConvexFunctionSurface();
    const modules = new Set(surface.map((entry) => entry.module));
    expect(modules.has("schema")).toBe(false);
    expect(modules.has("auth.config")).toBe(false);
    expect([...modules].some((m) => m.startsWith("lib/"))).toBe(false);
    expect([...modules].some((m) => m.startsWith("_generated"))).toBe(false);
    // No test file contributes a reference.
    expect(surface.every((entry) => !entry.reference.includes(".test."))).toBe(true);
    // The exclusion is a RULE, not an accident of this tree (no test file here happens
    // to define a Convex function). An injected tree where a `.test.ts` file DOES define
    // one must still exclude it — otherwise "tests contribute nothing" is untested.
    const injected: SurfaceSource = {
      readdir: (dir) =>
        dir === "src/convex"
          ? [
              { name: "real.ts", isDirectory: false },
              { name: "real.test.ts", isDirectory: false },
            ]
          : [],
      read: (path) =>
        path.endsWith("real.test.ts")
          ? "export const sneaky = query({ args: {}, handler: async () => {} });"
          : "export const legit = query({ args: {}, handler: async () => {} });",
    };
    const injectedRefs = requiredConvexFunctionReferences("src/convex", injected);
    expect(injectedRefs).toEqual(["real.legit"]);
    expect(injectedRefs.some((reference) => reference.includes(".test."))).toBe(false);
  });

  it("6. every reference is a well-formed <module>.<function>, sorted and unique", () => {
    const sorted = [...FUNCTIONS].sort();
    expect(FUNCTIONS).toEqual(sorted);
    expect(new Set(FUNCTIONS).size).toBe(FUNCTIONS.length);
    for (const reference of FUNCTIONS) expect(reference).toMatch(/^[A-Za-z0-9_/-]+\.[A-Za-z0-9_]+$/);
  });

  it("7. the scan is deterministic and marks internal functions", () => {
    const a = scanConvexFunctionSurface();
    const b = scanConvexFunctionSurface();
    expect(b).toEqual(a);
    const internal = a.filter((entry) => entry.internal);
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.every((entry) => entry.kind.startsWith("internal"))).toBe(true);
  });

  it("8. an injected source is honoured, and an unreadable tree yields nothing", () => {
    const fake: SurfaceSource = {
      readdir: (dir) =>
        dir === "src/convex"
          ? [{ name: "marketData.ts", isDirectory: false }]
          : [],
      read: () => "export const fetchMarketData = action({ args: {}, handler: async () => {} });",
    };
    const refs = requiredConvexFunctionReferences("src/convex", fake);
    expect(refs).toEqual(["marketData.fetchMarketData"]);

    const broken: SurfaceSource = {
      readdir: () => {
        throw new Error("no such directory");
      },
      read: () => {
        throw new Error("no such file");
      },
    };
    // An unreadable tree is an EMPTY surface, never a fabricated one — and the
    // validator refuses an empty surface as unknown rather than passing it.
    expect(requiredConvexFunctionReferences("src/convex", broken)).toEqual([]);
  });

  it("9. the surface root is the backend, named once", () => {
    expect(CONVEX_ROOT).toBe("src/convex");
  });
});

/* ── C. the package contract ────────────────────────────────────────────── */

describe("248 — the package contract", () => {
  it("10. a conformant package is admissible for evaluation", () => {
    const assessment = assess(pkg());
    expect(assessment.refusals).toEqual([]);
    expect(assessment.state).toBe("CONVEX_DEPLOYMENT_VERIFIED");
    expect(assessment.complete).toBe(true);
    expect(assessment.deployment).toBe(DEPLOYMENT);
    expect(assessment.missingFunctions).toEqual([]);
  });

  it("11. the package-level contract is enforced field by field, by code", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["schema", { schema: "wrong/v0" }, "WRONG_SCHEMA"],
      ["verified", { verified: false }, "NOT_VERIFIED"],
      ["source", { source: "documentation" }, "WRONG_SOURCE"],
      ["environment", { environment: "development" }, "WRONG_ENVIRONMENT"],
    ];
    for (const [label, override, code] of cases) {
      const assessment = assess(pkg(override as never));
      expect(codes(assessment), label).toContain(code);
      expect(assessment.complete, label).toBe(false);
    }
  });

  it("12. a package that is not an object is refused, not crashed on", () => {
    for (const value of [null, 42, "deployment", [], undefined]) {
      const assessment = assess(value);
      expect(codes(assessment)).toContain("NOT_AN_OBJECT");
      expect(assessment.complete).toBe(false);
    }
  });

  it("13. the digest pins the content: an edited number is refused", () => {
    const built = pkg();
    const tampered = { ...built, observedAt: built.observedAt + 1 };
    expect(codes(assess(tampered))).toContain("DIGEST_MISMATCH");
    // And a package with no digest at all is refused, not assumed intact.
    const { digest: _drop, ...noDigest } = built;
    expect(codes(assess(noDigest))).toContain("NO_DIGEST");
  });

  it("14. a package carrying a credential-shaped field is refused whole", () => {
    // The scan is the Phase 247 one (reused, not restated): it catches names that
    // could hold a secret — *apikey, *token, *secret, authorization, password,
    // *credential, *value — so each of these refuses the whole package.
    for (const field of ["apiKey", "clientSecret", "bearerToken", "XSTARZ_EMAIL_API_KEY", "authorization", "password"]) {
      const assessment = assess(pkg({ [field]: "super-secret" } as never));
      expect(codes(assessment), field).toContain("CARRIES_CREDENTIAL_VALUE");
      expect(assessment.complete, field).toBe(false);
    }
  });

  it("15. the required fields are stated, and every one is enforced", () => {
    expect(REQUIRED_PACKAGE_FIELDS).toContain("deployment");
    expect(REQUIRED_PACKAGE_FIELDS).toContain("publishedFunctions");
    expect(REQUIRED_PACKAGE_FIELDS).toContain("accessVerdict");
    // Removing each required field produces a refusal (never a silent pass).
    for (const field of ["deployment", "deploymentUrl", "siteUrl", "accessVerdict", "publishedFunctions"]) {
      const built = pkg();
      delete (built as Record<string, unknown>)[field];
      const { digest: _d, ...payload } = built;
      const assessment = assess({ ...payload, digest: undefined });
      expect(assessment.complete, field).toBe(false);
    }
  });
});

/* ── D. production identity ─────────────────────────────────────────────── */

describe("248 — the deployment identity must be a production one", () => {
  it("16. a prod:<team>:<project> identity is accepted when it is the declared one", () => {
    // A valid identity that is not the candidate's declared deployment is still a
    // binding refusal, so the declaration must match for the identity to be accepted.
    expect(assess(pkg({ deployment: "prod:acme:app" }), { productionDeployment: "prod:acme:app" }).complete).toBe(true);
  });

  it("17. a dev/preview/local/anonymous identity is refused, by the real rule", () => {
    for (const identity of ["dev:xstarz:trade-intel-bot", "preview:xstarz:app", "local:dev", "anonymous:abc"]) {
      const assessment = assess(pkg({ deployment: identity }));
      expect(codes(assessment), identity).toContain("NON_PRODUCTION_DEPLOYMENT_IDENTITY");
      expect(assessment.state, identity).toBe("NON_PRODUCTION_DEPLOYMENT");
    }
  });

  it("18. a malformed or missing identity is refused", () => {
    expect(codes(assess(pkg({ deployment: "prod-deployment-248" })))).toContain(
      "NON_PRODUCTION_DEPLOYMENT_IDENTITY",
    );
    expect(codes(assess(pkg({ deployment: "" })))).toContain("MISSING_DEPLOYMENT_IDENTITY");
    const noIdentity = pkg();
    delete (noIdentity as Record<string, unknown>).deployment;
    const { digest: _d, ...payload } = noIdentity;
    expect(codes(assess({ ...payload, digest: undefined }))).toContain("MISSING_DEPLOYMENT_IDENTITY");
  });
});

/* ── E. deployment binding ──────────────────────────────────────────────── */

describe("248 — the package binds to the candidate's declared deployment", () => {
  it("19. no declared deployment is a refusal, never an unnamed pass", () => {
    const assessment = assess(pkg(), { productionDeployment: undefined });
    // productionDeployment undefined => the reader passes none; simulate that.
    const none = evaluateConvexDeploymentPackage(pkg(), {
      now: NOW,
      candidate: CANDIDATE,
      requiredFunctions: FUNCTIONS,
    });
    expect(codes(none)).toContain("NO_DECLARED_DEPLOYMENT");
    expect(none.state).toBe("WRONG_DEPLOYMENT");
    expect(assessment).toBeDefined();
  });

  it("20. a foreign (well-formed) deployment is refused and named", () => {
    const assessment = assess(pkg({ deployment: "prod:xstarz:somewhere-else" }));
    expect(codes(assessment)).toContain("WRONG_DEPLOYMENT");
    expect(assessment.state).toBe("WRONG_DEPLOYMENT");
    expect(assessment.problems.join(" ")).toContain("the candidate deploys to");
  });

  it("21. an empty declared deployment is treated as none", () => {
    const assessment = assess(pkg(), { productionDeployment: "   " });
    expect(codes(assessment)).toContain("NO_DECLARED_DEPLOYMENT");
  });
});

/* ── F. the deployment URLs ─────────────────────────────────────────────── */

describe("248 — the URLs are external https Convex hosts", () => {
  it("22. https *.convex.cloud and *.convex.site are accepted", () => {
    expect(CONVEX_CLOUD_SUFFIX).toBe(".convex.cloud");
    expect(CONVEX_SITE_SUFFIX).toBe(".convex.site");
    expect(assess(pkg()).complete).toBe(true);
  });

  it("23. a non-https or loopback cloud URL is refused", () => {
    expect(codes(assess(pkg({ deploymentUrl: "http://x.convex.cloud" })))).toContain("DEPLOYMENT_URL_NOT_HTTPS");
    expect(codes(assess(pkg({ deploymentUrl: "https://localhost" })))).toContain("DEPLOYMENT_URL_LOOPBACK");
    expect(codes(assess(pkg({ deploymentUrl: "https://127.0.0.1" })))).toContain("DEPLOYMENT_URL_LOOPBACK");
  });

  it("24. a cloud URL that is not a convex.cloud host is refused", () => {
    expect(codes(assess(pkg({ deploymentUrl: "https://example.com" })))).toContain(
      "DEPLOYMENT_URL_NOT_CONVEX_CLOUD",
    );
    expect(codes(assess(pkg({ deploymentUrl: "not a url" })))).toContain("DEPLOYMENT_URL_NOT_HTTPS");
  });

  it("25. a forbidden or retired identity host is refused", () => {
    expect(FORBIDDEN_DEPLOYMENT_HOSTS.length).toBeGreaterThan(0);
    const forbidden = FORBIDDEN_DEPLOYMENT_HOSTS[0];
    expect(codes(assess(pkg({ deploymentUrl: `https://${forbidden}` })))).toContain(
      "DEPLOYMENT_URL_FORBIDDEN_HOST",
    );
  });

  it("26. a site URL that is not a convex.site host is refused", () => {
    expect(codes(assess(pkg({ siteUrl: "https://x.convex.cloud" })))).toContain("SITE_URL_NOT_CONVEX_SITE");
    expect(codes(assess(pkg({ siteUrl: "http://x.convex.site" })))).toContain("SITE_URL_NOT_CONVEX_SITE");
  });

  it("27. missing URLs are refused, not assumed", () => {
    expect(codes(assess(pkg({ deploymentUrl: "" })))).toContain("MISSING_DEPLOYMENT_URL");
    expect(codes(assess(pkg({ siteUrl: "" })))).toContain("MISSING_SITE_URL");
  });
});

/* ── G. the observed runtime environment ────────────────────────────────── */

describe("248 — the observed environment resolves to production", () => {
  it("28. an unset environment resolves to production (the fail-closed default)", () => {
    expect(assess(pkg({ deploymentEnv: null })).complete).toBe(true);
  });

  it("29. an explicit production environment is accepted", () => {
    expect(assess(pkg({ deploymentEnv: "production" })).complete).toBe(true);
  });

  it("30. a development or preview environment is refused", () => {
    for (const env of ["development", "preview"]) {
      const assessment = assess(pkg({ deploymentEnv: env }));
      expect(codes(assessment), env).toContain("DEPLOYMENT_ENV_NOT_PRODUCTION");
      expect(assessment.state, env).toBe("NON_PRODUCTION_DEPLOYMENT");
    }
  });

  it("31. an unrecognised environment is a hard refusal, not a downgrade", () => {
    const assessment = assess(pkg({ deploymentEnv: "prod" }));
    expect(codes(assessment)).toContain("DEPLOYMENT_ENV_UNRESOLVABLE");
    expect(assessment.state).toBe("NON_PRODUCTION_DEPLOYMENT");
  });
});

/* ── H. the control-plane access verdict ────────────────────────────────── */

describe("248 — reachability is the authenticated verdict, not merely reachable", () => {
  it("32. AUTHENTICATED is accepted", () => {
    expect(assess(pkg({ accessVerdict: "AUTHENTICATED" })).complete).toBe(true);
  });

  it("33. every non-authenticated verdict is refused", () => {
    for (const verdict of [
      "NOT_REACHABLE",
      "AUTH_INDETERMINATE",
      "UNAUTHENTICATED",
      "CREDENTIALS_REJECTED",
      "CONTROL_PLANE_ONLY",
    ]) {
      const assessment = assess(pkg({ accessVerdict: verdict }));
      expect(codes(assessment), verdict).toContain("ACCESS_NOT_AUTHENTICATED");
      expect(assessment.state, verdict).toBe("WRONG_ACCESS");
    }
  });

  it("34. a missing or unknown verdict is refused", () => {
    expect(codes(assess(pkg({ accessVerdict: "" })))).toContain("MISSING_ACCESS_VERDICT");
    expect(codes(assess(pkg({ accessVerdict: "SOMETHING_ELSE" })))).toContain("ACCESS_NOT_AUTHENTICATED");
  });
});

/* ── I. function coverage ───────────────────────────────────────────────── */

describe("248 — the deployment publishes the candidate's whole surface", () => {
  it("35. full coverage is accepted", () => {
    expect(assess(pkg()).missingFunctions).toEqual([]);
  });

  it("36. one missing function is refused and named", () => {
    const dropped = FUNCTIONS[0];
    const assessment = assess(pkg({ dropFunction: dropped }));
    expect(codes(assessment)).toContain("MISSING_FUNCTION");
    expect(assessment.state).toBe("MISSING_FUNCTION");
    expect(assessment.missingFunctions).toEqual([dropped]);
    expect(assessment.problems.join(" ")).toContain(dropped);
  });

  it("37. each required function, dropped in turn, is caught", () => {
    for (const reference of FUNCTIONS.slice(0, 8)) {
      const assessment = assess(pkg({ dropFunction: reference }));
      expect(assessment.missingFunctions, reference).toContain(reference);
      expect(assessment.complete, reference).toBe(false);
    }
  });

  it("38. an unknown required surface is refused, never vacuously covered", () => {
    const assessment = assess(pkg(), { requiredFunctions: [] });
    expect(codes(assessment)).toContain("REQUIRED_FUNCTIONS_UNKNOWN");
    expect(assessment.state).toBe("MISSING_FUNCTION");
    expect(assessment.complete).toBe(false);
  });

  it("39. a published set that is not an array is refused", () => {
    expect(codes(assess(pkg({ publishedFunctions: "marketData.fetchMarketData" as never })))).toContain(
      "PUBLISHED_FUNCTIONS_NOT_AN_ARRAY",
    );
  });

  it("40. a `module:function` form is normalised to `module.function`", () => {
    // convex function-spec may report `module:function`; the validator normalises.
    const colonForm = FUNCTIONS.map((reference) => reference.replace(".", ":"));
    const assessment = assess(pkg({ publishedFunctions: colonForm }));
    expect(assessment.missingFunctions).toEqual([]);
    expect(assessment.complete).toBe(true);
  });

  it("41. extra published functions are allowed; missing ones are not", () => {
    const assessment = assess(pkg({ publishedFunctions: [...FUNCTIONS, "someFuture.function"] }));
    expect(assessment.complete).toBe(true);
  });
});

/* ── J. candidate binding ───────────────────────────────────────────────── */

describe("248 — the package binds to the candidate commit", () => {
  it("42. a matching commit is accepted", () => {
    expect(assess(pkg()).complete).toBe(true);
  });

  it("43. a package bound to another commit is refused here", () => {
    const assessment = assess(pkg({ candidate: { commit: "deadbeef", ref: REF } }));
    expect(codes(assessment)).toContain("WRONG_CANDIDATE");
    expect(assessment.state).toBe("WRONG_CANDIDATE");
  });
});

/* ── K. timestamps ──────────────────────────────────────────────────────── */

describe("248 — freshness uses the gate's own window, at an injected instant", () => {
  it("44. the boundary is exact on both sides", () => {
    const window = CONVEX_DEPLOYMENT_MAX_AGE_MS as number;
    const atWindow = assess(pkg({ observedAt: NOW - window }));
    expect(atWindow.complete, "exactly at the window is admissible").toBe(true);
    const pastWindow = assess(pkg({ observedAt: NOW - window - 1 }));
    expect(codes(pastWindow)).toContain("STALE_OBSERVATION");
    expect(pastWindow.state).toBe("STALE_OBSERVATION");
  });

  it("45. a future observation is refused, by the observation rule itself", () => {
    const assessment = assess(pkg({ observedAt: NOW + 1 }));
    expect(codes(assessment)).toContain("FUTURE_OBSERVATION");
    expect(assessment.state).toBe("FUTURE_OBSERVATION");
  });

  it("46. a non-finite observation is refused rather than coerced", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "now" as never, null as never]) {
      expect(codes(assess(pkg({ observedAt: value })))).toContain("OBSERVATION_NOT_A_NUMBER");
    }
  });

  it("47. a missing evaluation instant is refused instead of defaulting to a clock", () => {
    const assessment = evaluateConvexDeploymentPackage(pkg(), {
      now: Number.NaN,
      candidate: CANDIDATE,
      productionDeployment: DEPLOYMENT,
      requiredFunctions: FUNCTIONS,
    });
    expect(codes(assessment)).toContain("NO_EVALUATION_INSTANT");
  });

  it("48. time passing only makes a package staler, never fresher", () => {
    const observedAt = NOW - 6 * DAY;
    expect(assess(pkg({ observedAt }), { now: NOW }).complete).toBe(true);
    expect(assess(pkg({ observedAt }), { now: NOW + 2 * DAY }).state).toBe("STALE_OBSERVATION");
  });
});

/* ── L. lesser claims ───────────────────────────────────────────────────── */

describe("248 — a lesser claim is never a deployment", () => {
  it("49. fixture, synthetic and the *-only markers each refuse", () => {
    const cases: [keyof ConvexDeploymentPackage, string][] = [
      ["fixture", "FIXTURE_MARKED"],
      ["synthetic", "SYNTHETIC_MARKED"],
      ["configurationOnly", "CONFIGURATION_ONLY"],
      ["buildOnly", "BUILD_ONLY"],
      ["codegenOnly", "CODEGEN_ONLY"],
    ];
    for (const [field, code] of cases) {
      const assessment = assess(pkg({ [field]: true } as never));
      expect(codes(assessment), String(field)).toContain(code);
      expect(assessment.state, String(field)).toBe("FIXTURE_NOT_LIVE");
      expect(assessment.syntheticScoped, String(field)).toBe(true);
    }
  });

  it("50. the accepted and rejected categories are stated, and the rejected list is the long one", () => {
    expect(ACCEPTED_DEPLOYMENT_CATEGORIES.length).toBeGreaterThan(0);
    expect(REJECTED_DEPLOYMENT_CATEGORIES.length).toBeGreaterThan(ACCEPTED_DEPLOYMENT_CATEGORIES.length);
    expect(REJECTED_DEPLOYMENT_CATEGORIES.join(" ")).toMatch(/configuration presence/i);
    expect(REJECTED_DEPLOYMENT_CATEGORIES.join(" ")).toMatch(/green build/i);
  });
});

/* ── M. state precedence and the code→state map ─────────────────────────── */

describe("248 — the state is deterministic and every code is mapped", () => {
  it("51. every refusal code the validator can emit has a declared state", () => {
    // Collect the codes the validator actually emits across a broad sweep, and
    // assert each is in the map. An unmapped code would degrade to INVALID_EVIDENCE.
    const emitted = new Set<string>();
    const sweep: unknown[] = [
      pkg(),
      pkg({ schema: "x" }),
      pkg({ verified: false }),
      pkg({ source: "documentation" }),
      pkg({ environment: "development" }),
      pkg({ deployment: "dev:a:b" }),
      pkg({ deployment: "" }),
      pkg({ deploymentUrl: "http://x" }),
      pkg({ siteUrl: "https://x.convex.cloud" }),
      pkg({ accessVerdict: "NOT_REACHABLE" }),
      pkg({ accessVerdict: "" }),
      pkg({ deploymentEnv: "preview" }),
      pkg({ deploymentEnv: "prod" }),
      pkg({ dropFunction: FUNCTIONS[0] }),
      pkg({ candidate: { commit: "other" } }),
      pkg({ observedAt: NOW + 1 }),
      pkg({ fixture: true }),
      "not-an-object",
    ];
    for (const value of sweep) {
      // Vary the declared deployment so NO_DECLARED / WRONG_DEPLOYMENT appear.
      for (const productionDeployment of [DEPLOYMENT, undefined, "prod:xstarz:other"]) {
        const assessment = evaluateConvexDeploymentPackage(value, {
          now: NOW,
          candidate: CANDIDATE,
          productionDeployment,
          requiredFunctions: FUNCTIONS,
        });
        for (const refusal of assessment.refusals) emitted.add(refusal.code);
      }
    }
    for (const code of emitted) {
      expect(CONVEX_DEPLOYMENT_CODE_STATES, code).toHaveProperty(code);
    }
    // The sweep is broad enough to exercise the whole refusal vocabulary.
    expect(emitted.size).toBeGreaterThan(12);
  });

  it("52. every mapped state is a real state in the precedence order", () => {
    for (const state of Object.values(CONVEX_DEPLOYMENT_CODE_STATES)) {
      expect(CONVEX_DEPLOYMENT_STATE_PRECEDENCE).toContain(state);
    }
    expect(CONVEX_DEPLOYMENT_STATE_PRECEDENCE[0]).toBe("INVALID_EVIDENCE");
    expect(CONVEX_DEPLOYMENT_STATE_PRECEDENCE[CONVEX_DEPLOYMENT_STATE_PRECEDENCE.length - 1]).toBe(
      "CONVEX_DEPLOYMENT_VERIFIED",
    );
  });

  it("53. the worst state wins regardless of field order, and is stable", () => {
    // A package that is both a fixture and stale reports the higher-precedence state.
    const window = CONVEX_DEPLOYMENT_MAX_AGE_MS as number;
    const a = assess(pkg({ fixture: true, observedAt: NOW - window - 1 }));
    expect(a.state).toBe("FIXTURE_NOT_LIVE");
    // Two independent refusals: identity beats access in precedence.
    const b = assess(pkg({ deployment: "dev:a:b", accessVerdict: "NOT_REACHABLE" }));
    expect(b.state).toBe("NON_PRODUCTION_DEPLOYMENT");
    expect(b.refusals.length).toBeGreaterThanOrEqual(2);
    // The summary is the WORST state by precedence, not the first refusal emitted.
    // A fixture marker is refused before a credential-shaped field is even scanned,
    // yet INVALID_EVIDENCE (the credential) outranks FIXTURE_NOT_LIVE, so the state
    // must be INVALID_EVIDENCE. A "first code wins" summary would say FIXTURE_NOT_LIVE.
    const c = assess(pkg({ fixture: true, apiKey: "super-secret" } as never));
    expect(c.refusals.map((entry) => entry.code)).toContain("FIXTURE_MARKED");
    expect(c.refusals.map((entry) => entry.code)).toContain("CARRIES_CREDENTIAL_VALUE");
    expect(c.state).toBe("INVALID_EVIDENCE");
    // Re-evaluating is identical (determinism).
    expect(assess(pkg({ deployment: "dev:a:b", accessVerdict: "NOT_REACHABLE" })).state).toBe(b.state);
  });
});

/* ── N. the gate projection ─────────────────────────────────────────────── */

describe("248 — the gate reads what the validator verified, and nothing else", () => {
  it("54. an admissible package produces a gate record the gate accepts", () => {
    const projection = toGateConvexRecord(assess(pkg()), { candidateCommit: COMMIT, deployment: DEPLOYMENT });
    expect(projection.refusals).toEqual([]);
    const record = projection.record!;
    expect(record).not.toBeNull();
    expect(record.prerequisite).toBe(CONVEX_DEPLOYMENT_PREREQUISITE);
    expect(record.status).toBe("VERIFIED");
    expect(record.source).toBe("external-verification");
    expect(record.environment).toBe("production");
    expect(record.subject?.commit).toBe(COMMIT);
    expect(record.subject?.deployment).toBe(DEPLOYMENT);

    // The canonical gate accepts that record for the deployment prerequisite.
    const verdict = evaluateRelease(
      {
        candidate: { commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
        affectedRefs: ["main"],
        requiredProviders: [],
        records: [record],
      },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    const outcome = verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(outcome.state).toBe("VERIFIED");
  });

  it("55. an inadmissible package produces no record at all", () => {
    const projection = toGateConvexRecord(assess(pkg({ dropFunction: FUNCTIONS[0] })), {
      candidateCommit: COMMIT,
      deployment: DEPLOYMENT,
    });
    expect(projection.record).toBeNull();
    expect(projection.refusals.length).toBeGreaterThan(0);
  });

  it("56. a fixture-scoped package cannot project a record even if otherwise complete", () => {
    const projection = toGateConvexRecord(assess(pkg({ fixture: true })), {
      candidateCommit: COMMIT,
      deployment: DEPLOYMENT,
    });
    expect(projection.record).toBeNull();
    expect(projection.refusals.join(" ")).toMatch(/fixture/i);
  });

  it("57. the gate's own deployment binding still refuses a wrong subject", () => {
    // Even a hand-built VERIFIED record with the wrong deployment is refused by
    // the gate: the validator is stricter, but the gate is not bypassed.
    const verdict = evaluateRelease(
      {
        candidate: { commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
        affectedRefs: ["main"],
        requiredProviders: [],
        records: [
          {
            prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
            status: "VERIFIED",
            source: "external-verification",
            environment: "production",
            observedAt: NOW - HOUR,
            subject: { commit: COMMIT, deployment: "prod:xstarz:other" },
          },
        ],
      },
      { prerequisites: RELEASE_PREREQUISITES, now: NOW },
    );
    const outcome = verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(outcome.state).not.toBe("VERIFIED");
  });
});

/* ── O. reader integration ──────────────────────────────────────────────── */

describe("248 — the reader validates the filed package rather than quoting it", () => {
  const baseFiles = { [PROOF_PATHS.refInventory]: REF_INVENTORY };

  it("58. a filed conformant package is judged by the validator", () => {
    const state = deriveCurrentReleaseState(
      memorySource({ ...baseFiles, [PROOF_PATHS.convexDeployment]: JSON.stringify(pkg()) }),
      { now: NOW, commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
    );
    const outcome = state.verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(outcome.state).toBe("VERIFIED");
    expect(state.verdict.blockers).not.toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("59. a bare pre-248 claim is refused, not accepted on four fields", () => {
    const state = deriveCurrentReleaseState(
      memorySource({ ...baseFiles, [PROOF_PATHS.convexDeployment]: bareConvexClaim() }),
      { now: NOW, commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
    );
    const outcome = state.verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(outcome.state).toBe("BLOCKED");
    expect(outcome.reasons.join(" ")).toMatch(/refused by the Convex deployment validator/);
    expect(state.verdict.blockers).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("60. a stale, a partial-coverage and a foreign package each stay blockers", () => {
    const window = CONVEX_DEPLOYMENT_MAX_AGE_MS as number;
    for (const bad of [
      pkg({ observedAt: NOW - window - 1 }),
      pkg({ dropFunction: FUNCTIONS[0] }),
      pkg({ deployment: "prod:xstarz:elsewhere" }),
    ]) {
      const state = deriveCurrentReleaseState(
        memorySource({ ...baseFiles, [PROOF_PATHS.convexDeployment]: JSON.stringify(bad) }),
        { now: NOW, commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
      );
      expect(state.verdict.blockers).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
    }
  });

  it("61. a package that cannot be parsed is UNVERIFIED, never a pass", () => {
    const state = deriveCurrentReleaseState(
      memorySource({ ...baseFiles, [PROOF_PATHS.convexDeployment]: "{ not json" }),
      { now: NOW, commit: COMMIT, ref: REF, productionDeployment: DEPLOYMENT },
    );
    const outcome = state.verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    // The reader names the parse failure on the record; the gate reports the
    // record as malformed, which is the same refusal one layer up.
    expect(outcome.state).toBe("UNVERIFIED");
    expect(outcome.reasons.join(" ")).toContain("malformed");
    expect(state.verdict.blockers).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("62. without a declared deployment the gate refuses even a valid package", () => {
    const state = deriveCurrentReleaseState(
      memorySource({ ...baseFiles, [PROOF_PATHS.convexDeployment]: JSON.stringify(pkg()) }),
      { now: NOW, commit: COMMIT, ref: REF /* no productionDeployment */ },
    );
    expect(state.verdict.blockers).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("63. pinning the required surface is honoured by the reader", () => {
    // A package publishing only a pinned subset is complete against that subset.
    const subset = FUNCTIONS.slice(0, 3);
    const state = deriveCurrentReleaseState(
      memorySource({
        ...baseFiles,
        [PROOF_PATHS.convexDeployment]: JSON.stringify(pkg({ publishedFunctions: subset })),
      }),
      {
        now: NOW,
        commit: COMMIT,
        ref: REF,
        productionDeployment: DEPLOYMENT,
        requiredConvexFunctions: subset,
      },
    );
    const outcome = state.verdict.prerequisites.find((p) => p.id === CONVEX_DEPLOYMENT_PREREQUISITE)!;
    expect(outcome.state).toBe("VERIFIED");
  });
});

/* ── P. the canonical admission, and the real tree ──────────────────────── */

describe("248 — the admission stays authoritative and the real tree is unchanged", () => {
  it("64. the admission refuses this tree, and CONVEX is among the blockers", () => {
    const admission = evaluateReleaseAdmission({ now: NOW });
    expect(admission.admitted).toBe(false);
    expect(admission.verdict).toBe("NOT READY");
    expect(admission.blockers.map((b) => b.id)).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("65. filing only a CONVEX package does not admit the release", () => {
    const admission = evaluateReleaseAdmission({
      source: memorySource({
        [PROOF_PATHS.refInventory]: REF_INVENTORY,
        [PROOF_PATHS.convexDeployment]: JSON.stringify(pkg()),
      }),
      now: NOW,
      commit: COMMIT,
      ref: REF,
      productionDeployment: DEPLOYMENT,
    });
    expect(admission.admitted).toBe(false);
    // A1, A2 and Evidence D are still missing. Phase 270: there is no email
    // prerequisite anymore — a CONVEX-only package leaves a 3-blocker world.
    const ids = admission.blockers.map((b) => b.id);
    expect(ids).toContain("A1_OTP_ISSUER_REVOCATION");
    expect(ids).toContain("A2_HISTORY_REWRITE");
    expect(ids).not.toContain("PRODUCTION_EMAIL_TRANSPORT");
    expect(ids).toContain("EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION");
    expect(ids).not.toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("66. the real tree is still NOT READY, and this suite changed nothing", () => {
    const verdict = currentReleaseVerdict(undefined, { now: NOW });
    expect(verdict.verdict).toBe("NOT READY");
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers).toContain(CONVEX_DEPLOYMENT_PREREQUISITE);
  });

  it("67. A1 and A2 remain blockers, untouched by this phase", () => {
    const verdict = currentReleaseVerdict(undefined, { now: NOW });
    expect(verdict.blockers).toContain("A1_OTP_ISSUER_REVOCATION");
    expect(verdict.blockers).toContain("A2_HISTORY_REWRITE");
  });
});

/* ── Q. the operator command cannot act ─────────────────────────────────── */

describe("248 — the operator command cannot act", () => {
  const command = read("scripts/convex-deployment-verify.mjs");

  it("68. the command imports no network module and spawns nothing", () => {
    const stripped = stripComments(command);
    expect(stripped).not.toMatch(/node:(net|http|https|dns|tls|child_process)/);
    expect(stripped).not.toMatch(/\bfetch\s*\(/);
    expect(stripped).not.toMatch(/spawnSync|execSync|execFile|\bspawn\(/);
  });

  it("69. the command reads nothing but the package, and touches no credential", () => {
    const stripped = stripComments(command);
    expect(stripped).not.toMatch(/process\.env/);
    // fs is read-only: no writer of any kind.
    expect(stripped).not.toMatch(/writeFileSync|appendFileSync|mkdirSync|rmSync|createWriteStream|unlinkSync/);
    expect(stripped).toMatch(/readFileSync/);
  });

  it("70. the command calls the canonical admission instead of re-implementing it", () => {
    expect(command).toMatch(/evaluateReleaseAdmission/);
    expect(command).toMatch(/release-admission\.ts/);
    // It does not compute a verdict of its own.
    expect(stripComments(command)).not.toMatch(/verdict\s*[:=]\s*["'`](READY|NOT READY)["'`]/);
  });

  it("71. the command is wired to the canonical filing path and package script", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["deployment:verify"]).toContain("scripts/convex-deployment-verify.mjs");
    expect(scripts["deployment:verify"]).toContain("--no-warnings");
    expect(PROOF_PATHS.convexDeployment).toBe("docs/remediation/convex-production-deployment.json");
    expect(command).toContain("PROOF_PATHS.convexDeployment");
  });

  it("72. the command uses the scanned surface, not a second list", () => {
    expect(command).toMatch(/requiredConvexFunctionReferences/);
    expect(command).toMatch(/convex-function-surface/);
  });
});

/* ── R. the decision module is pure ─────────────────────────────────────── */

describe("248 — the decision module is pure", () => {
  it("73. no fs, no process, no clock, no socket in its own source", () => {
    const source = stripComments(read("src/lib/deployment/convex-deployment-verification.ts"));
    expect(source).not.toMatch(/node:(fs|child_process|net|http|https|dns|tls|process)/);
    expect(source).not.toMatch(/\bfetch\s*\(|process\.env|Date\.now|new Date\(/);
    expect(source).not.toMatch(/writeFileSync|spawnSync|execSync|mkdirSync/);
  });

  it("74. the surface scanner is the only part that touches the filesystem", () => {
    const scanner = read("src/lib/deployment/convex-function-surface.ts");
    expect(scanner).toMatch(/node:fs/);
    // And it only reads.
    expect(stripComments(scanner)).not.toMatch(/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync/);
  });
});

/* ── S. the operator handoff ────────────────────────────────────────────── */

describe("248 — the handoff states its guarantees, and every one is false", () => {
  it("75. the guarantees are all false, and it issues no verdict", () => {
    const handoff = buildConvexDeploymentOperatorHandoff(assess(pkg()), {
      filingPath: PROOF_PATHS.convexDeployment,
      declaredDeployment: DEPLOYMENT,
    });
    for (const [key, value] of Object.entries(handoff.guarantees)) expect(value, key).toBe(false);
    expect(Object.keys(handoff.guarantees).length).toBeGreaterThanOrEqual(8);
    expect(handoff.verdictIssuedHere).toBe(false);
    expect(handoff.controlPlaneContacted).toBe(false);
    expect(handoff.prerequisite.id).toBe(CONVEX_DEPLOYMENT_PREREQUISITE);
    expect(handoff.prerequisite.binding).toBe("deployment");
  });

  it("76. the rendered handoff names the contract and its own limits", () => {
    const rendered = formatConvexDeploymentOperatorHandoff(
      buildConvexDeploymentOperatorHandoff(assess(pkg()), {
        filingPath: PROOF_PATHS.convexDeployment,
        declaredDeployment: DEPLOYMENT,
      }),
    );
    expect(rendered).toContain("did not contact a control plane");
    expect(rendered).toContain("does not issue a release verdict");
    expect(rendered).toContain(CONVEX_DEPLOYMENT_SCHEMA);
    expect(rendered).toContain("operator sequence");
    expect(rendered).toContain("required functions");
  });

  it("77. the exit code separates a blocker from an admissible package", () => {
    expect(
      convexDeploymentHandoffExitCode(
        buildConvexDeploymentOperatorHandoff(assess(pkg()), { filingPath: "p" }),
      ),
    ).toBe(0);
    const refusal = buildConvexDeploymentOperatorHandoff(assess(pkg({ dropFunction: FUNCTIONS[0] })), {
      filingPath: "p",
    });
    expect(convexDeploymentHandoffExitCode(refusal)).toBe(1);
    expect(formatConvexDeploymentOperatorHandoff(refusal)).toContain("blocker");
  });
});
