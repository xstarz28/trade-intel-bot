/**
 * Phase 226 — `NO_SECRETS_IN_ALERT` is a real check.
 *
 * Before: the pipeline stage computed `hasSecret` from bare English words
 * (/token/, /secret/…) and then pushed `passed: true` unconditionally — a
 * permanent false-green that no input could turn red. The security audit's
 * `NO_EMBEDDED_SECRETS` had four narrow regexes and would PASS an alert it
 * could not even serialise.
 *
 * Now both go through `scanForSecrets`, whose contract this file pins:
 *   secret shape present  → FAIL, reason names the pattern class only
 *   no secret             → PASS, reason states what was inspected
 *   uninspectable input   → FAIL (never false-green)
 *   English prose         → PASS (no word-based false positives)
 */
import { describe, expect, it } from "vitest";
import { scanForSecrets, describeSecretScan, SECRET_PATTERNS } from "./secret-detector";
import { validateIntegrationPipeline, runSecurityAudit } from "./phase69-runtime-hardening";
import { evaluateProtection } from "./protection-engine";
import type { PositionContext } from "./types";
import type { MarketEvidence } from "./thesis-health";

const NOW = 1_700_000_000_000;

// Synthetic, non-functional credential shapes. None is a real key.
const FAKE = {
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  stripe: "sk_live_" + "abcdefghijklmnop1234",
  github: "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  jwt: "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0" + "." + "abcdefghijklmnopqrstuvwxyz",
  bearer: "Bearer " + "abcdefghijklmnopqrstuvwxyz012345",
  assignment: "api_key=" + "ZZZZZZZZZZZZZZZZZZZZ",
  url: "https://x.example/quote?symbol=BTC&apikey=" + "0123456789abcdef",
  env: "process.env." + "COINGLASS_API_KEY",
  pem: "-----BEGIN RSA PRIVATE KEY-----",
};

function position(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT", assetClass: "crypto", side: "LONG",
    entryPrice: 100, currentPrice: 110, stopLoss: 95, takeProfit: 120,
    leverage: 10, horizon: "SWING", openedAt: NOW - 3_600_000, ...overrides,
  };
}
function evidence(price = 110): MarketEvidence {
  return {
    price, shortTermTrend: "bullish", mediumTermTrend: "bullish", longTermTrend: "bullish",
    momentumChange: 5, volatility: 2, avgVolatility: 2, structureBroken: false,
    fundingRate: 0.001, oiChange: 5, riskRegime: "risk_on", riskRegimeChanged: false, vix: 18,
  };
}
const stage = (pos: PositionContext) =>
  validateIntegrationPipeline({ position: pos, evidence: evidence(pos.currentPrice), now: NOW })
    .stages.find((s) => s.stage === "NO_SECRETS_IN_ALERT")!;

