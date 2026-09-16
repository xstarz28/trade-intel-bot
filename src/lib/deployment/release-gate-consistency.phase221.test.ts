/**
 * Phase 221 — release-gate truthfulness and ordering.
 *
 * Pins the canonical blocker graph in docs/RELEASE-GATE.md so a later edit
 * cannot (a) declare readiness, (b) collapse CODE-READY / DEV-VERIFIED /
 * PRODUCTION-VERIFIED into one column, (c) reorder the release sequence so
 * the leaked credential outlives a release, or (d) let the history-rewrite
 * runbook drift from the refs that actually exist on the remote.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const gate = read("docs/RELEASE-GATE.md");
const p221 = gate.slice(gate.indexOf("## Phase 221"));
const runbook = read("docs/SECRET-REMEDIATION-RUNBOOK.md");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("Phase 221 — canonical section exists and governs", () => {
  it("is present, non-trivial and declares itself authoritative", () => {
    expect(p221.length).toBeGreaterThan(4000);
    expect(p221).toMatch(/authoritative from here/);
    expect(p221).toMatch(/No other gate document\s+may be created/);
  });

  it("never claims readiness anywhere in the section", () => {
    expect(p221).toMatch(/\*\*Verdict: NOT READY/);
    expect(p221).toMatch(/Release decision: NOT READY/);
    expect(flat(p221)).not.toMatch(/\b(release|production)[- ]ready\b(?! is a statement)/i);
    expect(flat(p221)).not.toMatch(/\bREADY FOR (PRODUCTION|RELEASE)\b/i);
  });

  it("states that no production verification exists", () => {
    expect(p221).toMatch(/PRODUCTION-VERIFIED\*\*.*\*\*none exists\*\*/);
  });
});

describe("Phase 221 — the four evidence tiers stay separate", () => {
  it("defines all four tiers", () => {
    for (const t of ["CODE-READY", "DEV-VERIFIED", "EXTERNAL PREREQ", "PRODUCTION-VERIFIED"]) {
      expect(p221).toContain(`**${t}**`);
    }
  });

  it("the blocker matrix has one column per tier and no PROD-VERIFIED cell reads PASS/VERIFIED", () => {
    const header = p221.split("\n").find((l) => l.startsWith("| ID | Blocker |"));
    expect(header).toBeTruthy();
    const cols = header!.split("|").map((c) => c.trim());
    expect(cols).toEqual(expect.arrayContaining(["CODE-READY", "DEV-VERIFIED", "PROD-VERIFIED"]));
    const prodIdx = cols.indexOf("PROD-VERIFIED");
    const matrix = p221.slice(p221.indexOf("### Blocker matrix"), p221.indexOf("### Dependency graph"));
    const rows = matrix.split("\n").filter((l) => /^\| [A-E]\d \|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(24);
    for (const r of rows) {
      const cell = r.split("|")[prodIdx].trim();
      expect(cell, r).not.toMatch(/\b(PASS|VERIFIED)\b/);
    }
  });

  it("the DEV ⇏ PROD table names every required non-implication", () => {
    const f = flat(p221);
    expect(f).toMatch(/DEV fact \| Does NOT prove/);
    expect(f).toMatch(/production sign-in works/);
    expect(f).toMatch(/production deployment enforces it/);
    expect(f).toMatch(/production Evidence D/);
    expect(f).toMatch(/only the issuer's 401\/403 proves that/);
    expect(f).toMatch(/release signing — every artifact is unsigned/);
  });
});

describe("Phase 221 — security chain is first and cannot be reordered", () => {
  const steps = p221
    .slice(p221.indexOf("### Release order"))
    .split("\n")
    .filter((l) => /^\d+\. /.test(l))
    .map((l) => l.replace(/^\d+\. /, ""));

  it("has 14 ordered steps", () => expect(steps).toHaveLength(14));

  it("revoke → 401/403 → rewrite → zero occurrences precede every deployment step", () => {
    const idx = (re: RegExp) => steps.findIndex((s) => re.test(s));
    const revoke = idx(/^Revoke the old Freebuff/);
    const proof = idx(/401\/403/);
    const rewrite = idx(/rehearsed rewrite/);
    const clean = idx(/--expect-clean/);
    const provision = idx(/Provision a production Convex/);
    const deploy = idx(/convex deploy/);
    expect(revoke).toBe(0);
    expect(proof).toBe(1);
    expect(rewrite).toBe(2);
    expect(clean).toBe(3);
    expect(provision).toBeGreaterThan(clean);
    expect(deploy).toBeGreaterThan(provision);
    expect(idx(/Final UAT/)).toBe(13);
  });

  it("does not accept HTTP 000 / timeout as revocation evidence", () => {
    expect(flat(p221)).toMatch(/000\/timeout\/200-elsewhere is not evidence/);
    expect(flat(p221)).not.toMatch(/revoked \(observed|revocation confirmed/i);
  });

  it("does not claim the rewrite was executed", () => {
    expect(flat(p221)).toMatch(/It remains unexecuted/);
    expect(flat(p221)).toMatch(/real repository and remote untouched/i);
    expect(runbook).toMatch(/Status remains \*\*BLOCKED on §2\*\*/);
  });
});

describe("Phase 221 — runbook refs match the refs that actually exist", () => {
  it("lists all five refs including the current working branch", () => {
    const table = runbook.slice(runbook.indexOf("### Refs the force-push will rewrite"), runbook.indexOf("## 4. Assertions"));
    for (const ref of [
      "heads/arena/01a08e67-trade-intel-bot",
      "heads/arena/01a0a5f5-trade-intel-bot",
      "heads/main",
      "heads/phase-157-live-discovery-lifecycle",
      "tags/rc-181",
    ]) {
      expect(table).toContain(`\`${ref}\``);
    }
    expect(table).toMatch(/\*\*All five\*\*/);
  });

  it("every branch/tag known to the local remote-tracking set appears in the runbook", () => {
    let refs: string[] = [];
    try {
      refs = execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/remotes/origin", "refs/tags"], { encoding: "utf8" })
        .split("\n").filter(Boolean)
        .map((r) => r.replace("refs/remotes/origin/", "heads/").replace("refs/tags/", "tags/"))
        .filter((r) => r !== "heads/HEAD");
    } catch { return; }
    for (const r of refs) expect(runbook, `runbook missing ref ${r}`).toContain(`\`${r}\``);
  });
});

describe("Phase 221 — Evidence D and Phase 184 remain unchanged", () => {
  it("Evidence D rows keep their statuses and semantics", () => {
    const f = flat(p221);
    expect(f).toMatch(/D1 \| NOT VERIFIED \/ BLOCKED/);
    expect(f).toMatch(/D5 \/ D7 \/ D8 \| NOT_VERIFIED — MARKET_CONDITION/);
    expect(f).toMatch(/D10 \| PASS \(dev\) \/ not verified \(prod\)/);
    expect(f).toMatch(/Evidence D: \*\*INCOMPLETE\*\* \(unchanged\)/);
    expect(f).toMatch(/forbids forcing one/);
  });

  it("Phase 184 is stated BLOCKED and not implied resolved", () => {
    expect(flat(p221)).toMatch(/Phase 184: \*\*BLOCKED\*\* \(unchanged\)/);
    expect(flat(p221)).not.toMatch(/Phase 184 (is )?(now )?(resolved|closed|complete)/i);
  });

  it("no dev value is offered as a production substitute", () => {
    expect(flat(p221)).toMatch(/Dev values are not to be substituted; the dev deployment is not to be promoted/);
  });
});
