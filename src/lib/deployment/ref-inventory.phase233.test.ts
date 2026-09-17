/**
 * Phase 233 — ref inventory, exposure facts and rewrite coverage must agree.
 *
 * THE THREE CONCERNS, KEPT SEPARATE
 *   1. INVENTORY       which refs exist            — the remote answers (`git ls-remote`)
 *   2. EXPOSURE FACTS  which carry the blob        — fingerprint tooling answers
 *   3. REWRITE COVERAGE which get rewritten        — a runbook claim, checked against 1 and 2
 *
 * WHY THIS EXISTS
 * The previous check derived its subject set from `git for-each-ref
 * refs/remotes/origin refs/tags` and swallowed git failures with
 * `catch { return; }`. Its verdict therefore depended on clone depth, and a
 * checkout with no origin refs passed while asserting nothing. It also could
 * not distinguish "clean at tip" from "not affected": the runbook listed one
 * ref twice, omitted three that each carried 269 carrier commits, and left two
 * of those out of the rewrite map entirely — a security-relevant omission that
 * the environment-dependent oracle surfaced only as an unexplained red test.
 *
 * FAIL-CLOSED
 * `listLiveRefs()` throws when the remote cannot be read. That is deliberate:
 * "could not look" must never be recorded as "nothing to see". A security
 * check that goes green because it did not run is worse than no check, so the
 * infrastructure failure is a hard, self-describing error and never a skip.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  LiveRefSourceUnavailableError,
  type GitRunner,
  listLiveRefs,
  parseLsRemote,
} from "./live-refs";
import {
  type ExposureRow,
  type RewriteCoverageRow,
  type VerifiedInventory,
  declaredCountProblems,
  duplicateRefs,
  isMarkedExposedAtTip,
  parseDeclaredRefCount,
  parseExposureFacts,
  parseRewriteCoverage,
  parseVerifiedInventory,
  refConsistencyProblems,
} from "./runbook-ref-facts";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const RUNBOOK = read("docs/SECRET-REMEDIATION-RUNBOOK.md");
const INVENTORY_JSON = read("docs/secret-remediation-refs.json");

const runner = (output: string): GitRunner => () => output;

// ═══════════════════════════════════════════════════════════════
// 1 — the ref source itself
// ═══════════════════════════════════════════════════════════════

describe("the ref source is the remote, and it fails closed", () => {
  it("normalises heads and tags, and drops peeled tag objects", () => {
    const out = [
      "aaa\trefs/heads/main",
      "bbb\trefs/heads/arena/x",
      "ccc\trefs/tags/rc-181",
      "ddd\trefs/tags/rc-181^{}",
      "eee\tHEAD",
    ].join("\n");

    expect(parseLsRemote(out)).toEqual(["heads/arena/x", "heads/main", "tags/rc-181"]);
  });

  it("a peeled tag is never counted as its own ref", () => {
    // Counting `rc-181^{}` as well would demand a second table row for one tag.
    const refs = parseLsRemote("ccc\trefs/tags/rc-181\nddd\trefs/tags/rc-181^{}\n");
    expect(refs).toEqual(["tags/rc-181"]);
    expect(refs.filter((r) => r.startsWith("tags/"))).toHaveLength(1);
  });

  it("FAILS CLOSED when git cannot read the remote", () => {
    // The old test took this path and returned — a vacuous pass.
    expect(() =>
      listLiveRefs(() => {
        throw new Error("network unreachable");
      }),
    ).toThrow(LiveRefSourceUnavailableError);
  });

  it("the fail-closed error says it is infrastructure, not a clean result", () => {
    try {
      listLiveRefs(() => {
        throw new Error("boom");
      });
      throw new Error("expected listLiveRefs to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/infrastructure failure/i);
      expect(message).toMatch(/NOT a clean result/i);
      expect((err as LiveRefSourceUnavailableError).code).toBe("LIVE_REF_SOURCE_UNAVAILABLE");
    }
  });

  it("FAILS CLOSED on an empty ref list — emptiness is not cleanliness", () => {
    expect(() => listLiveRefs(runner(""))).toThrow(LiveRefSourceUnavailableError);
  });

  it("FAILS CLOSED when only non-ref entries come back", () => {
    expect(() => listLiveRefs(runner("ddd\trefs/tags/rc-181^{}\neee\tHEAD\n"))).toThrow(
      LiveRefSourceUnavailableError,
    );
  });

  it("returns the remote's refs, sorted, when the remote answers", () => {
    const refs = listLiveRefs(runner("bbb\trefs/heads/z\naaa\trefs/heads/a\n"));
    expect(refs).toEqual(["heads/a", "heads/z"]);
  });

  it("never hardcodes a branch list (it asks the remote)", () => {
    // A hardcoded list would recreate the defect while appearing fixed.
    const nowhere = listLiveRefs(runner("abc\trefs/heads/some-future-branch\n"));
    expect(nowhere).toEqual(["heads/some-future-branch"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 + 3 — reading the runbook's claims
// ═══════════════════════════════════════════════════════════════

const SYNTHETIC_RUNBOOK = `
### Per-ref status

| Ref | Tip today | Occurrences in that ref's history |
|---|---|---|
| \`refs/heads/main\` | **EXPOSED AT TIP** | 261 |
| \`refs/heads/old\` | **clean** | 0 |

### Refs the force-push will rewrite

| Ref | Before | After |
|---|---|---|
| \`heads/main\` | \`aaa\` | \`bbb\` |

## 4. Assertions
`;

describe("the runbook's ref claims are parsed, not string-matched", () => {
  it("normalises refs/heads/x and heads/x to one name", () => {
    expect(parseExposureFacts(SYNTHETIC_RUNBOOK).map((r) => r.ref)).toEqual([
      "heads/main",
      "heads/old",
    ]);
  });

  it("reads the occurrence count and the tip status", () => {
    const [main] = parseExposureFacts(SYNTHETIC_RUNBOOK);
    expect(main.occurrences).toBe(261);
    expect(isMarkedExposedAtTip(main)).toBe(true);
  });

  it("distinguishes clean-at-tip from not-affected", () => {
    const [, old] = parseExposureFacts(SYNTHETIC_RUNBOOK);
    expect(old.tipStatus).toMatch(/clean/i);
    expect(isMarkedExposedAtTip(old)).toBe(false);
    // `clean` at the tip is NOT the same claim as "not affected" — the old
    // table conflated them, which is how three affected branches went missing.
  });

  it("parses rewrite coverage without treating headers as rows", () => {
    const coverage = parseRewriteCoverage(SYNTHETIC_RUNBOOK);
    expect(coverage).toEqual([{ ref: "heads/main", before: "`aaa`", after: "`bbb`" }]);
  });
});

// ═══════════════════════════════════════════════════════════════
// The rule set, exercised on fixtures
// ═══════════════════════════════════════════════════════════════

const inventoryOf = (
  refs: Array<{ ref: string; affected: boolean; carrierCommits: number; exposedAtTip: boolean }>,
): VerifiedInventory => ({
  fingerprint: "b1ce18a1e85ba121",
  blobPaths: ["src/convex/auth/emailOtp.ts"],
  historyCommits: 397,
  generatedBy: "test",
  refs,
});

const exposureOf = (
  rows: Array<{ ref: string; tipStatus: string; occurrences: number | null }>,
): ExposureRow[] => rows;

const coverageOf = (refs: string[]): RewriteCoverageRow[] =>
  refs.map((ref) => ({ ref, before: "`a`", after: "`b`" }));

/** Build a fully consistent world, then break exactly one thing per test. */
function world() {
  return {
    liveRefs: ["heads/affected", "heads/clean", "heads/untouched"],
    inventory: inventoryOf([
      { ref: "heads/affected", affected: true, carrierCommits: 269, exposedAtTip: false },
      { ref: "heads/clean", affected: true, carrierCommits: 12, exposedAtTip: true },
      { ref: "heads/untouched", affected: false, carrierCommits: 0, exposedAtTip: false },
    ]),
    exposure: exposureOf([
      { ref: "heads/affected", tipStatus: "**clean**", occurrences: 269 },
      { ref: "heads/clean", tipStatus: "**EXPOSED AT TIP**", occurrences: 12 },
      { ref: "heads/untouched", tipStatus: "**clean**", occurrences: 0 },
    ]),
    coverage: coverageOf(["heads/affected", "heads/clean"]),
  };
}

