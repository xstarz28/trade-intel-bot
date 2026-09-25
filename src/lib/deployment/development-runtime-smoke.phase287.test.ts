/**
 * Phase 287 — the deployed-runtime smoke cannot lie about what it did.
 *
 * The smoke's value rests on properties that are easy to lose in a later edit:
 * that it never sends client-supplied evidence, never targets production or
 * localhost, never fabricates a provider observation instant, and never reports
 * an absence as a success. This suite pins those properties by reading the real
 * artifacts (so it cannot drift from them) and by exercising the pure decision
 * functions with adversarial inputs.
 *
 * Nothing here contacts a network, and nothing here asserts that the smoke has
 * been RUN: whether the deployed runtime works is decided by the workflow, not
 * by this file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXPECTED_DEV_HOST,
  PRODUCTION_HOST,
  validateTarget,
  sanitize,
  buildAnalysisInput,
  assetClassToInstrumentType,
  selectCandidates,
  classifyDomain,
  readResultEvidence,
  createProviderCircuit,
  escapeAnnotation,
  DOMAIN_SPECS,
} from "../../../scripts/development-runtime-smoke.mjs";

/**
 * The smoke is plain JavaScript, so its exports arrive untyped. These local
 * shapes are not decoration: they ARE the contract the suite checks (a
 * discovery row keeps its provider-native identity; a domain spec names the
 * provider to ask and the asset class to filter by).
 */
type DomainSpec = { domain: string; label: string; discovery: "okx" | "twelve-data"; assetClass: string };
type Candidate = {
  instId?: string;
  providerInstrumentId?: string;
  subType?: string;
  assetClass?: string;
  provider?: string;
};

const SPECS = DOMAIN_SPECS as DomainSpec[];

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const WORKFLOW = ".github/workflows/development-runtime-smoke.yml";
const SCRIPT = "scripts/development-runtime-smoke.mjs";

/* ------------------------------------------------------------------ *
 * The workflow is manual, development-scoped, and cannot reach production
 * ------------------------------------------------------------------ */

describe("287 — the runtime smoke workflow is manual, development-scoped and fail-closed", () => {
  const workflow = read(WORKFLOW);

  it("exists and is wired to workflow_dispatch only", () => {
    expect(existsSync(resolve(root, WORKFLOW))).toBe(true);
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).not.toMatch(/^ {2}push:/m);
    expect(triggers).not.toMatch(/^ {2}pull_request:/m);
    expect(triggers).not.toMatch(/^ {2}schedule:/m);
  });

  it("runs in the development environment and never in production", () => {
    const environments = [...workflow.matchAll(/^\s+environment:\s*(\S+)$/gm)].map((m) => m[1]);
    expect(environments.length).toBeGreaterThanOrEqual(1);
    for (const name of environments) expect(name).toBe("development");
    expect(workflow).not.toMatch(/environment:\s*production/);
  });

  it("targets the real development deployment and refuses production by name", () => {
    expect(workflow).toContain(EXPECTED_DEV_HOST);
    expect(workflow).toContain(PRODUCTION_HOST);
    // The production host appears only in the refusal branch.
    const productionMentions = workflow.split("\n").filter((line) => line.includes(PRODUCTION_HOST));
    expect(productionMentions.length).toBeGreaterThanOrEqual(1);
    for (const line of productionMentions) expect(line).toMatch(/PRODUCTION|Refused/);
  });

  it("needs no credential and never prints one", () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/api[_-]?key|apikey/i);
    expect(workflow).not.toMatch(/CONVEX_DEPLOY_KEY/);
  });

  it("runs the repository's own script, on a runner, with the repository's install mode", () => {
    expect(workflow).toMatch(/npm install --legacy-peer-deps/);
    expect(workflow).toMatch(/node scripts\/development-runtime-smoke\.mjs/);
    expect(workflow).toMatch(/runs-on: ubuntu-latest/);
    expect(workflow).toMatch(/node-version: "22"/);
  });

  it("publishes evidence as an artifact and never admits a release", () => {
    expect(workflow).toMatch(/actions\/upload-artifact@v4/);
    expect(workflow).toMatch(/development-runtime-smoke\.json/);
    expect(workflow).toMatch(/does not admit a release/);
    expect(workflow).not.toMatch(/release:admission|RELEASE_ADMISSION|evidence:d/);
    expect(workflow).not.toMatch(/continue-on-error/);
  });
});

/* ------------------------------------------------------------------ *
 * The script sends no evidence, and cannot reach an unsafe target
 * ------------------------------------------------------------------ */

