/**
 * Phase 289E — the smoke's discovery → candidate path, after the memory fix.
 *
 * The runtime smoke must keep choosing its subjects from the deployment's OWN
 * discovery result: no instrument is named in the harness, the provider's order
 * is preserved, and the energy-gate probe's bound stays a parameter (`probeLimit`)
 * rather than a way of narrowing discovery itself. These assertions exist because
 * the Phase-289E fix touched the discovery contract — and the temptation to make
 * the smoke pass by pinning a symbol is exactly what must remain impossible.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { discoveryDigest, selectCandidates } from "../../../scripts/development-runtime-smoke.mjs";

const SCRIPT = "scripts/development-runtime-smoke.mjs";

type Candidate = { providerInstrumentId?: string; instId?: string; subType?: string };

const commoditySpec = { domain: "commodity", label: "Commodity", discovery: "twelve-data" as const, assetClass: "commodity" };

describe("289E — smoke candidates stay provider-native", () => {
  it("selects the provider's own rows, in the provider's own order", () => {
    const discovery = {
      success: true,
      instruments: [
        { providerInstrumentId: "GAU/EUR", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "HG1", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
        { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "TRADING" },
      ],
    };
    const picked = selectCandidates(commoditySpec, discovery, 3) as Candidate[];
    expect(picked.map((c) => c.providerInstrumentId)).toEqual(["GAU/EUR", "HG1", "WTI/USD"]);
    expect(picked.every((c) => c.subType === "commodity_spot")).toBe(true);
  });

  it("takes no candidate from a failed discovery and invents none", () => {
    expect(selectCandidates(commoditySpec, { success: false, instruments: [] }, 3)).toEqual([]);
    expect(selectCandidates(commoditySpec, null, 3)).toEqual([]);
  });

  it("still respects an explicit bound without becoming a filter on discovery", () => {
    const discovery = {
      success: true,
      instruments: Array.from({ length: 8 }, (_, i) => ({
        providerInstrumentId: `P${i}/USD`,
        assetClass: "commodity",
        subType: "commodity_spot",
        tradingState: "TRADING",
      })),
    };
    // The domain loop's own ceiling still clamps (unchanged policy)...
    expect((selectCandidates(commoditySpec, discovery, 8) as Candidate[]).length).toBe(3);
    // ...while a caller with its own disclosed bound (the energy probe) may go
    // deeper without discovery itself being narrowed.
    expect((selectCandidates(commoditySpec, discovery, 6, 6) as Candidate[]).length).toBe(6);
    expect((selectCandidates(commoditySpec, discovery, 1, 1) as Candidate[]).length).toBe(1);
  });

  it("names no instrument in the harness code, and keeps the probe bound a parameter", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .join("\n");
    for (const literal of ["WTI/USD", "XAU/USD", "GAU/EUR", "AAPL", "EUR/USD", "BTC/USD", "URALS/USD"]) {
      expect(code, `${literal} must not be hardcoded in the smoke`).not.toContain(`"${literal}"`);
    }
    // The probe scans the discovery-ranked commodity list, bounded by probeLimit.
    expect(source).toContain("candidateLimit: probeLimit");
    expect(source).toContain("probeEnergyGate({");
  });
});

describe("289E — the run states what the catalog walk returned", () => {
  const discovery = {
    success: true,
    completeness: "PARTIAL",
    pagesFetched: 5,
    totalDiscovered: 8,
    instruments: Array.from({ length: 9 }, (_, i) => ({ providerInstrumentId: `P${i}/USD` })),
    catalogs: [
      { path: "/forex_pairs", assetClass: "forex", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 2, failedPage: null },
      { path: "/stocks", assetClass: "equity", completeness: "FAILED", pagesFetched: 0, totalDiscovered: 0, failedPage: null },
      { path: "/commodities", assetClass: "commodity", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 3, failedPage: null },
    ],
    warnings: ["/stocks discovery failed: out of memory."],
    error: null,
  };

  it("reports the verdict, the totals and every catalog, naming the failed one", () => {
    const digest = discoveryDigest(discovery) as string;
    expect(digest).toContain("success=true");
    expect(digest).toContain("completeness=PARTIAL");
    expect(digest).toContain("pages=5");
    expect(digest).toContain("total=8");
    expect(digest).toContain("/stocks/FAILED/0p/0kept");
    expect(digest).toContain("/commodities/COMPLETE/1p/3kept");
    expect(digest).toContain("out of memory");
    expect(digest).toContain("identities=P0/USD,P1/USD");
  });

  it("bounds the identity sample and reports a missing catalog report honestly", () => {
    const digest = discoveryDigest({ ...discovery, catalogs: [] }) as string;
    expect(digest).toContain("no per-catalog report");
    const identities = (digest.match(/P\d+\/USD/g) ?? []).length;
    expect(identities).toBeLessThanOrEqual(6);
  });

  it("reports an unavailable discovery without inventing a catalog", () => {
    const digest = discoveryDigest({
      ...discovery,
      success: false,
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      instruments: [],
      catalogs: [],
      warnings: [],
      error: "Required credentials not configured: TWELVE_DATA_API_KEY.",
    }) as string;
    expect(digest).toContain("success=false");
    expect(digest).toContain("Required credentials not configured");
    expect(discoveryDigest(null)).toBeNull();
  });

  it("is credential-redacted and bounded", () => {
    const digest = discoveryDigest({
      ...discovery,
      warnings: ["failed: apikey=SUPERSECRET1234567890ABCDEFGHIJKLMNOPQRSTUVWX"],
    }) as string;
    expect(digest).not.toContain("SUPERSECRET1234567890ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(digest.length).toBeLessThanOrEqual(900);
  });
});
