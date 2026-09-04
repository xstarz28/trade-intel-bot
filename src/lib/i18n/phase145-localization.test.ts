/**
 * Phase 145 — Full 9-Locale Localization Completion
 *
 * Canonical target: en, id, es, pt, fr, de, ja, ko, zh
 *
 * Verifies:
 * - exactly 9 canonical locales (registry + resources)
 * - exact leaf-key parity across all 9 dictionaries (no missing/extra keys)
 * - no empty user-facing translations
 * - placeholder parity per key (placeholder(source) === placeholder(target))
 * - browser-locale normalization for every canonical locale + fallbacks
 * - enum-mapping coverage for every mapping over all 9 locales
 * - unknown-enum safe fallbacks
 * - universal tickers/terms identical across all 9 locales
 * - zh (Simplified Chinese) explicitly verified — never hidden behind an
 *   8-locale subset
 */

import { describe, it, expect } from "vitest";
import en from "./en";
import id from "./id";
import es from "./es";
import pt from "./pt";
import fr from "./fr";
import de from "./de";
import ja from "./ja";
import ko from "./ko";
import zh from "./zh";
import type { Locale, Translations } from "./types";
import { ALL_LOCALES, DEFAULT_LOCALE } from "./types";
import {
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  getEnabledLocales,
  getAvailableLocales,
  normalizeBrowserLocale,
} from "./locales";
import {
  mapAvailability,
  mapComponentName,
  mapConfidence,
  mapCoverage,
  mapDecisionState,
  mapDirection,
  mapHorizon,
  mapIntelligenceStatus,
  mapMarketState,
  mapMonitorState,
  mapPositionImpact,
  mapRegimeValue,
  mapRelevance,
  mapRiskLevel,
  mapSensitivity,
  mapSeverity,
  mapStance,
  mapThesisHealth,
  mapTrendLabel,
} from "./enum-mapping";
import { formatNumber, formatPercentFromDecimal, formatCurrency } from "./format";

// ─── Canonical set ─────────────────────────────────────────────

const NINE: Locale[] = ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"];
const RESOURCES: Record<Locale, Translations> = { en, id, es, pt, fr, de, ja, ko, zh };

function collectLeaves(obj: unknown, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push([path, v]);
    else out.push(...collectLeaves(v, path));
  }
  return out;
}

const PH = /\{[a-zA-Z0-9_]+\}/g;
const placeholderSet = (value: string): Set<string> =>
  new Set(value.match(PH) ?? []);

