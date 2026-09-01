import { describe, it, expect } from "vitest";
import type { Locale } from "./types";
import {
  LOCALE_REGISTRY,
  getLocaleMetadata,
  getEnabledLocales,
  getAvailableLocales,
  isLocaleEnabled,
  isLocaleAvailable,
  normalizeBrowserLocale,
  getLocaleDisplayName,
  getLocaleDirection,
} from "./locales";
import {
  formatNumber,
  formatDecimal,
  formatCompact,
  formatPercent,
  formatPercentFromDecimal,
  formatCurrency,
  formatShortDate,
  formatDateTime,
  formatRelativeTime,
  formatPrice,
  formatPnL,
  parseLocaleNumber,
} from "./format";
import { ALL_LOCALES, SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_LABELS } from "./types";

// ─── Locale Registry Tests ─────────────────────────────────────

describe("locale registry", () => {
  it("has entries for all planned locales", () => {
    expect(LOCALE_REGISTRY.length).toBeGreaterThanOrEqual(9);
  });

  it("includes en, id, es, fr, pt, de, ja, ko, zh", () => {
    const codes = LOCALE_REGISTRY.map((l) => l.locale);
    expect(codes).toContain("en");
    expect(codes).toContain("id");
    expect(codes).toContain("es");
    expect(codes).toContain("fr");
    expect(codes).toContain("pt");
    expect(codes).toContain("de");
    expect(codes).toContain("ja");
    expect(codes).toContain("ko");
    expect(codes).toContain("zh");
  });

  it("en and id are enabled", () => {
    expect(isLocaleEnabled("en")).toBe(true);
    expect(isLocaleEnabled("id")).toBe(true);
  });

  it("es, fr, pt, de, ja, ko, zh are not yet enabled", () => {
    expect(isLocaleEnabled("es")).toBe(false);
    expect(isLocaleEnabled("fr")).toBe(false);
    expect(isLocaleEnabled("pt")).toBe(false);
    expect(isLocaleEnabled("de")).toBe(false);
    expect(isLocaleEnabled("ja")).toBe(false);
    expect(isLocaleEnabled("ko")).toBe(false);
    expect(isLocaleEnabled("zh")).toBe(false);
  });

  it("en and id are available (have translation resources)", () => {
    expect(isLocaleAvailable("en")).toBe(true);
    expect(isLocaleAvailable("id")).toBe(true);
  });

  it("getEnabledLocales returns only en and id", () => {
    const enabled = getEnabledLocales();
    expect(enabled.length).toBe(2);
    expect(enabled.map((l) => l.locale)).toEqual(["en", "id"]);
  });

  it("getAvailableLocales returns only en and id", () => {
    const available = getAvailableLocales();
    expect(available.length).toBe(2);
    expect(available.map((l) => l.locale)).toEqual(["en", "id"]);
  });
});

describe("locale metadata", () => {
  it("each locale has required metadata fields", () => {
    for (const entry of LOCALE_REGISTRY) {
      expect(entry.locale).toBeTruthy();
      expect(entry.nativeName).toBeTruthy();
      expect(entry.englishName).toBeTruthy();
      expect(["ltr", "rtl"]).toContain(entry.direction);
      expect(typeof entry.enabled).toBe("boolean");
      expect(typeof entry.available).toBe("boolean");
    }
  });

  it("getLocaleMetadata returns correct metadata", () => {
    const enMeta = getLocaleMetadata("en");
    expect(enMeta).toBeDefined();
    expect(enMeta?.nativeName).toBe("English");
    expect(enMeta?.englishName).toBe("English");
    expect(enMeta?.direction).toBe("ltr");
    expect(enMeta?.enabled).toBe(true);
  });

  it("getLocaleMetadata returns undefined for unknown locale", () => {
    // This test uses type casting to test the function's behavior
    const result = getLocaleMetadata("xx" as Locale);
    expect(result).toBeUndefined();
  });

  it("all locales are LTR (no RTL languages yet)", () => {
    for (const entry of LOCALE_REGISTRY) {
      expect(entry.direction).toBe("ltr");
    }
  });
});

