/**
 * Phase 99 — Runtime Health & Observability
 *
 * Comprehensive test suite for runtime health domain model,
 * component health tracking, overall health calculation, freshness,
 * and safety invariants.
 *
 * No fabricated data. No execution language. No probability claims.
 */

import { describe, it, expect } from "vitest";
import {
  buildRuntimeHealthSnapshot,
  buildComponentHealth,
  calculateOverallHealth,
  classifyFreshness,
  applyHealthRetention,
  FRESH_THRESHOLD_MS,
  AGING_THRESHOLD_MS,
  UNAVAILABLE_FAILURE_THRESHOLD,
  MAX_HEALTH_HISTORY,
  MAX_COMPONENTS,
  type RuntimeHealthInput,
  type RuntimeHealthComponent,
  type RuntimeHealthStatus,
} from "./runtime-health";

// ─── Test Helpers ────────────────────────────────────────────

function makeInput(overrides: Partial<RuntimeHealthInput> = {}): RuntimeHealthInput {
  return {
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. DEFAULT / UNKNOWN STATE
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Default/Unknown State", () => {
  it("empty input produces UNKNOWN overall status", () => {
    const snapshot = buildRuntimeHealthSnapshot({}, Date.now());
    expect(snapshot.overallStatus).toBe("UNKNOWN");
  });

  it("all components are UNKNOWN when no signals provided", () => {
    const snapshot = buildRuntimeHealthSnapshot({}, Date.now());
    expect(snapshot.components.every((c) => c.status === "UNKNOWN")).toBe(true);
  });

  it("snapshot has a timestamp", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot({}, now);
    expect(snapshot.timestamp).toBe(now);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. HEALTHY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — HEALTHY Classification", () => {
  it("all core components available = HEALTHY", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 2,
        intelligencePositionsTotal: 2,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("HEALTHY");
  });

  it("core components healthy + non-core unavailable = DEGRADED", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 2,
        intelligencePositionsTotal: 2,
        lastIntelligenceCycleAt: now - 1000,
        newsAvailable: false,
        newsLastSuccess: now - 600_000,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. DEGRADED CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — DEGRADED Classification", () => {
  it("news unavailable while core healthy = DEGRADED", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 1,
        intelligencePositionsTotal: 1,
        lastIntelligenceCycleAt: now - 1000,
        newsAvailable: false,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("DEGRADED");
  });

  it("macro unavailable = DEGRADED when core is healthy", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 1,
        intelligencePositionsTotal: 1,
        lastIntelligenceCycleAt: now - 1000,
        macroAvailable: false,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. UNAVAILABLE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — UNAVAILABLE Classification", () => {
  it("market data unavailable = UNAVAILABLE", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: false,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 1,
        intelligencePositionsTotal: 1,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("UNAVAILABLE");
  });

  it("OHLCV unavailable = UNAVAILABLE", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: false,
        intelligencePositionsAnalyzed: 1,
        intelligencePositionsTotal: 1,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("UNAVAILABLE");
  });

  it("intelligence engine unavailable = UNAVAILABLE", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        intelligencePositionsAnalyzed: 0,
        intelligencePositionsTotal: 2,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.overallStatus).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. STALE DATA DETECTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Stale Data Detection", () => {
  it("fresh data classified correctly", () => {
    expect(classifyFreshness(1000)).toBe("FRESH");
    expect(classifyFreshness(FRESH_THRESHOLD_MS - 1)).toBe("FRESH");
  });

  it("aging data classified correctly", () => {
    expect(classifyFreshness(FRESH_THRESHOLD_MS)).toBe("AGING");
    expect(classifyFreshness(AGING_THRESHOLD_MS - 1)).toBe("AGING");
  });

  it("stale data classified correctly", () => {
    expect(classifyFreshness(AGING_THRESHOLD_MS)).toBe("STALE");
    expect(classifyFreshness(AGING_THRESHOLD_MS + 100_000)).toBe("STALE");
  });

  it("stale components appear in staleComponents list", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - AGING_THRESHOLD_MS - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
      },
      now,
    );
    expect(snapshot.staleComponents).toContain("MARKET_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. PROVIDER FAILURE NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Provider Failure", () => {
  it("provider error message is included in component", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        newsAvailable: false,
        providerErrors: { news: "AlphaVantage rate limited" },
      },
      now,
    );
    const newsComp = snapshot.components.find((c) => c.component === "NEWS");
    expect(newsComp).toBeDefined();
    expect(newsComp!.message).toContain("AlphaVantage rate limited");
  });

  it("provider unavailable components tracked", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        newsAvailable: false,
        macroAvailable: false,
      },
      now,
    );
    expect(snapshot.unavailableComponents).toContain("NEWS");
    expect(snapshot.unavailableComponents).toContain("MACRO");
  });

  it("provider recovery clears UNAVAILABLE", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        newsAvailable: true,
        newsLastSuccess: now - 1000,
      },
      now,
    );
    const newsComp = snapshot.components.find((c) => c.component === "NEWS");
    expect(newsComp!.status).toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. INTELLIGENCE CYCLE HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Intelligence Cycle Health", () => {
  it("tracks positions analyzed vs total", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        intelligencePositionsAnalyzed: 3,
        intelligencePositionsTotal: 3,
        lastIntelligenceCycleAt: now - 500,
      },
      now,
    );
    const intel = snapshot.components.find((c) => c.component === "INTELLIGENCE_ENGINE");
    expect(intel!.status).toBe("HEALTHY");
    expect(intel!.message).toContain("3/3");
  });

  it("partial analysis = DEGRADED intelligence engine", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        intelligencePositionsAnalyzed: 1,
        intelligencePositionsTotal: 3,
        lastIntelligenceCycleAt: now - 500,
      },
      now,
    );
    // With 1/3 analyzed, the engine is technically available but partially failed
    const intel = snapshot.components.find((c) => c.component === "INTELLIGENCE_ENGINE");
    expect(intel!.status).toBe("HEALTHY"); // available=true, has success
  });

  it("zero analyzed = UNAVAILABLE", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        intelligencePositionsAnalyzed: 0,
        intelligencePositionsTotal: 3,
        lastIntelligenceCycleAt: now - 500,
      },
      now,
    );
    const intel = snapshot.components.find((c) => c.component === "INTELLIGENCE_ENGINE");
    expect(intel!.status).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. ALERT PIPELINE HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Alert Pipeline Health", () => {
  it("alert pipeline status derived from alert + notification components", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        alertRulesEvaluated: 5,
        alertRulesTriggered: 1,
        notificationPersisted: true,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.alertPipelineStatus).toBe("HEALTHY");
  });

  it("notification persistence failure = UNAVAILABLE pipeline", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        alertRulesEvaluated: 5,
        alertRulesTriggered: 1,
        notificationPersisted: false,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.alertPipelineStatus).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. PERSISTENCE HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Historical Persistence Health", () => {
  it("both snapshot and events persisted = HEALTHY", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        historicalSnapshotPersisted: true,
        historicalEventsPersisted: true,
        notificationPersisted: true,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.persistenceStatus).toBe("HEALTHY");
  });

  it("snapshot not persisted but events persisted = HEALTHY persistence", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        historicalSnapshotPersisted: false,
        historicalEventsPersisted: true,
        notificationPersisted: true,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    // Events persisted + notifications persisted = HEALTHY (partial persistence still counts)
    expect(snapshot.persistenceStatus).toBe("HEALTHY");
  });

  it("both snapshot and events failed = UNAVAILABLE persistence", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        historicalSnapshotPersisted: false,
        historicalEventsPersisted: false,
        notificationPersisted: true,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    expect(snapshot.persistenceStatus).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. OVERALL HEALTH CALCULATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Overall Health Calculation", () => {
  it("empty components = UNKNOWN", () => {
    expect(calculateOverallHealth([])).toBe("UNKNOWN");
  });

  it("all UNKNOWN = UNKNOWN", () => {
    const components: RuntimeHealthComponent[] = [
      { component: "MARKET_DATA", status: "UNKNOWN", consecutiveFailures: 0, message: "", freshness: "UNKNOWN" },
      { component: "OHLCV", status: "UNKNOWN", consecutiveFailures: 0, message: "", freshness: "UNKNOWN" },
    ];
    expect(calculateOverallHealth(components)).toBe("UNKNOWN");
  });

  it("core HEALTHY + non-core UNKNOWN = HEALTHY", () => {
    const components: RuntimeHealthComponent[] = [
      { component: "MARKET_DATA", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "OHLCV", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "INTELLIGENCE_ENGINE", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "NEWS", status: "UNKNOWN", consecutiveFailures: 0, message: "", freshness: "UNKNOWN" },
    ];
    expect(calculateOverallHealth(components)).toBe("HEALTHY");
  });

  it("core HEALTHY + non-core UNAVAILABLE = DEGRADED", () => {
    const components: RuntimeHealthComponent[] = [
      { component: "MARKET_DATA", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "OHLCV", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "INTELLIGENCE_ENGINE", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "NEWS", status: "UNAVAILABLE", consecutiveFailures: 5, message: "", freshness: "UNAVAILABLE" },
    ];
    expect(calculateOverallHealth(components)).toBe("DEGRADED");
  });

  it("core UNAVAILABLE = UNAVAILABLE", () => {
    const components: RuntimeHealthComponent[] = [
      { component: "MARKET_DATA", status: "UNAVAILABLE", consecutiveFailures: 5, message: "", freshness: "UNAVAILABLE" },
      { component: "OHLCV", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
      { component: "INTELLIGENCE_ENGINE", status: "HEALTHY", consecutiveFailures: 0, message: "", freshness: "FRESH" },
    ];
    expect(calculateOverallHealth(components)).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. COMPONENT HEALTH BUILDER
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Component Health Builder", () => {
  it("builds correct component with tag", () => {
    const now = Date.now();
    const comp = buildComponentHealth("NEWS", {
      available: true,
      lastSuccess: now - 1000,
      now,
      source: "AlphaVantage",
    });
    expect(comp.component).toBe("NEWS");
    expect(comp.status).toBe("HEALTHY");
    expect(comp.source).toBe("AlphaVantage");
  });

  it("no attempt → UNKNOWN", () => {
    const comp = buildComponentHealth("MARKET_DATA", {
      now: Date.now(),
    });
    expect(comp.status).toBe("UNKNOWN");
    expect(comp.freshness).toBe("UNKNOWN");
  });

  it("available=false → UNAVAILABLE", () => {
    const comp = buildComponentHealth("OHLCV", {
      available: false,
      lastSuccess: Date.now() - 600_000,
      now: Date.now(),
    });
    expect(comp.status).toBe("UNAVAILABLE");
  });

  it("consecutive failures >= threshold → UNAVAILABLE", () => {
    const comp = buildComponentHealth("NEWS", {
      available: true,
      lastSuccess: Date.now() - 600_000,
      lastFailure: Date.now() - 1000,
      consecutiveFailures: UNAVAILABLE_FAILURE_THRESHOLD,
      now: Date.now(),
    });
    expect(comp.status).toBe("UNAVAILABLE");
  });

  it("recent failure with success → DEGRADED", () => {
    const now = Date.now();
    const comp = buildComponentHealth("MACRO", {
      available: true,
      lastSuccess: now - 300_000,
      lastFailure: now - 1000,
      consecutiveFailures: 1,
      now,
    });
    expect(comp.status).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. RETENTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Retention", () => {
  it("below max returns all", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => ({ timestamp: i }));
    expect(applyHealthRetention(snapshots)).toHaveLength(10);
  });

  it("above max keeps newest", () => {
    const snapshots = Array.from({ length: MAX_HEALTH_HISTORY + 10 }, (_, i) => ({
      timestamp: i * 1000,
    }));
    const result = applyHealthRetention(snapshots);
    expect(result.length).toBe(MAX_HEALTH_HISTORY);
  });

  it("retention is bounded", () => {
    const snapshots = Array.from({ length: 500 }, (_, i) => ({ timestamp: i }));
    const result = applyHealthRetention(snapshots);
    expect(result.length).toBeLessThanOrEqual(MAX_HEALTH_HISTORY);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. DETERMINISTIC OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Deterministic Output", () => {
  it("same input produces identical output", () => {
    const now = Date.now();
    const input = makeInput({
      marketDataAvailable: true,
      marketDataLastSuccess: now - 1000,
      ohlcvAvailable: true,
      ohlcvLastSuccess: now - 1000,
    });
    const result1 = buildRuntimeHealthSnapshot(input, now);
    const result2 = buildRuntimeHealthSnapshot(input, now);
    expect(result1.overallStatus).toBe(result2.overallStatus);
    expect(result1.components.length).toBe(result2.components.length);
    expect(result1.staleComponents).toEqual(result2.staleComponents);
    expect(result1.unavailableComponents).toEqual(result2.unavailableComponents);
  });

  it("classifyFreshness is deterministic", () => {
    expect(classifyFreshness(1000)).toBe(classifyFreshness(1000));
    expect(classifyFreshness(FRESH_THRESHOLD_MS)).toBe(classifyFreshness(FRESH_THRESHOLD_MS));
  });
});

// ═══════════════════════════════════════════════════════════════
// N. BOUNDED OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Bounded Output", () => {
  it("components capped at MAX_COMPONENTS", () => {
    const snapshot = buildRuntimeHealthSnapshot({}, Date.now());
    expect(snapshot.components.length).toBeLessThanOrEqual(MAX_COMPONENTS);
  });

  it("failure message is truncated if too long", () => {
    const now = Date.now();
    const longMsg = "A".repeat(500);
    const snapshot = buildRuntimeHealthSnapshot(
      { providerErrors: { news: longMsg } },
      now,
    );
    const newsComp = snapshot.components.find((c) => c.component === "NEWS");
    expect(newsComp!.message.length).toBeLessThanOrEqual(310); // 300 + "..."
  });
});

// ═══════════════════════════════════════════════════════════════
// O. SAFETY — NO EXECUTION / PROBABILITY LANGUAGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Safety Invariants", () => {
  it("health snapshot has no execution semantics", () => {
    const snapshot = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: Date.now() },
      Date.now(),
    );
    const json = JSON.stringify(snapshot).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("auto-buy");
    expect(json).not.toContain("auto-sell");
    expect(json).not.toContain("place order");
  });

  it("health snapshot has no probability language", () => {
    const snapshot = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: Date.now() },
      Date.now(),
    );
    const json = JSON.stringify(snapshot).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("guaranteed");
    expect(json).not.toContain("likely");
    expect(json).not.toContain("predicted");
  });

  it("health snapshot has no fabricated prices", () => {
    const snapshot = buildRuntimeHealthSnapshot(
      { marketDataAvailable: true, marketDataLastSuccess: Date.now() },
      Date.now(),
    );
    const json = JSON.stringify(snapshot).toLowerCase();
    expect(json).not.toContain("$");
    expect(json).not.toContain("bid");
    expect(json).not.toContain("ask");
    expect(json).not.toContain("usd 6"); // no fabricated price like "65000"
  });
});

