/**
 * Phase 249 — reconciling a live-ref rollover against the canonical A2 inventory.
 *
 * WHAT THIS IS
 * Pushing a session branch makes a new ref live on the remote. That ref either
 * carries the Phase 184 exposure or it does not, and the answer decides whether
 * the A2 rewrite scope grows. Until now the scope lived in three places that had
 * to be edited by hand in the same commit — the measured artifact
 * (`docs/secret-remediation-refs.json`), the canonical manifest
 * (`AFFECTED_REF_EXPECTATIONS`) and the runbook's two tables — and the guards
 * only failed *after* the edit was forgotten. This module turns "did the
 * rollover land consistently?" into a decision that can be evaluated, tested and
 * mutated, instead of a claim three documents make in parallel.
 *
 * THE THREE CONCERNS STAY SEPARATE (they are not interchangeable)
 *   1. INVENTORY        which refs exist            — the remote answers
 *   2. EXPOSURE         which carry the blob        — fingerprint tooling answers
 *   3. REWRITE COVERAGE which get rewritten         — the runbook claims, checked
 *                                                     against 1 and 2
 * A rollover is reconciled only when all three agree, and the agreement is
 * computed from the inputs given — never from a ref list written down here. A
 * second hardcoded list would be exactly the defect Phase 233 removed.
 *
 * WHAT RECONCILIATION IS NOT
 * Reconciling a nine-ref inventory is **not** remediating it. The scope grew
 * because a branch was pushed; the credential is still reachable from every one
 * of those refs, the carrier count is unchanged, and §2 of the runbook still
 * blocks §3. This module therefore reports `remediationPerformed`,
 * `rewriteExecuted` and `a2Verified` as constant `false` and refuses to derive
 * any of them from a successful reconciliation — an inventory that grew is a
 * larger job, not a finished one.
 *
 * PURITY
 * No filesystem, no network, no clock and no process: every input is injected, so
 * the refusal paths (a shallow measurement, an unmeasured live ref, a manifest
 * that silently dropped a ref) are testable without a repository. Reading the
 * real repository is the caller's job, through the existing read-only tooling
 * (`live-refs.ts`, `runbook-ref-facts.ts`, `scripts/secret-ref-inventory.mjs`).
 */

import { duplicateRefs, isMarkedExposedAtTip } from "./runbook-ref-facts";

/** A per-ref measurement, as the fingerprint generator produces it. */
export interface MeasuredRef {
  ref: string;
  /** The leaked blob is reachable somewhere in this ref's history. */
  affected: boolean;
  /** Commits in this ref's history whose tree holds the leaked blob. */
  carrierCommits: number;
  /** The ref's tip itself serves the blob. Worse than history-only, not better. */
  exposedAtTip: boolean;
}

/** Concern 2 — the measurement, and the conditions it was taken under. */
export interface RolloverMeasurement {
  /**
   * True when the clone the measurement ran in was shallow or grafted. A shallow
   * clone cannot answer "is the blob reachable from this tip": `rev-list` stops at
   * the graft, so a ref can look clean because the history that carries the blob
   * was never fetched. This is the Phase 181 defect, and it is refused rather than
   * reported as a small number.
   */
  shallow: boolean;
  /** False when the artifact does not exist. Never the same as "no refs". */
  present: boolean;
  fingerprint: string;
  blobPaths: readonly string[];
  historyCommits: number;
  carrierCommits: number;
  refs: readonly MeasuredRef[];
}

/** The canonical manifest's claim about the affected set. */
export interface RolloverManifestClaim {
  fingerprint: string;
  requiredBlobPaths: readonly string[];
  carrierCommits: number;
  refs: readonly { ref: string; carrierCommits: number; exposedAtTip: boolean }[];
}

/** Concern 3 — what the runbook says, parsed as data. */
export interface RolloverRunbookClaim {
  exposure: readonly { ref: string; tipStatus: string; occurrences: number | null }[];
  coverage: readonly { ref: string }[];
  /** The count the runbook's own summary states ("All nine"), or null if absent. */
  declaredCount: number | null;
}

export interface RolloverInput {
  /** Concern 1 — the refs the remote advertises, from `listLiveRefs()`. */
  liveRefs: readonly string[];
  measurement: RolloverMeasurement;
  manifest: RolloverManifestClaim;
  runbook: RolloverRunbookClaim;
}

