/**
 * Phase 246 — A1 issuer evidence and operator handoff.
 *
 * WHAT THIS IS
 * The A1 operation (revoking the exposed OTP credential at its issuer) cannot be
 * performed from this repository, and the earlier phases established *why*: the
 * credential is a shared scaffold key, the issuer publishes no self-service
 * revocation surface, and this environment cannot reach the issuer at all. What
 * was missing was the other half of an externally-blocked prerequisite: a
 * deterministic, machine-checkable statement of
 *
 *   * what evidence would be admitted as proof that the revocation happened,
 *   * what observations look like proof and are not,
 *   * what the person who holds issuer access has to do, and
 *   * what is still unavailable without that access.
 *
 * This module is that statement. It is pure: it takes injected observations,
 * returns decisions, and performs no I/O — no socket, no file, no clock, no git.
 * The `scripts/a1-issuer-report.mjs` command is the reader that supplies the
 * observations, and it is guarded the same way `verify-remediation-readiness.mjs`
 * is: a read-only git allowlist, no writer, no network module.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It does not invent an issuer endpoint. The discovery result is derived from
 *     the sources this repository actually has, and when none of them documents a
 *     revocation surface, the result says exactly that: `documentedRevocationEndpoint`
 *     is `null` and no URL is written down anywhere.
 *   * It does not issue a release decision. The verdict arrives as an argument,
 *     produced by `release-current-state.ts`, and is echoed with
 *     `verdictIssuedHere: false`.
 *   * It cannot be satisfied by a synthetic record. A fixture-scoped admission can
 *     never produce a gate record, and the canonical Phase 244 post-check — which
 *     is what the release gate reads — refuses `fixture` sources on its own.
 */

import { PROOF_PATHS } from "./release-current-state";
import {
  REMEDIATION_MANIFEST,
  type RemediationEvidenceRecord,
  type RemediationManifest,
  type RepositoryObservation,
} from "./remediation-manifest";
import {
  evaluateA1PostCheck,
  prerequisiteMaxAgeMs,
  type PostCheckResult,
} from "./remediation-postcheck";
import { evaluateA1Readiness, type A1ReadinessOutcome } from "./remediation-readiness";
import {
  RELEASE_PREREQUISITES,
  verifyingSourcesFor,
  type EvidenceRecord,
  type EvidenceSource,
} from "./release-gate";

/** The schema tag every artifact this phase describes carries. */
export const A1_EVIDENCE_SCHEMA = "phase246.a1-evidence/v1";
export const A1_HANDOFF_SCHEMA = "phase246.a1-operator-handoff/v1";

/* ── Phase B: issuer discovery, without assumptions ─────────────────────── */

export type IssuerDiscoveryClass =
  /** The repository's own sources name a revocation endpoint or API. */
  | "REVOCATION_ENDPOINT_DOCUMENTED"
  /** No source names one: nothing may be invented to fill the gap. */
  | "REVOCATION_ENDPOINT_NOT_DOCUMENTED"
  /** Performing the revocation needs access this environment does not have. */
  | "EXTERNAL_ACCESS_REQUIRED"
  /** The issuer exposes no verifiable self-service path at all. */
  | "NO_VERIFIABLE_SELF_SERVICE_PATH";

export interface DiscoverySourceCheck {
  /** Where the fact comes from: a path in this repository, or a named audit. */
  source: string;
  question: string;
  observed: string;
}

export interface IssuerDiscovery {
  host: string;
  classes: readonly IssuerDiscoveryClass[];
  /**
   * The revocation endpoint the sources document. `null` means the sources
   * document none — this phase never writes a URL the sources do not contain.
   */
  documentedRevocationEndpoint: string | null;
  documentedSelfServiceSurface: string | null;
  externalAccessRequired: boolean;
  /** Endpoints this phase *contacted*: always empty. Nothing is probed. */
  endpointsContacted: readonly string[];
  /** Always false: the classification is read off the sources, never stitched together. */
  endpointInvented: false;
  sources: readonly DiscoverySourceCheck[];
}

/**
 * Classify what is documented. Every branch is derived from the supplied
 * observations, so a source that *did* document a revocation surface would change
 * the answer rather than be overruled by it.
 */
export function classifyIssuerDiscovery(input: {
  host: string;
  documentedEndpoints: readonly string[];
  selfServiceSurfaces: readonly string[];
  externalAccessAvailable: boolean | null;
  sources: readonly DiscoverySourceCheck[];
}): IssuerDiscovery {
  const endpoints = input.documentedEndpoints.map((value) => value.trim()).filter((value) => value.length > 0);
  const surfaces = input.selfServiceSurfaces.map((value) => value.trim()).filter((value) => value.length > 0);
  const classes: IssuerDiscoveryClass[] = [];

  if (endpoints.length > 0) classes.push("REVOCATION_ENDPOINT_DOCUMENTED");
  else classes.push("REVOCATION_ENDPOINT_NOT_DOCUMENTED");
  if (input.externalAccessAvailable !== true) classes.push("EXTERNAL_ACCESS_REQUIRED");
  if (surfaces.length === 0) classes.push("NO_VERIFIABLE_SELF_SERVICE_PATH");

  return {
    host: input.host,
    classes,
    // Taken from the sources or not at all: the first documented endpoint, never a synthesized one.
    documentedRevocationEndpoint: endpoints.length > 0 ? endpoints[0] : null,
    documentedSelfServiceSurface: surfaces.length > 0 ? surfaces[0] : null,
    externalAccessRequired: input.externalAccessAvailable !== true,
    endpointsContacted: [],
    endpointInvented: false,
    sources: input.sources,
  };
}

