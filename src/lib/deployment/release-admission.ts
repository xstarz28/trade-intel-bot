/**
 * Phase 242 — the one release-admission operation.
 *
 * Phase 241 built an evaluator; this file is the entry point that release paths
 * call, so that "may this ship?" has exactly one answer in the codebase. Three
 * properties are the whole point of the module:
 *
 * 1. **No second opinion.** It does not re-evaluate records, re-implement
 *    freshness, or keep its own blocker list. It asks the Phase 241 machinery
 *    what the state is and *projects* the answer: mandatory prerequisites that
 *    are not VERIFIED are the blockers, verbatim from the canonical outcomes.
 *    A duplicate aggregation is how two release checks start disagreeing.
 * 2. **Fail closed.** `admitted` is a conjunction that requires the canonical
 *    `READY` verdict, no evaluation error, at least one mandatory prerequisite,
 *    every mandatory prerequisite VERIFIED, and an empty blocker projection. If
 *    anything throws, the result is a refusal that names the error. There is no
 *    code path that admits on missing, unknown, stale, blocked, contradictory,
 *    documentation-only, CI-only or local-only evidence — and no exported
 *    function that grants admission by argument or by force.
 * 3. **It identifies what it judged.** The result carries the candidate commit,
 *    ref and environment, so a verdict can never be quoted for one artifact and
 *    applied to another.
 *
 * It deliberately does **not** deploy, publish, promote or mutate anything. A
 * gate that can perform the action it gates is not a gate.
 */
import {
  deriveCurrentReleaseState,
  type CurrentReleaseFacts,
  type DerivationOptions,
  type FactSource,
} from "./release-current-state";
import type { PrerequisiteOutcome, PrerequisiteState } from "./release-gate";

/** The environment an admission decision is about. Releases are production. */
export const ADMISSION_ENVIRONMENT = "production" as const;

/** The identity of the thing being admitted. Quoting a verdict is meaningless without it. */
export interface ReleaseCandidateIdentity {
  commit: string;
  ref: string;
  environment: typeof ADMISSION_ENVIRONMENT;
  /** The declared production deployment, or `null` when the candidate declares none. */
  deployment: string | null;
}

/** A mandatory prerequisite that is not VERIFIED, projected from the canonical outcome. */
export interface ReleaseAdmissionBlocker {
  id: string;
  requirement: string;
  state: PrerequisiteState;
  reasons: readonly string[];
}

export interface ReleaseAdmission {
  /** True only when every mandatory prerequisite is explicitly VERIFIED. */
  admitted: boolean;
  verdict: "READY" | "NOT READY";
  candidate: ReleaseCandidateIdentity;
  /** The reason admission was refused, in the order an operator should fix them. */
  blockers: readonly ReleaseAdmissionBlocker[];
  /** The canonical per-prerequisite outcomes, unedited. */
  prerequisites: readonly PrerequisiteOutcome[];
  /** What the repository could prove. `null` only when evaluation itself failed. */
  facts: CurrentReleaseFacts | null;
  /** Human-readable lines, including the sentence that this admits and does not deploy. */
  diagnostics: readonly string[];
  /** Present when evaluation failed. A failure is never an admission. */
  evaluationError?: string;
}

export interface ReleaseAdmissionRequest {
  /** Injectable evidence source; defaults to reading this checkout. */
  source?: FactSource;
  /** Evaluation instant. Defaults to the real clock. */
  now?: number;
  /** The commit under consideration. Defaults to the worktree sentinel. */
  commit?: string;
  /** The ref under consideration. Defaults to the tracked branch. */
  ref?: string;
  /**
   * The production deployment this admission is about. Omitted means the
   * candidate declares none — the state of this repository — and the gate then
   * refuses deployment evidence instead of accepting an unnamed proof. Naming a
   * deployment cannot satisfy anything on its own: the evidence must still be an
   * external production verification bound to exactly that deployment id.
   */
  productionDeployment?: string;
}

const NOT_ADMITTED = "NOT ADMITTED";

/**
 * Which candidate an admission is about.
 *
 * On a runner the release is a specific commit, so the CI identity wins when it
 * exists; locally the answer is the worktree sentinel the reader already binds
 * proofs to. The environment arrives as a PARAMETER, never as an implicit read:
 * the release entry point supplies it, so this module stays free of environment
 * access — the client-hygiene guard scans `src/lib` for exactly that — and can be
 * imported by a UI bundle without pulling configuration into it.
 */
export function resolveCandidateIdentity(
  request: Pick<ReleaseAdmissionRequest, "commit" | "ref"> = {},
  env: NodeJS.ProcessEnv,
): { commit?: string; ref?: string } {
  const pick = (...values: (string | undefined)[]) => {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  };
  return {
    commit: pick(request.commit, env.RELEASE_CANDIDATE_COMMIT, env.GITHUB_SHA),
    ref: pick(request.ref, env.RELEASE_CANDIDATE_REF, env.GITHUB_REF_NAME),
  };
}

/** Projection, not aggregation: the blockers ARE the canonical outcomes. */
function projectBlockers(outcomes: readonly PrerequisiteOutcome[]): ReleaseAdmissionBlocker[] {
  return outcomes
    .filter((outcome) => outcome.mandatory && outcome.state !== "VERIFIED")
    .map((outcome) => ({
      id: outcome.id,
      requirement: outcome.requirement,
      state: outcome.state,
      reasons: [...outcome.reasons],
    }));
}

/**
 * Decide whether the release may be admitted.
 *
 * Never throws: an internal failure is returned as a refusal carrying
 * `evaluationError`, because a gate that disappears when it breaks is a gate
 * that can be broken on purpose.
 */
