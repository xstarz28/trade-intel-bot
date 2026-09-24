/**
 * Phase 191 — provenance in the user's language.
 *
 * `AcquisitionMode` records how a value was obtained; `describeProvenance`
 * turns that into English diagnostic text for logs. Neither is showable to a
 * user: one is a union member, the other is untranslated and speaks in
 * provider/dataset terms.
 *
 * This module is the ONLY sanctioned way to turn acquisition state into
 * user-facing copy. It exists because the alternative — components inventing
 * their own wording — is how "cached" quietly becomes "live".
 *
 * The invariant it protects:
 *
 *   A mode that did not produce a new provider observation must never be
 *   described with language implying one.
 *
 * `authenticated-copy-truthfulness.phase191.test.ts` calls these functions
 * with real modes and asserts on the returned strings in all nine locales,
 * rather than asserting that some constant exists in a file.
 */

import type { AcquisitionMode, AcquisitionProvenance } from "@/lib/data/acquisition-provenance";
import { isNewObservation } from "@/lib/data/acquisition-provenance";
import type { Translations } from "@/lib/i18n/types";

/**
 * Freshness levels used by the radar/market surfaces.
 * Mirrors `FreshnessLevel` without importing the radar module into i18n.
 */
export type UiFreshness = "FRESH" | "RECENT" | "DELAYED" | "STALE" | "UNAVAILABLE";

/** Human-readable, translated description of how a value was obtained. */
export function describeAcquisitionForUser(
  mode: AcquisitionMode,
  t: Translations,
): string {
  switch (mode) {
    case "observed-now":
      return t.provenance.observedNow;
    case "observed-shared":
      return t.provenance.observedShared;
    case "cache-reused":
      return t.provenance.cacheReused;
    case "uncached-by-design":
      return t.provenance.uncachedByDesign;
    case "unavailable":
      return t.provenance.unavailable;
    case "timed-out":
      return t.provenance.timedOut;
    case "rate-limited":
      return t.provenance.rateLimited;
    case "skipped":
      return t.provenance.skipped;
  }
}

/**
 * Whether a mode may be presented with "live"-flavoured emphasis.
 *
 * Delegates to `isNewObservation` so the UI cannot drift from the acquisition
 * layer's own definition of what counts as a new observation. A synthetic
 * provenance record is built because that predicate is the authority and
 * duplicating its mode set here would create a second source of truth.
 */
export function mayPresentAsCurrent(mode: AcquisitionMode): boolean {
  return isNewObservation({
    provider: "",
    dataset: "",
    mode,
    usedAt: 0,
  });
}

/**
 * Full provenance line: what happened, plus how old the evidence is.
 *
 * Evidence age is appended ONLY when an observation actually exists. A mode
 * with no observation has no age to report, and inventing one ("0s ago")
 * would imply a fresh reading.
 */
export function describeProvenanceForUser(
  provenance: AcquisitionProvenance,
  t: Translations,
): string {
  const base = describeAcquisitionForUser(provenance.mode, t);
  if (provenance.observedAt === undefined || provenance.evidenceAgeMs === undefined) {
    return base;
  }
  const age = formatEvidenceAge(provenance.evidenceAgeMs);
  return `${base} · ${t.provenance.evidenceAge.replace("{age}", age)}`;
}

/** Compact age rendering. Units are locale-neutral symbols (s/m/h/d). */
export function formatEvidenceAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Translated freshness label.
 *
 * Deliberately reuses the existing `marketPanel.freshness` catalogue rather
 * than minting a second vocabulary for the same concept — two vocabularies
 * would eventually disagree.
 */
export function describeFreshnessForUser(
  freshness: UiFreshness,
  t: Translations,
): string {
  switch (freshness) {
    case "FRESH":
      return t.marketPanel.freshness.fresh;
    case "RECENT":
      return t.marketPanel.freshness.recent;
    case "DELAYED":
      return t.marketPanel.freshness.delayed;
    case "STALE":
      return t.marketPanel.freshness.stale;
    case "UNAVAILABLE":
      return t.marketPanel.freshness.unavailable;
  }
}

/**
 * Description for a stored/replayed analysis.
 *
 * A historical record stays historical no matter how recently it was opened:
 * the user is looking at what was true then, not what is true now.
 */
export function describeHistoricalForUser(t: Translations): string {
  return t.provenance.historical;
}

/**
 * Description for a surface whose evidence is incomplete.
 *
 * Distinct from "no opportunity": missing evidence is a statement about the
 * data pipeline, not about the market.
 */
export function describeDegradedForUser(t: Translations): string {
  return t.provenance.degraded;
}