describe("226 — scanForSecrets: detection", () => {
  it.each(Object.entries(FAKE))("detects %s shape", (_name, value) => {
    const r = scanForSecrets({ note: `context ${value} more` });
    expect(r.found).toBe(true);
    expect(r.inspectable).toBe(true);
    expect(r.matched.length).toBeGreaterThan(0);
  });

  it("reports the pattern class, never the matched value", () => {
    const r = scanForSecrets({ k: FAKE.stripe });
    expect(r.matched).toEqual(["stripe-key"]);
    const text = describeSecretScan(r, "Alert");
    expect(text).toContain("stripe-key");
    expect(text).not.toContain(FAKE.stripe);
    expect(text).not.toContain("abcdefghijklmnop1234");
  });

  it("every pattern class has a distinct name", () => {
    const names = SECRET_PATTERNS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("226 — scanForSecrets: no word-based false positives", () => {
  it.each([
    "token unlock schedule in 3 days",
    "the secret to this setup is patience",
    "password-protected broker portal mentioned in news",
    "API key rotation announced by exchange",
    "credential requirements for institutional desks",
    "missingData: fundingRate, tokenomics",
  ])("prose: %s → not a secret", (prose) => {
    const r = scanForSecrets({ supportingEvidence: [prose] });
    expect(r.found).toBe(false);
    expect(r.inspectable).toBe(true);
  });

  it("a real engine alert passes and the reason states what was inspected", () => {
    const s = stage(position());
    expect(s.passed).toBe(true);
    expect(s.reason).toMatch(/inspected \(\d+ chars, \d+ pattern classes\): no credential-shaped content/);
  });
});

describe("226 — scanForSecrets: malformed / uninspectable input never false-greens", () => {
  it("circular object → inspectable=false, found=false", () => {
    const a: Record<string, unknown> = {}; a.self = a;
    const r = scanForSecrets(a);
    expect(r.inspectable).toBe(false);
    expect(r.found).toBe(false);
    expect(describeSecretScan(r, "Alert")).toMatch(/could not be serialised/);
  });

  it("BigInt / throwing toJSON / undefined → uninspectable", () => {
    expect(scanForSecrets({ n: 10n }).inspectable).toBe(false);
    expect(scanForSecrets({ toJSON() { throw new Error("boom"); } }).inspectable).toBe(false);
    expect(scanForSecrets(undefined).inspectable).toBe(false);
  });

  it("runSecurityAudit FAILS NO_EMBEDDED_SECRETS on an uninspectable alert", () => {
    const { alert } = evaluateProtection({ position: position(), evidence: evidence(), now: NOW });
    const circular = { ...alert } as Record<string, unknown>; circular.self = circular;
    const audit = runSecurityAudit(circular as unknown as typeof alert);
    const check = audit.checks.find((c) => c.name === "NO_EMBEDDED_SECRETS")!;
    expect(check.passed).toBe(false);
    expect(audit.overallPass).toBe(false);
  });
});

describe("226 — the pipeline stage and audit check are wired to the detector", () => {
  it("a credential shape that reaches the alert turns NO_SECRETS_IN_ALERT red", () => {
    // `instrument` is copied verbatim into the alert; that is the injection path.
    const s = stage(position({ instrument: `BTC/USDT ${FAKE.aws}` }));
    expect(s.passed).toBe(false);
    expect(s.reason).toContain("aws-access-key-id");
    expect(s.reason).not.toContain(FAKE.aws);
  });

  it("the whole pipeline result fails when the secret stage fails", () => {
    const r = validateIntegrationPipeline({ position: position({ instrument: `ETH/USDT ${FAKE.github}` }), evidence: evidence(), now: NOW });
    expect(r.passed).toBe(false);
    expect(r.overallReason).toContain("NO_SECRETS_IN_ALERT");
  });

  it("runSecurityAudit FAILS NO_EMBEDDED_SECRETS for each shape and PASSES for a clean alert", () => {
    for (const value of Object.values(FAKE)) {
      const { alert } = evaluateProtection({ position: position({ instrument: `BTC/USDT ${value}` }), evidence: evidence(), now: NOW });
      const check = runSecurityAudit(alert).checks.find((c) => c.name === "NO_EMBEDDED_SECRETS")!;
      expect(check.passed, value.slice(0, 6)).toBe(false);
      expect(check.description).not.toContain(value);
    }
    const { alert } = evaluateProtection({ position: position(), evidence: evidence(), now: NOW });
    expect(runSecurityAudit(alert).checks.find((c) => c.name === "NO_EMBEDDED_SECRETS")!.passed).toBe(true);
  });

  it("the stage is not hard-coded (structural): no literal `passed: true` on NO_SECRETS_IN_ALERT", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/position-protection/phase69-runtime-hardening.ts", "utf8");
    const block = src.slice(src.indexOf('stage: "NO_SECRETS_IN_ALERT"'), src.indexOf('stage: "NO_SECRETS_IN_ALERT"') + 200);
    expect(block).not.toMatch(/passed:\s*true/);
    expect(block).toContain("secretScan");
  });
});
