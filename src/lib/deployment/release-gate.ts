/**
 * Phase 241 — the release gate as a DECISION, not a paragraph.
 *
 * WHY THIS EXISTS
 *
 * Until this phase the release verdict lived in prose (`docs/RELEASE-GATE.md`)
 * plus a set of per-phase guards that each checked one artefact. That is a
 * perfectly good way to DOCUMENT a verdict and a poor way to COMPUTE one: the
 * text cannot refuse anything, and every guard answered its own question in
 * isolation. Nothing in the repository could answer "may this be released?"
 * with a value a machine — or a reviewer — could not accidentally misread.
 *
 * This module is that answer. It is the only place a verdict is produced, and
 * it is deliberately small enough to audit in one sitting.
 *
 * THE INVARIANT (fail-closed)
 *
 *   READY  iff  EVERY mandatory prerequisite is explicitly VERIFIED.
 *
 * Nothing else produces READY. Concretely:
 *
 *   - a prerequisite with no evidence is UNVERIFIED, and UNVERIFIED is not a pass
 *   - BLOCKED, STALE, CONTRADICTORY and malformed evidence are all not a pass
 *   - documentation is not verification; a fixture is not production; a local or
 *     CI run is not production; a green CI job is not a release verdict
 *   - evidence for the wrong commit, the wrong ref set, the wrong deployment or
 *     the wrong provider set does not satisfy the prerequisite it names
 *   - a stale or future-dated proof is not proof
 *   - two records that disagree cannot be resolved by preferring the convenient
 *     one; they are CONTRADICTORY
 *   - evidence naming a prerequisite nobody asked for is not silently dropped:
 *     if it claims VERIFIED it fails the evaluation
 *   - an exception anywhere in evaluation yields NOT READY with the error named,
 *     never a thrown error and never a pass
 *
 * The point is not to produce a particular verdict; it is that the verdict
 * cannot be produced by accident. Every rule below has a test and a mutant.
 */

/** The five states a prerequisite can be in. Only `VERIFIED` satisfies it. */
export type PrerequisiteState =
  | "VERIFIED"
  | "UNVERIFIED"
  | "BLOCKED"
  | "STALE"
  | "CONTRADICTORY";

/** Where a piece of evidence came from. Only external verification can satisfy. */
export type EvidenceSource =
  | "external-verification"
  | "documentation"
  | "ci-run"
  | "fixture"
  | "local-run";

/** The environment the evidence describes. Production prerequisites need production. */
export type EvidenceEnvironment = "production" | "preview" | "development" | "local" | "ci";

export interface EvidenceSubject {
  /** The commit the evidence was produced against, when it binds to one. */
  commit?: string;
  /** The refs the evidence covers, when it binds to a ref set. */
  refs?: readonly string[];
  /** The deployment the evidence describes, when it binds to one. */
  deployment?: string;
  /** The providers the evidence covers, when it binds to a provider set. */
  providers?: readonly string[];
  /** The issuer the evidence describes, when it binds to one (A1). */
  issuer?: string;
}

export interface EvidenceRecord {
  /** Which prerequisite this record speaks to. */
  prerequisite: string;
  /** What the record asserts. Only `VERIFIED` is ever a pass. */
  status: "VERIFIED" | "UNVERIFIED" | "BLOCKED";
  source: EvidenceSource;
  environment: EvidenceEnvironment;
  /** When the evidence was produced (ms since epoch). */
  observedAt: number;
  subject?: EvidenceSubject;
  /** Human-readable note; never used to decide anything. */
  detail?: string;
}

/** How a prerequisite is bound to the release candidate. */
export type SubjectBinding =
  | "candidate-commit"
  | "affected-refs"
  | "deployment"
  | "provider-set"
  | "none";