/**
 * The repository's discovery evidence, quoted rather than re-derived: each row is
 * what an audit in this repository observed. `A1_DISCOVERY` is the classification
 * of exactly these rows.
 */
export const A1_DISCOVERY_SOURCES: readonly DiscoverySourceCheck[] = [
  {
    source: "src/lib/deployment/remediation-manifest.ts (Phase 244)",
    question: "which issuer holds the credential?",
    observed:
      "auth.freebuff.app, operated by Freebuff Web (formerly Vly); the manifest names it as the only party that can neutralise the credential",
  },
  {
    source: "src/lib/deployment/remediation-manifest.ts (Phase 244)",
    question: "is a self-service revocation surface available?",
    observed:
      "absent — recorded as \"no published API or console\" from the Phase 222 audit, and the readiness checker reports a missing external path rather than a missing step",
  },
  {
    source: "docs/RELEASE-GATE.md §Phase 222",
    question: "can this environment reach the issuer?",
    observed:
      "no: every issuer host returned HTTP 000 while api.github.com and registry.npmjs.org returned 200 on the same network; no issuer credential, console, token or account exists here",
  },
  {
    source: "docs/RELEASE-GATE.md §Phase 222",
    question: "is a public revoke/rotate API documented?",
    observed: "none published; keys are project-scoped and issued at project creation",
  },
  {
    source: "docs/RELEASE-GATE.md §Phase 223",
    question: "does a documented endpoint exist in the vendor documentation or repository search?",
    observed:
      "no: vendor docs, ToS, blog and the integration README document no key-management endpoint; the issuer server is closed-source",
  },
  {
    source: "docs/SECRET-REMEDIATION-RUNBOOK.md §2",
    question: "what does the existing runbook ask a human to do?",
    observed:
      "provision a replacement, configure it outside source control, revoke the old credential at the issuer, then observe an explicit auth failure; it states the assessment is BLOCKED until then",
  },
];

/** The classification of the rows above: no documented endpoint, external access required. */
export const A1_DISCOVERY: IssuerDiscovery = classifyIssuerDiscovery({
  host: REMEDIATION_MANIFEST.issuer.identity,
  documentedEndpoints: [],
  selfServiceSurfaces: [],
  externalAccessAvailable: false,
  sources: A1_DISCOVERY_SOURCES,
});

/* ── Phases C and D: the evidence contract ──────────────────────────────── */

export interface A1AdmissibleClass {
  id: "issuer-confirmation" | "credential-rejection";
  /** The manifest requirement this observation satisfies. */
  requirementId: string;
  description: string;
  /** The only source that can produce it. */
  source: "external-issuer";
  environment: "production";
  /** The observation must be later than the recorded remediation instant. */
  observedAfterRemediation: true;
  /**
   * HTTP statuses that count as an explicit rejection. An empty list means the
   * class carries no status at all — an issuer confirmation is evidence in itself.
   */
  rejectionStatuses: readonly number[];
  issuerMustMatch: string;
  fingerprintMustMatch: string;
  fixtureAllowed: false;
}

export interface A1RejectedObservation {
  observation: string;
  why: string;
}

export interface A1EvidenceContract {
  schema: string;
  issuer: { identity: string; hostRule: string; binding: string };
  credential: { fingerprint: string; rule: string; length: number; valueMayBeStored: false };
  freshness: { maxAgeMs: number; days: number; source: string };
  environment: { required: "production"; why: string };
  binding: { kind: "none"; commitRule: string; candidateCommit: string };
  pre: readonly { id: string; requirement: string; acceptableSources: readonly string[] }[];
  post: readonly { id: string; requirement: string; acceptableSources: readonly string[] }[];
  admissible: readonly A1AdmissibleClass[];
  /**
   * The contract is the whole set, not one observation: the issuer's confirmation
   * and the observed rejection answer different questions, and the canonical
   * post-check requires both.
   */
  completeSet: { requires: readonly string[]; note: string };
  rejected: readonly A1RejectedObservation[];
  attestation: {
    path: string;
    schema: string;
    requiredFields: readonly string[];
    forbiddenFields: readonly string[];
    supersetOfGateReader: true;
  };
  gate: {
    prerequisite: string;
    acceptedSources: readonly string[];
    acceptedEnvironments: readonly string[];
    requiredFields: readonly string[];
    note: string;
  };
}

/** The observations that are *not* proof, with the reason each one fails. */
export const A1_REJECTED_OBSERVATIONS: readonly A1RejectedObservation[] = [
  { observation: "a timeout", why: "no answer is not an answer: the credential's status was not observed" },
  { observation: "a DNS failure", why: "resolution is about the network, not about the credential" },
  { observation: "a connection refusal", why: "the request never reached the issuer, so nothing was observed" },
  { observation: "HTTP 000 / no response", why: "the recorded status is the absence of a response" },
  { observation: "local code or tests passing", why: "this repository cannot observe the issuer's key store" },
  { observation: "a document saying the key was revoked", why: "prose is a claim; the gate reads only machine-readable records" },
  { observation: "a synthetic fixture", why: "a fixture exercises a checker and can never satisfy it" },
  { observation: "an inability to authenticate", why: "not being able to sign in is not the credential being refused" },
  { observation: "a different credential failing", why: "evidence must name this credential's fingerprint" },
  { observation: "an unrelated endpoint returning an error", why: "another endpoint's error says nothing about this credential" },
];