/**
 * Refusal codes, and the state each reports. The map is closed and exported: a
 * code with no declared state is refused by `finish()` rather than silently
 * summarising as reconciled, which is how a new check would otherwise pass.
 */
export const ROLLOVER_CODE_STATES = {
  MEASUREMENT_SHALLOW: "MEASUREMENT_UNUSABLE",
  MEASUREMENT_ABSENT: "MEASUREMENT_UNUSABLE",
  INVENTORY_EMPTY: "MEASUREMENT_UNUSABLE",
  FINGERPRINT_MISMATCH: "MEASUREMENT_UNUSABLE",
  BLOB_PATH_MISSING: "MEASUREMENT_UNUSABLE",
  NO_LIVE_REFS: "MEASUREMENT_UNUSABLE",
  LIVE_REF_NOT_MEASURED: "INVENTORY_INCOMPLETE",
  MEASURED_REF_NOT_LIVE: "INVENTORY_STALE",
  MANIFEST_MISSING_AFFECTED_REF: "MANIFEST_SCOPE_MISMATCH",
  MANIFEST_EXTRA_REF: "MANIFEST_SCOPE_MISMATCH",
  MANIFEST_CARRIER_MISMATCH: "MANIFEST_FACT_MISMATCH",
  MANIFEST_TIP_MISMATCH: "MANIFEST_FACT_MISMATCH",
  MANIFEST_CARRIER_TOTAL_MISMATCH: "MANIFEST_FACT_MISMATCH",
  RUNBOOK_EXPOSURE_MISSING_REF: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_COVERAGE_MISSING_REF: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_DUPLICATE_ROW: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_DECLARED_COUNT_MISMATCH: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_DECLARED_COUNT_ABSENT: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_TIP_STATUS_CONTRADICTION: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_OCCURRENCE_CONTRADICTION: "RUNBOOK_CLAIM_MISMATCH",
  RUNBOOK_NAMES_DEAD_REF: "RUNBOOK_CLAIM_MISMATCH",
  UNAFFECTED_REF_IN_COVERAGE: "RUNBOOK_CLAIM_MISMATCH",
  UNMAPPED_REFUSAL_CODE: "MEASUREMENT_UNUSABLE",
} as const;

export type RolloverRefusalCode = keyof typeof ROLLOVER_CODE_STATES;

export type RolloverState =
  | "MEASUREMENT_UNUSABLE"
  | "INVENTORY_INCOMPLETE"
  | "INVENTORY_STALE"
  | "MANIFEST_SCOPE_MISMATCH"
  | "MANIFEST_FACT_MISMATCH"
  | "RUNBOOK_CLAIM_MISMATCH"
  | "ROLLOVER_RECONCILED";

/**
 * Worst first. A measurement that cannot be trusted outranks everything, because
 * every later comparison would be against a number that was never measured; an
 * unmeasured live ref outranks a stale one, because a ref nobody looked at may be
 * affected and would survive the rewrite, while a ref that no longer exists
 * cannot.
 */
export const ROLLOVER_STATE_PRECEDENCE: readonly RolloverState[] = [
  "MEASUREMENT_UNUSABLE",
  "INVENTORY_INCOMPLETE",
  "INVENTORY_STALE",
  "MANIFEST_SCOPE_MISMATCH",
  "MANIFEST_FACT_MISMATCH",
  "RUNBOOK_CLAIM_MISMATCH",
  "ROLLOVER_RECONCILED",
];

export interface RolloverRefusal {
  code: RolloverRefusalCode;
  state: RolloverState;
  reason: string;
}

export interface RolloverAssessment {
  state: RolloverState;
  /** True only when every concern agrees and the measurement was trustworthy. */
  reconciled: boolean;
  refusals: readonly RolloverRefusal[];
  /** Sorted, human-readable, deterministic. */
  problems: readonly string[];
  liveRefs: readonly string[];
  liveRefCount: number;
  /** The measured affected set — derived, never listed here. */
  affectedRefs: readonly string[];
  affectedRefCount: number;
  /** Refs whose tip serves the blob today. */
  exposedAtTipRefs: readonly string[];
  /** Refs the remote advertises that no layer accounts for. */
  unaccountedRefs: readonly string[];
  /** The measured facts, so a caller can quote them without re-deriving. */
  historyCommits: number;
  carrierCommits: number;
  fingerprint: string;
  /**
   * Phase E. Constant `false`, and not derivable from `reconciled`: agreeing
   * about the scope of the exposure is not removing it.
   */
  remediationPerformed: false;
  rewriteExecuted: false;
  a2Verified: false;
  /** True when the measurement was taken in a clone that could not answer it. */
  measurementTrustworthy: boolean;
}