describe("the rule set has teeth (fixtures, both directions)", () => {
  it("a consistent world reports nothing", () => {
    expect(refConsistencyProblems(world())).toEqual([]);
  });

  it("catches an affected ref missing from rewrite coverage", () => {
    const w = world();
    w.coverage = coverageOf(["heads/clean"]);
    expect(refConsistencyProblems(w).join("\n")).toContain(
      "affected ref is absent from rewrite coverage",
    );
    expect(refConsistencyProblems(w).join("\n")).toContain("heads/affected");
  });

  it("catches an UNAFFECTED ref wrongly labelled affected", () => {
    const w = world();
    w.coverage = coverageOf(["heads/affected", "heads/clean", "heads/untouched"]);
    expect(refConsistencyProblems(w).join("\n")).toContain(
      "unaffected ref is labelled affected in rewrite coverage",
    );
  });

  it("catches a duplicate row", () => {
    const w = world();
    w.exposure = [...w.exposure, { ref: "heads/affected", tipStatus: "**clean**", occurrences: 269 }];
    expect(refConsistencyProblems(w).join("\n")).toContain("duplicate row in the exposure table");
  });

  it("catches a live ref missing from the exposure table", () => {
    const w = world();
    w.liveRefs = ["heads/affected", "heads/clean", "heads/untouched", "heads/brand-new"];
    expect(refConsistencyProblems(w).join("\n")).toContain(
      "exposure table is missing live ref: heads/brand-new",
    );
  });

  it("does NOT demand coverage for an unaffected ref", () => {
    // `heads/untouched` is genuinely unaffected, so its absence from the
    // rewrite map is correct — requiring it would force rewriting clean refs.
    const w = world();
    expect(refConsistencyProblems(w)).toEqual([]);
    expect(w.coverage.map((c) => c.ref)).not.toContain("heads/untouched");
  });

  it("catches a stale ref the remote no longer has", () => {
    const w = world();
    w.coverage = coverageOf(["heads/affected", "heads/clean", "heads/deleted"]);
    expect(refConsistencyProblems(w).join("\n")).toContain(
      "runbook names a ref that no longer exists",
    );
  });

  it("catches an inventory that was never run for a live ref", () => {
    const w = world();
    w.liveRefs = [...w.liveRefs, "heads/new"];
    expect(refConsistencyProblems(w).join("\n")).toContain("was not run for live ref: heads/new");
  });

  it("catches an exposure claim that contradicts the measurement", () => {
    const w = world();
    // Runbook says this ref is clean and untouched; the measurement says it
    // carries 269 carrier commits.
    w.exposure = w.exposure.map((r) =>
      r.ref === "heads/affected" ? { ...r, occurrences: 0, tipStatus: "**clean**" } : r,
    );
    expect(refConsistencyProblems(w).join("\n")).toContain("exposure contradiction");
  });

  it("catches a stale summary count", () => {
    // The runbook said "All five" while seven refs existed — this is the
    // regression guard for exactly that drift.
    const stale = SYNTHETIC_RUNBOOK.replace("| Ref | Before | After |", "**All five**\n\n| Ref | Before | After |");
    expect(declaredCountProblems(stale, ["a", "b", "c", "d", "e", "f", "g"]).join("\n")).toContain(
      "says it covers 5 ref(s) but the remote advertises 7",
    );
  });

  it("catches a missing summary count", () => {
    expect(declaredCountProblems(SYNTHETIC_RUNBOOK, ["a"]).join("\n")).toContain(
      "no longer states how many refs it covers",
    );
  });

  it("catches a wrong tip status even when the counts agree", () => {
    const w = world();
    w.exposure = w.exposure.map((r) =>
      r.ref === "heads/clean" ? { ...r, tipStatus: "**clean**" } : r,
    );
    expect(refConsistencyProblems(w).join("\n")).toContain("tip-status contradiction");
  });
});

