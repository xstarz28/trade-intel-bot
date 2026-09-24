#!/usr/bin/env node
/**
 * Phase 248 — the Convex deployment verification operator command.
 *
 *   npm run deployment:verify -- --package docs/remediation/convex-production-deployment.json
 *   npm run deployment:verify -- --package <path> --deployment prod:<team>:<project> --json
 *   npm run deployment:verify -- --status [--deployment prod:<team>:<project>]
 *   npm run deployment:verify -- --template            # a skeleton to fill in
 *
 * WHAT IT DOES
 *
 * It reads ONE deployment package from disk, hands it to the canonical Phase 248
 * validator together with the function surface scanned from this candidate's own
 * `src/convex`, and prints what the release gate would read. It then simulates the
 * canonical admission ONCE in memory with that package filed, so the operator can
 * see the blockers that would remain — including the ones this package cannot
 * clear (A1, A2, email, Evidence D).
 *
 * WHAT IT CANNOT DO
 *
 *   - It never contacts a control plane or a deployment. There is no network
 *     module in this file or in the decision module it calls.
 *   - It never reads a credential: the package may not contain one, `process.env`
 *     is never touched, and the printer only writes fields the validator produced.
 *   - It never writes. `node:fs` is used for `readFileSync`/`existsSync` and for
 *     the read-only function-surface scan; no package is created, moved or filed.
 *   - It never runs git, never deploys, never sends mail and never mutates state.
 *   - It never decides a release. It CALLS the canonical Phase 242 admission; a
 *     second aggregation is how two release checks start disagreeing.
 *
 * EXIT CODES
 *
 *   0  the package is admissible for evaluation (CONVEX_DEPLOYMENT_VERIFIED) —
 *      still not a release decision
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
  CONVEX_DEPLOYMENT_MAX_AGE_MS,
  CONVEX_DEPLOYMENT_SCHEMA,
  ACCEPTED_DEPLOYMENT_CATEGORIES,
  REJECTED_DEPLOYMENT_CATEGORIES,
  AUTHENTICATED_ACCESS_STATES,
  buildConvexDeploymentOperatorHandoff,
  evaluateConvexDeploymentPackage,
  convexDeploymentHandoffExitCode,
  formatConvexDeploymentOperatorHandoff,
  toGateConvexRecord,
} = await import(here("src/lib/deployment/convex-deployment-verification.ts"));
const { requiredConvexFunctionReferences } = await import(
  here("src/lib/deployment/convex-function-surface.ts")
);
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
      "usage: npm run deployment:verify -- --package <path> [--deployment prod:<team>:<project>] [--json]",
      "       npm run deployment:verify -- --package <path> [--now <ms>] [--candidate <commit>] [--ref <ref>]",
      "       npm run deployment:verify -- --status [--deployment prod:<team>:<project>] [--json]",
      "       npm run deployment:verify -- --template",
      "",
      "Reads one Convex deployment package and reports what the release gate would read.",
      "It never contacts a control plane, never reads a credential and never writes.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const templateMode = argv.includes("--template");
const asJson = argv.includes("--json");
/** Flags that consume the next argument, so it is not mistaken for a path. */
const VALUE_FLAGS = new Set(["--package", "--now", "--candidate", "--ref", "--deployment"]);
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
  process.stderr.write(`deployment: --now must be a finite instant in milliseconds, got ${String(nowArg)}\n`);
  process.exit(2);
}
const candidateCommit = flag("--candidate", DEFAULT_CANDIDATE.commit);
const candidateRef = flag("--ref", DEFAULT_CANDIDATE.ref);
const declaredDeployment = flag("--deployment", null);
const filingPath = PROOF_PATHS.convexDeployment;

/** The function surface this candidate defines, scanned read-only from src/convex. */
const requiredFunctions = requiredConvexFunctionReferences();

/* ── the template ───────────────────────────────────────────────────────── */

