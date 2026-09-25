/**
 * Phase 288 — the smoke must be able to say WHY a domain came back empty.
 *
 * The Phase-287 run reported STOCK as "discovery succeeded but listed no live
 * equity instrument" while the Twelve Data adapter had already published its
 * own per-catalog report (`completeness`, `pagesFetched`, `failedPage`, and the
 * provider's message for a rejected page). The smoke discarded all of it, so a
 * zero-row catalog, a plan/credit rejection, a parser that skipped rows and a
 * transport failure were indistinguishable — the verdict named no cause and no
 * fix. The same was true of the runtime side: every failing acquisition leg had
 * computed its own reason and the smoke never read one.
 *
 * These tests pin the two consumers: `discoveryDiagnosis` (provider report) and
 * `failingLegText`/`withFailingLegs` (runtime leg reasons), plus the wiring that
 * carries them into the record and the summary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MAX_ATTEMPTS,
  MAX_CANDIDATE_ATTEMPTS,
  createProviderCircuit,
  discoveryDiagnosis,
  mostSevereVerdict,
  selectCandidates,
  failingLegText,
  withFailingLegs,
  discoverTwelveData,
  classifyDomain,
} from "../../../scripts/development-runtime-smoke.mjs";

const SMOKE = readFileSync("scripts/development-runtime-smoke.mjs", "utf8");

describe("phase 288 — discovery names its own cause", () => {
  it("reports a failed catalog with the provider's message", () => {
    const diagnosis = discoveryDiagnosis(
      {
        success: false,
        instruments: [],
        error: "Twelve Data discovery failed for all catalogs.",
        completeness: "FAILED",
        pagesFetched: 0,
        catalogs: [
          {
            path: "/stocks",
            assetClass: "equity",
            completeness: "FAILED",
            pagesFetched: 0,
            totalDiscovered: 0,
            failedPage: null,
          },
        ],
        warnings: ["/stocks returned HTTP 403: code 403 — this endpoint requires a paid plan."],
      },
      "equity",
    );
    expect(diagnosis).toContain("equity:");
    expect(diagnosis).toContain("Twelve Data discovery failed for all catalogs.");
    expect(diagnosis).toContain("catalog completeness FAILED");
    expect(diagnosis).toContain("/stocks");
    expect(diagnosis).toContain("403");
    expect(diagnosis).toContain("paid plan");
  });

  it("distinguishes a zero-row catalog from a failed one", () => {
    const diagnosis = discoveryDiagnosis(
      {
        success: true,
        instruments: [],
        error: null,
        completeness: "COMPLETE",
        pagesFetched: 1,
        catalogs: [
          {
            path: "/stocks",
            assetClass: "equity",
            completeness: "COMPLETE",
            pagesFetched: 1,
            totalDiscovered: 0,
            failedPage: null,
          },
        ],
        warnings: ["/stocks: skipped 12 row(s) missing identity fields."],
      },
      "equity",
    );
    expect(diagnosis).toContain("COMPLETE");
    expect(diagnosis).toContain("0 kept");
    expect(diagnosis).toContain("skipped 12 row(s) missing identity fields");
    expect(diagnosis).not.toContain("FAILED");
  });

  it("returns null when nothing is known (no invented cause)", () => {
    expect(discoveryDiagnosis(null, "equity")).toBeNull();
    expect(discoveryDiagnosis({ success: true, instruments: [], error: null }, "equity")).toBeNull();
  });

  it("carries the adapter report through the discovery call", async () => {
    const transport = {
      state: { calls: 0, lastError: null, blocked: false },
      query: async () => ({ ok: false, httpStatus: 0, transportError: "not used in this test" }),
      action: async () => ({
        ok: true,
        value: {
          success: false,
          provider: "twelve-data",
          instruments: [],
          error: "Twelve Data discovery failed for all catalogs.",
          warnings: ["/stocks returned HTTP 403."],
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          catalogs: [
            { path: "/stocks", assetClass: "equity", completeness: "FAILED", pagesFetched: 0, totalDiscovered: 0 },
          ],
        },
      }),
    };
    const discovery = await discoverTwelveData(transport as never, "token");
    expect(discovery.completeness).toBe("FAILED");
    expect(discovery.catalogs?.[0]?.path).toBe("/stocks");
    expect(discovery.warnings?.[0]).toContain("403");
  });

  it("the empty-candidate verdict uses the diagnosis, not a generic sentence", () => {
    // Source-level wiring: the branch must build the reason FROM the report.
    expect(SMOKE).toContain("const diagnosis = discoveryDiagnosis(discovery, spec.assetClass)");
    expect(SMOKE).toContain("discovery returned no live ${spec.assetClass} instrument — ${diagnosis}");
  });
});

describe("phase 288 — the smoke reads the runtime's own leg reasons", () => {
  const evidence = {
    diagnostics: [
      { provider: "twelve-data", dataset: "ohlcv", mode: "rate-limited", acquired: false, attached: false, usedByEngine: false, reason: "[429] You have reached the API credits limit (8 credits used)" },
      { provider: "crypto-fundamentals", dataset: "crypto-fundamentals", mode: "unavailable", acquired: false, attached: false, usedByEngine: false, reason: "this asset has no verified DeFiLlama chain mapping in the repository — no slug is guessed" },
      { provider: "tickatlas", dataset: "calendar", mode: "observed-now", acquired: true, attached: true, usedByEngine: true, reason: null },
    ],
  };

  it("names the failing legs with their own reasons", () => {
    const text = failingLegText(evidence);
    expect(text).toContain("twelve-data/ohlcv: [429]");
    expect(text).toContain("crypto-fundamentals/crypto-fundamentals: this asset has no verified DeFiLlama chain mapping");
    // A leg that answered is never listed as failing.
    expect(text).not.toContain("tickatlas");
  });

  it("is bounded and null when nothing failed", () => {
    expect(failingLegText({ diagnostics: [evidence.diagnostics[2]] })).toBeNull();
    expect(failingLegText(null)).toBeNull();
    expect(failingLegText(evidence, 1)?.split("; ").length).toBe(1);
  });

  it("appends the leg diagnoses to an UNAVAILABLE verdict", () => {
    const verdict = classifyDomain({
      response: {
        status: "DELIVERED",
        entitlement: { authenticated: true },
        result: {
          instrument: "GAU/EUR",
          instrumentType: "commodity",
          technicalData: null,
          fundamentalAssessment: { available: true },
          unifiedIntelligence: {
            present: true,
            available: true,
            state: "fundamental_only",
            limitations: ["Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim."],
          },
          providerDiagnostics: evidence.diagnostics,
        },
      },
    });
    expect(verdict.headline).toBe("UNAVAILABLE");
    expect(verdict.reason).toContain("failing legs:");
    expect(verdict.reason).toContain("[429] You have reached the API credits limit");
    expect(withFailingLegs("headline only", null)).toBe("headline only");
  });
});

describe("phase 288 — the record and the summary carry the new detail", () => {
  it("stores the discovery report and the failing legs per domain", () => {
    expect(SMOKE).toContain("record.discovery = {");
    expect(SMOKE).toContain("record.failingLegs =");
    expect(SMOKE).toContain("failing leg      :");
    expect(SMOKE).toContain("discovery        : completeness=");
    expect(SMOKE).toContain("warning: ${w}");
  });

  it("keeps the smoke's own guarantees intact (no evidence sent, no localhost)", () => {
    // The phase-287 policy is unchanged: routing fields only, provider targets
    // only, no synthesized evidence.
    expect(SMOKE).toContain("clientEvidenceSent");
    expect(SMOKE).not.toMatch(/fetch\(\s*["'`]https?:\/\/localhost/);
    expect(SMOKE).toContain("EXPECTED_DEV_HOST");
  });
});

describe("phase 288 — a domain's bounded candidate policy", () => {
  it("keeps a documented default above one, with a hard ceiling", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(DEFAULT_MAX_ATTEMPTS).toBeLessThanOrEqual(4);
    expect(MAX_CANDIDATE_ATTEMPTS).toBeLessThanOrEqual(4);
  });

  it("selectCandidates never exceeds the ceiling and preserves provider order", () => {
    const discovery = {
      success: true,
      instruments: Array.from({ length: 10 }, (_, i) => ({
        providerInstrumentId: `C${i}/USD`,
        assetClass: "commodity",
        subType: "commodity_spot",
        tradingState: "TRADING",
      })),
    };
    const spec = {
      domain: "commodity",
      label: "COMMODITY",
      discovery: "twelve-data" as const,
      assetClass: "commodity",
    };
    const picked = selectCandidates(spec, discovery, 99);
    expect(picked.length).toBe(MAX_CANDIDATE_ATTEMPTS);
    expect(picked.map((c) => c.providerInstrumentId)).toEqual(["C0/USD", "C1/USD", "C2/USD"]);
  });

  it("does not repeat a provider after the circuit trips (no retry policy)", () => {
    const circuit = createProviderCircuit();
    expect(circuit.classify("twelve-data", "[429] rate limit exceeded")).toBe("RATE_LIMITED");
    expect(circuit.isTripped("twelve-data")?.kind).toBe("RATE_LIMITED");
    // Credential failures trip too; both are terminal for that provider.
    expect(circuit.classify("coinglass", "COINGLASS_API_KEY is missing")).toBe("CREDENTIAL_REQUIRED");
    expect(circuit.isTripped("coinglass")?.kind).toBe("CREDENTIAL_REQUIRED");
  });

  it("reports the most severe outcome of a domain's attempts", () => {
    const fail = { headline: "FAIL" as const, reason: "transport error: ECONNRESET" };
    const unavailable = { headline: "UNAVAILABLE" as const, reason: "no provider market evidence" };
    // A deployment failure on one candidate is never laundered into a milder
    // provider verdict by a later attempt.
    expect(mostSevereVerdict(unavailable, fail)).toBe(fail);
    expect(mostSevereVerdict(fail, unavailable)).toBe(fail);
    expect(mostSevereVerdict(unavailable, { headline: "PASS", reason: "real evidence" }).headline).toBe("UNAVAILABLE");
    expect(mostSevereVerdict(null, unavailable)).toBe(unavailable);
  });
});
