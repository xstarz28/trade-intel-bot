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
  evidenceDigest,
  readResultEvidence,
  commodityMarketOf,
  runtimeMarkers,
  energyGateVerdict,
  ENERGY_PROBE_CANDIDATE_LIMIT,
  ENERGY_PROBE_MAX_CANDIDATE_LIMIT,
  ENERGY_PROBE_REPORT_IDENTITIES,
  ENERGY_PROBE_PAUSE_MS,
  probeEnergyGate,
  resolveCheckoutSha,
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

describe("phase 289 — the deployed runtime's evidence shape stays readable", () => {
  const commodityRecord = () => ({
    label: "COMMODITY",
    evidence: {
      fundamental: {
        present: true,
        available: true,
        domain: "commodity",
        state: "insufficient",
        provider: "twelve-data",
        summary:
          "Commodity physical evidence: inventories UNAVAILABLE — the only configured inventory feed (U.S. EIA weekly petroleum) is out of scope for this instrument.",
        dimensions: [
          { name: "inventories", status: "unavailable", role: "primary" },
          { name: "supply-demand", status: "unavailable", role: "primary" },
          { name: "futures-positioning", status: "positive", role: "secondary" },
          { name: "term-structure", status: "unavailable", role: "secondary" },
        ],
      },
      diagnostics: [
        {
          provider: "eia",
          dataset: "inventories",
          acquired: true,
          attached: true,
          usedByEngine: false,
          reason:
            "EIA WPSR series are the physical market of an energy commodity — deliberately not read for this bullion instrument.",
        },
        {
          provider: "tokenomist",
          dataset: "tokenomics",
          acquired: false,
          attached: false,
          usedByEngine: false,
          reason: "Tokenomist refused the request: HTTP 401 (credential)",
        },
      ],
    },
    discovery: {
      completeness: "PARTIAL",
      pagesFetched: 2,
      totalDiscovered: 41,
      catalogs: [
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", failedPage: null },
        { path: "/stocks", assetClass: "equity", completeness: "FAILED", failedPage: 1 },
      ],
      warnings: ["/stocks returned HTTP 403: code 403 — this endpoint requires a paid plan."],
    },
  });

  it("renders the delivered dimension names with their own status", () => {
    const digest = evidenceDigest(commodityRecord())!;
    expect(digest).toContain("domain=commodity");
    expect(digest).toContain("inventories=unavailable");
    expect(digest).toContain("futures-positioning=positive");
  });

  it("carries the engine's own domain-native text, not a product blurb", () => {
    const digest = evidenceDigest(commodityRecord())!;
    expect(digest).toContain("engine[");
    expect(digest).toContain("out of scope for this instrument");
  });

  it("shows a leg that was acquired and then deliberately not consumed", () => {
    const digest = evidenceDigest(commodityRecord())!;
    expect(digest).toContain("eia/inventories acquired=true attached=true used=false");
    expect(digest).toContain("deliberately not read");
  });

  it("exposes a failing leg's own classified reason (a credential rejection is not silence)", () => {
    const digest = evidenceDigest(commodityRecord())!;
    expect(digest).toContain("tokenomist/tokenomics acquired=false");
    expect(digest).toContain("HTTP 401");
  });

  it("reports the provider's discovery report, including an incomplete catalog", () => {
    const digest = evidenceDigest(commodityRecord())!;
    expect(digest).toContain("completeness=PARTIAL");
    expect(digest).toContain("incomplete=1");
    expect(digest).toContain("first=/stocks:FAILED");
    expect(digest).toContain("requires a paid plan");
  });

  it("is a bounded single line and never invents a section", () => {
    const huge = commodityRecord();
    huge.evidence.fundamental.summary = "x".repeat(5000);
    huge.evidence.fundamental.dimensions = Array.from({ length: 40 }, (_, i) => ({
      name: `dimension-${i}`,
      status: "unavailable",
      role: "primary",
    }));
    const digest = evidenceDigest(huge)!;
    expect(digest.length).toBeLessThanOrEqual(900);
    expect(digest).not.toContain("\n");
    // Nothing to report is null — not an empty annotation, not a guess.
    expect(evidenceDigest({ label: "CRYPTO" })).toBeNull();
    expect(evidenceDigest({ label: "CRYPTO", evidence: {} })).toBeNull();
    expect(evidenceDigest(null)).toBeNull();
  });

  it("reads the delivered dimensions out of the runtime result itself", () => {
    const evidence = readResultEvidence({
      fundamentalAssessment: {
        available: true,
        domain: "commodity",
        state: "insufficient",
        provider: "twelve-data",
        dimensions: [
          { name: "inventories", status: "unavailable", role: "primary" },
          { status: "ignored-without-a-name" },
        ],
      },
    });
    expect(evidence.fundamental.dimensions).toEqual([
      { name: "inventories", status: "unavailable", role: "primary" },
      { name: null, status: "ignored-without-a-name", role: null },
    ]);
  });

  it("resolves the harness commit itself, so a dispatcher/checkout mismatch cannot hide it", () => {
    // The run that exposed this: the workflow DEFINITION came from `main` (which
    // had no checkout-SHA plumbing) while the script was checked out at 7cec9f7…,
    // so the annotation said harnessCommit=unknown. Provenance must not depend on
    // which revision of the workflow file happens to execute.
    expect(
      resolveCheckoutSha({
        env: { XSTARZ_SMOKE_SOURCE_COMMIT: "abc1234" },
        runGit: () => {
          throw new Error("must not be called when an override is present");
        },
      }),
    ).toEqual({ sha: "abc1234", source: "XSTARZ_SMOKE_SOURCE_COMMIT (supplied to the harness)" });

    const fromGit = resolveCheckoutSha({
      env: {},
      cwd: "/repo",
      runGit: (dir: string) =>
        `${dir === "/repo" ? "7cec9f7aea35943cd624904106912d9595b28e5b" : "wrong"}\n`,
    });
    expect(fromGit.sha).toBe("7cec9f7aea35943cd624904106912d9595b28e5b");
    expect(fromGit.source).toBe("git rev-parse HEAD in the checkout the harness runs from");

    // No override and no readable checkout: "unknown" WITH its reason, never a guess.
    const none = resolveCheckoutSha({ env: {}, runGit: () => { throw new Error("not a repo"); } });
    expect(none.sha).toBeNull();
    expect(none.source).toContain("unknown");
    // A blank override is not an override.
    expect(
      resolveCheckoutSha({ env: { XSTARZ_SMOKE_SOURCE_COMMIT: "  " }, runGit: () => "deadbee" }).sha,
    ).toBe("deadbee");
    // And it is NEVER taken from the deployment's /version answer.
    expect(SMOKE).not.toMatch(/harnessCommit[^\n]*version\.version/);
    expect(SMOKE).toContain("const checkout = resolveCheckoutSha();");
  });

  it("reports which deployment answered, and never calls /version a revision", () => {
    // `/version` is the running CONVEX BACKEND version (a deployment health
    // signal), not this application's function bundle — an earlier revision of
    // this line printed a sourceCommit derived from GITHUB_SHA next to it, which
    // reads exactly like a revision claim. The label now says what it is, and the
    // checkout SHA is reported separately from the dispatch ref.
    expect(SMOKE).toContain('"Smoke target and runtime code paths"');
    expect(SMOKE).toContain("apiPlaneReachable=${version.ok}");
    expect(SMOKE).toContain("(running Convex backend version, NOT the function-bundle revision)");
    expect(SMOKE).toContain("harnessCommit=${");
    expect(SMOKE).toContain("checkout.sha ?? `unknown (${checkout.source})`");
    expect(SMOKE).toContain('dispatchRefSha=${process.env.GITHUB_SHA ?? "unknown"}');
    expect(SMOKE).not.toContain("sourceCommit=${process.env.GITHUB_SHA");
    expect(SMOKE).toContain("running Convex backend version (deployment health signal)");
  });

  it("keeps every domain in ONE always-visible annotation", () => {
    // GitHub does not return `notice` annotations through the check-run
    // annotations API, and it caps warning/error annotations per step, so a PASS
    // emitted as a notice was invisible while two lines per domain risked the
    // cap. The verdict (title) and the runtime's own evidence (body) are one
    // `warning`-level record; only a FAIL is an `error`.
    expect(SMOKE).toContain('const level = record.headline === "FAIL" ? "error" : "warning";');
    expect(SMOKE).toContain("· informational — ${digest}");
    expect(SMOKE).not.toContain('record.headline === "PASS" ? "notice"');
    expect(SMOKE).toContain("diagnostics: e.diagnostics,");
  });
});