describe("287 — the smoke refuses unsafe targets", () => {
  it("accepts only the development deployment", () => {
    const ok = validateTarget(`https://${EXPECTED_DEV_HOST}`);
    expect(ok.ok).toBe(true);
    expect(ok.origin).toBe(`https://${EXPECTED_DEV_HOST}`);
  });

  it("refuses the production deployment, by name", () => {
    const verdict = validateTarget(`https://${PRODUCTION_HOST}`);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/PRODUCTION/);
  });

  it("refuses localhost, IP literals, plaintext and unknown hosts", () => {
    for (const target of [
      "http://localhost:3000",
      "https://127.0.0.1:3210",
      "http://tough-goose-455.convex.cloud",
      "https://evil.example.com",
      "not a url",
    ]) {
      expect(validateTarget(target).ok).toBe(false);
    }
  });

  it("allows a different deployment only when asked for explicitly", () => {
    expect(validateTarget("https://other-dev-123.convex.cloud").ok).toBe(false);
    expect(validateTarget("https://other-dev-123.convex.cloud", "other-dev-123.convex.cloud").ok).toBe(true);
  });
});

describe("287 — the request cannot carry evidence, and does not substitute instruments", () => {
  const cryptoSpec = SPECS.find((s: DomainSpec) => s.domain === "crypto")!;

  it("sends ONLY routing fields", () => {
    const body = buildAnalysisInput(cryptoSpec, {
      instId: "PROVIDER-NATIVE-ID",
      provider: "okx",
      subType: "crypto_spot",
    });
    expect(Object.keys(body)).toEqual(["input"]);
    // Exact key set: adding a client-supplied evidence field here would be the
    // exact failure mode this smoke exists to rule out, so it fails the suite.
    expect(Object.keys(body.input).sort()).toEqual(
      ["instrument", "instrumentType", "provider", "providerInstrumentId", "requestedTimeframe", "timeframe", "tradingStyle"].sort(),
    );
    for (const banned of [
      "marketData",
      "technicalData",
      "fundamentalData",
      "currentPrice",
      "price",
      "candles",
      "fundamentalAssessment",
      "sentiment",
    ]) {
      expect(body.input).not.toHaveProperty(banned);
    }
  });

  it("passes the provider-native identity through verbatim, for each discovery source", () => {
    const okx = buildAnalysisInput(cryptoSpec, { instId: "AAA-BBB", provider: "okx" });
    expect(okx.input.instrument).toBe("AAA-BBB");
    expect(okx.input.providerInstrumentId).toBe("AAA-BBB");

    const forexSpec = SPECS.find((s: DomainSpec) => s.domain === "forex")!;
    const td = buildAnalysisInput(forexSpec, { providerInstrumentId: "XXX/YYY", provider: "twelve-data" });
    expect(td.input.instrument).toBe("XXX/YYY");
    expect(td.input.providerInstrumentId).toBe("XXX/YYY");
    expect(td.input.provider).toBe("twelve-data");
  });

  it("classifies equity as stock the way the product does", () => {
    expect(assetClassToInstrumentType("equity")).toBe("stock");
    expect(assetClassToInstrumentType("crypto")).toBe("crypto");
    expect(assetClassToInstrumentType("forex")).toBe("forex");
    expect(assetClassToInstrumentType("commodity")).toBe("commodity");
  });

  it("contains no hardcoded instrument, and no evidence field name on the request path", () => {
    const script = read(SCRIPT);
    // The script may not name a ticker in code. The two ticker-shaped strings
    // that legitimately appear are deployment HOSTS, never instruments.
    const codeOnly = script
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    // Case-sensitive on purpose: /ETH/i also matches the word "whether".
    expect(codeOnly).not.toMatch(/\b(BTC|ETH|EUR\/USD|AAPL|WTI|XAU)\b/);
    expect(codeOnly).not.toMatch(/\bfetch\s*=\s*|globalThis\.fetch\s*=|mockFetch|stubFetch|nock|msw/);
    // A local server cannot prove anything about a deployment, so the question
    // is whether this script could ever ADDRESS one. "localhost" may be named
    // inside the refusal predicate, and in the policy line that states the rule;
    // what must not exist is a local URL the script can fetch.
    expect(codeOnly).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
    // Every request must be built from the VALIDATED origin — a fetch to any
    // other address would bypass the production/localhost refusal above.
    const fetchTargets = [...codeOnly.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1]);
    expect(fetchTargets.length).toBeGreaterThan(0);
    for (const target of fetchTargets) expect(target).toContain("${origin}");
    // ...and the default target must be the development deployment.
    expect(codeOnly).toMatch(/flag\("--url", argv\) \?\? `https:\/\/\$\{EXPECTED_DEV_HOST\}`/);
  });

  it("keeps discovery as the source of instruments", () => {
    const script = read(SCRIPT);
    expect(script).toMatch(/okx:discoverOkxInstruments/);
    expect(script).toMatch(/marketData:discoverTwelveDataInstruments/);
    // No symbol whitelist array anywhere.
    expect(script).not.toMatch(/const\s+(WHITELIST|SYMBOLS|INSTRUMENTS|TICKERS)\s*=/);
  });
});

