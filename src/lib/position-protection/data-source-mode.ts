/**
 * Phase 71 — Runtime Source / Data-Mode Labeling
 *
 * Provides a reliable source/data-mode distinction throughout the protection
 * pipeline so the UI never implies that simulated validation is real market data.
 *
 * Supported states:
 * - LIVE: Real-time WebSocket/streaming data
 * - POLLING: Real data fetched via REST polling
 * - SIMULATED: Deterministic test simulation data
 * - STALE: Previously fresh data that is now outdated
 * - UNAVAILABLE: No data available
 *
 * Pure functions and types — no side effects.
 */

// ═══════════════════════════════════════════════════════════════
// DATA SOURCE MODE
// ═══════════════════════════════════════════════════════════════

export type DataSourceMode =
  | "LIVE"        // Real-time streaming/WebSocket
  | "POLLING"     // Real data via REST polling
  | "SIMULATED"   // Deterministic test simulation
  | "STALE"       // Previously fresh, now outdated
  | "UNAVAILABLE"; // No data

// ═══════════════════════════════════════════════════════════════
// SOURCE LABEL
// ═══════════════════════════════════════════════════════════════

export interface DataSourceLabel {
  /** The actual data source mode. */
  mode: DataSourceMode;
  /** Provider that produced the data (e.g., "OKX", "TwelveData"). */
  provider: string;
  /** Timestamp when data was received. */
  receivedAt: number;
  /** Whether the data is still fresh. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// LABEL CREATION
// ═══════════════════════════════════════════════════════════════

/** Create a label for live (streaming) data. */
export function createLiveLabel(provider: string, now: number): DataSourceLabel {
  return { mode: "LIVE", provider, receivedAt: now, freshness: "FRESH" };
}

/** Create a label for polled data. */
export function createPollingLabel(provider: string, now: number): DataSourceLabel {
  return { mode: "POLLING", provider, receivedAt: now, freshness: "FRESH" };
}

/** Create a label for simulated/test data. */
export function createSimulatedLabel(now: number): DataSourceLabel {
  return { mode: "SIMULATED", provider: "SIMULATION", receivedAt: now, freshness: "FRESH" };
}

/** Create a label for stale data (previously fresh). */
export function createStaleLabel(previous: DataSourceLabel): DataSourceLabel {
  return { ...previous, mode: "STALE", freshness: "STALE" };
}

/** Create a label for unavailable data. */
export function createUnavailableLabel(provider: string, now: number): DataSourceLabel {
  return { mode: "UNAVAILABLE", provider, receivedAt: now, freshness: "UNAVAILABLE" };
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CALCULATION
// ═══════════════════════════════════════════════════════════════

/** Thresholds for freshness classification (ms). */
const STALE_THRESHOLD = 300_000;   // 5 minutes
const DELAYED_THRESHOLD = 60_000;  // 1 minute

/**
 * Calculate freshness from a received timestamp and current time.
 * Returns a clear classification.
 */
export function calculateFreshness(
  receivedAt: number,
  now: number,
): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (receivedAt === 0) return "UNAVAILABLE";
  const age = now - receivedAt;
  if (age <= DELAYED_THRESHOLD) return "FRESH";
  if (age <= STALE_THRESHOLD) return "DELAYED";
  return "STALE";
}

/**
 * Update a label's freshness based on current time.
 */
export function updateLabelFreshness(
  label: DataSourceLabel,
  now: number,
): DataSourceLabel {
  const freshness = calculateFreshness(label.receivedAt, now);
  const newMode: DataSourceMode =
    freshness === "STALE" ? "STALE" :
    freshness === "UNAVAILABLE" ? "UNAVAILABLE" :
    label.mode;

  return { ...label, freshness, mode: newMode };
}

// ═══════════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════

/** Human-readable display for data source mode. */
export function dataSourceModeLabel(mode: DataSourceMode): string {
  switch (mode) {
    case "LIVE": return "LIVE (streaming)";
    case "POLLING": return "POLLING";
    case "SIMULATED": return "SIMULATED";
    case "STALE": return "STALE";
    case "UNAVAILABLE": return "UNAVAILABLE";
  }
}

/** Color class for data source mode (Tailwind). */
export function dataSourceModeColor(mode: DataSourceMode): string {
  switch (mode) {
    case "LIVE": return "text-emerald-400";
    case "POLLING": return "text-blue-400";
    case "SIMULATED": return "text-violet-400";
    case "STALE": return "text-amber-400";
    case "UNAVAILABLE": return "text-zinc-400";
  }
}

/** Whether the source provides real market data (not simulated). */
export function isRealData(label: DataSourceLabel): boolean {
  return label.mode === "LIVE" || label.mode === "POLLING";
}

/** Whether the data should be treated as usable for protection evaluation. */
export function isUsableData(label: DataSourceLabel): boolean {
  return label.freshness === "FRESH" || label.freshness === "DELAYED";
}
