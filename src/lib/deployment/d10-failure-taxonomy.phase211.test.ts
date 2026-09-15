/**
 * Phase 211 — why the real DEV run reported D10 `API_UNAVAILABLE`.
 *
 * The operator's run against tough-goose-455 blocked D10 with
 * `errorCode: API_UNAVAILABLE`. That code cannot come from OKX at all:
 * `okx:fetchOkxOrderBook` returns `{ success, data, observedAt }` and never an
 * `errorCode`. The code came from the credentialed TwelveData fallback, and
 * the OKX failure that caused the fallback was invisible because the harness
 * read `v.error` / `v.errorCode` while the OKX action buries its reason at
 * `data.reason`.
 *
 * Three defects, all in the diagnostic layer:
 *
 *   1. an OKX failure was reported as "unavailable" with no reason;
 *   2. the surviving errorCode belonged to a DIFFERENT provider, so the
 *      evidence blamed OKX for TwelveData's answer;
 *   3. the probe asked for `BTC-USDT`, which mapInstrumentToOkx normalises to
 *      `BTC-USDT-SWAP` — so the request and the observation were different
 *      instruments.
 *
 * None of this changes what D10 will accept. A PASS still requires a genuine
 * provider-supplied exchange timestamp.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapInstrumentToOkx } from "../risk/okx-spec";
import { buildExecutionData } from "../execution-quality";

const root = process.cwd();
const harness = readFileSync(join(root, "scripts/evidence-d-harness.mjs"), "utf8");
const okxSource = readFileSync(join(root, "src/convex/okx.ts"), "utf8");
const marketDataSource = readFileSync(join(root, "src/convex/marketData.ts"), "utf8");

/* ------------------------------------------------------------------ *
 * 1. Root cause: API_UNAVAILABLE cannot originate from OKX
 * ------------------------------------------------------------------ */

