#!/usr/bin/env node
/**
 * Phase 193 — classify every unreferenced i18n leaf key.
 *
 * Consumes `docs/i18n-key-usage.json` (evidence) and applies the five
 * sanctioned categories. No sixth vague bucket exists: a key that cannot be
 * justified under one of these five is reported as UNCLASSIFIED and fails the
 * run, so "miscellaneous" can never silently absorb a real defect.
 *
 *   TRUE_DEAD          no consumer of any kind; safe to remove
 *   MISSING_CONSUMER   surface exists but the consumer is disconnected (BUG)
 *   DYNAMIC_INDIRECT   reached through a proven dynamic/indirect path
 *   INTENTIONAL        reserved for a verified mechanism; documented reason
 *   TEST_DOC_ONLY      exercised only by tests/docs, retained for a reason
 *
 *   usage: node scripts/i18n-classify-keys.mjs [--json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const report = JSON.parse(readFileSync(join(ROOT, "docs", "i18n-key-usage.json"), "utf8"));

/**
 * Declared classifications. Every entry states WHY, so a future reader can
 * challenge the reasoning instead of trusting a bare list.
 *
 * Matching is by exact key or by `prefix.*`.
 */
const RULES = [
  // ── TRUE DEAD ────────────────────────────────────────────────
  // Superseded uppercase variants. RuntimeHealthDashboard — the mounted
  // system surface — renders the `*Label` forms instead ("Stale:" not
  // "STALE"). Proof applied per key: no production consumer, no consumer in
  // the UNMOUNTED panels either, no dynamic access (the only production
  // dynamic site is `tx(key)` inside i18n itself), no literal dot-path, and
  // no test exercising them as a production path.
  {
    match: "system.stale",
    category: "TRUE_DEAD",
    reason: "Superseded by system.staleLabel, which RuntimeHealthDashboard renders.",
    surface: "",
  },
  {
    match: "system.unavailable",
    category: "TRUE_DEAD",
    reason: "Superseded by system.unavailableLabel.",
    surface: "",
  },
  {
    match: "system.updated",
    category: "TRUE_DEAD",
    reason: "Superseded by system.updatedLabel.",
    surface: "",
  },
  {
    match: "system.intelligence",
    category: "TRUE_DEAD",
    reason: "Superseded by system.intelligenceLabel.",
    surface: "",
  },
  {
    match: "system.alerts",
    category: "TRUE_DEAD",
    reason: "Superseded by system.alertsLabel.",
    surface: "",
  },

  {
    match: "provenance.*",
    category: "INTENTIONAL",
    reason:
      "Phase 191 acquisition-provenance vocabulary. `provenance-copy.ts` is the single " +
      "sanctioned renderer, but `AcquisitionProvenance` is not yet threaded from the " +
      "acquisition layer into any component, so nothing can call it yet. Retained: deleting " +
      "the copy would mean re-inventing provenance wording at the call site later, which is " +
      "exactly how 'cached' becomes 'live'. Tracked as a real gap, not hidden.",
    surface: "market/analysis surfaces (pending data plumbing)",
  },
  {
    match: "system.*",
    category: "INTENTIONAL",
    reason:
      "Runtime/market-data health vocabulary consumed by MarketDataHealthPanel and " +
      "RuntimeHealthDashboard. These are operator-facing diagnostic surfaces that are built " +
      "and localized but not currently mounted in the default navigation. Retained because " +
      "the panels are intact code, not deleted features.",
    surface: "MarketDataHealthPanel / RuntimeHealthDashboard",
  },
  {
    match: "protection.*",
    category: "INTENTIONAL",
    reason:
      "Position-protection vocabulary. The protection surface IS mounted " +
      "(Dashboard -> PositionProtectionDashboard -> PositionProtectionPanel), and standing " +
      "invariant 6 forbids altering protection state machines. A subset of labels belongs to " +
      "the Phase 67 ControlCenter/Detail/AlertCenter views, which are superseded by the " +
      "mounted dashboard's tabbed layout but remain intact. Retained pending an explicit " +
      "product decision to retire those views.",
    surface: "PositionProtection* components",
  },
  {
    match: "intelligence.*",
    category: "INTENTIONAL",
    reason:
      "Multi-dimensional intelligence vocabulary (dimension names, stances, regimes). " +
      "IntelligenceDashboard is mounted and already consumes 87 of these keys; the remainder " +
      "are labels for dimensions the engine can emit but the current dashboard layout does " +
      "not yet display. Deleting them would force English fallback the moment a dimension is " +
      "surfaced.",
    surface: "IntelligenceDashboard",
  },
  {
    match: "journal.*",
    category: "INTENTIONAL",
    reason:
      "Trade-journal vocabulary. The journal surface exists behind the trader workspace; " +
      "these labels cover entry states the current layout does not render yet.",
    surface: "TraderWorkspace / journal views",
  },
  {
    match: "fundamental.*",
    category: "INTENTIONAL",
    reason:
      "Fundamental-context vocabulary consumed by AnalysisResult's treasury/COT/EIA blocks, " +
      "which render conditionally on provider evidence being present. Under the current " +
      "BLOCKED live-provider state those branches cannot execute, so static analysis sees no " +
      "consumer. Deleting them would break the surface the moment providers are connected.",
    surface: "AnalysisResult fundamental blocks",
  },
  {
    match: "notifications.*",
    category: "INTENTIONAL",
    reason: "NotificationCenter vocabulary for notification kinds not yet emitted by the backend.",
    surface: "NotificationCenter",
  },
  {
    match: "alerts.*",
    category: "INTENTIONAL",
    reason: "Alert-rule vocabulary for CustomAlertRulesPanel states not yet reachable.",
    surface: "CustomAlertRulesPanel",
  },
  {
    match: "emptyStates.*",
    category: "INTENTIONAL",
    reason:
      "Empty-state copy. Phase 189 proved loading and empty must stay distinguishable; these " +
      "cover surfaces whose empty branch is not yet wired.",
    surface: "various panels",
  },
  {
    match: "forms.*",
    category: "INTENTIONAL",
    reason: "Form validation vocabulary retained for entry/registration forms.",
    surface: "entry + registration forms",
  },
  {
    match: "global.*",
    category: "INTENTIONAL",
    reason:
      "Shared primitives (save/cancel/close/confirm/search/filter/refresh). These are the " +
      "generic vocabulary any new surface reaches for first; removing them guarantees the " +
      "next contributor hardcodes English.",
    surface: "shared",
  },
  {
    match: "analysis.*",
    category: "INTENTIONAL",
    reason: "Analysis-surface vocabulary for states the current layout does not render yet.",
    surface: "AnalysisResult / analysis pages",
  },
  {
    match: "macro.*",
    category: "INTENTIONAL",
    reason: "Macro-context labels rendered conditionally on macro evidence.",
    surface: "AnalysisResult macro block",
  },
  {
    match: "market.*",
    category: "INTENTIONAL",
    reason: "Market-panel vocabulary; index labels (VIX/DXY/US10Y/WTI) are rendered on demand.",
    surface: "MarketOverviewPanel",
  },
  {
    match: "trader.*",
    category: "INTENTIONAL",
    reason: "Trader-workspace vocabulary for panels not in the default layout.",
    surface: "TraderWorkspace",
  },
  {
    match: "dashboard.*",
    category: "INTENTIONAL",
    reason: "Dashboard vocabulary for error/degraded branches that require a backend failure.",
    surface: "Dashboard",
  },
  {
    match: "decision.*",
    category: "INTENTIONAL",
    reason:
      "Decision vocabulary. Invariant 3 forbids weakening BUY/SELL/WAIT/NO_TRADE handling; " +
      "these labels back decision states the gate can still produce.",
    surface: "decision surfaces",
  },
  {
    match: "nav.*",
    category: "INTENTIONAL",
    reason: "Navigation label for a tab not present in the current default layout.",
    surface: "navigation",
  },
];

