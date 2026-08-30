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

// ═══════════════════════════════════════════════════════════════
// PHASE 100 — RUNTIME HEALTH EVENTS
// ═══════════════════════════════════════════════════════════════

/** Error classification for provider failures */
export type ErrorCategory =
  | "NONE"
  | "NETWORK"
  | "RATE_LIMIT"
  | "AUTH"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "UNKNOWN";

/** Maximum health event message length */
export const MAX_RUNTIME_HEALTH_MESSAGE_LENGTH = 300;

/** Maximum events in the bounded buffer */
export const MAX_RUNTIME_HEALTH_EVENTS = 200;

/**
 * A single runtime health event.
 * Records actual provider/pipeline execution outcome.
 */
export interface RuntimeHealthEvent {
  /** Which component this event relates to */
  component: RuntimeComponent;
  /** Health status observed */
  status: RuntimeHealthStatus;
  /** When this event occurred */
  timestamp: number;
  /** Provider/source name */
  source?: string;
  /** What operation was performed */
  operation?: string;
  /** How long the operation took in ms */
  durationMs?: number;
  /** Error category if failed */
  errorCategory?: ErrorCategory;
  /** Sanitized human-readable message */
  message?: string;
}

/**
 * Normalize an error into an ErrorCategory.
 * Pure function — no side effects.
 */
export function classifyError(error: unknown): ErrorCategory {
  if (!error) return "UNKNOWN";
  const msg = typeof error === "string" ? error.toLowerCase() : (error as Error)?.message?.toLowerCase?.() ?? "";

  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return "RATE_LIMIT";
  }
  if (msg.includes("timeout") || msg.includes("aborted")) {
    return "TIMEOUT";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("enotfound")) {
    return "NETWORK";
  }
  if (msg.includes("auth") || msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) {
    return "AUTH";
  }
  if (msg.includes("unavailable") || msg.includes("503") || msg.includes("502")) {
    return "PROVIDER_UNAVAILABLE";
  }
  if (msg.includes("invalid") || msg.includes("parse") || msg.includes("unexpected")) {
    return "INVALID_RESPONSE";
  }
  return "UNKNOWN";
}

/**
 * Normalize an error category into a RuntimeHealthStatus.
 * Pure function.
 */
export function errorCategoryToStatus(category: ErrorCategory): RuntimeHealthStatus {
  switch (category) {
    case "NONE":
      return "HEALTHY";
    case "RATE_LIMIT":
    case "TIMEOUT":
    case "NETWORK":
      return "DEGRADED";
    case "AUTH":
    case "PROVIDER_UNAVAILABLE":
      return "UNAVAILABLE";
    case "INVALID_RESPONSE":
    case "UNKNOWN":
    default:
      return "DEGRADED";
  }
}

/**
 * Create a RuntimeHealthEvent from an actual execution outcome.
 * Pure deterministic function — only records what actually happened.
 */