/**
 * The contract, derived from the manifest and from `release-gate.ts` rather than
 * restated: the freshness window comes from the prerequisite, the acceptable
 * sources from the gate's own list, and the post-requirements from the manifest.
 */
export function a1EvidenceContract(manifest: RemediationManifest = REMEDIATION_MANIFEST): A1EvidenceContract {
  const maxAgeMs = prerequisiteMaxAgeMs("A1_OTP_ISSUER_REVOCATION");
  const issuerHost = manifest.issuer.identity;
  const fingerprint = manifest.credential.fingerprint;
  const a1 = (phase: "pre" | "post") =>
    manifest.a1Requirements
      .filter((entry) => entry.phase === phase)
      .map((entry) => ({
        id: entry.id,
        requirement: entry.description,
        acceptableSources: entry.acceptableSources,
      }));

  return {
    schema: A1_EVIDENCE_SCHEMA,
    issuer: {
      identity: issuerHost,
      hostRule: "the evidence's issuer host is compared case-insensitively, with scheme, port and path removed",
      binding: `the evidence must carry subject.issuer = ${issuerHost}`,
    },
    credential: {
      fingerprint,
      rule: manifest.credential.fingerprintRule,
      length: manifest.credential.secretLength,
      valueMayBeStored: false,
    },
    freshness: {
      maxAgeMs,
      days: Math.round(maxAgeMs / 86_400_000),
      source: "release-gate.ts RELEASE_PREREQUISITES[A1_OTP_ISSUER_REVOCATION].maxAgeMs",
    },
    environment: {
      required: "production",
      why: "a development or preview observation would not describe the live credential",
    },
    binding: {
      kind: "none",
      commitRule:
        "A1 binds to no commit: the issuer's key store is not a property of this repository. If a record declares subject.commit it is still compared with the candidate, so a stale artefact cannot be filed against a new one.",
      candidateCommit: "the release candidate the caller declares; WORKTREE by default",
    },
    pre: a1("pre"),
    post: a1("post"),
    admissible: [
      {
        id: "issuer-confirmation",
        requirementId: "a1-post-issuer-confirmation",
        description:
          "the issuer confirms the revocation of this credential — a support confirmation, a console/app-key screen, or any issuer-side record that names the key or its fingerprint",
        source: "external-issuer",
        environment: "production",
        observedAfterRemediation: true,
        rejectionStatuses: [],
        issuerMustMatch: issuerHost,
        fingerprintMustMatch: fingerprint,
        fixtureAllowed: false,
      },
      {
        id: "credential-rejection",
        requirementId: "a1-post-credential-rejected",
        description:
          "presenting the exposed credential to the issuer produces an explicit authentication failure — 401 or 403, the statuses the existing contract names",
        source: "external-issuer",
        environment: "production",
        observedAfterRemediation: true,
        // Preserved from the existing contract: 401/403 only. Nothing is added.
        rejectionStatuses: [401, 403],
        issuerMustMatch: issuerHost,
        fingerprintMustMatch: fingerprint,
        fixtureAllowed: false,
      },
    ],
    completeSet: {
      requires: ["a1-post-issuer-confirmation", "a1-post-credential-rejected"],
      note:
        "a confirmation without the observed rejection, or a rejection without the confirmation, is an incomplete contract — the canonical post-check refuses both halves on their own",
    },
    rejected: A1_REJECTED_OBSERVATIONS,
    attestation: {
      path: PROOF_PATHS.a1Revocation,
      schema: A1_EVIDENCE_SCHEMA,
      requiredFields: [
        "schema",
        "verified",
        "source",
        "environment",
        "observedAt",
        "authoritativeSource",
        "subject.issuer",
        "subject.fingerprint",
      ],
      forbiddenFields: ["value", "secret", "token", "password", "apiKey", "api_key", "x-api-key"],
      supersetOfGateReader: true,
    },
    gate: {
      prerequisite: "A1_OTP_ISSUER_REVOCATION",
      acceptedSources: [
        ...verifyingSourcesFor(
          RELEASE_PREREQUISITES.find((entry) => entry.id === "A1_OTP_ISSUER_REVOCATION")!,
        ),
      ],
      acceptedEnvironments: ["production"],
      requiredFields: ["prerequisite", "status", "source", "environment", "observedAt"],
      note:
        "release-current-state.ts reads the issuer attestation at the path above (external-verification only) and, separately, an owner-filed compensating-controls file (owner-risk-acceptance) after independently observed runtime controls; neither path claims the other, a fixture or a document cannot satisfy, and an exemption cannot waive A1",
    },
  };
}

/* ── the attestation a human would file ─────────────────────────────────── */

export type A1AttestationState =
  | "ADMISSIBLE"
  | "NOT_AN_OBJECT"
  | "MALFORMED"
  | "NOT_VERIFIED"
  | "WRONG_SOURCE"
  | "DOCUMENTATION_ONLY"
  | "FIXTURE_ONLY"
  | "WRONG_ENVIRONMENT"
  | "WRONG_ISSUER"
  | "MISSING_ISSUER_BINDING"
  | "WRONG_FINGERPRINT"
  | "MISSING_FINGERPRINT_BINDING"
  | "MISSING_AUTHORITATIVE_SOURCE"
  | "WRONG_CANDIDATE"
  | "FUTURE_DATED"
  | "STALE"
  | "PRE_REMEDIATION"
  | "STALE_REMEDIATION"
  | "NO_RESPONSE"
  | "NOT_A_REJECTION"
  | "CARRIES_CREDENTIAL_VALUE";

export interface A1AttestationValidation {
  state: A1AttestationState;
  admissible: boolean;
  /** The problems, in the order the validator found them. */
  problems: readonly string[];
}

