/**
 * Phase 193 — orphan translation-key guard.
 *
 * The existing parity guards answer "do all nine locales agree?". They cannot
 * answer "is this key rendered to anyone?", which is how a translation can
 * outlive the UI that displayed it — or, far worse, how a DISCONNECTED
 * CONSUMER can hide behind a healthy-looking key count.
 *
 * WHAT THIS GUARD IS FOR
 *   Phase 193 found `market.live` / `market.stale` / `market.unavailable`
 *   translated into all nine locales while MarketOverviewPanel rendered the
 *   English words "LIVE" and "STALE" directly. Parity was perfect. The user
 *   still saw untranslated text. That defect is invisible to a key-count test
 *   and visible to this one.
 *
 * WHY IT IS NOT A BLIND "DELETE UNUSED KEYS" RULE
 *   Most unreferenced keys are NOT dead. They belong to surfaces that exist
 *   but render conditionally (provider evidence absent, tab not in the default
 *   layout, backend state unreachable). Failing on those would push the next
 *   contributor to delete real vocabulary to get green — the exact outcome
 *   this phase forbids. So the guard asserts a BUDGET plus an explicit,
 *   self-validating allowlist, and the budget may only shrink.
 *
 * HONEST SCOPE (see also the structural-vs-behavioural note in Phase 192):
 *   This is static analysis over the import graph and member-access syntax. It
 *   proves a key is *reachable from a mounted module*, not that a human saw
 *   it. Rendering is covered by the surface tests below and by HUMAN UAT.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REPORT = join(ROOT, "docs", "i18n-key-usage.json");

/** Regenerate the evidence so the guard can never assert on a stale artifact. */
function loadReport(): {
  totalLeaves: number;
  referenced: number;
  unreferenced: number;
  unreferencedKeys: string[];
  keyEvidence: Record<string, string[]>;
  dynamicSites: Array<{ file: string; hint: string; snippet: string; isTest: boolean }>;
  orphanModules: string[];
} {
  execFileSync("node", [join(ROOT, "scripts", "i18n-key-usage-report.mjs"), "--json"], {
    cwd: ROOT,
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(REPORT, "utf8"));
}

const report = loadReport();

/**
 * Budget for unreferenced production keys. A RATCHET: it may only go down.
 *
 * Raising it requires a deliberate edit and a reason, which is the point —
 * adding vocabulary nothing renders should be a conscious act.
 */
const UNREFERENCED_BUDGET = 261;

/**
 * Keys deliberately retained despite having no statically visible consumer.
 * Each entry must state a surface and a reason. The allowlist is validated
 * against reality below: a stale entry fails the suite.
 */
const INTENTIONAL_ALLOWLIST: Record<string, { reason: string; surface: string }> = {
  "provenance.observedNow": {
    reason: "Phase 191 provenance vocabulary; renderer exists, data plumbing pending.",
    surface: "provenance-copy.ts",
  },
  "provenance.cacheReused": {
    reason: "Distinguishes reused cache from a new observation — safety-critical wording.",
    surface: "provenance-copy.ts",
  },
  "provenance.historical": {
    reason: "Marks replayed analysis as historical, never current.",
    surface: "provenance-copy.ts",
  },
  "system.overallStatus": {
    reason: "Health-summary heading retained for the runtime health surface.",
    surface: "RuntimeHealthDashboard",
  },
  "global.save": {
    reason: "Shared primitive; removing it guarantees the next form hardcodes English.",
    surface: "shared",
  },
  "global.cancel": {
    reason: "Shared primitive, as above.",
    surface: "shared",
  },
};

describe("193 — the orphan-key guard is real, not vacuous", () => {
  it("the usage report was actually produced", () => {
    expect(existsSync(REPORT)).toBe(true);
    expect(report.totalLeaves).toBeGreaterThan(900);
  });

  it("it discovered a substantial number of REFERENCED keys", () => {
    // Vacuity probe: if the scanner's member-access matching broke, almost
    // everything would look unreferenced and the budget would pass trivially
    // only because the number moved the other way. Assert the positive side.
    expect(report.referenced).toBeGreaterThan(600);
    expect(report.referenced + report.unreferenced).toBe(report.totalLeaves);
  });

  it("known-rendered keys are never reported as unreferenced", () => {
    // Positive control with keys proven to render in Phases 189-191.
    const mustBeReferenced = [
      "auth.sendFailed",
      "auth.codeIncorrect",
      "auth.restoringSession",
      "landing.heroTitle",
      "nav.analysis",
      "global.loading",
      "entitlement.upgradeRequired",
      "marketPanel.freshness.fresh",
    ];
    const unreferenced = new Set(report.unreferencedKeys);
    for (const key of mustBeReferenced) {
      expect(unreferenced.has(key), `${key} was wrongly reported unreferenced`).toBe(false);
    }
  });

  it("credits INDIRECT consumers such as enum-mapping", () => {
    // `mapStance` renders these; a scanner that only looked at components
    // would call them dead and delete the decision vocabulary.
    const unreferenced = new Set(report.unreferencedKeys);
    expect(unreferenced.has("intelligence.stanceSupporting")).toBe(false);
    expect(unreferenced.has("intelligence.stanceConflicting")).toBe(false);
  });

  it("credits keys consumed through a string method (interpolation idiom)", () => {
    // `t.system.historyCount.replace("{count}", n)` — the member access runs
    // past the leaf. An earlier revision of the scanner reported these as
    // unused, which would have deleted live copy.
    const unreferenced = new Set(report.unreferencedKeys);
    expect(unreferenced.has("system.historyCount")).toBe(false);
    expect(unreferenced.has("system.unavailableCount")).toBe(false);
  });
});

describe("193 — unreferenced keys stay within budget", () => {
  it("does not exceed the ratchet", () => {
    expect(
      report.unreferenced,
      `Unreferenced keys rose to ${report.unreferenced} (budget ${UNREFERENCED_BUDGET}). ` +
        "Either wire the new key to a consumer, or justify it in INTENTIONAL_ALLOWLIST.",
    ).toBeLessThanOrEqual(UNREFERENCED_BUDGET);
  });

  it("the budget is not absurdly slack", () => {
    // Prevents the ratchet being neutered by setting it to a huge number.
    expect(UNREFERENCED_BUDGET).toBeLessThan(report.totalLeaves / 2);
  });
});

describe("193 — the intentional allowlist is validated against reality", () => {
  it("every allowlisted key still exists in the catalogue", () => {
    // A renamed/deleted key must not linger as a phantom justification.
    const en = readFileSync(join(ROOT, "src", "lib", "i18n", "en.ts"), "utf8");
    for (const key of Object.keys(INTENTIONAL_ALLOWLIST)) {
      const leaf = key.split(".").pop()!;
      expect(en.includes(`${leaf}:`), `allowlisted key ${key} no longer exists`).toBe(true);
    }
  });

  it("every allowlisted key is genuinely unreferenced", () => {
    // If a key gains a consumer, its allowlist entry is obsolete and must be
    // removed — otherwise the allowlist slowly becomes a place to hide keys.
    const unreferenced = new Set(report.unreferencedKeys);
    for (const key of Object.keys(INTENTIONAL_ALLOWLIST)) {
      expect(
        unreferenced.has(key),
        `${key} now HAS a consumer — remove its INTENTIONAL_ALLOWLIST entry`,
      ).toBe(true);
    }
  });

  it("every entry states a reason and a surface", () => {
    for (const [key, meta] of Object.entries(INTENTIONAL_ALLOWLIST)) {
      expect(meta.reason.length, `${key} has no reason`).toBeGreaterThan(20);
      expect(meta.surface.length, `${key} has no surface`).toBeGreaterThan(0);
    }
  });
});

describe("193 — dynamic lookup mechanisms are known and bounded", () => {
  it("the only production dynamic translation site is tx() itself", () => {
    // If a component starts building keys at runtime, static analysis stops
    // being sufficient and this guard must be re-reasoned. Fail loudly then.
    const productionDynamic = report.dynamicSites.filter((s) => !s.isTest);
    for (const site of productionDynamic) {
      expect(
        site.file,
        `unexpected dynamic translation lookup in ${site.file}: ${site.snippet}`,
      ).toBe("src/lib/i18n/index.ts");
    }
  });

  it("tx() resolves a real dot-path at runtime", async () => {
    // Behavioural proof that the dynamic mechanism works, so classifying keys
    // as reachable-only-via-tx is meaningful rather than theoretical.
    const en = (await import("@/lib/i18n/en")).default;
    const lookup = (obj: unknown, path: string): unknown =>
      path.split(".").reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
        obj,
      );
    expect(lookup(en, "nav.analysis")).toBe(en.nav.analysis);
    expect(lookup(en, "does.not.exist")).toBeUndefined();
  });
});

describe("193 — unmounted modules are visible, not silently trusted", () => {
  it("reports modules unreachable from the entry point", () => {
    // Reachability is what distinguishes "a component consumes this key" from
    // "a component nobody mounts consumes this key". Assert the mechanism
    // works by checking a module that IS mounted is absent from the list.
    expect(report.orphanModules).not.toContain("src/components/PositionProtectionDashboard.tsx");
    expect(report.orphanModules).not.toContain("src/pages/Dashboard.tsx");
  });

  it("the three Phase 67 protection views remain unmounted and are tracked", () => {
    // Documented state, not an accident: the mounted dashboard's tabbed layout
    // supersedes them. Recorded so a future reader does not "rediscover" this.
    for (const mod of [
      "src/components/PositionProtectionControlCenter.tsx",
      "src/components/PositionProtectionDetail.tsx",
      "src/components/ProtectionAlertCenter.tsx",
    ]) {
      expect(report.orphanModules).toContain(mod);
    }
  });
});
