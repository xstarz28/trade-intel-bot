/**
 * Phase 303 — deterministic provider budget orchestration (the product-lib face).
 *
 * The canonical implementation is the pure, dependency-free
 * `scripts/lib/provider-budget.mjs` — the same module the deployed-runtime
 * smoke plans its Twelve Data minute-window reservations with (exact buckets
 * first, then the catalog walk, then per-domain worst cases) and classifies the
 * provider's own failure sentences with (RATE_LIMITED vs PLAN_RESTRICTED vs
 * NO_DATA vs NOT_CONFIGURED vs PROVIDER_FAILURE).
 *
 * This typed re-export adds nothing and weakens nothing; see the module header
 * there for the live evidence (run 36954328849) and the bucket contract.
 */
export {
  PROVIDER_BUDGET_BUCKETS,
  PROVIDER_BLOCK_CLASSES,
  TWELVE_DATA_ANALYSIS_MAX_CREDITS,
  TWELVE_DATA_CREDIT_PER_REQUEST,
  TWELVE_DATA_DISCOVERY_CREDITS,
  TWELVE_DATA_MINUTE_CREDITS,
  TWELVE_DATA_WINDOW_MS,
  buildProviderBudgetPlan,
  classifyProviderBlock,
  domainBudgetBuckets,
} from "../../../scripts/lib/provider-budget.mjs";
export type {
  BudgetBucket,
  ProviderBlockClassification,
  ProviderBudgetPlan,
} from "../../../scripts/lib/provider-budget.d.mts";