const FORBIDDEN_ATTESTATION_KEYS = ["value", "secret", "token", "password", "apiKey", "api_key", "x-api-key"];

const hostOf = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validate the artifact an operator would file at the proof path.
 *
 * This is strictly stronger than the gate's reader: everything it requires is
 * something the reader also needs, plus the bindings and the "no credential value"
 * rule. An attestation that passes here therefore cannot be refused by the gate
 * for being under-specified — and one that fails here may still be read by the
 * gate, which is exactly why the refusal is reported rather than assumed.
 */
export function validateA1Attestation(
  payload: unknown,
  options: { manifest?: RemediationManifest; now: number; candidateCommit?: string },
): A1AttestationValidation {
  const manifest = options.manifest ?? REMEDIATION_MANIFEST;
  const problems: string[] = [];
  const refuse = (state: A1AttestationState, problem: string): A1AttestationValidation => ({
    state,
    admissible: false,
    problems: [problem, ...problems],
  });

  if (!isPlainObject(payload)) return refuse("NOT_AN_OBJECT", "the attestation is not a JSON object");

  for (const key of FORBIDDEN_ATTESTATION_KEYS) {
    if (key in payload) {
      return refuse(
        "CARRIES_CREDENTIAL_VALUE",
        `the attestation carries a "${key}" field: the credential value may never be stored or transmitted, only its fingerprint`,
      );
    }
  }
  const credential = payload.credential;
  if (isPlainObject(credential)) {
    for (const key of FORBIDDEN_ATTESTATION_KEYS) {
      if (key in credential) {
        return refuse(
          "CARRIES_CREDENTIAL_VALUE",
          `the attestation's credential block carries "${key}": only the fingerprint may be recorded`,
        );
      }
    }
  }

  if (payload.schema !== A1_EVIDENCE_SCHEMA) {
    return refuse("MALFORMED", `schema must be ${A1_EVIDENCE_SCHEMA}, not ${String(payload.schema)}`);
  }
  if (payload.fixture === true || payload.synthetic === true) {
    return refuse("FIXTURE_ONLY", "the attestation declares itself synthetic: a fixture can never be production evidence");
  }
  if (payload.verified !== true) {
    return refuse("NOT_VERIFIED", "verified must be exactly true; anything else is a claim of an unverified state");
  }
  if (payload.source !== "external-verification") {
    if (payload.source === "documentation") {
      return refuse("DOCUMENTATION_ONLY", "documentation is not verification");
    }
    return refuse("WRONG_SOURCE", `source must be external-verification, not ${String(payload.source)}`);
  }
  if (payload.environment !== "production") {
    return refuse("WRONG_ENVIRONMENT", `environment must be production, not ${String(payload.environment)}`);
  }
  const authoritative = typeof payload.authoritativeSource === "string" ? payload.authoritativeSource.trim() : "";
  if (authoritative.length === 0) {
    return refuse(
      "MISSING_AUTHORITATIVE_SOURCE",
      "the attestation names no authoritative source: it must record who at the issuer produced it, and never an endpoint invented here",
    );
  }

  const observedAt = payload.observedAt;
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) {
    return refuse("MALFORMED", "observedAt must be a finite instant in milliseconds");
  }
  if (observedAt > options.now) {
    return refuse("FUTURE_DATED", `observedAt is ${observedAt - options.now}ms ahead of the evaluation instant`);
  }
  const maxAgeMs = prerequisiteMaxAgeMs("A1_OTP_ISSUER_REVOCATION");
  if (options.now - observedAt > maxAgeMs) {
    return refuse("STALE", `observedAt is older than the ${Math.round(maxAgeMs / 86_400_000)}-day window`);
  }

  const subject = payload.subject;
  if (!isPlainObject(subject)) {
    return refuse("MALFORMED", "subject must be an object carrying the issuer and the credential fingerprint");
  }
  const declaredIssuer = typeof subject.issuer === "string" ? subject.issuer.trim() : "";
  if (declaredIssuer.length === 0) {
    return refuse("MISSING_ISSUER_BINDING", `subject.issuer is required: it must name ${manifest.issuer.identity}`);
  }
  if (hostOf(declaredIssuer) !== hostOf(manifest.issuer.identity)) {
    return refuse(
      "WRONG_ISSUER",
      `subject.issuer is ${declaredIssuer}, which is not ${manifest.issuer.identity}: a revocation at another issuer leaves this credential live`,
    );
  }
  const declaredFingerprint = typeof subject.fingerprint === "string" ? subject.fingerprint.trim() : "";
  if (declaredFingerprint.length === 0) {
    return refuse("MISSING_FINGERPRINT_BINDING", "subject.fingerprint is required, and must be the exposed credential's");
  }
  if (declaredFingerprint !== manifest.credential.fingerprint) {
    return refuse(
      "WRONG_FINGERPRINT",
      `subject.fingerprint is ${declaredFingerprint}, not ${manifest.credential.fingerprint}: a different credential's revocation is not this one's`,
    );
  }
  if (typeof subject.commit === "string" && options.candidateCommit !== undefined && subject.commit !== options.candidateCommit) {
    return refuse(
      "WRONG_CANDIDATE",
      `subject.commit is ${subject.commit}, which is not the candidate ${options.candidateCommit}`,
    );
  }

  /* The remediation instant: absent on a pure confirmation, required before any
     rejection can be read as a *post*-revocation observation. */
  const remediationAt = payload.remediationAt;
  if (remediationAt !== undefined) {
    if (typeof remediationAt !== "number" || !Number.isFinite(remediationAt)) {
      return refuse("MALFORMED", "remediationAt must be a finite instant when present");
    }
    if (remediationAt > options.now) {
      return refuse("FUTURE_DATED", "remediationAt is in the future, so the observation cannot follow it");
    }
    if (options.now - remediationAt > maxAgeMs) {
      return refuse("STALE_REMEDIATION", "the recorded revocation is older than the window the gate will accept");
    }
    if (observedAt <= remediationAt) {
      return refuse(
        "PRE_REMEDIATION",
        `observedAt (${observedAt}) is not later than remediationAt (${remediationAt}): this observation predates the revocation`,
      );
    }
  }

  const observation = payload.observation;
  if (observation !== undefined) {
    if (!isPlainObject(observation)) return refuse("MALFORMED", "observation must be an object when present");
    const status = observation.rejectionStatus;
    if (status !== undefined) {
      if (status === null || status === 0) {
        return refuse(
          "NO_RESPONSE",
          "the recorded status is the absence of a response (0/null): a timeout or a 000 is not proof of revocation",
        );
      }
      if (status !== 401 && status !== 403) {
        return refuse("NOT_A_REJECTION", `the recorded status is ${String(status)}, which is not an authentication failure`);
      }
      if (remediationAt === undefined) {
        return refuse(
          "MALFORMED",
          "a rejection observation must be accompanied by the remediationAt it follows, or it cannot be placed after the revocation",
        );
      }
    }
  }

  return { state: "ADMISSIBLE", admissible: true, problems };
}

