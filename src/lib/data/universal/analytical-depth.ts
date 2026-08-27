/**
 * Phase 55 — Analytical Depth Builder
 *
 * Pure functions that transform raw provider data / market observations
 * into rich, asset-class-specific analytical context.
 *
 * CRITICAL:
 *   - All functions are PURE — no side effects, no network calls.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data remains missing — never fabricated.
 *   - Every analytical statement has explainable supporting evidence.
 *   - This module CANNOT modify bias, conviction, gates, trade plan,
 *     recommendation, or actionability.
 *   - No metric is automatically bullish or bearish.
 */

import type {
  CryptoAnalyticalDepth,
  ForexAnalyticalDepth,
  EquityAnalyticalDepth,
  CommodityAnalyticalDepth,
  IndexAnalyticalDepth,
  MacroAnalyticalDepth,
  UniversalAnalyticalContext,
  AnalyticalDimension,
  MarketRegime,
  VolatilityRegime,
  TrendRegime,
} from "./analytical-context";
import type { AssetClass } from "./types";

// ═══════════════════════════════════════════════════════════════
// CRYPTO ANALYTICAL DEPTH
// ═══════════════════════════════════════════════════════════════

export interface CryptoRawData {
  derivatives?: {
    openInterest?: { current: number; change24h?: number };
    fundingRate?: { currentRate: number; annualizedRate?: number };
    longShort?: { accountRatio?: number; dominantSide?: string };
    liquidation?: { totalVolume?: number; dominantSide?: string };
  };
  defi?: {
    tvl?: { current: number; change7d?: number; change30d?: number };
    fees?: { dailyFees?: number; dailyRevenue?: number };
  };
  tokenomics?: {
    supply?: { circulatingSupply?: number; totalSupply?: number };
    unlocks?: { upcomingCount30d: number; upcomingValue30d?: number; unlockPercentOfCirculating?: number };
  };
  btcCorrelation?: number;
  btcDominance?: number;
}

