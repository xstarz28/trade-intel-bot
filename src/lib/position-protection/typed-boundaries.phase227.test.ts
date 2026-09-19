/**
 * Phase 227 — `as any` removed from src/lib runtime code; each replacement
 * validates instead of casting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMonitorState, processEvent } from "./realtime-monitor";
import type { RealTimeEvent } from "./realtime-types";
import { eventToTimeframeEvidence } from "./multi-timeframe-engine";
import { deduplicateByDependencyGroup } from "./alert-lifecycle";
import { buildForexIntelligence } from "../data/universal/engines";

const evt = (payload: Record<string, unknown>): RealTimeEvent => ({
  eventId: "e1", instrument: "EUR/USD", timestamp: 1_000, source: "test", freshness: "FRESH",
  eventType: "REGIME_CHANGE", priority: "HIGH", dependencyGroup: "MACRO_REGIME", payload,
});

describe("227 realtime-monitor — riskRegime is validated against the union", () => {
  it.each(["risk_on", "risk_off", "transition", "unknown"] as const)("accepts %s", (r) => {
    const s = processEvent(createMonitorState(), evt({ riskRegime: r }), 2_000).state;
    expect(s.instruments.get("EUR/USD")?.riskRegime).toBe(r);
  });
  it.each(["RISK_ON", "bullish", "", 42, null, { v: "risk_on" }])("rejects %j (was cast through as any)", (r) => {
    const s = processEvent(createMonitorState(), evt({ riskRegime: r }), 2_000).state;
    expect(s.instruments.get("EUR/USD")?.riskRegime).toBeUndefined();
  });
});

describe("227 multi-timeframe-engine — payload is Record<string, unknown>", () => {
  it("booleans must be true, confidence must be a finite number", () => {
    const ev = eventToTimeframeEvidence("MARKET_STRUCTURE_CHANGE", "H4",
      { broken: "yes", adverseTrend: 1, confirmationConfidence: "90" }, "t", 1)!;
    expect(ev.structureBroken).toBe(false);
    expect(ev.adverseTrend).toBe(false);
    expect(ev.confirmationConfidence).toBe(50);
    const ok = eventToTimeframeEvidence("MARKET_STRUCTURE_CHANGE", "H4",
      { broken: true, adverseTrend: true, confirmationConfidence: 90 }, "t", 1)!;
    expect(ok).toMatchObject({ structureBroken: true, adverseTrend: true, confirmationConfidence: 90 });
    const nan = eventToTimeframeEvidence("MARKET_STRUCTURE_CHANGE", "H4", { confirmationConfidence: NaN }, "t", 1)!;
    expect(nan.confirmationConfidence).toBe(50);
  });
});

describe("227 alert-lifecycle — dedupe requires a typed severity", () => {
  it("keeps the higher severity per group", () => {
    const out = deduplicateByDependencyGroup([
      { dependencyGroup: "A", severity: 1, id: "a1" },
      { dependencyGroup: "A", severity: 3, id: "a3" },
      { dependencyGroup: "B", severity: 2, id: "b2" },
    ]);
    expect(out.map((x) => x.id).sort()).toEqual(["a3", "b2"]);
  });
});

describe("227 universal engines — provenance rows are complete DataProvenance", () => {
  it("every provenance row has fetchedAt/instrument/instrumentVerified (previously missing behind as any)", () => {
    const r = buildForexIntelligence("EUR/USD", {
      instrument: "EUR/USD", instrumentType: "forex", assembledAt: 5_000,
      evidence: [], overallAvailability: "PARTIAL", overallQuality: "DEGRADED", missingInformation: [], analystSummary: "",
      rates: { provider: "P", observedAt: 4_000, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, rateDifferential: 1 },
    });
    expect(r.provenance.length).toBeGreaterThan(0);
    for (const p of r.provenance) {
      expect(p).toMatchObject({ provider: "P", observedAt: 4_000, fetchedAt: 5_000, instrument: "EUR/USD", instrumentVerified: false, available: true });
    }
  });
});

describe("227 structural — no explicit any left in src/lib runtime files touched", () => {
  it.each([
    "src/lib/data/universal/engines.ts", "src/lib/data/universal/routing-engine.ts",
    "src/lib/position-protection/realtime-monitor.ts", "src/lib/position-protection/continuous-protection-controller.ts",
    "src/lib/position-protection/alert-lifecycle.ts", "src/lib/position-protection/protection-engine.ts",
    "src/lib/position-protection/multi-timeframe-engine.ts", "src/lib/data/providers/twelve-data.ts",
    "src/lib/data/crypto/defillama-adapter.ts", "src/lib/data/crypto/tokenomist-adapter.ts", "src/lib/data/crypto/coinglass-adapter.ts",
  ])("%s", (p) => {
    const src = readFileSync(p, "utf8");
    expect(src).not.toMatch(/:\s*any\b|as any\b|<any>|any\[\]/);
    expect(src).not.toMatch(/eslint-disable|@ts-ignore|@ts-expect-error/);
  });
});
