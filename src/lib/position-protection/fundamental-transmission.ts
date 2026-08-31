/**
 * Phase 111 — Fundamental Causal Transmission Engine
 *
 * Deterministic, evidence-first causal transmission layer.
 * Traces how macro observations transmit through dimensions to asset-specific impact.
 * Pure functions — no side effects, no network calls.
 * No probability claims. No auto-execution. No fabricated data.
 */

import type {
  FundamentalRegime,
  FundamentalEvidence,
  EvidenceDirection,
  DimensionAvailability,
  AssetClass,
  InflationRegime,
  InflationDriver,
  RateRegime,
  RealYieldRegime,
  CurrencyRegime,
  LiquidityRegime,
  GrowthRegime,
  EnergyRegime,
  GeopoliticalRegime,
  OverallRegime,
} from "./fundamental-regime";

// ═══════════════════════════════════════════════════════════════
// DOMAIN TYPES
// ═══════════════════════════════════════════════════════════════

export type TransmissionProvenance = "OBSERVED" | "DERIVED";
export type TransmissionSource =
  | "MACRO_CONTEXT"
  | "CROSS_ASSET_CONTEXT"
  | "NEWS_CONTEXT"
  | "POSITION_INTELLIGENCE"
  | "EXISTING_FUNDAMENTAL_REGIME";

export type MacroRegimeType =
  | "REFLATION"
  | "STAGFLATION"
  | "DISINFLATION"
  | "CONTRACTION"
  | "RECOVERY"
  | "RISK_ON"
  | "RISK_OFF"
  | "MIXED"
  | "STRESSED"
  | "INSUFFICIENT_DATA";

export interface CausalStep {
  /** Step number in the chain (1-based). */
  step: number;
  /** What was observed or derived. */
  description: string;
  /** Whether this is a direct observation or derived transmission. */
  provenance: TransmissionProvenance;
  /** Source of this step. */
  source: TransmissionSource;
}

export interface FundamentalTransmission {
  /** Unique identifier for this transmission. */
  id: string;
  /** Source dimension that starts the chain. */
  sourceDimension: string;
  /** What drives this transmission. */
  driver: string;
  /** How the transmission mechanism works. */
  mechanism: string;
  /** Target dimension affected. */
  targetDimension: string;
  /** Direction of impact on the target. */
  direction: EvidenceDirection;
  /** Which assets are affected. */
  affectedAssets: AssetClass[];
  /** Human-readable explanation. */
  explanation: string;
  /** Where this evidence comes from. */
  evidenceSource: TransmissionSource;
  /** Whether this is observed or derived. */
  provenance: TransmissionProvenance;
}

export interface CausalTrace {
  /** The transmission chain. */
  steps: CausalStep[];
  /** Overall conclusion. */
  conclusion: string;
  /** Data quality. */
  dataQuality: DimensionAvailability;
}

export interface FundamentalCausalResult {
  /** Overall macro regime classification. */
  macroRegime: MacroRegimeType;
  /** Causal transmissions active. */
  transmissions: FundamentalTransmission[];
  /** Supporting transmissions. */
  supportingTransmissions: FundamentalTransmission[];
  /** Conflicting transmissions. */
  conflictingTransmissions: FundamentalTransmission[];
  /** Neutral transmissions. */
  neutralTransmissions: FundamentalTransmission[];
  /** Causal trace for the full picture. */
  causalTrace: CausalTrace;
  /** Inflation causal chain. */
  inflationChain: CausalStep[];
  /** Growth/inflation regime combination. */
  regimeCombination: MacroRegimeType;
  /** Data quality. */
  dataQuality: DimensionAvailability;
  /** Generated at. */
  generatedAt: number;
}

