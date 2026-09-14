/**
 * Phase 208 — Evidence D report surface & auditability.
 *
 * Phase 207 left the decision-critical structures (`providerAttempts`,
 * `sweepLog`, `chargeableFind`) reachable only through `--json`, and the
 * verdict had two false-green holes:
 *
 *   1. `complete` was the ABSENCE of bad statuses, so a check carrying an
 *      unrecognised status ("SKIPPED", "OK", a typo) satisfied it and the run
 *      reported ACHIEVED.
 *   2. Zero recorded checks also satisfied it, so a run that observed nothing
 *      reported ACHIEVED with no evidence at all.
 *
 * These tests assert on the STRUCTURED report returned by the canonical
 * builder, not on strings in the harness source. Source-text assertions are
 * used only where the property genuinely is a source property (e.g. "the
 * harness must not build a second report object").
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Typed via scripts/lib/evidence-report.d.ts — no `any` cast.
import {
  buildReport,
  renderHumanReport,
  canonicalStatus,
  canonicalRows,
  summarize,
  isPass,
  CANONICAL_STATUSES,
} from "../../../scripts/lib/evidence-report.mjs";

const root = process.cwd();
const harnessSource = readFileSync(join(root, "scripts/evidence-d-harness.mjs"), "utf8");

type Row = { id: string; title: string; status: string; detail: string; recordedCount: number };
type Blocker = { track: string; id: string; status: string; classification: string; reason: string };

const D_DEFS = [
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10",
].map((id) => ({ id, title: `${id} title` }));

const E_DEFS = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"].map((id) => ({ id, title: `${id} title` }));

const allPass = (defs: { id: string }[]) =>
  defs.map((d) => ({ id: d.id, status: "PASS", detail: "observed" }));

const base = (over: Record<string, unknown> = {}) =>
  buildReport({
    definitions: D_DEFS,
    checks: allPass(D_DEFS),
    environment: "development",
    evidenceClass: "DEV_VERIFIED — NOT PRODUCTION EVIDENCE",
    deployment: { host: "x.convex.cloud", name: "x", declared: "dev" },
    ...over,
  });

/* ------------------------------------------------------------------ *
 * 1. Status invariants — the core of this phase
 * ------------------------------------------------------------------ */

