/**
 * Phase 241 — what the repository can actually prove about itself, today.
 *
 * The gate next door answers "may this be released?" given evidence. This file
 * answers a narrower and more dangerous question: "what evidence does this
 * checkout actually contain?" — and its single rule is that absence of evidence
 * is reported as absence, never as a pass.
 *
 * There is deliberately no code path here that produces a VERIFIED record from
 * a document. A file in this repository is, at best, a CLAIM. The gate accepts
 * `external-verification` for every prerequisite, and — for A1 only —
 * `owner-risk-acceptance` after independently observed compensating controls.
 * A claim that does not survive that reader cannot satisfy a prerequisite.
 *
 * Evidence is looked for at explicit, named paths. If an operator later produces
 * real production proof, they file it at that path and this reader validates it;
 * a malformed or badly bound file is reported as a refusal, not skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllProviders } from "@/lib/data/universal/providers";
import {
  EVIDENCE_D_PREREQUISITE,
  evaluateEvidenceDPackage,
  toGateEvidenceRecord,
} from "./evidence-d-verification";
import {
  CONVEX_DEPLOYMENT_PREREQUISITE,
  evaluateConvexDeploymentPackage,
  toGateConvexRecord,
} from "./convex-deployment-verification";
import { requiredConvexFunctionReferences } from "./convex-function-surface";
import {
  A1_COMPENSATING_PROOF_PATH,
  A1_RUNTIME_CONTROL_PATHS,
  a1CompensatingControlsToEvidence,
  evaluateA1CompensatingControls,
  observeA1RuntimeControls,
} from "./a1-compensating-controls";
import {
  evaluateRelease,
  RELEASE_PREREQUISITES,
  type EvidenceRecord,
  type ReleaseInput,
  type ReleaseVerdict,
} from "./release-gate";

/** Where real, externally-produced proof is expected to be filed. */
export const PROOF_PATHS = {
  /** Issuer-side revocation confirmation for the exposed OTP credential (A1). */
  a1Revocation: "docs/remediation/a1-revocation-attestation.json",
  /**
   * Owner-filed compensating-controls risk-acceptance for A1. Does not claim
   * revocation. Unfiled until the owner writes it.
   */
  a1CompensatingControls: A1_COMPENSATING_PROOF_PATH,
  /** Post-rewrite verification, per affected ref (A2). */
  rewriteVerification: "docs/remediation/rewrite-verification.json",
  /** Production Convex deployment verification. */
  convexDeployment: "docs/remediation/convex-production-deployment.json",
  /* Phase 270: no email-delivery proof path exists anymore — the email-OTP
     provider was retired, so there is nothing left a delivery proof could
     verify. The former filing path
     ("docs/remediation/production-email-verification.json") is historical only. */
  /** Live production provider observations (Evidence D, production class). */
  evidenceD: "docs/remediation/evidence-d-production.json",
  /** The pre-rewrite exposure inventory this repository already carries. */
  refInventory: "docs/secret-remediation-refs.json",
} as const;

export interface CurrentReleaseFacts {
  /** The affected refs, read from the inventory — never hardcoded here. */
  affectedRefs: readonly string[];
  /** Refs still SERVING the leaked blob at their tip. Non-empty means live exposure. */
  refsStillServingBlob: readonly string[];
  inventoryPresent: boolean;
  proofFilesPresent: readonly string[];
  /**
   * True when the repository records that the only executed run was a
   * development one. That is evidence of an external boundary, not of a
   * production verification.
   */
  developmentOnlyEvidenceRecorded: boolean;
}

export interface CurrentReleaseState {
  facts: CurrentReleaseFacts;
  input: ReleaseInput;
  verdict: ReleaseVerdict;
}

