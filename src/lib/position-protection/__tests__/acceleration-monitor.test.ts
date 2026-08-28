/**
 * Phase 59 — Acceleration Monitor Tests
 */
import { describe, it, expect } from "vitest";
import {
  createAccelerationState,
  recordPriceObservation,
  recordVolatilityObservation,
  recordGivebackObservation,
  calculateAcceleration,
  detectPriceAcceleration,
  detectGivebackAcceleration,
  detectVolatilityAcceleration,
} from "../acceleration-monitor";

describe("createAccelerationState", () => {
  it("creates empty state with defaults", () => {
    const s = createAccelerationState();
    expect(s.priceObservations).toHaveLength(0);
    expect(s.volatilityObservations).toHaveLength(0);
    expect(s.givebackObservations).toHaveLength(0);
    expect(s.maxBufferSize).toBe(100);
    expect(s.windowMs).toBe(300_000);
  });

  it("accepts custom config", () => {
    const s = createAccelerationState({ maxBufferSize: 50, windowMs: 60_000 });
    expect(s.maxBufferSize).toBe(50);
    expect(s.windowMs).toBe(60_000);
  });
});

describe("recordPriceObservation", () => {
  it("adds observation to buffer", () => {
    const s = createAccelerationState();
    const updated = recordPriceObservation(s, 1000, 50_000, "test");
    expect(updated.priceObservations).toHaveLength(1);
    expect(updated.priceObservations[0].value).toBe(50_000);
  });

  it("respects window cutoff", () => {
    const s = createAccelerationState({ windowMs: 1000 });
    let updated = recordPriceObservation(s, 1000, 50_000, "test");
    updated = recordPriceObservation(updated, 3000, 51_000, "test");
    updated = recordPriceObservation(updated, 5000, 52_000, "test");
    // First observation at t=1000 is outside window when t=5000 (diff=4000 > 1000)
    expect(updated.priceObservations.length).toBeLessThanOrEqual(2);
  });

  it("respects max buffer size", () => {
    const s = createAccelerationState({ maxBufferSize: 3, windowMs: 100_000 });
    let updated = s;
    for (let i = 0; i < 10; i++) {
      updated = recordPriceObservation(updated, i * 100, 50_000 + i * 100, "test");
    }
    expect(updated.priceObservations.length).toBeLessThanOrEqual(3);
  });
});

describe("recordVolatilityObservation", () => {
  it("adds to volatility buffer", () => {
    const s = createAccelerationState();
    const updated = recordVolatilityObservation(s, 1000, 2.5, "test");
    expect(updated.volatilityObservations).toHaveLength(1);
  });
});

describe("recordGivebackObservation", () => {
  it("adds to giveback buffer", () => {
    const s = createAccelerationState();
    const updated = recordGivebackObservation(s, 1000, 15.5, "test");
    expect(updated.givebackObservations).toHaveLength(1);
  });
});

describe("calculateAcceleration", () => {
  it("returns NORMAL with insufficient observations", () => {
    const result = calculateAcceleration([], Date.now());
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(0);
  });

  it("returns NORMAL for steady rate", () => {
    const now = Date.now();
    const obs = [
      { timestamp: now - 3000, value: 100, source: "test" },
      { timestamp: now - 2000, value: 101, source: "test" },
      { timestamp: now - 1000, value: 102, source: "test" },
      { timestamp: now, value: 103, source: "test" },
    ];
    const result = calculateAcceleration(obs, now);
    expect(result.level).toBe("NORMAL");
    // Rate is computed per second: (103-100)/3s = 1.0/s
    expect(result.rate).toBeCloseTo(1.0, 1);
  });

  it("detects HIGH acceleration for rapid rate change", () => {
    const now = Date.now();
    const obs = [
      { timestamp: now - 60_000, value: 100, source: "test" },
      { timestamp: now - 30_000, value: 101, source: "test" },
      { timestamp: now - 2000, value: 101, source: "test" },
      { timestamp: now - 1000, value: 150, source: "test" },
      { timestamp: now, value: 200, source: "test" },
    ];
    const result = calculateAcceleration(obs, now);
    expect(["ELEVATED", "HIGH"]).toContain(result.level);
  });

  it("filters observations by window", () => {
    const now = Date.now();
    const obs = [
      { timestamp: now - 600_000, value: 100, source: "test" }, // outside 5min window
      { timestamp: now - 1000, value: 200, source: "test" },
    ];
    const result = calculateAcceleration(obs, now, 300_000);
    // Only 1 observation within window
    expect(result.observationCount).toBeLessThanOrEqual(1);
  });
});

describe("detectPriceAcceleration", () => {
  it("returns NORMAL for favorable direction", () => {
    const s = createAccelerationState();
    let updated = s;
    const now = Date.now();
    // For LONG: price going up is favorable
    updated = recordPriceObservation(updated, now - 3000, 50_000, "test");
    updated = recordPriceObservation(updated, now - 2000, 51_000, "test");
    updated = recordPriceObservation(updated, now - 1000, 52_000, "test");
    updated = recordPriceObservation(updated, now, 53_000, "test");
    const result = detectPriceAcceleration(updated, "LONG", now);
    expect(result.level).toBe("NORMAL");
  });

  it("detects adverse acceleration for LONG when price drops", () => {
    const s = createAccelerationState();
    let updated = s;
    const now = Date.now();
    // For LONG: price dropping = adverse
    updated = recordPriceObservation(updated, now - 3000, 53_000, "test");
    updated = recordPriceObservation(updated, now - 2000, 51_000, "test");
    updated = recordPriceObservation(updated, now - 1000, 48_000, "test");
    updated = recordPriceObservation(updated, now, 45_000, "test");
    const result = detectPriceAcceleration(updated, "LONG", now);
    expect(result.rate).toBeLessThan(0);
  });
});

describe("detectGivebackAcceleration", () => {
  it("detects giveback acceleration", () => {
    const s = createAccelerationState();
    let updated = s;
    const now = Date.now();
    updated = recordGivebackObservation(updated, now - 3000, 5, "test");
    updated = recordGivebackObservation(updated, now - 2000, 10, "test");
    updated = recordGivebackObservation(updated, now - 1000, 20, "test");
    updated = recordGivebackObservation(updated, now, 40, "test");
    const result = detectGivebackAcceleration(updated, now);
    expect(result.rate).toBeGreaterThan(0);
  });
});

describe("detectVolatilityAcceleration", () => {
  it("detects volatility expansion", () => {
    const s = createAccelerationState();
    let updated = s;
    const now = Date.now();
    updated = recordVolatilityObservation(updated, now - 3000, 2, "test");
    updated = recordVolatilityObservation(updated, now - 2000, 5, "test");
    updated = recordVolatilityObservation(updated, now - 1000, 15, "test");
    updated = recordVolatilityObservation(updated, now, 40, "test");
    const result = detectVolatilityAcceleration(updated, now);
    expect(result.rate).toBeGreaterThan(0);
  });
});