/**
 * The state a refusal code reports.
 *
 * Exported because the fallback is load-bearing rather than decorative: a code
 * that is missing from `ROLLOVER_CODE_STATES` must resolve to the *worst* state,
 * never to `ROLLOVER_RECONCILED`. Without a seam to call it with an unmapped code,
 * that guarantee could be inverted and nothing would notice.
 */
export function rolloverStateForCode(code: string): RolloverState {
  return ROLLOVER_CODE_STATES[code as RolloverRefusalCode] ?? "MEASUREMENT_UNUSABLE";
}

const stateOf = rolloverStateForCode;

function worstState(codes: readonly string[]): RolloverState {
  for (const state of ROLLOVER_STATE_PRECEDENCE) {
    if (codes.some((code) => stateOf(code) === state)) return state;
  }
  return "MEASUREMENT_UNUSABLE";
}

const sorted = (values: readonly string[]): string[] => [...values].sort();
/** Delegates to the Phase 233 rule so "listed twice" means one thing repo-wide. */
const duplicates = (values: readonly string[]): string[] => sorted(duplicateRefs([...values]));

/**
 * A runbook tip cell claims the blob is served from the tip today. This delegates
 * to `runbook-ref-facts.isMarkedExposedAtTip` — the Phase 233 guard's own rule —
 * rather than restating its regex, so the two guards cannot drift apart.
 */
export function tipStatusSaysExposed(tipStatus: string): boolean {
  return isMarkedExposedAtTip({ ref: "", tipStatus, occurrences: null });
}

function finish(
  refusals: RolloverRefusal[],
  input: RolloverInput,
  affectedRefs: readonly string[],
  exposedAtTipRefs: readonly string[],
  unaccountedRefs: readonly string[],
  measurementTrustworthy: boolean,
): RolloverAssessment {
  const codes = refusals.map((entry) => entry.code);
  const unmapped = codes.filter((code) => !(code in ROLLOVER_CODE_STATES));
  if (unmapped.length > 0) {
    refusals.push({
      code: "UNMAPPED_REFUSAL_CODE",
      state: stateOf("UNMAPPED_REFUSAL_CODE"),
      reason: `refusal code(s) with no declared state: ${sorted([...new Set(unmapped)]).join(", ")}`,
    });
  }
  const allCodes = refusals.map((entry) => entry.code);
  const state = allCodes.length === 0 ? "ROLLOVER_RECONCILED" : worstState(allCodes);

  return {
    state,
    reconciled: state === "ROLLOVER_RECONCILED",
    refusals,
    problems: sorted(refusals.map((entry) => `${entry.code} — ${entry.reason}`)),
    liveRefs: sorted(input.liveRefs),
    liveRefCount: input.liveRefs.length,
    affectedRefs: sorted(affectedRefs),
    affectedRefCount: affectedRefs.length,
    exposedAtTipRefs: sorted(exposedAtTipRefs),
    unaccountedRefs: sorted(unaccountedRefs),
    historyCommits: input.measurement.historyCommits,
    carrierCommits: input.measurement.carrierCommits,
    fingerprint: input.measurement.fingerprint,
    // Phase E: these are properties of the world, not of this comparison. Nothing
    // a reconciliation can learn makes a rewrite have happened.
    remediationPerformed: false,
    rewriteExecuted: false,
    a2Verified: false,
    measurementTrustworthy,
  };
}

/**
 * Evaluate a rollover: do the live refs, the measurement, the canonical manifest
 * and the runbook's claims all describe the same set of affected refs, with the
 * same facts?
 *
 * Every check is a refusal with a name, so a failure says which layer drifted
 * rather than reporting a bare inequality.
 */
