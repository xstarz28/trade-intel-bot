import type { AnalysisResult } from "@/types/analysis";
import type { TechnicalData } from "@/lib/data/market-types";

export interface ConditionalEntryScenario {
  id: "bullish-breakout" | "bearish-breakdown";
  direction: "long" | "short";
  trigger: number;
  invalidation: number;
  target?: number;
  riskReward?: number;
  triggerBasis: string;
  invalidationBasis: string;
  targetBasis?: string;
  ready: boolean;
  reason: string;
}

/**
 * Derive conditional watch levels from observed candles and structural levels.
 * These are alerts/contingent scenarios, never executable trade plans.
 * ATR is used only as a disclosed confirmation buffer; targets must be
 * observed opposing swing levels. No synthetic target is generated.
 */
export function buildConditionalEntryScenarios(result: AnalysisResult): ConditionalEntryScenario[] {
  const candles = result.candles ?? [];
  const tech = result.technicalData as TechnicalData | undefined;
  if (candles.length < 20 || !tech || tech.dataPoints < 20) return [];
  const primaryQuality = result.dataQualityContext?.primaryData.status;
  if (primaryQuality && ["STALE", "UNAVAILABLE", "INVALID", "INSUFFICIENT"].includes(primaryQuality)) return [];

  const last = candles[candles.length - 1];
  const values = [last?.close, last?.high, last?.low, tech.atr14];
  if (!values.slice(0, 3).every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) return [];
  const price = last.close;
  const atr = typeof tech.atr14 === "number" && Number.isFinite(tech.atr14) && tech.atr14 > 0 ? tech.atr14 : undefined;
  const buffer = atr ? atr * 0.1 : 0;
  const supports = [...tech.supportLevels, ...tech.swingLows].filter((v) => Number.isFinite(v) && v > 0 && v < price).sort((a, b) => b - a);
  const resistances = [...tech.resistanceLevels, ...tech.swingHighs].filter((v) => Number.isFinite(v) && v > 0 && v > price).sort((a, b) => a - b);
  const unique = (values: number[]) => values.filter((v, i) => values.findIndex((x) => Math.abs(x - v) <= Math.max(Math.abs(v) * 1e-8, 1e-8)) === i);
  const support = unique(supports)[0];
  const resistance = unique(resistances)[0];
  const bullishTarget = unique(resistances).find((v) => resistance !== undefined && v > resistance + buffer);
  const bearishTarget = unique(supports).find((v) => support !== undefined && v < support - buffer);

  const scenarios: ConditionalEntryScenario[] = [];
  if (resistance !== undefined && support !== undefined) {
    const trigger = resistance + buffer;
    const invalidation = support;
    const target = bullishTarget;
    const risk = invalidation !== undefined ? trigger - invalidation : 0;
    const reward = target !== undefined ? target - trigger : 0;
    const rr = risk > 0 && reward > 0 ? reward / risk : undefined;
    const ready = atr !== undefined && support !== undefined && target !== undefined && rr !== undefined && rr >= 1.5;
    scenarios.push({
      id: "bullish-breakout",
      direction: "long",
      trigger,
      invalidation,
      ...(target !== undefined ? { target } : {}),
      ...(rr !== undefined ? { riskReward: rr } : {}),
      triggerBasis: "Resistance terdekat + buffer konfirmasi 0,1 ATR",
      invalidationBasis: "Level support/swing low teramati yang membatalkan skenario breakout",
      ...(target !== undefined ? { targetBasis: "Swing high teramati berikutnya" } : {}),
      ready,
      reason: !atr ? "ATR tidak tersedia; konfirmasi buffer belum dapat dihitung." : !target ? "Belum ada swing high teramati di atas pemicu untuk target yang valid." : !ready ? "R:R berbasis level teramati di bawah minimum 1,5." : "Tunggu candle tutup di atas pemicu dan struktur/MTF mengonfirmasi.",
    });
  }
  if (support !== undefined && resistance !== undefined) {
    const trigger = support - buffer;
    const invalidation = resistance;
    const target = bearishTarget;
    const risk = invalidation !== undefined ? invalidation - trigger : 0;
    const reward = target !== undefined ? trigger - target : 0;
    const rr = risk > 0 && reward > 0 ? reward / risk : undefined;
    const ready = atr !== undefined && target !== undefined && rr !== undefined && rr >= 1.5;
    scenarios.push({
      id: "bearish-breakdown",
      direction: "short",
      trigger,
      invalidation,
      ...(target !== undefined ? { target } : {}),
      ...(rr !== undefined ? { riskReward: rr } : {}),
      triggerBasis: "Support terdekat − buffer konfirmasi 0,1 ATR",
      invalidationBasis: "Level resistance/swing high teramati yang membatalkan skenario breakdown",
      ...(target !== undefined ? { targetBasis: "Swing low teramati berikutnya" } : {}),
      ready,
      reason: !atr ? "ATR tidak tersedia; konfirmasi buffer belum dapat dihitung." : !target ? "Belum ada swing low teramati di bawah pemicu untuk target yang valid." : !ready ? "R:R berbasis level teramati di bawah minimum 1,5." : "Tunggu candle tutup di bawah pemicu dan struktur/MTF mengonfirmasi.",
    });
  }
  return scenarios;
}