export interface AssetCausalContext {
  /** Asset class. */
  asset: AssetClass;
  /** Fundamental assessment direction. */
  fundamentalAssessment: EvidenceDirection;
  /** Supporting evidence with causal chains. */
  supportingEvidence: FundamentalEvidence[];
  /** Conflicting evidence with causal chains. */
  conflictingEvidence: FundamentalEvidence[];
  /** Neutral evidence. */
  neutralEvidence: FundamentalEvidence[];
  /** Unavailable dimensions. */
  unavailableDimensions: string[];
  /** Causal transmissions affecting this asset. */
  transmissions: FundamentalTransmission[];
  /** Ordered causal trace for this asset. */
  causalTrace: CausalTrace;
  /** Dominant macro drivers. */
  dominantMacroDrivers: string[];
  /** Conflicting macro drivers. */
  conflictingMacroDrivers: string[];
  /** Explanation of how forces interact. */
  transmissionExplanation: string;
  /** What could change the assessment. */
  whatCouldChangeAssessment: string[];
  /** What to monitor. */
  whatToMonitor: string[];
  /** Data quality. */
  dataQuality: DimensionAvailability;
}

// ═══════════════════════════════════════════════════════════════
// MACRO REGIME COMBINATION
// ═══════════════════════════════════════════════════════════════

/**
 * Classify growth/inflation regime combination.
 * Pure function — deterministic.
 */
export function classifyMacroRegime(
  regime: FundamentalRegime,
): MacroRegimeType {
  const growth = regime.growthRegime;
  const inflation = regime.inflationRegime;
  const overall = regime.overallRegime;
  const liquidity = regime.liquidityRegime;

  // Guard: insufficient data
  if (
    (growth === "UNAVAILABLE" && inflation === "INSUFFICIENT_DATA") ||
    overall === "INSUFFICIENT_DATA"
  ) {
    return "INSUFFICIENT_DATA";
  }

  // Explicit stress/override
  if (overall === "STRESSED") return "STRESSED";
  if (overall === "RISK_OFF") return "RISK_OFF";
  if (overall === "RISK_ON" && growth === "EXPANDING") return "RISK_ON";

  // Stagflation: inflation elevated/rising + growth slowing/contracting
  const inflationElevated =
    inflation === "RISING" || inflation === "HIGH" || inflation === "ACCELERATING";
  const growthWeak = growth === "SLOWING" || growth === "CONTRACTING";

  if (inflationElevated && growthWeak) return "STAGFLATION";

  // Reflation: growth improving/expanding + inflation rising but not necessarily accelerating
  const growthImproving = growth === "EXPANDING" || growth === "RECOVERING";
  if (growthImproving && (inflation === "RISING" || inflation === "STABLE")) return "REFLATION";

  // Disinflation: inflation falling/disinflationary
  if (inflation === "DISINFLATIONARY") return "DISINFLATION";

  // Contraction: growth contracting
  if (growth === "CONTRACTING") return "CONTRACTION";

  // Recovery: growth recovering
  if (growth === "RECOVERING") return "RECOVERY";

  return "MIXED";
}

// ═══════════════════════════════════════════════════════════════
// CAUSAL TRANSMISSION BUILDER
// ═══════════════════════════════════════════════════════════════

let transmissionCounter = 0;

function makeTransmissionId(): string {
  transmissionCounter++;
  return `tx-${transmissionCounter}`;
}

/**
 * Build all causal transmissions from a fundamental regime.
 * Pure function — deterministic.
 */
export function buildCausalTransmissions(
  regime: FundamentalRegime,
): FundamentalTransmission[] {
  const transmissions: FundamentalTransmission[] = [];
  transmissionCounter = 0;

  // ─── Inflation transmissions ───
  transmissions.push(...buildInflationTransmissions(regime));

  // ─── Rate transmissions ───
  transmissions.push(...buildRateTransmissions(regime));

  // ─── Real yield transmissions ───
  transmissions.push(...buildRealYieldTransmissions(regime));

  // ─── Currency transmissions ───
  transmissions.push(...buildCurrencyTransmissions(regime));

  // ─── Liquidity transmissions ───
  transmissions.push(...buildLiquidityTransmissions(regime));

  // ─── Growth transmissions ───
  transmissions.push(...buildGrowthTransmissions(regime));

  // ─── Energy transmissions ───
  transmissions.push(...buildEnergyTransmissions(regime));

  // ─── Geopolitical transmissions ───
  transmissions.push(...buildGeopoliticalTransmissions(regime));

  return transmissions;
}