describe("phase 289B — the energy-gate probe reads the deployed runtime's own resolution", () => {
  /** An energy instrument as the deployed runtime answers for one: group + feed consumed. */
  const ENERGY_EVIDENCE = {
    fundamental: {
      present: true,
      available: true,
      domain: "commodity",
      commodityProfile: {
        group: "energy",
        classificationSource: 'canonical registry entry "WTI" (WTI Crude Oil), tags [energy, futures]',
      },
      commodityMetrics: { inventoryLatest: 412_500, keys: ["inventoryLatest", "inventoryChange"] },
      dimensions: [
        { name: "inventories", status: "positive", role: "primary" },
        { name: "futures-positioning", status: "positive", role: "secondary" },
      ],
      evidenceProviders: ["U.S. Energy Information Administration", "twelve-data", "CFTC"],
      limitations: [],
      summary: "Inventory build: US crude stocks fell 2,600 thousand barrels.",
    },
    diagnostics: [
      { provider: "eia", dataset: "inventories", acquired: true, attached: true, usedByEngine: true, reason: null },
    ],
  };
  /** A bullion instrument: market resolved, petroleum feed deliberately not read. */
  const NON_ENERGY_EVIDENCE = {
    fundamental: {
      present: true,
      available: true,
      domain: "commodity",
      commodityProfile: {
        group: "unclassified",
        classificationSource: '"GAU/EUR" is not in the canonical instrument registry — generic physical-first commodity hierarchy applied',
      },
      commodityMetrics: null,
      dimensions: [
        { name: "inventories", status: "unavailable", role: "supporting" },
        { name: "supply-demand", status: "unavailable", role: "supporting" },
      ],
      evidenceProviders: ["US Treasury"],
      limitations: [
        "Inventory UNAVAILABLE — the only configured inventory feed is the U.S. EIA Weekly Petroleum Status Report (US petroleum stocks), which is physical market of an energy commodity, not of this unclassified instrument, so it is out of scope for this instrument.",
      ],
      summary: "Commodity physical evidence is limited to macro drivers.",
    },
    diagnostics: [
      { provider: "eia", dataset: "inventories", acquired: true, attached: true, usedByEngine: false, reason: null },
    ],
  };
  const sample = (over: Record<string, unknown>) => ({
    instrument: "X/USD",
    provider: "twelve-data",
    runtimeStatus: "DELIVERED",
    verdict: "UNAVAILABLE",
    reason: null,
    group: null,
    classificationSource: null,
    inventories: null,
    inventoryLatest: null,
    eiaEvidenceItems: 0,
    petroleumFeedScopeText: false,
    ...over,
  });

  it("reads the classification and the consumed metrics out of the runtime's answer", () => {
    const energy = commodityMarketOf(ENERGY_EVIDENCE);
    expect(energy.group).toBe("energy");
    expect(energy.inventories).toBe("positive");
    expect(energy.inventoryLatest).toBe(412_500);
    expect(energy.eiaEvidenceItems).toBe(1);

    const bullion = commodityMarketOf(NON_ENERGY_EVIDENCE);
    expect(bullion.group).toBe("unclassified");
    expect(bullion.inventories).toBe("unavailable");
    expect(bullion.inventoryLatest).toBeNull();
    expect(bullion.eiaEvidenceItems).toBe(0);
    expect(bullion.petroleumFeedScopeText).toBe(true);
  });

  it("fingerprints the Phase-288 code paths from the responses alone", () => {
    const markers = runtimeMarkers(ENERGY_EVIDENCE);
    expect(markers.diagnostics).toBe(1);
    expect(markers.commodityGroup).toBe("energy");
    // Never claimed when absent: a bare result fingerprints as nothing observed.
    const empty = runtimeMarkers(null);
    expect(empty.diagnostics).toBe(0);
    expect(empty.commodityGroup).toBeNull();
    expect(empty.calendarMappingGapObserved).toBe(false);
    expect(empty.petroleumFeedScopeObserved).toBe(false);
  });

  it("PASSes only with both directions proven by real readings", () => {
    const verdict = energyGateVerdict([
      sample({ instrument: "WTI/USD", ...commodityMarketOf(ENERGY_EVIDENCE) }),
      sample({ instrument: "GAU/EUR", ...commodityMarketOf(NON_ENERGY_EVIDENCE) }),
    ]);
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.summary).toContain("WTI/USD");
    expect(verdict.summary).toContain("GAU/EUR");
    expect(verdict.failures).toEqual([]);
  });

  it("FAILs when a non-energy instrument carries another market's inventory", () => {
    const verdict = energyGateVerdict([
      sample({ instrument: "GAU/EUR", ...commodityMarketOf(NON_ENERGY_EVIDENCE), inventoryLatest: 412_500, inventories: "positive", eiaEvidenceItems: 1 }),
      sample({ instrument: "WTI/USD", ...commodityMarketOf(ENERGY_EVIDENCE) }),
    ]);
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.summary).toContain("another market's inventory was attributed to it");
  });

  it("FAILs when an energy instrument is denied its own petroleum feed", () => {
    const verdict = energyGateVerdict([
      sample({
        instrument: "WTI/USD",
        ...commodityMarketOf(ENERGY_EVIDENCE),
        inventories: "unavailable",
        inventoryLatest: null,
        eiaEvidenceItems: 0,
        petroleumFeedScopeText: true,
      }),
      sample({ instrument: "GAU/EUR", ...commodityMarketOf(NON_ENERGY_EVIDENCE) }),
    ]);
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.summary).toContain("withheld as out of scope");
  });

  it("stays UNAVAILABLE when no energy instrument was classified — never a pass", () => {
    const verdict = energyGateVerdict([sample({ instrument: "GAU/EUR", ...commodityMarketOf(NON_ENERGY_EVIDENCE) })]);
    expect(verdict.verdict).toBe("UNAVAILABLE");
    expect(verdict.summary).toContain("no provider-native candidate resolved to the energy market");
  });

  it("stays UNAVAILABLE when the energy market resolved but no reading arrived", () => {
    const verdict = energyGateVerdict([
      sample({
        instrument: "WTI/USD",
        ...commodityMarketOf(ENERGY_EVIDENCE),
        inventories: "unavailable",
        inventoryLatest: null,
        eiaEvidenceItems: 0,
        reason: "Rate limited: [429] You have run out of API credits for the current minute.",
      }),
      sample({ instrument: "GAU/EUR", ...commodityMarketOf(NON_ENERGY_EVIDENCE) }),
    ]);
    expect(verdict.verdict).toBe("UNAVAILABLE");
    expect(verdict.summary).toContain("429");
  });

  it("runs the whole loop against a mocked runtime: discovery order, own sessions, early stop", async () => {
    // The loop is what the operator's run executes, so it is exercised here with
    // a stubbed transport: candidates in the deployment's own order, one session
    // per candidate, the runtime's own classification deciding everything, and a
    // stop as soon as one energy and one non-energy instrument are classified.
    const calls: string[] = [];
    const sessions: string[] = [];
    // The runtime's answers carry its own top-level engine summary as well: a
    // result with no market evidence and no summary earns FAIL ("silent
    // absence") and no evidence at all, which is a different thing from a
    // classification the probe simply did not receive.
    const results: Record<string, unknown> = {
      "GAU/EUR": {
        fundamentalAssessment: NON_ENERGY_EVIDENCE.fundamental,
        fundamentalSummary: NON_ENERGY_EVIDENCE.fundamental.summary,
      },
      "XAG/USD": {
        fundamentalAssessment: NON_ENERGY_EVIDENCE.fundamental,
        fundamentalSummary: NON_ENERGY_EVIDENCE.fundamental.summary,
      },
      "WTI/USD": {
        fundamentalAssessment: ENERGY_EVIDENCE.fundamental,
        fundamentalSummary: ENERGY_EVIDENCE.fundamental.summary,
      },
    };
    const transport = {
      state: { calls: 0, lastError: null, blocked: false },
      action: async (_path: string, args: unknown) => {
        const id = (args as { input: { providerInstrumentId: string } }).input.providerInstrumentId;
        calls.push(id);
        return { ok: true, httpStatus: 200, appError: null, value: { status: "DELIVERED", result: results[id] } };
      },
      query: async () => ({ ok: true, httpStatus: 200, appError: null, value: {} }),
    };
    const circuit = createProviderCircuit();
    const probe = await probeEnergyGate({
      spec: { domain: "commodity", label: "COMMODITY", discovery: "twelve-data", assetClass: "commodity" } as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "XAG/USD", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
        { providerInstrumentId: "NEVER/USD", provider: "twelve-data" },
      ] as never,
      transport: transport as never,
      circuit,
      sessionFor: async (label: string) => {
        sessions.push(label);
        return { ok: true, token: `token-for-${label}` };
      },
      seeds: [],
      pauseMs: 0,
    });

    // The provider's own order was followed and stopped at the fourth candidate:
    // both directions were represented after three.
    expect(calls).toEqual(["GAU/EUR", "XAG/USD", "WTI/USD"]);
    expect(sessions).toHaveLength(3);
    expect(new Set(sessions).size).toBe(3);
    expect(probe.samples.map((x) => x.instrument)).toEqual(["GAU/EUR", "XAG/USD", "WTI/USD"]);
    expect(probe.classified).toBe(3);
    expect(probe.candidatesConsidered).toContain("NEVER/USD");
    expect(probe.verdict).toBe("PASS");
    expect(probe.stopReason).toBeNull();
  });

  it("trips only for the provider that actually refused (Phase 289B attribution)", () => {
    // Reproduced against the stubbed runtime: a verdict whose text quotes ANOTHER
    // leg's credential failure used to trip the candidate's provider — a crypto
    // verdict citing "CoinGlass not configured" opened the okx circuit and a
    // twelve-data verdict citing a Tokenomist 401 opened the twelve-data circuit,
    // suppressing requests to providers that had refused nothing.
    const other = createProviderCircuit();
    other.classify(
      "twelve-data",
      "",
      [
        {
          provider: "crypto-fundamentals",
          dataset: "crypto-fundamentals",
          acquired: false,
          reason: "Tokenomist: Tokenomist refused the request with HTTP 401 (credential).",
        },
        {
          provider: "coinglass",
          dataset: "derivatives",
          acquired: false,
          reason: "CoinGlass not configured: COINGLASS_API_KEY is missing.",
        },
      ],
    );
    expect(other.isTripped("twelve-data")).toBeNull();

    // The provider's OWN refusal still trips, and the market transport leg counts
    // as the provider's own capacity answer.
    const rateLimited = createProviderCircuit();
    expect(
      rateLimited.classify("twelve-data", "", [
        {
          provider: "market-data",
          dataset: "ohlcv",
          acquired: false,
          reason: "[429] You have run out of API credits for the current minute.",
        },
      ]),
    ).toBe("RATE_LIMITED");
    expect(rateLimited.isTripped("twelve-data")?.kind).toBe("RATE_LIMITED");

    // A credential refusal reported by a leg this provider owns also trips.
    const ownCredential = createProviderCircuit();
    expect(
      ownCredential.classify("crypto-fundamentals", "", [
        { provider: "crypto-fundamentals", dataset: "crypto-fundamentals", acquired: false, reason: "HTTP 401 unauthorized" },
      ]),
    ).toBe("CREDENTIAL_REQUIRED");

    // And the transport's own error text is always attributable.
    const transport = createProviderCircuit();
    expect(transport.classify("okx", "429 too many requests", [])).toBe("RATE_LIMITED");
    expect(transport.classify("okx", "", [])).toBeNull();
  });

  it("sends nothing more once the provider circuit is open", async () => {
    const circuit = createProviderCircuit();
    circuit.trip("twelve-data", "Rate limited: [429] out of API credits", "rate-limit");
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: { domain: "commodity", label: "COMMODITY", discovery: "twelve-data", assetClass: "commodity" } as never,
      candidates: [
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
      ] as never,
      transport: {
        state: { calls: 0, lastError: null, blocked: false },
        action: async (_p: string, args: unknown) => {
          calls.push(String((args as { input: { providerInstrumentId: string } }).input.providerInstrumentId));
          return { ok: true, httpStatus: 200, appError: null, value: {} };
        },
        query: async () => ({ ok: true, httpStatus: 200, appError: null, value: {} }),
      } as never,
      circuit,
      sessionFor: async () => ({ ok: true, token: "t" }),
      pauseMs: 0,
    });
    expect(calls).toEqual([]);
    expect(probe.stopReason).toContain("provider circuit open");
    expect(probe.verdict).toBe("UNAVAILABLE");
  });

  it("is bounded and provider-disciplined by construction", () => {
    expect(ENERGY_PROBE_CANDIDATE_LIMIT).toBeGreaterThan(0);
    // Bounded, but deep enough to be truthful: the audit found the provider's
    // commodity catalog carries ~31 identities whose first three are gold-gram
    // pairs, so a bound of 3 could never reach an energy instrument — and the
    // run's "classified=3/3" was that clamp, not a provider limitation.
    expect(ENERGY_PROBE_CANDIDATE_LIMIT).toBeGreaterThanOrEqual(6);
    expect(ENERGY_PROBE_CANDIDATE_LIMIT).toBeLessThanOrEqual(ENERGY_PROBE_MAX_CANDIDATE_LIMIT);
    // Candidate selection comes from the deployment's own discovery, in order,
    // bounded — no ticker list, and the circuit is checked before every request.
    expect(SMOKE).toContain("selectCandidates(\n      commoditySpec,\n      twelveDiscovery,\n      probeLimit,\n      probeLimit,\n    )");
    expect(SMOKE).toContain("const tripped = circuit.isTripped(provider);");
    expect(SMOKE).toContain("no repeat request to ${provider}");
    // Its own anonymous session per candidate: quota isolation, no substitution.
    expect(SMOKE).toContain("const session = await sessionFor(`COMMODITY probe ${nativeId}`);");
    expect(SMOKE).toContain("buildAnalysisInput(spec, candidate)");
    expect(SMOKE).toContain(
      'annotate(\n      energyGateProbe.verdict === "FAIL" ? "error" : "warning",',
    );
  });
});

