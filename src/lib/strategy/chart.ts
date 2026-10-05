/**
 * Phase 312 addendum — the SIGNAL CHART SPEC: a pure, serializable visualization
 * of the analytical evidence, reproducible from the SAME OHLCV snapshot the
 * engine read. No image generation, no screenshots, no synthetic candles:
 * every candle is copied verbatim from the input, and every overlay comes from
 * an object the engine actually detected (zone / order block / FVG / resting
 * liquidity / plan levels / confirmation formation). Missing evidence is never
 * drawn; insufficient OHLCV yields an explicit unavailable chart state.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { OhlcvCandle } from "../data/market-types";

export const CHART_MIN_CANDLES = 5; // engine-defined: fewer candles cannot form an honest scale
export const CHART_MAX_CANDLES = 120; // engine-defined render window over the FULL snapshot

export type ChartOverlayKind =
  | "zone"
  | "order_block"
  | "fvg"
  | "liquidity"
  | "entry"
  | "stop"
  | "invalidation"
  | "tp1"
  | "tp2"
  | "structure"
  | "confirmation";

export interface ChartOverlay {
  kind: ChartOverlayKind;
  label: string;
  /** One price = line; two prices = band (price = nearer edge). */
  price: number;
  price2?: number;
  /** Verbatim candle-timestamp extent; undefined spans the visible window. */
  fromTime?: number;
  toTime?: number;
  /** Confirmation markers: the exact candle timestamp of the formation. */
  markerTime?: number;
  tone: "demand" | "supply" | "bull" | "bear" | "neutral";
  provenance: { source: string; knownAt?: number };
}

export interface SignalChartSpec {
  available: boolean;
  unavailableReason?: string;
  meta?: {
    instrument: string;
    provider?: string;
    providerInstrumentId?: string;
    timeframe: string;
    /** Verbatim last-candle timestamp of the snapshot. */
    observedAt: number;
    candlesRendered: number;
    /** FULL snapshot provenance (the window is cut only for rendering). */
    provenance: {
      candleCountFull: number;
      windowFirstTimestamp: number;
      windowLastTimestamp: number;
      /** FNV-1a hash over the canonical JSON of the FULL candle snapshot. */
      inputHash: string;
    };
  };
  candles?: OhlcvCandle[];
  overlays?: ChartOverlay[];
  /**
   * The visual narrative — STRUCTURE → LOCATION → CONFIRMATION → ENTRY → SL →
   * TARGET — each chapter filled only from real evidence, otherwise stated as
   * not found.
   */
  story?: string[];
}