describe("287 — candidate selection keeps provider identity and provider order", () => {
  const cryptoSpec = SPECS.find((s: DomainSpec) => s.domain === "crypto")!;
  const stockSpec = SPECS.find((s: DomainSpec) => s.domain === "stock")!;

  it("takes live OKX instruments in the provider's own order", () => {
    const discovery = {
      success: true,
      instruments: [
        { instId: "N1-X", state: "live", subType: "crypto_spot" },
        { instId: "N2-X", state: "suspend", subType: "crypto_spot" },
        { instId: "N3-X", subType: "crypto_perpetual" },
      ],
    };
    const picked = selectCandidates(cryptoSpec, discovery, 3);
    expect(picked.map((c: Candidate) => c.instId)).toEqual(["N1-X", "N3-X"]);
    expect(picked.map((c: Candidate) => c.instId)).not.toContain("N2-X");
  });

  it("takes only the requested asset class from Twelve Data catalogs", () => {
    const discovery = {
      success: true,
      instruments: [
        { providerInstrumentId: "A", assetClass: "forex", tradingState: "active", subType: "forex_spot" },
        { providerInstrumentId: "B", assetClass: "equity", tradingState: "active", subType: "equity_common" },
        { providerInstrumentId: "C", assetClass: "equity", tradingState: "disabled", subType: "equity_common" },
      ],
    };
    expect(selectCandidates(stockSpec, discovery, 3).map((c: Candidate) => c.providerInstrumentId)).toEqual(["B"]);
  });

  it("returns nothing for a failed or empty discovery, and never invents one", () => {
    expect(selectCandidates(cryptoSpec, { success: false, instruments: [{ instId: "X" }] }, 3)).toEqual([]);
    expect(selectCandidates(cryptoSpec, { success: true, instruments: [] }, 3)).toEqual([]);
    expect(selectCandidates(cryptoSpec, null, 3)).toEqual([]);
  });

  it("tries at most the bounded number of candidates", () => {
    const many = {
      success: true,
      instruments: Array.from({ length: 9 }, (_, i) => ({ instId: `N${i}-X`, state: "live", subType: "crypto_spot" })),
    };
    expect(selectCandidates(cryptoSpec, many, 9).length).toBe(3);
    expect(selectCandidates(cryptoSpec, many, 1).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The verdict — an absence is never a success
 * ------------------------------------------------------------------ */

/** A delivered response with the given result fields, for adversarial cases. */
const delivered = (result: Record<string, unknown>) => ({
  httpStatus: 200,
  status: "DELIVERED",
  entitlement: { charged: false },
  result,
});

const FULL_RESULT = {
  dataCompleteness: "full",
  recommendation: "NO_TRADE",
  provider: "okx",
  providerInstrumentId: "NATIVE-ID",
  priceSnapshot: { price: 123.45, timestamp: 1_790_000_000_000, source: "okx" },
  technicalData: { rsi14: 50 },
  technicalSummary: "technical",
  fundamentalAssessment: {
    available: true,
    domain: "crypto",
    provider: "tokenomist",
    observedAt: 1_790_000_000_000,
    state: "mixed",
    confidence: "low",
    periodsCount: 3,
    dimensions: [{ evidence: [{ provider: "tokenomist" }] }],
  },
  fundamentalSummary: "fundamental",
  unifiedIntelligence: {
    available: true,
    state: "technical_only",
    technical: { available: true, bias: "Bullish", confidence: "low" },
    confluence: { agreement: "not-assessable", reason: "one side only" },
    actionable: false,
    actionabilityReason: "needs both",
    limitations: [],
  },
  advancedTechnicalEvidence: { evidenceClasses: ["ohlcv"], confluence: ["a"], conflicts: [], unavailableMetrics: [] },
};

describe("287 — PASS requires real evidence on all four legs", () => {
  it("passes only the fully evidenced runtime result", () => {
    const verdict = classifyDomain({ response: delivered(FULL_RESULT) });
    expect(verdict.headline).toBe("PASS");
    expect(verdict.evidence?.market.observedAt).toBe(1_790_000_000_000);
  });

  it("never passes on HTTP 200 alone", () => {
    const verdict = classifyDomain({ response: delivered({}) });
    expect(verdict.headline).not.toBe("PASS");
  });

  it("never passes without a provider observation instant", () => {
    // A market leg without an observation instant is not usable evidence. The
    // runtime explained itself, so this is UNAVAILABLE, never PASS.
    const noTs = classifyDomain({
      response: delivered({ ...FULL_RESULT, priceSnapshot: { price: 1, source: "okx" } }),
    });
    expect(noTs.headline).toBe("UNAVAILABLE");
    expect(noTs.reason).toMatch(/observation instant/i);

    // A local constant (0) is not an observation instant either.
    const zeroTs = classifyDomain({
      response: delivered({ ...FULL_RESULT, priceSnapshot: { price: 1, timestamp: 0, source: "okx" } }),
    });
    expect(zeroTs.headline).toBe("UNAVAILABLE");

    // A timestamp the runtime made up locally is impossible to detect here, and
    // this smoke does not pretend otherwise: it reports what the runtime said
    // and labels the origin. What it can refuse is a missing one.
    const localOnly = classifyDomain({ response: delivered({ priceSnapshot: { price: 1, timestamp: null } }) });
    expect(localOnly.headline).toBe("FAIL");
    expect(localOnly.reason).toMatch(/silent absence/i);
  });

  it("reports a silent absence (no evidence AND no reason) as FAIL", () => {
    const verdict = classifyDomain({ response: delivered({}) });
    expect(verdict.headline).toBe("FAIL");
    expect(verdict.reason).toMatch(/silent absence/i);
  });

  it("reports a real market leg with an unavailable fundamental leg honestly", () => {
    const verdict = classifyDomain({
      response: delivered({
        ...FULL_RESULT,
        fundamentalAssessment: { available: false, domain: "equity", provider: "unavailable", state: "insufficient", observedAt: 0 },
        fundamentalSummary: "No assessment produced — absent evidence is never fabricated",
      }),
    });
    expect(verdict.headline).toBe("UNAVAILABLE");
    expect(verdict.reason).toMatch(/FUNDAMENTAL/);
    // The legs that WERE real are still reported.
    expect(verdict.evidence?.market.observedAt).toBe(1_790_000_000_000);
    expect(verdict.evidence?.technical.available).toBe(true);
  });

  it("reports an unavailable fundamental leg with its reason rather than FAIL when the runtime explains itself", () => {
    const verdict = classifyDomain({
      response: delivered({
        ...FULL_RESULT,
        fundamentalAssessment: { available: false, domain: "commodity", provider: "unavailable", state: "insufficient", observedAt: 0 },
        fundamentalSummary: "Required credentials not configured: TWELVE_DATA_API_KEY.",
      }),
    });
    expect(verdict.headline).toBe("UNAVAILABLE");
    expect(verdict.reason).toMatch(/TWELVE_DATA_API_KEY/);
  });

  it("treats a runtime refusal (LOCKED / UNAUTHENTICATED / INVALID_INPUT) as FAIL, never success", () => {
    for (const status of ["LOCKED", "UNAUTHENTICATED", "INVALID_INPUT"]) {
      const verdict = classifyDomain({ response: { httpStatus: 200, status, entitlement: { reason: "quota" }, result: FULL_RESULT } });
      expect(verdict.headline).toBe("FAIL");
    }
  });

  it("treats a transport error as FAIL with the reason attached", () => {
    const verdict = classifyDomain({ response: null, transportError: "ECONNREFUSED" });
    expect(verdict.headline).toBe("FAIL");
    expect(verdict.reason).toMatch(/ECONNREFUSED/);
  });
});

describe("287 — evidence is copied from the runtime, never invented", () => {
  it("leaves absent values null instead of substituting zero", () => {
    const evidence = readResultEvidence({});
    expect(evidence.market.observedAt).toBeNull();
    expect(evidence.market.price).toBeNull();
    expect(evidence.fundamental.observedAt).toBeNull();
    expect(evidence.dataCompleteness).toBeNull();
    expect(evidence.unified.available).toBe(false);
  });

  it("captures provenance per evidence item, and refuses to invent it", () => {
    const bare = readResultEvidence({});
    expect(bare.provenance.market.observedAt).toBeNull();
    expect(bare.provenance.fundamental.provider).toBeNull();
    expect(bare.provenance.contexts.treasury).toBeNull();
    expect(bare.provenance.contexts.derivatives).toBeNull();

    const evidenced = readResultEvidence({
      ...FULL_RESULT,
      treasuryContext: {
        available: true,
        source: "US Treasury (home.treasury.gov XML feed)",
        fetchedAt: 1_790_000_000_000,
        freshness: "FRESH",
      },
      derivativesData: { timestamp: 1_790_000_111_000 },
    });
    // Source, fetch instant and freshness come from the context itself — the
    // period the data covers is a different thing and is not conflated with it.
    expect(evidenced.provenance.contexts.treasury).toEqual({
      available: true,
      source: "US Treasury (home.treasury.gov XML feed)",
      fetchedAt: 1_790_000_000_000,
      freshness: "FRESH",
    });
    expect(evidenced.provenance.contexts.derivatives?.observedAt).toBe(1_790_000_111_000);
    expect(evidenced.provenance.market.source).toBe("okx");
    expect(evidenced.provenance.fundamental.provider).toBe("tokenomist");
    // Cot and EIA were not attached, so they are absent — not zero, not guessed.
    expect(evidenced.provenance.contexts.cot).toBeNull();
    expect(evidenced.provenance.contexts.eia).toBeNull();
  });

  it("copies the provider observation instant verbatim", () => {
    const evidence = readResultEvidence(FULL_RESULT);
    expect(evidence.market.observedAt).toBe(1_790_000_000_000);
    expect(evidence.market.source).toBe("okx");
    expect(evidence.fundamental.observedAt).toBe(1_790_000_000_000);
    // Absent stays explicitly absent — never undefined-by-accident, never a stand-in.
    expect(evidence.fundamental.instrumentId).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Rate limits stop repetition; they do not stop the run
 * ------------------------------------------------------------------ */

describe("287 — a rate limit or missing credential stops repeated requests for that provider", () => {
  it("trips the circuit on a rate limit and reports it as RATE_LIMITED", () => {
    const circuit = createProviderCircuit();
    expect(circuit.classify("twelve-data", "HTTP 429 rate limit exceeded")).toBe("RATE_LIMITED");
    const open = circuit.isTripped("twelve-data");
    expect(open?.kind).toBe("RATE_LIMITED");
    expect(Object.keys(circuit.snapshot())).toContain("twelve-data");
  });

  it("trips the circuit on missing credentials, and keeps them out of the artifact", () => {
    const circuit = createProviderCircuit();
    expect(circuit.classify("twelve-data", "Required credentials not configured: TWELVE_DATA_API_KEY.")).toBe(
      "CREDENTIAL_REQUIRED",
    );
    expect(circuit.isTripped("twelve-data")?.kind).toBe("CREDENTIAL_REQUIRED");
  });

  it("leaves unrelated providers alone, and does not trip on ordinary text", () => {
    const circuit = createProviderCircuit();
    expect(circuit.classify("eia", "no data for this period")).toBeNull();
    expect(circuit.isTripped("eia")).toBeNull();
    expect(circuit.isTripped("twelve-data")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Reporting hygiene
 * ------------------------------------------------------------------ */

describe("287 — the smoke never publishes a credential", () => {
  it("redacts bearer tokens, JWTs, identities and key-shaped text", () => {
    const jwt = "aaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccccccccc";
    const redacted = sanitize(`Authorization: Bearer ${jwt} dev:gil-xstarz:trade-intel apikey=abcdef123456`);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toMatch(/dev:gil-xstarz/);
    expect(redacted).not.toContain("abcdef123456");
  });

  it("escapes annotation control characters", () => {
    expect(escapeAnnotation("a% b\r\nc")).toBe("a%25 b%0D%0Ac");
  });

  it("writes no credential into the artifact", () => {
    const script = read(SCRIPT);
    // The session token legitimately exists (it is the bearer header), so the
    // assertion is scoped to the REPORT literal: the object that becomes the
    // uploaded evidence must contain no token and no session material at all.
    const start = script.indexOf("const report = {");
    const end = script.indexOf("\n  };", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const reportLiteral = script.slice(start, end);
    expect(reportLiteral).not.toMatch(/token/i);
    expect(reportLiteral).not.toMatch(/bearer/i);
    expect(reportLiteral).not.toMatch(/apikey|api_key|secret/i);
  });
});