/* ── evidence admission — the two layers, and the gate record ───────────── */

export interface A1AdmissionRequest {
  manifest?: RemediationManifest;
  now: number;
  /** The operator's recorded revocation instant. `null` when none is recorded. */
  remediationAt: number | null;
  /** Post-revocation observations, in the shape the Phase 244 post-check consumes. */
  evidence: readonly RemediationEvidenceRecord[];
  candidateCommit?: string;
  /**
   * True only when the caller is explicitly evaluating a synthetic record inside a
   * fixture. Even then no gate record is produced — the flag exists so the
   * distinction is visible in the report rather than inferred from the input.
   */
  fixtureScope?: boolean;
}

export interface A1AdmissionReport {
  schema: string;
  state: "ADMISSIBLE" | "NOT_ADMISSIBLE";
  /**
   * True only when the canonical post-check says the operation is verified.
   * Deliberately not named `admitted`: the release admission layer owns that
   * word, and a guard in the Phase 242 suite asserts that no other module
   * produces one.
   */
  admissible: boolean;
  fixtureScoped: boolean;
  /** The canonical Phase 244 decision. This is the one the release gate agrees with. */
  canonical: PostCheckResult;
  checks: readonly { id: string; description: string; passed: boolean; detail: string }[];
  problems: readonly string[];
  guarantees: {
    issuerContacted: false;
    credentialValueStored: false;
    remediationPerformed: false;
    /** A fixture-scoped admission never becomes a gate record, whatever it says. */
    fixtureEverCounts: false;
  };
}

function isFixtureRecord(record: RemediationEvidenceRecord): boolean {
  return record.fixture === true || record.source === "fixture";
}

/**
 * Admit, or refuse, the post-revocation evidence — and say which layer refused.
 *
 * The canonical post-check is executed first and its verdict is reported
 * verbatim; the Phase 246 checks below it add the bindings the post-check does not
 * express (a named authoritative source, no fixture anywhere in the set, a
 * recorded revocation instant that the observations follow). Both layers must
 * pass, so this phase can only ever be stricter than Phase 244, never looser.
 */
const isWellFormedRecord = (value: unknown): value is RemediationEvidenceRecord =>
  isPlainObject(value) &&
  typeof (value as { requirementId?: unknown }).requirementId === "string" &&
  Number.isFinite((value as { observedAt?: unknown }).observedAt);