export interface Prerequisite {
  id: string;
  /** What must be true, in one line, for an operator reading the verdict. */
  requirement: string;
  /**
   * Mandatory prerequisites are the ones that decide READY. A non-mandatory
   * prerequisite is reported but never blocks — and can never satisfy a
   * mandatory one either.
   */
  mandatory: boolean;
  /** The environment evidence must describe to count. */
  requiredEnvironment: EvidenceEnvironment;
  /** How long a proof stays usable. `null` means it does not expire. */
  maxAgeMs: number | null;
  /** How the evidence must be bound to this release candidate. */
  binding: SubjectBinding;
  /**
   * Whether an explicit exemption may waive it. The externally-blocked
   * prerequisites are `exemptible: false` on purpose: a release cannot be
   * declared by writing a sentence.
   */
  exemptible: boolean;
}

export interface ReleaseCandidate {
  commit: string;
  ref: string;
  /** The production deployment being released, when there is one. */
  productionDeployment?: string;
}

export interface ReleaseInput {
  candidate: ReleaseCandidate;
  /**
   * The affected refs for the historical rewrite (A2). Supplied rather than
   * assumed, because a rewrite that covers a subset must not read as complete.
   */
  affectedRefs: readonly string[];
  /** The provider set production verification must cover. */
  requiredProviders: readonly string[];
  records: readonly EvidenceRecord[];
  /** Explicit, reviewable exemptions. A reason is mandatory. */
  exemptions?: Readonly<Record<string, { reason: string }>>;
}

export interface PrerequisiteOutcome {
  id: string;
  requirement: string;
  mandatory: boolean;
  state: PrerequisiteState;
  /** Every reason a state was reached, in a stable order. */
  reasons: readonly string[];
  /** How many records spoke to it. Zero means missing evidence. */
  evidenceCount: number;
}

export interface ReleaseVerdict {
  /** `READY` is produced by exactly one thing: every mandatory prerequisite VERIFIED. */
  ready: boolean;
  /** Always `"NOT READY"` or `"READY"` — never a third, ambiguous word. */
  verdict: "READY" | "NOT READY";
  /** The mandatory prerequisite ids that are not VERIFIED, sorted. */
  blockers: readonly string[];
  /** Every prerequisite, mandatory or not, sorted by id. */
  prerequisites: readonly PrerequisiteOutcome[];
  /** Records that named a prerequisite the manifest does not contain. */
  unrecognised: readonly string[];
  /** Present when evaluation itself failed. A failure is never a pass. */
  evaluationError?: string;
}

/** Raised internally so the public entry point can name what went wrong. */
class EvaluationError extends Error {}

const VERIFYING_SOURCES: readonly EvidenceSource[] = ["external-verification"];

/** Clock injection keeps freshness rules deterministic in tests. */
export type Clock = () => number;

/**
 * Evaluate the release gate.
 *
 * This function never throws. Any internal failure is returned as a NOT READY
 * verdict carrying `evaluationError`, because a gate that disappears when it
 * breaks is a gate that can be broken on purpose.
 */
export function evaluateRelease(
  input: ReleaseInput,
  options: { prerequisites: readonly Prerequisite[]; now?: number; clock?: Clock } = {
    prerequisites: [],
  },
): ReleaseVerdict {
  const now = options.now ?? options.clock?.() ?? Date.now();
  try {
    return evaluate(input, options.prerequisites, now);
  } catch (error) {
    return {
      ready: false,
      verdict: "NOT READY",
      blockers: ["<evaluation-error>"],
      prerequisites: [],
      unrecognised: [],
      evaluationError: error instanceof Error ? error.message : String(error),
    };
  }
}