describe("browser locale normalization", () => {
  it("normalizes en-US to en", () => {
    expect(normalizeBrowserLocale("en-US")).toBe("en");
  });

  it("normalizes en-GB to en", () => {
    expect(normalizeBrowserLocale("en-GB")).toBe("en");
  });

  it("normalizes fr-FR to null (not enabled)", () => {
    expect(normalizeBrowserLocale("fr-FR")).toBeNull();
  });

  it("normalizes de-DE to null (not enabled)", () => {
    expect(normalizeBrowserLocale("de-DE")).toBeNull();
  });

  it("normalizes pt-BR to null (not enabled)", () => {
    expect(normalizeBrowserLocale("pt-BR")).toBeNull();
  });

  it("normalizes zh-CN to null (not enabled)", () => {
    expect(normalizeBrowserLocale("zh-CN")).toBeNull();
  });

  it("normalizes ja-JP to null (not enabled)", () => {
    expect(normalizeBrowserLocale("ja-JP")).toBeNull();
  });

  it("normalizes ko-KR to null (not enabled)", () => {
    expect(normalizeBrowserLocale("ko-KR")).toBeNull();
  });

  it("returns null for completely unknown locales", () => {
    expect(normalizeBrowserLocale("xx-XX")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeBrowserLocale("")).toBeNull();
  });
});

describe("locale display names", () => {
  it("getLocaleDisplayName returns native name for en", () => {
    expect(getLocaleDisplayName("en")).toBe("English");
  });

  it("getLocaleDisplayName returns native name for id", () => {
    expect(getLocaleDisplayName("id")).toBe("Bahasa Indonesia");
  });

  it("getLocaleDisplayName returns native name for planned locales", () => {
    expect(getLocaleDisplayName("es")).toBe("Español");
    expect(getLocaleDisplayName("fr")).toBe("Français");
    expect(getLocaleDisplayName("de")).toBe("Deutsch");
    expect(getLocaleDisplayName("ja")).toBe("日本語");
    expect(getLocaleDisplayName("ko")).toBe("한국어");
    expect(getLocaleDisplayName("zh")).toBe("中文");
  });
});

describe("locale direction", () => {
  it("all current locales are LTR", () => {
    expect(getLocaleDirection("en")).toBe("ltr");
    expect(getLocaleDirection("id")).toBe("ltr");
    expect(getLocaleDirection("es")).toBe("ltr");
    expect(getLocaleDirection("fr")).toBe("ltr");
    expect(getLocaleDirection("pt")).toBe("ltr");
    expect(getLocaleDirection("de")).toBe("ltr");
    expect(getLocaleDirection("ja")).toBe("ltr");
    expect(getLocaleDirection("ko")).toBe("ltr");
    expect(getLocaleDirection("zh")).toBe("ltr");
  });
});

// ─── Types Consistency Tests ───────────────────────────────────

