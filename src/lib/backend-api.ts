/**
 * Typed client for the self-hosted Trade Intel API.
 *
 * Requests include browser credentials so the backend's HttpOnly session cookie
 * is used automatically. The client deliberately does not silently fall back
 * to Convex or local mock storage: callers must handle API failures explicitly.
 */

export interface BackendUser {
  id: string;
  name: string;
  image?: string | null;
  email?: string | null;
  isAnonymous: boolean;
  role: string;
}

export interface BackendSession {
  user: BackendUser | null;
}

export interface BackendJournalRecord {
  _id: string;
  _creationTime: number;
  instrument: string;
  instrumentType: string;
  timeframe: string;
  style: string;
  analysisSnapshot: Record<string, unknown>;
  status: string;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskReward?: number | null;
  positionSize?: number | null;
  notionalValue?: number | null;
  exitPrice?: number | null;
  pnl?: number | null;
  pnlPercent?: number | null;
  outcome?: string | null;
  closedAt?: number | null;
  entryReason?: string | null;
  thesisAtEntry?: string | null;
  confirmationObserved?: string | null;
  invalidationObserved?: string | null;
  whatWentRight?: string | null;
  whatWentWrong?: string | null;
  lessons?: string | null;
  notes?: string | null;
  timestamps: { createdAt: number; updatedAt: number };
}

export type CreateBackendJournalEntry = Pick<
  BackendJournalRecord,
  "instrument" | "instrumentType" | "timeframe" | "style" | "analysisSnapshot"
> & Partial<Pick<
  BackendJournalRecord,
  "status" | "entry" | "stopLoss" | "takeProfit" | "riskReward" |
  "positionSize" | "notionalValue" | "entryReason" | "thesisAtEntry" | "notes"
>>;

export interface BackendAccountExport {
  format: "trade-intel-account-export";
  version: 1;
  exportedAt: string;
  account: {
    id: string;
    name: string | null;
    email: string | null;
    isAnonymous: boolean;
    role: string;
  };
  data: Record<string, Record<string, unknown>[]>;
  counts: Record<string, number>;
}

export interface BackendAnalysisRecord {
  _id: string;
  _creationTime: number;
  instrument: string;
  instrumentType: string;
  timeframe: string;
  bias: string;
  confidence: number;
  recommendation?: string | null;
  conviction?: string | null;
  noTradeReasons?: string[] | null;
  riskReward?: number | null;
  tradingStyle?: string | null;
  technicalSummary: string;
  fundamentalSummary: string;
  breakdown: { trend: number; indicator: number; fundamental: number; sentiment: number };
  keyLevels: { support: string; resistance: string; invalidation: string };
  riskNote: string;
  dataCompleteness: string;
  dataFlags: string[];
  price?: number | null;
  dataSource?: string | null;
  sentimentSummary?: string | null;
  sentimentScore?: number | null;
  macroSummary?: string | null;
  derivativesSummary?: string | null;
  calendarSummary?: string | null;
  timestamp: number;
}

export type SaveBackendAnalysis = Omit<
  BackendAnalysisRecord,
  "_id" | "_creationTime" | "timestamp"
> & { timestamp?: number };

export class BackendApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "BackendApiError";
    this.status = status;
    this.code = code;
  }
}

const configuredBase = import.meta.env.VITE_BACKEND_URL?.trim() ?? "";
const API_BASE = configuredBase.replace(/\/$/, "");

export async function backendRequest<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  const response = await fetchImpl(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      payload && typeof payload.error === "string" ? payload.error : "backend_request_failed";
    throw new BackendApiError(response.status, code);
  }
  return payload as T;
}

export function getBackendSession(fetchImpl?: typeof fetch) {
  return backendRequest<BackendSession>("/api/v1/auth/session", {}, fetchImpl);
}

export function createAnonymousBackendSession(fetchImpl?: typeof fetch) {
  return backendRequest<{ user: BackendUser }>(
    "/api/v1/auth/anonymous",
    { method: "POST", body: "{}" },
    fetchImpl,
  );
}

export function logoutBackendSession(fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    "/api/v1/auth/logout",
    { method: "POST", body: "{}" },
    fetchImpl,
  );
}

export function listBackendAnalyses(fetchImpl?: typeof fetch) {
  return backendRequest<{ items: BackendAnalysisRecord[] }>("/api/v1/analyses", {}, fetchImpl);
}