function evaluate(
  input: ReleaseInput,
  prerequisites: readonly Prerequisite[],
  now: number,
): ReleaseVerdict {
  if (!Array.isArray(prerequisites) || prerequisites.length === 0) {
    throw new EvaluationError("no prerequisites were supplied, so nothing could be verified");
  }
  if (!input || typeof input !== "object" || !Array.isArray(input.records)) {
    throw new EvaluationError("the evaluation input carried no evidence records");
  }

  const byId = new Map<string, Prerequisite>();
  for (const prerequisite of prerequisites) {
    if (!prerequisite || typeof prerequisite.id !== "string" || prerequisite.id === "") {
      throw new EvaluationError("a prerequisite without an id cannot be evaluated");
    }
    if (byId.has(prerequisite.id)) {
      throw new EvaluationError(`duplicate prerequisite id "${prerequisite.id}"`);
    }
    byId.set(prerequisite.id, prerequisite);
  }

  const grouped = new Map<string, EvidenceRecord[]>();
  const unrecognised: string[] = [];
  const unrecognisedVerified: string[] = [];

  for (const record of input.records) {
    // Reading `record.prerequisite` can throw for a hostile object; that is
    // exactly why the whole evaluation is wrapped.
    const id = record?.prerequisite;
    if (typeof id !== "string" || !byId.has(id)) {
      const key = typeof id === "string" ? id : "<record-without-prerequisite>";
      if (!unrecognised.includes(key)) unrecognised.push(key);
      if (record?.status === "VERIFIED") unrecognisedVerified.push(key);
      continue;
    }
    const bucket = grouped.get(id);
    if (bucket) bucket.push(record);
    else grouped.set(id, [record]);
  }

  const outcomes: PrerequisiteOutcome[] = [];
  for (const prerequisite of [...prerequisites].sort((a, b) => a.id.localeCompare(b.id))) {
    outcomes.push(classify(prerequisite, grouped.get(prerequisite.id) ?? [], input, now));
  }
  /*
    Exemptions are explicit or they do not exist.

    A mandatory prerequisite can never be waived — the whole point of the three
    externally-blocked requirements is that they are not satisfied by writing a
    sentence — so an exemption naming one is REFUSED and becomes a blocker of
    its own. An exemption naming a prerequisite that does not exist is refused
    for the same reason an unrecognised VERIFIED claim fails: a waiver for
    something nobody validated must not be quieter than a failure.
  */
  const refusedExemptions: string[] = [];
  for (const [id, exemption] of Object.entries(input.exemptions ?? {})) {
    const prerequisite = byId.get(id);
    const reason = typeof exemption?.reason === "string" ? exemption.reason.trim() : "";
    if (!prerequisite) {
      refusedExemptions.push(`${id} (exemption for an unrecognised prerequisite)`);
      continue;
    }
    if (reason.length === 0) {
      refusedExemptions.push(`${id} (exemption carries no stated reason)`);
      continue;
    }
    if (prerequisite.mandatory || !prerequisite.exemptible) {
      refusedExemptions.push(`${id} (exemption refused for a mandatory prerequisite)`);
      continue;
    }
    if (!input.exemptions) continue;
    const outcome = outcomes.find((o) => o.id === id);
    if (outcome && outcome.state !== "VERIFIED") {
      const at = outcomes.indexOf(outcome);
      outcomes[at] = {
        ...outcome,
        reasons: [...outcome.reasons, `exempted: ${reason}`],
      };
    }
  }

  const blockers = outcomes
    .filter((o) => o.mandatory && o.state !== "VERIFIED")
    .map((o) => o.id)
    .sort();

  /*
    An unrecognised prerequisite that claims VERIFIED is a contradiction the
    manifest cannot see — a check nobody asked for, asserting a pass. It fails
    the evaluation rather than being dropped, because "I did not know about that
    requirement" must never be quieter than "that requirement failed".
  */
  const allBlockers = [
    ...blockers,
    ...unrecognisedVerified.map((id) => `${id} (unrecognised evidence claiming VERIFIED)`),
    ...refusedExemptions,
  ].sort();

  const ready = allBlockers.length === 0;

  return {
    ready,
    verdict: ready ? "READY" : "NOT READY",
    blockers: allBlockers,
    prerequisites: outcomes,
    unrecognised,
  };
}

