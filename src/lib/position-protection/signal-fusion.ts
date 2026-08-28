/**
 * Phase 64 — Signal Fusion
 *
 * Combines deterioration signals by category with dependency group
 * deduplication. Prevents double-counting from same dependency groups.
 *
 * Pure functions — no side effects.
 */

import type { ProtectionAlert, DeteriorationSignal } from "./types";

// ═══════════════════════════════════════════════════════════════
// SIGNAL SEVERITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export type SignalClassification = "EARLY_WARNING" | "CONFIRMATION" | "SEVERE" | "CRITICAL";

export interface FusedSignal {
  /** Unique dependency group. */
  dependencyGroup: string;
  /** Category of deterioration. */
  category: string;
  /** Classification level. */
  classification: SignalClassification;
  /** Highest severity from this group. */
  severity: number;
  /** Signal name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Number of signals in this group (after dedup). */
  signalCount: number;
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifySignalSeverity(
  severity: number,
  totalIndependentGroups: number,
): SignalClassification {
  if (severity >= 80 || totalIndependentGroups >= 4) return "CRITICAL";
  if (severity >= 65 || totalIndependentGroups >= 3) return "SEVERE";
  if (severity >= 45 || totalIndependentGroups >= 2) return "CONFIRMATION";
  return "EARLY_WARNING";
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL FUSION
// ═══════════════════════════════════════════════════════════════

/**
 * Fuse deterioration signals from a protection alert.
 * Deduplicates by dependency group — two signals from the same
 * group do not artificially create stronger conviction.
 */
export function fuseSignals(alert: ProtectionAlert): FusedSignal[] {
  const signals = alert.deteriorationSignals;
  if (signals.length === 0) return [];

  // Group by dependency group, keep highest severity per group
  const groupMap = new Map<string, DeteriorationSignal[]>();
  for (const sig of signals) {
    const existing = groupMap.get(sig.dependencyGroup) ?? [];
    existing.push(sig);
    groupMap.set(sig.dependencyGroup, existing);
  }

  // Determine independent group count (unique dependency groups with severity >= 40)
  const independentGroups = Array.from(groupMap.values()).filter(
    group => Math.max(...group.map(s => s.severity)) >= 40,
  ).length;

  // Build fused signals
  const fused: FusedSignal[] = [];
  for (const [depGroup, groupSignals] of groupMap) {
    // Keep highest severity signal per group
    const topSignal = groupSignals.reduce((a, b) => a.severity > b.severity ? a : b);
    const classification = classifySignalSeverity(topSignal.severity, independentGroups);

    fused.push({
      dependencyGroup: depGroup,
      category: topSignal.category,
      classification,
      severity: topSignal.severity,
      name: topSignal.name,
      description: topSignal.description,
      signalCount: groupSignals.length,
    });
  }

  // Sort by severity descending
  fused.sort((a, b) => b.severity - a.severity);

  return fused;
}

/**
 * Count independent signal groups at each classification level.
 */
export function countByClassification(fused: FusedSignal[]): Record<SignalClassification, number> {
  const counts: Record<SignalClassification, number> = {
    CRITICAL: 0,
    SEVERE: 0,
    CONFIRMATION: 0,
    EARLY_WARNING: 0,
  };
  for (const sig of fused) {
    counts[sig.classification]++;
  }
  return counts;
}

/**
 * Check if fusion indicates material risk.
 * Requires at least SEVERE or 2+ CONFIRMATION signals.
 */
export function isMaterialRisk(fused: FusedSignal[]): boolean {
  const counts = countByClassification(fused);
  if (counts.CRITICAL >= 1) return true;
  if (counts.SEVERE >= 1) return true;
  if (counts.CONFIRMATION >= 2) return true;
  return false;
}
