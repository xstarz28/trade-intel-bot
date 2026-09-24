#!/usr/bin/env node
/**
 * Phase 247 — the Evidence D operator command.
 *
 *   npm run evidence:d:verify -- --package docs/remediation/evidence-d-production.json
 *   npm run evidence:d:verify -- --package <path> --json
 *   npm run evidence:d:verify -- --template            # a skeleton to fill in
 *
 * WHAT IT DOES
 *
 * It reads ONE evidence package from disk, hands it to the canonical Phase 247
 * validator, and prints what the release gate would read. It then simulates the
 * gate ONCE in memory with that package filed, so the operator can see the
 * blockers that would remain — including the ones this package cannot clear.
 *
 * WHAT IT CANNOT DO
 *
 *   - It never contacts a provider. There is no network module in this file or in
 *     the module it calls.
 *   - It never reads a credential: the package may not contain one, `process.env`
 *     is never touched, and the printer only ever writes fields the validator
 *     produced.
 *   - It never writes. `node:fs` is used for `readFileSync` and `existsSync` and
 *     nothing else; no package is created, moved or persisted.
 *   - It never runs git, never deploys, never sends mail and never changes a
 *     provider credential.
 *   - It never decides a release. It CALLS the canonical Phase 242 admission
 *     operation; a second aggregation is how two release checks start
 *     disagreeing.
 *
 * EXIT CODES
 *
 *   0  the package is admissible for evaluation (EVIDENCE_D_COMPLETE) — still not
 *      a release decision
 *   1  a blocker remains; the state and every refusal are printed
 *   2  the command could not produce a report (usage, missing file, bad JSON)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import module from "node:module";

/**
 * The decision modules use extensionless relative imports and the project's "@/"
 * alias, which is what the bundler expects and not what Node's ESM resolver does.
 * This hook resolves both, so the REAL modules load unmodified.
 */
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const aliased = resolve(process.cwd(), "src", specifier.slice(2));
      for (const candidate of [aliased, `${aliased}.ts`, `${aliased}/index.ts`]) {
        try {
          readFileSync(candidate);
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          /* try the next form */
        }
      }
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const here = (relative) => pathToFileURL(resolve(process.cwd(), relative)).href;

const {
  EVIDENCE_D_MAX_AGE_MS,
  EVIDENCE_D_SCHEMA,
  REQUIRED_PROVIDER_IDS,
  buildEvidenceDOperatorHandoff,
  evaluateEvidenceDPackage,
  evidenceDHandoffExitCode,
  formatEvidenceDOperatorHandoff,
  toGateEvidenceRecord,
  DOCUMENTED_PROVIDER_HOSTS,
} = await import(here("src/lib/deployment/evidence-d-verification.ts"));
const { evaluateReleaseAdmission } = await import(here("src/lib/deployment/release-admission.ts"));
const { DEFAULT_CANDIDATE, PROOF_PATHS, deriveCurrentReleaseState } = await import(
  here("src/lib/deployment/release-current-state.ts")
);

/* ── arguments ──────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "usage: npm run evidence:d:verify -- --package <path> [--json] [--now <ms>] [--candidate <commit>] [--ref <ref>]",
      "       npm run evidence:d:verify -- --status [--json]",
      "       npm run evidence:d:verify -- --template",
      "",
      "Reads one Evidence D package and reports what the release gate would read.",
      "It never contacts a provider, never reads a credential and never writes.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const templateMode = argv.includes("--template");
const asJson = argv.includes("--json");
/** Flags that consume the next argument, so it is not mistaken for a path. */
const VALUE_FLAGS = new Set(["--package", "--now", "--candidate", "--ref"]);
const positionals = [];
for (let index = 0; index < argv.length; index += 1) {
  const entry = argv[index];
  if (VALUE_FLAGS.has(entry)) {
    index += 1;
    continue;
  }
  if (!entry.startsWith("--")) positionals.push(entry);
}
const packagePath = flag("--package", positionals[0] ?? null);

const nowArg = flag("--now", null);
const now = nowArg === null ? Date.now() : Number(nowArg);
if (!Number.isFinite(now)) {
  process.stderr.write(`evidence-d: --now must be a finite instant in milliseconds, got ${String(nowArg)}\n`);
  process.exit(2);
}
const candidateCommit = flag("--candidate", DEFAULT_CANDIDATE.commit);
const candidateRef = flag("--ref", DEFAULT_CANDIDATE.ref);
const filingPath = PROOF_PATHS.evidenceD;

/* ── the template ───────────────────────────────────────────────────────── */

if (templateMode) {
  const skeleton = {
    schema: EVIDENCE_D_SCHEMA,
    environment: "production",
    source: "external-verification",
    verified: true,
    verifiedAt: now,
    candidate: { commit: candidateCommit, ref: candidateRef },
    records: REQUIRED_PROVIDER_IDS.map((provider) => ({
      provider,
      dataset: "",
      instrument: null,
      providerInstrumentId: null,
      mode: "",
      environment: "production",
      source: "external-verification",
      observedAt: 0,
      receivedAt: 0,
      provenance: { transport: "https", host: null, status: 0 },
    })),
    digest: "",
    note:
      "A skeleton, not evidence. Fill in what the providers actually answered, delete the providers that did not answer, " +
      "recompute `digest` over this object minus the digest field, and file it. This skeleton is refused as it stands.",
  };
  process.stdout.write(`${JSON.stringify(skeleton, null, 2)}\n`);
  process.stdout.write(
    `\n# ${REQUIRED_PROVIDER_IDS.length} required providers: ${REQUIRED_PROVIDER_IDS.join(", ")}\n` +
      `# documented hosts: ${Object.entries(DOCUMENTED_PROVIDER_HOSTS)
        .map(([id, host]) => `${id} → ${host}`)
        .join(", ")}\n` +
      `# freshness window: ${String(EVIDENCE_D_MAX_AGE_MS)}ms (the gate's own window for this prerequisite)\n` +
      `# file it at: ${filingPath}\n`,
  );
  process.exit(0);
}

