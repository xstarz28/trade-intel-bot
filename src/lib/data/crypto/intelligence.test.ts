import { describe, expect, it } from "vitest";
import { buildCryptoIntelligenceContext } from "./intelligence";

describe("crypto intelligence unlock availability summary", () => {
  it("labels a missing unlock schedule as unverified instead of zero events", () => {
    const context = buildCryptoIntelligenceContext("BTC/USD", undefined, undefined, {
      provider: "CoinGecko public API",
      observedAt: Date.parse("2026-10-15T07:00:00.000Z"),
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      supply: { circulatingSupply: 19_800_000, maxSupply: 21_000_000, reliable: true },
      availableDatasets: 1,
      totalDatasets: 2,
    });

    expect(context?.analystSummary).toContain("Tokenomics: unlock schedule unverified");
    expect(context?.analystSummary).not.toContain("0 upcoming unlocks");
    expect(context?.missingInformation).toContain("Reliable token unlock data");
  });

  it("reports a zero count only when the unlock source explicitly marks it reliable", () => {
    const context = buildCryptoIntelligenceContext("BTC/USD", undefined, undefined, {
      provider: "PatternPlus",
      observedAt: Date.parse("2026-10-15T07:00:00.000Z"),
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      supply: { circulatingSupply: 19_800_000, maxSupply: 21_000_000, reliable: true },
      unlocks: { upcomingCount30d: 0, reliable: true, summary: "No unlocks reported in the verified window" },
      availableDatasets: 2,
      totalDatasets: 2,
    });

    expect(context?.analystSummary).toContain("Tokenomics: 0 upcoming unlocks");
    expect(context?.missingInformation).not.toContain("Reliable token unlock data");
  });
});