export function buildCryptoAnalyticalDepth(
  instrument: string,
  data: CryptoRawData,
): CryptoAnalyticalDepth {
  const dims: AnalyticalDimension[] = [];
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];

  // OI Regime
  const oiRegime = data.derivatives?.openInterest ? {
    level: classifyLevel(data.derivatives.openInterest.current, 1e9, 1e8) as "HIGH" | "LOW" | "NORMAL" | "UNKNOWN",
    trend: classifyTrend(data.derivatives.openInterest.change24h),
    available: true,
    description: `Open interest at ${formatNum(data.derivatives.openInterest.current)} — ${classifyLevel(data.derivatives.openInterest.current, 1e9, 1e8).toLowerCase()} regime.`,
  } : undefined;

  if (oiRegime) {
    dims.push({ name: "oi_regime", category: "DERIVATIVES", source: "CoinGlass", quality: "VERIFIED", freshness: "FRESH", horizonRelevance: "PRIMARY", explanation: oiRegime.description, available: true, dependencyGroup: "DERIVATIVES_OI" });
    supporting.push(`OI regime: ${oiRegime.level}`);
  } else { missing.push("Open interest regime"); }

  // Funding Regime
  const fundingRegime = data.derivatives?.fundingRate ? {
    level: classifyFunding(data.derivatives.fundingRate.currentRate),
    annualizedRate: data.derivatives.fundingRate.annualizedRate,
    available: true,
    description: `Funding rate ${data.derivatives.fundingRate.currentRate >= 0 ? "+" : ""}${(data.derivatives.fundingRate.currentRate * 100).toFixed(4)}% — ${classifyFunding(data.derivatives.fundingRate.currentRate).toLowerCase().replace(/_/g, " ")} regime.`,
  } : undefined;

  if (fundingRegime) {
    dims.push({ name: "funding_regime", category: "DERIVATIVES", source: "CoinGlass", quality: "VERIFIED", freshness: "FRESH", horizonRelevance: "PRIMARY", explanation: fundingRegime.description, available: true, dependencyGroup: "DERIVATIVES_FUNDING" });
    supporting.push(`Funding regime: ${fundingRegime.level}`);
  } else { missing.push("Funding regime"); }

  // Liquidation
  const liquidationContext = data.derivatives?.liquidation ? {
    asymmetry: (data.derivatives.liquidation.dominantSide === "longs" ? "LONG_DOMINANT" : data.derivatives.liquidation.dominantSide === "shorts" ? "SHORT_DOMINANT" : "BALANCED") as "LONG_DOMINANT" | "SHORT_DOMINANT" | "BALANCED" | "UNKNOWN",
    available: true,
    description: `Liquidation asymmetry: ${data.derivatives.liquidation.dominantSide ?? "balanced"}.`,
  } : undefined;

  if (liquidationContext) {
    dims.push({ name: "liquidation_context", category: "DERIVATIVES", source: "CoinGlass", quality: "VERIFIED", freshness: "FRESH", horizonRelevance: "PRIMARY", explanation: liquidationContext.description, available: true, dependencyGroup: "DERIVATIVES_LIQUIDATION" });
  } else { missing.push("Liquidation data"); }

  // TVL Trend
  const tvlTrend = data.defi?.tvl ? {
    direction: classifyTvlTrend(data.defi.tvl.change7d ?? data.defi.tvl.change30d),
    available: true,
    description: `TVL trend: ${classifyTvlTrend(data.defi.tvl.change7d ?? data.defi.tvl.change30d).toLowerCase()}.`,
  } : undefined;

  if (tvlTrend) {
    dims.push({ name: "tvl_trend", category: "DEFI_FUNDAMENTAL", source: "DeFiLlama", quality: "VERIFIED", freshness: "DELAYED", horizonRelevance: "SECONDARY", explanation: tvlTrend.description, available: true, dependencyGroup: "DEFI_TVL" });
  } else { missing.push("TVL trend"); }

  // Supply Pressure
  const supplyPressure = data.tokenomics?.supply ? (() => {
    const circPct = data.tokenomics!.supply!.totalSupply && data.tokenomics!.supply!.circulatingSupply
      ? (data.tokenomics!.supply!.circulatingSupply! / data.tokenomics!.supply!.totalSupply!) * 100
      : undefined;
    return {
      level: circPct !== undefined
        ? (circPct > 80 ? "LOW" : circPct > 50 ? "MODERATE" : "HIGH") as "HIGH" | "MODERATE" | "LOW" | "UNKNOWN"
        : "UNKNOWN" as const,
      available: true,
      description: `Supply: ${circPct !== undefined ? circPct.toFixed(1) + "% circulating" : "ratio unavailable"}.`,
    };
  })() : undefined;

  if (supplyPressure) {
    dims.push({ name: "supply_pressure", category: "TOKENOMICS", source: "Tokenomist", quality: "VERIFIED", freshness: "DELAYED", horizonRelevance: "SECONDARY", explanation: supplyPressure.description, available: true, dependencyGroup: "TOKENOMICS_SUPPLY" });
  } else { missing.push("Supply pressure data"); }

  // Unlock Pressure
  const unlockPressure = data.tokenomics?.unlocks ? {
    level: data.tokenomics.unlocks.upcomingCount30d === 0 ? "NONE" as const
      : (data.tokenomics.unlocks.unlockPercentOfCirculating ?? 0) > 5 ? "HIGH" as const
      : (data.tokenomics.unlocks.unlockPercentOfCirculating ?? 0) > 1 ? "MODERATE" as const
      : "LOW" as const,
    upcomingCount30d: data.tokenomics.unlocks.upcomingCount30d,
    available: true,
    description: `${data.tokenomics.unlocks.upcomingCount30d} upcoming unlocks in 30d.`,
  } : undefined;

  if (unlockPressure) {
    dims.push({ name: "unlock_pressure", category: "TOKENOMICS", source: "Tokenomist", quality: "VERIFIED", freshness: "DELAYED", horizonRelevance: "SECONDARY", explanation: unlockPressure.description, available: true, dependencyGroup: "TOKENOMICS_UNLOCK" });
  } else { missing.push("Unlock pressure data"); }

  // BTC Correlation
  const btcCorrelation = instrument !== "BTC/USD" && data.btcCorrelation !== undefined ? {
    correlation: data.btcCorrelation,
    regime: Math.abs(data.btcCorrelation) > 0.7 ? "HIGH_CORRELATED" as const
      : Math.abs(data.btcCorrelation) < 0.3 ? "LOW_CORRELATED" as const
      : data.btcCorrelation < -0.3 ? "INVERSE" as const
      : "UNKNOWN" as const,
    available: true,
    description: `BTC correlation: ${data.btcCorrelation.toFixed(2)} (${Math.abs(data.btcCorrelation) > 0.7 ? "high" : Math.abs(data.btcCorrelation) < 0.3 ? "low" : "moderate"}).`,
  } : undefined;

  if (btcCorrelation) {
    dims.push({ name: "btc_correlation", category: "CROSS_ASSET", source: "derived", quality: "DEGRADED", freshness: "FRESH", horizonRelevance: "SECONDARY", explanation: btcCorrelation.description, available: true, dependencyGroup: "MACRO_RATES" });
  }

  // BTC Dominance
  const marketDominance = data.btcDominance !== undefined ? {
    btcDominance: data.btcDominance,
    trend: "UNKNOWN" as const, // Cannot determine trend from single observation
    available: true,
    description: `BTC dominance: ${data.btcDominance.toFixed(1)}%.`,
  } : undefined;

  if (marketDominance) {
    dims.push({ name: "market_dominance", category: "CROSS_ASSET", source: "CoinGecko", quality: "DEGRADED", freshness: "DELAYED", horizonRelevance: "SECONDARY", explanation: marketDominance.description, available: true, dependencyGroup: "MACRO_RATES" });
  }

  return {
    instrument,
    assetClass: "crypto",
    assembledAt: Date.now(),
    oiRegime,
    fundingRegime,
    liquidationContext,
    spotDerivativesDivergence: undefined, // Cannot determine without spot+deriv price comparison
    tvlTrend,
    feesRevenueTrend: undefined,
    supplyPressure,
    unlockPressure,
    btcCorrelation,
    marketDominance,
    dimensions: dims,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingInformation: missing,
  };
}

