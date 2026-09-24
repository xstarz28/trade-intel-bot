/**
 * Phase 248 — Convex production deployment verification.
 *
 * ── What this file decides, and what it refuses to decide ────────────────────
 *
 * The release gate has one prerequisite about the backend actually existing in
 * production: `CONVEX_PRODUCTION_DEPLOYMENT` — "the production Convex deployment
 * exists and was verified against the candidate commit". Until this phase the
 * gate read a filed JSON file and accepted it on four declared fields
 * (`verified`, `source`, `environment`, `observedAt`) plus a `subject.deployment`
 * string. That is enough to refuse a claim written in prose and NOT enough to
 * tell a real production deployment from a well-shaped sentence, which is the
 * only distinction the prerequisite is about. This module is that distinction,
 * as a decision.
 *
 * The central contract, in the operator's words:
 *
 *   A VERIFIED PRODUCTION DEPLOYMENT
 *     != CONFIGURATION PRESENCE      (Phase 243 answers that, and says so)
 *     != A GREEN BUILD               (the artifact compiled; nothing was deployed)
 *     != CODEGEN RAN                 (types were regenerated; nothing was published)
 *     != CONTROL PLANE REACHABLE     (Phase 234: a dead network is not a deployment)
 *     != A DEV/PREVIEW DEPLOYMENT    (a promoted dev deployment is not production)
 *
 * ── The rules, and who owns each one ─────────────────────────────────────────
 *
 *   - The required function set is NOT restated here. It arrives as an argument,
 *     scanned from the candidate's own `src/convex` by `convex-function-surface.ts`,
 *     so a function added to the backend is required the moment it exists. An
 *     empty or absent set is refused: "unknown" is never "covered".
 *   - The production identity rule is the configuration checker's own
 *     (`deploymentIdentityProblem`): a `prod:<team>:<project>` identity, and never
 *     a `dev:`/`preview:`/`local`/`anonymous:` one. There is no second copy.
 *   - The runtime environment is resolved with the REAL fail-closed policy
 *     (`resolveDeploymentEnvironment`), so a deployment whose observed
 *     `XSTARZ_DEPLOYMENT_ENV` is anything but production — or unresolvable — is
 *     refused by the same rule the backend uses at runtime.
 *   - The control-plane access verdict must be the Phase 234 state whose exit code
 *     is 0 (`AUTHENTICATED`), read from `EXIT_CODES` rather than named twice:
 *     reachable-and-authenticated, not merely reachable and not a rejected key.
 *   - The deployment URLs must be external https Convex hosts (`*.convex.cloud`,
 *     `*.convex.site`); loopback and forbidden identity hosts are refused.
 *   - The package carries no credential: any field whose name could hold one
 *     refuses the whole package before it is read further (the Phase 247 scan).
 *   - This module performs NO verification of its own. It never contacts a
 *     control plane, never reads a credential, never writes, never spawns and
 *     never imports a network or process module. It is pure: same input, same
 *     decision. The evaluation instant is a required argument; there is no clock.
 *
 * ── The states an operator is shown ──────────────────────────────────────────
 *
 * Every refusal carries a code and a sentence; the STATE is a deterministic
 * summary chosen by `CONVEX_DEPLOYMENT_STATE_PRECEDENCE`, so reordering the
 * package's fields cannot change it. `CONVEX_DEPLOYMENT_VERIFIED` means the
 * package is admissible for evaluation by the release gate — it does NOT mean the
 * release is admitted, and nothing here can produce that.
 */
import {
  DEPLOYMENT_ENV_VAR,
  DeploymentPolicyError,
  resolveDeploymentEnvironment,
} from "../../convex/lib/deploymentEnvironment";
import {
  FORBIDDEN_DELIVERY_HOSTS,
  RETIRED_ISSUER_HOSTS,
} from "../../convex/lib/issuerPolicy";
// The Phase 234 access-verdict contract, imported so this module reads the real
// exit-code table rather than restating which verdict means "ready to deploy".
// Typed by scripts/lib/convex-access-verdict.d.mts (no `any` cast).
import { EXIT_CODES } from "../../../scripts/lib/convex-access-verdict.mjs";
import { evidenceDigest } from "./a2-rehearsal";
import { credentialBearingKeys } from "./evidence-d-verification";
import { deploymentIdentityProblem } from "./production-config";
import { CONVEX_ROOT } from "./convex-function-surface";
import { RELEASE_PREREQUISITES } from "./release-gate";
import type { EvidenceEnvironment, EvidenceRecord } from "./release-gate";

/* ── the prerequisite, read from the canonical manifest ─────────────────────── */

/**
 * The prerequisite this module is about, found by its binding rather than named
 * twice. If the manifest ever carries zero or two deployment-bound prerequisites
 * the contract is broken and evaluation refuses: a validator that silently
 * guessed which one it was checking would be checking whichever one it liked.
 */
const DEPLOYMENT_BOUND = RELEASE_PREREQUISITES.filter((entry) => entry.binding === "deployment");

export const CONVEX_DEPLOYMENT_CONTRACT_PROBLEMS: readonly string[] = (() => {
  const problems: string[] = [];
  if (DEPLOYMENT_BOUND.length !== 1) {
    problems.push(
      `expected exactly one deployment-bound prerequisite in the release manifest, found ${DEPLOYMENT_BOUND.length}`,
    );
  }
  return problems;
})();

export const CONVEX_DEPLOYMENT_PREREQUISITE = DEPLOYMENT_BOUND[0]?.id ?? "";
/** The environment the prerequisite requires — read, not restated. */
export const CONVEX_DEPLOYMENT_ENVIRONMENT: EvidenceEnvironment =
  DEPLOYMENT_BOUND[0]?.requiredEnvironment ?? "production";
/** The freshness window the gate applies — read, not restated. */
export const CONVEX_DEPLOYMENT_MAX_AGE_MS: number | null = DEPLOYMENT_BOUND[0]?.maxAgeMs ?? null;

