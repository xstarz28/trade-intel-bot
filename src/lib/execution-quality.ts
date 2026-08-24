/**
 * Phase 7E — Execution quality & market microstructure (pure module).
 *
 * Source (verified live): OKX public order book
 *   GET https://www.okx.com/api/v5/market/books?instId=…&sz=N
 *   → { code:"0", data:[{ asks:[[price,size,liqOrders,numOrders],…]  ascending,
 *                         bids:[…] descending, ts:<exchange ms>, seqId }] }
 *   No API key. For derivatives, `size` is in CONTRACTS (not base currency).
 *
 * NON-NEGOTIABLE:
 * - Bid/ask/depth come ONLY from actual book rows. Candle high/low/close are
 *   NEVER used as spread proxies; missing data → explicit unavailable.
 * - Freshness derives from the EXCHANGE timestamp (`ts`), never fetch time.
 * - Slippage is an ESTIMATE from walking real book levels with a REAL
 *   quantity from the risk engine. Sizing unavailable → slippage unavailable.
 *   It is never an "actual execution result".
 * - Spread + depth + imbalance + slippage are ONE evidence layer's internal
 *   breakdown — the engine must never score them as independent votes.
 *
 * All thresholds below are PLATFORM POLICY parameters, documented here —
 * not universal market laws and not historical baselines.
 *
 * No `@/` alias imports: this module is also consumed by Convex actions.
 */

// ── Types ──────────────────────────────────────────────────────────

export type ExecutionRegime =
  | "LIQUID"
  | "THIN"
  | "WIDE_SPREAD"
  | "IMBALANCED"
  | "STALE"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface BookLevel {
  price: number;
  /** Contracts for derivatives (as returned by OKX), labeled explicitly. */
  size: number;
}

export interface ExecutionQuality {
  available: true;
  provider: "OKX public order book";
  instrumentId: string;
  /** EXCHANGE timestamp of the snapshot (ms) — basis of freshness. */
  snapshotTs: number;
  fetchedAt: number;
  freshness: "FRESH" | "STALE";
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadBps: number;
  bidDepth: number; // contracts within top EXECUTION_DEPTH_LEVELS per side
  askDepth: number;
  imbalance: number; // (bidDepth − askDepth) / (bidDepth + askDepth), [-1..1]
  regime: ExecutionRegime;
  /** ACTUAL top levels used for depth/slippage (contracts), best first. */
  book: { bids: BookLevel[]; asks: BookLevel[] };
}

export interface ExecutionUnavailable {
  available: false;
  reason: string;
}

export type ExecutionData = ExecutionQuality | ExecutionUnavailable;

/** Result of walking REAL book levels with a REAL risk-engine quantity. */
export interface SlippageEstimate {
  estimatedSlippage?: number; // adverse price distance from mid
  slippageBps?: number;
  quantityUsed?: number; // base-currency units fed in by the risk engine
  contractsUsed?: number;
  depthUsed?: number; // contracts actually walkable on the relevant side
  confidence: "LOW"; // it is ALWAYS an estimate, never an executed result
  unavailableReason?: string;
}

// ── Documented policy parameters ───────────────────────────────────

/** Snapshot older than this (vs analysis time) is STALE for all styles. */
export const EXECUTION_STALE_MS = 30_000;
/** Spread (bps of mid) above which the book is WIDE by absolute policy. */
export const EXECUTION_WIDE_SPREAD_BPS = 10;
/** Extreme spread policy threshold (scalping NO_TRADE candidate). */
export const EXECUTION_EXTREME_SPREAD_BPS = 25;
/** |imbalance| at which the book is flagged IMBALANCED. */
export const EXECUTION_IMBALANCE_THRESHOLD = 0.7;
/** Book levels walked per side when computing depth/slippage. */
export const EXECUTION_DEPTH_LEVELS = 50;

// ── Response parsing (defensive) ───────────────────────────────────

export interface ParsedOrderBook {
  ok: true;
  instrumentId: string;
  snapshotTs: number;
  bids: BookLevel[]; // best (highest) first
  asks: BookLevel[]; // best (lowest) first
}

export interface ParsedOrderBookError {
  ok: false;
  reason: string;
}

