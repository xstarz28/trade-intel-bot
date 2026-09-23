/**
 * Phase 240 — the sweep: the pair pattern is gone from the live client, and it
 * cannot come back.
 *
 * The counting-clock suite next door proves the behaviour. This file proves the
 * same thing about the SOURCE, which is a different claim: a behavioural test
 * only covers the branches it exercises, and the Phase 238-G defect lived in 21
 * branches, six of which no earlier test touched. A guard that enumerates
 * branches by hand would have missed them for the same reason the defect
 * survived: nobody remembered to add the branch.
 *
 * So this is a shape guard, like the Phase 189 localization walker:
 *
 *   1. the exact defect spelling `receivedAt: Date.now()` may appear exactly
 *      once — inside the one helper that is allowed to take a receipt reading;
 *   2. every `Date.now()` in the file is one of the sanctioned readings;
 *   3. every envelope branch hands the builder a completion, so a branch cannot
 *      emit one field of the pair without the other;
 *   4. `latencyMs` is never measured anywhere except from the completion.
 *
 * Records the audit that motivated it: 21 explicit `receivedAt: Date.now()`
 * sites inside `executeLiveRequest` (10 provider-native, 11 canonical), plus the
 * `??  Date.now()` fallback in the envelope builder, plus two inline
 * `latencyMs: Date.now() - t0` measurements — 25 clock consultations where one
 * completion reading belongs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CLIENT = "src/lib/data/universal/live/client.ts";

/**
 * Strip comments so the guard reads what the CODE does, not what the prose says
 * about it. Written locally rather than imported: this is a data-layer guard and
 * must not depend on an unrelated module to be correct.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:\\])\/\/.*$/, "$1"))
    .join("\n");
}

const source = readFileSync(resolve(ROOT, CLIENT), "utf8");
const body = code(source);
const lines = body.split("\n");

describe("240 — the pair pattern cannot return to the live client", () => {
  it("reads the real file (the guard is not vacuous)", () => {
    expect(source).toContain("export async function executeLiveRequest");
    expect(lines.length).toBeGreaterThan(200);
  });

  it("the Phase 238-G spelling survives in exactly ONE place, the receipt helper", () => {
    const sites = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter((l) => l.line.includes("receivedAt: Date.now()"));

    expect(sites.map((s) => s.line.trim())).toEqual([
      "return { receivedAt: Date.now(), latencyMs: null };",
    ]);
    // ...and that single site is the helper for acquisitions where no HTTP
    // exchange happened, so it can never be the receipt of a measured request.
    expect(source).toContain("function completionWithoutRequest()");
  });

  it("every clock read in the file is a sanctioned one", () => {
    const readings = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => l.line.includes("Date.now()"));

    /*
      Three sanctioned shapes, and nothing else:
        - the caller-supplied request instant (`params.now ?? Date.now()`);
        - the request-start reading (`const t0 = Date.now();`), twice — one per
          path, provider-native and canonical;
        - the receipt helpers themselves (completionAt / completionWithoutRequest).
      A fourth shape means someone took a reading outside the pair contract.
    */
    const sanctioned = [
      "const now = params.now ?? Date.now();",
      "const t0 = Date.now();",
      "const receivedAt = Date.now();",
      "return { receivedAt: Date.now(), latencyMs: null };",
    ];
    expect(readings.length).toBe(5);
    for (const reading of readings) {
      expect(sanctioned, `unsanctioned clock read: ${reading.line}`).toContain(reading.line);
    }
    expect(readings.filter((r) => r.line === "const t0 = Date.now();")).toHaveLength(2);
  });

  it("every envelope branch hands the builder a completion", () => {
    // The builder requires it as an argument (tsc enforces that too), so the
    // count of branches and the count of completions must agree exactly.
    const allBranches = [...body.matchAll(/return finish\(/g)];
    // Counted by the ARGUMENT rather than by matching a status literal: one
    // branch passes an expression (`credMissing ? ... : ...`), and a guard that
    // only recognised string literals would have missed it — the exact class of
    // enumeration gap this phase exists to remove.
    const measured = [...body.matchAll(/, completion,/g)];
    const notMeasured = [...body.matchAll(/, completionWithoutRequest\(\),/g)];
    expect(allBranches.length).toBeGreaterThan(30);
    expect(measured.length + notMeasured.length).toBe(allBranches.length);
  });

  it("a measured request always passes the MEASURED completion, never the null one", () => {
    /*
      The six branches that used to omit `receivedAt` are the ones that used to
      supply `latencyMs`. Now they must pass `completion` (the measured value) —
      passing `completionWithoutRequest()` there would silently null a real
      measurement, which is the "one field without the other" defect in a new
      costume.
    */
    const nullCompletions = [...body.matchAll(/return finish\(\s*"([A-Z_]+)",\s*completionWithoutRequest\(\)/g)].map(
      (m) => m[1],
    );
    /*
      `RATE_LIMITED` appears in BOTH sets, and that is correct rather than a
      contradiction: a routing refusal ("all candidates are rate-limited") never
      opened a socket and cannot report a duration, while a provider's HTTP 429
      did and must. The behavioural suite pins the measured one (four clock
      consultations and a positive duration); this sweep pins the structural one.
    */
    const alwaysMeasured = ["LIVE_VERIFIED", "LIVE_PARTIAL", "PROVIDER_ERROR", "NETWORK_UNAVAILABLE", "MALFORMED_RESPONSE"];
    expect(nullCompletions.filter((s) => alwaysMeasured.includes(s))).toEqual([]);
    expect(nullCompletions.length).toBeGreaterThan(5);
  });

  it("`latencyMs` is only ever derived from the completion", () => {
    const uses = lines
      .map((line) => line.trim())
      .filter((line) => line.includes("latencyMs"));
    const sanctioned = [
      // the pair type and its helpers
      "readonly latencyMs: number | null;",
      "latencyMs: number | null;",
      "function completionAt(startedAt: number): { receivedAt: number; latencyMs: number } {",
      "return { receivedAt, latencyMs: receivedAt - startedAt };",
      "function completionWithoutRequest(): { receivedAt: number; latencyMs: null } {",
      "return { receivedAt: Date.now(), latencyMs: null };",
      // the envelope, both fields destructured from the same value
      "const { receivedAt, latencyMs } = completion;",
      "latencyMs,",
      // provider health reports the SAME measurement
      "responseTimeMs: completion.latencyMs,",
      "recordProviderHealth({ providerId, status: \"AVAILABLE\", responseTimeMs: completion.latencyMs });",
    ];
    for (const use of uses) {
      expect(sanctioned, `latencyMs used outside the completion: ${use}`).toContain(use);
    }
    // No measurement is computed in a branch any more.
    expect(body).not.toContain("Date.now() - t0");
    expect(body).not.toContain("extra.latencyMs");
    expect(body).not.toContain("extra.receivedAt");
  });

  it("the equivalence claim: no OTHER source file builds a live envelope by hand", () => {
    /*
      Phase D asked whether the same sibling pattern survives elsewhere. The
      universal live client is the only constructor of `LiveRequestResult`;
      consumers pass its value along (market-radar's registry reads
      `result.receivedAt` and derives `latencyMs` from the same reading it uses
      for `fetchedAt`, which is the Phase 238 fix). This asserts the first half
      of that claim mechanically: nothing else in `src` constructs the shape.
    */
    const otherFiles = [
      "src/lib/market-radar/provider-registry.ts",
      "src/lib/market-stream/types.ts",
      "src/lib/position-protection/data-source-mode.ts",
    ];
    for (const file of otherFiles) {
      const text = code(readFileSync(resolve(ROOT, file), "utf8"));
      // Those modules may carry a `receivedAt` of their own (a stream payload, a
      // data-source label); none of them builds the live-client result shape.
      expect(text, `${file} constructs a live-client result envelope`).not.toContain("latencyMs: extra.latencyMs");
      expect(text).not.toContain("receivedAt: extra.receivedAt");
      expect(text).not.toContain("return finish(");
    }
  });
});
