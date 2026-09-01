/**
 * i18n type definitions.
 *
 * Translation keys are organized by domain.
 * Each leaf value is a string that will be translated.
 * Nested objects are allowed for grouping but leaves are always strings.
 */

export type Locale = "en" | "id";

export const SUPPORTED_LOCALES: Locale[] = ["en", "id"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  id: "Bahasa Indonesia",
};

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Translation key structure.
 * Add new keys here to get TypeScript checking on both en and id resource files.
 */
export interface Translations {
  // ─── Global ────────────────────────────────────────────────
  global: {
    loading: string;
    error: string;
    empty: string;
    back: string;
    save: string;
    cancel: string;
    close: string;
    confirm: string;
    exit: string;
    search: string;
    filter: string;
    refresh: string;
    noData: string;
    disclaimer: string;
  };

  // ─── Navigation ────────────────────────────────────────────
  nav: {
    analysis: string;
    protection: string;
    portfolio: string;
    intelligence: string;
    positions: string;
    feed: string;
    alerts: string;
    notifications: string;
    market: string;
    system: string;
    rules: string;
  };

  // ─── Workspace ─────────────────────────────────────────────
  workspace: {
    trader: string;
    investor: string;
    trading: string;
    investing: string;
    traderRole: string;
    investorRole: string;
    investorWorkspaceTitle: string;
    investorWorkspaceSubtitle: string;
  };

  // ─── Dashboard ─────────────────────────────────────────────
  dashboard: {
    terminalReady: string;
    terminalDescription: string;
    factors: string;
    timeframes: string;
    instruments: string;
    selectInstrument: string;
  };

  // ─── Investor Workspace ────────────────────────────────────
  investor: {
    noPositions: string;
    noPositionsHint: string;
    portfolioHealth: string;
    positions: string;
    healthy: string;
    atRisk: string;
    invalidated: string;
    riskSummary: string;
    riskLevel: string;
    withSL: string;
    withTP: string;
    low: string;
    moderate: string;
    elevated: string;
    horizonDistribution: string;
    dataQuality: string;
    positionsRegistered: string;
    withStopLoss: string;
    withTakeProfit: string;
    investmentIntelligence: string;
    noExecution: string;
    manualAction: string;
  };

  // ─── Position Protection ───────────────────────────────────
  protection: {
    noPositions: string;
    noPositionsHint: string;
    addPosition: string;
    overview: string;
    informationalOnly: string;
    noAutoExecute: string;
    confidenceNotProbability: string;
  };

  // ─── Intelligence ──────────────────────────────────────────
  intelligence: {
    technical: string;
    fundamental: string;
    macro: string;
    crossAsset: string;
    news: string;
    economicCalendar: string;
    inflation: string;
    policyRate: string;
    realYield: string;
    currency: string;
    liquidity: string;
    growth: string;
    energy: string;
    geopolitics: string;
    riskSentiment: string;
    causalTransmission: string;
    alignment: string;
    supporting: string;
    conflicting: string;
    neutral: string;
    unavailable: string;
    insufficientData: string;
    observed: string;
    derived: string;
  };

  // ─── Decision Support ──────────────────────────────────────
  decision: {
    supportingEvidence: string;
    conflictingEvidence: string;
    whatCouldChange: string;
    whatToMonitor: string;
    dataAvailability: string;
    thesisHealth: string;
    thesisState: string;
    invalidation: string;
    watchItems: string;
  };

  // ─── Status Labels ─────────────────────────────────────────
  status: {
    available: string;
    unavailable: string;
    insufficientData: string;
    healthy: string;
    stable: string;
    caution: string;
    deteriorating: string;
    severelyDeteriorating: string;
    invalidated: string;
    unknown: string;
    none: string;
    watch: string;
    highRisk: string;
  };

  // ─── Macro Regime ──────────────────────────────────────────
  macro: {
    regime: string;
    stagflation: string;
    reflation: string;
    disinflation: string;
    contraction: string;
    recovery: string;
    riskOn: string;
    riskOff: string;
    stressed: string;
    mixed: string;
    insufficientData: string;
    dataPoints: string;
    economicEvents: string;
  };

  // ─── Fundamental ───────────────────────────────────────────
  fundamental: {
    macroRegime: string;
    inflationRatesYieldsCurrency: string;
    growthEnergyGeopolitical: string;
    fundamentalEvidence: string;
    technicalVsFundamental: string;
    fundamentalTransmission: string;
    whatCouldChangeMonitor: string;
    dataAvailability: string;
    actual: string;
    previous: string;
    forecast: string;
    surprise: string;
    aboveExpectation: string;
    belowExpectation: string;
    inLine: string;
    easing: string;
    neutral: string;
    tightening: string;
    restrictive: string;
    transitioning: string;
    rising: string;
    falling: string;
    stable: string;
    strengthening: string;
    weakening: string;
    volatile: string;
    expanding: string;
    slowing: string;
    contracting: string;
    recovering: string;
    supplyDisruption: string;
    demandDriven: string;
    balanced: string;
    oilShock: string;
    low: string;
    elevated: string;
    escalating: string;
    deescalating: string;
  };
}