describe("Phase 208 — a non-PASS status can never render as PASS", () => {
  it("only the exact token PASS is a pass; everything unrecognised is UNKNOWN", () => {
    expect(canonicalStatus("PASS")).toBe("PASS");
    expect(canonicalStatus("pass")).toBe("PASS");
    for (const raw of ["SKIPPED", "OK", "PASSED", "GREEN", "", null, undefined, 1, {}, "P A S S"]) {
      expect(canonicalStatus(raw), `${JSON.stringify(raw)} must not be a pass`).not.toBe("PASS");
      expect(isPass(raw)).toBe(false);
    }
  });

  it("maps the honest vocabulary without widening it", () => {
    expect(canonicalStatus("FAIL")).toBe("FAIL");
    expect(canonicalStatus("FAILED")).toBe("FAIL");
    expect(canonicalStatus("BLOCKED")).toBe("BLOCKED");
    expect(canonicalStatus("NOT_VERIFIED")).toBe("NOT_VERIFIED");
    expect(canonicalStatus("not verified")).toBe("NOT_VERIFIED");
    expect(new Set(CANONICAL_STATUSES)).toEqual(
      new Set(["PASS", "FAIL", "BLOCKED", "NOT_VERIFIED", "UNKNOWN"]),
    );
  });

  it.each([
    ["BLOCKED", "BLOCKED"],
    ["NOT_VERIFIED", "NOT_VERIFIED"],
    ["FAIL", "FAIL"],
    ["FAILED", "FAIL"],
  ])("a %s row survives rendering as %s and never becomes PASS", (raw, expected) => {
    const report = base({
      checks: [
        { id: "D1", status: raw, detail: "reason preserved" },
        ...allPass(D_DEFS.slice(1)),
      ],
    });
    const row = report.checks.find((c: Row) => c.id === "D1") as Row;
    expect(row.status).toBe(expected);
    expect(report.evidenceD).not.toBe("ACHIEVED");
    expect(report.productionEvidence).toBe(false);

    const text = renderHumanReport(report).join("\n");
    expect(text).toContain(`${expected.padEnd(13)} D1  `);
    expect(text).not.toContain(`PASS          D1  `);
    // The reason must survive into the human output.
    expect(text).toContain("reason preserved");
  });

  it("the worst status wins when one observation is recorded twice", () => {
    const report = base({
      checks: [
        { id: "D1", status: "FAIL", detail: "real failure" },
        { id: "D1", status: "PASS", detail: "later overwrite attempt" },
        ...allPass(D_DEFS.slice(1)),
      ],
    });
    const row = report.checks.find((c: Row) => c.id === "D1") as Row;
    expect(row.status).toBe("FAIL");
    expect(row.recordedCount).toBe(2);
    expect(report.integrity.duplicated).toContain("D1");
    expect(report.evidenceD).toBe("FAILED");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The two Phase 207 false-greens
 * ------------------------------------------------------------------ */

describe("Phase 208 — ACHIEVED requires positive evidence, not absence of bad news", () => {
  it("an unrecognised status can no longer produce ACHIEVED (regression)", () => {
    // Before Phase 208: neither failed nor blocked nor notVerified matched, so
    // `complete` was true and the run reported ACHIEVED with zero passes.
    const report = base({ checks: D_DEFS.map((d) => ({ id: d.id, status: "SKIPPED", detail: "x" })) });
    expect(report.summary.passed).toBe(0);
    expect(report.summary.unknown).toBe(10);
    expect(report.evidenceD).toBe("INCOMPLETE");
    expect(report.integrity.unrecognised).toHaveLength(10);
    expect(renderHumanReport(report).join("\n")).toContain("UNRECOGNISED STATUS");
  });

  it("recording nothing at all can no longer produce ACHIEVED (regression)", () => {
    const report = base({ checks: [] });
    expect(report.evidenceD).toBe("INCOMPLETE");
    expect(report.summary.blocked).toBe(10);
    expect(report.integrity.missing).toEqual(D_DEFS.map((d) => d.id));
  });

  it("a missing observation is rendered BLOCKED rather than dropped", () => {
    const report = base({ checks: allPass(D_DEFS.slice(0, 9)) });
    expect(report.checks).toHaveLength(10);
    const d10 = report.checks.find((c: Row) => c.id === "D10") as Row;
    expect(d10.status).toBe("BLOCKED");
    expect(d10.detail).toMatch(/Absence of a result is not\s+evidence/);
    expect(report.evidenceD).toBe("INCOMPLETE");
  });

  it("ACHIEVED requires every declared observation to be a real PASS", () => {
    const report = base();
    expect(report.summary.passed).toBe(10);
    expect(report.evidenceD).toBe("ACHIEVED");
    expect(report.evidenceClass).not.toMatch(/INCOMPLETE/);
  });

  it("summarize never counts an unknown status as passed", () => {
    const s = summarize([
      { status: "PASS" }, { status: "SKIPPED" }, { status: "BLOCKED" }, { status: "" },
    ]);
    expect(s.passed).toBe(1);
    expect(s.unknown).toBe(2);
    expect(s.blocked).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 3. productionEvidence
 * ------------------------------------------------------------------ */

describe("Phase 208 — productionEvidence needs every production condition at once", () => {
  const prod = {
    environment: "production",
    evidenceClass: "PRODUCTION_EVIDENCE",
    claimsProduction: true,
    authMechanism: "email-otp",
  };

  it("is true only when the run is complete, production, claimed and OTP-authenticated", () => {
    expect(base(prod).productionEvidence).toBe(true);
  });

  it.each([
    ["a dev deployment", { ...prod, environment: "development" }],
    ["an unclaimed run", { ...prod, claimsProduction: false }],
    ["a non-production class", { ...prod, evidenceClass: "DEV_VERIFIED — NOT PRODUCTION EVIDENCE" }],
    ["anonymous auth", { ...prod, authMechanism: "anonymous (development)" }],
  ])("is false for %s", (_label, over) => {
    expect(base(over).productionEvidence).toBe(false);
  });

  it("is false whenever any single observation is unresolved, even on production", () => {
    const report = base({
      ...prod,
      checks: [{ id: "D1", status: "NOT_VERIFIED", detail: "quiet" }, ...allPass(D_DEFS.slice(1))],
    });
    expect(report.productionEvidence).toBe(false);
    expect(renderHumanReport(report).join("\n")).toContain("NOT production release evidence");
  });
});

/* ------------------------------------------------------------------ *
 * 4. JSON / human parity
 * ------------------------------------------------------------------ */

describe("Phase 208 — the two output modes render one canonical object", () => {
  const report = base({
    checks: [
      { id: "D10", status: "NOT_VERIFIED", detail: "only the acquisition-stamped provider answered" },
      ...allPass(D_DEFS.slice(0, 9)),
    ],
    providerAttempts: [
      {
        provider: "okx", dataset: "order-book", instrument: "BTC-USDT",
        access: "public (no credential)", basis: "exchange ts field",
        acquired: false, observedAt: null, acquisition: null, failure: "ECONNRESET",
      },
    ],
    sweepLog: [{ instrument: "BTC-USDT", instType: "SPOT", status: "DELIVERED", recommendation: "WAIT", consumed: 0 }],
    sweepLimit: 25,
    entitlementDefinitions: E_DEFS,
    entitlementChecks: E_DEFS.map((d) => ({ id: d.id, status: "PASS", detail: "ok" })),
  });
  const text = renderHumanReport(report).join("\n");

  it("exposes every decision-critical field in JSON", () => {
    const json = JSON.parse(JSON.stringify(report));
    for (const key of [
      "schemaVersion", "evidenceD", "evidenceClass", "environment", "deployment",
      "productionEvidence", "configSource", "authMechanism", "capturedAt", "durationMs",
      "transportCalls", "summary", "integrity", "checks", "providerEvidence", "sweep",
      "entitlementStateMachine", "safetyProbes", "blockers",
    ]) {
      expect(json, `JSON must expose ${key}`).toHaveProperty(key);
    }
    expect(json.deployment).toHaveProperty("host");
    expect(json.sweep).toHaveProperty("chargeableFind");
    expect(json.providerEvidence).toHaveProperty("attempts");
  });

  it("surfaces the same decision-critical facts in the human report", () => {
    expect(text).toContain("x.convex.cloud");
    expect(text).toContain("[development]");
    for (const d of D_DEFS) expect(text, `human report must list ${d.id}`).toContain(d.id);
    for (const e of E_DEFS) expect(text, `human report must list ${e.id}`).toContain(e.id);
    expect(text).toContain("PROVIDER ATTEMPTS");
    expect(text).toContain("okx/order-book");
    expect(text).toContain("failure=ECONNRESET");
    expect(text).toContain("CHARGEABLE-SIGNAL SWEEP");
    expect(text).toContain("BTC-USDT");
    expect(text).toContain("REMAINING BLOCKERS");
    expect(text).toContain("EVIDENCE D:");
    expect(text).toContain("ENTITLEMENT STATE MACHINE:");
  });

  it("states why a check is unresolved without sending the operator to the source", () => {
    expect(text).toContain("only the acquisition-stamped provider answered");
    const blockers = report.blockers as Blocker[];
    const d10 = blockers.find((b) => b.id === "D10")!;
    expect(d10.classification).toBe("NOT_VERIFIED");
    expect(d10.reason).toContain("acquisition-stamped");
  });

  it("every unresolved check appears in blockers, and no passing one does", () => {
    const unresolved = (report.checks as Row[]).filter((c) => c.status !== "PASS").map((c) => c.id);
    const listed = (report.blockers as Blocker[]).filter((b) => b.track === "D").map((b) => b.id);
    expect(listed.sort()).toEqual(unresolved.sort());
    const passing = (report.checks as Row[]).filter((c) => c.status === "PASS").map((c) => c.id);
    for (const id of passing) expect(listed).not.toContain(id);
  });

  it("builds the report exactly once and renders it in both modes", () => {
    // Parity is structural: there must be a single buildReport call feeding
    // both branches, not two hand-assembled payloads.
    expect([...harnessSource.matchAll(/buildReport\(/g)]).toHaveLength(1);
    expect(harnessSource).toMatch(/if \(asJson\) \{\s*\n\s*console\.log\(JSON\.stringify\(report, null, 2\)\);/);
    expect(harnessSource).toMatch(/for \(const l of renderHumanReport\(report\)\) console\.log\(l\);/);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Provider attempts & sweep visibility
 * ------------------------------------------------------------------ */

describe("Phase 208 — provider attempts cannot disappear silently", () => {
  it("records provider, dataset, instrument, access, basis, outcome and failure", () => {
    const report = base({
      providerAttempts: [
        {
          provider: "okx", dataset: "order-book", instrument: "BTC-USDT",
          access: "public (no credential)", basis: "exchange ts field",
          acquired: true, observedAt: 1_700_000_000_000, acquisition: "fresh", failure: null,
        },
      ],
    });
    const a = report.providerEvidence.attempts[0];
    for (const k of ["provider", "dataset", "instrument", "access", "basis", "acquired", "observedAt", "acquisition", "failure"]) {
      expect(a, `attempt must record ${k}`).toHaveProperty(k);
    }
    const text = renderHumanReport(report).join("\n");
    expect(text).toContain("basis=exchange ts field");
    expect(text).toContain("2023-11-14T22:13:20.000Z");
  });

  it("an unavailable provider is never rendered as acquired", () => {
    const report = base({
      providerAttempts: [
        { provider: "twelve-data", dataset: "candles", instrument: "EURUSD", access: "requires TWELVE_DATA_API_KEY", basis: "acquisition time", acquired: false, observedAt: null, acquisition: null, failure: "MISSING_CREDENTIAL" },
      ],
    });
    const text = renderHumanReport(report).join("\n");
    expect(text).toContain("failed  ");
    expect(text).toContain("observedAt=none");
    expect(text).toContain("failure=MISSING_CREDENTIAL");
    expect(text).not.toMatch(/acquired twelve-data/);
  });

  it("says so explicitly when no provider was probed at all", () => {
    const text = renderHumanReport(base({ providerAttempts: [] })).join("\n");
    expect(text).toContain("PROVIDER ATTEMPTS");
    expect(text).toContain("none recorded");
  });

  it("the harness still feeds real attempts into the report", () => {
    expect(harnessSource).toMatch(/providerAttempts: safety\.providerAttempts \?\? \[\]/);
  });
});

describe("Phase 208 — the sweep log is auditable", () => {
  const report = base({
    sweepLimit: 3,
    sweepLog: [
      { instrument: "BTC-USDT", instType: "SPOT", status: "DELIVERED", recommendation: "WAIT", consumed: 0 },
      { instrument: "ETH-USDT-SWAP", instType: "SWAP", status: "DELIVERED", recommendation: "NO_TRADE", consumed: 0 },
      { note: "discovery returned no live instruments", error: "ECONNRESET" },
    ],
  });

  it("shows every attempted candidate with its provider-native id and outcome", () => {
    const text = renderHumanReport(report).join("\n");
    expect(text).toContain("BTC-USDT");
    expect(text).toContain("ETH-USDT-SWAP");
    expect(text).toContain("type=SWAP");
    expect(text).toContain("recommendation=NO_TRADE");
    expect(text).toContain("consumed=0");
    expect(report.sweep.attempted).toBe(2);
    expect(report.sweep.limit).toBe(3);
  });

  it("surfaces a skipped/failed candidate's reason instead of hiding it", () => {
    const text = renderHumanReport(report).join("\n");
    expect(text).toContain("note: discovery returned no live instruments");
    expect(text).toContain("ECONNRESET");
  });

  it("the harness still feeds the real sweep log into the report", () => {
    expect(harnessSource).toMatch(/sweepLog: safety\.sweepLog \?\? \[\]/);
    expect(harnessSource).toMatch(/chargeableFind: safety\.chargeableFind \?\? null/);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Chargeable find
 * ------------------------------------------------------------------ */

describe("Phase 208 — chargeableFind is honest in both directions", () => {
  it("exposes a natural find with auditable provenance", () => {
    const report = base({
      sweepLimit: 25,
      sweepLog: [{ instrument: "SOL-USDT", instType: "SPOT", status: "DELIVERED", recommendation: "BUY", consumed: 1 }],
      chargeableFind: { instrument: "SOL-USDT", recommendation: "BUY", consumed: 1 },
    });
    expect(report.sweep.chargeableFind).toEqual({ instrument: "SOL-USDT", recommendation: "BUY", consumed: 1 });
    expect(report.sweep.marketLimitation).toBeNull();
    const text = renderHumanReport(report).join("\n");
    expect(text).toContain("NATURAL CHARGEABLE SIGNAL: SOL-USDT → BUY");
    expect(report.blockers.some((b: Blocker) => b.track === "MARKET")).toBe(false);
  });

  it("is null with an explicit market-condition note when none was found", () => {
    const report = base({
      sweepLimit: 25,
      sweepLog: [{ instrument: "BTC-USDT", status: "DELIVERED", recommendation: "WAIT", consumed: 0 }],
    });
    expect(report.sweep.chargeableFind).toBeNull();
    expect(report.sweep.marketLimitation).toMatch(/market condition, not a defect/);
    expect(report.sweep.marketLimitation).toMatch(/NOT_VERIFIED rather than FAIL/);
    const market = (report.blockers as Blocker[]).find((b) => b.track === "MARKET")!;
    expect(market.classification).toBe("MARKET_CONDITION");
  });

  it("a quiet market is never rendered as a D5/D7/D8 failure", () => {
    const report = base({
      checks: [
        ...allPass(D_DEFS.filter((d) => !["D5", "D7", "D8"].includes(d.id))),
        { id: "D5", status: "NOT_VERIFIED", detail: "no chargeable signal" },
        { id: "D7", status: "NOT_VERIFIED", detail: "ceiling never reached" },
        { id: "D8", status: "NOT_VERIFIED", detail: "no LOCKED payload" },
      ],
      sweepLog: [{ instrument: "BTC-USDT", status: "DELIVERED", recommendation: "WAIT", consumed: 0 }],
    });
    expect(report.summary.failed).toBe(0);
    expect(report.evidenceD).toBe("INCOMPLETE");
    for (const id of ["D5", "D7", "D8"]) {
      expect((report.checks as Row[]).find((c) => c.id === id)!.status).toBe("NOT_VERIFIED");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7. Track separation and secret hygiene
 * ------------------------------------------------------------------ */

describe("Phase 208 — D and E verdicts stay separate", () => {
  it("a failing E-track never changes the D verdict", () => {
    const report = base({
      entitlementDefinitions: E_DEFS,
      entitlementChecks: E_DEFS.map((d) => ({ id: d.id, status: d.id === "E7" ? "FAIL" : "PASS", detail: "x" })),
    });
    expect(report.entitlementStateMachine.verdict).toBe("FAILED");
    expect(report.evidenceD).toBe("ACHIEVED");
    expect(report.summary.failed).toBe(0);
  });

  it("a failing D-track never changes the E verdict", () => {
    const report = base({
      checks: [{ id: "D1", status: "FAIL", detail: "x" }, ...allPass(D_DEFS.slice(1))],
      entitlementDefinitions: E_DEFS,
      entitlementChecks: E_DEFS.map((d) => ({ id: d.id, status: "PASS", detail: "x" })),
    });
    expect(report.evidenceD).toBe("FAILED");
    expect(report.entitlementStateMachine.verdict).toBe("VERIFIED");
  });

  it("E-track passes can never substitute for a missing D-track pass", () => {
    // M14: `passed === definitions.length || entitlementChecks.length > 0`
    // would let a fully green E-track carry an unresolved D-track to ACHIEVED.
    const report = base({
      checks: [
        { id: "D1", status: "NOT_VERIFIED", detail: "quiet market" },
        ...allPass(D_DEFS.slice(1)),
      ],
      entitlementDefinitions: E_DEFS,
      entitlementChecks: E_DEFS.map((d) => ({ id: d.id, status: "PASS", detail: "ok" })),
    });
    expect(report.entitlementStateMachine.verdict).toBe("VERIFIED");
    expect(report.evidenceD).toBe("INCOMPLETE");
    expect(report.productionEvidence).toBe(false);
    expect(report.summary.passed).toBe(9);

    // And the same D-track with NO E-track must reach the identical verdict:
    // the E-track contributes nothing either way.
    const withoutE = base({
      checks: [
        { id: "D1", status: "NOT_VERIFIED", detail: "quiet market" },
        ...allPass(D_DEFS.slice(1)),
      ],
    });
    expect(withoutE.evidenceD).toBe(report.evidenceD);
    expect(withoutE.summary).toEqual(report.summary);
  });

  it("reports NOT EXECUTED rather than VERIFIED when the E-track never ran", () => {
    const report = base({ entitlementDefinitions: E_DEFS, entitlementChecks: [] });
    expect(report.entitlementStateMachine.verdict).toBe("NOT EXECUTED");
    expect(report.entitlementStateMachine.checks).toHaveLength(0);
  });

  it("the D verdict is still computed only from the D-track", () => {
    expect(harnessSource).toMatch(/const failed = report\.summary\.failed;/);
    expect(harnessSource).toMatch(/const complete = report\.evidenceD === "ACHIEVED";/);
    expect(harnessSource).toMatch(/process\.exit\(failed > 0 \? 1 : complete \? 0 : 2\)/);
    expect(harnessSource).not.toMatch(/process\.exit\([^)]*entitlement/);
  });

  it("keeps D1-D10 and E1-E7 semantics unchanged", () => {
    const dIds = [...harnessSource.matchAll(/\{ id: "(D\d+)", title:/g)].map((m) => m[1]);
    expect(dIds).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"]);
    const eIds = [...harnessSource.matchAll(/\["(E\d)",\s*"/g)].map((m) => m[1]);
    expect(eIds).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  });
});

describe("Phase 208 — the report never leaks a secret", () => {
  it("carries no token, OTP or API key even when they exist in the run", () => {
    const report = base({
      configSource: ".env.local",
      providerAttempts: [
        { provider: "okx", dataset: "order-book", instrument: "BTC-USDT", access: "public (no credential)", basis: "exchange ts field", acquired: true, observedAt: 1, acquisition: "fresh", failure: null },
      ],
    });
    const serialized = JSON.stringify(report) + "\n" + renderHumanReport(report).join("\n");
    for (const pattern of [/Bearer\s+\S+/i, /eyJ[A-Za-z0-9_-]{10,}/, /\b\d{6}\b(?!\d)/]) {
      expect(serialized, `report must not contain ${pattern}`).not.toMatch(pattern);
    }
    expect(serialized).not.toMatch(/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i);
  });

  it("the harness never puts the session token into the report", () => {
    expect(harnessSource).not.toMatch(/token,\s*\n\s*capturedAt/);
    expect(harnessSource).not.toMatch(/report\.[a-zA-Z]*[Tt]oken/);
  });
});

/* ------------------------------------------------------------------ *
 * 8. canonicalRows contract
 * ------------------------------------------------------------------ */

describe("Phase 208 — canonicalRows keeps the denominator honest", () => {
  it("always returns exactly one row per declared definition", () => {
    const { rows, integrity } = canonicalRows(D_DEFS, [{ id: "D1", status: "PASS", detail: "" }]);
    expect(rows).toHaveLength(10);
    expect(integrity.expected).toBe(10);
    expect(integrity.rendered).toBe(10);
    expect(integrity.missing).toHaveLength(9);
  });

  it("flags a recorded id that is not a declared observation", () => {
    const { integrity } = canonicalRows(D_DEFS, [
      ...allPass(D_DEFS),
      { id: "D42", status: "PASS", detail: "invented" },
    ]);
    expect(integrity.extras).toEqual(["D42"]);
  });

  it("tolerates malformed input without inventing a pass", () => {
    const { rows } = canonicalRows(D_DEFS, [null, undefined, {}, { id: "D1" }] as never);
    expect(rows).toHaveLength(10);
    expect(rows.every((r: Row) => r.status !== "PASS")).toBe(true);
  });
});