/** The tag a filed package must carry. */
export const CONVEX_DEPLOYMENT_SCHEMA = "phase248.convex-deployment/v1";
export const CONVEX_DEPLOYMENT_HANDOFF_SCHEMA = "phase248.convex-deployment-handoff/v1";

/* ── the production hosts, and the access verdict that proves reachability ───── */

/**
 * The Convex host families a production deployment serves from. Both must be
 * https; neither distinguishes production from development by name (see
 * `deploymentEnvironment.ts`), which is exactly why the identity and the observed
 * environment — not the host — decide "production".
 */
export const CONVEX_CLOUD_SUFFIX = ".convex.cloud";
export const CONVEX_SITE_SUFFIX = ".convex.site";

/** Hosts that must never appear as a deployment identity (retired + forbidden). */
export const FORBIDDEN_DEPLOYMENT_HOSTS: readonly string[] = [
  ...new Set([...FORBIDDEN_DELIVERY_HOSTS, ...RETIRED_ISSUER_HOSTS]),
];

/**
 * The control-plane access verdict that proves a deployment was reached AND
 * authenticated. Read from the Phase 234 exit-code table rather than named here:
 * the state whose exit code is 0 is, by that contract, the only "ready to deploy"
 * answer. If the table ever changes, this follows it instead of drifting — there
 * is no second copy of "which verdict means authenticated".
 *
 * An empty set (no state maps to exit 0) refuses every verdict, which is the safe
 * direction: fail closed, never fail open.
 */
export const AUTHENTICATED_ACCESS_STATES: readonly string[] = Object.entries(EXIT_CODES)
  .filter(([, code]) => code === 0)
  .map(([state]) => state)
  .sort();

/* ── the package contract ───────────────────────────────────────────────────── */

export interface ConvexDeploymentCandidateBinding {
  commit?: string;
  ref?: string;
}

export interface ConvexDeploymentPackage {
  schema: string;
  environment: string;
  source: string;
  verified: boolean;
  /** The instant the operator verified the deployment (verifier-owned). */
  observedAt: number;
  /** When the package was assembled, when it differs from the observation. */
  verifiedAt?: number;
  candidate?: ConvexDeploymentCandidateBinding;
  /** The production deployment identity: `prod:<team>:<project>`. */
  deployment?: string;
  /** The live cloud endpoint: `https://<name>.convex.cloud`. */
  deploymentUrl?: string;
  /** The live site endpoint: `https://<name>.convex.site`. */
  siteUrl?: string;
  /**
   * The observed value of `XSTARZ_DEPLOYMENT_ENV` on the deployment, or `null`
   * when it is unset. Resolved with the real policy: unset means production,
   * anything unrecognised is a hard refusal.
   */
  deploymentEnv?: string | null;
  /** The Phase 234 control-plane access verdict observed for this deployment. */
  accessVerdict?: string;
  /**
   * The functions the deployment publishes, from `convex function-spec`, in
   * `<module>.<function>` form. Must cover the required surface.
   */
  publishedFunctions?: readonly string[];
  /** Markers that make a package a claim rather than a verification. */
  fixture?: boolean;
  synthetic?: boolean;
  configurationOnly?: boolean;
  buildOnly?: boolean;
  codegenOnly?: boolean;
  /** Deterministic digest over this package's own content, minus the digest. */
  digest?: string;
  [key: string]: unknown;
}

/** The fields a package must carry to be considered at all. */
export const REQUIRED_PACKAGE_FIELDS: readonly string[] = [
  "schema",
  "environment",
  "source",
  "verified",
  "observedAt",
  "deployment",
  "deploymentUrl",
  "siteUrl",
  "accessVerdict",
  "publishedFunctions",
];

/* ── the states ─────────────────────────────────────────────────────────────── */

export type ConvexDeploymentState =
  | "CONVEX_DEPLOYMENT_VERIFIED"
  | "INVALID_EVIDENCE"
  | "FIXTURE_NOT_LIVE"
  | "WRONG_CANDIDATE"
  | "NON_PRODUCTION_DEPLOYMENT"
  | "WRONG_ACCESS"
  | "WRONG_DEPLOYMENT"
  | "MISSING_FUNCTION"
  | "FUTURE_OBSERVATION"
  | "STALE_OBSERVATION";

/**
 * The state an operator sees, chosen by this order rather than by which field
 * happened to be read first. Reordering the package cannot change it, and a
 * package that fails two rules reports both while the state stays deterministic.
 */
export const CONVEX_DEPLOYMENT_STATE_PRECEDENCE: readonly ConvexDeploymentState[] = [
  "INVALID_EVIDENCE",
  "FIXTURE_NOT_LIVE",
  "WRONG_CANDIDATE",
  "NON_PRODUCTION_DEPLOYMENT",
  "WRONG_ACCESS",
  "WRONG_DEPLOYMENT",
  "MISSING_FUNCTION",
  "FUTURE_OBSERVATION",
  "STALE_OBSERVATION",
  "CONVEX_DEPLOYMENT_VERIFIED",
];

/**
 * Refusal code → the state it reports. Exported and asserted (in this phase's
 * suite) to cover every code the validator can emit: an unmapped code would
 * silently degrade to `INVALID_EVIDENCE`, which is how a specific refusal turns
 * into a vague one.
 */