function parseSide(rows: unknown): BookLevel[] {
  if (!Array.isArray(rows)) return [];
  const out: BookLevel[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const price = parseFloat(String(row[0]));
    const size = parseFloat(String(row[1]));
    if (!Number.isFinite(price) || price <= 0) continue; // invalid price → skip row
    if (!Number.isFinite(size) || size < 0) continue; // negative size → skip row
    out.push({ price, size });
  }
  return out;
}

/**
 * Parses ONE OKX books response defensively: API error envelopes, malformed
 * JSON shapes, empty/crossed books, zero-size rows and non-numeric values all
 * produce explicit failure reasons — never fabricated levels.
 */
export function parseOkxOrderBook(json: unknown): ParsedOrderBook | ParsedOrderBookError {
  if (json === null || typeof json !== "object") {
    return { ok: false, reason: "malformed response: not an object" };
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.code === "string" && obj.code !== "0") {
    return { ok: false, reason: `provider error code ${obj.code}` };
  }
  const data = Array.isArray(obj.data) ? obj.data : undefined;
  if (!data || data.length === 0) {
    return { ok: false, reason: "empty dataset for this query" };
  }
  const entry = data[0];
  if (entry === null || typeof entry !== "object") {
    return { ok: false, reason: "unexpected schema: data[0] is not an object" };
  }
  const e = entry as Record<string, unknown>;

  const ts = typeof e.ts === "string" ? parseInt(e.ts, 10) : typeof e.ts === "number" ? e.ts : NaN;
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: "missing/invalid exchange timestamp (ts)" };
  }
  const bids = parseSide(e.bids);
  const asks = parseSide(e.asks);
  if (bids.length === 0 || asks.length === 0) {
    return { ok: false, reason: "no valid price levels on one side of the book" };
  }
  const instId = typeof e.instId === "string" ? e.instId : "";
  return { ok: true, instrumentId: instId, snapshotTs: ts, bids, asks };
}

// ── Regime classification (deterministic, documented policy) ───────

/**
 * Deterministic regime from ACTUAL book metrics. Evaluation order matters:
 * THIN (book integrity) → WIDE_SPREAD → IMBALANCED → LIQUID. Without a
 * historical baseline we NEVER claim "unusually wide" — only wide versus
 * the documented absolute policy thresholds above.
 */
export function classifyExecutionRegime(m: {
  spreadBps: number;
  imbalance: number;
  bidDepth: number;
  askDepth: number;
}): Exclude<ExecutionRegime, "UNAVAILABLE" | "STALE"> {
  if (m.bidDepth <= 0 || m.askDepth <= 0) return "THIN";
  if (m.spreadBps >= EXECUTION_EXTREME_SPREAD_BPS) return "WIDE_SPREAD";
  if (m.spreadBps > EXECUTION_WIDE_SPREAD_BPS) return "WIDE_SPREAD";
  if (Math.abs(m.imbalance) >= EXECUTION_IMBALANCE_THRESHOLD) return "IMBALANCED";
  return "LIQUID";
}

// ── Context builder ────────────────────────────────────────────────

/**
 * Builds execution quality from parsed REAL book rows. Depth is summed over
 * the top EXECUTION_DEPTH_LEVELS per side (in CONTRACTS as returned by the
 * exchange). Freshness compares the EXCHANGE timestamp against analysis time.
 */
export function buildExecutionQuality(
  parsed: ParsedOrderBook,
  fetchedAt: number,
  nowMs: number,
): ExecutionQuality {
  const topBids = parsed.bids.slice(0, EXECUTION_DEPTH_LEVELS);
  const topAsks = parsed.asks.slice(0, EXECUTION_DEPTH_LEVELS);

  const bid = parsed.bids[0].price;
  const ask = parsed.asks[0].price;
  // A crossed book (bid ≥ ask) is structurally impossible on a live venue —
  // treat it as bad data rather than a negative spread.
  if (bid >= ask) throw new Error("crossed book: bid >= ask");

  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const spreadBps = (spread / mid) * 10_000;
  const sumSize = (levels: BookLevel[]) => levels.reduce((s, l) => s + l.size, 0);
  const bidDepth = sumSize(topBids);
  const askDepth = sumSize(topAsks);
  const totalDepth = bidDepth + askDepth;
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

  const ageMs = nowMs - parsed.snapshotTs;
  const freshness: "FRESH" | "STALE" = ageMs <= EXECUTION_STALE_MS ? "FRESH" : "STALE";

  const regime: ExecutionRegime =
    freshness === "STALE"
      ? "STALE"
      : classifyExecutionRegime({ spreadBps, imbalance, bidDepth, askDepth });

  return {
    available: true,
    provider: "OKX public order book",
    instrumentId: parsed.instrumentId,
    snapshotTs: parsed.snapshotTs,
    fetchedAt,
    freshness,
    bid,
    ask,
    mid,
    spread,
    spreadBps,
    bidDepth,
    askDepth,
    imbalance,
    regime,
    book: { bids: topBids, asks: topAsks },
  };
}

