/**
 * Phase 312 addendum — the SIGNAL RESPONSE: one coherent object that carries
 * CHART + WHY + TRADE PLAN + POSITION MECHANICS + RISK + PROBABILITY STATUS +
 * INVALIDATION + LIMITATIONS for a finished analysis.
 *
 * Architecture rules:
 *  · consumes the EXISTING analysis engine result — no second engine, no
 *    double scoring (this layer is read-only over the finished result);
 *  · every number is JSON-safe and deterministic over its inputs;
 *  · missing data is reported as missing (never neutralised, never invented);
 *  · no guaranteed-profit language exists anywhere in this layer.
 */

import type { AnalysisResult } from "@/types/analysis";
import type { OhlcvCandle } from "../data/market-types";
import type { InstrumentSpec } from "../risk";
import { buildSignalChart, type SignalChartSpec } from "./chart";
import { buildAdaptiveTradePlan, type AdaptiveTradePlan } from "./trade-plan";
import {
  assessHistoricalProbability,
  type HistoricalOutcomeRecord,
  type ProbabilityAssessment,
} from "./probability";
import { buildPositionMechanics, type ContractMeta, type PositionMechanics, type SizingSpec } from "./position";
import { normalizeRiskPolicy, type NormalizedRiskPolicy, type RiskPolicyInput } from "./policy";

export const NO_GUARANTEE_NOTE =
  "Factual analysis output — not financial advice. Nothing in this response promises profit; historical figures describe recorded outcomes only, and probabilities are never claimed without them.";

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface SignalWhySection {
  heading: string;
  lines: string[];
}

export interface SignalResponse {
  available: boolean;
  unavailableReason?: string;
  instrument: string;
  instrumentType: string;
  timeframe: string;
  direction?: "long" | "short";
  provider?: string;
  providerInstrumentId?: string;
  observedAt?: number;
  chart: SignalChartSpec;
  why: SignalWhySection[];
  plan: AdaptiveTradePlan;
  probability: ProbabilityAssessment;
  position: PositionMechanics;
  risk: {
    policyConfigured: boolean;
    riskAmount?: number;
    riskPercent?: number;
    accountCurrency?: string;
    note: string;
  };
  invalidation: {
    condition: string;
    level?: number;
    timeframe?: string;
  };
  limitations: string[];
  noGuaranteeNote: string;
}