export function evaluateRefRollover(input: RolloverInput): RolloverAssessment {
  const refusals: RolloverRefusal[] = [];
  const refuse = (code: RolloverRefusalCode, reason: string) => {
    refusals.push({ code, state: stateOf(code), reason });
  };

  const { liveRefs, measurement, manifest, runbook } = input;

  /* ── concern 2 first: an untrustworthy measurement answers nothing ───────── */

  if (!measurement.present) {
    refuse(
      "MEASUREMENT_ABSENT",
      "no inventory artifact was measured; an absent artifact is not an empty ref set",
    );
  }
  if (measurement.shallow) {
    refuse(
      "MEASUREMENT_SHALLOW",
      "the measurement ran in a shallow or grafted clone, where reachability stops at the graft: " +
        "a ref can look unaffected because the history carrying the blob was never fetched",
    );
  }
  if (liveRefs.length === 0) {
    refuse("NO_LIVE_REFS", "the remote advertised no refs; emptiness is not cleanliness");
  }
  if (measurement.refs.length === 0) {
    refuse(
      "INVENTORY_EMPTY",
      "the measurement reported no refs while the leak is documented; refusing to imply a clean result",
    );
  }
  if (measurement.fingerprint !== manifest.fingerprint) {
    refuse(
      "FINGERPRINT_MISMATCH",
      `the measurement fingerprints ${measurement.fingerprint || "<none>"} but the canonical ` +
        `credential is ${manifest.fingerprint}: these are not the same exposure`,
    );
  }
  for (const path of manifest.requiredBlobPaths) {
    if (!measurement.blobPaths.includes(path)) {
      refuse(
        "BLOB_PATH_MISSING",
        `the measurement did not find the leaked blob at ${path}, which the manifest requires`,
      );
    }
  }

  const measuredByRef = new Map(measurement.refs.map((entry) => [entry.ref, entry]));
  const live = new Set(liveRefs);
  const measuredAffected = measurement.refs.filter((entry) => entry.affected).map((e) => e.ref);
  const measuredExposedAtTip = measurement.refs
    .filter((entry) => entry.exposedAtTip)
    .map((entry) => entry.ref);

  /* ── concern 1 vs 2: every live ref must have been measured ──────────────── */

  for (const ref of sorted(liveRefs)) {
    if (!measuredByRef.has(ref)) {
      refuse(
        "LIVE_REF_NOT_MEASURED",
        `the remote advertises ${ref} but the measurement has no row for it: an unmeasured ref ` +
          `may be affected and would survive the rewrite`,
      );
    }
  }
  for (const entry of measurement.refs) {
    if (!live.has(entry.ref)) {
      refuse(
        "MEASURED_REF_NOT_LIVE",
        `the measurement carries ${entry.ref}, which the remote no longer advertises: a stale row ` +
          `means the inventory was not re-run`,
      );
    }
  }

  /* ── concern 2 vs the manifest: same affected set, same facts ────────────── */

  const manifestRefs = new Set(manifest.refs.map((entry) => entry.ref));
  for (const ref of sorted(measuredAffected)) {
    if (!manifestRefs.has(ref)) {
      refuse(
        "MANIFEST_MISSING_AFFECTED_REF",
        `${ref} is measured affected (carriers=` +
          `${measuredByRef.get(ref)?.carrierCommits ?? 0}) but is absent from the canonical ` +
          `manifest: a rewrite scoped from the manifest would skip it`,
      );
    }
  }
  for (const entry of manifest.refs) {
    const measured = measuredByRef.get(entry.ref);
    if (!measured) {
      refuse(
        "MANIFEST_EXTRA_REF",
        `the manifest lists ${entry.ref}, which the measurement does not contain: an unrelated or ` +
          `retired ref must not be carried in the rewrite scope`,
      );
      continue;
    }
    if (!measured.affected) {
      refuse(
        "MANIFEST_EXTRA_REF",
        `the manifest lists ${entry.ref} as affected but the measurement found no carrier commit ` +
          `for it: classifying an unaffected ref as affected invents scope`,
      );
      continue;
    }
    if (measured.carrierCommits !== entry.carrierCommits) {
      refuse(
        "MANIFEST_CARRIER_MISMATCH",
        `${entry.ref}: the manifest declares ${entry.carrierCommits} carrier commits, the ` +
          `measurement found ${measured.carrierCommits}`,
      );
    }
    if (measured.exposedAtTip !== entry.exposedAtTip) {
      refuse(
        "MANIFEST_TIP_MISMATCH",
        `${entry.ref}: the manifest declares exposedAtTip=${String(entry.exposedAtTip)}, the ` +
          `measurement found ${String(measured.exposedAtTip)}`,
      );
    }
  }
  if (manifest.carrierCommits !== measurement.carrierCommits) {
    refuse(
      "MANIFEST_CARRIER_TOTAL_MISMATCH",
      `the manifest declares ${manifest.carrierCommits} carrier commits in total, the measurement ` +
        `found ${measurement.carrierCommits}: the exposure itself changed, which is not a rollover`,
    );
  }

  /* ── concern 3: the runbook's claims must match, not merely agree ────────── */

  const exposureByRef = new Map(runbook.exposure.map((row) => [row.ref, row]));
  const coverageRefs = new Set(runbook.coverage.map((row) => row.ref));

  for (const row of runbook.exposure) {
    if (!live.has(row.ref)) {
      refuse(
        "RUNBOOK_NAMES_DEAD_REF",
        `the runbook's exposure table names ${row.ref}, which the remote no longer advertises`,
      );
    }
  }
  for (const row of runbook.coverage) {
    if (!live.has(row.ref)) {
      refuse(
        "RUNBOOK_NAMES_DEAD_REF",
        `the runbook's rewrite coverage names ${row.ref}, which the remote no longer advertises`,
      );
    }
  }
  for (const dup of duplicates(runbook.exposure.map((row) => row.ref))) {
    refuse("RUNBOOK_DUPLICATE_ROW", `the exposure table lists ${dup} more than once`);
  }
  for (const dup of duplicates(runbook.coverage.map((row) => row.ref))) {
    refuse("RUNBOOK_DUPLICATE_ROW", `the rewrite coverage lists ${dup} more than once`);
  }

  for (const ref of sorted(liveRefs)) {
    if (!exposureByRef.has(ref)) {
      refuse("RUNBOOK_EXPOSURE_MISSING_REF", `the exposure table has no row for live ref ${ref}`);
    }
    const measured = measuredByRef.get(ref);
    if (measured?.affected && !coverageRefs.has(ref)) {
      refuse(
        "RUNBOOK_COVERAGE_MISSING_REF",
        `${ref} is measured affected but is absent from the rewrite coverage: a surviving ref ` +
          `keeps the blob reachable and undoes the exercise`,
      );
    }
  }
  for (const entry of measurement.refs) {
    if (!entry.affected && coverageRefs.has(entry.ref)) {
      refuse(
        "UNAFFECTED_REF_IN_COVERAGE",
        `${entry.ref} is measured unaffected but the runbook lists it for rewriting`,
      );
    }
  }

  if (runbook.declaredCount === null) {
    refuse(
      "RUNBOOK_DECLARED_COUNT_ABSENT",
      "the rewrite section no longer states how many refs it covers, so the summary cannot be checked",
    );
  } else if (runbook.declaredCount !== liveRefs.length) {
    refuse(
      "RUNBOOK_DECLARED_COUNT_MISMATCH",
      `the rewrite section says it covers ${runbook.declaredCount} ref(s) but the remote ` +
        `advertises ${liveRefs.length}`,
    );
  }

  for (const entry of measurement.refs) {
    const row = exposureByRef.get(entry.ref);
    if (!row) continue;
    if (entry.exposedAtTip !== tipStatusSaysExposed(row.tipStatus)) {
      refuse(
        "RUNBOOK_TIP_STATUS_CONTRADICTION",
        `${entry.ref}: measured exposedAtTip=${String(entry.exposedAtTip)} but the runbook says ` +
          `"${row.tipStatus}"`,
      );
    }
    const claimsAffected = (row.occurrences ?? 0) > 0 || tipStatusSaysExposed(row.tipStatus);
    if (entry.affected !== claimsAffected) {
      refuse(
        "RUNBOOK_OCCURRENCE_CONTRADICTION",
        `${entry.ref}: measured affected=${String(entry.affected)} (carriers=` +
          `${entry.carrierCommits}) but the runbook claims occurrences=${String(row.occurrences)}, ` +
          `tip="${row.tipStatus}"`,
      );
    }
    if (
      row.occurrences !== null &&
      entry.affected &&
      row.occurrences !== entry.carrierCommits
    ) {
      refuse(
        "RUNBOOK_OCCURRENCE_CONTRADICTION",
        `${entry.ref}: the runbook records ${row.occurrences} occurrences, the measurement found ` +
          `${entry.carrierCommits} carrier commits`,
      );
    }
  }

  /* A live ref nobody accounts for anywhere is named, not merely counted. */
  const unaccounted = liveRefs.filter(
    (ref) => !measuredByRef.has(ref) || !exposureByRef.has(ref) || !coverageRefs.has(ref),
  );

  return finish(
    refusals,
    input,
    measuredAffected,
    measuredExposedAtTip,
    unaccounted,
    measurement.present && !measurement.shallow && measurement.refs.length > 0,
  );
}