function classify(
  prerequisite: Prerequisite,
  records: readonly EvidenceRecord[],
  input: ReleaseInput,
  now: number,
): PrerequisiteOutcome {
  const reasons: string[] = [];
  const base = {
    id: prerequisite.id,
    requirement: prerequisite.requirement,
    mandatory: prerequisite.mandatory,
    evidenceCount: records.length,
  };

  if (records.length === 0) {
    return { ...base, state: "UNVERIFIED", reasons: ["no evidence was supplied"] };
  }

  // Normalise each record into either a usable claim or a named refusal.
  const verified: EvidenceRecord[] = [];
  const blocked: EvidenceRecord[] = [];
  let malformed = 0;

  for (const record of records) {
    const rejection = rejectReason(prerequisite, record, input, now);
    if (rejection) {
      reasons.push(rejection);
      if (typeof record?.status !== "string") malformed += 1;
      else if (record.status === "BLOCKED") blocked.push(record);
      continue;
    }
    if (record.status === "VERIFIED") verified.push(record);
    else if (record.status === "BLOCKED") blocked.push(record);
  }

  /*
    Contradiction is checked BEFORE any preference is applied. Two records that
    disagree about the same prerequisite are a fact about the evidence, not
    something the evaluator may resolve by picking the one it likes — that is
    exactly how a stale pass outlives an honest failure.
  */
  if (verified.length > 0 && blocked.length > 0) {
    return {
      ...base,
      state: "CONTRADICTORY",
      reasons: [
        ...reasons,
        `${verified.length} record(s) claim VERIFIED while ${blocked.length} claim BLOCKED`,
      ],
    };
  }

  if (verified.length > 0) {
    return { ...base, state: "VERIFIED", reasons: reasons.length ? reasons : ["verified"] };
  }

  if (blocked.length > 0) {
    return {
      ...base,
      state: "BLOCKED",
      reasons: [...reasons, ...blocked.map((b) => b.detail ?? "blocked")],
    };
  }

  // Nothing reached VERIFIED and nothing was BLOCKED: either a stale proof or
  // simply no usable evidence. Distinguish them, because the operator action
  // differs, but neither is a pass.
  const stale = reasons.some((r) => r.startsWith("stale") || r.startsWith("future-dated"));
  if (stale && malformed === 0 && reasons.length > 0) {
    return { ...base, state: "STALE", reasons };
  }

  return {
    ...base,
    state: "UNVERIFIED",
    reasons: reasons.length ? reasons : ["no usable evidence"],
  };
}

/**
 * Why a record cannot count, or `null` when it can.
 *
 * Every rule here is a sentence an operator can act on. The order matters only
 * for which reason is reported first.
 */
function rejectReason(
  prerequisite: Prerequisite,
  record: EvidenceRecord,
  input: ReleaseInput,
  now: number,
): string | null {
  if (!record || typeof record !== "object") return "malformed: record is not an object";

  const { status, source, environment, observedAt } = record;
  if (status !== "VERIFIED" && status !== "UNVERIFIED" && status !== "BLOCKED") {
    return `malformed: unknown status "${String(status)}"`;
  }

  /*
    A record naming a commit other than the candidate's is about a different
    artefact, whatever prerequisite it speaks to — the binding decides what ELSE
    must match, not whether this matters. Checked before the binding so a
    free-form prerequisite cannot accept a stale artefact's proof.
  */
  const claimedCommit = record.subject?.commit;
  if (typeof claimedCommit === "string" && claimedCommit !== input.candidate.commit) {
    return `wrong commit: evidence covers ${claimedCommit}, candidate is ${input.candidate.commit}`;
  }

  // A proof that expired, or that is dated after the moment of evaluation, is
  // not a proof. A future stamp is included on purpose: it is the shape a
  // fabricated or mis-clocked attestation takes.
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) {
    return "malformed: observedAt is not a finite instant";
  }
  if (observedAt > now) {
    return `future-dated: evidence is stamped ${observedAt - now}ms ahead of evaluation`;
  }
  if (prerequisite.maxAgeMs !== null && now - observedAt > prerequisite.maxAgeMs) {
    return `stale: evidence is older than the ${prerequisite.maxAgeMs}ms freshness window`;
  }

  if (status !== "VERIFIED") return null; // kept for BLOCKED/UNVERIFIED reporting

  if (!VERIFYING_SOURCES.includes(source)) {
    const word =
      source === "documentation" ? "documentation is not verification"
      : source === "fixture" ? "fixture data is not production evidence"
      : source === "ci-run" ? "a green CI run is not production verification"
      : "a local run is not production verification";
    return `${word} (source: ${String(source)})`;
  }

  if (environment !== prerequisite.requiredEnvironment) {
    return `wrong environment: evidence is ${String(environment)}, prerequisite requires ${prerequisite.requiredEnvironment}`;
  }

  const binding = bindingRejection(prerequisite, record, input);
  if (binding) return binding;

  return null;
}