// ═══════════════════════════════════════════════════════════════
// FOREX ANALYTICAL DEPTH
// ═══════════════════════════════════════════════════════════════

export interface ForexRawData {
  rateDifferential?: { baseRate?: number; quoteRate?: number; differential?: number };
  yieldDifferential?: { twoYear?: number; tenYear?: number; realYield?: number };
  centralBank?: { baseBias?: string; quoteBias?: string; baseBank?: string; quoteBank?: string };
  cot?: { netNonCommercial?: number; change?: number };
  dxy?: { trend?: string; value?: number };
  macro?: { keyDrivers?: string[]; upcomingEvents?: { name: string; date: string; impact: string }[] };
}

export function buildForexAnalyticalDepth(
  instrument: string,
  data: ForexRawData,
): ForexAnalyticalDepth {
  const dims: AnalyticalDimension[] = [];
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];

  // Rate differential
  const rateDifferential = data.rateDifferential ? {
    baseRate: data.rateDifferential.baseRate,
    quoteRate: data.rateDifferential.quoteRate,
    differential: data.rateDifferential.differential,
    trend: "UNKNOWN" as const,
    available: data.rateDifferential.differential !== undefined,
    description: data.rateDifferential.differential !== undefined
      ? `Rate differential: ${data.rateDifferential.differential.toFixed(1)}bp.`
      : "Rate differential unavailable.",
  } : undefined;

  if (rateDifferential?.available) {
    dims.push({ name: "rate_differential", category: "RATES", source: "Treasury/Central Banks", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: rateDifferential.description, available: true, dependencyGroup: "MACRO_RATES" });
    supporting.push(`Rate differential: ${rateDifferential.differential?.toFixed(1)}bp`);
  } else { missing.push("Rate differential data"); }

  // Yield differential
  const yieldDifferential = data.yieldDifferential ? {
    twoYearDifferential: data.yieldDifferential.twoYear,
    tenYearDifferential: data.yieldDifferential.tenYear,
    realYieldDifferential: data.yieldDifferential.realYield,
    available: data.yieldDifferential.tenYear !== undefined,
    description: data.yieldDifferential.tenYear !== undefined
      ? `10Y yield differential: ${data.yieldDifferential.tenYear.toFixed(1)}bp.`
      : "Yield differential unavailable.",
  } : undefined;

  if (yieldDifferential?.available) {
    dims.push({ name: "yield_differential", category: "MACRO", source: "Treasury", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: yieldDifferential.description, available: true, dependencyGroup: "MACRO_YIELD_CURVE" });
    supporting.push(`Yield differential available`);
  } else { missing.push("Yield differential data"); }

  // Central bank regime
  const centralBankRegime = data.centralBank ? {
    baseCentralBank: data.centralBank.baseBank ?? "Unknown",
    quoteCentralBank: data.centralBank.quoteBank ?? "Unknown",
    baseBias: classifyCentralBankBias(data.centralBank.baseBias),
    quoteBias: classifyCentralBankBias(data.centralBank.quoteBias),
    available: !!(data.centralBank.baseBias || data.centralBank.quoteBias),
    description: data.centralBank.baseBias || data.centralBank.quoteBias
      ? `Central bank: ${data.centralBank.baseBank ?? "?"} ${classifyCentralBankBias(data.centralBank.baseBias).toLowerCase()}, ${data.centralBank.quoteBank ?? "?"} ${classifyCentralBankBias(data.centralBank.quoteBias).toLowerCase()}.`
      : "Central bank regime unavailable.",
  } : undefined;

  if (centralBankRegime?.available) {
    dims.push({ name: "central_bank_regime", category: "RATES", source: "Central Banks", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: centralBankRegime.description, available: true, dependencyGroup: "MACRO_RATES" });
    supporting.push(`Central bank context available`);
  } else { missing.push("Central bank regime data"); }

  // COT
  const cotContext = data.cot ? {
    netNonCommercial: data.cot.netNonCommercial,
    changeInPositioning: data.cot.change,
    extremeLevel: data.cot.netNonCommercial !== undefined
      ? Math.abs(data.cot.netNonCommercial) > 100000 ? (data.cot.netNonCommercial > 0 ? "EXTREME_LONG" as const : "EXTREME_SHORT" as const) : "NEUTRAL" as const
      : "UNKNOWN" as const,
    available: data.cot.netNonCommercial !== undefined,
    description: data.cot.netNonCommercial !== undefined
      ? `COT: net non-commercial ${data.cot.netNonCommercial.toLocaleString()} contracts.`
      : "COT positioning unavailable.",
  } : undefined;

  if (cotContext?.available) {
    dims.push({ name: "cot_positioning", category: "POSITIONING", source: "CFTC", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: cotContext.description, available: true, dependencyGroup: "MACRO_COT" });
    supporting.push(`COT positioning available`);
  } else { missing.push("CFTC COT positioning data"); }

  // DXY
  const dxyContext = data.dxy ? {
    trend: classifyTrendStr(data.dxy.trend),
    regime: "UNKNOWN" as MarketRegime,
    available: !!data.dxy.trend,
    description: data.dxy.trend ? `DXY: trend ${classifyTrendStr(data.dxy.trend).toLowerCase()}.` : "DXY context unavailable.",
  } : undefined;

  if (dxyContext?.available) {
    dims.push({ name: "dxy_context", category: "CROSS_ASSET", source: "derived", quality: "DEGRADED", freshness: "FRESH", horizonRelevance: "PRIMARY", explanation: dxyContext.description, available: true, dependencyGroup: "MACRO_RATES" });
    supporting.push(`DXY context available`);
  } else { missing.push("DXY context"); }

  return {
    instrument,
    assetClass: "forex",
    assembledAt: Date.now(),
    rateDifferential,
    yieldDifferential,
    centralBankRegime,
    cotContext,
    dxyContext,
    macroSensitivity: data.macro ? {
      keyDrivers: data.macro.keyDrivers ?? [],
      upcomingEvents: data.macro.upcomingEvents ?? [],
      available: (data.macro.keyDrivers?.length ?? 0) > 0,
      description: `Macro: ${(data.macro.keyDrivers?.length ?? 0)} key drivers identified.`,
    } : undefined,
    dimensions: dims,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingInformation: missing,
  };
}