export function evaluateA1EvidenceAdmission(request: A1AdmissionRequest): A1AdmissionReport {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const contract = a1EvidenceContract(manifest);

  /*
    Hostile or damaged input is refused here rather than handed to a decision
    function that would have to guess: a record that is not an object, or that
    carries no requirement id or no finite instant, cannot be reported on at all.
    Only well-formed records reach the canonical post-check.
  */
  const supplied = Array.isArray(request.evidence) ? request.evidence : [];
  const malformed = supplied.filter((record) => !isWellFormedRecord(record));
  const evidence = supplied.filter(isWellFormedRecord);

  const canonical = evaluateA1PostCheck({
    manifest,
    remediationAt: request.remediationAt,
    now: request.now,
    evidence,
  });

  const checks: { id: string; description: string; passed: boolean; detail: string }[] = [];
  const problems: string[] = [];

  checks.push({
    id: "a1-246-evidence-well-formed",
    description: "every supplied record is an object carrying a requirement id and a finite instant",
    passed: malformed.length === 0,
    detail:
      malformed.length === 0
        ? `${evidence.length} well-formed record(s)`
        : `${malformed.length} malformed record(s): evidence that cannot be read is not evidence, and it is never skipped silently`,
  });

  const post = evidence.filter((record) => record.requirementId.startsWith("a1-post-"));
  const wrongSource = post.filter((record) => record.source !== "external-issuer");
  checks.push({
    id: "a1-246-issuer-source",
    description: "every post-revocation record comes from the issuer or from an independent external observation",
    passed: wrongSource.length === 0,
    detail:
      wrongSource.length === 0
        ? `${post.length} record(s) from an external source`
        : `${wrongSource.length} record(s) come from a source that cannot speak for the issuer`,
  });

  const authoritative = post.filter(
    (record) =>
      typeof record.subject?.issuer === "string" &&
      hostOf(record.subject.issuer) === hostOf(manifest.issuer.identity) &&
      (record.detail ?? "").trim().length > 0,
  );
  checks.push({
    id: "a1-246-authoritative-source",
    description: "each post-revocation record names the issuer-side source that produced it",
    passed: post.length > 0 && authoritative.length === post.length,
    detail:
      post.length === 0
        ? "no post-revocation record was supplied"
        : authoritative.length === post.length
          ? `${authoritative.length} record(s) carry an issuing source`
          : `${post.length - authoritative.length} record(s) carry no source, so nothing says who observed them`,
  });

  const fixtures = evidence.filter(isFixtureRecord);
  const syntheticScoped = request.fixtureScope === true || fixtures.length > 0;
  checks.push({
    id: "a1-246-no-fixture-in-the-set",
    description: "no synthetic record is anywhere in the set that is being admitted",
    passed: fixtures.length === 0,
    detail:
      fixtures.length === 0
        ? "none"
        : `${fixtures.length} synthetic record(s) are present; a fixture exercises a checker and is never proof`,
  });

  const ordering =
    request.remediationAt !== null &&
    post.length > 0 &&
    post.every((record) => record.observedAt > (request.remediationAt as number));
  checks.push({
    id: "a1-246-observations-follow-the-revocation",
    description: "every observation is later than the recorded revocation instant",
    passed: ordering,
    detail:
      request.remediationAt === null
        ? "no revocation instant is recorded, so nothing can be placed after it"
        : post.length === 0
          ? "no post-revocation record was supplied"
          : ordering
            ? "all observations follow the revocation"
            : "at least one observation predates the revocation it is supposed to prove",
  });

  const candidate = request.candidateCommit;
  const wrongCandidate = post.find(
    (record) => typeof record.subject?.commit === "string" && candidate !== undefined && record.subject.commit !== candidate,
  );
  checks.push({
    id: "a1-246-candidate-binding",
    description: "a record naming a candidate names this one",
    passed: wrongCandidate === undefined,
    detail:
      wrongCandidate === undefined
        ? "no record names another candidate"
        : `a record covers ${String(wrongCandidate.subject?.commit)}, not the candidate ${String(candidate)}`,
  });

  const stillLive = post.find((record) => {
    const status = record.observation?.rejectionStatus;
    return typeof status === "number" && status >= 200 && status < 300;
  });
  checks.push({
    id: "a1-246-no-contradiction",
    description: "a credential that was still accepted is never reported as revoked",
    passed: stillLive === undefined,
    detail:
      stillLive === undefined
        ? "no contradictory observation"
        : `a record observed ${String(stillLive.observation?.rejectionStatus)} from the issuer, so the credential was still being accepted: a revocation claim cannot coexist with that`,
  });

  const revocationAt = request.remediationAt;
  const windowMs = contract.freshness.maxAgeMs;
  const revocationInWindow = revocationAt === null || request.now - revocationAt <= windowMs;
  checks.push({
    id: "a1-246-revocation-within-window",
    description: `the recorded revocation is inside the ${contract.freshness.days}-day window`,
    passed: revocationInWindow,
    detail:
      revocationAt === null
        ? "no revocation instant is recorded"
        : revocationInWindow
          ? "the revocation is inside the window"
          : "the revocation instant is older than the window: the observation must be re-obtained from the issuer rather than re-dated",
  });

  const rejectionRecord = post.find((record) => record.requirementId === "a1-post-credential-rejected");
  const status = rejectionRecord?.observation?.rejectionStatus ?? null;
  const statusOk = status !== null && contract.admissible[1].rejectionStatuses.includes(status);
  checks.push({
    id: "a1-246-rejection-status",
    description: `a rejection, when claimed, is one of ${contract.admissible[1].rejectionStatuses.join("/")}`,
    passed: rejectionRecord === undefined || statusOk,
    detail:
      rejectionRecord === undefined
        ? "no rejection observation was claimed"
        : statusOk
          ? `observed ${status}`
          : status === null || status === 0
            ? "no response was observed: a timeout or a 000 is not proof of revocation"
            : `observed ${String(status)}, which is not an authentication failure`,
  });

  for (const check of checks) if (!check.passed) problems.push(`${check.id}: ${check.detail}`);
  for (const problem of canonical.problems) problems.push(`canonical: ${problem}`);

  const admissible = canonical.verified && checks.every((check) => check.passed) && !syntheticScoped;
  return {
    schema: A1_EVIDENCE_SCHEMA,
    state: admissible ? "ADMISSIBLE" : "NOT_ADMISSIBLE",
    admissible,
    fixtureScoped: syntheticScoped,
    canonical,
    checks,
    problems,
    guarantees: {
      issuerContacted: false,
      credentialValueStored: false,
      remediationPerformed: false,
      fixtureEverCounts: false,
    },
  };
}

/**
 * The record the release gate would read, or the named refusals that stop one
 * being produced. A record is produced only for an admission that is not
 * fixture-scoped and not synthetic, and it is still a *claim to be filed*: this
 * function writes nothing.
 */