export function evaluateReleaseAdmission(request: ReleaseAdmissionRequest = {}): ReleaseAdmission {
  /*
    The candidate comes from the REQUEST and nowhere else. This module reads no
    environment: not because an environment variable is secret, but because a
    release decision that silently changes with the machine it runs on is not a
    decision. The entry point resolves its own identity (a tag's commit, a CI
    sha) and passes it in — which is also what makes "would THIS commit be
    admitted?" a question with an answer.
  */
  const overrides: DerivationOptions = {
    commit: request.commit?.trim() || undefined,
    ref: request.ref?.trim() || undefined,
  };
  const declaredDeployment = request.productionDeployment?.trim() || undefined;
  try {
    const state = deriveCurrentReleaseState(request.source, {
      now: request.now,
      commit: overrides.commit,
      ref: overrides.ref,
      productionDeployment: declaredDeployment,
    });
    const outcomes = state.verdict.prerequisites;
    const mandatory = outcomes.filter((outcome) => outcome.mandatory);
    const blockers = projectBlockers(outcomes);
    const allMandatoryVerified =
      mandatory.length > 0 && mandatory.every((outcome) => outcome.state === "VERIFIED");
    const admitted =
      state.verdict.ready &&
      state.verdict.verdict === "READY" &&
      state.verdict.evaluationError === undefined &&
      blockers.length === 0 &&
      allMandatoryVerified;

    const candidate: ReleaseCandidateIdentity = {
      commit: state.input.candidate.commit,
      ref: state.input.candidate.ref,
      environment: ADMISSION_ENVIRONMENT,
      deployment: state.input.candidate.productionDeployment ?? null,
    };

    const diagnostics: string[] = [
      `candidate ${candidate.commit} @ ${candidate.ref} (${candidate.environment})`,
      `canonical verdict: ${state.verdict.verdict}`,
      `mandatory prerequisites: ${mandatory.length}; verified: ${mandatory.length - blockers.length}`,
    ];
    for (const blocker of blockers) {
      diagnostics.push(
        `blocker ${blocker.id} [${blocker.state}]: ${blocker.reasons.join("; ") || "no reason recorded"}`,
      );
    }
    if (admitted) {
      diagnostics.push("every mandatory prerequisite is explicitly VERIFIED");
    } else {
      diagnostics.push(
        `${NOT_ADMITTED}: ${blockers.length} mandatory prerequisite(s) are not VERIFIED`,
      );
    }
    diagnostics.push("this decision admits or refuses a release; it deploys nothing");

    return {
      admitted,
      verdict: state.verdict.verdict,
      candidate,
      blockers,
      prerequisites: outcomes,
      facts: state.facts,
      diagnostics,
    };
  } catch (error) {
    return {
      admitted: false,
      verdict: "NOT READY",
      candidate: {
        commit: overrides.commit ?? "WORKTREE",
        ref: overrides.ref ?? "WORKTREE",
        environment: ADMISSION_ENVIRONMENT,
        deployment: declaredDeployment ?? null,
      },
      blockers: [],
      prerequisites: [],
      facts: null,
      diagnostics: [
        `${NOT_ADMITTED}: release admission could not be evaluated`,
        "a failure to evaluate is a refusal, not a pass",
      ],
      evaluationError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 0 admitted, 1 refused after evaluation, 2 the evaluation itself failed. */
export function releaseAdmissionExitCode(admission: ReleaseAdmission): 0 | 1 | 2 {
  if (admission.admitted) return 0;
  return admission.evaluationError === undefined ? 1 : 2;
}

/**
 * The report a human or a CI step summary reads. Every field comes from the
 * admission it is handed: this function contains no verdict of its own and
 * cannot disagree with the gate, because it does not know anything the gate did
 * not tell it.
 */
export function formatReleaseAdmissionReport(admission: ReleaseAdmission): string {
  const lines = [
    "RELEASE ADMISSION",
    `admitted: ${admission.admitted ? "yes" : "no"}`,
    `verdict: ${admission.verdict}`,
    `candidate: ${admission.candidate.commit} @ ${admission.candidate.ref} (${admission.candidate.environment}, deployment ${admission.candidate.deployment ?? "none declared"})`,
  ];
  if (admission.evaluationError) {
    lines.push(`evaluation error: ${admission.evaluationError}`);
  }
  lines.push("", "prerequisites:");
  for (const outcome of admission.prerequisites) {
    lines.push(
      `  ${outcome.id}: ${outcome.state}${outcome.mandatory ? "" : " (non-mandatory)"} — ${outcome.reasons.join("; ") || "no reason recorded"}`,
    );
  }
  lines.push("", "diagnostics:");
  for (const line of admission.diagnostics) lines.push(`  ${line}`);
  lines.push("", "blockers:");
  if (admission.blockers.length === 0) {
    lines.push("  none");
  }
  for (const blocker of admission.blockers) {
    lines.push(`  ${blocker.id} [${blocker.state}] ${blocker.requirement}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The machine-readable form, for CI annotations and future consumers. */
export function releaseAdmissionJson(admission: ReleaseAdmission): string {
  return `${JSON.stringify(
    {
      admitted: admission.admitted,
      verdict: admission.verdict,
      candidate: admission.candidate,
      blockers: admission.blockers.map((blocker) => ({
        id: blocker.id,
        state: blocker.state,
        reasons: blocker.reasons,
      })),
      prerequisites: admission.prerequisites.map((outcome) => ({
        id: outcome.id,
        state: outcome.state,
        mandatory: outcome.mandatory,
      })),
      evaluationError: admission.evaluationError ?? null,
    },
    null,
    2,
  )}\n`;
}
