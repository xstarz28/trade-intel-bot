/**
 * Phase 289B — the smoke CLI, executed end to end against a STUBBED deployment.
 *
 * Why this exists: the unit tests exercise the smoke's pure functions, and the
 * real run happens on a GitHub runner against the real development deployment.
 * Neither catches a defect in `run()` itself — the code that wires discovery,
 * sessions, the verdict loop, the energy-gate probe, the fingerprint and the
 * annotations together. That gap is not theoretical: during Phase 289B an
 * extraction edit removed the fingerprint's definitions while the annotation
 * still referenced them, which would have thrown a ReferenceError at the very
 * end of a real run, after the expensive provider calls and BEFORE the artifact
 * was written — losing the whole run's evidence.
 *
 * So this test spawns the CLI as its own process with `--import` preloaded to
 * install a stubbed `fetch`, and drives it through a complete four-asset run
 * against a fake `*.convex.cloud` origin (allowed explicitly with
 * `--allow-host`; the smoke refuses any other host by design).
 *
 * The stub is a TEST DOUBLE for the deployment, never evidence: it says nothing
 * about the real runtime, and it cannot — the real smoke has no stub, no
 * fixture and no localhost path in it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOST = "stub-dev.convex.cloud";
const VERSION = "20260101T000000Z-deadbeef00";
const HARNESS_COMMIT = "a".repeat(40);

const STUB = `
const VERSION = ${JSON.stringify(VERSION)};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const NON_ENERGY = {
  available: true,
  domain: "commodity",
  provider: "twelve-data",
  state: "insufficient",
  commodityProfile: {
    group: "unclassified",
    classificationSource: '"GAU/EUR" is not in the canonical instrument registry — generic physical-first commodity hierarchy applied',
  },
  dimensions: [
    { name: "inventories", status: "unavailable", role: "supporting", evidence: [] },
    { name: "macro-drivers", status: "negative", role: "supporting", evidence: [{ provider: "US Treasury" }] },
  ],
  limitations: [
    "Inventory UNAVAILABLE — the only configured inventory feed is the U.S. EIA Weekly Petroleum Status Report (US petroleum stocks), which is out of scope for this unclassified instrument.",
  ],
};

const ENERGY = {
  available: true,
  domain: "commodity",
  provider: "twelve-data",
  state: "improving",
  commodityProfile: {
    group: "energy",
    classificationSource: 'canonical registry entry "WTI" (WTI Crude Oil), tags [energy, futures]',
  },
  commodityMetrics: { inventoryLatest: 412500 },
  dimensions: [
    {
      name: "inventories",
      status: "positive",
      role: "primary",
      evidence: [{ provider: "U.S. Energy Information Administration" }],
    },
  ],
  limitations: [],
};

const MARKET = (native) => ({
  priceSnapshot: { price: 1234.5, timestamp: 1790000000000, source: "twelve-data" },
  provider: "twelve-data",
  providerInstrumentId: native,
  dataCompleteness: "full",
  technicalData: { dataPoints: 210 },
  advancedTechnicalEvidence: { evidenceClasses: ["trend"], confluence: [], conflicts: [], unavailableMetrics: [] },
  unifiedIntelligence: {
    available: true,
    state: "aligned_bullish",
    confluence: { agreement: "aligned", reason: "trend and momentum agree" },
    technical: { available: true, bias: "bullish", confidence: "medium" },
    limitations: [],
  },
});

const respond = (path, args) => {
  if (path === "auth:signIn") return { tokens: { token: "anon-token" } };
  if (path === "entitlements:getMyEntitlement") return { plan: "guest", remaining: 2 };
  if (path === "okx:discoverOkxInstruments")
    return {
      success: true,
      instruments: [{ instId: "USDT-SGD", state: "live", subType: "spot", assetClass: "crypto" }],
    };
  if (path === "marketData:discoverTwelveDataInstruments")
    return {
      success: true,
      provider: "twelve-data",
      // Provider order: a bullion pair first (the control), then a petroleum one.
      instruments: [
        { providerInstrumentId: "GAU/EUR", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "EUR/USD", assetClass: "forex", subType: "forex", tradingState: "TRADING" },
      ],
      completeness: "PARTIAL",
      pagesFetched: 3,
      totalDiscovered: 3,
      catalogs: [
        { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
        { path: "/stocks", assetClass: "equity", completeness: "FAILED", pagesFetched: 0, totalDiscovered: 0, failedPage: 1 },
      ],
      warnings: ["/stocks discovery failed: The operation was aborted due to timeout."],
    };
  if (path === "protectedAnalysis:runProtectedAnalysis") {
    const native = args?.input?.providerInstrumentId ?? "UNKNOWN";
    const fundamentalAssessment =
      native === "WTI/USD" ? ENERGY : native === "GAU/EUR" ? NON_ENERGY : null;
    const result = fundamentalAssessment
      ? { ...MARKET(native), fundamentalAssessment, fundamentalSummary: "Commodity physical evidence read." }
      : {
          provider: "okx",
          providerInstrumentId: native,
          fundamentalSummary: "No crypto-native fundamental evidence was supplied for this instrument.",
          unifiedIntelligence: {
            available: true,
            state: "technical_only",
            technical: { available: true, bias: "neutral", confidence: "low" },
            limitations: ["Tokenomist: Tokenomist refused the request."],
          },
          // Phase-288-only surface: per-leg diagnostics with a leg's own reason.
          providerDiagnostics: [
            {
              provider: "crypto-fundamentals",
              dataset: "crypto-fundamentals",
              mode: "unavailable",
              acquired: false,
              attached: false,
              usedByEngine: false,
              reason: "Tokenomist: Tokenomist refused the request with HTTP 401 (credential).",
            },
          ],
        };
    return { status: "DELIVERED", entitlement: { charged: false }, result };
  }
  return {};
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname === "/version") return new Response(VERSION, { status: 200 });
  if (u.pathname === "/api/query" || u.pathname === "/api/action") {
    const body = JSON.parse(String(init.body ?? "{}"));
    return json({ status: "success", value: respond(body.path, body.args) });
  }
  return new Response("not found", { status: 404 });
};
`;

let dir: string;
let outPath: string;
let stdout = "";
let status = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "smoke-cli-"));
  outPath = join(dir, "smoke.json");
  const stubPath = join(dir, "stub-fetch.mjs");
  writeFileSync(stubPath, STUB);
  const root = resolve(__dirname, "../../..");
  try {
    stdout = execFileSync(
      process.execPath,
      [
        "--import",
        stubPath,
        join(root, "scripts/development-runtime-smoke.mjs"),
        "--url",
        `https://${HOST}`,
        "--allow-host",
        HOST,
        "--out",
        outPath,
        "--domains",
        "crypto,forex,stock,commodity",
        "--max-attempts",
        "2",
        "--quiet",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "true",
          XSTARZ_SMOKE_SOURCE_COMMIT: HARNESS_COMMIT,
          GITHUB_SHA: "b".repeat(40),
          // Phase 289 quota-audit — this stub answers instantly, so the run's
          // own conservative pacing model would have nothing to wait FOR; real
          // minute waits would only make the test slow without proving anything.
          // The pacing POLICY itself is pinned by the fake-clock tests in
          // `development-runtime-smoke.phase289-pacing.test.ts`; here it is
          // switched off and reported as switched off.
          XSTARZ_SMOKE_PACING_WINDOW_MS: "0",
        },
        timeout: 120_000,
      },
    );
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    stdout = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("phase 289B — the smoke CLI runs end to end", () => {
  it("completes a four-asset run without crashing", () => {
    // A crash here is a harness defect that would waste a real dispatch: the
    // run's expensive provider calls happen before the artifact is written.
    expect(stdout).not.toContain("smoke crashed");
    expect(status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });

  it("writes the artifact, with all four domains", () => {
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    expect(report.schema).toBe("xstarz.development-runtime-smoke/1");
    expect(report.domains.map((d: { label: string }) => d.label)).toEqual([
      "CRYPTO",
      "FOREX",
      "STOCK",
      "COMMODITY",
    ]);
    // Nothing is claimed about an instrument the smoke did not call.
    expect(report.policy.clientEvidenceSent).toBe(false);
    expect(report.policy.instrumentSubstitution).toContain("none");
  });

  it("proves the two directions of the physical-feed gate from the runtime's answers", () => {
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    expect(report.energyGateProbe).toBeTruthy();
    expect(report.energyGateProbe.verdict).toBe("PASS");
    const control = report.energyGateProbe.samples.find(
      (s: { instrument: string }) => s.instrument === "GAU/EUR",
    );
    const energy = report.energyGateProbe.samples.find(
      (s: { instrument: string }) => s.instrument === "WTI/USD",
    );
    // The bullion instrument resolved to a non-energy market and received none.
    expect(control.group).toBe("unclassified");
    expect(control.inventories).toBe("unavailable");
    expect(control.inventoryLatest).toBeNull();
    expect(control.eiaEvidenceItems).toBe(0);
    expect(control.petroleumFeedScopeText).toBe(true);
    // The petroleum instrument resolved to energy and consumed its own feed.
    expect(energy.group).toBe("energy");
    expect(energy.inventories).toBe("positive");
    expect(energy.inventoryLatest).toBe(412500);
    expect(energy.eiaEvidenceItems).toBe(1);
    // Both were named by their provider-native identity — no substitution.
    expect(energy.instrument).toBe("WTI/USD");
  });

  it("fingerprints the Phase-288 code paths and never mistakes /version for one", () => {
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    expect(report.runtimeFingerprint.phase288CodePathsObserved).toBe(true);
    expect(report.runtimeFingerprint.calendarMappingGapObserved).toBe(false);
    expect(report.target.version).toBe(VERSION);
    expect(report.target.versionSemantics).toContain("NOT the application function-bundle revision");
    // Provenance: the CHECKOUT is reported as the harness commit, and the
    // dispatch ref is a separate, labelled field.
    expect(report.source.harnessCommit).toBe(HARNESS_COMMIT);
    expect(report.source.dispatchRefSha).toBe("b".repeat(40));
  });

  it("annotates the target, the fingerprint and the probe — the lines the report is read from", () => {
    expect(stdout).toContain("::warning title=Smoke target and runtime code paths::");
    expect(stdout).toContain("phase288CodePaths:observed");
    expect(stdout).toContain("(running Convex backend version, NOT the function-bundle revision)");
    expect(stdout).toContain(`harnessCommit=${HARNESS_COMMIT}`);
    expect(stdout).toContain("::warning title=COMMODITY energy-gate probe PASS::");
    // One line per domain, always at a level the annotations API returns.
    for (const label of ["CRYPTO", "FOREX", "STOCK", "COMMODITY"]) {
      expect(stdout).toMatch(new RegExp(`::warning title=${label} (PASS|UNAVAILABLE)::`));
    }
    // Discovery detail and leg reasons reach the annotation, not only the file.
    expect(stdout).toContain("first=/stocks:FAILED");
    expect(stdout).toContain("Tokenomist");
  });

  it("reports its pacing as a LOCAL model, and as switched off when it is", () => {
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    expect(report.pacing).toBeTruthy();
    expect(report.pacing.enabled).toBe(false);
    expect(report.pacing.waitsCount).toBe(0);
    // It is never presented as the provider's counter — the transports keep
    // {ok,status,json} only, so those headers are not observable.
    expect(report.pacing.model).toContain("LOCAL");
    expect(report.pacing.model).toContain("NOT the provider's counter");
    expect(stdout).toContain("pacing=disabled");
    // The summary carries the same line (the run is `--quiet`, so the summary
    // goes to its file rather than the console).
    const summary = readFileSync(outPath.replace(/\.json$/, "") + "-summary.txt", "utf8");
    expect(summary).toContain("td pacing     :");
    expect(summary).toContain("disabled");
  });

  it("keeps the energy probe bounded to the deployment's own discovered instruments", () => {
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    expect(report.energyGateProbe.candidateLimit).toBeGreaterThan(0);
    // Candidate selection is the domain's own: the forex pair returned by the
    // same discovery call is never a commodity candidate, so the probe cannot
    // wander into another asset class.
    expect(report.energyGateProbe.candidatesConsidered).toEqual(["GAU/EUR", "WTI/USD"]);
    expect(
      report.energyGateProbe.samples.map((s: { instrument: string }) => s.instrument),
    ).not.toContain("EUR/USD");
  });
});
