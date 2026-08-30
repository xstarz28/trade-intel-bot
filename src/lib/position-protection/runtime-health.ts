/**
 * Phase 99 — Runtime Health & Observability
 *
 * Evidence-based runtime health tracking for the Trading Intelligence system.
 * Pure deterministic functions — no fabricated timestamps, no fabricated provider data.
 * No execution language, no probability claims.
 *
 * Architecture:
 *   Observable signals from existing pipeline
 *   → component health normalization
 *   → overall health calculation
 *   → bounded persistence
 *   → dashboard display
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RuntimeHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export type RuntimeComponent =
  | "MARKET_DATA"
  | "OHLCV"
  | "NEWS"
  | "MACRO"
  | "CROSS_ASSET"
  | "INTELLIGENCE_ENGINE"
  | "PORTFOLIO_INTELLIGENCE"
  | "ALERT_RULE_ENGINE"
  | "NOTIFICATION_PERSISTENCE"
  | "HISTORICAL_PERSISTENCE";

export type DataFreshness = "FRESH" | "AGING" | "STALE" | "UNAVAILABLE" | "UNKNOWN";

/**
 * Normalized health record for a single component.
 * All fields are evidence-based — no fabricated timestamps.
 */
export interface RuntimeHealthComponent {
  /** Which component this tracks */
  component: RuntimeComponent;
  /** Current health status */
  status: RuntimeHealthStatus;
  /** Timestamp of last successful execution, or undefined if never succeeded */
  lastSuccessAt?: number;
  /** Timestamp of last failure, or undefined if never failed */
  lastFailureAt?: number;
  /** Timestamp of last attempt (success or failure), or undefined if never attempted */
  lastAttemptAt?: number;
  /** Number of consecutive failures without an intervening success */
  consecutiveFailures: number;
  /** Safe human-readable message summarizing state */
  message: string;
  /** Source/provider name (e.g. "TwelveData", "AlphaVantage") */
  source?: string;
  /** How old the underlying data is in ms, or undefined if unknown */
  dataAgeMs?: number;
  /** Freshness classification */
  freshness: DataFreshness;
}

/**
 * Aggregate snapshot of entire system health.
 */
export interface RuntimeHealthSnapshot {
  /** When this snapshot was generated */
  timestamp: number;
  /** Overall system health */
  overallStatus: RuntimeHealthStatus;
  /** Per-component health */
  components: RuntimeHealthComponent[];
  /** Intelligence cycle status */
  intelligenceCycleStatus: RuntimeHealthStatus;
  /** Alert pipeline status */
  alertPipelineStatus: RuntimeHealthStatus;
  /** Persistence status */
  persistenceStatus: RuntimeHealthStatus;
  /** Provider availability summary */
  providerAvailability: Record<string, RuntimeHealthStatus>;
  /** Components currently stale */
  staleComponents: RuntimeComponent[];
  /** Components currently unavailable */
  unavailableComponents: RuntimeComponent[];
}

/**
 * Input signals from the existing pipeline for health calculation.
 * All fields optional — unknown data is treated as UNKNOWN, not fabricated.
 */