export const CONVEX_DEPLOYMENT_CODE_STATES: Readonly<Record<string, ConvexDeploymentState>> = {
  NOT_AN_OBJECT: "INVALID_EVIDENCE",
  WRONG_SCHEMA: "INVALID_EVIDENCE",
  NOT_VERIFIED: "INVALID_EVIDENCE",
  WRONG_SOURCE: "INVALID_EVIDENCE",
  NO_DIGEST: "INVALID_EVIDENCE",
  DIGEST_MISMATCH: "INVALID_EVIDENCE",
  CARRIES_CREDENTIAL_VALUE: "INVALID_EVIDENCE",
  OBSERVATION_NOT_A_NUMBER: "INVALID_EVIDENCE",
  NO_EVALUATION_INSTANT: "INVALID_EVIDENCE",
  CONTRACT_BROKEN: "INVALID_EVIDENCE",
  PUBLISHED_FUNCTIONS_NOT_AN_ARRAY: "INVALID_EVIDENCE",
  UNMAPPED_REFUSAL_CODE: "INVALID_EVIDENCE",
  FIXTURE_MARKED: "FIXTURE_NOT_LIVE",
  SYNTHETIC_MARKED: "FIXTURE_NOT_LIVE",
  CONFIGURATION_ONLY: "FIXTURE_NOT_LIVE",
  BUILD_ONLY: "FIXTURE_NOT_LIVE",
  CODEGEN_ONLY: "FIXTURE_NOT_LIVE",
  WRONG_CANDIDATE: "WRONG_CANDIDATE",
  WRONG_ENVIRONMENT: "NON_PRODUCTION_DEPLOYMENT",
  MISSING_DEPLOYMENT_IDENTITY: "NON_PRODUCTION_DEPLOYMENT",
  NON_PRODUCTION_DEPLOYMENT_IDENTITY: "NON_PRODUCTION_DEPLOYMENT",
  DEPLOYMENT_ENV_NOT_PRODUCTION: "NON_PRODUCTION_DEPLOYMENT",
  DEPLOYMENT_ENV_UNRESOLVABLE: "NON_PRODUCTION_DEPLOYMENT",
  MISSING_ACCESS_VERDICT: "WRONG_ACCESS",
  UNKNOWN_ACCESS_VERDICT: "WRONG_ACCESS",
  ACCESS_NOT_AUTHENTICATED: "WRONG_ACCESS",
  NO_DECLARED_DEPLOYMENT: "WRONG_DEPLOYMENT",
  WRONG_DEPLOYMENT: "WRONG_DEPLOYMENT",
  MISSING_DEPLOYMENT_URL: "WRONG_DEPLOYMENT",
  MISSING_SITE_URL: "WRONG_DEPLOYMENT",
  DEPLOYMENT_URL_NOT_HTTPS: "WRONG_DEPLOYMENT",
  DEPLOYMENT_URL_NOT_CONVEX_CLOUD: "WRONG_DEPLOYMENT",
  DEPLOYMENT_URL_LOOPBACK: "WRONG_DEPLOYMENT",
  DEPLOYMENT_URL_FORBIDDEN_HOST: "WRONG_DEPLOYMENT",
  SITE_URL_NOT_CONVEX_SITE: "WRONG_DEPLOYMENT",
  REQUIRED_FUNCTIONS_UNKNOWN: "MISSING_FUNCTION",
  MISSING_FUNCTION: "MISSING_FUNCTION",
  FUTURE_OBSERVATION: "FUTURE_OBSERVATION",
  STALE_OBSERVATION: "STALE_OBSERVATION",
};

export interface ConvexDeploymentRefusal {
  code: string;
  state: ConvexDeploymentState;
  reason: string;
}

export interface ConvexDeploymentAssessment {
  schema: string;
  state: ConvexDeploymentState;
  /** True only when the package is admissible for gate evaluation. */
  complete: boolean;
  /** True when the package declares itself a fixture or a lesser claim. */
  syntheticScoped: boolean;
  /** The production deployment identity the package names, when it names one. */
  deployment: string | null;
  /** The required surface, echoed so the operator sees what was demanded. */
  requiredFunctions: readonly string[];
  /** The required functions the published set does not cover. */
  missingFunctions: readonly string[];
  refusals: readonly ConvexDeploymentRefusal[];
  /** Flat, deterministic lines an operator can act on. */
  problems: readonly string[];
  /** The verifier-owned observation instant, when it was usable. */
  observedAt: number | null;
  evaluatedAt: number;
  environment: string;
  maxAgeMs: number | null;
}

export interface ConvexDeploymentEvaluationOptions {
  /** The evaluation instant. Required: this module has no clock. */
  now: number;
  /** The release candidate the package claims to be about, when one is declared. */
  candidate?: ConvexDeploymentCandidateBinding;
  /**
   * The production deployment the candidate declares, when it declares one. This
   * is the gate's `candidate.productionDeployment`; omitted means the candidate
   * names no deployment, and the package is then refused for want of a binding
   * target rather than accepted against an unnamed one.
   */
  productionDeployment?: string;
  /**
   * The functions the deployment must publish. Required and non-empty: an unknown
   * surface can never be "covered", so an empty set is a refusal, not a pass.
   */
  requiredFunctions?: readonly string[];
}

function stateOf(code: string): ConvexDeploymentState {
  return CONVEX_DEPLOYMENT_CODE_STATES[code] ?? "INVALID_EVIDENCE";
}

function refuse(
  refusals: ConvexDeploymentRefusal[],
  code: string,
  reason: string,
): void {
  refusals.push({ code, state: stateOf(code), reason });
}

function worstState(codes: readonly string[]): ConvexDeploymentState {
  for (const state of CONVEX_DEPLOYMENT_STATE_PRECEDENCE) {
    if (codes.some((code) => stateOf(code) === state)) return state;
  }
  return "INVALID_EVIDENCE";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/* ── the URL and environment checks, each reusing the real rule ─────────────── */

interface UrlCheck {
  ok: boolean;
  code: string;
  reason: string;
  host: string | null;
}

function checkCloudUrl(value: unknown): UrlCheck {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, code: "MISSING_DEPLOYMENT_URL", reason: "no deployment cloud URL was recorded", host: null };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, code: "DEPLOYMENT_URL_NOT_HTTPS", reason: `the deployment URL ${JSON.stringify(value)} is not an absolute URL`, host: null };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    return { ok: false, code: "DEPLOYMENT_URL_NOT_HTTPS", reason: `the deployment URL must use https (got ${url.protocol})`, host };
  }
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return { ok: false, code: "DEPLOYMENT_URL_LOOPBACK", reason: `the deployment URL points at a loopback host (${host}), which cannot be a production deployment`, host };
  }
  if (FORBIDDEN_DEPLOYMENT_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
    return { ok: false, code: "DEPLOYMENT_URL_FORBIDDEN_HOST", reason: `the deployment URL uses a retired or forbidden identity host (${host})`, host };
  }
  if (!host.endsWith(CONVEX_CLOUD_SUFFIX) || host === CONVEX_CLOUD_SUFFIX.slice(1)) {
    return { ok: false, code: "DEPLOYMENT_URL_NOT_CONVEX_CLOUD", reason: `the deployment URL host ${host} is not a *${CONVEX_CLOUD_SUFFIX} endpoint`, host };
  }
  return { ok: true, code: "", reason: "", host };
}