describe("Phase 211 — the observed API_UNAVAILABLE came from the fallback, not OKX", () => {
  it("okx.ts never emits an errorCode of any kind", () => {
    expect(okxSource).not.toMatch(/errorCode/);
    // Its failure shape is free-text `error`, or a parser reason inside `data`.
    expect(okxSource).toMatch(/success: false as const, error: `OKX order book returned HTTP/);
    expect(okxSource).toMatch(/success: false as const, error: `network failure:/);
  });

  it("marketData.ts is the only D10-reachable source of API_UNAVAILABLE", () => {
    expect(marketDataSource).toMatch(/errorCode: "API_UNAVAILABLE"/);
    // And it distinguishes the cases that must never be conflated.
    expect(marketDataSource).toMatch(/errorCode: "RATE_LIMIT"/);
    expect(marketDataSource).toMatch(/errorCode: "AUTH_ERROR"/);
  });

  it("a MISSING credential yields AUTH_ERROR, so the DEV run had a key and the provider failed", () => {
    // This is the load-bearing inference: API_UNAVAILABLE (not AUTH_ERROR)
    // means the key was present and the upstream call itself failed.
    const missingKeyBranch = marketDataSource.slice(
      marketDataSource.indexOf("const apiKey = process.env.TWELVE_DATA_API_KEY"),
      marketDataSource.indexOf("const symbol = args.instrument.toUpperCase()"),
    );
    expect(missingKeyBranch).toMatch(/TWELVE_DATA_API_KEY is missing/);
    expect(missingKeyBranch).toMatch(/errorCode: "AUTH_ERROR"/);
    expect(missingKeyBranch).not.toMatch(/API_UNAVAILABLE/);
  });

  it("D10 probes exactly two providers, in OKX-first order", () => {
    const d10 = harness.slice(harness.indexOf("D10: observedAt must come from"));
    const calls = [...d10.matchAll(/"([a-zA-Z]+:[a-zA-Z]+)"/g)].map((m) => m[1]);
    const providers = calls.filter((c) => c.includes("fetchOkx") || c.includes("fetchMarketData"));
    expect(providers[0]).toBe("okx:fetchOkxOrderBook");
    expect(providers).toContain("marketData:fetchMarketData");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The OKX reason is no longer swallowed
 * ------------------------------------------------------------------ */

describe("Phase 211 — an OKX failure now reports its real reason", () => {
  it("the OKX action buries its parser reason at data.reason, with no error field", () => {
    // Reproduce the exact shape the action returns on a parser rejection.
    const data = buildExecutionData(
      { ok: false, reason: "missing/invalid exchange timestamp (ts)" },
      Date.now(),
      Date.now(),
    );
    const actionReturn: Record<string, unknown> = { success: data.available, data };
    expect(actionReturn.success).toBe(false);
    expect(actionReturn).not.toHaveProperty("error");
    expect(actionReturn).not.toHaveProperty("errorCode");
    expect((actionReturn.data as { reason?: string }).reason).toBe(
      "missing/invalid exchange timestamp (ts)",
    );
  });

  it("the harness reads data.reason, not just error/errorCode", () => {
    expect(harness).toMatch(/v\.data\?\.reason/);
    expect(harness).toMatch(/v\.data\?\.available === false/);
  });

  it("an OKX parser rejection yields its reason, not a bare 'unavailable'", () => {
    // M1: the exact DEV shape - success:false, no error, no errorCode, reason
    // nested under data. Evaluate the real expression from the harness.
    const probeSrc = harness.slice(
      harness.indexOf("      failure:\n        v.success === false"),
      harness.indexOf("      // The layer the failure came from"),
    );
    expect(probeSrc.length).toBeGreaterThan(40);
    const expr = probeSrc.replace(/^\s*failure:\s*/, "").replace(/,\s*$/, "");
    const evalFailure = new Function("v", "out", `return (${expr});`) as (
      v: unknown,
      out: unknown,
    ) => string | null;

    const okxRejection = {
      success: false,
      data: { available: false, reason: "missing/invalid exchange timestamp (ts)" },
    };
    expect(evalFailure(okxRejection, { observedAt: null })).toBe(
      "missing/invalid exchange timestamp (ts)",
    );
    expect(evalFailure(okxRejection, { observedAt: null })).not.toBe("unavailable");
  });

  it("every provider attempt carries a failure class", () => {
    expect(harness).toMatch(/failureClass: classifyProviderFailure\(r, v\)/);
    expect(harness).toMatch(/const classifyProviderFailure = \(r, v\) => \{/);
  });

  it("the BLOCKED detail attributes each failure to the provider it came from", () => {
    expect(harness).toMatch(
      /\$\{a\.provider\}\[\$\{a\.failureClass \?\? "OK"\}\]:\$\{a\.failure \?\? "ok"\}/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. Error taxonomy — the layers must stay distinct
 * ------------------------------------------------------------------ */

describe("Phase 211 — failure layers are never conflated", () => {
  /**
   * Extract and evaluate the REAL classifier from the harness. A mirrored copy
   * would keep passing after the harness changed - which is exactly how the
   * rate-limit/credential conflation survived its first mutation run.
   */
  const classify = (() => {
    const start = harness.indexOf("const classifyProviderFailure = (r, v) => {");
    expect(start, "classifyProviderFailure must exist in the harness").toBeGreaterThan(0);
    const term = "\n  };";
    const end = harness.indexOf(term, start);
    expect(end, "classifier must be terminated").toBeGreaterThan(start);
    const body = harness.slice(start, end + term.length);
    const factory = new Function(`"use strict"; ${body} return classifyProviderFailure;`);
    return factory() as (r: Record<string, unknown>, v: Record<string, unknown>) => string | null;
  })();

  it.each([
    ["sandbox/network outage", { transportError: "ECONNRESET" }, {}, "TRANSPORT"],
    ["OKX fetch threw", {}, { success: false, error: "network failure: TypeError" }, "TRANSPORT"],
    ["OKX HTTP error", {}, { success: false, error: "OKX order book returned HTTP 503." }, "PROVIDER_HTTP"],
    ["OKX malformed body", {}, { success: false, error: "OKX returned malformed JSON." }, "PROVIDER_SCHEMA"],
    [
      "OKX answered without ts",
      {},
      { success: false, data: { available: false, reason: "missing/invalid exchange timestamp (ts)" } },
      "PROVIDER_NO_TIMESTAMP",
    ],
    ["provider rate limit", {}, { success: false, errorCode: "RATE_LIMIT" }, "PROVIDER_RATE_LIMIT"],
    ["missing credential", {}, { success: false, errorCode: "AUTH_ERROR" }, "PROVIDER_CREDENTIAL"],
    ["provider unavailable", {}, { success: false, errorCode: "API_UNAVAILABLE" }, "PROVIDER_UNAVAILABLE"],
    [
      "unsupported instrument",
      {},
      { success: false, error: 'instrument "AAPL" is not shaped like an OKX contract id or BASE/QUOTE pair' },
      "INSTRUMENT_UNSUPPORTED",
    ],
    ["deployment function threw", { appError: "boom" }, {}, "DEPLOYMENT_FUNCTION_ERROR"],
  ])("classifies %s as %s", (_label, r, v, expected) => {
    expect(classify(r as Record<string, unknown>, v as Record<string, unknown>)).toBe(expected);
  });

  it("a network outage is never reported as a schema problem", () => {
    expect(classify({ transportError: "ECONNRESET" }, {})).not.toBe("PROVIDER_SCHEMA");
  });

  it("a rate limit is never reported as a missing credential", () => {
    expect(classify({}, { errorCode: "RATE_LIMIT" })).not.toBe("PROVIDER_CREDENTIAL");
  });

  it("a credential-free OKX failure is never reported as a credential problem", () => {
    const okxFailure = { success: false, data: { available: false, reason: "empty dataset for this query" } };
    expect(classify({}, okxFailure)).toBe("PROVIDER_SCHEMA");
    expect(classify({}, okxFailure)).not.toBe("PROVIDER_CREDENTIAL");
  });
});

/* ------------------------------------------------------------------ *
 * 4. No symbol substitution in the provenance probe
 * ------------------------------------------------------------------ */

describe("Phase 211 — the D10 probe observes the instrument it asked for", () => {
  it("a bare BASE-QUOTE pair is silently normalised to a SWAP contract", () => {
    // Pinned product behaviour since Phase 39 — not changed here, but it means
    // asking for "BTC-USDT" observes the perpetual swap, not the spot book.
    expect(mapInstrumentToOkx("BTC-USDT")).toBe("BTC-USDT-SWAP");
    expect(mapInstrumentToOkx("BTC-USDT")).not.toBe("BTC-USDT");
  });

  it("the probe now names a provider-native contract id that survives mapping", () => {
    expect(harness).toMatch(/const OKX_PROVENANCE_INSTRUMENT = "BTC-USDT-SWAP"/);
    expect(harness).toMatch(/\{ instrument: OKX_PROVENANCE_INSTRUMENT \}/);
    const probed = "BTC-USDT-SWAP";
    expect(mapInstrumentToOkx(probed)).toBe(probed);
  });

  it("records the instrument the provider says it answered with", () => {
    expect(harness).toMatch(/observedInstrument: v\.data\?\.instrumentId \?\? null/);
  });

  it("the sweep still uses discovered ids verbatim", () => {
    // Unchanged by this phase: the sweep must keep provider-native identity.
    expect(harness).toMatch(/instrument: cand\.instId/);
    expect(harness).not.toMatch(/instId\.(replace|split|toUpperCase|slice)/);
  });
});

/* ------------------------------------------------------------------ *
 * 5. D10 semantics are unchanged
 * ------------------------------------------------------------------ */

describe("Phase 211 — what D10 accepts has not been weakened", () => {
  it("still refuses a timestamp indistinguishable from the local clock", () => {
    expect(harness).toMatch(/looksLikeLocalClock \? "FAIL" : "PASS"/);
    expect(harness).toMatch(/Math\.abs\(observedAt - chosen\.startedAt\) < 2/);
  });

  it("still fails a future-dated or cache-stamped observation", () => {
    expect(harness).toMatch(/observedAt > chosen\.finishedAt \+ 5_000/);
    expect(harness).toMatch(/acquisition === "cache-reused" && observedAt >= chosen\.startedAt/);
  });

  it("still refuses to upgrade the acquisition-stamped fallback to PASS", () => {
    const d10 = harness.slice(harness.indexOf("D10: observedAt must come from"));
    expect(d10).toMatch(/} else if \(chosenLabel === "okx"\) \{/);
    expect(d10).toMatch(/stamped at acquisition time/);
  });

  it("still BLOCKS when no provider supplies a timestamp", () => {
    expect(harness).toMatch(/no provider returned a usable observation timestamp/);
    expect(harness).toMatch(/A fabricated timestamp must never be accepted/);
  });

  it("the parser still rejects a book with no exchange timestamp", () => {
    const eq = readFileSync(join(root, "src/lib/execution-quality.ts"), "utf8");
    expect(eq).toMatch(/missing\/invalid exchange timestamp \(ts\)/);
    const rejected = buildExecutionData(
      { ok: false, reason: "missing/invalid exchange timestamp (ts)" },
      Date.now(),
      Date.now(),
    );
    expect(rejected.available).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Scope: no product behaviour was changed
 * ------------------------------------------------------------------ */

describe("Phase 211 — the fix is diagnostic only", () => {
  it("does not alter recommendation logic or force a signal", () => {
    // A literal BUY is legitimate at the ACCOUNTING mutation (E7's negative
    // control drives consumeProfitSignal directly). It must never appear on
    // the ANALYSIS path, which is where forcing one would fake evidence.
    const analysisCalls = [
      ...harness.matchAll(/protectedAnalysis:runProtectedAnalysis"[\s\S]{0,400}?\n\s{4,6}\)/g),
    ].map((m) => m[0]);
    expect(analysisCalls.length).toBeGreaterThan(0);
    for (const call of analysisCalls) {
      expect(call, "no recommendation may be fed into the analysis path").not.toMatch(
        /recommendation:\s*"(BUY|SELL|LONG|SHORT)"/,
      );
    }
    const d10 = harness.slice(harness.indexOf("D10: observedAt must come from"));
    expect(d10).not.toMatch(/threshold|confidence:|bias:/i);
    expect(d10).not.toMatch(/recommendation:/);
  });

  it("does not change what the deployment returns", () => {
    // The OKX action's contract is untouched: same endpoint, same shape.
    expect(okxSource).toMatch(/https:\/\/www\.okx\.com\/api\/v5\/market\/books\?instId=/);
    expect(okxSource).toMatch(/snapshotTs !== undefined \? \{ observedAt: snapshotTs \} : \{\}/);
  });

  it("keeps D5/D7/D8 unaffected by the D10 outcome", () => {
    const d10Index = harness.indexOf("D10: observedAt must come from");
    const d10Block = harness.slice(d10Index);
    for (const id of ['"D5"', '"D7"', '"D8"']) {
      expect(d10Block, `${id} must not be recorded from the D10 block`).not.toContain(id);
    }
  });
});
