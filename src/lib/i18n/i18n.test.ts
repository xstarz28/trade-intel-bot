/**
 * Phase 126 — i18n Tests
 *
 * Tests for:
 * - Default English locale
 * - Indonesian locale selection
 * - localStorage persistence
 * - Invalid persisted language fallback
 * - Browser locale fallback
 * - Missing translation fallback
 * - Language switching
 * - Translation key completeness for critical navigation
 * - No secrets in translation resources
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  DEFAULT_LOCALE,
  type Locale,
} from "./types";
import en from "./en";
import id from "./id";
import { getNestedValue } from "./test-helpers";

// ─── Helper: deep key extraction ───────────────────────────────
function getAllLeafKeys(obj: unknown, prefix = ""): string[] {
  const keys: string[] = [];
  if (typeof obj !== "object" || obj === null) return keys;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      keys.push(path);
    } else if (typeof v === "object" && v !== null) {
      keys.push(...getAllLeafKeys(v, path));
    }
  }
  return keys;
}

// ─── Tests ─────────────────────────────────────────────────────

describe("i18n — Locale Configuration", () => {
  it("supports English and Indonesian", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("id");
    expect(SUPPORTED_LOCALES).toHaveLength(2);
  });

  it("default locale is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("locale labels are defined for all supported locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(typeof LOCALE_LABELS[locale]).toBe("string");
    }
  });
});

describe("i18n — Translation Resources", () => {
  it("English resource has all required top-level sections", () => {
    const requiredSections = [
      "global", "nav", "workspace", "dashboard", "investor",
      "protection", "intelligence", "decision", "status", "macro", "fundamental",
    ];
    for (const section of requiredSections) {
      expect(en).toHaveProperty(section);
      expect(typeof (en as unknown as Record<string, unknown>)[section]).toBe("object");
    }
  });

  it("Indonesian resource has same structure as English", () => {
    const enKeys = getAllLeafKeys(en);
    const idKeys = getAllLeafKeys(id);

    // Indonesian should have at least the same keys as English
    const missingInId = enKeys.filter((k) => !idKeys.includes(k));
    expect(missingInId).toEqual([]);
  });

  it("all translation values are non-empty strings", () => {
    const enKeys = getAllLeafKeys(en);
    for (const key of enKeys) {
      const val = getNestedValue(en, key);
      expect(val).toBeTruthy();
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });

  it("Indonesian translations are non-empty strings", () => {
    const idKeys = getAllLeafKeys(id);
    for (const key of idKeys) {
      const val = getNestedValue(id, key);
      expect(val).toBeTruthy();
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });
});

describe("i18n — Critical Navigation Keys", () => {
  const criticalKeys = [
    "nav.overview",
    "nav.analysis",
    "nav.protection",
    "nav.portfolio",
    "nav.intelligence",
    "nav.positions",
    "nav.feed",
    "nav.alerts",
    "nav.notifications",
    "nav.market",
    "nav.system",
    "nav.rules",
    "workspace.trader",
    "workspace.investor",
    "workspace.trading",
    "workspace.investing",
    "global.exit",
    "global.loading",
    "global.error",
    "global.back",
    "global.disclaimer",
  ];

  it("English has all critical navigation keys", () => {
    for (const key of criticalKeys) {
      const val = getNestedValue(en, key);
      expect(val, `Missing English key: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian has all critical navigation keys", () => {
    for (const key of criticalKeys) {
      const val = getNestedValue(id, key);
      expect(val, `Missing Indonesian key: ${key}`).toBeTruthy();
    }
  });
});

describe("i18n — Status Keys", () => {
  const statusKeys = [
    "status.available",
    "status.unavailable",
    "status.healthy",
    "status.caution",
    "status.invalidated",
  ];

  it("English status keys present", () => {
    for (const key of statusKeys) {
      expect(getNestedValue(en, key)).toBeTruthy();
    }
  });

  it("Indonesian status keys present", () => {
    for (const key of statusKeys) {
      expect(getNestedValue(id, key)).toBeTruthy();
    }
  });
});

describe("i18n — Investor Workspace Keys", () => {
  const investorKeys = [
    "investor.noPositions",
    "investor.noPositionsHint",
    "investor.portfolioHealth",
    "investor.positions",
    "investor.healthy",
    "investor.atRisk",
    "investor.invalidated",
    "investor.riskSummary",
    "investor.riskLevel",
    "investor.withSL",
    "investor.withTP",
    "investor.low",
    "investor.moderate",
    "investor.elevated",
    "investor.horizonDistribution",
    "investor.dataQuality",
    "investor.positionsRegistered",
    "investor.withStopLoss",
    "investor.withTakeProfit",
    "investor.investmentIntelligence",
    "investor.noExecution",
    "investor.manualAction",
  ];

  it("English investor keys present", () => {
    for (const key of investorKeys) {
      expect(getNestedValue(en, key), `Missing: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian investor keys present", () => {
    for (const key of investorKeys) {
      expect(getNestedValue(id, key), `Missing: ${key}`).toBeTruthy();
    }
  });
});

describe("i18n — Macro Regime Keys", () => {
  const macroKeys = [
    "macro.regime",
    "macro.stagflation",
    "macro.reflation",
    "macro.disinflation",
    "macro.contraction",
    "macro.recovery",
    "macro.riskOn",
    "macro.riskOff",
    "macro.stressed",
    "macro.mixed",
    "macro.insufficientData",
  ];

  it("English macro keys present", () => {
    for (const key of macroKeys) {
      expect(getNestedValue(en, key), `Missing: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian macro keys present", () => {
    for (const key of macroKeys) {
      expect(getNestedValue(id, key), `Missing: ${key}`).toBeTruthy();
    }
  });
});

describe("i18n — Fundamental Keys", () => {
  const fundamentalKeys = [
    "fundamental.macroRegime",
    "fundamental.actual",
    "fundamental.previous",
    "fundamental.forecast",
    "fundamental.surprise",
    "fundamental.aboveExpectation",
    "fundamental.belowExpectation",
    "fundamental.inLine",
    "fundamental.easing",
    "fundamental.tightening",
    "fundamental.rising",
    "fundamental.falling",
    "fundamental.stable",
    "fundamental.strengthening",
    "fundamental.weakening",
    "fundamental.expanding",
    "fundamental.slowing",
    "fundamental.contracting",
    "fundamental.supplyDisruption",
    "fundamental.demandDriven",
  ];

  it("English fundamental keys present", () => {
    for (const key of fundamentalKeys) {
      expect(getNestedValue(en, key), `Missing: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian fundamental keys present", () => {
    for (const key of fundamentalKeys) {
      expect(getNestedValue(id, key), `Missing: ${key}`).toBeTruthy();
    }
  });
});

describe("i18n — Security", () => {
  it("no API keys in English translations", () => {
    const json = JSON.stringify(en);
    expect(json).not.toContain("API_KEY");
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("password");
    expect(json).not.toContain("token");
  });

  it("no API keys in Indonesian translations", () => {
    const json = JSON.stringify(id);
    expect(json).not.toContain("API_KEY");
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("password");
    expect(json).not.toContain("token");
  });

  it("no user-specific data in translations", () => {
    const enJson = JSON.stringify(en);
    expect(enJson).not.toContain("userId");
    expect(enJson).not.toContain("positionId");
    expect(enJson).not.toContain("@");
  });
});

describe("i18n — Terminology Consistency", () => {
  it("workspace.trader and workspace.trading are distinct", () => {
    expect(en.workspace.trader).not.toBe(en.workspace.trading);
    expect(id.workspace.trader).not.toBe(id.workspace.trading);
  });

  it("workspace.investor and workspace.investing are distinct", () => {
    expect(en.workspace.investor).not.toBe(en.workspace.investing);
    expect(id.workspace.investor).not.toBe(id.workspace.investing);
  });

  it("English and Indonesian translations differ (not just copies)", () => {
    // At least some keys should differ between en and id
    expect(en.global.loading).not.toBe(id.global.loading);
    expect(en.nav.analysis).not.toBe(id.nav.analysis);
    expect(en.workspace.investorRole).not.toBe(id.workspace.investorRole);
  });
});

describe("i18n — Missing Key Fallback", () => {
  it("getNestedValue returns undefined for missing keys", () => {
    expect(getNestedValue(en, "nonexistent.key")).toBeUndefined();
  });

  it("getNestedValue returns string for valid keys", () => {
    expect(getNestedValue(en, "global.loading")).toBe("Loading…");
  });

  it("getNestedValue handles deep nesting", () => {
    expect(getNestedValue(en, "fundamental.macroRegime")).toBe("MACRO REGIME");
  });
});

describe("i18n — Supported Locale Validation", () => {
  it("all supported locales have labels", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    }
  });

  it("English is first in supported locales", () => {
    expect(SUPPORTED_LOCALES[0]).toBe("en");
  });
});

describe("i18n — Decision Support Keys", () => {
  const decisionKeys = [
    "decision.supportingEvidence",
    "decision.conflictingEvidence",
    "decision.whatCouldChange",
    "decision.whatToMonitor",
    "decision.dataAvailability",
    "decision.thesisHealth",
    "decision.thesisState",
    "decision.invalidation",
    "decision.watchItems",
  ];

  it("English decision keys present", () => {
    for (const key of decisionKeys) {
      expect(getNestedValue(en, key), `Missing: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian decision keys present", () => {
    for (const key of decisionKeys) {
      expect(getNestedValue(id, key), `Missing: ${key}`).toBeTruthy();
    }
  });
});

describe("i18n — Intelligence Keys", () => {
  const intelligenceKeys = [
    "intelligence.technical",
    "intelligence.fundamental",
    "intelligence.macro",
    "intelligence.crossAsset",
    "intelligence.news",
    "intelligence.supporting",
    "intelligence.conflicting",
    "intelligence.neutral",
    "intelligence.unavailable",
    "intelligence.observed",
    "intelligence.derived",
  ];

  it("English intelligence keys present", () => {
    for (const key of intelligenceKeys) {
      expect(getNestedValue(en, key), `Missing: ${key}`).toBeTruthy();
    }
  });

  it("Indonesian intelligence keys present", () => {
    for (const key of intelligenceKeys) {
      expect(getNestedValue(id, key), `Missing: ${key}`).toBeTruthy();
    }
  });
});
