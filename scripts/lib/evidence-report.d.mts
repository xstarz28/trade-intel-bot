/**
 * Type declarations for the canonical Evidence D report schema (Phase 208).
 *
 * The harness is plain ESM so it can run under bare `node` with no build step,
 * but the guard tests are TypeScript. These declarations give the tests real
 * types instead of an `any` cast, so a shape change in the schema surfaces as a
 * type error rather than silently weakening an assertion.
 */

export type CanonicalStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_VERIFIED" | "UNKNOWN";

export const CANONICAL_STATUSES: CanonicalStatus[];

export interface Definition {
  id: string;
  title?: string;
}

export interface RecordedCheck {
  id?: string;
  title?: string;
  status?: unknown;
  detail?: unknown;
  evidence?: unknown;
}

export interface CanonicalRow {
  id: string;
  title: string;
  status: CanonicalStatus;
  detail: string;
  evidence: unknown;
  recordedCount: number;
}

export interface Integrity {
  expected: number;
  rendered: number;
  missing: string[];
  duplicated: string[];
  unrecognised: { id: string; raw: string }[];
  extras: string[];
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notVerified: number;
  unknown: number;
}

export interface ProviderAttempt {
  provider: string;
  dataset: string;
  instrument: string | null;
  access: string;
  basis: string;
  acquired: boolean;
  observedAt: number | null;
  acquisition: string | null;
  failure: string | null;
  startedAt?: number;
  finishedAt?: number;
}

export interface SweepCandidate {
  instrument?: string;
  instType?: string | null;
  status?: string | null;
  recommendation?: string | null;
  consumed?: number;
  note?: string;
  error?: string | null;
}

export interface ChargeableFind {
  instrument: string;
  recommendation: string;
  consumed: number;
}

export interface Blocker {
  track: "D" | "E" | "MARKET";
  id: string;
  status: CanonicalStatus;
  classification: string;
  title: string;
  reason: string;
}

export interface EvidenceReport {
  schemaVersion: string;
  evidenceD: "ACHIEVED" | "INCOMPLETE" | "FAILED" | "NOT EXECUTED";
  evidenceClass: string;
  notExecutedReason: string | null;
  environment: string;
  deployment: { host: string | null; name: string | null; declared: string | null };
  productionEvidence: boolean;
  configSource: string | null;
  authMechanism: string;
  capturedAt: string | null;
  durationMs: number;
  transportCalls: number;
  summary: Summary;
  integrity: Integrity;
  checks: CanonicalRow[];
  providerEvidence: { attempts: ProviderAttempt[]; note: string };
  sweep: {
    limit: number;
    attempted: number;
    candidates: SweepCandidate[];
    chargeableFind: ChargeableFind | null;
    marketLimitation: string | null;
  };
  entitlementStateMachine: {
    verdict: "VERIFIED" | "INCOMPLETE" | "FAILED" | "NOT EXECUTED";
    note: string;
    summary: Summary;
    checks: CanonicalRow[];
  };
  safetyProbes: unknown;
  blockers: Blocker[];
}

export interface BuildReportInput {
  definitions?: Definition[];
  checks?: RecordedCheck[];
  entitlementDefinitions?: Definition[];
  entitlementChecks?: RecordedCheck[];
  environment?: string;
  deployment?: { host?: string | null; name?: string | null; declared?: string | null };
  evidenceClass?: string;
  claimsProduction?: boolean;
  authMechanism?: string;
  configSource?: string | null;
  capturedAt?: string | null;
  durationMs?: number;
  transportCalls?: number;
  providerAttempts?: ProviderAttempt[];
  sweepLog?: SweepCandidate[];
  chargeableFind?: ChargeableFind | null;
  sweepLimit?: number;
  safetyProbes?: unknown;
  executed?: boolean;
  notExecutedReason?: string | null;
}

export function canonicalStatus(raw: unknown): CanonicalStatus;
export function isPass(raw: unknown): boolean;
export function canonicalRows(
  definitions: Definition[],
  recorded: RecordedCheck[],
): { rows: CanonicalRow[]; integrity: Integrity };
export function summarize(rows: { status?: unknown }[]): Summary;
export function collectBlockers(
  dRows: CanonicalRow[],
  eRows: CanonicalRow[],
  market: { note?: string } | null,
): Blocker[];
export function buildReport(input: BuildReportInput): EvidenceReport;
export function renderHumanReport(report: EvidenceReport): string[];