function checkSiteUrl(value: unknown): UrlCheck {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, code: "MISSING_SITE_URL", reason: "no deployment site URL was recorded", host: null };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, code: "SITE_URL_NOT_CONVEX_SITE", reason: `the site URL ${JSON.stringify(value)} is not an absolute URL`, host: null };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    return { ok: false, code: "SITE_URL_NOT_CONVEX_SITE", reason: `the site URL must use https (got ${url.protocol})`, host };
  }
  if (!host.endsWith(CONVEX_SITE_SUFFIX) || host === CONVEX_SITE_SUFFIX.slice(1)) {
    return { ok: false, code: "SITE_URL_NOT_CONVEX_SITE", reason: `the site URL host ${host} is not a *${CONVEX_SITE_SUFFIX} endpoint`, host };
  }
  return { ok: true, code: "", reason: "", host };
}

/**
 * Resolve the observed deployment environment with the REAL policy. Unset means
 * production (the fail-closed default); an unrecognised value throws, and a throw
 * is a refusal, not a downgrade.
 */
function checkDeploymentEnv(observed: unknown): { ok: boolean; code: string; reason: string; resolved: string | null } {
  const envValue = observed === null || observed === undefined ? undefined : String(observed);
  try {
    const resolved = resolveDeploymentEnvironment((key) => (key === DEPLOYMENT_ENV_VAR ? envValue : undefined));
    if (resolved !== CONVEX_DEPLOYMENT_ENVIRONMENT) {
      return {
        ok: false,
        code: "DEPLOYMENT_ENV_NOT_PRODUCTION",
        reason: `the deployment's ${DEPLOYMENT_ENV_VAR} resolves to ${resolved}, not ${CONVEX_DEPLOYMENT_ENVIRONMENT}`,
        resolved,
      };
    }
    return { ok: true, code: "", reason: "", resolved };
  } catch (error) {
    const message = error instanceof DeploymentPolicyError ? error.message : String(error);
    return { ok: false, code: "DEPLOYMENT_ENV_UNRESOLVABLE", reason: `the deployment's ${DEPLOYMENT_ENV_VAR} could not be resolved: ${message}`, resolved: null };
  }
}

/* ── the evaluation ─────────────────────────────────────────────────────────── */

/**
 * Verify a filed Convex deployment package.
 *
 * Pure and deterministic: the same package, instant, candidate, declared
 * deployment and required surface produce the same assessment, and no branch
 * reads a clock, an environment variable, a socket or a spawned process. The only
 * filesystem read in this module's graph is the module-load read of the access
 * verdict table and the scan the CALLER performs to supply `requiredFunctions`.
 */
