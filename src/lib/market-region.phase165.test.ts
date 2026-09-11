/**
 * Phase 165 — Region classification without a symbol whitelist.
 *
 * Defect fixed: the opportunities UI classified region with
 *
 *   ["BBCA","BBRI","TLKM","BMRI","BBNI","GOTO"].includes(instrument)
 *
 * and the Dashboard built radar sources with the same six names. That is a
 * permanent ceiling: any IDX equity outside those names was silently filed
 * as "us", so a newly discovered Indonesian listing could never appear under
 * the IDX filter regardless of discovery working correctly.
 */

import { describe, expect, it } from "vitest";
import { classifyRegion, matchesRegionFilter } from "./market-region";

describe("A — provider metadata is authoritative", () => {
  it("uses the provider-reported region", () => {
    expect(
      classifyRegion({ instrument: "ANYTHING", assetClass: "equity", region: "Indonesia" }),
    ).toBe("idx");
    expect(
      classifyRegion({ instrument: "AAPL", assetClass: "equity", region: "NASDAQ" }),
    ).toBe("us");
  });

  it("normalises provider spelling variants", () => {
    for (const reported of ["IDX", "Indonesia", "Jakarta", "idx"]) {
      expect(
        classifyRegion({ instrument: "X", assetClass: "equity", region: reported }),
      ).toBe("idx");
    }
    for (const reported of ["United States", "NYSE", "NASDAQ", "usa"]) {
      expect(
        classifyRegion({ instrument: "X", assetClass: "equity", region: reported }),
      ).toBe("us");
    }
  });

  it("preserves an unrecognised provider region instead of discarding it", () => {
    expect(
      classifyRegion({ instrument: "X", assetClass: "equity", region: "Bursa Malaysia" }),
    ).toBe("bursa malaysia");
  });
});

describe("B — no hardcoded instrument list", () => {
  it("classifies an IDX equity that is NOT one of the six legacy names", () => {
    // The exact case the old whitelist got wrong.
    expect(
      classifyRegion({ instrument: "ANTM.JK", assetClass: "equity" }),
    ).toBe("idx");
    expect(
      classifyRegion({ instrument: "UNVR.JK", assetClass: "equity" }),
    ).toBe("idx");
  });

  it("matches newly discovered IDX listings under the idx filter", () => {
    const newListing = { instrument: "XYZA.JK", assetClass: "equity" as const };
    expect(matchesRegionFilter(newListing, "idx")).toBe(true);
    expect(matchesRegionFilter(newListing, "us")).toBe(false);
  });

  it("supports venues beyond the original two regions", () => {
    expect(classifyRegion({ instrument: "BHP.AX", assetClass: "equity" })).toBe("asx");
    expect(classifyRegion({ instrument: "SHEL.L", assetClass: "equity" })).toBe("lse");
    expect(classifyRegion({ instrument: "7203.T", assetClass: "equity" })).toBe("tse");
  });

  it("does not classify a US-looking symbol as IDX by accident", () => {
    expect(classifyRegion({ instrument: "AAPL", assetClass: "equity", region: "United States" })).toBe("us");
  });
});

describe("C — unknown region is a real answer", () => {
  it("returns undefined when region cannot be established", () => {
    expect(classifyRegion({ instrument: "MYSTERY", assetClass: "equity" })).toBeUndefined();
  });

  it("excludes an unknown-region instrument from a specific filter", () => {
    const unknown = { instrument: "MYSTERY", assetClass: "equity" as const };
    expect(matchesRegionFilter(unknown, "idx")).toBe(false);
    expect(matchesRegionFilter(unknown, "us")).toBe(false);
  });

  it("still includes unknown-region instruments under 'all'", () => {
    expect(
      matchesRegionFilter({ instrument: "MYSTERY", assetClass: "equity" }, "all"),
    ).toBe(true);
  });
});

describe("D — non-regional asset classes", () => {
  it("treats crypto, forex, commodity, indices and macro as global", () => {
    for (const assetClass of ["crypto", "forex", "commodity", "indices", "macro"] as const) {
      expect(classifyRegion({ instrument: "ANY", assetClass })).toBe("global");
      expect(matchesRegionFilter({ instrument: "ANY", assetClass }, "global")).toBe(true);
    }
  });

  it("does not surface crypto under an equity venue filter", () => {
    expect(
      matchesRegionFilter({ instrument: "BTC-USDT", assetClass: "crypto" }, "idx"),
    ).toBe(false);
  });
});