export function toGateEvidenceRecord(
  report: A1AdmissionReport,
  options: { candidateCommit: string; observedAt: number; detail?: string },
): { record: EvidenceRecord | null; refusals: readonly string[] } {
  const refusals: string[] = [];
  if (!report.admissible) refusals.push(...report.problems);
  if (report.fixtureScoped) {
    refusals.push(
      "the admission is fixture-scoped: a synthetic record may never be filed as production evidence, so no gate record is produced",
    );
  }
  if (refusals.length > 0) return { record: null, refusals };

  const source: EvidenceSource = "external-verification";
  return {
    record: {
      prerequisite: "A1_OTP_ISSUER_REVOCATION",
      status: "VERIFIED",
      source,
      environment: "production",
      observedAt: options.observedAt,
      subject: { issuer: REMEDIATION_MANIFEST.issuer.identity, commit: options.candidateCommit },
      detail: options.detail ?? "issuer revocation confirmed by external evidence",
    },
    refusals,
  };
}

/* ── Phase G: the operator handoff ──────────────────────────────────────── */

export interface A1HandoffRequest {
  manifest?: RemediationManifest;
  repository: RepositoryObservation;
  externalIssuerAccess: "available" | "unavailable" | "unknown";
  now: number;
  /**
   * The release decision, computed by the canonical reader and passed in. This
   * module echoes it and never issues one.
   */
  releaseVerdict: string;
  candidateCommit?: string;
  /** Pre-revocation evidence the operator may already hold; usually empty. */
  evidence?: readonly RemediationEvidenceRecord[];
}

export interface A1HandoffReport {
  mode: "A1_OPERATOR_HANDOFF";
  schema: string;
  generatedAt: number;
  issuer: { identity: string; operator: string; selfServiceRevocation: string };
  credential: { fingerprint: string; rule: string; length: number; valueStored: false };
  discovery: IssuerDiscovery;
  contract: A1EvidenceContract;
  current: {
    outcome: A1ReadinessOutcome;
    /** True only when every local precondition is met and the external step remains. */
    actionPending: boolean;
    externalAccess: "available" | "unavailable" | "unknown";
    unsatisfied: readonly string[];
    evaluation: { at: number; repository: string; branch: string; head: string };
  };
  /** The external prerequisites this environment cannot satisfy, named. */
  unavailable: readonly string[];
  /** Local requirements with no acceptable record yet, named by requirement id. */
  pendingEvidence: readonly string[];
  /** The sentence an operator must act on first. */
  blocker: string;
  /** The guarantee that a blocker is not a clean bill of health. */
  statement: readonly string[];
  operatorSequence: readonly { step: number; action: string; external: boolean }[];
  guarantees: {
    issuerContacted: false;
    networkOpened: false;
    credentialValuePrinted: false;
    credentialMutated: false;
    gitMutated: false;
    deploymentPerformed: false;
    emailSent: false;
    providerCredentialChanged: false;
  };
  releaseVerdict: string;
  verdictIssuedHere: false;
  remediationPerformed: false;
}

const HANDOFF_STATEMENT: readonly string[] = [
  "A1 was NOT revoked by this tooling, and nothing here claims it was.",
  "MISSING_EXTERNAL_ACCESS is a blocker, not a negative result: the absence of a reachable issuer is not evidence that the credential is safe.",
  "No repository action completes A1; only a party with issuer-side access can revoke the credential, and only their evidence can prove it.",
  "A compensating-controls owner risk-acceptance (schema a1.compensating-controls/v1) is a separate path that does not claim revocation; it is unfiled until the owner writes it.",
];

export function buildA1OperatorHandoff(request: A1HandoffRequest): A1HandoffReport {
  const manifest = request.manifest ?? REMEDIATION_MANIFEST;
  const readiness = evaluateA1Readiness({
    manifest,
    repository: request.repository,
    declared: { issuer: manifest.issuer.identity, fingerprint: manifest.credential.fingerprint },
    externalIssuerAccess: request.externalIssuerAccess,
    evidence: request.evidence ?? [],
    now: request.now,
  });
  const contract = a1EvidenceContract(manifest);

  const unavailable: string[] = [];
  if (request.externalIssuerAccess !== "available") {
    unavailable.push(
      `MISSING_EXTERNAL_ACCESS: no reachable self-service revocation surface at ${manifest.issuer.identity} (${manifest.issuer.selfServiceRevocation}), and no issuer credential, console or account in this environment`,
    );
  }
  const pendingEvidence = readiness.evidence.unsatisfied.map(
    (id) => `${id}: no acceptable record yet (pre-revocation evidence may be captured locally, except where the issuer is the only source)`,
  );

  return {
    mode: "A1_OPERATOR_HANDOFF",
    schema: A1_HANDOFF_SCHEMA,
    generatedAt: request.now,
    issuer: {
      identity: manifest.issuer.identity,
      operator: manifest.issuer.operator,
      selfServiceRevocation: manifest.issuer.selfServiceRevocation,
    },
    credential: {
      fingerprint: manifest.credential.fingerprint,
      rule: manifest.credential.fingerprintRule,
      length: manifest.credential.secretLength,
      valueStored: false,
    },
    discovery: A1_DISCOVERY,
    contract,
    current: {
      outcome: readiness.outcome,
      actionPending: readiness.outcome === "READY_TO_REVOKE",
      externalAccess: request.externalIssuerAccess,
      unsatisfied: readiness.evidence.unsatisfied,
      evaluation: readiness.evaluation,
    },
    unavailable,
    pendingEvidence,
    blocker:
      unavailable[0] ??
      `the remaining step is external: revoke ${manifest.credential.fingerprint} at ${manifest.issuer.identity}`,
    statement: HANDOFF_STATEMENT,
    operatorSequence: manifest.issuer.procedure.map((action, index) => ({
      step: index + 1,
      action,
      external: index !== 1,
    })),
    guarantees: {
      issuerContacted: false,
      networkOpened: false,
      credentialValuePrinted: false,
      credentialMutated: false,
      gitMutated: false,
      deploymentPerformed: false,
      emailSent: false,
      providerCredentialChanged: false,
    },
    releaseVerdict: request.releaseVerdict,
    verdictIssuedHere: false,
    remediationPerformed: false,
  };
}

