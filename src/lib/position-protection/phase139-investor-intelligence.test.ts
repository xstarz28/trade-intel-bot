/**
 * Phase 139 — Investor Intelligence Integration Tests
 *
 * Verifies that investor per-position intelligence is associated STRICTLY by
 * positionId — no cross-position contamination, no array-order inference,
 * no duplicate intelligence calculation, and no fabrication when a record is
 * missing or data quality is insufficient.
 */

import { describe, it, expect } from "vitest";
import type { MonitoredPositionState } from "./use-position-protection";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import {
  associateInvestorIntelligence,
  classifyIntelAvailability,
} from "./investor-intelligence-view";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

function makePosition(overrides: {
  positionId?: string;
  instrument?: string;
  side?: "LONG" | "SHORT";
  horizon?: string;
  severity?: string;
  thesisHealth?: string;
  thesisHealthScore?: number;
} = {}): MonitoredPositionState {
  const id = overrides.positionId ?? "pos-a";
  return {
    position: {
      positionId: id,
      instrument: overrides.instrument ?? "BTC/USD",
      side: overrides.side ?? "LONG",
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
      horizon: (overrides.horizon ?? "SWING") as "SCALPING" | "INTRADAY" | "SWING" | "INVESTING",
      openedAt: 1_700_000_000_000,
      lifecycle: "MONITORING",
    },
    alert: {
      severity: overrides.severity ?? "NONE",
      thesisHealth: overrides.thesisHealth ?? "HEALTHY",
      thesisHealthScore: overrides.thesisHealthScore ?? 80,
    } as unknown as MonitoredPositionState["alert"],
    monitoringStatus: "LIVE" as const,
    giveback: null,
    priceAcceleration: null,
    givebackAcceleration: null,
    lastUpdateAt: 1_700_000_000_000,
  };
}

function makeIntel(instrument: string, overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument,
    displayName: instrument,
    side: "LONG",
    assetClass: "crypto",
    entryPrice: 100,
    currentPrice: 105,
    marketState: "TRENDING_UP",
    shortTermContext: "short-term trend aligned with LONG position",
    mediumTermContext: "medium-term trend neutral",
    volatilityContext: "Volatility normal",
    pnlPct: 5,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "NONE",
    actionRecommendation: "Hold and monitor.",
    evidence: [],
    independentSignalCount: 0,
    confidence: "MODERATE_EVIDENCE",
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: [],
    dataQuality: "SUFFICIENT",
    observationCount: 25,
    provider: "live",
    sourceMode: "LIVE",
    ...overrides,
  } as PositionIntelligence;
}

// ═══════════════════════════════════════════════════════════════
// POSITION ASSOCIATION
// ═══════════════════════════════════════════════════════════════

