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
    guest: string;
    previewRuntimeError: string;
    unknownRuntimeError: string;
  };

  // ─── Navigation ────────────────────────────────────────────
  nav: {
    overview: string;
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
    detectingInstrument: string;
    fetchingMarketData: string;
    fetchingIntelligence: string;
    calculatingIndicators: string;
    generatingBias: string;
    dataFetchFailed: string;
    providerNotConfigured: string;
    checkApiKey: string;
    notFound: string;
    pageNotFound: string;
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
    portfolio: string;
  };

  // ─── Position Protection ───────────────────────────────────
  protection: {
    noPositions: string;
    noPositionsHint: string;
    addPosition: string;
    cancel: string;
    overview: string;
    informationalOnly: string;
    noAutoExecute: string;
    confidenceNotProbability: string;
    removeFromMonitoring: string;
    positionsCount: string;
    title: string;
    instrumentLabel: string;
    sideLabel: string;
    horizonLabel: string;
    entryPriceLabel: string;
    stopLossLabel: string;
    takeProfitLabel: string;
    leverageLabel: string;
    note: string;
    notePlaceholder: string;
    confirmRemove: string;
    technicalIntelligence: string;
    mtfAnalysis: string;
    fundamentalIntelligence: string;
    macroIntelligence: string;
    crossAssetIntelligence: string;
    causalTransmission: string;
    techFundAlignment: string;
    decisionSupportTitle: string;
    invalidationConditions: string;
    watchItems: string;
    alertsTitle: string;
    notificationsTitle: string;
    portfolioIntelligence: string;
    controlCenter: string;
    positionsLabel: string;
    profitable: string;
    watchCaution: string;
    criticalLabel: string;
    connected: string;
    monitoring: string;
    supportingEvidence: string;
    conflictingEvidence: string;
    missingCriticalData: string;
    alertTimeline: string;
    monitoringPaused: string;
    disableToasts: string;
    enableToasts: string;
    currentProfit: string;
    giveback: string;
    peakProfit: string;
    protectionRef: string;
    disableRule: string;
    enableRule: string;
    deleteRule: string;
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
    newsIntelligence: string;
    fundamentals: string;
    evidenceHierarchy: string;
    scenarios: string;
    whatChanged: string;
    analyticalSummary: string;
    keyLevelsLabel: string;
    historicalTimeline: string;
    invalidation: string;
    nextLevel: string;
    catalyst: string;
    primary: string;
    secondary: string;
    contextLabel: string;
    baseCase: string;
    alternative: string;
    invalidationScenario: string;
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

  // ─── Alert Rules ────────────────────────────────────────────
  alerts: {
    title: string;
    createRule: string;
    editRule: string;
    deleteRule: string;
    ruleName: string;
    condition: string;
    severity: string;
    scope: string;
    instrument: string;
    position: string;
    cooldown: string;
    enabled: string;
    disabled: string;
    save: string;
    cancel: string;
    noRules: string;
    noRulesHint: string;
    positionScope: string;
    instrumentScope: string;
    portfolioScope: string;
    globalScope: string;
    info: string;
    low: string;
    medium: string;
    high: string;
    critical: string;
  };

  // ─── Notifications ──────────────────────────────────────────
  notifications: {
    title: string;
    markAllRead: string;
    dismiss: string;
    noNotifications: string;
    noUnread: string;
    unread: string;
    read: string;
    ago: string;
    now: string;
    minutes: string;
    hours: string;
    days: string;
  };

  // ─── Market Overview ────────────────────────────────────────
  market: {
    title: string;
    live: string;
    stale: string;
    unavailable: string;
    vix: string;
    dxy: string;
    us10y: string;
    wti: string;
    noData: string;
  };

  // ─── System / Runtime Health ────────────────────────────────
  system: {
    title: string;
    overallStatus: string;
    healthy: string;
    degraded: string;
    failed: string;
    components: string;
    lastUpdate: string;
    noData: string;
    intelligenceCycle: string;
    alertPipeline: string;
    persistence: string;
    allOperational: string;
  };

  // ─── Analysis ───────────────────────────────────────────────
  analysis: {
    runAnalysis: string;
    analyzing: string;
    selectInstrument: string;
    timeframe: string;
    noResult: string;
    confidence: string;
    bias: string;
    recommendation: string;
    bullish: string;
    bearish: string;
    noTrade: string;
    long: string;
    short: string;
    technicalSummary: string;
    fundamentalSummary: string;
    keyLevels: string;
    support: string;
    resistance: string;
    invalidationLevel: string;
    riskNote: string;
    dataCompleteness: string;
  };

  // ─── Forms ──────────────────────────────────────────────────
  forms: {
    required: string;
    optional: string;
    invalid: string;
    enterPrice: string;
    enterInstrument: string;
    selectSide: string;
    selectHorizon: string;
    selectTimeframe: string;
  };

  // ─── Empty States ───────────────────────────────────────────
  emptyStates: {
    noPositions: string;
    noAlerts: string;
    noNotifications: string;
    noNews: string;
    noMarketData: string;
    noAnalysis: string;
    noHistory: string;
    selectToBegin: string;
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
    live: string;
    reconnecting: string;
    dataStale: string;
    disconnected: string;
    monitoringPaused: string;
    limited: string;
    insufficient: string;
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
    overall: string;
    inflationLabel: string;
    inflationSurprise: string;
    driver: string;
    marketRates: string;
    policyRateLabel: string;
    realYields: string;
    usd: string;
    liquidityLabel: string;
    tips10y: string;
    observedLabel: string;
    econEvents: string;
    growthLabel: string;
    energyLabel: string;
    geopolitical: string;
    assessment: string;
    alignmentLabel: string;
    regimeLabel: string;
    supportingForces: string;
    conflictingForces: string;
    causalChain: string;
    unavailableLabel: string;
    fundamentalEvidenceLabel: string;
  };

  // ─── Trader Workspace Sections ──────────────────────────
  trader: {
    portfolioOverview: string;
    positions: string;
    portfolioContext: string;
    dataQuality: string;
    systemHealth: string;
    actions: string;
    decisionSupport: string;
    evidenceTrace: string;
    currentAssessment: string;
    activeAlerts: string;
    unread: string;
    dominant: string;
    noPositionsRegistered: string;
    viewAll: string;
    details: string;
    unavailableDataWarning: string;
    positionMetrics: string;
    marketContext: string;
    entry: string;
    current: string;
    pnl: string;
    sl: string;
    tp: string;
    shortTerm: string;
    mediumTerm: string;
    volatility: string;
    positionDisclaimer: string;
    evidenceBasedDisclaimer: string;
    viewAlerts: string;
    systemHealthBtn: string;
    thesisDistribution: string;
    conflicts: string;
    alignments: string;
    watchList: string;
    monitor: string;
  };

  // ─── Journal ─────────────────────────────────────────────
  journal: {
    title: string;
    createEntry: string;
    backToDashboard: string;
    createJournalEntry: string;
    snapshotDescription: string;
    journalAsTrade: string;
    journalAsObservation: string;
    entryReason: string;
    thesisAtEntry: string;
    confirmationObserved: string;
    invalidationObserved: string;
    whatWentRight: string;
    whatWentWrong: string;
    lessons: string;
    notes: string;
    engineAnalysisSnapshot: string;
    trade: string;
    actions: string;
    review: string;
    done: string;
    edit: string;
    total: string;
    open: string;
    closed: string;
    planned: string;
    filterInstrument: string;
    allStatus: string;
    noJournalEntries: string;
    noEntriesMatchFilters: string;
  };
}
