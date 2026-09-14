/**
 * Canonical Evidence D report schema (Phase 208).
 * ============================================================================
 *
 * ONE report object, built once, consumed by BOTH output modes. Before this
 * module the JSON payload and the human-readable print were assembled
 * independently, so `providerAttempts`, `sweepLog` and `chargeableFind` were
 * reachable only by reading the JSON — and an operator reading the terminal
 * could not tell why a check was BLOCKED without opening the source.
 *
 * It also closes two false-green holes found in the Phase 207 verdict:
 *
 *   1. `complete` was defined as the ABSENCE of bad statuses. A check carrying
 *      any unrecognised status ("SKIPPED", "OK", a typo) counted as neither
 *      failed nor blocked nor not-verified, so the run reported ACHIEVED.
 *   2. Zero recorded checks also satisfied that definition, so a run that
 *      recorded nothing at all reported ACHIEVED with no evidence whatsoever.
 *
 * Both are fixed by requiring POSITIVE evidence: every declared observation
 * must be present and must itself be PASS. Absence of a result is not
 * evidence, and an unrecognised status is never a pass.
 *
 * This module is pure: no I/O, no network, no process state. That is what
 * makes the invariants directly testable on structured values rather than by
 * matching strings in the harness source.
 */

/** The only vocabulary a rendered row may use. Mirrors docs/UAT-MATRIX.md. */
export const CANONICAL_STATUSES = ["PASS", "FAIL", "BLOCKED", "NOT_VERIFIED", "UNKNOWN"];

/**
 * Severity ordering, used when the same observation was recorded more than
 * once. The worst outcome wins: a later PASS can never overwrite an earlier
 * FAIL. UNKNOWN outranks BLOCKED because an unrecognised status means the
 * harness itself is untrustworthy.
 */
const SEVERITY = { FAIL: 4, UNKNOWN: 3, BLOCKED: 2, NOT_VERIFIED: 1, PASS: 0 };

/**
 * Normalise a raw status into the canonical vocabulary, FAIL-CLOSED.
 *
 * Only the exact token "PASS" yields PASS. Everything unrecognised becomes
 * UNKNOWN, never PASS — that is the load-bearing property of this function.
 */
export function canonicalStatus(raw) {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (s === "PASS") return "PASS";
  if (s === "FAIL" || s === "FAILED") return "FAIL";
  if (s === "BLOCKED") return "BLOCKED";
  if (s === "NOT_VERIFIED") return "NOT_VERIFIED";
  return "UNKNOWN";
}

/** True only for a genuine positive result. */
export function isPass(raw) {
  return canonicalStatus(raw) === "PASS";
}

/**
 * Project recorded checks onto the declared definitions.
 *
 * Every declared observation produces exactly one row. A definition with no
 * recorded result becomes BLOCKED — a missing observation must never simply
 * vanish from the report and shrink the denominator.
 */
export function canonicalRows(definitions, recorded) {
  const defs = Array.isArray(definitions) ? definitions : [];
  const byId = new Map();
  for (const c of Array.isArray(recorded) ? recorded : []) {
    const id = String(c?.id ?? "");
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(c);
  }

  const rows = [];
  const missing = [];
  const duplicated = [];
  const unrecognised = [];

  for (const def of defs) {
    const found = byId.get(def.id) ?? [];

    if (found.length === 0) {
      missing.push(def.id);
      rows.push({
        id: def.id,
        title: def.title ?? def.id,
        status: "BLOCKED",
        detail:
          "the harness never recorded this observation. Absence of a result is not " +
          "evidence; it is reported BLOCKED so it cannot be mistaken for a pass.",
        evidence: null,
        recordedCount: 0,
      });
      continue;
    }

    if (found.length > 1) duplicated.push(def.id);

    let winner = found[0];
    for (const cand of found) {
      if (SEVERITY[canonicalStatus(cand.status)] > SEVERITY[canonicalStatus(winner.status)]) {
        winner = cand;
      }
    }

    const status = canonicalStatus(winner.status);
    if (status === "UNKNOWN") {
      unrecognised.push({ id: def.id, raw: String(winner.status ?? "") });
    }

    rows.push({
      id: def.id,
      title: def.title ?? winner.title ?? def.id,
      status,
      detail: String(winner.detail ?? ""),
      evidence: winner.evidence ?? null,
      recordedCount: found.length,
    });
  }

  const extras = [...byId.keys()].filter((id) => !defs.some((d) => d.id === id));

  return {
    rows,
    integrity: { expected: defs.length, rendered: rows.length, missing, duplicated, unrecognised, extras },
  };
}

/** Count rows by canonical status. */
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const count = (s) => list.filter((r) => canonicalStatus(r.status) === s).length;
  return {
    total: list.length,
    passed: count("PASS"),
    failed: count("FAIL"),
    blocked: count("BLOCKED"),
    notVerified: count("NOT_VERIFIED"),
    unknown: count("UNKNOWN"),
  };
}

/**
 * Remaining blockers, stated explicitly so the operator never has to read the
 * harness source to learn why a check is unresolved. Each entry keeps its
 * classification: a BLOCKED row stays BLOCKED in the blocker list.
 */