export function normalizeRuntimeHealthEvent(params: {
  component: RuntimeComponent;
  source?: string;
  operation?: string;
  success: boolean;
  durationMs?: number;
  error?: unknown;
  message?: string;
  timestamp?: number;
}): RuntimeHealthEvent {
  const { component, source, operation, success, durationMs, error, message, timestamp } = params;

  if (success) {
    return {
      component,
      status: "HEALTHY",
      timestamp: timestamp ?? Date.now(),
      source,
      operation,
      durationMs,
      errorCategory: "NONE",
      message: message ? truncateEventMessage(message) : "Operation successful",
    };
  }

  const errorCategory = classifyError(error);
  const status = errorCategoryToStatus(errorCategory);
  const sanitizedMsg = message
    ? truncateEventMessage(message)
    : truncateEventMessage(`Failed: ${String(error).slice(0, 100)}`);

  return {
    component,
    status,
    timestamp: timestamp ?? Date.now(),
    source,
    operation,
    durationMs,
    errorCategory,
    message: sanitizedMsg,
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH AGGREGATION FROM EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Aggregate runtime health events into component health records.
 * Uses the most recent relevant event per component.
 * Pure deterministic function.
 *
 * Precedence:
 * - Most recent event wins
 * - If most recent is SUCCESS → component HEALTHY
 * - If most recent is FAILURE → component DEGRADED/UNAVAILABLE per error category
 * - If no events for component → UNKNOWN
 * - Old events are not treated as current health
 */
export function aggregateRuntimeHealth(
  events: RuntimeHealthEvent[],
  now: number,
): RuntimeHealthComponent[] {
  const components: RuntimeComponent[] = [
    "MARKET_DATA", "OHLCV", "NEWS", "MACRO", "CROSS_ASSET",
    "INTELLIGENCE_ENGINE", "PORTFOLIO_INTELLIGENCE",
    "ALERT_RULE_ENGINE", "NOTIFICATION_PERSISTENCE", "HISTORICAL_PERSISTENCE",
  ];

  return components.map((component) => {
    const componentEvents = events
      .filter((e) => e.component === component)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (componentEvents.length === 0) {
      return {
        component,
        status: "UNKNOWN" as RuntimeHealthStatus,
        consecutiveFailures: 0,
        message: "No runtime execution observed",
        freshness: "UNKNOWN" as DataFreshness,
      };
    }

    const latest = componentEvents[0];
    const lastSuccess = componentEvents.find((e) => e.status === "HEALTHY");
    const lastFailure = componentEvents.find((e) => e.status !== "HEALTHY");

    // Count consecutive failures from most recent
    let consecutiveFailures = 0;
    for (const evt of componentEvents) {
      if (evt.status === "HEALTHY") break;
      consecutiveFailures++;
    }

    const dataAgeMs = lastSuccess ? now - lastSuccess.timestamp : undefined;
    const freshness = dataAgeMs !== undefined ? classifyFreshness(dataAgeMs) : "UNKNOWN" as DataFreshness;

    // Truncate consecutive failures message
    const msg = latest.message ?? (latest.status === "HEALTHY" ? "Operating normally" : "Recent failure");

    return {
      component,
      status: latest.status,
      lastSuccessAt: lastSuccess?.timestamp,
      lastFailureAt: lastFailure?.timestamp,
      lastAttemptAt: latest.timestamp,
      consecutiveFailures,
      message: truncateEventMessage(msg),
      source: latest.source,
      dataAgeMs,
      freshness,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// HEALTH TRANSITION DETECTION
// ═══════════════════════════════════════════════════════════════

export interface HealthTransition {
  component: RuntimeComponent;
  previous: RuntimeHealthStatus;
  current: RuntimeHealthStatus;
  timestamp: number;
}

/**
 * Detect health transitions between two snapshots.
 * Pure deterministic function.
 */
export function detectHealthTransitions(
  previous: RuntimeHealthSnapshot,
  current: RuntimeHealthSnapshot,
): HealthTransition[] {
  const transitions: HealthTransition[] = [];
  const prevMap = new Map(previous.components.map((c) => [c.component, c.status]));

  for (const comp of current.components) {
    const prevStatus = prevMap.get(comp.component);
    if (prevStatus && prevStatus !== comp.status) {
      transitions.push({
        component: comp.component,
        previous: prevStatus,
        current: comp.status,
        timestamp: current.timestamp,
      });
    }
  }

  return transitions;
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic decision: should we persist this health snapshot?
 *
 * Persist when:
 * - first valid snapshot (no previous)
 * - overall status changed
 * - any component status changed
 * - core provider changed state
 * - intelligence cycle health changed
 * - recovery from failure
 *
 * Skip when:
 * - state is materially identical
 * - only timestamps changed
 */
export function shouldPersistRuntimeHealth(
  previous: RuntimeHealthSnapshot | null | undefined,
  current: RuntimeHealthSnapshot,
): boolean {
  // First valid snapshot
  if (!previous) return true;

  // Overall status changed
  if (previous.overallStatus !== current.overallStatus) return true;

  // Component status changes
  const prevCompMap = new Map(previous.components.map((c) => [c.component, c.status]));
  for (const comp of current.components) {
    const prevStatus = prevCompMap.get(comp.component);
    if (prevStatus !== comp.status) return true;
  }

  // Intelligence cycle status changed
  if (previous.intelligenceCycleStatus !== current.intelligenceCycleStatus) return true;

  // Alert pipeline status changed
  if (previous.alertPipelineStatus !== current.alertPipelineStatus) return true;

  // Persistence status changed
  if (previous.persistenceStatus !== current.persistenceStatus) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function truncateEventMessage(msg: string): string {
  return msg.length > MAX_RUNTIME_HEALTH_MESSAGE_LENGTH
    ? msg.slice(0, MAX_RUNTIME_HEALTH_MESSAGE_LENGTH) + "..."
    : msg;
}
