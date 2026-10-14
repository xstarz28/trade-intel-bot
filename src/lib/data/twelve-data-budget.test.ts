import { describe, expect, it } from "vitest";
import { TwelveDataRequestBudget } from "./twelve-data-budget";

describe("TwelveDataRequestBudget", () => {
  it("reserves primary market calls ahead of higher-timeframe context", () => {
    const budget = new TwelveDataRequestBudget();
    const now = 100_000;

    expect(budget.reserve("primary", now).allowed).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(budget.reserve("higher-timeframe", now).allowed).toBe(true);
    }

    const deniedHigherTimeframe = budget.reserve("higher-timeframe", now);
    expect(deniedHigherTimeframe.allowed).toBe(false);

    // Optional data must not crowd out the core market-analysis path.
    expect(budget.reserve("optional", now).allowed).toBe(false);
    expect(budget.reserve("primary", now).allowed).toBe(true);
  });

  it("supports two complete M5 context pairs without exceeding the shared total cap", () => {
    const budget = new TwelveDataRequestBudget();
    const now = 150_000;

    // M5 setup #1: primary candles, M15 structure, M1 trigger.
    expect(budget.reserve("primary", now).allowed).toBe(true);
    expect(budget.reserve("higher-timeframe", now).allowed).toBe(true);
    expect(budget.reserve("higher-timeframe", now).allowed).toBe(true);

    // M5 setup #2 gets the same required context under the 7-request guard.
    expect(budget.reserve("primary", now + 1).allowed).toBe(true);
    expect(budget.reserve("higher-timeframe", now + 1).allowed).toBe(true);
    expect(budget.reserve("higher-timeframe", now + 1).allowed).toBe(true);

    expect(budget.getSnapshot(now + 1)).toMatchObject({
      requestsInWindow: 6,
      primaryRequests: 2,
      higherTimeframeRequests: 4,
      optionalRequests: 0,
    });

    // Total stays hard-capped at seven (one below the provider's observed eight).
    expect(budget.reserve("primary", now + 2).allowed).toBe(true);
    expect(budget.reserve("higher-timeframe", now + 3).allowed).toBe(false);
    expect(budget.getSnapshot(now + 3).requestsInWindow).toBe(7);
  });

  it("keeps the total rolling budget below the observed 8-credit/minute cap", () => {
    const budget = new TwelveDataRequestBudget();
    const now = 200_000;

    for (let i = 0; i < 5; i++) {
      expect(budget.reserve("primary", now + i).allowed).toBe(true);
    }
    for (let i = 0; i < 2; i++) {
      expect(budget.reserve("higher-timeframe", now + 10 + i).allowed).toBe(true);
    }

    const denied = budget.reserve("primary", now + 20);
    expect(denied.allowed).toBe(false);
    expect(budget.getSnapshot(now + 20)).toMatchObject({
      requestsInWindow: 7,
      primaryRequests: 5,
      higherTimeframeRequests: 2,
      optionalRequests: 0,
    });
  });

  it("activates a 60-second global cooldown after a real provider rate-limit", () => {
    const budget = new TwelveDataRequestBudget();
    const now = 300_000;

    budget.markRateLimited(now);
    const blocked = budget.reserve("primary", now + 59_999);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAt).toBe(now + 60_000);

    expect(budget.reserve("primary", now + 60_000).allowed).toBe(true);
  });

  it("expires old reservations at the rolling-window boundary", () => {
    const budget = new TwelveDataRequestBudget();
    const now = 400_000;

    for (let i = 0; i < 5; i++) budget.reserve("primary", now);
    expect(budget.reserve("primary", now + 1).allowed).toBe(false);
    expect(budget.reserve("primary", now + 60_000).allowed).toBe(true);
  });
});
