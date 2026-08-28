/**
 * Phase 57 — Position Protection Types
 *
 * Core type system for the Intelligent Profit Protection & Early Exit Alert Engine.
 * INFORMATIONAL_ONLY — never modifies decision engine.
 */

// ═══════════════════════════════════════════════════════════════
// POSITION CONTEXT
// ═══════════════════════════════════════════════════════════════

export type PositionSide = "LONG" | "SHORT";

export interface PositionContext {
  instrument: string;
  assetClass: "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro";
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  /** Quantity/size — optional. */
  positionSize?: number;
  /** Leverage — optional. */
  leverage?: number;
  /** Original stop loss — optional. */
  stopLoss?: number;
  /** Original take profit — optional. */
  takeProfit?: number;
  /** When position was opened. */
  openedAt: number;
  /** Intended trading horizon. */
  horizon?: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  /** Peak unrealized profit price — for giveback tracking. */
  peakPrice?: number;
  /** Original thesis summary — optional. */
  originalThesis?: string;
  /** Original analytical context snapshot — optional. */
  originalContext?: {
    bias?: string;
    confidence?: string;
    recommendation?: string;
    keyLevels?: { support?: string; resistance?: string; invalidation?: string };
    marketRegime?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// PROFIT STATE
// ═══════════════════════════════════════════════════════════════

export type ProfitState = "LOSING" | "BREAK_EVEN_ZONE" | "PROFITABLE" | "STRONGLY_PROFITABLE";

export interface ProfitMetrics {
  profitState: ProfitState;
  unrealizedPnL: number;
  /** R-multiple if stopLoss is available. undefined otherwise. */
  rMultiple?: number;
  /** Distance from entry as percentage. */
  distanceFromEntryPct: number;
  /** Distance to stop loss as percentage (if SL available). */
  distanceToSLPct?: number;
  /** Distance to take profit as percentage (if TP available). */
  distanceToTPPct?: number;
  /** Peak profit in same units as unrealizedPnL. */
  peakProfit?: number;
  /** Percentage of peak profit given back. 0 = at peak, 100 = all gone. */
  givebackPct?: number;
  /** Leverage-adjusted P/L if leverage available. */
  leveragedPnL?: number;
}

// ═══════════════════════════════════════════════════════════════
// THESIS HEALTH
// ═══════════════════════════════════════════════════════════════

export type ThesisHealthState =
  | "HEALTHY"
  | "STABLE"
  | "DETERIORATING"
  | "SEVERELY_DETERIORATING"
  | "INVALIDATED"
  | "UNKNOWN";

export interface ThesisHealthScore {
  state: ThesisHealthState;
  /** Numeric score 0-100. 100 = perfectly healthy, 0 = fully invalidated. */
  score: number;
  /** Number of independent deterioration signals detected. */
  deteriorationCount: number;
  /** Number of confirming/healthy signals. */
  confirmingCount: number;
  /** Missing data points that would improve assessment. */
  missingDataPoints: string[];
}

// ═══════════════════════════════════════════════════════════════
// DETERIORATION SIGNALS
// ═══════════════════════════════════════════════════════════════

export type DeteriorationCategory =
  | "TECHNICAL"
  | "MOMENTUM"
  | "VOLATILITY"
  | "DERIVATIVES"
  | "FUNDAMENTAL"
  | "MACRO"
  | "CROSS_ASSET"
  | "EVENT_RISK";

export interface DeteriorationSignal {
  category: DeteriorationCategory;
  name: string;
  description: string;
  /** Severity of this specific signal: 0 = healthy, 100 = critical. */
  severity: number;
  /** Source/provider of this observation. */
  source: string;
  /** Timestamp of this observation. */
  observedAt: number;
  /** Freshness. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Dependency group for deduplication. */
  dependencyGroup: string;
}

// ═══════════════════════════════════════════════════════════════
// SHOCK STATE
// ═══════════════════════════════════════════════════════════════

export type ShockState = "NORMAL" | "ELEVATED" | "SHOCK";

export interface ShockAssessment {
  state: ShockState;
  /** Description of the shock if any. */
  description: string;
  /** Individual shock indicators. */
  indicators: {
    volatilityExpansion?: boolean;
    rapidDisplacement?: boolean;
    volumeSpike?: boolean;
    oiShock?: boolean;
    fundingShock?: boolean;
    crossAssetDivergence?: boolean;
    regimeTransition?: boolean;
  };
  /** Confidence in this shock assessment 0-100. */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// ALERT SEVERITY
// ═══════════════════════════════════════════════════════════════

export type AlertSeverity = "NONE" | "WATCH" | "CAUTION" | "HIGH_RISK" | "INVALIDATED";

export const ALERT_SEVERITY_ORDER: AlertSeverity[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];

export function alertSeverityRank(a: AlertSeverity): number {
  return ALERT_SEVERITY_ORDER.indexOf(a);
}

// ═══════════════════════════════════════════════════════════════
// PROTECTION ALERT
// ═══════════════════════════════════════════════════════════════

export type ProfitProtectionUrgency = "NONE" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export const URGENCY_ORDER: ProfitProtectionUrgency[] = ["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"];

export function urgencyRank(u: ProfitProtectionUrgency): number {
  return URGENCY_ORDER.indexOf(u);
}

export interface WhyTpNowExplanation {
  /** Current profit status. */
  profitStatus: string;
  /** What changed in market conditions. */
  whatChanged: string[];
  /** Independent confirmations of deterioration. */
  confirmations: string[];
  /** What evidence is still supporting the thesis. */
  stillSupporting: string[];
  /** What evidence is missing. */
  missingEvidence: string[];
  /** Why urgency increased. */
  urgencyIncreased: string;
  /** Manual action suggestion. */
  suggestedAction: string;
  /** Informational disclaimer. */
  disclaimer: string;
}

export interface ProtectionAlert {
  /** Instrument. */
  instrument: string;
  /** Side. */
  side?: "LONG" | "SHORT";
  /** Current alert severity. */
  severity: AlertSeverity;
  /** Thesis health state. */
  thesisHealth: ThesisHealthState;
  /** Thesis health score 0-100. */
  thesisHealthScore: number;
  /** Current profit metrics. */
  profit: ProfitMetrics;
  /** Shock state. */
  shock: ShockAssessment;
  /** Key supporting evidence (thesis still valid). */
  supportingEvidence: string[];
  /** Key conflicting evidence (thesis weakening). */
  conflictingEvidence: string[];
  /** Missing critical data. */
  missingData: string[];
  /** Profit protection urgency level. */
  urgency: ProfitProtectionUrgency;
  /** Reason for the urgency classification. */
  urgencyReason: string;
  /** Structured explanation for "Why TP Now?" */
  whyTpNow: WhyTpNowExplanation;
  /** Human-readable alert message. */
  alertMessage: string;
  /** Action recommendation (manual only). */
  actionRecommendation: string;
  /** Protection reference level if computable. */
  protectionReference?: number;
  /** Individual deterioration signals. */
  deteriorationSignals: DeteriorationSignal[];
  /** Timestamp. */
  timestamp: number;
  /** Previous severity for lifecycle tracking. */
  previousSeverity?: AlertSeverity;
  /** Whether this is a state transition (new alert level). */
  stateTransition: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ALERT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export type AlertLifecycleState =
  | "MONITORING"
  | "WATCH"
  | "CAUTION"
  | "HIGH_RISK"
  | "INVALIDATED"
  | "RECOVERED";

export interface AlertLifecycleEntry {
  instrument: string;
  from: AlertLifecycleState;
  to: AlertLifecycleState;
  timestamp: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// PROTECTION REFERENCE
// ═══════════════════════════════════════════════════════════════

export interface ProtectionReference {
  /** The reference price level. */
  level?: number;
  /** How the level was computed. */
  method: "STRUCTURAL" | "VOLATILITY" | "TREND" | "SUPPORT_RESISTANCE" | "UNAVAILABLE";
  /** Description. */
  description: string;
  /** Whether data was sufficient to compute. */
  available: boolean;
}

// ═══════════════════════════════════════════════════════════════
// MONITORING STATE (persisted per position)
// ═══════════════════════════════════════════════════════════════

export interface MonitoringState {
  instrument: string;
  currentSeverity: AlertSeverity;
  lifecycleState: AlertLifecycleState;
  /** Cooldown: timestamp after which next alert can fire. */
  nextAlertAllowedAt: number;
  /** Last alert timestamp. */
  lastAlertAt: number;
  /** Number of consecutive same-severity assessments. */
  consecutiveSameSeverity: number;
  /** Peak profit seen during monitoring (for giveback). */
  peakProfitSeen?: number;
  /** Alert history. */
  history: AlertLifecycleEntry[];
}
