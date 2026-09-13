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
    /** Heading of the rule-creation form. */
    newAlertRule: string;
    /** Label for the position identifier field. */
    positionId: string;
    /** Heading of the configured-rules list. */
    alertRules: string;
    /** Shown while the rule list is still resolving. */
    loadingRules: string;
    /** Heading of the recently-triggered alerts list. */
    recentAlerts: string;
    /** Empty state for the triggered-alerts list. */
    noAlertsTriggered: string;
    /** Example rule name. Prose, so it is translated; the instrument stays. */
    ruleNamePlaceholder: string;
    /**
     * "for example" prefix for a format hint, e.g. `{example}` -> "BTC/USDT".
     * The ABBREVIATION is translated ("z. B.", "p. ex.", "例:"); the example
     * value stays untranslated because it is provider-native notation.
     */
    examplePrefix: string;
  };

  // ─── Notifications ──────────────────────────────────────────
  notifications: {
    title: string;
    /** Heading above the severity filter. */
    minimumSeverity: string;
    /** Toggle: include notifications already read. */
    showRead: string;
    /** Toggle: include notifications already dismissed. */
    showDismissed: string;
    /** Restores the default notification preferences. */
    resetToDefaults: string;
    /** Secondary line under the empty state, explaining what will appear. */
    alertsWillAppearHere: string;
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
    /**
     * Legend explaining what the LIVE / STALE / — badges mean. This is a
     * data-provenance statement, so it must be translated: an English-only
     * legend leaves non-English users unable to judge data currency.
     */
    sourceTransparency: string;
    /**
     * Live-feed counter, e.g. "3/11 live". Interpolated so word order can
     * differ per locale — several languages place the count after the noun.
     */
    liveCount: string;
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
    staleLabel: string;
    unavailableLabel: string;
    updatedLabel: string;
    historyCount: string;
    intelligenceLabel: string;
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
    /** Heading of the trade-plan card. */
    tradePlanHeading: string;
    /**
     * Caption under the entry price clarifying it is the CURRENT MARKET PRICE,
     * not a broker order. Invariant 9: nothing here is executed for the user.
     */
    marketPriceNote: string;
    /**
     * Risk-dimension labels. These are DISTINCT risk concepts and must not be
     * collapsed into a generic "risk warning" (§8): structural = the setup's
     * own integrity, extension = how far price has already travelled,
     * liquidity = fill/slippage exposure, event = scheduled catalysts.
     */
    structuralRisk: string;
    extensionRisk: string;
    liquidityRisk: string;
    eventRisk: string;
    /** Heading explaining why the engine returned WAIT. Non-directional. */
    whyWait: string;
    /** Evidence that the current move continues. */
    continuationEvidence: string;
    /** Evidence that the current move reverses. */
    reversalRisk: string;
    /** What would CONFIRM the thesis. */
    whatConfirms: string;
    /** What would INVALIDATE the thesis — never softened to "risk". */
    whatInvalidates: string;
    /**
     * Terminal-style section headings rendered after the `$` glyph. The glyph
     * and the hyphenated styling are chrome; the WORDS are user-facing copy and
     * must be translated. Acronyms that name a specific institution or report
     * (CFTC, EIA, SR) are provider/domain notation and stay untranslated (§4).
     */
    /**
     * Thesis / evidence field labels. Decision vocabulary: a thesis is a
     * reasoned claim, a scenario is a path, an invalidation kills the claim.
     * Translations must keep those three distinct (§8/§13).
     */
    fields: {
      primaryThesis: string;
      counterThesis: string;
      primaryScenario: string;
      alternateScenario: string;
      strongestSupport: string;
      strongestConflict: string;
      doubleCountingWarnings: string;
      missingEvidence: string;
      structuralConfidence: string;
      dataReliability: string;
      structuralAgreement: string;
      supporting: string;
      conflicting: string;
      confirmation: string;
      invalidationLabel: string;
      missingContext: string;
      counterThesisTag: string;
      strengthens: string;
      invalidatesTag: string;
      riskNote: string;
      warnings: string;
      quantity: string;
    };
    sections: {
      dataQuality: string;
      indicators: string;
      marketContext: string;
      treasuryYields: string;
      cftcFuturesPositioning: string;
      eiaInventory: string;
      executionQuality: string;
      multiTimeframe: string;
      whyThisDecision: string;
      decisionSnapshot: string;
      evidenceContext: string;
      thesisValidity: string;
      whatWouldChange: string;
      continuationVsReversal: string;
      professionalMarketReading: string;
      forwardMarketPath: string;
      longHorizonThesis: string;
      evidenceChallenge: string;
      positionSizing: string;
      technical: string;
      fundamental: string;
      newsSentiment: string;
      macroContext: string;
      fundamentals: string;
      scoreBreakdown: string;
      keyLevels: string;
      derivativesPositioning: string;
      derivativesIntelligence: string;
      universalIntelligence: string;
      economicCalendar: string;
    };

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
    rMultiple: string;
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
    /**
     * Journal entry lifecycle states. `statusNoTrade` is the journal's record
     * that NO TRADE was taken — invariant 3 keeps that a first-class outcome,
     * never a downgraded recommendation.
     */
    statusPlanned: string;
    statusOpen: string;
    statusClosed: string;
    statusCancelled: string;
    statusNoTrade: string;
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
    /** Section heading above the current-vs-previous comparison. */
    currentVsPrevious: string;
    /** Section heading above the aggregated history summary. */
    historySummary: string;
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

  /** Phase 174 — entitlement surface. Server-authoritative values only. */
  /**
   * Phase 189 — first-run authentication surface.
   *
   * Every user-visible string on the sign-in journey lives here so no locale
   * can silently fall back to English. Declaring these as REQUIRED members is
   * deliberate: adding a key fails `tsc -b` for all nine locales until each
   * one supplies a real translation.
   */
  auth: {
    title: string;
    subtitle: string;
    emailLabel: string;
    emailPlaceholder: string;
    emailHelp: string;
    continueWithEmail: string;
    orDivider: string;
    continueAsGuest: string;
    guestHelp: string;
    checkEmailTitle: string;
    /** Interpolates {email}. */
    checkEmailBody: string;
    otpLabel: string;
    /** Interpolates {minutes}; must match OTP_EXPIRY_MINUTES on the server. */
    codeValidity: string;
    verifyCode: string;
    verifying: string;
    noCodeQuestion: string;
    resendHint: string;
    tryAgain: string;
    useDifferentEmail: string;
    sendFailed: string;
    codeIncorrect: string;
    guestFailed: string;
    disclaimer: string;
    sessionNote: string;
    /** Phase 191 — shown by RequireAuth while the session is being restored. */
    restoringSession: string;
  };

  /** Phase 189 — first-run guidance shown before any analysis exists. */
  onboarding: {
    welcomeTitle: string;
    welcomeBody: string;
    step1: string;
    step2: string;
    step3: string;
    freeOutcomeNote: string;
    chargeableNote: string;
    lockedNote: string;
    /** Shown when market data acquisition fails; never names a provider. */
    dataUnavailableHint: string;
    dismiss: string;
  };

  /**
   * Phase 190 — public landing page.
   *
   * Every claim here was audited against implemented capability. Wording that
   * would overstate the product (blanket "real-time", guaranteed accuracy,
   * unconditional instrument coverage) is deliberately absent, and tests in
   * `src/lib/i18n/public-copy-truthfulness.phase190.test.ts` enforce that.
   *
   * Technical terms kept untranslated by terminology policy: BOS, CHoCH, FVG,
   * HTF, LTF, DXY, WTI, R:R, SL, TP, W1/D1/H4/H1/M15/M5, NO TRADE.
   */
  landing: {
    signIn: string;
    launch: string;
    heroBadge: string;
    heroRole: string;
    heroBody: string;
    openTerminal: string;
    guestMode: string;
    coverageLabel: string;
    instrumentsLabel: string;
    /** Honest scope note; must not promise unconditional symbol support. */
    coverageNote: string;
    assetForex: string;
    assetCrypto: string;
    assetStock: string;
    assetCommodity: string;
    frameworkTitle: string;
    frameworkBody: string;
    featureStructureTitle: string;
    featureStructureBody: string;
    featureSupplyTitle: string;
    featureSupplyBody: string;
    featureMtfTitle: string;
    featureMtfBody: string;
    featureFlowTitle: string;
    featureFlowBody: string;
    convictionBadge: string;
    convictionTitle: string;
    convictionTitleEmphasis: string;
    convictionBody: string;
    weightStructure: string;
    weightLiquidity: string;
    weightFundamental: string;
    weightSentiment: string;
    outputTechnicalLabel: string;
    outputTechnicalDesc: string;
    outputFundamentalLabel: string;
    outputFundamentalDesc: string;
    outputPlanLabel: string;
    outputPlanDesc: string;
    outputConvictionLabel: string;
    outputConvictionDesc: string;
    outputInvalidationLabel: string;
    outputInvalidationDesc: string;
    principleNoFabricationTitle: string;
    principleNoFabricationBody: string;
    principleCapitalTitle: string;
    principleCapitalBody: string;
    principleNoAutoTitle: string;
    principleNoAutoBody: string;
    disclaimerTitle: string;
    disclaimerBody: string;
    ctaTitle: string;
    ctaBody: string;
    ctaButton: string;
    footerTagline: string;
    /** Accessible names for icon-only / brand controls. */
    homeAriaLabel: string;
  };

  /**
   * Phase 191 — user-facing provenance wording.
   *
   * `AcquisitionMode` (src/lib/data/acquisition-provenance.ts) already records
   * HOW a value was obtained, but only as English diagnostic text. These keys
   * are the human-readable, translated form shown to authenticated users.
   *
   * The distinctions are load-bearing, not stylistic: `cache-reused` must
   * never read as a new observation, and `timed-out`/`rate-limited`/
   * `unavailable` must never read as evidence. `describeAcquisitionForUser`
   * is the only mapping permitted to produce these strings, and
   * `authenticated-copy-truthfulness.phase191.test.ts` enforces the wording.
   */
  provenance: {
    /** A real provider call completed during this analysis. */
    observedNow: string;
    /** A real call completed and was shared with concurrent callers. */
    observedShared: string;
    /** Served from cache — the provider was NOT contacted. */
    cacheReused: string;
    /** Never cached by design, so every use is a new observation. */
    uncachedByDesign: string;
    /** Provider returned no usable data. */
    unavailable: string;
    /** Provider exceeded its deadline. */
    timedOut: string;
    /** Provider reported a rate limit. */
    rateLimited: string;
    /** Not attempted for this instrument/style. */
    skipped: string;
    /** Stored result replayed from history; not current evidence. */
    historical: string;
    /** Evidence exists but is older than the freshness window. */
    stale: string;
    /** Some required legs are missing; the picture is incomplete. */
    degraded: string;
    /** Prefix for an evidence age, interpolates {age}. */
    evidenceAge: string;
    /** Shown when no provider was contacted at all. */
    notContacted: string;
  };

  entitlement: {
    invalidInput: string;
    signInRequired: string;
    trialLabel: string;
    premiumLabel: string;
    signalsRemaining: string;
    signalsRemainingOne: string;
    signalsExhausted: string;
    unlimited: string;
    lockedTitle: string;
    lockedBody: string;
    lockedNotWait: string;
    upgradeCta: string;
    upgradeComingSoon: string;
    freeAlways: string;
  };

  /**
   * Phase 182 — public website pages (/download, /privacy, /terms).
   *
   * These are part of the official-website surface. They ship in the same
   * bundle as the app, so they must be translated like everything else; no
   * hardcoded UI strings are permitted.
   */
  legal: {
    downloadTitle: string;
    downloadIntro: string;
    downloadWindows: string;
    downloadWindowsDetail: string;
    downloadStore: string;
    downloadStoreDetail: string;
    downloadUnavailable: string;
    downloadOtherSurfaces: string;
    downloadWeb: string;
    downloadAndroid: string;
    downloadIos: string;
    privacyTitle: string;
    privacyIntro: string;
    privacyDataTitle: string;
    privacyDataBody: string;
    privacyProvidersTitle: string;
    privacyProvidersBody: string;
    privacyRetentionTitle: string;
    privacyRetentionBody: string;
    termsTitle: string;
    termsIntro: string;
    termsNotAdviceTitle: string;
    termsNotAdviceBody: string;
    termsNoExecutionTitle: string;
    termsNoExecutionBody: string;
    termsAccuracyTitle: string;
    termsAccuracyBody: string;
    backHome: string;
  };
}