/** Does this record describe the release candidate it claims to describe? */
function bindingRejection(
  prerequisite: Prerequisite,
  record: EvidenceRecord,
  input: ReleaseInput,
): string | null {
  const subject = record.subject ?? {};
  switch (prerequisite.binding) {
    case "none":
      return null;

    case "candidate-commit":
      if (subject.commit !== input.candidate.commit) {
        return `wrong commit: evidence covers ${String(subject.commit)}, candidate is ${input.candidate.commit}`;
      }
      return null;

    case "affected-refs": {
      /*
        An unknown reference set is not an empty one. If the inventory cannot be
        read, nobody knows which refs must be covered — and a claim of complete
        coverage then means nothing, however confident it sounds.
      */
      if (input.affectedRefs.length === 0) {
        return "the affected-ref set is unknown (no readable inventory), so coverage cannot be established";
      }
      const covered = subject.refs ?? [];
      const missing = input.affectedRefs.filter((ref) => !covered.includes(ref));
      if (missing.length > 0) {
        return `partial rewrite: ${missing.length} affected ref(s) are not covered (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`;
      }
      return null;
    }

    case "provider-set": {
      if (input.requiredProviders.length === 0) {
        return "the required provider set is unknown, so coverage cannot be established";
      }
      const covered = subject.providers ?? [];
      const missing = input.requiredProviders.filter((p) => !covered.includes(p));
      if (missing.length > 0) {
        return `incomplete provider set: ${missing.length} required provider(s) are not covered (${missing.join(", ")})`;
      }
      return null;
    }

    case "deployment":
      if (!input.candidate.productionDeployment) {
        return "no production deployment is declared for this candidate";
      }
      if (subject.deployment !== input.candidate.productionDeployment) {
        return `wrong deployment: evidence covers ${String(subject.deployment)}, candidate deploys to ${input.candidate.productionDeployment}`;
      }
      return null;

    default:
      return null;
  }
}

/**
 * The mandatory prerequisites, as the manifest the gate evaluates against.
 *
 * `A1`, `A2` and Question-D are `exemptible: false` because they are externally
 * blocked: no amount of repository work completes them, and a release that could
 * waive them by writing an exemption would be a release that waives them by
 * writing an exemption.
 */
export const RELEASE_PREREQUISITES: readonly Prerequisite[] = [
  {
    id: "A1_OTP_ISSUER_REVOCATION",
    requirement:
      "The exposed OTP credential is revoked at the issuer, evidenced by the issuer — not by a note in this repository.",
    mandatory: true,
    requiredEnvironment: "production",
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    binding: "none",
    exemptible: false,
  },
  {
    id: "A2_HISTORY_REWRITE",
    requirement:
      "The historical rewrite has been executed and verified across EVERY affected ref, not a subset.",
    mandatory: true,
    requiredEnvironment: "production",
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    binding: "affected-refs",
    exemptible: false,
  },
  {
    id: "CONVEX_PRODUCTION_DEPLOYMENT",
    requirement:
      "The production Convex deployment exists and was verified against the candidate commit.",
    mandatory: true,
    requiredEnvironment: "production",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    binding: "deployment",
    exemptible: false,
  },
  {
    id: "PRODUCTION_EMAIL_TRANSPORT",
    requirement:
      "A real production email transport delivered to a real mailbox from the production sender and issuer.",
    mandatory: true,
    requiredEnvironment: "production",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    binding: "none",
    exemptible: false,
  },
  {
    id: "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",
    requirement:
      "Every required provider answered in production, observed live — not from a fixture, a cache or a development run.",
    mandatory: true,
    requiredEnvironment: "production",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    binding: "provider-set",
    exemptible: false,
  },
];
