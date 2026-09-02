/**
 * Enum-to-translation mapping functions for intelligence UI display.
 *
 * These functions map raw internal enum values to translated user-facing labels.
 * The internal enum values remain unchanged — only the display representation changes.
 *
 * IMPORTANT: Unknown/future enum values always produce a safe fallback,
 * never undefined, blank, or crash.
 */

import type { Translations } from "./types";

// ─── Stance Mapping ─────────────────────────────────────────

/** Map news/fundamental stance enum to translated display label. */
export function mapStance(
  stance: string,
  t: Translations,
): string {
  switch (stance) {
    case "SUPPORTING": return t.intelligence.stanceSupporting;
    case "CONFLICTING": return t.intelligence.stanceConflicting;
    case "MIXED": return t.intelligence.stanceMixed;
    case "NEUTRAL": return t.intelligence.stanceNeutral;
    case "INSUFFICIENT": return t.intelligence.stanceInsufficient;
    default: return stance;
  }
}

// ─── Position Impact Mapping ────────────────────────────────

/** Map position impact enum to translated display label. */
export function mapPositionImpact(
  impact: string,
  t: Translations,
): string {
  switch (impact) {
    case "SUPPORTING": return t.intelligence.impactSupporting;
    case "CONFLICTING": return t.intelligence.impactConflicting;
    case "NEUTRAL": return t.intelligence.impactNeutral;
    case "INSUFFICIENT": return t.intelligence.impactInsufficient;
    default: return impact;
  }
}

// ─── Evidence Direction Mapping ──────────────────────────────

/** Map evidence direction enum to translated display label. */
export function mapDirection(
  direction: string,
  t: Translations,
): string {
  switch (direction) {
    case "SUPPORTING": return t.intelligence.impactSupporting;
    case "CONFLICTING": return t.intelligence.impactConflicting;
    case "NEUTRAL": return t.intelligence.impactNeutral;
    default: return direction;
  }
}

// ─── Relevance Mapping ──────────────────────────────────────

/** Map relevance level enum to translated display label. */
export function mapRelevance(
  relevance: string,
  t: Translations,
): string {
  switch (relevance) {
    case "DIRECT": return t.intelligence.relevanceDirect;
    case "HIGH": return t.intelligence.relevanceHigh;
    case "MODERATE": return t.intelligence.relevanceModerate;
    case "LOW": return t.intelligence.relevanceLow;
    case "IRRELEVANT": return t.intelligence.relevanceIrrelevant;
    case "UNKNOWN": return t.intelligence.relevanceUnknown;
    default: return relevance;
  }
}

// ─── Availability Mapping ───────────────────────────────────

/** Map data availability enum to translated display label. */
export function mapAvailability(
  availability: string,
  t: Translations,
): string {
  switch (availability) {
    case "AVAILABLE": return t.status.available;
    case "LIMITED": return t.status.limited;
    case "INSUFFICIENT": return t.status.insufficient;
    case "STALE": return t.status.dataStale;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return availability;
  }
}

// ─── Short Count Display ────────────────────────────────────

/** Get a short localized count display for supporting/conflicting. */
export function mapSupportingCount(
  count: number,
  t: Translations,
): string {
  return `${count} ${t.intelligence.supporting}`;
}

/** Get a short localized count display for conflicting. */
export function mapConflictingCount(
  count: number,
  t: Translations,
): string {
  return `${count} ${t.intelligence.conflicting}`;
}

// ─── Thesis Health Mapping ──────────────────────────────────

/** Map thesis health enum to translated display label. */
export function mapThesisHealth(
  thesisHealth: string,
  t: Translations,
): string {
  switch (thesisHealth) {
    case "HEALTHY": return t.status.healthy;
    case "STABLE": return t.status.stable;
    case "DETERIORATING": return t.status.deteriorating;
    case "SEVERELY_DETERIORATING": return t.status.severelyDeteriorating;
    case "INVALIDATED": return t.status.invalidated;
    default: return thesisHealth.replace(/_/g, " ");
  }
}

// ─── Confidence Mapping ─────────────────────────────────────

/** Map confidence level enum to translated display label. */
export function mapConfidence(
  confidence: string,
  t: Translations,
): string {
  switch (confidence) {
    case "STRONG_EVIDENCE": return t.intelligence.confidenceStrong;
    case "MODERATE_EVIDENCE": return t.intelligence.confidenceModerate;
    case "WEAK_EVIDENCE": return t.intelligence.confidenceWeak;
    case "INSUFFICIENT_EVIDENCE": return t.intelligence.confidenceInsufficient;
    default: return confidence.replace(/_/g, " ");
  }
}

// ─── Dimension Mapping ──────────────────────────────────────

/** Map dimension name enum to translated display label. */
export function mapDimension(
  dimension: string,
  t: Translations,
): string {
  switch (dimension) {
    case "TECHNICAL": return t.intelligence.technical;
    case "MACRO": return t.intelligence.macro;
    case "CROSS_ASSET": return t.intelligence.crossAsset;
    case "DERIVATIVES": return t.intelligence.derivatives;
    case "NEWS": return t.intelligence.news;
    case "FUNDAMENTALS": return t.intelligence.fundamentals;
    default: return dimension;
  }
}