export function saveBackendAnalysis(
  analysis: SaveBackendAnalysis,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendAnalysisRecord }>(
    "/api/v1/analyses",
    { method: "POST", body: JSON.stringify(analysis) },
    fetchImpl,
  );
}

export function clearBackendAnalyses(fetchImpl?: typeof fetch) {
  return backendRequest<{ deleted: number }>("/api/v1/analyses", { method: "DELETE" }, fetchImpl);
}

/** Starts the backend-managed Google OAuth flow in the current browser tab. */
export function getBackendGoogleSignInUrl() {
  return `${API_BASE}/api/v1/auth/google`;
}

/** Restores a previously downloaded Trade Intel account export. */
export function importBackendAccount(
  payload: BackendAccountExport,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{
    success: boolean;
    accountId: string;
    inserted: Record<string, number>;
    skipped: Record<string, number>;
    totalInserted: number;
    totalSkipped: number;
  }>("/api/v1/account/import", {
    method: "POST",
    body: JSON.stringify(payload),
  }, fetchImpl);
}

/** Downloads the authenticated user's portable account data as structured JSON. */
export function exportBackendAccount(fetchImpl?: typeof fetch) {
  return backendRequest<BackendAccountExport>("/api/v1/account/export", {}, fetchImpl);
}


/** Lists the authenticated user's persisted journal entries. */
export function listBackendJournal(
  filters: { instrument?: string; status?: string } = {},
  fetchImpl?: typeof fetch,
) {
  const params = new URLSearchParams();
  if (filters.instrument) params.set("instrument", filters.instrument);
  if (filters.status) params.set("status", filters.status);
  const suffix = params.size ? `?${params.toString()}` : "";
  return backendRequest<{ items: BackendJournalRecord[] }>(
    `/api/v1/journal${suffix}`, {}, fetchImpl,
  );
}

/** Creates a journal record with an immutable analysis snapshot. */
export function createBackendJournalEntry(
  entry: CreateBackendJournalEntry,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendJournalRecord }>(
    "/api/v1/journal", { method: "POST", body: JSON.stringify(entry) }, fetchImpl,
  );
}

/** Updates mutable journal review and trade fields. */
export function updateBackendJournalEntry(
  id: string,
  patch: Partial<Pick<BackendJournalRecord,
    "entry" | "stopLoss" | "takeProfit" | "riskReward" | "positionSize" |
    "notionalValue" | "entryReason" | "thesisAtEntry" | "confirmationObserved" |
    "invalidationObserved" | "whatWentRight" | "whatWentWrong" | "lessons" | "notes"
  >>,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendJournalRecord }>(
    `/api/v1/journal/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) }, fetchImpl,
  );
}

/** Applies a validated journal lifecycle transition. */
export function transitionBackendJournalEntry(
  id: string,
  transition: { newStatus: string; exitPrice?: number; pnl?: number; pnlPercent?: number; outcome?: string },
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendJournalRecord }>(
    `/api/v1/journal/${encodeURIComponent(id)}/transition`,
    { method: "PATCH", body: JSON.stringify(transition) }, fetchImpl,
  );
}

/** Deletes one journal record owned by the current backend account. */
export function deleteBackendJournalEntry(id: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/journal/${encodeURIComponent(id)}`, { method: "DELETE" }, fetchImpl,
  );
}


export interface BackendPosition {
  _id: string;
  positionId: string;
  instrument: string;
  side: string;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number | null;
  horizon: string;
  openedAt: number;
  peakPrice: number | null;
  peakProfit: number | null;
  currentSeverity: string;
  lifecycleState: string;
  monitoringLifecycle: string;
  lastUpdateAt: number;
  lastAlertAt: number;
  consecutiveSameSeverity: number;
}

export type SaveBackendPosition = Omit<BackendPosition, "_id">;