if (templateMode) {
  const skeleton = {
    schema: CONVEX_DEPLOYMENT_SCHEMA,
    environment: "production",
    source: "external-verification",
    verified: true,
    observedAt: now,
    candidate: { commit: candidateCommit, ref: candidateRef },
    deployment: declaredDeployment ?? "prod:<team>:<project>",
    deploymentUrl: "https://<deployment>.convex.cloud",
    siteUrl: "https://<deployment>.convex.site",
    deploymentEnv: null,
    accessVerdict: AUTHENTICATED_ACCESS_STATES[0] ?? "AUTHENTICATED",
    publishedFunctions: requiredFunctions,
    digest: "",
    note:
      "A skeleton, not evidence. Record what the deployment actually publishes (npx convex function-spec), " +
      "the URLs and environment you actually observed, delete anything you did not verify, recompute `digest` " +
      "over this object minus the digest field, and file it. This skeleton is refused as it stands.",
  };
  process.stdout.write(`${JSON.stringify(skeleton, null, 2)}\n`);
  process.stdout.write(
    `\n# ${requiredFunctions.length} required functions, scanned from src/convex\n` +
      `# accepted access verdicts: ${AUTHENTICATED_ACCESS_STATES.join(", ") || "<none readable>"}\n` +
      `# freshness window: ${String(CONVEX_DEPLOYMENT_MAX_AGE_MS)}ms (the gate's own window for this prerequisite)\n` +
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
    productionDeployment: declaredDeployment ?? undefined,
    requiredConvexFunctions: requiredFunctions,
  });
  const outcome = state.verdict.prerequisites.find(
    (entry) => entry.id === "CONVEX_PRODUCTION_DEPLOYMENT",
  );
  const filed = source.exists(PROOF_PATHS.convexDeployment);
  const report = {
    mode: "CONVEX_DEPLOYMENT_STATUS (read-only; no control-plane contact, no credential access, no git, no deployment)",
    schema: CONVEX_DEPLOYMENT_SCHEMA,
    evaluatedAt: now,
    filingPath: PROOF_PATHS.convexDeployment,
    packageFiled: filed,
    declaredDeployment: declaredDeployment ?? null,
    requiredFunctions: requiredFunctions.length,
    prerequisite: "CONVEX_PRODUCTION_DEPLOYMENT",
    deploymentState: outcome?.state ?? "UNVERIFIED",
    reasons: outcome?.reasons ?? ["no evidence was supplied"],
    verdictEcho: state.verdict.verdict,
    verdictIssuedHere: false,
    blockers: state.verdict.blockers,
    guarantees: {
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
        `declared deployment: ${report.declaredDeployment ?? "<none>"}`,
        `required functions (scanned from src/convex): ${report.requiredFunctions}`,
        `Convex deployment: ${report.deploymentState}`,
        ...report.reasons.map((reason) => `  reason: ${reason}`),
        `canonical verdict (echoed, not issued here): ${report.verdictEcho}`,
        `blockers: ${report.blockers.length ? report.blockers.join(", ") : "none"}`,
        "",
      ].join("\n"),
    );
  }
  process.exit(report.deploymentState === "VERIFIED" ? 0 : 1);
}

/* ── read the package ───────────────────────────────────────────────────── */

if (!packagePath) {
  process.stderr.write("deployment: no --package was supplied; nothing was read\n");
  process.exit(2);
}
const absolute = resolve(process.cwd(), packagePath);
if (!existsSync(absolute)) {
  process.stderr.write(`deployment: no package at ${absolute}\n`);
  process.exit(2);
}
let text;
try {
  text = readFileSync(absolute, "utf8");
} catch (error) {
  process.stderr.write(`deployment: could not read ${absolute}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  process.stderr.write(
    `deployment: ${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

/* ── decide ─────────────────────────────────────────────────────────────── */

const assessment = evaluateConvexDeploymentPackage(parsed, {
  now,
  candidate: { commit: candidateCommit, ref: candidateRef },
  productionDeployment: declaredDeployment ?? undefined,
  requiredFunctions,
});
const projection = toGateConvexRecord(assessment, {
  candidateCommit,
  deployment: declaredDeployment ?? assessment.deployment ?? undefined,
});

/*
  The simulation: the canonical admission, run once, in memory, with this package
  overlaid on the real tree. Nothing is written; the overlay exists only for the
  duration of this call. When the package already sits at the filing path, the
  overlay IS the tree and the simulation is the current state.
*/
let simulated = { verdict: null, blockers: [], deploymentState: null };
if (assessment.complete) {
  const readReal = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
  const source = {
    exists: (path) =>
      path === PROOF_PATHS.convexDeployment ? true : existsSync(resolve(process.cwd(), path)),
    read: (path) => (path === PROOF_PATHS.convexDeployment ? text : readReal(path)),
  };
  const admission = evaluateReleaseAdmission({
    source,
    now,
    commit: candidateCommit,
    ref: candidateRef,
    productionDeployment: declaredDeployment ?? undefined,
  });
  const deploymentOutcome = admission.prerequisites.find(
    (outcome) => outcome.id === "CONVEX_PRODUCTION_DEPLOYMENT",
  );
  simulated = {
    verdict: admission.verdict,
    blockers: admission.blockers.map((blocker) => blocker.id).sort(),
    deploymentState: deploymentOutcome ? deploymentOutcome.state : "UNVERIFIED",
  };
}

const handoff = buildConvexDeploymentOperatorHandoff(assessment, {
  packagePath,
  filingPath,
  declaredDeployment,
  simulated,
});

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ...handoff,
        accepted: ACCEPTED_DEPLOYMENT_CATEGORIES,
        rejected: REJECTED_DEPLOYMENT_CATEGORIES,
        gateRecord: projection.record,
        gateRefusals: projection.refusals,
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(`${formatConvexDeploymentOperatorHandoff(handoff)}\n`);
  if (projection.record) {
    process.stdout.write(
      `gate record: ${projection.record.prerequisite} as of ${projection.record.observedAt} for deployment ${projection.record.subject?.deployment ?? "<none>"}\n`,
    );
  }
  if (!assessment.complete) {
    process.stdout.write(
      "\nCONVEX_DEPLOYMENT_VERIFIED was not reached. That is a named blocker, not a claim that a deployment does or does not exist: " +
        "this command contacted no control plane and observed nothing itself.\n",
    );
  }
}

process.exit(convexDeploymentHandoffExitCode(handoff));