export function evaluateConvexDeploymentPackage(
  pkg: unknown,
  options: ConvexDeploymentEvaluationOptions,
): ConvexDeploymentAssessment {
  const refusals: ConvexDeploymentRefusal[] = [];
  const now = finite(options?.now) ? options.now : Number.NaN;
  const requiredFunctions = [...(options.requiredFunctions ?? [])];

  if (!finite(now)) refuse(refusals, "NO_EVALUATION_INSTANT", "no evaluation instant was supplied");
  for (const problem of CONVEX_DEPLOYMENT_CONTRACT_PROBLEMS) refuse(refusals, "CONTRACT_BROKEN", problem);

  if (!isObject(pkg)) {
    refuse(refusals, "NOT_AN_OBJECT", "the package is not a JSON object");
    return finish(refusals, requiredFunctions, null, null, now, false);
  }

  const syntheticScoped =
    pkg.fixture === true ||
    pkg.synthetic === true ||
    pkg.configurationOnly === true ||
    pkg.buildOnly === true ||
    pkg.codegenOnly === true;

  if (pkg.schema !== CONVEX_DEPLOYMENT_SCHEMA) {
    refuse(refusals, "WRONG_SCHEMA", `the package schema is ${JSON.stringify(pkg.schema ?? null)}, expected ${CONVEX_DEPLOYMENT_SCHEMA}`);
  }
  if (pkg.verified !== true) {
    refuse(refusals, "NOT_VERIFIED", "the package does not assert that the deployment was verified");
  }
  if (pkg.source !== "external-verification") {
    refuse(refusals, "WRONG_SOURCE", `the package source is ${JSON.stringify(pkg.source ?? null)}; only external verification answers this prerequisite`);
  }
  if (pkg.environment !== CONVEX_DEPLOYMENT_ENVIRONMENT) {
    refuse(refusals, "WRONG_ENVIRONMENT", `the package is ${JSON.stringify(pkg.environment ?? null)}, the prerequisite requires ${CONVEX_DEPLOYMENT_ENVIRONMENT}`);
  }
  if (syntheticScoped) {
    const which =
      pkg.fixture === true ? "fixture"
      : pkg.synthetic === true ? "synthetic"
      : pkg.configurationOnly === true ? "configuration-only"
      : pkg.buildOnly === true ? "build-only"
      : "codegen-only";
    const code =
      pkg.fixture === true ? "FIXTURE_MARKED"
      : pkg.synthetic === true ? "SYNTHETIC_MARKED"
      : pkg.configurationOnly === true ? "CONFIGURATION_ONLY"
      : pkg.buildOnly === true ? "BUILD_ONLY"
      : "CODEGEN_ONLY";
    refuse(refusals, code, `the package declares itself ${which}, which is a claim about the repository, not a production deployment`);
  }

  const credentialKeys = credentialBearingKeys(pkg);
  if (credentialKeys.length > 0) {
    refuse(refusals, "CARRIES_CREDENTIAL_VALUE", `the package carries field(s) that could hold a credential: ${credentialKeys.slice(0, 3).join(", ")}`);
  }

  /* The digest is over the package's own content, minus the digest: a package
     whose numbers were edited after it was assembled fails here. */
  if (typeof pkg.digest !== "string" || pkg.digest.length === 0) {
    refuse(refusals, "NO_DIGEST", "the package carries no digest, so its content cannot be pinned");
  } else {
    const { digest, ...payload } = pkg;
    const expected = evidenceDigest(payload);
    if (expected !== digest) {
      refuse(refusals, "DIGEST_MISMATCH", `the package digest is ${digest}, its content hashes to ${expected}`);
    }
  }

  /* Candidate binding: a package about another commit is about another artifact. */
  const candidate = options.candidate ?? {};
  const packageCandidate = isObject(pkg.candidate) ? (pkg.candidate as ConvexDeploymentCandidateBinding) : undefined;
  if (typeof candidate.commit === "string" && candidate.commit.length > 0) {
    const claimed = packageCandidate?.commit;
    if (claimed !== candidate.commit) {
      refuse(refusals, "WRONG_CANDIDATE", `the package is bound to commit ${JSON.stringify(claimed ?? null)}, the candidate is ${candidate.commit}`);
    }
  }

  /* Production identity, reusing the configuration checker's rule. */
  const deployment = typeof pkg.deployment === "string" ? pkg.deployment.trim() : "";
  if (deployment.length === 0) {
    refuse(refusals, "MISSING_DEPLOYMENT_IDENTITY", "the package names no deployment identity");
  } else {
    const problem = deploymentIdentityProblem(deployment);
    if (problem) {
      refuse(refusals, "NON_PRODUCTION_DEPLOYMENT_IDENTITY", `the deployment identity ${JSON.stringify(deployment)} ${problem}`);
    }
  }

  /* Observed runtime environment, resolved with the real fail-closed policy. */
  const envCheck = checkDeploymentEnv(pkg.deploymentEnv);
  if (!envCheck.ok) refuse(refusals, envCheck.code, envCheck.reason);

  /* Control-plane access: the exit-0 verdict from the Phase 234 table, or nothing. */
  const accessVerdict = typeof pkg.accessVerdict === "string" ? pkg.accessVerdict.trim() : "";
  if (accessVerdict.length === 0) {
    refuse(refusals, "MISSING_ACCESS_VERDICT", "the package records no control-plane access verdict");
  } else if (AUTHENTICATED_ACCESS_STATES.length === 0) {
    refuse(refusals, "UNKNOWN_ACCESS_VERDICT", "no access verdict can be accepted: the Phase 234 exit-code table could not be read, so reachability cannot be established");
  } else if (!AUTHENTICATED_ACCESS_STATES.includes(accessVerdict)) {
    refuse(refusals, "ACCESS_NOT_AUTHENTICATED", `the control-plane access verdict is ${accessVerdict}; only ${AUTHENTICATED_ACCESS_STATES.join("/")} proves a reached and authenticated deployment`);
  }

  /* Deployment binding: the identity must equal the candidate's declared one. */
  const declared = options.productionDeployment?.trim() || "";
  if (declared.length === 0) {
    refuse(refusals, "NO_DECLARED_DEPLOYMENT", "no production deployment is declared for this candidate, so the package has nothing to bind to");
  } else if (deployment.length > 0 && deployment !== declared) {
    refuse(refusals, "WRONG_DEPLOYMENT", `the package names deployment ${JSON.stringify(deployment)}, the candidate deploys to ${JSON.stringify(declared)}`);
  }

  /* Deployment URLs: external https Convex hosts. */
  const cloud = checkCloudUrl(pkg.deploymentUrl);
  if (!cloud.ok) refuse(refusals, cloud.code, cloud.reason);
  const site = checkSiteUrl(pkg.siteUrl);
  if (!site.ok) refuse(refusals, site.code, site.reason);

  /* Function coverage: the deployment must publish the candidate's whole surface. */
  if (requiredFunctions.length === 0) {
    refuse(refusals, "REQUIRED_FUNCTIONS_UNKNOWN", "the required function surface is unknown, so coverage cannot be established");
  }
  if (!Array.isArray(pkg.publishedFunctions)) {
    refuse(refusals, "PUBLISHED_FUNCTIONS_NOT_AN_ARRAY", "the package carries no publishedFunctions array");
  } else if (requiredFunctions.length > 0) {
    const published = new Set(
      (pkg.publishedFunctions as unknown[])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().replace(/:/g, ".")),
    );
    const missing = requiredFunctions.filter((reference) => !published.has(reference)).sort();
    for (const reference of missing) {
      refuse(refusals, "MISSING_FUNCTION", `the deployment does not publish ${reference}, which this candidate defines`);
    }
  }

  /* Freshness: the verifier-owned observation, inside the gate's own window. */
  const observedAt = finite(pkg.observedAt) ? (pkg.observedAt as number) : Number.NaN;
  if (!finite(observedAt)) {
    refuse(refusals, "OBSERVATION_NOT_A_NUMBER", "the package carries no finite observedAt instant");
  } else if (observedAt > now) {
    refuse(refusals, "FUTURE_OBSERVATION", `the verification is stamped ${observedAt - now}ms ahead of evaluation`);
  } else if (CONVEX_DEPLOYMENT_MAX_AGE_MS !== null && now - observedAt > CONVEX_DEPLOYMENT_MAX_AGE_MS) {
    refuse(refusals, "STALE_OBSERVATION", `the verification is older than the ${CONVEX_DEPLOYMENT_MAX_AGE_MS}ms freshness window`);
  }

  return finish(
    refusals,
    requiredFunctions,
    deployment.length > 0 ? deployment : null,
    finite(observedAt) ? observedAt : null,
    now,
    syntheticScoped,
    Array.isArray(pkg.publishedFunctions) ? (pkg.publishedFunctions as readonly unknown[]) : undefined,
  );
}

