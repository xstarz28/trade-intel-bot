/**
 * Phase 244 — the canonical A1/A2 remediation manifest.
 *
 * WHAT THIS IS
 * One place where the facts an operator must not improvise are written down: the
 * repository identity, the credential fingerprint and its hash rule, the issuer
 * that can revoke it, every affected ref, and the evidence required before and
 * after each of the two operations. Nothing here executes anything, contacts
 * anything or writes a ref; the manifest is data, and the checkers in
 * `remediation-readiness.ts` and `remediation-postcheck.ts` read it.
 *
 * WHERE THE FACTS COME FROM
 * Every number below is quoted from a measurement that exists in this
 * repository, and `MEASUREMENT_RECONCILIATION` records the earlier figures that
 * were superseded, by whom, and why — so a reader can tell an outdated number
 * from a wrong one. The authoritative sources, in order:
 *
 *   1. `docs/secret-remediation-refs.json` — produced by
 *      `scripts/secret-ref-inventory.mjs`, which reads live refs from the remote
 *      and refuses to run in a shallow clone. It supersedes every hand-written
 *      table, because the hand-written tables have been wrong twice (Phase 233).
 *   2. `docs/SECRET-REMEDIATION-RUNBOOK.md` — the Phase 198/221 rehearsals and
 *      the Phase 233 re-measurement; the source of the pre/post assertions.
 *   3. `docs/SECURITY-REMEDIATION.md` — the Phase 184 measurement and its
 *      correction of the Phase 181 shallow-clone audit.
 *   4. `src/lib/deployment/release-gate.ts` — what counts as evidence for the
 *      release gate (A1: no binding; A2: bound to the affected-ref set; both
 *      mandatory, both non-exemptible, both 30-day freshness).
 *
 * WHAT IT DOES NOT CONTAIN
 * No credential value, and no timestamp that was not measured. The fingerprint
 * is a hash prefix; the dates are quoted from the artifacts above.
 */
import { RETIRED_ISSUER_HOSTS } from "@/convex/lib/issuerPolicy";

export interface RepositoryIdentity {
  canonical: string;
  remoteName: string;
  remoteUrl: string;
  expectedBranch: string;
  forbiddenBranches: readonly string[];
}

/** The one repository whose history may be rewritten. */
export const REMEDIATION_REPOSITORY: RepositoryIdentity = {
  canonical: "xstarz28/trade-intel-bot",
  remoteName: "origin",
  remoteUrl: "https://github.com/xstarz28/trade-intel-bot.git",
  /** The branch an operator must be on: never `main`, never a detached head. */
  expectedBranch: "arena/01a0adfb-trade-intel-bot",
  /** Branches that may never be the working context of a rewrite. */
  forbiddenBranches: ["main"],
};

/**
 * The exposed credential, identified the only way it may be identified: by
 * fingerprint. `thirdPartyEnvNames` are the names other repositories read the
 * same scaffold key from (Phase 222 audit); `retiredEnvNames` are the names this
 * repository used before Phase 185 retired them.
 */
export interface CredentialIdentity {
  name: string;
  kind: string;
  fingerprint: string;
  fingerprintRule: string;
  secretLength: number;
  path: string;
  blob: string;
  carrierCommits: number;
  retiredEnvNames: readonly string[];
  thirdPartyEnvNames: readonly string[];
}

export const EXPOSED_CREDENTIAL: CredentialIdentity = {
  name: "OTP email delivery API key",
  kind: "hardcoded `x-api-key` header on POST https://auth.freebuff.app/send_otp",
  fingerprint: "b1ce18a1e85ba121",
  fingerprintRule: 'sha256(value + "\\n")[0:16]',
  secretLength: 33,
  path: "src/convex/auth/emailOtp.ts",
  blob: "e490ffda66bb5d8fcd63df8d49f5f8822126cc7f",
  /** Unchanged across every measurement since Phase 198. */
  carrierCommits: 270,
  retiredEnvNames: ["OTP_EMAIL_API_KEY", "VLY_APP_NAME"],
  thirdPartyEnvNames: [
    "VLY_EMAIL_API_KEY",
    "FB_EMAIL_API_KEY",
    "FREEBUFF_EMAIL_API_KEY",
    "RESEND_API_KEY",
  ],
};

