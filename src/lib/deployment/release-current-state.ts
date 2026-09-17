/**
 * Phase 241 — what the repository can actually prove about itself, today.
 *
 * The gate next door answers "may this be released?" given evidence. This file
 * answers a narrower and more dangerous question: "what evidence does this
 * checkout actually contain?" — and its single rule is that absence of evidence
 * is reported as absence, never as a pass.
 *
 * There is deliberately no code path here that produces a VERIFIED record from
 * a document. A file in this repository is, at best, a CLAIM; the gate only
 * accepts `external-verification` records bound to the candidate, so a claim
 * written here can never satisfy a prerequisite — it can only be reported, with
 * the reason it did not count. That is the property the current-state test
 * exercises: flipping a derived record's status to VERIFIED still yields NOT
 * READY, because the record's source and environment are what the gate reads.
 *
 * Evidence is looked for at explicit, named paths. If an operator later produces
 * real production proof, they file it at that path and this reader validates it;
 * a malformed or badly bound file is reported as a refusal, not skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllProviders } from "@/lib/data/universal/providers";
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
  /** Post-rewrite verification, per affected ref (A2). */
  rewriteVerification: "docs/remediation/rewrite-verification.json",
  /** Production Convex deployment verification. */
  convexDeployment: "docs/remediation/convex-production-deployment.json",
  /** Real delivery through the production email transport. */
  emailDelivery: "docs/remediation/production-email-verification.json",
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

/** The candidate this checkout would release, if it were released. */
const CANDIDATE = {
  commit: "WORKTREE",
  ref: "heads/arena/01a0adfb-trade-intel-bot",
} as const;

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

/** Derive the evidence set from the tree as it is. */
export function deriveCurrentReleaseState(source: FactSource = defaultSource): CurrentReleaseState {
  const inventory = readInventory(source);

  const records: EvidenceRecord[] = [];

  const proofByPath: Array<[string, string]> = [
    ["A1_OTP_ISSUER_REVOCATION", PROOF_PATHS.a1Revocation],
    ["A2_HISTORY_REWRITE", PROOF_PATHS.rewriteVerification],
    ["CONVEX_PRODUCTION_DEPLOYMENT", PROOF_PATHS.convexDeployment],
    ["PRODUCTION_EMAIL_TRANSPORT", PROOF_PATHS.emailDelivery],
    ["EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION", PROOF_PATHS.evidenceD],
  ];
  const present: string[] = [];
  for (const [prerequisite, path] of proofByPath) {
    const record = proofRecord(prerequisite, path, source);
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
      commit: CANDIDATE.commit,
      ref: CANDIDATE.ref,
      // No production deployment is declared anywhere in this repository — the
      // Phase 186/234 work stopped at "configuration present, deployment not
      // performed". Leaving it undefined is what makes the deployment
      // prerequisite refuse evidence that names some other deployment.
      productionDeployment: undefined,
    },
    affectedRefs: facts.affectedRefs,
    // Read from the live provider registry rather than listed here: a provider
    // added to the product is a provider production verification must cover,
    // and a hand-maintained list would silently stop covering it.
    requiredProviders: getAllProviders().map((provider) => provider.id).sort(),
    records,
  };

  return { facts, input, verdict: evaluateRelease(input, { prerequisites: RELEASE_PREREQUISITES }) };
}

/** The verdict this checkout earns, computed from what it can actually prove. */
export function currentReleaseVerdict(source: FactSource = defaultSource): ReleaseVerdict {
  return deriveCurrentReleaseState(source).verdict;
}
