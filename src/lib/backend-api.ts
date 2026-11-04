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