export function collectBlockers(dRows, eRows, market) {
  const out = [];
  for (const r of dRows ?? []) {
    const status = canonicalStatus(r.status);
    if (status === "PASS") continue;
    out.push({ track: "D", id: r.id, status, classification: status, title: r.title, reason: r.detail });
  }
  for (const r of eRows ?? []) {
    const status = canonicalStatus(r.status);
    if (status === "PASS") continue;
    out.push({ track: "E", id: r.id, status, classification: status, title: r.title, reason: r.detail });
  }
  if (market?.note) {
    out.push({
      track: "MARKET",
      id: "CHARGEABLE",
      status: "NOT_VERIFIED",
      classification: "MARKET_CONDITION",
      title: "No natural chargeable signal was observed",
      reason: market.note,
    });
  }
  return out;
}

/**
 * Build the canonical report. This is the single source of truth for both
 * `--json` and the human-readable print.
 */
export function buildReport(input) {
  const {
    definitions = [],
    checks = [],
    entitlementDefinitions = [],
    entitlementChecks = [],
    environment = "unknown",
    deployment = {},
    evidenceClass = "UNKNOWN",
    claimsProduction = false,
    authMechanism = "unknown",
    configSource = null,
    capturedAt = null,
    durationMs = 0,
    transportCalls = 0,
    providerAttempts = [],
    sweepLog = [],
    chargeableFind = null,
    sweepLimit = 1,
    safetyProbes = null,
    executed = true,
    notExecutedReason = null,
  } = input ?? {};

  const d = canonicalRows(definitions, checks);
  const summary = summarize(d.rows);

  // Positive evidence is REQUIRED. Not "nothing bad happened" — every declared
  // observation present, and every one of them an actual PASS.
  const complete =
    d.rows.length === definitions.length &&
    definitions.length > 0 &&
    summary.passed === definitions.length &&
    summary.failed === 0 &&
    summary.blocked === 0 &&
    summary.notVerified === 0 &&
    summary.unknown === 0 &&
    d.integrity.missing.length === 0 &&
    d.integrity.unrecognised.length === 0;

  const evidenceD = !executed
    ? "NOT EXECUTED"
    : summary.failed > 0
      ? "FAILED"
      : complete
        ? "ACHIEVED"
        : "INCOMPLETE";

  // The E-track is summarised beside the D-track and never folded into it.
  const e = canonicalRows(entitlementDefinitions, entitlementChecks);
  const eRows = entitlementChecks.length === 0 ? [] : e.rows;
  const eSummary = summarize(eRows);
  const entitlementVerdict =
    eRows.length === 0
      ? "NOT EXECUTED"
      : eSummary.failed > 0
        ? "FAILED"
        : eSummary.passed === eRows.length
          ? "VERIFIED"
          : "INCOMPLETE";

  // A production claim needs every production condition to hold at once.
  const productionEvidence =
    executed &&
    complete &&
    evidenceD === "ACHIEVED" &&
    evidenceClass === "PRODUCTION_EVIDENCE" &&
    environment === "production" &&
    claimsProduction === true &&
    authMechanism !== "anonymous (development)";

  const sweepAttempted = (sweepLog ?? []).filter((s) => s && s.instrument).length;
  const market =
    chargeableFind === null
      ? {
          note:
            sweepAttempted > 0
              ? `no naturally chargeable BUY/SELL was produced across ${sweepAttempted} ` +
                "instrument(s). This is a market condition, not a defect: the engine is " +
                "never forced to produce a directional signal, so D5/D7/D8 stay " +
                "NOT_VERIFIED rather than FAIL."
              : "no chargeable-signal sweep was run (--sweep 1). D5/D7/D8 can only be " +
                "evidenced when the engine produces a directional signal on its own.",
        }
      : null;

  return {
    schemaVersion: "evidence-d/2",
    evidenceD,
    evidenceClass: complete ? evidenceClass : `${evidenceClass} (INCOMPLETE)`,
    notExecutedReason,
    environment,
    deployment: {
      host: deployment.host ?? null,
      name: deployment.name ?? null,
      declared: deployment.declared ?? null,
    },
    productionEvidence,
    configSource,
    authMechanism,
    capturedAt,
    durationMs,
    transportCalls,
    summary,
    integrity: d.integrity,
    checks: d.rows,
    providerEvidence: {
      attempts: providerAttempts ?? [],
      note:
        "Each attempt records how observedAt was derived. An acquisition-time stamp " +
        "is never reported as a provider observation.",
    },
    sweep: {
      limit: sweepLimit,
      attempted: sweepAttempted,
      candidates: sweepLog ?? [],
      chargeableFind,
      marketLimitation: market?.note ?? null,
    },
    entitlementStateMachine: {
      verdict: entitlementVerdict,
      note:
        "Exercised through entitlements:consumeProfitSignal, a real deployed " +
        "authenticated boundary that returns accounting only and can never grant " +
        "allowance. It does NOT prove the engine decides chargeability — that is D5-D8.",
      summary: eSummary,
      checks: eRows,
    },
    safetyProbes,
    blockers: collectBlockers(d.rows, eRows, market),
  };
}