/**
 * The refs a rollover added: live now, and not in the manifest that predates it.
 * Reported separately so a reader can see exactly what grew, and so a test can
 * assert the growth is the one ref that was pushed rather than an accident.
 */
export function rolloverAddedRefs(
  liveRefs: readonly string[],
  priorManifestRefs: readonly string[],
): string[] {
  const prior = new Set(priorManifestRefs);
  return sorted(liveRefs.filter((ref) => !prior.has(ref)));
}

/** The refs a rollover removed. Must be empty: no affected ref may disappear. */
export function rolloverDroppedRefs(
  liveRefs: readonly string[],
  priorManifestRefs: readonly string[],
): string[] {
  const live = new Set(liveRefs);
  return sorted(priorManifestRefs.filter((ref) => !live.has(ref)));
}

/**
 * A deterministic digest of the reconciled scope, so two measurements of the same
 * repository state can be compared byte-for-byte and a report can quote a
 * fingerprint of the inventory itself. FNV-1a over canonical JSON — the same rule
 * `evidenceDigest` uses elsewhere in this repository, restated here only because
 * importing it would couple a pure decision module to the A2 rehearsal fixture.
 */
export function rolloverDigest(affectedRefs: readonly string[], carrierCommits: number): string {
  const text = JSON.stringify({ refs: sorted(affectedRefs), carrierCommits });
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/* ── the operator-facing report ───────────────────────────────────────────── */

/**
 * Render the reconciliation for a human. It states what was measured, what each
 * layer claims, and — always — that reconciling the scope is not remediating it.
 */
export function formatRolloverReport(assessment: RolloverAssessment): string {
  const lines: string[] = [];
  lines.push("── A2 live-ref rollover reconciliation ─────────────────────────────────");
  lines.push(`state: ${assessment.state}`);
  lines.push(`reconciled: ${assessment.reconciled ? "yes" : "no"}`);
  lines.push(
    `measurement trustworthy: ${assessment.measurementTrustworthy ? "yes" : "no"} ` +
      `(a shallow or absent measurement establishes nothing)`,
  );
  lines.push(`fingerprint: ${assessment.fingerprint}`);
  lines.push(
    `live refs advertised by the remote: ${assessment.liveRefCount}; ` +
      `measured affected: ${assessment.affectedRefCount}`,
  );
  lines.push(`reachable commits: ${assessment.historyCommits}; carrier commits: ${assessment.carrierCommits}`);
  lines.push(`digest of the affected scope: ${rolloverDigest(assessment.affectedRefs, assessment.carrierCommits)}`);
  lines.push("");
  lines.push("affected refs (measured, not listed by hand):");
  for (const ref of assessment.affectedRefs) {
    const tip = assessment.exposedAtTipRefs.includes(ref) ? "EXPOSED AT TIP" : "clean at tip";
    lines.push(`  ${ref} — ${tip}`);
  }
  if (assessment.unaccountedRefs.length > 0) {
    lines.push("");
    lines.push("refs no layer accounts for:");
    for (const ref of assessment.unaccountedRefs) lines.push(`  ${ref}`);
  }
  if (assessment.problems.length > 0) {
    lines.push("");
    lines.push("refusals:");
    for (const problem of assessment.problems) lines.push(`  ${problem}`);
  }
  lines.push("");
  lines.push("── what this result does not mean ──────────────────────────────────────");
  lines.push("  remediation performed: no");
  lines.push("  history rewritten:     no");
  lines.push("  A2 verified:           no");
  lines.push(
    "  A reconciled inventory is a correctly scoped job, not a finished one: every ref " +
      "above still carries the exposure, and the rotation gate still blocks the rewrite.",
  );
  return lines.join("\n");
}