/**
 * The only party that can neutralise the credential. The Phase 222 audit found
 * no self-service revocation surface: no published API, no console, no
 * documented key-management endpoint. That is why A1 is a request to the issuer
 * operator, not a command an operator can run — and why the readiness checker
 * reports a missing external path rather than a missing step.
 */
export interface IssuerIdentity {
  identity: string;
  operator: string;
  selfServiceRevocation: string;
  retiredHosts: readonly string[];
  procedure: readonly string[];
}

export const A1_ISSUER: IssuerIdentity = {
  identity: "auth.freebuff.app",
  operator: "Freebuff Web (formerly Vly), the issuer backend",
  selfServiceRevocation: "absent (Phase 222 audit: no published API or console)",
  retiredHosts: RETIRED_ISSUER_HOSTS,
  /** What a human with issuer access must do, in order (runbook §2). */
  procedure: [
    "provision a replacement credential at the issuer",
    "configure it as a Convex environment variable (never in source)",
    "revoke the exposed credential",
    "observe an explicit authentication failure (401/403) presenting the old credential",
    "record the date, the operator and the observed response",
  ],
};

export interface RefExpectation {
  ref: string;
  carrierCommits: number;
  exposedAtTip: boolean;
}

/**
 * Every ref the remote advertises, as measured by the inventory generator. A
 * subset is not an option: one surviving ref keeps the blob reachable.
 */