/**
 * Render the canonical report for a terminal. Reads the SAME object the JSON
 * mode serialises, so the two modes cannot drift apart.
 */
export function renderHumanReport(report) {
  const line = "─".repeat(78);
  const out = [];
  const r = report ?? {};

  out.push(`Evidence D harness — ${r.deployment?.host ?? "unknown host"} [${r.environment}]`);
  out.push(
    `  deployment=${r.deployment?.name ?? "unnamed"} declared=${r.deployment?.declared ?? "unknown"} ` +
      `auth=${r.authMechanism} config=${r.configSource ?? "n/a"}`,
  );
  out.push(line);

  for (const c of r.checks ?? []) {
    out.push(`  ${String(c.status).padEnd(13)} ${String(c.id).padEnd(4)} ${c.title}`);
    if (c.detail) out.push(`  ${" ".repeat(18)} ${c.detail}`);
  }

  const attempts = r.providerEvidence?.attempts ?? [];
  out.push(line);
  out.push("  PROVIDER ATTEMPTS (how observedAt was derived)");
  if (attempts.length === 0) {
    out.push("    none recorded — D10 could not probe any provider this run.");
  } else {
    for (const a of attempts) {
      out.push(
        `    ${a.acquired ? "acquired" : "failed  "} ${a.provider}/${a.dataset} ` +
          `${a.instrument ?? "-"} [${a.access}]`,
      );
      out.push(
        `             basis=${a.basis} observedAt=${
          typeof a.observedAt === "number" ? new Date(a.observedAt).toISOString() : "none"
        } freshness=${a.acquisition ?? "n/a"}${a.failure ? ` failure=${a.failure}` : ""}`,
      );
    }
  }

  const sweep = r.sweep ?? {};
  out.push(line);
  out.push(`  CHARGEABLE-SIGNAL SWEEP (limit ${sweep.limit ?? 1}, attempted ${sweep.attempted ?? 0})`);
  if ((sweep.candidates ?? []).length === 0) {
    out.push("    no candidates attempted.");
  } else {
    for (const s of sweep.candidates) {
      if (!s.instrument) {
        out.push(`    note: ${s.note ?? "unspecified"}${s.error ? ` (${s.error})` : ""}`);
        continue;
      }
      out.push(
        `    ${String(s.instrument).padEnd(16)} type=${s.instType ?? "-"} status=${s.status ?? "-"} ` +
          `recommendation=${s.recommendation ?? "none"} consumed=${s.consumed ?? 0}`,
      );
    }
  }
  if (sweep.chargeableFind) {
    out.push(
      `    NATURAL CHARGEABLE SIGNAL: ${sweep.chargeableFind.instrument} → ` +
        `${sweep.chargeableFind.recommendation} (consumed ${sweep.chargeableFind.consumed})`,
    );
  } else {
    out.push(`    no chargeable signal: ${sweep.marketLimitation ?? "not attempted"}`);
  }

  const e = r.entitlementStateMachine ?? {};
  if ((e.checks ?? []).length > 0) {
    out.push(line);
    out.push("  ENTITLEMENT STATE MACHINE (independent of market conditions)");
    for (const c of e.checks) {
      out.push(`  ${String(c.status).padEnd(13)} ${String(c.id).padEnd(4)} ${c.title}`);
      if (c.detail) out.push(`  ${" ".repeat(18)} ${c.detail}`);
    }
  }

  out.push(line);
  out.push(`EVIDENCE D: ${r.evidenceD}`);
  if ((e.checks ?? []).length > 0) out.push(`ENTITLEMENT STATE MACHINE: ${e.verdict}`);
  const s = r.summary ?? {};
  out.push(
    `  ${s.passed ?? 0} passed, ${s.failed ?? 0} failed, ${s.blocked ?? 0} blocked, ` +
      `${s.notVerified ?? 0} not verified${s.unknown ? `, ${s.unknown} UNRECOGNISED` : ""}`,
  );
  out.push(`  CLASS: ${r.evidenceClass}`);

  const integrity = r.integrity ?? {};
  if ((integrity.missing ?? []).length > 0) {
    out.push(`  MISSING OBSERVATIONS: ${integrity.missing.join(", ")} — reported BLOCKED.`);
  }
  if ((integrity.unrecognised ?? []).length > 0) {
    out.push(
      `  UNRECOGNISED STATUS: ${integrity.unrecognised
        .map((u) => `${u.id}="${u.raw}"`)
        .join(", ")} — treated as UNKNOWN, never PASS.`,
    );
  }

  const blockers = r.blockers ?? [];
  if (blockers.length > 0) {
    out.push(line);
    out.push(`  REMAINING BLOCKERS (${blockers.length})`);
    for (const b of blockers) {
      out.push(`    [${b.track}] ${b.id} ${b.classification}: ${b.title}`);
      if (b.reason) out.push(`        ${b.reason}`);
    }
  }

  if (!r.productionEvidence) out.push("  This run is NOT production release evidence.");
  if (r.evidenceD !== "ACHIEVED") {
    out.push("  Evidence D is NOT achieved. Do not report the backend as verified.");
  }

  return out;
}
