/**
 * Phase 312 — the structured, factual reasoning chain.
 *
 * Answers "Kenapa Xstarz mengambil kesimpulan ini?" with an ordered chain that
 * mirrors the source document's analytical order:
 *
 *   MARKET STRUCTURE → HTF/MTF → LOCATION/SMC → ENTRY CONFIRMATION →
 *   TECHNICAL STATE → FUNDAMENTAL STATE → CONFLUENCE/CONFLICT →
 *   INVALIDATION → R:R/ACTIONABILITY → LIMITATIONS
 *
 * Every line is built from fields the analysis actually carries; a layer with
 * no evidence says exactly that in its own words. No generic filler, no
 * invented certainty, no "institutional" language.
 */

import type { AnalysisResult } from "@/types/analysis";

export interface ReasoningSection {
  heading: string;
  lines: string[];
}

export interface ReasoningChain {
  instrument: string;
  timeframe: string;
  sections: ReasoningSection[];
}

const NOT_AVAILABLE = "no structural evidence available in this analysis";

export function buildReasoningChain(result: AnalysisResult): ReasoningChain {
  const td = result.technicalData;
  const sections: ReasoningSection[] = [];

  // ── MARKET STRUCTURE ──
  const structureLines: string[] = [];
  const structure = td?.structure;
  if (structure) structureLines.push(`observable structure: ${structure}`);
  for (const ev of result.structuralEvidence?.timeframes ?? []) {
    structureLines.push(
      `${ev.timeframe} (${ev.role}): ${ev.direction}${ev.event ? ` — ${ev.event.kind} ${ev.event.direction} at ${ev.event.brokenLevel}` : ""} [${ev.evidenceState}]`,
    );
  }
  if (td?.bosDirection && td.bosDirection !== "none") {
    structureLines.push(`BOS direction: ${td.bosDirection}`);
  }
  if (td?.chochDirection && td.chochDirection !== "none") {
    structureLines.push(`CHoCH direction: ${td.chochDirection}`);
  }
  if (structureLines.length === 0) structureLines.push(NOT_AVAILABLE);
  sections.push({ heading: "MARKET STRUCTURE", lines: structureLines });

  // ── HTF / MTF ──
  const mtfLines: string[] = [];
  if (result.mtfSummary) {
    mtfLines.push(JSON.stringify(result.mtfSummary) === "{}" ? "" : `MTF summary: ${summarizeMtf(result.mtfSummary)}`);
  }
  if (result.htfAlignment) {
    mtfLines.push(`HTF/LTF relationship: ${summarizeHtf(result.htfAlignment)}`);
  }
  const cleanMtf = mtfLines.filter((l) => l.length > 0);
  sections.push({
    heading: "HTF/MTF",
    lines: cleanMtf.length > 0 ? cleanMtf : ["multi-timeframe context not available in this analysis"],
  });

  // ── LOCATION / SMC ──
  const locLines: string[] = [];
  const tl = result.tradeLocation;
  if (tl) locLines.push(`location: ${tl.location} (price ${tl.price})`);
  if (tl?.flags) {
    if (tl.flags.insideFvg || tl.flags.atFvgBoundary) locLines.push("price at an FVG");
    if (tl.flags.insideOb || tl.flags.atObBoundary) locLines.push("price at an Order Block");
  }
  const smc = td?.smc;
  // Phase-10 defensive contract: an evidence object may arrive malformed from
  // a persisted record; every read is guarded and honesty is preserved.
  if (smc && typeof smc === "object") {
    const freshZones = (Array.isArray(td?.strategy?.zones) ? td.strategy!.zones : []).filter((z) => z?.lifecycle !== "broken");
    for (const z of freshZones.slice(0, 3)) {
      locLines.push(
        `${z.kind} ${z.side} zone ${z.proximal}–${z.distal} (${z.lifecycle}, price ${z.priceLocation})`,
      );
    }
    if (smc.recentSweep && typeof smc.recentSweep === "object") {
      locLines.push(
        `recent ${smc.recentSweep.side === "buy_side" ? "buy-side" : "sell-side"} liquidity sweep at ${smc.recentSweep.level} (${smc.recentSweep.timeframe})`,
      );
    }
    const orderBlocks = Array.isArray(smc.orderBlocks) ? smc.orderBlocks : [];
    if (orderBlocks.length > 0) {
      const ob = orderBlocks[0];
      locLines.push(
        `nearest ${ob.direction} Order Block ${ob.lower}–${ob.upper} [${ob.status}]`,
      );
    }
    const fvgs = Array.isArray(smc.fvgs) ? smc.fvgs : [];
    if (fvgs.length > 0) {
      const fvg = fvgs[0];
      locLines.push(`nearest ${fvg.direction} FVG ${fvg.lower}–${fvg.upper} [${fvg.status}]`);
    }
  }
  if (locLines.length === 0) {
    locLines.push("no SMC/location context available in this analysis");
  }
  sections.push({ heading: "LOCATION/SMC", lines: locLines });

  // ── ENTRY CONFIRMATION ──
  const confLines: string[] = [];
  for (const f of Array.isArray(td?.strategy?.formations) ? td.strategy!.formations : []) {
    confLines.push(
      `${f.kind === "pin_bar" ? (f.direction === "bullish" ? "bullish" : "bearish") + " pin bar" : f.direction + " 3-candle sandwich"} completed at index ${f.completedAtIndex} (confirmation: ${f.confirmation})`,
    );
  }
  const unicorn = td?.strategy?.unicorn;
  if (unicorn?.available) {
    confLines.push(`Unicorn-component overlap (PARTIAL): ${unicorn.observations[0].direction} OB+FVG band ${unicorn.observations[0].overlapLower}–${unicorn.observations[0].overlapUpper}`);
  }
  if (confLines.length === 0) {
    confLines.push("no candle-formation confirmation present in this analysis");
  }
  sections.push({ heading: "ENTRY CONFIRMATION", lines: confLines });

  // ── TECHNICAL STATE ──
  const techLines: string[] = [];
  if (td?.rsi14 !== undefined) techLines.push(`RSI(14) ${td.rsi14.toFixed(1)} (secondary)`);
  if (td?.macdHistogram !== undefined) techLines.push(`MACD histogram ${td.macdHistogram.toFixed(4)} (secondary)`);
  if (td?.sma50 !== undefined) techLines.push(`SMA50 ${td.sma50}`);
  if (td?.sma200 !== undefined) techLines.push(`SMA200 ${td.sma200}`);
  if (td?.atr14 !== undefined) techLines.push(`ATR(14) ${td.atr14}`);
  techLines.push(`technical summary: ${result.technicalSummary}`);
  sections.push({ heading: "TECHNICAL STATE", lines: techLines });

  // ── FUNDAMENTAL STATE ──
  const fundLines: string[] = [];
  const fa = result.fundamentalAssessment;
  if (fa) {
    fundLines.push(
      fa.available
        ? `assessment available (domain ${fa.domain}${fa.provider ? `, provider ${fa.provider}` : ""}): ${result.fundamentalSummary}`
        : `fundamental assessment: unavailable — ${result.fundamentalSummary}`,
    );
  } else {
    fundLines.push("no fundamental assessment in this analysis (absence is not a neutral reading)");
  }
  sections.push({ heading: "FUNDAMENTAL STATE", lines: fundLines });

  // ── CONFLUENCE / CONFLICT ──
  const uni = result.unifiedIntelligence;
  sections.push({
    heading: "CONFLUENCE/CONFLICT",
    lines: uni
      ? [
          `${uni.state}: ${uni.confluence.reason}`,
          ...(uni.confluence.agreement === "conflicting" ? ["primary evidence remains conflicting"] : []),
          ...uni.limitations.slice(0, 3).map((l) => `limitation: ${l}`),
        ]
      : ["unified confluence not derived in this analysis"],
  });

  // ── INVALIDATION ──
  const invLines: string[] = [];
  if (result.keyLevels?.invalidation) invLines.push(`key invalidation level: ${result.keyLevels.invalidation}`);
  if (result.tradePlan) invLines.push(`planned stop: ${result.tradePlan.stopLoss}`);
  for (const s of result.structuralEvidence?.timeframes ?? []) {
    if (s.invalidation) {
      invLines.push(`${s.timeframe}: thesis void beyond ${s.invalidation.level} (structural)`);
    }
  }
  if (invLines.length === 0) invLines.push("no invalidation level available in this analysis");
  sections.push({ heading: "INVALIDATION", lines: invLines });

  // ── R:R / ACTIONABILITY ──
  const rrLines: string[] = [];
  if (result.tradePlan) {
    rrLines.push(
      `${result.recommendation} — entry ${result.tradePlan.entry}, SL ${result.tradePlan.stopLoss}, TP ${result.tradePlan.takeProfit}, R:R ${result.tradePlan.riskReward}`,
    );
  } else {
    rrLines.push(`no trade plan (${result.recommendation})`);
    for (const r of result.noTradeReasons.slice(0, 3)) rrLines.push(`reason: ${r}`);
  }
  sections.push({ heading: "R:R/ACTIONABILITY", lines: rrLines });

  // ── LIMITATIONS ──
  const limLines: string[] = [...result.dataFlags];
  if (result.dataCompleteness !== "full") {
    limLines.push(`data completeness: ${result.dataCompleteness}`);
  }
  for (const leg of (result.providerDiagnostics ?? []).filter((l) => l.acquired === false).slice(0, 3)) {
    limLines.push(`provider leg ${leg.provider}/${leg.dataset} did not deliver${leg.reason ? `: ${leg.reason}` : ""}`);
  }
  if (unicorn) limLines.push(unicorn.limitation);
  if (limLines.length === 0) limLines.push("no additional limitations recorded");
  sections.push({ heading: "LIMITATIONS", lines: limLines });

  return {
    instrument: result.instrument,
    timeframe: String(result.timeframe),
    sections,
  };
}

function summarizeMtf(mtf: AnalysisResult["mtfSummary"]): string {
  if (!mtf) return "";
  const parts: string[] = [];
  if ("alignment" in mtf && mtf.alignment) parts.push(`alignment ${mtf.alignment}`);
  if ("htfBias" in mtf && mtf.htfBias) parts.push(`HTF ${mtf.htfBias}`);
  if ("htfTimeframe" in mtf && mtf.htfTimeframe) parts.push(`on ${mtf.htfTimeframe}`);
  return parts.join(", ");
}

function summarizeHtf(htf: NonNullable<AnalysisResult["htfAlignment"]>): string {
  return typeof htf === "string" ? htf : JSON.stringify(htf);
}