describe("phase 289C-audit — the probe's scan depth is real, not silently clamped", () => {
  const spec = {
    domain: "commodity",
    label: "COMMODITY",
    discovery: "twelve-data" as const,
    assetClass: "commodity",
  };

  const discoveryOf = (count: number) => ({
    success: true,
    provider: "twelve-data",
    error: null,
    instruments: Array.from({ length: count }, (_, i) => ({
      providerInstrumentId: `C${String(i).padStart(2, "0")}/USD`,
      assetClass: "commodity",
      subType: "commodity_spot",
      tradingState: "TRADING" as const,
    })),
  });

  it("the domain loop keeps its policy ceiling, unchanged", () => {
    // The default ceiling must not move: bounded attempts are a deliberate
    // provider-cost policy, and this phase changes only the probe's own bound.
    expect(selectCandidates(spec, discoveryOf(30), 99).length).toBe(MAX_CANDIDATE_ATTEMPTS);
    expect(selectCandidates(spec, discoveryOf(30), 3).length).toBe(3);
    expect(selectCandidates(spec, discoveryOf(30), 1).length).toBe(1);
  });

  it("a caller that declares its own ceiling gets it — the defect that hid energy", () => {
    // Before this fix the ceiling was unconditional: the probe asked for 6 and got
    // 3, so candidates 4..N were never classified and its UNAVAILABLE verdict
    // could not be distinguished from the provider not offering energy at all.
    expect(selectCandidates(spec, discoveryOf(30), 12, 12).length).toBe(12);
    expect(selectCandidates(spec, discoveryOf(30), 40, 40).length).toBe(30);
    // Still bounded, still provider order, and the clamp never invents one.
    expect(selectCandidates(spec, discoveryOf(30), 0, 12).length).toBe(1);
  });

  it("scans the provider's order verbatim, with no ranking or curation", () => {
    const picked = selectCandidates(spec, discoveryOf(15), 12, 12);
    expect(picked.map((c) => c.providerInstrumentId)).toEqual(
      Array.from({ length: 12 }, (_, i) => `C${String(i).padStart(2, "0")}/USD`),
    );
  });

  it("records each sample's position in the provider's order", async () => {
    // Position is the evidence that separates "no energy instrument exists" from
    // "the energy instrument is beyond the scan depth".
    const calls: string[] = [];
    const probe = await probeEnergyGate({
      spec: spec as never,
      candidates: [
        { providerInstrumentId: "GAU/IDR", provider: "twelve-data" },
        { providerInstrumentId: "GAU/EUR", provider: "twelve-data" },
        { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
      ] as never,
      transport: {
        state: { calls: 0, lastError: null, blocked: false },
        action: async (_p: string, args: unknown) => {
          const id = (args as { input: { providerInstrumentId: string } }).input.providerInstrumentId;
          calls.push(id);
          const group = id === "WTI/USD" ? "energy" : "unclassified";
          return {
            ok: true,
            httpStatus: 200,
            appError: null,
            value: {
              status: "DELIVERED",
              result: {
                fundamentalSummary: `${id} read.`,
                fundamentalAssessment: {
                  available: true,
                  domain: "commodity",
                  provider: "twelve-data",
                  state: "insufficient",
                  commodityProfile: { group, classificationSource: `${id} → ${group}` },
                  dimensions: [{ name: "inventories", status: "unavailable", role: "supporting" }],
                  evidenceProviders: [],
                  limitations: [],
                },
              },
            },
          };
        },
        query: async () => ({ ok: true, httpStatus: 200, appError: null, value: {} }),
      } as never,
      circuit: createProviderCircuit(),
      sessionFor: async () => ({ ok: true, token: "t" }),
      seeds: [],
      pauseMs: 0,
    });

    expect(calls).toEqual(["GAU/IDR", "GAU/EUR", "WTI/USD"]);
    expect(probe.samples.map((x) => [x.instrument, x.position, x.group])).toEqual([
      ["GAU/IDR", 1, "unclassified"],
      ["GAU/EUR", 2, "unclassified"],
      ["WTI/USD", 3, "energy"],
    ]);
    expect(probe.candidatesConsidered).toEqual(["GAU/IDR", "GAU/EUR", "WTI/USD"]);
  });

  it("reports the discovered identities so provider coverage is decidable", () => {
    // Without this list a reader cannot tell an absent instrument from an
    // unreached one. It is the provider's own order, and it is bounded.
    expect(SMOKE).toContain("const identities = energyGateProbe.candidatesConsidered;");
    expect(SMOKE).toContain('identities.length === 0 ? "" : ` · discovered(${identities.length})');
    expect(ENERGY_PROBE_REPORT_IDENTITIES).toBeGreaterThan(0);
    expect(ENERGY_PROBE_REPORT_IDENTITIES).toBeLessThanOrEqual(20);
    expect(SMOKE).toContain("scanned ${report.energyGateProbe.candidatesConsidered.length}");
  });

  it("pauses between probes at the provider's own published credit window", () => {
    // The deployment's own 429 text: "10 API credits were used, with the current
    // limit being 8". A faster scan would spend its budget on 429s, and a 429
    // opens the provider circuit — which would end the scan before it reached an
    // energy instrument.
    expect(ENERGY_PROBE_PAUSE_MS).toBeGreaterThanOrEqual(7_500);
    expect(SMOKE).toContain("XSTARZ_SMOKE_PROBE_LIMIT");
    expect(SMOKE).toContain("Math.min(parsed, ENERGY_PROBE_MAX_CANDIDATE_LIMIT)");
  });
});