function finish(
  refusals: ConvexDeploymentRefusal[],
  requiredFunctions: readonly string[],
  deployment: string | null,
  observedAt: number | null,
  now: number,
  syntheticScoped: boolean,
  published?: readonly unknown[],
): ConvexDeploymentAssessment {
  const unmapped = refusals.map((entry) => entry.code).filter((code) => !(code in CONVEX_DEPLOYMENT_CODE_STATES));
  if (unmapped.length > 0) {
    /* Fail closed and say so: an unmapped code means this module emitted a
       refusal nobody declared a state for, and guessing one would hide it. */
    refuse(refusals, "UNMAPPED_REFUSAL_CODE", `refusal code(s) with no declared state: ${[...new Set(unmapped)].sort().join(", ")}`);
  }
  const codes = refusals.map((entry) => entry.code);
  const state = codes.length === 0 ? "CONVEX_DEPLOYMENT_VERIFIED" : worstState(codes);

  const publishedSet = new Set(
    Array.isArray(published)
      ? published.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().replace(/:/g, "."))
      : [],
  );
  const missingFunctions = requiredFunctions.filter((reference) => !publishedSet.has(reference)).sort();
  const problems = refusals
    .map((entry) => `${entry.code} — ${entry.reason}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    schema: CONVEX_DEPLOYMENT_SCHEMA,
    state,
    complete: state === "CONVEX_DEPLOYMENT_VERIFIED",
    syntheticScoped,
    deployment,
    requiredFunctions: [...requiredFunctions].sort(),
    missingFunctions,
    refusals,
    problems,
    observedAt,
    evaluatedAt: now,
    environment: CONVEX_DEPLOYMENT_ENVIRONMENT,
    maxAgeMs: CONVEX_DEPLOYMENT_MAX_AGE_MS,
  };
}

/* ── the gate projection ────────────────────────────────────────────────────── */

export interface ConvexDeploymentGateProjection {
  record: EvidenceRecord | null;
  refusals: readonly string[];
}

/**
 * Project an accepted package onto the canonical gate record.
 *
 * The record binds the candidate commit and the deployment identity, which is
 * what the gate's `deployment` binding reads. A refused package projects to
 * `null` with its reasons, which is what makes an inadmissible package unable to
 * satisfy the prerequisite — no amount of editing the file turns a refusal into a
 * pass, because the projection is computed from the assessment, not declared.
 */
export function toGateConvexRecord(
  assessment: ConvexDeploymentAssessment,
  options: { candidateCommit?: string; deployment?: string },
): ConvexDeploymentGateProjection {
  const refusals: string[] = [];
  if (assessment.syntheticScoped) {
    refusals.push("a fixture, synthetic, configuration-only, build-only or codegen-only package may never be filed as a production deployment");
  }
  if (!assessment.complete) {
    refusals.push(...assessment.problems);
    if (assessment.problems.length === 0) refusals.push(`the package is ${assessment.state}`);
  }
  if (refusals.length > 0) return { record: null, refusals };
  if (assessment.observedAt === null) {
    return { record: null, refusals: ["the package carries no usable observation instant"] };
  }
  const deployment = options.deployment ?? assessment.deployment ?? "";
  return {
    record: {
      prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
      status: "VERIFIED",
      source: "external-verification",
      environment: CONVEX_DEPLOYMENT_ENVIRONMENT,
      observedAt: assessment.observedAt,
      subject: {
        ...(options.candidateCommit ? { commit: options.candidateCommit } : {}),
        deployment,
      },
      detail: `production Convex deployment ${deployment} verified, publishing ${assessment.requiredFunctions.length} required function(s)`,
    },
    refusals: [],
  };
}

/* ── the operator handoff ───────────────────────────────────────────────────── */

/** What counts, and what only looks like it counts. Printed, never inferred. */
export const ACCEPTED_DEPLOYMENT_CATEGORIES: readonly string[] = [
  "a production deployment identity (prod:<team>:<project>), bound to the candidate's declared deployment",
  "external https Convex endpoints (*.convex.cloud and *.convex.site), not a loopback or retired host",
  "a control-plane access verdict of AUTHENTICATED — reached and authenticated, not merely reachable",
  "the observed XSTARZ_DEPLOYMENT_ENV resolving to production under the real fail-closed policy",
  `every function this candidate defines under ${CONVEX_ROOT} published on the deployment`,
  "a verification instant inside the prerequisite's freshness window, bound to the candidate commit",
];

export const REJECTED_DEPLOYMENT_CATEGORIES: readonly string[] = [
  "configuration presence (Phase 243 answers that, and never claims a deployment)",
  "a green build or a compiled artifact",
  "codegen that ran but published nothing",
  "a control plane that is reachable but unauthenticated, or unreachable",
  "a dev, preview, local or anonymous deployment, or one promoted from dev",
  "a deployment whose observed environment resolves to development or preview",
  "a deployment missing any function this candidate defines",
  "a package bound to another candidate commit",
  "a verification with a future or stale instant",
  "a fixture, a synthetic record, or a claim written in this repository",
];

export interface ConvexDeploymentOperatorHandoff {
  schema: string;
  mode: string;
  state: ConvexDeploymentState;
  /** True when the package is admissible for evaluation. Never an admission. */
  complete: boolean;
  packagePath: string | null;
  filingPath: string;
  evaluatedAt: number;
  prerequisite: {
    id: string;
    requirement: string;
    environment: string;
    maxAgeMs: number | null;
    binding: string;
  };
  deployment: string | null;
  declaredDeployment: string | null;
  requiredFunctions: readonly string[];
  missingFunctions: readonly string[];
  acceptedAccessStates: readonly string[];
  contract: {
    schema: string;
    requiredFields: readonly string[];
    cloudSuffix: string;
    siteSuffix: string;
    forbiddenHosts: readonly string[];
    deploymentEnvVar: string;
    functionSurfaceRoot: string;
  };
  accepted: readonly string[];
  rejected: readonly string[];
  refusals: readonly ConvexDeploymentRefusal[];
  problems: readonly string[];
  gateProjection: { filed: boolean; prerequisite: string; refusals: readonly string[] };
  simulated: {
    performed: boolean;
    verdict: string | null;
    blockers: readonly string[];
    deploymentState: string | null;
  };
  statement: string;
  operatorSequence: readonly string[];
  guarantees: Readonly<Record<string, boolean>>;
  /** This tool never issues a release verdict; the canonical gate does. */
  verdictIssuedHere: false;
  /** The handoff never contacts a control plane. */
  controlPlaneContacted: false;
}

export interface ConvexDeploymentOperatorOptions {
  packagePath?: string | null;
  filingPath: string;
  declaredDeployment?: string | null;
  simulated?: { verdict: string | null; blockers: readonly string[]; deploymentState: string | null };
}

const ZERO_GUARANTEES: Readonly<Record<string, boolean>> = {
  controlPlaneContacted: false,
  networkOpened: false,
  credentialRead: false,
  credentialPrinted: false,
  credentialMutated: false,
  deploymentPerformed: false,
  emailSent: false,
  gitMutated: false,
  productionStateMutated: false,
  packagePersisted: false,
};

export function buildConvexDeploymentOperatorHandoff(
  assessment: ConvexDeploymentAssessment,
  options: ConvexDeploymentOperatorOptions,
): ConvexDeploymentOperatorHandoff {
  const prerequisite = DEPLOYMENT_BOUND[0];
  const projection = toGateConvexRecord(assessment, {});
  const simulated = options.simulated ?? { verdict: null, blockers: [], deploymentState: null };
  return {
    schema: CONVEX_DEPLOYMENT_HANDOFF_SCHEMA,
    mode: "CONVEX_DEPLOYMENT_OPERATOR_VERIFICATION (read-only; no control-plane contact, no credential access, no git, no deployment)",
    state: assessment.state,
    complete: assessment.complete,
    packagePath: options.packagePath ?? null,
    filingPath: options.filingPath,
    evaluatedAt: assessment.evaluatedAt,
    prerequisite: {
      id: prerequisite?.id ?? CONVEX_DEPLOYMENT_PREREQUISITE,
      requirement: prerequisite?.requirement ?? "",
      environment: CONVEX_DEPLOYMENT_ENVIRONMENT,
      maxAgeMs: CONVEX_DEPLOYMENT_MAX_AGE_MS,
      binding: prerequisite?.binding ?? "deployment",
    },
    deployment: assessment.deployment,
    declaredDeployment: options.declaredDeployment ?? null,
    requiredFunctions: [...assessment.requiredFunctions],
    missingFunctions: [...assessment.missingFunctions],
    acceptedAccessStates: [...AUTHENTICATED_ACCESS_STATES],
    contract: {
      schema: CONVEX_DEPLOYMENT_SCHEMA,
      requiredFields: [...REQUIRED_PACKAGE_FIELDS],
      cloudSuffix: CONVEX_CLOUD_SUFFIX,
      siteSuffix: CONVEX_SITE_SUFFIX,
      forbiddenHosts: [...FORBIDDEN_DEPLOYMENT_HOSTS],
      deploymentEnvVar: DEPLOYMENT_ENV_VAR,
      functionSurfaceRoot: CONVEX_ROOT,
    },
    accepted: [...ACCEPTED_DEPLOYMENT_CATEGORIES],
    rejected: [...REJECTED_DEPLOYMENT_CATEGORIES],
    refusals: assessment.refusals,
    problems: assessment.problems,
    gateProjection: {
      filed: projection.record !== null,
      prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
      refusals: projection.refusals,
    },
    simulated: {
      performed: simulated.verdict !== null,
      verdict: simulated.verdict,
      blockers: [...simulated.blockers],
      deploymentState: simulated.deploymentState,
    },
    statement: assessment.complete
      ? "The package is admissible for evaluation by the release gate. This is not a release decision: the gate still decides, and this tool has filed nothing."
      : "The package is not admissible. This is a blocker with a name, not a claim that a deployment exists or does not.",
    operatorSequence: [
      "set the production configuration and deploy the backend (docs/DEPLOYMENT-HANDOFF.md steps A–F)",
      "confirm control-plane access is AUTHENTICATED (npm run convex:access)",
      "list the published functions (npx convex function-spec) and record them as <module>.<function>",
      "observe the deployment's XSTARZ_DEPLOYMENT_ENV and its *.convex.cloud / *.convex.site URLs",
      `assemble the package and write it to ${options.filingPath}`,
      "run this command again with --package pointing at that file",
      "let the canonical release gate decide; this tool never decides",
    ],
    guarantees: { ...ZERO_GUARANTEES },
    verdictIssuedHere: false,
    controlPlaneContacted: false,
  };
}

export function formatConvexDeploymentOperatorHandoff(handoff: ConvexDeploymentOperatorHandoff): string {
  const lines: string[] = [];
  lines.push(`mode: ${handoff.mode}`);
  lines.push(`schema: ${handoff.schema}`);
  lines.push(`evaluatedAt: ${handoff.evaluatedAt}`);
  lines.push(`package: ${handoff.packagePath ?? "<none supplied>"}`);
  lines.push("");
  lines.push("── decision ─────────────────────────────────────────────────────────────");
  lines.push(`state: ${handoff.state}`);
  lines.push(
    handoff.complete
      ? "admissible for evaluation: yes (the gate still decides; nothing was filed)"
      : "admissible for evaluation: no — a blocker remains",
  );
  lines.push(`prerequisite: ${handoff.prerequisite.id} (${handoff.prerequisite.binding}, ${handoff.prerequisite.environment}, window ${String(handoff.prerequisite.maxAgeMs)}ms)`);
  lines.push("");
  lines.push("── deployment ───────────────────────────────────────────────────────────");
  lines.push(`named:     ${handoff.deployment ?? "<none>"}`);
  lines.push(`declared:  ${handoff.declaredDeployment ?? "<none>"}`);
  lines.push(`required functions: ${handoff.requiredFunctions.length}`);
  lines.push(`missing functions:  ${handoff.missingFunctions.length ? handoff.missingFunctions.join(", ") : "none"}`);
  lines.push(`accepted access verdicts: ${handoff.acceptedAccessStates.join(", ") || "<none readable>"}`);
  lines.push("");
  lines.push("── what counts ─────────────────────────────────────────────────────────");
  for (const category of handoff.accepted) lines.push(`  + ${category}`);
  lines.push("");
  lines.push("── what does not count ─────────────────────────────────────────────────");
  for (const category of handoff.rejected) lines.push(`  - ${category}`);
  lines.push("");
  lines.push("── package contract ────────────────────────────────────────────────────");
  lines.push(`package schema: ${handoff.contract.schema}`);
  lines.push(`required fields: ${handoff.contract.requiredFields.join(", ")}`);
  lines.push(`cloud host suffix: ${handoff.contract.cloudSuffix}`);
  lines.push(`site host suffix:  ${handoff.contract.siteSuffix}`);
  lines.push(`forbidden hosts:   ${handoff.contract.forbiddenHosts.join(", ") || "none"}`);
  lines.push(`deployment env var: ${handoff.contract.deploymentEnvVar}`);
  lines.push(`function surface root: ${handoff.contract.functionSurfaceRoot}`);
  lines.push("");
  if (handoff.problems.length > 0) {
    lines.push("── refusals ─────────────────────────────────────────────────────────────");
    for (const problem of handoff.problems) lines.push(`  ! ${problem}`);
    lines.push("");
  }
  lines.push("── gate projection ─────────────────────────────────────────────────────");
  lines.push(
    handoff.gateProjection.filed
      ? `a record for ${handoff.gateProjection.prerequisite} would be readable by the gate`
      : `no record would be filed (${handoff.gateProjection.refusals.length} refusal(s), named above)`,
  );
  if (handoff.simulated.performed) {
    lines.push(
      `if the package were filed: verdict ${handoff.simulated.verdict}, deployment ${handoff.simulated.deploymentState}, remaining blockers ${handoff.simulated.blockers.length ? handoff.simulated.blockers.join(", ") : "none"} — simulated in memory, nothing written`,
    );
  }
  lines.push("");
  lines.push("── operator sequence ───────────────────────────────────────────────────");
  handoff.operatorSequence.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  lines.push("");
  lines.push("── guarantees ──────────────────────────────────────────────────────────");
  for (const [key, value] of Object.entries(handoff.guarantees)) lines.push(`  ${key}: ${String(value)}`);
  lines.push("");
  lines.push(`statement: ${handoff.statement}`);
  lines.push("This tool does not issue a release verdict and did not contact a control plane.");
  return lines.join("\n");
}

export function convexDeploymentOperatorJson(handoff: ConvexDeploymentOperatorHandoff): string {
  return JSON.stringify(handoff, null, 2);
}

/** 0 when the package is admissible, 1 when a blocker remains. Never 2 here. */
export function convexDeploymentHandoffExitCode(handoff: ConvexDeploymentOperatorHandoff): 0 | 1 {
  return handoff.complete ? 0 : 1;
}

/* ── assembling a package (tests, fixtures and the operator's own tooling) ──── */

export interface ConvexDeploymentPackageInput {
  candidate?: ConvexDeploymentCandidateBinding;
  deployment: string;
  deploymentUrl: string;
  siteUrl: string;
  observedAt: number;
  verifiedAt?: number;
  deploymentEnv?: string | null;
  accessVerdict: string;
  publishedFunctions: readonly string[];
  fixture?: boolean;
  synthetic?: boolean;
  configurationOnly?: boolean;
  buildOnly?: boolean;
  codegenOnly?: boolean;
}

/**
 * Assemble a package from facts that were ALREADY observed.
 *
 * This is a formatter, not an observer: it cannot produce a deployment, and it
 * computes the digest over exactly the payload a validator will re-hash. Tests use
 * it to build well-formed packages without hand-computing digests, and the
 * operator's own tooling can use it once the observations exist.
 */
export function buildConvexDeploymentPackage(input: ConvexDeploymentPackageInput): ConvexDeploymentPackage {
  const payload = {
    schema: CONVEX_DEPLOYMENT_SCHEMA,
    environment: CONVEX_DEPLOYMENT_ENVIRONMENT,
    source: "external-verification",
    verified: true,
    observedAt: input.observedAt,
    ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
    ...(input.candidate ? { candidate: input.candidate } : {}),
    deployment: input.deployment,
    deploymentUrl: input.deploymentUrl,
    siteUrl: input.siteUrl,
    deploymentEnv: input.deploymentEnv ?? null,
    accessVerdict: input.accessVerdict,
    publishedFunctions: [...input.publishedFunctions],
    ...(input.fixture ? { fixture: true } : {}),
    ...(input.synthetic ? { synthetic: true } : {}),
    ...(input.configurationOnly ? { configurationOnly: true } : {}),
    ...(input.buildOnly ? { buildOnly: true } : {}),
    ...(input.codegenOnly ? { codegenOnly: true } : {}),
  };
  return { ...payload, digest: evidenceDigest(payload) };
}