describe("9-locale registry (Phase 145)", () => {
  it("the canonical target is exactly the nine locales", () => {
    expect(ALL_LOCALES.length).toBe(9);
    expect([...ALL_LOCALES].sort()).toEqual([...NINE].sort());
  });

  it("registry has exactly 9 entries, all enabled and available", () => {
    expect(LOCALE_REGISTRY.length).toBe(9);
    const codes = LOCALE_REGISTRY.map((l) => l.locale).sort();
    expect(codes).toEqual([...NINE].sort());
    expect(getEnabledLocales().length).toBe(9);
    expect(getAvailableLocales().length).toBe(9);
    expect(SUPPORTED_LOCALES.length).toBe(9);
  });

  it("every registry locale has a resource and vice versa", () => {
    for (const code of NINE) {
      expect(RESOURCES[code], code).toBeDefined();
    }
  });

  it("DEFAULT_LOCALE is en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("exact leaf-key parity across all 9 locales", () => {
  const enLeaves = collectLeaves(en).map(([k]) => k).sort();
  const enCount = enLeaves.length;

  it("EN is the canonical structural reference with 768 leaves", () => {
    expect(enCount).toBe(768);
  });

  for (const code of NINE) {
    it(`${code} has exactly the same leaf keys as EN`, () => {
      const leaves = collectLeaves(RESOURCES[code]).map(([k]) => k).sort();
      expect(leaves).toEqual(enLeaves);
      expect(leaves.length).toBe(enCount);
    });
  }

  it("no duplicate leaf keys exist in any dictionary", () => {
    for (const code of NINE) {
      const leaves = collectLeaves(RESOURCES[code]).map(([k]) => k);
      expect(new Set(leaves).size, code).toBe(leaves.length);
    }
  });

  it("no leaf value is empty or whitespace-only in any locale", () => {
    for (const code of NINE) {
      for (const [, value] of collectLeaves(RESOURCES[code])) {
        expect(value.trim().length, `${code} empty value`).toBeGreaterThan(0);
      }
    }
  });
});

describe("placeholder parity across all 9 locales", () => {
  const enPlaceholders = new Map(
    collectLeaves(en).map(([k, v]) => [k, placeholderSet(v)]),
  );

  it("EN placeholders are a strict subset of the known vocabulary", () => {
    const known = [
      "{count}",
      "{time}",
      "{value}",
      "{scanned}",
      "{live}",
      "{duration}",
      "{fresh}",
      "{delayed}",
      "{stale}",
      "{unavailable}",
      "{expired}",
      "{invalidated}",
    ];
    for (const [, set] of enPlaceholders) {
      for (const p of set) {
        expect(known).toContain(p);
      }
    }
  });

  for (const code of NINE) {
    it(`${code} preserves placeholder(source) === placeholder(target) per key`, () => {
      for (const [key, value] of collectLeaves(RESOURCES[code])) {
        const want = enPlaceholders.get(key);
        if (!want || want.size === 0) continue;
        const got = placeholderSet(value);
        expect([...got].sort().join(","), `${code}.${key}`)
          .toBe([...want].sort().join(","));
      }
    });
  }

  it("the interpolation-bearing keys carry placeholders in every locale", () => {
    const keys = [
      "protection.positionsCount",
      "protection.eventsCount",
      "notifications.unread",
      "notifications.ago",
      "notifications.minutes",
      "notifications.hours",
      "notifications.days",
      "trader.viewAlerts",
      "intelligence.dimensionsCount",
      "system.historyCount",
      "system.unavailableCount",
    ];
    const getAt = (obj: unknown, path: string): string => {
      const parts = path.split(".");
      let cur: unknown = obj;
      for (const p of parts) {
        cur = (cur as Record<string, unknown>)[p];
      }
      return cur as string;
    };
    for (const code of NINE) {
      for (const key of keys) {
        expect(placeholderSet(getAt(RESOURCES[code], key)).size,
          `${code}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("locale normalization and fallback", () => {
  const variants: Array<[string, Locale]> = [
    ["en", "en"], ["en-US", "en"], ["en-GB", "en"],
    ["id", "id"], ["id-ID", "id"],
    ["es", "es"], ["es-ES", "es"], ["es-MX", "es"],
    ["pt", "pt"], ["pt-BR", "pt"], ["pt-PT", "pt"],
    ["fr", "fr"], ["fr-FR", "fr"], ["fr-CA", "fr"],
    ["de", "de"], ["de-DE", "de"], ["de-AT", "de"],
    ["ja", "ja"], ["ja-JP", "ja"],
    ["ko", "ko"], ["ko-KR", "ko"],
    ["zh", "zh"], ["zh-CN", "zh"], ["zh-TW", "zh"], ["zh-HK", "zh"], ["zh-SG", "zh"],
  ];

  it("normalizes every canonical base code and common regional variant", () => {
    for (const [input, expected] of variants) {
      expect(normalizeBrowserLocale(input), input).toBe(expected);
    }
  });

  it("returns null for unknown, malformed and empty inputs", () => {
    expect(normalizeBrowserLocale("xx-XX")).toBeNull();
    expect(normalizeBrowserLocale("")).toBeNull();
    expect(normalizeBrowserLocale("e")).toBeNull();
    expect(normalizeBrowserLocale("english")).toBeNull();
    expect(normalizeBrowserLocale("-US")).toBeNull();
  });
});

describe("enum-mapping coverage over all 9 locales", () => {
  const mappings: Array<[string, (v: string, t: Translations) => string, string[]]> = [
    ["mapAvailability", mapAvailability, ["AVAILABLE", "LIMITED", "INSUFFICIENT", "STALE", "UNAVAILABLE"]],
    ["mapComponentName", mapComponentName, ["MARKET_DATA", "OHLCV", "NEWS", "MACRO", "CROSS_ASSET", "INTELLIGENCE", "PORTFOLIO", "ALERT_RULES", "NOTIFICATIONS", "HISTORICAL"]],
    ["mapConfidence", mapConfidence, ["STRONG_EVIDENCE", "MODERATE_EVIDENCE", "WEAK_EVIDENCE", "INSUFFICIENT_EVIDENCE", "HIGH", "MEDIUM", "LOW", "UNAVAILABLE"]],
    ["mapCoverage", mapCoverage, ["FULL", "PARTIAL", "EMPTY"]],
    ["mapDecisionState", mapDecisionState, ["ALIGNED", "CONFLICT", "CAUTION", "INSUFFICIENT_DATA", "UNAVAILABLE"]],
    ["mapDirection", mapDirection, ["SUPPORTING", "CONFLICTING", "NEUTRAL"]],
    ["mapHorizon", mapHorizon, ["SCALPING", "INTRADAY", "SWING", "INVESTING"]],
    ["mapIntelligenceStatus", mapIntelligenceStatus, ["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]],
    ["mapMarketState", mapMarketState, ["TRENDING_UP", "TRENDING_DOWN", "VOLATILE", "RANGING", "INSUFFICIENT_DATA", "UNKNOWN"]],
    ["mapMonitorState", mapMonitorState, ["IDLE", "STABLE", "WATCH", "ELEVATED", "SEVERE"]],
    ["mapPositionImpact", mapPositionImpact, ["SUPPORTING", "CONFLICTING", "NEUTRAL", "INSUFFICIENT"]],
    ["mapRegimeValue", mapRegimeValue, ["EASING", "NEUTRAL", "TIGHTENING", "RESTRICTIVE", "TRANSITIONING", "RISING", "FALLING", "STABLE", "STRENGTHENING", "WEAKENING", "VOLATILE", "EXPANDING", "SLOWING", "CONTRACTING", "RECOVERING", "BALANCED", "SUPPLY_DISRUPTION", "DEMAND_DRIVEN", "OIL_SHOCK", "ESCALATING", "DEESCALATING", "STRESSED", "RISK_ON", "RISK_OFF", "MIXED", "STAGFLATION", "REFLATION", "DISINFLATION", "CONTRACTION", "RECOVERY"]],
    ["mapRelevance", mapRelevance, ["DIRECT", "HIGH", "MODERATE", "LOW", "IRRELEVANT", "UNKNOWN"]],
    ["mapRiskLevel", mapRiskLevel, ["LOW", "MODERATE", "ELEVATED"]],
    ["mapSensitivity", mapSensitivity, ["HIGH", "MODERATE", "LOW", "UNKNOWN"]],
    ["mapSeverity", mapSeverity, ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]],
    ["mapStance", mapStance, ["SUPPORTING", "CONFLICTING", "MIXED", "NEUTRAL", "INSUFFICIENT"]],
    ["mapThesisHealth", mapThesisHealth, ["HEALTHY", "STABLE", "CAUTION", "DETERIORATING", "SEVERELY_DETERIORATING", "INVALIDATED", "INSUFFICIENT_DATA", "UNKNOWN"]],
    ["mapTrendLabel", mapTrendLabel, ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "UNKNOWN"]],
  ];

  it("every known enum value maps to a non-empty label in every locale", () => {
    for (const [name, fn, values] of mappings) {
      for (const code of NINE) {
        for (const value of values) {
          const label = fn(value, RESOURCES[code]);
          expect(label.trim().length, `${name}(${value}) @ ${code}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("mapping is locale-aware — each known value yields >= 2 distinct labels across the nine locales", () => {
    for (const [name, fn, values] of mappings) {
      for (const value of values) {
        const distinct = new Set(NINE.map((code) => fn(value, RESOURCES[code])));
        expect(distinct.size, `${name}(${value})`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("wordy status/decision values are translated in every non-English locale", () => {
    // Guard against silent English fallback for representative wordy enums.
    // (Loan words that are identical in the target language, e.g. NEUTRAL /
    // STABLE in fr/de/es, and EN's own telegraphic badge tokens are exempt.)
    const probes: Array<[string, (v: string, t: Translations) => string, string[]]> = [
      ["mapSeverity(HIGH_RISK)", mapSeverity, ["HIGH_RISK"]],
      ["mapThesisHealth(INVALIDATED)", mapThesisHealth, ["INVALIDATED"]],
      ["mapDecisionState(ALIGNED)", mapDecisionState, ["ALIGNED"]],
      ["mapDecisionState(CONFLICT)", mapDecisionState, ["CONFLICT"]],
      ["mapAvailability(UNAVAILABLE)", mapAvailability, ["UNAVAILABLE"]],
      ["mapConfidence(STRONG_EVIDENCE)", mapConfidence, ["STRONG_EVIDENCE"]],
      ["mapMonitorState(SEVERE)", mapMonitorState, ["SEVERE"]],
      ["mapStance(CONFLICTING)", mapStance, ["CONFLICTING"]],
    ];
    for (const [name, fn, values] of probes) {
      for (const value of values) {
        for (const code of NINE.filter((c) => c !== "en")) {
          expect(fn(value, RESOURCES[code]), `${name} @ ${code}`).not.toBe(value);
        }
      }
    }
  });

  it("unknown enum values fall back to a readable sanitized label (never blank, never crash)", () => {
    for (const [name, fn] of mappings) {
      for (const code of NINE) {
        const label = fn("SOME_FUTURE_TOKEN_42", RESOURCES[code]);
        expect(label.length, `${name} @ ${code}`).toBeGreaterThan(0);
        expect(label).toContain("42");
        expect(label).not.toMatch(/SOME_FUTURE_TOKEN_42/);
        expect(label).not.toMatch(/_/);
      }
    }
  });
});

describe("universal tickers stay identical across all 9 locales", () => {
  const universal: Array<[string, (t: Translations) => string]> = [
    ["market.vix", (t) => t.market.vix],
    ["market.dxy", (t) => t.market.dxy],
    ["market.us10y", (t) => t.market.us10y],
    ["market.wti", (t) => t.market.wti],
  ];
  it("provider tickers are identical in all nine locales", () => {
    for (const [key, getter] of universal) {
      const first = getter(RESOURCES.en);
      for (const code of NINE) {
        expect(getter(RESOURCES[code]), `${key} @ ${code}`).toBe(first);
      }
    }
  });
});

describe("languages are genuinely distinct from EN", () => {
  const samples = [
    (t: Translations) => t.global.loading,
    (t: Translations) => t.nav.analysis,
    (t: Translations) => t.status.healthy,
    (t: Translations) => t.investor.noPositions,
    (t: Translations) => t.protection.title,
    (t: Translations) => t.journal.title,
  ] as const;

  it("every non-English locale differs from EN on representative UI copy", () => {
    for (const code of NINE.filter((c) => c !== "en")) {
      for (const sample of samples) {
        expect(sample(RESOURCES[code]), `${code} sample`).not.toBe(sample(RESOURCES.en));
      }
    }
  });
});

describe("financial formatting smoke across the new locales", () => {
  it("formatNumber does not throw and keeps numeric value for fr/de/ja/ko/zh", () => {
    for (const code of ["fr", "de", "ja", "ko", "zh"] as Locale[]) {
      const out = formatNumber(1234567.89, code);
      expect(out, code).toContain("1");
      expect(out, code).toContain("7");
      expect(out, code).toContain("89");
    }
  });

  it("formatPercentFromDecimal and formatCurrency do not throw", () => {
    for (const code of NINE) {
      expect(formatPercentFromDecimal(0.055, code, 2), code).toContain("%");
      expect(formatCurrency(1234.56, "USD", code).length, code).toBeGreaterThan(0);
    }
  });
});

// ─── ZH explicit verification ──────────────────────────────────

describe("ZH (Simplified Chinese) — explicit verification", () => {
  it("zh dictionary exists, is registered and is enabled+available", () => {
    expect(zh).toBeDefined();
    expect(ALL_LOCALES).toContain("zh");
    expect(SUPPORTED_LOCALES).toContain("zh");
    const meta = LOCALE_REGISTRY.find((l) => l.locale === "zh");
    expect(meta?.enabled).toBe(true);
    expect(meta?.available).toBe(true);
  });

  it("zh has all 768 canonical keys with non-empty values", () => {
    const zhLeaves = collectLeaves(zh);
    expect(zhLeaves.length).toBe(768);
    for (const [key, value] of zhLeaves) {
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("zh never silently falls back to English for ordinary static strings", () => {
    // Ordinary UI copy must be Chinese, not verbatim English.
    expect(zh.nav.analysis).not.toBe(en.nav.analysis);
    expect(zh.global.loading).not.toBe("Loading…");
    expect(zh.investor.portfolioHealth).not.toBe("PORTFOLIO HEALTH");
    expect(zh.protection.title).not.toBe("Position Protection");
    expect(zh.status.healthy).not.toBe("HEALTHY");
    expect(zh.status.caution).not.toBe("CAUTION");
    expect(zh.notifications.title).not.toBe("Notifications");
  });

  it("zh financial terminology is coherent and Simplified", () => {
    expect(zh.analysis.bullish).toBe("看多");
    expect(zh.analysis.bearish).toBe("看空");
    expect(zh.analysis.long).toBe("做多");
    expect(zh.analysis.short).toBe("做空");
    expect(zh.protection.stopLossLabel).toBe("止损");
    expect(zh.protection.takeProfitLabel).toBe("止盈");
    expect(zh.investor.noPositions).toContain("持仓");
    expect(zh.investor.portfolio).toContain("投资组合");
    expect(zh.decision.thesisHealth).toContain("论点");
    // Simplified-specific characters (not Traditional)
    expect(zh.investor.positions).not.toContain("倉");
    expect(zh.investor.positions).not.toContain("盤");
    expect(zh.global.loading).not.toContain("載入");
  });

  it("zh preserves monitor/decision/coverage vocabulary consistently", () => {
    // Status family
    expect(zh.status.available).toBe("可用");
    expect(zh.status.unavailable).toBe("不可用");
    expect(zh.status.limited).toBe("有限");
    // Decision family
    expect(zh.investor.decisionStateAligned).toBe("一致");
    expect(zh.investor.decisionStateConflict).toBe("冲突");
    expect(zh.investor.monitorStable).toBe("稳定");
    expect(zh.investor.monitorSevere).toBe("严重");
  });
});
