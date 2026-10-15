import { describe, expect, it } from "vitest";
import { fetchOptionalSlowData, type SlowProviderFacts, type SlowProviderThunks } from "./optional-providers";

function makeThunks() {
  const calls = { cot: 0, treasury: 0, eia: 0, execution: 0, okxSpec: 0 };
  const thunks: SlowProviderThunks = {
    cot: async () => { calls.cot += 1; return { success: false }; },
    treasury: async () => { calls.treasury += 1; return { success: false }; },
    eia: async () => { calls.eia += 1; return { success: false }; },
    execution: async () => { calls.execution += 1; return { success: false }; },
    okxSpec: async () => { calls.okxSpec += 1; return { success: false }; },
  };
  return { calls, thunks };
}

describe("optional slow evidence coverage", () => {
  it.each(["scalping", "intraday", "swing"])(
    "requests Treasury and COT evidence for gold during %s without making provider failure fatal",
    async (tradingStyle) => {
      const { calls, thunks } = makeThunks();
      const facts: SlowProviderFacts = {
        instrumentType: "commodity",
        instrument: "XAU/USD",
        tradingStyle,
        hasCompleteSpec: false,
      };

      const result = await fetchOptionalSlowData(facts, thunks);

      expect(calls.cot).toBe(1);
      expect(calls.treasury).toBe(1);
      expect(calls.eia).toBe(0);
      expect(result.cotData).toBeUndefined();
      expect(result.treasuryData).toBeUndefined();
    },
  );

  it.each(["scalping", "intraday", "swing"])(
    "requests EIA inventory for oil during %s",
    async (tradingStyle) => {
      const { calls, thunks } = makeThunks();
      await fetchOptionalSlowData({
        instrumentType: "commodity",
        instrument: "WTI Crude Oil",
        tradingStyle,
        hasCompleteSpec: false,
      }, thunks);

      expect(calls.eia).toBe(1);
    },
  );

  it("does not request commodity-only macro providers for crypto", async () => {
    const { calls, thunks } = makeThunks();
    await fetchOptionalSlowData({
      instrumentType: "crypto",
      instrument: "BTC-USDT",
      tradingStyle: "scalping",
      hasCompleteSpec: true,
    }, thunks);

    expect(calls.cot).toBe(0);
    expect(calls.treasury).toBe(0);
    expect(calls.eia).toBe(0);
  });
});