export const AFFECTED_REF_EXPECTATIONS: readonly RefExpectation[] = [
  { ref: "heads/arena/01a08e67-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },
  { ref: "heads/arena/01a0a5f5-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },
  { ref: "heads/arena/01a0a92b-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },
  { ref: "heads/arena/01a0ad26-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },
  { ref: "heads/arena/01a0adfb-trade-intel-bot", carrierCommits: 269, exposedAtTip: false },
  { ref: "heads/main", carrierCommits: 261, exposedAtTip: true },
  { ref: "heads/phase-157-live-discovery-lifecycle", carrierCommits: 262, exposedAtTip: true },
  { ref: "tags/rc-181", carrierCommits: 269, exposedAtTip: false },
];

/** Refs whose tip serves the blob today — the two that must never be deployed. */
export const REFS_EXPOSED_AT_TIP: readonly string[] = AFFECTED_REF_EXPECTATIONS.filter(
  (entry) => entry.exposedAtTip,
).map((entry) => entry.ref);

export interface InventoryArtifactSpec {
  path: string;
  generator: string;
  maxAgeMs: number;
  requiredBlobPaths: readonly string[];
}

export const INVENTORY_ARTIFACT: InventoryArtifactSpec = {
  path: "docs/secret-remediation-refs.json",
  generator: "scripts/secret-ref-inventory.mjs",
  /**
   * A rewrite scoped from a stale inventory is a rewrite that misses refs. The
   * window is deliberately short: the generator is read-only and takes seconds.
   */
  maxAgeMs: 24 * 60 * 60 * 1000,
  requiredBlobPaths: ["src/convex/auth/emailOtp.ts"],
};

/** Tooling that produced the measurements the post-check consumes. */
export const VERIFICATION_TOOLING = {
  globalScanner: "scripts/verify-history-clean.mjs",
  perRefInventory: "scripts/secret-ref-inventory.mjs",
  rehearsal: "scripts/secret-rehearsal-verify.mjs",
};

/* ── evidence requirements ──────────────────────────────────────────────── */

export type RemediationPhase = "pre" | "post";

export type RemediationEvidenceSource =
  /** The issuer itself: the only source that can speak for A1's completion. */
  | "external-issuer"
  /** Independent tooling verification (the scanners, run as separate processes). */
  | "external-verification"
  /** This repository's own scripts, run locally. */
  | "local-tooling"
  /** A development run, a unit test, a local observation. */
  | "local-run"
  /** Prose: a runbook, a checklist, a filled-in record. */
  | "documentation"
  /** A synthetic record. Usable to exercise a checker, never to satisfy it. */
  | "fixture";

/** Sources that may never satisfy any requirement in this phase. */
export const NON_EVIDENCE_SOURCES: readonly RemediationEvidenceSource[] = ["fixture", "local-run"];

export interface RemediationEvidenceRequirement {
  id: string;
  phase: RemediationPhase;
  operation: "A1" | "A2";
  description: string;
  /** Sources that count for this requirement. */
  acceptableSources: readonly RemediationEvidenceSource[];
}

export const A1_REQUIREMENTS: readonly RemediationEvidenceRequirement[] = [
  {
    id: "a1-pre-credential-identity",
    phase: "pre",
    operation: "A1",
    description:
      "The credential under revocation is identified by fingerprint b1ce18a1e85ba121 and its hash rule; the value is never stored or printed.",
    acceptableSources: ["local-tooling", "external-issuer"],
  },
  {
    id: "a1-pre-live-status",
    phase: "pre",
    operation: "A1",
    description:
      "The credential's status at the issuer is observed externally before revocation, so the after-state can be compared with a before-state.",
    acceptableSources: ["external-issuer"],
  },
  {
    id: "a1-pre-replacement-provisioned",
    phase: "pre",
    operation: "A1",
    description:
      "A replacement credential exists at the issuer and is configured outside source control (runbook §2 steps 1-2).",
    acceptableSources: ["external-issuer", "local-tooling"],
  },
  {
    id: "a1-post-issuer-confirmation",
    phase: "post",
    operation: "A1",
    description:
      "The issuer confirms the revocation, as authoritative external evidence — not a note in this repository.",
    acceptableSources: ["external-issuer"],
  },
  {
    id: "a1-post-credential-rejected",
    phase: "post",
    operation: "A1",
    description:
      "Presenting the old credential produces an explicit authentication failure (401/403). A timeout, a 000 or an unrelated 200 is not proof.",
    acceptableSources: ["external-issuer"],
  },
  {
    id: "a1-post-correct-credential",
    phase: "post",
    operation: "A1",
    description:
      "The evidence identifies the same fingerprint, so a different credential's revocation cannot be reported as this one's.",
    acceptableSources: ["external-issuer", "local-tooling"],
  },
  {
    id: "a1-post-bound-and-fresh",
    phase: "post",
    operation: "A1",
    description:
      "The evidence is bound to auth.freebuff.app in the production environment and is within the release gate's freshness window.",
    acceptableSources: ["external-issuer"],
  },
];

export const A2_REQUIREMENTS: readonly RemediationEvidenceRequirement[] = [
  {
    id: "a2-pre-inventory",
    phase: "pre",
    operation: "A2",
    description:
      "A generator-produced inventory of the full history covers every affected ref, produced in a non-shallow clone, within the execution window.",
    acceptableSources: ["local-tooling", "external-verification"],
  },
  {
    id: "a2-pre-candidate",
    phase: "pre",
    operation: "A2",
    description:
      "The candidate commit and branch that must survive the rewrite are recorded before the rewrite happens.",
    acceptableSources: ["local-tooling", "external-verification"],
  },
  {
    id: "a2-pre-backup",
    phase: "pre",
    operation: "A2",
    description:
      "A rollback path exists: a disposable full mirror, its identity and the ref tips it holds, recorded before the rewrite.",
    acceptableSources: ["local-tooling", "external-verification"],
  },
  {
    id: "a2-pre-rehearsal",
    phase: "pre",
    operation: "A2",
    description:
      "A rehearsal covering EVERY affected ref has been performed. The Phase 221 rehearsal covered five refs; three have never been rehearsed.",
    acceptableSources: ["local-tooling", "external-verification"],
  },
  {
    id: "a2-post-zero-occurrences",
    phase: "post",
    operation: "A2",
    description:
      "The fingerprint appears zero times in every blob reachable from every ref, measured by the scanner with its positive control.",
    acceptableSources: ["external-verification", "local-tooling"],
  },
  {
    id: "a2-post-per-ref-verification",
    phase: "post",
    operation: "A2",
    description:
      "Every manifest ref is re-measured after the rewrite, none missing, none unexpected, and no carrier commit remains reachable.",
    acceptableSources: ["external-verification", "local-tooling"],
  },
  {
    id: "a2-post-history-consistency",
    phase: "post",
    operation: "A2",
    description:
      "Commit counts, author/date/subject metadata and parent topology are unchanged, and the candidate branch's tree is byte-identical.",
    acceptableSources: ["external-verification", "local-tooling"],
  },
];

export const A1_EVIDENCE_REQUIREMENTS: readonly RemediationEvidenceRequirement[] = [
  ...A1_REQUIREMENTS.filter((entry) => entry.phase === "pre"),
  ...A1_REQUIREMENTS.filter((entry) => entry.phase === "post"),
];
export const A2_EVIDENCE_REQUIREMENTS: readonly RemediationEvidenceRequirement[] = [
  ...A2_REQUIREMENTS.filter((entry) => entry.phase === "pre"),
  ...A2_REQUIREMENTS.filter((entry) => entry.phase === "post"),
];

/* ── the two-phase safety model ─────────────────────────────────────────── */

/**
 * The order an operator must follow. Nothing in this repository chains one stage
 * into the next: the destructive stage is external and requires an explicit
 * operator action, and every function here is pure, so it can advance a state
 * and cannot perform an operation.
 */
export const REMEDIATION_STAGES = [
  "PRECHECK",
  "CAPTURE_EVIDENCE",
  "EXPLICIT_OPERATOR_ACTION",
  "POSTCHECK",
  "RELEASE_GATE_REEVALUATION",
] as const;
export type RemediationStage = (typeof REMEDIATION_STAGES)[number];

/** Stages that mutate something outside this repository. */
export const EXTERNAL_STAGES: readonly RemediationStage[] = ["EXPLICIT_OPERATOR_ACTION"];

export interface StageAdvance {
  stage: RemediationStage;
  advanced: boolean;
  /** True when this stage is performed outside the tooling, by a human. */
  external: boolean;
  reason: string;
}

/**
 * Advance one stage at a time. Skipping is refused; entering the external stage
 * requires an explicit operator confirmation, which this function only records —
 * it cannot act on it.
 */
export function advanceRemediationStage(
  current: RemediationStage,
  to: RemediationStage,
  options: { operatorConfirmation?: boolean } = {},
): StageAdvance {
  const from = REMEDIATION_STAGES.indexOf(current);
  const target = REMEDIATION_STAGES.indexOf(to);
  const external = EXTERNAL_STAGES.includes(to);

  if (from < 0 || target < 0) {
    return { stage: current, advanced: false, external, reason: "unknown stage" };
  }
  if (target !== from + 1) {
    return {
      stage: current,
      advanced: false,
      external,
      reason:
        target <= from
          ? "the remediation workflow only moves forward"
          : "stages may not be skipped: each one is a precondition of the next",
    };
  }
  if (external && options.operatorConfirmation !== true) {
    return {
      stage: to,
      advanced: false,
      external: true,
      reason:
        "the external operation is not performed by this tooling; it requires an explicit operator action",
    };
  }
  return {
    stage: to,
    advanced: true,
    external,
    reason: external
      ? "operator action acknowledged; the operation itself happens outside this repository"
      : "stage reached; no external operation is implied",
  };
}

/* ── reconciliation of superseded measurements ──────────────────────────── */

export interface ReconciledMeasurement {
  fact: string;
  superseded: string;
  authoritative: string;
  /** Which tooling produced the authoritative value. */
  measuredBy: string;
  reason: string;
}

/**
 * Where records disagree, this is the ruling and its reason. Nothing here
 * silently replaces an old fact: the superseded value stays visible, with the
 * measurement that produced it, so the correction itself is auditable.
 */
export const MEASUREMENT_RECONCILIATION: readonly ReconciledMeasurement[] = [
  {
    fact: "affected commits",
    superseded: "9 (Phase 181 audit)",
    authoritative: "270 (Phase 184, unchanged through Phase 233 and the current inventory)",
    measuredBy: "scripts/verify-history-clean.mjs",
    reason:
      "the Phase 181 audit ran in a shallow clone grafted at 51c9dde, so rev-list --all could see one commit; after `git fetch --unshallow` the same matcher found 270. A rewrite scoped from the shallow figure would have left most carriers in place",
  },
  {
    fact: "reachable commits",
    superseded: "306 (Phase 184) / 339 (Phase 198) / 365 (Phase 221 rehearsal) / 397 (Phase 233)",
    authoritative: "398 (docs/secret-remediation-refs.json, generator-produced)",
    measuredBy: "scripts/secret-ref-inventory.mjs",
    reason:
      "the repository grows, so this figure is a timestamp, not a contradiction; the current artifact is the newest measurement and the carrier count has been 270 in every one of them, which is the evidence that the exposure itself has not changed",
  },
  {
    fact: "affected refs",
    superseded:
      "4 (Phase 198) -> 5 (Phase 221) -> 7 (Phase 233, which added 01a0a92b and 01a0ad26 after they had appeared in neither table)",
    authoritative: "8 (docs/secret-remediation-refs.json)",
    measuredBy: "scripts/secret-ref-inventory.mjs",
    reason:
      "the generator reads the live refs from the remote instead of a hand-maintained list, so its output supersedes every table; the eighth row (01a0adfb) was added in Phase 238 and is the one row recorded as derived rather than re-measured end-to-end",
  },
  {
    fact: "exposed-ref tips",
    superseded: "the credential is gone from current source, so the refs are safe",
    authoritative: "heads/main and heads/phase-157-live-discovery-lifecycle serve the blob at their tips",
    measuredBy: "scripts/secret-ref-inventory.mjs",
    reason:
      "removal from HEAD is not remediation: `affected` and `exposedAtTip` are two different facts, and conflating them is the mistake the per-ref inventory was written to end",
  },
];

/* ── injected observations (the checkers never read the machine) ─────────── */

export interface RepositoryObservation {
  /** A label for the report; the identity checks use the fields below. */
  workdir: string;
  branch: string;
  head: string;
  remoteName: string;
  remoteUrl: string;
  /** True when the clone is shallow: a per-ref scope cannot be measured in it. */
  shallow: boolean;
  worktreeClean: boolean;
  historyCommitCount: number;
}

export interface InventoryRefLike {
  ref: string;
  affected: boolean;
  carrierCommits: number;
  exposedAtTip: boolean;
}

/** The generator's artifact, parsed. `present: false` is never "no refs". */
export interface InventoryArtifactLike {
  present: boolean;
  generatedBy: string;
  verifiedAt: number | null;
  fingerprint: string;
  blobPaths: readonly string[];
  historyCommits: number;
  carrierCommits: number;
  refs: readonly InventoryRefLike[];
}

export interface RemediationEvidenceRecord {
  requirementId: string;
  source: RemediationEvidenceSource;
  observedAt: number;
  /** True only for synthetic records: usable to exercise a checker, never to satisfy it. */
  fixture?: boolean;
  subject?: {
    issuer?: string;
    fingerprint?: string;
    refs?: readonly string[];
    commit?: string;
    environment?: string;
  };
  observation?: {
    /** HTTP status observed when presenting the credential; 0 or null = no response. */
    rejectionStatus?: number | null;
    endpoint?: string;
  };
  detail?: string;
}

export interface RemediationManifest {
  repository: RepositoryIdentity;
  credential: CredentialIdentity;
  issuer: IssuerIdentity;
  affectedRefs: readonly RefExpectation[];
  inventory: InventoryArtifactSpec;
  a1Requirements: readonly RemediationEvidenceRequirement[];
  a2Requirements: readonly RemediationEvidenceRequirement[];
  reconciliation: readonly ReconciledMeasurement[];
}

/** The canonical manifest. One object, used by every checker and test. */
export const REMEDIATION_MANIFEST: RemediationManifest = {
  repository: REMEDIATION_REPOSITORY,
  credential: EXPOSED_CREDENTIAL,
  issuer: A1_ISSUER,
  affectedRefs: AFFECTED_REF_EXPECTATIONS,
  inventory: INVENTORY_ARTIFACT,
  a1Requirements: A1_EVIDENCE_REQUIREMENTS,
  a2Requirements: A2_EVIDENCE_REQUIREMENTS,
  reconciliation: MEASUREMENT_RECONCILIATION,
};

export const AFFECTED_REF_NAMES: readonly string[] = AFFECTED_REF_EXPECTATIONS.map(
  (entry) => entry.ref,
);

/* ── repository identity ─────────────────────────────────────────────────── */

/**
 * Repository identity is **host + owner/repo**, not a string. `git remote add
 * origin` records whatever URL it was handed: GitHub serves the same repository
 * with and without a `.git` suffix and over SSH as well as HTTPS, and a CI runner
 * writes its own credentialed URL. All of those are the same repository; another
 * host, owner or path is a different one, and anything unparsable is not an
 * identity at all — which is why the comparison fails closed.
 */
export function repositoryIdentity(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  // `.match`, not `.exec`: the safety suite refuses a call-shaped `exec(` in these
  // modules outright, and a regex that merely looks like a spawner is not worth an
  // exemption from that guard.
  const withScheme = trimmed.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
  const scpLike = trimmed.match(/^[^@/:]+@([^/:]+):([^:]+)$/);
  const match = withScheme ?? scpLike;
  if (!match) return null;
  const host = match[1].toLowerCase();
  const path = match[2]
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!host || !path) return null;
  return `${host}/${path}`;
}

/** True only when both values name the same host and the same owner/repo. */
export function sameRepository(left: string, right: string): boolean {
  const one = repositoryIdentity(left);
  const other = repositoryIdentity(right);
  return one !== null && other !== null && one === other;
}

/**
 * Structural validation. A manifest that is missing a fingerprint, an issuer, a
 * repository identity or any ref is not a partial manifest — it is one that
 * cannot scope a remediation, and every checker fails closed on it.
 */
export function manifestProblems(manifest: RemediationManifest): string[] {
  const problems: string[] = [];
  if (!manifest.repository.canonical.includes("/")) problems.push("repository identity missing");
  if (!/^https:\/\//.test(manifest.repository.remoteUrl)) problems.push("remote URL is not https");
  if (!manifest.repository.expectedBranch) problems.push("expected branch missing");
  if (manifest.repository.expectedBranch === "main")
    problems.push("the expected branch may never be main");
  if (!/^[0-9a-f]{16}$/.test(manifest.credential.fingerprint))
    problems.push("credential fingerprint is not a 16-character hex prefix");
  if (!manifest.credential.fingerprintRule.includes("sha256"))
    problems.push("fingerprint rule missing");
  if (!manifest.credential.path) problems.push("leaked path missing");
  if (!manifest.issuer.identity.includes(".")) problems.push("issuer identity missing");
  if (manifest.affectedRefs.length === 0)
    problems.push("affected ref set is empty: an empty set is not 'nothing to rewrite'");
  if (manifest.affectedRefs.some((entry) => entry.carrierCommits <= 0))
    problems.push("an affected ref declares no carrier commits");
  if (manifest.affectedRefs.some((entry) => !entry.ref.includes("/")))
    problems.push("an affected ref is not a qualified ref name");
  if (new Set(manifest.affectedRefs.map((entry) => entry.ref)).size !== manifest.affectedRefs.length)
    problems.push("the affected ref set contains duplicates");
  if (!manifest.inventory.path.endsWith(".json")) problems.push("inventory artifact is not JSON");
  if (manifest.inventory.generator.length === 0) problems.push("inventory generator missing");
  const postA1 = manifest.a1Requirements.filter((entry) => entry.phase === "post");
  const preA1 = manifest.a1Requirements.filter((entry) => entry.phase === "pre");
  if (preA1.length === 0 || postA1.length === 0)
    problems.push("A1 must define both pre- and post-revocation evidence");
  if (!postA1.some((entry) => entry.id === "a1-post-credential-rejected"))
    problems.push("A1 must require an observed credential rejection after revocation");
  const postA2 = manifest.a2Requirements.filter((entry) => entry.phase === "post");
  if (postA2.length === 0) problems.push("A2 must define post-rewrite verification");
  if (!manifest.a2Requirements.some((entry) => entry.id === "a2-pre-backup"))
    problems.push("A2 must require rollback evidence before the rewrite");
  return problems;
}