// ═══════════════════════════════════════════════════════════════
// EQUITY ANALYTICAL DEPTH
// ═══════════════════════════════════════════════════════════════

export interface EquityRawData {
  valuation?: { pe?: number; forwardPE?: number; pb?: number; evToEbitda?: number; marketCap?: number };
  growth?: { revenueGrowth?: number; earningsGrowth?: number };
  profitability?: { grossMargin?: number; operatingMargin?: number; netMargin?: number; roe?: number };
  balanceSheet?: { debtToEquity?: number; cash?: number; debt?: number; freeCashFlow?: number };
  earnings?: { lastDate?: string; nextDate?: string; lastEPS?: number; epsSurprise?: number };
  corporateActions?: { dividendYield?: number; buybacks?: boolean; dilutionRisk?: string };
  sector?: { sector?: string; industry?: string };
}

export function buildEquityAnalyticalDepth(
  instrument: string,
  data: EquityRawData,
): EquityAnalyticalDepth {
  const dims: AnalyticalDimension[] = [];
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];

  // Valuation
  const valuation = data.valuation ? {
    peRatio: data.valuation.pe,
    forwardPE: data.valuation.forwardPE,
    pbRatio: data.valuation.pb,
    evToEbitda: data.valuation.evToEbitda,
    marketCap: data.valuation.marketCap,
    relativeValuation: (data.valuation.pe !== undefined
      ? (data.valuation.pe < 15 ? "UNDERVALUED" : data.valuation.pe > 30 ? "OVERVALUED" : "FAIR")
      : "UNKNOWN") as "UNDERVALUED" | "FAIR" | "OVERVALUED" | "UNKNOWN",
    available: data.valuation.pe !== undefined,
    description: data.valuation.pe !== undefined
      ? `P/E: ${data.valuation.pe.toFixed(1)}, P/B: ${data.valuation.pb?.toFixed(1) ?? "N/A"}, EV/EBITDA: ${data.valuation.evToEbitda?.toFixed(1) ?? "N/A"}.`
      : "Valuation data unavailable.",
  } : undefined;

  if (valuation) {
    const v = valuation;
    dims.push({ name: "valuation", category: "VALUATION", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: v.description, available: true, dependencyGroup: "EQUITY_VALUATION" });
    supporting.push(`Valuation: P/E ${v.peRatio?.toFixed(1)}`);
  } else { missing.push("Valuation data"); }

  // Growth
  const growth = data.growth ? {
    revenueGrowth: data.growth.revenueGrowth,
    earningsGrowth: data.growth.earningsGrowth,
    available: data.growth.revenueGrowth !== undefined || data.growth.earningsGrowth !== undefined,
    description: data.growth.revenueGrowth !== undefined
      ? `Revenue growth: ${(data.growth.revenueGrowth * 100).toFixed(1)}%, earnings growth: ${(data.growth.earningsGrowth ?? 0 * 100).toFixed(1)}%.`
      : "Growth data unavailable.",
  } : undefined;

  if (growth) {
    const v = growth;
    dims.push({ name: "growth", category: "FUNDAMENTALS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: v.description, available: true, dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS" });
    supporting.push("Growth data available");
    dims.push({ name: "growth", category: "FUNDAMENTALS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: growth.description, available: true, dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS" });
    supporting.push(`Growth data available`);
  } else { missing.push("Growth data"); }

  // Profitability
  const profitability = data.profitability ? {
    grossMargin: data.profitability.grossMargin,
    operatingMargin: data.profitability.operatingMargin,
    netMargin: data.profitability.netMargin,
    roe: data.profitability.roe,
    available: data.profitability.netMargin !== undefined || data.profitability.roe !== undefined,
    description: data.profitability.netMargin !== undefined
      ? `Net margin: ${(data.profitability.netMargin * 100).toFixed(1)}%, ROE: ${(data.profitability.roe ?? 0 * 100).toFixed(1)}%.`
      : "Profitability data unavailable.",
  } : undefined;

  if (profitability) {
    const v = profitability;
    dims.push({ name: "profitability", category: "FUNDAMENTALS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: v.description, available: true, dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS" });
    supporting.push("Profitability data available");
    dims.push({ name: "profitability", category: "FUNDAMENTALS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: profitability.description, available: true, dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS" });
    supporting.push(`Profitability data available`);
  } else { missing.push("Profitability data"); }

  // Earnings
  const earnings = data.earnings ? {
    lastEarningsDate: data.earnings.lastDate,
    nextEarningsDate: data.earnings.nextDate,
    lastEPS: data.earnings.lastEPS,
    epsSurprise: data.earnings.epsSurprise,
    available: !!(data.earnings.lastDate || data.earnings.nextDate),
    description: data.earnings.nextDate ? `Next earnings: ${data.earnings.nextDate}.` : "Earnings schedule unavailable.",
  } : undefined;

  if (earnings) {
    const v = earnings;
    dims.push({ name: "earnings", category: "EARNINGS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: v.description, available: true, dependencyGroup: "EQUITY_EARNINGS" });
    supporting.push("Earnings context available");
    dims.push({ name: "earnings", category: "EARNINGS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: earnings.description, available: true, dependencyGroup: "EQUITY_EARNINGS" });
    supporting.push(`Earnings context available`);
  } else { missing.push("Earnings data"); }

  // Sector
  const sectorContext = data.sector?.sector ? {
    sector: data.sector.sector,
    industry: data.sector.industry,
    available: true,
    description: `Sector: ${data.sector.sector}${data.sector.industry ? ` / ${data.sector.industry}` : ""}.`,
  } : undefined;

  if (sectorContext) {
    dims.push({ name: "sector_context", category: "FUNDAMENTALS", source: "Alpha Vantage", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: sectorContext.description, available: true, dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS" });
    supporting.push(`Sector context: ${sectorContext.sector}`);
  } else { missing.push("Sector context"); }

  return {
    instrument,
    assetClass: "equity",
    assembledAt: Date.now(),
    valuation,
    growth,
    profitability,
    balanceSheet: data.balanceSheet ? {
      debtToEquity: data.balanceSheet.debtToEquity,
      cash: data.balanceSheet.cash,
      debt: data.balanceSheet.debt,
      freeCashFlow: data.balanceSheet.freeCashFlow,
      available: data.balanceSheet.debtToEquity !== undefined,
      description: `D/E: ${data.balanceSheet.debtToEquity?.toFixed(2) ?? "N/A"}.`,
    } : undefined,
    earnings,
    corporateActions: data.corporateActions ? {
      dividendYield: data.corporateActions.dividendYield,
      recentBuybacks: data.corporateActions.buybacks,
      dilutionRisk: (data.corporateActions.dilutionRisk ?? "UNKNOWN") as "LOW" | "MODERATE" | "HIGH" | "UNKNOWN",
      available: true,
      description: `Dividend yield: ${data.corporateActions.dividendYield !== undefined ? (data.corporateActions.dividendYield * 100).toFixed(2) + "%" : "N/A"}.`,
    } : undefined,
    sectorContext,
    dimensions: dims,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingInformation: missing,
  };
}

// ═══════════════════════════════════════════════════════════════
// COMMODITY ANALYTICAL DEPTH
// ═══════════════════════════════════════════════════════════════

export interface CommodityRawData {
  inventory?: { current?: number; changeWeekly?: number; changeVsExpected?: number };
  supplyDemand?: { production?: number; consumption?: number; surplus?: number };
  futuresStructure?: { structure?: string; frontPrice?: number; backPrice?: number };
  cot?: { managedMoneyNet?: number; change?: number; commercialNet?: number };
  seasonality?: { tendency?: string; currentPosition?: string };
  dxy?: { trend?: string };
  crossCommodity?: { relationships?: { instrument: string; relationship: string }[] };
}

export function buildCommodityAnalyticalDepth(
  instrument: string,
  data: CommodityRawData,
): CommodityAnalyticalDepth {
  const dims: AnalyticalDimension[] = [];
  const supporting: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];

  // Inventory
  const inventory = data.inventory ? {
    currentInventory: data.inventory.current,
    changeWeekly: data.inventory.changeWeekly,
    changeVsExpected: data.inventory.changeVsExpected,
    available: data.inventory.current !== undefined,
    description: data.inventory.current !== undefined
      ? `Inventory: ${(data.inventory.current / 1e6).toFixed(1)}M bbl, weekly change: ${data.inventory.changeWeekly !== undefined ? (data.inventory.changeWeekly > 0 ? "+" : "") + data.inventory.changeWeekly.toFixed(1) + "M" : "N/A"}.`
      : "Inventory data unavailable.",
  } : undefined;

  if (inventory?.available) {
    dims.push({ name: "inventory", category: "INVENTORY", source: "EIA", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "PRIMARY", explanation: inventory.description, available: true, dependencyGroup: "COMMODITY_INVENTORY" });
    supporting.push(`Inventory data available`);
  } else { missing.push("Inventory data"); }

  // Futures Structure
  const futuresStructure = data.futuresStructure ? {
    structure: classifyFuturesStructure(data.futuresStructure.structure),
    available: !!data.futuresStructure.structure,
    description: data.futuresStructure.structure ? `Futures structure: ${data.futuresStructure.structure}.` : "Futures structure unavailable.",
  } : undefined;

  if (futuresStructure?.available) {
    dims.push({ name: "futures_structure", category: "FUTURES_STRUCTURE", source: "market", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: futuresStructure.description, available: true, dependencyGroup: "COMMODITY_FUTURES_STRUCTURE" });
    supporting.push(`Futures structure: ${futuresStructure.structure}`);
  } else { missing.push("Futures structure data"); }

  // COT
  const cotContext = data.cot ? {
    managedMoneyNet: data.cot.managedMoneyNet,
    commercialNet: data.cot.commercialNet,
    changeInPositioning: data.cot.change,
    extremeLevel: data.cot.managedMoneyNet !== undefined
      ? Math.abs(data.cot.managedMoneyNet) > 100000 ? (data.cot.managedMoneyNet > 0 ? "EXTREME_LONG" as const : "EXTREME_SHORT" as const) : "NEUTRAL" as const
      : "UNKNOWN" as const,
    available: data.cot.managedMoneyNet !== undefined,
    description: data.cot.managedMoneyNet !== undefined
      ? `COT managed money net: ${data.cot.managedMoneyNet.toLocaleString()} contracts.`
      : "COT positioning unavailable.",
  } : undefined;

  if (cotContext?.available) {
    dims.push({ name: "cot_positioning", category: "POSITIONING", source: "CFTC", quality: "DEGRADED", freshness: "STALE", horizonRelevance: "SECONDARY", explanation: cotContext.description, available: true, dependencyGroup: "COMMODITY_COT" });
    supporting.push(`COT positioning available`);
  } else { missing.push("CFTC COT positioning data"); }

  // Dollar sensitivity
  const dollarSensitivity = data.dxy ? {
    dxyTrend: classifyTrendStr(data.dxy.trend),
    available: !!data.dxy.trend,
    description: `DXY trend: ${classifyTrendStr(data.dxy.trend).toLowerCase()}. USD sensitivity context.`,
  } : undefined;

  if (dollarSensitivity?.available) {
    dims.push({ name: "dollar_sensitivity", category: "CROSS_ASSET", source: "derived", quality: "DEGRADED", freshness: "FRESH", horizonRelevance: "SECONDARY", explanation: dollarSensitivity.description, available: true, dependencyGroup: "MACRO_RATES" });
    supporting.push(`Dollar sensitivity context available`);
  } else { missing.push("Dollar sensitivity context"); }

  return {
    instrument,
    assetClass: "commodity",
    assembledAt: Date.now(),
    inventory,
    supplyDemand: data.supplyDemand ? {
      production: data.supplyDemand.production,
      consumption: data.supplyDemand.consumption,
      surplus: data.supplyDemand.surplus,
      available: data.supplyDemand.surplus !== undefined,
      description: data.supplyDemand.surplus !== undefined
        ? `Supply/demand: surplus ${data.supplyDemand.surplus > 0 ? "+" : ""}${data.supplyDemand.surplus.toFixed(1)}M.`
        : "Supply/demand data unavailable.",
    } : undefined,
    futuresStructure,
    cotContext,
    seasonality: data.seasonality ? {
      seasonalTendency: data.seasonality.tendency,
      currentSeasonalPosition: data.seasonality.currentPosition,
      available: !!data.seasonality.tendency,
      description: data.seasonality.tendency ? `Seasonality: ${data.seasonality.tendency}.` : "Seasonality data unavailable.",
    } : undefined,
    dollarSensitivity,
    crossCommodity: data.crossCommodity?.relationships ? {
      relationships: data.crossCommodity.relationships.map(r => ({ ...r, strength: "MODERATE" as string })),
      available: true,
    } : undefined,
    dimensions: dims,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingInformation: missing,
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL ANALYTICAL CONTEXT ASSEMBLER
// ═══════════════════════════════════════════════════════════════

export function assembleUniversalAnalyticalContext(params: {
  instrument: string;
  assetClass: AssetClass;
  crypto?: CryptoAnalyticalDepth;
  forex?: ForexAnalyticalDepth;
  equity?: EquityAnalyticalDepth;
  commodity?: CommodityAnalyticalDepth;
  index?: IndexAnalyticalDepth;
  macro?: MacroAnalyticalDepth;
  marketRegime?: MarketRegime;
}): UniversalAnalyticalContext {
  const { instrument, assetClass } = params;

  const assetDepth = params.crypto ?? params.forex ?? params.equity ?? params.commodity ?? params.index ?? params.macro;
  const allDimensions = assetDepth?.dimensions ?? [];
  const supporting = assetDepth?.supportingEvidence ?? [];
  const conflicting = assetDepth?.conflictingEvidence ?? [];
  const missing = assetDepth?.missingInformation ?? [];

  const availableCount = allDimensions.filter(d => d.available).length;
  const totalCount = allDimensions.length;

  const summaryParts: string[] = [];
  if (params.crypto) summaryParts.push("Crypto intelligence");
  if (params.forex) summaryParts.push("Forex intelligence");
  if (params.equity) summaryParts.push("Equity intelligence");
  if (params.commodity) summaryParts.push("Commodity intelligence");
  if (params.index) summaryParts.push("Index intelligence");
  if (params.macro) summaryParts.push("Macro intelligence");
  if (params.marketRegime) summaryParts.push(`Regime: ${params.marketRegime.toLowerCase()}`);

  return {
    instrument,
    assetClass,
    assembledAt: Date.now(),
    crypto: params.crypto,
    forex: params.forex,
    equity: params.equity,
    commodity: params.commodity,
    index: params.index,
    macro: params.macro,
    marketRegime: params.marketRegime,
    overallDimensions: allDimensions,
    allEvidence: [], // Evidence is built at a higher level
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingInformation: missing,
    dataFlags: missing.length > 0 ? [`MISSING:${missing.length}_sources`] : [],
    analystSummary: `${summaryParts.join(", ") || "No intelligence"}: ${availableCount}/${totalCount} dimensions available.`,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function classifyLevel(value: number, highThreshold: number, lowThreshold: number): string {
  if (value > highThreshold) return "HIGH";
  if (value < lowThreshold) return "LOW";
  return "NORMAL";
}

function classifyTrend(change?: number): "RISING" | "FALLING" | "STABLE" | "UNKNOWN" {
  if (change === undefined) return "UNKNOWN";
  if (change > 2) return "RISING";
  if (change < -2) return "FALLING";
  return "STABLE";
}

function classifyTrendStr(trend?: string): "RISING" | "FALLING" | "STABLE" | "UNKNOWN" {
  if (!trend) return "UNKNOWN";
  const t = trend.toLowerCase();
  if (t === "up" || t === "rising" || t === "bullish") return "RISING";
  if (t === "down" || t === "falling" || t === "bearish") return "FALLING";
  if (t === "stable" || t === "neutral") return "STABLE";
  return "UNKNOWN";
}

function classifyFunding(rate: number): "EXTREME_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "EXTREME_NEGATIVE" {
  if (rate > 0.001) return "EXTREME_POSITIVE";
  if (rate > 0.0001) return "POSITIVE";
  if (rate < -0.001) return "EXTREME_NEGATIVE";
  if (rate < -0.0001) return "NEGATIVE";
  return "NEUTRAL";
}

function classifyCentralBankBias(bias?: string): "HAWKISH" | "DOVISH" | "NEUTRAL" | "CHANGING" | "UNKNOWN" {
  if (!bias) return "UNKNOWN";
  const b = bias.toLowerCase();
  if (b.includes("hawk")) return "HAWKISH";
  if (b.includes("dove")) return "DOVISH";
  if (b.includes("neutral") || b.includes("steady")) return "NEUTRAL";
  if (b.includes("changing") || b.includes("shift")) return "CHANGING";
  return "UNKNOWN";
}

function classifyFuturesStructure(structure?: string): "CONTANGO" | "BACKWARDATION" | "FLAT" | "UNKNOWN" {
  if (!structure) return "UNKNOWN";
  const s = structure.toLowerCase();
  if (s.includes("contango")) return "CONTANGO";
  if (s.includes("backwardation")) return "BACKWARDATION";
  if (s.includes("flat")) return "FLAT";
  return "UNKNOWN";
}

function classifyTvlTrend(change?: number): "GROWING" | "DECLINING" | "STABLE" | "UNKNOWN" {
  if (change === undefined) return "UNKNOWN";
  if (change > 2) return "GROWING";
  if (change < -2) return "DECLINING";
  return "STABLE";
}

function formatNum(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