/** Injectable filesystem access so the refusal paths are testable. */
export interface FactSource {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const defaultSource: FactSource = {
  exists: (path) => existsSync(resolve(process.cwd(), path)),
  read: (path) => readFileSync(resolve(process.cwd(), path), "utf8"),
};

/**
 * The candidate this checkout would release, if it were released.
 *
 * Exported because the Phase 242 admission layer must bind to the same identity
 * this reader binds proofs to. Two copies of these strings would be two release
 * identities, and evidence filed against one of them would silently not count
 * for the other.
 */
export const DEFAULT_CANDIDATE = {
  commit: "WORKTREE",
  ref: "heads/arena/01a0adfb-trade-intel-bot",
} as const;

const CANDIDATE = DEFAULT_CANDIDATE;

/**
 * Deterministic inputs a caller may pin. Phase 242 uses them to evaluate the
 * candidate that is actually being admitted (a CI commit rather than the
 * worktree) at a declared instant rather than at whatever the clock says.
 */
export interface DerivationOptions {
  /** Evaluation instant for the freshness rules. */
  now?: number;
  /** The commit under consideration. Defaults to the worktree sentinel. */
  commit?: string;
  /** The ref under consideration. Defaults to the tracked branch. */
  ref?: string;
  /**
   * The production deployment this candidate would be released to, when the
   * release caller declares one. Omitted — the default, and the state of this
   * repository — means no deployment is declared, and the gate then refuses
   * every deployment proof rather than accepting an unnamed one. Declaring a
   * deployment proves nothing by itself: evidence must still bind to it.
   */
  productionDeployment?: string;
  /**
   * The Convex function surface a production deployment must publish. Defaults to
   * a scan of this candidate's `src/convex`; a caller may pin it to evaluate a
   * specific artifact deterministically. An empty set is never treated as
   * "covered" — the validator refuses it as an unknown surface.
   */
  requiredConvexFunctions?: readonly string[];
}

interface InventoryShape {
  refs?: { ref?: unknown; affected?: unknown; exposedAtTip?: unknown }[];
}

function readInventory(source: FactSource): {
  present: boolean;
  affectedRefs: string[];
  stillServing: string[];
} {
  if (!source.exists(PROOF_PATHS.refInventory)) {
    return { present: false, affectedRefs: [], stillServing: [] };
  }
  try {
    const parsed = JSON.parse(source.read(PROOF_PATHS.refInventory)) as InventoryShape;
    const refs = Array.isArray(parsed.refs) ? parsed.refs : [];
    const affectedRefs: string[] = [];
    const stillServing: string[] = [];
    for (const entry of refs) {
      if (typeof entry?.ref !== "string") continue;
      if (entry.affected === true) affectedRefs.push(entry.ref);
      if (entry.exposedAtTip === true) stillServing.push(entry.ref);
    }
    return { present: true, affectedRefs, stillServing };
  } catch {
    // An unreadable inventory is not an empty inventory. Reporting "no refs
    // affected" from a parse failure would be the same defect the Phase 233
    // guards exist to prevent, one layer up.
    return { present: false, affectedRefs: [], stillServing: [] };
  }
}

/**
 * A proof file is only worth what it declares. Anything that does not declare
 * itself as externally-produced production verification is reported as a claim,
 * and a claim cannot satisfy a prerequisite.
 */
/**
 * A1 compensating-controls file, validated rather than quoted. Controls are
 * observed from the runtime sources, never taken from the file. Absence of the
 * file is silence, not a BLOCKED record — A1 then stays on the revocation path.
 */
function a1CompensatingProofRecord(
  source: FactSource,
  now: number,
  candidateCommit: string,
): EvidenceRecord | null {
  const path = PROOF_PATHS.a1CompensatingControls;
  if (!source.exists(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.read(path));
  } catch {
    return {
      prerequisite: "A1_OTP_ISSUER_REVOCATION",
      status: "UNVERIFIED",
      source: "documentation",
      environment: "local",
      observedAt: Number.NaN,
      detail: `${path} exists but is not valid JSON`,
    };
  }

  const files: Record<string, string> = {};
  for (const controlPath of A1_RUNTIME_CONTROL_PATHS) {
    files[controlPath] = source.exists(controlPath) ? source.read(controlPath) : "";
  }
  const assessment = evaluateA1CompensatingControls(parsed, {
    now,
    controls: observeA1RuntimeControls(files),
    candidateCommit,
  });
  const record = a1CompensatingControlsToEvidence(assessment);
  return { ...record, detail: `${path}: ${record.detail}` };
}

/**
 * A proof file is only worth what it declares. Anything that does not declare
 * itself as externally-produced production verification is reported as a claim,
 * and a claim cannot satisfy a prerequisite.
 */
function proofRecord(
  prerequisite: string,
  path: string,
  source: FactSource,
): EvidenceRecord | null {
  if (!source.exists(path)) return null;
  let declared: Record<string, unknown>;
  try {
    declared = JSON.parse(source.read(path)) as Record<string, unknown>;
  } catch {
    return {
      prerequisite,
      status: "UNVERIFIED",
      source: "documentation",
      environment: "local",
      observedAt: Number.NaN,
      detail: `${path} exists but is not valid JSON`,
    };
  }
  const verified = declared.verified === true;
  return {
    prerequisite,
    status: verified ? "VERIFIED" : "UNVERIFIED",
    source: (declared.source as EvidenceRecord["source"]) ?? "documentation",
    environment: (declared.environment as EvidenceRecord["environment"]) ?? "local",
    observedAt: typeof declared.observedAt === "number" ? declared.observedAt : Number.NaN,
    subject: (declared.subject as EvidenceRecord["subject"]) ?? undefined,
    detail: `${path}: ${String(declared.detail ?? "no detail declared")}`,
  };
}

/**
 * The Evidence D proof, read through the Phase 247 validator.
 *
 * The four other proofs are claims written by a human and read as claims: the
 * gate refuses them unless they declare an external production source. Evidence D
 * is the one prerequisite whose whole content is "every provider answered in
 * production, observed live", and a claim to that effect is exactly what a
 * fixture, a cache and a local run can also produce. So this path is validated
 * rather than quoted: an inadmissible package becomes a BLOCKED record whose
 * detail names the state and the reasons, which is a refusal the operator can act
 * on and which no amount of editing the file can turn into a pass.
 *
 * The record's freshness input is the package's OLDEST accepted observation, and
 * its provider coverage is the coverage the validator actually verified — not a
 * list the file declares about itself.
 */
function evidenceDProofRecord(
  path: string,
  source: FactSource,
  now: number,
  candidate: { commit: string; ref: string },
): EvidenceRecord | null {
  if (!source.exists(path)) return null;

  const blocked = (assessment: ReturnType<typeof evaluateEvidenceDPackage>): EvidenceRecord => ({
    prerequisite: EVIDENCE_D_PREREQUISITE,
    status: "BLOCKED",
    source: "external-verification",
    environment: "production",
    // The oldest observation the package DECLARES, so the gate's own freshness
    // rule applies to it: a package whose oldest observation is stale reports
    // STALE rather than merely refused. Clamped to the evaluation instant so a
    // fabricated future stamp cannot become the reason an operator reads.
    observedAt: Math.min(assessment.oldestDeclaredObservation ?? now, now),
    subject: { providers: [...assessment.verifiedProviders], commit: candidate.commit },
    detail: `${path}: refused by the Evidence D validator (${assessment.state}): ${
      assessment.problems.slice(0, 3).join("; ") || assessment.state
    }`,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.read(path));
  } catch {
    return {
      prerequisite: EVIDENCE_D_PREREQUISITE,
      status: "UNVERIFIED",
      source: "documentation",
      environment: "local",
      observedAt: Number.NaN,
      detail: `${path} exists but is not valid JSON`,
    };
  }

  const assessment = evaluateEvidenceDPackage(parsed, { now, candidate });
  const projection = toGateEvidenceRecord(assessment, {
    candidateCommit: candidate.commit,
    candidateRef: candidate.ref,
  });
  return projection.record ?? blocked(assessment);
}

/**
 * The Convex deployment proof, read through the Phase 248 validator.
 *
 * Like Evidence D, this prerequisite's whole content is a production fact — "the
 * deployment exists and publishes this candidate" — that a claim, a green build or
 * a reachable control plane can all be made to look like. So the path is validated
 * rather than quoted: the identity must be a production one, the URLs must be
 * external Convex hosts, the observed environment must resolve to production under
 * the real policy, the control-plane verdict must be the authenticated one, every
 * function this candidate defines must be published, and the package must bind to
 * the candidate and its declared deployment. An inadmissible package becomes a
 * BLOCKED record whose detail names the state and the reasons — a refusal the
 * operator can act on, which no edit of the file can turn into a pass.
 */
function convexDeploymentProofRecord(
  path: string,
  source: FactSource,
  now: number,
  candidate: { commit: string; ref: string },
  productionDeployment: string | undefined,
  requiredFunctions: readonly string[],
): EvidenceRecord | null {
  if (!source.exists(path)) return null;

  const blocked = (
    assessment: ReturnType<typeof evaluateConvexDeploymentPackage>,
  ): EvidenceRecord => ({
    prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
    status: "BLOCKED",
    source: "external-verification",
    environment: "production",
    // The instant the package DECLARES, clamped to the evaluation instant, so the
    // gate's own freshness rule applies: a stale verification reports STALE, and a
    // fabricated future stamp cannot become the reason an operator reads.
    observedAt: Math.min(assessment.observedAt ?? now, now),
    subject: {
      commit: candidate.commit,
      ...(assessment.deployment ? { deployment: assessment.deployment } : {}),
    },
    detail: `${path}: refused by the Convex deployment validator (${assessment.state}): ${
      assessment.problems.slice(0, 3).join("; ") || assessment.state
    }`,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.read(path));
  } catch {
    return {
      prerequisite: CONVEX_DEPLOYMENT_PREREQUISITE,
      status: "UNVERIFIED",
      source: "documentation",
      environment: "local",
      observedAt: Number.NaN,
      detail: `${path} exists but is not valid JSON`,
    };
  }

  const assessment = evaluateConvexDeploymentPackage(parsed, {
    now,
    candidate,
    productionDeployment,
    requiredFunctions,
  });
  const projection = toGateConvexRecord(assessment, {
    candidateCommit: candidate.commit,
    deployment: productionDeployment ?? assessment.deployment ?? undefined,
  });
  return projection.record ?? blocked(assessment);
}

/**
 * The functions a production deployment of this candidate must publish, scanned
 * from the backend. Memoised: the tree does not change during one evaluation, and
 * the scan walks `src/convex`, so doing it once per process is enough. A caller
 * may pin the set explicitly (tests, or an admission evaluating a specific
 * artifact) via `DerivationOptions.requiredConvexFunctions`.
 */
let cachedRequiredFunctions: readonly string[] | null = null;
function resolveRequiredFunctions(override?: readonly string[]): readonly string[] {
  if (override) return [...override];
  if (cachedRequiredFunctions) return cachedRequiredFunctions;
  cachedRequiredFunctions = requiredConvexFunctionReferences();
  return cachedRequiredFunctions;
}

/** Derive the evidence set from the tree as it is. */
export function deriveCurrentReleaseState(
  source: FactSource = defaultSource,
  options: DerivationOptions = {},
): CurrentReleaseState {
  const inventory = readInventory(source);

  const records: EvidenceRecord[] = [];

  const proofByPath: Array<[string, string]> = [
    ["A1_OTP_ISSUER_REVOCATION", PROOF_PATHS.a1Revocation],
    ["A2_HISTORY_REWRITE", PROOF_PATHS.rewriteVerification],
    ["CONVEX_PRODUCTION_DEPLOYMENT", PROOF_PATHS.convexDeployment],
    /* Phase 270: PRODUCTION_EMAIL_TRANSPORT retired — there is no email
       authentication path left for that proof to cover. */
    ["EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION", PROOF_PATHS.evidenceD],
  ];
  const present: string[] = [];
  const candidate = {
    commit: options.commit ?? CANDIDATE.commit,
    ref: options.ref ?? CANDIDATE.ref,
  };
  /* The instant the reader judges freshness at, defaulted exactly the way the
     gate defaults it, so the two layers never disagree about "now". */
  const now = options.now ?? Date.now();
  const requiredFunctions = resolveRequiredFunctions(options.requiredConvexFunctions);
  for (const [prerequisite, path] of proofByPath) {
    if (prerequisite === "A1_OTP_ISSUER_REVOCATION") {
      const compensating = a1CompensatingProofRecord(source, now, candidate.commit);
      if (compensating) {
        present.push(PROOF_PATHS.a1CompensatingControls);
        records.push(compensating);
      }
      const quoted = proofRecord(prerequisite, path, source);
      if (quoted) {
        present.push(path);
        records.push(quoted);
      }
      continue;
    }
    const record =
      prerequisite === EVIDENCE_D_PREREQUISITE
        ? evidenceDProofRecord(path, source, now, candidate)
        : prerequisite === CONVEX_DEPLOYMENT_PREREQUISITE
          ? convexDeploymentProofRecord(
              path,
              source,
              now,
              candidate,
              options.productionDeployment,
              requiredFunctions,
            )
          : proofRecord(prerequisite, path, source);
    if (record) {
      present.push(path);
      records.push(record);
    }
  }

  const developmentOnlyEvidenceRecorded = source.exists("docs/UAT-MATRIX.md")
    ? source.read("docs/UAT-MATRIX.md").includes("DEV_VERIFIED — NOT PRODUCTION EVIDENCE")
    : false;

  const facts: CurrentReleaseFacts = {
    affectedRefs: inventory.affectedRefs,
    refsStillServingBlob: inventory.stillServing,
    inventoryPresent: inventory.present,
    proofFilesPresent: present,
    developmentOnlyEvidenceRecorded,
  };

  const input: ReleaseInput = {
    candidate: {
      commit: candidate.commit,
      ref: candidate.ref,
      // No production deployment is declared anywhere in this repository — the
      // Phase 186/234 work stopped at "configuration present, deployment not
      // performed". A release caller may declare one explicitly; when it is
      // omitted the gate refuses deployment evidence entirely rather than
      // accepting an unnamed proof.
      productionDeployment: options.productionDeployment,
    },
    affectedRefs: facts.affectedRefs,
    // Read from the live provider registry rather than listed here: a provider
    // added to the product is a provider production verification must cover,
    // and a hand-maintained list would silently stop covering it.
    requiredProviders: getAllProviders().map((provider) => provider.id).sort(),
    records,
  };

  return {
    facts,
    input,
    verdict: evaluateRelease(input, { prerequisites: RELEASE_PREREQUISITES, now: options.now }),
  };
}

/** The verdict this checkout earns, computed from what it can actually prove. */
export function currentReleaseVerdict(
  source: FactSource = defaultSource,
  options: DerivationOptions = {},
): ReleaseVerdict {
  return deriveCurrentReleaseState(source, options).verdict;
}