export interface BackendPositionAlert {
  _id: string;
  alertId: string;
  positionId: string;
  instrument: string;
  severity: string;
  notificationPriority: string;
  reason: string;
  action: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface BackendAlertRule {
  _id: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  scope: string;
  instrument: string | null;
  positionId: string | null;
  condition: string;
  severity: string;
  cooldownMs: number;
  createdAt: number;
  updatedAt: number;
}

export type CreateBackendAlertRule = Pick<
  BackendAlertRule,
  "ruleId" | "name" | "enabled" | "scope" | "condition" | "severity" | "cooldownMs"
> & Partial<Pick<BackendAlertRule, "instrument" | "positionId">>;

export interface BackendNotification {
  _id: string;
  notificationId: string;
  alertIdentity: string;
  ruleId: string;
  ruleName: string;
  timestamp: number;
  instrument: string | null;
  positionId: string | null;
  side: string | null;
  severity: string;
  title: string;
  message: string;
  category: string;
  impact: string;
  read: boolean;
  dismissed: boolean;
  source: string;
  condition: string;
}

export interface BackendNotificationPreferences {
  minimumSeverity: string;
  enabledCategories: string[];
  enabledScopes: string[];
  mutedRuleIds: string[];
  enabledInstruments: string[];
  mutedInstruments: string[];
  showReadNotifications: boolean;
  showDismissedNotifications: boolean;
}

export function listBackendPositions(fetchImpl?: typeof fetch) {
  return backendRequest<{ items: BackendPosition[] }>("/api/v1/positions", {}, fetchImpl);
}

export function saveBackendPosition(position: SaveBackendPosition, fetchImpl?: typeof fetch) {
  return backendRequest<{ item: BackendPosition }>("/api/v1/positions", {
    method: "POST", body: JSON.stringify(position),
  }, fetchImpl);
}

export function getBackendPosition(positionId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ item: BackendPosition }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}`, {}, fetchImpl,
  );
}

export function deleteBackendPosition(positionId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}`, { method: "DELETE" }, fetchImpl,
  );
}

export function listBackendPositionAlerts(
  positionId: string,
  limit = 50,
  fetchImpl?: typeof fetch,
) {
  const params = new URLSearchParams({ limit: String(limit) });
  return backendRequest<{ items: BackendPositionAlert[] }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/alerts?${params.toString()}`, {}, fetchImpl,
  );
}

export function saveBackendPositionAlert(
  positionId: string,
  alert: Omit<BackendPositionAlert, "_id" | "positionId"> & { positionId?: string },
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendPositionAlert }>(
    `/api/v1/positions/${encodeURIComponent(positionId)}/alerts`,
    { method: "POST", body: JSON.stringify(alert) }, fetchImpl,
  );
}

export function acknowledgeBackendAlert(alertId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    { method: "POST", body: "{}" }, fetchImpl,
  );
}

export function listBackendAlertRules(fetchImpl?: typeof fetch) {
  return backendRequest<{ items: BackendAlertRule[] }>("/api/v1/alert-rules", {}, fetchImpl);
}

export function createBackendAlertRule(rule: CreateBackendAlertRule, fetchImpl?: typeof fetch) {
  return backendRequest<{ item: BackendAlertRule }>("/api/v1/alert-rules", {
    method: "POST", body: JSON.stringify(rule),
  }, fetchImpl);
}

export function updateBackendAlertRule(
  ruleId: string,
  patch: Partial<Pick<BackendAlertRule, "name" | "enabled" | "severity" | "cooldownMs">>,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendAlertRule }>(
    `/api/v1/alert-rules/${encodeURIComponent(ruleId)}`,
    { method: "PATCH", body: JSON.stringify(patch) }, fetchImpl,
  );
}

export function deleteBackendAlertRule(ruleId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/alert-rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" }, fetchImpl,
  );
}

export function listBackendNotifications(limit = 100, fetchImpl?: typeof fetch) {
  const params = new URLSearchParams({ limit: String(limit) });
  return backendRequest<{ items: BackendNotification[] }>(
    `/api/v1/notifications?${params.toString()}`, {}, fetchImpl,
  );
}

export function listBackendUnreadNotifications(fetchImpl?: typeof fetch) {
  return backendRequest<{ items: BackendNotification[] }>("/api/v1/notifications/unread", {}, fetchImpl);
}

export function getBackendUnreadNotificationCount(fetchImpl?: typeof fetch) {
  return backendRequest<{ count: number }>("/api/v1/notifications/unread-count", {}, fetchImpl);
}

export function markBackendNotificationRead(notificationId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST", body: "{}" }, fetchImpl,
  );
}

export function dismissBackendNotification(notificationId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ success: boolean }>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/dismiss`,
    { method: "POST", body: "{}" }, fetchImpl,
  );
}

