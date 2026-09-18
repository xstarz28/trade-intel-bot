/**
 * Phase 233 — reading the Phase 184 runbook's ref claims as data.
 *
 * THE THREE THINGS THAT MUST NOT BE CONFLATED
 * The old check compared one environment-derived list against one runbook
 * string. That collapsed three genuinely different questions into one, which
 * is why its failure was impossible to interpret:
 *
 *   1. REF INVENTORY   — which refs exist? (the remote answers this; see
 *                        `live-refs.ts` — never the local tracking set)
 *   2. EXPOSURE FACTS  — for each ref, does it carry the leaked blob, is the
 *                        blob still served from the tip? (the fingerprint
 *                        tooling answers this; see
 *                        `scripts/secret-ref-inventory.mjs`)
 *   3. REWRITE COVERAGE — which refs will the Phase 184 rewrite actually
 *                        rewrite? (a runbook claim, verified against 1 and 2)
 *
 * A ref can legitimately be "clean at tip" and still be affected: removal from
 * HEAD is not remediation, because the blob stays reachable in history. That
 * distinction is exactly what the old per-ref table blurred, and it is what
 * makes a missing rewrite-map entry a security defect rather than a doc nit.
 *
 * Everything here is pure parsing, so the runbook's claims are testable
 * without network access or full history.
 */

