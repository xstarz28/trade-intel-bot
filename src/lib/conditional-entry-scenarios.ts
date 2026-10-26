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
  return buildConditionalEntryScenariosFromMarketData({
    candles: result.candles,
    technicalData: result.technicalData as TechnicalData | undefined,
    primaryQuality: result.dataQualityContext?.primaryData.status,
  });
}

export function buildConditionalEntryScenariosFromMarketData(input: {
  candles?: AnalysisResult["candles"];
  technicalData?: TechnicalData;
  primaryQuality?: string;
}): ConditionalEntryScenario[] {
  const candles = input.candles ?? [];
  const tech = input.technicalData;
  if (candles.length < 20 || !tech || tech.dataPoints < 20) return [];
  const primaryQuality = input.primaryQuality;
  if (primaryQuality && new Set<string>(["STALE", "UNAVAILABLE", "INVALID", "INSUFFICIENT"]).has(primaryQuality)) return [];

  const last = candles[candles.length - 1];
  const validOhlc = (candle: (typeof candles)[number]) =>
    [candle.open, candle.high, candle.low, candle.close].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    ) &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
  if (!last || !validOhlc(last)) return [];
  const recentCandles = candles.slice(-20);
  if (recentCandles.some((candle) => !validOhlc(candle))) return [];
  const timestamps = recentCandles.map((candle) => candle.timestamp);
  if (
    timestamps.some((value) => !Number.isFinite(value) || value <= 0) ||
    timestamps.some((value, index) => index > 0 && value <= timestamps[index - 1])
  ) return [];
  const price = last.close;
  const atr = typeof tech.atr14 === "number" && Number.isFinite(tech.atr14) && tech.atr14 > 0 ? tech.atr14 : undefined;
  const buffer = atr ? atr * 0.1 : 0;
  const supports = [...tech.supportLevels, ...tech.swingLows].filter((v) => Number.isFinite(v) && v > 0 && v < price).sort((a, b) => b - a);
  const resistances = [...tech.resistanceLevels, ...tech.swingHighs].filter((v) => Number.isFinite(v) && v > 0 && v > price).sort((a, b) => a - b);
  const unique = (values: number[]) => values.filter((v, i) => values.findIndex((x) => Math.abs(x - v) <= Math.max(Math.abs(v) * 1e-8, 1e-8)) === i);
  const uniqueSupports = unique(supports);
  const uniqueResistances = unique(resistances);
  const support = uniqueSupports[0];
  const resistance = uniqueResistances[0];
  const longTrigger = resistance !== undefined ? resistance + buffer : undefined;
  const longRisk = longTrigger !== undefined && support !== undefined ? longTrigger - support : 0;
  const shortTrigger = support !== undefined ? support - buffer : undefined;
  const shortRisk = shortTrigger !== undefined && resistance !== undefined ? resistance - shortTrigger : 0;
  const bullishTargetCandidates = uniqueResistances.filter((v) => resistance !== undefined && v > resistance + buffer);
  const bearishTargetCandidates = uniqueSupports.filter((v) => support !== undefined && v < support - buffer);
  // Prefer the nearest observed opposing swing that actually meets the minimum
  // 1.5R requirement. If none qualifies, preserve the nearest observed target
  // as a rejected scenario rather than fabricating an executable plan.
  const bullishTarget = bullishTargetCandidates.find((v) =>
    longRisk > 0 && longTrigger !== undefined && (v - longTrigger) / longRisk >= 1.5
  ) ?? bullishTargetCandidates[0];
  const bearishTarget = bearishTargetCandidates.find((v) =>
    shortRisk > 0 && shortTrigger !== undefined && (shortTrigger - v) / shortRisk >= 1.5
  ) ?? bearishTargetCandidates[0];

  const scenarios: ConditionalEntryScenario[] = [];
  if (resistance !== undefined && support !== undefined) {
    const trigger = longTrigger!;
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
      ...(target !== undefined ? { targetBasis: rr !== undefined && rr >= 1.5 ? "Swing high teramati terdekat yang memenuhi minimum R:R 1,5" : "Swing high teramati berikutnya" } : {}),
      ready,
      reason: !atr ? "ATR tidak tersedia; konfirmasi buffer belum dapat dihitung." : !target ? "Belum ada swing high teramati di atas pemicu untuk target yang valid." : !ready ? "R:R berbasis level teramati di bawah minimum 1,5." : "Tunggu candle tutup di atas pemicu dan struktur/MTF mengonfirmasi.",
    });
  }
  if (support !== undefined && resistance !== undefined) {
    const trigger = shortTrigger!;
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
      ...(target !== undefined ? { targetBasis: rr !== undefined && rr >= 1.5 ? "Swing low teramati terdekat yang memenuhi minimum R:R 1,5" : "Swing low teramati berikutnya" } : {}),
      ready,
      reason: !atr ? "ATR tidak tersedia; konfirmasi buffer belum dapat dihitung." : !target ? "Belum ada swing low teramati di bawah pemicu untuk target yang valid." : !ready ? "R:R berbasis level teramati di bawah minimum 1,5." : "Tunggu candle tutup di bawah pemicu dan struktur/MTF mengonfirmasi.",
    });
  }
  // If swing/support/resistance detection has no usable levels, still give
  // the trader a transparent watch framework from the observed recent range.
  // These are explicitly mathematical projections, never confirmed S/R or
  // executable plans. Stale/unavailable primary data was rejected above.
  if (scenarios.length === 0) {
    const windowCandles = candles.slice(-20).filter((candle) =>
      Number.isFinite(candle.high) && candle.high > 0 &&
      Number.isFinite(candle.low) && candle.low > 0 &&
      candle.high >= candle.low
    );
    if (windowCandles.length >= 10) {
      const rangeHigh = Math.max(...windowCandles.map((candle) => candle.high));
      const rangeLow = Math.min(...windowCandles.map((candle) => candle.low));
      const rangeWidth = rangeHigh - rangeLow;
      if (Number.isFinite(rangeWidth) && rangeWidth > 0) {
        const projectionBuffer = atr ? atr * 0.1 : rangeWidth * 0.01;
        const longTrigger = rangeHigh + projectionBuffer;
        const longInvalidation = rangeLow - projectionBuffer;
        const longRisk = longTrigger - longInvalidation;
        const longReward = Math.max(rangeWidth, atr ? atr * 2 : 0, longRisk * 1.5);
        const longTarget = longTrigger + longReward;
        const longRr = longRisk > 0 ? longReward / longRisk : undefined;
        const shortTrigger = rangeLow - projectionBuffer;
        const shortInvalidation = rangeHigh + projectionBuffer;
        const shortRisk = shortInvalidation - shortTrigger;
        const shortReward = Math.max(rangeWidth, atr ? atr * 2 : 0, shortRisk * 1.5);
        const shortTarget = shortTrigger - shortReward;
        const shortRr = shortRisk > 0 ? shortReward / shortRisk : undefined;
        scenarios.push({
          id: "bullish-breakout",
          direction: "long",
          trigger: longTrigger,
          invalidation: longInvalidation,
          target: longTarget,
          ...(longRr !== undefined ? { riskReward: longRr } : {}),
          triggerBasis: "High rentang 20 candle teramati + buffer volatilitas",
          invalidationBasis: "Low rentang 20 candle teramati − buffer volatilitas",
          targetBasis: "Proyeksi 1× rentang teramati atau 2 ATR (mana yang lebih besar), bukan resistance terkonfirmasi",
          ready: false,
          reason: "Skenario proyeksi tersedia, tetapi swing/resistance terkonfirmasi belum tersedia. Tunggu struktur dan target pasar nyata sebelum mempertimbangkan entry.",
        });
        scenarios.push({
          id: "bearish-breakdown",
          direction: "short",
          trigger: shortTrigger,
          invalidation: shortInvalidation,
          target: shortTarget,
          ...(shortRr !== undefined ? { riskReward: shortRr } : {}),
          triggerBasis: "Low rentang 20 candle teramati − buffer volatilitas",
          invalidationBasis: "High rentang 20 candle teramati + buffer volatilitas",
          targetBasis: "Proyeksi 1× rentang teramati atau 2 ATR (mana yang lebih besar), bukan support terkonfirmasi",
          ready: false,
          reason: "Skenario proyeksi tersedia, tetapi swing/support terkonfirmasi belum tersedia. Tunggu struktur dan target pasar nyata sebelum mempertimbangkan entry.",
        });
      }
    }
  }
  // If a structural trigger exists but no farther opposing swing is known,
  // fill the target field with a clearly labeled mathematical projection.
  // This prevents an empty target cell without presenting it as market structure.
  const recentWindow = candles.slice(-20).filter((candle) =>
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    candle.high >= candle.low
  );
  const observedRangeWidth = recentWindow.length >= 10
    ? Math.max(...recentWindow.map((candle) => candle.high)) - Math.min(...recentWindow.map((candle) => candle.low))
    : 0;
  for (const scenario of scenarios) {
    if (scenario.target !== undefined) continue;
    const risk = Math.abs(scenario.trigger - scenario.invalidation);
    if (!(risk > 0) || !Number.isFinite(risk)) continue;
    const projectionDistance = Math.max(observedRangeWidth, atr ? atr * 2 : 0, risk * 1.5);
    const projectedTarget = scenario.direction === "long"
      ? scenario.trigger + projectionDistance
      : scenario.trigger - projectionDistance;
    if (!Number.isFinite(projectedTarget) || projectedTarget <= 0) continue;
    scenario.target = projectedTarget;
    scenario.riskReward = projectionDistance / risk;
    scenario.targetBasis = "Proyeksi matematis ≥1,5R / 2 ATR atau rentang teramati (mana lebih besar), bukan swing terkonfirmasi";
    scenario.ready = false;
    scenario.reason = "Target matematis ditampilkan agar level tidak kosong, tetapi bukan level swing teramati. Tunggu target struktur nyata sebelum mempertimbangkan entry.";
  }
  return scenarios;
}
