/**
 * Phase 7E — execution-quality pure module tests.
 * Fixtures mirror the LIVE-verified OKX books response
 * (asks ascending, bids descending, rows [price,size,…], ts in ms).
 */
import { describe, it, expect } from "vitest";
import {
  parseOkxOrderBook,
  buildExecutionData,
  buildExecutionQuality,
  classifyExecutionRegime,
  estimateSlippage,
} from "./execution-quality";

const NOW = 1_787_545_400_000;

/** Live-verified response shape; values are strings in rows. */
function booksResponse(opts?: {
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  ts?: string;
  extraBidLevels?: [number, number][];
  extraAskLevels?: [number, number][];
}) {
  const o = opts ?? {};
  const bid = o.bid ?? 100;
  const ask = o.ask ?? 100.2;
  const bids: unknown[][] = [[String(bid), String(o.bidSize ?? 50), "0", "1"]];
  const asks: unknown[][] = [[String(ask), String(o.askSize ?? 30), "0", "1"]];
  for (const [p, s] of o.extraBidLevels ?? []) bids.push([String(p), String(s), "0", "1"]);
  for (const [p, s] of o.extraAskLevels ?? []) asks.push([String(p), String(s), "0", "1"]);
  return {
    code: "0",
    msg: "",
    data: [{ asks, bids, ts: o.ts ?? String(NOW - 1000), instId: "BTC-USDT-SWAP", seqId: 1 }],
  };
}

describe("parseOkxOrderBook", () => {
  it("parses a valid live-verified book (string values → numbers)", () => {
    const p = parseOkxOrderBook(booksResponse());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.bids[0]).toEqual({ price: 100, size: 50 });
    expect(p.asks[0]).toEqual({ price: 100.2, size: 30 });
    expect(p.snapshotTs).toBe(NOW - 1000);
    expect(p.instrumentId).toBe("BTC-USDT-SWAP");
  });

  it("rejects API error envelopes with explicit reason", () => {
    const p = parseOkxOrderBook({ code: "51001", msg: "Instrument ID does not exist" });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("51001");
  });

  it("rejects malformed payloads and unexpected schemas", () => {
    for (const bad of [null, undefined, "oops", { foo: 1 }, { code: "0" }, { code: "0", data: [] }]) {
      expect(parseOkxOrderBook(bad).ok).toBe(false);
    }
  });

  it("requires a real exchange timestamp — missing ts fails closed", () => {
    const res = booksResponse();
    delete (res.data[0] as Record<string, unknown>).ts;
    const p = parseOkxOrderBook(res);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("timestamp");
  });

  it("skips invalid prices and negative sizes instead of coercing them", () => {
    const res = booksResponse({
      extraBidLevels: [
        [-5, 10],
        [99, -3],
      ],
      extraAskLevels: [[0, 7]],
    });
    const p = parseOkxOrderBook(res);
    if (!p.ok) throw new Error("expected ok");
    expect(p.bids).toHaveLength(1); // only the valid top row survives
    expect(p.asks).toHaveLength(1);
  });

  it("a side with no valid levels fails explicitly", () => {
    const res = booksResponse({ extraAskLevels: [] });
    (res.data[0] as Record<string, unknown>).asks = [];
    const p = parseOkxOrderBook(res);
    expect(p.ok).toBe(false);
  });
});

describe("buildExecutionQuality / buildExecutionData", () => {
  it("computes spread, spreadBps, depth and imbalance from REAL rows only", () => {
    const q = buildExecutionQuality(
      parseOkxOrderBook(booksResponse({ ask: 100.02, bidSize: 85, askSize: 15 })) as never,
      NOW,
      NOW,
    );
    expect(q.available).toBe(true);
    expect(q.bid).toBe(100);
    expect(q.ask).toBe(100.02);
    expect(q.mid).toBeCloseTo(100.01, 6);
    expect(q.spread).toBeCloseTo(0.02, 6);
    expect(q.spreadBps).toBeCloseTo((0.02 / 100.01) * 10_000, 4); // ≈2 bps — healthy
    expect(q.bidDepth).toBe(85);
    expect(q.askDepth).toBe(15);
    expect(q.imbalance).toBeCloseTo((85 - 15) / 100, 6); // exactly policy threshold 0.7
    expect(q.regime).toBe("IMBALANCED");
  });

  it("a ~20 bps top-of-book is WIDE_SPREAD by absolute policy (no baseline needed)", () => {
    const q = buildExecutionQuality(parseOkxOrderBook(booksResponse()) as never, NOW, NOW);
    expect(q.spreadBps).toBeGreaterThan(10);
    expect(q.regime).toBe("WIDE_SPREAD");
  });

  it("freshness derives from the EXCHANGE timestamp, not fetch time", () => {
    const fresh = buildExecutionQuality(
      parseOkxOrderBook(booksResponse({ ts: String(NOW - 5000) })) as never,
      NOW + 60_000,
      NOW,
    );
    expect(fresh.freshness).toBe("FRESH");
    const stale = buildExecutionQuality(
      parseOkxOrderBook(booksResponse({ ts: String(NOW - 61_000) })) as never,
      NOW,
      NOW,
    );
    expect(stale.freshness).toBe("STALE");
    expect(stale.regime).toBe("STALE");
  });

  it("crossed book becomes an explicit unavailable state, not a negative spread", () => {
    const d = buildExecutionData(
      parseOkxOrderBook(booksResponse({ bid: 101, ask: 100 })) as never,
      NOW,
      NOW,
    );
    expect(d.available).toBe(false);
  });

  it("parse failures flow through as unavailable with the same reason", () => {
    const d = buildExecutionData({ ok: false, reason: "provider error code 51001" }, NOW, NOW);
    expect(d.available).toBe(false);
    if (!d.available) expect(d.reason).toContain("51001");
  });
});