/** Deterministic FNV-1a (32-bit) over a string → hex. */
export function chartInputHash(candles: OhlcvCandle[]): string {
  const canonical = JSON.stringify(
    candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume ?? null]),
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseLevel(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function buildSignalChart(
  result: AnalysisResult,
  candles: OhlcvCandle[],
  plan?: { entry?: number; stop?: number; stopBasis?: string; tp1?: number; tp2?: number; tp1Basis?: string; tp2Basis?: string },
): SignalChartSpec {
  if (!candles || candles.length < CHART_MIN_CANDLES) {
    return {
      available: false,
      unavailableReason: `Chart unavailable — insufficient OHLCV (${candles?.length ?? 0} candles received; the engine never draws synthetic candles)`,
    };
  }
  // Phase 314 — provenance guard: when the result carries the strategy
  // context's candle provenance, the chart refuses to render a DIFFERENT
  // candle series (explicit unavailable, never a silently mismatched chart).
  const contextProvenance = result.technicalData?.strategy?.provenance;
  if (contextProvenance) {
    const actualFirst = candles[0]?.timestamp;
    const actualLast = candles[candles.length - 1]?.timestamp;
    const mismatched =
      contextProvenance.candleCount !== candles.length ||
      contextProvenance.firstTimestamp !== actualFirst ||
      contextProvenance.lastTimestamp !== actualLast;
    if (mismatched) {
      return {
        available: false,
        unavailableReason: `Chart unavailable — candle provenance mismatch: the analysis context was built from ${contextProvenance.candleCount} candles (${contextProvenance.firstTimestamp}…${contextProvenance.lastTimestamp}) but ${candles.length} candles (${String(actualFirst)}…${String(actualLast)}) were supplied for rendering; no chart is drawn from mismatched evidence`,
      };
    }
  }
  const td = result.technicalData;
  const overlays: ChartOverlay[] = [];
  const lastTime = candles[candles.length - 1].timestamp;
  const firstTime = candles[0].timestamp;
  const span = { fromTime: firstTime, toTime: lastTime };

  // Zones actually detected on this snapshot (broken zones are not drawn).
  for (const z of td?.strategy?.zones ?? []) {
    if (!finite(z.proximal) || !finite(z.distal) || z.lifecycle === "broken") continue;
    overlays.push({
      kind: "zone",
      label: `${z.side} ${z.kind} ${z.distal}–${z.proximal} (${z.lifecycle})`,
      price: z.distal,
      price2: z.proximal,
      fromTime: z.baseStartTime,
      toTime: lastTime,
      tone: z.side === "demand" ? "demand" : "supply",
      provenance: { source: `strategy/zones (${z.timeframe})`, knownAt: z.baseEndTime },
    });
  }
  // Order blocks actually detected (invalidated blocks are not drawn).
  for (const ob of td?.smc?.orderBlocks ?? []) {
    if (!finite(ob.upper) || !finite(ob.lower) || ob.status === "invalidated") continue;
    overlays.push({
      kind: "order_block",
      label: `${ob.direction} OB ${ob.lower}–${ob.upper} (${ob.status})`,
      price: ob.lower,
      price2: ob.upper,
      fromTime: ob.createdAt,
      toTime: lastTime,
      tone: ob.direction === "bullish" ? "demand" : "supply",
      provenance: { source: `data/smc order block (${ob.timeframe}, ${ob.status})`, knownAt: ob.displacementTime },
    });
  }
  // Fair value gaps actually detected (invalidated gaps are not drawn).
  for (const f of td?.smc?.fvgs ?? []) {
    if (!finite(f.upper) || !finite(f.lower) || f.status === "invalidated") continue;
    overlays.push({
      kind: "fvg",
      label: `${f.direction} FVG ${f.lower}–${f.upper} (${f.status})`,
      price: f.lower,
      price2: f.upper,
      fromTime: f.createdAt,
      toTime: lastTime,
      tone: f.direction === "bullish" ? "demand" : "supply",
      provenance: { source: `data/smc fair value gap (${f.timeframe})`, knownAt: f.createdAt },
    });
  }
  // Resting liquidity actually detected (broken pools are not drawn).
  for (const p of td?.smc?.liquidityPools ?? []) {
    if (!finite(p.level) || p.broken) continue;
    const side = p.side === "buy_side" ? "BSL" : "SSL";
    overlays.push({
      kind: "liquidity",
      label: `${side} ${p.level}${p.swept ? " (swept)" : " (resting)"}`,
      price: p.level,
      fromTime: p.formedAtTime,
      toTime: lastTime,
      tone: p.side === "buy_side" ? "supply" : "demand",
      provenance: { source: `data/smc liquidity pool (${p.touches} touches)`, knownAt: p.formedAtTime },
    });
  }
  // Structural invalidation the engine published for THIS thesis.
  const si = result.tradePlan?.structuralInvalidation;
  if (si && finite(si.level)) {
    overlays.push({
      kind: "invalidation",
      label: `structural invalidation ${si.level}`,
      price: si.level,
      ...span,
      tone: "bear",
      provenance: { source: `tradePlan.structuralInvalidation (${si.timeframe})` },
    });
  }
  // Key structural levels from the analysis (structure chapter).
  const support = parseLevel(result.keyLevels?.support);
  const resistance = parseLevel(result.keyLevels?.resistance);
  if (finite(support)) {
    overlays.push({
      kind: "structure",
      label: `key support ${support}`,
      price: support,
      ...span,
      tone: "demand",
      provenance: { source: "analysis keyLevels" },
    });
  }
  if (finite(resistance)) {
    overlays.push({
      kind: "structure",
      label: `key resistance ${resistance}`,
      price: resistance,
      ...span,
      tone: "supply",
      provenance: { source: "analysis keyLevels" },
    });
  }
  // Plan levels (entry / stop / TP1 / TP2) — only from the adaptive plan.
  if (plan && finite(plan.entry)) {
    overlays.push({
      kind: "entry",
      label: `entry ${plan.entry}`,
      price: plan.entry,
      ...span,
      tone: "bull",
      provenance: { source: "adaptive trade plan entry" },
    });
  }
  if (plan && finite(plan.stop)) {
    overlays.push({
      kind: "stop",
      label: `stop ${plan.stop}`,
      price: plan.stop,
      ...span,
      tone: "bear",
      provenance: { source: plan.stopBasis ?? "adaptive trade plan stop" },
    });
  }
  if (plan && finite(plan.tp1)) {
    overlays.push({
      kind: "tp1",
      label: `TP1 ${plan.tp1}`,
      price: plan.tp1,
      ...span,
      tone: "bull",
      provenance: { source: plan.tp1Basis ?? "adaptive trade plan target" },
    });
  }
  if (plan && finite(plan.tp2)) {
    overlays.push({
      kind: "tp2",
      label: `TP2 ${plan.tp2}`,
      price: plan.tp2,
      ...span,
      tone: "bull",
      provenance: { source: plan.tp2Basis ?? "adaptive trade plan second target" },
    });
  }
  // Confirmation markers — only formations actually detected.
  for (const f of td?.strategy?.formations ?? []) {
    if (!finite(f.completedAtTime)) continue;
    overlays.push({
      kind: "confirmation",
      label: `${f.direction} ${f.kind.replace("_", " ")}`,
      price: candles[Math.min(f.completedAtIndex, candles.length - 1)].close,
      markerTime: f.completedAtTime,
      tone: f.direction === "bullish" ? "bull" : "bear",
      provenance: { source: `strategy/candles (${f.timeframe})`, knownAt: f.completedAtTime },
    });
  }

  // ── The visual narrative, honestly chaptered ────────────────────────
  const story: string[] = [];
  const structureText = result.technicalData?.structure
    ? `STRUCTURE: observable structure ${result.technicalData.structure}${result.technicalData.bosDirection && result.technicalData.bosDirection !== "none" ? `, BOS ${result.technicalData.bosDirection}` : ""}`
    : "STRUCTURE: not readable on this snapshot";
  story.push(structureText);
  const zoneCount = overlays.filter((o) => o.kind === "zone").length;
  story.push(
    zoneCount > 0
      ? `LOCATION: ${zoneCount} supply/demand zone(s) detected — see bands`
      : "LOCATION: no supply/demand zone detected on this snapshot",
  );
  const conf = overlays.filter((o) => o.kind === "confirmation");
  story.push(
    conf.length > 0
      ? `CONFIRMATION: ${conf.map((c) => c.label).join(", ")}`
      : "CONFIRMATION: no candle-formation confirmation detected",
  );
  story.push(plan && finite(plan.entry) ? `ENTRY: ${plan.entry}` : "ENTRY: no plan entry");
  story.push(
    plan && finite(plan.stop)
      ? `SL: ${plan.stop} — ${plan.stopBasis ?? "structural stop"}`
      : "SL: no structural stop available",
  );
  story.push(
    plan && finite(plan.tp1)
      ? `TARGET: ${plan.tp1}${plan && finite(plan.tp2) ? `, TP2 ${plan.tp2}` : " (no second structural target detected)"}`
      : "TARGET: no structural target available",
  );

  const window = candles.slice(-CHART_MAX_CANDLES);
  return {
    available: true,
    meta: {
      instrument: result.instrument,
      ...(result.provider !== undefined ? { provider: result.provider } : {}),
      ...(result.providerInstrumentId !== undefined
        ? { providerInstrumentId: result.providerInstrumentId }
        : {}),
      timeframe: result.timeframe,
      observedAt: lastTime,
      candlesRendered: window.length,
      provenance: {
        candleCountFull: candles.length,
        windowFirstTimestamp: window[0].timestamp,
        windowLastTimestamp: lastTime,
        inputHash: chartInputHash(candles),
      },
    },
    candles: window.map((c) => ({ ...c })),
    overlays,
    story,
  };
}
