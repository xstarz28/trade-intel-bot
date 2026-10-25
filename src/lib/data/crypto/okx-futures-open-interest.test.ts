import { describe, expect, it } from "vitest";
import { parseOkxFuturesOpenInterest } from "./okx-futures-open-interest";

const NOW = 1_800_000_000_000;
const INST = "0G-USD_UM_XPERP-310905";

function response(overrides: Record<string, unknown> = {}) {
  return {
    code: "0",
    data: [{
      instType: "FUTURES",
      instId: INST,
      oiUsd: "1250000.5",
      ts: String(NOW - 30_000),
      ...overrides,
    }],
  };
}

describe("parseOkxFuturesOpenInterest", () => {
  it("returns USD-notional OI only for the exact dated contract and preserves exchange timestamp", () => {
    const parsed = parseOkxFuturesOpenInterest(response(), INST, NOW);
    expect(parsed?.symbol).toBe(INST);
    expect(parsed?.openInterest?.current).toBe(1_250_000.5);
    expect(parsed?.timestamp).toBe(NOW - 30_000);
    expect(parsed?.freshness).toBe("realtime");
    expect(parsed?.availability).toEqual({
      openInterest: true,
      fundingRate: false,
      longShort: false,
      liquidations: false,
    });
  });

  it("rejects a different contract instead of borrowing same-base OI", () => {
    expect(parseOkxFuturesOpenInterest(response({ instId: "0G-USDT-SWAP" }), INST, NOW)).toBeUndefined();
  });

  it("rejects swap data and responses without verified USD notional", () => {
    expect(parseOkxFuturesOpenInterest(response({ instType: "SWAP" }), INST, NOW)).toBeUndefined();
    expect(parseOkxFuturesOpenInterest(response({ oiUsd: "" }), INST, NOW)).toBeUndefined();
  });

  it("rejects missing, future-dated, and over-24-hour timestamps", () => {
    expect(parseOkxFuturesOpenInterest(response({ ts: undefined }), INST, NOW)).toBeUndefined();
    expect(parseOkxFuturesOpenInterest(response({ ts: String(NOW + 1) }), INST, NOW)).toBeUndefined();
    expect(parseOkxFuturesOpenInterest(response({ ts: String(NOW - 24 * 60 * 60 * 1000) }), INST, NOW)).toBeUndefined();
  });
});