describe("associateInvestorIntelligence — position isolation", () => {
  it("associates position A with position A's intelligence", () => {
    const intelA = makeIntel("BTC/USD");
    const rows = associateInvestorIntelligence(
      [makePosition({ positionId: "pos-a", instrument: "BTC/USD" })],
      new Map([["pos-a", intelA]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].positionId).toBe("pos-a");
    expect(rows[0].intel).toBe(intelA); // same engine instance — no recalculation
  });

  it("associates position B with position B's intelligence", () => {
    const intelB = makeIntel("ETH/USD");
    const rows = associateInvestorIntelligence(
      [makePosition({ positionId: "pos-b", instrument: "ETH/USD" })],
      new Map([["pos-b", intelB]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].positionId).toBe("pos-b");
    expect(rows[0].intel).toBe(intelB);
  });

  it("never cross-contaminates two positions with distinct records", () => {
    const intelA = makeIntel("BTC/USD", { marketState: "TRENDING_UP" });
    const intelB = makeIntel("ETH/USD", { marketState: "TRENDING_DOWN" });

    const rows = associateInvestorIntelligence(
      [
        makePosition({ positionId: "pos-a", instrument: "BTC/USD" }),
        makePosition({ positionId: "pos-b", instrument: "ETH/USD" }),
      ],
      new Map([
        ["pos-a", intelA],
        ["pos-b", intelB],
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].intel).toBe(intelA);
    expect(rows[1].intel).toBe(intelB);
    // Distinct records never leak across rows.
    expect(rows[0].intel).not.toBe(intelB);
    expect(rows[1].intel).not.toBe(intelA);
  });

  it("does not leak A's intelligence into B even when B has no record", () => {
    const intelA = makeIntel("BTC/USD", { marketState: "TRENDING_UP" });
    const rows = associateInvestorIntelligence(
      [
        makePosition({ positionId: "pos-a", instrument: "BTC/USD" }),
        makePosition({ positionId: "pos-b", instrument: "ETH/USD" }),
      ],
      new Map([["pos-a", intelA]]),
    );
    expect(rows[0].intel).toBe(intelA);
    // B must show unavailable — never A's record, never an array-order guess.
    expect(rows[1].intel).toBeNull();
  });

  it("associates by positionId, not by array position", () => {
    const intelA = makeIntel("BTC/USD");
    const intelB = makeIntel("ETH/USD");
    // Map insertion order is intentionally reversed vs the position array.
    const rows = associateInvestorIntelligence(
      [
        makePosition({ positionId: "pos-a", instrument: "BTC/USD" }),
        makePosition({ positionId: "pos-b", instrument: "ETH/USD" }),
      ],
      new Map([
        ["pos-b", intelB],
        ["pos-a", intelA],
      ]),
    );
    expect(rows[0].intel).toBe(intelA);
    expect(rows[1].intel).toBe(intelB);
  });

  it("does not match by instrument when positionIds differ", () => {
    // A record keyed under a different positionId for the same instrument
    // must NOT be attached to the position.
    const orphanIntel = makeIntel("BTC/USD");
    const rows = associateInvestorIntelligence(
      [makePosition({ positionId: "pos-a", instrument: "BTC/USD" })],
      new Map([["some-other-position", orphanIntel]]),
    );
    expect(rows[0].intel).toBeNull();
  });

  it("returns an empty row list for no positions", () => {
    expect(associateInvestorIntelligence([], new Map())).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// PROTECTION vs THESIS SEPARATION
// ═══════════════════════════════════════════════════════════════

describe("associateInvestorIntelligence — thesis vs protection separation", () => {
  it("keeps protection severity independent from thesis health", () => {
    // HIGH_RISK protection state does NOT imply a bearish thesis health value;
    // both fields stay available and distinct for the presentation layer.
    const pos = makePosition({
      positionId: "pos-a",
      severity: "HIGH_RISK",
      thesisHealth: "HEALTHY",
      thesisHealthScore: 85,
    });
    const rows = associateInvestorIntelligence([pos], new Map());
    expect(rows[0].severity).toBe("HIGH_RISK");
    expect(rows[0].thesisHealth).toBe("HEALTHY");
    expect(rows[0].thesisHealthScore).toBe(85);
  });

  it("preserves thesis defaults when no alert exists", () => {
    const pos = makePosition({ positionId: "pos-a" });
    const { alert, ...rest } = pos;
    const rows = associateInvestorIntelligence(
      [{ ...rest, alert: null } as MonitoredPositionState],
      new Map(),
    );
    expect(rows[0].severity).toBe("NONE");
    expect(rows[0].thesisHealth).toBe("UNKNOWN");
  });
});

// ═══════════════════════════════════════════════════════════════
// DATA SUFFICIENCY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("classifyIntelAvailability", () => {
  it("classifies missing intelligence as UNAVAILABLE", () => {
    expect(classifyIntelAvailability(null)).toBe("UNAVAILABLE");
  });

  it("maps SUFFICIENT data quality to AVAILABLE", () => {
    const intel = makeIntel("BTC/USD", { dataQuality: "SUFFICIENT" });
    expect(classifyIntelAvailability(intel)).toBe("AVAILABLE");
  });

  it("maps LIMITED data quality to LIMITED", () => {
    const intel = makeIntel("BTC/USD", { dataQuality: "LIMITED" });
    expect(classifyIntelAvailability(intel)).toBe("LIMITED");
  });

  it("maps INSUFFICIENT data quality to INSUFFICIENT", () => {
    const intel = makeIntel("BTC/USD", { dataQuality: "INSUFFICIENT" });
    expect(classifyIntelAvailability(intel)).toBe("INSUFFICIENT");
  });

  it("never promotes unknown/future data quality to AVAILABLE", () => {
    const intel = makeIntel("BTC/USD", { dataQuality: "SOMETHING_NEW" as any });
    expect(classifyIntelAvailability(intel)).toBe("INSUFFICIENT");
  });

  it("does not equate missing evidence with a bullish/bearish signal", () => {
    // An INSUFFICIENT-data record must classify as INSUFFICIENT even when
    // other presentation fields exist.
    const intel = makeIntel("BTC/USD", {
      dataQuality: "INSUFFICIENT",
      marketState: "TRENDING_UP",
      confidence: "INSUFFICIENT_EVIDENCE",
    });
    expect(classifyIntelAvailability(intel)).toBe("INSUFFICIENT");
    expect(intel.marketState).toBe("TRENDING_UP"); // raw semantics untouched
  });
});

// ═══════════════════════════════════════════════════════════════
// NO DUPLICATE CALCULATION
// ═══════════════════════════════════════════════════════════════

describe("association is a pure join (no recalculation)", () => {
  it("returns the exact engine instances without transforming them", () => {
    const intelA = makeIntel("BTC/USD");
    const intelB = makeIntel("ETH/USD", { instrument: "ETH/USD" });
    const rows = associateInvestorIntelligence(
      [
        makePosition({ positionId: "pos-a", instrument: "BTC/USD" }),
        makePosition({ positionId: "pos-b", instrument: "ETH/USD" }),
      ],
      new Map([
        ["pos-a", intelA],
        ["pos-b", intelB],
      ]),
    );
    expect(rows[0].intel).toBe(intelA);
    expect(rows[1].intel).toBe(intelB);
    // The engine objects are not cloned, copied or regenerated.
    expect(rows[0].intel?.evidence).toBe(intelA.evidence);
    expect(rows[1].intel?.invalidationConditions).toBe(intelB.invalidationConditions);
  });

  it("is deterministic given identical inputs", () => {
    const intel = makeIntel("BTC/USD");
    const map = new Map([["pos-a", intel]]);
    const positions = [makePosition({ positionId: "pos-a", instrument: "BTC/USD" })];
    const first = associateInvestorIntelligence(positions, map);
    const second = associateInvestorIntelligence(positions, map);
    expect(first).toEqual(second);
    expect(first[0].intel).toBe(second[0].intel);
  });
});
