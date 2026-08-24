/**
 * Phase 15 — OPTIONAL slow-data provider orchestration (pure).
 *
 * Extracted verbatim from the Dashboard's sequential awaits so the EXACT
 * conditional-fetch policy could be proven and scheduled CONCURRENTLY.
 *
 * Guarantees preserved (Phase 7–14 policy):
 * - conditional rules per asset/style are IDENTICAL to the previous inline code;
 * - every provider leg is independent and non-fatal (failure → undefined);
 * - each provider is invoked AT MOST once per analysis (no retries);
 * - providers outside their condition are never invoked (rate-limit budget
 *   unchanged);
 * - no synthetic fallback values are ever produced.
 *
 * This module contains NO decision logic: it only decides WHEN independent
 * fetches happen, never WHAT the data means.
 */

/** Shape shared by every Convex provider action result. */
interface ProviderResult<T> {
  success: boolean;
  data?: T;
}

type CotData = import("@/types/analysis").AnalysisInput["cotData"];
type EiaData = import("@/types/analysis").AnalysisInput["eiaData"];
type TreasuryData = import("@/types/analysis").AnalysisInput["treasuryData"];
type ExecutionData = import("@/lib/execution-quality").ExecutionData;
type OkxSpecData = import("@/lib/risk/okx-spec").OkxSpecData;

export type ProviderThunk<T> = () => Promise<ProviderResult<T> | null | undefined>;

export interface SlowProviderFacts {
  instrumentType: "forex" | "crypto" | "commodity" | "stock" | "indices";
  instrument: string;
  /** Optional — treated as "intraday" (the platform default) when absent. */
  tradingStyle?: string;
  /** True when the user supplied BOTH contractSize AND quantityStep. */
  hasCompleteSpec: boolean;
}

export interface SlowProviderThunks {
  /** QUOTE→ACCOUNT FX snapshot (caller pre-computes whether conversion applies). */
  fx?: () => Promise<{
    success: boolean;
    direct?: import("@/lib/risk").FxRateSnapshot | null;
    inverse?: import("@/lib/risk").FxRateSnapshot | null;
  } | null | undefined>;
  cot?: ProviderThunk<CotData>;
  execution?: ProviderThunk<ExecutionData>;
  eia?: ProviderThunk<EiaData>;
  treasury?: ProviderThunk<TreasuryData>;
  okxSpec?: ProviderThunk<OkxSpecData>;
}

export interface SlowProviderContexts {
  fxRates?: { direct?: import("@/lib/risk").FxRateSnapshot; inverse?: import("@/lib/risk").FxRateSnapshot };
  cotData?: CotData;
  executionData?: ExecutionData;
  eiaData?: EiaData;
  treasuryData?: TreasuryData;
  okxSpecData?: OkxSpecData;
}

/** Non-fatal leg resolution: failure / non-success / absence → undefined. */
async function settleData<T>(thunk?: ProviderThunk<T>): Promise<T | undefined> {
  if (!thunk) return undefined;
  try {
    const r = await thunk();
    return r && r.success ? ((r.data as T) ?? undefined) : undefined;
  } catch {
    return undefined; // provider unavailable — disclosed by the engine, never synthesized
  }
}

const OIL_INSTRUMENT = /WTI|CRUDE|BRENT|OIL/i;

/**
 * Runs ALL applicable optional provider legs CONCURRENTLY.
 *
 * Conditional policy (verbatim from the previously sequential implementation):
 *   COT        : (forex | commodity) && style !== scalping
 *   Execution  : crypto && style !== swing
 *   EIA        : commodity && oil instrument && style !== scalping
 *   Treasury   : (forex | commodity) && style !== scalping
 *   OKX spec   : crypto && no complete explicit spec
 *   FX         : caller-determined pair (quote ≠ account currency)
 */
export async function fetchOptionalSlowData(
  facts: SlowProviderFacts,
  thunks: SlowProviderThunks,
): Promise<SlowProviderContexts> {
  const usdRelevant =
    facts.instrumentType === "forex" || facts.instrumentType === "commodity";
  const notScalping = facts.tradingStyle !== "scalping";

  const [fxRates, cotData, executionData, eiaData, treasuryData, okxSpecData] =
    await Promise.all([
      settleFx(thunks.fx),
      settleData(usdRelevant && notScalping ? thunks.cot : undefined),
      settleData(
        facts.instrumentType === "crypto" && facts.tradingStyle !== "swing"
          ? thunks.execution
          : undefined,
      ),
      settleData(
        facts.instrumentType === "commodity" &&
          OIL_INSTRUMENT.test(facts.instrument) &&
          notScalping
          ? thunks.eia
          : undefined,
      ),
      settleData(usdRelevant && notScalping ? thunks.treasury : undefined),
      settleData(
        facts.instrumentType === "crypto" && !facts.hasCompleteSpec
          ? thunks.okxSpec
          : undefined,
      ),
    ]);

  return { fxRates, cotData, executionData, eiaData, treasuryData, okxSpecData };
}

async function settleFx(
  thunk?: SlowProviderThunks["fx"],
): Promise<SlowProviderContexts["fxRates"]> {
  if (!thunk) return undefined;
  try {
    const r = await thunk();
    return r && r.success
      ? {
          direct: (r.direct ?? undefined) as import("@/lib/risk").FxRateSnapshot | undefined,
          inverse: (r.inverse ?? undefined) as import("@/lib/risk").FxRateSnapshot | undefined,
        }
      : undefined;
  } catch {
    return undefined; // conversion unavailable — sizing states it explicitly
  }
}
