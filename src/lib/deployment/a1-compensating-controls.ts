/**
 * A1 compensating-controls path — issuer unavailable, revocation not claimed.
 *
 * WHY THIS EXISTS
 *
 * A1's primary evidence is issuer confirmation plus an authenticated 401/403
 * (see `a1-issuer-evidence.ts`). That evidence cannot be produced here: there
 * is no authorised issuer identity, the leaked key is a shared platform key,
 * and contacting Freebuff is out of scope. An exemption cannot waive A1
 * (`exemptible: false`). This module is the remaining auditable path:
 *
 *   an authorized project owner files a risk-acceptance that does **not**
 *   claim the issuer revoked the credential, after Xstarz runtime controls
 *   are independently observed.
 *
 * WHAT THIS IS NOT
 *
 *   - not issuer revocation, not a 401/403, not an exemption
 *   - not self-certification: the file is unfiled until the owner writes it
 *   - not A2: history is unchanged; this path does not rewrite anything
 *   - not a new email provider, not a Freebuff call, not a security bypass
 *
 * THE INVARIANT (fail-closed)
 *
 *   The attestation is never trusted for the controls it describes. The
 *   observer reads the runtime sources. If any required control is missing,
 *   the assessment is not admissible, regardless of what the file asserts.
 *
 *   `revocationClaimed` must be false. A file that claims the issuer revoked
 *   the credential is refused here — that claim belongs on the issuer-evidence
 *   path, with a 401/403, or it is not a claim this repository may make.
 */

import type { EvidenceRecord } from "./release-gate";
import { A1_ISSUER, EXPOSED_CREDENTIAL } from "./remediation-manifest";

export const A1_COMPENSATING_PREREQUISITE = "A1_OTP_ISSUER_REVOCATION";
const ISSUER = A1_ISSUER.identity;
const FINGERPRINT = EXPOSED_CREDENTIAL.fingerprint;

export const A1_COMPENSATING_SCHEMA = "a1.compensating-controls/v1";
export const A1_COMPENSATING_PROOF_PATH = "docs/remediation/a1-compensating-controls.json";

export const A1_RUNTIME_CONTROL_PATHS = [
  "src/convex/auth/emailOtp.ts",
  "src/convex/lib/emailDelivery.ts",
  "src/convex/lib/issuerPolicy.ts",
] as const;

export type A1CompensatingOutcome =
  | "NOT_FILED"
  | "MALFORMED"
  | "WRONG_SUBJECT"
  | "CLAIMS_REVOCATION"
  | "CONTROLS_INCOMPLETE"
  | "OWNER_ACCEPTANCE_INCOMPLETE"
  | "STALE"
  | "FUTURE_DATED"
  | "FORBIDDEN_CONTENT"
  | "ADMISSIBLE";

export interface A1RuntimeControlObservation {
  neverCallsFreebuffHost: boolean;
  usesXstarzEmailAbstraction: boolean;
  retiredIssuersRefusedInProduction: boolean;
  productionEmailFailsClosed: boolean;
  noFreebuffOtpFallback: boolean;
  problems: readonly string[];
}

export interface A1CompensatingAssessment {
  schema: typeof A1_COMPENSATING_SCHEMA;
  outcome: A1CompensatingOutcome;
  admissible: boolean;
  /** Always false: this path never claims the issuer revoked the credential. */
  revocationClaimed: false;
  issuerContacted: false;
  remediationPerformed: false;
  controlsProven: boolean;
  ownerAcceptanceComplete: boolean;
  problems: readonly string[];
  observedAt: number | null;
  fingerprint: string;
  issuer: string;
}

const CREDENTIAL_KEYS = [
  "credential",
  "secret",
  "apiKey",
  "api_key",
  "x-api-key",
  "token",
  "password",
] as const;

const MIN_RATIONALE = 40;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function compensatingControlsProven(obs: A1RuntimeControlObservation): boolean {
  return (
    obs.neverCallsFreebuffHost &&
    obs.usesXstarzEmailAbstraction &&
    obs.retiredIssuersRefusedInProduction &&
    obs.productionEmailFailsClosed &&
    obs.noFreebuffOtpFallback &&
    obs.problems.length === 0
  );
}

/**
 * Observe the A1 runtime controls from source text. The observer never reads
 * the attestation for these facts: a filed `true` that the sources do not
 * support is refused.
 */