/* ── the current state ──────────────────────────────────────────────────── */

if (argv.includes("--status")) {
  const readReal = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
  const source = {
    exists: (path) => existsSync(resolve(process.cwd(), path)),
    read: readReal,
  };
  const state = deriveCurrentReleaseState(source, {
    now,
    commit: candidateCommit,
    ref: candidateRef,
  });
  const outcome = state.verdict.prerequisites.find(
    (entry) => entry.id === "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",
  );
  const filed = source.exists(PROOF_PATHS.evidenceD);
  const report = {
    mode: "EVIDENCE_D_STATUS (read-only; no provider contact, no credential access, no git, no deployment)",
    schema: EVIDENCE_D_SCHEMA,
    evaluatedAt: now,
    filingPath: PROOF_PATHS.evidenceD,
    packageFiled: filed,
    prerequisite: "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",
    evidenceDState: outcome?.state ?? "UNVERIFIED",
    reasons: outcome?.reasons ?? ["no evidence was supplied"],
    verdictEcho: state.verdict.verdict,
    verdictIssuedHere: false,
    blockers: state.verdict.blockers,
    guarantees: {
      providerContacted: false,
      networkOpened: false,
      credentialRead: false,
      credentialPrinted: false,
      credentialMutated: false,
      deploymentPerformed: false,
      emailSent: false,
      gitMutated: false,
      productionStateMutated: false,
      packagePersisted: false,
    },
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        report.mode,
        `evaluatedAt: ${report.evaluatedAt}`,
        `package filed at ${report.filingPath}: ${report.packageFiled ? "yes" : "no"}`,
        `Evidence D: ${report.evidenceDState}`,
        ...report.reasons.map((reason) => `  reason: ${reason}`),
        `canonical verdict (echoed, not issued here): ${report.verdictEcho}`,
        `blockers: ${report.blockers.length ? report.blockers.join(", ") : "none"}`,
        "",
      ].join("\n"),
    );
  }
  process.exit(report.evidenceDState === "VERIFIED" ? 0 : 1);
}

/* ── read the package ───────────────────────────────────────────────────── */

if (!packagePath) {
  process.stderr.write("evidence-d: no --package was supplied; nothing was read\n");
  process.exit(2);
}
const absolute = resolve(process.cwd(), packagePath);
if (!existsSync(absolute)) {
  process.stderr.write(`evidence-d: no package at ${absolute}\n`);
  process.exit(2);
}
let text;
try {
  text = readFileSync(absolute, "utf8");
} catch (error) {
  process.stderr.write(`evidence-d: could not read ${absolute}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  process.stderr.write(
    `evidence-d: ${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

/* ── decide ─────────────────────────────────────────────────────────────── */

const assessment = evaluateEvidenceDPackage(parsed, {
  now,
  candidate: { commit: candidateCommit, ref: candidateRef },
});
const projection = toGateEvidenceRecord(assessment, { candidateCommit, candidateRef });

/*
  The simulation: the canonical admission, run once, in memory, with this
  package overlaid on the real tree. Nothing is written; the overlay exists only
  for the duration of this call. When the package already sits at the filing
  path, the overlay is the tree and the simulation IS the current state.
*/
let simulated = { verdict: null, blockers: [], evidenceDState: null };
if (assessment.complete) {
  const readReal = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
  const source = {
    exists: (path) => (path === PROOF_PATHS.evidenceD ? true : existsSync(resolve(process.cwd(), path))),
    read: (path) => (path === PROOF_PATHS.evidenceD ? text : readReal(path)),
  };
  const admission = evaluateReleaseAdmission({ source, now, commit: candidateCommit, ref: candidateRef });
  const evidenceDOutcome = admission.prerequisites.find(
    (outcome) => outcome.id === "EVIDENCE_D_PRODUCTION_PROVIDER_VERIFICATION",
  );
  simulated = {
    verdict: admission.verdict,
    blockers: admission.blockers.map((blocker) => blocker.id).sort(),
    evidenceDState: evidenceDOutcome ? evidenceDOutcome.state : "UNVERIFIED",
  };
}

const handoff = buildEvidenceDOperatorHandoff(assessment, {
  packagePath,
  filingPath,
  simulated,
});

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ ...handoff, gateRecord: projection.record, gateRefusals: projection.refusals }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`${formatEvidenceDOperatorHandoff(handoff)}\n`);
  if (projection.record) {
    process.stdout.write(
      `gate record: ${projection.record.prerequisite} as of ${projection.record.observedAt} covering ${projection.record.subject?.providers?.length ?? 0} providers\n`,
    );
  }
  if (!assessment.complete) {
    process.stdout.write(
      "\nEVIDENCE_D_COMPLETE was not reached. That is a named blocker, not a negative finding about any provider: " +
        "the providers were not contacted by this command and nothing here is evidence about them.\n",
    );
  }
}

process.exit(evidenceDHandoffExitCode(handoff));