export function markAllBackendNotificationsRead(fetchImpl?: typeof fetch) {
  return backendRequest<{ updated: number }>(
    "/api/v1/notifications/read-all", { method: "POST", body: "{}" }, fetchImpl,
  );
}

export function getBackendNotificationPreferences(fetchImpl?: typeof fetch) {
  return backendRequest<{ preferences: BackendNotificationPreferences }>(
    "/api/v1/notification-preferences", {}, fetchImpl,
  );
}

export function saveBackendNotificationPreferences(
  preferences: BackendNotificationPreferences,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ preferences: BackendNotificationPreferences }>(
    "/api/v1/notification-preferences",
    { method: "PUT", body: JSON.stringify(preferences) }, fetchImpl,
  );
}

export function resetBackendNotificationPreferences(fetchImpl?: typeof fetch) {
  return backendRequest<{ preferences: BackendNotificationPreferences }>(
    "/api/v1/notification-preferences", { method: "DELETE" }, fetchImpl,
  );
}


export interface BackendHistorySnapshot {
  _id: string;
  positionId: string;
  instrument: string;
  side: string;
  timestamp: number;
  thesisState: string;
  evidenceQuality: string;
  marketRegime: string;
  h1Trend: string;
  m15Trend: string;
  m5Trend: string;
  mtfAlignment: string;
  momentum: string;
  volatility: string;
  structure: string;
  supportingCount: number;
  conflictingCount: number;
  invalidationCondition: string;
  watchNext: string;
  dataAvailability: string;
}

export interface BackendHistoryEvent {
  _id: string;
  positionId: string;
  instrument: string;
  side: string;
  timestamp: number;
  eventType: string;
  description: string;
  previousState: string;
  currentState: string;
  category: string;
  strength: string;
}

export interface BackendHistoryTimeline {
  positionId: string;
  latestSnapshot: BackendHistorySnapshot | null;
  previousSnapshot: BackendHistorySnapshot | null;
  events: BackendHistoryEvent[];
}

export interface BackendRuntimeHealth {
  _id: string;
  timestamp: number;
  overallStatus: string;
  components: Array<{
    component: string;
    status: string;
    lastSuccessAt?: number;
    lastFailureAt?: number;
    lastAttemptAt?: number;
    consecutiveFailures: number;
    message: string;
    source?: string;
    dataAgeMs?: number;
    freshness: string;
  }>;
  intelligenceCycleStatus: string;
  alertPipelineStatus: string;
  persistenceStatus: string;
  providerAvailability: Record<string, string>;
  staleComponents: string[];
  unavailableComponents: string[];
}

export type SaveBackendRuntimeHealth = Omit<BackendRuntimeHealth, "_id">;

export function saveBackendHistorySnapshot(
  snapshot: Omit<BackendHistorySnapshot, "_id">,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ id: string; pruned: number }>("/api/v1/history/snapshots", {
    method: "POST", body: JSON.stringify(snapshot),
  }, fetchImpl);
}

export function saveBackendHistoryEvents(
  input: { positionId: string; instrument: string; side: string; events: Array<Omit<BackendHistoryEvent, "_id" | "positionId" | "instrument" | "side">> },
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ ids: string[]; inserted: number; pruned: number }>(
    "/api/v1/history/events", { method: "POST", body: JSON.stringify(input) }, fetchImpl,
  );
}

export function getBackendHistoryTimeline(positionId: string, fetchImpl?: typeof fetch) {
  const params = new URLSearchParams({ positionId });
  return backendRequest<BackendHistoryTimeline>(
    `/api/v1/history/timeline?${params.toString()}`, {}, fetchImpl,
  );
}

export function deleteBackendPositionHistory(positionId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ deleted: number }>(
    `/api/v1/history/positions/${encodeURIComponent(positionId)}`, { method: "DELETE" }, fetchImpl,
  );
}

export function pruneBackendPositionHistory(positionId: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ pruned: number }>("/api/v1/history/prune", {
    method: "POST", body: JSON.stringify({ positionId }),
  }, fetchImpl);
}

export function getLatestBackendRuntimeHealth(fetchImpl?: typeof fetch) {
  return backendRequest<{ item: BackendRuntimeHealth | null }>("/api/v1/runtime-health/latest", {}, fetchImpl);
}

export function listBackendRuntimeHealth(limit = 20, fetchImpl?: typeof fetch) {
  const params = new URLSearchParams({ limit: String(limit) });
  return backendRequest<{ items: BackendRuntimeHealth[] }>(
    `/api/v1/runtime-health/history?${params.toString()}`, {}, fetchImpl,
  );
}