/** `refs/heads/x` and `heads/x` both normalise to `heads/x`. */
export function normalizeRunbookRef(raw: string): string {
  return raw
    .replace(/^refs\/heads\//, "heads/")
    .replace(/^refs\/tags\//, "tags/");
}

export interface ExposureRow {
  ref: string;
  /** Verbatim status cell, e.g. `**clean**` or `**EXPOSED AT TIP**`. */
  tipStatus: string;
  /** The runbook's own occurrence count for that ref, when numeric. */
  occurrences: number | null;
}

export interface RewriteCoverageRow {
  ref: string;
  before: string;
  after: string;
}

/**
 * Slice a `###` section out of the runbook.
 *
 * It must end at the NEXT heading of level `###` or higher, whichever comes
 * first. Ending only at the next `##` would swallow every intervening `###`
 * section — which silently merged the rewrite-coverage table into the
 * exposure table and made one ref look like it had two exposure rows.
 */
function section(runbook: string, startHeading: string): string {
  const start = runbook.indexOf(startHeading);
  if (start < 0) return "";
  const rest = runbook.slice(start + startHeading.length);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Table rows whose first cell is a backticked ref name. */
function refRows(block: string): Array<{ ref: string; cells: string[] }> {
  const rows: Array<{ ref: string; cells: string[] }> = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const match = cells[0].match(/^`([^`]+)`$/);
    if (!match) continue; // header / separator / prose row
    rows.push({ ref: normalizeRunbookRef(match[1]), cells });
  }
  return rows;
}

/** Concern 2 — the per-ref exposure table in §1. */
export function parseExposureFacts(runbook: string): ExposureRow[] {
  const block = section(runbook, "### Per-ref status");
  return refRows(block).map(({ ref, cells }) => {
    const n = Number(cells[2]);
    return { ref, tipStatus: cells[1], occurrences: Number.isFinite(n) ? n : null };
  });
}

/** Concern 3 — the refs the rewrite procedure claims it will rewrite, in §3. */
export function parseRewriteCoverage(runbook: string): RewriteCoverageRow[] {
  const block = section(runbook, "### Refs the force-push will rewrite");
  return refRows(block).map(({ ref, cells }) => ({
    ref,
    before: cells[1] ?? "",
    after: cells[2] ?? "",
  }));
}

/** Refs that appear more than once in a row set — a copy/paste hazard. */
export function duplicateRefs(refs: string[]): string[] {
  const seen = new Map<string, number>();
  for (const r of refs) seen.set(r, (seen.get(r) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([r]) => r);
}

/** A ref the runbook labels as still serving the credential from its tip. */
export function isMarkedExposedAtTip(row: ExposureRow): boolean {
  return /EXPOSED AT TIP/i.test(row.tipStatus);
}

// ─────────────────────────────────────────────────────────────────
// The verified inventory — the machine-readable output of the
// fingerprint tooling, consumed by the consistency tests.
// ─────────────────────────────────────────────────────────────────

export interface VerifiedRef {
  ref: string;
  /** The leaked blob is reachable from this ref's history. */
  affected: boolean;
  /** Commits in this ref's history whose tree holds the leaked blob. */
  carrierCommits: number;
  /** The ref's tip itself serves the leaked blob (worse than history-only). */
  exposedAtTip: boolean;
}

export interface VerifiedInventory {
  fingerprint: string;
  /** Paths at which the leaked blob was found (the scan may find more than one). */
  blobPaths: string[];
  /** Commits reachable across all refs when the scan ran. */
  historyCommits: number;
  /**
   * Commits whose tree holds the leaked blob, counted once across all refs.
   *
   * This is the figure that shows whether the *exposure* moved, as distinct from
   * whether the repository grew: `historyCommits` rises with every commit, while
   * this stays at 270 across every measurement taken so far. A ref being added to
   * or removed from the inventory changes neither, which is why the two counts are
   * recorded separately rather than collapsed into one number.
   */
  carrierCommits: number;
  /** ISO timestamp of the measurement, so its age can be checked. */
  verifiedAt: string;
  generatedBy: string;
  refs: VerifiedRef[];
}

export function parseVerifiedInventory(json: string): VerifiedInventory {
  const parsed = JSON.parse(json) as VerifiedInventory;
  if (!Array.isArray(parsed.refs)) {
    throw new Error("verified inventory is missing a `refs` array");
  }
  return parsed;
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/**
 * The number the runbook *says* it covers, as a word ("**All seven**").
 *
 * Phase 221 pinned this as a literal string match on the word "five", which
 * had to be hand-edited every time a ref appeared — the prose was pinned to a
 * constant while the tables it summarised drifted. This reads the word and
 * compares it against the count that actually holds, so the summary cannot go
 * stale silently (it said "All five" while seven refs existed).
 */
export function parseDeclaredRefCount(runbook: string): number | null {
  const block = section(runbook, "### Refs the force-push will rewrite");
  const match = block.match(/\*\*All ([a-z]+)\*\*/i);
  if (!match) return null;
  const idx = NUMBER_WORDS.indexOf(match[1].toLowerCase());
  return idx === -1 ? null : idx;
}

/** Problems in the runbook's own summary of how many refs it covers. */
export function declaredCountProblems(runbook: string, liveRefs: string[]): string[] {
  const declared = parseDeclaredRefCount(runbook);
  if (declared === null) {
    return ["the rewrite section no longer states how many refs it covers"];
  }
  if (declared !== liveRefs.length) {
    return [
      `the rewrite section says it covers ${declared} ref(s) but the remote ` +
        `advertises ${liveRefs.length}`,
    ];
  }
  return [];
}

export interface ConsistencyInput {
  /** Concern 1 — from `git ls-remote`. */
  liveRefs: string[];
  /** Concern 2 — the verified per-ref facts. */
  inventory: VerifiedInventory;
  /** Concern 2 — what the runbook CLAIMS about exposure. */
  exposure: ExposureRow[];
  /** Concern 3 — what the runbook says it will rewrite. */
  coverage: RewriteCoverageRow[];
}

/**
 * Every way the runbook's ref claims can disagree with verified reality.
 *
 * Returned as a list rather than an assertion so the same rule set can be
 * unit-tested against fixtures AND run against the real repository — the
 * fixtures are what give the rules teeth, since today every live ref happens
 * to be affected and the "unaffected" rules would otherwise never execute.
 */
export function refConsistencyProblems(input: ConsistencyInput): string[] {
  const { liveRefs, inventory, exposure, coverage } = input;
  const problems: string[] = [];

  const live = new Set(liveRefs);
  const exposedRefs = exposure.map((r) => r.ref);
  const coveredRefs = coverage.map((r) => r.ref);

  // ── Concern 1: nothing the remote advertises may be unaccounted for ──
  for (const ref of liveRefs) {
    if (!exposedRefs.includes(ref)) problems.push(`exposure table is missing live ref: ${ref}`);
  }

  // ── Duplicates (the Phase 198 table repeated one row and omitted three) ──
  for (const ref of duplicateRefs(exposedRefs)) {
    problems.push(`duplicate row in the exposure table: ${ref}`);
  }
  for (const ref of duplicateRefs(coveredRefs)) {
    problems.push(`duplicate row in the rewrite coverage: ${ref}`);
  }

  // ── Stale entries: a ref the runbook names that the remote no longer has ──
  for (const ref of [...new Set([...exposedRefs, ...coveredRefs])]) {
    if (!live.has(ref)) problems.push(`runbook names a ref that no longer exists: ${ref}`);
  }

  // ── The inventory must describe exactly the live ref set ──
  const inventoried = new Set(inventory.refs.map((r) => r.ref));
  for (const ref of liveRefs) {
    if (!inventoried.has(ref)) problems.push(`verified inventory was not run for live ref: ${ref}`);
  }
  for (const ref of inventoried) {
    if (!live.has(ref)) problems.push(`verified inventory contains a stale ref: ${ref}`);
  }

  // ── Concern 3: affected ⟺ must be rewritten ──
  //
  // Only the affected direction is a mandatory-coverage rule. The runbook is
  // correct to cover every affected ref and no others; an unaffected ref that
  // is covered is reported below as mislabelled, not as missing coverage,
  // because rewrite coverage is exactly the set that gets rewritten.
  for (const entry of inventory.refs) {
    if (entry.affected && !coveredRefs.includes(entry.ref)) {
      problems.push(
        `affected ref is absent from rewrite coverage (a surviving ref keeps the ` +
          `blob reachable): ${entry.ref}`,
      );
    }
    if (!entry.affected && coveredRefs.includes(entry.ref)) {
      problems.push(`unaffected ref is labelled affected in rewrite coverage: ${entry.ref}`);
    }
  }

  // ── The runbook's claims must match the measurement, not merely agree ──
  const byRef = new Map(exposure.map((r) => [r.ref, r]));
  for (const entry of inventory.refs) {
    const row = byRef.get(entry.ref);
    if (!row) continue;

    const claimsAffected = (row.occurrences ?? 0) > 0 || isMarkedExposedAtTip(row);
    if (entry.affected !== claimsAffected) {
      problems.push(
        `exposure contradiction for ${entry.ref}: measured affected=${entry.affected} ` +
          `(carriers=${entry.carrierCommits}) but the runbook claims ` +
          `occurrences=${row.occurrences}, tip="${row.tipStatus}"`,
      );
    }
    if (entry.exposedAtTip !== isMarkedExposedAtTip(row)) {
      problems.push(
        `tip-status contradiction for ${entry.ref}: measured exposedAtTip=` +
          `${entry.exposedAtTip} but the runbook says "${row.tipStatus}"`,
      );
    }
  }

  return problems;
}
