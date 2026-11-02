/**
 * Parse only the visible forecast status badge emitted by AnalysisResult.
 * Limitation prose can contain the word "conditional" while the actual
 * forecast status is UNAVAILABLE; prose must never override the badge.
 */
export function extractForecastStatus(text) {
  if (typeof text !== "string") return undefined;
  const match = text.match(/\b(CONDITIONAL|UNAVAILABLE|BLOCKED DATA QUALITY)\s*·\s*unvalidated\b/i);
  return match?.[1]?.toUpperCase();
}
