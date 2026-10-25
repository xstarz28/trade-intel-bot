import { describe, expect, it } from "vitest";
import {
  cryptoMarketType,
  prioritizeCryptoDiscovery,
  type DiscoveredCryptoInstrument,
} from "./crypto-discovery-priority";

describe("crypto discovery prioritization", () => {
  it("keeps USD-margined OKX dated futures in the discoverable universe", () => {
    const future = { instId: "0G-USD_UM_XPERP-310905", instType: "FUTURES" };
    expect(cryptoMarketType(future.instId, future.instType)).toBe("futures");
    expect(prioritizeCryptoDiscovery([future])).toContainEqual(future);
  });

  it("balances spot, perpetual, and dated-futures contracts in the same discovery batch", () => {
    const instruments: DiscoveredCryptoInstrument[] = [
      { instId: "BTC-USDT", instType: "SPOT" },
      { instId: "BTC-USDT-SWAP", instType: "SWAP" },
      { instId: "0G-USD_UM_XPERP-310905", instType: "FUTURES" },
    ];
    const ranked = prioritizeCryptoDiscovery(instruments);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => cryptoMarketType(item.instId, item.instType))).toEqual([
      "spot",
      "perpetual",
      "futures",
    ]);
  });

  it("continues excluding leveraged-token noise", () => {
    const instruments: DiscoveredCryptoInstrument[] = [
      { instId: "BTC-USDT-SWAP", instType: "SWAP" },
      { instId: "1000SHIB-USDT-SWAP", instType: "SWAP" },
      { instId: "BTC-3L-USDT", instType: "SPOT" },
    ];
    expect(prioritizeCryptoDiscovery(instruments).map((item) => item.instId)).toEqual([
      "BTC-USDT-SWAP",
    ]);
  });
});