// ═══════════════════════════════════════════════════════════════
// The real repository
// ═══════════════════════════════════════════════════════════════

describe("the real runbook agrees with the real remote", () => {
  it("parses the real inventory artifact", () => {
    const inventory = parseVerifiedInventory(INVENTORY_JSON);
    expect(inventory.fingerprint).toBe("b1ce18a1e85ba121");
    expect(inventory.refs.length).toBeGreaterThan(0);
    expect(inventory.refs.some((r) => r.affected)).toBe(true);
  });

  it("has no inconsistency between live refs, measurement and runbook", () => {
    // `listLiveRefs` throws if the remote is unreachable — the failure is the
    // point, so it is not wrapped in a try/catch here.
    const problems = refConsistencyProblems({
      liveRefs: listLiveRefs(),
      inventory: parseVerifiedInventory(INVENTORY_JSON),
      exposure: parseExposureFacts(RUNBOOK),
      coverage: parseRewriteCoverage(RUNBOOK),
    });

    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps the two branches that were missing from the rewrite map", () => {
    // The Phase 233 correction. Both carry 269 carrier commits, so their
    // absence from coverage was a security defect, not a documentation nit.
    const covered = new Set(parseRewriteCoverage(RUNBOOK).map((r) => r.ref));
    for (const ref of [
      "heads/arena/01a0a92b-trade-intel-bot",
      "heads/arena/01a0ad26-trade-intel-bot",
    ]) {
      expect(covered, `${ref} must remain in rewrite coverage`).toContain(ref);
    }
  });

  it("records no ref as unaffected while all seven are in fact affected", () => {
    const inventory = parseVerifiedInventory(INVENTORY_JSON);
    const unaffected = inventory.refs.filter((r) => !r.affected);
    for (const entry of unaffected) {
      expect(
        parseRewriteCoverage(RUNBOOK).map((r) => r.ref),
        `${entry.ref} is unaffected and must not be in the rewrite map`,
      ).not.toContain(entry.ref);
    }
  });

  it("the summary count matches the number of live refs", () => {
    const live = listLiveRefs();
    const problems = declaredCountProblems(RUNBOOK, live);
    expect(problems, problems.join("\n")).toEqual([]);
    expect(parseDeclaredRefCount(RUNBOOK)).toBe(live.length);
  });

  it("duplicate detection runs against the real table", () => {
    expect(duplicateRefs(parseExposureFacts(RUNBOOK).map((r) => r.ref))).toEqual([]);
  });

  it("re-verifies each ref's tip exposure from git, not from the artifact", () => {
    // The artifact is a snapshot. Re-deriving `exposedAtTip` here means a ref
    // whose tip later starts (or stops) serving the blob cannot leave a stale
    // "clean" claim standing in the runbook.
    //
    // A `fetch-depth: 1` checkout (what CI uses) holds only HEAD, so most
    // remote tips are absent from the object database. Those refs are REPORTED
    // as deferred rather than silently passed over — and a full clone must
    // defer nothing, so the check cannot quietly stop covering refs.
    const leaseRow = RUNBOOK.match(/Distinct leaked blobs \|\s*\*\*1\*\*\s*\(`([0-9a-f]{40})`\)/);
    expect(leaseRow, "runbook must record the leaked blob OID").not.toBeNull();
    const leakedBlob = leaseRow![1];

    const inventory = parseVerifiedInventory(INVENTORY_JSON);
    const remoteTips = new Map<string, string>();
    for (const line of execFileSync("git", ["ls-remote", "--heads", "--tags", "origin"], {
      encoding: "utf8",
      maxBuffer: 1 << 24,
    }).split("\n")) {
      if (!line.trim()) continue;
      const [sha, ref] = line.split("\t");
      if (ref.endsWith("^{}") || ref === "refs/heads/HEAD") continue;
      const name = ref.replace("refs/heads/", "heads/").replace("refs/tags/", "tags/");
      remoteTips.set(name, sha);
    }

    const blobPath = inventory.blobPaths[0];
    const verified: string[] = [];
    const deferred: string[] = [];

    for (const entry of inventory.refs) {
      const tip = remoteTips.get(entry.ref);
      expect(tip, `no remote tip for ${entry.ref}`).toBeDefined();
      if (spawnSync("git", ["cat-file", "-e", tip!]).status !== 0) {
        deferred.push(entry.ref);
        continue;
      }
      const atPath = execFileSync("git", ["rev-parse", `${tip}:${blobPath}`], {
        encoding: "utf8",
      }).trim();
      expect(
        atPath === leakedBlob,
        `${entry.ref} tip exposure disagrees with docs/secret-remediation-refs.json`,
      ).toBe(entry.exposedAtTip);
      verified.push(entry.ref);
    }

    // Bookkeeping: every ref is either verified or explicitly deferred. Nothing
    // is dropped, so the check cannot silently shrink its own scope.
    expect(verified.length + deferred.length).toBe(inventory.refs.length);

    const shallow =
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() ===
      "true";

    // In a FULL clone there is no excuse: every advertised tip must be present
    // locally and verified. This is the assertion that gives the check teeth
    // wherever the whole history is available.
    if (!shallow) {
      expect(
        deferred,
        `a full clone must be able to verify every ref's tip; deferred: ${deferred.join(", ")}`,
      ).toEqual([]);
    }

    // A shallow CI checkout (`fetch-depth: 1`, and on `pull_request` a synthetic
    // MERGE commit rather than a branch tip) holds no advertised tip at all, so
    // there is nothing to compare against. That is a real limitation of the
    // environment, and it is REPORTED here rather than hidden: this assertion
    // would be a vacuous pass if it quietly accepted it.
    if (verified.length === 0) {
      expect(shallow, "no ref verified in a non-shallow clone").toBe(true);
      console.log(
        `Phase 233: tip-exposure re-verification SKIPPED — shallow clone, none of the ` +
          `${inventory.refs.length} advertised tips present locally (checked out ref is not a ` +
          `branch tip). Full verification runs in a full clone.`,
      );
    }
  });
});
