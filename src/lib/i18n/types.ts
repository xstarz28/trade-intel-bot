/**
 * i18n type definitions.
 *
 * Translation keys are organized by domain.
 * Each leaf value is a string that will be translated.
 * Nested objects are allowed for grouping but leaves are always strings.
 */

/**
 * Supported locale codes.
 * Extend this union when adding new languages.
 */
export type Locale = "en" | "id" | "es" | "fr" | "pt" | "de" | "ja" | "ko" | "zh";

/** All locales (including planned but not yet enabled) */
export const ALL_LOCALES: Locale[] = ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"];

// NOTE: SUPPORTED_LOCALES and LOCALE_LABELS are defined in locales.ts
// and derived from the canonical LOCALE_REGISTRY. They are re-exported
// from index.ts for backward compatibility. Do NOT duplicate them here.

/** Default fallback locale */
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
    // Per-position thesis intelligence (Phase 139)
    positionThesis: string;
    intelUnavailable: string;
    // Global macro/cross-asset context (Phase 140)
    macroContext: string;
    macroScopeNote: string;
    macroUnavailable: string;
    // Investor decision synthesis (Phase 141)
    decisionContext: string;
    decisionStateAligned: string;
    decisionStateConflict: string;
    decisionInfo: string;
    portfolio: string;
    // Portfolio-level aggregation (Phase 143)
    portfolioSummary: string;
    portfolioState: string;
    usableIntel: string;
    insufficientIntel: string;
    unavailableIntel: string;
    concentration: string;
    multiplePositions: string;
    portfolioInfo: string;
    globalMacroCaution: string;
    // Portfolio monitoring summary (Phase 144)
    monitorSummary: string;
    monitorInfo: string;
    monitorStateLabel: string;
    monitorIdle: string;
    monitorStable: string;
    monitorWatch: string;
    monitorElevated: string;
    monitorSevere: string;
    monitorReasonNoPositions: string;
    monitorReasonInvalidated: string;
    monitorReasonConflict: string;
    monitorReasonHighRisk: string;
    monitorReasonCaution: string;
    monitorReasonInsufficientData: string;
    monitorReasonUnavailable: string;
    monitorReasonPartialCoverage: string;
    monitorReasonMacroCaution: string;
    monitorReasonMacroStale: string;
    monitorReasonMacroLimited: string;
    monitorReasonMacroUnavailable: string;
    monitorReasonConcentration: string;
    // Horizon labels
    horizonScalping: string;
    horizonIntraday: string;
    horizonSwing: string;
    horizonInvesting: string;
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
    monitoredCount: string;
    alertsCount: string;
    criticalCount: string;
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
    // Protection panel labels
    protectionReference: string;
    protectionTimeline: string;
    alertHistory: string;
    eventsCount: string;
    noEventsRecorded: string;
    protectionAction: string;
    whyNow: string;
    profitStatusLabel: string;
    changedLabel: string;
    confirmationsLabel: string;
    stillSupportingLabel: string;
    missingLabel: string;
    pause: string;
    resume: string;
    remove: string;
    ack: string;
    monitoringGap: string;
    lastMarketUpdate: string;
    disclaimersNoAuto: string;
    disclaimersNotAdvice: string;
    disclaimersConfidence: string;
    abnormalPriceAcceleration: string;
    givebackAccelerationLabel: string;
    dataStaleWarning: string;
    reconnectingMessage: string;
    monitoringPausedMessage: string;
    riskSignalsElevated: string;
    peakProfitGivenBack: string;
    events: string;
    dropped: string;
    shockLabel: string;
    registeredToast: string;
    registeredToastDesc: string;
    removedToast: string;
    toastThesisHealthy: string;
    toastHealthyDesc: string;
    toastThesisInvalidated: string;
    persistencePersisted: string;
    persistenceLocalOnly: string;
    persistenceDegraded: string;
    dataDegraded: string;
    dataLive: string;
    dataConnecting: string;
    dataNoData: string;
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
    sensitivity: string;
    primary: string;
    secondary: string;
    contextLabel: string;
    baseCase: string;
    alternative: string;
    invalidationScenario: string;
    // IntelSection
    unavailableBadge: string;
    dataUnavailableMessage: string;
    noEvidence: string;
    // Analytical summary labels
    marketLabel: string;
    positionLabel: string;
    thesisLabel: string;
    whyLabel: string;
    invalidationLabel: string;
    watchLabel: string;
    confidenceLabel: string;
    // What changed
    awaitingFirstAnalysis: string;
    noMaterialChange: string;
    // News item
    relevanceLabel: string;
    impactLabel: string;
    // Position impact mapping
    impactSupporting: string;
    impactConflicting: string;
    impactNeutral: string;
    impactInsufficient: string;
    // News stance mapping
    stanceSupporting: string;
    stanceConflicting: string;
    stanceMixed: string;
    stanceNeutral: string;
    stanceInsufficient: string;
    stanceUnknown: string;
    // Relevance mapping
    relevanceDirect: string;
    relevanceHigh: string;
    relevanceModerate: string;
    relevanceLow: string;
    relevanceIrrelevant: string;
    relevanceUnknown: string;
    confidenceStrong: string;
    confidenceModerate: string;
    confidenceWeak: string;
    confidenceInsufficient: string;
    confidenceHigh: string;
    confidenceMedium: string;
    confidenceLow: string;
    derivatives: string;
    // Trend/direction display
    trending: string;
    ranging: string;
    // Analytical context panel labels
    marketStructure: string;
    volatilityLabel: string;
    breadth: string;
    valuation: string;
    riskRegime: string;
    missing: string;
    dimensionsCount: string;
    // Portfolio intelligence section labels
    portfolioSummary: string;
    marketContextHeader: string;
    alignmentsHeader: string;
    conflictsHeader: string;
    exposureHeader: string;
    watchNextHeader: string;
    dataStatusHeader: string;
    dominantLabel: string;
    riskLabel: string;
    evidenceLabel: string;
    registerPositionsMessage: string;
    positionsLabel: string;
    healthyLabel: string;
    cautionLabel: string;
    deterioratingLabel: string;
    invalidatedLabel: string;
    noDataLabel: string;
    // Feed section labels
    intelligenceFeed: string;
    noRelevantNews: string;
    noPositionsMonitorHint: string;
    multiLabel: string;
    noRelevantNewsList: string;
    crossPositionCatalyst: string;
    supportingCountLabel: string;
    conflictingCountLabel: string;
    neutralCountLabel: string;
    // Score breakdown labels
    scoreVeryBearish: string;
    scoreBearish: string;
    scoreNeutralLabel: string;
    scoreBullish: string;
    scoreVeryBullish: string;
    factorStructure: string;
    factorIndicators: string;
    factorFundamentals: string;
    factorSentiment: string;
    // Decision context
    actionLabel: string;
    actionRecommendation: string;
    pullbackLabel: string;
    pullbackNormal: string;
    pullbackEarlyCorrection: string;
    pullbackDeterioration: string;
    pullbackStructuralReversal: string;
    pullbackShockReversal: string;
    pullbackInsufficientData: string;
    dataQualityLabel: string;
    dataQualityInsufficient: string;
    observationCount: string;
    supportingCount: string;
    conflictingCount: string;
    allWatchItems: string;
    allInvalidations: string;
    evidenceSummaryLabel: string;
    thesisSupportLabel: string;
    thesisConflictLabel: string;
    whatWouldChangeLabel: string;
    riskProtectionLabel: string;
    positionMetricsLabel: string;
    technicalContextLabel: string;
    fundamentalContextLabel: string;
    macroContextLabel: string;
    crossAssetContextLabel: string;
    scenarioBaseLabel: string;
    scenarioAltLabel: string;
    scenarioInvalidLabel: string;
    noDataYet: string;
    insufficientEvidence: string;
    catalystHeader: string;
    feedHeader: string;
    feedNoMaterialNews: string;
    feedNoRelevantNews: string;
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
    invalidationStatusNotApproaching: string;
    invalidationStatusApproaching: string;
    invalidationStatusTriggered: string;
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
    staleDataDetected: string;
    history: string;
    hideHistory: string;
    noHealthData: string;
    healthMetricsHint: string;
    providers: string;
    stale: string;
    staleLabel: string;
    unavailable: string;
    unavailableLabel: string;
    updated: string;
    updatedLabel: string;
    historyCount: string;
    intelligence: string;
    intelligenceLabel: string;
    alerts: string;
    alertsLabel: string;
    componentsMarketData: string;
    componentsOhlcv: string;
    componentsNews: string;
    componentsMacro: string;
    componentsCrossAsset: string;
    componentsIntelligence: string;
    componentsPortfolio: string;
    componentsAlertRules: string;
    componentsNotifications: string;
    componentsHistorical: string;
    justNow: string;
    unavailableCount: string;
    pollingLabel: string;
    stoppedLabel: string;
    lastUpdateLabel: string;
    neverLabel: string;
    connectedCount: string;
    degradedCount: string;
    unavailableStatusLabel: string;
    modeLabel: string;
    marketDataHealthTitle: string;
    freshMessage: string;
    degradedMessage: string;
    staleMessage: string;
    unavailableMessage: string;
    noProvidersConfigured: string;
    freshnessLabel: string;
    recoveryLabel: string;
    instrumentsLabel: string;
    activeLabel: string;
    failuresLabel: string;
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

  // ─── Instrument Entry Form (Phase 145) ──────────────────────
  entryForm: {
    instrumentLabel: string;
    typeLabel: string;
    timeframeLabel: string;
    styleLabel: string;
    analyzing: string;
    runLabel: string;
    backendNote: string;
    registerTitle: string;
    currentPrice: string;
    stopLossOptional: string;
    takeProfitOptional: string;
    leverageOptional: string;
    registerButton: string;
  };

  // ─── Analysis History Panel (Phase 146) ─────────────────────
  analysisHistory: {
    title: string;
    emptyHint: string;
  };

  // ─── Market Opportunities Panel (Phase 146) ─────────────────
  marketPanel: {
    title: string;
    staticBadge: string;
    rankedCount: string;
    excludedCount: string;
    lastScan: string;
    scanMeta: string;
    radarMeta: string;
    filters: string;
    filterAssetClass: string;
    filterRegion: string;
    allOption: string;
    allRegions: string;
    globalOption: string;
    scanning: string;
    noOpportunity: string;
    noOpportunityHint: string;
    noSuitableHint: string;
    expiredInvalidated: string;
    changesSinceScan: string;
    scoreLabel: string;
    confidenceLabel: string;
    spreadLabel: string;
    supportingLabel: string;
    conflictsLabel: string;
    missingLabel: string;
    invalidationLabel: string;
    risksLabel: string;
    coverageLabel: string;
    updatedLabel: string;
    analysisLabel: string;
    lessLabel: string;
    moreLabel: string;
    whyThisAsset: string;
    showExcluded: string;
    hideExcluded: string;
    rankingDisclaimer: string;
    rankingConfidenceNote: string;
    liveScanNote: string;
    horizon1_4Weeks: string;
    horizon1_3Months: string;
    horizon3_6Months: string;
    horizon6_12Months: string;
    horizon1_3Years: string;
    horizon3PlusYears: string;
    freshness: {
      fresh: string;
      recent: string;
      delayed: string;
      stale: string;
      unavailable: string;
    };
    suitability: {
      topOpportunity: string;
      watchlist: string;
      neutral: string;
      excluded: string;
      insufficientData: string;
    };
    completeness: {
      full: string;
      partial: string;
      minimal: string;
      none: string;
    };
  };

  // ─── Analysis Result Panel — Top-Level Chrome (Phase 146) ───
  analysisResult: {
    confluenceScore: string;
    candlesCount: string;
    noTradeRejected: string;
    informationalNotDirectional: string;
    evidenceNotProbability: string;
    fromYourInputs: string;
    crossAssetRegimeNote: string;
    fundamentalContextNote: string;
    derivativesContextNote: string;
    forexContextNote: string;
    saveJournalCta: string;
    convictionPrefix: string;
    dataFull: string;
    dataPartial: string;
    dataLimited: string;
    riskNoteDisclaimer: string;
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
    simulated: string;
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
    accelerating: string;
    supplyDriven: string;
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
    thesisLabel: string;
    trendLabel: string;
    evidenceSummary: string;
    systemLabel: string;
    noHealthData: string;
    allOperational: string;
    evidenceTraceThesisLabel: string;
    supportingLabel: string;
    conflictingLabel: string;
    neutralLabel: string;
    totalLabel: string;
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

  // ─── Portfolio Intelligence ─────────────────────────────────
  portfolio: {
    empty: string;
    summary: string;
    positions: string;
    healthy: string;
    caution: string;
    deteriorating: string;
    invalidated: string;
    noData: string;
    dominant: string;
    evidence: string;
    marketContext: string;
    risk: string;
    alignments: string;
    conflicts: string;
    exposure: string;
    watchNext: string;
    dataStatus: string;
    alignmentRegimeMatch: string;
    alignmentHtfAlignment: string;
    alignmentConcentration: string;
    alignmentDirectionalConcentration: string;
    conflictDirectDirectional: string;
    conflictEvidenceConflict: string;
    conflictRegime: string;
  };

  // ─── Historical Timeline ────────────────────────────────────
  timeline: {
    initialAnalysis: string;
    thesisChange: string;
    regimeChange: string;
    timeframeChange: string;
    structureChange: string;
    momentumChange: string;
    volatilityChange: string;
    evidenceChange: string;
    newsChange: string;
    macroChange: string;
    dataQualityChange: string;
  };
}