describe("types consistency", () => {
  it("ALL_LOCALES contains all 9 planned locales", () => {
    expect(ALL_LOCALES.length).toBe(9);
  });

  it("SUPPORTED_LOCALES is a subset of ALL_LOCALES", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(ALL_LOCALES).toContain(loc);
    }
  });

  it("DEFAULT_LOCALE is in ALL_LOCALES", () => {
    expect(ALL_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("LOCALE_LABELS has entries for ALL_LOCALES", () => {
    for (const loc of ALL_LOCALES) {
      expect(LOCALE_LABELS[loc]).toBeTruthy();
    }
  });

  it("SUPPORTED_LOCALES matches enabled locales in registry", () => {
    const enabledCodes = getEnabledLocales().map((l) => l.locale);
    expect(SUPPORTED_LOCALES.sort()).toEqual(enabledCodes.sort());
  });
});

// ─── Number Formatting Tests ───────────────────────────────────

describe("financial formatting — numbers", () => {
  it("formatNumber formats with locale", () => {
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
  });

  it("formatDecimal formats with fixed decimals", () => {
    expect(formatDecimal(1.23456, "en", 2)).toBe("1.23");
    expect(formatDecimal(1.2, "en", 4)).toBe("1.2000");
  });

  it("formatCompact abbreviates large numbers", () => {
    const result = formatCompact(1500000, "en");
    expect(result).toMatch(/[MB]/);
  });

  it("formatNumber gracefully handles invalid locales", () => {
    expect(() => formatNumber(123, "xx" as Locale)).not.toThrow();
  });
});

describe("financial formatting — percentages", () => {
  it("formatPercent formats as percentage", () => {
    const result = formatPercent(5.5, "en", 2);
    expect(result).toContain("5");
    expect(result).toContain("550");
  });

  it("formatPercentFromDecimal multiplies by 100", () => {
    const result = formatPercentFromDecimal(0.055, "en", 2);
    expect(result).toContain("5.5");
    expect(result).toContain("%");
  });
});

describe("financial formatting — currency", () => {
  it("formatCurrency formats with currency symbol", () => {
    const result = formatCurrency(1234.56, "USD", "en");
    expect(result).toContain("$");
    expect(result).toContain("1,234.56");
  });

  it("formatCurrency works with IDR", () => {
    const result = formatCurrency(1500000, "IDR", "id");
    expect(result).toContain("Rp");
  });
});

describe("financial formatting — dates", () => {
  it("formatShortDate formats a date", () => {
    const date = new Date("2024-01-15");
    const result = formatShortDate(date, "en");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formatDateTime includes time", () => {
    const date = new Date("2024-01-15T14:30:00");
    const result = formatDateTime(date, "en");
    expect(result).toBeTruthy();
  });

  it("formatRelativeTime returns relative string", () => {
    const recent = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const result = formatRelativeTime(recent, "en");
    expect(result).toBeTruthy();
  });
});

describe("financial formatting — trading-specific", () => {
  it("formatPrice for crypto with high value", () => {
    const result = formatPrice(65432.10, "en", "crypto");
    expect(result).toContain("65,432");
  });

  it("formatPrice for crypto with low value", () => {
    const result = formatPrice(0.000123, "en", "crypto");
    expect(result).toBeTruthy();
  });

  it("formatPrice for forex", () => {
    const result = formatPrice(1.0856, "en", "forex");
    expect(result).toContain("1.0856");
  });

  it("formatPnL positive", () => {
    const result = formatPnL(1234.56, "en");
    expect(result.text).toContain("+");
    expect(result.isPositive).toBe(true);
    expect(result.isZero).toBe(false);
  });

  it("formatPnL negative", () => {
    const result = formatPnL(-500.25, "en");
    expect(result.isPositive).toBe(false);
    expect(result.isZero).toBe(false);
  });

  it("formatPnL zero", () => {
    const result = formatPnL(0, "en");
    expect(result.isZero).toBe(true);
  });

  it("formatPnL percent", () => {
    const result = formatPnL(5.5, "en", true);
    expect(result.text).toContain("%");
  });
});

describe("financial formatting — parsing", () => {
  it("parseLocaleNumber parses en format", () => {
    expect(parseLocaleNumber("1,234.56", "en")).toBe(1234.56);
  });

  it("parseLocaleNumber parses simple number", () => {
    expect(parseLocaleNumber("123.45", "en")).toBeCloseTo(123.45);
  });
});

// ─── Locale Label Tests ────────────────────────────────────────

describe("LOCALE_LABELS completeness", () => {
  it("has labels for all ALL_LOCALES", () => {
    for (const loc of ALL_LOCALES) {
      expect(LOCALE_LABELS[loc]).toBeTruthy();
      expect(LOCALE_LABELS[loc].length).toBeGreaterThan(0);
    }
  });

  it("labels are unique", () => {
    const labels = ALL_LOCALES.map((l) => LOCALE_LABELS[l]);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});