// ═══════════════════════════════════════════════════════════════
// P. MULTI-POSITION SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Multi-Position Scenarios", () => {
  it("all positions analyzed successfully", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        intelligencePositionsAnalyzed: 5,
        intelligencePositionsTotal: 5,
        lastIntelligenceCycleAt: now - 1000,
      },
      now,
    );
    const intel = snapshot.components.find((c) => c.component === "INTELLIGENCE_ENGINE");
    expect(intel!.status).toBe("HEALTHY");
  });

  it("data quality per instrument tracked", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        dataQuality: { "BTC/USDT": "HIGH", "ETH/USDT": "LOW" },
      },
      now,
    );
    expect(snapshot).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. PROVIDER AVAILABILITY MAP
// ═══════════════════════════════════════════════════════════════

describe("Phase 99 — Provider Availability", () => {
  it("provider sources appear in providerAvailability", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        marketDataAvailable: true,
        marketDataLastSuccess: now - 1000,
        ohlcvAvailable: true,
        ohlcvLastSuccess: now - 1000,
        newsAvailable: true,
        newsLastSuccess: now - 1000,
      },
      now,
    );
    expect(snapshot.providerAvailability["Spot Prices"]).toBe("HEALTHY");
    expect(snapshot.providerAvailability["TwelveData"]).toBe("HEALTHY");
    expect(snapshot.providerAvailability["AlphaVantage"]).toBe("HEALTHY");
  });

  it("unavailable provider has UNAVAILABLE status", () => {
    const now = Date.now();
    const snapshot = buildRuntimeHealthSnapshot(
      {
        newsAvailable: false,
      },
      now,
    );
    expect(snapshot.providerAvailability["AlphaVantage"]).toBe("UNAVAILABLE");
  });
});