export function buildSignalResponse(args: {
  result: AnalysisResult;
  candles: OhlcvCandle[];
  provider?: string;
  providerInstrumentId?: string;
  policy?: RiskPolicyInput;
  spec?: SizingSpec;
  contractMeta?: ContractMeta;
  /** Recorded journal outcomes, when the caller has them (UI/journal path). */
  historicalOutcomes?: HistoricalOutcomeRecord[];
  fxDirect?: InstrumentSpec extends never ? never : import("../risk").FxRateSnapshot;
  fxInverse?: import("../risk").FxRateSnapshot;
  now?: number;
}): SignalResponse {
  const { result } = args;
  const candles = args.candles ?? [];
  const observedAt = candles.length > 0 ? candles[candles.length - 1].timestamp : undefined;
  const policy: NormalizedRiskPolicy = normalizeRiskPolicy(args.policy);

  // Probability FIRST (the plan's actionability consumes it).
  const direction = result.tradePlan?.direction;
  const probability = assessHistoricalProbability(args.historicalOutcomes, {
    instrument: result.instrument,
    timeframe: result.timeframe,
    ...(direction ? { direction } : {}),
    ...(policy.style !== undefined ? { style: policy.style.style } : {}),
  });

  const plan = buildAdaptiveTradePlan(result, { policy, expectancy: probability });

  const chart = buildSignalChart(result, candles, {
    ...(finite(plan.entry) ? { entry: plan.entry } : {}),
    ...(finite(plan.stop) ? { stop: plan.stop, stopBasis: plan.stopBasis } : {}),
    ...(finite(plan.tp1) ? { tp1: plan.tp1, tp1Basis: plan.tp1Basis } : {}),
    ...(finite(plan.tp2) ? { tp2: plan.tp2, tp2Basis: plan.tp2Basis } : {}),
  });

  const why: SignalWhySection[] = result.reasoningChain
    ? result.reasoningChain.sections.map((s) => ({ heading: s.heading, lines: [...s.lines] }))
    : [{ heading: "WHY", lines: ["the reasoning chain is not present on this result — nothing is invented to fill it"] }];

  const position = buildPositionMechanics({
    instrumentType: result.instrumentType,
    ...(policy.productType !== undefined ? { productType: policy.productType } : {}),
    ...(direction ? { direction } : { direction: "long" as const }),
    ...(finite(plan.entry) ? { entry: plan.entry } : { entry: Number.NaN }),
    ...(finite(plan.stop) ? { stop: plan.stop } : { stop: Number.NaN }),
    ...(finite(plan.tp1) ? { target: plan.tp1 } : {}),
    policy,
    ...(args.spec ? { spec: args.spec } : {}),
    ...(args.contractMeta ? { contractMeta: args.contractMeta } : {}),
    ...(args.fxDirect ? { fxDirect: args.fxDirect } : {}),
    ...(args.fxInverse ? { fxInverse: args.fxInverse } : {}),
    ...(args.now !== undefined ? { now: args.now } : {}),
  });

  const limitations: string[] = [];
  limitations.push(...(result.dataFlags ?? []));
  if (chart.available && chart.meta) {
    limitations.push(
      `chart renders the most recent ${chart.meta.candlesRendered} of ${chart.meta.provenance.candleCountFull} snapshot candles (input hash ${chart.meta.provenance.inputHash}) — reproducible from the same OHLCV snapshot as the evidence`,
    );
  } else {
    limitations.push(chart.unavailableReason!);
  }
  limitations.push(...plan.limitations);
  if (probability.status === "limited_sample") limitations.push(probability.reason!);
  if (probability.status === "unavailable") limitations.push(probability.reason!);
  if (position.sizing.available === false && position.sizing.unavailableReason) {
    limitations.push(`position sizing: ${position.sizing.unavailableReason}`);
  }
  if (!chart.available || !plan.available) {
    limitations.push("this response is informational — no order is ever created from it");
  }

  const si = result.tradePlan?.structuralInvalidation;
  const invalidation = {
    condition:
      si?.note ??
      result.tradePlan?.stopProvenance?.note ??
      (plan.available ? plan.stopBasis! : "no structural invalidation exists — the engine published no plan"),
    ...(si && finite(si.level) ? { level: si.level } : {}),
    ...(si ? { timeframe: si.timeframe } : {}),
  };

  return {
    available: true,
    instrument: result.instrument,
    instrumentType: result.instrumentType,
    timeframe: result.timeframe,
    ...(direction ? { direction } : {}),
    ...(args.provider !== undefined ? { provider: args.provider } : {}),
    ...(args.providerInstrumentId !== undefined
      ? { providerInstrumentId: args.providerInstrumentId }
      : result.providerInstrumentId !== undefined
        ? { providerInstrumentId: result.providerInstrumentId }
        : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
    chart,
    why,
    plan,
    probability,
    position,
    risk: {
      policyConfigured: policy.available,
      ...(policy.available
        ? {
            riskAmount: policy.riskAmount,
            ...(policy.riskPercent !== undefined ? { riskPercent: policy.riskPercent } : {}),
            ...(policy.accountCurrency !== undefined ? { accountCurrency: policy.accountCurrency } : {}),
          }
        : {}),
      note: policy.available
        ? "risk figures come from the user-configured policy — the engine never chose a risk for you"
        : "no risk policy is configured — the engine computes no exposure and risks nothing by default",
    },
    invalidation,
    limitations,
    noGuaranteeNote: NO_GUARANTEE_NOTE,
  };
}