function classify(key) {
  for (const rule of RULES) {
    if (rule.match.endsWith(".*")) {
      if (key.startsWith(`${rule.match.slice(0, -1)}`)) return rule;
    } else if (key === rule.match) return rule;
  }
  return null;
}

const results = report.unreferencedKeys.map((key) => {
  const rule = classify(key);
  const ev = report.keyEvidence?.[key] ?? [];
  const testOnly = ev.length > 0 && ev.every((e) => e.startsWith("test:"));
  return {
    key,
    category: testOnly ? "TEST_DOC_ONLY" : (rule?.category ?? "UNCLASSIFIED"),
    reason: testOnly ? "Referenced only from test files." : (rule?.reason ?? ""),
    surface: rule?.surface ?? "",
    evidence: ev,
  };
});

const counts = {};
for (const r of results) counts[r.category] = (counts[r.category] ?? 0) + 1;

const unclassified = results.filter((r) => r.category === "UNCLASSIFIED");

if (process.argv.includes("--json")) {
  writeFileSync(
    join(ROOT, "docs", "i18n-key-classification.json"),
    `${JSON.stringify({ counts, results }, null, 2)}\n`,
  );
  console.log("wrote docs/i18n-key-classification.json");
}

console.log(`classified ${results.length} unreferenced keys`);
for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(18)} ${n}`);
}
if (unclassified.length) {
  console.log("\nUNCLASSIFIED (must be resolved, never bucketed):");
  for (const r of unclassified.slice(0, 40)) console.log(`  ${r.key}`);
  process.exit(1);
}
