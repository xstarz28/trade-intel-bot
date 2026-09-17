/**
 * Phase 14 — RUNTIME RELIABILITY validation.
 *
 * P1  Fault injection at the highest testable boundary (provider parsers +
 *     context builders) using REAL failure payload shapes: HTTP error pages,
 *     rate-limit bodies, truncated responses, empty objects.
 * P3/P11 Engine purity & state isolation: input never mutated; 100 sequential
 *     mixed runs produce zero cross-contamination.
 * P5  Observability event: allowlisted, secret-free, decision-neutral.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import {
  parseTreasuryXml,
  buildTreasuryContext,
} from "./data/treasury";
import { parseEiaResponse } from "./data/eia";
import { buildCotContext } from "./data/cot";
import { parseOkxOrderBook } from "./execution-quality";
import {
  assemble,
  buildMtf,
  BULL_LEVELS,
  macro,
  execution as executionFixture,
  executionUnavailable,
} from "./benchmark-fixtures.phase9";
import {
  buildObservabilityEvent,
  observabilityAllowlist,
} from "./decision-trace";

type RunSpec = Parameters<typeof assemble>[0] & Record<string, unknown>;
const run = (spec: RunSpec = {}) =>
  runAnalysis({ ...assemble(spec), ...spec } as never);

const BULL = {
  structure: "HH/HL" as const,
  bos: "bullish" as const,
  support: BULL_LEVELS.support,
  resistance: BULL_LEVELS.resistance,
  sweepSide: "sell_side" as const,
  mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
  events: "Fed signals hawkish stance, rate hike",
};
const NOW = Date.now();

// ═══════════ P1 — FAULT INJECTION AT THE PROVIDER-PARSE BOUNDARY ════

describe("fault injection: real failure payloads into provider parsers", () => {
  const failureBodies: [string, string][] = [
    ["empty body", ""],
    ["HTML 503 page", "<html><body><h1>503 Service Unavailable</h1></body></html>"],
    ["rate-limit JSON", JSON.stringify({ error: "rate limit exceeded", code: "429" })],
    ["auth error JSON", JSON.stringify({ error: "invalid api key", code: "401" })],
    ["truncated XML", '<?xml version="1.0"?><feed xmlns="d"><entry><d:BC_2YEAR>4.'],
    ["binary garbage", "\u0000\u0001\u0002\u0003"],
  ];

  it("Treasury: every failure body → zero parsed points, unavailable context", () => {
    for (const [name, body] of failureBodies) {
      const pts = parseTreasuryXml(body, "nominal");
      expect(pts).toEqual([]);
      const ctx = buildTreasuryContext([body, ""], [], NOW, NOW);
      expect(ctx.available).toBe(false);
      if (!ctx.available) expect(ctx.reason.length).toBeGreaterThan(0);
      void name;
    }
  });

  it("EIA: malformed/error responses → typed ok:false with sanitized reason", () => {
    for (const body of [
      null,
      undefined,
      {},
      { response: {} },
      { response: { data: null } },
      { error: "quota exceeded", code: "403" },
      "<html>502 Bad Gateway</html>",
      "",
    ]) {
      const r = parseEiaResponse(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("COT: empty/garbage rows → honest unavailable context", () => {
    for (const rows of [[], [null], ["garbage"], [{}, undefined]]) {
      const ctx = buildCotContext(rows as never, "EUR/USD", NOW, NOW);
      expect(ctx.available).toBe(false); // no usable rows → no positioning data
      if (!ctx.available) expect(ctx.reason).toBeTruthy();
    }
    // Unsupported asset never fabricates a mapping either.
    const unmapped = buildCotContext([], "BTC/USDT", NOW, NOW);
    expect(unmapped.available).toBe(false);
  });

  it("OKX order book: garbage payloads → typed error, fail-safe execution context", () => {
    for (const body of [null, {}, { data: "not-an-array" }, { code: "5", msg: "rate limited" }, []]) {
      const r = parseOkxOrderBook(body);
      expect(r.ok).toBe(false);
    }
    const r = run(BULL);
    // Oracle equality already proven below; here just assert honesty flags exist.
    expect(r.decisionTrace!.provenance.find((p) => p.provider === "OKX order book")!.available).toBe(false);
  });

  it("engine oracle: all-optional-providers-unavailable == absent (I5)", () => {
    const base = run(BULL);
    const withDead = run({
      ...BULL,
      treasuryData: { available: false, reason: "timeout" } as never,
      cotData: { available: false, reason: "timeout" } as never,
      eiaData: { available: false, reason: "timeout" } as never,
      executionData: executionUnavailable(),
    });
    expect(withDead.recommendation).toBe(base.recommendation);
    expect(withDead.confidence).toBe(base.confidence);
    expect(withDead.decisionFingerprint).toBe(base.decisionFingerprint);
    // INFORMATIONAL flags present, none DECISIVE from failure.
    expect(withDead.decisionTrace!.criticalFlags.filter((f) => /timeout/.test(f))).toEqual([]);
  });

  it("crypto execution timeout → identical thesis to no-execution oracle", () => {
    const base = run({
      ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"),
    });
    const timedOut = run({
      ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"),
      executionData: { available: false, reason: "upstream timeout after platform action budget" } as never,
    });
    const healthy = run({
      ...BULL, instrument: "BTC/USDT", instrumentType: "crypto", macroData: macro("bullish"),
      executionData: executionFixture(0.7),
    });
    expect(timedOut.recommendation).toBe(base.recommendation);
    expect(timedOut.decisionFingerprint).toBe(base.decisionFingerprint);
    // A HEALTHY book may add tilt within cap but can never flip the thesis.
    expect(["LONG", "NO_TRADE"]).toContain(healthy.recommendation);
  });
});

// ═══════════ P3/P11 — PURITY, RACE & STATE-ISOLATION PROOF ══════════

describe("engine purity & cross-run isolation", () => {
  it("runAnalysis NEVER mutates its input (shared-object race safety)", () => {
    const input = { ...assemble(BULL), ...BULL };
    const before = JSON.stringify(input);
    runAnalysis(input as never);
    runAnalysis(input as never);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("100 sequential mixed runs: zero contamination, first == last == oracle", () => {
    const cryptoSpec = {
      structure: "HH/HL" as const, bos: "bullish" as const,
      support: BULL_LEVELS.support, resistance: BULL_LEVELS.resistance,
      sweepSide: "sell_side" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BULLISH", htfBias: "long", triggerTf: "H1" }),
      instrument: "BTC/USDT", instrumentType: "crypto" as const,
      style: "scalping",
    };
    const forexSpec = {
      structure: "LH/LL" as const, bos: "bearish" as const,
      support: BEAR_LEVELS_ALT.support, resistance: BEAR_LEVELS_ALT.resistance,
      sweepSide: "buy_side" as const,
      mtf: buildMtf({ alignment: "ALIGNED_BEARISH", htfBias: "short", triggerTf: "H1" }),
      events: "ECB dovish, rate cut expected",
      style: "swing",
    };
    const strip = (r: ReturnType<typeof runAnalysis>) =>
      `${r.recommendation}|${r.bias}|${r.confidence}|${r.decisionFingerprint}`;
    const cryptoOracle = strip(run(cryptoSpec));
    const forexOracle = strip(run(forexSpec));

    let lastCrypto = "";
    let lastForex = "";
    for (let i = 0; i < 100; i++) {
      const r = run(i % 2 === 0 ? cryptoSpec : forexSpec);
      if (i % 2 === 0) lastCrypto = strip(r);
      else lastForex = strip(r);
    }
    expect(lastCrypto).toBe(cryptoOracle); // run #100 == fresh oracle
    expect(lastForex).toBe(forexOracle);
  });

  it("interleaved analysis objects stay isolated (no module-level accumulation)", () => {
    const a = run(BULL);
    for (let i = 0; i < 25; i++) run({}); // noisy neutral runs in between
    const b = run(BULL);
    expect(b.decisionFingerprint).toBe(a.decisionFingerprint);
    expect(b.confidence).toBe(a.confidence);
    expect(b.decisionTrace!.convictionBreakdown.layers.length).toBe(
      a.decisionTrace!.convictionBreakdown.layers.length,
    );
  });
});
const BEAR_LEVELS_ALT = { support: 88, resistance: 105 };

// ═══════════ P5 — OBSERVABILITY EVENT ═══════════════════════════════

describe("runtime observability event", () => {
  it("allowlisted fields ONLY — the event shape cannot grow silently", () => {
    const r = run({ ...BULL, treasuryData: { available: false, reason: "timeout" } as never });
    const ev = buildObservabilityEvent(r.decisionTrace!);
    expect(Object.keys(ev).sort()).toEqual([...observabilityAllowlist()].sort());
    expect(Object.keys(ev.freshnessByProvider)).toEqual(
      Object.keys(ev.freshnessByProvider),
    );
    expect(Object.keys(ev.freshnessByProvider).length).toBeGreaterThan(0);
  });

  it("secret-free, deterministic, and decision-neutral", () => {
    const r = run(BULL);
    const fpBefore = r.decisionFingerprint;
    const ev1 = buildObservabilityEvent(r.decisionTrace!);
    const ev2 = buildObservabilityEvent(r.decisionTrace!);
    expect(ev1).toEqual(ev2); // deterministic
    const raw = JSON.stringify(ev1).toLowerCase();
    for (const forbidden of ["apikey", "api_key", "secret", "token", "authorization", "bearer"]) {
      expect(raw).not.toContain(forbidden);
    }
    // Building the event did not alter the decision state.
    expect(r.decisionFingerprint).toBe(fpBefore);
    expect(buildObservabilityEvent(r.decisionTrace!).fingerprint).toBe(fpBefore);
  });

  it("failure categories surface as freshness/unavailable — never directional words", () => {
    const r = run({
      ...BULL,
      treasuryData: { available: false, reason: "timeout after 30s" } as never,
      executionData: executionUnavailable(),
    });
    const ev = buildObservabilityEvent(r.decisionTrace!);
    expect(ev.freshnessByProvider["US Treasury XML feed"]).toBe("unavailable");
    expect(ev.freshnessByProvider["OKX order book"]).toBe("unavailable");
    const raw = JSON.stringify(ev.freshnessByProvider);
    expect(raw).not.toMatch(/bearish|bullish/i);
  });
});
