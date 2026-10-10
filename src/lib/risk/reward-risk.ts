/**
 * Calculate R:R from the exact price levels shown to the trader.
 *
 * Invalid geometry is rejected rather than hidden by absolute distances:
 * long => SL < entry < TP; short => TP < entry < SL.
 */
export function calculateRiskRewardRatio(input: {
  entry: string | number;
  stopLoss: string | number;
  takeProfit: string | number;
  direction: "long" | "short";
}): number | undefined {
  const entry = Number(input.entry);
  const stopLoss = Number(input.stopLoss);
  const takeProfit = Number(input.takeProfit);

  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit) ||
    entry <= 0 ||
    stopLoss <= 0 ||
    takeProfit <= 0
  ) {
    return undefined;
  }

  const risk =
    input.direction === "long" ? entry - stopLoss : stopLoss - entry;
  const reward =
    input.direction === "long" ? takeProfit - entry : entry - takeProfit;

  if (!(risk > 0) || !(reward > 0)) return undefined;

  const ratio = reward / risk;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}