// ═══════════════════════════════════════════════════════════════
// INFLATION CAUSAL CHAINS
// ═══════════════════════════════════════════════════════════════

function buildInflationTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.inflationRegime === "INSUFFICIENT_DATA") return txs;

  const isInflationary = regime.inflationRegime === "RISING" || regime.inflationRegime === "HIGH" || regime.inflationRegime === "ACCELERATING";

  if (!isInflationary) return txs;

  // Supply-driven inflation chain
  if (regime.inflationDriver === "SUPPLY_DRIVEN" || regime.inflationDriver === "MIXED") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INFLATION",
      driver: "Supply-driven inflation",
      mechanism: "Supply cost increases → inflation pressure → potential monetary tightening",
      targetDimension: "RATE_PRESSURE",
      direction: "CONFLICTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Supply-driven inflation can pressure central banks toward tightening, which may compress equity valuations",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INFLATION",
      driver: "Supply-driven inflation",
      mechanism: "Supply cost increases → inflation → purchasing-power hedging demand",
      targetDimension: "SAFE_HAVEN_DEMAND",
      direction: "SUPPORTING",
      affectedAssets: ["GOLD"],
      explanation: "Supply-driven inflation may support gold as a purchasing-power hedge",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  // Demand-driven inflation chain
  if (regime.inflationDriver === "DEMAND_DRIVEN" || regime.inflationDriver === "MIXED") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INFLATION",
      driver: "Demand-driven inflation",
      mechanism: "Strong demand → inflation → potentially supportive for growth assets",
      targetDimension: "GROWTH_ASSET_SUPPORT",
      direction: "SUPPORTING",
      affectedAssets: ["EQUITIES", "COMMODITIES"],
      explanation: "Demand-driven inflation reflects economic strength, which can support growth-sensitive assets",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  // General inflation transmission to gold
  txs.push({
    id: makeTransmissionId(),
    sourceDimension: "INFLATION",
    driver: "Elevated inflation",
    mechanism: "Inflation → purchasing-power erosion → store-of-value demand",
    targetDimension: "STORE_OF_VALUE",
    direction: "SUPPORTING",
    affectedAssets: ["GOLD", "SILVER"],
    explanation: "Elevated inflation supports demand for stores of value",
    evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
    provenance: "DERIVED",
  });

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// RATE TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildRateTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.rateRegime === "INSUFFICIENT_DATA") return txs;

  if (regime.rateRegime === "TIGHTENING" || regime.rateRegime === "RESTRICTIVE") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INTEREST_RATES",
      driver: "Tightening monetary policy",
      mechanism: "Higher rates → higher discount rates → compression of valuation multiples",
      targetDimension: "VALUATION_PRESSURE",
      direction: "CONFLICTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Tightening monetary policy can compress equity valuation multiples",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INTEREST_RATES",
      driver: "Tightening monetary policy",
      mechanism: "Higher rates → increased opportunity cost of non-yielding assets",
      targetDimension: "OPPORTUNITY_COST",
      direction: "CONFLICTING",
      affectedAssets: ["GOLD", "CRYPTO"],
      explanation: "Higher rates increase the opportunity cost of holding non-yielding assets",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  if (regime.rateRegime === "EASING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INTEREST_RATES",
      driver: "Easing monetary policy",
      mechanism: "Lower rates → lower discount rates → expansion of valuation multiples",
      targetDimension: "VALUATION_SUPPORT",
      direction: "SUPPORTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Easing monetary policy can support equity valuations",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "INTEREST_RATES",
      driver: "Easing monetary policy",
      mechanism: "Lower rates → reduced opportunity cost of non-yielding assets",
      targetDimension: "OPPORTUNITY_COST",
      direction: "SUPPORTING",
      affectedAssets: ["GOLD", "CRYPTO"],
      explanation: "Easing monetary policy reduces the opportunity cost of holding non-yielding assets",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// REAL YIELD TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildRealYieldTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.realYieldRegime === "UNAVAILABLE") return txs;

  if (regime.realYieldRegime === "REAL_YIELD_FALLING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "REAL_YIELDS",
      driver: "Falling real yields",
      mechanism: "Lower real yields → reduced real return on bonds → increased relative attractiveness of non-yielding stores of value",
      targetDimension: "STORE_OF_VALUE",
      direction: "SUPPORTING",
      affectedAssets: ["GOLD", "SILVER"],
      explanation: "Falling real yields reduce the relative return advantage of bonds versus gold",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "REAL_YIELDS",
      driver: "Falling real yields",
      mechanism: "Lower real yields → reduced opportunity cost → potentially supportive for risk assets",
      targetDimension: "OPPORTUNITY_COST",
      direction: "SUPPORTING",
      affectedAssets: ["CRYPTO"],
      explanation: "Falling real yields reduce the opportunity cost of holding crypto",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  if (regime.realYieldRegime === "REAL_YIELD_RISING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "REAL_YIELDS",
      driver: "Rising real yields",
      mechanism: "Higher real yields → increased real return on bonds → reduced relative attractiveness of non-yielding stores of value",
      targetDimension: "STORE_OF_VALUE",
      direction: "CONFLICTING",
      affectedAssets: ["GOLD", "SILVER"],
      explanation: "Rising real yields increase the relative return advantage of bonds versus gold",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "REAL_YIELDS",
      driver: "Rising real yields",
      mechanism: "Higher real yields → increased opportunity cost → potentially conflicting for non-yielding risk assets",
      targetDimension: "OPPORTUNITY_COST",
      direction: "CONFLICTING",
      affectedAssets: ["CRYPTO"],
      explanation: "Rising real yields increase the opportunity cost of holding crypto",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// CURRENCY TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildCurrencyTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.currencyRegime === "UNAVAILABLE") return txs;

  if (regime.currencyRegime === "WEAKENING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "CURRENCY_STRENGTH",
      driver: "Weakening USD",
      mechanism: "Currency depreciation → reduced purchasing power of dollar-denominated assets → increased demand for alternative stores of value",
      targetDimension: "PURCHASING_POWER",
      direction: "SUPPORTING",
      affectedAssets: ["GOLD", "SILVER", "CRYPTO", "COMMODITIES"],
      explanation: "Weakening USD can support assets priced in dollars as alternative stores of value",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  if (regime.currencyRegime === "STRENGTHENING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "CURRENCY_STRENGTH",
      driver: "Strengthening USD",
      mechanism: "Currency appreciation → increased purchasing power of dollar-denominated assets → reduced demand for alternative stores of value",
      targetDimension: "PURCHASING_POWER",
      direction: "CONFLICTING",
      affectedAssets: ["GOLD", "SILVER", "CRYPTO", "COMMODITIES"],
      explanation: "Strengthening USD can create headwinds for dollar-denominated alternative assets",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDITY TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildLiquidityTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.liquidityRegime === "UNAVAILABLE") return txs;

  if (regime.liquidityRegime === "EASY") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "LIQUIDITY",
      driver: "Easy monetary conditions",
      mechanism: "Abundant liquidity → increased risk appetite → flow into risk assets",
      targetDimension: "RISK_APPETITE",
      direction: "SUPPORTING",
      affectedAssets: ["CRYPTO", "EQUITIES"],
      explanation: "Easy liquidity conditions can support risk appetite and flow into growth/risk assets",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  if (regime.liquidityRegime === "STRESS" || regime.liquidityRegime === "TIGHTENING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "LIQUIDITY",
      driver: "Liquidity stress or tightening",
      mechanism: "Reduced liquidity → decreased risk appetite → potential deleveraging pressure",
      targetDimension: "RISK_APPETITE",
      direction: "CONFLICTING",
      affectedAssets: ["CRYPTO", "EQUITIES"],
      explanation: "Liquidity stress can reduce risk appetite and create deleveraging pressure",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// GROWTH TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildGrowthTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.growthRegime === "UNAVAILABLE") return txs;

  if (regime.growthRegime === "EXPANDING" || regime.growthRegime === "RECOVERING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GROWTH",
      driver: "Expanding or recovering growth",
      mechanism: "Economic expansion → increased corporate earnings potential → equity support",
      targetDimension: "EARNINGS_OUTLOOK",
      direction: "SUPPORTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Economic expansion can support corporate earnings and equity valuations",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GROWTH",
      driver: "Expanding or recovering growth",
      mechanism: "Economic expansion → increased industrial/commodity demand",
      targetDimension: "DEMAND_OUTLOOK",
      direction: "SUPPORTING",
      affectedAssets: ["COMMODITIES", "OIL"],
      explanation: "Economic expansion increases demand for industrial commodities and energy",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  if (regime.growthRegime === "CONTRACTING" || regime.growthRegime === "SLOWING") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GROWTH",
      driver: "Contracting or slowing growth",
      mechanism: "Economic contraction → reduced corporate earnings potential → equity pressure",
      targetDimension: "EARNINGS_OUTLOOK",
      direction: "CONFLICTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Economic contraction can pressure corporate earnings and equity valuations",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GROWTH",
      driver: "Contracting or slowing growth",
      mechanism: "Economic contraction → reduced industrial/commodity demand",
      targetDimension: "DEMAND_OUTLOOK",
      direction: "CONFLICTING",
      affectedAssets: ["COMMODITIES", "OIL"],
      explanation: "Economic contraction reduces demand for industrial commodities and energy",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// ENERGY TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildEnergyTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.energyRegime === "UNAVAILABLE") return txs;

  if (regime.energyRegime === "SUPPLY_DISRUPTION" || regime.energyRegime === "OIL_SHOCK") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "ENERGY",
      driver: "Energy supply disruption",
      mechanism: "Supply disruption → energy price pressure → direct oil support",
      targetDimension: "OIL_PRICE",
      direction: "SUPPORTING",
      affectedAssets: ["OIL"],
      explanation: "Supply disruption creates direct upward pressure on oil prices",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });

    // Chain: energy → inflation → rate pressure
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "ENERGY",
      driver: "Energy supply disruption",
      mechanism: "Energy price increase → cost-push inflation → potential monetary tightening pressure",
      targetDimension: "INFLATION_PRESSURE",
      direction: "CONFLICTING",
      affectedAssets: ["EQUITIES"],
      explanation: "Energy-driven inflation can create monetary tightening pressure that conflicts with equities",
      evidenceSource: "EXISTING_FUNDAMENTAL_REGIME",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// GEOPOLITICAL TRANSMISSIONS
// ═══════════════════════════════════════════════════════════════

function buildGeopoliticalTransmissions(regime: FundamentalRegime): FundamentalTransmission[] {
  const txs: FundamentalTransmission[] = [];

  if (regime.geopoliticalRegime === "INSUFFICIENT_DATA") return txs;

  if (regime.geopoliticalRegime === "ESCALATING" || regime.geopoliticalRegime === "HIGH") {
    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GEOPOLITICAL_RISK",
      driver: "Geopolitical escalation",
      mechanism: "Geopolitical risk → safe-haven demand → store-of-value support",
      targetDimension: "SAFE_HAVEN_DEMAND",
      direction: "SUPPORTING",
      affectedAssets: ["GOLD", "SILVER"],
      explanation: "Geopolitical escalation can increase safe-haven demand for precious metals",
      evidenceSource: "NEWS_CONTEXT",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GEOPOLITICAL_RISK",
      driver: "Geopolitical escalation",
      mechanism: "Geopolitical risk → energy supply risk → energy price pressure",
      targetDimension: "ENERGY_PRESSURE",
      direction: "SUPPORTING",
      affectedAssets: ["OIL"],
      explanation: "Geopolitical escalation in energy-producing regions can support oil prices",
      evidenceSource: "NEWS_CONTEXT",
      provenance: "DERIVED",
    });

    txs.push({
      id: makeTransmissionId(),
      sourceDimension: "GEOPOLITICAL_RISK",
      driver: "Geopolitical escalation",
      mechanism: "Geopolitical risk → risk aversion → reduced risk appetite",
      targetDimension: "RISK_APPETITE",
      direction: "CONFLICTING",
      affectedAssets: ["CRYPTO", "EQUITIES"],
      explanation: "Geopolitical escalation can reduce risk appetite for growth/risk assets",
      evidenceSource: "NEWS_CONTEXT",
      provenance: "DERIVED",
    });
  }

  return txs;
}

// ═══════════════════════════════════════════════════════════════
// CAUSAL TRACE BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build a causal trace from regime and transmissions.
 * Pure function — deterministic.
 */
export function buildCausalTrace(
  regime: FundamentalRegime,
  transmissions: FundamentalTransmission[],
): CausalTrace {
  const steps: CausalStep[] = [];
  let stepNum = 1;

  // Observed dimensions
  for (const dim of regime.dimensions) {
    if (dim.status === "AVAILABLE") {
      steps.push({
        step: stepNum++,
        description: `${dim.name}: ${dim.description}`,
        provenance: "OBSERVED",
        source: "EXISTING_FUNDAMENTAL_REGIME",
      });
    }
  }

  // Derived transmissions
  for (const tx of transmissions) {
    steps.push({
      step: stepNum++,
      description: `${tx.driver} → ${tx.mechanism}`,
      provenance: "DERIVED",
      source: tx.evidenceSource,
    });
  }

  const conclusion = transmissions.length > 0
    ? `${transmissions.filter((t) => t.direction === "SUPPORTING").length} supporting and ${transmissions.filter((t) => t.direction === "CONFLICTING").length} conflicting transmission(s) identified`
    : "No strong causal transmissions identified from available data";

  return {
    steps,
    conclusion,
    dataQuality: regime.dataQuality,
  };
}

/**
 * Build inflation-specific causal trace.
 */
export function buildInflationCausalTrace(regime: FundamentalRegime): CausalStep[] {
  const steps: CausalStep[] = [];
  let stepNum = 1;

  if (regime.inflationRegime === "INSUFFICIENT_DATA") {
    steps.push({
      step: stepNum++,
      description: "Inflation data unavailable — no causal chain can be constructed",
      provenance: "OBSERVED",
      source: "EXISTING_FUNDAMENTAL_REGIME",
    });
    return steps;
  }

  steps.push({
    step: stepNum++,
    description: `Inflation regime: ${regime.inflationRegime}`,
    provenance: "OBSERVED",
    source: "EXISTING_FUNDAMENTAL_REGIME",
  });

  if (regime.inflationDriver !== "INSUFFICIENT_DATA") {
    steps.push({
      step: stepNum++,
      description: `Inflation driver: ${regime.inflationDriver.replace(/_/g, " ").toLowerCase()}`,
      provenance: "OBSERVED",
      source: "EXISTING_FUNDAMENTAL_REGIME",
    });
  }

  // Derived consequences
  if (regime.inflationDriver === "SUPPLY_DRIVEN" || regime.inflationDriver === "MIXED") {
    steps.push({
      step: stepNum++,
      description: "Supply-driven inflation → energy cost pressure → cost-push inflation path",
      provenance: "DERIVED",
      source: "EXISTING_FUNDAMENTAL_REGIME",
    });
    steps.push({
      step: stepNum++,
      description: "Cost-push inflation → potential monetary tightening pressure",
      provenance: "DERIVED",
      source: "EXISTING_FUNDAMENTAL_REGIME",
    });
  }

  if (regime.inflationDriver === "DEMAND_DRIVEN" || regime.inflationDriver === "MIXED") {
    steps.push({
      step: stepNum++,
      description: "Demand-driven inflation → growth strength signal → demand-pull inflation path",
      provenance: "DERIVED",
      source: "EXISTING_FUNDAMENTAL_REGIME",
    });
  }

  return steps;
}

// ═══════════════════════════════════════════════════════════════
// FULL CAUSAL RESULT
// ═══════════════════════════════════════════════════════════════

/**
 * Build the complete causal transmission result.
 * Pure function — deterministic.
 */
export function buildFundamentalCausalResult(
  regime: FundamentalRegime,
): FundamentalCausalResult {
  const transmissions = buildCausalTransmissions(regime);
  const supporting = transmissions.filter((t) => t.direction === "SUPPORTING");
  const conflicting = transmissions.filter((t) => t.direction === "CONFLICTING");
  const neutral = transmissions.filter((t) => t.direction === "NEUTRAL");

  const macroRegime = classifyMacroRegime(regime);
  const causalTrace = buildCausalTrace(regime, transmissions);
  const inflationChain = buildInflationCausalTrace(regime);

  return {
    macroRegime,
    transmissions,
    supportingTransmissions: supporting,
    conflictingTransmissions: conflicting,
    neutralTransmissions: neutral,
    causalTrace,
    inflationChain,
    regimeCombination: macroRegime,
    dataQuality: regime.dataQuality,
    generatedAt: regime.generatedAt,
  };
}

// ═══════════════════════════════════════════════════════════════
// ASSET-SPECIFIC CAUSAL CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Build asset-specific causal context with transmissions.
 * Pure function — deterministic.
 */
export function buildAssetCausalContext(
  asset: AssetClass,
  regime: FundamentalRegime,
  transmissions: FundamentalTransmission[],
): AssetCausalContext {
  const assetTx = transmissions.filter((t) => t.affectedAssets.includes(asset));

  const supporting: FundamentalEvidence[] = [];
  const conflicting: FundamentalEvidence[] = [];
  const neutral: FundamentalEvidence[] = [];
  const unavailable: string[] = [];
  const dominant: string[] = [];
  const conflictingDrivers: string[] = [];

  for (const tx of assetTx) {
    const evidence: FundamentalEvidence = {
      dimension: tx.sourceDimension,
      direction: tx.direction,
      description: tx.explanation,
      source: tx.evidenceSource,
    };

    switch (tx.direction) {
      case "SUPPORTING":
        supporting.push(evidence);
        dominant.push(tx.driver);
        break;
      case "CONFLICTING":
        conflicting.push(evidence);
        conflictingDrivers.push(tx.driver);
        break;
      case "NEUTRAL":
        neutral.push(evidence);
        break;
      case "UNAVAILABLE":
        unavailable.push(tx.sourceDimension);
        break;
    }
  }

  // Check for unavailable regime dimensions
  for (const dim of regime.dimensions) {
    if (dim.status !== "AVAILABLE" && !unavailable.includes(dim.name)) {
      unavailable.push(dim.name);
    }
  }

  let fundamentalAssessment: EvidenceDirection;
  if (regime.dataQuality === "UNAVAILABLE") {
    fundamentalAssessment = "UNAVAILABLE";
  } else if (conflicting.length > supporting.length) {
    fundamentalAssessment = "CONFLICTING";
  } else if (supporting.length > conflicting.length) {
    fundamentalAssessment = "SUPPORTING";
  } else if (supporting.length > 0 && conflicting.length > 0) {
    fundamentalAssessment = "NEUTRAL"; // Mixed forces
  } else {
    fundamentalAssessment = "NEUTRAL";
  }

  // Build causal trace for this asset
  const assetTrace: CausalTrace = {
    steps: assetTx.map((tx, i) => ({
      step: i + 1,
      description: `${tx.driver} → ${tx.targetDimension} (${tx.direction})`,
      provenance: tx.provenance,
      source: tx.evidenceSource,
    })),
    conclusion: buildTransmissionExplanation(asset, supporting, conflicting),
    dataQuality: regime.dataQuality,
  };

  const whatCouldChange = buildWhatCouldChange(asset, regime);
  const whatToMonitor = buildWhatToMonitor(asset, regime, assetTx);

  return {
    asset,
    fundamentalAssessment,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    neutralEvidence: neutral,
    unavailableDimensions: unavailable,
    transmissions: assetTx,
    causalTrace: assetTrace,
    dominantMacroDrivers: dominant,
    conflictingMacroDrivers: conflictingDrivers,
    transmissionExplanation: buildTransmissionExplanation(asset, supporting, conflicting),
    whatCouldChangeAssessment: whatCouldChange,
    whatToMonitor,
    dataQuality: regime.dataQuality,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildTransmissionExplanation(
  asset: AssetClass,
  supporting: FundamentalEvidence[],
  conflicting: FundamentalEvidence[],
): string {
  if (supporting.length === 0 && conflicting.length === 0) {
    return `No strong causal transmission identified for ${asset} from available macro data.`;
  }

  const parts: string[] = [];
  if (supporting.length > 0 && conflicting.length > 0) {
    const suppDrivers = supporting.map((e) => e.source).slice(0, 2).join(" and ");
    const confDrivers = conflicting.map((e) => e.source).slice(0, 2).join(" and ");
    parts.push(`Forces from ${suppDrivers} support ${asset}, while forces from ${confDrivers} create conflicting pressure`);
  } else if (supporting.length > 0) {
    parts.push(`${supporting.length} causal factor(s) support ${asset}`);
  } else {
    parts.push(`${conflicting.length} causal factor(s) conflict with ${asset}`);
  }

  return parts.join(". ") + ".";
}

function buildWhatCouldChange(asset: AssetClass, regime: FundamentalRegime): string[] {
  const items: string[] = [];
  if (regime.dataQuality === "UNAVAILABLE") {
    items.push("Additional macro data would improve causal analysis");
  }
  for (const dim of regime.dimensions) {
    if (dim.status !== "AVAILABLE") {
      items.push(`${dim.name.replace(/_/g, " ").toLowerCase()} data becoming available could shift the causal picture`);
    }
  }
  if (items.length === 0) {
    items.push("Meaningful changes in macro regime dimensions could shift the causal assessment");
  }
  return items.slice(0, 5); // Bound
}

function buildWhatToMonitor(
  asset: AssetClass,
  regime: FundamentalRegime,
  transmissions: FundamentalTransmission[],
): string[] {
  const items: string[] = [];

  // Monitor dimensions with active conflicting transmissions
  for (const tx of transmissions) {
    if (tx.direction === "CONFLICTING") {
      items.push(`${tx.sourceDimension.replace(/_/g, " ")} — ${tx.driver.toLowerCase()} could shift`);
    }
  }

  // Monitor regime transitions
  if (regime.rateRegime === "TRANSITIONING") {
    items.push("Central bank policy transition — monitor for direction clarity");
  }
  if (regime.inflationRegime === "ACCELERATING" || regime.inflationRegime === "RISING") {
    items.push("Inflation trajectory — monitor for persistence or reversal");
  }
  if (regime.geopoliticalRegime === "ESCALATING") {
    items.push("Geopolitical developments — monitor for escalation or de-escalation");
  }

  if (items.length === 0) {
    items.push("Continue monitoring macro regime for meaningful causal changes");
  }

  return [...new Set(items)].slice(0, 5); // Deduplicate and bound
}