export function formatA1OperatorHandoff(report: A1HandoffReport): string {
  const lines: string[] = [];
  lines.push(`mode: ${report.mode} (read-only handoff; no issuer contact, no credential access, no git mutation)`);
  lines.push(`schema: ${report.schema}`);
  lines.push(`generatedAt: ${report.generatedAt}`);
  lines.push("");
  lines.push("── issuer ───────────────────────────────────────────────────────────────");
  lines.push(`issuer: ${report.issuer.identity}`);
  lines.push(`operated by: ${report.issuer.operator}`);
  lines.push(`self-service revocation: ${report.issuer.selfServiceRevocation}`);
  lines.push(`discovery: ${report.discovery.classes.join(" + ")}`);
  lines.push(
    `documented revocation endpoint: ${report.discovery.documentedRevocationEndpoint ?? "none in the available sources (none was invented)"}`,
  );
  lines.push(`endpoints contacted by this command: ${report.discovery.endpointsContacted.length}`);
  lines.push("");
  lines.push("── credential ───────────────────────────────────────────────────────────");
  lines.push(`fingerprint: ${report.credential.fingerprint} (${report.credential.rule})`);
  lines.push(`secret length: ${report.credential.length}`);
  lines.push("value: never stored, never printed, never requested by this command");
  lines.push("");
  lines.push("── current state ────────────────────────────────────────────────────────");
  lines.push(`A1 outcome: ${report.current.outcome}`);
  lines.push(`external access: ${report.current.externalAccess}`);
  lines.push(`unsatisfied requirements: ${report.current.unsatisfied.join(", ") || "none"}`);
  lines.push(`external prerequisites unavailable: ${report.unavailable.length}`);
  for (const line of report.unavailable) lines.push(`  ${line}`);
  for (const line of report.pendingEvidence) lines.push(`  ${line}`);
  lines.push(`blocker: ${report.blocker}`);
  for (const line of report.statement) lines.push(`  * ${line}`);
  lines.push("");
  lines.push("── required evidence ────────────────────────────────────────────────────");
  for (const entry of report.contract.admissible) {
    lines.push(`${entry.id} → ${entry.requirementId}`);
    lines.push(`  what: ${entry.description}`);
    lines.push(
      `  binding: source ${entry.source}, environment ${entry.environment}, issuer ${entry.issuerMustMatch}, fingerprint ${entry.fingerprintMustMatch}, observed after the revocation`,
    );
    if (entry.rejectionStatuses.length > 0) lines.push(`  accepted statuses: ${entry.rejectionStatuses.join(", ")}`);
  }
  lines.push("");
  lines.push("── not evidence ─────────────────────────────────────────────────────────");
  for (const entry of report.contract.rejected) lines.push(`  ${entry.observation} — ${entry.why}`);
  lines.push("");
  lines.push("── attestation the gate can admit ───────────────────────────────────────");
  lines.push(`path: ${report.contract.attestation.path}`);
  lines.push(`schema: ${report.contract.attestation.schema}`);
  lines.push(`required fields: ${report.contract.attestation.requiredFields.join(", ")}`);
  lines.push(`forbidden fields: ${report.contract.attestation.forbiddenFields.join(", ")}`);
  lines.push(`freshness: ${report.contract.freshness.days} days (${report.contract.freshness.source})`);
  lines.push(`gate prerequisite: ${report.contract.gate.prerequisite} — ${report.contract.gate.note}`);
  lines.push("");
  lines.push("── operator sequence ────────────────────────────────────────────────────");
  for (const entry of report.operatorSequence) {
    lines.push(`  ${entry.step}. ${entry.external ? "[external] " : "[local] "}${entry.action}`);
  }
  lines.push("");
  lines.push("── guarantees ───────────────────────────────────────────────────────────");
  lines.push(
    `issuerContacted: ${report.guarantees.issuerContacted ? "yes" : "no"} · networkOpened: ${report.guarantees.networkOpened ? "yes" : "no"} · credentialValuePrinted: ${report.guarantees.credentialValuePrinted ? "yes" : "no"} · credentialMutated: ${report.guarantees.credentialMutated ? "yes" : "no"}`,
  );
  lines.push(
    `gitMutated: ${report.guarantees.gitMutated ? "yes" : "no"} · deploymentPerformed: ${report.guarantees.deploymentPerformed ? "yes" : "no"} · emailSent: ${report.guarantees.emailSent ? "yes" : "no"} · providerCredentialChanged: ${report.guarantees.providerCredentialChanged ? "yes" : "no"}`,
  );
  lines.push(`release verdict (from the canonical reader): ${report.releaseVerdict}`);
  lines.push("verdictIssuedHere: no (this report echoes the canonical reader and issues nothing)");
  lines.push("remediationPerformed: no");
  return lines.join("\n");
}

export function a1HandoffJson(report: A1HandoffReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * The exit code for the handoff command. It mirrors the readiness checker's
 * discipline rather than inventing a second one: 0 exists only when the sole
 * remaining step is the operator's external action.
 */
export function a1HandoffExitCode(report: A1HandoffReport): 0 | 1 {
  return report.current.actionPending && report.unavailable.length === 0 ? 0 : 1;
}