export function saveBackendRuntimeHealth(
  snapshot: SaveBackendRuntimeHealth,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ id: string; deduplicated?: boolean }>("/api/v1/runtime-health", {
    method: "POST", body: JSON.stringify(snapshot),
  }, fetchImpl);
}


export interface BackendRuleAlertHistory {
  _id: string;
  alertId: string;
  ruleId: string;
  ruleName: string;
  positionId: string | null;
  instrument: string | null;
  condition: string;
  severity: string;
  description: string;
  previousState: string | null;
  currentState: string | null;
  timestamp: number;
}

export interface BackendStreamCursor {
  _id: string;
  provider: string;
  instrument: string;
  lastEventId: string;
  lastTimestamp: number;
  lastSequence: number | null;
}

export type SaveBackendRuleAlertHistory = Omit<BackendRuleAlertHistory, "_id">;
export type SaveBackendStreamCursor = Omit<BackendStreamCursor, "_id">;

export function listBackendRuleAlertHistory(limit = 50, fetchImpl?: typeof fetch) {
  const params = new URLSearchParams({ limit: String(limit) });
  return backendRequest<{ items: BackendRuleAlertHistory[] }>(
    `/api/v1/alert-rules/history?${params.toString()}`, {}, fetchImpl,
  );
}

export function saveBackendRuleAlertHistory(
  alert: SaveBackendRuleAlertHistory,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ item: BackendRuleAlertHistory }>(
    "/api/v1/alert-rules/history", { method: "POST", body: JSON.stringify(alert) }, fetchImpl,
  );
}

export function clearBackendRuleAlertHistory(fetchImpl?: typeof fetch) {
  return backendRequest<{ deleted: number }>(
    "/api/v1/alert-rules/history", { method: "DELETE" }, fetchImpl,
  );
}

export function getBackendStreamCursor(
  provider: string,
  instrument: string,
  fetchImpl?: typeof fetch,
) {
  const params = new URLSearchParams({ provider, instrument });
  return backendRequest<{ item: BackendStreamCursor | null }>(
    `/api/v1/stream-cursors?${params.toString()}`, {}, fetchImpl,
  );
}

export function saveBackendStreamCursor(
  cursor: SaveBackendStreamCursor,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<{ success: boolean }>(
    "/api/v1/stream-cursors", { method: "PUT", body: JSON.stringify(cursor) }, fetchImpl,
  );
}


export interface BackendMarketAnalysisInput {
  instrument: string;
  instrumentType: "crypto" | "stock" | "forex" | "commodity" | "indices";
  timeframe: string;
  tradingStyle?: string;
}

/** Runs the shared decision engine through the authenticated self-hosted API. */
export function analyzeBackendMarket(
  input: BackendMarketAnalysisInput,
  fetchImpl?: typeof fetch,
) {
  return backendRequest<import("@/types/analysis").AnalysisResult>(
    "/api/v1/market-data/analyze",
    { method: "POST", body: JSON.stringify(input) },
    fetchImpl,
  );
}


export interface BackendSecObservation {
  ticker: string;
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  acceptanceDateTime: string | null;
  fiscalPeriodStart: string;
  fiscalPeriodEnd: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  eps: number | null;
  revenue: number | null;
  epsTag: string | null;
  revenueTag: string | null;
  sourceUrl: string;
  firstObservedAt: number;
  lastRetrievedAt: number;
  filingDateSemantics: string;
}

export function getBackendSecFundamentals(ticker: string, fetchImpl?: typeof fetch) {
  return backendRequest<{ ticker: string; items: BackendSecObservation[] }>(
    `/api/v1/fundamentals/sec/${encodeURIComponent(ticker.trim().toUpperCase())}`, {}, fetchImpl,
  );
}

export function refreshBackendSecFundamentals(ticker: string, fetchImpl?: typeof fetch) {
  return backendRequest<{
    success: boolean;
    status: string;
    ticker: string;
    cik: string;
    observationCount: number;
    newlyPersistedCount: number;
    items: BackendSecObservation[];
  }>(
    `/api/v1/fundamentals/sec/${encodeURIComponent(ticker.trim().toUpperCase())}`,
    { method: "POST", body: "{}" }, fetchImpl,
  );
}
