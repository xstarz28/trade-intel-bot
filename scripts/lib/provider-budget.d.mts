/**
 * Phase 303 — deterministic provider budget orchestration (type surface).
 * See provider-budget.mjs for the live evidence (run 36954328849) and the
 * bucket contract.
 */
export declare const TWELVE_DATA_CREDIT_PER_REQUEST: number;
export declare const TWELVE_DATA_DISCOVERY_CREDITS: number;
export declare const TWELVE_DATA_MINUTE_CREDITS: number;
export declare const TWELVE_DATA_WINDOW_MS: number;
export declare const TWELVE_DATA_ANALYSIS_MAX_CREDITS: number;
export declare const PROVIDER_BUDGET_BUCKETS: Readonly<{
  EXACT: "exact-verification";
  DISCOVERY: "catalog-discovery";
  DOMAIN_ANALYSIS: "domain-analysis";
}>;
export declare const PROVIDER_BLOCK_CLASSES: Readonly<{
  RATE_LIMITED: "RATE_LIMITED";
  PLAN_RESTRICTED: "PLAN_RESTRICTED";
  NO_DATA: "NO_DATA";
  NOT_CONFIGURED: "NOT_CONFIGURED";
  PROVIDER_FAILURE: "PROVIDER_FAILURE";
}>;

export type ProviderBlockClass = "RATE_LIMITED" | "PLAN_RESTRICTED" | "NO_DATA" | "NOT_CONFIGURED" | "PROVIDER_FAILURE";
export type ProviderBudgetBucket = "exact-verification" | "catalog-discovery" | "domain-analysis";

export interface ProviderBlockClassification {
  class: ProviderBlockClass;
  evidence: string;
}

export interface BudgetBucket {
  bucket: ProviderBudgetBucket;
  label: string;
  credits: number;
  windows: number;
}

export interface ProviderBudgetPlan {
  windowCredits: number;
  buckets: BudgetBucket[];
  totalModelledCredits: number;
  estimatedWindows: number;
  order: string[];
  invariant: string;
}

export declare function classifyProviderBlock(reason: unknown): ProviderBlockClassification | null;
export declare function buildProviderBudgetPlan(options?: {
  minuteCredits?: number;
  discoveryCredits?: number;
  analysisCredits?: number;
  exactSpecs?: Array<{ provider?: string; providerInstrumentId?: string }>;
  domainLabels?: string[];
  maxAttempts?: number;
}): ProviderBudgetPlan;
export declare function domainBudgetBuckets(options?: {
  domainLabels?: string[];
  analysisCredits?: number;
  maxAttempts?: number;
  minuteCredits?: number;
}): BudgetBucket[];
