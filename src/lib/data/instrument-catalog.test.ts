import { describe, expect, it } from "vitest";
import { dedupeInstrumentCatalog } from "./instrument-catalog";

describe("instrument catalog de-duplication", () => {
  it("removes repeated provider rows while preserving original order", () => {
    const rows = [
      { symbol: "BTC/USD", type: "crypto", label: "Bitcoin spot" },
      { symbol: "BTC/USD", type: "crypto", label: "Bitcoin spot duplicate" },
      { symbol: "ETH/USD", type: "crypto", label: "Ethereum spot" },
    ];

    expect(dedupeInstrumentCatalog(rows)).toEqual([rows[0], rows[2]]);
  });

  it("keeps distinct contract types even when the display symbol matches", () => {
    const spot = { symbol: "BTC", type: "crypto", marketType: "spot", label: "BTC spot" };
    const perpetual = { symbol: "BTC", type: "crypto", marketType: "perpetual", label: "BTC perpetual" };

    expect(dedupeInstrumentCatalog([spot, perpetual])).toEqual([spot, perpetual]);
  });

  it("infers OKX swaps and dated futures when marketType is absent", () => {
    const rows = [
      { symbol: "BTC-USDT-SWAP", type: "crypto", label: "BTC swap" },
      { symbol: "BTC-USDT-SWAP", type: "crypto", label: "Duplicate BTC swap" },
      { symbol: "BTC-USD-261030", type: "crypto", label: "BTC dated future" },
    ];

    expect(dedupeInstrumentCatalog(rows)).toEqual([rows[0], rows[2]]);
  });

  it("does not collapse the same text symbol across different asset classes", () => {
    const forex = { symbol: "ABC/USD", type: "forex", label: "Forex ABC" };
    const crypto = { symbol: "ABC/USD", type: "crypto", label: "Crypto ABC" };

    expect(dedupeInstrumentCatalog([forex, crypto])).toEqual([forex, crypto]);
  });

  it("drops blank symbols rather than making an unusable selection", () => {
    expect(dedupeInstrumentCatalog([
      { symbol: "  ", type: "crypto", label: "Blank" },
      { symbol: "ETH/USD", type: "crypto", label: "Ethereum" },
    ])).toEqual([{ symbol: "ETH/USD", type: "crypto", label: "Ethereum" }]);
  });
});