/**
 * End-to-end pure pipeline used by BOTH the Convex action and the engine:
 * any parse failure or bad book (crossed/empty/stale-ts) becomes an explicit
 * unavailable state — never a thrown error across the boundary and never a
 * fabricated value.
 */
export function buildExecutionData(
  parsed: ParsedOrderBook | ParsedOrderBookError,
  fetchedAt: number,
  nowMs: number,
): ExecutionData {
  if (!parsed.ok) return { available: false, reason: parsed.reason };
  try {
    return buildExecutionQuality(parsed, fetchedAt, nowMs);
  } catch (e) {
    return { available: false, reason: String(e).slice(0, 140) };
  }
}

// ── Slippage estimation (REAL quantity only) ───────────────────────

/**
 * Estimates market impact of filling the RISK ENGINE's calculated quantity
 * by walking the real book on the relevant side (long buys into asks; short
 * sells into bids). Quantity is ALWAYS supplied by the caller from actual
 * position sizing — there is deliberately no default. If contract size is
 * unavailable the base-quantity→contracts mapping cannot be done honestly,
 * so the estimate is unavailable with an explicit reason.
 */
export function estimateSlippage(
  parsed: ParsedOrderBook,
  side: "long" | "short",
  opts: { quantityBase?: number; contractSize?: number },
): SlippageEstimate {
  const base: SlippageEstimate = { confidence: "LOW" as const };

  if (opts.quantityBase === undefined || !Number.isFinite(opts.quantityBase) || opts.quantityBase <= 0) {
    return { ...base, unavailableReason: "position size unavailable — no synthetic quantity is assumed" };
  }
  if (opts.contractSize === undefined || !Number.isFinite(opts.contractSize) || opts.contractSize <= 0) {
    return {
      ...base,
      quantityUsed: opts.quantityBase,
      unavailableReason:
        "contract size unavailable — base-quantity-to-contracts mapping cannot be made without assuming one",
    };
  }

  const contractsNeeded = opts.quantityBase / opts.contractSize;
  const levels = side === "long" ? parsed.asks : parsed.bids;
  const mid = (parsed.bids[0].price + parsed.asks[0].price) / 2;

  let remaining = contractsNeeded;
  let notionalPriceSum = 0;
  let filled = 0;
  for (const level of levels.slice(0, EXECUTION_DEPTH_LEVELS)) {
    const take = Math.min(remaining, level.size);
    if (take <= 0) continue;
    notionalPriceSum += take * level.price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  const depthAvailable = levels.reduce((s, l) => s + l.size, 0);
  if (remaining > 0) {
    return {
      ...base,
      quantityUsed: opts.quantityBase,
      contractsUsed: contractsNeeded,
      depthUsed: depthAvailable,
      unavailableReason: `insufficient visible depth: need ${contractsNeeded.toFixed(4)} contracts, top levels offer ${depthAvailable.toFixed(4)} on the ${side} side`,
    };
  }

  const avgFillPrice = notionalPriceSum / filled;
  const adverse = side === "long" ? avgFillPrice - mid : mid - avgFillPrice;
  return {
    estimatedSlippage: adverse,
    slippageBps: (adverse / mid) * 10_000,
    quantityUsed: opts.quantityBase,
    contractsUsed: contractsNeeded,
    depthUsed: depthAvailable,
    confidence: "LOW",
  };
}