export interface RuntimeHealthInput {
  /** Whether market data (spot prices) was successfully fetched */
  marketDataAvailable?: boolean;
  /** Timestamp of last successful market data fetch */
  marketDataLastSuccess?: number;
  /** Whether OHLCV data was successfully fetched */
  ohlcvAvailable?: boolean;
  /** Timestamp of last successful OHLCV fetch */
  ohlcvLastSuccess?: number;
  /** Whether news data was successfully fetched */
  newsAvailable?: boolean;
  /** Timestamp of last successful news fetch */
  newsLastSuccess?: number;
  /** Whether macro data was successfully fetched */
  macroAvailable?: boolean;
  /** Timestamp of last successful macro fetch */
  macroLastSuccess?: number;
  /** Whether cross-asset data was successfully fetched */
  crossAssetAvailable?: boolean;
  /** Timestamp of last successful cross-asset fetch */
  crossAssetLastSuccess?: number;
  /** Number of positions successfully analyzed by intelligence engine */
  intelligencePositionsAnalyzed?: number;
  /** Total number of registered positions */
  intelligencePositionsTotal?: number;
  /** Whether portfolio intelligence was generated */
  portfolioIntelligenceAvailable?: boolean;
  /** Number of alert rules evaluated in last cycle */
  alertRulesEvaluated?: number;
  /** Number of alert rules triggered in last cycle */
  alertRulesTriggered?: number;
  /** Whether notification was successfully persisted */
  notificationPersisted?: boolean;
  /** Whether historical snapshot was successfully persisted */
  historicalSnapshotPersisted?: boolean;
  /** Whether historical events were successfully persisted */
  historicalEventsPersisted?: boolean;
  /** Timestamp of last intelligence cycle completion */
  lastIntelligenceCycleAt?: number;
  /** Provider error messages (safe summaries, no API keys) */
  providerErrors?: Record<string, string>;
  /** Current positions data quality per instrument */
  dataQuality?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Fresh data is less than 5 minutes old */
export const FRESH_THRESHOLD_MS = 5 * 60 * 1000;

/** Aging data is less than 30 minutes old */
export const AGING_THRESHOLD_MS = 30 * 60 * 1000;

/** Stale data is older than 30 minutes */
// Anything > AGING_THRESHOLD_MS is considered stale

/** Maximum consecutive failures before UNAVAILABLE */
export const UNAVAILABLE_FAILURE_THRESHOLD = 5;

/** Maximum components tracked */
export const MAX_COMPONENTS = 10;

/** Maximum failure message length */
export const MAX_FAILURE_MESSAGE_LENGTH = 300;

/** Maximum health snapshots per user */
export const MAX_HEALTH_HISTORY = 100;

// ═══════════════════════════════════════════════════════════════
// COMPONENT HEALTH TRACKING
// ═══════════════════════════════════════════════════════════════

/**
 * Derive component health from available signals.
 * Pure function — no side effects.
 *
 * Rules:
 * - No attempt → UNKNOWN
 * - Available + recent success → HEALTHY
 * - Available + recent failure → DEGRADED
 * - Unavailable / many failures → UNAVAILABLE
 */
export function deriveComponentHealth(params: {
  available?: boolean;
  lastSuccess?: number;
  lastFailure?: number;
  lastAttempt?: number;
  consecutiveFailures?: number;
  source?: string;
  message?: string;
  now: number;
}): RuntimeHealthComponent {
  const {
    available,
    lastSuccess,
    lastFailure,
    lastAttempt,
    consecutiveFailures = 0,
    source,
    message,
    now,
  } = params;

  // Explicitly unavailable — check first so available=false is always respected
  if (available === false) {
    return {
      component: "MARKET_DATA",
      status: "UNAVAILABLE",
      lastSuccessAt: lastSuccess,
      lastFailureAt: lastFailure,
      lastAttemptAt: lastAttempt,
      consecutiveFailures,
      message: message ?? "Data unavailable",
      source,
      dataAgeMs: lastSuccess !== undefined ? now - lastSuccess : undefined,
      freshness: lastSuccess !== undefined ? classifyFreshness(now - lastSuccess) : "UNAVAILABLE",
    };
  }

  // Never attempted (and not explicitly unavailable)
  if (lastAttempt === undefined && lastSuccess === undefined && lastFailure === undefined) {
    return {
      component: "MARKET_DATA", // Caller overrides
      status: "UNKNOWN",
      consecutiveFailures: 0,
      message: message ?? "No execution observed",
      source,
      freshness: "UNKNOWN",
    };
  }

  // Too many consecutive failures
  if (consecutiveFailures >= UNAVAILABLE_FAILURE_THRESHOLD) {
    return {
      component: "MARKET_DATA",
      status: "UNAVAILABLE",
      lastSuccessAt: lastSuccess,
      lastFailureAt: lastFailure,
      lastAttemptAt: lastAttempt,
      consecutiveFailures,
      message: message ?? `${consecutiveFailures} consecutive failures`,
      source,
      dataAgeMs: lastSuccess !== undefined ? now - lastSuccess : undefined,
      freshness: lastSuccess !== undefined ? classifyFreshness(now - lastSuccess) : "UNAVAILABLE",
    };
  }

  // Recent failure (degraded)
  if (lastFailure !== undefined && (lastSuccess === undefined || lastFailure > lastSuccess)) {
    return {
      component: "MARKET_DATA",
      status: "DEGRADED",
      lastSuccessAt: lastSuccess,
      lastFailureAt: lastFailure,
      lastAttemptAt: lastAttempt,
      consecutiveFailures,
      message: message ?? "Recent failure detected",
      source,
      dataAgeMs: lastSuccess !== undefined ? now - lastSuccess : undefined,
      freshness: lastSuccess !== undefined ? classifyFreshness(now - lastSuccess) : "AGING",
    };
  }

  // Available and successful
  return {
    component: "MARKET_DATA",
    status: "HEALTHY",
    lastSuccessAt: lastSuccess,
    lastFailureAt: lastFailure,
    lastAttemptAt: lastAttempt,
    consecutiveFailures: 0,
    message: message ?? "Operating normally",
    source,
    dataAgeMs: lastSuccess !== undefined ? now - lastSuccess : undefined,
    freshness: lastSuccess !== undefined ? classifyFreshness(now - lastSuccess) : "UNKNOWN",
  };
}

/**
 * Build a full component health record with the correct component tag.
 */
export function buildComponentHealth(
  component: RuntimeComponent,
  params: {
    available?: boolean;
    lastSuccess?: number;
    lastFailure?: number;
    lastAttempt?: number;
    consecutiveFailures?: number;
    source?: string;
    message?: string;
    now: number;
  },
): RuntimeHealthComponent {
  const health = deriveComponentHealth(params);
  return { ...health, component };
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic freshness classification based on data age.
 * Pure function.
 */
export function classifyFreshness(ageMs: number): DataFreshness {
  if (ageMs < FRESH_THRESHOLD_MS) return "FRESH";
  if (ageMs < AGING_THRESHOLD_MS) return "AGING";
  return "STALE";
}

// ═══════════════════════════════════════════════════════════════
// OVERALL HEALTH CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic overall health classification.
 *
 * Rules:
 * - HEALTHY: All core components (MARKET_DATA, OHLCV, INTELLIGENCE_ENGINE) healthy
 * - DEGRADED: Any non-core component degraded/unavailable, or core component partially failing
 * - UNAVAILABLE: Any core component is UNAVAILABLE
 * - UNKNOWN: All components are UNKNOWN (no runtime observations)
 *
 * Core components: MARKET_DATA, OHLCV, INTELLIGENCE_ENGINE
 * Non-core: NEWS, MACRO, CROSS_ASSET, PORTFOLIO_INTELLIGENCE, ALERT_RULE_ENGINE,
 *           NOTIFICATION_PERSISTENCE, HISTORICAL_PERSISTENCE
 */
const CORE_COMPONENTS: RuntimeComponent[] = ["MARKET_DATA", "OHLCV", "INTELLIGENCE_ENGINE"];

export function calculateOverallHealth(
  components: RuntimeHealthComponent[],
): RuntimeHealthStatus {
  if (components.length === 0) return "UNKNOWN";

  // Check if all are UNKNOWN
  const allUnknown = components.every((c) => c.status === "UNKNOWN");
  if (allUnknown) return "UNKNOWN";

  // Check core components
  const coreComponents = components.filter((c) =>
    CORE_COMPONENTS.includes(c.component),
  );

  // Any core component UNAVAILABLE → overall UNAVAILABLE
  if (coreComponents.some((c) => c.status === "UNAVAILABLE")) {
    return "UNAVAILABLE";
  }

  // Any core component DEGRADED → overall DEGRADED
  if (coreComponents.some((c) => c.status === "DEGRADED")) {
    return "DEGRADED";
  }

  // Any non-core component DEGRADED or UNAVAILABLE → overall DEGRADED
  const nonCoreComponents = components.filter(
    (c) => !CORE_COMPONENTS.includes(c.component),
  );
  if (nonCoreComponents.some((c) => c.status === "DEGRADED" || c.status === "UNAVAILABLE")) {
    return "DEGRADED";
  }

  return "HEALTHY";
}

// ═══════════════════════════════════════════════════════════════
// HEALTH SNAPSHOT BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build a complete RuntimeHealthSnapshot from pipeline input signals.
 * Pure deterministic function — no side effects, no data fabrication.
 */
export function buildRuntimeHealthSnapshot(
  input: RuntimeHealthInput,
  now: number,
): RuntimeHealthSnapshot {
  const components: RuntimeHealthComponent[] = [];

  // 1. Market Data
  components.push(
    buildComponentHealth("MARKET_DATA", {
      available: input.marketDataAvailable,
      lastSuccess: input.marketDataLastSuccess,
      now,
      source: "Spot Prices",
      message: input.providerErrors?.["marketData"]
        ? truncateMessage(input.providerErrors["marketData"])
        : undefined,
    }),
  );

  // 2. OHLCV
  components.push(
    buildComponentHealth("OHLCV", {
      available: input.ohlcvAvailable,
      lastSuccess: input.ohlcvLastSuccess,
      now,
      source: "TwelveData",
      message: input.providerErrors?.["ohlcv"]
        ? truncateMessage(input.providerErrors["ohlcv"])
        : undefined,
    }),
  );

  // 3. News
  components.push(
    buildComponentHealth("NEWS", {
      available: input.newsAvailable,
      lastSuccess: input.newsLastSuccess,
      now,
      source: "AlphaVantage",
      message: input.providerErrors?.["news"]
        ? truncateMessage(input.providerErrors["news"])
        : undefined,
    }),
  );

  // 4. Macro
  components.push(
    buildComponentHealth("MACRO", {
      available: input.macroAvailable,
      lastSuccess: input.macroLastSuccess,
      now,
      source: "Yahoo/VIX",
      message: input.providerErrors?.["macro"]
        ? truncateMessage(input.providerErrors["macro"])
        : undefined,
    }),
  );

  // 5. Cross-Asset
  components.push(
    buildComponentHealth("CROSS_ASSET", {
      available: input.crossAssetAvailable,
      lastSuccess: input.crossAssetLastSuccess,
      now,
      source: "Multi-source",
      message: input.providerErrors?.["crossAsset"]
        ? truncateMessage(input.providerErrors["crossAsset"])
        : undefined,
    }),
  );

  // 6. Intelligence Engine
  const intelAvailable =
    input.intelligencePositionsAnalyzed !== undefined &&
    input.intelligencePositionsTotal !== undefined
      ? input.intelligencePositionsAnalyzed > 0
      : undefined;
  components.push(
    buildComponentHealth("INTELLIGENCE_ENGINE", {
      available: intelAvailable,
      lastSuccess: input.lastIntelligenceCycleAt,
      now,
      message:
        input.intelligencePositionsAnalyzed !== undefined &&
        input.intelligencePositionsTotal !== undefined
          ? `${input.intelligencePositionsAnalyzed}/${input.intelligencePositionsTotal} positions analyzed`
          : undefined,
    }),
  );

  // 7. Portfolio Intelligence
  components.push(
    buildComponentHealth("PORTFOLIO_INTELLIGENCE", {
      available: input.portfolioIntelligenceAvailable,
      lastSuccess: input.portfolioIntelligenceAvailable ? input.lastIntelligenceCycleAt : undefined,
      now,
    }),
  );

  // 8. Alert Rule Engine
  const alertAvailable =
    input.alertRulesEvaluated !== undefined ? input.alertRulesEvaluated > 0 : undefined;
  components.push(
    buildComponentHealth("ALERT_RULE_ENGINE", {
      available: alertAvailable,
      lastSuccess: input.lastIntelligenceCycleAt,
      now,
      message:
        input.alertRulesEvaluated !== undefined
          ? `${input.alertRulesEvaluated} rules evaluated, ${input.alertRulesTriggered ?? 0} triggered`
          : undefined,
    }),
  );

  // 9. Notification Persistence
  components.push(
    buildComponentHealth("NOTIFICATION_PERSISTENCE", {
      available: input.notificationPersisted,
      lastSuccess: input.notificationPersisted ? input.lastIntelligenceCycleAt : undefined,
      now,
    }),
  );

  // 10. Historical Persistence
  const histAvailable =
    input.historicalSnapshotPersisted !== undefined || input.historicalEventsPersisted !== undefined
      ? (input.historicalSnapshotPersisted ?? false) || (input.historicalEventsPersisted ?? false)
      : undefined;
  components.push(
    buildComponentHealth("HISTORICAL_PERSISTENCE", {
      available: histAvailable,
      lastSuccess:
        histAvailable ? input.lastIntelligenceCycleAt : undefined,
      now,
    }),
  );

  // Calculate overall
  const overallStatus = calculateOverallHealth(components);

  // Provider availability
  const providerAvailability: Record<string, RuntimeHealthStatus> = {};
  for (const c of components) {
    if (c.source) {
      providerAvailability[c.source] = c.status;
    }
  }

  // Stale / unavailable
  const staleComponents = components
    .filter((c) => c.freshness === "STALE" || c.freshness === "AGING")
    .map((c) => c.component);
  const unavailableComponents = components
    .filter((c) => c.status === "UNAVAILABLE")
    .map((c) => c.component);

  // Intelligence cycle status
  const intelCycle = components.find((c) => c.component === "INTELLIGENCE_ENGINE");
  const intelligenceCycleStatus = intelCycle?.status ?? "UNKNOWN";

  // Alert pipeline status
  const alertComp = components.find((c) => c.component === "ALERT_RULE_ENGINE");
  const notifComp = components.find((c) => c.component === "NOTIFICATION_PERSISTENCE");
  const alertPipelineStatus =
    alertComp?.status === "UNAVAILABLE" || notifComp?.status === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : alertComp?.status === "DEGRADED" || notifComp?.status === "DEGRADED"
        ? "DEGRADED"
        : alertComp?.status === "HEALTHY"
          ? "HEALTHY"
          : "UNKNOWN";

  // Persistence status
  const histComp = components.find((c) => c.component === "HISTORICAL_PERSISTENCE");
  const persistenceStatus =
    histComp?.status === "UNAVAILABLE" || notifComp?.status === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : histComp?.status === "DEGRADED" || notifComp?.status === "DEGRADED"
        ? "DEGRADED"
        : histComp?.status === "HEALTHY" && notifComp?.status === "HEALTHY"
          ? "HEALTHY"
          : "UNKNOWN";

  return {
    timestamp: now,
    overallStatus,
    components: components.slice(0, MAX_COMPONENTS),
    intelligenceCycleStatus,
    alertPipelineStatus,
    persistenceStatus,
    providerAvailability,
    staleComponents,
    unavailableComponents,
  };
}

// ═══════════════════════════════════════════════════════════════
// RETENTION
// ═══════════════════════════════════════════════════════════════

/**
 * Bounded retention for health snapshots.
 * Keeps newest MAX_HEALTH_HISTORY snapshots.
 */
export function applyHealthRetention(
  snapshots: Array<{ timestamp: number }>,
): Array<{ timestamp: number }> {
  if (snapshots.length <= MAX_HEALTH_HISTORY) return snapshots;
  return [...snapshots].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_HEALTH_HISTORY);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function truncateMessage(msg: string): string {
  return msg.length > MAX_FAILURE_MESSAGE_LENGTH
    ? msg.slice(0, MAX_FAILURE_MESSAGE_LENGTH) + "..."
    : msg;
}

// ═══════════════════════════════════════════════════════════════
// STATUS DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════

export const HEALTH_STATUS_COLOR: Record<RuntimeHealthStatus, string> = {
  HEALTHY: "text-emerald-400",
  DEGRADED: "text-amber-400",
  UNAVAILABLE: "text-red-400",
  UNKNOWN: "text-muted-foreground",
};

export const HEALTH_STATUS_BG: Record<RuntimeHealthStatus, string> = {
  HEALTHY: "bg-emerald-500/10",
  DEGRADED: "bg-amber-500/10",
  UNAVAILABLE: "bg-red-500/10",
  UNKNOWN: "bg-muted/30",
};

export const FRESHNESS_COLOR: Record<DataFreshness, string> = {
  FRESH: "text-emerald-400",
  AGING: "text-amber-400",
  STALE: "text-red-400",
  UNAVAILABLE: "text-red-400",
  UNKNOWN: "text-muted-foreground",
};

export const COMPONENT_LABELS: Record<RuntimeComponent, string> = {
  MARKET_DATA: "Market Data",
  OHLCV: "OHLCV Candles",
  NEWS: "News Feed",
  MACRO: "Macro / VIX",
  CROSS_ASSET: "Cross-Asset",
  INTELLIGENCE_ENGINE: "Intelligence Engine",
  PORTFOLIO_INTELLIGENCE: "Portfolio Intelligence",
  ALERT_RULE_ENGINE: "Alert Rules",
  NOTIFICATION_PERSISTENCE: "Notifications",
  HISTORICAL_PERSISTENCE: "Historical Persistence",
};