export function observeA1RuntimeControls(
  files: Readonly<Record<string, string>>,
): A1RuntimeControlObservation {
  const emailOtp = files["src/convex/auth/emailOtp.ts"] ?? "";
  const emailDelivery = files["src/convex/lib/emailDelivery.ts"] ?? "";
  const issuerPolicy = files["src/convex/lib/issuerPolicy.ts"] ?? "";
  const problems: string[] = [];

  if (emailOtp.length === 0) problems.push("src/convex/auth/emailOtp.ts is missing");
  if (emailDelivery.length === 0) problems.push("src/convex/lib/emailDelivery.ts is missing");
  if (issuerPolicy.length === 0) problems.push("src/convex/lib/issuerPolicy.ts is missing");

  const usesXstarz = /sendXstarzVerificationEmail/.test(emailOtp);
  if (emailOtp.length > 0 && !usesXstarz) {
    problems.push("emailOtp.ts does not call sendXstarzVerificationEmail");
  }

  const namesFreebuffHost = /auth\.freebuff\.app/.test(emailOtp);
  const namesSendOtp = /send_otp/.test(emailOtp);
  if (namesFreebuffHost) problems.push("emailOtp.ts still names auth.freebuff.app");
  if (namesSendOtp) problems.push("emailOtp.ts still names the Freebuff send_otp path");

  const retiredListed =
    /RETIRED_ISSUER_HOSTS/.test(issuerPolicy) && /freebuff\.app/.test(issuerPolicy);
  if (issuerPolicy.length > 0 && !retiredListed) {
    problems.push("issuerPolicy.ts does not list freebuff.app among RETIRED_ISSUER_HOSTS");
  }
  const productionRefusesFederated =
    /environment === ["']production["']/.test(issuerPolicy) &&
    /IssuerPolicyError/.test(issuerPolicy);
  if (issuerPolicy.length > 0 && !productionRefusesFederated) {
    problems.push("issuerPolicy.ts does not refuse federated issuers in production");
  }

  const forbiddenHosts =
    /FORBIDDEN_DELIVERY_HOSTS/.test(emailDelivery) && /auth\.freebuff\.app/.test(emailDelivery);
  if (emailDelivery.length > 0 && !forbiddenHosts) {
    problems.push("emailDelivery.ts does not denylist auth.freebuff.app");
  }
  const sharedTestSender = /isSharedTestSenderHost/.test(emailDelivery);
  if (emailDelivery.length > 0 && !sharedTestSender) {
    problems.push("emailDelivery.ts does not refuse shared-test sender hosts");
  }
  const productionRefusesConsole =
    /isProductionDeployment/.test(emailDelivery) &&
    /NON_DELIVERING_TRANSPORTS/.test(emailDelivery) &&
    /["']console["']/.test(emailDelivery);
  if (emailDelivery.length > 0 && !productionRefusesConsole) {
    problems.push("emailDelivery.ts does not fail-closed for console in production");
  }

  const neverCalls = emailOtp.length > 0 && !namesFreebuffHost && !namesSendOtp;
  return {
    neverCallsFreebuffHost: neverCalls,
    usesXstarzEmailAbstraction: usesXstarz,
    retiredIssuersRefusedInProduction: retiredListed && productionRefusesFederated,
    productionEmailFailsClosed: forbiddenHosts && sharedTestSender && productionRefusesConsole,
    noFreebuffOtpFallback: usesXstarz && neverCalls,
    problems,
  };
}

export function emptyA1CompensatingAssessment(now: number): A1CompensatingAssessment {
  return {
    schema: A1_COMPENSATING_SCHEMA,
    outcome: "NOT_FILED",
    admissible: false,
    revocationClaimed: false,
    issuerContacted: false,
    remediationPerformed: false,
    controlsProven: false,
    ownerAcceptanceComplete: false,
    problems: ["no compensating-controls file is filed"],
    observedAt: now,
    fingerprint: FINGERPRINT,
    issuer: ISSUER,
  };
}

/**
 * Evaluate a compensating-controls payload against independently observed
 * runtime controls. Never contacts an issuer. Never writes a file.
 */
export function evaluateA1CompensatingControls(
  payload: unknown,
  options: {
    now: number;
    controls: A1RuntimeControlObservation;
    candidateCommit?: string;
  },
): A1CompensatingAssessment {
  const { now, controls } = options;
  const proven = compensatingControlsProven(controls);
  const base: Omit<A1CompensatingAssessment, "outcome" | "problems"> = {
    schema: A1_COMPENSATING_SCHEMA,
    admissible: false,
    revocationClaimed: false,
    issuerContacted: false,
    remediationPerformed: false,
    controlsProven: proven,
    ownerAcceptanceComplete: false,
    observedAt: now,
    fingerprint: FINGERPRINT,
    issuer: ISSUER,
  };

  if (payload == null) {
    return {
      ...base,
      outcome: "NOT_FILED",
      problems: ["no compensating-controls file is filed", ...controls.problems],
    };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ...base,
      outcome: "MALFORMED",
      problems: ["compensating-controls payload is not an object"],
    };
  }

  const body = payload as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of CREDENTIAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null && body[key] !== "") {
      problems.push(`forbidden field "${key}" — a credential value must never be filed`);
    }
  }
  if (problems.length > 0) {
    return { ...base, outcome: "FORBIDDEN_CONTENT", problems };
  }

  if (body.schema !== A1_COMPENSATING_SCHEMA) {
    problems.push(
      `schema must be ${A1_COMPENSATING_SCHEMA}, got ${String(body.schema ?? "<missing>")}`,
    );
  }
  if (body.prerequisite !== A1_COMPENSATING_PREREQUISITE) {
    problems.push(`prerequisite must be ${A1_COMPENSATING_PREREQUISITE}`);
  }
  if (body.source !== "owner-risk-acceptance") {
    problems.push('source must be "owner-risk-acceptance" (this path is not issuer evidence)');
  }
  if (body.environment !== "production") {
    problems.push("environment must be production");
  }
  if (body.issuer !== ISSUER) {
    problems.push(`issuer must be ${ISSUER}`);
  }
  if (body.fingerprint !== FINGERPRINT) {
    problems.push("fingerprint does not match the exposed OTP identity");
  }
  if (body.kind !== "compensating-controls") {
    problems.push('kind must be "compensating-controls"');
  }

  if (body.revocationClaimed !== false) {
    return {
      ...base,
      outcome: "CLAIMS_REVOCATION",
      problems: [
        "revocationClaimed must be false — this path must not claim the issuer revoked the credential",
      ],
    };
  }
  if (body.issuerContacted === true) {
    return {
      ...base,
      outcome: "CLAIMS_REVOCATION",
      problems: ["issuerContacted must be false — this path must not claim issuer contact"],
    };
  }
  if (body.httpStatus === 401 || body.httpStatus === 403) {
    return {
      ...base,
      outcome: "CLAIMS_REVOCATION",
      problems: ["httpStatus 401/403 belongs on the issuer-evidence path, not here"],
    };
  }

  if (typeof body.acceptedAt !== "number" || !Number.isFinite(body.acceptedAt)) {
    problems.push("acceptedAt must be a finite epoch millisecond");
  } else {
    if (body.acceptedAt > now) {
      return {
        ...base,
        outcome: "FUTURE_DATED",
        problems: [`future-dated: acceptedAt is ${body.acceptedAt - now}ms ahead of evaluation`],
      };
    }
    if (now - body.acceptedAt > MAX_AGE_MS) {
      return {
        ...base,
        outcome: "STALE",
        problems: [`stale: acceptedAt is older than the ${MAX_AGE_MS}ms window`],
      };
    }
  }

  const accepted = body.accepted === true;
  const acceptedBy = typeof body.acceptedBy === "string" ? body.acceptedBy.trim() : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  const residualRisk = typeof body.residualRisk === "string" ? body.residualRisk.trim() : "";
  const ownerAcceptanceComplete =
    accepted && acceptedBy.length > 0 && rationale.length >= MIN_RATIONALE && residualRisk.length > 0;

  if (!accepted) problems.push("accepted must be true — the owner has not accepted");
  if (acceptedBy.length === 0) problems.push("acceptedBy is required");
  if (rationale.length < MIN_RATIONALE) {
    problems.push(`rationale must be at least ${MIN_RATIONALE} characters`);
  }
  if (residualRisk.length === 0) {
    problems.push("residualRisk must name the remaining exposure (the key is not revoked at the issuer)");
  }

  if (body.fixture === true) problems.push("a fixture is not an owner acceptance");
  if (options.candidateCommit && typeof body.commit === "string" && body.commit !== options.candidateCommit) {
    return {
      ...base,
      ownerAcceptanceComplete,
      outcome: "WRONG_SUBJECT",
      problems: [`wrong commit: file covers ${body.commit}, candidate is ${options.candidateCommit}`],
    };
  }

  if (!proven) {
    return {
      ...base,
      ownerAcceptanceComplete,
      outcome: "CONTROLS_INCOMPLETE",
      problems: [
        "runtime compensating controls are not independently proven",
        ...controls.problems,
        ...problems,
      ],
    };
  }

  if (problems.length > 0) {
    return {
      ...base,
      ownerAcceptanceComplete,
      outcome: ownerAcceptanceComplete ? "MALFORMED" : "OWNER_ACCEPTANCE_INCOMPLETE",
      problems,
    };
  }

  return {
    ...base,
    admissible: true,
    ownerAcceptanceComplete: true,
    outcome: "ADMISSIBLE",
    observedAt: typeof body.acceptedAt === "number" ? body.acceptedAt : now,
    problems: [],
  };
}

/**
 * Map an assessment onto a gate evidence record. Admissible assessments become
 * VERIFIED with source `owner-risk-acceptance`. Everything else is BLOCKED so
 * it cannot be quoted as a pass, and the detail never claims revocation.
 */
export function a1CompensatingControlsToEvidence(
  assessment: A1CompensatingAssessment,
): EvidenceRecord {
  const observedAt = assessment.observedAt ?? 0;
  const subject = { issuer: assessment.issuer };
  if (assessment.admissible && assessment.outcome === "ADMISSIBLE") {
    return {
      prerequisite: A1_COMPENSATING_PREREQUISITE,
      status: "VERIFIED",
      source: "owner-risk-acceptance",
      environment: "production",
      observedAt,
      subject,
      detail:
        "issuer unavailable; owner accepted residual risk; revocation is not claimed; runtime compensating controls independently observed",
    };
  }
  return {
    prerequisite: A1_COMPENSATING_PREREQUISITE,
    status: "BLOCKED",
    source: "owner-risk-acceptance",
    environment: "production",
    observedAt,
    subject,
    detail: assessment.problems[0] ?? `compensating-controls ${assessment.outcome}`,
  };
}