describe("classifyExecutionRegime (documented policy thresholds)", () => {
  it("THIN when one side has no visible size", () => {
    expect(classifyExecutionRegime({ spreadBps: 1, imbalance: 0, bidDepth: 0, askDepth: 10 })).toBe("THIN");
  });
  it("WIDE_SPREAD beyond absolute policy bps", () => {
    expect(classifyExecutionRegime({ spreadBps: 12, imbalance: 0, bidDepth: 10, askDepth: 10 })).toBe("WIDE_SPREAD");
    expect(classifyExecutionRegime({ spreadBps: 60, imbalance: 0, bidDepth: 10, askDepth: 10 })).toBe("WIDE_SPREAD");
  });
  it("IMBALANCED at |imbalance| ≥ policy threshold", () => {
    expect(classifyExecutionRegime({ spreadBps: 2, imbalance: 0.8, bidDepth: 90, askDepth: 10 })).toBe("IMBALANCED");
  });
  it("LIQUID when all metrics are healthy", () => {
    expect(classifyExecutionRegime({ spreadBps: 1, imbalance: 0.2, bidDepth: 45, askDepth: 55 })).toBe("LIQUID");
  });
});

describe("estimateSlippage (REAL quantity only)", () => {
  // Book: mid 100.1; asks 100.2×30, 100.5×50 ; bids 100×50, 99.7×40
  const parsed = () =>
    parseOkxOrderBook(
      booksResponse({
        extraAskLevels: [[100.5, 50]],
        extraBidLevels: [[99.7, 40]],
      }),
    ) as never;

  it("walks the real book for a LONG fill of a real quantity", () => {
    // 0.5 BTC base ÷ ctVal 0.01 = 50 contracts → 30 @100.2 + 20 @100.5
    const est = estimateSlippage(parsed(), "long", { quantityBase: 0.5, contractSize: 0.01 });
    expect(est.quantityUsed).toBe(0.5);
    expect(est.contractsUsed).toBeCloseTo(50, 6);
    const expectedAvg = (30 * 100.2 + 20 * 100.5) / 50;
    expect(est.estimatedSlippage).toBeCloseTo(expectedAvg - 100.1, 6);
    expect(est.slippageBps).toBeGreaterThan(0);
    expect(est.confidence).toBe("LOW");
  });

  it("SHORT walks the BID side adversely", () => {
    const est = estimateSlippage(parsed(), "short", { quantityBase: 0.3, contractSize: 0.01 });
    // 30 contracts fully filled at best bid 100
    expect(est.estimatedSlippage).toBeCloseTo(100.1 - 100, 6);
    expect(est.slippageBps).toBeGreaterThan(0); // adverse by definition
  });

  it("insufficient depth → unavailable WITH disclosed depth used", () => {
    const est = estimateSlippage(parsed(), "long", { quantityBase: 10_000, contractSize: 0.01 });
    expect(est.estimatedSlippage).toBeUndefined();
    expect(est.unavailableReason).toContain("insufficient visible depth");
    expect(est.depthUsed).toBe(80); // 30+50 contracts actually offered
  });

  it("sizing unavailable → NO fake slippage, explicit reason", () => {
    const est = estimateSlippage(parsed(), "long", {});
    expect(est.estimatedSlippage).toBeUndefined();
    expect(est.unavailableReason).toContain("position size unavailable");
  });

  it("contract-size unavailable → mapping refused honestly, quantity still disclosed", () => {
    const est = estimateSlippage(parsed(), "long", { quantityBase: 5 });
    expect(est.estimatedSlippage).toBeUndefined();
    expect(est.quantityUsed).toBe(5);
    expect(est.unavailableReason).toContain("contract size unavailable");
  });
});
